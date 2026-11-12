/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

// The rules the guide states, run as code.
//
// [getting-started.md](../docs/temco-platform/getting-started.md) tells a reader two things about where their work ends
// up: a project is a folder named after it, inside the projects folder; and a build becomes the site's project named
// after the folder it was written into, not after the page title someone may later correct. Both are one-line rules
// that were each got wrong once — a project filed under the name as typed while removal looked for the slug, a clone
// read as a project called `source` — and neither mistake produced an error, only a project that vanished and a site
// with the wrong history. They are cheap to state and therefore cheap to test.
//
// The modules under test import `vscode`, so the editor is stubbed the way `extensions/temco-learn/scripts/check-artifacts.mts`
// stubs it, and the store's own `slugOf` is loaded from its compiled `names.js` rather than imitated — a copy of the rule
// would pass a test that the real rule fails.
//
// Needs `out/`, so compile first (`npm run test-temco` does). Run from the repository root.

import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { createRequire, Module } from 'node:module';
import { homedir, tmpdir } from 'node:os';
import { basename, join, parse } from 'node:path';
import { fileURLToPath } from 'node:url';
import { suite, standalone } from './harness.mts';

const here = fileURLToPath(new URL('../..', import.meta.url));
const load = createRequire(import.meta.url);
const out = (...parts: string[]): string => join(here, 'extensions', ...parts, 'out');

if (!existsSync(out('temco-repositories')) || !existsSync(out('temco-learn')) || !existsSync(out('temco-store')) || !existsSync(out('temco-docs'))) {
	throw new Error('the extensions are not compiled — run `npm run test-temco`, which compiles before it tests.');
}

/** What the editor is told, between one case and the next. */
interface Settings {
	workspaceFolder?: string;
	projectsFolder?: string;
	siteRepo?: string;
}

let settings: Settings = {};
let workspaceFolders: { uri: { fsPath: string } }[] = [];

const storeNames = load(join(out('temco-store'), 'names.js')) as { slugOf(text: string): string };

const vscode = {
	workspace: {
		get workspaceFolders() {
			return workspaceFolders;
		},
		getConfiguration: (section: string) => ({
			get: (key: string) => ((section as string) === 'temcoRepositories' || section === 'temcoLearn' ? (settings as Record<string, string | undefined>)[key] : undefined),
			update: async () => undefined
		})
	},
	extensions: {
		getExtension: (id: string) =>
			id === 'temcocontrols.temco-store'
				? {
					isActive: true,
					exports: {
						slugOf: storeNames.slugOf,
						Catalog: { open: async () => Promise.reject(new Error('the catalog is not part of these rules')) },
						CatalogUnavailable: Error,
						selection: {}
					}
				}
				: undefined
	},
	Uri: { file: (value: string) => ({ fsPath: value }) },
	window: { showErrorMessage: async () => undefined, showInformationMessage: async () => undefined }
};

const editorLoad = Module._load;
Module._load = function (request: string, parent: unknown, isMain: boolean): unknown {
	if (request === 'vscode') {
		return vscode;
	}
	return editorLoad.call(this, request, parent, isMain) as unknown;
};

interface Place {
	workRoot(): string;
	projectsRoot(): string;
	projectFolder(project: string): string;
	cloneRoot(): string;
	cloneFolder(source: string): string;
}

interface Found {
	folder: string;
	title: string;
	id: string;
	at: number;
}

const place = load(join(out('temco-repositories'), 'workarea.js')) as Place;
const builds = load(join(out('temco-learn'), 'builds.js')) as { findBuilds(): Promise<Found[]> };
const pageAssets = load(join(out('temco-docs'), 'pageAssets.js')) as { pageRoots(pageFsPath: string): readonly string[] };
const repo = load(join(out('temco-learn'), 'siteRepo.js')) as {
	pageUrl(base: string, project?: string, version?: string, href?: string): string;
};
const facts = load(join(out('temco-learn'), 'siteFacts.js')) as {
	classifyChanges(status: string, numstat: string): { code: string; path: string; untracked: boolean; kind: string }[];
	discardOf(changes: readonly { path: string; untracked: boolean }[]): { restore: string[]; remove: string[] };
};
const site = load(join(out('temco-learn'), 'site.js')) as {
	slugOf(title: string): string;
	buildPages(root: string): Promise<{ href: string; title: string; kind?: 'md' | 'build' }[]>;
};

