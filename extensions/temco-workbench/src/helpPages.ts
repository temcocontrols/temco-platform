// Help — the six surfaces behind the Help container.
//
// Rebuilt from the mock (`docs/mock/js/views.help.js`: `help/welcome`, `help/home`, `help/keys`, `help/logs`,
// `help/issue`, `help/about`). They answer questions about the window itself — which keys do what, where the logs
// are, what to send with a bug, and what this build is — so they are pages rather than dialogs: a shortcut can be
// read while the thing it opens is open.
//
// **The pages read the window, not a sample.** The logs page lists the files this profile actually wrote and shows
// the tail of the largest one; the shortcuts page checks every command it names against the ones the host really
// registers; the About page reports the platform it is running on; Welcome's progress is the state of this window.
// Where a fact cannot be read — a keybinding, a shell version — the page says so instead of inventing one.

import * as vscode from 'vscode';
import { ISSUE_INCLUDES, LOG_FILES, SHORTCUTS } from './helpSample';
import type { Selection } from './store';
import { actionBar, button, cards, code, commandScript, entries, entry, entryRow, figures, floatAction, formFields, head, hero, icon, n, notice, optionCards, page, pageColumn, part, productName, questions, section } from './ui';

export const HELP_WELCOME_VIEW_TYPE = 'temcoWorkbench.help.welcome';
export const HELP_HOME_VIEW_TYPE = 'temcoWorkbench.help.home';
export const HELP_KEYS_VIEW_TYPE = 'temcoWorkbench.help.keys';
export const HELP_LOGS_VIEW_TYPE = 'temcoWorkbench.help.logs';
export const HELP_ISSUE_VIEW_TYPE = 'temcoWorkbench.help.issue';
export const HELP_ABOUT_VIEW_TYPE = 'temcoWorkbench.help.about';

/** The setting the welcome page's checkbox writes. */
const START_OPEN = 'start.open';

/* ------------------------------------------------------------------ page vocabulary */

/** A string a person reads, marked for translation. Bundles arrive from the build; without one this is the text. */
const t = (message: string, ...args: (string | number | boolean)[]): string => vscode.l10n.t(message, ...args);

/** A key, as a page draws it: the shortcuts page is a list of them, so the shape has to read as something you press. */
const kbd = (keys: string[]): string => keys.map((key) => `<kbd>${key}</kbd>`).join(' ');

/**
 * The welcome page's own styles: the startup preference, drawn as a switch rather than as a card.
 *
 * `.az-check` is the kit's check *card* — a bordered box with a leading glyph, built for a list of checks inside a
 * form. In the sticky foot of this page it stood twice as tall as the buttons beside it and read as one more panel
 * rather than as a preference, so here the same control is flattened to one line: a 14px box that fills brand-blue
 * when it is on, the words beside it, and the height of a small button.
 */
const WELCOME_CSS = `
.az-actions__buttons {
	align-items: center;
}

.az-actions__buttons .az-check {
	grid-template-columns: 15px auto;
	gap: var(--sp-2);
	align-items: center;
	height: 24px;
	padding: 0 var(--sp-2);
	border: 0;
	background: transparent;
}

.az-actions__buttons .az-check:has(input:checked) {
	border: 0;
	background: transparent;
}

.az-actions__buttons .az-check__icon {
	display: none;
}

.az-actions__buttons .az-check__main {
	grid-column: 2;
	grid-row: 1;
}

.az-actions__buttons .az-check__tick {
	grid-column: 1;
	grid-row: 1;
	width: 15px;
	height: 15px;
	border: 1px solid var(--border);
	border-radius: 3px;
	color: transparent;
}

.az-actions__buttons .az-check:has(input:checked) .az-check__tick {
	border-color: var(--az-blue);
	background: var(--az-blue);
	color: #fff;
}

.az-actions__buttons .az-check__tick .icon {
	width: 10px;
	height: 10px;
}

.az-actions__buttons .az-check__label {
	color: var(--fg-muted);
	font-size: 12px;
	line-height: 16px;
}

.az-actions__buttons .az-check:hover .az-check__label {
	color: var(--ink-1);
}
`;

/* ------------------------------------------------------------------ the six pages */

