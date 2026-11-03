# The layout mock

A static, interactive site that shows **the whole platform window** — activity bar, side bar, editor, panel, AI bar, status bar — so a layout can be argued about and changed before anything in the shell is touched.

Open [`index.html`](index.html) in a browser. There is no build step, no server, no dependency and no network call: the site is HTML, CSS and plain scripts, and it works from a `file://` path.

## What it is not

| It is | It is not |
|---|---|
| a design surface, read by people | a product surface, read by users |
| mock data, invented to fill the layout | a fixture, or anything the extensions read |
| plain static files under `docs/` | part of the build, the package or the shipped app |

Every number in it — 1,254 pages, 34 devices, 17 drafts — is invented. The **names** are not: modules, areas, surfaces and states come from [`../temco-platform/modules/README.md`](../temco-platform/modules/README.md), so a layout decision here is about the product that exists.

## The window

```text
┌──────────────────────────────────────────────────────────────────────────────────────┐
│ logo  File Edit View Go Tools Help        [ search or run a command ]  ▤ ▥ ✦ ◐  ─ □ ✕ │ 35
├────┬─────────────────────┬───────────────────────────────────────────┬───────────────┤
│    │ SIDE BAR  300       │ tabs                                      │ AI BAR  340   │
│ 48 │                     ├───────────────────────────────────────────┤               │
│    │ the module's tree   │ editor                                    │ chat about    │
│    │                     │  the surface the module draws             │ the page      │
│    │                     ├───────────────────────────────────────────┤               │
│    │                     │ PANEL  Problems Output Terminal Ports     │               │
├────┴─────────────────────┴───────────────────────────────────────────┴───────────────┤
│  t3000  0↑0↓  ⊗2 ⚠2                    Ln 1, Col 1  Spaces: 2  UTF-8  LF  1.144.0.0  │ 22
└──────────────────────────────────────────────────────────────────────────────────────┘
```

| Region | Size | What it is | Whose |
|---|---|---|---|
| **Title bar** | 35 px | menus, the command centre, the layout controls | the shell's |
| **Activity bar** | 48 px | one icon per module; the badge is that module's own open work | ours — one entry per module |
| **Side bar** | 300 px | the module's tree: sections, surfaces, counts | each module's |
| **Editor group** | flexible | tabs and the one surface in front, plus the breadcrumb row when it is on | the shell's; the surface is ours |
| **Panel** | `clamp(132px, 26vh, 240px)` | Problems · Output · Terminal · Ports | mostly ours |
| **AI bar** | 340 px | the conversation, its context and its citations | `temco-ai` |
| **Status bar** | 22 px | branch, problems, cursor, encoding, product | mixed |

The mock keeps the sides at fixed widths and the editor flexible, which is what the workbench does. Nothing here is a webview: a surface is a normal editor tab, so it keeps tabs, breadcrumbs, the panel and the status bar for free.

**There is no breadcrumb row by default.** In VS Code breadcrumbs are a setting (`breadcrumbs.enabled`, View › Appearance › Breadcrumbs), and this window has no file system for them to name: the bar could only repeat the side bar's module and the tab's page. So the row is off, the editor keeps its 22 pixels, and `View › Toggle Breadcrumbs` / `View: Toggle Breadcrumbs` in the palette / the `Breadcrumbs` switch on Settings › General brings it back — a real toggle rather than a fixture, remembered with the other chrome flags. When it is on, the bar reads `Module › Page` and adds the section in between only when the module has more than one: `Settings › Platform › Publishing`, `Documentation › Pipeline › Releases`, but `Workspaces › T3000`. A module with a single section also drops that group's heading in the side bar, because a heading above the only group of items names nothing the title did not. Every segment above the page is a button that opens that level, since a level you cannot go back to is only a label.

## The welcome page

A window that opens on a page you did not ask for is a window that has to justify the page. So `Welcome` is one editor tab, in front of whatever the last session left open, and it carries only things a person can act on: `Start` (open a project, add a source, browse a device, read the documents, open settings), `Recent Pages` — which stays away until the session has any — and three `Walkthroughs` with real progress. Nothing on it is a picture of the product.

