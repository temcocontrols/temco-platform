// The AI page: the AI as something you own and configure, not a popup you dismiss.
//
// Four facts a person needs before trusting an answer — which runtime, which model, whether the server is up,
// and what instructions it was given — plus what can be downloaded, and a box to try it. The *Models and
// Runtime* quick pick still exists for keyboard use; this is the same information with room to stand back.
//
// It is a page about the AI in general, not about one project. A project's AI tab is where the AI meets that
// project's pages; this is where the AI itself is set up, and both point at each other.

import * as vscode from 'vscode';
import { MODELS, RUNTIMES, entryById, formatBytes, runtimeFor } from './ai/catalog';
import { install, installedArtifacts, modelRoot, uninstall } from './ai/install';
import { bestModel, describeMachine, fitsModel, machine } from './ai/machine';
import { PROMPT_VERSION } from './ai/prompts';
import { aiStatus, showAiLog, startAiServer, stopAiServer } from './ai/runtime';
import { pageColumn } from './docs';
import { hero, page, remember, runCommand, section } from './ui';
import { AI_PAGE_VIEW_TYPE } from './surface';

/** Somewhere on the page a caller can ask to be put: the list of what can be downloaded. */
export type AiSection = 'downloads';

interface AiPageMessage {
  type: 'ready' | 'download' | 'remove' | 'start' | 'stop' | 'folder' | 'log' | 'models' | 'apply' | 'command';
  id?: string;
  model?: string;
  runtime?: string;
  /** The command a `data-command` button on the page names. */
  command?: string;
  args?: unknown;
}

export class AiPage {
  private panel: vscode.WebviewPanel | undefined;
  private busy = '';
  /** Where to put the reader once the page has its data — `undefined` leaves them at the top. */
  private wanted: AiSection | undefined;

  constructor(private readonly context: vscode.ExtensionContext) { }

  /**
   * Opens the page, or brings it forward.
   *
   * A caller that already knows what the reader came for passes it — "choose a model" means the downloads, not
   * the top of a page about the AI in general. A window bringing the tab back passes the panel it restored, which is
   * then drawn into rather than replaced, so the tab keeps its place.
   */
  open(section?: AiSection, restored?: vscode.WebviewPanel): void {
    this.wanted = section;
    remember(this.context, AI_PAGE_VIEW_TYPE, section);
    if (this.panel) {
      this.panel.reveal(pageColumn());
      void this.seed();
      return;
    }

    this.panel = restored ?? vscode.window.createWebviewPanel(
      AI_PAGE_VIEW_TYPE,
      'Server & Prompts',
      pageColumn(),
      { enableScripts: true, localResourceRoots: [] }
    );
    this.panel.webview.options = { enableScripts: true, localResourceRoots: [] };
    this.panel.webview.html = html();
    this.panel.webview.onDidReceiveMessage((message: AiPageMessage) => void this.receive(message));
    this.panel.onDidDispose(() => {
      this.panel = undefined;
    });
  }

  private async receive(message: AiPageMessage): Promise<void> {
    switch (message.type) {
      case 'ready':
        await this.seed();
        return;
      case 'download':
        await this.download(message.id ?? '');
        return;
      case 'remove': {
        const id = message.id ?? '';
        if (installedArtifacts(this.context).some((artifact) => artifact.id === id)) {
          uninstall(this.context, id);
        }
        await this.seed();
        return;
      }
      case 'start':
        this.busy = 'starting';
        await this.seed();
        try {
          const info = await startAiServer(this.context);
          void vscode.window.showInformationMessage(`Temco AI: the local AI is on ${info.baseUrl}.`);
        } catch (error) {
          void vscode.window.showErrorMessage(`Temco AI: ${String(error)}`);
        }
        this.busy = '';
        await this.seed();
        return;
      case 'stop':
        stopAiServer();
        await this.seed();
        return;
      case 'folder':
        await vscode.env.openExternal(vscode.Uri.file(modelRoot(this.context)));
        return;
      case 'log':
        showAiLog();
        return;
      case 'command':
        // The page's own two ways out are commands, not messages: the kit's bridge names them, and this runs them.
        runCommand(message);
        return;
      case 'models':
        await vscode.commands.executeCommand('temcoAi.models');
        await this.seed();
        return;
      case 'apply': {
        const configuration = vscode.workspace.getConfiguration('temcoAi');
        await configuration.update('model', message.model ?? '', vscode.ConfigurationTarget.Global);
        await configuration.update('runtime', message.runtime ?? '', vscode.ConfigurationTarget.Global);
        await this.seed();
        return;
      }
    }
  }