/** The six Help surfaces, one panel each. */
export class HelpPages {
	private readonly panels = new Map<string, vscode.WebviewPanel>();

	constructor(
		private readonly context: vscode.ExtensionContext,
		private readonly selection: Selection
	) { }

	welcome(restored?: vscode.WebviewPanel): void {
		void this.open('welcome', HELP_WELCOME_VIEW_TYPE, 'Welcome', this.welcomeBody(), restored);
	}

	home(restored?: vscode.WebviewPanel): void {
		void this.open('home', HELP_HOME_VIEW_TYPE, 'Help', homeBody(), restored);
	}

	/** Reads the command list first: the page's one job is to say which of these keys reaches a command here. */
	async keys(restored?: vscode.WebviewPanel): Promise<void> {
		let registered: string[] = [];
		try {
			registered = await vscode.commands.getCommands(true);
		} catch {
			// A host that will not list its commands leaves every row unknown rather than "missing".
			registered = [];
		}
		await this.open('keys', HELP_KEYS_VIEW_TYPE, 'Keyboard Shortcuts', keysBody(registered), restored);
	}

	/** Reads this profile's log folder: the files, their sizes, and the tail of the largest. */
	async logs(restored?: vscode.WebviewPanel): Promise<void> {
		await this.open('logs', HELP_LOGS_VIEW_TYPE, 'Logs', await logsBodyFor(this.context), restored);
	}

	issue(restored?: vscode.WebviewPanel): void {
		void this.open('issue', HELP_ISSUE_VIEW_TYPE, 'Report an Issue', issueBody(vscode.version), restored);
	}

	about(restored?: vscode.WebviewPanel): void {
		void this.open('about', HELP_ABOUT_VIEW_TYPE, 'About', aboutBody(), restored);
	}

	/** Re-renders Welcome if it is open — its one checkbox is a setting, and the setting can change elsewhere. */
	refresh(): void {
		const panel = this.panels.get('welcome');
		if (panel) {
			panel.webview.html = page(this.welcomeBody(), { title: 'Welcome', script: commandScript, extraCss: WELCOME_CSS });
		}
	}

	/** The report the Issue page collected: title, steps, where, and this window's own facts. */
	async copyReport(draft: { title?: string; steps?: string; where?: string } | undefined, open = true): Promise<void> {
		const text = [
			`# ${draft?.title || '(no title yet)'}`,
			'',
			'## What happened',
			draft?.steps || '(no steps yet)',
			'',
			`## Where`,
			draft?.where || '—',
			'',
			'## This window',
			`Application: ${vscode.env.appName}`,
			`Version: ${vscode.version}`,
			`Platform: ${process.platform} ${process.arch}`,
			`Workspace: ${vscode.workspace.workspaceFolders?.[0]?.uri.fsPath ?? 'none'}`,
			`Logs: ${this.context.logUri.fsPath}`,
			`Modules: ${modules().length}`
		].join('\n');
		await vscode.env.clipboard.writeText(text);
		if (open) {
			await vscode.commands.executeCommand('workbench.action.openIssueReporter');
		}
		await vscode.window.showInformationMessage(
			open
				? 'Temco Workbench: the report is on the clipboard and the issue reporter is open — paste it in. Nothing was sent yet.'
				: 'Temco Workbench: the report is on the clipboard.'
		);
	}

	/** Opens one of this profile's log files. */
	async openLog(name: string | undefined): Promise<void> {
		const entry = (await logFiles(this.context)).find((file) => file.name === name);
		if (!entry) {
			await vscode.window.showInformationMessage('Temco Workbench: that log file is not in this profile’s log folder.');
			return;
		}
		const document = await vscode.workspace.openTextDocument(entry.uri);
		await vscode.window.showTextDocument(document, { preview: true });
	}

	dispose(): void {
		for (const panel of this.panels.values()) {
			panel.dispose();
		}
		this.panels.clear();
	}

