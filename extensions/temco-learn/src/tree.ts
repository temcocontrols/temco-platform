// The panel: VS Code's own grouping, in VS Code's own tree.
//
// Each group is a *view* — a real section with its own header, its own collapse state, its own title-bar actions — not a
// row pretending to be a heading. A row is a name and a glyph, and what it holds is `description`: the grey words the
// Explorer writes beside a folder, never a badge of our own. Sentences belong on the Overview page, never in a row.
//
// Four views: the module's page as one row, **Site** (the site, and the library it serves), **Download** (the files a
// build wrote) and **Next steps** (the acts, publishing among them).

import * as vscode from 'vscode';
import { Artifact, ArtifactKind, formatSize, isDownloadable, isPreviewable, nameOf } from './artifacts';
import { Build } from './builds';
import { shortName } from './site';
import { repoReady, sitePort, siteRepo, siteUrl } from './siteRepo';
import { SiteStatus } from './siteRunner';
import { Snapshot } from './snapshot';
import { ago } from './state';

/** The four views this module contributes, by the ids its manifest declares. */
export const VIEWS = {
	overview: 'temcoLearn.overviewView',
	browse: 'temcoLearn.browse',
	download: 'temcoLearn.download',
	todo: 'temcoLearn.todo'
} as const;

/** A row that knows what hangs under it. */
interface Row extends vscode.TreeItem {
	/** The rows under this one, decided when the row is built. */
	kids?: Row[];
	/** The file the row stands for, so a context-menu command can find it. */
	file?: string;
}

/** The glyph for each kind of build output. */
const ICON: Record<ArtifactKind, string> = {
	site: 'globe',
	chm: 'book',
	pdf: 'file-pdf',
	page: 'file-code',
	zip: 'file-zip',
	docx: 'file-text'
};

/** `3 versions` —how many things a row holds, in the words the Explorer writes beside a folder. */
const plural = (count: number, one: string, many?: string): string =>
	`${count} ${count === 1 ? one : many === undefined ? `${one}s` : many}`;

/** A row: the name, its glyph, and the grey words beside it that say what it holds. */
function row(
	label: string,
	icon: string | vscode.ThemeIcon,
	options: { description?: string; command?: vscode.Command; tooltip?: string } = {}
): Row {
	const item: Row = new vscode.TreeItem(label, vscode.TreeItemCollapsibleState.None);
	item.iconPath = typeof icon === 'string' ? new vscode.ThemeIcon(icon) : icon;
	if (options.description !== undefined) {
		item.description = options.description;
	}
	if (options.tooltip !== undefined) {
		item.tooltip = options.tooltip;
	}
	if (options.command !== undefined) {
		item.command = options.command;
	}
	return item;
}

/** A row that holds rows: a heading, the grey words beside it, and what hangs under it. */
function group(
	label: string,
	icon: string | vscode.ThemeIcon,
	options: {
		kids: Row[];
		description?: string;
		tooltip?: string;
		state?: vscode.TreeItemCollapsibleState;
		command?: vscode.Command;
	}
): Row {
	const item: Row = new vscode.TreeItem(label, options.state ?? vscode.TreeItemCollapsibleState.Collapsed);
	item.iconPath = typeof icon === 'string' ? new vscode.ThemeIcon(icon) : icon;
	item.kids = options.kids;
	if (options.description !== undefined) {
		item.description = options.description;
	}
	if (options.tooltip !== undefined) {
		item.tooltip = options.tooltip;
	}
	if (options.command !== undefined) {
		item.command = options.command;
	}
	return item;
}
/** One read per refresh, shared by the four views, so a panel and a page can never disagree. */
export class Reads {
	private reading: Promise<Snapshot> | undefined;

	constructor(private readonly read: () => Promise<Snapshot>) { }

	data(): Promise<Snapshot> {
		if (this.reading === undefined) {
			this.reading = this.read().catch((error: unknown) => {
				this.reading = undefined;
				throw error;
			});
		}
		return this.reading;
	}

	forget(): void {
		this.reading = undefined;
	}
}


