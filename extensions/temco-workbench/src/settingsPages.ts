// Settings — five pages, one bundle.
//
// The pages are Fluent UI in a webview (`webview/settings/`), drawn in the house page language, so the host's half is narrow:
// read the facts a page needs, hand the webview one state, and answer its three messages. A write is a message; the answer is
// a new state and never a new document, so a colour that moves does not throw away the reader's scroll or focus.
//
// A control writes. Every row on these pages is a real setting, declared in this module's manifest, so a write lands in
// settings.json and every surface of the window — not only the page — reads the same value. A row no longer has a private
// register behind it: a form whose checkbox springs back after a reload would be a form that kept nothing, and a value a
// person cannot find in settings.json is a value they cannot back up, copy to another profile, or override per workspace.

import { execFile } from 'child_process';
import * as path from 'path';
import * as vscode from 'vscode';
import { ARTIFACTS, MODULES, ModuleRow, THEMES } from './settingsSample';
import { pageColumn } from './ui';

export const SETTINGS_GENERAL_VIEW_TYPE = 'temcoWorkbench.settings.general';
export const SETTINGS_MODULES_VIEW_TYPE = 'temcoWorkbench.settings.modules';
export const SETTINGS_BRANDING_VIEW_TYPE = 'temcoWorkbench.settings.branding';
export const SETTINGS_AI_VIEW_TYPE = 'temcoWorkbench.settings.ai';
export const SETTINGS_PUBLISHING_VIEW_TYPE = 'temcoWorkbench.settings.publishing';

/** The five pages the one bundle draws. The id is also the key the page's state arrives under. */
type SettingsPage = 'general' | 'modules' | 'branding' | 'ai' | 'publishing';

/** The bundle's name, under `out/webview/settings/`. `scripts/build-webview.mts` writes these two files. */
const BUNDLE_FOLDER = ['out', 'webview', 'settings'];
const BUNDLE = 'settings';

/** The pages, in the order the side bar lists them. */
const PAGES: { id: SettingsPage; viewType: string; title: string }[] = [
	{ id: 'general', viewType: SETTINGS_GENERAL_VIEW_TYPE, title: 'General' },
	{ id: 'modules', viewType: SETTINGS_MODULES_VIEW_TYPE, title: 'Modules' },
	{ id: 'branding', viewType: SETTINGS_BRANDING_VIEW_TYPE, title: 'Branding' },
	{ id: 'ai', viewType: SETTINGS_AI_VIEW_TYPE, title: 'AI Runtime' },
	{ id: 'publishing', viewType: SETTINGS_PUBLISHING_VIEW_TYPE, title: 'Publishing' }
];

/* ------------------------------------------------------------------ what each page is told */

/** The side panel the window opens with, and the panel it opens with when nothing has been chosen. */
const START_PANEL = 'start.panel';
const DEFAULT_PANEL = 'temcoDashboard';

/** The one choice a Settings page shows: what the stored value is, and what a person reads. */
interface Choice {
	value: string;
	label: string;
}

const configuration = (section: string): vscode.WorkspaceConfiguration => vscode.workspace.getConfiguration(section);

/** The theme the window is drawing with. `colorTheme` holds the theme's settings id. */
function currentTheme(): string {
	return configuration('workbench').get<string>('colorTheme', THEMES[0].value);
}

/**
 * The themes the Theme row offers.
 *
 * The list is the build's own themes; the value the window is on is appended when it is not among them, so a theme
 * installed from the gallery or chosen in the built-in Settings editor is shown rather than silently replaced by the
 * first entry.
 */
function themeOptions(): Choice[] {
	const current = currentTheme();
	return THEMES.some((theme) => theme.value === current) ? [...THEMES] : [...THEMES, { value: current, label: current }];
}

