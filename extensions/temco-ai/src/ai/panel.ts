// The `Temco AI` panel: the AI beside the page.
//
// A panel, not an application — it reads the page in the editor and the registry, and it decides nothing by
// itself. A draft arrives as a diff, and putting it into the page is a button a person presses. With no model
// installed the panel still opens and says what to do, so the extension never looks broken.

import * as vscode from 'vscode';
import { Catalog } from './store';
import { DocsRoot, PageEntry, Selection, collectPages, pageForUri } from '../docs';
import { entryById } from './catalog';
import {
  Candidate,
  PageContext,
  PROMPT_VERSION,
  areaPrompt,
  askPrompt,
  draftPrompt,
  systemPrompt,
  topicPrompt,
} from './prompts';
import { resolveCitations, searchPages } from './citations';
import { ChangeRange, readChangeRange } from './history';
import { ChatMessage, aiStatus, complete } from './runtime';

export const AI_VIEW_ID = 'temcoAi.panel';
/** How many earlier turns are resent: enough for a follow-up, small enough to stay cheap and fast. */
const HISTORY_TURNS = 6;
/** The most candidate pages one area question may carry. Headings only, so the prompt stays bounded. */
const AREA_CANDIDATES = 40;
/** The most page text one request may carry. Past this a draft would be a truncated page, which is worse than none. */
const MAX_BODY = 100_000;
/** An answer is a few sentences; a draft is a whole page. Both are bounded so a request cannot run away. */
const ANSWER_TOKENS = 1024;
const DRAFT_TOKENS = 2048;

const DEFAULT_DRAFT_NOTE =
  'No description of the change was given. Review the page against its own headings and propose the update ' +
  'that makes it accurate and complete.';

interface Turn {
  role: 'user' | 'assistant';
  text: string;
}

export class AiPanel implements vscode.WebviewViewProvider {
  private view?: vscode.WebviewView;
  /**
   * Messages written before the view exists.
   *
   * A question can be asked from another surface — a forum thread — before this panel has ever been on screen. The
   * answer is streamed as it arrives, so the messages have to wait for the view rather than be dropped on the way.
   */
  private queue: unknown[] = [];
  private turns: Turn[] = [];
  private busy = false;
  private draft?: { page: PageEntry; text: string };
  private cancelling?: vscode.CancellationTokenSource;

  constructor(
    private readonly context: vscode.ExtensionContext,
    private readonly roots: () => readonly DocsRoot[],
    private readonly selection: Selection
  ) { }

  resolveWebviewView(view: vscode.WebviewView): void {
    this.view = view;
    view.webview.options = {
      enableScripts: true,
      localResourceRoots: [vscode.Uri.joinPath(this.context.extensionUri, 'media')],
    };
    view.webview.html = this.html(view.webview);
    view.onDidDispose(() => {
      this.view = undefined;
    });
    view.webview.onDidReceiveMessage((message: unknown) => void this.receive(message));
    this.refresh();
    this.flush();
  }

  /** Whether the conversation is on screen right now, which is what makes the panel's open a toggle. */
  isVisible(): boolean {
    return this.view?.visible === true;
  }

  /** Re-states what the header shows: the page, the model, whether a draft is waiting. */
  refresh(): void {
    const page = this.page();
    const status = aiStatus(this.context);
    this.post({
      type: 'state',
      page: page
        ? { title: page.title, id: page.id, stale: page.provenance?.stale === true }
        : undefined,
      // Which project the question is about, in the panel rather than in the reader's head: the pages this
      // answers from are the selected project's, so a panel that did not say so would be answering about
      // something the reader cannot see.
      project: this.selection.project(),
      model: status.model ? entryById(status.model.id)?.label ?? status.model.id : undefined,
      runtimeReady: status.runtime !== undefined,
      version: PROMPT_VERSION,
      busy: this.busy,
      canApply: this.draft !== undefined,
    });
  }

  /**
   * A new chat: the transcript is cleared on both sides.
   *
   * The turns are what a follow-up is answered from, so they are dropped here rather than only hidden — a new chat
   * that still sent the old conversation would be a lie. What the panel is *about* (the page, the model) is not
   * forgotten: the same page stays in front.
   */
  private newChat(): void {
    if (this.busy) {
      this.post({ type: 'note', text: 'Stop the answer in flight first, then start a new chat.' });
      return;
    }
    this.turns = [];
    this.draft = undefined;
    this.post({ type: 'reset' });
    this.refresh();
  }

