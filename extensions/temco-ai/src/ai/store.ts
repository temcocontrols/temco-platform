// What this module reads of the store: the platform's memory, for one thing — what an answer cited.
//
// The store is a *different extension*: this module neither owns the database nor opens it with its own storage.
// Two methods are used and written out here, because an extension cannot import another extension's sources; the
// definition is `extensions/temco-store/src/catalog/store.ts`, and a change there is a change here.
//
// What is kept is deliberately narrow: the ids an answer named, and whether a registry knew them. The question and
// the answer stay in the panel and are not written down — a citation is a pointer, and a conversation is not
// something this platform keeps.

import * as vscode from 'vscode';

/** The store module, by the id its manifest declares. */
const STORE_EXTENSION_ID = 'temcocontrols.temco-store';

/** The store's exports — the copy of the part of `extensions/temco-store/src/api.ts` used here. */
interface StoreApi {
	catalog(): Promise<Catalog>;
	/** Where the platform's database lives, for the tool server that reads the same file. */
	databasePath(): string;
}

const extension = vscode.extensions.getExtension<StoreApi>(STORE_EXTENSION_ID);
if (extension === undefined || !extension.isActive) {
	throw new Error('The Temco Store module is not available.');
}

const store = extension.exports;

/** The platform's database, opened with the store's own storage. */
export const Catalog = {
	open: (): Promise<Catalog> => store.catalog(),
};

/** Where that database is on disk, asked of the module that owns it. */
export function catalogDatabasePath(): string {
	return store.databasePath();
}

/** The two things this module asks of the platform's memory. */
export interface Catalog {
	/** Writes what one answer cited. */
	recordCitations(input: CitationInput): void;
	/** The citations the AI has used, newest first. */
	citations(limit?: number): CitationRow[];
	close(): void;
}

/** What one answer named, as `recordCitations` writes it. */
export interface CitationInput {
	/** What produced the citation: `answer` in the panel, `topic` for a forum thread, `draft` for a page draft. */
	answerKind: string;
	documentSlug?: string;
	pageId?: string;
	citations: readonly { id: string; known: boolean }[];
}

/** One citation, as `citations()` reads it. */
export interface CitationRow {
	id: number;
	at: string;
	answerKind: string;
	documentSlug?: string;
	pageId?: string;
	citationId: string;
	/** Whether a registry knew the page when the answer was given. */
	citationKnown: boolean;
}
