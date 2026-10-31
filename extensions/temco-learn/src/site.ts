// What the site holds, and how a build gets into it.
//
// The site is its own repository (see `siteRepo.ts`). Its pages come from two places inside that checkout: Markdown a
// person writes under `content/<project>/<version>/`, and a project's own build HTML copied under
// `public/imported/<project>/<version>/`. The repository's `npm run catalog` folds both into `public/catalog.json`, and
// that file is the only thing read here - the same file the website reads, so the panel cannot list a page the site does
// not have.
//
// Adding a build is therefore a copy plus the `site.json` the catalog needs, and nothing else: the reading order, the
// titles and the versions are the catalog's business, not a second renderer's.

import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import * as vscode from 'vscode';

/** The file the repository's catalog script writes, and the only file read here. */
const CATALOG_FILE = path.join('public', 'catalog.json');

/** The section a project is listed under until somebody says otherwise. */
const DEFAULT_SECTION = 'documentation';

/**
 * The six sections, in the order the site draws its tabs.
 *
 * The site carries the same list in `content/sections.json`; this copy is what the panel names a project's section with
 * when the catalog has not been built yet.
 */
export const SECTIONS: readonly { id: string; title: string }[] = [
	{ id: 'documentation', title: 'Documentation' },
	{ id: 'training', title: 'Training & Labs' },
	{ id: 'tests', title: 'Tests' },
	{ id: 'products', title: 'Products' },
	{ id: 'qa', title: 'Q&A' },
	{ id: 'topics', title: 'Topics' }
];

/** The title a reader sees for a section id, or Documentation when the id is missing or unknown. */
export function sectionTitle(id: string | undefined): string {
	return SECTIONS.find((section) => section.id === id)?.title ?? SECTIONS[0].title;
}

/** One page of one version. `href` is the page's own address inside the version: `index`, `ports`, `index.html`. */
export interface SitePage {
	href: string;
	title: string;
	/** `md` for a page this repository writes, `build` for one a project's build produced. */
	kind?: 'md' | 'build';
}

/** One version of one project, as the catalog lists it. */
export interface SiteVersion {
	version: string;
	/** When its newest page was written or imported, ISO. */
	builtAt?: string;
	pages: SitePage[];
}

/** One project: a folder of the site, and every version of it. */
export interface SiteProject {
	/** The folder name - `t3000` - which is also its address. */
	id: string;
	title: string;
	summary?: string;
	section: string;
	/** Newest first, which is what the catalog writes and what `versions[0].version` is. */
	versions: SiteVersion[];
	builtAt?: string;
}

/** Everything the site's catalog says. */
export interface Site {
	generatedAt?: string;
	projects: SiteProject[];
}

/** The newest version of a project, or nothing when it holds none. */
export function latestOf(project: SiteProject): string | undefined {
	return project.versions[0]?.version;
}

/** The working area: the setting `temco-repositories` owns, or a visible folder in the user's home. */
export function workRoot(): string {
	const configured = vscode.workspace.getConfiguration('temcoRepositories').get<string>('workspaceFolder');
	const value = typeof configured === 'string' ? configured.trim() : '';
	if (value === '') {
		return path.join(os.homedir(), 'temco');
	}
	if (value === '~') {
		return os.homedir();
	}
	return value.startsWith('~/') || value.startsWith('~\\') ? path.join(os.homedir(), value.slice(2)) : value;
}

/** The catalog of the site at `repo`, or an empty one when the catalog has not been built. */
export async function readSite(repo: string): Promise<Site> {
	let held: unknown;
	try {
		held = JSON.parse(await fs.promises.readFile(path.join(repo, CATALOG_FILE), 'utf8'));
	} catch {
		return { projects: [] };
	}
	const data = held as { generated?: unknown; projects?: unknown };
	const projects: SiteProject[] = [];
	if (Array.isArray(data.projects)) {
		for (const entry of data.projects) {
			const project = toProject(entry);
			if (project !== undefined) {
				projects.push(project);
			}
		}
	}
	return {
		generatedAt: typeof data.generated === 'string' ? data.generated : undefined,
		projects: projects.sort((one, other) => one.title.localeCompare(other.title))
	};
}

function toProject(entry: unknown): SiteProject | undefined {
	const held = entry as { id?: unknown; title?: unknown; summary?: unknown; section?: unknown; versions?: unknown };
	const id = typeof held.id === 'string' && held.id !== '' ? held.id : undefined;
	if (id === undefined) {
		return undefined;
	}
	const versions: SiteVersion[] = [];
	if (Array.isArray(held.versions)) {
		for (const value of held.versions) {
			const version = toVersion(value);
			if (version !== undefined) {
				versions.push(version);
			}
		}
	}
	return {
		id,
		title: typeof held.title === 'string' && held.title !== '' ? held.title : id,
		summary: typeof held.summary === 'string' && held.summary !== '' ? held.summary : undefined,
		section: typeof held.section === 'string' && held.section !== '' ? held.section : DEFAULT_SECTION,
		versions,
		builtAt: versions[0]?.builtAt
	};
}

