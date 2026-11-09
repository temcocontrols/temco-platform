/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

// Starting the built application so the cases in `suite/` can run inside its extension host.
//
//   npm run test-temco-e2e
//
// This is the only suite that needs a build and a window: `npm run compile` (or `npm run compile-temco`) must have run,
// because what starts is `out/`, and the temco modules are loaded as this build's built-in extensions. It opens a real
// window, uses a throwaway profile so nothing of the person's is touched, and closes it again.
//
// The exit code is the number of cases the extension host reported as failed, which is how the application's own test
// entry point answers.

import { spawn } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = fileURLToPath(new URL('../..', import.meta.url));
const executor = join(here, '.build', 'electron');
const load = createRequire(import.meta.url);

if (!existsSync(join(here, 'out', 'main.js'))) {
	console.error('no out/main.js — run `npm run compile` (or `npm run gulp compile`) before the end-to-end cases.');
	process.exit(1);
}

/** The application this build produced, whatever the product calls it. */
const app = existsSync(executor)
	? readdirSync(executor).find(file => file.toLowerCase().endsWith('.exe') || file === 'code' || file === 'electron')
	: undefined;

if (app === undefined) {
	console.error(`no application in ${executor} — run \`npm run download-builtin-extensions\` or \`npm run compile\` first.`);
	process.exit(1);
}

const profile = mkdtempSync(join(tmpdir(), 'temco-e2e-profile-'));
const extensions = join(profile, 'extensions');

/**
 * The two paths the editor insists on before it runs a test runner at all (`extHostExtensionService`): a development
 * extension, and a test location inside it.
 *
 * The extension is *built* here rather than committed as JavaScript, because this repository keeps its sources in
 * TypeScript. `suite/*.ts` is transpiled into the profile as CommonJS — the module system the extension host's `require`
 * expects — and the manifest is copied beside it. Nothing is written into the repository.
 */
const development = join(profile, 'dev');

function buildSuite(): void {
	let typescript: typeof import('typescript');
	try {
		typescript = load('typescript') as typeof import('typescript');
	} catch {
		console.error('no typescript in node_modules — run `npm run install-fast` before the end-to-end cases.');
		process.exit(1);
	}

	const source = join(here, 'test', 'temco-e2e', 'dev');
	mkdirSync(join(development, 'suite'), { recursive: true });
	writeFileSync(join(development, 'package.json'), readFileSync(join(source, 'package.json'), 'utf8'));

	for (const file of readdirSync(join(source, 'suite'))) {
		const text = readFileSync(join(source, 'suite', file), 'utf8');
		const transpiled = typescript.transpileModule(text, {
			compilerOptions: {
				module: typescript.ModuleKind.CommonJS,
				target: typescript.ScriptTarget.ES2022,
				esModuleInterop: true
			},
			fileName: file
		});
		writeFileSync(join(development, 'suite', file.replace(/\.ts$/, '.js')), transpiled.outputText);
	}
}

buildSuite();

const suite = join(development, 'suite');

console.log(`end-to-end: ${app}, profile ${profile}`);

const args = [
	here,
	`--extensionDevelopmentPath=${development}`,
	`--extensionTestsPath=${suite}`,
	`--user-data-dir=${profile}`,
	`--extensions-dir=${extensions}`,
	'--disable-extensions',
	'--disable-workspace-trust',
	'--disable-updates',
	'--use-inmemory-secretstorage',
	'--no-cached-data',
	'--skip-welcome',
	'--skip-release-notes',
	'--crash-reporter-directory=' + join(profile, 'crash')
];

const child = spawn(join(executor, app), args, {
	cwd: here,
	env: {
		...process.env,
		// The three `scripts/code.bat` sets before it launches, which is what makes this a development window: without
		// them the build is treated as a packaged application and the workbench loads its own assets as if they were
		// modules from disk.
		NODE_ENV: 'development',
		VSCODE_DEV: '1',
		VSCODE_CLI: '1',
		VSCODE_SKIP_PRELAUNCH: '1',
		TEMCO_REPO: here,
		ELECTRON_ENABLE_LOGGING: '1'
	},
	stdio: ['ignore', 'pipe', 'pipe']
});

/**
 * The window's own output is streamed *and* kept.
 *
 * The command answers to the cases, not to the application's teardown: a window that reports "11/11 passed" and then
 * exits non-zero while shutting down (a busy port it was told to inspect, a renderer closing late) has not failed any
 * test. So the tally is read from the runner's own last line, and the application's exit code is reported beside it
 * rather than trusted as the verdict.
 */
let said = '';
const keep = (chunk: Buffer): void => {
	said += chunk.toString();
};

child.stdout?.on('data', (chunk: Buffer) => {
	keep(chunk);
	process.stdout.write(chunk);
});
child.stderr?.on('data', (chunk: Buffer) => {
	keep(chunk);
	process.stderr.write(chunk);
});

/** A hung window must not hang the command: the cases are a handful of questions, not a soak test. */
const LIMIT_MS = Number(process.env['TEMCO_E2E_TIMEOUT_MS'] ?? 180_000);
const timer = setTimeout(() => {
	console.error(`\nthe window did not finish within ${String(LIMIT_MS / 1000)}s; stopping it.`);
	child.kill();
}, LIMIT_MS);

/**
 * The profile is thrown away unless somebody asked for it: its logs are the only record of a window that said nothing.
 *
 * Best effort on purpose. Windows keeps the app's files locked for a moment after it exits, so a delete can fail with
 * `EPERM` — and a tidy-up that decides the exit code would turn a green run into a red one for a reason that has nothing
 * to do with the cases.
 */
const tidy = (): void => {
	if (process.env['TEMCO_E2E_KEEP'] === '1') {
		console.log(`profile kept at ${profile}`);
		return;
	}
	try {
		rmSync(profile, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 });
	} catch {
		console.log(`profile could not be removed yet: ${profile}`);
	}
};

child.on('exit', code => {
	clearTimeout(timer);
	tidy();

	const tally = /e2e: (\d+)\/(\d+) passed/u.exec(said);

	if (tally === null) {
		console.error(`\nend-to-end: the window closed without reporting (exit code ${String(code)}) — its logs say why.`);
		process.exit(1);
	}

	const passed = Number(tally[1]);
	const total = Number(tally[2]);

	if (passed !== total) {
		console.error(`\nend-to-end: ${String(total - passed)} of ${String(total)} case(s) failed`);
		process.exit(1);
	}

	if (code !== 0) {
		console.log(`\nend-to-end: passed — every case, though the application exited with ${String(code)} while closing.`);
	} else {
		console.log('\nend-to-end: passed');
	}
	process.exit(0);
});

child.on('error', error => {
	clearTimeout(timer);
	tidy();
	console.error(`could not start the application: ${error.message}`);
	process.exit(1);
});