/** The builds newer than what the website holds: those are the ones worth adding. */
function waiting(data: Snapshot): Snapshot['builds'] {
	return data.builds.filter((build) => {
		const project = data.site.projects.find((entry) => entry.id === build.id);
		if (project === undefined) {
			return true;
		}
		const newest = project.versions[0]?.builtAt;
		return newest === undefined || build.at > Date.parse(newest);
	});
}

/* ---- Overview: the module's page, as one row ------------------------------------------------------------------ */

export class OverviewTree implements vscode.TreeDataProvider<Row> {
	private readonly changed = new vscode.EventEmitter<void>();
	readonly onDidChangeTreeData = this.changed.event;

	refresh(): void {
		this.changed.fire();
	}

	getTreeItem(item: Row): vscode.TreeItem {
		return item;
	}

	async getChildren(item?: Row): Promise<Row[]> {
		if (item !== undefined) {
			return [];
		}
		const entry = row('Temco Learn', 'cloud-upload', {
			tooltip: 'Open the Overview page: what is on the website, what is waiting, and where it is published',
			command: { command: 'temcoLearn.overview', title: 'Open the Overview Page' }
		});
		entry.id = 'temcoLearn.overview.root';
		return [entry];
	}
}

/* ---- Site: the site's own process, and the library it serves -------------------------------------------------- */

/**
 * The state of the server, drawn the way VS Code's own Ports view draws a running process: a coloured dot.
 *
 * The dot answers *is it up?* before a word is read —green while it serves, spinning while it comes up, red when it
 * failed —and the state coloured is a codicon's colour, so it follows the theme rather than a hex of ours.
 */
function stateIcon(status: SiteStatus, ready: boolean): vscode.ThemeIcon {
	if (!ready) {
		return new vscode.ThemeIcon('cloud-download', new vscode.ThemeColor('charts.blue'));
	}
	switch (status.state) {
		case 'running':
			return new vscode.ThemeIcon('circle-filled', new vscode.ThemeColor('charts.green'));
		case 'starting':
			return new vscode.ThemeIcon('sync~spin');
		case 'failed':
			return new vscode.ThemeIcon('error', new vscode.ThemeColor('charts.red'));
		default:
			return new vscode.ThemeIcon('circle-outline');
	}
}

/** The state in one word beside the dot: the dot says whether, the word says what. */
function stateWord(status: SiteStatus, ready: boolean): string {
	if (!ready) {
		return 'Not set up';
	}
	switch (status.state) {
		case 'running':
			return 'Running';
		case 'starting':
			return 'Starting…';
		case 'failed':
			return 'Failed';
		default:
			return 'Stopped';
	}
}

/** The colour of that word, and of the row: nothing for a server that is simply not running, because quiet is not a state. */
function stateTone(status: SiteStatus, ready: boolean): 'ok' | 'warn' | 'err' | 'info' | undefined {
	if (!ready) {
		return 'info';
	}
	switch (status.state) {
		case 'running':
			return 'ok';
		case 'starting':
			return 'warn';
		case 'failed':
			return 'err';
		default:
			return undefined;
	}
}

/** The scheme the panel's badges live in: the words are in the URI, so a decoration is a pure function of it. */
const BADGE_SCHEME = 'temco-learn-badge';

/**
 * A row's right-hand end: the words, the row it belongs to, and a tone.
 *
 * A tree row can only say something at its right-hand end through a file decoration's badge, and the badge's words travel
 * in the URI —so the row is rebuilt with new words when they change, and the provider needs no state of its own. This is
 * the shape `temco-docs` already ships its counts in.
 */
export function badgeRow(text: string, key: string, tone?: 'ok' | 'warn' | 'err' | 'info'): vscode.Uri {
	return vscode.Uri.parse(`${BADGE_SCHEME}:/${encodeURIComponent(text)}/${encodeURIComponent(key)}${tone === undefined ? '' : `?${tone}`}`);
}

/** The badge for one of those URIs: the words back out of the path, the colour out of the query. */
export function badgeDecoration(uri: vscode.Uri): vscode.FileDecoration | undefined {
	if (uri.scheme !== BADGE_SCHEME) {
		return undefined;
	}
	const text = decodeURIComponent(uri.path.split('/')[1] ?? '');
	if (text.length === 0) {
		return undefined;
	}
	const tone = uri.query === 'ok' ? 'charts.green' : uri.query === 'warn' ? 'charts.yellow' : uri.query === 'err' ? 'charts.red' : uri.query === 'info' ? 'charts.blue' : undefined;
	return { badge: text, tooltip: text, color: tone === undefined ? undefined : new vscode.ThemeColor(tone) };
}