It is the one page that is easy to turn off, because it is the one page that opens itself: the checkbox in its footer writes `showWelcome` with the other chrome flags, and `Help › Welcome` still opens it on demand. With the box cleared, the next start ignores both the address bar and the last session's page and lands on `Dashboard › Overview`, so "do not show it again" means what it says rather than reappearing on every reload.

## The menu bar

Menus are **verbs**, not features. A module contributes items into these shared titles; it never gets a menu of its own, or the bar would become the activity bar.

| Menu | Holds |
|---|---|
| **File** | workspace and project lifecycle: new project, open workspace, add source, save, close |
| **Edit** | text operations on what has focus |
| **View** | layout and panels: palette, quick open, the bars, Problems/Output/Terminal, theme |
| **Go** | navigation between modules and surfaces |
| **Run** | long actions that start and stop: build, query, discover, capture |
| **Tools** | module toolkits — a submenu at three or more actions, otherwise a flat item carrying the module's word (`I/O Studio: Auto-Map Points`) |
| **Help** | documentation, shortcuts, logs, an issue, about |

Two rules keep it from collapsing under more modules. **Every menu item also exists as a control on the surface it acts on** — the menu is an accelerator, never the only home for a feature. And **the long tail is not in the menus at all**: it is in `Ctrl+Shift+P`, where every command is searchable by its module prefix (`Devices: Discover`, `BACnet: Read Objects`).

A module never adds a menu title. If `Tools` ever stops being the right home, the answer is a new *verb* that the whole platform shares, the way `Run` was added here — not an eleventh menu.

## One state per surface

The tinted panel (`.hero-panel`, built by `M.ui.hero`) appears **once** on a surface, names a state and offers the decision:

| Surface | The state |
|---|---|
| Dashboard | Release 13.0 is waiting on two checks |
| Review Center | two errors keep 13.0 from publishing |
| Build Center | the offline help is still compiling |
| Devices | one controller has not answered for two hours |
| Temco Learn › T3000 | 13.0 is building; readers still get 12.9 |
| Workspaces › T3000 | everything in this window is this workspace |

Three tones: `accent` for something in motion, `warn` for something blocking, `ok` for something finished. Everything else — a note about how reading a source works, a preference, a definition — is a callout or a card. A second tinted panel on the same surface turns the signal into decoration.

The card the window is actually standing in (the current workspace, the current project) uses the same tint at roughly half strength through `.card--current`, so "current" reads without a badge.

## Coverage is not a warning

A bar here is a fill on a track, one colour at every value. Coverage and mapping use the accent, never green or amber: 76 % of a documentation area is a quantity, and painting it amber made a healthy area look broken. `--ok` and `--warn` stay reserved for states — a running build, a failed check — where the colour *is* the message.

**Coverage & Health is a report, not a table.** The tinted panel names the finding (`89 pages describe a source that has already moved on`), four stats say how big the problem is, then two plain sections do the work: *Coverage by Area* sorted worst first with a total row (`All areas · 913 of 1,254 · 73% · 89 stale`), and *Health Checks* — link rot, ownership, duplicate order keys — where a check with a count opens the queue instead of being a number to glance at. Every figure is derived from the area rows, so the page cannot disagree with itself; the area rows themselves sum to the 1,254 pages the rest of the mock quotes.

## A section, not a box

Content that is *part of* a page — Recent Activity and Needs You on the dashboard, Areas and Sources on a workspace — uses `.card--plain`: same heading, no border, no background, rows separated by hairlines and flush with the page grid. A card is for something that stands alone or can be clicked into; wrapping every block on a page in one turns a screen into a grid of rectangles and buries what matters.

## Activity is a log

Recent Activity (`M.ui` has no builder for it, the markup is in `views.overview.js`) is a grouped feed, not three lists. A day is a rule with a label and a count; under it, each event is a tone-tinted mark on a rail, its title and context, and a right-hand column carrying the **status word** (`Done`, `In Progress`, `Info`, `Attention`) and the time. The status is a word as well as a tint — colour alone is not a status for anyone who cannot see it. Both columns are fixed width, so statuses and times line up down the list instead of ending wherever each title happens to stop. Group order is newest first, times are absolute within a day (`17:20`, `09:04`) and weekday names across a week.

