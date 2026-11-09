// The Pages tree's shape, checked against a folder that looks like a manual.
//
// Three failures matter here and none of them is a compile error, because the tree is data:
//
// * a section that is one page (`docs/ip-settings/ip-settings.md`) drawn as a folder holding a file, which adds a level
//   the published contents do not have and makes every such entry read as a section containing a page of the same name;
// * a folder labelled with its own file name (`graphic-screens`) where the contents say "6.1 Graphic Screens";
// * a folder that holds pictures and no pages (`docs/media/`) opening onto nothing, so the pictures look missing.
//
// The fixture is written to a temporary folder, so the check says the same thing on any machine and needs no project.

import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import Module, { createRequire } from 'node:module';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

// ---- the editor API, as much of it as the tree touches ---------------------------------------------------------------

type Dir = [string, number];
const FILE = 1;
const DIRECTORY = 2;

const uriOf = (path: string): { fsPath: string; scheme: string; path: string; toString(): string } => ({
	fsPath: path,
	scheme: 'file',
	path: path.replace(/\\/gu, '/'),
	toString: () => `file://${path.replace(/\\/gu, '/')}`
});

const joinPath = (base: { fsPath: string }, ...parts: string[]): ReturnType<typeof uriOf> => uriOf(join(base.fsPath, ...parts));

const root = mkdtempSync(join(tmpdir(), 'temco-tree-'));

