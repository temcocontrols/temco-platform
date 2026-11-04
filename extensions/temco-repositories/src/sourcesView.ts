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

/** The scheme a file row carries before the repository is cloned. Only its path matters: that is what names the icon. */
const VIRTUAL_SCHEME = 'temco-source';

/**
 * The address a file or folder row is drawn from, under the repository's own base.
 *
 * It is what makes the row carry the **file icon theme's** glyph — the same one the Explorer shows — instead of a
 * codicon chosen here: VS Code resolves the icon by name, then extension, then the language the path implies. Nothing
 * in this module decides what type a file is any more, and a different theme repaints the panel with no code change.
 */
function resourceOf(base: vscode.Uri, path: string): vscode.Uri {
	return vscode.Uri.joinPath(base, ...path.split('/'));
}

/** One row of the tree, kept as data so a child can be found from its parent. */
type Node =
	| { kind: 'organisation'; row: OrganisationRow }
	| { kind: 'repository'; row: RepositoryCacheRow; source?: string }
	/** `base` is what a file's or folder's resource is resolved against — the clone, or a virtual address for it. */
	| { kind: 'folder'; key: string; repository: string; base: vscode.Uri; path: string }
	| { kind: 'file'; key: string; repository: string; base: vscode.Uri; path: string; size: number }
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
			// A repository *is* a folder — that is what it is on this machine and in the Explorer — so it carries a
			// folder, drawn by the same icon theme as the files below it. No language here: the row is a project, and
			// the language is a fact its tooltip and its own page already state.
			repository.resourceUri = vscode.Uri.parse(`${VIRTUAL_SCHEME}:/${node.row.fullName}`);
			repository.iconPath = new vscode.ThemeIcon('folder');
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
			// A folder with a resource and the plain `folder` icon is drawn by the icon theme: its collapsed glyph now,
			// its open glyph by the theme's own CSS when the row is expanded — no bookkeeping here.
			folder.resourceUri = resourceOf(node.base, node.path);
			folder.iconPath = new vscode.ThemeIcon('folder');
			folder.tooltip = node.path;
			return folder;
		}
		case 'file': {
			const file = new NodeItem(node, vscode.TreeItemCollapsibleState.None);
			file.label = node.path.split('/').pop() ?? node.path;
			file.id = `file:${node.key}/${node.path}`;
			// Same deal for a file: the `file` icon defers to the icon theme's mapping of this path — by name, extension
			// and language — so `app.c`, `README.md` and `package.json` each look like they do in the Explorer.
			file.resourceUri = resourceOf(node.base, node.path);
			file.iconPath = new vscode.ThemeIcon('file');
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
	/** Every item this provider has handed out, by id: `reveal` needs the element, not a second copy of it. */
	private readonly made = new Map<string, vscode.TreeItem>();

	constructor(private readonly context: vscode.ExtensionContext) { }

	refresh(): void {
		this.trees.clear();
		this.changed.fire();
	}

	/**
	 * The row above a row.
	 *
	 * `TreeView.reveal` asks the provider for this to build the chain it has to open before it can select something deep
	 * in the tree. Without it every element counts as a root, so a repository row can never be revealed — which is
	 * exactly why "View it in the panel" did nothing.
	 */
	getParent(element: vscode.TreeItem): vscode.ProviderResult<vscode.TreeItem> {
		return element instanceof NodeItem ? this.parentOf(element.node) : undefined;
	}

	private async parentOf(node: Node): Promise<vscode.TreeItem | undefined> {
		if (node.kind === 'folder' || node.kind === 'file') {
			const cut = node.path.lastIndexOf('/');
			if (cut > 0) {
				return this.make({
					kind: 'folder',
					key: node.key,
					repository: node.repository,
					base: node.base,
					path: node.path.slice(0, cut),
				});
			}
			return (await this.locate(node.key.replace(/^repo:/, ''))).row;
		}
		if (node.kind === 'repository') {
			return (await this.locate(node.row.fullName)).parent;
		}
		if (node.kind === 'source') {
			return (await this.locate(node.row.slug)).parent;
		}
		return undefined;
	}

	getTreeItem(element: vscode.TreeItem): vscode.TreeItem {
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
				const items = rows.map((row) =>
					this.make({ kind: 'repository', row, source: sources.has(slugOf(row.name)) ? slugOf(row.name) : undefined })
				);
				return items;
			}
			if (parent.kind === 'other') {
				return this.unclaimed(catalog).map((row) => this.make({ kind: 'source', row }));
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
					: this.entriesOf(parent.key, parent.repository, entry, parent.path, parent.base);
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
	/**
	 * One item, reused for the same node.
	 *
	 * `TreeView.reveal` resolves the element it is given, and the tree matches it against the elements it was handed —
	 * so a provider that made a fresh object every time could never be revealed. Reusing by id is what makes a page's
	 * "View it in the panel" able to select a row.
	 */
	private make(node: Node): NodeItem {
		const created = item(node);
		const id = created.id === undefined ? undefined : String(created.id);
		if (id === undefined) {
			return created;
		}
		const known = this.made.get(id);
		if (known instanceof NodeItem) {
			return known;
		}
		this.made.set(id, created);
		return created;
	}

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
		return nodes.map((node) => this.make(node));
	}

	/**
	 * What is inside a repository, as folders and files.
	 *
	 * Read from the local copy when there is one and over the API when there is not, so the tree works before
	 * anything is downloaded — it just costs GitHub's allowance instead of the disk.
	 */
	private async repositoryChildren(catalog: Catalog, row: RepositoryCacheRow): Promise<vscode.TreeItem[]> {
		const key = `repo:${row.fullName}`;
		const record = catalog.source(slugOf(row.name));
		// The clone's own folder when there is one — so an open editor, the Explorer's decorations and this panel all look
		// at the same resource — and a virtual address under the repository's name when there is not, which is enough for
		// the icon theme to tell a `.c` from a `.md`.
		const base = record?.path === undefined
			? vscode.Uri.parse(`${VIRTUAL_SCHEME}:/${row.fullName}`)
			: vscode.Uri.file(record.path);
		const held = this.trees.get(key);
		let tree: TreeEntry | { error: string } | undefined = held;

		if (tree === undefined) {
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
			this.trees.set(key, tree);
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
		const children = this.entriesOf(key, row.name, tree, '', base);
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
	private entriesOf(key: string, repository: string, entry: TreeEntry, prefix: string, base: vscode.Uri): vscode.TreeItem[] {
		const folders = [...entry.folders.keys()].sort((left, right) => left.localeCompare(right));
		const files = [...entry.files].sort((left, right) => left.path.localeCompare(right.path));
		return [
			...folders.map((name) =>
				item({ kind: 'folder', key, repository, base, path: prefix === '' ? name : `${prefix}/${name}` })
			),
			...files.map((file) => item({ kind: 'file', key, repository, base, path: file.path, size: file.size })),
		];
	}

	/**
	 * The two rows a page's "View it in the panel" has to open: the enterprise that lists a repository, and the
	 * repository's own row.
	 *
	 * Both are **built here**, not looked up among items the tree happens to have drawn: `reveal` matches the element it
	 * is given against the elements the provider returns, and `make()` returns the same object for the same node — so a
	 * row can be revealed even on the first click, before the tree has ever expanded anything.
	 */
	async locate(fullName: string): Promise<{ parent?: vscode.TreeItem; row?: vscode.TreeItem }> {
		const wanted = slugOf(fullName);
		let catalog: Catalog | undefined;
		try {
			catalog = await Catalog.open(this.context);
			const sources = new Set(catalog.sources().map((row) => row.slug));
			for (const organisation of catalog.organisations()) {
				const rows = catalog.repositoriesOf(organisation.slug);
				const row = rows.find((candidate) => candidate.fullName === fullName)
					?? rows.find((candidate) => slugOf(candidate.name) === wanted);
				if (row !== undefined) {
					return {
						parent: this.make({ kind: 'organisation', row: organisation }),
						row: this.make({
							kind: 'repository',
							row,
							source: sources.has(slugOf(row.name)) ? slugOf(row.name) : undefined,
						}),
					};
				}
			}
			// A source no enterprise lists lives under "Other sources", when there are any.
			const source = catalog.sources().find((row) => row.slug === wanted);
			if (source !== undefined) {
				const others = this.unclaimed(catalog);
				return {
					parent: others.length === 0 ? undefined : this.make({
						kind: 'other',
						label: 'Other sources',
						note: `${others.length} recorded ${others.length === 1 ? 'source' : 'sources'} no enterprise lists`,
					}),
					row: this.make({ kind: 'source', row: source }),
				};
			}
			return {};
		} catch {
			return {};
		} finally {
			catalog?.close();
		}
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
		// A page's "View it in the panel": focus the view, then select the repository's own row in it.
		//
		// `reveal` needs `getParent` (see below) and the row the provider itself would hand out, which `locate()` builds;
		// without both it rejects and nothing moves — which is what "View it in the panel does nothing" was.
		vscode.commands.registerCommand('temcoRepositories.revealInTree', async (fullName?: unknown) => {
			if (typeof fullName !== 'string' || fullName.length === 0) {
				return;
			}
			await vscode.commands.executeCommand(`${SOURCES_VIEW_ID}.focus`);
			const { row } = await view.locate(fullName);
			if (row === undefined) {
				void vscode.window.showInformationMessage(
					`Temco Repositories: ${fullName} is not in the panel yet — open the repositories page to add it.`
				);
				return;
			}
			try {
				// Open the repository itself, so its top level is on screen. Its folders stay collapsed: one level is
				// the answer to "where is it", and expanding everything would bury the row that was just selected.
				await tree.reveal(row, { select: true, focus: true, expand: true });
			} catch (error) {
				void vscode.window.showWarningMessage(
					`Temco Repositories: could not reveal ${fullName} — ${error instanceof Error ? error.message : String(error)}`
				);
			}
		})
	);
	return tree;
}
