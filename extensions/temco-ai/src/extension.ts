// The AI module's entry point.
//
// It is the sixth module of Temco Platform and it is *not* part of the documentation module: a local model is a
// thing the application runs, and the documentation is one of the things it can be pointed at. That is why this
// is an extension of its own — it has its own container, its own page, its own settings and its own command
// namespace, and it can be left out of an install without the documentation module noticing.
//
// Two directions, and only one of them is a dependency:
//
//   * this module requires `temcocontrols.temco-docs`, whose exports are the documentation model — the sets, the
//     pages, the selection. The panel reads them through `docs.ts` rather than owning a copy.
//   * the documentation module requires nothing of this one. It calls the commands below when the module is
//     installed — a new page's body is drafted, a source is analysed for what it is missing, the AI page opens —
//     and every one of those is a plain command, so an install without this module is a smaller install, not a
//     broken one.

import * as vscode from 'vscode';
import { askToRun, runAgent } from './ai/agent';
import { disposeToolLog, toolLog } from './ai/log';
import { ensureServerBinary, buildHint, serverBinary, serverEntry } from './ai/binPath';
import { MODELS, RUNTIMES, entryById } from './ai/catalog';
import { registerAiCommands } from './ai/commands';
import { AiPanel, AI_VIEW_ID } from './ai/panel';
import { PROMPT_VERSION, analysePrompt, newPagePrompt, systemPrompt } from './ai/prompts';
import { AiStatus, aiStatus, complete, disposeAi } from './ai/runtime';
import { docs } from './docs';
import { AiPages, registerAiViews } from './aiPages';
import { restore } from './ui';

/** What one analysis needs: a source, its files, the pages it already has, and the note the person added. */
export interface AnalyseRequest {
	name: string;
	files: readonly string[];
	pages: readonly string[];
	note: string;
}

/** What one draft needs: the form's answers, and where the text is to be written. */
export interface DraftRequest {
	title: string;
	kind: string;
	headings: readonly string[];
	path: string;
	area: string;
	material: string;
	/** Called as the answer arrives, so a draft appears while it is still being written. */
	onToken?(text: string): void;
}

/** What one suggestion about a forum thread needs: the thread's own words, and the page the platform matched. */
export interface TopicRequest {
	title: string;
	excerpt: string;
	/** The opening posts, as plain text. */
	thread: string;
	pageId?: string;
	pageTitle?: string;
	/** The thread's own address, shown with the question so the panel says what it is answering about. */
	url?: string;
}

/**
 * What this module offers the rest of the platform.
 *
 * The documentation module is the one caller today: the new-page page drafts a body and analyses a source
 * through here, and the project hub shows what the module has to work with. Every fact about the AI itself is
 * answered here rather than guessed from a setting, so there is one owner of "which model, which runtime, is it
 * running".
 */
export interface TemcoAiApi {
	/** The runtime, the model, and the server they are behind, right now. */
	status(): AiStatus;
	/** What the module knows, for a surface that only wants to say how much is available. */
	facts(): { promptVersion: string; known: number };
	/** The model in use as a person would name it, or `undefined` when none is chosen. */
	modelLabel(): string | undefined;
	/** What a source's documentation is missing, as the model proposes it. */
	analyse(request: AnalyseRequest): Promise<string>;
	/** A draft of a new page's body, streamed to `onToken` as it is written. */
	draft(request: DraftRequest): Promise<void>;
	/** What the documentation should do about one forum thread, in a sentence or three. */
	topic(request: TopicRequest): Promise<string>;
}

export function activate(context: vscode.ExtensionContext): TemcoAiApi {
	const documentation = docs();

	// The panel reads the page and the registry through the documentation module's model, and decides nothing.
	const panel = new AiPanel(context, () => documentation.roots(), documentation.selection);
	context.subscriptions.push(
		vscode.window.registerWebviewViewProvider(AI_VIEW_ID, panel, {
			webviewOptions: { retainContextWhenHidden: true },
		}),
		vscode.window.onDidChangeActiveTextEditor(() => panel.refresh()),
		documentation.onDidChange(() => panel.refresh())
	);

	registerAiCommands(context);

	// The AI Hub's four surfaces and its three side-bar groups: what is being drafted, what can be asked for and what
	// those acts rested on, and what answers at all. The chat is the panel, not a page.
	const pages = new AiPages(context);
	registerAiViews(context);
	context.subscriptions.push(
		pages,
		// A page of this module that was open when the window closed comes back with its tab.
		...restore(context, pages.restorable()),
		vscode.commands.registerCommand('temcoAi.actions', () => pages.actions()),
		vscode.commands.registerCommand('temcoAi.citations', () => pages.citations()),
		vscode.commands.registerCommand('temcoAi.stale', () => pages.stale()),
		// One forum thread, answered in the panel so it can be read and followed up: the docs module stores the answer
		// against the topic and shows it there as well.
		vscode.commands.registerCommand('temcoAi.suggestTopic', (request?: unknown) => topicAnswer(panel, request)),
		// The tool server: what the assistant can call, and the one command that reaches it today.
		vscode.commands.registerCommand('temcoAi.toolServer', () => toolServerStatus(context)),
		vscode.commands.registerCommand('temcoAi.installToolServer', () => ensureServerBinary(context)),
		vscode.commands.registerCommand('temcoAi.askWithTools', () => askWithTools(context)),
		vscode.commands.registerCommand('temcoAi.tools', () => pages.tools()),
		vscode.commands.registerCommand('temcoAi.configurePlatformApi', () => configurePlatformApi())
	);

	return {
		status: () => aiStatus(context),

		facts: () => ({
			promptVersion: PROMPT_VERSION,
			known: [...RUNTIMES, ...MODELS].length,
		}),

		modelLabel: () => {
			const status = aiStatus(context);
			return status.model ? entryById(status.model.id)?.label ?? status.model.id : undefined;
		},

		analyse: async (request) => {
			const prompt = analysePrompt(context, request);
			const answer = await complete(
				context,
				[
					{ role: 'system', content: systemPrompt(context, undefined) },
					{ role: 'user', content: prompt },
				],
				{ maxTokens: 700 }
			);
			return answer.text;
		},

		draft: async (request) => {
			const prompt = newPagePrompt(context, request);
			await complete(
				context,
				[
					{ role: 'system', content: systemPrompt(context, undefined) },
					{ role: 'user', content: prompt },
				],
				{
					maxTokens: 1200,
					onToken: (text) => request.onToken?.(text),
				}
			);
		},

		topic: (request) => topicAnswer(panel, request),
	};
}

