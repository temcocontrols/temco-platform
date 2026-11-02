// Overview — the documentation being read, in one page.
//
// Why it exists: the Workspace tree answers "where is this page"; it is a bad answer to "what am I looking at".
// This page is the second question in one screen — how many pages, which areas they are in, how much of it is stale,
// and which faults the checks found — every number computed from the same registry the tree reads, so the page and
// the tree cannot disagree.
//
// It is drawn with the shared page vocabulary (`temco-ui`), the way the guide is: the page composes, the UI module
// decides what a row, a rule and a badge look like.

import * as vscode from 'vscode';
import { DocsRoot, PageEntry, collectPages, countStale, totals } from './registry';
import { commandScript, escapeHtml, icon, page, pageColumn, runCommand, toneMark } from './ui';

/** The view type this page opens under. */
export const OVERVIEW_VIEW_TYPE = 'temcoDocs.overview';

export class OverviewPage {
	private panel: vscode.WebviewPanel | undefined;

	constructor(
		private readonly context: vscode.ExtensionContext,
		private readonly roots: () => readonly DocsRoot[]
	) { }

	/** Opens the page, or brings it forward if it is already open. `restored` is the tab the window gave back. */
	open(restored?: vscode.WebviewPanel): void {
		if (this.panel) {
			this.panel.reveal(pageColumn());
			this.render();
			return;
		}
		// A restored tab is drawn into rather than replaced: it keeps its place in the strip.
		this.panel = restored ?? vscode.window.createWebviewPanel(OVERVIEW_VIEW_TYPE, 'Documentation', pageColumn(), {
			enableScripts: true,
			localResourceRoots: []
		});
		this.panel.webview.options = { enableScripts: true, localResourceRoots: [] };
		this.panel.iconPath = vscode.Uri.joinPath(this.context.extensionUri, 'media', 'docs.svg');
		this.panel.onDidDispose(() => {
			this.panel = undefined;
		});
		this.panel.webview.onDidReceiveMessage(runCommand);
		this.render();
	}

	/** Re-renders if the page is open: a read, a project change or a page write all land here. */
	refresh(): void {
		this.render();
	}

	dispose(): void {
		this.panel?.dispose();
	}

	private render(): void {
		const panel = this.panel;
		if (!panel) {
			return;
		}
		panel.webview.html = page(html(this.roots()), { title: 'Documentation', script: commandScript });
	}
}

/** A fact with its label, on the strip under the page head. */
function fact(label: string, value: string): string {
	return `<div><div class="settings-strip__label">${escapeHtml(label)}</div><div class="settings-strip__value">${value}</div></div>`;
}

/** One area, with what it holds and what is wrong in it. */
function areaRow(area: DocsRoot['areas'][number]): string {
	const facts = [
		`${area.chapters.length} chapter${area.chapters.length === 1 ? '' : 's'}`,
		`${area.pages} pages`,
		area.audience
	];
	const badge = area.errors > 0
		? `<span class="badge badge--err">${area.errors} error${area.errors === 1 ? '' : 's'}</span>`
		: area.warnings > 0
			? `<span class="badge badge--warn">${area.warnings} warning${area.warnings === 1 ? '' : 's'}</span>`
			: '<span class="badge badge--ok">clean</span>';
	return `<div class="record-row record-row--static">
	${toneMark('folder', area.errors > 0 ? 'err' : area.warnings > 0 ? 'warn' : undefined)}
	<div class="record-row__main">
		<div class="record-row__title"><span class="record-row__name">${escapeHtml(area.title)}</span></div>
		<div class="record-row__meta">${facts.map((entry, index) => `<span>${escapeHtml(entry)}${index < facts.length - 1 ? ' ·' : ''}</span>`).join(' ')}</div>
	</div>
	<div class="record-row__state">${badge}</div>
	<span class="record-row__go"></span>
</div>`;
}

