// The Repositories panel: the enterprises this window asks about, the repositories under each, and — inside a
// repository — its files, the way a file browser shows them.
//
// Three levels, three answers. An **enterprise** is where a list comes from. A **repository** is a row of that list,
// which becomes a source when the project being worked on starts it; its mark is the language it is written in, and
// the only word beside it is `source` when this project already cites it. A **folder or file** is what is inside it —
// read from the local copy when there is one, and over the API when there is not.
//
// Anything recorded that no enterprise claims — a folder, an archive, a clone of an address nobody added — is listed
// under *Other sources* rather than disappearing.

import * as vscode from 'vscode';
import { sourceTree, RepositorySource } from './repository';
import { Catalog, OrganisationRow, RepositoryCacheRow, SourceRow, slugOf } from './store';

/** The view the panel draws into. */
export const SOURCES_VIEW_ID = 'temcoRepositories.list';

const MARK: { [kind: string]: string } = { git: 'repo', folder: 'folder', archive: 'package' };

/**
 * The glyph a file carries: the type where there is one, the plain file where there is not.
 *
 * The Explorer draws these from the **file icon theme**, which an extension cannot read — a tree item carries a
 * codicon or an image, and nothing that resolves a path against the theme — so this is the same idea in the one
 * vocabulary the window already has. The name is asked first (`package.json` is a package, not a JSON file), then the
 * extension, and the folder a file sits in is the last question, because code under `docs/` is still code.
 */
function fileMark(file: string): vscode.ThemeIcon {
	const name = (file.split('/').pop() ?? file).toLowerCase();
	const byName: { [key: string]: string } = {
		'package.json': 'package',
		'package-lock.json': 'lock',
		'yarn.lock': 'lock',
		'pnpm-lock.yaml': 'lock',
		'tsconfig.json': 'json',
		'jsconfig.json': 'json',
		'dockerfile': 'server',
		'docker-compose.yml': 'server',
		'license': 'law',
		'license.md': 'law',
		'.gitignore': 'source-control',
		'.gitattributes': 'source-control',
		'.editorconfig': 'settings',
		'.npmrc': 'settings',
	};
	const byExtension: { [key: string]: string } = {
		md: 'markdown', markdown: 'markdown', mdx: 'markdown',
		json: 'json', jsonc: 'json', json5: 'json',
		yml: 'settings', yaml: 'settings', toml: 'settings', ini: 'settings', conf: 'settings', env: 'settings',
		ts: 'code', mts: 'code', cts: 'code', tsx: 'code', js: 'code', mjs: 'code', cjs: 'code', jsx: 'code',
		html: 'code', htm: 'code', vue: 'code', svelte: 'code',
		css: 'symbol-color', scss: 'symbol-color', sass: 'symbol-color', less: 'symbol-color',
		py: 'python', rb: 'ruby',
		go: 'symbol-method', rs: 'symbol-method', java: 'symbol-class', kt: 'symbol-class', cs: 'symbol-class',
		c: 'symbol-struct', h: 'symbol-struct', cc: 'symbol-struct', cpp: 'symbol-struct', hpp: 'symbol-struct',
		sql: 'database',
		sh: 'terminal', bash: 'terminal', zsh: 'terminal', ps1: 'terminal', bat: 'terminal', cmd: 'terminal',
		png: 'file-media', jpg: 'file-media', jpeg: 'file-media', gif: 'file-media', svg: 'file-media',
		webp: 'file-media', ico: 'file-media',
		pdf: 'book',
		txt: 'note',
		lock: 'lock',
		csv: 'table', tsv: 'table',
	};
	const named = byName[name];
	if (named !== undefined) {
		return new vscode.ThemeIcon(named);
	}
	const extension = name.includes('.') ? name.split('.').pop() ?? '' : '';
	const byType = byExtension[extension];
	if (byType !== undefined) {
		return new vscode.ThemeIcon(byType);
	}
	return new vscode.ThemeIcon(isDocumentation(file) ? 'markdown' : 'file');
}

