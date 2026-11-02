/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Temco Controls. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

// *Dashboard* — every clone on this machine, what moved in it, and which pages say something about what moved.
//
// The organisation page answers "what does GitHub have". This answers the other question: **what changed since I last
// looked**, per clone, grouped by the project that cites it — because a commit is only interesting when a page is about
// the thing it touched.
//
// The watermark is the last *read* the catalog recorded for that source: a read is the moment a person said "I have seen
// what this repository says", so anything after it is new to them. Commits older than the watermark are listed greyed as
// already seen, which is what makes the column trustworthy rather than merely full.
//
// Nothing here asks the model anything. What the AI does with the answer — a draft of the affected pages — is the AI
// module's page, and this one hands it the list.

import { execFile } from 'child_process';
import { existsSync } from 'fs';
import * as vscode from 'vscode';
import { Catalog, Selection, SourceRow } from './store';
import { page, pageColumn, remember } from './ui';

export const DASHBOARD_VIEW_TYPE = 'temcoRepositories.dashboard';

/** One commit, with the files it touched in this clone. */
interface Commit {
	short: string;
	subject: string;
	author: string;
	date: string;
	files: string[];
	/** True when it happened before the last read: it is shown, and marked as already seen. */
	seen: boolean;
}

/** One clone, and what the page can tell about it. */
interface Clone {
	slug: string;
	name: string;
	branch?: string;
	path?: string;
	cloned: boolean;
	last?: Commit;
	commits: Commit[];
	/** When the source was last read — the watermark the commits are judged against, if any. */
	read?: string;
	/** The paths that changed after the last read — what a reader has not been told about yet. */
	fresh: string[];
	/** Pages the documentation module says name those paths. */
	docs: { id: string; title: string }[];
}

/** A project, and the clones it cites. */
interface Group {
	title: string;
	note: string;
	clones: Clone[];
}

/** `git`, in one clone, answering with its stdout or with nothing at all. */
function git(cwd: string, args: readonly string[]): Promise<string> {
	return new Promise((resolve) => {
		execFile('git', ['-C', cwd, ...args], { timeout: 15_000, windowsHide: true, maxBuffer: 8 * 1024 * 1024 }, (error, stdout) => {
			resolve(error ? '' : stdout.toString());
		});
	});
}

/** `%h|%s|%an|%ad` — the four facts a row shows, in one line git can print. */
function parseLine(line: string): { short: string; subject: string; author: string; date: string } | undefined {
	const parts = line.split('|');
	return parts.length < 4 ? undefined : { short: parts[0], subject: parts.slice(1, -2).join('|'), author: parts[parts.length - 2], date: parts[parts.length - 1] };
}

/** The commits of one clone, newest first, and the files each one touched. */
async function history(clone: string, since: string | undefined): Promise<Commit[]> {
	const format = '%h|%s|%an|%ad';
	const output = await git(clone, ['log', '-40', '--date=short', `--pretty=format:${format}%n`, '--name-only', '--', '.']);
	const commits: Commit[] = [];
	let current: Commit | undefined;
	for (const raw of output.split(/\r?\n/)) {
		const line = raw.trim();
		if (line.length === 0) {
			continue;
		}
		const head = parseLine(line);
		if (head !== undefined) {
			if (current !== undefined) {
				commits.push(current);
			}
			current = { ...head, files: [], seen: since !== undefined && head.date < since };
			continue;
		}
		current?.files.push(line);
	}
	if (current !== undefined) {
		commits.push(current);
	}
	return commits;
}

/** Which documentation pages name any of these paths, asked of the module that owns the registry. */
async function pagesFor(paths: readonly string[]): Promise<{ id: string; title: string }[]> {
	if (paths.length === 0) {
		return [];
	}
	try {
		const answer = await vscode.commands.executeCommand<{ id: string; title: string }[]>('temcoDocs.pagesForPaths', [...paths]);
		return Array.isArray(answer) ? answer : [];
	} catch {
		// No documentation module installed: the column is empty rather than wrong.
		return [];
	}
}

