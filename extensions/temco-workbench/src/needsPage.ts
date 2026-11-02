// The page behind the Library's *Needs attention* row: everything that wants a person, in one place.
//
// This is the merge of the old **Work** view, and it exists because of what that view got wrong: it was a second
// copy of the tree's own *Gaps* list plus a counter, in a third place, behind an icon that meant five different
// things at once. So the sidebar keeps one expandable row — a count and the first few items — and this page has
// the room to say *why* each thing is listed and *where* the fix is.
//
// One rule is load-bearing here: **nothing on this page is computed twice.** Structural faults come from the
// checks `registry.ts` runs on the working tree; staleness is the *generator's* verdict, read from `index.json`
// and never recomputed; and "documentation owed" is the product repository's own `docs:owed` check, which this
// page only runs. Its output is the verdict — this page does not parse it, and says so.

import * as vscode from 'vscode';
import { DocsRoot, collectPages, countStale, scriptsIn } from './docs';
import { OFFERED_SCRIPTS } from './repositories';
import { Catalog, DraftRow, selection } from './store';
import { NEEDS_VIEW_TYPE } from './surface';
import { commandScript, escapeHtml, icon, page, pageColumn, runCommand, toneMark } from './ui';

/** What the last run of one of the repository's own scripts left behind. */
interface ScriptRun {
  folder: string;
  script: string;
  exit: number | undefined;
  at: string;
  rewritten: string[];
}

/**
 * The vertical indicator every section title carries across the platform.
 *
 * This page is one long list of seven parts, and the part a reader is in is the group head — so the head is what the
 * bar marks. It is stated here rather than in the kit because the kit's own group head is a hairline rule, which the
 * pages that list records keep.
 */
const NEEDS_CSS = `
.group-head__label { position: relative; padding-left: 10px; }
.group-head__label::before { content: ''; position: absolute; left: 0; top: 50%; transform: translateY(-50%); width: 2px; height: 12px; border-radius: 1px; background: var(--accent, #0078d4); }
`;

export class NeedsPage {
  private panel: vscode.WebviewPanel | undefined;
  /** The last run of each script, by id — this session only: a run is a thing that happened, not state. */
  private readonly runs = new Map<string, ScriptRun>();

  constructor(
    private readonly context: vscode.ExtensionContext,
    private readonly roots: () => readonly DocsRoot[]
  ) { }

  open(restored?: vscode.WebviewPanel): void {
    if (this.panel) {
      this.panel.reveal(pageColumn());
      this.seed();
      return;
    }

    // A restored tab is drawn into rather than replaced: it keeps its place in the strip.
    this.panel = restored ?? vscode.window.createWebviewPanel(NEEDS_VIEW_TYPE, 'What needs doing', pageColumn(), {
      enableScripts: true,
      localResourceRoots: [],
    });
    this.panel.webview.options = { enableScripts: true, localResourceRoots: [] };
    this.panel.iconPath = vscode.Uri.joinPath(this.context.extensionUri, 'media', 'docs.svg');
    // A button on the page names a command and, when it needs one, its arguments; the same script every page of ours
    // runs. A script run is remembered here rather than in the page, because a run is a thing that happened.
    this.panel.webview.onDidReceiveMessage(async (message: { type?: string; command?: string; args?: unknown }) => {
      if (message.command === 'temcoDocs.runScript' && typeof message.args === 'string') {
        const result = await vscode.commands.executeCommand<ScriptRun | undefined>('temcoDocs.runScript', message.args);
        if (result) {
          this.runs.set(message.args, result);
        }
      } else {
        runCommand(message);
      }
      this.seed();
    });
    this.panel.onDidDispose(() => {
      this.panel = undefined;
    });
    this.seed();
  }

  /** Re-renders if it is open. Called by the refresh path, so the page follows the workspace. */
  refresh(): void {
    if (this.panel) {
      this.seed();
    }
  }

