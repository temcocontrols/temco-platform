// The Documentation module's pages.
//
// The eleven surfaces the Documentation container has (Projects, Repositories, a repository, Sources, Documents,
// a page, a source, Review Center, Build Center and Releases). The markup, the groups, the words and the
// order came from the mock (`docs/mock/js/views.docs.js`); the data is now the platform's own — the catalog, the
// registries this window reads, and the clones in the working area — so an empty platform draws empty lists
// rather than a demonstration.

import * as fs from 'fs';
import * as path from 'path';
import * as vscode from 'vscode';
import { DocsRoot, PageEntry, collectPages } from './registry';
import { capturesOf } from './media';
import { pagesTarget } from './pages';
import { firstVersionReport } from './versionReport';
import { BuildRow, Catalog, DocumentRow, DraftRow, ReleaseRow, ScanRow, selection, slugOf } from './store';
import { callout as azCallout, cards, commandScript, entryRow, escapeHtml as esc, hero, icon, numbers, page, pageColumn, runCommand, section, toneMark } from './ui';

/** The view types, one per surface. `pagePanel` is a panel this dashboard opens, not the editor's `temcoEditor.markdown`. */
export const PROJECTS_VIEW_TYPE = 'temcoDocs.projects';
export const REPOSITORY_VIEW_TYPE = 'temcoDocs.repository';
export const DOCUMENTS_VIEW_TYPE = 'temcoDocs.documents';
export const PAGE_VIEW_TYPE = 'temcoDocs.pagePanel';
export const SOURCE_VIEW_TYPE = 'temcoDocs.source';
export const REVIEW_VIEW_TYPE = 'temcoDocs.review';
export const BUILDS_VIEW_TYPE = 'temcoDocs.builds';
export const RELEASES_VIEW_TYPE = 'temcoDocs.releases';
export const EXPORTS_VIEW_TYPE = 'temcoDocs.exports';
export const REGISTRY_VIEW_TYPE = 'temcoDocs.registryPage';

interface ActionOptions {
	kind?: 'primary' | 'ghost';
	mark?: string;
	args?: unknown;
	small?: boolean;
	title?: string;
}

const button = (label: string, command: string, options: ActionOptions = {}): string =>
	`<button type="button" class="btn${options.small ? ' btn--sm' : ''}${options.kind ? ` btn--${options.kind}` : ''}" data-command="${command}"${options.args === undefined ? '' : ` data-args="${esc(JSON.stringify(options.args))}"`}${options.title ? ` title="${esc(options.title)}"` : ''}>${options.mark ? icon(options.mark) : ''}<span>${esc(label)}</span></button>`;

/** The same act in the page language: a section heading's own buttons, and a card's. */
const azButton = (label: string, command: string, options: ActionOptions = {}): string =>
	`<button type="button" class="az-btn${options.small === true ? ' az-btn--sm' : ''}${options.kind === 'primary' ? ' az-btn--primary' : ''}" data-command="${command}"${options.args === undefined ? '' : ` data-args="${esc(JSON.stringify(options.args))}"`}${options.title ? ` title="${esc(options.title)}"` : ''}>${options.mark ? icon(options.mark) : ''}<span>${esc(label)}</span></button>`;

/**
 * One line of the page language's own list: the mark, the thing, its facts, and the acts that settle it.
 *
 * The kit's `entryRow` carries one way in, and a queue row carries two (accept, discard), a build carries its state.
 * So this is the same `.az-entry` markup with the right-hand cell written by the page, which is what keeps a list of
 * rows on the same rhythm as the cards and headings above it without a second row style in the product.
 */
const azRow = (options: { mark?: string; tone?: 'ok' | 'warn' | 'err' | 'info' | 'accent'; title: string; mono?: boolean; tag?: string; meta?: string; actions?: string; command?: string; args?: unknown; go?: string }): string => {
	const plain = options.command === undefined;
	const attr = plain ? '' : ` data-command="${options.command}"${options.args === undefined ? '' : ` data-args="${esc(JSON.stringify(options.args))}"`}`;
	const mark = options.mark === undefined ? '' : `<span class="az-entry__icon">${toneMark(options.mark, options.tone)}</span>`;
	const tag = options.tag === undefined ? '' : `<span class="tag">${esc(options.tag)}</span>`;
	const meta = options.meta === undefined ? '' : `<span class="az-entry__meta">${options.meta}</span>`;
	const end = options.actions ?? (plain ? '' : `<span class="az-entry__go">${esc(options.go ?? 'Open')}${icon('chevron-right', 'icon--sm')}</span>`);
	return `<div class="az-entry${plain ? '' : ' az-entry--action'}"${attr}>${mark}<div class="az-entry__main"><span class="az-entry__title${options.mono === true ? ' cell-mono' : ''}">${esc(options.title)}${tag}</span>${meta}</div>${end}</div>`;
};

/** The rows of one section, in the kit's spacing. */
const azEntries = (rows: readonly string[]): string => `<div class="az-entries">${rows.join('')}</div>`;

/**
 * The project page's own layout: two columns of blocks, which is what a wide tab is for.
 *
 * Sources beside Outputs, and what left the building beside what changed — the four things a person reads before a
 * build. Under 1100px the columns fold into one, in the same order.
 */
const DETAIL_CSS = `
.detail-grid { display: grid; grid-template-columns: minmax(0, 1fr) minmax(0, 1fr); align-items: start;
  gap: var(--sp-5) var(--sp-8); margin-top: var(--sp-4); }
.detail-block { min-width: 0; }
.detail-block .az-section { margin-top: 0; }
@media (max-width: 1100px) {
  .detail-grid { grid-template-columns: minmax(0, 1fr); }
}
`;

/** A string a person reads, marked for translation. Bundles arrive from the build; without one this is the text. */
const t = (message: string): string => vscode.l10n.t(message);

const rule = (options: { label: string; count?: string; note?: string; actions?: string; plain?: boolean }): string =>
	`<div class="group-head"><span class="group-head__label${options.plain ? ' group-head__label--plain' : ''}">${esc(options.label)}</span><span class="group-head__rule"></span>${options.count ? `<span class="group-head__count">${esc(options.count)}</span>` : ''}${options.actions ? `<span class="group-head__actions">${options.actions}</span>` : ''}</div>${options.note ? `<p class="group-note">${options.note}</p>` : ''}`;

const group = (options: { label: string; count?: string; note?: string; actions?: string; body: string; plain?: boolean }): string =>
	rule(options) + `<div class="record-list">${options.body}</div>`;

const pageHead = (options: { eyebrow?: string; title: string; mark?: string; desc?: string; actions?: string }): string =>
	`<div class="page-head"><div class="page-head__main">${options.eyebrow ? `<div class="eyebrow">${esc(options.eyebrow)}</div>` : ''}<h1 class="page-head__title">${options.mark ? icon(options.mark) : ''}${esc(options.title)}</h1>${options.desc ? `<p class="page-head__desc">${options.desc}</p>` : ''}</div>${options.actions ? `<div class="page-head__actions">${options.actions}</div>` : ''}</div>`;

const tiles = (items: { value: string; label: string }[]): string =>
	`<div class="tiles">${items.map((item) => `<div class="tile"><span class="tile__value">${esc(item.value)}</span><span class="tile__label">${esc(item.label)}</span></div>`).join('')}</div>`;

const card = (options: { title: string; mark?: string; actions?: string; desc?: string; body?: string; foot?: string; plain?: boolean }): string =>
	`<div class="card${options.plain ? ' card--plain' : ''}"><div class="card__head">${options.mark ? `<span class="card__icon">${icon(options.mark)}</span>` : ''}<div class="card__title">${esc(options.title)}</div>${options.actions ? `<div class="card__actions">${options.actions}</div>` : ''}</div>${options.desc ? `<p class="card__desc">${options.desc}</p>` : ''}${options.body ?? ''}${options.foot ? `<div class="card__foot">${options.foot}</div>` : ''}</div>`;

const badge = (text: string, tone?: string): string =>
	`<span class="badge${tone && tone !== 'neutral' ? ` badge--${tone}` : ''}">${esc(text)}</span>`;

const list = (items: { mark: string; title: string; sub: string; meta?: string; command?: string; args?: unknown }[]): string =>
	`<div class="list">${items.map((item) => `<div class="list__item${item.command === undefined ? '' : ' list__item--action'}"${item.command === undefined ? '' : ` data-command="${item.command}" data-args="${esc(JSON.stringify(item.args ?? []))}"`}>${icon(item.mark)}<div class="list__main"><div class="list__title">${esc(item.title)}</div><div class="list__sub">${item.sub}</div></div>${item.meta ? `<div class="list__meta">${item.meta}</div>` : ''}</div>`).join('')}</div>`;

const callout = (html: string, kind?: 'warn' | 'ok'): string =>
	`<div class="callout${kind ? ` callout--${kind}` : ''}">${icon(kind === 'warn' ? 'alert' : kind === 'ok' ? 'check' : 'info')}<div>${html}</div></div>`;

/** A row of facts, as the mock writes one under a group. */
const factRow = (mark: string, title: string, note: string): string =>
	`<div class="record-row record-row--static">${toneMark(mark)}<div class="record-row__main"><div class="record-row__title"><span class="record-row__name">${esc(title)}</span></div><div class="record-row__meta"><span>${esc(note)}</span></div></div><div class="record-row__state"></div><div class="record-row__state"></div></div>`;

/** Facts on one line, each keeping its trailing dot so a count never breaks in half. */
const facts = (items: string[]): string =>
	items.map((item, index) => `<span>${esc(item)}${index < items.length - 1 ? ' ·' : ''}</span>`).join(' ');

const settingsStrip = (entries: { label: string; value: string; mono?: boolean }[], wide = false): string =>
	`<div class="settings-strip${wide ? ' settings-strip--wide' : ''}">${entries.map((entry) => `<div><div class="settings-strip__label">${esc(entry.label)}</div><div class="settings-strip__value${entry.mono ? ' cell-mono' : ''}">${esc(entry.value)}</div></div>`).join('')}</div>`;

const table = (head: string[], rows: string[][], rowCommand?: (index: number) => { command: string; args?: unknown } | undefined): string =>
	`<div class="table-wrap table-wrap--plain"><table class="table table--compact"><thead><tr>${head.map((cell) => `<th>${esc(cell)}</th>`).join('')}</tr></thead><tbody>${rows.map((cells, index) => {
		const action = rowCommand?.(index);
		return `<tr${action ? ` data-command="${action.command}"${action.args === undefined ? '' : ` data-args="${esc(JSON.stringify(action.args))}"`} style="cursor:pointer"` : ''}>${cells.map((cell) => `<td>${cell}</td>`).join('')}</tr>`;
	}).join('')}</tbody></table></div>`;

/** One file a build left. */
interface ArtifactFact {
	kind: string;
	path: string;
	builtAt: string;
}

/** What the Build Center and Releases show: the builds of the project on, every file they left, and releases. */
export interface BuildFacts {
	project?: string;
	builds: BuildRow[];
	artifacts: ArtifactFact[];
	releases: ReleaseRow[];
	/** Where the site would publish, when the folder has a GitHub remote: the only thing Deploy needs to know. */
	publish?: { owner: string; repo: string; base: string; branch: string };
}

