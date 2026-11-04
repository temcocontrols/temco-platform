// The clone, while it happens: a small page that says what git is doing.
//
// A progress notification is one line, and a clone is a long conversation — "remote: Enumerating objects", "Receiving
// objects: 45% (12/27)". This is the page that conversation belongs on. It opens when the clone starts, keeps the whole
// log in front of the person, and ends by saying whether it worked, where the copy is, and what can be done with it.
//
// Nothing here reaches for the API: the page's buttons carry `data-command`, and the module runs them, so a progress
// page cannot become a second way to act on the working area.

import * as vscode from 'vscode';
import { commandScript, escapeHtml, hero, page, pageColumn, runCommand } from './ui';

export const CLONING_VIEW_TYPE = 'temcoRepositories.cloning';

/** One clone, as the page needs it before anything has happened. */
interface CloneHead {
	slug: string;
	name: string;
	remote: string;
	branch?: string;
	folder: string;
}

const STYLE = `
    .clone__state { margin: 1em 0 .2em; font-size: var(--fs-sm); color: var(--fg-muted); }
    .clone__state--ok { color: var(--fg); }
    .clone__state--err { color: var(--warn); }
    .clone__log { margin: .4em 0 0; padding: .7em .8em; max-height: 46vh; overflow: auto;
      background: var(--bg-inset); border-radius: var(--r-8); font-family: var(--font-mono);
      font-size: var(--fs-xs); line-height: 1.5; white-space: pre-wrap; overflow-wrap: anywhere; color: var(--fg-muted); }
    .clone__acts { display: flex; gap: .6em; flex-wrap: wrap; margin: 1em 0 0; }
    .clone__acts [hidden] { display: none; }
`;

const CLIENT = `
const $ = (id) => document.getElementById(id);
let lines = 0;

window.addEventListener('message', (event) => {
  const message = event.data || {};
  if (message.type === 'line') {
    const log = $('log');
    const atEnd = log.scrollTop + log.clientHeight >= log.scrollHeight - 8;
    log.append(document.createTextNode((lines === 0 ? '' : '\\n') + message.text));
    lines += 1;
    // The window keeps the conversation readable rather than unbounded: a long clone is thousands of lines.
    while (log.childNodes.length > 400) { log.removeChild(log.firstChild); }
    if (atEnd) { log.scrollTop = log.scrollHeight; }
    return;
  }
  if (message.type !== 'done') { return; }
  const state = $('state');
  state.textContent = message.summary;
  state.className = 'az-intro clone__state ' + (message.ok ? 'clone__state--ok' : 'clone__state--err');
  for (const button of document.querySelectorAll('.clone__acts button')) { button.hidden = false; }
  $('open').hidden = !message.ok;
});
`;

/**
 * The page one clone reports into.
 *
 * One instance for the window: a second clone started while the page is open begins again in the same page rather than
 * opening a second one, because two progress pages for one working area would be two places to look.
 */
export class ClonePanel {
	private panel: vscode.WebviewPanel | undefined;

	/** Opens the page for one clone and clears what the last one said. */
	begin(clone: CloneHead): void {
		const panel = this.panel ?? this.create();
		panel.title = `Cloning — ${clone.name}`;
		panel.webview.html = html(clone);
		panel.reveal(pageColumn());
	}

	/** One line of what git said, as it says it. */
	line(text: string): void {
		void this.panel?.webview.postMessage({ type: 'line', text });
	}

	/** The end of the act: whether it worked, and in one sentence what happened. */
	finish(ok: boolean, summary: string): void {
		void this.panel?.webview.postMessage({ type: 'done', ok, summary });
	}

	dispose(): void {
		this.panel?.dispose();
		this.panel = undefined;
	}

	private create(): vscode.WebviewPanel {
		const panel = vscode.window.createWebviewPanel(
			CLONING_VIEW_TYPE,
			'Cloning',
			pageColumn(),
			{ enableScripts: true, localResourceRoots: [] }
		);
		panel.iconPath = new vscode.ThemeIcon('cloud-download');
		// The buttons carry commands; the module runs them, exactly as it does on every other page of ours.
		panel.webview.onDidReceiveMessage((message: { type?: string; command?: string; args?: unknown }) => runCommand(message));
		panel.onDidDispose(() => {
			this.panel = undefined;
		});
		this.panel = panel;
		return panel;
	}
}

/** The page, in the house language: what is being cloned, from where, into which folder, and what git says. */
function html(clone: CloneHead): string {
	const args = JSON.stringify([clone.slug]).replace(/"/g, '&quot;');
	const body = `
${hero({
		eyebrow: 'Repositories · cloning',
		mark: 'download',
		title: clone.name,
		desc: 'One branch, full history — and nothing is ever written back to the repository or pushed to it.',
		note: { text: clone.folder, mono: true }
	})}
<p class="clone__state" id="state">Cloning from ${escapeHtml(clone.remote)} · branch ${escapeHtml(clone.branch ?? 'as the remote decides')}…</p>
<pre class="clone__log" id="log" aria-live="polite" aria-label="What git reported"></pre>
<div class="clone__acts">
  <button type="button" class="az-btn az-btn--primary" id="open" hidden
    data-command="temcoRepositories.openClone" data-args="${args}">Open the Clone</button>
  <button type="button" class="az-btn" hidden data-command="temcoRepositories.showLog">Show the Log</button>
</div>
  `;
	return page(body, { title: `Cloning — ${clone.name}`, script: `${commandScript}${CLIENT}`, extraCss: STYLE });
}
