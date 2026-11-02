// Add Source — the mock's `flow/add-source`, on the shared page kit.
//
// Three steps: Kind, Location, Read. A source is somewhere documentation is read from — a repository, a document,
// a folder — and the kind decides how the platform reads it. The write is this module's own
// store call, and it records exactly what the old dialog recorded: kind, name, where it lives, and the branch a
// repository is pinned to.

import * as https from 'https';
import * as vscode from 'vscode';
import { Catalog, CatalogUnavailable, slugOf } from './store';
import { escapeHtml as esc, icon, page, pageColumn, remember } from './ui';

export const ADD_SOURCE_VIEW_TYPE = 'temcoProjects.addSource';

/**
 * What the wizard opens with.
 *
 * The enterprise and the repository are prefilled with the one Temco ships its documentation from, so the common case
 * is Next → Next → Add; either field can be replaced with anything, and neither lookup is required to finish.
 */
const DEFAULTS = {
	kind: 'repo',
	enterprise: 'temcocontrols',
	location: '',
	readNow: true
};

const KINDS = [
	{ value: 'repo', label: 'Git repository', desc: 'Cloned locally with full history, so a draft can be about a commit.' },
	{ value: 'document', label: 'Document', desc: 'A PDF or a Word file on this machine.' },
	{ value: 'folder', label: 'Folder', desc: 'A directory of Markdown or HTML files.' }
];

/** The kinds the store records, which is not the same list: it has three storage shapes, not four kinds of place. */
const STORE_KIND: { [kind: string]: 'git' | 'folder' | 'archive' } = {
	repo: 'git',
	document: 'archive',
	folder: 'folder'
};

interface Values {
	kind: string;
	location: string;
	branch: string;
	readNow: boolean;
}

/** What a page asks the module for, beyond the finished values. */
interface FlowMessage {
	type?: string;
	values?: Values;
	/** The enterprise whose repositories are wanted — an owner, or a URL that contains one. */
	owner?: string;
	/** The kind whose file or folder picker is wanted. */
	kind?: string;
}

/** One HTTP answer from the GitHub API. `status` absent means the request never got there. */
interface GitHubAnswer {
	status?: number;
	body?: string;
	headers?: Record<string, string | string[] | undefined>;
	error?: string;
}

/**
 * One GET to the GitHub API.
 *
 * A direct connection comes first and the machine's proxy is the fallback: the extension host routes extension
 * traffic through that proxy, and a shared proxy address reaches GitHub's unauthenticated rate limit far sooner
 * than this machine's own address does. `agent` is how the direct attempt bypasses the proxy patch.
 */
function githubSend(path: string, agent?: https.Agent): Promise<GitHubAnswer> {
	return new Promise((resolve) => {
		const request = https.get(
			{
				host: 'api.github.com',
				path,
				headers: { 'user-agent': 'temco-platform', accept: 'application/vnd.github+json' },
				timeout: 12000,
				...(agent ? { agent } : {})
			},
			(response) => {
				let body = '';
				response.setEncoding('utf8');
				response.on('data', (chunk: string) => {
					body += chunk;
				});
				response.on('end', () => {
					resolve({ status: response.statusCode, body, headers: response.headers });
				});
			}
		);
		request.on('timeout', () => {
			request.destroy();
			resolve({ error: 'GitHub did not answer in time.' });
		});
		request.on('error', (error: NodeJS.ErrnoException) =>
			resolve({ error: `GitHub could not be reached from this machine (${error.code ?? error.message}).` })
		);
	});
}

/** Direct first, the proxy only when the request never arrived. An HTTP answer is never retried. */
async function githubRequest(path: string): Promise<GitHubAnswer> {
	const direct = await githubSend(path, new https.Agent({ keepAlive: false }));
	if (direct.error === undefined || direct.status !== undefined) {
		return direct;
	}
	return githubSend(path);
}

/** What one GitHub call answers with, once a repository list has been read out of it. */
interface RepositoryAnswer {
	items: string[];
	error?: string;
	missing?: boolean;
	/** The HTTP status, when GitHub answered at all. Absent means the request never got there. */
	status?: number;
}