/** The module's pages: one panel per surface, kept open so a second visit reveals the tab. */
export class DocsPages {
	private readonly panels = new Map<string, vscode.WebviewPanel>();

	constructor(private readonly context: vscode.ExtensionContext, private readonly roots: () => readonly DocsRoot[]) { }

	open(key: string, viewType: string, title: string, body: string, mark = 'document', extraCss?: string): void {
		const existing = this.panels.get(key);
		if (existing) {
			existing.reveal(pageColumn());
			existing.webview.html = page(body, { title, script: commandScript, extraCss });
			return;
		}
		const panel = vscode.window.createWebviewPanel(viewType, title, pageColumn(), {
			enableScripts: true,
			localResourceRoots: []
		});
		panel.iconPath = vscode.Uri.joinPath(this.context.extensionUri, 'media', `${mark}.svg`);
		panel.webview.onDidReceiveMessage(runCommand);
		panel.webview.html = page(body, { title, script: commandScript, extraCss });
		this.panels.set(key, panel);
		panel.onDidDispose(() => this.panels.delete(key));
	}

	projects(): void {
		void this.openProjects();
	}

	/** The projects the catalog holds, the one the window is on, and the sources attached to it. */
	private async openProjects(): Promise<void> {
		let documents: DocumentRow[] = [];
		let linked: { name: string; kind: string; branch?: string }[] = [];
		let catalog: Catalog | undefined;
		try {
			catalog = await Catalog.open(this.context);
			documents = catalog.documents();
			const current = selection.project() ?? (documents.length === 1 ? documents[0].slug : undefined);
			linked = current === undefined ? [] : catalog.documentSources(current);
		} catch {
			// A catalog that cannot be read shows no projects, which is honest: none is known to exist.
		} finally {
			catalog?.close();
		}
		this.open('projects', PROJECTS_VIEW_TYPE, 'Projects', projectsBody(documents, selection.project(), linked));
	}

	/** The project the window is on, as a page: what it is made of, what it produces, and the acts on it. */
	project(slug?: string): void {
		void this.openProjectPage(slug);
	}

	private async openProjectPage(wanted?: string): Promise<void> {
		let name = wanted ?? '';
		let projectVersion = '';
		let sources: { name: string; kind: string; branch?: string }[] = [];
		let outputs: string[] = [];
		let drafts: DraftRow[] = [];
		let catalog: Catalog | undefined;
		try {
			catalog = await Catalog.open(this.context);
			const documents = catalog.documents();
			const slug = wanted ?? selection.project() ?? documents[0]?.slug;
			if (slug !== undefined) {
				const detail = catalog.document(slug);
				name = detail?.name ?? slug;
				projectVersion = detail?.version ?? '';
				sources = catalog.documentSources(slug);
				outputs = Array.isArray(detail?.outputs) ? detail.outputs : [];
				drafts = catalog.drafts(slug);
			}
		} catch {
			// A catalog that cannot be read still leaves the sets being read, and this page shows those.
		} finally {
			catalog?.close();
		}

		const pages = this.roots().flatMap((root) => collectPages(root));
		const stale = pages.filter((page) => page.provenance?.stale === true).length;
		const never = pages.filter((page) => page.reviewed === null).length;
		const version = await firstVersionReport(this.roots());
		const changed = version?.report.changed ?? [];
		// The same facts the Build Center and the Releases page read: one answer per question, three places that show it.
		const facts = await this.buildFacts();
		const lastBuild = facts.builds[0];
		const lastRelease = facts.releases[0];

		const body = `${hero({
			mark: 'layers',
			title: name === '' ? 'No project yet' : name,
			desc: projectVersion === ''
				? 'What this project cites, what it produces, and the acts on it. Nothing is published from here.'
				: `Version ${projectVersion}. What this project cites, what it produces, and the acts on it. Nothing is published from here.`,
			descWide: true,
			actions: name === ''
				? [{ label: 'Create a project', command: 'temcoProjects.newProject', kind: 'primary', mark: 'plus' }]
				: [
					{ label: 'New page', command: 'temcoDocs.newPage', kind: 'primary', mark: 'plus' },
					{ label: 'New chapter', command: 'temcoDocs.newChapter', mark: 'folder' },
					{ label: 'Add a source', command: 'temcoProjects.addSource', mark: 'repo' },
					{ label: 'Build the site', command: 'temcoDocs.buildSite', mark: 'play' },
					{ label: 'Review center', command: 'temcoDocs.review', mark: 'check' },
					{ label: 'Edit the project', command: 'temcoProjects.editProject', args: [name], mark: 'gear' }
				]
		})}
${drafts.length === 0
			? azCallout({
				mark: 'check',
				title: 'Nothing is waiting',
				desc: never === 0 && stale === 0
					? 'No draft is unsettled, no page unreviewed, no screenshot stale.'
					: `${never} ${never === 1 ? 'page has' : 'pages have'} never been reviewed and ${stale} ${stale === 1 ? 'claims' : 'claim'} code that has moved since.`
			})
			: `${section({ title: 'Needs you', desc: 'Drafts the local model wrote that no person has settled yet. Opening one shows it beside the page it would change.', actions: azButton('Open the Review Center', 'temcoDocs.review', { kind: 'primary', mark: 'check' }) })}
<div class="az-entries">${drafts.slice(0, 5).map((draft) => entryRow({
				mark: 'sparkle',
				title: draft.title === '' ? draft.pageId : draft.title,
				meta: `${draft.pageId} · ${draft.kind}`,
				command: 'temcoDocs.review',
				go: 'Review'
			})).join('')}</div>`}
${pages.length === 0 ? '' : `<div class="detail-block">${section({ title: 'Pages', desc: `${pages.length} page${pages.length === 1 ? '' : 's'} in this project. The tree lists all of them, area by area.`, actions: azButton('Show the tree', 'temcoDocs.pages.focus', { mark: 'list' }) })}
<div class="az-entries">${pages.slice(0, 10).map((page) => entryRow({
				mark: 'document',
				title: page.title,
				meta: page.id,
				command: 'temcoDocs.openFile',
				args: [page.uri.fsPath],
				go: 'Open'
			})).join('')}</div></div>`}
<div class="detail-grid">
<div class="detail-block">
${section({ title: 'Sources', desc: 'What this project cites — a folder on this machine, or one read over the API.', actions: azButton('Add a source', 'temcoProjects.addSource', { mark: 'plus' }) })}
<div class="az-entries">${sources.length === 0
			? entryRow({ mark: 'plus', title: 'Add a source', meta: 'a folder on this machine, or a repository', command: 'temcoProjects.addSource' })
			: sources.map((source) => entryRow({
				mark: source.kind === 'repository' ? 'repo' : 'folder',
				title: source.name,
				meta: `${source.kind}${source.branch === undefined ? '' : ` · ${source.branch}`}`,
				command: 'temcoDocs.source',
				args: [source.name]
			})).join('')}</div>
</div>
<div class="detail-block">
${section({ title: 'Outputs', desc: outputs.length === 0 ? 'This project has not said what it produces yet.' : `It produces: ${outputs.join(' · ')}.`, actions: azButton('Build the site', 'temcoDocs.buildSite', { mark: 'play' }) + azButton('Build the offline help', 'temcoDocs.buildHelp', { mark: 'package' }) })}
<div class="az-entries">
	${entryRow({ mark: 'package', title: 'Site', meta: 'the rendered copy a reader browses', command: 'temcoDocs.builds' })}
	${entryRow({ mark: 'package', title: 'Offline help', meta: 'the CHM that ships inside the installer', command: 'temcoDocs.builds' })}
</div>
</div>
<div class="detail-block">
${lastBuild === undefined && lastRelease === undefined ? '' : `${section({
				title: 'Last out of the building',
				desc: 'A build is the attempt, with the files it left; a release is the copy a reader can be given. Both are recorded when they happen, never inferred.',
				actions: lastRelease === undefined
					? azButton('Build the site', 'temcoDocs.buildSite', { mark: 'play' }) + azButton('Build Center', 'temcoDocs.builds', { mark: 'list' })
					: azButton('Open', 'temcoDocs.openPublished', { mark: 'globe', args: [lastRelease.destination] }) + azButton('Serve', 'temcoDocs.servePublished', { mark: 'server', args: [lastRelease.destination] }) + azButton('Publish & Releases', 'temcoDocs.releases', { mark: 'upload' })
			})}
<div class="az-entries">
	${lastBuild === undefined ? '' : entryRow({ mark: 'play', title: `build #${lastBuild.id}`, meta: `${lastBuild.status} · ${lastBuild.finishedAt ?? lastBuild.startedAt}`, command: 'temcoDocs.builds' })}
	${lastRelease === undefined ? '' : entryRow({ mark: 'upload', title: lastRelease.version, meta: `published · ${lastRelease.files} ${lastRelease.files === 1 ? 'file' : 'files'} · ${lastRelease.destination}`, command: 'temcoDocs.releases' })}
</div>`}
</div>
<div class="detail-block">
${changed.length === 0 ? '' : `${section({ title: `Changed in ${version?.report.version ?? 'the new version'}`, desc: 'Named by the workflow that produced this version. Nothing here is inferred by this application.' })}
<div class="az-entries">${changed.slice(0, 20).map((change) => {
				const page = change.page === undefined ? undefined : pages.find((entry) => entry.id === change.page);
				return entryRow({
					mark: 'branch',
					title: change.title ?? page?.title ?? change.page ?? 'a page',
					meta: (change.code ?? []).join(' · ') || 'the code moved',
					command: page === undefined ? undefined : 'temcoDocs.openFile',
					args: page === undefined ? undefined : [page.uri.fsPath]
				});
			}).join('')}</div>`}
</div>
</div>`;

		this.open('project', 'temcoDocs.projectPage', name === '' ? 'Project' : name, body, 'folders', DETAIL_CSS);
	}

	/** The queue as a page: the three kinds of work, each with the act that settles it. */
	needsYou(): void {
		void this.openNeedsPage();
	}

