// One repository, as a page: what it is, what the platform already holds of it, and what is inside it.
//
// The dashboard lists an enterprise's repositories; this is what a row opens. It answers the three questions a row
// cannot — is this already a source, is there a local copy to read files and history from, and **what files are in
// it** — and it is where a project actually starts: pick files here, then create a project from them.
//
// Nothing is written to a repository. "Fetch the local copy" clones one branch into the working area, which is what
// lets the file list and the material for a draft be read from disk rather than from the API; without a copy the
// same list is read over the API, which is slower and spends GitHub's allowance.

import * as vscode from 'vscode';
import { sourceTree, CodeFile, RepositorySource } from './repository';
import { Catalog, RepositoryCacheRow, Selection, slugOf } from './store';
import { FileIconTheme, loadFileIconTheme } from './fileIcons';
import { WorkAct, WorkReporter, WorkState } from './workReporter';
import { commandScript, hero, page, pageColumn, remember } from './ui';
import { cloneFolder, cloneRoot, cloneSize, hasClone, projectFor } from './workarea';

export const REPOSITORY_DETAIL_VIEW_TYPE = 'temcoRepositories.repositoryDetail';

interface DetailMessage {
  type?: string;
  url?: string;
  text?: string;
  files?: string[];
  /** The file a row asked to open. */
  path?: string;
  /** A command a control named, so a refusal can be answered where it is read. */
  command?: string;
  /** The page's script is listening: anything queued for it can be sent now. */
  ready?: boolean;
}

/** What the page is told once, and again after every act: the row, its state in this window, and the project. */
interface DetailState {
  name: string;
  organisation?: string;
  row?: RepositoryCacheRow;
  isSource: boolean;
  branch?: string;
  localCopy: boolean;
  copySize?: string;
  cited: boolean;
  project?: string;
  /** Where a clone would land — the page names the folder rather than saying "the working area". */
  where?: string;
  /** The repository's `owner/name`: what the side bar's tree calls it. */
  fullName?: string;
  error?: string;
}

export class RepositoryDetailPage {
  private panel: vscode.WebviewPanel | undefined;
  private name = '';
  private organisation: string | undefined;

  constructor(
    private readonly context: vscode.ExtensionContext,
    private readonly selection: Selection,
    private readonly output: vscode.OutputChannel,
    private readonly refresh: () => void,
    private readonly work: WorkReporter
  ) {
    // Only this page hears about this repository's acts: a state line and the lines git prints, both straight into the
    // console the page draws.
    this.reports.push(
      this.work.onDidState((event) => {
        if (event.slug === slugOf(this.name)) {
          void this.panel?.webview.postMessage({ type: 'work', work: event });
        }
      }),
      this.work.onDidLine((event) => {
        if (event.slug === slugOf(this.name)) {
          void this.panel?.webview.postMessage({ type: 'log', text: event.text });
        }
      })
    );
  }

  private readonly reports: vscode.Disposable[] = [];
  /** An act the page was opened to perform — `Clone it` on a dashboard row arrives this way. */
  private pending: WorkAct | undefined;

  /** The file icon theme, read once per render: what a row's glyph is drawn from. */
  private theme: FileIconTheme | undefined;
  /** The repository's `owner/name`, which is the id the side bar's tree knows it by. */
  private fullName: string | undefined;

  /**
   * Opens this repository and performs one act in it — what a dashboard row's `Clone it` and `Pull` mean.
   *
   * The act is not run from the dashboard: a clone explains itself in lines, and those lines belong on the page about
   * the repository. The page asks for the work when its script is ready (`ready`), so nothing is posted into a webview
   * that is not listening yet.
   *
   * The name a caller has may be the row's **name** (`Solar-Powered-Lora-Sensor`) or its **slug**
   * (`solar-powered-lora-sensor`) — a list keys sources by slug and lists repositories by name. Both resolve to the
   * repository a person means before the page opens.
   */
  async openAndRun(nameOrSlug: string, act: WorkAct, organisation?: string): Promise<void> {
    const name = await this.resolveName(nameOrSlug);
    this.pending = act;
    this.open(name, organisation);
  }

  /** A repository's name, whichever of its two keys a command was handed. */
  private async resolveName(nameOrSlug: string): Promise<string> {
    let catalog: Catalog | undefined;
    try {
      catalog = await Catalog.open(this.context);
      for (const row of catalog.sources()) {
        if (row.slug === slugOf(nameOrSlug)) {
          return row.name;
        }
      }
      for (const org of catalog.organisations()) {
        const found = catalog.repositoriesOf(org.slug).find((repository) => repository.name === nameOrSlug);
        if (found !== undefined) {
          return found.name;
        }
      }
    } catch {
      // No catalog: the name is used as it came.
    } finally {
    	catalog?.close();
    }
    return nameOrSlug;
  }

  open(name: string, organisation?: string, restored?: vscode.WebviewPanel): void {
    remember(this.context, REPOSITORY_DETAIL_VIEW_TYPE, name);
    this.name = name;
    this.organisation = organisation;
    if (this.panel) {
      this.panel.title = name;
      this.panel.reveal(pageColumn());
      void this.render();
      return;
    }
    // A restored tab is drawn into rather than replaced: it keeps its place in the strip.
    this.panel = restored ?? vscode.window.createWebviewPanel(REPOSITORY_DETAIL_VIEW_TYPE, name, pageColumn(), {
      enableScripts: true,
      localResourceRoots: [],
    });
    this.panel.webview.options = { enableScripts: true, localResourceRoots: [] };
    this.panel.onDidDispose(() => {
      this.panel = undefined;
    });
    this.panel.webview.onDidReceiveMessage((message: DetailMessage) => void this.receive(message));
    void this.render();
  }

