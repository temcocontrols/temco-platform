// The AI Hub's pages and its two side-bar groups, rebuilt from the mock.
//
// The subject of each page is the mock's (`docs/mock/js/views.platform.js` — `ai/chat`, `ai/actions`, `ai/citations`,
// `ai/models`, `ai/knowledge`), but the pages themselves are drawn in the application's own vocabulary: the title block,
// the section heading with its brand bar, and one row per thing. Nothing here is a card grid or a table any more — a
// model, an action and a citation are all one row each, because that is what a person reads them as.

import * as vscode from 'vscode';
import { entryById, formatBytes } from './ai/catalog';
import { installedArtifacts } from './ai/install';
import { describeMachine, machine as thisMachine } from './ai/machine';
import { aiStatus } from './ai/runtime';
import { ACTIONS, CITATIONS } from './aiSample';
import { DocsRoot, collectPages, docs } from './docs';
import { commandScript, escapeHtml as esc, callout, hero, icon, page, pageColumn, runCommand, section } from './ui';

export const CHAT_VIEW_TYPE = 'temcoAi.chat';
export const ACTIONS_VIEW_TYPE = 'temcoAi.actions';
export const CITATIONS_VIEW_TYPE = 'temcoAi.citations';
export const MODELS_VIEW_TYPE = 'temcoAi.localModels';
export const STALE_VIEW_TYPE = 'temcoAi.stale';

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

const MONTH = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

/** A date as a person reads it: the day, not the timestamp the manifest kept. */
const dayOf = (iso: string): string => {
	const at = new Date(iso);
	if (Number.isNaN(at.getTime())) {
		return 'an unknown day';
	}
	return `${at.getDate()} ${MONTH[at.getMonth()]} ${at.getFullYear()}`;
};

/** The brand bar every section title carries, so the AI pages read like the rest of the application. */
const AI_CSS = `
.az-section__title { position: relative; padding-left: 10px; }
.az-section__title::before { content: ''; position: absolute; left: 0; top: 50%; transform: translateY(-50%); width: 2px; height: 12px; border-radius: 1px; background: var(--az-blue, #0078d4); }
.ai-line { display: flex; flex-wrap: wrap; gap: 0 var(--sp-2); margin: var(--sp-3) 0 0; color: var(--ink-3); font-size: 12px; line-height: 18px; }
.ai-line span + span::before { content: '·'; margin-right: var(--sp-2); }
/* A row's second line here is prose about the thing, not a path: the kit sets it in the mono face for paths. */
.az-entry__meta { font-family: inherit; }
.ai-foot { margin: var(--sp-6) 0 0; color: var(--ink-3); font-size: 12px; line-height: 18px; max-width: 72ch; }
`;

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
		this.open('models', MODELS_VIEW_TYPE, 'Local Models', modelsBody(this.context));
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
		const html = page(body, { title, script: commandScript, extraCss: AI_CSS });
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

/**
 * *Chat* — the conversation itself.
 *
 * A page cannot hold a conversation that streams, and this module already has the surface that can: the panel, docked
 * beside the page it answers about. So this page says that, and then states what the panel is given and what it hands
 * back — the two things a person deciding whether to trust an answer needs.
 */
function chatBody(): string {
	return `${hero({
		eyebrow: 'Temco AI',
		title: 'Chat',
		mark: 'sparkle',
		desc: 'A local model over your own pages. It reads the page in front, the project around it and the registry; it never writes one — every draft lands in Review Center as a diff.',
		actions: [
			{ label: 'Open the AI Panel', command: 'temcoAi.openPanel', mark: 'panel', kind: 'primary' },
			{ label: 'Local Models', command: 'temcoAi.localModels', mark: 'chip', kind: 'link' }
		]
	})}
<div class="mt-16">${callout({
		title: 'The conversation lives in the panel',
		desc: 'It answers beside the page you have open, and it streams as it writes. The same information, with room to stand back, is on The AI page.',
		mark: 'panel',
		actions: `${act('Open the AI Panel', 'temcoAi.openPanel', { kind: 'primary', mark: 'panel' })}${act('The AI page', 'temcoAi.page', { kind: 'link' })}`
	})}</div>

<div class="mt-24">
	${section({ title: 'What it is given', desc: 'Everything below is read once per question. Nothing is sent anywhere, and nothing is remembered between chats.' })}
	<div class="mt-8">${rows([
		row({ mark: 'document', title: 'The page in front', meta: 'its text, its headings and the registry entry that describes it', actions: act('Show the page', 'temcoDocs.pages.focus', { kind: 'link' }) }),
		row({ mark: 'folder', title: 'The project around it', meta: 'the sources it cites, and the areas those sources produced', actions: act('Edit the project', 'temcoProjects.editProject', { kind: 'link' }) }),
		row({ mark: 'list', title: 'The registry', meta: 'the generator’s own record: what each page claims to document, and whether that code moved', actions: act('Documents', 'temcoDocs.documents', { kind: 'link' }) })
	])}</div>
</div>

<div class="mt-24">
	${section({ title: 'What it hands back', desc: 'An answer is read in the panel; a draft is a proposal, and nothing writes a page except a person accepting one.' })}
	<div class="mt-8">${rows([
		row({ mark: 'sparkle', title: 'An answer', meta: 'in the panel, with the pages and files it used named under it', actions: act('Citations', 'temcoAi.citations', { kind: 'link' }) }),
		row({ mark: 'check', title: 'A draft', meta: 'a page written beside the original, settled in Review Center as a diff', actions: act('Review Center', 'temcoDocs.review', { kind: 'link' }) }),
		row({ mark: 'sync', title: 'A page update', meta: 'the pages whose code moved after their last review, ready to draft one at a time', actions: act('Open', 'temcoAi.stale', { kind: 'link' }) })
	])}</div>
</div>`;
}