	private async openNeedsPage(): Promise<void> {
		const roots = this.roots();
		const pages = roots.flatMap((root) => collectPages(root));
		const captures = await capturesOf(roots);
		const stale = pages.filter((page) => page.provenance?.stale === true);
		const never = pages.filter((page) => page.reviewed === null);

		const empty = captures.length === 0 && stale.length === 0 && never.length === 0;
		const body = `${pageHead({
			eyebrow: 'Dashboard',
			title: 'Needs You',
			mark: 'check',
			desc: 'What is waiting on a person. A row opens the page that needs the work; nothing is written from here.',
			actions: button('Capture a Screenshot', 'temcoDocs.captureImage', { kind: 'primary', mark: 'panel' })
		})}
${empty ? `<div class="mt-16">${callout('Nothing is waiting: no screenshot without a page, no page the code moved away from, no page unreviewed.')}</div>` : ''}
${captures.length === 0 ? '' : `<div class="mt-24">${group({
			label: 'Screenshots to place',
			count: String(captures.length),
			note: 'Taken with no page in front. Attaching one moves it into that page’s media/ and inserts the reference.',
			body: list(captures.map((capture) => ({
				mark: 'panel',
				title: path.basename(capture.uri.fsPath),
				sub: 'not in a page yet',
				command: 'temcoDocs.attachCapture',
				args: [capture.uri.fsPath],
			}))),
		})}</div>`}
${stale.length === 0 ? '' : `<div class="mt-24">${group({
			label: 'Retake these',
			count: String(stale.length),
			note: 'The code these pages claim has changed since they were last reviewed.',
			body: list(stale.slice(0, 20).map((page) => ({
				mark: 'warning',
				title: page.title,
				sub: `${page.area}${page.chapter === '' ? '' : ` › ${page.chapter}`} · its code moved`,
				command: 'temcoDocs.openFile',
				args: [page.uri.fsPath],
			}))),
		})}</div>`}
${never.length === 0 ? '' : `<div class="mt-24">${group({
			label: 'Never reviewed',
			count: String(never.length),
			note: 'No review date is recorded. The report groups them by owner.',
			actions: button('Open the Report', 'temcoDocs.stalenessReport', { mark: 'list' }),
			body: list(never.slice(0, 20).map((page) => ({
				mark: 'clock',
				title: page.title,
				sub: `${page.area}${page.chapter === '' ? '' : ` › ${page.chapter}`}`,
				command: 'temcoDocs.openFile',
				args: [page.uri.fsPath],
			}))),
		})}</div>`}`;

		this.open('needs', 'temcoDocs.needsPage', 'Needs You', body, 'tasklist');
	}

	repository(name?: string): void {
		void this.openRepository(name);
	}

	/** Every repository source, with its clone, its reads, its scripts and the pages the last read recorded. */
	private async repositoryFacts(): Promise<RepositoryFact[]> {
		const facts: RepositoryFact[] = [];
		let catalog: Catalog | undefined;
		try {
			catalog = await Catalog.open(this.context);
			for (const source of catalog.sources().filter((row) => row.kind === 'git')) {
				const detail = catalog.source(source.slug);
				const clone = detail?.path;
				facts.push({
					slug: source.slug,
					name: source.name,
					kind: source.kind,
					remoteUrl: detail?.remoteUrl,
					branch: detail?.branch ?? source.branch,
					defaultBranch: detail?.defaultBranch,
					docsRoot: detail?.docsRoot,
					path: clone,
					cloned: clone !== undefined && fs.existsSync(clone),
					pages: source.pages ?? 0,
					state: source.state,
					reads: catalog.scans(source.slug),
					pageRows: detail === undefined ? [] : catalog.pagesFor(detail.id),
					files: clone === undefined ? [] : pageFiles(clone, detail?.docsRoot),
					scripts: clone === undefined ? [] : docScripts(clone)
				});
			}
		} catch {
			// No catalog, no repositories: the list is empty rather than invented.
		} finally {
			catalog?.close();
		}
		return facts;
	}

	private async openRepository(name: string | undefined): Promise<void> {
		const facts = await this.repositoryFacts();
		const fact = facts.find((candidate) => candidate.slug === name || candidate.name === name) ?? facts[0];
		this.open(`repository:${fact?.slug ?? 'none'}`, REPOSITORY_VIEW_TYPE, fact?.name ?? 'Repository', repositoryBody(fact));
	}

	documents(area?: string): void {
		this.open('documents', DOCUMENTS_VIEW_TYPE, 'Documents', documentsBody(this.roots(), area));
	}

	pageOf(title?: string, area?: string): void {
		void this.openPage(title, area);
	}

	/** One page, read from the registry and the file behind it — never from a sample. */
	private async openPage(title: string | undefined, area: string | undefined): Promise<void> {
		const body = await pageBody(this.roots(), title, area);
		this.open(`page:${body.title}`, PAGE_VIEW_TYPE, body.title, body.html);
	}

	source(repo?: string): void {
		void this.openSource(repo);
	}

	/** The files behind the pages of one repository, read from its clone. */
	private async openSource(repo: string | undefined): Promise<void> {
		const facts = await this.repositoryFacts();
		const fact = facts.find((candidate) => candidate.slug === repo || candidate.name === repo) ?? facts[0];
		this.open(`source:${fact?.slug ?? 'none'}`, SOURCE_VIEW_TYPE, 'Source Explorer', sourceBody(fact));
	}

	/** Whether a page is open, so a caller can decide to redraw it rather than open it. */
	isOpen(key: string): boolean {
		return this.panels.has(key);
	}

	review(): void {
		void this.openReview();
	}

	exports(): void {
		void this.openExports();
	}

	registry(): void {
		void this.openRegistryPage();
	}

	/**
	 * The queue, read from the catalog rather than from the mock.
	 *
	 * A draft is the only thing that waits for a person: a page that was written is a page, and a page that was
	 * never written has no diff to weigh. So the Review Center lists exactly the unsettled drafts of the project
	 * the window is on, and says so when there are none.
	 */
	/**
	 * The three shapes an export can take, with what each one leaves behind.
	 *
	 * This was a three-line quick pick. A picker answers "which one?" but not "what will I get?", and an export is the one
	 * step of the whole flow that happens *outside* this application — so the page says, per shape, the file it writes, what
	 * is inside it and who it is for, then lets the reader press the button.
	 */
	private async openExports(): Promise<void> {
		const facts = await this.buildFacts();
		const pages = this.roots().flatMap((root) => collectPages(root)).filter((page) => page.exists);
		const where = '<code>dist/</code> in the project folder';

		const shape = (options: { title: string; mark: string; desc: string; command: string; label: string; inside: string; when: string }): string =>
			card({
				title: options.title,
				mark: options.mark,
				plain: true,
				desc: options.desc,
				body: `<div class="record-list">
	<div class="record-row record-row--static">${toneMark(options.mark)}<div class="record-row__main"><div class="record-row__title"><span class="record-row__name">What you get</span></div><div class="record-row__meta">${options.inside}</div></div><div class="record-row__state"></div>${button(options.label, options.command, { kind: 'primary', mark: options.mark })}</div>
	<div class="record-row record-row--static">${toneMark('book')}<div class="record-row__main"><div class="record-row__title"><span class="record-row__name">Reach for it when</span></div><div class="record-row__meta">${options.when}</div></div></div>
</div>`
			});

		const body = `${pageHead({
			eyebrow: facts.project === undefined ? 'No project selected' : `${esc(facts.project)} · export`,
			title: 'Exports',
			mark: 'download',
			desc: 'What leaves this application, and in what shape. Nothing here is uploaded: every export is a file written to the project folder, and the only network step is Publish.',
			actions: button('Export the Site', 'temcoDocs.exportSite', { kind: 'primary', mark: 'download' }) + button('Back to Publish & Releases', 'temcoDocs.releases', { mark: 'upload' })
		})}
${tiles([
			{ value: String(pages.length), label: pages.length === 1 ? 'page' : 'pages' },
			{ value: '4', label: 'shapes' },
			{ value: 'dist/', label: 'where it lands' }
		])}
<div class="mt-24">${shape({
			title: 'The site, as a zip',
			mark: 'download',
			desc: 'The finished website in one archive — the same pages the built site has, before they are served from anywhere.',
			command: 'temcoDocs.exportSite',
			label: 'Export the Site',
			inside: '<code>index.html</code>, <code>assets/site.css</code>, every page, and each page’s <code>media/</code>',
			when: 'A colleague wants the website itself, or it is going to a static host you do not publish to from here.'
		})}</div>
<div class="mt-24">${shape({
			title: 'One page, as one file',
			mark: 'document',
			desc: 'A single HTML file with the stylesheet and every picture inside it, so it opens on a machine that has never seen this project.',
			command: 'temcoDocs.exportPage',
			label: 'Export a Page',
			inside: `one <code>.html</code> file per page — it asks which page, then writes <code>dist/&lt;page&gt;-&lt;date&gt;.html</code>`,
			when: 'A page has to survive an e-mail, a chat message or a support ticket. It keeps working with the network unplugged.'
		})}</div>
<div class="mt-24">${shape({
			title: 'One page, as a Word document',
			mark: 'document',
			desc: 'A .docx a reviewer can open, comment on and send back — the format people outside the team ask for.',
			command: 'temcoDocs.exportDocx',
			label: 'Export a Page as Word',
			inside: 'one <code>.docx</code> per page — headings, lists, tables and the page’s pictures, embedded',
			when: 'A reviewer works in Word, or the page has to be marked up by someone who will not read Markdown.'
		})}</div>
<div class="mt-24">${shape({
			title: 'The pages, as a Markdown bundle',
			mark: 'layers',
			desc: 'The sources, with their pictures and the registry, in a tree another tool can open.',
			command: 'temcoDocs.exportMarkdown',
			label: 'Export the Sources',
			inside: 'every <code>.md</code>, each folder’s <code>media/</code>, and <code>registry.json</code>',
			when: 'The documentation moves to another tool, or you want an archive of the sources as they are today.'
		})}</div>
<div class="mt-24">${callout(`<b>Every export lands in ${where}</b>, and the notification offers <b>Show in Folder</b>. Nothing is uploaded and nothing leaves this machine; publishing to GitHub Pages is the separate step on the Publish & Releases page.`)}</div>`;

		this.open('exports', EXPORTS_VIEW_TYPE, 'Exports', body, 'download');
	}

	/**
	 * S6: the registry, reviewed.
	 *
	 * The registry is the file that decides what exists, what ships and in what order — and the one question people ask
	 * about it is "*why* is this page not in the site?". Opening the JSON answers that only for someone fluent in it. This
	 * page lists every registered page with the three reasons a page can be absent, and one action per reason: the file was
	 * never written (create it), the entry says it does not ship (properties), or the generator recorded a problem (read it).
	 */
	private async openRegistryPage(): Promise<void> {
		const roots = this.roots();
		const pages = roots.flatMap((root) => collectPages(root));
		const missing = pages.filter((page) => !page.exists);
		const unshipped = pages.filter((page) => page.exists && !page.ship);
		const flagged = pages.filter((page) => page.exists && page.issues.length > 0);
		const problems = roots.flatMap((root) => root.problems);

		const row = (page: PageEntry) => {
			const why = !page.exists
				? 'the file was never written'
				: page.issues.length > 0
					? page.issues.map((issue) => issue.message).join(' · ')
					: 'registered and written';
			return {
				mark: !page.exists ? 'alert' : page.issues.length > 0 ? 'warning' : page.ship ? 'check' : 'close',
				title: page.title,
				sub: `${page.id} · ${why}${page.ship ? '' : ' · does not ship'}`,
				command: page.exists ? 'temcoDocs.openFile' : 'temcoDocs.createPage',
				args: page.exists ? [page.uri.fsPath] : undefined
			};
		};

		const body = `${pageHead({
			eyebrow: 'Documentation',
			title: 'The Registry',
			mark: 'list',
			desc: 'What the registry says exists, what it ships, and why a page might not appear in the built site. The file itself is one click away; this is the same answer without reading JSON.',
			actions: button('Validate', 'temcoDocs.validate', { kind: 'primary', mark: 'check' })
				+ button('Open registry.json', 'temcoDocs.openRegistryFile', { mark: 'code' })
				+ button('Start a Registry', 'temcoDocs.startRegistry', { mark: 'plus' })
		})}
${tiles([
			{ value: String(pages.length), label: pages.length === 1 ? 'page' : 'pages' },
			{ value: String(missing.length), label: 'no file' },
			{ value: String(unshipped.length), label: 'not shipped' },
			{ value: String(flagged.length + problems.length), label: 'with problems' }
		])}
${problems.length === 0 ? '' : `<div class="mt-16">${group({
			label: 'The registry itself',
			count: String(problems.length),
			note: 'Problems that belong to the file rather than to a page.',
			body: problems.map((problem) => factRow(problem.severity === 'error' ? 'error' : 'warning', esc(problem.message), '')).join('')
		})}</div>`}
${roots.length === 0
			? `<div class="mt-16">${callout('<b>No registry is being read.</b> A documentation folder with a <code>registry.json</code> under it is what this page describes. Use <b>Start a Registry</b> to create one from what is already on disk.')}</div>`
			: roots.map((root) => `<div class="mt-24">${group({
				label: root.folder.name,
				count: `${root.pages} pages · ${root.errors} errors · ${root.warnings} warnings`,
				note: vscode.workspace.asRelativePath(root.registryUri),
				body: list(collectPages(root).map(row))
			})}</div>`).join('')}`;

		this.open('registry', REGISTRY_VIEW_TYPE, 'The Registry', body, 'list');
	}

