// What this module reads of the UI conventions.
//
// The rules are owned by `temco-ui` and read here rather than re-decided: where a page of ours opens (one group,
// never a split), what a command argument means (a slug, a row, or a row's own command argument), what a page looks
// like (`media/page.css`), the components a page is built from, and how a page runs a command (a message, never a
// link). The definition is `extensions/temco-ui/src/`; this is the copy.

import * as vscode from 'vscode';

/** The UI module, by the id its manifest declares. */
const UI_EXTENSION_ID = 'temcocontrols.temco-ui';

/** One message a page sends back to its module. */
export interface PageMessage {
	type?: string;
	command?: string;
	args?: unknown;
}

/** One card that is a way into the application. */
interface FeatureCard {
	title: string;
	desc: string;
	mark?: string;
	command?: string;
	args?: unknown;
	go?: string;
}

/** One of the three options the front page offers side by side. */
interface OptionCard {
	title: string;
	desc: string;
	tag?: string;
	mark?: string;
	ticks: readonly string[];
	label: string;
	command: string;
	args?: unknown;
	pick?: boolean;
}

/** The title block's arguments: what it says, and the ways in it offers. */
interface HeroOptions {
	crumbs?: string;
	eyebrow?: string;
	title: string;
	/** A glyph before the title, drawn in a brand-tinted chip. */
	mark?: string;
	desc?: string;
	/** The description takes the full width instead of a 78-character reading measure. */
	descWide?: boolean;
	search?: { label: string; command: string; hint?: string };
	actions?: readonly { label: string; command: string; args?: unknown; mark?: string; kind?: 'primary' | 'link' }[];
	hero?: boolean;
	/** The band is drawn as an inset card instead of running edge to edge. */
	panel?: boolean;
	/** The figures the page opens on, drawn on the panel's own floor. */
	stats?: readonly { value: string; label: string }[];
	/** One line of context that belongs to the header, drawn as an information strip under the description. */
	note?: { text: string; mark?: string; mono?: boolean; link?: { command: string; args?: unknown } };
}
/** The UI module's exports. */
interface UiApi {
	pageColumn(): vscode.ViewColumn;
	fileColumn(): vscode.ViewColumn;
	rowSlug(target: unknown): string | undefined;
	page(body: string, options?: { title?: string; script?: string; extraCss?: string }): string;
	escapeHtml(text: string): string;
	icon(name: string, cls?: string): string;
	toneMark(name: string, tone?: 'ok' | 'warn' | 'err' | 'info' | 'accent'): string;
	/** The title block: wash, breadcrumb, the page's only h1, the field and the ways in. */
	hero(options: HeroOptions): string;
	/** The row of figures under a title. */
	numbers(items: readonly { value: string; label: string }[]): string;
	/** Three options side by side, each ending in a button. */
	optionCards(items: readonly OptionCard[]): string;
	/** The one tinted callout a page is allowed. */
	callout(options: { title: string; desc: string; mark?: string; actions?: string }): string;
	/** The questions at the bottom of a page. */
	questions(items: readonly { ask: string; answer: string }[]): string;
	/** A section heading. */
	section(options: { title: string; desc?: string; actions?: string }): string;
	/** A row of cards that are ways in. */
	cards(items: readonly FeatureCard[], options?: { dense?: boolean }): string;
	/** The foot of a form: a summary line and its buttons. */
	actionBar(options: { summary?: string; summaryId?: string; actions: string }): string;
	/** One entry lying on its side: the mark, the thing itself, and the way in at its right-hand end. */
	entryRow(options: { title: string; meta?: string; mark?: string; command?: string; args?: unknown; go?: string }): string;
	/** A code card, with drawn line numbers and four tones of syntax. */
	code(options: { language: string; lines: readonly { text: string; tokens?: readonly [number, number, 'keyword' | 'string' | 'name' | 'comment'][] }[] }): string;
	/** The floating action in the corner of the page. */
	floatAction(options: { label: string; command: string; mark?: string }): string;
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

/** The column for something that is not a page of ours — a documentation page, a registry. */
export const fileColumn = ui.fileColumn;

/** The slug a command argument names, whether it is a slug, a row, or a row's own command argument. */
export const rowSlug = ui.rowSlug;

/** A document around `body`, carrying the application's page vocabulary. */
export const page = ui.page;

/** Text that came from a folder or a person, escaped for a page. */
export const escapeHtml = ui.escapeHtml;

/** One glyph from the page's sprite. */
export const icon = ui.icon;

/** One glyph in a tinted circle: a state you can see before you read it. */
export const toneMark = ui.toneMark;

/** The title block at the top of a page. */
export const hero = ui.hero;

/** The row of figures under a title. */
export const numbers = ui.numbers;

/** Three options side by side. */
export const optionCards = ui.optionCards;

/** The one tinted callout a page is allowed. */
export const callout = ui.callout;

/** The questions at the bottom of a page. */
export const questions = ui.questions;

/** A section heading, with the page's parts told apart by it. */
export const section = ui.section;

/** A row of cards that are ways in. */
export const cards = ui.cards;

/** The foot of a form: a summary line and its buttons. */
export const actionBar = ui.actionBar;

/** One entry lying on its side: the mark, the thing itself, and the way in at its right-hand end. */
export const entryRow = ui.entryRow;

/** A code card. */
export const code = ui.code;

/** The floating action in the corner of the page. */
export const floatAction = ui.floatAction;
/** The script a page runs so its `data-command` buttons reach this module. */
export const commandScript = ui.commandScript;

/** Runs the message those buttons send. */
export const runCommand = ui.runCommand;

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

