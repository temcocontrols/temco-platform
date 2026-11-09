/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

// Publishing: the order of the four commands, and the promise that the fifth is never one of them.
//
// A publish is the one thing this application does that reaches another machine, and everything it can get wrong is in
// the sequence: commit before staging and the commit is empty; push before committing and the site is a version behind;
// force the push and somebody else's work is gone. None of that is visible in the source at a glance, and none of it can
// be seen by reading the site afterwards — a wrong publish still looks like a publish.
//
// So git is replaced by a recorder. The commands are real strings in the real order, produced by the real module, and
// the assertions are about that sequence: what ran, in what order, and what never may.
//
// `publish.ts` is the one module here that needs no editor stub — it knows about lines, not about `vscode` — so only
// `./git` is intercepted, and only for that file.

import assert from 'node:assert/strict';
import { existsSync } from 'node:fs';
import { createRequire, Module } from 'node:module';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { suite, standalone } from './harness.mts';

const here = fileURLToPath(new URL('../..', import.meta.url));
const load = createRequire(import.meta.url);
const publishFile = join(here, 'extensions', 'temco-learn', 'out', 'publish.js');

if (!existsSync(publishFile)) {
	throw new Error('the extensions are not compiled — run `npm run test-temco`, which compiles before it tests.');
}

interface Call {
	dir: string;
	args: string[];
}

/** What git answers in this scene: a key of `args[0]` plus a detail, and the sentence failure speaks. */
interface Scene {
	clone: boolean;
	origin: string | undefined;
	changed: string;
	head: string;
}

let scene: Scene = { clone: true, origin: 'https://github.com/temcocontrols/temco-learn.git', changed: 'M content/a.json\n?? public/pdf/x.pdf', head: 'abc1234' };
let calls: Call[] = [];

const fakeGit = async (dir: string, args: readonly string[]): Promise<string> => {
	calls.push({ dir, args: [...args] });
	const command = args.join(' ');

	if (command === 'rev-parse --git-dir') {
		if (!scene.clone) {
			throw new Error('fatal: not a git repository (or any of the parent directories): .git');
		}
		return '.git\n';
	}
	if (command === 'rev-parse --show-toplevel') {
		return dir + '\n';
	}
	if (command === 'remote get-url origin') {
		if (scene.origin === undefined) {
			throw new Error('error: No such remote \'origin\'');
		}
		return scene.origin + '\n';
	}
	if (command === 'status --porcelain') {
		return scene.changed;
	}
	if (command.startsWith('rev-parse --short HEAD')) {
		return scene.head + '\n';
	}
	return '';
};

const editorLoad = Module._load;
Module._load = function (request: string, parent: unknown, isMain: boolean): unknown {
	const from = (parent as { filename?: string } | undefined)?.filename;
	if (request === './git' && typeof from === 'string' && from.endsWith(join('out', 'publish.js'))) {
		return { git: fakeGit };
	}
	return editorLoad.call(this, request, parent, isMain) as unknown;
};

interface Published {
	base: string;
	commit: string;
	files: number;
	unchanged: boolean;
}

interface PublishModule {
	publishingTarget(root: string): Promise<{ root: string; owner: string; repo: string; base: string } | undefined>;
	ensureRepo(root: string): Promise<{ root: string; owner: string; repo: string; base: string }>;
	publishSite(root: string, output: { appendLine(line: string): void }, message?: string): Promise<Published>;
}

const publish = load(publishFile) as PublishModule;

const group = suite();
const test = (name: string, run: () => Promise<void> | void): void => group.test(name, run);

/** Each case starts from a healthy clone and an empty record. */
function fresh(over: Partial<Scene> = {}): void {
	scene = { clone: true, origin: 'https://github.com/temcocontrols/temco-learn.git', changed: 'M content/a.json', head: 'abc1234', ...over };
	calls = [];
}

const quiet = { appendLine: () => undefined };

/** The commands, in the order git was asked, without the directory they ran in. */
const ran = (): string[] => calls.map(call => call.args.join(' '));

