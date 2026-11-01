// The panel's own contract: five views, names only, and the number at the row's right edge.
//
// A tree row has two slots — the label and the thing pushed to its right edge — and this module promised to use them the
// way Home does: never a sentence in a row, and the one extra fact is a number, drawn as a badge. Each case below is that
// promise, per view, against one snapshot.

import assert from 'node:assert/strict';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { createRequire, Module } from 'node:module';
import { fileURLToPath } from 'node:url';

interface Row {
	label?: string;
	description?: string;
	collapsibleState?: number;
	iconPath?: { id: string; color?: unknown };
	resourceUri?: { scheme?: string; path?: string; query?: string; toString(): string };
	command?: { command: string; arguments?: unknown[] };
	tooltip?: unknown;
	contextValue?: string;
}

interface Decorations {
	provideFileDecoration(uri: { scheme: string; path: string }): { badge?: string; color?: unknown } | undefined;
}

interface Views {
	Reads: new (read: () => Promise<unknown>) => unknown;
	OverviewTree: new () => { getChildren(item?: Row): Promise<Row[]> };
	BrowseTree: new (reads: unknown, site: () => { state: string; mode?: string; url?: string; reason?: string }) => { getChildren(item?: Row): Promise<Row[]> };
	DownloadTree: new (reads: unknown) => { getChildren(item?: Row): Promise<Row[]> };
	TodoTree: new (reads: unknown) => { getChildren(item?: Row): Promise<Row[]> };
	badgeRow(text: string, key: string, tone?: 'ok' | 'warn' | 'err' | 'info'): Row['resourceUri'];
	badgeDecoration(uri: { scheme: string; path: string; query?: string }): { badge?: string; color?: unknown } | undefined;
	VIEWS: Record<string, string>;
}

class TreeItem {
	label?: string;
	collapsibleState?: number;
	iconPath?: { id: string; color?: unknown };
	resourceUri?: { scheme?: string; path?: string; query?: string; toString(): string };
	command?: { command: string };
	id?: string;
	tooltip?: string;
	contextValue?: string;
	constructor(label?: string, collapsibleState?: number) {
		this.label = label;
		this.collapsibleState = collapsibleState;
	}
}

/** A clone of the site repository that `repoReady` accepts, without a git history behind it. */
const siteClone = fs.mkdtempSync(path.join(os.tmpdir(), 'temco-learn-clone-'));
fs.writeFileSync(path.join(siteClone, 'package.json'), '{}');
fs.mkdirSync(path.join(siteClone, 'content'), { recursive: true });
fs.writeFileSync(path.join(siteClone, 'content', 'sections.json'), '[]');

/** Where the module is told the clone is; one case moves it somewhere that is not the site. */
let repoSetting = siteClone;

const vscode = {
	TreeItem,
	TreeItemCollapsibleState: { None: 0, Collapsed: 1, Expanded: 2 },
	ThemeIcon: class {
		id: string;
		color: unknown;
		constructor(id: string, color?: unknown) {
			this.id = id;
			this.color = color;
		}
	},
	ThemeColor: class {
		id: string;
		constructor(id: string) {
			this.id = id;
		}
		toString(): string {
			return this.id;
		}
	},
	EventEmitter: class {
		event = () => ({ dispose() { } });
		fire() { }
		dispose() { }
	},
	Uri: {
		parse: (value: string) => {
			const [withoutQuery, query] = value.split('?');
			const colon = withoutQuery.indexOf(':');
			return {
				scheme: withoutQuery.slice(0, colon),
				path: withoutQuery.slice(colon + 1),
				query: query ?? '',
				toString: () => value
			};
		},
		from: (parts: { scheme: string; path: string }) => ({ ...parts, query: '', toString: () => `${parts.scheme}:${parts.path}` })
	},
	workspace: {
		workspaceFolders: [],
		getConfiguration: (section?: string) => ({
			get: (key: string) => (section === 'temcoLearn' && key === 'siteRepo' ? repoSetting : undefined)
		})
	},
	extensions: { getExtension: () => ({ isActive: true, exports: {} }) },
	window: { registerFileDecorationProvider: () => ({ dispose() { } }) }
};

