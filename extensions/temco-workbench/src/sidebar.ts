// The application's side-bar groups that are not a data view.
//
// Settings is the one container left that is a short list of rows, one per thing that can be done from there. They are
// rows rather than a page because a side bar answers "where do I go next"; the page behind each row is the module's.
// The rest of the side bar is data: Projects and What needs doing in Home, the project and its pages in Documentation.
//
// They live in the workbench module for one reason: **the order of the activity bar is the order the containers were
// registered**, and a container cannot declare an order. Declaring them all in one manifest is the only way to get the
// intended sequence — Home, Documentation, AI, Tools, Settings — instead of whichever module happened to be scanned
// first.

import * as vscode from 'vscode';

interface Row {
	label: string;
	/** What the row is for. The mock's side bar has no second line, so this is the tooltip. */
	note: string;
	/** The row's own glyph, as the mock gives every row one. */
	icon: string;
	command: string;
	args?: unknown[];
	/**
	 * The number at the end of the row, as the mock puts one on some rows. A key rather than a value: the count is
	 * read when the row is drawn, so a module installed or a page reviewed changes it without a rebuild.
	 */
	countKey?: 'modules' | 'needs';
}

interface Group {
	id: string;
	title: string;
	rows: Row[];
}

const GROUPS: Group[] = [
	{
		// One group, ordered from the window outward: the window itself, the work it keeps, what runs inside it, what
		// drafts, what ships, and last how the product presents itself. A row is a name and nothing else — the sentence
		// that says what it changes is the tooltip, so the list reads as six words rather than six paragraphs.
		id: 'temcoWorkbench.settings',
		title: 'Settings',
		rows: [
			{ label: 'General', note: 'its look, what it opens with, where work is kept, what it reports', icon: 'gear', command: 'temcoWorkbench.settings.general' },
			{ label: 'Repositories', note: 'the default enterprise, where copies are cloned, and the GitHub token', icon: 'repo', command: 'temcoRepositories.settings' },
			{ label: 'Modules', note: 'the modules loaded into this window, and what each owns', icon: 'package', command: 'temcoWorkbench.settings.modules' },
			{ label: 'AI Runtime', note: 'the local model, the servers that run it, and what they may reach', icon: 'sparkle', command: 'temcoWorkbench.settings.ai' },
			{ label: 'Publishing', note: 'where a release goes and what it may overwrite', icon: 'cloud-upload', command: 'temcoWorkbench.settings.publishing' },
			{ label: 'Branding', note: 'the mark, the colour roles and the identity', icon: 'paintcan', command: 'temcoWorkbench.settings.branding' }
		]
	}
];

/** The scheme a counted row's number travels in: the decoration slot is the only one at the row's right edge. */
const COUNT_SCHEME = 'temco-wb-count';

/** What the rows count, read when they are drawn. */
export interface SidebarCounts {
	modules: number;
	needs: number;
}

class RowsProvider implements vscode.TreeDataProvider<vscode.TreeItem> {
	private readonly changed = new vscode.EventEmitter<void>();
	readonly onDidChangeTreeData = this.changed.event;

	constructor(private readonly rows: readonly Row[], private readonly counts: () => SidebarCounts) { }

	refresh(): void {
		this.changed.fire();
	}

	getTreeItem(element: vscode.TreeItem): vscode.TreeItem {
		return element;
	}

	getChildren(): vscode.TreeItem[] {
		const counts = this.counts();
		return this.rows.map((row) => {
			const item = new vscode.TreeItem(row.label, vscode.TreeItemCollapsibleState.None);
			// The mock's side bar is one line per row: the glyph says what kind of thing it is, and the
			// sentence that used to sit beside the label is in the tooltip, where it does not repeat
			// down the panel. The number, when a row has one, sits at the end of the row.
			item.iconPath = new vscode.ThemeIcon(row.icon);
			if (row.countKey !== undefined) {
				item.resourceUri = vscode.Uri.parse(`${COUNT_SCHEME}:/${counts[row.countKey]}/${encodeURIComponent(row.label)}`);
			}
			item.tooltip = `${row.label} — ${row.note}`;
			item.command = { command: row.command, title: row.label, arguments: row.args };
			return item;
		});
	}
}

/** The side bar after it is registered: the one call a new count needs. */
export interface SidebarViews {
	refresh(): void;
}

/** Registers the group views the workbench's containers declare. */
export function registerSidebarViews(context: vscode.ExtensionContext, counts: () => SidebarCounts): SidebarViews {
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
	const providers: RowsProvider[] = [];
	for (const group of GROUPS) {
		const provider = new RowsProvider(group.rows, counts);
		providers.push(provider);
		context.subscriptions.push(vscode.window.createTreeView(group.id, { treeDataProvider: provider }));
	}
	return {
		refresh(): void {
			for (const provider of providers) {
				provider.refresh();
			}
		},
	};
}