  private async download(id: string): Promise<void> {
    const entry = entryById(id);
    if (!entry) {
      return;
    }

    this.busy = id;
    await this.seed();
    try {
      await install(this.context, entry);
      // Installing and choosing are separate acts, but a first install with nothing chosen would leave the
      // server unable to start for no reason. Choose it only when the choice is still empty.
      const key = entry.kind === 'runtime' ? 'runtime' : 'model';
      const configuration = vscode.workspace.getConfiguration('temcoAi');
      if (configuration.get<string>(key, '').length === 0) {
        await configuration.update(key, entry.id, vscode.ConfigurationTarget.Global);
      }
      void vscode.window.showInformationMessage(`Temco AI: ${entry.label} is installed.`);
    } catch (error) {
      const message = String(error instanceof Error ? error.message : error);
      const answer = await vscode.window.showWarningMessage(`Temco AI: ${message}`, 'Open Settings');
      if (answer === 'Open Settings') {
        await vscode.commands.executeCommand('workbench.action.openSettings', 'temcoAi.allowUnpinned');
      }
    }
    this.busy = '';
    await this.seed();
  }

  /** Whether the catalogue pins checksums for this kind at all — the wording of a refusal depends on it. */

  private async seed(): Promise<void> {
    if (!this.panel) {
      return;
    }
    const configuration = vscode.workspace.getConfiguration('temcoAi');
    const status = aiStatus(this.context);
    const installed = installedArtifacts(this.context);
    const have = new Set(installed.map((artifact) => artifact.id));

    const describe = (entry: (typeof RUNTIMES)[number]) => {
      const artifact = installed.find((one) => one.id === entry.id);
      return {
        id: entry.id,
        label: entry.label,
        licence: entry.licence,
        size: entry.bytes > 0 ? formatBytes(entry.bytes) : 'size not pinned',
        notes: entry.notes,
        pinned: entry.sha256.length > 0,
        needs: entry.needs,
        platform: [entry.platform, entry.architecture].filter(Boolean).join(' '),
        installed: have.has(entry.id),
        path: artifact?.path,
        installedAt: artifact?.installedAt,
        busy: this.busy === entry.id,
        suggested: entry.id === this.suggestions()[entry.kind],
        fit: entry.kind === 'model' ? fitsModel(entry, this.machine).why : undefined,
      };
    };

    const target = this.wanted;
    this.wanted = undefined;
    await this.panel.webview.postMessage({
      type: 'ai',
      facts: {
        runtime: status.runtime ? entryById(status.runtime.id)?.label ?? status.runtime.id : undefined,
        model: status.model ? entryById(status.model.id)?.label ?? status.model.id : undefined,
        running: status.running ? `${status.running.baseUrl} (${status.running.label})` : undefined,
        promptVersion: PROMPT_VERSION,
        root: modelRoot(this.context),
        machine: describeMachine(this.machine),
        suggested: this.suggestions(),
        busy: this.busy === 'starting' ? 'starting the server' : undefined,
      },
      chosen: {
        runtime: configuration.get<string>('runtime', ''),
        model: configuration.get<string>('model', ''),
      },
      installed: installed.map((artifact) => ({
        id: artifact.id,
        label: entryById(artifact.id)?.label ?? artifact.id,
        kind: artifact.kind,
        path: artifact.path,
        bytes: formatBytes(artifact.bytes),
        at: artifact.installedAt.slice(0, 16).replace('T', ' '),
      })),
      runtimes: RUNTIMES.map(describe),
      models: MODELS.map(describe),
    });

    // After the data, never before: the page has to have something to scroll to.
    if (target !== undefined) {
      await this.panel.webview.postMessage({ type: 'scroll', to: target });
    }
  }

