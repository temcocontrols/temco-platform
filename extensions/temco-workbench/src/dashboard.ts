// The Dashboard's two pages: Overview and Recent Activity.
//
// Coverage & Health used to be a third. It was removed because the documentation module already draws that report
// from the same registry, with the same figures — one report, one owner. The Overview's Knowledge card links there.
//
// Rebuilt from the mock (`docs/mock/js/views.overview.js`) on the shared page kit. What changed is where the
// numbers come from: the registries this window is reading, and the catalog's own record of what the platform did
// — drafts waiting, releases published, events. Both are read once per open, so a page cannot show a figure that
// nobody maintains.

import * as vscode from 'vscode';
import { collectPages, countStale, roots as readRoots, totals } from './docs';
import { Catalog, DraftRow, EventRow, selection } from './store';
import { button, commandScript, entries, entry, escapeHtml, head, n, page, pageColumn, notice, part, productName, runCommand } from './ui';

/** The view types the dashboard opens under. */
export const OVERVIEW_VIEW_TYPE = 'temcoWorkbench.overview';
export const ACTIVITY_VIEW_TYPE = 'temcoWorkbench.activity';

/** What every dashboard page reads: the registries on this machine, and the catalog's account of itself. */
interface DashboardFacts {
	/** The project the catalog's figures are about. */
	project?: string;
	projects: number;
	sources: number;
	areas: number;
	pages: number;
	neverReviewed: number;
	stale: number;
	faults: number;
	drafts: DraftRow[];
	releases: number;
	events: EventRow[];
}

/**
 * Read the two places a number can honestly come from.
 *
 * The registries answer what the documentation is; the catalog answers what the platform did. Nothing here is
 * derived a second time — staleness stays the generator's verdict, and a count stays the count of rows.
 */
async function readFacts(context: vscode.ExtensionContext): Promise<DashboardFacts> {
	const list = readRoots();
	const pages = list.flatMap((root) => collectPages(root));

	const counted = totals(list);
	const facts: DashboardFacts = {
		projects: 0,
		sources: list.length,
		areas: list.reduce((total, root) => total + root.areas.length, 0),
		pages: counted.pages,
		neverReviewed: counted.neverReviewed,
		stale: countStale(pages),
		faults: counted.issues,
		drafts: [],
		releases: 0,
		events: []
	};

	try {
		const catalog = await Catalog.open(context);
		try {
			const documents = catalog.documents();
			facts.projects = documents.length;
			const project = selection.project() ?? (documents.length === 1 ? documents[0].slug : undefined);
			facts.project = project;
			facts.drafts = project === undefined ? [] : catalog.drafts(project);
			facts.releases = project === undefined ? 0 : catalog.releases(project).length;
			facts.events = catalog.events(20);
		} finally {
			catalog.close();
		}
	} catch {
		// No catalog, no record: the pages then show what the folders say and nothing about the platform's history.
	}
	return facts;
}

/** How long ago something happened, in words a person reads at a glance. */
function age(iso: string): string {
	const at = new Date(iso).getTime();
	if (Number.isNaN(at)) {
		return 'just now';
	}
	const minutes = Math.floor((Date.now() - at) / 60_000);
	if (minutes < 1) {
		return 'just now';
	}
	if (minutes < 60) {
		return `${minutes} min ago`;
	}
	const hours = Math.floor(minutes / 60);
	if (hours < 24) {
		return `${hours} h ago`;
	}
	const days = Math.floor(hours / 24);
	return `${days} day${days === 1 ? '' : 's'} ago`;
}

/** The mark that says what kind of thing was recorded. */
const EVENT_MARK: { [kind: string]: string } = { draft: 'sparkle', release: 'upload', build: 'play', read: 'repo' };

/** A string a person reads, marked for translation. Bundles arrive from the build; without one this is the text. */
const t = (message: string, ...args: string[]): string => vscode.l10n.t(message, ...args);

/** A page's quiet line for a list that has nothing in it yet: no tint, because nothing is wrong. */
const empty = (text: string): string => `<p class="az-note">${escapeHtml(text)}</p>`;

