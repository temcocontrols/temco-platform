// The project commands — and nothing else.
//
// The work happens on a page (`src/projectPage.ts`): the popups this replaces asked one field at a time and
// could not show a source list at all. These commands only decide **which** project the page opens for, so
// there is one form to maintain instead of a wizard and an editor that drift apart.
//
// There is no project *hub*: opening a project points the application at it and shows its pages, because a
// summary page between the list and the work was a second place to read the same counts.

import * as vscode from 'vscode';
import { ProjectFlowPage, NEW_PROJECT_VIEW_TYPE } from './projectFlow';
import { ProjectList } from './projectList';
import { ProjectPage } from './projectPage';
import { ProjectsPage } from './projectsPage';
import { discardWorkFolder, folderConsequence, workFolderOf } from './removal';
import { AddSourcePage, ADD_SOURCE_VIEW_TYPE } from './sourceFlow';
import { Catalog, CatalogUnavailable, Selection, slugOf } from './store';
import { focusLibrary, restore, rowSlug } from './ui';
import { PROJECTS_PAGE_VIEW_TYPE, PROJECT_VIEW_TYPE } from './surface';

/** A slug, or the sidebar row that stands for a project — the two things a command argument can be. */
type ProjectArgument = string | object | undefined;

//

export function registerProjectCommands(
  context: vscode.ExtensionContext,
  selection: Selection,
  refresh: () => void
): void {
  // The Dashboard's list of projects. A row opens the page; the two inline actions are on the row's context menu.
  const list = new ProjectList(context);
  const tree = vscode.window.createTreeView('temcoProjects.projects', { treeDataProvider: list });
  context.subscriptions.push(tree);

  /**
   * One redraw for every surface this module owns: its own signal — which the documentation panel listens to — the
   * list it draws itself, and the view title.
   *
   * The title is not decoration: the project being worked on is the one value the whole platform reads, and a list
   * of five names with a tick somewhere in it was not answering "which one am I in?" without a search.
   */
  const redraw = (): void => {
    refresh();
    list.refresh();
  };

  const page = new ProjectPage(context, selection, redraw);
  // The list of every project, opened from the Projects view's title bar: the tree answers "which page", this
  // answers "which project needs me".
  const projects = new ProjectsPage(context, selection);
  context.subscriptions.push(projects);
  // New Project is the mock's `flow/new-project`: a wizard rather than the edit form opened empty.
  const flow = new ProjectFlowPage(context, selection, redraw);
  context.subscriptions.push(flow);
  // Add Source is the mock's `flow/add-source`: three steps, and the same store call the dialog made.
  const source = new AddSourcePage(context);
  context.subscriptions.push(source);

  context.subscriptions.push(
    vscode.commands.registerCommand('temcoProjects.showProject', async () => {
      // Focusing the view is what brings its panel forward — VS Code registers `<viewId>.focus` for every
      // contributed view and opens the container with it. The project's own section is its pages, so that is the
      // view to bring forward.
      await vscode.commands.executeCommand('temcoDocs.pages.focus');
    })
  );

  context.subscriptions.push(
    vscode.commands.registerCommand('temcoProjects.newProject', () => void flow.open()),
    // A page of this module that was open when the window closed comes back with its tab, on the same project: the
    // panel the window restored is drawn into, so the tab keeps its place and there is never a second copy of it.
    ...restore(context, [
      { viewType: PROJECT_VIEW_TYPE, open: (panel, arg) => page.openEdit(arg ?? '', panel) },
      { viewType: PROJECTS_PAGE_VIEW_TYPE, open: (panel) => void projects.open(panel) },
      { viewType: NEW_PROJECT_VIEW_TYPE, open: (panel) => void flow.open(undefined, panel) },
      { viewType: ADD_SOURCE_VIEW_TYPE, open: (panel) => source.open(panel) }
    ]),
    // The projects page: one list of everything the catalog holds.
    vscode.commands.registerCommand('temcoProjects.projectsPage', () => void projects.open()),
    // *New project* from a repository row carries the repository in: the flow opens already answering "where do the
    // pages come from", and asks only what is inside it. The arguments are the row's own facts, so no lookup by name
    // has to guess which organisation the repository belongs to.
    vscode.commands.registerCommand(
      'temcoProjects.newProjectFromRepository',
      (name?: string, cloneUrl?: string, branch?: string, files?: string[]) =>
        typeof name === 'string' && name.length > 0
          ? void flow.open({ name, cloneUrl, branch, files })
          : void flow.open()
    ),
    // Coming back from the repositories page: the form is brought forward, never rebuilt — a return is not a refresh.
    vscode.commands.registerCommand('temcoProjects.returnToNewProject', () => flow.reveal()),
    // Repositories ticked on the repositories page, cited in the form that is already open.
    vscode.commands.registerCommand('temcoProjects.citeInNewProject', (names?: unknown) =>
      void flow.cite(Array.isArray(names) ? names.filter((name): name is string => typeof name === 'string') : [])
    ),
    vscode.commands.registerCommand('temcoProjects.removeProject', (target?: ProjectArgument) =>
      removeProject(context, selection, redraw, rowSlug(target))
    ),
    // Every project at once. It shares the single act's rules — the row is forgotten, then the folder it owns is
    // deleted — and it confirms once, naming every folder, because one modal per project would be a wall of modals.
    vscode.commands.registerCommand('temcoProjects.removeAllProjects', () =>
      removeAllProjects(context, selection, redraw)
    ),
    // Adding a source is the mock's own flow: kind, location, read. A source is recorded once and cited by any
    // number of projects, so the flow is about the source itself rather than about the project it is added to.
    vscode.commands.registerCommand('temcoProjects.addSource', () => source.open()),
    // Opening a project is two acts and no page in between: point the application at it, then show its pages.
    vscode.commands.registerCommand('temcoProjects.openProject', (target?: ProjectArgument) =>
      withProject(context, (chosen) => void openDocuments(selection, chosen), rowSlug(target))
    ),
    // A project's own page, and the Documentation panel brought forward with it: the three things "open this
    // project" means — it becomes current, its summary opens, and the side bar shows the module that owns it.
    vscode.commands.registerCommand('temcoProjects.openProjectPage', (target?: ProjectArgument) =>
      withProject(context, (chosen) => void openProjectSummary(selection, chosen), rowSlug(target))
    ),
    vscode.commands.registerCommand('temcoProjects.editProject', (target?: ProjectArgument) =>
      withProject(context, (chosen) => page.openEdit(chosen), rowSlug(target))
    ),
    // What the whole application reads: the Workspace view, the counts, the faults and the AI's context.
    vscode.commands.registerCommand('temcoProjects.selectProject', (target?: ProjectArgument) =>
      selectProject(context, selection, rowSlug(target))
    ),
    vscode.commands.registerCommand('temcoProjects.clearProject', () => selection.select(undefined))
  );
}

