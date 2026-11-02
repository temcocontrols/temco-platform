// What the Tools panel is made of.
//
// The panel is a table, not a list. Two dimensions, because a tool has two: **the studio it belongs to** (Devices,
// I/O, BACnet, Network, SQL) and **the job it does inside that studio** (a fleet view, logged data, engineering
// values, diagnostics, the database file). Both were already in the page tables — each page carries the `group` it
// sits in — so the panel is built from them rather than declared a third time.
//
// **Adding a tool is one entry.** A new studio is one object here with its own page table; a new page is one row in
// a studio's table with a `group` that already exists (or a new job beside it). The tree, the counts and the row
// glyphs follow from that; `extension.ts` names no studio and no page.
//
// The jobs are ordered as a person meets them: what the studio is first (the fleet, the point list, the network),
// then what it logs. A studio with no page in a job does not show the job — an empty heading is a promise the panel
// cannot keep.

import * as vscode from 'vscode';
import { SQL_PAGES } from './sqlStudio';

/** One page of a studio, as the panel needs it: a row to draw and a command to run. */
export interface StudioPage {
	id: string;
	label: string;
	note: string;
	mark: string;
	command: string;
	viewType: string;
	/** The job the page does, named in the studio's own table. */
	group: string;
}

/** One job inside a studio — the heading its pages sit under. */
export interface StudioJob {
	/** The value a page's `group` carries. */
	id: string;
	label: string;
}

/** One studio: its row in the panel, the jobs it has, and its pages. */
export interface Studio {
	id: string;
	label: string;
	/** The sentence the studio's row carries, read on hover and in the tooltip. */
	note: string;
	/** The codicon the studio's row shows. */
	mark: string;
	jobs: readonly StudioJob[];
	pages: readonly StudioPage[];
}

export const STUDIOS: readonly Studio[] = [
	{
		id: 'sql',
		label: 'SQL',
		note: 'the platform’s own database: what it holds, and how it is kept',
		mark: 'database',
		jobs: [{ id: 'rows', label: 'Tables & queries' }, { id: 'file', label: 'The file' }],
		pages: SQL_PAGES
	}
];

/** The glyph a page mark means in a side-bar row, where only a codicon can be drawn. */
const CODICON_FOR: Record<string, string> = {
	list: 'list-unordered',
	activity: 'pulse',
	chart: 'graph',
	document: 'file',
	building: 'window',
	graduation: 'mortar-board',
	palette: 'paintcan',
	upload: 'cloud-upload'
};

const codicon = (mark: string): string => CODICON_FOR[mark] ?? mark;

/** One drawn row: a studio, a job inside it, or a page. */
type ToolsNode =
	| { kind: 'studio'; studio: Studio }
	| { kind: 'job'; job: StudioJob; pages: readonly StudioPage[] }
	| { kind: 'page'; page: StudioPage };

const plural = (count: number, one: string, many: string): string => `${count} ${count === 1 ? one : many}`;

/**
 * The Tools panel: studios, the jobs inside them, and the pages those jobs open.
 *
 * **Open all the way down.** The tree is a table of contents for a handful of pages, not an archive: a person opening
 * Tools is looking for one page, and folding what is there so they can click twice to see it is the interface asking
 * them to work. Rows carry their **name only** — a description beside a name competes with it for the width the names
 * need, and the sentence is there on hover.
 *
 * A studio or a page added to `STUDIOS` appears here with no other line: the panel *is* that table.
 */
export class ToolsTree implements vscode.TreeDataProvider<ToolsNode> {
	constructor(private readonly studios: readonly Studio[] = STUDIOS) { }

	getTreeItem(node: ToolsNode): vscode.TreeItem {
		switch (node.kind) {
			case 'studio': {
				const item = new vscode.TreeItem(node.studio.label, vscode.TreeItemCollapsibleState.Expanded);
				item.id = node.studio.id;
				item.iconPath = new vscode.ThemeIcon(node.studio.mark);
				item.tooltip = `${node.studio.label} — ${node.studio.note}`;
				return item;
			}
			case 'job': {
				const item = new vscode.TreeItem(node.job.label, vscode.TreeItemCollapsibleState.Expanded);
				item.tooltip = `${node.job.label} — ${plural(node.pages.length, 'page', 'pages')}`;
				return item;
			}
			case 'page': {
				const item = new vscode.TreeItem(node.page.label, vscode.TreeItemCollapsibleState.None);
				item.iconPath = new vscode.ThemeIcon(codicon(node.page.mark));
				item.tooltip = `${node.page.label} — ${node.page.note}`;
				item.command = { command: node.page.command, title: node.page.label };
				return item;
			}
		}
	}

	getChildren(node?: ToolsNode): ToolsNode[] {
		if (node === undefined) {
			return this.studios.map((studio) => ({ kind: 'studio' as const, studio }));
		}
		if (node.kind === 'studio') {
			return node.studio.jobs
				.map((job) => ({
					kind: 'job' as const,
					job,
					pages: node.studio.pages.filter((page) => page.group === job.id)
				}))
				.filter((entry) => entry.pages.length > 0);
		}
		if (node.kind === 'job') {
			return node.pages.map((page) => ({ kind: 'page' as const, page }));
		}
		return [];
	}
}
