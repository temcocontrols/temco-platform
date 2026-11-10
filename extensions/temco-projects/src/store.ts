// What this module reads of the store.
//
// The store is a *different extension*: the platform's own memory, which this module neither owns nor opens with
// its own storage. `Catalog.open(context)` accepts the context it is handed and ignores it — the file is the
// store's, and a caller's own storage would be an empty database beside its own code.
//
// Why the shapes are written out: an extension cannot import another extension's sources. The definition is
// `extensions/temco-store/src/catalog/store.ts` and `extensions/temco-store/src/api.ts`, and a change there is a
// change here. The store is a declared dependency, so it is activated before this module's entry runs.
//
// The table is still called `documents` and the methods still say `document`: a project is what that row is, and
// renaming it would be a migration for a word. A person never sees the word.

import * as vscode from 'vscode';

/** The store module, by the id its manifest declares. */
const STORE_EXTENSION_ID = 'temcocontrols.temco-store';

/** The store's exports — the copy of `extensions/temco-store/src/api.ts`. */
interface StoreApi {
	catalog(): Promise<Catalog>;
	readonly CatalogUnavailable: new (...args: never[]) => Error;
	readonly selection: Selection;
	slugOf(text: string): string;
	readonly outputs: OutputsApi;
}

const extension = vscode.extensions.getExtension<StoreApi>(STORE_EXTENSION_ID);
if (extension === undefined || !extension.isActive) {
	throw new Error('The Temco Store module is not available.');
}

const store = extension.exports;

/** The platform's database, opened with the store's storage. The argument is accepted and ignored. */
export const Catalog = {
	open: (_context?: vscode.ExtensionContext): Promise<Catalog> => store.catalog(),
};

/** The error `Catalog.open` throws when this editor has no `node:sqlite`. */
export const CatalogUnavailable = store.CatalogUnavailable;

/** Which project the window is on, and the page it last opened from it. */
export type Selection = SelectionShape;

/** The slug a name gets, as the database keys it. */
export const slugOf = store.slugOf;

/**
 * What a project can be built into: the create form's ticks, the build that runs per tick, and the release page's
 * categories are the one list the store publishes, rather than three copies that drift.
 */
export const outputs = store.outputs;

/** One output, as the store describes it — the copy of `extensions/temco-store/src/catalog/outputs.ts`. */
export interface OutputsApi {
	readonly all: readonly Output[];
	readonly defaults: readonly string[];
	byValue(value: string): Output | undefined;
	byKind(kind: string): Output | undefined;
	chosen(stored: readonly string[]): Output[];
	/** The script a build would run for this output here, or undefined when this repository has none of them. */
	scriptFor(output: Output, scripts: readonly string[]): string | undefined;
}

/** What one output is called, how it is recorded, and which scripts a repository needs to make it. */
export interface Output {
	value: string;
	kind: string;
	label: string;
	mark: string;
	purpose: string;
	scripts: readonly string[];
	madeBy?: string;
}

/** The one selection instance for this window, published by the store so every module shares it. */
export const selection = store.selection;

/** The store's own selection shape — the copy of `extensions/temco-store/src/selection.ts`. */
interface SelectionShape {
	onDidChange(listener: () => void): vscode.Disposable;
	project(): string | undefined;
	select(slug: string | undefined): Promise<void>;
}

/** What `createDocument` needs. */
export interface DocumentInput {
	name: string;
	slug: string;
	version?: string;
	audience?: string;
	owner?: string;
	/** How the project began — `blank`, `template`, `folder`, `repository` or `import`. */
	origin?: string;
	/** The starter the project's files were written from, when there was one. */
	template?: string;
}

/** A project as the edit page sees it. */
export interface DocumentDetail {
	name: string;
	version?: string;
	audience?: string;
	owner?: string;
	origin?: string;
	template?: string;
	engine?: string;
	outputs: string[];
	sources: { name: string; kind: string; branch?: string }[];
}

/** A source's coordinates, as this module needs them. */
export interface SourceDetail {
	id: number;
	kind: 'git' | 'folder' | 'archive';
	name: string;
	remoteUrl?: string;
	path?: string;
	branch?: string;
	defaultBranch?: string;
	docsRoot?: string;
	registryPath?: string;
}

