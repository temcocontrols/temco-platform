# Build and publish

From pages in a project folder to a page on the published site. Three acts, three different places: a **build** writes inside the project's own folder, an **add** copies that output into the site repository, and a **publish** commits the site repository and lets its CI deploy.

Nothing here writes to a source repository, and nothing here writes into `temco-platform`'s own `docs/` folder — that folder documents the platform, it does not host projects.

## 1. The outputs a project declares

A project carries a recipe: an engine (`docfx`) and the outputs ticked on its page. One build is meant to produce all of them, so they are ticks, not a choice.

| Output | Is | Made by, in the project's repository |
|---|---|---|
| `website` | static pages for Temco Learn | `docs:site`, else `docs:build`, else the built-in generator |
| `pdf` | one document, printed layout | `build:help:dry`, else `docs:pdf` |
| `help` | the offline help file (`.chm`) | `build:help:dry` |
| `search` | a search index | not this application: the site builds its own with `npm run search` |
| `ai` | embeddings, kept on this machine only | declared only; nothing here writes or uploads them |

Two commands consume that recipe, and they are not the same act:

| Command | Runs | Judges |
|---|---|---|
| `temcoDocs.buildSite` | `docs:site` or `docs:build` in the project folder; with no script, the built-in generator | the artifact exists |
| `temcoProjects.buildProject` | one script per ticked output — `website`/`site`/`html` → `docs:site` or `docs:build`, `help`/`pdf` → `build:help:dry`, `pdf` → `docs:pdf` when the help script is absent | every new file matching any ticked kind |

Each ticked output with a script runs, once each, so asking for a site and a PDF runs both scripts; `search` and `ai` have no script of their own here and are only ever looked for. The site is always built with `temcoDocs.buildSite`, which is the command that knows the built-in generator.

Whichever command ran, the exit code is printed and never trusted: what counts is a file that did not exist before the run and does now.

## 2. Where each output lands

| Output | Lands at |
|---|---|
| the site | `<project>/dist/site`, or `<project>/dist/docs` when the repository's generator (docfx) wrote it |
| the PDF | wherever the repository's own `docs:pdf` writes it, inside the project folder |
| the `.chm` | inside the repository, or in a `HelpDocs` folder beside it |
| every file | also recorded in the catalog against the build, so the Builds and Downloads pages can list it |

Four folders are searched for what a build wrote, and a file counts only when it is newer than the run: the project folder itself, `dist/docs`, `docs/_site`, and a `HelpDocs` folder beside it.

## 3. Adding a build to the site

`temcoLearn.addBuild` (one build) and `temcoLearn.addBuilds` (the page that lists them) put a build into the site repository — `temcoLearn.siteRepo`, default `~/temco/temco-learn`.

| Step | Detail |
|---|---|
| Found | `dist/site` and `dist/docs`, two levels below the window's folders, the projects folder and the working folder; the folder must contain `index.html` |
| Named | the project id comes from the folder — `<projectsFolder>/t3000/…` is `t3000`, `<workingFolder>/source/<repo>/…` is the repository's name; a build outside both falls back to its page title |
| Copied | into `<siteRepo>/public/imported/<id>/<version>/` — the version is the one question a person is asked |
| Recorded | `<siteRepo>/content/<id>/site.json` holds the title and the section; a new project defaults to `documentation` |
| Catalogued | the site's own `npm run catalog` runs afterwards, rewriting `public/catalog.json`, `public/search.json`, `public/content/` and `public/download/` |

Adding is local. Nothing is published by this step.

## 4. What the site needs that a project build does not make

The site's deploy builds the *site*; it does not build the **downloads**. `pages.yml` runs `check`, then `build:fast`, then `guard`, then uploads `dist` — and `guard` (`scripts/check-artifacts.mts`) fails the deploy when a catalogued version has no committed file:

| Required | Path in the site repository |
|---|---|
| the whole-guide PDF, every version | `public/pdf/<id>/<version>.pdf` |
| one PDF per Markdown page | `public/pdf/<id>/<version>/<page>.pdf` |
| the help file, when the manifest promises one | `public/chm/<id>/<version>.chm` |
| the download menu | `public/download/manifest.json` |

