// The organisations this window asks GitHub about, and the repositories they hold, as a page.
//
// This is the platform's front door for repositories: the default enterprise is written on first use, a person
// adds their own enterprise or a single repository's address, and the selected one's repositories are listed —
// held in the catalog, so a refused read costs a warning rather than an empty page.
//
// The Library's *Sources* row lists what has already been read. This is the step before it: what an enterprise has,
// which of them the project being worked on already cites, and the buttons that **start** a repository (add it as
// a source of that project and read its registry) or fetch a local copy of it.
//
// Nothing here writes to a repository. A source is a row in the catalog on this machine, and reading one is
// `read.ts`'s job — the same command the Library uses, so the output and the notes are the same too.

import * as vscode from 'vscode';
import { Catalog, OrganisationRow, RepositoryCacheRow, Selection, slugOf } from './store';
import { REPOSITORIES_VIEW_TYPE } from './surface';
import { page, pageColumn, remember } from './ui';
import { listRepositories } from './repository';
import { cloneRoot, cloneSize, hasClone, projectFor } from './workarea';

/** The enterprise the platform ships its own documentation from — written as the first organisation. */
const DEFAULT_ORGANISATION = 'temcocontrols';

interface RepositoriesMessage {
  type?: string;
  name?: string;
  url?: string;
  text?: string;
  /** A command the page asks for by id — the token prompt, so a refusal can be answered where it is read. */
  command?: string;
  /** The act a selection asks for — the same acts a single row offers, applied to every name. */
  action?: 'start' | 'fetch' | 'pull' | 'removeClone' | 'project';
  names?: string[];
  /** The organisation whose list is wanted — the strip at the top of the page. */
  slug?: string;
}

/** The organisation the page opens on: a setting, with the default the platform was built for. */
function defaultOrganisation(): string {
  const configured = vscode.workspace.getConfiguration('temcoRepositories').get<string>('organisation');
  return configured !== undefined && configured.trim().length > 0 ? configured.trim() : DEFAULT_ORGANISATION;
}

/**
 * What a typed name means.
 *
 * One field adds either of the two things a person actually has: the name of an enterprise or an account, or the
 * address of one repository. The shape decides — an address has an owner *and* a repository in it — so nobody has
 * to pick a kind before typing.
 */