/**
 * The left panel's items, in the order the activity bar draws them.
 *
 * The containers are read from the manifests rather than listed here: the workbench's manifest declares the application's
 * own containers, all of them and in the order it intends, so it is read first and anything another module contributes
 * follows. A container whose title the manifest localizes (`%…%`) is named by its id, because a raw placeholder is worse
 * than a slug.
 */
function activityPanels(): Choice[] {
	const found: Choice[] = [];
	const seen = new Set<string>();
	const collect = (extension: vscode.Extension<unknown>): void => {
		const manifest = extension.packageJSON as {
			contributes?: { viewsContainers?: { activitybar?: { id?: unknown; title?: unknown }[] } };
		};
		for (const container of manifest.contributes?.viewsContainers?.activitybar ?? []) {
			if (typeof container.id !== 'string' || seen.has(container.id)) {
				continue;
			}
			seen.add(container.id);
			const title = typeof container.title === 'string' && !container.title.startsWith('%') ? container.title : container.id;
			found.push({ value: container.id, label: title });
		}
	};
	const ours = vscode.extensions.all.filter((extension) => extension.packageJSON.publisher === 'temcocontrols');
	const workbench = ours.filter((extension) => extension.id === 'temcocontrols.temco-workbench');
	workbench.forEach(collect);
	ours
		.filter((extension) => extension.id !== 'temcocontrols.temco-workbench')
		.sort((one, other) => one.id.localeCompare(other.id))
		.forEach(collect);
	return found;
}

function startPanel(): string {
	return configuration('temcoWorkbench').get<string>(START_PANEL, DEFAULT_PANEL);
}

/** The Startup view row's items, with the stored id kept visible when this build no longer declares it. */
function panelOptions(): Choice[] {
	const options = activityPanels();
	const current = startPanel();
	return options.some((option) => option.value === current) ? options : [...options, { value: current, label: current }];
}

function breadcrumbsOn(): boolean {
	return configuration('workbench').get<boolean>('breadcrumbs.enabled', true);
}

function telemetryOn(): boolean {
	return configuration('telemetry').get<string>('telemetryLevel', 'all') !== 'off';
}

function updateChannel(): 'Stable' | 'Preview' {
	return configuration('temcoWorkbench').get<string>('updateChannel', 'Stable') === 'Preview' ? 'Preview' : 'Stable';
}

/**
 * When a person last changed a row.
 *
 * It is kept in the profile's own state rather than in settings.json: it is a record of what happened, not a preference,
 * and a file that a person reads should hold only the values they meant to choose.
 */
function lastChanged(context: vscode.ExtensionContext): string {
	const stamp = context.globalState.get<string>('lastChanged');
	if (stamp === undefined) {
		return 'not yet';
	}
	const when = new Date(stamp);
	if (Number.isNaN(when.getTime())) {
		return stamp;
	}
	const minutes = Math.floor((Date.now() - when.getTime()) / 60000);
	if (minutes < 1) {
		return 'just now';
	}
	if (minutes < 60) {
		return `${String(minutes)} minute${minutes === 1 ? '' : 's'} ago`;
	}
	const hours = Math.floor(minutes / 60);
	if (hours < 24) {
		return `${String(hours)} hour${hours === 1 ? '' : 's'} ago`;
	}
	return when.toLocaleString();
}

/** Records that a row changed, so the General page's own note is about this session and not a sample. */
function markChanged(context: vscode.ExtensionContext): void {
	void context.globalState.update('lastChanged', new Date().toISOString());
}

/** How many of the artifacts are switched on. */
function publishedArtifacts(): number {
	return ARTIFACTS.filter((artifact) => configuration('temcoWorkbench').get<boolean>(`publishing.${artifact.key}`, artifact.on)).length;
}

/** The workbench colours the accent drives: focus, primary buttons, badges, links and progress. */
const ACCENT_COLOURS = [
	'activityBar.activeBorder',
	'activityBarBadge.background',
	'badge.background',
	'button.background',
	'button.hoverBackground',
	'focusBorder',
	'panelTitle.activeBorder',
	'progressBar.background',
	'textLink.foreground'
];

