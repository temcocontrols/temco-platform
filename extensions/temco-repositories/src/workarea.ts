// The working area: our own folder, outside every repository.
//
// A source is cloned here so that its **files** can be read. A page is written from code, and code that exists
// only behind an API is one file per call, no history, and no working tree for a build. The clone is a copy we
// own: **nothing is ever written to the origin, and nothing is ever pushed.**
//
//   <root>/source/<source>/        the clone — one branch, full history, one copy per repository
//   <root>/<project>/              what we make for a project: drafts, notes. Files, not state.
//
// A clone is a copy of a **repository**, not a part of a project: the same repository cited by three projects is one
// copy here, and removing a project never deletes code. What a project owns is its own folder — the drafts and notes
// written for it — because that is the only thing that is *its*.
//
// `<root>` is the `temcoRepositories.workspaceFolder` setting, or `~/temco`, visible on purpose so it can
// be looked at, moved and deleted with the file manager. The catalog stays the single index of what was read; it
// is SQLite in the extension's own storage and is never duplicated here.
//
// Cloning is **never automatic**. A first read says that a local copy would help and offers one; from then on the
// act is a menu entry or a page button, and every one of them names the folder it will write to first.
//
// One branch and full history, not `--depth 1`: the branch is the one the read uses, and the history is what a
// draft reads and what a stale check needs. A shallow clone would break both.

import { execFile } from 'child_process';
import * as fs from 'fs/promises';
import * as os from 'os';
import * as path from 'path';
import * as vscode from 'vscode';
import { Catalog, Selection, slugOf } from './store';

/** How long a git command may take. A clone of a large repository is slow; an hour is not an answer either. */
const GIT_TIMEOUT_MS = 30 * 60 * 1000;

/** The root of the working area: the setting, or a visible folder in the user's home. */
export function workRoot(): string {
  const configured = vscode.workspace.getConfiguration('temcoRepositories').get<string>('workspaceFolder');
  return configured !== undefined && configured.trim().length > 0
    ? expandHome(configured.trim())
    : path.join(os.homedir(), 'temco');
}

/** The folder one project owns: what we made for it. Clones do not live here — a repository is not a project's. */
export function projectFolder(project: string): string {
  return path.join(workRoot(), slugOf(project));
}

/** Where every clone lives: one folder per repository, shared by every project that cites it. */
export function cloneRoot(): string {
  return path.join(workRoot(), 'source');
}

/** The folder one source is cloned into. */
export function cloneFolder(source: string): string {
  return path.join(cloneRoot(), slugOf(source));
}

/** Whether a clone is really there — a folder with a `.git` in it, not an empty directory. */
export async function hasClone(source: string): Promise<boolean> {
  try {
    await fs.stat(path.join(cloneFolder(source), '.git'));
    return true;
  } catch {
    return false;
  }
}

/** What git says the clone costs, which is the number a person cares about before removing it. */
export async function cloneSize(source: string): Promise<string | undefined> {
  const result = await git(['count-objects', '-vH'], cloneFolder(source));
  const match = /size-pack:\s*([\d.]+\s*\w+)/.exec(result.output);
  return match?.[1];
}

