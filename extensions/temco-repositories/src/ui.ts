// What this module reads of the platform's UI conventions.
//
// Two rules, each owned once for the whole application, and neither of them this module's to decide:
//
//   * **where a page opens** — the group that already holds a page of ours, never a second column.
//   * **what a command argument means** — a slug, a row, or a row's own command argument, read the same way by
//     every module whose rows pass slugs to commands.
//
// The definition is `extensions/temco-ui/src/`, and this is the copy.

import * as vscode from 'vscode';

/** The UI module, by the id its manifest declares. */
const UI_EXTENSION_ID = 'temcocontrols.temco-ui';

/** The UI module's exports. */
interface UiApi {
	pageColumn(): vscode.ViewColumn;
	fileColumn(): vscode.ViewColumn;
	rowSlug(target: unknown): string | undefined;
	page(body: string, options?: { title?: string; script?: string; extraCss?: string }): string;
	icon(name: string, cls?: string): string;
	hero(options: { title: string; mark?: string; desc?: string; descWide?: boolean; actions?: readonly unknown[] }): string;
	section(options: { title: string; desc?: string; actions?: string }): string;
	callout(options: { title: string; desc: string; mark?: string; actions?: string }): string;
	/** Records the subject a page is being opened on, so a restored tab opens on the same one. */
	remember(context: vscode.ExtensionContext, viewType: string, arg?: string): void;
	/** One serializer per page: the module draws into the panel the window restored, so the tab keeps its place. */
	restore(context: vscode.ExtensionContext, pages: readonly RestorablePage[]): vscode.Disposable[];
}

/** One page of a module, as the window needs it back. */
export interface RestorablePage {
	/** The view type the panel was created with — the id the window restores by. */
	viewType: string;
	/** Opens the page, drawing into `panel` when the window handed one back. */
	open(panel?: vscode.WebviewPanel, arg?: string): void;
}

const extension = vscode.extensions.getExtension<UiApi>(UI_EXTENSION_ID);
if (extension === undefined || !extension.isActive) {
	throw new Error('The Temco UI module is not available.');
}

const ui = extension.exports;

/** The editor column every page of ours opens in. */
export const pageColumn = ui.pageColumn;

/** The editor column for something that is not a page of ours — a page of documentation, a registry. */
export const fileColumn = ui.fileColumn;

/** The slug a command argument names, whether it is a slug, a row, or a row's own command argument. */
export const rowSlug = ui.rowSlug;

/** A document around `body`, carrying the application's page vocabulary. */
export const page = ui.page;

/** One glyph from the page's own sprite. */
export const icon = ui.icon;

/** The title block at the top of a page: the wash, the page's only h1, one line of why, and the ways in. */
export const hero = ui.hero;

/** A section heading: the page's parts, told apart by the brand rule before the title. */
export const section = ui.section;

/** The one tinted callout a page is allowed. */
export const callout = ui.callout;

/** One serializer per page: the module draws into the panel the window restored, so the tab keeps its place. */
export const restore = ui.restore;


/** Records the subject a page is being opened on, so a restored tab opens on the same one. */
export const remember = ui.remember;
