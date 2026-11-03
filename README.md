# Temco Platform

Temco Platform is the desktop application Temco uses to produce the documentation that ships with its products. It reads a product repository's pages, builds the site and the offline help from them, and publishes the result to [Temco Learn](https://github.com/temcocontrols/temco-learn), where it is released, downloaded, and shipped inside the product.

The application is built on VS Code - the open-source Code - OSS tree, base `1.144.0` - so the editor, the terminal, source control and the extension model are the familiar ones. Everything Temco adds is a module: a real extension with one namespace and one purpose, compiled into the application, with nothing to install.

## At a glance

| | |
|---|---|
| Application | `temco-platform` in `product.json`, window title **Temco Platform** |
| Branch that ships | `t3000-platform` - the default branch, and the only branch a release is cut from |
| Branch that mirrors upstream | `main` - never edited, never released |
| Distance from `main` | 156 commits: 153 authored, 3 upstream sync merges |
| Modules | 14 folders: 10 active, 4 reserved |
| Seams into VS Code | 2 additive lines ([entry-points.md](docs/temco-platform/entry-points.md)) |
| A release is | a tag `v<version>` on `t3000-platform`, built by [`.github/workflows/release.yml`](.github/workflows/release.yml) |

## What it replaces

| Before | Now |
|---|---|
| help pages edited and compiled to a `.chm` by `dr.explain` | Markdown pages in a product repository, edited in the platform |
| one compiled help file, produced on one desktop | site, PDF and CHM built from one source by the project's own scripts |
| the help file copied into the T3000 release folder by hand | published, released and downloaded from Temco Learn, then placed in the release |
| documentation readable only inside the product | the same pages read and searched online before the product is installed |

## The flow

```text
1  author    a product repository holds the pages and the registry; the platform reads
             the source and edits the pages in place

2  build     the repository's own scripts run from the platform's Builds page:
             docs:site / docs:build  ->  dist/docs
             build:help:dry          ->  <version>.chm

3  publish   the build is copied into temco-learn, committed there, and pushed

4  release   temco-learn tags a version; the site, the zip, the PDFs and the CHMs
             become the release's assets

5  ship      the zip and the CHM are downloaded and placed in the T3000 release
             folder, so the help ships with the product it documents
```

Step 2 is the only step that needs a Windows desktop: the PDFs are printed from Chromium and the CHM is compiled by HTML Help Workshop. Steps 3 and 4 also run in CI.

## What a build leaves behind

| Output | Built by | Lands in | Read by |
|---|---|---|---|
| site folder (`dist/docs`) | the product repository's `docs:site` / `docs:build`, run from the platform's Builds page | `temco-learn` at `public/imported/<product>/<version>/` | a browser, as one page of the site |
| Markdown content | the platform's pages, written into the project | `temco-learn` at `content/<product>/<version>/` | the site's reader and its search |
| PDF | `npm run pdf` in `temco-learn` (Chromium prints each page) | `public/pdf/<product>/<version>.pdf` | a reader without the product |
| CHM | `npm run chm` in `temco-learn`, or `build:help:dry` in the product repository | `public/chm/<product>/<version>.chm`, and the product's release folder | the product's own Help menu |

Nothing is produced from a page that is not in the registry, and nothing is published from the platform: the platform writes a page only when asked, and the site builds from what was committed.

## Modules

A module is folder under `extensions/`. It becomes **active** when it has a manifest, a `tsconfig.json` and `src/`, and the build then compiles and ships it; a **reserved** folder holds a `README.md` only, so the build ignores it and no surface appears.

| Module | Purpose | State |
|---|---|---|
| `temco-workbench` | the application's own surfaces: the Library, the dashboard, what needs doing | active |
| `temco-ui` | where a page of ours opens, what a command argument names, the shared page components | active |
| `temco-store` | the platform's own memory: the catalog database, the selection, the naming rules | active |
| `temco-docs` | the registry, the pages, the checks, the builds and the writes | active |
| `temco-learn` | the published site: the site folder, the panel, the preview, the push | active |
| `temco-editor` | the editor for a page: the Markdown surface, its ribbon | active |
| `temco-repositories` | the organisation, the local copies, reading a source | active |
| `temco-ai` | the local runtime and models, the prompts, drafts and answers | active |
| `temco-projects` | projects, sources, outputs, builds | active |
| `temco-tools` | the Tools container: devices, I/O, BACnet, network, SQL, as pages over a sample | active |
| `temco-sql` | registers, queries, export | reserved |
| `temco-nettools` | devices on the wire | reserved |
| `temco-bacnet` | objects, points, trends | reserved |
| `temco-device-manager` | fleets, firmware, health | reserved |

