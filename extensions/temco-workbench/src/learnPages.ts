// Temco Learn — the published site, as a reader sees it.
//
// Rebuilt from the mock (`docs/mock/js/views.platform.js`: `learn/home`, `learn/t3000`, `learn/article`,
// `learn/downloads`, `learn/paths`). The markup and the wording are the mock's; the rows are now the platform's
// own: the areas this window is reading, the artifacts its builds left, and the versions it published. A Learn page
// that cannot read any of that says so instead of showing a sample.

import * as vscode from 'vscode';
import { roots as readRoots, totals } from './docs';
import { Catalog, ReleaseRow, selection } from './store';
import {
	callout as azCallout,
	commandScript,
	entryRow,
	escapeHtml as esc,
	hero as azHero,
	icon,
	page,
	pageColumn,
	runCommand,
	section
} from './ui';

/** What the Learn pages read: the registries on this machine, and what the catalog has published. */
interface LearnFacts {
	project?: string;
	projects: number;
	pages: number;
	areas: { name: string; pages: number; neverReviewed: number; stale: number }[];
	artifacts: { kind: string; path: string; builtAt: string }[];
	releases: ReleaseRow[];
}

async function readLearnFacts(context: vscode.ExtensionContext): Promise<LearnFacts> {
	const list = readRoots();
	const areas = new Map<string, { name: string; pages: number; neverReviewed: number; stale: number }>();
	for (const root of list) {
		for (const area of root.areas) {
			const stale = area.chapters.reduce(
				(total, chapter) => total + chapter.pages.filter((entry) => entry.provenance?.stale === true).length,
				0
			);
			const found = areas.get(area.area);
			if (found === undefined) {
				areas.set(area.area, { name: area.area, pages: area.pages, neverReviewed: area.neverReviewed, stale });
				continue;
			}
			found.pages += area.pages;
			found.neverReviewed += area.neverReviewed;
			found.stale += stale;
		}
	}

	const facts: LearnFacts = {
		projects: 0,
		pages: totals(list).pages,
		areas: [...areas.values()].sort((one, other) => one.name.localeCompare(other.name)),
		artifacts: [],
		releases: []
	};

	try {
		const catalog = await Catalog.open(context);
		try {
			const documents = catalog.documents();
			facts.projects = documents.length;
			const project = selection.project() ?? (documents.length === 1 ? documents[0].slug : undefined);
			facts.project = project;
			facts.artifacts = project === undefined ? [] : catalog.documentArtifacts(project);
			facts.releases = project === undefined ? [] : catalog.releases(project);
		} finally {
			catalog.close();
		}
	} catch {
		// Nothing published is a state, not an error: the pages say so and offer the build.
	}
	return facts;
}

/** The mark that says what an artifact is. */
const ARTIFACT_MARK: { [kind: string]: string } = { chm: 'package', pdf: 'document', site: 'globe', search: 'search' };

/** The words for an artifact's kind. */
const artifactName = (kind: string): string =>
	kind === 'chm' ? 'Offline help (CHM)' : kind === 'pdf' ? 'PDF' : kind === 'site' ? 'Website' : kind === 'search' ? 'Search index' : kind;

export const LEARN_HOME_VIEW_TYPE = 'temcoWorkbench.learn.home';
export const LEARN_ARTICLE_VIEW_TYPE = 'temcoWorkbench.learn.article';
export const LEARN_DOWNLOADS_VIEW_TYPE = 'temcoWorkbench.learn.downloads';

interface ActionOptions {
	kind?: 'primary' | 'ghost';
	mark?: string;
	small?: boolean;
	args?: unknown;
}

const button = (label: string, command: string, options: ActionOptions = {}): string =>
	`<button type="button" class="btn${options.small ? ' btn--sm' : ''}${options.kind ? ` btn--${options.kind}` : ''}" data-command="${command}"${options.args === undefined ? '' : ` data-args="${esc(JSON.stringify(options.args))}"`}>${options.mark ? icon(options.mark) : ''}<span>${esc(label)}</span></button>`;

const badge = (text: string, tone?: string): string =>
	`<span class="badge${tone && tone !== 'neutral' ? ` badge--${tone}` : ''}">${esc(text)}</span>`;

const hero = (options: { tone?: string; eyebrow?: string; title: string; desc?: string; actions?: string }): string =>
	`<div class="hero-panel${options.tone && options.tone !== 'accent' ? ` hero-panel--${options.tone}` : ''}">${options.eyebrow ? `<div class="eyebrow">${esc(options.eyebrow)}</div>` : ''}<div class="hero-panel__title">${esc(options.title)}</div>${options.desc ? `<p class="hero-panel__desc">${options.desc}</p>` : ''}${options.actions ? `<div class="hero-panel__actions">${options.actions}</div>` : ''}</div>`;