export function registerWorkareaCommands(
  context: vscode.ExtensionContext,
  selection: Selection,
  output: vscode.OutputChannel,
  refresh: () => void
): void {
  context.subscriptions.push(
    vscode.commands.registerCommand('temcoRepositories.fetchSource', (target?: unknown) =>
      fetchSource(context, output, refresh, slugOfTarget(target))
    ),
    // The same clone, asked for by something that needs the *files* rather than the person: a draft, an analysis. It
    // returns the folder instead of reporting, and still asks before it writes anything to the machine.
    vscode.commands.registerCommand('temcoRepositories.ensureClone', (target?: unknown) =>
      ensureClone(context, output, refresh, slugOfTarget(target))
    ),
    vscode.commands.registerCommand('temcoRepositories.pullSource', (target?: unknown) =>
      pullSource(context, output, refresh, slugOfTarget(target))
    ),
    vscode.commands.registerCommand('temcoRepositories.openClone', (target?: unknown) =>
      openClone(context, slugOfTarget(target))
    ),
    vscode.commands.registerCommand('temcoRepositories.removeClone', (target?: unknown) =>
      removeClone(context, refresh, slugOfTarget(target))
    ),
    // The clones made before clones had a folder of their own: a rename, not a re-clone.
    vscode.commands.registerCommand('temcoRepositories.moveClones', () =>
      moveClones(context, output, refresh)
    ),
    // Kept for the palette entry that existed before the folder dialog: one command does the work, the other names it.
    vscode.commands.registerCommand('temcoRepositories.changeWorkspaceFolder', () =>
      vscode.commands.executeCommand('temcoRepositories.pickWorkspaceFolder')
    ),
    vscode.commands.registerCommand('temcoRepositories.openWorkFolder', () => openProjectFolder(selection)),
    // For other modules — a project owns a folder, so removing the project removes the folder with it. The two are
    // separate calls because the act that removes a project asks what it is about to delete *before* it deletes it.
    vscode.commands.registerCommand('temcoRepositories.projectWorkFolder', (target?: unknown) =>
      projectWorkFolder(selection, slugOfTarget(target))
    ),
    vscode.commands.registerCommand('temcoRepositories.deleteProjectFolder', (target?: unknown) =>
      deleteProjectFolder(context, selection, refresh, slugOfTarget(target))
    )
  );
}

/** The one place the detail behind a notice lives: the output channel this module writes git into. */
const SHOW_LOG = 'Show the Log';

/**
 * The project an act belongs to, asking for one when the window is working on none.
 *
 * **Citing** a source belongs to a project — a project's source list is where a draft looks for its pages — so the
 * question is asked here, inside the act the person started, and the act carries on with the answer. Cloning does not
 * come through here: a clone is a copy of a repository and lives in the shared `source` folder, project or no project.
 */
export async function projectFor(
  selection: Selection,
  output: vscode.OutputChannel | undefined,
  what: string
): Promise<string | undefined> {
  const current = selection.project();
  if (current !== undefined) {
    return current;
  }
  const area = path.join(workRoot(), '<project>');
  output?.appendLine(`[work] ${what} needs a project: what we make for one goes to ${area}`);
  const answer = await vscode.window.showInformationMessage(
    `Temco Repositories: ${what} needs the project being worked on — a source is cited *in* a project, and no ` +
    'project is open.',
    'Choose a Project',
    SHOW_LOG
  );
  if (answer === SHOW_LOG) {
    output?.show(true);
    return undefined;
  }
  if (answer !== 'Choose a Project') {
    output?.appendLine('[work] no project chosen, so nothing was done');
    return undefined;
  }
  await vscode.commands.executeCommand('temcoProjects.selectProject');
  const chosen = selection.project();
  if (chosen === undefined) {
    output?.appendLine('[work] still no project, so nothing was done');
    void vscode.window.showInformationMessage(
      'Temco Repositories: no project is open, so nothing was done.'
    );
    return undefined;
  }
  output?.appendLine(`[work] project ${chosen}: what we make for it goes to ${projectFolder(chosen)}`);
  return chosen;
}

/**
 * Report a failure with the words git used, and the log one click away.
 *
 * A toast is one line; a clone that fails says why in twenty. The line names the source, the button opens the
 * channel the whole command is written into — which is the only place the reason survives long enough to be read.
 */
function failed(output: vscode.OutputChannel, message: string, detail: string): void {
  output.appendLine(`[work] failed: ${detail}`);
  void vscode.window.showErrorMessage(message, SHOW_LOG).then((answer) => {
    if (answer === SHOW_LOG) {
      output.show(true);
    }
  });
}

/**
 * Fetch a source: clone it into the shared `source` folder, then read it.
 *
 * After the clone the catalog records **where** the copy is, so the source is read from disk from then on — the
 * same read, with the working tree behind it: the registry and its checks, the code files, and the history. That
 * read runs as part of this command, because a cloned source nobody read would still say "never read" and its pages
 * would still not be in the catalog: the copy and the read are one act, not two that look alike.
 */
