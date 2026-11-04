// SQL Studio — the platform's own database, looked at and maintained.
//
// What this is: a window onto `catalog.db`, the one SQLite file the platform writes (sources, projects, pages,
// drafts, builds, artifacts, releases, events). It is *not* a general SQL client and there is no server to connect
// to: the studio is pointed at one database because that is the database this window is about.
//
// What it is for, in four jobs:
//
//   * **Ask.** A statement, a result table, and the time it took. Reading is unrestricted; a writing statement needs
//     the checkbox under the editor, so `DELETE FROM sources` is not one keystroke away.
//   * **Look.** Every table with its columns, its indexes and its row count — the schema is `schema.ts`, and this is
//     what the file actually has.
//   * **Maintain.** Vacuum, checkpoint the write-ahead log, take a backup copy, and the two development acts: empty
//     every table (keep the shape) or drop the shape and write it again (start over).
//   * **Remember.** Saved statements live in this profile; the last few runs stay in the window's own history.
//
// Everything here goes through the store's open handle — `catalog.query`, `catalog.tables`, `catalog.maintain` — so
// the file keeps the rules the store sets for it (WAL, foreign keys, one window, one file).

import * as vscode from 'vscode';
import { Catalog, SqlResult, TableFact } from './store';
import { PageMessage, button as kitButton, commandScript, entries, entry, esc, figures, hero, icon, n, notice, page, pageColumn, part, section } from './ui';

/** One surface of the SQL container: the row, the command, and the page it draws. */
export interface SqlPage {
	id: string;
	label: string;
	note: string;
	mark: string;
	command: string;
	viewType: string;
	/**
	 * Which half of the studio the row belongs to.
	 *
	 * There is one database here, not two, so the split is by *what a person is doing*, not by whose data it is:
	 * `rows` is asking questions and looking at answers; `file` is the database's shape and its upkeep. The old
	 * split ("Workbench" / "Docs Database") described the mock's two sample servers, which no longer exist.
	 */
	group: 'rows' | 'file';
}

export const SQL_PAGES: SqlPage[] = [
	{ id: 'query', label: 'Query Editor', note: 'ask a question in SQL', mark: 'code', command: 'temcoTools.sql.query', viewType: 'temcoTools.sql.query', group: 'rows' },
	{ id: 'data', label: 'Data', note: 'the rows themselves, table by table', mark: 'list', command: 'temcoTools.sql.data', viewType: 'temcoTools.sql.data', group: 'rows' },
	// Presets and saved queries were two pages of the same list — a name, a sentence, and a Load — so they are one page
	// with two groups. The old commands stay registered as ways into it, so a keybinding or a menu item still lands.
	{ id: 'queries', label: 'Query Library', note: 'statements to load, built-in and your own', mark: 'book', command: 'temcoTools.sql.queries', viewType: 'temcoTools.sql.queries', group: 'rows' },
	{ id: 'history', label: 'History', note: 'what was run in this window, newest first', mark: 'clock', command: 'temcoTools.sql.history', viewType: 'temcoTools.sql.history', group: 'rows' },
	{ id: 'schema', label: 'Table Structure', note: 'the tables, their columns and indexes', mark: 'list', command: 'temcoTools.sql.schema', viewType: 'temcoTools.sql.schema', group: 'file' },
	{ id: 'connections', label: 'Database', note: 'the file, its size, and how to put it back', mark: 'database', command: 'temcoTools.sql.connections', viewType: 'temcoTools.sql.connections', group: 'file' }
];

/** One run, as the history lists it. */
interface RunEntry {
	at: string;
	sql: string;
	ok: boolean;
	detail: string;
	rows: number;
	ms: number;
}

/** A statement worth keeping: what it is called, what it asks, and why. */
interface Preset {
	name: string;
	note: string;
	sql: string;
}

/**
 * The presets.
 *
 * Each one is written against the schema in `catalog/schema.ts`, so a rename there is a broken preset rather than a
 * silent lie — which is the point of them: a preset that returns nothing is telling you the schema moved.
 */
const PRESETS: Preset[] = [
	{
		name: 'Drafts waiting',
		note: 'what the Review Center lists, oldest first',
		sql: "SELECT id, title, page_id, kind, created_at\nFROM drafts\nWHERE state = 'draft'\nORDER BY created_at;",
	},
	{
		name: 'What each source contributed',
		note: 'pages recorded per source, and when it was last read',
		sql: 'SELECT s.name, s.kind, s.pages, s.last_read, s.state\nFROM sources s\nORDER BY s.pages DESC;',
	},
	{
		name: 'Projects and their sources',
		note: 'the documents table and what is attached to it',
		sql: 'SELECT d.slug, d.name, d.version, count(ds.source_id) AS sources\nFROM documents d\nLEFT JOIN doc_sources ds ON ds.document_id = d.id\nGROUP BY d.id\nORDER BY d.name;',
	},
	{
		name: 'Builds that left nothing',
		note: 'an exit code is not an artifact',
		sql: "SELECT b.id, b.started_at, b.finished_at, b.status\nFROM builds b\nWHERE NOT EXISTS (SELECT 1 FROM artifacts a WHERE a.build_id = b.id)\nORDER BY b.started_at DESC;",
	},
	{
		name: 'Every artifact, newest first',
		note: 'what a reader can actually be given',
		sql: 'SELECT a.kind, a.path, a.bytes, a.built_at\nFROM artifacts a\nORDER BY a.built_at DESC;',
	},
	{
		name: 'Published versions',
		note: 'releases, and where each copy went',
		sql: 'SELECT r.version, r.files, r.destination, r.published_at\nFROM releases r\nORDER BY r.published_at DESC;',
	},
	{
		name: 'What the platform noticed',
		note: 'the events table the dashboard reads',
		sql: "SELECT at, kind, detail\nFROM events\nORDER BY at DESC\nLIMIT 50;",
	},
];

/** One statement in the editor, one checkbox, one last result. Per window, not per page. */
interface StudioState {
	editor: string;
	write: boolean;
	last?: { sql: string; result: SqlResult };
	error?: { sql: string; message: string };
	history: RunEntry[];
	/** Which table the Data page is showing, and how far into it. */
	table?: string;
	offset: number;
	/** Which table the Schema page has open. */
	schemaTable?: string;
	/** The last `quick_check` answer, so the Database page can print it rather than forget it. */
	integrity?: string;
}

/* ------------------------------------------------------------------ page vocabulary */

// The vocabulary is the application's (`ui.ts`, on `temco-ui`'s kit), plus the four primitives a query surface
// needs and a page of prose does not: a grid of rows, a toolbar over a statement, the editor itself, and the one line
// that says what the last run did. Those live in the kit's stylesheet as `az-grid`, `az-toolbar` and
// `az-message` — the Data page and the Query Editor draw the same table, so they use the same rules. The statement's
// own code surface is this page's (`.qz-code`), because a coloured layer under a transparent textarea is not a control
// the rest of the application has.

/** A row of the studio's tables and lists, under the name this file reads it by. */
const row = entry;

/** A button; `danger` is the one colour a page uses for an act that forgets something. */
const button = (
	label: string,
	command: string,
	options: { kind?: 'primary' | 'ghost' | 'danger'; mark?: string; args?: unknown; small?: boolean; title?: string } = {}
): string => {
	const markup = kitButton(label, command, {
		kind: options.kind === 'primary' ? 'primary' : options.kind === 'ghost' ? 'ghost' : undefined,
		mark: options.mark,
		args: options.args,
		small: options.small
	});
	const danger = options.kind === 'danger' ? markup.replace('class="az-btn', 'class="az-btn az-btn--danger') : markup;
	return options.title === undefined ? danger : danger.replace('<button type="button"', `<button type="button" title="${esc(options.title)}"`);
};

/** The page's title block. The studio's name is not repeated above it: the tab, the panel and the title already say it. */
const pageHead = (options: { title: string; mark: string; desc: string; actions?: string }): string =>
	hero({
		title: options.title,
		mark: options.mark,
		desc: options.desc,
		// The sentence under the title is one line of why, not a paragraph to read: it takes the column's whole width
		// rather than stopping at a comfortable measure and leaving the right half of the header empty.
		descWide: true,
		actions: options.actions === undefined ? undefined : actionsOf(options.actions)
	});

/**
 * The buttons a header carries, read back out of the markup `button()` builds.
 *
 * `hero` wants its actions as data and a studio page builds them as markup; the two fields it reads are the command
 * and the words on the button, and both are in the string.
 */
function actionsOf(markup: string): { label: string; command: string; kind?: 'primary' }[] {
	return [...markup.matchAll(/data-command="([^"]*)"[^>]*>(?:<[^>]+>)*<span>([^<]*)<\/span>/g)].map((match) => ({
		command: decode(match[1]),
		label: decode(match[2]),
		kind: /az-btn--primary/.test(match[0]) ? ('primary' as const) : undefined
	}));
}

