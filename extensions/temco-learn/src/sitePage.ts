// The site, managed: what is running, what the clone is, where it lives, what it needs, and what was printed.
//
// The website is its own repository, so the first question this module has to answer is not "which folder?" but "what do
// you have?". This page answers that once — cloned or not, installed or not, built or not, running or not — and every
// answer comes with the act that changes it. Nothing here is remembered between windows: it is read from the folder every
// time the page is drawn, so two windows cannot disagree about what is on disk.
//
// The panel keeps one group for the site, and this page is where it opens. The parts come in the order a person asks the
// questions: *Server* (is it up, and how is it served), *This machine* (the clone on disk), *Log* (what it said). Every act
// appears here exactly once, and the row it belongs to is the only place it lives.

import * as vscode from 'vscode';
import { RepoFacts } from './siteFacts';
import { SiteStatus } from './siteRunner';
import { siteUrl } from './siteRepo';
import { ago } from './state';
import { callout, commandScript, escapeHtml, hero, icon, page, pageColumn, runCommand, section } from './ui';

export const SITE_VIEW_TYPE = 'temcoLearn.site';

/** The name the page gives itself, in the tab and as its only `h1`. */
export const SITE_PAGE_TITLE = 'Documentation Site';

/**
 * The page's own rules, on top of the vocabulary.
 *
 * Four shapes the reading pages do not have: a section title marked by the brand's vertical rule; a meta line that carries
 * the clone's facts instead of hiding them in a sentence; small cards that show their state as a coloured dot rather than a
 * box drawn round them; and a tabbed activity area, whose panes are `Output` and `Publish`.
 */
