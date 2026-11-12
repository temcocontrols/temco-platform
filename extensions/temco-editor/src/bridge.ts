// The bridge every webview editor in this module shares.
//
// A rich surface is a browser editor that owns no document. The file stays the only truth, the webview sends the whole
// Markdown after typing settles, and this class applies it as one `WorkspaceEdit` over the whole file. That is what keeps
// `Ctrl+Z`, the dirty dot, save and *Diff* behaving exactly as they do in the source editor.
//
// Everything a subclass decides is a folder of built assets and a few strings. Everything that could corrupt a file —
// line endings, the echo guard, which command a bar button runs — is decided here, once. What the page *is* (its media
// folder, its set, the pages a link may reach) belongs to the documentation module and is reached through `docs.ts`.

import * as path from 'path';
import * as vscode from 'vscode';

import { existsSync, statSync } from 'fs';
import { screenshotPng } from './capture';
import { docsApi, LinkablePage, pageRoots } from './docs';

/** What a bar button may ask the extension to do. */
type PageAction = 'preview' | 'diff' | 'source' | 'properties' | 'assist' | 'save';

/** One message from a webview: the editor's own protocol, in either direction. */
interface HostMessage {
	type?: unknown;
	text?: unknown;
	action?: unknown;
	name?: unknown;
	data?: unknown;
	caption?: unknown;
	src?: unknown;
}

const COMMANDS: Record<PageAction, string> = {
	preview: 'temcoEditor.preview',
	diff: 'temcoEditor.diff',
	source: 'temcoEditor.openSource',
	properties: 'temcoEditor.pageProperties',
	assist: 'temcoEditor.assist',
	save: 'temcoEditor.save',
};

function actionOf(value: unknown): PageAction | undefined {
	return value === 'preview' || value === 'diff' || value === 'source' || value === 'properties'
		|| value === 'assist' || value === 'save'
		? value
		: undefined;
}

/**
 * Where a surface's built bundle lives.
 *
 * `build-webview.mts` writes `out/webview/<assets>/`, and `out/` is the repository's build-output directory: the
 * `local/code-no-new-javascript-files` rule rejects a newly committed `.js`, so the bundle is built, not shipped.
 */
function webviewAssets(extensionUri: vscode.Uri, assets: string): vscode.Uri {
	return vscode.Uri.joinPath(extensionUri, 'out', 'webview', assets);
}

/**
 * A bundle URL, addressed by its own modification time.
 *
 * The webview's renderer caches a stylesheet or a script by its URL, so a rebuilt bundle kept the old address and the
 * editor kept drawing the old surface until the whole window was reloaded — which, from the outside, looks exactly like
 * "the change did nothing". The stamp is the file rather than a version number, so any rebuild is a new URL and any
 * rebuild is visible on the next load of the tab.
 */
function stamped(uri: vscode.Uri): string {
	const address = uri.toString(true);
	try {
		return `${address}${address.includes('?') ? '&' : '?'}v=${Math.round(statSync(uri.fsPath).mtimeMs)}`;
	} catch {
		return address;
	}
}

/** The page's text size: `temcoEditor.fontSize`, clamped the way the contribution clamps it. */
function pageFontSize(): number {
	const size = vscode.workspace.getConfiguration('temcoEditor').get<number>('fontSize', 12);
	return typeof size === 'number' && Number.isFinite(size) ? Math.min(32, Math.max(8, Math.round(size))) : 12;
}

/**
 * An editor whose surface is a webview and whose document is a text file.
 *
 * Subclasses supply the built bundles; this owns the conversation with them.
 */
export abstract class WebviewTextEditor implements vscode.CustomTextEditorProvider {
	constructor(
		protected readonly context: vscode.ExtensionContext,
		private readonly assets: string
	) { }

