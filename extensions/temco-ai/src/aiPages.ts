// The AI Hub's pages and its three side-bar groups.
//
// Two of these pages are the mock's subject (`docs/mock/js/views.platform.js` — `ai/actions`, `ai/citations`), drawn
// in the application's own vocabulary and filled from what the platform really knows: the acts the module performs,
// and the citations the answers actually made, kept in the platform database. Nothing here is a card grid or a table
// any more — an action and a citation are one row each, because that is what a person reads them as. The chat has no
// page of its own: the conversation lives in the panel, and a page describing it was a third copy of one subject.

import * as vscode from 'vscode';
import { DocsRoot, collectPages, docs } from './docs';
import { Catalog, CitationRow } from './ai/store';
import { askToRun, callTool, listTools } from './ai/agent';
import { buildHint, platformApi, serverBinary, serverEntry, serverFolder } from './ai/binPath';
import { toolLog } from './ai/log';
import { ServerStatus, toolServer } from './ai/server';
import { ToolSpec } from './ai/runtime';
import { PageMessage, RestorablePage, button, commandScript, escapeHtml as esc, callout, hero, icon, page, pageColumn, runCommand, section } from './ui';

export const ACTIONS_VIEW_TYPE = 'temcoAi.actions';
export const CITATIONS_VIEW_TYPE = 'temcoAi.citations';
export const STALE_VIEW_TYPE = 'temcoAi.stale';
export const TOOLS_VIEW_TYPE = 'temcoAi.tools';
export const CONNECTION_VIEW_TYPE = 'temcoAi.connection';

interface ActionOptions {
	kind?: 'primary' | 'link';
	mark?: string;
	args?: unknown;
}

/** One of this module's commands, drawn as the kit draws a button. */
const act = (label: string, command: string, options: ActionOptions = {}): string => {
	const kind = options.kind === 'primary' ? ' az-btn--primary' : options.kind === 'link' ? ' az-btn--link' : '';
	const args = options.args === undefined ? '' : ` data-args="${esc(JSON.stringify(options.args))}"`;
	const mark = options.mark === undefined ? '' : icon(options.mark);
	return `<button type="button" class="az-btn az-btn--sm${kind}" data-command="${command}"${args}>${mark}<span>${esc(label)}</span></button>`;
};

/**
 * One thing, on one row: the mark, the name, the line about it, and the acts its state allows.
 *
 * The kit's own entry row carries a single way in; these rows carry two (a page can be opened *or* drafted), so the
 * acts are drawn in the row's last column instead of the kit's chevron.
 */
const row = (options: { mark?: string; title: string; meta?: string; actions?: string }): string =>
	`<div class="az-entry">${
		options.mark === undefined ? '<span class="az-entry__icon"></span>' : `<span class="az-entry__icon">${icon(options.mark)}</span>`
	}<div class="az-entry__main"><span class="az-entry__title">${esc(options.title)}</span>${
		options.meta === undefined ? '' : `<span class="az-entry__meta">${options.meta}</span>`
	}</div>${options.actions === undefined ? '' : `<div class="az-row">${options.actions}</div>`}</div>`;

const rows = (items: readonly string[]): string => `<div class="az-entries">${items.join('')}</div>`;

/** One line under a title giving the figures this page is answerable for. */
const figures = (parts: readonly string[]): string =>
	`<p class="ai-line">${parts.map((part) => `<span>${esc(part)}</span>`).join('')}</p>`;

/** A date as a person reads it: the day, not the timestamp the manifest kept. */


/** The brand bar every section title carries, so the AI pages read like the rest of the application. */
const AI_CSS = `
.ai-line { display: flex; flex-wrap: wrap; gap: 0 var(--sp-2); margin: var(--sp-3) 0 0; color: var(--ink-3); font-size: 12px; line-height: 18px; }
.ai-line span + span::before { content: '·'; margin-right: var(--sp-2); }
/* A row's second line here is prose about the thing, not a path: the kit sets it in the mono face for paths. */
.az-entry__meta { font-family: inherit; }
.ai-foot { margin: var(--sp-6) 0 0; color: var(--ink-3); font-size: 12px; line-height: 18px; }
/* The catalogue as a plain row of tabs: words, counts, and one hairline under the open one. No boxes, no tint. */
.ai-tabs { display: flex; align-items: flex-end; flex-wrap: wrap; gap: var(--sp-4); border-bottom: 1px solid var(--vscode-panel-border, rgba(127, 127, 127, 0.25)); }
.ai-tabs__list { display: flex; flex: 1 1 auto; flex-wrap: wrap; gap: var(--sp-4); }
.ai-tab { position: relative; display: inline-flex; align-items: center; gap: 6px; padding: 6px 2px 10px; border: 0; background: none; font-family: inherit; font-size: 12px; font-weight: 600; line-height: 16px; color: var(--fg-muted); cursor: pointer; white-space: nowrap; transition: color 100ms ease; }
.ai-tab:hover { color: var(--ink-1); }
.ai-tab[aria-selected='true'] { color: var(--ink-1); }
.ai-tab[aria-selected='true']::after { content: ''; position: absolute; left: 2px; right: 2px; bottom: -1px; height: 1px; background: var(--vscode-focusBorder, currentColor); }
.ai-tab:focus-visible { outline: 1px solid var(--vscode-focusBorder, currentColor); outline-offset: 3px; border-radius: 2px; }
.ai-tab__count { font-size: 10px; font-weight: 600; line-height: 16px; color: var(--fg-muted); }
.ai-tab[aria-selected='true'] .ai-tab__count { color: var(--ink-1); }
.ai-panel[hidden] { display: none; }
/* The calls of one tab, across the row: a name with the sentence under it, cells as wide as they need. */
.ai-grid { display: grid; grid-template-columns: repeat(auto-fill, minmax(190px, 1fr)); gap: var(--sp-4) var(--sp-5); margin: var(--sp-4) 0 0; }
.ai-cell { display: grid; gap: 2px; align-content: start; }
.ai-item--more { display: none; }
.ai-panel--expanded .ai-item--more { display: grid; }
.ai-cell__desc { font-size: 12px; line-height: 18px; color: var(--ink-3); display: -webkit-box; -webkit-line-clamp: 3; -webkit-box-orient: vertical; overflow: hidden; }
.ai-link { appearance: none; background: none; border: 0; margin: 0; padding: 0; font-family: inherit; font-size: 12px; font-weight: 600; line-height: 18px; text-align: left; color: var(--vscode-textLink-foreground, inherit); cursor: pointer; }
.ai-link:hover { text-decoration: underline; }
.ai-link:focus-visible { outline: 1px solid var(--vscode-focusBorder, currentColor); outline-offset: 2px; }
.ai-toggle { appearance: none; background: none; border: 0; margin: 0; padding: 0; font-size: 12px; line-height: 18px; color: var(--vscode-textLink-foreground, inherit); cursor: pointer; white-space: nowrap; }
.ai-toggle:hover { text-decoration: underline; }
.ai-toggle:focus-visible { outline: 1px solid var(--vscode-focusBorder, currentColor); outline-offset: 2px; }
/* The runner: one call, from a page, without the model in the way. */
.ai-run { display: grid; gap: var(--sp-2); margin: var(--sp-3) 0 0; }
.ai-run__row { display: flex; align-items: center; gap: var(--sp-2); }
.ai-run select, .ai-run textarea, .ai-run__out { font-family: monospace; font-size: 12px; line-height: 18px; }
.ai-run textarea { min-height: 96px; resize: vertical; }
.ai-run__out { margin: 0; padding: var(--sp-2); border-radius: 4px; background: rgba(127, 127, 127, 0.1); white-space: pre-wrap; }
.ai-run__out--bad { color: var(--vscode-errorForeground, inherit); }
/* What this page is answerable for: a key, a value, and nothing around them. */
.ai-fact { display: grid; grid-template-columns: 104px minmax(0, 1fr); gap: var(--sp-3); padding: var(--sp-2) 0; font-size: 12px; line-height: 18px; }
.ai-fact__key { color: var(--ink-3); }
.ai-fact__value { font-family: monospace; overflow-wrap: anywhere; }
.ai-field { display: flex; align-items: center; gap: var(--sp-2); margin: var(--sp-3) 0 0; }
.ai-field label { flex: 0 0 104px; color: var(--ink-3); font-size: 12px; }
.ai-field input { flex: 1 1 auto; font-family: monospace; font-size: 12px; }
.ai-field--short input { flex: 0 0 120px; }
.ai-note { margin: var(--sp-2) 0 0; font-size: 12px; line-height: 18px; color: var(--ink-3); }
/* The server's state: a word with a dot beside it, because whether it is up is the one fact a reader checks first. */
.ai-fact--state .ai-fact__value { display: inline-flex; align-items: center; gap: 6px; font-family: inherit; }
.ai-dot { flex: none; width: 7px; height: 7px; border-radius: 50%; background: var(--ink-3); }
.ai-dot--on { background: var(--vscode-charts-green, #3fb950); }
.ai-dot--bad { background: var(--vscode-errorForeground, #f14c4c); }
.ai-actions { display: flex; flex-wrap: wrap; align-items: center; gap: var(--sp-2); margin: var(--sp-4) 0 0; }
.az-btn:disabled { opacity: 0.45; }
`;

