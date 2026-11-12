// The Site page's add section: the one act that turns a build folder into a version on the website.
//
// The panel stopped listing "builds not on the site" because adding is a *site* operation — it writes into the site
// repository, like clone, build and publish do. This gate holds the page to that: every build on disk the site does not
// serve is a row with the reason it waits and one `Add…` button, the section says what adding does and does not do, and a
// page opened *for* the section puts it first.

import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createRequire, Module } from 'node:module';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('..', import.meta.url));

interface PageModule {
	html(state: unknown): string;
}

const esc = (text: string) => String(text).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

/** The kit, rendered the way the page uses it — enough markup to read the order of the page. */
const ui = {
	pageColumn: () => -1,
	page: (body: string) => body,
	escapeHtml: esc,
	icon: (name: string) => `[${name}]`,
	toneMark: (name: string) => `[${name}]`,
	hero: (options: { title: string; desc?: string; actions?: readonly { label: string; command: string }[] }) =>
		`<div class="az-wash"><h1>${esc(options.title)}</h1>${(options.actions ?? [])
			.map((action) => `<button data-command="${esc(action.command)}">${esc(action.label)}</button>`)
			.join('')}</div>`,	optionCards: () => '',
	cards: () => '',
	callout: (options: { title: string }) => `<aside class="az-callout"><p>${esc(options.title)}</p></aside>`,
	section: (options: { title: string; desc?: string; actions?: string }) =>
		`<div class="az-section"><h2 class="az-section__title">${esc(options.title)}</h2>${options.desc === undefined ? '' : `<p class="az-section__desc">${esc(options.desc)}</p>`}${
			options.actions === undefined ? '' : `<div class="az-section__actions">${options.actions}</div>`
		}</div>`,
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

const site = createRequire(import.meta.url)(fileURLToPath(new URL('../out/sitePage.js', import.meta.url))) as PageModule;

const repo = {
	folder: 'C:/Users/Double/temco/temco-learn',
	ready: true,
	cloned: true,
	where: 'temcocontrols/temco-learn',
	base: 'https://temcocontrols.github.io/docs/',
	branch: 'main',
	commit: '577ca57',
	at: new Date(Date.now() - 86400e3).toISOString(),
	behind: 0,
	ahead: 0,
	changes: [],
	installed: true,
	built: true
};

const facts = (overrides: Record<string, unknown> = {}) => ({
	repo,
	status: { state: 'running', text: 'running' },
	log: [],
	publish: [],
	configured: true,
	port: 1025,
	pending: [
		{ title: 'NetTools', folder: 'C:/Temco/nettools/dist/site', why: 'not on the site' },
		{ title: 'T3000', folder: 'C:/Temco/t3000/dist/site', why: 'newer than 13.0' }
	],
	...overrides
});

/** Log lines as the module records them: the text, and how it should read. */
const lines = (texts: readonly string[], tone: 'plain' | 'action' | 'warn' = 'plain') =>
	texts.map((text) => ({ text, tone }));

const cases: { name: string; run: () => void }[] = [];
const test = (name: string, run: () => void): void => {
	cases.push({ name, run });
};

/** The rows of the add section, as `title — why — the folder it would add`. */
const addRows = (html: string): { title: string; why: string; args: string }[] =>
	[...html.matchAll(/<div class="site-add__row">([\s\S]*?)<\/div>/gu)].map((match) => ({
		title: /<span class="site-add__name">([^<]*)<\/span>/u.exec(match[1])?.[1] ?? '',
		why: /<span class="site-add__why">([^<]*)<\/span>/u.exec(match[1])?.[1] ?? '',
		args: /data-args="([^"]*)"/u.exec(match[1])?.[1] ?? ''
	}));

test('every build the site does not serve is a row, with its reason and one Add act', () => {
	const html = site.html(facts());
	assert.deepEqual(addRows(html), [
		{ title: 'NetTools', why: 'not on the site', args: '&quot;C:/Temco/nettools/dist/site&quot;' },
		{ title: 'T3000', why: 'newer than 13.0', args: '&quot;C:/Temco/t3000/dist/site&quot;' }
	]);
	assert.match(html, /<h2 class="az-section__title">Builds not on the site<\/h2>/u);
	assert.equal((html.match(/data-command="temcoLearn\.addBuild"/gu) ?? []).length, 2, 'each row does not offer the add');
});

