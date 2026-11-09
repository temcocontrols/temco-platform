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
import { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { createRequire, Module } from 'node:module';
import { homedir, tmpdir } from 'node:os';
import { basename, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { suite, standalone } from './harness.mts';

const here = fileURLToPath(new URL('../..', import.meta.url));
const load = createRequire(import.meta.url);
const out = (...parts: string[]): string => join(here, 'extensions', ...parts, 'out');

if (!existsSync(out('temco-repositories')) || !existsSync(out('temco-learn')) || !existsSync(out('temco-store'))) {
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
const site = load(join(out('temco-learn'), 'site.js')) as { slugOf(title: string): string };

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

// ---------- where a project's folder goes ----------

test('with nothing set, work and projects share a visible folder in the home directory', async () => {
	settings = {};
	workspaceFolders = [];
	const home = join(homedir(), 'temco');
	assert.equal(place.workRoot(), home);
	assert.equal(place.projectsRoot(), home);
	assert.equal(place.projectFolder('T3000 Platform'), join(home, 't3000-platform'));
});

test('the working area setting is the root, and it takes ~ for the home directory', async () => {
	settings = { workspaceFolder: '~/docs' };
	assert.equal(place.workRoot(), join(homedir(), 'docs'));
	assert.equal(place.projectsRoot(), join(homedir(), 'docs'));
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

test('a folder with no index.html is not a build', async () => {
	const world = space();
	try {
		write(join(world.root, 'notes', 'dist', 'readme.md'), '# notes');
		assert.deepEqual(await builds.findBuilds(), []);
	} finally {
		rmSync(world.keep, { recursive: true, force: true });
	}
});

await standalone(import.meta.url, group.cases, 'where a folder goes, and which project a build belongs to');