async function fetchSource(
  context: vscode.ExtensionContext,
  output: vscode.OutputChannel,
  refresh: () => void,
  wanted?: string
): Promise<void> {
  const source = await sourceOf(context, wanted);
  if (source === undefined) {
    return;
  }
  if (source.remoteUrl === undefined || source.remoteUrl.length === 0) {
    void vscode.window.showInformationMessage(
      `Temco Repositories: ${source.name} is a folder on this machine, so it needs no clone.`
    );
    return;
  }

  const folder = cloneFolder(source.name);
  if (await hasClone(source.name)) {
    void vscode.window.showInformationMessage(`Temco Repositories: ${source.name} already has a clone.`, 'Pull it').then(
      (answer) => {
        if (answer === 'Pull it') {
          void vscode.commands.executeCommand('temcoRepositories.pullSource', wanted);
        }
      }
    );
    return;
  }

  const answer = await vscode.window.showWarningMessage(
    `Clone ${source.name} into ${folder}?`,
    {
      modal: true,
      detail:
        `One branch (${source.branch ?? source.defaultBranch ?? 'the default'}), full history — the history is what a draft reads ` +
        'and what the stale check needs. Nothing is ever written to the repository, and nothing is pushed.',
    },
    'Clone it'
  );
  if (answer !== 'Clone it') {
    return;
  }

  await fs.mkdir(path.dirname(folder), { recursive: true });
  const args = ['clone', '--single-branch', ...(source.branch ? ['--branch', source.branch] : []), source.remoteUrl, folder];
  output.appendLine(
    `[work] cloning ${source.name} — ${source.remoteUrl}, branch ${source.branch ?? source.defaultBranch ?? 'as the remote decides'}, into ${folder}`
  );
  const result = await vscode.window.withProgress(
    { location: vscode.ProgressLocation.Notification, title: `Temco Repositories: cloning ${source.name}` },
    () => git(args, undefined, output)
  );
  if (!result.ok) {
    failed(
      output,
      `Temco Repositories: ${source.name} could not be cloned. ${firstLine(result.output)}`,
      `git clone ${source.remoteUrl} into ${folder}`
    );
    return;
  }

  await withCatalog(context, (catalog) => catalog.setSourcePath(source.slug, folder));
  output.appendLine(`[work] ${source.name} cloned into ${folder}`);
  refresh();
  // The copy and the read are one act. A clone nobody read leaves the row saying "never read", and what the source
  // declares is the reason to have the copy at all — so the read runs here, through the same command the Read action
  // runs, which records the pages and stamps the watermark exactly once.
  await vscode.commands.executeCommand('temcoRepositories.readSource', source.slug);
}

/**
 * The folder to read a source's **files** from, cloning it if there is no copy yet.
 *
 * A person asking for a draft or an analysis is asking for code to be read; a source read over the API has no
 * working tree, so the answer is a clone in the working area. The person is still asked first — the platform
 * never writes a repository to the disk without a yes — but the dialog is the one question in the middle of the
 * act they started, not a detour to another page.
 */
async function ensureClone(
  context: vscode.ExtensionContext,
  output: vscode.OutputChannel,
  refresh: () => void,
  wanted?: string
): Promise<{ path?: string; error?: string }> {
  const source = await sourceOf(context, wanted);
  if (source === undefined) {
    return { error: 'That source is not in the catalog.' };
  }
  if (source.path !== undefined && source.remoteUrl === undefined) {
    // A folder on this machine is already the code.
    return { path: source.path };
  }
  if (source.remoteUrl === undefined || source.remoteUrl.length === 0) {
    return { error: `${source.name} has no repository URL and no folder, so there is no code to read.` };
  }

  const folder = cloneFolder(source.name);
  if (await hasClone(source.name)) {
    return { path: folder };
  }

  const answer = await vscode.window.showWarningMessage(
    `Clone ${source.name} into ${folder}?`,
    {
      modal: true,
      detail:
        'The code is read from the clone: one branch, full history, and nothing is ever pushed back. ' +
        'Without it there are no files to draft from.',
    },
    'Clone it'
  );
  if (answer !== 'Clone it') {
    return { error: 'No clone, so there are no files to read.' };
  }

  await fs.mkdir(path.dirname(folder), { recursive: true });
  const args = ['clone', '--single-branch', ...(source.branch ? ['--branch', source.branch] : []), source.remoteUrl, folder];
  const result = await vscode.window.withProgress(
    { location: vscode.ProgressLocation.Notification, title: `Temco Repositories: cloning ${source.name}` },
    () => git(args, undefined, output)
  );
  if (!result.ok) {
    return { error: `${source.name} could not be cloned. ${firstLine(result.output)}` };
  }

  await withCatalog(context, (catalog) => catalog.setSourcePath(source.slug, folder));
  output.appendLine(`[work] ${source.name} cloned into ${folder}`);
  refresh();
  return { path: folder };
}

