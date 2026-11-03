// The catalog: the platform's memory.
//
// SQLite, in the extension's own storage — never in a repository, never committed. The database engine is
// `node:sqlite`, which ships with the Node the extension host runs, so the platform adds no runtime dependency
// for it; where that built-in is missing, the absence is reported in words at the point of use and activation
// is unaffected.

import * as vscode from 'vscode';
import type { DatabaseSync } from 'node:sqlite';
import {
  DEFAULT_LIMIT,
  QueryResult,
  TableFact,
  TableRows,
  integrityOf,
  maintain,
  rowsOf,
  runQuery,
  sizeOf,
  tablesOf,
} from './manage';
import { MIGRATIONS, SCHEMA, SCHEMA_VERSION } from './schema';

export const CATALOG_FILE = 'catalog.db';

/** The store cannot be used at all, for a reason worth reading. */
export class CatalogUnavailable extends Error { }

type SqliteModule = typeof import('node:sqlite');

/**
 * `node:sqlite`, loaded lazily.
 *
 * A top-level import would run at load time, so an editor whose Node predates the built-in would fail
 * activation rather than the one command that needs a database.
 */
function sqlite(): SqliteModule | undefined {
  try {
    return require('node:sqlite') as SqliteModule;
  } catch {
    return undefined;
  }
}

/** Whether this editor provides `node:sqlite` at all — the store's one precondition, asked before it is needed. */
export function sqliteAvailable(): boolean {
  return sqlite() !== undefined;
}

/** One instance per session: the schema is applied once, and every view reads the same handle. */
export class Catalog {
  private constructor(
    private readonly db: DatabaseSync,
    readonly file: vscode.Uri
  ) { }

  static async open(context: vscode.ExtensionContext): Promise<Catalog> {
    const sqliteModule = sqlite();
    if (!sqliteModule) {
      throw new CatalogUnavailable(
        'this editor does not provide `node:sqlite`, which is built into Node 22.5 and later. Update the ' +
        'editor to a build whose extension host runs that Node: there is no second way to open the catalog.'
      );
    }

    // Its own folder, so the database, its write-ahead log and the source cache live together and can be
    // measured, moved or deleted as one thing.
    const folder = vscode.Uri.joinPath(context.globalStorageUri, 'catalog');
    await vscode.workspace.fs.createDirectory(folder);
    const file = vscode.Uri.joinPath(folder, CATALOG_FILE);

    const db = new sqliteModule.DatabaseSync(file.fsPath);
    db.exec('PRAGMA journal_mode = WAL;');
    db.exec('PRAGMA foreign_keys = ON;');
    db.exec(SCHEMA);

    const row = db.prepare('SELECT value FROM meta WHERE key = ?').get('schema_version') as
      | { value?: unknown }
      | undefined;
    const found = row?.value === undefined ? undefined : Number(row.value);
    if (found === undefined) {
      db.prepare('INSERT INTO meta (key, value) VALUES (?, ?)').run('schema_version', String(SCHEMA_VERSION));
    } else if (found > SCHEMA_VERSION) {
      // Refused rather than half-read: a newer build may have changed what a row means.
      db.close();
      throw new CatalogUnavailable(
        `the catalog at ${file.fsPath} was written by a newer version of the platform (schema ${found}, ` +
        `this build knows ${SCHEMA_VERSION}).`
      );
    } else if (found < SCHEMA_VERSION) {
      // Brought forward one step at a time: a table that already exists is untouched by `CREATE TABLE IF NOT
      // EXISTS`, so a column added after this file was written needs its own statement.
      for (let version = found + 1; version <= SCHEMA_VERSION; version++) {
        for (const statement of MIGRATIONS[version] ?? []) {
          db.exec(statement);
        }
      }
      db.prepare('UPDATE meta SET value = ? WHERE key = ?').run(String(SCHEMA_VERSION), 'schema_version');
    }

    return new Catalog(db, file);
  }

  /** Rows per table, alphabetically. The cheapest proof that the store is real, and what the status shows. */
  counts(): [string, number][] {
    const tables = this.db
      .prepare(
        "SELECT name FROM sqlite_master WHERE type = 'table' AND name NOT LIKE 'sqlite_%' ORDER BY name"
      )
      .all() as { name?: unknown }[];

    return tables
      .map((table) => String(table.name))
      .map((name) => {
        const counted = this.db.prepare(`SELECT COUNT(*) AS n FROM "${name}"`).get() as
          | { n?: unknown }
          | undefined;
        return [name, Number(counted?.n ?? 0)] as [string, number];
      });
  }

  /** What the schema this database carries says it is. */
  schemaVersion(): number {
    const row = this.db.prepare('SELECT value FROM meta WHERE key = ?').get('schema_version') as
      | { value?: unknown }
      | undefined;
    return row?.value === undefined ? SCHEMA_VERSION : Number(row.value);
  }

  /**
   * One statement, for a person looking at the database rather than for the platform.
   *
   * Read-only unless `write` is set: a query box should not be able to empty the platform's memory by accident.
   */
  query(sql: string, options: { write?: boolean; limit?: number } = {}): QueryResult {
    return runQuery(this.db, sql, options);
  }

  /** Every table with its columns, its indexes and how many rows it holds. */
  tables(): TableFact[] {
    return tablesOf(this.db);
  }

  /** One page of one table. */
  rows(table: string, limit = DEFAULT_LIMIT, offset = 0): TableRows {
    return rowsOf(this.db, table, limit, offset);
  }

  /** Vacuum, checkpoint, empty every table, or drop the schema and write it again. */
  maintain(action: 'vacuum' | 'checkpoint' | 'clear' | 'reset'): string {
    const detail = maintain(this.db, action);
    this.recordEvent('maintenance', detail);
    return detail;
  }

  /** The schema version *this build* expects — what a stored version is compared against. */
  expectedSchemaVersion(): number {
    return SCHEMA_VERSION;
  }

  /** SQLite's own verdict on the file, from `quick_check`. */
  integrity(): string {
    return integrityOf(this.db);
  }

  /** Bytes each part of the database takes: the file, and the write-ahead log beside it. */
  sizes(): { file?: number; wal?: number } {
    return { file: sizeOf(this.file.fsPath), wal: sizeOf(`${this.file.fsPath}-wal`) };
  }

  /**
   * The documents, with the two facts a list needs: how many sources cite it, and when anything of it was
   * last built. Both are subqueries rather than joins, so a document with neither still appears.
   */
  documents(): DocumentRow[] {
    const rows = this.db
      .prepare(
        `SELECT d.slug AS slug, d.name AS name, d.version AS version, d.origin AS origin,
                (SELECT COUNT(*) FROM doc_sources ds WHERE ds.document_id = d.id) AS sources,
                (SELECT MAX(a.built_at) FROM artifacts a WHERE a.document_id = d.id) AS builtAt
           FROM documents d
          ORDER BY d.name`
      )
      .all() as Record<string, unknown>[];

    return rows.map((row) => ({
      slug: String(row.slug ?? ''),
      name: String(row.name ?? ''),
      version: row.version === null || row.version === undefined ? undefined : String(row.version),
      origin: row.origin === null || row.origin === undefined ? undefined : String(row.origin),
      sources: Number(row.sources ?? 0),
      builtAt: row.builtAt === null || row.builtAt === undefined ? undefined : String(row.builtAt),
    }));
  }