	private async open(key: string, viewType: string, title: string, body: string, restored?: vscode.WebviewPanel): Promise<void> {
		const html = page(body, {
			title,
			script: key === 'issue' ? commandScript + ISSUE_SCRIPT : commandScript,
			extraCss: key === 'welcome' ? WELCOME_CSS : undefined
		});
		const existing = this.panels.get(key);
		if (existing) {
			existing.reveal(pageColumn());
			existing.webview.html = html;
			return;
		}

		const column = pageColumn();
		// The tab that is in front now, so the welcome page can be put first without taking the window with it.
		const group = vscode.window.tabGroups.all.find((candidate) => candidate.viewColumn === column);
		const before = group?.activeTab;
		const beforeIndex = before === undefined ? undefined : group?.tabs.indexOf(before);

		const panel = restored ?? vscode.window.createWebviewPanel(viewType, title, { viewColumn: column, preserveFocus: beforeIndex !== undefined }, {
			enableScripts: true,
			localResourceRoots: []
		});
		panel.webview.options = { enableScripts: true, localResourceRoots: [] };
		panel.iconPath = vscode.Uri.joinPath(this.context.extensionUri, 'media', key === 'welcome' ? 'dashboard.svg' : 'help.svg');
		panel.webview.html = html;
		panel.webview.onDidReceiveMessage((message: HelpMessage) => {
			if (message.type !== 'command' || typeof message.command !== 'string') {
				return;
			}
			// `data-args` arrives as one array; a command wants them spread.
			const args = Array.isArray(message.args) ? message.args : message.args === undefined ? [] : [message.args];
			void vscode.commands.executeCommand(message.command, ...args);
		});
		this.panels.set(key, panel);
		panel.onDidDispose(() => this.panels.delete(key));

		if (key === 'welcome') {
			await this.putFirst(beforeIndex);
		}
	}

	/**
	 * The welcome page is the first tab, not the newest one.
	 *
	 * A window starts on it, so it belongs at the left end of the strip where a person looks first — and a reload should
	 * leave them on the page they were reading, not on the page that says hello. It is created last (a webview panel always
	 * appends) and therefore has to be moved, which also means holding its place while the tab that was in front is put
	 * back in front.
	 */
	private async putFirst(previousIndex: number | undefined): Promise<void> {
		await vscode.commands.executeCommand('moveActiveEditor', { to: 'first' }).then(undefined, () => undefined);
		if (previousIndex === undefined) {
			return;
		}
		// The welcome page left the end of the strip for its start, so every other tab moved one place to the right.
		await vscode.commands.executeCommand('workbench.action.openEditorAtIndex', previousIndex + 1).then(undefined, () => undefined);
	}