/** Pull a source's local copy, and read it again: the counts a list shows are about a revision. */
async function pullSource(
  context: vscode.ExtensionContext,
  output: vscode.OutputChannel,
  refresh: () => void,
  wanted?: string
): Promise<void> {
  const source = await sourceOf(context, wanted);
  if (source === undefined) {
    return;
  }
  const folder = cloneFolder(source.name);
  if (!(await hasClone(source.name))) {
    void vscode.window.showInformationMessage(
      `Temco Repositories: ${source.name} has no clone yet.`,
      'Fetch it'
    ).then((answer) => {
      if (answer === 'Fetch it') {
        void vscode.commands.executeCommand('temcoRepositories.fetchSource', wanted);
      }
    });
    return;
  }

  // `--ff-only`: a local copy is a copy. Nothing here resolves a merge, and nothing here commits.
  const result = await vscode.window.withProgress(
    { location: vscode.ProgressLocation.Notification, title: `Temco Repositories: pulling ${source.name}` },
    () => git(['pull', '--ff-only'], folder, output)
  );
  if (!result.ok) {
    failed(
      output,
      `Temco Repositories: ${source.name} could not be pulled. ${firstLine(result.output)}`,
      `git pull --ff-only in ${folder}`
    );
    return;
  }
  refresh();
  void vscode.window.showInformationMessage(
    `Temco Repositories: ${source.name} is up to date with its branch.`,
    'Read it again'
  ).then((choice) => {
    if (choice === 'Read it again') {
      void vscode.commands.executeCommand('temcoRepositories.readSource', source.slug);
    }
  });
}

/** Show a local copy in the file manager — the ordinary way to look at what was cloned. */
async function openClone(context: vscode.ExtensionContext, wanted?: string): Promise<void> {
  const source = await sourceOf(context, wanted);
  if (source === undefined) {
    return;
  }
  const folder = cloneFolder(source.name);
  if (!(await hasClone(source.name))) {
    void vscode.window.showInformationMessage(`Temco Repositories: ${source.name} has no clone.`);
    return;
  }
  await vscode.commands.executeCommand('revealFileInOS', vscode.Uri.file(folder));
}

/** Remove a local copy: the folder only. The repository, the catalog row and the project are untouched. */
async function removeClone(
  context: vscode.ExtensionContext,
  refresh: () => void,
  wanted?: string
): Promise<void> {
  const source = await sourceOf(context, wanted);
  if (source === undefined) {
    return;
  }
  const folder = cloneFolder(source.name);
  if (!(await hasClone(source.name))) {
    void vscode.window.showInformationMessage(`Temco Repositories: ${source.name} has no clone.`);
    return;
  }
  const size = await cloneSize(source.name);
  const cited = await citingProjects(context, source.name);
  const answer = await vscode.window.showWarningMessage(
    `Remove the clone of ${source.name}?`,
    {
      modal: true,
      detail:
        `${folder}${size ? ` (${size})` : ''} is deleted from this machine. The repository is not touched, ` +
        'and the source stays in the catalog — it is read over the API again until a copy is fetched.' +
        (cited.length === 0 ? '' : ` ${cited.join(', ')} ${cited.length === 1 ? 'cites' : 'cite'} this copy, so it goes for ${cited.length === 1 ? 'it' : 'them'} too.`),
    },
    'Remove it'
  );
  if (answer !== 'Remove it') {
    return;
  }

  await fs.rm(folder, { recursive: true, force: true });
  await withCatalog(context, (catalog) => catalog.setSourcePath(source.slug, undefined));
  refresh();
}