/** The four surfaces, one panel each. */
export class AiPages {
	private readonly panels = new Map<string, vscode.WebviewPanel>();

	constructor(private readonly context: vscode.ExtensionContext) { }

	actions(): void {
		this.open('actions', ACTIONS_VIEW_TYPE, 'Actions', actionsBody());
	}

	citations(): void {
		void this.openCitations();
	}

	/** The citations are read from the platform's own record, so opening the page is a read, not a draw. */
	private async openCitations(restored?: vscode.WebviewPanel): Promise<void> {
		await this.open('citations', CITATIONS_VIEW_TYPE, 'Citations', await citationsBody(this.roots()), restored);
	}

	/** Pages the generator says are stale: the code they document moved after their last review. */
	stale(): void {
		this.open('stale', STALE_VIEW_TYPE, 'Update a Page the Code Moved', staleBody(this.roots()));
	}

	/** The catalogue of calls, and the box that runs one. */
	tools(): void {
		void this.openTools();
	}

	private async openTools(restored?: vscode.WebviewPanel): Promise<void> {
		const view = await toolsView(this.context);
		await this.open(
			'tools',
			TOOLS_VIEW_TYPE,
			'The Tools the Assistant Can Call',
			view.body,
			restored,
			(message, panel) => void this.handlePageMessage(message, panel),
			view.script
		);
	}

	/** The program behind those calls: is it up, where does it answer, and how is it stopped. */
	connection(section?: unknown): void {
		void this.openConnection(undefined, typeof section === 'string' ? section : undefined);
	}

	private async openConnection(restored?: vscode.WebviewPanel, anchor?: string): Promise<void> {
		const view = connectionView(this.context, anchor);
		await this.open(
			'connection',
			CONNECTION_VIEW_TYPE,
			'The Tool Server',
			view.body,
			restored,
			(message, panel) => void this.handlePageMessage(message, panel),
			view.script
		);
	}

	private async handlePageMessage(message: PageMessage, panel: vscode.WebviewPanel): Promise<void> {
		switch (message.type) {
			case 'run':
				await this.runTool(message, panel);
				return;
			case 'saveApi':
				await this.saveSetting(message, panel, 'platformApi', 'savedApi');
				return;
			case 'savePort':
				await this.saveSetting(message, panel, 'serverPort', 'savedPort');
				return;
			case 'start':
			case 'restart':
				await this.control(panel, message.type);
				return;
			case 'stop':
				await toolServer().stop();
				this.postStatus(panel);
				return;
			case 'install':
				await this.install(panel);
				return;
			default:
				return;
		}
	}

	/** One setting, from the field that shows it, back to the field that shows it. */
	private async saveSetting(
		message: PageMessage,
		panel: vscode.WebviewPanel,
		key: 'platformApi' | 'serverPort',
		reply: string
	): Promise<void> {
		const value = (message as unknown as { value?: unknown }).value;
		const raw = typeof value === 'string' ? value.trim() : '';
		const stored = key === 'serverPort' ? Number.parseInt(raw, 10) : raw;
		await vscode.workspace
			.getConfiguration('temcoAi')
			.update(key, Number.isFinite(stored) ? stored : 0, vscode.ConfigurationTarget.Global);
		void panel.webview.postMessage({ type: reply, value: raw });
	}

	/** Start, or restart: the answer is the status, whether it came up or not. */
	private async control(panel: vscode.WebviewPanel, action: 'start' | 'restart'): Promise<void> {
		const server = toolServer();
		try {
			if (action === 'restart') {
				await server.restart(this.context);
			} else {
				await server.start(this.context);
			}
		} catch {
			// The supervisor already recorded the reason; the status carries it to the page.
		}
		this.postStatus(panel);
	}

	/** The download, for a machine that has no server yet. */
	private async install(panel: vscode.WebviewPanel): Promise<void> {
		try {
			await toolServer().start(this.context);
		} catch {
			// Reason recorded by the supervisor.
		}
		this.postStatus(panel);
	}

	private postStatus(panel: vscode.WebviewPanel): void {
		void panel.webview.postMessage({ type: 'status', status: toolServer().status() });
	}

