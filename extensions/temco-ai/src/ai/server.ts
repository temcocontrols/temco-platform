// The tool server, as a process this window owns.
//
// One program on loopback, with an address a page can show and a stop button that means stopped. The alternative —
// a `stdio` child per turn — needed no supervisor, but it also had no address and no state, and both are what a
// person asks for the moment a program runs on their machine on their behalf. So: started on demand, kept while the
// window is open, stopped when it closes, and described on The Tool Server page by what it is actually doing.

import { ChildProcess, spawn } from 'child_process';
import * as crypto from 'crypto';
import * as http from 'http';
import * as net from 'net';
import * as vscode from 'vscode';
import { ensureServerBinary, serverEnv } from './binPath';
import { toolLog } from './log';
import { fetchTools, runTool } from './mcp';
import type { ToolSpec } from './runtime';

/** Long enough for a first-run download to land on a slow disk, short enough that a hung start is reported. */
const START_TIMEOUT_MS = 30_000;
const PROBE_INTERVAL_MS = 250;
const PROBE_TIMEOUT_MS = 1_000;
/** How many of the server's own lines are kept for the next failure report. */
const TAIL_LINES = 40;

export type ServerState = 'stopped' | 'starting' | 'running' | 'failed';

/** What The Tool Server page says, and what the panel's row turns into when it is not running. */
export interface ServerStatus {
	state: ServerState;
	binary?: string;
	port?: number;
	pid?: number;
	/** How many calls the server offers, once it has been asked. */
	calls?: number;
	/** When this process started, so the page can say how long it has been up. */
	since?: number;
	error?: string;
}

/** What a caller needs to talk to it: the address, and the token this window generated. */
export interface Endpoint {
	url: string;
	token: string;
	port: number;
}

function delay(ms: number): Promise<void> {
	return new Promise<void>((resolve) => setTimeout(resolve, ms));
}

/** A port nothing holds right now, for the default "let the application pick" setting. */
function freePort(): Promise<number> {
	return new Promise<number>((resolve, reject) => {
		const probe = net.createServer();
		probe.once('error', reject);
		probe.listen(0, '127.0.0.1', () => {
			const address = probe.address();
			const port = typeof address === 'object' && address !== null ? address.port : 0;
			probe.close(() => {
				if (port > 0) {
					resolve(port);
				} else {
					reject(new Error('no free port on 127.0.0.1'));
				}
			});
		});
	});
}

/** Whether something answers `/health` there. The only honest test that the process is really serving. */
function healthy(port: number): Promise<boolean> {
	return new Promise<boolean>((resolve) => {
		const request = http.get(
			{ host: '127.0.0.1', port, path: '/health', timeout: PROBE_TIMEOUT_MS },
			(response) => {
				response.resume();
				resolve(response.statusCode === 200);
			}
		);
		request.on('timeout', () => {
			request.destroy();
			resolve(false);
		});
		request.on('error', () => resolve(false));
	});
}

/**
 * The managed server.
 *
 * Every state change is broadcast, because two surfaces read this one object: The Tool Server page draws it, and the
 * Tools page decides from it whether a catalogue can be read at all.
 */
export class ToolServer implements vscode.Disposable {
	private child: ChildProcess | undefined;
	private state: ServerState = 'stopped';
	private token = '';
	private port: number | undefined;
	private since: number | undefined;
	private binary: string | undefined;
	private lastError: string | undefined;
	private listed: readonly ToolSpec[] | undefined;
	private pending: Promise<Endpoint> | undefined;
	private idle: NodeJS.Timeout | undefined;
	private readonly tail: string[] = [];
	private readonly emitter = new vscode.EventEmitter<ServerStatus>();

	constructor(private readonly log: (line: string) => void = (line) => toolLog().appendLine(line)) { }

	readonly onDidChange = this.emitter.event;

	status(): ServerStatus {
		return {
			state: this.state,
			binary: this.binary,
			port: this.port,
			pid: this.child?.pid,
			calls: this.listed?.length,
			since: this.since,
			error: this.lastError,
		};
	}

