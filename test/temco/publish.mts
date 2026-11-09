/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

// The publish guard, run against a site that is really broken.
//
// The guide says a publish is refused when the site is missing a download, and that the guard is the reason a deploy
// cannot quietly serve last month's PDFs. Reading the guard does not prove that: it proves somebody wrote the check.
// What proves it is a catalog and a `public/` tree with one file taken out, and the guard exiting non-zero with the
// missing path in its message.
//
// The guard is the site's own script, not a copy of it — `check-artifacts.mts` is copied out of the site clone into a
// throwaway folder and run there, so what is tested is what will run in CI. Its message is checked, because a guard that
// fails for the wrong reason is a guard nobody trusts.
//
// The site lives in another repository, so this skips itself — loudly — when there is no clone on this machine. Set
// `TEMCO_SITE` to point at one somewhere else. Run from the repository root.

import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { copyFileSync, existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { homedir, tmpdir } from 'node:os';
import { join } from 'node:path';
import { suite, standalone } from './harness.mts';

/** Where a site clone may be, in the order it is looked for. */
const CANDIDATES = [
	process.env['TEMCO_SITE'],
	join(homedir(), 'temco', 'source', 'temco-learn'),
	join(homedir(), 'temco', 'temco-learn'),
	join(homedir(), 'temco-learn')
].filter((path): path is string => typeof path === 'string' && path.length > 0);

const site = CANDIDATES.find(path => existsSync(join(path, 'scripts', 'check-artifacts.mts')));

/** A site-in-miniature: one project, one version, one authored page and one imported build. */
interface World {
	root: string;
	keep: string;
}

function world(): World {
	const root = mkdtempSync(join(tmpdir(), 'temco-publish-'));
	mkdirSync(join(root, 'scripts'), { recursive: true });
	copyFileSync(join(site as string, 'scripts', 'check-artifacts.mts'), join(root, 'scripts', 'check-artifacts.mts'));
	return { root, keep: root };
}

function write(file: string, content = 'x'): void {
	mkdirSync(join(file, '..'), { recursive: true });
	writeFileSync(file, content);
}

/** The catalog the site's own `catalog.mts` would write: an authored page, and a build imported from a project. */
function catalog(place: World, pages: { href: string; kind: 'md' | 'build' }[] = [{ href: 'intro', kind: 'md' }, { href: 'manual', kind: 'build' }]): void {
	write(
		join(place.root, 'public', 'catalog.json'),
		JSON.stringify({ projects: [{ id: 't3000', versions: [{ version: '1.0', pages }] }] }, undefined, 2)
	);
}

function manifest(place: World, chm: boolean): void {
	write(join(place.root, 'public', 'download', 'manifest.json'), JSON.stringify({ projects: { t3000: { '1.0': { chm } } } }, undefined, 2));
}

/** Every download the catalog promises, present on disk. */
function downloads(place: World): void {
	write(join(place.root, 'public', 'pdf', 't3000', '1.0.pdf'), '%PDF');
	write(join(place.root, 'public', 'pdf', 't3000', '1.0', 'intro.pdf'), '%PDF');
	write(join(place.root, 'public', 'chm', 't3000', '1.0.chm'), 'CHM');
	catalog(place);
	manifest(place, true);
}

function guard(place: World): { code: number; said: string } {
	const run = spawnSync(process.execPath, ['--experimental-strip-types', join('scripts', 'check-artifacts.mts')], {
		cwd: place.root,
		encoding: 'utf8'
	});
	return { code: run.status ?? -1, said: `${run.stdout}${run.stderr}` };
}

const group = suite();
const test = (name: string, run: () => Promise<void> | void): void => {
	if (site !== undefined) {
		group.test(name, run);
	}
};

// With no clone there is nothing to run the guard from, so say so as a case rather than a silent zero.
if (site === undefined) {
	group.test('the publish guard cases are skipped: no site clone on this machine', () => {
		console.log(`        set TEMCO_SITE to one; looked in ${CANDIDATES.join(', ')}`);
	});
}

// ---------- what the guard must refuse ----------

test('a site whose downloads are all committed passes', async () => {
	const place = world();
	try {
		downloads(place);
		const { code, said } = guard(place);
		assert.equal(code, 0, said);
		assert.match(said, /every download has a file/);
	} finally {
		rmSync(place.keep, { recursive: true, force: true });
	}
});

test('a whole-guide PDF that was never built stops the deploy', async () => {
	const place = world();
	try {
		downloads(place);
		rmSync(join(place.root, 'public', 'pdf', 't3000', '1.0.pdf'));
		const { code, said } = guard(place);
		assert.equal(code, 1, 'a missing PDF must fail the guard');
		assert.match(said, /pdf\/t3000\/1\.0\.pdf/, 'the message names the file to build');
		assert.match(said, /run `npm run build`/);
	} finally {
		rmSync(place.keep, { recursive: true, force: true });
	}
});

test('the per-page PDFs are promised too: one missing page stops the deploy', async () => {
	const place = world();
	try {
		downloads(place);
		rmSync(join(place.root, 'public', 'pdf', 't3000', '1.0', 'intro.pdf'));
		const { code, said } = guard(place);
		assert.equal(code, 1);
		assert.match(said, /pdf\/t3000\/1\.0\/intro\.pdf/);
	} finally {
		rmSync(place.keep, { recursive: true, force: true });
	}
});

test('an imported build needs no page PDF of its own', async () => {
	const place = world();
	try {
		downloads(place);
		const { code, said } = guard(place);
		assert.equal(code, 0, said);
	} finally {
		rmSync(place.keep, { recursive: true, force: true });
	}
});

test('a download menu that promises a .chm nobody compiled stops the deploy', async () => {
	const place = world();
	try {
		downloads(place);
		rmSync(join(place.root, 'public', 'chm', 't3000', '1.0.chm'));
		const { code, said } = guard(place);
		assert.equal(code, 1);
		assert.match(said, /promises a \.chm for t3000\/1\.0/);
	} finally {
		rmSync(place.keep, { recursive: true, force: true });
	}
});

test('a .chm on disk that the menu does not list stops the deploy', async () => {
	const place = world();
	try {
		downloads(place);
		manifest(place, false);
		const { code, said } = guard(place);
		assert.equal(code, 1);
		assert.match(said, /does not list it/);
	} finally {
		rmSync(place.keep, { recursive: true, force: true });
	}
});

test('with no catalog there is nothing to check, so the guard says what to run', async () => {
	const place = world();
	try {
		const { code, said } = guard(place);
		assert.equal(code, 1);
		assert.match(said, /public\/catalog\.json is missing — run `npm run catalog` first/);
	} finally {
		rmSync(place.keep, { recursive: true, force: true });
	}
});

// ---------- the cases ----------

await standalone(
	import.meta.url,
	group.cases,
	site === undefined ? 'the publish guard — skipped, no site clone on this machine' : `the publish guard, from the site at ${site}`
);
