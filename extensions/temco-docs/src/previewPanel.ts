// The page as a reader sees it, in its own tab beside the source.
//
// The toolbar writes `> [!NOTE]` and the build turns that marker into a DocFX alert, so this preview dresses the
// alerts instead of printing the marker: a preview that disagrees with the published page is worse than none. The
// body itself comes from the built-in Markdown pipeline, `markdown.api.render`, so the two cannot drift apart —
// whatever the editor extension decides a page means is what is shown here.
//
// It follows the document it was opened from: typing updates it, saving updates it, and closing either one closes
// the pair. Nothing here writes. The source file stays the only thing on disk.

import * as path from 'path';
import * as vscode from 'vscode';
import { pageRoots } from './pageAssets';
import { escapeHtml, fileColumn } from './ui';

/** The view type the preview tab registers under; one tab per document. */
export const PREVIEW_VIEW_TYPE = 'temcoDocs.preview';

/** The five DocFX renders, by the marker the toolbar writes and the word the page shows. */
const ALERTS: Record<string, string> = {
	note: 'Note',
	tip: 'Tip',
	important: 'Important',
	caution: 'Caution',
	warning: 'Warning',
};

/** How long typing rests before the preview is redrawn. Short enough to feel live, long enough not to thrash. */
const REDRAW_MS = 180;

/** One message from the preview's own script: a link somebody clicked. */
interface ClickMessage {
	href?: unknown;
}

/**
 * The open previews, by the document each follows.
 *
 * One panel per document rather than one panel overall: two pages read side by side is a real thing to do, and a
 * single reused panel would silently swap the page under the reader.
 */
export class PreviewPanels implements vscode.Disposable {
	private readonly panels = new Map<string, vscode.WebviewPanel>();
	private readonly timers = new Map<string, ReturnType<typeof setTimeout>>();
	private readonly listeners: vscode.Disposable;

	constructor() {
		this.listeners = vscode.Disposable.from(
			vscode.workspace.onDidChangeTextDocument((event) => this.follow(event.document, false)),
			vscode.workspace.onDidSaveTextDocument((document) => this.follow(document, true))
		);
	}

	dispose(): void {
		for (const timer of this.timers.values()) {
			clearTimeout(timer);
		}
		this.timers.clear();
		for (const panel of this.panels.values()) {
			panel.dispose();
		}
		this.panels.clear();
		this.listeners.dispose();
	}

	/** Opens the preview for a document, or brings the one already open for it in front. */
	async show(document: vscode.TextDocument): Promise<void> {
		const key = document.uri.toString();
		const open = this.panels.get(key);
		if (open !== undefined) {
			open.reveal(undefined, true);
			return;
		}

		const panel = vscode.window.createWebviewPanel(
			PREVIEW_VIEW_TYPE,
			`Preview: ${path.basename(document.uri.fsPath)}`,
			{ viewColumn: vscode.ViewColumn.Beside, preserveFocus: true },
			{
				enableScripts: true,
				retainContextWhenHidden: true,
				// A page's pictures are written `../media/…`, so the panel needs the folder above the page as well as
				// the page's own — the documentation root, and no further.
				localResourceRoots: pageRoots(document.uri.fsPath).map((folder) => vscode.Uri.file(folder)),
			}
		);
		this.panels.set(key, panel);
		panel.onDidDispose(() => {
			this.panels.delete(key);
			const timer = this.timers.get(key);
			if (timer !== undefined) {
				clearTimeout(timer);
				this.timers.delete(key);
			}
		});
		panel.webview.onDidReceiveMessage((message: ClickMessage) => void this.open(message, document));
		await this.render(document);
	}

	/** Redraws the preview of a document, if one is open for it. */
	private follow(document: vscode.TextDocument, immediately: boolean): void {
		const key = document.uri.toString();
		if (!this.panels.has(key)) {
			return;
		}
		const running = this.timers.get(key);
		if (running !== undefined) {
			clearTimeout(running);
		}
		if (immediately) {
			this.timers.delete(key);
			void this.render(document);
			return;
		}
		this.timers.set(
			key,
			setTimeout(() => {
				this.timers.delete(key);
				void this.render(document);
			}, REDRAW_MS)
		);
	}

	private async render(document: vscode.TextDocument): Promise<void> {
		const panel = this.panels.get(document.uri.toString());
		if (panel === undefined) {
			return;
		}
		panel.webview.html = await page(document, panel.webview);
	}

