// The file icon theme, as the workbench draws it — for the pages, which are the only place this module can use it.
//
// A tree item carries a codicon or an image (`sourcesView.ts` explains why), so the sidebar keeps that language. A page
// is a document, though: the theme's own font can be loaded into it, and then a glyph is the glyph the Explorer would
// give that file — the same icon, the same colour, from whichever theme the person chose. That is what this file reads:
// `workbench.iconTheme` → the contribution → its JSON → a `@font-face` per font and one rule per icon.
//
// Nothing is guessed: a theme that says nothing about a path returns `undefined`, and the caller draws its own glyph.

import * as fs from 'fs/promises';
import * as path from 'path';
import * as vscode from 'vscode';

/** What a page needs to draw the theme's own file icons. */
export interface FileIconTheme {
	/** The folder the theme's fonts live in: what a webview must be allowed to read. */
	folder: string;
	/** The style: `@font-face` per font, then one rule per icon the theme defines. */
	css: string;
	/** The glyph for a path, or `undefined` when this theme says nothing about it. */
	classFor(file: string, kind?: 'file' | 'folder' | 'folderOpen'): string | undefined;
}

interface IconDefinition {
	fontCharacter?: string;
	fontId?: string;
	fontColor?: string;
}

interface IconFont {
	id?: string;
	src?: { path: string; format?: string }[];
	weight?: string;
	style?: string;
}

/** The parts of an icon theme's JSON this module reads. `light` and `highContrast` hold the variants. */
interface IconThemeJson {
	fonts?: IconFont[];
	iconDefinitions?: Record<string, IconDefinition>;
	file?: string;
	folder?: string;
	folderExpanded?: string;
	fileNames?: Record<string, string>;
	fileExtensions?: Record<string, string>;
	folderNames?: Record<string, string>;
	folderNamesExpanded?: Record<string, string>;
	languageIds?: Record<string, string>;
	light?: Partial<IconThemeJson>;
	highContrast?: Partial<IconThemeJson>;
	highContrastLight?: Partial<IconThemeJson>;
}

/** A class name out of an icon id: ids carry characters CSS would not take as one word. */
function cssId(id: string): string {
	return id.replace(/[^A-Za-z0-9_-]/g, '_');
}

/** The theme the window is using, and the file it is described in. */
async function locate(): Promise<{ file: string } | undefined> {
	const id = vscode.workspace.getConfiguration('workbench').get<string>('iconTheme');
	if (id === undefined || id.length === 0 || id === 'none') {
		return undefined;
	}
	for (const extension of vscode.extensions.all) {
		const themes = (extension.packageJSON as { contributes?: { iconThemes?: { id?: string; path?: string }[] } })
			?.contributes?.iconThemes;
		const theme = themes?.find((candidate) => candidate.id === id);
		if (theme?.path !== undefined) {
			return { file: path.join(extension.extensionPath, theme.path) };
		}
	}
	return undefined;
}

/** Which overlay a theme kind reads: the workbench keeps the dark mapping at the top and the others beside it. */
function overlayFor(json: IconThemeJson): Partial<IconThemeJson> | undefined {
	switch (vscode.window.activeColorTheme.kind) {
		case vscode.ColorThemeKind.Light:
			return json.light;
		case vscode.ColorThemeKind.HighContrast:
			return json.highContrast ?? json.light;
		case vscode.ColorThemeKind.HighContrastLight:
			return json.highContrastLight ?? json.light;
		default:
			return undefined;
	}
}

/**
 * The glyph class for a path, following the workbench's own order: the name, then the extensions from the shortest to
 * the longest (`x.d.ts` is a TypeScript file before it is a `.d.ts`), then the **language** the file belongs to, and
 * last whatever the theme calls a file.
 *
 * The language step is not optional: the built-in theme maps almost no code extensions — `ts`, `css`, `json` are all
 * `languageIds` — so a reader that stopped at extensions would draw the default page icon for every source file.
 */
function matcher(
	theme: { names: Record<string, string>; extensions: Record<string, string>; languages: Record<string, string>; fallback: string | undefined },
	languageOf: (file: string) => string | undefined
) {
	return (file: string): string | undefined => {
		const base = (file.split('/').pop() ?? file).toLowerCase();
		const byName = theme.names[base];
		if (byName !== undefined) {
			return byName;
		}
		const parts = base.split('.');
		for (let index = parts.length - 1; index > 0; index--) {
			const byExtension = theme.extensions[parts.slice(index).join('.')];
			if (byExtension !== undefined) {
				return byExtension;
			}
		}
		const language = languageOf(file);
		if (language !== undefined && theme.languages[language] !== undefined) {
			return theme.languages[language];
		}
		return theme.fallback;
	};
}

/** Every language any installed extension declares, by file name and by extension — what the Explorer resolves a path by. */
let languages: { byName: Map<string, string>; byExtension: Map<string, string> } | undefined;

