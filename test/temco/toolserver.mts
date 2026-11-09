/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

// The tool server: what it is allowed to know.
//
// The server is a separate program on this machine, started by this window, and the only input it gets besides its own
// binary is an environment. A program handed the whole environment inherits every credential the editor was started with,
// which is not a decision anybody made; so the environment is a whitelist, and the token is added per start rather than
// living somewhere a copied environment would carry it.
//
// What is *not* here: starting the server. That needs the downloaded binary, and a case that only runs on a machine which
// already has one is a case that stops being true while still passing. The parts that decide what the server may know are
// pure functions and are covered instead.

import assert from 'node:assert/strict';
import { existsSync } from 'node:fs';
import { createRequire, Module } from 'node:module';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { suite, standalone } from './harness.mts';

const here = fileURLToPath(new URL('../..', import.meta.url));
const load = createRequire(import.meta.url);
const out = (...parts: string[]): string => join(here, 'extensions', ...parts, 'out');

if (!existsSync(out('temco-ai'))) {
	throw new Error('the extensions are not compiled — run `npm run test-temco`, which compiles before it tests.');
}

/** The one thing this module asks of the platform's memory: where the database is. */
const DATABASE = 'D:/profile/temco/catalog/catalog.db';

let settings: Record<string, string | undefined> = {};

const vscode = {
	workspace: {
		getConfiguration: (section: string) => ({
			get: <T>(key: string, fallback?: T): T | undefined => {
				const value = settings[`${section}.${key}`];
				return value === undefined ? fallback : (value as T);
			},
			update: async () => undefined
		}),
		get workspaceFolders() {
			return [];
		}
	},
	env: { appRoot: 'D:/app' },
	version: '1.144.0-temco',
	extensions: {
		getExtension: (id: string) => (id === 'temcocontrols.temco-store' ? { isActive: true, exports: { databasePath: () => DATABASE } } : { isActive: true, exports: {} })
	},
	Uri: { file: (value: string) => ({ fsPath: value }), joinPath: (base: { fsPath: string }, ...parts: string[]) => ({ fsPath: join(base.fsPath, ...parts) }) },
	window: { showInformationMessage: async () => undefined, showErrorMessage: async () => undefined },
	commands: { registerCommand: () => ({ dispose: () => undefined }) },
	EventEmitter: class {
		event = () => ({ dispose: () => undefined });
		fire(): void { /* nothing listens */ }
		dispose(): void { /* nothing to release */ }
	}
};

const editorLoad = Module._load;
Module._load = function (request: string, parent: unknown, isMain: boolean): unknown {
	if (request === 'vscode') {
		return vscode;
	}
	return editorLoad.call(this, request, parent, isMain) as unknown;
};

interface BinPath {
	serverEnv(context: { globalStorageUri: { fsPath: string } }): Record<string, string>;
	platformApi(): string;
}

const binPath = load(join(out('temco-ai'), 'ai', 'binPath.js')) as BinPath;

const group = suite();
const test = (name: string, run: () => Promise<void> | void): void => group.test(name, run);

function fresh(): void {
	settings = {};
}

const profile = { globalStorageUri: { fsPath: 'D:/profile/temco/ai' } };

// ---------- what the server may know ----------

test('the server is given a whitelist of the environment, not the window\'s whole environment', () => {
	fresh();
	process.env.TEMCO_TEST_SECRET = 'do-not-pass-this-on';
	try {
		const env = binPath.serverEnv(profile);
		assert.equal(env.TEMCO_TEST_SECRET, undefined, 'a credential in the editor\'s environment is not the server\'s');
		assert.equal(env.USERNAME ?? undefined, undefined, 'nor anything else that was not named');
		for (const key of Object.keys(env)) {
			assert.ok(
				['PATH', 'HOME', 'USERPROFILE', 'SystemRoot', 'TEMP', 'TMP', 'TMPDIR', 'LANG', 'TEMCO_CATALOG_DB', 'TEMCO_MCP_STATE', 'TEMCO_PLATFORM_API'].includes(key),
				`${key} is not a key this server is meant to receive`
			);
		}
	} finally {
		delete process.env.TEMCO_TEST_SECRET;
	}
});

test('the base environment carries no token: that is generated per start, by the supervisor', () => {
	fresh();
	const env = binPath.serverEnv(profile);
	assert.equal(env.TEMCO_MCP_TOKEN, undefined, 'a token in a copied environment is a token in somebody\'s log');
	assert.equal(env.TEMCO_MCP_PORT, undefined, 'the port is chosen per start too');
});

test('the server reads its state from this profile, and records into the platform\'s own database', () => {
	fresh();
	const env = binPath.serverEnv(profile);
	assert.equal(env.TEMCO_MCP_STATE, profile.globalStorageUri.fsPath);
	assert.equal(env.TEMCO_CATALOG_DB, DATABASE, 'one catalog: a second database is a second history');
});

test('the platform address is trimmed, and empty when nobody configured one', () => {
	fresh();
	assert.equal(binPath.platformApi(), '');

	settings = { 'temcoAi.platformApi': '   https://api.example.test/v1   ' };
	assert.equal(binPath.platformApi(), 'https://api.example.test/v1');
});

// ---------- the cases ----------

await standalone(import.meta.url, group.cases, 'the environment the tool server is started with');