	/**
	 * One call, from the page's own runner. It is the second way in to the tool server, so it goes through the
	 * same gate: a call that changes something asks the person first, here as it does mid-turn.
	 */
	private async runTool(message: PageMessage, panel: vscode.WebviewPanel): Promise<void> {
		if (message.type !== 'run') {
			return;
		}
		const request = message as unknown as { tool?: unknown; arguments?: unknown };
		const tool = typeof request.tool === 'string' ? request.tool : '';
		const args =
			typeof request.arguments === 'object' && request.arguments !== null
				? (request.arguments as Record<string, unknown>)
				: {};
		const log = (line: string): void => toolLog().appendLine(line);
		try {
			const text = await callTool(this.context, tool, args, { log, approve: askToRun });
			void panel.webview.postMessage({ type: 'result', text });
		} catch (error) {
			void panel.webview.postMessage({
				type: 'result',
				text: error instanceof Error ? error.message : String(error),
				bad: true
			});
		}
	}

	/** The pages this module can be asked to bring back, one serializer each. */
	restorable(): RestorablePage[] {
		return [
			{ viewType: ACTIONS_VIEW_TYPE, open: (panel) => this.open('actions', ACTIONS_VIEW_TYPE, 'Actions', actionsBody(), panel) },
			{ viewType: CITATIONS_VIEW_TYPE, open: (panel) => void this.openCitations(panel) },
			{ viewType: STALE_VIEW_TYPE, open: (panel) => this.open('stale', STALE_VIEW_TYPE, 'Update a Page the Code Moved', staleBody(this.roots()), panel) },
			{ viewType: TOOLS_VIEW_TYPE, open: (panel) => void this.openTools(panel) },
			{ viewType: CONNECTION_VIEW_TYPE, open: (panel) => void this.openConnection(panel) }
		];
	}

	/** The documentation set being read, or nothing when the documentation module is not installed. */
	private roots(): readonly DocsRoot[] {
		try {
			return docs().roots();
		} catch {
			return [];
		}
	}

	dispose(): void {
		for (const panel of this.panels.values()) {
			panel.dispose();
		}
		this.panels.clear();
	}

	private open(
		key: string,
		viewType: string,
		title: string,
		body: string,
		restored?: vscode.WebviewPanel,
		onMessage?: (message: PageMessage, panel: vscode.WebviewPanel) => void,
		script: string = commandScript
	): void {
		const html = page(body, { title, script, extraCss: AI_CSS });
		const existing = this.panels.get(key);
		if (existing) {
			existing.reveal(pageColumn());
			existing.webview.html = html;
			return;
		}
		// A restored tab is drawn into rather than replaced, so it keeps its place in the group.
		const panel = restored ?? vscode.window.createWebviewPanel(viewType, title, pageColumn(), {
			enableScripts: true,
			localResourceRoots: []
		});
		panel.webview.options = { enableScripts: true, localResourceRoots: [] };
		panel.iconPath = vscode.Uri.joinPath(this.context.extensionUri, 'media', 'ai.svg');
		panel.webview.onDidReceiveMessage((message: PageMessage) => {
			runCommand(message);
			onMessage?.(message, panel);
		});
		panel.webview.html = html;
		this.panels.set(key, panel);
		panel.onDidDispose(() => this.panels.delete(key));
	}
}

/**
 * *Actions* — the five things the AI can be asked to do, and the button that starts each.
 *
 * One section, because the page's job is to be a launcher: what each act starts, and where its output lands, is said
 * on the act's own row rather than in a second list beside it. The two rules that are not per-act — nothing writes
 * without a draft, and every answer names what it read — are said once, under the rows, instead of as four rows of
 * their own.
 */
function actionsBody(): string {
	return `${hero({
		eyebrow: 'Temco AI',
		title: 'Actions',
		mark: 'play',
		desc: 'Five things the model can be asked to do. Each row starts the act where the act really lives, so nothing here is a second copy of that surface.',
		descWide: true,
		actions: [
			{ label: 'Open the AI Panel', command: 'temcoAi.openPanel', mark: 'panel', kind: 'primary' }
		]
	})}
<div class="mt-24">
	${section({ title: 'What it can be asked to do' })}
	<div class="mt-8">${rows([
		row({
			mark: 'sparkle',
			title: 'Ask about the page in front',
			meta: 'an answer in the panel, with the pages it read named under it',
			actions: act('Open the panel', 'temcoAi.openPanel', { kind: 'primary' })
		}),
		row({
			mark: 'document',
			title: 'Draft a new page',
			meta: 'a draft in Review Center, written from the sources you pick',
			actions: act('New Page', 'temcoDocs.newPage')
		}),
		row({
			mark: 'sync',
			title: 'Update a page the code moved',
			meta: 'the pages whose code changed after their last review, one draft at a time',
			actions: act('Open the list', 'temcoAi.stale')
		}),
		row({
			mark: 'repo',
			title: 'Read or analyse a source',
			meta: 'the pages a source declares, and what its page does not cover',
			actions: act('Sources', 'temcoRepositories.list.focus')
		}),
		row({
			mark: 'users',
			title: 'Answer a forum thread',
			meta: 'a suggestion saved on the topic, and streamed into the panel',
			actions: act('The forum', 'temcoDocs.forum')
		})
	])}</div>
</div>
<div class="mt-16">${callout({
		mark: 'check',
		title: 'Nothing here writes a page on its own',
		desc: 'An act that writes proposes a draft, and Review Center is where a person settles it. An answer names the pages it used, and those pointers are kept — so Citations can look them up again later.',
		actions: `${act('Review Center', 'temcoDocs.review', { kind: 'primary' })}${act('Citations', 'temcoAi.citations', { kind: 'link' })}`
	})}</div>`;
}

/** How long ago something was cited, in words a person reads at a glance. */
function ago(iso: string): string {
	const at = new Date(iso).getTime();
	if (Number.isNaN(at)) {
		return 'just now';
	}
	const minutes = Math.floor((Date.now() - at) / 60_000);
	if (minutes < 1) {
		return 'just now';
	}
	if (minutes < 60) {
		return `${minutes} min ago`;
	}
	const hours = Math.floor(minutes / 60);
	if (hours < 24) {
		return `${hours} h ago`;
	}
	const days = Math.floor(hours / 24);
	return `${days} day${days === 1 ? '' : 's'} ago`;
}

/** One page the AI has leant on, as the citations log knows it and as the registries see it today. */
interface CitedPage {
	/** The page id the answer named. */
	id: string;
	/** The page's title today, when a registry still has it. */
	title?: string;
	times: number;
	last: string;
	/** What the answers were: `answer`, `topic`, or `draft`. */
	kinds: string[];
	/** True when a registry knows the page, and it is the same page the answer named. */
	exists: boolean;
	/** True when a registry knew it at the time the answer was given. */
	knownThen: boolean;
	/** True when the page's own record says the code it documents moved. */
	stale: boolean;
}

/**
 * What the AI has cited, checked again.
 *
 * The log holds one row per citation, which is the right shape to write and the wrong shape to read: the question a
 * person has is "which pages does the AI lean on, and are they still there?" — so the rows are folded per page, and
 * each page is looked up in the registries this window is reading now. A page that was cited and has since gone is
 * the one thing on this page that is worth a colour.
 */
