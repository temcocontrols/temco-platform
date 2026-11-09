// The five Settings pages share one chrome.
//
// The vocabulary is the kit's, rule for rule — the brand wash with a title and a note, one tinted callout, a section heading
// with the brand rule before it, an entry row per fact, a facts band, and links at the foot of a block — so a settings page
// and Temco Learn's Overview page are drawn by the same rules. What is here is that vocabulary as components, so five pages
// cannot drift from each other either.

import { ReactNode } from 'react';

/** The size a button's glyph is set to: the kit draws a 14px mark beside a label. */
export const ICON = 14;

/** The chevron a link ends in, at the kit's own size. */
function ArrowRight(): React.ReactElement {
	return (
		<span className="icon" aria-hidden="true">
			<svg viewBox="0 0 16 16" width="12" height="12" fill="none" stroke="currentColor" strokeWidth="1.4">
				<path d="M6 3.5 10.5 8 6 12.5" />
			</svg>
		</span>
	);
}

/** A button in the application's own dress: the primary is filled, the default is outlined, the link is a blue word. */
export function Action(props: {
	label: string;
	glyph?: React.ReactElement;
	onClick: () => void;
	kind?: 'primary' | 'link';
	small?: boolean;
	/**
	 * What the button does, in full — for a list where every row's button says the same word. It becomes the button's
	 * accessible name and its tooltip, so "Open" in ten rows is ten different things to a screen reader.
	 */
	title?: string;
}): React.ReactElement {
	const size = props.small === true ? ' az-btn--sm' : '';
	const kind = props.kind === 'primary' ? ' az-btn--primary' : props.kind === 'link' ? ' az-btn--link' : '';
	return (
		<button type="button" className={`az-btn${size}${kind}`} title={props.title} aria-label={props.title} onClick={props.onClick}>
			{props.glyph}
			<span>{props.label}</span>
			{props.kind === 'link' ? <ArrowRight /> : null}
		</button>
	);
}

/** The title block: the wash, the page's only `h1`, one line of why, a line of context, and the ways in. */
export function Hero(props: {
	title: string;
	mark: React.ReactElement;
	desc: string;
	note?: React.ReactNode;
	actions?: React.ReactNode;
}): React.ReactElement {
	return (
		<div className="az-wash">
			<header className="az-lead">
				<h1 className="az-title az-title--hero">
					<span className="az-title__mark">{props.mark}</span>
					{props.title}
				</h1>
				<p className="az-intro az-intro--wide">{props.desc}</p>
				{props.note === undefined ? null : <p className="az-note">{props.note}</p>}
				{props.actions === undefined ? null : <div className="az-row">{props.actions}</div>}
			</header>
		</div>
	);
}

/** The one tinted callout a page is allowed: an icon, a sentence, and — at most — one act. */
export function Callout(props: { title?: string; desc: string; tone?: 'info' | 'warn'; actions?: ReactNode }): React.ReactElement {
	return (
		<aside className={`az-callout${props.tone === 'warn' ? ' az-callout--warn' : ''}`}>
			<div className="az-callout__main">
				<span className="az-callout__icon">
					<svg viewBox="0 0 16 16" width="16" height="16" fill="none" stroke="currentColor" strokeWidth="1.3">
						<circle cx="8" cy="8" r="6.4" />
						{props.tone === 'warn' ? <path d="M8 4.6v4.2M8 11.2v.2" /> : <path d="M8 7.4v4M8 4.6v.2" />}
					</svg>
				</span>
				<div>
					{props.title === undefined ? null : <p className="az-callout__title">{props.title}</p>}
					<p className="az-callout__desc">{props.desc}</p>
				</div>
			</div>
			{props.actions === undefined ? null : <div className="az-callout__actions">{props.actions}</div>}
		</aside>
	);
}

/** A section heading: the brand rule before the title, the sentence under it, and any acts at its right-hand end. */
export function Section(props: { title: string; desc?: string; actions?: ReactNode; children: ReactNode }): React.ReactElement {
	return (
		<>
			<div className="az-section">
				<div className="az-section__text">
					<h2 className="az-section__title">{props.title}</h2>
					{props.desc === undefined ? null : <p className="az-section__desc">{props.desc}</p>}
				</div>
				{props.actions === undefined ? null : <div className="az-section__actions">{props.actions}</div>}
			</div>
			{props.children}
		</>
	);
}

/** One fact, as an entry row: the glyph, the name, the sentence, and — when the row has one — its control at the right. */
export function Entry(props: {
	glyph: React.ReactElement;
	title: string;
	desc: string;
	control?: ReactNode;
	badge?: ReactNode;
}): React.ReactElement {
	return (
		<div className="az-entry">
			<span className="az-entry__icon" aria-hidden="true">
				{props.glyph}
			</span>
			<div className="az-entry__main">
				<span className="az-entry__title">
					{props.title}
					{props.badge === undefined ? null : props.badge}
				</span>
				<span className="az-entry__desc">{props.desc}</span>
			</div>
			{props.control === undefined ? null : <div className="setting-control">{props.control}</div>}
		</div>
	);
}

/** A stack of entries: the one shape a page uses for a list of things it already knows. */
export function Entries(props: { children: ReactNode }): React.ReactElement {
	return <div className="az-entries">{props.children}</div>;
}

/** The same list, laid out across the page instead of down it. */
export function Cards(props: { children: ReactNode }): React.ReactElement {
	return <div className="az-cards module-cards">{props.children}</div>;
}

/**
 * One card: the mark and the name on its first line, the sentence under them, the facts at its foot.
 *
 * It is the kit's `.az-card` — the shape Temco Learn's Overview page uses for a reading — rather than a second kind of
 * box. `idle` is for a thing this window knows about but has not loaded: the card keeps its place and loses its weight,
 * so "not here yet" reads without a second colour.
 */
export function Card(props: {
	glyph: React.ReactElement;
	title: string;
	desc: string;
	meta?: ReactNode;
	action?: ReactNode;
	idle?: boolean;
}): React.ReactElement {
	return (
		<article className={`az-card module-card${props.idle === true ? ' module-card--idle' : ''}`}>
			<div className="az-card__head">
				<span className="az-card__icon" aria-hidden="true">
					{props.glyph}
				</span>
				<span className="az-card__title">{props.title}</span>
			</div>
			<p className="az-card__desc">{props.desc}</p>
			{props.meta === undefined ? null : <div className="module-card__meta">{props.meta}</div>}
			{props.action === undefined ? null : <div className="module-card__action">{props.action}</div>}
		</article>
	);
}

/** The facts band: the floor the Overview page puts an address on. */
export function Facts(props: { items: { title: string; value: string; mono?: boolean }[] }): React.ReactElement {
	return (
		<div className="az-facts">
			{props.items.map((item) => (
				<div className="az-fact" key={item.title}>
					<span className="az-fact__title">{item.title}</span>
					<span className={`az-fact__value${item.mono === true ? ' az-fact__value--mono' : ''}`}>{item.value}</span>
				</div>
			))}
		</div>
	);
}

/** Links at the foot of a block: the acts that belong to everything above them. */
export function Foot(props: { children: ReactNode }): React.ReactElement {
	return <div className="az-block__foot">{props.children}</div>;
}

/** The page itself: the wash, then everything else on the page's own line. */
export function Page(props: { children: ReactNode }): React.ReactElement {
	return (
		<div className="view">
			<div className="view__inner">{props.children}</div>
		</div>
	);
}