  dispose(): void {
    for (const report of this.reports) {
      report.dispose();
    }
    this.panel?.dispose();
  }

  private async render(): Promise<void> {
    const panel = this.panel;
    if (!panel) {
      return;
    }
    // The glyphs are the user's file icon theme, loaded into this page: the font is a file on disk, so the page is
    // told where it may read from before the document is written.
    this.theme = await loadFileIconTheme(panel.webview);
    panel.webview.options = {
      enableScripts: true,
      localResourceRoots: this.theme === undefined ? [] : [vscode.Uri.file(this.theme.folder)],
    };
    panel.webview.html = html(
      this.name,
      this.theme,
      panel.webview.cspSource,
      await this.facts(),
      this.work.lastFor(slugOf(this.name))
    );
    // No `send()` here: the page asks for its facts when its script is listening (`ready`). Posting into a webview that
    // has not run its script yet is a message nobody receives, which is why this page used to sit on "Reading the file
    // list…" for ever.
  }

  /** What the header says before the page has heard from the module: the org and the description. */
  private async facts(): Promise<PageFacts> {
    let catalog: Catalog | undefined;
    try {
      catalog = await Catalog.open(this.context);
      const organisations = catalog.organisations();
      const org = organisations.find((candidate) => candidate.slug === this.organisation)
        ?? organisations.find((candidate) => catalog?.repositoriesOf(candidate.slug).some((row) => row.name === this.name));
      const row = org === undefined ? undefined : catalog.repositoriesOf(org.slug).find((entry) => entry.name === this.name);
      return {
        organisation: org?.slug,
        description: row?.description,
        localCopy: await hasClone(this.name),
      };
    } catch {
      return { localCopy: false };
    } finally {
      catalog?.close();
    }
  }

  /** The row, the source and the local copy — one message, so the page never draws half a repository. */
  private async send(): Promise<void> {
    const panel = this.panel;
    if (!panel) {
      return;
    }
    const project = this.selection.project();
    const state: DetailState = { name: this.name, isSource: false, localCopy: false, cited: false, project, where: cloneRoot() };

    let catalog: Catalog | undefined;
    try {
      catalog = await Catalog.open(this.context);
      const organisations = catalog.organisations();
      const org =
        organisations.find((candidate) => candidate.slug === this.organisation) ??
        organisations.find((candidate) => catalog?.repositoriesOf(candidate.slug).some((row) => row.name === this.name));
      state.organisation = org?.slug;
      state.row = org === undefined ? undefined : catalog.repositoriesOf(org.slug).find((row) => row.name === this.name);
      this.fullName = state.row?.fullName ?? (org === undefined ? undefined : `${org.slug}/${this.name}`);
      state.fullName = this.fullName;
      const source = catalog.source(slugOf(this.name));
      state.isSource = source !== undefined;
      state.branch = source?.branch;
      if (project !== undefined) {
        state.cited = catalog.documentSources(project).some((row) => row.name === this.name);
      }
      // A copy belongs to the repository, not to the project on screen: two projects that cite this one read the
      // same clone.
      state.localCopy = await hasClone(this.name);
      state.copySize = state.localCopy ? (await cloneSize(this.name)) ?? '' : undefined;
    } catch (error) {
      state.error = error instanceof Error ? error.message : String(error);
    } finally {
      catalog?.close();
    }

    await panel.webview.postMessage({ type: 'state', ...state });
  }

  /**
   * What the page says about the repository's contents — a summary, not a browser.
   *
   * The tree lives in the side bar, where a tree belongs; this page answers "how much is in here, what is at the top,
   * and what is big" and offers the one way in: reveal the repository in the panel. That keeps the page a page.
   */
  private async sendSummary(): Promise<void> {
    const panel = this.panel;
    if (!panel) {
      return;
    }
    const source = await this.sourceOf();
    if (source === undefined) {
      await panel.webview.postMessage({ type: 'summary', error: 'This repository is no longer listed by any organisation.' });
      return;
    }
    const listed = await sourceTree(this.context, source);
    if ('error' in listed) {
      // A listing that was read before is worth more than an error about the allowance: it is kept, with the date it
      // was taken and the reason it could not be refreshed.
      const kept = this.context.workspaceState.get<KeptListing>(`temco.repositories.listing.${slugOf(this.name)}`);
      if (kept !== undefined) {
        const summary = summarise(kept.files, kept.source);
        await panel.webview.postMessage({
          type: 'summary',
          ...summary,
          note: `saved from ${new Date(kept.at).toLocaleString()} · ${listed.error}`,
          fullName: this.fullName,
          stale: true,
        });
        return;
      }
      await panel.webview.postMessage({ type: 'summary', error: listed.error });
      return;
    }
    // Kept for the next reading: a rate limit, a network that is down, or a repository deleted from under us all leave
    // the last good answer usable, which is the local memory this page has.
    await this.context.workspaceState.update(
      `temco.repositories.listing.${slugOf(this.name)}`,
      { files: listed.files, at: Date.now(), source: source.path === undefined ? 'github' : 'clone' } satisfies KeptListing
    );
    const copy = await hasClone(this.name);
    const summary = summarise(listed.files, copy ? 'clone' : 'github');
    await panel.webview.postMessage({
      type: 'summary',
      ...summary,
      note: listed.note,
      fullName: this.fullName,
    });
  }

