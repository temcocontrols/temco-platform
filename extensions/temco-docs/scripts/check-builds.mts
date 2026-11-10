// The two pages a build's files appear on: the Build Center and Publish & Releases.
//
// Four things this check keeps true. A page offers the acts it owns and nothing else. Both lists fold, because a site
// build leaves hundreds of pages and a page that prints all of them is a page nobody reads to the end. Build Center's
// third answer is one row per output the project was made with — the script it would run here, or the sentence saying
// why nothing would — and a Build button only where this repository has a script, because a target that cannot be made
// is reported rather than approximated with a different one. Publish & Releases shows the same five outputs as the
// categories of the files, so the ticks of the create form are what a person sees when they come to collect them.

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
	cards: (items: readonly { title: string; desc: string; note?: string; muted?: boolean }[]) =>
		items
			.map(
				(card) =>
					`<div class="az-card${card.muted === true ? ' az-card--muted' : ''}"><span class="az-card__title">${esc(card.title)}</span>` +
					`<p class="az-card__desc">${esc(card.desc)}</p>` +
					`${card.note === undefined ? '' : `<p class="az-card__note">${esc(card.note)}</p>`}</div>`
			)
			.join(''),
	actionBar: () => '',
	entryRow: (options: { title: string; meta?: string; command?: string }) =>
		`<div class="az-entry"${options.command === undefined ? '' : ` data-command="${options.command}"`}>` +
		`<span class="az-entry__title">${esc(options.title)}</span></div>`,
	/** A tile: the title, its status, its facts, what can be done to it, and the verdict at its right-hand end. */
	entry: (options: { title: string; status?: string; meta?: readonly (string | undefined)[]; state?: string; actions?: string }) =>
		`<div class="az-entry"><span class="az-entry__title">${esc(options.title)}</span>` +
		`${options.status === undefined ? '' : `<span class="az-entry__status">${esc(options.status)}</span>`}` +
		`<span class="az-entry__meta">${esc((options.meta ?? []).filter((fact) => fact !== undefined).join(' · '))}</span>` +
		`${options.actions ?? ''}` +
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

const outputsModule = createRequire(import.meta.url)(fileURLToPath(new URL('../../temco-store/out/catalog/outputs.js', import.meta.url))) as {
	PROJECT_OUTPUTS: readonly unknown[];
	DEFAULT_OUTPUTS: readonly string[];
	outputByValue(value: string): unknown;
	outputByKind(kind: string): unknown;
	chosenOutputs(stored: readonly string[]): unknown[];
	scriptFor(output: unknown, scripts: readonly string[]): string | undefined;
};

/** The store's exports, so the page reads the one list of outputs the application runs rather than a copy of it. */
const store = {
	slugOf: (text: string) => text.toLowerCase(),
	selection: {},
	outputs: {
		all: outputsModule.PROJECT_OUTPUTS,
		defaults: outputsModule.DEFAULT_OUTPUTS,
		byValue: outputsModule.outputByValue,
		byKind: outputsModule.outputByKind,
		chosen: outputsModule.chosenOutputs,
		scriptFor: outputsModule.scriptFor
	}
};

