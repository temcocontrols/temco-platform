// New Project — two screens, and one question each.
//
// **The first screen is the choice**: three cards — Empty project, From a repository, From existing files. There is
// no step rail and no Next/Back across five screens; a person picks the kind of project, and the second screen is a
// single form whose middle section is what that kind needs. Everything else on it — name, version, owner, audience,
// outputs — is the same for all three.
//
// The card is not a label: it decides which origin `create()` receives. Empty plus a starter is a `template`, a
// folder that already has a registry is a `folder`, anything else under *existing files* is an `import`. That
// derivation is in the page's own script, so the host keeps the one code path it had.//
// The form asks for two things and shows them as tiles: a name with a version, and which outputs to build. Owner and
// audience were asked here for a while and removed — a field nobody must answer is a field that stops the flow for
// everyone, and both are editable later on the page that owns a project.//
// Nothing is written until *Create Project*: the flow is markup and a small script, and every write happens
// in `create()` — the project, its sources, its outputs, and for a template its files.

import * as vscode from 'vscode';
import * as os from 'node:os';
import * as path from 'node:path';
import { draftProjectPage } from './aiModule';
import { RepositoryFile, RepositorySource, repositoryFiles, repositoryMaterial } from './repositories';
import { Catalog, CatalogUnavailable, Selection, slugOf, SourceRow, outputs } from './store';
import { actionBar, callout, checkCards, choiceCards, escapeHtml as esc, formFields, hero, icon, page, pageColumn, remember, section } from './ui';
import { versionAddress, versionName } from './versionName';

export const NEW_PROJECT_VIEW_TYPE = 'temcoProjects.newProject';

/**
 * The repository a project is being created *from*, when the flow was opened from one.
 *
 * Present means the repository is already the answer to "where do the pages come from": the flow does not ask, it
 * starts from that repository and asks only what is inside it.
 */
export interface PinnedRepository {
	name: string;
	cloneUrl?: string;
	branch?: string;
	/** The files a person already ticked on the repository's own page, so the form opens on that selection. */
	files?: readonly string[];
}

/** What the flow offers when it opens. The mock's defaults, over whatever sources the catalog has. */
const DEFAULTS = { name: 'Test1', version: '1.0' };

/**
 * Where a new project's folder is written when the field is left alone.
 *
 * The same three keys every other module reads: the projects folder, the working area when that is empty, and the home
 * folder when neither is set. A template that wrote itself into `~/temco` while removal looked in `~/temco/projects/t3000`
 * would leave a folder behind that nobody could find or delete.
 *
 * Exported for the placement cases in `test/temco/projects.mts`: this is the rule the guide states, and it was got
 * wrong once.
 */
export function defaultFolder(): string {
  const projects = vscode.workspace.getConfiguration('temcoRepositories').get<string>('projectsFolder');
  if (projects !== undefined && projects.trim().length > 0) {
    return projects.trim();
  }
  const area = vscode.workspace.getConfiguration('temcoRepositories').get<string>('workspaceFolder');
  return area !== undefined && area.trim().length > 0 ? area.trim() : '~/temco';
}

/** What a project can build. One build produces every one of them, so they are ticks, not a choice. */
/**
 * The outputs the create form offers, read from the store's one list.
 *
 * The same list names the categories on Publish & Releases and the scripts Build Center runs, so a target renamed here
 * is renamed on all three screens at once instead of drifting apart one screen at a time.
 */
export const TARGETS = outputs.all.map((output) => ({
	value: output.value,
	label: output.label,
	sub: output.purpose,
	mark: output.mark
}));

/** The outputs ticked when the page opens. */
const DEFAULT_TARGETS = outputs.defaults;

/** How a project begins. `available: false` is shown, disabled, with the reason — never hidden. */
export interface Origin {
	value: string;
	label: string;
	sub: string;
	available: boolean;
}

export const ORIGINS: Origin[] = [
	{ value: 'blank', label: 'Start empty', sub: 'No pages yet; the first one is written in the workspace.', available: true },
	{ value: 'repository', label: 'From a repository', sub: 'Cite what the platform has already read — repositories, files and folders.', available: true },
	{ value: 'folder', label: 'From a folder', sub: 'Record a folder on this machine as the pages it reads.', available: true },
	{ value: 'template', label: 'From a template', sub: 'Write a starter docs/help tree: an area, two topics and the registry.', available: true },
	{ value: 'import', label: 'Import a document set', sub: 'Word, RTF, HTML, an HTML folder or CHM — converted into docs/ and the registry.', available: true }
];

/** The starters a project can be written from. One, and it is the MSDN shape: area — topics. */
const TEMPLATES = [{ value: 'user-guide', label: 'User guide', sub: 'docs/help with an Overview area, two topics and a registry' }];

export class ProjectFlowPage {
	private panel: vscode.WebviewPanel | undefined;
	private sources: SourceRow[] = [];
	/** The repository this flow was opened from, when it was opened from one. */
	private pinned: PinnedRepository | undefined;
	/** Repositories chosen while this form did not exist yet: applied when the form says it is ready. */
	private pending: string[] = [];

	constructor(
		private readonly context: vscode.ExtensionContext,
		private readonly selection: Selection,
		private readonly refresh: () => void
	) { }

	async open(pinned?: PinnedRepository, restored?: vscode.WebviewPanel): Promise<void> {
		remember(this.context, NEW_PROJECT_VIEW_TYPE);
		this.pinned = pinned;
		let unavailable: string | undefined;
		let catalog: Catalog | undefined;
		try {
			catalog = await Catalog.open(this.context);
			// A project created *from* a repository cites it, so the source exists before the form does — the same
			// row `Start` writes on the repositories page, reached from the other end.
			if (pinned !== undefined) {
				catalog.addSource({
					kind: 'git',
					name: pinned.name,
					slug: slugOf(pinned.name),
					remoteUrl: pinned.cloneUrl,
					defaultBranch: pinned.branch,
				});
			}
			this.sources = catalog.sources();
		} catch (error) {
			unavailable = error instanceof CatalogUnavailable ? error.message : String(error);
			this.sources = [];
		} finally {
			// The page is static once it knows the sources: the handle is not kept for the form's lifetime.
			catalog?.close();
		}

		const body = html(pinned, unavailable);
		if (this.panel) {
			this.panel.reveal(pageColumn());
			this.panel.webview.html = page(body, { title: 'New Project', script: WIZARD_SCRIPT, extraCss: FLOW_CSS });
			return;
		}

		// A restored tab is drawn into rather than replaced: it keeps its place in the strip.
		this.panel = restored ?? vscode.window.createWebviewPanel(NEW_PROJECT_VIEW_TYPE, 'New Project', pageColumn(), {
			enableScripts: true,
			localResourceRoots: []
		});
		this.panel.webview.options = { enableScripts: true, localResourceRoots: [] };
		this.panel.webview.onDidReceiveMessage((message: { type?: string; command?: string; values?: Values; picked?: string[]; files?: string[]; value?: string; name?: string }) => void this.receive(message));
		this.panel.webview.html = page(body, { title: 'New Project', script: WIZARD_SCRIPT, extraCss: FLOW_CSS });
		this.panel.onDidDispose(() => {
			this.panel = undefined;
		});
	}

	dispose(): void {
		this.panel?.dispose();
	}