  /** Where this repository's files can be read from — the copy when there is one, the row when there is not. */
  private async sourceOf(): Promise<RepositorySource | undefined> {
    let catalog: Catalog | undefined;
    try {
      catalog = await Catalog.open(this.context);
      const record = catalog.source(slugOf(this.name));
      const org = catalog.organisations().find((candidate) => candidate.slug === this.organisation) ??
        catalog.organisations().find((candidate) => catalog?.repositoriesOf(candidate.slug).some((row) => row.name === this.name));
      const row = org === undefined ? undefined : catalog.repositoriesOf(org.slug).find((entry) => entry.name === this.name);
      if (record === undefined && row === undefined) {
        return undefined;
      }
      // A clone on the disk is the truth about where the files are, even when the catalog has forgotten the path — which
      // older builds did on every re-record. Reading the copy instead of the API is the whole reason a clone exists, so
      // the path is repaired here and kept.
      let fixed = record?.path;
      if (await hasClone(this.name)) {
        const onDisk = cloneFolder(this.name);
        if (fixed === undefined || fixed !== onDisk) {
          fixed = onDisk;
          if (record !== undefined) {
            catalog.setSourcePath(slugOf(this.name), onDisk);
          }
        }
      }
      return {
        name: this.name,
        path: fixed,
        remoteUrl: record?.remoteUrl ?? row?.cloneUrl,
        branch: record?.branch,
        defaultBranch: record?.defaultBranch ?? row?.defaultBranch,
      };
    } catch {
      return undefined;
    } finally {
      catalog?.close();
    }
  }

  private async receive(message: DetailMessage): Promise<void> {
    switch (message.type) {
      case 'ready': {
        // The page is listening: this is the **first** moment a message can reach it, so the facts are sent here rather
        // than straight after the HTML is set — a message posted before the script runs is a message nobody receives.
        // An act that came with the page (a dashboard row's Clone it) runs now, with its output in front of the person.
        const pending = this.pending;
        this.pending = undefined;
        if (pending === 'clone') {
          await this.runAct('fetch');
          return;
        }
        if (pending === 'pull') {
          await this.runAct('pull');
          return;
        }
        await this.send();
        return;
      }
      case 'state':
        await this.send();
        return;
      case 'files':
        await this.sendSummary();
        return;
      case 'reveal':
        // The side bar is where a tree belongs: focus the panel and select this repository in it. The name is the
        // fallback when the row has not been read yet — the command resolves a name as readily as a `owner/name`.
        await vscode.commands.executeCommand('temcoRepositories.revealInTree', this.fullName ?? this.name);
        return;
      case 'open':
        if (message.url !== undefined) {
          await vscode.env.openExternal(vscode.Uri.parse(message.url));
        }
        return;
      case 'copy':
        if (message.text !== undefined) {
          await vscode.env.clipboard.writeText(message.text);
          void vscode.window.showInformationMessage(`Temco Repositories: ${message.text} is on the clipboard.`);
        }
        return;
      case 'fetch':
        await this.runAct('fetch');
        return;
      case 'pull':
        await this.runAct('pull');
        return;
      case 'removeClone':
        await vscode.commands.executeCommand('temcoRepositories.removeClone', slugOf(this.name));
        this.refresh();
        await this.send();
        return;
      case 'start':
        await this.start();
        await this.send();
        return;
      case 'openFile':
        // The same opener the panel uses: the clone's copy when there is one, GitHub when there is not.
        if (typeof message.path === 'string' && message.path.length > 0) {
          await vscode.commands.executeCommand('temcoRepositories.openRepositoryFile', this.name, message.path);
        }
        return;
      case 'project': {
        const coordinates = await this.coordinates();
        try {
          await vscode.commands.executeCommand(
            'temcoProjects.newProjectFromRepository',
            coordinates.name,
            coordinates.cloneUrl,
            coordinates.branch,
            message.files ?? []
          );
        } catch {
          void vscode.window.showInformationMessage(
            'Temco Repositories: the projects module is not installed, so there is nothing to create a project with.'
          );
        }
        return;
      }
      case 'command':
        // A command the page asks for by id — the token prompt, so a refusal can be answered where it is read.
        if (typeof (message as { command?: string }).command === 'string') {
          await vscode.commands.executeCommand((message as { command?: string }).command as string);
          await this.send();
        }
        return;
      default:
        return;
    }
  }

  /**
   * The two long acts, run from this page.
   *
   * A clone needs the source recorded first — the catalog is what a copy is attached to — but not a project and not a
   * citation. Both acts report into the page through the reporter, and the page redraws its own facts afterwards
   * because a copy that arrived changes what it can do.
   */
  private async runAct(act: 'fetch' | 'pull'): Promise<void> {
    if (act === 'fetch') {
      await this.record();
      await vscode.commands.executeCommand('temcoRepositories.fetchSource', slugOf(this.name));
    } else {
      await vscode.commands.executeCommand('temcoRepositories.pullSource', slugOf(this.name));
    }
    this.refresh();
    await this.send();
    await this.sendSummary();
  }

