// What this module offers the rest of the platform.
//
// The documentation module publishes its model rather than letting another module read its folders: the sets it
// is reading, the pages of a set, the page a file belongs to, the editor column its surfaces open in, and the
// selection — the one piece of state the whole application agrees on. The AI module is the caller today, and it
// declares this extension as a dependency so that these exports exist before its own `activate()` runs.
//
// The shapes are spelled twice, once here and once in the caller: an extension cannot import another
// extension's sources. This file is the definition; the caller's `src/docs.ts` is the copy, and a change here is
// a change there.

import * as vscode from 'vscode';
import type { Landed } from './attachments';
import { Counts, DocsRoot, PageEntry } from './registry';
import { Selection } from './store';

/** A page in the set a file belongs to, for a link a relative path can reach. */
export interface LinkablePage {
	title: string;
	id: string;
	/** The file's place on disk, which is what a relative link is computed from. */
	fsPath: string;
}

export interface TemcoDocsApi {
	/** The documentation sets being read. */
	roots(): readonly DocsRoot[];
	/** Every page of a set, in reading order. */
	collectPages(root: DocsRoot): PageEntry[];
	/** How many of these pages the generator says are stale. */
	countStale(pages: readonly PageEntry[]): number;
	/** The sums over the sets: pages, issues, errors, warnings, never reviewed, unshipped. */
	totals(roots: readonly DocsRoot[]): Counts;
	/** The page a file belongs to, in any of the sets. */
	pageForUri(roots: readonly DocsRoot[], uri: vscode.Uri): PageEntry | undefined;
	/** Which of the repository's own scripts the folders being read carry. */
	scriptsIn(roots: readonly DocsRoot[]): Set<string>;
	/** The project and page the window is on. */
	selection: Selection;
	/** The editor column a documentation surface opens in. */
	pageColumn(): vscode.ViewColumn;
	/** Re-reads the sets. What a refresh button anywhere in the application ends up asking for. */
	refresh(): Promise<void>;
	/** Fires when the sets are re-read: a page added, a project selected, a registry changed. */
	onDidChange(listener: () => void): vscode.Disposable;
	/**
	 * Puts one image beside its page and records what it is.
	 *
	 * The editor writes pages but does not own their folders: the `media/` directory, the file name, the attachment record
	 * and the version the picture applies to all belong to the model that reads the page tree. The caller supplies the
	 * bytes and the words; this decides where they land.
	 */
	landImage(
		pageFsPath: string,
		bytes: Uint8Array,
		fallbackExtension: string,
		caption: string
	): Promise<Landed | { error: string }>;
	/** Records the words for an image that landed without them. Words only; nothing moves. */
	setCaption(pageFsPath: string, name: string, caption: string): Promise<void>;
	/** The pages of the set this file is in, in reading order. Empty when the file is in no set being read. */
	pagesNear(pageFsPath: string): LinkablePage[];
	/**
	 * The folders a page's own files may come from: its own, and the folders above it up to the documentation root.
	 *
	 * A webview is given these as `localResourceRoots`. Without them a page's `../media/…` is outside the one folder
	 * the panel was allowed to read, so the loader refuses it: the picture shows as a broken image and nothing is
	 * logged to say why.
	 */
	pageRoots(pageFsPath: string): readonly string[];
}
