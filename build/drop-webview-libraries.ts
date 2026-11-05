/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

// Prepares the modules this fork ships for packaging: drops the libraries only a webview uses, then refuses to hand a
// module over while it still carries more files under `node_modules` than the packaging walk can open.
//
// Why this exists on top of `npm prune --omit=dev`: prune removes what the *manifest* calls a development dependency,
// which is only true once the fix is in the commit being built. Commits up to and including the one `v1.144.0` first
// pointed at declare `@fluentui/react-icons` and friends as dependencies, so prune keeps them, and the packaging walk
// then opens 57,335 files per module until the process runs out of handles:
//
//     [09:34:34] 'vscode-win32-x64-min' errored after 59 s
//     Error: EMFILE: too many open files, open '...\@fluentui\react-icons\lib-cjs\atoms\headless-svg\...'
//
// Nothing outside `webview/**` imports them, and `scripts/build-webview.mts` bundles with esbuild (`bundle: true`,
// `format: 'iife'`, no `external`), so the code that needs them is already inlined into `out/webview/` by now. What the
// extension host does need stays: `temco-editor` requires `marked` and `turndown`.
//
// Run from the repository root; `--dry-run` prints what it would drop and still performs the file counts.

import { existsSync } from 'node:fs';
import { readdir, rm } from 'node:fs/promises';
import { join } from 'node:path';

/** The modules that package a webview bundle and nothing else from `node_modules`. */
const WEBVIEW_OWNER: readonly string[] = ['temco-editor', 'temco-workbench'];

/** Trees under those modules that only the bundled webview code imports. */
const WEBVIEW_ONLY: readonly string[] = ['@fluentui', '@tiptap', '@radix-ui'];
const WEBVIEW_ONLY_PREFIX = 'prosemirror-';

/**
 * The packaging walk keeps a handle per file it has not finished with, and the process dies some time after 65 000 of
 * them on every platform. A module that reaches this many files is one whose dependencies the package does not ship.
 */
const FILE_CEILING = 20000;

const extensionsDir = join(process.cwd(), 'extensions');
const dryRun = process.argv.includes('--dry-run');

async function countFiles(dir: string): Promise<number> {
	let total = 0;
	for (const entry of await readdir(dir, { withFileTypes: true })) {
		if (entry.isDirectory()) {
			total += await countFiles(join(dir, entry.name));
		} else if (entry.isFile()) {
			total++;
		}
	}
	return total;
}

async function dropWebviewLibraries(module: string): Promise<void> {
	const nodeModules = join(extensionsDir, module, 'node_modules');
	if (!existsSync(nodeModules)) {
		return;
	}

	for (const entry of await readdir(nodeModules, { withFileTypes: true })) {
		const isWebviewOnly = WEBVIEW_ONLY.includes(entry.name) || entry.name.startsWith(WEBVIEW_ONLY_PREFIX);
		if (!entry.isDirectory() || !isWebviewOnly) {
			continue;
		}

		const path = join(nodeModules, entry.name);
		const files = await countFiles(path);
		console.log(`${module}: ${dryRun ? 'would drop' : 'dropping'} ${entry.name} (${files} files)`);
		if (!dryRun) {
			await rm(path, { recursive: true, force: true });
		}
	}
}

async function main(): Promise<void> {
	const modules = (await readdir(extensionsDir, { withFileTypes: true }))
		.filter(entry => entry.isDirectory() && entry.name.startsWith('temco-'))
		.map(entry => entry.name);

	for (const module of WEBVIEW_OWNER) {
		if (modules.includes(module)) {
			await dropWebviewLibraries(module);
		}
	}

	const tooLarge: string[] = [];
	for (const module of modules) {
		const nodeModules = join(extensionsDir, module, 'node_modules');
		const files = existsSync(nodeModules) ? await countFiles(nodeModules) : 0;
		console.log(`${module}: ${files} files in node_modules`);
		if (files > FILE_CEILING) {
			tooLarge.push(`${module} (${files})`);
		}
	}

	if (tooLarge.length > 0) {
		throw new Error(`${tooLarge.join(', ')}: more than ${FILE_CEILING} files under node_modules. The packaging walk `
			+ `opens every one of them and the process runs out of file handles. Either the commit this build checked out `
			+ `still declares webview libraries as dependencies — the tag has to point at a commit where they are `
			+ `devDependencies — or that module gained a dependency the package genuinely ships, in which case FILE_CEILING `
			+ `is the number to raise.`);
	}
}

await main();