/** Register the provider once per window; the rows carry their own words, so nothing here has to be refreshed. */
export function registerBadges(context: vscode.ExtensionContext): void {
	context.subscriptions.push(
		vscode.window.registerFileDecorationProvider({
			provideFileDecoration: badgeDecoration
		})
	);
}

export class BrowseTree implements vscode.TreeDataProvider<Row> {
	private readonly changed = new vscode.EventEmitter<void>();
	readonly onDidChangeTreeData = this.changed.event;

	constructor(private readonly reads: Reads, private readonly site: () => SiteStatus) { }

	refresh(): void {
		this.changed.fire();
	}

	getTreeItem(item: Row): vscode.TreeItem {
		return item;
	}

	async getChildren(item?: Row): Promise<Row[]> {
		if (item !== undefined) {
			return item.kids ?? [];
		}
		const data = await this.reads.data();
		return [this.theSite(), this.library(data)];
	}

	/**
	 * The site itself: a group whose heading is the page.
	 *
	 * The acts a clone needs —clone, pull, install, build, read the log —are the page's, and keeping a second copy of them
	 * here is how a panel and a page come to disagree. What a panel is good for is the state and the two acts that go with
	 * it, so the heading says what the server is doing as a coloured dot and one word, opens the page when it is clicked,
	 * and holds `Start`/`Stop` and the two ways to read the site underneath.
	 */
	private theSite(): Row {
		const status = this.site();
		const ready = repoReady(siteRepo());
		const running = status.state === 'running' || status.state === 'starting';
		const entry = group('Preview the Site', stateIcon(status, ready), {
			tooltip: ready
				? `${stateWord(status, ready)} —${status.reason ?? `${siteRepo()}: clone, build, run and read the log on one page`}`
				: `Not set up —${siteRepo()} is not the clone of temcocontrols/temco-learn. Open the page to clone it there.`,
			state: vscode.TreeItemCollapsibleState.Expanded,
			command: { command: 'temcoLearn.site.page', title: 'Open the Site Page' },
			kids: this.siteRows(ready, running)
		});
		entry.id = 'temcoLearn.browse.site';
		entry.resourceUri = badgeRow(stateWord(status, ready), 'site', stateTone(status, ready));
		return entry;
	}

	/** What sits under the site's heading: the act that changes it, and the two ways to read it. */
	private siteRows(ready: boolean, running: boolean): Row[] {
		// No clone: the two ways to get one, and both of them are on the page as well.
		if (!ready) {
			const clone = row('Clone temco-learn…', 'cloud-download', {
				description: 'into ~/temco/temco-learn',
				tooltip: 'Clone temcocontrols/temco-learn, then install and build it from the Site page',
				command: { command: 'temcoLearn.site.clone', title: 'Clone temco-learn' }
			});
			clone.id = 'temcoLearn.browse.site.clone';
			const existing = row('Use an Existing Clone…', 'folder-opened', {
				tooltip: 'Point Temco Learn at a clone that is already on this machine',
				command: { command: 'temcoLearn.site.useExisting', title: 'Use an Existing Clone' }
			});
			existing.id = 'temcoLearn.browse.site.useExisting';
			return [clone, existing];
		}

		const act = running
			? row('Stop', 'debug-stop', {
					tooltip: 'Stop the server: the port is free afterwards',
					command: { command: 'temcoLearn.site.stop', title: 'Stop the Site' }
				})
			: row('Start', 'play', {
					tooltip: 'Start the site on its one port, the way it was last served',
					command: { command: 'temcoLearn.site.start', title: 'Start the Site' }
				});
		act.id = running ? 'temcoLearn.browse.site.stop' : 'temcoLearn.browse.site.start';

		// Two places a site can be read, named for the difference a person actually feels: a tab in this window, or the
		// browser they already have open. The panel says both, so nobody has to guess which one `Open` means.
		const here = row('Open', 'preview', {
			tooltip: 'Open the site in a tab in this window, starting the server first if it is not running',
			command: { command: 'temcoLearn.site.preview', title: 'Open the Site Here' }
		});
		here.id = 'temcoLearn.browse.site.preview';

		const browser = row('Open in Browser', 'link-external', {
			tooltip: `Open the site in your browser at ${siteUrl()}, starting the server first if it is not running`,
			command: { command: 'temcoLearn.site.open', title: 'Open the Site in the Browser' }
		});
		browser.id = 'temcoLearn.browse.site.open';
		browser.resourceUri = badgeRow(':' + String(sitePort()), 'port');

		return [act, here, browser];
	}