function toVersion(entry: unknown): SiteVersion | undefined {
	const held = entry as { version?: unknown; builtAt?: unknown; pages?: unknown };
	const version = typeof held.version === 'string' && held.version !== '' ? held.version : undefined;
	if (version === undefined) {
		return undefined;
	}
	const pages: SitePage[] = [];
	if (Array.isArray(held.pages)) {
		for (const value of held.pages) {
			const page = value as { href?: unknown; title?: unknown; kind?: unknown };
			if (typeof page.href === 'string' && page.href !== '') {
				pages.push({
					href: page.href,
					title: typeof page.title === 'string' && page.title !== '' ? page.title : page.href,
					kind: page.kind === 'md' || page.kind === 'build' ? page.kind : undefined
				});
			}
		}
	}
	return { version, builtAt: typeof held.builtAt === 'string' ? held.builtAt : undefined, pages };
}

/** What importing a build produced, so the caller can say it in one sentence. */
export interface Added {
	project: string;
	version: string;
	pages: number;
	/** Where the pages are inside the repository, relative to it. */
	destination: string;
}

/**
 * Copy one build into the site as `public/imported/<project>/<version>/`.
 *
 * The build is copied as it stands - its pages are the generator's. Adding the same version twice replaces it, because
 * rebuilding a version and importing it again is the ordinary way to fix a page, not a mistake to refuse. The catalog
 * has to run afterwards; this only puts the bytes and the `site.json` in place.
 */
export async function importBuild(options: {
	repo: string;
	id: string;
	title: string;
	summary?: string;
	/** Absent keeps whatever the project already had. */
	section?: string;
	version: string;
	/** The folder a build wrote. */
	built: string;
}): Promise<Added> {
	const relative = path.join('public', 'imported', options.id, options.version);
	const destination = path.join(options.repo, relative);
	await fs.promises.mkdir(path.dirname(destination), { recursive: true });
	await fs.promises.rm(destination, { recursive: true, force: true });
	await fs.promises.cp(options.built, destination, { recursive: true });

	await writeProject(options);

	return {
		project: options.id,
		version: options.version,
		pages: (await htmlPages(destination)).length,
		destination: relative
	};
}

/** The project's own `site.json`: the title and section the catalog reads a project's pages under. */
async function writeProject(options: { repo: string; id: string; title: string; summary?: string; section?: string }): Promise<void> {
	const file = path.join(options.repo, 'content', options.id, 'site.json');
	let held: { title?: unknown; section?: unknown; summary?: unknown } = {};
	try {
		held = JSON.parse(await fs.promises.readFile(file, 'utf8')) as typeof held;
	} catch {
		// A project with no site.json yet: the build's own title is what it is called.
	}
	const kept = typeof held.title === 'string' && held.title !== '' ? held.title : options.title;
	const section =
		options.section ?? (typeof held.section === 'string' && held.section !== '' ? held.section : DEFAULT_SECTION);
	const summary = options.summary ?? (typeof held.summary === 'string' && held.summary !== '' ? held.summary : undefined);
	const next = summary === undefined ? { title: kept, section } : { title: kept, section, summary };
	await fs.promises.mkdir(path.dirname(file), { recursive: true });
	await fs.promises.writeFile(file, JSON.stringify(next, undefined, '\t') + '\n', 'utf8');
}

/** Every HTML page in a folder, in the build's own reading order, without the build's index in the list. */
export async function htmlPages(root: string, under = ''): Promise<SitePage[]> {
	const found: SitePage[] = [];
	const folder = path.join(root, under);
	let entries: fs.Dirent[];
	try {
		entries = await fs.promises.readdir(folder, { withFileTypes: true });
	} catch {
		return found;
	}
	for (const entry of entries) {
		const next = under === '' ? entry.name : under + '/' + entry.name;
		if (entry.isDirectory()) {
			found.push(...(await htmlPages(root, next)));
		} else if (entry.isFile() && entry.name.toLowerCase().endsWith('.html')) {
			found.push({ href: next, title: (await titleOf(path.join(root, next))) ?? next });
		}
	}
	const first = (page: SitePage): number => (page.href.toLowerCase() === 'index.html' ? -1 : 0);
	return found.sort((one, other) => first(one) - first(other) || one.href.localeCompare(other.href));
}

/** The name a build gives itself: the `<title>` of its index, without the site's own suffix. */
export async function projectNameOf(build: string): Promise<string | undefined> {
	const title = await titleOf(path.join(build, 'index.html'));
	return title === undefined ? undefined : shortName(title);
}

async function titleOf(file: string): Promise<string | undefined> {
	let html: string;
	try {
		html = await fs.promises.readFile(file, 'utf8');
	} catch {
		return undefined;
	}
	const held = /<title>([\s\S]*?)<\/title>/iu.exec(html)?.[1];
	const title = held === undefined ? undefined : unescapeText(held).trim();
	return title === undefined || title === '' ? undefined : title;
}

function unescapeText(text: string): string {
	return text
		.replace(/&amp;/gu, '&')
		.replace(/&lt;/gu, '<')
		.replace(/&gt;/gu, '>')
		.replace(/&quot;/gu, '"')
		.replace(/&#39;/gu, "'");
}

/** `Test1 documentation` is the project `Test1`: the suffix is the folder's word, not the project's name. */
export function shortName(title: string): string {
	const short = title.replace(/[\s-]*docs?$/iu, '').replace(/[\s-]*documentation$/iu, '').trim();
	return short === '' ? title : short;
}

/** The folder name a build's title suggests: lowercase, no punctuation. */
export function slugOf(title: string): string {
	const slug = title
		.toLowerCase()
		.replace(/[^a-z0-9]+/gu, '-')
		.replace(/^-+|-+$/gu, '');
	return slug === '' ? 'project' : slug;
}