	/** *Welcome* — the mock's `help/welcome`, with the progress this window can actually attest to. */
	/** *Welcome* — the front page: Fluent 2's numbers, Azure's purchase-options anatomy. */
	/** *Welcome* — what the platform is, in the Azure portal's own page language. */
	private welcomeBody(): string {
		const checked = opensAtStartup() ? ' checked' : '';
		const folder = vscode.workspace.workspaceFolders?.[0];
		const project = this.selection.project();
		const page = this.selection.page();

		const recent = page?.path === undefined
			? ''
			: `${section({ title: t('Pick up where you left off'), desc: t('The page this workspace remembers. It is what the AI answers about when no editor is in front.') })}
${entryRow({
				mark: 'document',
				title: page.title,
				meta: page.path,
				command: 'temcoRepositories.openFile',
				args: [{ path: page.path, id: page.id, title: page.title }],
				go: t('Open')
			})}`;

		return `${hero({
			title: productName(),
			mark: 'dashboard',
			desc: t('One window for the technical documentation of Temco products: the pages, the repositories they are written from, the AI that drafts them, the devices they describe, and the release that ships them. Everything runs on this machine; nothing is uploaded unless you publish it.'),
			descWide: true,
			search: { label: t('Find a page, a file or a command'), command: 'workbench.action.quickOpen', hint: 'Ctrl P' },
			actions: [
				{ label: t('Create a project'), command: 'temcoProjects.newProject', kind: 'primary' },
				{ label: t('Open the documentation'), command: 'temcoDocs.pages.focus' },
				{ label: t('Projects overview'), command: 'temcoDocs.projects' }
			]
		})}
${optionCards([
			{
				mark: 'document',
				title: t('Write the documentation'),
				desc: t('The pages of a product, in areas and folders, edited in Temco Editor.'),
				ticks: [t('Markdown the build reads'), t('Preview and diff beside the editor'), t('Review before anything ships')],
				label: t('Open the pages'),
				command: 'temcoDocs.pages.focus'
			},
			{
				mark: 'repo',
				tag: t('Recommended'),
				title: t('Draft from the code'),
				desc: t('Tick the files of a Temco repository and a draft comes back with its provenance.'),
				ticks: [t('The file, the commit and the budget are recorded'), t('12,000 characters of material, largest first'), t('Nothing is written until you accept')],
				label: t('Read a source'),
				command: 'temcoProjects.addSource',
				pick: true
			},
			{
				mark: 'upload',
				title: t('Publish a release'),
				desc: t('Build every artifact, freeze the version, hand it to a reader.'),
				ticks: [t('HTML, Word, CHM and a Markdown bundle'), t('One folder, ready to hand over'), t('GitHub Pages when there is a remote')],
				label: t('Open Ship'),
				command: 'temcoDocs.releases'
			},
			{
				mark: 'sparkle',
				title: t('Ask the AI'),
				desc: t('A local model answers from the pages you have written, and says which ones.'),
				ticks: [t('Answers cite the page they came from'), t('Runs on this machine'), t('Nothing leaves the window')],
				label: t('Open the AI'),
				command: 'temcoAi.openPanel'
			}
		])}
${section({ title: t('What the platform contains'), desc: t('Nine modules. Only the first four take up a place in the activity bar.'), actions: button(t('All Commands'), 'workbench.action.showCommands', { small: true, kind: 'ghost' }) })}
${cards([
			{ mark: 'book', title: t('Documentation'), desc: t('Pages, areas, the registry, validation, the site build and every export.'), command: 'temcoDocs.pages.focus', go: t('Open') },
			{ mark: 'repo', title: t('Repositories'), desc: t('The Temco code a page is written from: organisations, local copies, reading.'), command: 'temcoProjects.addSource', go: t('Open') },
			{ mark: 'sparkle', title: t('AI'), desc: t('A local model and the drafts it proposes, with the pages it cited.'), command: 'temcoAi.openPanel', go: t('Open') },
			{ mark: 'database', title: t('Tools'), desc: t('SQL: this window’s own database — its tables, its statements, and its upkeep.'), command: 'workbench.view.extension.temcoSql', go: t('Open') },
			{ mark: 'gear', title: t('Settings'), desc: t('Appearance, modules, models, publishing — and Help, which answers the rest.'), command: 'temcoWorkbench.settings', go: t('Open') }
		], { dense: true })}
${notice({
			mark: 'info',
			title: t('Local first'),
			desc: t('The catalog, the pages, the models and every artifact stay on this machine. Publishing to GitHub Pages is the one act that leaves it, and it is never forced.'),
			actions: button(t('Open Settings'), 'temcoWorkbench.settings')
		})}
${recent}
${section({ title: t('Guides'), desc: t('Three walks through the whole of it, each counted from what this window can actually see.') })}
${cards([
			guide(t('Set up a project'), t('A name, the sources it reads, and the devices it can reach.'), 4, folder ? 1 : 0, 'temcoProjects.newProject', 'plus'),
			guide(t('Write and review a page'), t('From a source read to a reviewed page in an area.'), 5, project ? 1 : 0, 'temcoDocs.documents', 'document'),
			guide(t('Publish a version'), t('Build every artifact, then freeze the version for readers.'), 4, undefined, 'temcoDocs.releases', 'upload')
		])}
${section({ title: t('Questions') })}
${questions([
			{ ask: t('What is this application for?'), answer: t('Writing the technical documentation of a Temco product: the pages, the code they are written from, the review before they ship, and the release a customer reads.') },
			{ ask: t('Does it need the internet?'), answer: t('No. The catalog, the pages, the models and the builds are local. A repository read and a GitHub Pages publish are the two things that reach the network, and both are asked for.') },
			{ ask: t('Where do my pages live?'), answer: t('In the folder a source is read from, as Markdown files the registry declares. This window writes them there and nowhere else.') },
			{ ask: t('Which languages can a page be translated into?'), answer: t('Eleven, through an Azure AI Translator resource you configure once. The code, the links and the images in a page are never sent.') }
		])}
${actionBar({
			summary: t('A checkbox, a key and two pages: this is the whole of the window’s own preferences.'),
			actions: `<label class="az-check"><input type="checkbox" data-command="temcoWorkbench.toggleWelcomeStartup"${checked}><span class="az-check__icon">${icon('check')}</span><span class="az-check__main"><span class="az-check__label">${t('Show this page at startup')}</span></span><span class="az-check__tick">${icon('check', 'icon--sm')}</span></label>${button(t('Keyboard Shortcuts'), 'temcoWorkbench.help.keys', { small: true, kind: 'ghost' })}${button(t('Release Notes'), 'temcoDocs.releases', { small: true, kind: 'ghost' })}`
		})}
${floatAction({ label: t('Ask AI'), command: 'temcoAi.openPanel', mark: 'sparkle' })}`;
	}
}