const load = Module._load;
Module._load = function (request: string, parent: unknown, isMain: boolean) {
	if (request === 'vscode') {
		return vscode;
	}
	return load.call(this as unknown as NodeModule, request, parent, isMain);
};

const views = createRequire(import.meta.url)(fileURLToPath(new URL('../out/tree.js', import.meta.url))) as Views;

/** The grey words a row writes beside its name. */
const count = (row: Row): string => row.description ?? '';

const now = Date.now();
const snapshot = {
	site: {
		projects: [
			{ id: 't3000', title: 'T3000', section: 'documentation', versions: [{ version: '13.0', builtAt: new Date(now - 7200e3).toISOString(), pages: [{ href: 'a', title: 'A' }, { href: 'b', title: 'B' }] }, { version: '12.9', builtAt: new Date(now - 5 * 86400e3).toISOString(), pages: [{ href: 'c', title: 'C' }] }] },
			{ id: 'bacnet', title: 'BACnet', section: 'documentation', versions: [{ version: '4.2', builtAt: new Date(now - 86400e3).toISOString(), pages: [{ href: 'd', title: 'D' }] }] }
		]
	},
	builds: [{ folder: 'C:/Temco/nettools/dist/site', title: 'NetTools', id: 'nettools', at: now }],
	artifacts: [
		{
			title: 'T3000', id: 't3000', folder: 'C:/Temco/t3000', builtAt: new Date(now - 7200e3).toISOString(),
			artifacts: [
				{ kind: 'site', file: 'C:/Temco/t3000/dist/site', label: 'the website', opens: 'editor', size: undefined, at: now },
				{ kind: 'chm', file: 'C:/Temco/HelpDocs/T3000.chm', label: 'offline help', opens: 'external', size: 1153434, at: now },
				{ kind: 'zip', file: 'C:/Temco/t3000/dist/T3000-site.zip', label: 'an archive', opens: undefined, size: 4404019, at: now }
			]
		}
	],
	published: { where: 'temcocontrols/docs', base: 'https://temcocontrols.github.io/docs/', commit: '6f2c1ab', at: new Date(now - 12 * 60e3).toISOString(), pending: 3 }
};

const cleanState = {
	...snapshot,
	builds: [],
	published: { ...snapshot.published, pending: 0 }
};

const cases: { name: string; run: () => Promise<void> }[] = [];
const test = (name: string, run: () => Promise<void>) => cases.push({ name, run });

const newReads = (state: unknown) => new views.Reads(async () => state);

test('the Overview view is one row, and it opens the page', async () => {
	const provider = new views.OverviewTree();
	const [root] = await provider.getChildren();
	assert.equal(root.label, 'Temco Learn');
	assert.equal(root.command?.command, 'temcoLearn.overview');
	assert.deepEqual(await provider.getChildren(root), [], 'the Overview view still lists facts');
});

const stopped = { state: 'stopped' };
const running = { state: 'running', mode: 'built', url: 'http://localhost:1025/' };

/** What a row says at its right-hand end: the badge the decoration supplies for that row's own URI. */
const textOfEnd = (row: Row): string => {
	const uri = row.resourceUri;
	if (uri === undefined) {
		return '';
	}
	return String(views.badgeDecoration({ scheme: uri.scheme as string, path: uri.path as string, query: uri.query })?.badge ?? '');
};

test('the Browse view answers the site first, then the library it serves', async () => {
	const provider = new views.BrowseTree(newReads(snapshot), () => stopped);
	const roots = await provider.getChildren();
	assert.deepEqual(
		roots.map((row) => [row.label, row.command?.command ?? '']),
		[
			['Preview the Site', 'temcoLearn.site.page'],
			['Library', '']
		]
	);
	assert.deepEqual(roots.map(textOfEnd), ['Stopped', '2 projects'], 'the two rows say nothing at their end');
});

