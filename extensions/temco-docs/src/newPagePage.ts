// New page — the flow the mock draws as `flow/new-page`: three steps, and one write at the end.
//
// Why a page and not an input box: VS Code asks one question at a time at the top of the window and cannot show
// what the answer will produce. A flow can say where the page lands, which sections its kind starts with, and the
// exact file the answers make — so a person decides once instead of four times.
//
// **Nothing is written until *Create Page* is pressed**, and the confirmation names the file. It writes through
// `writePage` in `src/pageOps.ts`, which is the only thing here that touches the disk. The three steps are the
// mock's: **Location** (source, area, chapter — and the pages it will land between), **Template** (the kind, whose
// headings are the outline), **Draft** (title, slug, where the body starts).
//
// Two kinds of material can be drafted from, and they are different on purpose:
//   * **the pages already in this area** — ids, titles and headings, the same material the AI panel works from;
//   * **one file of the source** — a class, a header, a script. This is the one prompt that may see code
//     (`prompts/newpage.md`), because the page being written is *about* that file, and a person chose it.

import * as fs from 'fs';
import * as vscode from 'vscode';
import { ai } from './aiModule';
import { DocsRoot, PageEntry, collectPages } from './registry';
import {
  AREA_CHAPTER,
  KINDS,
  NewPageSeed,
  NewPageSpec,
  PageDeps,
  writePage,
} from './pageOps';
import { codeFiles, readMaterials } from './repositories';
import { Catalog, slugOf } from './store';
import { NEW_PAGE_VIEW_TYPE, pageColumn } from './surface';
import { actionBar, hero, icon, page, section } from './ui';

/**
 * The shapes a page can start as.
 *
 * Every page this product writes is a Markdown file in `docs/`, which the registry names — so the type is not a file
 * format but a *starting shape*: a document carries the template's headings, Markdown leaves a body to write, and an
 * empty page is the title alone.
 */
const PAGE_TYPES = [
  { value: 'document', mark: 'document', label: 'Document', desc: 'The title and the template’s headings, ready to fill.' },
  { value: 'markdown', mark: 'edit', label: 'Markdown', desc: 'The title only — you write the structure.' },
  { value: 'empty', mark: 'plus', label: 'Empty page', desc: 'The title and nothing else.' },
];

/** The page's own shapes: the error line, the draft box, and the two small labels the sections carry. */
const NEXT_CSS = `
.np-count { color: var(--ink-3); font-size: 12px; }
.np-hint { color: var(--ink-3); font-size: 12px; line-height: 16px; }
#kind-headings { display: block; margin-top: var(--sp-3); }
.np-error { margin: var(--sp-3) 0; padding: 8px 12px; border: 1px solid var(--err-ink); border-radius: var(--r-2);
  background: var(--surface-card); color: var(--err-ink); font-size: 12px; }
.np-draft { margin: 8px 0 0; max-height: 260px; overflow: auto; white-space: pre-wrap; overflow-wrap: anywhere;
  padding: 12px 14px; border: 1px solid var(--hairline); border-radius: var(--r-2);
  background: var(--surface-subtle); color: var(--ink-1);
  font-family: var(--font-mono); font-size: 12.5px; line-height: 1.6; }
.np-file { display: flex; align-items: center; gap: 8px; padding: 6px 10px; border-radius: var(--r-2);
  font-size: 12px; color: var(--ink-2); cursor: pointer; }
.np-file:hover { background: var(--az-blue-selected); }
`;

/** How much of another page may be given to the model, so one huge page cannot fill the window. */
const MATERIAL_CHARS = 12_000;

interface FormMessage {
  type?: string;
  source?: string;
  files?: string[];
  from?: string;
  spec?: NewPageSpec;
  pageId?: string;
  note?: string;
}

/** What the flow is told about one writable source. */
interface SourceForm {
  name: string;
  /** The folder, for the line under the name. */
  where: string;
  areas: {
    area: string;
    title: string;
    chapters: string[];
    pages: { id: string; title: string; chapter: string; order: number; owner: string }[];
  }[];
}

export class NewPagePage {
  private panel: vscode.WebviewPanel | undefined;
  private seed: NewPageSeed = {};

  constructor(
    private readonly context: vscode.ExtensionContext,
    private readonly roots: () => readonly DocsRoot[],
    private readonly deps: PageDeps
  ) { }

  /** Opens the flow for one act: a new page, a new chapter, or a kind already chosen. */
  open(seed: NewPageSeed = {}): void {
    this.seed = seed;
    if (this.panel) {
      this.panel.reveal(pageColumn());
      void this.render();
      return;
    }
    this.panel = vscode.window.createWebviewPanel(NEW_PAGE_VIEW_TYPE, 'New page', pageColumn(), {
      enableScripts: true,
      localResourceRoots: [],
    });
    this.panel.iconPath = vscode.Uri.joinPath(this.context.extensionUri, 'media', 'docs.svg');
    this.panel.onDidDispose(() => {
      this.panel = undefined;
    });
    this.panel.webview.onDidReceiveMessage((message: FormMessage) => void this.receive(message));
    void this.render();
  }

  private async render(): Promise<void> {
    const panel = this.panel;
    if (!panel) {
      return;
    }
    panel.webview.html = html();
    await this.sendForm();
  }

  /** Everything the flow draws from: the sources, their areas and pages, the kinds, and the model in use. */
  private async sendForm(): Promise<void> {
    const panel = this.panel;
    if (!panel) {
      return;
    }
    await panel.webview.postMessage({
      type: 'form',
      seed: this.seed,
      sources: this.sources(),
      // The cited sources that are only in the catalog: no folder, so nowhere to write until one is downloaded.
      missing: await this.missingCopies(),
      kinds: KINDS.map((kind) => ({ label: kind.label, detail: kind.detail, headings: kind.headings })),
      areaChapter: AREA_CHAPTER,
      model: await modelLabel(),
      analyse: this.seed.analyse === true,
    });
  }

  /** Closes the flow: cancel, or the extension going away. */
  dispose(): void {
    this.panel?.dispose();
  }