const decode = (text: string): string =>
	text.replaceAll('&quot;', '"').replaceAll('&#39;', "'").replaceAll('&lt;', '<').replaceAll('&gt;', '>').replaceAll('&amp;', '&');

/** A part and the list of rows under it. */
const group = (options: { label: string; count?: string; note?: string; actions?: string; body: string }): string =>
	`${part({ title: options.label, count: options.count, note: options.note, actions: options.actions })}${entries(options.body)}`;

/** The figures a page opens on. */
const tiles = (items: { value: string; label: string }[]): string => figures(items);

/** The one tinted paragraph a page is allowed. */
const callout = (html: string, kind: 'warn' | 'ok' | 'info' = 'info'): string => {
	const title = /<b>([^<]*)<\/b>/.exec(html);
	const plain = html.replace(/<[^>]+>/g, '').trim();
	return notice({
		mark: kind === 'warn' ? 'alert' : kind === 'ok' ? 'check' : 'info',
		title: title === null ? (kind === 'ok' ? 'Done' : kind === 'warn' ? 'Check this' : 'Worth knowing') : title[1],
		desc: title === null ? plain : plain.replace(title[1], '').replace(/^[\s.]+/, '').replace(/\s+/g, ' ').trim()
	});
};

/** One value in a result cell: nothing is invented, and a blob is not printed as bytes. */
function cell(value: unknown): string {
	if (value === null || value === undefined) {
		return '<span class="cell-muted">—</span>';
	}
	if (typeof value === 'number') {
		return `<span class="cell-mono">${esc(String(value))}</span>`;
	}
	if (typeof value === 'boolean') {
		return `<span class="cell-mono">${value ? '1' : '0'}</span>`;
	}
	const text = String(value);
	if (text.length > 120) {
		return `<span class="cell-mono">${esc(text.slice(0, 120))}…</span>`;
	}
	return esc(text);
}

/** The result of a statement, as a table. Empty columns means the statement did not return rows. */
function resultTable(result: SqlResult): string {
	if (!result.readOnly) {
		return callout(
			`<b>${n(result.changes ?? 0, 'row', 'rows')} changed.</b> Nothing was returned: a writing statement answers with the number of rows it touched.`,
			'ok'
		);
	}
	if (result.columns.length === 0) {
		return callout('The statement returned no columns. A statement that answers nothing is a statement that reads nothing.', 'warn');
	}
	const head = `<th class="az-grid__row">#</th>${result.columns.map((column) => `<th>${esc(column)}</th>`).join('')}`;
	const rows = result.rows
		.map((row, index) => `<tr><td class="az-grid__row">${index + 1}</td>${row.map((value) => `<td${typeof value === 'number' ? ' class="az-grid__num"' : ''}>${cell(value)}</td>`).join('')}</tr>`)
		.join('');
	return `<div class="az-grid"><table><thead><tr>${head}</tr></thead><tbody>${rows}</tbody></table></div>${result.truncated ? `<p class="group-note">Showing the first ${result.rows.length} rows — add a LIMIT, or narrow the WHERE.</p>` : ''}`;
}

/**
 * The editor page's own script.
 *
 * It repeats the kit's click handler because `acquireVsCodeApi()` may be taken **once** per page: the studio needs
 * the same API for the textarea, so the two behaviours live in one script rather than in two.
 */
const EDITOR_SCRIPT = `
(function () {
	const api = acquireVsCodeApi();
	document.addEventListener('click', (event) => {
		const target = event.target.closest('[data-command]');
		if (!target) {
			return;
		}
		event.preventDefault();
		const args = target.dataset.args;
		api.postMessage({
			type: 'command',
			command: target.dataset.command,
			args: args === undefined ? undefined : JSON.parse(args)
		});
	});
	const editor = document.getElementById('sql-editor');
	const view = document.getElementById('sql-view');
	const box = document.getElementById('sql-code');
	const writes = document.getElementById('sql-writes');
	const writesBar = document.getElementById('sql-writes-bar');
	const runButton = document.getElementById('sql-run');
	if (!editor || !runButton || !view || !box) {
		return;
	}
	// A ticked permission is a state of the page, not only of the box: the bar takes the warning tint, so nobody runs a
	// writing statement over a database they meant to keep.
	if (writes && writesBar) {
		const paint = () => writesBar.classList.toggle('is-on', writes.checked);
		writes.addEventListener('change', paint);
		paint();
	}

	// ---- the coloured layer under the input
	//
	// A textarea cannot colour its own text, so it is left transparent and laid over a layer that can: the same words,
	// the same font, the same padding, coloured by one pass of a small tokenizer. Everything an editor is expected to do
	// — the caret, selection, undo, IME, the platform's own shortcuts — is still the textarea's, because it *is* a
	// textarea; only the colours are drawn beside it.
	const KEYWORDS = new Set(('select from where and or not null is in like between group by order having limit offset '
		+ 'join left right full outer inner cross on as insert into values update set delete create table index view '
		+ 'drop alter add column primary key foreign references unique check default case when then else end union all '
		+ 'distinct exists asc desc if begin commit rollback transaction vacuum pragma explain with recursive attach '
		+ 'database true false').split(' '));
	const FUNCTIONS = new Set(('count sum avg min max abs round length lower upper substr trim coalesce ifnull nullif '
		+ 'typeof date time datetime julianday strftime total group_concat row_number').split(' '));
	const TOKEN = /(--[^\\n]*)|(\\/\\*[\\s\\S]*?\\*\\/)|('(?:[^']|'')*')|("(?:[^"]|"")*")|(\\d+(?:\\.\\d+)?)|([A-Za-z_][A-Za-z0-9_]*)|([(),.;*+\\-\\/=<>!|%^&~\\[\\]]+)/g;
	const escape = (text) => text.replace(/[&<>]/g, (character) => character === '&' ? '&amp;' : character === '<' ? '&lt;' : '&gt;');
	const span = (cls, text) => '<span class="' + cls + '">' + escape(text) + '</span>';

	function paint() {
		const text = editor.value;
		let html = '';
		let drawn = 0;
		TOKEN.lastIndex = 0;
		let found;
		while ((found = TOKEN.exec(text)) !== null) {
			if (found.index > drawn) {
				const plain = text.slice(drawn, found.index);
				html += escape(plain);
			}
			if (found[1] !== undefined || found[2] !== undefined) {
				html += span('t-com', found[0]);
			} else if (found[3] !== undefined || found[4] !== undefined) {
				html += span('t-str', found[0]);
			} else if (found[5] !== undefined) {
				html += span('t-num', found[0]);
			} else if (found[6] !== undefined) {
				const word = found[0].toLowerCase();
				html += KEYWORDS.has(word) ? span('t-kw', found[0]) : FUNCTIONS.has(word) ? span('t-fn', found[0]) : escape(found[0]);
			} else {
				html += span('t-op', found[0]);
			}
			drawn = found.index + found[0].length;
		}
		html += escape(text.slice(drawn));
		// Nothing typed yet says what a statement looks like; and a trailing newline needs one character after it or the
		// empty last line has no height and the caret sits on the line above.
		view.innerHTML = text.length === 0 ? '<span class="t-hint">SELECT * FROM sources LIMIT 50;</span>' : html + '\\n ';
		// Only now does the page hand the words over to the coloured layer: until this class is on the box, the textarea
		// shows its own text, so a script that fails leaves a readable field rather than a blank one.
		box.classList.add('is-live');
		sync();
	}

	function sync() {
		view.scrollTop = editor.scrollTop;
		view.scrollLeft = editor.scrollLeft;
	}

	editor.addEventListener('input', paint);
	editor.addEventListener('scroll', sync);
	editor.addEventListener('blur', () => view.classList.remove('has-focus'));
	editor.addEventListener('focus', () => view.classList.add('has-focus'));
	// Tab indents instead of leaving the field; the browser keeps the undo entry.
	editor.addEventListener('keydown', (event) => {
		if (event.key === 'Tab' && !event.ctrlKey && !event.metaKey) {
			event.preventDefault();
			if (document.execCommand) {
				document.execCommand('insertText', false, '  ');
			}
		}
	});

	const run = () => api.postMessage({ type: 'sql', sql: editor.value, write: !!(writes && writes.checked) });
	runButton.addEventListener('click', run);
	editor.addEventListener('keydown', (event) => {
		if (event.key === 'Enter' && (event.ctrlKey || event.metaKey)) {
			event.preventDefault();
			run();
		}
	});
	paint();
	editor.focus();
	editor.setSelectionRange(editor.value.length, editor.value.length);
	sync();
})();
`;

/**
 * The editor's own layout, as a query window rather than a page of cards.
 *
 * Everything here is local to the statement → result loop: a toolbar that says what will happen, an editor with room
 * to work, one line of message, and a grid that can scroll without moving the page. `extraCss` is scoped to this
 * page by the kit.
 */
