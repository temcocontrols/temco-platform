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

## Branches

This repository is a fork of `microsoft/vscode`, so the two jobs are kept on two branches.

| Branch | Is | Receives |
|---|---|---|
| `main` | a **mirror** of `upstream/main` — no Temco file, no Temco commit | upstream only, fast-forwarded |
| `t3000-platform` | **the product**: the shell, every module, the product identity | every Temco change, and each upstream sync |

`main` is never edited and never carries a release: a tag on it would build an app with none of this product in it. Everything Temco is committed on `t3000-platform`, which is 156 commits ahead of `main` with `main` as its merge base.

**Set `t3000-platform` as the repository's default branch** (*Settings → General → Default branch*) — it is `main` today. GitHub only reads `workflow_dispatch` from the default branch, so while `main` is default the release workflow has no *Run workflow* button at all, and a clone lands on upstream's source rather than on the product. A ruleset blocking direct pushes to `main` is worth adding at the same time: the release guards stop a *release* from `main`, not a *commit* to it.

Syncing upstream into `main`:

```bash
git fetch origin --prune && git fetch upstream --prune
git switch main
git reset --hard upstream/main
git push --force-with-lease origin main
```

Bringing that merge into the product — a **merge**, never a rebase: 156 shared commits rewritten on every upstream release would make `t3000-platform` unusable for anyone who has cloned it.

```bash
git switch t3000-platform
git merge main            # conflicts land on package.json (version), product.json, resources/**
```

## Releasing

A release is a **tag on `t3000-platform`**. GitHub builds the installers from it and attaches them to a draft Release named after the tag. The workflow is [`.github/workflows/release.yml`](../../.github/workflows/release.yml).

### The first release, in order

1. **Commit the workflow, this page and the root `README.md` on `t3000-platform`**, and push.
   ```bash
   git add .github/workflows/release.yml README.md docs/temco-platform/README.md
   git commit -m "Add a tag-triggered release workflow, and the branch model it releases from"
   git push origin t3000-platform
   ```
2. **Make `t3000-platform` the default branch** — *Settings → General → Default branch*. Until this is done the workflow has no *Run workflow* button. Add a ruleset blocking direct pushes to `main` while you are there.
3. **Keep `package.json`'s version inside the base range.** Every module declares `engines.vscode: ^1.143.0`, so a number below that — `2026.1.0`, `0.1.0`, or a prerelease such as `1.144.0-2026.1` — makes all of them incompatible and the application starts as plain VS Code with no Temco surface. Leave the version at the VS Code base (`1.144.0`) and tag `v1.144.0`; renumber only as a package-wide change to the manifests and this field together.
4. **Tag that commit and push the tag.**
   ```bash
   git tag -a v<version> -m "Temco Platform <version>"
   git push origin v<version>
   ```
   *Actions → Release* then builds on three runners and leaves a draft Release. Check the assets, publish it.

### Cutting a release

```bash
# 1. the version the installer will report, and the tag, are the same number
#    edit "version" in package.json
git commit -am "Temco Platform <version>"
git push origin t3000-platform

# 2. the tag is the release
git tag -a v<version> -m "Temco Platform <version>"
git push origin v<version>
```

Then open *Actions → Release*. Three runners build in parallel — Windows x64, Linux x64, macOS arm64 — and a **draft**
Release named `Temco Platform <version>` is created with:

| Asset | Is |
|---|---|
| `TemcoPlatform-win32-x64-<version>.zip` | the unpacked app: run `Temco Platform.exe` |
| `*Setup*.exe` | the per-user Windows installer, no admin rights needed |
| `temco-platform_<version>_amd64.deb` | the Debian/Ubuntu package |
| `temco-platform-linux-x64-<version>.tar.gz` | the unpacked Linux app |
| `TemcoPlatform-darwin-arm64-<version>.zip` | Apple silicon only |

Check the assets, then publish the draft. Nothing is released while it is a draft.

### Two guards, and why they exist

Both fail in seconds, before the 40-minute build:

1. **The tag must equal `v<version>`** in `package.json`. The installer takes its version from `package.json`, not from the tag, so a release called `v1.2.3` that installs itself as `1.144.0` is one nobody can support.
2. **The tag must be on `t3000-platform`.** `main` mirrors upstream, so a tag there would build an application with none of this product in it.

### Rebuilding a tag

Run the workflow by hand (*Actions → Release → Run workflow*) with the tag's name. Nothing is re-tagged and the draft of a failed run is replaced. A failed run leaves its tag behind — delete it (`git push --delete origin v<version>`) before tagging again, or the next push is rejected as unchanged.

### Two things the workflow does that packaging does not

`compile-extensions` and `build-webviews`, in that order, before the gulp packaging task. A module ships as `out/**` (the manifest's `main` is `./out/extension.js`, and `.vscodeignore` excludes `src/**` but not `out/**`), and its webview bundles are esbuild output under that same `out/` — outside VS Code's own media pipeline. A package built without them installs and runs, with an empty surface where each module's page should be.

### What a release is not

Nothing is signed: there is no code-signing certificate, so Windows shows "unknown publisher" on first run and macOS needs
right-click → Open (or `xattr -d com.apple.quarantine`). Nothing updates itself either — a new version is a new download, not
an update. Both are later work, and both are secrets-only changes to the same workflow: a Windows certificate and an Apple
Developer ID.

## Phases

| Phase | Work |
|---|---|
| 1 | Rename the repository, add the `upstream` remote, apply the naming |
| 2 | `extensions/temco-docs` — the existing extension, ids renamed, gates wired |
| 3 | The shell — `src/temco`, the two entry points, `product.json`, menus, welcome |
| 4 | Split `temco-ai`, `temco-store`, `temco-ui`, `temco-repositories`, `temco-projects`, `temco-workbench` (**all done** — every module is now one domain, and the workbench is the application) |
| 5 | `temco-learn` serves T3000 end to end, then T3001 and T3002 |
