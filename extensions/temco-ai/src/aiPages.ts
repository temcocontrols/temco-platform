// The AI Hub's pages and its two side-bar groups, rebuilt from the mock.
//
// Source: `docs/mock/js/views.platform.js` — `ai/chat`, `ai/actions`, `ai/citations`, `ai/models` and
// `ai/knowledge` — and the mock's AI Hub side bar: *Assistant* (Chat · Actions · Citations) and *Runtime*
// (Local Models · Knowledge Base). The rows are the mock's sample (`aiSample.ts`); what the module actually runs
// is still answered by `aiStatus()` and shown in the AI bar, and every button here is one of this module's own
// commands or the documentation module's.

import * as vscode from 'vscode';
import { ACTIONS, AiModel, CITATIONS, MODELS } from './aiSample';
import { DocsRoot, collectPages, docs } from './docs';
import { commandScript, escapeHtml as esc, icon, page, pageColumn, runCommand } from './ui';

export const CHAT_VIEW_TYPE = 'temcoAi.chat';
export const ACTIONS_VIEW_TYPE = 'temcoAi.actions';
export const CITATIONS_VIEW_TYPE = 'temcoAi.citations';
export const MODELS_VIEW_TYPE = 'temcoAi.localModels';
export const STALE_VIEW_TYPE = 'temcoAi.stale';

interface ActionOptions {
	kind?: 'primary' | 'ghost';
	mark?: string;
	small?: boolean;
	args?: unknown;
}

const button = (label: string, command: string, options: ActionOptions = {}): string =>
	`<button type="button" class="btn${options.small ? ' btn--sm' : ''}${options.kind ? ` btn--${options.kind}` : ''}" data-command="${command}"${options.args === undefined ? '' : ` data-args="${esc(JSON.stringify(options.args))}"`}>${options.mark ? icon(options.mark) : ''}<span>${esc(label)}</span></button>`;

const pageHead = (options: { title: string; mark: string; desc: string; actions?: string }): string =>
	`<div class="page-head"><div class="page-head__main"><h1 class="page-head__title">${icon(options.mark)}${esc(options.title)}</h1><p class="page-head__desc">${options.desc}</p></div>${options.actions ? `<div class="page-head__actions">${options.actions}</div>` : ''}</div>`;

const card = (options: { title: string; mark?: string; actions?: string; desc?: string; body?: string }): string =>
	`<div class="card card--plain"><div class="card__head">${options.mark ? `<span class="card__icon">${icon(options.mark)}</span>` : ''}<div class="card__title">${esc(options.title)}</div>${options.actions ? `<div class="card__actions">${options.actions}</div>` : ''}</div>${options.desc ? `<p class="card__desc">${options.desc}</p>` : ''}${options.body ?? ''}</div>`;

const badge = (text: string, tone?: string): string =>
	`<span class="badge${tone && tone !== 'neutral' ? ` badge--${tone}` : ''}">${esc(text)}</span>`;

const list = (items: { mark: string; title: string; sub?: string; meta?: string }[]): string =>
	`<div class="list">${items.map((item) => `<div class="list__item">${icon(item.mark)}<div class="list__main"><div class="list__title">${esc(item.title)}</div>${item.sub ? `<div class="list__sub">${item.sub}</div>` : ''}</div>${item.meta ? `<div class="list__meta">${item.meta}</div>` : ''}</div>`).join('')}</div>`;

const tiles = (items: { value: string; label: string }[]): string =>
	`<div class="tiles">${items.map((item) => `<div class="tile"><span class="tile__value">${esc(item.value)}</span><span class="tile__label">${esc(item.label)}</span></div>`).join('')}</div>`;

const table = (head: string[], rows: string[][]): string =>
	`<div class="table-wrap table-wrap--plain"><table class="table table--compact"><thead><tr>${head.map((cell) => `<th>${esc(cell)}</th>`).join('')}</tr></thead><tbody>${rows.map((cells) => `<tr>${cells.map((cell) => `<td>${cell}</td>`).join('')}</tr>`).join('')}</tbody></table></div>`;

const barRow = (pct: number, value: string, kind?: string): string =>
	`<div class="bar-row"><div class="bar"><span class="bar__fill${kind ? ` bar__fill--${kind}` : ''}" style="width:${pct}%"></span></div><span class="bar-row__value">${esc(value)}</span></div>`;

/** The five surfaces, one panel each. */
export class AiPages {
	private readonly panels = new Map<string, vscode.WebviewPanel>();

	constructor(private readonly context: vscode.ExtensionContext) { }

	chat(): void {
		this.open('chat', CHAT_VIEW_TYPE, 'Temco AI', chatBody());
	}

	actions(): void {
		this.open('actions', ACTIONS_VIEW_TYPE, 'Actions', actionsBody());
	}

