// The projects page: every documentation set this machine manages, in one list.
//
// The Dashboard's *Projects* view is where a project is worked on — one row, one current project. This page is the
// overview: what exists, which one is current, and how each one is doing. It is a page rather than a second tree
// because the questions are different: a tree answers "which page do I open", a page answers "which project needs
// me".
//
// Every fact here is read from the catalog, never estimated: pages as the last read recorded them, sources as they
// are cited, drafts as they are waiting, and the build time of the last artifact written. A project with no local
// copy says so, because a page count read over an API is not the same thing as a working tree.

import * as vscode from 'vscode';
import { Catalog, CatalogUnavailable, Selection } from './store';
import { PROJECTS_PAGE_VIEW_TYPE } from './surface';
import { callout, commandScript, escapeHtml as esc, hero, icon, page, pageColumn, remember, runCommand } from './ui';

/** One row of the list: the catalog's own fields, plus what the four queries beside it counted. */
interface ProjectRow {
	slug: string;
	name: string;
	version?: string;
	origin?: string;
	sources: number;
	builtAt?: string;
	pages: number;
	drafts: number;
	/** Cited sources with no copy on this machine — their pages were read over an API and cannot be checked. */
	readOnly: number;
}

/** Just the view types are exported by `surface.ts`; this is the page's own. */
export class ProjectsPage {
	private panel: vscode.WebviewPanel | undefined;

	constructor(
		private readonly context: vscode.ExtensionContext,
		private readonly selection: Selection
	) { }

	async open(): Promise<void> {
    remember(this.context, PROJECTS_PAGE_VIEW_TYPE);
		const rows = await this.read();
		if (this.panel !== undefined) {
			this.panel.reveal(pageColumn());
			this.panel.webview.html = this.html(rows);
			return;
		}
		this.panel = vscode.window.createWebviewPanel(
			PROJECTS_PAGE_VIEW_TYPE,
			'Projects',
			pageColumn(),
			{ enableScripts: true, localResourceRoots: [] }
		);
		this.panel.iconPath = new vscode.ThemeIcon('layout');
		this.panel.webview.html = this.html(rows);
		this.panel.webview.onDidReceiveMessage(runCommand);
		// Coming back to the page after an act elsewhere — *Work on*, *Open* — is a re-read, not a stale list: the
		// current marker and the counts are read from the catalog, and the catalog has changed.
		this.panel.onDidChangeViewState((state) => {
			if (state.webviewPanel.visible) {
				void this.reload();
			}
		});
		this.panel.onDidDispose(() => {
			this.panel = undefined;
		});
	}

	/** Redraws the open page — the list is a reading of the catalog, so it is re-read rather than patched. */
	async reload(): Promise<void> {
		if (this.panel !== undefined) {
			this.panel.webview.html = this.html(await this.read());
		}
	}

	dispose(): void {
		this.panel?.dispose();
	}

	private async read(): Promise<ProjectRow[]> {
		let catalog: Catalog | undefined;
		try {
			catalog = await Catalog.open(this.context);
			return catalog.documents().map((row) => {
				const cited = catalog?.documentSourceSlugs(row.slug) ?? [];
				const readOnly = cited.filter((slug) => {
					const source = catalog?.source(slug);
					return source !== undefined && source.path === undefined;
				}).length;
				return {
					slug: row.slug,
					name: row.name,
					version: row.version,
					origin: row.origin,
					sources: row.sources,
					builtAt: row.builtAt,
					pages: catalog?.documentPages(row.slug).length ?? 0,
					drafts: catalog?.drafts(row.slug, 'draft').length ?? 0,
					readOnly,
				};
			});
		} catch (error) {
			const message = error instanceof CatalogUnavailable ? error.message : String(error);
			void vscode.window.showErrorMessage(`Temco Projects: ${message}`);
			return [];
		} finally {
			catalog?.close();
		}
	}