	/**
	 * A screenshot that has been taken but not yet placed.
	 *
	 * The capture happens before the caption is asked for, because the screen the person wants is the one behind this
	 * window — asking first would photograph the question. The document is part of the record so a capture cannot land
	 * on a page that was not the one it was taken from.
	 */
	private pendingCapture: { document: vscode.TextDocument; bytes: Uint8Array } | undefined;

	async resolveCustomTextEditor(
		document: vscode.TextDocument,
		panel: vscode.WebviewPanel,
		_token: vscode.CancellationToken
	): Promise<void> {
		// An editor that throws leaves an empty tab and no explanation, which a person cannot act on. Say it instead.
		try {
			this.start(document, panel);
		} catch (error) {
			const message = error instanceof Error ? error.message : String(error);
			void vscode.window.showErrorMessage(`Temco Editor: the ${this.assets} surface could not start — ${message}`);
			panel.webview.options = { enableScripts: false };
			panel.webview.html = `<body style="font-family:var(--vscode-font-family);padding:20px">The ${this.assets} surface could not start: ${message}</body>`;
		}
	}

	/** The surface itself: assets, document, and the two-way conversation that keeps them equal. */
	private start(document: vscode.TextDocument, panel: vscode.WebviewPanel): void {
		panel.webview.options = {
			enableScripts: true,
			localResourceRoots: [
				this.bundleRoot(),
					// A page's images are relative to the page, so the page's own folder has to be readable — and so does
					// the documentation root above it, because a page writes `../media/…`: that is what the build resolves.
					...pageRoots(document.uri.fsPath).map((folder) => vscode.Uri.file(folder)),
				],
			};
		panel.webview.html = this.html(document, panel.webview);

		/** The last text this editor put into the document, so its own write is not read back as an outside change. */
		let applied = '';
		/**
		 * Every text this editor asked VS Code to write.
		 *
		 * `applyEdit` is asynchronous, and two writes can land out of order while somebody is typing. `applied` names
		 * only the newest, so a write that is the editor's own but not the last one would look like an outside change —
		 * and answering it with `set` replaces the document under the caret. That is the whole bug: the caret jumps to
		 * the end of the page and the selection being dragged collapses.
		 */
		const written = new Set<string>();
		const remember = (text: string): void => {
			written.add(text);
			for (const oldest of written) {
				if (written.size <= 20) {
					break;
				}
				written.delete(oldest);
			}
		};

		const redraw = (): void => {
			void panel.webview.postMessage({
				type: 'set',
				text: document.getText(),
				// The page's own place, for the head the surface draws: `docs/t3000/commissioning.md`.
				path: vscode.workspace.asRelativePath(document.uri),
			});
		};

		panel.webview.onDidReceiveMessage((message: HostMessage) => {
			if (message.type === 'ready') {
				redraw();
				return;
			}
			if (message.type === 'action' && message.action === 'image') {
				void this.pickImage(document, panel);
				return;
			}
			if (message.type === 'action' && message.action === 'pastedImage') {
				void this.landPasted(document, panel, message.name, message.data, message.caption);
				return;
			}
			if (message.type === 'action' && message.action === 'capture') {
				void this.captureScreen(document, panel);
				return;
			}
			if (message.type === 'action' && message.action === 'commitCapture') {
				void this.commitCapture(document, panel, message.caption);
				return;
			}
			if (message.type === 'action' && message.action === 'caption') {
				void this.rememberCaption(document, message.src, message.caption);
				return;
			}
			if (message.type === 'action' && message.action === 'linkPage') {
				void this.linkToPage(document, panel);
				return;
			}
			if (message.type === 'action') {
				void this.act(document, actionOf(message.action));
				return;
			}
			if (message.type !== 'change' || typeof message.text !== 'string') {
				return;
			}
			const next = message.text;
			if (next === document.getText() || this.eolOf(document, next) === document.getText()) {
				return;
			}
			applied = this.eolOf(document, next);
			remember(applied);
			void this.replace(document, next);
		});

		this.context.subscriptions.push(
			vscode.workspace.onDidChangeTextDocument((event) => {				if (event.document.uri.toString() !== document.uri.toString() || event.contentChanges.length === 0) {
					return;
				}
				const now = event.document.getText();
				// One of this editor's own writes — possibly an earlier one that landed late. Never an outside change.
				if (written.delete(now)) {
					return;
				}
				if (now === applied) {
					return;
				}
				redraw();
			})
		);

		// The page's size is a setting, so changing it must not cost the reader their place: the surface is told the new
		// number and sets one variable, rather than the webview being rebuilt under the caret.
		this.context.subscriptions.push(
			vscode.workspace.onDidChangeConfiguration((event) => {
				if (event.affectsConfiguration('temcoEditor.fontSize')) {
					void panel.webview.postMessage({ type: 'fontSize', value: pageFontSize() });
				}
			})
		);
	}

