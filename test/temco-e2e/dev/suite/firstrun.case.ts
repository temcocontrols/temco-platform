/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

// A first run: one person, a window that has never been opened, and the guide's own steps in order.
//
// The other suites answer questions about rules. This one is a session: nothing is set up, nothing is recorded, and every
// step uses what the step before it produced. It is the only place where the modules meet each other — the projects module
// decides where the folder goes, the starter's own scripts build it with a real `node`, the learn module recognises that
// build as the project it belongs to, and the catalog keeps the record — and each of those is the real compiled module,
// not a copy.
//
// The order of the cases is the point, so they share one throwaway home and run in sequence. A failure early on is
// reported once, and the steps after it fail with the reason.

import * as assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import * as fs from 'node:fs';
import { createRequire } from 'node:module';
import * as os from 'node:os';
import * as path from 'node:path';
import * as vscode from 'vscode';

const repo = process.env['TEMCO_REPO'];
if (typeof repo !== 'string' || repo.length === 0) {
	throw new Error('TEMCO_REPO is not set, so the compiled modules cannot be reached');
}

const require_ = createRequire(__filename);

/** The compiled module a step uses: the same code the window runs, loaded from the same place. */
const module_ = (...parts: string[]): any => require_(path.join(repo as string, 'extensions', ...parts));

interface Writing {
	writeTemplate(
		extensionUri: vscode.Uri,
		folder: vscode.Uri,
		name: string,
		version: string,
		template: string
	): Promise<string | undefined>;
	defaultFolder(): string;
}

interface Area {
	projectFolder(project: string): string;
}

interface Found {
	folder: string;
	title: string;
	id: string;
}

interface Adding {
	importBuild(options: { repo: string; id: string; title: string; version: string; built: string }): Promise<{
		project: string;
		version: string;
		pages: number;
	}>;
}

/**
 * The modules are loaded only after they are active.
 *
 * `projectFlow` throws at load time when the repositories module is not there — by design, "the module is not available"
 * is better than half a form. So the handles are filled in by `loading()`, which activates them first: a first run has
 * to start with the same activation the window does, in the same order.
 */
let projectsFlow: Writing;
let workarea: Area;
let builds: { findBuilds(): Promise<Found[]> };
let site: Adding;

let ready: Promise<void> | undefined;

function loading(): Promise<void> {
	ready =
		ready ??
		(async () => {
			for (const id of [
				'temcocontrols.temco-store',
				'temcocontrols.temco-repositories',
				'temcocontrols.temco-projects',
				'temcocontrols.temco-learn'
			]) {
				const extension = vscode.extensions.getExtension(id);
				if (extension === undefined) {
					throw new Error(`${id} is not installed, so a first run cannot get past the first step`);
				}
				await extension.activate();
			}
			projectsFlow = module_('temco-projects', 'out', 'projectFlow.js') as Writing;
			workarea = module_('temco-repositories', 'out', 'workarea.js') as Area;
			builds = module_('temco-learn', 'out', 'builds.js') as { findBuilds(): Promise<Found[]> };
			site = module_('temco-learn', 'out', 'site.js') as Adding;
		})();
	return ready;
}

/** One person's machine, as far as this run is concerned: thrown away afterwards. */
const home = fs.mkdtempSync(path.join(os.tmpdir(), 'temco-first-run-'));
const area = path.join(home, 'docs-work');
const projects = path.join(home, 'projects');
const siteRepo = path.join(home, 'site');

const name = 'T3000 Platform';
const slug = 't3000-platform';
const project = path.join(projects, slug);
const built = path.join(project, 'dist', 'docs');

/** The window's own configuration service, which is what a Settings page writes through. */
const configuration = (section: string) => vscode.workspace.getConfiguration(section);

/** The store's extension object; its exports are only read once it is active, which `loading()` guarantees. */
const store = vscode.extensions.getExtension('temcocontrols.temco-store');

interface Catalog {
	createDocument(document: { name: string; slug: string; version?: string; origin?: string; template?: string }): number;
	addSource(source: { kind: 'folder'; name: string; slug: string; path: string }): number;
	setDocumentSources(slug: string, sources: readonly string[]): void;
	setRecipe(slug: string, engine: string, outputs: string[]): void;
	documents(): { name: string; slug: string }[];
	document(slug: string): {
		name: string;
		version?: string;
		origin?: string;
		engine?: string;
		outputs: string[];
		sources: { name: string }[];
	} | undefined;
	close(): void;
}

const catalog = async (): Promise<Catalog> => (store!.exports as { catalog(): Promise<Catalog> }).catalog();

interface Case {
	name: string;
	run: () => Promise<void>;
}

const cases: Case[] = [];

cases.push({
	name: 'a window that has never been opened has no projects folder and an empty catalog',
	run: async () => {
		await loading();
		// The setting's own default is the empty string, and empty is what "nobody has chosen yet" looks like: the
		// platform reads a blank as "use the working area", never as a folder called "".
		assert.equal(
			String(configuration('temcoRepositories').get<string>('projectsFolder') ?? '').trim(),
			'',
			'nothing has been chosen yet, and an unset setting is not a default written behind the person'
		);

		const held = await catalog();
		try {
			assert.deepEqual(held.documents(), [], 'a new profile knows no projects');
		} finally {
			held.close();
		}
	}
});

