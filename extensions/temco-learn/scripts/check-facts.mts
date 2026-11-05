// What a changed path is, and who wrote it — the one judgement a pull depends on.
//
// The case that made this a gate rather than a comment: a build leaves the clone reporting six changes, five of which
// nobody made — two are the JSON the build writes and three are the same files reported again with different line
// endings. A pull that treats them as work never runs, so the classification has to be right, and right in a particular
// order: `public/content/*.json` is generated even when git reports no line counts at all.

import assert from 'node:assert/strict';
import { createRequire, Module } from 'node:module';
import { fileURLToPath } from 'node:url';

// `siteFacts` reaches `siteRepo`, which reads a setting: the module needs `vscode` to exist, and the classification itself
// needs nothing from it.
const load = Module._load;
Module._load = function (request: string, parent: unknown, isMain: boolean) {
	if (request === 'vscode') {
		return { workspace: { getConfiguration: () => ({ get: () => undefined }) } };
	}
	return load.call(this as unknown as NodeModule, request, parent, isMain);
};

interface Facts {
	classifyChanges(status: string, numstat: string): { code: string; path: string; kind: string }[];
	disposableOf(changes: { code: string; path: string; kind: string }[]): string[];
	editsOf(changes: { code: string; path: string; kind: string }[]): { code: string; path: string; kind: string }[];
}

const facts = createRequire(import.meta.url)(fileURLToPath(new URL('../out/siteFacts.js', import.meta.url))) as Facts;

const cases: { name: string; run: () => void }[] = [];
const test = (name: string, run: () => void): void => {
	cases.push({ name, run });
};

/** git's own two answers for one tree: what it calls changed, and what it says changed inside those files. */
const status = (lines: string[]) => lines.join('\n') + '\n';
const numstat = (lines: string[]) => lines.join('\n') + '\n';

test('the build output is generated even when git reports no line counts, which is the Windows case', () => {
	const changes = facts.classifyChanges(
		status([
			' M .gitignore',
			' M public/catalog.json',
			' M public/content/bacnet/1.0.json',
			' M public/content/t3000/0.9.json',
			' M public/content/t3000/1.0.json',
			' M public/search.json',
			'?? .gitattributes'
		]),
		// Only three of them have any diff at all: the three content JSONs differ in line endings only, and git therefore
		// reports nothing for them.
		numstat(['1\t0\t.gitignore', '4\t4\tpublic/catalog.json', '1\t1\tpublic/search.json'])
	);
	assert.deepEqual(
		changes.map((change) => [change.path, change.kind]),
		[
			['.gitignore', 'edit'],
			['public/catalog.json', 'generated'],
			['public/content/bacnet/1.0.json', 'generated'],
			['public/content/t3000/0.9.json', 'generated'],
			['public/content/t3000/1.0.json', 'generated'],
			['public/search.json', 'generated'],
			// Untracked is somebody's new file, never something a pull may delete.
			['.gitattributes', 'edit']
		]
	);
	assert.deepEqual(facts.disposableOf(changes), [
		'public/catalog.json',
		'public/content/bacnet/1.0.json',
		'public/content/t3000/0.9.json',
		'public/content/t3000/1.0.json',
		'public/search.json'
	]);
	assert.deepEqual(facts.editsOf(changes).map((change) => change.path), ['.gitignore', '.gitattributes']);
});

test('the whole of public/ is the build\'s, so a new script writing there is covered without a second list', () => {
	const changes = facts.classifyChanges(
		status([' M public/download/manifest.json', ' M public/pdf/t3000/1.0.pdf', ' M src/main.tsx']),
		numstat(['2\t2\tpublic/download/manifest.json', '1\t1\tpublic/pdf/t3000/1.0.pdf', '5\t0\tsrc/main.tsx'])
	);
	assert.deepEqual(changes.map((change) => change.kind), ['generated', 'generated', 'edit']);
});

test('a tracked file with no diff in it is line endings, and is not worth stopping a pull for', () => {
	const changes = facts.classifyChanges(status([' M src/App.tsx', ' M src/main.tsx']), numstat(['3\t1\tsrc/App.tsx']));
	assert.deepEqual(
		changes.map((change) => change.kind),
		['edit', 'noise']
	);
	assert.deepEqual(facts.disposableOf(changes), ['src/main.tsx']);
});

test('a deleted file is an edit: the counts say so even though the file is gone', () => {
	const changes = facts.classifyChanges(status([' D content/sections/old.md']), numstat(['0\t42\tcontent/sections/old.md']));
	assert.equal(changes[0].kind, 'edit');
});

test('a clean tree has nothing disposable and nothing to decide', () => {
	const changes = facts.classifyChanges('', '');
	assert.deepEqual(changes, []);
	assert.deepEqual(facts.disposableOf(changes), []);
	assert.deepEqual(facts.editsOf(changes), []);
});

let failed = 0;
for (const { name, run } of cases) {
	try {
		run();
		console.log(`  ok  ${name}`);
	} catch (error) {
		failed += 1;
		console.error(`FAIL  ${name}`);
		console.error('  ' + String((error as Error).message).split('\n').join('\n  '));
	}
}
console.log(`\n${cases.length - failed}/${cases.length} change cases passed`);
if (failed > 0) {
	process.exitCode = 1;
}
