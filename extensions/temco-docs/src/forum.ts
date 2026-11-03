/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Temco Controls. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

// *Forum* — the community forum, as the platform reads it: categories, the topics in each, and the conversation inside
// one, with what the documentation should do about it.
//
// The forum is `forums.temcocontrols.com`, and it is read the way a reader uses it:
//
//   **the panel**   the categories, in the site's own order, with how many topics each holds.
//   **the page**    one category's topics, in the site's own table: title, who is in it, replies, views, last activity.
//   **the topic**   one thread as a tab — the discussion history, the page it is about, and a suggestion.
//
// Everything is read from the catalog (`forum_categories`, `forum_topics`, `forum_posts`, `forum_suggestions`), which a
// sync fills from the site; no surface talks to the network and no view parses JSON. Nothing is ever posted, replied to
// or liked from here: the community site owns the conversation, and this is the reading side of it.

import * as vscode from 'vscode';
import { categoryUrl, latestUrl, readCategories, readCategoryTopics, readLatestTopics, readTopic, topicUrl } from './forumSource';
import { DocsRoot, PageEntry, collectPages } from './registry';
import { Catalog, ForumCategoryRow, ForumPostRow, ForumTopicRow, selection } from './store';
import { commandScript, escapeHtml as esc, hero, icon, numbers, page, pageColumn, runCommand, section } from './ui';

export const FORUM_VIEW_ID = 'temcoDocs.forum';
export const FORUM_PAGE_TYPE = 'temcoDocs.forumPage';
const TOPIC_TYPE = 'temcoDocs.forumTopic';

/** A topic that has sat unanswered this long is called out rather than left in the table. */
const AGING_DAYS = 30;

/** What the panel paints: the categories, and when they were last read. */
interface ForumFacts {
	categories: ForumCategoryRow[];
	syncedAt?: string;
}

/** What the tree draws. A node is what it is, rather than a label the module has to parse back. */
type ForumNode =
	| { kind: 'topics' }
	| { kind: 'categories' }
	| { kind: 'category'; category: ForumCategoryRow }
	| { kind: 'all' }
	| { kind: 'empty' };

/** Reads the categories out of the catalog — the only thing the panel needs. */
async function facts(context: vscode.ExtensionContext): Promise<ForumFacts> {
	let catalog: Catalog | undefined;
	try {
		catalog = await Catalog.open(context);
		return { categories: catalog.forumCategories(), syncedAt: catalog.forumSyncedAt() };
	} catch {
		// No catalog, no forum: an empty list says so without an error nobody can act on.
		return { categories: [] };
	} finally {
		catalog?.close();
	}
}

/**
 * Reads the forum's categories, and the topics of one category when a category is named.
 *
 * Returns the sentence to show when something went wrong, or nothing when everything was read.
 */
export async function syncForum(
	context: vscode.ExtensionContext,
	category?: { id: number; slug: string }
): Promise<string | undefined> {
	let catalog: Catalog | undefined;
	try {
		catalog = await Catalog.open(context);
		const categories = await readCategories();
		if (!categories.ok) {
			return categories.note;
		}
		catalog.saveForumCategories(categories.body);
		// *All topics* is the site's own Topics list — one answer across every category — and a category is that
		// category's own table. Either way the topics land in the same rows the page reads.
		const topics = category === undefined ? await readLatestTopics() : await readCategoryTopics(category);
		if (!topics.ok) {
			return topics.note;
		}
		catalog.saveForumTopics(topics.body);
		return undefined;
	} catch (error) {
		return messageOf(error);
	} finally {
		catalog?.close();
	}
}

/** Reads one topic's posts, so its tab has the conversation and not only the title. */
async function syncTopic(context: vscode.ExtensionContext, topic: { id: number; slug: string }): Promise<string | undefined> {
	let catalog: Catalog | undefined;
	try {
		catalog = await Catalog.open(context);
		const answer = await readTopic(topic);
		if (!answer.ok) {
			return answer.note;
		}
		// A topic page carries the posts and the counters, but not the participants or the excerpt the list read
		// recorded: those are kept, so opening a topic does not empty the table it was opened from.
		const listed = catalog.forumTopics().find((candidate) => candidate.id === answer.body.topic.id);
		catalog.saveForumTopics([
			{ ...answer.body.topic, posters: (answer.body.topic.posters ?? []).length > 0 ? answer.body.topic.posters : listed?.posters ?? [], excerpt: answer.body.topic.excerpt ?? listed?.excerpt }
		]);
		catalog.saveForumPosts(answer.body.topic.id, answer.body.posts);
		return undefined;
	} catch (error) {
		return messageOf(error);
	} finally {
		catalog?.close();
	}
}

/**
 * The panel: a native tree, so VS Code draws it.
 *
 * This is the same control the Pages, Publish and AI views use — row height, selection, keyboard navigation, the
 * twistie, high contrast and screen-reader support all come from the workbench rather than from markup this module
 * writes. The shape is the forum's own navigation: *Topics* first, then **Categories**, each category with the forum's
 * colour and how many topics it holds, and *All categories* at the end.
 *
 * The colours are the site's, which a `ThemeIcon` cannot carry, so each category gets a 16px square written once into
 * the extension's storage and handed to the tree as an icon path.
 */
