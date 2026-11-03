# Temco Platform — architecture

Temco Platform is a desktop application built on VS Code. Everything Temco builds is either **the shell** (application behaviour) or **a module** (a feature).

## Repositories

| Repository | Is |
|---|---|
| `temco-platform` | the application: the shell and every module |
| `temco-learn` | the published documentation site ([temco-learn.md](../temco-learn/README.md)) |

The application and all its modules live in one repository. `temco-learn` is separate because it is a published artifact, not a module.

## Layout

```text
temco-platform/
├── product.json                     product name, icons, default settings, policy
├── resources/                       logos, installer art, application icons
├── src/
│   ├── vs/                          VS Code — never edited
│   └── temco/                       the shell
├── extensions/
│   ├── temco-docs/                  modules ([../modules/README.md](./modules/README.md))
│   ├── temco-ai/
│   └── temco-*/                     one folder per module
├── docs/                            this documentation
└── build/  cli/  scripts/  test/  remote/     VS Code — never edited
```

## Where code goes

| Path | Contents | Edited by |
|---|---|---|
| `src/vs/**`, `build/**`, `cli/**`, `scripts/**`, `test/**`, `gulpfile*` | VS Code | nobody |
| `product.json`, `resources/**`, `package.json` | product identity and policy | us |
| `src/temco/**` | the shell | us |
| `extensions/temco-*/**` | the modules | us |
| `docs/**` | documentation | us |

The rule: every change Temco makes is a new file in a new folder. A change to VS Code's own files is a decision, not a habit.

## The shell

```text
src/temco/
├── temco.contribution.ts   the single entry point the workbench loads
├── menus/                  top-level menus and the items in them
├── branding/               About, splash, identity behaviour
├── startup/                welcome, first run, default layout
├── services/               services the modules consume
└── platform/               plumbing shared by the folders above
```

The shell owns the application's identity, its startup, its top-level menus, its default layout and the services modules share. It owns no feature. A feature that only works inside the shell belongs to a module, not to the shell.

## Entry points

Two additive lines in VS Code's files: [entry-points.md](./entry-points.md).

| File | Addition |
|---|---|
| `src/tsconfig.json` | `src/temco/**` added to `include` |
| `src/vs/workbench/workbench.desktop.main.ts` | one import of `src/temco/temco.contribution.ts` |

## Modules

A module is a real extension. Its shape, its contract and its register: [../modules/README.md](./modules/README.md).

```text
extensions/temco-<module>/
├── README.md              purpose, identifiers, what it owns
├── package.json           id, engine range, commands, views, settings, activation
├── tsconfig.json          extends ../tsconfig.base.json
├── src/
│   └── extension.ts       the only activation entry: register, wire, dispose
├── media/                 icons, webview css and js
├── prompts/               model instructions, where a module needs them
└── scripts/               module-local gates
```

A module's documentation lives in `docs/temco-platform/modules/temco-<module>/` ([../modules/README.md](./modules/README.md)), never in a `docs` folder inside the module.

| State | Contents | Build effect |
|---|---|---|
| **reserved** | `README.md` only | nothing is compiled and nothing ships |
| **active** | manifest, tsconfig, `src/` | compiled and shipped as a built-in extension |

Only `temco-docs` is active today.

Nothing needs registering for a module to build or ship: the build picks up every `extensions/*/package.json`, the root install brings in each folder's own dependencies, and web builds skip anything that is not a web extension.

## Naming

All identifiers, and the rename map applied at the move: [naming.md](./naming.md).

## UI layout

Two activity-bar icons, the editor in the middle, the AI on the right.

```text
┌────┬───────────────────────┬─────────────────┬──────────────────┐
│    │ TEMCO                 │                 │ TEMCO AI         │
│ 📚 │  WORKSPACE            │  editor area    │  ask · draft ·   │
│    │  LIBRARY              │  pages open     │  citations       │
│    │  REPOSITORIES         │  as tabs        │                  │
│    │  PROJECTS             │                 │                  │
├────┤                       │                 │                  │
│ 🧰 │ TOOLS                 │                 │                  │
│    │  SQL · NETWORK ·      │                 │                  │
│    │  BACNET · DEVICES     │                 │                  │
└────┴───────────────────────┴─────────────────┴──────────────────┘
```

| Container id | Title | Declared by | Filled by |
|---|---|---|---|
| `temco` | Temco | the docs module now, the shell later | docs, repositories, projects |
| `temcoTools` | Tools | the first tools module | SQL, network, BACnet, devices |
| `temcoAi` | Temco AI | the AI module | the AI panel, secondary side bar |

A container with no views is not shown, so a container may be declared before its views exist.

| Surface | Contributed by | Appears as |
|---|---|---|
| view container | module or shell | an icon in the activity bar |
| view | module | a section in a sidebar |
| secondary-side-bar view | module | a panel on the right |
| status bar item | module | an item in the bottom bar |
| diagnostics | module | rows in Problems |
| webview editor | module | a tab in the editor area |

## Rules

1. VS Code's own source is never edited; the two entry points are the complete list.
2. Every change is a new file in a new folder.
3. A module must also work in an ordinary VS Code window — it uses the published `vscode` API only, nothing shell-specific.
4. Modules talk through commands, settings, files and events; never by importing one another's source.
5. `temco-docs` owns the catalog and every page write.
6. Read-only by default. The application writes only in the five documented cases, each behind its own command and a confirmation naming the path or the value.
7. Nothing is ever written to a source repository and nothing is ever pushed.
8. Nothing is ever published or deployed from the application.
9. A build engine sits behind the content-package contract ([content-package.md](../temco-learn/content-package.md)); nothing outside the engine's own folder names it.
10. Runtimes and models are downloaded on request into the user's own folder; the engine runs on loopback only.

## Releasing

A release is a **tag**. GitHub builds the installers from it and attaches them to a draft Release named after the tag.

```text
1. bump "version" in package.json, commit it
2. git tag -a v<that version> -m "Temco Platform <that version>"
3. git push origin v<that version>
```

`.github/workflows/release.yml` then runs on three runners — Windows x64, Linux x64, macOS arm64 — and produces the
Windows installer plus a portable zip, a `.deb` and a Linux tarball, and a macOS zip. The workflow refuses to build when
the tag and `package.json` disagree: the installer takes its version from `package.json`, not from the tag, so a release
called `v1.2.3` that installs itself as `1.144.0` is one nobody can support. To rebuild an existing tag, run the workflow
by hand and give it the tag's name.

Two things the packaging chain does **not** do on its own, and the workflow therefore does first: `compile-extensions`
and `build-webviews`. A module's webview bundles are esbuild output under its own `out/`, outside VS Code's own media
pipeline — a package built without them ships empty surfaces.

Nothing is signed: there is no code-signing certificate, so Windows shows "unknown publisher" on first run and macOS needs
right-click → Open. Nothing updates itself either — a new version is a new download.

## Phases

| Phase | Work |
|---|---|
| 1 | Rename the repository, add the `upstream` remote, apply the naming |
| 2 | `extensions/temco-docs` — the existing extension, ids renamed, gates wired |
| 3 | The shell — `src/temco`, the two entry points, `product.json`, menus, welcome |
| 4 | Split `temco-ai`, `temco-store`, `temco-ui`, `temco-repositories`, `temco-projects`, `temco-workbench` (**all done** — every module is now one domain, and the workbench is the application) |
| 5 | `temco-learn` serves T3000 end to end, then T3001 and T3002 |