/** *Actions* — what the AI is allowed to do, and where each answer goes. */
function actionsBody(): string {
	const available = ACTIONS.length;
	const blocked = ACTIONS.filter((action) => action.tone !== 'ok').length;

	return `${hero({
		eyebrow: 'Temco AI',
		title: 'Actions',
		mark: 'play',
		desc: 'The things the AI is allowed to do, and where its output goes. An action that writes anything always routes through Review Center.',
		actions: [
			{ label: 'Configure', command: 'temcoWorkbench.settings', mark: 'gear', kind: 'primary' },
			{ label: 'The AI page', command: 'temcoAi.page', kind: 'link' }
		]
	})}
${figures([`${available} actions`, blocked === 0 ? 'all of them ready' : `${blocked} needs a model first`, 'nothing writes without a person'])}
<div class="mt-24">
	${section({ title: 'What it can do', desc: 'An action whose model is not loaded says so here, rather than failing halfway through a draft.' })}
	<div class="mt-8">${rows(ACTIONS.map((action) => row({
		mark: action.tone === 'ok' ? 'play' : 'info',
		title: action.name,
		meta: `${action.desc} · ${action.state}`,
		actions: action.tone === 'ok'
			? act('Run', 'temcoAi.openPanel', { mark: 'arrow-right' })
			: act('Load Model', 'temcoAi.localModels', { mark: 'chip' })
	})))}</div>
</div>
<div class="mt-24">
	${section({ title: 'Where the output goes', desc: 'Nothing an action produces is a silent write: each one lands somewhere a person already looks.' })}
	<div class="mt-8">${rows([
		row({ mark: 'document', title: 'Drafts', meta: 'Review Center, as a diff against the page it would replace', actions: act('Open', 'temcoDocs.review', { kind: 'link' }) }),
		row({ mark: 'sparkle', title: 'Answers', meta: 'the AI panel, with the citations that back them', actions: act('The panel', 'temcoAi.openPanel', { kind: 'link' }) }),
		row({ mark: 'check', title: 'Suggestions', meta: 'the Gaps list of the area the question was about', actions: act('Cite them', 'temcoAi.citations', { kind: 'link' }) })
	])}</div>
</div>
<div class="mt-24">
	${section({ title: 'Guard rails', desc: 'Fixed on purpose. Changing one of these is a platform change, not a setting, so none of them is switchable here.' })}
	<div class="mt-8">${rows([
		row({ mark: 'check', title: 'Never write a page without a draft' }),
		row({ mark: 'check', title: 'Always name the page or source each answer used' }),
		row({ mark: 'check', title: 'Refuse when the local model is not loaded, rather than answer from nothing' }),
		row({ mark: 'check', title: 'Keep prompts and answers out of the repository' })
	])}</div>
</div>`;
}

/** *Citations* — every answer names what it read. */
function citationsBody(): string {
	return `${hero({
		eyebrow: 'Temco AI',
		title: 'Citations',
		mark: 'link',
		desc: 'Every answer names where it came from. A citation opens the page or the file it points at — the AI is checked by reading it, not by trusting it.',
		actions: [
			{ label: 'The panel', command: 'temcoAi.openPanel', mark: 'panel', kind: 'primary' },
			{ label: 'Documents', command: 'temcoDocs.documents', kind: 'link' }
		]
	})}
${figures([`${CITATIONS.length} cited`, `${CITATIONS.filter((citation) => citation.kind === 'page').length} of them pages`, 'kept with the answer that used them'])}
<div class="mt-24">
	${section({ title: 'Cited so far', desc: 'A citation is kept beside the answer that used it, so a reader can check the AI without leaving the page it was asked about.' })}
	<div class="mt-8">${rows(CITATIONS.map((citation) => row({
		mark: citation.kind === 'page' ? 'document' : citation.kind === 'source' ? 'repo' : 'package',
		title: citation.title,
		meta: `${citation.where} · ${citation.kind} · ${citation.usedIn}`,
		actions: act('Open', 'temcoDocs.page', { args: [citation.title] })
	})))}</div>
</div>`;
}