export class ForumTree implements vscode.TreeDataProvider<ForumNode> {
	private readonly changed = new vscode.EventEmitter<ForumNode | undefined | void>();
	readonly onDidChangeTreeData = this.changed.event;
	private view: vscode.TreeView<ForumNode> | undefined;
	private state: ForumFacts = { categories: [] };
	/** One file per category colour, written once. */
	private readonly squares = new Map<string, vscode.Uri>();
	/** One node per category, kept between paints: `reveal` finds an element by identity. */
	private readonly nodes = new Map<number, ForumNode>();
	/** The three fixed rows, also kept: a group rebuilt per call would not be the group the tree knows. */
	private readonly topicsNode: ForumNode = { kind: 'topics' };
	private readonly groupNode: ForumNode = { kind: 'categories' };
	private readonly allNode: ForumNode = { kind: 'all' };
	private readonly emptyNode: ForumNode = { kind: 'empty' };

	constructor(private readonly context: vscode.ExtensionContext) { }

	/** Puts the view in the side bar. Called once, from `activate`. */
	register(): vscode.Disposable {
		this.view = vscode.window.createTreeView(FORUM_VIEW_ID, {
			treeDataProvider: this,
			showCollapseAll: false
		});
		void this.refresh();
		return this.view;
	}

	/** Reads the catalog again and repaints. The only thing that changes the list. */
	async refresh(): Promise<void> {
		this.state = await facts(this.context);
		// One node object per category, reused until the next read: the tree finds an element by identity, so a node
		// rebuilt on every `getChildren` could never be revealed or selected.
		this.nodes.clear();
		for (const category of this.state.categories) {
			this.nodes.set(category.id, { kind: 'category', category });
		}
		this.changed.fire();
	}

	/** Marks the category that is open, with the tree's own selection rather than a colour of our own. */
	async select(categoryId: number | undefined): Promise<void> {
		const node = categoryId === undefined ? undefined : this.nodes.get(categoryId);
		if (this.view === undefined || node === undefined) {
			return;
		}
		await this.view.reveal(node, { select: true, focus: false, expand: true });
	}

	getParent(node: ForumNode): ForumNode | undefined {
		return node.kind === 'category' || node.kind === 'all' ? this.groupNode : undefined;
	}

	async getChildren(node?: ForumNode): Promise<ForumNode[]> {
		if (node === undefined) {
			return this.state.categories.length === 0 ? [this.emptyNode] : [this.topicsNode, this.groupNode];
		}
		if (node.kind === 'categories') {
			const rows = this.state.categories.map((category) => this.nodes.get(category.id) ?? { kind: 'category' as const, category });
			return [...rows, this.allNode];
		}
		return [];
	}

	async getTreeItem(node: ForumNode): Promise<vscode.TreeItem> {
		switch (node.kind) {
			case 'topics': {
				const item = new vscode.TreeItem('Topics', vscode.TreeItemCollapsibleState.None);
				item.id = 'topics';
				item.iconPath = new vscode.ThemeIcon('layers');
				item.tooltip = this.state.syncedAt === undefined ? 'The forum has not been read yet' : `Read ${this.state.syncedAt.slice(0, 10)}`;
				item.command = { command: 'temcoDocs.forumPage', title: 'Topics' };
				return item;
			}
			case 'categories': {
				const item = new vscode.TreeItem('Categories', vscode.TreeItemCollapsibleState.Expanded);
				item.id = 'categories';
				item.contextValue = 'categories';
				return item;
			}
			case 'category': {
				const item = new vscode.TreeItem(node.category.name, vscode.TreeItemCollapsibleState.None);
				item.id = `category:${node.category.id}`;
				item.description = String(node.category.topics);
				item.tooltip = `${node.category.name} — ${node.category.topics} topics`;
				item.iconPath = await this.square(node.category.color);
				item.command = {
					command: 'temcoDocs.forumCategory',
					title: node.category.name,
					arguments: [{ id: node.category.id, slug: node.category.slug }]
				};
				return item;
			}
			case 'all': {
				const item = new vscode.TreeItem('All categories', vscode.TreeItemCollapsibleState.None);
				item.id = 'all';
				item.iconPath = new vscode.ThemeIcon('list-flat');
				item.tooltip = 'Every topic, in every category';
				item.command = { command: 'temcoDocs.forumPage', title: 'All categories' };
				return item;
			}
			case 'empty': {
				const item = new vscode.TreeItem('Nothing read yet', vscode.TreeItemCollapsibleState.None);
				item.id = 'empty';
				item.description = 'Read the forum';
				item.iconPath = new vscode.ThemeIcon('sync');
				item.tooltip = 'Ask the forum for its categories. Nothing is posted.';
				item.command = { command: 'temcoDocs.forumSync', title: 'Read the forum' };
				return item;
			}
		}
	}

