// The product repo's own builds, invoked rather than reimplemented.
//
// `docs/architecture.md`: the extension orchestrates the publishing pipeline, it never replaces it. So this
// finds the script in the repository's own `package.json`, runs it as an ordinary VS Code task — visible in the
// terminal, cancellable, and stopped with the same button as any other task — and then judges the *artifact*.
// That last part is not caution for its own sake: the CHM build's exit code has never been trustworthy
// (`07-offline-pdf-chm.md`), and a build that reports success without producing a file has not succeeded.
//
// One thing this deliberately never does: run the deploying form of the help build. That form copies the CHM
// into a product installation, and building is not shipping.

import * as fs from 'fs';
import * as path from 'path';
import * as vscode from 'vscode';
import { DocsRoot } from './registry';
import { OFFERED_SCRIPTS } from './repositories';
import { Catalog, selection } from './store';

/** Folders never worth walking: build caches and clones, not artifacts. */
const SKIP = new Set(['node_modules', '.git', '.vs', 'out', 'target', '.venv', 'dist_cache']);

/** The site build, as the product repository names it. A rename there is reported, never guessed around. */
const SITE_SCRIPTS = ['docs:site', 'docs:build'];
/** Only the non-deploying help build is invoked; see the note at the top. */
const HELP_SCRIPTS = ['build:help:dry'];

export function registerBuildCommands(
  context: vscode.ExtensionContext,
  roots: () => readonly DocsRoot[],
  output: vscode.OutputChannel,
  site: (root: DocsRoot) => Promise<string | undefined> = async () => undefined
): void {
  context.subscriptions.push(
    vscode.commands.registerCommand('temcoDocs.buildSite', async () => {
      const root = await pickRoot(roots(), 'build the site for');
      if (!root) {
        return;
      }
      await buildSiteFor(context, root, output, site);
    }),

    // Previewing is the site module's: the site is its own repository, and that module runs and shows it. What stays
    // here is the build, and the entry point every menu item has always used.
    vscode.commands.registerCommand('temcoDocs.previewSite', async () => {
      const root = await pickRoot(roots(), 'preview the site for');
      if (!root) {
        return;
      }
      await buildSiteFor(context, root, output, site);
      await vscode.commands.executeCommand('temcoLearn.site.preview');
    }),

    vscode.commands.registerCommand('temcoDocs.buildHelp', async () => {
      const root = await pickRoot(roots(), 'build the offline help for');
      if (!root) {
        return;
      }
      const scripts = scriptsOf(root);
      if (scripts && !scripts['build:help:dry']) {
        void vscode.window.showWarningMessage(
          scripts['build:help']
            ? 'Temco Docs: this repository only has the deploying help build (`build:help`), which copies the ' +
            'CHM into a product installation. Nothing was run — that act is not this extension\'s to make.'
            : 'Temco Docs: this repository has no `build:help:dry` script, so nothing was run.'
        );
        return;
      }
      await build(context, root, output, {
        label: 'the offline help build',
        kind: 'chm',
        scripts: HELP_SCRIPTS,
        missing: 'This repository has no `build:help:dry` script, so nothing was run.',
        // The CHM lands inside the repository or in a `HelpDocs` folder beside it — the build's own
        // configuration decides which, so both are looked at.
        roots: [root.folder.uri.fsPath],
        siblingHelpDocs: true,
        pattern: /\.chm$/i,
      });
    })
  );
}

/**
 * The site build itself, for one set: the recipe the command runs and nothing else.
 *
 * Kept apart from the command so a second entry point — Preview — builds the same site the same way, rather than
 * becoming the place where the two recipes drift.
 */
