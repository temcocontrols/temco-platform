// The store module's entry point.
//
// It is the platform's own memory, and it has no surface of its own beyond one command: every other module
// writes and reads through the API below, and no module is answered by a second database beside its own code.
//
// Nothing is opened at activation. The database is opened per use and closed by the caller — a window that never
// reads a source never holds a database — and the selection is the one thing kept for the window's lifetime,
// because it is one piece of state with one signal, not a value to be re-made per caller.

import * as vscode from 'vscode';
import { registerStoreCommands } from './commands';
import { CATALOG_FILE, Catalog, CatalogUnavailable, sqliteAvailable } from './catalog/store';
import { slugOf } from './names';
import { Selection } from './selection';
import { TemcoStoreApi, projectOutputs } from './api';

export function activate(context: vscode.ExtensionContext): TemcoStoreApi {
	const selection = new Selection(context);
	context.subscriptions.push(selection);

	registerStoreCommands(context);

	return {
		available: () => {
			// Asked of the runtime rather than of the Node version: what matters is whether `node:sqlite` is there.
			return sqliteAvailable();
		},

		catalog: () => Catalog.open(context),

		databasePath: () => vscode.Uri.joinPath(context.globalStorageUri, 'catalog', CATALOG_FILE).fsPath,

		CatalogUnavailable,

		selection,

		slugOf,

		outputs: projectOutputs
	};
}

export function deactivate(): void {
	// Nothing to unwind: every open catalog is closed by the caller that opened it, and the selection lives in
	// the window's own storage.
}