const QUERY_CSS = `
/* The query window is a column of four bands, and every band says one thing: what will run (the bar), what it is
   allowed to do (the permission, full width), what you are writing (the editor), and what came back (the result).
   Flat throughout — hairlines and spacing, no cards — because the editor is the only object on the page. */

/* 1. The bar: Run leads, the doors to a stored statement follow, and what it will run against sits at the end. */
.qz-bar { display: flex; align-items: center; gap: 6px; flex-wrap: wrap; margin: 18px 0 0; }
.qz-bar__btn { flex: 0 0 auto; white-space: nowrap; }
/* A hairline between the act and the doors, so Run is not read as the first of four equals. */
.qz-bar__x { width: 1px; align-self: stretch; margin: 0 6px; background: var(--border); }
.qz-bar .az-btn { flex: 0 0 auto; white-space: nowrap; }
.qz-bar__facts { margin-left: auto; color: var(--fg-subtle); font-size: 12px; font-variant-numeric: tabular-nums; }

/* 2. The permission, full width: a decision the page makes you look at, and square like the editor it governs. */
.qz-writes { display: flex; align-items: center; gap: 10px; width: 100%; margin: 12px 0 0; padding: 9px 12px;
  border: 1px solid var(--border); border-radius: 0; background: none; font-size: 12px; line-height: 17px;
  cursor: pointer; transition: background-color 90ms ease-out, border-color 90ms ease-out; }
.qz-writes:hover { background: color-mix(in srgb, var(--az-blue) 5%, transparent); }
.qz-writes.is-on { border-color: var(--warn); background: color-mix(in srgb, var(--warn) 10%, transparent); }
.qz-writes input { flex: 0 0 auto; margin: 0; }
.qz-writes__label { font-weight: 600; color: var(--fg); white-space: nowrap; }
.qz-writes__note { color: var(--fg-muted); min-width: 0; }

/* 3. The statement: a small code editor, not a pill. A textarea is laid transparently over a coloured layer that shows
   the same words, so the caret, the selection, undo and the platform's shortcuts all stay the browser's, and only the
   colours are drawn beside them. Square corners, the whole width, and a short default height. No gutter: the box is for
   one statement, and a column of numbers beside five lines is furniture. */
.qz-code { display: grid; grid-template-columns: minmax(0, 1fr); margin: 12px 0 0;
  border: 1px solid var(--border); border-radius: 0; background: var(--editor-bg); }
.qz-code:focus-within { border-color: var(--az-blue); }
.qz-code__field { position: relative; min-width: 0; }
/* The two layers must agree on every metric that moves text, or the caret drifts away from its word. */
.qz-code__view,
.qz-code__input { margin: 0; padding: 12px 14px; border: 0; box-sizing: border-box;
  font-family: var(--vscode-editor-font-family, Consolas, monospace); font-size: 13px; line-height: 20px;
  letter-spacing: normal; tab-size: 2; white-space: pre-wrap; overflow-wrap: anywhere; word-break: normal; }
.qz-code__view { height: 154px; overflow: hidden; color: var(--fg); pointer-events: none; }
.qz-code__input { position: absolute; inset: 0; width: 100%; height: 154px; resize: none; outline: none;
  background: transparent; color: var(--fg); caret-color: var(--fg); }
.qz-code__input::selection { background: var(--vscode-editor-selectionBackground, color-mix(in srgb, var(--az-blue) 30%, transparent)); }
/* The colours only take over once the highlighter has actually drawn something — the script marks the box as live.
   Before that, or if a script ever fails, the page is an ordinary readable textarea instead of an empty box. */
.qz-code:not(.is-live) .qz-code__view { display: none; }
.qz-code.is-live .qz-code__input { color: transparent; }
/* The colours: the theme's own token colours where it has them, then a colour that is guaranteed defined, so a keyword
   can never end up the same colour as the words around it. */
.t-kw { color: var(--vscode-symbolIcon-keywordForeground, var(--az-blue, #0078d4)); }
.t-fn { color: var(--vscode-symbolIcon-functionForeground, var(--purple, #8250df)); }
.t-str { color: var(--vscode-debugTokenExpression-string, var(--vscode-charts-orange, #ce9178)); }
.t-num { color: var(--vscode-debugTokenExpression-number, var(--vscode-charts-green, #098658)); }
.t-com { color: var(--vscode-descriptionForeground, var(--fg-muted)); font-style: italic; }
.t-op { color: var(--vscode-editorBracketHighlight-foreground3, var(--fg-muted)); }
.t-hint { color: var(--fg-subtle); }
@media (max-width: 700px) {
  .qz-code { grid-template-columns: minmax(0, 1fr); }
}

/* 4. The result: what came back on the left, every act that can be taken on it, in words, at the other end. */
.qz-result { display: flex; align-items: center; gap: 10px; flex-wrap: wrap;
  margin: 24px 0 8px; padding-top: 14px; border-top: 1px solid var(--border); }
.qz-result__title { font-size: var(--fs-xs); font-weight: 600; letter-spacing: 0.06em; text-transform: uppercase; color: var(--fg-muted); }
.qz-result__facts { color: var(--fg-subtle); font-size: 12px; font-variant-numeric: tabular-nums; }
.qz-result__actions { margin-left: auto; display: flex; gap: 6px; flex-wrap: wrap; }
.qz-result__actions .az-btn { flex: 0 0 auto; white-space: nowrap; }
.az-grid { max-height: 420px; }
`;

/* ------------------------------------------------------------------ the six pages */

/** *Query Editor* — a statement, its answer, and the two switches that decide what it may do. */
function queryBody(state: StudioState, schemaVersion: number, file: string): string {
	const last = state.last;
	const error = state.error;
	const name = file.split(/[\\/]/).pop() ?? file;

	const message = error !== undefined
		? `<div class="az-message az-message--err"><span><b>Msg:</b> ${esc(error.message)}</span></div>`
		: last === undefined
			? ''
			: `<div class="az-message"><span>Query executed successfully — ${
				last.result.readOnly
					? n(last.result.rows.length, 'row', 'rows')
					: n(last.result.changes ?? 0, 'row affected', 'rows affected')
			} in ${last.result.ms} ms.</span></div>`;

	const results = last === undefined
		? ''
		: `<div class="qz-result">
	<span class="qz-result__title">Results</span>
	<span class="qz-result__facts">${n(last.result.rows.length > 0 ? last.result.rows.length : last.result.columns.length, last.result.rows.length > 0 ? 'row' : 'column', last.result.rows.length > 0 ? 'rows' : 'columns')}${last.result.truncated ? ' · truncated' : ''} · ${last.result.ms} ms</span>
	<div class="qz-result__actions">${button('Run again', 'temcoTools.sql.run', { small: true, kind: 'ghost', mark: 'play' })
		+ button('Copy SQL', 'temcoTools.sql.copySql', { small: true, kind: 'ghost', mark: 'code' })
		+ button('Copy rows', 'temcoTools.sql.copyResult', { small: true, kind: 'ghost', mark: 'output' })
		+ button('Save This', 'temcoTools.sql.saveQuery', { small: true, kind: 'ghost', mark: 'book' })
		+ button('Export CSV', 'temcoTools.sql.export', { small: true, kind: 'ghost', mark: 'download' })}</div>
</div>
${resultTable(last.result)}`;

	return `${pageHead({
		title: 'Query Editor',
		mark: 'code',
		desc: 'One statement against the platform database. Ctrl+Enter runs it; reading is unrestricted and writing needs the box below.'
	})}
<div class="qz-bar">
	<button type="button" class="az-btn az-btn--primary qz-bar__btn" id="sql-run">${icon('play')}<span>Run</span></button>
	<span class="qz-bar__x"></span>${button('Library', 'temcoTools.sql.queries', { small: true, kind: 'ghost', mark: 'book' })
		+ button('History', 'temcoTools.sql.history', { small: true, kind: 'ghost', mark: 'clock' })}
	<span class="qz-bar__facts">SQLite · ${esc(name)} · schema ${schemaVersion} · ${n(state.history.length, 'statement', 'statements')} run this session</span>
</div>
<label class="qz-writes${state.write ? ' is-on' : ''}" id="sql-writes-bar">
	<input type="checkbox" id="sql-writes"${state.write ? ' checked' : ''} />
	<span class="qz-writes__label">Allow writes</span>
	<span class="qz-writes__note">Reading is always allowed. A statement that changes rows — INSERT, UPDATE, DELETE, DDL — only runs while this is ticked.</span>
</label>
<div class="qz-code" id="sql-code">
	<div class="qz-code__field">
		<pre class="qz-code__view" id="sql-view" aria-hidden="true"></pre>
		<textarea id="sql-editor" class="qz-code__input" spellcheck="false" autocomplete="off" autocapitalize="off"
			aria-label="SQL statement">${esc(state.editor)}</textarea>
	</div>
</div>
${message}
${results}`;
}

/**
 * The bar that both table pages carry: the table's name, its shape, and what can be done with it. Shared, so the two
 * pages cannot drift apart on the one line a reader looks at first.
 */