/**
 * The mark a repository carries: a glyph for the kind of code, and the colour GitHub gives that language.
 *
 * A tree row has one icon and one word, so the icon does the work the dashboard's left column did. Languages without
 * a glyph of their own fall back to `repo`, which is honest about what is known and quiet about what is not.
 */
function languageMark(language: string | undefined): vscode.ThemeIcon {
	const key = (language ?? '').trim().toLowerCase();
	const marks: { [name: string]: [string, string] } = {
		'c': ['symbol-struct', 'charts.blue'],
		'c++': ['symbol-class', 'charts.red'],
		'c#': ['symbol-class', 'charts.green'],
		'typescript': ['file-code', 'charts.blue'],
		'javascript': ['file-code', 'charts.yellow'],
		'python': ['file-code', 'charts.blue'],
		'java': ['symbol-class', 'charts.orange'],
		'rust': ['settings-gear', 'charts.orange'],
		'go': ['symbol-method', 'charts.blue'],
		'html': ['code', 'charts.orange'],
		'css': ['symbol-color', 'charts.blue'],
		'powershell': ['terminal', 'charts.blue'],
		'shell': ['terminal', 'charts.green'],
		'vue': ['code', 'charts.green'],
	};
	const mark = marks[key];
	return mark === undefined ? new vscode.ThemeIcon('repo') : new vscode.ThemeIcon(mark[0], new vscode.ThemeColor(mark[1]));
}

/** One row of the tree, kept as data so a child can be found from its parent. */
type Node =
	| { kind: 'organisation'; row: OrganisationRow }
	| { kind: 'repository'; row: RepositoryCacheRow; source?: string }
	| { kind: 'folder'; key: string; repository: string; path: string }
	| { kind: 'file'; key: string; repository: string; path: string; size: number }
	| { kind: 'other'; label: string; note: string }
	| { kind: 'source'; row: SourceRow }
	| { kind: 'empty'; label: string; note: string; command?: vscode.Command };

/** A tree item that remembers which node it came from. */
class NodeItem extends vscode.TreeItem {
	constructor(readonly node: Node, collapsibleState: vscode.TreeItemCollapsibleState) {
		super('', collapsibleState);
	}
}

/** When a list was read, in a form that survives a missing stamp. */
function when(stamp: string | undefined): string {
	if (stamp === undefined || stamp.length === 0) {
		return 'not read';
	}
	const date = new Date(stamp);
	return isNaN(date.getTime()) ? 'read' : `read ${date.toLocaleDateString()}`;
}

function kilo(bytes: number): string {
	return bytes >= 1024 ? `${(bytes / 1024).toFixed(1)} KB` : `${bytes} B`;
}

