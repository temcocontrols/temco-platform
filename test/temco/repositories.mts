/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

// Reading a repository: where the token comes from, and what a remote address means.
//
// A clone is the one thing this platform reaches out for, and both halves of it can fail quietly. A token read from the
// wrong place is a request that 404s on a private repository and looks like a missing repository; a remote address
// parsed loosely is a request to the wrong owner. Neither says anything useful when it goes wrong, so both rules are
// pinned here: the stored token first and trimmed, the `gh` CLI only as a fallback and never as a failure, and a
// GitHub address understood in all four shapes it is written in.
//
// `gh` is replaced by a recorder, so no case depends on a CLI being installed.

import assert from 'node:assert/strict';
import { existsSync } from 'node:fs';
import { createRequire, Module } from 'node:module';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { suite, standalone } from './harness.mts';

const here = fileURLToPath(new URL('../..', import.meta.url));
const load = createRequire(import.meta.url);
const out = (...parts: string[]): string => join(here, 'extensions', ...parts, 'out');

if (!existsSync(out('temco-repositories'))) {
	throw new Error('the extensions are not compiled — run `npm run test-temco`, which compiles before it tests.');
}

/** What the `gh` CLI answers in this scene. */
let cli: { answer?: string; fails: boolean } = { answer: 'gho_fromTheCli\n', fails: false };
let cliAsked = 0;

/** The `gh` binary, replaced: `execFile` with the callback the module uses. */
const fakeExecFile = (_file: string, _args: string[], _options: unknown, callback: (error: Error | null, stdout: string, stderr: string) => void): void => {
	cliAsked += 1;
	if (cli.fails) {
		callback(new Error('spawn gh ENOENT'), '', '');
		return;
	}
	callback(null, cli.answer ?? '', '');
};

const secrets = new Map<string, string>();

/** The other modules' exports, present and idle: `read.ts` reads the store at load time and calls it never here. */
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

const vscode = {
	window: { showInputBox: async () => undefined, showInformationMessage: async () => undefined, showErrorMessage: async () => undefined },
	workspace: {
		getConfiguration: () => ({ get: () => undefined, update: async () => undefined }),
		fs: { stat: async () => ({}) }
	},
	extensions: { getExtension: (id: string) => (id.startsWith('temcocontrols.') ? { isActive: true, exports: otherModule } : undefined) },
	Uri: { file: (value: string) => ({ fsPath: value }), joinPath: (base: { fsPath: string }, ...parts: string[]) => ({ fsPath: join(base.fsPath, ...parts) }) }
};

const editorLoad = Module._load;
Module._load = function (request: string, parent: unknown, isMain: boolean): unknown {
	if (request === 'vscode') {
		return vscode;
	}
	const from = (parent as { filename?: string } | undefined)?.filename;
	if (request === 'child_process' && typeof from === 'string' && from.endsWith(join('out', 'read.js'))) {
		return { execFile: fakeExecFile };
	}
	return editorLoad.call(this, request, parent, isMain) as unknown;
};

interface ReadModule {
	tokenOf(context: { secrets: { get(key: string): Promise<string | undefined> } }): Promise<string | undefined>;
	coordinatesOf(remoteUrl: string): { owner: string; repo: string } | undefined;
}

const read = load(join(out('temco-repositories'), 'read.js')) as ReadModule;

/** A profile whose secret storage holds whatever the case put there. */
const profile = { secrets: { get: async (key: string) => secrets.get(key) } };

const group = suite();
const test = (name: string, run: () => Promise<void> | void): void => group.test(name, run);

function fresh(held?: string): void {
	secrets.clear();
	if (held !== undefined) {
		secrets.set('temcoRepositories.githubToken', held);
	}
	cli = { answer: 'gho_fromTheCli\n', fails: false };
	cliAsked = 0;
}

// ---------- the token ----------

test('a stored token is used, trimmed, and the CLI is not asked at all', async () => {
	fresh('  github_pat_abc123  ');
	assert.equal(await read.tokenOf(profile), 'github_pat_abc123');
	assert.equal(cliAsked, 0, 'the editor\'s own secret storage is the first answer, and the only one when it has one');
});

test('with nothing stored, the token the gh CLI already holds is used', async () => {
	fresh();
	assert.equal(await read.tokenOf(profile), 'gho_fromTheCli');
	assert.equal(cliAsked, 1);
});

test('a blank entry in secret storage is not a token: the CLI is asked instead', async () => {
	fresh('   ');
	assert.equal(await read.tokenOf(profile), 'gho_fromTheCli');
	assert.equal(cliAsked, 1);
});

test('no CLI, or a CLI that answers nothing, is "no token" rather than a failure', async () => {
	fresh();
	cli = { fails: true };
	assert.equal(await read.tokenOf(profile), undefined, 'reading a folder needs no token, so this cannot throw');

	cli = { answer: '   \n', fails: false };
	assert.equal(await read.tokenOf(profile), undefined);
});

// ---------- the address ----------

test('a GitHub address is understood in every shape it is written in', () => {
	const expected = { owner: 'temcocontrols', repo: 'temco-learn' };
	for (const url of [
		'https://github.com/temcocontrols/temco-learn',
		'https://github.com/temcocontrols/temco-learn.git',
		'git@github.com:temcocontrols/temco-learn.git',
		'https://github.com/temcocontrols/temco-learn/'
	]) {
		assert.deepEqual(read.coordinatesOf(url), expected, url);
	}
});

test('an address that is not a GitHub repository is refused, not guessed at', () => {
	for (const url of ['https://gitlab.com/someone/site.git', 'D:/work/temco-docs', '', 'https://github.com/onlyowner']) {
		assert.equal(read.coordinatesOf(url), undefined, url);
	}
});

// ---------- the cases ----------

await standalone(import.meta.url, group.cases, 'the token a clone uses, and the address it reads');
