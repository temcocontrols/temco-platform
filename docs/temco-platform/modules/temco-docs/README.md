# Temco Docs — documentation

This folder documents the **Temco Docs module** (`extensions/temco-docs`): what it does, how it is built, what it
assumes, and where it is going. The platform-wide design is [design/temco-learn/](../../../temco-learn/design/README.md).

The product documentation itself is not here: the pages and the registry live in the product repositories,
because that is where the content has to be.

| Document | Read it when |
|---|---|
| [`architecture.md`](./architecture.md) | you need the whole picture: the repositories, the flow, how it ships |
| [`registry-schema.md`](./registry-schema.md) | you touch anything that reads or writes registry data |
| [`extension-design.md`](./extension-design.md) | you add a view, a command, a check or a diagnostic |
| [`platform-design.md`](../../ui/platform-design.md) | you work on the platform itself: sources, the documents a person creates, builds and artifacts, the AI over history, and the catalog |
| [`editor-design.md`](../../ui/editor-design.md) | you work on editing: the toolbar, creating a page, images, drafts, and the write rule they wait on |
| [`app-flow.md`](../../ui/app-flow.md) | you work on the left toolbar, a panel, or where a row leads: the four containers, what each view asks, and the page behind every row |
| [`authoring-flow.md`](../../ui/authoring-flow.md) | you work on screenshots, the side bar, or when a page must be re-illustrated: the capture stage, the two views, and what still waits on a decision |
| [`app-layout.md`](../../ui/app-layout.md) | you need the target UI: the application window, the site's generated dashboard, and the seam between them |
| [`design/temco-learn/`](../../../temco-learn/design/README.md) | you need the platform design itself: content model, registry, search, the offline CHM, editing, feedback, AI, governance |

## The three names, and why they are different

| Name | What it is |
|---|---|
| **Temco Platform** | the application: the branded build of VS Code, with these modules built in |
| **Temco Docs** | this module — the documentation features, in the application and in an ordinary VS Code window |
| **Temco Learn** | the published site: the documentation people read |

One name for the tool, one for the module, one for the artifact. The module maintains content; Temco Learn
displays it. Keeping them apart is what stops "put it in Temco Learn" from being ambiguous.

## The guide, and why a module has one

`temcoDocs.overview` opens **Documentation** (`src/overview.ts`): the tree answers "where is this page", and this page answers "what am I looking at" — pages, areas, how much is behind its source, which faults the checks found, and the three checks that can be run from here. Every number is computed from the same registry the tree reads, so the page and the tree cannot disagree. It is also the **one owner of per-area coverage**: a *Coverage & Health* page used to exist on the workbench dashboard, drawn from this same registry, and was removed rather than left to drift.

**How To Use** was removed: it was a mock guide whose numbers were typed in (“13.0 is current”, “17 pages are waiting”), and a guide that quotes stale figures teaches the wrong thing.

The rest of the container is the mock's Documentation module, page for page: **Projects**, a repository, **Sources**, **Documents** and a page, a **Source Explorer**, **Review Center**, **Build Center** and **Releases** (`src/docsPages.ts`). The side bar holds the mock's sections and rows — Pages, Projects, Sources, Areas, Pipeline, Working Set — plus the page tree itself, which is why there is no separate *Docs Explorer* activity-bar icon: one icon browses one object.

**The Build Center** answers three questions, in the order a person asks them, in one column: **Builds** (what has run — `#12`, when it started, how long it took counted from the two timestamps, and the verdict as a badge, newest tagged `Latest`), **What they left** (every file a build wrote, newest first, each row opening the file), and **Where a build writes** (the two scripts and the folders they fill: `docs:site → dist/site · dist/docs`, `build:help:dry → .chm in the project, or in HelpDocs beside it`). Both lists fold after five and six rows behind a native `<details>`: a site build leaves hundreds of pages, and a page that prints them all is a page nobody reads to the end.

The title block carries **only the two acts this page owns** — `Build the Site` and `Build the Offline Help`. `Refresh` was removed (reopening a page re-reads it) and `Publish & Releases` became a link in the files section it belongs to: three of four buttons in a title block were navigation, which is what made the page read as a menu rather than a record.

Every one of them is drawn with the shared page vocabulary from `temco-ui` (`page.css` + `page()`), so they are the pages whose look is the mock's design rather than a private `<style>` block. The pattern they establish is the one the module's other pages move to: a page describes what it draws, and `temco-ui` decides how that looks and how a click becomes a command.

## Where the platform design lives

[`temco-learn/design/`](../../../temco-learn/design/README.md) — 17 documents covering the content model, the
registry, search, the offline CHM, the editing and git flow, feedback, the AI features, the implementation
plan and the governance rules. `16-overview.md` is the one-page version.

**They describe the platform, and their paths belong to the product repository.** `docs/t3000/**`,
`docs/help/registry.json`, `docs/docfx.json`, `scripts/docs-*.mjs` and `dist/docs/` are the *product* repo's
paths, not this one's: the content and the publishing pipeline stay there by design.

Where the two disagree, the design package wins — and the disagreement is a bug worth fixing in one place or
the other.