/** One event: a tone mark, what happened, and when. */
const eventRow = (event: EventRow): string =>
	entry({
		mark: EVENT_MARK[event.kind] ?? 'activity',
		tone: event.seenAt === undefined ? 'info' : 'ok',
		title: event.detail ?? event.kind,
		meta: [event.kind, age(event.at), t('Platform')]
	});

/**
 * The five stages of the pipeline, each with the mark it is drawn by.
 *
 * The kit has no component for a path, and it does not need one: a stage is a row — the step, the figure it is
 * answerable for, and the way in — so the stages are entries, in the order a page goes through them.
 */
const STAGE_MARK: { [stage: string]: string } = {
	'01': 'repo',
	'02': 'document',
	'03': 'check',
	'04': 'play',
	'05': 'upload'
};


/** One stage of the pipeline, in the words of the figure it is answerable for. */
interface Stage {
	n: string;
	name: string;
	meta: string;
	/** Somebody is waiting on this stage, rather than it merely having a count. */
	wait?: boolean;
	command: string;
	go: string;
}

function pipeline(facts: DashboardFacts): string {
	const count = (value: number, one: string, many: string): string => n(value, one, many);
	const stages: Stage[] = [
		{
			n: '01',
			name: 'Sources',
			meta: facts.sources === 0
				? 'nothing is being read yet — choose a project, or open a folder with a docs/ folder'
				: `${count(facts.sources, 'source is', 'sources are')} being read · ${facts.faults === 0
					? 'no structural problem'
					: `${count(facts.faults, 'structural problem', 'structural problems')} found`}`,
			wait: facts.faults > 0,
			command: 'temcoProjects.editProject',
			go: 'Edit'
		},
		{
			n: '02',
			name: 'Documents',
			meta: facts.pages === 0
				? 'no page yet — a source that is read is where pages come from'
				: `${count(facts.pages, 'page', 'pages')} in ${count(facts.areas, 'area', 'areas')}${facts.stale === 0 ? ', none stale' : `, ${count(facts.stale, 'stale', 'stale')} with code that moved`}`,
			wait: false,
			command: 'temcoDocs.documents',
			go: 'Open'
		},
		{
			n: '03',
			name: 'Review',
			meta: facts.drafts.length === 0
				? `nothing waiting${facts.neverReviewed === 0 ? '' : ` · ${count(facts.neverReviewed, 'page has', 'pages have')} never been reviewed`}`
				: `${count(facts.drafts.length, 'draft is', 'drafts are')} waiting for a person${facts.neverReviewed === 0 ? '' : ` · ${count(facts.neverReviewed, 'page', 'pages')} never reviewed`}`,
			wait: facts.drafts.length > 0,
			command: 'temcoDocs.review',
			go: facts.drafts.length === 0 ? 'Open' : 'Settle'
		},
		{
			n: '04',
			name: 'Build',
			meta: facts.faults === 0
				? 'nothing in the pages would fail a build'
				: `${count(facts.faults, 'problem', 'problems')} a build would fail on`,
			wait: false,
			command: 'temcoDocs.builds',
			go: 'Open'
		},
		{
			n: '05',
			name: 'Publish',
			meta: facts.releases === 0
				? 'nothing published from this project yet — a build makes the copy, a publish puts it where a reader finds it'
				: `${count(facts.releases, 'version', 'versions')} published, newest first in Publish & Releases`,
			wait: false,
			command: 'temcoDocs.releases',
			go: 'Open'
		}
	];

	return entries(stages
		.map((stage) =>
			entry({
				mark: STAGE_MARK[stage.n] ?? 'activity',
				tone: stage.wait === true ? 'warn' : 'info',
				title: `${stage.n} ${t(stage.name)}`,
				meta: [stage.meta],
				actions: button(t(stage.go), stage.command, { small: true })
			}))
		.join(''));
}

