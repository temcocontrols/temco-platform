# Temco Platform — documentation

Two products, and a mock of the window they live in.

| Folder | What it documents |
|---|---|
| [`temco-platform/`](temco-platform/README.md) | **Temco Platform** — the application: the shell, its modules, how it is built, and the rules that keep it that way |
| [`temco-learn/`](temco-learn/README.md) | **Temco Learn** — the published documentation site: the content model, the engine, the template, search, the offline artifacts, and the review flow |
| [`mock/`](mock/README.md) | **The layout mock** — a static, interactive site that draws the whole window so a layout can be settled before the shell is changed |

Read [`temco-platform/README.md`](temco-platform/README.md) when you are writing code.
Read [`temco-learn/README.md`](temco-learn/README.md) when you are producing documentation for a product.
Open [`mock/index.html`](mock/index.html) when you are arguing about the layout.

## The tree

```text
docs/
├─ temco-platform/
│  ├─ README.md            the application: the shell, the modules, the build
│  ├─ naming.md            ids, titles, settings and namespaces
│  ├─ entry-points.md      the two seams where product code joins VS Code
│  ├─ build-and-publish.md  a project's build → the site → GitHub Pages
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