  /** The row's own facts, as the projects module needs them to open pinned to this repository. */
  private async coordinates(): Promise<{ name: string; cloneUrl?: string; branch?: string }> {
    let catalog: Catalog | undefined;
    try {
      catalog = await Catalog.open(this.context);
      const organisations = catalog.organisations();
      const org = organisations.find((candidate) => candidate.slug === this.organisation) ??
        organisations.find((candidate) => catalog?.repositoriesOf(candidate.slug).some((row) => row.name === this.name));
      const row = org === undefined ? undefined : catalog.repositoriesOf(org.slug).find((entry) => entry.name === this.name);
      const record = catalog.source(slugOf(this.name));
      return {
        name: this.name,
        cloneUrl: record?.remoteUrl ?? row?.cloneUrl,
        branch: record?.defaultBranch ?? row?.defaultBranch,
      };
    } catch {
      return { name: this.name };
    } finally {
      catalog?.close();
    }
  }

  /**
   * Records the repository as a source — and nothing else.
   *
   * A clone is a copy of a repository, so it needs the source to exist in the catalog; it does **not** need a project,
   * and it must not cite anything: citing is a separate act, with its own button, and cloning behind a person's back
   * would put a repository into a project they did not name.
   */
  private async record(): Promise<void> {
    const coordinates = await this.coordinates();
    let catalog: Catalog | undefined;
    try {
      catalog = await Catalog.open(this.context);
      catalog.addSource({
        kind: 'git',
        name: this.name,
        slug: slugOf(this.name),
        remoteUrl: coordinates.cloneUrl,
        defaultBranch: coordinates.branch,
      });
    } catch (error) {
      void vscode.window.showErrorMessage(
        `Temco Repositories: ${error instanceof Error ? error.message : String(error)}`
      );
    } finally {
      catalog?.close();
    }
    this.refresh();
  }

  /** Records the repository as a source of the project being worked on — the same act as *Start* on the dashboard. */
  private async start(): Promise<void> {
    const project = await projectFor(this.selection, this.output, `starting from ${this.name}`, this.name);
    if (project === undefined) {
      return;
    }
    const coordinates = await this.coordinates();
    let catalog: Catalog | undefined;
    try {
      catalog = await Catalog.open(this.context);
      const slug = slugOf(this.name);
      catalog.addSource({
        kind: 'git',
        name: this.name,
        slug,
        remoteUrl: coordinates.cloneUrl,
        defaultBranch: coordinates.branch,
      });
      const cited = catalog.documentSourceSlugs(project);
      catalog.setDocumentSources(project, [...new Set([...cited, slug])]);
    } catch (error) {
      void vscode.window.showErrorMessage(
        `Temco Repositories: ${error instanceof Error ? error.message : String(error)}`
      );
      return;
    } finally {
      catalog?.close();
    }
    this.refresh();
  }
}

/** A listing kept between readings: the local memory that survives a rate limit or an offline network. */
interface KeptListing {
  files: CodeFile[];
  at: number;
  source: 'clone' | 'github';
}

/** What the page says about the contents: the counts, the root's own entries, and the biggest files. */
interface Summary {
  files: number;
  folders: number;
  docs: number;
  languages: string[];
  top: { name: string; path: string; type: 'folder' | 'file'; size?: number }[];
  biggest: { path: string; size: number }[];
  source: 'clone' | 'github';
}

/**
 * A listing folded into the four things worth saying about it.
 *
 * Counts rather than a tree, because the tree is in the side bar; the root's own entries, because the shape of a
 * repository is the first thing a reader looks for; and the two largest files, because "390 files" means nothing until
 * one number has a name attached to it.
 */
function summarise(files: readonly CodeFile[], source: 'clone' | 'github'): Summary {
  const folders = new Set<string>();
  const top = new Map<string, { name: string; path: string; type: 'folder' | 'file'; size?: number }>();
  let docs = 0;
  const extensions = new Map<string, number>();
  for (const file of files) {
    const parts = file.path.split('/');
    parts.slice(0, -1).forEach((_, index) => folders.add(parts.slice(0, index + 1).join('/')));
    const head = parts[0];
    if (!top.has(head)) {
      top.set(head, parts.length === 1
        ? { name: head, path: head, type: 'file', size: file.size }
        : { name: head, path: head, type: 'folder' });
    }
    if (/\.(md|markdown)$/i.test(file.path) || /(^|\/)docs\//i.test(file.path)) {
      docs += 1;
    }
    const extension = /\.([A-Za-z0-9]+)$/.exec(parts[parts.length - 1])?.[1]?.toLowerCase();
    if (extension !== undefined && LANGUAGE_NAMES[extension] !== undefined) {
      extensions.set(LANGUAGE_NAMES[extension], (extensions.get(LANGUAGE_NAMES[extension]) ?? 0) + 1);
    }
  }
  const languages = [...extensions.entries()].sort((a, b) => b[1] - a[1]).slice(0, 3).map(([name]) => name);
  return {
    files: files.length,
    folders: folders.size,
    docs,
    languages,
    top: [...top.values()].sort((a, b) => (a.type === b.type ? a.name.localeCompare(b.name) : a.type === 'folder' ? -1 : 1)),
    biggest: [...files].sort((a, b) => b.size - a.size).slice(0, 2).map((file) => ({ path: file.path, size: file.size })),
    source,
  };
}

