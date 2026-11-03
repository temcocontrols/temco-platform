// Overview — where the documentation stands, in one page.
//
// The tree answers "where is this page". This page answers the other question: where does the set stand, and what is
// waiting on a person. It is the module's front door, so it is built from what the module actually does rather than
// from a list of what exists: the registry's own counts (pages, areas, what the checks found), the queue the tool
// knows about and the reader does not (captures with no page, pages the code moved away from, changes the release
// workflow named), the drafts nobody has settled, the last build and the last release, and the owner each page
// answers to. Every one of those already has a page of its own; this page is one line each, with the way in.
//
// It is drawn with the shared page vocabulary (`temco-ui`), the way every other page of the application is: the page
// composes, the UI module decides what a part, a row and a figure look like. The figures sit in the title block
// rather than in a card, because they are the header's own facts and not a panel to be opened.

import * as vscode from 'vscode';
import { capturesOf } from './media';
import { DocsRoot, PageEntry, ageInDays, collectPages, totals } from './registry';
import { BuildRow, Catalog, ReleaseRow, selection } from './store';
import { button, commandScript, entries, entry, entryRow, hero, n, notice, page, pageColumn, part, runCommand } from './ui';
import { firstVersionReport } from './versionReport';

/** What the catalog knows and the registry cannot: the work a person has already started. */
interface Work {
	projects: number;
	sources: number;
	/** Screenshots taken with no page in front: in the inbox, waiting, remembered nowhere else. */
	captures: number;
	/** Drafts written beside a page and not settled either way. */
	drafts: number;
	/** Pages the release workflow named as changed, or as needing its screenshot taken again. */
	changed: number;
	version?: string;
	lastBuild?: BuildRow;
	lastRelease?: ReleaseRow;
}

/** One owner, and what the pages they answer for look like. */
interface OwnerRow {
	owner: string;
	pages: number;
	behind: number;
	never: number;
}

/** The view type this page opens under. */
export const OVERVIEW_VIEW_TYPE = 'temcoDocs.overview';

/**
 * The two shapes this page gives the kit.
 *
 * The figures are one line of facts beside the ways in rather than a block under them — the number and its noun on a
 * shared baseline, a hairline between the pairs — so the title block is the title, the sentence, and one row carrying
 * both the acts and the numbers. The six surfaces read across in threes, because they are one subject, and a column of
 * six makes the reader scroll a page that has nothing to scroll.
 */
const OVERVIEW_CSS = `
/* The figures stand beside the ways in rather than under them: one line across the band, the acts at the left and the
   numbers at the right, so the header is the title, the sentence, and one row of facts. */
.az-lead {
	display: grid;
	grid-template-columns: minmax(0, 1fr) auto;
	column-gap: var(--sp-6);
	align-items: center;
}

.az-lead > .az-crumbs,
.az-lead > .az-title,
.az-lead > .az-intro,
.az-lead > .az-note {
	grid-column: 1 / -1;
}

.az-lead__stats {
	margin-top: 0;
	padding-top: 0;
	border-top: 0;
	align-items: baseline;
	gap: var(--sp-2) var(--sp-4);
	justify-content: flex-end;
}

/* Narrow: the numbers go back under the acts and wrap, rather than squeezing the buttons into two lines. */
@media (max-width: 1100px) {
	.az-lead {
		grid-template-columns: minmax(0, 1fr);
	}

	.az-lead__stats {
		margin-top: var(--sp-3);
		justify-content: flex-start;
	}
}

.az-stat {
	flex-direction: row;
	align-items: baseline;
	gap: 6px;
	min-width: 0;
}

.az-stat + .az-stat {
	padding-left: var(--sp-4);
	border-left: 1px solid var(--az-blue-pale);
}

.az-stat__value {
	font-size: 15px;
	line-height: 22px;
}

.az-entries--row {
	grid-template-columns: repeat(3, minmax(0, 1fr));
}

@media (max-width: 1040px) {
	.az-entries--row {
		grid-template-columns: repeat(2, minmax(0, 1fr));
	}
}

@media (max-width: 680px) {
	.az-entries--row {
		grid-template-columns: minmax(0, 1fr);
	}
}

/* A tile here says a state in a phrase, not an identifier: let it wrap, and set it in the page's own face. */
.az-entries--row > .az-entry > .az-entry__main > .az-entry__meta {
	white-space: normal;
	overflow: visible;
	font-family: inherit;
}
`;