	/**
	 * Brings the form forward **without rebuilding it**.
	 *
	 * The form is a live document: re-rendering it would throw away everything typed and ticked. Coming back from the
	 * repositories page is a return, not a refresh — but only while the tab is still there. When it was closed there
	 * is nothing to return to and nothing to lose, so "back to the form" opens a new one instead of doing nothing.
	 */
	reveal(): void {
		if (this.panel === undefined) {
			void this.open();
			return;
		}
		this.panel.reveal(pageColumn());
	}

	/**
	 * Ticks repositories this form should cite, chosen elsewhere — the repositories page's selection.
	 *
	 * Choosing a repository *is* what records it: it becomes a source of the platform (the same row `Start` writes,
	 * without a read), so the form has a row to tick. Then the rail moves to *From a repository* — a list nobody can
	 * see is not an answer.
	 */
	async cite(names: readonly string[]): Promise<void> {
		if (names.length === 0) {
			return;
		}
		if (this.panel === undefined) {
			// No form to hand it to yet: the sources are recorded now, and the answer is applied when the new form is
			// ready — posting to a webview that has not loaded a document yet is posting into nothing.
			this.pending = names.slice();
			await this.open();
			return;
		}
		await this.applyCite(names);
	}

	/** Tells the open form what was chosen, after recording the sources it is going to cite. */
	private async applyCite(names: readonly string[]): Promise<void> {
		const known = await this.ensureKnown(names);
		this.refresh();
		this.panel?.reveal(pageColumn());
		await this.panel?.webview.postMessage({ type: 'known', known });
		await this.panel?.webview.postMessage({ type: 'chosen', sources: names });
		await this.panel?.webview.postMessage({ type: 'rail', rail: 'repository' });
	}

	/**
	 * Records the named repositories as sources if they are not already, and answers the form's own list of known
	 * sources. A source is recorded once and cited by any number of projects, so this only ever adds.
	 */
	private async ensureKnown(
		names: readonly string[]
	): Promise<{ slug: string; name: string; kind: string; branch?: string; pages?: number; line: string }[]> {
		let catalog: Catalog | undefined;
		try {
			catalog = await Catalog.open(this.context);
			const cached = new Map<string, { cloneUrl?: string; defaultBranch?: string }>();
			for (const organisation of catalog.organisations()) {
				for (const row of catalog.repositoriesOf(organisation.slug)) {
					cached.set(row.name, { cloneUrl: row.cloneUrl, defaultBranch: row.defaultBranch });
				}
			}
			for (const name of names) {
				if (catalog.source(slugOf(name)) !== undefined) {
					continue;
				}
				const row = cached.get(name);
				catalog.addSource({
					kind: 'git',
					name,
					slug: slugOf(name),
					remoteUrl: row?.cloneUrl,
					defaultBranch: row?.defaultBranch,
				});
			}
			this.sources = catalog.sources();
		} catch {
			return [];
		} finally {
			catalog?.close();
		}

		return this.sources
			.filter((source) => source.kind === 'git')
			.map((source) => ({
				slug: source.slug,
				name: source.name,
				kind: source.kind,
				branch: source.branch,
				pages: source.pages,
				line: [
					source.kind === 'git' ? 'repository' : source.kind,
					source.branch,
					source.pages === undefined ? 'never read' : `${source.pages} pages`,
				]
					.filter((part): part is string => Boolean(part))
					.join(' · '),
			}));
	}

	/**
	 * The one question *from existing files* asks: which folder or file.
	 *
	 * The kind is worked out here rather than asked of the person: they know where their material is, and they should not
	 * have to know which converter the platform will reach for. The answer goes back to the page as `{ path, kind, note }`,
	 * and the page derives the origin from `kind` exactly as it did when the kind was a dropdown.
	 */
	private async pickMaterial(): Promise<void> {
		const picked = await vscode.window.showOpenDialog({
			canSelectFiles: true,
			canSelectFolders: true,
			canSelectMany: false,
			openLabel: 'Use this',
			title: 'Choose the material to bring in'
		});
		const uri = picked?.[0];
		if (uri === undefined) {
			return;
		}
		await this.panel?.webview.postMessage({ type: 'picked', ...(await describeMaterial(uri)) });
	}

	private async receive(message: { type?: string; command?: string; values?: Values; picked?: string[]; files?: string[]; value?: string; name?: string }): Promise<void> {
		if (message.type === 'cancel') {
			this.panel?.dispose();
			return;
		}
		if (message.type === 'pick') {
			await this.pickMaterial();
			return;
		}
		if (message.type === 'files') {
			await this.sendFiles();
			return;
		}
		if (message.type === 'ready') {
			// A choice made before this form existed: applied now that there is a document to apply it to.
			if (this.pending.length > 0) {
				const names = this.pending;
				this.pending = [];
				await this.applyCite(names);
			}
			return;
		}
		if (message.type === 'version') {
			this.previewVersion(message.value ?? '', message.name ?? '');
			return;
		}
		if (message.type === 'draft') {
			await this.draft(message.files ?? []);
			return;
		}
		if (message.type === 'command' && typeof message.command === 'string') {
			await vscode.commands.executeCommand(message.command);
			return;
		}
		if (message.type === 'create' && message.values) {
			await this.create(message.values);
		}
	}

	/**
	 * What the typed version will be called, answered as it is typed.
	 *
	 * A version is a folder and an address, and neither is obvious from the field alone — so the form shows the address
	 * this version gives the project, or the reason it cannot be one, without waiting for the project to be created.
	 */
	private previewVersion(text: string, name: string): void {
		const outcome = versionName(text);
		const slug = name.trim().length > 0 ? slugOf(name.trim()) : '';
		void this.panel?.webview.postMessage({
			type: 'version',
			ok: outcome.ok,
			note: outcome.ok ? `Address: ${versionAddress(slug.length > 0 ? slug : slugOf(DEFAULTS.name), outcome.value)}` : outcome.why
		});
	}

	/** The pinned repository as a source, as the repositories module reads one. */
	private pinnedSource(): RepositorySource | undefined {
		if (this.pinned === undefined) {
			return undefined;
		}
		const branch = this.pinned.branch;
		return {
			name: this.pinned.name,
			remoteUrl: this.pinned.cloneUrl,
			branch,
			defaultBranch: branch
		};
	}

	/**
	 * What the pinned repository carries, classified: the documentation it already has, and the files a page could be
	 * written from. One listing, two answers, and the documentation's own registry and overview are ticked for you.
	 */
	private async sendFiles(): Promise<void> {
		const source = this.pinnedSource();
		if (source === undefined) {
			return;
		}
		const listed = await repositoryFiles(source);
		if ('error' in listed) {
			await this.panel?.webview.postMessage({ type: 'files', error: listed.error });
			return;
		}
		const files = listed.files.map((file: RepositoryFile) => ({
			path: file.path,
			size: file.size,
			category: isDocumentation(file.path) ? 'docs' : 'code',
			// A selection made on the repository's page wins over the default: it is a person's answer, not a guess.
			ticked: this.pinned?.files === undefined ? defaultTick(file.path) : this.pinned.files.includes(file.path)
		}));
		await this.panel?.webview.postMessage({ type: 'files', files, note: listed.note });
	}