async function buildSiteFor(
  context: vscode.ExtensionContext,
  root: DocsRoot,
  output: vscode.OutputChannel,
  generate: (root: DocsRoot) => Promise<string | undefined>
): Promise<void> {
  await build(context, root, output, {
    label: 'the site build',
    kind: 'site',
    scripts: SITE_SCRIPTS,
    missing: 'This repository has no `docs:site` (or `docs:build`) script, so nothing was run.',
    // docfx.json writes here: the generated project names its destination `../dist/docs`.
    roots: [path.join(root.folder.uri.fsPath, 'dist', 'docs'), path.join(root.folder.uri.fsPath, 'dist', 'site')],
    siblingHelpDocs: false,
    // What this run wrote, for the log: the artifact set itself is read from the folder (see outputsOf), because a
    // documentation build writes Markdown and the pictures beside it as much as any page of HTML.
    pattern: /\.(html|json|md|png|jpe?g|gif|svg|webp|css|js|pdf)$/i,
    generate,
  });
}


interface Recipe {
  label: string;
  /** What the artifact is, as the catalog files it: `site`, `chm`, `pdf`. */
  kind: string;
  scripts: readonly string[];
  missing: string;
  /** Where the build writes, searched deeply. */
  roots: readonly string[];
  /** Whether a `HelpDocs` folder beside the repository may be searched too. */
  siblingHelpDocs: boolean;
  pattern: RegExp;
  /**
   * The built-in build, used when the project has no script to run.
   *
   * A folder of Markdown is a documentation project whether or not it has build tooling; with no `package.json` there is
   * nothing to invoke, and refusing to publish would mean a project could be written here and never read anywhere else.
   * Returns the file it wrote, or undefined when it could not build.
   */
  generate?: (root: DocsRoot) => Promise<string | undefined>;
}

/**
 * The build, as the catalog remembers it.
 *
 * Opened before the script runs, so a build that crashes the editor still leaves the attempt behind; closed with
 * the verdict this module judges — whether a file appeared — rather than the exit code it was handed.
 */
interface BuildWatch {
  artifact(kind: string, file: string): void;
  /**
   * The target's output as it now stands: every file in the folder the build writes, not only the ones this run
   * touched. Recording the whole set is what lets the rows of files the build stopped writing go away.
   */
  outputs(kind: string, files: readonly string[]): void;
  finish(status: string): void;
}

/** Nothing to record when no project is selected: a build without a project is a build about nothing. */
async function openWatch(context: vscode.ExtensionContext, output: vscode.OutputChannel): Promise<BuildWatch | undefined> {
  const project = selection.project();
  if (project === undefined) {
    return undefined;
  }
  let catalog: Catalog | undefined;
  try {
    catalog = await Catalog.open(context);
    const buildId = catalog.startBuild(project);
    return {
      artifact: (kind, file) => {
        try {
          catalog?.recordArtifact(project, { kind, path: file, bytes: bytesOf(file), buildId });
        } catch {
          // An artifact that cannot be recorded is still a file on disk; the log above says where it is.
        }
      },
      outputs: (kind, files) => {
        try {
          const recorded = catalog?.replaceArtifacts(
            project,
            kind,
            files.map((file) => ({ path: file, bytes: bytesOf(file), builtAt: modifiedIso(file) })),
            buildId,
            // An earlier build path filed a website under `output`: the same target, so its rows go with it.
            kind === 'site' ? ['output'] : []
          );
          if (recorded !== undefined && recorded > 0) {
            output.appendLine(`Forgot ${recorded} file(s) of ${kind} that this build no longer writes.`);
          }
        } catch {
          // A set that cannot be recorded leaves the last one in place, which the page then shows honestly.
        }
      },
      finish: (status) => {
        try {
          catalog?.finishBuild(buildId, status);
        } catch {
          // The row stays open, which reads as a build that never said how it went.
        }
        catalog?.close();
      },
    };
  } catch {
    catalog?.close();
    return undefined;
  }
}

function bytesOf(file: string): number | undefined {
  try {
    return fs.statSync(file).size;
  } catch {
    return undefined;
  }
}

/** When a file was written, as the catalog stores it. ISO, because every other time in a row is. */
function modifiedIso(file: string): string | undefined {
  try {
    return new Date(fs.statSync(file).mtimeMs).toISOString();
  } catch {
    return undefined;
  }
}

