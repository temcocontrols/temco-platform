# temco-repositories

The organisation and the local copies of it. It lists the repositories, reads a source into the platform's memory — from a folder on this machine or over the GitHub API — and keeps the working area where clones live.

| | |
|---|---|
| Extension id | `temcocontrols.temco-repositories` |
| Namespace | `temcoRepositories` |
| State | active |
| Page | The Repositories (`temcoRepositories.page`) — one tab in the group our pages share |
| Requires | `temcocontrols.temco-store`, `temcocontrols.temco-ui` |
| Settings | `temcoRepositories.organisation`, `temcoRepositories.workspaceFolder` |

## What it owns

```
src/extension.ts        activation, the page command, and the API other modules call
src/store.ts            what it reads of the store — the catalog and the selection, in one file
src/ui.ts               what it reads of the UI module — where a page opens, what a command argument names
src/surface.ts          the page's own view type
src/repository.ts       the organisation's list as an API read, and the code files of a source
src/read.ts             reading a source: the registry it declares, from a folder or over the API
src/dashboard.ts        every clone at once: what moved since the last read, and the pages that name it
src/apply.ts            a drafted change reaching a clone: the question, `git apply`, and the reverse
src/workarea.ts         the working area: clone, pull, remove, and where a copy lives
src/repositoriesPage.ts the page that lists what is there and what has been read
```

## The one act that writes

Reading a source writes to the **store**, never to a source: the pages it found, the branch it read, the state it concluded. Nothing is ever pushed, and the working area is a folder of its own (`~/temco` by default) — outside every repository on purpose.

The one exception is `temcoRepositories.applyToSource`, and it is not a write anybody gets by accident. It takes a file and the text a draft produced, finds the innermost clone the catalog holds around that file, **asks first** in a modal question that names the clone, the file and the fact that the result is uncommitted, then lands the change as a `git apply` of a whole-file patch. The notification that follows carries **Undo**, which applies the same patch in reverse; if the file is in no clone the command refuses, because that tree belongs to the window a person is looking at and its editor undo is the right handle. Commits, pushes and branch changes are not this module's business, and no command here does them.

A clone is **never automatic**. A first read says a local copy would help and offers one; from then on it is a command or a page button, and both name the folder they will write to first. One branch with full history, not `--depth 1`: the history is what a draft reads and what a staleness check needs, and a shallow clone would break both.

## The dashboard

`temcoRepositories.dashboard` is a page over every clone on this machine, grouped by the project that cites it. The watermark is the **last read** the catalog recorded for a source: what came after it is what nobody has been told yet, and the commits before it are still listed — dimmed and marked *seen* — because a column that hides its history cannot be checked. Each row ends with the documentation pages whose registry entry names the changed files, asked of the docs module (`temcoDocs.pagesForPaths`) with the same glob rules the generator uses. It repaints itself when a read lands, and only while it is the panel on screen.

## Commands

| Command | What it does |
|---|---|
| `temcoRepositories.page` | opens the page listing the organisation |
| `temcoRepositories.dashboard` | every clone, what moved since the last read, and the pages that name it |
| `temcoRepositories.readSource` | reads one source's registry into the catalog |
| `temcoRepositories.readAllSources` | reads every source of the project being worked on |
| `temcoRepositories.removeSource` | forgets a source — its rows go, the repository does not |
| `temcoRepositories.revealSource` | opens the source's page on GitHub, or the folder it is on |
| `temcoRepositories.setSourceBranch` | the branch a repository is read at |
| `temcoRepositories.openFile` | a file read over the API, opened read-only |
| `temcoRepositories.setToken` | the GitHub token, in secret storage — never in a file, never in a setting |
| `temcoRepositories.fetchSource` | clones a source into the working area |
| `temcoRepositories.pullSource` | `pull --ff-only` on a cloned source |
| `temcoRepositories.openClone` | opens the local copy in a new window |
| `temcoRepositories.removeClone` | removes the local copy, after naming it |
| `temcoRepositories.changeWorkspaceFolder` | where the working area is |
| `temcoRepositories.openWorkFolder` | opens the working area |
| `temcoRepositories.applyToSource` | lands a draft in a clone's working tree, after asking: uncommitted, with Undo |

## What it offers other modules

`onDidChange` (the catalog changed in a way a surface shows), `codeFiles(source)`, `tree(source)` and `readMaterials(source, files)` — the material a new page is drafted from, which is what `temco-docs`' new-page form asks for. Declared in `extensionDependencies`, so the exports are ready before a consumer's `activate()` runs.

## What it deliberately does not own

- **What a registry means.** A read records what a source's `registry.json` declares; the registry's shape, its checks, its areas, chapters and pages are `temco-docs`'. This module needs nothing from that module.
- **The surfaces that show sources.** The Library's rows belong to the workbench; this module publishes facts and opens its own page.
- **Where a page opens.** That rule is `temco-ui`'s, read here through `src/ui.ts`.
- **The community forum.** `forums.temcocontrols.com` is read by `temco-docs` — it is Discourse, needs no token, and belongs with the documentation it is about.

## Checks

```
npm run check-commands      # no command id is registered twice
```
