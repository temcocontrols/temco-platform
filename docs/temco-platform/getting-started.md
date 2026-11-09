# Getting started

This is the guide for anyone new to Temco Platform: how to go from an empty folder to a page on **Temco Learn**, the published documentation site. It is one path, in order, and every step names a file you can look at before you go on — so if something goes wrong you know which step it happened in, not just that the end did not work.

> **Screenshot — the finished result: a project card under Documentation, opened to a page, with the version selector and the download menu visible.**
> `media/publishing/00-published-page.png`

## What you are making

Five things take part, and each one lives somewhere different. Knowing which is which is the whole of understanding this flow.

| Thing | Is | Lives in |
|---|---|---|
| **A project** | one body of documentation: its name, its pages, and the outputs it should produce | `<projectsFolder>/<slug>/` — `~/temco/projects/t3000` |
| **A page** | one Markdown file, listed in the project's registry | `<project>/docs/<area>/*.md` and `docs/help/registry.json` |
| **A build** | the rendered site, made from those pages | `<project>/dist/site` (or `dist/docs` when your own generator wrote it) |
| **The site** | the Temco Learn repository — a React app that reads a catalog of projects | `temcoLearn.siteRepo` — `~/temco/temco-learn` |
| **The published page** | what a reader opens on the internet | GitHub Pages, served from the site's `main` branch |

Three of those are yours and stay yours; the site is the site's own repository; the last one belongs to GitHub. That split is why the flow has separate steps instead of one button: writing, rendering, publishing and deploying are four different acts with four different failure modes.

## What you will have when you are done

- T3000 listed under **Documentation** on the site, with its own card, icon and description.
- Every version you added, selectable — `1.0`, `1.1`, `2.0` — each with its own pages.
- A **Downloads** menu per version: the whole-guide PDF, and a Windows help file when one could be compiled.
- Your pages in the site's search index.
- One commit on `main` in the site repository, and a green GitHub Actions run that deployed it.

## The flow

Four acts, four places. The diagram is the whole guide; the nine steps below are this diagram with the details filled in.

```text
1  your pages           ~/temco/projects/t3000/docs/
2  a build              ~/temco/projects/t3000/dist/site
3  Add a Build          ~/temco/temco-learn/public/imported/t3000/1.0/
4  Make the Downloads   ~/temco/temco-learn/public/pdf/t3000/1.0.pdf
5  Publish              ~/temco/temco-learn → GitHub Pages
```

| Act | What changes | What a reader would notice |
|---|---|---|
| A build | files inside your project folder | nothing — nobody else can see it yet |
| Add a build | the site clone, uncommitted | nothing yet, but it is previewable at `localhost` |
| Make the downloads | the site clone, uncommitted | nothing yet — but the deploy would refuse without them |
| Publish | one commit on `main` | a minute later, the page is live |

## Before the first time

| Do this once | Why |
|---|---|
| Node 22 or newer on your path | the site's own scripts run with `--experimental-strip-types` |
| Have the site clone — the Site page (**Open the Site Page**) clones `temcocontrols/temco-learn` for you | the site is its own repository; this application is a client of it |
| `cd ~/temco/temco-learn && npm ci` | the site's dependencies, once per clone |
| `npx playwright install chromium` | the PDFs are printed by a browser; without it *Make the Downloads* says so |
| Optional: HTML Help Workshop | a `.chm` needs `hhc.exe`; without it the site simply has no help file |

## Where things go

Three settings decide every path in this guide. Set them once; each page reads them back, so you can check the answer rather than the field.

| Setting | Where | Meaning |
|---|---|---|
| `temcoRepositories.workspaceFolder` | Settings ▸ Repositories ▸ Working folder | the working area; clones go to `<it>/source/<repository>` |
| `temcoRepositories.projectsFolder` | Settings ▸ Repositories ▸ Projects folder | a project's own folder is `<it>/<slug>` |
| `temcoLearn.siteRepo` | the Site page ▸ **Choose the Site Folder**, or the setting | the site clone — `~/temco/temco-learn` unless you say otherwise |

`temcoWorkbench.publishing.site` is not one of these: it is the address the Publishing page prints, not a folder.

## Step 1 — check the folders

Open **Settings ▸ Repositories** and read the two sentences under the fields, not the fields themselves.

> **Screenshot — the Repositories settings page, with “Clones land in …” and “Projects are made in …” visible.**
> `media/publishing/01-folders.png`

| | |
|---|---|
| **You should see** | `Clones land in …\temco\source` and `Projects are made in …\temco\projects` |
| **If not** | the page reads your saved profile, so a value typed but not saved still shows as the old one — press *Choose* or leave the field, then look again. `Projects are made in …\temco` means the projects folder is still empty |

## Step 2 — create a project

**Create a Project** (`temcoProjects.newProject`). Name it `T3000` and leave the outputs ticked: *Website*, *PDF*, *Offline help*, *Search index*.

> **Screenshot — the create-project form, with the output ticks visible and a name typed in.**
> `media/publishing/02-create-project.png`

| | |
|---|---|
| **You should see** | `~/temco/projects/t3000/docs/help/registry.json`, and T3000 in the Library |
| **If not** | the folder is the slug of the name — look in `~/temco/projects/` for what was actually made. A project created before you set the projects folder keeps the folder it already has; only new ones move |

The folder is added to the window so its `docs/` shows in Explorer. That is expected.

## Step 3 — write the pages