  /**
   * The reads of one source, newest first.
   *
   * A read is keyed by the commit it read, which is why the revision is here: it is what explains a page later.
   */
  scans(slug: string): ScanRow[] {
    const rows = this.db
      .prepare(
        `SELECT s.id AS id, s.at AS at, s.mode AS mode, s.revision AS revision, s.counts AS counts
           FROM scans s JOIN sources so ON so.id = s.source_id
          WHERE so.slug = ? ORDER BY s.at DESC, s.id DESC`
      )
      .all(slug) as Record<string, unknown>[];
    return rows.map((row) => ({
      id: Number(row.id ?? 0),
      at: String(row.at ?? ''),
      mode: String(row.mode ?? ''),
      revision: row.revision === null || row.revision === undefined ? undefined : String(row.revision),
      counts: row.counts === null || row.counts === undefined ? undefined : String(row.counts),
    }));
  }

  /**
   * What the platform noticed, newest first — the feed a dashboard shows.
   *
   * A row is written by whichever module did the thing (a draft saved, a release published), so the feed is the
   * platform's own account of itself rather than a second, derived history.
   */
  events(limit = 50): EventRow[] {
    const rows = this.db
      .prepare(
        `SELECT id, at, kind, subject_kind AS subjectKind, subject_id AS subjectId, detail, seen_at AS seenAt
           FROM events ORDER BY at DESC, id DESC LIMIT ?`
      )
      .all(limit) as Record<string, unknown>[];
    return rows.map((row) => ({
      id: Number(row.id ?? 0),
      at: String(row.at ?? ''),
      kind: String(row.kind ?? ''),
      detail: row.detail === null || row.detail === undefined ? undefined : String(row.detail),
      seenAt: row.seenAt === null || row.seenAt === undefined ? undefined : String(row.seenAt),
    }));
  }

  /** The sources, with the branch and how they were last read — the two facts that decide how much to trust. */
  sources(): SourceRow[] {
    const rows = this.db
      .prepare(
        `SELECT id, slug, name, kind, branch, pages, state, last_read AS lastRead, last_read_mode AS lastReadMode
           FROM sources
          ORDER BY name`
      )
      .all() as Record<string, unknown>[];

    return rows.map((row) => ({
      id: Number(row.id ?? 0),
      slug: String(row.slug ?? ''),
      name: String(row.name ?? ''),
      kind: String(row.kind ?? ''),
      branch: row.branch === null || row.branch === undefined ? undefined : String(row.branch),
      pages: row.pages === null || row.pages === undefined ? undefined : Number(row.pages),
      state: row.state === null || row.state === undefined ? undefined : String(row.state),
      lastRead: row.lastRead === null || row.lastRead === undefined ? undefined : String(row.lastRead),
      lastReadMode:
        row.lastReadMode === null || row.lastReadMode === undefined ? undefined : String(row.lastReadMode),
    }));
  }

  /** What the platform noticed and has not shown. Zero is the normal state. */
  unseenEvents(): number {
    const row = this.db.prepare('SELECT COUNT(*) AS n FROM events WHERE seen_at IS NULL').get() as
      | { n?: unknown }
      | undefined;
    return Number(row?.n ?? 0);
  }

  /**
   * Remembers a source, or updates the one with the same slug.
   *
   * Keyed by slug rather than by URL so a folder, a fork and a clone of the same project stay one row when the
   * caller says they are — R2's discovery decides that, and the catalog only records the decision.
   */
  addSource(source: SourceInput): number {
    this.db
      .prepare(
        `INSERT INTO sources
           (kind, name, slug, remote_url, path, default_branch, branch, docs_root, registry_path, added_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
         ON CONFLICT(slug) DO UPDATE SET
           kind = excluded.kind, name = excluded.name, remote_url = excluded.remote_url, path = excluded.path,
           default_branch = excluded.default_branch, branch = excluded.branch, docs_root = excluded.docs_root,
           registry_path = excluded.registry_path`
      )
      .run(
        source.kind,
        source.name,
        source.slug,
        source.remoteUrl ?? null,
        source.path ?? null,
        source.defaultBranch ?? null,
        source.branch ?? null,
        source.docsRoot ?? null,
        source.registryPath ?? null,
        new Date().toISOString()
      );

    const row = this.db.prepare('SELECT id FROM sources WHERE slug = ?').get(source.slug) as
      | { id?: unknown }
      | undefined;
    return Number(row?.id ?? 0);
  }

  /** Forgets a source and everything recorded under it — the scan rows go with it, by foreign key. */
  removeSource(slug: string): void {
    this.db.prepare('DELETE FROM sources WHERE slug = ?').run(slug);
  }

  /**
   * Where repositories come from, with how many of each the cache holds — the first thing the Repositories page draws.
   *
   * Ordered by when they were added, so the default organisation (written first) stays first, and an enterprise a
   * person adds afterwards arrives at the end of the strip rather than in the middle of it.
   */
  organisations(): OrganisationRow[] {
    const rows = this.db
      .prepare(
        `SELECT o.id, o.kind, o.name, o.slug, o.url, o.last_read AS lastRead, o.state,
                (SELECT COUNT(*) FROM repositories r WHERE r.org_id = o.id) AS repositories
           FROM organisations o
          ORDER BY o.id`
      )
      .all() as Record<string, unknown>[];

    return rows.map((row) => ({
      id: Number(row.id ?? 0),
      kind: String(row.kind ?? 'organisation'),
      name: String(row.name ?? ''),
      slug: String(row.slug ?? ''),
      url: row.url === null || row.url === undefined ? undefined : String(row.url),
      lastRead: row.lastRead === null || row.lastRead === undefined ? undefined : String(row.lastRead),
      state: row.state === null || row.state === undefined ? undefined : String(row.state),
      repositories: Number(row.repositories ?? 0),
    }));
  }

  /**
   * Remembers where repositories come from — an organisation, an account, or one repository's address.
   *
   * Keyed by slug and only ever *clarifying* an existing row: the name and the address are written again, while
   * `added_at`, `last_read` and the cached list are left alone. So seeding the default organisation on every open
   * cannot undo a read.
   */
  addOrganisation(input: OrganisationInput): number {
    this.db
      .prepare(
        `INSERT INTO organisations (kind, name, slug, url, added_at)
         VALUES (?, ?, ?, ?, ?)
         ON CONFLICT(slug) DO UPDATE SET kind = excluded.kind, name = excluded.name, url = excluded.url`
      )
      .run(input.kind, input.name, input.slug, input.url ?? null, new Date().toISOString());

    const row = this.db.prepare('SELECT id FROM organisations WHERE slug = ?').get(input.slug) as
      | { id?: unknown }
      | undefined;
    return Number(row?.id ?? 0);
  }

  /** Forgets where a list came from, and the list with it — the repositories go by foreign key. */
  removeOrganisation(slug: string): void {
    this.db.prepare('DELETE FROM organisations WHERE slug = ?').run(slug);
  }

  /** What the last read of one of these lists concluded, and when. */
  recordOrganisationRead(slug: string, state: string): void {
    this.db
      .prepare('UPDATE organisations SET last_read = ?, state = ? WHERE slug = ?')
      .run(new Date().toISOString(), state, slug);
  }