async function citedPages(roots: readonly DocsRoot[]): Promise<CitedPage[]> {
	let rows: CitationRow[] = [];
	let catalog: Catalog | undefined;
	try {
		catalog = await Catalog.open();
		rows = catalog.citations(400);
	} catch {
		return [];
	} finally {
		catalog?.close();
	}
	if (rows.length === 0) {
		return [];
	}

	const pages = new Map(roots.flatMap((root) => collectPages(root)).map((page) => [page.id, page]));
	const folded = new Map<string, CitedPage>();
	for (const row of rows) {
		const page = pages.get(row.citationId);
		const seen = folded.get(row.citationId);
		if (seen === undefined) {
			folded.set(row.citationId, {
				id: row.citationId,
				title: page?.title,
				times: 1,
				last: row.at,
				kinds: [row.answerKind],
				exists: page !== undefined,
				knownThen: row.citationKnown,
				stale: page?.provenance?.stale === true
			});
			continue;
		}
		seen.times += 1;
		seen.knownThen = seen.knownThen || row.citationKnown;
		if (row.at > seen.last) {
			seen.last = row.at;
		}
		if (!seen.kinds.includes(row.answerKind)) {
			seen.kinds.push(row.answerKind);
		}
	}
	// The broken ones first, then the most leant on, then the most recent: that is the order a person triages in.
	return [...folded.values()].sort((one, other) => {
		const missing = Number(one.exists) - Number(other.exists);
		return missing !== 0 ? missing : other.times - one.times || other.last.localeCompare(one.last);
	});
}

/**
 * What to say about a page that is not in a registry now.
 *
 * Two different faults, and they are not the same fault: a page that *was* a page and has gone means the documentation
 * lost something an answer leant on; a name that was never a page means the model invented a citation. The second is
 * the one worth knowing about, so it says so in its own words.
 */
function missingNote(page: CitedPage): string {
	if (page.exists) {
		return '';
	}
	return page.knownThen
		? ` · ${esc(page.id)} is no longer in a registry this window reads`
		: ` · ${esc(page.id)} was never a page here — the answer named something that does not exist`;
}

/** *Citations* — what the AI leant on, and whether it is still there. */
async function citationsBody(roots: readonly DocsRoot[]): Promise<string> {
	const cited = await citedPages(roots);
	const gone = cited.filter((page) => !page.exists).length;
	const moved = cited.filter((page) => page.exists && page.stale).length;
	const invented = cited.filter((page) => !page.exists && !page.knownThen).length;
	const times = cited.reduce((total, page) => total + page.times, 0);

	return `${hero({
		eyebrow: 'Temco AI',
		title: 'Citations',
		mark: 'link',
		desc: 'Every answer names the pages and files it read, and each of those pointers is kept in the platform database. This page reads them back and looks each one up again: a page the AI leant on is a page this documentation had better still have, and a page whose code moved since is an answer worth re-reading.',
		descWide: true,
		actions: [
			{ label: 'The panel', command: 'temcoAi.openPanel', mark: 'panel', kind: 'primary' },
			{ label: 'Documents', command: 'temcoDocs.documents', kind: 'link' }
		]
	})}
${figures([
		`${times} ${times === 1 ? 'citation' : 'citations'}`,
		`${cited.length} ${cited.length === 1 ? 'page' : 'pages'}`,
		// The verdict is one sentence, worst first: a name that never existed is a worse fault than a page that moved.
		invented > 0 ? `${invented} named a page that does not exist`
			: gone > 0 ? `${gone} no longer in a registry`
				: moved > 0 ? `${moved} behind its code`
					: 'every one still current'
	])}
<div class="mt-24">
	${section({
		title: 'What it has leant on',
		desc: cited.length === 0
			? 'Nothing yet. An answer that names a page is what writes the first row here.'
			: 'The pages an answer or a draft named, most leant on first. The state is said in words: a page that is gone is the one thing here worth a colour.'
	})}
	<div class="mt-8">${cited.length === 0
			? rows([row({ mark: 'info', title: 'Nothing has been cited yet', meta: 'ask something in the panel; the pages the answer names are recorded as it is given' })])
			: rows(cited.map((page) => row({
				mark: page.exists ? (page.stale ? 'alert' : 'document') : 'alert',
				title: page.title ?? page.id,
				meta: `${page.times} ${page.times === 1 ? 'citation' : 'citations'} · ${page.kinds.join(' · ')} · last ${ago(page.last)}${missingNote(page)}`,
				actions: page.exists ? act('Open', 'temcoDocs.page', { args: [page.id] }) : ''
			})))}</div>
</div>
<p class="az-note">The pointers are read from the platform database, never from the model: an answer's footnotes are its own claim, and this page is where that claim is checked.</p>`;
}
function staleBody(roots: readonly DocsRoot[]): string {
	const pages = roots.flatMap((root) => collectPages(root));
	const stale = pages.filter((page) => page.exists && page.provenance?.stale === true);
	const never = pages.filter((page) => page.reviewed === null).length;

	const pageRows = stale.map((page) => row({
		mark: 'sync',
		title: page.title,
		meta: `${page.area}${page.chapter === '' ? '' : ` › ${page.chapter}`} · ${(page.provenance?.code ?? []).join(' · ') || 'no code path recorded'}`,
		actions: `${act('Open', 'temcoDocs.openFile', { args: page.uri.fsPath })}${act('Draft it', 'temcoAi.openPanel', { kind: 'primary', args: page.uri.fsPath })}`
	}));

	// Nothing is being read at all: that is a different answer from "nothing has moved", and it needs a way out.
	if (roots.length === 0) {
		return `${hero({
			eyebrow: 'Temco AI',
			title: 'Update a Page the Code Moved',
			mark: 'sync',
			desc: 'The generator judges each page against the code it names. This list is what it flagged: a page whose code moved after the last review is not wrong yet — it is unverified.',
			descWide: true,
			actions: [{ label: 'Open a project', command: 'temcoDocs.projects', mark: 'folder', kind: 'primary' }]
		})}
${figures(['nothing is being read'])}
<div class="mt-16">${callout({
			title: 'No documentation set is open',
			desc: 'Nothing is being read, so there is nothing to compare against. Open a project in Documentation — the list fills itself from the registry the generator wrote, not from a scan of this page.',
			mark: 'info',
			actions: `${act('Projects', 'temcoDocs.projects', { kind: 'primary', mark: 'folder' })}${act('Documents', 'temcoDocs.documents', { kind: 'link' })}`
		})}</div>`;
	}

	return `${hero({
		eyebrow: 'Temco AI',
		title: 'Update a Page the Code Moved',
		mark: 'sync',
		desc: 'The generator judges each page against the code it names. These moved after the last review — the page is not wrong yet, it is unverified. A draft is written beside the page and settled in Review Center; nothing here overwrites a file.',
		descWide: true,
		actions: [{ label: 'Open the AI Panel', command: 'temcoAi.openPanel', mark: 'sparkle', kind: 'primary' }]
	})}
${figures([
		stale.length === 0 ? 'nothing has moved' : `${stale.length} ${stale.length === 1 ? 'page has' : 'pages have'} moved`,
		`${pages.length} ${pages.length === 1 ? 'page' : 'pages'} read`,
		`${never} never reviewed`
	])}

<div class="mt-24">
	${section({
		title: stale.length === 0 ? 'Nothing has moved' : 'Pages the code moved past',
		desc: stale.length === 0
			? 'Every page still matches the code it names, as far as the last read could tell. The next read puts any page here the moment its code changes.'
			: `${stale.length} ${stale.length === 1 ? 'page' : 'pages'}, most recently changed code first. The line under each one is where it sits and what the registry says it documents.`
	})}
	<div class="mt-8">${stale.length === 0
			? rows([row({ mark: 'check', title: 'Every page agrees with its code', meta: 'the generator writes this list itself, so it fills the moment a commit touches a page’s code' })])
			: rows(pageRows)}</div>
</div>

<div class="mt-24">
	${section({ title: 'What happens to a draft', desc: 'The same three steps as any other draft, so an update cannot reach a reader without a person and a build.' })}
	<div class="mt-8">${rows([
		row({ mark: 'sparkle', title: '1 · The model drafts beside the page', meta: 'it reads the page, the registry entry and the files that moved — nothing else' }),
		row({ mark: 'check', title: '2 · Review Center settles it', meta: 'accept writes the page exactly as the draft reads; discard leaves it alone', actions: act('Open', 'temcoDocs.review', { kind: 'link' }) }),
		row({ mark: 'upload', title: '3 · A build and a publish carry it', meta: 'the site a reader sees only changes after those two', actions: act('Build Center', 'temcoDocs.builds', { kind: 'link' }) })
	])}</div>
</div>`;
}