const fake = {
	Uri: {
		file: uriOf,
		joinPath,
		parse: (text: string) => uriOf(text.replace(/^file:\/\//u, ''))
	},
	workspace: {
		fs: {
			async readDirectory(uri: { fsPath: string }): Promise<Dir[]> {
				const { readdirSync } = await import('node:fs');
				return readdirSync(uri.fsPath, { withFileTypes: true }).map((entry) => [entry.name, entry.isDirectory() ? DIRECTORY : FILE] as Dir);
			},
			async readFile(uri: { fsPath: string }): Promise<Uint8Array> {
				const { readFileSync } = await import('node:fs');
				return new Uint8Array(readFileSync(uri.fsPath));
			},
			async stat(uri: { fsPath: string }) {
				const { statSync } = await import('node:fs');
				const stat = statSync(uri.fsPath);
				return { type: stat.isDirectory() ? DIRECTORY : FILE, mtime: stat.mtimeMs, size: stat.size };
			}
		},
		asRelativePath: (uri: { fsPath: string }) => uri.fsPath.replace(root + '\\', '').replace(/\\/gu, '/'),
		getWorkspaceFolder: () => undefined
	},
	FileType: { File: FILE, Directory: DIRECTORY },
	EventEmitter: class {
		private readonly listeners: ((value: unknown) => void)[] = [];
		readonly event = (listener: (value: unknown) => void): { dispose(): void } => {
			this.listeners.push(listener);
			return { dispose: () => undefined };
		};
		fire(value?: unknown): void {
			for (const listener of this.listeners) {
				listener(value);
			}
		}
	},
	TreeItem: class {
		description: string | undefined;
		tooltip: unknown;
		iconPath: unknown;
		contextValue: string | undefined;
		command: unknown;
		collapsibleState: number;
		label: string;
		constructor(label: string, collapsibleState = 0) {
			this.label = label;
			this.collapsibleState = collapsibleState;
		}
	},
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
	},
	MarkdownString: class {
		value = '';
		constructor(value?: string) {
			this.value = value ?? '';
		}
		appendMarkdown(text: string): this {
			this.value += text;
			return this;
		}
	}
};

const load = (Module as unknown as { _load: (request: string, ...rest: unknown[]) => unknown })._load;
(Module as unknown as { _load: unknown })._load = function (request: string, ...rest: unknown[]) {
	return request === 'vscode' ? fake : (load as (...args: unknown[]) => unknown).call(this, request, ...rest);
};

// ---- a folder that looks like a manual -------------------------------------------------------------------------------

const docs = join(root, 'docs');
const write = (relative: string, text = 'x'): void => {
	const file = join(docs, relative);
	mkdirSync(join(file, '..'), { recursive: true });
	writeFileSync(file, relative.endsWith('.png') ? Buffer.from([0x89, 0x50, 0x4e, 0x47]) : text);
};

write('help/registry.json', JSON.stringify({
	version: 1,
	areas: {
		control: { title: '6 Control' },
		'ip-settings': { title: 'IP SETTINGS' },
		media: { title: 'Media' }
	},
	pages: {
		'control/control': { title: '6 Control', order: 100 },
		'control/graphic-screens/graphic-screens': { title: '6.1 Graphic Screens', order: 110 },
		'control/graphic-screens/insert-point': { title: '6.1.1 Insert Point', order: 120 },
		'ip-settings': { title: 'IP SETTINGS', order: 200 }
	}
}), 'utf8');
write('control/control.md', '# 6 Control\n');
write('control/graphic-screens/graphic-screens.md', '# 6.1 Graphic Screens\n');
write('control/graphic-screens/insert-point.md', '# 6.1.1 Insert Point\n');
write('ip-settings.md', '# IP SETTINGS\n');
write('media/shot-1.png');
write('media/shot-2.png');

// ---- the tree, read the way the view reads it ------------------------------------------------------------------------

const require_ = createRequire(import.meta.url);
const out = (name: string): string => fileURLToPath(new URL(`../out/${name}`, import.meta.url));

interface Node {
	kind: string;
	page?: { id: string; title: string };
	area?: { area: string };
	chapter?: { chapter: string };
	image?: { name: string };
}

const registry = require_(out('registry.js')) as {
	loadDocsRoot(folder: unknown): Promise<unknown>;
	folderForPath(path: string, name: string): unknown;
};
const loose = require_(out('loose.js')) as { looseByRoot(roots: unknown[]): Promise<Map<string, unknown>> };
const tree = require_(out('tree.js')) as {
	DocsTreeProvider: new () => {
		setRoots(roots: unknown[], notes: unknown[], loose: Map<string, unknown>): void;
		getChildren(node?: Node): Node[];
		getTreeItem(node: Node): { label: string; collapsibleState: number };
	};
};

const cases: { name: string; run: () => Promise<void> | void }[] = [];
const test = (name: string, run: () => Promise<void> | void): void => {
	cases.push({ name, run });
};

let provider: InstanceType<typeof tree.DocsTreeProvider>;
let top: Node[] = [];
const label = (node: Node): string => provider.getTreeItem(node).label;

await (async () => {
	const loaded = await registry.loadDocsRoot(registry.folderForPath(root, 'manual'));
	assert.ok(loaded !== undefined, 'the fixture is a documented folder');
	const roots = [loaded];
	provider = new tree.DocsTreeProvider();
	provider.setRoots(roots, [], await loose.looseByRoot(roots));
	top = provider.getChildren();
})();

test('a section that is one page is that page, not a folder holding it', () => {
	const row = top.find((node) => node.kind === 'page' && node.page?.id === 'ip-settings');
	assert.ok(row !== undefined, 'IP SETTINGS is a page row at the top of the tree');
	assert.equal(label(row), 'IP SETTINGS', 'the row keeps the title the folder row used to show');
	assert.equal(
		top.some((node) => node.kind === 'area' && node.area?.area === 'ip-settings'),
		false,
		'and it is not also drawn as a folder of the same name'
	);
});

test('a section with pages in it is a folder, named by the page that opens it', () => {
	const row = top.find((node) => node.kind === 'area' && node.area?.area === 'control');
	assert.ok(row !== undefined, '6 Control is a folder');
	assert.equal(label(row), '6 Control');
});

test('folders nest the way the pages are filed', () => {
	const control = top.find((node) => node.kind === 'area' && node.area?.area === 'control');
	const rows = control === undefined ? [] : provider.getChildren(control);
	const folder = rows.find((node) => node.kind === 'chapter');
	assert.ok(folder !== undefined, '6.1 Graphic Screens is a folder inside 6 Control');
	assert.equal(label(folder), '6.1 Graphic Screens', 'named by its own page, not by `graphic-screens`');
	const inside = provider.getChildren(folder!).map((node) => (node.kind === 'page' ? node.page?.id : undefined));
	assert.deepEqual(inside, ['control/graphic-screens/graphic-screens', 'control/graphic-screens/insert-point']);
});

test('a folder of pictures lists the pictures instead of opening onto nothing', () => {
	const row = top.find((node) => node.kind === 'area' && node.area?.area === 'media');
	assert.ok(row !== undefined, 'Media is a row, because the pictures are in it');
	assert.notEqual(provider.getTreeItem(row!).collapsibleState, 0, 'and it can be opened');
	const images = provider.getChildren(row!).map((node) => (node.kind === 'image' ? node.image?.name : undefined));
	assert.deepEqual(images, ['shot-1.png', 'shot-2.png']);
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

rmSync(root, { recursive: true, force: true });
console.log(`\n${cases.length - failed}/${cases.length} tree cases passed`);
process.exit(failed === 0 ? 0 : 1);