function typedName(text: string): { kind: 'organisation' | 'repository'; name: string; url?: string } | undefined {
  const clean = text.trim()
    .replace(/^https?:\/\//i, '')
    .replace(/^www\./i, '')
    .replace(/^github\.com\//i, '')
    .replace(/\.git$/i, '')
    .replace(/[\/]+$/, '');
  if (clean.length === 0 || /\s/.test(clean)) {
    return undefined;
  }
  const parts = clean.split('/').filter((part) => part.length > 0);
  if (parts.length === 1) {
    return { kind: 'organisation', name: parts[0] };
  }
  if (parts.length === 2) {
    const [owner, repository] = parts;
    return { kind: 'repository', name: `${owner}/${repository}`, url: `https://github.com/${owner}/${repository}` };
  }
  return undefined;
}

export class RepositoriesPage {
  private panel: vscode.WebviewPanel | undefined;
  /** The list the selected organisation last answered with, so a click does not mean a second round trip. */
  private listed: RepositoryCacheRow[] = [];
  /** The organisation the page is showing — what `start`, `fetch` and `pull` act on. */
  private showing: string | undefined;
  /**
   * The project this page was opened *for*, when it was opened from that project's page.
   *
   * Set means citing is a write into that project, right here: the project exists in the catalog, so there is no form
   * to hand the choice back to. Unset means the list is being browsed on its own, and citing belongs to the new-project
   * form — the one place a project is still being written.
   */
  private citeTarget: string | undefined;

  constructor(
    private readonly context: vscode.ExtensionContext,
    private readonly selection: Selection,
    private readonly output: vscode.OutputChannel,
    private readonly refresh: () => void
  ) { }

  /** Opens the page, or brings it forward if it is already open. One instance, always. */
  open(slug?: string, citeTarget?: string, restored?: vscode.WebviewPanel): void {
    remember(this.context, REPOSITORIES_VIEW_TYPE, slug ?? citeTarget ?? '');
    // Opened *for* one organisation — the panel asks for its own row, not for whatever was last shown.
    if (slug !== undefined) {
      this.showing = slug;
    }
    // Always assigned: a plain open is a browse, and a browse must not inherit the last project's target.
    this.citeTarget = citeTarget;
    if (this.panel) {
      // Already drawn once: bring it forward and re-read what it says. Re-baking the HTML here would throw away the
      // list, the ticks and the scroll position, and put “Reading the organisation from GitHub…” back on screen for
      // as long as the database takes — the list a person came back to is already drawn.
      this.panel.reveal(pageColumn());
      void this.send();
      return;
    }
    // A restored tab is drawn into rather than replaced: it keeps its place in the strip.
    this.panel = restored ?? vscode.window.createWebviewPanel(REPOSITORIES_VIEW_TYPE, 'Repositories', pageColumn(), {
      enableScripts: true,
      localResourceRoots: [],
    });
    this.panel.webview.options = { enableScripts: true, localResourceRoots: [] };
    this.panel.onDidDispose(() => {
      this.panel = undefined;
    });
    this.panel.webview.onDidReceiveMessage((message: RepositoriesMessage) => void this.receive(message));
    // Shown again after another page has had the focus — a project page, say, where a citation may have changed.
    this.panel.onDidChangeViewState((state) => {
      if (state.webviewPanel.visible) {
        void this.send(undefined, false);
      }
    });
    void this.render();
  }

  dispose(): void {
    this.panel?.dispose();
  }

  private async render(): Promise<void> {
    const panel = this.panel;
    if (!panel) {
      return;
    }
    panel.webview.html = html(this.citeTarget !== undefined);
    await this.send();
  }

  /**
   * The page, in two messages: what is held now, then what GitHub answers.
   *
   * The held list goes out first so the page paints at once — a dashboard that waits for the network is a blank
   * screen on a rate-limited machine. The read follows and replaces it; a refusal follows as the same list with
   * the reason attached. `ask` is false when the page is only being repainted — coming back to its tab is not a
   * reason to spend a request.
   */
  private async send(slug?: string, ask = true): Promise<void> {
    const panel = this.panel;
    if (!panel) {
      return;
    }

    let catalog: Catalog | undefined;
    try {
      catalog = await Catalog.open(this.context);
    } catch (error) {
      await panel.webview.postMessage({
        type: 'seed',
        error: `The platform database could not be opened, so there is no list to show. ${error instanceof Error ? error.message : String(error)}`,
      });
      return;
    }

    try {
      // The default enterprise is written on first use: the front door is never an empty form.
      if (catalog.organisations().length === 0) {
        catalog.addOrganisation({
          kind: 'organisation',
          name: defaultOrganisation(),
          slug: slugOf(defaultOrganisation()),
        });
      }
      const organisations = catalog.organisations();
      const org = organisations.find((row) => row.slug === (slug ?? this.showing)) ?? organisations[0];
      this.showing = org.slug;
      this.listed = catalog.repositoriesOf(org.slug);
      // One open reads everything this pass needs: the held list, what the project cites, and the project's name. Each
      // of those used to open the catalog on its own, which is what the page waited on before it could paint.
      const project = this.citeTarget ?? this.selection.project();
      const cited = project === undefined ? [] : catalog.documentSources(project).map((source) => source.name);
      const citeName = this.citeTarget === undefined ? undefined : catalog.document(this.citeTarget)?.name;
      await panel.webview.postMessage(await this.seed(organisations, org, this.listed, cited, project, citeName));

      // One repository named by its address is its own answer; an enterprise has to be asked.
      if (!ask || org.kind === 'repository') {
        return;
      }
      const result = await listRepositories(this.context, org.name);
      if ('error' in result) {
        catalog.recordOrganisationRead(org.slug, 'refused');
        await panel.webview.postMessage({
          ...(await this.seed(catalog.organisations(), org, this.listed, cited, project, citeName)),
          warning: result.error,
        });
        return;
      }
      this.listed = result.repositories;
      catalog.replaceRepositories(org.slug, result.repositories);
      catalog.recordOrganisationRead(org.slug, 'read');
      const renamed = catalog.organisations().find((row) => row.slug === org.slug) ?? org;
      await panel.webview.postMessage({
        ...(await this.seed(catalog.organisations(), renamed, this.listed, cited, project, citeName)),
        truncated: result.truncated,
      });
    } finally {
      catalog.close();
    }
  }

  /** Everything the page draws for one organisation: the strip, its list, the clones, and who cites what. */
  private async seed(
    organisations: readonly OrganisationRow[],
    org: OrganisationRow,
    repositories: readonly RepositoryCacheRow[],
    cited: readonly string[],
    project: string | undefined,
    citeName: string | undefined
  ): Promise<Record<string, unknown>> {
    return {
      type: 'seed',
      org: org.slug,
      organisations,
      project,
      cited,
      // Citing writes into this project when the page was opened from it; the button says which it is.
      citeTarget: this.citeTarget,
      citeTargetName: citeName,
      takenAt: org.lastRead,
      state: org.state,
      // Where a clone lands — the shared `source` folder — and what a draft is written beside it.
      where: cloneRoot(),
      copies: await this.clones(repositories),
      repositories,
    };
  }

  /**
   * Which of the rows already have a local copy, so the page offers *Fetch* or *Pull* rather than both.
   *
   * A clone belongs to no project — one copy per repository, in the shared `source` folder — so this asks about the
   * repository, not about what the window happens to be working on.
   */
  private async clones(rows: readonly RepositoryCacheRow[]): Promise<Record<string, string | undefined>> {
    const copies: Record<string, string | undefined> = {};
    for (const row of rows) {
      if (await hasClone(row.name)) {
        copies[row.name] = (await cloneSize(row.name)) ?? '';
      }
    }
    return copies;
  }

  private async receive(message: RepositoriesMessage): Promise<void> {
    switch (message.type) {
      case 'start':
        await this.start(message.name ?? '');
        return;
      case 'fetch':
        // A clone needs the source recorded, not a project: copying the code is not citing it.
        await this.record(message.name ?? '');
        await vscode.commands.executeCommand('temcoRepositories.fetchSource', slugOf(message.name ?? ''));
        this.refresh();
        await this.send();
        return;
      case 'pull':
        await vscode.commands.executeCommand('temcoRepositories.pullSource', slugOf(message.name ?? ''));
        this.refresh();
        await this.send();
        return;
      case 'open':
        if (message.url !== undefined) {
          await vscode.env.openExternal(vscode.Uri.parse(message.url));
        }
        return;
      case 'project':
      case 'detail': {
        // A row's own page: what it is, whether there is a local copy, and what files are inside it. The project is
        // created from *there*, with the files a person picked, so this does not jump straight into a form.
        await vscode.commands.executeCommand('temcoRepositories.repository', message.name, this.showing);
        return;
      }
      case 'openClone':
        await vscode.commands.executeCommand('temcoRepositories.openClone', slugOf(message.name ?? ''));
        return;
      case 'removeClone':
        await vscode.commands.executeCommand('temcoRepositories.removeClone', slugOf(message.name ?? ''));
        this.refresh();
        await this.send();
        return;
      case 'bulk':
        await this.bulk(message.action, message.names ?? []);
        return;
      case 'cite':
        // Handed to the form rather than written here: what a project cites is the form's decision, and it may still
        // be open with answers in it that a re-render would lose. Opened from a project's own page there is nothing to
        // hand back to — the project is in the catalog — so citing is the write below.
        if (this.citeTarget === undefined) {
          await vscode.commands.executeCommand('temcoProjects.citeInNewProject', message.names ?? []);
          return;
        }
        await this.citeAll(message.names ?? []);
        return;
      case 'read':
        // Choosing another organisation in the strip: its held list is drawn at once, then asked for again.
        await this.send(message.slug);
        return;
      case 'changeFolder':
        await vscode.commands.executeCommand('temcoRepositories.pickWorkspaceFolder');
        await this.send();
        return;
      case 'add':
        await this.addOrganisation(message.text ?? '');
        return;
      case 'forget':
        await this.forgetOrganisation(message.slug ?? '');
        return;
      case 'reload':
        await this.send();
        return;
      case 'command':
        if (typeof message.command === 'string') {
          await vscode.commands.executeCommand(message.command);
          await this.send();
        }
        return;
      default:
        return;
    }
  }

  /**
   * Adds an enterprise, an account, or one repository — whichever the typed text turns out to be.
   *
   * A single repository is written as its own organisation of kind `repository`, with the one row its address
   * already answers: there is no list to ask for, so it works offline and costs no allowance.
   */
  private async addOrganisation(text: string): Promise<void> {
    const typed = typedName(text);
    if (typed === undefined) {
      await this.panel?.webview.postMessage({
        type: 'refused',
        error: 'Type an enterprise or account name such as temcocontrols, or one repository address such as github.com/temcocontrols/t3000webview.',
      });
      return;
    }
    const slug = slugOf(typed.name);
    let catalog: Catalog | undefined;
    try {
      catalog = await Catalog.open(this.context);
      catalog.addOrganisation({ kind: typed.kind, name: typed.name, slug, url: typed.url });
      if (typed.kind === 'repository') {
        const [owner, repository] = typed.name.split('/');
        catalog.replaceRepositories(slug, [
          {
            name: repository,
            fullName: typed.name,
            isPrivate: false,
            webUrl: `https://github.com/${owner}/${repository}`,
            cloneUrl: `https://github.com/${owner}/${repository}.git`,
          },
        ]);
        catalog.recordOrganisationRead(slug, 'named');
      }
    } catch (error) {
      await this.panel?.webview.postMessage({
        type: 'refused',
        error: error instanceof Error ? error.message : String(error),
      });
      return;
    } finally {
      catalog?.close();
    }
    this.refresh();
    await this.send(slug);
  }

  /** Forgets an organisation and its held list. A source it named is untouched: that is a project's business. */
  private async forgetOrganisation(slug: string): Promise<void> {
    if (slug.length === 0) {
      return;
    }
    let catalog: Catalog | undefined;
    try {
      catalog = await Catalog.open(this.context);
      catalog.removeOrganisation(slug);
    } catch {
      // Nothing to forget.
    } finally {
      catalog?.close();
    }
    if (this.showing === slug) {
      this.showing = undefined;
    }
    this.refresh();
    await this.send();
  }

  /**
   * The acts a row offers, applied to a selection. Sequential on purpose: a clone and a read both talk to the
   * same disk and the same API, and the person asked for one list of work rather than a race between them.
   */
  private async bulk(action: RepositoriesMessage['action'], names: string[]): Promise<void> {
    if (action === undefined || names.length === 0) {
      return;
    }
    // Starting needs a project; the single-row act already says so, so it is said once rather than per name.
    if (action === 'start' && this.selection.project() === undefined) {
      await this.start(names[0]);
      return;
    }
    const label = action === 'fetch' ? 'Cloning' : action === 'start' ? 'Starting' : action === 'pull' ? 'Pulling' : 'Removing';
    // One notification for the queue, with a Stop: a clone per row is slow, and ten modal prompts in a row is not a
    // way to run a command.
    await vscode.window.withProgress(
      {
        location: vscode.ProgressLocation.Notification,
        title: `Temco Repositories: ${label} ${names.length} ${names.length === 1 ? 'repository' : 'repositories'}`,
        cancellable: true,
      },
      async (progress, cancellation) => {
        for (let index = 0; index < names.length; index++) {
          if (cancellation.isCancellationRequested) {
            return;
          }
          const name = names[index];
          progress.report({ message: `${name} (${index + 1} of ${names.length})`, increment: 100 / names.length });
          switch (action) {
            case 'start':
              await this.start(name);
              break;
            case 'fetch':
              // A clone is a copy of the code: record the source, then copy it. No citation, no project.
              await this.record(name);
              await vscode.commands.executeCommand('temcoRepositories.fetchSource', slugOf(name));
              break;
            case 'pull':
              await vscode.commands.executeCommand('temcoRepositories.pullSource', slugOf(name));
              break;
            case 'removeClone':
              await vscode.commands.executeCommand('temcoRepositories.removeClone', slugOf(name));
              break;
            case 'project':
              // Absent from the selection bar on purpose: a project is one repository's own beginning.
              break;
          }
        }
      }
    );
    this.refresh();
    await this.send();
  }

  /**
   * Records a repository as a source — and nothing else.
   *
   * Cloning needs the source in the catalog; it does not need a project and must not cite, because citing is what puts
   * a repository into a project's list, and a clone is only a copy of code.
   */
  private async record(name: string): Promise<void> {
    const row = this.listed.find((candidate) => candidate.name === name);
    if (row === undefined) {
      return;
    }
    let catalog: Catalog | undefined;
    try {
      catalog = await Catalog.open(this.context);
      catalog.addSource({
        kind: 'git',
        name: row.name,
        slug: slugOf(row.name),
        remoteUrl: row.cloneUrl,
        defaultBranch: row.defaultBranch,
      });
    } catch {
      // The commands that follow report their own refusals; this only records the coordinates.
    } finally {
      catalog?.close();
    }
    this.refresh();
  }

  /** Records a repository as a source of the project being worked on, without reading it. */
  private async cite(name: string): Promise<void> {
    const row = this.listed.find((candidate) => candidate.name === name);
    const project = this.citeTarget ?? this.selection.project();
    if (row === undefined || project === undefined) {
      return;
    }
    let catalog: Catalog | undefined;
    try {
      catalog = await Catalog.open(this.context);
      const slug = slugOf(row.name);
      catalog.addSource({
        kind: 'git',
        name: row.name,
        slug,
        remoteUrl: row.cloneUrl,
        defaultBranch: row.defaultBranch,
      });
      const cited = catalog.documentSourceSlugs(project);
      catalog.setDocumentSources(project, [...new Set([...cited, slug])]);
    } catch {
      // The commands that follow report their own refusals; this only records the coordinates.
    } finally {
      catalog?.close();
    }
    // A citation is a write, and the panel that lists sources draws from what is recorded.
    this.refresh();
  }

  /**
   * Every ticked repository, cited in the project this page was opened for — then back to that project.
   *
   * `cite` records the coordinates one at a time — the same act a row's own button performs — so the bulk form is a
   * loop rather than a second implementation of what citing means. The write is the whole act: the project exists in
   * the catalog, so there is nothing left to save, and every surface that reads a project's sources is told to re-read.
   */
  private async citeAll(names: readonly string[]): Promise<void> {
    const target = this.citeTarget;
    if (target === undefined) {
      return;
    }
    for (const name of names) {
      await this.cite(name);
    }
    this.refresh();
    // The Library's Projects group and the documentation views read the catalog through their own module.
    await vscode.commands.executeCommand('temcoDocs.refresh');
    // And back to the page the citing was asked for: a citation made here is visible there at once.
    await vscode.commands.executeCommand('temcoProjects.editProject', target);
  }

  /**
   * Start a repository: cite it in the project being worked on, then read it.
   *
   * The cite is what makes it part of the project; the read is what puts its pages in the Workspace view. Both
   * are the acts the hub already performs, reached from the other end — a list instead of a form.
   */
  private async start(name: string): Promise<void> {
    const row = this.listed.find((candidate) => candidate.name === name);
    if (row === undefined) {
      return;
    }
    const project = await projectFor(this.selection, this.output, `starting from ${row.name}`, row.name);
    if (project === undefined) {
      return;
    }

    let catalog: Catalog | undefined;
    try {
      catalog = await Catalog.open(this.context);
      const slug = slugOf(row.name);
      catalog.addSource({
        kind: 'git',
        name: row.name,
        slug,
        remoteUrl: row.cloneUrl,
        defaultBranch: row.defaultBranch,
      });
      // The whole list, not the addition: this only ever adds, but the act is "this project cites these".
      const cited = catalog.documentSourceSlugs(project);
      catalog.setDocumentSources(project, [...new Set([...cited, slug])]);
    } catch (error) {
      void vscode.window.showErrorMessage(
        `Temco Repositories: ${error instanceof Error ? error.message : String(error)}`
      );
      return;
    } finally {
      catalog?.close();
    }

    this.refresh();
    await this.send();
    // The read reports itself in the output channel, so nothing is said here about what it found.
    await vscode.commands.executeCommand('temcoRepositories.readSource', slugOf(row.name));
  }
}

/** One glyph from the page sprite: the same markup every page uses, at the size an icon control asks for. */
function sprite(name: string): string {
  return `<svg viewBox="0 0 24 24" class="icon" aria-hidden="true"><use href="#i-${name}"></use></svg>`;
}

function html(citing = false): string {
  const style = `
    /* A dashboard, not a document: the strip of enterprises comes first, the list is the body, the help is the
       foot. No boxes anywhere — a fill, a hairline and spacing carry the hierarchy. */
    /* The description carries what used to be a second bar above the list: where copies land, and the one link that
       changes it. The path is mono because it is a path; the link is the kit's link, not a button beside it. */
    .az-intro code { color: var(--fg-strong); font-family: ui-monospace, monospace; font-size: inherit;
                     overflow-wrap: anywhere; }
    /* The summary under the strip is the kit's note, one step up in spacing because it introduces the list. */
    .az-note#stats { margin: .9em 0 0; }

    .strip { display: flex; gap: .4em; flex-wrap: wrap; align-items: center; margin: 1em 0 0; }

    /* An enterprise is a chip: its name, how many it holds, and a way to forget it. The selected one is filled
       with the accent tint rather than outlined, so the strip reads as one control and not as a table. */
    .org { display: inline-flex; align-items: baseline; gap: .45em; padding: .38em .7em;
           border: 0; border-radius: var(--radius); background: var(--bg-inset); color: var(--fg);
           font: inherit; font-size: var(--fs-sm); cursor: pointer; }
    .org:hover { background: color-mix(in srgb, var(--accent) 10%, var(--bg-inset)); }
    .org.is-on { background: color-mix(in srgb, var(--accent) 18%, var(--bg-inset)); color: var(--fg-strong); font-weight: 600; }
    .org__n { color: var(--fg-muted); font-size: var(--fs-xs); font-variant-numeric: tabular-nums; }
    .org__x { color: var(--fg-subtle); padding: 0 .1em; }
    .org__x:hover { color: var(--err); }

    .adder { display: flex; gap: .5em; flex-wrap: wrap; align-items: center; margin: .8em 0 0; }
    .adder[hidden] { display: none; }
    .adder .input { flex: 1 1 22em; max-width: 46em; }
    .adder__note { flex-basis: 100%; margin: 0; color: var(--fg-subtle); font-size: var(--fs-xs); }

    /* The two fields on this page are Fluent inputs: one box, one hairline, and a 2px brand underline under the cursor.
       The kit's default is a small tinted pill; a page with exactly two fields can afford the real control. */
    .adder .input,
    .toolbar .input { height: 32px; padding: 0 11px; border: 1px solid var(--border); border-bottom-color: var(--border-strong);
                      border-radius: 4px; background: var(--editor-bg); color: var(--fg); font: inherit;
                      font-size: var(--fs-sm); outline: none;
                      transition: border-color 90ms ease-out, box-shadow 90ms ease-out; }
    .adder .input::placeholder,
    .toolbar .input::placeholder { color: var(--fg-subtle); }
    .adder .input:hover,
    .toolbar .input:hover { border-color: var(--border-strong); }
    .adder .input:focus,
    .toolbar .input:focus { border-color: var(--border-strong); border-bottom-color: var(--accent);
                            box-shadow: inset 0 -1px 0 var(--accent); }

    .toolbar { display: flex; gap: .6em; align-items: center; flex-wrap: wrap; margin: 1em 0 .2em; }
    .toolbar input { flex: 1 1 18em; min-width: 10em; max-width: 34em; }

    /* The page's operations, pushed to the far end of the filter's own row: a quiet glyph each, in the muted colour,
       so the filter still reads as the one thing to type in. */
    .ops { display: flex; gap: .1em; align-items: center; margin-left: auto; }
    .ops__btn { display: inline-flex; align-items: center; justify-content: center; width: 30px; height: 30px;
                border: 0; border-radius: 4px; background: none; color: var(--fg-muted); cursor: pointer;
                transition: background-color 90ms ease-out, color 90ms ease-out; }
    .ops__btn:hover { background: color-mix(in srgb, var(--accent) 10%, transparent); color: var(--fg-strong); }
    .ops__btn:focus-visible { outline: 1px solid var(--accent); outline-offset: 1px; }
    .ops__btn .icon { width: 16px; height: 16px; }

    /* A selection bar is an answer to a tick, not a permanent second toolbar. */
    .selection { display: flex; gap: .6em; align-items: center; flex-wrap: wrap; margin: .7em 0 0; }
    .selection .count { font-weight: 600; }
    .selection[hidden] { display: none; }

    .rows { margin: .6em 0 0; }

    /* A repository is a line in a list, not a card: the mark and the name lead, the facts follow, and the acts sit on a
       line of their own under them. The only fill is the hover and the selection — a list of twenty-two boxes is a list
       nobody scans. */
    .repo { display: grid; grid-template-columns: auto auto minmax(0, 1fr); gap: .1em .7em; align-items: start;
            padding: .7em .6em .8em; border-bottom: 1px solid var(--border);
            transition: background-color 90ms ease-out; }
    .repo:last-child { border-bottom: 0; }
    /* A tint of the link colour rather than the theme's flat grey: it reads as "this row, here", and it is the same
       family as the selected fill one step stronger, so hovering a ticked row does not repaint it. */
    .repo:hover { background: color-mix(in srgb, var(--accent) 7%, transparent); }
    .repo.is-selected { background: color-mix(in srgb, var(--accent) 13%, transparent); }
    .repo input[type=checkbox] { grid-column: 1; grid-row: 1; margin: .45em 0 0; }
    /* The mark is a tile, not a glyph: at 28px it anchors the row, and it is the same tile a page uses for a thing it
       names. It brightens with the row instead of staying a grey speck in a long list. */
    .repo__mark { grid-column: 2; grid-row: 1; display: inline-flex; align-items: center; justify-content: center;
                  width: 28px; height: 28px;
                  background: color-mix(in srgb, var(--accent) 12%, transparent); color: var(--accent); }
    .repo__mark .icon { width: 16px; height: 16px; }
    .repo:hover .repo__mark { background: color-mix(in srgb, var(--accent) 20%, transparent); }
    .repo__main { min-width: 0; grid-column: 3; grid-row: 1; }
    .repo__head { display: flex; gap: .55em; align-items: baseline; flex-wrap: wrap; }
    .repo__name { font-weight: 600; color: var(--fg-strong); border: 0; background: none; padding: 0;
                  font-family: inherit; font-size: inherit; cursor: pointer; text-align: left; }
    .repo__name:hover { text-decoration: underline; }
    .repo__badge { font-size: var(--fs-xs); line-height: 15px; padding: 0 .4em; border-radius: var(--r-8);
                   background: var(--bg-inset); color: var(--fg-muted); white-space: nowrap; }
    .repo__badge--cited { background: color-mix(in srgb, var(--ok) 16%, transparent); color: var(--ok); }
    .repo__badge--local { background: color-mix(in srgb, var(--accent) 14%, transparent); color: var(--fg-strong); }
    .repo__desc { margin: .2em 0 0; color: var(--fg-muted); font-size: var(--fs-sm); overflow-wrap: anywhere; }
    .repo__meta { margin: .25em 0 0; color: var(--fg-subtle); font-size: var(--fs-xs); display: flex; gap: .5em;
                  flex-wrap: wrap; }
    .repo__meta span + span::before { content: '·'; margin-right: .5em; color: var(--fg-subtle); }
    /* The acts, under the row's own words: one line of links beneath the name and its facts, starting where the text
       starts. They are words, not boxes — a list of rows each ending in four buttons is a toolbar repeated twenty times. */
    .repo__do { grid-column: 2 / -1; grid-row: 2; display: flex; gap: .9em; align-items: baseline; flex-wrap: wrap;
                justify-content: flex-start; margin-top: .5em; }
    .repo__do .az-btn { white-space: nowrap; font-size: var(--fs-sm); }
    /* The one act a row exists for keeps the accent; the rest are quiet, so a scan down the column finds "Start". */
    .repo__do .az-btn--primary-link { color: var(--fg-strong); font-weight: 600; }
    .repo__do .az-btn--primary-link:hover { color: var(--az-blue-hover); }

    .warn { border-radius: var(--radius); padding: .8em 1em; margin: 1em 0;
            background: color-mix(in srgb, var(--warn) 22%, var(--bg-inset)); color: var(--fg); }
    .warn p { margin: 0; color: var(--fg); }
    .warn .do { display: flex; gap: .5em; margin: .7em 0 0; }
    .empty { color: var(--fg-muted); padding: 1em 0; }

    /* How the page works, numbered: six acts, in the order a person performs them. The heading is the kit's section;
       only the list itself is this page's. */
    .how__list { margin: .8em 0 0; padding-left: 1.3em; display: flex; flex-direction: column; gap: .5em;
                 color: var(--fg-muted); font-size: var(--fs-sm); line-height: 1.55; }
    .how__list li::marker { color: var(--accent); font-weight: 600; }
    .how__list b { color: var(--fg-strong); font-weight: 600; }
  `;

  const body = `
  <div class="az-wash"><header class="az-lead">
    <h1 class="az-title" id="title">Repositories</h1>
    <p class="az-intro az-intro--wide" id="lede">Reading the organisation from GitHub…</p>
    ${citing ? `<div class="az-row">
      <button type="button" class="az-btn az-btn--link" id="back-to-form">Back to the New Project form</button>
    </div>` : ''}
  </header></div>

  <form class="adder" hidden id="adder">
    <input class="input" id="adder-text" aria-label="Enterprise or repository"
      placeholder="temcocontrols — or one repository: github.com/temcocontrols/t3000webview">
    <button type="submit" class="az-btn az-btn--primary" id="adder-add">Add</button>
    <button type="button" class="az-btn" id="adder-cancel">Cancel</button>
    <p class="adder__note">An enterprise or an account is listed with everything it publishes. A repository address is
      listed on its own — no list to read, so it works without GitHub answering.</p>
  </form>

  <div class="strip" id="strip"></div>
  <p class="az-note" id="stats"></p>
  <div id="error"></div>

  <div class="toolbar" hidden id="bar">
    <input class="input" type="search" id="filter" placeholder="Filter by name, description or language" aria-label="Filter">
    <span id="count" class="cell-muted"></span>
    <!-- The page's own operations, at the far end of the row that acts on this list: an icon each, named for a reader
         who cannot see it, and explained on hover. -->
    <div class="ops" role="group" aria-label="Operations">
      <button type="button" class="ops__btn" id="reload" title="Read GitHub again" aria-label="Read GitHub again">${sprite('refresh')}</button>
      <button type="button" class="ops__btn" id="add-toggle" title="Add an enterprise" aria-label="Add an enterprise">${sprite('plus')}</button>
      <button type="button" class="ops__btn" id="dashboard" title="Dashboard" aria-label="Dashboard">${sprite('dashboard')}</button>
      <button type="button" class="ops__btn" id="new-project" title="New project" aria-label="New project">${sprite('layers')}</button>
    </div>
  </div>

  <div class="selection" hidden id="selection">
    <span class="count" id="selection-count">0 selected</span>
    <button type="button" class="az-btn az-btn--sm az-btn--primary" id="bulk-start">Start</button>
    <button type="button" class="az-btn az-btn--sm" id="bulk-cite">${citing ? 'Cite in this project' : 'Cite in the new project'}</button>
    <button type="button" class="az-btn az-btn--sm" id="bulk-fetch">Clone</button>
    <button type="button" class="az-btn az-btn--sm" id="bulk-pull">Pull</button>
    <button type="button" class="az-btn az-btn--sm" id="bulk-remove">Remove the clone</button>
    <button type="button" class="az-btn az-btn--sm" id="bulk-clear">Clear</button>
  </div>

  <div class="rows" id="list"></div>

  <section class="az-section">
    <div class="az-section__text"><h2 class="az-section__title">How this page works</h2>
      <p class="az-section__desc">Six steps, in the order a project is built from a repository.</p></div>
  </section>
  <ol class="how__list">
      <li><b>Add an enterprise</b> — <code>temcocontrols</code> is already here — or one repository's address. What an
        enterprise holds is kept in the platform database, so this page still lists it when GitHub will not answer.</li>
      <li><b>Start</b> adds the repository as a source of the project being worked on, then reads what documentation
        it publishes through the API. A repository that publishes none still becomes a source: it has no pages yet, and
        its files are still there to draft from. Nothing is cloned and nothing is written to the repository.</li>
      <li><b>Project</b> opens a new project <em>from</em> this repository: it is cited as the source, its own
        documentation and classes are listed to pick from, and the AI can draft the first page from what you picked.</li>
      <li><b>Clone</b> copies one branch, with full history, into the shared <code>source</code> folder under the
        working area named above — one copy per repository, outside every repository and not owned by any project —
        and then reads what the repository declares, so its pages appear at once. That copy is what lets a draft, the
        AI and its citations read the files and the history behind them.</li>
      <li><b>Pull</b> freshens that copy when the repository has moved on. <b>Remove the clone</b> deletes the
        copy only — the repository is never written to and never pushed to.</li>
      <li>A private repository needs a token: <b>Set a GitHub Token</b>, from the warning above or the palette.</li>
    </ol>
    <p class="az-note">Default enterprise <code>temcoRepositories.organisation</code> · working area
      <code>temcoRepositories.workspaceFolder</code></p>
  `;

  return page(body, { title: 'Temco Repositories', extraCss: style, script: CLIENT });
}

const CLIENT = `
const vscode = window.__temcoApi || (window.__temcoApi = acquireVsCodeApi());
const $ = (id) => document.getElementById(id);
let organisations = [];
let current;
let repositories = [];
let cited = [];
let copies = {};
let takenAt;
let state;
let project;
const selected = new Set();

$('reload').addEventListener('click', () => vscode.postMessage({ type: 'reload' }));
$('new-project').addEventListener('click', () => vscode.postMessage({ type: 'command', command: 'temcoProjects.newProject' }));
$('dashboard').addEventListener('click', () => vscode.postMessage({ type: 'command', command: 'temcoRepositories.dashboard' }));
// The way back exists only when the page was opened *from* the project form: a browse has nowhere to go back to.
if ($('back-to-form')) {
  $('back-to-form').addEventListener('click', () => vscode.postMessage({ type: 'command', command: 'temcoProjects.returnToNewProject' }));
}
$('bulk-cite').addEventListener('click', () => {
  if (selected.size === 0) { return; }
  vscode.postMessage({ type: 'cite', names: Array.from(selected) });
  selected.clear();
  draw();
});
$('filter').addEventListener('input', () => draw());
$('add-toggle').addEventListener('click', () => {
  $('adder').hidden = !$('adder').hidden;
  if (!$('adder').hidden) { $('adder-text').focus(); }
});
$('adder-cancel').addEventListener('click', () => {
  $('adder').hidden = true;
  $('adder-text').value = '';
  refusal('');
});
$('adder').addEventListener('submit', (event) => {
  event.preventDefault();
  const typed = $('adder-text').value.trim();
  if (typed.length === 0) { refusal('Type an enterprise name, or one repository address.'); return; }
  refusal('');
  vscode.postMessage({ type: 'add', text: typed });
  $('adder-text').value = '';
  $('adder').hidden = true;
});
$('bulk-clear').addEventListener('click', () => { selected.clear(); draw(); });
for (const pair of [['bulk-start', 'start'], ['bulk-fetch', 'fetch'], ['bulk-pull', 'pull'], ['bulk-remove', 'removeClone']]) {
  $(pair[0]).addEventListener('click', () => {
    if (selected.size === 0) { return; }
    vscode.postMessage({ type: 'bulk', action: pair[1], names: Array.from(selected) });
    selected.clear();
    draw();
  });
}

window.addEventListener('message', (event) => {
  const message = event.data;
  if (message.type === 'refused') { refusal(message.error); return; }
  if (message.type !== 'seed') { return; }

  if (message.error) {
    $('lede').textContent = 'The platform database could not be read.';
    $('error').replaceChildren(banner(message.error));
    $('bar').hidden = true;
    $('selection').hidden = true;
    $('strip').replaceChildren();
    $('stats').replaceChildren();
    $('list').replaceChildren();
    return;
  }

  const changed = message.org !== current;
  organisations = message.organisations || [];
  current = message.org;
  repositories = message.repositories || [];
  cited = message.cited || [];
  copies = message.copies || {};
  takenAt = message.takenAt;
  state = message.state;
  project = message.project;
  // Opened from a project's own page: citing writes into it, so the button says which project that is.
  $('bulk-cite').textContent = message.citeTarget
    ? 'Cite in ' + (message.citeTargetName || 'this project')
    : 'Cite in the new project';
  // A row that no longer exists cannot stay selected, and a list from another organisation starts clean.
  if (changed) { selected.clear(); }
  for (const name of Array.from(selected)) {
    if (!repositories.some((repo) => repo.name === name)) { selected.delete(name); }
  }
  // Opened from a project's own page: what that project already cites is what is already ticked, so the page opens on
  // the answer it was asked about instead of an empty selection.
  if (message.citeTarget) {
    selected.clear();
    for (const name of cited) {
      if (repositories.some((repo) => repo.name === name)) { selected.add(name); }
    }
  }

  $('error').replaceChildren(...(message.warning ? [banner(message.warning)] : []));
  $('bar').hidden = false;
  drawStrip();
  drawStats();
  renderLede(message);
  draw();
});

/**
 * The description, in one line: where the list came from, whose project it feeds, where copies land, and the one link
 * that changes any of it.
 *
 * The folder used to sit in its own filled bar above the list with two buttons beside it. It is one fact about this
 * list, so it belongs in the sentence that describes this list — and changing it is a settings act, not a page act.
 */
function renderLede(message) {
  const line = $('lede');
  line.replaceChildren(text('span', '', lede(message)));
  line.append(document.createTextNode(' · clones and drafts in '));
  const path = text('code', '', message.where || 'not chosen yet');
  path.id = 'where-path';
  line.append(path);
  line.append(document.createTextNode(' · '));
  const settings = button('link', 'Settings', () => vscode.postMessage({ type: 'command', command: 'temcoRepositories.settings' }));
  settings.title = 'The default enterprise, where clones are made, and the GitHub token';
  line.append(settings);
}

/** One line that says where this list came from, and whether its answer is fresh. */
function lede(message) {
  const org = organisations.find((row) => row.slug === current);
  if (org === undefined) { return 'No organisation is recorded yet.'; }
  const head = org.kind === 'repository'
    ? 'One repository, named by its address'
    : 'Repositories of ' + org.name + ' — most recently pushed first';
  const when = message.takenAt ? ' · read ' + readAt(message.takenAt) : '';
  const truncated = message.truncated ? ' · the first 100' : '';
  const project = message.project ? ' · starting one adds it to ' + message.project : ' · no project is being worked on yet';
  return head + when + truncated + project;
}

/** The enterprises as chips: one is shown, the rest are one click away, and each can be forgotten. */
function drawStrip() {
  const nodes = organisations.map((org) => {
    const chip = document.createElement('button');
    chip.type = 'button';
    chip.className = 'org' + (org.slug === current ? ' is-on' : '');
    chip.title = org.kind === 'repository'
      ? 'One repository, added by its address'
      : (org.kind === 'account' ? 'A personal account on GitHub' : 'An enterprise or organisation on GitHub');
    chip.append(text('span', '', org.name), text('span', 'org__n', String(org.repositories)));
    chip.addEventListener('click', () => {
      if (org.slug !== current) { vscode.postMessage({ type: 'read', slug: org.slug }); }
    });
    // Forgetting is offered only when there is something else to show: the page is never left with no list.
    if (organisations.length > 1) {
      const forget = text('span', 'org__x', '×');
      forget.title = 'Forget this organisation — the sources it named are untouched';
      forget.addEventListener('click', (event) => {
        event.stopPropagation();
        vscode.postMessage({ type: 'forget', slug: org.slug });
      });
      chip.append(forget);
    }
    return chip;
  });
  $('strip').replaceChildren(...nodes);
}

/** What is here, as one sentence: a strip of chips says where the list came from, this says what is in it. */
function drawStats() {
  const started = repositories.filter((repo) => cited.includes(repo.name)).length;
  const clones = Object.keys(copies).length;
  const parts = [
    repositories.length + (repositories.length === 1 ? ' repository' : ' repositories'),
    started === 0 ? 'none cited by this project' : started + ' cited by this project',
    clones === 0 ? 'nothing cloned yet' : clones + (clones === 1 ? ' clone' : ' clones')
  ];
  if (state === 'refused') {
    parts.push('held from ' + (takenAt ? readAt(takenAt) : 'an earlier read'));
  } else if (state === 'named') {
    parts.push('named by its address');
  }
  const line = $('stats');
  line.textContent = parts.join(' · ');
  // Which project a Start would add to, and the one link that changes it: the decision is the platform's, not a
  // hidden state of this page.
  if (!project) {
    line.append(
      document.createTextNode(' · Start has nowhere to add a source — '),
      button('link', 'choose a project', () => vscode.postMessage({ type: 'command', command: 'temcoDocs.projects' }))
    );
  }
}

function draw() {
  const needle = $('filter').value.trim().toLowerCase();
  const shown = repositories.filter((repo) =>
    needle.length === 0 ||
    (repo.name + ' ' + (repo.description || '') + ' ' + (repo.language || '')).toLowerCase().includes(needle));

  $('selection').hidden = selected.size === 0;
  $('selection-count').textContent = selected.size + (selected.size === 1 ? ' repository selected' : ' repositories selected');
  $('count').textContent = shown.length === repositories.length ? '' : shown.length + ' of ' + repositories.length;

  if (shown.length === 0) {
    const empty = document.createElement('div');
    empty.className = 'empty';
    empty.textContent = repositories.length === 0
      ? (state === 'refused'
        ? 'Nothing is held for this organisation yet, and GitHub would not answer. Try again when the allowance resets.'
        : 'This organisation has no repositories this token can see.')
      : 'No repository matches that filter.';
    $('list').replaceChildren(empty);
    return;
  }
  $('list').replaceChildren(...shown.map((repo) => row(repo)));
}

function row(repo) {
  const isCited = cited.includes(repo.name);
  const cloned = Object.prototype.hasOwnProperty.call(copies, repo.name);

  const line = document.createElement('div');
  line.className = 'repo' + (selected.has(repo.name) ? ' is-selected' : '');

  const tick = document.createElement('input');
  tick.type = 'checkbox';
  tick.checked = selected.has(repo.name);
  tick.setAttribute('aria-label', 'Select ' + repo.name);
  tick.addEventListener('change', () => {
    if (tick.checked) { selected.add(repo.name); } else { selected.delete(repo.name); }
    draw();
  });

  const mark = document.createElement('span');
  mark.className = 'repo__mark';
  mark.innerHTML = '<svg viewBox="0 0 24 24" class="icon icon--sm" aria-hidden="true"><use href="#i-repo"></use></svg>';

  // The name is the way into the row's own page: the one place its files and its local copy are described.
  const head = document.createElement('div');
  head.className = 'repo__head';
  const name = button('repo__name', repo.name, () => vscode.postMessage({ type: 'detail', name: repo.name }));
  name.title = 'Open this repository — its files, its clone, and creating a project from it';
  head.append(name);
  if (isCited) { head.append(text('span', 'repo__badge repo__badge--cited', 'cited')); }
  if (cloned) { head.append(text('span', 'repo__badge repo__badge--local', 'clone')); }

  const main = document.createElement('div');
  main.className = 'repo__main';
  main.append(head, text('p', 'repo__desc', repo.description || 'No description.'));

  const facts = [
    repo.language || '',
    repo.pushedAt ? 'pushed ' + shortDate(repo.pushedAt) : '',
    repo.pushedAt ? '' : 'not read yet',
    repo.isPrivate ? 'private' : ''
  ].filter(Boolean);
  if (facts.length > 0) {
    const meta = document.createElement('div');
    meta.className = 'repo__meta';
    facts.forEach((fact) => meta.append(text('span', '', fact)));
    main.append(meta);
  }

  const do_ = document.createElement('div');
  do_.className = 'repo__do';
  // The acts are links: a row is a thing to read, and four buttons under every row would be a toolbar repeated down the
  // page. "Start" keeps the weight — it is what a row is for.
  const start = button('az-btn az-btn--link az-btn--primary-link', isCited ? 'Start again' : 'Start', () =>
    vscode.postMessage({ type: 'start', name: repo.name }));
  start.title = 'Add this repository as a source of the project being worked on, and read what it publishes';

  const project = button('az-btn az-btn--link', 'New project', () =>
    vscode.postMessage({ type: 'project', name: repo.name }));
  project.title = 'Pick this repository’s files, then create a project from them';

  const open = button('az-btn az-btn--link', 'Open', () => {
    if (repo.webUrl) { vscode.postMessage({ type: 'open', url: repo.webUrl }); }
  });
  open.title = 'Open the repository on GitHub';

  const local = button('az-btn az-btn--link', cloned ? 'Pull' : 'Clone', () =>
    vscode.postMessage({ type: cloned ? 'pull' : 'fetch', name: repo.name }));
  local.title = cloned ? 'Pull the latest changes into the clone' : 'Clone a copy into the shared source folder';

  do_.append(start, project, open, local);
  if (cloned) {
    const drop = button('az-btn az-btn--link', 'Remove copy', () =>
      vscode.postMessage({ type: 'removeClone', name: repo.name }));
    drop.title = 'Remove the clone — the repository is left untouched';
    do_.append(drop);
  }

  line.append(tick, mark, main, do_);
  return line;
}

/** The refusal, in a box that can be answered where it is read. */
function banner(message) {
  const box = document.createElement('div');
  box.className = 'warn';
  box.append(text('p', '', message));
  const do_ = document.createElement('div');
  do_.className = 'do';
  do_.append(
    button('az-btn az-btn--sm', 'Set a GitHub token', () =>
      vscode.postMessage({ type: 'command', command: 'temcoRepositories.setToken' })),
    button('az-btn az-btn--sm', 'Read GitHub again', () => vscode.postMessage({ type: 'reload' })));
  box.append(do_);
  return box;
}

/** A refusal about the adder, said under the strip rather than somewhere else on the page. */
function refusal(message) {
  if (!message) { $('error').replaceChildren(); return; }
  $('error').replaceChildren(banner(message));
}

function text(tag, className, content) {
  const node = document.createElement(tag);
  if (className) { node.className = className; }
  node.textContent = content;
  return node;
}

function button(className, label, onClick) {
  const node = text('button', className, label);
  node.type = 'button';
  node.addEventListener('click', onClick);
  return node;
}

function pair(value, label) {
  const node = document.createElement('span');
  node.append(text('b', '', value), document.createTextNode(' ' + label));
  return node;
}

/** Dots between the numbers, so the line reads as one sentence rather than a row of stray words. */
function join(parts) {
  const nodes = [];
  parts.forEach(function (part, index) {
    if (index > 0) { nodes.push(text('span', '', '·')); }
    nodes.push(part);
  });
  return nodes;
}

/** When a list was read, in words that survive a missing or unreadable stamp. */
function readAt(stamp) {
  const date = new Date(stamp);
  return isNaN(date.getTime()) ? 'at an earlier time' : 'at ' + date.toLocaleString();
}

/** A pushed date as a day, without the time of day: the list is sorted by it, and nobody reads the minutes. */
function shortDate(stamp) {
  const date = new Date(stamp);
  return isNaN(date.getTime()) ? stamp : date.toLocaleDateString();
}
`;
