// What the Explorer's context menu offers on a file of this platform.
//
// The Explorer is where a clone gets right-clicked anyway, so it is the cheapest place to start an act that belongs to
// the memory rather than to the file: read the source a file is in again, select that source in the Repositories panel,
// or ask which pages link to a page. Nothing here invents an act — each one hands off to the command that already owns
// it, so the two ways in cannot drift apart.
//
// The entries are conditional in the manifest, not here: *Read This Source* and *Show the Source in the Panel* appear
// on any file, and say so plainly when the file turns out to be in no source at all. Working that out on every context
// menu would mean opening the catalog before the menu opens, which is a price a right-click should not pay.

import * as path from 'node:path';
import * as vscode from 'vscode';
import { openSearchEditor } from './searches';
import { Catalog, SourceDetail } from './store';

export function registerFileActions(context: vscode.ExtensionContext): void {
	context.subscriptions.push(
		vscode.commands.registerCommand('temcoDocs.readSourceOfFile', (uri?: unknown) => readSourceOf(context, uri)),
		vscode.commands.registerCommand('temcoDocs.revealSourceOfFile', (uri?: unknown) => revealSourceOf(context, uri)),
		vscode.commands.registerCommand('temcoDocs.findReferencesToFile', (uri?: unknown) => findReferences(uri))
	);
}

/** Read the source a file belongs to again — the same act the Repositories panel's own row offers. */
async function readSourceOf(context: vscode.ExtensionContext, uri: unknown): Promise<void> {
	const found = await sourceOf(context, uri);
	if (found === undefined) {
		return explain();
	}
	await vscode.commands.executeCommand('temcoRepositories.readSource', found.slug);
}

/** Select that source's row in the Repositories panel. */
async function revealSourceOf(context: vscode.ExtensionContext, uri: unknown): Promise<void> {
	const found = await sourceOf(context, uri);
	if (found === undefined) {
		return explain();
	}
	await vscode.commands.executeCommand('temcoRepositories.revealInTree', found.slug);
}

/**
 * Which pages link to this one.
 *
 * A link to a page is the page's file name written in another page, so the question is a plain text search — no
 * expression, nothing to escape — over the markdown of the window. It opens as a Search Editor because the answer is
 * worth keeping beside the page while the link is fixed.
 */
async function findReferences(uri: unknown): Promise<void> {
	if (!(uri instanceof vscode.Uri) || !uri.path.toLowerCase().endsWith('.md')) {
		void vscode.window.showInformationMessage('Temco Docs: pick a page to find the links to it.');
		return;
	}
	await openSearchEditor(path.posix.basename(uri.path), '**/*.md', false);
}

/** The source a file sits inside, by its folder — the memory's own paths, not a guess from the tree. */
async function sourceOf(
	context: vscode.ExtensionContext,
	uri: unknown
): Promise<{ slug: string; source: SourceDetail } | undefined> {
	if (!(uri instanceof vscode.Uri) || uri.scheme !== 'file') {
		return undefined;
	}
	const file = path.resolve(uri.fsPath).toLowerCase();
	let catalog: Catalog | undefined;
	try {
		catalog = await Catalog.open(context);
		for (const row of catalog.sources()) {
			const source = catalog.source(row.slug);
			if (source?.path === undefined) {
				continue;
			}
			const base = path.resolve(source.path).toLowerCase();
			if (file === base || file.startsWith(`${base}${path.sep}`)) {
				// The row carries the slug the other module's commands take; the detail carries the folder compared above.
				return { slug: row.slug, source };
			}
		}
		return undefined;
	} catch {
		return undefined;
	} finally {
		catalog?.close();
	}
}

function explain(): void {
	void vscode.window.showInformationMessage(
		'Temco: this file is not inside a source the platform knows — add the folder, or clone the repository first.'
	);
}
