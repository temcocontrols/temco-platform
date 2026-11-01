// The preview panel's own contract: the bar over the site is a caption, not a toolbar.
//
// A person looking at the site wants three things from the strip above it — is it up, what address is this, and the acts a
// frame cannot do itself. This gate holds the bar to that: one state, one address that is a link, and three acts drawn as
// links (never as three grey boxes competing with the website below them).

import assert from 'node:assert/strict';
import { createRequire, Module } from 'node:module';
import { fileURLToPath } from 'node:url';

interface PreviewModule {
	panelDocument(
		url: string | undefined,
		note: { level: string; text: string; action?: { label: string; run(): void } } | undefined,
		nonce: string,
		title: string,
		status: { tone: string; text: string }
	): string;
}

const vscode = {
	window: { createWebviewPanel: () => ({ dispose() { } }) },
	ViewColumn: { Active: -1 },
	ThemeIcon: class { id: string; constructor(id: string) { this.id = id; } },
	env: { openExternal: async () => true },
	Uri: { parse: (value: string) => ({ toString: () => value }) }
};

const load = Module._load;
Module._load = function (request: string, parent: unknown, isMain: boolean) {
	if (request === 'vscode') {
		return vscode;
	}
	return load.call(this as unknown as NodeModule, request, parent, isMain);
};

const preview = createRequire(import.meta.url)(fileURLToPath(new URL('../out/preview.js', import.meta.url))) as PreviewModule;

const running = { tone: 'running', text: 'running · localhost:1025' };
const failed = { tone: 'failed', text: 'failed' };
const URL_RUNNING = 'http://localhost:1025/';

const cases: { name: string; run: () => void }[] = [];
const test = (name: string, run: () => void): void => {
	cases.push({ name, run });
};

test('the bar is a tinted strip, so the site below it starts where the website does', () => {
	const html = preview.panelDocument(URL_RUNNING, undefined, 'n0nce', 'The site', running);
	assert.match(html, /\.bar \{[^}]*background: var\(--vscode-sideBar-background/u, 'the bar has no background of its own');
	assert.match(html, /\.bar \{[^}]*height: 34px/u, 'the bar is not one line high');
});

test('the bar is the state, then the address, then the acts', () => {
	const html = preview.panelDocument(URL_RUNNING, undefined, 'n0nce', 'The site', running);
	assert.deepEqual(
		[...html.matchAll(/<span class="state state--(\w+)" id="state">([^<]*)</gu)].map((match) => [match[1], match[2]]),
		[['running', 'running · localhost:1025']]
	);
	const order = ['id="state"', 'id="addr"', 'id="acts"', 'id="reload"', 'id="open"', 'id="stop"'].map((needle) => html.indexOf(needle));
	assert.ok(
		order.every((at) => at > 0),
		'a part of the bar is missing: ' + JSON.stringify(order)
	);
	assert.deepEqual(order, [...order].sort((left, right) => left - right), 'the bar is not state · address · acts');
});

test('the address is a link, and clicking it opens the browser', () => {
	const html = preview.panelDocument(URL_RUNNING, undefined, 'n0nce', 'The site', running);
	assert.match(
		html,
		/<button class="addr" id="addr" type="button" title="Open http:\/\/localhost:1025\/ in your browser">http:\/\/localhost:1025\/<\/button>/u
	);
	assert.match(html, /\.addr \{[^}]*color: var\(--vscode-textLink-foreground\)/u, 'the address is not drawn as a link');
	assert.match(html, /getElementById\('addr'\)\.addEventListener\('click', \(\) => api\.postMessage\(\{ type: 'open' \}\)\)/u);
});

test('the acts are links, and the second one says where it goes', () => {
	const html = preview.panelDocument(URL_RUNNING, undefined, 'n0nce', 'The site', running);
	assert.deepEqual(
		[...html.matchAll(/<button class="lnk[^"]*" id="(\w+)"[^>]*>([^<]*)</gu)].map((match) => [match[1], match[2]]),
		[
			['reload', 'Reload'],
			['open', 'Open in Browser'],
			['stop', 'Stop']
		]
	);
	assert.doesNotMatch(html, />Browser</u, 'the act is still called `Browser`');
	assert.match(html, /\.lnk \{[^}]*color: var\(--vscode-textLink-foreground\)/u, 'an act is not drawn as a link');
	assert.doesNotMatch(html, /^\s*button \{/mu, 'a bare `button` rule would restyle every act in the bar');
});

test('with no address, the acts that need one are inert and Stop still works', () => {
	const html = preview.panelDocument(undefined, { level: 'error', text: 'The server did not come up.' }, 'n0nce', 'The site', failed);
	assert.match(html, /id="addr" type="button" title="" disabled/u, 'an address-less panel offers an address');
	assert.match(html, /id="reload" type="button" title="Reload the frame" disabled/u);
	assert.match(html, /id="open" type="button" title="Open the same address in your browser" disabled/u);
	assert.match(html, /id="stop" type="button" title="Stop the server: the port is free afterwards">/u, 'Stop is disabled with nothing running');
	assert.match(html, /id="note" hidden role="status"/u, 'the answer strip is missing');
	assert.match(html, /draw\(\{"level":"error","text":"The server did not come up\."\}\)/u, 'the failure is not handed to the strip');
});

test('the note keeps its own box, and its act is a button', () => {
	const html = preview.panelDocument(
		URL_RUNNING,
		{ level: 'error', text: 'That did not finish.', action: { label: 'Read the log', run: () => undefined } },
		'n0nce',
		'The site',
		failed
	);
	assert.match(html, /<button class="note__act" id="note-action" type="button"/u, 'the note act lost its button style');
	assert.match(html, /\.note__act \{[^}]*border: 1px solid var\(--vscode-panel-border\)/u);
});

let failedCount = 0;
for (const { name, run } of cases) {
	try {
		run();
		console.log(`  ok  ${name}`);
	} catch (error) {
		failedCount += 1;
		console.error(`FAIL  ${name}`);
		console.error('  ' + String((error as Error).message).split('\n').join('\n  '));
	}
}
console.log(`\n${cases.length - failedCount}/${cases.length} preview cases passed`);
if (failedCount > 0) {
	process.exitCode = 1;
}
