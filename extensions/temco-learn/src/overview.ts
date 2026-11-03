// Overview — the module's own page, and never a page of the website.
//
// The website is what a reader opens; it carries nothing about running it. This page is ours, drawn with the application's
// page vocabulary (`temco-ui`: the Fluent kit seeded from Azure blue). It opens by saying what the module is, says what needs
// doing, and draws the four steps that get a page to a reader — and stops there: what is on the website, what a build wrote
// and where it is published each belong to the page that acts on them (Documentation Site, Artifacts, Publishing).

import * as vscode from 'vscode';
import { formatSize } from './artifacts';
import { workRoot } from './site';
import { Snapshot } from './snapshot';
import { ago } from './state';
import { callout, commandScript, entryRow, escapeHtml, hero, icon, page, pageColumn, runCommand, section } from './ui';

export const OVERVIEW_VIEW_TYPE = 'temcoLearn.overview';

/** The page's own rules, on top of the vocabulary: a short brand bar before a section title, and four cards in a row. */
export const PAGE_STYLE = `
.az-section__title::before { content: ''; position: absolute; left: 0; top: 50%; transform: translateY(-50%); width: 2px; height: 12px; border-radius: 1px; background: var(--az-blue, #0078d4); }
.az-options { grid-template-columns: repeat(auto-fit, minmax(215px, 1fr)); }
`;

export class OverviewPage implements vscode.Disposable {
	private opened: vscode.WebviewPanel | undefined;

	constructor(private readonly read: () => Promise<Snapshot>) { }

	/** Opens the page, or brings it forward if it is already open. `restored` is the tab the window gave back. */
	open(restored?: vscode.WebviewPanel): void {
		if (this.opened !== undefined) {
			this.opened.reveal(pageColumn());
			void this.render();
			return;
		}
		// A restored tab is drawn into rather than replaced: it keeps its place in the strip, and closing it as well
		// as working on it would leave an empty tab of the same name behind.
		this.opened = restored ?? vscode.window.createWebviewPanel(OVERVIEW_VIEW_TYPE, 'Temco Learn', pageColumn(), {
			enableScripts: true,
			localResourceRoots: []
		});
		this.opened.webview.options = { enableScripts: true, localResourceRoots: [] };
		this.opened.iconPath = new vscode.ThemeIcon('cloud-upload');
		this.opened.onDidDispose(() => {
			this.opened = undefined;
		});
		this.opened.webview.onDidReceiveMessage(runCommand);
		void this.render();
	}

	/** Re-renders if the page is open: an add, a build or a publish all land here. */
	refresh(): void {
		void this.render();
	}

	dispose(): void {
		this.opened?.dispose();
	}

	private async render(): Promise<void> {
		const opened = this.opened;
		if (opened === undefined) {
			return;
		}
		const state = await this.read();
		opened.webview.html = page(html(state), { title: 'Temco Learn', script: commandScript, extraCss: PAGE_STYLE });
	}
}

const plural = (count: number, one: string, many?: string): string =>
	`${count} ${count === 1 ? one : many === undefined ? `${one}s` : many}`;

/** The commands a page of this module may draw: a typo is a compile error, not a dead button. */
type PageCommand =
	| 'temcoLearn.site.preview'
	| 'temcoLearn.site.page'
	| 'temcoLearn.addBuilds'
	| 'temcoLearn.publish'
	| 'temcoLearn.revealArtifact'
	| 'temcoLearn.downloads'
	| 'temcoLearn.publishing'
	| 'temcoDocs.builds';

/** A button in the application's own dress, carrying the command it runs. */
function button(label: string, command: PageCommand, options: { args?: unknown; kind?: 'primary' | 'link' } = {}): string {
	const cls = `az-btn${options.kind === 'primary' ? ' az-btn--primary' : options.kind === 'link' ? ' az-btn--link' : ''}`;
	const args = options.args === undefined ? '' : ` data-args="${escapeHtml(JSON.stringify(options.args))}"`;
	return `<button type="button" class="${cls}" data-command="${command}"${args}><span>${escapeHtml(label)}</span></button>`;
}

