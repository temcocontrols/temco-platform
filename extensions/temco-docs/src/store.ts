// What this module reads of the store.
//
// The store is a *different extension*: the platform's own memory, which this module neither owns nor opens with
// its own storage. Everything else here says exactly what the module said before the split — `Catalog.open`,
// the same `Catalog` shape, the same `CatalogUnavailable`, the same selection, the same slug rule — so a call
// site reads as it always did and only the import moved.
//
// Why the shapes are written out: an extension cannot import another extension's sources. This is the copy; the
// definition is `extensions/temco-store/src/catalog/store.ts` and `extensions/temco-store/src/api.ts`, and a
// change there is a change here.
//
// The store is a declared dependency (`extensionDependencies` in this module's manifest), so it is activated
// before this module's own entry runs and the exports are there when this file is evaluated.

import * as vscode from 'vscode';

/** The store module, by the id its manifest declares. */
const STORE_EXTENSION_ID = 'temcocontrols.temco-store';

/** The store's exports — the copy of `extensions/temco-store/src/api.ts`. */
interface StoreApi {
	available(): boolean;
	catalog(): Promise<Catalog>;
	readonly selection: Selection;
	slugOf(text: string): string;
}

const extension = vscode.extensions.getExtension<StoreApi>(STORE_EXTENSION_ID);
if (extension === undefined || !extension.isActive) {
	throw new Error('The Temco Store module is not available.');
}

const store = extension.exports;

/**
 * The platform's database, opened with the *store's* storage.
 *
 * The argument is accepted and ignored: a dozen call sites pass the extension context they happen to hold, and it
 * must not be used — a caller's own `globalStorageUri` is a different, empty database beside its own code.
 */
export const Catalog = {
	open: (_context?: vscode.ExtensionContext): Promise<Catalog> => store.catalog(),
};

/** Which project the window is on, and the page it last opened from it. */
export type Selection = SelectionShape;

/** The slug a name gets, as the database keys it. */
export const slugOf = store.slugOf;

/** The one selection instance for this window, published by the store so every module shares it. */
export const selection = store.selection;

/** The page the platform last opened from the selected project. */
export interface RememberedPage {
	project: string;
	id: string;
	title: string;
	path?: string;
}

/** The store's own selection shape — the copy of `extensions/temco-store/src/selection.ts`. */
interface SelectionShape {
	onDidChange(listener: () => void): vscode.Disposable;
	project(): string | undefined;
	page(): RememberedPage | undefined;
	select(slug: string | undefined): Promise<void>;
	rememberPage(page: RememberedPage | undefined): Promise<void>;
}

/** What `createDocument` needs. */
export interface DocumentInput {
	name: string;
	slug: string;
	version?: string;
	audience?: string;
	owner?: string;
}

/** A document as the edit page sees it. */
export interface DocumentDetail {
	name: string;
	version?: string;
	audience?: string;
	owner?: string;
	engine?: string;
	outputs: string[];
	sources: { name: string; kind: string; branch?: string }[];
}

/** A source's coordinates, as a read needs them. */
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
	/** When the source was last read, as the database stamped it — what a page's badge is measured against. */
	lastRead?: string;
}

/** A page as a read found it — enough for a tree, and nothing invented. */
export interface PageInput {
	id: string;
	path?: string;
	title?: string;
	owner?: string;
	counts?: Record<string, number>;
}

/** A page as a tree reads it back. */
export interface PageRow {
	id: string;
	path?: string;
	title?: string;
	owner?: string;
}

/** What `addSource` needs. Everything optional is genuinely optional: a folder has no branch. */
export interface SourceInput {
	kind: 'git' | 'folder' | 'archive';
	name: string;
	slug: string;
	remoteUrl?: string;
	path?: string;
	defaultBranch?: string;
	branch?: string;
	docsRoot?: string;
	registryPath?: string;
}