function item(node: Node): NodeItem {
	switch (node.kind) {
		case 'organisation': {
			const organisation = new NodeItem(node, vscode.TreeItemCollapsibleState.Expanded);
			organisation.label = node.row.name;
			organisation.id = `org:${node.row.slug}`;
			organisation.iconPath = new vscode.ThemeIcon(node.row.kind === 'repository' ? 'repo' : 'organization');
			organisation.contextValue = 'temcoOrganisation';
			organisation.description =
				`${node.row.repositories} ${node.row.repositories === 1 ? 'repository' : 'repositories'} · ${when(node.row.lastRead)}`;
			organisation.tooltip = new vscode.MarkdownString(
				`**${node.row.name}**\n\n${node.row.kind === 'repository' ? 'One repository, named by its address' : 'An enterprise or account on GitHub'}\n\n${organisation.description}`
			);
			// The page is where a list is read again; the panel names what exists and where to go.
			organisation.command = { command: 'temcoRepositories.page', title: 'Open the repositories page' };
			return organisation;
		}
		case 'repository': {
			// A repository opens: what is inside it is the next thing anyone wants.
			const repository = new NodeItem(node, vscode.TreeItemCollapsibleState.Collapsed);
			repository.label = node.row.name;
			repository.id = `repo:${node.row.fullName}`;
			repository.iconPath = languageMark(node.row.language);
			repository.contextValue = node.source === undefined ? 'temcoRepository' : 'temcoSource';
			// The only word a row carries: whether this project already cites it. Everything else is the tooltip's.
			repository.description = node.source === undefined ? '' : 'source';
			repository.tooltip = new vscode.MarkdownString(
				`**${node.row.fullName}**\n\n${node.row.description ?? ''}\n\n` +
					[
						node.row.language ?? 'repository',
						node.row.isPrivate ? 'private' : 'public',
						node.source === undefined ? 'not started' : 'source of this project',
						node.row.cloneUrl ?? '',
					]
						.filter((part) => part.length > 0)
						.join(' · ')
			);
			return repository;
		}
		case 'folder': {
			const folder = new NodeItem(node, vscode.TreeItemCollapsibleState.Collapsed);
			folder.label = node.path.split('/').pop() ?? node.path;
			folder.id = `dir:${node.key}/${node.path}`;
			folder.iconPath = new vscode.ThemeIcon('folder');
			folder.tooltip = node.path;
			return folder;
		}
		case 'file': {
			const file = new NodeItem(node, vscode.TreeItemCollapsibleState.None);
			file.label = node.path.split('/').pop() ?? node.path;
			file.id = `file:${node.key}/${node.path}`;
			file.iconPath = fileMark(node.path);
			file.contextValue = 'temcoFile';
			file.description = kilo(node.size);
			file.tooltip = `${node.path} — ${kilo(node.size)}`;
			file.command = {
				command: 'temcoRepositories.openRepositoryFile',
				title: 'Open the file',
				arguments: [node.repository, node.path],
			};
			return file;
		}
		case 'other': {
			const group = new NodeItem(node, vscode.TreeItemCollapsibleState.Expanded);
			group.label = node.label;
			group.id = 'other';
			group.iconPath = new vscode.ThemeIcon('library');
			group.description = node.note;
			return group;
		}
		case 'source': {
			const row = new NodeItem(node, vscode.TreeItemCollapsibleState.None);
			const facts = [node.row.kind === 'git' ? 'repository' : node.row.kind];
			if (node.row.branch !== undefined) {
				facts.push(node.row.branch);
			}
			facts.push(
				node.row.pages === undefined || node.row.pages === 0
					? 'not read'
					: `${node.row.pages} ${node.row.pages === 1 ? 'page' : 'pages'}`
			);
			row.label = node.row.name;
			row.id = `source:${node.row.slug}`;
			row.iconPath = new vscode.ThemeIcon(MARK[node.row.kind] ?? 'package');
			row.contextValue = 'temcoSource';
			row.description = facts.join(' · ');
			row.tooltip = new vscode.MarkdownString(`**${node.row.name}**\n\n${row.description}`);
			row.command = {
				command: node.row.kind === 'git' ? 'temcoDocs.repository' : 'temcoRepositories.revealSource',
				title: node.row.kind === 'git' ? 'Open the repository' : 'Open where it lives',
				arguments: [node.row.slug],
			};
			return row;
		}
		default: {
			const empty = new NodeItem(node, vscode.TreeItemCollapsibleState.None);
			empty.label = node.label;
			empty.iconPath = new vscode.ThemeIcon('info');
			empty.description = node.note;
			empty.command = node.command;
			return empty;
		}
	}
}

/** A file of the repository under `docs/`, in one of the shapes a page is written in. */
function isDocumentation(file: string): boolean {
	const lower = file.toLowerCase();
	return /\.(md|markdown)$/.test(lower) || /(^|\/)docs\//.test(lower);
}

/** One entry of a repository's flat listing, folded into the folder it belongs to. */
interface TreeEntry {
	files: { path: string; size: number }[];
	folders: Map<string, TreeEntry>;
}

function emptyEntry(): TreeEntry {
	return { files: [], folders: new Map() };
}

