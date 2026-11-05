// The questions this product asks of its own prose, as one keystroke each.
//
// A search in the Search view is gone the moment someone types the next query, so a question that gets asked every
// release was being retyped every release. A **Search Editor** is the answer VS Code already has: a real editor tab
// holding the results, re-runnable with its own ⟳, savable, and reopened with the window. What is added here is only
// the question — the query, whether it is a regular expression, and the folder it is asked of.
//
// The folder is the selected project's `docs/`, because that is where the pages are: a search that started in the whole
// window would answer about clones, build output and `node_modules` as well, which is not what any of these ask.

import * as vscode from 'vscode';
import { DocsRoot } from './registry';

export interface SearchDeps {
	/** The sets being read: their `docs/` folders are what a search starts from. */
	roots: () => readonly DocsRoot[];
}

/**
 * Opens a Search Editor with a question in it.
 *
 * Exported because a file's own "find what links here" is the same act with a different query, and two ways of opening
 * a Search Editor would drift apart.
 */
export async function openSearchEditor(query: string, filesToInclude: string, isRegexp: boolean): Promise<void> {
	await vscode.commands.executeCommand('search.action.openNewEditor', {
		query,
		filesToInclude,
		isRegexp,
		triggerSearch: true,
		// The scope is the point of the question, so it is shown rather than hidden behind the toggle.
		showIncludesExcludes: filesToInclude.length > 0,
		location: 'new',
	});
}

export function registerSearches(context: vscode.ExtensionContext, deps: SearchDeps): void {
	context.subscriptions.push(
		// Prose that was left unfinished. Regex, because the three markers are alternatives of one question.
		vscode.commands.registerCommand('temcoDocs.findUnfinished', () =>
			openSearchEditor('\\b(TODO|FIXME|TBD|XXX)\\b', scopeOf(deps), true)
		),
		// Links that are relative or root-relative: the ones a site build can break when a page moves.
		vscode.commands.registerCommand('temcoDocs.findLinks', () =>
			openSearchEditor('\\]\\((?:\\.[./]|/)[^)]*\\)', scopeOf(deps), true)
		),
		// Every version number written in the prose, so the ones left behind by a release stand out beside the right ones.
		vscode.commands.registerCommand('temcoDocs.findVersions', () =>
			openSearchEditor('\\bv?\\d+\\.\\d{2,3}(?:\\.\\d+)?\\b', scopeOf(deps), true)
		)
	);
}

/**
 * The folders a question is asked of.
 *
 * Only sets that are folders on this machine: a set read from the catalog has pages that are not files, and a search
 * cannot read those. Comma-separated because that is how VS Code's *files to include* takes more than one, and forward
 * slashes because a glob is not a Windows path.
 */
function scopeOf(deps: SearchDeps): string {
	return deps
		.roots()
		.filter((root) => root.origin !== 'catalog' && root.rootUri.scheme === 'file')
		.map((root) => `${vscode.Uri.joinPath(root.rootUri, 'docs').fsPath.replace(/\\/g, '/')}/**/*.md`)
		.join(', ');
}