	/** One page of the project, drafted from the files a person ticked — returned, never written. */
	private async draft(names: readonly string[]): Promise<void> {
		const source = this.pinnedSource();
		if (source === undefined || names.length === 0) {
			await this.panel?.webview.postMessage({ type: 'drafted', error: 'Choose at least one file to draft from.' });
			return;
		}
		const material = await repositoryMaterial(source, names);
		if (material.text.trim().length === 0) {
			await this.panel?.webview.postMessage({
				type: 'drafted',
				error: 'Those files are empty or could not be read, so there is nothing to draft from.'
			});
			return;
		}
		const answer = await draftProjectPage({ title: this.pinned?.name ?? 'The project', material: material.text });
		if (answer === undefined) {
			await this.panel?.webview.postMessage({
				type: 'drafted',
				error: 'The AI module is not installed, so nothing was drafted. The project can still be created without one.'
			});
			return;
		}
		if ('error' in answer) {
			await this.panel?.webview.postMessage({ type: 'drafted', error: answer.error });
			return;
		}
		await this.panel?.webview.postMessage({
			type: 'drafted',
			text: answer.text,
			characters: material.characters,
			included: material.included.length,
			skipped: material.skipped
		});
	}

	/**
	 * The project, where its pages come from, and what it builds.
	 *
	 * The origin decides the middle: a folder or a template has to exist (or be written) before the project can
	 * cite it, and only then is the document recorded — so a project never points at a folder nobody made.
	 */
	private async create(values: Values): Promise<void> {
		const name = values.name.trim();
		if (name.length === 0) {
			return;
		}
		// Checked before anything is written: the version is a folder name and part of every artifact's name, so a
		// project that got this far with `v1.0` would carry it into the site for good.
		const version = versionName(values.version);
		if (!version.ok) {
			void vscode.window.showErrorMessage(`Temco Projects: ${version.why}`);
			return;
		}
		const slug = slugOf(name);
		const origin = ORIGINS.find((entry) => entry.value === values.origin && entry.available)?.value ?? 'blank';
		const outputs = values.targets.filter((target) => TARGETS.some((known) => known.value === target));
		const cited = origin === 'repository' ? values.sources.map((source) => slugOf(source)) : [];

		let catalog: Catalog | undefined;
		try {
			catalog = await Catalog.open(this.context);

			if (origin === 'folder' || origin === 'template' || origin === 'import') {
				const folder = resolveFolder(values.folder, name, origin !== 'folder');
				if (origin === 'template') {
					const outcome = await writeTemplate(this.context.extensionUri, folder, name, version.value, values.template);
					if (outcome !== undefined) {
						void vscode.window.showErrorMessage(`Temco Projects: ${outcome}`);
						return;
					}
				} else if (origin === 'import') {
					const imported = await this.importInto(folder, values);
					if (imported === undefined) {
						return;
					}
				} else if (!(await exists(folder))) {
					void vscode.window.showErrorMessage(
						`Temco Projects: ${folder.fsPath} is not there, so nothing was recorded. Check the path and try again.`
					);
					return;
				}
				// A folder of pages is a source like any other: recorded once, cited by however many projects use it.
				const sourceSlug = slugOf(path.basename(folder.fsPath) || name);
				catalog.addSource({ kind: 'folder', name, slug: sourceSlug, path: folder.fsPath });
				cited.push(sourceSlug);
			}

			catalog.createDocument({
				name,
				slug,
				version: version.value,
				origin,
				template: origin === 'template' ? values.template : undefined
			});
			catalog.setDocumentSources(slug, [...new Set(cited)]);
			catalog.setRecipe(slug, 'docfx', outputs);
			// A drafted page is kept with the project, not written beside it: the project's own page is where text
			// becomes a file, and a draft that wrote itself would be a file nobody asked for yet.
			if (values.draft !== undefined && values.draft.trim().length > 0) {
				catalog.saveDraft({
					documentSlug: slug,
					pageId: 'docs/help/overview.md',
					title: `${name} — overview`,
					kind: 'overview',
					body: values.draft
				});
			}
		} catch (error) {
			const message = error instanceof CatalogUnavailable ? error.message : String(error);
			void vscode.window.showErrorMessage(`Temco Projects: ${message}`);
			return;
		} finally {
			catalog?.close();
		}

		// A project you have just made is the one you are working on: it is what the Workspace view and the AI read.
		// A project with no source has no folder to write a page into either, so one is made for it first — under the
		// working folder, with the smallest registry the generator accepts, and cited to the project.
		if (cited.length === 0) {
			await vscode.commands.executeCommand('temcoDocs.createProjectFolder', slug, name);
		}
		await this.selection.select(slug);
		this.refresh();
		this.panel?.dispose();
		void vscode.window.showInformationMessage(`${name} created as a draft.`);
		if (values.draft !== undefined && values.draft.trim().length > 0) {
			void this.writeDraft(name, values.draft);
		}
		await vscode.commands.executeCommand('temcoDocs.projects');
	}

	/**
	 * Offers to put the drafted page on disk, once the project exists.
	 *
	 * The draft is kept with the project either way. This is simply the one moment when "where would it go" has an
	 * obvious answer, because the person has just decided what the project is; a draft that quietly wrote itself would
	 * be a file nobody chose the place for.
	 */
	private async writeDraft(name: string, body: string): Promise<void> {
		const answer = await vscode.window.showInformationMessage(
			`${name} created — the drafted overview is kept with it.`,
			'Write it to a folder…',
			'Not now'
		);
		if (answer !== 'Write it to a folder…') {
			return;
		}
		const picked = await vscode.window.showOpenDialog({
			canSelectFiles: false,
			canSelectFolders: true,
			canSelectMany: false,
			openLabel: 'Write docs/help here',
			title: 'Where should docs/help/overview.md be written?'
		});
		const folder = picked?.[0];
		if (folder === undefined) {
			return;
		}
		const target = vscode.Uri.joinPath(folder, 'docs', 'help', 'overview.md');
		if (await exists(target)) {
			void vscode.window.showWarningMessage(
				`Temco Projects: ${target.fsPath} already exists, so nothing was written.`
			);
			return;
		}
		await vscode.workspace.fs.createDirectory(vscode.Uri.joinPath(folder, 'docs', 'help'));
		await vscode.workspace.fs.writeFile(target, Buffer.from(body, 'utf8'));
		await vscode.window.showTextDocument(target);
	}

	/**
	 * Converts the material into the folder, through the documentation module's own importer.
	 *
	 * A command rather than an import: the converter belongs to the module that owns the registry contract, and a
	 * project must not reach into another module's sources. Answers `undefined` when nothing should be recorded,
	 * after saying why on screen.
	 */
	private async importInto(folder: vscode.Uri, values: Values): Promise<true | undefined> {
		const source = expand(values.importSource);
		if (source.length === 0) {
			void vscode.window.showErrorMessage('Temco Projects: an import needs a file or a folder to read.');
			return undefined;
		}

		let outcome: ImportOutcome | undefined;
		try {
			outcome = await vscode.commands.executeCommand<ImportOutcome>('temcoDocs.import', {
				kind: values.importKind,
				source,
				destination: folder.fsPath
			});
		} catch {
			void vscode.window.showErrorMessage(
				'Temco Projects: the documentation module is not active, so nothing was imported.'
			);
			return undefined;
		}

		if (outcome === undefined || typeof outcome.error === 'string') {
			void vscode.window.showErrorMessage(
				`Temco Projects: ${outcome?.error ?? 'the import did not complete, so nothing was recorded.'}`
			);
			return undefined;
		}

		if ((outcome.pages ?? 0) > 0) {
			void vscode.window.showInformationMessage(`Temco Projects: ${outcome.pages} page(s) imported into ${folder.fsPath}.`);
		}
		// `true`, not `undefined`: the caller reads `undefined` as "nothing was imported, stop", and returning it after
		// a *successful* import ended the flow right before the project was recorded.
		return true;
	}
}

