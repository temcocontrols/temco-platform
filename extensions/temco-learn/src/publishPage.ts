// Publishing — the page behind the Publish row.
//
// The row is an act, and an act that changes what the world sees deserves more than a click: this page says where the
// site goes, what publishing does step by step, how much is waiting, and what the last attempt printed. Publishing itself
// stays the same command the row and the Overview page run.

import * as vscode from 'vscode';
import { PublishLog } from './publishLog';
import { siteRepo } from './siteRepo';
import { ago } from './state';
import { callout, cards, code, commandScript, escapeHtml, hero, page, pageColumn, runCommand, section } from './ui';

export const PUBLISH_VIEW_TYPE = 'temcoLearn.publishing';

/** The page's own rules: the brand bar a section title carries on every page of ours, one card per subject, and the fold. */
export const PAGE_STYLE = `
.az-section__title { position: relative; padding-left: 10px; }
.az-section__title::before { content: ''; position: absolute; left: 0; top: 50%; transform: translateY(-50%); width: 2px; height: 12px; border-radius: 1px; background: var(--az-blue, #0078d4); }
.pub-card { display: grid; gap: var(--sp-2); padding: var(--sp-3) var(--sp-4); border-radius: var(--r-2); background: var(--surface-card); }
.pub-head { display: flex; flex-wrap: wrap; align-items: baseline; gap: 0 var(--sp-3); }
.pub-head__where { font-family: var(--font-mono); font-size: 12.5px; }
.pub-head__meta { color: var(--ink-3); font-size: 11.5px; line-height: 18px; }
.pub-rule { height: 1px; background: var(--hairline); }
.pub-list { display: grid; }
.pub-path { display: grid; grid-template-columns: 18px minmax(0, 1fr); align-items: baseline; gap: var(--sp-2); }
.pub-path__code { color: var(--ink-3); font-family: var(--font-mono); font-size: 11px; }
.pub-path__file { justify-self: start; min-width: 0; font-family: var(--font-mono); font-size: 11.5px; overflow-wrap: anywhere; text-align: left; }
.pub-more > summary { padding: 2px 0; color: var(--az-blue, #0078d4); font-size: 11.5px; cursor: pointer; }
.pub-more > summary:hover { text-decoration: underline; }
.pub-more > summary:focus-visible { outline: 1px solid var(--az-blue, #0078d4); outline-offset: 1px; }
.pub-foot { display: flex; flex-wrap: wrap; align-items: baseline; gap: var(--sp-3); color: var(--ink-3); font-size: 11.5px; }
.pub-fact { display: grid; grid-template-columns: 92px minmax(0, 1fr); align-items: baseline; gap: var(--sp-2); color: var(--ink-2); font-size: 12px; line-height: 18px; }
.pub-fact__label { color: var(--ink-3); font-size: 10.5px; letter-spacing: .06em; text-transform: uppercase; }
.pub-address { justify-self: start; font-family: var(--font-mono); font-size: 13px; }
.pub-address--none { color: var(--ink-3); }
`;

/** Everything the page says, gathered once so the page itself decides nothing about where it lives. */
export interface PublishFacts {
	where: string | undefined;
	base: string | undefined;
	commit: string | undefined;
	at: string | undefined;
	branch: string | undefined;
	/** Commits here that origin does not have: a push would carry them too. */
	ahead: number;
	pending: number;
	/** The paths a publish would commit, in git's own two-letter codes. */
	changes: readonly { code: string; path: string }[];
	log: readonly string[];
	logAt: string | undefined;
}

export class PublishPage implements vscode.Disposable {
	private opened: vscode.WebviewPanel | undefined;

	constructor(
		private readonly read: () => Promise<PublishFacts>,
		private readonly log: PublishLog
	) { }

