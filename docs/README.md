# Temco Platform — documentation

Two products, and a mock of the window they live in.

| Folder | What it documents |
|---|---|
| [`temco-platform/`](temco-platform/README.md) | **Temco Platform** — the application: the shell, its modules, how it is built, and the rules that keep it that way |
| [`temco-learn/`](temco-learn/README.md) | **Temco Learn** — the published site: its stack, the catalog it reads, the downloads it serves, and the deploy |
| [`mock/`](mock/README.md) | **The layout mock** — a static, interactive site that draws the whole window so a layout can be settled before the shell is changed |

Read [`temco-platform/README.md`](temco-platform/README.md) when you are writing code.
Read [`temco-platform/introduction.md`](temco-platform/introduction.md) when you are putting a project on the site — it is the place to start as a new user.
Read [`temco-learn/README.md`](temco-learn/README.md) when you are changing the site itself.
Open [`mock/index.html`](mock/index.html) when you are arguing about the layout.

## The tree

```text
docs/
├─ temco-platform/
│  ├─ README.md            the application: the shell, the modules, the build
│  ├─ naming.md            ids, titles, settings and namespaces
│  ├─ entry-points.md      the two seams where product code joins VS Code
│  ├─ introduction.md      where a new user starts: the whole app, the publish flow first
│  ├─ catalog.md           the tables the store keeps, and every setting a module declares
│  ├─ platform-design.md   the engineering design: what the platform is and why
│  ├─ design/              four specifications: the assistant's MCP server, the authoring and MSDN target, support intake from T3000 and its engineering
│  ├─ modules/
│  │  ├─ README.md         the module register: what each module owns
│  │  └─ temco-docs/       the documentation module
│  └─ ui/                  the application's surfaces: the window, the editor
├─ temco-learn/
│  ├─ README.md            the site: what it serves and how it is produced
│  ├─ content-package.md   what a product ships for the site to build
│  └─ design/              the engineering design, 17 documents
└─ mock/
   ├─ README.md            the mock: the window, the modules, how to add a surface
   ├─ index.html           the shell — open this file in a browser
   ├─ css/                 tokens, shell geometry, view vocabulary
   └─ js/                  mock data, the UI builders, the views, the behaviour
```

## The rules these documents follow

- A document describes **what is true now and what will be built** — never how the decision was reached, when, or by whom.
- **No dates, no progress marks, no meeting notes.** If something is not part of the product, it is not here.
- One subject per document, and the document's name is the name of the subject.
- The design documents of `temco-learn/design/` carry a number so they can be read in order; everything else does not need one.

## Pictures in a guide

A guide that shows you a screen carries a **slot** where the picture will be: the sentence it says, and the path the file will live at, in backticks.

```text
> **Screenshot — the Build Center after a build: the four counts, one card per output.**
> `media/publishing/04-build.png`
```

Save the PNG where the path says, then run `npm run docs:screenshots`. It turns every slot whose file is there into a picture, using the sentence as the alt text a screen reader reads, and names the slots still waiting. A slot whose picture is missing stays a note rather than becoming a broken image, and `npm run check-temco-docs` refuses a page that draws a picture it does not have, or numbers its slots `00`, `01`, `03`.