	citations(): void {
		this.open('citations', CITATIONS_VIEW_TYPE, 'Citations', citationsBody());
	}

	models(): void {
		this.open('models', MODELS_VIEW_TYPE, 'Local Models', modelsBody());
	}

	/** Pages the generator says are stale: the code they document moved after their last review. */
	stale(): void {
		let roots: readonly DocsRoot[] = [];
		try {
			roots = docs().roots();
		} catch {
			// No documentation module: the page still opens and says there is nothing to compare against.
			roots = [];
		}
		this.open('stale', STALE_VIEW_TYPE, 'Update a Page the Code Moved', staleBody(roots));
	}

	dispose(): void {
		for (const panel of this.panels.values()) {
			panel.dispose();
		}
		this.panels.clear();
	}

	private open(key: string, viewType: string, title: string, body: string): void {
		const html = page(body, { title, script: commandScript });
		const existing = this.panels.get(key);
		if (existing) {
			existing.reveal(pageColumn());
			existing.webview.html = html;
			return;
		}
		const panel = vscode.window.createWebviewPanel(viewType, title, pageColumn(), {
			enableScripts: true,
			localResourceRoots: []
		});
		panel.iconPath = vscode.Uri.joinPath(this.context.extensionUri, 'media', 'ai.svg');
		panel.webview.onDidReceiveMessage(runCommand);
		panel.webview.html = html;
		this.panels.set(key, panel);
		panel.onDidDispose(() => this.panels.delete(key));
	}
}

/** *Chat* — the mock's `ai/chat`. */
function chatBody(): string {
	const messages = [
		{ who: 'You', user: true, text: 'Summarise the page I have open and tell me what is out of date.' },
		{ who: 'Temco AI', text: 'Data Points API lists the read and write endpoints for a controller’s points, plus the scale factor each type uses. Two things drifted: the page says every point is a 32-bit float, which stopped being true for AI and AO points on firmware 2.14; and the screenshot was taken on 2.9.', cites: ['Data Points API', 'point.h', 'User Manual p.148'] },
		{ who: 'You', user: true, text: 'Draft the fix.' },
		{ who: 'Temco AI', text: 'I drafted 3 paragraphs and replaced the screenshot reference. Nothing has been written — open Review Center to see the diff, accept or reject it.', cites: ['Draft · api-reference/data-points.md'] }
	];

	const thread = messages.map((message) =>
		`<div class="chat__message${message.user ? ' chat__message--user' : ''}"><div class="chat__who">${icon(message.user ? 'account' : 'sparkle')}${esc(message.who)}</div><div class="chat__bubble"><p>${esc(message.text)}</p>${message.cites ? `<div class="chat__cites">${message.cites.map((cite) => `<button type="button" class="chat__cite" data-command="temcoAi.citations">${esc(cite)}</button>`).join('')}</div>` : ''}</div></div>`
	).join('');

	return `${pageHead({
		title: 'Temco AI',
		mark: 'sparkle',
		desc: 'A local model over the documentation. It reads pages, sources and the registry; it never writes one — every draft lands in Review Center as a diff.',
		actions: badge('local · qwen2.5-3b', 'ok') + button('Models', 'temcoAi.localModels', { mark: 'chip' })
	})}
<div class="mt-24">
${card({
		title: 'Conversation',
		mark: 'sparkle',
		actions: button('Clear', 'temcoAi.chat', { small: true, kind: 'ghost' }),
		desc: `${messages.length} messages. Each answer names what it read; the draft names where it landed.`,
		body: `<div class="chat chat--page">${thread}</div><div class="chat__starters"><span class="cell-muted" style="font-size:11px;align-self:center">Try</span>${button('Find gaps in this area', 'temcoAi.actions', { small: true, kind: 'ghost' })}${button('Draft a release note', 'temcoDocs.review', { small: true, kind: 'ghost' })}${button('Explain this page', 'temcoAi.openPanel', { small: true, kind: 'ghost' })}</div><div class="chat__composer"><div class="chat__row" style="gap:6px"><span class="cell-muted" style="font-size:11px">Reading</span><span class="chat__cite" title="the page that is open">Data Points API</span><span class="chat__cite" title="402 pages, 8 of them in this conversation">API Reference</span><span class="chat__cite" title="412 files read">t3000webview</span><span class="chat__cite" title="8 areas · 1,254 pages">registry.json</span></div><textarea placeholder="Ask about the page that is open…" aria-label="Message"></textarea><div class="chat__row"><span class="chip">qwen2.5-3b · local</span><span class="cell-muted" style="font-size:11px">Nothing leaves this machine</span>${button('Send', 'temcoAi.openPanel', { small: true, kind: 'primary', mark: 'arrow-right' })}</div></div>`
	})}
</div>`;
}

