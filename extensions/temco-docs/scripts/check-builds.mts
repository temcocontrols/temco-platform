// The Build Center's own contract: what has run, what the files are, and where a build writes.
//
// Three things this page has to keep true. It offers the two acts it owns and nothing else — refreshing a page is what
// reopening it does, and publishing has its own page, so neither belongs in the title block. It folds both lists, because
// a site build leaves hundreds of pages and a page that prints all of them is a page nobody reads to the end. And it says
// where a build writes — the script and the folder — which is the one fact this page can state that no other page does.

import assert from 'node:assert/strict';
import { createRequire, Module } from 'node:module';
import { fileURLToPath } from 'node:url';

const esc = (text: string) =>
	String(text).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

/** The page kit, rendered the way the page uses it — enough markup to read the order and the words. */
const ui = {
	pageColumn: () => -1,
	fileColumn: () => -2,
	rowSlug: () => undefined,
	page: (body: string) => body,
	escapeHtml: esc,
	icon: (name: string) => `[${name}]`,
	toneMark: (name: string) => `[${name}]`,
	hero: (options: { title: string; actions?: readonly { label: string; command: string }[] }) =>
		`<div class="az-wash"><h1>${esc(options.title)}</h1>${(options.actions ?? [])
			.map((action) => `<button data-command="${action.command}">${esc(action.label)}</button>`)
			.join('')}</div>`,
	numbers: () => '',
	optionCards: () => '',
	callout: (options: { title: string; desc: string; actions?: string }) =>
		`<aside class="az-callout"><p>${esc(options.title)}</p>${options.actions ?? ''}</aside>`,
	questions: () => '',
	section: (options: { title: string; desc?: string; actions?: string }) =>
		`<div class="az-section"><h2 class="az-section__title">${esc(options.title)}</h2>${
			options.desc === undefined ? '' : `<p class="az-section__desc">${esc(options.desc)}</p>`
		}${options.actions ?? ''}</div>`,
	cards: () => '',
	actionBar: () => '',
	entryRow: () => '',
	code: () => '',
	floatAction: () => '',
	commandScript: '',
	runCommand: () => undefined
};

const vscode = {
	extensions: { getExtension: () => ({ isActive: true, exports: ui }) },
	l10n: { t: (message: string) => message },
	window: { createWebviewPanel: () => ({ dispose() { } }) },
	ViewColumn: { Active: -1, One: 1 },
	ThemeIcon: class {
		id: string;
		constructor(id: string) {
			this.id = id;
		}
	},
	workspace: { workspaceFolders: [], getConfiguration: () => ({ get: () => undefined }) },
	env: { openExternal: async () => true },
	Uri: {
		parse: (value: string) => ({ toString: () => value }),
		file: (value: string) => ({ fsPath: value }),
		joinPath: (base: unknown, ...parts: string[]) => ({ fsPath: parts.join('/') })
	}
};

const load = Module._load;
Module._load = function (request: string, parent: unknown, isMain: boolean) {
	if (request === 'vscode') {
		return vscode;
	}
	return load.call(this as unknown as NodeModule, request, parent, isMain);
};

interface Pages {
	buildsBody(facts: {
		project?: string;
		builds: { id: number; startedAt: string; finishedAt?: string; status: string; revision?: string }[];
		artifacts: { kind: string; path: string; builtAt: string }[];
		releases: unknown[];
	}): string;
}

const pages = createRequire(import.meta.url)(fileURLToPath(new URL('../out/docsPages.js', import.meta.url))) as Pages;

const at = (minutes: number): string => new Date(Date.now() - minutes * 60e3).toISOString();

const builds = [
	{ id: 12, startedAt: at(180), finishedAt: at(178), status: 'succeeded', revision: '6f2c1ab' },
	...Array.from({ length: 8 }, (_unused, index) => ({
		id: 11 - index,
		startedAt: at(300 + index * 60),
		finishedAt: at(299 + index * 60),
		status: index % 3 === 0 ? 'failed' : 'succeeded',
		revision: '6f2c1ab'
	}))
];

const artifacts = Array.from({ length: 9 }, (_unused, index) => ({
	kind: index === 0 ? 'site' : index === 1 ? 'chm' : index === 2 ? 'pdf' : 'site',
	path: index === 0 ? 'C:/Temco/t3000/dist/site' : index === 1 ? 'C:/Temco/HelpDocs/T3000.chm' : `C:/Temco/t3000/dist/file-${index}.pdf`,
	builtAt: at(180)
}));

