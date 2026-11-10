// The two pages a build's files appear on: the Build Center and Publish & Releases.
//
// Four things this check keeps true. A page offers the acts it owns and nothing else. Build Center is two answers — what
// this project can be built into (one card per output, the script it would run here or the sentence saying why nothing
// would, and a Build button only where this repository has a script) and the runs themselves, drawn as a record: one
// list, a hairline between two runs, no box around either. It does not reprint every file a build wrote — five hundred
// rows of names is a copy, not a record; the files are listed on Publish & Releases, which shows the same outputs as the
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
	numbers: (items: readonly { value: string; label: string }[]) =>
		`<div class="az-numbers">${items
			.map(
				(item) =>
					`<div class="az-number"><span class="az-number__value">${esc(item.value)}</span>` +
					`<span class="az-number__label">${esc(item.label)}</span></div>`
			)
			.join('')}</div>`,
	optionCards: () => '',
	callout: (options: { title: string; desc: string; actions?: string }) =>
		`<aside class="az-callout"><p>${esc(options.title)}</p>${options.actions ?? ''}</aside>`,
	questions: () => '',
	section: (options: { title: string; desc?: string; actions?: string }) =>
		`<div class="az-section"><h2 class="az-section__title">${esc(options.title)}</h2>${
			options.desc === undefined ? '' : `<p class="az-section__desc">${esc(options.desc)}</p>`
		}${options.actions ?? ''}</div>`,
	cards: (items: readonly { title: string; desc: string; note?: string; muted?: boolean; actions?: string }[]) =>
		items
			.map(
				(card) =>
					`<div class="az-card${card.muted === true ? ' az-card--muted' : ''}"><span class="az-card__title">${esc(card.title)}</span>` +
					`<p class="az-card__desc">${esc(card.desc)}</p>` +
					`${card.note === undefined ? '' : `<p class="az-card__note">${esc(card.note)}</p>`}` +
					`${card.actions === undefined ? '' : `<span class="az-card__actions">${card.actions}</span>`}</div>`
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
	/** The list a part's rows lie in; `log` keeps the variant the page asked for, so the check can read it. */
	entries: (rows: string, options: { log?: boolean } = {}) =>
		`<div class="az-entries${options.log === true ? ' az-entries--log' : ''}">${rows}</div>`,
	/** One part of a page: only the heading matters to the order this check reads. */
	part: (options: { title: string }) => `<div class="az-section"><h2 class="az-section__title">${esc(options.title)}</h2></div>`,
	head: () => '',
	figures: (items: readonly { value: string; label: string }[]) =>
		`<div class="az-numbers">${items
			.map(
				(item) =>
					`<div class="az-number"><span class="az-number__value">${esc(item.value)}</span>` +
					`<span class="az-number__label">${esc(item.label)}</span></div>`
			)
			.join('')}</div>`,
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
	/** The queue, and the draft it opens: the drafts the Review Center is holding. */
	reviewBody(
		drafts: readonly {
			id: number;
			documentSlug: string;
			source?: string;
			pageId: string;
			title: string;
			kind: string;
			body: string;
			createdAt: string;
			state: 'draft' | 'accepted' | 'discarded';
		}[],
		project: string | undefined
	): string;
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

/** The cards of a page, as `title — the sentence — the note — whether it is greyed`. */
const cardsOf = (html: string): { title: string; desc: string; note: string; muted: boolean }[] =>
	html
		.split(/(?=<div class="az-card)/u)
		.slice(1)
		.map((chunk) => ({
			title: /az-card__title">([^<]*)</u.exec(chunk)?.[1] ?? '',
			desc: /az-card__desc">([^<]*)</u.exec(chunk)?.[1] ?? '',
			note: /az-card__note">([^<]*)</u.exec(chunk)?.[1] ?? '',
			muted: chunk.startsWith('<div class="az-card az-card--muted"')
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

test('the page answers in order: what it can build, then the runs', () => {
	assert.deepEqual(
		[...pages.buildsBody(facts()).matchAll(/az-section__title">([^<]*)</gu)].map((match) => match[1]),
		['What this project builds', 'Builds']
	);
});

test('the page opens on four figures, so the state of the project is read at a glance', () => {
	const html = pages.buildsBody(facts());
	const numbers = [...html.matchAll(/class="az-number__value">([^<]*)</gu)].map((match) => match[1]);
	assert.equal(numbers.length, 4, 'the strip does not carry four figures');
	assert.deepEqual(numbers.slice(0, 3), ['9', '9', '0 KB'], 'the counts and the weight are not the recorded ones');
	assert.match(numbers[3] ?? '', /ago/u, 'the last build is not dated');
});

test('the runs are a record, not a stack of cards: one list, drawn as a log', () => {
	const html = pages.buildsBody(facts());
	assert.match(html, /<div class="az-entries az-entries--log">/u, 'the builds are not drawn as a log');
	assert.doesNotMatch(html, /<div class="az-entries"><div class="az-entry"><span class="tone-mark"/u, 'the builds are still boxes');
});

test('the page does not reprint every file: the files live on Publish & Releases, one block per output', () => {
	const html = pages.buildsBody(facts({ artifacts: artifactsWithBytes }));
	assert.doesNotMatch(html, /pic-\d+\.png/u, 'a file of the site is printed on the build page');
	assert.doesNotMatch(html, /file-3\.pdf/u, 'a file of the site is printed on the build page');
	assert.match(html, /The files themselves are listed on Publish &amp; Releases|The files themselves are listed on Publish & Releases/u);
	assert.match(html, /data-command="temcoDocs\.releases"/u, 'the way to the files is not on the page');
});

test('a build row says when it started and how long it took, counted from the two timestamps', () => {
	const first = rows(pages.buildsBody(facts()))[0];
	assert.equal(first.title, '#12');
	assert.match(first.meta, /started .* ago/u);
	assert.match(first.meta, /took 2 min 0 s/u, 'the duration is not counted');
	assert.match(pages.buildsBody(facts()), /Latest/u, 'the newest build is not marked');
});

test('the older runs fold after a handful of rows', () => {
	const html = pages.buildsBody(facts());
	// The summary carries both labels — what is hidden, and what the second click does — so it is read by its first span.
	assert.match(html, /<details class="az-more"><summary><span class="az-more__closed">Show 4 older builds</u, 'the older builds do not fold');
});

test('one card per output the project was made with, in the create form\'s order, saying what it would run', () => {
	const html = pages.buildsBody(
		facts({
			scripts: [
				{ name: 'docs:site', command: 'docfx build' },
				{ name: 'build:help:dry', command: 'hhc help.hhp' }
			]
		})
	);
	const named = cardsOf(html)
		.filter((card) => ['Website', 'PDF', 'Offline help', 'Search index', 'AI index'].includes(card.title))
		.map((card) => card.title);
	assert.deepEqual(named, ['Website', 'PDF', 'Offline help', 'Search index', 'AI index'], 'the outputs are not in the form\'s order');
	assert.match(html, /runs docs:site/u, 'the site script is not named');
	assert.match(html, /runs build:help:dry/u, 'the help script is not named');
	// What is in that output now, which is the half of the answer the old strip could not give.
	assert.match(html, /1 file now, newest .* ago/u, 'the files already written are not counted');
});

test('a Build button sits inside the card of every output this repository can make, and names it', () => {
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
	// A card is not itself a button: reading it must not start a build.
	assert.doesNotMatch(html, /class="az-card[^"]*" data-command/u, 'the whole card starts a build');
});

test('an output this repository has no script for is reported by name, never run as something else', () => {
	const html = pages.buildsBody(facts({ scripts: [{ name: 'docs:site', command: 'docfx build' }] }));
	assert.match(html, /this folder has no docs:pdf or build:pdf script/u, 'a missing PDF build is not reported');
	assert.match(html, /this folder has no build:help:dry or docs:help script/u, 'a missing help build is not reported');
	// The search index is written by the site when a build is imported, which is a different answer from "no script".
	assert.match(html, /The site writes this index when a build of the pages is imported/u, 'the index is not explained');
	assert.doesNotMatch(html, /Build the PDF/u, 'a PDF is offered as buildable when nothing here makes one');
});

test('an output the project was not made with says so, and offers nothing', () => {
	const html = pages.buildsBody(facts({ outputs: ['website'] }));
	const ai = cardsOf(html).find((card) => card.title === 'AI index');
	assert.match(String(ai?.desc), /Not part of this project/u, 'an unused output is not explained');
	assert.equal(ai?.note, 'Embeddings for answers, kept on this machine', 'the card does not say what the output is for');
	assert.equal(ai?.muted, true, 'an unused output is not greyed');
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

test('builds but no files: the page says nothing was written instead of drawing an empty list', () => {
	const html = pages.buildsBody(
		facts({ builds: [builds[0]], artifacts: [], scripts: [{ name: 'docs:site', command: 'docfx build' }] })
	);
	// The cards are where "what is in it now" lives, and the figures strip is where the total lives.
	assert.match(html, /nothing written yet/u, 'an output with no file does not say so');
	assert.match(html, /az-number__value">0</u, 'the strip does not count the files');
});

// ---------- Publish & Releases: the same outputs, as the tabs of the files ----------

/** The tabs of "The files a reader can be given": the name, the line under it, and what the tab says about itself. */
const tabsOf = (html: string): { title: string; note: string; selected: boolean; muted: boolean; controls: string }[] =>
	html
		.split(/(?=<button type="button" class="az-tab)/u)
		.slice(1)
		.map((chunk) => ({
			title: /az-tab__title">([^<]*)</u.exec(chunk)?.[1] ?? '',
			note: /az-tab__note">([^<]*)</u.exec(chunk)?.[1] ?? '',
			selected: /aria-selected="true"/u.test(chunk),
			muted: /class="az-tab[^"]*is-muted/u.test(chunk),
			controls: /aria-controls="([^"]*)"/u.exec(chunk)?.[1] ?? ''
		}));

/** The panels: which output each one belongs to, and whether it is the one showing. */
const panelsOf = (html: string): { id: string; hidden: boolean; text: string }[] =>
	html
		.split(/(?=<div class="az-tabpanel")/u)
		.slice(1)
		.map((chunk) => ({
			id: /id="output-panel-([^"]*)"/u.exec(chunk)?.[1] ?? '',
			// The attribute is written only when the panel is closed, so its absence is the open panel.
			hidden: /^<div class="az-tabpanel" id="[^"]*" role="tabpanel" aria-labelledby="[^"]*" hidden/u.test(chunk),
			text: chunk.replace(/<[^>]+>/gu, ' ').replace(/\s+/gu, ' ').trim()
		}));

const artifactsWithBytes = [
	...Array.from({ length: 8 }, (_unused, index) => ({
		kind: 'site',
		path: index < 4 ? `C:/Temco/t3000/dist/pages/page-${index}.md` : `C:/Temco/t3000/dist/media/pic-${index}.png`,
		builtAt: at(180),
		bytes: index < 4 ? 2048 : 4096
	}))
];

test('the outputs are a row of tabs in the form\'s order, greyed for the ones the project was not made with', () => {
	const html = pages.releasesBody(facts({ artifacts: artifactsWithBytes }));
	assert.deepEqual(
		tabsOf(html).map((tab) => [tab.title, tab.muted]),
		[
			['Website', false],
			['PDF', false],
			['Offline help', false],
			['Search index', false],
			['AI index', true]
		]
	);
});

test('a tab says what its output holds, or what makes it, in a line short enough to sit under the name', () => {
	const html = pages.releasesBody(facts({ artifacts: artifactsWithBytes }));
	const tabs = tabsOf(html);
	assert.match(tabs[0]?.note ?? '', /^8 files · /u, 'a built output does not say what it holds');
	assert.match(tabs[1]?.note ?? '', /no docs:pdf script/u, 'an unbuildable output names no reason');
	assert.match(tabs[3]?.note ?? '', /written by the site/u, 'the index does not say who writes it');
	assert.match(tabs[4]?.note ?? '', /not part of this project/u, 'an unticked output does not say so');
});

test('the page opens on the first output that holds something, and every tab names the panel it opens', () => {
	const html = pages.releasesBody(facts({ artifacts: artifactsWithBytes }));
	const tabs = tabsOf(html);
	const panels = panelsOf(html);
	assert.equal(tabs.filter((tab) => tab.selected).length, 1, 'more than one tab is drawn as chosen');
	assert.equal(tabs.find((tab) => tab.selected)?.title, 'Website', 'the page does not open on the built output');
	// Five tabs, five panels, and each tab points at the panel of its own output.
	assert.deepEqual(
		panels.map((panel) => panel.id),
		tabs.map((tab) => tab.controls.replace('output-panel-', '')),
		'a tab opens a panel that is not its own'
	);
	assert.deepEqual(panels.filter((panel) => panel.hidden).map((panel) => panel.id), ['pdf', 'help', 'search', 'ai']);
});

test('the chosen panel lists its files, folding after six, and an empty one says why instead of listing nothing', () => {
	const html = pages.releasesBody(facts({ artifacts: artifactsWithBytes }));
	const panels = panelsOf(html);
	assert.match(panels[0]?.text ?? '', /page-0\.md/u, 'the open panel does not list its files');
	assert.match(html, /<span class="az-more__closed">Show 2 more files</u, 'the files do not fold inside the panel');
	assert.match(panels[0]?.text ?? '', /Open folder/u, 'the panel has no way into the folder');
	assert.match(panels[1]?.text ?? '', /nothing to list yet/u, 'an empty output has no explanation');
	assert.match(panels[4]?.text ?? '', /is not part of this project/u, 'an unticked output has no explanation');
});

test('a built output sorts its files newest first and is weighed in its own tab and panel', () => {
	const html = pages.releasesBody(facts({ artifacts: [...artifactsWithBytes, { kind: 'pdf', path: 'C:/Temco/t3000/dist/T3000.pdf', builtAt: at(5), bytes: 1024 * 1024 }] }));
	const tabs = tabsOf(html);
	const panels = panelsOf(html);
	assert.match(tabs[1]?.note ?? '', /^1 file · 1\.0 MB$/u, 'the PDF is not weighed on its tab');
	assert.match(panels[1]?.text ?? '', /T3000\.pdf/u, 'the PDF is not listed in its own panel');
	assert.equal(panels.find((panel) => panel.id === 'pdf')?.hidden, true, 'a closed panel is drawn as open');
});

test('what publishing does is three facts in a row, read across rather than down', () => {
	const html = pages.releasesBody(facts({ artifacts: artifactsWithBytes }));
	const section = html.slice(html.indexOf('What publishing does'));
	// A row of cards, not a column of rows: the three parts of one act are read side by side.
	assert.match(section, /What publishing does/u);
	const cards = cardsOf(section).map((card) => card.title);
	assert.deepEqual(cards, ['Copies the site', 'Records the release', 'Leaves the old one alone']);
	assert.equal(cardsOf(section).filter((card) => card.muted).length, 0, 'a fact of publishing is drawn as greyed out');
});

test('only the site\'s data files are links, the link is the name, and no row carries a trailing Open', () => {
	const html = pages.releasesBody(facts({
		artifacts: [...artifactsWithBytes, { kind: 'site', path: 'C:/Temco/t3000/dist/site.json', builtAt: at(180), bytes: 64 }]
	}));
	const links = [...html.matchAll(/<button type="button" class="az-entry__title az-entry__title--link[^"]*" data-command="temcoDocs\.openArtifact"[^>]*>([^<]*)</gu)]
		.map((match) => match[1]);
	// The name itself is the way in — a page or a picture under it is read in the site, and a trailing "Open" on every
	// one of five hundred rows said the same word five hundred times.
	assert.deepEqual(links, ['site.json'], 'a file other than the JSON is offered as a link, or the JSON is not one');
	assert.doesNotMatch(html, /az-entry__go/u, 'a row still ends in a trailing Open');
	assert.match(panelsOf(html)[0]?.text ?? '', /page-0\.md/u, 'the panel does not name its files');
	assert.match(html, /<div class="az-entries az-entries--log">/u, 'the file list is still drawn as boxes');
	// The fold is a word, not a disclosure triangle.
	assert.match(html, /<summary><span class="az-more__closed">/u);
});

test('a project with no output recorded says so rather than showing five empty categories', () => {
	const html = pages.releasesBody(facts({ artifacts: artifactsWithBytes, outputs: [] }));
	assert.match(html, /This project has no outputs recorded/u);
});

// ---------- Review Center: one queue, and the draft it opens ----------

const drafts = [
	{
		id: 7,
		documentSlug: 't3000',
		source: 'T3000 release history',
		pageId: 't3000/commissioning/ports',
		title: 'Port configuration',
		kind: 'Markdown',
		body: '# Port configuration\n\nThe first line.\n\nThe second paragraph.',
		createdAt: at(4),
		state: 'draft' as const
	},
	{
		id: 6,
		documentSlug: 't3000',
		pageId: 't3000/commissioning/subnets',
		title: 'Subnet planning',
		kind: 'Markdown',
		body: '# Subnet planning\n\nPlaceholder.',
		createdAt: at(120),
		state: 'draft' as const
	}
];

/** The rows of a review queue, as `title — the line under it — whether it is the one open`. */
const tabsOf2 = (html: string): { title: string; meta: string; on: boolean }[] =>
	html
		.split(/(?=<button type="button" class="az-queue__tab)/u)
		.slice(1)
		.map((chunk) => ({
			title: /az-queue__title">([^<]*)</u.exec(chunk)?.[1] ?? '',
			meta: /az-queue__meta">([^<]*)</u.exec(chunk)?.[1] ?? '',
			on: /aria-selected="true"/u.test(chunk)
		}));

test('the queue is a vertical tab list: the row chosen is the draft opened beside it', () => {
	const html = pages.reviewBody(drafts, 't3000');
	assert.match(html, /<div class="az-queue" role="tablist" aria-orientation="vertical"/u, 'the queue is not a tab list');
	const tabs = [...html.matchAll(/<button type="button" class="az-queue__tab([^"]*)" role="tab" id="([^"]+)" aria-selected="(true|false)" aria-controls="([^"]+)"/gu)]
		.map((match) => ({ on: match[3] === 'true', tab: match[2], panel: match[4] }));
	assert.equal(tabs.length, 2, 'the queue does not have one row per draft');
	assert.equal(tabs.filter((tab) => tab.on).length, 1, 'more than one draft is drawn as chosen');
	assert.equal(tabs.find((tab) => tab.on)?.tab, 'draft-tab-7', 'the newest draft is not the one opened');
	assert.deepEqual(
		tabs.map((tab) => tab.panel),
		['draft-panel-7', 'draft-panel-6'],
		'a queue row opens a panel that is not its own draft'
	);
	assert.deepEqual(tabsOf2(html).map((row) => row.on), [true, false], 'the queue does not mark the open draft');
});

test('one draft is open at a time, and accepting writes the draft whose text is showing', () => {
	const html = pages.reviewBody(drafts, 't3000');
	// Exactly one panel without `hidden`, and it is the newest draft's.
	const panels = html.split(/(?=<div class="az-tabpanel" id="draft-panel-)/u).slice(1);
	assert.equal(panels.filter((panel) => !/role="tabpanel"[^>]*hidden/u.test(panel)).length, 1, 'two drafts are open at once');
	const open = panels.find((panel) => !/role="tabpanel"[^>]*hidden/u.test(panel)) ?? '';
	assert.match(open, /id="draft-panel-7"/u, 'the open panel is not the chosen draft');
	// The acts belong to the draft they settle: each panel names its own, so a closed draft cannot be accepted by mistake.
	for (const [panel, id] of [[7, 7], [6, 6]] as const) {
		const chunk = panels.find((one) => one.includes(`id="draft-panel-${panel}"`)) ?? '';
		assert.match(chunk, new RegExp(`data-command="temcoDocs\\.acceptDraft"[^>]*data-args="\\[${id}\\]"`, 'u'), `Accept does not name draft ${id}`);
		assert.match(chunk, new RegExp(`data-command="temcoDocs\\.discardDraft"[^>]*data-args="\\[${id}\\]"`, 'u'), `Discard does not name draft ${id}`);
	}
	assert.doesNotMatch(html, /az-queue__tab[^>]*>[^<]*<[^>]*data-command/u, 'a queue row carries an act');
});

test('a draft shows the text as it will be written, its kind, and how long it has waited', () => {
	const html = pages.reviewBody(drafts, 't3000');
	assert.match(html, /# Port configuration/u, 'the draft text is not on the page');
	assert.match(html, /Proposed for t3000\/commissioning\/ports, written from T3000 release history/u);
	assert.match(html, /5 lines/u, 'the line count is not shown');
	assert.match(html, /Latest/u, 'the newest draft is not marked');
	const older = tabsOf2(html)[1];
	assert.match(older?.meta ?? '', /no source/u, 'the older draft does not say where it came from');
	assert.match(older?.meta ?? '', /h ago/u, 'the older draft is not dated');
});

test('with nothing waiting, the page says so and draws no queue', () => {
	const html = pages.reviewBody([], 't3000');
	assert.match(html, /Nothing is waiting to be reviewed/u);
	assert.match(html, /az-callout/u);
	assert.doesNotMatch(html, /class="az-queue"/u, 'an empty queue is still drawn');
});

test('what settling a draft does is three facts in a row, read across', () => {
	const html = pages.reviewBody(drafts, 't3000');
	const section = html.slice(html.indexOf('What settling a draft does'));
	assert.deepEqual(cardsOf(section).map((card) => card.title), [
		'Accepting writes the page',
		'The text stays as evidence',
		'Only a release reaches a reader'
	]);
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
