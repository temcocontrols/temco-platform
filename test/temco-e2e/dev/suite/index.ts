/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

// The test runner the application calls.
//
// `run` is the one export the extension host looks for, and it answers with the number of cases that failed — the number
// the application then exits with. Not a framework: a case is a name and something that throws.
//
// This is TypeScript because the repository keeps its sources in TypeScript; `run.mts` transpiles it to the CommonJS the
// extension host needs, in a throwaway folder, before it starts the application.

import * as fs from 'node:fs';
import * as path from 'node:path';

interface Case {
	name: string;
	run: () => Promise<void>;
}

interface Cases {
	readonly cases: readonly Case[];
}

/** Every `*.case.js` beside this runner is a list of cases; nothing is registered, the folder is the list. */
export function run(testsRoot: string, callback: (error: Error | null, failures?: number) => void): void {
	let files: string[];
	try {
		files = fs.readdirSync(testsRoot).filter(file => file.endsWith('.case.js'));
	} catch (error) {
		callback(error as Error);
		return;
	}

	(async () => {
		let failed = 0;
		let total = 0;
		for (const file of files) {
			const suite = require(path.join(testsRoot, file)) as Cases;
			for (const one of suite.cases) {
				total += 1;
				try {
					await one.run();
					console.log(`  ok    e2e · ${one.name}`);
				} catch (error) {
					failed += 1;
					console.error(`  FAIL  e2e · ${one.name}`);
					console.error(String((error as Error)?.stack ?? error));
				}
			}
		}
		console.log(`\ne2e: ${total - failed}/${total} passed`);
		callback(null, failed);
	})().catch(error => callback(error as Error));
}
