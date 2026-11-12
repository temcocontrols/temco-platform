// The projects module's entry point.
//
// A project is a documentation project: a name, a version, an audience, an owner, the sources it is made of, the
// outputs it produces, and what building it left behind. This module owns all of that — the list, the edit page,
// the hub, and the build that produces an output.
//
// Two things are deliberately *not* here:
//
//   * what a page of documentation is. The registry, its checks and the pages themselves belong to `temco-docs`;
//     this module reads the pages a project *has* from the platform's memory, where a read recorded them.
//   * the sources themselves. Reading one, cloning one and running one's own scripts belong to
//     `temco-repositories`; this module names a source in a project and records what its build produced.
//
// Nothing is written to a repository. A build is invoked in the source's own folder and judged by the files it
// left behind, never by an exit code, and the deploying form of the help build is never invoked.

import * as vscode from 'vscode';
import { registerDiscoverCommand } from './discover';
import { registerProjectCommands } from './project';
import { registerProjectBuildCommands } from './projectBuild';
import { selection } from './store';

/** What this module offers the rest of the platform. */
export interface TemcoProjectsApi {
	/** Fires when a project or its sources changed: created, edited, removed, or built. */
	onDidChange(listener: () => void): vscode.Disposable;
}

export function activate(context: vscode.ExtensionContext): TemcoProjectsApi {
	const output = vscode.window.createOutputChannel('Temco Projects');
	// One signal for the surfaces that list projects: the Library's rows re-read when a project changes.
	const changed = new vscode.EventEmitter<void>();
	context.subscriptions.push(output, changed);
	const refresh = (): void => changed.fire();

	// The project's own acts: create, edit, remove, work on one, add a source to it. The redraw it hands back is the
	// one that repaints the list, which is why it is passed on rather than the module's own signal.
	const projects = registerProjectCommands(context, selection, refresh);
	// Finding the projects that exist on disk but not in the catalog: a folder made by another build, or copied in.
	registerDiscoverCommand(context, projects.redraw);
	// Building a project's outputs, invoked in the source repository that owns the script.
	registerProjectBuildCommands(context, output);

	// S1: a window that is not working on a project and has no tab open has nothing to look at, so the list of
	// projects comes forward — the one place a project is chosen. Both halves of the condition matter: a window
	// restored with tabs keeps them, and a window that is on a project keeps that tab, so this happens on a first
	// run and never again.
	if (selection.project() === undefined && vscode.window.tabGroups.all.every((group) => group.tabs.length === 0)) {
		void vscode.commands.executeCommand('workbench.view.extension.temcoDashboard').then(() =>
			vscode.commands.executeCommand('temcoProjects.projects.focus')
		);
	}

	return {
		onDidChange: (listener: () => void) => changed.event(listener),
	};
}

export function deactivate(): void {
	// Nothing to unwind: the pages are webviews the window closes, and every command is registered on the
	// extension's own context. A build task that was already running finishes on its own.
}
