// The Downloads page's own contract: the files a build produced, and where they landed.
//
// Three things this page has to keep straight. It names only what a build produces as a whole — the site, the help file,
// the pdf, the zip, the Word document — because a loose `.html` in `dist` is a fragment someone was iterating on, and one
// page listing both reads like a folder dump. Each file offers the acts its kind allows: a folder can be looked at but not
// "saved", a zip can be taken but not looked at. And every section title carries the 2 px brand bar the other pages draw.

import assert from 'node:assert/strict';
import { createRequire, Module } from 'node:module';
import { fileURLToPath } from 'node:url';

interface Artifact {
	kind: 'site' | 'chm' | 'pdf' | 'zip' | 'docx' | 'page';
	file: string;
	label: string;
	opens: 'editor' | 'external' | undefined;
	size: number | undefined;
	at: number;
}

interface Project {
	title: string;
	id: string;
	folder: string;
	artifacts: Artifact[];
	builtAt: string | undefined;
}

interface PageModule {
	PAGE_STYLE: string;
	html(state: { projects: readonly Project[]; root: string }): string;
}

const esc = (text: string) => String(text).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

/** The kit, rendered the way the page uses it — enough markup to read the result, none of the styling. */
const ui = {
	pageColumn: () => -1,
	page: (body: string) => body,
	escapeHtml: esc,
	icon: (name: string) => `[${name}]`,
	toneMark: (name: string) => `[${name}]`,
	hero: (options: { eyebrow?: string; title: string; desc?: string }) =>
		`<div class="az-wash"><p class="az-crumbs">${esc(options.eyebrow ?? '')}</p><h1 class="az-title">${esc(options.title)}</h1><p class="az-intro">${esc(options.desc ?? '')}</p></div>`,
	optionCards: () => '',
	cards: (items: readonly { title: string; desc: string; mark?: string }[]) =>
		`<div class="az-cards">${items.map((item) => `<div class="az-card"><span class="az-card__title">${esc(item.title)}</span><p class="az-card__desc">${esc(item.desc)}</p></div>`).join('')}</div>`,
	callout: (options: { title: string; desc: string; actions?: string }) =>
		`<aside class="az-callout"><p class="az-callout__title">${esc(options.title)}</p><p class="az-callout__desc">${esc(options.desc)}</p><div class="az-callout__actions">${options.actions ?? ''}</div></aside>`,
	section: (options: { title: string; desc?: string }) =>
		`<div class="az-section"><div class="az-section__text"><h2 class="az-section__title">${esc(options.title)}</h2>${options.desc === undefined ? '' : `<p class="az-section__desc">${esc(options.desc)}</p>`}</div></div>`,
	entryRow: () => '',
	code: () => '',
	commandScript: '',
	runCommand: () => undefined
};

const vscode = {
	window: { createWebviewPanel: () => ({ dispose() { } }) },
	ViewColumn: { Active: -1, One: 1 },
	ThemeIcon: class {
		id: string;
		constructor(id: string) {
			this.id = id;
		}
	},
	extensions: { getExtension: () => ({ isActive: true, exports: ui }) },
	workspace: { workspaceFolders: [], getConfiguration: () => ({ get: () => undefined }) },
	env: { openExternal: async () => true },
	Uri: { parse: (value: string) => ({ toString: () => value }), file: (value: string) => ({ fsPath: value }) }
};

const load = Module._load;
Module._load = function (request: string, parent: unknown, isMain: boolean) {
	if (request === 'vscode') {
		return vscode;
	}
	return load.call(this as unknown as NodeModule, request, parent, isMain);
};

const downloads = createRequire(import.meta.url)(fileURLToPath(new URL('../out/downloadPage.js', import.meta.url))) as PageModule;

const now = Date.now();
const artifact = (kind: Artifact['kind'], file: string, size: number | undefined, opens: Artifact['opens']): Artifact => ({
	kind,
	file,
	label: kind === 'site' ? 'the website' : kind === 'chm' ? 'offline help' : kind === 'pdf' ? 'pdf' : kind === 'zip' ? 'an archive' : kind === 'docx' ? 'Word' : 'a single page',
	opens,
	size,
	at: now - 2 * 3600e3
});