/** *Actions* — the mock's `ai/actions`. */
function actionsBody(): string {
	const rows = ACTIONS.map((action) => [
		`<span class="cell-strong">${esc(action.name)}</span><div class="cell-muted" style="font-size:12px">${esc(action.desc)}</div>`,
		badge(action.state, action.tone),
		action.tone === 'ok' ? button('Run', 'temcoAi.openPanel', { small: true, kind: 'primary' }) : button('Load Model', 'temcoAi.models', { small: true })
	]);

	return `${pageHead({
		title: 'Actions',
		mark: 'play',
		desc: 'The things the AI is allowed to do, and where its output goes. An action that writes anything always routes through Review Center.',
		actions: button('Configure', 'temcoWorkbench.settings', { mark: 'gear' })
	})}
<div class="mt-24">
${card({
		title: 'What It Can Do',
		mark: 'sparkle',
		desc: 'An action without a loaded model says so instead of failing halfway.',
		body: table(['Action', 'State', ''], rows)
	})}
</div>
<div class="mt-24 grid grid--2">
${card({
		title: 'Where Output Goes',
		mark: 'arrow-right',
		desc: 'Nothing an action produces is a silent write.',
		body: list([
			{ mark: 'document', title: 'Drafts', sub: '<span class="cell-muted">Review Center, as a diff</span>', meta: badge('Diff', 'info') },
			{ mark: 'check', title: 'Answers', sub: '<span class="cell-muted">the AI bar, with citations</span>', meta: badge('Chat', 'neutral') },
			{ mark: 'list', title: 'Suggestions', sub: '<span class="cell-muted">the Gaps list of an area</span>', meta: badge('List', 'neutral') }
		])
	})}
${card({
		title: 'Guard Rails',
		mark: 'key',
		desc: 'Fixed on purpose. Changing one of these is a platform change, not a setting.',
		body: list([
			{ mark: 'check', title: 'Never write a page without a draft', meta: badge('Enforced', 'ok') },
			{ mark: 'check', title: 'Always cite the page or source used', meta: badge('Enforced', 'ok') },
			{ mark: 'check', title: 'Refuse when the local model is not loaded', meta: badge('Enforced', 'ok') },
			{ mark: 'check', title: 'Keep prompts and answers out of the repository', meta: badge('Enforced', 'ok') }
		])
	})}
</div>`;
}

/** *Citations* — the mock's `ai/citations`. */
function citationsBody(): string {
	const rows = CITATIONS.map((citation) => [
		`<span class="cell-strong">${esc(citation.title)}</span>`,
		badge(citation.kind, citation.kind === 'page' ? 'accent' : 'neutral'),
		`<span class="cell-mono cell-muted">${esc(citation.where)}</span>`,
		`<span class="cell-muted">${esc(citation.usedIn)}</span>`,
		button('Open', 'temcoDocs.page', { small: true, kind: 'ghost', args: [citation.title] })
	]);

	return `${pageHead({
		title: 'Citations',
		mark: 'link',
		desc: 'Every answer names where it came from. A citation opens the page or the file it points at, in the editor column that is already open.',
		actions: button('Open Source', 'temcoProjects.editProject', { mark: 'repo' })
	})}
<div class="mt-24">
${card({
		title: 'Cited So Far',
		mark: 'link',
		desc: 'A citation is kept with the answer that used it, so a reader can check the AI without leaving the page.',
		body: table(['Cited', 'Kind', 'Where', 'Used In', ''], rows)
	})}
</div>`;
}

/** *Local Models* — the mock's `ai/models`. */
function modelsBody(): string {
	const loaded = MODELS.filter((model) => model.state === 'Loaded').length;

	const rows = MODELS.map((model: AiModel) => [
		`<span class="cell-strong cell-mono">${esc(model.name)}</span><div class="cell-muted" style="font-size:12px">${esc(model.kind)}</div>`,
		`<span class="cell-mono">${esc(model.ctx)}</span>`,
		`<span class="cell-mono cell-muted">${esc(model.size)}</span>`,
		badge(model.state, model.tone),
		model.tone === 'ok' ? button('Unload', 'temcoAi.models', { small: true, kind: 'ghost' }) : button('Load', 'temcoAi.models', { small: true })
	]);

	return `${pageHead({
		title: 'Local Models',
		mark: 'chip',
		desc: 'Models run on this machine. Nothing is sent anywhere; a model is downloaded once and kept in the user’s folder.',
		actions: button('Download Model', 'temcoAi.models', { kind: 'primary', mark: 'download' })
	})}
<div class="mt-24">
${card({
		title: 'Models',
		mark: 'chip',
		actions: button('Runtime Settings', 'temcoAi.page', { small: true, kind: 'ghost', mark: 'gear' }),
		desc: `${MODELS.length} downloaded, ${loaded} loaded. A chat model and an embedding model can be loaded at once; everything else waits.`,
		body: table(['Model', 'Context', 'Size', 'State', ''], rows)
	})}
</div>
<div class="mt-24 grid grid--3">
${card({ title: 'Runtime', mark: 'activity', desc: 'llama.cpp · CPU, 6 threads', body: '<div class="cell-muted" style="font-size:12px">12.4 tokens/s · 2.1 GB resident</div>' })}
${card({ title: 'Storage', mark: 'package', desc: 'Models live in ~/temco/models, outside every repository.', body: barRow(48, '2.4 GB', 'ok') })}
${card({ title: 'Privacy', mark: 'check', desc: 'No network calls once a model is loaded. Prompts stay in the platform database.', body: badge('Offline', 'ok') })}
</div>`;
}