/** A source as a list reads it back. */
export interface SourceRow {
	id: number;
	slug: string;
	name: string;
	kind: string;
	branch?: string;
	pages?: number;
	state?: string;
	lastReadMode?: string;
}

/** A row of the projects list. */
export interface DocumentRow {
	/** The name the database keys it by — what a selection, a draft and a build all point at. */
	slug: string;
	name: string;
	version?: string;
	origin?: string;
	sources: number;
	builtAt?: string;
}

/** A page as a read found it. */
export interface PageRow {
	id: string;
	path?: string;
	title?: string;
	owner?: string;
}

/** The platform's database, as this module uses it — the copy of `Catalog` in the store. */
export interface Catalog {
	readonly file: vscode.Uri;
	documents(): DocumentRow[];
	sources(): SourceRow[];
	document(slug: string): DocumentDetail | undefined;
	source(slug: string): SourceDetail | undefined;
	createDocument(document: DocumentInput): number;
	/** Forgets a project. The row count is what tells a real delete from one that matched nothing. */
	deleteDocument(slug: string): number;
	attachSource(documentSlug: string, sourceSlug: string, role?: string): void;
	documentSourceSlugs(documentSlug: string): string[];
	documentSources(documentSlug: string): { name: string; kind: string; branch?: string }[];
	setDocumentSources(documentSlug: string, sourceSlugs: readonly string[]): void;
	documentPages(documentSlug: string): (PageRow & { source: string })[];
	documentArtifacts(documentSlug: string): { kind: string; path: string; bytes?: number; builtAt: string }[];
	/** One target's output as the build left it: recorded, and the rows of that kind it no longer writes removed. */
	replaceArtifacts(documentSlug: string, kind: string, artifacts: readonly { path: string; bytes?: number; builtAt?: string }[], buildId?: number, alsoReplace?: readonly string[]): number;
	addSource(source: {
		kind: 'git' | 'folder' | 'archive';
		name: string;
		slug: string;
		remoteUrl?: string;
		path?: string;
		defaultBranch?: string;
		branch?: string;
	}): number;
	setRecipe(slug: string, engine: string, outputs: string[]): void;
	/**
	 * Records a page's text without writing it anywhere: the row a project's first page starts as.
	 *
	 * `pageId` is the id the page *will* have (`area/chapter/slug`), so a draft is recognisable before it exists on
	 * disk and two drafts for one page can be told apart.
	 */
	saveDraft(draft: {
		documentSlug: string;
		source?: string;
		pageId: string;
		title: string;
		kind?: string;
		body: string;
	}): number;
	/** The drafts a project holds in one state — `draft` unless asked otherwise. */
	drafts(documentSlug: string, state?: 'draft' | 'accepted' | 'discarded'): {
		id: number;
		documentSlug: string;
		source?: string;
		pageId: string;
		title: string;
		kind: string;
		body: string;
		createdAt: string;
		state: string;
	}[];
	/** Marks a draft written or discarded. The row is kept, so the act leaves a trace. */
	setDraftState(id: number, state: 'accepted' | 'discarded'): void;
	/** Where repositories come from — an enterprise, an account, or one repository's address. */
	organisations(): {
		id: number;
		kind: string;
		name: string;
		slug: string;
		url?: string;
		lastRead?: string;
		state?: string;
		repositories: number;
	}[];
	/** The repositories an organisation holds, as the last good read found them — the cache, not the truth. */
	repositoriesOf(slug: string): {
		name: string;
		fullName: string;
		description?: string;
		language?: string;
		pushedAt?: string;
		isPrivate: boolean;
		webUrl?: string;
		cloneUrl?: string;
		defaultBranch?: string;
	}[];
	startBuild(documentSlug: string, revision?: string): number;
	finishBuild(buildId: number, status: string): void;
	recordArtifact(
		documentSlug: string,
		artifact: { kind: string; path: string; bytes?: number; buildId?: number }
	): void;
	close(): void;
}