const group = suite();
const test = (name: string, run: () => Promise<void> | void): void => group.test(name, run);

/** A throwaway working area, and the settings that point the modules at it. */
function space(): { root: string; keep: string } {
	const root = mkdtempSync(join(tmpdir(), 'temco-rules-'));
	settings = { workspaceFolder: root, projectsFolder: root };
	workspaceFolders = [];
	return { root, keep: root };
}

function write(file: string, content = 'x'): void {
	mkdirSync(join(file, '..'), { recursive: true });
	writeFileSync(file, content);
}

const page = (title: string): string => `<html><head><title>${title}</title></head><body></body></html>`;

/** A page as a documentation project writes it: the title in front matter, where the catalog reads it. */
const markdown = (title: string, body = 'Body.'): string => `---\ntitle: "${title}"\norder: 10\n---\n\n${body}\n`;

// ---------- where a project's folder goes ----------

test('with nothing set, clones live under the home directory and projects under its projects folder', async () => {
	settings = {};
	workspaceFolders = [];
	const home = join(homedir(), 'temco');
	assert.equal(place.workRoot(), home);
	assert.equal(place.projectsRoot(), join(home, 'projects'));
	assert.equal(place.projectFolder('T3000 Platform'), join(home, 'projects', 't3000-platform'));
});

test('the working area setting is the root, and it takes ~ for the home directory', async () => {
	settings = { workspaceFolder: '~/docs' };
	assert.equal(place.workRoot(), join(homedir(), 'docs'));
	assert.equal(place.projectsRoot(), join(homedir(), 'docs', 'projects'));
});

test('a projects folder of its own moves the projects and leaves the clones where they were', async () => {
	const away = join(tmpdir(), 'temco-projects-elsewhere');
	settings = { workspaceFolder: '~/docs', projectsFolder: away };
	assert.equal(place.projectsRoot(), away);
	assert.equal(place.projectFolder('T3000 Platform'), join(away, 't3000-platform'));
	assert.equal(place.workRoot(), join(homedir(), 'docs'));
});

test('a clone lives in source, one folder per repository', async () => {
	settings = { workspaceFolder: '~/docs' };
	assert.equal(place.cloneRoot(), join(homedir(), 'docs', 'source'));
	assert.equal(place.cloneFolder('temco-html'), join(homedir(), 'docs', 'source', 'temco-html'));
});

test('the folder a project gets and the id the site gives it are the same word', async () => {
	settings = {};
	for (const name of ['T3000 Platform', 'Site & Docs', 't3000', 'Bacnet  Tools']) {
		assert.equal(basename(place.projectFolder(name)), site.slugOf(name), name);
	}
});

// ---------- which project a build belongs to ----------

test('a build is the project whose folder it was written into', async () => {
	const world = space();
	try {
		write(join(world.root, 't3000', 'dist', 'site', 'index.html'), page('T3000'));
		const [build] = await builds.findBuilds();
		assert.equal(build.id, 't3000');
		assert.equal(build.title, 'T3000');
	} finally {
		rmSync(world.keep, { recursive: true, force: true });
	}
});

test('a corrected page title does not rename the project', async () => {
	const world = space();
	try {
		write(join(world.root, 't3000', 'dist', 'site', 'index.html'), page('Trend Logs documentation'));
		const [build] = await builds.findBuilds();
		assert.equal(build.title, 'Trend Logs', 'the title is short of the word "documentation"');
		assert.equal(build.id, 't3000', 'the id stays the folder, so a rename is not a second project');
	} finally {
		rmSync(world.keep, { recursive: true, force: true });
	}
});

