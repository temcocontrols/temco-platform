// What this module reads of the UI conventions.
//
// The rules are owned by `temco-ui` and read here rather than re-decided: where a page of ours opens (one editor group,
// never a split), what a page looks like (`media/page.css`), the glyphs a page may draw, and how a page runs a command
// (a message, never a link). The definition is `extensions/temco-ui/src/`; this is the part of it used here.

import * as vscode from 'vscode';

/** The UI module, by the id its manifest declares. */
const UI_EXTENSION_ID = 'temcocontrols.temco-ui';

/** One message a page sends back to its module. */
export interface PageMessage {
	type?: string;
	command?: string;
	args?: unknown;
}

/** The part of the UI module's exports this module draws with. */
interface UiApi {
	pageColumn(): vscode.ViewColumn;
	page(body: string, options?: { title?: string; script?: string; extraCss?: string }): string;
	escapeHtml(text: string): string;
	icon(name: string, cls?: string): string;
	toneMark(name: string, tone?: 'ok' | 'warn' | 'err' | 'info' | 'accent'): string;
	hero(options: HeroOptions): string;
	optionCards(items: readonly OptionCard[]): string;
	callout(options: CalloutOptions): string;
	section(options: SectionOptions): string;
	entryRow(options: EntryRowOptions): string;
	cards(items: readonly FeatureCard[], options?: { dense?: boolean }): string;
	code(options: CodeOptions): string;
	/** Records the subject a page is being opened on, so a restored tab opens on the same one. */
	remember(context: vscode.ExtensionContext, viewType: string, arg?: string): void;
	/** One serializer per page, so the window can bring a page's tab back after a restart. */
	restore(context: vscode.ExtensionContext, pages: readonly RestorablePage[]): vscode.Disposable[];
	/** One serializer per page for a module that makes its own panel: the tab returns, its old position may not. */
	restoreByReopen(context: vscode.ExtensionContext, pages: readonly { viewType: string; open(arg?: string): void }[]): vscode.Disposable[];
	commandScript: string;
	runCommand(message: PageMessage): void;
}

/** The title block's arguments: what the page says first, and the ways in. */
interface HeroOptions {
	crumbs?: string;
	eyebrow?: string;
	title: string;
	mark?: string;
	desc?: string;
	descWide?: boolean;
	actions?: readonly { label: string; command: string; args?: unknown; mark?: string; kind?: 'primary' | 'link' }[];
	/** The figures the page opens on. */
	stats?: readonly { value: string; label: string }[];
	/** One line of context that belongs to the header, drawn under the description. */
	note?: { text: string; mark?: string; mono?: boolean; link?: { command: string; args?: unknown } };
}

/** One of three options side by side, each ending in the button that starts it. */
interface OptionCard {
	title: string;
	desc: string;
	/** The small brand label above the title — the step's number, here. */
	tag?: string;
	mark?: string;
	ticks: readonly string[];
	label: string;
	command: string;
	args?: unknown;
	pick?: boolean;
}

/** The one tinted callout a page is allowed. */
interface CalloutOptions {
	title: string;
	desc: string;
	mark?: string;
	/** Pre-rendered buttons. */
	actions?: string;
}

interface FeatureCard {
	title: string;
	desc: string;
	mark?: string;
	command?: string;
	args?: unknown;
	go?: string;
	note?: string;
}

interface CodeOptions {
	language: string;
	lines: readonly { text: string }[];
}

interface SectionOptions {
	title: string;
	desc?: string;
	/** Pre-rendered buttons or links, drawn at the right-hand end of the heading. */
	actions?: string;
}

/** One thing a page already knows about, lying on its side with the way in at its right-hand end. */
interface EntryRowOptions {
	title: string;
	meta?: string;
	mark?: string;
	command?: string;
	args?: unknown;
	go?: string;
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

/** Text that came from a folder or a person, escaped for a page. */
export const escapeHtml = ui.escapeHtml;

/** One glyph from the page's sprite. */
export const icon = ui.icon;

/** One glyph in a tinted circle: a state you can see before you read it. */
export const toneMark = ui.toneMark;

/** The title block at the top of a page: the wash, the page's only h1, one line of why, and the ways in. */
export const hero = ui.hero;

/** Three options side by side — the shape a flow of three steps takes on a page. */
export const optionCards = ui.optionCards;

/** The one tinted callout a page is allowed. */
export const callout = ui.callout;

/** A section heading, with the page's parts told apart by it. */
export const section = ui.section;

/** One thing a page already knows about, lying on its side with the way in at its right-hand end. */
export const entryRow = ui.entryRow;

/** A row of cards that are ways in: a step of a flow, or a kind of thing a page offers. */
export const cards = ui.cards;

/** A card of numbered lines: what was run, and what it said. */
export const code = ui.code;

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

/** One serializer per page for a module that makes its own panel: the tab returns, its old position may not. */
export const restoreByReopen = ui.restoreByReopen;