/** The clones the catalog holds, each with its commits and the pages those commits touch. */
async function clones(context: vscode.ExtensionContext, project: string | undefined): Promise<{ groups: Group[]; total: number }> {
	let catalog: Catalog | undefined;
	const groups: Group[] = [];
	let total = 0;
	try {
		catalog = await Catalog.open(context);
		const sources: SourceRow[] = catalog.sources().filter((row) => row.kind === 'git');
		// What the project being worked on cites: the first group, and the only one with a name.
		const cited = new Set(project === undefined ? [] : catalog.documentSources(project).map((source) => source.name));

		for (const [title, list] of [
			[project === undefined ? 'Cited by this project' : `Cited by ${project}`, sources.filter((row) => cited.has(row.name))],
			['Not cited by a project', sources.filter((row) => !cited.has(row.name))]
		] as [string, SourceRow[]][]) {
			if (list.length === 0) {
				continue;
			}
			const clones: Clone[] = [];
			for (const source of list) {
				const detail = catalog.source(source.slug);
				const clone = detail?.path;
				const exists = clone !== undefined && existsSync(clone);
				// The source's own last read, when the catalog recorded one: everything after it is new to the reader.
				// The watermark is a date, because that is what `git log --date=short` answers with; comparing a date
				// against a timestamp would mark every commit on the read's own day as already seen.
				const read = source.lastRead ?? detail?.lastRead;
				const waterline = read === undefined ? undefined : read.slice(0, 10);
				const commits = exists ? await history(clone as string, waterline) : [];
				const fresh = commits.filter((commit) => waterline === undefined || commit.date >= waterline).flatMap((commit) => commit.files);
				clones.push({
					slug: source.slug,
					name: source.name,
					branch: detail?.branch,
					path: clone,
					cloned: exists,
					last: commits[0],
					commits,
					read: waterline,
					fresh,
					docs: await pagesFor(fresh)
				});
				total += 1;
			}
			groups.push({
				title,
				note: title.startsWith('Cited')
					? `${clones.length} ${clones.length === 1 ? 'clone' : 'clones'} the project on screen cites.`
					: 'Clones no project has started — read them, or cite one from the repositories page.',
				clones: clones.sort((a, b) => (b.last?.date ?? '').localeCompare(a.last?.date ?? ''))
			});
		}
	} catch {
		// No catalog, no dashboard: an empty page says so rather than showing a sample.
	} finally {
		catalog?.close();
	}
	return { groups, total };
}

/** The dashboard, as a page. */
export class DashboardPage {
	private panel: vscode.WebviewPanel | undefined;
	/** The catalog's own signal, listened to only while the panel exists. */
	private changes: vscode.Disposable | undefined;
	/** A read finishing fires several times; the page is rebuilt once. */
	private timer: ReturnType<typeof setTimeout> | undefined;

	constructor(
		private readonly context: vscode.ExtensionContext,
		private readonly selection: Selection,
		private readonly onDidChange: (listener: () => void) => vscode.Disposable
	) { }

	open(): void {
		remember(this.context, DASHBOARD_VIEW_TYPE);
		if (this.panel !== undefined) {
			this.panel.reveal(pageColumn());
			void this.render();
			return;
		}
		this.panel = vscode.window.createWebviewPanel(DASHBOARD_VIEW_TYPE, 'Repositories — dashboard', pageColumn(), {
			enableScripts: true,
			localResourceRoots: []
		});
		this.panel.iconPath = new vscode.ThemeIcon('history');
		this.panel.onDidDispose(() => {
			this.panel = undefined;
			this.changes?.dispose();
			this.changes = undefined;
			if (this.timer !== undefined) {
				clearTimeout(this.timer);
				this.timer = undefined;
			}
		});
		this.panel.webview.onDidReceiveMessage((message: { type?: string; command?: string; args?: unknown }) => {
			if (message.type === 'command' && typeof message.command === 'string') {
				void vscode.commands.executeCommand(message.command, ...(Array.isArray(message.args) ? message.args : []));
			}
			if (message.type === 'refresh') {
				void this.render();
			}
		});
		// A read that finishes, a clone that lands, a source that is forgotten: the page is about exactly those facts.
		// Only while it is the panel on screen — a page nobody is looking at costs a `git log` per clone for nothing.
		this.changes = this.onDidChange(() => {
			if (this.panel?.visible !== true) {
				return;
			}
			if (this.timer !== undefined) {
				clearTimeout(this.timer);
			}
			this.timer = setTimeout(() => {
				this.timer = undefined;
				void this.render();
			}, 400);
		});
		void this.render();
	}

