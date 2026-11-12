// Temco Learn - the site, from the inside.
//
// The site is its own repository (`temcocontrols/temco-learn`): React, Fluent UI, Markdown, built by Vite, published to
// GitHub Pages. This module is a client of that checkout and owns none of it - it runs the site's servers, builds it,
// shows it in the editor, writes new builds into it, and commits the result. Authoring stays in `temco-docs`, which owns
// the registry, the editor and the build: one direction only, this module calls `temcoDocs.buildSite` when it needs a
// build and `temco-docs` never calls back.
//
// Every answer this module gives lands in the preview's own strip, next to the site it is about. Nothing is announced in
// a notification: a person who pressed Add or Publish is already looking at the preview, and a corner message that
// disappears is not where a version number belongs.

import * as fs from 'fs';
import * as path from 'path';
import * as vscode from 'vscode';
import { findArtifacts } from './artifacts';
import { Build, findBuilds } from './builds';
import { DownloadPage, DOWNLOAD_VIEW_TYPE } from './downloadPage';
import { OverviewPage, OVERVIEW_VIEW_TYPE } from './overview';
import { Preview } from './preview';
import { PublishLog } from './publishLog';
import { PublishFacts, PublishPage, PUBLISH_VIEW_TYPE } from './publishPage';
import { ensureRepo, publishSite, PublishSink } from './publish';
import { Server } from './server';
import { importBuild, readSite, Site, workRoot } from './site';
import { pageUrl, repoReady, sitePort, siteRepo } from './siteRepo';
import { discardOf, editsOf, forgetFetch, readRepoFacts } from './siteFacts';
import { SiteLog } from './siteLog';
import { SitePage, SitePageFacts, SITE_VIEW_TYPE } from './sitePage';
import { describe, SiteRunner, SiteStatus } from './siteRunner';
import { git } from './git';
import { Snapshot } from './snapshot';
import { readPublishedState } from './state';
import { BrowseTree, DownloadTree, OverviewTree, Reads, registerBadges, VIEWS } from './tree';
import { restore, remember } from './ui';

const plural = (count: number, one: string, many?: string): string =>
	String(count) + ' ' + (count === 1 ? one : many === undefined ? one + 's' : many);

const reason = (error: unknown): string => (error instanceof Error ? error.message : String(error));

/** How many changed paths stop a publish to show them first: below this the box alone is enough. */
const MANY_PATHS = 10;

/** Where the pid of the running site server is kept, so a window opened later can end a server that outlived its own. */
const SERVER_PID_KEY = 'temcoLearn.serverPid';

/** The message a publish writes when nobody writes one: the date, because the repository holds several projects. */
const defaultMessage = (): string => 'docs: publish the site (' + new Date().toISOString().slice(0, 10) + ')';

/** Why a build is on the add list: the project is not on the site at all, or this build is newer than the version it serves. */
function whyWaiting(id: string, site: Site): string {
	const project = site.projects.find((entry) => entry.id === id);
	if (project === undefined) {
		return 'not on the site';
	}
	const newest = project.versions[0]?.version;
	return newest === undefined ? 'no version on the site' : `newer than ${newest}`;
}