	private async openReview(): Promise<void> {
		let project = selection.project();
		let drafts: DraftRow[] = [];
		let catalog: Catalog | undefined;
		try {
			catalog = await Catalog.open(this.context);
			if (project === undefined) {
				// Nothing is selected: a window with one project means that project, and its drafts are still real.
				const all = catalog.documents();
				project = all.length === 1 ? slugOf(all[0].name) : undefined;
			}
			drafts = project === undefined ? [] : catalog.drafts(project);
		} catch {
			// A catalog that cannot be read shows an empty queue, which is honest: nothing is known to be waiting.
		} finally {
			catalog?.close();
		}
		this.open('review', REVIEW_VIEW_TYPE, 'Review Center', reviewBody(drafts, project), 'check', PIPE_CSS);
	}

	builds(): void {
		void this.openBuilds();
	}

	releases(): void {
		void this.openReleases();
	}

	/** What the catalog knows about builds: the project on, its builds, the files they left, and its releases. */
	private async buildFacts(): Promise<BuildFacts> {
		let project = selection.project();
		let builds: BuildRow[] = [];
		let artifacts: ArtifactFact[] = [];
		let releases: ReleaseRow[] = [];
		let publish: BuildFacts['publish'];
		let catalog: Catalog | undefined;
		try {
			catalog = await Catalog.open(this.context);
			// Nothing selected and one project in the catalog means that project, which is what a lone author has.
			project = project ?? (catalog.documents().length === 1 ? catalog.documents()[0].slug : undefined);
			if (project !== undefined) {
				builds = catalog.builds(project);
				artifacts = catalog.documentArtifacts(project);
				releases = catalog.releases(project);
			}
		} catch {
			// A catalog that cannot be read shows an empty build page, which is honest: nothing is known to exist.
		} finally {
			catalog?.close();
		}
		// Where it would go: read from the documentation folder's own git remote, so the page can name the address before
		// anything is published — and say plainly when there is nowhere to publish to.
		const folder = this.roots()[0]?.folder.uri;
		if (folder !== undefined) {
			const target = await pagesTarget(folder);
			if (target !== undefined) {
				publish = { owner: target.owner, repo: target.repo, base: target.base, branch: 'gh-pages' };
			}
		}
		return { project, builds, artifacts, releases, publish };
	}

	private async openBuilds(): Promise<void> {
		this.open('builds', BUILDS_VIEW_TYPE, 'Build Center', buildsBody(await this.buildFacts()), 'play', PIPE_CSS);
	}

	private async openReleases(): Promise<void> {
		this.open('releases', RELEASES_VIEW_TYPE, 'Publish & Releases', releasesBody(await this.buildFacts()), 'upload', PIPE_CSS);
	}

	dispose(): void {
		for (const panel of this.panels.values()) {
			panel.dispose();
		}
		this.panels.clear();
	}
}

/**
 * *Projects* — the projects the catalog holds.
 *
 * A project is a row in `documents`: the sources attached to it, how many pages they declare, and what it has
 * built. Nothing on this page is a sample, so an empty catalog draws an empty list and says why.
 */
function projectsBody(
	documents: readonly DocumentRow[],
	current: string | undefined,
	linked: readonly { name: string; kind: string; branch?: string }[]
): string {
	const on = documents.find((document) => document.slug === current) ?? documents[0];

	const row = (document: DocumentRow): string => {
		const isCurrent = on !== undefined && document.slug === on.slug;
		const items = [`${document.sources} ${document.sources === 1 ? 'source' : 'sources'}`];
		if (document.version !== undefined) {
			items.unshift(`v${document.version}`);
		}
		items.push(document.builtAt === undefined ? 'never built' : `built ${waitingSince(document.builtAt)}`);
		return `<div class="record-row${isCurrent ? ' record-row--current' : ''}" data-command="temcoDocs.selectProject" data-args="${esc(JSON.stringify([document.slug]))}">${toneMark(isCurrent ? 'layers' : 'folder', isCurrent ? 'accent' : undefined)}<div class="record-row__main"><div class="record-row__title"><span class="record-row__name">${esc(document.name)}</span>${isCurrent ? badge('Current', 'accent') : ''}</div><div class="record-row__meta">${facts(items)}</div></div><div class="record-row__state">${button('Edit', 'temcoProjects.editProject', { small: true, kind: 'ghost', args: [document.slug] })}${isCurrent ? badge('Working on it', 'ok') : badge('Switch to', 'neutral')}</div><span class="record-row__go">${icon('chevron-right', 'icon--sm')}</span></div>`;
	};

	const sources = documents.reduce((total, document) => total + document.sources, 0);
	const built = documents
		.map((document) => document.builtAt)
		.filter((at): at is string => at !== undefined)
		.sort()
		.at(-1);

	return `${hero({
		eyebrow: t('Temco Platform · Documentation'),
		title: t('Projects'),
		desc: t("A project is a version of a product's documentation: its sources, its pages and the artifacts it builds. Choosing one decides what every other page is about."),
		actions: [
			{ label: t('New Project'), command: 'temcoProjects.newProject', mark: 'plus', kind: 'primary' },
			{ label: t('Import'), command: 'temcoProjects.addSource', mark: 'download' }
		]
	})}
${numbers([
			{ value: String(documents.length), label: documents.length === 1 ? t('Project') : t('Projects') },
			{ value: String(sources), label: sources === 1 ? t('Source') : t('Sources') },
			{ value: on?.version ?? t('not set'), label: t('Version') },
			{ value: built === undefined ? t('never') : waitingSince(built), label: t('Last build') }
		])}
${section({ title: t('All Projects'), desc: t('Pick one and every other page starts talking about it.') })}
${documents.length === 0
			? cards([
				{ mark: 'plus', title: 'Create a project', desc: 'A name and a version. The sources it reads come next, and every other page follows from it.', command: 'temcoProjects.newProject', go: 'New project' },
				{ mark: 'repo', title: 'Read a repository', desc: 'Point at the Temco code this documentation is written from, and cite the pages it already holds.', command: 'temcoProjects.addSource', go: 'Add a source' },
				{ mark: 'book', title: 'Open the overview', desc: 'What this workspace already holds, before you add anything to it.', command: 'temcoDocs.overview', go: 'Open the overview' }
			])
			: `<div class="record-list">${documents.map(row).join('')}</div>`}
${on === undefined ? '' : `<div class="mt-24">
${card({
				title: 'Sources of This Project',
				mark: 'repo',
				plain: true,
				actions: button('Add Source', 'temcoProjects.addSource', { small: true, kind: 'ghost', mark: 'plus' }),
				desc: `What <b>${esc(on.name)}</b> reads. Reading a source is what puts pages in the knowledge base; it never writes to the source.`,
				body: linked.length === 0
					? callout('No source is attached to this project yet. Add one, then read it: the pages it declares are what the rest of these pages list.')
					: list(linked.map((source) => ({
						mark: source.kind === 'git' ? 'repo' : source.kind === 'folder' ? 'folder' : 'package',
						title: source.name,
						sub: `<span class="cell-muted">${esc(source.kind)}${source.branch === undefined ? '' : ` · ${esc(source.branch)}`}</span>`,
						command: source.kind === 'git' ? 'temcoDocs.repository' : 'temcoRepositories.revealSource',
						args: [source.name]
					})))
			})}
</div>`}
${on === undefined ? '' : `<div class="mt-24">
${card({
				title: 'What This Project Stores',
				mark: 'gear',
				plain: true,
				actions: button('Edit Settings', 'temcoWorkbench.settings', { small: true, kind: 'ghost' }),
				desc: 'All of it in the platform database, beside the pages it is about — not in the repository.',
				body: settingsStrip([
					{ label: 'Name', value: on.name },
					{ label: 'Key', value: on.slug, mono: true },
					{ label: 'Version', value: on.version ?? 'not set', mono: true },
					{ label: 'Sources', value: String(on.sources) },
					{ label: 'Last build', value: on.builtAt === undefined ? 'never' : waitingSince(on.builtAt) },
					{ label: 'Projects', value: String(documents.length) }
				])
			})}
</div>`}`;
}

/**
 * The Markdown files under a clone's pages folder, relative to it.
 *
 * Bounded on purpose: four levels and four hundred files is more than any documentation set this platform reads,
 * and a runaway walk in a view that opens on a click is worse than a truncated list.
 */
function pageFiles(clone: string, docsRoot: string | undefined): string[] {
	const base = path.join(clone, docsRoot ?? 'docs');
	const files: string[] = [];
	const walk = (folder: string, prefix: string, depth: number): void => {
		if (depth > 4 || files.length > 400) {
			return;
		}
		let entries: fs.Dirent[];
		try {
			entries = fs.readdirSync(folder, { withFileTypes: true });
		} catch {
			return;
		}
		for (const entry of entries) {
			if (entry.name.startsWith('.') || entry.name === 'node_modules') {
				continue;
			}
			const relative = prefix === '' ? entry.name : `${prefix}/${entry.name}`;
			if (entry.isDirectory()) {
				walk(path.join(folder, entry.name), relative, depth + 1);
				continue;
			}
			if (/\.(md|markdown)$/i.test(entry.name)) {
				files.push(relative);
			}
		}
	};
	walk(base, '', 0);
	return files.sort();
}

/**
 * The documentation scripts a clone declares, read from its own `package.json`.
 *
 * Read, never guessed: a script the repository does not have is not offered, and the words are the
 * repository's, so a rename there shows up here instead of being papered over.
 */
function docScripts(clone: string): RepositoryScript[] {
	try {
		const manifest = JSON.parse(fs.readFileSync(path.join(clone, 'package.json'), 'utf8')) as {
			scripts?: Record<string, string>;
		};
		return Object.entries(manifest.scripts ?? {})
			.filter(([name]) => name.startsWith('docs:') || name === 'build:help' || name === 'build:help:dry')
			.sort(([one], [other]) => one.localeCompare(other))
			.map(([name, command]) => ({ name, command: String(command) }));
	} catch {
		// No manifest, or one that cannot be read: the repository simply has no scripts this page can name.
		return [];
	}
}