  private async receive(message: unknown): Promise<void> {
    const data = message as { type?: string; text?: string; id?: string };
    switch (data.type) {
      case 'ask':
        await this.run('ask', data.text?.trim() ?? '');
        return;
      case 'newChat':
        this.newChat();
        return;
      case 'draft':
        await this.run('draft', data.text?.trim() ?? '');
        return;
      case 'area': {
        let question = data.text?.trim() ?? '';
        if (question.length === 0) {
          question =
            (await vscode.window.showInputBox({
              title: 'Ask the area',
              prompt: 'What should the AI look for across this documentation area?',
            })) ?? '';
        }
        if (question.length > 0) {
          await this.run('area', question);
        }
        return;
      }
      case 'open': {
        const wanted = data.id ?? '';
        const page = this.roots()
          .flatMap((root) => collectPages(root))
          .find((entry) => entry.id === wanted);
        if (page) {
          await vscode.window.showTextDocument(page.uri, { preview: false });
        }
        return;
      }
      case 'apply':
        await this.apply();
        return;
      case 'models':
        // The page, not the quick pick: choosing a model is downloading one, and that needs the page's room to
        // read what each model needs. The quick pick stays where it belongs — behind its own command and the
        // page's own "list a keyboard user gets" button.
        await vscode.commands.executeCommand('temcoAi.page', 'downloads');
        this.refresh();
        return;
      case 'stop':
        this.cancelling?.cancel();
        return;
      default:
        return;
    }
  }

  /**
   * Answers one forum thread where the reader can see it.
   *
   * A question asked from a thread tab lands here rather than in a corner: the panel is brought up, the thread is
   * shown as the question, and the answer streams into the same transcript a typed question uses — so the reader can
   * read it, stop it, or follow it up. The text comes back as well, because the documentation module keeps the
   * suggestion in its catalog and cannot read a webview.
   */
  async answerTopic(request: {
    title: string;
    excerpt: string;
    thread: string;
    pageId?: string;
    pageTitle?: string;
    url?: string;
  }): Promise<string> {
    if (this.busy) {
      this.post({ type: 'note', text: 'The panel is answering something else. Wait for it, or press Stop, then ask again.' });
      return '';
    }
    const question = `What should the documentation do about the forum thread “${request.title}”${
      request.url === undefined ? '' : ` — ${request.url}`
    }?`;
    this.post({ type: 'user', text: question });
    // The panel may never have been opened: bring it up first, so the answer lands where a person can see it.
    await vscode.commands.executeCommand('workbench.view.extension.temcoAi');
    await vscode.commands.executeCommand(`${AI_VIEW_ID}.focus`);

    const status = aiStatus(this.context);
    if (!status.runtime || !status.model) {
      this.post({
        type: 'note',
        text: 'No local model yet. Use “Models…” to download the runtime and a model — once they are on the disk, nothing leaves this machine.',
        models: true,
      });
      return '';
    }

    this.busy = true;
    this.refresh();
    this.post({ type: 'start' });
    this.post({ type: 'busy', busy: true });
    const tokenSource = new vscode.CancellationTokenSource();
    this.cancelling = tokenSource;
    let streamed = '';
    try {
      const answer = await complete(
        this.context,
        [
          { role: 'system', content: systemPrompt(this.context, undefined) },
          {
            role: 'user',
            content: topicPrompt(this.context, {
              title: request.title,
              excerpt: request.excerpt,
              thread: request.thread,
              pageId: request.pageId,
              pageTitle: request.pageTitle,
            }),
          },
        ],
        {
          onToken: (piece) => {
            streamed += piece;
            this.post({ type: 'chunk', text: piece });
          },
          token: tokenSource.token,
          maxTokens: ANSWER_TOKENS,
        }
      );
      const text = (answer.text || streamed).trim();
      if (text.length === 0) {
        this.post({ type: 'note', text: 'The model returned nothing. Try again, or a different model.' });
        return '';
      }
      this.remember(question, text);
      this.verify(text, question, 'topic');
      return text;
    } catch (error) {
      this.post({ type: 'error', text: messageOf(error) });
      return '';
    } finally {
      tokenSource.dispose();
      this.cancelling = undefined;
      this.busy = false;
      this.post({ type: 'end' });
      this.post({ type: 'busy', busy: false });
      this.refresh();
    }
  }