	/** The address a client posts to, when there is one. */
	url(): string | undefined {
		return this.port === undefined ? undefined : `http://127.0.0.1:${this.port}/mcp`;
	}

	/** Where the health check answers. */
	private healthUrl(): string | undefined {
		return this.port === undefined ? undefined : `http://127.0.0.1:${this.port}/health`;
	}

	/**
	 * The address to talk to, starting the server when it is not up.
	 *
	 * Every caller of this is a caller that is about to use it, so starting here rather than in the page means the
	 * panel works on a machine where the page was never opened.
	 */
	async ensure(context: vscode.ExtensionContext): Promise<Endpoint> {
		if (this.state === 'running' && this.port !== undefined) {
			this.touch();
			return { url: this.url() ?? '', token: this.token, port: this.port };
		}
		if (this.pending) {
			return this.pending;
		}
		const starting = this.start(context);
		this.pending = starting;
		try {
			return await starting;
		} finally {
			this.pending = undefined;
		}
	}

	/** Starts it, or answers with the reason it could not start. */
	async start(context: vscode.ExtensionContext): Promise<Endpoint> {
		if (this.state === 'running' && this.port !== undefined) {
			this.touch();
			return { url: this.url() ?? '', token: this.token, port: this.port };
		}
		this.setState('starting');
		this.lastError = undefined;
		this.tail.length = 0;

		let binary: string;
		try {
			// A machine with no server yet downloads it here rather than failing: "Start" is the button that installs.
			binary = await ensureServerBinary(context);
		} catch (error) {
			throw this.failed(error instanceof Error ? error.message : String(error));
		}
		this.binary = binary;

		let port: number;
		try {
			const wanted = vscode.workspace.getConfiguration('temcoAi').get<number>('serverPort', 0);
			port = wanted > 0 ? wanted : await freePort();
		} catch (error) {
			throw this.failed(error instanceof Error ? error.message : String(error));
		}

		const token = crypto.randomBytes(24).toString('hex');
		this.log(`[server] starting ${binary} on 127.0.0.1:${String(port)}`);
		let child: ChildProcess;
		try {
			child = spawn(binary, [], {
				env: {
					...serverEnv(context),
					TEMCO_MCP_TRANSPORT: 'http',
					TEMCO_MCP_PORT: String(port),
					TEMCO_MCP_TOKEN: token,
				},
				windowsHide: true,
				stdio: ['ignore', 'pipe', 'pipe'],
			});
		} catch (error) {
			throw this.failed(error instanceof Error ? error.message : String(error));
		}

		this.child = child;
		this.port = port;
		this.token = token;
		child.stdout?.setEncoding('utf8');
		child.stdout?.on('data', (chunk: string) => this.read(chunk));
		child.stderr?.setEncoding('utf8');
		child.stderr?.on('data', (chunk: string) => this.read(chunk));
		child.on('error', (error) => this.stoppedAbruptly(child, `could not be started: ${error.message}`));
		child.on('exit', (code, signal) =>
			this.stoppedAbruptly(child, `stopped (${signal ?? `exit ${String(code)}`})`)
		);

		const deadline = Date.now() + START_TIMEOUT_MS;
		while (Date.now() < deadline) {
			if (this.state === 'failed' || this.child !== child) {
				throw new Error(this.lastError ?? 'the tool server stopped while it was starting');
			}
			if (await healthy(port)) {
				this.since = Date.now();
				this.setState('running');
				this.log(`[server] running at ${this.url() ?? ''}`);
				this.touch();
				try {
					// Its first question, asked here so the catalogue is warm and the count is known.
					await this.list({ url: this.url() ?? '', token, port });
				} catch {
					// Up but not answering is reported wherever a call is made; the process itself is running.
				}
				return { url: this.url() ?? '', token, port };
			}
			await delay(PROBE_INTERVAL_MS);
		}
		child.kill();
		throw this.failed(`the tool server did not answer ${this.healthUrl() ?? ''} within ${START_TIMEOUT_MS / 1000}s`);
	}