	/**
	 * Puts an image the person picked beside the page.
	 *
	 * Nothing is written to the document here: the webview inserts the reference and the normal save path carries it into
	 * the file. What this adds is the record — the words that go with the picture, and the version it shows, which is
	 * what lets a later release name the screenshots that need retaking (design §22.4).
	 */
	private async pickImage(document: vscode.TextDocument, panel: vscode.WebviewPanel): Promise<void> {
		const picked = await vscode.window.showOpenDialog({
			canSelectMany: false,
			openLabel: 'Insert',
			filters: { Images: ['png', 'jpg', 'jpeg', 'gif', 'svg', 'webp'] },
		});
		const source = picked?.[0];
		if (source === undefined) {
			return;
		}
		try {
			const bytes = await vscode.workspace.fs.readFile(source);
			await this.place(document, panel, {
				bytes,
				extension: path.extname(source.fsPath).replace('.', ''),
				caption: '',
				// A picture from disk arrives with no words at all, so the surface is asked for them afterwards. A paste
				// or a capture already knows: the person typed the caption before the file was written.
				askForCaption: true,
			});
		} catch (error) {
			this.report('the image could not be read', error);
		}
	}

	/** A pasted image: the caption came with the bytes, because the surface asks before it sends them. */
	private async landPasted(
		document: vscode.TextDocument,
		panel: vscode.WebviewPanel,
		name: unknown,
		data: unknown,
		caption: unknown
	): Promise<void> {
		if (typeof data !== 'string' || data.length === 0) {
			return;
		}
		await this.place(document, panel, {
			bytes: Buffer.from(data, 'base64'),
			extension: typeof name === 'string' ? path.extname(name).replace('.', '') : 'png',
			caption: typeof caption === 'string' ? caption : '',
		});
	}

	/**
	 * Takes a screenshot and holds it until the surface has asked what it shows.
	 *
	 * The bytes are kept here rather than sent back, because the caption is asked for *after* the picture is taken and a
	 * full screen is megabytes of base64 that would cross the boundary twice for nothing.
	 */
	private async captureScreen(document: vscode.TextDocument, panel: vscode.WebviewPanel): Promise<void> {
		try {
			const bytes = await screenshotPng();
			if (bytes === undefined) {
				void vscode.window.showInformationMessage(
					'Temco Editor: capture is implemented on Windows and macOS. Paste a screenshot with Ctrl+V instead.'
				);
				return;
			}
			this.pendingCapture = { document, bytes };
			await panel.webview.postMessage({ type: 'captureReady' });
		} catch (error) {
			this.report('the screenshot could not be taken', error);
		}
	}

	/** The caption for a screenshot that has been taken: now it can land, with its words and its version. */
	private async commitCapture(document: vscode.TextDocument, panel: vscode.WebviewPanel, caption: unknown): Promise<void> {
		const pending = this.pendingCapture;
		this.pendingCapture = undefined;
		if (pending === undefined || pending.document.uri.toString() !== document.uri.toString()) {
			return;
		}
		await this.place(document, panel, {
			bytes: pending.bytes,
			extension: 'png',
			caption: typeof caption === 'string' ? caption : '',
		});
	}