  private async run(kind: 'ask' | 'area' | 'draft', question: string): Promise<void> {
    if (this.busy) {
      return;
    }
    const status = aiStatus(this.context);
    if (!status.runtime || !status.model) {
      this.post({
        type: 'note',
        text: 'No local model yet. Use “Models…” to download the runtime and a model — once they are on the disk, nothing leaves this machine.',
        models: true,
      });
      return;
    }

    const entry = this.page();
    if (kind === 'draft' && !entry) {
      this.post({ type: 'note', text: 'Open the page you want a draft for, then press Draft update.' });
      return;
    }

    const page = await this.pageContext(entry);
    // A draft is a whole page. If the page did not fit, applying a draft would delete whatever was cut.
    if (kind === 'draft' && page?.truncated) {
      this.post({
        type: 'note',
        text:
          `This page is longer than one draft can carry (over ${MAX_BODY.toLocaleString('en-US')} characters). ` +
          'Nothing was changed — split the page, or edit it by hand.',
      });
      return;
    }
    // A draft is *about a change*, so the change is read before anything is asked.
    const range = kind === 'draft' && entry ? await this.changeRange(entry) : undefined;
    this.busy = true;
    this.refresh();
    this.post({ type: 'user', text: this.label(kind, question) });
    this.post({ type: 'start' });
    this.post({ type: 'busy', busy: true });

    const tokenSource = new vscode.CancellationTokenSource();
    this.cancelling = tokenSource;
    let streamed = '';
    try {
      const messages = this.messages(kind, question, page, entry, range);
      const answer = await complete(this.context, messages, {
        onToken: (piece) => {
          streamed += piece;
          this.post({ type: 'chunk', text: piece });
        },
        token: tokenSource.token,
        maxTokens: kind === 'draft' ? DRAFT_TOKENS : ANSWER_TOKENS,
      });
      const text = (answer.text || streamed).trim();
      if (text.length === 0) {
        this.post({ type: 'note', text: 'The model returned nothing. Try again, or a different model.' });
      } else if (kind === 'draft') {
        this.remember(question, text);
        await this.showDraft(text, entry, range);
      } else {
        this.remember(question, text);
        this.verify(text, question, kind);
      }
    } catch (error) {
      this.post({ type: 'error', text: messageOf(error) });
    } finally {
      tokenSource.dispose();
      this.cancelling = undefined;
      this.busy = false;
      this.post({ type: 'end' });
      this.post({ type: 'busy', busy: false });
      this.refresh();
    }
  }

  /** The commits that prompted this draft — or a plain statement that none could be read. */
  private async changeRange(entry: PageEntry): Promise<ChangeRange> {
    const root = this.rootOf(entry);
    if (!root) {
      return {
        commits: 0,
        label: 'no range — the page is not inside an open repository',
        text: '(no change history was read)',
      };
    }
    return readChangeRange(root, entry);
  }

  /** A draft is shown against the page it came from, never written straight into it. */
  private async showDraft(
    text: string,
    entry: PageEntry | undefined,
    range: ChangeRange | undefined
  ): Promise<void> {
    if (!entry) {
      return;
    }
    this.draft = { page: entry, text };
    const draft = await vscode.workspace.openTextDocument({ content: text, language: 'markdown' });
    const commits = range ? `, ${range.commits} commit${range.commits === 1 ? '' : 's'}` : '';
    await vscode.commands.executeCommand(
      'vscode.diff',
      entry.uri,
      draft.uri,
      `${entry.title} ↔ draft (${PROMPT_VERSION}${commits})`
    );
    this.post({
      type: 'note',
      text:
        `Draft from ${PROMPT_VERSION}${range ? ` · ${range.label}` : ''}. ` +
        'Read the diff: Apply replaces the whole page. In a clone it lands as an uncommitted patch with Undo; ' +
        'in this window\'s own tree, one Ctrl+Z takes it back.',
    });
    // Kept in the catalog as well as on screen: a diff tab is closed by accident, and the Review Center is where
    // a draft is meant to wait until somebody settles it.
    void vscode.commands.executeCommand('temcoDocs.recordDraft', {
      pageId: entry.id,
      title: entry.title,
      body: text,
      kind: 'Draft',
    });
  }

