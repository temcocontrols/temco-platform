// The Site page's add section: the one act that turns a build folder into a version on the website.
//
// The panel stopped listing "builds not on the site" because adding is a *site* operation — it writes into the site
// repository, like clone, build and publish do. This gate holds the page to that: every build on disk the site does not
// serve is a row with the reason it waits and one `Add…` button, the section says what adding does and does not do, and a
// page opened *for* the section puts it first.

import assert from 'node:assert/strict';
import { createRequire, Module } from 'node:module';
import { fileURLToPath } from 'node:url';

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
	hero: (options: { title: string; desc?: string }) => `<div class="az-wash"><h1>${esc(options.title)}</h1></div>`,
	optionCards: () => '',
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