	async stop(): Promise<void> {
		this.clearIdle();
		const child = this.child;
		this.child = undefined;
		this.port = undefined;
		this.since = undefined;
		this.token = '';
		if (child && child.exitCode === null) {
			this.log('[server] stopping');
			child.kill();
		}
		this.setState('stopped');
	}

	async restart(context: vscode.ExtensionContext): Promise<Endpoint> {
		await this.stop();
		return this.start(context);
	}

	/** The catalogue, read once per run and kept: it only changes when the server does. */
	async tools(context: vscode.ExtensionContext): Promise<readonly ToolSpec[]> {
		const endpoint = await this.ensure(context);
		if (this.listed) {
			return this.listed;
		}
		return this.list(endpoint);
	}

	/** The server's own output, for the log button. */
	showLog(): void {
		toolLog().show(true);
	}

	dispose(): void {
		this.clearIdle();
		const child = this.child;
		this.child = undefined;
		if (child && child.exitCode === null) {
			child.kill();
		}
		this.emitter.dispose();
	}

	private async list(endpoint?: Endpoint): Promise<readonly ToolSpec[]> {
		const url = endpoint?.url ?? this.url();
		const token = endpoint?.token ?? this.token;
		if (!url || !token) {
			return [];
		}
		try {
			this.listed = await fetchTools(url, token, this.log);
		} catch (error) {
			// Up, but not answering: the caller gets the reason, and the page shows it.
			this.log(`[mcp] ${error instanceof Error ? error.message : String(error)}`);
			throw error;
		}
		this.emitter.fire(this.status());
		return this.listed;
	}

	/** One line of the server's output: kept, forwarded, and remembered for the next failure report. */
	private read(chunk: string): void {
		for (const line of chunk.split('\n')) {
			const trimmed = line.trim();
			if (trimmed.length === 0) {
				continue;
			}
			this.log(`[server] ${trimmed}`);
			this.tail.push(trimmed);
			if (this.tail.length > TAIL_LINES) {
				this.tail.shift();
			}
		}
	}

	/** The process went away: while starting that is a failure, and while running it is a stop nobody asked for. */
	private stoppedAbruptly(child: ChildProcess, reason: string): void {
		if (this.child !== child) {
			return;
		}
		this.child = undefined;
		this.port = undefined;
		this.since = undefined;
		this.token = '';
		this.clearIdle();
		const detail = this.tail.length > 0 ? `${reason}: ${this.tail.slice(-3).join(' / ')}` : reason;
		this.failed(`the tool server ${detail}`);
	}

	private failed(reason: string): Error {
		this.lastError = reason;
		this.setState('failed');
		this.log(`[server] ${reason}`);
		return new Error(reason);
	}

	private setState(state: ServerState): void {
		this.state = state;
		this.emitter.fire(this.status());
	}

	/** Holds it open while something is using it, and lets it go after the configured quiet spell. */
	private touch(): void {
		this.clearIdle();
		const minutes = vscode.workspace.getConfiguration('temcoAi').get<number>('serverIdleMinutes', 0);
		if (minutes <= 0) {
			return;
		}
		this.idle = setTimeout(() => {
			this.log(`[server] idle for ${minutes} minutes; stopping`);
			void this.stop();
		}, minutes * 60_000);
		this.idle.unref();
	}

	private clearIdle(): void {
		if (this.idle) {
			clearTimeout(this.idle);
			this.idle = undefined;
		}
	}
}

let managed: ToolServer | undefined;

/** The one server this window has. */
export function toolServer(): ToolServer {
	managed ??= new ToolServer();
	return managed;
}

export function disposeToolServer(): void {
	managed?.dispose();
	managed = undefined;
}

/** Runs one call through the managed server. Here so that nothing outside this folder has to know the address. */
export async function callThroughServer(
	context: vscode.ExtensionContext,
	name: string,
	args: Record<string, unknown>,
	cancel?: vscode.CancellationToken
): Promise<string> {
	const endpoint = await toolServer().ensure(context);
	return runTool(endpoint.url, endpoint.token, name, args, cancel);
}