const built: Project = {
	title: 'T3000',
	id: 't3000',
	folder: 'C:/Temco/t3000',
	builtAt: new Date(now - 2 * 3600e3).toISOString(),
	artifacts: [
		artifact('site', 'C:/Temco/t3000/dist/site', undefined, 'editor'),
		artifact('chm', 'C:/Temco/t3000/dist/T3000.chm', 1153434, 'external'),
		artifact('pdf', 'C:/Temco/t3000/dist/T3000.pdf', 844800, 'external'),
		artifact('zip', 'C:/Temco/t3000/dist/T3000-site.zip', 4404019, undefined),
		artifact('docx', 'C:/Temco/t3000/dist/T3000-guide.docx', 220200, undefined),
		// The fragment this page must not list.
		artifact('page', 'C:/Temco/t3000/dist/index.html', 12000, 'external')
	]
};

/** A project whose only output is that fragment: it is not a project with files on this page at all. */
const fragments: Project = {
	title: 'Test1',
	id: 'test1',
	folder: 'C:/Temco/test1',
	builtAt: new Date(now - 3600e3).toISOString(),
	artifacts: [artifact('page', 'C:/Temco/test1/dist/index.html', 9000, 'external')]
};

const root = 'C:/Users/Double/Temco';

const cases: { name: string; run: () => void }[] = [];
const test = (name: string, run: () => void): void => {
	cases.push({ name, run });
};

/** Every card on the page, as `name — meta — the commands it offers`. */
const fileCards = (html: string): { name: string; meta: string; commands: string[] }[] =>
	[...html.matchAll(/<div class="dl-file">([\s\S]*?)<\/div>/gu)].map((match) => {
		const chunk = match[1];
		return {
			name: /<span class="dl-file__name">[\s\S]*?<span>([^<]*)<\/span>/u.exec(chunk)?.[1] ?? '',
			meta: /<span class="dl-file__meta">([^<]*)<\/span>/u.exec(chunk)?.[1] ?? '',
			commands: [...chunk.matchAll(/data-command="([^"]+)"/gu)].map((found) => found[1])
		};
	});

