// The sample the Help surfaces are drawn from.
//
// The shortcuts and the log files are the mock's (`docs/mock/js/data.js`: `shortcuts`, `logFiles`), plus the tail
// `help/logs` prints. The shortcuts are copied rather than derived — no extension can read a keybinding — but each one
// names the command it stands for, so the page can check that command against the list the host really registers. The
// log rows are the fallback for a profile whose log folder is empty; when it has files, the page lists those instead.

export interface Shortcut {
	label: string;
	keys: string[];
	note?: string;
	/** The command the key fires, when this build has one to check. */
	command?: string;
}

export interface ShortcutGroup {
	group: string;
	items: Shortcut[];
}

export const SHORTCUTS: ShortcutGroup[] = [
	{
		group: 'Window', items: [
			{ label: 'Command palette', keys: ['Ctrl', 'Shift', 'P'], note: 'every command, including the ones without a key', command: 'workbench.action.showCommands' },
			{ label: 'Go to a surface', keys: ['Ctrl', 'P'], note: 'the same list the side bar walks', command: 'workbench.action.quickOpen' },
			{ label: 'Toggle side bar', keys: ['Ctrl', 'B'], command: 'workbench.action.toggleSidebarVisibility' },
			{ label: 'Toggle panel', keys: ['Ctrl', 'J'], command: 'workbench.action.togglePanel' },
			{ label: 'Toggle AI bar', keys: ['Ctrl', 'Alt', 'B'], command: 'workbench.action.toggleAuxiliaryBar' }
		]
	},
	{
		group: 'Documents', items: [
			{ label: 'New page', keys: ['Ctrl', 'Alt', 'N'], note: 'opens the New Page flow', command: 'temcoDocs.newPage' },
			{ label: 'Read all sources', keys: ['Ctrl', 'Alt', 'R'], command: 'temcoRepositories.readAllSources' },
			{ label: 'Build everything', keys: ['Ctrl', 'Shift', 'B'], command: 'temcoDocs.buildSite' }
		]
	},
	{
		group: 'Editor', items: [
			{ label: 'Save draft', keys: ['Ctrl', 'S'], note: 'writes the registry, not a source file', command: 'workbench.action.files.save' },
			{ label: 'Submit for review', keys: ['Ctrl', 'Enter'], command: 'temcoDocs.validate' }
		]
	}
];

export interface LogFile {
	name: string;
	size: string;
	updated: string;
	tone: 'ok' | 'warn' | 'neutral';
	note: string;
}

export const LOG_FILES: LogFile[] = [
	{ name: 'main.log', size: '412 KB', updated: 'just now', tone: 'ok', note: 'the window process: startup, windows, updates' },
	{ name: 'renderer.log', size: '1.2 MB', updated: 'just now', tone: 'ok', note: 'this window: surfaces, panels, what was opened' },
	{ name: 'extension-host.log', size: '188 KB', updated: '2 minutes ago', tone: 'warn', note: 'the modules: activation, reads, builds' },
	{ name: 'agent-host.log', size: '0 KB', updated: 'never', tone: 'neutral', note: 'the local AI runtime, once it is started' }
];

/** The nine lines `help/logs` prints under the file list. */
export const LOG_TAIL = [
	'[12:04:11] main       window ready · profile Default · workspace T3000',
	'[12:04:12] renderer   workbench mounted · 9 modules registered',
	'[12:04:18] docs       registry loaded: 8 areas, 45 folders, 1,254 pages',
	'[12:05:02] modules    temco-docs activated in 84 ms',
	'[12:05:02] modules    temco-ai activated in 412 ms',
	'[12:06:31] agents     runtime qwen2.5-3b-instruct loaded (2.1 GB)',
	'[12:06:44] warning    temco-repositories: 1 repository is not cloned',
	'[12:08:53] docs       build 13.0.482 · chm 612 of 1,254 topics',
	'[12:09:10] net        T3-22I (192.168.10.31) did not answer Who-Is'
];

/** What a report may carry, and whether it does by default. */
export const ISSUE_INCLUDES = [
	{ name: 'Version and commit', detail: '1.143.0 · a5b5009', on: true },
	{ name: 'The last 200 log lines', detail: 'main.log and renderer.log', on: true },
	{ name: 'Workspace settings', detail: '2 overrides in ~/temco/t3000', on: true },
	{ name: 'A screen recording', detail: 'not available in the mock', on: false }
];