	/**
	 * The projects the site serves, at their newest version, one level and one row each: `T3000 · 13.0`.
	 *
	 * Projects used to be a group to expand before the thing you wanted, and every version was a row —a product with twenty
	 * versions turned this into a scroll bar. The newest version is the one a person wants nine times in ten, and the site's
	 * own list holds the rest, so the panel says what the site serves and stops there.
	 */	/** The projects the site serves, at their newest version, one level and one row each: `T3000 · 13.0`. */
	private library(data: Snapshot): Row {
		const rows = this.libraryRows(data);
		const kids =
			rows.length === 0
				? [
						row('Add a Build to the Site…', 'add', {
							description: 'nothing on the site yet',
							tooltip: 'Pick a build and copy it onto the website, or write a page under content/ in the site repository',
							command: { command: 'temcoLearn.addBuilds', title: 'Add a Build to the Site' }
						})
					]
				: rows;
		const entry = group('Library', 'library', {
			tooltip: 'Every project the site serves, at its newest version —the site lists the older ones',
			kids,
			state: vscode.TreeItemCollapsibleState.Expanded
		});
		entry.id = 'temcoLearn.browse.library';
		entry.resourceUri = badgeRow(plural(rows.length, 'project'), 'library');
		return entry;
	}

	/** One project, at its newest version, opening that page on the site. The catalog writes the versions newest first. */
	private libraryRows(data: Snapshot): Row[] {
		return data.site.projects.map((project) => {
			const newest = project.versions[0];
			const name = shortName(project.title);
			const entry = row(newest === undefined ? name : `${name} · ${newest.version}`, 'library', {
				tooltip: `Read ${name}${newest === undefined ? '' : ` ${newest.version}`} on the site —every earlier version is in the site's own list`,
				command: {
					command: 'temcoLearn.site.preview',
					title: name,
					arguments: [newest === undefined ? { project: project.id } : { project: project.id, version: newest.version }]
				}
			});
			entry.id = 'temcoLearn.browse.project.' + project.id;
			entry.contextValue = 'temcoLearn.project';
			return entry;
		});
	}
}

/* ---- Download: the project name is the category -------------------------------------------------------------- */

export class DownloadTree implements vscode.TreeDataProvider<Row> {
	private readonly changed = new vscode.EventEmitter<void>();
	readonly onDidChangeTreeData = this.changed.event;

	constructor(private readonly reads: Reads) { }

	refresh(): void {
		this.changed.fire();
	}

	getTreeItem(item: Row): vscode.TreeItem {
		return item;
	}

	async getChildren(item?: Row): Promise<Row[]> {
		if (item !== undefined) {
			return item.kids ?? [];
		}
		const data = await this.reads.data();
		const rows: Row[] = [];
		for (const project of data.artifacts) {
			const shown = project.artifacts.filter(isDownloadable);
			if (shown.length === 0) {
				continue;
			}
			const entry = group(shortName(project.title), 'book', {
				description: plural(shown.length, 'file'),
				kids: shown.map((artifact) => this.artifact(artifact))
			});
			entry.id = `temcoLearn.download.${project.id}`;
			entry.contextValue = 'temcoLearn.download.project';
			rows.push(entry);
		}
		return rows.length === 0
			? [
					row('No file to take', 'info', {
						tooltip: 'Open the Build Output page: what a build writes, and where it lands',
						command: { command: 'temcoLearn.downloads', title: 'Build Output' }
					})
				]
			: rows;
	}