const TABLE_BAR_CSS = `
.tb-bar { display: flex; align-items: center; gap: 10px; flex-wrap: wrap; margin: 0 0 0;
  padding-bottom: 10px; border-bottom: 1px solid var(--border); }
.tb-bar__title { font-family: var(--vscode-editor-font-family, Consolas, monospace); font-size: 13px; font-weight: 600;
  color: var(--fg-strong); }
.tb-bar__facts { color: var(--fg-subtle); font-size: 12px; font-variant-numeric: tabular-nums; }
.tb-bar__acts { margin-left: auto; display: flex; gap: 6px; flex-wrap: wrap; }
.tb-bar__acts .az-btn { flex: 0 0 auto; white-space: nowrap; }
`;

/** The strip of tables the Data page picks from: it has the width for it, and no room for a column of names. */
const TABLE_STRIP_CSS = `
.tb-strip { display: flex; gap: 6px; flex-wrap: wrap; margin: 18px 0 0; }
.tb-pick { display: inline-flex; align-items: baseline; gap: 7px; padding: 5px 10px; border: 1px solid var(--border);
  border-radius: 0; background: none; color: var(--fg); font: inherit; font-size: 12px; line-height: 17px; cursor: pointer;
  transition: background-color 90ms ease-out, border-color 90ms ease-out; }
.tb-pick:hover { background: color-mix(in srgb, var(--az-blue) 7%, transparent); }
.tb-pick.is-on { background: color-mix(in srgb, var(--az-blue) 12%, transparent); border-color: var(--az-blue);
  color: var(--fg-strong); font-weight: 600; }
.tb-pick__n { color: var(--fg-subtle); font-variant-numeric: tabular-nums; font-weight: 400; }
`;

/**
 * The Data page's own styles: the table strip, then one table's rows at the width of the page.
 *
 * Data has no sidebar on purpose — a browser's job is the grid, and a 260px column of names costs a third of the width
 * for every row. Table Structure keeps one, because there the right-hand side is a wide grid of columns plus a statement,
 * and the list of tables is the thing a reader moves through.
 */
const DATA_CSS = `${TABLE_STRIP_CSS}${TABLE_BAR_CSS}
.az-grid { max-height: calc(100vh - 330px); min-height: 220px; margin-top: 12px; }
@media (max-width: 700px) {
  .az-grid { max-height: none; }
}
`;

/** *Data* — one table's rows at the width of the page, a page of rows at a time. */
function dataBody(
	tables: { name: string; rows: number }[],
	table: string | undefined,
	page: { columns: string[]; rows: unknown[][]; total: number } | undefined,
	offset: number
): string {
	// The strip is how a table is picked: every table, its size, and the one on screen marked. It wraps instead of
	// scrolling sideways, so a table at the end of the list is never hiding behind an edge.
	const strip = tables
		.map((item) => `<button type="button" class="tb-pick${item.name === table ? ' is-on' : ''}" data-command="temcoTools.sql.browse" data-args="${esc(JSON.stringify([item.name]))}"${item.name === table ? ' aria-current="true"' : ''}>${esc(item.name)}<span class="tb-pick__n">${item.rows.toLocaleString('en-US')}</span></button>`)
		.join('');

	const head = page === undefined ? '' : page.columns.map((column) => `<th>${esc(column)}</th>`).join('');
	const body = page === undefined ? '' : page.rows.map((row) => `<tr>${row.map((value) => `<td>${cell(value)}</td>`).join('')}</tr>`).join('');
	const from = offset + 1;
	const to = offset + (page?.rows.length ?? 0);
	const range = page === undefined || page.total === 0
		? 'no rows'
		: `${from.toLocaleString('en-US')}–${to.toLocaleString('en-US')} of ${page.total.toLocaleString('en-US')}`;

	return `${pageHead({
		title: 'Data',
		mark: 'list',
		desc: 'The rows of one table, a page at a time. Read-only here on purpose: a change to a row is a change to what the platform believes, and that belongs in the Query Editor with writes enabled.'
	})}
${tables.length === 0
			? `<div class="mt-16">${callout('The database has no tables yet. Reset it from the <b>Database</b> page to write this build’s schema.', 'warn')}</div>`
			: `<div class="tb-strip" role="group" aria-label="Tables">${strip}</div>
${table === undefined
				? `<div class="mt-16">${callout('Pick a table above.')}</div>`
				: `<div class="tb-bar">
	<span class="tb-bar__title">${esc(table)}</span>
	<span class="tb-bar__facts">${n(page?.columns.length ?? 0, 'column', 'columns')} · ${range}</span>
	<div class="tb-bar__acts">${button('Query it', 'temcoTools.sql.queryTable', { small: true, kind: 'ghost', mark: 'code', args: [table] })
					+ (offset > 0 ? button('Previous', 'temcoTools.sql.page', { small: true, kind: 'ghost', mark: 'chevron-left', args: [-1] }) : '')
					+ (page !== undefined && to < page.total ? button('Next', 'temcoTools.sql.page', { small: true, kind: 'ghost', mark: 'chevron-right', args: [1] }) : '')
					+ button('Structure', 'temcoTools.sql.schema', { small: true, kind: 'ghost', mark: 'list' })}</div>
</div>
${page === undefined
					? callout('The rows could not be read. The file may be locked by another window.')
					: page.total === 0
						? callout('This table is empty. A row appears here when something writes one — a read, a draft, a build or a release.')
						: `<div class="az-grid"><table><thead><tr>${head}</tr></thead><tbody>${body}</tbody></table></div>`}`}`}`;
}

/**
 * *Database* — the file as a maintainer sees it: how big it is, whether it is sound, and the four acts that change it.
 *
 * Row counts live on Schema and Data, where a person is looking at rows. What is here is what maintenance is about:
 * size, log, version drift, integrity — and then the acts, from harmless to final.
 */
function databaseBody(facts: DatabaseFacts): string {
	const drift = facts.schemaVersion !== facts.expected;

	const act = (mark: string, name: string, note: string, action: string, options: { tone?: 'warn' | 'err'; label?: string } = {}): string =>
		`${row({ mark, tone: options.tone, title: name, meta: [note], state: options.tone === undefined ? undefined : 'destructive', actions: button(options.label ?? name, action, { small: true, kind: 'ghost' }) })}`;

	return `${pageHead({
		title: 'Database',
		mark: 'database',
		desc: 'The one SQLite file the platform writes: this window’s memory of projects, sources, pages, drafts, builds and releases. Nothing else connects to it.',
		actions: button('Integrity Check', 'temcoTools.sql.integrity', { kind: 'primary', mark: 'check' }) + button('Open the Folder', 'temcoTools.sql.openFolder', { mark: 'folder' }) + button('Copy Path', 'temcoTools.sql.copyPath', { mark: 'link' })
	})}
${tiles([
			{ value: facts.size, label: 'File on disk' },
			{ value: facts.wal, label: 'Write-ahead log' },
			{ value: String(facts.schemaVersion), label: 'Schema stored' },
			{ value: String(facts.expected), label: 'This build expects' }
		])}
<div class="mt-16">${callout(`The file is <code>${esc(facts.file)}</code> — in this profile’s storage, never in a repository and never in a project folder.`)}</div>
${drift
			? `<div class="mt-16">${callout(`<b>The file and this build disagree.</b> Stored schema ${facts.schemaVersion}, this build writes ${facts.expected}. A reset fixes the shape and forgets the data; reading the sources again is what brings a project back.`, 'warn')}</div>`
			: ''}
<div class="mt-16">${callout(facts.integrity === undefined
				? 'Integrity has not been checked in this window. <b>Integrity Check</b> asks SQLite itself, with <code>quick_check</code> — it reads the pages without the slow index cross-references.'
				: facts.integrity === 'ok'
					? `<b>SQLite says the file is sound.</b> <code>quick_check</code> answered <code>ok</code>${facts.size === '—' ? '' : ` over ${facts.size}`}.`
					: `<b>SQLite reported a problem.</b> <code>${esc(facts.integrity)}</code> — back the file up before anything else, then reset it.`, facts.integrity === undefined || facts.integrity === 'ok' ? 'ok' : 'warn')}</div>
<div class="mt-24">${group({
			label: 'Housekeeping',
			count: '3 acts',
			note: 'None of these changes a row: one returns free space to the disk, one folds the log into the file, one copies the file beside itself.',
			body: act('package', 'Vacuum', 'rebuilds the file so deleted rows stop occupying it', 'temcoTools.sql.vacuum')
				+ act('code', 'Checkpoint', 'folds the write-ahead log into the file', 'temcoTools.sql.checkpoint')
				+ act('download', 'Backup', 'checkpoints, then copies to <code>catalog-backup-&lt;time&gt;.db</code>', 'temcoTools.sql.backup', { label: 'Back Up' })
		})}</div>
<div class="mt-24">${group({
			label: 'Start Over',
			count: '2 acts',
			note: 'Development acts. Both name what they will delete in their confirmation, and neither touches your page files on disk.',
			body: act('alert', 'Empty every table', `${facts.total.toLocaleString('en-US')} rows across ${n(facts.tables.length, 'table', 'tables')} go; the schema stays`, 'temcoTools.sql.clear', { tone: 'warn', label: 'Clear All Data' })
				+ act('alert', 'Reset the database', 'every table is dropped and this build’s schema is written again', 'temcoTools.sql.reset', { tone: 'err', label: 'Reset' })
		})}</div>
<div class="mt-16">${callout('<b>A backup is not a publish.</b> Pages are files, and a cleared catalog does not touch them — it forgets where they were. The only thing that recreates a project is reading its sources again, so back up before starting over.', 'warn')}</div>`;
}

