// What this module reads of the UI conventions.
//
// Where a page of ours opens is one rule for the whole application — the group that already holds a page of ours,
// never a split — and it is the UI module's. The definition is `extensions/temco-ui/src/`; this is the copy.

import * as vscode from 'vscode';

/** The UI module, by the id its manifest declares. */
const UI_EXTENSION_ID = 'temcocontrols.temco-ui';

/** The UI module's exports. */
interface UiApi {
	pageColumn(): vscode.ViewColumn;
	rowSlug(target: unknown): string | undefined;
	page(body: string, options?: { title?: string; script?: string; extraCss?: string }): string;
	escapeHtml(text: string): string;
	icon(name: string, cls?: string): string;
	toneMark(name: string, tone?: 'ok' | 'warn' | 'err' | 'info' | 'accent'): string;
	/** The script a page runs to post `data-command` clicks back to the module that opened it. */
	/** Records the subject a page is being opened on, so a restored tab opens on the same one. */
	remember(context: vscode.ExtensionContext, viewType: string, arg?: string): void;
	/** One serializer per page, so the window can bring a page's tab back after a restart. */
	restore(context: vscode.ExtensionContext, pages: readonly RestorablePage[]): vscode.Disposable[];
	commandScript: string;
	/** Runs one of those messages: `{ command, args }`. */
	runCommand(message: { command?: unknown; args?: unknown }): void;
	/** The title block: breadcrumb, the page's only h1, its mark, and one line of why. */
	hero(options: {
		crumbs?: string;
		eyebrow?: string;
		title: string;
		mark?: string;
		desc?: string;
		descWide?: boolean;
		search?: { label: string; command: string; hint?: string };
		actions?: readonly { label: string; command: string; args?: unknown; mark?: string; kind?: 'primary' | 'link' }[];
		hero?: boolean;
		/** The band is drawn as an inset card instead of running edge to edge. */
		panel?: boolean;
		/** The figures the page opens on, drawn on the panel's own floor. */
		stats?: readonly { value: string; label: string }[];
	}): string;
	/** A section heading: the h2 a page's parts are told apart by. */
	section(options: { title: string; desc?: string; actions?: string }): string;
	/** The row of figures under a title. */
	numbers(items: readonly { value: string; label: string }[]): string;
	/** The one tinted callout a page is allowed. */
	callout(options: { title: string; desc: string; mark?: string; actions?: string }): string;
	/** Mutually exclusive starting points, drawn as cards. */
	choiceCards(options: {
		items: readonly { value: string; title: string; desc: string; mark?: string; tag?: string }[];
		selected?: string;
		attribute?: string;
	}): string;
	/** A form's fields: two columns, a label above each control, the hint under it. */
	formFields(fields: readonly { label: string; control: string; hint?: string; wide?: boolean }[]): string;
	/** What a build or a project includes, as cards that carry their own tick. */
	checkCards(options: {
		field: string;
		items: readonly { value: string; label: string; note: string; mark?: string }[];
		ticked?: readonly string[];
	}): string;
	/** The foot of a form: a summary line and its buttons. */
	actionBar(options: { summary?: string; summaryId?: string; actions: string }): string;
}

const extension = vscode.extensions.getExtension<UiApi>(UI_EXTENSION_ID);
if (extension === undefined || !extension.isActive) {
	throw new Error('The Temco UI module is not available.');
}

const ui = extension.exports;

/** The editor column every page of ours opens in. */
export const pageColumn = ui.pageColumn;

/** The slug a command argument names, whether it is a slug, a row, or a row's own command argument. */
export const rowSlug = ui.rowSlug;

/** A document around `body`, carrying the application's page vocabulary. */
export const page = ui.page;

/** Text that came from a folder or a person, escaped for a page. */
export const escapeHtml = ui.escapeHtml;

/** One glyph from the page's sprite. */
export const icon = ui.icon;



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
/** One glyph in a tinted circle: a state you can see before you read it. */
export const toneMark = ui.toneMark;

/** The script a page runs to post `data-command` clicks back to this module. */
export const commandScript = ui.commandScript;

/** Runs one of those messages — what a page's `onDidReceiveMessage` is. */
export const runCommand = ui.runCommand;

/** The title block at the top of a page. */
export const hero = ui.hero;

/** A section heading. */
export const section = ui.section;

/** The row of figures under a title. */
export const numbers = ui.numbers;

/** The one tinted callout a page is allowed. */
export const callout = ui.callout;

/** Mutually exclusive starting points, drawn as cards. */
export const choiceCards = ui.choiceCards;

/** A form's fields, two columns with a label and a hint. */
export const formFields = ui.formFields;

/** What a build or a project includes, as cards that carry their own tick. */
export const checkCards = ui.checkCards;

/** The foot of a form: a summary line and its buttons. */
export const actionBar = ui.actionBar;

/**
 * Shows the list of projects.
 *
 * It used to be the workbench's *Library* view, which is gone: the Documentation module's *Projects* section is
 * where projects are listed now, so anything that used to "open the projects page" brings that forward rather
 * than leaving an empty editor behind.
 */
export async function focusLibrary(): Promise<void> {
	const available = await vscode.commands.getCommands(true);
	await vscode.commands.executeCommand(
		available.includes('temcoProjects.projects.focus') ? 'temcoProjects.projects.focus' : 'workbench.view.explorer'
	);
}