  private async apply(): Promise<void> {
    const draft = this.draft;
    if (!draft) {
      return;
    }
    const text = draft.text.endsWith('\n') ? draft.text : `${draft.text}\n`;
    // A page inside a clone the catalog knows is written as an uncommitted patch in that clone's working tree: `git
    // apply` is what makes it visible to `git status` and reversible by the very patch that carried it. That path asks
    // its own question and offers its own Undo, so a file that comes back `applied` needs nothing more from here.
    const outcome = await this.writeToSource(draft.page.uri.fsPath, text);
    if (outcome === 'applied') {
      this.post({ type: 'note', text: 'The draft was applied to the clone. It is in the working tree, not committed.' });
      this.settle(draft);
      return;
    }
    // Cancelled or refused already said so, in the dialog and in its own notification.
    if (outcome !== 'outside') {
      return;
    }
    // The page is in no clone, so it is a file of the tree this window has open. Writing it is the editor's edit — and
    // the editor's undo — behind the same question, which is what keeps a project's own tree out of a silent write.
    const answer = await vscode.window.showWarningMessage(
      `Replace the whole of "${draft.page.title}" with the draft?`,
      { modal: true, detail: `The draft came from ${PROMPT_VERSION}. The edit is a normal, undoable change, and nothing is committed.` },
      'Replace'
    );
    if (answer !== 'Replace') {
      return;
    }
    // Opening the document first is what gives the change an undo history to live in.
    const document = await vscode.workspace.openTextDocument(draft.page.uri);
    await vscode.window.showTextDocument(document, { preview: false });
    const edit = new vscode.WorkspaceEdit();
    const last = document.lineAt(document.lineCount - 1).range.end;
    edit.replace(draft.page.uri, new vscode.Range(new vscode.Position(0, 0), last), text);
    if (await vscode.workspace.applyEdit(edit)) {
      this.post({ type: 'note', text: 'The draft was applied. Ctrl+Z takes it back.' });
      this.settle(draft);
    } else {
      this.post({ type: 'error', text: 'The editor refused the edit; nothing was changed.' });
    }
  }

  /** One decision, one row: the draft is spent, so the copy of it waiting in the queue is settled too. */
  private settle(draft: { page: { id: string } }): void {
    this.draft = undefined;
    void vscode.commands.executeCommand('temcoDocs.settlePage', draft.page.id);
    this.refresh();
  }

  /**
   * Asks the repositories module to land this text in the clone that holds `file`.
   *
   * `outside` is not a failure: it is the answer "this file is in no clone", and the caller then owns the edit. A
   * module that is not installed answers the same way, because losing a draft to a missing dependency would be worse
   * than writing it where the person can see it.
   */
  private async writeToSource(file: string, text: string): Promise<'applied' | 'cancelled' | 'failed' | 'outside'> {
    try {
      const answer = await vscode.commands.executeCommand<{ state?: string } | undefined>(
        'temcoRepositories.applyToSource',
        { path: file, text }
      );
      const state = answer?.state;
      return state === 'applied' || state === 'cancelled' || state === 'failed' ? state : 'outside';
    } catch {
      return 'outside';
    }
  }

