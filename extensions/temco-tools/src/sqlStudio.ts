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
import * as kit from './pageKit';
import { PageMessage, commandScript, esc, icon, page, pageColumn } from './ui';

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
	{ id: 'reports', label: 'Presets', note: 'statements that answer a question worth asking', mark: 'graph', command: 'temcoTools.sql.reports', viewType: 'temcoTools.sql.reports', group: 'rows' },
	{ id: 'saved', label: 'Saved Queries', note: 'the questions worth asking more than once', mark: 'book', command: 'temcoTools.sql.saved', viewType: 'temcoTools.sql.saved', group: 'rows' },
	{ id: 'history', label: 'History', note: 'what was run in this window, newest first', mark: 'clock', command: 'temcoTools.sql.history', viewType: 'temcoTools.sql.history', group: 'rows' },
	{ id: 'schema', label: 'Schema', note: 'the tables the file actually has', mark: 'list', command: 'temcoTools.sql.schema', viewType: 'temcoTools.sql.schema', group: 'file' },
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

// The vocabulary is the application's (`pageKit.ts`, on `temco-ui`'s kit), plus the four primitives a query surface
// needs and a page of prose does not: a grid of rows, a toolbar over a statement, the editor itself, and the one line
// that says what the last run did. Those live in the kit's stylesheet as `az-grid`, `az-toolbar`, `az-editor` and
// `az-message` — the Data page and the Query Editor draw the same table, so they use the same rules.
const { button: kitButton, entries, entry: row, figures, head, n, notice, part } = kit;

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

