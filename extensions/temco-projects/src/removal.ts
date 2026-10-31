// Removing a project also removes what it left on this machine.
//
// A project is a row in the catalog, and the row is all the rest of the platform reads — which is why removing it
// used to be the whole act. But the project also owns a folder in the working area (`~/temco/<slug>` by default):
// the clones it fetched and what we made from them. Leaving that behind means the Library forgets a project while
// the disk keeps it, and the next project with the same name inherits a stranger's clones.
//
// The folder is owned by `temco-repositories`, which owns the working area; this module only knows which project the
// application follows. So the two halves are asked for by command — what the folder is, then delete it — and the
// confirmation names the folder before anything happens, because that is the part a person cannot undo.

import * as vscode from 'vscode';

/** The folder a project owns on this machine, and whether it is there. */
export interface ProjectWorkFolder {
  folder: string;
  exists: boolean;
}

/**
 * The folder a project owns, asked of the module that owns the working area.
 *
 * `undefined` means this window has no such module — then there is no working area to speak of, and a project is
 * still removable.
 */
export async function workFolderOf(slug: string): Promise<ProjectWorkFolder | undefined> {
  try {
    return await vscode.commands.executeCommand<ProjectWorkFolder | undefined>(
      'temcoRepositories.projectWorkFolder',
      slug
    );
  } catch {
    return undefined;
  }
}

/** The sentence a confirmation uses for the folder: what will be deleted, or why there is nothing to delete. */
export function folderConsequence(workFolder: ProjectWorkFolder | undefined): string {
  if (workFolder === undefined) {
    return '';
  }
  return workFolder.exists
    ? `${workFolder.folder} — the folder this project owns, with its local copies — is deleted from this machine.`
    : `It has no folder on this machine (${workFolder.folder}), so only what the catalog recorded goes.`;
}

/** Deletes the folder, and answers whether it is really gone. */
export async function discardWorkFolder(
  slug: string,
  workFolder: ProjectWorkFolder | undefined
): Promise<boolean> {
  if (workFolder?.exists !== true) {
    return false;
  }
  try {
    return (await vscode.commands.executeCommand<boolean>('temcoRepositories.deleteProjectFolder', slug)) === true;
  } catch (error) {
    // The row is already gone, so this is said as a warning about what is left on the disk rather than as a failure
    // of the removal.
    void vscode.window.showWarningMessage(
      `Temco Projects: the project is removed, but ${workFolder.folder} could not be deleted — ` +
      `${error instanceof Error ? error.message : String(error)}`
    );
    return false;
  }
}