	/** A link in the preview: a page of this documentation opens in the editor, a web address opens outside. */
	private async open(message: ClickMessage, document: vscode.TextDocument): Promise<void> {
		const href = message.href;
		if (typeof href !== 'string' || href.length === 0 || href.startsWith('#')) {
			return;
		}
		if (/^(?:https?|mailto):/i.test(href)) {
			await vscode.env.openExternal(vscode.Uri.parse(href));
			return;
		}
		const target = resolve(href, document);
		if (target === undefined) {
			return;
		}
		try {
			const opened = await vscode.workspace.openTextDocument(target);
			await vscode.window.showTextDocument(opened, { preview: false, viewColumn: fileColumn() });
		} catch {
			await vscode.commands.executeCommand('vscode.open', target);
		}
	}
}

/** The whole tab: the rendered page, styled, with the one script that turns a link into a message. */
async function page(document: vscode.TextDocument, webview: vscode.Webview): Promise<string> {
	const key = nonce();
	const body = rewrite(decorate(await render(document)), document, webview);
	return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta http-equiv="Content-Security-Policy" content="default-src 'none'; img-src ${webview.cspSource} data: https:; style-src ${webview.cspSource} 'unsafe-inline'; font-src ${webview.cspSource}; script-src 'nonce-${key}';">
<style>${STYLE}</style>
</head>
<body>
<main class="page">${body}</main>
<script nonce="${key}">
const api = acquireVsCodeApi();
document.addEventListener('click', function (event) {
	const anchor = event.target && event.target.closest ? event.target.closest('a') : null;
	if (!anchor) { return; }
	const href = anchor.getAttribute('href');
	if (href === null || href.charAt(0) === '#') { return; }
	event.preventDefault();
	api.postMessage({ href: href });
});
</script>
</body>
</html>`;
}

/**
 * The body HTML.
 *
 * The rendering is the built-in Markdown extension's — `markdown.api.render` — so the preview, the Markdown preview
 * VS Code ships and the editor's own idea of the page cannot disagree. When that extension is not active the page
 * is shown as text rather than as nothing.
 */
async function render(document: vscode.TextDocument): Promise<string> {
	try {
		const body = await vscode.commands.executeCommand<string>('markdown.api.render', document.getText());
		if (typeof body === 'string' && body.length > 0) {
			return body;
		}
	} catch {
		// Falls through to the plain-text rendering below.
	}
	return `<div class="fallback"><p>The Markdown renderer is not available in this window, so the page is shown as
text.</p><pre>${escapeHtml(document.getText())}</pre></div>`;
}

/** `<blockquote>`s that open with a DocFX marker become alerts, with the label the published page shows. */
function decorate(body: string): string {
	return body.replace(/<blockquote>([\s\S]*?)<\/blockquote>/g, (whole: string, inside: string) => {
		const marker = /^\s*<p>\s*\[!(NOTE|TIP|IMPORTANT|CAUTION|WARNING)\]\s*/i.exec(inside);
		if (marker === null) {
			return whole;
		}
		const kind = marker[1].toLowerCase();
		const label = ALERTS[kind] ?? marker[1];
		return `<div class="alert alert--${kind}"><div class="alert__label">${label}</div>` +
			`<div class="alert__body"><p>${inside.slice(marker[0].length)}</div>`;
	});
}

/** Images are the one thing a page carries that a webview cannot resolve on its own. */
function rewrite(body: string, document: vscode.TextDocument, webview: vscode.Webview): string {
	return body.replace(/(<img\b[^>]*?\bsrc=")([^"]+)(")/g, (whole: string, before: string, source: string, after: string) => {
		const target = resolve(source, document);
		return target === undefined ? whole : `${before}${webview.asWebviewUri(target)}${after}`;
	});
}

/** A page-relative address as a file, or undefined when it is not one this preview may read. */
function resolve(source: string, document: vscode.TextDocument): vscode.Uri | undefined {
	if (source.length === 0 || source.startsWith('/') || /^(?:[a-z][a-z0-9+.-]*:|\/\/)/i.test(source)) {
		return undefined;
	}
	const bare = source.split('?')[0].split('#')[0];
	if (bare.length === 0) {
		return undefined;
	}
	let decoded = bare;
	try {
		decoded = decodeURIComponent(bare);
	} catch {
		// A malformed escape keeps the address as written.
	}
	return vscode.Uri.file(path.join(path.dirname(document.uri.fsPath), decoded));
}

/** A value the content security policy accepts for the one inline script. */
function nonce(): string {
	const alphabet = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
	let text = '';
	for (let index = 0; index < 32; index++) {
		text += alphabet.charAt(Math.floor(Math.random() * alphabet.length));
	}
	return text;
}

/**
 * The page's own stylesheet.
 *
 * The type scale and the alert colours follow the published site closely enough that a page reads the same in both
 * places; every other colour is a theme token, so the preview belongs to the editor it sits in.
 */
const STYLE = `
:root { color-scheme: light dark; }
body {
	margin: 0;
	padding: 0;
	font-family: var(--vscode-markdown-font-family, var(--vscode-font-family));
	font-size: var(--vscode-editor-font-size, 14px);
	line-height: 1.6;
	color: var(--vscode-editor-foreground);
	background: var(--vscode-editor-background);
}
.page { max-width: 54rem; margin: 0 auto; padding: 28px 32px 64px; }
.page > :first-child { margin-top: 0; }
h1, h2, h3, h4, h5, h6 { line-height: 1.25; margin: 1.8em 0 0.6em; font-weight: 600; }
h1 { font-size: 2em; padding-bottom: 0.3em; border-bottom: 1px solid var(--vscode-editorWidget-border, rgba(128,128,128,.35)); }
h2 { font-size: 1.5em; padding-bottom: 0.3em; border-bottom: 1px solid var(--vscode-editorWidget-border, rgba(128,128,128,.25)); }
h3 { font-size: 1.25em; }
h4 { font-size: 1.05em; }
p { margin: 0.8em 0; }
a { color: var(--vscode-textLink-foreground); text-decoration: none; }
a:hover { text-decoration: underline; }
ul, ol { padding-left: 1.6em; margin: 0.8em 0; }
li { margin: 0.25em 0; }
li > input[type="checkbox"] { margin-right: 0.45em; }
hr { border: 0; border-top: 1px solid var(--vscode-editorWidget-border, rgba(128,128,128,.35)); margin: 2em 0; }
blockquote {
	margin: 1em 0;
	padding: 0.1em 0 0.1em 1em;
	border-left: 3px solid var(--vscode-textBlockQuote-border, rgba(128,128,128,.5));
	color: var(--vscode-textBlockQuote-foreground, inherit);
}
code {
	font-family: var(--vscode-editor-font-family, monospace);
	font-size: 0.92em;
	padding: 0.15em 0.35em;
	border-radius: 3px;
	background: var(--vscode-textCodeBlock-background, rgba(128,128,128,.16));
}
pre {
	margin: 1em 0;
	padding: 12px 14px;
	overflow: auto;
	border-radius: 4px;
	background: var(--vscode-textCodeBlock-background, rgba(128,128,128,.16));
	border: 1px solid var(--vscode-editorWidget-border, rgba(128,128,128,.2));
}
pre code { padding: 0; background: none; font-size: 0.92em; line-height: 1.5; }
table { border-collapse: collapse; margin: 1em 0; display: block; overflow: auto; }
th, td { border: 1px solid var(--vscode-editorWidget-border, rgba(128,128,128,.35)); padding: 6px 12px; text-align: left; }
th { background: var(--vscode-keybindingTable-headerBackground, rgba(128,128,128,.12)); font-weight: 600; }
img { max-width: 100%; height: auto; }
kbd {
	font-family: var(--vscode-editor-font-family, monospace);
	font-size: 0.85em;
	padding: 0.15em 0.4em;
	border: 1px solid var(--vscode-editorWidget-border, rgba(128,128,128,.4));
	border-bottom-width: 2px;
	border-radius: 3px;
}
.alert { margin: 1.2em 0; border-left: 4px solid; border-radius: 3px; overflow: hidden; }
.alert__label {
	font-size: 0.78em;
	font-weight: 700;
	letter-spacing: 0.04em;
	text-transform: uppercase;
	padding: 6px 14px 0;
}
.alert__body { padding: 0 14px 9px; }
.alert__body > :first-child { margin-top: 0.2em; }
.alert__body > :last-child { margin-bottom: 0; }
.alert--note { border-color: #4f8cc9; background: rgba(79,140,201,.10); }
.alert--note .alert__label { color: #4f8cc9; }
.alert--tip { border-color: #4fa96a; background: rgba(79,169,106,.10); }
.alert--tip .alert__label { color: #4fa96a; }
.alert--important { border-color: #9d6fd0; background: rgba(157,111,208,.10); }
.alert--important .alert__label { color: #9d6fd0; }
.alert--caution { border-color: #c99a4f; background: rgba(201,154,79,.12); }
.alert--caution .alert__label { color: #c99a4f; }
.alert--warning { border-color: #d2604f; background: rgba(210,96,79,.12); }
.alert--warning .alert__label { color: #d2604f; }
.fallback p { color: var(--vscode-descriptionForeground); }
`;
