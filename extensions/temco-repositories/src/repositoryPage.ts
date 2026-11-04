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
import { commandScript, entry, hero, page, pageColumn, remember } from './ui';
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
    await this.send();
  }

  /** What the header says before the page has heard from the module: the figures, the org and the description. */
  private async facts(): Promise<PageFacts> {
    let catalog: Catalog | undefined;
    try {
      catalog = await Catalog.open(this.context);
      const organisations = catalog.organisations();
      const org = organisations.find((candidate) => candidate.slug === this.organisation)
        ?? organisations.find((candidate) => catalog?.repositoriesOf(candidate.slug).some((row) => row.name === this.name));
      const row = org === undefined ? undefined : catalog.repositoriesOf(org.slug).find((entry) => entry.name === this.name);
      const source = catalog.source(slugOf(this.name));
      const copy = await hasClone(this.name);
      const size = copy ? await cloneSize(this.name) : undefined;
      const cited = this.selection.project() === undefined
        ? false
        : catalog.documentSources(this.selection.project() as string).some((entry) => entry.name === this.name);
      const stats = [
        { value: copy ? 'cloned' : '—', label: copy ? (size ? `${size} on disk` : 'on disk') : 'no local copy' },
        { value: cited ? 'cited' : source === undefined ? 'not started' : 'recorded', label: 'in the project' },
      ];
      if (row?.language !== undefined) {
        stats.push({ value: row.language, label: 'language' });
      }
      return {
        organisation: org?.slug,
        description: row?.description,
        localCopy: copy,
        stats,
      };
    } catch {
      return { localCopy: false, stats: [] };
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
   * The files inside the repository — drawn here, with the kit's own row.
   *
   * A file is a row like a clone on the dashboard: the theme's glyph, the path, the size, and the way in. The markup is
   * made here rather than in the page so there is one entry vocabulary, and the click is a command the page's own
   * script posts, so the page never has to know which copy a file would come from.
   */
  private async sendFiles(): Promise<void> {
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
    const rows = listed.files.map((file: CodeFile) => {
      const mark = this.theme?.classFor(file.path);
      return entry({
        markHtml: mark === undefined ? undefined : `<span class="${mark}" aria-hidden="true"></span>`,
        mark: isDocumentation(file.path) ? 'document' : 'code',
        title: file.path,
        titleCommand: {
          command: 'temcoRepositories.openRepositoryFile',
          args: [this.name, file.path],
        },
        meta: [`${Math.max(1, Math.round(file.size / 1024))} KB`],
      });
    }).join('');
    const copy = await hasClone(this.name);
    const note = listed.files.length === 0
      ? 'This repository has no file to show.'
      : `${listed.files.length} ${listed.files.length === 1 ? 'file' : 'files'} · ${copy
        ? 'read from the clone on this machine'
        : 'read over the GitHub API — cloning makes it faster'}${listed.note === undefined ? '' : ` · ${listed.note}`}`;
    await panel.webview.postMessage({ type: 'files', rows, note });
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
        await this.sendFiles();
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
    await this.sendFiles();
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

function html(
  name: string,
  theme: FileIconTheme | undefined,
  resources: string,
  facts: PageFacts,
  last: WorkState | undefined
): string {
  const style = `
    /* This page has one job: be the place a clone, a pull and a repository all land on. Everything is flat — a hairline
       where a part ends, and nothing boxed, nothing tinted — so the header carries the page and the content carries the
       answer. */
    .repo { max-width: 1120px; }

    /* The acts sit under the header, on one line, in the order a person reaches for them. */
    .acts { display: flex; gap: 8px; flex-wrap: wrap; align-items: center; margin: 4px 0 0; }
    .acts__spacer { flex: 1 1 auto; }

    /* The state of the act: a line of text with a coloured word in front, not a bar. */
    .state { display: flex; gap: 8px; align-items: baseline; margin: 14px 0 0; font-size: 12px;
      line-height: 18px; color: var(--fg); }
    .state[hidden] { display: none; }
    .state__mark { flex: none; font-weight: 600; color: var(--fg-muted); }
    .state--ok .state__mark { color: var(--ok); }
    .state--err .state__mark { color: var(--err); }
    .state__text { min-width: 0; overflow-wrap: anywhere; }

    /* What the platform holds of it, as one quiet line: label in muted, value in ink, separated by middots. */
    .meta { display: flex; flex-wrap: wrap; gap: 2px 18px; margin: 12px 0 0; padding: 0;
      font-size: 12px; line-height: 18px; }
    .meta__pair { display: flex; gap: 6px; min-width: 0; }
    .meta__label { color: var(--fg-muted); }
    .meta__value { color: var(--fg); overflow-wrap: anywhere; }
    .meta__value--mono { font-family: var(--font-mono); font-size: 11px; }

    /* git's own words: monospace on the page's surface, with one hairline above it and nothing around it. */
    .log { margin: 12px 0 0; padding: 10px 0 0; max-height: 260px; overflow: auto;
      border-top: 1px solid var(--border); background: none; color: var(--fg-muted);
      font-family: var(--font-mono); font-size: 11px; line-height: 17px;
      white-space: pre-wrap; overflow-wrap: anywhere; }
    .log[hidden] { display: none; }
    .log__hide { margin: 4px 0 0; }

    /* The head of a part: the kit's section, with the count on the right. */
    .part { display: flex; align-items: flex-end; gap: 16px; margin: 28px 0 2px; }
    .part__text { flex: 1 1 auto; min-width: 0; }
    .part__note { margin: 3px 0 0; color: var(--fg-muted); font-size: 12px; line-height: 17px; }

    /* The foot: the one decision this page exists for. */
    .foot { display: flex; gap: 12px; flex-wrap: wrap; align-items: center; margin: 26px 0 0;
      padding-top: 14px; border-top: 1px solid var(--border); }
    .foot__summary { color: var(--fg-muted); font-size: 12px; flex: 1 1 16em; }
  `;

  const acts = `
    <button type="button" class="az-btn az-btn--primary" id="fetch"${last !== undefined || facts.localCopy ? '' : ''} hidden>${glyph('download')}<span>Clone the code</span></button>
    <button type="button" class="az-btn az-btn--primary" id="pull" hidden>${glyph('sync')}<span>Pull the latest</span></button>
    <button type="button" class="az-btn" id="start" hidden>${glyph('plus')}<span>Add to the project</span></button>
    <span class="acts__spacer"></span>
    <button type="button" class="az-btn az-btn--link" id="open-github">${glyph('globe')}<span>Open on GitHub</span></button>
    <button type="button" class="az-btn az-btn--link" id="copy-url">${glyph('link')}<span>Copy the clone URL</span></button>
    <button type="button" class="az-btn az-btn--link" id="refresh">${glyph('refresh')}<span>Refresh</span></button>
    <button type="button" class="az-btn az-btn--link" id="remove-copy" hidden>${glyph('close')}<span>Remove the clone</span></button>
  `;

  const head = hero({
    eyebrow: facts.organisation === undefined ? 'Repositories' : `${facts.organisation} · repositories`,
    mark: 'repo',
    title: name,
    desc: facts.description ?? 'No description on GitHub.',
    descWide: true,
    actionsHtml: acts,
    stats: facts.stats,
  });

  const body = `
  <div class="repo">
${head}
    <p class="state" id="state" role="status" hidden>
      <span class="state__mark" id="state-mark"></span>
      <span class="state__text" id="state-text"></span>
    </p>

    <div class="meta" id="meta"></div>
    <div id="error"></div>

    <pre class="log" id="log" aria-live="polite" hidden></pre>
    <div class="log__hide" id="log-hide" hidden>
      <button type="button" class="az-btn az-btn--sm az-btn--link" id="console-hide">Hide the output</button>
    </div>

    <div class="part">
      <div class="part__text">
        <h2 class="az-section__title">What is inside it</h2>
        <p class="part__note" id="files-note">Reading the file list…</p>
      </div>
    </div>
    <div id="files-error"></div>
    <div class="az-entries" id="files"></div>

    <div class="foot">
      <span class="foot__summary">Open a file, or start a project from this repository.</span>
      <button type="button" class="az-btn az-btn--primary" id="project">${glyph('plus')}<span id="project-label">Create a project from this repository</span></button>
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

/** What the header can say before the page has spoken to the module: the figures and the one line of context. */
interface PageFacts {
  organisation?: string;
  description?: string;
  localCopy: boolean;
  stats: { value: string; label: string }[];
}

/** One glyph from the page sprite, at the size the surrounding control asks for. */
function glyph(name: string): string {
  return `<svg viewBox="0 0 24 24" class="icon" aria-hidden="true"><use href="#i-${name}"></use></svg>`;
}

/**
 * The page's own behaviour.
 *
 * Two things it deliberately does not do: it never builds a row of the file list (the module renders those with the
 * kit's own `entry`, so a file and a clone read the same), and it never decides what a command means (the kit's click
 * handler posts it, and the module runs it).
 */
const CLIENT = `
const vscode = window.__temcoApi || (window.__temcoApi = acquireVsCodeApi());
const $ = (id) => document.getElementById(id);
let state = {};

$('refresh').addEventListener('click', () => vscode.postMessage({ type: 'state' }));
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
$('console-hide').addEventListener('click', () => hideLog());

drawWork(window.__temcoInitial);
vscode.postMessage({ type: 'ready' });

window.addEventListener('message', (event) => {
  const message = event.data || {};
  if (message.type === 'work') { drawWork(message.work); return; }
  if (message.type === 'log') { logLine(message.text); return; }
  if (message.type === 'state') {
    state = message;
    if (message.error) { $('error').replaceChildren(banner(message.error)); return; }
    $('error').replaceChildren();
    drawMeta();
    drawActions();
    vscode.postMessage({ type: 'files' });
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
  // The rows arrive drawn: the same entry the dashboard uses, so a file here and a clone there are one vocabulary.
  $('files').innerHTML = message.rows || '';
  $('files-note').textContent = message.note || '';
});

/** The facts, as one quiet line: what the platform holds of it, and where the copy is. */
function drawMeta() {
  const pairs = [];
  pairs.push(['Copy', state.localCopy ? 'cloned' + (state.copySize ? ' · ' + state.copySize : '') : 'not cloned yet']);
  pairs.push(['Folder', state.localCopy && state.path ? state.path : (state.where || 'not chosen'), true]);
  if (state.branch) { pairs.push(['Branch', state.branch]); }
  pairs.push(['Source', state.cited ? 'cited by the project' : state.isSource ? 'recorded, not cited' : 'not started']);
  const box = $('meta');
  box.replaceChildren();
  for (const [label, value, mono] of pairs) {
    const pair = document.createElement('span');
    pair.className = 'meta__pair';
    const name = document.createElement('span');
    name.className = 'meta__label';
    name.textContent = label;
    const detail = document.createElement('span');
    detail.className = 'meta__value' + (mono ? ' meta__value--mono' : '');
    detail.textContent = value;
    pair.append(name, detail);
    box.append(pair);
  }
}

/** The acts the facts allow: clone or pull, and start only while the project does not cite it. */
function drawActions() {
  $('fetch').hidden = Boolean(state.localCopy);
  $('pull').hidden = !state.localCopy;
  $('remove-copy').hidden = !state.localCopy;
  $('start').hidden = Boolean(state.cited);
}

/**
 * The state of the act, and git's lines under it.
 *
 * A run that starts clears the output and opens it; the verdict keeps it, so the end of a clone is readable after the
 * notification has gone.
 */
function drawWork(work) {
  const line = $('state');
  if (!work) { line.hidden = true; return; }
  line.hidden = false;
  line.className = 'state' + (work.state === 'ok' ? ' state--ok' : work.state === 'err' ? ' state--err' : '');
  $('state-mark').textContent = work.state === 'ok' ? 'Done' : work.state === 'err' ? 'Failed'
    : (work.act === 'clone' ? 'Cloning' : 'Pulling') + '…';
  $('state-text').textContent = work.text;
  if (work.state === 'running') { $('log').textContent = ''; showLog(); }
}

function logLine(text) {
  const log = $('log');
  const atEnd = log.scrollTop + log.clientHeight >= log.scrollHeight - 24;
  showLog();
  log.append(document.createTextNode((log.textContent ? '\\n' : '') + text));
  if (atEnd) { log.scrollTop = log.scrollHeight; }
}

function showLog() { $('log').hidden = false; $('log-hide').hidden = false; }
function hideLog() { $('log').hidden = true; $('log-hide').hidden = true; }

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
  again.addEventListener('click', () => vscode.postMessage({ type: 'files' }));
  do_.append(token, again);
  box.append(said, do_);
  return box;
}
`;