function overviewBody(facts: DashboardFacts): string {
	const waiting = facts.drafts;
	const draftRow = (draft: DraftRow): string =>
		entry({
			mark: 'sparkle',
			tone: 'accent',
			title: draft.title,
			meta: [draft.pageId, t('waiting {0}', age(draft.createdAt))],
			actions: button(t('Review'), 'temcoDocs.review', { small: true })
		});

	// Four rows are enough to see whether any of them is yours; the rest are counted rather than listed, because a
	// page that lists a queue in full is a page nobody scrolls to the end of.
	const shown = waiting.slice(0, 4);
	const folded = waiting.slice(4);
	const needs = waiting.length === 0
		? empty(t('A draft appears here the moment the AI writes one, or when a page is started from a source. Accepting it is the only thing that writes a page.'))
		: `${entries(shown.map(draftRow).join(''))}
${folded.length === 0 ? '' : `<details class="az-more"><summary>${escapeHtml(t('{0} more in the Review Center', String(folded.length)))}</summary>${entries(folded.map(draftRow).join(''))}</details>`}`;

	const events = facts.events;
	const shownEvents = events.slice(0, 5);
	const foldedEvents = events.slice(5);
	const activity = events.length === 0
		? empty(t('Nothing has been recorded yet. Saving a draft, building or publishing writes the first row here.'))
		: `${entries(shownEvents.map(eventRow).join(''))}
${foldedEvents.length === 0 ? '' : `<details class="az-more"><summary>${escapeHtml(t('{0} older', String(foldedEvents.length)))}</summary>${entries(foldedEvents.map(eventRow).join(''))}</details>`}`;

	// The one tinted block a page is allowed: the thing a person would do next, chosen by what is actually waiting.
	const next = waiting.length > 0
		? notice({
			title: waiting.length === 1
				? t('One draft is waiting for a person')
				: t('{0} drafts are waiting for a person', String(waiting.length)),
			desc: t('Each is a proposal in the platform database. Accepting one writes the page exactly as it reads; discarding it throws the text away. The newest is “{0}”.', waiting[0].title),
			mark: 'sparkle',
			actions: `${button(t('Open the Review Center'), 'temcoDocs.review', { kind: 'primary' })}${button(t('Show the Queue'), 'temcoDocs.needsPage')}`
		})
		: facts.faults > 0
			? notice({
				title: facts.faults === 1
					? t('One structural problem in the pages')
					: t('{0} structural problems in the pages', String(facts.faults)),
				desc: t('A build would fail on these before it wrote anything. The queue lists them one by one, with the file each lives in.'),
				mark: 'alert',
				actions: `${button(t('Show the Queue'), 'temcoDocs.needsPage', { kind: 'primary' })}${button(t('Open the Builds'), 'temcoDocs.builds')}`
			})
			: notice({
				title: t('Nothing needs a person right now'),
				desc: t('No draft is waiting, and no page has a structural problem — nothing is half-finished.'),
				mark: 'check',
				actions: `${button(t('New Page'), 'temcoDocs.newPage', { kind: 'primary' })}${button(t('Open the Documents'), 'temcoDocs.documents')}`
			});

	return `${head({
		studio: productName(),
		title: t('Overview'),
		mark: 'dashboard',
		desc: t('What the platform holds, where the work stands, and the one thing that needs you next.'),
		// Every figure below is about one project, so which one is said here rather than left to be guessed.
		note: facts.project === undefined
			? { text: t('No project chosen — the figures are for whatever this window is reading'), mark: 'info' }
			: { text: facts.project, mark: 'repo', mono: true },
		actions: [
			{ label: t('New Project'), command: 'temcoProjects.newProject', mark: 'plus', kind: 'primary' },
			{ label: t('Build the Site'), command: 'temcoDocs.buildSite', mark: 'play' }
		]
	})}

<div class="mt-16">${next}</div>

<div class="mt-24">
	${part({
		title: t('Where the work stands'),
		note: t('A page goes through these five in this order, and each stage is answerable for one figure. A stage marked in amber is the one with somebody waiting on it.')
	})}
	<div class="mt-8">${pipeline(facts)}</div>
</div>

<div class="mt-24 grid grid--2">
	<div>
		${part({
			title: t('What needs a person'),
			note: t('Drafts only. A draft is a proposal: nothing is written until somebody accepts it.'),
			actions: button(t('Show the Queue'), 'temcoDocs.needsPage', { kind: 'ghost', small: true })
		})}
		<div class="mt-8">${needs}</div>
	</div>
	<div>
		${part({
			title: t('What happened lately'),
			note: t('Written by the module that did the thing, so nothing here is a second, derived history.'),
			actions: button(t('All Activity'), 'temcoWorkbench.activity', { kind: 'ghost', small: true })
		})}
		<div class="mt-8">${activity}</div>
	</div>
</div>

<p class="az-note">${escapeHtml(
		t('The figures come from the registries this window is reading and from the platform’s own record of what it did. Nothing on this page is calculated a second time.')
	)}</p>`;
}