export class OverviewPage {
	private panel: vscode.WebviewPanel | undefined;

	constructor(
		private readonly context: vscode.ExtensionContext,
		private readonly roots: () => readonly DocsRoot[]
	) { }

	/** Opens the page, or brings it forward if it is already open. `restored` is the tab the window gave back. */
	open(restored?: vscode.WebviewPanel): void {
		if (this.panel) {
			this.panel.reveal(pageColumn());
			void this.render();
			return;
		}
		// A restored tab is drawn into rather than replaced: it keeps its place in the strip.
		this.panel = restored ?? vscode.window.createWebviewPanel(OVERVIEW_VIEW_TYPE, 'Overview', pageColumn(), {
			enableScripts: true,
			localResourceRoots: []
		});
		this.panel.webview.options = { enableScripts: true, localResourceRoots: [] };
		this.panel.iconPath = vscode.Uri.joinPath(this.context.extensionUri, 'media', 'overview.svg');
		this.panel.onDidDispose(() => {
			this.panel = undefined;
		});
		this.panel.webview.onDidReceiveMessage(runCommand);
		void this.render();
	}

	/** Re-renders if the page is open: a read, a project change or a page write all land here. */
	refresh(): void {
		void this.render();
	}

	dispose(): void {
		this.panel?.dispose();
	}

	private async render(): Promise<void> {
		const panel = this.panel;
		if (panel === undefined) {
			return;
		}
		const roots = this.roots();
		const work = await workOf(this.context, roots);
		// The tab can be closed while the catalog is being read; drawing into it then would throw.
		if (this.panel !== panel) {
			return;
		}
		panel.webview.html = page(html(roots, work), { title: 'Overview', script: commandScript, extraCss: OVERVIEW_CSS });
	}
}

/** How long ago a recorded moment was, in words. An absent moment is said, not hidden. */
function when(at: string | undefined): string {
	if (at === undefined || at.length === 0) {
		return 'never';
	}
	const days = ageInDays(at);
	if (days === undefined) {
		return at.slice(0, 10);
	}
	if (days <= 0) {
		return 'today';
	}
	if (days === 1) {
		return 'yesterday';
	}
	return days < 45 ? `${String(days)} days ago` : at.slice(0, 10);
}

/** The pages per owner, most pages first, with the empty owner named as the gap it is. */
function ownerRows(pages: readonly PageEntry[]): OwnerRow[] {
	const rows = new Map<string, OwnerRow>();
	for (const page of pages) {
		const owner = page.owner.trim();
		const row = rows.get(owner) ?? { owner, pages: 0, behind: 0, never: 0 };
		row.pages += 1;
		if (page.provenance?.stale === true) {
			row.behind += 1;
		}
		if (page.reviewed === null) {
			row.never += 1;
		}
		rows.set(owner, row);
	}
	return [...rows.values()].sort((a, b) => b.pages - a.pages || a.owner.localeCompare(b.owner));
}

/** One owner's row: how much is theirs, and how much of it is behind. */
function ownerEntry(row: OwnerRow): string {
	const named = row.owner.length > 0;
	return entry({
		mark: named ? 'account' : 'alert',
		tone: named ? 'info' : 'warn',
		title: named ? row.owner : 'No owner',
		meta: [
			n(row.pages, 'page', 'pages'),
			row.behind === 0 ? undefined : `${String(row.behind)} behind its source`,
			row.never === 0 ? undefined : `${String(row.never)} never reviewed`
		].filter((fact): fact is string => fact !== undefined),
		state: named ? undefined : 'nobody to ask'
	});
}

