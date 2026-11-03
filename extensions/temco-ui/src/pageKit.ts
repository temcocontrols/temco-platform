// The vocabulary a page is written in — the application's kit, once.
//
// Every module used to carry its own copy of this: `pageHead`, `group`, `rule`, `tiles`, `card`, `badge`, `callout`,
// `button`, each emitting a different set of mock classes. Six copies of a title block is six places for a page to
// drift, and the copies were the reason two pages of the same application did not look like each other. They are one
// file now, built on this module's components: a page is a **hero**, its parts are **sections**, its rows are
// **entries**, its figures are **numbers**, and its one tint is a **callout**.
//
// One thing is added here that the components do not name on their own: a row that **acts**. A statement is run, an
// artifact is installed, a draft is settled — so a row carries the buttons that act on it and the state it is in,
// which the component entry (a way in, nothing more) has no slot for.

import { callout, escapeHtml, hero, icon, numbers, section, toneMark } from './components';

/** The five states a row's glyph can carry. */
export type Tone = 'ok' | 'warn' | 'err' | 'info' | 'accent';

/** One button in a page's header. */
export interface HeadAction {
	label: string;
	command: string;
	args?: unknown;
	mark?: string;
	kind?: 'primary' | 'link';
}

/** The figures a page opens on. */
export interface Figure {
	value: string;
	label: string;
}

/**
 * The top of a page: the part of the application it belongs to, what the page is, one line of why, and the acts it
 * opens with.
 *
 * The eyebrow is the area's name, which is the one fact every page of that area shares.
 */
export interface HeadOptions {
	/** The area the page belongs to: `SQL`, `Documentation`, `Temco Learn`. */
	studio: string;
	title: string;
	mark: string;
	desc: string;
	actions?: readonly HeadAction[];
	/** Pre-rendered buttons, for a page whose buttons come from its own helper. */
	actionsHtml?: string;
	/** The figures the page opens on, drawn on the header's own floor. */
	stats?: readonly Figure[];
	/** The one line of context that belongs to the header: what the page is reading. */
	note?: { text: string; mark?: string; mono?: boolean };
}

export function head(options: HeadOptions): string {
	return hero({
		eyebrow: options.studio,
		title: options.title,
		mark: options.mark,
		desc: options.desc,
		note: options.note,
		stats: options.stats,
		actions: options.actions,
		actionsHtml: options.actionsHtml
	});
}

/** One part of a page: its title, the count and sentence under it, and what can be done from here. */
export interface PartOptions {
	title: string;
	note?: string;
	count?: string;
	/** Pre-rendered buttons, drawn at the right-hand end of the heading. */
	actions?: string;
}

export function part(options: PartOptions): string {
	const desc = [options.count ?? '', options.note ?? ''].filter((text) => text.length > 0).join(' · ');
	return section({
		title: options.title,
		desc: desc.length === 0 ? undefined : desc,
		actions: options.actions === undefined || options.actions === '' ? undefined : options.actions
	});
}

/** The list a part's rows lie in. */
export function entries(rows: string): string {
	return `<div class="az-entries">${rows}</div>`;
}

/** One row: the glyph, the thing, the facts about it, and what can be done to it. */
export interface EntryOptions {
	mark?: string;
	tone?: Tone;
	title: string;
	meta?: readonly (string | undefined)[];
	/** The state in words, at the right-hand end. */
	state?: string;
	/** Pre-rendered buttons, beside the state. */
	actions?: string;
	/** Raw markup at the right-hand end — a chart, where the row has one. */
	aside?: string;
}

/**
 * One row of a page.
 *
 * The state is words at the right-hand end rather than a coloured pill: a pill is decoration that says "read the
 * colour", and the word says what the thing is doing. Where a row can be acted on, its actions sit beside the state,
 * because that is where a hand goes looking for them.
 */
export function entry(options: EntryOptions): string {
	const chip = options.mark === undefined ? '' : toneMark(options.mark, options.tone ?? 'info');
	const facts = (options.meta ?? []).filter((fact): fact is string => fact !== undefined && fact.length > 0);
	const meta = facts.length === 0 ? '' : `<span class="az-entry__meta">${facts.map(escapeHtml).join(' · ')}</span>`;
	const actions = options.actions === undefined || options.actions === '' ? '' : `<span class="az-entry__state">${options.actions}</span>`;
	const aside = options.aside === undefined ? '' : `<span class="az-entry__aside">${options.aside}</span>`;
	const state = options.state === undefined ? '' : `<span class="az-entry__go">${escapeHtml(options.state)}</span>`;
	return `<div class="az-entry">${chip}<div class="az-entry__main"><span class="az-entry__title">${escapeHtml(options.title)}</span>${meta}</div>${aside}${actions}${state}</div>`;
}

/** The figures a page opens on. */
export function figures(items: readonly Figure[]): string {
	return numbers(items);
}

/** The one tinted paragraph a page is allowed, and the thing to do about it. */
export interface NoticeOptions {
	title: string;
	desc: string;
	mark?: string;
	/** Pre-rendered buttons. */
	actions?: string;
}

export function notice(options: NoticeOptions): string {
	return callout(options);
}

/** A button, rendered the one way this application renders them. */
export interface ButtonOptions {
	/** `link` is a word rather than a box: the way out of a row, not the act a row is about. */
	kind?: 'primary' | 'ghost' | 'link';
	mark?: string;
	args?: unknown;
	small?: boolean;
}

export function button(label: string, command: string, options: ButtonOptions = {}): string {
	const kind = options.kind === 'primary' ? ' az-btn--primary' : options.kind === 'link' ? ' az-btn--link' : '';
	const cls = `az-btn${kind}${options.small === true ? ' az-btn--sm' : ''}`;
	const args = options.args === undefined ? '' : ` data-args="${escapeHtml(JSON.stringify(options.args))}"`;
	return `<button type="button" class="${cls}" data-command="${escapeHtml(command)}"${args}>${options.mark === undefined ? '' : icon(options.mark)}<span>${escapeHtml(label)}</span></button>`;
}

/** The count with its noun, as the pages write it: "1 table", "34 tables". */
export function n(count: number, one: string, many: string): string {
	return `${count} ${count === 1 ? one : many}`;
}