/**
 * What the documentation should do about one forum thread, through the same guardrails as every other answer.
 *
 * The answer is not returned only: it is streamed into the panel, so the reader sees it arrive and can ask a follow-up
 * about the same thread. With no model on disk the panel says so in its own words, and the text is empty.
 */
async function topicAnswer(panel: AiPanel, request: unknown): Promise<string> {
	const input = (request ?? {}) as Partial<TopicRequest>;
	if (typeof input.title !== 'string' || input.title.trim().length === 0) {
		return '';
	}
	return panel.answerTopic({
		title: input.title,
		excerpt: String(input.excerpt ?? ''),
		thread: String(input.thread ?? ''),
		pageId: typeof input.pageId === 'string' ? input.pageId : undefined,
		pageTitle: typeof input.pageTitle === 'string' ? input.pageTitle : undefined,
		url: typeof input.url === 'string' ? input.url : undefined,
	});
}

/** Sets the one thing the device, repository and project tools cannot guess: where to ask. */
async function configurePlatformApi(): Promise<void> {
	const configuration = vscode.workspace.getConfiguration('temcoAi');
	const current = configuration.get<string>('platformApi', '');
	const value = await vscode.window.showInputBox({
		title: 'Platform API',
		prompt: 'The address the device, repository and project tools should ask. Leave it empty to turn those tools off.',
		value: current,
		placeHolder: 'http://127.0.0.1:3210',
	});
	if (value === undefined) {
		return;
	}
	await configuration.update('platformApi', value.trim(), vscode.ConfigurationTarget.Global);
}

/**
 * Where the tool server is on this machine, and how to get it. The answer is offered where the user already
 * reads AI status rather than beside it.
 */
async function toolServerStatus(context: vscode.ExtensionContext): Promise<void> {
	const entry = serverEntry();
	const binary = serverBinary(context);
	if (binary) {
		const choice = await vscode.window.showInformationMessage(
			`The tool server is ready: ${binary}`,
			'Show the log'
		);
		if (choice === 'Show the log') {
			toolLog().show(true);
		}
		return;
	}
	if (!entry) {
		await vscode.window.showWarningMessage(
			`No tool server is published for ${process.platform}-${process.arch}, so the assistant cannot call anything here.`
		);
		return;
	}

	const hint = buildHint(context);
	const choice = await vscode.window.showInformationMessage(
		`${entry.label} is not on this machine yet.`,
		{ modal: true, detail: hint },
		'Build Command',
		'Install'
	);
	if (choice === 'Build Command') {
		await vscode.env.clipboard.writeText(hint);
		await vscode.window.showInformationMessage('The command is on the clipboard. Run it in a terminal.');
	} else if (choice === 'Install') {
		await ensureServerBinary(context);
	}
}

/**
 * One question, answered with tools. The first surface the loop has: the panel keeps its question-and-answer
 * path until the tool views in the design are built, and this is reachable from the palette today.
 */
async function askWithTools(context: vscode.ExtensionContext): Promise<void> {
	const question = await vscode.window.showInputBox({
		title: 'Ask with tools',
		prompt: 'What should the assistant find out? It can read devices, repositories, documentation and the catalog.',
		placeHolder: 'read input 1 of device 1234',
	});
	if (!question) {
		return;
	}
	const output = toolLog();
	output.show(true);
	try {
		const result = await runAgent(context, [{ role: 'user', content: question }], {
			log: (line) => output.appendLine(line),
			onStep: (step) => output.appendLine(`call ${step.tool} ${JSON.stringify(step.arguments)}`),
			approve: askToRun,
		});
		output.appendLine('');
		output.appendLine(result.text);
	} catch (error) {
		output.appendLine(error instanceof Error ? error.message : String(error));
	}
}

export function deactivate(): void {
	// The local AI may have left a server process running; nothing else is holding anything open.
	disposeAi();
	disposeToolLog();
}
