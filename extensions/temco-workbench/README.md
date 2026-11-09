# temco-workbench

The application's own surfaces — and the only module that is not a domain.

| | |
|---|---|
| Extension id | `temcocontrols.temco-workbench` |
| Namespace | `temcoWorkbench` |
| State | active |
| Views | **Dashboard** (Overview, Projects, What needs doing), **Workspaces**, **Temco Learn** (Site, Delivery), **Settings** (one group of six rows, ordered from the window outward), **Help** (Learn, Support) |
| Pages | the **dashboard** (`temcoWorkbench.overview`, `.activity`, `.health`), the **needs page** (`temcoWorkbench.openNeeds`), **Workspaces** (five), **Temco Learn** (five), **Settings** (five), **Help** (six) |
| Requires | `temcocontrols.temco-store`, `temcocontrols.temco-ui`, `temcocontrols.temco-repositories`, `temcocontrols.temco-docs` |
| Settings | `temcoWorkbench.start.open` |
| Builds | `npm run build-webview` writes `out/webview/settings/` — also run by `build-webviews` and `vscode:prepublish` |

## What it owns

```
src/extension.ts      activation: the pages, the commands, and the two layout decisions
src/sidebar.ts        the side-bar groups and their rows — one line each, the sentence in the tooltip
src/dashboard.ts      Overview, Recent Activity, Coverage & Health
src/home.ts           the dashboard summary the startup falls back to
src/needsPage.ts      what wants a person, said in full
src/workspaces.ts     All Workspaces, one workspace, New Workspace, Templates
src/learnPages.ts     Temco Learn: Home, T3000, an article, Downloads, Learning Paths
src/settingsPages.ts  General (a Fluent bundle), Modules, Branding, AI Runtime, Publishing
webview/settings/     the General page: React, Fluent UI seeded with Azure, the kit's page language
scripts/build-webview.mts  builds it into out/webview/settings/
src/helpPages.ts      Welcome, Help, Keyboard Shortcuts, Logs, Report an Issue, About
src/*Sample.ts        the mock's sample rows, one file per group of pages
src/surface.ts        the page view types
src/docs.ts           what it reads of the documentation module — the sets, the pages, the counts, the scripts
src/store.ts          what it reads of the store — the platform's memory
src/ui.ts             what it reads of the UI module — where a page opens, what a command argument names
src/repositories.ts   what it reads of the repositories module — the repository's own scripts
src/aiModule.ts       what it knows of the AI module — whether it is installed, and nothing more
```

## Why it exists

The Library is not about documentation. It lists what **every** module has — projects, sources, repositories, pages, and the AI — and each row's actions are that module's own commands. The dashboard is the application talking about itself, and the needs page is one list of everything that wants a person, gathered from every module. While those lived in the documentation module, that module was the application, and every other module had to be reached through it.

Two layout decisions came with them, and they belong here for the same reason: **which tab opens at startup** (`temcoWorkbench.start.open`: the welcome page, which is the default and is switched off by the checkbox in its own footer — then the project you are on, the page you last opened, the overview, or nothing) and **which sidebar section comes forward** when the project changes (choosing one brings the Workspace, clearing one brings the Library back).

## What it does not own

- **Nothing of any domain.** No registry, no catalog, no build, no source. Every fact it shows it asks for: the sets and the counts from the documentation module (`src/docs.ts`), the rows from the store, the scripts from the repositories module.
- **No writes.** The only write in this module is the one the store makes when the project is chosen — and that is the store's own command.
- **No page of a module.** The Workspace tree is the documentation module's view, the projects and repositories pages are theirs, and the AI panel is its own. The Library points at all of them.

## Commands

| Command | What it does |
|---|---|
| `temcoWorkbench.home` | opens the dashboard |
| `temcoWorkbench.openNeeds` | opens the needs page — what the Library's *Needs attention* row means in full |

## Checks

```
npm run check-commands      # no command id is registered twice
```
