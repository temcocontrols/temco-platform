/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

// Switching project is one act, and the pages have to follow it.
//
// A project row sets the application's selection and then brings the documentation module forward. The page trees are
// drawn from that selection — so if the module does not rebuild them when the selection changes, the window shows the
// *previous* project's pages beside the new project's name, and nothing reports it: both halves look plausible on their
// own. That is exactly what happened, once, and this is the case that would have caught it.
//
// It is an API-level case rather than a driven UI: two projects are written to a throwaway folder, recorded in the
// catalog the way the create form records them, and then the selection is moved between them. What is asserted is the
// model the trees are drawn from — the documentation module's own published sets — which is the thing that was stale.
//
// Everything happens in a temporary folder and a throwaway profile; nothing of the person's is read or written.

import * as assert from 'node:assert/strict';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import * as vscode from 'vscode';

interface Case {
	name: string;
	run: () => Promise<void>;
}

export const cases: Case[] = [];

const settle = (ms: number): Promise<void> => new Promise<void>(resolve => setTimeout(resolve, ms));

/** The documentation module's published model — the copy of `extensions/temco-docs/src/api.ts`. */
interface DocsApi {
	roots(): readonly { folder?: { uri?: { fsPath?: string } }; rootUri?: { fsPath?: string } }[];
	totals(roots: readonly unknown[]): { pages: number };
	refresh(): Promise<void>;
}

/** The store's own API — the copy of `extensions/temco-store/src/api.ts`. */
interface StoreApi {
	catalog(): Promise<CatalogLike>;
}

interface CatalogLike {
	addSource(source: { kind: 'folder'; name: string; slug: string; path: string }): number;
	createDocument(document: { name: string; slug: string; origin?: string }): number;
	setDocumentSources(document: string, sources: readonly string[]): void;
	close(): void;
}

/** Waits for a condition the window reaches on its own, and names it when it never does. */
async function waitFor(what: string, ready: () => boolean, ms = 8000): Promise<void> {
	const started = Date.now();
	while (Date.now() - started < ms) {
		if (ready()) {
			return;
		}
		await settle(100);
	}
	throw new Error(`${what} within ${ms} ms`);
}

/** A registry with `pages` pages in one area: the smallest thing `temco-docs` reads as a set. */
function registry(area: string, title: string, pages: readonly string[]): string {
	const entries = pages.map((slug, index) => [
		`${area}/${slug}`,
		{ title: `${title} page ${index + 1}`, area, chapter: '(root)', order: (index + 1) * 10, ship: true }
	]);
	return JSON.stringify({ version: 1, areas: { [area]: { title } }, pages: Object.fromEntries(entries) }, null, 2);
}

/** One project on disk: the registry, and a Markdown file for every page it declares. */
function writeProject(root: string, name: string, area: string, pages: readonly string[]): string {
	const folder = path.join(root, name);
	fs.mkdirSync(path.join(folder, 'docs', 'help'), { recursive: true });
	fs.mkdirSync(path.join(folder, 'docs', area), { recursive: true });
	fs.writeFileSync(path.join(folder, 'docs', 'help', 'registry.json'), registry(area, name, pages));
	for (const slug of pages) {
		fs.writeFileSync(path.join(folder, 'docs', area, `${slug}.md`), `# ${name} ${slug}\n`);
	}
	return folder;
}

cases.push({
	name: 'a project is recorded and read the way the create form records one',
	run: async () => {
		const root = fs.mkdtempSync(path.join(os.tmpdir(), 'temco-e2e-switch-'));
		const alpha = writeProject(root, 'alpha', 'alpha', ['one']);
		const beta = writeProject(root, 'beta', 'beta', ['one', 'two']);

		const store = vscode.extensions.getExtension<StoreApi>('temcocontrols.temco-store');
		assert.ok(store !== undefined, 'the store module is not installed');
		const catalog = await store!.exports.catalog();
		try {
			for (const [name, folder] of [['alpha', alpha], ['beta', beta]] as const) {
				catalog.addSource({ kind: 'folder', name, slug: name, path: folder });
				catalog.createDocument({ name, slug: name, origin: 'folder' });
				catalog.setDocumentSources(name, [name]);
			}
		} finally {
			catalog.close();
		}

		const docs = vscode.extensions.getExtension<DocsApi>('temcocontrols.temco-docs');
		assert.ok(docs !== undefined, 'the documentation module is not installed');
		const api = docs!.exports;

		// The selection moves the way a clicked project row moves it: the projects module's own command.
		await vscode.commands.executeCommand('temcoProjects.selectProject', 'alpha');
		await waitFor('alpha is the project whose one page is being read', () => api.totals(api.roots()).pages === 1);

		await vscode.commands.executeCommand('temcoProjects.selectProject', 'beta');
		await waitFor(
			'switching to beta replaced alpha\'s pages with beta\'s two',
			() => api.totals(api.roots()).pages === 2
		);

		// The set itself has to be the new project's folder, not the old one's: a count that happens to match could
		// come from reading the wrong folder twice.
		const folders = api.roots().map(root => (root.rootUri ?? root.folder?.uri)?.fsPath ?? '').join(' ');
		assert.ok(
			folders.includes('beta') && !folders.includes('alpha'),
			`the sets being read are still ${folders || '(none)'} — the tree did not follow the selection`
		);
	}
});