These are made **in the site repository**, on a machine with a browser (the PDFs are printed by Playwright's Chromium) and `hhc.exe` on Windows for the help file. `temcoLearn.site.downloads` — *Make the Downloads*, the step between **Add** and **Publish** on the publishing page — runs the whole chain and reports each failure for what it is:

```text
npm run build:fast     the catalog, the search index, the bundle — the pages the PDFs are printed from
npm run pdf -- --strict  dist/pdf, mirrored into public/pdf; a missing browser is an error here
npm run chm            public/chm/*.chm and public/download/manifest.json; no compiler is a warning
```

The same thing by hand, when the browser or the compiler is missing:

```text
cd ~/temco/temco-learn
npm run build          # catalog → search → tsc → vite build → pdf → chm
git add public/pdf public/chm public/download public/content public/catalog.json public/search.json
```

`npm run pdf` mirrors `dist/pdf` into `public/pdf`; `npm run chm` writes the `.chm` files and the manifest that reports what is really on disk. Committing them is what makes the next deploy honest — the alternative `guard` prevents is a site serving last month's PDF.

So the order for a new version is: **build → add → make the downloads → publish**.

## 5. Publishing

| Command | Does |
|---|---|
| `temcoLearn.publish` | opens the publishing page — the clone, the paths a commit would take, and the four steps |
| `temcoLearn.publishNow` | the act itself: `catalog`, then the site's own `guard`, then `git add --all`, commit, `git push origin HEAD:main` |
| `temcoDocs.publishSite` | the same destination — the Learn module owns the site folder, so this entry point redirects |

`guard` runs before the commit, and a clone it refuses is not committed: it is the same gate `pages.yml` runs, invoked here so a missing download costs a dialog instead of a red run.

The commit message defaults to `docs: publish the site (<date>)`, because the repository holds several projects and a message naming one of them would be wrong about the others. Nothing is ever force-pushed: a branch carrying work the clone does not know about is reported, the commit stays local, and the next publish fast-forwards after a pull.

CI then does the rest, and the build stays where it already is — in CI, with its own log:

| Workflow | Trigger | Steps |
|---|---|---|
| `pages.yml` | push to `main` | `npm ci` · `npm run check` · `npm run build:fast` (`VITE_BASE=/temco-learn/`) · `npm run guard` · upload `dist` · deploy to Pages |
| `release.yml` | a `v*` tag matching `package.json` | `check` · `guard` · `build:fast` · pack the whole site as a zip |

The result is `https://temcocontrols.github.io/temco-learn/`, with the project listed under **Documentation** and reached at `#/<id>/<version>/…`. The routes live in the fragment because GitHub Pages serves static files and cannot rewrite a path.

## 6. The whole flow, and how to see that each step worked

| Step | Command | Where to look |
|---|---|---|
| a project exists | the create flow, with **Projects folder** set | `<projectsFolder>/<slug>/docs/help/registry.json` |
| pages written | the editor, in `docs/` | the file, and the project page's page count |
| built | `temcoDocs.buildSite` | `<projectsFolder>/<slug>/dist/site/index.html`, and a row in `temcoDocs.builds` |
| added | `temcoLearn.addBuild` | `<siteRepo>/public/imported/<id>/<version>/index.html` and `<siteRepo>/content/<id>/site.json` |
| catalogued | the same command, automatically | `public/catalog.json` lists the project and the version |
| downloads | `temcoLearn.site.downloads` | `public/pdf/<id>/<version>.pdf`, `public/download/manifest.json` |
| previewed | `temcoLearn.site.start` | `http://localhost:1025/` (port from `temcoLearn.sitePort`), the project's page |
| published | `temcoLearn.publishNow` | `git log -1 --stat` in the site clone; the Actions run; then the Pages URL |

A flow that stops working can be read as one of four failures, in this order: the build folder has no `index.html`, the site clone is not at `temcoLearn.siteRepo`, the catalog did not run, or a download is missing and `guard` refuses both the publish and the deploy.

## 7. What is local only

`temcoDocs.publishRelease` is not this flow. It copies the last build's artifacts into the extension's own storage — `published/<project>/<version>` — behind a modal confirmation that names the version, the destination and the file count, and writes a manifest beside it. `temcoDocs.openPublished` serves that copy. It is a build handed to a reader, not a deployment, and nothing is pushed.