	/** A 16px square in the category's own colour, written once per colour into this extension's storage. */
	private async square(color: string | undefined): Promise<vscode.Uri | vscode.ThemeIcon> {
		if (color === undefined) {
			return new vscode.ThemeIcon('circle-filled');
		}
		const cached = this.squares.get(color);
		if (cached !== undefined) {
			return cached;
		}
		const folder = vscode.Uri.joinPath(this.context.globalStorageUri, 'forum');
		await vscode.workspace.fs.createDirectory(folder);
		const file = vscode.Uri.joinPath(folder, `square-${color.replace(/[^0-9a-f]/gi, '').toLowerCase()}.svg`);
		try {
			await vscode.workspace.fs.stat(file);
		} catch {
			const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 16 16"><rect x="1.5" y="1.5" width="13" height="13" rx="3" fill="${color}"/></svg>`;
			await vscode.workspace.fs.writeFile(file, Buffer.from(svg, 'utf8'));
		}
		this.squares.set(color, file);
		return file;
	}
}

/** One topic, opened for reading: its posts, the page it is about, and a suggestion. */
export class TopicPage {
	private readonly panels = new Map<number, vscode.WebviewPanel>();

	constructor(private readonly context: vscode.ExtensionContext, private readonly roots: () => readonly DocsRoot[]) { }

	async open(topic: { id: number; slug: string; title: string }): Promise<void> {
		const existing = this.panels.get(topic.id);
		if (existing !== undefined) {
			// A page of ours is a tab in the one group our pages live in, never a split: revealing with that column
			// also heals a tab a previous layout left in a second group.
			existing.reveal(pageColumn(), true);
			await this.render(topic);
			return;
		}
		// The thread is another tab beside the topics page, in the same strip — not a second editor group.
		const panel = vscode.window.createWebviewPanel(TOPIC_TYPE, topic.title, pageColumn(), {
			enableScripts: true,
			localResourceRoots: []
		});
		panel.iconPath = new vscode.ThemeIcon('comment-discussion');
		panel.onDidDispose(() => this.panels.delete(topic.id));
		panel.webview.onDidReceiveMessage(runCommand);
		this.panels.set(topic.id, panel);
		await this.render(topic);
	}

	/** Reads the conversation again and repaints — after a sync, or when a suggestion was just written. */
	async render(topic: { id: number; slug: string; title: string }): Promise<void> {
		const panel = this.panels.get(topic.id);
		if (panel === undefined) {
			return;
		}
		let catalog: Catalog | undefined;
		try {
			catalog = await Catalog.open(this.context);
			// Nothing cached for this topic yet: read it once, so the tab always shows the conversation rather than a
			// request for one.
			if (catalog.forumPosts(topic.id).length === 0) {
				catalog.close();
				catalog = undefined;
				await syncTopic(this.context, topic);
				catalog = await Catalog.open(this.context);
			}
			const row = catalog.forumTopics().find((candidate) => candidate.id === topic.id);
			const posts = catalog.forumPosts(topic.id);
			const named = row === undefined ? undefined : pageFor(row, this.roots());
			// The category is the page's own name for what it is showing; the site's address is not a name.
			const categoryName = row === undefined ? undefined : catalog.forumCategories().find((candidate) => candidate.id === row.categoryId)?.name;
			let suggestion = catalog.forumSuggestion(topic.id);
			// The platform's own answer is recorded the first time a topic is read, so the tab never shows "nothing"
			// when the project can already say which page the topic is about. The model's answer replaces it later.
			if (suggestion === undefined && row !== undefined) {
				catalog.saveForumSuggestion({
					topicId: row.id,
					pageId: named?.id,
					pageTitle: named?.title,
					text: draftSuggestion(row, named, posts),
					source: 'match'
				});
				suggestion = catalog.forumSuggestion(topic.id);
			}
			if (this.panels.get(topic.id) !== panel) {
				return;
			}
			const title = row?.title ?? topic.title;
			panel.title = title;
			panel.webview.html = page(topicBody({ topic: row ?? virtualTopic(topic), posts, named, suggestion, categoryName }), {
				title,
				script: commandScript,
				extraCss: FORUM_CSS
			});
		} finally {
			catalog?.close();
		}
	}

	dispose(): void {
		for (const panel of this.panels.values()) {
			panel.dispose();
		}
		this.panels.clear();
	}
}

/**
 * The page: one category's topics, in the forum's own table.
 *
 * Title, who is in it, replies, views, last activity — the five columns the site shows, because that is the shape a
 * person already knows how to read. A row opens the topic beside the page; the header reads the category again.
 */
export class TopicListPage {
	private panel: vscode.WebviewPanel | undefined;
	private categoryId: number | undefined;
	private categories: ForumCategoryRow[] = [];

	constructor(private readonly context: vscode.ExtensionContext) { }

	/** The categories the page names in its own heading — the panel has them already, so it hands them over. */
	syncCategories(categories: readonly ForumCategoryRow[]): void {
		this.categories = [...categories];
		if (this.panel !== undefined) {
			void this.render();
		}
	}

	/** Which category is open, so the panel can mark it the way the forum's own column does. */
	current(): number | undefined {
		return this.categoryId;
	}

