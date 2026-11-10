/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

// What a new project starts as: the starter's tree, and what an import reads without being asked.
//
// The guide promises a project made from a starter is *finished* rather than merely started — it can index its own page
// and build its own site — and that nothing in the starter overwrites a file that is already there. Both are only true
// of the files actually written, so this writes one into a throwaway folder and reads what landed there: the two
// generators present and no longer named `.txt`, the name and version filled in, and a second write refused by name.
//
// The import's default ticks are here for the opposite reason: a wrong list is invisible until someone's draft has read
// ninety pages, or none.

import assert from 'node:assert/strict';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { createRequire, Module } from 'node:module';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
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

/** The other modules' exports, present and idle: this suite calls the starter writer, not the catalog. */
const otherModule = new Proxy(
	{},
	{
		get: (_target, key) => {
			if (key === 'then') {
				return undefined;
			}
			return async () => undefined;
		}
	}
) as Record<string, unknown>;

/**
 * The store's own outputs list, as its extension publishes it.
 *
 * `projectFlow` reads it when it loads — the create form's ticks are the store's list, not a copy — so the fake store
 * hands over the compiled module rather than a list of its own.
 */
const outputsModule = load(join(out('temco-store'), 'catalog', 'outputs.js')) as Record<string, unknown>;
const storeExports = {
	outputs: {
		all: outputsModule.PROJECT_OUTPUTS,
		defaults: outputsModule.DEFAULT_OUTPUTS,
		byValue: outputsModule.outputByValue,
		byKind: outputsModule.outputByKind,
		chosen: outputsModule.chosenOutputs,
		scriptFor: outputsModule.scriptFor
	},
	slugOf: (text: string) => text.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '')
};

const vscode = {
	Uri: {
		file: uriOf,
		joinPath: (base: FakeUri, ...parts: string[]) => uriOf(join(base.fsPath, ...parts))
	},
	FileType: { File: 1, Directory: 2 },
	workspace: {
		getConfiguration: () => ({ get: () => undefined, update: async () => undefined }),
		fs: {
			readFile: async (uri: FakeUri) => readFileSync(uri.fsPath),
			writeFile: async (uri: FakeUri, bytes: Uint8Array) => {
				mkdirSync(dirname(uri.fsPath), { recursive: true });
				writeFileSync(uri.fsPath, bytes);
			},
			createDirectory: async (uri: FakeUri) => {
				mkdirSync(uri.fsPath, { recursive: true });
			},
			stat: async (uri: FakeUri) => {
				if (!existsSync(uri.fsPath)) {
					throw new Error(`${uri.fsPath} is not there`);
				}
				return { size: statSync(uri.fsPath).size, type: statSync(uri.fsPath).isDirectory() ? 2 : 1 };
			},
			readDirectory: async (uri: FakeUri) => {
				const { readdirSync } = await import('node:fs');
				return readdirSync(uri.fsPath, { withFileTypes: true }).map(entry => [entry.name, entry.isDirectory() ? 2 : 1]);
			}
		}
	},
	extensions: {
		getExtension: (id: string) =>
			id === 'temcocontrols.temco-store'
				? { isActive: true, exports: storeExports }
				: id.startsWith('temcocontrols.')
					? { isActive: true, exports: otherModule }
					: undefined
	},
	window: {
		showErrorMessage: async () => undefined,
		showWarningMessage: async () => undefined,
		showInformationMessage: async () => undefined,
		createOutputChannel: () => ({ appendLine: () => undefined, show: () => undefined, dispose: () => undefined })
	},
	commands: { registerCommand: () => ({ dispose: () => undefined }) },
	tasks: { executeTask: async () => undefined }
};

const editorLoad = Module._load;
Module._load = function (request: string, parent: unknown, isMain: boolean): unknown {
	if (request === 'vscode') {
		return vscode;
	}
	return editorLoad.call(this, request, parent, isMain) as unknown;
};

interface Flow {
	writeTemplate(extensionUri: FakeUri, folder: FakeUri, name: string, version: string, template: string): Promise<string | undefined>;
	defaultTick(file: string): boolean;
}

