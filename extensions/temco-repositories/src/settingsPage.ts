// The repositories module's settings, as a page.
//
// Two settings decide what the dashboard does before anything else can: which enterprise it opens on, and where a
// download lands. Both are plain VS Code settings — this page exists because a person should not have to know that,
// and because the same page is where the GitHub token is set and cleared.
//
// Every write goes through `configuration.update(..., Global)`: the same place the settings JSON writes to, so the two
// surfaces can never disagree.

import * as vscode from 'vscode';
import { tokenOf } from './read';
import { callout, hero, icon, page, pageColumn, remember, section } from './ui';
import { workRoot } from './workarea';

export const REPOSITORY_SETTINGS_VIEW_TYPE = 'temcoRepositories.settings';

interface SettingsMessage {
  type?: string;
  organisation?: string;
  workspaceFolder?: string;
}

/** The section every one of these settings lives in. */
const SECTION = 'temcoRepositories';

export class RepositorySettingsPage {
  private panel: vscode.WebviewPanel | undefined;

  constructor(private readonly context: vscode.ExtensionContext, private readonly refresh: () => void) { }

  open(restored?: vscode.WebviewPanel): void {
    remember(this.context, REPOSITORY_SETTINGS_VIEW_TYPE);
    if (this.panel) {
      this.panel.reveal(pageColumn());
      void this.send();
      return;
    }
    // A restored tab is drawn into rather than replaced: it keeps its place in the strip.
    this.panel = restored ?? vscode.window.createWebviewPanel(REPOSITORY_SETTINGS_VIEW_TYPE, 'Repository Settings', pageColumn(), {
      enableScripts: true,
      localResourceRoots: [],
    });
    this.panel.webview.options = { enableScripts: true, localResourceRoots: [] };
    this.panel.onDidDispose(() => {
      this.panel = undefined;
    });
    this.panel.webview.onDidReceiveMessage((message: SettingsMessage) => void this.receive(message));
    this.panel.webview.html = html();
    void this.send();
  }

  dispose(): void {
    this.panel?.dispose();
  }

  private async send(): Promise<void> {
    const panel = this.panel;
    if (!panel) {
      return;
    }
    const configuration = vscode.workspace.getConfiguration(SECTION);
    const token = await tokenOf(this.context);
    await panel.webview.postMessage({
      type: 'state',
      organisation: configuration.get<string>('organisation') ?? '',
      workspaceFolder: configuration.get<string>('workspaceFolder') ?? '',
      where: workRoot(),
      hasToken: token !== undefined,
    });
  }

  private async receive(message: SettingsMessage): Promise<void> {
    const configuration = vscode.workspace.getConfiguration(SECTION);
    switch (message.type) {
      case 'save':
        await configuration.update('organisation', (message.organisation ?? '').trim(), vscode.ConfigurationTarget.Global);
        await configuration.update(
          'workspaceFolder',
          (message.workspaceFolder ?? '').trim(),
          vscode.ConfigurationTarget.Global
        );
        this.refresh();
        await this.send();
        return;
      case 'pick':
        await vscode.commands.executeCommand('temcoRepositories.pickWorkspaceFolder');
        this.refresh();
        await this.send();
        return;
      case 'token':
        await vscode.commands.executeCommand('temcoRepositories.setToken');
        await this.send();
        return;
      case 'test':
        await vscode.commands.executeCommand('temcoRepositories.testToken');
        return;
      case 'json':
        await vscode.commands.executeCommand('workbench.action.openSettings', SECTION);
        return;
      default:
        return;
    }
  }
}

/**
 * The page, in the house language.
 *
 * The vocabulary is the kit's — the brand wash with a title, a section heading with the rule before it, an entry row with its
 * control at the right-hand end, and links at the foot of the block — because a settings page of this module and a settings
 * page of the workbench module are the same kind of thing and should not look like two applications.
 */
