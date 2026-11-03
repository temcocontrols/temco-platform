// The catalog's shape.
//
// Versioned, because the platform's memory outlives any one build of it: a schema bump is a migration, and a
// database written by a newer version is refused in words rather than half-read.
//
// One table per idea — see `docs/temco-platform/catalog.md`. Nothing here is derived at read time from the network:
// a row is written by a scan and read by a view.

export const SCHEMA_VERSION = 7;

/**
 * Every statement is `IF NOT EXISTS`, so applying the schema is idempotent — it is how an older database is
 * brought forward, not only how a new one is created.
 */
export const SCHEMA = `
CREATE TABLE IF NOT EXISTS meta (
  key   TEXT PRIMARY KEY,
  value TEXT NOT NULL
);

-- Where repositories come from: an organisation, a personal account, or one repository named by its address.
-- The default organisation is written on first use, so the list is never empty and nothing has to be typed first.
CREATE TABLE IF NOT EXISTS organisations (
  id        INTEGER PRIMARY KEY,
  kind      TEXT NOT NULL CHECK (kind IN ('organisation', 'account', 'repository')),
  name      TEXT NOT NULL,
  slug      TEXT NOT NULL UNIQUE,
  url       TEXT,
  added_at  TEXT NOT NULL,
  last_read TEXT,
  state     TEXT
);

-- The repositories an enterprise holds, as GitHub last gave them: a child table, replaced whole on every good
-- read and kept when a read is refused. A cache, not the truth about a repository — the truth is the source.
CREATE TABLE IF NOT EXISTS repositories (
  org_id         INTEGER NOT NULL REFERENCES organisations(id) ON DELETE CASCADE,
  name           TEXT NOT NULL,
  full_name      TEXT NOT NULL,
  description    TEXT,
  language       TEXT,
  pushed_at      TEXT,
  is_private     INTEGER NOT NULL DEFAULT 0,
  web_url        TEXT,
  clone_url      TEXT,
  default_branch TEXT,
  taken_at       TEXT NOT NULL,
  PRIMARY KEY (org_id, name)
);
CREATE INDEX IF NOT EXISTS repositories_by_push ON repositories (org_id, pushed_at DESC);

-- Where content comes from: a git remote at a chosen branch, a local folder, or a read-only archive.
CREATE TABLE IF NOT EXISTS sources (
  id             INTEGER PRIMARY KEY,
  kind           TEXT NOT NULL CHECK (kind IN ('git', 'folder', 'archive')),
  name           TEXT NOT NULL,
  slug           TEXT NOT NULL UNIQUE,
  remote_url     TEXT,
  path           TEXT,
  default_branch TEXT,
  branch         TEXT,
  registry_path  TEXT,
  docs_root      TEXT,
  pages          INTEGER,
  state          TEXT,
  last_read      TEXT,
  last_read_mode TEXT,
  last_commit    TEXT,
  last_commit_at TEXT,
  added_at       TEXT NOT NULL
);

-- What a person creates and versions: the unit of management, not a repository.
-- "origin" is how the project began — blank, template, folder, repository or import — and it is written once:
-- editing a project never re-answers where it came from. "template" names the starter it was written from.
CREATE TABLE IF NOT EXISTS documents (
  id         INTEGER PRIMARY KEY,
  name       TEXT NOT NULL,
  slug       TEXT NOT NULL UNIQUE,
  version    TEXT,
  audience   TEXT,
  owner      TEXT,
  origin     TEXT NOT NULL DEFAULT 'blank',
  template   TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

-- A document cites sources, each with its own branch and role. Many-to-many, on purpose.
CREATE TABLE IF NOT EXISTS doc_sources (
  document_id  INTEGER NOT NULL REFERENCES documents(id) ON DELETE CASCADE,
  source_id    INTEGER NOT NULL REFERENCES sources(id) ON DELETE CASCADE,
  branch       TEXT,
  include_glob TEXT,
  role         TEXT NOT NULL DEFAULT 'primary',
  PRIMARY KEY (document_id, source_id)
);

-- How a document is built. One row per document: the engine, its config, and the outputs it must produce.
CREATE TABLE IF NOT EXISTS recipes (
  document_id INTEGER PRIMARY KEY REFERENCES documents(id) ON DELETE CASCADE,
  engine      TEXT NOT NULL,
  config_path TEXT,
  script      TEXT,
  outputs     TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS builds (
  id          INTEGER PRIMARY KEY,
  document_id INTEGER NOT NULL REFERENCES documents(id) ON DELETE CASCADE,
  started_at  TEXT NOT NULL,
  finished_at TEXT,
  status      TEXT NOT NULL,
  revision    TEXT,
  log_path    TEXT
);

-- What a build left behind. Success is an artifact that did not exist before, never an exit code.
CREATE TABLE IF NOT EXISTS artifacts (
  id          INTEGER PRIMARY KEY,
  build_id    INTEGER REFERENCES builds(id) ON DELETE SET NULL,
  document_id INTEGER REFERENCES documents(id) ON DELETE CASCADE,
  kind        TEXT NOT NULL,
  path        TEXT NOT NULL,
  bytes       INTEGER,
  sha256      TEXT,
  built_at    TEXT NOT NULL
);

-- Summarised once, readable offline: the model and the time are recorded so a summary is never recomputed.
CREATE TABLE IF NOT EXISTS commits (
  sha           TEXT NOT NULL,
  source_id     INTEGER NOT NULL REFERENCES sources(id) ON DELETE CASCADE,
  at            TEXT,
  author        TEXT,
  subject       TEXT,
  summary       TEXT,
  summary_model TEXT,
  summarised_at TEXT,
  PRIMARY KEY (sha, source_id)
);

CREATE TABLE IF NOT EXISTS commit_pages (
  sha     TEXT NOT NULL,
  source_id INTEGER NOT NULL,
  page_id TEXT NOT NULL,
  how     TEXT NOT NULL CHECK (how IN ('code-glob', 'path', 'terms')),
  PRIMARY KEY (sha, source_id, page_id)
);

CREATE TABLE IF NOT EXISTS pages (
  id          TEXT NOT NULL,
  document_id INTEGER REFERENCES documents(id) ON DELETE CASCADE,
  source_id   INTEGER REFERENCES sources(id) ON DELETE CASCADE,
  path        TEXT,
  title       TEXT,
  owner       TEXT,
  reviewed_at TEXT,
  stale       INTEGER,
  counts      TEXT,
  PRIMARY KEY (id, document_id)
);

CREATE TABLE IF NOT EXISTS scans (
  id        INTEGER PRIMARY KEY,
  source_id INTEGER NOT NULL REFERENCES sources(id) ON DELETE CASCADE,
  at        TEXT NOT NULL,
  mode      TEXT NOT NULL,
  revision  TEXT,
  counts    TEXT
);

-- What the platform noticed, and whether it has been shown. seen_at is what stops a fact being announced twice.
CREATE TABLE IF NOT EXISTS events (
  id           INTEGER PRIMARY KEY,
  at           TEXT NOT NULL,
  kind         TEXT NOT NULL,
  subject_kind TEXT,
  subject_id   INTEGER,
  detail       TEXT,
  seen_at      TEXT
);

-- A body that was drafted but not written. The text lives here, not in a file, because a draft is a proposal:
-- accepting it writes the page and marks the row accepted, rejecting it marks it discarded, and neither is undo-able
-- in the documentation itself. page_id is the id the page will have (area/chapter/slug); it is what makes two
-- drafts for one page recognisable.
CREATE TABLE IF NOT EXISTS drafts (
  id            INTEGER PRIMARY KEY,
  document_slug TEXT NOT NULL,
  source        TEXT,
  page_id       TEXT NOT NULL,
  title         TEXT NOT NULL,
  kind          TEXT,
  body          TEXT NOT NULL,
  created_at    TEXT NOT NULL,
  state         TEXT NOT NULL DEFAULT 'draft'
);

CREATE INDEX IF NOT EXISTS drafts_by_document ON drafts (document_slug, state, created_at DESC);

-- A release is a build that was handed to a reader: the artifacts it carries, where they were put, and when.
-- The files are not copied into the database — a release row is the decision plus the destination it points at,
-- which is what makes republishing a new version a new row rather than an edit of an old one.
CREATE TABLE IF NOT EXISTS releases (
  id           INTEGER PRIMARY KEY,
  document_id  INTEGER NOT NULL REFERENCES documents(id) ON DELETE CASCADE,
  build_id     INTEGER REFERENCES builds(id) ON DELETE SET NULL,
  version      TEXT NOT NULL,
  destination  TEXT NOT NULL,
  files        INTEGER NOT NULL DEFAULT 0,
  published_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS releases_by_document ON releases (document_id, published_at DESC);

-- The forum, as the platform last read it (Discourse): the categories a person can browse, the topics in each, the
-- posts of a topic, and what was decided about one. Written by a sync and read by a view — a topic row is a cache of
-- the forum, never the truth about it, and the community site stays the only place anything is posted.
CREATE TABLE IF NOT EXISTS forum_categories (
  id         INTEGER PRIMARY KEY,
  slug       TEXT NOT NULL,
  name       TEXT NOT NULL,
  color      TEXT,
  parent_id  INTEGER,
  topics     INTEGER NOT NULL DEFAULT 0,
  posts      INTEGER NOT NULL DEFAULT 0,
  position   INTEGER NOT NULL DEFAULT 0,
  synced_at  TEXT
);

CREATE TABLE IF NOT EXISTS forum_topics (
  id             INTEGER PRIMARY KEY,
  category_id    INTEGER NOT NULL,
  slug           TEXT NOT NULL,
  title          TEXT NOT NULL,
  excerpt        TEXT,
  posts_count    INTEGER NOT NULL DEFAULT 0,
  reply_count    INTEGER NOT NULL DEFAULT 0,
  views          INTEGER NOT NULL DEFAULT 0,
  created_at     TEXT,
  last_posted_at TEXT,
  pinned         INTEGER NOT NULL DEFAULT 0,
  closed         INTEGER NOT NULL DEFAULT 0,
  posters        TEXT,
  synced_at      TEXT
);
CREATE INDEX IF NOT EXISTS forum_topics_by_category ON forum_topics (category_id, pinned DESC, last_posted_at DESC);

CREATE TABLE IF NOT EXISTS forum_posts (
  id          INTEGER PRIMARY KEY,
  topic_id    INTEGER NOT NULL REFERENCES forum_topics(id) ON DELETE CASCADE,
  post_number INTEGER NOT NULL,
  username    TEXT,
  name        TEXT,
  created_at  TEXT,
  cooked      TEXT,
  reply_to    INTEGER,
  synced_at   TEXT
);
CREATE INDEX IF NOT EXISTS forum_posts_by_topic ON forum_posts (topic_id, post_number);

-- What the platform proposes for a topic: the page it is about and the sentence a triager reads. The source column
-- says who wrote it: 'match' for what the registry alone can say, 'ai' for an answer the model gave.
CREATE TABLE IF NOT EXISTS forum_suggestions (
  topic_id   INTEGER PRIMARY KEY REFERENCES forum_topics(id) ON DELETE CASCADE,
  page_id    TEXT,
  page_title TEXT,
  text       TEXT NOT NULL,
  source     TEXT NOT NULL,
  at         TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS events_unseen ON events (seen_at, at DESC);
CREATE INDEX IF NOT EXISTS commits_by_source ON commits (source_id, at DESC);
CREATE INDEX IF NOT EXISTS artifacts_by_document ON artifacts (document_id, built_at DESC);
CREATE INDEX IF NOT EXISTS builds_by_document ON builds (document_id, started_at DESC);

-- What an AI answer named, one row per page it cited. The rows are the answer's own footnotes kept where they can
-- be read again: a page a draft or an answer relied on, when, and whether the registry still knows it. The
-- question and the answer text are deliberately *not* here — a citation is a pointer, and the platform does not
-- keep conversations.
CREATE TABLE IF NOT EXISTS ai_citations (
  id             INTEGER PRIMARY KEY,
  at             TEXT NOT NULL,
  answer_kind    TEXT NOT NULL,
  document_slug  TEXT,
  page_id        TEXT,
  citation_id    TEXT NOT NULL,
  citation_known INTEGER NOT NULL DEFAULT 0
);
CREATE INDEX IF NOT EXISTS ai_citations_by_at ON ai_citations (at DESC);
`;

/**
 * What a database written by an earlier schema needs before this build can read it.
 *
 * `CREATE TABLE IF NOT EXISTS` above does nothing to a table that is already there, so a new column is an
 * `ALTER TABLE` applied once per version step, in order, by `Catalog.open`. Keyed by the version the step leads
 * to: `MIGRATIONS[4]` is what a schema 3 file needs to become a schema 4 file.
 */
export const MIGRATIONS: Readonly<Record<number, readonly string[]>> = {
  4: [
    "ALTER TABLE documents ADD COLUMN origin TEXT NOT NULL DEFAULT 'blank'",
    'ALTER TABLE documents ADD COLUMN template TEXT',
  ],
  // The list was one JSON blob per organisation for one turn of this build; a table per idea replaces it, so the
  // blob goes rather than being migrated — it held nothing that a read cannot fetch again.
  6: ['DROP TABLE IF EXISTS repo_lists'],
  // A new table only: `CREATE TABLE IF NOT EXISTS` above already wrote it into an older file, so the step has
  // nothing left to do and is recorded so the version says what the file carries.
  7: [],
};
