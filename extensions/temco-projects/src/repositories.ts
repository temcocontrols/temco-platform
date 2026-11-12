// What this module reads of the repositories module.
//
// Two things, and one idea behind both: a source's **files**. A listing, so a project starting from a repository can
// offer what that repository already documents and what code a page could be written from; and the text of the files
// a person ticked, within one budget, so a draft is grounded in what they chose rather than in a whole repository.
//
// Why the shape is written out: an extension cannot import another extension's sources. The definition is
// `extensions/temco-repositories/src/repository.ts` and `extensions/temco-repositories/src/extension.ts`.
// Repositories is a declared dependency, so it is activated before this module's entry runs.

import * as vscode from 'vscode';

/** The repositories module, by the id its manifest declares. */
const REPOSITORIES_EXTENSION_ID = 'temcocontrols.temco-repositories';

/** One script of the repository's own documentation work that this application is willing to run. */
export interface OfferedScript {
	id: string;
	label: string;
	detail: string;
}

/** A source, as the store records it — enough to find its files, on disk or through the API. */
export interface RepositorySource {
	name: string;
	path?: string;
	remoteUrl?: string;
	branch?: string;
	defaultBranch?: string;
}

/** One file of a source: its path from the source's root, and roughly what it costs to read. */
export interface RepositoryFile {
	path: string;
	size: number;
}

/** Several files' text, within a budget: what a draft is given, and what was left out. */
export interface RepositoryMaterial {
	text: string;
	included: string[];
	skipped: string[];
	characters: number;
}

/** The repositories module's exports — the copy of `extensions/temco-repositories/src/extension.ts`. */
interface TemcoRepositoriesApi {
	readonly offeredScripts: readonly OfferedScript[];
	tree(source: RepositorySource): Promise<{ files: RepositoryFile[]; note?: string } | { error: string }>;
	readMaterials(source: RepositorySource, files: readonly string[], limit?: number): Promise<RepositoryMaterial>;
	projectsRoot(): string;
}

const extension = vscode.extensions.getExtension<TemcoRepositoriesApi>(REPOSITORIES_EXTENSION_ID);
if (extension === undefined || !extension.isActive) {
	throw new Error('The Temco Repositories module is not available.');
}

const api = extension.exports;

/** The repository's own documentation scripts: a vocabulary, not a runner. */
export const OFFERED_SCRIPTS: readonly OfferedScript[] = api.offeredScripts;

/** Every file a source carries — documentation as well as code — or the sentence that stopped it. */
export const repositoryFiles = (
	source: RepositorySource
): Promise<{ files: RepositoryFile[]; note?: string } | { error: string }> => api.tree(source);

/** The text of the files a person ticked, within one budget. */
export const repositoryMaterial = (
	source: RepositorySource,
	files: readonly string[],
	limit?: number
): Promise<RepositoryMaterial> => api.readMaterials(source, files, limit);

/**
 * The folder projects are made in — the repositories module owns the rule, this module only asks.
 *
 * A project that exists on disk but not in the catalog is found by looking here, so the answer has to be the same
 * one the create form used. It is a path and nothing more: nothing is created by asking.
 */
export const projectsRoot = (): string => api.projectsRoot();