/** GitHub's own sentence for a refusal, or a plain one when the body is not the API's JSON. */
function answerError(answer: GitHubAnswer): string {
	let detail = '';
	try {
		const parsed = JSON.parse(answer.body ?? '') as { message?: unknown };
		if (typeof parsed.message === 'string') {
			detail = parsed.message;
		}
	} catch {
		// Not the API's JSON; the status alone will have to do.
	}
	const status = answer.status ?? 0;
	if (status === 403 || status === 429) {
		const headers = answer.headers ?? {};
		const reset = Number(Array.isArray(headers['x-ratelimit-reset']) ? headers['x-ratelimit-reset'][0] : headers['x-ratelimit-reset']);
		const when = Number.isFinite(reset) && reset > 0 ? ` It resets at ${new Date(reset * 1000).toLocaleTimeString()}.` : '';
		return `GitHub refused the request (${status}${detail ? `: ${detail}` : ''}).${when} Type the repository address instead.`;
	}
	return `GitHub answered ${status}${detail ? `: ${detail}` : ''}. Type the repository address instead.`;
}

/** The repositories a path answers with. */
async function requestRepositories(path: string): Promise<RepositoryAnswer> {
	const answer = await githubRequest(path);
	if (answer.error !== undefined && answer.status === undefined) {
		return { items: [], error: `${answer.error} Type the repository address instead.` };
	}
	if (answer.status === 404) {
		return { items: [], missing: true, status: 404 };
	}
	if (answer.status !== 200) {
		return { items: [], status: answer.status, error: answerError(answer) };
	}
	try {
		const parsed = JSON.parse(answer.body ?? '') as { full_name?: unknown }[];
		return { items: parsed.map((entry) => String(entry.full_name ?? '')).filter((name) => name.length > 0) };
	} catch {
		return { items: [], error: 'GitHub answered something that is not a repository list.' };
	}
}

/**
 * The repositories an enterprise publishes, asked of the GitHub API.
 *
 * Best-effort by design: a machine behind a proxy, or offline, gets a sentence and keeps the typed field — loading a
 * list is a convenience, and a form that cannot be completed without a network call would be worse than one that can.
 */