/**
 * Everything the target holds after the build — the set that replaces the last one.
 *
 * Two shapes, because the targets are two shapes. A site is a folder this application can read whole, so every file in
 * it is the site: the Markdown, the pictures it points at, the index, the stylesheet. A help file or a PDF is one kind of
 * file among a repository's sources, so there the extension decides, and only the folders the target writes are walked.
 *
 * Deliberately not filtered by time: a file this run did not touch is still part of what a reader gets.
 */
function outputsOf(recipe: Recipe): string[] {
  const found: string[] = [];
  const roots = [...recipe.roots, ...(recipe.siblingHelpDocs ? siblingHelpDocs(recipe.roots[0] ?? '') : [])];
  const site = recipe.kind === 'site';
  for (const root of roots) {
    collect(root, site ? undefined : recipe.pattern, found, site ? 10 : 6);
  }
  return [...new Set(found)].sort();
}

/** A whole folder, or every file in it whose name matches: one walker for both, because the skip list is the same. */
function collect(directory: string, pattern: RegExp | undefined, found: string[], depth: number): void {
  if (depth < 0) {
    return;
  }
  let entries: fs.Dirent[];
  try {
    entries = fs.readdirSync(directory, { withFileTypes: true });
  } catch {
    return;
  }
  for (const entry of entries) {
    const full = path.join(directory, entry.name);
    if (entry.isDirectory()) {
      if (SKIP.has(entry.name)) {
        continue;
      }
      collect(full, pattern, found, depth - 1);
    } else if (pattern === undefined || pattern.test(entry.name)) {
      found.push(full);
    }
  }
}

/**
 * Runs one build and reports what it produced.
 *
 * The exit code is printed but never used as the verdict: what counts is a file that did not exist before and
 * does now.
 */
async function build(context: vscode.ExtensionContext, root: DocsRoot, output: vscode.OutputChannel, recipe: Recipe): Promise<void> {
  const scripts = scriptsOf(root);
  /** Nothing to invoke: the built-in build gets its chance, then the reader is told why nothing happened. */
  const decline = async (): Promise<void> => {
    if (recipe.generate !== undefined) {
      const produced = await recipe.generate(root);
      if (produced !== undefined) {
        output.appendLine('');
        output.appendLine(`[${recipe.label}] built here: ${produced}`);
        void vscode.window.showInformationMessage(`Temco Docs: ${recipe.label} is ready at ${produced}.`);
      }
      // Whatever happened, the generator explained it; a second, vaguer warning on top would only confuse.
      return;
    }
    void vscode.window.showWarningMessage(
      scripts === undefined
        ? `Temco Docs: ${vscode.workspace.asRelativePath(root.folder.uri)} has no package.json, so there is no build to invoke.`
        : `Temco Docs: ${recipe.missing}`
    );
  };
  if (scripts === undefined) {
    await decline();
    return;
  }
  const script = recipe.scripts.find((name) => typeof scripts[name] === 'string');
  if (!script) {
    await decline();
    return;
  }

  const started = Date.now();
  output.appendLine('');
  output.appendLine(`Building ${recipe.label} in ${root.folder.name}: npm run ${script}`);
  // Opened before the script runs: the attempt is a fact whether or not anything comes of it.
  const watch = await openWatch(context, output);

  // The generator first, when the repository carries one: `docs:registry` is what writes the index, the headings
  // and the stale verdict, so a build that skips it renders whatever the last person happened to leave behind —
  // including pages added since. `platform-design.md`, decision E. It is invoked, never reimplemented.
  if (script !== 'docs:registry' && typeof scripts['docs:registry'] === 'string') {
    output.appendLine('Running the repository’s own generator first: npm run docs:registry');
    const generated = await runTask(root, 'docs:registry');
    output.appendLine(`npm run docs:registry exited with ${generated === undefined ? 'no code' : generated}`);
  }

  const exit = await runTask(root, script);
  output.appendLine(`npm run ${script} exited with ${exit === undefined ? 'no code' : exit}`);

  const files = findArtifacts(recipe, started);
  output.appendLine(
    files.length > 0 ? `Produced ${files.length} file(s):` : 'No artifact newer than this run was found.'
  );
  for (const file of files.slice(0, 20)) {
    output.appendLine(`  ${file} · ${describe(file)}`);
  }
  output.show(true);

  // What the target holds now, not what this run touched: unchanged files are still its output, and files the build
  // stopped writing are not.
  watch?.outputs(recipe.kind, outputsOf(recipe));
  watch?.finish(files.length > 0 ? 'succeeded' : 'no artifact');

  const answer =
    files.length > 0
      ? await vscode.window.showInformationMessage(
        `Temco Docs: ${recipe.label} left ${files.length} file(s) — ${vscode.workspace.asRelativePath(files[0])}`,
        'Reveal'
      )
      : await vscode.window.showWarningMessage(
        `Temco Docs: ${recipe.label} ran but produced no new file. The terminal above says why.`,
        'Show the report'
      );

  if (answer === 'Reveal' && files[0]) {
    await vscode.commands.executeCommand('revealFileInOS', vscode.Uri.file(files[0]));
  }
  if (answer === 'Show the report') {
    output.show(true);
  }
}