/** One script in a clone's own `package.json` that has to do with documentation. */
interface RepositoryScript {
	name: string;
	command: string;
}

/** One repository as the list and the detail page read it: the row, the clone, the reads, the scripts. */
interface RepositoryFact {
	slug: string;
	name: string;
	kind: string;
	remoteUrl?: string;
	branch?: string;
	defaultBranch?: string;
	docsRoot?: string;
	/** Where the clone is, when a read has put one on this machine. */
	path?: string;
	cloned: boolean;
	pages: number;
	/** What the store says about the last read: "318 pages declared", or why a read found nothing. */
	state?: string;
	reads: ScanRow[];
	pageRows: { id: string; title?: string; path?: string }[];
	/** Markdown under the pages folder of the clone, relative to it. */
	files: string[];
	scripts: RepositoryScript[];
}

/**
 * *Repository* — one repository: its clone, what each read found, its own scripts, and the pages it declares.
 *
 * Every row here is a fact the platform owns — a row in the catalog, a file in the clone, or a script read from
 * the clone's own `package.json`. Nothing is inferred from the repository's name.
 */
function repositoryBody(fact: RepositoryFact | undefined): string {
	if (fact === undefined) {
		return `${pageHead({
			title: 'Repository',
			mark: 'repo',
			desc: 'No repository with that name is recorded in the platform database.',
			actions: button('Edit the Project', 'temcoProjects.editProject', { kind: 'primary', mark: 'edit' }) + button('Add a Repository', 'temcoProjects.addSource', { mark: 'plus' })
		})}
<div class="mt-16">${callout('A repository is a source the catalog holds. If it was removed, its row is gone with it — the clone in the working area is not touched.')}</div>`;
	}

	const newest = fact.reads[0];
	const readRow = (read: ScanRow): string =>
		`<div class="record-row record-row--static">${toneMark('check', 'ok')}<div class="record-row__main"><div class="record-row__title"><span class="record-row__name cell-mono">${esc(read.revision ?? 'no revision')}</span><span class="tag">${esc(read.mode)}</span></div><div class="record-row__meta">${facts([waitingSince(read.at), readSummary(read.counts)])}</div></div><div class="record-row__state"></div><div></div></div>`;

	const scriptRow = (script: RepositoryScript): string =>
		`<div class="record-row">${toneMark('code')}<div class="record-row__main"><div class="record-row__title"><span class="record-row__name cell-mono">${esc(script.name)}</span></div><div class="record-row__meta"><span class="cell-mono">${esc(script.command)}</span></div></div><div class="record-row__state"></div>${button('Run', 'temcoDocs.runScript', { small: true, kind: 'ghost', args: [script.name] })}</div>`;

	const pageRow = (page: { id: string; title?: string; path?: string }): string =>
		`<div class="record-row" data-command="temcoDocs.page" data-args="${esc(JSON.stringify([page.id]))}">${toneMark('document')}<div class="record-row__main"><div class="record-row__title"><span class="record-row__name">${esc(page.title ?? page.id)}</span></div><div class="record-row__meta"><span class="cell-mono">${esc(page.path ?? page.id)}</span></div></div><div class="record-row__state"></div><span class="record-row__go">${icon('chevron-right', 'icon--sm')}</span></div>`;

	return `${pageHead({
		eyebrow: 'Repositories',
		title: fact.name,
		mark: 'repo',
		desc: `${fact.remoteUrl === undefined ? 'no remote recorded' : `<span class="cell-mono">${esc(fact.remoteUrl)}</span>`} · ${fact.cloned ? `cloned at <span class="cell-mono">${esc(fact.path ?? '')}</span>` : 'no local copy yet'}`,
		actions: button('Read Source', 'temcoRepositories.readSource', { kind: 'primary', mark: 'refresh', args: [fact.slug] })
			+ (fact.cloned ? button('Pull', 'temcoRepositories.pullSource', { mark: 'download', args: [fact.slug] }) + button('Open the Copy', 'temcoRepositories.openClone', { mark: 'folder', args: [fact.slug] }) : '')
			+ button('Edit the Project', 'temcoProjects.editProject', { mark: 'edit' })
	})}
${tiles([
		{ value: String(fact.pages), label: fact.pages === 1 ? 'Page found' : 'Pages found' },
		{ value: String(fact.reads.length), label: fact.reads.length === 1 ? 'Read recorded' : 'Reads recorded' },
		{ value: String(fact.scripts.length), label: fact.scripts.length === 1 ? 'Doc script' : 'Doc scripts' },
		{ value: newest === undefined ? 'never' : waitingSince(newest.at), label: 'Last read' }
	])}
${fact.cloned ? '' : `<div class="mt-16">${callout('<b>Nothing is local yet.</b> Reading this repository clones it into the working area with its history; until then there is no code for a draft to read.', 'warn')}</div>`}
${fact.reads.length === 0
			? `<div class="mt-24">${callout('Nothing has been read from this repository yet. A read records the pages it declares and the commit it read them at; it never writes to the repository.')}</div>`
			: `<div class="mt-24">${group({
				label: 'Reads',
				count: `${fact.reads.length} ${fact.reads.length === 1 ? 'read' : 'reads'}`,
				note: 'Newest first, keyed by the commit each read saw — which is what explains a page later.',
				body: fact.reads.map(readRow).join('')
			})}</div>`}
${fact.scripts.length === 0
			? fact.cloned ? `<div class="mt-24">${callout(`<b>No documentation scripts.</b> The platform reads <code>${esc(fact.docsRoot ?? 'docs')}/</code> as files instead: a page is a file, and nothing in the repository runs.`)}</div>` : ''
			: `<div class="mt-24">${group({
				label: 'Scripts',
				count: `${fact.scripts.length} ${fact.scripts.length === 1 ? 'script' : 'scripts'}`,
				note: 'The repository&#39;s own vocabulary, read from its <code>package.json</code>. The platform calls these and nothing else.',
				body: fact.scripts.map(scriptRow).join('')
			})}</div>`}
${fact.pageRows.length === 0
			? ''
			: `<div class="mt-24">${group({
				label: 'Pages It Declares',
				count: `${fact.pageRows.length} ${fact.pageRows.length === 1 ? 'page' : 'pages'}`,
				note: 'What the last read recorded, as the catalog holds it. Pick one to read it.',
				body: fact.pageRows.slice(0, 40).map(pageRow).join('')
			})}</div>`}
<div class="mt-24">${rule({ label: 'Where It Lives' })}${settingsStrip([
				{ label: 'Remote', value: fact.remoteUrl ?? 'not recorded', mono: true },
				{ label: 'Working copy', value: fact.path ?? '—', mono: true },
				{ label: 'Branch', value: fact.branch ?? 'not recorded', mono: true },
				{ label: 'Default branch', value: fact.defaultBranch ?? 'not recorded', mono: true },
				{ label: 'Pages folder', value: `${fact.docsRoot ?? 'docs'}/`, mono: true },
				{ label: 'Catalog row', value: fact.slug, mono: true }
			])}</div>`;
}

/** What a read reported, in the one number a person looks for — or the JSON it was written as. */
function readSummary(counts: string | undefined): string {
	if (counts === undefined || counts.length === 0) {
		return 'no counts recorded';
	}
	try {
		const parsed = JSON.parse(counts) as Record<string, unknown>;
		const pages = parsed.pages;
		return typeof pages === 'number' ? `${pages} ${pages === 1 ? 'page' : 'pages'}` : counts;
	} catch {
		return counts;
	}
}

/** One area across every root being read, which is how the list draws it. */
interface AreaFact {
	name: string;
	title: string;
	pages: number;
	issues: number;
	neverReviewed: number;
	stale: number;
	roots: number;
}

function areaFacts(roots: readonly DocsRoot[]): AreaFact[] {
	const seen = new Map<string, AreaFact>();
	for (const root of roots) {
		for (const area of root.areas) {
			const stale = area.chapters.reduce(
				(total, chapter) => total + chapter.pages.filter((page) => page.provenance?.stale === true).length,
				0
			);
			const found = seen.get(area.area);
			if (found === undefined) {
				seen.set(area.area, {
					name: area.area,
					title: area.title || area.area,
					pages: area.pages,
					issues: area.issues,
					neverReviewed: area.neverReviewed,
					stale,
					roots: 1
				});
				continue;
			}
			found.pages += area.pages;
			found.issues += area.issues;
			found.neverReviewed += area.neverReviewed;
			found.stale += stale;
			found.roots += 1;
		}
	}
	return [...seen.values()].sort((one, other) => one.name.localeCompare(other.name));
}

/** What a page's row says: a file that has to be written, a problem, a review, or nothing yet. */
function stateOf(page: PageEntry): { text: string; tone?: string } {
	if (!page.exists) {
		return { text: 'No file', tone: 'warn' };
	}
	const errors = page.issues.filter((issue) => issue.severity === 'error').length;
	if (errors > 0) {
		return { text: `${errors} error${errors === 1 ? '' : 's'}`, tone: 'err' };
	}
	if (page.issues.length > 0) {
		return { text: `${page.issues.length} warning${page.issues.length === 1 ? '' : 's'}`, tone: 'warn' };
	}
	if (page.provenance?.stale === true) {
		return { text: 'Stale', tone: 'warn' };
	}
	return page.reviewed ? { text: 'Reviewed', tone: 'ok' } : { text: 'Never read', tone: 'info' };
}

/**
 * *Documents* — the pages the registries declare, grouped by area.
 *
 * The order is the registry's order, which is the order the site and the PDF ship in. A page that is in the
 * registry and has no file is shown rather than hidden: it is the page somebody still has to write.
 */