/** *History* — what this window ran, newest first. */
function historyBody(state: StudioState): string {
	const line = (run: RunEntry): string =>
		`${row({ mark: run.ok ? 'check' : 'error', tone: run.ok ? 'ok' : 'err', title: run.sql, meta: [run.at, run.detail], state: run.ok ? 'Ran' : 'Failed', actions: button('Recall', 'temcoTools.sql.recall', { small: true, kind: 'ghost', args: [run.sql] }) })}`;

	return `${pageHead({
		title: 'History',
		mark: 'clock',
		desc: 'Every statement this window has run, newest first. A statement that failed is here too: what the connection would not do is part of the record.',
		actions: button('Clear History', 'temcoTools.sql.clearHistory', { mark: 'close' }) + button('Query Editor', 'temcoTools.sql.query', { kind: 'primary', mark: 'code' })
	})}
${state.history.length === 0
			? `<div class="mt-16">${callout('Nothing has been run in this window yet. The history is per window and is not written anywhere — a statement is a thing that happened, not state.')}</div>`
			: group({ label: 'Statements', count: n(state.history.length, 'statement', 'statements'), body: state.history.map(line).join('') })}`;
}

/**
 * The Table Structure page's own styles: tables on the left, the one picked on the right.
 *
 * The right-hand side is a column grid and a statement — wide content that a reader works through — while the left is a
 * short list a reader moves down. So the list gets its own column and stays put (`position: sticky`) while the columns
 * and the folded DDL scroll beside it. Under 900px the two stack, because a 260px list beside a squeezed grid helps
 * nobody.
 */
const STRUCTURE_CSS = `${TABLE_BAR_CSS}
.ts-split { display: grid; grid-template-columns: 260px minmax(0, 1fr); gap: 26px; align-items: start; margin: 18px 0 0; }
.ts-side { position: sticky; top: 6px; max-height: calc(100vh - 190px); overflow-y: auto; overflow-x: hidden; }
.ts-side__head { display: flex; align-items: baseline; gap: 8px; padding-bottom: 7px; margin-bottom: 6px;
  border-bottom: 1px solid var(--border); }
.ts-side__title { font-size: var(--fs-xs); font-weight: 600; letter-spacing: 0.06em; text-transform: uppercase;
  color: var(--fg-muted); }
.ts-side__head .az-btn { margin-left: auto; }
.ts-list { display: flex; flex-direction: column; gap: 1px; }
.ts-item { display: flex; align-items: baseline; gap: 8px; width: 100%; padding: 6px 8px; border: 0;
  border-radius: 0; background: none; color: var(--fg); font: inherit; font-size: 12px; line-height: 18px;
  text-align: left; cursor: pointer; transition: background-color 90ms ease-out; }
.ts-item:hover { background: color-mix(in srgb, var(--az-blue) 7%, transparent); }
.ts-item.is-on { background: color-mix(in srgb, var(--az-blue) 13%, transparent); color: var(--fg-strong); font-weight: 600; }
.ts-item__name { flex: 1 1 auto; min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap;
  font-family: var(--vscode-editor-font-family, Consolas, monospace); }
.ts-item__n { flex: 0 0 auto; color: var(--fg-subtle); font-variant-numeric: tabular-nums; font-weight: 400; }
.ts-main { min-width: 0; }
.az-grid { max-height: 360px; margin-top: 12px; }
.ts-col { font-family: var(--vscode-editor-font-family, Consolas, monospace); color: var(--fg-strong); }
.ts-key { color: var(--az-blue); font-size: 11px; }
.ts-indexes { margin: 10px 0 0; color: var(--fg-muted); font-size: 12px; line-height: 18px; }
.ts-indexes code { font-family: var(--vscode-editor-font-family, Consolas, monospace); color: var(--fg); }
.ts-ddl { margin: 16px 0 0; }
.ts-ddl > summary { cursor: pointer; color: var(--az-blue); font-size: 12px; line-height: 20px; }
.ts-ddl[open] > summary { margin-bottom: 8px; }
.ts-code { margin: 0; padding: 12px 14px; border: 1px solid var(--border); border-radius: 0; background: var(--editor-bg);
  color: var(--fg); font-family: var(--vscode-editor-font-family, Consolas, monospace); font-size: 12px;
  line-height: 18px; max-height: 220px; overflow: auto; white-space: pre; }
@media (max-width: 900px) {
  .ts-split { grid-template-columns: minmax(0, 1fr); gap: 18px; }
  .ts-side { position: static; max-height: 220px; }
}
`;

/**
 * *Table Structure* — the tables the file has on the left, the one on screen column by column on the right.
 *
 * Two columns, because the two sides are different shapes: a short list of names to move down, and a wide grid of
 * columns plus a statement to read across. The old page had a four-figure strip above both and the `CREATE` statement
 * always open under them; now the counts are in the sentence under the title, and the statement is folded away.
 */
function schemaBody(tables: TableFact[], stored: number, expected: number, selected: string | undefined): string {
	const rows = tables.reduce((total, table) => total + table.rows, 0);
	const table = tables.find((entry) => entry.name === selected) ?? tables[0];

	const list = tables
		.map((entry) => `<button type="button" class="ts-item${entry.name === table?.name ? ' is-on' : ''}" data-command="temcoTools.sql.selectTable" data-args="${esc(JSON.stringify([entry.name]))}"${entry.name === table?.name ? ' aria-current="true"' : ''} title="${esc(entry.name)} — ${n(entry.rows, 'row', 'rows')}, ${n(entry.columns.length, 'column', 'columns')}"><span class="ts-item__name">${esc(entry.name)}</span><span class="ts-item__n">${entry.rows.toLocaleString('en-US')}</span></button>`)
		.join('');

	const head = '<th>Column</th><th>Type</th><th>Null</th><th>Default</th><th>Key</th>';
	const body = table === undefined
		? ''
		: table.columns.map((column) => `<tr>
	<td><span class="ts-col">${esc(column.name)}</span></td>
	<td>${column.type === undefined || column.type.length === 0 ? '<span class="cell-muted">—</span>' : esc(column.type)}</td>
	<td>${column.notNull ? 'not null' : '<span class="cell-muted">null</span>'}</td>
	<td>${column.defaultValue === undefined ? '<span class="cell-muted">—</span>' : esc(String(column.defaultValue))}</td>
	<td>${column.primaryKey ? '<span class="ts-key">primary key</span>' : ''}</td>
</tr>`).join('');

	const detail = table === undefined
		? callout('The database has no tables. Reset it from the <b>Database</b> page to write this build’s schema.', 'warn')
		: `<div class="tb-bar">
	<span class="tb-bar__title">${esc(table.name)}</span>
	<span class="tb-bar__facts">${n(table.columns.length, 'column', 'columns')} · ${n(table.rows, 'row', 'rows')}${table.indexes.length === 0 ? '' : ` · ${n(table.indexes.length, 'index', 'indexes')}`}</span>
	<div class="tb-bar__acts">${button('Browse rows', 'temcoTools.sql.browse', { small: true, kind: 'ghost', mark: 'list', args: [table.name] })
			+ button('Query it', 'temcoTools.sql.queryTable', { small: true, kind: 'ghost', mark: 'code', args: [table.name] })
			+ button('Copy DDL', 'temcoTools.sql.copyDdl', { small: true, kind: 'ghost', mark: 'download', args: [table.name] })}</div>
</div>
<div class="az-grid"><table><thead><tr>${head}</tr></thead><tbody>${body}</tbody></table></div>
<p class="ts-indexes">${table.indexes.length === 0
				? 'No index of its own — the primary key is the only way in.'
				: `Indexes: ${table.indexes.map((index) => `<code>${esc(index)}</code>`).join(', ')}.`}</p>
<details class="ts-ddl"><summary>The statement the file holds</summary>
<pre class="ts-code">${esc(table.sql)};</pre></details>`;

	const side = `<div class="ts-side">
	<div class="ts-side__head"><span class="ts-side__title">Tables</span>${button('Refresh', 'temcoTools.sql.refreshSchema', { small: true, kind: 'ghost', mark: 'refresh' })}</div>
	<div class="ts-list" role="group" aria-label="Tables">${list}</div>
</div>`;

	return `${pageHead({
		title: 'Table Structure',
		mark: 'list',
		desc: `What the database actually has: ${n(tables.length, 'table', 'tables')} and ${rows.toLocaleString('en-US')} rows, column by column. The definition lives in the store’s schema.ts — this is the file, read back.`,
		actions: button('Refresh', 'temcoTools.sql.refreshSchema', { mark: 'refresh' }) + button('Database', 'temcoTools.sql.connections', { mark: 'database' })
	})}
${stored === expected
			? ''
			: `<div class="mt-16">${callout(`<b>The file and this build disagree.</b> The database says schema ${stored}; this build writes schema ${expected}. Rows written since the change may mean something else — reset only if the data can be read again.`, 'warn')}</div>`}
${tables.length === 0
			? `<div class="mt-16">${detail}</div>`
			: `<div class="ts-split">${side}<div class="ts-main">${detail}</div></div>`}`;
}