  /** The repositories an organisation holds, as the last good read found them — most recently pushed first. */
  repositoriesOf(slug: string): RepositoryCacheRow[] {
    const rows = this.db
      .prepare(
        `SELECT r.name, r.full_name AS fullName, r.description, r.language, r.pushed_at AS pushedAt,
                r.is_private AS isPrivate, r.web_url AS webUrl, r.clone_url AS cloneUrl,
                r.default_branch AS defaultBranch
           FROM repositories r JOIN organisations o ON o.id = r.org_id
          WHERE o.slug = ?
          ORDER BY r.pushed_at DESC, r.name`
      )
      .all(slug) as Record<string, unknown>[];

    return rows.map((row) => ({
      name: String(row.name ?? ''),
      fullName: String(row.fullName ?? ''),
      description: row.description === null || row.description === undefined ? undefined : String(row.description),
      language: row.language === null || row.language === undefined ? undefined : String(row.language),
      pushedAt: row.pushedAt === null || row.pushedAt === undefined ? undefined : String(row.pushedAt),
      isPrivate: Number(row.isPrivate ?? 0) !== 0,
      webUrl: row.webUrl === null || row.webUrl === undefined ? undefined : String(row.webUrl),
      cloneUrl: row.cloneUrl === null || row.cloneUrl === undefined ? undefined : String(row.cloneUrl),
      defaultBranch:
        row.defaultBranch === null || row.defaultBranch === undefined ? undefined : String(row.defaultBranch),
    }));
  }

  /**
   * Keeps a good read whole: the rows in the statement replace whatever the organisation held before.
   *
   * Delete-then-insert inside a transaction, because a list is one answer from GitHub rather than a stream of
   * edits — a repository that disappeared from the organisation must disappear here too.
   */
  replaceRepositories(slug: string, repositories: readonly RepositoryCacheRow[]): void {
    const row = this.db.prepare('SELECT id FROM organisations WHERE slug = ?').get(slug) as
      | { id?: unknown }
      | undefined;
    const orgId = Number(row?.id ?? 0);
    if (orgId === 0) {
      return;
    }
    const takenAt = new Date().toISOString();
    const insert = this.db.prepare(
      `INSERT INTO repositories
         (org_id, name, full_name, description, language, pushed_at, is_private, web_url, clone_url,
          default_branch, taken_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
       ON CONFLICT(org_id, name) DO UPDATE SET
         full_name = excluded.full_name, description = excluded.description, language = excluded.language,
         pushed_at = excluded.pushed_at, is_private = excluded.is_private, web_url = excluded.web_url,
         clone_url = excluded.clone_url, default_branch = excluded.default_branch, taken_at = excluded.taken_at`
    );

    this.db.exec('BEGIN');
    try {
      const keep = new Set(repositories.map((repository) => repository.name));
      for (const existing of this.repositoriesOf(slug)) {
        if (!keep.has(existing.name)) {
          this.db.prepare('DELETE FROM repositories WHERE org_id = ? AND name = ?').run(orgId, existing.name);
        }
      }
      for (const repository of repositories) {
        insert.run(
          orgId,
          repository.name,
          repository.fullName,
          repository.description ?? null,
          repository.language ?? null,
          repository.pushedAt ?? null,
          repository.isPrivate ? 1 : 0,
          repository.webUrl ?? null,
          repository.cloneUrl ?? null,
          repository.defaultBranch ?? null,
          takenAt
        );
      }
      this.db.exec('COMMIT');
    } catch (error) {
      this.db.exec('ROLLBACK');
      throw error;
    }
  }

  /** Records what a read of a source found, so the next read can say what changed. */
  recordScan(sourceId: number, mode: string, revision: string | undefined, counts: unknown): void {
    this.db
      .prepare('INSERT INTO scans (source_id, at, mode, revision, counts) VALUES (?, ?, ?, ?, ?)')
      .run(sourceId, new Date().toISOString(), mode, revision ?? null, JSON.stringify(counts ?? {}));
    this.db
      .prepare('UPDATE sources SET last_read = ?, last_read_mode = ?, last_commit = ? WHERE id = ?')
      .run(new Date().toISOString(), mode, revision ?? null, sourceId);
  }

  /** Creates a document — the project a person manages — and returns its id. */
  createDocument(document: DocumentInput): number {
    const now = new Date().toISOString();
    this.db
      .prepare(
        // `origin` and `template` are written by the create and then left alone: where a project began is not a
        // value an edit re-answers, and the edit page writes through this same statement.
        `INSERT INTO documents (name, slug, version, audience, owner, origin, template, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
         ON CONFLICT(slug) DO UPDATE SET
           name = excluded.name, version = excluded.version, audience = excluded.audience,
           owner = excluded.owner, updated_at = excluded.updated_at`
      )
      .run(
        document.name,
        document.slug,
        document.version ?? null,
        document.audience ?? null,
        document.owner ?? null,
        document.origin ?? 'blank',
        document.template ?? null,
        now,
        now
      );
    return this.documentId(document.slug);
  }

  /** Attaches a source to a document — what it is built from, at which branch, in what role. */
  attachSource(documentSlug: string, sourceSlug: string, role = 'primary'): void {
    const document = this.documentId(documentSlug);
    const sourceId = this.sourceId(sourceSlug);
    if (document === 0 || sourceId === 0) {
      throw new Error(`cannot attach ${sourceSlug} to ${documentSlug}: one of the two is not recorded`);
    }
    this.db
      .prepare(
        `INSERT INTO doc_sources (document_id, source_id, role) VALUES (?, ?, ?)
         ON CONFLICT(document_id, source_id) DO UPDATE SET role = excluded.role`
      )
      .run(document, sourceId, role);
  }

  /** The slugs of the sources a document cites — what the edit page pre-ticks. */
  documentSourceSlugs(documentSlug: string): string[] {
    const rows = this.db
      .prepare(
        `SELECT s.slug AS slug
           FROM doc_sources d JOIN sources s ON s.id = d.source_id
          WHERE d.document_id = ? ORDER BY s.slug`
      )
      .all(this.documentId(documentSlug)) as Record<string, unknown>[];
    return rows.map((row) => String(row.slug ?? ''));
  }

  /**
   * Replaces what a document cites.
   *
   * One call with the whole list, because the ticks on the page are the truth: a project that stopped citing
   * a source must stop citing it here, and the alternative — attach and detach called by the caller — is the
   * shape that leaves stale links behind. Existing links are kept as they are (`role`, a branch override), so
   * re-saving a project does not quietly reset them.
   */
  setDocumentSources(documentSlug: string, sourceSlugs: readonly string[]): void {
    const document = this.documentId(documentSlug);
    if (document === 0) {
      throw new Error(`there is no document called ${documentSlug}`);
    }

    const ids = sourceSlugs
      .map((slug) => this.sourceId(slug))
      .filter((id) => id > 0);

    if (ids.length === 0) {
      this.db.prepare('DELETE FROM doc_sources WHERE document_id = ?').run(document);
      return;
    }

    const holes = ids.map(() => '?').join(', ');
    this.db
      .prepare(`DELETE FROM doc_sources WHERE document_id = ? AND source_id NOT IN (${holes})`)
      .run(document, ...ids);

    const keep = this.db.prepare(
      `INSERT INTO doc_sources (document_id, source_id, role) VALUES (?, ?, 'primary')
       ON CONFLICT(document_id, source_id) DO NOTHING`
    );
    for (const id of ids) {
      keep.run(document, id);
    }
  }