  /** This machine, read once for each pass over the catalog list. */
  private get machine() {
    return machine();
  }

  /**
   * What to mark as the fit for this machine: the one runtime built for it, and the largest model it can hold.
   *
   * Both are answers about *this* computer, so they are read here rather than in the page: `process` and `os`
   * are the extension host's, and a webview that guessed at them would be guessing at the user's own machine.
   */
  private suggestions(): { runtime?: string; model?: string } {
    const here = this.machine;
    return {
      runtime: runtimeFor(here.platform, here.architecture)?.id,
      model: bestModel(here)?.id,
    };
  }
}

function html(): string {
  // The page's subject is the *server*: what answers, what it is told, and what it can be started with. The download
  // lists under it are the same subject one step out — a model is only useful because the server reads it.
  //
  // The only shapes here the kit has no component for are the server block itself and the picker inside it: a labelled
  // button that opens the list of what can answer, so a choice shows what it is before it is made.
  const style = `
    /* The brand bar every section title carries across the platform. */
    .az-section__title { position: relative; padding-left: 10px; }
    .az-section__title::before { content: ''; position: absolute; left: 0; top: 50%; transform: translateY(-50%); width: 2px; height: 12px; border-radius: 1px; background: var(--az-blue, #0078d4); }

    /* --- the server: a banded section, no side edges — the verdict and the repair acts on the first line, the two
       choices on the next, the facts they produce under them --- */
    .srv { border: 0; border-top: 1px solid var(--hairline); border-bottom: 1px solid var(--hairline);
           background: var(--surface-card); }
    .srv__head { display: flex; flex-wrap: wrap; align-items: center; gap: var(--sp-2) var(--sp-4);
                 padding: var(--sp-3) 0; border-bottom: 1px solid var(--hairline); }
    .srv__dot { flex: none; width: 8px; height: 8px; border-radius: 50%; background: var(--ink-3); }
    .srv__dot--on { background: var(--vscode-charts-green, #3fb950); }
    .srv__dot--wait { background: var(--vscode-charts-yellow, #d29922); }
    .srv__state { flex: 1 1 14em; min-width: 0; display: grid; gap: 1px; }
    .srv__verdict { color: var(--ink-1); font-size: 13px; line-height: 18px; }
    .srv__where { min-width: 0; color: var(--ink-3); font-family: var(--font-mono); font-size: 11.5px; line-height: 16px;
                  overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
    /* The three repairs sit with the verdict they belong to, not in a band of their own under the facts. */
    .srv__links { display: flex; flex-wrap: wrap; align-items: center; gap: 0 var(--sp-3); flex: none; }
    .srv__body { display: grid; gap: var(--sp-4); padding: var(--sp-4) 0 0; }
    /* The two choices share one line — they are one decision, made of two parts. */
    .srv__choices { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: var(--sp-6); }
    @media (max-width: 560px) { .srv__choices { grid-template-columns: minmax(0, 1fr); gap: var(--sp-3); } }
    /* The facts are the bottom row of the block: what the two choices above them produce. */
    .srv__facts { display: grid; grid-template-columns: repeat(3, minmax(0, 1fr)); gap: var(--sp-3) var(--sp-6);
                  margin: 0; padding: var(--sp-3) 0; border-top: 1px solid var(--hairline); }
    @media (max-width: 760px) { .srv__facts { grid-template-columns: minmax(0, 1fr); } }
    .srv__facts > div { min-width: 0; }
    .srv__facts dt { color: var(--ink-3); font-size: 10.5px; letter-spacing: .06em; text-transform: uppercase; }
    .srv__facts dd { margin: 2px 0 0; color: var(--ink-2); font-size: 12.5px; line-height: 17px; overflow-wrap: anywhere; }
    .srv__facts dd.mono { font-family: var(--font-mono); font-size: 11.5px; }

    /* --- a picker: the choice as a line of text that opens the list of what can answer — no box around it --- */
    .pick { position: relative; min-width: 0; }
    .pick__label { display: block; margin-bottom: 1px; color: var(--ink-3); font-size: 10.5px; letter-spacing: .06em;
                   text-transform: uppercase; }
    .pick__button { display: grid; grid-template-columns: 20px minmax(0, 1fr) 14px; align-items: center; gap: var(--sp-2);
                    width: 100%; padding: 3px var(--sp-2) 3px 0; border: 0; border-radius: var(--r-2); background: none;
                    color: inherit; font: inherit; text-align: left; cursor: pointer; }
    .pick__button:hover { background: var(--az-blue-selected, rgba(0, 120, 212, .08)); }
    .pick__button:focus-visible { outline: 2px solid var(--az-blue, #0078d4); outline-offset: 1px; }
    .pick__mark { display: grid; place-items: center; color: var(--ink-3); }
    .pick__mark .icon, .pick__chevron .icon { width: 14px; height: 14px; }
    .pick__text { display: grid; gap: 0; min-width: 0; }
    .pick__value { color: var(--az-blue, #0078d4); font-size: 13px; line-height: 18px; overflow: hidden;
                   text-overflow: ellipsis; white-space: nowrap; }
    .pick__button:hover .pick__value { text-decoration: underline; }
    .pick__value--empty { color: var(--ink-3); }
    .pick__meta { color: var(--ink-3); font-size: 11.5px; line-height: 15px; overflow: hidden; text-overflow: ellipsis;
                  white-space: nowrap; }
    .pick__chevron { display: grid; place-items: center; color: var(--ink-3); transition: transform 120ms ease; }
    .pick--open .pick__chevron { transform: rotate(180deg); }
    .pick__menu { position: absolute; z-index: 20; top: calc(100% + 2px); left: -4px; min-width: calc(100% + 8px);
                  width: max-content; max-width: min(340px, 88vw); display: none; max-height: 264px; overflow-y: auto;
                  padding: var(--sp-1); border: 0; border-radius: var(--r-2);
                  background: var(--vscode-dropdown-background, var(--surface-card));
                  box-shadow: 0 6px 16px rgba(0, 0, 0, .26); }
    .pick--open .pick__menu { display: block; }
    .pick__option { display: grid; grid-template-columns: 14px minmax(0, 1fr); align-items: center; gap: var(--sp-2);
                    width: 100%; padding: 5px var(--sp-2); border: 0; border-radius: var(--r-2); background: none;
                    color: inherit; font: inherit; text-align: left; cursor: pointer; }
    .pick__option:hover, .pick__option:focus-visible { background: var(--az-blue-selected, rgba(0, 120, 212, .1));
                                                       outline: none; }
    .pick__option[aria-selected="true"] { background: var(--az-blue-selected, rgba(0, 120, 212, .14)); }
    .pick__option-mark { display: grid; place-items: center; color: var(--az-blue, #0078d4); }
    .pick__option-mark .icon { width: 13px; height: 13px; }
    .pick__option-name { display: block; color: var(--ink-1); font-size: 12.5px; line-height: 17px; white-space: nowrap; }
    .pick__option-meta { display: block; color: var(--ink-3); font-size: 11px; line-height: 15px; white-space: nowrap; }
    .pick__empty { padding: var(--sp-2); color: var(--ink-3); font-size: 12px; line-height: 17px; }

    /* One thing that can be downloaded, as the kit draws an entry: its state is words in the meta line, not a pill. */
    .dl-row { display: grid; grid-template-columns: minmax(0, 1fr) auto; align-items: center; gap: var(--sp-2); }
    .dl-row > .az-entry { border: 0; background: none; padding-left: 0; }

    /* The other platforms: out of the way until they are asked for. */
    .ai-more { margin-top: var(--sp-2); }
    .ai-more > summary { padding: 2px 0; color: var(--ink-3); font-size: 12px; cursor: pointer; }
    .ai-more > summary:hover { color: var(--az-blue, #0078d4); }
    .ai-hidden { display: none !important; }
    .ai-foot { margin: var(--sp-6) 0 0; padding-top: var(--sp-3); border-top: 1px solid var(--hairline);
               color: var(--ink-3); font-size: 12px; line-height: 18px; max-width: 72ch; }
  `;

  const body = `${hero({
    eyebrow: 'Temco AI',
    title: 'Server & Prompts',
    mark: 'server',
    desc: 'What answers your questions, and what it is told before it answers. The server listens on loopback only, starts when something needs it, and stops itself when nothing has for a while — nothing leaves this machine.',
    actions: [
      { label: 'Show the panel', command: 'temcoAi.openPanel', mark: 'panel', kind: 'primary' as const },
      { label: 'Local Models', command: 'temcoAi.localModels', mark: 'chip', kind: 'link' as const }
    ]
  })}
<div class="mt-24">
  ${section({ title: 'The server', desc: 'The two things it starts with, and the instructions it is given. Both choices are settings, so they survive a restart — and neither switches behind the reader’s back.' })}
  <div class="mt-8" id="status"></div>
</div>
<div id="downloads">
  <div class="mt-24">${section({ title: 'Runtimes', desc: 'The engine that does the work, compiled per platform — the build marked suggested is the one for this machine.' })}</div>
  <div id="runtimes"></div>
  <div class="mt-24" id="modelList">
    ${section({ title: 'Models', desc: 'What the engine reads. Permissive licences only; each shows its licence and what it needs before it is downloaded.' })}
    <div id="models"></div>
  </div>
  <div class="mt-24 ai-hidden" id="alsoWrap">${section({ title: 'Also in the folder', desc: 'Files in the model folder that this list does not know about — installed elsewhere, or left by an older version.' })}<div id="also"></div></div>
</div>
<p class="ai-foot" id="foot"></p>
`;

  return page(body, { title: 'Server & Prompts', extraCss: style, script: CLIENT });
}

