// Finding the projects that exist on disk but not in the catalog.
//
// A project is a row in the catalog, and a row is only ever written by the create form — so a folder that was made some
// other way (an earlier build, a copy from another machine, a folder a person placed by hand) is invisible: the list
// draws rows, not folders, and there is nothing to draw. This is the other half of `projectScan.ts`: it takes what the
// scan found and records the ones the catalog does not know.
//
// Nothing is removed and nothing is overwritten. A project the catalog already knows is skipped by slug, and a source
// slug already taken by a *different* folder is reported rather than reused, because reusing it would point an old
// project at a new folder.

import * as path from 'path';
import * as vscode from 'vscode';
import { correctionFor, PROJECT_MARKER, findProjects, FoundProject } from './projectScan';
import { projectsRoot } from './repositories';
import { Catalog, CatalogUnavailable, outputs, slugOf } from './store';

/** What a scan did, so the caller can say it in one sentence. */
export interface ScanOutcome {
	added: RegisteredProject[];
	/** Projects the catalog knew, whose folder now says a different name or version. */
	corrected: CorrectedProject[];
	known: FoundProject[];
	/** Projects whose folder name is already a source that points somewhere else: reported, never written over. */
	conflicts: FoundProject[];
	/** The folder that was looked in. */
	root: string;
}

/** A project that was recorded, with the source the registry is read from. */
export interface RegisteredProject {
	project: FoundProject;
	sourceSlug: string;
}

/** A catalog row that disagreed with the folder it points at, and what it now says. */
export interface CorrectedProject {
	project: FoundProject;
	/** What the catalog said before, as a person reads it: `1.0`. */
	was: { name: string; version?: string };
}

/** Every project in the projects folder, whether or not the catalog knows it. */
export function scanProjects(root: string = projectsRoot()): FoundProject[] {
	return findProjects(root, slugOf);
}

/**
 * Records every project in the projects folder that the catalog does not know, and corrects the ones it knows wrongly.
 *
 * The four writes per new project are the create form's own: a source for the folder, the project row, the citation
 * between them, and the recipe that says how it is built. Nothing else is invented — no pages, no drafts, no build —
 * because a project found on disk already has an answer to all of those.
 *
 * A project the catalog already knows is not skipped outright: its folder's `package.json` is the project's own answer
 * to what it is called and which version it is, and a row written before that manifest existed — a project created
 * `blank` and then filled in — says something else. The version is corrected from the manifest, and only from the
 * manifest: a project with no `package.json` keeps whatever the catalog says, because there is nothing to prefer.
 */
export async function registerFoundProjects(context: vscode.ExtensionContext, root?: string): Promise<ScanOutcome> {
	const folder = root ?? projectsRoot();
	const found = findProjects(folder, slugOf);
	const outcome: ScanOutcome = { added: [], corrected: [], known: [], conflicts: [], root: folder };
	if (found.length === 0) {
		return outcome;
	}

	let catalog: Catalog | undefined;
	try {
		catalog = await Catalog.open(context);
		const store = catalog;
		const known = new Set(store.documents().map((row) => row.slug));

		for (const project of found) {
			if (known.has(project.slug)) {
				const held = store.document(project.slug);
				const corrected = held === undefined ? undefined : correctionFor(held, project);
				if (held === undefined || corrected === undefined) {
					outcome.known.push(project);
					continue;
				}
				// `audience` and `owner` are a person's answers, so they are carried across rather than cleared: this is a
				// correction of what the folder says about itself, not a re-creation of the project.
				store.createDocument({
					name: corrected.name,
					slug: project.slug,
					version: corrected.version,
					audience: held.audience,
					owner: held.owner,
					origin: held.origin
				});
				outcome.corrected.push({ project, was: { name: held.name, version: held.version } });
				continue;
			}

			const sourceSlug = slugOf(path.basename(project.folder)) || project.slug;
			const existing = store.source(sourceSlug);
			const taken = existing !== undefined && existing.path !== undefined
				&& path.resolve(existing.path).toLowerCase() !== path.resolve(project.folder).toLowerCase();
			if (taken) {
				outcome.conflicts.push(project);
				continue;
			}

			store.addSource({ kind: 'folder', name: project.name, slug: sourceSlug, path: project.folder });
			store.createDocument({
				name: project.name,
				slug: project.slug,
				version: project.version,
				origin: 'folder'
			});
			store.setDocumentSources(project.slug, [sourceSlug]);
			store.setRecipe(project.slug, 'docfx', [...outputs.defaults]);
			outcome.added.push({ project, sourceSlug });
		}
	} finally {
		catalog?.close();
	}

	return outcome;
}