interface Values {
	name: string;
	version: string;
	origin: string;
	folder: string;
	template: string;
	importKind: string;
	importSource: string;
	sources: string[];
	targets: string[];
	/** The files of the pinned repository the person ticked, and the page the AI drafted from them. */
	files?: string[];
	draft?: string;
}

/** A file of the pinned repository under `docs/`, in one of the shapes a page is written in. */
function isDocumentation(file: string): boolean {
	const lower = file.toLowerCase();
	if (!/\.(md|markdown|html|htm|json)$/.test(lower)) {
		return false;
	}
	return /(^|\/)docs\//.test(lower) || lower.endsWith('registry.json');
}

/**
 * What starts ticked: the repository's own registry and its overview, when it has them.
 *
 * The two files that *are* the documentation's shape. Everything else — every topic, every class — starts unticked,
 * so a person adds what a draft should read rather than removing most of a repository from it.
 *
 * Exported for `test/temco/templates.mts`: getting this list wrong is how an import silently reads ninety pages, or
 * none.
 */
export function defaultTick(file: string): boolean {
	const lower = file.toLowerCase();
	return /(^|\/)docs\/help\/registry\.json$/.test(lower) || /(^|\/)docs\/help\/overview\.md$/.test(lower);
}

/** What `temcoDocs.import` answers: the pages it wrote, or the sentence that stopped it. */
interface ImportOutcome {
	pages?: number;
	error?: string;
}

/**
 * A path a person typed, with `~` for their home folder — the only shorthand the field takes.
 *
 * `under` is the difference between the two origins that use a path: a folder project *is* the folder it names,
 * while a template writes its tree into a folder of the project's own inside the one it names.
 *
 * Exported for the placement cases in `test/temco/projects.mts`, where the two origins are told apart.
 */
export function resolveFolder(text: string, name: string, under: boolean): vscode.Uri {
	const base = text.trim() || defaultFolder();
	const expanded = expand(base);
	const folder = under ? path.join(expanded, slugOf(name)) : expanded;
	return vscode.Uri.file(folder);
}

/** `~` and `~/…` as the home folder — the only shorthand either path field takes. */
function expand(text: string): string {
	const trimmed = text.trim();
	if (trimmed === '~') {
		return os.homedir();
	}
	return trimmed.startsWith('~/') || trimmed.startsWith('~\\') ? path.join(os.homedir(), trimmed.slice(2)) : trimmed;
}

async function exists(uri: vscode.Uri): Promise<boolean> {
	try {
		await vscode.workspace.fs.stat(uri);
		return true;
	} catch {
		return false;
	}
}

/**
 * What a picked folder or file is, in the importer's own vocabulary.
 *
 * A folder with a registry is cited as it stands; a folder of Markdown or HTML is a conversion; a file is whatever its
 * extension says. The count is bounded, because this runs to fill in one line of a page and a person may well point it
 * at a whole drive by accident.
 */
async function describeMaterial(uri: vscode.Uri): Promise<{ path: string; kind: string; note: string }> {
	const at = uri.fsPath;
	let stat: vscode.FileStat;
	try {
		stat = await vscode.workspace.fs.stat(uri);
	} catch {
		return { path: at, kind: '', note: 'That path cannot be read.' };
	}

	if ((stat.type & vscode.FileType.Directory) !== 0) {
		const registered = await exists(vscode.Uri.joinPath(uri, 'docs', 'help', 'registry.json'))
			|| await exists(vscode.Uri.joinPath(uri, 'docs', 'registry.json'))
			|| await exists(vscode.Uri.joinPath(uri, 'registry.json'));
		if (registered) {
			return { path: at, kind: 'existing', note: 'A docs folder that already has a registry — its pages are cited as they stand.' };
		}
		const counts = await countDocuments(uri);
		if (counts.markdown > 0) {
			return { path: at, kind: 'markdown', note: `A Markdown folder — ${counts.markdown} ${counts.markdown === 1 ? 'file' : 'files'} to convert.` };
		}
		if (counts.html > 0) {
			return { path: at, kind: 'html', note: `An HTML folder — ${counts.html} ${counts.html === 1 ? 'file' : 'files'} to convert.` };
		}
		return { path: at, kind: '', note: 'That folder holds neither a registry nor Markdown or HTML files.' };
	}

	const name = at.toLowerCase();
	if (name.endsWith('.chm')) {
		return { path: at, kind: 'chm', note: 'A compiled help file — decompiled with hh.exe, then converted.' };
	}
	if (name.endsWith('.docx') || name.endsWith('.doc') || name.endsWith('.rtf') || name.endsWith('.odt')) {
		return { path: at, kind: 'word', note: 'A Word document — converted with pandoc.' };
	}
	if (name.endsWith('.md') || name.endsWith('.markdown')) {
		return { path: at, kind: 'markdown', note: 'A Markdown file — brought in as pages.' };
	}
	if (name.endsWith('.html') || name.endsWith('.htm')) {
		return { path: at, kind: 'html', note: 'An HTML page — brought in as pages.' };
	}
	return { path: at, kind: '', note: 'That file is not a document this build can read.' };
}

/** Markdown and HTML files under a folder, counted to a budget rather than to the end of the drive. */
async function countDocuments(folder: vscode.Uri): Promise<{ markdown: number; html: number }> {
	const counts = { markdown: 0, html: 0 };
	let budget = 2000;

	const walk = async (dir: vscode.Uri): Promise<void> => {
		if (budget <= 0) {
			return;
		}
		let entries: [string, vscode.FileType][];
		try {
			entries = await vscode.workspace.fs.readDirectory(dir);
		} catch {
			return;
		}
		for (const [name, type] of entries) {
			if (budget <= 0) {
				return;
			}
			budget--;
			if ((type & vscode.FileType.Directory) !== 0) {
				await walk(vscode.Uri.joinPath(dir, name));
				continue;
			}
			const lower = name.toLowerCase();
			if (lower.endsWith('.md') || lower.endsWith('.markdown')) {
				counts.markdown++;
			} else if (lower.endsWith('.html') || lower.endsWith('.htm')) {
				counts.html++;
			}
		}
	};

	await walk(folder);
	return counts;
}

/**
 * Writes the starter tree a `template` project begins from — and nothing over anything.
 *
 * The files are the extension's own assets under `templates/<id>/`, copied rather than written from strings, so the
 * starter is readable and reviewable like any other source. Two of them are what make the project *finished* rather
 * than merely started: `scripts/docs-registry.mjs` (the generator the repository would otherwise have to bring, which
 * is what turns a new page into a page) and `scripts/docs-site.mjs` (the site build the Build Center invokes). Without
 * them a project made in this window could not index its own page or build its own site.
 *
 * `*.mjs.txt` assets are copied to `*.mjs`: the repository's hygiene rule forbids committing JavaScript, and a starter's
 * copy is JavaScript only once it is a project's own file.
 *
 * Returns the reason it could not be written, or `undefined` when it was. Exported for `test/temco/templates.mts`,
 * which writes a starter into a throwaway folder and reads what landed there.
 */