/** What this module last wrote into those keys, so a colour a person set is never cleared as if it were ours. */
const ACCENT_LEDGER = 'branding.accentApplied';

/** The accent the profile stores, when it still spells a six-digit colour. */
function storedAccent(): string | undefined {
	const value = configuration('temcoWorkbench').inspect<string>('branding.accent')?.globalValue;
	return typeof value === 'string' && /^#[0-9a-fA-F]{6}$/.test(value) ? value : undefined;
}

/**
 * Writes the accent into the window's own colour customizations, or takes it back out.
 *
 * A branding page whose accent changes nothing is a page of opinions, so the value is applied where the workbench reads
 * it. Taking it out goes through the ledger rather than through the whole block: a colour this module did not write
 * belongs to whoever did, and a reset here is not a reset of someone's theme.
 */
async function applyAccent(context: vscode.ExtensionContext, colour: string | undefined): Promise<void> {
	const workbench = configuration('workbench');
	const current = workbench.get<Record<string, unknown>>('colorCustomizations', {});
	const ledger = context.globalState.get<Record<string, string>>(ACCENT_LEDGER, {});
	const next: Record<string, unknown> = { ...current };
	const wrote: Record<string, string> = {};
	for (const key of ACCENT_COLOURS) {
		if (ledger[key] !== undefined && next[key] === ledger[key]) {
			delete next[key];
		}
		if (colour !== undefined) {
			next[key] = colour;
			wrote[key] = colour;
		}
	}
	if (JSON.stringify(current) !== JSON.stringify(next)) {
		await workbench.update('colorCustomizations', Object.keys(next).length > 0 ? next : undefined, vscode.ConfigurationTarget.Global);
	}
	await context.globalState.update(ACCENT_LEDGER, wrote);
}

/**
 * The page each module opens, by module id.
 *
 * A module's *own* surface: the Repositories module opens its Repositories page, the Projects module its project page, and
 * the AI module its panel. A module with no entry has no page of its own yet — the library modules, Temco UI and Temco
 * Store — so its row carries no link rather than a button that would open someone else's page.
 */
const MODULE_PAGES: { [id: string]: string } = {
	'temcocontrols.temco-workbench': 'temcoWorkbench.overview',
	'temcocontrols.temco-docs': 'temcoDocs.documents',
	'temcocontrols.temco-repositories': 'temcoRepositories.page',
	'temcocontrols.temco-projects': 'temcoProjects.editProject',
	'temcocontrols.temco-ai': 'temcoAi.openPanel',
	'temcocontrols.temco-learn': 'temcoLearn.overview'
};

/**
 * Every module this window really has.
 *
 * The rows come from the extension host, not from a table: a module is present because it is loaded, and its state is
 * whether it has activated yet. What the sample's table adds is only what a manifest cannot say — the sentence naming what
 * the module owns — and `MODULE_PAGES` adds the one page it opens.
 */
function moduleRows(): { loaded: ModuleRow[]; reserved: ModuleRow[] } {
	const described = new Map(MODULES.map((row) => [row.id, row]));
	const loaded = vscode.extensions.all.filter((extension) => extension.packageJSON.publisher === 'temcocontrols');
	const rows: (ModuleRow & { command?: string })[] = loaded
		.map((extension) => {
			const known = described.get(extension.id);
			const manifest = extension.packageJSON as { description?: unknown; displayName?: unknown };
			const name =
				known?.name ?? (typeof manifest.displayName === 'string' ? manifest.displayName : extension.id.replace('temcocontrols.', ''));
			const owns =
				known?.owns ??
				(typeof manifest.description === 'string' ? manifest.description : 'its manifest says nothing about what it owns');
			return {
				id: extension.id,
				name,
				namespace: known?.namespace ?? '',
				owns,
				state: extension.isActive ? 'Active' : 'Loaded',
				command: MODULE_PAGES[extension.id]
			};
		})
		.sort((one, other) => one.name.localeCompare(other.name));

	const present = new Set(rows.map((row) => row.id));
	return { loaded: rows, reserved: MODULES.filter((row) => !present.has(row.id)) };
}