/** The AI Hub's side-bar groups. The chat is the panel, not a row that opens a page. */
interface Row {
	label: string;
	note: string;
	mark: string;
	command: string;
	/** Arguments the command takes: a page that should open on one of its parts, and nothing else yet. */
	args?: readonly unknown[];
}

/**
 * Three groups, because there are three questions: what am I drafting, what can I ask it for, and what is answering.
 *
 * The old single *Runtime* group held the model and a Knowledge Base that nothing read; the base is gone, and what is
 * left is arranged around the work — the draft, the acts that produce one, and the machine behind them. Every page
 * this module draws has a row here, so the side bar is a way in and not a partial list of the module.
 */
const GROUPS: { id: string; rows: Row[] }[] = [
	{
		id: 'draft',
		rows: [
			{ label: 'Update a page the code moved', note: 'the pages the generator flagged stale, and the files under them', mark: 'sync', command: 'temcoAi.stale' },
			{ label: 'Drafts waiting', note: 'what the model produced, before anybody settles it', mark: 'check', command: 'temcoDocs.review' }
		]
	},
	{
		// What it does, and what it did it with: the acts, and the pages those acts leant on. Two rows, one subject —
		// the work this module performs — where calling the group *Answers* named only half of it.
		id: 'whatItDoes',
		rows: [
			{ label: 'Actions', note: 'the five acts, and the surface each one starts on', mark: 'play', command: 'temcoAi.actions' },
			{ label: 'Citations', note: 'the pages the answers leant on, looked up again in the registries read now', mark: 'book', command: 'temcoAi.citations' }
		]
	},
	{
		id: 'server',
		rows: [
			{ label: 'Server & Prompts', note: 'what answers a draft: the runtime, the model, and what it is told', mark: 'gear', command: 'temcoAi.page' }
		]
	},
	{
		// What the assistant can reach outside the page in front of it: the conversation itself, the program that
		// answers a call, and the catalogue of calls. Two pages, because one is a status and one is a list.
		id: 'mcp',
		rows: [
			{ label: 'Open the AI panel', note: 'the conversation, in the secondary side bar; once more puts it away', mark: 'comment-discussion', command: 'temcoAi.openPanel' },
			{ label: 'Connection', note: 'the tool server: whether it is running, where it answers, and the address it asks', mark: 'server-process', command: 'temcoAi.connection' },
			{ label: 'The tools it can call', note: 'every call it can make, by the part of the API it belongs to', mark: 'tools', command: 'temcoAi.tools' }
		]
	}
];

/** Registers the three group views the AI Hub container shows. */
export function registerAiViews(context: vscode.ExtensionContext): void {
	for (const group of GROUPS) {
		const rows = group.rows;
		context.subscriptions.push(
			vscode.window.createTreeView(`temcoAi.${group.id}`, {
				treeDataProvider: {
					getTreeItem: (element: vscode.TreeItem) => element,
					getChildren: (): vscode.TreeItem[] => rows.map((row) => {
						const item = new vscode.TreeItem(row.label, vscode.TreeItemCollapsibleState.None);
						item.iconPath = new vscode.ThemeIcon(row.mark);
						item.tooltip = `${row.label} — ${row.note}`;
						item.command = { command: row.command, title: row.label, arguments: row.args === undefined ? undefined : [...row.args] };
						return item;
					})
				}
			})
		);
	}
}

/** How many calls a tab shows before its heading offers the rest. */
const VISIBLE_CALLS = 6;

