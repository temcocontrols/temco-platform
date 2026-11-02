// Settings — five pages, one bundle.
//
// The pages are Fluent UI in a webview (`webview/settings/`), drawn in the house page language, so the host's half is narrow:
// read the facts a page needs, hand the webview one state, and answer its three messages. A write is a message; the answer is
// a new state and never a new document, so a colour that moves does not throw away the reader's scroll or focus.
//
// A control writes. Two kinds of row sit on these pages and each is honest about which it is: a row backed by a real editor
// setting writes that setting through the configuration API, so the window obeys it at once; a row this build has no setting
// for keeps its value in `settingsStore.ts` and the page's own band says so. A form whose checkbox springs back would be worse
// than no form, and a form that claimed to have changed the theme when it had not would be worse still.

import { execFile } from 'child_process';
import * as path from 'path';
import * as vscode from 'vscode';
import { ARTIFACTS, MODULES, ModuleRow, ROLES } from './settingsSample';
import {
	ContextWindow, publishedArtifacts, resetKeys, set, setArtifact, SettingsRegister, UpdateChannel, values
} from './settingsStore';
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
	{ id: 'ai', viewType: SETTINGS_AI_VIEW_TYPE, title: 'AI Models' },
	{ id: 'publishing', viewType: SETTINGS_PUBLISHING_VIEW_TYPE, title: 'Publishing' }
];

/* ------------------------------------------------------------------ what each page is told */

/** Every row on the General page, and which of them write an editor setting. The two counts come from here. */
const GENERAL_ROWS = ['theme', 'start', 'breadcrumbs', 'telemetry', 'updateChannel'] as const;
const EDITOR_SETTINGS = new Set(['theme', 'start', 'breadcrumbs', 'telemetry']);

/** The startup views the manifest declares, in the order a person meets them. */
const START_OPTIONS = [
	{ value: 'welcome', label: 'Welcome' },
	{ value: 'project', label: 'The project' },
	{ value: 'page', label: 'The last page' },
	{ value: 'home', label: 'Overview' },
	{ value: 'none', label: 'Nothing' }
];

const configuration = (section: string): vscode.WorkspaceConfiguration => vscode.workspace.getConfiguration(section);

/** Which of the three theme choices the window is on. System means the OS decides, so no theme is pinned. */
function themeChoice(): string {
	if (configuration('window').get<boolean>('autoDetectColorScheme', false)) {
		return 'System';
	}
	const theme = configuration('workbench').get<string>('colorTheme', '');
	return /light/i.test(theme) ? 'Light' : 'Dark';
}

function startChoice(): string {
	return configuration('temcoWorkbench').get<string>('start.open', 'welcome');
}

function breadcrumbsOn(): boolean {
	return configuration('workbench').get<boolean>('breadcrumbs.enabled', false);
}

function telemetryOn(): boolean {
	return configuration('telemetry').get<string>('telemetryLevel', 'all') !== 'off';
}

/** The command that opens the surface a module draws, for the rows that name one. */
const SURFACE_COMMANDS: { [surface: string]: string } = {
	overview: 'temcoWorkbench.overview',
	documents: 'temcoDocs.documents',
	sources: 'temcoProjects.editProject',
	projects: 'temcoDocs.projects',
	chat: 'temcoAi.chat'
};