export async function writeTemplate(
	extensionUri: vscode.Uri,
	folder: vscode.Uri,
	name: string,
	version: string,
	template: string
): Promise<string | undefined> {
	if (!TEMPLATES.some((known) => known.value === template)) {
		return `“${template}” is not a starter this build knows.`;
	}

	const files = TEMPLATE_FILES.map((relative) => ({
		source: vscode.Uri.joinPath(extensionUri, 'templates', template, ...relative.split('/')),
		target: vscode.Uri.joinPath(folder, ...relative.replace(/\.txt$/, '').split('/'))
	}));

	// Refuse before writing one byte: a starter that replaces a page is a starter that loses work.
	for (const file of files) {
		if (await exists(file.target)) {
			return `${file.target.fsPath} already exists, so nothing was written. Choose an empty folder.`;
		}
	}

	for (const file of files) {
		const text = Buffer.from(await vscode.workspace.fs.readFile(file.source))
			.toString('utf8')
			.replace(/\{\{name\}\}/g, name)
			.replace(/\{\{version\}\}/g, version);
		await vscode.workspace.fs.createDirectory(vscode.Uri.joinPath(file.target, '..'));
		await vscode.workspace.fs.writeFile(file.target, Buffer.from(text, 'utf8'));
	}
	return undefined;
}

/**
 * The files a starter is made of, relative to `templates/<id>/`.
 *
 * Everything a project needs to be self-sufficient: the pages, the registry, the generator that keeps the registry
 * in step with the pages, and the site build.
 */
const TEMPLATE_FILES = [
	'package.json',
	'docs/help/registry.json',
	'docs/overview/index.md',
	'docs/overview/getting-started.md',
	'scripts/docs-registry.mjs.txt',
	'scripts/docs-site.mjs.txt'
];

/**
 * The three ways a project can begin, as the cards that choose between them.
 *
 * The choice is a decision, not navigation: three cards can be compared in a glance, where a 244px rail of the same
 * three put a second column on the page for a control three rows tall.
 */
const CHOICES = [
	{ value: 'empty', mark: 'document', title: 'Empty project', desc: 'No sources, no pages yet' },
	{ value: 'repository', mark: 'repo', title: 'From a repository', desc: 'Cite repositories already recorded' },
	{ value: 'files', mark: 'layers', title: 'From existing files', desc: 'HTML, Markdown, Word, CHM — or a docs folder' }
];

/**
 * The flow's markup.
 *
 * Everything the flow needs is on this one page: the choice of where the pages come from, and the form that follows
 * it. It never sends a person to another page to finish an answer — a wizard that jumps away and comes back loses both
 * the thread and the half-filled form.
 */
function html(pinned: PinnedRepository | undefined, unavailable?: string): string {
	const initial = pinned === undefined ? 'empty' : 'repository';
	const empty = unavailable
		? callout({ mark: 'alert', title: 'The store is not available.', desc: unavailable })
		: '';

	// Opened from a repository: it is already the answer to *where the pages come from*, so the chooser is replaced by
	// the one repository and the section continues into what is inside it.
	//
	// Otherwise this section **chooses nothing**: picking a repository happens on the repositories page — where the list,
	// the download and the files are — and the form only states what was picked. A checkbox in a form that shows a
	// filtered copy of another page is a checkbox that lies about what it is choosing from.
	const sourceSection = pinned === undefined
		? `${section({ title: 'Where the pages come from', desc: 'Chosen on the repositories page: browse it, pick the repositories this project is built from, then come back with Cite in the new project. What you picked is listed here.' })}
<div class="chosen" id="chosen-list"></div>
<p class="flow-note" id="source-summary">No repository chosen yet — open the repositories page and pick one.</p>
<div class="flow-tools">
	<button type="button" class="az-btn az-btn--sm" id="manage-repositories">${icon('repo')}<span>Open the repositories page</span></button>
	<button type="button" class="az-btn az-btn--link" id="source-clear">Clear the choice</button>
</div>`
		: `${section({ title: 'Where the pages come from', desc: 'This project starts from the repository it was opened from: it is added as the project’s source, and nothing is written into it.' })}
<div class="flow-pin"><span class="flow-pin__icon">${icon('repo')}</span><span class="flow-pin__main"><span class="flow-pin__name">${esc(pinned.name)}</span><span class="flow-pin__sub">repository${pinned.branch === undefined ? '' : ` · ${esc(pinned.branch)}`} · added by this project</span></span></div>
${section({ title: 'What is inside it', desc: 'The documentation it already has, and the files a page could be written from. Nothing is copied: the draft is kept with the project.' })}
<div class="flow-tools">
	<input class="az-input" data-filter="files" placeholder="Search files" aria-label="Search files">
	<button type="button" class="az-btn az-btn--sm" id="file-all">Select all</button>
	<button type="button" class="az-btn az-btn--sm" id="file-none">Clear</button>
</div>
<div class="flow-list" id="file-list"><p class="flow-note">Reading the file list…</p></div>
<p class="flow-note" id="file-summary">No file selected yet.</p>
<div class="flow-tools">
	<button type="button" class="az-btn" id="draft-run">AI draft from these</button>
	<button type="button" class="az-btn az-btn--link" id="draft-clear" hidden>Clear the draft</button>
	<span class="flow-note" id="draft-note"></span>
</div>
<pre class="flow-draft" id="draft-preview" hidden></pre>`;

	return `${hero({
		mark: 'plus',
		title: 'New Project',
		desc: 'A project is a version of a product’s documentation: the sources it reads, the pages it holds and the artifacts it builds.',
		descWide: true
	})}
${empty}

<div class="az-flow" data-initial-type="${esc(initial)}">
	<div class="flow-error" id="wizard-error" role="alert" hidden></div>
	${choiceCards({ items: CHOICES, selected: initial })}
	<div class="flow-head">
		<span class="flow-head__title" id="form-title">Empty project</span>
		<span class="flow-head__hint" id="form-hint"></span>
	</div>

	${section({ title: 'The project', desc: 'What it is called, and who answers for it.' })}
	${formFields([
		{ label: 'Name', control: `<input class="az-input" data-field="name" value="${esc(DEFAULTS.name)}" aria-label="Project name">` },
		{ label: 'Version', control: `<input class="az-input" data-field="version" value="${esc(DEFAULTS.version)}" aria-label="Version" autocomplete="off"><span class="flow-version" id="version-note" aria-live="polite"></span>`, hint: 'One version at a time, in digits: 1.0, 17.4, or 2026.01. It names the folder and the address.' }
	])}

	<div data-form="empty">
		${section({ title: 'Where the pages come from', desc: 'An empty project has no sources at all. A starter writes the first ones — an overview area, two topics, and the registry the platform reads.' })}
		${formFields([
		{ label: 'Starter', control: `<select class="az-input" data-field="template" aria-label="Starter"><option value="">Nothing — begin with no pages</option>${TEMPLATES.map((template) => `<option value="${esc(template.value)}">${esc(template.label)} — ${esc(template.sub)}</option>`).join('')}</select>`, wide: true }
	])}
		<div data-starter-folder hidden>
			${formFields([
		{ label: 'Write it under', control: `<input class="az-input" data-field="folder" value="${esc(defaultFolder())}" aria-label="Folder">`, hint: 'A path; ~ is your home folder. The project name becomes the folder under it.', wide: true }
	])}
		</div>
	</div>

	<div data-form="repository" hidden>
		${sourceSection}
	</div>

	<div data-form="files" hidden>
		${section({ title: 'What the material is', desc: 'Choose the folder or file. A folder that already has a registry is cited as it stands; anything else — Markdown, HTML, Word or CHM — is converted once into docs/ and docs/help/registry.json.' })}
		<div class="flow-tools">
			<button type="button" class="az-btn" id="pick-material">${icon('folder')}<span>Choose a folder or file…</span></button>
			<span class="flow-path" id="material-path">Nothing chosen yet</span>
		</div>
		<p class="flow-note" id="material-note"></p>
	</div>

	${section({ title: 'What it builds', desc: 'One build produces every target you tick here — and every one of them can be turned on later in the Build Center.' })}
	${checkCards({
		field: 'targets',
		items: TARGETS.map((target) => ({ value: target.value, label: target.label, note: target.sub, mark: target.mark })),
		ticked: DEFAULT_TARGETS
	})}

	${actionBar({
		summaryId: 'wizard-summary',
		actions: `<button type="button" class="az-btn" id="wizard-cancel">${icon('close')}<span>Cancel</span></button><button type="button" class="az-btn az-btn--primary" id="wizard-create">${icon('check')}<span>Create Project</span></button>`
	})}
</div>`;
}