test('a clone is the repository it came from, never a project called source', async () => {
	const world = space();
	try {
		write(join(world.root, 'source', 'temco-html', 'dist', 'docs', 'index.html'), page('Temco HTML'));
		const [build] = await builds.findBuilds();
		assert.equal(build.id, 'temco-html');
	} finally {
		rmSync(world.keep, { recursive: true, force: true });
	}
});

test('a build outside every project folder falls back to the name it gives itself', async () => {
	const world = space();
	try {
		write(join(world.root, 'dist', 'site', 'index.html'), page('Loose Build'));
		const [build] = await builds.findBuilds();
		assert.equal(build.id, 'loose-build');
	} finally {
		rmSync(world.keep, { recursive: true, force: true });
	}
});

test('a Markdown build is a build, and names itself from its own front matter', async () => {
	const world = space();
	try {
		write(join(world.root, 't3000', 'dist', 'docs', 'index.md'), markdown('T3000 documentation'));
		write(join(world.root, 't3000', 'dist', 'docs', 'control', 'inputs.md'), markdown('Inputs'));
		const [build] = await builds.findBuilds();
		assert.equal(build.id, 't3000');
		assert.equal(build.title, 'T3000', 'the title is short of the word "documentation"');
	} finally {
		rmSync(world.keep, { recursive: true, force: true });
	}
});

test('a Markdown page is listed without its extension, so it reads like a page and not a file', async () => {
	const world = space();
	try {
		write(join(world.root, 't3000', 'dist', 'docs', 'index.md'), markdown('T3000'));
		write(join(world.root, 't3000', 'dist', 'docs', 'control', 'inputs.md'), markdown('Inputs'));
		const pages = await site.buildPages(join(world.root, 't3000', 'dist', 'docs'));
		assert.deepEqual(
			pages.map((one) => ({ href: one.href, title: one.title, kind: one.kind })),
			[
				{ href: 'index', title: 'T3000', kind: 'md' },
				{ href: 'control/inputs', title: 'Inputs', kind: 'md' }
			]
		);
	} finally {
		rmSync(world.keep, { recursive: true, force: true });
	}
});

test('a Markdown build is found by the front page a site reads a version by', async () => {
	const world = space();
	try {
		write(join(world.root, 't3000', 'dist', 'docs', '00-index.md'), markdown('T3000'));
		write(join(world.root, 't3000', 'dist', 'docs', 'control', 'inputs.md'), markdown('Inputs'));
		const [build] = await builds.findBuilds();
		assert.deepEqual({ id: build?.id, title: build?.title }, { id: 't3000', title: 'T3000' }, '`00-index.md` is a front page, not a folder of pages with none');
	} finally {
		rmSync(world.keep, { recursive: true, force: true });
	}
});