/**
 * Move the clones made before clones had a folder of their own.
 *
 * A clone used to live inside the project's folder (`<root>/<project>/<source>`), which made a project a precondition
 * of copying a repository. The copy itself is fine — only the folder above it was wrong — so this renames the folder
 * and updates the catalog's path: nothing is fetched again, nothing is read from the origin, and a source whose shared
 * copy is already in place is left alone rather than overwritten.
 */
async function moveClones(
  context: vscode.ExtensionContext,
  output: vscode.OutputChannel,
  refresh: () => void
): Promise<void> {
  const root = cloneRoot();
  const plan: { slug: string; name: string; from: string; to: string }[] = [];
  await withCatalog(context, (catalog) => {
    for (const row of catalog.sources()) {
      const detail = catalog.source(row.slug);
      const from = detail?.path;
      if (detail === undefined || from === undefined || detail.kind !== 'git' || isInside(from, root)) {
        continue;
      }
      plan.push({ slug: row.slug, name: row.name, from, to: cloneFolder(row.name) });
    }
  });
  if (plan.length === 0) {
    void vscode.window.showInformationMessage(
      `Temco Repositories: every clone is already in ${root}.`
    );
    return;
  }
  const answer = await vscode.window.showWarningMessage(
    `Move ${plan.length === 1 ? 'one clone' : `${plan.length} clones`} into ${root}?`,
    {
      modal: true,
      detail:
        'A folder rename and a path update: nothing is cloned again, nothing is read from the origin, and nothing is ' +
        'pushed. A clone stays where it is when the shared folder already holds one of the same repository.'
    },
    'Move them'
  );
  if (answer !== 'Move them') {
    output.appendLine('[work] the move was cancelled, so the clones are where they were');
    return;
  }

  let moved = 0;
  const kept: string[] = [];
  for (const item of plan) {
    try {
      if (!(await isThere(item.from))) {
        kept.push(`${item.name} — no folder at ${item.from}`);
        continue;
      }
      if (await isThere(item.to)) {
        kept.push(`${item.name} — ${item.to} already holds a clone`);
        continue;
      }
      await fs.mkdir(path.dirname(item.to), { recursive: true });
      await fs.rename(item.from, item.to);
      await withCatalog(context, (catalog) => catalog.setSourcePath(item.slug, item.to));
      output.appendLine(`[work] moved ${item.from} to ${item.to}`);
      moved += 1;
    } catch (error) {
      const why = error instanceof Error ? error.message : String(error);
      kept.push(`${item.name} — ${why}`);
      output.appendLine(`[work] could not move ${item.from}: ${why}`);
    }
  }
  refresh();
  const said = `${moved} clone${moved === 1 ? '' : 's'} moved into ${root}`;
  if (kept.length === 0) {
    void vscode.window.showInformationMessage(`Temco Repositories: ${said}.`, SHOW_LOG).then((choice) => {
      if (choice === SHOW_LOG) {
        output.show(true);
      }
    });
    return;
  }
  output.appendLine(`[work] left where they were: ${kept.join('; ')}`);
  void vscode.window.showWarningMessage(
    `Temco Repositories: ${said}; ${kept.length} left where ${kept.length === 1 ? 'it was' : 'they were'}. ` +
    `${kept[0]}${kept.length > 1 ? ` (and ${kept.length - 1} more)` : ''}`,
    SHOW_LOG
  ).then((choice) => {
    if (choice === SHOW_LOG) {
      output.show(true);
    }
  });
}

/** Show the project's own folder: what we made for it — drafts, notes. Clones are not in here. */
async function openProjectFolder(selection: Selection): Promise<void> {
  const project = selection.project();
  if (project === undefined) {
    void vscode.window.showInformationMessage('Temco Repositories: no project is being worked on.');
    return;
  }
  const folder = projectFolder(project);
  await fs.mkdir(folder, { recursive: true });
  await vscode.commands.executeCommand('revealFileInOS', vscode.Uri.file(folder));
}