test('the site is a group whose heading opens the page, with the acts a panel owns', async () => {
	const provider = new views.BrowseTree(newReads(snapshot), () => running);
	const [site] = await provider.getChildren();
	assert.deepEqual(
		[site.iconPath?.id, String(site.iconPath?.color), textOfEnd(site)],
		['circle-filled', 'charts.green', 'Running'],
		'the heading does not say the server is up, in a colour'
	);
	assert.equal(site.command?.command, 'temcoLearn.site.page', 'the heading does not open the page');
	assert.deepEqual(
		(await provider.getChildren(site)).map((row) => [row.label, row.command?.command]),
		[
			['Stop', 'temcoLearn.site.stop'],
			['Open', 'temcoLearn.site.preview'],
			['Open in Browser', 'temcoLearn.site.open']
		]
	);

	const [idle] = await new views.BrowseTree(newReads(snapshot), () => stopped).getChildren();
	assert.deepEqual(
		[idle.iconPath?.id, String(idle.iconPath?.color), textOfEnd(idle)],
		['circle-outline', 'undefined', 'Stopped'],
		'a stopped server does not read as stopped'
	);
	const [start] = await provider.getChildren(idle);
	assert.deepEqual([start.label, start.command?.command], ['Start', 'temcoLearn.site.start'], 'a stopped server is not offered Start');
});

test('the dot is the state: green while it runs, spinning while it starts, red when it failed, blue with no clone', async () => {
	const icon = async (status: { state: string; reason?: string }): Promise<[string, string]> => {
		const [site] = await new views.BrowseTree(newReads(snapshot), () => status).getChildren();
		return [String(site.iconPath?.id), String(site.iconPath?.color)];
	};
	assert.deepEqual(await icon({ state: 'starting' }), ['sync~spin', 'undefined'], 'starting is not drawn as starting');
	assert.deepEqual(await icon({ state: 'failed', reason: 'no answer at 1025' }), ['error', 'charts.red'], 'a failure is not red');
	assert.equal(textOfEnd((await new views.BrowseTree(newReads(snapshot), () => ({ state: 'failed', reason: 'no answer at 1025' })).getChildren())[0]), 'Failed');

	repoSetting = path.join(siteClone, 'gone');
	try {
		assert.deepEqual(await icon(stopped), ['cloud-download', 'charts.blue'], 'a missing clone is not drawn as one');
		assert.equal(textOfEnd((await new views.BrowseTree(newReads(snapshot), () => stopped).getChildren())[0]), 'Not set up');
	} finally {
		repoSetting = siteClone;
	}
});

test('the library is one row per project, at its newest version', async () => {
	const provider = new views.BrowseTree(newReads(snapshot), () => stopped);
	const [, library] = await provider.getChildren();
	const rows = await provider.getChildren(library);
	assert.deepEqual(
		rows.map((row) => [row.label, count(row), row.iconPath?.id, row.command?.command]),
		[
			['T3000 · 13.0', '', 'library', 'temcoLearn.site.preview'],
			['BACnet · 4.2', '', 'library', 'temcoLearn.site.preview']
		],
		'the library is not one row per project at its newest version'
	);
	assert.deepEqual(rows[0].command?.arguments, [{ project: 't3000', version: '13.0' }], 'a library row does not say which page it opens');
});

test('a site with nothing on it offers to add a build instead of only saying so', async () => {
	const provider = new views.BrowseTree(newReads({ ...snapshot, site: { projects: [] } }), () => stopped);
	const [, library] = await provider.getChildren();
	assert.deepEqual(
		(await provider.getChildren(library)).map((row) => [row.label, row.command?.command]),
		[['Add a Build to the Site…', 'temcoLearn.addBuilds']]
	);
	const empty = new views.BrowseTree(newReads({ ...snapshot, site: { projects: [] } }), () => stopped);
	const [, emptyLibrary] = await empty.getChildren();
	assert.equal(textOfEnd(emptyLibrary), '0 projects', 'an empty site does not say it is empty at the row end');
});