  private sourceId(slug: string): number {
    const row = this.db.prepare('SELECT id FROM sources WHERE slug = ?').get(slug) as
      | { id?: unknown }
      | undefined;
    return Number(row?.id ?? 0);
  }

  /** What a document is made of: its sources, each with the branch it is read at. */
  documentSources(documentSlug: string): { name: string; kind: string; branch?: string }[] {
    const rows = this.db
      .prepare(
        `SELECT s.name AS name, s.kind AS kind, COALESCE(ds.branch, s.branch) AS branch
           FROM doc_sources ds
           JOIN sources s ON s.id = ds.source_id
           JOIN documents d ON d.id = ds.document_id
          WHERE d.slug = ?
          ORDER BY s.name`
      )
      .all(documentSlug) as Record<string, unknown>[];
    return rows.map((row) => ({
      name: String(row.name ?? ''),
      kind: String(row.kind ?? ''),
      branch: row.branch === null || row.branch === undefined ? undefined : String(row.branch),
    }));
  }

  /**
   * The builds of one project, newest first.
   *
   * A build row is the attempt, not the outcome: `status` is what the caller judged after looking at the files.
   */
  builds(documentSlug: string): BuildRow[] {
    const rows = this.db
      .prepare(
        `SELECT b.id AS id, b.started_at AS startedAt, b.finished_at AS finishedAt, b.status AS status,
                b.revision AS revision
           FROM builds b JOIN documents d ON d.id = b.document_id
          WHERE d.slug = ? ORDER BY b.started_at DESC, b.id DESC`
      )
      .all(documentSlug) as Record<string, unknown>[];
    return rows.map((row) => ({
      id: Number(row.id ?? 0),
      startedAt: String(row.startedAt ?? ''),
      finishedAt: row.finishedAt === null || row.finishedAt === undefined ? undefined : String(row.finishedAt),
      status: String(row.status ?? ''),
      revision: row.revision === null || row.revision === undefined ? undefined : String(row.revision),
    }));
  }

  /** What a document has produced, newest first — the artifacts, by file. */
  documentArtifacts(documentSlug: string): { kind: string; path: string; builtAt: string }[] {
    const rows = this.db
      .prepare(
        `SELECT a.kind AS kind, a.path AS path, a.built_at AS builtAt
           FROM artifacts a JOIN documents d ON d.id = a.document_id
          WHERE d.slug = ? ORDER BY a.built_at DESC`
      )
      .all(documentSlug) as Record<string, unknown>[];
    return rows.map((row) => ({
      kind: String(row.kind ?? ''),
      path: String(row.path ?? ''),
      builtAt: String(row.builtAt ?? ''),
    }));
  }

  /**
   * Records a build that has started.
   *
   * A build row is opened before the script runs, so a build that crashes the editor still leaves the attempt
   * behind — the alternative is a Builds tab that only remembers the runs that went well.
   */
  startBuild(documentSlug: string, revision?: string): number {
    const id = this.documentId(documentSlug);
    if (id === 0) {
      throw new Error(`there is no document called ${documentSlug}`);
    }
    const result = this.db
      .prepare('INSERT INTO builds (document_id, started_at, status, revision) VALUES (?, ?, ?, ?)')
      .run(id, new Date().toISOString(), 'running', revision ?? null);
    return Number(result.lastInsertRowid);
  }

  /** Closes a build row. `status` is the outcome the caller judged, not the exit code it was given. */
  finishBuild(buildId: number, status: string): void {
    this.db
      .prepare('UPDATE builds SET finished_at = ?, status = ? WHERE id = ?')
      .run(new Date().toISOString(), status, buildId);
  }

  /**
   * Records one file a build left behind.
   *
   * Keyed by path without a unique index: an artifact is the file, so a second build of the same site
   * produces the same paths and must not turn one output into two rows. Updating first rather than relying on
   * `ON CONFLICT` keeps the schema — and therefore an existing catalog — untouched.
   */
  recordArtifact(
    documentSlug: string,
    artifact: { kind: string; path: string; bytes?: number; buildId?: number }
  ): void {
    const id = this.documentId(documentSlug);
    if (id === 0) {
      throw new Error(`there is no document called ${documentSlug}`);
    }
    const now = new Date().toISOString();
    const updated = this.db
      .prepare(
        `UPDATE artifacts SET build_id = ?, kind = ?, bytes = ?, built_at = ?
          WHERE document_id = ? AND path = ?`
      )
      .run(artifact.buildId ?? null, artifact.kind, artifact.bytes ?? null, now, id, artifact.path);

    if (updated.changes === 0) {
      this.db
        .prepare(
          'INSERT INTO artifacts (build_id, document_id, kind, path, bytes, built_at) VALUES (?, ?, ?, ?, ?, ?)'
        )
        .run(artifact.buildId ?? null, id, artifact.kind, artifact.path, artifact.bytes ?? null, now);
    }
  }

  /**
   * A build that was handed to a reader.
   *
   * A release is a decision plus a destination: the files are the build's artifacts, copied where a reader can
   * reach them, and this row is what makes "13.0 was published here, on this day" a fact rather than a memory.
   * Publishing again is a new row, never an edit of an old one.
   */
  publishRelease(
    documentSlug: string,
    release: { version: string; destination: string; files: number; buildId?: number }
  ): number {
    const id = this.documentId(documentSlug);
    if (id === 0) {
      throw new Error(`there is no document called ${documentSlug}`);
    }
    const at = new Date().toISOString();
    const run = this.db
      .prepare(
        `INSERT INTO releases (document_id, build_id, version, destination, files, published_at)
         VALUES (?, ?, ?, ?, ?, ?)`
      )
      .run(id, release.buildId ?? null, release.version, release.destination, release.files, at);
    this.recordEvent('release', `${release.version} was published — ${release.files} file(s) to ${release.destination}`);
    return Number(run.lastInsertRowid);
  }

  /** The releases of one project, newest first — published versions stay listed forever. */
  releases(documentSlug: string): ReleaseRow[] {
    const rows = this.db
      .prepare(
        `SELECT r.id AS id, r.build_id AS buildId, r.version AS version, r.destination AS destination,
                r.files AS files, r.published_at AS publishedAt
           FROM releases r JOIN documents d ON d.id = r.document_id
          WHERE d.slug = ? ORDER BY r.published_at DESC, r.id DESC`
      )
      .all(documentSlug) as Record<string, unknown>[];
    return rows.map((row) => ({
      id: Number(row.id ?? 0),
      buildId: row.buildId === null || row.buildId === undefined ? undefined : Number(row.buildId),
      version: String(row.version ?? ''),
      destination: String(row.destination ?? ''),
      files: Number(row.files ?? 0),
      publishedAt: String(row.publishedAt ?? ''),
    }));
  }

