// What this module reads of the UI conventions, and nothing else.
//
// The page vocabulary belongs to `temco-ui`: this module asks for the document shell, the escaping and the
// click-to-command script, and draws its pages with the classes that shell ships. The definition is
// `extensions/temco-ui/src/`; this is the copy.

import * as vscode from 'vscode';

/** The UI module, by the id its manifest declares. */
const UI_EXTENSION_ID = 'temcocontrols.temco-ui';

/** One message a page sends back to its module. */
export interface PageMessage {
	type?: string;
	command?: string;
	args?: unknown;
	/** The statement a page's editor holds, when it sends one back. */
	sql?: string;
	/** Whether the person allowed a writing statement. */
	write?: boolean;
}

/** The UI module's exports. */
interface UiApi {
	pageColumn(): vscode.ViewColumn;
	page(body: string, options?: { title?: string; script?: string; extraCss?: string }): string;
	escapeHtml(text: string): string;
	icon(name: string, cls?: string): string;
	toneMark(name: string, tone?: 'ok' | 'warn' | 'err' | 'info' | 'accent'): string;
	hero(options: {
		crumbs?: string;
		eyebrow?: string;
		title: string;
		mark?: string;
		desc?: string;
		descWide?: boolean;
		actions?: readonly { label: string; command: string; args?: unknown; mark?: string; kind?: 'primary' | 'link' }[];
		stats?: readonly { value: string; label: string }[];
		note?: { text: string; mark?: string; mono?: boolean; link?: { command: string; args?: unknown } };
	}): string;
	section(options: { title: string; desc?: string; actions?: string }): string;
	numbers(items: readonly { value: string; label: string }[]): string;
	entryRow(options: { title: string; meta?: string; mark?: string; command?: string; args?: unknown; go?: string }): string;
	callout(options: { title: string; desc: string; mark?: string; actions?: string }): string;
	/** Records the subject a page is being opened on, so a restored tab opens on the same one. */
	remember(context: vscode.ExtensionContext, viewType: string, arg?: string): void;
	/** One serializer per page, so the window can bring a page's tab back after a restart. */
	restore(context: vscode.ExtensionContext, pages: readonly RestorablePage[]): vscode.Disposable[];
	commandScript: string;
	runCommand(message: PageMessage): void;
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

/** Text that came from anywhere but this module, escaped for a page. */
export const escapeHtml = ui.escapeHtml;

/** The same function, under the name the page builders use at every interpolation. */
export const esc = ui.escapeHtml;

/** One glyph from the page's sprite. */


/** One page of this module, as the window needs it back. */
export interface RestorablePage {
	/** The view type the panel was created with. */
	viewType: string;
	/** Opens the page, drawing into the panel the window handed back. */
	open(panel?: vscode.WebviewPanel, arg?: string): void;
}

/** Records the subject a page is being opened on, so a restored tab opens on the same one. */
export const remember = ui.remember;

/** One serializer per page, so the window can bring a page's tab back after a restart. */
export const restore = ui.restore;
export const icon = ui.icon;

/** One glyph in a tinted circle: a state you can see before you read it. */
export const toneMark = ui.toneMark;

/** The title block at the top of a page: the wash, the page's only h1, one line of why, and the ways in. */
export const hero = ui.hero;

/** A section heading: the page's parts, told apart by the brand rule before the title. */
export const section = ui.section;

/** The row of figures: what a page is about, in numbers, in one box. */
export const numbers = ui.numbers;

/** One entry lying on its side: the mark, the thing itself, and the way back into it at the right-hand end. */
export const entryRow = ui.entryRow;

/** The one tinted callout a page is allowed: an icon, a sentence, and the thing to do about it. */
export const callout = ui.callout;

/** The script a page runs so its `data-command` buttons reach this module. */
export const commandScript = ui.commandScript;

/** Runs the message a page's buttons send. */
export const runCommand = ui.runCommand;

