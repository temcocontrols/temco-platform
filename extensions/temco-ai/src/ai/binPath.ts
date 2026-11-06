// Where the tool server is, and what it needs to know.
//
// The server is an installed artifact, exactly like the runtime and the models: a catalog entry, a checksum,
// a folder under `modelRoot(context)`. Nothing here hard-codes an absolute install path, so
// `temcoAi.modelFolder` moves the server with everything else.

import * as fs from 'fs';
import * as path from 'path';
import * as vscode from 'vscode';
import { CatalogEntry, toolServerFor } from './catalog';
import { install, installedArtifacts, modelRoot } from './install';
import { catalogDatabasePath } from './store';

/** The catalog entry for this machine, if the catalogue has one for it. */
export function serverEntry(): CatalogEntry | undefined {
  return toolServerFor(process.platform, process.arch);
}

/** The name the executable has on this platform. */
function executableName(): string {
  return process.platform === 'win32' ? 'temco-mcp.exe' : 'temco-mcp';
}

/** The folder a published artifact occupies once it is unpacked. */
export function serverFolder(context: vscode.ExtensionContext): string | undefined {
  const entry = serverEntry();
  return entry ? path.join(modelRoot(context), entry.id) : undefined;
}

/** The executable inside it. */
export function serverExecutable(context: vscode.ExtensionContext): string | undefined {
  const folder = serverFolder(context);
  return folder ? path.join(folder, executableName()) : undefined;
}

/**
 * The installed executable, or `undefined` when there is none on this machine yet.
 *
 * Three places are tried, in order: what the installer recorded, a published folder dropped into the install
 * root, and a published folder inside this extension - which is how the server runs from a source checkout
 * before any release carries one. The middle one is what `temcoAi.modelFolder` moves with the models.
 */
export function serverBinary(context: vscode.ExtensionContext): string | undefined {
  const entry = serverEntry();
  if (!entry) {
    return undefined;
  }

  const installed = installedArtifacts(context).find((artifact) => artifact.id === entry.id);
  if (installed && fs.existsSync(installed.path)) {
    return installed.path;
  }

  const published = serverExecutable(context);
  if (published && fs.existsSync(published)) {
    return published;
  }

  const beside = path.join(
    context.extensionUri.fsPath,
    'bin',
    entry.id.replace(/^temco-mcp-/, ''),
    executableName()
  );
  return fs.existsSync(beside) ? beside : undefined;
}

/** Installs it if it is missing, and answers with the executable path. */
export async function ensureServerBinary(context: vscode.ExtensionContext): Promise<string> {
  const existing = serverBinary(context);
  if (existing) {
    return existing;
  }

  const entry = serverEntry();
  if (!entry) {
    throw new Error(
      `No tool server is published for ${process.platform}-${process.arch}, so the assistant cannot call anything here.`
    );
  }

  try {
    const artifact = await install(context, entry);
    return artifact.path;
  } catch (error) {
    const reason = error instanceof Error ? error.message : String(error);
    throw new Error(`${reason}\n\n${buildHint(context)}`);
  }
}

/**
 * How to get a server onto this machine without a release: build it from the source tree when the window is
 * running out of one, and say where it belongs either way.
 */
export function buildHint(context: vscode.ExtensionContext): string {
  const folder = serverFolder(context) ?? '<install root>';
  const entry = serverEntry();
  const rid = entry ? entry.id.replace(/^temco-mcp-/, '') : 'win-x64';
  const project = projectFile(context);
  if (!project) {
    return `The tool server belongs in ${folder}.`;
  }
  return [
    'To build it from this checkout:',
    `  dotnet publish "${project}" -c Release -r ${rid} --self-contained true -p:PublishSingleFile=false -o "${folder}"`,
  ].join('\n');
}

/** The server project, when this window is running out of a checkout that has one. */
function projectFile(context: vscode.ExtensionContext): string | undefined {
  const root = path.resolve(context.extensionUri.fsPath, '..', '..');
  const project = path.join(root, 'tools', 'temco-mcp', 'Temco.Mcp.csproj');
  return fs.existsSync(project) ? project : undefined;
}

/** What the server is told about this machine. Nothing else is inherited. */
export function serverEnv(context: vscode.ExtensionContext): Record<string, string> {
  const env: Record<string, string> = {};
  for (const key of ['PATH', 'HOME', 'USERPROFILE', 'SystemRoot', 'TEMP', 'TMP', 'TMPDIR', 'LANG']) {
    const value = process.env[key];
    if (typeof value === 'string') {
      env[key] = value;
    }
  }
  // Asked of the module that owns the file, rather than derived from this extension's own storage.
  env.TEMCO_CATALOG_DB = catalogDatabasePath();
  env.TEMCO_MCP_STATE = context.globalStorageUri.fsPath;
  env.TEMCO_PLATFORM_API = platformApi();
  return env;
}

/** The address the device, repository and project tools ask. Empty means they are not usable here. */
export function platformApi(): string {
  return vscode.workspace.getConfiguration('temcoAi').get<string>('platformApi', '').trim();
}
