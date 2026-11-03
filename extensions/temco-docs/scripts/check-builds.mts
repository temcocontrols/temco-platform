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
	entryRow: (options: { title: string; meta?: string; command?: string }) =>
		`<div class="az-entry"${options.command === undefined ? '' : ` data-command="${options.command}"`}>` +
		`<span class="az-entry__title">${esc(options.title)}</span></div>`,
	/** A tile: the title, its facts, and the verdict at its right-hand end. */
	entry: (options: { title: string; meta?: readonly (string | undefined)[]; state?: string }) =>
		`<div class="az-entry"><span class="az-entry__title">${esc(options.title)}</span>` +
		`<span class="az-entry__meta">${esc((options.meta ?? []).filter((fact) => fact !== undefined).join(' · '))}</span>` +
		`<span class="az-entry__go">${esc(options.state ?? '')}</span></div>`,
	/** The list a part's rows lie in. */
	entries: (rows: string) => rows,
	/** One part of a page: only the heading matters to the order this check reads. */
	part: (options: { title: string }) => `<div class="az-section"><h2 class="az-section__title">${esc(options.title)}</h2></div>`,
	head: () => '',
	figures: () => '',
	notice: () => '',
	button: (label: string, command: string, options: { args?: unknown } = {}) =>
		`<button data-command="${command}"${options.args === undefined ? '' : ` data-args="${esc(JSON.stringify(options.args))}"`}>${esc(label)}</button>`,
	remember: () => undefined,
	n: (count: number, one: string, many: string) => `${count} ${count === 1 ? one : many}`,
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
		folder?: string;
		scripts: { name: string; command: string }[];
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

const facts = (over: Record<string, unknown> = {}) => ({
	builds,
	artifacts,
	releases: [],
	scripts: [] as { name: string; command: string }[],
	...over
});

const cases: { name: string; run: () => void }[] = [];
const test = (name: string, run: () => void): void => {
	cases.push({ name, run });
};

/** The rows of a list, as `title — the meta it carries — the command it runs`. */
const rows = (html: string): { title: string; meta: string; command: string }[] =>
	html
		.split(/(?=<div class="az-entry[" ])/u)
		.slice(1)
		.map((chunk) => ({
			title: /az-entry__title[^>]*">([^<]*)</u.exec(chunk)?.[1] ?? '',
			meta: /az-entry__meta[^>]*">([\s\S]*?)<\/span>(?=<\/div>|$)/u.exec(chunk)?.[1] ?? '',
			command: /data-command="([^"]+)"/u.exec(chunk)?.[1] ?? ''
		}));

test('the title block offers the two acts it owns, and only those', () => {
	const html = pages.buildsBody(facts());
	// Read the title block alone: a section further down offers its own act, and that is the point of a section.
	const head = html.slice(0, html.indexOf('az-section__title'));
	assert.deepEqual(
		[...head.matchAll(/<button data-command="([^"]+)">([^<]*)</gu)].map((match) => [match[2], match[1]]),
		[
			['Build the Site', 'temcoDocs.buildSite'],
			['Build the Offline Help', 'temcoDocs.buildHelp']
		],
		'a navigation act is sitting in the title block'
	);
	// Refreshing and publishing are not acts of this title block: one is what reopening the page does, the other has its
	// own page. Both used to be buttons beside Build, which made three of four controls navigation.
	assert.doesNotMatch(head, /temcoDocs\.releases|temcoDocs\.builds/u, 'a navigation act is still in the title block');
});

test('the page answers in order: what has run, what it left, where a build writes', () => {
	assert.deepEqual(
		[...pages.buildsBody(facts()).matchAll(/az-section__title">([^<]*)</gu)].map((match) => match[1]),
		['Builds', 'What they left', 'Where a build writes']
	);
});

test('a build row says when it started and how long it took, counted from the two timestamps', () => {
	const first = rows(pages.buildsBody(facts()))[0];
	assert.equal(first.title, '#12');
	assert.match(first.meta, /started .* ago/u);
	assert.match(first.meta, /took 2 min 0 s/u, 'the duration is not counted');
	assert.match(pages.buildsBody(facts()), /Latest/u, 'the newest build is not marked');
});

test('both lists fold after a handful of rows', () => {
	const html = pages.buildsBody(facts());
	assert.match(html, /<details class="az-more"><summary>Show 4 older builds<\/summary>/u, 'the older builds do not fold');
	assert.match(html, /<details class="az-more"><summary>Show 3 more files<\/summary>/u, 'the files do not fold');
});

test('a file row opens the file, and says what it is and when it was written', () => {
	const file = rows(pages.buildsBody(facts())).find((row) => row.command === 'temcoDocs.openArtifact');
	assert.equal(file?.title, 'site');
	assert.match(String(file?.meta), /built .* ago/u);
	assert.match(pages.buildsBody(facts()), /Website|Offline help/u, 'the kind of the file is not shown');
});

test('where a build writes names the script that runs and the folders it is looked for in', () => {
	const html = pages.buildsBody(facts({
		scripts: [
			{ name: 'docs:site', command: 'docfx build' },
			{ name: 'build:help:dry', command: 'hhc help.hhp' }
		]
	}));
	assert.match(html, /runs docs:site/u, 'the site script is not named');
	assert.match(html, /into dist\/site, or dist\/docs/u, 'the site folders are not named');
	assert.match(html, /runs build:help:dry/u, 'the help script is not named');
	assert.match(html, /one \.chm in the project, or in HelpDocs beside it/u, 'the help file is not named');
	// What is in those folders now, which is the half of the answer the old strip could not give.
	assert.match(html, /1 file now, newest .* ago/u, 'the files already written are not counted');
	assert.match(html, /script found/gu, 'a script that exists is not reported as found');
});

test('a script the repository no longer has is reported, and each target says what happens instead', () => {
	const html = pages.buildsBody(facts());
	assert.match(html, /no docs:site — this application writes the site itself/u, 'the built-in generator is not mentioned');
	assert.match(html, /no build:help:dry — nothing would be run/u, 'a missing help build is not reported');
	assert.match(html, /no script/gu, 'a missing script is not marked');
	assert.doesNotMatch(html, /runs docs:site/u, 'a script nobody has is still named as one that runs');
});

test('where a build writes never offers the deploying help build', () => {
	const html = pages.buildsBody(facts());
	assert.match(html, /building is not shipping/u, 'the deploying build is not ruled out');
});

test('with nothing recorded, the callout says what a build is and the page still says where it writes', () => {
	const html = pages.buildsBody(facts({ builds: [], artifacts: [] }));
	assert.match(html, /No build has run here yet/u);
	assert.match(html, /Where a build writes/u);
	assert.doesNotMatch(html, /<details/u, 'an empty page draws a fold');
	assert.doesNotMatch(html, /az-section__title">Builds</u, 'an empty page draws a builds list');
});

test('builds but no files: the files section says so instead of drawing nothing', () => {
	const html = pages.buildsBody(facts({ builds: [builds[0]], artifacts: [] }));
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