  /** One document, with everything the edit page needs to fill itself in. */
  document(slug: string): DocumentDetail | undefined {
    const row = this.db
      .prepare('SELECT name, version, audience, owner, origin, template FROM documents WHERE slug = ?')
      .get(slug) as Record<string, unknown> | undefined;
    if (!row) {
      return undefined;
    }
    const id = this.documentId(slug);
    const recipe = this.db.prepare('SELECT engine, outputs FROM recipes WHERE document_id = ?').get(id) as
      | Record<string, unknown>
      | undefined;

    let outputs: string[] = [];
    if (recipe?.outputs !== null && recipe?.outputs !== undefined) {
      try {
        const parsed: unknown = JSON.parse(String(recipe.outputs));
        outputs = Array.isArray(parsed) ? parsed.map((entry) => String(entry)) : [];
      } catch {
        outputs = [];
      }
    }

    return {
      name: String(row.name ?? ''),
      version: row.version === null || row.version === undefined ? undefined : String(row.version),
      audience: row.audience === null || row.audience === undefined ? undefined : String(row.audience),
      owner: row.owner === null || row.owner === undefined ? undefined : String(row.owner),
      origin: row.origin === null || row.origin === undefined ? undefined : String(row.origin),
      template: row.template === null || row.template === undefined ? undefined : String(row.template),
      engine: recipe?.engine === null || recipe?.engine === undefined ? undefined : String(recipe.engine),
      outputs,
      sources: this.documentSources(slug),
    };
  }

  /** How a document is built: one row per document, replaced when the choice changes. */
  setRecipe(slug: string, engine: string, outputs: string[]): void {
    const id = this.documentId(slug);
    if (id === 0) {
      throw new Error(`there is no document called ${slug}`);
    }
    this.db
      .prepare(
        `INSERT INTO recipes (document_id, engine, outputs) VALUES (?, ?, ?)
         ON CONFLICT(document_id) DO UPDATE SET engine = excluded.engine, outputs = excluded.outputs`
      )
      .run(id, engine, JSON.stringify(outputs));
  }

  /**
   * Forgets a document. Its artifacts and source links go with it, by foreign key.
   *
   * The count is returned rather than swallowed: a delete that matched no row is a removal that did nothing, and a
   * caller that cannot tell the two apart reports success over a project that is still there.
   */
  deleteDocument(slug: string): number {
    return Number(this.db.prepare('DELETE FROM documents WHERE slug = ?').run(slug).changes);
  }

  /**
   * The branch a source is read at. Empty clears it, so the default branch is used again.
   *
   * The recorded pages are dropped with it, because they described *another* branch: keeping them would let a
   * read that never happened look like a read that did. The source becomes unread, which is what makes
   * "read every unread source" pick it up again.
   */
  setSourceBranch(slug: string, branch: string | undefined): void {
    this.db
      .prepare('UPDATE sources SET branch = ?, pages = NULL, state = ? WHERE slug = ?')
      .run(branch ?? null, 'the branch changed — read it again', slug);
  }

  /** One source's coordinates — everything a read needs, and nothing else. */
  source(slug: string): SourceDetail | undefined {
    const row = this.db
      .prepare(
        `SELECT id, kind, name, remote_url, path, branch, default_branch, docs_root, registry_path, last_read
           FROM sources WHERE slug = ?`
      )
      .get(slug) as Record<string, unknown> | undefined;
    if (!row) {
      return undefined;
    }
    const text = (value: unknown): string | undefined =>
      value === null || value === undefined ? undefined : String(value);
    return {
      id: Number(row.id ?? 0),
      kind: String(row.kind ?? 'folder') as SourceDetail['kind'],
      name: String(row.name ?? ''),
      remoteUrl: text(row.remote_url),
      path: text(row.path),
      branch: text(row.branch),
      defaultBranch: text(row.default_branch),
      docsRoot: text(row.docs_root),
      registryPath: text(row.registry_path),
      lastRead: text(row.last_read),
    };
  }

  /**
   * Replaces what a source holds. A read is a snapshot, not an accumulation: a page that disappeared must
   * disappear here too, or the tree would keep showing documentation that is no longer there.
   */
  replacePages(sourceId: number, pages: PageInput[]): void {
    this.db.prepare('DELETE FROM pages WHERE source_id = ?').run(sourceId);
    const insert = this.db.prepare(
      `INSERT INTO pages (id, document_id, source_id, path, title, owner, stale, counts)
       VALUES (?, NULL, ?, ?, ?, ?, NULL, ?)`
    );
    for (const page of pages) {
      insert.run(
        page.id,
        sourceId,
        page.path ?? null,
        page.title ?? null,
        page.owner ?? null,
        JSON.stringify(page.counts ?? {})
      );
    }
  }

  /** What a read found, kept on the source row so a list can show it without touching the pages. */
  setSourceState(
    slug: string,
    state: { pages?: number; docsRoot?: string; registryPath?: string; state?: string }
  ): void {
    this.db
      .prepare(
        `UPDATE sources SET
           pages = COALESCE(?, pages),
           docs_root = COALESCE(?, docs_root),
           registry_path = COALESCE(?, registry_path),
           state = COALESCE(?, state)
         WHERE slug = ?`
      )
      .run(state.pages ?? null, state.docsRoot ?? null, state.registryPath ?? null, state.state ?? null, slug);
  }

  /**
   * Where a source's local copy is.
   *
   * The working area sets this after a clone, and from then on the source is read from disk: the registry, the
   * checks, the code files and the history all work on a working tree instead of one API call at a time.
   */
  setSourcePath(slug: string, path: string | undefined): void {
    this.db.prepare('UPDATE sources SET path = ? WHERE slug = ?').run(path ?? null, slug);
  }

  /** The pages a source holds, in the order the registry declared them. */
  pagesFor(sourceId: number): PageRow[] {
    const rows = this.db
      .prepare('SELECT id, path, title, owner FROM pages WHERE source_id = ? ORDER BY id')
      .all(sourceId) as Record<string, unknown>[];
    return rows.map((row) => ({
      id: String(row.id ?? ''),
      path: row.path === null || row.path === undefined ? undefined : String(row.path),
      title: row.title === null || row.title === undefined ? undefined : String(row.title),
      owner: row.owner === null || row.owner === undefined ? undefined : String(row.owner),
    }));
  }

  /**
   * Every page a project holds, through the sources it cites — what its Pages tab lists.
   *
   * A join rather than a loop of {@link pagesFor}: the tab shows them grouped by source, so it needs the
   * source name on every row, which is exactly what the join is for.
   */
  documentPages(slug: string): (PageRow & { source: string })[] {
    const rows = this.db
      .prepare(
        `SELECT s.name AS source, p.id, p.path, p.title, p.owner
           FROM doc_sources d
           JOIN sources s ON s.id = d.source_id
           JOIN pages p ON p.source_id = s.id
          WHERE d.document_id = ?
          ORDER BY s.name, p.id`
      )
      .all(this.documentId(slug)) as Record<string, unknown>[];

    return rows.map((row) => ({
      source: String(row.source ?? ''),
      id: String(row.id ?? ''),
      path: row.path === null || row.path === undefined ? undefined : String(row.path),
      title: row.title === null || row.title === undefined ? undefined : String(row.title),
      owner: row.owner === null || row.owner === undefined ? undefined : String(row.owner),
    }));
  }

  private documentId(slug: string): number {
    const row = this.db.prepare('SELECT id FROM documents WHERE slug = ?').get(slug) as
      | { id?: unknown }
      | undefined;
    return Number(row?.id ?? 0);
  }