cases.push({
	name: 'the person says where projects go, and the form follows that answer',
	run: async () => {
		await loading();
		// Two settings, the two the guide's "where things go" section names: where projects live, and where clones live.
		// A throwaway area on both sides keeps this run out of the person's real `~/temco`.
		await configuration('temcoRepositories').update('workspaceFolder', area, vscode.ConfigurationTarget.Global);
		await configuration('temcoRepositories').update('projectsFolder', projects, vscode.ConfigurationTarget.Global);

		assert.equal(projectsFlow.defaultFolder(), projects, 'the form opens on the folder the person chose');
		assert.equal(workarea.projectFolder(name), project, 'a project is a folder named after it, inside the projects folder');
	}
});

cases.push({
	name: 'a project made from the starter is a folder that can build itself, and it is recorded',
	run: async () => {
		await loading();
		const extension = vscode.extensions.getExtension('temcocontrols.temco-projects');
		assert.ok(extension !== undefined, 'the module that makes projects is installed');

		const refused = await projectsFlow.writeTemplate(extension.extensionUri, vscode.Uri.file(project), name, '1.0', 'user-guide');
		assert.equal(refused, undefined, refused);

		for (const file of ['package.json', 'docs/help/registry.json', 'docs/overview/index.md', 'scripts/docs-registry.mjs', 'scripts/docs-site.mjs']) {
			assert.ok(fs.existsSync(path.join(project, ...file.split('/'))), `the starter wrote ${file}`);
		}

		// Recorded the way the create command records it: the same calls, in the same order, on the profile's own catalog.
		const held = await catalog();
		try {
			held.createDocument({ name, slug, version: '1.0', origin: 'template', template: 'user-guide' });
			held.addSource({ kind: 'folder', name: `${name} pages`, slug: `${slug}-pages`, path: project });
			held.setDocumentSources(slug, [`${slug}-pages`]);
			held.setRecipe(slug, 'docfx', ['website']);

			const recorded = held.document(slug);
			assert.ok(recorded !== undefined);
			assert.deepEqual(
				{ origin: recorded.origin, engine: recorded.engine, outputs: recorded.outputs },
				{ origin: 'template', engine: 'docfx', outputs: ['website'] },
				'how the project began and how it is built are both on the record'
			);
		} finally {
			held.close();
		}
	}
});

cases.push({
	name: 'the project builds its own site with the scripts the starter gave it',
	run: async () => {
		await loading();
		// The starter's own two scripts, run by the same node the window runs on: generate the registry, then render.
		execFileSync(process.execPath, ['scripts/docs-registry.mjs'], { cwd: project, stdio: 'pipe' });
		execFileSync(process.execPath, ['scripts/docs-site.mjs'], { cwd: project, stdio: 'pipe' });

		const index = path.join(built, 'index.html');
		assert.ok(fs.existsSync(index), 'the build the guide calls "build the site" left a site behind');
		assert.match(fs.readFileSync(index, 'utf8'), /T3000 Platform/u, 'the person\'s own name is in their own site');

		const registry = JSON.parse(fs.readFileSync(path.join(project, 'docs', 'help', 'registry.json'), 'utf8')) as { pages: Record<string, unknown> };
		assert.ok(Object.keys(registry.pages).length > 0, 'the generator indexed the pages it found');
	}
});

cases.push({
	name: 'the platform recognises that build as this project, without being told which one it is',
	run: async () => {
		await loading();
		const found = await builds.findBuilds();
		const mine = found.filter(build => build.id === slug);
		assert.equal(mine.length, 1, `one build for ${slug}, found by walking the projects folder`);
		assert.equal(mine[0].title, 'T3000 Platform');
		assert.equal(mine[0].folder, built);
	}
});

cases.push({
	name: 'the build goes onto the site as a version, and the site says what it is',
	run: async () => {
		await loading();
		const added = await site.importBuild({ repo: siteRepo, id: slug, title: name, version: '1.0', built });
		assert.equal(added.project, slug);
		assert.equal(added.version, '1.0');
		assert.ok(added.pages >= 1, 'the pages the build wrote are the pages the site gets');

		const published = path.join(siteRepo, 'public', 'imported', slug, '1.0', 'index.html');
		assert.ok(fs.existsSync(published), 'the build is copied, not referenced: the site is a repository of its own');

		const described = JSON.parse(fs.readFileSync(path.join(siteRepo, 'content', slug, 'site.json'), 'utf8')) as { title?: string; section?: string };
		assert.equal(described.title, name, 'the site names the project the way the person does');
		assert.equal(typeof described.section, 'string', 'and files it under a section the reader can find');
	}
});

cases.push({
	name: 'the project is still there when the window is opened again',
	run: async () => {
		await loading();
		const held = await catalog();
		try {
			const again = held.document(slug);
			assert.ok(again !== undefined, 'the record is in a file, not in the window');
			assert.deepEqual(again.sources.map(source => source.name), [`${name} pages`]);
			assert.equal(again.version, '1.0');
		} finally {
			held.close();
		}

		assert.ok(fs.existsSync(path.join(project, 'dist', 'docs', 'index.html')), 'and so is the build it made');
	}
});

/** The run's own folder goes when the run does, whether or not a case failed. */
process.on('exit', () => {
	try {
		fs.rmSync(home, { recursive: true, force: true });
	} catch {
		// A temp folder that outlives the run is untidy, not a failure.
	}
});

export { cases };