test('Download is the project name as the category, and its rows carry the size', async () => {
	const provider = new views.DownloadTree(newReads(snapshot));
	const [project] = await provider.getChildren();
	assert.deepEqual([project.label, count(project)], ['T3000', '2 files']);
	const artifacts = await provider.getChildren(project);
	assert.deepEqual(artifacts.map((row) => [row.label, count(row)]), [['T3000.chm', '1.1 MB'], ['T3000-site.zip', '4.2 MB']]);
	assert.ok(artifacts.every((row) => row.command?.command === 'temcoLearn.downloadArtifact'));
	assert.deepEqual(artifacts.map((row) => row.contextValue), ['temcoLearn.artifact.look', 'temcoLearn.artifact']);
	const none = await new views.DownloadTree(newReads({ ...snapshot, artifacts: [] })).getChildren();
	assert.deepEqual(none.map((row) => [row.label, row.command?.command]), [['No file to take', 'temcoLearn.downloads']], 'the empty Download row does not open its page');
});

test('Next steps holds the acts, and Publish opens the page that explains it', async () => {
	const provider = new views.TodoTree(newReads(snapshot));
	const rows = await provider.getChildren();
	assert.deepEqual(rows.map((row) => [row.label, count(row), row.command?.command ?? '']), [
		['Add to the site', '1 build', ''],
		['Publish', '3 changes', 'temcoLearn.publishing'],
		['Build a project', '', 'temcoDocs.builds']
	]);
	const builds = await provider.getChildren(rows[0]);
	assert.deepEqual(
		builds.map((row) => [row.label, count(row), row.command?.command]),
		[['NetTools', 'not on the site', 'temcoLearn.addBuild']],
		'a build in the queue does not say why it is there'
	);
	assert.match(String(rows[1].tooltip), /last publish 6f2c1ab/u);
});

test('a build newer than the version the site serves says so, instead of "not on the site"', async () => {
	const newer = {
		...snapshot,
		builds: [{ ...snapshot.builds[0], id: 't3000', title: 'T3000', at: Date.now() }]
	};
	const rows = await new views.TodoTree(newReads(newer)).getChildren();
	assert.deepEqual(
		(await new views.TodoTree(newReads(newer)).getChildren(rows[0])).map((row) => [row.label, count(row)]),
		[['T3000', 'newer than 13.0']]
	);
});

test('Next steps says when there is nothing to do, and still offers to publish', async () => {
	const rows = await new views.TodoTree(newReads(cleanState)).getChildren();
	assert.deepEqual(rows.map((row) => [row.label, count(row)]), [
		['Nothing to do', ''],
		['Publish', 'up to date'],
		['Build a project', '']
	]);
});

test('the four views are declared, and Projects and Preview do not survive as views', () => {
	assert.deepEqual(Object.values(views.VIEWS), [
		'temcoLearn.overviewView',
		'temcoLearn.browse',
		'temcoLearn.download',
		'temcoLearn.todo'
	]);
	const manifest = createRequire(import.meta.url)('../package.json') as {
		contributes: { views: Record<string, { id: string }[]> };
	};
	assert.deepEqual(
		(manifest.contributes.views.temcoLearn ?? []).map((entry) => entry.id),
		['temcoLearn.overviewView', 'temcoLearn.browse', 'temcoLearn.download', 'temcoLearn.todo'],
		'the manifest declares a view the code does not, or the other way round'
	);
});

test('every menu names a view that exists and a command the manifest declares', () => {
	const manifest = createRequire(import.meta.url)('../package.json') as {
		contributes: {
			commands: { command: string }[];
			menus: Record<string, { command: string; when?: string }[]>;
		};
	};
	const declared = new Set(Object.values(views.VIEWS));
	const commands = new Set(manifest.contributes.commands.map((entry) => entry.command));
	for (const [where, entries] of Object.entries(manifest.contributes.menus)) {
		for (const entry of entries) {
			assert.ok(commands.has(entry.command), `${where} cites ${entry.command}, which the manifest does not declare`);
			const cited = /view == ([^ &]+)/u.exec(entry.when ?? '')?.[1];
			if (cited !== undefined) {
				assert.ok(declared.has(cited), `${where} cites the view ${cited}, which does not exist`);
			}
		}
	}
	const actions = (id: string, item: string): string[] =>
		manifest.contributes.menus['view/item/context']
			.filter((entry) => entry.when === `view == ${id} && viewItem == ${item}`)
			.map((entry) => entry.command)
			.sort();
	assert.deepEqual(actions('temcoLearn.download', 'temcoLearn.artifact.look'), ['temcoLearn.previewArtifact']);
	assert.deepEqual(actions('temcoLearn.download', 'temcoLearn.artifact'), ['temcoLearn.downloadArtifact', 'temcoLearn.revealArtifact']);
});

