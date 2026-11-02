// The bar: the whole of what a page is written with, and nothing about how a page is stored.
//
// It is handed a snapshot of the caret (`PageState`) and a set of named operations (`PageActions`), so it knows no engine,
// no command string and no document position. That is what lets the bar be re-skinned without touching Tiptap, and Tiptap
// be replaced without touching a single button here.
//
// A control whose result Markdown cannot carry — alignment, colour, a font, spacing — is not here: a button whose effect
// disappears on save is a lie.

import * as React from 'react';
import {
	ArrowClockwise16Regular,
	ArrowUndo16Regular,
	BookOpen16Regular,
	BranchCompare16Regular,
	Camera16Regular,
	Code16Regular,
	// A block of code, a page of source, and a list of headings: three controls that were all drawn as `</>` or as a
	// bullet list, which is three glyphs meaning one thing in a bar where every other glyph means itself.
	CodeBlock16Regular,
	DocumentCode16Regular,
	TextBulletListSquare16Regular,
	// Fluent draws these two at 20 and above only; they are rendered at 16 like the rest, so the bar stays one size.
	ColorBackground20Regular,
	DocumentLink16Regular,
	DrawShape20Regular,
	Eye16Regular,
	Image16Regular,
	LineHorizontal116Regular,
	MoreHorizontal16Regular,
	Save16Regular,
	Search16Regular,
	Settings16Regular,
	Table16Regular,
	TextBold16Regular,
	TextItalic16Regular,
	TextQuote16Regular,
	TextStrikethrough16Regular,
	TextUnderline16Regular,
	// The assistant's glyph: a sparkle, which is what the AI panel's own command wears.
	Sparkle16Regular,
} from '@fluentui/react-icons';

import { LinkPopover, ListMenu, StyleMenu } from '../shared/menus';
import * as DropdownMenu from '@radix-ui/react-dropdown-menu';
import type { Mark, PageActions, PageState } from './contract';

interface ToolProps {
	label: string;
	glyph: React.ReactElement;
	run: () => unknown;
	active?: boolean;
	disabled?: boolean;
	/** The key that does the same thing, shown in the tooltip so the bar teaches the keyboard. */
	shortcut?: string;
}

/** One toolbar control: a glyph, a name a screen reader can read, its shortcut, and the state it is in. */
export function Tool({ label, glyph, run, active, disabled, shortcut }: ToolProps): React.ReactElement {
	const title = shortcut === undefined ? label : `${label} (${shortcut})`;
	return (
		<button
			type="button"
			// `btn--icon` and not `btn`: a text button in the same row keeps its own width, which is what stopped
			// "Preview", "Diff with HEAD" and "Open source" drawing on top of each other.
			className={`btn btn--sm btn--ghost btn--icon${active === true ? ' is-on' : ''}`}
			aria-label={label}
			aria-pressed={active}
			aria-keyshortcuts={shortcut}
			title={title}
			disabled={disabled === true}
			// A toolbar must not steal the selection the command is about to act on.
			onMouseDown={(event) => event.preventDefault()}
			onClick={run}
		>
			{glyph}
		</button>
	);
}

export interface RibbonProps {
	state: PageState;
	actions: PageActions;
	finding: boolean;
	outlining: boolean;
	reading: boolean;
	onReading: () => void;
	onFind: () => void;
	onOutline: () => void;
	/** The host's own actions: preview, diff, source, properties, a picture, a capture, a link to another page. */
	onHostAction: (action: 'preview' | 'diff' | 'source' | 'properties' | 'image' | 'capture' | 'linkPage' | 'assist' | 'save') => void;
	/** Enabled only when a picture is selected: annotating replaces it rather than adding a second one. */
	onAnnotate: () => void;
}

/**
 * The order a control leaves the bar when there is no room for it — the least reached-for first.
 *
 * Undo and redo go near the end, because a hand finds them without looking, and the four that say what is on screen
 * (find, outline, read, the assistant) go last of all: a bar that has folded everything else still has them, and a bar
 * with room for nothing else still has `⋯` to get them back. Nothing may sit outside this list, or a narrow editor could
 * overflow with no way to reach what it clipped.
 */
