// Where a page of ours opens, decided in one place.
//
// The rule, settled with the user on 2026-10-14 after two wrong answers:
//
//   **our pages are tabs in one group.** The dashboard, a project, the AI page, the repositories page and the
//   documentation pages they open all share a single tab strip, so whichever one you are on fills the whole
//   editor area. Never a split: a page in half the window is not "shown", and two groups means one of them is
//   always too narrow.
//
// The first attempt asked "is the tab in front one of ours?" and fell back to `Beside` when the answer was no —
// which is what produced the split, because a webview tab does not report its view type the way that check
// assumed. The second attempt asked the *same* question and had the same flaw. So this asks nothing about what
// is in front: it looks for the group that already holds a page of ours and opens there. Our pages can only
// ever occupy one group, whatever is clicked, from wherever.
//
// It moved here from the documentation module when the pages stopped living in one module: a rule that every
// module's page depends on cannot be owned by whichever module happened to open the first one.

import * as vscode from 'vscode';

/** Every view type a Temco surface opens in the editor area starts with this. */
const OUR_PREFIX = 'temco';

/**
 * The prefix a tab reports before the view type it was opened with.
 *
 * `TabInputWebview.viewType` is the *internal* id: a panel created as `temcoLearn.overview` is reported as
 * `mainThreadWebview-temcoLearn.overview`. Matching on the view type without stripping this is why "is that tab one
 * of ours?" kept answering no for tabs that plainly were.
 */
const INTERNAL_PREFIX = 'mainThreadWebview-';

/** True when a view type — as a tab reports it, or as it was created — is a page of ours. */
export function isOurViewType(viewType: string): boolean {
	const bare = viewType.startsWith(INTERNAL_PREFIX) ? viewType.slice(INTERNAL_PREFIX.length) : viewType;
	return bare.startsWith(OUR_PREFIX);
}

/**
 * True when a tab is one of our webview pages.
 *
 * Matched on the prefix rather than on an exact view type on purpose: `temcoDocs`, `temcoAi`, `temcoRepositories`
 * and the rest are all ours, and no other extension's webview can carry this prefix.
 */
function isOurTab(tab: vscode.Tab): boolean {
	const input = tab.input;
	return input instanceof vscode.TabInputWebview && isOurViewType(input.viewType);
}

/** The tab group that already holds a page of ours — the one group our pages live in, if any is open. */
function ourGroup(): vscode.TabGroup | undefined {
	return vscode.window.tabGroups.all.find((group) => group.tabs.some(isOurTab));
}

/**
 * The column every page of ours opens in.
 *
 * The group one of our pages is already in, so a new page becomes another tab in the same strip; column one
 * when none is open, so the first page starts the group. `reveal` with this column also *moves* a page that a
 * previous layout left in a second group — the split heals the next time you open it.
 */
export function pageColumn(): vscode.ViewColumn {
	const column = ourGroup()?.viewColumn;
	// Nine is the last value `ViewColumn` names; past that, start a group rather than pass an invalid column.
	return column !== undefined && column <= vscode.ViewColumn.Nine ? column : vscode.ViewColumn.One;
}

/**
 * The column for something that is not a page of ours — a documentation page, a registry, a JSON file.
 *
 * The same group as {@link pageColumn}: a documentation page is a tab *next to* the app page in the strip, not
 * a second column. A split here was offered and rejected on 2026-10-14 — one at a time, never side by side.
 */
export function fileColumn(): vscode.ViewColumn {
	return pageColumn();
}