/**
 * The Query Library's own styles: the built-in statements lie across the page, three or four to a row.
 *
 * They are sentences with a name, not rows to scan down — seven of them in a single column was a column of identical
 * `Load` buttons. Laid across, the whole shelf is visible at once and the eye picks a question rather than a line.
 */
const QUERIES_CSS = `
.qy-grid { display: grid; grid-template-columns: repeat(auto-fit, minmax(260px, 1fr)); gap: 8px; margin-top: 10px; }
.qy-card { display: grid; grid-template-columns: minmax(0, 1fr) auto; gap: 2px 10px; align-items: baseline;
  padding: 10px 12px; border: 1px solid var(--border); border-radius: 0; background: none;
  transition: background-color 90ms ease-out, border-color 90ms ease-out; }
.qy-card:hover { background: color-mix(in srgb, var(--az-blue) 5%, transparent); border-color: var(--az-blue); }
.qy-card__name { font-weight: 600; color: var(--fg-strong); font-size: 13px; line-height: 18px;
  overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.qy-card__load { grid-column: 2; grid-row: 1 / span 2; align-self: center; }
.qy-card__note { grid-column: 1; color: var(--fg-muted); font-size: 12px; line-height: 17px;
  display: -webkit-box; -webkit-line-clamp: 2; -webkit-box-orient: vertical; overflow: hidden; }
@media (max-width: 700px) {
  .qy-grid { grid-template-columns: minmax(0, 1fr); }
}
`;

/**
 * *Query Library* — every statement worth loading twice, in one place: the ones this module writes and the ones you kept.
 *
 * One page, two groups, because they are the same list with the same act: a name, a sentence about what it answers, and
 * `Load`. Splitting them cost a row in the panel and a tab in the strip for no distinction a reader makes. The built-in
 * ones lie across the page; yours stay rows, because a row can carry a Delete and a one-line preview of the statement.
 */
function queriesBody(saved: { name: string; sql: string }[]): string {
	const preset = (entry: Preset): string =>
		`<div class="qy-card"><span class="qy-card__name" title="${esc(entry.name)}">${esc(entry.name)}</span><span class="qy-card__note">${esc(entry.note)}</span>${button('Load', 'temcoTools.sql.loadPreset', { small: true, kind: 'ghost', mark: 'play', args: [entry.name] })}</div>`;
	const mine = (entry: { name: string; sql: string }): string =>
		`${row({ mark: 'book', tone: 'accent', title: entry.name, meta: [entry.sql.replace(/\s+/g, ' ').slice(0, 110)], state: 'yours', actions: button('Load', 'temcoTools.sql.loadSaved', { small: true, kind: 'ghost', args: [entry.name] }) + button('Delete', 'temcoTools.sql.deleteSaved', { small: true, kind: 'danger', args: [entry.name] }) })}`;

	return `${pageHead({
		title: 'Query Library',
		mark: 'book',
		desc: 'Statements worth loading twice: the ones written against the schema this build has, and the ones you kept. Loading one puts it in the editor — nothing on this page runs on its own.'
	})}
<div class="mt-16">${part({ title: 'Built in', count: n(PRESETS.length, 'preset', 'presets'), note: 'Written by this module against the schema this build has. A preset that returns nothing is telling you the schema moved.' })}</div>
<div class="qy-grid">${PRESETS.map(preset).join('')}</div>
<div class="mt-24">${section({ title: 'Yours', desc: saved.length === 0 ? undefined : `${n(saved.length, 'query', 'queries')} · kept in this profile’s settings, not in the database` })}</div>
${saved.length === 0
			? callout('Nothing of your own is saved yet. Write a statement in the <b>Query Editor</b> and press <b>Save This</b> — it appears here, with the same <b>Load</b> as a preset.')
			: entries(saved.map(mine).join(''))}`;
}

/* ------------------------------------------------------------------ what the pages read */

interface DatabaseFacts {
	file: string;
	size: string;
	/** The write-ahead log beside the file, which is where the newest writes are until a checkpoint. */
	wal: string;
	schemaVersion: number;
	/** What this build writes. A difference is what the page warns about. */
	expected: number;
	tables: { name: string; rows: number }[];
	total: number;
	integrity?: string;
}

/** How many rows one page of the Data page shows. */
const PAGE_SIZE = 50;

/** The pages, one panel each, kept open so a second visit reveals the tab rather than stacking another. */
export class SqlPages {
	private readonly panels = new Map<string, vscode.WebviewPanel>();
	private readonly state: StudioState;

	constructor(private readonly context: vscode.ExtensionContext) {
		this.state = {
			editor: 'SELECT * FROM documents;',
			write: false,
			history: [],
			offset: 0,
		};
	}

	async open(id: string, restored?: vscode.WebviewPanel): Promise<void> {
		const definition = SQL_PAGES.find((entry) => entry.id === id);
		if (definition === undefined) {
			return;
		}
		const html = await this.render(definition);
		const existing = this.panels.get(id);
		if (existing) {
			existing.reveal(pageColumn());
			existing.webview.html = html;
			return;
		}

		// A restored tab is drawn into rather than replaced: it keeps its place in the strip.
		const panel = restored ?? vscode.window.createWebviewPanel(definition.viewType, definition.label, pageColumn(), {
			enableScripts: true,
			localResourceRoots: [],
		});
		panel.webview.options = { enableScripts: true, localResourceRoots: [] };
		panel.iconPath = vscode.Uri.joinPath(this.context.extensionUri, 'media', 'sql.svg');
		panel.webview.html = html;
		panel.webview.onDidReceiveMessage((message: PageMessage) => this.receive(message));
		this.panels.set(id, panel);
		panel.onDidDispose(() => this.panels.delete(id));
	}

	/** Redraw every open page: a statement in one changes what another shows. */
	async refresh(): Promise<void> {
		for (const [id, panel] of this.panels) {
			const definition = SQL_PAGES.find((entry) => entry.id === id);
			if (definition !== undefined) {
				panel.webview.html = await this.render(definition);
			}
		}
	}

	dispose(): void {
		for (const panel of this.panels.values()) {
			panel.dispose();
		}
		this.panels.clear();
	}

	/** The statement the editor holds, for the commands that act on it. */
	get editor(): string {
		return this.state.editor;
	}

	/** The last result, for the acts that keep it: saving a file, or reading it again. */
	lastResult(): { sql: string; result: SqlResult } | undefined {
		return this.state.last;
	}

	/** Put a statement in the editor and show it. */
	async load(sql: string): Promise<void> {
		this.state.editor = sql;
		await this.open('query');
	}

	/** Run one statement, remember what happened, and redraw. */
	async run(sql: string, write: boolean): Promise<void> {
		this.state.editor = sql;
		this.state.write = write;
		let catalog: Catalog | undefined;
		try {
			catalog = await Catalog.open(this.context);
			const result = catalog.query(sql, { write });
			this.state.last = { sql, result };
			this.state.error = undefined;
			this.state.history.unshift({
				at: new Date().toISOString().slice(11, 19),
				sql: sql.replace(/\s+/g, ' ').trim(),
				ok: true,
				detail: result.readOnly ? `${n(result.rows.length, 'row', 'rows')} · ${result.ms} ms` : `${n(result.changes ?? 0, 'row changed', 'rows changed')} · ${result.ms} ms`,
				rows: result.rows.length,
				ms: result.ms,
			});
		} catch (error) {
			const message = error instanceof Error ? error.message : String(error);
			this.state.last = undefined;
			this.state.error = { sql, message };
			this.state.history.unshift({
				at: new Date().toISOString().slice(11, 19),
				sql: sql.replace(/\s+/g, ' ').trim(),
				ok: false,
				detail: message,
				rows: 0,
				ms: 0,
			});
		} finally {
			catalog?.close();
		}
		await this.refresh();
	}

	/** One message from a page: a statement typed into the editor, or a button the shared script did not take. */
	private receive(message: PageMessage): void {
		if (message.type === 'sql' && typeof message.sql === 'string') {
			void this.run(message.sql, message.write === true);
			return;
		}
		if (message.type === 'command' && typeof message.command === 'string') {
			const args = Array.isArray(message.args) ? message.args : message.args === undefined ? [] : [message.args];
			void vscode.commands.executeCommand(message.command, ...args);
		}
	}