/**
 * The folder a project owns, and whether it is there — nothing is made and nothing is deleted.
 *
 * This is the half another module asks for before it removes a project, so the confirmation can name the folder a
 * person is about to lose instead of saying "its files" and leaving them to guess where those are.
 */
async function projectWorkFolder(
  selection: Selection,
  wanted?: string
): Promise<{ folder: string; exists: boolean } | undefined> {
  const project = wanted ?? selection.project();
  if (project === undefined) {
    return undefined;
  }
  const folder = projectFolder(project);
  return { folder, exists: await isThere(folder) };
}

/**
 * Deleting a project deletes the folder it owns: what we made for it.
 *
 * Clones do not live in there any more — they live in the shared `source` folder, and a project that is removed never
 * deletes code. What is still handled here is what a folder can *contain*: a **clone** made before clones moved (its
 * path is cleared, so the source is read over the API again — exactly what removing one copy means), and a **folder**
 * source, which is nothing *but* its path (it is how a project's own `docs/` is cited), so it is removed with the
 * folder rather than left standing over nothing. No origin is ever touched: this deletes copies we own.
 */
async function deleteProjectFolder(
  context: vscode.ExtensionContext,
  selection: Selection,
  refresh: () => void,
  wanted?: string
): Promise<boolean> {
  const project = wanted ?? selection.project();
  if (project === undefined) {
    return false;
  }
  const folder = projectFolder(project);
  if (!(await isThere(folder))) {
    return false;
  }

  // A folder the window has open cannot be deleted on Windows — the watchers hold it — so it is closed first.
  // It was added to the workspace when the project was created, to show its `docs/` in Explorer, and a removal
  // that leaves a workspace folder pointing at nothing is a second mess.
  await closeWorkspaceFoldersAt(folder);

  try {
    await fs.rm(folder, { recursive: true, force: true });
  } catch (error) {
    void vscode.window.showErrorMessage(
      `Temco Repositories: ${folder} could not be deleted — ` +
      `${error instanceof Error ? error.message : String(error)}. Close anything using it, then delete it in Explorer.`
    );
    return false;
  }
  await withCatalog(context, (catalog) => {
    for (const row of catalog.sources()) {
      const detail = catalog.source(row.slug);
      if (detail?.path === undefined || !isInside(detail.path, folder)) {
        continue;
      }
      if (detail.kind === 'folder') {
        catalog.removeSource(row.slug);
      } else {
        catalog.setSourcePath(row.slug, undefined);
      }
    }
  });
  refresh();
  return true;
}

/** Whether a folder is really there. */
async function isThere(folder: string): Promise<boolean> {  try {
    await fs.stat(folder);
    return true;
  } catch {
    return false;
  }
}

/**
 * Closes every workspace folder at or inside a path.
 *
 * The folders are re-read on every turn of the loop because removing one renumbers the rest, and the count is
 * changed one entry at a time: a single call with a range would remove a neighbour if the list shifted.
 */
async function closeWorkspaceFoldersAt(folder: string): Promise<void> {
  for (;;) {
    const folders = vscode.workspace.workspaceFolders ?? [];
    const index = folders.findIndex((candidate) => {
      const open = path.resolve(candidate.uri.fsPath);
      const gone = path.resolve(folder);
      return open === gone || open.toLowerCase().startsWith(`${gone.toLowerCase()}${path.sep}`);
    });
    if (index < 0) {
      return;
    }
    await vscode.workspace.updateWorkspaceFolders(index, 1);
  }
}

/**
 * Whether a recorded path is the folder or inside it.
 *
 * Both matter, and they are different cases rather than one: a **clone** lives *inside* a project's folder, while
 * the source a project's own `docs/` is cited by *is* that folder. Comparing only the inside case left the second
 * kind pointing at a folder that no longer existed.
 */
function isInside(file: string, folder: string): boolean {
  const target = path.resolve(folder);
  const resolved = path.resolve(file);
  return resolved.toLowerCase() === target.toLowerCase()
    || resolved.toLowerCase().startsWith(`${target.toLowerCase()}${path.sep}`);
}

// ------------------------------------------------------------------ helpers

