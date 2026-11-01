// Publishing — the page behind the Publish row.
//
// The row is an act, and an act that changes what the world sees deserves more than a click: this page says where the
// site goes, what publishing does step by step, how much is waiting, and what the last attempt printed. Publishing itself
// stays the same command the row and the Overview page run.

import * as vscode from 'vscode';
import { PublishLog } from './publishLog';
import { siteRepo } from './siteRepo';
import { ago } from './state';
import { callout, cards, code, commandScript, escapeHtml, hero, icon, page, pageColumn, runCommand, section } from './ui';

export const PUBLISH_VIEW_TYPE = 'temcoLearn.publishing';

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

	open(): void {
		if (this.opened !== undefined) {
			this.opened.reveal(pageColumn());
			void this.render();
			return;
		}
		this.opened = vscode.window.createWebviewPanel(PUBLISH_VIEW_TYPE, 'Publishing', pageColumn(), {
			enableScripts: true,
			localResourceRoots: []
		});
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
		opened.webview.html = page(html(await this.read()), { title: 'Publishing', script: commandScript });
	}
}

const plural = (count: number, one: string): string => `${count} ${count === 1 ? one : `${one}s`}`;

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
	const cell = (title: string, value: string, mark: string, mono = false): string =>
		`<div class="az-fact"><span class="az-fact__title">${icon(mark, 'icon--sm')}${escapeHtml(title)}</span><span class="az-fact__value${
			mono ? ' az-fact__value--mono' : ''
		}">${escapeHtml(value)}</span></div>`;
	const distance = state.ahead === 0 ? 'nothing unpushed' : `${plural(state.ahead, 'commit')} unpushed`;
	const band = `<div class="az-facts">${cell('Remote', state.where ?? 'no GitHub origin', 'repo', true)}${cell(
		'Branch',
		state.branch ?? 'main',
		'branch'
	)}${cell('HEAD', state.commit ?? 'nothing committed', 'clock', true)}${cell('Unpushed', distance, 'upload')}</div>`;
	if (state.changes.length === 0) {
		return `${band}<p class="az-block__note">The clone matches the last publish, so a publish commits nothing and pushes the same commit.</p>`;
	}
	const shown = state.changes.slice(0, 8);
	const more = state.changes.length - shown.length;
	const rows = shown
		.map(
			(change) =>
				`<div class="az-entry"><span class="az-entry__icon">${icon('document')}</span><div class="az-entry__main"><span class="az-entry__title">${escapeHtml(
					change.path
				)}</span><span class="az-entry__meta">${escapeHtml(change.code)}</span></div></div>`
		)
		.join('');
	return [
		band,
		`<div class="az-entries">${rows}</div>`,
		more > 0 ? `<p class="az-block__note">${plural(more, 'more path')} in this publish.</p>` : ''
	]
		.filter((part) => part !== '')
		.join('\n');
}

/** The address, the branch and the last publish, on one line: the three facts a person checks before publishing. */
function facts(state: PublishFacts): string {
	const cell = (title: string, value: string, mark: string, mono = false): string =>
		`<div class="az-fact"><span class="az-fact__title">${icon(mark, 'icon--sm')}${escapeHtml(title)}</span><span class="az-fact__value${
			mono ? ' az-fact__value--mono' : ''
		}">${escapeHtml(value)}</span></div>`;
	const at = state.commit === undefined ? 'never' : `${state.commit}, ${ago(state.at)}`;
	return `<div class="az-facts">${cell('Address', state.base ?? 'none yet', 'globe', true)}${cell(
		'Branch',
		'main · served from / by GitHub Pages',
		'repo'
	)}${cell('Last publish', at, 'clock')}${cell('Waiting', state.pending === 0 ? 'nothing' : plural(state.pending, 'change'), 'sync')}</div>`;
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
		section({ title: 'Where it goes' }),
		facts(state),
		section({ title: 'The last attempt' }),
		log(state),
		`<p class="az-block__note">The site is the clone at ${escapeHtml(siteRepo())}. The preview runs that same clone, so what reads there is what gets published.</p>`
	].join('\n');
}
