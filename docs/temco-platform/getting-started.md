# Getting started

**Temco Platform is where product documentation is written and published.** It is a desktop application built on VS Code: in it a person writes pages, groups them into a **project**, builds that project into a website with a printable PDF and a Windows help file, and publishes the result to **Temco Learn** — the documentation site readers actually open, at `https://temcocontrols.github.io/temco-learn/`.

This guide is that whole journey in one pass: an empty folder at one end, a live page at the other. It is written for someone who has never opened the application, and nothing in it assumes a background in VS Code, Git, or the site's own code — where an idea like that cannot be avoided (a commit, a catalog), it is explained at the step that needs it.

> **Screenshot — the finished result: a project card under Documentation, opened to a page, with the version selector and the download menu visible.**
> `media/publishing/00-published-page.png`

## Who this is for

| If you are… | this guide gets you to |
|---|---|
| **writing documentation** for a Temco product — T3000, a controller, a protocol | a project of your own, built and live under Documentation on the site |
| **taking over documentation that already exists** — a folder of Markdown, a Word manual, a compiled `.chm` | the same, starting from *Import a document set* in step 2, with your existing pages converted once |
| **working inside a product repository** that already has `docs/` and its own build scripts | the same, with your repository's own `docs:site` / `build:help:dry` scripts doing the building instead of the built-in generator |
| **reviewing someone else's documentation** | enough of the flow to read what they changed, and to publish it |