	/**
	 * One place for every image: write it, record it, and tell the surface where it is.
	 *
	 * The address the surface receives is **page-relative**, because that is what the Markdown has to contain for the
	 * build to resolve it; the alt text is the caption, because the preview renders it as a caption and a screen reader
	 * reads it as the description — one string, so the two cannot disagree.
	 */
	private async place(
		document: vscode.TextDocument,
		panel: vscode.WebviewPanel,
		options: { bytes: Uint8Array; extension: string; caption: string; askForCaption?: boolean }
	): Promise<void> {
		try {
			const landed = await docsApi().landImage(document.uri.fsPath, options.bytes, options.extension, options.caption);
			if ('error' in landed) {
				void vscode.window.showErrorMessage(`Temco Editor: ${landed.error}. Nothing was written.`);
				return;
			}
			if (landed.warning !== undefined) {
				void vscode.window.showWarningMessage(`Temco Editor: ${landed.warning}`);
			}
			await panel.webview.postMessage({
				type: 'image',
				src: encodeURI(landed.relative),
				alt: landed.alt,
				askForCaption: options.askForCaption === true,
			});
		} catch (error) {
			this.report('the image could not be written beside the page', error);
		}
	}

	/** The caption the surface collected for an image that had none when it landed. Words only; nothing moves. */
	private async rememberCaption(document: vscode.TextDocument, src: unknown, caption: unknown): Promise<void> {
		if (typeof src !== 'string' || typeof caption !== 'string') {
			return;
		}
		try {
			const name = decodeURIComponent(src).replace(/^media\//, '');
			await docsApi().setCaption(document.uri.fsPath, name, caption);
		} catch (error) {
			this.report('the caption could not be recorded', error);
		}
	}

	private report(situation: string, error: unknown): void {
		void vscode.window.showErrorMessage(
			`Temco Editor: ${situation} — ${error instanceof Error ? error.message : String(error)}`
		);
	}

	/**
	 * Asks which page the selection should point at, and answers with the link.
	 *
	 * The form is `05-content-and-registry.md`'s: a **relative `.md` path**, which is the only link the build can resolve
	 * and warn on. The picker therefore offers the pages the documentation module says are in this file's set, and refuses
	 * a page in another source, because no relative path reaches it — the same rule `temcoDocs.format.linkPage` follows
	 * for the text editor.
	 */
	private async linkToPage(document: vscode.TextDocument, panel: vscode.WebviewPanel): Promise<void> {
		let pages: LinkablePage[];
		try {
			pages = docsApi().pagesNear(document.uri.fsPath);
		} catch (error) {
			this.report('the pages to link to could not be read', error);
			return;
		}
		if (pages.length === 0) {
			void vscode.window.showInformationMessage(
				'Temco Editor: this file is in no page set that is being read, so there is nothing to link to.'
			);
			return;
		}
		const picked = await vscode.window.showQuickPick(
			pages.map((page) => ({ label: page.title, description: page.id, page })),
			{ title: 'Link to a page', placeHolder: 'Type part of a title, or a path', matchOnDescription: true }
		);
		if (picked === undefined) {
			return;
		}
		const address = path.relative(path.dirname(document.uri.fsPath), picked.page.fsPath).split(path.sep).join('/');
		await panel.webview.postMessage({ type: 'pageLink', title: picked.page.title, address });
	}

	/**
	 * A button on the bar that leaves the page: the preview beside it, the diff against HEAD, or the source editor.
	 *
	 * The document is passed explicitly. Inside a custom editor there is no `activeTextEditor`, so a command that fell
	 * back to "whatever editor is in front" would find nothing and quietly do nothing.
	 */
	private async act(document: vscode.TextDocument, action: PageAction | undefined): Promise<void> {
		if (action !== undefined) {
			await vscode.commands.executeCommand(COMMANDS[action], document.uri);
		}
	}

	/** The whole file, replaced by the webview's Markdown — one undoable edit, not a stream of them. */
	private async replace(document: vscode.TextDocument, text: string): Promise<void> {
		const edit = new vscode.WorkspaceEdit();
		edit.replace(document.uri, new vscode.Range(0, 0, document.lineCount, 0), this.eolOf(document, text));
		await vscode.workspace.applyEdit(edit);
	}

	/**
	 * The webview's Markdown with the file's own line endings.
	 *
	 * A browser hands back `\n` because that is all it has. Writing that into a CRLF file would change every line ending
	 * in it — a whole-file diff for a one-word edit, which is the exact failure these modes exist to avoid.
	 */
	protected eolOf(document: vscode.TextDocument, text: string): string {
		const eol = document.eol === vscode.EndOfLine.CRLF ? '\r\n' : '\n';
		return eol === '\n' ? text : text.replace(/\r\n|\r|\n/g, '\n').split('\n').join(eol);
	}

	/**
	 * Where this surface's bundle lives. `build-webview.mts` writes it, and `out/` is the repository's build-output
	 * directory — a committed `.js` here would be rejected by the `local/code-no-new-javascript-files` rule.
	 */
	protected bundleRoot(): vscode.Uri {
		return webviewAssets(this.context.extensionUri, this.assets);
	}

	private html(document: vscode.TextDocument, webview: vscode.Webview): string {
		const base = this.bundleRoot();
		// A bundle that is not there is the one failure a browser cannot report: a script that 404s fires no error on
		// `window`, so the tab is simply blank. Asking the disk first turns that into a sentence naming the fix.
		const missing = [`${this.assets}.js`, `${this.assets}.css`].filter(name => !existsSync(path.join(base.fsPath, name)));
		if (missing.length > 0) {
			return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'unsafe-inline';">
<title>${path.basename(document.uri.fsPath)}</title>
</head>
<body style="font: 13px var(--vscode-font-family, sans-serif); padding: 16px; color: var(--vscode-foreground, #333);">
	<p><b>The Temco Editor surface is not built.</b></p>
	<p>Missing: <code>${missing.join('</code>, <code>')}</code> in <code>${base.fsPath}</code>.</p>
	<p>Run <code>npm run compile-temco</code> from the repository root, then reload this window. A plain
	<code>npm run compile</code> compiles the extension host but not the webview bundles.</p>
</body>
</html>`;
		}
		const script = stamped(webview.asWebviewUri(vscode.Uri.joinPath(base, `${this.assets}.js`)));
		const style = stamped(webview.asWebviewUri(vscode.Uri.joinPath(base, `${this.assets}.css`)));
		const page = `${webview.asWebviewUri(vscode.Uri.file(path.dirname(document.uri.fsPath)))}/`;
		const size = pageFontSize();
		return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta http-equiv="Content-Security-Policy" content="default-src 'none'; img-src ${webview.cspSource} data: https:; style-src ${webview.cspSource} 'unsafe-inline'; font-src ${webview.cspSource} data:; script-src ${webview.cspSource};">
<base href="${page}">
<link rel="stylesheet" href="${style}">
<style>:root { --page-font-size: ${size}px; }</style>
<title>${path.basename(document.uri.fsPath)}</title>
</head>
<body>
<div id="root"></div>
<script>
	// If the surface cannot start, say so in the page: an empty tab is the one failure a person cannot act on.
	var say = function (text) {
		var root = document.getElementById('root');
		if (root !== null && root.childElementCount === 0) {
			root.textContent = 'The surface did not start: ' + text;
		}
	};
	window.addEventListener('error', function (event) {
		say(String(event.message) + ' (' + String(event.filename) + ':' + String(event.lineno) + ')');
	}, true);
	window.addEventListener('unhandledrejection', function (event) {
		say(String(event.reason));
	});
</script>
<script src="${script}"></script>
</body>
</html>`;
	}
}
