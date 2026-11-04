// The panel at the top of the documentation side bar: what project you are in, what it owes, and the two buttons that
// take it out of the building.
//
// It exists because the side bar is otherwise five headings and no answer: a person opening Docs could not see which
// project the tree below belongs to, how many pages it has, or whether the last build worked. The tree stays native — VS
// Code draws it, with reveal, keyboard navigation and filtering for free — so this is only the strip above it.
//
// The markup is a pure function of the state (`panelHtml`), which is what makes it checkable: `check-panel.mts` proves the
// numbers are real, the project name cannot inject markup, and every button names a command that exists.

import * as vscode from 'vscode';
import { DocsRoot, collectPages } from './registry';

export interface DocsPanelState {
	/** The project being worked on, as the catalog knows it. */
	project?: {
		name: string;
		version?: string;
		sources: number;
		/** Who the documentation is written for, who answers for it, and what builds it — the description line. */
		audience?: string;
		owner?: string;
		engine?: string;
		/** When the sources were last read, and the first one's name. */
		readAt?: string;
		sourceName?: string;
		/** How many files the last build produced, if it produced any. */
		outputs?: number;
		builtAt?: string;
		/** The newest release, if anything has ever been published. */
		lastRelease?: { version: string; destination: string; publishedAt: string };
	};
	pages: number;
	issues: number;
	unshipped: number;
	/** Drafts and captures waiting for a person. */
	owed: number;
}

export interface DocsPanelDeps {
	roots(): readonly DocsRoot[];
	state(): Promise<DocsPanelState>;
}

const TYPE = 'temcoDocs.panel';

// The workbench's own icons, at the workbench's own weight: these are the codicon paths the side bar's section titles draw,
// copied verbatim on the 16-unit grid, so the two icon rows above and below are the same family. Inline, because the
// panel's policy loads nothing.
const glyph = (paths: string, size = 20): string => `<svg width="${size}" height="${size}" viewBox="0 0 16 16" fill="currentColor" aria-hidden="true">${paths}</svg>`;
// A project is a folder of sources, not a file: the glyph says which kind of thing the name is before the name is read.
// One step under the acts' size, because it labels the name rather than offering an action of its own.
const PROJECT = glyph('<path d="M14.5 3H7.71l-.85-.85L6.51 2h-5l-.5.5v11l.5.5h13l.5-.5v-10L14.5 3zm-.51 8.49V13h-12V7h4.49l.35-.15.86-.86H14v1.5l-.01 4zm0-6.49h-6.5l-.35.15-.86.86H2v-3h4.29l.85.85.36.15H14l-.01.99z"/>', 16);
// The Documentation overview: a house, because that page is the front of the set rather than a page inside it.
const HOME = glyph('<path d="M7.31299 1.26164C7.69849 0.897163 8.30151 0.897163 8.68701 1.26164L13.5305 5.84098C13.8302 6.12431 14 6.51853 14 6.93094V12.5002C14 13.3286 13.3284 14.0002 12.5 14.0002H10.5C9.67157 14.0002 9 13.3286 9 12.5002V10.0002C9 9.72407 8.77614 9.50021 8.5 9.50021H7.5C7.22386 9.50021 7 9.72407 7 10.0002V12.5002C7 13.3286 6.32843 14.0002 5.5 14.0002H3.5C2.67157 14.0002 2 13.3286 2 12.5002V6.93094C2 6.51853 2.1698 6.12431 2.46948 5.84098L7.31299 1.26164ZM8 1.98828L3.15649 6.56762C3.0566 6.66207 3 6.79347 3 6.93094V12.5002C3 12.7763 3.22386 13.0002 3.5 13.0002H5.5C5.77614 13.0002 6 12.7763 6 12.5002V10.0002C6 9.17179 6.67157 8.50022 7.5 8.50022H8.5C9.32843 8.50022 10 9.17179 10 10.0002V12.5002C10 12.7763 10.2239 13.0002 10.5 13.0002H12.5C12.7761 13.0002 13 12.7763 13 12.5002V6.93094C13 6.79347 12.9434 6.66207 12.8435 6.56762L8 1.98828Z"/>');
const CHECK = glyph('<path fill-rule="evenodd" clip-rule="evenodd" d="M14.431 3.323l-8.47 10-.79-.036-3.35-4.77.818-.574 2.978 4.24 8.051-9.506.764.646z"/>');
const PLAY = glyph('<path d="M3.78 2L3 2.41v12l.78.42 9-6V8l-9-6zM4 13.48V3.35l7.6 5.07L4 13.48z"/>');
const CLOUD_UPLOAD = glyph('<path fill-rule="evenodd" clip-rule="evenodd" d="M11.956 6h.05a2.99 2.99 0 0 1 2.117.879 3.003 3.003 0 0 1 0 4.242 2.99 2.99 0 0 1-2.117.879h-1.995v-1h1.995a2.002 2.002 0 0 0 0-4h-.914l-.123-.857a2.49 2.49 0 0 0-2.126-2.122A2.478 2.478 0 0 0 6.23 5.5l-.333.762-.809-.189A2.49 2.49 0 0 0 4.523 6c-.662 0-1.297.263-1.764.732A2.503 2.503 0 0 0 4.523 11h2.494v1H4.523a3.486 3.486 0 0 1-2.628-1.16 3.502 3.502 0 0 1-.4-4.137A3.497 3.497 0 0 1 3.853 5.06c.486-.09.987-.077 1.468.041a3.486 3.486 0 0 1 3.657-2.06A3.479 3.479 0 0 1 11.956 6zm-1.663 3.853L8.979 8.54v5.436h-.994v-5.4L6.707 9.854 6 9.146 8.146 7h.708L11 9.146l-.707.707z"/>');

