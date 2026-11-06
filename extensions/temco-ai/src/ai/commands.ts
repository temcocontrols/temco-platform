// The list a person picks from: what is installed, what can be downloaded, and how to undo it.
//
// This is the whole user interface of the local AI so far. It exists before the AI does, deliberately:
// choosing a model and moving it off the disk is the part that has to be trustworthy first.

import * as vscode from 'vscode';
import { AiPage } from '../aiPage';
import { CatalogEntry, MODELS, entryById, formatBytes, runtimeFor } from './catalog';
import { InstalledArtifact, install, installedArtifacts, modelRoot, uninstall } from './install';
import { aiStatus, showAiLog, stopAiServer } from './runtime';
import { AI_PAGE_VIEW_TYPE } from '../surface';
import { restore } from '../ui';

interface Choice extends vscode.QuickPickItem {
  entry?: CatalogEntry;
  installed?: InstalledArtifact;
  action?: 'folder' | 'remove';
}

interface Removal extends vscode.QuickPickItem {
  artifact: InstalledArtifact;
}

export function registerAiCommands(context: vscode.ExtensionContext, panel: { isVisible(): boolean }): void {
  const page = new AiPage(context);
  context.subscriptions.push(
    // An argument from a caller that knows what the reader came for: the panel's "choose a model" means the
    // downloads, so the page opens there rather than at its top.
    vscode.commands.registerCommand('temcoAi.page', (section?: string) =>
      page.open(section === 'downloads' ? 'downloads' : undefined)
    ),
    // Focusing the panel, and optionally bringing a page with it: a triage tab or the stale list knows which page it
    // means, and the panel answers about the page that is open — so the hand-off is an open, not a second way of
    // naming a page.
    vscode.commands.registerCommand('temcoAi.openPanel', (target?: unknown) => openPanel(panel, target)),
    vscode.commands.registerCommand('temcoAi.models', () => chooseModel(context)),
    vscode.commands.registerCommand('temcoAi.removeModel', () => removeModel(context)),
    vscode.commands.registerCommand('temcoAi.openModelFolder', async () => {
      await vscode.env.openExternal(vscode.Uri.file(modelRoot(context)));
    }),
    // The three offered models are a starting point, not a fence: any GGUF build the engine can read works, so the
    // way to the rest of them is one click out rather than a link written into the page's prose.
    vscode.commands.registerCommand('temcoAi.browseModels', async () => {
      await vscode.env.openExternal(vscode.Uri.parse('https://huggingface.co/models?library=gguf&sort=trending'));
    }),
    vscode.commands.registerCommand('temcoAi.dockRight', () => dockRight()),
    vscode.commands.registerCommand('temcoAi.status', () => showAiStatus(context)),
    // The page that was open when the window closed comes back with its tab, on the section it was showing.
    ...restore(context, [
      {
        viewType: AI_PAGE_VIEW_TYPE,
        open: (panel, arg) => page.open(arg === 'downloads' ? 'downloads' : undefined, panel)
      }
    ])
  );
}

/** The view id the AI is contributed under — the argument VS Code's own move-view command wants. */
const AI_VIEW = 'temcoAi.panel';

/** The file a caller handed over: a path, or an object carrying one. Anything else names no page. */
function fileOf(target: unknown): string | undefined {
	if (typeof target === 'string') {
		return target.length > 0 ? target : undefined;
	}
	if (target !== null && typeof target === 'object') {
		const value = (target as { path?: unknown; fsPath?: unknown }).path ?? (target as { fsPath?: unknown }).fsPath;
		return typeof value === 'string' && value.length > 0 ? value : undefined;
	}
	return undefined;
}

/**
 * Focuses the AI panel, opening the page a caller named first, or closes it when it is already on screen.
 *
 * The panel answers about the page that is open, and the documentation module owns how a page opens (one group, never
 * a split) — so this asks it rather than choosing a column here. A module that is not installed leaves the page
 * unopened, and the panel still gets the focus.
 *
 * A plain open toggles: the row that opens the conversation is the row a reader reaches for again to put it away, and
 * a button that only ever opened would leave them hunting the side bar's own close control. A caller that names a
 * page is asking to *see that page*, so it never closes anything.
 */
