// The project page: one project, opened from the Library's edit action.
//
// It answers the same questions the flow that creates a project asks — what it is called, where its pages come from,
// what it builds — and states the answers it cannot change, so the page reads as a description of the project rather
// than as a form that happens to be filled in. Creating a project is `projectFlow.ts`; this page only ever edits.
//
// The page owns the draft and the extension does the writing: the page posts what the form holds, the extension
// puts it in the catalog. The only native dialog left is the folder/file picker, because an OS dialog is better
// than any text box we would build for it.
//
// "Project" is the word a person reads everywhere. The catalog's table is still called `documents` — renaming it
// means a schema migration, and a project is what that row is.

import * as vscode from 'vscode';
import { discardWorkFolder, folderConsequence, workFolderOf } from './removal';
import { Catalog, CatalogUnavailable, DocumentDetail, Selection, slugOf } from './store';
import { PROJECT_VIEW_TYPE } from './surface';
import { ORIGINS, TARGETS } from './projectFlow';
import { escapeHtml as esc, focusLibrary, icon, page, pageColumn, section } from './ui';

/** A source as the page lists it: what it is called, and where it actually is. */
interface KnownSource {
  slug: string;
  name: string;
  kind: string;
  branch?: string;
  pages?: number;
  where?: string;
}

interface PageMessage {
  type: 'ready' | 'cite' | 'submit' | 'cancel' | 'remove' | 'draftWrite' | 'draftCopy' | 'draftDiscard';
  values?: { name: string; version: string };
  /** The slugs of the catalog's sources this project cites. */
  cited?: string[];
  outputs?: string[];
  /** Which drafted page an act is about. */
  id?: number;
}

export class ProjectPage {
  private panel: vscode.WebviewPanel | undefined;
  private slug = '';

  constructor(
    private readonly context: vscode.ExtensionContext,
    private readonly selection: Selection,
    /** Called after a write. The slug is passed when the project itself was removed. */
    private readonly refresh: (removed?: string) => void
  ) { }

  /** An existing project, filled in. Creating one is `flow/new-project` (`projectFlow.ts`). */
  openEdit(slug: string): void {
    this.slug = slug;
    this.show('Project');
  }

  private show(title: string): void {
    if (this.panel) {
      this.panel.title = title;
      this.panel.reveal(pageColumn());
      void this.seed();
      return;
    }

    this.panel = vscode.window.createWebviewPanel(
      PROJECT_VIEW_TYPE,
      title,
      pageColumn(),
      { enableScripts: true, localResourceRoots: [] }
    );
    this.panel.webview.html = this.html();
    this.panel.webview.onDidReceiveMessage((message: PageMessage) => void this.receive(message));
    // Shown again after the repositories page has had the focus: read the citations again, so a source cited there
    // appears here without a reload — and without the form being rebuilt under the person.
    this.panel.onDidChangeViewState((state) => {
      if (state.webviewPanel.visible) {
        void this.seedCitations();
      }
    });
    this.panel.onDidDispose(() => {
      this.panel = undefined;
    });
  }

  private async receive(message: PageMessage): Promise<void> {
    switch (message.type) {
      case 'ready':
        break;
      case 'cite':
        await this.cite();
        return;
      case 'cancel':
        this.panel?.dispose();
        return;
      case 'remove':
        await this.remove();
        return;
      case 'submit':
        await this.submit(message);
        return;
      case 'draftWrite':
        await this.writeDraft(message.id);
        return;
      case 'draftCopy':
        await this.copyDraft(message.id);
        return;
      case 'draftDiscard':
        await this.discardDraft(message.id);
        return;
    }

    if (message.type === 'ready') {
      await this.seed();
      return;
    }
  }

  /**
   * Citing happens where the repositories are.
   *
   * This page has no adder of its own — choosing a repository means the list, the download and the files, which is the
   * repositories page — so the act is: make this project the one being worked on, then open that page *for* it. What is
   * cited there is written to the catalog, and this page reads its citations again when it is shown.
   */
  private async cite(): Promise<void> {
    await this.selection.select(this.slug);
    await vscode.commands.executeCommand('temcoRepositories.page', this.slug);
  }

