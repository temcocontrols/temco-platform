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
import { ToolSpec } from './ai/runtime';
import { PageMessage, RestorablePage, commandScript, escapeHtml as esc, callout, hero, icon, page, pageColumn, runCommand, section } from './ui';

export const ACTIONS_VIEW_TYPE = 'temcoAi.actions';
export const CITATIONS_VIEW_TYPE = 'temcoAi.citations';
export const STALE_VIEW_TYPE = 'temcoAi.stale';
export const TOOLS_VIEW_TYPE = 'temcoAi.tools';

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
/* The catalogue: two columns, no rules, nothing drawn around a call. A name is a link to the box that runs it. */
.ai-split { display: grid; grid-template-columns: minmax(0, 1fr) minmax(0, 1fr); gap: var(--sp-6); align-items: start; }
@media (max-width: 780px) { .ai-split { grid-template-columns: minmax(0, 1fr); } }
.ai-calls { display: grid; margin: var(--sp-2) 0 0; }
.ai-call { display: grid; grid-template-columns: minmax(132px, 44%) minmax(0, 1fr); gap: var(--sp-3); padding: 3px 0; align-items: baseline; }
.ai-call--more { display: none; }
.ai-link { appearance: none; background: none; border: 0; margin: 0; padding: 0; font-family: monospace; font-size: 12px; line-height: 18px; text-align: left; color: var(--vscode-textLink-foreground, inherit); cursor: pointer; }
.ai-link:hover { text-decoration: underline; }
.ai-link:focus-visible { outline: 1px solid var(--vscode-focusBorder, currentColor); outline-offset: 2px; }
.ai-call__desc { font-size: 12px; line-height: 18px; color: var(--ink-3); }
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
.ai-note { margin: var(--sp-2) 0 0; font-size: 12px; line-height: 18px; color: var(--ink-3); }
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

	/** The catalogue of calls, the server behind them, and the address some of them ask. */
	tools(section?: unknown): void {
		void this.openTools(undefined, typeof section === 'string' ? section : undefined);
	}

	private async openTools(restored?: vscode.WebviewPanel, anchor?: string): Promise<void> {
		const view = await toolsView(this.context, anchor);
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

	private async handlePageMessage(message: PageMessage, panel: vscode.WebviewPanel): Promise<void> {
		if (message.type === 'run') {
			await this.runTool(message, panel);
		} else if (message.type === 'saveApi') {
			await this.saveApi(message, panel);
		}
	}

	/** The one setting a person has to know about gets a field on the page rather than a box over it. */
	private async saveApi(message: PageMessage, panel: vscode.WebviewPanel): Promise<void> {
		const value = (message as unknown as { value?: unknown }).value;
		const address = typeof value === 'string' ? value.trim() : '';
		await vscode.workspace
			.getConfiguration('temcoAi')
			.update('platformApi', address, vscode.ConfigurationTarget.Global);
		void panel.webview.postMessage({ type: 'savedApi', value: address });
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
			{ viewType: TOOLS_VIEW_TYPE, open: (panel) => void this.openTools(panel) }
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
		// What the assistant can reach outside the page in front of it: the conversation itself, the process that
		// answers a call, the address the device and repository tools ask, and the catalogue of calls.
		id: 'mcp',
		rows: [
			{ label: 'Open the AI panel', note: 'the conversation, in the secondary side bar; once more puts it away', mark: 'comment-discussion', command: 'temcoAi.openPanel' },
			{ label: 'Connection', note: 'the program that answers a call, and the address it asks', mark: 'server-process', command: 'temcoAi.tools', args: ['connection'] },
			{ label: 'The tools it can call', note: 'what reads, what writes, and a box to run one', mark: 'tools', command: 'temcoAi.tools' }
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

/** How many calls a column shows before it offers the rest. */
const VISIBLE_CALLS = 6;

/** The script the Tools page runs: link a name to the runner, unfold a long column, run one call, save one field. */
const TOOLS_SCRIPT = `
(function () {
	const api = window.__temcoApi || (window.__temcoApi = acquireVsCodeApi());
	const select = document.getElementById('tool');
	const args = document.getElementById('args');
	const out = document.getElementById('out');
	const run = document.getElementById('run-it');
	const field = document.getElementById('api');
	const note = document.getElementById('api-note');
	const seeds = window.__toolSeeds || {};

	const fill = () => {
		if (!select || !args) { return; }
		args.value = JSON.stringify(seeds[select.value] || {}, undefined, 2);
	};
	if (select) { select.addEventListener('change', fill); }

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

	// The fold lives in the section's heading: it names what is left, and puts back what it took away.
	document.querySelectorAll('[data-toggle]').forEach((button) => {
		const list = document.getElementById(button.getAttribute('data-toggle'));
		if (!list) { return; }
		const folded = list.querySelectorAll('.ai-call--more');
		button.addEventListener('click', () => {
			const expanded = button.getAttribute('aria-expanded') === 'true';
			folded.forEach((row) => row.classList.toggle('ai-call--more', expanded));
			button.setAttribute('aria-expanded', expanded ? 'false' : 'true');
			button.textContent = expanded ? 'Show ' + folded.length + ' more' : 'Show less';
		});
	});

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

	const save = document.getElementById('save');
	if (save && field) {
		save.addEventListener('click', () => api.postMessage({ type: 'saveApi', value: field.value }));
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
		if (message.type === 'savedApi' && note) {
			note.textContent = message.value
				? 'Saved. The calls that need it will ask ' + message.value + ' from now on.'
				: 'Saved as empty: those calls will answer that the service is not configured.';
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

/**
 * One call: its name as a link to the runner, and the sentence the server wrote about it. Beyond the first few the
 * row is folded away, because a column of twenty is a wall rather than a catalogue.
 */
function callRow(tool: ToolSpec, index: number): string {
	const folded = index >= VISIBLE_CALLS ? ' ai-call--more' : '';
	return `<div class="ai-call${folded}"><button type="button" class="ai-link" data-tool="${esc(
		tool.name
	)}" title="Run ${esc(tool.name)}">${esc(tool.name)}</button><span class="ai-call__desc">${esc(
		tool.description
	)}</span></div>`;
}

/** The control that unfolds a column, in the section's own heading so it is found before the wall rather than after it. */
function toggleLink(id: string, total: number, shown: number): string {
	const more = Math.max(total - shown, 0);
	return `<button type="button" class="ai-toggle" data-toggle="${esc(id)}" aria-expanded="false" aria-controls="${esc(
		id
	)}">Show ${more} more</button>`;
}