const pageHead = (options: { title: string; mark: string; desc: string; actions?: string }): string =>
	`<div class="page-head"><div class="page-head__main"><h1 class="page-head__title">${icon(options.mark)}${esc(options.title)}</h1><p class="page-head__desc">${options.desc}</p></div>${options.actions ? `<div class="page-head__actions">${options.actions}</div>` : ''}</div>`;

const rule = (label: string, count: string, note?: string, actions?: string): string =>
	`<div class="group-head"><span class="group-head__label">${esc(label)}</span><span class="group-head__rule"></span><span class="group-head__count">${esc(count)}</span>${actions ? `<span class="group-head__actions">${actions}</span>` : ''}</div>${note ? `<p class="group-note">${note}</p>` : ''}`;

/** The site's five surfaces, one panel each. */
export class LearnPages {
	private readonly panels = new Map<string, vscode.WebviewPanel>();

	constructor(private readonly context: vscode.ExtensionContext) { }

	async home(restored?: vscode.WebviewPanel): Promise<void> {
		this.open('home', LEARN_HOME_VIEW_TYPE, 'Temco Learn', homeBody(await readLearnFacts(this.context)), restored);
	}

	/**
	 * *An article* — the published site itself.
	 *
	 * A reader's page is the file a release put on disk, so this opens that rather than drawing a second copy of it:
	 * a preview that can disagree with the shipped page is worse than no preview.
	 */
	async article(restored?: vscode.WebviewPanel): Promise<void> {
		const facts = await readLearnFacts(this.context);
		const newest = facts.releases[0];
		if (newest === undefined) {
			this.open('article', LEARN_ARTICLE_VIEW_TYPE, 'Article', `${pageHead({
				title: 'Nothing is published yet',
				mark: 'document',
				desc: 'A reader\u2019s page is a file a release put on disk. Build the site and publish it, and this opens the site itself.',
				actions: button('Build the Site', 'temcoDocs.buildSite', { kind: 'primary', mark: 'play' }) + button('Publish', 'temcoDocs.publishRelease', { mark: 'upload' })
			})}${hero({ tone: 'warn', title: 'No published version', desc: 'The build writes the site; publishing copies it to a folder a reader can open. Until both have happened there is no page to read.', actions: button('Open Build Center', 'temcoDocs.builds', { kind: 'primary', mark: 'play' }) })}`, restored);
			return;
		}
		await vscode.commands.executeCommand('temcoDocs.openPublished', newest.destination);
	}

	async downloads(restored?: vscode.WebviewPanel): Promise<void> {
		this.open('downloads', LEARN_DOWNLOADS_VIEW_TYPE, 'Downloads', downloadsBody(await readLearnFacts(this.context)), restored);
	}

	dispose(): void {
		for (const panel of this.panels.values()) {
			panel.dispose();
		}
		this.panels.clear();
	}

	private open(key: string, viewType: string, title: string, body: string, restored?: vscode.WebviewPanel): void {
		const html = page(body, { title, script: commandScript });
		const existing = this.panels.get(key);
		if (existing) {
			existing.reveal(pageColumn());
			existing.webview.html = html;
			return;
		}
		const panel = restored ?? vscode.window.createWebviewPanel(viewType, title, pageColumn(), {
			enableScripts: true,
			localResourceRoots: []
		});
		panel.webview.options = { enableScripts: true, localResourceRoots: [] };
		panel.iconPath = new vscode.ThemeIcon('cloud-upload');
		panel.webview.onDidReceiveMessage(runCommand);
		panel.webview.html = html;
		this.panels.set(key, panel);
		panel.onDidDispose(() => this.panels.delete(key));
	}
}