function listRepositories(owner: string): Promise<{ items: string[]; error?: string }> {
	const clean = owner.trim()
		.replace(/^https?:\/\//i, '')
		.replace(/^www\./i, '')
		.replace(/^github\.com\//i, '')
		.replace(/[\/]+$/, '');
	if (clean.length === 0) {
		return Promise.resolve({ items: [], error: 'Type an enterprise name first, for example github.com/temcocontrols.' });
	}

	// An organisation first: an enterprise is usually one. A personal account is the fallback, not the default.
	return requestRepositories(`/orgs/${encodeURIComponent(clean)}/repos?per_page=100&sort=updated`).then(async (first) => {
		if (!first.missing) {
			return first;
		}
		const second = await requestRepositories(`/users/${encodeURIComponent(clean)}/repos?per_page=100&sort=updated`);
		return second.missing ? { items: [], error: `GitHub has no organisation or user called “${clean}”.` } : second;
	});
}

/** The owner and repository a GitHub address names, or undefined when it is not one. */
function githubAddress(location: string): { owner: string; repository: string } | undefined {
	const match = /^(?:https?:\/\/)?(?:www\.)?github\.com\/([^\/\s]+)\/([^\/\s]+?)(?:\.git)?\/?$/i.exec(location.trim());
	if (match === null) {
		return undefined;
	}
	return { owner: match[1], repository: match[2] };
}

/**
 * Whether a GitHub address exists: `yes`, `no`, or `unknown` when the answer cannot be had.
 *
 * Only a definite 404 refuses the address — a rate limit, a proxy failure or a machine that is offline must not
 * stop a person adding a source they know is there.
 */
async function githubRepository(location: string): Promise<'yes' | 'no' | 'unknown'> {
	const address = githubAddress(location);
	if (address === undefined) {
		return 'unknown';
	}
	const answer = await githubRequest(`/repos/${encodeURIComponent(address.owner)}/${encodeURIComponent(address.repository)}`);
	if (answer.status === 200) {
		return 'yes';
	}
	return answer.status === 404 ? 'no' : 'unknown';
}

/** Two locations are the same source when they differ only in case, a trailing slash, or a trailing `.git`. */
function sameLocation(left: string, right: string): boolean {
	const shape = (value: string): string => value.trim().replace(/[\\/]+$/, '').replace(/\.git$/i, '').toLowerCase();
	return left.trim().length > 0 && right.trim().length > 0 && shape(left) === shape(right);
}

/** The shape a location must have for its kind. The page checks this too; this is the authority. */
function locationProblem(kind: string, location: string): string | undefined {
	const value = location.trim();
	if (value.length === 0) {
		return 'A source needs a location.';
	}
	if (/\s/.test(value)) {
		return 'A location cannot contain spaces.';
	}
	if (kind === 'repo' && !isRepositoryAddress(value)) {
		return 'That is not a repository address — use https://github.com/owner/repo, or another Git URL.';
	}
	if (kind === 'document' && !isFileName(value)) {
		return 'That is not a document — a document is a file such as notes.pdf or spec.docx.';
	}
	return undefined;
}

/** A git-style URL, git's user@host:path form, or a bare github.com/owner/repo. */
function isRepositoryAddress(value: string): boolean {
	const lower = value.toLowerCase();
	for (const scheme of ['https://', 'http://', 'ssh://', 'git://']) {
		if (lower.startsWith(scheme)) {
			const rest = value.slice(scheme.length);
			return rest.length > 0 && (rest.includes('/') || rest.includes(':'));
		}
	}
	const at = value.indexOf('@');
	const colon = value.indexOf(':');
	if (at > 0 && colon > at + 1) {
		return value.length > colon + 1;
	}
	if (lower.startsWith('github.com/') || lower.startsWith('www.github.com/')) {
		const parts = lower.split('/');
		return parts.length >= 3 && parts[1].length > 0 && parts[2].length > 0;
	}
	return false;
}

/** Something with a short extension at the end: notes.pdf, spec.docx. */
function isFileName(value: string): boolean {
	const clean = value.split('?')[0];
	const dot = clean.lastIndexOf('.');
	if (dot < 1 || dot < clean.length - 9) {
		return false;
	}
	return /^[a-z0-9]+$/i.test(clean.slice(dot + 1));
}

/** The last path segment of a location — the name, and so the slug, the store keys a source by. */
function nameOf(location: string): string {
	return location.replace(/[\\/]+$/, '').split(/[\\/]/).pop() ?? location;
}

/**
 * Everything that can refuse a source, in the order a person would hit it: the shape of the address, an address
 * already recorded, then a GitHub repository that does not exist. Asked before the step advances and again on the
 * write, so a source cannot slip in behind a stale page.
 */
async function problemWith(values: Values, catalog: Catalog): Promise<string | undefined> {
	const location = values.location.trim();
	const shape = locationProblem(values.kind, location);
	if (shape !== undefined) {
		return shape;
	}
	const name = nameOf(location);
	// Two addresses whose last segment matches share a slug, and the store would overwrite one with the other.
	const existing = catalog.source(slugOf(name));
	if (existing !== undefined) {
		const recorded = existing.remoteUrl ?? existing.path ?? '';
		return sameLocation(recorded, location)
			? `${location} is already recorded as “${existing.name}”.`
			: `A source called “${existing.name}” already exists and points at ${recorded}.`;
	}
	const duplicate = catalog.sources().find((row) => {
		const detail = catalog.source(row.slug);
		return detail !== undefined && sameLocation(detail.remoteUrl ?? detail.path ?? '', location);
	});
	if (duplicate !== undefined) {
		return `${location} is already recorded as “${duplicate.name}”.`;
	}
	// A GitHub address GitHub has never heard of is a typo, not a source. Only a definite 404 refuses; an unknown
	// answer (offline, rate limit) lets it through.
	if (STORE_KIND[values.kind] === 'git' && (await githubRepository(location)) === 'no') {
		return `GitHub has no repository at ${location}. Check the address.`;
	}
	return undefined;
}

export class AddSourcePage {
	private panel: vscode.WebviewPanel | undefined;

	constructor(private readonly context: vscode.ExtensionContext) { }

	open(): void {
		remember(this.context, ADD_SOURCE_VIEW_TYPE);
		const body = html();
		if (this.panel) {
			this.panel.reveal(pageColumn());
			this.panel.webview.html = page(body, { title: 'Add Source', script: SCRIPT, extraCss: LOCAL_CSS });
			return;
		}
		const panel = vscode.window.createWebviewPanel(ADD_SOURCE_VIEW_TYPE, 'Add Source', pageColumn(), {
			enableScripts: true,
			localResourceRoots: []
		});
		this.panel = panel;
		panel.webview.onDidReceiveMessage((message: { type?: string; values?: Values }) => void this.receive(message));
		panel.webview.html = page(body, { title: 'Add Source', script: SCRIPT, extraCss: LOCAL_CSS });
		panel.onDidDispose(() => {
			this.panel = undefined;
		});
	}

	dispose(): void {
		this.panel?.dispose();
	}

	private async receive(message: FlowMessage): Promise<void> {
		if (message.type === 'cancel') {
			this.panel?.dispose();
			return;
		}
		// The location step asks before it advances, so a refusal is read where the address was typed.
		if (message.type === 'check' && message.values) {
			const error = await this.check(message.values);
			await this.panel?.webview.postMessage({ type: 'checked', error });
			return;
		}
		if (message.type === 'add' && message.values) {
			await this.add(message.values);
			return;
		}
		// A document or a folder is chosen, never typed: the editor's own dialog knows what is on this machine.
		if (message.type === 'browse') {
			const folder = message.kind === 'folder';
			const picked = await vscode.window.showOpenDialog({
				canSelectFiles: !folder,
				canSelectFolders: folder,
				canSelectMany: false,
				openLabel: folder ? 'Choose Folder' : 'Choose File',
				...(folder ? {} : { filters: { Documents: ['pdf', 'doc', 'docx', 'md', 'html', 'htm'], 'All files': ['*'] } })
			});
			const path = picked?.[0]?.fsPath;
			if (path !== undefined) {
				await this.panel?.webview.postMessage({ type: 'browsed', path });
			}
			return;
		}
		// The one lookup the location step can ask for. It is a convenience: a failure is a sentence, and the
		// address stays typed-in.
		if (message.type === 'repositories') {
			const answer = await listRepositories(String(message.owner ?? ''));
			await this.panel?.webview.postMessage({ type: 'repositories', items: answer.items, error: answer.error });
		}
	}

	/** Whether the location step may advance: everything that can refuse a source, asked without writing. */
	private async check(values: Values): Promise<string | undefined> {
		let catalog: Catalog | undefined;
		try {
			catalog = await Catalog.open(this.context);
			return await problemWith(values, catalog);
		} catch (error) {
			return error instanceof CatalogUnavailable ? error.message : String(error);
		} finally {
			catalog?.close();
		}
	}

	/** Records the source in the store, then shows the page it now appears on. */
	private async add(values: Values): Promise<void> {
		const location = values.location.trim();
		const name = nameOf(location);
		const kind = STORE_KIND[values.kind] ?? 'folder';
		let catalog: Catalog | undefined;
		try {
			catalog = await Catalog.open(this.context);
			const problem = await problemWith(values, catalog);
			if (problem !== undefined) {
				await this.panel?.webview.postMessage({ type: 'refused', error: problem });
				return;
			}
			catalog.addSource({
				kind,
				name,
				slug: slugOf(name),
				remoteUrl: kind === 'git' ? location : undefined,
				path: kind === 'git' ? undefined : location,
				branch: kind === 'git' && values.branch ? values.branch : undefined,
				defaultBranch: kind === 'git' && values.branch ? values.branch : undefined
			});
		} catch (error) {
			const message = error instanceof CatalogUnavailable ? error.message : String(error);
			await this.panel?.webview.postMessage({ type: 'refused', error: message });
			return;
		} finally {
			catalog?.close();
		}
		this.panel?.dispose();
		// The mock's third step is a promise: "read the source now, after it is added". Adding writes a row; the read
		// is what clones a repository and records the pages, so it is the read that makes the source useful.
		if (values.readNow) {
			void vscode.window.showInformationMessage(`${name} added — reading it now.`);
			await vscode.commands.executeCommand('temcoRepositories.readSource', slugOf(name));
		} else {
			void vscode.window.showInformationMessage(`${name} added. Read it from Sources when you are ready.`);
		}
		await vscode.commands.executeCommand('temcoProjects.editProject');
	}
}

const field = (label: string, control: string, hint?: string): string =>
	`<div class="field"><label>${esc(label)}</label>${control}${hint ? `<div class="field__hint">${esc(hint)}</div>` : ''}</div>`;

const choice = (kind: { value: string; label: string; desc: string }): string =>
	`<label class="choice"><input type="radio" name="kind" value="${esc(kind.value)}"${kind.value === DEFAULTS.kind ? ' checked' : ''}><span class="choice__text"><span class="choice__label">${esc(kind.label)}</span><span class="choice__desc">${esc(kind.desc)}</span></span></label>`;

const steps = ['Kind', 'Location', 'Read'];

/** The wizard's own layout: air around the note, and the repository list as a bounded, scrollable area. */
const LOCAL_CSS = `
.wizard__body .source-note { margin: 22px 0 24px; }
.repo-list { max-height: 240px; overflow-y: auto; }
.repo-list .checklist__row { cursor: pointer; }
.repo-list .checklist__row:has(input:checked) { background: color-mix(in srgb, var(--accent) 10%, var(--bg-inset)); }
.repo-list .checklist__row:has(input:checked) .checklist__title { color: var(--fg-strong); font-weight: 500; }
.field > label.check { font-weight: 400; color: var(--fg); }
/* One width for the two text fields: the enterprise name and the location it resolves to. */
.form .field > .input { width: 100%; max-width: 620px; }
/* The lookup sits under its own field, so the two text boxes line up exactly and nothing bulges the column. */
.form .field > .btn { align-self: flex-start; }
/* A location the person cannot type into is a picker: it reads muted and opens the dialog when clicked. */
.form .field > .input[readonly] { color: var(--fg-muted); cursor: pointer; }
.repo-status { margin-top: 6px; font-size: var(--fs-sm); line-height: 1.5; color: var(--fg-muted); }
.repo-status.is-error { color: var(--err); }
`;

function html(): string {
	const rail = steps.map((label, index) =>
		`${index > 0 ? '<span class="step__arrow" aria-hidden="true">→</span>' : ''}<button type="button" class="step${index === 0 ? ' is-active' : ''}" data-step="${index}" role="tab" aria-selected="${index === 0}"><span class="step__n">${index + 1}.</span><span class="step__label">${esc(label)}</span></button>`
	).join('');

	return `<div class="page-head">
	<div class="page-head__main">
		<div class="eyebrow">Documentation</div>
		<h1 class="page-head__title">${icon('repo')}Add Source</h1>
		<p class="page-head__desc">A source is somewhere documentation is read from: a repository, a document, or a folder.</p>
	</div>
	<div class="page-head__actions"><button type="button" class="btn btn--ghost" id="wizard-cancel">${icon('close')}<span>Cancel</span></button></div>
</div>

<div class="wizard">
	<div class="wizard__steps" role="tablist">${rail}</div>
	<div class="wizard__body">
		<div data-step-body="0">
			<div class="wizard__title">What kind of source?</div>
			<p class="wizard__hint">The kind decides how the platform reads it, and what it records.</p>
			<div class="checklist-heading">Repositories</div>
			<div class="choice-grid">${choice(KINDS[0])}</div>
			<div class="checklist-heading mt-16">Files and folders</div>
			<div class="choice-grid">${KINDS.slice(1).map(choice).join('')}</div>
		</div>
		<div data-step-body="1" hidden>
			<div class="wizard__title">Where is it?</div>
			<p class="wizard__hint" id="location-hint">The repository is cloned into the working area; nothing is pushed back.</p>
			<div class="source-note" data-when="repo"><div class="callout">${icon('info')}<div><b>An enterprise, then a repository.</b> Type <code>github.com/temcocontrols</code> and press <b>Load Repositories</b> to see what that enterprise publishes — choose one from the list and its address is filled in for you. Asking GitHub is optional: the address can also be typed by hand.</div></div></div>
			<div class="form">
				<div data-when="repo">${field('Enterprise', `<input class="input" data-field="enterprise" value="${esc(DEFAULTS.enterprise)}" aria-label="Enterprise"><button type="button" class="btn" id="load-repos">${icon('download')}<span>Load Repositories</span></button>`, 'The owner on GitHub — an enterprise, an organisation, or a personal account. A name such as temcocontrols works, or the full address github.com/temcocontrols.')}<div class="repo-status" id="repo-status" hidden></div></div>
				<div data-when="repo" id="repo-pick-wrap" hidden>${field('Repository', `<div class="checklist repo-list" id="repo-list" role="radiogroup" aria-label="Repositories"></div>`, 'Choose one of the repositories this enterprise publishes; the address is filled from it.')}</div>
				<div class="field">
					<label>Location</label>
					<input class="input" data-field="location" value="${esc(DEFAULTS.location)}" placeholder="https://github.com/temcocontrols/t3000webview" aria-label="Location">
					<button type="button" class="btn" id="browse" hidden>${icon('folder')}<span>Choose…</span></button>
					<div class="field__hint" id="location-note">A Git address such as https://github.com/temcocontrols/t3000webview.</div>
				</div><div class="repo-status" id="location-status" hidden></div>
				<div data-when="repo"><div class="field"><label>Branch</label><label class="check"><input type="checkbox" data-field="useMain" checked><span>Read from <code>main</code> — the branch almost every repository publishes its documentation from.</span></label><div class="field__hint">Untick it to let the repository decide which branch it reads.</div></div></div>
			</div>
		</div>
		<div data-step-body="2" hidden>
			<div class="wizard__title">Read it</div>
			<p class="wizard__hint">Reading records what the source contains. It is safe to repeat.</p>
			<dl class="kv" id="review"></dl>
			<label class="check" style="margin-top:14px"><input type="checkbox" data-field="readNow"${DEFAULTS.readNow ? ' checked' : ''}><span>Read the source now, after it is added</span></label>
			<div class="mt-16"><div class="callout">${icon('info')}<div>A source is never edited. The pages a read finds are recorded in the platform database; the source stays the only copy of its own content.</div></div></div>
		</div>
		<div class="wizard__error" id="wizard-error" hidden></div>
	</div>
	<div class="wizard__foot">
		<span class="cell-muted" style="font-size:12px" id="wizard-count">Step 1 of 3</span>
		<span class="wizard__spacer"></span>
		<button type="button" class="btn" id="wizard-back" hidden>${icon('chevron-left')}<span>Back</span></button>
		<button type="button" class="btn btn--primary" data-next="0">${icon('chevron-right')}<span>Next: Location</span></button>
		<button type="button" class="btn btn--primary" data-next="1" hidden>${icon('chevron-right')}<span>Next: Read</span></button>
		<button type="button" class="btn btn--primary" data-next="2" hidden>${icon('check')}<span>Add Source</span></button>
	</div>
</div>`;
}

/** Three steps, each with its own primary action, one lookup, and the values the module writes. */
const SCRIPT = `
(function () {
	const api = acquireVsCodeApi();
	const bodies = Array.prototype.slice.call(document.querySelectorAll('[data-step-body]'));
	const steps = Array.prototype.slice.call(document.querySelectorAll('.wizard__steps .step'));
	const error = document.getElementById('wizard-error');
	const count = document.getElementById('wizard-count');
	const back = document.getElementById('wizard-back');
	const actions = Array.prototype.slice.call(document.querySelectorAll('[data-next]'));
	const review = document.getElementById('review');
	const hint = document.getElementById('location-hint');
	const pickWrap = document.getElementById('repo-pick-wrap');
	const pickList = document.getElementById('repo-list');
	const loadRepos = document.getElementById('load-repos');
	const repoStatus = document.getElementById('repo-status');
	const locationStatus = document.getElementById('location-status');
	const locationNoteText = document.getElementById('location-note');
	const browse = document.getElementById('browse');
	const labels = { repo: 'Repository', document: 'Document', folder: 'Folder' };
	let at = 0;

	function element(name) { return document.querySelector('[data-field="' + name + '"]'); }
	function kind() { return (document.querySelector('input[name="kind"]:checked') || {}).value || 'repo'; }
	function values() {
		return {
			kind: kind(),
			location: element('location').value,
			branch: element('useMain').checked ? 'main' : '',
			readNow: element('readNow').checked
		};
	}
	function followKind() {
		const current = kind();
		const isRepo = current === 'repo';
		Array.prototype.forEach.call(document.querySelectorAll('[data-when="repo"]'), function (node) {
			node.hidden = !isRepo;
		});
		// The picker only exists once an enterprise has answered; until then it stays out of the way.
		if (pickWrap && pickWrap.getAttribute('data-loaded') !== 'yes') { pickWrap.hidden = true; }

		// The location control follows the kind: typed for a Git address, chosen for a file or a folder.
		const input = element('location');
		if (isRepo) {
			input.readOnly = false;
			input.placeholder = 'https://github.com/temcocontrols/t3000webview';
			if (browse) { browse.hidden = true; }
			if (locationNoteText) { locationNoteText.textContent = 'A Git address such as https://github.com/temcocontrols/t3000webview.'; }
			hint.textContent = 'The repository is cloned into the working area; nothing is pushed back.';
		} else if (current === 'document') {
			input.readOnly = true;
			input.placeholder = 'No file chosen';
			if (browse) { browse.hidden = false; browse.querySelector('span').textContent = 'Choose a File…'; }
			if (locationNoteText) { locationNoteText.textContent = 'A PDF or Word file on this machine.'; }
			hint.textContent = 'The file is read as it is; nothing is copied or changed.';
		} else {
			input.readOnly = true;
			input.placeholder = 'No folder chosen';
			if (browse) { browse.hidden = false; browse.querySelector('span').textContent = 'Choose a Folder…'; }
			if (locationNoteText) { locationNoteText.textContent = 'A folder of Markdown or HTML files.'; }
			hint.textContent = 'Every Markdown or HTML file under the folder is read; nothing is written into it.';
		}
	}
	function locationProblem(v) {
		const value = (v.location || '').trim();
		if (!value) { return 'A source needs a location.'; }
		if (value.split(' ').length > 1 || value.indexOf(String.fromCharCode(9)) >= 0) {
			return 'A location cannot contain spaces.';
		}
		if (v.kind === 'repo' && !repositoryAddress(value)) {
			return 'That is not a repository address — use https://github.com/owner/repo, or another Git URL.';
		}
		if (v.kind === 'document' && !fileName(value)) {
			return 'That is not a document — a document is a file such as notes.pdf or spec.docx.';
		}
		return '';
	}
	// A git-style URL, git's user@host:path form, or a bare github.com/owner/repo. A lone word is not one.
	function repositoryAddress(value) {
		const lower = value.toLowerCase();
		const schemes = ['https://', 'http://', 'ssh://', 'git://'];
		for (let i = 0; i < schemes.length; i++) {
			if (lower.indexOf(schemes[i]) === 0) {
				const rest = value.slice(schemes[i].length);
				return rest.length > 0 && (rest.indexOf('/') >= 0 || rest.indexOf(':') >= 0);
			}
		}
		const at = value.indexOf('@');
		const colon = value.indexOf(':');
		if (at > 0 && colon > at + 1) { return value.length > colon + 1; }
		if (lower.indexOf('github.com/') === 0 || lower.indexOf('www.github.com/') === 0) {
			const parts = lower.split('/');
			return parts.length >= 3 && parts[1].length > 0 && parts[2].length > 0;
		}
		return false;
	}
	// Something with a short extension at the end: notes.pdf, spec.docx.
	function fileName(value) {
		const clean = value.split('?')[0];
		const dot = clean.lastIndexOf('.');
		if (dot < 1 || dot < clean.length - 9) { return false; }
		const ext = clean.slice(dot + 1).toLowerCase();
		if (!ext.length) { return false; }
		for (let i = 0; i < ext.length; i++) {
			const code = ext.charCodeAt(i);
			if (!((code >= 97 && code <= 122) || (code >= 48 && code <= 57))) { return false; }
		}
		return true;
	}
	function fail(message) { error.textContent = message; error.hidden = false; error.scrollIntoView({ block: 'nearest' }); }
	function clear() { error.hidden = true; }
	/** A problem with the location belongs under the location, not at the foot of the wizard. */
	function locationFail(message) {
		if (!locationStatus) { fail(message); return; }
		locationStatus.hidden = !message;
		locationStatus.textContent = message || '';
		locationStatus.classList.toggle('is-error', !!message);
		if (message) { locationStatus.scrollIntoView({ block: 'nearest' }); }
	}
	/** The same line, for news rather than a refusal: "Checking …". */
	function locationNote(message) {
		if (!locationStatus) { return; }
		locationStatus.hidden = !message;
		locationStatus.textContent = message || '';
		locationStatus.classList.remove('is-error');
	}
	function actionButton(step) { return document.querySelector('[data-next="' + step + '"]'); }
	function show() {
		steps.forEach(function (step, index) {
			step.classList.toggle('is-active', index === at);
			step.classList.toggle('is-done', index < at);
			step.setAttribute('aria-selected', String(index === at));
		});
		bodies.forEach(function (body, index) { body.hidden = index !== at; });
		count.textContent = 'Step ' + (at + 1) + ' of ' + bodies.length;
		back.hidden = at === 0;
		// Each step shows its own primary action, so each can carry its own rule.
		actions.forEach(function (button) { button.hidden = Number(button.getAttribute('data-next')) !== at; });
		followKind();
		if (at === 2) {
			const v = values();
			review.innerHTML = [
				['Kind', labels[v.kind] || v.kind],
				['Location', '<span class="cell-mono">' + v.location + '</span>'],
				['Branch', v.kind === 'repo' ? '<span class="cell-mono">' + (v.branch || 'repository default') + '</span>' : '—']
			].map(function (pair) { return '<dt>' + pair[0] + '</dt><dd>' + pair[1] + '</dd>'; }).join('');
		}
	}
	function go(to) { clear(); at = to; show(); }

	steps.forEach(function (step) { step.addEventListener('click', function () { go(Number(step.dataset.step)); }); });
	back.addEventListener('click', function () { go(Math.max(0, at - 1)); });

	// One action per step: Kind needs no check, Location asks the host before it advances, Read writes.
	const advance = {
		0: function () { go(1); },
		1: function () {
			const problem = locationProblem(values());
			if (problem) { locationFail(problem); return; }
			// The shape is fine; the address itself is checked where the store and the network are.
			const button = actionButton(1);
			if (button) { button.disabled = true; }
			locationNote('Checking ' + values().location.trim() + '…');
			api.postMessage({ type: 'check', values: values() });
		},
		2: function () {
			const problem = locationProblem(values());
			if (problem) { go(1); locationFail(problem); return; }
			const button = actionButton(2);
			if (button) { button.disabled = true; }
			api.postMessage({ type: 'add', values: values() });
		}
	};
	actions.forEach(function (button) {
		button.addEventListener('click', function () { advance[button.getAttribute('data-next')](); });
	});
	document.getElementById('wizard-cancel').addEventListener('click', function () { api.postMessage({ type: 'cancel' }); });
	document.addEventListener('change', function (event) {
		if (event.target && event.target.name === 'kind') { followKind(); }
	});
	document.addEventListener('input', function (event) {
		if (event.target && event.target.getAttribute('data-field') === 'location') { clear(); locationFail(''); }
	});

	function status(text, isError) {
		if (!repoStatus) { return; }
		repoStatus.hidden = !text;
		repoStatus.textContent = text || '';
		repoStatus.classList.toggle('is-error', !!isError);
	}

	function askRepositories() {
		const owner = (element('enterprise').value || '').trim();
		if (!owner) { status('Type an enterprise first, for example temcocontrols.', true); return; }
		clear();
		status('Asking github.com what ' + owner + ' publishes…');
		loadRepos.disabled = true;
		loadRepos.querySelector('span').textContent = 'Loading…';
		api.postMessage({ type: 'repositories', owner: owner });
	}

	if (loadRepos) { loadRepos.addEventListener('click', askRepositories); }
	if (browse) {
		browse.addEventListener('click', function () { api.postMessage({ type: 'browse', kind: kind() }); });
	}
	// When the box cannot be typed into, it is a picker: clicking it opens the same dialog.
	document.addEventListener('click', function (event) {
		const target = event.target;
		if (target && target.readOnly && target.getAttribute && target.getAttribute('data-field') === 'location') {
			api.postMessage({ type: 'browse', kind: kind() });
		}
	});
	if (pickList) {
		pickList.addEventListener('change', function (event) {
			if (event.target && event.target.name === 'repoPick') { choose(event.target.value); }
		});
	}

	function choose(name) {
		if (!name) { return; }
		element('location').value = 'https://github.com/' + name;
		clear();
	}

	window.addEventListener('message', function (event) {
		const message = event.data || {};
		if (message.type === 'checked') {
			const button = actionButton(1);
			if (button) { button.disabled = false; }
			if (message.error) { locationFail(message.error); return; }
			locationNote('');
			go(2);
			return;
		}
		if (message.type === 'refused') {
			const button = actionButton(2);
			if (button) { button.disabled = false; }
			go(1);
			locationFail(message.error);
			return;
		}
		if (message.type === 'browsed') {
			element('location').value = message.path;
			clear();
			locationFail('');
			return;
		}
		if (message.type === 'repositories') {
			if (loadRepos) {
				loadRepos.disabled = false;
				loadRepos.querySelector('span').textContent = 'Load Repositories';
			}
			if (message.error) { status(message.error, true); return; }
			const items = message.items || [];
			if (!items.length) { status('That enterprise returned no repositories.', true); return; }
			const picked = document.querySelector('input[name="repoPick"]:checked');
			const previous = picked ? picked.value : '';
			pickList.innerHTML = '';
			items.forEach(function (name, index) {
				const row = document.createElement('label');
				row.className = 'checklist__row';
				const radio = document.createElement('input');
				radio.type = 'radio';
				radio.name = 'repoPick';
				radio.value = name;
				radio.checked = previous ? name === previous : index === 0;
				const text = document.createElement('span');
				text.className = 'checklist__text';
				const title = document.createElement('span');
				title.className = 'checklist__title';
				title.textContent = name;
				const sub = document.createElement('span');
				sub.className = 'checklist__sub';
				sub.textContent = 'github.com/' + name;
				text.appendChild(title);
				text.appendChild(sub);
				row.appendChild(radio);
				row.appendChild(text);
				pickList.appendChild(row);
			});
			pickWrap.setAttribute('data-loaded', 'yes');
			pickWrap.hidden = kind() !== 'repo';
			status(items.length === 1 ? '1 repository — choose it below.' : items.length + ' repositories — choose one below.');
			choose(items.indexOf(previous) >= 0 ? previous : items[0]);
			return;
		}
	});

	show();
})();
`;