/** One half of the catalogue: a heading with its fold control, and its calls. */
function callColumn(id: string, title: string, desc: string, items: readonly ToolSpec[]): string {
	const rows = items.map(callRow).join('');
	const actions = items.length > VISIBLE_CALLS ? toggleLink(id, items.length, VISIBLE_CALLS) : undefined;
	return `<div>${section({ title, desc, actions })}<div class="ai-calls" id="${esc(id)}">${rows}</div></div>`;
}

/** One fact the page is answerable for, told apart from the prose around it by its face, not a border. */
function fact(key: string, value: string): string {
	return `<div class="ai-fact"><span class="ai-fact__key">${esc(key)}</span><span class="ai-fact__value">${esc(value)}</span></div>`;
}

/** A button the page's own script listens for, rather than one that names a command. */
function localButton(id: string, label: string, primary = false): string {
	return `<button type="button" class="az-btn az-btn--sm${primary ? ' az-btn--primary' : ''}" id="${id}"><span>${esc(label)}</span></button>`;
}

/**
 * *Tools* - what the assistant can reach outside the page in front of it, and the two things that decide whether it
 * reaches anything at all.
 *
 * Three parts: the catalogue, split into what reads and what writes so the second half is never a surprise; one box
 * that runs a single call; and one part for the server and the address it asks, because they are one question, can
 * this reach anything and where, and a reader who has one of them open has the other in front of them anyway.
 */