  /**
   * A drafted body, waiting for a person.
   *
   * The text is kept here rather than in a file because a draft is a proposal: accepting it writes the page and
   * settles the row, discarding it settles the row and writes nothing. The page keeps the id it *will* have
   * (`area/chapter/slug`), so two drafts for one page are recognisable before either exists on disk.
   */
  saveDraft(input: DraftInput): number {
    const at = new Date().toISOString();
    const run = this.db
      .prepare(
        `INSERT INTO drafts (document_slug, source, page_id, title, kind, body, created_at, state)
         VALUES (?, ?, ?, ?, ?, ?, ?, 'draft')`
      )
      .run(input.documentSlug, input.source ?? null, input.pageId, input.title, input.kind ?? null, input.body, at);
    this.recordEvent('draft', `Draft “${input.title}” is waiting for review`);
    return Number(run.lastInsertRowid);
  }

  /** The drafts of one project — `waiting` by default, which is what the Review Center lists. */
  drafts(documentSlug: string, state: 'draft' | 'accepted' | 'discarded' = 'draft'): DraftRow[] {
    const rows = this.db
      .prepare(
        `SELECT id, document_slug, source, page_id, title, kind, body, created_at, state
           FROM drafts WHERE document_slug = ? AND state = ? ORDER BY created_at DESC, id DESC`
      )
      .all(documentSlug, state) as Record<string, unknown>[];
    return rows.map(draftRow);
  }

  /** One draft, by id: what accepting it needs. */
  draft(id: number): DraftRow | undefined {
    const row = this.db
      .prepare(
        `SELECT id, document_slug, source, page_id, title, kind, body, created_at, state FROM drafts WHERE id = ?`
      )
      .get(id) as Record<string, unknown> | undefined;
    return row === undefined ? undefined : draftRow(row);
  }

  /** Settled: accepted when the page was written, discarded when a person said no. */
  setDraftState(id: number, state: 'accepted' | 'discarded'): void {
    this.db.prepare('UPDATE drafts SET state = ? WHERE id = ?').run(state, id);
  }

  /** Every waiting draft that proposed one page, settled at once — writing the page settles all of them. */
  settleDrafts(documentSlug: string, pageId: string, state: 'accepted' | 'discarded'): void {
    this.db
      .prepare("UPDATE drafts SET state = ? WHERE document_slug = ? AND page_id = ? AND state = 'draft'")
      .run(state, documentSlug, pageId);
  }

  // ── The forum ─────────────────────────────────────────────────────────────────────────────────────────────────
  //
  // A cache of the community site, written by a sync and read by a view. Nothing here decides what a topic means: the
  // site holds the conversation, the registry holds the pages, and this is the bridge the two are read through.

  /** The categories, in the order the site lists them. */
  forumCategories(): ForumCategoryRow[] {
    const rows = this.db
      .prepare(
        'SELECT id, slug, name, color, parent_id, topics, posts, position, synced_at FROM forum_categories ORDER BY position, name'
      )
      .all() as Record<string, unknown>[];
    return rows.map((row) => ({
      id: Number(row.id ?? 0),
      slug: String(row.slug ?? ''),
      name: String(row.name ?? ''),
      color: text(row.color),
      parentId: row.parent_id === null || row.parent_id === undefined ? undefined : Number(row.parent_id),
      topics: Number(row.topics ?? 0),
      posts: Number(row.posts ?? 0),
      syncedAt: text(row.synced_at),
    }));
  }

  saveForumCategories(rows: readonly ForumCategoryInput[]): void {
    const at = new Date().toISOString();
    const statement = this.db.prepare(
      `INSERT INTO forum_categories (id, slug, name, color, parent_id, topics, posts, position, synced_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
       ON CONFLICT(id) DO UPDATE SET
         slug = excluded.slug, name = excluded.name, color = excluded.color, parent_id = excluded.parent_id,
         topics = excluded.topics, posts = excluded.posts, position = excluded.position, synced_at = excluded.synced_at`
    );
    for (const row of rows) {
      statement.run(
        row.id,
        row.slug,
        row.name,
        row.color ?? null,
        row.parentId ?? null,
        row.topics ?? 0,
        row.posts ?? 0,
        row.position ?? 0,
        at
      );
    }
  }

  /** The topics of one category — or of every category, when none is named. Pinned first, then newest activity. */
  forumTopics(categoryId?: number): ForumTopicRow[] {
    const where = categoryId === undefined ? '' : 'WHERE category_id = ?';
    const statement = this.db.prepare(
      `SELECT id, category_id, slug, title, excerpt, posts_count, reply_count, views, created_at, last_posted_at,
              pinned, closed, posters, synced_at
         FROM forum_topics ${where}
        ORDER BY pinned DESC, COALESCE(last_posted_at, created_at) DESC`
    );
    const rows = (categoryId === undefined ? statement.all() : statement.all(categoryId)) as Record<string, unknown>[];
    return rows.map((row) => ({
      id: Number(row.id ?? 0),
      categoryId: Number(row.category_id ?? 0),
      slug: String(row.slug ?? ''),
      title: String(row.title ?? ''),
      excerpt: text(row.excerpt),
      posts: Number(row.posts_count ?? 0),
      replies: Number(row.reply_count ?? 0),
      views: Number(row.views ?? 0),
      createdAt: text(row.created_at),
      lastPostedAt: text(row.last_posted_at),
      pinned: Number(row.pinned ?? 0) === 1,
      closed: Number(row.closed ?? 0) === 1,
      posters: postersOf(row.posters),
      syncedAt: text(row.synced_at),
    }));
  }

  saveForumTopics(rows: readonly ForumTopicInput[]): void {
    const at = new Date().toISOString();
    const statement = this.db.prepare(
      `INSERT INTO forum_topics (id, category_id, slug, title, excerpt, posts_count, reply_count, views, created_at,
                                last_posted_at, pinned, closed, posters, synced_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
       ON CONFLICT(id) DO UPDATE SET
         category_id = excluded.category_id, slug = excluded.slug, title = excluded.title, excerpt = excluded.excerpt,
         posts_count = excluded.posts_count, reply_count = excluded.reply_count, views = excluded.views,
         created_at = excluded.created_at, last_posted_at = excluded.last_posted_at, pinned = excluded.pinned,
         closed = excluded.closed, posters = excluded.posters, synced_at = excluded.synced_at`
    );
    for (const row of rows) {
      statement.run(
        row.id,
        row.categoryId,
        row.slug,
        row.title,
        row.excerpt ?? null,
        row.posts ?? 0,
        row.replies ?? 0,
        row.views ?? 0,
        row.createdAt ?? null,
        row.lastPostedAt ?? null,
        row.pinned === true ? 1 : 0,
        row.closed === true ? 1 : 0,
        JSON.stringify(row.posters ?? []),
        at
      );
    }
  }

  /** One topic's posts, in the order the forum shows them. */
  forumPosts(topicId: number): ForumPostRow[] {
    const rows = this.db
      .prepare(
        'SELECT id, topic_id, post_number, username, name, created_at, cooked, reply_to, synced_at FROM forum_posts WHERE topic_id = ? ORDER BY post_number'
      )
      .all(topicId) as Record<string, unknown>[];
    return rows.map((row) => ({
      id: Number(row.id ?? 0),
      topicId: Number(row.topic_id ?? 0),
      postNumber: Number(row.post_number ?? 0),
      username: text(row.username),
      name: text(row.name),
      createdAt: text(row.created_at),
      cooked: text(row.cooked),
      replyTo: row.reply_to === null || row.reply_to === undefined ? undefined : Number(row.reply_to),
      syncedAt: text(row.synced_at),
    }));
  }

