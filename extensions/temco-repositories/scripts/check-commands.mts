// No command id is registered twice, and no page names one that nothing registers.
//
// A duplicate throws where the *later* one is registered — which is somewhere in the middle of `activate()`, so
// everything below it silently never happens. This cost a whole afternoon once: `temcoDocs.runOwed` was
// registered in both `builds.ts` and `extension.ts`, activation died at that line, and the visible symptom was a
// Workspace view that stayed empty, because the `refresh()` at the end of activation never ran. Nothing about
// that symptom points at the mistake, so the mistake has to be caught here instead.
//
// The second half is the same kind of silence from the other end: a button whose `data-command` names a command this
// module no longer registers draws perfectly and does nothing when it is pressed. It happened — the dashboard page was
// deleted while a button on the repositories page still posted `temcoRepositories.dashboard` — so the ids a page names
// are read here and checked against what is registered.
//
// Run by the platform build (`npm run compile` → `check-temco-commands`) and by `npm run compile` in this module.
// No dependencies: it reads the sources as text.

import { readdirSync, readFileSync } from 'node:fs';
import { join, relative } from 'node:path';

const root = new URL('..', import.meta.url).pathname.replace(/^\/(?=[A-Za-z]:)/, '');

/** Every `.ts` file under a directory, depth first. */
function sourcesIn(directory: string): string[] {
	const found: string[] = [];
	for (const entry of readdirSync(directory, { withFileTypes: true })) {
		const path = join(directory, entry.name);
		if (entry.isDirectory()) {
			found.push(...sourcesIn(path));
		} else if (entry.name.endsWith('.ts')) {
			found.push(path);
		}
	}
	return found;
}

/** Where each command id is registered, by file and line. */
const registrations = new Map<string, string[]>();
for (const file of sourcesIn(join(root, 'src'))) {
	const lines = readFileSync(file, 'utf8').split('\n');
	lines.forEach((line, index) => {
		for (const match of line.matchAll(/registerCommand\(\s*'([^']+)'/g)) {
			const where = `${relative(root, file).replace(/\\/g, '/')}:${index + 1}`;
			registrations.set(match[1], [...(registrations.get(match[1]) ?? []), where]);
		}
	});
}

const duplicated = [...registrations]
	.filter(([, places]) => places.length > 1)
	.map(([id, places]) => `  ${id}\n    registered at ${places.join('\n    registered at ')}`);

if (duplicated.length > 0) {
	console.error(
		`A command id can only be registered once, or activation throws where the second one is registered:\n` +
		`${duplicated.join('\n')}`
	);
	process.exit(1);
}

/**
 * The ids a page or a tree row names, which must be commands that exist.
 *
 * Only the two shapes a control uses are read — `data-command="…"` in markup, and `command: '…'` on an item — because
 * a bare `temcoRepositories.x` string is just as often a view or webview id, which is declared in the manifest and not
 * registered here. A command of another module cannot be checked from this module and is left to that module.
 */
const named = new Set<string>();
for (const file of sourcesIn(join(root, 'src'))) {
	const text = readFileSync(file, 'utf8');
	for (const match of text.matchAll(/data-command="(temcoRepositories\.[\w.]+)"/g)) {
		named.add(match[1]);
	}
	for (const match of text.matchAll(/command:\s*'(temcoRepositories\.[\w.]+)'/g)) {
		named.add(match[1]);
	}
}

const missing = [...named].filter((id) => !registrations.has(id)).sort();
if (missing.length > 0) {
	console.error(
		`A control names a command nothing registers, so pressing it does nothing:\n  ${missing.join('\n  ')}`
	);
	process.exit(1);
}

console.log(`${registrations.size} commands, each registered once; the ${named.size} a control names all exist.`);