The mark itself is `.tone-mark` (`M.ui.toneMark(icon, tone)`): one icon in a tinted circle, built once and shared by the feed and the review queue, so red always means a page is broken, amber always means it is waiting on a person, and blue always means AI wrote it.

The page is full width like Overview, and the extra room goes to a **module column** — the same three words the filter above it offers (`Documentation`, `Devices`, `AI`) — between the text and the status. That column is behind a `@container (min-width: 620px)` query on `.feed-wrap` rather than a viewport media query: the question is whether *the list* has room, not whether the window does, so a narrow editor drops the column instead of squeezing every title onto three lines.

## A queue, not a report

**Needs Review** is the list the Activity feed links into, so it is ordered by *what it wants from you*: `Blocking the release` (the two errors that stop 13.0), `Needs a decision` (ownership, out-of-date screenshots, link rot) and `AI drafts waiting`. Each group is the same label/rule/count header the activity feed uses (`.group-head`), each group is a `.table--plain` — columns without a frame — and each row carries exactly one action: `Fix with AI` for the two blocking errors, `Review Draft` for a draft, `Open` for a decision. Only the blocking group gets the loud primary button; a column of six blue buttons makes a queue look like a dashboard.

The queue holds **17 pages**, the number the pipeline meta, the workspace tiles, the sidebar badge and the dashboard all quote — the mock never says "17 waiting" and then lists seven.

## Rows or cards

Both are used, for different reasons. A **card** is for a small set where each item is a place you enter and carries prose: Workspaces (3), Templates (4). A **row** is for a set that grows and whose items you compare: Projects, Sources, Repositories, Knowledge, Releases. Projects is the interesting one — it was a card grid for a while, and the row version won once it stopped being a seven-column table: name and state on the first line, `v13.0 · Integrators and installers · Derek · 894 pages · 14 sources · updated 12 minutes ago` on the second, each fact its own `nowrap` span so a line never breaks inside a count. At a 1200-wide window that row wraps to two meta lines and stays readable; the table squeezed the name to 108 px and broke the timestamp across three lines.

Both of those use the same row primitive (`.record-row`): a tone mark, a name line, a facts line, a state badge, and either a chevron (the row opens something) or the one action it needs (`Clone`). A row with nothing to open carries `.record-row--static` and stops pretending to be a link.

## Where a repository comes from

**Repositories** groups by origin instead of listing everything in one table: `From Temco` (everything under `github.com/temcocontrols`) and `Third-party`, each with a sentence under its heading saying what that origin means — Temco's own repositories are the sources the platform ships documentation for and stand behind; a third-party one is read exactly the same way but is nobody's promise about product behaviour. A repository added from another owner lands in the second group automatically, because the split is computed from the remote (`temco: true` in `data.repositories`), not hand-maintained per row.

The operation belongs to the group, not to the page: each heading ends with `Read All` for *that* group, and `From Temco` also carries `Clone 1 Missing` — a label and a button that both disappear when nothing is missing (`Clone 2 Missing` when two are). The page header keeps only `Add Repository`. A group header that runs out of room wraps its actions onto a second line rather than crushing the rule to zero width.

## One list of sources

**Sources** is grouped by what the source *is* — `Repositories`, `Documents`, `Folders and connections` — because that is what decides how a read behaves: a repository is cloned and read by commit, a document is read in place, a folder has no history, a connection can expire. Each group carries a `Read All` for its own members and one sentence saying exactly that.

Every row answers "what did reading it produce?": `main · 412 files · 138 pages found · read 1 hour ago`, `94 pages · 2.1 MB · changed since the last read · last read 4 days ago`, `Connected · 3 libraries · not read yet`. A source that is behind keeps the warning tint on its mark and the only action left is `Read`; a source that is up to date gets a chevron. The word "found nothing" is never used to mean "not read yet" — those are different sentences.

The page is the single source of truth for the count. The sidebar badge, the pipeline stage meta, the output line, the health scan's eyebrow and the `Read All Sources` palette command all read `7` from `data.sources` — the mock used to claim 38 in five places while listing seven.

## The other way text arrives