	/** The saved queries, which live in this profile rather than in the database. */
	saved(): { name: string; sql: string }[] {
		return this.context.workspaceState.get<{ name: string; sql: string }[]>('temcoTools.sql.saved', []);
	}

	async save(name: string, sql: string): Promise<void> {
		const kept = this.saved().filter((entry) => entry.name !== name);
		kept.push({ name, sql });
		await this.context.workspaceState.update('temcoTools.sql.saved', kept);
		await this.refresh();
	}

	async forget(name: string): Promise<void> {
		await this.context.workspaceState.update(
			'temcoTools.sql.saved',
			this.saved().filter((entry) => entry.name !== name)
		);
		await this.refresh();
	}

	/** Which table the Schema page has open. */
	async selectTable(name: string): Promise<void> {
		this.state.schemaTable = name;
		await this.open('schema');
	}

	/** The last `quick_check` answer, kept so the Database page can print it. */
	setIntegrity(answer: string): void {
		this.state.integrity = answer;
	}

	/** What the Data page is showing, and where in it. */
	async browse(table: string): Promise<void> {
		this.state.table = table;
		this.state.offset = 0;
		await this.open('data');
	}

	/** One page forward or back in the table on the Data page. */
	async turn(delta: number): Promise<void> {
		this.state.offset = Math.max(0, this.state.offset + delta * PAGE_SIZE);
		await this.open('data');
	}

	clearHistory(): void {
		this.state.history = [];
	}

	historyCount(): number {
		return this.state.history.length;
	}

	/** Everything a page needs to draw itself, read from the one open handle. */
	private async facts(): Promise<DatabaseFacts> {
		let catalog: Catalog | undefined;
		const facts: DatabaseFacts = {
			file: '',
			size: '—',
			wal: '—',
			schemaVersion: 0,
			expected: 0,
			tables: [],
			total: 0,
			integrity: this.state.integrity,
		};
		try {
			catalog = await Catalog.open(this.context);
			facts.file = catalog.file.fsPath;
			facts.schemaVersion = catalog.schemaVersion();
			facts.expected = catalog.expectedSchemaVersion();
			facts.tables = catalog.tables();
			facts.total = facts.tables.reduce((total, table) => total + table.rows, 0);
			const sizes = catalog.sizes();
			facts.size = sizes.file === undefined ? 'not created yet' : bytes(sizes.file);
			facts.wal = sizes.wal === undefined ? 'none' : bytes(sizes.wal);
		} catch (error) {
			facts.file = error instanceof Error ? error.message : String(error);
		} finally {
			catalog?.close();
		}
		return facts;
	}

	private async render(definition: SqlPage): Promise<string> {
		const facts = await this.facts();
		switch (definition.id) {
			case 'query':
				return page(queryBody(this.state, facts.schemaVersion, facts.file), {
					title: definition.label,
					script: EDITOR_SCRIPT,
					extraCss: QUERY_CSS,
				});
			case 'connections':
				return shell(definition, databaseBody(facts));
			case 'data': {
				let catalog: Catalog | undefined;
				let page: { columns: string[]; rows: unknown[][]; total: number } | undefined;
				const table = this.state.table ?? facts.tables[0]?.name;
				try {
					catalog = await Catalog.open(this.context);
					page = table === undefined ? undefined : catalog.rows(table, PAGE_SIZE, this.state.offset);
				} catch {
					page = undefined;
				} finally {
					catalog?.close();
				}
				return shell(definition, dataBody(facts.tables, table, page, this.state.offset), DATA_CSS);
			}
			case 'history':
				return shell(definition, historyBody(this.state));
			case 'schema': {
				let catalog: Catalog | undefined;
				let tables: TableFact[] = [];
				try {
					catalog = await Catalog.open(this.context);
					tables = catalog.tables();
				} catch {
					tables = [];
				} finally {
					catalog?.close();
				}
				return shell(definition, schemaBody(tables, facts.schemaVersion, facts.expected, this.state.schemaTable), STRUCTURE_CSS);
			}
			case 'queries':
			case 'reports':
			case 'saved':
				return shell(definition, queriesBody(this.saved()), QUERIES_CSS);
			default:
				return shell(definition, queriesBody(this.saved()), QUERIES_CSS);
		}
	}
}

function shell(definition: SqlPage, body: string, extraCss?: string): string {
	return page(body, { title: definition.label, script: commandScript, extraCss });
}

/** A file size, the way a person reads one. */
function bytes(size: number): string {
	if (size < 1024) {
		return `${size} B`;
	}
	if (size < 1024 * 1024) {
		return `${(size / 1024).toFixed(1)} KB`;
	}
	return `${(size / (1024 * 1024)).toFixed(1)} MB`;
}

/**
 * The last result as CSV.
 *
 * Quoted properly rather than joined on commas: a cell can hold a comma, a quote or a newline — documentation text
 * does all three — and a file that silently shifts its columns is worse than no file.
 */
async function writeCsv(file: vscode.Uri, result: SqlResult): Promise<void> {
	const line = (values: readonly unknown[]): string => values.map(quoteCsv).join(',');
	const text = [line(result.columns), ...result.rows.map((row) => line(row))].join('\r\n') + '\r\n';
	await vscode.workspace.fs.writeFile(file, new TextEncoder().encode(text));
}