/** Everything the page says that the registry alone cannot: the queues, and what was last built. */
async function workOf(context: vscode.ExtensionContext, roots: readonly DocsRoot[]): Promise<Work> {
	const work: Work = { projects: 0, sources: 0, captures: 0, drafts: 0, changed: 0 };
	work.captures = (await capturesOf(roots)).length;
	const report = await firstVersionReport(roots);
	work.version = report?.report.version;
	work.changed = (report?.report.changed?.length ?? 0) + (report?.report.retake?.length ?? 0);

	let catalog: Catalog | undefined;
	try {
		catalog = await Catalog.open(context);
		const open: Catalog = catalog;
		const documents = open.documents();
		work.projects = documents.length;
		work.sources = open.sources().length;
		work.drafts = documents.reduce((count, document) => count + open.drafts(document.slug).length, 0);
		// Nothing selected and one project in the catalog means that project, which is what a lone author has.
		const project = selection.project() ?? (documents.length === 1 ? documents[0].slug : undefined);
		if (project !== undefined) {
			work.lastBuild = open.builds(project)[0];
			work.lastRelease = open.releases(project)[0];
		}
	} catch {
		// A catalog that cannot be read leaves the registry's own facts: the page still reads, without history.
	} finally {
		catalog?.close();
	}
	return work;
}