export const PAGE_STYLE = `
.site-meta { display: flex; flex-wrap: wrap; align-items: baseline; gap: 2px var(--sp-4); margin: 0 0 var(--sp-4); padding: 0 0 var(--sp-3); border-bottom: 1px solid var(--hairline); }
.site-meta__repo { color: var(--ink-3); font-family: var(--font-mono); font-size: 11.5px; line-height: 16px; overflow-wrap: anywhere; }
.site-meta__figure { color: var(--ink-3); font-size: 11.5px; line-height: 16px; }
.site-meta__value { color: var(--ink-1); font-size: 13px; font-variant-numeric: tabular-nums; }
.site-meta__link { padding: 0; border: 0; background: none; color: var(--az-blue, #0078d4); font: inherit; cursor: pointer; }
.site-meta__link:hover { text-decoration: underline; }
.site-meta__link:focus-visible { outline: 1px solid var(--az-blue, #0078d4); outline-offset: 2px; border-radius: 2px; }
.site-server { display: flex; flex-wrap: wrap; align-items: center; gap: var(--sp-2) var(--sp-4); padding: 0 0 var(--sp-3); }
.site-server__state { flex: 1 1 200px; min-width: 0; color: var(--ink-2); font-family: var(--font-mono); font-size: 12px; overflow-wrap: anywhere; }
.site-server__acts { display: flex; flex-wrap: wrap; align-items: center; gap: var(--sp-2); }
.site-server__links { display: flex; align-items: center; gap: var(--sp-2); padding-right: var(--sp-4); border-right: 1px solid var(--hairline); }
.site-cards { display: grid; grid-template-columns: repeat(4, minmax(0, 1fr)); gap: var(--sp-2); }
@media (max-width: 760px) { .site-cards { grid-template-columns: repeat(2, minmax(0, 1fr)); } }
.site-card { position: relative; display: flex; flex-direction: column; gap: 2px; min-width: 0; padding: 9px 12px 8px 26px; border-radius: var(--r-2); background: var(--surface-card); background: color-mix(in srgb, var(--ink-3) 5%, var(--surface-card)); }
.site-card::before { content: ''; position: absolute; left: 11px; top: 15px; width: 6px; height: 6px; border-radius: 50%; background: var(--ink-3); opacity: 0.35; }
.site-card--ok::before { background: var(--vscode-charts-green, #3fb950); opacity: 1; }
.site-card--warn::before { background: var(--vscode-charts-yellow, #d29922); opacity: 1; }
.site-card__label { color: var(--ink-3); font-size: 10px; line-height: 14px; letter-spacing: 0.06em; text-transform: uppercase; }
.site-card__value { min-width: 0; color: var(--ink-1); font-size: 13px; line-height: 18px; overflow-wrap: anywhere; }
.site-card__value--mono { font-family: var(--font-mono); font-size: 12px; }
.site-card__acts { display: flex; flex-wrap: wrap; gap: var(--sp-3); margin-top: auto; padding-top: var(--sp-2); }
.site-tabs { display: block; }
.site-tabs__input { position: absolute; width: 1px; height: 1px; opacity: 0; pointer-events: none; }
.site-tabs__bar { display: flex; gap: var(--sp-1); margin: 0 0 var(--sp-2); border-bottom: 1px solid var(--hairline); }
.site-tabs__label { margin-bottom: -1px; padding: 2px 10px 3px; border-bottom: 2px solid transparent; color: var(--ink-3); font-size: 11.5px; line-height: 18px; cursor: pointer; }
.site-tabs__label:hover { color: var(--ink-1); }
.site-tabs__pane { display: none; }
.site-tabs__toggle { display: flex; align-items: center; gap: 3px; margin-left: auto; padding-bottom: 1px; color: var(--az-blue, #0078d4); font-size: 11.5px; line-height: 18px; cursor: pointer; }
.site-tabs__toggle:hover { text-decoration: underline; }
.site-tabs__toggle-less { display: none; }
.site-tabs__toggle-less .icon { transform: rotate(180deg); }
#site-more:checked ~ .site-tabs__bar .site-tabs__toggle-more { display: none; }
#site-more:checked ~ .site-tabs__bar .site-tabs__toggle-less { display: flex; }
#site-more:focus-visible ~ .site-tabs__bar .site-tabs__toggle { outline: 1px solid var(--az-blue, #0078d4); outline-offset: 1px; }
.site-console--all { display: none; }
#site-more:checked ~ .site-tabs__pane .site-console--tail { display: none; }
#site-more:checked ~ .site-tabs__pane .site-console--all { display: block; }
#site-tab-output:checked ~ .site-tabs__bar label[for='site-tab-output'],
#site-tab-publish:checked ~ .site-tabs__bar label[for='site-tab-publish'] { color: var(--ink-1); border-bottom-color: var(--az-blue, #0078d4); }
#site-tab-output:focus-visible ~ .site-tabs__bar label[for='site-tab-output'],
#site-tab-publish:focus-visible ~ .site-tabs__bar label[for='site-tab-publish'] { outline: 1px solid var(--az-blue, #0078d4); outline-offset: 1px; }
#site-tab-output:checked ~ .site-tab-pane--output { display: block; }
#site-tab-publish:checked ~ .site-tab-pane--publish { display: block; }
.site-console { margin: 0; padding: var(--sp-3) var(--sp-4); border-radius: var(--r-2); background: var(--surface-card); background: color-mix(in srgb, var(--az-blue, #0078d4) 3%, var(--surface-card)); color: var(--ink-2); font-family: var(--font-mono); font-size: 11.5px; line-height: 18px; white-space: pre-wrap; overflow-wrap: anywhere; }
.site-console--all { max-height: 260px; overflow-y: auto; }
.site-add { display: grid; gap: 2px; padding: var(--sp-2) var(--sp-4); border-radius: var(--r-2); background: var(--surface-card); background: color-mix(in srgb, var(--az-blue, #0078d4) 4%, var(--surface-card)); }
.site-add--focus { outline: 1px solid var(--az-blue, #0078d4); outline-offset: 1px; }
.site-add__row { display: grid; grid-template-columns: minmax(0, 1fr) auto auto; align-items: center; gap: var(--sp-3); padding: var(--sp-1) 0; }
.site-add__name { min-width: 0; color: var(--ink-1); font-size: 12.5px; line-height: 18px; overflow-wrap: anywhere; }
.site-add__why { color: var(--ink-3); font-size: 11.5px; line-height: 18px; }
.site-changes { display: grid; gap: var(--sp-1); padding: var(--sp-2) var(--sp-4); border-radius: var(--r-2); background: var(--surface-card); background: color-mix(in srgb, var(--az-blue, #0078d4) 4%, var(--surface-card)); }
.site-changes--focus { outline: 1px solid var(--az-blue, #0078d4); outline-offset: 1px; }
.site-changes__group { display: flex; flex-wrap: wrap; align-items: baseline; gap: var(--sp-2); padding: var(--sp-2) 0 0; }
.site-changes__group:first-child { padding-top: 0; }
.site-changes__kind { color: var(--ink-3); font-size: 10px; line-height: 14px; letter-spacing: 0.06em; text-transform: uppercase; }
.site-changes__why { color: var(--ink-3); font-size: 11.5px; line-height: 16px; }
.site-change { display: grid; grid-template-columns: 18px minmax(0, 1fr) auto; align-items: center; gap: var(--sp-3); padding: 1px 0; }
.site-change__code { color: var(--ink-3); font-family: var(--font-mono); font-size: 11px; }
.site-change__path { min-width: 0; color: var(--ink-1); font-family: var(--font-mono); font-size: 11.5px; line-height: 16px; overflow-wrap: anywhere; }
.site-change__acts { display: flex; gap: var(--sp-3); }
.site-change__more { color: var(--ink-3); font-size: 11.5px; line-height: 16px; padding-left: 30px; }
.site-report { display: flex; align-items: baseline; gap: var(--sp-3); margin: 0 0 var(--sp-2); padding: 5px 12px 6px; border-radius: var(--r-2); border-left: 2px solid var(--vscode-charts-green, #3fb950); background: var(--surface-card); background: color-mix(in srgb, var(--vscode-charts-green, #3fb950) 8%, var(--surface-card)); }
.site-report--warn { border-left-color: var(--vscode-charts-yellow, #d29922); background: color-mix(in srgb, var(--vscode-charts-yellow, #d29922) 10%, var(--surface-card)); }
.site-report__title { min-width: 0; color: var(--ink-1); font-size: 12.5px; line-height: 18px; overflow-wrap: anywhere; }
`;