  /** Hands the page what to fill in — the project, its citations, and the drafts it still holds. */
  private async seed(): Promise<void> {
    if (!this.panel) {
      return;
    }
    let document: DocumentDetail | undefined;
    let known: KnownSource[] = [];
    let cited: string[] = [];
    let drafts: { id: number; title: string; pageId: string; characters: number; createdAt: string }[] = [];

    await this.withCatalog((catalog) => {
      document = catalog.document(this.slug);
      ({ known, cited } = this.sourcesFrom(catalog));
      // What was drafted for this project and never written: a page kept in the catalog, not a file.
      drafts = catalog.drafts(this.slug).map((row) => ({
        id: row.id,
        title: row.title,
        pageId: row.pageId,
        characters: row.body.length,
        createdAt: row.createdAt,
      }));
    });

    // The tab carries the project's name, so a row of tabs reads as the projects that are open.
    if (document !== undefined && document.name.length > 0) {
      this.panel.title = document.name;
    }
    const origin = ORIGINS.find((entry) => entry.value === document?.origin);
    await this.panel.webview.postMessage({
      type: 'seed',
      mode: 'edit',
      document: document ?? { name: '', version: '1.0', outputs: [], sources: [] },
      originLabel: origin?.label ?? 'Project',
      originNote: origin?.sub ?? '',
      known,
      cited,
      drafts,
    });
  }

  /** The citations again, after the repositories page has written one: the form's answers are left alone. */
  private async seedCitations(): Promise<void> {
    if (!this.panel) {
      return;
    }
    let known: KnownSource[] = [];
    let cited: string[] = [];
    await this.withCatalog((catalog) => {
      ({ known, cited } = this.sourcesFrom(catalog));
    });
    await this.panel.webview.postMessage({ type: 'cited', known, cited });
  }

  /**
   * Every source the catalog records, and which of them this project cites.
   *
   * A source is recorded once and cited by any number of projects, so the page needs both: the citations are the rows,
   * and the recorded list is how a name becomes facts. Each entry also carries where it actually is — a repository's
   * URL, a folder's or archive's path — because the page states what a citation points at instead of making a person
   * open another page to find out.
   */
  private sourcesFrom(catalog: Catalog): { known: KnownSource[]; cited: string[] } {
    const known: KnownSource[] = [];
    for (const source of catalog.sources()) {
      const detail = catalog.source(source.slug);
      known.push({
        slug: source.slug,
        name: source.name,
        kind: source.kind,
        branch: source.branch,
        pages: source.pages,
        where: source.kind === 'git' ? detail?.remoteUrl : detail?.path,
      });
    }
    return { known, cited: catalog.documentSourceSlugs(this.slug) };
  }

  private async submit(message: PageMessage): Promise<void> {
    const values = message.values;
    if (!values || values.name.trim().length === 0) {
      void vscode.window.showWarningMessage('Temco Projects: a project needs a name.');
      return;
    }

    const slug = this.slug.length > 0 ? this.slug : slugOf(values.name);
    const cited = message.cited ?? [];
    const outputs = message.outputs ?? [];
    let citedCount = 0;

    const result = await this.withCatalog((catalog) => {
      // Owner and audience are not asked here — a field nobody has to answer only stops the page — so a save keeps the
      // values the project already had instead of clearing them.
      const current = catalog.document(slug);
      catalog.createDocument({
        name: values.name.trim(),
        slug,
        version: values.version.trim() || undefined,
        audience: current?.audience,
        owner: current?.owner,
      });

      // The whole list, not the additions: dropping a row on the page is how a project stops citing a source.
      const slugs = [...cited];
      catalog.setDocumentSources(slug, slugs);
      catalog.setRecipe(slug, 'docfx', outputs);
      citedCount = new Set(slugs).size;
    });

    if (!result) {
      return;
    }

    // A project you have just made is the one you are working on: it is what the Workspace view and the AI read.
    await this.selection.select(slug);
    this.refresh();
    this.panel?.dispose();
    void vscode.window.showInformationMessage(
      `${values.name.trim()} saved — cites ${citedCount} source${citedCount === 1 ? '' : 's'}, ${outputs.length === 0 ? 'no outputs chosen yet' : `outputs: ${outputs.join(', ')}`
      }.`
    );
  }