/**
 * Opening a project: it becomes the one being worked on, and its pages are what opens.
 *
 * A command to the documentation module rather than an import — the list of a project's pages is that module's,
 * and this one only knows which project the application follows.
 */
async function openDocuments(selection: Selection, slug: string): Promise<void> {
  if (selection.project() !== slug) {
    await selection.select(slug);
  }
  try {
    await vscode.commands.executeCommand('temcoDocs.documents');
  } catch {
    // Without the documentation module there are no pages to show; the project is still the one being worked on.
  }
}

/**
 * Opening a project's page: it becomes current, the page opens, and the Documentation panel comes forward.
 *
 * The panel is opened by the container's own command rather than by focusing one of its views: focusing a view moves
 * the keyboard into the tree, and a person who just clicked a row on a page is looking at the page.
 */
async function openProjectSummary(selection: Selection, slug: string): Promise<void> {
  if (selection.project() !== slug) {
    await selection.select(slug);
  }
  await vscode.commands.executeCommand('temcoDocs.projectPage', slug).then(undefined, () => undefined);
  await vscode.commands.executeCommand('workbench.view.extension.temco').then(undefined, () => undefined);
}

/**
 * Removes a project — and the folder it owns on this machine.
 *
 * Sources stay in the catalog: they are recorded once and cited by any number of projects, so forgetting one because
 * the project that used it has gone would quietly take a page away from every other project that cites it. What *is*
 * deleted is the project's own folder in the working area — the clones it fetched, what we made from them, and the
 * `docs/` a blank project started with. The folder is named in the confirmation first, because that is the part of
 * this act that cannot be undone from inside the application.
 */