/** The sentence a person reads after a scan. */
export function outcomeLine(outcome: ScanOutcome): string {
	if (
		outcome.added.length === 0 &&
		outcome.corrected.length === 0 &&
		outcome.known.length === 0 &&
		outcome.conflicts.length === 0
	) {
		return `No projects found in ${outcome.root}. A project is a folder with ${PROJECT_MARKER.replace(/\\/g, '/')} in it.`;
	}
	const parts: string[] = [];
	if (outcome.added.length > 0) {
		parts.push(`${outcome.added.length} added (${outcome.added.map((entry) => entry.project.name).join(', ')})`);
	}
	if (outcome.corrected.length > 0) {
		parts.push(
			`${outcome.corrected.length} corrected (` +
				outcome.corrected
					.map((entry) => {
						const now = [entry.project.name, entry.project.version].filter((part) => part !== undefined && part !== '');
						const before = [entry.was.name, entry.was.version].filter((part) => part !== undefined && part !== '');
						return `${before.join(' · ')} → ${now.join(' · ')}`;
					})
					.join(', ') +
				')'
		);
	}
	if (outcome.known.length > 0) {
		parts.push(`${outcome.known.length} already in the catalog`);
	}
	if (outcome.conflicts.length > 0) {
		parts.push(
			`${outcome.conflicts.length} skipped — the name is already a folder that points elsewhere ` +
			`(${outcome.conflicts.map((project) => project.folder).join(', ')})`
		);
	}
	return parts.join(' · ');
}

/**
 * The command: scan, record, say what happened — and offer the read that makes the project usable.
 *
 * A button rather than a start-up side effect. Recording a project is a write, and a window that wrote rows nobody
 * asked for would make "where did this project come from" a question with no answer. The list shows that the folder
 * has projects in it, so the act is one click from the place the absence was noticed.
 *
 * The read is offered, not done. A row with no source read shows no pages, which looks like an empty project; but a
 * read walks a folder that may hold a thousand files, so it is the second click, not a side effect of the first.
 */
export function registerDiscoverCommand(context: vscode.ExtensionContext, refresh: () => void): void {
	context.subscriptions.push(
		vscode.commands.registerCommand('temcoProjects.discover', async () => {
			try {
				const outcome = await registerFoundProjects(context);
				refresh();
				const line = `Temco Projects: ${outcomeLine(outcome)}`;
				if (outcome.added.length === 0) {
					void vscode.window.showInformationMessage(line);
					return;
				}
				const read = `Read the ${outcome.added.length === 1 ? 'Folder' : 'Folders'} Now`;
				const answer = await vscode.window.showInformationMessage(line, read, 'Show the Projects');
				if (answer === read) {
					for (const entry of outcome.added) {
						await vscode.commands.executeCommand('temcoRepositories.readSource', entry.sourceSlug);
					}
					refresh();
					return;
				}
				if (answer !== undefined) {
					await vscode.commands.executeCommand('temcoProjects.projects.focus');
				}
			} catch (error) {
				const message = error instanceof CatalogUnavailable ? error.message : String(error);
				void vscode.window.showErrorMessage(`Temco Projects: ${message}`);
			}
		})
	);
}