const flow = load(join(out('temco-projects'), 'projectFlow.js')) as Flow;

/** The extension's own folder, which is where the starter assets live. */
const extensionUri = uriOf(join(here, 'extensions', 'temco-projects'));

const group = suite();
const test = (name: string, run: () => Promise<void> | void): void => group.test(name, run);

/** A throwaway folder, and the making and removing of it. */
async function withFolder(run: (folder: FakeUri) => Promise<void>): Promise<void> {
	const root = mkdtempSync(join(tmpdir(), 'temco-template-'));
	try {
		await run(uriOf(join(root, 't3000-platform')));
	} finally {
		rmSync(root, { recursive: true, force: true });
	}
}

const written = (folder: FakeUri, relative: string): string => readFileSync(join(folder.fsPath, ...relative.split('/')), 'utf8');
const there = (folder: FakeUri, relative: string): boolean => existsSync(join(folder.fsPath, ...relative.split('/')));

// ---------- the starter ----------

test('a starter writes a project that can index and build itself', async () => {
	await withFolder(async folder => {
		assert.equal(await flow.writeTemplate(extensionUri, folder, 'T3000 Platform', '1.0', 'user-guide'), undefined);

		for (const file of [
			'package.json',
			'docs/help/registry.json',
			'docs/overview/index.md',
			'docs/overview/getting-started.md'
		]) {
			assert.ok(there(folder, file), file);
		}
		assert.ok(there(folder, 'scripts/docs-registry.mjs'), 'the generator that turns a new page into a page');
		assert.ok(there(folder, 'scripts/docs-site.mjs'), 'the site build the Build Center invokes');
		assert.equal(there(folder, 'scripts/docs-registry.mjs.txt'), false, 'the .txt is the repository\'s hygiene rule, not the project\'s');
	});
});

test('the starter fills in the name and the version it was given', async () => {
	await withFolder(async folder => {
		await flow.writeTemplate(extensionUri, folder, 'T3000 Platform', '2.5', 'user-guide');
		const packageJson = written(folder, 'package.json');
		assert.match(packageJson, /T3000 Platform/u);
		assert.match(packageJson, /2\.5/u);
		assert.doesNotMatch(packageJson, /\{\{name\}\}|\{\{version\}\}/u, 'no placeholder reaches a project');
	});
});

test('a starter never overwrites: the second write is refused by the file it would have replaced', async () => {
	await withFolder(async folder => {
		await flow.writeTemplate(extensionUri, folder, 'T3000 Platform', '1.0', 'user-guide');
		const before = written(folder, 'docs/overview/index.md');

		const refused = await flow.writeTemplate(extensionUri, folder, 'Another Name', '9.9', 'user-guide');
		assert.ok(refused !== undefined);
		assert.match(refused, /already exists, so nothing was written/u);
		assert.equal(written(folder, 'docs/overview/index.md'), before, 'not one byte changed');
	});
});

test('a starter this build does not know is refused by name, before anything is written', async () => {
	await withFolder(async folder => {
		const refused = await flow.writeTemplate(extensionUri, folder, 'T3000', '1.0', 'some-template-from-the-internet');
		assert.ok(refused !== undefined);
		assert.match(refused, /is not a starter this build knows/u);
		assert.equal(existsSync(folder.fsPath), false, 'no folder is made for a starter that does not exist');
	});
});

// ---------- what an import reads without being asked ----------

test('an import starts with the registry and the overview ticked, and nothing else', () => {
	assert.equal(flow.defaultTick('docs/help/registry.json'), true);
	assert.equal(flow.defaultTick('docs/help/overview.md'), true);

	for (const file of [
		'docs/help/features/trendlogs.md',
		'docs/overview/index.md',
		'README.md',
		'src/Program.cs',
		'docs/help/registry.json.bak'
	]) {
		assert.equal(flow.defaultTick(file), false, file);
	}
});

// ---------- the cases ----------

await standalone(import.meta.url, group.cases, 'the starter tree a new project begins with');