/** A row of the projects list. */
export interface DocumentRow {
	/** The name the database keys it by — what a selection, a draft and a build all point at. */
	slug: string;
	name: string;
	version?: string;
	sources: number;
	builtAt?: string;
}

/** A body that was drafted but not written. */
export interface DraftInput {
	documentSlug: string;
	/** The page id the page will have: `area/chapter/slug`. */
	pageId: string;
	title: string;
	kind?: string;
	body: string;
	source?: string;
}

/** A release: what was published, where it went, and when. */
export interface ReleaseRow {
	id: number;
	buildId?: number;
	version: string;
	destination: string;
	files: number;
	publishedAt: string;
}

/** One read of one source, as the repository page lists it. */
export interface ScanRow {
	id: number;
	at: string;
	mode: string;
	revision?: string;
	/** The counts the read reported, as JSON — left as it was written rather than reinterpreted here. */
	counts?: string;
}

/** A build as the Build Center reads it. */
export interface BuildRow {
	id: number;
	startedAt: string;
	finishedAt?: string;
	status: string;
	revision?: string;
}

/** A draft as the Review Center reads it. */
export interface DraftRow {
	id: number;
	documentSlug: string;
	source?: string;
	pageId: string;
	title: string;
	kind: string;
	body: string;
	createdAt: string;
	state: 'draft' | 'accepted' | 'discarded';
}

/** A row of the sources list. */
export interface SourceRow {
	id: number;
	slug: string;
	name: string;
	kind: string;
	branch?: string;
	pages?: number;
	/** What the last read concluded, in one line. */
	state?: string;
	lastReadMode?: string;
}

/** One person who posted in a topic. */
export interface ForumPoster {
	username: string;
	name?: string;
}

/** A forum category, as the site lists it. */
export interface ForumCategoryRow {
	id: number;
	slug: string;
	name: string;
	color?: string;
	parentId?: number;
	topics: number;
	posts: number;
	syncedAt?: string;
}

export interface ForumCategoryInput {
	id: number;
	slug: string;
	name: string;
	color?: string;
	parentId?: number;
	topics?: number;
	posts?: number;
	position?: number;
}

/** A topic as the forum's own list shows it. */
export interface ForumTopicRow {
	id: number;
	categoryId: number;
	slug: string;
	title: string;
	excerpt?: string;
	posts: number;
	replies: number;
	views: number;
	createdAt?: string;
	lastPostedAt?: string;
	pinned: boolean;
	closed: boolean;
	posters: ForumPoster[];
	syncedAt?: string;
}

export interface ForumTopicInput {
	id: number;
	categoryId: number;
	slug: string;
	title: string;
	excerpt?: string;
	posts?: number;
	replies?: number;
	views?: number;
	createdAt?: string;
	lastPostedAt?: string;
	pinned?: boolean;
	closed?: boolean;
	posters?: ForumPoster[];
}

/** One post — the discussion history a topic page reads. */
export interface ForumPostRow {
	id: number;
	topicId: number;
	postNumber: number;
	username?: string;
	name?: string;
	createdAt?: string;
	cooked?: string;
	replyTo?: number;
	syncedAt?: string;
}

export interface ForumPostInput {
	id: number;
	postNumber: number;
	username?: string;
	name?: string;
	createdAt?: string;
	cooked?: string;
	replyTo?: number;
}

/** What the platform proposes for a topic. */
export interface ForumSuggestionRow {
	topicId: number;
	pageId?: string;
	pageTitle?: string;
	text: string;
	/** `match` for what the registry alone can say, `ai` for an answer the model gave. */
	source: string;
	at: string;
}

export interface ForumSuggestionInput {
	topicId: number;
	pageId?: string;
	pageTitle?: string;
	text: string;
	source: string;
}