/**
 * *Update a page the code moved* — the one page about drafting that needs no model call to be useful.
 *
 * The generator records, per page, the code paths it documents and whether they moved after the last human review.
 * That is the list: a page, where it sits, and the files that moved under it, with the two acts a person actually has —
 * open the page, or take it to the panel to draft the update.
 */
function staleBody(roots: readonly DocsRoot[]): string {
	const pages = roots.flatMap((root) => collectPages(root));
	const stale = pages.filter((page) => page.exists && page.provenance?.stale === true);
	const never = pages.filter((page) => page.reviewed === null).length;

	const rows = stale.map((page) => ({
		mark: 'sync',
		title: page.title,
		sub: `<span class="cell-muted">${esc(page.area)}${page.chapter === '' ? '' : ` › ${esc(page.chapter)}`} · ${esc((page.provenance?.code ?? []).join(' · ') || 'no code path recorded')}</span>`,
		meta: button('Open', 'temcoDocs.openFile', { small: true, kind: 'ghost', args: page.uri.fsPath })
			+ button('Draft it', 'temcoAi.openPanel', { small: true, args: page.uri.fsPath })
	}));

	return `${pageHead({
		title: 'Update a Page the Code Moved',
		mark: 'sync',
		desc: 'The generator judges each page against the code it names. These moved after the last review — the page is not wrong yet, it is unverified. A draft is written beside the page and settled in Review Center; nothing here overwrites a file.',
		actions: button('Open the AI panel', 'temcoAi.openPanel', { kind: 'primary', mark: 'sparkle' })
	})}
${tiles([
		{ value: String(stale.length), label: stale.length === 1 ? 'Page whose code moved' : 'Pages whose code moved' },
		{ value: String(pages.length), label: pages.length === 1 ? 'Page read' : 'Pages read' },
		{ value: String(never), label: 'Never reviewed' }
	])}
<div class="mt-24">
${stale.length === 0
			? card({
				title: 'Nothing has moved',
				mark: 'check',
				desc: roots.length === 0
					? 'No documentation set is being read, so there is nothing to compare against. Open a project in Documentation and this list fills itself.'
					: 'Every page still matches the code it names, as far as the last read could tell.'
			})
			: card({
				title: 'Stale pages',
				mark: 'sync',
				desc: `${stale.length} ${stale.length === 1 ? 'page' : 'pages'}, most recently changed code first. The paths under each one are what the registry says it documents.`,
				body: list(rows)
			})}
</div>
<div class="mt-24">
${card({
				title: 'What happens to a draft',
				mark: 'document',
				desc: 'The same three steps as any other draft, so an update cannot reach a reader without a person and a build.',
				body: list([
					{ mark: 'sparkle', title: 'The model drafts beside the page', sub: '<span class="cell-muted">it reads the page, the registry entry and the files that moved — nothing else</span>' },
					{ mark: 'check', title: 'Review Center settles it', sub: '<span class="cell-muted">accept writes the page exactly as the draft reads; discard leaves it alone</span>' },
					{ mark: 'upload', title: 'A build and a publish carry it', sub: '<span class="cell-muted">see Build Center and Publish &amp; Releases</span>' }
				])
			})}
</div>`;
}

/** The AI Hub's side-bar groups. The chat is the panel, not a row that opens a page. */
interface Row {
	label: string;
	note: string;
	mark: string;
	command: string;
}

/**
 * Three groups, because there are three questions: what am I drafting, what is drafting it, and what has it produced.
 *
 * The old single *Runtime* group held the model and a Knowledge Base that nothing read; the base is gone, and what is
 * left is arranged around the work — a draft, the model behind it, and the drafts waiting for a person.
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
		id: 'model',
		rows: [
			{ label: 'Local Models', note: 'what is downloaded, and what is loaded', mark: 'chip', command: 'temcoAi.localModels' },
			{ label: 'Server & Prompts', note: 'what a draft is told, and what answers it', mark: 'gear', command: 'temcoAi.page' }
		]
	}
];

/** Registers the two group views the AI Hub container shows. */
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
						item.command = { command: row.command, title: row.label };
						return item;
					})
				}
			})
		);
	}
}