/** The few extensions worth naming, so the summary can say "C, Python" rather than ".c, .py". */
const LANGUAGE_NAMES: { [extension: string]: string } = {
  c: 'C', h: 'C', cc: 'C++', cpp: 'C++', hpp: 'C++', cs: 'C#', ts: 'TypeScript', tsx: 'TypeScript',
  js: 'JavaScript', jsx: 'JavaScript', py: 'Python', go: 'Go', rs: 'Rust', java: 'Java', rb: 'Ruby',
  php: 'PHP', kt: 'Kotlin', swift: 'Swift', css: 'CSS', scss: 'CSS', html: 'HTML', md: 'Markdown',
  sh: 'Shell', ps1: 'PowerShell', yml: 'YAML', yaml: 'YAML', json: 'JSON', sql: 'SQL',
};

function html(
  name: string,
  theme: FileIconTheme | undefined,
  resources: string,
  facts: PageFacts,
  last: WorkState | undefined
): string {
  const style = `
    /* The page clone, pull and detail all land on. Flat throughout: one hairline where a band ends, nothing boxed,
       nothing filled, and the only colour spent on the words that carry state. */
    .repo { max-width: 1180px; }

    /* The acts, under the description: one primary, the rest beside it as links — and Clone as a button too, because
       both of the two ways into a copy are buttons of the same weight. */
    .toolbar { display: flex; gap: 8px; flex-wrap: wrap; align-items: center; margin: 12px 0 0; }

    /* The work block: status, the figures, git's own output, and the facts — one group, hairlines between. */
    .work { margin: 18px 0 0; }
    .status { display: flex; gap: 8px; align-items: baseline; font-size: 12px; line-height: 18px; color: var(--fg); }
    .status[hidden] { display: none; }
    .status__mark { flex: none; font-weight: 600; color: var(--fg-muted); }
    .status--ok .status__mark { color: var(--ok); }
    .status--err .status__mark { color: var(--err); }
    .status__text { min-width: 0; overflow-wrap: anywhere; }
    .status__toggle { margin-left: auto; flex: none; }

    /* The figures: what there is on disk, and whether the project reads it. Value on top, label under it. */
    .figures { display: flex; flex-wrap: wrap; gap: 10px 40px; margin: 10px 0 0; padding: 10px 0;
      border-top: 1px solid var(--border); }
    .figure { display: flex; flex-direction: column; min-width: 0; }
    .figure__value { color: var(--fg-strong); font-size: 14px; line-height: 20px; font-weight: 600; }
    .figure__label { color: var(--fg-muted); font-size: 11px; line-height: 16px; }

    /* git's own output, in an editor's shape: numbered, monospaced, and one air line between entries so a two-line
       clone does not read as a single block. */
    .output { display: flex; flex-direction: column; gap: 5px; border-top: 1px solid var(--border); max-height: 260px;
      overflow: auto; padding: 10px 0; }
    .output[hidden] { display: none; }
    .line { display: grid; grid-template-columns: 44px minmax(0, 1fr); align-items: baseline; }
    .line__no { color: var(--fg-subtle); text-align: right; padding-right: 12px; user-select: none;
      font-family: var(--font-mono); font-size: 11px; line-height: 17px; }
    .line__code { color: var(--fg); font-family: var(--font-mono); font-size: 11px; line-height: 17px;
      white-space: pre-wrap; overflow-wrap: anywhere; }
    .line--cmd .line__code { color: var(--fg-muted); }

    .facts { display: flex; flex-wrap: wrap; gap: 4px 22px; padding: 10px 0 0;
      border-top: 1px solid var(--border); font-size: 12px; line-height: 18px; }
    .fact { display: flex; gap: 6px; min-width: 0; }
    .fact__label { color: var(--fg-muted); }
    .fact__value { color: var(--fg); overflow-wrap: anywhere; }
    .fact__value--mono { font-family: var(--font-mono); font-size: 11px; }

    /* The summary: what is in it, at a glance, with the one way in at its right-hand end. */
    .part { display: flex; align-items: flex-end; gap: 16px; flex-wrap: wrap; margin: 30px 0 10px; }
    .part__text { flex: 1 1 240px; min-width: 0; }
    .part__note { margin: 3px 0 0; color: var(--fg-muted); font-size: 12px; line-height: 17px; }
    /* Room for a refusal as well as for counts: the band is a section, not a line, so it never pinches the one thing
       it has to say when that thing is an error. */
    .summary { display: flex; flex-direction: column; gap: 8px; min-height: 64px; }
    .summary__counts { color: var(--fg); font-size: 13px; line-height: 19px; }
    .summary__row { display: flex; gap: 10px; flex-wrap: wrap; align-items: baseline; font-size: 12px; line-height: 18px; }
    .summary__label { color: var(--fg-muted); min-width: 72px; }
    /* A name in a row: a link when it can be opened, plain text when it is a folder. Named for the summary rather than
       "chip", because the page kit already owns a chip — a bordered pill that would clip a long path. */
    .summary__item { border: 0; background: none; padding: 0; font: inherit; font-size: 12px; color: var(--az-blue);
      cursor: pointer; white-space: normal; overflow-wrap: anywhere; }
    .summary__item:hover { text-decoration: underline; }
    .summary__item--folder { color: var(--fg); cursor: default; }
    .summary__item--folder:hover { text-decoration: none; }
    .summary__dot { color: var(--fg-subtle); }
    .summary__size { color: var(--fg-subtle); font-size: 11px; font-variant-numeric: tabular-nums; }
    /* A message bar: Fluent's shape — soft tint, 4px radius, an icon, and the words against the left edge. No border
       and no outline, because a bar is a thing said, not a thing to be clicked. It is a "msg" rather than a "bar"
       because the page kit owns a bar: a 6px progress rail whose fixed height cut this one's text in half. */
    .msg { display: flex; gap: 8px; align-items: flex-start; height: auto; padding: 8px 12px; border-radius: 4px;
      text-align: left; font-size: 12px; line-height: 17px; color: var(--fg); overflow: visible; }
    .msg--err { background: color-mix(in srgb, var(--err) 14%, transparent); }
    .msg--warn { background: color-mix(in srgb, var(--warn) 16%, transparent); }
    .msg--ok { background: color-mix(in srgb, var(--ok) 14%, transparent); }
    .msg__mark { flex: none; color: var(--err); display: inline-flex; padding-top: 1px; }
    .msg--warn .msg__mark { color: var(--warn); }
    .msg--ok .msg__mark { color: var(--ok); }
    .msg__text { flex: 1 1 auto; min-width: 0; overflow-wrap: anywhere; }
    .msg__actions { display: flex; gap: 6px; margin-top: 6px; }
    .msg + .msg { margin-top: 8px; }
    .empty { color: var(--fg-muted); padding: 12px 0; font-size: 12px; text-align: left; }

    /* The foot: the one decision this page exists for. */
    .foot { display: flex; gap: 12px; flex-wrap: wrap; align-items: center; margin: 28px 0 0;
      padding-top: 14px; border-top: 1px solid var(--border); }
    .foot__summary { color: var(--fg-muted); font-size: 12px; flex: 1 1 16em; }
  `;

  const toolbar = `
    <div class="toolbar">
      <button type="button" class="az-btn az-btn--primary" id="fetch" hidden>${glyph('download')}<span>Clone the code</span></button>
      <button type="button" class="az-btn az-btn--primary" id="pull" hidden>${glyph('sync')}<span>Pull the latest</span></button>
      <button type="button" class="az-btn" id="fetch-link" hidden>${glyph('download')}<span>Clone the code</span></button>
      <button type="button" class="az-btn" id="start" hidden>${glyph('plus')}<span>Add to the project</span></button>
      <button type="button" class="az-btn az-btn--link" id="open-github">Open on GitHub</button>
      <button type="button" class="az-btn az-btn--link" id="copy-url">Copy the clone URL</button>
      <button type="button" class="az-btn az-btn--link" id="refresh">Refresh</button>
      <button type="button" class="az-btn az-btn--link" id="remove-copy" hidden>Remove the clone</button>
    </div>
  `;

  const head = hero({
    eyebrow: facts.organisation === undefined ? 'Repositories' : `${facts.organisation} · repositories`,
    mark: 'repo',
    title: name,
    desc: facts.description ?? 'No description on GitHub.',
    descWide: true,
  });

  const body = `
  <div class="repo">
${head}
${toolbar}

    <div class="work">
      <p class="status" id="status" role="status" hidden>
        <span class="status__mark" id="status-mark"></span>
        <span class="status__text" id="status-text"></span>
        <button type="button" class="az-btn az-btn--sm az-btn--link status__toggle" id="output-toggle" hidden>Hide</button>
      </p>
      <div class="figures" id="figures"></div>
      <div class="output" id="output" hidden></div>
      <div class="facts" id="facts"></div>
      <div id="error"></div>
    </div>

    <div class="part">
      <div class="part__text">
        <h2 class="az-section__title">What is in this repository</h2>
        <p class="part__note" id="summary-note">Reading the file list…</p>
      </div>
      <button type="button" class="az-btn az-btn--sm" id="view-it">View it in the panel</button>
    </div>
    <div class="summary" id="summary"></div>

    <div class="foot">
      <span class="foot__summary">Open a file from the summary, or start a project from this repository.</span>
      <button type="button" class="az-btn az-btn--primary" id="project">${glyph('plus')}<span>Create a project from this repository</span></button>
    </div>
  </div>
  `;

  return page(body, {
    title: name,
    extraCss: style + (theme?.css ?? ''),
    resources,
    script: commandScript + CLIENT,
    initialWork: last,
  });
}