function quoteCsv(value: unknown): string {
	if (value === null || value === undefined) {
		return '';
	}
	const text = typeof value === 'object' ? JSON.stringify(value) : String(value);
	return /[",\r\n]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
}

/* ------------------------------------------------------------------ the commands */

/**
 * Register everything the studio owns.
 *
 * The destructive acts confirm twice: a modal that names what will go, and — for a reset — a typed word, because a
 * mis-click on a table row should not be able to delete every project the platform knows.
 */
export function registerSql(context: vscode.ExtensionContext): { pages: SqlPages; disposables: vscode.Disposable[] } {
	const pages = new SqlPages(context);

	/** Where a backup goes: beside the database, named for the minute it was taken. */
	const backupPath = async (): Promise<{ from: vscode.Uri; to: vscode.Uri } | undefined> => {
		let catalog: Catalog | undefined;
		try {
			catalog = await Catalog.open(context);
			const from = catalog.file;
			const stamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
			return { from, to: vscode.Uri.joinPath(from, '..', `catalog-backup-${stamp}.db`) };
		} catch {
			return undefined;
		} finally {
			catalog?.close();
		}
	};

	const commands: vscode.Disposable[] = [
		...SQL_PAGES.map((definition) =>
			vscode.commands.registerCommand(definition.command, () => pages.open(definition.id))
		),
		// The two pages that became one: their commands still open the merged page, so an old keybinding, a menu item or
		// a restored tab keeps working.
		vscode.commands.registerCommand('temcoTools.sql.reports', () => pages.open('queries')),
		vscode.commands.registerCommand('temcoTools.sql.saved', () => pages.open('queries')),

		// ---- Query Editor
		vscode.commands.registerCommand('temcoTools.sql.run', () => pages.run(pages.editor, false)),
		vscode.commands.registerCommand('temcoTools.sql.runWrite', () => pages.run(pages.editor, true)),
		vscode.commands.registerCommand('temcoTools.sql.loadSaved', async (name?: unknown) => {
			const entry = pages.saved().find((candidate) => candidate.name === String(name));
			if (entry !== undefined) {
				await pages.load(entry.sql);
			}
		}),
		vscode.commands.registerCommand('temcoTools.sql.loadPreset', async (name?: unknown) => {
			const preset = PRESETS.find((candidate) => candidate.name === String(name));
			if (preset !== undefined) {
				await pages.load(preset.sql);
			}
		}),
		vscode.commands.registerCommand('temcoTools.sql.saveQuery', async () => {
			const name = await vscode.window.showInputBox({
				title: 'Save a Query',
				prompt: 'A name for the statement the editor is holding',
				placeHolder: 'Drafts waiting',
				value: '',
			});
			if (name === undefined || name.trim().length === 0) {
				return;
			}
			await pages.save(name.trim(), pages.editor);
			void vscode.window.showInformationMessage(`Temco SQL: “${name.trim()}” saved in this profile.`);
		}),
		vscode.commands.registerCommand('temcoTools.sql.deleteSaved', async (name?: unknown) => {
			const answer = await vscode.window.showWarningMessage(
				`Delete the saved query “${String(name)}”?`,
				{ modal: true },
				'Delete'
			);
			if (answer === 'Delete') {
				await pages.forget(String(name));
			}
		}),
		vscode.commands.registerCommand('temcoTools.sql.clearHistory', () => {
			pages.clearHistory();
			void pages.refresh();
		}),
		vscode.commands.registerCommand('temcoTools.sql.recall', (sql?: unknown) => pages.load(String(sql))),
		// A table's rows are read-only here; asking the editor for them is one click, and the editor can go further.
		vscode.commands.registerCommand('temcoTools.sql.queryTable', (table?: unknown) =>
			pages.load(`SELECT * FROM "${String(table).replace(/"/g, '""')}" LIMIT 100;`)
		),
		// The result as a file: a query answered once is often a question asked again elsewhere.
		vscode.commands.registerCommand('temcoTools.sql.export', async () => {
			const last = pages.lastResult();
			if (last === undefined) {
				void vscode.window.showWarningMessage('Temco SQL: nothing has been run yet, so there is no result to export.');
				return;
			}
			const files = await backupPath();
			const stamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
			const target = await vscode.window.showSaveDialog({
				defaultUri: files === undefined
					? vscode.Uri.file(`query-${stamp}.csv`)
					: vscode.Uri.joinPath(files.from, '..', `query-${stamp}.csv`),
				filters: { CSV: ['csv'] },
				saveLabel: 'Export CSV',
			});
			if (target === undefined) {
				return;
			}
			try {
				await writeCsv(target, last.result);
				void vscode.window.showInformationMessage(
					`Temco SQL: ${n(last.result.rows.length, 'row', 'rows')} exported to ${target.fsPath}`
				);
			} catch (error) {
				void vscode.window.showErrorMessage(
					`Temco SQL: the export failed — ${error instanceof Error ? error.message : String(error)}`
				);
			}
		}),
		// The statement as text, and the rows as tab-separated text: not every use of an answer is a file, and the
		// clipboard is the shorter way into a spreadsheet or a commit message.
		vscode.commands.registerCommand('temcoTools.sql.copySql', async () => {
			const sql = pages.editor.trim();
			if (sql.length === 0) {
				void vscode.window.showWarningMessage('Temco SQL: the editor is empty, so there is no statement to copy.');
				return;
			}
			await vscode.env.clipboard.writeText(sql);
			vscode.window.setStatusBarMessage('Temco SQL: the statement is on the clipboard.', 4000);
		}),
		vscode.commands.registerCommand('temcoTools.sql.copyResult', async () => {
			const last = pages.lastResult();
			if (last === undefined) {
				void vscode.window.showWarningMessage('Temco SQL: nothing has been run yet, so there are no rows to copy.');
				return;
			}
			if (!last.result.readOnly || last.result.columns.length === 0) {
				void vscode.window.showWarningMessage('Temco SQL: the last statement returned no table, so there is nothing to copy.');
				return;
			}
			const line = (cells: readonly unknown[]): string =>
				cells.map((value) => (value === null || value === undefined ? '' : String(value).replace(/[\t\r\n]+/g, ' '))).join('\t');
			const text = [line(last.result.columns), ...last.result.rows.map(line)].join('\r\n');
			await vscode.env.clipboard.writeText(text);
			vscode.window.setStatusBarMessage(
				`Temco SQL: ${n(last.result.rows.length, 'row', 'rows')} on the clipboard, tab-separated.`,
				4000
			);
		}),
		// ---- Data
		vscode.commands.registerCommand('temcoTools.sql.browse', (table?: unknown) => pages.browse(String(table))),
		vscode.commands.registerCommand('temcoTools.sql.page', (delta?: unknown) => pages.turn(Number(delta) || 1)),
		vscode.commands.registerCommand('temcoTools.sql.refreshSchema', () => pages.refresh()),
		// ---- Schema
		vscode.commands.registerCommand('temcoTools.sql.selectTable', (name?: unknown) => pages.selectTable(String(name))),
		vscode.commands.registerCommand('temcoTools.sql.copyDdl', async (name?: unknown) => {
			let catalog: Catalog | undefined;
			try {
				catalog = await Catalog.open(context);
				const table = catalog.tables().find((entry) => entry.name === String(name));
				if (table !== undefined && table.sql.length > 0) {
					await vscode.env.clipboard.writeText(`${table.sql};`);
					vscode.window.setStatusBarMessage(`Temco SQL: the statement for ${table.name} is on the clipboard.`, 4000);
				}
			} catch {
				// Nothing to copy: the Clipboard stays as it was.
			} finally {
				catalog?.close();
			}
		}),
		// SQLite's own answer, asked on demand rather than on every draw: it reads pages.
		vscode.commands.registerCommand('temcoTools.sql.integrity', async () => {
			let catalog: Catalog | undefined;
			let answer = 'not checked';
			try {
				catalog = await Catalog.open(context);
				answer = catalog.integrity();
			} catch (error) {
				answer = error instanceof Error ? error.message : String(error);
			} finally {
				catalog?.close();
			}
			pages.setIntegrity(answer);
			await pages.refresh();
			if (answer === 'ok') {
				void vscode.window.showInformationMessage('Temco SQL: the file is sound — quick_check answered ok.');
			} else {
				void vscode.window.showWarningMessage(`Temco SQL: quick_check reported “${answer}”. Back the file up before anything else.`);
			}
		}),

		// ---- Database
		vscode.commands.registerCommand('temcoTools.sql.openFolder', async () => {
			const files = await backupPath();
			if (files !== undefined) {
				await vscode.commands.executeCommand('revealFileInOS', files.from);
			}
		}),
		vscode.commands.registerCommand('temcoTools.sql.copyPath', async () => {
			const files = await backupPath();
			if (files !== undefined) {
				await vscode.env.clipboard.writeText(files.from.fsPath);
				vscode.window.setStatusBarMessage('Database path copied.', 3000);
			}
		}),
		...(['vacuum', 'checkpoint'] as const).map((action) =>
			vscode.commands.registerCommand(`temcoTools.sql.${action}`, async () => {
				await maintain(context, action);
				await pages.refresh();
			})
		),
		vscode.commands.registerCommand('temcoTools.sql.backup', async () => {
			const files = await backupPath();
			if (files === undefined) {
				void vscode.window.showWarningMessage('Temco SQL: the database could not be opened, so nothing was copied.');
				return;
			}
			try {
				// The log is folded in first, so the copy is the database as it stands rather than as it was a
				// checkpoint ago.
				await maintain(context, 'checkpoint');
				await vscode.workspace.fs.copy(files.from, files.to, { overwrite: true });
				const answer = await vscode.window.showInformationMessage(
					`Temco SQL: backed up to ${files.to.fsPath}`,
					'Show the Folder'
				);
				if (answer === 'Show the Folder') {
					await vscode.commands.executeCommand('revealFileInOS', files.to);
				}
			} catch (error) {
				void vscode.window.showErrorMessage(
					`Temco SQL: the backup failed — ${error instanceof Error ? error.message : String(error)}`
				);
			}
		}),
		vscode.commands.registerCommand('temcoTools.sql.clear', async () => {
			const summary = await databaseSummary(context);
			const answer = await vscode.window.showWarningMessage(
				'Empty every table?',
				{
					modal: true,
					detail:
						`${summary.rows.toLocaleString('en-US')} rows across ${n(summary.tables, 'table', 'tables')} are deleted: projects, sources, pages, drafts, builds, artifacts, releases and events. ` +
						'The schema stays, and the pages themselves are files that are not touched — the platform forgets where they were.',
				},
				'Empty Everything'
			);
			if (answer !== 'Empty Everything') {
				return;
			}
			const detail = await maintain(context, 'clear');
			await pages.refresh();
			void vscode.window.showInformationMessage(`Temco SQL: ${detail}.`);
		}),
		vscode.commands.registerCommand('temcoTools.sql.reset', async () => {
			const word = await vscode.window.showInputBox({
				title: 'Reset the database',
				prompt: `This drops all ${(await databaseSummary(context)).tables} tables and writes this build’s schema from scratch. Type reset to continue.`,
				placeHolder: 'reset',
				validateInput: (value) => (value === 'reset' ? undefined : 'Type “reset” exactly, or cancel.'),
			});
			if (word !== 'reset') {
				return;
			}
			const detail = await maintain(context, 'reset');
			await pages.refresh();
			void vscode.window.showInformationMessage(`Temco SQL: ${detail}.`);
		}),
	];

	return { pages, disposables: commands };
}

/** How much is in the database, for a confirmation that should say what it destroys. */
async function databaseSummary(context: vscode.ExtensionContext): Promise<{ tables: number; rows: number }> {
	let catalog: Catalog | undefined;
	try {
		catalog = await Catalog.open(context);
		const tables = catalog.tables();
		return { tables: tables.length, rows: tables.reduce((total, table) => total + table.rows, 0) };
	} catch {
		return { tables: 0, rows: 0 };
	} finally {
		catalog?.close();
	}
}

/** Run one maintenance act and say what it did — or what went wrong, in the same breath. */async function maintain(
	context: vscode.ExtensionContext,
	action: 'vacuum' | 'checkpoint' | 'clear' | 'reset'
): Promise<string> {
	let catalog: Catalog | undefined;
	try {
		catalog = await Catalog.open(context);
		return catalog.maintain(action);
	} catch (error) {
		const message = error instanceof Error ? error.message : String(error);
		void vscode.window.showErrorMessage(`Temco SQL: that did not work — ${message}`);
		return message;
	} finally {
		catalog?.close();
	}
}