  /** A topic's posts, replaced whole: a read of a topic is a snapshot, not an accumulation. */
  saveForumPosts(topicId: number, rows: readonly ForumPostInput[]): void {
    const at = new Date().toISOString();
    const insert = this.db.prepare(
      `INSERT OR REPLACE INTO forum_posts (id, topic_id, post_number, username, name, created_at, cooked, reply_to, synced_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`
    );
    this.db.exec('BEGIN');
    try {
      this.db.prepare('DELETE FROM forum_posts WHERE topic_id = ?').run(topicId);
      for (const row of rows) {
        insert.run(row.id, topicId, row.postNumber, row.username ?? null, row.name ?? null, row.createdAt ?? null, row.cooked ?? null, row.replyTo ?? null, at);
      }
      this.db.exec('COMMIT');
    } catch (error) {
      this.db.exec('ROLLBACK');
      throw error;
    }
  }

  /** What was proposed for a topic, if anything was. */
  forumSuggestion(topicId: number): ForumSuggestionRow | undefined {
    const row = this.db
      .prepare('SELECT topic_id, page_id, page_title, text, source, at FROM forum_suggestions WHERE topic_id = ?')
      .get(topicId) as Record<string, unknown> | undefined;
    if (row === undefined) {
      return undefined;
    }
    return {
      topicId: Number(row.topic_id ?? 0),
      pageId: text(row.page_id),
      pageTitle: text(row.page_title),
      text: String(row.text ?? ''),
      source: String(row.source ?? 'match'),
      at: String(row.at ?? ''),
    };
  }

  saveForumSuggestion(input: ForumSuggestionInput): void {
    this.db
      .prepare(
        `INSERT INTO forum_suggestions (topic_id, page_id, page_title, text, source, at)
         VALUES (?, ?, ?, ?, ?, ?)
         ON CONFLICT(topic_id) DO UPDATE SET
           page_id = excluded.page_id, page_title = excluded.page_title, text = excluded.text,
           source = excluded.source, at = excluded.at`
      )
      .run(input.topicId, input.pageId ?? null, input.pageTitle ?? null, input.text, input.source, new Date().toISOString());
  }

  /** When the forum was last read, across categories and topics — the "read it again" line's own fact. */
  forumSyncedAt(): string | undefined {
    const row = this.db
      .prepare(
        `SELECT MAX(at) AS at FROM (
           SELECT MAX(synced_at) AS at FROM forum_categories
           UNION ALL SELECT MAX(synced_at) FROM forum_topics
         )`
      )
      .get() as { at?: unknown } | undefined;
    return text(row?.at);
  }

  /**
   * One row in `events`: what the platform noticed.
   *
   * Never allowed to fail a write — an event is a notification, and losing one is better than losing the thing it
   * was about.
   */
  private recordEvent(kind: string, detail: string): void {
    try {
      this.db
        .prepare('INSERT INTO events (at, kind, subject_kind, detail) VALUES (?, ?, ?, ?)')
        .run(new Date().toISOString(), kind, 'draft', detail);
    } catch {
      // Nothing to do: the event is a courtesy.
    }
  }

  /**
   * What an AI answer named, kept where it can be read again.
   *
   * One row per page cited, and never the question or the answer: a citation is a pointer, and the platform does not
   * keep conversations. Like an event, this is a courtesy — losing a citation must not fail the answer it belongs to.
   */
  recordCitations(input: CitationInput): void {
    if (input.citations.length === 0) {
      return;
    }
    try {
      const insert = this.db.prepare(
        `INSERT INTO ai_citations (at, answer_kind, document_slug, page_id, citation_id, citation_known)
         VALUES (?, ?, ?, ?, ?, ?)`
      );
      const at = new Date().toISOString();
      for (const citation of input.citations) {
        insert.run(at, input.answerKind, input.documentSlug ?? null, input.pageId ?? null, citation.id, citation.known ? 1 : 0);
      }
    } catch {
      // Nothing to do: the answer has already been given, and a missing footnote is not worth failing it over.
    }
  }

  /** The citations the AI has used, newest first — what a trust view reads. */
  citations(limit = 200): CitationRow[] {
    const rows = this.db
      .prepare(
        `SELECT id, at, answer_kind AS answerKind, document_slug AS documentSlug, page_id AS pageId,
                citation_id AS citationId, citation_known AS citationKnown
           FROM ai_citations ORDER BY at DESC, id DESC LIMIT ?`
      )
      .all(limit) as Record<string, unknown>[];
    return rows.map((row) => ({
      id: Number(row.id ?? 0),
      at: String(row.at ?? ''),
      answerKind: String(row.answerKind ?? ''),
      documentSlug: row.documentSlug === null || row.documentSlug === undefined ? undefined : String(row.documentSlug),
      pageId: row.pageId === null || row.pageId === undefined ? undefined : String(row.pageId),
      citationId: String(row.citationId ?? ''),
      citationKnown: Number(row.citationKnown ?? 0) === 1,
    }));
  }

  close(): void {
    this.db.close();
  }
}

/** What one answer named, as `recordCitations` writes it. */
export interface CitationInput {
  /** What produced the citation: `answer` in the panel, `topic` for a forum thread, `draft` for a page draft. */
  answerKind: string;
  /** The project the answer was about, when one is selected. */
  documentSlug?: string;
  /** The page the question was about, when there was one. */
  pageId?: string;
  /** The ids the answer named, and whether a registry knows each of them. */
  citations: readonly { id: string; known: boolean }[];
}

/** One citation, as `citations()` reads it. */
export interface CitationRow {
  id: number;
  at: string;
  answerKind: string;
  documentSlug?: string;
  pageId?: string;
  citationId: string;
  /** Whether a registry knew the page when the answer was given. */
  citationKnown: boolean;
}

/** What `createDocument` needs. An empty slug is refused by the caller, not here. */
export interface DocumentInput {
  name: string;
  slug: string;
  version?: string;
  audience?: string;
  owner?: string;
  /** How the project began. Defaults to `blank`. */
  origin?: string;
  /** The starter the project's files were written from, when there was one. */
  template?: string;
}

/** A body that was drafted but not written. */
export interface DraftInput {
  documentSlug: string;
  /** The page id the page will have: `area/chapter/slug`. */
  pageId: string;
  title: string;
  kind?: string;
  body: string;
  /** The source the draft read, when it read one. */
  source?: string;
}

/** One thing the platform noticed. */
export interface EventRow {
  id: number;
  at: string;
  kind: string;
  detail?: string;
  seenAt?: string;
}

/** A release: what was published, where it went, and when. */
export interface ReleaseRow {
  id: number;
  buildId?: number;
  version: string;
  destination: string;
  files: number;
  publishedAt: string;
}

/** One read of one source, as the repository page lists it. */
export interface ScanRow {
  id: number;
  at: string;
  mode: string;
  revision?: string;
  /** The counts the read reported, as JSON — left as it was written rather than reinterpreted here. */
  counts?: string;
}

/** A build as the Build Center reads it. */
export interface BuildRow {
  id: number;
  startedAt: string;
  finishedAt?: string;
  status: string;
  revision?: string;
}