/** What the header can say before the page has spoken to the module: the description and the org. */
interface PageFacts {
  organisation?: string;
  description?: string;
  localCopy: boolean;
}

/** One glyph from the page sprite, at the size the surrounding control asks for. */
function glyph(name: string): string {
  return `<svg viewBox="0 0 24 24" class="icon" aria-hidden="true"><use href="#i-${name}"></use></svg>`;
}

/**
 * The page's own behaviour.
 *
 * It draws the status, the figures, the output and the summary; it never draws a tree, because the tree is in the side
 * bar and "View it in the panel" is the way there. A file in the summary is a command the kit's handler posts, so the
 * page does not have to know where a file would come from.
 */
const CLIENT = `
const vscode = window.__temcoApi || (window.__temcoApi = acquireVsCodeApi());
const $ = (id) => document.getElementById(id);
let state = {};
let outputLines = [];

$('fetch').addEventListener('click', () => vscode.postMessage({ type: 'fetch' }));
$('fetch-link').addEventListener('click', () => vscode.postMessage({ type: 'fetch' }));
$('pull').addEventListener('click', () => vscode.postMessage({ type: 'pull' }));
$('start').addEventListener('click', () => vscode.postMessage({ type: 'start' }));
$('remove-copy').addEventListener('click', () => vscode.postMessage({ type: 'removeClone' }));
$('refresh').addEventListener('click', () => vscode.postMessage({ type: 'state' }));
$('view-it').addEventListener('click', () => vscode.postMessage({ type: 'reveal' }));
$('project').addEventListener('click', () => vscode.postMessage({ type: 'project' }));
$('open-github').addEventListener('click', () => {
  if (state.row && state.row.webUrl) { vscode.postMessage({ type: 'open', url: state.row.webUrl }); }
});
$('copy-url').addEventListener('click', () => {
  if (state.row && state.row.cloneUrl) { vscode.postMessage({ type: 'copy', text: state.row.cloneUrl }); }
});
$('output-toggle').addEventListener('click', () => showOutput($('output').hidden));

drawWork(window.__temcoInitial);
// The page is listening: an act that came with it (a dashboard row's Clone it) runs now, and the facts follow.
vscode.postMessage({ type: 'ready' });
// A safety net for the one race a webview still has: if the first answer never arrives, ask again rather than sit on
// "Reading the file list…" for ever.
let answered = false;
setTimeout(() => {
  if (!answered) { vscode.postMessage({ type: 'state' }); }
}, 1200);

window.addEventListener('message', (event) => {
  const message = event.data || {};
  if (message.type === 'state') { answered = true; }
  if (message.type === 'work') { drawWork(message.work); return; }
  if (message.type === 'log') { logLine(message.text); return; }
  if (message.type === 'state') {
    state = message;
    if (message.error) {
      $('error').replaceChildren(banner(message.error));
      $('summary-note').textContent = 'The repository could not be read.';
      return;
    }
    $('error').replaceChildren();
    drawFacts();
    drawFigures();
    drawActions();
    vscode.postMessage({ type: 'files' });
    return;
  }
  if (message.type !== 'summary') { return; }
  if (message.error) {
    $('summary').replaceChildren(bar(message.error, 'err', true));
    $('summary-note').textContent = 'The list could not be read.';
    return;
  }
  drawSummary(message);
});

/** The figures: what there is on disk, and whether the project reads it. */
function drawFigures() {
  const figures = [
    [state.localCopy ? 'cloned' : '—', state.localCopy
      ? (state.copySize ? state.copySize + ' on disk' : 'on disk')
      : 'no local copy'],
    [state.cited ? 'cited' : state.isSource ? 'recorded' : 'not started',
      state.cited ? 'in the project' : state.isSource ? 'not cited yet' : 'not in a project'],
  ];
  if (state.row && state.row.language) { figures.push([state.row.language, 'language']); }
  const box = $('figures');
  box.replaceChildren();
  for (const [value, label] of figures) {
    const figure = document.createElement('span');
    figure.className = 'figure';
    const top = document.createElement('span');
    top.className = 'figure__value';
    top.textContent = value;
    const bottom = document.createElement('span');
    bottom.className = 'figure__label';
    bottom.textContent = label;
    figure.append(top, bottom);
    box.append(figure);
  }
}

/** The facts: where the copy is, which branch, when it last moved. */
function drawFacts() {
  const facts = [
    ['Copy', state.localCopy ? 'cloned' + (state.copySize ? ' · ' + state.copySize : '') : 'not cloned yet'],
    ['Folder', state.localCopy && state.path ? state.path : (state.where || 'not chosen'), true],
  ];
  if (state.branch) { facts.push(['Branch', state.branch]); }
  facts.push(['Source', state.cited ? 'cited by the project' : state.isSource ? 'recorded, not cited' : 'not started']);
  if (state.row && state.row.pushedAt) { facts.push(['Last push', shortDate(state.row.pushedAt)]); }
  const box = $('facts');
  box.replaceChildren();
  for (const [label, value, mono] of facts) {
    const pair = document.createElement('span');
    pair.className = 'fact';
    const name = document.createElement('span');
    name.className = 'fact__label';
    name.textContent = label;
    const detail = document.createElement('span');
    detail.className = 'fact__value' + (mono ? ' fact__value--mono' : '');
    detail.textContent = value;
    pair.append(name, detail);
    box.append(pair);
  }
}

/** Which acts the facts allow: one primary, and the rest as links beside it. */
function drawActions() {
  $('fetch').hidden = Boolean(state.localCopy);
  $('fetch-link').hidden = !state.localCopy;
  $('pull').hidden = !state.localCopy;
  $('remove-copy').hidden = !state.localCopy;
  $('start').hidden = Boolean(state.cited);
}

/**
 * The summary: the counts, the root's own entries, and the biggest files.
 *
 * A folder is named but not pressable — the tree that would open is in the side bar — while a file opens where it is
 * read from. Saying so in the note is cheaper than a control that looks like a link and does nothing.
 */
function drawSummary(summary) {
  const counts = [];
  counts.push(summary.files + (summary.files === 1 ? ' file' : ' files'));
  counts.push(summary.folders + (summary.folders === 1 ? ' folder' : ' folders'));
  if (summary.docs > 0) { counts.push(summary.docs + (summary.docs === 1 ? ' docs page' : ' docs pages')); }
  if (summary.languages.length > 0) { counts.push(summary.languages.join(', ')); }
  $('summary-note').textContent = (summary.source === 'clone'
    ? 'Read from the clone on this machine'
    : 'Read over the GitHub API — cloning makes it faster')
    + (summary.note ? ' · ' + summary.note : '');

  const box = $('summary');
  box.replaceChildren();

  const head = document.createElement('p');
  head.className = 'summary__counts';
  head.textContent = counts.join(' · ');
  box.append(head);

  if (summary.top.length > 0) {
    box.append(row('Top level', summary.top.map((entry) => entry.type === 'folder'
      ? chip(entry.name, undefined, true)
      : chip(entry.name + '  ' + kilo(entry.size), () => vscode.postMessage({ type: 'openFile', path: entry.path })))));
  }
  if (summary.biggest.length > 0) {
    box.append(row('Biggest', summary.biggest.map((file) =>
      chip(file.path + '  ' + kilo(file.size), () => vscode.postMessage({ type: 'openFile', path: file.path })))));
  }
}

function row(label, chips) {
  const line = document.createElement('div');
  line.className = 'summary__row';
  const name = document.createElement('span');
  name.className = 'summary__label';
  name.textContent = label;
  line.append(name);
  chips.forEach((element, index) => {
    if (index > 0) {
      const dot = document.createElement('span');
      dot.className = 'summary__dot';
      dot.textContent = '·';
      line.append(dot);
    }
    line.append(element);
  });
  return line;
}

function chip(text, onClick, plain) {
  const element = document.createElement(plain ? 'span' : 'button');
  element.className = 'summary__item' + (plain ? ' summary__item--folder' : '');
  element.textContent = text;
  if (!plain) {
    element.type = 'button';
    element.addEventListener('click', onClick);
  }
  return element;
}

/** The act's state, and the output kept under it after it ends. */
function drawWork(work) {
  const line = $('status');
  if (!work) { line.hidden = true; return; }
  line.hidden = false;
  line.className = 'status' + (work.state === 'ok' ? ' status--ok' : work.state === 'err' ? ' status--err' : '');
  $('status-mark').textContent = work.state === 'ok' ? '✓ Done' : work.state === 'err' ? '✗ Failed'
    : (work.act === 'clone' ? 'Cloning…' : 'Pulling…');
  $('status-text').textContent = work.text;
  if (work.state === 'running') { outputLines = []; drawOutput(); showOutput(true); }
}

function logLine(text) {
  outputLines.push(text);
  drawOutput();
  const box = $('output');
  box.scrollTop = box.scrollHeight;
}

function drawOutput() {
  const box = $('output');
  box.replaceChildren(...outputLines.map((text, index) => {
    const line = document.createElement('div');
    line.className = 'line' + (text.startsWith('$') ? ' line--cmd' : '');
    const no = document.createElement('span');
    no.className = 'line__no';
    no.textContent = String(index + 1);
    const code = document.createElement('span');
    code.className = 'line__code';
    code.textContent = text;
    line.append(no, code);
    return line;
  }));
}

function showOutput(show) {
  $('output').hidden = !show;
  $('output-toggle').hidden = outputLines.length === 0;
  $('output-toggle').textContent = show ? 'Hide' : 'Show';
}

function note(text) {
  const element = document.createElement('div');
  element.className = 'empty';
  element.textContent = text;
  return element;
}

/**
 * A message bar: the words against the left edge, an icon in the state's colour, and the ways out where a refusal can
 * be answered — the token, or another try.
 */
function bar(text, kind, withActions) {
  const box = document.createElement('div');
  box.className = 'msg msg--' + (kind || 'warn');
  box.setAttribute('role', kind === 'err' ? 'alert' : 'status');
  const mark = document.createElement('span');
  mark.className = 'msg__mark';
  mark.innerHTML = '<svg viewBox="0 0 24 24" class="icon icon--sm" aria-hidden="true"><use href="#i-'
    + (kind === 'err' ? 'warning' : kind === 'ok' ? 'check' : 'info') + '"></use></svg>';
  const said = document.createElement('div');
  said.className = 'msg__text';
  said.textContent = text;
  box.append(mark, said);
  if (withActions) {
    const do_ = document.createElement('div');
    do_.className = 'msg__actions';
    const token = document.createElement('button');
    token.type = 'button';
    token.className = 'az-btn az-btn--sm az-btn--link';
    token.textContent = 'Set a GitHub token';
    token.addEventListener('click', () => vscode.postMessage({ type: 'command', command: 'temcoRepositories.setToken' }));
    const again = document.createElement('button');
    again.type = 'button';
    again.className = 'az-btn az-btn--sm az-btn--link';
    again.textContent = 'Try again';
    again.addEventListener('click', () => vscode.postMessage({ type: 'files' }));
    do_.append(token, again);
    said.append(do_);
  }
  return box;
}

/** The page's one banner: a load failure or a refusal, as the same bar the summary uses. */
function banner(text) {
  return bar(text, 'err', true);
}

function kilo(bytes) {
  if (!bytes) { return ''; }
  return bytes >= 1024 * 1024 ? (bytes / (1024 * 1024)).toFixed(1) + ' MB'
    : bytes >= 1024 ? Math.round(bytes / 1024) + ' KB' : bytes + ' B';
}

function shortDate(stamp) {
  const date = new Date(stamp);
  return isNaN(date.getTime()) ? stamp : date.toLocaleDateString();
}
`;
