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

import { Catalog, CatalogUnavailable } from './catalog/store';
import { Selection } from './selection';

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
}