/** A draft as the Review Center reads it. */
export interface DraftRow {
  id: number;
  documentSlug: string;
  source?: string;
  pageId: string;
  title: string;
  kind: string;
  body: string;
  createdAt: string;
  state: 'draft' | 'accepted' | 'discarded';
}

function draftRow(row: Record<string, unknown>): DraftRow {
  return {
    id: Number(row.id ?? 0),
    documentSlug: String(row.document_slug ?? ''),
    source: row.source === null || row.source === undefined ? undefined : String(row.source),
    pageId: String(row.page_id ?? ''),
    title: String(row.title ?? ''),
    kind: String(row.kind ?? ''),
    body: String(row.body ?? ''),
    createdAt: String(row.created_at ?? ''),
    state: (String(row.state ?? 'draft') as DraftRow['state']),
  };
}

/** A document as the edit page sees it. */
export interface DocumentDetail {
  name: string;
  version?: string;
  audience?: string;
  owner?: string;
  /** How the project began — `blank`, `template`, `folder`, `repository` or `import`. */
  origin?: string;
  /** The starter it was written from, when it was written from one. */
  template?: string;
  engine?: string;
  outputs: string[];
  sources: { name: string; kind: string; branch?: string }[];
}

/** A source's coordinates, as a read needs them. */
export interface SourceDetail {
  id: number;
  kind: 'git' | 'folder' | 'archive';
  name: string;
  remoteUrl?: string;
  path?: string;
  branch?: string;
  defaultBranch?: string;
  docsRoot?: string;
  registryPath?: string;
  /** When this source was last read: what the dashboard measures "since" against. */
  lastRead?: string;
}

/** A page as a read found it — enough for a tree, and nothing invented. */
export interface PageInput {
  id: string;
  path?: string;
  title?: string;
  owner?: string;
  counts?: Record<string, number>;
}

/** A page as a tree reads it back. */
export interface PageRow {
  id: string;
  path?: string;
  title?: string;
  owner?: string;
}

/** What `addSource` needs. Everything optional is genuinely optional: a folder has no branch. */
export interface SourceInput {
  kind: 'git' | 'folder' | 'archive';
  name: string;
  slug: string;
  remoteUrl?: string;
  path?: string;
  defaultBranch?: string;
  branch?: string;
  docsRoot?: string;
  registryPath?: string;
}

/** A row of the Documents page. */
export interface DocumentRow {  /** The name the database keys it by — what a selection, a draft and a build all point at. */
  slug: string; name: string;
  version?: string;
  /** How the project began — `blank`, `template`, `folder`, `repository` or `import`. */
  origin?: string;
  sources: number;
  builtAt?: string;
}

/** A row of the Sources page. */
export interface SourceRow {
  id: number;
  slug: string;
  name: string;
  kind: string;
  branch?: string;
  pages?: number;
  /** What the last read concluded, in one line. */
  state?: string;
  /** When the last read happened — the watermark anything newer is measured against. */
  lastRead?: string;
  lastReadMode?: string;
}

/** Where repositories come from: an organisation, a personal account, or one repository's address. */
export type OrganisationKind = 'organisation' | 'account' | 'repository';

/** What `addOrganisation` needs. */
export interface OrganisationInput {
  kind: OrganisationKind;
  name: string;
  slug: string;
  url?: string;
}

/** An organisation as the Repositories page lists it, with the size of its cached list. */
export interface OrganisationRow {
  id: number;
  kind: string;
  name: string;
  slug: string;
  url?: string;
  /** When its repositories were last read, and what that read concluded. */
  lastRead?: string;
  state?: string;
  repositories: number;
}

/** One repository as the cache holds it — the facts a row shows, and the two addresses an action needs. */
export interface RepositoryCacheRow {
  name: string;
  fullName: string;
  description?: string;
  language?: string;
  pushedAt?: string;
  isPrivate: boolean;
  webUrl?: string;
  cloneUrl?: string;
  defaultBranch?: string;
}

/** The database file for a storage folder, whether or not it exists yet — used for reporting and for a click. */
export function catalogFileUri(context: vscode.ExtensionContext): vscode.Uri {
  return vscode.Uri.joinPath(context.globalStorageUri, 'catalog', CATALOG_FILE);
}

/** A nullable column as a string, or nothing. */
function text(value: unknown): string | undefined {
  return value === null || value === undefined ? undefined : String(value);
}

/** The posters a topic list carried. A malformed value reads as "nobody", never as an error. */
function postersOf(value: unknown): ForumPoster[] {
  if (typeof value !== 'string' || value.length === 0) {
    return [];
  }
  try {
    const parsed = JSON.parse(value) as unknown;
    if (!Array.isArray(parsed)) {
      return [];
    }
    return parsed
      .filter((entry): entry is { username?: unknown; name?: unknown } => entry !== null && typeof entry === 'object')
      .map((entry) => ({ username: String(entry.username ?? ''), name: text(entry.name) }))
      .filter((poster) => poster.username.length > 0);
  } catch {
    return [];
  }
}

/** One person who posted in a topic, as a list row names them. */
export interface ForumPoster {
  username: string;
  name?: string;
}

/** A forum category, as the site lists it. */
export interface ForumCategoryRow {
  id: number;
  slug: string;
  name: string;
  color?: string;
  parentId?: number;
  topics: number;
  posts: number;
  syncedAt?: string;
}

/** What a sync writes for a category. */
export interface ForumCategoryInput {
  id: number;
  slug: string;
  name: string;
  color?: string;
  parentId?: number;
  topics?: number;
  posts?: number;
  /** Where the site puts it in its own list. */
  position?: number;
}

/** A topic as the list shows it: the four figures the forum's own table has, and who is in it. */
export interface ForumTopicRow {
  id: number;
  categoryId: number;
  slug: string;
  title: string;
  excerpt?: string;
  posts: number;
  replies: number;
  views: number;
  createdAt?: string;
  lastPostedAt?: string;
  pinned: boolean;
  closed: boolean;
  posters: ForumPoster[];
  syncedAt?: string;
}

/** What a sync writes for a topic. */
export interface ForumTopicInput {
  id: number;
  categoryId: number;
  slug: string;
  title: string;
  excerpt?: string;
  posts?: number;
  replies?: number;
  views?: number;
  createdAt?: string;
  lastPostedAt?: string;
  pinned?: boolean;
  closed?: boolean;
  posters?: ForumPoster[];
}

/** One post — the discussion history a topic page reads. */
export interface ForumPostRow {
  id: number;
  topicId: number;
  postNumber: number;
  username?: string;
  name?: string;
  createdAt?: string;
  /** The forum's own HTML for the post. */
  cooked?: string;
  /** The post this one answered, when it answered one. */
  replyTo?: number;
  syncedAt?: string;
}

/** What a sync writes for one post. */
export interface ForumPostInput {
  id: number;
  postNumber: number;
  username?: string;
  name?: string;
  createdAt?: string;
  cooked?: string;
  replyTo?: number;
}

/** What the platform proposes for a topic: the page, and the sentence a triager reads. */
export interface ForumSuggestionRow {
  topicId: number;
  pageId?: string;
  pageTitle?: string;
  text: string;
  /** `match` for what the registry alone can say, `ai` for an answer the model wrote. */
  source: string;
  at: string;
}

export interface ForumSuggestionInput {
  topicId: number;
  pageId?: string;
  pageTitle?: string;
  text: string;
  source: string;
}
