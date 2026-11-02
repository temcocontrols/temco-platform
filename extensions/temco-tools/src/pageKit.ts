// The vocabulary a studio's pages are written in — the application's kit, once.
//
// Each of the five studios used to carry its own copy of this: `pageHead`, `group`, `rule`, `tiles`, `card`, `badge`,
// `callout`, `button`, each emitting the mock's classes. Five copies of a title block is five places for a page to
// drift, and the copies were the reason a tool page did not look like the page beside it. They are one file now, built
// on `temco-ui`'s components: a page is a **hero**, its parts are **sections**, its rows are **entries**, its figures
// are **numbers**, and its one tint is a **callout**.
//
// One thing is added here that the kit does not name on its own: a row that **acts**. A controller is diagnosed, a
// firmware behind the fleet is installed, a statement is run — so a tool's row carries the buttons that act on it and
// the state it is in, which the kit's own entry (a way in, nothing more) has no slot for.

import { callout, esc, hero, icon, numbers, section, toneMark } from './ui';

/** The five states a row's glyph can carry. */
type Tone = 'ok' | 'warn' | 'err' | 'info' | 'accent';

/** One button in a page's header. */
export interface HeadAction {
	label: string;
	command: string;
	args?: unknown;
	mark?: string;
	kind?: 'primary' | 'link';
}

/**
 * The top of a studio page: the studio it belongs to, what the page is, one line of why, and the acts it opens with.
 *
 * The eyebrow is the studio's name, which is the one fact every page of a studio shares.
 */
export function head(options: {
	studio: string;
	title: string;
	mark: string;
	desc: string;
	actions?: readonly HeadAction[];
	/** The figures the page opens on, drawn on the header's own floor. */
	stats?: readonly { value: string; label: string }[];
	/** The one line of context that belongs to the header: what the page is reading. */
	note?: { text: string; mark?: string };
}): string {
	return hero({
		eyebrow: options.studio,
		title: options.title,
		mark: options.mark,
		desc: options.desc,
		note: options.note,
		stats: options.stats,
		actions: options.actions
	});
}

/** One part of a page: its title, the count and sentence under it, and what can be done from here. */
export function part(options: { title: string; note?: string; count?: string; actions?: string }): string {
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

/**
 * One row: the glyph, the thing, the facts about it, and what can be done to it.
 *
 * The state is words at the right-hand end rather than a coloured pill: a pill is decoration that says "read the
 * colour", and the word says what the device is doing. Where a row can be acted on, its actions sit beside the state,
 * because that is where a hand goes looking for them.
 */
export function entry(options: {
	mark?: string;
	tone?: Tone;
	title: string;
	meta?: readonly (string | undefined)[];
	state?: string;
	actions?: string;
	/** Raw markup at the right-hand end — a chart, where the row has one. */
	aside?: string;
}): string {
	const chip = options.mark === undefined ? '' : toneMark(options.mark, options.tone ?? 'info');
	const facts = (options.meta ?? []).filter((fact): fact is string => fact !== undefined && fact.length > 0);
	const meta = facts.length === 0 ? '' : `<span class="az-entry__meta">${facts.map(esc).join(' · ')}</span>`;
	const actions = options.actions === undefined || options.actions === '' ? '' : `<span class="az-entry__state">${options.actions}</span>`;
	const aside = options.aside === undefined ? '' : `<span class="az-entry__aside">${options.aside}</span>`;
	const state = options.state === undefined ? '' : `<span class="az-entry__go">${esc(options.state)}</span>`;
	return `<div class="az-entry">${chip}<div class="az-entry__main"><span class="az-entry__title">${esc(options.title)}</span>${meta}</div>${aside}${actions}${state}</div>`;
}

/** The figures a page opens on. */
export function figures(items: readonly { value: string; label: string }[]): string {
	return numbers(items);
}

/** The one tinted paragraph a page is allowed, and the thing to do about it. */
export function notice(options: { title: string; desc: string; mark?: string; actions?: string }): string {
	return callout(options);
}

/** A button, rendered the one way this application renders them. */
export function button(
	label: string,
	command: string,
	options: { kind?: 'primary' | 'ghost'; mark?: string; args?: unknown; small?: boolean } = {}
): string {
	const cls = `az-btn${options.kind === 'primary' ? ' az-btn--primary' : ''}${options.small === true ? ' az-btn--sm' : ''}`;
	const args = options.args === undefined ? '' : ` data-args="${esc(JSON.stringify(options.args))}"`;
	return `<button type="button" class="${cls}" data-command="${esc(command)}"${args}>${options.mark === undefined ? '' : icon(options.mark)}<span>${esc(label)}</span></button>`;
}

/** The count with its noun, as the pages write it: "1 controller", "34 controllers". */
export const n = (count: number, one: string, many: string): string => `${count} ${count === 1 ? one : many}`;