const CLIENT = `
const vscode = acquireVsCodeApi();
const $ = (id) => document.getElementById(id);
let selection = { runtime: '', model: '' };

// A button carrying data-command names a real command — the kit's bridge, which every page of ours uses. The rest of
// the page speaks the small message protocol below, because a download is not a command.
document.addEventListener('click', (event) => {
  const target = event.target.closest('[data-command]');
  if (!target) { return; }
  event.preventDefault();
  const args = target.dataset.args;
  vscode.postMessage({
    type: 'command',
    command: target.dataset.command,
    args: args === undefined ? undefined : JSON.parse(args),
  });
});

// One open picker at a time: a click anywhere else puts it away, so the choice and its list never both stay open.
document.addEventListener('click', (event) => {
  for (const wrap of Array.prototype.slice.call(document.querySelectorAll('.pick--open'))) {
    if (!wrap.contains(event.target)) {
      wrap.classList.remove('pick--open');
      const opener = wrap.querySelector('.pick__button');
      if (opener) { opener.setAttribute('aria-expanded', 'false'); }
    }
  }
});

function el(tag, cls, text) {
  const node = document.createElement(tag);
  if (cls) { node.className = cls; }
  if (text !== undefined) { node.textContent = text; }
  return node;
}

/** One glyph from the page's sprite, so this page draws the same marks as every other. */
function mark(name) {
  const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
  svg.setAttribute('class', 'icon');
  svg.setAttribute('aria-hidden', 'true');
  const use = document.createElementNS('http://www.w3.org/2000/svg', 'use');
  use.setAttribute('href', '#i-' + name);
  svg.append(use);
  return svg;
}

function button(text, kind, onClick, disabled) {
  const cls = kind === 'primary' ? 'az-btn az-btn--sm az-btn--primary'
    : kind === 'link' ? 'az-btn az-btn--sm az-btn--link'
      : 'az-btn az-btn--sm';
  const node = el('button', cls);
  node.type = 'button';
  node.append(el('span', null, text));
  node.disabled = Boolean(disabled);
  node.addEventListener('click', onClick);
  return node;
}

/** One entry lying on its side, as the kit draws it: the mark, the name, and the lines about it. */
function entry(markName, title, lines) {
  const row = el('div', 'az-entry');
  const icon = el('span', 'az-entry__icon');
  icon.append(mark(markName));
  const main = el('div', 'az-entry__main');
  main.append(el('span', 'az-entry__title', title));
  for (const line of lines.filter(Boolean)) { main.append(el('span', 'az-entry__meta', line)); }
  row.append(icon, main);
  return row;
}

/** The entry, then whatever belongs at its right-hand end. */
function rowOf(parts) {
  const row = el('div', 'dl-row');
  row.append(...parts);
  return row;
}

/** One line of the server's own facts: a label in the small tier, then the value. */
function fact(label, value, mono) {
  const wrap = el('div');
  wrap.append(el('dt', null, label), el('dd', mono ? 'mono' : null, value));
  return wrap;
}

/**
 * One choice the server starts with, as a labelled button that opens the list of what can answer.
 *
 * A native select holds names only, and a name is not enough to choose by: two runtimes differ by platform, two
 * models by size and by whether this machine can hold them. So the list carries the facts, and the button carries the
 * choice — the same information before and after it is made.
 */
function picker(labelText, key, entries) {
  const installed = entries.filter((entry) => entry.installed);
  const chosenId = selection[key];
  const chosen = entries.find((entry) => entry.id === chosenId);
  const suggested = entries.find((entry) => entry.suggested);

  const wrap = el('div', 'pick');
  wrap.append(el('span', 'pick__label', labelText));

  const open = el('button', 'pick__button');
  open.type = 'button';
  open.setAttribute('aria-haspopup', 'listbox');
  open.setAttribute('aria-expanded', 'false');

  const markBox = el('span', 'pick__mark');
  markBox.append(mark(key === 'runtime' ? 'server' : 'chip'));

  const text = el('span', 'pick__text');
  const value = el('span', 'pick__value' + (chosen ? '' : ' pick__value--empty'), chosen
    ? chosen.label
    : installed.length === 0 ? 'nothing installed yet' : 'not chosen');
  const meta = el('span', 'pick__meta', chosen
    ? [chosen.size, chosen.platform, chosen.suggested ? 'suggested for this machine' : ''].filter(Boolean).join(' · ')
    : installed.length === 0
      ? 'download one below — the list is empty until then'
      : [installed.length + ' installed', suggested ? suggested.label + ' is suggested' : ''].filter(Boolean).join(' · '));
  text.append(value, meta);

  const chevron = el('span', 'pick__chevron');
  chevron.append(mark('chevron-down'));
  open.append(markBox, text, chevron);

  const menu = el('div', 'pick__menu');
  menu.setAttribute('role', 'listbox');
  menu.setAttribute('aria-label', labelText);

  if (installed.length === 0) {
    menu.append(el('div', 'pick__empty',
      'Nothing is installed, so there is nothing to choose. Download one from the lists below and it appears here.'));
  }
  // The chosen one first, then the rest in the order they were listed: the list is short, and the answer to "what is
  // it on now" should not need a scan.
  const ordered = installed.slice().sort((a, b) => Number(b.id === chosenId) - Number(a.id === chosenId));
  for (const item of ordered) {
    const option = el('button', 'pick__option');
    option.type = 'button';
    option.setAttribute('role', 'option');
    option.dataset.id = item.id;
    const selected = item.id === chosenId;
    option.setAttribute('aria-selected', selected ? 'true' : 'false');
    const tick = el('span', 'pick__option-mark');
    if (selected) {
      tick.append(mark('check'));
    }
    const body = el('span');
    body.append(
      el('span', 'pick__option-name', item.label),
      el('span', 'pick__option-meta', [item.size, item.platform, item.suggested ? 'suggested' : '',
        item.licence].filter(Boolean).join(' · '))
    );
    option.append(tick, body);
    option.addEventListener('click', () => {
      selection[key] = item.id;
      // Both are always sent: the settings are two keys, and the server needs both to start.
      vscode.postMessage({ type: 'apply', runtime: selection.runtime, model: selection.model });
    });
    menu.append(option);
  }
  wrap.append(open, menu);

  const close = (focus) => {
    wrap.classList.remove('pick--open');
    open.setAttribute('aria-expanded', 'false');
    if (focus) {
      open.focus();
    }
  };
  open.addEventListener('click', () => {
    const isOpen = wrap.classList.toggle('pick--open');
    open.setAttribute('aria-expanded', isOpen ? 'true' : 'false');
    if (isOpen) {
      const first = menu.querySelector('.pick__option');
      (first || open).focus();
    }
  });
  wrap.addEventListener('keydown', (event) => {
    const options = Array.prototype.slice.call(menu.querySelectorAll('.pick__option'));
    const at = options.indexOf(document.activeElement);
    if (event.key === 'Escape') {
      event.preventDefault();
      close(true);
    } else if (event.key === 'ArrowDown') {
      event.preventDefault();
      (options[at + 1] || options[0] || open).focus();
    } else if (event.key === 'ArrowUp') {
      event.preventDefault();
      (options[at - 1] || options[options.length - 1] || open).focus();
    } else if (event.key === 'Tab') {
      close(false);
    }
  });
  return wrap;
}

/** The server, in one block: its verdict and the act that changes it, the two choices it starts with, its facts. */
function renderServer(data) {
  const facts = data.facts;
  selection = { runtime: data.chosen.runtime, model: data.chosen.model };
  const running = Boolean(facts.running);

  const box = el('div', 'srv');

  const head = el('div', 'srv__head');
  head.append(el('span', 'srv__dot' + (facts.busy ? ' srv__dot--wait' : running ? ' srv__dot--on' : '')));
  const ready = Boolean(facts.model && facts.runtime);
  const state = el('div', 'srv__state');
  state.append(
    el('span', 'srv__verdict', facts.busy ? 'Starting…'
      : running ? 'Running — answering while something needs it'
        : ready ? 'Not running — it starts on the first question, and stops itself when the last one is answered'
          : 'Nothing to start yet — choose a runtime and a model below'),
    el('span', 'srv__where', running ? facts.running
      : ready ? 'loopback only, and only while it is up'
        : 'one model file and one runtime are all it takes')
  );
  head.append(state);

  // The repairs sit on the verdict's own row: nothing here is a step in a sequence, so a band of their own would have
  // given them weight they do not have.
  const links = el('div', 'srv__links');
  links.append(
    button('Show the log', 'link', () => vscode.postMessage({ type: 'log' })),
    button('Open the model folder', 'link', () => vscode.postMessage({ type: 'folder' })),
    button('Download a model…', 'link', () => {
      const at = $('modelList') || $('downloads');
      if (at) {
        at.scrollIntoView({ block: 'start', behavior: 'smooth' });
      }
    })
  );
  head.append(links);
  head.append(running
    ? button('Stop the server', null, () => vscode.postMessage({ type: 'stop' }))
    : button(facts.busy ? 'Starting…' : 'Start the server', 'primary',
      () => vscode.postMessage({ type: 'start' }),
      Boolean(facts.busy) || !facts.model || !facts.runtime));
  box.append(head);

  const body = el('div', 'srv__body');
  const choices = el('div', 'srv__choices');
  choices.append(
    picker('Runtime', 'runtime', data.runtimes),
    picker('Model', 'model', data.models)
  );
  body.append(choices);

  const list = el('dl', 'srv__facts');
  list.append(
    fact('Instructions', facts.promptVersion),
    fact('This machine', facts.machine || 'it could not be read'),
    fact('Where they live', facts.root, true)
  );
  body.append(list);
  box.append(body);

  $('status').replaceChildren(box);
}

/** One thing that can be downloaded, or one that is already here: what it is, what it needs, and the one control. */
function renderEntry(item) {
  // The state is said in the same line as the facts, in words: a pill beside a name reads as decoration, and this is
  // the sentence that decides whether the row is worth a click.
  const state = item.installed ? 'installed' : item.suggested ? 'suggested for this machine' : '';
  const parts = [state, item.licence, item.size];
  if (item.platform) { parts.push(item.platform); }
  if (item.needs) { parts.push(item.needs); }
  if (item.fit && item.suggested) { parts.push(item.fit); }

  const lines = [parts.filter(Boolean).join(' · ')];
  if (item.fit && !item.suggested) { lines.push(item.fit); }
  if (!item.pinned) { lines.push('checksum not pinned — the download is checked against the recorded size only'); }
  if (item.path) { lines.push('Installed: ' + item.path); }

  const trailing = [];
  if (item.installed) {
    trailing.push(button('Remove', 'link', () => vscode.postMessage({ type: 'remove', id: item.id })));
  } else {
    trailing.push(
      button(
        item.busy ? 'Downloading…' : 'Download',
        item.suggested ? 'primary' : null,
        () => vscode.postMessage({ type: 'download', id: item.id }),
        item.busy
      )
    );
  }

  return rowOf([entry(item.kind === 'runtime' ? 'server' : 'package', item.label, lines), ...trailing]);
}

/** The runtimes: this machine's build first, the other platforms folded away. */
function renderRuntimes(data) {
  const mine = data.runtimes.filter((item) => item.suggested || item.installed);
  const others = data.runtimes.filter((item) => !item.suggested && !item.installed);
  const host = $('runtimes');
  host.replaceChildren();

  if (mine.length === 0) {
    // Nothing matched this machine: the list is then just the list, rather than an empty first line.
    host.append(...data.runtimes.map(renderEntry));
    return;
  }
  host.append(...mine.map(renderEntry));
  if (others.length > 0) {
    const more = el('details', 'ai-more');
    const summary = el('summary', null, others.length === 1 ? 'Another platform' : 'Other platforms (' + others.length + ')');
    more.append(summary);
    const body = el('div');
    body.append(...others.map(renderEntry));
    more.append(body);
    host.append(more);
  }
}

/** The models: the one for this machine first, then the rest of the ladder. */
function renderModels(data) {
  const ordered = data.models.slice().sort((a, b) => Number(b.suggested) - Number(a.suggested));
  $('models').replaceChildren(...ordered.map(renderEntry));
}

/** Anything on disk this list cannot name — kept visible, because a file that is there is a fact. */
function renderAlso(data) {
  const known = new Set([...data.runtimes, ...data.models].map((item) => item.id));
  const unknown = data.installed.filter((artifact) => !known.has(artifact.id));
  $('alsoWrap').classList.toggle('ai-hidden', unknown.length === 0);
  $('also').replaceChildren(
    ...unknown.map((artifact) =>
      rowOf([
        entry(
          artifact.kind === 'runtime' ? 'server' : 'package',
          artifact.label,
          [artifact.kind + ' · ' + artifact.bytes + ' · added ' + artifact.at, artifact.path]
        ),
        button('Remove', 'link', () => vscode.postMessage({ type: 'remove', id: artifact.id }))
      ])
    )
  );
}

/** The one line under the page: what removing costs, and the repair for a panel that was dragged somewhere else. */
function renderFoot() {
  const foot = $('foot');
  foot.replaceChildren(
    el('span', null,
      'Removing one deletes that file and nothing else: the settings keep the choice, and the server says it is ' +
      'missing until another is installed. '),
    button('Put the panel back in the right side bar', 'link',
      () => vscode.postMessage({ type: 'command', command: 'temcoAi.dockRight' }))
  );
}

function render(data) {
  renderServer(data);
  renderRuntimes(data);
  renderModels(data);
  renderAlso(data);
  renderFoot();
}

window.addEventListener('message', (event) => {
  if (event.data.type === 'ai') {
    render(event.data);
  }
  if (event.data.type === 'scroll') {
    // Asked for a section: the page is long and "choose a model" means the downloads, not the top.
    const target = document.getElementById(event.data.to);
    if (target) { target.scrollIntoView({ block: 'start' }); }
  }
});

vscode.postMessage({ type: 'ready' });
`;
