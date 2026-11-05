// What the clone on this machine is, right now.
//
// The Site page answers one question — "what do I have, and what can I do with it?" — and every part of the answer is
// already on disk: git knows the branch, the commit, how far ahead or behind it is, and what has changed; the folder knows
// whether the dependencies and the built site are there. Nothing is remembered here, so two windows cannot disagree.

import * as fs from 'fs';
import * as path from 'path';
import { git } from './git';
import { repoReady, siteRepo } from './siteRepo';
import { publishingTarget } from './publish';

/** One path git reports as changed, in porcelain's own two-letter code. */
export interface Change {
	code: string;
	path: string;
}

/** Everything the Site page draws. */
export interface RepoFacts {
	/** The folder the clone is expected in. */
	folder: string;
	/** Whether `package.json` and `content/sections.json` are there: the folder is the site, not merely a clone. */
	ready: boolean;
	/** Whether the folder is a git clone at all. */
	cloned: boolean;
	/** `owner/repo`, when the clone points at GitHub. */
	where?: string;
	/** The remote's URL as git prints it. */
	remote?: string;
	/** The site's published address, when it has one. */
	base?: string;
	branch?: string;
	commit?: string;
	/** When that commit was made, ISO 8601. */
	at?: string;
	/** Commits on `origin/main` this clone does not have, and commits here that origin does not have. */
	behind: number;
	ahead: number;
	/** Every path that differs from the last commit. */
	changes: Change[];
	/** `node_modules` is there, and when it was last written. */
	installed: boolean;
	installedAt?: string;
	/** `dist/index.html` is there, and when the built site was last written. */
	built: boolean;
	builtAt?: string;
}

/** How long a fetch is trusted, so a page that is opened twice does not ask GitHub twice. */
const FETCH_EVERY_MS = 3 * 60 * 1000;

/** When each folder was last fetched, by resolved path. */
const fetchedAt = new Map<string, number>();

/**
 * Move `origin/main` to where the remote really is.
 *
 * Everything the module says about being behind or ahead is a comparison against `origin/main` — a **local** ref, which
 * only moves when something fetches. Without this the panel cheerfully says "0 commits behind" about a clone that is
 * weeks old, because nobody had asked the remote since. The answer is cached for a few minutes: the question is "is there
 * anything new", and asking it on every redraw would spend a network call per repaint.
 *
 * A failure is swallowed on purpose. No network is not an error to report here — the facts are still worth reading, they
 * are simply as current as the last fetch.
 */
export async function fetchOrigin(folder = siteRepo()): Promise<boolean> {
	const key = path.resolve(folder).toLowerCase();
	const at = fetchedAt.get(key) ?? 0;
	if (Date.now() - at < FETCH_EVERY_MS) {
		return false;
	}
	fetchedAt.set(key, Date.now());
	try {
		await git(folder, ['fetch', '--quiet', 'origin']);
		return true;
	} catch {
		return false;
	}
}

/** Forget the fetch cache: a pull has just moved the ref, so the next read should not wait for the window to lapse. */
export function forgetFetch(folder = siteRepo()): void {
	fetchedAt.delete(path.resolve(folder).toLowerCase());
}

/** The newest modification under a folder, as an ISO date: "installed two hours ago" without a lockfile to read. */async function youngest(folder: string, depth = 2): Promise<string | undefined> {
	let newest = 0;
	const walk = async (at: string, left: number): Promise<void> => {
		let entries: fs.Dirent[];
		try {
			entries = await fs.promises.readdir(at, { withFileTypes: true });
		} catch {
			return;
		}
		for (const entry of entries) {
			const next = path.join(at, entry.name);
			try {
				const stats = await fs.promises.stat(next);
				newest = Math.max(newest, stats.mtimeMs);
			} catch {
				continue;
			}
			if (entry.isDirectory() && left > 0) {
				await walk(next, left - 1);
			}
		}
	};
	await walk(folder, depth);
	return newest === 0 ? undefined : new Date(newest).toISOString();
}

/** Read the clone, one question at a time, and answer even when there is nothing there. */
export async function readRepoFacts(folder = siteRepo(), options: { fetch?: boolean } = {}): Promise<RepoFacts> {
	const facts: RepoFacts = { folder, ready: false, cloned: false, behind: 0, ahead: 0, changes: [], installed: false, built: false };
	facts.ready = repoReady(folder);
	facts.installed = fs.existsSync(path.join(folder, 'node_modules'));
	facts.built = fs.existsSync(path.join(folder, 'dist', 'index.html'));
	if (facts.installed) {
		facts.installedAt = await youngest(path.join(folder, 'node_modules'), 1);
	}
	if (facts.built) {
		facts.builtAt = (await fs.promises.stat(path.join(folder, 'dist', 'index.html')).catch(() => undefined))?.mtime.toISOString();
	}

	try {
		await git(folder, ['rev-parse', '--git-dir']);
		facts.cloned = true;
	} catch {
		return facts;
	}

	// Only a clone can be fetched, and only a fetch makes `behind` mean anything: the comparison below reads the local
	// `origin/main` ref, which moves when something fetches and at no other time.
	if (options.fetch === true) {
		await fetchOrigin(folder);
	}

	const target = await publishingTarget(folder);
	facts.where = target === undefined ? undefined : `${target.owner}/${target.repo}`;
	facts.base = target?.base;
	facts.remote = (await git(folder, ['remote', 'get-url', 'origin']).catch(() => '')).trim() || undefined;
	facts.branch = (await git(folder, ['rev-parse', '--abbrev-ref', 'HEAD']).catch(() => '')).trim() || undefined;
	facts.commit = (await git(folder, ['rev-parse', '--short', 'HEAD']).catch(() => '')).trim() || undefined;
	const at = (await git(folder, ['log', '-1', '--format=%cI']).catch(() => '')).trim();
	facts.at = at === '' ? undefined : at;

	// Ahead and behind need a remote branch to compare with, and a fresh clone may not have one yet.
	const counts = (await git(folder, ['rev-list', '--left-right', '--count', 'origin/main...HEAD']).catch(() => '')).trim();
	if (counts !== '') {
		const [behind, ahead] = counts.split(/\s+/u).map((value) => Number(value));
		facts.behind = Number.isFinite(behind) ? behind : 0;
		facts.ahead = Number.isFinite(ahead) ? ahead : 0;
	}

	const status = await git(folder, ['status', '--porcelain']).catch(() => '');
	facts.changes = status
		.split(/\r?\n/u)
		.map((line) => line.trimEnd())
		.filter((line) => line !== '')
		.map((line) => ({ code: line.slice(0, 2).trim() || 'M', path: line.slice(3) }));

	return facts;
}
