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
import { page, pageColumn, remember } from './ui';
import { cloneSize, hasClone, projectFor } from './workarea';

export const REPOSITORY_DETAIL_VIEW_TYPE = 'temcoRepositories.repositoryDetail';

interface DetailMessage {
  type?: string;
  url?: string;
  text?: string;
  files?: string[];
  /** The file a row asked to open. */
  path?: string;
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
    private readonly refresh: () => void
  ) { }

  /** The file icon theme, read once per render: what a row's glyph is drawn from. */
  private theme: FileIconTheme | undefined;

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
    panel.webview.html = html(this.name, this.theme, panel.webview.cspSource);
    await this.send();
  }

  /** The row, the source and the local copy — one message, so the page never draws half a repository. */
  private async send(): Promise<void> {
    const panel = this.panel;
    if (!panel) {
      return;
    }
    const project = this.selection.project();
    const state: DetailState = { name: this.name, isSource: false, localCopy: false, cited: false, project };

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
        // A clone needs the source recorded, not a project: copying the code is not citing it.
        await this.record();
        await vscode.commands.executeCommand('temcoRepositories.fetchSource', slugOf(this.name));
        this.refresh();
        await this.send();
        return;
      case 'pull':
        await vscode.commands.executeCommand('temcoRepositories.pullSource', slugOf(this.name));
        this.refresh();
        await this.send();
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

function html(name: string, theme: FileIconTheme | undefined, resources: string): string {
  const style = `
    /* The same vocabulary as the dashboard: fills, spacing, one hairline between rows, and no boxes. */
    .toolbar { display: flex; gap: .5em; align-items: center; flex-wrap: wrap; }
    .toolbar .input { flex: 1 1 16em; min-width: 9em; }
    .toolbar[hidden] { display: none; }

    /* A file is a line you can press: what it is, where it is, how big, and it opens. */
    .files { margin: .4em 0 0; }
    .file { display: grid; grid-template-columns: auto minmax(0, 1fr) auto; gap: 0 .6em; align-items: center;
            padding: .45em .4em; border-bottom: 1px solid var(--border); cursor: pointer;
            background: none; border-left: 0; border-right: 0; border-top: 0; width: 100%; text-align: left;
            font: inherit; color: inherit; }
    .file:last-child { border-bottom: 0; }
    .file:hover { background: var(--bg-hover); }
    .file:focus-visible { outline: 1px solid var(--focus); outline-offset: -1px; }
    .file__glyph { color: var(--fg-subtle); display: inline-flex; }
    .file__path { color: var(--fg); font-size: var(--fs-sm); overflow-wrap: anywhere; }
    .file__meta { color: var(--fg-subtle); font-size: var(--fs-xs); white-space: nowrap; font-variant-numeric: tabular-nums; }

    /* The warning is a tinted surface, not a bordered box: it has to be recognisable across the room. */
    .warn { border-radius: var(--r-8); padding: .8em 1em; margin: 1em 0;
            background: color-mix(in srgb, var(--warn) 22%, var(--bg-inset)); color: var(--fg); }
    .warn p { margin: 0; }
    .warn .do { display: flex; gap: .5em; margin: .7em 0 0; }
    .empty { color: var(--fg-muted); padding: .9em 0; }

    /* The foot is the one decision the page exists for, so it stays in reach of the list it is about. */
    .foot { display: flex; gap: .8em; flex-wrap: wrap; align-items: center; margin: 1.2em 0 0;
            padding-top: 1em; border-top: 1px solid var(--border); }
    .foot__summary { color: var(--fg-muted); font-size: var(--fs-sm); flex: 1 1 16em; }
  `;

  const body = `
  <div class="az-wash"><header class="az-lead">
    <h1 class="az-title" id="title">${name}</h1>
    <p class="az-intro az-intro--wide" id="lede">Reading what the platform holds of it…</p>
    <div class="az-row">
      <button type="button" class="az-btn az-btn--primary" id="fetch">${glyph('download')}<span>Clone the code</span></button>
      <button type="button" class="az-btn az-btn--primary" id="pull" hidden>${glyph('upload')}<span>Pull the latest</span></button>
      <button type="button" class="az-btn az-btn--primary" id="start" hidden>${glyph('plus')}<span>Start — add it to the project</span></button>
      <button type="button" class="az-btn" id="open-github">${glyph('globe')}<span>Open on GitHub</span></button>
      <button type="button" class="az-btn" id="copy-url">${glyph('link')}<span>Copy the clone URL</span></button>
      <button type="button" class="az-btn" id="reload">${glyph('refresh')}<span>Refresh</span></button>
      <button type="button" class="az-btn" id="remove-copy" hidden>${glyph('close')}<span>Remove the clone</span></button>
    </div>
  </header></div>

  <p class="az-note" id="facts"></p>
  <div id="error"></div>

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
  `;

  return page(body, {
    title: name,
    extraCss: style + (theme?.css ?? ''),
    resources,
    script: CLIENT,
  });
}

/** One glyph from the page sprite, at the size the surrounding control asks for. */
function glyph(name: string): string {
  return `<svg viewBox="0 0 24 24" class="icon" aria-hidden="true"><use href="#i-${name}"></use></svg>`;
}

const CLIENT = `
const vscode = acquireVsCodeApi();
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

window.addEventListener('message', (event) => {
  const message = event.data || {};
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

/** What the platform holds of this repository, as one sentence under the header. */
function drawFacts() {
  const parts = [];
  if (state.row) {
    if (state.row.language) { parts.push(state.row.language); }
    if (state.row.pushedAt) { parts.push('pushed ' + shortDate(state.row.pushedAt)); }
    parts.push(state.row.isPrivate ? 'private' : 'public');
  }
  if (state.cited) { parts.push('source of this project'); }
  else if (state.isSource) { parts.push('recorded, not cited by this project'); }
  else { parts.push('not started'); }
  parts.push(state.localCopy
    ? 'clone' + (state.copySize ? ' · ' + state.copySize : ' ready')
    : 'not cloned — Clone reads it into the working area');
  $('facts').textContent = parts.join(' · ');
  $('lede').textContent = (state.organisation ? state.organisation + ' · ' : '')
    + (state.row && state.row.description ? state.row.description : 'No description.')
    + (state.project ? ' · project ' + state.project : ' · no project is being worked on');
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
