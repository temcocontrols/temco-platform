/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

// The platform's memory, on a real database.
//
// Everything the platform knows — which projects exist, what they are built from, how they are built, which pages each
// source holds — lives in one SQLite file that `node:sqlite` opens. It is the one place where a wrong answer is
// expensive: a project keyed by the name as typed instead of the slug is a project that exists and cannot be found,
// and a link that outlives the project it belongs to is a build pointed at nothing.
//
// So this opens the real catalog against a throwaway folder: no stub of the store, only a stub of the editor around it.
// The database is a temp file, closed and reopened, and its own `sqlite_master`-driven counts are used to prove that a
// delete removed rows rather than reporting success over a project still in the table.

import assert from 'node:assert/strict';
import { existsSync, mkdirSync, mkdtempSync, rmSync } from 'node:fs';
import { createRequire, Module } from 'node:module';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { suite, standalone } from './harness.mts';

const here = fileURLToPath(new URL('../..', import.meta.url));
const load = createRequire(import.meta.url);
const out = (...parts: string[]): string => join(here, 'extensions', ...parts, 'out');

if (!existsSync(out('temco-store'))) {
	throw new Error('the extensions are not compiled — run `npm run test-temco`, which compiles before it tests.');
}

/** The little of a `Uri` the store touches, with real paths so the database file is really made. */
interface FakeUri {
	scheme: string;
	fsPath: string;
	path: string;
}

const uriOf = (fsPath: string): FakeUri => ({ scheme: 'file', fsPath, path: fsPath.replace(/\\/g, '/') });

const vscode = {
	Uri: {
		file: uriOf,
		joinPath: (base: FakeUri, ...parts: string[]) => uriOf(join(base.fsPath, ...parts))
	},
	workspace: {
		fs: {
			createDirectory: async (uri: FakeUri) => {
				mkdirSync(uri.fsPath, { recursive: true });
			},
			stat: async (uri: FakeUri) => {
				if (!existsSync(uri.fsPath)) {
					throw new Error(`${uri.fsPath} is not there`);
				}
				return {};
			}
		},
		getConfiguration: () => ({ get: () => undefined, update: async () => undefined })
	}
};

const editorLoad = Module._load;
Module._load = function (request: string, parent: unknown, isMain: boolean): unknown {
	if (request === 'vscode') {
		return vscode;
	}
	return editorLoad.call(this, request, parent, isMain) as unknown;
};

interface CatalogDetail {
	name: string;
	version?: string;
	origin?: string;
	engine?: string;
	outputs: string[];
	sources: { name: string; kind: string }[];
}

interface Catalog {
	createDocument(document: { name: string; slug: string; version?: string; origin?: string }): number;
	documents(): { name: string; slug: string }[];
	document(slug: string): CatalogDetail | undefined;
	deleteDocument(slug: string): number;
	addSource(source: { kind: 'git' | 'folder' | 'archive'; name: string; slug: string; path?: string }): number;
	attachSource(documentSlug: string, sourceSlug: string): void;
	setDocumentSources(documentSlug: string, sourceSlugs: readonly string[]): void;
	documentSourceSlugs(documentSlug: string): string[];
	setRecipe(slug: string, engine: string, outputs: string[]): void;
	replacePages(sourceId: number, pages: { id: string; title?: string }[]): void;
	documentPages(slug: string): { id: string; source: string }[];
	counts(): [string, number][];
	schemaVersion(): number;
	expectedSchemaVersion(): number;
	integrity(): string;
	close(): void;
}

interface StoreModule {
	Catalog: { open(context: { globalStorageUri: FakeUri }): Promise<Catalog> };
}

const store = load(join(out('temco-store'), 'catalog', 'store.js')) as StoreModule;

/** A catalog in a throwaway folder, and the folder to delete afterwards. */
async function opened(folder: string): Promise<Catalog> {
	mkdirSync(folder, { recursive: true });
	return store.Catalog.open({ globalStorageUri: uriOf(folder) });
}

async function withCatalog(run: (catalog: Catalog, folder: string) => Promise<void>): Promise<void> {
	const folder = mkdtempSync(join(tmpdir(), 'temco-store-'));
	const catalog = await opened(folder);
	try {
		await run(catalog, folder);
	} finally {
		catalog.close();
		rmSync(folder, { recursive: true, force: true });
	}
}

const project = (name: string, slug: string) => ({ name, slug, version: '1.0', origin: 'blank' });

const group = suite();
const test = (name: string, run: () => Promise<void> | void): void => group.test(name, run);

// ---------- the memory ----------

test('a project is keyed by its slug, so a second spelling of the name updates the first', async () => {
	await withCatalog(async catalog => {
		catalog.createDocument(project('T3000 Platform', 't3000-platform'));
		catalog.createDocument(project('T3000 platform', 't3000-platform'));
		const written = catalog.documents();
		assert.equal(written.length, 1, 'one project, not two rows that look like two projects');
		assert.equal(written[0].name, 'T3000 platform', 'the later name wins, because it is the one on screen');
	});
});