**Import** is where a manual that already exists becomes pages, and it is deliberately not a wizard. A document set — a folder of Word, RTF or HTML, or a CHM — lands as the repository's own shape: Markdown under `docs/`, the registry at `docs/help/registry.json`. A better conversion would produce a second content store, and then the site build and the offline help would have something to keep in step.

The three rules are on the page because they are what makes it safe to run against a real project, not because they are reassuring: nothing is written over anything (an import into a folder that already has a registry is refused outright), a page's place is derived from where it came from rather than invented, and whatever cannot be converted is said out loud. The ledger underneath shows all three happening — including the refused row, because a refused import is the rule working rather than a failure to hide.

The head carries two buttons, and that is where the layout earned a fix: the text column used to give way until the description was a 13-character ribbon. `.page-head` now wraps its actions onto their own line instead, which also repaired the same squeeze on **Knowledge**, where a four-button action group had left 206 px for the page.

## The registry

**Knowledge** browses 1,254 pages, so it is a master–detail on one surface: the areas on the left (a 260–300 px column), the pages of the area you picked on the right.

The area list is one line per area — chevron, name, percentage, and a `N stale` badge only when there is something stale. The reviewed share is **painted behind the row** as a soft accent band (`--coverage` on `.area-row`), because a bar and a percentage say the same thing and printing both costs a line per area. The selected area gets a bolder name, an accent chevron and a stronger band. The percentages are held in one column by reserving the badge width even when the area is current.

The right pane is deliberately only three columns (`Order`, `Page`, `State`) with the owner and the last change folded into a line under the page name. The earlier version put the same table in a ~360 px column with five columns and it did not fit; the panes are sized from what the table needs, and below a 640 px container the pair stacks and the areas go full width. `order` is the order of the page inside the area, not a file line — which is why two pages claiming order 20 is a release blocker rather than a cosmetic problem, and the pane's description says so with that area's own numbers (`402 pages · 194 read (48%) · 45 stale`).

Picking an area is real, not a picture: the row carries `data-action="open-area" data-area="…"`, the shell keeps the choice in `M.state.area` and re-renders — preserving `el.editor.scrollTop` so the reader stays where they were instead of being thrown to the top. `Gaps` and `Checks` sit side by side at the bottom as plain sections; `Checks` is a summary of the same findings the Problems panel and the health report hold, and counts them the same way (`1` duplicate order key, not `2` pages).

## The pipeline pages

Review Center, Build Center and Releases move one version from working copy to published, and they share a shape: a tinted panel states the condition, a plain section lists what that condition is made of, and a second plain section holds the thing you act on.

- **Review Center** — the queue takes the full width, and the row whose diff is open is marked on itself (`open below`), with the diff underneath carrying `Accept` / `Reject` in its footer. The five summary tiles that used to sit above the queue are gone: the panel already says what blocks the release, and the queue says how much is waiting (`6 items waiting, 3 of them AI drafts`, computed).
- **Build Center** — targets are a plain table with the progress column (the only bar on the page), then the log at full width so long lines never wrap, then the artifacts. The panel's count is computed (`2 of 5 targets, 2 still queued`).
- **Releases** — versions are rows; the in-flight one is tinted and marked `in flight`, `Pin` appears only on published versions and `View` on all of them, and the changelog is a section under the list rather than a card competing with the publish card.

None of the three keeps an action in the page head that is not the page's own verb (`Filters`, `Build All`, `Publish 13.0`): a second button in a head that already has one wraps the pair onto two lines at the mock's own window size, which is exactly what happened while Releases carried both `Publish 13.0` and `Changelog`.

## The AI Hub pages

Chat, Actions, Citations, Local Models and Knowledge Base describe one thing from five sides: what the model may read, what it may do, what it used, what is loaded, and what it was indexed from.

