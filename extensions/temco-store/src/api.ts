// What the store offers the rest of the platform.
//
// The store is the platform's own memory: one SQLite file it writes and reads for itself — which sources were
// read, what a project is made of, which pages came out of a read, what was built, and what happened. It is
// deliberately *not* `temco-sql`: that module is about the databases a **product** uses (registers, queries,
// export), and neither owns nor knows about this file.
//
// One window, one database, one selection — which is why this module opens the file itself rather than letting
// each caller open it with its own extension's storage. A caller that passed its own context would find an empty
// database beside its own code, and two `Selection` instances would not hear each other.
//
// The names are the store's too: a slug is what the tables are keyed by, so the rule that produces one belongs
// with the schema that assumes it.

import { DEFAULT_OUTPUTS, PROJECT_OUTPUTS, ProjectOutput, chosenOutputs, outputByKind, outputByValue, scriptFor } from './catalog/outputs';
import { Catalog, CatalogUnavailable } from './catalog/store';
import { Selection } from './selection';

/** What a project can be built into, and the rules for naming one — the one list three screens read. */
export interface ProjectOutputsApi {
	/** The five, in the order a person meets them. */
	readonly all: readonly ProjectOutput[];
	/** What a new project ticks. */
	readonly defaults: readonly string[];
	byValue(value: string): ProjectOutput | undefined;
	byKind(kind: string): ProjectOutput | undefined;
	chosen(stored: readonly string[]): ProjectOutput[];
	/** The script a build would run for this output here, or undefined when this repository has none of them. */
	scriptFor(output: ProjectOutput, scripts: Record<string, string> | readonly string[]): string | undefined;
}

export interface TemcoStoreApi {
	/** Whether this editor can hold the platform's memory at all (`node:sqlite`, Node 22.5+). */
	available(): boolean;
	/** The platform's database for this window. Opened per use, closed by the caller. */
	catalog(): Promise<Catalog>;
	/** Where that database lives, so another process can read the same file. */
	databasePath(): string;
	/** The error `catalog()` throws when `available()` is false — for `instanceof` at a call site. */
	readonly CatalogUnavailable: typeof CatalogUnavailable;
	/** Which project the window is on, and the page it last opened from it. One instance, one signal. */
	readonly selection: Selection;
	/** The slug a name gets, as the tables key it. */
	slugOf(text: string): string;
	/** What a project can be built into: the create form, Build Center and Publish & Releases read this one list. */
	readonly outputs: ProjectOutputsApi;
}

/** The object the store publishes as `outputs`, built from the one list. */
export const projectOutputs: ProjectOutputsApi = {
	all: PROJECT_OUTPUTS,
	defaults: DEFAULT_OUTPUTS,
	byValue: outputByValue,
	byKind: outputByKind,
	chosen: chosenOutputs,
	scriptFor
};