export class DocsPanel implements vscode.WebviewViewProvider {
	private view: vscode.WebviewView | undefined;

	constructor(private readonly deps: DocsPanelDeps) { }

	resolveWebviewView(view: vscode.WebviewView): void {
		this.view = view;
		view.webview.options = { enableScripts: true };
		view.webview.onDidReceiveMessage((message: { type?: unknown; command?: unknown; args?: unknown }) => {
			void this.receive(message);
		});
		view.onDidDispose(() => {
			this.view = undefined;
		});
		void this.render();
	}

	/** Re-reads the counts; called whenever the registry, the queue or the catalog changes under it. */
	refresh(): void {
		void this.render();
	}

	private async render(): Promise<void> {
		const state = await this.deps.state();
		// The view can be closed while the catalog is being read; writing to it then throws where nobody can see it.
		const view = this.view;
		if (view !== undefined) {
			view.webview.html = panelHtml(state, nonce());
		}
	}

	private async receive(message: { type?: unknown; command?: unknown; args?: unknown }): Promise<void> {
		if (message.type === 'find') {
			await this.find();
			return;
		}
		if (typeof message.command === 'string') {
			const args = Array.isArray(message.args) ? message.args : [];
			void vscode.commands.executeCommand(message.command, ...args);
		}
	}

	/**
	 * Find a page and open it.
	 *
	 * A native tree cannot be filtered from a webview — the filter lives in the tree's own input box — so the panel does the
	 * next best thing rather than a search field that filters nothing: it asks the reader which page, and opens it in the
	 * editor the same way the Pages view does.
	 */
	private async find(): Promise<void> {
		const pages = this.deps.roots().flatMap(root => collectPages(root)).filter(page => page.exists);
		const chosen = await vscode.window.showQuickPick(
			pages.map(page => ({ label: page.title, description: page.id, uri: page.uri })),
			{ placeHolder: 'Find a page', matchOnDescription: true }
		);
		if (chosen !== undefined) {
			await vscode.commands.executeCommand('vscode.openWith', chosen.uri, 'temcoEditor.markdown').then(undefined, () =>
				vscode.commands.executeCommand('vscode.open', chosen.uri)
			);
		}
	}
}

/** The panel, as HTML.
 *
 * Plain CSS and `--vscode-*` variables: this strip sits inside the workbench, so it has to follow the theme, the font and
 * the spacing of everything around it. Nothing is loaded from anywhere — the style is inline, the script is one listener,
 * and the policy allows exactly that.
 */