/** How long ago something was published, in words a reader reads at a glance. */
function since(iso: string): string {
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

/** *Home* — what the documentation is made of, what the builds wrote, and the one thing worth doing next. */
function homeBody(facts: LearnFacts): string {
	const newest = facts.releases[0];
	const stale = facts.areas.reduce((total, area) => total + area.stale, 0);
	const unread = facts.areas.reduce((total, area) => total + area.neverReviewed, 0);
	const built = [...facts.artifacts].sort((one, other) => String(other.builtAt).localeCompare(String(one.builtAt)));
	const next = nextStep(facts, newest, stale, unread);

	const areas = facts.areas
		.slice(0, 8)
		.map((area) =>
			entryRow({
				mark: 'folder',
				title: area.name,
				meta: [
					`${area.pages} ${area.pages === 1 ? 'page' : 'pages'}`,
					area.stale > 0 ? `${area.stale} ${area.stale === 1 ? 'page' : 'pages'} behind the code` : '',
					area.neverReviewed > 0 ? `${area.neverReviewed} never read` : ''
				].filter((part) => part !== '').join(' · '),
				command: 'temcoDocs.openRegistry',
				go: 'Open'
			})
		)
		.join('');

	const files = built
		.slice(0, 3)
		.map((artifact) =>
			entryRow({
				mark: ARTIFACT_MARK[artifact.kind] ?? 'download',
				title: artifact.path.split(/[\\/]/).pop() ?? artifact.path,
				meta: `${artifactName(artifact.kind)} · built ${since(artifact.builtAt)}`,
				command: 'temcoDocs.openArtifact',
				args: [artifact.path],
				go: 'Open'
			})
		)
		.join('');

	// The state of the set, said once and in words: a reader of this page is asking "am I looking at something
	// finished?", not "how many rows are in each table".
	const state = [
		`${facts.pages.toLocaleString('en-US')} ${facts.pages === 1 ? 'page' : 'pages'} in ${facts.areas.length} ${facts.areas.length === 1 ? 'area' : 'areas'}`,
		stale > 0 ? `${stale} behind the code` : '',
		unread > 0 ? `${unread} never read` : '',
		newest === undefined ? 'nothing published yet' : `${newest.version} published ${since(newest.publishedAt)}`
	].filter((part) => part !== '').join(' · ');

	return `${azHero({
		eyebrow: 'Temco Learn',
		title: facts.project === undefined ? 'Documentation for Temco Controls products' : facts.project,
		desc: 'This window reads one documentation set: the pages in the project it has open, the files its builds wrote, and the versions it published. Everything below is measured from those, never typed in.',
		descWide: true,
		hero: true,
		note: {
			text: state,
			mark: newest === undefined ? 'info' : 'cloud-upload',
			link: { command: newest === undefined ? 'temcoDocs.buildSite' : 'temcoDocs.releases' }
		},
		actions: [
			{ label: 'Preview the site', command: 'temcoDocs.previewSite', mark: 'play', kind: 'primary' },
			{ label: 'All pages', command: 'temcoDocs.openRegistry', kind: 'link' }
		]
	})}
${azCallout(next)}
${section({
		title: 'Pages',
		desc: facts.areas.length === 0
			? 'No area is being read yet — open a project and its areas appear here.'
			: `The areas this set is organised into${stale > 0 || unread > 0 ? ', with what needs attention' : ''}. A row opens the page list.`,
		actions: button('All pages', 'temcoDocs.openRegistry', { small: true, kind: 'ghost' })
	})}
${areas === ''
			? entryRow({ mark: 'book', title: 'Nothing is being read yet', meta: 'Open a documentation project and its areas appear here.' })
			: areas}
${section({
		title: 'Files',
		desc: built.length <= 3 ? 'What the builds wrote, newest first — these are the files a reader can be given.' : `The newest 3 of ${built.length} files a reader can be given.`,
		actions: button('Build the site', 'temcoDocs.buildSite', { small: true, kind: 'ghost' })
	})}
${files === ''
			? entryRow({ mark: 'download', title: 'No file yet', meta: 'Preview the site builds it and opens it in the reader; the offline help is a separate build.' })
			: files}`;
}

/**
 * The one thing worth doing next, decided from the state rather than promised by a slogan.
 *
 * The order is the order a person would fix them in: there has to be something to read before there is something to
 * build, something built before something published, and a published version is what a reader opens. Only when all of
 * that is true is there anything to say about the pages themselves.
 */
function nextStep(
	facts: LearnFacts,
	newest: ReleaseRow | undefined,
	stale: number,
	unread: number
): { mark: string; title: string; desc: string; actions: string } {
	if (facts.pages === 0) {
		return {
			mark: 'info',
			title: 'Nothing is being read yet',
			desc: 'Temco Learn reads the documentation registry of the project this window has open. Pick a project, and its areas, pages and their state appear here.',
			actions: button('Open the registry', 'temcoDocs.openRegistry', { kind: 'primary' })
		};
	}
	if (facts.artifacts.length === 0) {
		return {
			mark: 'play',
			title: 'The pages exist; nothing has been built yet',
			desc: 'A build turns these pages into the site, the offline help and the search index. Preview does the build and opens the result in the reader in one step.',
			actions: button('Preview the site', 'temcoDocs.previewSite', { kind: 'primary' })
		};
	}
	if (newest === undefined) {
		return {
			mark: 'cloud-upload',
			title: 'Built, but never published',
			desc: 'Publishing copies a build into a folder a reader can open. Until a version is published there is nothing to point a reader at.',
			actions: button('Publish a version', 'temcoDocs.releases', { kind: 'primary' })
		};
	}
	if (stale > 0) {
		return {
			mark: 'warning',
			title: `${stale} ${stale === 1 ? 'page is' : 'pages are'} behind ${stale === 1 ? 'its' : 'their'} code`,
			desc: `These pages cite code that has changed since they were written, so the words may describe something that no longer exists. ${newest.version} is the last version published, ${since(newest.publishedAt)}.`,
			actions: button('Review them', 'temcoDocs.stalenessReport', { kind: 'primary' })
		};
	}
	if (unread > 0) {
		return {
			mark: 'history',
			title: `${unread} ${unread === 1 ? 'page has' : 'pages have'} never been read`,
			desc: `Nothing is behind its code. ${newest.version} was published ${since(newest.publishedAt)}; the pages nobody has opened are the ones most likely to be wrong.`,
			actions: button('See them', 'temcoDocs.overview', { kind: 'primary' })
		};
	}
	return {
		mark: 'check',
		title: 'Everything is current',
		desc: `${facts.pages} ${facts.pages === 1 ? 'page' : 'pages'} across ${facts.areas.length} ${facts.areas.length === 1 ? 'area' : 'areas'}, none behind its code and none unread. ${newest.version} was published ${since(newest.publishedAt)}.`,
		actions: button('Open the site', 'temcoDocs.openPublished', { kind: 'primary' })
	};
}

/** *Downloads* — the files the builds left, which is what a reader can have offline. */
function downloadsBody(facts: LearnFacts): string {
	const kinds = [...new Set(facts.artifacts.map((artifact) => artifact.kind))];

	const fileRow = (artifact: { kind: string; path: string; builtAt: string }): string =>
		`<div class="record-row">${toneMarkOf(ARTIFACT_MARK[artifact.kind] ?? 'download', 'accent')}<div class="record-row__main"><div class="record-row__title"><span class="record-row__name cell-mono">${esc(artifact.path.split(/[\\/]/).pop() ?? artifact.path)}</span><span class="tag">${esc(artifactName(artifact.kind))}</span></div><div class="record-row__meta"><span class="cell-mono">${esc(artifact.path)}</span> · <span>built ${esc(since(artifact.builtAt))}</span></div></div><div class="record-row__state">${badge('Ready', 'ok')}</div>${button('Open', 'temcoDocs.openArtifact', { small: true, kind: 'primary', mark: 'download', args: [artifact.path] })}</div>`;

	const sections = kinds.map((kind) => {
		const files = facts.artifacts.filter((artifact) => artifact.kind === kind);
		return `<div class="mt-24">${rule(artifactName(kind), `${files.length} ${files.length === 1 ? 'file' : 'files'}`, 'The file stays where the build wrote it. A downloadable CHM or PDF needs nothing else.')}<div class="record-list">${files.map(fileRow).join('')}</div></div>`;
	}).join('');

	return `${pageHead({
		title: 'Downloads',
		mark: 'download',
		desc: 'The offline files the builds left. A version stays openable after a newer one ships — and which versions were published is on Releases, so the list here is files only.',
		actions: button('Build the Site', 'temcoDocs.buildSite', { kind: 'primary', mark: 'play' }) + button('Build the Offline Help', 'temcoDocs.buildHelp', { mark: 'package' }) + button('Releases', 'temcoDocs.releases', { mark: 'cloud-upload' })
	})}
${facts.artifacts.length === 0
			? `<div class="mt-16"><div class="callout">${icon('info')}<div><b>Nothing has been built yet.</b> The CHM and the PDF are files a build writes — the build runs the repository\u2019s own script and then looks for the file it should have left. Build one, and it is listed here.</div></div></div>`
			: sections}`;
}

/** A tone mark, since this module's UI copy does not export one. */
function toneMarkOf(mark: string, tone?: 'accent' | 'ok' | 'warn' | 'err' | 'info'): string {
	return `<span class="tone-mark${tone ? ` tone-mark--${tone}` : ''}">${icon(mark, 'icon--sm')}</span>`;
}