function html(): string {
  const style = `
    .az-section__title { position: relative; padding-left: 10px; }
    .az-section__title::before { content: ''; position: absolute; left: 0; top: 50%; transform: translateY(-50%);
      width: 2px; height: 12px; border-radius: 1px; background: var(--az-blue, #0078d4); }
    .az-entry__desc { display: block; margin-top: 1px; color: var(--ink-3); font-size: 12px; line-height: 16px; }
    .setting-control { display: flex; grid-column: 3; align-items: center; justify-content: flex-end;
      gap: var(--sp-2); min-width: 232px; font-size: 12px; line-height: 16px; }
    .setting-input { min-width: 220px; max-width: 260px; height: 24px; font-size: 12px; }
    .az-block__foot { display: flex; flex-wrap: wrap; gap: var(--sp-4); align-items: center;
      margin: var(--sp-4) 0 0; padding-top: var(--sp-2); border-top: 1px solid var(--border); }
    .footer-state { color: var(--fg-muted); font-size: var(--fs-sm); }
    .footer-state:empty { display: none; }
    @media (max-width: 640px) {
      .az-entry { grid-template-columns: 26px minmax(0, 1fr); }
      .az-entry .setting-control { grid-column: 1 / -1; justify-content: flex-start; margin-left: 38px; }
    }
  `;

  /** One setting, as an entry row: the glyph, the name, the sentence, and the control at the right-hand end. */
  const row = (mark: string, title: string, desc: string, control: string): string =>
    `<div class="az-entry"><span class="az-entry__icon">${icon(mark)}</span><div class="az-entry__main"><span class="az-entry__title">${title}</span><span class="az-entry__desc">${desc}</span></div><div class="setting-control">${control}</div></div>`;

  const body = `
${hero({
    title: 'Repository settings',
    mark: 'repo',
    desc: 'Which enterprise the page opens on, where a download lands, and the token that reaches a private repository.',
    descWide: true
  })}
${section({ title: 'Default enterprise', desc: 'The list the Repositories page opens on — one setting.' })}
<div class="az-entries">
  ${row('repo', 'Organisation', 'temcocontrols is the one the platform ships its own documentation from; any organisation or account works.', '<input class="input setting-input" id="organisation" spellcheck="false" placeholder="temcocontrols" aria-label="Organisation">')}
</div>
${section({ title: 'Downloads and drafts', desc: 'Every local copy is cloned here, and a draft written from a repository is written here — one setting.' })}
<div class="az-entries">
  ${row('folder', 'Folder', 'Deliberately outside every repository: nothing is ever written to a source, and nothing is pushed. Empty means <code>~/temco</code>.', '<input class="input setting-input" id="workspaceFolder" spellcheck="false" placeholder="~/temco" aria-label="Working folder"><button type="button" class="az-btn az-btn--sm" id="pick">Choose</button>')}
  ${row('info', 'Where copies land', 'Read from this profile, not from the field above — the dialog writes the setting the moment it closes.', '<span class="footer-state" id="where"></span>')}
</div>
${section({ title: 'GitHub token', desc: 'A private repository needs one, and so does the anonymous allowance running out early.' })}
<div class="az-entries">
  ${row('key', 'Token', 'Kept in the editor\'s secret storage, never in a file.', '<button type="button" class="az-btn az-btn--sm" id="token">Set a GitHub Token</button><button type="button" class="az-btn az-btn--sm" id="test">Test It</button>')}
  ${row('account', 'Token state', 'Whether the list this profile reaches is read with a token or anonymously.', '<span class="footer-state" id="token-state"></span>')}
</div>
${callout({
    title: 'Saved to your user settings, not to the workspace',
    desc: 'These two settings are the editor\'s own (temcoRepositories.organisation and .workspaceFolder), so the page, the settings JSON and the command palette all write the same place.'
  })}
<div class="az-block__foot">
  <button type="button" class="az-btn az-btn--link" id="json">${icon('code')}<span>Open the settings JSON</span></button>
  <span style="flex:1"></span>
  <span class="footer-state" id="state"></span>
  <button type="button" class="az-btn az-btn--primary" id="save">Save</button>
</div>
  `;

  return page(body, { title: 'Repository Settings', extraCss: style, script: CLIENT });
}

const CLIENT = `
const vscode = acquireVsCodeApi();
const $ = (id) => document.getElementById(id);
let state = {};

$('pick').addEventListener('click', () => vscode.postMessage({ type: 'pick' }));
$('token').addEventListener('click', () => vscode.postMessage({ type: 'token' }));
$('test').addEventListener('click', () => vscode.postMessage({ type: 'test' }));
$('json').addEventListener('click', () => vscode.postMessage({ type: 'json' }));
$('save').addEventListener('click', () => {
  vscode.postMessage({
    type: 'save',
    organisation: $('organisation').value,
    workspaceFolder: $('workspaceFolder').value
  });
});

window.addEventListener('message', (event) => {
  const message = event.data || {};
  if (message.type !== 'state') { return; }
  state = message;
  // The fields follow the settings, unless a person is typing in one: "Choose a folder…" writes the setting at once,
  // so the input has to catch up with an answer the dialog produced.
  if (document.activeElement !== $('organisation')) {
    $('organisation').value = message.organisation || '';
  }
  if (document.activeElement !== $('workspaceFolder')) {
    $('workspaceFolder').value = message.workspaceFolder || '';
  }
  $('where').textContent = 'Local copies land in ' + message.where;
  $('token-state').textContent = message.hasToken
    ? 'A token is stored. Setting a new one replaces it; leaving the box empty clears it.'
    : 'No token is stored — the list is read anonymously.';
  $('state').textContent = 'Saved to your user settings, not to the workspace.';
});
`;
