// The panel strip, checked as the thing a reader sees.
//
// Two failures matter here and neither is a compile error: a button whose command does not exist (dead on click, no
// message) and a project name that reaches the page as markup. Both are checked against the manifest and the text, so this
// runs without an editor — and the counts are checked because "0 pages" reads as a bug, "no pages yet" reads as an answer.

import assert from 'node:assert/strict';
import { readFileSync, statSync } from 'node:fs';
import Module, { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';

// The module holds the view provider as well as the renderer, so `require`ing it needs the editor's own API. The tests
// below only reach the renderer, which never touches it — an empty stand-in is enough, and it keeps the check honest
// about what it is testing.
const stub = {
	window: { registerWebviewViewProvider: () => ({ dispose() { } }), showQuickPick: async () => undefined },
	commands: { executeCommand: async () => undefined },
	Uri: { file: (fsPath: string) => ({ fsPath }), joinPath: (base: { fsPath: string }, ...parts: string[]) => ({ fsPath: parts.join('/') }) },
	ProgressLocation: { Notification: 15 },
	ViewColumn: { Beside: -2 }
};
const load = (Module as unknown as { _load: (request: string, ...rest: unknown[]) => unknown })._load;
(Module as unknown as { _load: unknown })._load = function (request: string, ...rest: unknown[]) {
	return request === 'vscode' ? stub : (load as (...args: unknown[]) => unknown).call(this, request, ...rest);
};

interface PanelModule {
	panelHtml(state: unknown, nonce: string): string;
	escapeHtml(text: string): string;
	nonce(): string;
}

const built = fileURLToPath(new URL('../out/panelView.js', import.meta.url));
const source = fileURLToPath(new URL('../src/panelView.ts', import.meta.url));
assert.ok(statSync(built).mtimeMs >= statSync(source).mtimeMs, 'out/panelView.js is older than src/panelView.ts');

const { panelHtml, escapeHtml, nonce } = createRequire(import.meta.url)(built) as PanelModule;

const manifest = JSON.parse(readFileSync(fileURLToPath(new URL('../package.json', import.meta.url)), 'utf8')) as {
	contributes?: {
		commands?: { command?: string }[];
		views?: Record<string, { id?: string; when?: string }[]>;
		viewsWelcome?: { view?: string; when?: string; contents?: string }[];
	};
};
const declared = new Set((manifest.contributes?.commands ?? []).map(entry => entry.command));

const withProject = {
	project: { name: 'Temco Handbook', version: '1.4.2', sources: 2, builtAt: new Date(Date.now() - 3 * 3600 * 1000).toISOString() },
	pages: 148,
	issues: 3,
	unshipped: 0,
	owed: 2
};

const cases: { name: string; run: () => void }[] = [];
const test = (name: string, run: () => void) => cases.push({ name, run });

test('every button names a command the manifest declares', () => {
	const html = panelHtml(withProject, 'NONCE1234567890ABCDEFGH');
	const commands = [...html.matchAll(/data-command="([^"]+)"/gu)].map(match => match[1]);
	assert.deepStrictEqual(commands, [
		'temcoDocs.projectPage',
		'temcoDocs.overview',
		'temcoDocs.review',
		'temcoDocs.builds',
		'temcoDocs.releases'
	]);
	for (const command of commands) {
		assert.ok(declared.has(command), `${command} is not declared in contributes.commands`);
	}
});

test('the project name is text, never markup', () => {
	const html = panelHtml({ ...withProject, project: { name: '<script>alert(1)</script>', sources: 0 } }, 'NONCE1234567890ABCDEFGH');
	assert.ok(!html.includes('<script>alert(1)</script>'), 'the name reached the page unescaped');
	assert.ok(html.includes('&lt;script&gt;alert(1)&lt;/script&gt;'));
});

test('every count is a number, including the ones that are zero', () => {
	const html = panelHtml({ ...withProject, pages: 0, issues: 0, owed: 0, unshipped: 0 }, 'NONCE1234567890ABCDEFGH');
	assert.equal((html.match(/<b>0<\/b>/gu) ?? []).length, 4, 'every empty count should still read as zero');
});

// With no project the strip is not on screen at all — its view is gated on `temcoDocs.hasProject` — so the way out of the
// empty state is VS Code's own welcome content on the Pages tree. That is where the buttons live now, so that is what is
// checked, and the empty strip is checked for having nothing to click.
test('no project draws no control, and the Pages view carries the welcome', () => {
	const html = panelHtml({ pages: 0, issues: 0, unshipped: 0, owed: 0 }, 'NONCE1234567890ABCDEFGH');
	assert.ok(!html.includes('data-command="'), 'the empty strip must not offer a control that does nothing');
	assert.ok(!html.includes('class="open"'), 'the empty strip must not draw the name row as a button');

	const strip = (manifest.contributes?.views?.temco ?? []).find(view => view.id === 'temcoDocs.panel');
	assert.equal(strip?.when, 'temcoDocs.hasProject', 'the strip belongs to a project, so its view is gated on one');

	const welcome = (manifest.contributes?.viewsWelcome ?? []).find(entry => entry.view === 'temcoDocs.pages');
	assert.equal(welcome?.when, '!temcoDocs.hasProject', 'the welcome is for the state without a project');
	for (const command of ['temcoProjects.selectProject', 'temcoProjects.newProject', 'temcoDocs.projects']) {
		assert.ok((welcome?.contents ?? '').includes(`command:${command}`), `the welcome should offer ${command}`);
	}
});

test('nothing is loaded from anywhere', () => {
	const html = panelHtml(withProject, 'NONCE1234567890ABCDEFGH');
	assert.ok(!/https?:\/\//u.test(html), 'the panel must not reference the network');
	assert.ok(!/<link\b/u.test(html), 'the panel must not link a stylesheet');
	assert.ok(!/<img\b/u.test(html), 'the panel must not load an image');
});

test('the policy allows one nonce, and the script carries it', () => {
	const value = nonce();
	assert.equal(value.length, 24);
	const html = panelHtml(withProject, value);
	assert.match(html, /Content-Security-Policy" content="default-src 'none'/u);
	assert.ok(html.includes(`script-src 'nonce-${value}'`), 'the script policy does not name the nonce');
	assert.ok(html.includes(`<script nonce="${value}">`), 'the script does not carry the nonce');
	assert.notEqual(nonce(), value, 'two panels must not share a nonce');
});

test('a build that never happened says so', () => {
	const html = panelHtml({ ...withProject, project: { name: 'Temco', sources: 1 } }, 'NONCE1234567890ABCDEFGH');
	assert.ok(html.includes('never built'));
	const recent = panelHtml(withProject, 'NONCE1234567890ABCDEFGH');
	assert.ok(recent.includes('built 3 h ago'), 'a three-hour-old build should read as hours');
});

test('the facts are one plain paragraph of numbers and their nouns', () => {
	const html = panelHtml(withProject, 'NONCE1234567890ABCDEFGH');
	const info = /<p class="info">(.*?)<\/p>/u.exec(html)?.[1];
	assert.equal(
		info,
		'<b>148</b> pages · <b>3</b> issues · <b>2</b> drafts · <b>2</b> sources · <b>0</b> outputs · built 3 h ago · never published'
	);
});

test('the description line says who it is for, and is absent when nothing is recorded', () => {
	const html = panelHtml({
		...withProject,
		project: { name: 'Temco', sources: 1, audience: 'operators', owner: 'Han', engine: 'mkdocs' }
	}, 'NONCE1234567890ABCDEFGH');
	assert.ok(html.includes('Written for operators, owned by Han. Built with mkdocs.'));
	const bare = panelHtml(withProject, 'NONCE1234567890ABCDEFGH');
	assert.ok(!bare.includes('class="desc"'), 'nothing recorded should draw no line');
});

test('the four acts are icon buttons, named for a screen reader', () => {
	const html = panelHtml(withProject, 'NONCE1234567890ABCDEFGH');
	assert.equal((html.match(/class="icon" data-command=/gu) ?? []).length, 4, 'four acts should be icons');
	assert.ok(!html.includes('icon--primary'), 'no act should be drawn as the selected one');
	assert.equal((html.match(/aria-label="[^"]+"/gu) ?? []).length, 4, 'an icon without a label is a mystery');
});

test('the read and publish activity line is not drawn', () => {
	const html = panelHtml({
		...withProject,
		project: {
			name: 'Temco',
			sources: 1,
			readAt: new Date(Date.now() - 2 * 3600 * 1000).toISOString(),
			sourceName: 'handbook',
			lastRelease: { version: '1.4.2', destination: 'GitHub Pages', publishedAt: new Date().toISOString() }
		}
	}, 'NONCE1234567890ABCDEFGH');
	assert.ok(!html.includes('class="activity"'), 'the fold between read and publish is gone');
	assert.ok(!html.includes('never read from a source'));
	assert.ok(!html.includes('publishes to'));
});

test('unshipped is only mentioned when something is', () => {
	const quiet = panelHtml(withProject, 'NONCE1234567890ABCDEFGH');
	assert.ok(!quiet.includes('unshipped'), 'nothing is waiting, so nothing should be said');
	const waiting = panelHtml({ ...withProject, unshipped: 4 }, 'NONCE1234567890ABCDEFGH');
	assert.ok(waiting.includes('<b>4</b> unshipped'));
});

test('a release says which version left the building, and when', () => {
	const released = panelHtml({
		...withProject,
		project: { name: 'Temco', sources: 1, lastRelease: { version: '1.4.2', destination: 'GitHub Pages', publishedAt: new Date().toISOString() } }
	}, 'NONCE1234567890ABCDEFGH');
	assert.ok(released.includes('1.4.2 · just now'), 'a fresh release should read as version and when');
});

test('the way to the project page is the name row, and it is the only non-act button', () => {
	const html = panelHtml(withProject, 'NONCE1234567890ABCDEFGH');
	assert.equal((html.match(/class="open"/gu) ?? []).length, 1, 'the name row should be the one way in');
	assert.ok(html.includes('data-command="temcoDocs.projectPage"'), 'the name row does not open the project page');
	assert.ok(html.includes('aria-hidden="true"><path'), 'the row should carry a glyph, not the icon font');
});

test('with no project the strip offers no page and no acts, because there is nothing to act on', () => {
	const html = panelHtml({ pages: 0, issues: 0, unshipped: 0, owed: 0 }, 'NONCE1234567890ABCDEFGH');
	assert.ok(!html.includes('data-command="'), 'an empty strip should not carry a button');
	assert.ok(!html.includes('temcoDocs.projectPage'), 'an empty panel should not offer the project page');
	assert.ok(!html.includes('class="open"'), 'the name row is a button only when there is a name');
});

test('the script acquires the editor API exactly once', () => {
	const html = panelHtml(withProject, 'NONCE1234567890ABCDEFGH');
	// `acquireVsCodeApi()` throws on the second call, which would leave every button dead — and no compile or DOM-less
	// test notices. One call, one bus.
	assert.equal((html.match(/acquireVsCodeApi\(\)/gu) ?? []).length, 1);
});

test('escaping covers the characters that break out', () => {
	assert.equal(escapeHtml('a & b <c> "d"'), 'a &amp; b &lt;c&gt; &quot;d&quot;');
});

let failed = 0;
for (const { name, run } of cases) {
	try {
		run();
		console.log(`  ok  ${name}`);
	} catch (error) {
		failed += 1;
		console.error(`FAIL  ${name}`);
		console.error(error instanceof Error ? error.message : error);
	}
}
console.log(`\n${cases.length - failed}/${cases.length} panel cases passed`);
process.exit(failed === 0 ? 0 : 1);
