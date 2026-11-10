// The words on the Publish & Releases page, checked as data.
//
// A build's output is a folder, and the page's job is to say what is in it without listing it twice: one block per
// target, how many files and how heavy, what they are in a sentence, and a way into the folder. Four things have gone
// wrong here before or could go wrong silently — a target nobody can find in the list, a "Show N more" that never says
// "Show less", a folder that is the drive, and a page that renders all 517 files at once — so each is a case.

import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';

interface Fact {
	kind: string;
	path: string;
	bytes?: number;
	builtAt: string;
}

const require_ = createRequire(import.meta.url);
const facts = require_(fileURLToPath(new URL('../out/releaseFacts.js', import.meta.url))) as {
	rankOf(kind: string): number;
	artifactLabel(kind: string): string;
	markOf(kind: string, file?: string): string;
	megabytes(bytes: number): string;
	composition(files: readonly Fact[]): string;
	commonFolder(paths: readonly string[]): string | undefined;
	folderOf(file: string): string;
};

const at = '2026-11-09T12:00:00.000Z';
const site: Fact[] = [
	{ kind: 'site', path: 'C:\\p\\dist\\docs\\panel-configuration.md', bytes: 3480, builtAt: at },
	{ kind: 'site', path: 'C:\\p\\dist\\docs\\control\\inputs.md', bytes: 1200, builtAt: at },
	{ kind: 'site', path: 'C:\\p\\dist\\docs\\media\\shot-1.png', bytes: 4_000_000, builtAt: at },
	{ kind: 'site', path: 'C:\\p\\dist\\docs\\media\\shot-2.png', bytes: 4_000_000, builtAt: at },
	{ kind: 'site', path: 'C:\\p\\dist\\docs\\nav.json', bytes: 900, builtAt: at }
];

const cases: { name: string; run: () => void }[] = [];
const test = (name: string, run: () => void): void => {
	cases.push({ name, run });
};

test('the targets are named the way a person publishes them', () => {
	assert.deepEqual(
		['site', 'pdf', 'chm', 'search'].map(facts.artifactLabel),
		['Website', 'PDF', 'Offline help (CHM)', 'Search index']
	);
	// An older build filed a website under `output`: same target, same words, and it sorts with the website.
	assert.equal(facts.artifactLabel('output'), 'Website');
	assert.equal(facts.rankOf('output'), facts.rankOf('site'));
	assert.ok(facts.rankOf('site') < facts.rankOf('pdf'), 'the website comes before the printing');
	assert.ok(facts.rankOf('chm') < facts.rankOf('search'), 'and the help file before the index');
});

test('a target says what it holds in one sentence', () => {
	assert.equal(facts.composition(site), '2 Markdown · 2 pictures · 1 JSON');
	assert.equal(facts.composition([]), '', 'a target with no files says nothing rather than "0"');
});

test('a size a person can weigh, not a byte count', () => {
	assert.equal(facts.megabytes(0), '0 KB');
	assert.equal(facts.megabytes(320 * 1024), '320 KB');
	assert.equal(facts.megabytes(16_400_000), '15.6 MB');
});

test('"Open folder" opens the folder the files are in, never the drive', () => {
	assert.equal(facts.commonFolder(site.map((file) => file.path)), 'C:\\p\\dist\\docs');
	assert.equal(
		facts.commonFolder(['C:\\p\\dist\\docs\\a.md', 'C:\\q\\dist\\docs\\b.md']),
		undefined,
		'a drive is not a folder worth opening'
	);
	assert.equal(facts.commonFolder([]), undefined);
});

test('each row says where its file is, and wears the mark of what it is', () => {
	assert.equal(facts.folderOf('C:\\p\\dist\\docs\\media\\shot-1.png'), 'C:\\p\\dist\\docs\\media');
	assert.equal(facts.markOf('site', 'a.png'), 'image', 'a picture in the website is a picture');
	assert.equal(facts.markOf('site', 'a.md'), 'markdown');
	assert.equal(facts.markOf('chm', 'help.chm'), 'package', 'the target decides before the extension does');
	assert.equal(facts.markOf('pdf', 'guide.pdf'), 'document');
});

let failed = 0;
for (const { name, run } of cases) {
	try {
		run();
		console.log(`  ok  ${name}`);
	} catch (error) {
		failed += 1;
		console.error(`FAIL  ${name}`);
		console.error(error instanceof Error ? error.message : error);
	}
}
console.log(`\n${cases.length - failed}/${cases.length} release cases passed`);
process.exit(failed === 0 ? 0 : 1);