## Branches

| Branch | Is | Released from |
|---|---|---|
| `main` | a mirror of [`microsoft/vscode`](https://github.com/microsoft/vscode). It carries none of this product's work, and nothing is ever committed to it. | no |
| `t3000-platform` | the product: the shell, every module, the product identity. The default branch. | yes |

Syncing with upstream, on `main`:

```bash
git fetch upstream
git checkout main
git merge --ff-only upstream/main
git push origin main
git checkout t3000-platform
git merge main
```

Use a merge, never a rebase: rewriting the shared commits would make every existing clone unusable. A merge that reports conflicts in `README.md` is expected, and is resolved by keeping this file - the upstream README describes VS Code, and it stays on `main`, where it is true.

## Build and run

```bash
npm install            # the root dependencies and every module's own
npm run compile        # client, copilot, the module checks, the webviews
npm run watch          # rebuild on change, once the first compile is done
npm run check-temco    # the module graph, every named id, the shared components
```

Launching the built application:

```bash
scripts\code.bat       # Windows
./scripts/code.sh      # macOS and Linux
```

## The first release, in order

1. **Commit what is pending on `t3000-platform`** and push it.

   ```bash
   git add .github/workflows/release.yml README.md docs/temco-platform/README.md
   git commit -m "Release workflow, and the branch model it releases from"
   git push origin t3000-platform
   ```

2. **Make `t3000-platform` the default branch** - *Settings > General > Default branch*. GitHub only reads `workflow_dispatch` from the default branch, so until this is done the workflow has no *Run workflow* button, and a clone lands on upstream's source instead of the product. A ruleset blocking direct pushes to `main` belongs here too: the guards stop a *release* from `main`, not a *commit* to it.

3. **Leave `version` in `package.json` at `1.144.0`.** It is not a marketing number: every module declares `engines.vscode: ^1.143.0`, so a lower or prerelease value makes all ten incompatible and the application starts as plain VS Code with no Temco surface. A Temco release number is a package-wide change - the manifests and this field together - never an edit here alone.

4. **Tag that commit and push the tag.**

   ```bash
   git tag -a v1.144.0 -m "Temco Platform 1.144.0"
   git push origin v1.144.0
   ```

5. **Wait for the run, then publish the draft.** *Actions > Release* builds three installers in parallel - Windows x64, Linux x64, macOS arm64 - and leaves a **draft** release named after the tag. Open it, check the assets, press **Publish** (tick *Set as a pre-release* for a trial build).

Two rules the workflow enforces before it builds anything:

| Rule | Why |
|---|---|
| the tag is `v` followed by `version` in `package.json` | the installer reports the manifest's version, so a release named after something else installs a version nobody can support |
| the tagged commit is on `t3000-platform` | `main` is the upstream mirror, and a build from it would contain none of this product |

## Documentation

| Document | Covers |
|---|---|
| [`docs/temco-platform/README.md`](docs/temco-platform/README.md) | the shell and the modules: what owns what, and where code goes |
| [`docs/temco-platform/modules/README.md`](docs/temco-platform/modules/README.md) | the module register, ownership, and how two modules may talk |
| [`docs/temco-platform/naming.md`](docs/temco-platform/naming.md) | every identifier, title and namespace |
| [`docs/temco-platform/entry-points.md`](docs/temco-platform/entry-points.md) | the two seams where product code joins VS Code |
| [`docs/temco-platform/catalog.md`](docs/temco-platform/catalog.md) | the catalog the platform reads and writes |
| [`docs/temco-learn/README.md`](docs/temco-learn/README.md) | the published site: content model, engine, offline artifacts, review flow |
| [`docs/temco-learn/content-package.md`](docs/temco-learn/content-package.md) | what a product ships for the site to build |
| [`docs/README.md`](docs/README.md) | the map of all of the above |

## Credit

Temco Platform is a fork of [Code - OSS](https://github.com/microsoft/vscode), which Microsoft and the community develop under the MIT license in [`LICENSE.txt`](LICENSE.txt). The parts of this repository that come from there are kept byte for byte, which is why upstream changes can still be merged; the parts Temco wrote live in `src/temco/`, `extensions/temco-*/`, `product.json`, `resources/` and `docs/`.
