/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

// The Settings pages: a checkbox is only real if it writes the setting the editor reads.
//
// Two of these rows were reported as decoration and were not: the Startup view list has to come from the activity bar's
// manifests rather than a list someone typed, or a module added tomorrow cannot be started in; and breadcrumbs,
// telemetry and the update channel have to write the keys the editor and the updater already read, or the checkbox
// saves a value nobody honours.
//
// So this asks the page's own functions. `panelOptions` is given a set of extensions and must answer their activity bar
// containers, and `applySetting` is given a row and must write the expected key — including the refusals, because a
// setting that accepts anything is a setting a typo can break silently.

import assert from 'node:assert/strict';
import { existsSync } from 'node:fs';
import { createRequire, Module } from 'node:module';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { suite, standalone } from './harness.mts';

const here = fileURLToPath(new URL('../..', import.meta.url));
const load = createRequire(import.meta.url);
const out = (...parts: string[]): string => join(here, 'extensions', ...parts, 'out');

if (!existsSync(out('temco-workbench'))) {
	throw new Error('the extensions are not compiled — run `npm run test-temco`, which compiles before it tests.');
}

/** One extension as the page sees it: enough of a manifest to declare an activity bar container. */
interface FakeExtension {
	id: string;
	packageJSON: {
		publisher?: string;
		contributes?: { viewsContainers?: { activitybar?: { id: string; title?: string }[] } };
	};
}

/** A container declared by a module, as the manifest would declare it. */
const panel = (id: string, title: string) => ({ id, title });

/**
 * The other modules' exports, present and idle.
 *
 * `settingsPages` reads the UI module at load time, and every module refuses to work without the others. None of the
 * rows under test call into them, so anything asked answers `undefined`.
 */
const otherModule = new Proxy(
	{},
	{
		get: (_target, key) => {
			if (key === 'then') {
				return undefined;
			}
			return async () => undefined;
		}
	}
) as Record<string, unknown>;

let installed: FakeExtension[] = [];
let stored: Record<string, unknown> = {};
let updates: { section: string; key: string; value: unknown }[] = [];

const vscode = {
	ConfigurationTarget: { Global: 1, Workspace: 2 },
	workspace: {
		getConfiguration: (section: string) => ({
			get: <T>(key: string, fallback?: T): T | undefined => {
				const value = stored[`${section}.${key}`];
				return value === undefined ? fallback : (value as T);
			},
			update: async (key: string, value: unknown) => {
				updates.push({ section, key, value });
				stored[`${section}.${key}`] = value;
			}
		})
	},
	extensions: {
		get all() {
			return installed;
		},
		getExtension: (id: string) => (id.startsWith('temcocontrols.') ? { isActive: true, exports: otherModule } : undefined)
	},
	window: { showInformationMessage: async () => undefined, showWarningMessage: async () => undefined },
	commands: { registerCommand: () => ({ dispose: () => undefined }) },
	Uri: { file: (value: string) => ({ fsPath: value }), joinPath: (base: { fsPath: string }, ...parts: string[]) => ({ fsPath: join(base.fsPath, ...parts) }) }
};

const editorLoad = Module._load;
Module._load = function (request: string, parent: unknown, isMain: boolean): unknown {
	if (request === 'vscode') {
		return vscode;
	}
	return editorLoad.call(this, request, parent, isMain) as unknown;
};

interface Choice {
	value: string;
	label: string;
}

interface SettingsModule {
	panelOptions(): Choice[];
	applySetting(context: unknown, key: string, value: unknown, name?: string): Promise<void>;
}

const settings = load(join(out('temco-workbench'), 'settingsPages.js')) as SettingsModule;

/** A profile's state, which is where the page keeps the one thing that is not a preference: when a row changed. */
const context = {
	globalState: {
		get: () => undefined,
		update: async () => undefined
	},
	subscriptions: [],
	extensionUri: { fsPath: here }
};

const group = suite();
const test = (name: string, run: () => Promise<void> | void): void => group.test(name, run);

/** Reset what a person's configuration says, and what has been written. */
function fresh(options: { stored?: Record<string, unknown>; extensions?: FakeExtension[] } = {}): void {
	stored = options.stored ?? {};
	updates = [];
	installed = options.extensions ?? [];
}

/** The platform's own modules, as the editor would list them. */
const platform = (...containers: { extension: string; panels: { id: string; title: string }[] }[]): FakeExtension[] =>
	containers.map(entry => ({
		id: entry.extension,
		packageJSON: { publisher: 'temcocontrols', contributes: { viewsContainers: { activitybar: entry.panels } } }
	}));

// ---------- the Startup view list ----------

test('the Startup view offers the activity bar\'s own panels, in the manifests\' order', async () => {
	fresh({
		extensions: [
			...platform(
				{ extension: 'temcocontrols.temco-workbench', panels: [panel('temcoDashboard', 'Home')] },
				{ extension: 'temcocontrols.temco-docs', panels: [panel('temco', 'Documentation'), panel('temcoForum', 'Forum')] },
				{ extension: 'temcocontrols.temco-learn', panels: [panel('temcoLearn', 'Temco Learn')] }
			),
			// Not ours: another vendor's panel is not a place this platform can start in.
			{ id: 'someone.else', packageJSON: { publisher: 'someone', contributes: { viewsContainers: { activitybar: [panel('theirPanel', 'Theirs')] } } } }
		]
	});

	assert.deepEqual(
		settings.panelOptions().map(option => option.value),
		['temcoDashboard', 'temco', 'temcoForum', 'temcoLearn'],
		'the workbench first, then the other modules by id — and nothing from another publisher'
	);
});