async function toolsView(
	context: vscode.ExtensionContext,
	anchor?: string
): Promise<{ body: string; script: string }> {
	const catalogEntry = serverEntry();
	const binary = serverBinary(context);
	const api = platformApi();

	let tools: readonly ToolSpec[] = [];
	let problem = '';
	if (binary) {
		try {
			tools = await listTools(context, (line) => toolLog().appendLine(line));
		} catch (error) {
			problem = error instanceof Error ? error.message : String(error);
		}
	} else {
		problem = buildHint(context);
	}

	const reads = tools.filter((tool) => tool.readOnly === true);
	const writes = tools.filter((tool) => tool.readOnly !== true);

	const catalogue =
		tools.length === 0
			? callout({ title: 'Nothing to list yet', desc: problem || 'The tool server did not answer.', mark: 'warning' })
			: `<div class="ai-split">
	${callColumn('reads', 'Reads', `${reads.length} calls that change nothing.`, reads)}
	${callColumn('writes', 'Writes', writes.length === 0 ? 'None.' : 'Each asks the person at the keyboard first, every time.', writes)}
</div>`;

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

	const connection = `<div id="connection" class="mt-24">
	${section({ title: 'Connection', desc: 'The local program that answers a call, and the address it asks when the answer is not on this machine. It speaks the Model Context Protocol over stdin and never listens on a port.' })}
	<div class="mt-8">
		${fact('server', binary ? `ready, ${tools.length} calls` : 'not installed on this machine')}
		${fact('path', binary ?? serverFolder(context) ?? '')}
		${fact('platform', `${process.platform}-${process.arch}`)}
	</div>
	<div class="ai-run__row mt-8">${act('Install or repair', 'temcoAi.installToolServer')}${act('Show the log', 'temcoAi.showToolLog')}</div>
	${binary ? '' : `<p class="ai-note">${esc(problem)}</p>`}
	<div class="ai-field mt-24">
		<label for="api">Platform API</label>
		<input id="api" type="text" spellcheck="false" placeholder="http://127.0.0.1:3210" value="${esc(api)}" />
		${localButton('save', 'Save', true)}
	</div>
	<p class="ai-note" id="api-note">${esc(
		api.length > 0
			? `Set to ${api}. Devices, documentation, repositories, projects and the site are asked there.`
			: 'Not set, so the calls that need it answer that the service is not configured. The catalog calls read a file on this machine and carry on.'
	)}</p>
</div>`;

	const seeds: Record<string, Record<string, unknown>> = {};
	for (const tool of tools) {
		seeds[tool.name] = seedFor(tool);
	}
	// The seeds travel inside the page's one nonce-carrying script: the policy allows no other, and a second
	// inline script would simply never run.
	const script =
		`window.__toolSeeds = ${JSON.stringify(seeds).replace(/</g, '\\u003c')};` +
		`window.__temcoAnchor = ${JSON.stringify(anchor ?? '')};\n${TOOLS_SCRIPT}`;

	const body = `${hero({
		eyebrow: 'Temco AI',
		title: 'The Tools the Assistant Can Call',
		mark: 'tools',
		desc: catalogEntry
			? `${catalogEntry.label}. Every call the model can make outside this window, what it is told, and the two things that decide whether it can reach anything.`
			: 'Every call the model can make outside this window.',
		descWide: true,
		actions: [
			{ label: 'Open the AI Panel', command: 'temcoAi.openPanel', mark: 'comment-discussion', kind: 'primary' },
			{ label: 'Install the Tool Server', command: 'temcoAi.installToolServer', mark: 'cloud-download' }
		]
	})}
<div id="catalogue" class="mt-24">
	${section({ title: 'The catalogue', desc: 'Read from the server itself, so this list cannot drift from what the model is offered. Pick a name to run that call.' })}
	<div class="mt-8">${catalogue}</div>
</div>
${runner}
${connection}`;

	return { body, script };
}