/**
 * Runs the repository's own `docs:owed` check.
 *
 * Invoked, never reimplemented — and never interpreted. What is owed is a *documentation gate* the product
 * repository owns, with its own waivers and its own expiry dates (`11-review-and-cicd.md`), so this runs the
 * script as a task (visible, cancellable, in the terminal) and reports only what a run is: where, when, and the
 * exit code. Reading its output to decide anything here would be the second opinion the design forbids.
 */
export async function runOwed(
  roots: readonly DocsRoot[],
  output: vscode.OutputChannel
): Promise<ScriptRun | undefined> {
  return await runScript(roots, output, 'docs:owed');
}

/** What one run of one script left behind. A run is a fact: where, when, which script, what it exited with. */
export interface ScriptRun {
  folder: string;
  script: string;
  exit: number | undefined;
  at: string;
  /** Files the generator rewrote, by name — only ever filled in for `docs:registry`, whose output is files. */
  rewritten: string[];
}

/**
 * Runs one of the {@link OFFERED_SCRIPTS}, in the first folder being read that has it.
 *
 * One folder, not all of them: a check reports on *a* repository, and running the same check in three clones
 * produces three verdicts that nobody asked to compare.
 */
export async function runScript(
  roots: readonly DocsRoot[],
  output: vscode.OutputChannel,
  id: string
): Promise<ScriptRun | undefined> {
  const offered = OFFERED_SCRIPTS.find((script) => script.id === id);
  if (!offered) {
    return undefined;
  }

  const candidates = roots.filter((root) => root.origin !== 'catalog');
  if (candidates.length === 0) {
    void vscode.window.showInformationMessage(
      'Temco Docs: nothing on this machine is being read, so there is no repository to run that in. ' +
      'A source read over the API has no working tree to check in.'
    );
    return undefined;
  }

  output.appendLine('');
  for (const root of candidates) {
    const scripts = scriptsOf(root);
    if (typeof scripts?.[id] !== 'string') {
      output.appendLine(`  ${root.folder.name}: no \`${id}\` script — nothing was run there.`);
      continue;
    }

    // The generator's output *is* files, so the honest report of a regeneration is which of them it rewrote.
    const before = generated(root);
    output.appendLine(`${offered.label} in ${root.folder.name}: npm run ${id}`);
    const exit = await runTask(root, id);
    output.appendLine(`npm run ${id} exited with ${exit === undefined ? 'no code' : exit}`);

    const rewritten =
      id === 'docs:registry'
        ? [...generated(root)]
          .filter(([name, stamp]) => before.get(name) !== stamp)
          .map(([name]) => name)
        : [];
    for (const name of rewritten) {
      output.appendLine(`  rewritten: ${name}`);
    }
    output.show(true);

    return {
      folder: root.folder.name,
      script: id,
      exit,
      at: new Date().toISOString().slice(0, 16).replace('T', ' '),
      rewritten,
    };
  }

  output.appendLine(`  No repository being read has a \`${id}\` script.`);
  output.show(true);
  void vscode.window.showInformationMessage(
    `Temco Docs: no repository being read has a \`${id}\` script, so there is nothing to run.`
  );
  return undefined;
}