async function openPanel(panel: { isVisible(): boolean }, target?: unknown): Promise<void> {
	const file = fileOf(target);
	if (file === undefined && panel.isVisible()) {
		await vscode.commands.executeCommand('workbench.action.closeAuxiliaryBar');
		return;
	}
	if (file !== undefined) {
		await vscode.commands.executeCommand('temcoDocs.openFile', file).then(undefined, () => undefined);
	}
	await vscode.commands.executeCommand(`${AI_VIEW}.focus`);
}
/** The contributed container, as VS Code names it: every contributed container is prefixed this way. */
const AI_CONTAINER = 'workbench.view.extension.temcoAi';

/**
 * Shows the AI in the right side bar — which is where it is *declared*, so this is also the repair.
 *
 * The container is contributed under `viewsContainers.secondarySidebar`, so the secondary side bar is its
 * default location and a fresh install needs nothing at all. If someone has since dragged it to the panel or
 * the primary side bar, VS Code registers a **reset-location** command per container
 * (`<containerId>.resetViewContainerLocation`) that puts it back where it is declared — no picker, no drag, and
 * no guessing at where a view currently lives, which the extension API does not expose.
 */
async function dockRight(): Promise<void> {
  await vscode.commands.executeCommand(`${AI_VIEW}.focus`);
  try {
    await vscode.commands.executeCommand(`${AI_CONTAINER}.resetViewContainerLocation`);
  } catch (error) {
    void vscode.window.showWarningMessage(
      'Temco AI: this VS Code build would not reset the container location. Drag the “Temco AI” ' +
      `tab to the right side bar instead — it is the same move. (${String(error)})`
    );
  }
}

/** One place to see which runtime and model are in use, and whether the server is up. */
async function showAiStatus(context: vscode.ExtensionContext): Promise<void> {
  const status = aiStatus(context);
  const label = status.model ? entryById(status.model.id)?.label ?? status.model.id : undefined;
  const summary = label
    ? `${status.running ? 'running' : 'stopped'} · ${label}`
    : 'nothing installed yet — no model, so no server';

  const items = status.running
    ? ['Open the panel', 'Stop the server', 'Show the log', 'Server & Prompts']
    : ['Open the panel', 'Server & Prompts', 'Show the log'];
  const answer = await vscode.window.showInformationMessage(
    `Temco AI: local AI — ${summary}`,
    ...items
  );

  if (answer === 'Open the panel') {
    await vscode.commands.executeCommand('temcoAi.panel.focus');
  } else if (answer === 'Stop the server') {
    stopAiServer();
  } else if (answer === 'Show the log') {
    showAiLog();
  } else if (answer === 'Server & Prompts') {
    await vscode.commands.executeCommand('temcoAi.page');
  }
}

