// Where the site lives.
//
// The site is its own repository (`temcocontrols/temco-learn`): React, Fluent UI and Markdown, built by Vite, published
// to GitHub Pages. This module is a client of it, not its owner — so everything here is a fact about that checkout: the
// folder it sits in, whether the folder really is the site, and the one address it answers at when it runs.

import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import * as vscode from 'vscode';

/** `~` written by hand means the home folder. */
export function expandHome(value: string): string {
	if (value === '~') {
		return os.homedir();
	}
	return value.startsWith('~/') || value.startsWith('~\\') ? path.join(os.homedir(), value.slice(2)) : value;
}

/** The folder the site repository is cloned into: the setting names it, and nothing is guessed. */
export function siteRepo(): string {
	const configured = vscode.workspace.getConfiguration('temcoLearn').get<string>('siteRepo');
	if (typeof configured === 'string' && configured.trim().length > 0) {
		return expandHome(configured.trim());
	}
	return path.join(os.homedir(), 'temco', 'temco-learn');
}

/** Whether a folder is the site: its own manifest, and the content the catalog is built from. */
export function repoReady(folder = siteRepo()): boolean {
	try {
		return fs.existsSync(path.join(folder, 'package.json')) && fs.existsSync(path.join(folder, 'content', 'sections.json'));
	} catch {
		return false;
	}
}

/**
 * The port the site answers at.
 *
 * One port, whichever way the site is being run: the built pages and the development server are two ways of serving the
 * same site, and two addresses for it only invited the question of which one was current. Above 1024, so it binds without
 * root on macOS and Linux as well.
 */
export const DEFAULT_PORT = 1025;

/** The port, from the setting. Anything that cannot be a port is the default, so a typo never strands the server. */
export function sitePort(): number {
	const configured = vscode.workspace.getConfiguration('temcoLearn').get<number>('sitePort');
	return typeof configured === 'number' && Number.isInteger(configured) && configured > 1024 && configured < 65536
		? configured
		: DEFAULT_PORT;
}

/** The address the site answers at, once it is running. */
export function siteUrl(port = sitePort()): string {
	return `http://localhost:${String(port)}/`;
}

/**
 * One page of the site, as an address.
 *
 * The site routes on the **path** — `/t3000/2026.01/control/inputs` — and ships a `404.html` that answers a deep address
 * on a host with no SPA rewrite, which is how GitHub Pages serves it. This used to build a fragment (`/#/t3000/1.0`),
 * which is what the site did once: nothing reads a fragment now, so every address the module opened landed on the site's
 * home — the row for "Temco Platform 1.0" in the library looked like a project that was not on the site at all.
 *
 * `base` is whichever address is running, and `href` is a page's own path inside the version (`control/inputs`), so its
 * slashes are kept: one segment would never match a nested page.
 */
export function pageUrl(base: string, project?: string, version?: string, href?: string): string {
	const places = [project, version].filter((part): part is string => typeof part === 'string' && part !== '');
	const segments = places.map((part) => encodeURIComponent(part));
	for (const segment of (href ?? '').split('/').filter((part) => part !== '')) {
		segments.push(encodeURIComponent(segment));
	}
	if (segments.length === 0) {
		return base;
	}
	return `${base.replace(/\/+$/u, '')}/${segments.join('/')}`;
}
