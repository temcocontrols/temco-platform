// What the clone's own commands said, kept in the window that ran them.
//
// A build, a clone and a pull all explain themselves in the lines they print, and those lines otherwise scroll past in the
// output channel. The Site page keeps them, bounded, so the reason a server did not start is where the button that started
// it is.

/** The most lines a window keeps: enough for one build, not enough to grow without bound. */
const KEPT = 400;

export class SiteLog {
	private readonly lines: string[] = [];

	/** Record one line a command printed. Stamped, because two commands in a row otherwise read as one. */
	append(line: string): void {
		for (const part of line.split(/\r?\n/u)) {
			const text = part.trimEnd();
			if (text !== '') {
				this.lines.push(`${new Date().toISOString().slice(11, 19)}  ${text}`);
			}
		}
		if (this.lines.length > KEPT) {
			this.lines.splice(0, this.lines.length - KEPT);
		}
	}

	read(): readonly string[] {
		return [...this.lines];
	}

	clear(): void {
		this.lines.length = 0;
	}
}