/** The links in the meta line are buttons in the page's own dress: a command, never an `href` into the website. */
function metaLink(label: string, command: string, args?: unknown, mono = false): string {
	const data = args === undefined ? '' : ` data-args="${escapeHtml(JSON.stringify(args))}"`;
	return `<button type="button" class="site-meta__link${mono ? ' site-meta__repo' : ''}" data-command="${escapeHtml(command)}"${data}>${escapeHtml(label)}</button>`;
}

/** One build on this machine the website does not serve yet: what to add, and why it is waiting. */
export interface PendingBuild {
	title: string;
	folder: string;
	/** `not on the site`, or `newer than 13.0` — the reason to add it, in the row. */
	why: string;
}

/** Everything the page says: the folder and what is in it, what is running, and the last lines a command printed. */
export interface SitePageFacts {
	repo: RepoFacts;
	status: SiteStatus;
	log: readonly string[];
	/** What the last publish attempt printed, for the second tab of the activity area. */
	publish: readonly string[];
	/** Whether the folder the module is pointed at is the site, or merely a folder somebody chose. */
	configured: boolean;
	/** The one port the site is served on. */
	port: number;
	/** The builds on this machine that are not versions on the site yet — the one act this page owns that no other page does. */
	pending: readonly PendingBuild[];
	/** Set when the page was opened *for* a section: it comes first, and says so. */
	focus?: 'add' | 'changes';
	/**
	 * What an act just did, in the caller's words.
	 *
	 * A pull of sixteen commits, a discard and a commit-and-push all finish by redrawing this page, and the page used to
	 * come back looking exactly as it did before — so a person who pressed a button could not tell whether anything had
	 * happened. This is that answer, in one line, above the activity area that holds the detail.
	 */
	report?: Report;
}

/** The outcome of the act that opened the page. */
export interface Report {
	title: string;
	tone: 'ok' | 'warn';
}

export class SitePage implements vscode.Disposable {
	private opened: vscode.WebviewPanel | undefined;
	private focus: 'add' | 'changes' | undefined;
	private held: { title: string; tone: Report['tone'] } | undefined;

	constructor(private readonly read: () => Promise<SitePageFacts>) { }

	/** Opens the page, or brings it forward. `focus` puts the section a caller meant at the top. */
	open(focus?: 'add' | 'changes', restored?: vscode.WebviewPanel): void {
		this.focus = focus;
		if (this.opened !== undefined) {
			this.opened.reveal(pageColumn());
			void this.render();
			return;
		}
		// A restored tab is drawn into rather than replaced: it keeps its place in the strip.
		this.opened = restored ?? vscode.window.createWebviewPanel(SITE_VIEW_TYPE, SITE_PAGE_TITLE, pageColumn(), {
			enableScripts: true,
			localResourceRoots: []
		});
		this.opened.webview.options = { enableScripts: true, localResourceRoots: [] };
		this.opened.onDidDispose(() => {
			this.opened = undefined;
		});
		this.opened.webview.onDidReceiveMessage(runCommand);
		void this.render();
	}

