// Bringing a page back.
//
// A webview panel is not a document. The window reopens documents by itself — a markdown page comes back because its
// editor is a custom editor — but a panel is only restored when its module answers for its type, through a
// `WebviewPanelSerializer`. Nothing in this platform registered one, so every page of ours (the overview, a project,
// the Build Center, a tool) vanished on restart while the page beside it came back.
//
// Two pieces, decided once here:
//
//   * `remember` — the subject a page was opened on (a project, a repository, a forum topic, a tool page). It is kept
//     per view type in the window's own state, so a tab that comes back opens on what it was showing rather than on a
//     default.
//   * `restore` — one serializer per view type, which hands the panel the window restored to the module's own `open`.
//     **Adoption is the point**: the module draws into the panel it is given instead of creating a second one, so the
//     tab keeps its place in the group and the reader gets their layout back rather than a copy of it.
//
// A module that wants its pages back calls `remember` where it opens a page, and `restore` once in `activate`. The
// manifest needs `onWebviewPanel:<viewType>` for each of them, or the module is not running yet when the window asks.

import * as vscode from 'vscode';

/** One page of a module, as the window needs it back. */
export interface RestorablePage {
	/** The view type the panel was created with — the id the window restores by. */
	viewType: string;
	/**
	 * Opens the page, drawing into `panel` when the window handed one back.
	 *
	 * `arg` is whatever `remember` was given, or `undefined` when nothing was remembered.
	 */
	open(panel?: vscode.WebviewPanel, arg?: string): void;
}

const KEY = 'temcoUi.restore.';

/** The subject this view type was last opened on, or `undefined`. */
export function remembered(context: vscode.ExtensionContext, viewType: string): string | undefined {
	const value = context.workspaceState.get<string>(KEY + viewType);
	return value !== undefined && value.length > 0 ? value : undefined;
}

/** Records the subject a page is being opened on. Called by the module beside its own `open`. */
export function remember(context: vscode.ExtensionContext, viewType: string, arg?: string): void {
	void context.workspaceState.update(KEY + viewType, arg ?? '');
}

/** One serializer per page: the window asks for the tab, and the module draws it. */
export function restore(
	context: vscode.ExtensionContext,
	pages: readonly RestorablePage[]
): vscode.Disposable[] {
	return pages.map((page) =>
		vscode.window.registerWebviewPanelSerializer(page.viewType, {
			async deserializeWebviewPanel(panel: vscode.WebviewPanel): Promise<void> {
				page.open(panel, remembered(context, page.viewType));
			}
		})
	);
}

/**
 * One serializer per page for a module whose `open` makes its own panel.
 *
 * The restored tab is closed and the page opened again: the reader gets their page back, but the tab lands where the
 * module puts it rather than where it was. `restore` above is the version that keeps the position, and is worth the
 * extra few lines wherever a module's `open` can take a panel.
 */
export function restoreByReopen(
	context: vscode.ExtensionContext,
	pages: readonly { viewType: string; open(arg?: string): void }[]
): vscode.Disposable[] {
	return pages.map((page) =>
		vscode.window.registerWebviewPanelSerializer(page.viewType, {
			async deserializeWebviewPanel(panel: vscode.WebviewPanel): Promise<void> {
				panel.dispose();
				page.open(remembered(context, page.viewType));
			}
		})
	);
}
