// What counts as a project on disk.
//
// One question, answered without the editor: a folder in the projects folder is a project when it carries the registry
// the platform reads — `docs/help/registry.json`. Nothing here opens the catalog, asks the editor anything or writes:
// the same function is what the module uses to find them and what the tests point at a folder to prove the rule.
//
// The slug rule is passed in rather than imported. It is the store's (`slugOf`), and the store's module reaches for the
// editor at load time; a scan that took the rule as an argument stays a function of a path.

import * as fs from 'fs';
import * as path from 'path';

/** A folder that is a project, as the disk describes it. */
export interface FoundProject {
	/** The folder itself. */
	folder: string;
	/** The name the catalog keys a project by. */
	slug: string;
	/** The name a person reads: `package.json`'s `name`, or the folder's own. */
	name: string;
	/** `package.json`'s `version`, when the folder carries one. */
	version?: string;
}

/** The file that says a folder is a project: the registry `temco-docs` reads. */
export const PROJECT_MARKER = path.join('docs', 'help', 'registry.json');

/**
 * What a catalog row should say, given the folder it points at — or `undefined` when the two already agree.
 *
 * The folder's `package.json` is the project's own answer to what it is called and which version it is, and a row written
 * before that manifest existed — a project created `blank` and then filled in — says something else. Only what the folder
 * can answer for is corrected: a project with no manifest has no opinion, so its version is left exactly as it was rather
 * than cleared. `audience` and `owner` are a person's answers and are not this function's business at all.
 */
export function correctionFor(
	held: { name: string; version?: string },
	project: FoundProject
): { name: string; version?: string } | undefined {
	const name = project.name !== '' && project.name !== held.name ? project.name : held.name;
	const version = project.version !== undefined ? project.version : held.version;
	if (name === held.name && version === held.version) {
		return undefined;
	}
	return { name, version };
}

/**
 * Every project in `root`, in folder order.
 *
 * One level deep, because that is the shape the create form makes: `<projects folder>/<slug>`. A project nested inside
 * a project is not a thing the platform has a model for, so a folder inside one is not looked at.
 */
export function findProjects(root: string, slugOf: (text: string) => string): FoundProject[] {
	let entries: fs.Dirent[];
	try {
		entries = fs.readdirSync(root, { withFileTypes: true });
	} catch {
		// A projects folder that is not there yet is not an error: it is a first run.
		return [];
	}

	const found: FoundProject[] = [];
	for (const entry of entries) {
		if (!entry.isDirectory() || entry.name.startsWith('.')) {
			continue;
		}
		const folder = path.join(root, entry.name);
		if (!fs.existsSync(path.join(folder, PROJECT_MARKER))) {
			continue;
		}
		const manifest = readManifest(folder);
		const name = manifest.name ?? entry.name;
		found.push({
			folder,
			slug: slugOf(name) || slugOf(entry.name) || entry.name.toLowerCase(),
			name,
			version: manifest.version
		});
	}
	return found;
}

/** `name` and `version` from a folder's `package.json`, when it has one that parses. */
function readManifest(folder: string): { name?: string; version?: string } {
	try {
		const text = fs.readFileSync(path.join(folder, 'package.json'), 'utf8');
		const parsed = JSON.parse(text) as { name?: unknown; version?: unknown };
		return {
			name: typeof parsed.name === 'string' && parsed.name.trim().length > 0 ? parsed.name.trim() : undefined,
			version: typeof parsed.version === 'string' && parsed.version.trim().length > 0 ? parsed.version.trim() : undefined
		};
	} catch {
		// No manifest, or one that is not JSON: the folder's own name is the name, and the version is the form's default.
		return {};
	}
}