	private html(rows: readonly ProjectRow[]): string {
		const current = this.selection.project();

		const head = hero({
			mark: 'list',
			title: 'Projects',
			desc: 'Every documentation set this machine manages. Open one to see what it cites and what it produces; make one current to work on its pages.',
			descWide: true,
			actions: [
				{ label: 'New project', command: 'temcoProjects.newProject', kind: 'primary', mark: 'plus' },
				{ label: 'From a repository', command: 'temcoProjects.newProjectFromRepository', mark: 'repo' },
				{ label: 'The repositories', command: 'temcoRepositories.page', mark: 'globe' }
			]
		});

		const waiting = rows.filter((row) => row.drafts > 0).length;
		const info = callout({
			mark: 'info',
			title: rows.length === 0
				? 'No project yet'
				: `${rows.length} project${rows.length === 1 ? '' : 's'} · ${current === undefined ? 'none current' : '1 current'} · ${waiting === 0 ? 'nothing waiting' : `${waiting} with drafts waiting`}`,
			desc: 'A row opens the project page; Work on makes it the project every Documentation page talks about. Nothing here is uploaded — a project is a name and the sources it cites.',
			actions: rows.length === 0
				? '<button type="button" class="az-btn az-btn--primary" data-command="temcoProjects.newProject"><span>Create a project</span></button>'
				: '<button type="button" class="az-btn az-btn--sm" data-command="temcoDocs.review"><span>Review center</span></button><button type="button" class="az-btn az-btn--sm" data-command="temcoDocs.validate"><span>Validate</span></button>'
		});

		const tools = rows.length === 0
			? ''
			: `<div class="prj-tools">
	<input type="search" class="az-input prj-filter" id="prj-filter" placeholder="Filter projects" aria-label="Filter projects">
	<label class="prj-toggle"><input type="checkbox" id="prj-only-current"><span>Current only</span></label>
	<select class="az-input prj-sort" id="prj-sort" aria-label="Sort projects">
		<option value="current">Current first</option>
		<option value="name">Name</option>
		<option value="built">Recently built</option>
		<option value="pages">Most pages</option>
		<option value="drafts">Most drafts</option>
	</select>
	<span class="prj-count" id="prj-count">${rows.length} project${rows.length === 1 ? '' : 's'}</span>
	<span class="prj-tools__spacer"></span>
	<button type="button" class="az-btn az-btn--sm" data-command="temcoProjects.projectsPage"><span>Refresh</span></button>
</div>`;

		const body = rows.length === 0
			? ''
			: `${tools}
<div class="prj-list" id="prj-list" tabindex="0">${rows.map((row) => projectRow(row, row.slug === current)).join('\n')}</div>`;

		return page(`${head}
${info}
${body}`, {
			title: 'Projects',
			script: commandScript + LIST_SCRIPT,
			extraCss: PAGE_CSS
		});
	}
}

/**
 * One project, as two lines: what it is, then how it is doing.
 *
 * The name carries the badges a person filters by — current, version, how many sources — and the second line carries
 * the badges they judge by. Everything leans left; the ways in sit at the end of the first line.
 */
function projectRow(row: ProjectRow, current: boolean): string {
	const tag = current ? '<span class="prj-badge prj-badge--current">Current</span>' : '';
	const version = row.version === undefined ? '' : `<span class="prj-badge">v${esc(row.version)}</span>`;
	const sources = `<span class="prj-badge">${row.sources} source${row.sources === 1 ? '' : 's'}</span>`;
	const warning = row.readOnly === 0
		? ''
		: `<span class="prj__warn" title="${row.readOnly} source${row.readOnly === 1 ? ' has' : 's have'} no local copy, so ${row.readOnly === 1 ? 'its pages were' : 'their pages were'} read over the API">${icon('warning')}</span>`;
	const pages = `<span class="prj-badge prj-badge--plain">${row.pages} page${row.pages === 1 ? '' : 's'}</span>`;
	const built = `<span class="prj-badge prj-badge--plain">${row.builtAt === undefined ? 'never built' : `built ${when(row.builtAt)}`}</span>`;
	const drafts = row.drafts === 0
		? '<span class="prj-badge prj-badge--plain">no drafts waiting</span>'
		: `<span class="prj-badge prj-badge--warn">${row.drafts} draft${row.drafts === 1 ? '' : 's'} waiting</span>`;

	return `<div class="prj-item" tabindex="0"
		data-command="temcoProjects.openProjectPage" data-args="${esc(JSON.stringify(row.slug))}"
		data-name="${esc(row.name.toLowerCase())}" data-pages="${row.pages}" data-drafts="${row.drafts}"
		data-built="${esc(row.builtAt ?? '')}" data-current="${current}">
	<span class="prj-item__icon">${icon(row.origin === 'repository' ? 'repo' : 'folder')}</span>
	<div class="prj-item__body">
		<div class="prj-item__row">
			<span class="prj-item__name">${esc(row.name)}</span>${tag}${version}${sources}${warning}
		</div>
		<div class="prj-item__row prj-item__row--facts">${pages}${built}${drafts}</div>
	</div>
	<div class="prj-item__actions">
		${current ? '' : button('Work on', 'temcoProjects.selectProject', { arg: row.slug })}
		${button('Edit', 'temcoProjects.editProject', { arg: row.slug })}
		<span class="prj-open">Open${icon('chevron-right', 'icon--sm')}</span>
	</div>
</div>`;
}