/**
 * The projects that cite a source, by name.
 *
 * One copy is shared, so this is what a removal dialog has to say out loud: the copy goes for every project that
 * reads it, not only the one on screen.
 */
async function citingProjects(context: vscode.ExtensionContext, sourceName: string): Promise<string[]> {
  const slug = slugOf(sourceName);
  const names: string[] = [];
  await withCatalog(context, (catalog) => {
    for (const document of catalog.documents()) {
      if (catalog.documentSourceSlugs(document.slug).includes(slug)) {
        names.push(document.name);
      }
    }
  });
  return names;
}

/** A source's coordinates, by slug. A menu entry hands us a slug; the palette hands us nothing. */
async function sourceOf(
  context: vscode.ExtensionContext,
  wanted?: string
): Promise<{ slug: string; name: string; remoteUrl?: string; branch?: string; defaultBranch?: string; path?: string } | undefined> {
  let catalog: Catalog | undefined;
  try {
    catalog = await Catalog.open(context);
    const rows = catalog.sources();
    const slug = wanted !== undefined && catalog.source(wanted) !== undefined ? wanted : rows[0]?.slug;
    if (slug === undefined) {
      void vscode.window.showInformationMessage('Temco Repositories: no source has been recorded yet.');
      return undefined;
    }
    const detail = catalog.source(slug);
    return detail === undefined
      ? undefined
      : {
          slug,
          name: detail.name,
          remoteUrl: detail.remoteUrl,
          branch: detail.branch,
          defaultBranch: detail.defaultBranch,
          path: detail.path,
        };
  } catch (error) {
    void vscode.window.showErrorMessage(
      `Temco Repositories: ${error instanceof Error ? error.message : String(error)}`
    );
    return undefined;
  } finally {
    catalog?.close();
  }
}

async function withCatalog(
  context: vscode.ExtensionContext,
  run: (catalog: Catalog) => void
): Promise<void> {
  let catalog: Catalog | undefined;
  try {
    catalog = await Catalog.open(context);
    run(catalog);
  } catch {
    // Recording where the copy is, is not worth a second error on top of the one that already happened.
  } finally {
    catalog?.close();
  }
}

/**
 * Run git and report it.
 *
 * `git` has to be on the machine — the same bargain as `gh` for the token and the platform's own `tar` for
 * unpacking. It is run as a child process, never through a shell, so no repository name can become a command.
 */
async function git(
  args: readonly string[],
  cwd: string | undefined,
  output?: vscode.OutputChannel
): Promise<{ ok: boolean; output: string }> {
  const line = `git ${args.join(' ')}${cwd ? `   (in ${cwd})` : ''}`;
  output?.appendLine(`[work] ${line}`);
  return new Promise((resolve) => {
    execFile(
      'git',
      [...args],
      { cwd, timeout: GIT_TIMEOUT_MS, windowsHide: true, maxBuffer: 4 * 1024 * 1024 },
      (error, stdout, stderr) => {
        const text = `${stdout ?? ''}${stderr ?? ''}`.trim();
        if (text.length > 0) {
          output?.appendLine(text);
        }
        if (error && (error as NodeJS.ErrnoException).code === 'ENOENT') {
          resolve({ ok: false, output: 'git was not found on this machine. Install git and try again.' });
          return;
        }
        resolve({ ok: error === null, output: text });
      }
    );
  });
}

function firstLine(text: string): string {
  const line = text.split('\n').map((one) => one.trim()).filter((one) => one.length > 0).pop();
  return line ?? 'See the Temco Repositories output for what git said.';
}

/** A menu entry hands us a slug; a row hands us something with one. Both leave as a slug or nothing. */
function slugOfTarget(target: unknown): string | undefined {
  if (typeof target === 'string' && target.length > 0) {
    return target;
  }
  if (target !== null && typeof target === 'object') {
    const slug = (target as { slug?: unknown }).slug;
    if (typeof slug === 'string' && slug.length > 0) {
      return slug;
    }
  }
  return undefined;
}

function expandHome(value: string): string {
  if (value === '~') {
    return os.homedir();
  }
  return value.startsWith('~/') || value.startsWith('~\\')
    ? path.join(os.homedir(), value.slice(2))
    : value;
}