function documentsBody(roots: readonly DocsRoot[], areaName?: string): string {
	const pages = roots.flatMap((root) => collectPages(root));
	const areas = areaFacts(roots);
	const remembered = selection.page()?.id.split('/')[0];
	const open = areas.find((area) => area.name === areaName)
		?? areas.find((area) => area.name === remembered)
		?? areas[0];
	const inArea = open === undefined
		? []
		: pages.filter((page) => page.area === open.name).sort((one, other) => one.order - other.order);
	const reviewed = pages.filter((page) => page.reviewed !== null && page.reviewed !== undefined).length;
	const missing = pages.filter((page) => !page.exists).length;
	const problems = pages.reduce((total, page) => total + page.issues.length, 0);

	const areaRow = (area: AreaFact): string => {
		const read = Math.max(0, area.pages - area.neverReviewed);
		const pct = area.pages === 0 ? 0 : Math.round((read / area.pages) * 100);
		const isOpen = open !== undefined && area.name === open.name;
		const title = `${read} of ${area.pages} pages read${area.stale > 0 ? `, ${area.stale} stale` : ''}`;
		return `<div class="area-row${isOpen ? ' area-row--open' : ''}" data-command="temcoDocs.knowledge" data-args="${esc(JSON.stringify([area.name]))}" style="--coverage: ${pct}%" title="${esc(title)}">${icon(isOpen ? 'chevron-down' : 'chevron-right', 'icon--sm')}<span class="area-row__name">${esc(area.title)}</span><span class="area-row__pct">${pct}%</span><span class="area-row__stale">${area.stale > 0 ? badge(`${area.stale} stale`, 'warn') : ''}</span></div>`;
	};

	return `${pageHead({
		eyebrow: roots.length === 0 ? 'Nothing is being read' : roots.map((root) => root.folder.name).join(' · '),
		title: 'Documents',
		mark: 'book',
		desc: `${pages.length.toLocaleString('en-US')} pages in ${areas.length} ${areas.length === 1 ? 'area' : 'areas'}, ${reviewed.toLocaleString('en-US')} of them read by a person. The registry order is the order the documentation ships in, not the order the files sit on disk.`,
		actions: button('New Page', 'temcoDocs.newPage', { kind: 'primary', mark: 'plus' }) + button('Generate from Sources', 'temcoDocs.createPage', { mark: 'sparkle' }) + button('Open Tree', 'temcoDocs.pages.focus', { mark: 'sidebar', title: 'Show this content as a folder tree in the side bar' })
	})}
${numbers([
		{ value: pages.length.toLocaleString('en-US'), label: t('Pages') },
		{ value: String(reviewed), label: t('Read by a person') },
		{ value: String(missing), label: t('Registry, no file') },
		{ value: String(problems), label: t('Problems found') }
	])}
${roots.length === 0
			? `<div class="mt-16">${callout('<b>No registry is being read.</b> A page is a file the registry declares, so this list is empty until a source with a <code>docs/</code> folder is open in this window.')}</div>`
			: `<div class="know-wrap mt-24">
<div class="know-split">
${card({
				title: 'Areas',
				mark: 'book',
				plain: true,
				actions: button('Coverage & Health', 'temcoDocs.overview', { small: true, kind: 'ghost' }),
				desc: 'Read is what a person signed off; stale is what the sources have outrun. Pick an area.',
				body: `<div class="area-list">${areas.map(areaRow).join('')}</div>`
			})}
${card({
				title: `Pages in ${open === undefined ? 'this project' : open.title}`,
				mark: 'document',
				plain: true,
				actions: button('Add Page', 'temcoDocs.newPage', { small: true, kind: 'ghost', mark: 'plus' }),
				desc: open === undefined ? 'Nothing to list yet.' : `${open.pages} pages · ${open.pages - open.neverReviewed} read · ${open.issues > 0 ? `${open.issues} problems` : 'no problems'} · ${open.stale > 0 ? `${open.stale} stale` : 'nothing stale'}. Order is the page order inside the area, not a file line. Pick a page to open it.`,
				body: inArea.length === 0
					? callout('This area declares no pages.')
					: table(
						['Order', 'Page', 'State'],
						inArea.map((page) => [
							`<span class="cell-mono">${page.order}</span>`,
							`<span class="cell-strong">${esc(page.title)}</span><div class="cell-muted" style="font-size:12px">${esc(page.chapter)} · ${esc(page.owner === '' ? 'no owner' : page.owner)} · ${page.provenance?.updated === null || page.provenance?.updated === undefined ? 'no history' : esc(page.provenance.updated)}</div>`,
							badge(stateOf(page).text, stateOf(page).tone)
						]),
						(index) => ({ command: 'temcoDocs.page', args: [inArea[index].id, inArea[index].area] })
					)
			})}
</div>
</div>
<div class="mt-24">${callout('A folder is a position in the content tree, not a directory on disk: <code>Hardware / Controllers / T3-8R</code>. The Documents container in the side bar is where folders are added, renamed and moved, and the order it shows is the order the site and the PDF use — this list is that order, flattened.')}</div>`}`;
}

/** What a Markdown line is, for the editor's own colours. */
function lineKind(line: string): 'h1' | 'h2' | 'list' | 'quote' | 'p' {
	if (/^#\s/.test(line)) {
		return 'h1';
	}
	if (/^#{2,6}\s/.test(line)) {
		return 'h2';
	}
	if (/^\s*([-*+]|\d+\.)\s/.test(line)) {
		return 'list';
	}
	if (/^>/.test(line)) {
		return 'quote';
	}
	return 'p';
}

/** The file, or nothing: a page whose file cannot be read is a page with no text, not an error page. */
async function readPageText(uri: vscode.Uri): Promise<string> {
	try {
		return new TextDecoder().decode(await vscode.workspace.fs.readFile(uri));
	} catch {
		return '';
	}
}

/**
 * *Page* — one page as the registry holds it and as its file reads.
 *
 * The lines are the file's, one for one: the editor's colours are a Markdown reader's, not a renderer's, so what
 * a person sees here is what a build will read.
 */
async function pageBody(
	roots: readonly DocsRoot[],
	requested: string | undefined,
	areaName: string | undefined
): Promise<{ title: string; html: string }> {
	const pages = roots.flatMap((root) => collectPages(root));
	const page = pages.find((entry) => entry.id === requested)
		?? pages.find((entry) => entry.title === requested && (areaName === undefined || entry.area === areaName))
		?? pages.find((entry) => entry.title === requested);

	if (page === undefined) {
		const title = requested ?? 'Page';
		return {
			title,
			html: `${pageHead({
				title,
				mark: 'document',
				desc: 'No page with that name is in a registry this window is reading.',
				actions: button('New Page', 'temcoDocs.newPage', { kind: 'primary', mark: 'plus' }) + button('Documents', 'temcoDocs.documents', { mark: 'book' })
			})}
<div class="mt-16">${callout(`<b>${esc(title)}</b> is not declared by any registry on this machine, so there is no file, no owner and nothing to show.`)}</div>`
		};
	}

	const state = stateOf(page);
	const text = page.exists ? await readPageText(page.uri) : '';
	const lines = page.exists ? text.split(/\r?\n/) : [];
	if (lines.length > 0 && lines[lines.length - 1] === '') {
		lines.pop();
	}

	const tool = (label: string, title: string): string => button(label, 'temcoDocs.analyseSource', { small: true, kind: 'ghost', title });

	const editor = `<div class="md-editor"><div class="md-editor__bar">${tool('B', 'Bold')}${tool('I', 'Italic')}${tool('H2', 'Section heading')}${tool('• List', 'Bulleted list')}${tool('❝', 'Note')}${tool('</>', 'Code sample')}${tool('Link', 'Link to another page')}${tool('Image', 'Screenshot from the last read')}${tool('Table', 'Table with a header row')}<span class="toolbar__spacer"></span><span class="cell-muted" style="font-size:11px">Markdown · the build reads headings, code and links</span></div><div class="md-editor__body"><div class="md-editor__gutter">${lines.map((_line, index) => `<div>${index + 1}</div>`).join('')}</div><div class="md-editor__code">${lines.map((line) => `<div class="md-line md-line--${lineKind(line)}">${line.length === 0 ? '&nbsp;' : esc(line)}</div>`).join('')}</div></div><div class="md-editor__status"><span>Ln 1, Col 1</span><span>${lines.length} lines</span><span>Markdown</span><span>UTF-8</span><span>${esc(page.area)} · order ${page.order}</span></div></div>`;

	return {
		title: page.title,
		html: `${pageHead({
			eyebrow: `${page.area}${page.chapter === '' ? '' : ` / ${page.chapter}`} · order ${page.order} · ${page.id}`,
			title: page.title,
			mark: 'document',
			desc: 'The page as the registry holds it and the file as it reads. Saving the file changes the page; a draft is <b>New Page</b> → <b>Draft</b>, and it waits in the Review Center until a person settles it.',
			actions: page.exists
				? button('Open the File', 'temcoDocs.openFile', { kind: 'primary', mark: 'code', args: [page.uri.fsPath] }) + button('Draft a Change', 'temcoDocs.revisePage', { mark: 'sparkle', title: 'Ask the model for a revision, and settle it in the Review Center', args: [{ id: page.id, title: page.title }] }) + button('Validate', 'temcoDocs.validate', { mark: 'check' })
				: button('New Page', 'temcoDocs.newPage', { kind: 'primary', mark: 'plus' }) + button('Validate', 'temcoDocs.validate', { mark: 'check' })
		})}
${page.exists ? '' : `<div class="mt-16">${callout(`<b>The registry declares this page and there is no file for it.</b> Its id is <code>${esc(page.id)}</code>; the file belongs at <code>${esc(page.uri.fsPath)}</code>.`, 'warn')}</div>`}
<div class="mt-16">${settingsStrip([
			{ label: 'Area', value: page.area },
			{ label: 'Chapter', value: page.chapter === '' ? 'the area itself' : page.chapter },
			{ label: 'Order', value: String(page.order), mono: true },
			{ label: 'State', value: state.text },
			{ label: 'Owner', value: page.owner === '' ? 'nobody yet' : page.owner },
			{ label: 'Reviewed', value: page.reviewed ?? 'never' },
			{ label: 'Ships', value: page.ship ? 'yes' : 'no' }
		], true)}</div>
<div class="mt-24">${editor}</div>
<div class="mt-24 grid grid--2">
<div>${group({
			label: 'What the Checks Found',
			count: page.issues.length === 0 ? 'nothing' : `${page.issues.length} ${page.issues.length === 1 ? 'finding' : 'findings'}`,
			body: page.issues.length === 0
				? factRow('check', 'No structural problem', 'this page agrees with the registry and with the pages it links to')
				: page.issues.map((issue) => factRow(issue.severity === 'error' ? 'alert' : 'info', issue.severity, issue.message)).join('')
		})}</div>
<div>${group({
			label: 'Where It Comes From',
			count: page.provenance === undefined ? 'nothing recorded' : 'what the generator knows',
			body: page.provenance === undefined
				? factRow('info', 'No neighbour file', 'neither the history nor the headings could be read for this page')
				: factRow('edit', page.provenance.updated ?? 'no date recorded', page.provenance.git?.author === undefined ? 'no commit recorded' : `${page.provenance.git.author} · ${page.provenance.git.sha ?? 'no sha'}`)
				+ factRow('code', `${page.provenance.headings.length} headings`, page.provenance.code.length === 0 ? 'claims no code, so nothing can make it stale' : `judged against ${page.provenance.code.join(', ')}`)
				+ factRow(page.provenance.stale ? 'alert' : 'check', page.provenance.stale ? 'Stale' : 'Current', page.provenance.stale ? 'a code glob moved on after the last review' : 'nothing the page claims has changed since it was written')
		})}</div>
</div>
<div class="mt-24">${group({
			label: 'How a Page Reaches a Reader',
			count: '3 steps',
			body: factRow('edit', 'A person edits the file', `the page is the file at ${page.id}.md, so editing it is editing the page`)
				+ factRow('sparkle', 'Or a draft reaches it', 'New Page → Draft writes a proposal into the database and it waits in the Review Center until somebody accepts it')
				+ factRow('upload', 'A build and a release carry it', 'only then does the site, the CHM or the PDF show it')
		})}</div>
<div class="mt-16">${callout('This view is read-only. It shows the file as the build will read it — headings, lists, notes and code fence markers — rather than as a browser would render it.')}</div>`
	};
}

/**
 * *Source* — the files behind the pages, as the clone on this machine has them.
 *
 * Read-only: a page is changed by an edit and a release, never by editing a source behind its back.
 */