/** The script the Tools page runs: tabs, a fold, and the links into the runner. */
const TOOLS_SCRIPT = `
(function () {
	const api = window.__temcoApi || (window.__temcoApi = acquireVsCodeApi());
	const select = document.getElementById('tool');
	const args = document.getElementById('args');
	const out = document.getElementById('out');
	const run = document.getElementById('run-it');
	const seeds = window.__toolSeeds || {};
	const fold = document.getElementById('fold');
	const tabs = Array.prototype.slice.call(document.querySelectorAll('[data-tab]'));
	const panels = Array.prototype.slice.call(document.querySelectorAll('.ai-panel'));

	const fill = () => {
		if (!select || !args) { return; }
		args.value = JSON.stringify(seeds[select.value] || {}, undefined, 2);
	};
	if (select) { select.addEventListener('change', fill); }

	const activePanel = () => panels.filter((panel) => !panel.hasAttribute('hidden'))[0];

	// One fold control for the tab in front of the reader: it names what that tab is holding back.
	const updateFold = () => {
		if (!fold) { return; }
		const panel = activePanel();
		const folded = panel ? panel.querySelectorAll('.ai-item--more').length : 0;
		if (!panel || folded === 0) { fold.hidden = true; return; }
		fold.hidden = false;
		fold.textContent = panel.classList.contains('ai-panel--expanded') ? 'Show less' : 'Show ' + folded + ' more';
	};

	// A name is a link to the box that runs it: pick the call, seed its arguments, and put the caret in them.
	document.querySelectorAll('[data-tool]').forEach((link) => {
		link.addEventListener('click', () => {
			const name = link.getAttribute('data-tool');
			if (select && name) { select.value = name; }
			fill();
			const box = document.getElementById('run');
			if (box) { box.scrollIntoView({ block: 'start' }); }
			if (args) { args.focus(); }
		});
	});

	const showTab = (name) => {
		tabs.forEach((tab) => tab.setAttribute('aria-selected', tab.getAttribute('data-tab') === name ? 'true' : 'false'));
		panels.forEach((panel) => {
			if (panel.getAttribute('data-panel') === name) { panel.removeAttribute('hidden'); }
			else { panel.setAttribute('hidden', ''); }
		});
		updateFold();
	};

	tabs.forEach((tab) => tab.addEventListener('click', () => showTab(tab.getAttribute('data-tab'))));

	if (fold) {
		fold.addEventListener('click', () => {
			const panel = activePanel();
			if (!panel) { return; }
			panel.classList.toggle('ai-panel--expanded');
			updateFold();
		});
	}
	updateFold();

	if (run) {
		run.addEventListener('click', () => {
			const tool = select ? select.value : '';
			let parsed = {};
			try {
				parsed = JSON.parse(args && args.value ? args.value : '{}');
			} catch (error) {
				if (out) { out.textContent = 'Those arguments are not JSON: ' + error.message; out.classList.add('ai-run__out--bad'); }
				return;
			}
			if (out) { out.textContent = 'Running ' + tool + '...'; out.classList.remove('ai-run__out--bad'); }
			api.postMessage({ type: 'run', tool: tool, arguments: parsed });
		});
	}

	document.addEventListener('click', (event) => {
		const target = event.target.closest('[data-command]');
		if (!target) { return; }
		event.preventDefault();
		const raw = target.dataset.args;
		api.postMessage({ type: 'command', command: target.dataset.command, args: raw === undefined ? undefined : JSON.parse(raw) });
	});

	window.addEventListener('message', (event) => {
		const message = event.data;
		if (!message) { return; }
		if (message.type === 'result' && out) {
			out.textContent = message.text || '(nothing came back)';
			out.classList.toggle('ai-run__out--bad', Boolean(message.bad));
		}
	});

	fill();

	const anchor = window.__temcoAnchor;
	if (anchor) {
		const target = document.getElementById(anchor);
		if (target) { target.scrollIntoView({ block: 'start' }); }
	}
})();
`;

/** The script the Connection page runs: four buttons, two fields, and the status painted where it is read. */
const CONNECTION_SCRIPT = `
(function () {
	const api = window.__temcoApi || (window.__temcoApi = acquireVsCodeApi());
	const note = document.getElementById('status-note');
	const start = document.getElementById('start');
	const stop = document.getElementById('stop');
	const restart = document.getElementById('restart');
	const words = { running: 'Running', starting: 'Starting', failed: 'Failed', stopped: 'Stopped' };

	const setFact = (name, text) => {
		const node = document.querySelector('[data-fact="' + name + '"]');
		if (node) { node.textContent = text; }
	};

	const spell = (since) => {
		const seconds = Math.max(0, Math.round((Date.now() - since) / 1000));
		if (seconds < 60) { return seconds + 's'; }
		if (seconds < 3600) { return Math.floor(seconds / 60) + 'm'; }
		return Math.floor(seconds / 3600) + 'h ' + Math.floor((seconds % 3600) / 60) + 'm';
	};

	const sentence = (status) => {
		if (status.state === 'running') { return 'Running. The panel, the Tools page and every call go through this process.'; }
		if (status.state === 'starting') { return 'Starting. A first start also downloads the program, which takes a moment.'; }
		if (status.state === 'failed') { return status.error || 'It stopped. Show the log for what it said.'; }
		return 'Stopped. It starts again the first time something needs it, or when you press Start.';
	};

	const paint = (status) => {
		const state = status.state || 'stopped';
		setFact('state', words[state] || 'Stopped');
		const mark = document.querySelector('[data-dot]');
		if (mark) {
			mark.className = 'ai-dot' + (state === 'running' ? ' ai-dot--on' : state === 'failed' ? ' ai-dot--bad' : '');
		}
		setFact('address', state === 'running' ? 'http://127.0.0.1:' + status.port + '/mcp' : 'not listening');
		setFact('calls', status.calls === undefined ? 'not asked yet' : status.calls + ' tools');
		setFact('process', status.pid === undefined ? 'none' : String(status.pid));
		setFact('since', status.since === undefined ? 'not running' : spell(status.since));
		if (note) { note.textContent = sentence(status); }
		const busy = state === 'starting';
		if (start) { start.disabled = busy || state === 'running'; }
		if (stop) { stop.disabled = busy || state !== 'running'; }
		if (restart) { restart.disabled = busy || state !== 'running'; }
	};

	const press = (button, message) => {
		if (!button) { return; }
		button.addEventListener('click', () => {
			if (note) { note.textContent = 'Working...'; }
			api.postMessage(message);
		});
	};

	press(start, { type: 'start' });
	press(stop, { type: 'stop' });
	press(restart, { type: 'restart' });

	const port = document.getElementById('port');
	const savePort = document.getElementById('save-port');
	const portNote = document.getElementById('port-note');
	if (savePort && port) {
		savePort.addEventListener('click', () => api.postMessage({ type: 'savePort', value: port.value }));
	}

	const address = document.getElementById('api-address');
	const saveApi = document.getElementById('save-api');
	const apiNote = document.getElementById('api-note');
	if (saveApi && address) {
		saveApi.addEventListener('click', () => api.postMessage({ type: 'saveApi', value: address.value }));
	}

	document.addEventListener('click', (event) => {
		const target = event.target.closest('[data-command]');
		if (!target) { return; }
		event.preventDefault();
		const raw = target.dataset.args;
		api.postMessage({ type: 'command', command: target.dataset.command, args: raw === undefined ? undefined : JSON.parse(raw) });
	});

	window.addEventListener('message', (event) => {
		const message = event.data;
		if (!message) { return; }
		if (message.type === 'status' && message.status) { paint(message.status); }
		if (message.type === 'savedPort' && portNote) {
			portNote.textContent = Number(message.value) > 0
				? 'Fixed at ' + message.value + '; a start fails if anything else holds it. The next start uses it.'
				: 'Chosen at each start, so two windows never collide.';
		}
		if (message.type === 'savedApi' && apiNote) {
			apiNote.textContent = message.value
				? 'Set to ' + message.value + '. Devices, documentation, repositories, projects and the site are asked there.'
				: 'Not set, so the calls that need it answer that the service is not configured. The catalog calls read a file on this machine and carry on.';
		}
	});

	paint(window.__temcoStatus || { state: 'stopped' });

	const anchor = window.__temcoAnchor;
	if (anchor) {
		const target = document.getElementById(anchor);
		if (target) { target.scrollIntoView({ block: 'start' }); }
	}
})();
`;