export function activate(context: vscode.ExtensionContext): void {
	const output = vscode.window.createOutputChannel('Temco Learn');
	// The clone's own commands — clone, pull, install, build, serve — write to one bounded log the Site page reads, and to
	// the output channel for anyone who wants the whole thing.
	const siteLog = new SiteLog();
	const record = (line: string, tone: 'plain' | 'action' | 'warn' = 'plain'): void => {
		siteLog.append(line, tone);
		output.appendLine(line);
	};
	const log = (line: string): void => record(line);
	// Build outputs are static folders on disk and have nothing to do with the site's servers: one loopback server for a
	// look at a file, stopped when the panel closes.
	const server = new Server();
	const runner = new SiteRunner(siteRepo, sitePort, {
		get: () => context.globalState.get<number>(SERVER_PID_KEY),
		set: (pid) => void context.globalState.update(SERVER_PID_KEY, pid)
	});
	const preview = new Preview(() => runner.stop());
	// Publishing says what it does once, and two places listen: the output channel, and the page that explains a push.
	const publishLog = new PublishLog();
	const publishSink: PublishSink = {
		appendLine: (line: string) => {
			output.appendLine(line);
			publishLog.append(line);
			siteLog.append(line);
		}
	};
	const repo = (): string => siteRepo();
	const readSnapshot = async (): Promise<Snapshot> => ({
		site: await readSite(repo()),
		builds: await findBuilds(),
		artifacts: await findArtifacts(),
		published: await readPublishedState(repo())
	});
	/** What the Publishing page says: git's own account of the clone, and what the last attempt printed. */
	const readPublishFacts = async (): Promise<PublishFacts> => {
		const published = await readPublishedState(repo());
		const clone = await readRepoFacts(repo());
		const written = publishLog.read();
		return {
			where: published.where,
			base: published.base,
			commit: published.commit,
			at: published.at,
			branch: clone.branch,
			ahead: clone.ahead,
			pending: published.pending,
			changes: clone.changes,
			log: written.lines,
			logAt: written.at
		};
	};
	/** What the Site page says: the folder and what is in it, what is running, and the last lines anything printed. */
	const readSiteFacts = async (): Promise<SitePageFacts> => {
		const site = await readSite(repo());
		const builds = await findBuilds();
		return {
			repo: await readRepoFacts(repo()),
			status: runner.status,
			log: siteLog.read(),
			publish: publishLog.read().lines,
			configured: repoReady(repo()),
			port: sitePort(),
			// The one thing this page owns that no other page does: which builds on disk are not versions on the site.
			pending: builds
				.filter((build) => {
					const project = site.projects.find((entry) => entry.id === build.id);
					if (project === undefined) {
						return true;
					}
					const newest = project.versions[0]?.builtAt;
					return newest === undefined || build.at > Date.parse(newest);
				})
				.map((build) => ({ title: build.title, folder: build.folder, why: whyWaiting(build.id, site) }))
		};
	};
	const reads = new Reads(readSnapshot);
	// The Overview is the one surface that says whether the repository has moved on, so it is the one that asks the remote —
	// through the cached fetch, so a rebuild of the page does not become a request. Everything else reads the folder alone.
	const overview = new OverviewPage(async () => ({ ...(await readSnapshot()), repo: await readRepoFacts(repo(), { fetch: true }) }));
	const publishing = new PublishPage(readPublishFacts, publishLog);
	const sitePage = new SitePage(readSiteFacts);
	const downloads = new DownloadPage(async () => ({ projects: await findArtifacts(), root: workRoot() }));
	const overviewTree = new OverviewTree();
	const browseTree = new BrowseTree(reads, () => runner.status);
	// The panel's rows say their facts at the row's right-hand edge, where a tree can only put a badge.
	registerBadges(context);
	const downloadTree = new DownloadTree(reads);
	// One view per group: VS Code draws the header, the separator and the collapse state, which is the grouping a
	// person already knows from the Explorer.
	const views = [
		vscode.window.createTreeView(VIEWS.overview, { treeDataProvider: overviewTree }),
		vscode.window.createTreeView(VIEWS.browse, { treeDataProvider: browseTree }),
		vscode.window.createTreeView(VIEWS.download, { treeDataProvider: downloadTree })
	];

	/** Both surfaces read the same facts, so both are re-read together: a panel and a page that disagree is a bug. */
	const refresh = (): void => {
		reads.forget();
		overviewTree.refresh();
		browseTree.refresh();
		downloadTree.refresh();
		overview.refresh();
		publishing.refresh();
		sitePage.refresh();
		downloads.refresh();
	};

	const showLog = { label: 'Show the Log', run: () => output.show(true) };

	/** The status, in the words the bar and the panel both use. */
	const status = (): SiteStatus => runner.status;

	/** Say what the server is doing, in the bar that sits above the site. */
	const paint = (): void => preview.setStatus({ tone: status().state, text: describe(status()) });

	runner.onDidChange(() => {
		paint();
		browseTree.refresh();
		sitePage.refresh();
	});
	siteLog.append('[site] a window is watching the clone');

	/** The file a row names, whether it arrived as a path or as the row itself. */
	const fileOf = (target: unknown): string | undefined => {
		if (typeof target === 'string') {
			return target;
		}
		const file = (target as { file?: unknown } | undefined)?.file;
		return typeof file === 'string' ? file : undefined;
	};

	/**
	 * Start the site, or find it already running, and show a page of it.
	 *
	 * A preview of a site that is not up is a grey frame, so the server is started first and the panel is only pointed at
	 * an address that answers.
	 */
	const showSite = async (target?: { project?: string; version?: string; href?: string }): Promise<void> => {
		remember(context, SITE_VIEW_TYPE);
		// With no clone there is nothing to preview, and a folder dialog is not an explanation: the page that says what the
		// site is, where it goes, and how to get it is.
		if (!repoReady(repo())) {
			sitePage.open();
			return;
		}
		const started = runner.running ? status() : await runner.start(log);
		paint();
		if (started.state !== 'running' || started.url === undefined) {
			complain(started.reason ?? 'The site is not running.');
			return;
		}
		preview.show(pageUrl(started.url, target?.project, target?.version, target?.href), 'Temco Learn');
		refresh();
	};

	/** Point the module at the clone: the one question a fresh machine has to answer. */
	const chooseFolder = async (): Promise<void> => {
		const chosen = await vscode.window.showOpenDialog({
			canSelectFiles: false,
			canSelectFolders: true,
			canSelectMany: false,
			openLabel: 'Use This Folder',
			title: 'Choose the Clone of temcocontrols/temco-learn'
		});
		const folder = chosen?.[0]?.fsPath;
		if (folder === undefined) {
			return;
		}
		if (!repoReady(folder)) {
			complain(folder + ' is not the site repository: it has no package.json and no content/sections.json.');
			return;
		}
		await vscode.workspace.getConfiguration('temcoLearn').update('siteRepo', folder, vscode.ConfigurationTarget.Global);
		refresh();
		say('The site repository is ' + folder + '.');
	};

	/**
	 * Say what the module is doing, where the person who pressed the button can see it.
	 *
	 * It used to be said in the preview panel's bar, which meant a build opened a second page to report on itself. The line
	 * belongs in the page that owns the button: the activity area, and the output channel for anyone who wants it whole.
	 */
	const say = (text: string): void => {
		record(text, 'action');
		sitePage.refresh();
	};

	/** A failure: the same line, in the warning tone, and the page that holds it comes forward. */
	const complain = (text: string): void => {
		record(text, 'warn');
		sitePage.open();
	};

	/** Run one of the repository's scripts, saying so first: a build is long enough to need a word before it starts. */
	const runScript = async (script: string, said: string, done: string): Promise<void> => {
		if (!repoReady(repo())) {
			await chooseFolder();
			return;
		}
		say(said);
		const code = await runner.run(script, log);
		sitePage.refresh();
		refresh();
		if (code === 0) {
			say(done);
			return;
		}
		complain('That did not finish' + (code === -1 ? '.' : ' (exit ' + String(code) + ').'));
	};

	/**
	 * Whether the clone declares one of its own scripts.
	 *
	 * A clone older than a script is not a reason to refuse to publish — the site's `guard` is the gate, and a clone that
	 * has never had one cannot be judged by it. What it can be judged by is `pages.yml`, which is where this came from.
	 */
	const declaresScript = (script: string): boolean => {
		try {
			const parsed = JSON.parse(fs.readFileSync(path.join(repo(), 'package.json'), 'utf8')) as {
				scripts?: Record<string, string>;
			};
			return typeof parsed.scripts?.[script] === 'string';
		} catch {
			return false;
		}
	};

	/**
	 * The site's own downloads: the whole-guide PDFs, then the Windows help file.
	 *
	 * `pages.yml` never builds them — a Linux runner has neither the fonts nor `hhc.exe` — so they are made on a machine
	 * like this one and committed, and the site's own `guard` refuses to deploy a version whose file nobody made. Every
	 * step here is the repository's script, and the browser is asked for by name (`--strict`) so a machine without
	 * Chromium says so instead of leaving a PDF quietly out. The help file is the one optional download: a machine that
	 * cannot compile one still has a site, so that step is reported and not fatal.
	 */
	const makeDownloads = async (): Promise<void> => {
		if (!repoReady(repo())) {
			await chooseFolder();
			return;
		}
		say('Making the site downloads: the site, then the PDFs, then the help files...');
		const built = await runner.run('build:fast', log);
		if (built !== 0) {
			complain('The site could not be built' + (built === -1 ? '.' : ' (exit ' + String(built) + ').') + ' The downloads are printed from it, so nothing was made.');
			return;
		}
		const printed = await runner.run('pdf', log, ['--strict']);
		if (printed !== 0) {
			complain(
				'The PDFs were not made' +
					(printed === -1 ? '.' : ' (exit ' + String(printed) + ').') +
					' They are printed by a browser: install playwright and its Chromium, then run this again.'
			);
			return;
		}
		const helped = await runner.run('chm', log);
		refresh();
		sitePage.refresh();
		say(
			helped === 0
				? 'The downloads are made and waiting in the clone. Publish commits them, and the deploy that serves them follows.'
				: 'The PDFs are made and waiting in the clone. No help file: the compiler is not on this machine — the site serves without it. Publish commits what was made.'
		);
	};

	/** Look at what a build wrote: a folder is the website itself, served here; a file opens in whatever reads it. */	const previewArtifact = async (file: string | undefined): Promise<void> => {
		if (file === undefined) {
			return;
		}
		try {
			const stats = await fs.promises.stat(file);
			if (stats.isDirectory()) {
				const base = await server.serve(file);
				preview.setStatus({ tone: 'running', text: 'build output' });
				preview.show(base + 'index.html', 'Temco Learn - ' + path.basename(file), { onClose: () => server.stop() });
				return;
			}
			await vscode.env.openExternal(vscode.Uri.file(file));
		} catch (error) {
			output.appendLine('[preview] ' + reason(error));
			preview.note('error', 'That file could not be opened - ' + reason(error), showLog);
		}
	};

	/** Take a copy of what a build wrote, where the person asks for it. */
	const saveCopy = async (file: string | undefined): Promise<void> => {
		if (file === undefined) {
			return;
		}
		const name = path.basename(file);
		const chosen = await vscode.window.showSaveDialog({
			saveLabel: 'Save a Copy',
			defaultUri: vscode.Uri.file(path.join(process.env.USERPROFILE ?? '', name))
		});
		if (chosen === undefined) {
			return;
		}
		try {
			await fs.promises.copyFile(file, chosen.fsPath);
			preview.note('info', 'Saved ' + name + ' to ' + chosen.fsPath + '.');
		} catch (error) {
			output.appendLine('[save] ' + reason(error));
			preview.note('error', name + ' could not be saved - ' + reason(error), showLog);
		}
	};

	/** Show the file where it lives, which is what "download" means in a desktop application. */
	const reveal = async (file: string | undefined): Promise<void> => {
		if (file !== undefined) {
			await vscode.commands.executeCommand('revealFileInOS', vscode.Uri.file(file));
		}
	};

	/**
	 * Put a build into the site.
	 *
	 * Three of the four answers are facts on disk: which build is newest, the project's name in the build's own index,
	 * and the section it is already listed under. The version is the one thing a person knows and the folder cannot, so
	 * it is the only question asked. The catalog then has to run, because it is the file the site reads.
	 */
	const add = async (folder?: string): Promise<void> => {
		if (!repoReady(repo())) {
			await chooseFolder();
			return;
		}
		const builds = await findBuilds();
		if (builds.length === 0) {
			complain('Nothing to add: no build was found. Build a project first - a build is a folder with an index.html or an index.md in it.');
			return;
		}
		const chosen =
			folder === undefined
				? builds.length === 1
					? builds[0]
					: await pickBuild(builds)
				: builds.find((build) => build.folder === folder);
		if (chosen === undefined) {
			if (folder !== undefined) {
				say('That build is no longer on disk. Refresh the list and pick another one.');
			}
			return;
		}

		const site = await readSite(repo());
		// A project already on the site under this id, or under this title: the title is matched too because a build that
		// was added before ids came from the folder carries the id its old title suggested, and its history is not
		// something to strand over a rename.
		const existing =
			site.projects.find((project) => project.id === chosen.id) ??
			site.projects.find((project) => project.title === chosen.title);
		const id = existing?.id ?? chosen.id;
		const version = await vscode.window.showInputBox({
			title: 'Add ' + chosen.title + ' to the site',
			prompt: 'The version this build is - project ' + id,
			value: existing?.versions[0]?.version ?? '1.0',
			validateInput: (value) =>
				/^[0-9A-Za-z][0-9A-Za-z._+-]*$/.test(value.trim())
					? undefined
					: 'A version is letters, digits and . _ + - (it becomes a folder name).'
		});
		if (version === undefined || version.trim() === '') {
			return;
		}

		try {
			say('Adding ' + chosen.title + ' ' + version.trim() + ' and rebuilding the catalog...');
			const added = await importBuild({
				repo: repo(),
				id,
				title: chosen.title,
				section: existing?.section,
				version: version.trim(),
				built: chosen.folder
			});
			const catalogued = await runner.run('catalog', log);
			refresh();
			if (catalogued !== 0) {
				complain('The build is in place, but the catalog could not be rebuilt - the site will not list it yet.');
				return;
			}
			say(
				chosen.title + ' ' + added.version + ' is on the site - ' + plural(added.pages, 'page') + '. Nothing is published until you publish.'
			);
			await showSite({ project: id, version: added.version });
		} catch (error) {
			output.appendLine('[add] ' + reason(error));
			complain('The build could not be added - ' + reason(error));
		}
	};

	/**
	 * Commit the clone and push it. The page that asked for it is also the page that shows what happened: the lines land in
	 * its own log, and it redraws from git when the push is over.
	 *
	 * The message is asked for rather than invented, because a commit that carries somebody's writing deserves a sentence
	 * about it — and the box is pre-filled, so publishing unchanged is still two presses.
	 */
	const publishNow = async (): Promise<void> => {
		publishSink.appendLine('[publish] started');
		// What the page says when this is over. Undefined means the person cancelled, and a cancelled publish is not news.
		let outcome: { title: string; tone: 'ok' | 'warn' } | undefined;
		try {
			await ensureRepo(repo());
			const facts = await readRepoFacts(repo());
			const theirs = editsOf(facts.changes);
			if (facts.changes.length > MANY_PATHS) {
				const answer = await vscode.window.showInformationMessage(
					plural(facts.changes.length, 'path') + ' will be committed from temco-learn',
					{
						detail:
							facts.changes
								.slice(0, 6)
								.map((change) => `${change.code}  ${change.path}`)
								.join('\n') + (facts.changes.length > 6 ? `\n… and ${facts.changes.length - 6} more` : '') + `\n${theirs.length} of them your own.`
					},
					'Publish now',
					'Show the changes first'
				);
				if (answer === 'Show the changes first') {
					sitePage.open('changes');
					return;
				}
				if (answer !== 'Publish now') {
					return;
				}
			}
			const message = await vscode.window.showInputBox({
				title: 'Publish temco-learn',
				prompt:
					theirs.length === 0
						? `${plural(facts.changes.length, 'path')} to commit — the message git will carry`
						: `${plural(facts.changes.length, 'path')} to commit, ${theirs.length} of them your own — the message git will carry`,
				value: defaultMessage()
			});
			if (message === undefined) {
				publishSink.appendLine('[publish] cancelled — nothing was committed');
				return;
			}
			const catalogued = await runner.run('catalog', log);
			if (catalogued !== 0) {
				publishSink.appendLine('[publish] the catalog could not be rebuilt, so nothing was committed');
				outcome = { title: 'Nothing was published — the catalog could not be rebuilt', tone: 'warn' };
				return;
			}
			// The site's own gate, invoked rather than reimplemented: `guard` is what `pages.yml` runs before it deploys,
			// and it is the only thing that knows a version needs a committed PDF. Failing here is the same failure one
			// step earlier, where it costs a dialog instead of a red run.
			const guarded = declaresScript('guard') ? await runner.run('guard', log) : 0;
			if (guarded !== 0) {
				publishSink.appendLine(
					'[publish] the site\'s guard refused this clone, so nothing was committed — the lines above name the missing download. Make the downloads, then publish again.'
				);
				outcome = { title: 'Nothing was published — the site\'s guard refused the clone', tone: 'warn' };
				return;
			}
			// Committing, pushing and waiting for the answer takes long enough that a press with no visible answer reads as
			// a press that did nothing.
			const published = await vscode.window.withProgress(
				{
					location: vscode.ProgressLocation.Notification,
					title:
						'Committing and pushing ' +
						plural(facts.changes.length, 'path') +
						(theirs.length === 0 ? '' : ', ' + plural(theirs.length, 'edit') + ' of them yours'),
					cancellable: false
				},
				() => publishSite(repo(), publishSink, message)
			);
			publishSink.appendLine(
				published.unchanged
					? '[publish] nothing had changed - ' + (published.commit === '' ? 'the last commit' : published.commit) + ' is already on ' + published.base
					: '[publish] pushed ' + published.commit + ' - ' + published.base + ' (a minute to appear)'
			);
			outcome = {
				title: published.unchanged ? 'Nothing to push — the site is already on ' + published.base : 'Pushed to ' + published.base,
				tone: 'ok'
			};
			refresh();
		} catch (error) {
			publishSink.appendLine('[publish] nothing was published - ' + reason(error));
			outcome = { title: 'Nothing was published', tone: 'warn' };
		} finally {
			refresh();
			// The page is where the person is looking, so it carries the result. The full channel comes forward only when
			// something went wrong, where the reason is longer than a strip.
			if (outcome?.tone === 'warn') {
				output.show(true);
			}
			if (outcome !== undefined) {
				sitePage.report(outcome);
			}
		}
	};

	/**
	 * Read the clone again, from GitHub.
	 *
	 * "16 commits behind" is a comparison against `origin/main`, and that ref only moves when something fetches — so the
	 * figure is a claim about the last fetch, not about the remote. A press means "now", so the cached fetch is forgotten
	 * first; the answer goes on the page as a report and in the activity area as a line, because a redraw on its own says
	 * nothing about whether anything changed.
	 */
	const reread = async (): Promise<void> => {
		if (!repoReady(repo())) {
			sitePage.open();
			return;
		}
		forgetFetch(repo());
		const facts = await readRepoFacts(repo(), { fetch: true });
		refresh();
		say(
			'Read the clone again — ' +
				plural(facts.behind, 'commit') +
				' to pull, ' +
				plural(facts.ahead, 'commit') +
				' to push, ' +
				plural(facts.changes.length, 'path') +
				' changed.'
		);
		sitePage.report({ title: 'Read the clone again' });
	};

	/**
	 * Remove paths the last commit does not have.
	 *
	 * The only thing a discard can do for an untracked path, and the thing a pull needs done before it can write the
	 * committed copy of a file with that name. A path from `git status` is relative to the clone and cannot leave it; the
	 * check is here anyway, because deleting a folder is the one act in this module git cannot undo.
	 */
	const removePaths = async (paths: readonly string[]): Promise<number> => {
		const root = path.resolve(repo());
		let gone = 0;
		for (const one of paths) {
			const target = path.resolve(root, one);
			const inside = path.relative(root, target);
			if (inside === '' || inside.startsWith('..') || path.isAbsolute(inside)) {
				continue;
			}
			await fs.promises.rm(target, { recursive: true, force: true });
			gone += 1;
		}
		return gone;
	};

	/**
	 * The question a discard asks when part of it cannot be undone.
	 *
	 * Two kinds of loss, and they are not the same: a path somebody edited is gone for good, while a path the build wrote is
	 * written again by the next build. Both are named by count, and the paths that cannot be recovered are listed — a
	 * "Discard all" over five hundred paths deserves to say which five hundred.
	 */
	const confirmDiscard = async (edits: number, remove: readonly string[], total: number): Promise<boolean> => {
		if (edits === 0 && remove.length === 0) {
			return true;
		}
		const lines: string[] = [];
		if (edits > 0) {
			lines.push(`${plural(edits, 'path')} ${edits === 1 ? 'is' : 'are'} your own work, and discarded for good`);
		}
		if (remove.length > 0) {
			lines.push(
				`${plural(remove.length, 'path')} ${remove.length === 1 ? 'is' : 'are'} not in the last commit, so ` +
					`${remove.length === 1 ? 'it is' : 'they are'} deleted from disk`
			);
		}
		const answer = await vscode.window.showWarningMessage(
			`Discard ${plural(total, 'path')}?`,
			{
				modal: true,
				detail: [lines.join('\n'), remove.length === 0 ? '' : '', remove.slice(0, 6).join('\n')]
					.filter((part) => part !== '')
					.join('\n\n')
			},
			'Discard'
		);
		return answer === 'Discard';
	};

	/**
	 * Discard paths: back to the last commit for the ones it has, gone from disk for the ones it does not.
	 *
	 * The two are not interchangeable. `git restore` refuses a path the commit has never seen — and then restores none of
	 * the others either — which is what made this button do nothing at all on a clone whose last build had written
	 * `public/pdf/`: the log said "pathspec did not match any file(s) known to git", and the two tracked files it was also
	 * asked for were left exactly as they were.
	 */
	const discard = async (target?: unknown): Promise<void> => {
		const asked = typeof target === 'string' ? [target] : (target as { paths?: unknown } | undefined)?.paths;
		const paths = Array.isArray(asked) ? asked.filter((entry): entry is string => typeof entry === 'string') : [];
		if (paths.length === 0) {
			return;
		}
		// Asked of git rather than taken from the page: whether the commit has a path is a fact about the commit, and a path
		// that is already clean is not a failure.
		const facts = await readRepoFacts(repo());
		const named = new Set(paths.map((one) => one.replace(/\/+$/u, '')));
		const chosen = facts.changes.filter((change) => named.has(change.path.replace(/\/+$/u, '')));
		if (chosen.length === 0) {
			say('Nothing to discard — those paths already match the last commit.');
			sitePage.report({ title: 'Nothing to discard' });
			return;
		}
		const { restore, remove } = discardOf(chosen);
		const edited = chosen.filter((change) => change.kind === 'edit').length;
		if (!(await confirmDiscard(edited, remove, chosen.length))) {
			say('Nothing was discarded.');
			sitePage.report({ title: 'Nothing was discarded', tone: 'warn' });
			return;
		}
		if (restore.length > 0) {
			const code = await runner.restore(restore, log);
			if (code !== 0) {
				say('Nothing was discarded — the log says what git refused.');
				sitePage.report({ title: 'Nothing was discarded', tone: 'warn' });
				return;
			}
		}
		const gone = await removePaths(remove);
		const told: string[] = [];
		if (restore.length > 0) {
			told.push(plural(restore.length, 'path') + ' back to the last commit');
		}
		if (gone > 0) {
			told.push(plural(gone, 'path') + ' deleted, which the commit never had');
		}
		say('Discarded ' + plural(chosen.length, 'path') + ' — ' + told.join(', ') + '.');
		refresh();
		sitePage.report({ title: 'Discarded ' + plural(chosen.length, 'path') });
	};

	/** The difference a row is about, in the editor's own diff rather than a copy of it on a page. */
	const showDiff = async (target?: unknown): Promise<void> => {
		if (typeof target !== 'string' || target.length === 0) {
			return;
		}
		const uri = vscode.Uri.file(path.join(repo(), target));
		try {
			// Provided by the built-in Git extension: the working copy against HEAD, which is what the row means.
			await vscode.commands.executeCommand('git.openChange', uri);
		} catch {
			await vscode.commands.executeCommand('vscode.open', uri);
		}
	};

	/** Clone the site into the folder the module is pointed at, then stop: install and build are their own presses. */
	const clone = async (): Promise<void> => {
		const folder = repo();
		const url = 'https://github.com/temcocontrols/temco-learn.git';
		if (fs.existsSync(folder) && (await fs.promises.readdir(folder).catch(() => [])).length > 0) {
			publishSink.appendLine('[clone] ' + folder + ' already has something in it; nothing was cloned');
			sitePage.open();
			return;
		}
		sitePage.open();
		siteLog.append('[clone] git clone ' + url + ' ' + folder);
		await runner.clone(url, folder, log);
		await vscode.workspace.getConfiguration('temcoLearn').update('siteRepo', folder, vscode.ConfigurationTarget.Global);
		siteLog.append('[clone] done — install the dependencies next');
		refresh();
		sitePage.refresh();
	};

	/**
	 * Bring the clone up to date: clone if there is nothing here, otherwise fetch, pull, and rebuild on request.
	 *
	 * Three things this has to get right that a bare `git pull` does not:
	 *
	 * - **fetch first.** "Behind" is a comparison against the local `origin/main`, which only moves when something fetches,
	 *   so without this the answer below would be about a stale ref.
	 * - **never pull over uncommitted work.** `--ff-only` refuses a divergent clone, and a dirty tree would either block or
	 *   quietly keep the edits; either way a person should be told rather than surprised.
	 * - **rebuild after.** The source is not the site: the preview runs the repository's `serve` script, which delivers the
	 *   built `dist/`, and `content/catalog.json` — the file that says which projects and pages exist — is rewritten by the
	 *   build too. A pull on its own therefore changes nothing a person can see, which is why the build is offered right
	 *   here instead of being a second act somebody has to know about.
	 */
	const getLatest = async (): Promise<void> => {
		const folder = repo();
		if (!repoReady(folder)) {
			// Nothing cloned: the clone is the whole act, and it refuses a folder that already has something in it.
			await clone();
			return;
		}
		const facts = await readRepoFacts(folder, { fetch: true });

		// A build leaves the clone "dirty" with nothing a person did: the catalog, the search index and the content JSONs are
		// written by the site's own scripts and committed, and on Windows every one of them also reports a line-ending
		// change. Those are discarded — they are reproduced by the build that follows a pull — so that a pull is not blocked
		// by the last build. What somebody actually edited still stops it.
		//
		// Two kinds of path here, and git only obliges on one of them: a committed file goes back to the commit, and a file
		// the build wrote that no commit has is deleted — which a pull needs anyway, because git will not write a committed
		// file over an untracked one of the same name.
		const disposable = facts.changes.filter((change) => change.kind !== 'edit');
		const { restore, remove } = discardOf(disposable);
		// Build output only, so nothing of a person's is in this question — but a path the commit does not have still has to
		// be deleted for a pull to write the committed copy, and deleting is not something to do quietly.
		if (!(await confirmDiscard(0, remove, disposable.length))) {
			say('Nothing was pulled: the build output is still there, and git will not write over it.');
			sitePage.report({ title: 'Nothing was pulled', tone: 'warn' });
			return;
		}
		if (restore.length > 0) {
			const restored = await runner.restore(restore, log);
			if (restored !== 0) {
				complain('The build output could not be set aside, so nothing was pulled — the log says why.');
				sitePage.report({ title: 'Nothing was pulled', tone: 'warn' });
				return;
			}
		}
		const gone = await removePaths(remove);
		if (restore.length > 0 || gone > 0) {
			say(
				'Set aside ' +
					plural(restore.length, 'path') +
					' the last build wrote' +
					(gone === 0 ? '' : ' and removed ' + plural(gone, 'path') + ' it wrote that no commit has') +
					' — the clone is clean enough to pull.'
			);
		}
		const edits = editsOf(facts.changes);
		if (edits.length > 0) {
			say(
				'Nothing was pulled: ' +
					plural(edits.length, 'path') +
					' here ' +
					(edits.length === 1 ? 'is' : 'are') +
					' yours, not the build\u2019s — ' +
					edits
						.slice(0, 3)
						.map((change) => change.path)
						.join(', ') +
					(edits.length > 3 ? ', \u2026' : '') +
					'. Commit or discard them, then get the latest again.'
			);
			sitePage.open('changes');
			return;
		}
		if (facts.behind === 0) {
			say('temco-learn is already up to date' + (facts.ahead > 0 ? ' — ' + plural(facts.ahead, 'commit') + ' here are not pushed' : '') + '.');
			sitePage.report({ title: 'Already up to date' });
			return;
		}

		const before = (await git(folder, ['rev-parse', 'HEAD']).catch(() => '')).trim();
		say('Pulling ' + plural(facts.behind, 'commit') + ' into ' + folder + '...');
		forgetFetch(folder);
		// A pull of sixteen commits fetches, merges and touches hundreds of files: say so in the one place a person looks
		// while it runs, rather than printing "Pulling..." into a panel they cannot see.
		const pulled = await vscode.window.withProgress(
			{
				location: vscode.ProgressLocation.Notification,
				title: 'Pulling ' + plural(facts.behind, 'commit') + ' into temco-learn',
				cancellable: false
			},
			() => runner.pull(log)
		);
		refresh();
		if (pulled !== 0) {
			complain('The pull failed — the log says why. Nothing was rebuilt.');
			sitePage.report({ title: 'Nothing was pulled', tone: 'warn' });
			return;
		}

		// What the new commits touched decides whether the dependencies moved with them.
		const touched =
			before === '' ? '' : await git(folder, ['diff', '--name-only', before, 'HEAD']).catch(() => '');
		const movedDependencies = touched
			.split(/\r?\n/u)
			.some((line) => /(^|\/)(package\.json|package-lock\.json)$/u.test(line.trim()));

		const answer = await vscode.window.showInformationMessage(
			'Pulled ' + plural(facts.behind, 'commit') + ' into temco-learn. The preview still serves the build made before them.',
			'Build now',
			'Later'
		);
		if (answer !== 'Build now') {
			sitePage.report({ title: 'Pulled ' + plural(facts.behind, 'commit') });
			return;
		}
		if (movedDependencies) {
			say('The pull changed package.json, so the dependencies are installed again first...');
			const installed = await runner.run('install', log);
			if (installed !== 0) {
				complain('The dependencies could not be installed — the log says why. Nothing was built.');
				sitePage.report({ title: 'Pulled, but the dependencies could not be installed', tone: 'warn' });
				return;
			}
		}
		say('Building the site from the new code...');
		const built = await runner.run('build', log);
		if (built !== 0) {
			complain('The site could not be built from the new code — the log says why.');
			sitePage.report({ title: 'Pulled, but the site could not be built', tone: 'warn' });
			return;
		}
		// `serve` hands out `dist/`, so a preview that is already running has to be restarted to show the new build.
		if (runner.running) {
			await runner.stop();
			await runner.start(log);
		}
		say('temco-learn is on the new code and the site is built from it.');
		refresh();
		sitePage.report({ title: 'Pulled ' + plural(facts.behind, 'commit') + ' and built the site' });
	};

	/** Point the module at a clone that is already on this machine. */
	const useExisting = async (): Promise<void> => {
		const chosen = await vscode.window.showOpenDialog({
			canSelectFiles: false,
			canSelectFolders: true,
			canSelectMany: false,
			openLabel: 'Use This Clone',
			title: 'Choose the temco-learn clone'
		});
		const folder = chosen?.[0]?.fsPath;
		if (folder === undefined) {
			return;
		}
		if (!repoReady(folder)) {
			void vscode.window.showWarningMessage(folder + ' is not the site: it has no package.json and no content/sections.json.');
			return;
		}
		await vscode.workspace.getConfiguration('temcoLearn').update('siteRepo', folder, vscode.ConfigurationTarget.Global);
		siteLog.append('[site] pointed at ' + folder);
		refresh();
		sitePage.refresh();
	};

	context.subscriptions.push(
		server,
		runner,
		preview,
		overview,
		publishing,
		sitePage,
		downloads,
		...views,
		output,
		// A page of this module that was open when the window closed comes back with its tab: the panel the window
		// restored is drawn into, so the tab keeps its place and there is never a second copy of it.
		...restore(context, [
			{ viewType: OVERVIEW_VIEW_TYPE, open: (panel) => overview.open(panel) },
			{ viewType: SITE_VIEW_TYPE, open: (panel) => sitePage.open(undefined, panel) },
			{ viewType: DOWNLOAD_VIEW_TYPE, open: (panel) => downloads.open(panel) },
			{ viewType: PUBLISH_VIEW_TYPE, open: (panel) => publishing.open(panel) }
		]),

		// The folder and the port are settings, so a hand-edited setting reaches the panel and the page as well.
		vscode.workspace.onDidChangeConfiguration((event) => {
			if (event.affectsConfiguration('temcoLearn.siteRepo') || event.affectsConfiguration('temcoLearn.sitePort')) {
				refresh();
				sitePage.refresh();
			}
		}),

		// The module's own page: what it is for, the three steps, and where the website goes. Never the website itself.
		vscode.commands.registerCommand('temcoLearn.overview', () => {
			remember(context, OVERVIEW_VIEW_TYPE);
			overview.open();
		}),

		vscode.commands.registerCommand('temcoLearn.publishing', () => {
			remember(context, PUBLISH_VIEW_TYPE);
			publishing.open();
		}),

		vscode.commands.registerCommand('temcoLearn.downloads', () => {
			remember(context, DOWNLOAD_VIEW_TYPE);
			downloads.open();
		}),

		vscode.commands.registerCommand('temcoLearn.site.preview', async (target?: { project?: string; version?: string; href?: string }) => {
			await showSite(target);
		}),

		vscode.commands.registerCommand('temcoLearn.site.open', async () => {
			const started = runner.running ? status() : await runner.start(log);
			paint();
			if (started.url === undefined) {
				complain(started.reason ?? 'The site is not running.');
				return;
			}
			await vscode.env.openExternal(vscode.Uri.parse(started.url));
		}),

		vscode.commands.registerCommand('temcoLearn.site.build', async () => {
			await runScript('build', 'Building the site: the catalog, the search index, then the bundle...', 'The site is built. Preview it, then publish.');
		}),

		vscode.commands.registerCommand('temcoLearn.site.install', async () => {
			await runScript('install', 'Installing the site dependencies...', 'The dependencies are installed.');
		}),

		// The two downloads the deploy cannot make for itself, each its own script, in the order they depend on each other.
		vscode.commands.registerCommand('temcoLearn.site.downloads', () => makeDownloads()),

		vscode.commands.registerCommand('temcoLearn.site.stop', async () => {
			await runner.stop();
			paint();
			browseTree.refresh();
			sitePage.refresh();
		}),

		// One button, on the one port: serve the built pages, which is the only way this module shows the site.
		vscode.commands.registerCommand('temcoLearn.site.start', async () => {
			if (!repoReady(repo())) {
				sitePage.open();
				return;
			}
			const started = await runner.start(log);
			paint();
			sitePage.refresh();
			browseTree.refresh();
			if (started.state !== 'running') {
				complain(started.reason ?? 'The site is not running.');
			}
		}),

		vscode.commands.registerCommand('temcoLearn.site.port', async () => {
			const chosen = await vscode.window.showInputBox({
				title: 'The Port the Site Is Served On',
				value: String(sitePort()),
				prompt: 'The port the built pages are served on. Above 1024, so it binds without root.',
				validateInput: (value) => {
					const port = Number(value.trim());
					if (!Number.isInteger(port) || port <= 1024 || port > 65535) {
						return 'A port between 1025 and 65535.';
					}
					return undefined;
				}
			});
			if (chosen === undefined) {
				return;
			}
			await vscode.workspace.getConfiguration('temcoLearn').update('sitePort', Number(chosen.trim()), vscode.ConfigurationTarget.Global);
			log('[site] the port is ' + chosen.trim() + ' — restart the server to use it.');
			refresh();
			sitePage.refresh();
		}),

		// A build output served for a look has its own server and its own way to end it: the site's Stop is the site's.
		vscode.commands.registerCommand('temcoLearn.stopArtifact', () => server.stop()),

		vscode.commands.registerCommand('temcoLearn.site.folder', async () => {
			if (!repoReady(repo())) {
				await chooseFolder();
				return;
			}
			await vscode.commands.executeCommand('revealFileInOS', vscode.Uri.file(repo()));
		}),

		vscode.commands.registerCommand('temcoLearn.site.choose', chooseFolder),

		// The Site page, and the four acts it owns: get the clone, keep it current, take me there, and read the log.
		vscode.commands.registerCommand('temcoLearn.site.page', () => sitePage.open()),
		vscode.commands.registerCommand('temcoLearn.site.clone', clone),
		vscode.commands.registerCommand('temcoLearn.site.useExisting', useExisting),
		// One act under two names: `pull` is what the Site page's button has always called, and `update` is what the Overview
		// and the palette call. Both do the same thing, so there is one behaviour to trust rather than two that drift.
		vscode.commands.registerCommand('temcoLearn.site.pull', getLatest),
		vscode.commands.registerCommand('temcoLearn.site.update', getLatest),
		vscode.commands.registerCommand('temcoLearn.site.refresh', reread),
		// One row of the changes list: its difference, and setting it back to the last commit.
		vscode.commands.registerCommand('temcoLearn.site.diff', showDiff),
		vscode.commands.registerCommand('temcoLearn.site.discard', discard),
		// Commit and push from the changes list, with the message the person wrote in the box.
		vscode.commands.registerCommand('temcoLearn.site.commit', publishNow),
		vscode.commands.registerCommand('temcoLearn.site.clearLog', () => {
			siteLog.clear();
			sitePage.refresh();
		}),
		vscode.commands.registerCommand('temcoLearn.site.showLog', () => {
			output.show(true);
		}),
		vscode.commands.registerCommand('temcoLearn.site.terminal', () => {
			if (!repoReady(repo())) {
				sitePage.open();
				return;
			}
			const terminal = vscode.window.createTerminal({ name: 'Temco Learn', cwd: repo() });
			terminal.show();
		}),
		vscode.commands.registerCommand('temcoLearn.site.remote', async (target?: { path?: string }) => {
			const facts = await readRepoFacts(repo());
			const where = facts.where ?? 'temcocontrols/temco-learn';
			const path = typeof target?.path === 'string' && target.path !== '' ? '/' + target.path : '';
			await vscode.env.openExternal(vscode.Uri.parse('https://github.com/' + where + path));
		}),

		// A build belongs to the authoring module, so this opens the Build Center rather than inventing a second one.
		vscode.commands.registerCommand('temcoLearn.build', async () => {
			await vscode.commands.executeCommand('temcoDocs.builds');
		}),

		vscode.commands.registerCommand('temcoLearn.addBuild', async (folder?: unknown) => {
			await add(typeof folder === 'string' ? folder : undefined);
		}),

		// Adding a build is a site operation: the page that clones, builds, runs and publishes the site owns it, and the
		// section comes first there so the act the caller promised is on screen.
		vscode.commands.registerCommand('temcoLearn.addBuilds', () => {
			sitePage.open('add');
		}),

		// Publishing is an act that changes what the world sees, so the row opens the page that says what it would push.
		vscode.commands.registerCommand('temcoLearn.publish', () => publishing.open()),
		vscode.commands.registerCommand('temcoLearn.publishNow', publishNow),

		vscode.commands.registerCommand('temcoLearn.openPublished', async () => {
			const published = await readPublishedState(repo());
			if (published.base === undefined) {
				publishing.open();
				return;
			}
			await vscode.env.openExternal(vscode.Uri.parse(published.base));
		}),

		vscode.commands.registerCommand('temcoLearn.refresh', async () => {
			refresh();
		}),

		vscode.commands.registerCommand('temcoLearn.previewArtifact', (target?: unknown) => previewArtifact(fileOf(target))),

		vscode.commands.registerCommand('temcoLearn.downloadArtifact', async (target?: unknown) => {
			await saveCopy(fileOf(target));
		}),

		vscode.commands.registerCommand('temcoLearn.revealArtifact', async (target?: unknown) => {
			await reveal(fileOf(target));
		})
	);
}

/** Which build, when the panel's own rows did not say: the same two facts the rows show, in a picker. */
async function pickBuild(builds: readonly Build[]): Promise<Build | undefined> {
	const picked = await vscode.window.showQuickPick(
		builds.map((build) => ({ label: build.title, description: build.folder, build })),
		{ title: 'Add a Build to the Site', placeHolder: 'A build is a folder a project wrote' }
	);
	return picked?.build;
}