function sourceBody(fact: RepositoryFact | undefined): string {
	if (fact === undefined) {
		return `${pageHead({
			title: 'Source Explorer',
			mark: 'code',
			desc: 'No repository with that name is recorded in the platform database.',
			actions: button('Edit the Project', 'temcoProjects.editProject', { kind: 'primary', mark: 'edit' })
		})}
<div class="mt-16">${callout('The Source Explorer reads a clone. A repository is added as a source and read, which puts a copy on this machine.')}</div>`;
	}

	const files = fact.files;
	const fileRow = (file: string): string =>
		`<div class="record-row" data-command="temcoDocs.openFile" data-args="${esc(JSON.stringify([path.join(fact.path ?? '', fact.docsRoot ?? 'docs', file)]))}">${toneMark('document')}<div class="record-row__main"><div class="record-row__title"><span class="record-row__name cell-mono">${esc(file)}</span></div><div class="record-row__meta"><span class="cell-mono">${esc(fact.docsRoot ?? 'docs')}/</span></div></div><div class="record-row__state"></div><span class="record-row__go">${icon('chevron-right', 'icon--sm')}</span></div>`;

	const newest = fact.reads[0];

	return `${pageHead({
		eyebrow: `Source · ${fact.name}`,
		title: 'Source Explorer',
		mark: 'code',
		desc: fact.cloned
			? 'The files behind the pages, as the clone has them. Read-only: a page is changed by an edit and a release, never by editing a source.'
			: 'This repository has no local copy, so there are no files to show.',
		actions: button('Read Again', 'temcoRepositories.readSource', { kind: 'primary', mark: 'refresh', args: [fact.slug] }) + button('Repository', 'temcoDocs.repository', { mark: 'repo', args: [fact.slug] })
	})}
${tiles([
		{ value: String(files.length), label: files.length === 1 ? 'Page file' : 'Page files' },
		{ value: String(fact.pages), label: 'Pages recorded' },
		{ value: newest?.revision ?? '—', label: 'Commit read' },
		{ value: newest === undefined ? 'never' : waitingSince(newest.at), label: 'Last read' }
	])}
${fact.cloned ? '' : `<div class="mt-16">${callout('<b>Nothing is local yet.</b> Reading the repository clones it into the working area; the files behind the pages are only there once it has.', 'warn')}</div>`}
${files.length === 0
			? fact.cloned ? `<div class="mt-24">${callout(`<b>No Markdown under <code>${esc(fact.docsRoot ?? 'docs')}/</code>.</b> The clone is there, but it declares no page files — so there is nothing for a read to record.`)}</div>` : ''
			: `<div class="mt-24">${group({
				label: 'Files',
				count: `${files.length} ${files.length === 1 ? 'file' : 'files'}`,
				actions: fact.path === undefined ? '' : button('Open the Folder', 'temcoRepositories.openClone', { small: true, kind: 'ghost', args: [fact.slug] }),
				note: `Markdown under <code>${esc(fact.docsRoot ?? 'docs')}/</code>, in the clone's own order. A page is one of these files.`,
				body: files.slice(0, 60).map(fileRow).join('')
			})}</div>`}
<div class="mt-24">${group({
				label: 'What a Read Does With These Files',
				count: '3 steps',
				body: factRow('search', 'Finds the headings', 'a heading with text under it becomes a page; a heading with nothing under it becomes a gap')
					+ factRow('document', 'Keeps the code samples', 'a fenced block in the source is quoted verbatim, so the page cannot drift from the code')
					+ factRow('link', 'Records the links', 'a link to another heading becomes an internal link, which is what the broken-link check reads')
			})}</div>
<div class="mt-16">${callout('A draft reads these files as evidence and cites them. Editing a file does not change a page on its own: the page is written, and the next read records what changed.')}</div>`;
}

/** *Review Center* — the drafts the platform is holding. The mock's queue, with the sample rows swapped for real ones. */
/**
 * The three publish pages' own layout.
 *
 * Each of them answers one question with a list and has one thing to say *beside* that list — the draft being weighed
 * next to the queue, the files next to the builds, where a release goes next to the versions. Two columns say that;
 * a column of full-width blocks makes the reader scroll past one to reach the other.
 */
const PIPE_CSS = `
.az-split { display: grid; grid-template-columns: minmax(0, 1.4fr) minmax(0, 1fr); align-items: start;
  gap: var(--sp-6) var(--sp-8); margin-top: var(--sp-2); }
.az-split > * { min-width: 0; }
.az-split .az-section { margin-top: 0; }
@media (max-width: 1180px) { .az-split { grid-template-columns: minmax(0, 1fr); } }
.az-actions { display: flex; flex-wrap: wrap; gap: var(--sp-2); margin-top: var(--sp-3); }
/* A long list folds after a handful of rows: a site build leaves hundreds of pages, and a page that prints them all is a
   page nobody reads to the end of. Native summary, so it opens in place and closes again. */
.build-more { margin-top: var(--sp-1); }
.build-more > summary { padding: 4px 0; color: var(--az-blue, #0078d4); font-size: 12.5px; line-height: 18px; cursor: pointer; }
.build-more > summary:hover { text-decoration: underline; }
.build-more > summary:focus-visible { outline: 1px solid var(--az-blue, #0078d4); outline-offset: 1px; }
`;

function reviewBody(drafts: readonly DraftRow[], project: string | undefined): string {
	const waiting = drafts.length;
	const fromSources = drafts.filter((draft) => draft.source !== undefined).length;
	const proposed = new Set(drafts.map((draft) => draft.pageId)).size;
	const newest = drafts[0];

	const row = (draft: DraftRow): string =>
		azRow({
			mark: 'sparkle',
			tone: draft === newest ? 'accent' : undefined,
			title: draft.title,
			tag: draft.kind || 'Draft',
			meta: facts([
				draft.pageId,
				`written ${waitingSince(draft.createdAt)}`,
				draft.source === undefined ? 'no source' : `read from ${draft.source}`
			]),
			actions: azButton('Accept', 'temcoDocs.acceptDraft', { small: true, kind: draft === newest ? 'primary' : undefined, args: [draft.id] })
				+ azButton('Discard', 'temcoDocs.discardDraft', { small: true, args: [draft.id] })
		});

	const step = (mark: string, title: string, note: string): string => azRow({ mark, title, meta: esc(note) });

	// The figures as one sentence rather than a row of numbers: a queue is read, not measured, and four large figures
	// over a list of drafts made the page look like a dashboard that had lost its chart.
	const summary = waiting === 0
		? 'Nothing is waiting to be reviewed.'
		: facts([
			`${waiting} ${waiting === 1 ? 'draft' : 'drafts'} waiting`,
			`${proposed} ${proposed === 1 ? 'page' : 'pages'} proposed`,
			`${fromSources} written from a source`,
			`newest ${waitingSince(newest.createdAt)}`
		]);

	return `${hero({
		title: 'Review Center',
		mark: 'check',
		descWide: true,
		desc: project === undefined
			? 'No project is selected, so there is no queue to show. Pick one in Projects and its drafts appear here.'
			: `Every draft ${project} is holding, newest first. Accepting one writes the page exactly as it reads; discarding throws the text away. Neither reaches a reader until a build and a publish carry it.`,
		actions: [
			{ label: 'New Page', command: 'temcoDocs.newPage', mark: 'plus', kind: 'primary' },
			{ label: 'Refresh', command: 'temcoDocs.review', mark: 'refresh' }
		]
	})}
<p class="az-note">${summary}</p>
${waiting === 0
			? `<div class="mt-24">${azCallout({
				title: 'Nothing is waiting',
				desc: 'A draft is written by New Page → Draft. It lands here until somebody accepts or discards it, and a draft nobody settles never becomes a page.',
				mark: 'check',
				actions: azButton('New Page', 'temcoDocs.newPage', { mark: 'plus' })
			})}</div>`
			: `<div class="az-split">
<div>
${section({
				title: 'The queue',
				desc: `${waiting} ${waiting === 1 ? 'draft' : 'drafts'} waiting${fromSources > 0 ? `, ${fromSources} of them written from a source` : ''}. Newest first; the one beside this list is open in full.`,
				actions: azButton('Refresh', 'temcoDocs.review', { small: true })
			})}
${azEntries(drafts.map(row))}
</div>
<div>
${section({
				title: `Open · ${newest.title}`,
				desc: `Proposed for ${newest.pageId}${newest.source === undefined ? '' : `, written from ${newest.source}`}, ${waitingSince(newest.createdAt)}.`,
				actions: badge(newest.kind || 'Draft', 'info') + ' ' + badge(`${newest.body.split('\n').length} lines`, 'neutral')
			})}
<pre class="code" style="max-height:360px;margin:0">${esc(newest.body)}</pre>
<div class="az-actions">${azButton('Accept', 'temcoDocs.acceptDraft', { mark: 'check', kind: 'primary', args: [newest.id] })}${azButton('Discard', 'temcoDocs.discardDraft', { mark: 'close', args: [newest.id] })}</div>
<p class="az-note">Accepting writes the page exactly as it reads above · discarding keeps the page as it was and settles the draft.</p>
</div>
</div>`}
${section({ title: 'What settling a draft does', desc: 'Three things happen, in this order — and only the last one reaches anybody.' })}
${azEntries([
				step('check', 'Accepting writes the page', 'the draft becomes the file at the id it proposed, and the row is settled as accepted'),
				step('document', 'The text stays as evidence', 'it remains in the database as an accepted draft, so what a page was written from survives the write'),
				step('upload', 'Only a release reaches a reader', 'a build and a publish, in that order')
			])}
<p class="az-note">A draft is a proposal, not a page. It belongs to the project it was written for and remembers the source it read, and it leaves this queue the moment a person settles it.</p>`;
}