  private async remove(): Promise<void> {
    // The folder is named before anything goes: it is the part of this act that is not recoverable from the catalog.
    const workFolder = await workFolderOf(this.slug);
    const answer = await vscode.window.showWarningMessage(
      [
        'Remove this project from the Library? Its sources stay in the catalog — they are shared — and no origin ' +
        'is touched.',
        folderConsequence(workFolder),
      ]
        .filter((line) => line.length > 0)
        .join('\n'),
      { modal: true },
      'Remove'
    );
    if (answer !== 'Remove') {
      return;
    }
    const ok = await this.withCatalog((catalog) => catalog.deleteDocument(this.slug));
    if (!ok) {
      return;
    }
    // The row is gone, so the folder is what is left of the project — its clones and what we made from them.
    const discarded = await discardWorkFolder(this.slug, workFolder);
    // Its own page goes (this one), the projects page comes back: nothing is left pointing at a project that
    // is no longer there.
    const slug = this.slug;
    this.panel?.dispose();
    this.refresh(slug);
    await focusLibrary();
    void vscode.window.showInformationMessage(
      'Temco Projects: the project is removed' +
      (discarded && workFolder !== undefined ? `, and ${workFolder.folder} is deleted.` : '.')
    );
  }

  /** One drafted page of this project, by the id the page posted — never a body typed into a message. */
  private async draftOf(id: number | undefined): Promise<{ id: number; pageId: string; body: string } | undefined> {
    if (id === undefined) {
      return undefined;
    }
    let found: { id: number; pageId: string; body: string } | undefined;
    await this.withCatalog((catalog) => {
      const row = catalog.drafts(this.slug).find((draft) => draft.id === id);
      if (row !== undefined) {
        found = { id: row.id, pageId: row.pageId, body: row.body };
      }
    });
    return found;
  }

  /**
   * Puts a drafted page on disk, at the path the draft names inside a folder the person picks.
   *
   * The path is the draft's own `pageId` — a draft records where it is *meant* to live, so writing it is one answer,
   * not a second design decision. An existing file is refused rather than replaced: a draft must not eat a page.
   */
  private async writeDraft(id: number | undefined): Promise<void> {
    const draft = await this.draftOf(id);
    if (draft === undefined) {
      return;
    }
    const picked = await vscode.window.showOpenDialog({
      canSelectFiles: false,
      canSelectFolders: true,
      canSelectMany: false,
      openLabel: `Write ${draft.pageId}`,
      title: `Which folder should ${draft.pageId} be written into?`
    });
    const folder = picked?.[0];
    if (folder === undefined) {
      return;
    }
    const target = vscode.Uri.joinPath(folder, ...draft.pageId.split('/'));
    if (await there(target)) {
      void vscode.window.showWarningMessage(
        `Temco Projects: ${target.fsPath} already exists, so nothing was written.`
      );
      return;
    }
    await vscode.workspace.fs.createDirectory(vscode.Uri.joinPath(target, '..'));
    await vscode.workspace.fs.writeFile(target, Buffer.from(draft.body, 'utf8'));
    await this.withCatalog((catalog) => catalog.setDraftState(draft.id, 'accepted'));
    this.refresh();
    await this.seed();
    await vscode.window.showTextDocument(target);
  }

  private async copyDraft(id: number | undefined): Promise<void> {
    const draft = await this.draftOf(id);
    if (draft === undefined) {
      return;
    }
    await vscode.env.clipboard.writeText(draft.body);
    void vscode.window.showInformationMessage(`Temco Projects: ${draft.pageId} is on the clipboard.`);
  }

  /** Keeps the row but marks it discarded, so the act leaves a trace instead of silently losing text. */
  private async discardDraft(id: number | undefined): Promise<void> {
    if (id === undefined) {
      return;
    }
    await this.withCatalog((catalog) => catalog.setDraftState(id, 'discarded'));
    this.refresh();
    await this.seed();
  }