/** Fold `/`-separated paths into a tree, so a folder is a row and its contents are children. */
function foldTree(files: readonly { path: string; size: number }[]): TreeEntry {
	const root = emptyEntry();
	for (const file of files) {
		const parts = file.path.split('/');
		let entry = root;
		for (const part of parts.slice(0, -1)) {
			let next = entry.folders.get(part);
			if (next === undefined) {
				next = emptyEntry();
				entry.folders.set(part, next);
			}
			entry = next;
		}
		entry.files.push({ path: file.path, size: file.size });
	}
	return root;
}

class SourcesView implements vscode.TreeDataProvider<vscode.TreeItem> {
	private readonly changed = new vscode.EventEmitter<vscode.TreeItem | undefined | void>();
	readonly onDidChangeTreeData = this.changed.event;
	/** One listing per repository, so expanding a folder does not ask GitHub again. */
	private readonly trees = new Map<string, TreeEntry | { error: string }>();
	/** The folders that are open, so a row can show the open glyph the Explorer shows. */
	private readonly open = new Set<string>();

	constructor(private readonly context: vscode.ExtensionContext) { }

	refresh(): void {
		this.trees.clear();
		this.changed.fire();
	}

	/**
	 * Remember that a folder opened or closed, and repaint that one row.
	 *
	 * A tree item's icon is fixed once it is made, so the row is re-asked for rather than mutated in place: that is what
	 * makes `folder` become `folder-opened` without rebuilding the tree under it.
	 */
	setOpen(element: vscode.TreeItem, open: boolean): void {
		if (!(element instanceof NodeItem) || element.node.kind !== 'folder' || element.id === undefined) {
			return;
		}
		const id = String(element.id);
		if (open === this.open.has(id)) {
			return;
		}
		if (open) {
			this.open.add(id);
		} else {
			this.open.delete(id);
		}
		this.changed.fire(element);
	}

	getTreeItem(element: vscode.TreeItem): vscode.TreeItem {
		if (element instanceof NodeItem && element.node.kind === 'folder' && element.id !== undefined) {
			element.iconPath = new vscode.ThemeIcon(this.open.has(String(element.id)) ? 'folder-opened' : 'folder');
		}
		return element;
	}

	async getChildren(element?: vscode.TreeItem): Promise<vscode.TreeItem[]> {
		const parent = element instanceof NodeItem ? element.node : undefined;
		let catalog: Catalog | undefined;
		try {
			catalog = await Catalog.open(this.context);

			if (parent === undefined) {
				return this.roots(catalog);
			}
			if (parent.kind === 'organisation') {
				const sources = new Set(catalog.sources().map((row) => row.slug));
				const rows = catalog.repositoriesOf(parent.row.slug);
				if (rows.length === 0) {
					return [
						item({
							kind: 'empty',
							label: parent.row.state === 'refused' ? 'GitHub would not answer' : 'Nothing listed yet',
							note: 'open the page',
							command: { command: 'temcoRepositories.page', title: 'Open the repositories page' },
						}),
					];
				}
				return rows.map((row) =>
					item({ kind: 'repository', row, source: sources.has(slugOf(row.name)) ? slugOf(row.name) : undefined })
				);
			}
			if (parent.kind === 'other') {
				return this.unclaimed(catalog).map((row) => item({ kind: 'source', row }));
			}
			if (parent.kind === 'repository') {
				return this.repositoryChildren(catalog, parent.row);
			}
			if (parent.kind === 'folder') {
				const tree = this.trees.get(parent.key);
				let entry: TreeEntry | undefined;
				if (tree !== undefined && !('error' in tree)) {
					entry = tree;
					for (const part of parent.path.split('/')) {
						entry = entry?.folders.get(part);
					}
				}
				return entry === undefined
					? []
					: this.entriesOf(parent.key, parent.repository, entry, parent.path);
			}
			return [];
		} catch {
			// No catalog, no list: the panel says nothing rather than inventing a repository.
			return [];
		} finally {
			catalog?.close();
		}
	}