const FOLD_ORDER: readonly string[] = [
	'rule', 'table', 'screenshot', 'annotate', 'linkPage', 'picture', 'diff', 'preview', 'source', 'properties',
	'codeBlock', 'quote', 'highlight', 'code', 'strike', 'underline', 'italic', 'bold', 'redo', 'undo',
	'assist', 'find', 'outline', 'read', 'save',
];

/**
 * Fits the bar to one row, at any width.
 *
 * Wrapping is not an option: a wrapped toolbar draws the reading controls *under* the writing ones, and the two rows read
 * as two different bars — which is what made a narrow editor look broken. So the width is watched, and when the row cannot
 * hold what it is drawing, the next control in `FOLD_ORDER` leaves for `⋯`; the effect measures again after that render and
 * keeps going until the row fits. A wider tab starts from zero and folds whatever it still needs.
 */
function useOneRow(): { ref: React.RefObject<HTMLDivElement | null>; panel: React.RefObject<HTMLDivElement | null>; fold: number } {
	const ref = React.useRef<HTMLDivElement | null>(null);
	const panel = React.useRef<HTMLDivElement | null>(null);
	const [fold, setFold] = React.useState(0);
	// Bumped when the bar changes width, so the measurement below runs again even when the fold is already zero.
	const [resized, setResized] = React.useState(0);

	React.useEffect(() => {
		const element = ref.current;
		if (element === null) {
			return undefined;
		}
		// `ResizeObserver` rather than a window listener: an editor is narrowed by a split, a sidebar drag or a second
		// editor beside it, and none of those is a window resize.
		const observer = new ResizeObserver(() => {
			setFold(0);
			setResized(resized => resized + 1);
		});
		observer.observe(element);
		return () => observer.disconnect();
	}, []);

	React.useLayoutEffect(() => {
		const row = panel.current;
		if (row === null || fold >= FOLD_ORDER.length) {
			return;
		}
		// Measured from the boxes, not from `scrollWidth`: the panel clips its overflow, and a clipped flex row reports a
		// scroll width that says nothing about how far the last group actually sits past the edge.
		const right = row.getBoundingClientRect().right;
		let over = 0;
		for (const child of Array.from(row.children)) {
			over = Math.max(over, child.getBoundingClientRect().right - right);
		}
		if (over > 1) {
			// One control is 26 px, so this folds about as many as the overhang needs instead of one render per pixel.
			setFold(Math.min(fold + Math.max(1, Math.ceil(over / 26)), FOLD_ORDER.length));
		}
		// The bar re-renders on every caret move; measuring then would be a layout read per keystroke for nothing.
	}, [fold, resized]);

	return { ref, panel, fold };
}

/** The six marks a page can hold, in the order every editor puts them — the bar's first group and the whole selection menu. */
export const MARKS: ReadonlyArray<{ mark: Mark; label: string; glyph: React.ReactElement; shortcut: string }> = [
	{ mark: 'bold', label: 'Bold', glyph: <TextBold16Regular />, shortcut: 'Ctrl+B' },
	{ mark: 'italic', label: 'Italic', glyph: <TextItalic16Regular />, shortcut: 'Ctrl+I' },
	{ mark: 'underline', label: 'Underline', glyph: <TextUnderline16Regular />, shortcut: 'Ctrl+U' },
	{ mark: 'strike', label: 'Strikethrough', glyph: <TextStrikethrough16Regular />, shortcut: 'Ctrl+Shift+X' },
	{ mark: 'code', label: 'Inline code', glyph: <Code16Regular />, shortcut: 'Ctrl+E' },
	{ mark: 'highlight', label: 'Highlight', glyph: <ColorBackground20Regular />, shortcut: 'Ctrl+Shift+H' },
];

/** One control on the bar. */
interface Item {
	key: string;
	label: string;
	glyph: React.ReactElement;
	shortcut?: string;
	run: () => unknown;
	/** Which control this is in `FOLD_ORDER`: it says how soon the bar lets it go, and the menu names it by `label`. */
	active?: boolean;
	disabled?: boolean;
}

/** A group of controls under one hairline, with the control that is not a plain button (the link editor, a menu) first. */
interface GroupSpec {
	id: string;
	lead?: React.ReactElement;
	items: readonly Item[];
	/** `end` pushes the group to the right edge — the rail toggle lives there, away from the writing controls. */
	align?: 'end';
}

