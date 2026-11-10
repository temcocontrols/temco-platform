// What a build's output is, said in a few words.
//
// The Publish & Releases page groups by *target* — a website, a PDF, the offline help — because that is what a person
// publishes, and every fact on those rows is derived from the file paths themselves: how many, how heavy, what they are,
// where they are. None of that needs an editor, so it lives here rather than in the page and is checked without one.

import * as path from 'path';

/** One file a build left. */
export interface ArtifactFact {
	kind: string;
	path: string;
	/** The file's size, as the build recorded it: what turns "517 files" into something a person can weigh. */
	bytes?: number;
	builtAt: string;
}

/** Which target a row is about, in the order a reader meets them: the site, then what is printed, then the help file. */
export function rankOf(kind: string): number {
	// `output` is what an earlier build path called a website: the same target, so it sorts in the same place.
	const name = kind === 'output' ? 'site' : kind;
	const order = ['site', 'pdf', 'chm', 'search'];
	const at = order.indexOf(name);
	return at === -1 ? order.length : at;
}

/** The words for a target, in the order a build produces them. */
export function artifactLabel(kind: string): string {
	return kind === 'chm'
		? 'Offline help (CHM)'
		: kind === 'pdf'
			? 'PDF'
			: kind === 'site' || kind === 'output'
				? 'Website'
				: kind === 'search'
					? 'Search index'
					: kind;
}

/** The glyph a file wears: its target first, its own kind second, because a page in a site is still the site. */
export function markOf(kind: string, file?: string): string {
	if (kind === 'chm') {
		return 'package';
	}
	if (kind === 'pdf') {
		return 'document';
	}
	if (kind === 'search') {
		return 'search';
	}
	const extension = file === undefined ? '' : (/\.[^./\\]+$/u.exec(file)?.[0] ?? '').toLowerCase();
	if (['.png', '.jpg', '.jpeg', '.gif', '.svg', '.webp', '.bmp'].includes(extension)) {
		return 'image';
	}
	if (extension === '.md') {
		return 'markdown';
	}
	return 'globe';
}

/** Bytes, as a person reads them: "15.7 MB", "312 KB". */
export function megabytes(bytes: number): string {
	if (bytes <= 0) {
		return '0 KB';
	}
	const mb = bytes / (1024 * 1024);
	return mb >= 1 ? `${mb.toFixed(1)} MB` : `${String(Math.max(1, Math.round(bytes / 1024)))} KB`;
}

/** The word a file's extension is written with on a row: `.md` is Markdown, `.png` is a picture. */
function typeName(extension: string): string {
	return extension === '.md'
		? 'Markdown'
		: ['.png', '.jpg', '.jpeg', '.gif', '.svg', '.webp', '.bmp'].includes(extension)
			? 'pictures'
			: extension === '.html'
				? 'HTML'
				: extension === '.json'
					? 'JSON'
					: extension === '.pdf'
						? 'PDF'
						: extension === '.chm'
							? 'CHM'
							: extension === '.css'
								? 'CSS'
								: extension === '.js'
									? 'JavaScript'
									: extension === '.zip'
										? 'ZIP'
										: extension === ''
											? 'files'
											: extension.slice(1).toUpperCase();
}

/**
 * What a target's files are, by extension: "129 Markdown · 386 pictures · 2 JSON".
 *
 * Four at most, commonest first: a sentence, not a manifest — the files themselves are one click away.
 */
export function composition(files: readonly ArtifactFact[]): string {
	const counts = new Map<string, number>();
	for (const file of files) {
		const name = typeName((/\.[^./\\]+$/u.exec(file.path)?.[0] ?? '').toLowerCase());
		counts.set(name, (counts.get(name) ?? 0) + 1);
	}
	return [...counts]
		.sort((one, other) => other[1] - one[1] || one[0].localeCompare(other[0]))
		.slice(0, 4)
		.map(([name, count]) => `${String(count)} ${name}`)
		.join(' · ');
}

/** The folder a target's files share: what "Open folder" reveals. Undefined when they share only a drive. */
export function commonFolder(paths: readonly string[]): string | undefined {
	if (paths.length === 0) {
		return undefined;
	}
	const parts = paths.map((one) => one.split(/[\\/]/u));
	const first = parts[0] ?? [];
	const shared: string[] = [];
	for (let at = 0; at < first.length - 1; at++) {
		const segment = first[at] ?? '';
		if (!parts.every((one) => one[at] === segment)) {
			break;
		}
		shared.push(segment);
	}
	// One segment is a drive (`C:`) and two are a root (`C:\docs`): neither is "the folder these files are in".
	return shared.length < 2 ? undefined : shared.join(path.sep);
}

/** The folder a file sits in, as a path a reader can read on a row. */
export function folderOf(file: string): string {
	const at = Math.max(file.lastIndexOf('\\'), file.lastIndexOf('/'));
	return at <= 0 ? file : file.slice(0, at);
}
