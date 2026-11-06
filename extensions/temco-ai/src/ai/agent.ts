// The loop that lets the model act.
//
// Ask, run what it asked for, ask again. Two things bound it: a step budget, and a list of calls that need a
// person's yes. The budget is not a nicety: a local model that keeps calling the same tool would otherwise
// spend the afternoon in a loop nobody asked for.

import * as vscode from 'vscode';
import { ensureServerBinary, platformApi, serverBinary, serverEnv } from './binPath';
import { ToolSession } from './mcp';
import { ChatMessage, ToolSpec, complete } from './runtime';

const MAX_STEPS = 6;

/** The calls that change something outside this conversation. Nothing in here runs without a yes. */
const NEEDS_APPROVAL = new Set([
  'device.write_point',
  'device.alarm_acknowledge',
  'project.create',
]);

/** Whether one call has to be shown to a person before it runs. */
export function needsApproval(tool: string): boolean {
  return NEEDS_APPROVAL.has(tool);
}

/** An answer to "may this run?", as a caller that has nobody to ask answers it. */
export type Approval = (tool: string, args: Record<string, unknown>) => Promise<boolean>;

/** Asks the person in front of the window, and takes no for an answer. */
export async function askToRun(tool: string, args: Record<string, unknown>): Promise<boolean> {
  const yes = await vscode.window.showWarningMessage(
    `Run ${tool}?`,
    { modal: true, detail: JSON.stringify(args, undefined, 2) },
    'Run'
  );
  return yes === 'Run';
}

/** The tools the server offers, without asking the model anything. */
export async function listTools(
  context: vscode.ExtensionContext,
  log: (line: string) => void
): Promise<readonly ToolSpec[]> {
  const binary = await ensureServerBinary(context);
  const session = new ToolSession(binary, serverEnv(context), log);
  try {
    return await session.open();
  } finally {
    session.dispose();
  }
}

/**
 * Runs one call outside a turn: the page's runner, and nothing else.
 *
 * The approval gate is here rather than in the caller so that no second entry point can skip it.
 */
export async function callTool(
  context: vscode.ExtensionContext,
  name: string,
  args: Record<string, unknown>,
  options: { log: (line: string) => void; approve?: Approval }
): Promise<string> {
  if (needsApproval(name)) {
    const yes = options.approve ? await options.approve(name, args) : false;
    if (!yes) {
      return 'The person at the keyboard declined this call.';
    }
  }

  const binary = await ensureServerBinary(context);
  const session = new ToolSession(binary, serverEnv(context), options.log);
  try {
    await session.open();
    return await session.call(name, args);
  } finally {
    session.dispose();
  }
}

export interface AgentStep {
  tool: string;
  arguments: Record<string, unknown>;
  result: string;
}

export interface AgentResult {
  text: string;
  steps: readonly AgentStep[];
}

export interface AgentOptions {
  onToken?: (text: string) => void;
  onStep?: (step: { tool: string; arguments: Record<string, unknown> }) => void;
  /** Answers whether one call may run. Absent means a call that needs approval does not run. */
  approve?: (tool: string, args: Record<string, unknown>) => Promise<boolean>;
  token?: vscode.CancellationToken;
  log: (line: string) => void;
}

/** Whether the assistant can call anything at all on this machine. */
export function toolsAvailable(context: vscode.ExtensionContext): boolean {
  return serverBinary(context) !== undefined;
}

/**
 * Runs one turn to its end, calling whatever the model asks for on the way.
 *
 * The instruction to use tools is here rather than in the prompt files because it belongs to the loop: the
 * prompt files describe how to answer, and this decides whether answering means calling.
 */
export async function runAgent(
  context: vscode.ExtensionContext,
  messages: readonly ChatMessage[],
  options: AgentOptions
): Promise<AgentResult> {
  if (platformApi().length === 0) {
    // Not fatal: the catalog tools answer from this machine. Everything else reports that the service did
    // not answer, which is a sentence the model can pass on.
    options.log('[mcp] no platform service is configured (temcoAi.platformApi); tools that need one will say so');
  }

  const binary = await ensureServerBinary(context);
  const session = new ToolSession(binary, serverEnv(context), options.log);
  const steps: AgentStep[] = [];
  const thread: ChatMessage[] = [
    {
      role: 'system',
      content:
        'You are the Temco Platform assistant. When a question can be answered from a tool, call the tool; do not guess a value a tool can read. Answer in words once you have what you need.',
    },
    ...messages,
  ];

  try {
    const tools: readonly ToolSpec[] = await session.open();
    for (let step = 0; step < MAX_STEPS; step++) {
      const reply = await complete(context, thread, { tools, token: options.token });
      if (reply.toolCalls.length === 0) {
        options.onToken?.(reply.text);
        return { text: reply.text, steps };
      }
      thread.push({
        role: 'assistant',
        content: reply.text,
        tool_calls: reply.toolCalls.map((call) => ({
          id: call.id,
          type: 'function',
          function: { name: call.name, arguments: JSON.stringify(call.arguments) },
        })),
      });
      for (const call of reply.toolCalls) {
        options.onStep?.({ tool: call.name, arguments: call.arguments });
        const allowed = NEEDS_APPROVAL.has(call.name)
          ? await (options.approve?.(call.name, call.arguments) ?? Promise.resolve(false))
          : true;
        const result = allowed
          ? await session.call(call.name, call.arguments, options.token)
          : 'The person at the keyboard declined this call.';
        steps.push({ tool: call.name, arguments: call.arguments, result });
        thread.push({ role: 'tool', tool_call_id: call.id, content: result });
      }
    }
    return {
      text: `I stopped after ${MAX_STEPS} steps without a final answer. The last thing I did was ${steps[steps.length - 1]?.tool ?? 'nothing'}.`,
      steps,
    };
  } finally {
    session.dispose();
  }
}