  /** The sources a page can be written into: a folder on this machine, or a repository with a local copy. */
  private sources(): SourceForm[] {
    return this.roots().map((root) => ({
        name: root.folder.name,
        where: root.origin === 'catalog' ? 'read over the API — a draft asks for a local copy first' : root.rootUri.fsPath,
        areas: root.areas.map((area) => ({
          area: area.area,
          title: area.title,
          chapters: area.chapters.map((chapter) => chapter.chapter),
          // The pages as the Location step shows them: what the new page will land between, and who owns
          // the neighbours. Sent once with the form rather than asked for again.
          pages: area.chapters.flatMap((chapter) =>
            chapter.pages.map((page) => ({
              id: page.id,
              title: page.title,
              chapter: chapter.chapter,
              order: page.order,
              owner: page.owner,
            }))
          ),
        })),
      }));
  }

  private async receive(message: FormMessage): Promise<void> {
    switch (message.type) {
      case 'ready':
        await this.sendForm();
        return;
      case 'files':
        await this.files(message.source ?? '');
        return;
      case 'analyse':
        await this.analyse(message.source ?? '', message.note ?? '');
        return;
      case 'draft':
        await this.draft(message);
        return;
      case 'write':
        if (message.spec !== undefined) {
          await this.write(message.spec);
        }
        return;
      case 'cancel':
        this.panel?.dispose();
        return;
      case 'download':
        await this.download(message.source ?? '');
        return;
      case 'cite':
        // A project with no source is one *source* short, not one page short: the source flow is the act that
        // fills the form, and it is what the dead end should open.
        await vscode.commands.executeCommand('temcoProjects.addSource');
        return;
      default:
        return;
    }
  }

  /**
   * The project's cited sources with no folder on this machine.
   *
   * A source read over the API has no working tree, so there is nothing to write a page into — but it is one download
   * away, and the flow names that download instead of telling a person to go and find the project's folders.
   */
  private async missingCopies(): Promise<string[]> {
    const project = this.deps.project();
    if (project === undefined) {
      return [];
    }
    let catalog: Catalog | undefined;
    try {
      catalog = await Catalog.open(this.context);
      const detail = catalog.document(project);
      if (detail === undefined) {
        return [];
      }
      const open = catalog;
      return detail.sources
        .filter((source) => open.source(slugOf(source.name))?.path === undefined)
        .map((source) => source.name);
    } catch {
      return [];
    } finally {
      catalog?.close();
    }
  }

  /**
   * Downloads one source, then asks the documentation module to read again.
   *
   * The clone is the repositories module's own act, with its own question about where the copy goes; this only names
   * the source. After it, the source has a folder, so the flow has somewhere to write and the form is sent again.
   */
  private async download(source: string): Promise<void> {
    if (source.length === 0) {
      return;
    }
    const answer = await vscode.commands.executeCommand<{ path?: string; error?: string } | undefined>(
      'temcoRepositories.ensureClone',
      source
    );
    if (answer?.path === undefined) {
      void vscode.window.showWarningMessage(`Temco: ${answer?.error ?? `there is no local copy of ${source} yet.`}`);
      return;
    }
    // The read is the documentation module's: without it the new folder is not a root yet.
    await vscode.commands.executeCommand('temcoDocs.refresh');
    await this.sendForm();
  }

  /**
   * The folder to read a source's code from, cloning it when the source was read over the API.
   *
   * A draft or an analysis is a request for code; a source with no working tree has none to give, so the
   * repositories module is asked for the local copy — it asks the person, clones, and hands back the folder.
   */
  private async materialPath(root: DocsRoot): Promise<{ path: string } | { error: string }> {
    if (root.origin !== 'catalog') {
      return { path: root.rootUri.fsPath };
    }
    const answer = await vscode.commands.executeCommand<{ path?: string; error?: string } | undefined>(
      'temcoRepositories.ensureClone',
      root.folder.name
    );
    return answer?.path !== undefined
      ? { path: answer.path }
      : { error: answer?.error ?? 'There is no local copy of this source to read.' };
  }

  /**
   * What documentation this source is missing, from its file list and the pages that already exist.
   *
   * The model is given paths, never contents — a proposal to write a page, not a page. Each suggestion the flow
   * shows fills the title and the kind when it is clicked, and the ordinary draft-and-write path takes it from
   * there.
   */
  private async analyse(source: string, note: string): Promise<void> {
    const panel = this.panel;
    const root = this.roots().find((candidate) => candidate.folder.name === source);
    if (!panel || root === undefined) {
      return;
    }
    // The AI is a module of its own, and it may not be installed — in which case there is nothing to draft with.
    const assistant = await ai();
    if (assistant === undefined || assistant.modelLabel() === undefined) {
      await panel.webview.postMessage({
        type: 'analyseError',
        message: 'No local model is chosen. Download one in Server & Prompts (Temco AI), then analyse again.',
      });
      return;
    }

    const resolved = await this.materialPath(root);
    if ('error' in resolved) {
      await panel.webview.postMessage({ type: 'analyseError', message: resolved.error });
      return;
    }

    const listed = await codeFiles({ name: root.folder.name, path: resolved.path });
    if (listed.files.length === 0) {
      await panel.webview.postMessage({
        type: 'analyseError',
        message: listed.note ?? 'This source has no code files that can be read.',
      });
      return;
    }

    await panel.webview.postMessage({ type: 'analyseStart' });
    try {
      // Paths only, and only the first few hundred: a proposal is about what the repository *has*, not about
      // the contents of every file, and a small local model has a small window.
      const answer = await assistant.analyse({
        name: root.folder.name,
        files: listed.files.slice(0, 600).map((file) => file.path),
        pages: collectPages(root).map((page) => `${page.title} (\`${page.id}\`)`),
        note,
      });
      await panel.webview.postMessage({
        type: 'suggestions',
        items: suggestions(answer, listed.files),
      });
    } catch (error) {
      await panel.webview.postMessage({
        type: 'analyseError',
        message: error instanceof Error ? error.message : String(error),
      });
    }
  }

  /**
   * The source's code files, for the *from a file* material.
   *
   * One call for a folder (the disk) and one for a repository (`git/trees`, no clone), and the answer says which
   * folders were left out: generated, vendored and build output are never offered as the material for a page.
   */
  private async files(source: string): Promise<void> {
    const root = this.roots().find((candidate) => candidate.folder.name === source);
    const panel = this.panel;
    if (!panel || root === undefined) {
      return;
    }
    const resolved = await this.materialPath(root);
    if ('error' in resolved) {
      await panel.webview.postMessage({ type: 'files', source, files: [], note: resolved.error });
      return;
    }
    const result = await codeFiles({ name: root.folder.name, path: resolved.path });
    await panel.webview.postMessage({ type: 'files', source, ...result });
  }