/**
 * *Local Models* — what is actually on this machine, and what is answering with it.
 *
 * The figures are the runtime's own: the manifest of installed artifacts, the two settings that name the choice, and
 * the server if it is up. A page about what is downloaded cannot be an illustration of what could be downloaded.
 */
function modelsBody(context: vscode.ExtensionContext): string {
	const status = aiStatus(context);
	const installed = installedArtifacts(context);
	const configuration = vscode.workspace.getConfiguration('temcoAi');
	const chosenModel = configuration.get<string>('model', '');
	const chosenRuntime = configuration.get<string>('runtime', '');
	const total = installed.reduce((sum, artifact) => sum + artifact.bytes, 0);
	const models = installed.filter((artifact) => artifact.kind === 'model');
	const runtimes = installed.filter((artifact) => artifact.kind !== 'model');
	const label = (id: string): string => entryById(id)?.label ?? id;

	const modelRows = models.map((artifact) => {
		const chosen = artifact.id === chosenModel || artifact.id === status.model?.id;
		return row({
			mark: chosen ? 'chip' : 'package',
			title: label(artifact.id),
			meta: `${chosen ? 'answering now · ' : ''}${formatBytes(artifact.bytes)} · added ${dayOf(artifact.installedAt)} · ${artifact.path}`,
			actions: chosen
				? act('Rechoose', 'temcoAi.models', { kind: 'link' })
				: act('Use this one', 'temcoAi.models', { kind: 'link' })
		});
	});

	const runtimeRows = runtimes.map((artifact) => row({
		mark: 'activity',
		title: label(artifact.id),
		meta: `${artifact.id === chosenRuntime || artifact.id === status.runtime?.id ? 'chosen · ' : ''}${formatBytes(artifact.bytes)} · added ${dayOf(artifact.installedAt)}`,
		actions: act('Rechoose', 'temcoAi.models', { kind: 'link' })
	}));

	const engine = [
		row({
			mark: 'activity',
			title: status.running === undefined ? 'The server is not running' : `Listening on ${status.running.baseUrl}`,
			meta: status.running === undefined
				? 'it starts when something needs it, and stops again when nothing does'
				: `${status.running.label} · it stops itself when nothing has needed it for a while`,
			actions: act(status.running === undefined ? 'The AI page' : 'Show the log', 'temcoAi.page', { kind: 'link' })
		}),
		row({
			mark: 'package',
			title: 'Where they are kept',
			meta: installed.length === 0
				? 'a folder of your own, outside every repository — a clone never carries a model'
				: `${formatBytes(total)} in a folder of your own, outside every repository — a clone never carries a model`
		}),
		row({ mark: 'check', title: 'Nothing leaves this machine', meta: 'the server listens on loopback; prompts stay in the platform database' })
	];

	return `${hero({
		eyebrow: 'Temco AI',
		title: 'Local Models',
		mark: 'chip',
		desc: 'The models and runtimes downloaded to this machine, and which two of them answer. Nothing is sent anywhere: a model is downloaded once and kept in the user’s folder.',
		actions: [
			{ label: 'Download a Model', command: 'temcoAi.page', mark: 'download', kind: 'primary' },
			{ label: 'The panel', command: 'temcoAi.openPanel', mark: 'panel', kind: 'link' }
		]
	})}
${figures(installed.length === 0
		? ['nothing installed yet', 'nothing leaves this machine']
		: [
			`${models.length} ${models.length === 1 ? 'model' : 'models'} on disk`,
			`${runtimes.length} ${runtimes.length === 1 ? 'runtime' : 'runtimes'}`,
			formatBytes(total),
			status.running === undefined ? 'server not running' : 'server running'
		])}

${installed.length === 0
		? `<div class="mt-24">${callout({
			title: 'Nothing is installed yet',
			desc: 'The AI refuses rather than answering from nothing. Downloading is one model file and one runtime for this machine — they stay in your own folder, and no repository ever carries them.',
			mark: 'download',
			actions: `${act('Choose a Model', 'temcoAi.page', { kind: 'primary', mark: 'download' })}${act('The AI page', 'temcoAi.page', { kind: 'link' })}`
		})}</div>`
		: `<div class="mt-24">
	${section({
		title: 'On this machine',
		desc: 'What is downloaded, newest first. A chat model and an embedding model can answer at once; everything else waits its turn.'
	})}
	<div class="mt-8">${rows([...modelRows, ...runtimeRows])}</div>
</div>`}

<div class="mt-24">
	${section({ title: 'The engine', desc: 'One runtime per machine, chosen when it is downloaded and never switched behind the reader’s back.' })}
	<div class="mt-8">${rows(engine)}</div>
</div>

<p class="ai-foot">${esc(
		`This machine: ${describeMachine(thisMachine())}. Removing a model deletes that one file and nothing else — the choice is kept, and the page says the model is missing until another is installed.`
	)}</p>`;
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