- **Chat** is the conversation at full width with a readable measure (`.chat--page` caps a bubble at 72ch), and the whole surface is **one section**: the thread, three starter prompts, then a composer whose first line is the context — `Reading · Data Points API · API Reference · t3000webview · registry.json`. What the model may read is a property of this conversation, not a page section of its own, and the page that had a `Context` list and a `Try` list below the thread made the reader ask what those sections were for. `Send` takes what was typed (the mock stops at a toast), so the composer is not a picture.
- **Actions** lists what it may do, then where the output goes (drafts → Review Center, answers → the AI bar, suggestions → the Gaps list) and the guard rails that are not settings but invariants.
- **Citations** keeps a `Used In` column, so a citation is checkable against the answer that used it.
- **Local Models** counts what is downloaded and what is loaded, and keeps `Runtime Settings` in the section head so the page head still has exactly one verb.
- **Knowledge Base** derives its chunk count from the knowledge areas (`1,254`), says how a question becomes chunks, and marks the source whose file changed under the index.

One layout rule came out of these pages and applies everywhere: `.page-head__main` is `flex: 1 1 auto` and `.page-head__actions` is `flex: 0 0 auto`, so the description wraps before a pair of buttons is stacked into a column.

## The Temco Learn pages

Temco Learn is the published site shown as a reader sees it, so it keeps its own look — a hero with a search box, product cards, a three-part article — but it takes its facts from the same registers as everything else.

