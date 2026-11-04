// The Dashboard's project list.
//
// It is a list, not an editor: one row per project, and a chevron on every row. The side bar is a narrow column, so a
// row carries the two things that fit — the name and how many sources it cites plus whether it is the current one —
// and everything else is one click away underneath it: the facts (sources, pages, when it was last built, what is
// waiting) and the acts (work on it, open its page, edit it). Everything a project *is* stays on its own form.

import * as vscode from 'vscode';
import { Catalog, DocumentRow, selection } from './store';

/** A project row, carrying the record it was drawn from so its children can be read when it opens. */
interface ProjectNode extends vscode.TreeItem {
	row?: DocumentRow;
}

export class ProjectList implements vscode.TreeDataProvider<vscode.TreeItem> {
	private readonly changed = new vscode.EventEmitter<void>();
	readonly onDidChangeTreeData = this.changed.event;

	constructor(private readonly context: vscode.ExtensionContext) { }

	refresh(): void {
		this.changed.fire();
	}

	getTreeItem(item: vscode.TreeItem): vscode.TreeItem {
		return item;
	}

	async getChildren(item?: vscode.TreeItem): Promise<vscode.TreeItem[]> {
		if (item !== undefined) {
			const row = (item as ProjectNode).row;
			return row === undefined ? [] : this.details(row);
		}
		let catalog: Catalog | undefined;
		try {
			catalog = await Catalog.open(this.context);
			const rows = catalog.documents();
			if (rows.length === 0) {
				const empty = new vscode.TreeItem('No project yet', vscode.TreeItemCollapsibleState.None);
				empty.iconPath = new vscode.ThemeIcon('plus');
				empty.description = 'create one to start';
				empty.tooltip = 'A project is what a documentation set is managed as: it cites sources and produces a site.';
				empty.command = { command: 'temcoProjects.newProject', title: 'New Project' };
				return [empty];
			}
			return rows.map((row) => {
				// The row opens the project page; the chevron opens what the row cannot say in a 200px column —
				// the facts about the project, and the three things that can be done to it. The one being worked on is
				// the one whose chevron is already open: the side bar should answer "where am I" before it is asked.
				const current = row.slug === selection.project();
				const project: ProjectNode = new vscode.TreeItem(row.name, current
					? vscode.TreeItemCollapsibleState.Expanded
					: vscode.TreeItemCollapsibleState.Collapsed);
				project.id = row.slug;
				project.row = row;
				project.iconPath = new vscode.ThemeIcon(current ? 'folder-active' : 'folder-library');
				project.description = `${row.sources} source${row.sources === 1 ? '' : 's'}${current ? ' · current' : ''}`;
				project.tooltip = `${row.name}\n${row.slug}${row.version === undefined ? '' : ` · ${row.version}`}${row.builtAt === undefined ? ' · never built' : ` · built ${row.builtAt}`}`;
				project.contextValue = current ? 'project.current' : 'project';
				project.command = { command: 'temcoProjects.openProjectPage', title: 'Open the Project', arguments: [row.slug] };
				return project;
			});
		} catch {
			// A catalog that cannot be opened is not a list of nothing to say: the Dashboard has other rows, and the
			// projects page is where the reason is shown.
			return [];
		} finally {
			catalog?.close();
		}
	}

	/**
	 * What one project row opens into.
	 *
	 * The facts a project has — how many pages, whether it was ever built, what is waiting — read as rows of their
	 * own rather than as a second line of the parent: the side bar is a narrow column, and a row that grows a line of
	 * state stops being scannable at that width. The three acts come last, where the eye arrives after the facts.
	 */
	private async details(row: DocumentRow): Promise<vscode.TreeItem[]> {
		let pages = 0;
		let drafts = 0;
		let catalog: Catalog | undefined;
		try {
			catalog = await Catalog.open(this.context);
			pages = catalog.documentPages(row.slug).length;
			drafts = catalog.drafts(row.slug).length;
		} catch {
			// The facts that could not be read fall back to what the list already knew.
		} finally {
			catalog?.close();
		}

		const fact = (label: string, description: string, icon: string, command?: vscode.Command): vscode.TreeItem => {
			const item = new vscode.TreeItem(label, vscode.TreeItemCollapsibleState.None);
			item.description = description;
			item.iconPath = new vscode.ThemeIcon(icon);
			if (command !== undefined) {
				item.command = command;
			}
			return item;
		};
		const open = (command: string, title: string, args: unknown[] = []): vscode.Command => ({ command, title, arguments: args });

		const sources = fact('Sources', String(row.sources), 'library', open('temcoRepositories.page', 'The Repositories'));
		const pageCount = fact('Pages', String(pages), 'book', open('temcoDocs.projectPage', 'Open the Project', [row.slug]));
		const built = fact('Built', row.builtAt === undefined ? 'never' : row.builtAt, 'history', open('temcoDocs.builds', 'Build Center'));
		const waiting = fact('Drafts', drafts === 0 ? 'none' : String(drafts), 'check', open('temcoDocs.review', 'Review Center'));

		const act = (label: string, icon: string, command: vscode.Command, description?: string): vscode.TreeItem => {
			const item = new vscode.TreeItem(label, vscode.TreeItemCollapsibleState.None);
			item.iconPath = new vscode.ThemeIcon(icon);
			item.command = command;
			if (description !== undefined) {
				item.description = description;
			}
			return item;
		};
		const working = row.slug === selection.project();
		const acts = [
			working
				? act('Work on the pages', 'list-selection', open('temcoDocs.pages.focus', 'Show the Pages'))
				: act('Work on this project', 'play', open('temcoProjects.selectProject', 'Work on this Project', [row.slug])),
			act('Open the project page', 'go-to-file', open('temcoDocs.projectPage', 'Open the Project', [row.slug])),
			act('Edit the project', 'gear', open('temcoProjects.editProject', 'Edit the Project', [row.slug])),
			// Removing a project is the one act that cannot be undone, so it is last and it asks first.
			act('Remove this project', 'trash', open('temcoProjects.removeProject', 'Remove Project', [row.slug]))
		];

		return [sources, pageCount, built, waiting, ...acts];
	}
}
