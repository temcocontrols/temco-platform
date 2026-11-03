/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Temco Controls. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

// The Home panel's Overview: this window's own facts, one row per subject, each opening the page behind it.
//
// Four rows, and every number in them is one this window can attest to: the projects the catalog holds, the pages the
// sets in front declare, what is waiting for a person, and the last version published. A number that cannot be read
// says so — a dash rather than a zero nothing measured.
//
// The number is the row's `description`, which is the slot a native tree draws at the right-hand end of the row. An
// earlier version pushed it there through a file-decoration provider and a URI scheme of its own, which is a lot of
// machinery for a string this property already draws.

import * as vscode from 'vscode';
import { roots, totals } from './docs';
import { Catalog, selection } from './store';

/** One row of the panel: a subject, its number, and the page that answers it. */
interface RowOptions {
	/** Stable across refreshes, so the tree keeps its selection when a number changes. */
	id: string;
	label: string;
	/** The number, at the row's right-hand end. */
	value: string;
	icon: string;
	/** What the number counts, in the tooltip. */
	what: string;
	command: string;
}

export class OverviewTree implements vscode.TreeDataProvider<vscode.TreeItem> {
	private readonly changed = new vscode.EventEmitter<void>();
	readonly onDidChangeTreeData = this.changed.event;

	constructor(private readonly context: vscode.ExtensionContext) { }

	refresh(): void {
		this.changed.fire();
	}

	getTreeItem(item: vscode.TreeItem): vscode.TreeItem {
		return item;
	}

	/** Four rows and no parent: the view is already named Overview, so a root row would only indent them. */
	async getChildren(item?: vscode.TreeItem): Promise<vscode.TreeItem[]> {
		return item === undefined ? this.facts() : [];
	}

	private async facts(): Promise<vscode.TreeItem[]> {
		const counted = totals(roots());
		let projects: number | undefined;
		let waiting: number | undefined;
		let published: string | undefined;
		let catalog: Catalog | undefined;
		try {
			catalog = await Catalog.open(this.context);
			const documents = catalog.documents();
			projects = documents.length;
			// The window's project, or the only one there is: a lone author never picks a project, and a queue that
			// ignored their drafts would be the one row on this panel that lies.
			const current = selection.project() ?? (documents.length === 1 ? documents[0].slug : undefined);
			if (current !== undefined) {
				waiting = catalog.drafts(current).length;
				published = catalog.releases(current)[0]?.version;
			}
		} catch {
			// A catalog that cannot be read leaves the two rows it feeds empty rather than wrong.
		} finally {
			catalog?.close();
		}

		const row = (options: RowOptions): vscode.TreeItem => {
			const entry = new vscode.TreeItem(options.label, vscode.TreeItemCollapsibleState.None);
			entry.id = options.id;
			entry.iconPath = new vscode.ThemeIcon(options.icon);
			entry.description = options.value;
			entry.tooltip = `${options.label} — ${options.what}`;
			entry.command = { command: options.command, title: options.label };
			return entry;
		};

		return [
			row({
				id: 'overview.projects',
				label: 'Projects',
				value: projects === undefined ? '—' : String(projects),
				icon: 'folder-library',
				what: 'the documentation sets this machine holds',
				command: 'temcoDocs.projects'
			}),
			row({
				id: 'overview.pages',
				label: 'Pages',
				value: String(counted.pages),
				icon: 'book',
				what: 'the pages the sets in front declare',
				command: 'temcoDocs.pages.focus'
			}),
			row({
				id: 'overview.review',
				label: 'Needs review',
				value: String(counted.neverReviewed + (waiting ?? 0)),
				icon: 'check',
				what: 'pages never reviewed, plus the drafts still waiting',
				command: 'temcoDocs.review'
			}),
			row({
				id: 'overview.release',
				label: 'Last release',
				value: published ?? 'never',
				icon: 'cloud-upload',
				what: 'the last version frozen for readers',
				command: 'temcoDocs.releases'
			})
		];
	}
}