	/** The enterprises, then whatever is recorded but named by none of them. */
	private roots(catalog: Catalog): vscode.TreeItem[] {
		const nodes: Node[] = catalog.organisations().map((row) => ({ kind: 'organisation', row }));
		const other = this.unclaimed(catalog).length;
		if (other > 0) {
			nodes.push({
				kind: 'other',
				label: 'Other sources',
				note: `${other} recorded ${other === 1 ? 'source' : 'sources'} no enterprise lists`,
			});
		}
		if (nodes.length === 0) {
			nodes.push({
				kind: 'empty',
				label: 'No repository yet',
				note: 'add one on the page',
				command: { command: 'temcoRepositories.page', title: 'Add a repository' },
			});
		}
		return nodes.map(item);
	}

	/**
	 * What is inside a repository, as folders and files.
	 *
	 * Read from the local copy when there is one and over the API when there is not, so the tree works before
	 * anything is downloaded — it just costs GitHub's allowance instead of the disk.
	 */
	private async repositoryChildren(catalog: Catalog, row: RepositoryCacheRow): Promise<vscode.TreeItem[]> {
		const held = this.trees.get(`repo:${row.fullName}`);
		let tree: TreeEntry | { error: string } | undefined = held;

		if (tree === undefined) {
			const record = catalog.source(slugOf(row.name));
			const source: RepositorySource = {
				name: row.name,
				path: record?.path,
				remoteUrl: record?.remoteUrl ?? row.cloneUrl,
				branch: record?.branch,
				defaultBranch: record?.defaultBranch ?? row.defaultBranch,
			};
			const listed = await sourceTree(this.context, source);
			tree = 'error' in listed
				? { error: listed.error }
				: foldTree(listed.files);
			this.trees.set(`repo:${row.fullName}`, tree);
		}

		if ('error' in tree) {
			return [
				item({
					kind: 'empty',
					label: 'Its files could not be listed',
					note: tree.error,
					command: { command: 'temcoRepositories.repository', title: 'Open the repository', arguments: [row.name] },
				}),
			];
		}
		const children = this.entriesOf(`repo:${row.fullName}`, row.name, tree, '');
		if (children.length === 0) {
			return [
				item({
					kind: 'empty',
					label: 'No file to show',
					note: 'clone it into the working area',
					command: { command: 'temcoRepositories.repository', title: 'Open the repository', arguments: [row.name] },
				}),
			];
		}
		return children;
	}

	/** Folders first, then files — the order every file browser uses, for the same reason. */
	private entriesOf(key: string, repository: string, entry: TreeEntry, prefix: string): vscode.TreeItem[] {
		const folders = [...entry.folders.keys()].sort((left, right) => left.localeCompare(right));
		const files = [...entry.files].sort((left, right) => left.path.localeCompare(right.path));
		return [
			...folders.map((name) =>
				item({ kind: 'folder', key, repository, path: prefix === '' ? name : `${prefix}/${name}` })
			),
			...files.map((file) => item({ kind: 'file', key, repository, path: file.path, size: file.size })),
		];
	}

	/** What is recorded but named by no enterprise: a folder, an archive, or a repository nobody added. */
	private unclaimed(catalog: Catalog): SourceRow[] {
		const listed = new Set<string>();
		for (const organisation of catalog.organisations()) {
			for (const repository of catalog.repositoriesOf(organisation.slug)) {
				listed.add(slugOf(repository.name));
			}
		}
		return catalog.sources().filter((source) => !listed.has(source.slug));
	}
}

/**
 * Registers the panel.
 *
 * `changed` is the module's one signal — a read finished, a clone arrived, a source was forgotten — so the panel is
 * never a snapshot that drifts from what the actions did.
 */
export function registerSourcesView(context: vscode.ExtensionContext, changed: vscode.Event<void>): vscode.TreeView<vscode.TreeItem> {
	const view = new SourcesView(context);
	const tree = vscode.window.createTreeView(SOURCES_VIEW_ID, { treeDataProvider: view, showCollapseAll: false });
	context.subscriptions.push(
		tree,
		changed(() => view.refresh()),
		// The Explorer's own distinction: a folder that is open says so in its glyph.
		tree.onDidExpandElement((event) => view.setOpen(event.element, true)),
		tree.onDidCollapseElement((event) => view.setOpen(event.element, false))
	);
	return tree;
}
