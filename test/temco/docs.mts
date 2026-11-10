/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

// The documentation guard: every claim a document makes about the code must still be true.
//
// A guide is a promise. It promises that `temcoLearn.site.downloads` is a real command, that `temcoLearn.siteRepo` is a
// real setting, that `../temco-learn/README.md` is a real file, that the anchor at the end of a table row lands on a
// heading, that the JSON it shows is JSON, and that steps 1, 2, 3 … are numbered in order. None of that is checked by
// the compiler, by the linter, or by any build: a renamed command turns a guide into a set of instructions that look
// right and do nothing when followed, which is the most expensive kind of mistake because the reader blames themselves.
//
// So this reads every Markdown file under `docs/` and holds it against the platform's own manifests:
//
//   1. **An id in backticks is real.** In the pages written to be followed, a `temco*.*` token must be a declared
//      command, a registered command, or a declared setting. Only those pages are checked: a design document also names
//      panels, storage keys and pages, which are real things with the same shape and no manifest behind them.
//   2. **A link resolves.** Relative `.md` links must exist. The few that intentionally do not are listed below with
//      the reason, rather than passed over in silence.
//   3. **An anchor resolves.** `[…](#anchor)` must match a heading in the same file.
//   4. **A JSON snippet parses.** A snippet that starts with `{` or `[` and has no `...` in it claims to be JSON;
//      a fragment of a registry entry, or a sketch with elisions, claims nothing and is left alone.
//   5. **A fence is closed.** An odd number of ``` markers swallows the rest of the file.
//   6. **A screenshot slot is numbered once.** `media/…/NN-name.png`, one per number, in order from 00.
//   7. **Steps are sequential.** `## Step 1` … `## Step N`, with no gaps, in the guides that use that heading.
//
// Each rule is then handed a document that breaks it, because a rule that catches nothing passes everything. Run by
// `npm run test-temco`, or alone with `npm run test-temco-docs` (which is also part of `npm run check-temco`, so a
// guide that has drifted stops the build).

import assert from 'node:assert/strict';
import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { suite, standalone } from './harness.mts';
import { picturesForSlots } from '../../scripts/docs-screenshots.mts';

const root = fileURLToPath(new URL('../..', import.meta.url));
const docs = join(root, 'docs');
const extensions = join(root, 'extensions');

/** Links that deliberately point at something which is not in this repository, and why. */
const ILLUSTRATIVE = [
	// A design document showing the shape of a product repository's content tree.
	/^t3000\//,
	// An ASCII drawing of a page that is depicting a broken link as part of the picture.
	/^\.\/verify\.md$/
];

/** The pages written to be followed. Their ids are promises; the rest of `docs/` is design prose. */
const FOLLOWED = [
	join(docs, 'README.md'),
	join(docs, 'temco-platform', 'README.md'),
	join(docs, 'temco-platform', 'getting-started.md'),
	join(docs, 'temco-learn', 'README.md')
];

// ---------- what the code declares ----------

interface Manifest {
	contributes?: {
		commands?: { command?: string }[];
		configuration?: { properties?: Record<string, unknown> } | { properties?: Record<string, unknown> }[];
	};
}

const declared = new Set<string>();
const settings = new Set<string>();

for (const folder of readdirSync(extensions)) {
	if (!folder.startsWith('temco-')) {
		continue;
	}
	const file = join(extensions, folder, 'package.json');
	if (!existsSync(file)) {
		continue;
	}
	const manifest = JSON.parse(readFileSync(file, 'utf8')) as Manifest;
	for (const entry of manifest.contributes?.commands ?? []) {
		if (typeof entry.command === 'string') {
			declared.add(entry.command);
		}
	}
	const configuration = manifest.contributes?.configuration;
	const blocks = configuration === undefined ? [] : Array.isArray(configuration) ? configuration : [configuration];
	for (const block of blocks) {
		for (const key of Object.keys(block.properties ?? {})) {
			settings.add(key);
		}
	}
}

for (const folder of readdirSync(extensions)) {
	if (!folder.startsWith('temco-')) {
		continue;
	}
	const sources = join(extensions, folder, 'src');
	if (!existsSync(sources)) {
		continue;
	}
	for (const file of readdirSync(sources)) {
		if (!file.endsWith('.ts')) {
			continue;
		}
		const text = readFileSync(join(sources, file), 'utf8');
		for (const match of text.matchAll(/registerCommand\(\s*'([^']+)'/g)) {
			declared.add(match[1]);
		}
		for (const match of text.matchAll(/registerCommand\(\s*"([^"]+)"/g)) {
			declared.add(match[1]);
		}
	}
}

// ---------- the documents ----------

interface Document {
	file: string;
	lines: string[];
}