	private async render(): Promise<void> {
		const panel = this.panel;
		if (panel === undefined) {
			return;
		}
		const { groups, total } = await clones(this.context, this.selection.project());
		// Reading the clones is slow enough that the panel can be closed, or replaced, while it runs.
		if (this.panel !== panel) {
			return;
		}
		panel.webview.html = page(body(groups, total, this.selection.project()), {
			title: 'Repositories — dashboard',
			script,
			extraCss: COMMITS_CSS
		});
	}

	dispose(): void {
		this.changes?.dispose();
		this.changes = undefined;
		if (this.timer !== undefined) {
			clearTimeout(this.timer);
			this.timer = undefined;
		}
		this.panel?.dispose();
	}
}

/**
 * The page's own styles: a commit list folded under the last commit, and the ones before the last read dimmed.
 *
 * The list is a `<details>` so the table stays one row per clone; opening it costs no script, and what is inside
 * carries the only distinction the page makes — new since the read, or already seen.
 */
const COMMITS_CSS = `
.commits > summary { cursor: pointer; list-style: none; }
.commits > summary::-webkit-details-marker { display: none; }
.commits > summary::before { content: '▸'; display: inline-block; width: 10px; color: var(--vscode-descriptionForeground); }
.commits[open] > summary::before { content: '▾'; }
.commits__list { margin: 6px 0 0 10px; padding: 0; list-style: none; font-size: 11.5px; }
.commits__item { padding: 2px 0; display: flex; gap: 6px; align-items: baseline; }
.commits__item--seen { opacity: .55; }
.commits__subject { flex: 1; min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
`;

/** One clone, as a row: what moved, whether it is new to the reader, and the pages that name it. */
function cloneRow(clone: Clone): string {
	const last = clone.last;
	const fresh = clone.fresh.length;
	const docs = clone.docs.length === 0
		? '<span class="cell-muted">no page names these files</span>'
		: clone.docs.slice(0, 3).map((doc) => `<span class="cell-strong">${escapeHtml(doc.title)}</span>`).join(' · ')
			+ (clone.docs.length > 3 ? ` <span class="cell-muted">+${clone.docs.length - 3}</span>` : '');
	const state = !clone.cloned
		? '<span class="badge badge--warn">no local copy</span>'
		: fresh === 0
			? '<span class="badge badge--ok">nothing new</span>'
			: `<span class="badge badge--info">${fresh} ${fresh === 1 ? 'file' : 'files'} since the last read</span>`;
	// Every commit the page read is listed, and the ones before the watermark are dimmed rather than dropped: a column
	// that only ever shows what is new cannot be checked against the history it came from.
	const history = last === undefined
		? '<span class="cell-muted">nothing read yet</span>'
		: `<details class="commits"><summary><span class="cell-strong">${escapeHtml(last.subject)}</span><div class="cell-muted">${escapeHtml(last.short)} · ${escapeHtml(last.author)} · ${escapeHtml(last.date)}${clone.read === undefined ? '' : ` · last read ${escapeHtml(clone.read)}`}</div></summary>
<ul class="commits__list">${clone.commits.map(commitItem).join('')}</ul></details>`;
	return `<tr>
<td><div class="cell-strong">${escapeHtml(clone.name)}</div><div class="cell-muted" style="font-size:11.5px">${clone.branch === undefined ? '' : escapeHtml(clone.branch)}${clone.path === undefined ? '' : ` · ${escapeHtml(clone.path)}`}</div></td>
<td>${history}</td>
<td>${state}</td>
<td>${docs}</td>
<td class="cell-nowrap">${action('Read', 'temcoRepositories.readSource', clone.slug)}${action('Suggest docs', 'temcoAi.stale')}</td>
</tr>`;
}