  /** Opens the catalog, runs the work, closes it — and reports a refusal in words rather than a stack trace. */
  private async withCatalog(work: (catalog: Catalog) => void): Promise<boolean> {
    let catalog: Catalog | undefined;
    try {
      catalog = await Catalog.open(this.context);
      work(catalog);
      return true;
    } catch (error) {
      const message = error instanceof CatalogUnavailable ? error.message : String(error);
      void vscode.window.showErrorMessage(`Temco Projects: ${message}`);
      return false;
    } finally {
      catalog?.close();
    }
  }

  /**
   * The page, in the kit's own vocabulary: a page head, sections with a title and one sentence, and a footer carrying
   * the one write. It had its own headings, its own bordered rows and its own idea of a field; none of that needed to
   * differ from every other page in the platform.
   */
  /**

   * The page.

   *

   * Same shape as the flow that creates a project: a page head, a rail that states what the project *is*, sections in

   * the same order with the same words, and a footer carrying the one write. Before this it had its own headings, its

   * own bordered rows, its own idea of a field, and — the part that actually hurt — its own names for the outputs: it

   * ticked `chm`, `pdf` and `site` while the flow wrote `website`, `pdf`, `help`, `search` and `ai`, so opening a

   * project made by the flow showed nothing ticked, and saving it replaced its recipe with a vocabulary nothing reads.

   */