	/** Opens the page, or brings it forward. `restored` is the tab the window gave back. */
	open(restored?: vscode.WebviewPanel): void {
		if (this.opened !== undefined) {
			this.opened.reveal(pageColumn());
			void this.render();
			return;
		}
		// A restored tab is drawn into rather than replaced: it keeps its place in the strip.
		this.opened = restored ?? vscode.window.createWebviewPanel(PUBLISH_VIEW_TYPE, 'Publishing', pageColumn(), {
			enableScripts: true,
			localResourceRoots: []
		});
		this.opened.webview.options = { enableScripts: true, localResourceRoots: [] };
		this.opened.iconPath = new vscode.ThemeIcon('cloud-upload');
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

	/** Publishing writes lines as it goes: the page follows them while it is open. */
	follow(lines: readonly string[]): void {
		for (const line of lines) {
			this.log.append(line);
		}
		this.refresh();
	}

	private async render(): Promise<void> {
		const opened = this.opened;
		if (opened === undefined) {
			return;
		}
		opened.webview.html = page(html(await this.read()), { title: 'Publishing', script: commandScript, extraCss: PAGE_STYLE });
	}
}

const plural = (count: number, one: string): string => `${count} ${count === 1 ? one : `${one}s`}`;

/** A word that runs one of this module's commands, drawn as a link. */
function link(label: string, command: string): string {
	return `<button type="button" class="az-btn az-btn--link" data-command="${escapeHtml(command)}"><span>${escapeHtml(label)}</span></button>`;
}

/** A word that opens GitHub — the remote, a commit, or one file in it: one command knows the repository, so all three use it. */
function github(path: string, label: string, cls = ''): string {
	const args = path === '' ? '' : ` data-args="${escapeHtml(JSON.stringify({ path }))}"`;
	return `<button type="button" class="az-btn az-btn--link${cls === '' ? '' : ' ' + cls}" data-command="temcoLearn.site.remote"${args}>${escapeHtml(
		label
	)}</button>`;
}

/** The steps of a publish, in the order they happen. */
function steps(pending: number): string {
	return cards([
		{
			title: 'Build',
			desc: "Temco Docs writes the site into the project's own `dist` folder.",
			mark: 'play',
			command: 'temcoDocs.builds',
			go: 'Open Temco Docs'
		},
		{
			title: 'Add',
			desc: 'The build is copied into the site repository as one version of one project.',
			mark: 'plus',
			command: 'temcoLearn.addBuilds',
			go: 'Choose a build'
		},
		{
			title: 'Publish',
			desc: 'The clone is committed, and the commit is pushed at the main branch.',
			mark: 'upload',
			command: 'temcoLearn.publishNow',
			go: pending === 0 ? 'Publish again' : `Publish ${plural(pending, 'change')}`,
			note: pending === 0 ? 'Nothing is waiting' : `${plural(pending, 'change')} waiting`
		},
		{
			title: 'Check',
			desc: 'GitHub Pages serves the branch within a minute, at the same address as always.',
			mark: 'globe',
			command: 'temcoLearn.openPublished',
			go: 'Open in browser'
		}
	]);
}

/** The clone's own facts, and the paths a commit would take: the answer to "what am I about to push?". */
function repository(state: PublishFacts): string {
	const where = state.where ?? 'temcocontrols/temco-learn';
	const committed = state.commit === undefined ? undefined : github('commit/' + state.commit, state.commit);
	const distance = state.ahead === 0 ? 'nothing unpushed' : `${plural(state.ahead, 'commit')} unpushed`;
	const head = `<div class="pub-head">${github('', where, 'pub-head__where')}<span class="pub-head__meta">${escapeHtml(
		state.branch ?? 'main'
	)}</span>${committed === undefined ? '' : committed}<span class="pub-head__meta">${
		state.at === undefined ? '' : '· ' + escapeHtml(ago(state.at))
	}</span></div>`;

	if (state.changes.length === 0) {
		return `<div class="pub-card">${head}<div class="pub-rule"></div><p class="az-block__note">The clone matches the last publish, so a publish commits nothing and pushes the same commit.</p><div class="pub-foot"><span>${escapeHtml(
			distance
		)}</span>${link('Open the clone', 'temcoLearn.site.folder')}</div></div>`;
	}

	// Five paths in the open, the rest one click away: a publish that touches forty files must not fill the page, and the
	// fold is a native `<details>`, so it opens in place without a script or a round-trip.
	const shown = state.changes.slice(0, 5);
	const rest = state.changes.slice(5);
	const row = (change: { code: string; path: string }): string =>
		`<div class="pub-path"><span class="pub-path__code">${escapeHtml(change.code)}</span>${github(
			'blob/' + (state.branch ?? 'main') + '/' + change.path,
			change.path,
			'pub-path__file'
		)}</div>`;
	return [
		`<div class="pub-card">`,
		head,
		`<div class="pub-rule"></div>`,
		`<span class="pub-head__meta">${escapeHtml(plural(state.changes.length, 'path'))} in this commit</span>`,
		`<div class="pub-list">${shown.map(row).join('')}</div>`,
		rest.length === 0
			? ''
			: `<details class="pub-more"><summary>Show ${escapeHtml(plural(rest.length, 'more path'))}</summary><div class="pub-list">${rest
					.map(row)
					.join('')}</div></details>`,
		`<div class="pub-rule"></div>`,
		`<div class="pub-foot"><span>${escapeHtml(distance)}</span>${link('Open the clone', 'temcoLearn.site.folder')}${link(
			'Terminal',
			'temcoLearn.site.terminal'
		)}</div>`,
		`</div>`
	]
		.filter((part) => part !== '')
		.join('\n');
}

/**
 * Where the site is published: the address is the fact, so it is the link.
 *
 * A card rather than a band of four cells: the address needs the room, and the three facts under it are read in one pass —
 * served from where, published when, and how much is waiting.
 */
function whereItGoes(state: PublishFacts): string {
	const at = state.commit === undefined ? 'never' : `${state.commit}, ${ago(state.at)}`;
	const address =
		state.base === undefined
			? '<span class="pub-address pub-address--none">none yet</span>'
			: `<button type="button" class="az-btn az-btn--link pub-address" data-command="temcoLearn.openPublished">${escapeHtml(
					state.base
				)}</button>`;
	const cell = (label: string, value: string): string =>
		`<div class="pub-fact"><span class="pub-fact__label">${escapeHtml(label)}</span><span>${value}</span></div>`;
	return [
		`<div class="pub-card">`,
		`<span class="pub-fact__label">Address</span>`,
		address,
		cell('Served from', 'main · built by GitHub Actions, handed to Pages'),
		cell('Last publish', at),
		cell('Waiting', state.pending === 0 ? 'nothing — the clone matches the last publish' : plural(state.pending, 'change')),
		`</div>`
	].join('\n');
}

/** The last publish's own words: the lines git printed, numbered rather than summarised. */
function log(state: PublishFacts): string {
	if (state.log.length === 0) {
		return `<p class="az-block__note">No publish has run in this window yet. Press Publish, and what git says appears here.</p>`;
	}
	const when = state.logAt === undefined ? '' : ` · ${ago(state.logAt)}`;
	return [
		`<p class="az-block__note">The last attempt${escapeHtml(when)}. Nothing here is uploaded anywhere else.</p>`,
		code({ language: 'Publish log', lines: state.log.map((text) => ({ text })) })
	].join('\n');
}

export function html(state: PublishFacts): string {
	const published = state.commit !== undefined;
	const desc = published
		? `Publishing commits the clone and pushes it at the main branch of ${state.where ?? 'the site repository'}. GitHub Actions then builds the site and hands the result to Pages, at the same address every time — and nothing is forced.`
		: 'The clone points at no GitHub repository, so there is nowhere to publish to: a publish would push an empty history at a real site.';
	const note = published
		? { text: `Last publish ${state.commit} · ${ago(state.at)}`, mark: 'clock', link: { command: 'temcoLearn.openPublished' } }
		: { text: 'Never published', mark: 'clock' };
	const waiting =
		state.pending === 0
			? callout({
					title: 'Nothing is waiting',
					desc: 'The clone matches the last publish. Publishing again is safe: it commits nothing and pushes the same commit.',
					mark: 'check'
				})
			: callout({
					title: `${plural(state.pending, 'change')} waiting to be published`,
					desc: 'The clone has changes the main branch does not. One press commits them and pushes the commit.',
					mark: 'warning',
					actions: `<button type="button" class="az-btn az-btn--primary" data-command="temcoLearn.publishNow"><span>Publish ${plural(
						state.pending,
						'change'
					)}</span></button>`
				});

	return [
		hero({
			eyebrow: 'Temco Learn',
			mark: 'upload',
			title: 'Publishing',
			desc,
			descWide: true,
			note,
			actions: [
				{
					label: state.pending === 0 ? 'Nothing to publish' : `Publish ${plural(state.pending, 'change')}`,
					command: 'temcoLearn.publishNow',
					mark: 'upload',
					kind: 'primary'
				}
			]
		}),
		waiting,
		section({ title: 'The repository', desc: 'What a push would carry, read from the clone itself — your working area is never staged here.' }),
		repository(state),
		section({ title: 'What publishing does', desc: 'The steps, in order. The first two happen in Temco Docs and in the panel.' }),
		steps(state.pending),
		section({ title: 'Where it goes', desc: 'GitHub Pages serves the main branch at the same address every time; GitHub Actions builds it.' }),
		whereItGoes(state),
		section({ title: 'The last attempt' }),
		log(state),
		`<p class="az-block__note">The site is the clone at ${escapeHtml(siteRepo())}. The preview runs that same clone, so what reads there is what gets published.</p>`
	].join('\n');
}