/** True when this window opens the welcome page at startup. */
export function opensAtStartup(): boolean {
	return vscode.workspace.getConfiguration('temcoWorkbench').get<string>(START_OPEN, 'welcome') === 'welcome';
}

/**
 * A guide card.
 *
 * `done` is what this window can attest to — a folder is open, a project is selected — and `undefined` when it can
 * attest to nothing, in which case the card counts the steps and draws no bar. A bar that filled itself from a sample
 * would be the one dishonest thing on a page about learning where to start.
 */
function guide(title: string, note: string, steps: number, done: number | undefined, command: string, mark: string) {
	return {
		mark,
		title,
		desc: note,
		note: done === undefined ? `${steps} steps` : `${done} of ${steps} steps`,
		progress: done === undefined ? undefined : done / steps,
		command,
		go: 'Open'
	};
}

/* ------------------------------------------------------------------ Help */

/** *Help* — the mock's `help/home`. */
function homeBody(): string {
	const folder = vscode.workspace.workspaceFolders?.[0];
	const workspaceName = folder ? folder.name : 'no folder open';
	const workspacePath = folder ? folder.uri.fsPath : '—';

	return `${head({
		studio: productName(),
		title: t('Help'),
		mark: 'info',
		desc: t('What this window is, how to drive it, and what to send when it goes wrong. Everything here works with no network: the same pages are in the offline help file.'),
		actions: [{ label: t('Report an Issue'), command: 'temcoWorkbench.help.issue', mark: 'alert', kind: 'primary' }]
	})}
<div class="mt-16">${entryRow({
		mark: 'search',
		title: t('Search the help, the documentation and the shortcuts'),
		meta: 'Ctrl+K',
		command: 'workbench.action.quickOpen',
		go: t('Search')
	})}</div>
<div class="mt-24">
	${part({ title: t('Start Here'), count: t('4 pages'), note: t('The documentation is a project like any other: its pages are in the Documents tree, and the site they build is Temco Learn.') })}
	${entries([
		entryRow({ mark: 'graduation', title: t('Getting started with T3000'), meta: t('install, connect, and a first point that answers'), command: 'temcoDocs.documents', go: t('Open') }),
		entryRow({ mark: 'key', title: t('Keyboard shortcuts'), meta: t('the keys this window binds, by group'), command: 'temcoWorkbench.help.keys', go: t('Open') }),
		entryRow({ mark: 'output', title: t('Where the logs are'), meta: t('this profile’s log folder, and how to read one'), command: 'temcoWorkbench.help.logs', go: t('Open') }),
		entryRow({ mark: 'upload', title: t('What changed in 13.0'), meta: t('the release notes for the version in this workspace'), command: 'temcoDocs.releases', go: t('Open') })
	].join(''))}
</div>
<div class="mt-24">
	${part({ title: t('This Window'), count: t('3 facts'), note: t('Worth quoting in a bug report — the Report page collects them for you.') })}
	${entries([
		entry({ mark: 'package', title: t('Version'), meta: [vscode.version, vscode.env.appName] }),
		entry({ mark: 'layers', title: t('Profile'), meta: [t('Default'), 'settings.json'] }),
		entry({ mark: 'building', title: t('Workspace'), meta: [workspaceName, workspacePath] })
	].join(''))}
</div>
<div class="mt-16">${notice({
		mark: 'info',
		title: t('Read, not typed in'),
		desc: t('Everything on this page is read from the build you are running — the version, the profile and the workspace are the window’s own facts, not a sample.')
	})}</div>`;
}