  private html(): string {

    const style = `

      /* The rail is the narrow column on the left and the form the wide one on the right. The shared \`.split\` sizes

         its columns \`1fr 320px\`, which would put the facts in the wide column and the form in a 320px strip. */

      .split { grid-template-columns: 244px minmax(0, 1fr); align-items: start; }

      .split__side { grid-column: 1; }

      .split__main { grid-column: 2; }

      @media (max-width: 820px) {

        .split { grid-template-columns: minmax(0, 1fr); gap: 20px; }

        .split__side, .split__main { grid-column: 1; }

      }



      /* What the project is, stated once: a key in the small tier, the value at reading weight, its note under it.

         Nothing here is editable — an origin is not re-answered by an edit — so nothing here looks like a field. */

      .facts { display: flex; flex-direction: column; gap: 12px; margin-top: 10px; }

      .fact { display: flex; flex-direction: column; gap: 1px; }

      .fact__key { font-size: var(--fs-xs); letter-spacing: .04em; text-transform: uppercase; color: var(--fg-subtle); }

      .fact__value { color: var(--fg-strong); font-weight: 600; overflow-wrap: anywhere; }

      .fact__note { color: var(--fg-muted); font-size: var(--fs-sm); line-height: 1.45; }

      /* What the project is, stated once: a key in the small tier, the value at reading weight, its note under it.

         Nothing here is editable — an origin is not re-answered by an edit — so nothing here looks like a field. */

      .facts { display: flex; flex-direction: column; gap: var(--sp-3); margin-top: var(--sp-2); }

      .fact { display: flex; flex-direction: column; gap: 1px; }

      .fact__key { font-size: 11px; letter-spacing: .04em; text-transform: uppercase; color: var(--ink-3); }

      .fact__value { color: var(--ink-1); font-weight: 600; overflow-wrap: anywhere; }

      .fact__note { color: var(--ink-2); font-size: 12px; line-height: 17px; }

      .split__note { margin: var(--sp-4) 0 0; color: var(--ink-3); font-size: 11.5px; line-height: 1.55; }

      /* The vertical indicator the section titles carry across the platform, on the rail's label too, so a long form
         can be scanned by its parts. */
      .split__label { position: relative; padding-left: 10px; }

      .split__label::before {
        content: ''; position: absolute; left: 0; top: 50%; transform: translateY(-50%);
        width: 2px; height: 12px; border-radius: 1px; background: var(--az-blue, #0078d4);
      }

      /* The rows this page builds in its own script: the kit's entry row, with its acts at the end of the row. */

      .az-entry__icon .icon { width: 15px; height: 15px; }

      .az-entry__acts { display: flex; align-items: center; gap: var(--sp-1); }

      .az-entry__act { padding: 1px 6px; border: 0; border-radius: var(--r-2); background: none; font: inherit;

                       font-size: 12px; color: var(--ink-3); cursor: pointer; }

      .az-entry__act:hover { color: var(--az-blue, #0078d4); background: var(--az-blue-selected, rgba(0, 120, 212, .1)); }

      .az-entry__act--danger:hover { color: var(--vscode-errorForeground, #a4262c);

                                     background: color-mix(in srgb, var(--vscode-errorForeground, #a4262c) 12%, transparent); }

      .az-entry__act:focus-visible { outline: 1px solid var(--az-blue, #0078d4); outline-offset: 1px; }

      /* Citing is not done on this page — the list, the download and the files are the repositories page's — so the
         act is one button that goes there. */

      .cite-more { display: flex; align-items: center; gap: var(--sp-3); flex-wrap: wrap; margin: var(--sp-4) 0 0; }

      .cite-more__note { color: var(--ink-3); font-size: 12px; line-height: 17px; }

      /* The one write at the foot of the form, and the line that says what it will write. */

      .save-bar { display: flex; align-items: center; gap: var(--sp-3); margin: var(--sp-6) 0 0;

                  padding-top: var(--sp-3); border-top: 1px solid var(--hairline); }

      .save-bar__line { color: var(--ink-3); font-size: 12px; }

      .save-bar__spacer { flex: 1 1 auto; }

    `;



    const field = (label: string, control: string, hint?: string): string =>

      `<div class="az-form__field"><label class="az-form__label">${esc(label)}</label>${control}${

        hint === undefined ? '' : `<div class="az-form__hint">${esc(hint)}</div>`

      }</div>`;



    // The outputs are the flow's own list, ticked with the flow's own tiles: one vocabulary for what a project builds,

    // read by the same code that writes it.

    const tiles = TARGETS.map((target) =>

      `<label class="out-tile"><input type="checkbox" data-output="${esc(target.value)}">` +

      `<span class="out-tile__mark">${icon(target.mark)}</span>` +

      `<span class="out-tile__text"><span class="out-tile__label">${esc(target.label)}</span>` +

      `<span class="out-tile__note">${esc(target.sub)}</span></span>` +

      `<span class="out-tile__check">${icon('check', 'icon--sm')}</span></label>`

    ).join('');



    const body = `

  <div class="az-wash">

    <header class="az-lead">

      <div class="az-crumbs az-crumbs--eyebrow">Edit project</div>

      <h1 class="az-title"><span class="az-title__mark">${icon('gear')}</span><span id="heading">Project</span></h1>

      <p class="az-intro" id="summary">Reading the project…</p>

      <div class="az-row">

        <button id="remove" class="az-btn" type="button"><span>Remove…</span></button>

        <button id="cancel" class="az-btn" type="button"><span>Close</span></button>

      </div>

    </header>

  </div>



  <div class="split">

    <div class="split__side">

      <div class="split__label">This project</div>

      <div class="facts" id="facts"></div>

      <p class="split__note">Where a project began is set when it is created. What it cites, what it builds and what is

        drafted for it can all change here.</p>

    </div>



    <div class="split__main">

      ${section({ title: 'The project', desc: 'What it is called, and what it publishes as.' })}

      <div class="az-form">

        ${field('Name', '<input id="name" class="az-input" type="text" autocomplete="off" aria-label="Project name">', 'Shown in the Library, and the slug its commands use.')}

        ${field('Version', '<input id="version" class="az-input" type="text" autocomplete="off" aria-label="Version">', 'A project publishes one version at a time.')}

      </div>

      ${section({ title: 'Where the pages come from', desc: 'The repositories, folders and archives this project cites. A source is recorded once and read by any number of projects, so dropping a citation here and saving leaves the source itself alone.' })}

      <div class="mt-8">

        <p class="split__note" id="noSources">This project cites nothing yet.</p>

        <div class="az-entries" id="sources"></div>

        <div class="cite-more">

          <button id="cite-more" class="az-btn az-btn--sm" type="button">${icon('repo')}<span>Cite a source on the repositories page</span></button>

          <span class="cite-more__note">Repositories are listed, downloaded and opened there. One cited from that page lands in

            this project.</span>

        </div>

      </div>

      ${section({ title: 'What it builds', desc: 'One build produces every target ticked here — and every one of them can be turned on later in the Build Center.' })}

      <div class="out-grid mt-8" id="outputs">${tiles}</div>

      ${section({ title: 'Drafts', desc: 'Pages the AI drafted for this project and nobody has written yet. Writing one puts it at the path it names, inside a folder you pick; copying hands it to the clipboard.' })}

      <div class="mt-8">

        <p class="split__note" id="noDrafts" hidden>Nothing is drafted for this project.</p>

        <div class="az-entries" id="drafts"></div>

      </div>



      <div class="save-bar">

        <span class="save-bar__line" id="footLine"></span>

        <span class="save-bar__spacer"></span>

        <button id="submit" class="az-btn az-btn--primary" type="button"><span>Save</span></button>

      </div>

    </div>

  </div>

`;



    return page(body, { title: 'Temco Projects', extraCss: style, script: ProjectPage.client });

  }