test('what a project is built from and how it is built are read back together', async () => {
	await withCatalog(async catalog => {
		catalog.addSource({ kind: 'git', name: 'temco-docs', slug: 'temco-docs', path: 'D:/work/temco-docs' });
		catalog.createDocument(project('T3000 Platform', 't3000-platform'));
		catalog.attachSource('t3000-platform', 'temco-docs');
		catalog.setRecipe('t3000-platform', 'docfx', ['website', 'pdf']);

		const detail = catalog.document('t3000-platform');
		assert.ok(detail !== undefined);
		assert.deepEqual(
			{ engine: detail.engine, outputs: detail.outputs, sources: detail.sources.map(source => source.name) },
			{ engine: 'docfx', outputs: ['website', 'pdf'], sources: ['temco-docs'] }
		);
	});
});

test('the ticks are the truth: a source nobody ticked stops being cited', async () => {
	await withCatalog(async catalog => {
		catalog.addSource({ kind: 'folder', name: 'Docs A', slug: 'docs-a' });
		catalog.addSource({ kind: 'folder', name: 'Docs B', slug: 'docs-b' });
		catalog.createDocument(project('T3000', 't3000'));

		catalog.setDocumentSources('t3000', ['docs-a', 'docs-b']);
		assert.deepEqual(catalog.documentSourceSlugs('t3000'), ['docs-a', 'docs-b']);

		catalog.setDocumentSources('t3000', ['docs-b']);
		assert.deepEqual(catalog.documentSourceSlugs('t3000'), ['docs-b'], 'the untick is a delete, not a leftover row');
	});
});

test('a removal that matched no row says zero, and a real one says one', async () => {
	await withCatalog(async catalog => {
		assert.equal(catalog.deleteDocument('nothing-here'), 0, 'a delete that did nothing must not look like success');
		catalog.createDocument(project('T3000', 't3000'));
		assert.equal(catalog.deleteDocument('t3000'), 1);
		assert.equal(catalog.document('t3000'), undefined);
	});
});

test('a project takes its source links with it', async () => {
	await withCatalog(async catalog => {
		catalog.addSource({ kind: 'folder', name: 'Docs', slug: 'docs' });
		catalog.createDocument(project('T3000', 't3000'));
		catalog.attachSource('t3000', 'docs');
		catalog.setRecipe('t3000', 'docfx', ['website']);

		catalog.deleteDocument('t3000');

		const counted = new Map(catalog.counts());
		assert.equal(counted.get('documents'), 0);
		assert.equal(counted.get('doc_sources'), 0, 'the link went with the project, by foreign key');
		assert.equal(counted.get('recipes'), 0);
		assert.equal(counted.get('sources'), 1, 'the source is not the project\'s to delete: something else may cite it');
	});
});

test('a source\'s page list is replaced, never appended to', async () => {
	await withCatalog(async catalog => {
		const id = catalog.addSource({ kind: 'folder', name: 'Docs', slug: 'docs' });
		catalog.createDocument(project('T3000', 't3000'));
		catalog.attachSource('t3000', 'docs');

		catalog.replacePages(id, [{ id: 'intro', title: 'Intro' }, { id: 'trendlogs', title: 'Trend Logs' }]);
		assert.deepEqual(catalog.documentPages('t3000').map(page => page.id).sort(), ['intro', 'trendlogs']);

		catalog.replacePages(id, [{ id: 'intro', title: 'Intro' }]);
		assert.deepEqual(catalog.documentPages('t3000').map(page => page.id), ['intro'], 'a second read is the whole truth');
	});
});

test('the catalog outlives the handle that wrote it', async () => {
	const folder = mkdtempSync(join(tmpdir(), 'temco-store-'));
	try {
		const first = await opened(folder);
		first.createDocument(project('T3000 Platform', 't3000-platform'));
		first.close();

		const second = await opened(folder);
		try {
			assert.deepEqual(second.documents().map(row => row.slug), ['t3000-platform'], 'a project is not a session');
		} finally {
			second.close();
		}
	} finally {
		rmSync(folder, { recursive: true, force: true });
	}
});

test('the file is the schema this build expects, and it is sound', async () => {
	await withCatalog(async catalog => {
		assert.equal(catalog.schemaVersion(), catalog.expectedSchemaVersion());
		assert.equal(catalog.integrity(), 'ok');
		assert.ok(
			new Map(catalog.counts()).has('documents'),
			'the counts come from the database itself, so the tables really exist'
		);
	});
});

// ---------- the cases ----------

await standalone(import.meta.url, group.cases, 'the real catalog, in a throwaway folder');