const vscode = {
	extensions: {
		getExtension: (id: string) =>
			id === 'temcocontrols.temco-store' ? { isActive: true, exports: store } : { isActive: true, exports: ui }
	},
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
		outputs: readonly string[];
		folder?: string;
		scripts: { name: string; command: string }[];
	}): string;
	releasesBody(facts: {
		builds: { id: number; startedAt: string; finishedAt?: string; status: string; revision?: string }[];
		artifacts: { kind: string; path: string; builtAt: string; bytes?: number }[];
		releases: unknown[];
		outputs: readonly string[];
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
	// The ticks the create form asked for: the same four a new project starts with.
	outputs: ['website', 'pdf', 'help', 'search'],
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

test('the page answers in order: what has run, what it left, what this project builds', () => {
	assert.deepEqual(
		[...pages.buildsBody(facts()).matchAll(/az-section__title">([^<]*)</gu)].map((match) => match[1]),
		['Builds', 'What they left', 'What this project builds']
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
	// The summary carries both labels — what is hidden, and what the second click does — so it is read by its first span.
	assert.match(html, /<details class="az-more"><summary><span class="az-more__closed">Show 4 older builds</u, 'the older builds do not fold');
	assert.match(html, /<details class="az-more"><summary><span class="az-more__closed">Show 3 more files</u, 'the files do not fold');
});

test('a file row opens the file, and says what it is and when it was written', () => {
	const file = rows(pages.buildsBody(facts())).find((row) => row.command === 'temcoDocs.openArtifact');
	assert.equal(file?.title, 'site');
	assert.match(String(file?.meta), /built .* ago/u);
	assert.match(pages.buildsBody(facts()), /Website|Offline help/u, 'the kind of the file is not shown');
});

test('one row per output the project was made with, in the create form\'s order, saying what it would run', () => {
	const html = pages.buildsBody(
		facts({
			scripts: [
				{ name: 'docs:site', command: 'docfx build' },
				{ name: 'build:help:dry', command: 'hhc help.hhp' }
			]
		})
	);
	const named = rows(html)
		.filter((row) => ['Website', 'PDF', 'Offline help', 'Search index', 'AI index'].includes(row.title))
		.map((row) => row.title);
	assert.deepEqual(named, ['Website', 'PDF', 'Offline help', 'Search index', 'AI index'], 'the outputs are not in the form\'s order');
	assert.match(html, /runs docs:site/u, 'the site script is not named');
	assert.match(html, /runs build:help:dry/u, 'the help script is not named');
	// What is in that output now, which is the half of the answer the old strip could not give.
	assert.match(html, /1 file now, newest .* ago/u, 'the files already written are not counted');
});

test('a Build button belongs to the outputs this repository can make, and names the output it builds', () => {
	const html = pages.buildsBody(
		facts({
			scripts: [
				{ name: 'docs:site', command: 'docfx build' },
				{ name: 'docs:pdf', command: 'prince' }
			]
		})
	);
	assert.deepEqual(
		[...html.matchAll(/<button data-command="temcoDocs\.buildOutput" data-args="([^"]+)">([^<]*)</gu)].map((match) => [
			match[2],
			JSON.parse(match[1].replace(/&quot;/gu, '"'))
		]),
		[
			['Build the Website', ['website']],
			['Build the PDF', ['pdf']]
		],
		'a button is offered for an output this repository cannot build, or one is missing'
	);
});

test('an output this repository has no script for is reported by name, never run as something else', () => {
	const html = pages.buildsBody(facts({ scripts: [{ name: 'docs:site', command: 'docfx build' }] }));
	assert.match(html, /this folder has no docs:pdf or build:pdf script, so nothing would run/u, 'a missing PDF build is not reported');
	assert.match(html, /this folder has no build:help:dry or docs:help script/u, 'a missing help build is not reported');
	// The search index is written by the site when a build is imported, which is a different answer from "no script".
	assert.match(html, /The site writes this index when a build of the pages is imported/u, 'the index is not explained');
	assert.doesNotMatch(html, /Build the PDF/u, 'a PDF is offered as buildable when nothing here makes one');
});

test('an output the project was not made with says so, and offers nothing', () => {
	const html = pages.buildsBody(facts({ outputs: ['website'] }));
	const ai = rows(html).find((row) => row.title === 'AI index');
	assert.match(String(ai?.meta), /The create form did not tick this one/u, 'an unused output is not explained');
	assert.match(html, /not part of this project/u, 'the row does not say it is not this project\'s');
});

test('a build never offers the deploying form of the help build', () => {
	const html = pages.buildsBody(facts({ scripts: [{ name: 'build:help', command: 'hhc deploy' }] }));
	assert.match(html, /building is not shipping/u, 'the deploying build is not ruled out');
	assert.doesNotMatch(html, /runs build:help\b/u, 'the deploying help build is offered as one that runs');
});

test('with nothing recorded, the callout says what a build is and the page still says what it builds', () => {
	const html = pages.buildsBody(facts({ builds: [], artifacts: [] }));
	assert.match(html, /No build has run here yet/u);
	assert.match(html, /What this project builds/u);
	assert.doesNotMatch(html, /<details/u, 'an empty page draws a fold');
	assert.doesNotMatch(html, /az-section__title">Builds</u, 'an empty page draws a builds list');
});

test('builds but no files: the files section says so instead of drawing nothing', () => {
	const html = pages.buildsBody(facts({ builds: [builds[0]], artifacts: [] }));
	assert.match(html, /No file has been written yet/u);
	assert.match(html, /a build that wrote none is not counted as one that worked/u);
});

// ---------- Publish & Releases: the same outputs, as the categories of the files ----------

/** The cards of "The files a reader can be given", as `title — the sentence — the note — whether it is greyed`. */
const categoryCards = (html: string): { title: string; desc: string; note: string; muted: boolean }[] =>
	html
		.split(/(?=<div class="az-card)/u)
		.slice(1)
		.map((chunk) => ({
			title: /az-card__title">([^<]*)</u.exec(chunk)?.[1] ?? '',
			desc: /az-card__desc">([^<]*)</u.exec(chunk)?.[1] ?? '',
			note: /az-card__note">([^<]*)</u.exec(chunk)?.[1] ?? '',
			muted: chunk.startsWith('<div class="az-card az-card--muted"')
		}));

const artifactsWithBytes = [
	...Array.from({ length: 8 }, (_unused, index) => ({
		kind: 'site',
		path: index < 4 ? `C:/Temco/t3000/dist/pages/page-${index}.md` : `C:/Temco/t3000/dist/media/pic-${index}.png`,
		builtAt: at(180),
		bytes: index < 4 ? 2048 : 4096
	}))
];

test('the categories are the five outputs in the form\'s order, greyed for the ones the project was not made with', () => {
	const html = pages.releasesBody(facts({ artifacts: artifactsWithBytes }));
	assert.deepEqual(
		categoryCards(html).map((card) => [card.title, card.muted]),
		[
			['Website', false],
			['PDF', false],
			['Offline help', false],
			['Search index', false],
			['AI index', true]
		]
	);
});

test('a category says what it holds, or what makes it, and never reads as an empty file list', () => {
	const html = pages.releasesBody(facts({ artifacts: artifactsWithBytes }));
	const cards = categoryCards(html);
	assert.match(cards[0]?.desc ?? '', /Built — newest .* ago/u, 'a built category does not say it is built');
	assert.match(cards[0]?.note ?? '', /files · /u, 'a built category does not weigh its files');
	assert.match(cards[1]?.desc ?? '', /this folder has no docs:pdf or build:pdf script/u, 'an unbuildable category names no reason');
	assert.match(cards[3]?.desc ?? '', /The site writes this index/u, 'the index does not say who writes it');
	assert.match(cards[4]?.desc ?? '', /Not part of this project/u, 'an unticked output does not say so');
});

test('every picked output gets its own block below, folding its files, and unticked ones do not', () => {
	const html = pages.releasesBody(facts({ artifacts: artifactsWithBytes }));
	const sections = [...html.matchAll(/az-section__title">([^<]*)</gu)].map((match) => match[1] ?? '');
	assert.deepEqual(
		sections.filter((title) => ['Website', 'PDF', 'Offline help', 'Search index', 'AI index'].includes(title)),
		['Website'],
		'a block is drawn for an output that holds no file of its own'
	);
	// The website's files fold; the three that hold nothing are callouts with the reason instead of an empty list.
	assert.match(html, /<span class="az-more__closed">Show \d+ more files</u, 'the website files do not fold');
	assert.match(html, /PDF: nothing to list yet/u);
	assert.match(html, /Offline help: nothing to list yet/u);
	assert.match(html, /Search index: nothing to list yet/u);
	assert.doesNotMatch(html, /AI index: nothing to list yet/u, 'an unticked output is drawn as a block');
});

test('a built output sorts its files newest first under its own heading', () => {
	const html = pages.releasesBody(facts({ artifacts: [...artifactsWithBytes, { kind: 'pdf', path: 'C:/Temco/t3000/dist/T3000.pdf', builtAt: at(5), bytes: 1024 * 1024 }] }));
	const cards = categoryCards(html);
	assert.match(cards[1]?.desc ?? '', /Built — newest .* ago/u, 'a PDF that exists is not reported as built');
	assert.match(cards[1]?.note ?? '', /1 file · 1\.0 MB/u, 'the PDF is not weighed');
	assert.match(html, /PDF<\/h2>|az-section__title">PDF</u, 'the PDF has no block of its own');
});

test('a project with no output recorded says so rather than showing five empty categories', () => {
	const html = pages.releasesBody(facts({ artifacts: artifactsWithBytes, outputs: [] }));
	assert.match(html, /This project has no outputs recorded/u);
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
console.log(`\n${cases.length - failedCount}/${cases.length} build and release page cases passed`);
if (failedCount > 0) {
	process.exitCode = 1;
}
