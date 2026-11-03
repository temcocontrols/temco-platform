// The UI module's entry point.
//
// It is the application's shared UI conventions, and it has no surface of its own: no command, no view, no
// setting — only the rules that every module's pages and rows depend on, published so that each of them is
// decided once instead of once per module: where a page opens, what a command argument means, what a page looks
// like (`media/page.css`), the components a page is built from, and how a page runs a command (a message, never a link).

import * as vscode from 'vscode';
import { fileColumn, isOurViewType, pageColumn } from './columns';
import { ActionBarOptions, CalloutOptions, CheckCardsOptions, ChoiceCardsOptions, CodeOptions, EntryRowOptions, FeatureCard, FormField, HeroOptions, NumberItem, OptionCard, Question, SectionOptions, actionBar, callout, cards, checkCards, choiceCards, code, entryRow, floatAction, formFields, hero, icon, numbers, optionCards, questions, section, toneMark } from './components';
import { COMMAND_SCRIPT, PageMessage, PageOptions, escapeHtml, page, runPageCommand } from './page';
import { ButtonOptions, EntryOptions, Figure, HeadOptions, NoticeOptions, PartOptions, button, entries, entry, figures, head, n, notice, part } from './pageKit';
import { RestorablePage, onDidRestorePage, remember, remembered, restore, restoredAny } from './restore';
import { rowSlug } from './rows';

/** What this module offers the rest of the platform. */
export interface TemcoUiApi {
	/** True when a view type — as a tab reports it, or as it was created — is a page of ours. */
	isOurViewType(viewType: string): boolean;
	/** The editor column every page of ours opens in. */
	pageColumn(): vscode.ViewColumn;
	/** The editor column for something that is not a page of ours. */
	fileColumn(): vscode.ViewColumn;
	/** The slug a command argument names, whether it is a slug, a row, or a row's own command argument. */
	rowSlug(target: unknown): string | undefined;
	/** A document around `body`, carrying the shared page vocabulary. */
	page(body: string, options?: PageOptions): string;
	/** Text that came from anywhere but this module, escaped for a page. */
	escapeHtml(text: string): string;
	/** One glyph from the page's sprite. */
	icon(name: string, cls?: string): string;
	/** One glyph in a tinted circle: a state you can see before you read it. */
	toneMark(name: string, tone?: 'ok' | 'warn' | 'err' | 'info' | 'accent'): string;
	/** The title block: a brand-tinted wash, the breadcrumb, the page's only h1, the field and the ways in. */
	hero(options: HeroOptions): string;
	/** The row of figures under a title. */
	numbers(items: readonly NumberItem[]): string;
	/** Three options side by side, each ending in a button. */
	optionCards(items: readonly OptionCard[]): string;
	/** The one tinted callout a page is allowed. */
	callout(options: CalloutOptions): string;
	/** The questions at the bottom of a page. */
	questions(items: readonly Question[]): string;
	/** A section heading: the `h2` a page's parts are told apart by. */
	section(options: SectionOptions): string;
	/** A row of cards that are ways in. */
	cards(items: readonly FeatureCard[], options?: { dense?: boolean }): string;
	/** One entry lying on its side: the mark, the thing itself, and the way in at its right-hand end. */
	entryRow(options: EntryRowOptions): string;
	/** Mutually exclusive starting points, drawn as cards. */
	choiceCards(options: ChoiceCardsOptions): string;
	/** A form's fields: two columns, a label above each control, the hint under it. */
	formFields(fields: readonly FormField[]): string;
	/** What a build or a project includes, as cards that carry their own tick. */
	checkCards(options: CheckCardsOptions): string;
	/** The foot of a form: a summary line and its buttons. */
	actionBar(options: ActionBarOptions): string;
	/** A code card, with drawn line numbers and four tones of syntax. */
	code(options: CodeOptions): string;
	/** The floating action in the corner of the page. */
	floatAction(options: { label: string; command: string; mark?: string }): string;
	/** The top of a page: the area it belongs to, its only `h1`, one line of why, and the acts it opens with. */
	head(options: HeadOptions): string;
	/** One part of a page: its title, the count and sentence under it, and what can be done from here. */
	part(options: PartOptions): string;
	/** The list a part's rows lie in. */
	entries(rows: string): string;
	/** One row: the glyph, the thing, the facts about it, its state, and what can be done to it. */
	entry(options: EntryOptions): string;
	/** The figures a page opens on. */
	figures(items: readonly Figure[]): string;
	/** The one tinted paragraph a page is allowed, and the thing to do about it. */
	notice(options: NoticeOptions): string;
	/** A button, rendered the one way this application renders them. */
	button(label: string, command: string, options?: ButtonOptions): string;
	/** The count with its noun, as the pages write it: "1 table", "34 tables". */
	n(count: number, one: string, many: string): string;
	/** The script a page runs to post `data-command` clicks back to its module. */
	commandScript: string;
	/** Runs one of those messages. The module's `onDidReceiveMessage` calls this. */
	runCommand(message: PageMessage): void;
	/** Records the subject a page is being opened on, so a restored tab opens on the same one. */
	remember(context: vscode.ExtensionContext, viewType: string, arg?: string): void;
	/** The subject this view type was last opened on. */
	remembered(context: vscode.ExtensionContext, viewType: string): string | undefined;
	/** One serializer per page, so the window can bring a page's tab back after a restart. */
	restore(context: vscode.ExtensionContext, pages: readonly RestorablePage[]): vscode.Disposable[];
	/** Whether a page of ours has been restored into this window. */
	restoredAny(): boolean;
	/** Calls `listener` when the first page of ours is restored. */
	onDidRestorePage(listener: () => void): vscode.Disposable;
}

export function activate(context: vscode.ExtensionContext): TemcoUiApi {
	return {
		pageColumn,
		fileColumn,
		isOurViewType,
		rowSlug,
		page: (body, options) => page(context, body, options),
		escapeHtml,
		icon,
		toneMark,
		hero,
		numbers,
		optionCards,
		callout,
		questions,
		section,
		cards,
		entryRow,
		choiceCards,
		formFields,
		checkCards,
		actionBar,
		code,
		floatAction,
		head,
		part,
		entries,
		entry,
		figures,
		notice,
		button,
		n,
		commandScript: COMMAND_SCRIPT,
		runCommand: runPageCommand,
		remember,
		remembered,
		restore,
		restoredAny,
		onDidRestorePage
	};
}

export function deactivate(): void {
	// Nothing to unwind: this module owns pure rules, one stylesheet and no state.
}
