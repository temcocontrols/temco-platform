// Building a *project*, as opposed to building an open folder.
//
// `src/builds.ts` answers "build what is open, the way the repository builds it". This answers "build what I
// am managing" — it takes the project's own recipe (the engine and the outputs chosen on the edit page), turns
// it into the repository's own scripts, runs each as a task, and records the files they left behind in
// the catalog so the Builds tab has something to show next time.
//
// Two rules are inherited from `builds.ts` and not re-decided here:
//   * the exit code is printed but never trusted — a file that did not exist before and does now is the verdict
//   * the deploying form of the help build is never invoked. Building is not shipping.

import * as fs from 'fs';
import * as path from 'path';
import * as vscode from 'vscode';
import { Catalog, CatalogUnavailable, outputs, slugOf } from './store';

/** The script names, per output — the store's one list, so a build runs what the create form ticked under the same name. */
const SCRIPTS: Record<string, readonly string[]> = (() => {
  const map: Record<string, readonly string[]> = {};
  for (const output of outputs.all) {
    map[output.value] = output.scripts;
    map[output.kind] = output.scripts;
  }
  // The three generations of recipe that have named a website.
  map.html = outputs.byValue('website')?.scripts ?? [];
  return map;
})();

/**
 * The generator, run first when the repository has one.
 *
 * It is what writes `docs/help/registry.json`'s neighbours — the index, the per-page metadata, the navbar — and
 * therefore what makes headings, provenance and the stale verdict exist at all. Building without it produces a
 * site that is missing whatever has changed since the last time someone ran it, which is the same as producing
 * a wrong one. Invoked, never reimplemented: it is the repository's own script.
 */
const GENERATOR = ['docs:registry'];
const SKIP = new Set(['node_modules', '.git', '.vs', 'out', 'target', '.venv', 'dist_cache']);

export function registerProjectBuildCommands(context: vscode.ExtensionContext, output: vscode.OutputChannel): void {
  context.subscriptions.push(
    vscode.commands.registerCommand('temcoProjects.buildProject', (slug?: string) => buildProject(context, output, slug))
  );
}

