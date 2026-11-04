// A repository's file, opened in the editor instead of in a browser.
//
// Clicking a file in the panel used to hand it to GitHub, which means leaving the editor, a confirmation dialog for an
// external site, and a page you cannot search or copy a path out of. A file is a text document: it belongs in a tab,
// with the language it is written in, read-only because the platform never writes to a repository.
//
// The content comes from the same reader the rest of the module uses — the local copy when there is one, the contents
// API when there is not — so the tab shows the revision the platform is reading, not whatever the default branch has
// become.

import * as vscode from 'vscode';
import { RepositorySource, fileText } from './repository';

/** The scheme a repository file is opened under. Not `file:` — this document has no path on this machine. */
export const REPOSITORY_FILE_SCHEME = 'temco-repo';

/** The language a file is written in, from its extension. Only the ones this platform reads. */
const LANGUAGES: { [extension: string]: string } = {
	ts: 'typescript',
	tsx: 'typescriptreact',
	js: 'javascript',
	jsx: 'javascriptreact',
	c: 'c',
	h: 'c',
	cc: 'cpp',
	cpp: 'cpp',
	cxx: 'cpp',
	hpp: 'cpp',
	cs: 'csharp',
	py: 'python',
	java: 'java',
	kt: 'kotlin',
	go: 'go',
	rs: 'rust',
	swift: 'swift',
	m: 'objective-c',
	mm: 'objective-cpp',
	sql: 'sql',
	ps1: 'powershell',
	sh: 'shellscript',
	json: 'json',
	md: 'markdown',
	markdown: 'markdown',
	html: 'html',
	htm: 'html',
	css: 'css',
	scss: 'scss',
	less: 'less',
	yml: 'yaml',
	yaml: 'yaml',
	xml: 'xml',
	xaml: 'xml',
	ino: 'cpp',
	vue: 'vue',
	svg: 'xml',
};

export function languageOf(file: string): string | undefined {
	const dot = file.lastIndexOf('.');
	return dot < 0 ? undefined : LANGUAGES[file.slice(dot + 1).toLowerCase()];
}

/**
 * The URI one file of one repository opens under.
 *
 * `path` keeps `owner/repo/<file>` and the branch travels in the query: a URI is what the editor keys a document by,
 * so two files of two repositories with the same path stay two documents.
 */
export function repositoryFileUri(repository: string, branch: string, file: string): vscode.Uri {
	return vscode.Uri.from({
		scheme: REPOSITORY_FILE_SCHEME,
		path: `/${repository}/${file}`,
		query: `branch=${encodeURIComponent(branch)}`,
	});
}

/** Serves those URIs: the text of the file, from the copy or the API, with the failure written into the document. */
export class RepositoryFileProvider implements vscode.TextDocumentContentProvider {
	constructor(private readonly context: vscode.ExtensionContext) { }

	async provideTextDocumentContent(uri: vscode.Uri): Promise<string> {
		const parts = uri.path.replace(/^\//, '').split('/');
		const [owner, repository, ...file] = parts;
		const branch = new URLSearchParams(uri.query).get('branch') ?? 'main';
		const relative = file.join('/');

		const source: RepositorySource = {
			name: repository ?? relative,
			remoteUrl: `https://github.com/${owner}/${repository}`,
			branch,
			defaultBranch: branch,
		};
		const read = await fileText(this.context, source, relative);
		if ('error' in read) {
			// Said inside the document rather than in a dialog: the tab is where the question was asked.
			return [
				`${owner}/${repository}/${relative}`,
				'',
				`The file could not be read: ${read.error}`,
				'',
				'Clone this repository to read it from disk, or check the branch.',
				'',
			].join('\n');
		}
		return read.truncated ? `${read.text}\n\n… the file is larger than the viewer keeps …\n` : read.text;
	}
}