	/** One file the build wrote: its name, and how big it is. */
	private artifact(artifact: Artifact): Row {
		const entry = row(nameOf(artifact), ICON[artifact.kind], {
			description: artifact.size === undefined ? undefined : formatSize(artifact.size),
			tooltip: artifact.file,
			command: { command: 'temcoLearn.downloadArtifact', title: 'Save a Copy', arguments: [artifact.file] }
		});
		entry.id = `temcoLearn.download.artifact.${artifact.file}`;
		entry.contextValue = isPreviewable(artifact) ? 'temcoLearn.artifact.look' : 'temcoLearn.artifact';
		entry.file = artifact.file;
		return entry;
	}
}
/* ---- Next steps: the acts, with how many things each one clears ------------------------------------------------ */

export class TodoTree implements vscode.TreeDataProvider<Row> {
	private readonly changed = new vscode.EventEmitter<void>();
	readonly onDidChangeTreeData = this.changed.event;

	constructor(private readonly reads: Reads) { }

	refresh(): void {
		this.changed.fire();
	}

	getTreeItem(item: Row): vscode.TreeItem {
		return item;
	}

	async getChildren(item?: Row): Promise<Row[]> {
		const data = await this.reads.data();
		if (item !== undefined) {
			return this.under(item, data);
		}
		const builds = waiting(data);
		const rows: Row[] = [];
		if (builds.length > 0) {
			// The label is the act, not the state: a row that says what you would do needs no explaining.
			const add = group('Add to the site', 'add', {
				description: plural(builds.length, 'build'),
				tooltip:
					'Builds on disk the website does not serve yet. Click one to add it — you choose its version, and nothing is published until you publish.',
				kids: builds.map((build) => this.build(build, data))
			});
			add.id = 'temcoLearn.todo.builds';
			add.contextValue = 'temcoLearn.todo.builds';
			rows.push(add);
		}
		rows.push(this.publish(data));
		rows.push(row('Build a project', 'tools', { command: { command: 'temcoDocs.builds', title: 'Build a Project in Temco Docs' }, tooltip: 'Building belongs to Temco Docs' }));
		if (builds.length === 0 && data.published.pending === 0) {
			return [row('Nothing to do', 'check', { tooltip: 'Everything built is on the website, and it is published' }), ...rows];
		}
		return rows;
	}

	/** Publishing is an act, so it lives with the acts: the first time, and again after a change. */
	private publish(data: Snapshot): Row {
		const published = data.published;
		const last = published.commit === undefined ? 'never published' : `last publish ${published.commit}, ${ago(published.at)}`;
		const entry = row('Publish', 'cloud-upload', {
			description: published.pending === 0 ? 'up to date' : plural(published.pending, 'change'),
			tooltip: `${published.base ?? 'no address yet'} · ${last} · publishes the site, or publishes it again after a change`,
			command: { command: 'temcoLearn.publishing', title: 'Publishing' }
		});
		entry.id = 'temcoLearn.todo.publish';
		entry.contextValue = 'temcoLearn.publish';
		return entry;
	}

	/** The builds to add, under the finding that names them. */
	private under(item: Row, data: Snapshot): Row[] {
		return item.id === 'temcoLearn.todo.builds' ? waiting(data).map((build) => this.build(build, data)) : [];
	}

	/** One build the site does not serve: its name, why it is waiting, and the act that adds it. */
	private build(build: Build, data: Snapshot): Row {
		const entry: Row = new vscode.TreeItem(build.title, vscode.TreeItemCollapsibleState.None);
		entry.id = `temcoLearn.todo.build.${build.folder}`;
		entry.iconPath = new vscode.ThemeIcon('package');
		entry.description = whyWaiting(build, data);
		entry.contextValue = 'temcoLearn.build';
		entry.tooltip = `${whyWaiting(build, data)} — ${build.folder}: clicking this copies it onto the site and asks for its version`;
		entry.command = { command: 'temcoLearn.addBuild', title: 'Add to the Website', arguments: [build.folder] };
		return entry;
	}
}

/** Why a build is in the queue: the project is not on the site, or this build is newer than the version it serves. */
function whyWaiting(build: Build, data: Snapshot): string {
	const project = data.site.projects.find((entry) => entry.id === build.id);
	if (project === undefined) {
		return 'not on the site';
	}
	const newest = project.versions[0]?.version;
	return newest === undefined ? 'no version on the site' : `newer than ${newest}`;
}