async function removeProject(
  context: vscode.ExtensionContext,
  selection: Selection,
  notify: (removed?: string) => void,
  slug?: string
): Promise<void> {
  const projects = await listDocuments(context);
  if (projects.length === 0) {
    void vscode.window.showInformationMessage('Temco Projects: there are no projects to remove.');
    return;
  }

  const chosen =
    slug !== undefined
      ? projects.find((project) => project.slug === slug)
      : await pickProject(projects, undefined, 'Remove which project?');
  if (!chosen) {
    // A row was named and it is not in the catalog any more. Saying nothing made this look like a button that
    // does nothing, which is exactly how it was reported.
    if (slug !== undefined) {
      void vscode.window.showWarningMessage(
        `Temco Projects: “${slug}” is not in the catalog any more, so there is nothing to remove. Refresh the list.`
      );
    }
    return;
  }

  const workFolder = await workFolderOf(chosen.slug);
  const answer = await vscode.window.showWarningMessage(
    `Remove “${chosen.name}”?`,
    {
      modal: true,
      detail: [
        'The project, how it is built and the artifacts recorded against it are forgotten. Its sources stay in ' +
        'the catalog — they are shared — and no origin is touched.',
        folderConsequence(workFolder),
      ]
        .filter((line) => line.length > 0)
        .join('\n'),
    },
    'Remove'
  );
  if (answer !== 'Remove') {
    return;
  }

  let catalog: Catalog | undefined;
  try {
    catalog = await Catalog.open(context);
    const removed = catalog.deleteDocument(chosen.slug);
    if (removed === 0) {
      void vscode.window.showWarningMessage(
        `Temco Projects: the catalog deleted no row for “${chosen.slug}”, so the project is still there. ` +
        'This is a fault in the store, not in the name you picked.'
      );
      return;
    }
  } catch (error) {
    const message = error instanceof CatalogUnavailable ? error.message : String(error);
    void vscode.window.showErrorMessage(`Temco Projects: ${message}`);
    return;
  } finally {
    catalog?.close();
  }

  // The row is gone, so the folder is what is left of the project. A folder that cannot be deleted is said out
  // loud rather than swallowed: what the person then finds on their disk is a folder nothing names.
  const discarded = await discardWorkFolder(chosen.slug, workFolder);

  // A project being worked on cannot be removed and still be what everything reads.
  if (selection.project() === chosen.slug) {
    await selection.select(undefined);
  }
  notify(chosen.slug);
  void vscode.window.showInformationMessage(
    `Temco Projects: “${chosen.name}” is removed` +
    (discarded && workFolder !== undefined ? `, and ${workFolder.folder} is deleted.` : '.')
  );
  // Land where the removal happened, in the one useful sense: the list of what is left. The page about the
  // project that has just gone is not a page — it closes itself, and the Library takes its place.
  await focusLibrary();
}

/**
 * Removes every project: the rows, then the folders they own.
 *
 * It is the single removal repeated, so it keeps the same two facts — a project is a catalog row, and the row is
 * what names the folder that has to go with it. What it does *not* repeat is the confirmation: one modal names
 * every project and every folder, because five projects would otherwise be five modals in a row, and the fifth
 * would be clicked without being read.
 *
 * Sources are never touched: they are recorded once and cited by any number of projects, so forgetting them
 * because the projects that cited them are gone would take pages away from a project created tomorrow.
 */
async function removeAllProjects(
  context: vscode.ExtensionContext,
  selection: Selection,
  notify: (removed?: string) => void
): Promise<void> {
  const projects = await listDocuments(context);
  if (projects.length === 0) {
    void vscode.window.showInformationMessage('Temco Projects: there are no projects to remove.');
    return;
  }

  // The folders are named before anything goes: they are the part of this act that cannot be undone from inside
  // the application, and the modal is the only place a person can still refuse it.
  const named: { slug: string; name: string; folder?: string; exists: boolean }[] = [];
  for (const project of projects) {
    const workFolder = await workFolderOf(project.slug);
    named.push({ slug: project.slug, name: project.name, folder: workFolder?.folder, exists: workFolder?.exists === true });
  }
  const folders = named.filter((entry) => entry.exists);

  const answer = await vscode.window.showWarningMessage(
    `Remove all ${projects.length} project${projects.length === 1 ? '' : 's'}?`,
    {
      modal: true,
      detail: [
        named.map((entry) => `${entry.name}    ${entry.folder ?? '(no folder on this machine)'}`).join('\n'),
        '',
        folders.length === 0
          ? 'The rows are forgotten. No project has a folder on this machine.'
          : `${folders.length} folder${folders.length === 1 ? '' : 's'} is deleted from this machine, with every ` +
            'local copy inside them. Sources stay in the catalog — they are shared — and no origin is touched.',
      ].join('\n'),
    },
    'Remove All'
  );
  if (answer !== 'Remove All') {
    return;
  }

  let rows = 0;
  let gone = 0;
  const kept: string[] = [];

  let catalog: Catalog | undefined;
  try {
    catalog = await Catalog.open(context);
    for (const entry of named) {
      const deleted = catalog.deleteDocument(entry.slug);
      if (deleted === 0) {
        kept.push(`${entry.name} (the catalog deleted no row)`);
        continue;
      }
      rows += deleted;
      if (entry.exists) {
        const discarded = await discardWorkFolder(entry.slug, entry.folder === undefined ? undefined : {
          folder: entry.folder,
          exists: true,
        });
        if (discarded) {
          gone++;
        } else {
          kept.push(`${entry.name} (${entry.folder ?? 'its folder'} could not be deleted)`);
        }
      }
    }
  } catch (error) {
    const message = error instanceof CatalogUnavailable ? error.message : String(error);
    void vscode.window.showErrorMessage(`Temco Projects: ${message}`);
    return;
  } finally {
    catalog?.close();
  }

  // Whatever was being worked on is no longer a project: the application must not keep reading one that is gone.
  if (named.some((entry) => entry.slug === selection.project())) {
    await selection.select(undefined);
  }
  notify();
  await focusLibrary();

  const said = `${rows} project${rows === 1 ? '' : 's'} removed` +
    (gone > 0 ? `, ${gone} folder${gone === 1 ? '' : 's'} deleted` : '') + '.';
  if (kept.length === 0) {
    void vscode.window.showInformationMessage(`Temco Projects: ${said}`);
    return;
  }
  void vscode.window.showWarningMessage(
    `Temco Projects: ${said} What is left: ${kept.join('; ')}.`
  );
}