  /**
   * What the model is allowed to see: the page, and for an area question the titles and headings of its
   * neighbours. Nothing else — no other file, no repository sweep, no path outside the documentation.
   */
  private messages(
    kind: 'ask' | 'area' | 'draft',
    question: string,
    page: PageContext | undefined,
    entry: PageEntry | undefined,
    range: ChangeRange | undefined
  ): ChatMessage[] {
    const messages: ChatMessage[] = [{ role: 'system', content: systemPrompt(this.context, page) }];
    for (const turn of this.turns.slice(-HISTORY_TURNS)) {
      messages.push({ role: turn.role, content: turn.text });
    }
    switch (kind) {
      case 'ask':
        messages.push({ role: 'user', content: askPrompt(this.context, question, page) });
        break;
      case 'area':
        messages.push({
          role: 'user',
          content: areaPrompt(this.context, question, page, this.candidates(entry)),
        });
        break;
      case 'draft':
        if (page) {
          messages.push({
            role: 'user',
            content: draftPrompt(
              this.context,
              page,
              range?.text ?? '(no change history was read)',
              question || DEFAULT_DRAFT_NOTE
            ),
          });
        }
        break;
    }
    return messages;
  }

  /** How an action reads in the transcript, where the model never sees it. */
  private label(kind: 'ask' | 'area' | 'draft', question: string): string {
    if (kind === 'draft') {
      return question ? `Draft update — ${question}` : 'Draft update — what has changed?';
    }
    if (kind === 'area') {
      return `Ask the area — ${question}`;
    }
    return question;
  }

  private remember(question: string, answer: string): void {
    this.turns.push({ role: 'user', text: question }, { role: 'assistant', text: answer });
  }

  /**
   * What the answer pointed at.
   *
   * A name that is not a page is reported rather than believed. And when an area answer cites nothing at all,
   * the pages whose words match the question are offered instead of the synthesis — the design's rule for a
   * low-confidence answer, and the honest thing to do with a small model.
   */
  private verify(text: string, question: string, kind: 'ask' | 'area' | 'draft' | 'topic'): void {
    if (kind === 'draft') {
      return;
    }
    const pages = this.roots().flatMap((root) => collectPages(root));
    const { known, unknown } = resolveCitations(text, pages);

    if (known.length > 0) {
      this.post({
        type: 'citations',
        items: known.map((page) => ({
          id: page.id,
          title: page.title,
          stale: page.provenance?.stale === true,
        })),
      });
    }
    if (unknown.length > 0) {
      this.post({
        type: 'note',
        text:
          `${unknown.join(', ')} ${unknown.length === 1 ? 'is not a page' : 'are not pages'} in this ` +
          'documentation set. Treat anything they claim with suspicion.',
      });
    }
    if (kind === 'area' && known.length === 0) {
      const results = searchPages(pages, question, 5);
      if (results.length > 0) {
        this.post({
          type: 'results',
          text: 'That answer named no page, so here are the pages whose words match the question:',
          items: results.map((page) => ({
            id: page.id,
            title: page.title,
            stale: page.provenance?.stale === true,
          })),
        });
      }
    }

    // Kept, so the citations can be read back after the answer has been scrolled away: a page a draft or an answer
    // relied on is a fact about this documentation set, not only about the one conversation.
    void this.keepCitations(kind, known, unknown);
  }

  /**
   * Writes what an answer cited into the platform's own record.
   *
   * The ids only — never the question or the answer. A citation is a pointer, and a conversation is not something
   * this platform keeps.
   */
  private async keepCitations(
    kind: 'ask' | 'area' | 'draft' | 'topic',
    known: readonly PageEntry[],
    unknown: readonly string[]
  ): Promise<void> {
    if (known.length === 0 && unknown.length === 0) {
      return;
    }
    let catalog: Catalog | undefined;
    try {
      catalog = await Catalog.open();
      catalog.recordCitations({
        answerKind: kind === 'area' ? 'answer' : kind,
        documentSlug: this.selection.project(),
        pageId: this.page()?.id,
        citations: [
          ...known.map((page) => ({ id: page.id, known: true })),
          ...unknown.map((id) => ({ id, known: false })),
        ],
      });
    } catch {
      // No catalogue, no record: the answer has already been given, and this is its footnote rather than its body.
    } finally {
      catalog?.close();
    }
  }

  /** The page's own chapter first, then the rest of its area: the pages a question is most likely about. */
  private candidates(entry: PageEntry | undefined): Candidate[] {
    if (!entry) {
      return [];
    }
    const root = this.rootOf(entry);
    if (!root) {
      return [];
    }
    const pages = collectPages(root);
    const rank = (page: PageEntry): number =>
      page.chapter === entry.chapter ? 0 : page.area === entry.area ? 1 : 2;
    return pages
      .sort((a, b) => rank(a) - rank(b) || a.title.localeCompare(b.title))
      .slice(0, AREA_CANDIDATES)
      .map((page) => ({
        id: page.id,
        title: page.title,
        headings: page.provenance?.headings ?? [],
        stale: page.provenance?.stale === true,
      }));
  }