/** One commit in the list: the ones the reader has already been told about say so, in the same words as the badge. */
function commitItem(commit: Commit): string {
	const tone = commit.seen ? ' commits__item--seen' : '';
	const mark = commit.seen ? 'seen' : 'new';
	return `<li class="commits__item${tone}"><span class="cell-mono">${escapeHtml(commit.short)}</span><span class="commits__subject">${escapeHtml(commit.subject)}</span><span class="cell-muted">${escapeHtml(commit.date)}</span><span class="cell-muted">${mark}</span></li>`;
}

function action(label: string, command: string, args?: unknown): string {
	return `<button type="button" class="az-btn az-btn--sm" data-command="${command}"${args === undefined ? '' : ` data-args="${escapeHtml(JSON.stringify(args))}"`}>${escapeHtml(label)}</button>`;
}

function escapeHtml(text: string): string {
	return text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

function body(groups: readonly Group[], total: number, project: string | undefined): string {
	const newFiles = groups.flatMap((group) => group.clones).reduce((sum, clone) => sum + clone.fresh.length, 0);
	const affected = groups.flatMap((group) => group.clones).reduce((sum, clone) => sum + clone.docs.length, 0);
	const heading = `<div class="az-wash"><header class="az-lead">
<h1 class="az-title">Repositories — dashboard</h1>
<p class="az-intro az-intro--wide">Every clone on this machine, grouped by the project that cites it. A commit is only
interesting when a page is about the thing it touched, so each row ends with the pages that name the files it changed.
The watermark is the last read: what came after it is what nobody has been told yet.</p>
<div class="az-row"><button type="button" class="az-btn az-btn--primary" data-type="refresh">Read it again</button>
${action('Read the repositories', 'temcoRepositories.page')}
${action('Draft the affected pages', 'temcoAi.stale')}</div>
</header></div>
<p class="az-note">${total} ${total === 1 ? 'clone' : 'clones'} · ${newFiles} ${newFiles === 1 ? 'file' : 'files'} changed since the last read · ${affected} ${affected === 1 ? 'page' : 'pages'} affected${project === undefined ? '' : ` · project ${escapeHtml(project)}`}</p>`;

	if (groups.length === 0) {
		return `${heading}
<div class="mt-24"><aside class="az-callout"><div class="az-callout__main"><span class="az-callout__icon"></span><div><p class="az-callout__title">No repository is recorded yet</p><p class="az-callout__desc">Add an enterprise on the repositories page, then download a copy — this page reads the clones on this machine, so it has nothing to say until there is one.</p></div></div></aside></div>`;
	}

	const sections = groups.map((group) => `<div class="az-section"><div class="az-section__text"><h2 class="az-section__title">${escapeHtml(group.title)}</h2><p class="az-section__desc">${escapeHtml(group.note)}</p></div></div>
<div class="table-wrap table-wrap--plain"><table class="table table--compact"><thead><tr><th>Clone</th><th>Last commit</th><th>Since the last read</th><th>Pages that name them</th><th></th></tr></thead><tbody>${group.clones.map(cloneRow).join('')}</tbody></table></div>`).join('');

	return `${heading}
<div class="mt-24">${sections}</div>`;
}

/** The page's one behaviour: a button posts the command it names, and "Read it again" asks for a fresh read. */
const script = `
(function () {
	const api = acquireVsCodeApi();
	document.addEventListener('click', (event) => {
		const target = event.target.closest('[data-command], [data-type]');
		if (target === null) {
			return;
		}
		if (target.dataset.command !== undefined) {
			const args = target.dataset.args;
			api.postMessage({ type: 'command', command: target.dataset.command, args: args === undefined ? [] : JSON.parse(args) });
			return;
		}
		api.postMessage({ type: 'refresh' });
	});
})();
`;