/** How long a draft has been waiting, in words a reviewer reads at a glance. */
function waitingSince(iso: string): string {
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

/**
 * *Build Center* — the builds of the project on, and the files they left.
 *
 * One column, in the order a person asks the questions: **what has run** (newest first, with how long each took), **what
 * the files are** (newest first, each one a way in), and **where a build writes** — the two scripts and the folders they
 * fill, which is the one fact this page can state that nothing else in the window does. The page keeps no split: the
 * artifacts are not a column beside the builds, because one is the record and the other is what the record produced.
 *
 * Both lists fold after a handful of rows. A site build leaves hundreds of `.html` files, and a page that prints all of
 * them is a page nobody scrolls to the end of.
 */
export function buildsBody(facts1: BuildFacts): string {
	const { builds, artifacts } = facts1;
	const succeeded = builds.filter((build) => build.status === 'succeeded').length;
	const running = builds.filter((build) => build.status === 'running').length;
	const newest = builds[0];
	const last = newest === undefined ? undefined : waitingSince(newest.startedAt);

	/** How long a build took, from the two timestamps the catalog keeps — never from the status. */
	const took = (build: BuildRow): string => {
		if (build.finishedAt === undefined) {
			return build.status === 'running' ? 'still running' : 'no finish recorded';
		}
		const started = Date.parse(build.startedAt);
		const finished = Date.parse(build.finishedAt);
		if (Number.isNaN(started) || Number.isNaN(finished) || finished < started) {
			return 'no finish recorded';
		}
		const seconds = Math.round((finished - started) / 1000);
		return seconds < 60 ? `${seconds} s` : `${Math.floor(seconds / 60)} min ${seconds % 60} s`;
	};

	const buildRow = (build: BuildRow): string =>
		azRow({
			mark: build.status === 'succeeded' ? 'check' : build.status === 'running' ? 'sync' : 'alert',
			tone: build.status === 'succeeded' ? 'ok' : build.status === 'running' ? 'info' : 'warn',
			title: `#${build.id}`,
			mono: true,
			tag: build.revision,
			meta: facts([`started ${waitingSince(build.startedAt)}`, `took ${took(build)}`]),
			// The status is the row's verdict, and the verdict is what a person scans for.
			actions: (build === newest ? badge('Latest', 'accent') : '') + badge(build.status, build.status === 'succeeded' ? 'ok' : build.status === 'running' ? 'info' : 'warn')
		});

	const artifactRow = (artifact: ArtifactFact): string =>
		azRow({
			mark: artifact.kind === 'chm' ? 'package' : artifact.kind === 'pdf' ? 'document' : artifact.kind === 'search' ? 'search' : 'globe',
			title: artifact.path.split(/[\\/]/).pop() ?? artifact.path,
			mono: true,
			tag: artifactLabel(artifact.kind),
			meta: `<span>built ${waitingSince(artifact.builtAt)}</span><span class="cell-mono">${esc(artifact.path)}</span>`,
			command: 'temcoDocs.openArtifact',
			args: [artifact.path],
			go: 'Open'
		});

	/** First `open` rows, the rest behind a native summary: no script, and it closes again. */
	const folded = (rows: readonly string[], open: number, more: string): string =>
		rows.length <= open
			? azEntries(rows)
			: `${azEntries(rows.slice(0, open))}<details class="build-more"><summary>Show ${esc(
					`${rows.length - open} ${more}`
				)}</summary>${azEntries(rows.slice(open))}</details>`;

	const heroBlock = hero({
		title: 'Build Center',
		mark: 'play',
		descWide: true,
		desc: 'A build runs the repository’s own script as a task and is then judged by what it left: the attempt, its exit code and every file that appeared are recorded here, in the platform database.',
		// Two acts, and only the two acts: refreshing a page is what reopening it does, and publishing has its own page.
		actions: [
			{ label: 'Build the Site', command: 'temcoDocs.buildSite', mark: 'play', kind: 'primary' },
			{ label: 'Build the Offline Help', command: 'temcoDocs.buildHelp', mark: 'package' }
		]
	});

	const stateLine = `<p class="az-note">${facts([
		`${builds.length} ${builds.length === 1 ? 'build' : 'builds'} recorded`,
		last === undefined ? 'nothing has run here' : `last started ${last}`,
		`${artifacts.length} ${artifacts.length === 1 ? 'file' : 'files'} to take`,
		running > 0 ? `${running} running now` : 'nothing running now'
	])}</p>`;

	const whereItWrites = `${section({
		title: 'Where a build writes',
		desc: 'The scripts come from the repository itself, so a rename upstream is reported rather than guessed around.'
	})}${settingsStrip([
		{ label: 'The site build', value: 'docs:site → dist/site · dist/docs', mono: true },
		{ label: 'The offline help', value: 'build:help:dry → .chm in the project, or in HelpDocs beside it', mono: true }
	])}`;

	// Nothing has run: the callout says what a build is, and the page still answers where it would write.
	if (builds.length === 0) {
		return `${heroBlock}${stateLine}<div class="mt-24">${azCallout({
			title: 'No build has run here yet',
			desc: 'Building runs the folder’s own script (docs:site, build:help:dry) as a task and then looks for the file it should have written. The exit code is printed, never believed.',
			mark: 'play',
			actions: azButton('Build the Site', 'temcoDocs.buildSite', { mark: 'play' }) + azButton('Build the Offline Help', 'temcoDocs.buildHelp', { mark: 'package' })
		})}</div>${whereItWrites}`;
	}

	return [
		heroBlock,
		stateLine,
		section({
			title: 'Builds',
			desc: `Newest first. A row is written before the script runs, so a build that crashed the editor is still here — ${succeeded} of ${builds.length} left a file.`,
			actions: azButton('Build the Site', 'temcoDocs.buildSite', { small: true, mark: 'play' })
		}),
		folded(builds.map(buildRow), 5, 'older builds'),
		artifacts.length === 0
			? section({
					title: 'What they left',
					desc: 'Nothing yet. A build is judged by the file it writes, so a build that wrote none is not counted as one that worked.'
				}) + azEntries([azRow({ mark: 'info', title: 'No file has been written yet', meta: esc('Build the site, and the folder it fills appears here as rows.') })])
			: section({
					title: 'What they left',
					desc: `Every file the builds have written, newest first — ${artifacts.length} in all. A file that is here is a file a reader can be given.`,
					actions: azButton('Publish & Releases', 'temcoDocs.releases', { small: true, mark: 'upload' })
				}) + folded(artifacts.map(artifactRow), 6, 'more files'),
		whereItWrites,
		`<p class="az-note">Recorded in the platform database · the files stay where the build wrote them.</p>`
	].join('\n');
}

/** *Publish & Releases* — what a build left behind, and what a reader can be given. The files are the release. */
function releasesBody(facts1: BuildFacts): string {
	const { artifacts, releases, publish } = facts1;
	const kinds = [...new Set(artifacts.map((artifact) => artifact.kind))];

	const releaseRow = (release: ReleaseRow): string =>
		azRow({
			mark: 'upload',
			tone: 'ok',
			title: release.version,
			mono: true,
			tag: release.buildId === undefined ? undefined : `build #${release.buildId}`,
			meta: facts([`published ${waitingSince(release.publishedAt)}`, `${release.files} ${release.files === 1 ? 'file' : 'files'}`, release.destination]),
			actions: azButton('Serve', 'temcoDocs.servePublished', { small: true, args: [release.destination] })
				+ azButton('Open', 'temcoDocs.openPublished', { small: true, args: [release.destination] })
		});

	const fileRow = (file: ArtifactFact): string =>
		azRow({
			mark: file.kind === 'chm' ? 'package' : file.kind === 'pdf' ? 'document' : 'globe',
			title: file.path.split(/[\\/]/).pop() ?? file.path,
			mono: true,
			meta: `<span class="cell-mono">${esc(file.path)}</span><span>built ${waitingSince(file.builtAt)}</span>`,
			command: 'temcoDocs.openArtifact',
			args: [file.path]
		});

	const filesOf = (kind: string): string => {
		const files = artifacts.filter((artifact) => artifact.kind === kind);
		return `${section({
			title: artifactLabel(kind),
			desc: `${files.length} file${files.length === 1 ? '' : 's'}, newest first. This is what a reader gets: nothing is copied, the path is the release.`
		})}
${azEntries(files.map(fileRow))}`;
	};

	const fact = (mark: string, title: string, note: string): string => azRow({ mark, title, meta: note });

	return `${hero({
		title: 'Publish & Releases',
		mark: 'upload',
		descWide: true,
		desc: 'A release is what a build left that a reader can be given: the website, the offline help, the PDF, the search index. Publishing copies the site where it can be opened; serving puts it on loopback so its own links resolve.',
		actions: [
			{ label: 'Publish', command: 'temcoDocs.publishRelease', mark: 'upload', kind: 'primary' },
			{ label: 'Publish to GitHub Pages', command: 'temcoDocs.publishSite', mark: 'globe' },
			{ label: 'Export…', command: 'temcoDocs.export', mark: 'download' },
			{ label: 'Serve the Newest', command: 'temcoDocs.servePublished', mark: 'server' },
			{ label: 'Build Site', command: 'temcoDocs.buildSite', mark: 'play' },
			{ label: 'Build Center', command: 'temcoDocs.builds', mark: 'list' }
		]
	})}
<p class="az-note">${facts([
		`${releases.length} ${releases.length === 1 ? 'version' : 'versions'} published`,
		`${artifacts.length} ${artifacts.length === 1 ? 'file' : 'files'} built`,
		publish === undefined ? 'no GitHub remote to publish to' : `publishes to ${publish.owner}/${publish.repo}`
	])}</p>
<div class="az-split">
<div>
${releases.length === 0
			? azCallout({
				title: 'Nothing published yet',
				desc: 'A version appears here the moment Publish copies a build into a folder this application owns. Until then the files below are built but not released.',
				mark: 'upload',
				actions: azButton('Publish', 'temcoDocs.publishRelease', { mark: 'upload' })
			})
			: `${section({
				title: 'Published versions',
				desc: 'Each one is a copy of a build, in a folder the platform owns. A new version is a new row; an old one is never rewritten.',
				actions: azButton('Publish', 'temcoDocs.publishRelease', { small: true, mark: 'upload' })
			})}
${azEntries(releases.map(releaseRow))}`}
</div>
<div>
${section({
				title: 'Where it publishes',
				desc: 'The address is read from the documentation folder’s own git remote, so it can be named before anything is pushed.',
				actions: azButton('Publish to GitHub Pages', 'temcoDocs.publishSite', { small: true, mark: 'globe' })
			})}
${azEntries(publish === undefined
				? [fact('alert', 'No GitHub remote', 'This folder is not a git repository with a GitHub <code>origin</code>, so there is nowhere to publish to. Add one, then publish again.')]
				: [
					fact('globe', publish.base, `pushed to the <code>${esc(publish.branch)}</code> branch of <code>${esc(`${publish.owner}/${publish.repo}`)}</code>, which is what Pages serves`),
					fact('gear', 'One time only', 'GitHub → Settings → Pages → Source: deploy from a branch, <code>gh-pages</code>, folder <code>/</code>. The command tries this through the <code>gh</code> CLI when it is installed, and prints the two clicks when it is not.'),
					fact('warning', 'Never forced', 'If the branch carries commits this build does not know about, that is reported and nothing is overwritten. The project’s own working tree is never touched.')
				])}
<p class="az-note">A downloadable CHM or PDF needs no publishing at all — it is a file the build wrote. Publishing is for the site: the same pages in one folder with an entry point.</p>
</div>
</div>
${artifacts.length === 0
			? ''
			: `${section({
				title: 'The files a reader can be given',
				desc: 'Everything the builds left, grouped by what it is. A downloadable file is the release; the site is the only one that has to be published.'
			})}
${kinds.map(filesOf).join('')}`}
${section({ title: 'What publishing does', desc: 'Three facts, in the order they happen.' })}
${azEntries([
				fact('upload', 'Copies the site', 'the files a build wrote, into a folder the platform owns — nothing is uploaded anywhere'),
				fact('document', 'Records the release', 'version, build, destination and date, so “when did 13.0 go out” is a query rather than a memory'),
				fact('check', 'Leaves the old one alone', 'a new version is a new row beside the last one; no published file is ever rewritten in place')
			])}`;
}

/** The words for an artifact's kind, in the order a build produces them. */
function artifactLabel(kind: string): string {
	return kind === 'chm' ? 'Offline help (CHM)' : kind === 'pdf' ? 'PDF' : kind === 'site' ? 'Website' : kind === 'search' ? 'Search index' : kind;
}

