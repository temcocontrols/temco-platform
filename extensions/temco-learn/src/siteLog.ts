// What the clone's own commands said, kept in the window that ran them.
//
// A build, a clone and a pull all explain themselves in the lines they print, and those lines otherwise scroll past in the
// output channel. The Site page keeps them, bounded, so the reason a server did not start is where the button that started
// it is.

/** The most lines a window keeps: enough for one build, not enough to grow without bound. */
const KEPT = 400;

/**
 * How a line reads.
 *
 * - `action` — the module's own voice: "Set aside two paths", "Pulled sixteen commits". What a person did, and what came
 *   of it, is the line they are looking for; the command's own output is the evidence around it.
 * - `warn` — something did not happen: a refusal, a failed build, an `error:` from git.
 * - `plain` — everything a command printed.
 */
export type Tone = 'plain' | 'action' | 'warn';

/** One line of the log: what it says, and how it should read. */
export interface LogLine {
	/** `HH:MM:SS  text` — the stamp two commands in a row need to stay apart. */
	text: string;
	tone: Tone;
}

/** A command's own line that is a refusal, whatever wrote it: git says `error:` and `fatal:`, node says the same. */
const REFUSAL = /^(?:error|fatal|warning|ERR!)\b/iu;

export class SiteLog {
	private readonly lines: LogLine[] = [];

	/**
	 * Record one line a command printed.
	 *
	 * Stamped, because two commands in a row otherwise read as one. A line that starts with `error:` is a `warn` whatever
	 * the caller said, so git's own refusals are as visible as the module's — the reason a pull did nothing is usually in
	 * one of them.
	 */
	append(line: string, tone: Tone = 'plain'): void {
		for (const part of line.split(/\r?\n/u)) {
			const text = part.trimEnd();
			if (text !== '') {
				const held = tone === 'plain' && REFUSAL.test(text) ? 'warn' : tone;
				this.lines.push({ text: `${new Date().toISOString().slice(11, 19)}  ${text}`, tone: held });
			}
		}
		if (this.lines.length > KEPT) {
			this.lines.splice(0, this.lines.length - KEPT);
		}
	}

	read(): readonly LogLine[] {
		return this.lines.map((line) => ({ ...line }));
	}

	clear(): void {
		this.lines.length = 0;
	}
}