- **Home** — the hero, then `Products` as a group head whose note is derived from the releases (`12.9 is live, 13.0 is still building`), then a row of four product cards whose page counts come from `data.knowledge`, and a pair of plain sections: `Learning Paths` and `Downloads`, each four rows deep at most and each with a `All …` action in its head.
- **Product page** (T3000) — the same group-head-and-note shape over the eight areas, one card each, using the area's own sentence and the count and stale number the registry holds. The panel above says what state the version is in, so no card has to.
- **Article** — a reading surface, not a form: `.learn-nav` (product nav, then the section's pages), the article itself capped at 78ch, and a `.learn-rail` holding `On this page`, the page's facts as a `.kv`, and the feedback pair. The zone is measured with a **container query** on `.learn-reader`, because a container query cannot restyle the container itself and the reader is 750px wide inside a 1440px window: under 1080px the rail moves under the article as three columns, under 860px the navigation becomes a strip of chips and the article takes the full width. A media query here would never fire at the mock's own size — the first version left the article 167px wide with its title wrapping twice.
- **Downloads** — grouped by product and version (`T3000 Documentation · 13.0`, `2 artifacts · published Today`), because what differs between rows is the format, not the product. The row is the format, its size, its state, and `Download` only when there is something to fetch; a group whose build is still running says so once, in its note, instead of repeating `not built yet` per row. Those labels pass `plain: true` to `ui.group` so a product name keeps its capitalisation instead of the upper-case category style.
- **Learning Paths** — three cards, each with a level, the cost, and the first steps of the path numbered, so a card says what the path asks you to do rather than only how long it takes. The group head counts them (`3 paths · 26 steps · 6 h 35 min of reading`).

The one number that had to be reconciled: the sample PDF page count. It was `894` on six surfaces while the knowledge registry, the release and the product card all said `1,254`; the artifact is a rendering of the same version, so it says `1,254` too.

## The Settings pages

Settings is where a value is set, not where a state is reported, so the five pages are rules and rows rather than cards: `ui.rule` names the group and counts what it holds, `.settings-rows` holds `ui.formRow`s under it, and the only box on any of them is a callout.

- **The page title is the page's own name.** `Settings` is the module — it is already in the breadcrumb and the side bar — so the General page says `General`. Five pages titled `Settings` made the tab strip useless.
- **`ui.formRow` gives the description the width.** The label and its sentence take the flexible column and the control sits at the end of the row, where every other control on the page sits (`minmax(0, 1fr) 240px`). The old `220px 1fr` put the *explanation* in the narrow column and wrapped every sentence at 180px.
- **A row can carry a tag** — `Workspace` when a workspace may override the value, `Restart` when the change waits for one. A settings page that never says which of those is true is a page the reader has to test.
- **`ui.segmented` shows the value that is set**, where a `<select>` hides it. The shell wires `[data-setting]`: pressing an option moves `aria-pressed` and reports the new value, and because `Theme` is the one setting that changes the window it is set in, pressing it applies the theme instead of only describing it. Checkboxes report `on` / `off` the same way.
- **Modules** groups `Active` and `Reserved` instead of one table plus a card that listed the reserved ones a second time, drops the `temcocontrols.` prefix (the full id wraps mid-word at this width and reads as an error) and ends with `Platform Updates` as a fact strip. The four summary tiles are gone: the group heads already count what they hold.
- **Branding** draws the mark at the three sizes the shell actually draws it (64, 32, 16), and names the five colour roles under their swatches — a row of unlabelled squares is not a preview of anything.
- **AI Models** is grouped by what the setting decides — `Answering`, `Retrieval`, `Drafts and Network` — and says in its head that the AI Hub shows what is loaded now while this page decides what loads next, so the two pages stop looking like copies.
- **Publishing** puts `Test Connection` in the `Target` rule rather than the page head, and computes `4 of 5 published` from the artifact list. Each artifact is a labelled checkbox row, so what a version publishes is readable without counting ticks.

## The device-side pages

Four modules read the building rather than the documentation: **Devices**, **I/O Studio**, **BACnet Studio**, **Network**. Each answers one question and says what it cannot do, and every count on them is derived — the fleet register is `data.devices` (six controllers), the alarm counts come from `data.alarms`, and the host lists from `data.hosts`, so a page cannot claim a fleet the register does not hold.

- **Devices** — the controller that stopped answering gets the panel, the tiles count the register, and the list is two groups: `Needs Attention` and `Answering`. A row is a controller (`T3-BB · AHU-1`), its serial, address, firmware, point count and last contact, with the alarm count read from that device's own alarm rows.
- **Firmware** — releases, then `Behind`: the controllers on something other than the current version, with the distance (`2.12.1 → 2.14.3`) written on the row. Staging is a write; the callout says a preview image is refused on a production controller.
- **Health & Alarms** — grouped by state (`Active`, `Acknowledged`, `Cleared Today`), because acknowledging is not clearing and the three are different things to do next.
- **Schedules / Trend Logs / Backups** — a register each; the trend row carries its buffer as a bar (a buffer over 85 % is a log nobody has read), and a backup that has no younger copy says so instead of offering a restore.
- **I/O Studio** — `Point Browser` groups points by type; a write is a `settings-rows` form at a priority, not a local override. `Mapping` counts mapped / needs-review / unmapped from the mapping rows. `Logic` is source, programs, diagnostics, in that order. `Live Values` is a subscription and says so.
- **BACnet Studio** — `Discovery` is the wire (instance, IP, MAC, vendor, protocol), `Object Browser` is one device's objects with the faulting one called out, `Alarms` is the event log *as received*, `Trend Logs` and `Schedules` are the device's own objects.
- **Network** — `Discovery` (ARP-level hosts, third-party vendors marked), `Modbus Scanner` (registers with the unit that times out), `Diagnostics` (ping output plus a per-host table, because a host that answers ping but not BACnet is a different problem), `Captures` (a capture keeps the filter that produced it).

## SQL Studio

SQL Studio is pointed at the documentation registry — that is the database this window is about — so it is laid out around it rather than as a general SQL client:

- **Workbench** — `Query Editor`, `Connections`, `History`.
- **Docs Database** — `Schema`, `Saved Queries`, `Reports`.

The Query Editor opens with *Stale pages by area*, and its result is computed from `data.knowledge`, so the studio and the Coverage page cannot disagree: 8 rows, 89 stale pages, the same total the dashboard quotes. `History` keeps the refused statement too — a `UPDATE` the read-only connection would not run is part of the record. `Schema` lists the nine tables of `temco_docs` and the columns of `pages`, which is the table everything else joins to. `Saved Queries` are the checks the build runs, written out; `Reports` point at the page that owns each number instead of restating it.

## The modules and their surfaces

| Module | Surfaces in the mock |
|---|---|
| **Dashboard** | Overview · Recent Activity · Coverage & Health · Needs Review |
| **Workspaces** | All Workspaces · T3000 · Templates |
| **Documentation** | Projects · Repositories · Sources · Knowledge · Review Center · Build Center · Releases · How To Use |
| **AI Hub** | Chat · Actions · Citations · Local Models · Knowledge Base |
| **Temco Learn** | Home · T3000 · Article Preview · Downloads · Learning Paths |
| **Devices** | Devices · Firmware · Health & Alarms · Schedules · Trend Logs · Backups |
| **I/O Studio** | Point Browser · Mapping · Logic · Live Values · Trends |
| **BACnet Studio** | Discovery · Object Browser · Alarms · Trend Logs · Schedules |
| **Network** | Discovery · Modbus Scanner · Diagnostics · Captures |
| **SQL Studio** | Query Editor · Connections · Reports |
| **Settings** | General · Modules · Branding · AI Models · Publishing |

The order is the order of the activity bar, and it is the product's order of attention: the documentation pipeline first (Documentation, the AI that drafts into it, and the site it publishes to), then the device modules (Devices, I/O, BACnet, Network), then SQL Studio, with Settings at the bottom. Nothing is hidden — a module moving later is a statement about what is being built now, not about whether it ships.

The reserved modules (`temco-device-manager`, `temco-bacnet`, `temco-nettools`, `temco-sql`) appear as full modules here on purpose: the point of the mock is to decide the shape **before** a module becomes active. **Settings › Modules** is where the mock says which of them the build actually ships.

**Repositories** is the cloned half of Sources, and has its own two surfaces: a register with clone state, branch and pages found, and a detail page with the branches, the reads recorded against their commits, and the repository's own documentation scripts. It is where a read is audited.

## Modules, not a marketplace

There is no Store and no Install button, because there is nothing to install. `temco-store` is not a shop — it is the platform's own SQLite memory (the catalog, the selection, the naming rules), with no view of its own. Every other extension is a **module**: it ships with the platform, activates with it and cannot be removed. The build also refuses a `product.json` that configures an extension gallery, so a community marketplace is not reachable from this window at all.

So the mock keeps one honest surface, **Settings › Modules**: the seven active modules with their ids, namespaces and the surfaces they open; the four reserved ones marked as such; and platform updates, because a module updates with the platform and never on its own. If Temco later ships optional add-ons outside the platform's release cadence, that is a new surface — curated, Temco-only — not a marketplace.

## What moves

| Action | How |
|---|---|
| Change module | click the activity bar, or `Go` in the title bar |
| Change surface | click the side bar; each surface is a tab and a deep link (`#/docs/review`) |
| Everything else | `Ctrl+P` quick open · `Ctrl+Shift+P` command palette |
| Layout | `Ctrl+B` side bar · `Ctrl+J` panel · `Ctrl+Alt+B` AI bar |
| Theme | the palette icon in the title bar, or **Settings › Branding** |
| Ask the AI | the composer in the AI bar; answers cite what they read |
| Start a flow | `File › New Project…`, or any **New** / **Add** / **Publish** / **Stage** button on a surface |

State — theme, open tabs, which panel, which bars are visible — is kept in `localStorage`, so a reload returns to the same window. Below 780 px the mock hides the columns that no longer fit rather than squeezing the editor to nothing.

## Flows

A flow is a surface that asks for something in steps: the same tab, the same breadcrumbs, the same deep link (`#/flow/new-project`), with numbered step names as a section header — `1. Basics → 2. Sources → 3. Outputs → 4. Review` — and **Back** / **Next** in a second section at the bottom. A step can be clicked to jump to it; what was typed is read back before the step changes, so nothing is lost. There is no card around the flow: the two hairlines are the sections.

Sources are grouped **by repository** and **by file or folder**, because the two are read differently — one is cloned with history, the other is opened where it lies. The repository group has a **search** that filters the rows in place and **Load all**; the file group is a **Choose files and folders…** disclosure, so a long list of files does not bury the repositories.

| Flow | Steps | Finish does |
|---|---|---|
| **New Project** | Basics · Sources · Outputs · Review | adds a draft and opens Documentation › Projects |
| **Add Source** | Kind · Location · Read | adds the source and opens Documentation › Sources |
| **Publish Release** | Preflight · Version · Publish | marks 13.0 published and opens Documentation › Releases |
| **Stage Firmware** | Devices · Image · Confirm | announces the staged image and opens Devices › Firmware |
| **New Page** | Location · Template · Draft | creates the draft and opens Documentation › Knowledge |
| **New Workspace** | Name · Modules | adds the workspace and opens Workspaces |
| **Open Workspace** | a picker, not a wizard | opens the workspace the window would switch to |

A flow is reachable from the place that needs it — `File › New Project…`, the **New Project** button in a page head, `Tools › Documentation › Publish Release…`, **Stage Firmware** on the Devices page — and no flow appears in the side bar, because a flow is an action, not a place.

**Nothing is written until Finish.** Cancel drops the state and returns to the tab you came from. The engine is `js/views.flow.js`: a flow is a definition with `steps`, `defaults`, `validate` and `apply`, and `apply` returns what to open and what to announce. Adding a seventh flow is one object in `defs` — no shell change.

Buttons that would write something are **announcements**, not actions: they toast what the real surface would do. The exception is anything that only moves the window, which really moves.

## Adding a surface

1. Add a view to a module in `js/data.js` — `{ id, label, icon, badge, tone }`.
2. Register it in one of `js/views.*.js`:

```js
M.views['docs/releases'] = {
	title: 'Releases',
	render: function () {
		return M.ui.view(
			M.ui.pageHead({ title: 'Releases', icon: 'upload', desc: '…' }) +
			M.ui.table({ columns: [/* … */], rows: M.data.releases })
		);
	}
};
```

3. Build it from `M.ui` (`pageHead`, `card`, `kpis`, `table`, `list`, `bar`, `callout`, `tiles`), never from new CSS unless the pattern is genuinely new.
4. Any behaviour is a `data-` attribute — `data-open`, `data-action`, `data-prompt`, `data-toast` — handled in one place in `js/shell.js`. A view never adds a listener.
5. Icons are `<use href="#i-name">` against the sprite in `index.html`; add a symbol there rather than an image file.

## The Studio mock (real Fluent UI)

A separate, single-file prototype: `studio.html`.

**Status: design reference, not the product.** The documentation editor this prototype was written to prove now
ships in the extension — `extensions/temco-docs`, the *Temco Markdown* surface — and that is the thing to change,
run and trust. `studio.html` stays because it is still the fastest place to argue about a layout: it needs no build,
no extension host and no reload. Do not port from it by copying; read it for the decision, then make the change in
`webview/docs/`. What it shows beyond the shipped surface (convert, publish queue, history restore, the revision
graph) is drawn for a module that does not exist yet, and belongs to the design in
[`../temco-platform/platform-design.md`](../temco-platform/platform-design.md).

It is **not** built from `M.views` — it is a small React 19 app that imports the real `@fluentui/react-components` through an import map, and it *does* things rather than drawing them: editing creates revisions, convert really makes a derived asset, publish really queues jobs that advance, history really restores.

Open it directly, or `python -m http.server` from this folder and go to `/studio.html`. It needs network access for the Fluent modules (esm.sh); with no network it renders an explanation rather than a broken shell.

Why one file: this repository forbids new `.js` files unless they are added to `.eslint-allowed-javascript-files`, so the prototype keeps its module inline in the HTML.

The shipped surface differs from this prototype in two ways worth knowing before reading either: it is a **custom text
editor** (the file stays the document, so `Ctrl+Z`, the dirty dot and *Diff* are VS Code's own), and it is styled from
`--vscode-*` variables rather than a fixed Fluent theme, so it follows the window's theme instead of overriding it.

## The questions this site exists to answer

- **One editor column, or several?** `temco-ui` decides that a surface of ours opens in one group and never splits. I/O Studio and Device Manager are the surfaces that will argue with that rule.
- **Where the AI bar lives.** A container contributed to the panel can be docked on the right, but a fresh profile needs one drag; a webview beside the page is a tab instead of a dock. The mock draws it docked.
- **Learn inside the window, or only a preview?** The mock treats it as both: a module that previews the site with the shipped template, so the layout is decided once.
- **The dashboard's place.** `ui/app-layout.md` puts the organisation-wide dashboard on the site at `/_admin/`, and the extension is the hand-off target. The mock keeps a dashboard in the window **and** a needs queue beside it; which of the two is the product is still open.
- **Whether anything is ever optional.** Today every module ships with the platform and none can be removed. If an add-on catalogue ever exists, it is a surface of its own with a publisher, a signature and a rollback — not a tab added to Settings.