	async open(categoryId?: number): Promise<void> {
		this.categoryId = categoryId;
		if (this.panel !== undefined) {
			this.panel.reveal(pageColumn());
			await this.render();
			return;
		}
		this.panel = vscode.window.createWebviewPanel(FORUM_PAGE_TYPE, 'Forum — Topics', pageColumn(), {
			enableScripts: true,
			localResourceRoots: []
		});
		this.panel.iconPath = new vscode.ThemeIcon('comment-discussion');
		this.panel.onDidDispose(() => {
			this.panel = undefined;
		});
		this.panel.webview.onDidReceiveMessage(runCommand);
		await this.render();
	}

	/** Repaint after a sync, when the page is the surface that asked for it. */
	async refresh(): Promise<void> {
		await this.render();
	}

	private async render(): Promise<void> {
		const panel = this.panel;
		if (panel === undefined) {
			return;
		}
		let catalog: Catalog | undefined;
		try {
			catalog = await Catalog.open(this.context);
			if (this.categories.length === 0) {
				this.categories = catalog.forumCategories();
			}
			const topics = catalog.forumTopics(this.categoryId);
			const syncedAt = catalog.forumSyncedAt();
			const category = this.categories.find((candidate) => candidate.id === this.categoryId);
			if (this.panel !== panel) {
				return;
			}
			const title = category === undefined ? 'Forum — Topics' : `Forum — ${category.name}`;
			panel.title = title;
			panel.webview.html = page(
				topicListBody({ topics, category, categories: this.categories, syncedAt, project: selection.project() }),
				{ title, script: commandScript, extraCss: FORUM_CSS }
			);
		} finally {
			catalog?.close();
		}
	}

	dispose(): void {
		this.panel?.dispose();
		this.panel = undefined;
	}
}

/**
 * Opens the forum in the browser.
 *
 * Only an `http(s)` address is opened: a command can be called with anything, and a URL from a forum row is data.
 */
export async function openForum(url: unknown): Promise<void> {
	if (typeof url !== 'string' || !/^https?:\/\//i.test(url)) {
		void vscode.window.showWarningMessage('Temco Docs: that is not a forum address this window will open.');
		return;
	}
	await vscode.env.openExternal(vscode.Uri.parse(url));
}

/** Puts a page's own text — an address, a command — on the clipboard, so it can be pasted somewhere it is needed. */
export async function copyText(text: unknown): Promise<void> {
	if (typeof text !== 'string' || text.length === 0) {
		return;
	}
	await vscode.env.clipboard.writeText(text);
	void vscode.window.setStatusBarMessage('Temco Docs: copied to the clipboard.', 3000);
}

/**
 * What the documentation should do about a topic, as the project and then the model propose it.
 *
 * The project's own answer is written first and always — what the thread asks, the page it names, that page's state,
 * and how long the thread has waited — so the button does something whether or not a model is running. When the model
 * answers, its sentence replaces that draft and is stored as the model's, so the tab, and whoever opens it next, sees
 * the answer without asking again.
 */
export async function suggestForTopic(
	context: vscode.ExtensionContext,
	roots: () => readonly DocsRoot[],
	topics: TopicPage,
	payload: unknown
): Promise<void> {
	const request = (payload ?? {}) as { id?: unknown };
	if (typeof request.id !== 'number') {
		return;
	}
	let catalog: Catalog | undefined;
	try {
		catalog = await Catalog.open(context);
		const topic = catalog.forumTopics().find((candidate) => candidate.id === request.id);
		if (topic === undefined) {
			void vscode.window.showWarningMessage(`Temco Docs: topic ${request.id} is not in the last read of the forum.`);
			return;
		}
		const named = pageFor(topic, roots());
		const posts = catalog.forumPosts(topic.id);
		const opened = { id: topic.id, slug: topic.slug, title: topic.title };
		// Painted before the model is asked: a suggestion appears at once, and stays even if the model never answers.
		catalog.saveForumSuggestion({
			topicId: topic.id,
			pageId: named?.id,
			pageTitle: named?.title,
			text: draftSuggestion(topic, named, posts),
			source: 'match'
		});
		await topics.render(opened);

		const busy = vscode.window.setStatusBarMessage('$(sync~spin) Temco Docs: asking the AI about this topic…');
		let text = '';
		try {
			const answer = await vscode.commands.executeCommand<string | undefined>('temcoAi.suggestTopic', {
				title: topic.title,
				excerpt: topic.excerpt ?? '',
				thread: posts
					.slice(0, 4)
					.map((post) => `${post.username ?? 'someone'}: ${plainText(post.cooked ?? '')}`)
					.join('\n\n'),
				pageId: named?.id,
				pageTitle: named?.title,
				url: topicUrl({ id: topic.id, slug: topic.slug })
			});
			text = typeof answer === 'string' ? answer.trim() : '';
		} catch (error) {
			// The AI module is not installed, or its command is gone: there is no panel to explain anything, so this is
			// the one path that has to say it here.
			void vscode.window.showWarningMessage(
				`Temco Docs: the AI is not available (${messageOf(error)}), so the suggestion above comes from this project's own pages.`
			);
			return;
		} finally {
			busy.dispose();
		}
		// Empty means no model answered — and the panel it opened already said so, in its own words, where the question
		// was asked. The draft above stands as the suggestion, which is why this says nothing more.
		if (text.length === 0) {
			return;
		}
		catalog.saveForumSuggestion({ topicId: topic.id, pageId: named?.id, pageTitle: named?.title, text, source: 'ai' });
		await topics.render(opened);
	} catch (error) {
		void vscode.window.showWarningMessage(`Temco Docs: ${messageOf(error)}.`);
	} finally {
		catalog?.close();
	}
}