  private rootOf(entry: PageEntry): DocsRoot | undefined {
    const wanted = entry.uri.toString();
    return this.roots().find((root) =>
      collectPages(root).some((page) => page.uri.toString() === wanted)
    );
  }

  private page(): PageEntry | undefined {
    const uri = vscode.window.activeTextEditor?.document.uri;
    if (uri && uri.scheme === 'file') {
      const open = pageForUri(this.roots(), uri);
      if (open) {
        return open;
      }
    }
    // Nothing of ours is open in an editor — so the page the project remembers stands in, when the roots being
    // read contain it. That is what lets a question be asked from the hub, about the page you were just on,
    // without a text editor being open at all.
    const remembered = this.selection.page();
    if (remembered?.path !== undefined) {
      return pageForUri(this.roots(), vscode.Uri.file(remembered.path));
    }
    return undefined;
  }

  private async pageContext(entry: PageEntry | undefined): Promise<PageContext | undefined> {
    if (!entry) {
      return undefined;
    }
    const editor = vscode.window.activeTextEditor;
    let body = '';
    if (editor && editor.document.uri.toString() === entry.uri.toString()) {
      body = editor.document.getText();
    } else {
      try {
        body = Buffer.from(await vscode.workspace.fs.readFile(entry.uri)).toString('utf8');
      } catch {
        body = '';
      }
    }
    return {
      id: entry.id,
      title: entry.title,
      path: vscode.workspace.asRelativePath(entry.uri),
      area: entry.area,
      chapter: entry.chapter,
      owner: entry.owner,
      audience: entry.audience,
      reviewed: entry.reviewed,
      updated: entry.provenance?.updated ?? null,
      stale: entry.provenance?.stale === true,
      headings: entry.provenance?.headings ?? [],
      truncated: body.length > MAX_BODY,
      body: body.length > MAX_BODY ? body.slice(0, MAX_BODY) : body,
    };
  }

  private post(message: unknown): void {
    if (this.view === undefined) {
      // Bounded: a panel that is never opened must not grow a transcript in memory.
      if (this.queue.length < 500) {
        this.queue.push(message);
      }
      return;
    }
    void this.view.webview.postMessage(message);
  }

  private flush(): void {
    const queued = this.queue;
    this.queue = [];
    for (const message of queued) {
      void this.view?.webview.postMessage(message);
    }
  }

