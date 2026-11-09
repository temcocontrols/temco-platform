/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

// Every Temco test, in one run.
//
//   npm run test-temco                 all of them
//   npm run check-temco-docs           the docs suite alone — no compile, so it also runs in `npm run check-temco`
//   node --experimental-strip-types test/temco/index.mts store projects
//
// Each suite is a file beside this one, and each one runs in **its own process**: a suite stubs `vscode`, and a second
// stub cannot be the one that answers `require('vscode')`, so sharing a process would mean the last suite loaded decides
// what the others see. One process per file is the only arrangement where a suite's result depends on its own stubs.
//
// Nothing is registered here: the folder is the list, so a new suite is a new file and no other edit.

import { spawnSync } from 'node:child_process';
import { readdirSync } from 'node:fs';
import { basename, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = fileURLToPath(new URL('.', import.meta.url));

/** The files that are not suites: the harness, and this runner. */
const NOT_A_SUITE = new Set(['harness.mts', 'index.mts']);

const suites = readdirSync(here)
	.filter(file => file.endsWith('.mts') && !NOT_A_SUITE.has(file))
	.map(file => basename(file, '.mts'))
	.sort();

const asked = process.argv.slice(2);
const unknown = asked.filter(name => !suites.includes(name));
if (unknown.length > 0) {
	console.error(`no such suite: ${unknown.join(', ')}. Try one of: ${suites.join(', ')}.`);
	process.exit(1);
}

const chosen = asked.length === 0 ? suites : asked;

const failed: string[] = [];
for (const name of chosen) {
	const child = spawnSync(process.execPath, ['--experimental-strip-types', join(here, `${name}.mts`)], {
		cwd: join(here, '..', '..'),
		stdio: 'inherit'
	});
	if (child.status !== 0) {
		failed.push(name);
	}
}

if (failed.length === 0) {
	console.log(`\n${chosen.length}/${chosen.length} suite(s) passed: ${chosen.join(', ')}`);
	process.exit(0);
}

console.error(`\n${failed.length} of ${chosen.length} suite(s) failed: ${failed.join(', ')}`);
process.exit(1);