function html(roots: readonly DocsRoot[], work: Work): string {
	const sums = totals(roots);
	const pages = roots.flatMap((root) => collectPages(root));
	const behind = pages.filter((page) => page.provenance?.stale === true).length;
	const missing = pages.filter((page) => !page.exists).length;
	const areaCount = roots.reduce((count, root) => count + root.areas.length, 0);
	const problems = roots.flatMap((root) => root.problems);
	const owners = ownerRows(pages);
	const one = roots.length === 1 ? roots[0] : undefined;

	const head = hero({
		eyebrow: 'Documentation',
		mark: 'home',
		title: 'Overview',
		desc: roots.length === 0
			? 'This window is not reading any documentation yet: a project names the sources, and a source is what holds the pages.'
			: 'Where this set stands — the folder it is read from, what is waiting on a person, what was last built, and who each page answers to. Every line is read from the registry the tree reads or from the catalog the other pages share; nothing here is inferred.',
		descWide: true,
		note: one === undefined
			? undefined
			: {
				text: vscode.workspace.asRelativePath(one.registryUri, false),
				mono: true,
				link: { command: 'temcoDocs.openFile', args: [one.registryUri.fsPath] }
			},
		actions: roots.length === 0
			? [{ label: 'Choose a project', command: 'temcoDocs.projects', kind: 'primary', mark: 'folder' }]
			: [
				{ label: 'Show the tree', command: 'temcoDocs.pages.focus', kind: 'primary', mark: 'list' },
				{ label: 'New page', command: 'temcoDocs.newPage', mark: 'plus' },
				{ label: 'Validate the set', command: 'temcoDocs.validate', mark: 'check' }
			],
		stats: roots.length === 0
			? undefined
			: [
				{ value: String(sums.pages), label: sums.pages === 1 ? 'page' : 'pages' },
				{ value: String(areaCount), label: areaCount === 1 ? 'area' : 'areas' },
				{ value: String(behind), label: 'behind its source' },
				{ value: String(sums.neverReviewed), label: 'never reviewed' },
				{ value: String(sums.issues), label: sums.issues === 1 ? 'problem' : 'problems' }
			]
	});

	if (roots.length === 0) {
		return `${head}
${notice({
			mark: 'book',
			title: 'Nothing is being read',
			desc: 'A project names the sources, and each source is read from a folder on this machine or over the API. Once one is read, this page says what it holds, what is waiting, and what was last built.'
		})}`;
	}

	// The queue, counted in the module's own words. Drafts have their own tile, so they are not counted twice.
	const waiting = work.captures + behind + work.changed;
	const waitingDetail = [
		work.captures === 0 ? undefined : `${String(work.captures)} capture${work.captures === 1 ? '' : 's'}`,
		behind === 0 ? undefined : `${String(behind)} behind`,
		work.changed === 0 ? undefined : `${String(work.changed)} changed${work.version === undefined ? '' : ` in ${work.version}`}`
	].filter((fact): fact is string => fact !== undefined);

	const surfaces = [
		entryRow({
			mark: 'document',
			title: 'Pages',
			meta: [
				`${n(sums.pages, 'page', 'pages')} · ${n(areaCount, 'area', 'areas')}`,
				sums.unshipped === 0 ? undefined : `${String(sums.unshipped)} do not ship`,
				missing === 0 ? undefined : `${String(missing)} with no file`
			].filter((fact): fact is string => fact !== undefined).join(' · '),
			command: 'temcoDocs.pages.focus',
			go: 'Show'
		}),
		entryRow({
			mark: 'bell',
			title: 'Needs you',
			meta: waiting === 0 ? 'nothing waiting' : `${String(waiting)} waiting · ${waitingDetail.join(' · ')}`,
			// The queue is a view, not a page: this tile goes to the queue itself rather than to a copy of it.
			command: 'temcoDocs.needsPage',
			go: 'Show'
		}),
		entryRow({
			mark: 'check',
			title: 'Review',
			meta: work.drafts === 0 ? 'nothing to settle' : `${n(work.drafts, 'draft', 'drafts')} waiting`,
			command: 'temcoDocs.review',
			go: 'Review'
		}),
		entryRow({
			mark: 'play',
			title: 'Build',
			meta: work.lastBuild === undefined
				? 'never built'
				: `#${String(work.lastBuild.id)} ${work.lastBuild.status} · ${when(work.lastBuild.finishedAt ?? work.lastBuild.startedAt)}`,
			command: 'temcoDocs.builds',
			go: 'Build'
		}),
		entryRow({
			mark: 'upload',
			title: 'Publish',
			meta: work.lastRelease === undefined
				? 'never published'
				: `${work.lastRelease.version} · ${when(work.lastRelease.publishedAt)}`,
			command: 'temcoDocs.releases',
			go: 'Publish'
		}),
		entryRow({
			mark: 'layers',
			title: 'Projects',
			meta: `${n(work.projects, 'project', 'projects')} · ${n(work.sources, 'source', 'sources')}`,
			command: 'temcoDocs.projects',
			go: 'Open'
		})
	];

	const ownerList = owners.slice(0, 5).map(ownerEntry);
	if (owners.length > ownerList.length) {
		ownerList.push(entryRow({
			mark: 'arrow-right',
			title: `Show all ${String(owners.length)}`,
			meta: 'the report groups what is owed by owner',
			command: 'temcoDocs.stalenessReport',
			go: 'Owed'
		}));
	}

	return `${head}
${problems.length === 0 ? '' : `<div class="mt-16">${notice({
		mark: 'alert',
		title: problems.length === 1 ? 'A file beside the registry could not be read' : `${String(problems.length)} files beside the registry could not be read`,
		desc: 'That file is what says which code a page claims, or what its history is — so both are unknown until it is fixed, and the counts above are lower than the set really is. The Problems panel names the file.'
	})}</div>`}
<div class="mt-24">${part({
		title: 'Where the work is',
		note: 'One tile per surface: what state it is in now, and the way in. Nothing on this page writes.',
		actions: button('Validate the set', 'temcoDocs.validate', { kind: 'link', mark: 'check' })
	})}
<div class="az-entries az-entries--row az-entries--plain">${surfaces.join('')}</div></div>
<div class="mt-24">${part({
		title: 'Who these pages answer to',
		count: owners.length === 1 && owners[0].owner.length === 0 ? 'no page names an owner' : n(owners.length, 'owner', 'owners'),
		note: 'The registry names an owner per page, and the report groups what is owed by them. A page with no owner is one nobody has been asked about.',
		actions: button('Documentation owed', 'temcoDocs.stalenessReport', { kind: 'link', mark: 'clock' })
	})}
${entries(ownerList.join(''))}</div>`;
}