const empty = { builds: [], artifacts: [], releases: [] };

const cases: { name: string; run: () => void }[] = [];
const test = (name: string, run: () => void): void => {
	cases.push({ name, run });
};

/** The rows of a list, as `title — the meta it carries — the command it runs`. */
const rows = (html: string): { title: string; meta: string; command: string }[] =>
	[...html.matchAll(/<div class="az-entry[^"]*"([^>]*)>[\s\S]*?az-entry__title[^>]*">([^<]*)<[\s\S]*?<\/div><\/div>/gu)].map((match) => ({
		title: match[2],
		meta: /az-entry__meta">([\s\S]*?)<\/span><\/div>/u.exec(match[0])?.[1] ?? '',
		command: /data-command="([^"]+)"/u.exec(match[1])?.[1] ?? ''
	}));

test('the title block offers the two acts it owns, and only those', () => {
	const html = pages.buildsBody({ builds, artifacts, releases: [] });
	assert.deepEqual(
		[...html.matchAll(/<button data-command="([^"]+)">([^<]*)</gu)].map((match) => [match[2], match[1]]),
		[
			['Build the Site', 'temcoDocs.buildSite'],
			['Build the Offline Help', 'temcoDocs.buildHelp']
		],
		'a navigation act is sitting in the title block'
	);
	// Refreshing and publishing are not acts of this title block: one is what reopening the page does, the other has its
	// own page. Both used to be buttons beside Build, which made three of four controls navigation.
	const head = html.slice(0, html.indexOf('az-section__title'));
	assert.doesNotMatch(head, /temcoDocs\.releases|temcoDocs\.builds/u, 'a navigation act is still in the title block');
});

test('the page answers in order: what has run, what it left, where a build writes', () => {
	assert.deepEqual(
		[...pages.buildsBody({ builds, artifacts, releases: [] }).matchAll(/az-section__title">([^<]*)</gu)].map((match) => match[1]),
		['Builds', 'What they left', 'Where a build writes']
	);
});

test('a build row says when it started and how long it took, counted from the two timestamps', () => {
	const first = rows(pages.buildsBody({ builds, artifacts, releases: [] }))[0];
	assert.equal(first.title, '#12');
	assert.match(first.meta, /started .* ago/u);
	assert.match(first.meta, /took 2 min 0 s/u, 'the duration is not counted');
	assert.match(pages.buildsBody({ builds, artifacts, releases: [] }), /Latest/u, 'the newest build is not marked');
});

test('both lists fold after a handful of rows', () => {
	const html = pages.buildsBody({ builds, artifacts, releases: [] });
	assert.match(html, /<details class="build-more"><summary>Show 4 older builds<\/summary>/u, 'the older builds do not fold');
	assert.match(html, /<details class="build-more"><summary>Show 3 more files<\/summary>/u, 'the files do not fold');
});

test('a file row opens the file, and says what it is and when it was written', () => {
	const file = rows(pages.buildsBody({ builds, artifacts, releases: [] })).find((row) => row.command === 'temcoDocs.openArtifact');
	assert.equal(file?.title, 'site');
	assert.match(String(file?.meta), /built .* ago/u);
	assert.match(pages.buildsBody({ builds, artifacts, releases: [] }), /Website|Offline help/u, 'the kind of the file is not shown');
});

test('where a build writes names both scripts and both folders', () => {
	const html = pages.buildsBody({ builds, artifacts, releases: [] });
	assert.match(html, /docs:site → dist\/site · dist\/docs/u);
	assert.match(html, /build:help:dry → \.chm in the project, or in HelpDocs beside it/u);
});

test('with nothing recorded, the callout says what a build is and the page still says where it writes', () => {
	const html = pages.buildsBody(empty);
	assert.match(html, /No build has run here yet/u);
	assert.match(html, /Where a build writes/u);
	assert.doesNotMatch(html, /<details/u, 'an empty page draws a fold');
	assert.doesNotMatch(html, /az-section__title">Builds</u, 'an empty page draws a builds list');
});

test('builds but no files: the files section says so instead of drawing nothing', () => {
	const html = pages.buildsBody({ builds: [builds[0]], artifacts: [], releases: [] });
	assert.match(html, /No file has been written yet/u);
	assert.match(html, /a build that wrote none is not counted as one that worked/u);
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
console.log(`\n${cases.length - failedCount}/${cases.length} build center cases passed`);
if (failedCount > 0) {
	process.exitCode = 1;
}