async function buildProject(
  context: vscode.ExtensionContext,
  output: vscode.OutputChannel,
  wanted?: string
): Promise<void> {
  let catalog: Catalog | undefined;
  try {
    catalog = await Catalog.open(context);
    const projects = catalog.documents();
    if (projects.length === 0) {
      void vscode.window.showInformationMessage('Temco Projects: no projects to build yet.');
      return;
    }

    const slug = wanted !== undefined ? slugOf(wanted) : (await pick(projects))?.slug;
    if (!slug) {
      return;
    }
    const detail = catalog.document(slug);
    if (!detail) {
      void vscode.window.showWarningMessage(`Temco Projects: ${slug} is not in the Library any more.`);
      return;
    }

    if (detail.outputs.length === 0 && detail.engine === undefined) {
      void vscode.window.showWarningMessage(
        `Temco Projects: ${detail.name} has no output chosen, so there is nothing to build. ` +
          'Edit the project and say what it should produce.'
      );
      return;
    }

    // Where it runs: a source of this project that is a folder on this machine, and that has such a script.
    const folder = folderFor(catalog, slug);
    if (!folder) {
      void vscode.window.showWarningMessage(
        `Temco Projects: none of ${detail.name}'s sources is a folder on this machine, so its build script ` +
          'cannot be run from here. A source read over the API has to be cloned before it can be built.'
      );
      return;
    }

    const scripts = scriptsOf(folder);
    const wanted_ = scriptsFor(detail.outputs, detail.engine, scripts);
    if (wanted_.length === 0) {
      const named = [...new Set(namesFor(detail.outputs, detail.engine))];
      void vscode.window.showWarningMessage(
        `Temco Projects: ${path.basename(folder)} has none of ${named.map((name) => `\`${name}\``).join(' or ')}, ` +
          'so nothing was run.'
      );
      return;
    }

    const buildId = catalog.startBuild(slug);
    const started = Date.now();
    output.appendLine('');

    // The generator first, when there is one: it is what the output scripts read their structure from.
    const generator = GENERATOR.find((name) => scripts[name] !== undefined);
    if (generator !== undefined) {
      output.appendLine(`Building ${detail.name}: npm run ${generator} in ${folder} (the generator first)`);
      const generated = await runTask(folder, generator);
      output.appendLine(`npm run ${generator} exited with ${generated === undefined ? 'no code' : generated}`);
    } else {
      output.appendLine(
        `Building ${detail.name} in ${folder} — no ${GENERATOR.map((name) => `\`${name}\``).join(' or ')} ` +
          'script, so what is built is whatever the last run of the generator left behind.'
      );
    }

    // One script per ticked output, in the order the ticks were made: asking for a site and a PDF means both run.
    for (const script of wanted_) {
      const exit = await runTask(folder, script);
      output.appendLine(`npm run ${script} exited with ${exit === undefined ? 'no code' : exit}`);
    }

    const produced = findArtifacts(folder, detail.outputs, started);
    output.appendLine(
      produced.length > 0 ? `Produced ${produced.length} file(s):` : 'No file newer than this run was found.'
    );
    for (const file of produced.slice(0, 20)) {
      output.appendLine(`  ${file} · ${describe(file)}`);
    }
    output.show(true);

    // What each target holds *now*, which is not the set of files this run happened to touch: a build that rewrites two
    // pages still leaves the other hundred and twenty-seven, and one that stops writing a folder has to say so.
    // Recording the whole set is what lets the rows of files it no longer writes go.
    let forgotten = 0;
    for (const output of detail.outputs) {
      const files = outputSet(folder, output);
      if (files.length === 0) {
        continue;
      }
      try {
        forgotten += catalog.replaceArtifacts(
          slug,
          kindOf(output),
          files.map((file) => ({ path: file, bytes: sizeOf(file), builtAt: modifiedIso(file) })),
          buildId,
          // A website an earlier build filed under `output` is the same website: its rows go with this one.
          kindOf(output) === 'site' ? ['output'] : []
        );
      } catch {
        // A set that cannot be recorded leaves the last one in place, which the page then shows honestly.
      }
    }
    if (forgotten > 0) {
      output.appendLine(`Forgot ${forgotten} file(s) the build no longer writes.`);
    }
    catalog.finishBuild(buildId, produced.length > 0 ? 'produced' : 'nothing new');

    if (produced.length > 0) {
      const answer = await vscode.window.showInformationMessage(
        `Temco Projects: ${detail.name} left ${produced.length} file(s) — ${path.basename(produced[0])}`,
        'Reveal'
      );
      if (answer === 'Reveal') {
        await vscode.commands.executeCommand('revealFileInOS', vscode.Uri.file(produced[0]));
      }
    } else {
      void vscode.window.showWarningMessage(
        `Temco Projects: ${detail.name} ran but produced no new file. The terminal says why.`
      );
    }
  } catch (error) {
    const message = error instanceof CatalogUnavailable ? error.message : String(error);
    void vscode.window.showErrorMessage(`Temco Projects: ${message}`);
  } finally {
    catalog?.close();
  }
}

async function pick(
  projects: { name: string; version?: string; sources: number }[]
): Promise<{ slug: string } | undefined> {
  if (projects.length === 1) {
    return { slug: slugOf(projects[0].name) };
  }
  const chosen = await vscode.window.showQuickPick(
    projects.map((project) => ({
      label: project.name,
      description: [
        project.version ? `v${project.version}` : '',
        `${project.sources} source${project.sources === 1 ? '' : 's'}`,
      ]
        .filter(Boolean)
        .join(' · '),
      slug: slugOf(project.name),
    })),
    { title: 'Build which project?' }
  );
  return chosen ? { slug: chosen.slug } : undefined;
}

/**
 * Which of the repository's scripts produce the outputs this project asked for.
 *
 * One script per ticked output, each run once: the ticks say what the project is meant to produce, so a project that
 * asked for a site and a PDF runs both scripts rather than whichever one happened to come first. `search` and `ai` have
 * no script here — nothing in this application writes them — so an output with no script is simply skipped; an engine
 * with no tick at all still means a site, because docfx writes one.
 */
/**
 * The scripts an output needs, narrowed to the ones this repository really declares.
 *
 * Exported for `test/temco/projects.mts`: "one script per ticked output" is a claim the guide makes, and a mapping that
 * quietly invents a script name is a build that reports nothing.
 */
export function scriptsFor(
  outputs: readonly string[],
  engine: string | undefined,
  scripts: Record<string, string>
): readonly string[] {
  const wanted: string[] = [];
  for (const output of outputs) {
    const script = (SCRIPTS[output.toLowerCase()] ?? []).find((name) => scripts[name] !== undefined);
    if (script !== undefined && !wanted.includes(script)) {
      wanted.push(script);
    }
  }
  if (wanted.length === 0 && engine === 'docfx') {
    const site = SCRIPTS.site.find((name) => scripts[name] !== undefined);
    if (site !== undefined) {
      wanted.push(site);
    }
  }
  return wanted;
}

/** The scripts the outputs named, whether or not this repository has them: what a warning has to be able to list. */
/** The script names an output would need, for the sentence that says which ones the repository is missing. */
export function namesFor(outputs: readonly string[], engine: string | undefined): readonly string[] {
  const named = outputs.flatMap((output) => SCRIPTS[output.toLowerCase()] ?? []);
  return named.length === 0 && engine === 'docfx' ? SCRIPTS.site : named;
}

/** The folder the script would run in: a source of this project that is on this machine and has a package.json. */
function folderFor(catalog: Catalog, slug: string): string | undefined {
  const cited = catalog.documentSources(slug).map((source) => source.name);
  for (const row of catalog.sources()) {
    if (!cited.includes(row.name)) {
      continue;
    }
    const detail = catalog.source(row.slug);
    if (detail?.path && fs.existsSync(path.join(detail.path, 'package.json'))) {
      return detail.path;
    }
  }
  return undefined;
}

function runTask(cwd: string, script: string): Promise<number | undefined> {
  const folder = vscode.workspace.workspaceFolders?.find((one) => cwd.startsWith(one.uri.fsPath));
  const task = new vscode.Task(
    { type: 'temcoDocs', script },
    folder ?? vscode.TaskScope.Global,
    script,
    'temcoDocs',
    new vscode.ShellExecution('npm', ['run', script], { cwd })
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

/**
 * What the run left behind.
 *
 * A CHM lands inside the repository or in a `HelpDocs` folder beside it; a site lands in `dist/docs` or
 * `docs/_site`. All four are looked at, and the rule that decides is the same one `builds.ts` uses: newer than
 * this run started.
 */
function findArtifacts(folder: string, wanted: readonly string[], since: number): string[] {
  const patterns = patternsFor(wanted);
  const roots = [
    folder,
    path.join(folder, 'dist', 'docs'),
    path.join(folder, 'docs', '_site'),
    ...siblingHelpDocs(folder),
  ];
  const found: string[] = [];
  for (const root of roots) {
    for (const pattern of patterns) {
      walk(root, since, pattern, found, 8);
    }
  }
  return [...new Set(found)].sort((a, b) => modified(b) - modified(a));
}

/**
 * The catalog's name for a target.
 *
 * Three things can be published — a website, a PDF, the offline help — and the page groups by them. `website`, `site`
 * and `html` are the same target under the names three generations of the recipe have used.
 */
function kindOf(output: string): string {
  return outputs.byValue(output)?.kind ?? output.toLowerCase();
}

/**
 * Everything a target holds after the build — the set that replaces the last one.
 *
 * A website is a folder this application can read whole, so every file in it is the website: pages, pictures, the index,
 * the stylesheet. A PDF or a help file is one kind of file among a repository's sources, so there the extension decides
 * and only the folders the target writes are walked. Files this run did not touch are part of it too.
 */
function outputSet(folder: string, output: string): string[] {
  const kind = kindOf(output);
  // The indexes are made from the site by another module and are not this build's files: walking the site folder for
  // them would file every page a second time under a name nothing here wrote.
  if (kind === 'search' || kind === 'ai') {
    return [];
  }
  const found: string[] = [];
  const roots = [
    ...(kind === 'chm' || kind === 'pdf'
      ? [folder, ...siblingHelpDocs(folder)]
      : [path.join(folder, 'dist', 'docs'), path.join(folder, 'dist', 'site'), path.join(folder, 'docs', '_site')]),
  ];
  const pattern = kind === 'chm' ? /\.chm$/i : kind === 'pdf' ? /\.pdf$/i : undefined;
  for (const root of roots) {
    collect(root, pattern, found, pattern === undefined ? 10 : 6);
  }
  return [...new Set(found)].sort();
}

/** A whole folder, or the files in it whose name matches: one walker for both, because the skip list is the same. */
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

/** When a file was written, as the catalog stores it: a build re-records files it did not touch, and "now" would lie. */
function modifiedIso(file: string): string | undefined {
  try {
    return new Date(fs.statSync(file).mtimeMs).toISOString();
  } catch {
    return undefined;
  }
}

function patternsFor(wanted: readonly string[]): RegExp[] {
  const patterns: RegExp[] = [];
  for (const output of wanted) {
    const kind = kindOf(output);
    if (kind === 'chm') {
      patterns.push(/\.chm$/i);
    } else if (kind === 'pdf') {
      patterns.push(/\.pdf$/i);
    } else if (kind === 'site') {
      // A published site is Markdown and the pictures beside it as much as any page of HTML.
      patterns.push(/\.(md|html|json|png|jpe?g|gif|svg|webp|css|js)$/i);
    }
  }
  return patterns.length > 0 ? patterns : [/\.(md|html|chm|pdf)$/i];
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

/** `HelpDocs` folders beside the repository — where the help build writes when it does not deploy. */
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

function scriptsOf(folder: string): Record<string, string> {
  try {
    const parsed = JSON.parse(fs.readFileSync(path.join(folder, 'package.json'), 'utf8')) as {
      scripts?: Record<string, string>;
    };
    return parsed.scripts ?? {};
  } catch {
    return {};
  }
}

function sizeOf(file: string): number | undefined {
  try {
    return fs.statSync(file).size;
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
