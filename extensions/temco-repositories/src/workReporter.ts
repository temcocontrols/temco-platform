// What a clone or a pull is doing, as the page that started it needs to hear it.
//
// One act at a time, reported as two streams: a **state** ("running", then the verdict) and the **lines** git prints.
// The page that opened the act listens; anything else in the window does not, because a bar on a page you are not
// looking at is noise. Nothing here draws anything: the detail page owns how this looks.

import * as vscode from 'vscode';

/** Which act of the working area a report is about. */
export type WorkAct = 'clone' | 'pull';

/** The act's state, in one sentence. */
export interface WorkState {
	slug: string;
	name: string;
	act: WorkAct;
	state: 'running' | 'ok' | 'err';
	/** The sentence the page shows: what is being done, or what happened. */
	text: string;
	/** The folder the act works in, when it has one. */
	folder?: string;
}

/** One line of what git said. */
export interface WorkLine {
	slug: string;
	text: string;
}

export class WorkReporter implements vscode.Disposable {
	private readonly stateEmitter = new vscode.EventEmitter<WorkState>();
	private readonly lineEmitter = new vscode.EventEmitter<WorkLine>();
	private readonly last = new Map<string, WorkState>();

	/** Fires when an act starts, fails, or ends. */
	readonly onDidState = this.stateEmitter.event;
	/** Fires once per line git prints, as it prints it. */
	readonly onDidLine = this.lineEmitter.event;

	state(event: WorkState): void {
		this.last.set(event.slug, event);
		this.stateEmitter.fire(event);
	}

	line(slug: string, text: string): void {
		this.lineEmitter.fire({ slug, text });
	}

	/** The last thing that happened to one source, so a page drawn anew can say it. */
	lastFor(slug: string): WorkState | undefined {
		return this.last.get(slug);
	}

	dispose(): void {
		this.stateEmitter.dispose();
		this.lineEmitter.dispose();
	}
}