/** An act written as a link at the end of a card or a section heading: the glyph, the words, the arrow. */
function link(label: string, command: PageCommand, options: { args?: unknown; mark?: string } = {}): string {
	const mark = options.mark === undefined ? '' : icon(options.mark);
	const data = options.args === undefined ? '' : ` data-args="${escapeHtml(JSON.stringify(options.args))}"`;
	return `<button type="button" class="az-btn az-btn--link" data-command="${command}"${data}>${mark}<span>${escapeHtml(label)}</span>${icon('chevron-right', 'icon--sm')}</button>`;
}

/** How many pages the website holds, over every project and version. */
function pagesOf(state: Snapshot): number {
	return state.site.projects.reduce(
		(total, project) => total + project.versions.reduce((count, version) => count + version.pages.length, 0),
		0
	);
}

/** The builds newer than what the website holds: those are the ones worth adding. */
function waiting(state: Snapshot): Snapshot['builds'] {
	return state.builds.filter((build) => {
		const project = state.site.projects.find((entry) => entry.id === build.id);
		if (project === undefined) {
			return true;
		}
		const newestVersion = project.versions[0]?.builtAt;
		return newestVersion === undefined || build.at > Date.parse(newestVersion);
	});
}

/** The title block: what this module is, in sentences counted from the snapshot, and the two ways in. */
function head(state: Snapshot): string {
	const projects = state.site.projects.length;
	const versions = state.site.projects.reduce((total, project) => total + project.versions.length, 0);
	const pages = pagesOf(state);
	const published = state.published;
	const desc =
		projects === 0
			? "Temco Learn is the documentation website. It is built from its own repository — Markdown pages under six sections, one folder per project and version — and this module runs, builds, previews and publishes that repository. Nothing is on the site yet: add a build, or write a page in it."
			: `Temco Learn is the documentation website. It is built from its own repository — Markdown pages under six sections, one folder per project and version — and this module runs, builds, previews and publishes that repository. It holds ${plural(projects, 'project')}, ${plural(versions, 'version')} and ${plural(pages, 'page')} today; this page says what needs doing, and the four steps that get a page to a reader.`;
	const note =
		published.commit === undefined
			? { text: 'Never published — the website is not on the internet yet', mark: 'clock' }
			: { text: `Last publish ${published.commit} · ${ago(published.at)}`, mark: 'clock', link: { command: 'temcoLearn.openPublished' } };
	return hero({
		eyebrow: 'Temco Learn',
		mark: 'book',
		title: 'Overview',
		desc,
		descWide: true,
		note,
		actions: [
			{ label: 'Preview the Website', command: 'temcoLearn.site.preview', mark: 'globe', kind: 'primary' },
			{ label: 'Publish', command: 'temcoLearn.publish', mark: 'upload' }
		]
	});
}

/** The one callout: what to do next, or that there is nothing to do, or that nothing exists yet. */
function needsYou(state: Snapshot): string {
	const builds = waiting(state).length;
	const changes = state.published.pending;
	const parts: string[] = [];
	const actions: string[] = [];
	if (builds > 0) {
		parts.push(`${plural(builds, 'build')} on disk ${builds === 1 ? 'is' : 'are'} not on the website`);
		actions.push(button('Add the builds', 'temcoLearn.addBuilds', { kind: 'primary' }));
	}
	if (changes > 0) {
		parts.push(`${plural(changes, 'change')} ${changes === 1 ? 'is' : 'are'} not published`);
		actions.push(button('Publish', 'temcoLearn.publish', { kind: builds > 0 ? undefined : 'primary' }));
	}
	if (parts.length > 0) {
		return callout({ title: 'What needs doing', desc: `${parts.join(' · ')}.`, mark: 'warning', actions: actions.join('') });
	}
	if (state.site.projects.length === 0 && state.artifacts.length === 0) {
		return callout({
			title: 'Nothing has been built yet',
			desc: 'Build a project in Temco Docs, then add the build here — the website only ever shows what has been added.',
			mark: 'info',
			actions: button('Open Temco Docs', 'temcoDocs.builds', { kind: 'primary' })
		});
	}
	return callout({
		title: 'Nothing needs doing',
		desc: 'Every build on disk is on the website, and the website is published.',
		mark: 'check'
	});
}