export function panelHtml(state: DocsPanelState, nonceValue: string): string {
	const project = state.project;
	const name = project?.name ?? 'No project';
	const version = project?.version === undefined ? '' : `<span class="tag">v${escapeHtml(project.version)}</span>`;

	return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'unsafe-inline'; script-src 'nonce-${nonceValue}';">
<style>
	body {
		margin: 0;
		/* The section keeps whatever height the side bar gives it, so the strip is a column that starts at its top and
		   ends where its content ends — nothing is stretched to fill what it was handed. */
		height: 100vh;
		box-sizing: border-box;
		display: flex;
		flex-direction: column;
		padding: 3px 10px 8px 12px;
		font: 12px/1.35 var(--vscode-font-family);
		color: var(--vscode-foreground);
		overflow: hidden;
	}
	/* The name row is the way to the project page, so the row itself is the button: one target, one hover. */
	.open {
		display: flex;
		align-items: center;
		gap: 6px;
		flex: 1 1 auto;
		min-width: 0;
		/* The padding is inside the hover box rather than around it, so the wash a pointer brings lines up with the
		   name instead of hanging off the left edge of the strip. */
		margin: 0;
		padding: 2px 4px;
		border: 1px solid transparent;
		border-radius: 4px;
		background: transparent;
		color: inherit;
		font: inherit;
		text-align: left;
		cursor: pointer;
	}
	/* One hover and one pressed state for everything clickable in this strip, at the workbench's own colours. */
	.open:hover, .icon:hover { background: var(--vscode-toolbar-hoverBackground, var(--vscode-list-hoverBackground)); }
	.open:active, .icon:active { background: var(--vscode-toolbar-activeBackground, var(--vscode-list-activeSelectionBackground)); }
	.open:focus-visible, .icon:focus-visible { outline: 1px solid var(--vscode-focusBorder); outline-offset: -1px; }
	.glyph { display: flex; flex: 0 0 auto; color: var(--vscode-icon-foreground, var(--vscode-foreground)); }
	.name {
		font-size: 13px;
		line-height: 18px;
		font-weight: 600;
		overflow: hidden;
		text-overflow: ellipsis;
		white-space: nowrap;
	}
	.tag {
		flex: 0 0 auto;
		font-size: 10px;
		line-height: 14px;
		color: var(--vscode-descriptionForeground);
		border: 1px solid var(--vscode-widget-border, rgba(128, 128, 128, 0.35));
		border-radius: 3px;
		padding: 0 4px;
	}
	/* The name and the acts share one line: the name says what the project is, the icons say where to go about it. */
	.head { display: flex; align-items: center; gap: 2px; margin-left: -4px; }
	/* The acts sit together at the far end, a hair apart, the way a title bar's actions do. */
	.acts { display: flex; align-items: center; gap: 1px; flex: 0 0 auto; margin-left: auto; }
	/*
	 * An act is a flat square that only shows its edge under a pointer: 22px, the size the workbench gives a title-bar
	 * action, so the row does not grow taller than the name it sits beside.
	 */
	.icon {
		display: inline-flex;
		align-items: center;
		justify-content: center;
		flex: 0 0 auto;
		width: 22px;
		height: 22px;
		padding: 0;
		border: 1px solid transparent;
		border-radius: 4px;
		background: transparent;
		color: var(--vscode-icon-foreground, var(--vscode-foreground));
		cursor: pointer;
	}
	.icon svg { width: 16px; height: 16px; }
	/* The project in prose: who it is for, what builds it, then where it is read from and where it goes. */
	.desc { margin: 6px 0 0; padding-left: 22px; font-size: 11.5px; line-height: 17px; color: var(--vscode-descriptionForeground); }
	/* What the project holds, as one plain paragraph: numbers in ink, what they count in grey. */
	.info { margin: 4px 0 0; padding-left: 22px; font-size: 11.5px; line-height: 17px; color: var(--vscode-descriptionForeground); }
	.info b { font-weight: 600; color: var(--vscode-foreground); font-variant-numeric: tabular-nums; }
</style>
</head>
<body>
${project === undefined
	? `<p class="info">No project is open.</p>`
	: `<div class="head"><button type="button" class="open" data-command="temcoDocs.projectPage" title="Open the project page"><span class="glyph" aria-hidden="true">${PROJECT}</span><span class="name" title="${escapeHtml(name)}">${escapeHtml(name)}</span>${version}</button>
	<span class="acts">
	<button type="button" class="icon" data-command="temcoDocs.overview" title="Documentation overview" aria-label="Documentation overview">${HOME}</button>
	<button type="button" class="icon" data-command="temcoDocs.review" title="Review the drafts" aria-label="Review the drafts">${CHECK}</button>
	<button type="button" class="icon" data-command="temcoDocs.builds" title="Open the Build Center" aria-label="Open the Build Center">${PLAY}</button>
	<button type="button" class="icon" data-command="temcoDocs.releases" title="Open Publish &amp; Releases" aria-label="Open Publish and Releases">${CLOUD_UPLOAD}</button>
	</span></div>
${about(state)}
<p class="info">${facts(state)}</p>`}
<script nonce="${nonceValue}">
	const vscode = acquireVsCodeApi();
	document.addEventListener('click', (event) => {
		const target = event.target.closest('[data-command]');
		if (!target) {
			return;
		}
		// Every way out of this strip opens a page, so nothing is held down while it works: a button that disabled
		// itself for a moment only made the click look like it had failed.
		vscode.postMessage({ command: target.dataset.command });
	});
</script>
</body>
</html>`;
}

/** The project in one sentence: who it is written for, who answers for it, what builds it. Empty when none is recorded. */
function about(state: DocsPanelState): string {
	const project = state.project;
	if (project === undefined) {
		return '';
	}
	const who: string[] = [];
	if (project.audience !== undefined && project.audience !== '') {
		who.push(`for ${project.audience}`);
	}
	if (project.owner !== undefined && project.owner !== '') {
		who.push(`owned by ${project.owner}`);
	}
	const sentences: string[] = [];
	if (who.length > 0) {
		sentences.push(`Written ${who.join(', ')}.`);
	}
	if (project.engine !== undefined && project.engine !== '') {
		sentences.push(`Built with ${project.engine}.`);
	}
	return sentences.length === 0 ? '' : `<p class="desc">${escapeHtml(sentences.join(' '))}</p>`;
}

/** The facts, as one paragraph a person can read rather than a table they have to scan. */
function facts(state: DocsPanelState): string {
	const project = state.project;
	if (project === undefined) {
		return '';
	}
	const pair = (value: number, unit: string): string => `<b>${value}</b> ${unit}`;
	const parts = [
		pair(state.pages, 'pages'),
		pair(state.issues, 'issues'),
		pair(state.owed, 'drafts'),
		pair(project.sources, 'sources'),
		pair(project.outputs ?? 0, 'outputs'),
		escapeHtml(builtWhen(state)),
		escapeHtml(releasedWhen(state))
	];
	if (state.unshipped > 0) {
		parts.splice(3, 0, pair(state.unshipped, 'unshipped'));
	}
	return parts.join(' · ');
}

/** The newest release, in the words a person would use: never, or the version and how long ago. */
function releasedWhen(state: DocsPanelState): string {
	const release = state.project?.lastRelease;
	return release === undefined ? 'never published' : `${release.version} · ${since(release.publishedAt)}`;
}

function builtWhen(state: DocsPanelState): string {
	const builtAt = state.project?.builtAt;
	return builtAt === undefined ? 'never built' : `built ${since(builtAt)}`;
}

/** How long ago a timestamp was, in the words a person would use — the raw value when it is not a date we can read. */
function since(when: string): string {
	const then = Date.parse(when);
	if (Number.isNaN(then)) {
		return when;
	}
	const minutes = Math.round((Date.now() - then) / 60000);
	if (minutes < 1) {
		return 'just now';
	}
	if (minutes < 60) {
		return `${minutes} min ago`;
	}
	const hours = Math.round(minutes / 60);
	return hours < 24 ? `${hours} h ago` : `${Math.round(hours / 24)} d ago`;
}

/** Text a reader sees as text. */
export function escapeHtml(text: string): string {
	return text
		.replace(/&/gu, '&amp;')
		.replace(/</gu, '&lt;')
		.replace(/>/gu, '&gt;')
		.replace(/"/gu, '&quot;');
}

/** A random id for the inline script, so the policy can allow that one script and no other. */
export function nonce(): string {
	const alphabet = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
	let value = '';
	for (let index = 0; index < 24; index++) {
		value += alphabet[Math.floor(Math.random() * alphabet.length)];
	}
	return value;
}

export { TYPE as PANEL_VIEW_TYPE };