/**
 * The flow's own shapes: what the shared vocabulary does not name.
 *
 * The line that confirms the choice, the receipt of a pinned repository, the bounded file list, the error line and the
 * draft. Colours, radii and type come from the vocabulary — nothing here decides a tone of its own.
 */
const FLOW_CSS = `
.flow-head { display: flex; flex-direction: column; gap: 2px; margin-top: 14px; }
.flow-head__title { color: var(--ink-1); font-size: 13px; line-height: 18px; font-weight: 600; }
.flow-head__hint { color: var(--ink-2); font-size: 12px; line-height: 16px; }
.flow-note { margin: 4px 0 8px; color: var(--ink-2); font-size: 12px; line-height: 18px; }
.flow-note:empty { display: none; }
.flow-tools { display: flex; flex-wrap: wrap; align-items: center; gap: 8px; margin: 8px 0; }
.flow-path { color: var(--ink-3); font-family: var(--font-mono); font-size: 12px; }
.flow-version { display: block; margin-top: 4px; color: var(--ink-3); font-family: var(--font-mono); font-size: 12px; line-height: 16px; overflow-wrap: anywhere; }
.flow-version:empty { display: none; }
.flow-version.is-bad { color: var(--err-ink); font-family: inherit; }
.flow-pin { display: flex; align-items: center; gap: 10px; padding: 8px 12px; border: 1px solid var(--hairline);
  border-radius: var(--r-2); background: var(--surface-card); }
.flow-pin__icon { display: grid; place-items: center; width: 26px; height: 26px; border-radius: var(--r-2);
  background: var(--az-blue-selected); color: var(--az-blue); }
.flow-pin__icon .icon { width: 15px; height: 15px; }
.flow-pin__main { display: flex; flex-direction: column; min-width: 0; }
.flow-pin__name { color: var(--ink-1); font-size: 13px; line-height: 18px; }
.flow-pin__sub { color: var(--ink-3); font-size: 12px; line-height: 16px; }
.flow-list { max-height: 300px; overflow: auto; border: 1px solid var(--hairline); border-radius: var(--r-2);
  background: var(--surface-card); }
/* Above the form rather than beside the Create button: the message answers a question about a field near the top of the
   page, and a line under the fold is a line nobody reads. */
.flow-error { margin: 0 0 12px; padding: 8px 12px; border: 1px solid var(--err-ink); border-radius: var(--r-2);
  color: var(--err-ink); font-size: 12px; }
.flow-draft { margin: 10px 0 0; max-height: 300px; overflow: auto; white-space: pre-wrap; overflow-wrap: anywhere;
  padding: 12px 14px; border: 1px solid var(--hairline); border-radius: var(--r-2);
  background: var(--surface-subtle); color: var(--ink-1);
  font-family: var(--font-mono); font-size: 12.5px; line-height: 1.6; }

/* The receipt of a repository picked elsewhere — rows this page's script writes. */
.chosen { display: flex; flex-direction: column; gap: 4px; margin: 4px 0 8px; }
.chosen__row { display: grid; grid-template-columns: 16px minmax(0, 1fr) auto auto; align-items: center;
  gap: 0 12px; padding: 8px 12px; border: 1px solid var(--hairline); border-radius: var(--r-2);
  background: var(--surface-card); }
.chosen__mark { display: grid; place-items: center; color: var(--az-blue); }
.chosen__mark .icon { width: 14px; height: 14px; }
.chosen__name { color: var(--ink-1); font-size: 13px; overflow-wrap: anywhere; }
.chosen__facts { color: var(--ink-3); font-size: 12px; white-space: nowrap; font-variant-numeric: tabular-nums; }
.chosen__remove { border: 0; background: none; padding: 2px 6px; font: inherit; font-size: 12px;
  color: var(--az-blue); cursor: pointer; border-radius: var(--r-2); }
.chosen__remove:hover { background: var(--az-blue-selected); }
.chosen__remove:focus-visible { outline: 2px solid var(--az-blue); outline-offset: 1px; }

/* The file rows the script writes into the list: the same row vocabulary as a chosen repository. */
.checklist-heading { padding: 8px 12px 4px; color: var(--ink-3); font-size: 12px; }
.checklist__row { display: flex; align-items: center; gap: 8px; padding: 6px 12px; cursor: pointer; }
.checklist__row:hover { background: var(--az-blue-selected); }
.checklist__text { display: flex; flex-direction: column; min-width: 0; }
.checklist__title { color: var(--ink-1); font-size: 12px; overflow-wrap: anywhere; }
.checklist__sub { color: var(--ink-3); font-size: 11px; }
.cell-muted { color: var(--ink-3); }
`;

/**
 * The flow's behaviour: one screen, three cards that choose where the pages come from, and a form that follows them.
 *
 * The origin the host receives is derived here — `empty` plus a starter is a `template`, a folder that already has a
 * registry is a `folder`, anything else under *existing files* is an `import` — so `create()` keeps its one code path.
 */