  private static readonly client = `

  const vscode = acquireVsCodeApi();

  const $ = (id) => document.getElementById(id);



  // Everything this page shows comes from one seed: the project, everything the catalog records, the sources it cites

  // and the drafts it still holds. Nothing here reads the disk and nothing writes — Save is the only write.

  let project = null;

  let known = [];

  let cited = new Set();



  function svg(name) {

    return '<svg viewBox="0 0 24 24" class="icon" aria-hidden="true"><use href="#i-' + name + '"></use></svg>';

  }

  function markFor(kind) {

    return svg(kind === 'git' ? 'repo' : kind === 'archive' ? 'package' : 'folder');

  }

  function join(parts) {

    return parts.filter(function (part) { return part !== undefined && part !== null && part !== ''; }).join(' · ');

  }

  function plural(count, one, many) {

    return count + ' ' + (count === 1 ? one : many);

  }

  function outputs() {

    return Array.prototype.slice.call(document.querySelectorAll('input[data-output]:checked'))

      .map(function (input) { return input.value; });

  }



  /**

   * One row: a mark, a name with its facts underneath, and the acts it allows.

   *

   * No border and no card. The hover surface says "row", the two lines say which part is the name and which the

   * detail, and the acts sit in a column of their own so a row with one act and a row with three still line up.

   */

  function entry(mark, name, sub, acts) {

    const row = document.createElement('div');

    row.className = 'az-entry';

    const icon = document.createElement('span');

    icon.className = 'az-entry__icon';

    icon.innerHTML = mark;

    const text = document.createElement('span');

    text.className = 'az-entry__main';

    const title = document.createElement('span');

    title.className = 'az-entry__title';

    title.textContent = name;

    const facts = document.createElement('span');

    facts.className = 'az-entry__meta';

    facts.textContent = sub;

    text.append(title, facts);

    const tools = document.createElement('span');

    tools.className = 'az-entry__acts';

    acts.forEach(function (act) {

      const button = document.createElement('button');

      button.type = 'button';

      button.className = 'az-entry__act' + (act.danger ? ' az-entry__act--danger' : '');

      button.textContent = act.label;

      button.title = act.title || '';

      button.addEventListener('click', act.run);

      tools.append(button);

    });

    row.append(icon, text, tools);

    return row;

  }



  /** What this project cites, from the catalog's list — the citations are the list, not a filter over every source. */

  function renderSources() {

    const list = $('sources');

    list.replaceChildren();

    const rows = known.filter(function (source) { return cited.has(source.slug); });

    rows.forEach(function (source) {

      list.append(entry(

        markFor(source.kind),

        source.name,

        join([source.kind, source.branch, source.where,

          source.pages === undefined ? 'never read' : plural(source.pages, 'page', 'pages')]),

        [{

          label: 'Stop citing',

          danger: true,

          title: 'Stop citing ' + source.name,

          run: function () { cited.delete(source.slug); render(); },

        }]

      ));

    });

    $('noSources').hidden = rows.length > 0;

  }
  function renderDrafts() {

    const list = $('drafts');

    list.replaceChildren();

    $('noDrafts').hidden = project.drafts.length > 0;

    project.drafts.forEach(function (draft) {

      list.append(entry(

        svg('sparkle'),

        draft.title,

        join([draft.pageId, plural(draft.characters, 'character', 'characters'), draft.createdAt.slice(0, 10)]),

        [

          { label: 'Write…', title: 'Write ' + draft.pageId + ' to a folder',

            run: function () { vscode.postMessage({ type: 'draftWrite', id: draft.id }); } },

          { label: 'Copy', title: 'Copy ' + draft.pageId + ' to the clipboard',

            run: function () { vscode.postMessage({ type: 'draftCopy', id: draft.id }); } },

          { label: 'Discard', danger: true, title: 'Discard ' + draft.pageId,

            run: function () { vscode.postMessage({ type: 'draftDiscard', id: draft.id }); } },

        ]

      ));

    });

  }



  /** What the project is, in the rail: never editable, and never something a person opens another page to learn. */

  function renderFacts() {

    const box = $('facts');

    box.replaceChildren();

    function fact(key, value, note) {

      const row = document.createElement('div');

      row.className = 'fact';

      const name = document.createElement('span');

      name.className = 'fact__key';

      name.textContent = key;

      const text = document.createElement('span');

      text.className = 'fact__value';

      text.textContent = value;

      row.append(name, text);

      if (note) {

        const sub = document.createElement('span');

        sub.className = 'fact__note';

        sub.textContent = note;

        row.append(sub);

      }

      box.append(row);

    }

    fact('Origin', project.originLabel, project.originNote);

    if (project.document.template) { fact('Starter', project.document.template); }

    fact('Engine', project.document.engine || 'docfx');

    // Counts are not identity: how many sources are cited and outputs ticked is said in the line under the title and

    // again at the foot of the form, where it is about the save. The rail holds only what an edit cannot change.

  }



  function renderHead() {

    $('heading').textContent = project.document.name || 'Project';

    $('summary').textContent = join([

      project.originLabel,

      plural(cited.size, 'source', 'sources'),

      plural(outputs().length, 'output', 'outputs'),

    ]) + '.';

    $('footLine').textContent = join([

      plural(cited.size, 'source', 'sources'),

      plural(outputs().length, 'output', 'outputs'),

      project.drafts.length === 0 ? 'no drafts' : plural(project.drafts.length, 'draft', 'drafts'),

    ]);

  }



  function render() {

    renderSources();

    renderDrafts();

    renderFacts();

    renderHead();

  }



  window.addEventListener('message', function (event) {

    const message = event.data;

    // The citations again, after the repositories page has written one: the form is not re-seeded under the person.

    if (message.type === 'cited') {

      known = message.known || [];

      cited = new Set(message.cited || []);

      render();

      return;

    }

    if (message.type !== 'seed') { return; }



    project = message;

    project.document = message.document || { name: '', outputs: [] };

    project.drafts = message.drafts || [];

    known = message.known || [];

    cited = new Set(message.cited || []);



    $('name').value = project.document.name || '';

    $('version').value = project.document.version || '';



    // The outputs come back as the values the flow writes, so a project made anywhere opens on its own recipe.

    const recipe = project.document.outputs || [];

    Array.prototype.slice.call(document.querySelectorAll('input[data-output]')).forEach(function (input) {

      input.checked = recipe.indexOf(input.value) >= 0;

    });

    render();

  });



  $('outputs').addEventListener('change', function () { renderFacts(); renderHead(); });



  $('cite-more').addEventListener('click', function () { vscode.postMessage({ type: 'cite' }); });

  $('cancel').addEventListener('click', function () { vscode.postMessage({ type: 'cancel' }); });

  $('remove').addEventListener('click', function () { vscode.postMessage({ type: 'remove' }); });



  $('submit').addEventListener('click', function () {

    const name = $('name').value.trim();

    if (name.length === 0) { $('name').focus(); return; }

    vscode.postMessage({

      type: 'submit',

      values: {

        name: name,

        version: $('version').value.trim(),

      },

      cited: Array.from(cited),

      outputs: outputs(),

    });

  });



  vscode.postMessage({ type: 'ready' });

`;
}

/** Whether a path is already there — a draft never replaces a file that exists. */
async function there(uri: vscode.Uri): Promise<boolean> {
  try {
    await vscode.workspace.fs.stat(uri);
    return true;
  } catch {
    return false;
  }
}