	/**
	 * Opens the page on what an act just did.
	 *
	 * The report is held for exactly one drawing: the next redraw is about the clone's state again, not about a pull that
	 * has since been read. Its lines are the tail of the log at the moment it is drawn, so the caller names the outcome and
	 * git names the details.
	 */
	report(held: { title: string; tone?: Report['tone'] }): void {
		this.held = { title: held.title, tone: held.tone ?? 'ok' };
		this.open();
	}

	refresh(): void {
		void this.render();
	}

	dispose(): void {
		this.opened?.dispose();
	}

	/** A command printed a line: the page follows it while it is open. */
	follow(): void {
		this.refresh();
	}

	private async render(): Promise<void> {
		const opened = this.opened;
		if (opened === undefined) {
			return;
		}
		const facts = await this.read();
		const focus = this.focus;
		const held = this.held;
		this.focus = undefined;
		this.held = undefined;
		const state = focus === undefined ? { ...facts, report: held } : { ...facts, report: held, focus };
		opened.webview.html = page(html(state), {
			title: SITE_PAGE_TITLE,
			script: commandScript,
			extraCss: PAGE_STYLE
		});
	}
}

const plural = (count: number, one: string): string => `${count} ${count === 1 ? one : `${one}s`}`;

/** A button in the application's own dress. The page's acts are commands, so each one carries its own. */
function button(
	label: string,
	command: string,
	options: { kind?: 'primary' | 'link'; mark?: string; args?: unknown; title?: string } = {}
): string {
	const cls = `az-btn${options.kind === 'primary' ? ' az-btn--primary' : options.kind === 'link' ? ' az-btn--link' : ''}`;
	const args = options.args === undefined ? '' : ` data-args="${escapeHtml(JSON.stringify(options.args))}"`;
	const title = options.title === undefined ? '' : ` title="${escapeHtml(options.title)}"`;
	const mark = options.mark === undefined ? '' : icon(options.mark);
	return `<button type="button" class="${cls}"${title} data-command="${escapeHtml(command)}"${args}>${mark}<span>${escapeHtml(label)}</span></button>`;
}

/** One small card: what it is, what it says, and the acts that change it. Its state is a coloured dot, not a box. */
function card(label: string, value: string, acts = '', options: { mono?: boolean; tone?: 'ok' | 'warn' } = {}): string {
	const tone = options.tone === undefined ? '' : ` site-card--${options.tone}`;
	return `<div class="site-card${tone}"><span class="site-card__label">${escapeHtml(label)}</span><span class="site-card__value${
		options.mono === true ? ' site-card__value--mono' : ''
	}">${escapeHtml(value)}</span><span class="site-card__acts">${acts}</span></div>`;
}

/** The line under the title: the clone's facts, and the two figures that say how far it has drifted. */
function meta(repo: RepoFacts): string {
	if (!repo.ready) {
		return `<div class="site-meta"><span class="site-meta__repo">${escapeHtml(whereLine(repo))}</span></div>`;
	}
	const where = repo.where ?? 'temcocontrols/temco-learn';
	const facts = [
		metaLink(where, 'temcoLearn.site.remote', undefined, true),
		escapeHtml(repo.branch ?? 'no branch')
	];
	if (repo.commit !== undefined) {
		facts.push(metaLink(repo.commit, 'temcoLearn.site.remote', { path: `commit/${repo.commit}` }, true));
		facts.push(escapeHtml(`committed ${ago(repo.at)}`));
	}
	const figures = [
		`<span class="site-meta__figure"><span class="site-meta__value">${String(repo.behind)}</span> ${repo.behind === 1 ? 'commit' : 'commits'} behind origin</span>`,
		repo.changes.length === 0
			? `<span class="site-meta__figure"><span class="site-meta__value">0</span> paths changed</span>`
			: `<span class="site-meta__figure"><span class="site-meta__value">${String(repo.changes.length)}</span> ${metaLink(
					repo.changes.length === 1 ? 'path changed' : 'paths changed',
					'temcoLearn.publishing'
				)}</span>`
	];
	return `<div class="site-meta"><span class="site-meta__repo">${facts.join(' · ')}</span>${figures.join('')}</div>`;
}