test('a project is written by its name, without the "docs" its page title ends with', async () => {
	const named = {
		...snapshot,
		site: { projects: [{ id: 'test1-docs', title: 'Test1 docs', section: 'documentation', versions: [{ version: '1.0', pages: [{ href: 'a', title: 'A' }] }] }] },
		artifacts: [{ title: 'Test1 docs', id: 'test1-docs', folder: 'C:/Temco/test1', artifacts: [{ kind: 'zip', file: 'C:/Temco/test1/dist/Test1.zip', label: 'an archive', opens: undefined, size: 1024, at: Date.now() }] }]
	};
	const browse = new views.BrowseTree(newReads(named), () => stopped);
	const [, byProject] = await browse.getChildren();
	assert.deepEqual((await browse.getChildren(byProject)).map((row) => row.label), ['Test1 · 1.0']);
	const download = new views.DownloadTree(newReads(named));
	assert.deepEqual((await download.getChildren()).map((row) => row.label), ['Test1']);
});

test('the right-hand end of a row is a badge, and the words travel in the URI', () => {
	const read = (text: string, key: string, tone?: 'ok' | 'warn' | 'err' | 'info'): [string, string] => {
		const decoration = views.badgeDecoration(views.badgeRow(text, key, tone));
		return [String(decoration?.badge), decoration?.color === undefined ? 'none' : String(decoration.color)];
	};
	assert.deepEqual(read('Running', 'site', 'ok'), ['Running', 'charts.green'], 'a running server is not green at the row\u2019s end');
	assert.deepEqual(read('Starting…', 'site', 'warn'), ['Starting…', 'charts.yellow'], 'a starting server is not amber');
	assert.deepEqual(read('Failed', 'site', 'err'), ['Failed', 'charts.red'], 'a failure is not red');
	assert.deepEqual(read('Stopped', 'site'), ['Stopped', 'none'], 'a stopped server is coloured anyway');
	assert.deepEqual(read(':1025', 'port'), [':1025', 'none'], 'the port is not the port');
	assert.deepEqual(read('2 projects', 'library'), ['2 projects', 'none'], 'the count is not the count');

	assert.equal(views.badgeDecoration({ scheme: 'file', path: '/1/x' }), undefined, 'a file URI is decorated too');
	assert.equal(views.badgeDecoration(views.badgeRow('', 'site')), undefined, 'an empty badge is drawn');
});

test('every row that says something at its end carries its own words there', async () => {
	const textOf = (row: Row): string => {
		const uri = row.resourceUri;
		if (uri === undefined) {
			return '';
		}
		const decoration = views.badgeDecoration({ scheme: uri.scheme as string, path: uri.path as string, query: uri.query });
		return String(decoration?.badge ?? '');
	};

	const tree = new views.BrowseTree(newReads(snapshot), () => running);
	const [site, library] = await tree.getChildren();
	assert.deepEqual([textOf(site), count(site)], ['Running', ''], 'the state is not at the row\u2019s end, once');
	assert.deepEqual([textOf(library), count(library)], ['2 projects', ''], 'the count is not at the row\u2019s end, once');

	const [, , browser] = await tree.getChildren(site);
	assert.deepEqual([textOf(browser), count(browser)], [':1025', ''], 'the port is not at the row\u2019s end, once');
});

let failed = 0;
for (const { name, run } of cases) {
	try {
		await run();
		console.log(`  ok  ${name}`);
	} catch (error) {
		failed += 1;
		console.error(`FAIL  ${name}`);
		console.error(error instanceof Error ? error.message : error);
	}
}
console.log(`\n${cases.length - failed}/${cases.length} panel cases passed`);
process.exit(failed === 0 ? 0 : 1);