/**
 * Every module this window really has.
 *
 * The rows come from the extension host, not from a table: a module is present because it is loaded, and its state is
 * whether it has activated yet. What the sample's table adds is only what a manifest cannot say — the sentence naming what
 * the module owns, and the surface it opens.
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
			const surface = known?.surface;
			return {
				id: extension.id,
				name,
				namespace: known?.namespace ?? '',
				owns,
				surface,
				state: extension.isActive ? 'Active' : 'Loaded',
				command: surface === undefined ? undefined : SURFACE_COMMANDS[surface]
			};
		})
		.sort((one, other) => one.name.localeCompare(other.name));

	const present = new Set(rows.map((row) => row.id));
	return { loaded: rows, reserved: MODULES.filter((row) => !present.has(row.id)) };
}

/** The state a page draws, read from the same places its controls write. Only the section for `page` is filled. */
function stateFor(page: SettingsPage): unknown {
	const settings = values();
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
					loaded: rows.loaded.map(clean),
					reserved: rows.reserved.map((row) => clean({ ...row, command: undefined }))
				}
			};
		}
		case 'branding':
			return {
				page,
				branding: {
					productName: settings.productName,
					accent: settings.accent,
					welcomePage: settings.welcomePage,
					roles: ROLES
				}
			};
		case 'ai':
			return {
				page,
				ai: {
					chatModel: settings.chatModel,
					contextWindow: settings.contextWindow,
					requireCitations: settings.requireCitations,
					embeddingModel: settings.embeddingModel,
					drafts: settings.drafts,
					offlineOnly: settings.offlineOnly
				}
			};
		case 'publishing':
			return {
				page,
				publishing: {
					channel: settings.channel,
					probe: settings.publishProbe,
					artifacts: ARTIFACTS.map((artifact) => ({
						name: artifact.name,
						desc: artifact.desc,
						on: settings.artifacts[artifact.name] ?? artifact.on
					}))
				}
			};
		default:
			return {
				page,
				general: {
					theme: themeChoice(),
					start: startChoice(),
					breadcrumbs: breadcrumbsOn(),
					telemetry: telemetryOn(),
					channel: settings.updateChannel,
					lastChanged: settings.lastChanged,
					realSettings: GENERAL_ROWS.filter((row) => EDITOR_SETTINGS.has(row)).length,
					totalSettings: GENERAL_ROWS.length
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

	constructor(private readonly context: vscode.ExtensionContext) {
		context.subscriptions.push(this.output);
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
			void panel.webview.postMessage({ type: 'state', state: stateFor(id) });
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
		await panel.webview.postMessage({ type: 'state', state: stateFor(page) });
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
		await vscode.commands.executeCommand(message.command, ...args);
		return;
	}
	if (message.type === 'setting' && typeof message.key === 'string') {
		await applySetting(message.key, message.value, message.name);
		pages.refresh();
	}
}

/**
 * One row, written.
 *
 * A key that names an editor setting writes it through the configuration API; a key that names a register field writes the
 * register. The two are not interchangeable, and each page's band says which rows are which.
 */
async function applySetting(key: string, value: unknown, name?: string): Promise<void> {
	switch (key) {
		case 'theme': {
			const choice = String(value);
			if (choice === 'System') {
				await configuration('window').update('autoDetectColorScheme', true, vscode.ConfigurationTarget.Global);
				break;
			}
			await configuration('window').update('autoDetectColorScheme', false, vscode.ConfigurationTarget.Global);
			await configuration('workbench').update(
				'colorTheme',
				choice === 'Light' ? 'Default Light Modern' : 'Default Dark Modern',
				vscode.ConfigurationTarget.Global
			);
			break;
		}
		case 'start':
			if (START_OPTIONS.some((option) => option.value === value)) {
				await configuration('temcoWorkbench').update('start.open', String(value), vscode.ConfigurationTarget.Global);
			}
			break;
		case 'breadcrumbs':
			await configuration('workbench').update('breadcrumbs.enabled', Boolean(value), vscode.ConfigurationTarget.Global);
			break;
		case 'telemetry':
			await configuration('telemetry').update('telemetryLevel', value ? 'all' : 'off', vscode.ConfigurationTarget.Global);
			break;
		case 'updateChannel':
			set('updateChannel', (value === 'Preview' ? 'Preview' : 'Stable') as UpdateChannel);
			break;
		case 'productName':
			if (String(value).trim().length > 0) {
				set('productName', String(value).trim());
			}
			break;
		case 'accent':
			if (/^#[0-9a-fA-F]{6}$/.test(String(value).trim())) {
				set('accent', String(value).trim());
			}
			break;
		case 'welcomePage':
			set('welcomePage', String(value));
			break;
		case 'chatModel':
			set('chatModel', String(value));
			break;
		case 'contextWindow':
			set('contextWindow', (['8k', '16k', '32k'].includes(String(value)) ? String(value) : '32k') as ContextWindow);
			break;
		case 'requireCitations':
			set('requireCitations', Boolean(value));
			break;
		case 'embeddingModel':
			set('embeddingModel', String(value));
			break;
		case 'drafts':
			set('drafts', String(value));
			break;
		case 'offlineOnly':
			set('offlineOnly', Boolean(value));
			break;
		case 'publishChannel':
			set('channel', (value === 'Preview' ? 'Preview' : 'Stable') as UpdateChannel);
			break;
		case 'artifact':
			if (typeof name === 'string') {
				setArtifact(name, Boolean(value));
			}
			break;
		default:
			break;
	}
}

/* ------------------------------------------------------------------ registration */

/**
 * Registers the five pages and everything their buttons run.
 *
 * The resets and the one-off actions are here rather than in the pages, because each of them has to write both halves of the
 * register — the editor's settings and this profile's own — and only the module can do that.
 */
export function registerSettings(context: vscode.ExtensionContext): { pages: SettingsPages; disposables: vscode.Disposable[] } {
	const pages = new SettingsPages(context);
	const changed = (): void => pages.refresh();

	const disposables: vscode.Disposable[] = [
		// ---- General
		vscode.commands.registerCommand('temcoWorkbench.settings.reset', async () => {
			// The working folder is not this page's row: it is Repositories', and a reset here leaves it alone.
			resetKeys(['updateChannel']);
			await configuration('window').update('autoDetectColorScheme', false, vscode.ConfigurationTarget.Global);
			await configuration('workbench').update('colorTheme', 'Default Dark Modern', vscode.ConfigurationTarget.Global);
			await configuration('workbench').update('breadcrumbs.enabled', undefined, vscode.ConfigurationTarget.Global);
			await configuration('telemetry').update('telemetryLevel', undefined, vscode.ConfigurationTarget.Global);
			await configuration('temcoWorkbench').update('start.open', undefined, vscode.ConfigurationTarget.Global);
			changed();
			await vscode.window.showInformationMessage(
				'Temco Workbench: these rows are back to their defaults — both the editor’s own settings and this profile’s register.'
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
			try {
				await vscode.commands.executeCommand('update.check');
			} catch {
				await vscode.window.showInformationMessage(
					`Temco Workbench: this build does not update itself — it is ${vscode.version}, and a module changes only when the build does.`
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
			resetKeys(['productName', 'accent', 'welcomePage']);
			changed();
			await vscode.window.showInformationMessage('Temco Workbench: the identity is back to what the build ships.');
		}),

		// ---- Publishing
		vscode.commands.registerCommand('temcoWorkbench.settings.testPublish', async () => {
			const settings = values();
			set('publishProbe', `checked just now · ${settings.site}${settings.path}`);
			changed();
			await vscode.window.showInformationMessage('Temco Workbench: the target reads back as configured.', {
				detail: [
					`Site ${settings.site}`,
					`Path ${settings.path}`,
					`Channel ${settings.channel} · ${String(publishedArtifacts())} of ${String(ARTIFACTS.length)} artifacts`,
					'No request was sent: this build has no network client.'
				].join('\n')
			});
		})
	];

	return { pages, disposables };
}

/** The register, for the rest of the module: the startup path and the strip both read it. */
export function settingsValues(): SettingsRegister {
	return values();
}