async function chooseModel(context: vscode.ExtensionContext): Promise<void> {
  const installed = installedArtifacts(context);
  const have = new Set(installed.map((artifact) => artifact.id));
  const configuration = vscode.workspace.getConfiguration('temcoAi');
  const chosenModel = configuration.get<string>('model', '');
  const chosenRuntime = configuration.get<string>('runtime', '');

  const items: Choice[] = [];

  if (installed.length > 0) {
    items.push({ label: 'Installed', kind: vscode.QuickPickItemKind.Separator });
    for (const artifact of installed) {
      const entry = entryById(artifact.id);
      const chosen = artifact.kind === 'runtime' ? chosenRuntime === artifact.id : chosenModel === artifact.id;
      items.push({
        label: entry?.label ?? artifact.id,
        description: `${formatBytes(artifact.bytes)}${entry ? ` · ${entry.licence}` : ''}${chosen ? ' · in use' : ''}`,
        detail: artifact.path,
        installed: artifact,
      });
    }
  }

  const thisRuntime = runtimeFor(process.platform, process.arch);
  const available: CatalogEntry[] = [];
  if (thisRuntime && !have.has(thisRuntime.id)) {
    available.push(thisRuntime);
  }
  for (const model of MODELS) {
    if (!have.has(model.id)) {
      available.push(model);
    }
  }
  if (available.length > 0) {
    items.push({ label: 'Available to download', kind: vscode.QuickPickItemKind.Separator });
    for (const entry of available) {
      items.push({
        label: entry.label,
        description: `${formatBytes(entry.bytes)} · ${entry.licence}${entry.sha256 ? '' : ' · checksum not pinned'}`,
        detail: entry.needs ?? entry.notes ?? entry.url,
        entry,
      });
    }
  }

  items.push({ label: 'This folder', kind: vscode.QuickPickItemKind.Separator });
  items.push({ label: '$(folder-opened) Open the folder', detail: modelRoot(context), action: 'folder' });
  if (installed.length > 0) {
    items.push({ label: '$(trash) Remove something that is installed…', action: 'remove' });
  }

  const picked = await vscode.window.showQuickPick(items, {
    title: 'Temco AI: the local runtime and its models',
    placeHolder: thisRuntime
      ? 'Nothing ships with the extension — a download is verified against the catalog'
      : `No runtime in the catalog is built for ${process.platform}/${process.arch}`,
  });
  if (!picked) {
    return;
  }

  if (picked.action === 'folder') {
    await vscode.env.openExternal(vscode.Uri.file(modelRoot(context)));
    return;
  }
  if (picked.action === 'remove') {
    await removeModel(context);
    return;
  }

  if (picked.installed) {
    await use(picked.installed.kind, picked.installed.id);
    vscode.window.showInformationMessage(
      `Temco AI: ${picked.label} is now the one in use.`
    );
    return;
  }

  if (!picked.entry) {
    return;
  }
  try {
    const artifact = await install(context, picked.entry);
    await use(picked.entry.kind, picked.entry.id);
    void vscode.window.showInformationMessage(
      `Temco AI: ${picked.entry.label} is installed — ${formatBytes(artifact.bytes)}, ` +
      `sha256 ${artifact.sha256.slice(0, 12)}…`
    );
  } catch (error) {
    void vscode.window.showWarningMessage(`Temco AI: ${messageOf(error)}`);
  }
}

async function removeModel(context: vscode.ExtensionContext): Promise<void> {
  const installed = installedArtifacts(context);
  if (installed.length === 0) {
    void vscode.window.showInformationMessage('Temco AI: nothing is installed yet.');
    return;
  }

  const picks: Removal[] = installed.map((artifact) => ({
    label: entryById(artifact.id)?.label ?? artifact.id,
    description: formatBytes(artifact.bytes),
    detail: artifact.path,
    artifact,
  }));

  const picked = await vscode.window.showQuickPick(picks, {
    title: 'Temco AI: remove what is installed',
  });
  if (!picked) {
    return;
  }

  const answer = await vscode.window.showWarningMessage(
    `Remove "${picked.label}"?`,
    { modal: true, detail: `This deletes:\n${picked.artifact.path}` },
    'Remove'
  );
  // A running server must not outlive the files it was started from.
  const before = aiStatus(context);
  if (answer !== 'Remove' || !uninstall(context, picked.artifact.id)) {
    return;
  }
  const wasServing =
    before.running !== undefined &&
    (before.running.modelPath === picked.artifact.path ||
      before.runtime?.path === picked.artifact.path);
  if (wasServing) {
    stopAiServer();
  }

  // What has been removed must not stay selected.
  const configuration = vscode.workspace.getConfiguration('temcoAi');
  const key = picked.artifact.kind === 'runtime' ? 'runtime' : 'model';
  if (configuration.get<string>(key, '') === picked.artifact.id) {
    await configuration.update(key, '', vscode.ConfigurationTarget.Global);
  }
  void vscode.window.showInformationMessage(`Temco AI: ${picked.label} was removed.`);
}

/** Records which artifact is the one in use. It is a user-level choice, not a repository's. */
async function use(kind: string, id: string): Promise<void> {
  const key = kind === 'runtime' ? 'runtime' : 'model';
  await vscode.workspace
    .getConfiguration('temcoAi')
    .update(key, id, vscode.ConfigurationTarget.Global);
}

function messageOf(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