function Group({ lead, items, align }: { lead?: React.ReactElement; items: readonly Item[]; align?: 'end' }): React.ReactElement | null {
	if (lead === undefined && items.length === 0) {
		return null;
	}
	return (
		<div className={`ribbon__group${align === 'end' ? ' ribbon__group--end' : ''}`}>
			{lead}
			{items.map(item => (
				<Tool
					key={item.key}
					label={item.label}
					glyph={item.glyph}
					shortcut={item.shortcut}
					active={item.active}
					disabled={item.disabled}
					run={item.run}
				/>
			))}
		</div>
	);
}

/**
 * What the bar draws at `fold`, and what it hands to `⋯`.
 *
 * Each group declares its controls once, so the overflow menu is not a second copy that has to be kept in step by hand: a
 * folded control is the same row of the same table, left out of the bar and listed in the menu.
 */
function split(items: readonly Item[], foldedKeys: ReadonlySet<string>): { drawn: readonly Item[]; folded: readonly Item[] } {
	return {
		drawn: items.filter(item => !foldedKeys.has(item.key)),
		folded: items.filter(item => foldedKeys.has(item.key)),
	};
}

/** What a `⋯` shows: the controls the current width had to hide. */
function MoreMenu({ items }: { items: readonly Item[] }): React.ReactElement {
	return (
		<DropdownMenu.Root>
			<DropdownMenu.Trigger asChild>
				<button type="button" className="btn btn--sm btn--ghost" aria-label="More" title="More" onMouseDown={event => event.preventDefault()}>
					<MoreHorizontal16Regular />
				</button>
			</DropdownMenu.Trigger>
			<DropdownMenu.Portal>
				<DropdownMenu.Content className="menu" sideOffset={4} align="end">
					{items.map(item => (
						<DropdownMenu.Item key={item.key} className="menu__item" disabled={item.disabled === true} onSelect={() => item.run()}>
							<span>{item.label}</span>
							{item.shortcut === undefined ? null : <span className="menu__hint">{item.shortcut}</span>}
						</DropdownMenu.Item>
					))}
				</DropdownMenu.Content>
			</DropdownMenu.Portal>
		</DropdownMenu.Root>
	);
}

/**
 * The bar draws what it has room for and hands the rest to `⋯`.
 *
 * There is one row, as in the engine's own demos: writing on the left in the order a writer reaches for it, and what
 * reads the page or hands it to another surface pushed to the far right.
 */