  /**
   * A draft of the body.
   *
   * The material is whatever the person picked, and only that: the pages of this area (ids, titles and headings —
   * what the AI panel is already allowed to see), one file of the source, or another page of the area, whole.
   * The answer streams into the page as it is written, and nothing is kept: a draft that is not accepted is gone
   * with the page.
   */
  private async draft(message: FormMessage): Promise<void> {
    const panel = this.panel;
    const spec = message.spec;
    if (!panel || spec === undefined) {
      return;
    }
    // The same question as `analyse`, and the same answer when the AI module is not there.
    const assistant = await ai();
    if (assistant === undefined || assistant.modelLabel() === undefined) {
      await panel.webview.postMessage({
        type: 'draftError',
        message: 'No local model is chosen. Download one in Server & Prompts (Temco AI), then draft again.',
      });
      return;
    }

    const root = this.roots().find((candidate) => candidate.folder.name === spec.source);
    const kind = KINDS.find((candidate) => candidate.label === spec.kind) ?? KINDS[0];
    if (root === undefined) {
      await panel.webview.postMessage({ type: 'draftError', message: 'That source is not being read.' });
      return;
    }

    const material = await this.material(message, root, spec);
    if ('error' in material) {
      await panel.webview.postMessage({ type: 'draftError', message: material.error });
      return;
    }

    await panel.webview.postMessage({ type: 'draftStart' });
    let written = '';
    try {
      await assistant.draft({
        title: spec.title,
        kind: kind.label,
        headings: kind.headings,
        path: fileOf(this.deps.roots(), spec),
        area: material.area,
        material: material.text,
        // The answer streams into the page as it is written, and nothing is kept: a draft that is not accepted
        // is gone with the page.
        onToken: (text) => {
          written += text;
          void panel.webview.postMessage({ type: 'draftToken', text });
        },
      });
      await panel.webview.postMessage({ type: 'draftDone' });
    } catch (error) {
      await panel.webview.postMessage({
        type: 'draftError',
        message: error instanceof Error ? error.message : String(error),
      });
      return;
    }

    // The draft is kept: closing the tab used to lose it, and the Review Center has nothing to list if a draft
    // only exists on screen. The page it proposes keeps the id it will have, so accepting it later is exact.
    await this.keepDraft(spec, written);
  }

  /** One draft, in the catalog, against the project being worked on. */
  private async keepDraft(spec: NewPageSpec, body: string): Promise<void> {
    if (body.trim().length === 0) {
      return;
    }
    let catalog: Catalog | undefined;
    try {
      catalog = await Catalog.open(this.context);
      const project = await this.projectOf(catalog);
      if (project === undefined) {
        return;
      }
      catalog.saveDraft({
        documentSlug: project,
        pageId: pageIdOf(spec),
        title: spec.title,
        kind: spec.kind,
        body,
        source: spec.source,
      });
    } catch {
      // A catalog that cannot be written leaves the draft on screen, which is where it was before.
    } finally {
      catalog?.close();
    }
  }

  /** The page was written: every draft that proposed it is accepted. */
  private async settleDrafts(spec: NewPageSpec): Promise<void> {
    let catalog: Catalog | undefined;
    try {
      catalog = await Catalog.open(this.context);
      const project = await this.projectOf(catalog);
      if (project === undefined) {
        return;
      }
      catalog.settleDrafts(project, pageIdOf(spec), 'accepted');
    } catch {
      // Nothing to settle.
    } finally {
      catalog?.close();
    }
  }

  /**
   * Which project a draft belongs to.
   *
   * The selected one, and when nothing is selected the only one there is: a window with a single project is what
   * a person working alone has, and asking them to select it first would lose the draft for no reason.
   */
  private async projectOf(catalog: Catalog): Promise<string | undefined> {
    const selected = this.deps.project();
    if (selected !== undefined) {
      return selected;
    }
    const all = catalog.documents();
    return all.length === 1 ? slugOf(all[0].name) : undefined;
  }

  /** The material for one draft, and the line saying what is already in the area. */
  private async material(
    message: FormMessage,
    root: DocsRoot,
    spec: NewPageSpec
  ): Promise<{ text: string; area: string } | { error: string }> {
    const area = spec.area ?? '';
    const group = root.areas.find((candidate) => candidate.area === area);
    const listed = (group?.chapters ?? [])
      .map((chapter) =>
        [`## ${chapter.chapter === AREA_CHAPTER ? 'directly in the area' : chapter.chapter}`, ...chapter.pages.map(summarise)].join(
          '\n'
        )
      )
      .join('\n\n');

    if (message.from === 'file') {
      const chosen = message.files ?? [];
      if (chosen.length === 0) {
        return { error: 'No file was chosen to draft from.' };
      }
      const resolved = await this.materialPath(root);
      if ('error' in resolved) {
        return { error: resolved.error };
      }
      const materials = await readMaterials({ name: root.folder.name, path: resolved.path }, chosen);
      if (materials.included.length === 0) {
        return { error: 'None of the chosen files could be read.' };
      }
      return {
        text: `${materials.text}\n\n… ${materials.included.length} file(s), ${materials.characters} characters${materials.skipped.length > 0 ? `, ${materials.skipped.length} left out to stay within the budget` : ''} …`,
        area: listed,
      };
    }

    if (message.from === 'page') {
      const page = collectPages(root).find((candidate) => candidate.id === message.pageId);
      if (page === undefined) {
        return { error: 'That page is not in this source.' };
      }
      return { text: pageBody(page), area: listed };
    }

    return { text: listed, area: listed };
  }

  /** The one write: `writePage` confirms, writes, opens the file, and offers the generator. */
  private async write(spec: NewPageSpec): Promise<void> {
    const panel = this.panel;
    const written = await writePage(this.deps, spec);
    if (written !== undefined) {
      await this.settleDrafts(spec);
      await panel?.webview.postMessage({ type: 'written', relative: written.relative });
    }
  }
}

/**
 * The pages a model proposed, as far as they are real.
 *
 * A small local model writes roughly what it was asked for and sometimes not: a line that is not
 * `title | kind | files` is dropped, a kind that does not exist becomes *Article*, and a file that is not in the
 * list the model was given is dropped too — so a suggestion can only ever name files that are really there. The
 * flow shows the result, and the person clicks one.
 */