/* ------------------------------------------------------------------ Keyboard Shortcuts */

/** *Keyboard Shortcuts* — the mock's `help/keys`, checked against the commands the host really registers. */
function keysBody(registered: string[]): string {
	const known = new Set(registered);
	const total = SHORTCUTS.reduce((sum, group) => sum + group.items.length, 0);
	const reachable = SHORTCUTS.reduce((sum, group) => sum + group.items.filter((item) => item.command !== undefined && known.has(item.command)).length, 0);

	return `${head({
		studio: productName(),
		title: t('Keyboard Shortcuts'),
		mark: 'key',
		desc: t('Every key this window binds. A command without a key can still be run from the command palette, which also lists the ones below.'),
		actions: [{ label: t('Command Palette'), command: 'workbench.action.quickOpen', mark: 'terminal' }]
	})}
${SHORTCUTS.map((group) => `<div class="mt-24">
	${part({ title: group.group, count: n(group.items.length, 'shortcut', 'shortcuts') })}
	${entries(group.items.map((item) => entry({
		mark: 'key',
		title: item.label,
		meta: [item.note],
		aside: `<span class="cell-mono">${kbd(item.keys)}</span>`,
		state: item.command === undefined
			? undefined
			: known.has(item.command) ? t('Registered') : t('Not in this build')
	})).join(''))}
</div>`).join('')}
<div class="mt-16">${notice({
		mark: 'info',
		title: t('A key fires a command'),
		desc: t('A shortcut runs the same command the palette lists, so a key that does not work is a command that is not registered — not a key that is missing.')
	})}</div>
<div class="mt-16">${notice({
		mark: 'check',
		title: t('{0} of {1} reach a command here', String(reachable), String(total)),
		desc: t('The rest are the mock’s, and a row is only marked Registered when the command list the host reports contains it.')
	})}</div>`;
}

/* ------------------------------------------------------------------ Logs */

interface LogEntry {
	name: string;
	uri: vscode.Uri;
	size: number;
	modified: number;
}

/** This profile's log folder, as the file system has it. */
async function logFiles(context: vscode.ExtensionContext): Promise<LogEntry[]> {
	try {
		const entries = await vscode.workspace.fs.readDirectory(context.logUri);
		const files: LogEntry[] = [];
		for (const [name, type] of entries) {
			if (type !== vscode.FileType.File) {
				continue;
			}
			const uri = vscode.Uri.joinPath(context.logUri, name);
			try {
				const stat = await vscode.workspace.fs.stat(uri);
				files.push({ name, uri, size: stat.size, modified: stat.mtime });
			} catch {
				// A file that vanished between the listing and the stat is simply not shown.
			}
		}
		return files.sort((left, right) => right.modified - left.modified);
	} catch {
		return [];
	}
}

function bytes(size: number): string {
	if (size >= 1024 * 1024) {
		return `${(size / (1024 * 1024)).toFixed(1)} MB`;
	}
	if (size >= 1024) {
		return `${Math.round(size / 1024)} KB`;
	}
	return `${size} B`;
}

function ago(at: number): string {
	const minutes = Math.max(0, Math.round((Date.now() - at) / 60000));
	if (minutes < 1) {
		return 'just now';
	}
	if (minutes < 60) {
		return `${minutes} min ago`;
	}
	const hours = Math.round(minutes / 60);
	return hours < 24 ? `${hours} h ago` : `${Math.round(hours / 24)} d ago`;
}

/** The last lines of a log, read from its own bytes. */
async function tailOf(entry: LogEntry | undefined): Promise<string> {
	if (!entry || entry.size === 0 || entry.size > 4 * 1024 * 1024) {
		return '';
	}
	try {
		const data = await vscode.workspace.fs.readFile(entry.uri);
		return Buffer.from(data).toString('utf8').split(/\r?\n/).filter((line) => line.length > 0).slice(-9).join('\n');
	} catch {
		return '';
	}
}