/** The files the generator owns, with a stamp that changes exactly when one of them is rewritten. */
const GENERATED = [
  'docs/help/index.json',
  'docs/help/page-meta.json',
  'docs/help/registry.json',
  'docs/docfx.json',
  'docs/toc.yml',
  'docs/_admin/index.md',
];

function generated(root: DocsRoot): Map<string, string> {
  const stamps = new Map<string, string>();
  for (const name of GENERATED) {
    const file = path.join(root.folder.uri.fsPath, ...name.split('/'));
    try {
      const stat = fs.statSync(file);
      stamps.set(name, `${stat.mtimeMs}:${stat.size}`);
    } catch {
      stamps.set(name, 'missing');
    }
  }
  return stamps;
}

/** The offered scripts the folders being read actually have — what may be offered to run, and nothing else. */
export function scriptsIn(roots: readonly DocsRoot[]): Set<string> {
  const names = new Set<string>();
  for (const root of roots) {
    if (root.origin === 'catalog') {
      continue;
    }
    for (const name of Object.keys(scriptsOf(root) ?? {})) {
      names.add(name);
    }
  }
  return names;
}

/** The commands a person reaches for without opening a page: the generator, and the palette's list of all four. */
export function registerScriptCommands(
  context: vscode.ExtensionContext,
  roots: () => readonly DocsRoot[],
  output: vscode.OutputChannel,
  refresh: () => void
): void {
  const run = async (id: string): Promise<void> => {
    const result = await runScript(roots(), output, id);
    // The generator rewrites what the tree reads — index.json carries the headings, the provenance and the
    // stale verdict — so a regeneration that is not followed by a re-read would leave the view stale.
    if (result !== undefined || id !== 'docs:registry') {
      refresh();
    }

    if (result === undefined) {
      return;
    }
    const exit = result.exit === undefined ? 'no exit code' : `exit ${result.exit}`;
    void vscode.window.showInformationMessage(
      `Temco Docs: npm run ${id} in ${result.folder} — ${exit}` +
      (result.rewritten.length > 0 ? `, rewrote ${result.rewritten.length} file(s)` : '') +
      '. Its own output is the verdict.'
    );
  };

  context.subscriptions.push(
    vscode.commands.registerCommand('temcoDocs.runScript', async (target?: unknown) => {
      const wanted = typeof target === 'string' ? target : (target as { id?: string } | undefined)?.id;
      if (wanted !== undefined && wanted.length > 0) {
        await run(wanted);
        return;
      }

      // No argument — from the palette or the Library's title bar: offer only what this repository actually has.
      const names = scriptsIn(roots());
      const offered = OFFERED_SCRIPTS.filter((script) => names.has(script.id));
      if (offered.length === 0) {
        void vscode.window.showInformationMessage(
          'Temco Docs: the repository being read has none of these scripts — ' +
          OFFERED_SCRIPTS.map((script) => `\`${script.id}\``).join(', ') +
          '.'
        );
        return;
      }
      const picked = await vscode.window.showQuickPick(
        offered.map((script) => ({ label: script.label, detail: script.detail, description: script.id, id: script.id })),
        { title: 'Run one of the repository’s own scripts' }
      );
      if (picked) {
        await run(picked.id);
      }
    }),
    vscode.commands.registerCommand('temcoDocs.runOwed', async () => run('docs:owed'))
  );
}

/** Every file the run produced: newer than it started, and matching the recipe. */
function findArtifacts(recipe: Recipe, since: number): string[] {
  const found: string[] = [];
  for (const directory of recipe.roots) {
    walk(directory, since, recipe.pattern, found, 8);
  }
  if (recipe.siblingHelpDocs) {
    for (const directory of siblingHelpDocs(recipe.roots[0] ?? '')) {
      walk(directory, since, recipe.pattern, found, 6);
    }
  }
  return found.sort((a, b) => modified(b) - modified(a));
}