/** A topic that was opened before it was read, so the tab has something to draw while the read lands. */function virtualTopic(topic: { id: number; slug: string; title: string }): ForumTopicRow {	return {
		id: topic.id,
		categoryId: 0,
		slug: topic.slug,
		title: topic.title,
		posts: 0,
		replies: 0,
		views: 0,
		pinned: false,
		closed: false,
		posters: []
	};
}

/** The page a topic is about: its id in the title or the excerpt, else its title. */
function pageFor(topic: ForumTopicRow, roots: readonly DocsRoot[]): PageEntry | undefined {
	const text = `${topic.title}\n${topic.excerpt ?? ''}`;
	const pages = roots.flatMap((root) => collectPages(root)).filter((candidate) => candidate.exists);
	// Longest id first, so `data-points-api` wins over `data` rather than every topic landing on the shortest page.
	for (const id of pages.map((candidate) => candidate.id).sort((a, b) => b.length - a.length)) {
		if (id.length < 4) {
			continue;
		}
		if (new RegExp(`(^|[^a-z0-9-])${escapeRegExp(id)}([^a-z0-9-]|$)`, 'i').test(text)) {
			return pages.find((candidate) => candidate.id === id);
		}
	}
	const lower = text.toLowerCase();
	return pages.find((candidate) => candidate.title.length >= 8 && lower.includes(candidate.title.toLowerCase()));
}

/** The thread's own words, as one sentence: what it asks, before anything is said about pages. */
function askLine(topic: ForumTopicRow, posts: readonly ForumPostRow[]): string {
	const source = topic.excerpt !== undefined && topic.excerpt.trim().length > 0
		? topic.excerpt
		: posts.length === 0 ? '' : plainText(posts[0].cooked ?? '');
	// A post is markup read as text and an excerpt is the site's own plain text: both are quoted rather than trusted.
	const text = plainText(source).replace(/\s+/g, ' ').trim();
	if (text.length === 0) {
		return '';
	}
	const stop = text.search(/[.!?](\s|$)/);
	const sentence = stop === -1 ? text : text.slice(0, stop + 1);
	return sentence.length <= 160 ? sentence : `${sentence.slice(0, 157).replace(/[\s,;:]+$/, '')}…`;
}

/**
 * What the project can say about a topic with no model at all.
 *
 * Three sentences, each one from the registry or the thread itself — what was asked, the page the thread names and
 * that page's state, and whether the answer is owed to the documentation. It never claims what the page says: this
 * module has not read the page's words.
 */
function draftSuggestion(topic: ForumTopicRow, named: PageEntry | undefined, posts: readonly ForumPostRow[]): string {
	const sentences: string[] = [];
	const ask = askLine(topic, posts);
	if (ask.length > 0) {
		sentences.push(`The thread asks: ${ask}`);
	}
	if (named === undefined) {
		sentences.push('No page in this project is named by the thread, so either the page is missing or its title does not use the thread\'s words.');
	} else {
		const state = named.reviewed === null ? 'has never been reviewed' : `was last reviewed ${named.reviewed}`;
		sentences.push(`${named.title} (${named.id}) is the page it names, and that page ${state}${named.provenance?.stale === true ? ', with code that has moved since' : ''}.`);
	}
	const days = ageDays(topic.lastPostedAt ?? topic.createdAt);
	if (topic.replies === 0 && !topic.closed) {
		sentences.push(days >= AGING_DAYS
			? `Nobody has answered in ${days} days, so the answer belongs in the documentation rather than in the thread.`
			: 'Nobody has answered yet, so the answer belongs in the documentation rather than in the thread.');
	} else if (named !== undefined) {
		sentences.push('Draft the change into that page rather than answering only in the thread.');
	}
	return sentences.join(' ');
}

/** A date as the forum shows it: the month and the year. */
function when(value: string | undefined): string {
	if (value === undefined) {
		return '';
	}
	const parsed = Date.parse(value);
	if (Number.isNaN(parsed)) {
		return '';
	}
	return new Date(parsed).toLocaleDateString('en-US', { month: 'short', year: 'numeric' });
}

/** Views the way the forum abbreviates them: 1.1k rather than 1103. */
function reads(count: number): string {
	return count >= 1000 ? `${(count / 1000).toFixed(1)}k` : String(count);
}

