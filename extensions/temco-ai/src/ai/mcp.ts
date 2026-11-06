// The tool server, as a client.
//
// One child process, one stdio session, newline-delimited JSON-RPC. Written here rather than pulled in as a
// dependency because the protocol the assistant needs is four messages long, and an extension that installs
// nothing keeps the product's own weight near zero.
//
// The server is ours: see `tools/temco-mcp`. Every message here has a matching handler there.

import { ChildProcess, spawn } from 'child_process';
import * as fs from 'fs';
import * as vscode from 'vscode';
import type { ToolSpec } from './runtime';

/** Long enough for a slow catalog query on a busy machine, short enough not to hang a turn. */
const CALL_TIMEOUT_MS = 30_000;
const START_TIMEOUT_MS = 15_000;
/** The version this client speaks. The server answers with the one it chose. */
const PROTOCOL_VERSION = '2025-06-18';

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

interface Waiting {
  resolve: (value: unknown) => void;
  reject: (error: Error) => void;
  /** Stops the clock and drops the cancellation subscription. */
  cleanup: () => void;
}

/**
 * A session with the tool server: start it, ask what it can do, call it, and let it go. Nothing starts until
 * something asks, and the process never outlives the turn that opened it.
 */
export class ToolSession implements vscode.Disposable {
  private child: ChildProcess | undefined;
  private buffer = '';
  private nextId = 1;
  private readonly waiting = new Map<number, Waiting>();
  private tools: readonly ToolSpec[] = [];
  private failure: Error | undefined;

  constructor(
    private readonly command: string,
    private readonly env: Record<string, string>,
    private readonly log: (line: string) => void
  ) {}

  /** Starts the process, performs the handshake, and lists the tools once. */
  async open(): Promise<readonly ToolSpec[]> {
    if (this.tools.length > 0) {
      return this.tools;
    }
    this.start();
    await this.request('initialize', {
      protocolVersion: PROTOCOL_VERSION,
      capabilities: {},
      clientInfo: { name: 'temco-ai', version: '1.0.0' },
    });
    this.notify('notifications/initialized', {});

    const listed = (await this.request('tools/list', {})) as { tools?: ListedTool[] };
    this.tools = (listed.tools ?? []).map((tool) => ({
      name: tool.name ?? '',
      description: tool.title ?? tool.description ?? '',
      parameters: tool.inputSchema ?? { type: 'object', properties: {} },
      readOnly: tool.annotations?.readOnlyHint,
      destructive: tool.annotations?.destructiveHint,
    }));
    this.log(`[mcp] ${this.tools.length} tools from ${this.command}`);
    return this.tools;
  }

  /** Runs one call and answers with the text the model reads back. */
  async call(
    name: string,
    args: Record<string, unknown>,
    token?: vscode.CancellationToken
  ): Promise<string> {
    const reply = (await this.request(
      'tools/call',
      { name, arguments: args },
      token
    )) as ToolReply;
    const text = (reply.content ?? [])
      .map((part) => (typeof part.text === 'string' ? part.text : ''))
      .join('\n')
      .trim();
    return text.length > 0 ? text : 'The tool answered with nothing.';
  }

  dispose(): void {
    this.fail(new Error('the session was closed'));
    const child = this.child;
    this.child = undefined;
    if (child && child.exitCode === null) {
      child.stdin?.end();
      child.kill();
    }
  }

  private start(): void {
    if (!fs.existsSync(this.command)) {
      throw new Error(`the tool server is not installed at ${this.command}`);
    }
    const child = spawn(this.command, [], {
      env: this.env,
      windowsHide: true,
      stdio: ['pipe', 'pipe', 'pipe'],
    });
    this.child = child;

    child.stdout?.setEncoding('utf8');
    child.stdout?.on('data', (chunk: string) => this.read(chunk));
    child.stderr?.setEncoding('utf8');
    child.stderr?.on('data', (chunk: string) => {
      for (const line of chunk.split('\n')) {
        const trimmed = line.trim();
        if (trimmed.length > 0) {
          this.log(`[mcp] ${trimmed}`);
        }
      }
    });
    child.on('error', (error) =>
      this.fail(new Error(`the tool server could not be started: ${error.message}`))
    );
    child.on('exit', (code) =>
      this.fail(new Error(`the tool server stopped (exit ${String(code)})`))
    );
  }

  private read(chunk: string): void {
    this.buffer += chunk;
    const lines = this.buffer.split('\n');
    this.buffer = lines.pop() ?? '';
    for (const line of lines) {
      const trimmed = line.trim();
      if (trimmed.length === 0) {
        continue;
      }
      let message: { id?: number; result?: unknown; error?: { message?: string } };
      try {
        message = JSON.parse(trimmed) as typeof message;
      } catch {
        // A line the server wrote to stdout that is not protocol. Say so once; keep reading.
        this.log(`[mcp] not protocol: ${trimmed.slice(0, 200)}`);
        continue;
      }
      if (typeof message.id !== 'number') {
        continue;
      }
      const waiting = this.waiting.get(message.id);
      if (!waiting) {
        continue;
      }
      this.waiting.delete(message.id);
      waiting.cleanup();
      if (message.error) {
        waiting.reject(new Error(message.error.message ?? 'the tool server refused the request'));
      } else {
        waiting.resolve(message.result);
      }
    }
  }

  private request(
    method: string,
    params: Record<string, unknown>,
    token?: vscode.CancellationToken
  ): Promise<unknown> {
    const child = this.child;
    if (!child?.stdin || this.failure) {
      return Promise.reject(this.failure ?? new Error('the tool server is not running'));
    }
    const id = this.nextId++;
    const message = JSON.stringify({ jsonrpc: '2.0', id, method, params });
    const timeout = method === 'tools/call' ? CALL_TIMEOUT_MS : START_TIMEOUT_MS;

    return new Promise<unknown>((resolve, reject) => {
      const subscription = token?.onCancellationRequested(() => {
        this.waiting.delete(id);
        cleanup();
        reject(new Error('the call was cancelled'));
      });
      const timer = setTimeout(() => {
        this.waiting.delete(id);
        cleanup();
        reject(new Error(`the tool server did not answer ${method} within ${timeout / 1000}s`));
      }, timeout);
      const cleanup = (): void => {
        clearTimeout(timer);
        subscription?.dispose();
      };
      this.waiting.set(id, { resolve, reject, cleanup });

      child.stdin?.write(`${message}\n`, (error) => {
        if (error) {
          this.waiting.delete(id);
          cleanup();
          reject(new Error(`the tool server could not be written to: ${error.message}`));
        }
      });
    });
  }

  private notify(method: string, params: Record<string, unknown>): void {
    this.child?.stdin?.write(`${JSON.stringify({ jsonrpc: '2.0', method, params })}\n`);
  }

  /** One reason, kept, so every later call fails the same way instead of hanging. */
  private fail(error: Error): void {
    if (this.failure) {
      return;
    }
    this.failure = error;
    for (const [, waiting] of this.waiting) {
      waiting.cleanup();
      waiting.reject(error);
    }
    this.waiting.clear();
  }
}