/** The platform's database, as this module uses it — the copy of `Catalog` in the store. */
export interface Catalog {
	/** Where the file is. */
	readonly file: vscode.Uri;
	counts(): [string, number][];
	schemaVersion(): number;
	documents(): DocumentRow[];
	sources(): SourceRow[];
	/** The reads of one source, newest first. */
	scans(slug: string): ScanRow[];
	unseenEvents(): number;
	addSource(source: SourceInput): number;
	removeSource(slug: string): void;
	recordScan(sourceId: number, mode: string, revision: string | undefined, counts: unknown): void;
	createDocument(document: DocumentInput): number;
	attachSource(documentSlug: string, sourceSlug: string, role?: string): void;
	documentSourceSlugs(documentSlug: string): string[];
	setDocumentSources(documentSlug: string, sourceSlugs: readonly string[]): void;
	documentSources(documentSlug: string): { name: string; kind: string; branch?: string }[];
	documentArtifacts(documentSlug: string): { kind: string; path: string; bytes?: number; builtAt: string }[];
	/** One target's output as the build left it: recorded, and the rows of that kind it no longer writes removed. */
	replaceArtifacts(documentSlug: string, kind: string, artifacts: readonly { path: string; bytes?: number; builtAt?: string }[], buildId?: number, alsoReplace?: readonly string[]): number;
	documentPages(documentSlug: string): (PageRow & { source: string })[];
	startBuild(documentSlug: string, revision?: string): number;
	finishBuild(buildId: number, status: string): void;
	/** The builds of one project, newest first — what the Build Center lists. */
	builds(documentSlug: string): BuildRow[];
	/** A build handed to a reader: recorded with its destination and the number of files it carried. */
	publishRelease(
		documentSlug: string,
		release: { version: string; destination: string; files: number; buildId?: number }
	): number;
	/** The releases of one project, newest first. */
	releases(documentSlug: string): ReleaseRow[];
	recordArtifact(
		documentSlug: string,
		artifact: { kind: string; path: string; bytes?: number; buildId?: number }
	): void;
	document(slug: string): DocumentDetail | undefined;
	setRecipe(slug: string, engine: string, outputs: string[]): void;
	/** Forgets a project. The row count is what tells a real delete from one that matched nothing. */
	deleteDocument(slug: string): number;
	source(slug: string): SourceDetail | undefined;
	setSourceBranch(slug: string, branch: string | undefined): void;
	setSourcePath(slug: string, path: string | undefined): void;
	setSourceState(
		slug: string,
		state: { pages?: number; docsRoot?: string; registryPath?: string; state?: string }
	): void;
	replacePages(sourceId: number, pages: PageInput[]): void;
	pagesFor(sourceId: number): PageRow[];
	/** A drafted body, waiting for a person. */
	saveDraft(input: DraftInput): number;
	/** The drafts of one project — waiting by default, which is what the Review Center lists. */
	drafts(documentSlug: string, state?: 'draft' | 'accepted' | 'discarded'): DraftRow[];
	draft(id: number): DraftRow | undefined;
	setDraftState(id: number, state: 'accepted' | 'discarded'): void;
	settleDrafts(documentSlug: string, pageId: string, state: 'accepted' | 'discarded'): void;
	// The forum, as a sync wrote it.
	forumCategories(): ForumCategoryRow[];
	saveForumCategories(rows: readonly ForumCategoryInput[]): void;
	forumTopics(categoryId?: number): ForumTopicRow[];
	saveForumTopics(rows: readonly ForumTopicInput[]): void;
	forumPosts(topicId: number): ForumPostRow[];
	saveForumPosts(topicId: number, rows: readonly ForumPostInput[]): void;
	forumSuggestion(topicId: number): ForumSuggestionRow | undefined;
	saveForumSuggestion(input: ForumSuggestionInput): void;
	forumSyncedAt(): string | undefined;
	/** What an AI answer named, kept so the citations can be read back later. */
	recordCitations(input: CitationInput): void;
	/** The citations the AI has used, newest first. */
	citations(limit?: number): CitationRow[];
	close(): void;
}

/** What one answer named, as `recordCitations` writes it. */
export interface CitationInput {
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
	citationKnown: boolean;
}
