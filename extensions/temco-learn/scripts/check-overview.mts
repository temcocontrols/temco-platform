// The Overview page's own contract: what it says, in what order, and what it refuses to be.
//
// The page is the one place a newcomer is told what this module is, so its words are checked rather than left to drift: the
// sentences first (counted from the data, naming no project), the one callout, four workflow steps each ending in a link,
// and then the three parts the work lands in — each a heading, a real list of rows, and its acts along the bottom edge,
// never at the right of the heading. The last case is the boundary that was crossed once already: this is our page, not a
// page of the website.

import assert from 'node:assert/strict';
import { createRequire, Module } from 'node:module';
import { fileURLToPath } from 'node:url';

interface OverviewModule {
	html(state: unknown): string;
	PAGE_STYLE: string;
	OVERVIEW_VIEW_TYPE: string;
}

/** The kit, rendered the way the page uses it — enough markup to read the result, no styling. */
const esc = (text: string) => String(text).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

interface HeroOptions {
	eyebrow?: string;
	title: string;
	desc?: string;
	note?: { text: string; link?: { command: string } };
	actions?: readonly { label: string; command: string; kind?: string }[];
	stats?: readonly unknown[];
}

const ui = {
	pageColumn: () => -1,
	page: (body: string) => body,
	escapeHtml: esc,
	icon: (name: string) => `[${name}]`,
	toneMark: (name: string) => `[${name}]`,
	hero: (options: HeroOptions) => {
		const actions = (options.actions ?? []).map((action) => `<button data-command="${action.command}">${esc(action.label)}</button>`).join('');
		const note = options.note === undefined ? '' : `<p class="az-note">${esc(options.note.text)}</p>`;
		const stats = options.stats === undefined ? '' : '<div class="az-lead__stats"></div>';
		return `<div class="az-wash"><p class="az-crumbs">${esc(options.eyebrow ?? '')}</p><h1 class="az-title">${esc(options.title)}</h1><p class="az-intro">${esc(options.desc ?? '')}</p>${note}${stats}<div class="az-row">${actions}</div></div>`;
	},
	optionCards: (items: readonly { tag?: string; title: string; desc: string; ticks: readonly string[]; label: string; command: string }[]) =>
		`<div class="az-options">${items
			.map(
				(item) =>
					`<section class="az-option"><span class="az-option__tag">${esc(item.tag ?? '')}</span><h2 class="az-option__title">${esc(item.title)}</h2><p class="az-option__desc">${esc(item.desc)}</p><ul class="az-option__ticks">${item.ticks.map((tick) => `<li>${esc(tick)}</li>`).join('')}</ul><button data-command="${item.command}">${esc(item.label)}</button></section>`
			)
			.join('')}</div>`,
	callout: (options: { title: string; desc: string; actions?: string }) =>
		`<aside class="az-callout"><p class="az-callout__title">${esc(options.title)}</p><p class="az-callout__desc">${esc(options.desc)}</p><div class="az-callout__actions">${options.actions ?? ''}</div></aside>`,
	section: (options: { title: string; desc?: string; actions?: string }) =>
		`<div class="az-section"><div class="az-section__text"><h2 class="az-section__title">${esc(options.title)}</h2>${options.desc === undefined ? '' : `<p class="az-section__desc">${esc(options.desc)}</p>`}</div>${options.actions === undefined ? '' : `<div class="az-section__actions">${options.actions}</div>`}</div>`,
	entryRow: (options: { title: string; meta?: string; mark?: string; command?: string; args?: unknown; go?: string }) => {
		const plain = options.command === undefined;
		const attr = plain ? '' : ` data-command="${esc(options.command as string)}"${options.args === undefined ? '' : ` data-args="${esc(JSON.stringify(options.args))}"`}`;
		const mark = options.mark === undefined ? '' : `<span class="az-entry__icon">[${esc(options.mark)}]</span>`;
		const meta = options.meta === undefined ? '' : `<span class="az-entry__meta">${esc(options.meta)}</span>`;
		const go = plain ? '' : `<span class="az-entry__go">${esc(options.go ?? 'Open')}</span>`;
		return `<div class="az-entry${plain ? '' : ' az-entry--action'}"${attr}>${mark}<div class="az-entry__main"><span class="az-entry__title">${esc(options.title)}</span>${meta}</div>${go}</div>`;
	},
	commandScript: '',
	runCommand: () => undefined
};

const vscode = {
	ViewColumn: { Active: -1 },
	ThemeIcon: class {
		id: string;
		constructor(id: string) {
			this.id = id;
		}
	},
	extensions: { getExtension: () => ({ isActive: true, exports: ui }) },
	window: { createWebviewPanel: () => { throw new Error('not opened by a check'); } },
	workspace: {
		workspaceFolders: [],
		getConfiguration: () => ({ get: (name: string) => (name === 'workspaceFolder' ? 'C:/Temco' : undefined) })
	}
};

const load = Module._load;
Module._load = function (request: string, parent: unknown, isMain: boolean) {
	if (request === 'vscode') {
		return vscode;
	}
	return load.call(this as unknown as NodeModule, request, parent, isMain);
};