test('the section says what adding is, and what it is not', () => {
	assert.match(
		site.html(facts()),
		/Adding copies a build into the site repository as a new version\. It does not publish it/u,
		'the section does not say that adding is not publishing'
	);
	assert.match(site.html(facts()), /data-command="temcoDocs\.builds"/u, 'the section does not name where a build comes from');
});

test('with nothing waiting, the section says so instead of drawing an empty list', () => {
	const html = site.html(facts({ pending: [] }));
	assert.deepEqual(addRows(html), []);
	assert.match(html, /Every build on this machine is on the site already/u);
});

test('a page opened for the add section puts it first, and marks it', () => {
	const focused = site.html(facts({ focus: 'add' }));
	const plain = site.html(facts());
	const at = (html: string, needle: string): number => html.indexOf(needle);
	assert.ok(at(focused, 'Builds not on the site') < at(focused, 'This machine'), 'the add section is not first');
	assert.ok(at(plain, 'This machine') < at(plain, 'Builds not on the site'), 'the add section does not follow the machine');
	assert.match(focused, /<div class="site-add site-add--focus">/u, 'the section is not marked when it was asked for');
});

test('the page never reaches into the website to do it', () => {
	const html = site.html(facts());
	assert.doesNotMatch(html, /<a [^>]*href=/u, 'the page links instead of running a command');
});

