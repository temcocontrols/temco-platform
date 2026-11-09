/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

// The whole harness: a case is a name and something that throws.
//
// These suites do not need a framework. A case either threw or it did not, and the only reporting that matters is the
// case that failed and what it said. What *is* worth sharing is the shape, so a new suite is a file that calls `test()`
// and ends by handing its cases to `standalone()` — and nothing else has to be learned to read it.

import { basename, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

export interface Case {
	name: string;
	run: () => Promise<void>;
}

export interface Suite {
	readonly cases: Case[];
	test(name: string, run: () => Promise<void> | void): void;
}

/** A file's worth of cases. Each suite owns its own list; nothing is shared between files. */
export function suite(): Suite {
	const cases: Case[] = [];
	return {
		cases,
		test(name, run) {
			cases.push({ name, run: async () => run() });
		}
	};
}

/** Run one suite, printing what passed and what did not. Returns the number of failures. */
export async function run(name: string, cases: readonly Case[]): Promise<number> {
	let failed = 0;
	for (const one of cases) {
		try {
			await one.run();
			console.log(`  ok    ${name} · ${one.name}`);
		} catch (error) {
			failed += 1;
			console.error(`  FAIL  ${name} · ${one.name}`);
			console.error(indent(error instanceof Error ? (error.stack ?? error.message) : String(error)));
		}
	}
	const tally = `${cases.length - failed}/${cases.length} passed`;
	console.log(failed === 0 ? `  ${name}: ${tally}` : `  ${name}: ${tally} — ${failed} failed`);
	return failed;
}

/**
 * Run these cases and exit, but only when this file *is* the program.
 *
 * Every suite stubs the editor, and two stubs cannot both be the one that answers `require('vscode')`. So the runner
 * starts one process per suite and a suite is a program of its own: `node --experimental-strip-types test/temco/store.mts`
 * runs exactly the store, which is also what makes a single failing case easy to work on.
 */
export async function standalone(url: string, cases: readonly Case[], note?: string): Promise<void> {
	if (process.argv[1] === undefined || fileURLToPath(url) !== resolve(process.argv[1])) {
		return;
	}
	const name = basename(fileURLToPath(url), '.mts');
	console.log(note === undefined ? name : `${name}: ${note}`);
	const failed = await run(name, cases);
	process.exit(failed === 0 ? 0 : 1);
}

function indent(text: string): string {
	return text
		.split('\n')
		.map(line => `        ${line}`)
		.join('\n');
}