const overview = createRequire(import.meta.url)(fileURLToPath(new URL('../out/overview.js', import.meta.url))) as OverviewModule;

const cases: { name: string; run: () => void }[] = [];
const test = (name: string, run: () => void) => cases.push({ name, run });

/** A website with two projects, one build waiting, three unpublished changes, and the files those builds wrote. */
function state(overrides: { projects?: unknown[]; builds?: unknown[]; artifacts?: unknown[]; pending?: number; published?: unknown; repo?: unknown } = {}): unknown {
	return {
		site: {
			projects: overrides.projects ?? [
				{ id: 't3000', title: 'T3000', section: 'documentation', versions: [{ version: '13.0', builtAt: new Date().toISOString(), pages: [{ href: 'a', title: 'A' }, { href: 'b', title: 'B' }] }, { version: '12.9', builtAt: new Date().toISOString(), pages: [{ href: 'c', title: 'C' }] }], builtAt: new Date().toISOString() },
				{ id: 'bacnet', title: 'BACnet', section: 'documentation', versions: [{ version: '4.2', builtAt: new Date().toISOString(), pages: [{ href: 'd', title: 'D' }] }], builtAt: new Date().toISOString() }
			]
		},
		builds: overrides.builds ?? [{ folder: 'C:/Temco/nettools/dist/site', title: 'NetTools', id: 'nettools', at: Date.now() }],
		artifacts: overrides.artifacts ?? [
			{
				title: 'T3000', id: 't3000', folder: 'C:/Temco/t3000', builtAt: new Date().toISOString(),
				artifacts: [
					{ kind: 'site', file: 'C:/Temco/t3000/dist/site', label: 'the website', opens: 'editor', size: undefined, at: Date.now() },
					{ kind: 'chm', file: 'C:/Temco/HelpDocs/T3000.chm', label: 'offline help', opens: 'external', size: 1153434, at: Date.now() },
					{ kind: 'zip', file: 'C:/Temco/t3000/dist/T3000-site.zip', label: 'an archive', opens: undefined, size: 4404019, at: Date.now() }
				]
			}
		],
		published: overrides.published ?? {
			where: 'temcocontrols/docs',
			base: 'https://temcocontrols.github.io/docs/',
			commit: '6f2c1ab',
			at: new Date(Date.now() - 12 * 60e3).toISOString(),
			pending: overrides.pending ?? 3
		},
		// Only when a case asks for it: the clone is the one fact the page has to fetch for, so the default page is the one
		// that did not look.
		...(overrides.repo === undefined ? {} : { repo: overrides.repo })
	};
}

/** Nothing at all: no project, no build, no file, no repository. */
const empty = { projects: [], builds: [], artifacts: [], pending: 0, published: { where: undefined, base: undefined, commit: undefined, at: undefined, pending: 0 } };

/** The rows the page draws, if it draws any: `title — meta — command`. */
const rowsOf = (html: string): { title: string; meta: string; command: string }[] => {
	const starts = [...html.matchAll(/<div class="az-entry(?: az-entry--action)?"/gu)].map((match) => match.index ?? 0);
	return starts.map((start, index) => {
		const chunk = html.slice(start, starts[index + 1] ?? html.length);
		const tag = chunk.slice(0, chunk.indexOf('>'));
		const command = /data-command="([^"]*)"/u.exec(tag)?.[1] ?? '';
		const title = /<span class="az-entry__title">([^<]*)</u.exec(chunk)?.[1] ?? '';
		const meta = /<span class="az-entry__meta">([^<]*)</u.exec(chunk)?.[1] ?? '';
		return { command, title, meta };
	});
};

test('the page opens by saying what this module is, counting from the data and naming no project in its prose', () => {
	const html = overview.html(state());
	assert.match(html, /Temco Learn is the documentation website\./u);
	assert.match(html, /It is built from its own repository/u);
	assert.match(html, /It holds 2 projects, 3 versions and 4 pages today/u);
	assert.equal(html.includes('az-lead__stats'), false, 'the page opens on a row of figures');
	assert.equal(html.includes('az-numbers'), false, 'the page draws a row of numbers');
	const prose = html.slice(0, html.indexOf('az-callout'));
	assert.doesNotMatch(prose, /T3000|BACnet/u, 'the opening sentences name a project');
});

