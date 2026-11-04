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
import { FileIconTheme, loadFileIconTheme } from './fileIcons';
import { button, commandScript, entries, entry, escapeHtml, hero, n, notice, page, pageColumn, part, remember, runCommand } from './ui';

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
	/** Where the repository lives on the web, when its clone URL says so. */
	web?: string;
	cloned: boolean;
	last?: Commit;
	commits: Commit[];
	/** When the source was last read — the watermark the commits are judged against, if any. */
	read?: string;
	/** The paths that changed after the last read — what a reader has not been told about yet. */
	fresh: string[];
	/** Pages the documentation module says name those paths. */
	docs: { id: string; title: string }[];
	/** The projects that cite this source. One copy can serve several, so the row says which. */
	cited: string[];
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

/**
 * Where a repository lives on the web, from the URL it is cloned from.
 *
 * The clone URL is the only address the catalog keeps, and it arrives in three shapes — `https://host/owner/repo.git`,
 * `https://host/owner/repo`, and the `git@host:owner/repo.git` form SSH gives — so the same page link is derived from
 * all of them, and nothing is invented when the shape is none of those.
 */
function webUrlOf(remoteUrl: string | undefined): string | undefined {
	if (remoteUrl === undefined || remoteUrl.trim().length === 0) {
		return undefined;
	}
	const trimmed = remoteUrl.trim().replace(/\.git$/i, '');
	const scp = /^git@([^:]+):(.+)$/.exec(trimmed);
	if (scp !== null) {
		return `https://${scp[1]}/${scp[2]}`;
	}
	return /^https?:\/\//i.test(trimmed) ? trimmed : undefined;
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
		// One copy serves every project that cites it, so each row has to say which those are: the page groups by
		// citation, and a clone that two projects read belongs in both answers.
		const citing = new Map<string, string[]>();
		for (const document of catalog.documents()) {
			for (const slug of catalog.documentSourceSlugs(document.slug)) {
				citing.set(slug, [...(citing.get(slug) ?? []), document.name]);
			}
		}

		// With no project on screen "cited" is not a question anyone can answer, so the page shows one list instead of
		// splitting every clone into a group called "not cited". With a project, the second group is where the clones
		// it does not cite go — named for what they are (other clones), not for what they lack.
		const otherNote = 'No project on screen cites these. Reading one records what it says; citing it is what lets a draft name its pages.';
		const wanted: { title: string; note: (count: number) => string; list: SourceRow[] }[] = project === undefined
			? [{ title: 'Every clone', note: () => 'Every clone on this machine. Reading one records what it says; citing it is what lets a draft name its pages.', list: sources }]
			: [
				{ title: `Cited by ${project}`, note: (count) => `${count} ${count === 1 ? 'clone' : 'clones'} the project on screen cites.`, list: sources.filter((row) => cited.has(row.name)) },
				{ title: 'Other clones', note: () => otherNote, list: sources.filter((row) => !cited.has(row.name)) }
			];

		for (const { title, note, list } of wanted) {
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
					web: webUrlOf(detail?.remoteUrl),
					cloned: exists,
					last: commits[0],
					commits,
					read: waterline,
					fresh,
					docs: await pagesFor(fresh),
					cited: citing.get(source.slug) ?? []
				});
				total += 1;
			}
			groups.push({
				title,
				note: note(clones.length),
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

	open(restored?: vscode.WebviewPanel): void {
		remember(this.context, DASHBOARD_VIEW_TYPE);
		if (this.panel !== undefined) {
			this.panel.reveal(pageColumn());
			void this.render();
			return;
		}
		// A restored tab is drawn into rather than replaced: it keeps its place in the strip.
		this.panel = restored ?? vscode.window.createWebviewPanel(DASHBOARD_VIEW_TYPE, 'Repositories — dashboard', pageColumn(), {
			enableScripts: true,
			localResourceRoots: []
		});
		this.panel.webview.options = { enableScripts: true, localResourceRoots: [] };
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
		this.				panel.webview.onDidReceiveMessage(runCommand);
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
		// The row's mark is the user's own file icon theme: a repository is a folder, and it should look like one.
		const theme = await loadFileIconTheme(panel.webview);
		panel.webview.options = {
			enableScripts: true,
			localResourceRoots: theme === undefined ? [] : [vscode.Uri.file(theme.folder)]
		};
		panel.webview.html = page(body(groups, total, this.selection.project(), canDraft(), theme), {
			title: 'Repositories — Dashboard',
			script: commandScript,
			extraCss: COMMITS_CSS + (theme?.css ?? ''),
			resources: panel.webview.cspSource
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
 * The page's own styles: the commit list folded under the row it belongs to.
 *
 * The kit has no commit list, and inventing a component for one page would be a second vocabulary. What is here is the
 * fold and the two distinctions the page makes — a hash in mono, and the commits before the last read dimmed rather
 * than dropped, because a column that only shows what is new cannot be checked against the history it came from.
 */
const COMMITS_CSS = `
/* The part's note reads in the page's own description voice: it explains the list, and it should not be smaller type
   than the sentence at the top of the page that also explains it. */
.az-section__desc { font-size: 13px; line-height: 20px; }
/* A clone's description is a sentence about the copy — its folder, its last commit, the pages that name it — not machine
   text, so it reads in the same voice and size as the row's own title. The kit sets the meta in mono for the rows that
   quote a command; here it is prose, so it inherits instead. */
.az-entries .az-entry__meta { font-family: inherit; font-size: 13px; line-height: 18px; }
.commits { margin: 0 34px var(--sp-2) 34px; }
.commits > summary { cursor: pointer; color: var(--az-blue); font-size: 12px; line-height: 18px; }
.commits__all { float: right; color: var(--az-blue); text-decoration: none; }
.commits__all:hover { text-decoration: underline; }
.commits__list { margin: var(--sp-2) 0 0; padding: 0; list-style: none; }
.commits__item { padding: 1px 0; font-size: 12px; line-height: 17px; }
.commits__item--seen { opacity: .55; }
.commits__row { display: flex; gap: var(--sp-3); align-items: baseline; color: inherit; text-decoration: none; cursor: pointer; }
.commits__row:hover .commits__subject { text-decoration: underline; }
/* The hash is the link: it is what a person copies and what GitHub keys the commit by. */
.commits__hash { font-family: var(--font-mono); color: var(--az-blue); }
.commits__subject { flex: 1; min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; color: var(--fg); }
.commits__date { color: var(--fg-subtle); font-variant-numeric: tabular-nums; }
`;

/** Whether the AI module is installed, which is what decides if a Draft control would do anything. */
function canDraft(): boolean {
	return vscode.extensions.getExtension('temcocontrols.temco-ai') !== undefined;
}

/** The pages that name the files this clone changed, as one phrase. */
function pagesPhrase(clone: Clone): string {
	if (clone.docs.length === 0) {
		return 'no page names these files';
	}
	const named = clone.docs.slice(0, 3).map((doc) => doc.title).join(', ');
	return clone.docs.length > 3 ? `${named} and ${clone.docs.length - 3} more` : named;
}

/** The projects that read this copy, as one phrase: one clone can be cited by several. */
function citedPhrase(clone: Clone): string {
	if (clone.cited.length === 0) {
		return 'no project cites it';
	}
	const named = clone.cited.slice(0, 3).join(', ');
	return `cited by ${clone.cited.length > 3 ? `${named} and ${clone.cited.length - 3} more` : named}`;
}

/**
 * One clone, as a row: what moved, whether it is new to the reader, and the pages that name it.
 *
 * The state word sits beside the name, because it is a fact about this copy — not cloned, never read, nothing new.
 * The meta carries the evidence — the branch, the folder, the last commit and the pages. The acts are the ones the
 * reader would take next, and they are words, not boxes: a row already says what it is.
 */
function cloneRow(clone: Clone, canDraft: boolean, theme: FileIconTheme | undefined): string {
	const fresh = clone.fresh.length;
	const last = clone.last;
	// "Not cloned" is a state, not a fault: the copy is optional and reading works without it. The acts therefore say
	// which of the two the reader wants — make the copy, or read what the source declares.
	const state = !clone.cloned
		? 'not cloned'
		: clone.read === undefined
			? 'never read'
			: fresh === 0
				? 'nothing new'
				: `${n(fresh, 'file', 'files')} since the last read`;
	// A repository is a folder on this machine, so the theme's own folder glyph is what marks it — the same icon the
	// Explorer would draw beside that path. A theme that defines no folder icon (the built-in one does not) gets the
	// page's folder glyph, which is the same idea in the kit's vocabulary.
	const glyph = theme?.classFor(clone.path ?? clone.name);
	const row = entry({
		markHtml: glyph === undefined ? undefined : `<span class="${glyph}" aria-hidden="true"></span>`,
		mark: 'folder',
		tone: !clone.cloned ? 'info' : fresh === 0 ? 'ok' : 'info',
		title: clone.name,
		// The name is the way in: a row is a repository, and the repository has a page. The commands take the row's
		// **name**, not its slug — the page resolves a repository by the name the organisation listed it under.
		titleCommand: { command: 'temcoRepositories.repository', args: [clone.name] },
		status: state,
		meta: [
			clone.branch,
			clone.path,
			last === undefined ? 'no commit to read' : `${last.short} · ${last.subject} · ${last.date}`,
			citedPhrase(clone),
			pagesPhrase(clone)
		],
		// One act per state, not two that look alike — and both of them happen on the repository's own page, where the
		// command and its output are read together. A clone is not something to start blind from a list.
		actions: (clone.cloned
			? button('Pull', 'temcoRepositories.repositoryPull', { kind: 'link', args: [clone.name] })
			: button('Clone it', 'temcoRepositories.repositoryClone', { kind: 'link', args: [clone.name] }))
			+ (canDraft && clone.docs.length > 0 ? button('Draft', 'temcoAi.stale', { kind: 'link' }) : '')
	});
	return `${row}${commitFold(clone)}`;
}

/**
 * The commits the page read, folded under the row: native `details`, so it opens in place and closes again.
 *
 * Every line is a way into GitHub — the fold's own link goes to the branch's commit list, and each commit to its page
 * there — because the one thing a list of commits makes a person want is the change itself. The links are ordinary
 * anchors: a webview opens an `http(s)` link in the browser, so the page needs no script of its own for them.
 */
function commitFold(clone: Clone): string {
	if (clone.commits.length === 0) {
		return '';
	}
	const web = clone.web;
	const listHref = web === undefined
		? undefined
		: `${web}/commits${clone.branch === undefined ? '' : `/${encodeURIComponent(clone.branch)}`}`;
	const items = clone.commits.map((commit) => {
		const href = web === undefined ? undefined : `${web}/commit/${encodeURIComponent(commit.short)}`;
		// No "seen"/"new" word: the dimming says which side of the watermark a commit is on, and the fold's own
		// sentence already gives the date the watermark is.
		const body = `<span class="commits__hash">${escapeHtml(commit.short)}</span>`
			+ `<span class="commits__subject">${escapeHtml(commit.subject)}</span>`
			+ `<span class="commits__date">${escapeHtml(commit.date)}</span>`;
		return `<li class="commits__item${commit.seen ? ' commits__item--seen' : ''}">`
			+ (href === undefined
				? body
				: `<a class="commits__row" href="${escapeHtml(href)}" title="Open ${escapeHtml(commit.short)} on GitHub">${body}</a>`)
			+ '</li>';
	}).join('');
	const open = listHref === undefined
		? ''
		: `<a class="commits__all" href="${escapeHtml(listHref)}" title="Open the commits on GitHub">Commits on GitHub</a>`;
	return `<details class="commits"><summary><span class="commits__text">Show the ${n(clone.commits.length, 'commit', 'commits')} it read`
		+ `${clone.read === undefined ? '' : `, last read ${escapeHtml(clone.read)}`}</span>${open}</summary>`
		+ `<ul class="commits__list">${items}</ul></details>`;
}

function body(groups: readonly Group[], total: number, project: string | undefined, canDraft: boolean, theme: FileIconTheme | undefined): string {
	const all = groups.flatMap((group) => group.clones);
	const fresh = all.reduce((sum, clone) => sum + clone.fresh.length, 0);
	const affected = all.reduce((sum, clone) => sum + clone.docs.length, 0);
	const local = all.filter((clone) => !clone.cloned).length;
	const unread = all.filter((clone) => clone.cloned && clone.read === undefined).length;

	const head = hero({
		eyebrow: 'Repositories',
		mark: 'clock',
		title: 'Dashboard',
		desc: 'Every clone on this machine, grouped by the project that cites it. A commit only matters when a page is about the thing it touched, so each row ends with the pages that name the files it changed — and the watermark is the last read, so what came after it is what nobody has been told yet.',
		descWide: true,
		actions: [
			{ label: 'Read every source', command: 'temcoRepositories.readAllSources', kind: 'primary', mark: 'refresh' },
			...(canDraft ? [{ label: 'Draft the affected pages', command: 'temcoAi.stale', mark: 'sparkle' }] : []),
			{ label: 'Show the Log', command: 'temcoRepositories.showLog', mark: 'output' },
			{ label: 'Repositories', command: 'temcoRepositories.page', mark: 'repo' }
		],
		stats: [
			{ value: String(total), label: total === 1 ? 'clone' : 'clones' },
			{ value: String(fresh), label: 'files since the last read' },
			{ value: String(affected), label: affected === 1 ? 'page affected' : 'pages affected' },
			{ value: String(local + unread), label: 'not yet read here' }
		]
	});

	if (groups.length === 0) {
		return `${head}
${notice({
			mark: 'repo',
			title: 'No repository is recorded yet',
			desc: 'Add an enterprise on the repositories page, then clone a copy. This page reads the clones on this machine, so it has nothing to say until there is one.',
			actions: button('Open the repositories', 'temcoRepositories.page', { kind: 'primary', mark: 'repo' })
		})}`;
	}

	const sections = groups.map((group) => `<div class="mt-24">${part({
		title: group.title,
		count: n(group.clones.length, 'clone', 'clones'),
		note: group.note
	})}
${entries(group.clones.map((clone) => cloneRow(clone, canDraft, theme)).join(''))}</div>`).join('');

	return `${head}${sections}
<p class="az-note">Cloned copies on this machine · a commit before the last read is dimmed, not dropped${project === undefined ? '' : ` · project ${escapeHtml(project)}`}.</p>`;
}