function languageTable(): { byName: Map<string, string>; byExtension: Map<string, string> } {
	if (languages !== undefined) {
		return languages;
	}
	const byName = new Map<string, string>();
	const byExtension = new Map<string, string>();
	for (const extension of vscode.extensions.all) {
		const declared = (extension.packageJSON as {
			contributes?: { languages?: { id?: string; extensions?: string[]; filenames?: string[] }[] };
		})?.contributes?.languages;
		for (const language of declared ?? []) {
			if (typeof language.id !== 'string' || language.id.length === 0) {
				continue;
			}
			for (const name of language.filenames ?? []) {
				const key = name.toLowerCase();
				if (!byName.has(key)) {
					byName.set(key, language.id);
				}
			}
			for (const suffix of language.extensions ?? []) {
				const key = suffix.replace(/^\./, '').toLowerCase();
				if (!byExtension.has(key)) {
					byExtension.set(key, language.id);
				}
			}
		}
	}
	languages = { byName, byExtension };
	return languages;
}

function languageOf(file: string): string | undefined {
	const base = (file.split('/').pop() ?? file).toLowerCase();
	const table = languageTable();
	const named = table.byName.get(base);
	if (named !== undefined) {
		return named;
	}
	const parts = base.split('.');
	for (let index = parts.length - 1; index > 0; index--) {
		const found = table.byExtension.get(parts.slice(index).join('.'));
		if (found !== undefined) {
			return found;
		}
	}
	return undefined;
}

export async function loadFileIconTheme(webview: vscode.Webview): Promise<FileIconTheme | undefined> {
	const found = await locate();
	if (found === undefined) {
		return undefined;
	}
	let json: IconThemeJson;
	try {
		json = JSON.parse(await fs.readFile(found.file, 'utf8')) as IconThemeJson;
	} catch {
		return undefined;
	}
	const overlay = overlayFor(json);
	const definitions: Record<string, IconDefinition> = { ...json.iconDefinitions, ...overlay?.iconDefinitions };
	const fileNames: Record<string, string> = { ...json.fileNames, ...overlay?.fileNames };
	const fileExtensions: Record<string, string> = { ...json.fileExtensions, ...overlay?.fileExtensions };
	const languageIds: Record<string, string> = { ...json.languageIds, ...overlay?.languageIds };
	const folderNames: Record<string, string> = { ...json.folderNames, ...overlay?.folderNames };
	const folderNamesExpanded: Record<string, string> = { ...json.folderNamesExpanded, ...overlay?.folderNamesExpanded };
	const file = matcher(
		{ names: fileNames, extensions: fileExtensions, languages: languageIds, fallback: overlay?.file ?? json.file },
		languageOf
	);
	const folder = overlay?.folder ?? json.folder;
	const folderExpanded = overlay?.folderExpanded ?? json.folderExpanded;
	if (Object.keys(definitions).length === 0) {
		return undefined;
	}

	const folderPath = path.dirname(found.file);
	const families = new Map<string, string>();
	let css = '';
	(json.fonts ?? []).forEach((font, index) => {
		const family = `temco-file-icon-${index}`;
		families.set(font.id ?? family, family);
		const sources = (font.src ?? [])
			.map((source) => `url("${webview.asWebviewUri(vscode.Uri.file(path.join(folderPath, source.path)))}") format("${source.format ?? 'woff'}")`)
			.join(', ');
		if (sources.length === 0) {
			return;
		}
		css += `@font-face { font-family: ${family}; font-style: ${font.style ?? 'normal'}; `
			+ `font-weight: ${font.weight ?? 'normal'}; src: ${sources}; }\n`;
	});
	const first = families.values().next().value as string | undefined;
	if (first === undefined) {
		return undefined;
	}
	css += '.ti { display: inline-block; font-style: normal; font-weight: normal; font-variant: normal; '
		+ 'line-height: 1; text-transform: none; -webkit-font-smoothing: antialiased; }\n';
	for (const [id, definition] of Object.entries(definitions)) {
		const family = (definition.fontId !== undefined ? families.get(definition.fontId) : undefined) ?? first;
		const glyph = (definition.fontCharacter ?? '').replace(/^\\/, '');
		if (glyph.length === 0) {
			continue;
		}
		if (definition.fontColor !== undefined) {
			css += `.ti-${cssId(id)} { color: ${definition.fontColor}; }\n`;
		}
		css += `.ti-${cssId(id)}::before { font-family: ${family}; content: "\\${glyph}"; }\n`;
	}

	const as = (id: string | undefined): string | undefined =>
		id === undefined || definitions[id] === undefined ? undefined : `ti ti-${cssId(id)}`;

	return {
		folder: folderPath,
		css,
		classFor: (target, kind = 'file') => {
			if (kind === 'folder') {
				const named = folderNames[(target.split('/').pop() ?? target).toLowerCase()];
				return as(named ?? folder);
			}
			if (kind === 'folderOpen') {
				const base = (target.split('/').pop() ?? target).toLowerCase();
				return as(folderNamesExpanded[base] ?? folderNames[base] ?? folderExpanded ?? folder);
			}
			return as(file(target));
		},
	};
}