const WIZARD_SCRIPT = `
(function () {
	const api = acquireVsCodeApi();
	const error = document.getElementById('wizard-error');
	const summary = document.getElementById('wizard-summary');
	const titleEl = document.getElementById('form-title');
	const hintEl = document.getElementById('form-hint');
	const rails = Array.prototype.slice.call(document.querySelectorAll('.az-choice'));
	const split = document.querySelector('.az-flow');
	let type = split ? split.getAttribute('data-initial-type') || 'empty' : 'empty';
	// The page the AI wrote for this project, kept here until *Create Project* records it.
	let draftText = '';
	// A draft written by an older build can name a type this build no longer has; the rail is the truth.
	const railKnown = rails.some(function (rail) { return rail.getAttribute('data-type') === type; });
	if (!railKnown) { type = 'empty'; }
	// The repositories this project cites, and the facts behind each name — both handed in from elsewhere.
	let chosen = [];
	let sourcesKnown = [];
	// The last answer about the typed version: the host owns the rules, so *Create* reads its verdict, not a copy of it.
	let versionVerdict = { ok: true, why: '' };

	const HINTS = {
		empty: 'Nothing is read and nothing is converted: the project exists, and the first page is yours to write.',
		repository: 'A repository project cites pages that already exist. Reading a repository records the pages it declares; it never changes the repository.',
		files: 'The material is converted once; from then on it is written as pages like any other project.'
	};

	function visible(name) {
		const all = Array.prototype.slice.call(document.querySelectorAll('[data-field="' + name + '"]'));
		for (let i = 0; i < all.length; i++) {
			if (all[i].offsetParent !== null) { return all[i]; }
		}
		return null;
	}
	function value(name) {
		const el = visible(name);
		return el ? el.value : '';
	}
	function checked(name) {
		// Not filtered by visibility: a tick inside the closed *files and folders* disclosure is still a tick.
		return Array.prototype.slice.call(document.querySelectorAll('[data-field="' + name + '"]:checked'))
			.map(function (input) { return input.value; });
	}
	function material() {
		const section = document.querySelector('[data-form="files"]');
		return section ? section.getAttribute('data-kind') || 'existing' : 'existing';
	}
	function picked() {
		const section = document.querySelector('[data-form="files"]');
		return section ? section.getAttribute('data-path') || '' : '';
	}
	function origin() {
		if (type === 'empty') { return value('template') ? 'template' : 'blank'; }
		if (type === 'repository') { return 'repository'; }
		return material() === 'existing' ? 'folder' : 'import';
	}
	function values() {
		const v = {
			name: value('name'),
			version: value('version'),
			origin: origin(),
			folder: '',
			template: '',
			importKind: '',
			importSource: '',
			sources: [],
			targets: checked('targets')
		};
		if (v.origin === 'template') { v.template = value('template'); v.folder = value('folder'); }
		if (v.origin === 'folder') { v.folder = picked(); v.importSource = picked(); }
		if (v.origin === 'import') { v.importKind = material(); v.importSource = picked(); }
		if (v.origin === 'repository') {
			v.sources = chosen.slice();
			v.files = tickedFiles();
			v.draft = draftText;
		}
		return v;
	}

	/**
	 * What the project will cite, stated rather than offered.
	 *
	 * The choosing happened on the repositories page — the list, the download and the files are there — so this is a
	 * receipt: one row per repository picked, each removable, and a sentence that says how many.
	 */
	function renderChosen() {
		const list = document.getElementById('chosen-list');
		if (!list) { return; }
		list.replaceChildren();
		chosen.forEach(function (name, index) {
			const row = document.createElement('div');
			row.className = 'chosen__row';
			const mark = document.createElement('span');
			mark.className = 'chosen__mark';
			mark.innerHTML = '<svg viewBox="0 0 24 24" class="icon" aria-hidden="true"><use href="#i-repo"></use></svg>';
			const title = document.createElement('span');
			title.className = 'chosen__name';
			title.textContent = name;
			const found = sourcesKnown.filter(function (entry) { return entry.name === name; })[0];
			const facts = document.createElement('span');
			facts.className = 'chosen__facts';
			facts.textContent = found ? found.line : 'repository';
			const drop = document.createElement('button');
			drop.type = 'button';
			drop.className = 'chosen__remove';
			drop.textContent = 'remove';
			drop.setAttribute('aria-label', 'Stop citing ' + name);
			drop.addEventListener('click', function () { chosen.splice(index, 1); renderChosen(); });
			row.append(mark, title, facts, drop);
			list.append(row);
		});
		const line = document.getElementById('source-summary');
		if (line) {
			line.textContent = chosen.length === 0
				? 'No repository chosen yet — open the repositories page and pick one.'
				: 'This project will cite ' + chosen.length + (chosen.length === 1 ? ' repository.' : ' repositories.');
		}
		refresh();
	}
	function refresh() {
		if (!summary) { return; }
		const v = values();
		const parts = [type === 'repository' ? 'From a repository' : type === 'files' ? 'From existing files' : 'Empty project'];
		if (v.origin === 'template') { parts.push('user-guide starter'); }
		if (v.origin === 'repository') { parts.push(v.sources.length + (v.sources.length === 1 ? ' repository' : ' repositories')); }
		if (v.origin === 'folder') { parts.push('a folder with a registry'); }
		if (v.origin === 'import') { parts.push((v.importKind || 'material') + ' import'); }
		if (v.origin === 'repository' && v.files.length > 0) {
			parts.push(v.files.length + (v.files.length === 1 ? ' file' : ' files') + ' picked');
		}
		parts.push(draftText.length > 0 ? 'draft ready' : 'no draft yet');
		parts.push(v.targets.length + (v.targets.length === 1 ? ' output' : ' outputs'));
		summary.textContent = parts.join(' · ');
	}
	function fail(message) {
		error.textContent = message;
		error.hidden = false;
	}
	function show() {
		Array.prototype.forEach.call(document.querySelectorAll('[data-form]'), function (block) {
			block.hidden = block.getAttribute('data-form') !== type;
		});
		rails.forEach(function (rail) {
			const on = rail.getAttribute('data-type') === type;
			rail.classList.toggle('is-on', on);
			rail.setAttribute('aria-selected', String(on));
		});
		const starter = document.querySelector('[data-starter-folder]');
		if (starter) { starter.hidden = !value('template'); }
		const rail = document.querySelector('.az-choice[data-type="' + type + '"]');
		titleEl.textContent = rail ? rail.getAttribute('data-title') : 'The project';
		hintEl.textContent = HINTS[type] || '';
		refresh();
	}

	rails.forEach(function (rail) {
		rail.addEventListener('click', function () {
			type = rail.getAttribute('data-type');
			error.hidden = true;
			show();
		});
	});
	document.getElementById('wizard-cancel').addEventListener('click', function () { api.postMessage({ type: 'cancel' }); });

	const template = document.querySelector('[data-field="template"]');

	// The version's own name and address, answered by the host as it is typed: one set of rules, not two.
	const versionField = document.querySelector('[data-field="version"]');
	const nameField = document.querySelector('[data-field="name"]');
	function askVersion() {
		api.postMessage({
			type: 'version',
			value: versionField ? versionField.value : '',
			name: nameField ? nameField.value : ''
		});
	}
	if (versionField) {
		versionField.addEventListener('input', askVersion);
		askVersion();
	}
	if (nameField) { nameField.addEventListener('input', askVersion); }
	if (template) { template.addEventListener('change', show); }

	// The picker opens in the host — a webview cannot show a file dialog — and answers with what it read.
	const pick = document.getElementById('pick-material');
	if (pick) { pick.addEventListener('click', function () { api.postMessage({ type: 'pick' }); }); }
	window.addEventListener('message', function (event) {
		const message = event.data;
		if (!message) { return; }
		if (message.type === 'version') {
			const note = document.getElementById('version-note');
			versionVerdict = { ok: message.ok === true, why: message.note || '' };
			if (note) {
				note.textContent = message.note || '';
				note.classList.toggle('is-bad', message.ok !== true);
			}
			return;
		}
		if (message.type === 'files') {
			const list = document.getElementById('file-list');
			if (message.error) {
				if (list) { list.textContent = message.error; }
				return;
			}
			renderFiles(message.files || []);
			if (message.note && list) { list.setAttribute('title', message.note); }
			return;
		}
		if (message.type === 'drafted') {
			const note = document.getElementById('draft-note');
			const preview = document.getElementById('draft-preview');
			const clear = document.getElementById('draft-clear');
			if (draftRun) { draftRun.disabled = false; }
			if (message.error) {
				if (note) { note.textContent = message.error; }
				return;
			}
			draftText = message.text || '';
			if (preview) { preview.hidden = draftText.length === 0; preview.textContent = draftText; }
			if (clear) { clear.hidden = draftText.length === 0; }
			if (note) {
				const skipped = (message.skipped || []).length;
				note.textContent = 'Drafted ' + draftText.length + ' characters from ' + (message.included || 0)
					+ (message.included === 1 ? ' file' : ' files')
					+ (skipped > 0 ? ' — ' + skipped + ' left out of the 12 000-character budget' : '');
			}
			refresh();
			return;
		}
		if (message.type === 'known') {
			// The catalog gained sources while this form was open: the facts behind each name are freshened.
			sourcesKnown = message.known || [];
			renderChosen();
			return;
		}
		if (message.type === 'rail') {
			type = message.rail || type;
			show();
			return;
		}
		if (message.type === 'chosen') {
			chosen = (message.sources || []).slice();
			renderChosen();
			return;
		}
		const section = document.querySelector('[data-form="files"]');
		if (message.type !== 'picked' || !section) { return; }
		section.setAttribute('data-path', message.path || '');
		section.setAttribute('data-kind', message.kind || '');
		const shown = document.getElementById('material-path');
		if (shown) { shown.textContent = message.path || 'Nothing chosen yet'; }
		const note = document.getElementById('material-note');
		if (note) { note.textContent = message.note || ''; }
		error.hidden = true;
		refresh();
	});

	document.getElementById('wizard-create').addEventListener('click', function () {
		const v = values();
		if (!v.name.trim()) { fail('A project needs a name.'); return; }
		if (!versionVerdict.ok) { fail(versionVerdict.why || 'The version is not usable as a folder name.'); return; }
		if (v.origin === 'template' && !v.folder.trim()) { fail('Name the folder to write the starter under.'); return; }
		if ((v.origin === 'folder' || v.origin === 'import') && !v.importSource.trim()) { fail('Choose the folder or file to bring in.'); return; }
		if (v.origin === 'repository' && v.sources.length === 0) { fail('Choose at least one repository to cite.'); return; }
		if (v.targets.length === 0) { fail('Choose at least one output to build.'); return; }
		// The ticked files are what a *draft* was made from; the project records the draft itself, not the list.
		const sent = Object.assign({}, v);
		delete sent.files;
		api.postMessage({ type: 'create', values: sent });
	});

	const clear = document.getElementById('source-clear');
	if (clear) {
		clear.addEventListener('click', function () {
			chosen = [];
			renderChosen();
		});
	}
	const manage = document.getElementById('manage-repositories');
	if (manage) {
		// The page itself, not the side-bar panel: the panel lists the sources already added, while adding, cloning
		// and reading happen on the page. A page of ours is a tab in the strip beside this one, so this form is
		// still whole when the person comes back to it.
		manage.addEventListener('click', function () {
			api.postMessage({ type: 'command', command: 'temcoRepositories.page' });
		});
	}

	/* What is inside the pinned repository: listed by the host, ticked here, and the material for one draft. */

	function escape(value) {
		return String(value).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
	}
	function fileInputs() {
		return Array.prototype.slice.call(document.querySelectorAll('[data-file]'));
	}
	function tickedFiles() {
		return fileInputs().filter(function (input) { return input.checked; })
			.map(function (input) { return input.value; });
	}
	function kilo(bytes) {
		return bytes >= 1024 ? (bytes / 1024).toFixed(1) + ' KB' : bytes + ' B';
	}
	/** The count of what is ticked, and what it costs to read — the same budget the host applies. */
	function filesSummary() {
		const list = document.getElementById('file-summary');
		if (!list) { return; }
		const ticked = fileInputs().filter(function (input) { return input.checked; });
		if (ticked.length === 0) { list.textContent = 'No file selected yet.'; return; }
		const bytes = ticked.reduce(function (total, input) { return total + Number(input.getAttribute('data-size') || 0); }, 0);
		list.textContent = ticked.length + (ticked.length === 1 ? ' file' : ' files') + ' · ' + kilo(bytes)
			+ ' · the draft reads up to 12 000 characters';
	}
	function renderFiles(files) {
		const list = document.getElementById('file-list');
		if (!list) { return; }
		const group = function (title, rows) {
			if (rows.length === 0) { return ''; }
			return '<div class="checklist-heading">' + title + '</div>' + rows.map(function (file) {
				return '<label class="checklist__row" data-file-row><input type="checkbox" data-file value="'
					+ escape(file.path) + '" data-size="' + file.size + '"' + (file.ticked ? ' checked' : '') + '>'
					+ '<span class="checklist__text"><span class="checklist__title">' + escape(file.path)
					+ '</span><span class="checklist__sub">' + kilo(file.size) + '</span></span></label>';
			}).join('');
		};
		const docs = files.filter(function (file) { return file.category === 'docs'; });
		const code = files.filter(function (file) { return file.category !== 'docs'; });
		list.innerHTML = group('Documentation in this repository', docs) + group('Classes and source', code)
			|| '<p class="cell-muted" style="font-size:12px;margin:8px 0">This repository has no file a draft could read.</p>';
		filesSummary();
	}

	const fileAll = document.getElementById('file-all');
	if (fileAll) {
		fileAll.addEventListener('click', function () {
			fileInputs().forEach(function (input) { input.checked = true; });
			filesSummary();
		});
	}
	const fileNone = document.getElementById('file-none');
	if (fileNone) {
		fileNone.addEventListener('click', function () {
			fileInputs().forEach(function (input) { input.checked = false; });
			filesSummary();
		});
	}
	document.addEventListener('change', function (event) {
		if (event.target && event.target.hasAttribute && event.target.hasAttribute('data-file')) { filesSummary(); }
	});
	const fileFilter = document.querySelector('[data-filter="files"]');
	if (fileFilter) {
		fileFilter.addEventListener('input', function () {
			const term = fileFilter.value.trim().toLowerCase();
			Array.prototype.slice.call(document.querySelectorAll('[data-file-row]')).forEach(function (row) {
				row.hidden = term.length > 0 && row.textContent.toLowerCase().indexOf(term) < 0;
			});
		});
	}

	const draftRun = document.getElementById('draft-run');
	if (draftRun) {
		draftRun.addEventListener('click', function () {
			const ticked = tickedFiles();
			const note = document.getElementById('draft-note');
			if (ticked.length === 0) {
				if (note) { note.textContent = 'Choose at least one file to draft from.'; }
				return;
			}
			if (note) { note.textContent = 'Drafting from ' + ticked.length + (ticked.length === 1 ? ' file…' : ' files…'); }
			draftRun.disabled = true;
			api.postMessage({ type: 'draft', files: ticked });
		});
	}
	const draftClear = document.getElementById('draft-clear');
	if (draftClear) {
		draftClear.addEventListener('click', function () {
			draftText = '';
			const preview = document.getElementById('draft-preview');
			if (preview) { preview.hidden = true; preview.textContent = ''; }
			const note = document.getElementById('draft-note');
			if (note) { note.textContent = ''; }
			draftClear.hidden = true;
		});
	}

	document.addEventListener('change', refresh);
	document.addEventListener('input', refresh);
	show();
	renderChosen();
	// The pinned repository's files are a listing the host owns; the page asks for them once it is drawn.
	if (document.getElementById('file-list')) { api.postMessage({ type: 'files' }); }
	// Ready for anything the host was holding: repositories chosen before this form existed.
	api.postMessage({ type: 'ready' });
})();
`;
