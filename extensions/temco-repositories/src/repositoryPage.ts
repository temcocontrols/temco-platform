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
import { page, pageColumn, remember } from './ui';
import { cloneRoot, cloneSize, hasClone, projectFor } from './workarea';

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
  error?: string;
}

/** A file of the repository under `docs/`, in one of the shapes a page is written in. */
function isDocumentation(file: string): boolean {
  const lower = file.toLowerCase();
  if (!/\.(md|markdown|html|htm|json)$/.test(lower)) {
    return false;
  }
  return /(^|\/)docs\//.test(lower) || lower.endsWith('registry.json');
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

  /**
   * Opens this repository and performs one act in it — what a dashboard row's `Clone it` and `Pull` mean.
   *
   * The act is not run from the dashboard: a clone explains itself in lines, and those lines belong on the page about
   * the repository. The page asks for the work when its script is ready (`ready`), so nothing is posted into a webview
   * that is not listening yet.
   */
  openAndRun(name: string, act: WorkAct, organisation?: string): void {
    this.pending = act;
    this.open(name, organisation);
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
    panel.webview.html = html(this.name, this.theme, panel.webview.cspSource, this.work.lastFor(slugOf(this.name)));
    await this.send();
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

  /** The files inside the repository, grouped: documentation first, then classes and source. */
  private async sendFiles(ticked: readonly string[]): Promise<void> {
    const panel = this.panel;
    if (!panel) {
      return;
    }
    let catalog: Catalog | undefined;
    let source: RepositorySource | undefined;
    try {
      catalog = await Catalog.open(this.context);
      const record = catalog.source(slugOf(this.name));
      const org = catalog.organisations().find((candidate) => candidate.slug === this.organisation) ??
        catalog.organisations().find((candidate) => catalog?.repositoriesOf(candidate.slug).some((row) => row.name === this.name));
      const row = org === undefined ? undefined : catalog.repositoriesOf(org.slug).find((entry) => entry.name === this.name);
      source = {
        name: this.name,
        path: record?.path,
        remoteUrl: record?.remoteUrl ?? row?.cloneUrl,
        branch: record?.branch,
        defaultBranch: record?.defaultBranch ?? row?.defaultBranch,
      };
    } catch (error) {
      await panel.webview.postMessage({ type: 'files', error: error instanceof Error ? error.message : String(error) });
      return;
    } finally {
      catalog?.close();
    }

    if (source === undefined) {
      await panel.webview.postMessage({ type: 'files', error: 'This repository is no longer listed by any organisation.' });
      return;
    }
    const listed = await sourceTree(this.context, source);
    if ('error' in listed) {
      await panel.webview.postMessage({ type: 'files', error: listed.error });
      return;
    }
    const files = listed.files.map((file: CodeFile) => ({
      path: file.path,
      size: file.size,
      category: isDocumentation(file.path) ? 'docs' : 'code',
      // The theme's own glyph when it has one, and the page's sprite when it does not: the row says what the file is
      // either way.
      glyph: this.theme?.classFor(file.path),
      ticked: ticked.includes(file.path),
    }));
    await panel.webview.postMessage({ type: 'files', files, note: listed.note });
  }

  private async receive(message: DetailMessage): Promise<void> {
    switch (message.type) {
      case 'ready': {
        // The page is listening. An act that came with it (a dashboard row's Clone it) runs now; otherwise the page is
        // simply handed the facts it needs.
        const pending = this.pending;
        this.pending = undefined;
        if (pending === 'clone') {
          await this.runAct('fetch');
        } else if (pending === 'pull') {
          await this.runAct('pull');
        }
        return;
      }
      case 'state':
        await this.send();
        return;
      case 'files':
        await this.sendFiles(message.files ?? []);
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
    await this.sendFiles([]);
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

function html(name: string, theme: FileIconTheme | undefined, resources: string, last: WorkState | undefined): string {
  const style = `
    /* The page is a stack of bands on the editor's own surface: no cards, one hairline where a band ends. */
    .repo { max-width: 1080px; }

    /* The header: where this is, what it is called, and the one line of state. */
    .head { display: grid; grid-template-columns: minmax(0, 1fr) auto; gap: 4px 16px; align-items: start;
      padding: 0 0 14px; border-bottom: 1px solid var(--border); }
    .head__eyebrow { grid-column: 1 / -1; margin: 0; color: var(--fg-muted); font-size: 11px;
      letter-spacing: .07em; text-transform: uppercase; }
    .head__title { margin: 0; color: var(--fg-strong); font-size: 22px; line-height: 28px; font-weight: 600;
      overflow-wrap: anywhere; }
    .head__sub { grid-column: 1; margin: 2px 0 0; color: var(--fg-muted); font-size: 13px; line-height: 18px; }
    .head__actions { grid-column: 2; grid-row: 2 / span 2; display: flex; gap: 8px; flex-wrap: wrap;
      justify-content: flex-end; align-items: flex-start; }

    /* The state strip: what the platform holds of it, and what just happened. Fluent's quiet message bar. */
    .strip { display: flex; align-items: center; gap: 8px; margin: 12px 0 0; padding: 8px 12px;
      border: 1px solid var(--border); border-radius: 4px; background: var(--bg-inset);
      font-size: 12px; line-height: 16px; color: var(--fg); }
    .strip--ok { border-color: color-mix(in srgb, var(--ok) 55%, transparent); }
    .strip--err { border-color: color-mix(in srgb, var(--err) 55%, transparent); }
    .strip__mark { flex: none; font-weight: 600; color: var(--fg-muted); }
    .strip--ok .strip__mark { color: var(--ok); }
    .strip--err .strip__mark { color: var(--err); }
    .strip__text { flex: 1 1 auto; min-width: 0; overflow-wrap: anywhere; }
    .strip[hidden] { display: none; }

    /* The facts: a label column and a value column, the way a settings page reads. */
    .facts { display: grid; grid-template-columns: max-content minmax(0, 1fr); gap: 2px 16px; margin: 14px 0 0;
      font-size: 12px; line-height: 18px; }
    .facts dt { color: var(--fg-muted); }
    .facts dd { margin: 0; color: var(--fg); overflow-wrap: anywhere; }
    .facts dd.mono { font-family: var(--font-mono); font-size: 11px; }

    /* The console: what git said, in the editor's own monospace, on the page rather than in another tab. */
    .console { margin: 14px 0 0; border: 1px solid var(--border); border-radius: 4px; overflow: hidden; }
    .console[hidden] { display: none; }
    .console__bar { display: flex; align-items: center; gap: 8px; padding: 6px 10px;
      background: var(--bg-inset); border-bottom: 1px solid var(--border); font-size: 12px; color: var(--fg-muted); }
    .console__title { flex: 1 1 auto; }
    .console__log { margin: 0; padding: 8px 10px; max-height: 300px; overflow: auto;
      font-family: var(--font-mono); font-size: 11px; line-height: 16px;
      color: var(--fg); background: transparent; white-space: pre-wrap; overflow-wrap: anywhere; }

    /* The list: one row per file, pressable, with the theme's own glyph. */
    .files { margin: 6px 0 0; }
    .file { display: grid; grid-template-columns: 20px minmax(0, 1fr) auto; gap: 0 8px; align-items: center;
            padding: 5px 6px; border-bottom: 1px solid var(--border); cursor: pointer;
            background: none; border-left: 0; border-right: 0; border-top: 0; width: 100%; text-align: left;
            font: inherit; color: inherit; border-radius: 2px; }
    .file:last-child { border-bottom: 0; }
    .file:hover { background: var(--bg-hover); }
    .file:focus-visible { outline: 1px solid var(--focus); outline-offset: -1px; }
    .file__glyph { color: var(--fg-subtle); display: inline-flex; justify-content: center; }
    .file__path { color: var(--fg); font-size: 12px; overflow-wrap: anywhere; }
    .file__meta { color: var(--fg-subtle); font-size: 11px; white-space: nowrap; font-variant-numeric: tabular-nums; }

    /* The warning is a tinted surface, not a bordered box: it has to be recognisable across the room. */
    .warn { border-radius: 4px; padding: 10px 12px; margin: 12px 0;
            background: color-mix(in srgb, var(--warn) 18%, var(--bg-inset)); color: var(--fg); }
    .warn p { margin: 0; }
    .warn .do { display: flex; gap: 6px; margin: 8px 0 0; }
    .empty { color: var(--fg-muted); padding: 10px 0; }

    /* The foot is the one decision the page exists for, so it stays in reach of the list it is about. */
    .foot { display: flex; gap: 10px; flex-wrap: wrap; align-items: center; margin: 16px 0 0;
            padding-top: 12px; border-top: 1px solid var(--border); }
    .foot__summary { color: var(--fg-muted); font-size: 12px; flex: 1 1 16em; }

    @media (max-width: 720px) {
      .head { grid-template-columns: minmax(0, 1fr); }
      .head__actions { grid-column: 1; grid-row: auto; justify-content: flex-start; }
    }
  `;

  const body = `
  <div class="repo">
    <header class="head">
      <p class="head__eyebrow" id="eyebrow">Repository</p>
      <h1 class="head__title" id="title">${name}</h1>
      <div class="head__actions">
        <button type="button" class="az-btn az-btn--primary" id="fetch">${glyph('download')}<span>Clone the code</span></button>
        <button type="button" class="az-btn az-btn--primary" id="pull" hidden>${glyph('upload')}<span>Pull the latest</span></button>
        <button type="button" class="az-btn" id="start" hidden>${glyph('plus')}<span>Start — add it to the project</span></button>
        <button type="button" class="az-btn" id="open-github">${glyph('globe')}<span>Open on GitHub</span></button>
        <button type="button" class="az-btn" id="copy-url">${glyph('link')}<span>Copy the clone URL</span></button>
        <button type="button" class="az-btn" id="reload">${glyph('refresh')}<span>Refresh</span></button>
        <button type="button" class="az-btn" id="remove-copy" hidden>${glyph('close')}<span>Remove the clone</span></button>
      </div>
      <p class="head__sub" id="lede">Reading what the platform holds of it…</p>
    </header>

    <div class="strip" id="strip" role="status" hidden>
      <span class="strip__mark" id="strip-mark"></span>
      <span class="strip__text" id="strip-text"></span>
    </div>

    <dl class="facts" id="facts"></dl>
    <div id="error"></div>

    <section class="console" id="console" hidden>
      <div class="console__bar">
        <span class="console__title" id="console-title">Git output</span>
        <button type="button" class="az-btn az-btn--sm az-btn--link" id="console-hide">Hide</button>
      </div>
      <pre class="console__log" id="console-log" aria-live="polite"></pre>
    </section>

    <section class="az-section">
      <div class="az-section__text">
        <h2 class="az-section__title">What is inside it</h2>
        <p class="az-section__desc" id="files-note">Reading the file list…</p>
      </div>
    </section>
    <div id="files-error"></div>
    <div class="files" id="files"></div>

    <div class="foot">
      <span class="foot__summary">One row per file: open it, or start a project from the repository.</span>
      <button type="button" class="az-btn az-btn--primary" id="project">${glyph('plus')}<span id="project-label">Create a project from this repository</span></button>
    </div>
  </div>
  `;

  return page(body, {
    title: name,
    extraCss: style + (theme?.css ?? ''),
    resources,
    script: CLIENT,
    initialWork: last,
  });
}

/** One glyph from the page sprite, at the size the surrounding control asks for. */
function glyph(name: string): string {
  return `<svg viewBox="0 0 24 24" class="icon" aria-hidden="true"><use href="#i-${name}"></use></svg>`;
}

const CLIENT = `
const vscode = window.__temcoApi || (window.__temcoApi = acquireVsCodeApi());
const $ = (id) => document.getElementById(id);
let state = {};
let files = [];
let note = '';

$('reload').addEventListener('click', () => vscode.postMessage({ type: 'state' }));
$('open-github').addEventListener('click', () => {
  if (state.row && state.row.webUrl) { vscode.postMessage({ type: 'open', url: state.row.webUrl }); }
});
$('copy-url').addEventListener('click', () => {
  if (state.row && state.row.cloneUrl) { vscode.postMessage({ type: 'copy', text: state.row.cloneUrl }); }
});
$('fetch').addEventListener('click', () => vscode.postMessage({ type: 'fetch' }));
$('pull').addEventListener('click', () => vscode.postMessage({ type: 'pull' }));
$('remove-copy').addEventListener('click', () => vscode.postMessage({ type: 'removeClone' }));
$('start').addEventListener('click', () => vscode.postMessage({ type: 'start' }));
$('project').addEventListener('click', () => vscode.postMessage({ type: 'project' }));
$('console-hide').addEventListener('click', () => { $('console').hidden = true; });

// The last thing an act reported, when the tab was drawn: a page that was closed mid-clone says how it ended.
drawWork(window.__temcoInitial);
// The page is listening: an act that came with it (a dashboard row's Clone it) runs now.
vscode.postMessage({ type: 'ready' });

window.addEventListener('message', (event) => {
  const message = event.data || {};
  if (message.type === 'work') { drawWork(message.work); return; }
  if (message.type === 'log') { logLine(message.text); return; }
  if (message.type === 'state') {
    state = message;
    if (message.error) { $('error').replaceChildren(banner(message.error)); return; }
    $('error').replaceChildren();
    if (message.row) { $('title').textContent = message.row.name; }
    drawFacts();
    drawActions();
    // The file list is asked for again after every act: a fetched copy changes where the files come from.
    vscode.postMessage({ type: 'files', files: [] });
    return;
  }
  if (message.type !== 'files') { return; }
  if (message.error) {
    $('files-error').replaceChildren(banner(message.error));
    $('files').replaceChildren();
    $('files-note').textContent = 'The list could not be read.';
    return;
  }
  $('files-error').replaceChildren();
  files = message.files || [];
  note = message.note || '';
  $('files-note').textContent = (state.localCopy
    ? 'Read from the clone in this machine\\'s working area. Press a file to open it.'
    : 'Read over the GitHub API, because there is no clone yet. Press a file to open it there; cloning makes this faster and gives the history behind each file.')
    + (note ? ' ' + note + '.' : '');
  draw();
});

/** What the platform holds of this repository: the rows of the fact list, and the one sentence under the title. */
function drawFacts() {
  const rows = [];
  if (state.row) {
    rows.push(['Language', state.row.language || 'not reported']);
    rows.push(['Visibility', state.row.isPrivate ? 'private' : 'public']);
    if (state.row.pushedAt) { rows.push(['Last push', shortDate(state.row.pushedAt)]); }
    if (state.row.cloneUrl) { rows.push(['Clone URL', state.row.cloneUrl, true]); }
  }
  rows.push(['Source', state.cited
    ? 'cited by the project being worked on'
    : state.isSource ? 'recorded, not cited by this project' : 'not started']);
  rows.push(['Local copy', state.localCopy
    ? 'cloned' + (state.copySize ? ' · ' + state.copySize : '')
    : 'none — Clone reads it into ' + (state.where || 'the working area')]);
  if (state.branch) { rows.push(['Branch read', state.branch]); }

  const list = document.createElement('dl');
  list.className = 'facts';
  for (const [label, value, mono] of rows) {
    const term = document.createElement('dt');
    term.textContent = label;
    const detail = document.createElement('dd');
    if (mono) { detail.className = 'mono'; }
    detail.textContent = value;
    list.append(term, detail);
  }
  $('facts').replaceChildren(...list.childNodes);

  $('eyebrow').textContent = state.organisation ? 'Repository · ' + state.organisation : 'Repository';
  $('lede').textContent = (state.row && state.row.description ? state.row.description : 'No description.')
    + (state.project ? ' · project ' + state.project : ' · no project is being worked on');
}

/**
 * The state strip, and the console that carries git's own lines.
 *
 * One act at a time: opening the console clears it, so the lines on screen are always the lines of the run being
 * watched, never two runs interleaved.
 */
function drawWork(work) {
  const strip = $('strip');
  if (!work) { strip.hidden = true; return; }
  strip.hidden = false;
  strip.className = 'strip' + (work.state === 'ok' ? ' strip--ok' : work.state === 'err' ? ' strip--err' : '');
  $('strip-mark').textContent = work.state === 'ok' ? 'Done' : work.state === 'err' ? 'Failed' : (work.act === 'clone' ? 'Cloning' : 'Pulling');
  $('strip-text').textContent = work.text;
  if (work.state === 'running') {
    $('console').hidden = false;
    $('console-title').textContent = work.act === 'clone' ? 'Cloning ' + work.name : 'Pulling ' + work.name;
    $('console-log').textContent = '';
  }
}

function logLine(text) {
  const console_ = $('console');
  if (console_.hidden) {
    console_.hidden = false;
    $('console-log').textContent = '';
  }
  const log = $('console-log');
  const atEnd = log.scrollTop + log.clientHeight >= log.scrollHeight - 24;
  log.append(document.createTextNode((log.textContent ? '\\n' : '') + text));
  if (atEnd) { log.scrollTop = log.scrollHeight; }
}

/** The acts the state allows: fetch or pull, start when it is not cited, and never both of a pair. */
function drawActions() {
  $('fetch').hidden = Boolean(state.localCopy);
  $('pull').hidden = !state.localCopy;
  $('remove-copy').hidden = !state.localCopy;
  $('start').hidden = Boolean(state.cited);
}

function draw() {
  if (files.length === 0) {
    const empty = document.createElement('div');
    empty.className = 'empty';
    empty.textContent = 'This repository has no file to show.';
    $('files').replaceChildren(empty);
    return;
  }
  $('files').replaceChildren(...files.map((file) => {
    // A row is a way in, like a row in the Explorer: press it and the file opens.
    const line = document.createElement('button');
    line.type = 'button';
    line.className = 'file';
    line.title = 'Open ' + file.path;
    line.addEventListener('click', () => vscode.postMessage({ type: 'openFile', path: file.path }));
    // The glyph says what kind of file it is before the path is read: the theme's icon where there is one, the page's
    // own sprite otherwise.
    const mark = document.createElement('span');
    mark.className = 'file__glyph';
    mark.innerHTML = file.glyph
      ? '<span class="' + file.glyph + '" aria-hidden="true"></span>'
      : '<svg viewBox="0 0 24 24" class="icon icon--sm" aria-hidden="true"><use href="#i-'
        + fileGlyph(file.path) + '"></use></svg>';
    const path = document.createElement('span');
    path.className = 'file__path';
    path.textContent = file.path;
    const size = document.createElement('span');
    size.className = 'file__meta';
    size.textContent = (file.category === 'docs' ? 'doc · ' : '') + kilo(file.size);
    line.append(mark, path, size);
    return line;
  }));
}

/**
 * The sprite glyph a file kind gets — the page's counterpart of the panel's codicon map.
 *
 * A page draws from the sprite it ships with, so the vocabulary is the sprite's: a page, code, a package, a database,
 * a shell, a setting, an image, a document. The name is asked first, then the extension, because package.json is a
 * package before it is JSON.
 */
function fileGlyph(path) {
  const name = (path.split('/').pop() || path).toLowerCase();
  const byName = {
    'package.json': 'package', 'package-lock.json': 'key', 'yarn.lock': 'key', 'pnpm-lock.yaml': 'key',
    'dockerfile': 'server', 'docker-compose.yml': 'server', 'license': 'book', 'license.md': 'book',
    '.gitignore': 'branch', '.gitattributes': 'branch', '.editorconfig': 'gear'
  };
  const byExtension = {
    md: 'document', markdown: 'document', mdx: 'document', txt: 'document',
    json: 'layers', jsonc: 'layers', json5: 'layers',
    yml: 'gear', yaml: 'gear', toml: 'gear', ini: 'gear', conf: 'gear', env: 'gear',
    ts: 'code', mts: 'code', cts: 'code', tsx: 'code', js: 'code', mjs: 'code', cjs: 'code', jsx: 'code',
    html: 'code', htm: 'code', vue: 'code', svelte: 'code',
    css: 'palette', scss: 'palette', sass: 'palette', less: 'palette',
    py: 'code', rb: 'code', go: 'code', rs: 'code', java: 'code', kt: 'code', cs: 'code',
    c: 'code', h: 'code', cc: 'code', cpp: 'code', hpp: 'code',
    sql: 'database',
    sh: 'terminal', bash: 'terminal', zsh: 'terminal', ps1: 'terminal', bat: 'terminal', cmd: 'terminal',
    png: 'chart', jpg: 'chart', jpeg: 'chart', gif: 'chart', svg: 'chart', webp: 'chart', ico: 'chart',
    pdf: 'book', csv: 'list', tsv: 'list', lock: 'key'
  };
  if (byName[name]) { return byName[name]; }
  const extension = name.indexOf('.') >= 0 ? name.split('.').pop() : '';
  if (byExtension[extension]) { return byExtension[extension]; }
  return /\.(md|markdown)$/.test(name) || /(^|\/)docs\//.test(path) ? 'document' : 'code';
}

function banner(text) {
  const box = document.createElement('div');
  box.className = 'warn';
  const said = document.createElement('p');
  said.textContent = text;
  const do_ = document.createElement('div');
  do_.className = 'do';
  const token = document.createElement('button');
  token.type = 'button';
  token.className = 'az-btn az-btn--sm';
  token.textContent = 'Set a GitHub token';
  token.addEventListener('click', () => vscode.postMessage({ type: 'command', command: 'temcoRepositories.setToken' }));
  const again = document.createElement('button');
  again.type = 'button';
  again.className = 'az-btn az-btn--sm';
  again.textContent = 'Try again';
  again.addEventListener('click', () => vscode.postMessage({ type: 'files', files: [] }));
  do_.append(token, again);
  box.append(said, do_);
  return box;
}

function kilo(bytes) {
  return bytes >= 1024 ? (bytes / 1024).toFixed(1) + ' KB' : bytes + ' B';
}

function shortDate(stamp) {
  const date = new Date(stamp);
  return isNaN(date.getTime()) ? stamp : date.toLocaleDateString();
}
`;