function walk(directory: string, since: number, pattern: RegExp, found: string[], depth: number): void {
  if (depth < 0) {
    return;
  }
  let entries: fs.Dirent[];
  try {
    entries = fs.readdirSync(directory, { withFileTypes: true });
  } catch {
    return;
  }
  for (const entry of entries) {
    const full = path.join(directory, entry.name);
    if (entry.isDirectory()) {
      if (SKIP.has(entry.name)) {
        continue;
      }
      walk(full, since, pattern, found, depth - 1);
    } else if (pattern.test(entry.name) && modified(full) >= since) {
      found.push(full);
    }
  }
}

/**
 * `HelpDocs` folders beside the repository — where the help build writes when it does not deploy.
 *
 * Found by name rather than by naming another repository: this must not know the layout of the product's
 * other repositories, only that the convention exists.
 */
function siblingHelpDocs(folder: string): string[] {
  const parent = path.dirname(folder);
  const found: string[] = [];
  let entries: fs.Dirent[];
  try {
    entries = fs.readdirSync(parent, { withFileTypes: true });
  } catch {
    return found;
  }
  for (const entry of entries) {
    if (!entry.isDirectory()) {
      continue;
    }
    const candidate = path.join(parent, entry.name, 'HelpDocs');
    if (fs.existsSync(candidate)) {
      found.push(candidate);
    }
  }
  return found;
}

function runTask(root: DocsRoot, script: string): Promise<number | undefined> {
  // The scope is the workspace folder when it is one: a source of a project can be a path this window has
  // closed, and a task must still be runnable there, so anything else runs unscoped rather than being refused.
  const folder = (vscode.workspace.workspaceFolders ?? []).find(
    (one) => one.uri.toString() === root.rootUri.toString()
  );
  const task = new vscode.Task(
    { type: 'temcoDocs', script },
    folder ?? vscode.TaskScope.Global,
    `${root.folder.name}: ${script}`,
    'temcoDocs',
    new vscode.ShellExecution('npm', ['run', script], { cwd: root.folder.uri.fsPath })
  );
  task.presentationOptions = {
    reveal: vscode.TaskRevealKind.Always,
    panel: vscode.TaskPanelKind.Shared,
    clear: false,
  };
  return new Promise<number | undefined>((resolve) => {
    vscode.tasks.executeTask(task).then(
      (execution) => {
        const ended = vscode.tasks.onDidEndTaskProcess((event) => {
          if (event.execution === execution) {
            ended.dispose();
            resolve(event.exitCode);
          }
        });
      },
      () => resolve(undefined)
    );
  });
}

async function pickRoot(roots: readonly DocsRoot[], what: string): Promise<DocsRoot | undefined> {
  if (roots.length === 0) {
    void vscode.window.showWarningMessage(
      `Temco Docs: open the repository you want to ${what} — none of the open folders has docs/help/registry.json.`
    );
    return undefined;
  }
  if (roots.length === 1) {
    return roots[0];
  }
  const picked = await vscode.window.showQuickPick(
    roots.map((root) => ({ label: root.folder.name, description: `${root.pages} pages`, root })),
    { title: `Temco Docs: which repository do you want to ${what}?` }
  );
  return picked?.root;
}

/** The repository's own scripts — the only commands this extension is willing to run. */
function scriptsOf(root: DocsRoot): Record<string, string> | undefined {
  const file = path.join(root.folder.uri.fsPath, 'package.json');
  try {
    const parsed = JSON.parse(fs.readFileSync(file, 'utf8')) as { scripts?: Record<string, string> };
    return parsed.scripts ?? {};
  } catch {
    return undefined;
  }
}

function describe(file: string): string {
  try {
    const stat = fs.statSync(file);
    return `${Math.round(stat.size / 1024)} KB · ${stat.mtime.toLocaleTimeString()}`;
  } catch {
    return 'size unknown';
  }
}

function modified(file: string): number {
  try {
    return fs.statSync(file).mtimeMs;
  } catch {
    return 0;
  }
}
