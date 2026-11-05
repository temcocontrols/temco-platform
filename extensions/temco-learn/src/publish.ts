// Publishing the site: one commit, one push.
//
// The site is its own repository (`temcocontrols/temco-learn`), and the branch is the one the two of us work on. What
// gets published is the *source*: content, the catalog it generates, and the code that renders it. GitHub Actions builds
// the site from that commit and hands the result to Pages, so publishing is a commit and a push and the build stays
// where it already is - in CI, with its own log.
//
// Never a forced push. If the branch carries work this clone does not know about, that is a fact to report - the commit
// is local either way, and the next publish is a fast-forward after a pull.

import { git } from './git';

/**
 * Where a publish says what it is doing: the output channel, and - because a page shows it - whatever else is listening.
 * The narrow shape is deliberate: publishing knows about lines, not about the editor.
 */
export interface PublishSink {
	appendLine(line: string): void;
}

/** The branch Pages builds from, and the one the repository is worked on. */
const BRANCH = 'main';

/** Where the folder publishes to, and what to call it. */
export interface PublishingTarget {
	root: string;
	owner: string;
	repo: string;
	/** The site's front page, with a trailing slash. */
	base: string;
}

/**
 * The GitHub repository a folder belongs to, and the address its Pages site is served at.
 *
 * Two shapes exist: `owner.github.io` is served from the domain root, every other repository from a folder named after
 * it. The address is what the reader is told when the push succeeds, so it is derived here and nowhere else.
 */
export async function publishingTarget(root: string): Promise<PublishingTarget | undefined> {
	try {
		const top = (await git(root, ['rev-parse', '--show-toplevel'])).trim();
		const url = (await git(top, ['remote', 'get-url', 'origin'])).trim();
		const match = /github\.com[:/]+([^/]+)\/([^/]+?)(?:\.git)?$/iu.exec(url);
		if (match === null) {
			return undefined;
		}
		const owner = match[1];
		const repo = match[2];
		const base =
			repo.toLowerCase() === (owner + '.github.io').toLowerCase()
				? 'https://' + owner.toLowerCase() + '.github.io/'
				: 'https://' + owner.toLowerCase() + '.github.io/' + repo + '/';
		return { root: top, owner, repo, base };
	} catch {
		// Not a repository, no `origin`, or no `git` on the path: publishing is simply not configured yet.
		return undefined;
	}
}

/** What a publish did, so the caller can say it in one sentence. */
export interface Published {
	base: string;
	commit: string;
	files: number;
	/** True when the working tree had nothing new, so the push carried an earlier commit. */
	unchanged: boolean;
}

/**
 * The site repository, checked before anything is committed.
 *
 * Nothing is initialised here: the repository exists, and a publish that `git init`s a fresh one in a folder which only
 * looks similar would push an empty history at a real site. Saying so is the useful answer.
 */
export async function ensureRepo(root: string): Promise<PublishingTarget> {
	try {
		await git(root, ['rev-parse', '--git-dir']);
	} catch {
		throw new Error(root + ' is not a git clone. Clone temcocontrols/temco-learn there first.');
	}
	const target = await publishingTarget(root);
	if (target === undefined) {
		throw new Error('this clone has no GitHub `origin`, so there is nowhere to publish to');
	}
	return target;
}

/**
 * Commit what changed and push it at the branch Pages builds from.
 *
 * The default message names the date rather than a version: the repository holds several projects, each with its own
 * versions, and a message that claims one of them would be wrong about the others. A caller that knows what it changed
 * passes its own words instead.
 */
export async function publishSite(root: string, output: PublishSink, message?: string): Promise<Published> {
	const target = await ensureRepo(root);

	const changed = (await git(target.root, ['status', '--porcelain'])).trim();
	let commit = '';
	if (changed === '') {
		commit = (await git(target.root, ['rev-parse', '--short', 'HEAD']).catch(() => '')).trim();
	} else {
		output.appendLine('[publish] ' + String(changed.split('\n').length) + ' path(s) to commit');
		await git(target.root, ['add', '--all']);
		await git(target.root, [
			'-c', 'user.name=Temco Learn',
			'-c', 'user.email=learn@temcocontrols.com',
			'commit', '-m', message !== undefined && message.trim().length > 0 ? message.trim() : 'docs: publish the site (' + new Date().toISOString().slice(0, 10) + ')'
		]);
		commit = (await git(target.root, ['rev-parse', '--short', 'HEAD'])).trim();
	}

	output.appendLine('[publish] pushing ' + commit + ' to ' + target.owner + '/' + target.repo + '@' + BRANCH);
	await git(target.root, ['push', 'origin', 'HEAD:' + BRANCH]);

	return { base: target.base, commit, files: changed === '' ? 0 : changed.split('\n').length, unchanged: changed === '' };
}