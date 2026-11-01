// Build output — the page behind "No file to take", and behind the Build output view's title bar.
//
// A build writes five things, and a folder with none of them is not a fault: it is a project nobody has built yet. This
// page says what a build writes, where each kind lands, and — when the workspace has files — which ones.

import * as vscode from 'vscode';
import { Artifact, ArtifactKind, formatSize, isDownloadable, nameOf, ProjectArtifacts } from './artifacts';
import { ago } from './state';
import { callout, cards, commandScript, escapeHtml, hero, icon, page, pageColumn, runCommand, section } from './ui';

export const DOWNLOAD_VIEW_TYPE = 'temcoLearn.downloads';

/** The page's own rules: the brand bar a section title carries on every page of ours, one card for where files land, and
 *  a grid of cards for the files themselves. */
export const PAGE_STYLE = `
.az-section__title { position: relative; padding-left: 10px; }
.az-section__title::before { content: ''; position: absolute; left: 0; top: 50%; transform: translateY(-50%); width: 2px; height: 12px; border-radius: 1px; background: var(--az-blue, #0078d4); }
.dl-place { display: grid; gap: var(--sp-2); padding: var(--sp-4); border-radius: var(--r-2); background: var(--surface-card); }
.dl-place__label { color: var(--ink-3); font-size: 11px; letter-spacing: .04em; text-transform: uppercase; }
.dl-place__path { justify-self: start; padding: 2px 0; font-family: var(--font-mono); font-size: 13px; }
.dl-place__note { display: grid; grid-template-columns: 92px minmax(0, 1fr); gap: var(--sp-2); color: var(--ink-2); font-size: 12px; line-height: 17px; }
.dl-place__note code { color: var(--ink-1); font-family: var(--font-mono); font-size: 12px; overflow-wrap: break-word; }
.dl-project { display: flex; align-items: baseline; gap: var(--sp-3); margin: var(--sp-5) 0 var(--sp-2); }
.dl-project__name { color: var(--ink-1); font-size: 12.5px; font-weight: 600; }
.dl-project__meta { color: var(--ink-3); font-size: 11.5px; }
.dl-files { display: grid; grid-template-columns: repeat(auto-fill, minmax(215px, 240px)); justify-content: start; gap: var(--sp-3); }
.dl-file { display: grid; gap: 2px; padding: var(--sp-3) var(--sp-4); border-radius: var(--r-2); background: var(--surface-card); text-align: left; }
.dl-file__name { display: flex; align-items: center; gap: var(--sp-1); color: var(--ink-1); font-family: var(--font-mono); font-size: 12.5px; overflow-wrap: break-word; }
.dl-file__name .icon { flex: none; width: 14px; height: 14px; color: var(--az-blue); }
.dl-file__meta { color: var(--ink-3); font-size: 11.5px; line-height: 16px; }
.dl-file__acts { display: flex; flex-wrap: wrap; gap: var(--sp-1) var(--sp-3); margin-top: var(--sp-1); }
`;

/** Everything the page says: the files found, and where a build puts them. */
export interface DownloadFacts {
	projects: readonly ProjectArtifacts[];
	root: string;
}

export class DownloadPage implements vscode.Disposable {
	private opened: vscode.WebviewPanel | undefined;

	constructor(private readonly read: () => Promise<DownloadFacts>) { }

	open(): void {
		if (this.opened !== undefined) {
			this.opened.reveal(pageColumn());
			void this.render();
			return;
		}
		this.opened = vscode.window.createWebviewPanel(DOWNLOAD_VIEW_TYPE, 'Build Output', pageColumn(), {
			enableScripts: true,
			localResourceRoots: []
		});
		this.opened.iconPath = new vscode.ThemeIcon('cloud-download');
		this.opened.onDidDispose(() => {
			this.opened = undefined;
		});
		this.opened.webview.onDidReceiveMessage(runCommand);
		void this.render();
	}

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
		opened.webview.html = page(html(await this.read()), { title: 'Build Output', script: commandScript, extraCss: PAGE_STYLE });
	}
}

const plural = (count: number, one: string): string => `${count} ${count === 1 ? one : `${one}s`}`;

/** The commands a page of this module may draw: a typo is a compile error, not a dead button. */
type PageCommand = 'temcoLearn.downloadArtifact' | 'temcoLearn.revealArtifact' | 'temcoDocs.builds';

/** One act at the end of a card, drawn as a link: the page has no buttons that compete with its own text. */
function button(label: string, command: PageCommand, args?: unknown): string {
	const data = args === undefined ? '' : ` data-args="${escapeHtml(JSON.stringify(args))}"`;
	return `<button type="button" class="az-btn az-btn--link" data-command="${escapeHtml(command)}"${data}><span>${escapeHtml(label)}</span></button>`;
}

/** The glyph a file card wears, from what the file is. */
function markOf(kind: ArtifactKind): string {
	switch (kind) {
		case 'site':
			return 'globe';
		case 'chm':
			return 'book';
		case 'zip':
			return 'package';
		default:
			return 'document';
	}
}

