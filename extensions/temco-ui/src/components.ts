// The shared page components: a title block, three option cards, a number row, one callout, a section, cards, a code
// sample, the questions at the bottom, and the floating action.
//
// Why these are components and not strings each module writes: a front page is the first thing a person sees of the
// application, and every one of these appears on more than one page. Three copies of a callout drift apart in a week —
// a different radius, a different button order, one of them forgetting the icon. So the markup is decided here, once,
// and the rules it depends on live in `media/page.css` under the same `az-*` names, which
// `scripts/check-components.mts` holds the two to.
//
// The look is Fluent 2's numbers with Azure's brand: a 40/52 title over a brand-tinted wash, three option cards of equal
// height each ending in a button, a number row, one tinted callout, and the questions underneath. Nothing here imports
// `vscode`, and nothing here imports another file: a component a plain node script cannot import is a component nothing
// can check.

/** Text from the workspace, a model or a person: everything interpolated into a page goes through this. */
export function escapeHtml(text: string): string {
	return text
		.replace(/&/g, '&amp;')
		.replace(/</g, '&lt;')
		.replace(/>/g, '&gt;')
		.replace(/"/g, '&quot;');
}

/** One glyph from the page's sprite, at the size the class asks for. */
export function icon(name: string, cls?: string): string {
	return `<svg viewBox="0 0 24 24" class="icon${cls ? ` ${cls}` : ''}" aria-hidden="true"><use href="#i-${name}"></use></svg>`;
}

/** A state you can see before you read it: one icon inside a tinted circle. */
export function toneMark(name: string, tone?: 'ok' | 'warn' | 'err' | 'info' | 'accent'): string {
	return `<span class="tone-mark${tone ? ` tone-mark--${tone}` : ''}">${icon(name, 'icon--sm')}</span>`;
}

/** One act the title block offers. `primary` is the brand-filled button; `link` is a word, not a box. */
export interface HeroAction {
	label: string;
	command: string;
	args?: unknown;
	mark?: string;
	kind?: 'primary' | 'link';
}

/**
 * The field under the title.
 *
 * It is a button, not an `<input>`: a page may run a command and may not search the workbench itself, and a text box
 * that silently did nothing would be worse than one that says what it does.
 */
export interface HeroSearch {
	label: string;
	command: string;
	/** The keybinding, shown on the right of the field. */
	hint?: string;
}

export interface HeroOptions {
	/** `Temco Platform › Documentation`, above the title. */
	crumbs?: string;
	/** A line above the title, when there is no breadcrumb. */
	eyebrow?: string;
	title: string;
	/** A glyph before the title, drawn in a brand-tinted chip. */
	mark?: string;
	desc?: string;
	/**
	 * The description takes the full width instead of a reading measure.
	 *
	 * A page's introduction is normally held at 78 characters, which is what a paragraph that is read wants. A front
	 * page's introduction is a summary rather than prose, so it runs the width of the column it sits in.
	 */
	descWide?: boolean;
	search?: HeroSearch;
	actions?: readonly HeroAction[];
	/**
	 * The ways in, already rendered.
	 *
	 * A page whose buttons come from its own helper hands the markup over rather than rebuilding it as data: the two
	 * are the same `.az-btn` buttons, and a page should not have to know the shape of its own acts twice.
	 */
	actionsHtml?: string;
	/** The front page's title is 40/52; every other page's is 32/40. */
	hero?: boolean;
	/**
	 * The band is drawn as an inset card instead of running edge to edge.
	 *
	 * A page that opens on a *thing* — a project, a workspace — puts its header in a rounded panel, the way a
	 * workspace's own header does; a page that is the thing itself keeps the full-bleed band.
	 */
	panel?: boolean;
	/**
	 * The figures the page opens on, drawn on the panel's own floor.
	 *
	 * A number row under the panel is a second block that says what the first one is about; inside it, the page opens
	 * once, and the facts read as the panel's own foot rather than as a card that happens to follow it.
	 */
	stats?: readonly { value: string; label: string }[];
	/**
	 * One line of context that belongs to the header: an address, a caveat, what the page is reading.
	 *
	 * Drawn as an information strip under the description, at the header's own width — the place a page says *where*
	 * it is, rather than putting a machine's address where a person's name belongs. With a `link`, the text is a
	 * button drawn as a link: an address in a header is something to go to, not something to read.
	 */
	note?: { text: string; mark?: string; mono?: boolean; link?: { command: string; args?: unknown } };
}

/** Buttons, rendered the one way this application renders them. */
function buttons(actions: readonly HeroAction[]): string {
	return actions.map(action => {
		const cls = `az-btn${action.kind === 'primary' ? ' az-btn--primary' : action.kind === 'link' ? ' az-btn--link' : ''}`;
		const args = action.args === undefined ? '' : ` data-args="${escapeHtml(JSON.stringify(action.args))}"`;
		const mark = action.mark === undefined ? '' : icon(action.mark);
		return `<button type="button" class="${cls}" data-command="${escapeHtml(action.command)}"${args}>${mark}<span>${escapeHtml(action.label)}</span></button>`;
	}).join('');
}

/**
 * The title block: a brand-tinted wash, the breadcrumb, the page's only `h1`, one line of why, the field and the ways in.
 *
 * The wash is the single piece of decoration on a page — `.az-wash` fades the brand tint into the page rather than
 * painting a band across it, which is what the Azure purchase-options page does and what a saturated hero does not.
 */
export function hero(options: HeroOptions): string {
	const crumbs = options.crumbs !== undefined
		? `<p class="az-crumbs">${escapeHtml(options.crumbs)}</p>`
		: options.eyebrow === undefined ? '' : `<p class="az-crumbs az-crumbs--eyebrow">${escapeHtml(options.eyebrow)}</p>`;
	const desc = options.desc === undefined ? '' : `<p class="az-intro${options.descWide === true ? ' az-intro--wide' : ''}">${escapeHtml(options.desc)}</p>`;
	const noteMark = options.note?.mark === undefined ? '' : `<span class="az-note__mark">${icon(options.note.mark)}</span>`;
	const noteMono = options.note?.mono === true ? ' az-note__text--mono' : '';
	const noteText = options.note === undefined
		? ''
		: options.note.link === undefined
			? `<span class="az-note__text${noteMono}">${escapeHtml(options.note.text)}</span>`
			: `<button type="button" class="az-note__text az-note__text--link${noteMono}" data-command="${escapeHtml(options.note.link.command)}"${options.note.link.args === undefined ? '' : ` data-args="${escapeHtml(JSON.stringify(options.note.link.args))}"`}>${escapeHtml(options.note.text)}</button>`;
	const note = options.note === undefined ? '' : `<p class="az-note">${noteMark}${noteText}</p>`;
	const search = options.search === undefined
		? ''
		: `<button type="button" class="az-field" data-command="${escapeHtml(options.search.command)}" title="${escapeHtml(options.search.label)}">${icon('search')}<span class="az-field__label">${escapeHtml(options.search.label)}</span>${options.search.hint === undefined ? '' : `<kbd class="az-field__hint">${escapeHtml(options.search.hint)}</kbd>`}</button>`;
	const actions = options.actionsHtml
		?? (options.actions === undefined || options.actions.length === 0 ? '' : buttons(options.actions));
	const row = search === '' && actions === '' ? '' : `<div class="az-row">${search}${actions}</div>`;
	const size = options.hero === true ? ' az-title--hero' : '';
	const mark = options.mark === undefined ? '' : `<span class="az-title__mark">${icon(options.mark)}</span>`;
	const stats = options.stats === undefined || options.stats.length === 0
		? ''
		: `<div class="az-lead__stats">${options.stats.map(item => `<div class="az-stat"><span class="az-stat__value">${escapeHtml(item.value)}</span><span class="az-stat__label">${escapeHtml(item.label)}</span></div>`).join('')}</div>`;
	// A panel puts its ways in and its figures beside the sentence; a band keeps them under the title, where a page
	// that opens on nothing but itself has room for them.
	const tail = row === '' && stats === ''
		? ''
		: options.panel === true ? `<div class="az-lead__side">${row}${stats}</div>` : `${row}${stats}`;
	return `<div class="az-wash${options.panel === true ? ' az-wash--panel' : ''}"><header class="az-lead">${crumbs}<h1 class="az-title${size}">${mark}${escapeHtml(options.title)}</h1>${desc}${note}${tail}</header></div>`;
}

/** One figure in the number row. */
export interface NumberItem {
	value: string;
	label: string;
}

/** The row of figures: what this page is about, in numbers, in one box. */
export function numbers(items: readonly NumberItem[]): string {
	return `<div class="az-numbers">${items.map(item => `<div class="az-number"><p class="az-number__value">${escapeHtml(item.value)}</p><p class="az-number__label">${escapeHtml(item.label)}</p></div>`).join('')}</div>`;
}

/** One option card: an icon, a name, what it is for, three ticks, and the button that starts it. */
export interface OptionCard {
	title: string;
	desc: string;
	/** The small brand label above the title, e.g. `Recommended`. */
	tag?: string;
	mark?: string;
	ticks: readonly string[];
	/** The words on the button. */
	label: string;
	command: string;
	args?: unknown;
	/** Drawn on the brand tint with a brand stroke. One card, never two. */
	pick?: boolean;
}

/** Three options side by side — the shape the front page is built on. */
export function optionCards(items: readonly OptionCard[]): string {
	return `<div class="az-options">${items.map(item => {
		const args = item.args === undefined ? '' : ` data-args="${escapeHtml(JSON.stringify(item.args))}"`;
		const iconHtml = item.mark === undefined ? '' : `<span class="az-option__icon">${icon(item.mark)}</span>`;
		const tag = item.tag === undefined ? '' : `<span class="az-option__tag">${escapeHtml(item.tag)}</span>`;
		const ticks = item.ticks.map(tick => `<li class="az-option__tick">${icon('check')}<span>${escapeHtml(tick)}</span></li>`).join('');
		const cls = item.pick === true ? ' az-btn--primary' : '';
		return `<section class="az-option${item.pick === true ? ' az-option--pick' : ''}"><div class="az-option__top">${iconHtml}<div>${tag}<h2 class="az-option__title">${escapeHtml(item.title)}</h2></div></div><p class="az-option__desc">${escapeHtml(item.desc)}</p><ul class="az-option__ticks">${ticks}</ul><div class="az-option__actions"><button type="button" class="az-btn${cls}" data-command="${escapeHtml(item.command)}"${args}><span>${escapeHtml(item.label)}</span></button></div></section>`;
	}).join('')}</div>`;
}

/** The one tinted callout a page is allowed: an icon, a sentence, and the thing to do about it. */
export interface CalloutOptions {
	title: string;
	desc: string;
	mark?: string;
	/** Pre-rendered buttons. */
	actions?: string;
}

export function callout(options: CalloutOptions): string {
	const mark = options.mark === undefined ? 'info' : options.mark;
	return `<aside class="az-callout"><div class="az-callout__main"><span class="az-callout__icon">${icon(mark)}</span><div><p class="az-callout__title">${escapeHtml(options.title)}</p><p class="az-callout__desc">${escapeHtml(options.desc)}</p></div></div>${options.actions === undefined ? '' : `<div class="az-callout__actions">${options.actions}</div>`}</aside>`;
}

export interface SectionOptions {
	title: string;
	desc?: string;
	/** Pre-rendered buttons or links, drawn at the right-hand end of the heading. */
	actions?: string;
}

/** A section heading: the `h2` a page's parts are told apart by. */
export function section(options: SectionOptions): string {
	return `<div class="az-section"><div class="az-section__text"><h2 class="az-section__title">${escapeHtml(options.title)}</h2>${options.desc === undefined ? '' : `<p class="az-section__desc">${escapeHtml(options.desc)}</p>`}</div>${options.actions === undefined ? '' : `<div class="az-section__actions">${options.actions}</div>`}</div>`;
}

/** One card in a row of cards: an icon, a name, why it is worth opening, and the way in. */
export interface FeatureCard {
	title: string;
	desc: string;
	mark?: string;
	command?: string;
	args?: unknown;
	/** The words on the way in, when the card is one. */
	go?: string;
	/** A counted fact under the description, e.g. `2 of 5 steps`. */
	note?: string;
	/** How far the thing described has got, 0–1. Drawn only when a page can attest to it. */
	progress?: number;
	/**
	 * Present but not this project's: drawn without its icon colour and with a plain border, so a card a person did not
	 * ask for is readable as one they did not ask for — greyed, never hidden.
	 */
	muted?: boolean;
}

/** A row of cards that are ways in. A card without a command is drawn as a plain card, not as a dead button. */
export function cards(items: readonly FeatureCard[], options: { dense?: boolean } = {}): string {
	return `<div class="az-cards${options.dense === true ? ' az-cards--dense' : ''}">${items.map(item => {
		const plain = item.command === undefined;
		const args = item.args === undefined ? '' : ` data-args="${escapeHtml(JSON.stringify(item.args))}"`;
		const attr = plain ? '' : ` data-command="${escapeHtml(item.command as string)}"${args}`;
		const chip = item.mark === undefined ? '' : `<span class="az-card__icon">${icon(item.mark)}</span>`;
		const head = `<span class="az-card__head">${chip}<span class="az-card__title">${escapeHtml(item.title)}</span></span>`;
		const note = item.note === undefined ? '' : `<p class="az-card__note">${escapeHtml(item.note)}</p>`;
		const share = item.progress === undefined ? 0 : Math.round(Math.min(1, Math.max(0, item.progress)) * 100);
		const bar = item.progress === undefined ? '' : `<span class="az-card__bar"><span class="az-card__fill" style="width:${share}%"></span></span>`;
		const muted = item.muted === true ? ' az-card--muted' : '';
		return `<div class="az-card${plain ? '' : ' az-card--action'}${muted}"${attr}>${head}<p class="az-card__desc">${escapeHtml(item.desc)}</p>${note}${bar}${plain ? '' : `<span class="az-card__go">${escapeHtml(item.go ?? 'Open')}${icon('chevron-right', 'icon--sm')}</span>`}</div>`;
	}).join('')}</div>`;
}

/**
 * One entry lying on its side: the mark, the thing itself, and the way back into it at the right-hand end.
 *
 * A card is a thing to choose between; an entry is the one thing a page already knows about — the page a workspace
 * remembers. It is drawn as a row because a single card in a row of cards reads as an option that did not arrive.
 */
export interface EntryRowOptions {
	title: string;
	/** The line under the title: a path, a count, where the thing lives. */
	meta?: string;
	mark?: string;
	command?: string;
	args?: unknown;
	/** The words of the way in, at the right-hand end. */
	go?: string;
}

export function entryRow(options: EntryRowOptions): string {
	const plain = options.command === undefined;
	const args = options.args === undefined ? '' : ` data-args="${escapeHtml(JSON.stringify(options.args))}"`;
	const attr = plain ? '' : ` data-command="${escapeHtml(options.command as string)}"${args}`;
	const mark = options.mark === undefined ? '' : `<span class="az-entry__icon">${icon(options.mark)}</span>`;
	const meta = options.meta === undefined ? '' : `<span class="az-entry__meta">${escapeHtml(options.meta)}</span>`;
	const go = plain ? '' : `<span class="az-entry__go">${escapeHtml(options.go ?? 'Open')}${icon('chevron-right', 'icon--sm')}</span>`;
	return `<div class="az-entry${plain ? '' : ' az-entry--action'}"${attr}>${mark}<div class="az-entry__main"><span class="az-entry__title">${escapeHtml(options.title)}</span>${meta}</div>${go}</div>`;
}

/** One of a set of mutually exclusive starting points, drawn as a card you choose. */
export interface ChoiceCard {
	value: string;
	title: string;
	desc: string;
	mark?: string;
	/** A small brand label above the title, e.g. `Recommended`. */
	tag?: string;
}

export interface ChoiceCardsOptions {
	items: readonly ChoiceCard[];
	/** The value drawn as chosen. */
	selected?: string;
	/** The attribute the chosen value is written in, e.g. `data-type`. */
	attribute?: string;
}

/**
 * Mutually exclusive choices, as cards.
 *
 * A rail of them is navigation and belongs to a settings surface with many entries; three starting points are one
 * decision, and a decision drawn as cards can be compared in a glance. The value travels in the attribute the page
 * names, the chosen one carries `is-on`, and the page's own script does the switching.
 */
export function choiceCards(options: ChoiceCardsOptions): string {
	const attribute = options.attribute ?? 'data-type';
	return `<div class="az-choices" role="listbox">${options.items.map(item => {
		const on = item.value === options.selected;
		const chip = item.mark === undefined ? '' : `<span class="az-choice__icon">${icon(item.mark)}</span>`;
		const tag = item.tag === undefined ? '' : `<span class="az-choice__tag">${escapeHtml(item.tag)}</span>`;
		return `<button type="button" class="az-choice${on ? ' is-on' : ''}" role="option" aria-selected="${on}" ${attribute}="${escapeHtml(item.value)}" data-title="${escapeHtml(item.title)}">${chip}<span class="az-choice__main">${tag}<span class="az-choice__title">${escapeHtml(item.title)}</span><span class="az-choice__desc">${escapeHtml(item.desc)}</span></span><span class="az-choice__check">${icon('check', 'icon--sm')}</span></button>`;
	}).join('')}</div>`;
}

/** One field of a form: a label, the control, and the sentence under it. */
export interface FormField {
	label: string;
	/** The pre-rendered control: an input, a select, a textarea. */
	control: string;
	hint?: string;
	/** Takes the whole row instead of one column. */
	wide?: boolean;
}

/** A form's fields: two columns, the label above the control, the hint under it. */
export function formFields(fields: readonly FormField[]): string {
	return `<div class="az-form">${fields.map(field => `<div class="az-form__field${field.wide === true ? ' az-form__field--wide' : ''}"><span class="az-form__label">${escapeHtml(field.label)}</span>${field.control}${field.hint === undefined ? '' : `<span class="az-form__hint">${escapeHtml(field.hint)}</span>`}</div>`).join('')}</div>`;
}

/** One thing a build or a project includes, drawn as a card that carries its own tick. */
export interface CheckCard {
	value: string;
	label: string;
	note: string;
	mark?: string;
}

export interface CheckCardsOptions {
	/** The field the ticks are posted in, e.g. `targets`. */
	field: string;
	items: readonly CheckCard[];
	ticked?: readonly string[];
}

/**
 * Several things that can each be on or off, as cards.
 *
 * A column of ticks has to be read line by line to learn its state; a card carries the state in its border, its wash
 * and its check, so the question is answered by a glance. The input stays a real checkbox, hidden but focusable, so a
 * click, a tap and the space bar all do the same thing.
 */
export function checkCards(options: CheckCardsOptions): string {
	const ticked = options.ticked ?? [];
	return `<div class="az-checks">${options.items.map(item => `<label class="az-check"><input type="checkbox" data-field="${escapeHtml(options.field)}" data-multi value="${escapeHtml(item.value)}"${ticked.includes(item.value) ? ' checked' : ''}><span class="az-check__icon">${icon(item.mark ?? 'check')}</span><span class="az-check__main"><span class="az-check__label">${escapeHtml(item.label)}</span><span class="az-check__note">${escapeHtml(item.note)}</span></span><span class="az-check__tick">${icon('check', 'icon--sm')}</span></label>`).join('')}</div>`;
}

export interface ActionBarOptions {
	/** The line at the left: what will happen, in one sentence. */
	summary?: string;
	/** The id a page's script writes that line into. */
	summaryId?: string;
	/** Pre-rendered buttons, right-aligned. */
	actions: string;
}

/** The foot of a form: what will happen, and the one button that makes it happen. */
export function actionBar(options: ActionBarOptions): string {
	const id = options.summaryId === undefined ? '' : ` id="${escapeHtml(options.summaryId)}"`;
	return `<div class="az-actions"><span class="az-actions__summary"${id}>${escapeHtml(options.summary ?? '')}</span><span class="az-actions__buttons">${options.actions}</span></div>`;
}

/** One line of a code card, and the tone the tokens on it are drawn in. */
export interface CodeLine {
	text: string;
	/** Where to colour something: `[start, end, tone]`, in the line's own characters. */
	tokens?: readonly [number, number, 'keyword' | 'string' | 'name' | 'comment'][];
}

export interface CodeOptions {
	/** The language named in the bar, e.g. `TypeScript`. */
	language: string;
	lines: readonly CodeLine[];
}

/**
 * A code card: the sample a developer came for.
 *
 * The line numbers are drawn, not written into the text, so copying the sample copies the sample. Every line is
 * escaped; colour comes from `tokens`, which is what keeps this component free of a highlighter.
 */
export function code(options: CodeOptions): string {
	const rows = options.lines.map((line, index) => {
		let html = '';
		let at = 0;
		for (const [start, end, tone] of line.tokens ?? []) {
			html += escapeHtml(line.text.slice(at, start));
			html += `<span class="tok-${tone}">${escapeHtml(line.text.slice(start, end))}</span>`;
			at = end;
		}
		html += escapeHtml(line.text.slice(at));
		return `<span class="az-code__line"><span class="az-code__n">${index + 1}</span><span>${html}</span></span>`;
	}).join('');
	return `<div class="az-code"><div class="az-code__bar"><span>${escapeHtml(options.language)}</span><span class="az-code__language">${icon('code', 'icon--sm')}</span></div><pre class="az-code__body">${rows}</pre></div>`;
}

/** One question and its answer, closed until asked. */
export interface Question {
	ask: string;
	answer: string;
}

/** The questions at the bottom of a page: rows that open, not a dialog. */
export function questions(items: readonly Question[]): string {
	const rows = items.map(item => `<details class="az-q"><summary class="az-q__ask">${icon('chevron-right', 'icon--sm')}<span>${escapeHtml(item.ask)}</span></summary><p class="az-q__answer">${escapeHtml(item.answer)}</p></details>`).join('');
	return `<div class="az-questions">${rows}</div>`;
}

/** The way to the AI, fixed where a reader's hand already is. */
export function floatAction(options: { label: string; command: string; mark?: string }): string {
	return `<button type="button" class="az-float" data-command="${escapeHtml(options.command)}">${options.mark === undefined ? '' : icon(options.mark)}<span>${escapeHtml(options.label)}</span></button>`;
}
