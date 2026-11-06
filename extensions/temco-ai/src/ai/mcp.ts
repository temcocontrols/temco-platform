// The tool server, as a client: one POST per question, over loopback.
//
// The server runs in stateless HTTP mode, so there is no session to open, no pipe to keep alive and no handshake
// to replay: a request carries everything, and the answer comes back on the same connection. Written here rather
// than pulled in as a dependency because the protocol the assistant needs is two messages long, and an extension
// that installs nothing keeps the product's own weight near zero.
//
// The server is ours: see `tools/temco-mcp`. Every message here has a matching handler there.

import * as http from 'http';
import * as vscode from 'vscode';
import type { ToolSpec } from './runtime';

/** Long enough for a slow catalog query on a busy machine, short enough not to hang a turn. */
const CALL_TIMEOUT_MS = 30_000;
const LIST_TIMEOUT_MS = 15_000;

interface Reply {
	status: number;
	type: string;
	text: string;
}

interface ToolReply {
	content?: { type?: string; text?: string }[];
	isError?: boolean;
}

interface ListedTool {
	name?: string;
	title?: string;
	description?: string;
	inputSchema?: Record<string, unknown>;
	annotations?: { readOnlyHint?: boolean; destructiveHint?: boolean };
}

/** One JSON-RPC POST, with the answer read back in full. */
function post(
	endpoint: string,
	token: string,
	payload: unknown,
	timeoutMs: number,
	cancel?: vscode.CancellationToken
): Promise<Reply> {
	const body = JSON.stringify(payload);
	return new Promise<Reply>((resolve, reject) => {
		const url = new URL(endpoint);
		let settled = false;
		const finish = (settle: () => void): void => {
			if (settled) {
				return;
			}
			settled = true;
			settle();
		};

		const request = http.request(
			{
				host: url.hostname,
				port: url.port,
				path: url.pathname,
				method: 'POST',
				headers: {
					'Content-Type': 'application/json',
					Accept: 'application/json, text/event-stream',
					'Content-Length': Buffer.byteLength(body),
					Authorization: `Bearer ${token}`,
				},
				timeout: timeoutMs,
			},
			(response) => {
				const chunks: string[] = [];
				response.setEncoding('utf8');
				response.on('data', (chunk: string) => chunks.push(chunk));
				response.on('end', () => {
					const type = String(response.headers['content-type'] ?? '');
					finish(() => resolve({ status: response.statusCode ?? 0, type, text: chunks.join('') }));
				});
				response.on('error', (error) => finish(() => reject(error)));
			}
		);

		const subscription = cancel?.onCancellationRequested(() => {
			request.destroy();
			finish(() => reject(new Error('the call was cancelled')));
		});
		request.on('timeout', () => {
			request.destroy();
			finish(() => reject(new Error(`the tool server did not answer within ${timeoutMs / 1000}s`)));
		});
		request.on('error', (error) => {
			finish(() => reject(new Error(`the tool server could not be reached at ${endpoint}: ${error.message}`)));
		});
		request.on('close', () => subscription?.dispose());
		request.write(body);
		request.end();
	});
}

/** The JSON-RPC answer inside a reply, whether the transport framed it as JSON or as an event. */
function unwrap(reply: Reply): unknown {
	if (reply.status === 401) {
		throw new Error('the tool server refused this window\'s token; start it again from The Tool Server page');
	}
	if (reply.status !== 200) {
		throw new Error(`the tool server answered ${reply.status}: ${reply.text.slice(0, 300) || '(nothing)'}`);
	}
	const framed = reply.type.includes('text/event-stream') ? reply.text
		.split(/\r?\n/)
		.filter((line) => line.startsWith('data:'))
		.map((line) => line.slice(5).trim())
		.join('\n') : reply.text;
	let message: { result?: unknown; error?: { message?: string } };
	try {
		message = JSON.parse(framed || '{}') as typeof message;
	} catch {
		throw new Error(`the tool server answered with something that is not JSON-RPC: ${framed.slice(0, 200)}`);
	}
	if (message.error) {
		throw new Error(message.error.message ?? 'the tool server refused the request');
	}
	return message.result;
}

/** Everything the server can be asked to do. */
export async function fetchTools(
	endpoint: string,
	token: string,
	log: (line: string) => void
): Promise<readonly ToolSpec[]> {
	const result = (await unwrap(
		await post(endpoint, token, { jsonrpc: '2.0', id: 1, method: 'tools/list', params: {} }, LIST_TIMEOUT_MS)
	)) as { tools?: ListedTool[] } | undefined;
	const tools = (result?.tools ?? []).map((tool) => ({
		name: tool.name ?? '',
		description: tool.title ?? tool.description ?? '',
		parameters: tool.inputSchema ?? { type: 'object', properties: {} },
		readOnly: tool.annotations?.readOnlyHint,
		destructive: tool.annotations?.destructiveHint,
	}));
	log(`[mcp] ${tools.length} tools from ${endpoint}`);
	return tools;
}

/** Runs one call and answers with the text the model reads back. */
export async function runTool(
	endpoint: string,
	token: string,
	name: string,
	args: Record<string, unknown>,
	cancel?: vscode.CancellationToken
): Promise<string> {
	const result = (await unwrap(
		await post(
			endpoint,
			token,
			{ jsonrpc: '2.0', id: 2, method: 'tools/call', params: { name, arguments: args } },
			CALL_TIMEOUT_MS,
			cancel
		)
	)) as ToolReply | undefined;
	const text = (result?.content ?? [])
		.map((part) => (typeof part.text === 'string' ? part.text : ''))
		.join('\n')
		.trim();
	return text.length > 0 ? text : 'The tool answered with nothing.';
}
