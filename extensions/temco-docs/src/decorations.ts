// What the Explorer and the Repositories panel say about a file before it is opened.
//
// The memory already knows which files are pages and when each source holding them was last read, so the two panels
// can say it in the place a person already looks: the row's own badge, the slot git uses for `M` and `U`. Three
// answers, and no more — `✓` a page that has not changed since it was read, `●` a page that has, and `○` a markdown
// file in a source that is not a page at all.
//
// Nothing here reads a file's text, and nothing here decides what a tree shows: a decoration is an overlay on a row
// that is already there. A file with no badge is a file the memory has nothing to say about, which is the honest
// answer for a folder nobody ever read.
//
// One provider serves the whole window, because a decoration belongs to the **resource**, not to a view: the Explorer,
// the Repositories panel and any tree row carrying a `resourceUri` get the same answer from the same memory.

import { promises as fs } from 'node:fs';
import * as path from 'node:path';
import * as vscode from 'vscode';
import { Catalog } from './store';

/** What the memory knows about one file: when it was read, and when it was written. */
interface Known {
	/** The source's last read, in milliseconds. `undefined` when the source has never been read. */
	readAt?: number;
	/** The file's own write time, in milliseconds. */
	writtenAt: number;
}

const READ: vscode.FileDecoration = {
	badge: '✓',
	color: new vscode.ThemeColor('charts.green'),
	tooltip: 'A page — unchanged since its source was read',
};

const CHANGED: vscode.FileDecoration = {
	badge: '●',
	color: new vscode.ThemeColor('charts.orange'),
	tooltip: 'A page — changed since its source was last read',
};

const STRANGER: vscode.FileDecoration = {
	badge: '○',
	color: new vscode.ThemeColor('disabledForeground'),
	tooltip: 'Markdown in a source that is not a page the platform knows',
};

/**
 * How long an index may stand before the next row that asks rebuilds it.
 *
 * A read, a clone and a build all change the memory, and none of them reaches this provider as a signal. Rebuilding on
 * demand after a while — rather than on a timer — keeps a window nobody is reading in quiet.
 */
const STALE_AFTER_MS = 30_000;

class PageDecorations implements vscode.FileDecorationProvider, vscode.Disposable {
	private readonly changed = new vscode.EventEmitter<vscode.Uri | vscode.Uri[] | undefined>();
	readonly onDidChangeFileDecorations = this.changed.event;

	/** A file's path, resolved and lower-cased, → what the memory knows about it. */
	private known = new Map<string, Known>();
	/** The folders that sources being read live in, so a file of theirs that is not a page can be recognised. */
	private roots: string[] = [];
	private loadedAt = 0;
	private loading: Promise<void> | undefined;

	constructor(private readonly context: vscode.ExtensionContext) { }

	/** Rebuilds the index, joining a rebuild that is already running rather than starting a second one. */
	async load(): Promise<void> {
		if (this.loading !== undefined) {
			return this.loading;
		}
		this.loading = this.build().finally(() => { this.loading = undefined; });
		return this.loading;
	}

	private async build(): Promise<void> {
		let catalog: Catalog | undefined;
		try {
			catalog = await Catalog.open(this.context);
			const known = new Map<string, Known>();
			const roots: string[] = [];
			for (const row of catalog.sources()) {
				// A read over the API leaves a relative path — `docs/<id>.md` — which names no file on this machine.
				const source = catalog.source(row.slug);
				if (source === undefined || source.path === undefined) {
					continue;
				}
				roots.push(path.resolve(source.path));
				const parsed = source.lastRead === undefined ? NaN : Date.parse(source.lastRead);
				const readAt = Number.isNaN(parsed) ? undefined : parsed;
				for (const page of catalog.pagesFor(source.id)) {
					if (page.path === undefined || !path.isAbsolute(page.path)) {
						continue;
					}
					const file = path.resolve(page.path);
					let writtenAt: number;
					try {
						writtenAt = (await fs.stat(file)).mtimeMs;
					} catch {
						// The memory named a page whose file is gone. Saying nothing about it beats a badge that lies.
						continue;
					}
					known.set(file.toLowerCase(), { readAt, writtenAt });
				}
			}
			this.known = known;
			this.roots = roots;
		} catch {
			// No store, no badges: a tree that says nothing is better than one that says something untrue.
			this.known = new Map();
			this.roots = [];
		} finally {
			catalog?.close();
			this.loadedAt = Date.now();
		}
		this.changed.fire(undefined);
	}

	provideFileDecoration(uri: vscode.Uri): vscode.FileDecoration | undefined {
		if (uri.scheme !== 'file') {
			return undefined;
		}
		if (Date.now() - this.loadedAt > STALE_AFTER_MS) {
			void this.load();
		}
		const file = path.resolve(uri.fsPath);
		const entry = this.known.get(file.toLowerCase());
		if (entry !== undefined) {
			// A page read before it was written is a page whose file has moved on since: that is the `●`.
			return entry.readAt !== undefined && entry.writtenAt > entry.readAt ? CHANGED : READ;
		}
		return file.toLowerCase().endsWith('.md') && this.inside(file) ? STRANGER : undefined;
	}

	/** A file was written: its own row changes, and only its own. */
	async written(uri: vscode.Uri): Promise<void> {
		const file = path.resolve(uri.fsPath);
		const entry = this.known.get(file.toLowerCase());
		if (entry === undefined) {
			return;
		}
		try {
			entry.writtenAt = (await fs.stat(file)).mtimeMs;
		} catch {
			this.known.delete(file.toLowerCase());
		}
		this.changed.fire(uri);
	}

	/** Whether a path is inside a folder a read source lives in. */
	private inside(file: string): boolean {
		const lowered = file.toLowerCase();
		return this.roots.some((root) => {
			const base = path.resolve(root).toLowerCase();
			return lowered === base || lowered.startsWith(`${base}${path.sep}`);
		});
	}

	dispose(): void {
		this.changed.dispose();
	}
}

/**
 * Registers the badges for this window.
 *
 * Registered once, from the module that owns pages, and never per view: the Explorer is drawn by the workbench and the
 * Repositories panel by another module, and both show the same answer because both ask the same provider.
 */
export function registerPageDecorations(context: vscode.ExtensionContext): PageDecorations {
	const decorations = new PageDecorations(context);
	context.subscriptions.push(
		decorations,
		vscode.window.registerFileDecorationProvider(decorations),
		// Saving is the only file change this pass sees: a page written by a build or a `git pull` is picked up by the
		// index going stale rather than by a watcher, which would cost a watcher per source folder.
		vscode.workspace.onDidSaveTextDocument((document) => void decorations.written(document.uri))
	);
	void decorations.load();
	return decorations;
}
