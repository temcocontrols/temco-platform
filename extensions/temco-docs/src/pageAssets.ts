// Where a page's own files live.
//
// A webview reads nothing it was not given: `localResourceRoots` is the list of folders whose files a panel may load,
// and a file outside it is refused by the loader — silently, as a broken picture. The obvious entry is the page's own
// folder, and it is wrong: a page in `docs/control/` writes `../media/shot.png`, because that is what the site build
// resolves, so the folder that *actually* holds a page's images is the documentation root above it.
//
// The root is found the way the platform finds it everywhere else: the folder whose `help/registry.json` is the set
// that names the page. A page outside any set — a loose file, a README — gets its folder and a few ancestors, so
// `../media` still resolves without handing a panel the whole disk.
//
// Nothing here reads a page or parses Markdown; this is a list of folders.

import { existsSync } from 'fs';
import * as path from 'path';
import { REGISTRY_RELATIVE_PATH } from './registry';

/** How far above a page that belongs to no set the panel may reach. Enough for `../../media`, not for the drive. */
const MAX_ANCESTORS = 4;

/** The file that marks a documentation root, relative to that root: `help/registry.json`. */
const ROOT_MARKER = REGISTRY_RELATIVE_PATH.slice(1);

/**
 * The folders a page's own files may come from: its own, and each folder above it up to the set that names it.
 *
 * The page's folder is first, because it is the one every relative address is written from.
 */
export function pageRoots(pageFsPath: string): string[] {
	const roots: string[] = [];
	let cursor = path.dirname(pageFsPath);
	for (let step = 0; step <= MAX_ANCESTORS; step += 1) {
		roots.push(cursor);
		if (existsSync(path.join(cursor, ...ROOT_MARKER))) {
			// The set: `docs/`. Everything a page may reference by a relative address lives under it.
			break;
		}
		const parent = path.dirname(cursor);
		if (parent === cursor) {
			// A drive root. Nothing above it, and the walk is over.
			break;
		}
		cursor = parent;
	}
	return roots;
}