/** Days since a date, for the "waiting" marks. */
function ageDays(value: string | undefined): number {
	if (value === undefined) {
		return 0;
	}
	const parsed = Date.parse(value);
	return Number.isNaN(parsed) ? 0 : Math.max(0, Math.round((Date.now() - parsed) / 86_400_000));
}

/**
 * The page's own rules, in the page kit's tokens — what the forum has that the kit does not: the faces of the people
 * in a thread, and the shape of one post.
 *
 * The table, the rows and the cards are the kit's now; naming them here again is what used to make a forum topic look
 * unlike the page beside it.
 */
const FORUM_CSS = `
.az-lead .az-row { gap: var(--sp-4); }
.forum-summary__facts { font-variant-numeric: tabular-nums; }
.forum-summary__ask { margin-top: 12px; padding-top: 12px; border-top: 1px solid var(--border); }
.forum-summary__note { margin-top: 10px; }
.forum-say { display: flex; align-items: center; gap: 8px; flex-wrap: wrap; margin-bottom: 6px; }
.forum-say__text { white-space: pre-wrap; line-height: 1.55; }
.forum-topic__title { line-height: 1.4; }
.forum-topic__title .az-state { margin-right: 6px; }
.forum-topic__meta { color: var(--fg-subtle); font-size: var(--fs-xs); margin-top: 2px; }
.forum-when { color: var(--fg-muted); }
.people { display: inline-flex; gap: 3px; flex-wrap: wrap; }
.person { display: inline-flex; align-items: center; justify-content: center; width: 20px; height: 20px; border-radius: 50%;
  background: var(--bg-inset); color: var(--fg-muted); font-size: 10px; font-weight: 600; }
.post { border-top: 1px solid var(--border); padding: 12px 0; }
.post:first-of-type { border-top: 0; padding-top: 0; }
.post__head { display: flex; align-items: baseline; justify-content: space-between; gap: 8px; }
.post__who { font-weight: 600; }
.post__when { color: var(--fg-subtle); font-size: var(--fs-xs); white-space: nowrap; }
.post__text { margin-top: 6px; line-height: 1.55; white-space: pre-wrap; }
`;

/** One row of the topics table, as the forum's own table draws it. */
function topicRow(topic: ForumTopicRow, categories: readonly ForumCategoryRow[]): string {
	const category = categories.find((candidate) => candidate.id === topic.categoryId);
	const waiting = topic.replies === 0 && !topic.closed && ageDays(topic.lastPostedAt ?? topic.createdAt) >= AGING_DAYS;
	const people = topic.posters.length === 0
		? ''
		: `<span class="people">${topic.posters
			.slice(0, 4)
			.map((poster) => `<span class="person" title="${esc(poster.name ?? poster.username)}">${esc(initials(poster.name ?? poster.username))}</span>`)
			.join('')}</span>`;
	const args = esc(JSON.stringify({ id: topic.id, slug: topic.slug, title: topic.title }));
	return `<tr class="forum-topic" data-command="temcoDocs.forumTopic" data-args="${args}">
<td><div class="forum-topic__title">${topic.pinned ? '<span class="az-state">pinned</span>' : ''}${esc(topic.title)}</div>
<div class="forum-topic__meta">${esc(category?.name ?? '')}${waiting ? ' · <strong>no reply yet</strong>' : ''}${topic.closed ? ' · closed' : ''}</div></td>
<td>${people}</td>
<td class="az-grid__num">${topic.replies}</td>
<td class="az-grid__num">${reads(topic.views)}</td>
<td class="forum-when">${when(topic.lastPostedAt ?? topic.createdAt)}</td>
</tr>`;
}

