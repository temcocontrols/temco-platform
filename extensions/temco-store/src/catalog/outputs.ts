// What a project can build, said once.
//
// Three screens are about the same five things: the create form ticks them, Build Center runs one script per tick, and
// Publish & Releases shows what each one holds. A list copied into each of them drifts the moment one is renamed — and
// the drift is invisible, because each screen keeps working while disagreeing with the others. So the list lives in the
// module every one of those screens already talks to.
//
// Two names matter here and they are not the same name:
// - `value` is what `recipes.outputs` stores, and what a build is asked for: `website`, `pdf`, `help`, `search`, `ai`.
// - `kind` is what the artifacts table records for it: `site`, `pdf`, `chm`, `search`, `ai`. `website` and `site` are
//   one target under the names two generations of the recipe have used, which is why the pair is written down here
//   rather than guessed at a call site.
//
// `scripts` are the repository's own script names, in the order they are tried. Empty means nothing in this repository
// makes that output — a fact the pages state in words rather than hiding behind an empty list.

/** One thing a project can be built into. */
export interface ProjectOutput {
	/** What `recipes.outputs` stores and a build is asked for. */
	value: string;
	/** What the artifacts table records for it. */
	kind: string;
	label: string;
	/** The glyph a card or a row wears. */
	mark: string;
	/** One line for a card: what a reader gets. */
	purpose: string;
	/** The names this output's build runs, in a repository's own `package.json`. Empty when nothing here makes it. */
	scripts: readonly string[];
	/** When something other than this repository makes it, the sentence that says who. */
	madeBy?: string;
}

/** The five, in the order a person meets them: the site, then what is printed, then the indexes. */
export const PROJECT_OUTPUTS: readonly ProjectOutput[] = [
	{
		value: 'website',
		kind: 'site',
		label: 'Website',
		mark: 'globe',
		purpose: 'The pages a reader opens on Temco Learn',
		scripts: ['docs:site', 'docs:build']
	},
	{
		value: 'pdf',
		kind: 'pdf',
		label: 'PDF',
		mark: 'document',
		purpose: 'One document, printed for download',
		scripts: ['docs:pdf', 'build:pdf']
	},
	{
		value: 'help',
		kind: 'chm',
		label: 'Offline help',
		mark: 'package',
		purpose: 'The CHM a reader downloads and opens offline',
		scripts: ['build:help:dry', 'docs:help']
	},
	{
		value: 'search',
		kind: 'search',
		label: 'Search index',
		mark: 'search',
		purpose: 'Search as you type, over every page of the site',
		scripts: [],
		madeBy: 'The site writes this index when a build of the pages is imported'
	},
	{
		value: 'ai',
		kind: 'ai',
		label: 'AI index',
		mark: 'sparkle',
		purpose: 'Embeddings for answers, kept on this machine',
		scripts: [],
		madeBy: 'Kept on this machine only, so it is never published'
	}
];

/** What a new project ticks: everything a reader can be given, which is everything but the machine’s own index. */
export const DEFAULT_OUTPUTS: readonly string[] = ['website', 'pdf', 'help', 'search'];

/** One output by what the recipe stores, with `html`/`site` read as the website they have always meant. */
export function outputByValue(value: string): ProjectOutput | undefined {
	const name = value.toLowerCase();
	const alias = name === 'site' || name === 'html' ? 'website' : name;
	return PROJECT_OUTPUTS.find((output) => output.value === alias);
}

/** One output by the kind its files are recorded under, with `output` read as the website it has always meant. */
export function outputByKind(kind: string): ProjectOutput | undefined {
	const name = kind.toLowerCase();
	const alias = name === 'output' ? 'site' : name;
	return PROJECT_OUTPUTS.find((output) => output.kind === alias);
}

/** The outputs a stored recipe names, in the canonical order, with anything unknown left out. */
export function chosenOutputs(stored: readonly string[]): ProjectOutput[] {
	const known = new Set(stored.flatMap((value) => outputByValue(value)?.value ?? []));
	return PROJECT_OUTPUTS.filter((output) => known.has(output.value));
}

/** The script a build would run for this output here, or undefined when this repository has none of them. */
export function scriptFor(output: ProjectOutput, scripts: Record<string, string> | readonly string[]): string | undefined {
	const has = (name: string): boolean => Array.isArray(scripts) ? scripts.includes(name) : (scripts as Record<string, string>)[name] !== undefined;
	// The deploying form of the help build copies files into a product installation, and building is not shipping.
	return output.scripts.find((name) => name !== 'build:help' && has(name));
}
