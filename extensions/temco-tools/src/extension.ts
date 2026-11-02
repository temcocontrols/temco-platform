// Temco Tools — the device and data surfaces, one container each until their own modules exist.
//
// Five studios, each with its own pages:
//
//   * **Devices** — six pages;
//   * **I/O Studio** — five pages;
//   * **BACnet Studio** — five pages;
//   * **Network** — four pages;
//   * **SQL Studio** — Workbench and Docs Database, six pages, and the only one that still keeps a side bar of its
//     own: those two views are declared under `temcoSql` and are the only `createTreeView` calls left here.
//
// Every one of them was a folded section of a single page until the mock's side bar was taken seriously: each row has
// its own title, its own count where the count means something, and its own actions, and a folded section cannot carry
// any of those. Each studio owns its pages (`devices.ts`, `io.ts`, `bacnet.ts`, `network.ts`, `sqlStudio.ts`) and its
// sample; this file is only the wiring — the activation and the views.
//
// **What is real and what is sample.** The pages, their navigation, their vocabulary and their buttons are real: a
// button asks, changes the studio's register, re-renders and reports what it changed. The rows are the mock's sample
// for the four device studios, because those have no socket to a controller, no BACnet stack and no capture device
// yet. **SQL Studio is not a sample**: it runs statements against the platform's own database, reads its schema back
// and can clear or reset it — see `sqlStudio.ts`.

import * as vscode from 'vscode';
import { BACNET_PAGES, registerBacnet } from './bacnet';
import { DEVICE_PAGES, registerDevices } from './devices';
import { IO_PAGES, registerIo } from './io';
import { NETWORK_PAGES, registerNetwork } from './network';
import { SQL_PAGES, registerSql } from './sqlStudio';
import { restoreByReopen } from './ui';

/** One row of a studio's side bar: the label, the sentence behind it, and the glyph. */
interface StudyRow {
	label: string;
	note: string;
	mark: string;
	command: string;
	/** The page id, where a row's count is keyed by it. */
	id?: string;
}

/**
 * The glyph a side-bar row shows for a page mark.
 *
 * A mark is the name of a glyph in the page sprite (`temco-ui/media/icons.svg`) because a page head draws the
 * same one. A few sprite names are not codicons, and a side-bar row can only be drawn with a codicon — so the
 * handful that differ are named here once. Anything not listed is already a codicon id and is used as it is.
 */
const CODICON_FOR: Record<string, string> = {
	list: 'list-unordered',
	activity: 'pulse',
	chart: 'graph',
	document: 'file',
	building: 'window',
	graduation: 'mortar-board',
	palette: 'paintcan',
	upload: 'cloud-upload',
};

const codicon = (mark: string): string => CODICON_FOR[mark] ?? mark;

/**
 * A row's number, as a decoration rather than as text beside the label.
 *
 * The description slot sits *after* the label, not at the end of the row; the one slot a row pushes to the right
 * edge is its decoration — the same one the Explorer fills with "M"/"U" and Source Control with its counts. So the
 * number travels in the URI and one provider turns it into a badge.
 */
const COUNT_SCHEME = 'temco-tool-count';

const counted = (count: number, key: string): vscode.Uri =>
	vscode.Uri.parse(`${COUNT_SCHEME}:/${count}/${encodeURIComponent(key)}`);

/**
 * A studio's side-bar view: one row per page.
 *
 * Most rows carry no count in the mock — a point count or a table count is already in the page head, and the side bar
 * would only repeat what the page it opens says. The two that do (the alarms still active, the reports worth running)
 * are named in `counts`, so the number is read when the row is drawn rather than baked into the row.
 */
class PagesTree implements vscode.TreeDataProvider<vscode.TreeItem> {
	constructor(
		private readonly rows: StudyRow[],
		private readonly counts: Record<string, () => number> = {}
	) { }

	getTreeItem(element: vscode.TreeItem): vscode.TreeItem {
		return element;
	}

	getChildren(): vscode.TreeItem[] {
		return this.rows.map((row) => {
			const item = new vscode.TreeItem(row.label, vscode.TreeItemCollapsibleState.None);
			item.iconPath = new vscode.ThemeIcon(codicon(row.mark));
			const count = row.id === undefined ? undefined : this.counts[row.id]?.();
			if (count !== undefined) {
				item.resourceUri = counted(count, row.label);
			}
			item.tooltip = `${row.label} — ${row.note}`;
			item.command = { command: row.command, title: row.label };
			return item;
		});
	}
}

export function activate(context: vscode.ExtensionContext): void {
	// The numbers at the right edge of a row: a decoration, because that is the slot the host pushes to the end.
	context.subscriptions.push(
		vscode.window.registerFileDecorationProvider({
			provideFileDecoration(uri: vscode.Uri): vscode.FileDecoration | undefined {
				if (uri.scheme !== COUNT_SCHEME) {
					return undefined;
				}
				const count = uri.path.split('/')[1];
				return count === undefined || count.length === 0 ? undefined : { badge: count, tooltip: count };
			},
		})
	);
	const devices = registerDevices(context);
	const io = registerIo(context);
	const bacnet = registerBacnet(context);
	const network = registerNetwork(context);
	const sql = registerSql(context);

	context.subscriptions.push(
		devices.pages,
		...devices.disposables,
		io.pages,
		...io.disposables,
		bacnet.pages,
		...bacnet.disposables,
		network.pages,
		...network.disposables,
		sql.pages,
		...sql.disposables,
		vscode.window.createTreeView('temcoTools.sqlWorkbench', { treeDataProvider: new PagesTree(SQL_PAGES.filter((entry) => entry.group === 'rows')) }),
		vscode.window.createTreeView('temcoTools.sqlDocs', { treeDataProvider: new PagesTree(SQL_PAGES.filter((entry) => entry.group === 'file')) }),
		// A page of a studio that was open when the window closed comes back with its tab. Each studio's table already
		// carries both halves — the view type it opens under and the id its opener takes — so nothing is remembered here.
		...restoreByReopen(context, [
			...DEVICE_PAGES.map((page) => ({ viewType: page.viewType, open: () => devices.pages.open(page.id) })),
			...IO_PAGES.map((page) => ({ viewType: page.viewType, open: () => io.pages.open(page.id) })),
			...BACNET_PAGES.map((page) => ({ viewType: page.viewType, open: () => bacnet.pages.open(page.id) })),
			...NETWORK_PAGES.map((page) => ({ viewType: page.viewType, open: () => network.pages.open(page.id) })),
			...SQL_PAGES.map((page) => ({ viewType: page.viewType, open: () => void sql.pages.open(page.id) }))
		])
	);
}

export function deactivate(): void {
	// The panels and the views are the window's; every command was registered on the extension's own context.
}