  private html(webview: vscode.Webview): string {
    const script = webview.asWebviewUri(
      vscode.Uri.joinPath(this.context.extensionUri, 'media', 'ai-panel.js')
    );
    const style = webview.asWebviewUri(
      vscode.Uri.joinPath(this.context.extensionUri, 'media', 'ai-panel.css')
    );
    return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src ${webview.cspSource}; script-src ${webview.cspSource};">
<link rel="stylesheet" href="${style}">
<title>Temco AI</title>
</head>
<body>
<div id="transcript"></div>
<template id="emptyTemplate">
  <div class="empty">
    <p class="lede">The AI answers about the page you have open, on this machine. Nothing it writes touches a file
    until you accept the diff.</p>

    <!-- What this panel is about right now: said first, because every act below needs it. -->
    <p class="reading" id="reading">No page open yet.</p>

    <!-- And what would stop all of it. A model is the one thing that has to be there before anything else can be. -->
    <p id="modelNote" class="hidden">No model is installed yet, so nothing below can run.
      <button type="button" id="chooseModel" class="choose">Choose a model&hellip;</button></p>

    <div class="guide">
      <section>
        <h4><svg viewBox="0 0 16 16" aria-hidden="true"><path d="M11.4 2.1l2.5 2.5M3 13l.9-3.6 7.1-7.1 2.5 2.5-7.1 7.1z"/></svg>Draft an update</h4>
        <p>The page in front, rewritten and handed back as a diff. The commits it read are named on the diff, and
        one undo takes it back.</p>
        <button type="button" class="ask" data-needs="page" data-text="Draft an update — say what changed since the last review">Draft an update — say what changed</button>
      </section>

      <section>
        <h4><svg viewBox="0 0 16 16" aria-hidden="true"><path d="M2.5 3.5h11v7h-6l-3 2.5v-2.5h-2z"/></svg>Ask about this page</h4>
        <p>An answer about the page in front, citing the pages it used so you can check it yourself.</p>
        <button type="button" class="ask" data-needs="page" data-text="What does this page leave out?">What does this page leave out?</button>
      </section>

      <section>
        <h4><svg viewBox="0 0 16 16" aria-hidden="true"><path d="M8 2.2l5.2 2.6L8 7.4 2.8 4.8z"/><path d="M2.8 7.6L8 10.2l5.2-2.6"/><path d="M2.8 10.4L8 13l5.2-2.6"/></svg>Ask across the area</h4>
        <p>The pages around this one — its area and its tags. When it has only search results it says so, rather
        than guessing.</p>
        <button type="button" class="ask" data-needs="project" data-text="Which pages in this area describe the same thing as this one?">Which pages here overlap with this one?</button>
      </section>
    </div>
  </div>
</template>
<form id="form">
  <div class="box" id="box">
    <textarea id="text" rows="1" placeholder="Chat about the open page&hellip;" aria-label="Message"></textarea>
    <div class="row">
      <button id="newChat" type="button" class="action action--icon" title="Start a new chat">
        <svg viewBox="0 0 16 16" aria-hidden="true"><path d="M8 3.2v9.6M3.2 8h9.6"/></svg>
      </button>
      <div class="left">
        <button id="draft" type="button" class="action" title="Draft an update to this page — it opens as a diff you accept">
          <svg viewBox="0 0 16 16" aria-hidden="true"><path d="M11.4 2.1l2.5 2.5M3 13l.9-3.6 7.1-7.1 2.5 2.5-7.1 7.1z"/></svg><span class="label">Draft update</span>
        </button>
        <button id="area" type="button" class="action" title="Ask about the pages around this one">
          <svg viewBox="0 0 16 16" aria-hidden="true"><path d="M8 2.2l5.2 2.6L8 7.4 2.8 4.8z"/><path d="M2.8 7.6L8 10.2l5.2-2.6"/><path d="M2.8 10.4L8 13l5.2-2.6"/></svg><span class="label">Ask the area</span>
        </button>
        <button id="apply" type="button" class="action hidden" title="Replace the page with the draft — one undo takes it back">
          <svg viewBox="0 0 16 16" aria-hidden="true"><path d="M3 8.4l3.2 3.2L13 4.8"/></svg><span class="label">Apply draft</span>
        </button>
      </div>
      <button id="models" type="button" class="model" title="Which local model answers, and what is installed">
        <svg viewBox="0 0 16 16" aria-hidden="true"><rect x="3.5" y="3.5" width="9" height="9" rx="2"/><path d="M8 1.5v2M8 12.5v2M1.5 8h2M12.5 8h2"/></svg><span id="model">nothing installed</span>
      </button>
      <button id="send" type="submit" class="send" title="Ask about this page (Enter)">
        <svg class="icon-send" viewBox="0 0 16 16" aria-hidden="true"><path d="M8 13V3.4"/><path d="M3.8 7.6L8 3.4l4.2 4.2"/></svg>
        <svg class="icon-stop hidden" viewBox="0 0 16 16" aria-hidden="true"><rect x="5" y="5" width="6" height="6" rx="1.2"/></svg>
      </button>
    </div>
  </div>
</form>
<div id="status">
  <span class="dot" id="dot"></span>
  <span>Local</span>
  <span class="sep">&middot;</span>
  <span>nothing leaves this machine</span>
  <span class="where">
    <svg viewBox="0 0 16 16" aria-hidden="true"><path d="M4 1.5h5.2L12.5 4.8v9.7h-8.5z"/><path d="M9.2 1.5v3.3h3.3"/></svg>
    <span id="where">no page open</span>
  </span>
</div>
<script src="${script}"></script>
</body>
</html>`;
  }
}

function messageOf(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