/** *Recent Activity* — every row the platform wrote about itself, newest first. */
function activityBody(facts: DashboardFacts): string {
	return `${head({
		studio: productName(),
		title: t('Recent Activity'),
		mark: 'clock',
		desc: t('Everything the platform recorded, newest first. A row is written by the module that did the thing, so nothing here is a second, derived history.'),
		actions: [
			{ label: t('Review Center'), command: 'temcoDocs.review', mark: 'sparkle', kind: 'primary' },
			{ label: t('Open the Builds'), command: 'temcoDocs.builds', mark: 'play' }
		]
	})}
${facts.events.length === 0
			? `<div class="mt-16">${empty(t('Nothing has been recorded yet. The first row appears when a draft is saved, a build runs or a release is published — each of those writes one, and this page lists them in the order they happened.'))}</div>`
			: `<div class="mt-16">${part({ title: t('Newest First'), count: n(facts.events.length, 'event', 'events') })}${entries(facts.events.map(eventRow).join(''))}</div>`}`;
}

/** One panel per page, kept open so a second visit reveals the tab. */
export class DashboardPages {
	private readonly panels = new Map<string, vscode.WebviewPanel>();

	constructor(private readonly context: vscode.ExtensionContext) { }

	async open(pageId: 'overview' | 'activity', restored?: vscode.WebviewPanel): Promise<void> {
		const existing = this.panels.get(pageId);
		const definition = await this.body(pageId);
		const html = page(definition.body, { title: definition.title, script: commandScript, extraCss: definition.css });
		if (existing) {
			// Redrawn as well as revealed: a queue or a coverage figure that was true when the tab opened need
			// not be true now, and a page that lies quietly is worse than one that takes a moment to open.
			existing.reveal(pageColumn());
			existing.webview.html = html;
			return;
		}

		// A restored tab is drawn into rather than replaced: it keeps its place in the strip.
		const panel = restored ?? vscode.window.createWebviewPanel(definition.type, definition.title, pageColumn(), {
			enableScripts: true,
			localResourceRoots: []
		});
		panel.webview.options = { enableScripts: true, localResourceRoots: [] };
		panel.iconPath = vscode.Uri.joinPath(this.context.extensionUri, 'media', 'dashboard.svg');
		panel.onDidDispose(() => this.panels.delete(pageId));
		panel.webview.onDidReceiveMessage(runCommand);
		panel.webview.html = html;
		this.panels.set(pageId, panel);
	}

	/** One page's body, read fresh: the registries and the catalog answer, in that order. */
	private async body(pageId: 'overview' | 'activity'): Promise<{ type: string; title: string; body: string; css?: string }> {
		const facts = await readFacts(this.context);
		return pageId === 'overview'
			? { type: OVERVIEW_VIEW_TYPE, title: 'Overview', body: overviewBody(facts) }
			: { type: ACTIVITY_VIEW_TYPE, title: 'Recent Activity', body: activityBody(facts) };
	}

	dispose(): void {
		for (const panel of this.panels.values()) {
			panel.dispose();
		}
		this.panels.clear();
	}
}