  private async seed(): Promise<void> {
    if (!this.panel) {
      return;
    }

    const roots = this.roots();
    const scriptsPresent = scriptsIn(roots);
    const sources: {
      name: string;
      origin: string;
      pages: number;
      errors: number;
      warnings: number;
      neverReviewed: number;
      stale: number;
      unowned: number;
      missing: number;
      folder?: string;
      owed: boolean;
    }[] = [];

    const faults: { root: string; id: string; title: string; owner: string; path?: string; severity: string; message: string }[] = [];
    const missing: { root: string; id: string; title: string; path: string }[] = [];
    const stale: { root: string; id: string; title: string; owner: string; changed?: string; path?: string }[] = [];
    const unowned: { root: string; id: string; title: string; path?: string }[] = [];

    for (const root of roots) {
      const pages = collectPages(root);
      const local = root.origin !== 'catalog';
      const path = (uri: vscode.Uri): string | undefined => (uri.scheme === 'file' ? uri.fsPath : undefined);

      sources.push({
        name: root.folder.name,
        origin: root.origin === 'catalog' ? 'read from the source' : 'on this machine',
        pages: root.pages,
        errors: root.errors,
        warnings: root.warnings,
        neverReviewed: root.neverReviewed,
        stale: countStale(pages),
        unowned: pages.filter((page) => page.owner.length === 0).length,
        missing: pages.filter((page) => !page.exists).length,
        folder: path(root.rootUri),
        owed: root.origin !== 'catalog',
      });

      for (const page of pages) {
        if (!page.exists) {
          missing.push({ root: root.folder.name, id: page.id, title: page.title, path: page.uri.fsPath });
        }
        for (const issue of page.issues) {
          faults.push({
            root: root.folder.name,
            id: page.id,
            title: page.title,
            owner: page.owner,
            path: path(page.uri),
            severity: issue.severity,
            message: issue.message,
          });
        }
        if (page.provenance?.stale === true) {
          stale.push({
            root: root.folder.name,
            id: page.id,
            title: page.title,
            owner: page.owner,
            changed: page.provenance.updated ?? page.provenance.git?.date,
            path: path(page.uri),
          });
        }
        if (page.owner.length === 0 && local) {
          unowned.push({ root: root.folder.name, id: page.id, title: page.title, path: path(page.uri) });
        }
      }
    }

    const scripts = OFFERED_SCRIPTS
      .filter((script) => scriptsPresent.has(script.id))
      .map((script) => ({ id: script.id, label: script.label, detail: script.detail, run: this.runs.get(script.id) }));
    const errors = faults.filter((fault) => fault.severity === 'error').length;
    const drafts = await draftsWaiting(this.context);

    const fact = (label: string, value: string): string =>
      `<div><div class="settings-strip__label">${escapeHtml(label)}</div><div class="settings-strip__value">${escapeHtml(value)}</div></div>`;

    const rule = (label: string, count: string, actions = ''): string =>
      `<div class="group-head"><span class="group-head__label">${escapeHtml(label)}</span><span class="group-head__rule"></span><span class="group-head__count">${escapeHtml(count)}</span>${actions ? `<span class="group-head__actions">${actions}</span>` : ''}</div>`;

    const sourceRow = (source: (typeof sources)[number]): string => {
      const facts = [`${source.pages} pages`, `${source.errors} errors`, `${source.warnings} warnings`, `${source.stale} stale`, `${source.unowned} unowned`, `${source.missing} missing`];
      return `<div class="record-row record-row--static">
	${toneMark('folder', source.errors > 0 ? 'err' : source.warnings > 0 ? 'warn' : undefined)}
	<div class="record-row__main">
		<div class="record-row__title"><span class="record-row__name">${escapeHtml(source.name)}</span></div>
		<div class="record-row__meta">${facts.map((entry, index) => `<span>${escapeHtml(entry)}${index < facts.length - 1 ? ' ·' : ''}</span>`).join(' ')}</div>
	</div>
	<div class="record-row__state"><span class="cell-muted">${escapeHtml(source.origin)}</span></div>
	<span class="record-row__go"></span>
</div>`;
    };

    const openArgs = (path: string | undefined, id: string, title: string): string =>
      escapeHtml(JSON.stringify({ path, id, title }));

    const faultRow = (fault: (typeof faults)[number]): string =>
      `<div class="record-row record-row--static" data-command="temcoRepositories.openFile" data-args="${openArgs(fault.path, fault.id, fault.title)}">
	${toneMark(fault.severity === 'error' ? 'error' : 'warning', fault.severity === 'error' ? 'err' : 'warn')}
	<div class="record-row__main">
		<div class="record-row__title"><span class="record-row__name">${escapeHtml(fault.title)}</span><span class="cell-muted cell-mono">${escapeHtml(fault.id)}</span></div>
		<div class="record-row__meta"><span>${escapeHtml(fault.message)}</span></div>
	</div>
	<div class="record-row__state"><span class="cell-muted">${escapeHtml(fault.owner || 'no owner')}</span></div>
	<span class="record-row__go">›</span>
</div>`;

    const missingRow = (entry: (typeof missing)[number]): string =>
      `<div class="record-row record-row--static">
	${toneMark('document', 'warn')}
	<div class="record-row__main">
		<div class="record-row__title"><span class="record-row__name">${escapeHtml(entry.title)}</span><span class="cell-muted cell-mono">${escapeHtml(entry.id)}</span></div>
		<div class="record-row__meta"><span class="cell-mono">${escapeHtml(entry.path)}</span></div>
	</div>
	<div class="record-row__state"><button type="button" class="btn btn--sm" data-command="temcoDocs.createPage" data-args="${escapeHtml(JSON.stringify({ path: entry.path, title: entry.title }))}"><span>Create the File</span></button></div>
	<span class="record-row__go"></span>
</div>`;

    const staleRow = (entry: (typeof stale)[number]): string =>
      `<div class="record-row record-row--static" data-command="temcoRepositories.openFile" data-args="${openArgs(entry.path, entry.id, entry.title)}">
	${toneMark('clock', 'warn')}
	<div class="record-row__main">
		<div class="record-row__title"><span class="record-row__name">${escapeHtml(entry.title)}</span></div>
		<div class="record-row__meta"><span>${escapeHtml(entry.owner || 'no owner')}${entry.changed === undefined ? '' : ` · changed ${escapeHtml(entry.changed)}`}</span></div>
	</div>
	<div class="record-row__state"></div>
	<span class="record-row__go">›</span>
</div>`;

    const unownedRow = (entry: (typeof unowned)[number]): string =>
      `<div class="record-row record-row--static" data-command="temcoRepositories.openFile" data-args="${openArgs(entry.path, entry.id, entry.title)}">
	${toneMark('users')}
	<div class="record-row__main">
		<div class="record-row__title"><span class="record-row__name">${escapeHtml(entry.title)}</span></div>
		<div class="record-row__meta"><span class="cell-mono">${escapeHtml(entry.id)}</span></div>
	</div>
	<div class="record-row__state"></div>
	<span class="record-row__go">›</span>
</div>`;

    const draftRow = (draft: DraftRow): string =>
      `<div class="record-row record-row--static">
	${toneMark('sparkle', 'accent')}
	<div class="record-row__main">
		<div class="record-row__title"><span class="record-row__name">${escapeHtml(draft.title)}</span><span class="cell-muted cell-mono">${escapeHtml(draft.pageId)}</span></div>
		<div class="record-row__meta"><span>${escapeHtml(draft.kind || 'draft')}</span> · <span>written ${escapeHtml(age(draft.createdAt))}</span>${draft.source === undefined ? '' : ` · <span>read from ${escapeHtml(draft.source)}</span>`}</div>
	</div>
	<div class="record-row__state">
		<button type="button" class="btn btn--sm btn--primary" data-command="temcoDocs.acceptDraft" data-args="${escapeHtml(String(draft.id))}"><span>Accept</span></button>
		<button type="button" class="btn btn--sm btn--ghost" data-command="temcoDocs.discardDraft" data-args="${escapeHtml(String(draft.id))}"><span>Discard</span></button>
	</div>
	<span class="record-row__go"></span>
</div>`;

    const scriptRow = (script: (typeof scripts)[number]): string => {
      const last = script.run === undefined
        ? 'not run in this session'
        : `ran ${script.run.at} · exit ${script.run.exit ?? '—'}`;
      return `<div class="record-row record-row--static">
	${toneMark('terminal', script.run === undefined ? undefined : script.run.exit === 0 ? 'ok' : 'err')}
	<div class="record-row__main">
		<div class="record-row__title"><span class="record-row__name">${escapeHtml(script.label)}</span></div>
		<div class="record-row__meta"><span>${escapeHtml(script.detail)}</span> · <span>${escapeHtml(last)}</span></div>
	</div>
	<div class="record-row__state"><button type="button" class="btn btn--sm btn--ghost" data-command="temcoDocs.runScript" data-args="${escapeHtml(JSON.stringify(script.id))}"><span>Run</span></button></div>
	<span class="record-row__go"></span>
</div>`;
    };

    const body = `
<div class="page-head">
	<div class="page-head__main">
		<div class="eyebrow">Temco Platform</div>
		<h1 class="page-head__title">${icon('check')}What Needs Doing</h1>
		<p class="page-head__desc">Everything that wants a person, from every source of the project being worked on — each row says what it is and where the fix is.</p>
	</div>
	<div class="page-head__actions">
		<button type="button" class="btn" data-command="temcoDocs.stalenessReport" title="The same pages, cut by the person who owes each one, as a Markdown report you can keep or send. It is made when you ask, and written nowhere."><span>Owner Report</span></button>
		<button type="button" class="btn" data-command="temcoProjects.projects.focus"><span>Projects</span></button>
	</div>
</div>

<div class="settings-strip settings-strip--wide">
	${fact('Errors', String(errors))}
	${fact('Warnings', String(faults.length - errors))}
	${fact('Missing files', String(missing.length))}
	${fact('Drafts waiting', String(drafts.length))}
	${fact('Stale', String(stale.length))}
	${fact('Unowned', String(unowned.length))}
	${fact('Sources', String(sources.length))}
</div>

<p class="group-note">The strip counts everything below. <b>Owner Report</b> is the same facts cut by the person who owes each page, as Markdown in an untitled editor — saving it is yours to decide, and it is the one thing here that leaves this window.</p>

<div class="mt-24">
	${rule('Drafts Waiting', drafts.length === 1 ? '1 draft' : `${drafts.length} drafts`, '<button type="button" class="btn btn--sm btn--ghost" data-command="temcoDocs.review"><span>Open the Queue</span></button>')}
	${drafts.length === 0
        ? '<p class="group-note">Nothing is waiting for a person. A draft is written by <b>New Page</b> → <b>Draft</b>, and lands here until somebody settles it.</p>'
        : `<div class="record-list">${drafts.map(draftRow).join('')}</div>`}
</div>

<div class="mt-24">
	${rule('Sources', sources.length === 1 ? '1 source' : `${sources.length} sources`)}
	${sources.length === 0
        ? '<p class="group-note">Nothing is being read yet — choose the project you are working on, and its sources will be read.</p>'
        : `<div class="record-list">${sources.map(sourceRow).join('')}</div>`}
</div>

<div class="mt-24">
	${rule('Faults', `${faults.length} found`)}
	${faults.length === 0
        ? '<p class="group-note">No structural fault: every declared page exists, and every link resolves.</p>'
        : `<div class="record-list">${faults.map(faultRow).join('')}</div>`}
</div>

<div class="mt-24">
	${rule('Declared, but the File Is Not There', `${missing.length} pages`)}
	${missing.length === 0
        ? '<p class="group-note">Every page the registry declares has a file.</p>'
        : `<div class="record-list">${missing.map(missingRow).join('')}</div>`}
</div>

<div class="mt-24">
	${rule('Stale', `${stale.length} pages`)}
	${stale.length === 0
        ? '<p class="group-note">Every page agrees with the code it claims to describe.</p>'
        : `<div class="record-list">${stale.map(staleRow).join('')}</div>`}
</div>

<div class="mt-24">
	${rule('No Owner', `${unowned.length} pages`)}
	${unowned.length === 0
        ? '<p class="group-note">Every page has someone to tell when it goes out of date.</p>'
        : `<div class="record-list">${unowned.map(unownedRow).join('')}</div>`}
</div>

<div class="mt-24">
	${rule("The Repository's Own Checks", `${scripts.length} scripts`)}
	<p class="group-note">Each of these is the repository's own npm script, run as a task in the folder being read — visible in the terminal, cancellable, and its output there is the verdict. This page says where a run happened, when, and what it exited with; it never interprets one.</p>
	${scripts.length === 0
        ? '<p class="group-note">This repository offers no documentation script of its own.</p>'
        : `<div class="record-list">${scripts.map(scriptRow).join('')}</div>`}
</div>`;

    this.panel.webview.html = page(body, { title: 'What needs doing', script: commandScript, extraCss: NEEDS_CSS });
  }
}

/**
 * The drafts a person has to settle.
 *
 * Read from the catalog, not from the registry: a draft is a proposal that has not been written anywhere yet, so
 * this is the one part of "what needs doing" that no folder can answer.
 */
async function draftsWaiting(context: vscode.ExtensionContext): Promise<DraftRow[]> {
  try {
    const catalog = await Catalog.open(context);
    try {
      const documents = catalog.documents();
      const project = selection.project() ?? (documents.length === 1 ? documents[0].slug : undefined);
      return project === undefined ? [] : catalog.drafts(project);
    } finally {
      catalog.close();
    }
  } catch {
    return [];
  }
}

/** How long a draft has been waiting, in words a reviewer reads at a glance. */
function age(iso: string): string {
  const at = new Date(iso).getTime();
  if (Number.isNaN(at)) {
    return 'just now';
  }
  const minutes = Math.floor((Date.now() - at) / 60_000);
  if (minutes < 1) {
    return 'just now';
  }
  if (minutes < 60) {
    return `${minutes} min ago`;
  }
  const hours = Math.floor(minutes / 60);
  if (hours < 24) {
    return `${hours} h ago`;
  }
  const days = Math.floor(hours / 24);
  return `${days} day${days === 1 ? '' : 's'} ago`;
}
