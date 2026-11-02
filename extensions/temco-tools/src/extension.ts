// Temco Tools — the device and data surfaces, one container each until their own modules exist.
//
// **SQL Studio is the panel while the others wait.** Devices, I/O, BACnet and Network were here as four sample
// studios; they are being built as their own categories, so the panel is SQL alone now and `studios.ts` is ready for
// them: one entry each, when they come back with their own logic behind them. Their pages are in this module's
// history, not in this file.
//
// **SQL Studio is not a sample**: it runs statements against the platform's own database, reads its schema back and
// can clear or reset it — see `sqlStudio.ts`. The page table there and the panel table in `studios.ts` are the two
// halves of the same thing: a page that exists, and the row that opens it.

import * as vscode from 'vscode';
import { SQL_PAGES, registerSql } from './sqlStudio';
import { ToolsTree } from './studios';
import { restore } from './ui';

export function activate(context: vscode.ExtensionContext): void {
	const sql = registerSql(context);

	context.subscriptions.push(
		sql.pages,
		...sql.disposables,
		// The whole side bar, from `studios.ts`: the studios, the jobs inside each, and the pages they open. A studio
		// or a page added to that table appears here without another line.
		vscode.window.createTreeView('temcoTools.studios', { treeDataProvider: new ToolsTree(), showCollapseAll: true }),
		// A page that was open when the window closed comes back with its tab. The studio's table already carries both
		// halves — the view type it opens under and the id its opener takes — so nothing is remembered here. The panel
		// the window restored is drawn into, so the tab keeps its place.
		...restore(context, [
			...SQL_PAGES.map((page) => ({ viewType: page.viewType, open: (panel: vscode.WebviewPanel) => void sql.pages.open(page.id, panel) }))
		])
	);
}

export function deactivate(): void {
	// The panels and the views are the window's; every command was registered on the extension's own context.
}