function suggestions(
  answer: string,
  files: readonly { path: string }[]
): { title: string; kind: string; files: string[] }[] {
  const known = new Set(files.map((file) => file.path));
  const items: { title: string; kind: string; files: string[] }[] = [];

  for (const line of answer.split('\n')) {
    const match = /^\s*[-*\d.]*\s*(.+?)\s*\|\s*([^|]+?)\s*\|\s*(.*)$/.exec(line);
    if (!match) {
      continue;
    }
    const title = match[1].replace(/^[\s*#-]+|[\s*]+$/g, '').trim();
    if (title.length === 0 || title.length > 80) {
      continue;
    }
    const wanted = match[2].trim().toLowerCase();
    const kind =
      KINDS.find((candidate) => candidate.label.toLowerCase() === wanted) ??
      KINDS.find((candidate) => candidate.label.toLowerCase().startsWith(wanted.slice(0, 5))) ??
      KINDS[0];
    const chosen = match[3]
      .split(',')
      .map((one) => one.trim().replace(/^`|`$/g, ''))
      .filter((one) => known.has(one));
    items.push({ title, kind: kind.label, files: chosen });
  }

  // One proposal per title, and a list a person can read: the model is asked for a handful and may return more.
  return items
    .filter(
      (item, index) =>
        items.findIndex((other) => other.title.toLowerCase() === item.title.toLowerCase()) === index
    )
    .slice(0, 12);
}

/**
 * The model in use as a person would name it, or nothing — what the flow needs before it offers to draft.
 *
 * Asked of the AI module rather than read from a setting: which model is *installed* is that module's answer.
 */
async function modelLabel(): Promise<string | undefined> {
  return (await ai())?.modelLabel();
}

/** A page, as the material line for the area: its id, its title, and the headings it carries. */
function summarise(page: PageEntry): string {
  const headings = page.provenance?.headings ?? [];
  return `- \`${page.id}\` — ${page.title}${headings.length > 0 ? ` (${headings.join(' · ')})` : ''}`;
}

/** Another page of the area, whole: what a draft that adapts an existing page reads. */
function pageBody(page: PageEntry): string {
  try {
    const text = fs.readFileSync(page.uri.fsPath, 'utf8');
    return `# ${page.title} (\`${page.id}\`)\n\n${text.slice(0, MATERIAL_CHARS)}`;
  } catch {
    return `# ${page.title} (\`${page.id}\`)`;
  }
}

/** The id the page will have: `area/[chapter/]slug`. The draft carries it, and the Review Center accepts by it. */
function pageIdOf(spec: NewPageSpec): string {
  const chapter = spec.chapter === undefined || spec.chapter === AREA_CHAPTER ? '' : `${spec.chapter}/`;
  return `${spec.area ?? ''}/${chapter}${spec.slug ?? ''}`;
}

/** The file a spec would produce, for the prompt's own line — the confirmation names it again before writing. */
function fileOf(roots: readonly DocsRoot[], spec: NewPageSpec): string {
  const root = roots.find((candidate) => candidate.folder.name === spec.source) ?? roots[0];
  const area = spec.area ?? root?.areas[0]?.area ?? '';
  const chapter = spec.chapter === undefined || spec.chapter === AREA_CHAPTER ? '' : `${spec.chapter}/`;
  return root === undefined ? '' : `${root.folder.name}/docs/${area}/${chapter}${spec.slug ?? ''}.md`;
}

/* ------------------------------------------------------------------ the three steps */

function html(): string {
  const types = PAGE_TYPES.map((type) =>
    `<button type="button" class="az-choice${type.value === 'document' ? ' is-on' : ''}" role="option" aria-selected="${type.value === 'document'}" data-type="${type.value}"><span class="az-choice__icon">${icon(type.mark)}</span><span class="az-choice__main"><span class="az-choice__title">${type.label}</span><span class="az-choice__desc">${type.desc}</span></span><span class="az-choice__check">${icon('check', 'icon--sm')}</span></button>`
  ).join('');

  const body = `${hero({
		mark: 'plus',
		title: 'New Page',
		desc: 'A title, the shape of the file, and the template its headings come from. Where it goes is already answered by the row you had selected, and nothing is written until you press Create Page.',
		descWide: true
	})}

<div id="nothing" hidden></div>

<div id="flow" data-step-body="0">
	<div class="np-error" id="wizard-error" hidden></div>

	${section({ title: 'What is it called?', desc: 'The file name follows the title — nothing else is needed to make a page.' })}
	<div class="az-form" id="name"></div>

	${section({ title: 'Type', desc: 'What the file starts as. Every page is a Markdown file the registry names.' })}
	<div class="az-choices" id="types" role="listbox">${types}</div>

	<div id="template-block">
		${section({ title: 'Template', desc: 'The headings a document starts with — an outline, not someone else’s text.' })}
		<div class="az-choices" id="kinds"></div>
		<div class="np-hint" id="kind-headings"></div>
		<div id="template"></div>
	</div>

	<div id="pickers"></div>
	<div id="address"></div>
	<div id="tools"></div>
	<div id="note"></div>

	${actionBar({
		summaryId: 'wizard-count',
		actions: `<button type="button" class="az-btn" id="wizard-cancel">${icon('close')}<span>Cancel</span></button><button type="button" class="az-btn" id="wizard-back" hidden><span>Back</span></button><button type="button" class="az-btn" id="wizard-next" hidden><span>Next</span></button><button type="button" class="az-btn az-btn--primary" id="wizard-finish">${icon('check')}<span>Create Page</span></button>`
	})}
</div>`;

  return page(body, { title: 'New page', script: CLIENT, extraCss: NEXT_CSS });
}

/**
 * The flow's behaviour: three steps, the mock's three checks, and one message at the end.
 *
 * Everything the answer depends on — the areas of a source, the chapters of an area, the pages a new page lands
 * between — is drawn here rather than sent again, so a change of area costs nothing.
 */
const CLIENT = `
(function () {
	const api = acquireVsCodeApi();
	const NEW_CHAPTER = '__new';
	const $ = (id) => document.getElementById(id);
	const steps = Array.prototype.slice.call(document.querySelectorAll('.wizard__steps .step'));
	const bodies = Array.prototype.slice.call(document.querySelectorAll('[data-step-body]'));
	const error = $('wizard-error');
	const count = $('wizard-count');
	const back = $('wizard-back');
	const next = $('wizard-next');
	const finish = $('wizard-finish');

	let sources = [];
	let missing = [];
	let kinds = [];
	let areaChapter = '(root)';
	let seed = {};
	let model;
	let at = 0;
	let files = [];
	let ticked = new Set();
	let suggestions = [];
	let draft = '';
	let values = { source: '', area: '', chapter: '', chapterName: '', kind: '', pageType: 'document', title: '', slug: '', from: 'empty', pageId: '' };

	function esc(text) {
		return String(text).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
	}

	function slugify(text) {
		return String(text).toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
	}

	/* The page's own glyphs: the sprite is in the document, so a row can be drawn from here without
	   asking the host for markup. */
	function tone(name) {
		return '<svg viewBox="0 0 24 24" class="icon icon--sm" aria-hidden="true"><use href="#i-' + name + '"></use></svg>';
	}

	function group(label, countText, note, rows) {
		return '<div class="az-section"><div class="az-section__text"><h2 class="az-section__title">' + esc(label) + '</h2>' +
			(note ? '<p class="az-section__desc">' + esc(note) + '</p>' : '') + '</div>' +
			'<div class="az-section__actions"><span class="np-count">' + esc(countText) + '</span></div></div>' +
			'<div class="az-entries">' + rows + '</div>';
	}

	function row(glyph, tint, title, meta, state) {
		return '<div class="az-entry"><span class="az-entry__icon">' + tone(glyph, tint) + '</span>' +
			'<div class="az-entry__main"><span class="az-entry__title">' + esc(title) + '</span>' +
			'<span class="az-entry__meta">' + esc(meta) + '</span></div>' +
			'<span class="az-entry__go">' + (state || '') + '</span></div>';
	}

	function formRow(label, desc, control) {
		return '<div class="az-form__field"><span class="az-form__label">' + esc(label) + '</span>' + control +
			'<span class="az-form__hint">' + esc(desc) + '</span></div>';
	}

	function chosenSource() {
		return sources.filter(function (source) { return source.name === values.source; })[0] || sources[0];
	}

	function chosenArea() {
		const source = chosenSource();
		if (!source) { return undefined; }
		return source.areas.filter(function (area) { return area.area === values.area; })[0] || source.areas[0];
	}

	function pagesOfArea() {
		const area = chosenArea();
		if (!area) { return []; }
		return area.pages.slice().sort(function (a, b) { return a.order - b.order || a.title.localeCompare(b.title); });
	}

	/* ------------------------------------------------------------------ step 1: where */

	function drawPlace() {
		// The location selectors are gone from the form: the row that was selected answers it, and there is no
		// "Change…" any more. Kept as a guard so the change handlers above cannot write into an element that no
		// longer exists.
		if (!document.getElementById('place')) { return; }
		const controls = [];
		if (sources.length > 1) {
			controls.push(formRow('Source', 'A page is written into a folder on this machine, never one read over the API.',
				'<select class="select" data-field="source" aria-label="Source">' + sources.map(function (source) {
					return '<option value="' + esc(source.name) + '"' + (source.name === values.source ? ' selected' : '') + '>' + esc(source.name) + '</option>';
				}).join('') + '</select>'));
		}
		controls.push(formRow('Area', 'Each area has its own pages and its own reading order.',
			'<select class="select" data-field="area" aria-label="Area">' + (chosenSource() ? chosenSource().areas.map(function (area) {
				return '<option value="' + esc(area.area) + '"' + (area.area === values.area ? ' selected' : '') + '>' + esc(area.title || area.area) + '</option>';
			}).join('') : '') + '</select>'));
		controls.push(formRow('Chapter', 'A folder inside the area. Directly in the area means no folder of its own.',
			'<select class="select" data-field="chapter" aria-label="Chapter">' + chapterOptions() + '</select>' +
			'<input class="input" data-field="chapterName" value="' + esc(values.chapterName) + '" placeholder="chapter-folder" aria-label="New chapter"' +
			(values.chapter === NEW_CHAPTER ? '' : ' hidden') + '>'));

		const here = pagesOfArea().filter(function (page) { return page.chapter === values.chapter; });
		const last = here.length > 0 ? here[here.length - 1] : undefined;
		controls.push(formRow('Position', last
			? 'The generator adds it after “' + last.title + '”, at the end of this chapter.'
			: 'This chapter has no pages yet, so it is the first.', '<span class="cell-muted">' + (last ? 'after order ' + last.order : 'first') + '</span>'));

		$('place').innerHTML = controls.join('');
		drawWhere();
		drawLands();
	}

	/**
	 * The one line that answers "where does it go?".
	 *
	 * The row selected in the tree already answered it, so the selectors are behind *Change…* and this line is the
	 * whole of the answer: the area, and the folder inside it.
	 */
	function drawWhere() {
		const area = chosenArea();
		const chapter = finalChapter();
		const line = document.getElementById('where-line');
		if (!line) { return; }
		const folder = chapter && chapter !== areaChapter ? chapter : '';
		line.textContent = 'In ' + (area ? (area.title || area.area) : 'this source') + (folder ? ' › ' + folder : '') +
			(values.slug ? '  →  ' + landingPath() : '');
	}

	function chapterOptions() {
		const area = chosenArea();
		const names = area ? area.chapters.filter(function (chapter) { return chapter !== areaChapter; }) : [];
		const all = [{ value: areaChapter, label: 'Directly in the area' }].concat(names.map(function (name) {
			return { value: name, label: name };
		})).concat([{ value: NEW_CHAPTER, label: 'A new chapter…' }]);
		if (!all.some(function (one) { return one.value === values.chapter; })) {
			values.chapter = areaChapter;
		}
		return all.map(function (one) {
			return '<option value="' + esc(one.value) + '"' + (one.value === values.chapter ? ' selected' : '') + '>' + esc(one.label) + '</option>';
		}).join('');
	}

	/** The chapter folder a write would use: the one chosen, or the new one being named. */
	function finalChapter() {
		return values.chapter === NEW_CHAPTER ? slugify(values.chapterName) : values.chapter;
	}

	/** Where it lands: what the new page will sit between, read from the area's own pages. */
	function drawLands() {
		const area = chosenArea();
		if (!area) {
			$('lands').innerHTML = '';
			return;
		}
		const here = pagesOfArea().filter(function (page) { return page.chapter === finalChapter(); });
		const owners = [];
		for (const page of here) {
			if (page.owner && owners.indexOf(page.owner) < 0) { owners.push(page.owner); }
		}
		const neighbours = here.slice(-2).map(function (page) {
			return row('document', undefined, 'Order ' + page.order + ' · ' + page.title,
				(page.owner || 'no owner') + ' · ' + (page.chapter === areaChapter ? 'directly in the area' : page.chapter), '');
		}).join('');
		const created = '<div class="az-entry"><span class="az-entry__icon">' + tone('plus') + '</span>' +
			'<div class="az-entry__main"><span class="az-entry__title">' +
			esc(values.title || 'untitled page') + '</span>' +
			'<span class="az-entry__meta">the page this flow creates</span></div>' +
			'<span class="az-entry__go">draft</span></div>';
		const note = owners.length > 0
			? 'Pages here are owned by ' + owners.join(', ') + ', who will be asked to review this one.'
			: 'Nothing here has an owner yet, so nobody is asked to review this one.';
		$('lands').innerHTML = group('Where It Lands', here.length + (here.length === 1 ? ' page in ' : ' pages in ') + (area.title || area.area), note, neighbours + created);
	}

	/* ------------------------------------------------------------------ step 2: template */

	/** A glyph on its own, in the sprite the page carries — the client has no icon() helper, only tone(). */
	function glyph(name) {
		return '<svg viewBox="0 0 24 24" class="icon icon--sm" aria-hidden="true"><use href="#i-' + name + '"></use></svg>';
	}

	/** The three types: what the file starts as. */
	function drawTypes() {
		const box = $('types');
		if (!box) { return; }
		Array.prototype.forEach.call(box.querySelectorAll('[data-type]'), function (button) {
			const on = button.getAttribute('data-type') === values.pageType;
			button.classList.toggle('is-on', on);
			button.setAttribute('aria-selected', String(on));
		});
	}

	function drawKinds() {
		// One card per template: a glyph, the name and what it is for. The headings it writes are stated under the
		// row, so the difference between "Task" and "Troubleshooting" is visible before the page exists.
		$('kinds').innerHTML = kinds.map(function (kind) {
			const on = kind.label === values.kind;
			return '<button type="button" class="az-choice' + (on ? ' is-on' : '') + '" role="option" aria-selected="' + on + '" data-kind="' + esc(kind.label) + '">' +
				'<span class="az-choice__icon">' + glyph(kindIcon(kind.label)) + '</span>' +
				'<span class="az-choice__main"><span class="az-choice__title">' + esc(kind.label) + '</span>' +
				'<span class="az-choice__desc">' + esc(kind.detail) + '</span></span>' +
				'<span class="az-choice__check">' + glyph('check') + '</span></button>';
		}).join('');
		drawTemplate();
	}

	/** The glyph a kind carries: the shape of the page, not decoration. */
	function kindIcon(label) {
		if (label === 'Task') { return 'check'; }
		if (label === 'Reference') { return 'list'; }
		if (label === 'Troubleshooting') { return 'warning'; }
		if (label === 'Release note') { return 'sparkle'; }
		return 'document';
	}

	/** What the chosen template produces: its headings, and nothing invented. Only a document has a template. */
	function drawTemplate() {
		const block = $('template-block');
		const documentType = values.pageType === 'document';
		if (block) { block.hidden = !documentType; }
		if (!documentType) { return; }
		const kind = kinds.filter(function (candidate) { return candidate.label === values.kind; })[0];
		const headings = kind ? kind.headings : [];
		const line = document.getElementById('kind-headings');
		if (line) {
			line.textContent = headings.length > 0
				? 'Starts with: ' + headings.join(' · ')
				: 'No headings: a title and an empty body.';
		}
		const rows = headings.length > 0
			? headings.map(function (heading, index) {
				return row('list', undefined, heading, 'section ' + (index + 1) + ' · a heading with an empty body', '');
			}).join('')
			: row('document', undefined, 'Title only', 'the body is yours to write', '');
		const note = headings.length > 0
			? 'The page starts with these headings and no prose; anything you write later fills them.'
			: 'A page with no template has a title and an empty body; nothing is stubbed out for you.';
		$('template').innerHTML = group('What it starts with', headings.length > 0 ? headings.length + ' sections' : 'no sections', note, rows);
	}

	/* ------------------------------------------------------------------ step 3: draft */

	function drawName() {
		values.slug = slugify(values.title);
		// The file name is a consequence of the title, so it is a line rather than a field: nothing to fill in, and
		// nothing that can disagree with what the title produces.
		$('name').innerHTML =
			formRow('Title', 'What a reader sees in the list and in the PDF.',
				'<input class="az-input" data-field="title" value="' + esc(values.title) + '" placeholder="Point Scaling" aria-label="Page title">') +
			formRow('File', 'What the title decides. The file is written beside the other pages of its chapter.',
				'<span class="cell-mono" id="will-write">→ ' + esc(landingPath()) + '</span>');
		drawAddress();
		drawTools();
	}

	/** The file the page will be, as the form shows it while the title is typed. */
	function landingPath() {
		const chapter = finalChapter();
		const name = values.slug.length > 0 ? values.slug : 'page-name';
		return (chapter === areaChapter ? '' : chapter + '/') + name + '.md';
	}

	function drawPickers() {
		if (values.from === 'file') {
			const list = files.length > 0
				? files.map(function (file) {
					return '<label class="np-file"><input type="checkbox" data-file="' + esc(file.path) + '"' +
						(ticked.has(file.path) ? ' checked' : '') + '><span class="cell-mono">' +
						esc(file.path) + '</span></label>';
				}).join('')
				: '<p class="np-hint">Reading the file list…</p>';
			$('pickers').innerHTML = group('The Files', files.length + (files.length === 1 ? ' file' : ' files'),
				'A page about a file is written from that file alone.', list);
			return;
		}
		if (values.from === 'page') {
			const options = pagesOfArea().map(function (page) {
				return '<option value="' + esc(page.id) + '"' + (page.id === values.pageId ? ' selected' : '') + '>' + esc(page.title) + '</option>';
			}).join('');
			$('pickers').innerHTML = group('The Page', pagesOfArea().length + ' in this area',
				'Adapting a page that already says something close is what a person does with a pen; here it is one choice.',
				'<select class="az-input" data-field="page" aria-label="Page">' + options + '</select>');
			return;
		}
		$('pickers').innerHTML = '';
	}

	/** The address the site and the search index will list it at. */
	function drawAddress() {
		const source = chosenSource();
		const area = chosenArea();
		// The real path, relative to the source's own folder: docs/<area>/<folder>/<file>.md. It used to carry the
		// source's display name and a second "docs/", so the one thing this section exists to state was wrong.
		const chapter = finalChapter() && finalChapter() !== areaChapter ? finalChapter() + '/' : '';
		const where = 'docs/' + (area ? area.area : 'area') + '/' + chapter + (values.slug || '…') + '.md';
		const lines = group('Address', 'draft', 'The file this page becomes, relative to ' + (source ? source.name : 'the source') + '.',
			'<div class="az-entry"><span class="az-entry__icon">' + glyph('link') + '</span>' +
			'<div class="az-entry__main"><span class="az-entry__title cell-mono" style="word-break:break-all">' + esc(where) + '</span>' +
			'<span class="az-entry__meta">' + esc(values.pageType) + ' · ' + esc(values.title || 'untitled page') + '</span></div>' +
			'<span class="az-entry__go"></span></div>');
		const notes = '<aside class="az-callout"><div class="az-callout__main"><span class="az-callout__icon">' + glyph('info') + '</span>' +
			'<div><p class="az-callout__desc">The page is created as a file. It reaches the site only through a build and a release.</p></div></div></aside>';
		$('address').innerHTML = lines + notes;
	}

	function drawTools() {
		const analysis = suggestions.length > 0
			? suggestions.map(function (item, index) {
				return '<div class="az-entry az-entry--action" data-suggestion="' + index + '">' + '<span class="az-entry__icon">' + tone('sparkle') + '</span>' +
					'<div class="az-entry__main"><span class="az-entry__title">' + esc(item.title) + '</span>' +
					'<span class="az-entry__meta">' + esc(item.kind) + (item.files.length > 0 ? ' · ' + esc(item.files.join(', ')) : '') + '</span></div>' +
					'<span class="az-entry__go">' + glyph('chevron-right') + '</span></div>';
			}).join('')
			: '';
		$('tools').innerHTML = '<div class="az-row">' +
			'<button type="button" class="az-btn az-btn--primary" id="draft"' + (model ? '' : ' disabled') + '><span>Draft it with the AI</span></button>' +
			'<button type="button" class="az-btn" id="analyse"><span>What is missing</span></button>' +
			'<span class="np-hint" id="model"></span></div>' +
			'<div id="draftBox"></div>' +
			'<div class="az-entries" id="suggestions">' + analysis + '</div>';
		$('model').textContent = model ? 'Local model: ' + model : 'No local model is chosen — the AI drafts are off.';
		redrawDraft();
	}

	function redrawDraft() {
		const box = $('draftBox');
		if (!box) { return; }
		if (!draft) {
			box.innerHTML = '';
			return;
		}
		box.innerHTML = '<pre class="np-draft">' + esc(draft) + '</pre>' +
			'<p class="np-hint" style="margin-top:8px">Read it. Edit anything you like after it is written — or draft again.</p>';
	}

	/* ------------------------------------------------------------------ the steps */

	function show() {
		// One screen: every section is drawn at once, and nothing is stepped through. The steps remain in the markup
		// only as the elements the script already knows how to fill.
		steps.forEach(function (step, number) { step.classList.toggle('is-active', number === 0); });
		bodies.forEach(function (body) { body.hidden = false; });
		count.textContent = '';
		back.hidden = true;
		next.hidden = true;
		finish.hidden = false;
		error.hidden = true;
		drawTypes();
		drawKinds();
		drawName();
	}

	function fail(message) {
		error.textContent = message;
		error.hidden = false;
		// The message is above the form, so it is where the eye already is when the page opens; bringing it into view
		// only matters when the person is scrolled down at the fields.
		if (typeof error.scrollIntoView === 'function') { error.scrollIntoView({ block: 'nearest' }); }
		return false;
	}

	function check() {
		// One screen means one check: everything the form asks is validated together, because there is no step to
		// be on when it is asked.
		if (!chosenSource()) { return fail('There is no source on this machine to write a page into.'); }
		if (!chosenArea()) { return fail('A page belongs in an area, and this source has none.'); }
		if (values.chapter === NEW_CHAPTER && slugify(values.chapterName).length === 0) {
			return fail('A new chapter needs a folder name.');
		}
		if (!values.kind) { return fail('Choose the kind of page this is.'); }
		if (values.title.trim().length === 0) { return fail('A page needs a title.'); }
		const clash = pagesOfArea().filter(function (page) {
			return page.title.toLowerCase() === values.title.trim().toLowerCase() && page.chapter === finalChapter();
		})[0];
		if (clash) { return fail('A page called “' + clash.title + '” already exists in this chapter.'); }
		if (values.from === 'file' && ticked.size === 0) { return fail('Tick at least one file to draft from.'); }
		if (values.from === 'page' && !values.pageId) { return fail('Choose the page to draft from.'); }
		return true;
	}

	/* ------------------------------------------------------------------ messages */

	window.addEventListener('message', function (event) {
		const message = event.data;
		if (message.type === 'form') {
			sources = message.sources || [];
			missing = message.missing || [];
			kinds = message.kinds || [];
			areaChapter = message.areaChapter || '(root)';
			seed = message.seed || {};
			model = message.model;
			accept();
			return;
		}
		if (message.type === 'files') {
			files = message.files || [];
			if (values.from === 'file') { drawPickers(); }
			return;
		}
		if (message.type === 'analyseStart') {
			suggestions = [];
			drawTools();
			return;
		}
		if (message.type === 'suggestions') {
			suggestions = message.items || [];
			drawTools();
			return;
		}
		if (message.type === 'analyseError' || message.type === 'draftError') {
			fail(message.message || 'That did not work.');
			return;
		}
		if (message.type === 'draftStart') {
			draft = '';
			redrawDraft();
			return;
		}
		if (message.type === 'draftToken') {
			draft += message.text || '';
			redrawDraft();
			return;
		}
		if (message.type === 'draftDone') {
			redrawDraft();
			return;
		}
		if (message.type === 'written') {
			finish.disabled = true;
			next.disabled = true;
			finish.outerHTML = '<span class="cell-muted">Written to ' + esc(message.relative) + ' — the editor has it.</span>';
			return;
		}
	});

	function accept() {
		if (sources.length === 0) {
			$('flow').hidden = true;
			const box = $('nothing');
			box.hidden = false;
			// Two different dead ends, said differently: a project whose sources are only in the catalog is one download
			// from working, and a project with no sources is one citation from having any.
			box.innerHTML = missing.length > 0
				? '<aside class="az-callout"><div class="az-callout__main"><span class="az-callout__icon">' + glyph('alert') + '</span>' +
					'<div><p class="az-callout__desc">This project’s sources are read over the API, so there is no folder on this machine to write a page into. Download a local copy of <b>' +
					esc(missing[0]) + '</b> — the page is written there.</p></div></div></aside>' +
					'<div class="az-row mt-16"><button type="button" class="az-btn az-btn--primary" id="download-copy"><span>Download a local copy</span></button></div>'
				: '<aside class="az-callout"><div class="az-callout__main"><span class="az-callout__icon">' + glyph('alert') + '</span>' +
					'<div><p class="az-callout__desc">This project cites no source yet, so there is nowhere to write a page. Add a source folder (or a repository) and this form fills in.</p></div></div></aside>' +
					'<div class="az-row mt-16"><button type="button" class="az-btn az-btn--primary" id="cite-source"><span>Add a Source</span></button></div>';
			const download = $('download-copy');
			if (download) { download.addEventListener('click', function () { api.postMessage({ type: 'download', source: missing[0] }); }); }
			const cite = $('cite-source');
			if (cite) { cite.addEventListener('click', function () { api.postMessage({ type: 'cite' }); }); }
			return;
		}

		// A source arrived after the empty state was drawn (a download finished): the wizard comes back.
		$('flow').hidden = false;
		$('nothing').hidden = true;

		const source = sources.filter(function (candidate) { return candidate.name === seed.source; })[0] || sources[0];
		values.source = source.name;
		values.area = (seed.area && source.areas.some(function (area) { return area.area === seed.area; }) ? seed.area : (source.areas[0] ? source.areas[0].area : ''));
		values.chapter = seed.chapter || areaChapter;
		values.kind = (seed.kind && kinds.some(function (kind) { return kind.label === seed.kind; }) ? seed.kind : (kinds[0] ? kinds[0].label : ''));
		values.pageType = seed.pageType === 'markdown' || seed.pageType === 'empty' ? seed.pageType : 'document';
		values.title = '';
		values.from = 'empty';

		show(0);
		if (seed.analyse === true) {
			show(2);
			analyse();
		}
	}

	function analyse() {
		if (sources.length === 0) { return; }
		api.postMessage({ type: 'analyse', source: values.source });
	}

	function draftIt() {
		if (!model) { return; }
		api.postMessage({
			type: 'draft',
			from: values.from,
			files: Array.from(ticked),
			pageId: values.pageId,
			spec: {
				source: values.source,
				area: values.area,
				chapter: finalChapter(),
				kind: values.kind,
				pageType: values.pageType,
				title: values.title,
				slug: values.slug,
				body: draft
			}
		});
	}

	/* ------------------------------------------------------------------ wiring */

	$('wizard-cancel').addEventListener('click', function () { api.postMessage({ type: 'cancel' }); });
	back.addEventListener('click', function () { if (check()) { show(at - 1); } });
	next.addEventListener('click', function () { if (check()) { show(at + 1); } });
	finish.addEventListener('click', function () {
		if (!check()) { return; }
		api.postMessage({
			type: 'write',
			spec: {
				source: values.source,
				area: values.area,
				chapter: finalChapter(),
				kind: values.kind,
				pageType: values.pageType,
				title: values.title,
				slug: values.slug,
				body: draft
			}
		});
	});
	steps.forEach(function (step) {
		step.addEventListener('click', function () {
			const wanted = Number(step.dataset.step);
			if (wanted > at && !check()) { return; }
			show(wanted);
		});
	});

	/* A change anywhere is read from the document, so a redraw can replace the control that changed. */
	document.addEventListener('change', function (event) {
		const field = event.target;
		const name = field.dataset ? field.dataset.field : undefined;
		if (name === 'source') {
			values.source = field.value;
			values.area = chosenArea() ? chosenArea().area : '';
			values.chapter = areaChapter;
			files = [];
			ticked = new Set();
			drawPlace();
			return;
		}
		if (name === 'area') {
			values.area = field.value;
			values.chapter = areaChapter;
			files = [];
			ticked = new Set();
			drawPlace();
			return;
		}
		if (name === 'chapter') {
			values.chapter = field.value;
			drawPlace();
			if (values.chapter === NEW_CHAPTER) {
				const input = document.querySelector('[data-field=chapterName]');
				if (input) { input.focus(); }
			}
			return;
		}
		if (name === 'kind') {
			values.kind = field.value;
			drawTemplate();
			drawAddress();
			return;
		}
		if (name === 'from') {
			values.from = field.value;
			if (values.from === 'file' && files.length === 0) {
				api.postMessage({ type: 'files', source: values.source });
			}
			drawPickers();
			return;
		}
		if (name === 'page') {
			values.pageId = field.value;
			return;
		}
		if (field.dataset && field.dataset.file !== undefined) {
			if (field.checked) { ticked.add(field.dataset.file); } else { ticked.delete(field.dataset.file); }
			return;
		}
	});

	document.addEventListener('input', function (event) {
		if (event.target.dataset && event.target.dataset.field === 'title') {
			values.title = event.target.value;
			values.slug = slugify(values.title);
			// The file name is shown, not edited: this line is the whole of what the title decides.
			const hint = document.getElementById('will-write');
			if (hint) { hint.textContent = '→ ' + landingPath(); }
			drawAddress();
		}
		if (event.target.dataset && event.target.dataset.field === 'chapterName') {
			values.chapterName = event.target.value;
		}
	});

	document.addEventListener('click', function (event) {
		const typeButton = event.target.closest ? event.target.closest('#types [data-type]') : null;
		if (typeButton) {
			values.pageType = typeButton.getAttribute('data-type');
			drawTypes();
			drawTemplate();
			drawAddress();
			return;
		}
		const kindButton = event.target.closest ? event.target.closest('#kinds [data-kind]') : null;
		if (kindButton) {
			values.kind = kindButton.getAttribute('data-kind');
			drawKinds();
			drawAddress();
			return;
		}
		const suggestion = event.target.closest ? event.target.closest('[data-suggestion]') : null;
		if (suggestion) {
			const item = suggestions[Number(suggestion.dataset.suggestion)];
			if (item) {
				values.title = item.title;
				values.kind = item.kind;
				show(2);
			}
			return;
		}
		if (event.target.id === 'draft' || (event.target.closest && event.target.closest('#draft'))) {
			draftIt();
			return;
		}
		if (event.target.id === 'analyse' || (event.target.closest && event.target.closest('#analyse'))) {
			analyse();
			return;
		}
	});

	api.postMessage({ type: 'ready' });
})();
`;
