// The builds a project has already written, found rather than asked for.
//
// `temco-docs` builds a project into `<project>/dist/site`; a product repository's own generator usually writes
// `dist/docs` instead, and a project made here may do either. Both are looked for, because the folder name is the
// generator's choice and not this module's. A build that is sitting on disk not on the site is a fact worth showing —
// it is the difference between "Add to Site" meaning something and "Add to Site" being a button that either works or
// complains.

import * as fs from 'fs';
import * as path from 'path';
import * as vscode from 'vscode';
import { projectNameOf, projectsRoot, slugOf, workRoot } from './site';

export interface Build {
	/** The folder that holds `index.html`: what gets copied into the site. */
	folder: string;
	/** The name the build gives itself in its own index, or the folder it was found in. */
	title: string;
	/** The project id it is added under: named by the folder the build sits in, and by the title only outside one. */
	id: string;
	/** When the build was last written. */
	at: number;
}

/** The two folders a documentation generator writes its site into: this module's own, and docfx's. */
const OUTPUTS = [
	path.join('dist', 'site'),
	path.join('dist', 'docs')
];

/** Folders a walk never descends into: a build output is never inside one of these. */
const SKIP = new Set(['node_modules', 'dist', 'out', 'target', 'bin', 'obj', 'src', 'docs', '.git', '.vs', '.venv']);

/**
 * Every build on disk, newest first.
 *
 * The roots are the window's folders, the working area and the projects folder — a project may sit in either of the last
 * two. Each is walked two levels deep, which is where both arrangements put a build: `<root>/<project>/dist/site` for a
 * project made here, and `<root>/source/<repository>/dist/docs` for a clone the repositories module made.
 */
export async function findBuilds(): Promise<Build[]> {
	const roots = new Set<string>([
		...(vscode.workspace.workspaceFolders ?? []).map((folder) => folder.uri.fsPath),
		workRoot(),
		projectsRoot()
	]);
	const found: Build[] = [];
	for (const root of roots) {
		for (const folder of await buildFolders(root)) {
			if (!fs.existsSync(path.join(folder, 'index.html'))) {
				continue;
			}
			const fallback = path.basename(path.dirname(path.dirname(folder)));
			const title = (await projectNameOf(folder)) ?? fallback;
			found.push({ folder, title, id: idOf(folder, title), at: fs.statSync(folder).mtimeMs });
		}
	}
	return found.sort((one, other) => other.at - one.at);
}

/**
 * The project a build belongs to, read from where it sits rather than from what its pages call themselves.
 *
 * `<projectsFolder>/t3000/dist/site` is the folder `t3000` that the authoring module made, and
 * `<workRoot>/source/temco-html/dist/docs` is a clone of that repository — both name the project, and neither name
 * changes when somebody edits a page title. A title is prose and prose gets corrected, so deriving the id from it turns
 * a rename into a second project on the site with an empty history instead of a new version of the first. Only a build
 * outside both of those places falls back to its title.
 */
function idOf(folder: string, title: string): string {
	// The clones are asked first: with no `projectsFolder` set the projects folder *is* the working area, so
	// `<workRoot>/source` would otherwise read as a project called `source` and every clone would collide under one id.
	const clone = firstFolder(path.join(workRoot(), 'source'), folder);
	if (clone !== undefined) {
		return slugOf(clone);
	}
	const project = firstFolder(projectsRoot(), folder);
	if (project !== undefined && !NOT_PROJECTS.has(project)) {
		return slugOf(project);
	}
	return slugOf(title);
}

/** Folders that sit directly under a root without being a project: the shared clones, and a projects folder below one. */
const NOT_PROJECTS = new Set(['source', 'projects', 'dist', 'out']);

/** The folder something sits inside, when it really is below `base` rather than beside it or on another drive. */
function firstFolder(base: string, folder: string): string | undefined {
	const rest = path.relative(base, folder);
	if (rest === '' || path.isAbsolute(rest) || rest.startsWith('..')) {
		return undefined;
	}
	return rest.split(path.sep)[0];
}

/** Every `dist/site` and `dist/docs` under one root, at its own level and two below it. */
async function buildFolders(root: string): Promise<string[]> {
	const at = (base: string): string[] => OUTPUTS.map((output) => path.join(base, output));
	const found = [...at(root)];
	for (const first of await subfolders(root)) {
		found.push(...at(path.join(root, first)));
		for (const second of await subfolders(path.join(root, first))) {
			found.push(...at(path.join(root, first, second)));
		}
	}
	return found;
}

async function subfolders(root: string): Promise<string[]> {
	try {
		return (await fs.promises.readdir(root, { withFileTypes: true }))
			.filter((entry) => entry.isDirectory() && !entry.name.startsWith('.') && !SKIP.has(entry.name))
			.map((entry) => entry.name);
	} catch {
		return [];
	}
}