/** The page, as HTML: one category's topics, in the forum's own five columns. */
export function topicListBody(state: {
	topics: readonly ForumTopicRow[];
	category?: ForumCategoryRow;
	categories: readonly ForumCategoryRow[];
	syncedAt?: string;
	project?: string;
}): string {
	const title = state.category === undefined ? 'Forum — Topics' : `Forum — ${state.category.name}`;
	const replies = state.topics.reduce((sum, topic) => sum + topic.replies, 0);
	const views = state.topics.reduce((sum, topic) => sum + topic.views, 0);
	const unanswered = state.topics.filter((topic) => topic.replies === 0 && !topic.closed).length;
	const readArgs = state.category === undefined ? undefined : { id: state.category.id, slug: state.category.slug };
	// The address the page is *of* — the site's own, shown in the header and offered as the two ways out of the window.
	const address = state.category === undefined ? latestUrl() : categoryUrl(state.category);

	const table = state.topics.length === 0
		? `<div class="mt-24"><div class="az-card"><p class="az-card__desc">${state.syncedAt === undefined ? 'Nothing has been read from the forum yet.' : 'This category has no topics in the last read.'} <button type="button" class="az-btn az-btn--sm az-btn--primary" data-command="temcoDocs.forumSync"${readArgs === undefined ? '' : ` data-args="${esc(JSON.stringify(readArgs))}"`}>Read the forum</button></p></div></div>`
		: `<div class="mt-24"><div class="az-grid"><table><thead><tr><th>Topic</th><th>Participants</th><th class="az-grid__num">Replies</th><th class="az-grid__num">Views</th><th class="forum-when">Activity</th></tr></thead><tbody>${state.topics.map((topic) => topicRow(topic, state.categories)).join('')}</tbody></table></div></div>`;

	return `${hero({
		title,
		mark: 'users',
		desc: state.category === undefined
			? 'The community forum, read into this window: the site\'s own Topics list across every category, and one category\'s table when you pick one. Nothing is posted from here.'
			: `The topics of ${state.category.name}, newest activity first. A row opens the conversation beside this page.`,
		descWide: true,
		note: { text: address, mark: 'info', mono: true, link: { command: 'temcoDocs.openForum', args: address } },
		actions: [
			{ label: 'Read the forum', command: 'temcoDocs.forumSync', args: readArgs, mark: 'refresh', kind: 'primary' as const },
			{ label: 'Copy', command: 'temcoDocs.copyText', args: address, kind: 'link' as const },
			{ label: 'Open on the forum', command: 'temcoDocs.openForum', args: address, mark: 'link', kind: 'link' as const }
		]
	})}
${numbers([
		{ value: String(state.topics.length), label: state.topics.length === 1 ? 'topic' : 'topics' },
		{ value: String(replies), label: replies === 1 ? 'reply' : 'replies' },
		{ value: String(unanswered), label: 'with no reply' },
		{ value: String(views), label: 'reads' }
	])}
${section({
		title: state.category === undefined ? 'Latest topics' : 'Topics',
		desc: state.syncedAt === undefined ? undefined : `read ${state.syncedAt.slice(0, 10)}${state.project === undefined ? '' : ` · project ${state.project}`}`
	})}
${table}`;
}

