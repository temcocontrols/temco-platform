// The site's own process.
//
// One way of running the site, and it belongs to the repository's own script: `serve` shows the built pages on one port.
// This module starts it, says what it is doing, and stops it — it never builds a second way of serving anything, because a
// preview that is not the real site is the thing this replaces.
//
// (`client-dev` — Vite with hot reload — stays the repository's for editing its own source, and a terminal still runs it.
// It is not a choice this page offers: a page that serves what was built has one way to serve it.)
//
// A server that is starting is not a server that is up, so `start` waits for the address to answer before it says
// running: a frame pointed at a port with nothing behind it is the grey page this avoids.

import { ChildProcess, spawn } from 'child_process';
import * as fs from 'fs';
import * as http from 'http';
import * as path from 'path';
import * as vscode from 'vscode';
import { repoReady, sitePort, siteRepo, siteUrl } from './siteRepo';

/** What the server is doing. */
export type SiteState = 'stopped' | 'starting' | 'running' | 'failed';

export interface SiteStatus {
	state: SiteState;
	/** The address the site answers at while it is running. */
	url?: string;
	/** Why it is not running, when it is not. */
	reason?: string;
}

/** Where a line of the server's own output goes. */
export type Log = (line: string) => void;

/** The repository's own script, and the words a person reads for each state. */
const SCRIPT = 'serve';

export function describe(status: SiteStatus, port = sitePort()): string {
	switch (status.state) {
		case 'running':
			return `running · localhost:${String(port)}`;
		case 'starting':
			return 'starting…';
		case 'failed':
			return 'failed';
		default:
			return 'stopped';
	}
}

const sleep = (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms));

/** Whether something answers at `url`. Any answer counts: a redirect still means the server is up. */
function answers(url: string): Promise<boolean> {
	return new Promise((resolve) => {
		const asked = http.get(url, { timeout: 1500 }, (response) => {
			response.resume();
			resolve(true);
		});
		asked.on('timeout', () => {
			asked.destroy();
			resolve(false);
		});
		asked.on('error', () => resolve(false));
	});
}

/** Stop a process and everything it started, and wait for it: `npm` is a shell whose children hold the port. */
function end(pid: number): Promise<void> {
	return new Promise((resolve) => {
		try {
			if (process.platform === 'win32') {
				const kill = spawn('taskkill', ['/pid', String(pid), '/T', '/F'], { windowsHide: true });
				kill.on('exit', () => resolve());
				kill.on('error', () => resolve());
			} else {
				process.kill(-pid, 'SIGTERM');
				resolve();
			}
		} catch {
			// A process that is already gone is the outcome that was wanted.
			resolve();
		}
	});
}

/**
 * The site's server: one server, started the one way the module serves the site.
 *
 * `serve` runs the repository's own script against `dist/`, on the one port. Starting it twice is not a thing a person means
 * to do, so a start while one is running first ends it.
 */
export class SiteRunner implements vscode.Disposable {
	private child: ChildProcess | undefined;
	private current: SiteStatus = { state: 'stopped' };
	private leaving = false;
	private readonly changed = new vscode.EventEmitter<SiteStatus>();

	readonly onDidChange = this.changed.event;

	constructor(private readonly read: () => string = siteRepo, private readonly port: () => number = sitePort) { }

	get status(): SiteStatus {
		return this.current;
	}

	get running(): boolean {
		return this.current.state === 'running' || this.current.state === 'starting';
	}

	/** The address the site answers at, whether or not it is up. */
	url(): string {
		return siteUrl(this.port());
	}