/** *Logs* — the mock's `help/logs`, drawn from this profile's log folder. */
async function logsBodyFor(context: vscode.ExtensionContext): Promise<string> {
	const files = await logFiles(context);
	const largest = [...files].sort((left, right) => right.size - left.size)[0];
	const tail = await tailOf(largest);

	const rows = files.length === 0
		? LOG_FILES.map((file) => entry({
			mark: 'output',
			title: file.name,
			meta: [file.note, file.size, t('written {0}', file.updated)],
			state: file.tone === 'warn' ? t('1 warning') : file.tone === 'neutral' ? t('empty') : t('quiet')
		})).join('')
		: files.map((file) => entry({
			mark: 'output',
			title: file.name,
			meta: [bytes(file.size), t('written {0}', ago(file.modified))],
			state: file.size === 0 ? t('empty') : undefined,
			actions: button(t('Open'), 'temcoWorkbench.help.openLog', { small: true, kind: 'ghost', args: [file.name] })
		})).join('');

	const tailBlock = tail.length === 0
		? `<div class="mt-16">${notice({
			mark: 'info',
			title: files.length === 0 ? t('No log yet') : t('Too large to show'),
			desc: files.length === 0
				? t('This profile has not written a log yet. The folder exists — the first line appears when a process writes one.')
				: t('The largest log is too big to show a tail of here; open it instead.')
		})}</div>`
		: `<div class="mt-16">${code({ language: t('Log'), lines: tail.split('\n').map((text) => ({ text })) })}</div>`;

	return `${head({
		studio: productName(),
		title: t('Logs'),
		mark: 'output',
		desc: t('One file per process, in this profile’s log folder. A log line names the process that wrote it, so a report can be read back without the window in front of you.'),
		actions: [
			{ label: t('Open Log Folder'), command: 'workbench.action.openLogsFolder', mark: 'folder', kind: 'primary' },
			{ label: t('Copy Path'), command: 'temcoWorkbench.copyLogPath', mark: 'code' }
		]
	})}
<div class="mt-24">
	${part({ title: t('Files'), count: n(files.length > 0 ? files.length : LOG_FILES.length, 'file', 'files'), note: files.length > 0 ? context.logUri.fsPath : undefined })}
	${entries(rows)}
</div>
${files.length > 0 ? `<div class="mt-24">
	${part({
		title: largest ? largest.name : t('No file'),
		count: tail.length === 0 ? undefined : t('last 9 lines'),
		actions: button(t('Reveal'), 'workbench.action.openLogsFolder', { small: true, kind: 'ghost' })
	})}
	${tailBlock}
</div>` : tailBlock}
<div class="mt-16">${notice({
		mark: 'info',
		title: t('Logs live in the profile'),
		desc: t('Logs are written to the profile folder, never to the workspace, so a log survives switching workspaces and never lands in a commit.')
	})}</div>`;
}

/* ------------------------------------------------------------------ Report an Issue */

/** The Issue page's script: the draft the person typed travels with the button, so the report is theirs, not a template. */
const ISSUE_SCRIPT = `
(function () {
	const api = acquireVsCodeApi();
	const send = document.getElementById('issue-send');
	if (!send) { return; }
	send.addEventListener('click', function () {
		api.postMessage({
			type: 'command',
			command: 'temcoWorkbench.help.copyReport',
			args: [{
				title: (document.getElementById('issue-title') || {}).value || '',
				steps: (document.getElementById('issue-steps') || {}).value || '',
				where: (document.getElementById('issue-where') || {}).value || ''
			}]
		});
	});
})();
`;

