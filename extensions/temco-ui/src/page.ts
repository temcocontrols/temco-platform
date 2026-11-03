// The page shell: one document, one stylesheet, one way to run a command.
//
// Why it lives in this module: every module draws its pages as webview tabs, and until now each of them carried its
// own `<style>` block — seven copies of a page head, a row, a badge, drifting apart. The mock site settled what those
// things look like (`docs/mock/css/views.css`); `media/page.css` is that vocabulary shipped to the product, and this
// file is the smallest possible host for it: a document, the stylesheet, and a message back to the extension.
//
// Two decisions worth naming:
//
//   * **the stylesheet is inlined, not linked.** A webview that links a file needs `localResourceRoots` and a URI
//     that survives the server case; a page that inlines it needs neither, and a page is one file read once at
//     activation. The cost is a few dozen kilobytes per tab, paid once per tab.
//   * **a command is a message, not an `<a href="command:">`.** Command URIs are off by default and are a link where
//     the thing is an action; a button that posts `{ type: 'command', command }` reads the same in every module, and
//     the module decides what it may run.

import * as fs from 'fs';
import * as path from 'path';
import { randomBytes } from 'crypto';
import * as vscode from 'vscode';
import { escapeHtml } from './components';

export { escapeHtml };

/** What a page is called in the tab, and the script it runs, if any. */
export interface PageOptions {
	/** The document title. The tab's title is the panel's own. */
	title?: string;
	/** A script, run once the page is shown. It has `vscode` from `acquireVsCodeApi()`. */
	script?: string;
	/**
	 * Styles for this page alone, appended after the shared vocabulary. A page that is a form — a wizard, an
	 * editor — may keep its own component rules; what it should not keep is its own document, its own colours or
	 * its own type scale, and those are the vocabulary's.
	 */
	extraCss?: string;
}

let stylesheet: string | undefined;
let sprite: string | undefined;

/** The page vocabulary, read once. A missing stylesheet costs the look of a page, never the page. */
function pageCss(context: vscode.ExtensionContext): string {
	if (stylesheet === undefined) {
		stylesheet = read(context, 'page.css');
	}
	return stylesheet;
}

/** The icon sprite, read once. Same rule: a missing sprite costs the glyph, never the page. */
function icons(context: vscode.ExtensionContext): string {
	if (sprite === undefined) {
		sprite = read(context, 'icons.svg');
	}
	return sprite;
}

function read(context: vscode.ExtensionContext, file: string): string {
	try {
		return fs.readFileSync(path.join(context.extensionUri.fsPath, 'media', file), 'utf8');
	} catch {
		return '';
	}
}

/** A document around `body`, with the shared page vocabulary and a content-security policy. */
export function page(context: vscode.ExtensionContext, body: string, options: PageOptions = {}): string {
	const nonce = randomBytes(16).toString('base64');
	const policy = `default-src 'none'; style-src 'unsafe-inline'; img-src data:;${options.script ? ` script-src 'nonce-${nonce}';` : ''}`;
	const script = options.script ? `<script nonce="${nonce}">${options.script}</script>` : '';
	return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta http-equiv="Content-Security-Policy" content="${policy}">
<style>${pageCss(context)}${options.extraCss ?? ''}</style>
<title>${escapeHtml(options.title ?? 'Temco')}</title>
</head>
<body>
${icons(context)}
<div class="view"><div class="view__inner">${body}</div></div>
${script}
</body>
</html>`;
}

/** One glyph from the page's own sprite, and one inside a tinted circle: both live with the components. */
export { icon, toneMark } from './components';

/**
 * The script every page of ours runs: a click on anything carrying `data-command` posts that command to the module.
 *
 * A page never decides what a command means and never reaches for the API itself, so `enableScripts` buys exactly one
 * behaviour — "run this, with these arguments" — and a module can audit it in one place.
 */
export const COMMAND_SCRIPT = `
(function () {
        const api = acquireVsCodeApi();
        document.addEventListener('click', (event) => {
                const target = event.target.closest('[data-command]');
                if (!target) {
                        return;
                }
                event.preventDefault();
                const args = target.dataset.args;
                api.postMessage({
                        type: 'command',
                        command: target.dataset.command,
                        args: args === undefined ? undefined : JSON.parse(args)
                });
        });
})();
`;

/** One message a page sends back, as the module's panel sees it. */
export interface PageMessage {
	type?: string;
	command?: string;
	args?: unknown;
}

/** Runs a page's command message. Every module's `onDidReceiveMessage` is this function. */
/**
 * Runs a command a page's button named.
 *
 * `data-args` is written as a **list** — `[id]`, `['slug']` — because that is how a page thinks about "the things this
 * command needs", and the list is spread here so the command receives them one by one. A page that named a single
 * value rather than a list of one still works: a value that is not an array is the whole argument list.
 */
export function runPageCommand(message: PageMessage): void {
	if (message.type === 'command' && typeof message.command === 'string') {
		const args = message.args === undefined ? [] : Array.isArray(message.args) ? message.args : [message.args];
		void vscode.commands.executeCommand(message.command, ...args);
	}
}
