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
import { existsSync } from 'node:fs';
import { createRequire, Module } from 'node:module';
import { homedir } from 'node:os';
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
						selection: {}
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

const build = load(join(out('temco-projects'), 'projectBuild.js')) as Build;
const flow = load(join(out('temco-projects'), 'projectFlow.js')) as Flow;

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
		['build:help:dry'],
		'two outputs that begin with the same script run it once'
	);
});

test('a ticked output the repository has no script for is reported by name, never invented', () => {
	assert.deepEqual(build.scriptsFor(['pdf'], undefined, { 'docs:site': 'x' }), [], 'nothing is run that is not declared');
	assert.deepEqual(
		build.namesFor(['pdf'], undefined),
		['build:help:dry', 'docs:pdf'],
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

// ---------- the cases ----------

await standalone(import.meta.url, group.cases, 'the create form\'s folder rules, and the scripts a build runs');
