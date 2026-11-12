/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

// Creating and building a project: the two places a project can go, and the scripts its ticks become.
//
// The guide says a template writes its tree into a folder of the project's own, while a folder project *is* the folder a
// person names; and that each ticked output becomes the repository's own build script, run once. Both were got wrong:
// a template wrote into `~/temco/<Name As Typed>` while removal looked for the slug, so the folder was invisible to the
// thing that deletes it; and a mapping that guessed a script name reports nothing at all rather than the missing name.
//
// The rules are exported from the module so this can call them directly rather than through a form; nothing else about
// the module changes.

import assert from 'node:assert/strict';
import { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { createRequire, Module } from 'node:module';
import { homedir, tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { suite, standalone } from './harness.mts';

const here = fileURLToPath(new URL('../..', import.meta.url));
const load = createRequire(import.meta.url);
const out = (...parts: string[]): string => join(here, 'extensions', ...parts, 'out');

if (!existsSync(out('temco-projects'))) {
	throw new Error('the extensions are not compiled — run `npm run test-temco`, which compiles before it tests.');
}

interface FakeUri {
	fsPath: string;
}

const uriOf = (fsPath: string): FakeUri => ({ fsPath });

/** What the editor is told; `settings` is what a person's configuration would say. */
let settings: Record<string, string | undefined> = {};

/** The store's own outputs list, as the fake store publishes it — the compiled module, never a copy of it. */
const outputsModule = load(join(out('temco-store'), 'catalog', 'outputs.js')) as Record<string, unknown>;
const outputs = {
	all: outputsModule.PROJECT_OUTPUTS,
	defaults: outputsModule.DEFAULT_OUTPUTS,
	byValue: outputsModule.outputByValue,
	byKind: outputsModule.outputByKind,
	chosen: outputsModule.chosenOutputs,
	scriptFor: outputsModule.scriptFor
};

/**
 * A stand-in for the other modules' exports.
 *
 * `projectFlow` reads the store, the repositories and the UI module at load time — each of them refuses to work without
 * the others, which is the point of the rule that modules never import each other's source. The rules in this file call
 * none of them, so the modules are present and idle: anything asked of them answers `undefined`, and `offeredScripts`
 * answers an empty list so a read of it at load time does not throw.
 */
const otherModule = new Proxy(
	{},
	{
		get: (_target, key) => {
			if (key === 'offeredScripts') {
				return [];
			}
			if (key === 'selection') {
				return {};
			}
			if (key === 'CatalogUnavailable') {
				return Error;
			}
			if (key === 'then') {
				return undefined;
			}
			return async () => undefined;
		}
	}
) as Record<string, unknown>;

const vscode = {
	Uri: { file: uriOf, joinPath: (base: FakeUri, ...parts: string[]) => uriOf(join(base.fsPath, ...parts)) },
	workspace: {
		workspaceFolders: [],
		getConfiguration: () => ({
			get: (key: string) => settings[key],
			update: async () => undefined
		}),
		fs: { stat: async () => ({}), createDirectory: async () => undefined, writeFile: async () => undefined }
	},
	extensions: {
		getExtension: (id: string) => {
			if (id === 'temcocontrols.temco-store') {
				return {
					isActive: true,
					exports: {
						slugOf: (text: string) => text.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, ''),
						Catalog: { open: async () => Promise.reject(new Error('the catalog is not part of these rules')) },
						CatalogUnavailable: Error,
						selection: {},
						// The store's own list, read from the compiled module: a fake that answered its own list would
						// test a copy of the rules rather than the rules the application runs.
						outputs
					}
				};
			}
			return id.startsWith('temcocontrols.') ? { isActive: true, exports: otherModule } : undefined;
		}
	},
	window: {
		showErrorMessage: async () => undefined,
		showWarningMessage: async () => undefined,
		showInformationMessage: async () => undefined,
		createOutputChannel: () => ({ appendLine: () => undefined, show: () => undefined, dispose: () => undefined })
	},
	commands: { registerCommand: () => ({ dispose: () => undefined }) },
	tasks: { executeTask: async () => undefined },
	EventEmitter: class {
		event = () => ({ dispose: () => undefined });
		fire(): void { /* nothing listens in these cases */ }
		dispose(): void { /* nothing to release */ }
	},
	StatusBarAlignment: { Left: 1, Right: 2 }
};

const editorLoad = Module._load;
Module._load = function (request: string, parent: unknown, isMain: boolean): unknown {
	if (request === 'vscode') {
		return vscode;
	}
	return editorLoad.call(this, request, parent, isMain) as unknown;
};

interface Build {
	scriptsFor(outputs: readonly string[], engine: string | undefined, scripts: Record<string, string>): readonly string[];
	namesFor(outputs: readonly string[], engine: string | undefined): readonly string[];
}

interface Flow {
	defaultFolder(): string;
	resolveFolder(text: string, name: string, under: boolean): FakeUri;
}

interface Versions {
	versionName(text: string): { ok: boolean; value?: string; changed?: boolean; why?: string };
	versionAddress(slug: string, version: string): string;
}

const build = load(join(out('temco-projects'), 'projectBuild.js')) as Build;
const flow = load(join(out('temco-projects'), 'projectFlow.js')) as Flow;
const versions = load(join(out('temco-projects'), 'versionName.js')) as Versions;

interface Scan {
	findProjects(root: string, slugOf: (text: string) => string): readonly {
		folder: string;
		slug: string;
		name: string;
		version?: string;
	}[];
	PROJECT_MARKER: string;
}

const scan = load(join(out('temco-projects'), 'projectScan.js')) as Scan;
const storeNames = load(join(out('temco-store'), 'names.js')) as { slugOf(text: string): string };

const group = suite();
const test = (name: string, run: () => Promise<void> | void): void => group.test(name, run);

// ---------- what a ticked output becomes ----------

test('each ticked output runs one of the repository\'s own scripts, and the same script only once', () => {
	const both = { 'docs:site': 'x', 'docs:build': 'y' };
	assert.deepEqual(
		build.scriptsFor(['website', 'site'], 'docfx', both),
		['docs:site'],
		'two ticks that want the same script run it once'
	);
	assert.deepEqual(
		build.scriptsFor(['website'], 'docfx', { 'docs:build': 'y' }),
		['docs:build'],
		'the next candidate is used when the first is not declared'
	);
	assert.deepEqual(
		build.scriptsFor(['pdf', 'chm'], 'docfx', { 'build:help:dry': 'a', 'docs:pdf': 'b' }),
		['docs:pdf', 'build:help:dry'],
		'a PDF does not run the help build: a CHM is not a PDF, and running it would record nothing'
	);
});

test('a ticked output the repository has no script for is reported by name, never invented', () => {
	assert.deepEqual(build.scriptsFor(['pdf'], undefined, { 'docs:site': 'x' }), [], 'nothing is run that is not declared');
	assert.deepEqual(
		build.namesFor(['pdf'], undefined),
		['docs:pdf', 'build:pdf'],
		'the message names what the repository is missing'
	);
});

test('the deploying form of the help build is never among the scripts a build runs', () => {
	const every = { 'build:help:dry': 'a', 'docs:site': 'b', 'docs:build': 'c', 'docs:pdf': 'd' };
	for (const output of ['chm', 'help', 'site', 'website', 'html', 'pdf']) {
		for (const script of build.scriptsFor([output], 'docfx', every)) {
			assert.doesNotMatch(script, /publish|deploy|ship/iu, `${output} must not deploy`);
		}
	}
});

// ---------- where the folder goes ----------

test('a template gets a folder of the project\'s own, inside the one the field names', () => {
	settings = { projectsFolder: 'D:/work/projects' };
	assert.equal(flow.resolveFolder('', 'T3000 Platform', true).fsPath, join('D:/work/projects', 't3000-platform'));
	assert.equal(
		flow.resolveFolder('D:/work/elsewhere', 'T3000 Platform', true).fsPath,
		join('D:/work/elsewhere', 't3000-platform')
	);
});

test('a folder project is the folder it names, not a folder made inside it', () => {
	settings = { projectsFolder: 'D:/work/projects' };
	assert.equal(flow.resolveFolder('D:/docs/t3000', 'T3000 Platform', false).fsPath, 'D:/docs/t3000');
});

test('with no projects folder the default is the working area, and with neither it is ~/temco', () => {
	settings = { projectsFolder: 'D:/work/projects' };
	assert.equal(flow.defaultFolder(), 'D:/work/projects');

	settings = { workspaceFolder: 'D:/work' };
	assert.equal(flow.defaultFolder(), 'D:/work', 'a project and a clone sat side by side before the setting existed');

	settings = {};
	assert.equal(flow.defaultFolder(), '~/temco');
});

test('~ in a path field is the home folder', () => {
	assert.equal(flow.resolveFolder('~/docs', 'T3000', false).fsPath, join(homedir(), 'docs'));
	assert.equal(flow.resolveFolder('~', 'T3000', false).fsPath, homedir());
});

// ---------- what a project's version may be called ----------

test('a version is a folder and an address, so the rules that name it live in one place', () => {
	const said = [
		'1.0',
		'17.4',
		'1.0.4',
		'v1.0',
		' V2.3 ',
		'01.0',
		'2026.01',
		'2026.1',
		'2026.13',
		'1',
		'1.0 beta',
		'a/b',
		'1.2.3.4',
		'',
		'x'.repeat(30)
	].map((typed) => [typed, versions.versionName(typed)]);
	assert.deepEqual(said, [
		['1.0', { ok: true, value: '1.0', changed: false }],
		['17.4', { ok: true, value: '17.4', changed: false }],
		['1.0.4', { ok: true, value: '1.0.4', changed: false }],
		// A `v` is how a version is said, never how it is named: the folder would be `v1.0`.
		['v1.0', { ok: true, value: '1.0', changed: true }],
		[' V2.3 ', { ok: true, value: '2.3', changed: true }],
		// `01.0` and `1.0` would be two folders for one version.
		['01.0', { ok: true, value: '1.0', changed: true }],
		['2026.01', { ok: true, value: '2026.01', changed: false }],
		// A dated version pads its month, because the site compares `2026.1` and `2026.01` as the same version.
		['2026.1', { ok: true, value: '2026.01', changed: true }],
		['2026.13', { ok: false, why: 'A dated version is 2026.01 to 2026.12, not 2026.13.' }],
		['1', { ok: false, why: 'A version is at least major.minor: 1.0, not 1.' }],
		['1.0 beta', { ok: false, why: 'A version becomes a folder name, so digits and dots only: 1.0, 17.4, or 2026.01.' }],
		['a/b', { ok: false, why: 'A version becomes a folder name, so digits and dots only: 1.0, 17.4, or 2026.01.' }],
		['1.2.3.4', { ok: false, why: 'A version has at most three parts: 1.0.4, not 1.2.3.4.' }],
		['', { ok: false, why: 'A version is needed: 1.0, 17.4, or 2026.01.' }],
		['x'.repeat(30), { ok: false, why: 'A version is at most 20 characters.' }]
	]);
});

test('the address a version gives a project is the one the form shows while it is typed', () => {
	assert.equal(versions.versionAddress('t3000-platform', '1.0'), '/t3000-platform/1.0/');
	assert.equal(versions.versionAddress('t3000', '2026.01'), '/t3000/2026.01/');
});

// ---------- what counts as a project on disk ----------

test('a folder is a project when it carries the registry, and the scan names it the way the create form would', () => {
	// A real folder tree, because the rule is about what is on disk: the catalog is a list of rows, and this is the
	// only thing that says which rows *should* exist.
	const root = mkdtempSync(join(tmpdir(), 'temco-scan-'));
	writeFileSync(join(root, 'not-a-project.txt'), 'a file in the projects folder is not a project');
	mkdirSync(join(root, 'empty-folder'), { recursive: true });
	mkdirSync(join(root, 'docs-only', 'docs'), { recursive: true });
	mkdirSync(join(root, '.hidden', 'docs', 'help'), { recursive: true });
	writeFileSync(join(root, '.hidden', 'docs', 'help', 'registry.json'), '{}');

	// One with a manifest: the manifest names it and versions it.
	mkdirSync(join(root, 'proj-a', 'docs', 'help'), { recursive: true });
	writeFileSync(join(root, 'proj-a', 'docs', 'help', 'registry.json'), '{}');
	writeFileSync(join(root, 'proj-a', 'package.json'), JSON.stringify({ name: 'T3000', version: '2026.01' }));

	// One without: the folder's own name is the name, and the version is left to the form's default.
	mkdirSync(join(root, 'tstat8', 'docs', 'help'), { recursive: true });
	writeFileSync(join(root, 'tstat8', 'docs', 'help', 'registry.json'), '{}');

	// One whose manifest is not JSON: still a project, still named by its folder.
	mkdirSync(join(root, 'broken-manifest', 'docs', 'help'), { recursive: true });
	writeFileSync(join(root, 'broken-manifest', 'docs', 'help', 'registry.json'), '{}');
	writeFileSync(join(root, 'broken-manifest', 'package.json'), '{ not json');

	try {
		const found = scan.findProjects(root, storeNames.slugOf);
		assert.deepEqual(
			found.map((project) => ({ slug: project.slug, name: project.name, version: project.version })),
			[
				{ slug: 'broken-manifest', name: 'broken-manifest', version: undefined },
				{ slug: 't3000', name: 'T3000', version: '2026.01' },
				{ slug: 'tstat8', name: 'tstat8', version: undefined }
			],
			'the marker decides, the manifest only names'
		);
	} finally {
		rmSync(root, { recursive: true, force: true });
	}
});

test('a projects folder that is not there yet is a first run, not a failure', () => {
	assert.deepEqual(scan.findProjects(join(tmpdir(), 'temco-scan-does-not-exist'), storeNames.slugOf), []);
});

// ---------- the cases ----------

await standalone(import.meta.url, group.cases, 'the version\'s name, the create form\'s folder rules, and the scripts a build runs');
