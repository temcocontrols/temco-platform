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
.az-section__title { position: relative; padding-left: 10px; }
.az-section__title::before { content: ''; position: absolute; left: 0; top: 50%; transform: translateY(-50%); width: 2px; height: 12px; border-radius: 1px; background: var(--az-blue, #0078d4); }
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
#site-tab-output:checked ~ .site-tabs__bar label[for='site-tab-output'],
#site-tab-publish:checked ~ .site-tabs__bar label[for='site-tab-publish'] { color: var(--ink-1); border-bottom-color: var(--az-blue, #0078d4); }
#site-tab-output:focus-visible ~ .site-tabs__bar label[for='site-tab-output'],
#site-tab-publish:focus-visible ~ .site-tabs__bar label[for='site-tab-publish'] { outline: 1px solid var(--az-blue, #0078d4); outline-offset: 1px; }
#site-tab-output:checked ~ .site-tab-pane--output { display: block; }
#site-tab-publish:checked ~ .site-tab-pane--publish { display: block; }
.site-console { margin: 0; padding: var(--sp-3) var(--sp-4); border-radius: var(--r-2); background: var(--surface-card); background: color-mix(in srgb, var(--az-blue, #0078d4) 3%, var(--surface-card)); color: var(--ink-2); font-family: var(--font-mono); font-size: 11.5px; line-height: 18px; white-space: pre-wrap; overflow-wrap: anywhere; }
`;

/** The links in the meta line are buttons in the page's own dress: a command, never an `href` into the website. */
function metaLink(label: string, command: string, args?: unknown, mono = false): string {
	const data = args === undefined ? '' : ` data-args="${escapeHtml(JSON.stringify(args))}"`;
	return `<button type="button" class="site-meta__link${mono ? ' site-meta__repo' : ''}" data-command="${escapeHtml(command)}"${data}>${escapeHtml(label)}</button>`;
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
}

export class SitePage implements vscode.Disposable {
	private opened: vscode.WebviewPanel | undefined;

	constructor(private readonly read: () => Promise<SitePageFacts>) { }

	open(): void {
		if (this.opened !== undefined) {
			this.opened.reveal(pageColumn());
			void this.render();
			return;
		}
		this.opened = vscode.window.createWebviewPanel(SITE_VIEW_TYPE, SITE_PAGE_TITLE, pageColumn(), {
			enableScripts: true,
			localResourceRoots: []
		});
		this.opened.onDidDispose(() => {
			this.opened = undefined;
		});
		this.opened.webview.onDidReceiveMessage(runCommand);
		void this.render();
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
		opened.webview.html = page(html(await this.read()), { title: SITE_PAGE_TITLE, script: commandScript, extraCss: PAGE_STYLE });
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
		section({
			title: 'Activity',
			desc: 'What a clone, a pull, a build or a server printed in this window, and what the last publish attempt said.',
			actions:
				button('Clear', 'temcoLearn.site.clearLog', { kind: 'link' }) +
				button('Open the full log', 'temcoLearn.site.showLog', { kind: 'link', mark: 'output' })
		}),
		activity(state)
	]
		.filter((part) => part !== '')
		.join('\n');
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

/** One tabbed activity area: what the module did here, and what the last publish said. Panes switch without a script. */
function activity(state: SitePageFacts): string {
	const output = consoleOf(state.log, 'Nothing has been run in this window yet. A clone, a pull, a build and a server all write here.');
	const publish = consoleOf(state.publish, 'Nothing has been published from this window yet. The Publishing page runs a publish and writes here.');
	const panes = [
		`<div class="site-tabs__pane site-tab-pane--output">${output}</div>`,
		`<div class="site-tabs__pane site-tab-pane--publish">${publish}</div>`
	];
	return `<div class="site-tabs"><input type="radio" name="site-tab" id="site-tab-output" class="site-tabs__input" checked><input type="radio" name="site-tab" id="site-tab-publish" class="site-tabs__input"><div class="site-tabs__bar"><label class="site-tabs__label" for="site-tab-output">Output</label><label class="site-tabs__label" for="site-tab-publish">Publish</label></div>${panes.join(
		''
	)}</div>`;
}

/** The console: the lines as a person should read them, on a background of their own and no box around them. */
function consoleOf(log: readonly string[], empty: string): string {
	const lines = log.map(cleanLine).filter((line) => line !== '');
	if (lines.length === 0) {
		return `<p class="az-block__note">${escapeHtml(empty)}</p>`;
	}
	return `<pre class="site-console">${lines.map((line) => escapeHtml(line)).join('\n')}</pre>`;
}