const documents: Document[] = [];
const walk = (folder: string): void => {
	for (const entry of readdirSync(folder, { withFileTypes: true })) {
		const path = join(folder, entry.name);
		if (entry.isDirectory()) {
			walk(path);
		} else if (entry.name.endsWith('.md')) {
			documents.push({ file: path, lines: readFileSync(path, 'utf8').split(/\r?\n/) });
		}
	}
};
walk(docs);

const headingSlug = (heading: string): string =>
	heading
		.trim()
		.toLowerCase()
		.replace(/[^\p{L}\p{N} -]/gu, '')
		.replace(/ /g, '-');

/**
 * Every rule, against one document. `--self-test` runs this same function over deliberately broken text, so a rule that
 * has lost its teeth is noticed here rather than by the reader who followed the guide and pressed a dead button.
 */
const inspect = (file: string, lines: string[]): string[] => {
	const found: string[] = [];
	const say = (line: number, text: string): void => {
		found.push(`${relative(root, file)}:${line}  ${text}`);
	};

	const text = lines.join('\n');
	const slugs = new Set(lines.filter(line => line.startsWith('#')).map(line => headingSlug(line.replace(/^#+ /, ''))));

	// Which lines sit inside a ``` fence. A diagram of a page draws `![…](…)` inside its box art, and a picture drawn
	// with box characters is not a file a reader will ever follow.
	const fenced = new Set<number>();
	{
		let open = false;
		for (const [index, line] of lines.entries()) {
			if (line.trimStart().startsWith('```')) {
				open = !open;
				fenced.add(index + 1);
			} else if (open) {
				fenced.add(index + 1);
			}
		}
	}

	for (const [index, line] of lines.entries()) {
		const number = index + 1;

		// 1. an id in backticks is real
		if (FOLLOWED.includes(file)) {
			for (const match of line.matchAll(/`(temco[A-Za-z]+\.[A-Za-z0-9.]+)`/g)) {
				const id = match[1];
				if (!declared.has(id) && !settings.has(id)) {
					say(number, `\`${id}\` is not a declared command, a registered command, or a setting`);
				}
			}
		}

		// 2. a link resolves
		for (const match of line.matchAll(/\]\(([^)#\s]+\.md)(?:#[^)]*)?\)/g)) {
			const target = match[1];
			if (ILLUSTRATIVE.some(pattern => pattern.test(target))) {
				continue;
			}
			if (!existsSync(resolve(join(file, '..'), target))) {
				say(number, `link to ${target} does not exist`);
			}
		}

		// 2b. a picture a page points at exists — the slot rule below stops the numbering drifting, but a typo in the
		// name of a screenshot is a broken image on GitHub and nothing else notices it.
		if (!fenced.has(number)) {
			// A pattern quoted in backticks is an example a reader copies, not a picture this page draws.
			const prose = line.replace(/`[^`]*`/gu, '');
			for (const match of prose.matchAll(/!\[[^\]]*\]\(([^)\s]+)\)/gu)) {
				const target = match[1];
				// Addressing something that is not a file here — a remote page, an attachment the editor inserts — is
				// not this repository's to find; `…` is a slot in a sentence, not a path.
				if (/^(?:[a-z]+:|\/\/)/iu.test(target) || target.includes('…')) {
					continue;
				}
				if (!existsSync(resolve(join(file, '..'), decodeURI(target)))) {
					say(number, `picture ${target} does not exist`);
				}
			}
		}

		// 3. an anchor resolves
		for (const match of line.matchAll(/\]\(#([^)\s]+)\)/g)) {
			if (!slugs.has(match[1])) {
				say(number, `anchor #${match[1]} matches no heading in this file`);
			}
		}
	}

	// 4. a JSON snippet parses
	const fences = [...text.matchAll(/```(json|text|ts)?\r?\n([\s\S]*?)```/g)];
	for (const fence of fences) {
		const body = fence[2];
		if (fence[1] !== 'json' || !/^\s*[{[]/.test(body) || body.includes('...')) {
			continue;
		}
		try {
			JSON.parse(body);
		} catch (error) {
			const before = text.slice(0, fence.index ?? 0);
			say(before.split('\n').length, `a \`\`\`json snippet is not valid JSON: ${(error as Error).message}`);
		}
	}

	// 5. a fence is closed
	const fenceLines = lines.filter(line => line.trimStart().startsWith('```')).length;
	if (fenceLines % 2 !== 0) {
		say(lines.length, `${fenceLines} code fences: one of them is never closed`);
	}

	// 6. a screenshot slot is numbered once, in order — whether it is written as a planned slot in backticks or pasted as
	// a picture. A guide with `00`, `01`, `03` has lost one, and a missing number is a missing screenshot.
	const slots: { slot: number; line: number }[] = [];
	lines.forEach((line, index) => {
		if (fenced.has(index + 1)) {
			return;
		}
		for (const match of line.matchAll(/media\/[^`)\s]*\/(\d{2})-[a-z0-9-]+\.png/gu)) {
			slots.push({ slot: Number(match[1]), line: index + 1 });
		}
	});
	[...slots]
		.sort((one, other) => one.slot - other.slot)
		.forEach(({ slot, line }, index) => {
			if (slot !== index) {
				say(line, `screenshot slots are not numbered 00, 01, 02 …: found ${slots.map(entry => entry.slot).sort().join(', ')}`);
			}
		});

	// 7. steps are sequential
	const steps: { step: number; line: number }[] = [];
	lines.forEach((line, index) => {
		const match = /^## Step (\d+)/.exec(line);
		if (match !== null) {
			steps.push({ step: Number(match[1]), line: index + 1 });
		}
	});
	steps.forEach(({ step, line }, index) => {
		if (step !== index + 1) {
			say(line, `steps are not sequential: found ${steps.map(entry => entry.step).join(', ')}`);
		}
	});

	return found;
};

// ---------- the rules must have teeth ----------

// Each rule is handed one broken document and must find exactly one thing wrong with it. A rule that finds nothing has
// silently stopped working — which is the failure mode of every checker ever written.
const TEETH: { rule: string; lines: string[] }[] = [
	{ rule: 'an id in backticks is real', lines: ['Run `temcoLearn.site.notACommand` to do it.'] },
	{ rule: 'a link resolves', lines: ['See [the other guide](./no-such-guide.md).'] },
	{ rule: 'a picture a page points at exists', lines: ['![The settings page](media/getting-started/settings-window.png)'] },
	{ rule: 'an anchor resolves', lines: ['# A heading', '', 'Jump to [the end](#the-end).'] },
	{ rule: 'a JSON snippet parses', lines: ['```json', '{ "version": 1, }', '```'] },
	{ rule: 'a fence is closed', lines: ['```json', '{ "version": 1 }'] },
	{ rule: 'a screenshot slot is numbered once', lines: ['`media/publishing/00-one.png`', '`media/publishing/02-three.png`'] },
	{ rule: 'steps are sequential', lines: ['## Step 1', '', '## Step 3'] }
];

// ---------- the cases ----------

const group = suite();

// The guide the rules are pointed at for the tooth tests: a real path, so link resolution behaves as it does in practice.
const guide = join(docs, 'temco-platform', 'getting-started.md');

for (const one of TEETH) {
	group.test(`the rule “${one.rule}” catches a document that breaks it`, () => {
		const found = inspect(guide, one.lines);
		assert.equal(found.length, 1, `expected one problem, got ${found.length}: ${found.join(' | ')}`);
	});
}

group.test('a picture is numbered like a slot, and a pattern in backticks is not a picture', () => {
	const found = inspect(guide, [
		'![One](media/getting-started/01-one.png)',
		'![Two](media/getting-started/03-three.png)',
		'An example, written in backticks: `![x](media/x.png)`.',
		'```',
		'![A box drawing](media/diagram/02-not-a-file.png)',
		'```'
	]);
	assert.ok(
		found.some((text) => text.includes('screenshot slots are not numbered')),
		`the numbering rule did not fire on pasted pictures: ${found.join(' | ')}`
	);
	assert.ok(
		!found.some((text) => text.includes('media/x.png')),
		'an example in backticks was read as a picture the page draws'
	);
	assert.ok(
		!found.some((text) => text.includes('media/diagram')),
		'a diagram inside a fence was read as a picture'
	);
});

group.test('a slot becomes a picture only when the picture is there', () => {
	const slot = [
		'> **Screenshot — the Build Center after a build: the four counts.**',
		'> `media/publishing/04-build.png`',
		''
	].join('\n');

	const drawn = picturesForSlots(slot, path => path === 'media/publishing/04-build.png');
	assert.equal(drawn, '![The Build Center after a build: the four counts.](media/publishing/04-build.png)\n');

	// A picture the guide does not have stays a note to the writer, because a broken image is worse than a TODO.
	assert.equal(picturesForSlots(slot, () => false), slot);
	// `npm run docs:screenshots` runs on a Windows checkout too, and a guide that was committed with CRLF keeps it.
	assert.ok(
		picturesForSlots(slot.replace(/\n/gu, '\r\n'), () => true).includes('\r\n'),
		'a CRLF document came back with different line endings'
	);
});

group.test('every page in docs/ tells the truth', () => {
	const problems = documents.flatMap(document => inspect(document.file, document.lines));
	assert.deepEqual(
		problems,
		[],
		`${problems.length} claim(s) disagree with the code:\n${problems.join('\n')}`
	);
	assert.ok(
		declared.size > 0 && settings.size > 0,
		'the manifests were read, so a command renamed today is caught today'
	);
});

await standalone(
	import.meta.url,
	group.cases,
	`${documents.length} documents against ${declared.size} commands and ${settings.size} settings`
);