	/**
	 * Serve the built pages, and wait until they answer.
	 *
	 * They need something to serve, so a `dist` that was never built is built first rather than served as an empty folder.
	 */
	async start(log: Log): Promise<SiteStatus> {
		if (this.running) {
			return this.current;
		}
		const repo = this.read();
		if (!repoReady(repo)) {
			return this.fail(`The site repository is not at ${repo}. Choose the folder in the Documentation Site page.`);
		}
		const port = this.port();
		const url = siteUrl(port);
		this.set({ state: 'starting' });
		if (!fs.existsSync(path.join(repo, 'dist', 'index.html'))) {
			log('[site] dist/ was not there — building the site first.');
			const built = await this.run('build', log);
			if (built !== 0) {
				return this.fail('The site could not be built; the log says why.');
			}
		}

		const child = spawn(`npm run ${SCRIPT} -- --port ${String(port)}`, {
			cwd: repo,
			shell: true,
			windowsHide: true,
			detached: process.platform !== 'win32',
			env: process.env
		});
		this.child = child;
		child.stdout?.on('data', (chunk: Buffer) => log(String(chunk).trimEnd()));
		child.stderr?.on('data', (chunk: Buffer) => log(String(chunk).trimEnd()));
		child.on('error', (error: Error) => {
			if (this.child === child) {
				this.child = undefined;
				this.fail(`The server could not be started — ${error.message}`);
			}
		});
		child.on('exit', (code) => {
			if (this.child !== child) {
				return;
			}
			this.child = undefined;
			if (!this.leaving && this.current.state !== 'stopped') {
				this.fail(`The server stopped by itself${code === null ? '' : ` (exit ${String(code)})`} — the log says why.`);
			}
		});

		log(`[site] ${SCRIPT} is starting at ${url}`);
		const ready = await this.wait(url, 90000, () => this.child === child);
		if (!ready) {
			await this.stop();
			return this.fail(`The site did not answer at ${url}. The log says what the server said.`);
		}
		this.set({ state: 'running', url });
		return this.current;
	}

	/** Stop whatever is running. Nothing is left behind: the port is free afterwards, or `npm` did not own it. */
	async stop(): Promise<void> {
		const child = this.child;
		const pid = child?.pid;
		const url = this.url();
		this.child = undefined;
		this.leaving = true;
		this.set({ state: 'stopped' });
		if (pid !== undefined) {
			await end(pid);
			// The port is the proof, not the process: `npm` hands the server to a child that can outlive the kill.
			const until = Date.now() + 5000;
			while (Date.now() < until && (await answers(url))) {
				await sleep(250);
			}
		}
		this.leaving = false;
	}

	/** Run one git command in the clone (or beside it), streaming what it says. The exit code is the answer. */
	async git(args: readonly string[], log: Log, cwd = this.read()): Promise<number> {
		return new Promise((resolve) => {
			log('[git] git ' + args.join(' '));
			const child = spawn('git', [...args], { cwd, windowsHide: true, env: process.env });
			child.stdout?.on('data', (chunk: Buffer) => log(String(chunk).trimEnd()));
			child.stderr?.on('data', (chunk: Buffer) => log(String(chunk).trimEnd()));
			child.on('error', (error: Error) => {
				log('[git] ' + error.message);
				resolve(-1);
			});
			child.on('exit', (code) => resolve(code ?? -1));
		});
	}

	/** Fetch and fast-forward the clone. Never a merge and never a force: a clone that has diverged is a person's problem. */
	async pull(log: Log): Promise<number> {
		return this.git(['pull', '--ff-only'], log);
	}

	/** Clone the site beside nothing else, into the folder the module is pointed at. */
	async clone(url: string, folder: string, log: Log): Promise<number> {
		const parent = path.dirname(folder);
		log('[git] git clone ' + url + ' ' + folder);
		return this.git(['clone', url, folder], log, parent);
	}

	/** Run one of the repository's scripts to completion: `build`, `catalog`, or `install`. The exit code is the answer. */
	async run(script: string, log: Log): Promise<number> {
		const repo = this.read();
		const command = script === 'install' ? 'npm install' : 'npm run ' + script;
		return new Promise((resolve) => {
			const child = spawn(command, { cwd: repo, shell: true, windowsHide: true, env: process.env });
			child.stdout?.on('data', (chunk: Buffer) => log(String(chunk).trimEnd()));
			child.stderr?.on('data', (chunk: Buffer) => log(String(chunk).trimEnd()));
			child.on('error', (error: Error) => {
				log(`[site] ${script} could not run — ${error.message}`);
				resolve(-1);
			});
			child.on('exit', (code) => resolve(code ?? -1));
		});
	}

	dispose(): void {
		void this.stop();
		this.changed.dispose();
	}

	private async wait(url: string, ms: number, alive: () => boolean): Promise<boolean> {
		const until = Date.now() + ms;
		while (Date.now() < until) {
			if (!alive()) {
				return false;
			}
			if (await answers(url)) {
				return true;
			}
			await sleep(400);
		}
		return false;
	}

	private fail(reason: string): SiteStatus {
		this.set({ state: 'failed', reason });
		return this.current;
	}

	private set(status: SiteStatus): void {
		this.current = status;
		this.changed.fire(status);
	}
}
