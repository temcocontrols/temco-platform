/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

// Turns the screenshot slots in `docs/` into pictures, once the picture is there.
//
//   npm run docs:screenshots            convert every slot whose PNG exists, and name the ones still waiting
//
// A slot is two lines: the sentence a writer reads, and the path the picture will live at, in backticks —
//
//     > **Screenshot — the Build Center after a build: the four counts, one card per output.**
//     > `media/publishing/04-build.png`
//
// A picture is one line, and its alt text is that sentence, because the sentence is what a screen reader reads:
//
//     ![The Build Center after a build: the four counts, one card per output.](media/publishing/04-build.png)
//
// Only a path whose file exists is converted. A guide that draws a picture it does not have is a broken guide, so
// `docs · a picture a page points at exists` (test/temco/docs.mts) refuses it, and this tool must never be the reason
// that check fails: it converts pictures that are present, and names the ones that are not.

import { existsSync, readFileSync, readdirSync, statSync, writeFileSync } from 'node:fs';
import { dirname, join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');

/** `> \`media/x/00-one.png\`` — the path a slot promises, and nothing else on the line. */
const SLOT_PATH = /^\s*>\s*`(media\/[^`]+\.png)`\s*$/;

/** `> **Screenshot — what it shows.**` — the sentence a slot is holding  */
const SLOT_SENTENCE = /^\s*>\s*\*\*Screenshot\s*[\u2014\u2013-]\s*(.+?)\s*\*\*\s*$/;

/**
 * The alt text a slot's sentence becomes: no bold, no "Screenshot —" prefix, and a capital letter, because it is now the
 * first thing in a sentence rather than a label after one.
 */
export function altText(sentence: string): string {
	const stripped = sentence
		.replace(/^\s*>\s*/u, '')
		.replace(/^\*\*Screenshot\s*[\u2014\u2013-]\s*/iu, '')
		.replace(/\*\*$/u, '')
		.replace(/\s+/gu, ' ')
		.trim();
	return stripped === '' ? '' : stripped.charAt(0).toUpperCase() + stripped.slice(1);
}

/**
 * The document with every slot whose picture exists drawn as a picture, and every other slot left alone.
 *
 * `exists` is asked about the path as the guide writes it, so a caller can pass a folder-relative test rather than a
 * file system: the conversion is then a pure function of the text, which is what the tests exercise.
 */
export function picturesForSlots(text: string, exists: (path: string) => boolean): string {
	// A document keeps the line endings it was committed with: rewriting a whole guide because a line was replaced is a
	// diff nobody asked for, and it hides the one line that changed.
	const eol = text.includes('\r\n') ? '\r\n' : '\n';
	const lines = text.split(/\r?\n/u);
	const out: string[] = [];
	// A fence is how a document shows the convention rather than using it, so a slot written inside one is a sample.
	let fenced = false;
	for (let index = 0; index < lines.length; index++) {
		if (lines[index].trimStart().startsWith('```')) {
			fenced = !fenced;
			out.push(lines[index]);
			continue;
		}
		const next = lines[index + 1];
		const path = next === undefined ? null : SLOT_PATH.exec(next);
		const sentence = SLOT_SENTENCE.exec(lines[index]);
		if (fenced || path === null || sentence === null) {
			out.push(lines[index]);
			continue;
		}
		const alt = altText(sentence[1]);
		if (alt === '' || !exists(path[1])) {
			out.push(lines[index]);
			continue;
		}
		out.push(`![${alt.replace(/[[\]]/gu, '')}](${path[1]})`);
		index++; // the path line was the picture's address, and the picture now carries it
	}
	return out.join(eol);
}

/** Every document under `docs/`, which is where a guide lives. */
function guides(folder: string): string[] {
	const found: string[] = [];
	for (const entry of readdirSync(folder).sort()) {
		if (entry.startsWith('.') || entry === 'node_modules') {
			continue;
		}
		const path = join(folder, entry);
		if (statSync(path).isDirectory()) {
			found.push(...guides(path));
		} else if (entry.endsWith('.md')) {
			found.push(path);
		}
	}
	return found;
}

function main(): void {
	let converted = 0;
	const waiting: string[] = [];
	for (const file of guides(join(root, 'docs'))) {
		const text = readFileSync(file, 'utf8');
		const exists = (path: string): boolean => existsSync(join(dirname(file), path));
		const after = picturesForSlots(text, exists);
		// The same fence rule as the conversion above: a sample of the convention is not a picture to wait for.
		let fenced = false;
		for (const line of text.split(/\r?\n/u)) {
			if (line.trimStart().startsWith('```')) {
				fenced = !fenced;
				continue;
			}
			const path = SLOT_PATH.exec(line);
			if (!fenced && path !== null && !exists(path[1])) {
				waiting.push(`${relative(root, file)} → ${path[1]}`);
			}
		}
		if (after === text) {
			continue;
		}
		const before = text.split(/\r?\n/u).length;
		converted += before - after.split(/\r?\n/u).length;
		writeFileSync(file, after, 'utf8');
		console.log(`wrote ${relative(root, file)}`);
	}

	console.log(`\n${converted} slot(s) converted into pictures.`);
	if (waiting.length > 0) {
		console.log(`${waiting.length} slot(s) still waiting for their picture, saved where the guide says:`);
		for (const one of waiting.sort()) {
			console.log(`  ${one}`);
		}
		console.log('Save the PNGs at those paths, then run this again.');
	}
}

if (process.argv[1] !== undefined && resolve(process.argv[1]) === resolve(fileURLToPath(import.meta.url))) {
	main();
}
