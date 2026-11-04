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
	page(body: string, options?: { title?: string; script?: string; extraCss?: string; resources?: string; initialWork?: unknown }): string;
	icon(name: string, cls?: string): string;
	hero(options: HeroOptions): string;
	section(options: { title: string; desc?: string; actions?: string }): string;
	callout(options: { title: string; desc: string; mark?: string; actions?: string }): string;
	/** One part of a page: its title, the count and sentence under it, and what can be done from here. */
	part(options: { title: string; note?: string; count?: string; actions?: string }): string;
	/** The list a part's rows lie in. */
	entries(rows: string): string;
	/** One row: the glyph, the thing, the facts about it, its state, and what can be done to it. */
	entry(options: EntryOptions): string;
	/** One row that is a way in: the whole row is the control. */
	entryRow(options: { mark?: string; title: string; meta?: string; command?: string; args?: unknown; go?: string }): string;
	/** A button, rendered the one way this application renders them. */
	button(label: string, command: string, options?: ButtonOptions): string;
	/** The one tinted paragraph a page is allowed, and the thing to do about it. */
	notice(options: { title: string; desc: string; mark?: string; actions?: string }): string;
	/** The count with its noun, as the pages write it: "1 clone", "4 clones". */
	n(count: number, one: string, many: string): string;
	/** Text that came from a folder or a person, escaped for a page. */
	escapeHtml(text: string): string;
	/** One glyph in a tinted circle: a state you can see before you read it. */
	toneMark(name: string, tone?: Tone): string;
	/** The script a page runs so its `data-command` buttons reach this module. */
	commandScript: string;
	/** Runs the message those buttons send. */
	runCommand(message: PageMessage): void;
	/** Records the subject a page is being opened on, so a restored tab opens on the same one. */
	remember(context: vscode.ExtensionContext, viewType: string, arg?: string): void;
	/** One serializer per page: the module draws into the panel the window restored, so the tab keeps its place. */
	restore(context: vscode.ExtensionContext, pages: readonly RestorablePage[]): vscode.Disposable[];
}

/** The five states a row's glyph can carry. */
type Tone = 'ok' | 'warn' | 'err' | 'info' | 'accent';

/** One message a page sends back to its module. */
interface PageMessage {
	type?: string;
	command?: string;
	args?: unknown;
}

/** The title block's arguments: what it says, and the ways in it offers. */
interface HeroOptions {
	/** A line above the title: the area the page belongs to. */
	eyebrow?: string;
	title: string;
	/** A glyph before the title, drawn in a brand-tinted chip. */
	mark?: string;
	desc?: string;
	/** The description takes the full width instead of a reading measure. */
	descWide?: boolean;
	actions?: readonly { label: string; command: string; args?: unknown; mark?: string; kind?: 'primary' | 'link' }[];
	/** The figures the page opens on, drawn in the band's own row beside the ways in. */
	stats?: readonly { value: string; label: string }[];
	/** One line of context that belongs to the header. */
	note?: { text: string; mark?: string; mono?: boolean; link?: { command: string; args?: unknown } };
}

/** One row of a page. */
interface EntryOptions {
	mark?: string;
	/** Raw markup for the mark, instead of a sprite glyph — a file icon theme's own icon. */
	markHtml?: string;
	tone?: Tone;
	title: string;
	/** Words beside the title: a state that belongs to the name rather than to the end of the row. */
	status?: string;
	meta?: readonly (string | undefined)[];
	state?: string;
	actions?: string;
	aside?: string;
}

/** The kinds a button comes in: `link` is a word rather than a box. */
interface ButtonOptions {
	kind?: 'primary' | 'ghost' | 'link';
	mark?: string;
	args?: unknown;
	small?: boolean;
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

/** One part of a page: its title, the count and sentence under it, and what can be done from here. */
export const part = ui.part;

/** The list a part's rows lie in. */
export const entries = ui.entries;

/** One row: the glyph, the thing, the facts about it, its state, and what can be done to it. */
export const entry = ui.entry;

/** One row that is a way in: the whole row is the control. */
export const entryRow = ui.entryRow;

/** A button, rendered the one way this application renders them. */
export const button = ui.button;

/** The one tinted paragraph a page is allowed, and the thing to do about it. */
export const notice = ui.notice;

/** The count with its noun, as the pages write it. */
export const n = ui.n;

/** Text that came from a folder or a person, escaped for a page. */
export const escapeHtml = ui.escapeHtml;

/** One glyph in a tinted circle: a state you can see before you read it. */
export const toneMark = ui.toneMark;

/** The script a page runs so its `data-command` buttons reach this module. */
export const commandScript = ui.commandScript;

/** Runs the message those buttons send. */
export const runCommand = ui.runCommand;

/** One serializer per page: the module draws into the panel the window restored, so the tab keeps its place. */
export const restore = ui.restore;


/** Records the subject a page is being opened on, so a restored tab opens on the same one. */
export const remember = ui.remember;