/** The five things a build writes, and where each one lands. */
function kinds(): string {
	return cards([
		{
			title: 'The website',
			desc: 'A folder of pages — the same one the preview serves, and the one a version on the site is made from.',
			mark: 'globe'
		},
		{ title: 'Offline help', desc: 'A .chm a person can open on a machine with no network, beside the project or in HelpDocs.', mark: 'book' },
		{ title: 'A pdf', desc: 'The same pages as one file, for printing and for sending to somebody.', mark: 'document' },
		{ title: 'An archive', desc: 'A zip of the site, which is what usually gets attached to a release.', mark: 'package' },
		{ title: 'A Word document', desc: 'The export a reviewer marks up, when the project asks for one.', mark: 'document' }
	]);
}

/**
 * Where files land: one card, because there is one working area.
 *
 * The paths are the card's own links — a folder written out is the one thing on this page a person wants to open, and a
 * separate "Show in the folder" button under it would be the same act said twice.
 */
function place(root: string): string {
	const note = (term: string, value: string): string =>
		`<span class="dl-place__note"><span>${escapeHtml(term)}</span><code>${escapeHtml(value)}</code></span>`;
	return `<div class="dl-place"><span class="dl-place__label">Working area</span><button type="button" class="az-btn az-btn--link dl-place__path" title="Show it in Explorer" data-command="temcoLearn.revealArtifact" data-args="${escapeHtml(
		JSON.stringify(root)
	)}">${icon('folder')}<span>${escapeHtml(root)}</span></button>${note(
		'A build writes',
		'<project>/dist — the site in dist/site or dist/docs, and the exports beside it'
	)}${note('Offline help', '<project>/HelpDocs, or a HelpDocs folder beside the projects')}</div>`;
}

/**
 * One file, as a card: what it is, how big, and the two things a person does with a file on disk — find it, or take a copy.
 *
 * `Show in the folder` rather than `Look`: this page is the inventory of what exists, and looking at a `.pdf` or the built
 * site is the panel's job and the OS's. A card that opened a viewer from here made the page a second preview surface.
 */
function fileCard(artifact: Artifact): string {
	const meta = [artifact.label, formatSize(artifact.size)].filter((part) => part !== '').join(' · ');
	const acts = [
		button('Show in the folder', 'temcoLearn.revealArtifact', artifact.file),
		isDownloadable(artifact) ? button('Save a copy', 'temcoLearn.downloadArtifact', artifact.file) : ''
	].filter((act) => act !== '');
	return `<div class="dl-file"><span class="dl-file__name">${icon(markOf(artifact.kind))}<span>${escapeHtml(
		nameOf(artifact)
	)}</span></span><span class="dl-file__meta">${escapeHtml(meta)}</span>${
		acts.length === 0 ? '' : `<span class="dl-file__acts">${acts.join('')}</span>`
	}</div>`;
}

/**
 * The files on this machine, one grid per project.
 *
 * Only what a build produces as a whole: the site, the help file, the pdf, the zip, the Word document. A loose `.html` in
 * `dist` is a page of a build someone was iterating on, not something to take away, and listing it beside `T3000.pdf`
 * made the page look like a folder listing.
 */
function filesHere(projects: readonly ProjectArtifacts[]): string {
	const blocks = projects.map((project) => {
		const shown = project.artifacts.filter((artifact) => artifact.kind !== 'page');
		if (shown.length === 0) {
			return '';
		}
		return `<div class="dl-project"><span class="dl-project__name">${escapeHtml(project.title)}</span><span class="dl-project__meta">${escapeHtml(
			project.builtAt === undefined ? 'on disk' : `built ${ago(project.builtAt)}`
		)}</span></div><div class="dl-files">${shown.map(fileCard).join('')}</div>`;
	});
	return blocks.filter((block) => block !== '').join('\n');
}

export function html(state: DownloadFacts): string {
	const shown = state.projects.filter((project) => project.artifacts.some((artifact) => artifact.kind !== 'page'));
	const files = shown.reduce(
		(total, project) => total + project.artifacts.filter((artifact) => artifact.kind !== 'page').length,
		0
	);

	const empty = callout({
		title: 'No file to take yet',
		desc: 'Nothing in the working area looks like a build output. Build a project in Temco Docs — the files appear here the moment the build finishes, without anything being added to the site.',
		mark: 'info',
		actions: '<button type="button" class="az-btn az-btn--primary" data-command="temcoDocs.builds"><span>Open Temco Docs</span></button>'
	});

	return [
		hero({
			eyebrow: 'Temco Learn',
			mark: 'download',
			title: 'Build Output',
			desc: `A build writes more than a website: ${plural(files, 'file')} across ${plural(shown.length, 'project')} are on this machine now. This page says what a build writes, where it lands, and which files are there — and the three steps a build takes to reach a reader: Temco Docs writes it, the panel adds it to the site, and the Publishing page publishes it.`,
			descWide: true
		}),
		files === 0 ? empty : '',
		section({ title: 'What a build writes', desc: 'Five shapes, and a build writes whichever ones its project asks for.' }),
		kinds(),
		section({ title: 'Where it lands', desc: 'Everything a build writes stays inside the working area — nothing is copied anywhere else.' }),
		place(state.root),
		files === 0
			? ''
			: section({
					title: 'The files on this machine',
					desc: 'What each project has now, one card per file. A loose page a build left in dist is not listed: it is a fragment, not an output.'
				}),
		files === 0 ? '' : filesHere(shown)
	]
		.filter((part) => part !== '')
		.join('\n');
}