test('a panel that is still stored but no longer declared stays visible, so the page cannot show a blank choice', async () => {
	fresh({
		stored: { 'temcoWorkbench.start.panel': 'temcoRetired' },
		extensions: platform({ extension: 'temcocontrols.temco-workbench', panels: [panel('temcoDashboard', 'Home')] })
	});

	assert.deepEqual(
		settings.panelOptions().map(option => option.value),
		['temcoDashboard', 'temcoRetired'],
		'the retired id is kept rather than silently swapped for something the person did not choose'
	);
});

test('a panel with no title of its own is offered by its id', async () => {
	fresh({
		extensions: [
			{
				id: 'temcocontrols.temco-tools',
				packageJSON: { publisher: 'temcocontrols', contributes: { viewsContainers: { activitybar: [{ id: 'temcoSql' }] } } }
			}
		]
	});
	assert.deepEqual(
		settings.panelOptions(),
		[
			{ value: 'temcoSql', label: 'temcoSql' },
			// The stored value is the default, and nothing declares it: it stays visible rather than vanishing.
			{ value: 'temcoDashboard', label: 'temcoDashboard' }
		]
	);
});

// ---------- the rows that were reported as decoration ----------

test('the breadcrumbs checkbox writes the key the editor registers', async () => {
	fresh();
	await settings.applySetting(context, 'breadcrumbs', false);
	assert.deepEqual(
		updates,
		[{ section: 'breadcrumbs', key: 'enabled', value: false }],
		'`breadcrumbs.enabled`, not `workbench.breadcrumbs.enabled`: the second is not a registered configuration and the editor refuses the write'
	);

	await settings.applySetting(context, 'breadcrumbs', true);
	assert.deepEqual(updates.at(-1), { section: 'breadcrumbs', key: 'enabled', value: true });
});

test('the telemetry checkbox writes the level the telemetry service reads', async () => {
	fresh();
	await settings.applySetting(context, 'telemetry', false);
	assert.deepEqual(updates, [{ section: 'telemetry', key: 'telemetryLevel', value: 'off' }]);

	await settings.applySetting(context, 'telemetry', true);
	assert.deepEqual(updates.at(-1), { section: 'telemetry', key: 'telemetryLevel', value: 'all' });
});

test('the update channel writes Stable or Preview, and nothing else', async () => {
	fresh();
	await settings.applySetting(context, 'updateChannel', 'Preview');
	assert.deepEqual(updates, [{ section: 'temcoWorkbench', key: 'updateChannel', value: 'Preview' }]);

	await settings.applySetting(context, 'updateChannel', 'nightly-from-the-internet');
	assert.deepEqual(updates.at(-1), { section: 'temcoWorkbench', key: 'updateChannel', value: 'Stable' }, 'an unknown channel is Stable');
});

test('a theme this build does not offer is refused rather than written', async () => {
	fresh();
	await settings.applySetting(context, 'theme', 'Not A Theme');
	assert.deepEqual(updates, [], 'a theme id that is not in the list must not reach settings.json');

	await settings.applySetting(context, 'theme', 'Light Modern');
	assert.deepEqual(
		updates.map(update => `${update.section}.${update.key}`),
		['window.autoDetectColorScheme', 'workbench.colorTheme'],
		'a chosen theme also takes the window off the OS appearance, or the choice is undone on the next system change'
	);
	assert.equal(updates.at(-1)?.value, 'Light Modern');
});

test('a startup panel that is not in the activity bar is refused rather than stored', async () => {
	fresh({ extensions: platform({ extension: 'temcocontrols.temco-workbench', panels: [panel('temcoDashboard', 'Home')] }) });
	await settings.applySetting(context, 'start', 'temcoNotAPanel');
	assert.deepEqual(updates, [], 'a startup view that cannot be opened is not a startup view');
});

test('a brand name is trimmed and an accent is only accepted as a colour', async () => {
	fresh();
	await settings.applySetting(context, 'productName', '   Temco Platform   ');
	assert.deepEqual(updates, [{ section: 'temcoWorkbench', key: 'branding.productName', value: 'Temco Platform' }]);

	updates = [];
	await settings.applySetting(context, 'productName', '   ');
	assert.deepEqual(updates, [], 'an empty name is not a name');

	await settings.applySetting(context, 'accent', 'blue');
	assert.deepEqual(updates, [], 'an accent is a hex colour or it is nothing');

	await settings.applySetting(context, 'accent', '#0b5cad');
	assert.deepEqual(updates, [{ section: 'temcoWorkbench', key: 'branding.accent', value: '#0b5cad' }]);
});

// ---------- the cases ----------

await standalone(import.meta.url, group.cases, 'the settings rows, and the list the Startup view is built from');
