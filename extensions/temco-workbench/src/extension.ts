// The workbench module's entry point — the application's own surfaces.
//
// Two of them, and neither is about one module's work:
//
//   * **the dashboard** — the application itself, what it is made of and what to do first;
//   * **the needs page** — everything one list that wants a person, from every module.
//
// It is also where the application *starts*: which tab opens, and which sidebar section comes forward when the
// project being worked on changes. Both are layout decisions, so they are made here rather than in a module that
// happens to own a view.
//
// Nothing here writes anything, and nothing here is a domain: every surface of the work is another module's page,
// and every action on one is that module's own command.

import * as vscode from 'vscode';
import { roots, onDidChange, refresh as reread, totals } from './docs';
import { DashboardPages } from './dashboard';
import { HelpPages } from './helpPages';
import { LearnPages } from './learnPages';
import { NeedsPage } from './needsPage';
import { registerSettings } from './settingsPages';
import { registerSidebarViews } from './sidebar';
import { OverviewTree } from './overviewTree';
import { Catalog, selection } from './store';
import { onDidRestorePage, restore, restoredAny } from './ui';
export function activate(context: vscode.ExtensionContext): void {
	// How many drafts a person still has to settle. A queue is not in the registry, so it is read from the catalog
	// once per refresh and kept here — the badge is drawn synchronously, and a number that lags one refresh is
	// honest, whereas a badge that cannot be drawn is not.
	let waiting = 0;
	// The group views whose container this module declares: Settings.
	// The row that carries a number — Modules — reads it when it is drawn, so installing a module changes the panel
	// without a reload.
	const sidebars = registerSidebarViews(context, () => ({
		modules: vscode.extensions.all.filter((extension) => extension.packageJSON.publisher === 'temcocontrols').length,
		needs: totals(roots()).neverReviewed + waiting,
	}));
	// The Home panel's Overview: the platform's facts as rows, each opening the page behind it.
	const overview = new OverviewTree(context);
	context.subscriptions.push(
		vscode.window.createTreeView('temcoWorkbench.overviewView', { treeDataProvider: overview }),
		onDidChange(() => overview.refresh())
	);
	/** Re-read the queue, then redraw the panel: what is left is what a person still has to look at. */
	const countDrafts = async (): Promise<void> => {
		try {
			const catalog = await Catalog.open(context);
			try {
				const documents = catalog.documents();
				const project = selection.project() ?? (documents.length === 1 ? documents[0].slug : undefined);
				waiting = project === undefined ? 0 : catalog.drafts(project).length;
			} finally {
				catalog.close();
			}
		} catch {
			waiting = 0;
		}
		sidebars.refresh();
	};
	// The page behind the Library's *Needs attention* row: what wants a person, said in full.
	const needs = new NeedsPage(context, () => roots());
	// The page a window with nothing better to show opens on: the application, not one project's work, and the
	// five other pages that answer a question about the window itself. Welcome used to be its own panel and Help one
	// page with everything on it; the mock gives six surfaces, each with one question to answer.
	const help = new HelpPages(context, selection);
	// The five choices the application asks a profile to make — General, Modules, Branding, AI Models, Publishing.
	const settings = registerSettings(context);
	// The Dashboard's own pages: Overview and Recent Activity. Coverage is the documentation module's report, and
	// is linked from the Overview rather than drawn twice from the same registry.
	const dashboard = new DashboardPages(context);
	context.subscriptions.push(dashboard);
	// Temco Learn: the published site as a reader sees it — Home, T3000, an article, Downloads, Learning Paths.
	const learn = new LearnPages(context);
	context.subscriptions.push(
		help,
		settings.pages,
		...settings.disposables,
		learn,
		// A page of this module that was open when the window closed comes back with its tab: the panel the window
		// restored is drawn into, so the tab keeps its place and there is never a second copy of it. Each of these
		// pages is one question with one answer, so there is nothing else to remember about them.
		...restore(context, [
			{ viewType: 'temcoWorkbench.overview', open: (panel) => void dashboard.open('overview', panel) },
			{ viewType: 'temcoWorkbench.activity', open: (panel) => void dashboard.open('activity', panel) },
			{ viewType: 'temcoWorkbench.needs', open: (panel) => needs.open(panel) },
			{ viewType: 'temcoWorkbench.settings.general', open: (panel) => settings.pages.general(panel) },
			{ viewType: 'temcoWorkbench.settings.modules', open: (panel) => settings.pages.modules(panel) },
			{ viewType: 'temcoWorkbench.settings.branding', open: (panel) => settings.pages.branding(panel) },
			{ viewType: 'temcoWorkbench.settings.ai', open: (panel) => settings.pages.ai(panel) },
			{ viewType: 'temcoWorkbench.settings.publishing', open: (panel) => settings.pages.publishing(panel) },
			{ viewType: 'temcoWorkbench.help.welcome', open: (panel) => help.welcome(panel) },
			{ viewType: 'temcoWorkbench.help.home', open: (panel) => help.home(panel) },
			{ viewType: 'temcoWorkbench.help.keys', open: (panel) => void help.keys(panel) },
			{ viewType: 'temcoWorkbench.help.logs', open: (panel) => void help.logs(panel) },
			{ viewType: 'temcoWorkbench.help.issue', open: (panel) => help.issue(panel) },
			{ viewType: 'temcoWorkbench.help.about', open: (panel) => help.about(panel) },
			{ viewType: 'temcoWorkbench.learn.home', open: (panel) => void learn.home(panel) },
			{ viewType: 'temcoWorkbench.learn.article', open: (panel) => void learn.article(panel) },
			{ viewType: 'temcoWorkbench.learn.downloads', open: (panel) => void learn.downloads(panel) }
		]),
		vscode.commands.registerCommand('temcoWorkbench.home', () => dashboard.open('overview')),
		vscode.commands.registerCommand('temcoWorkbench.openNeeds', () => needs.open()),
		vscode.commands.registerCommand('temcoWorkbench.welcome', () => help.welcome()),
		vscode.commands.registerCommand('temcoWorkbench.help', () => help.home()),
		vscode.commands.registerCommand('temcoWorkbench.help.welcome', () => help.welcome()),
		vscode.commands.registerCommand('temcoWorkbench.help.home', () => help.home()),
		vscode.commands.registerCommand('temcoWorkbench.help.keys', () => void help.keys()),
		vscode.commands.registerCommand('temcoWorkbench.help.logs', () => void help.logs()),
		vscode.commands.registerCommand('temcoWorkbench.help.issue', () => help.issue()),
		vscode.commands.registerCommand('temcoWorkbench.help.about', () => help.about()),
		// The two things the Help pages do with this window's own facts: open one of its log files, and put the
		// report a person wrote on the clipboard before the issue reporter opens.
		vscode.commands.registerCommand('temcoWorkbench.help.openLog', (name?: unknown) =>
			void help.openLog(typeof name === 'string' ? name : undefined)
		),
		vscode.commands.registerCommand(
			'temcoWorkbench.help.copyReport',
			(draft?: { title?: string; steps?: string; where?: string }) => void help.copyReport(draft)
		),
		vscode.commands.registerCommand('temcoWorkbench.overview', () => dashboard.open('overview')),
		vscode.commands.registerCommand('temcoWorkbench.activity', () => dashboard.open('activity')),
		vscode.commands.registerCommand('temcoWorkbench.settings', () => settings.pages.general()),
		vscode.commands.registerCommand('temcoWorkbench.settings.general', () => settings.pages.general()),
		vscode.commands.registerCommand('temcoWorkbench.settings.modules', () => settings.pages.modules()),
		vscode.commands.registerCommand('temcoWorkbench.settings.branding', () => settings.pages.branding()),
		vscode.commands.registerCommand('temcoWorkbench.settings.ai', () => settings.pages.ai()),
		vscode.commands.registerCommand('temcoWorkbench.settings.publishing', () => settings.pages.publishing()),
		// The two facts a page cannot read from the host: where this profile's logs are written, and the block a
		// report wants pasted into it.
		vscode.commands.registerCommand('temcoWorkbench.copyLogPath', async () => {
			await vscode.env.clipboard.writeText(context.logUri.fsPath);
			vscode.window.setStatusBarMessage('Log folder path copied.', 3000);
		}),
		vscode.commands.registerCommand('temcoWorkbench.copyDiagnostics', async () => {
			await vscode.env.clipboard.writeText(diagnostics(context));
			vscode.window.setStatusBarMessage('Diagnostics copied.', 3000);
		}),
		vscode.commands.registerCommand('temcoWorkbench.learn.home', () => learn.home()),
		vscode.commands.registerCommand('temcoWorkbench.learn.article', () => learn.article()),
		vscode.commands.registerCommand('temcoWorkbench.learn.downloads', () => learn.downloads()),
		vscode.commands.registerCommand('temcoWorkbench.setStartOpen', async (open?: unknown) => {
			const value = typeof open === 'string' ? open : undefined;
			if (value === undefined || !START_OPTIONS.includes(value)) {
				return;
			}
			await vscode.workspace.getConfiguration('temcoWorkbench').update('start.open', value, vscode.ConfigurationTarget.Global);
			settings.pages.refresh();
		}),
		// The one preference the welcome page carries. It writes the setting the startup path already reads, so the
		// checkbox and `temcoWorkbench.start.open` cannot disagree.
		vscode.commands.registerCommand('temcoWorkbench.toggleWelcomeStartup', async () => {
			const configuration = vscode.workspace.getConfiguration('temcoWorkbench');
			const at = configuration.get<string>('start.open', 'welcome') === 'welcome';
			await configuration.update('start.open', at ? 'project' : 'welcome', vscode.ConfigurationTarget.Global);
			help.refresh();
			settings.pages.refresh();
		}),
		// The two surfaces below the Library follow the documentation module's one signal: it re-read the sets, so
		// the needs page says something new.
		onDidChange(() => {
			sidebars.refresh();
			needs.refresh();
			void countDrafts();
		})
	);

	// Which sidebar section comes forward: choosing a project brings the Workspace, clearing one brings the
	// Library. `started` keeps the boot out of it — with one project it selects itself on activation, and that is
	// not the person choosing anything.
	let started = false;
	context.subscriptions.push(
		selection.onDidChange(async () => {
			if (started) {
				await vscode.commands.executeCommand(
					selection.project() === undefined ? 'temcoProjects.projects.focus' : 'temcoDocs.pages.focus'
				);
			}
		})
	);

	// Then the tab: what `temcoWorkbench.start.open` names, falling through rather than opening an empty editor.
	void reread().then(() => {
		started = true;
		void countDrafts();
		return openStart(dashboard, help);
	});
}