/** The page's title block, with the studio named above it. */
const pageHead = (options: { title: string; mark: string; desc: string; actions: string }): string =>
	head({
		studio: 'SQL',
		title: options.title,
		mark: options.mark,
		desc: options.desc,
		actions: actionsOf(options.actions)
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

/** One part of a page: its heading, the count and sentence under it, and what can be done from here. */
const rule = (options: { label: string; count?: string; note?: string; actions?: string; plain?: boolean }): string =>
	part({ title: options.label, count: options.count, note: options.note, actions: options.actions });

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
	const writes = document.getElementById('sql-writes');
	const runButton = document.getElementById('sql-run');
	if (!editor || !runButton) {
		return;
	}
	const run = () => api.postMessage({ type: 'sql', sql: editor.value, write: !!(writes && writes.checked) });
	runButton.addEventListener('click', run);
	editor.addEventListener('keydown', (event) => {
		if (event.key === 'Enter' && (event.ctrlKey || event.metaKey)) {
			event.preventDefault();
			run();
		}
	});
	editor.focus();
	editor.setSelectionRange(editor.value.length, editor.value.length);
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
/* The grid, the editor, the toolbar and the message line are the kit's own (az-grid, az-editor, az-toolbar,
   az-message). Only what is this page's remains here: the result bar above the grid, and the height the grid is
   allowed before it scrolls inside the page. */
.sql-result-head { display: flex; align-items: center; gap: 10px; margin: 20px 0 8px; }
.sql-result-head__title { font-size: var(--fs-xs); font-weight: 600; letter-spacing: 0.06em; text-transform: uppercase; color: var(--fg-muted); }
.sql-result-head__facts { color: var(--fg-subtle); font-size: 12px; }
.sql-result-head__actions { margin-left: auto; display: flex; gap: 6px; }
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
		: `<div class="sql-result-head">
	<span class="sql-result-head__title">Results</span>
	<span class="sql-result-head__facts">${n(last.result.rows.length > 0 ? last.result.rows.length : last.result.columns.length, last.result.rows.length > 0 ? 'row' : 'column', last.result.rows.length > 0 ? 'rows' : 'columns')}${last.result.truncated ? ' (truncated)' : ''}</span>
	<div class="sql-result-head__actions">${button('Save This', 'temcoTools.sql.saveQuery', { small: true, kind: 'ghost' })}${button('Export CSV', 'temcoTools.sql.export', { small: true, kind: 'ghost', mark: 'download' })}</div>
</div>
${resultTable(last.result)}`;

	return `${pageHead({
		title: 'Query Editor',
		mark: 'code',
		desc: 'One statement against the platform database. Ctrl+Enter runs it; reading is unrestricted and writing needs the checkbox.',
		actions: button('Presets', 'temcoTools.sql.reports', { mark: 'graph' }) + button('History', 'temcoTools.sql.history', { mark: 'clock' })
	})}
<div class="az-toolbar">
	<button type="button" class="az-btn az-btn--primary" id="sql-run">${icon('play')}<span>Run</span></button>
	<label class="az-check" style="font-size:12px"><input type="checkbox" id="sql-writes"${state.write ? ' checked' : ''} /><span>Allow writes</span></label>
	<span class="az-toolbar__facts">SQLite · ${esc(name)} · schema ${schemaVersion} · ${n(state.history.length, 'statement', 'statements')} run this session</span>
</div>
<textarea id="sql-editor" class="az-editor" spellcheck="false">${esc(state.editor)}</textarea>
${message}
${results}`;
}

/** The Data page's own layout: two columns that scroll inside themselves. */
const DATA_CSS = `
/* The page is the window: the head keeps its height and the two columns take everything under it, so neither
   the page nor the area below the table scrolls. */
body { min-height: 100vh; display: flex; flex-direction: column; }
.view { flex: 1 1 auto; min-height: 0; display: flex; flex-direction: column; }
.view__inner { flex: 1 1 auto; min-height: 0; display: flex; flex-direction: column; padding-bottom: 14px; }
.data-split { flex: 1 1 auto; min-height: 0; display: grid;
	grid-template-columns: 260px minmax(0, 1fr); gap: 28px; align-items: stretch; }
.data-side { min-height: 0; overflow-y: auto; overflow-x: hidden; }
.data-main { min-width: 0; min-height: 0; display: flex; flex-direction: column; }
/* One head height for both columns, so the table list and the rows begin on the same line. */
.data-split .group-head,
.data-split .group-head:first-of-type { min-height: 26px; margin: 0 0 8px; }
	text-align: left; white-space: nowrap; }
	background: var(--vscode-editorWidget-background, rgba(127, 127, 127, 0.10)); }
@media (max-width: 900px) {
	.data-split { grid-template-columns: minmax(0, 1fr); grid-template-rows: 240px minmax(0, 1fr); }
}
`;

/** *Data* — one table at a time, a page of rows at a time, in two columns that scroll on their own. */
function dataBody(
	tables: { name: string; rows: number }[],
	table: string | undefined,
	page: { columns: string[]; rows: unknown[][]; total: number } | undefined,
	offset: number
): string {
	const picker = tables
		.map((item) => row({
			mark: 'list',
			tone: row.name === table ? 'accent' : undefined,
			title: item.name,
			meta: [`${item.rows.toLocaleString('en-US')} rows`],
			actions: button('Query', 'temcoTools.sql.queryTable', { small: true, kind: 'ghost', args: [item.name] }),
			state: item.name === table ? 'showing' : 'open'
		}))
		.join('');

	const head = page === undefined ? '' : page.columns.map((column) => `<th>${esc(column)}</th>`).join('');
	const body = page === undefined ? '' : page.rows.map((row) => `<tr>${row.map((value) => `<td>${cell(value)}</td>`).join('')}</tr>`).join('');
	const from = offset + 1;
	const to = offset + (page?.rows.length ?? 0);

	return `${pageHead({
		title: 'Data',
		mark: 'list',
		desc: 'The rows of one table, a page at a time. Read-only here on purpose: a change to a row is a change to what the platform believes, and that belongs in the Query Editor with writes enabled.',
		actions: button('Query Editor', 'temcoTools.sql.query', { kind: 'primary', mark: 'code' })
			+ button('Schema', 'temcoTools.sql.schema', { mark: 'list' })
			+ button('Reset Database', 'temcoTools.sql.reset', { kind: 'danger', mark: 'alert', title: 'Drop every table and write this build’s schema again' })
	})}
${tables.length === 0
			? `<div class="mt-16">${callout('The database has no tables yet. Reset it with <b>Reset Database</b> to write this build’s schema.', 'warn')}</div>`
			: `<div class="data-split mt-16">
<div class="data-side">${group({ label: 'Tables', count: n(tables.length, 'table', 'tables'), actions: button('Refresh', 'temcoTools.sql.data', { small: true, kind: 'ghost', mark: 'refresh' }), body: picker })}</div>
<div class="data-main">${page === undefined || table === undefined
				? callout('Pick a table on the left.')
				: `${rule({
					label: table,
					count: page.total === 0 ? 'no rows' : `${from.toLocaleString('en-US')}–${to.toLocaleString('en-US')} of ${page.total.toLocaleString('en-US')}`,
					// Query is unconditional on purpose: a header with buttons and one without are different
					// heights, and the two columns must start their rows on the same line.
					actions: button('Query', 'temcoTools.sql.queryTable', { small: true, kind: 'ghost', mark: 'code', args: [table] })
						+ (offset > 0 ? button('Previous', 'temcoTools.sql.page', { small: true, kind: 'ghost', args: [-1] }) : '')
						+ (to < page.total ? button('Next', 'temcoTools.sql.page', { small: true, kind: 'ghost', args: [1] }) : '')
				})}
${page.total === 0
					? callout('This table is empty. A row appears here when something writes one — a read, a draft, a build or a release.')
					: `<div class="az-grid"><table><thead><tr>${head}</tr></thead><tbody>${body}</tbody></table></div>`}`}</div>
</div>`}`;
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
		actions: button('Integrity Check', 'temcoTools.sql.integrity', { kind: 'primary', mark: 'check' }) + button('Open the Folder', 'temcoTools.sql.openFolder', { mark: 'folder' }) + button('Copy Path', 'temcoTools.sql.copyPath', { mark: 'copy' })
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
 * *Schema* — the tables the file has, one at a time.
 *
 * A wall of every table with every column is unreadable at fourteen tables. This is the same shape as Data: an index
 * on the left, and the thing you picked on the right, with the acts that make maintaining it possible — look at the
 * rows, ask a question, copy the statement that created it.
 */
function schemaBody(tables: TableFact[], stored: number, expected: number, selected: string | undefined): string {
	const rows = tables.reduce((total, table) => total + table.rows, 0);
	const table = tables.find((entry) => entry.name === selected) ?? tables[0];

	const picker = tables
		.map((entry) => `${row({ mark: 'list', tone: entry.name === table?.name ? 'accent' : undefined, title: entry.name, meta: [n(entry.columns.length, 'column', 'columns'), entry.indexes.length > 0 ? n(entry.indexes.length, 'index', 'indexes') : undefined, `${entry.rows.toLocaleString('en-US')} rows`], state: entry.name === table?.name ? 'showing' : 'open', actions: button('Open', 'temcoTools.sql.selectTable', { small: true, kind: 'ghost', args: [entry.name] }) })}`)
		.join('');

	const columnRow = (column: TableFact['columns'][number]): string =>
		`${row({ mark: 'code', tone: column.primaryKey ? 'accent' : undefined, title: column.name, meta: [column.type || 'no type', column.primaryKey ? 'primary key' : undefined, column.notNull ? 'not null' : undefined, column.defaultValue === undefined ? undefined : `default ${column.defaultValue}`] })}`;

	const detail = table === undefined
		? callout('The database has no tables. Reset it from the <b>Database</b> page to write this build’s schema.', 'warn')
		: `${rule({
			label: table.name,
			count: `${table.rows.toLocaleString('en-US')} rows · ${n(table.columns.length, 'column', 'columns')}`,
			actions: button('Data', 'temcoTools.sql.browse', { small: true, kind: 'ghost', mark: 'list', args: [table.name] })
				+ button('Query', 'temcoTools.sql.queryTable', { small: true, kind: 'ghost', mark: 'code', args: [table.name] })
				+ button('Copy DDL', 'temcoTools.sql.copyDdl', { small: true, kind: 'ghost', mark: 'copy', args: [table.name] })
		})}
<div class="record-list">${table.columns.map(columnRow).join('')}</div>
<p class="group-note">${table.indexes.length === 0 ? 'No index of its own — the primary key is the only way in.' : `Indexes: ${table.indexes.join(', ')}.`}</p>
<div class="mt-16">${callout(`<b>As written.</b> This is the statement the file holds, which is what a copy of the database would need to be rebuilt from.`)}</div>
<pre class="code" style="max-height:220px">${esc(table.sql)}</pre>`;

	return `${pageHead({
		title: 'Schema',
		mark: 'list',
		desc: `What the database actually has: ${n(tables.length, 'table', 'tables')}, ${rows.toLocaleString('en-US')} rows. The definition lives in the store’s schema.ts — this is the file, read back.`,
		actions: button('Refresh', 'temcoTools.sql.refreshSchema', { mark: 'refresh' }) + button('Database', 'temcoTools.sql.connections', { mark: 'database' })
	})}
${tiles([
			{ value: String(tables.length), label: 'Tables' },
			{ value: rows.toLocaleString('en-US'), label: 'Rows' },
			{ value: String(stored), label: 'Schema stored' },
			{ value: String(expected), label: 'This build expects' }
		])}
${stored === expected
			? ''
			: `<div class="mt-16">${callout(`<b>The file and this build disagree.</b> The database says schema ${stored}; this build writes schema ${expected}. Rows written since the change may mean something else — reset only if the data can be read again.`, 'warn')}</div>`}
${tables.length === 0
			? `<div class="mt-16">${detail}</div>`
			: `<div class="split mt-24" style="grid-template-columns: 300px minmax(0, 1fr); gap: 28px; align-items: start">
<div>${group({ label: 'Tables', count: n(tables.length, 'table', 'tables'), actions: button('Refresh', 'temcoTools.sql.refreshSchema', { small: true, kind: 'ghost', mark: 'refresh' }), body: picker })}</div>
<div>${detail}</div>
</div>`}`;
}

/** *Saved Queries* — kept in this profile, and nothing pretends they are more than that. */
function savedBody(saved: { name: string; sql: string }[]): string {
	const line = (savedQuery: { name: string; sql: string }): string =>
		`${row({ mark: 'book', tone: 'accent', title: savedQuery.name, meta: [savedQuery.sql.replace(/\s+/g, ' ').slice(0, 110)], actions: button('Load', 'temcoTools.sql.loadSaved', { small: true, kind: 'ghost', args: [savedQuery.name] }) + button('Delete', 'temcoTools.sql.deleteSaved', { small: true, kind: 'danger', args: [savedQuery.name] }) })}`;

	return `${pageHead({
		title: 'Saved Queries',
		mark: 'book',
		desc: 'Statements kept for the next time the question comes up. They are stored in this profile’s settings, not in the database — a saved query is a convenience, not a row.',
		actions: button('Save the Editor', 'temcoTools.sql.saveQuery', { kind: 'primary', mark: 'plus' })
	})}
${saved.length === 0
			? `<div class="mt-16">${callout('Nothing is saved yet. Write a statement in the <b>Query Editor</b> and press <b>Save This</b>, or start from a <b>Preset</b>.')}</div>`
			: group({ label: 'Statements', count: n(saved.length, 'query', 'queries'), body: saved.map(line).join('') })}`;
}

/** *Presets* — statements written against this schema, ready to load. */
function presetsBody(): string {
	const line = (preset: Preset): string =>
		`${row({ mark: 'graph', title: preset.name, meta: [preset.note], actions: button('Load', 'temcoTools.sql.loadPreset', { small: true, kind: 'ghost', args: [preset.name] }) })}`;

	return `${pageHead({
		title: 'Presets',
		mark: 'graph',
		desc: 'Statements written against the schema this build has. Loading one puts it in the editor; a preset that returns nothing is telling you the schema moved.',
		actions: button('Query Editor', 'temcoTools.sql.query', { kind: 'primary', mark: 'code' })
	})}
${group({ label: 'Statements', count: n(PRESETS.length, 'preset', 'presets'), body: PRESETS.map(line).join('') })}
<div class="mt-16">${callout('A preset is written by this module, not by the database: a table it does not know about is a table it cannot ask about.')}</div>`;
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
				return shell(definition, schemaBody(tables, facts.schemaVersion, facts.expected, this.state.schemaTable));
			}
			case 'saved':
				return shell(definition, savedBody(this.saved()));
			default:
				return shell(definition, presetsBody());
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