interface ButtonOptions {
	mark?: string;
	/** The one argument the command is run with — a slug, encoded so `rowSlug` reads it. */
	arg?: string;
}

/**
 * One act, as the page language draws it: a command id the page posts back, never a script of its own.
 *
 * The argument is encoded as a single JSON value rather than an array, because the shared script hands whatever it
 * read to `executeCommand` as **one** argument, and the commands here read it with `rowSlug`, which knows a string
 * and an object with a `slug` — not a list.
 */
function button(label: string, command: string, options: ButtonOptions = {}): string {
	const mark = options.mark === undefined ? '' : icon(options.mark);
	const args = options.arg === undefined ? '' : ` data-args="${esc(JSON.stringify(options.arg))}"`;
	return `<button type="button" class="az-btn az-btn--sm" data-command="${command}"${args}>${mark}<span>${esc(label)}</span></button>`;
}

/** The list's own behaviour: filter, sort, a count of what is left, and the arrow keys. */
const LIST_SCRIPT = `
(function () {
	const list = document.getElementById('prj-list');
	if (!list) { return; }
	const input = document.getElementById('prj-filter');
	const sort = document.getElementById('prj-sort');
	const onlyCurrent = document.getElementById('prj-only-current');
	const count = document.getElementById('prj-count');
	const items = Array.prototype.slice.call(list.querySelectorAll('.prj-item'));

	function value(item, name) {
		return item.getAttribute('data-' + name) || '';
	}
	function visible() {
		return items.filter(function (item) { return !item.hidden; });
	}
	function apply() {
		const term = input.value.trim().toLowerCase();
		const currentOnly = onlyCurrent.checked;
		let shown = 0;
		items.forEach(function (item) {
			const matches = term.length === 0 || item.textContent.toLowerCase().indexOf(term) >= 0;
			const allowed = !currentOnly || value(item, 'current') === 'true';
			item.hidden = !(matches && allowed);
			if (matches && allowed) { shown = shown + 1; }
		});
		count.textContent = (shown === items.length ? shown : shown + ' of ' + items.length)
			+ (items.length === 1 ? ' project' : ' projects');
	}
	function compare(a, b, key) {
		if (key === 'current') {
			return Number(value(b, 'current') === 'true') - Number(value(a, 'current') === 'true');
		}
		if (key === 'name') { return value(a, 'name').localeCompare(value(b, 'name')); }
		if (key === 'pages') { return Number(value(b, 'pages')) - Number(value(a, 'pages')); }
		if (key === 'drafts') { return Number(value(b, 'drafts')) - Number(value(a, 'drafts')); }
		// Recently built: newest first, never built last.
		const ab = value(a, 'built');
		const bb = value(b, 'built');
		if (ab === bb) { return 0; }
		if (ab === '') { return 1; }
		if (bb === '') { return -1; }
		return ab < bb ? 1 : -1;
	}
	function order() {
		const key = sort.value;
		const sorted = items.slice().sort(function (a, b) {
			if (key === 'current') {
				return compare(a, b, 'current') || compare(a, b, 'name');
			}
			// The current project stays on top whatever the order, so the row a person is acting on never moves away.
			return compare(a, b, 'current') || compare(a, b, key) || compare(a, b, 'name');
		});
		sorted.forEach(function (item) { list.appendChild(item); });
	}
	function activate(item) { item.click(); }

	input.addEventListener('input', apply);
	onlyCurrent.addEventListener('change', apply);
	sort.addEventListener('change', function () { order(); apply(); });
	items.forEach(function (item) {
		item.addEventListener('keydown', function (event) {
			if (event.key === 'Enter' || event.key === ' ') {
				activate(item);
				event.preventDefault();
			}
		});
	});
	list.addEventListener('keydown', function (event) {
		if (event.key !== 'ArrowDown' && event.key !== 'ArrowUp') { return; }
		const rows = visible();
		const at = rows.indexOf(document.activeElement);
		const next = event.key === 'ArrowDown' ? Math.min(rows.length - 1, at + 1) : Math.max(0, at - 1);
		if (rows[next] !== undefined) {
			rows[next].focus();
			event.preventDefault();
		}
	});
	order();
	apply();
})();
`;

