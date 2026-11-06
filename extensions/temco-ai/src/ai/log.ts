// The channel the tool loop writes to: what it called, what came back, and what went wrong.
//
// One channel for the module, because three places talk about the same thing: the command that asks a question,
// the page that runs a single call, and the server's own stderr, which is forwarded line by line.

import * as vscode from 'vscode';

let channel: vscode.OutputChannel | undefined;

export function toolLog(): vscode.OutputChannel {
  if (!channel) {
    channel = vscode.window.createOutputChannel('Temco AI: tools');
  }
  return channel;
}

export function disposeToolLog(): void {
  channel?.dispose();
  channel = undefined;
}