/** One topic as a tab: what it is, what the docs owe it, the page it is about, and the conversation. */
export function topicBody(state: {
	topic: ForumTopicRow;
	posts: readonly ForumPostRow[];
	named?: PageEntry;
	suggestion?: { pageId?: string; pageTitle?: string; text: string; source: string; at: string };
	categoryName?: string;
}): string {
	const topic = state.topic;
	const waiting = topic.replies === 0 && !topic.closed;
	const days = ageDays(topic.lastPostedAt ?? topic.createdAt);
	const posts = topic.posts > 0 ? topic.posts : state.posts.length;
	const author = topic.posters[0]?.name ?? topic.posters[0]?.username ?? 'someone';
	const ask = askLine(topic, state.posts);
	const address = topicUrl({ id: topic.id, slug: topic.slug });
	const named = state.named;
	const suggestion = state.suggestion;
	const suggestArgs = esc(JSON.stringify({ id: topic.id }));

	const history = state.posts.length === 0
		? '<div class="az-card"><p class="az-card__desc">The conversation has not been read yet.</p></div>'
		: state.posts
			.map(
				(post) => `<div class="post"><div class="post__head"><span class="post__who">${esc(post.name ?? post.username ?? 'someone')}</span>
<span class="post__when">#${post.postNumber} · ${esc(when(post.createdAt))}${post.replyTo === undefined ? '' : ` · replied to #${post.replyTo}`}</span></div>
<div class="post__text">${esc(plainText(post.cooked ?? ''))}</div></div>`
			)
			.join('');

	// The card is where a triager learns whether anything is owed: the thread's state, the thread in numbers, and the
	// one thing to do about it. The suggestion sits inside it, so "nobody answered" and "ask the AI" are one look.
	const badge = waiting
		? `<span class="az-state${days >= AGING_DAYS ? ' az-state--warn' : ''}">needs an answer</span>`
		: topic.closed ? '<span class="az-state">closed</span>' : '<span class="az-state az-state--ok">answered</span>';
	const answeredBy = topic.posters.slice(1, 4).map((poster) => esc(poster.name ?? poster.username)).join(', ');
	const stateLine = waiting
		? days >= AGING_DAYS
			? `No reply yet — this thread has waited ${days} days.`
			: 'No reply yet — nobody has answered it.'
		: topic.closed
			? `This thread is closed, after ${topic.replies} ${topic.replies === 1 ? 'reply' : 'replies'}.`
			: `${topic.replies} ${topic.replies === 1 ? 'reply' : 'replies'}${answeredBy === '' ? '' : `, from ${answeredBy}`}.`;
	const facts = [
		`${topic.replies} ${topic.replies === 1 ? 'reply' : 'replies'}`,
		`${posts} ${posts === 1 ? 'post' : 'posts'}`,
		`${reads(topic.views)} reads`,
		`last activity ${when(topic.lastPostedAt ?? topic.createdAt)}`
	].join(' · ');
	const advise = suggestion === undefined
		? '<p class="az-card__desc">The AI can say what a page should add about it. Without one, the platform matches the thread to a page on its own.</p>'
		: `<div class="forum-say"><span class="az-state${suggestion.source === 'ai' ? ' az-state--accent' : ''}">${suggestion.source === 'ai' ? 'AI' : 'from the registry'}</span><span class="forum-say__when">${esc(when(suggestion.at))}</span></div>
<p class="az-card__desc forum-say__text">${esc(suggestion.text)}</p>`;

	const summary = `<div class="az-card"><div class="az-card__head"><span class="az-card__icon">${icon(waiting ? 'alert' : 'check')}</span><div class="az-card__title">Summary</div><div class="az-section__actions">${badge}</div></div>
<p class="az-card__desc">${stateLine}</p>
<p class="az-card__desc forum-summary__facts">${esc(facts)}</p>
<div class="forum-summary__ask">${advise}
<div class="az-row" style="margin-top:10px"><button type="button" class="az-btn az-btn--sm${suggestion === undefined || suggestion.source !== 'ai' ? ' az-btn--primary' : ''}" data-command="temcoDocs.forumSuggest" data-args="${suggestArgs}">${icon('sparkle')}<span>${suggestion === undefined || suggestion.source !== 'ai' ? 'Suggest with the AI' : 'Ask the AI again'}</span></button></div>
<p class="az-card__desc forum-summary__note">A suggestion is advice, not a decision: nothing is written to a page or posted to the forum from here.</p></div></div>`;

	const pageCard = named === undefined
		? '<div class="az-card"><p class="az-card__desc">No page in this documentation set is named by the topic: either the page is missing, or its title does not use the thread\'s words. A page\'s id or title in the topic is what attaches a suggestion to it.</p></div>'
		: `<div class="az-card"><div class="az-card__head"><span class="az-card__icon">${icon('document')}</span><div class="az-card__title">${esc(named.title)}</div><div class="az-section__actions"><span class="az-state${named.provenance?.stale === true ? ' az-state--warn' : ''}">${named.provenance?.stale === true ? 'code moved' : 'current'}</span></div></div>
<p class="az-card__desc">${esc(named.id)} · ${esc(named.area)}${named.chapter === '' ? '' : ` › ${esc(named.chapter)}`} · ${named.reviewed === null ? 'never reviewed' : `last reviewed ${esc(named.reviewed)}`}</p>
<div class="az-row" style="margin-top:10px"><button type="button" class="az-btn az-btn--sm" data-command="temcoDocs.openFile" data-args="${esc(JSON.stringify(named.uri.fsPath))}"><span>Open the page</span></button><button type="button" class="az-btn az-btn--sm az-btn--primary" data-command="temcoAi.openPanel" data-args="${esc(JSON.stringify(named.uri.fsPath))}"><span>Draft the fix</span></button></div></div>`;

	return `${hero({
		eyebrow: state.categoryName === undefined ? `Topic #${topic.id}` : `${state.categoryName} · #${topic.id}`,
		title: topic.title,
		mark: 'users',
		desc: `${author} started this thread${state.categoryName === undefined ? '' : ` in ${state.categoryName}`}.${ask.length === 0 ? '' : ` It asks: ${ask}`}`,
		descWide: true,
		note: { text: address, mark: 'info', mono: true, link: { command: 'temcoDocs.openForum', args: address } },
		actions: [
			{ label: 'Copy', command: 'temcoDocs.copyText', args: address, kind: 'link' as const },
			{ label: 'Open on the forum', command: 'temcoDocs.openForum', args: address, mark: 'link', kind: 'link' as const }
		]
	})}
<div class="mt-24">${summary}</div>
<div class="mt-24">${section({ title: 'The page it is about' })}</div>
${pageCard}
<div class="mt-24">${section({ title: 'Discussion', desc: state.posts.length === 0 ? undefined : `${state.posts.length} ${state.posts.length === 1 ? 'post' : 'posts'}, as the forum shows them` })}</div>
${history}`;
}

/** Cooked HTML as readable text: what a reader needs from a post, without trusting markup this module did not write. */
export function plainText(cooked: string): string {
	return decodeEntities(
		cooked
			.replace(/<br\s*\/?>/gi, '\n')
			.replace(/<\/(p|div|li|blockquote|pre|h[1-6])>/gi, '\n')
			.replace(/<li>/gi, '• ')
			.replace(/<[^>]+>/g, '')
	)
		.replace(/\n{3,}/g, '\n\n')
		.trim();
}

function decodeEntities(text: string): string {
	const named: Record<string, string> = {
		amp: '&',
		lt: '<',
		gt: '>',
		quot: '"',
		apos: "'",
		nbsp: ' ',
		hellip: '…',
		mdash: '—',
		ndash: '–',
		rsquo: '’',
		lsquo: '‘',
		rdquo: '”',
		ldquo: '“'
	};
	return text
		.replace(/&#(\d+);/g, (_whole, code: string) => String.fromCodePoint(Number(code)))
		.replace(/&([a-z]+);/gi, (whole, name: string) => named[name.toLowerCase()] ?? whole);
}

function initials(name: string): string {
	const parts = name.trim().split(/[\s.\-_]+/).filter((part) => part.length > 0);
	if (parts.length === 0) {
		return '?';
	}
	return (parts.length === 1 ? parts[0].slice(0, 2) : `${parts[0][0]}${parts[1][0]}`).toUpperCase();
}

function escapeRegExp(text: string): string {
	return text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function messageOf(error: unknown): string {
	return error instanceof Error ? error.message : String(error);
}