test('the workflow is four steps, in order, each ending in a link with a glyph', () => {
	const html = overview.html(state());
	assert.match(html, /Publishing workflow/u);
	const steps = [...html.matchAll(/az-option__tag">(\d)<\/span><h2 class="az-option__title">([^<]+)</gu)].map((match) => `${match[1]}:${match[2]}`);
	assert.deepEqual(steps, ['1:Build', '2:Add', '3:Publish', '4:Download']);
	for (const command of ['temcoDocs\\.builds', 'temcoLearn\\.addBuilds', 'temcoLearn\\.publish', 'temcoLearn\\.revealArtifact']) {
		assert.match(html, new RegExp(`data-command="${command}"`, 'u'));
	}
	for (const label of ['Open Temco Docs', 'Choose a build · 1 waiting', 'Publish · 3 changes', 'Show in the folder']) {
		assert.ok(html.includes(label), `${label} is missing from the workflow`);
	}
});

test('the page is the callout, the workflow, and where each kind of work lands', () => {
	const html = overview.html(state());
	const titles = [...html.matchAll(/az-section__title">([^<]*)</gu)].map((match) => match[1]);
	assert.deepEqual(titles, ['Publishing workflow', 'Where it stands'], 'the page still restates a part another page owns');
	assert.equal(html.includes('az-section__actions'), false, 'a heading still carries acts on its right');
	// Three rows, one per page that owns the fact — a count here, the detail there, never a copy of its list.
	assert.deepEqual(
		rowsOf(html).map((row) => [row.title, row.meta, row.command]),
		[
			['Documentation Site', '2 projects · 3 versions · 4 pages', 'temcoLearn.site.page'],
			['Artifacts', '3 files · 5.3 MB', 'temcoLearn.downloads'],
			['Publishing', 'https://temcocontrols.github.io/docs/ · 3 changes waiting', 'temcoLearn.publishing']
		]
	);
	assert.doesNotMatch(html, /az-facts|az-fact__|az-block__foot/u, 'the page still draws a band of another page’s facts');
});

test('the callout says what needs doing, or that nothing does, or that nothing exists yet', () => {
	assert.match(overview.html(state()), /What needs doing/u);
	assert.match(overview.html(state()), /1 build on disk is not on the website · 3 changes are not published\./u);
	assert.match(overview.html(state({ builds: [], pending: 0 })), /Nothing needs doing/u);
});

test('with nothing built and nothing published, the callout says so, and the three lines say so too', () => {
	const html = overview.html(state(empty));
	assert.match(html, /Nothing has been built yet/u);
	assert.match(html, /data-command="temcoDocs\.builds"/u);
	assert.deepEqual(
		rowsOf(html).map((row) => [row.title, row.meta]),
		[
			['Documentation Site', '0 projects · 0 versions · 0 pages'],
			['Artifacts', 'nothing built yet'],
			['Publishing', 'no address yet · nothing waiting']
		]
	);
});

test('the page says the repository has moved on, and names the one act that fixes it', () => {
	const clone = {
		folder: 'C:/Temco/temco-learn', ready: true, cloned: true, behind: 3, ahead: 0, changes: [],
		installed: true, built: true, commit: '164232f', at: new Date(Date.now() - 3600e3).toISOString()
	};
	const moved = overview.html(state({ repo: clone }));
	assert.match(moved, /temco-learn has 3 commits you do not have/u);
	assert.match(moved, /data-command="temcoLearn\.site\.update"/u);
	assert.match(moved, /data-command="temcoLearn\.site\.page"/u);
	// It is the first thing on the page after the title: the reader arrives here, so the sentence a reader needs comes first.
	assert.ok(
		moved.indexOf('temcoLearn.site.update') < moved.indexOf('What needs doing'),
		'the update bar is drawn below the callout that says what needs doing'
	);

	// Level with the remote, or no clone at all: the page says nothing about updating, rather than saying "up to date".
	for (const quiet of [
		overview.html(state()),
		overview.html(state({ repo: { ...clone, behind: 0 } })),
		overview.html(state({ repo: { ...clone, ready: false } }))
	]) {
		assert.equal(quiet.includes('temcoLearn.site.update'), false, 'the page offers an update with nothing to update');
	}

	// A clone with edits of its own says why it will not be pulled, instead of offering a pull that would fail.
	const dirty = overview.html(state({ repo: { ...clone, changes: [{ code: 'M', path: 'src/App.tsx' }] } }));
	assert.match(dirty, /1 path changed in the clone/u);
});

test('the brand bar is a short rule beside the title, and the cards sit four in a row', () => {
	assert.match(overview.PAGE_STYLE, /\.az-section__title::before \{[^}]*height: 12px/u);
	assert.match(overview.PAGE_STYLE, /\.az-section__title::before \{[^}]*width: 2px[^}]*background: var\(--az-blue/u);
	assert.match(overview.PAGE_STYLE, /\.az-options \{ grid-template-columns: repeat\(auto-fit, minmax\(215px, 1fr\)\)/u);
});

test('the page is the application’s, not the website’s', () => {
	const html = overview.html(state());
	assert.doesNotMatch(html, /overview\.html|reader\.html|assets\/site\.css/u, 'the page reaches into the published website');
	assert.doesNotMatch(html, /<a [^>]*href=/u, 'the page links instead of running a command');
});

let failed = 0;
for (const { name, run } of cases) {
	try {
		run();
		console.log(`  ok  ${name}`);
	} catch (error) {
		failed += 1;
		console.error(`FAIL  ${name}`);
		console.error(error instanceof Error ? error.message : error);
	}
}
console.log(`\n${cases.length - failed}/${cases.length} overview cases passed`);
process.exit(failed === 0 ? 0 : 1);