/** A page the generator says is behind its source. */
function staleRow(entry: PageEntry): string {
	return `<div class="record-row record-row--static">
	${toneMark('document', 'warn')}
	<div class="record-row__main">
		<div class="record-row__title"><span class="record-row__name">${escapeHtml(entry.title)}</span></div>
		<div class="record-row__meta"><span>${escapeHtml(entry.area)} · ${escapeHtml(entry.chapter)} · ${escapeHtml(entry.owner || 'no owner')}</span></div>
	</div>
	<div class="record-row__state"><span class="badge badge--warn">stale</span></div>
	<span class="record-row__go"></span>
</div>`;
}

function html(roots: readonly DocsRoot[]): string {
	const head = `<div class="page-head">
	<div class="page-head__main">
		<h1 class="page-head__title">${icon('book')}Documentation</h1>
		<p class="page-head__desc">The project being worked on: its areas, the pages in them, and what the checks found.</p>
	</div>
	<div class="page-head__actions">
		<button type="button" class="btn btn--primary" data-command="temcoDocs.pages.focus"><span>Open the Tree</span></button>
		<button type="button" class="btn" data-command="temcoDocs.newPage"><span>New Page</span></button>
	</div>
</div>`;

	if (roots.length === 0) {
		return `${head}
<div class="card">
	<div class="card__head"><div class="card__title">Nothing is being read yet</div></div>
	<p class="card__desc">A project is what names the sources, and a source is what has the pages. Choose the project you are working on, or create one.</p>
	<div class="card__body">
		<div class="row" style="gap:8px">
			<button type="button" class="btn btn--primary" data-command="temcoDocs.projects"><span>Projects</span></button>
		</div>
	</div>
</div>`;
	}

	const sums = totals(roots);
	const stale = roots.reduce((count, root) => count + countStale(collectPages(root)), 0);
	const areas = roots.flatMap((root) => root.areas.map((area) => areaRow(area)));
	const stalePages = roots.flatMap((root) => collectPages(root).filter((entry) => entry.provenance?.stale === true));
	const shown = stalePages.slice(0, 6);
	const broken = roots.some((root) => root.problems.length > 0);

	const problems = broken
		? `<div class="callout">Some registries could not be read. <button type="button" class="link" data-command="workbench.actions.view.problems">Open Problems</button></div>`
		: '';

	return `${head}
${problems}
<div class="settings-strip settings-strip--wide">
	${fact('Pages', String(sums.pages))}
	${fact('Areas', String(roots.reduce((count, root) => count + root.areas.length, 0)))}
	${fact('Stale', String(stale))}
	${fact('Errors', String(sums.errors))}
	${fact('Warnings', String(sums.warnings))}
	${fact('Never reviewed', String(sums.neverReviewed))}
</div>

<div class="mt-24">
	<div class="group-head">
		<span class="group-head__label">Areas</span>
		<span class="group-head__rule"></span>
		<span class="group-head__count">${areas.length} ${areas.length === 1 ? 'area' : 'areas'}</span>
	</div>
	<div class="record-list">${areas.join('')}</div>
</div>

<div class="mt-24">
	<div class="group-head">
		<span class="group-head__label">Behind Its Source</span>
		<span class="group-head__rule"></span>
		<span class="group-head__count">${stale} ${stale === 1 ? 'page' : 'pages'}</span>
		<span class="group-head__actions">
			<button type="button" class="btn btn--ghost btn--sm" data-command="temcoDocs.stalenessReport"><span>Documentation Owed</span></button>
		</span>
	</div>
	${shown.length
			? `<div class="record-list">${shown.map(staleRow).join('')}</div>`
			: '<p class="group-note">Every page agrees with the code it claims to describe.</p>'}
</div>

<div class="mt-24">
	<div class="group-head">
		<span class="group-head__label">Checks</span>
		<span class="group-head__rule"></span>
		<span class="group-head__count">no writes</span>
	</div>
	<div class="row" style="gap:8px">
		<button type="button" class="btn" data-command="temcoDocs.validate"><span>Validate the Set</span></button>
		<button type="button" class="btn" data-command="temcoDocs.buildSite"><span>Build the Site</span></button>
		<button type="button" class="btn" data-command="temcoDocs.buildHelp"><span>Build the Offline Help</span></button>
	</div>
</div>`;
}