/** *Report an Issue* — the mock's `help/issue`. */
function issueBody(version: string): string {
	const counted = ISSUE_INCLUDES.filter((item) => item.on).length;

	return `${head({
		studio: productName(),
		title: t('Report an Issue'),
		mark: 'alert',
		desc: t('A report that can be reproduced is a report that gets fixed. This page collects the facts you would otherwise be asked for, and leaves out anything private.')
	})}
${formFields([
		{ label: t('Title'), hint: t('What went wrong, in one line.'), control: `<input class="az-input" id="issue-title" placeholder="${t('Publishing 13.0 stops at 62 %')}" aria-label="${t('Issue title')}">` },
		{ label: t('What happened'), hint: t('The steps that led there, and what you expected instead.'), control: `<input class="az-input" id="issue-steps" placeholder="${t('Steps to reproduce')}" aria-label="${t('Steps')}">` },
		{ label: t('Where'), hint: t('The surface you were on when it happened.'), control: `<input class="az-input" id="issue-where" value="${t('Documentation › Build Center')}" aria-label="${t('Where')}">` }
	])}
${actionBar({
		summary: t('Nothing is sent until you submit the report.'),
		actions: `<button type="button" class="az-btn az-btn--primary" id="issue-send">${icon('external')}<span>${t('Open on GitHub')}</span></button>`
	})}
<div class="mt-24">
	${part({ title: t('What Goes With It'), count: `${counted} of ${ISSUE_INCLUDES.length}`, note: t('Nothing here contains page text, a prompt or a password. A log line names the process and the surface, not the content.') })}
	${entries(ISSUE_INCLUDES.map((item) => entry({
		mark: item.on ? 'check' : 'close',
		tone: item.on ? 'ok' : 'info',
		title: item.name,
		meta: [item.detail.replace('1.143.0', version)],
		actions: button(t('Copy'), 'temcoWorkbench.copyDiagnostics', { small: true, kind: 'ghost' })
	})).join(''))}
</div>
<div class="mt-16">${notice({
		mark: 'info',
		title: t('No telemetry'),
		desc: t('The platform sends no telemetry. A report reaches us when you send it, and not before.')
	})}</div>
<div class="mt-16">${notice({
		mark: 'check',
		title: t('Yours to send'),
		desc: t('Open on GitHub puts the report on your clipboard and opens the issue reporter with it — the title, the steps and where you were are yours, and nothing is sent until you submit it.')
	})}</div>`;
}

/* ------------------------------------------------------------------ About */

function modules(): readonly vscode.Extension<unknown>[] {
	return vscode.extensions.all.filter((extension) => extension.packageJSON.publisher === 'temcocontrols');
}

/** *About* — the mock's `help/about`. */
function aboutBody(): string {
	const own = modules();
	const active = own.filter((extension) => extension.isActive).length;
	const reserved = own.length - active;

	return `${head({
		studio: productName(),
		title: t('About'),
		mark: 'info',
		desc: t('{0} {1} — the window, the modules that ship with it, and the versions of what it depends on.', vscode.env.appName, vscode.version),
		actions: [{ label: t('Check for Updates'), command: 'temcoWorkbench.settings.checkUpdates', mark: 'refresh' }]
	})}
<div class="mt-16">${figures([
		{ value: vscode.version, label: t('Version') },
		{ value: `${own.length}`, label: t('Modules') },
		{ value: `${active}`, label: t('Active modules') },
		{ value: `${reserved}`, label: t('Not activated') }
	])}</div>
<div class="mt-24">
	${part({ title: t('Build'), count: t('4 facts') })}
	${entries([
		entry({ mark: 'branch', title: t('Platform'), meta: [`${process.platform} ${process.arch}`] }),
		entry({ mark: 'package', title: t('Remote'), meta: [vscode.env.remoteName ?? t('local — nothing is remote')] }),
		entry({ mark: 'globe', title: t('Language'), meta: [vscode.env.language] }),
		entry({
			mark: 'document',
			title: t('Third-party notices'),
			meta: [t('every dependency and its licence, shipped with the build')],
			actions: button(t('Open'), 'workbench.action.openLicenseUrl', { small: true, kind: 'ghost' })
		})
	].join(''))}
</div>
<div class="mt-24">
	${part({ title: t('Modules'), count: t('{0} installed', String(own.length)), note: t('A module ships with the platform and is never installed or updated on its own.') })}
	${entries(own.map((extension) => {
		const name = String(extension.packageJSON.displayName ?? extension.packageJSON.name ?? extension.id);
		return entry({
			mark: 'package',
			title: name,
			meta: [extension.id, `v${String(extension.packageJSON.version ?? '—')}`],
			state: extension.isActive ? t('Active') : t('Idle')
		});
	}).join(''))}
</div>
<div class="mt-16">${notice({
		mark: 'info',
		title: t('What this page cannot read'),
		desc: t('The shell’s own Electron and Node versions are not readable from inside an extension, so this page reports the platform, the remote and the language instead of guessing them.')
	})}</div>`;
}

/* ------------------------------------------------------------------ wiring */

interface HelpMessage {
	type?: string;
	command?: string;
	args?: unknown;
}