/**
 * Points the application at a project.
 *
 * Said out loud, once, because the Workspace view changes what it is showing: a view that silently answers a
 * different question is worse than an empty one.
 */
async function selectProject(
  context: vscode.ExtensionContext,
  selection: Selection,
  slug?: string
): Promise<void> {
  const projects = await listDocuments(context);
  if (projects.length === 0) {
    await vscode.commands.executeCommand('temcoProjects.newProject');
    return;
  }

  const current = selection.project();
  const chosen =
    slug !== undefined
      ? projects.find((project) => project.slug === slug)
      : await pickProject(projects, current, 'Work on which project?');
  if (!chosen) {
    return;
  }

  await selection.select(chosen.slug);
  if (current !== chosen.slug) {
    void vscode.window.showInformationMessage(
      `Temco Projects: the Workspace view now follows ${chosen.name}.`
    );
  }
}

async function pickProject(
  projects: { name: string; slug: string; description: string }[],
  current: string | undefined,
  title: string
): Promise<{ name: string; slug: string; description: string } | undefined> {
  return await vscode.window.showQuickPick(
    projects.map((project) => ({
      label: project.slug === current ? `$(pass-filled) ${project.name}` : project.name,
      detail: project.description,
      slug: project.slug,
      name: project.name,
      description: project.slug === current ? 'the project being worked on' : project.description,
    })),
    { title }
  );
}

/**
 * Opens a project, asking which one only when it has to.
 *
 * Reached from the Library, the palette and the dashboard, all of which want a project to already exist — so
 * with none, it offers to create one instead of failing.
 */
async function withProject(
  context: vscode.ExtensionContext,
  open: (slug: string) => void,
  slug?: string
): Promise<void> {
  if (slug !== undefined && slug.length > 0) {
    open(slug);
    return;
  }

  const documents = await listDocuments(context);
  if (documents.length === 0) {
    const answer = await vscode.window.showWarningMessage(
      'Temco Projects: there are no projects yet.',
      'Create a project'
    );
    if (answer === 'Create a project') {
      await vscode.commands.executeCommand('temcoProjects.newProject');
    }
    return;
  }
  if (documents.length === 1) {
    open(documents[0].slug);
    return;
  }

  const chosen = await vscode.window.showQuickPick(
    documents.map((document) => ({ label: document.name, detail: document.description, slug: document.slug })),
    { title: 'Which project?' }
  );
  if (chosen) {
    open(chosen.slug);
  }
}

/** The catalog's projects, in the shape the picker wants. One {@link Catalog} per call, closed again. */
async function listDocuments(
  context: vscode.ExtensionContext
): Promise<{ name: string; slug: string; description: string }[]> {
  let catalog: Catalog | undefined;
  try {
    catalog = await Catalog.open(context);
    return catalog.documents().map((document) => ({
      name: document.name,
      slug: slugOf(document.name),
      description: [
        document.version ? `v${document.version}` : undefined,
        `${document.sources} source${document.sources === 1 ? '' : 's'}`,
        document.builtAt ? 'built' : 'never built',
      ]
        .filter((part): part is string => part !== undefined)
        .join(' · '),
    }));
  } catch (error) {
    const message = error instanceof CatalogUnavailable ? error.message : String(error);
    void vscode.window.showErrorMessage(`Temco Projects: ${message}`);
    return [];
  } finally {
    catalog?.close();
  }
}