export function PageRibbon(props: RibbonProps): React.ReactElement {
	const { state, actions, reading } = props;
	const { ref, panel, fold } = useOneRow();
	const foldedKeys = React.useMemo(() => new Set(FOLD_ORDER.slice(0, fold)), [fold]);

	// Everything that writes the page, in the order a writer reaches for it: undo, the block style, the lists, the marks,
	// the blocks, and what is inserted rather than typed. One row, the way the engine's own demos draw it.
	const writing: GroupSpec[] = [
		{
			id: 'save',
			items: [
				{ key: 'save', label: 'Save the page', glyph: <Save16Regular />, shortcut: 'Ctrl+S', run: () => props.onHostAction('save') },
			],
		},
		{
			id: 'history',
			items: [
				{ key: 'undo', label: 'Undo', glyph: <ArrowUndo16Regular />, shortcut: 'Ctrl+Z', disabled: !state.canUndo, run: actions.undo },
				{ key: 'redo', label: 'Redo', glyph: <ArrowClockwise16Regular />, shortcut: 'Ctrl+Y', disabled: !state.canRedo, run: actions.redo },
			],
		},
		{ id: 'style', lead: <StyleMenu state={state} actions={actions} />, items: [] },
		{ id: 'lists', lead: <ListMenu state={state} actions={actions} />, items: [] },
		{
			id: 'text',
			items: MARKS.map(entry => ({
				key: entry.mark,
				label: entry.label,
				glyph: entry.glyph,
				shortcut: entry.shortcut,
				active: state.marks[entry.mark],
				run: () => actions.toggleMark(entry.mark),
			})),
		},
		{
			id: 'blocks',
			items: [
				{ key: 'quote', label: 'Block quote', glyph: <TextQuote16Regular />, shortcut: 'Ctrl+Shift+B', run: actions.toggleQuote },
				{ key: 'codeBlock', label: 'Code block', glyph: <CodeBlock16Regular />, shortcut: 'Ctrl+Alt+C', run: actions.toggleCodeBlock },
				{ key: 'rule', label: 'Horizontal rule', glyph: <LineHorizontal116Regular />, run: actions.horizontalRule },
				{ key: 'table', label: 'Table', glyph: <Table16Regular />, run: actions.insertTable },
			],
		},
		{
			id: 'insert',
			lead: <LinkPopover state={state} actions={actions} />,
			items: [
				{ key: 'picture', label: 'Picture', glyph: <Image16Regular />, run: () => props.onHostAction('image') },
				{ key: 'screenshot', label: 'Screenshot', glyph: <Camera16Regular />, run: () => props.onHostAction('capture') },
				{ key: 'annotate', label: 'Annotate the picture', glyph: <DrawShape20Regular />, disabled: !state.onImage, run: props.onAnnotate },
				{ key: 'linkPage', label: 'Link to page', glyph: <DocumentLink16Regular />, run: () => props.onHostAction('linkPage') },
			],
		},
	];

	// What reads the page or hands it to another surface, pushed to the far right and away from the writing controls.
	const viewing: GroupSpec = {
		id: 'view',
		align: 'end',
		items: [
			{ key: 'find', label: 'Find', glyph: <Search16Regular />, shortcut: 'Ctrl+F', active: props.finding, run: props.onFind },
			{ key: 'outline', label: 'Outline', glyph: <TextBulletListSquare16Regular />, shortcut: 'Ctrl+Alt+O', active: props.outlining, run: props.onOutline },
			// Reading a page is not editing one: the same surface, no caret, and the writing groups are not drawn.
			{ key: 'read', label: reading ? 'Edit the page' : 'Read the page', glyph: <BookOpen16Regular />, active: reading, run: props.onReading },
			{ key: 'preview', label: 'Preview the page', glyph: <Eye16Regular />, shortcut: 'Ctrl+Alt+P', run: () => props.onHostAction('preview') },
			{ key: 'diff', label: 'Diff with HEAD', glyph: <BranchCompare16Regular />, shortcut: 'Ctrl+Alt+D', run: () => props.onHostAction('diff') },
			{ key: 'source', label: 'Open the source', glyph: <DocumentCode16Regular />, run: () => props.onHostAction('source') },
			{ key: 'properties', label: 'Page properties', glyph: <Settings16Regular />, run: () => props.onHostAction('properties') },
			// The assistant is a view of the page, not a writing tool: it opens the AI panel beside what is on screen.
			{ key: 'assist', label: 'Draft with the AI', glyph: <Sparkle16Regular />, shortcut: 'Ctrl+Alt+A', run: () => props.onHostAction('assist') },
		],
	};

	// The bar draws what fits and hands the rest to `⋯`. Read mode draws the same table minus the writing groups; if the
	// tab is too narrow for its own controls, they fold like any other.
	const drawnOf = (group: GroupSpec): readonly Item[] => split(group.items, foldedKeys).drawn;
	const foldedOf = (group: GroupSpec): readonly Item[] => split(group.items, foldedKeys).folded;

	const groups = reading ? [viewing] : [...writing, viewing];
	const folded = groups.flatMap(foldedOf);

	return (
		<div className={`ribbon${fold === 0 ? '' : ' is-compact'}`} ref={ref} data-fold={fold}>
			<div className="ribbon__panel" ref={panel} role="toolbar" aria-label={reading ? 'Reading' : 'Writing'}>
				{reading ? <span className="ribbon__mode">Reading</span> : null}
				{groups.filter(group => group.align !== 'end').map(group => (
					<Group key={group.id} lead={group.lead} items={drawnOf(group)} />
				))}
				{folded.length === 0 ? null : <MoreMenu items={folded} />}
				{groups.filter(group => group.align === 'end').map(group => (
					<Group key={group.id} align="end" lead={group.lead} items={drawnOf(group)} />
				))}
			</div>
		</div>
	);
}