You do not need to be the person who set the machine up. If someone else did, [Before the first time](#before-the-first-time) tells you how to check that the three settings and the site clone are right before you start.

## How to use this guide

- **Read steps 1–9 in order, once.** After that, jump straight to [Running it again](#running-it-again), which is what everyday work looks like.
- **Every step is three parts:** what you do, **You should see** — a file or a screen to check — and **If not**, the usual cause. If a step's file is not there, that is the step that failed; nothing after it is worth testing yet.
- **Buttons are named as they appear** in the palette, with the command id in backticks beside them — `temcoDocs.buildSite`. Type the id into the Command Palette (`Ctrl+Shift+P`) when a button is hidden or unavailable.
- **Paths use `~` for your home folder.** Windows paths are shown with backslashes; on macOS and Linux the same path uses `/`, and the only truly Windows-only piece is the `.chm`, which needs the help compiler.
- **This document is meant to be read with the application open**, not memorised. Keep it beside the window.

## What you need before you start

| Need | Why |
|---|---|
| the application installed and running | this guide is about using it, not installing it |
| write access to the `temcocontrols/temco-learn` repository, or someone who has it | the last step pushes a commit there; without access everything before it still works and stops at *publish* |
| git configured with your GitHub account | a publish is `git add`, `commit` and `push`, under your name |
| the site clone on this machine | `~/temco/temco-learn` unless you choose otherwise — the Site page clones it for you |
| an hour, the first time | steps 2 and 7 account for most of it |
| an hour less, every time after | a repeat publish is four commands and about two minutes |

## In this guide

| Section | Answers |
|---|---|
| [What you are making](#what-you-are-making) | what a project, a build and the site are, and where each one lives |
| [The general flow](#the-general-flow) | the five acts, what each writes, and what a reader notices |
| [Words this guide uses](#words-this-guide-uses) | page id, area, chapter, version, section, catalog, guard, downloads |
| [What you will have when you are done](#what-you-will-have-when-you-are-done) | the result, in five bullets |
| [Before the first time](#before-the-first-time) | the setup that happens once per machine |
| [Where things go](#where-things-go) | the three settings that decide every path |
| [Steps 1–9](#step-1--check-the-folders) | the flow, in order, each with what you should see |
| [Running it again](#running-it-again) | the four commands for the second, third and hundredth publish |
| [The same flow, as files](#the-same-flow-as-files--t3000) | every file, and the step that wrote it |
| [What the files look like](#what-the-files-look-like) | real snippets of the JSON you will meet |
| [Reference: the outputs](#reference-what-the-outputs-mean) | the ticks, and which script each one runs |
| [Two things worth doing on purpose](#two-things-worth-doing-on-purpose) | the tests that prove the guards really refuse |
| [When a step goes wrong](#when-a-step-goes-wrong) | symptom → cause → where to look |
| [Beyond the flow](#beyond-the-flow) | sources, the editor, validate, release, export, translate |
| [Appendix](#appendix--every-button-one-page) | every button, and the command id behind it |

## What you are making

Five things take part, and each one lives somewhere different. Knowing which is which is the whole of understanding this flow.

| Thing | Is | Lives in |
|---|---|---|
| **A project** | one body of documentation: its name, its pages, and the outputs it should produce | `<projectsFolder>/<slug>/` — `~/temco/projects/t3000` |
| **A page** | one Markdown file, listed in the project's registry | `<project>/docs/<area>/*.md` and `docs/help/registry.json` |
| **A build** | the rendered site, made from those pages | `<project>/dist/site` (or `dist/docs` when your own generator wrote it) |
| **The site** | the Temco Learn repository — a React app that reads a catalog of projects | `temcoLearn.siteRepo` — `~/temco/temco-learn` |
| **The published page** | what a reader opens on the internet | GitHub Pages, served from the site's `main` branch |

There are exactly **three places** in the whole flow, and it is worth having them straight before you start:

| Place | Holds | Written by |
|---|---|---|
| your project folder | pages, the registry, and the build | you, and this application |
| the site clone | one imported copy per version, the downloads, the catalog | this application, until you publish |
| GitHub | a commit on `main`, and the deployed site | a publish, then the site's own CI |

Three of the five things are yours and stay yours; the site is the site's own repository; the last one belongs to GitHub. That split is why the flow has separate steps instead of one button — and why each step fails differently.

## The general flow

```text
YOUR PROJECT                    A BUILD                  ADD A BUILD                 MAKE THE DOWNLOADS            PUBLISH
~/temco/projects/t3000     →    <project>/dist/site   →  the site clone         →   the site clone           →   GitHub Pages
pages, registry, outputs        the rendered site        one version, uncommitted    the PDFs and help file        readers see it
```

| Act | Command | Reads | Writes | What it is for |
|---|---|---|---|---|
| write | the editor, `temcoDocs.newPage` | nothing | `docs/**/*.md`, `docs/help/registry.json` | the pages a person writes |
| build | `temcoDocs.buildSite` (or `temcoProjects.buildProject`) | the pages and the registry | `<project>/dist/site` | turning pages into a site nobody has seen yet |
| add | `temcoLearn.addBuild` | the build folder | `public/imported/<id>/<version>/`, `content/<id>/site.json` | putting one version of one project into the site |
| make the downloads | `temcoLearn.site.downloads` | the catalog the last step wrote | `public/pdf/…`, `public/chm/…`, `public/download/manifest.json` | the files the deploy cannot build for itself |
| publish | `temcoLearn.publish` → *Publish* | the clone's changes | one commit, one push | making all of it public |

The nine steps below are this table with the details filled in. What each act changes, and who can tell:

| Act | What changes on disk | What a reader would notice |
|---|---|---|
| a build | files inside your project folder only | nothing — nobody else can see it yet |
| add a build | the site clone, **uncommitted** | nothing yet, but it is previewable at `localhost` |
| make the downloads | the site clone, **uncommitted** | nothing yet — but the deploy would refuse without them |
| publish | one commit on `main` | a minute later, the page is live |

So there are four places the flow can stop, and they are named at the step they belong to: a build with no `index.html` to add, a site clone that is not where the setting says, a catalog that could not run, and a version whose PDF is missing. The last one is the one people trip over, which is why it has a step and a test of its own.

## Words this guide uses

The platform uses a handful of words that mean something more specific than they do elsewhere. One pass over this table saves a lot of guessing later.

| Word | Means |
|---|---|
| **registry** | `docs/help/registry.json` — the list of every page: its title, where it sits, whether it ships. The application reads it; a build renders it |
| **area** | the top level of the documentation — one per product or section, declared in the registry |
| **chapter** | the folder a page sits in, inside an area |
| **page id** | the page's path under `docs/` without `.md` — `t3000/commissioning/ports` is `docs/t3000/commissioning/ports.md` |
| **build** | the rendered site produced from the pages, in `<project>/dist/site` |
| **version** | one immutable entry of a project on the site, `1.0`, `1.1` — a rebuild is a new version, not an overwrite of the old one |
| **section** | the category a project appears under on the site: `documentation`, `training`, `tests`, `products`, `qa`, `topics` |
| **catalog** | `public/catalog.json` in the site — the one file the site's app reads to know what exists |
| **downloads** | the PDFs and help files the site serves; the deploy cannot build them, so they are made on your machine and committed |
| **guard** | the site's own check that every catalogued version has its downloads. CI runs it, and so does a publish before it commits |

## What you will have when you are done

- T3000 listed under **Documentation** on the site, with its own card, icon and description.
- Every version you added, selectable — `1.0`, `1.1`, `2.0` — each with its own pages.
- A **Downloads** menu per version: the whole-guide PDF, and a Windows help file when one could be compiled.
- Your pages in the site's search index.
- One commit on `main` in the site repository, and a green GitHub Actions run that deployed it.

## Before the first time

The table above is about *you* — the application, access, an hour. This one is about the **machine**, and happens once. If somebody else set the machine up, work down it and confirm each line rather than assuming.

| Do this once | Why |
|---|---|
| Node 22 or newer on your path (`node --version`) | the site's own scripts run with `--experimental-strip-types` |
| Have the site clone — the Site page (**Open the Site Page**) clones `temcocontrols/temco-learn` for you | the site is its own repository; this application is a client of it |
| `cd ~/temco/temco-learn && npm ci` | the site's dependencies, once per clone |
| `npx playwright install chromium` | the PDFs are printed by a browser; without it *Make the Downloads* says so |
| Optional: HTML Help Workshop | a `.chm` needs `hhc.exe`; without it the site simply has no help file |

Three of those five are optional in practice: a site with no PDFs will build and preview, and one with no help file is still a site. What is not optional is Node and `npm ci` — without them the site's `catalog` cannot run, and step 6 will stop there.

## Where things go

Three settings decide every path in this guide. Set them once; each page reads them back, so you can check the answer rather than the field.

| Setting | Where | Meaning |
|---|---|---|
| `temcoRepositories.workspaceFolder` | Settings ▸ Repositories ▸ Working folder | the working area; clones go to `<it>/source/<repository>` |
| `temcoRepositories.projectsFolder` | Settings ▸ Repositories ▸ Projects folder | a project's own folder is `<it>/<slug>` |
| `temcoLearn.siteRepo` | the Site page ▸ **Choose the Site Folder**, or the setting | the site clone — `~/temco/temco-learn` unless you say otherwise |

`temcoWorkbench.publishing.site` is not one of these: it is the address the Publishing page prints, not a folder.

## Step 1 — check the folders

Open **Settings ▸ Repositories** and read the two sentences under the fields, not the fields themselves. The page reads your saved settings, so it is the honest answer to "where will this go?".

> **Screenshot — the Repositories settings page, with “Clones land in …” and “Projects are made in …” visible.**
> `media/publishing/01-folders.png`

| | |
|---|---|
| **You should see** | `Clones land in …\temco\source` and `Projects are made in …\temco\projects` |
| **If not** | a value you typed but did not save still shows as the old one — press *Choose* or leave the field, then look again. `Projects are made in …\temco` means the projects folder is still empty, and new projects will land beside the clones |

The third setting this guide depends on is **not** on that page: `temcoLearn.siteRepo` is the site clone, set from the Site page with **Choose the Site Folder**, and `~/temco/temco-learn` unless you say otherwise. Check it now — the whole right-hand half of the flow writes there.

## Step 2 — create a project

**Create a Project** (`temcoProjects.newProject`). Name it `T3000`, version `1.0`, and leave the outputs ticked: *Website*, *PDF*, *Offline help*, *Search index*.

> **Screenshot — the create-project form, with the output ticks visible and a name typed in.**
> `media/publishing/02-create-project.png`

**Where the pages come from** is the choice that decides what exists when the form closes:

| Starting point | What it does |
|---|---|
| **Start empty** | records the project and nothing else. Its folder, `docs/help/registry.json` and one area come from **Create the Project's Documentation Folder** (`temcoDocs.createProjectFolder`) |
| **From a template** | writes a starter tree under the folder field — `docs/help/registry.json`, one area, two topics — named after the project, so `T3000` becomes `<projectsFolder>/t3000` |
| **From a folder** | cites a folder that already exists on this machine as the pages it reads; nothing is copied |
| **From a repository** | cites what the platform has already read — repositories, files and folders |
| **Import a document set** | converts Word, RTF, HTML, an HTML folder or a CHM **once** into `docs/` and a registry |

Either way, the project is recorded under the slug of its name (`T3000` → `t3000`), the sources it cites are recorded with it, and the outputs become its recipe. No source is ever written to: a project is a set of references, and its own folder holds only what it writes.

| | |
|---|---|
| **You should see** | `~/temco/projects/t3000/docs/help/registry.json`, and T3000 in the Library |
| **If not** | the folder is the slug of the name — look in `~/temco/projects/` for what was actually made. A project created before you set the projects folder keeps the folder it already has; only new ones move |

The folder is added to the window so its `docs/` shows in Explorer. That is expected.

## Step 3 — write the pages

**New Page** (`temcoDocs.newPage`) with T3000 selected, then type. The palette offers the page kinds beside it — *New Article*, *New Task*, *New Reference*, *New Troubleshooting*, *New Release Note* — which differ only in their starter headings.

Each page is a Markdown file **and** a row in `docs/help/registry.json`. Three rules explain almost every surprise later:

| Rule | What it means |
|---|---|
| the **page id is its path** under `docs/`, without `.md` | `docs/t3000/commissioning/ports.md` is the id `t3000/commissioning/ports`, and the registry must name it exactly that |
| `ship: false` keeps a page out of the built site | a page can exist, be edited, and still not appear |
| `order` decides the position inside a chapter | two pages sharing a title or an `order` are a warning, not an error |

A page registered whose file does not exist is an **error** the module reports on refresh — which is what makes the `missing` rows in `Pages` mean something.

| | |
|---|---|
| **You should see** | a Markdown file under `~/temco/projects/t3000/docs/<area>/`, and `registry.json` listing it |
| **If not** | the project has to be the **selected** project: the docs module reads the folders the selected project cites, not whatever folder happens to be open |

Come back to this step whenever you have more to write. Nothing downstream notices until you build.

## Step 4 — build the site

**Build the Site** (`temcoDocs.buildSite`), or *Build the Site* on the project page. It builds the project that is **selected**, reading the folders that project cites — the folder does not have to be open.

> **Screenshot — the Build Center after a build, with the new row and its artifact.**
> `media/publishing/03-build.png`

Two things can produce the site, and which one runs is decided by what is in the folder:

| In the project folder | What runs | Where the site lands |
|---|---|---|
| a `package.json` with `docs:site` or `docs:build` | that script, after `docs:registry` when the repository has it | wherever the script writes — commonly `dist/site`, docfx's `dist/docs` |
| neither | the **built-in generator** | `<project>/dist/site` |

Either way the attempt is recorded in the Build Center (`temcoDocs.builds`) and everything the build wrote is recorded against it, so the Builds and Downloads pages can list real files rather than hopes.

| | |
|---|---|
| **You should see** | `~/temco/projects/t3000/dist/site/index.html`, and a row in the Build Center (`temcoDocs.builds`) |
| **If not** | a project made here has no `package.json`, so the built-in generator writes the site — the log says what it read. If your repository has `docs:site` or `docs:build`, that script runs instead, and it may write `dist/docs` |

The exit code is never the verdict: what counts is a file that did not exist before the run and does now. A generator that exits 0 and writes nothing has failed; one that exits 1 after writing the site has not.

## Step 5 — build the project's own outputs (only for a repository)

Skip this unless T3000 cites a real repository clone under `~/temco/source/`. **Temco Projects: Build** (`temcoProjects.buildProject`) takes the outputs you ticked and runs the repository's own script for each one, **once each**:

| Ticked output | Script it looks for, in the repository |
|---|---|
| Website | `docs:site`, else `docs:build` |
| Offline help | `build:help:dry` |
| PDF | `build:help:dry`, else `docs:pdf` |
| Search index, AI index | nothing — no script here writes them |

`docs:registry` runs first when the repository has it, because it is what the other scripts read their structure from. The build then records every file that appeared during the run, whatever the exit codes said.

| | |
|---|---|
| **You should see** | the terminal run `docs:registry`, then the scripts above, and the log list the files they left behind |
| **If not** | the warning names the scripts it looked for. A repository with none of them ran nothing, which is the honest answer. A scaffolded project has no `package.json` at all: step 4 is its build, and this step is not for it |

This is the step that produces a PDF or a `.chm` **for the docs module** — the copies it records and the Build Center lists. The PDF that the *website* serves is a different file, made in step 7 from the site's own content.

## Step 6 — add the build to the site

**Add This Build to the Site** (`temcoLearn.addBuild`), or *Choose a build* on the Publishing page. The page that lists every build on disk is `temcoLearn.addBuilds`.

> **Screenshot — the version box, showing “project t3000” and the version field.**
> `media/publishing/04-add-build.png`

It finds every `dist/site` and `dist/docs` two folders below the window's folders, the projects folder and the working folder, and offers the ones with an `index.html`. The box then names the project it will land in — `project t3000` — and asks one question: the version. Type `1.0`.

What it does with your answer:

| | |
|---|---|
| copies | the whole build folder into `<siteRepo>/public/imported/t3000/1.0/` — adding the same version again **replaces** it |
| records | `<siteRepo>/content/t3000/site.json` — the title and the section; a new project defaults to `documentation` |
| catalogs | runs the site's own `npm run catalog`, which rewrites `public/catalog.json`, `public/search.json`, `public/content/` and the download bundles |
| opens | the site page for that project and version, so the result is one click away |

| | |
|---|---|
| **You should see** | `~/temco/temco-learn/public/imported/t3000/1.0/index.html`, `content/t3000/site.json`, and `t3000` with version `1.0` in `public/catalog.json` |
| **If not** | the build must contain an `index.html`. The catalog is rebuilt by this step, so a failure here means the clone has no `npm ci` yet, or no `catalog` script |

The project's id is **its folder's name**: a build in `<projectsFolder>/t3000/…` is always `t3000`, whatever its pages call themselves. Its section is `documentation` unless `site.json` says otherwise.

**Repeat this step every time you rebuild.** A build is copied as one version, so a changed site is a *new* version (`1.1`, `2.0`) — re-adding `1.0` replaces what is already there, which is only what you want when fixing that same version.

Adding a build is local. Nothing is published by this step.

## Step 7 — make the downloads

**Make the Downloads** (`temcoLearn.site.downloads`) — the step between *Add* and *Publish* on the Publishing page.

> **Screenshot — the Publishing page, with the five steps visible and the downloads step running.**
> `media/publishing/05-downloads.png`

It runs the site's own scripts, in this order, and stops at the first real failure:

| Script | Makes | If it fails |
|---|---|---|
| `build:fast` | the catalog, the search index and the bundle the PDFs are printed from | fatal — nothing else can run |
| `pdf --strict` | one PDF per version, and one per Markdown page, mirrored into `public/pdf/` | fatal — usually no browser: `npx playwright install chromium` |
| `chm` | the help files and `public/download/manifest.json` | a warning — a machine without `hhc.exe` still has a site |

| | |
|---|---|
| **You should see** | `public/pdf/t3000/1.0.pdf`, `public/download/manifest.json`, and `public/chm/…` only when the help compiler is on the machine |
| **If not** | the message names the step that failed: the site build, the PDFs (browser missing), or the help files (a warning, never fatal) |

These files are the one thing the deploy cannot make for you: the site's CI has no browser and no `hhc.exe`, so a PDF is printed here and committed — and the deploy **refuses to ship a version whose PDF is missing**. That refusal is the guard you will meet in step 9 if you skip this step.

**Redo this after every step 6.** Each new version needs its own PDF, and the guard counts versions, not projects.

## Step 8 — look at it before publishing

**Start the Site** (`temcoLearn.site.start`).

It builds the site first if `dist/index.html` is not there, then serves the built pages on one port — `temcoLearn.sitePort`, 1025 by default.

| | |
|---|---|
| **You should see** | `http://localhost:1025/` with T3000 under **Documentation**, and its page opening from the card |
| **If not** | the port is `temcoLearn.sitePort`; the site's log in the panel says whether the build or the server is the problem |

What you see here is what a reader will see, minus the address. If a page is missing, the page is not registered or `ship` is false — go back to step 3 rather than rebuilding.

## Step 9 — publish

**Publish** (`temcoLearn.publish`) opens the publishing page: what changed, the steps of a publish in order, and the button. Press *Publish* there, and confirm the message. **Publish Now** (`temcoLearn.publishNow`) is the same act from the palette.

It does four things in order, and it stops at the first that says no:

| | |
|---|---|
| 1 | runs the site's `catalog`, so what is committed matches what the pages say |
| 2 | runs the site's **`guard`** — the same gate its CI runs — and refuses to commit when a version is missing a download |
| 3 | `git add --all` and one commit; the message defaults to `docs: publish the site (<date>)`, and you can replace it |
| 4 | `git push origin HEAD:main` |

Nothing is ever force-pushed: if `main` carries work this clone does not know about, the push is refused, the commit stays local, and a pull followed by another publish fast-forwards it.

Then the site's CI takes over: `pages.yml` runs its checks, builds the site, runs the same guard, and deploys `dist` to GitHub Pages — the address the log printed. A `v*` tag matching `package.json` instead packs the whole site as a zip for handing to somebody.

| | |
|---|---|
| **You should see** | in the clone, `git log -1 --stat` shows the commit and `git status` is clean; the log says `pushed <commit>`; the GitHub Actions run on `main` is green; and the address the log printed loads the page a minute later |
| **If not** | *the guard refused it* means step 7 was skipped for some version — the log names the missing file, and nothing was committed. *A refused push* means the clone is behind: pull, then publish again |

A publish carries everything waiting in the clone, not only the project you were working on. If that is not what you want, open the publishing page first: it lists the paths the commit would take before you press the button.

## Running it again

After the first publish, the loop is shorter than the guide above, because the folders, the project and the site clone already exist. What you re-run depends on what changed:

| What changed | Build | Add | Downloads | Publish |
|---|---|---|---|---|
| pages only, same version | ✓ | ✓ (same version — it replaces) | ✓ | ✓ |
| pages, and this is a new release | ✓ | ✓ (new version) | ✓ | ✓ |
| nothing — you only want to push someone else's changes | — | — | — | ✓ |
| the site's own code or content | — | — | — | ✓ |

The four commands, in order:

```text
Temco Docs:    Build the Site                  temcoDocs.buildSite
Temco Learn:   Add This Build to the Site      temcoLearn.addBuild
Temco Learn:   Make the Downloads              temcoLearn.site.downloads
Temco Learn:   Publish                         temcoLearn.publish
```

Two habits save the most time: **add a new version for a new release** (re-adding the same version replaces it, so readers lose the old one), and **redo the downloads every time you add** — the guard counts versions, so a new version without its PDF blocks the publish rather than the deploy.

## The same flow, as files — T3000

```text
~/temco/projects/t3000/                   the project, and only the project
├── docs/help/registry.json               the page registry
├── docs/commissioning/*.md               your pages
└── dist/site/index.html                  step 4 — the site build

~/temco/temco-learn/                      the site clone
├── content/t3000/site.json               step 6 — the title and the section
├── public/imported/t3000/1.0/index.html  step 6 — the build's own pages
├── public/pdf/t3000/1.0.pdf              step 7 — the whole-guide PDF
├── public/chm/t3000/1.0.chm              step 7 — the help file, when it compiles
├── public/download/manifest.json         step 7 — what the download menu offers
├── public/catalog.json                   what the site reads; rewritten by steps 6 and 9
└── dist/                                 step 9 — what CI deploys
```

## What the files look like

Three files carry the whole arrangement. Knowing their shape is how you tell a wrong page from a wrong build without guessing.

**`~/temco/projects/t3000/docs/help/registry.json`** — written by the create flow and by every page you add. It is the only list of pages; nothing else decides what exists.

```json
{
  "version": 1,
  "areas": { "t3000": { "title": "t3000", "audience": "user", "noindex": false } },
  "pages": {
    "t3000/commissioning/ports": {
      "title": "Ports and wiring",
      "area": "t3000", "chapter": "commissioning", "order": 10,
      "audience": "user", "ship": true, "owner": "docs"
    }
  }
}
```

`ship: false` leaves a page out of the built site. `order` decides its place inside the chapter. The key (`t3000/commissioning/ports`) must equal the file's path under `docs/`, or the page counts as missing.

**`~/temco/temco-learn/content/t3000/site.json`** — written once by step 6, and kept after that. It is how the site names the project and files it under a section.

```json
{ "title": "T3000", "section": "documentation" }
```

Add `"summary"` for the sentence shown on the project's card, and change `"section"` to move the whole project to another category.

**`~/temco/temco-learn/public/catalog.json`** — generated, never edited. Every row is either a Markdown page the site owns or an imported page your build wrote, in one reading order.

```json
{ "projects": [ { "id": "t3000", "title": "T3000", "section": "documentation",
                  "versions": [ { "version": "1.0",
                                  "pages": [ { "href": "index.html", "title": "T3000", "kind": "build" } ] } ] } ] }
```

That `"kind": "build"` is the tell: the page came from your build, not from the site's own content. If it is missing after step 6, the catalog did not run.

## Reference: what the outputs mean

The ticks on a project say what it is meant to produce. One build is meant to produce all of them.

| Output | Is | Which script runs, in your repository |
|---|---|---|
| Website | static pages for Temco Learn | `docs:site`, else `docs:build`, else the built-in generator |
| PDF | one document, printed layout | `build:help:dry`, else `docs:pdf` |
| Offline help | the `.chm` | `build:help:dry` |
| Search index | the index the site loads | none here — the site builds it with `npm run search` |
| AI index | embeddings, kept on this machine only | none here — nothing is uploaded |

A build writes inside your project folder: the site to `dist/site` (or `dist/docs` when a repository's own generator wrote it), the PDF and the `.chm` wherever your scripts put them — commonly `dist/`, or a `HelpDocs` folder beside the repository. Every file it leaves behind is recorded against the build, so the Builds and Downloads pages can list it.

## Two things worth doing on purpose

A guard nobody has watched refuse is a guard nobody can trust.

| Try this | You should see |
|---|---|
| Delete `public/pdf/t3000/1.0.pdf`, then publish | the publish **stops before committing** and names the missing file. Run *Make the Downloads*, publish again — it goes through |
| Rename the project's page title, rebuild, add the build again as `1.1` | version `1.1` lands under `t3000`: `content/` still holds one folder, and the catalog lists one project with two versions |

## When a step goes wrong

| Step | What you see | What it usually is | Where to look |
|---|---|---|---|
| 4 | the build is not in the list to add | no `index.html` in it, or it sits deeper than two folders below a root | the folder itself; the roots are the window's folders, the projects folder and the working folder |
| 6 | adding refuses | the site clone is not where `temcoLearn.siteRepo` says | the setting, and that the folder has `package.json` and `content/sections.json` |
| 6, 9 | the catalog did not run | no `npm ci` in the clone, or no `catalog` script | the site log |
| 9 | publishing refuses | the site's guard: a version has no committed PDF | the guard lines in the log |
| 9 | publishing pushes, the site looks unchanged | the commit carried nothing — the clone matched the last publish | `git log` and `git status` in the clone |
| 6 | the site page is wrong after a rebuild | the build was rebuilt but never added again as a new version | `public/catalog.json` and `public/imported/` |

## Beyond the flow

A project can do more than publish. Nothing below is needed to get a page live; all of it is available once you have one.

### Bringing in material that already exists

A **source** is where pages are written from: a repository, a folder, or a document. Two doors, the same result — the project's own page (`temcoProjects.editProject`), or the `Pages` view title → **Add a Source** (`temcoProjects.addSource`, the plug beside `＋`).

For "I already have a `docs/` folder", create the project with **From existing files** and choose the folder or file. A folder that already has `docs/help/registry.json` is cited as it stands, nothing copied; anything else — Markdown, HTML, Word (`.docx`) or a compiled `.chm` — is converted **once** into `docs/` and a registry, so it becomes ordinary pages from then on. A source is recorded once and can be cited by more than one project; nothing is ever written back to it.

### Writing in the editor

A page opens in **Temco Editor**, which owns `*.md`. The ribbon, left to right: undo/redo · **Style** (paragraph, heading, alignment) · **Lists** (bullet, numbered, task) · bold `Ctrl+B` · italic `Ctrl+I` · underline `Ctrl+U` · strike `Ctrl+Shift+X` · inline code `Ctrl+E` · highlight `Ctrl+Shift+H` · quote `Ctrl+Shift+B` · code block `Ctrl+Alt+C` · rule · table · **Picture**, **Screenshot**, **Annotate**, **Link to page** · `···` for the rest, including *Open the source* and *Page properties* · right group: Find `Ctrl+F`, Outline `Ctrl+Alt+O`, Read/Edit, Preview `Ctrl+Alt+P`, Diff `Ctrl+Alt+D`, Source, Page properties.

**Pictures** — click one to select it and drag a handle to resize; the width is remembered in the Markdown title (`"w=480"`) and the built site honours it. With a picture selected the inline menu offers 25% · 50% · 75% · 100% · Delete. `Ctrl+Z` undoes a resize; the file is only written when the editor saves. The **Page** container at the far right holds the outline and the draft the AI wrote.

### Checking before you build

**Validate** (`temcoDocs.validate`) answers one question: *would a reader find a broken link, a missing page, or a page nobody registered?* It reports in the Problems panel. A build does not fail on what it finds — the published site just contains it — so run it before step 4.

### Releasing a build locally

**Publish** on the Releases page (`temcoDocs.publishRelease`) is not publishing to the site: it copies the last build's artifacts into the application's own storage — `published/<project>/<version>`, with a manifest — behind a confirmation that names the version, the destination and the file count. `temcoDocs.openPublished` opens that copy, `temcoDocs.servePublished` serves it, `temcoDocs.stopServing` stops it. Use it to hand a build to somebody, or to keep a version that will not change. Nothing is pushed anywhere.

### Exporting

**Export…** (`temcoDocs.export`) opens the Exports page, which says what you get before you get it. Every export writes into the project's `dist/` and the notification offers *Show in Folder*.

| Shape | Command | You get |
|---|---|---|
| the site, as a zip | `temcoDocs.exportSite` | `index.html`, `assets/site.css`, every page, each page's `media/` — the finished website before it is served from anywhere |
| one page, as one file | `temcoDocs.exportPage` | a single `.html` with the stylesheet inlined and every picture a `data:` URI — it opens on a machine that has never seen the project |
| one page, as a Word document | `temcoDocs.exportDocx` | a `.docx` with headings, lists, tables and the pictures embedded — the format reviewers ask for |
| the pages, as a Markdown bundle | `temcoDocs.exportMarkdown` | every `.md`, each folder's `media/`, and `registry.json` — the sources, for another tool or an archive |

Nothing is uploaded. A page with very large pictures makes a very large single file; export the site as a zip when the pictures matter more than the convenience.

### Translating a page

**Translate This Page…** (`temcoDocs.translatePage`) writes the translation **beside** the page, never over it: `docs/guide/setup.md` → `docs/guide/setup.de.md`.

- Only the prose is translated: code fences, inline code, table rules, link targets, image paths, front matter and the leading `#`/`-`/`>` markers are preserved byte for byte, so a translated page still builds, links and shows its pictures.
- **Once**: an Azure AI Translator resource. Its key goes into the OS keychain with **Set the Translator Key** (`temcoDocs.setTranslatorKey`); endpoint and region are the settings `temcoDocs.translator.endpoint` and `temcoDocs.translator.region`.
- **One request per page**, sent only when you run the command — nothing is translated in the background.
- **Errors**: `401` a key that was refused, `403` a key without a Translator resource (*check the region*), `429` the free tier's rate limit. A page of code only says there is no prose, and costs nothing. Translating again asks before replacing the sibling file.
- A translation is an ordinary page: the registry and the review flow treat it like any other file, and a build includes it. Listing it in a language menu on the site is a registry decision, not the translator's.

## When something else goes wrong

For the publishing pipeline, the table above covers it. These are the rest:

| What you see | What it means | What to do |
|---|---|---|
| Build the Site says *no `docs:site` (or `docs:build`) script* | the project has a `package.json` but no site script | add one, or delete the `package.json` so the built-in generator takes over |
| Build the Site says *has no pages marked for publishing* | no page is registered for the site, or every registered page is missing its file | open `Pages`, look for `missing` rows, use **Create the Missing Page File** |
| the site builds but a page is empty | the page is registered and its file exists, but the Markdown is empty | write it, or **Retire the Page** |
| a page is missing from the published site | it is not registered, or it is not marked for the site | `Pages` → `…` → **Open Registry** |
| an export says *has no pages to export* | no registered page has a file yet | create or generate the pages first |
| a single-file page shows a broken picture | the picture's path in the Markdown is wrong, or it is not under the page's `media/` | fix the reference; the same link is broken on the site |
| the editor shows raw Markdown | the file opened as text | in `Pages`, right-click the page → **Open the Page**; or in Explorer, **Reopen Editor With…** → **Temco Editor** |
| a picture is full width on the web but small in the editor | the page is older than the width support | reselect the picture, drag a handle, save |

Output that explains itself: **View → Output → `Temco Docs`**. Every build, publish, export and generator decision is written there with the path it used.

## Appendix — every button, one page

Every control the platform puts on screen, grouped by where it lives; the command id beside each one is the same action in the Command Palette (`Ctrl+Shift+P`). Every id here was checked against the manifests: if a row is in this table, the command exists.

### Projects (activity bar)

| Button | Where | Command |
|---|---|---|
| **Create a Project** | `Projects` view title `+` | `temcoProjects.newProject` |
| **Open the Project Page** | `Projects` view title | `temcoProjects.openProjectPage` |
| **Remove All Projects** | `Projects` view title | `temcoProjects.removeAllProjects` |
| **Start** (open a project) | right-click a project row | `temcoProjects.openProject` |
| **Edit** (sources of a project) | right-click a project row | `temcoProjects.editProject` |
| **Project Detail** | right-click a project row | `temcoDocs.projectPage` |
| **Build** (the project's own build) | right-click a project row | `temcoProjects.buildProject` |
| **Stop Working on a Project** | right-click the *current* row | `temcoProjects.clearProject` |

### Documentation (activity bar)

| Button | Where | Command |
|---|---|---|
| **New Page** | `Pages` title `＋` | `temcoDocs.newPage` |
| **New Folder…** | `Pages` title 📁 | `temcoDocs.newChapter` |
| **Add a Source** | `Pages` title 🔌 | `temcoProjects.addSource` |
| **Capture a Screenshot** | `Pages` title 📷 | `temcoDocs.captureImage` |
| **Paste Screenshot** | `Pages` title 📋 | `temcoDocs.pasteImage` |
| **Refresh** | every view title ⟳ | `temcoDocs.refresh` |
| **Open the Page** | `Pages` `…` / page row | `temcoDocs.openPage` |
| **Validate** | `Pages` `…` | `temcoDocs.validate` |
| **Overview** | `Pages` `…` | `temcoDocs.overview` |
| **Open Registry** | `Pages` `…` | `temcoDocs.openRegistry` |
| **Import a Word Document** | `Pages` `…` | `temcoDocs.importDocx` |
| **Create the Missing Page File** | right-click a `missing` row | `temcoDocs.createPage` |
| **Rename the Page Title / Move Up / Move Down / Retire** | right-click a page | `temcoDocs.renamePage`, `.movePageUp`, `.movePageDown`, `.retirePage` |
| **Attach the Screenshot to a Page…** | right-click a capture in `Needs You` | `temcoDocs.attachCapture` |
| **Build the Site** | `Publish` title 🌐 | `temcoDocs.buildSite` |
| **Publish to GitHub Pages** | `Publish` title ☁ | `temcoDocs.publishSite` |
| **Build the Offline Help** | `Publish` title 📦 | `temcoDocs.buildHelp` |
| **Export…** | Releases page (opens the Exports page) | `temcoDocs.export` |
| **Export the Site as a Zip** | palette | `temcoDocs.exportSite` |
| **Export the Page as HTML** | palette, page right-click | `temcoDocs.exportPage` |
| **Export the Pages as a Markdown Bundle** | palette | `temcoDocs.exportMarkdown` |
| **Export the Page as Word** | Exports page, palette | `temcoDocs.exportDocx` |
| **Review Center** (row) | `Publish` view | `temcoDocs.review` → opens the Review Center page |
| **Build Center** (row) | `Publish` view | `temcoDocs.builds` → opens the Build Center page |
| **Releases** (row) | `Publish` view | `temcoDocs.releases` → opens the Releases page |

### Editor (while a page is open)

| Button | Where | Command |
|---|---|---|
| **Bold / Italic / Link to a Page / Format…** | editor title | `temcoDocs.format.bold`, `.italic`, `.linkPage`, `.pick` |
| **Preview the Page** | editor title, `Ctrl+Alt+P` | `temcoDocs.previewPage` |
| **Diff the Page with HEAD** | editor title, `Ctrl+Alt+D` | `temcoDocs.diffPage` |
| **Page Properties** | editor title | `temcoDocs.pageProperties` |
| **Capture / Paste Screenshot** | editor title | `temcoDocs.captureImage`, `temcoDocs.pasteImage` |
| **Open the source** (plain text) | editor title, ribbon `···` | `temcoEditor.openSource` |
| **Temco Markdown** (whole menu) | editor right-click | submenu with every format verb |

### The pages themselves

| Button | On the page | Command |
|---|---|---|
| **Build Site** | Build Center, Releases | `temcoDocs.buildSite` |
| **Build Offline Help** | Build Center, Releases | `temcoDocs.buildHelp` |
| **Refresh** | Build Center | `temcoDocs.builds` |
| **Open** (an artifact) | Build Center → Artifacts | `temcoDocs.openArtifact` |
| **Publish** | Releases | `temcoDocs.publishRelease` |
| **Publish to GitHub Pages** | Releases | `temcoDocs.publishSite` |
| **Export…** | Releases | `temcoDocs.export` |
| **Serve / Serve the Newest** | Releases, release rows | `temcoDocs.servePublished` |
| **Open** (a release) | Releases → release rows | `temcoDocs.openPublished` |
| **Stop Serving the Site** | palette | `temcoDocs.stopServing` |

### The site

| Button | On the page | Command |
|---|---|---|
| **Start the Site** | Documentation Site | `temcoLearn.site.start` |
| **Stop the Site** | Documentation Site | `temcoLearn.site.stop` |
| **Build the Site** (the site itself) | Documentation Site | `temcoLearn.site.build` |
| **Make the Downloads** | Publishing, Documentation Site | `temcoLearn.site.downloads` |
| **Add a Build to the Site** | Publishing | `temcoLearn.addBuilds` |
| **Publish** | Publishing | `temcoLearn.publish` |
| **Publish Now** | Publishing | `temcoLearn.publishNow` |

### Settings

| Button | On the page | Command |
|---|---|---|
| **General** | Settings | `temcoWorkbench.settings.general` |
| **Modules** | Settings | `temcoWorkbench.settings.modules` |
| **AI Runtime** | Settings | `temcoWorkbench.settings.ai` |
| **Branding** | Settings | `temcoWorkbench.settings.branding` |
| **Publishing** | Settings | `temcoWorkbench.settings.publishing` |
| **Repositories** | Settings | `temcoRepositories.settings` |
| **Check the Platform for Updates** | Modules | `temcoWorkbench.settings.checkUpdates` |
| **Test the Publish Target** | Publishing | `temcoWorkbench.settings.testPublish` |