/** The state a page draws, read from the same places its controls write. Only the section for `page` is filled. */
function stateFor(context: vscode.ExtensionContext, page: SettingsPage): unknown {
	switch (page) {
		case 'modules': {
			const rows = moduleRows();
			const clean = (row: ModuleRow & { command?: string }): unknown => ({
				id: row.id,
				name: row.name,
				namespace: row.namespace,
				owns: row.owns,
				state: row.state,
				open: row.command
			});
			return {
				page,
				modules: {
					version: vscode.version,
					channel: updateChannel(),
					loaded: rows.loaded.map(clean),
					reserved: rows.reserved.map((row) => clean({ ...row, command: undefined }))
				}
			};
		}
		case 'branding':
			return {
				page,
				branding: {
					productName: configuration('temcoWorkbench').get<string>('branding.productName', 'Temco Platform'),
					accent: configuration('temcoWorkbench').get<string>('branding.accent', '#0078d4')
				}
			};
		case 'ai':
			return {
				page,
				ai: {
					model: configuration('temcoAi').get<string>('model', ''),
					runtime: configuration('temcoAi').get<string>('runtime', ''),
					folder: configuration('temcoAi').get<string>('modelFolder', ''),
					allowUnpinned: configuration('temcoAi').get<boolean>('allowUnpinned', false),
					idleMinutes: configuration('temcoAi').get<number>('idleMinutes', 10),
					serverPort: configuration('temcoAi').get<number>('serverPort', 0),
					serverIdleMinutes: configuration('temcoAi').get<number>('serverIdleMinutes', 0),
					platformApi: configuration('temcoAi').get<string>('platformApi', '').trim().length > 0
				}
			};
		case 'publishing':
			return {
				page,
				publishing: {
					channel: configuration('temcoWorkbench').get<string>('publishing.channel', 'Stable') === 'Preview' ? 'Preview' : 'Stable',
					probe: context.globalState.get<string>('publishing.probe', 'not checked yet'),
					artifacts: ARTIFACTS.map((artifact) => ({
						name: artifact.name,
						desc: artifact.desc,
						on: configuration('temcoWorkbench').get<boolean>(`publishing.${artifact.key}`, artifact.on)
					}))
				}
			};
		default:
			return {
				page,
				general: {
					theme: currentTheme(),
					themes: themeOptions(),
					start: startPanel(),
					startOptions: panelOptions(),
					breadcrumbs: breadcrumbsOn(),
					telemetry: telemetryOn(),
					channel: updateChannel(),
					lastChanged: lastChanged(context)
				}
			};
	}
}

/* ------------------------------------------------------------------ the bundle on disk */

async function exists(uri: vscode.Uri): Promise<boolean> {
	try {
		await vscode.workspace.fs.stat(uri);
		return true;
	} catch {
		return false;
	}
}

/**
 * The folder the bundle lives in, built first if a source tree has not built it.
 *
 * `out/` is wiped by every `compile-extension`, so a bundle that only the build writes would be a page that opens blank
 * after a compile. `build-webviews` and `vscode:prepublish` both build it; this is the third belt, for a window that was
 * started from a tree compiled with neither.
 */