/** A first draft of the arguments one call takes, from its own schema. */
function seedFor(tool: ToolSpec): Record<string, unknown> {
	const properties = (tool.parameters.properties ?? {}) as Record<string, { type?: unknown }>;
	const seed: Record<string, unknown> = {};
	for (const [name, schema] of Object.entries(properties)) {
		const type = Array.isArray(schema.type) ? schema.type.find((candidate) => candidate !== 'null') : schema.type;
		seed[name] = type === 'integer' || type === 'number' ? 0 : type === 'boolean' ? false : '';
	}
	return seed;
}

/** The first part of a call's name: the thing it is about, which is what a reader looks a call up by. */
function areaOf(tool: ToolSpec): string {
	const name = tool.name.split('.')[0];
	return name.length > 0 ? name : 'other';
}

/** The calls, in the order the server lists them, cut into the parts their names share. */
function byArea(tools: readonly ToolSpec[]): { name: string; items: readonly ToolSpec[] }[] {
	const order: string[] = [];
	const groups = new Map<string, ToolSpec[]>();
	for (const tool of tools) {
		const area = areaOf(tool);
		const list = groups.get(area);
		if (list) {
			list.push(tool);
		} else {
			groups.set(area, [tool]);
			order.push(area);
		}
	}
	return order.map((name) => ({ name, items: groups.get(name) ?? [] }));
}

/**
 * One call as a cell: the name on top, the sentence the server wrote under it, cut to three lines because cells
 * sit side by side and a long sentence in one of them would set the height of the whole row.
 */
function callCell(tool: ToolSpec, index: number): string {
	const folded = index >= VISIBLE_CALLS ? ' ai-item--more' : '';
	return `<div class="ai-cell${folded}"><button type="button" class="ai-link" data-tool="${esc(
		tool.name
	)}" title="Run ${esc(tool.name)}">${esc(tool.name)}</button><div class="ai-cell__desc" title="${esc(
		tool.description
	)}">${esc(tool.description)}</div></div>`;
}

/** `device` reads `Device` on the tab, while the data attribute keeps the name the server used. */
function tabLabel(area: string): string {
	return area.length === 0 ? area : area.charAt(0).toUpperCase() + area.slice(1);
}

/**
 * The catalogue as tabs: one per part of the API, in the order the server lists them, with the count beside the
 * name. The alternative, a single list of twenty, made the reader scroll past three subjects to find a fourth.
 */
function catalogueTabs(tools: readonly ToolSpec[]): string {
	const areas = byArea(tools);
	const tabs = areas
		.map(
			(area, index) =>
				`<button type="button" role="tab" class="ai-tab" data-tab="${esc(area.name)}" aria-selected="${
					index === 0 ? 'true' : 'false'
				}" aria-controls="panel-${esc(area.name)}">${esc(tabLabel(area.name))}<span class="ai-tab__count">${
					area.items.length
				}</span></button>`
		)
		.join('');
	const panels = areas
		.map(
			(area, index) =>
				`<div class="ai-panel" id="panel-${esc(area.name)}" role="tabpanel" data-panel="${esc(area.name)}"${
					index === 0 ? '' : ' hidden'
				}><div class="ai-grid">${area.items.map(callCell).join('')}</div></div>`
		)
		.join('');
	return `<div class="ai-tabs"><div class="ai-tabs__list" role="tablist" aria-label="The API each call belongs to">${tabs}</div><button type="button" class="ai-toggle" id="fold" hidden></button></div>${panels}`;
}

/** The calls that stop for a person, said once, because they are the reason this page has a gate at all. */
function askingNote(tools: readonly ToolSpec[]): string {
	const asking = tools.filter((tool) => tool.readOnly === false).map((tool) => tool.name);
	if (asking.length === 0) {
		return '';
	}
	return `<p class="ai-note">These ask the person at the keyboard before they run, every time: ${esc(asking.join(', '))}.</p>`;
}

/** One fact the page is answerable for, told apart from the prose around it by its face, not a border. */
function fact(key: string, value: string, live?: string): string {
	return `<div class="ai-fact"><span class="ai-fact__key">${esc(key)}</span><span class="ai-fact__value"${
		live === undefined ? '' : ` data-fact="${esc(live)}"`
	}>${esc(value)}</span></div>`;
}

/** The state, which is the fact a reader checks first: a word, and a dot that says the same thing at a glance. */
function stateFact(status: ServerStatus): string {
	const word = status.state === 'running' ? 'Running' : status.state === 'starting' ? 'Starting' : status.state === 'failed' ? 'Failed' : 'Stopped';
	return `<div class="ai-fact ai-fact--state"><span class="ai-fact__key">server</span><span class="ai-fact__value">${dot(
		status.state
	)}<span data-fact="state">${esc(word)}</span></span></div>`;
}

function dot(state: ServerStatus['state']): string {
	const tone = state === 'running' ? ' ai-dot--on' : state === 'failed' ? ' ai-dot--bad' : '';
	return `<span class="ai-dot${tone}" data-dot></span>`;
}

/** A button the page's own script listens for, rather than one that names a command. */
function localButton(id: string, label: string, primary = false): string {
	return `<button type="button" class="az-btn az-btn--sm${primary ? ' az-btn--primary' : ''}" id="${id}"><span>${esc(label)}</span></button>`;
}

/**
 * *Tools* - every call the assistant can make, and one box that makes one without the model in the way.
 *
 * The catalogue as tabs, one part of the API each; then the runner. What sits behind all of it - the program, its
 * address, whether it is up - is the Connection page, because a status is not a list and reading a catalogue should
 * not start anything.
 */
