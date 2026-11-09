// The sample the Settings surfaces are drawn from.
//
// The mock's (`docs/mock/js/data.js`: `modules`), carried over: the module register is the platform's own statement
// about what ships, and the rest of these pages are settings the window owns. Which page each module opens is decided in
// `settingsPages.ts`, by module id — a mock surface name is not a command, and treating it as one pointed two rows at
// another module's page.

export interface ModuleRow {
	name: string;
	id: string;
	namespace: string;
	state: string;
	owns: string;
}

export const MODULES: ModuleRow[] = [
	{ name: 'Temco Workbench', id: 'temcocontrols.temco-workbench', namespace: 'temcoWorkbench', state: 'Active', owns: 'The application’s own surfaces: the dashboard, workspaces, what needs doing' },
	{ name: 'Temco UI', id: 'temcocontrols.temco-ui', namespace: 'temcoUi', state: 'Active', owns: 'Where a page of ours opens, and what a command argument means' },
	{ name: 'Temco Store', id: 'temcocontrols.temco-store', namespace: 'temcoStore', state: 'Active', owns: 'The platform’s own memory: the catalog, the selection, the naming rules' },
	{ name: 'Temco Docs', id: 'temcocontrols.temco-docs', namespace: 'temcoDocs', state: 'Active', owns: 'The registry, pages, checks, editor surfaces, and the writes' },
	{ name: 'Temco Repositories', id: 'temcocontrols.temco-repositories', namespace: 'temcoRepositories', state: 'Active', owns: 'The organisation, local copies, the working area, reading a source' },
	{ name: 'Temco Projects', id: 'temcocontrols.temco-projects', namespace: 'temcoProjects', state: 'Active', owns: 'Projects, sources, outputs, builds' },
	{ name: 'Temco AI', id: 'temcocontrols.temco-ai', namespace: 'temcoAi', state: 'Active', owns: 'The local runtime and models, the prompts, the panel, drafts and answers' },
	{ name: 'Temco SQL', id: 'temcocontrols.temco-sql', namespace: 'temcoSql', state: 'Reserved', owns: 'Registers, queries, export' },
	{ name: 'Temco NetTools', id: 'temcocontrols.temco-nettools', namespace: 'temcoNettools', state: 'Reserved', owns: 'Devices on the wire' },
	{ name: 'Temco BACnet', id: 'temcocontrols.temco-bacnet', namespace: 'temcoBacnet', state: 'Reserved', owns: 'Objects, points, trends' },
	{ name: 'Temco Device Manager', id: 'temcocontrols.temco-device-manager', namespace: 'temcoDevices', state: 'Reserved', owns: 'Fleets, firmware, health' }
];

/** What a release may publish, whether it is on by default, and the setting that carries the choice. */
export const ARTIFACTS = [
	{ name: 'Website', key: 'website', desc: 'The rendered site at the path below.', on: true },
	{ name: 'PDF', key: 'pdf', desc: 'One file per version, built from the same pages.', on: true },
	{ name: 'Offline help (CHM)', key: 'offlineHelp', desc: 'The Windows help file readers open from the Start menu.', on: true },
	{ name: 'Search index', key: 'searchIndex', desc: 'The static index the site loads to answer a search.', on: true },
	{ name: 'AI index', key: 'aiIndex', desc: 'Local chunks for the AI panel. Never uploaded with the site.', on: false }
];

/**
 * The colour themes the General page offers, in the order it lists them.
 *
 * Every entry is a theme this build ships, and the value written is the theme's settings id �?the same string
 * `workbench.colorTheme` holds. The dark themes come first because the platform is built dark; the light and
 * high-contrast themes sit beside them for anyone who needs one.
 */
export const THEMES = [
	{ value: 'Dark 2026', label: 'Dark 2026 (default)' },
	{ value: 'Dark Modern', label: 'Dark Modern' },
	{ value: 'Dark+', label: 'Dark+' },
	{ value: 'Default High Contrast', label: 'Dark High Contrast' },
	{ value: 'Monokai', label: 'Monokai' },
	{ value: 'Light 2026', label: 'Light 2026' },
	{ value: 'Light Modern', label: 'Light Modern' },
	{ value: 'Light+', label: 'Light+' },
	{ value: 'Visual Studio Light', label: 'Light (Visual Studio)' },
	{ value: 'Default High Contrast Light', label: 'Light High Contrast' }
];