async function bundleFolder(context: vscode.ExtensionContext, output: vscode.OutputChannel): Promise<vscode.Uri> {
	const folder = vscode.Uri.joinPath(context.extensionUri, ...BUNDLE_FOLDER);
	if (await exists(vscode.Uri.joinPath(folder, `${BUNDLE}.js`))) {
		return folder;
	}
	output.appendLine('[settings] the pages were not built; building them now');
	await new Promise<void>((resolve) => {
		execFile(
			process.execPath,
			['--experimental-strip-types', path.join('scripts', 'build-webview.mts')],
			{ cwd: context.extensionUri.fsPath, windowsHide: true },
			(error, stdout, stderr) => {
				if (stdout.trim() !== '') {
					output.appendLine(stdout.trim());
				}
				if (stderr.trim() !== '') {
					output.appendLine(stderr.trim());
				}
				if (error) {
					output.appendLine(`[settings] ${error.message}`);
				}
				resolve();
			}
		);
	});
	return folder;
}

/** The webview's own document: one empty root, the bundle, and a content-security policy that allows nothing else. */
function bundleDocument(webview: vscode.Webview, folder: vscode.Uri, title: string): string {
	const script = webview.asWebviewUri(vscode.Uri.joinPath(folder, `${BUNDLE}.js`));
	const style = webview.asWebviewUri(vscode.Uri.joinPath(folder, `${BUNDLE}.css`));
	const nonce = Array.from({ length: 16 }, () => Math.floor(Math.random() * 36).toString(36)).join('');
	return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta http-equiv="Content-Security-Policy" content="default-src 'none'; img-src ${webview.cspSource} data:; font-src ${webview.cspSource}; style-src ${webview.cspSource} 'unsafe-inline'; script-src 'nonce-${nonce}' ${webview.cspSource};">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<link rel="stylesheet" href="${style.toString()}">
<title>${title}</title>
</head>
<body>
<div id="root"></div>
<script nonce="${nonce}" src="${script.toString()}"></script>
</body>
</html>`;
}

/* ------------------------------------------------------------------ the pages */

/** The five settings surfaces, one panel each, all drawn by the one bundle. */
export class SettingsPages {
	private readonly panels = new Map<SettingsPage, vscode.WebviewPanel>();
	/** What building the bundle said, when a source tree had none: a silent failure here is a blank page. */
	readonly output = vscode.window.createOutputChannel('Temco Settings');

	constructor(readonly context: vscode.ExtensionContext) {
		context.subscriptions.push(
			this.output,
			// A row written elsewhere — the built-in Settings editor, the welcome page's own checkbox, a policy — is this
			// page's fact too, so every open page is redrawn rather than left showing what it was told once.
			vscode.workspace.onDidChangeConfiguration((event) => {
				// The accent is applied by the listener rather than by the row that wrote it, so a value typed into
				// settings.json by hand lands in the window's colours exactly like one chosen on the page.
				if (event.affectsConfiguration('temcoWorkbench.branding.accent')) {
					void applyAccent(context, storedAccent());
				}
				if (
					event.affectsConfiguration('temcoWorkbench') ||
					event.affectsConfiguration('temcoAi') ||
					event.affectsConfiguration('workbench.breadcrumbs') ||
					event.affectsConfiguration('workbench.colorTheme') ||
					event.affectsConfiguration('window.autoDetectColorScheme') ||
					event.affectsConfiguration('telemetry')
				) {
					this.refresh();
				}
			})
		);
		// A stale window: the profile may carry an accent written in an earlier session that the customizations lost.
		void applyAccent(context, storedAccent());
	}

	general(restored?: vscode.WebviewPanel): void {
		void this.open('general', restored);
	}

	modules(restored?: vscode.WebviewPanel): void {
		void this.open('modules', restored);
	}

	branding(restored?: vscode.WebviewPanel): void {
		void this.open('branding', restored);
	}

	ai(restored?: vscode.WebviewPanel): void {
		void this.open('ai', restored);
	}

	publishing(restored?: vscode.WebviewPanel): void {
		void this.open('publishing', restored);
	}

	/** Re-draws every page that is open: one page's write is another page's fact, and a message is enough to say so. */
	refresh(): void {
		for (const [id, panel] of this.panels) {
			void panel.webview.postMessage({ type: 'state', state: stateFor(this.context, id) });
		}
	}

	dispose(): void {
		for (const panel of this.panels.values()) {
			panel.dispose();
		}
		this.panels.clear();
		this.output.dispose();
	}

	/** The state the panel draws, by message: a refresh here never rewrites the document. */
	async postState(page: SettingsPage, panel: vscode.WebviewPanel): Promise<void> {
		await panel.webview.postMessage({ type: 'state', state: stateFor(this.context, page) });
	}

	private async open(page: SettingsPage, restored?: vscode.WebviewPanel): Promise<void> {
		const definition = PAGES.find((entry) => entry.id === page);
		if (definition === undefined) {
			return;
		}
		const existing = this.panels.get(page);
		if (existing !== undefined) {
			existing.reveal(pageColumn());
			await this.postState(page, existing);
			return;
		}
		const folder = await bundleFolder(this.context, this.output);
		// A restored tab is drawn into rather than replaced: it keeps its place in the strip.
		const panel = restored ?? vscode.window.createWebviewPanel(definition.viewType, definition.title, pageColumn(), {
			enableScripts: true,
			retainContextWhenHidden: true,
			localResourceRoots: [folder]
		});
		panel.webview.options = { enableScripts: true, localResourceRoots: [folder] };
		panel.iconPath = vscode.Uri.joinPath(this.context.extensionUri, 'media', 'settings.svg');
		panel.webview.html = bundleDocument(panel.webview, folder, definition.title);
		panel.webview.onDidReceiveMessage((message: SettingsMessage) => void receive(this, page, panel, message));
		this.panels.set(page, panel);
		panel.onDidDispose(() => this.panels.delete(page));
	}
}

/* ------------------------------------------------------------------ what a control writes */

interface SettingsMessage {
	type?: string;
	key?: string;
	value?: unknown;
	name?: string;
	command?: string;
	args?: unknown;
}

/** One message from a bundled page: it asks for its state, writes a setting, chooses a folder, or runs a command. */
async function receive(
	pages: SettingsPages,
	page: SettingsPage,
	panel: vscode.WebviewPanel,
	message: SettingsMessage
): Promise<void> {
	if (message.type === 'ready') {
		await pages.postState(page, panel);
		return;
	}
	if (message.type === 'command' && typeof message.command === 'string') {
		const args = Array.isArray(message.args) ? message.args : message.args === undefined ? [] : [message.args];
		try {
			await vscode.commands.executeCommand(message.command, ...args);
		} catch (error) {
			// A button that names a command this build does not have used to do nothing at all, which reads as a broken
			// page. It says so instead; a command that rejects for its own reason still speaks for itself.
			const text = error instanceof Error ? error.message : String(error);
			if (/not found/i.test(text)) {
				void vscode.window.showErrorMessage(`Temco Workbench: ${message.command} is not part of this build.`);
			}
		}
		return;
	}
	if (message.type === 'setting' && typeof message.key === 'string') {
		await applySetting(pages.context, message.key, message.value, message.name);
		pages.refresh();
	}
}

/**
 * One row, written.
 *
 * Every key here names a declared setting, and every write goes to the user's own `settings.json`: the window obeys it at
 * once where the setting is read live, and the value is still there after a restart. None of them is written to a
 * workspace, because a preference about the window itself is not a property of a folder.
 */
async function applySetting(
	context: vscode.ExtensionContext,
	key: string,
	value: unknown,
	name?: string
): Promise<void> {
	switch (key) {
		case 'theme': {
			const theme = String(value);
			if (!THEMES.some((candidate) => candidate.value === theme)) {
				return;
			}
			// A theme picked here is the one the window draws with; leaving the OS in charge would overrule it on the next
			// change of system appearance, which is not what choosing a theme says.
			await configuration('window').update('autoDetectColorScheme', false, vscode.ConfigurationTarget.Global);
			await configuration('workbench').update('colorTheme', theme, vscode.ConfigurationTarget.Global);
			markChanged(context);
			return;
		}
		case 'start': {
			const panel = String(value);
			if (!activityPanels().some((candidate) => candidate.value === panel)) {
				return;
			}
			await configuration('temcoWorkbench').update(START_PANEL, panel, vscode.ConfigurationTarget.Global);
			markChanged(context);
			return;
		}
		case 'breadcrumbs':
			await configuration('workbench').update('breadcrumbs.enabled', Boolean(value), vscode.ConfigurationTarget.Global);
			markChanged(context);
			return;
		case 'telemetry':
			// The level the telemetry service reads. Usage and error telemetry follow it at once; crash reporting is the
			// one part that needs the application restarted, which is what the setting's own description says.
			await configuration('telemetry').update('telemetryLevel', value ? 'all' : 'off', vscode.ConfigurationTarget.Global);
			markChanged(context);
			return;
		case 'updateChannel':
			await configuration('temcoWorkbench').update('updateChannel', value === 'Preview' ? 'Preview' : 'Stable', vscode.ConfigurationTarget.Global);
			markChanged(context);
			return;
		case 'productName':
			if (String(value).trim().length > 0) {
				await configuration('temcoWorkbench').update('branding.productName', String(value).trim(), vscode.ConfigurationTarget.Global);
				markChanged(context);
			}
			return;
		case 'accent':
			if (/^#[0-9a-fA-F]{6}$/.test(String(value).trim())) {
				await configuration('temcoWorkbench').update('branding.accent', String(value).trim(), vscode.ConfigurationTarget.Global);
				markChanged(context);
			}
			return;
		case 'chatModel':
		case 'contextWindow':
		case 'requireCitations':
		case 'embeddingModel':
		case 'drafts':
		case 'offlineOnly':
			// These six rows were a copy of a choice only the AI module can make, so they are gone: the page now writes
			// `temcoAi.*` itself, and this keeps a stale bundle from writing a setting that no longer exists.
			return;
		case 'aiAllowUnpinned':
			await configuration('temcoAi').update('allowUnpinned', Boolean(value), vscode.ConfigurationTarget.Global);
			markChanged(context);
			return;
		case 'aiIdleMinutes': {
			const minutes = Math.round(Number(value));
			if (Number.isFinite(minutes) && minutes >= 0) {
				await configuration('temcoAi').update('idleMinutes', minutes, vscode.ConfigurationTarget.Global);
				markChanged(context);
			}
			return;
		}
		case 'aiServerPort': {
			const port = Math.round(Number(value));
			if (Number.isInteger(port) && port >= 0 && port <= 65535) {
				await configuration('temcoAi').update('serverPort', port, vscode.ConfigurationTarget.Global);
				markChanged(context);
			}
			return;
		}
		case 'aiServerIdleMinutes': {
			const minutes = Math.round(Number(value));
			if (Number.isFinite(minutes) && minutes >= 0) {
				await configuration('temcoAi').update('serverIdleMinutes', minutes, vscode.ConfigurationTarget.Global);
				markChanged(context);
			}
			return;
		}
		case 'publishChannel':
			await configuration('temcoWorkbench').update('publishing.channel', value === 'Preview' ? 'Preview' : 'Stable', vscode.ConfigurationTarget.Global);
			markChanged(context);
			return;
		case 'artifact': {
			const artifact = ARTIFACTS.find((candidate) => candidate.name === name);
			if (artifact !== undefined) {
				await configuration('temcoWorkbench').update(`publishing.${artifact.key}`, Boolean(value), vscode.ConfigurationTarget.Global);
				markChanged(context);
			}
			return;
		}
		default:
			return;
	}
}

/* ------------------------------------------------------------------ registration */

/**
 * Registers the five pages and everything their buttons run.
 *
 * The resets and the one-off actions are here rather than in the pages, because a reset has to write several settings at
 * once and only the module can do that.
 */
export function registerSettings(context: vscode.ExtensionContext): { pages: SettingsPages; disposables: vscode.Disposable[] } {
	const pages = new SettingsPages(context);
	const changed = (): void => pages.refresh();

	const disposables: vscode.Disposable[] = [
		// ---- General
		vscode.commands.registerCommand('temcoWorkbench.settings.reset', async () => {
			// Only this page's rows, and `undefined` rather than a copied value: a default belongs to the manifest, so a
			// reset that wrote its own copy would freeze today's default into the file.
			await configuration('window').update('autoDetectColorScheme', undefined, vscode.ConfigurationTarget.Global);
			await configuration('workbench').update('colorTheme', undefined, vscode.ConfigurationTarget.Global);
			await configuration('workbench').update('breadcrumbs.enabled', undefined, vscode.ConfigurationTarget.Global);
			await configuration('telemetry').update('telemetryLevel', undefined, vscode.ConfigurationTarget.Global);
			await configuration('temcoWorkbench').update(START_PANEL, undefined, vscode.ConfigurationTarget.Global);
			await configuration('temcoWorkbench').update('updateChannel', undefined, vscode.ConfigurationTarget.Global);
			markChanged(pages.context);
			changed();
			await vscode.window.showInformationMessage(
				'Temco Workbench: the General rows are back to their defaults, and settings.json no longer carries a value for any of them.'
			);
		}),

		// ---- Modules
		vscode.commands.registerCommand('temcoWorkbench.settings.showOnDisk', async () => {
			try {
				await vscode.commands.executeCommand('workbench.extensions.action.openExtensionsFolder');
			} catch {
				// A web build has no folder to open, and saying "opened" there would be a lie.
				await vscode.window.showInformationMessage(
					'Temco Workbench: this window has no folder to open. The modules live in the build’s extensions/ directory.'
				);
			}
		}),

		vscode.commands.registerCommand('temcoWorkbench.settings.checkUpdates', async () => {
			const channel = updateChannel();
			try {
				await vscode.commands.executeCommand('update.check');
			} catch {
				await vscode.window.showInformationMessage(
					`Temco Workbench: this build does not update itself — it is ${vscode.version}, on the ${channel.toLowerCase()} channel, and a module changes only when the build does.`
				);
			}
		}),

		// ---- Branding
		vscode.commands.registerCommand('temcoWorkbench.settings.replaceIcon', async () => {
			await vscode.window.showInformationMessage(
				'Temco Workbench: the application mark is compiled into the build and is drawn before any extension runs. A profile cannot replace it, and this page will not pretend to have tried.'
			);
		}),

		vscode.commands.registerCommand('temcoWorkbench.settings.resetBranding', async () => {
			for (const key of ['branding.productName', 'branding.accent']) {
				await configuration('temcoWorkbench').update(key, undefined, vscode.ConfigurationTarget.Global);
			}
			await applyAccent(pages.context, undefined);
			markChanged(pages.context);
			changed();
			await vscode.window.showInformationMessage('Temco Workbench: the identity is back to what the build ships.');
		}),

		// ---- Publishing
		vscode.commands.registerCommand('temcoWorkbench.settings.testPublish', async () => {
			const site = configuration('temcoWorkbench').get<string>('publishing.site', 'https://learn.temcocontrols.com');
			const at = configuration('temcoWorkbench').get<string>('publishing.path', '/t3000/{version}/');
			const channel = configuration('temcoWorkbench').get<string>('publishing.channel', 'Stable');
			await pages.context.globalState.update('publishing.probe', `checked just now · ${site}${at}`);
			changed();
			await vscode.window.showInformationMessage('Temco Workbench: the target reads back as configured.', {
				detail: [
					`Site ${site}`,
					`Path ${at}`,
					`Channel ${channel} · ${String(publishedArtifacts())} of ${String(ARTIFACTS.length)} artifacts`,
					'No request was sent: this build has no network client.'
				].join('\n')
			});
		})
	];

	return { pages, disposables };
}
