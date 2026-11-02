// What this module reads of the UI conventions.
//
// Where a page opens, and what that page is made of — the application's page vocabulary — are decided once in
// `temco-ui` and read here. The definition is `extensions/temco-ui/src/`; this is the copy.

import * as vscode from 'vscode';

/** The UI module, by the id its manifest declares. */
const UI_EXTENSION_ID = 'temcocontrols.temco-ui';

/** One message a page sends back to its module. */
export interface PageMessage {
	type?: string;
	command?: string;
	args?: unknown;
}

/** One way in the title block offers. */
export interface HeroAction {
	label: string;
	command: string;
	args?: unknown;
	mark?: string;
	kind?: 'primary' | 'link';
}

/** The title block's arguments: what it says, and the ways in it offers. */
export interface HeroOptions {
	crumbs?: string;
	eyebrow?: string;
	title: string;
	mark?: string;
	desc?: string;
	/** The description takes the full width instead of a 78-character reading measure. */
	descWide?: boolean;
	actions?: readonly HeroAction[];
}

/** A section heading, and the line under it. */
export interface SectionOptions {
	title: string;
	desc?: string;
	/** Module-built HTML for the right-hand end of the heading. */
	actions?: string;
}

/** The UI module's exports. */
interface UiApi {	pageColumn(): vscode.ViewColumn;
	page(body: string, options?: { title?: string; script?: string; extraCss?: string }): string;
	escapeHtml(text: string): string;
	icon(name: string, cls?: string): string;
	/** The title block: wash, the page's only h1, the line of why, and the ways in. */
	hero(options: HeroOptions): string;
	/** A section heading, which is what the page's parts are told apart by. */
	section(options: SectionOptions): string;
	/** The one tinted callout a page is allowed. */
	callout(options: { title: string; desc: string; mark?: string; actions?: string }): string;
	/** Records the subject a page is being opened on, so a restored tab opens on the same one. */
	remember(context: vscode.ExtensionContext, viewType: string, arg?: string): void;
	/** One serializer per page, so the window can bring a page's tab back after a restart. */
	restore(context: vscode.ExtensionContext, pages: readonly RestorablePage[]): vscode.Disposable[];
	/** One serializer per page for a module that makes its own panel: the tab returns, its old position may not. */
	restoreByReopen(context: vscode.ExtensionContext, pages: readonly { viewType: string; open(arg?: string): void }[]): vscode.Disposable[];
	commandScript: string;
	runCommand(message: PageMessage): void;
}

/** One page of this module, as the window needs it back. */
export interface RestorablePage {
	/** The view type the panel was created with. */
	viewType: string;
	/** Opens the page, drawing into the panel the window handed back. */
	open(panel?: vscode.WebviewPanel, arg?: string): void;
}

const extension = vscode.extensions.getExtension<UiApi>(UI_EXTENSION_ID);
if (extension === undefined || !extension.isActive) {
	throw new Error('The Temco UI module is not available.');
}

const ui = extension.exports;

/** The editor column every page of ours opens in. */
export const pageColumn = ui.pageColumn;

/** A document around `body`, carrying the application's page vocabulary. */
export const page = ui.page;

/** Text that came from a page or a person, escaped for a page. */
export const escapeHtml = ui.escapeHtml;

/** One glyph from the page's sprite. */
export const icon = ui.icon;

/** The title block at the top of a page. */
export const hero = ui.hero;

/** A section heading, with the page's parts told apart by it. */
export const section = ui.section;

/** The one tinted callout a page is allowed: an icon, a sentence, and the thing to do about it. */
export const callout = ui.callout;

/** Records the subject a page is being opened on, so a restored tab opens on the same one. */
export const remember = ui.remember;

/** One serializer per page, so the window can bring a page's tab back after a restart. */
export const restore = ui.restore;

/** The script that turns a `data-command` button into a message to the module. */
export const commandScript = ui.commandScript;

/** What the module does with that message: run the command it names. */
export const runCommand = ui.runCommand;

/** One serializer per page for a module that makes its own panel: the tab returns, its old position may not. */
export const restoreByReopen = ui.restoreByReopen;