const ANSI = /\u001b\[[0-9;?]*[A-Za-z]|\u001b\][^\u0007\u001b]*(?:\u0007|\u001b\\)/gu;
const CONTROL = /[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/gu;
/** Glyphs a build or a dev server prints to decorate its own output; the words they decorate are kept. */
const DECORATION = /[➜▶✔✓ℹ⚠→←↑↓│┃┌┐└┘─━]/gu;

/**
 * One line of a command's output, as a person should read it.
 *
 * The raw line keeps whatever the tool printed — colour codes, a box drawn with characters, a `[site]` prefix of ours — and
 * none of that belongs on a page: an escape sequence arrives as `ΓÇö` in a console that is not a terminal. So the colours
 * go, the control characters go, our own prefixes go, and the glyphs a tool uses to decorate a line go with them.
 */
export function cleanLine(text: string): string {
	return text
		.replace(ANSI, '')
		.replace(CONTROL, '')
		.replace(/\[(?:site|git)\]\s*/gu, '')
		.replace(/(^|\s)\$\s+/gu, '$1')
		.replace(DECORATION, '')
		.replace(/[ \t]+$/gu, '')
		.trim();
}

/**
 * The builds on this machine the site does not serve: the one act this page owns that nothing else does.
 *
 * A build is a folder inside a project; the site is a repository that gets published, so a build is invisible to the
 * website until it is copied in — and the copy needs the version, which only a person knows. That is what `Add…` is, and
 * it is why the act lives here rather than in the panel: it writes into the site, like clone, build and publish do.
 */
function adds(state: SitePageFacts): string {
	const rows = state.pending.map(
		(build) =>
			`<div class="site-add__row"><span class="site-add__name">${escapeHtml(build.title)}</span><span class="site-add__why">${escapeHtml(
				build.why
			)}</span>${button('Add…', 'temcoLearn.addBuild', { kind: 'link', args: build.folder })}</div>`
	);
	const body =
		rows.length === 0
			? '<p class="az-block__note">Every build on this machine is on the site already. A build you make in Temco Docs appears here.</p>'
			: rows.join('');
	return [
		section({
			title: 'Builds not on the site',
			desc: 'Adding copies a build into the site repository as a new version. It does not publish it — that is a separate act, and yours.',
			actions: button('Open Temco Docs', 'temcoDocs.builds', { kind: 'link', mark: 'external' })
		}),
		`<div class="site-add${state.focus === 'add' ? ' site-add--focus' : ''}">${body}</div>`
	].join('\n');
}

/**
 * What changed in the clone, and what may be done about each kind.
 *
 * The figure in the meta line says how many paths; this says *which*, because "commit or discard them first" is not advice
 * a person can act on without knowing that five of the six were written by the last build. The grouping is the point: an
 * edit is somebody's work and is the only thing a pull refuses to run over.
 */
const KIND_GROUP = [
	{ kind: 'edit' as const, title: 'Yours', why: 'changed by hand — a pull stops here, so commit or discard these first' },
	{ kind: 'generated' as const, title: 'Written by the build', why: 'the catalog, the search index and the content JSONs — rebuilt by npm run build' },
	{ kind: 'noise' as const, title: 'Line endings only', why: 'no content difference at all — Windows reports these after every build' }
];

function changes(state: SitePageFacts): string {
	const repo = state.repo;
	if (!repo.ready || repo.changes.length === 0) {
		return '';
	}
	const groups = KIND_GROUP.map((group) => ({ ...group, rows: repo.changes.filter((change) => change.kind === group.kind) })).filter(
		(group) => group.rows.length > 0
	);
	const disposable = repo.changes.filter((change) => change.kind !== 'edit').map((change) => change.path);
	const edits = repo.changes.filter((change) => change.kind === 'edit').length;

	const body = groups
		.map((group) => {
			const shown = group.rows.slice(0, 8);
			const rows = shown.map(
				(change) =>
					`<div class="site-change"><span class="site-change__code">${escapeHtml(change.code)}</span><span class="site-change__path">${escapeHtml(
						change.path
					)}</span><span class="site-change__acts">${button('Diff', 'temcoLearn.site.diff', {
						kind: 'link',
						args: change.path
					})}${button('Discard', 'temcoLearn.site.discard', { kind: 'link', args: { paths: [change.path] } })}</span></div>`
			);
			const rest =
				group.rows.length > shown.length
					? `<span class="site-change__more">and ${plural(group.rows.length - shown.length, 'more path')} of the same kind</span>`
					: '';
			const bulk =
				group.kind === 'edit'
					? ''
					: button(`Discard all ${group.rows.length}`, 'temcoLearn.site.discard', { kind: 'link', args: { paths: group.rows.map((change) => change.path) } });
			return `<div class="site-changes__group"><span class="site-changes__kind">${escapeHtml(group.title)}</span><span class="site-changes__why">${escapeHtml(
				group.why
			)}</span>${bulk}</div>${rows.join('')}${rest}`;
		})
		.join('');

	return [
		section({
			title: 'Changes in the clone',
			desc: 'Everything git reports as different from the last commit, grouped by what wrote it.',
			actions:
				button(edits === 0 ? 'Commit and push' : `Commit and push ${plural(edits, 'edit')}`, 'temcoLearn.site.commit', { kind: 'link', mark: 'upload' }) +
				(disposable.length === 0
					? ''
					: button(`Discard ${plural(disposable.length, 'build path')}`, 'temcoLearn.site.discard', { kind: 'link', args: { paths: disposable } }))
		}),
		`<div class="site-changes${state.focus === 'changes' ? ' site-changes--focus' : ''}">${body}</div>`
	].join('\n');
}

export function html(state: SitePageFacts): string {
	const repo = state.repo;
	const url = siteUrl(state.port);
	const running = state.status.state === 'running';
	const starting = state.status.state === 'starting';
	const failed = state.status.state === 'failed';

	// The title block is the state: one word about the server, and the act that comes next. The reason a start failed is
	// said once, in the callout at the top of the page — never twice.
	const statusText = starting
		? `Starting… · ${url}`
		: running
			? `Running · ${url}`
			: failed
				? 'Failed'
				: repo.ready
					? 'Stopped'
					: 'Nothing here yet';

	const description =
		'The documentation site this module publishes into: its own repository, React 19, Fluent UI and Markdown, built by Vite and served on one port.';

	const actions: { label: string; command: string; args?: unknown; mark?: string; kind?: 'primary' | 'link' }[] = [];
	if (!repo.ready) {
		actions.push({ label: 'Clone temco-learn', command: 'temcoLearn.site.clone', mark: 'download', kind: 'primary' });
		actions.push({ label: 'Use an existing clone…', command: 'temcoLearn.site.useExisting', mark: 'folder' });
	} else if (running) {
		actions.push({ label: 'Open', command: 'temcoLearn.site.preview', mark: 'globe', kind: 'primary' });
		actions.push({ label: 'Stop', command: 'temcoLearn.site.stop', mark: 'close' });
	} else if (failed) {
		actions.push({ label: 'Try again', command: 'temcoLearn.site.start', mark: 'refresh', kind: 'primary' });
		actions.push({ label: 'Open the log', command: 'temcoLearn.site.showLog', mark: 'output' });
	} else if (!repo.installed) {
		actions.push({ label: 'Install dependencies', command: 'temcoLearn.site.install', mark: 'package', kind: 'primary' });
	} else if (!repo.built) {
		actions.push({ label: 'Build the site', command: 'temcoLearn.site.build', mark: 'layers', kind: 'primary' });
	} else {
		actions.push({ label: 'Start the site', command: 'temcoLearn.site.start', mark: 'play', kind: 'primary' });
	}
	if (repo.ready && repo.behind > 0) {
		actions.push({ label: `Pull ${plural(repo.behind, 'commit')}`, command: 'temcoLearn.site.pull', mark: 'sync' });
	}
	if (repo.ready) {
		// Beside the pull, because it is the question the pull answers: is there anything new, really? The figure here is a
		// comparison against `origin/main`, and that only moves when something fetches.
		actions.push({ label: 'Refresh', command: 'temcoLearn.site.refresh', mark: 'refresh' });
	}

	const head = hero({
		title: SITE_PAGE_TITLE,
		mark: 'globe',
		desc: description,
		descWide: true,
		note: { text: statusText, mark: failed ? 'warning' : running ? 'play' : 'sync', mono: true },
		actions
	});

	// Nothing is cloned: two ways to get one, where it will go, and what cloning brings. No cards that pretend to work.
	if (!repo.ready) {
		return [
			head,
			meta(repo),
			section({
				title: 'This machine',
				desc: 'One folder holds the clone, and one port serves it. Both are settings, and both are yours to move.'
			}),
			`<div class="site-cards">${card(
				'Folder',
				repo.folder,
				button('Change', 'temcoLearn.site.choose', { kind: 'link' }) + button('Open Folder', 'temcoLearn.site.folder', { kind: 'link' }),
				{ mono: true }
			)}${card('Port', String(state.port), button('Change', 'temcoLearn.site.port', { kind: 'link' }), { mono: true })}</div>`,
			callout({
				title: 'What cloning brings',
				desc: 'npm install, npm run build, and a server on one port: the built pages, or Vite with reload. Nothing outside that folder is touched, and nothing is pushed back to GitHub.',
				mark: 'info'
			})
		].join('\n');
	}

	const serverState = starting
		? `starting · ${url}`
		: running
			? `running · ${url}`
			: failed
				? `failed${state.status.reason === undefined ? '' : ` · ${state.status.reason}`}`
				: `stopped · ${url}`;

	// Two places the site can be read, named for the difference a person feels: a tab here, or the browser they already
	// have open. Both start the server if it is down, which is why they sit beside `Start` and not inside it.
	const openHere = button('Open', 'temcoLearn.site.preview', {
		mark: 'globe',
		title: 'Open the site in a tab in this window, starting the server first if it is not running'
	});
	const openInBrowser = button('Open in Browser', 'temcoLearn.site.open', {
		mark: 'external',
		title: `Open the site in your browser at ${url}, starting the server first if it is not running`
	});

	const serverActs = running
		? button('Stop', 'temcoLearn.site.stop') + openHere + openInBrowser
		: `${button(starting ? 'Starting…' : 'Start', 'temcoLearn.site.start', { kind: repo.built ? 'primary' : undefined })}${openHere}${openInBrowser}`;

	// The add section comes first when the page was opened for it — that is what the four buttons that mean "add a build"
	// promise — and sits after the machine otherwise, where it reads as the next step of the same lifecycle.
	const addsSection = adds(state);
	// The changes come before the add section: a pull refused because the clone is dirty is the commonest way into this page.
	const changesSection = changes(state);

	return [
		head,
		meta(repo),
		// One message, at the top, in the tinted callout: what went wrong and the act that answers it.
		failed && state.status.reason !== undefined
			? callout({
					title: 'The server did not come up',
					desc: state.status.reason,
					mark: 'warning',
					actions: button('Try again', 'temcoLearn.site.start') + button('Open the full log', 'temcoLearn.site.showLog', { kind: 'link' })
				})
			: '',
		// Activity is second, not last: every act on this page writes here, so the answer to "what happened when I pressed
		// that?" has to be where the press left the eye instead of below four sections about the machine. The outcome of the
		// act that opened the page is its first line, and the tabs below it are the whole story.
		state.report === undefined ? '' : report(state.report),
		section({
			title: 'Activity',
			desc: 'What a clone, a pull, a build or a server printed in this window, and what the last publish attempt said.',
			actions:
				button('Clear', 'temcoLearn.site.clearLog', { kind: 'link' }) +
				button('Open the full log', 'temcoLearn.site.showLog', { kind: 'link', mark: 'output' })
		}),
		activity(state),
		state.focus === 'changes' ? changesSection : '',
		state.focus === 'add' ? addsSection : '',
		section({
			title: 'This machine',
			desc: 'The clone on disk, and the one server that shows it — read from the folder every time this page is drawn.'
		}),
		`<div class="site-server"><span class="site-server__state">${escapeHtml(serverState)}</span><span class="site-server__acts"><span class="site-server__links">${button(
			'Repository',
			'temcoLearn.site.remote',
			{ kind: 'link' }
		)}${button('Terminal', 'temcoLearn.site.terminal', { kind: 'link' })}</span>${serverActs}</span></div>`,
		`<div class="site-cards">${card('Folder', repo.folder, button('Change', 'temcoLearn.site.choose', { kind: 'link' }) + button(
			'Open Folder',
			'temcoLearn.site.folder',
			{ kind: 'link' }
		), { mono: true })}${card('Port', String(state.port), button('Change', 'temcoLearn.site.port', { kind: 'link' }), {
			mono: true
		})}${card(
			'Installed',
			repo.installed ? (repo.installedAt === undefined ? 'installed' : ago(repo.installedAt)) : 'not installed yet',
			button(repo.installed ? 'Reinstall' : 'Install', 'temcoLearn.site.install', { kind: 'link' }),
			{ tone: repo.installed ? 'ok' : 'warn' }
		)}${card(
			'Built',
			repo.built ? (repo.builtAt === undefined ? 'built' : ago(repo.builtAt)) : 'not built yet',
			button(repo.built ? 'Rebuild' : 'Build', 'temcoLearn.site.build', { kind: 'link' }),
			{ tone: repo.built ? 'ok' : 'warn' }
		)}</div>`,
		state.focus === 'add' ? '' : addsSection,
		state.focus === 'changes' ? '' : changesSection
	]
		.filter((part) => part !== '')
		.join('\n');
}

/**
 * What an act just did: one line, where the eye already is, above the activity area that holds the detail.
 *
 * The lines themselves are not repeated here — the console is directly below, and the same four lines twice reads as two
 * different things having happened. This is the sentence a person needs ("Pulled 16 commits"), with the tone of it.
 */
function report(held: Report): string {
	return `<div class="site-report${held.tone === 'warn' ? ' site-report--warn' : ''}"><span class="site-report__title">${escapeHtml(
		held.title
	)}</span></div>`;
}

/** Where the clone is and what it last did: the facts the title block carries instead of a sentence. */
function whereLine(repo: RepoFacts): string {
	if (!repo.ready) {
		return `${repo.where ?? 'temcocontrols/temco-learn'} · not on this machine yet`;
	}
	const parts = [repo.where ?? 'no origin', repo.branch ?? 'no branch'];
	if (repo.commit !== undefined) {
		parts.push(`${repo.commit}, committed ${ago(repo.at)}`);
	}
	return parts.join(' · ');
}

/**
 * How many lines the activity area shows before anybody asks for the rest.
 *
 * It is the second thing on the page now, so it cannot grow with the log: a build prints hundreds of lines, and a section
 * that tall would push the machine it is about off the screen. Five is what an act says — "pulling…", "set aside two, removed
 * two", "success" — and the rest is one press away.
 */
const ACTIVITY_LINES = 5;

/** One tabbed activity area: what the module did here, and what the last publish said. Panes switch without a script. */
function activity(state: SitePageFacts): string {
	const output = consoleOf(state.log, 'Nothing has been run in this window yet. A clone, a pull, a build and a server all write here.');
	const publish = consoleOf(state.publish, 'Nothing has been published from this window yet. The Publishing page runs a publish and writes here.');
	// The fold is a checkbox and two labels, the way the tabs are radios and two labels: nothing on this page needs a script
	// to say what it is showing, and a `Show more` that needs one would be the only act here that does.
	const more = cleanLines(state.log).length > ACTIVITY_LINES || cleanLines(state.publish).length > ACTIVITY_LINES;
	const toggle = more
		? `<label class="site-tabs__toggle" for="site-more"><span class="site-tabs__toggle-more">${icon('chevron-down')}Show more</span><span class="site-tabs__toggle-less">${icon('chevron-down')}Show less</span></label>`
		: '';
	const panes = [
		`<div class="site-tabs__pane site-tab-pane--output">${output}</div>`,
		`<div class="site-tabs__pane site-tab-pane--publish">${publish}</div>`
	];
	return `<div class="site-tabs"><input type="radio" name="site-tab" id="site-tab-output" class="site-tabs__input" checked><input type="radio" name="site-tab" id="site-tab-publish" class="site-tabs__input"><input type="checkbox" id="site-more" class="site-tabs__input"><div class="site-tabs__bar"><label class="site-tabs__label" for="site-tab-output">Output</label><label class="site-tabs__label" for="site-tab-publish">Publish</label>${toggle}</div>${panes.join(
		''
	)}</div>`;
}

/** A log as a person should read it: the lines that say something, in the order they were written. */
function cleanLines(log: readonly string[]): string[] {
	return log.map(cleanLine).filter((line) => line !== '');
}

/**
 * The console: the lines as a person should read them, on a background of their own and no box around them.
 *
 * Two copies while there is more than a fold's worth: the last five, and the whole log. Only one is drawn — the checkbox
 * above decides which — so the fold costs five duplicated lines rather than a script that measures text.
 */
function consoleOf(log: readonly string[], empty: string): string {
	const lines = cleanLines(log);
	if (lines.length === 0) {
		return `<p class="az-block__note">${escapeHtml(empty)}</p>`;
	}
	const tail = `<pre class="site-console site-console--tail">${escapeHtml(lines.slice(-ACTIVITY_LINES).join('\n'))}</pre>`;
	if (lines.length <= ACTIVITY_LINES) {
		return tail;
	}
	return `${tail}<pre class="site-console site-console--all">${escapeHtml(lines.join('\n'))}</pre>`;
}
