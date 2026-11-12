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

/** One path git reports as changed, in porcelain's own two-letter code, and why it is changed. */
export interface Change {
	code: string;
	path: string;
	/**
	 * Whether the last commit has this path at all.
	 *
	 * `git restore` can only bring back a path the commit knows: given one it has never seen it prints "pathspec did not
	 * match any file(s) known to git" and restores **nothing at all**, so one untracked build folder used to make every
	 * discard — and every tidy-up before a pull — a silent no-op. What an untracked path needs is deletion, which is also
	 * what has to happen before a pull can write the committed copy of a file with that name.
	 */
	untracked: boolean;
	/**
	 * What kind of change this is, which decides what may be done about it.
	 *
	 * - `generated` — a file the site's own scripts write on every build. Committed, so it shows as modified after a build,
	 *   and reproducible, so discarding it costs nothing.
	 * - `noise` — no content difference at all: the working copy has different line endings from the commit. Windows reports
	 *   these on every build, and treating them as work would mean the clone is never clean there.
	 * - `edit` — somebody changed the bytes: source, prose, a manifest, a new file.
	 */
	kind: 'generated' | 'noise' | 'edit';
}

/**
 * The paths the site's build writes.
 *
 * `scripts/catalog.mts`, `search.mts`, `zip.mts`, `pdf.mts` and `chm.mts` all write under `public/`, and `vite build` copies
 * that folder into `dist/`. Both are *committed* — so a fresh clone has a site without a build — which is why a build
 * leaves the clone "dirty" with nothing a person did. The rule is the folder, not a list of files: the day a script writes
 * `public/pdf/` or `public/chm/`, it is already covered.
 */
const GENERATED = [/^public\//u, /^dist\//u];

/**
 * What changed, and what wrote it — from `git status --porcelain` and `git diff --numstat`, and nothing else.
 *
 * The order of the questions is the whole point:
 *
 * 1. **generated, by path** — `public/content/*.json` is written by the build even when git reports no line counts for it,
 *    which is the Windows line-ending case; asking "did the bytes change?" first would file them under somebody's work.
 * 2. **untracked** (`??`) — a file the commit does not have. Always a person's, and never something a pull may delete.
 * 3. **no counts at all, or 0/0** — the same bytes with different line endings. Nothing to keep.
 * 4. everything else — an edit.
 */
export function classifyChanges(status: string, numstat: string): Change[] {
	const counted = new Map<string, { added: number; removed: number }>();
	for (const line of numstat.split(/\r?\n/u)) {
		const [added, removed, ...rest] = line.split('\t');
		const path = rest.join('\t').trim();
		if (path !== '') {
			counted.set(path, { added: Number(added), removed: Number(removed) });
		}
	}
	return status
		.split(/\r?\n/u)
		.map((line) => line.trimEnd())
		.filter((line) => line !== '')
		.map((line) => {
			const code = line.slice(0, 2).trim() || 'M';
			const path = line.slice(3).trim();
			const untracked = code.startsWith('??');
			const counts = counted.get(path);
			const kind: Change['kind'] = GENERATED.some((pattern) => pattern.test(path))
				? 'generated'
				: untracked
					? 'edit'
					: counts === undefined || (counts.added === 0 && counts.removed === 0)
						? 'noise'
						: 'edit';
			return { code, path, untracked, kind };
		});
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

/**
 * What discarding a set of paths means, split by what git can do about each.
 *
 * A path the last commit has goes back to the commit: `git restore`, no question asked, nothing to lose. A path it has
 * never had is discarded by deleting it, because that is the only sense "discard" can make for a file git cannot restore —
 * and because a pull that brings a committed file of that name is refused until the untracked one is out of the way.
 *
 * The split is not cosmetic. `git restore -- a b public/pdf/` validates every pathspec before restoring any of them, so a
 * single untracked folder in the list left the two tracked files untouched as well: the clone stayed dirty, the log said
 * "pathspec did not match any file(s) known to git", and the pull never ran.
 *
 * Callers hand it the changes nobody made — build output and line endings — and never an edit, so nothing a person wrote
 * can be restored or deleted by a pull.
 */
export function discardOf(changes: readonly Change[]): { restore: string[]; remove: string[] } {
	return {
		restore: changes.filter((change) => !change.untracked).map((change) => change.path),
		remove: changes.filter((change) => change.untracked).map((change) => change.path)
	};
}

/** The changes somebody actually made: what a pull refuses to run over, and what a commit is for. */
export function editsOf(changes: readonly Change[]): Change[] {
	return changes.filter((change) => change.kind === 'edit');
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
	const numstat = await git(folder, ['diff', '--numstat']).catch(() => '');
	facts.changes = classifyChanges(status, numstat);

	return facts;
}