test('every section title carries the brand bar the other pages draw', () => {
	assert.match(downloads.PAGE_STYLE, /\.az-section__title::before \{[^}]*width: 2px/u, 'the bar has no width');
	assert.match(downloads.PAGE_STYLE, /\.az-section__title::before \{[^}]*height: 12px/u, 'the bar has no height');
	assert.match(downloads.PAGE_STYLE, /\.az-section__title::before \{[^}]*background: var\(--az-blue/u, 'the bar is not the brand colour');
	assert.match(downloads.PAGE_STYLE, /\.az-section__title \{ position: relative; padding-left: 10px; \}/u, 'the bar overlaps the title');
});

test('the page is three sections: what a build writes, where it lands, and what is here', () => {
	const html = downloads.html({ projects: [built, fragments], root });
	assert.deepEqual(
		[...html.matchAll(/az-section__title">([^<]*)</gu)].map((match) => match[1]),
		['What a build writes', 'Where it lands', 'The files on this machine']
	);
});

test('where it lands is one card, and the folder is the link', () => {
	const html = downloads.html({ projects: [built], root });
	assert.deepEqual([...html.matchAll(/<span class="dl-place__label">([^<]*)</gu)].map((match) => match[1]), ['Working area']);
	assert.match(
		html,
		/<button type="button" class="az-btn az-btn--link dl-place__path" title="Show it in Explorer" data-command="temcoLearn\.revealArtifact" data-args="&quot;C:\/Users\/Double\/Temco&quot;">/u,
		'the working area is not a link that opens it'
	);
	assert.match(html, /<code>&lt;project&gt;\/dist — the site in dist\/site or dist\/docs/u, 'the build folder is not spelled out');
	assert.match(html, /<code>&lt;project&gt;\/HelpDocs, or a HelpDocs folder beside the projects<\/code>/u, 'the help folder is not spelled out');
	assert.doesNotMatch(html, /az-facts|az-fact__/u, 'the three-cell band is back');
});

test('only what a build produces as a whole: the site, the help, the pdf, the zip, the document', () => {
	const html = downloads.html({ projects: [built, fragments], root });
	assert.deepEqual(
		fileCards(html).map((card) => card.name),
		['Website', 'T3000.chm', 'T3000.pdf', 'T3000-site.zip', 'T3000-guide.docx']
	);
	assert.doesNotMatch(html, /index\.html/u, 'a loose page is listed as an output');
	assert.deepEqual(
		[...html.matchAll(/<span class="dl-project__name">([^<]*)</gu)].map((match) => match[1]),
		['T3000'],
		'a project with nothing but a fragment still gets a heading'
	);
});

test('each card offers the two acts a file on disk has: find it, and take a copy where one can be taken', () => {
	assert.deepEqual(
		fileCards(downloads.html({ projects: [built], root })).map((card) => [card.name, card.commands]),
		[
			['Website', ['temcoLearn.revealArtifact']],
			['T3000.chm', ['temcoLearn.revealArtifact', 'temcoLearn.downloadArtifact']],
			['T3000.pdf', ['temcoLearn.revealArtifact', 'temcoLearn.downloadArtifact']],
			['T3000-site.zip', ['temcoLearn.revealArtifact', 'temcoLearn.downloadArtifact']],
			['T3000-guide.docx', ['temcoLearn.revealArtifact', 'temcoLearn.downloadArtifact']]
		]
	);
	// Looking at a file is the panel's job and the OS's; this page is the inventory.
	const html = downloads.html({ projects: [built], root });
	assert.doesNotMatch(html, /temcoLearn\.previewArtifact/u, 'a card opens a viewer from the inventory page');
	assert.match(html, /<span>Show in the folder<\/span>/u, 'the card act is not named');
});

test('the cards pack from the left, at a width the content asks for', () => {
	assert.match(
		downloads.PAGE_STYLE,
		/\.dl-files \{[^}]*grid-template-columns: repeat\(auto-fill, minmax\(215px, 240px\)\)/u,
		'the cards stretch to fill the row instead of keeping one width'
	);
	assert.match(downloads.PAGE_STYLE, /\.dl-files \{[^}]*justify-content: start/u, 'the cards are not packed from the left');
	assert.match(downloads.PAGE_STYLE, /\.dl-file \{[^}]*text-align: left/u, 'the card text does not start at its own left edge');
});

test('a card says what the file is and how big it is', () => {
	assert.deepEqual(
		fileCards(downloads.html({ projects: [built], root })).map((card) => card.meta),
		['the website', 'offline help · 1.1 MB', 'pdf · 825 KB', 'an archive · 4.2 MB', 'Word · 215 KB']
	);
});

test('the count in the title block counts the cards, not the fragments', () => {
	const html = downloads.html({ projects: [built, fragments], root });
	assert.match(html, /5 files across 1 project are on this machine now/u);
	assert.doesNotMatch(html, /6 files|2 projects/u, 'the fragments are counted as files, or a fragment-only project as a project');
});

test('with nothing built, the page says so once and draws no empty grids', () => {
	const html = downloads.html({ projects: [fragments], root });
	assert.match(html, /No file to take yet/u);
	assert.match(html, /0 files across 0 projects/u);
	assert.doesNotMatch(html, /dl-file|dl-project/u, 'an empty page still drew a card grid');
});

let failedCount = 0;
for (const { name, run } of cases) {
	try {
		run();
		console.log(`  ok  ${name}`);
	} catch (error) {
		failedCount += 1;
		console.error(`FAIL  ${name}`);
		console.error('  ' + String((error as Error).message).split('\n').join('\n  '));
	}
}
console.log(`\n${cases.length - failedCount}/${cases.length} downloads cases passed`);
if (failedCount > 0) {
	process.exitCode = 1;
}