**New Page** (`temcoDocs.newPage`) with T3000 selected, then type. Repeat for as many pages as you have.

| | |
|---|---|
| **You should see** | a Markdown file under `~/temco/projects/t3000/docs/<area>/`, and `registry.json` listing it |
| **If not** | the project has to be the **selected** project: the docs module reads the folders the selected project cites, not whatever folder happens to be open |

## Step 4 — build the site

**Build the Site** (`temcoDocs.buildSite`), or *Build the Site* on the project page.

> **Screenshot — the Build Center after a build, with the new row and its artifact.**
> `media/publishing/03-build.png`

| | |
|---|---|
| **You should see** | `~/temco/projects/t3000/dist/site/index.html`, and a row in the Build Center (`temcoDocs.builds`) |
| **If not** | a project made here has no `package.json`, so the built-in generator writes the site — the log says what it read. If your repository has `docs:site` or `docs:build`, that script runs instead, and it may write `dist/docs` |

The exit code is never the verdict: what counts is a file that did not exist before the run and does now.

## Step 5 — build the project's own outputs (only for a repository)

Skip this unless T3000 cites a real repository clone under `~/temco/source/`. **Temco Projects: Build** (`temcoProjects.buildProject`) takes the outputs you ticked and runs the repository's own script for each one, once each.

| | |
|---|---|
| **You should see** | the terminal run `docs:registry` when the repository has it, then one script per ticked output — `docs:site` for *Website*, `build:help:dry` for *Offline help* — and the log list the files they left behind |
| **If not** | the warning names the scripts it looked for. A repository with none of them ran nothing, which is the honest answer. A scaffolded project has no scripts at all: step 4 is its build |

## Step 6 — add the build to the site

**Add This Build to the Site** (`temcoLearn.addBuild`), or *Choose a build* on the Publishing page.

> **Screenshot — the version box, showing “project t3000” and the version field.**
> `media/publishing/04-add-build.png`

The box names the project it will land in — `project t3000` — and asks for one thing: the version. Type `1.0`.

| | |
|---|---|
| **You should see** | `~/temco/temco-learn/public/imported/t3000/1.0/index.html`, `content/t3000/site.json`, and `t3000` with version `1.0` in `public/catalog.json` |
| **If not** | the build must contain an `index.html`. The catalog is rebuilt by this step, so a failure here means the clone has no `npm ci` yet, or no `catalog` script |

The project's id is **its folder's name**: a build in `<projectsFolder>/t3000/…` is always `t3000`, whatever its pages call themselves. Its section is `documentation` unless the project's `site.json` says otherwise.

Adding a build is local. Nothing is published by this step.

## Step 7 — make the downloads

**Make the Downloads** (`temcoLearn.site.downloads`) — the step between *Add* and *Publish* on the Publishing page.

> **Screenshot — the Publishing page, with the five steps visible and the downloads step running.**
> `media/publishing/05-downloads.png`

| | |
|---|---|
| **You should see** | `public/pdf/t3000/1.0.pdf`, `public/download/manifest.json`, and `public/chm/…` only when the help compiler is on the machine |
| **If not** | the message names the step that failed: the site build, the PDFs (browser missing), or the help files (a warning, never fatal) |

These files are the one thing the deploy cannot make for you: the site's CI has no browser and no `hhc.exe`, so a PDF is printed here and committed — and the deploy **refuses to ship a version whose PDF is missing**. That refusal is the guard you will meet in step 9 if you skip this step.

## Step 8 — look at it before publishing

**Start the Site** (`temcoLearn.site.start`).

| | |
|---|---|
| **You should see** | `http://localhost:1025/` with T3000 under **Documentation**, and its page opening from the card |
| **If not** | the port is `temcoLearn.sitePort`; the site's log in the panel says whether the build or the server is the problem |

## Step 9 — publish

**Publish** (`temcoLearn.publish`) opens the publishing page: what changed, the steps of a publish in order, and the button. Press *Publish* there, and confirm the message.

| | |
|---|---|
| **You should see** | in the clone, `git log -1 --stat` shows the commit and `git status` is clean; the log says `pushed <commit>`; the GitHub Actions run on `main` is green; and the address the log printed loads the page a minute later |
| **If not** | *the guard refused it* means step 7 was skipped for some version — the log names the missing file, and nothing was committed. *A refused push* means the clone is behind: pull, then publish again |

What happens next is not this application's work: the push starts `pages.yml`, which runs the site's checks, builds it, runs the same guard, and deploys the result to GitHub Pages. A tag `v*` that matches `package.json` instead packs the whole site as a zip for handing to somebody.

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

| What you see | What it usually is | Where to look |
|---|---|---|
| the build is not in the list to add | no `index.html` in it, or it sits deeper than two folders below a root | the folder itself; the roots are the window's folders, the projects folder and the working folder |
| adding refuses | the site clone is not where `temcoLearn.siteRepo` says | the setting, and that the folder has `package.json` and `content/sections.json` |
| the catalog did not run | no `npm ci` in the clone, or no `catalog` script | the site log |
| publishing refuses | the site's guard: a version has no committed PDF | the guard lines in the log |
| publishing pushes, the site looks unchanged | the commit carried nothing — the clone matched the last publish | `git log` and `git status` in the clone |
| the site page is wrong after a rebuild | the build was rebuilt but never added again as a new version | `public/catalog.json` and `public/imported/` |

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
