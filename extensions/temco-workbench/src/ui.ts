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
	/** A counted fact under the description, e.g. `2 of 5 steps`. */
	note?: string;
	/** How far the thing described has got, 0–1. */
	progress?: number;
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
	/** One line of context that belongs to the header, drawn as an information strip under the description. */
	note?: { text: string; mark?: string; mono?: boolean; link?: { command: string; args?: unknown } };
}
/** The UI module's exports. */
interface UiApi {
	/** True when a view type — as a tab reports it, or as it was created — is a page of ours. */
	isOurViewType(viewType: string): boolean;
	pageColumn(): vscode.ViewColumn;
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
	head(options: {
		studio: string;
		title: string;
		mark: string;
		desc: string;
		actions?: readonly { label: string; command: string; args?: unknown; mark?: string; kind?: 'primary' | 'link' }[];
		stats?: readonly { value: string; label: string }[];
		note?: { text: string; mark?: string; mono?: boolean };
	}): string;
	part(options: { title: string; note?: string; count?: string; actions?: string }): string;
	entries(rows: string): string;
	entry(options: {
		mark?: string;
		tone?: 'ok' | 'warn' | 'err' | 'info' | 'accent';
		title: string;
		meta?: readonly (string | undefined)[];
		state?: string;
		actions?: string;
		aside?: string;
	}): string;
	figures(items: readonly { value: string; label: string }[]): string;
	notice(options: { title: string; desc: string; mark?: string; actions?: string }): string;
	button(label: string, command: string, options?: { kind?: 'primary' | 'ghost' | 'link'; mark?: string; args?: unknown; small?: boolean }): string;
	n(count: number, one: string, many: string): string;
	/** The questions at the bottom of a page. */
	questions(items: readonly { ask: string; answer: string }[]): string;
	/** A section heading. */
	section(options: { title: string; desc?: string; actions?: string }): string;
	/** A row of cards that are ways in. */
	cards(items: readonly FeatureCard[], options?: { dense?: boolean }): string;
	/** One entry lying on its side: the mark, the thing itself, and the way in at its right-hand end. */
	entryRow(options: { title: string; meta?: string; mark?: string; command?: string; args?: unknown; go?: string }): string;
	/** A code card, with drawn line numbers and four tones of syntax. */
	code(options: { language: string; lines: readonly { text: string; tokens?: readonly [number, number, 'keyword' | 'string' | 'name' | 'comment'][] }[] }): string;
	/** The floating action in the corner of the page. */
	floatAction(options: { label: string; command: string; mark?: string }): string;
	/** A form's fields: two columns, a label above each control, the hint under it. */
	formFields(fields: readonly { label: string; control: string; hint?: string; wide?: boolean }[]): string;
	/** The foot of a form: what will happen, and the buttons that make it happen. */
	actionBar(options: { summary?: string; summaryId?: string; actions: string }): string; commandScript: string;
	runCommand(message: PageMessage): void;
	/** Records the subject a page is being opened on, so a restored tab opens on the same one. */
	remember(context: vscode.ExtensionContext, viewType: string, arg?: string): void;
	/** One serializer per page, so the window can bring a page's tab back after a restart. */
	restore(context: vscode.ExtensionContext, pages: readonly RestorablePage[]): vscode.Disposable[];
	/** Whether a page of ours has been restored into this window. */
	restoredAny(): boolean;
	/** Calls `listener` when the first page of ours is restored. */
	onDidRestorePage(listener: () => void): vscode.Disposable;
}

const extension = vscode.extensions.getExtension<UiApi>(UI_EXTENSION_ID);
if (extension === undefined || !extension.isActive) {
	throw new Error('The Temco UI module is not available.');
}

const ui = extension.exports;

/** The editor column every page of ours opens in. */
/** True when a view type — as a tab reports it, or as it was created — is a page of ours. */
export const isOurViewType = ui.isOurViewType;

/** The name this profile draws for itself — the Branding page's own row, or the build's name when it is unset. */
export function productName(): string {
	const name = vscode.workspace.getConfiguration('temcoWorkbench').get<string>('branding.productName', '').trim();
	return name.length > 0 ? name : 'Temco Platform';
}

/** The editor column every page of ours opens in. */
export const pageColumn = ui.pageColumn;

/** The column for something that is not a page of ours — a documentation page, a registry. */
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
/** The page vocabulary: a page is a head, its parts, the rows under them, and the one tint it is allowed. */
export const head = ui.head;

/** One part of a page: its title, the count and sentence under it, and what can be done from here. */
export const part = ui.part;

/** The list a part's rows lie in. */
export const entries = ui.entries;

/** One row: the glyph, the thing, the facts about it, its state, and what can be done to it. */
export const entry = ui.entry;

/** The figures a page opens on. */
export const figures = ui.figures;

/** The one tinted paragraph a page is allowed, and the thing to do about it. */
export const notice = ui.notice;

/** A button, rendered the one way this application renders them. */
export const button = ui.button;

/** The count with its noun, as the pages write it: "1 table", "34 tables". */
export const n = ui.n;

/** The questions at the bottom of a page. */
export const questions = ui.questions;

/** A section heading, with the page's parts told apart by it. */
export const section = ui.section;

/** A row of cards that are ways in. */
export const cards = ui.cards;

/** One entry lying on its side: the mark, the thing itself, and the way in at its right-hand end. */
export const entryRow = ui.entryRow;

/** A code card. */
export const code = ui.code;

/** The floating action in the corner of the page. */
export const floatAction = ui.floatAction;

/** A form's fields: two columns, a label above each control, the hint under it. */
export const formFields = ui.formFields;

/** The foot of a form: what will happen, and the buttons that make it happen. */
export const actionBar = ui.actionBar;
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

/** Whether a page of ours has been restored into this window. */
export const restoredAny = ui.restoredAny;

/** Calls `listener` when the first page of ours is restored. */
export const onDidRestorePage = ui.onDidRestorePage;

