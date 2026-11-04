// What this module reads of the store.
//
// The store is a *different extension*: the platform's own memory, which this module neither owns nor opens with
// its own storage. `Catalog.open(context)` accepts the context it is handed and ignores it — the file is the
// store's, and a caller's own storage would be an empty database beside its own code.
//
// Why the shapes are written out: an extension cannot import another extension's sources. The definition is
// `extensions/temco-store/src/catalog/store.ts` and `extensions/temco-store/src/api.ts`, and a change there is a
// change here. The store is a declared dependency, so it is activated before this module's entry runs.

import * as vscode from 'vscode';

/** The store module, by the id its manifest declares. */
const STORE_EXTENSION_ID = 'temcocontrols.temco-store';

/** The store's exports — the copy of `extensions/temco-store/src/api.ts`. */
interface StoreApi {
	catalog(): Promise<Catalog>;
	readonly CatalogUnavailable: new (...args: never[]) => Error;
	readonly selection: Selection;
	slugOf(text: string): string;
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

/** The one selection instance for this window, published by the store so every module shares it. */
export const selection = store.selection;

/** The store's own selection shape — the copy of `extensions/temco-store/src/selection.ts`. */
interface SelectionShape {
	project(): string | undefined;
	page(): { project: string; id: string; title: string; path?: string } | undefined;
	select(slug: string | undefined): Promise<void>;
	rememberPage(page: { project: string; id: string; title: string; path?: string } | undefined): Promise<void>;
}

/** A page as a read found it. */
export interface PageInput {
	id: string;
	path?: string;
	title?: string;
	owner?: string;
	counts?: Record<string, number>;
}

/** What `addSource` needs. */
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
	/** When this source was last read: what the dashboard measures "since" against. */
	lastRead?: string;
}

/** A project row, as the store lists them — enough to say which projects cite a source. */
export interface DocumentRow {
	slug: string;
	name: string;
	/** How many sources the project cites. */
	sources: number;
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
	/** When the last read happened — the watermark "since the last read" is measured against. */
	lastRead?: string;
	lastReadMode?: string;
}

/** Where repositories come from: an organisation, a personal account, or one repository's address. */
export type OrganisationKind = 'organisation' | 'account' | 'repository';

/** What adding one writes — the copy of `OrganisationInput` in the store. */
export interface OrganisationInput {
	kind: OrganisationKind;
	name: string;
	slug: string;
	url?: string;
}

/** An organisation as the page and the panel list it. */
export interface OrganisationRow {
	id: number;
	kind: string;
	name: string;
	slug: string;
	url?: string;
	lastRead?: string;
	state?: string;
	repositories: number;
}

/** One repository as the cache holds it — the facts a row shows, and the two addresses an action needs. */
export interface RepositoryCacheRow {
	name: string;
	fullName: string;
	description?: string;
	language?: string;
	pushedAt?: string;
	isPrivate: boolean;
	webUrl?: string;
	cloneUrl?: string;
	defaultBranch?: string;
}

/** The platform's database, as this module uses it — the copy of `Catalog` in the store. */
export interface Catalog {
	readonly file: vscode.Uri;
	sources(): SourceRow[];
	/** The projects, as the store lists them. */
	documents(): DocumentRow[];
	addSource(source: SourceInput): number;
	removeSource(slug: string): void;
	source(slug: string): SourceDetail | undefined;
	document(slug: string):
		| { name: string; version?: string; outputs: string[]; sources: { name: string; kind: string; branch?: string }[] }
		| undefined;
	documentSourceSlugs(documentSlug: string): string[];
	documentSources(documentSlug: string): { name: string; kind: string; branch?: string }[];
	setDocumentSources(documentSlug: string, sourceSlugs: readonly string[]): void;
	setSourceBranch(slug: string, branch: string | undefined): void;
	setSourcePath(slug: string, path: string | undefined): void;
	setSourceState(
		slug: string,
		state: { pages?: number; docsRoot?: string; registryPath?: string; state?: string }
	): void;
	recordScan(sourceId: number, mode: string, revision: string | undefined, counts: unknown): void;
	/** Where repositories come from — an organisation, an account, or one repository's address. */
	organisations(): OrganisationRow[];
	addOrganisation(input: OrganisationInput): number;
	removeOrganisation(slug: string): void;
	recordOrganisationRead(slug: string, state: string): void;
	/** The repositories an organisation holds, as the last good read found them. */
	repositoriesOf(slug: string): RepositoryCacheRow[];
	replaceRepositories(slug: string, repositories: readonly RepositoryCacheRow[]): void;
	replacePages(sourceId: number, pages: PageInput[]): void;
	close(): void;
}
