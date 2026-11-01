// The Publishing page's own contract: one card per subject, links instead of mono strings, and a path list that folds.
//
// Two things this page has to get right. Every section title carries the 2px brand bar the rest of the application draws,
// and every fact a person might want to follow is a **link**: the address opens the live site, the commit and each changed
// path open on GitHub. The path list shows five and folds the rest into a native `<details>`, so a publish that touches
// forty files does not turn the page into a file dump.

import assert from 'node:assert/strict';
import { createRequire, Module } from 'node:module';
import { fileURLToPath } from 'node:url';

interface PageModule {
	PAGE_STYLE: string;
	html(state: unknown): string;
}

const esc = (text: string) =>
	String(text).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

const ui = {
	pageColumn: () => -1,
	page: (body: string) => body,
	escapeHtml: esc,
	icon: (name: string) => `[${name}]`,
	toneMark: (name: string) => `[${name}]`,
	hero: (options: { title: string }) => `<div class="az-wash"><h1>${esc(options.title)}</h1></div>`,
	optionCards: () => '',
	cards: (items: readonly { title: string }[]) => `<div class="az-cards">${items.map((item) => `<div>${esc(item.title)}</div>`).join('')}</div>`,
	callout: (options: { title: string }) => `<aside class="az-callout"><p>${esc(options.title)}</p></aside>`,
	section: (options: { title: string; desc?: string; actions?: string }) =>
		`<div class="az-section"><h2 class="az-section__title">${esc(options.title)}</h2>${options.desc === undefined ? '' : `<p>${esc(options.desc)}</p>`}${
			options.actions === undefined ? '' : options.actions
		}</div>`,
	entryRow: () => '',
	code: (options: { lines: readonly { text: string }[] }) => `<pre>${options.lines.map((line) => esc(line.text)).join('\n')}</pre>`,
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

const publishing = createRequire(import.meta.url)(fileURLToPath(new URL('../out/publishPage.js', import.meta.url))) as PageModule;

const changes = Array.from({ length: 12 }, (_unused, index) => ({ code: 'A', path: `public/imported/t3000/13.0/page-${index}.html` }));

const facts = (overrides: Record<string, unknown> = {}) => ({
	where: 'temcocontrols/temco-learn',
	base: 'https://temcocontrols.github.io/docs/',
	commit: '6f2c1ab',
	at: new Date(Date.now() - 12 * 60e3).toISOString(),
	branch: 'main',
	ahead: 0,
	pending: 3,
	changes,
	log: [],
	logAt: undefined,
	...overrides
});

const cases: { name: string; run: () => void }[] = [];
const test = (name: string, run: () => void): void => {
	cases.push({ name, run });
};

test('every section title carries the brand bar the other pages draw', () => {
	assert.match(publishing.PAGE_STYLE, /\.az-section__title \{ position: relative; padding-left: 10px; \}/u);
	assert.match(publishing.PAGE_STYLE, /\.az-section__title::before \{[^}]*width: 2px/u);
	assert.match(publishing.PAGE_STYLE, /\.az-section__title::before \{[^}]*height: 12px/u);
	assert.match(publishing.PAGE_STYLE, /\.az-section__title::before \{[^}]*background: var\(--az-blue/u);
});

test('the page is five parts, in the order a person reads them', () => {
	assert.deepEqual(
		[...publishing.html(facts()).matchAll(/az-section__title">([^<]*)</gu)].map((match) => match[1]),
		['The repository', 'What publishing does', 'Where it goes', 'The last attempt']
	);
});

test('the repository is one card: the remote, the branch, the commit — the first two as links', () => {
	const html = publishing.html(facts());
	assert.match(html, /<div class="pub-head">/u, 'the repository facts are not one line in one card');
	const links = [...html.matchAll(/data-command="temcoLearn\.site\.remote"(?: data-args="([^"]*)")?/gu)].map((match) => match[1] ?? '');
	assert.ok(links.includes(''), 'the remote itself is not a link');
	assert.ok(
		links.some((args) => args.includes('commit/6f2c1ab')),
		'the commit is not a link to the commit'
	);
	assert.doesNotMatch(html, /az-facts/u, 'the four-cell facts band is still there');
});

test('five paths are shown, and the rest fold into a native details', () => {
	const html = publishing.html(facts());
	const fold = html.indexOf('<details');
	const beforeFold = fold === -1 ? html : html.slice(0, fold);
	assert.equal((beforeFold.match(/class="pub-path"/gu) ?? []).length, 5, 'the open list does not hold five paths');
	assert.match(html, /<details class="pub-more"><summary>Show 7 more paths<\/summary>/u, 'the rest do not fold');
	assert.equal((html.match(/class="pub-path"/gu) ?? []).length, 12, 'the folded paths are missing');
	// Each path opens on GitHub, at the branch the site is served from.
	assert.match(html, /data-args="\{&quot;path&quot;:&quot;blob\/main\/public\/imported\/t3000\/13\.0\/page-0\.html&quot;\}"/u);
	assert.match(html, /12 paths in this commit/u);
});

test('a commit with five paths or fewer has nothing to fold', () => {
	const html = publishing.html(facts({ changes: changes.slice(0, 5) }));
	assert.doesNotMatch(html, /<details/u, 'an empty fold is drawn');
	assert.match(html, /5 paths in this commit/u);
});

test('where it goes is a card, and the address is the link', () => {
	const html = publishing.html(facts());
	assert.match(html, /<button type="button" class="az-btn az-btn--link pub-address" data-command="temcoLearn\.openPublished">https:\/\/temcocontrols\.github\.io\/docs\/<\/button>/u);
	assert.match(html, /Served from/u);
	assert.match(html, /built by GitHub Actions, handed to Pages/u);
	assert.match(html, /3 changes/u, 'what is waiting is not stated');
	assert.doesNotMatch(html, /az-fact__/u, 'the old facts cells are still drawn');
});

test('with no clone at all, the address says so instead of linking nowhere', () => {
	const html = publishing.html(facts({ where: undefined, base: undefined, commit: undefined, at: undefined, branch: undefined, pending: 0, changes: [] }));
	assert.match(html, /<span class="pub-address pub-address--none">none yet<\/span>/u);
	assert.match(html, /The clone matches the last publish/u);
	assert.doesNotMatch(html, /pub-path|pub-more/u, 'an empty publish still draws a path list');
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
console.log(`\n${cases.length - failedCount}/${cases.length} publishing page cases passed`);
if (failedCount > 0) {
	process.exitCode = 1;
}