/** The page's own shapes: a list, not a table. */
const PAGE_CSS = `
/* The page fits one screen: the header, one line of facts, the tools, and a list that takes the rest of the tab
   and scrolls inside itself. */
.view__inner { min-height: 100vh; display: flex; flex-direction: column; }
.az-callout { margin: var(--sp-2) 0 var(--sp-3); }
.prj-tools { display: flex; align-items: center; gap: var(--sp-2); margin: 0 0 var(--sp-2); }
.prj-filter { width: 260px; max-width: 45%; }
.prj-sort { height: 28px; padding: 0 var(--sp-2); }
.prj-toggle { display: inline-flex; align-items: center; gap: 6px; color: var(--ink-2); font-size: 12px;
  white-space: nowrap; }
.prj-count { color: var(--ink-3); font-size: 12px; white-space: nowrap; }
.prj-tools__spacer { flex: 1 1 auto; }
/* The list is the remainder of the tab: it takes every pixel under the tools and scrolls its own overflow, so the
   page itself never scrolls and the tools stay where they are. */
.prj-list { flex: 1 1 auto; min-height: 160px; overflow-y: auto; scrollbar-gutter: stable; }
.prj-list:focus-visible { outline: 2px solid var(--az-blue); outline-offset: 2px; border-radius: var(--r-2); }
.prj-item { display: grid; grid-template-columns: 26px minmax(0, 1fr) auto; align-items: center; gap: var(--sp-3);
  padding: 9px 12px; border-bottom: 1px solid var(--hairline); border-radius: var(--r-2); cursor: pointer; }
.prj-item:last-child { border-bottom-color: transparent; }
.prj-item:hover { background: var(--az-blue-selected); }
.prj-item:focus-visible { outline: 2px solid var(--az-blue); outline-offset: -2px; }
.prj-item[hidden] { display: none; }
.prj-item__icon { display: grid; place-items: center; width: 26px; height: 26px; border-radius: var(--r-2);
  background: var(--az-blue-selected); color: var(--az-blue); }
.prj-item__icon .icon { width: 15px; height: 15px; }
/* Two lines, both leaning left: the name with the badges a person filters by, then the facts they judge by. */
.prj-item__body { display: flex; flex-direction: column; gap: 4px; min-width: 0; }
.prj-item__row { display: flex; align-items: center; flex-wrap: wrap; gap: 6px; min-width: 0; }
.prj-item__name { color: var(--ink-1); font-size: 14px; line-height: 20px; font-weight: 600;
  min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.prj-badge { flex: none; padding: 1px 6px; border-radius: var(--r-2); background: var(--surface-subtle);
  color: var(--ink-2); font-size: 11px; line-height: 16px; white-space: nowrap; }
.prj-badge--plain { background: transparent; color: var(--ink-3); padding-left: 0; padding-right: 8px; }
.prj-badge--current { background: var(--az-blue-selected); color: var(--az-blue); }
.prj-badge--warn { background: var(--az-blue-selected); color: var(--az-blue); }
.prj-item__actions { display: flex; align-items: center; gap: var(--sp-2); }
.prj__warn { display: grid; place-items: center; flex: none; color: var(--warn-ink); }
.prj__warn .icon { width: 13px; height: 13px; }
.prj-open { display: inline-flex; align-items: center; gap: 2px; color: var(--az-blue); font-size: 12px;
  white-space: nowrap; }
.prj-open .icon { width: 12px; height: 12px; }
@media (max-width: 900px) {
  .prj-item { grid-template-columns: 26px minmax(0, 1fr); }
  .prj-item__actions { grid-column: 2; justify-content: flex-start; margin-top: 4px; }
  .prj-filter { max-width: none; width: 100%; }
}
`;

/** When something happened, said the way a person says it: an hour ago, three days ago, or the date. */
function when(stamp: string): string {
	const at = new Date(stamp);
	if (Number.isNaN(at.getTime())) {
		return stamp;
	}
	const minutes = Math.floor((Date.now() - at.getTime()) / 60000);
	if (minutes < 1) {
		return 'just now';
	}
	if (minutes < 60) {
		return `${minutes} minute${minutes === 1 ? '' : 's'} ago`;
	}
	const hours = Math.floor(minutes / 60);
	if (hours < 24) {
		return `${hours} hour${hours === 1 ? '' : 's'} ago`;
	}
	const days = Math.floor(hours / 24);
	return days < 30 ? `${days} day${days === 1 ? '' : 's'} ago` : at.toISOString().slice(0, 10);
}