/** One step of the workflow: a number, a name, one line, and the link that starts it. */
function stepCard(tag: string, mark: string, title: string, desc: string, action: string): string {
	return `<section class="az-option"><div class="az-option__top"><span class="az-option__icon">${icon(mark)}</span><div><span class="az-option__tag">${escapeHtml(tag)}</span><h2 class="az-option__title">${escapeHtml(title)}</h2></div></div><p class="az-option__desc">${escapeHtml(desc)}</p><div class="az-option__actions">${action}</div></section>`;
}

/** The workflow: four steps, one line each, each ending in the act that performs it. */
function workflow(state: Snapshot): string {
	const builds = waiting(state).length;
	const changes = state.published.pending;
	const files = state.artifacts.length === 0;
	const cards = [
		stepCard(
			'1',
			'play',
			'Build',
			'Temco Docs turns the pages into a site, an offline help file, a pdf and a zip.',
			link('Open Temco Docs', 'temcoDocs.builds', { mark: 'external' })
		),
		stepCard(
			'2',
			'plus',
			'Add',
			'A build becomes a version of a project on the website.',
			link(builds === 0 ? 'Choose a build' : `Choose a build · ${plural(builds, 'waiting')}`, 'temcoLearn.addBuilds', { mark: 'plus' })
		),
		stepCard(
			'3',
			'upload',
			'Publish',
			'The website goes on the internet for readers.',
			link(changes === 0 ? 'Publish' : `Publish · ${plural(changes, 'change')}`, 'temcoLearn.publish', { mark: 'upload' })
		),
		stepCard(
			'4',
			'download',
			'Download',
			'Take the build away: the offline help, the pdf, the zip.',
			files
				? link('Open Temco Docs', 'temcoDocs.builds', { mark: 'play' })
				: link('Show in the folder', 'temcoLearn.revealArtifact', { args: workRoot(), mark: 'folder' })
		)
	];
	return [
		section({ title: 'Publishing workflow', desc: 'Four steps, from a project\'s pages to a file a reader can take away.' }),
		`<div class="az-options">${cards.join('')}</div>`
	].join('\n');
}

/** Where the work lands: one line per page that owns the fact, and the way into it. */
function whereItStands(state: Snapshot): string {
	const projects = state.site.projects.length;
	const versions = state.site.projects.reduce((total, project) => total + project.versions.length, 0);
	const files = state.artifacts.reduce((total, list) => total + list.artifacts.length, 0);
	const bytes = state.artifacts.reduce(
		(total, list) => total + list.artifacts.reduce((sum, artifact) => sum + (artifact.size ?? 0), 0),
		0
	);
	const published = state.published;
	const address = published.base ?? 'no address yet';
	const waiting = published.pending === 0 ? 'nothing waiting' : `${plural(published.pending, 'change')} waiting`;
	const rows = [
		// The count, not the list: a list here would be a copy of the page the row opens.
		entryRow({
			title: 'Documentation Site',
			meta: [plural(projects, 'project'), plural(versions, 'version'), plural(pagesOf(state), 'page')].join(' · '),
			mark: 'globe',
			command: 'temcoLearn.site.page'
		}),
		entryRow({
			title: 'Artifacts',
			meta: files === 0 ? 'nothing built yet' : [plural(files, 'file'), bytes === 0 ? '' : formatSize(bytes)].filter((part) => part !== '').join(' · '),
			mark: 'download',
			command: 'temcoLearn.downloads'
		}),
		entryRow({ title: 'Publishing', meta: `${address} · ${waiting}`, mark: 'upload', command: 'temcoLearn.publishing' })
	];
	return [
		section({ title: 'Where it stands', desc: 'Three lines, each the one fact its own page acts on — the count here, the detail there.' }),
		`<div class="az-entries">${rows.join('')}</div>`
	].join('\n');
}

/** The page: what it is, what to do, the four steps, and where each kind of work lands. */
export function html(state: Snapshot): string {
	return [head(state), needsYou(state), workflow(state), whereItStands(state)].join('\n');
}