export function deactivate(): void {
	// Nothing to unwind: the pages are webviews the window closes, and every command is registered on the
	// extension's own context.
}

/**
 * Whether the window is bringing pages back, waited for rather than asked once.
 *
 * A restore is asynchronous: the tab is handed back to its module once that module has activated, which can be
 * after this activation runs — so the answer is the restore itself, not the tab strip. A window with nothing to
 * restore answers after the wait, and one that is coming back answers the moment its first page is handed over.
 */
const RESTORE_SETTLE_MS = 2500;

/** Resolves true when the window restores a page of ours: now, or as soon as one is handed back. */
function pagesComeBack(): Promise<boolean> {
	if (restoredAny()) {
		return Promise.resolve(true);
	}
	return new Promise<boolean>((resolve) => {
		const finish = (back: boolean): void => {
			subscription.dispose();
			clearTimeout(timer);
			resolve(back);
		};
		const subscription = onDidRestorePage(() => finish(true));
		const timer = setTimeout(() => finish(false), RESTORE_SETTLE_MS);
	});
}

/**
 * The tab the platform opens when it starts. `temcoWorkbench.start.open` decides, and nothing else.
 *
 * The default is **the welcome page**, which is the VS Code arrangement: a fresh window opens on the page that says
 * what the application is for, and the checkbox in that page's own footer turns it off. `project`, `page` and `home`
 * are the working choices — the work you were doing instead of the orientation page.
 *
 * With the welcome page switched off the chain never ends there: `project` → the page you were last on → the
 * overview. That is the whole point of the checkbox — a person who turns it off is never shown it again by
 * accident, and an empty window gets the overview, which has its own empty state and a *New Project* button.
 * Only `none` opens no tab at all.
 *
 * **A window that came back with pages is not an empty window.** Every page of ours answers for its type, so the
 * tabs that were open when the window closed are restored — each module's serializer draws them again. Opening a
 * start page on top of them would hide the work somebody came back for, and would add a second copy of it every
 * restart: the welcome page restored, plus the one this opened. So the start page is only for a window that has
 * none of ours to show.
 */