/** The paths the page lists, grouped, as `kind:path`. */
const changeRows = (html: string): string[] => {
	const groups = [...html.matchAll(/site-changes__kind">([^<]*)</gu)];
	const rows = [...html.matchAll(/site-change__path">([^<]*)</gu)].map((match) => match[1]);
	return groups.map((group) => group[1]).concat(rows);
};

test('the changes are grouped by what wrote them, because "commit or discard them" is not advice without it', () => {
	const dirty = facts({
		repo: {
			...repo,
			changes: [
				{ code: 'M', path: '.gitignore', kind: 'edit' },
				{ code: 'M', path: 'public/catalog.json', kind: 'generated' },
				{ code: 'M', path: 'public/search.json', kind: 'generated' },
				{ code: 'M', path: 'public/content/t3000/1.0.json', kind: 'noise' }
			]
		}
	});
	const html = site.html(dirty);
	// Yours first: it is the only group a pull stops for, so it is the only one that needs a person.
	assert.deepEqual(changeRows(html), [
		'Yours',
		'Written by the build',
		'Line endings only',
		'.gitignore',
		'public/catalog.json',
		'public/search.json',
		'public/content/t3000/1.0.json'
	]);
	assert.match(html, /Commit and push 1 edit/u, 'the commit act does not say what it will carry');
	assert.equal((html.match(/data-command="temcoLearn\.site\.diff"/gu) ?? []).length, 4, 'a row does not offer its difference');
	// A discard for each of the four rows, one for the two groups the build wrote, and one for the whole list — the last of
	// which is the only way to clear somebody's own edits in bulk, because "Yours" never offers a group discard — and none of
	// them is offered for "Yours" as a group.
	assert.equal((html.match(/data-command="temcoLearn\.site\.discard"/gu) ?? []).length, 8, 'the discard acts are not where they belong');
	assert.match(html, /Discard 3 build paths/u);
	assert.match(html, /Discard all 4 paths/u, 'the section does not offer to clear the whole list');
	const discardButtons = [
		...html.matchAll(/<button[^>]*data-command="temcoLearn\.site\.discard"[^>]*data-args="([^"]+)"[^>]*>([\s\S]*?)<\/button>/gu)
	].map((match) => ({
		paths: (JSON.parse(match[1].replace(/&quot;/gu, '"')) as { paths?: string[] }).paths ?? [],
		label: match[2].replace(/<[^>]+>/gu, '')
	}));
	assert.deepEqual(
		discardButtons.find((one) => one.label.startsWith('Discard all'))?.paths,
		['.gitignore', 'public/catalog.json', 'public/search.json', 'public/content/t3000/1.0.json'],
		'Discard all does not carry every path in the clone'
	);
	// The header of the group of edits carries no bulk discard: those are the paths somebody has to decide about.
	const yoursHeader = /site-changes__kind">Yours<\/span>(?:(?!<\/div>)[\s\S])*<\/div>/u.exec(html)?.[0] ?? '';
	assert.ok(yoursHeader.startsWith('site-changes__kind">Yours'), 'the group of edits was not found');
	assert.equal(yoursHeader.includes('temcoLearn.site.discard'), false, 'the group of edits offers a bulk discard');
});

test('a clean clone says nothing about changes, rather than drawing an empty list', () => {
	const html = site.html(facts());
	assert.equal(html.includes('Changes in the clone'), false, 'the page draws a changes section with nothing in it');
	assert.equal(html.includes('temcoLearn.site.commit'), false, 'the page offers a commit with nothing to commit');
});

// ---------- what the page says after an act ----------
//
// A pull of sixteen commits, a discard and a commit-and-push all finish by redrawing this page, and it used to come back
// looking exactly as it did before: the lines were in the activity area at the bottom, off-screen, so a person who had
// just pressed a button could not tell whether anything had happened. The outcome now sits under the title, where the eye
// already is, with the few lines behind it and one way to the whole log.

test('Refresh sits beside Pull, and only the one with something to do is promised', () => {
	const behind = site.html(facts({ repo: { ...repo, behind: 16 } }));
	assert.match(behind, /data-command="temcoLearn\.site\.pull"/u, 'a clone sixteen commits behind does not offer the pull');
	assert.match(behind, /data-command="temcoLearn\.site\.refresh"/u, 'the page cannot be asked to read the clone again');
	const current = site.html(facts({ repo: { ...repo, behind: 0 } }));
	assert.equal(current.includes('temcoLearn.site.pull'), false, 'a clone that is up to date still offers a pull');
	assert.match(current, /data-command="temcoLearn\.site\.refresh"/u, 'an up-to-date clone cannot be read again');
	assert.equal(
		site.html(facts({ repo: { ...repo, ready: false } })).includes('temcoLearn.site.refresh'),
		false,
		'a folder that is not the site offers to read it again'
	);
});

test('an act that just finished says what it did, in one line, with the way to the log', () => {
	const html = site.html(facts({ report: { title: 'Pulled 16 commits', tone: 'ok' } }));
	const at = (needle: string): number => html.indexOf(needle);
	assert.ok(at('site-report') > 0, 'the page says nothing about the act that opened it');
	assert.ok(at('site-report') < at('This machine'), 'the outcome sits below the machine it is about');
	assert.match(html, /site-report__title">Pulled 16 commits</u, 'the outcome is not named');
	assert.equal(html.includes('site-report--warn'), false, 'a good outcome is drawn as a warning');
	assert.match(html, /data-command="temcoLearn\.site\.showLog"/u, 'the page does not lead to the whole log');
});

/** The lines of one console pane, as text: the tone spans are markup, and the check is about what a person reads. */
const consoleLines = (html: string, cls: string): string[] => {
	const body = new RegExp(`<pre class="site-console ${cls}">([\\s\\S]*?)</pre>`, 'u').exec(html)?.[1] ?? '';
	return body.split('\n').map((line) => line.replace(/<[^>]+>/gu, ''));
};

test('the activity area shows the last five lines, with one press for the rest', () => {
	const log = lines(Array.from({ length: 12 }, (_, index) => `line ${index + 1}`));
	const html = site.html(facts({ log }));
	assert.deepEqual(
		consoleLines(html, 'site-console--tail'),
		['line 8', 'line 9', 'line 10', 'line 11', 'line 12'],
		'the fold does not hold the last five lines, newest included'
	);
	assert.deepEqual(
		consoleLines(html, 'site-console--all'),
		Array.from({ length: 12 }, (_, index) => `line ${index + 1}`),
		'the whole log is not there to unfold'
	);
	assert.match(html, /<label class="site-tabs__toggle" for="site-more">/u, 'there is no way to ask for the rest');
	assert.match(html, /Show more/u);
	assert.match(html, /Show less/u);
	assert.match(html, /id="site-more"/u, 'the fold is not a checkbox the labels can switch');
});

test('a log with nothing hidden has no fold, and no second copy of itself', () => {
	const html = site.html(facts({ log: lines(['one', 'two', 'three']) }));
	assert.equal(html.includes('site-tabs__toggle'), false, 'the page offers to unfold three lines');
	assert.equal(html.includes('site-console--all'), false, 'the same three lines are drawn twice');
	assert.deepEqual(consoleLines(html, 'site-console--tail'), ['one', 'two', 'three'], 'the lines are not the log');
});

test('every glyph the page asks for is one the shared sprite draws', () => {
	// `icon()` looks a name up in `media/icons.svg` of the UI module, so a name that is not there renders as an empty box —
	// no error, no console message, just a blank where the mark should be. The fold's chevron was written as `chevron-up`,
	// which the sprite does not have: the up-arrow is the same glyph turned over by the stylesheet.
	const sprite = readFileSync(join(root, '..', 'temco-ui', 'media', 'icons.svg'), 'utf8');
	const drawn = new Set([...sprite.matchAll(/id="i-([\w-]+)"/gu)].map((match) => match[1]));
	const source = readFileSync(join(root, 'src', 'sitePage.ts'), 'utf8');
	const asked = [...source.matchAll(/\b(?:icon|toneMark)\(\s*'([\w-]+)'|\bmark:\s*'([\w-]+)'/gu)].map((match) => match[1] ?? match[2]);
	assert.ok(asked.length > 0, 'the page draws no glyphs at all, so this case would pass on a rewritten page');
	assert.deepEqual(
		asked.filter((name) => !drawn.has(name)),
		[],
		'named a glyph the sprite does not draw'
	);
});

test('an act reads differently from the output around it, so a refusal is not the same grey as a build', () => {
	const html = site.html(
		facts({
			log: [
				{ text: '12:01:02  $ git restore -- public/catalog.json', tone: 'plain' },
				{ text: "12:01:02  Nothing was pulled: 551 paths here are yours, not the build's", tone: 'warn' },
				{ text: '12:01:03  Set aside 2 paths the last build wrote.', tone: 'action' }
			]
		})
	);
	assert.match(html, /site-console__line--plain">12:01:02/u, 'raw output is not drawn as raw output');
	assert.match(html, /site-console__line--warn">12:01:02  Nothing was pulled/u, 'a refusal looks like the rest of the log');
	assert.match(html, /site-console__line--action">12:01:03  Set aside/u, 'the module saying what it did looks like raw output');
	assert.equal((html.match(/site-console__line--/gu) ?? []).length, 3, 'the log is drawn without its tones');
});

test('the log is the last section, and the outcome of an act says where it is', () => {
	const html = site.html(facts({ report: { title: 'Pulled 16 commits', tone: 'ok' } }));
	const at = (needle: string): number => html.indexOf(needle);
	assert.ok(at('site-report') < at('This machine'), 'the outcome sits below the machine it is about');
	assert.ok(at('Changes in the clone') < at('Activity'), 'Activity is not the last thing on the page');
	assert.match(html, /site-report[\s\S]*?data-command="temcoLearn\.site\.showLog"/u, 'the outcome does not lead to the log it is about');
});

test('a failure is the same line, in the warning tone, and nothing at all when nothing happened', () => {
	const failed = site.html(facts({ report: { title: 'Nothing was pulled', tone: 'warn' } }));
	assert.match(failed, /class="site-report site-report--warn"/u, 'a failure is drawn like a success');
	assert.match(failed, /Nothing was pulled/u);
	assert.equal(site.html(facts()).includes('site-report'), false, 'the outcome is drawn when nothing was done');
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
console.log(`\n${cases.length - failedCount}/${cases.length} site page cases passed`);
if (failedCount > 0) {
	process.exitCode = 1;
}