async function toolsView(context: vscode.ExtensionContext): Promise<{ body: string; script: string }> {
	const catalogEntry = serverEntry();
	const binary = serverBinary(context);

	let tools: readonly ToolSpec[] = [];
	let problem = '';
	if (binary) {
		try {
			// Starting the server here is deliberate: this is the page that has to list what it offers.
			tools = await listTools(context);
		} catch (error) {
			problem = error instanceof Error ? error.message : String(error);
		}
	} else {
		problem = `No tool server on this machine yet. Open the Connection page and press Start; it downloads one.\n\n${buildHint(context)}`;
	}

	const catalogue =
		tools.length === 0
			? callout({
					title: 'Nothing to list yet',
					desc: problem || 'The tool server did not answer.',
					mark: 'warning',
					actions: button('Open Connection', 'temcoAi.connection', { kind: 'primary' })
				})
			: `${catalogueTabs(tools)}${askingNote(tools)}`;

	const runner =
		tools.length === 0
			? ''
			: `<div id="run" class="mt-24">
	${section({ title: 'Run one', desc: 'The same call the model makes, without the model. Useful when a device or a registry is not answering.' })}
	<div class="ai-run mt-8">
		<div class="ai-run__row"><label for="tool">Tool</label><select id="tool">${tools
				.map((tool) => `<option value="${esc(tool.name)}">${esc(tool.name)}</option>`)
				.join('')}</select></div>
		<textarea id="args" spellcheck="false"></textarea>
		<div class="ai-run__row">${localButton('run-it', 'Run it', true)}<span class="ai-note">Arguments go as JSON, exactly as typed.</span></div>
		<pre id="out" class="ai-run__out">Nothing run yet.</pre>
	</div>
</div>`;

	const seeds: Record<string, Record<string, unknown>> = {};
	for (const tool of tools) {
		seeds[tool.name] = seedFor(tool);
	}
	// The seeds travel inside the page's one nonce-carrying script: the policy allows no other, and a second
	// inline script would simply never run.
	const script = `window.__toolSeeds = ${JSON.stringify(seeds).replace(/</g, '\\u003c')};\n${TOOLS_SCRIPT}`;

	const body = `${hero({
		eyebrow: 'Temco AI',
		title: 'The Tools the Assistant Can Call',
		mark: 'tools',
		desc: catalogEntry
			? `${catalogEntry.label}. Every call the model can make outside this window, what it is told, and the one question that decides whether it can reach anything.`
			: 'Every call the model can make outside this window.',
		descWide: true,
		actions: [
			{ label: 'Open the AI Panel', command: 'temcoAi.openPanel', mark: 'comment-discussion', kind: 'primary' },
			{ label: 'Connection', command: 'temcoAi.connection', mark: 'server-process' }
		]
	})}
<div id="catalogue" class="mt-24">
	${section({ title: 'The catalogue', desc: 'Read from the server itself, so this list cannot drift from what the model is offered. Pick a name to run that call.' })}
	<div class="mt-8">${catalogue}</div>
</div>
${runner}`;

	return { body, script };
}

/**
 * *Connection* — the program behind every call: whether it is running, where it answers, and how to stop it.
 *
 * A page rather than a toast because a person who runs a program on their own machine is entitled to see it, its
 * address and its way out in one place. Nothing here starts it on open: a status page that changes what it reports
 * is not a status page.
 */
function connectionView(
	context: vscode.ExtensionContext,
	anchor?: string
): { body: string; script: string } {
	const status = toolServer().status();
	const binary = serverBinary(context);
	const entry = serverEntry();
	const api = platformApi();
	const port = vscode.workspace.getConfiguration('temcoAi').get<number>('serverPort', 0);

	const statusBlock = `<div id="status-block">
	${stateFact(status)}
	${fact('address', status.state === 'running' ? `http://127.0.0.1:${status.port}/mcp` : 'not listening', 'address')}
	${fact('calls', status.calls === undefined ? 'not asked yet' : `${status.calls} tools`, 'calls')}
	${fact('process', status.pid === undefined ? 'none' : String(status.pid), 'process')}
	${fact('up since', status.since === undefined ? 'not running' : when(Math.floor(status.since / 1000)), 'since')}
</div>
<div class="ai-actions">
	${localButton('start', 'Start', true)}
	${localButton('stop', 'Stop')}
	${localButton('restart', 'Restart')}
	${act('Show the log', 'temcoAi.showToolLog')}
</div>
<p class="ai-note" id="status-note">${esc(noteFor(status))}</p>`;

	const artifact = `<div class="mt-8">
	${fact('installed', binary ? 'yes' : 'no')}
	${fact('path', binary ?? serverFolder(context) ?? '')}
	${fact('platform', `${process.platform}-${process.arch}`)}
	${fact('artifact', entry ? entry.id : 'nothing is published for this platform')}
</div>
${binary ? '' : `<p class="ai-note">${esc(buildHint(context))}</p>`}`;

	const body = `${hero({
		eyebrow: 'Temco AI',
		title: 'The Tool Server',
		mark: 'server-process',
		desc: 'The local program the assistant calls. It listens on this machine only, at an address this window chooses, and every request carries a token this window generated.',
		descWide: true,
		actions: [
			{ label: 'The tools it can call', command: 'temcoAi.tools', mark: 'tools', kind: 'primary' }
		]
	})}
<div id="status" class="mt-24">
	${section({ title: 'Status', desc: 'Started on demand, kept while this window is open, stopped when it closes. Nothing else on the machine is allowed in without the token.' })}
	<div class="mt-8">${statusBlock}</div>
</div>
<div class="mt-24">
	${section({ title: 'The program', desc: 'A .NET program published for this platform. Start downloads it the first time and repairs it after that.' })}
	${artifact}
</div>
<div class="mt-24">
	${section({ title: 'Where it answers', desc: 'The port it listens on, when this machine needs a fixed one. Zero lets the application pick a free port each start.' })}
	<div class="ai-field ai-field--short">
		<label for="port">Port</label>
		<input id="port" type="number" min="0" max="65535" spellcheck="false" value="${esc(String(port))}" />
		${localButton('save-port', 'Save', true)}
	</div>
	<p class="ai-note" id="port-note">${esc(
		port > 0 ? `Fixed at ${port}; a start fails if anything else holds it.` : 'Chosen at each start, so two windows never collide.'
	)}</p>
</div>
<div class="mt-24" id="api">
	${section({ title: 'Platform API', desc: 'The service the device, documentation, repository and project tools ask when the answer is not on this machine.' })}
	<div class="ai-field">
		<label for="api-address">Address</label>
		<input id="api-address" type="text" spellcheck="false" placeholder="http://127.0.0.1:3210" value="${esc(api)}" />
		${localButton('save-api', 'Save', true)}
	</div>
	<p class="ai-note" id="api-note">${esc(
		api.length > 0
			? `Set to ${api}. Devices, documentation, repositories, projects and the site are asked there.`
			: 'Not set, so the calls that need it answer that the service is not configured. The catalog calls read a file on this machine and carry on.'
	)}</p>
</div>`;

	const script = `window.__temcoStatus = ${JSON.stringify(status).replace(/</g, '\\u003c')};
window.__temcoAnchor = ${JSON.stringify(anchor ?? '')};
${CONNECTION_SCRIPT}`;

	return { body, script };
}

/** The status in a sentence: what it is doing, and what stopped it when it is not doing anything. */
function noteFor(status: ServerStatus): string {
	if (status.state === 'running') {
		return 'Running. The panel, the Tools page and every call go through this process.';
	}
	if (status.state === 'starting') {
		return 'Starting. A first start also downloads the program, which takes a moment.';
	}
	if (status.state === 'failed') {
		return status.error ?? 'It stopped. Show the log for what it said.';
	}
	return 'Stopped. It starts again the first time something needs it, or when you press Start.';
}

/** How long it has been up, as a person would say it. */
function when(epochSeconds: number): string {
	const seconds = Math.max(0, Math.floor(Date.now() / 1000) - epochSeconds);
	if (seconds < 60) {
		return `${seconds}s`;
	}
	if (seconds < 3600) {
		return `${Math.floor(seconds / 60)}m`;
	}
	return `${Math.floor(seconds / 3600)}h ${Math.floor((seconds % 3600) / 60)}m`;
}