async function openStart(dashboard: DashboardPages, help: HelpPages): Promise<void> {
	const mode = vscode.workspace.getConfiguration('temcoWorkbench').get<string>('start.open', 'welcome');
	if (mode === 'none') {
		return;
	}
	const cameBack = await pagesComeBack();
	if (cameBack) {
		return;
	}
	if (mode === 'welcome') {
		help.welcome();
		return;
	}

	const project = selection.project();
	if (mode === 'project' && project !== undefined) {
		await vscode.commands.executeCommand('temcoProjects.openProject', project);
		return;
	}
	if (mode !== 'home' && (await openRememberedPage())) {
		return;
	}
	if (mode === 'page' && project !== undefined) {
		await vscode.commands.executeCommand('temcoProjects.openProject', project);
		return;
	}
	dashboard.open('overview');
}

/**
 * The page the selected project remembers, opened when the file is still there.
 *
 * The remembered path can be gone — a branch switched, a page moved — and opening it anyway would report a fault
 * before saying hello. Answers whether it opened one, so the caller can fall through to the next step.
 */
async function openRememberedPage(): Promise<boolean> {
	const page = selection.page();
	if (page?.path === undefined) {
		return false;
	}
	try {
		await vscode.workspace.fs.stat(vscode.Uri.file(page.path));
	} catch {
		return false;
	}
	await vscode.commands.executeCommand('temcoRepositories.openFile', {
		path: page.path,
		id: page.id,
		title: page.title,
	});
	return true;
}

/** The values `temcoWorkbench.start.open` allows — the manifest's enum, so a bad message cannot write another. */
const START_OPTIONS = ['welcome', 'project', 'page', 'home', 'none'];

/**
 * The block a bug report wants pasted into it: what this build is, where it is running, and what is open.
 *
 * It is composed here rather than on the page because only the host knows these — and because the same text is what
 * the issue reporter asks for, so the two cannot drift.
 */
function diagnostics(context: vscode.ExtensionContext): string {
	const folder = vscode.workspace.workspaceFolders?.[0];
	const modules = vscode.extensions.all.filter((extension) => extension.packageJSON.publisher === 'temcocontrols');
	return [
		`Application: ${vscode.env.appName}`,
		`Version: ${vscode.version}`,
		`Platform: ${process.platform} ${process.arch}`,
		`Profile: Default`,
		`Workspace: ${folder ? folder.uri.fsPath : 'none'}`,
		`Logs: ${context.logUri.fsPath}`,
		`Modules: ${modules.length} (${modules.filter((extension) => extension.isActive).length} active)`,
		...modules.map((extension) => `  ${extension.id} ${String(extension.packageJSON.version ?? '—')} ${extension.isActive ? 'active' : 'idle'}`)
	].join('\n');
}
