/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

// What only a real window can answer.
//
// Every other suite in `test/temco` stubs the editor, which is what makes them fast and runnable anywhere — and which is
// exactly why they cannot see the failure that matters most in production: a module that does not activate. A module whose
// `activate` throws registers no commands, draws no pages, and reports nothing; the application still starts, the activity
// bar still draws the containers the manifest declares, and every button in it does nothing.
//
// So this runs *inside* the extension host of the built application and asks the running editor: is each module active,
// is each declared command registered, does the catalog open in this window's own profile, and does a setting round-trip
// through the editor's own configuration service. No UI is driven: everything here is an API call whose answer only a real
// host can give.

import * as assert from 'node:assert/strict';
import * as fs from 'node:fs';
import * as path from 'node:path';
import * as vscode from 'vscode';

/** The repository, passed in by the runner: the manifests on disk are the list of what must exist in here. */
const repo = process.env['TEMCO_REPO'];
if (typeof repo !== 'string' || repo.length === 0) {
	throw new Error('TEMCO_REPO is not set, so the manifests cannot be read');
}

interface Manifest {
	publisher?: string;
	name?: string;
	contributes?: { commands?: { command?: string }[] };
}

interface Installed {
	where: string;
	manifest: Manifest;
}

/** Every temco module installed in this build, by folder. */
function modules(): Installed[] {
	const folder = path.join(repo as string, 'extensions');
	return fs
		.readdirSync(folder)
		.filter(name => name.startsWith('temco-'))
		.map(name => path.join(folder, name))
		.filter(where => fs.existsSync(path.join(where, 'package.json')))
		.map(where => ({ where, manifest: JSON.parse(fs.readFileSync(path.join(where, 'package.json'), 'utf8')) as Manifest }));
}

const installed = modules();

interface Case {
	name: string;
	run: () => Promise<void>;
}

const cases: Case[] = [];

/** Give the editor a moment: activation is asynchronous and a command registered late is still registered. */
const settle = () => new Promise(resolve => setTimeout(resolve, 250));

cases.push({
	name: 'every module in this build activates, and none of them throws on the way',
	run: async () => {
		const refused: string[] = [];
		for (const { manifest } of installed) {
			const id = `${manifest.publisher}.${manifest.name}`;
			const extension = vscode.extensions.getExtension(id);
			if (extension === undefined) {
				refused.push(`${id} is not installed`);
				continue;
			}
			try {
				await extension.activate();
			} catch (error) {
				refused.push(`${id} threw while activating: ${error instanceof Error ? error.message : String(error)}`);
				continue;
			}
			if (!extension.isActive) {
				refused.push(`${id} did not finish activating`);
			}
		}
		assert.deepEqual(refused, [], 'a module that will not start registers nothing and says nothing');
	}
});

cases.push({
	name: 'every command the manifests declare is registered in a real window',
	run: async () => {
		await settle();
		const registered = new Set(await vscode.commands.getCommands(true));
		const missing: string[] = [];
		for (const { manifest } of installed) {
			for (const entry of manifest.contributes?.commands ?? []) {
				if (typeof entry.command === 'string' && !registered.has(entry.command)) {
					missing.push(entry.command);
				}
			}
		}
		assert.deepEqual(missing, [], 'a declared command nobody registered is a button that does nothing');
	}
});

cases.push({
	name: 'the catalog opens in this window\'s own profile, and answers',
	run: async () => {
		const store = vscode.extensions.getExtension('temcocontrols.temco-store');
		assert.ok(store !== undefined, 'the store module is installed');
		const api = store.exports as {
			catalog(): Promise<{
				documents(): unknown[];
				counts(): [string, number][];
				integrity(): string;
				close(): void;
			}>;
		};
		assert.ok(typeof api.catalog === 'function', 'the store publishes its catalog');

		const catalog = await api.catalog();
		try {
			assert.ok(Array.isArray(catalog.documents()), 'the database is open, not merely described');
			assert.ok(Array.isArray(catalog.counts()) && catalog.counts().length > 0, 'the tables really exist');
			assert.equal(catalog.integrity(), 'ok');
		} finally {
			catalog.close();
		}
	}
});

cases.push({
	name: 'a setting a Settings page writes is read back by the editor, because the editor registers it',
	run: async () => {
		// The real question is not whether the value can be written — it is whether the key exists at all. A row that
		// writes an unregistered key throws here (`workbench.breadcrumbs.enabled` did), which no stubbed configuration
		// service can reproduce.
		const resource = vscode.Uri.file(repo as string);
		const breadcrumbs = vscode.workspace.getConfiguration('breadcrumbs', resource);
		const platform = vscode.workspace.getConfiguration('temcoWorkbench', resource);

		assert.ok(
			vscode.workspace.getConfiguration(undefined, resource).has('breadcrumbs.enabled'),
			'breadcrumbs.enabled is a configuration this editor knows'
		);

		const before = breadcrumbs.get<boolean>('enabled', true);
		const beforeChannel = platform.get<string>('updateChannel', 'Stable');
		try {
			await breadcrumbs.update('enabled', false, vscode.ConfigurationTarget.Global);
			assert.equal(
				vscode.workspace.getConfiguration('breadcrumbs', resource).get('enabled'),
				false,
				'the breadcrumbs checkbox has to reach the setting the editor reads'
			);

			await platform.update('updateChannel', 'Preview', vscode.ConfigurationTarget.Global);
			assert.equal(
				vscode.workspace.getConfiguration('temcoWorkbench', resource).get('updateChannel'),
				'Preview',
				'the update channel has to be stored where the updater looks'
			);
		} finally {
			await breadcrumbs.update('enabled', before, vscode.ConfigurationTarget.Global);
			await platform.update('updateChannel', beforeChannel, vscode.ConfigurationTarget.Global);
		}
	}
});

export { cases };