// ---------- the order ----------

test('a publish stages, commits, then pushes — in that order', async () => {
	fresh();
	const said = await publish.publishSite('SITE', quiet);

	const order = ran();
	// By the git subcommand, not by the first word: a commit is `-c user.name=… -c user.email=… commit -m …`.
	const at = (command: string): number => calls.findIndex(call => call.args.includes(command));
	assert.ok(at('status') >= 0, 'a publish asks what changed before it stages anything');
	assert.ok(at('add') > at('status'), 'staging follows the question');
	assert.ok(at('commit') > at('add'), 'the commit follows staging, or it commits nothing');
	assert.ok(at('push') > at('commit'), 'the push follows the commit, or the site is a version behind');
	assert.equal(said.commit, 'abc1234');
	assert.equal(said.files, 1);
	assert.equal(said.unchanged, false);
});

test('the push is never forced', async () => {
	fresh();
	await publish.publishSite('SITE', quiet);
	for (const command of ran()) {
		assert.doesNotMatch(command, /--force|\+HEAD|--mirror/iu, `a publish must never rewrite a branch: ${command}`);
	}
	assert.ok(
		ran().some(command => command.startsWith('push origin HEAD:main')),
		'a plain fast-forward push at the branch Pages builds from'
	);
});

test('nothing changed: no empty commit is made, and the earlier one is what was pushed', async () => {
	fresh({ changed: '' });
	const said = await publish.publishSite('SITE', quiet);

	assert.equal(ran().some(command => command.startsWith('add')), false, 'nothing to stage');
	assert.equal(ran().some(command => command.startsWith('commit')), false, 'an empty commit is noise in the site\'s history');
	assert.ok(ran().some(command => command.startsWith('push')), 'the push still happens: it may carry an earlier commit');
	assert.deepEqual({ unchanged: said.unchanged, files: said.files }, { unchanged: true, files: 0 });
});

test('a folder that is not a clone is refused before anything is committed', async () => {
	fresh({ clone: false });
	await assert.rejects(() => publish.publishSite('SITE', quiet), /is not a git clone/u);
	assert.equal(ran().some(command => command.startsWith('add') || command.startsWith('commit')), false);
});

test('a clone with no GitHub origin is refused, because there is nowhere to publish to', async () => {
	fresh({ origin: 'https://gitlab.com/someone/site.git' });
	await assert.rejects(() => publish.publishSite('SITE', quiet), /nowhere to publish to/u);
	assert.equal(ran().some(command => command.startsWith('push')), false);
});

// ---------- the address a reader is sent to ----------

test('the site address is the repository\'s Pages address', async () => {
	fresh();
	assert.equal((await publish.publishingTarget('SITE'))?.base, 'https://temcocontrols.github.io/temco-learn/');

	fresh({ origin: 'git@github.com:temcocontrols/temcocontrols.github.io.git' });
	assert.equal(
		(await publish.publishingTarget('SITE'))?.base,
		'https://temcocontrols.github.io/',
		'an owner site is served from the domain root, not a folder'
	);
});

// ---------- what the commit says ----------

test('the default message names the date, because the site holds several projects and their versions differ', async () => {
	fresh();
	await publish.publishSite('SITE', quiet);
	const commit = calls.find(call => call.args.includes('commit'));
	assert.ok(commit !== undefined);
	const message = commit.args[commit.args.indexOf('-m') + 1];
	assert.match(message, /^docs: publish the site \(\d{4}-\d{2}-\d{2}\)$/u);
});

test('a caller that knows what it changed gets its own words in the commit', async () => {
	fresh();
	await publish.publishSite('SITE', quiet, '  docs: add the trend log page  ');
	const commit = calls.find(call => call.args.includes('commit'));
	assert.ok(commit !== undefined);
	assert.equal(commit.args[commit.args.indexOf('-m') + 1], 'docs: add the trend log page');
});

// ---------- the cases ----------

await standalone(import.meta.url, group.cases, 'the site publish, with git replaced by a recorder');
