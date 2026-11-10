// What a version may be called.
//
// A version is not a label on a project: it is a folder name in the published site (`/my-project/1.0/`), part of every
// artifact's file name, and the column a reader picks from. So it is written the way software versions are written —
// `1.0`, `17.4` — while a dated edition may still be written `2026.01`. The two shapes are kept apart deliberately:
// the site compares versions segment by segment as numbers, where `2026.01` and `2026.1` are the *same* version, so a
// month is always two digits and a leading `v` is never part of the name (it would become a folder called `v1.0`).
//
// The rules live here rather than in the form so the form, the published site and the catalog all read one answer.

/** A version as it will be written, or the reason it cannot be. */
export type VersionOutcome =
	| { ok: true; value: string; changed: boolean }
	| { ok: false; why: string };

/** Major, then minor, then an optional patch: `1.0`, `17.4`, `2026.01`, `1.0.4`. */
const SHAPE = /^(\d{1,4})\.(\d{1,2})(?:\.(\d{1,2}))?$/;

/** Long enough for `1.0.4`, short enough to stay a sensible folder name. */
const LONGEST = 20;

/** A year-and-month edition, which the site sorts as a date. */
const YEARS = 1900;

/** Reads a typed version and answers what it will be called, or why it cannot be used. */
export function versionName(text: string): VersionOutcome {
	const typed = text.trim();
	if (typed.length === 0) {
		return { ok: false, why: 'A version is needed: 1.0, 17.4, or 2026.01.' };
	}
	// `v1.0` is how people say a version, never how it is named: the folder would be `v1.0`.
	const bare = typed.replace(/^[vV]\s*(?=\d)/, '');
	if (bare.length > LONGEST) {
		return { ok: false, why: `A version is at most ${LONGEST} characters.` };
	}
	const parts = SHAPE.exec(bare);
	if (parts === null) {
		const dots = bare.split('.').length - 1;
		if (dots > 2) {
			return { ok: false, why: 'A version has at most three parts: 1.0.4, not ' + bare + '.' };
		}
		if (dots === 0 && /^\d+$/.test(bare)) {
			return { ok: false, why: `A version is at least major.minor: ${bare}.0, not ${bare}.` };
		}
		return {
			ok: false,
			why: 'A version becomes a folder name, so digits and dots only: 1.0, 17.4, or 2026.01.'
		};
	}
	const [, major, minor, patch] = parts;
	if (Number(major) >= YEARS) {
		// A four-digit first part is a year, and then the second part is its month — written as two digits so that
		// `2026.10` (October) and `2026.1` (January, written carelessly) can never be confused for one another.
		const month = Number(minor);
		if (month < 1 || month > 12) {
			return { ok: false, why: `A dated version is ${major}.01 to ${major}.12, not ${major}.${minor}.` };
		}
		const value = `${Number(major)}.${minor.padStart(2, '0')}${patch === undefined ? '' : '.' + patch}`;
		return { ok: true, value, changed: value !== typed };
	}
	// A software version keeps its own shape; only a padded major is tidied, so `01.0` and `1.0` cannot both exist.
	const value = `${Number(major)}.${minor}${patch === undefined ? '' : '.' + patch}`;
	return { ok: true, value, changed: value !== typed };
}

/** The address the version gives a page of a project: `/my-project/1.0/`. */
export function versionAddress(slug: string, version: string): string {
	return `/${slug}/${version}/`;
}
