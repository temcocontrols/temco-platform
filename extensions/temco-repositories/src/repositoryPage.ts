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
import { page, pageColumn, remember } from './ui';
import { cloneSize, hasClone } from './workarea';

export const REPOSITORY_DETAIL_VIEW_TYPE = 'temcoRepositories.repositoryDetail';

interface DetailMessage {
  type?: string;
  url?: string;
  text?: string;
  files?: string[];
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
    private readonly refresh: () => void
  ) { }

  open(name: string, organisation?: string): void {
    remember(this.context, REPOSITORY_DETAIL_VIEW_TYPE, name);
    this.name = name;
    this.organisation = organisation;
    if (this.panel) {
      this.panel.title = name;
      this.panel.reveal(pageColumn());
      void this.render();
      return;
    }
    this.panel = vscode.window.createWebviewPanel(REPOSITORY_DETAIL_VIEW_TYPE, name, pageColumn(), {
      enableScripts: true,
      localResourceRoots: [],
    });
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
    panel.webview.html = html(this.name);
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
        state.localCopy = await hasClone(project, this.name);
        state.copySize = state.localCopy ? (await cloneSize(project, this.name)) ?? '' : undefined;
      }
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
        // Fetching a repository that was never started makes it a source first: a clone belongs to a source.
        await this.start();
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

  /** Records the repository as a source of the project being worked on — the same act as *Start* on the dashboard. */
  private async start(): Promise<void> {
    const project = this.selection.project();
    if (project === undefined) {
      void vscode.window.showInformationMessage(
        'Temco Repositories: a source belongs to a project being worked on. Choose one first — the Library’s Projects row.',
        'Projects'
      ).then((answer) => {
        if (answer === 'Projects') {
          void vscode.commands.executeCommand('temcoDocs.projects');
        }
      });
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

function html(name: string): string {
  const style = `
    /* The same vocabulary as the dashboard: fills, spacing, one hairline between rows, and no boxes. */
    .toolbar { display: flex; gap: .5em; align-items: center; flex-wrap: wrap; }
    .toolbar .input { flex: 1 1 16em; min-width: 9em; }
    .toolbar[hidden] { display: none; }

    /* A file is a line: what it is, where it is, how big. The tick decides whether it starts the project. */
    .files { margin: .4em 0 0; }
    .file { display: grid; grid-template-columns: auto auto minmax(0, 1fr) auto; gap: 0 .6em; align-items: center;
            padding: .45em .4em; border-bottom: 1px solid var(--border); }
    .file:last-child { border-bottom: 0; }
    .file:hover { background: var(--bg-hover); }
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
      <button type="button" class="az-btn az-btn--primary" id="fetch">${glyph('download')}<span>Download the code</span></button>
      <button type="button" class="az-btn az-btn--primary" id="pull" hidden>${glyph('upload')}<span>Pull the latest</span></button>
      <button type="button" class="az-btn az-btn--primary" id="start" hidden>${glyph('plus')}<span>Start — add it to the project</span></button>
      <button type="button" class="az-btn" id="open-github">${glyph('globe')}<span>Open on GitHub</span></button>
      <button type="button" class="az-btn" id="copy-url">${glyph('link')}<span>Copy the clone URL</span></button>
      <button type="button" class="az-btn" id="reload">${glyph('refresh')}<span>Refresh</span></button>
      <button type="button" class="az-btn" id="remove-copy" hidden>${glyph('close')}<span>Remove the local copy</span></button>
    </div>
  </header></div>

  <p class="az-note" id="facts"></p>
  <div id="error"></div>

  <section class="az-section">
    <div class="az-section__text">
      <h2 class="az-section__title">What is inside it</h2>
      <p class="az-section__desc" id="files-note">Reading the file list…</p>
    </div>
    <div class="az-section__actions" id="bar" hidden>
      <div class="toolbar">
        <input class="input" type="search" id="filter" placeholder="Filter by path" aria-label="Filter files">
        <button type="button" class="az-btn az-btn--sm" id="all">Select all</button>
        <button type="button" class="az-btn az-btn--sm" id="none">Clear</button>
      </div>
    </div>
  </section>
  <div id="files-error"></div>
  <div class="files" id="files"></div>

  <div class="foot">
    <span class="foot__summary" id="summary">No file selected.</span>
    <button type="button" class="az-btn az-btn--primary" id="project">${glyph('plus')}<span id="project-label">Create a project from this repository</span></button>
  </div>
  `;

  return page(body, { title: name, extraCss: style, script: CLIENT });
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
$('project').addEventListener('click', () => vscode.postMessage({ type: 'project', files: ticked() }));
$('all').addEventListener('click', () => { setAll(true); });
$('none').addEventListener('click', () => { setAll(false); });
$('filter').addEventListener('input', () => draw());

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
    vscode.postMessage({ type: 'files', files: ticked() });
    return;
  }
  if (message.type !== 'files') { return; }
  if (message.error) {
    $('files-error').replaceChildren(banner(message.error));
    $('files').replaceChildren();
    $('bar').hidden = true;
    $('files-note').textContent = 'The list could not be read.';
    drawSummary();
    return;
  }
  $('files-error').replaceChildren();
  files = message.files || [];
  note = message.note || '';
  $('bar').hidden = files.length === 0;
  $('files-note').textContent = (state.localCopy
    ? 'Read from the local copy in the working area.'
    : 'Read over the GitHub API, because there is no local copy. Downloading one makes this faster and gives the history behind each file.')
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
    ? 'local copy' + (state.copySize ? ' · ' + state.copySize : ' ready')
    : 'no local copy — Download reads it into the working area');
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
  const needle = $('filter').value.trim().toLowerCase();
  const shown = files.filter((file) => needle.length === 0 || file.path.toLowerCase().includes(needle));
  if (shown.length === 0) {
    const empty = document.createElement('div');
    empty.className = 'empty';
    empty.textContent = files.length === 0 ? 'This repository has no file to show.' : 'No file matches that filter.';
    $('files').replaceChildren(empty);
    drawSummary();
    return;
  }
  $('files').replaceChildren(...shown.map((file) => {
    const line = document.createElement('div');
    line.className = 'file';
    const tick = document.createElement('input');
    tick.type = 'checkbox';
    tick.checked = Boolean(file.ticked);
    tick.setAttribute('aria-label', 'Select ' + file.path);
    tick.addEventListener('change', () => { file.ticked = tick.checked; drawSummary(); });
    // The glyph says what kind of file it is before the path is read: a page, or code.
    const mark = document.createElement('span');
    mark.className = 'file__glyph';
    mark.innerHTML = '<svg viewBox="0 0 24 24" class="icon icon--sm" aria-hidden="true"><use href="#i-'
      + (file.category === 'docs' ? 'document' : 'code') + '"></use></svg>';
    const path = document.createElement('span');
    path.className = 'file__path';
    path.textContent = file.path;
    const size = document.createElement('span');
    size.className = 'file__meta';
    size.textContent = (file.category === 'docs' ? 'doc · ' : '') + kilo(file.size);
    line.append(tick, mark, path, size);
    return line;
  }));
  drawSummary();
}

function ticked() {
  return files.filter((file) => file.ticked).map((file) => file.path);
}

function setAll(value) {
  const needle = $('filter').value.trim().toLowerCase();
  files.forEach((file) => {
    if (needle.length === 0 || file.path.toLowerCase().includes(needle)) { file.ticked = value; }
  });
  draw();
}

function drawSummary() {
  const chosen = files.filter((file) => file.ticked);
  const bytes = chosen.reduce((total, file) => total + file.size, 0);
  $('summary').textContent = chosen.length === 0
    ? 'No file selected — a project can start with none, and its files are picked again there.'
    : chosen.length + (chosen.length === 1 ? ' file · ' : ' files · ') + kilo(bytes);
  $('project-label').textContent = chosen.length === 0
    ? 'Create a project from this repository'
    : 'Create a project from these ' + chosen.length + (chosen.length === 1 ? ' file' : ' files');
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