test('the generator\'s own build obeys the site\'s content rules, so a new project is publishable as it stands', () => {
	const world = space();
	try {
		const project = join(world.root, 'guide');
		write(
			join(project, 'scripts', 'docs-site.mjs'),
			readFileSync(join(here, 'extensions', 'temco-projects', 'templates', 'user-guide', 'scripts', 'docs-site.mjs.txt'), 'utf8')
		);
		write(join(project, 'package.json'), JSON.stringify({ name: 'Guide', version: '1.0', description: 'A guide to the guide.' }));
		write(
			join(project, 'docs', 'help', 'registry.json'),
			JSON.stringify({ areas: {}, pages: { overview: { title: 'Overview', order: 10 }, 'overview/start': { title: 'Getting Started', order: 20 } } })
		);
		write(join(project, 'docs', 'overview.md'), '# Overview\n\nWhere to begin.\n');
		write(join(project, 'docs', 'overview', 'start.md'), '# Getting going\n\nFirst steps.\n');
		execFileSync(process.execPath, ['scripts/docs-site.mjs'], { cwd: project, stdio: 'pipe' });

		const built = join(project, 'dist', 'docs');
		assert.deepEqual(
			readdirSync(built).filter((name) => /index\.md$/u.test(name)),
			['00-index.md'],
			'one front page, under the name the site looks for'
		);
		// The site draws a page's title from its front matter, so a body that repeats it as `#` prints the title twice.
		const prose = (file: string): string => readFileSync(join(built, file), 'utf8').replace(/^---\r?\n[\s\S]*?\r?\n---\r?\n/u, '');
		const offenders = ['00-index.md', 'overview.md', 'overview/start.md'].filter((file) => /^#\s/mu.test(prose(file)));
		assert.deepEqual(offenders, [], 'no page, the front page included, starts a heading at "#"');
		assert.match(prose('overview/start.md'), /^## Getting going$/mu, 'a heading that is not the title stays, one level down');
	} finally {
		rmSync(world.keep, { recursive: true, force: true });
	}
});

test('a folder with no index.html is not a build', async () => {
	const world = space();
	try {
		write(join(world.root, 'notes', 'dist', 'readme.md'), '# notes');
		assert.deepEqual(await builds.findBuilds(), []);
	} finally {
		rmSync(world.keep, { recursive: true, force: true });
	}
});

test('a build under a projects folder inside the working area is one build, not two', async () => {
	const world = space();
	try {
		// The projects folder is inside the working area, so a walk of the area reaches the build and a walk of the projects
		// folder reaches it again — and on Windows the two spellings of one folder can differ only in case. The Site page
		// offered one build twice, and its second Add would have imported the same version over the first.
		write(join(world.root, 'projects', 't3000', 'dist', 'docs', '00-index.md'), markdown('T3000'));
		settings = { workspaceFolder: world.root, projectsFolder: join(world.root, 'projects') };
		workspaceFolders = [];
		const found = await builds.findBuilds();
		assert.deepEqual(
			found.map((build) => build.title),
			['T3000'],
			'the same folder reached from two roots is still one build'
		);
	} finally {
		rmSync(world.keep, { recursive: true, force: true });
	}
});

// ---------- the address of a page on the site ----------
//
// The site routes on the path (`/t3000/2026.01/control/inputs`) and answers a deep address from a bundled `404.html`. The
// module used to build a fragment (`/#/t3000/1.0`), which the site stopped reading when it moved from hash routing: every
// address it opened was the site's home, so a row in the library looked like a project that was not on the site.
test('a page address is a path the site routes, never a fragment', () => {
	assert.deepEqual(
		[
			repo.pageUrl('http://localhost:1025/', 't3000', '2026.01', 'control/inputs'),
			repo.pageUrl('http://localhost:1025/', 'temco-platform', '1.0'),
			repo.pageUrl('https://temcocontrols.github.io/temco-learn/', 't3000', '2026.01', 'index'),
			repo.pageUrl('http://localhost:1025/')
		],
		[
			'http://localhost:1025/t3000/2026.01/control/inputs',
			'http://localhost:1025/temco-platform/1.0',
			'https://temcocontrols.github.io/temco-learn/t3000/2026.01/index',
			'http://localhost:1025/'
		],
		'a nested page keeps its slashes, a project keeps the mount point, and the site itself is still its own address'
	);
});

// ---------- what a discard may do, and to what ----------
//
// The Site page's "Discard" was a `git restore` over whatever the page called build output. Git refuses a path the last
// commit has never seen — and refuses the whole command, restoring none of the others — so a clone whose build had written
// `public/pdf/` could not be tidied and could not be pulled: four paths were offered, two were untracked, and nothing
// happened. Deleting is the only discard an untracked path can have, and it is also what a pull needs done before it can
// write the committed copy of a file with that name.
test('a path no commit has is removed, not restored, and a person\'s new file is neither', () => {
	const changes = facts.classifyChanges(
		[
			' M public/catalog.json',
			' M public/search.json',
			'?? public/imported/',
			'?? public/pdf/',
			'?? content/t3000/',
			'?? src/imported.ts'
		].join('\n'),
		['1\t1\tpublic/catalog.json', '1\t1\tpublic/search.json'].join('\n')
	);
	assert.deepEqual(
		changes.map((change) => ({ path: change.path, kind: change.kind, untracked: change.untracked })),
		[
			{ path: 'public/catalog.json', kind: 'generated', untracked: false },
			{ path: 'public/search.json', kind: 'generated', untracked: false },
			{ path: 'public/imported/', kind: 'generated', untracked: true },
			{ path: 'public/pdf/', kind: 'generated', untracked: true },
			{ path: 'content/t3000/', kind: 'edit', untracked: true },
			{ path: 'src/imported.ts', kind: 'edit', untracked: true }
		],
		'what the commit has, what the build wrote, and what a person added are three different things'
	);
	assert.deepEqual(
		facts.discardOf(changes.filter((change) => change.kind !== 'edit')),
		{ restore: ['public/catalog.json', 'public/search.json'], remove: ['public/imported/', 'public/pdf/'] },
		'restore is asked only of paths the commit has, and the person\'s own files are in neither list'
	);
});

// ---------- the shape of a view's title bar ----------
//
// A view title holds two kinds of entry: the `navigation` group, which the window draws as icons, and every other
// group, which it folds into the `...` menu. One command in both is two controls for one act — and it is how a button
// that was meant to be promoted out of the overflow menu stayed in it as well, which is invisible in a review diff and
// obvious in a screenshot.
test('no view title holds the same command twice, so an icon and its menu entry cannot both exist', () => {
	const doubled: string[] = [];
	for (const folder of readdirSync(join(here, 'extensions'))) {
		if (!folder.startsWith('temco-')) {
			continue;
		}
		const manifest = join(here, 'extensions', folder, 'package.json');
		if (!existsSync(manifest)) {
			continue;
		}
		const parsed = JSON.parse(readFileSync(manifest, 'utf8')) as {
			contributes?: { menus?: { 'view/title'?: { command?: string; when?: string }[] } };
		};
		const seen = new Set<string>();
		for (const item of parsed.contributes?.menus?.['view/title'] ?? []) {
			const key = `${item.when ?? ''}|${item.command ?? ''}`;
			if (seen.has(key)) {
				doubled.push(`${folder}: ${item.command} twice for "${item.when}"`);
			}
			seen.add(key);
		}
	}
	assert.deepEqual(doubled, []);
});

// ---------- what a panel may read ----------
//
// A webview refuses every file outside its `localResourceRoots`, and a page writes `../media/…` — so the page's own
// folder is never enough. The folders above it, up to the set that names the page, are what a picture needs, and this
// is the rule that decides how far up. It was wrong once: the tab showed broken images with every file sitting in
// `docs/media/` the whole time, and nothing logged a word about why.
test('a page may read its own folder and the set above it, and not the folder above that', () => {
	const world = mkdtempSync(join(tmpdir(), 'temco-roots-'));
	try {
		const set = join(world, 'docs');
		const chapter = join(set, 'control');
		const nested = join(chapter, 'inputs');
		mkdirSync(join(set, 'help'), { recursive: true });
		mkdirSync(nested, { recursive: true });
		writeFileSync(join(set, 'help', 'registry.json'), '{"version":1,"areas":{},"pages":{}}');
		writeFileSync(join(chapter, 'control.md'), '# control');
		writeFileSync(join(nested, 'x.md'), '# x');

		assert.deepEqual(pageAssets.pageRoots(join(chapter, 'control.md')), [chapter, set], 'the page and its set');
		assert.deepEqual(
			pageAssets.pageRoots(join(nested, 'x.md')),
			[nested, chapter, set],
			'a chapter deeper in reaches its own folder, its parents, and stops at the set'
		);

		// A page in no set still gets a few ancestors — `../media` from a loose file — and never the drive it sits on.
		const loose = join(world, 'notes');
		mkdirSync(loose, { recursive: true });
		const roots = pageAssets.pageRoots(join(loose, 'readme.md'));
		assert.equal(roots[0], loose, 'the page\'s own folder is always first');
		assert.ok(roots.length >= 2 && roots.length <= 6, `a loose page reached ${roots.length} folders`);
		assert.ok(!roots.includes(parse(world).root), 'a loose page must never be handed the drive root');
	} finally {
		rmSync(world, { recursive: true, force: true });
	}
});

await standalone(import.meta.url, group.cases, 'where a folder goes, which project a build belongs to, what a page may read, and a title bar without twins');
