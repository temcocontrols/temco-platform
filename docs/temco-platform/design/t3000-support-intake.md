# Support intake from T3000

A support request, a bug report and a feature request all start on the T3000 screen where the problem is, and all three should end as one GitHub issue. This document answers the question it was written for first — **an EXE, or Temco Platform itself?** — then draws every surface that decision implies, in the order a person meets them.

The answer is neither. T3000 already ships a browser, a message bridge and a local web bundle; the report window is a page in that bundle, and Temco Platform is where the staff work the queue. Neither program is installed inside the other.

---

## 1. The question

> "What should go inside T3000 — a separate EXE, or Temco Platform? Temco Platform is too large."

Three candidates, one row each. The measurements are §2; the reasoning is §3.

| Candidate | Installed on every customer PC | Added weight | Verdict |
|---|---|---|---|
| **A — a second EXE** | yes: a new program, a new installer entry, a new updater | a second MFC/WebView2 shell, or a second Electron app | **rejected** — it has to solve the same three problems from outside the process, and every one of them is solved inside it already |
| **B — Temco Platform itself** | yes: hundreds of megabytes, per customer | **~20× the whole T3000 install** | **rejected** — the platform is a staff tool, and a customer PC is not where staff work |
| **C — a page in T3000's existing webview** | already there | **tens of kilobytes of HTML, CSS and script** | **chosen** |

Candidate C is the only one that adds a *surface* without adding a *program*.

---

## 2. The measurements

| Thing | Measured | What it means |
|---|---|---|
| T3000 installer disk image | 35 MB (`T3000.exe` alone is 28–35 MB) | the entire product a customer receives today |
| T3000's web bundle, `T3000/ResourceFile/webview/www` | 33.2 MB in 408 files | already installed, already updated with T3000, already hosting a Documentation page |
| WebView2 runtime | the machine's own Edge WebView2 | T3000 requires it today; a page adds **no new runtime** |
| Temco Platform — Electron runtime, `.build/electron` | 361 MB | the browser, on every machine, forever |
| Temco Platform — compiled workbench, `out` | 294 MB | VS Code's workbench, compiled |
| Temco Platform — first-party modules | ~130 MB | `temco-ai` 109 MB (models), `temco-docs` 15 MB (the DocFX engine), everything else under 3 MB |
| Temco Platform — the shell's own code, `src/temco` | **43 KB in 10 files** | the part that is actually *ours* in the shell |

Two conclusions follow, and they pull in opposite directions:

1. **Candidate B is not a size problem, it is a population problem.** 650 MB is a fair price for the machine that triages issues and writes documentation. It is not a fair price for a boiler-room PC in a plant that runs T3000 to read one controller.
2. **Candidate C costs almost nothing,** because the 33 MB it joins is already paid for. The page is tens of kilobytes; the capture it produces is a few hundred kilobytes, capped in §10.

---

## 3. The decision

| Criterion | A — a second EXE | B — the platform | C — a page in the webview |
|---|---|---|---|
| can see the T3000 window | only by asking Windows for a screenshot of someone else's window | same | **it is the window** |
| knows what is on screen | no — it would have to guess, or T3000 would have to tell it anyway | no | **the host answers in one message** |
| needs a new installer | yes | yes | **no** |
| needs a new update path | yes | yes | **no** — T3000's own updater ships the bundle |
| share of the download | +100 % or more | +1,800 % | **+0.1 %** |
| works offline | depends on what it is built from | no | **yes** — local files served on `localhost:9103` |
| languages | a new translation project | VS Code's, plus ours | **the web bundle's existing i18n** |
| failure mode | a second thing to crash, next to the thing being reported | a 650 MB thing to crash, next to the thing being reported | a page that fails to load, and the form still opens in a browser |

### Why not a second EXE

1. **It cannot see what it is reporting.** A separate process photographs a window it does not own, cannot know which panel the user means, cannot reach T3000's log paths or its in-memory device list. Every one of those facts becomes something T3000 must hand it anyway — over IPC, a pipe, a temp file or a protocol — which is the same work, in a harder place.
2. **It doubles the installer and the updater** for a feature used a handful of times per installation.
3. **It would ship WebView2 or Electron again** — or become an MFC dialog, which is the one thing this design is trying to avoid: a report window that looks like 1998 next to a report window that looks like the product.
4. **It becomes a second program for support to debug.** The commonest support request is "the reporting tool does not open".
5. **It can disagree with T3000 about which build is running.** The evidence is in the process that is running.

### Why not Temco Platform

1. **The population is wrong.** Triage happens on staff machines — a dozen, maybe a hundred, where a 650 MB install is free. T3000 ships to thousands of plant rooms where it is not.
2. **The update cadence is wrong.** The platform changes daily; T3000 ships on a release rhythm and customers update deliberately. Embedding one inside the other couples the two.
3. **The dependency is wrong.** A customer's report must not require an Electron upgrade to file.
4. **The trust boundary is wrong.** The platform holds credentials and models. A customer machine should hold neither.

### What "the platform is the triage surface" means

```text
customer PC                                  staff PC
┌────────────────────────────┐               ┌────────────────────────────┐
│ T3000                      │               │ Temco Platform             │
│  the screen being reported │               │  the queue, the AI, the    │
│  + the Support page        │               │  draft, the forum approval │
│  (page in the webview)     │               │                            │
└──────────┬─────────────────┘               └──────────▲─────────────────┘
           │  one issue, or one prefilled form           │
           └──────────────► GitHub issues ───────────────┘
```

The two programs never have to be installed together, and the seam between them is GitHub.

---

## 4. Does Temco Platform need a redesign?

Not for this feature. The document is worth stating plainly, because "it is too large, redesign it" is a much bigger decision than this one, and it should not be smuggled in on the back of a bug-report button.

| The worry | The honest answer |
|---|---|
| "650 MB is too large to put on a customer PC" | correct — so do not put it there (§3) |
| "the platform is too large to be a support tool" | it is not the support tool; it is the tool the support queue is worked in |
| "the shell's own code is large" | it is **43 KB in 10 files**; the size is VS Code's workbench, Electron, the models and the DocFX engine |
| "can we make the platform smaller?" | the AI models (109 MB) and DocFX (15 MB) are the only large first-party parts; both are already optional in principle, and neither changes this design |
| "should the customer get a small version of the platform?" | **that is candidate C** — a page, not a program |

The one consequence that *is* real: the Support page must look like the product without shipping the product. That means it uses the platform's own visual vocabulary — the same tokens, the same control tiers, the same spacing — in CSS (§7), and nothing else from the platform.

---

## 5. What is true today

| Piece | Where | Today |
|---|---|---|
| the T3000 screen | `T3000` (C++/MFC) | the window the customer is looking at; the thing worth capturing |
| an embedded browser | `T3000/BacnetWebView.cpp` | WebView2 host, loading `http://localhost:9103/#/t3000/` |
| the page bundle it loads | `T3000/ResourceFile/webview/www` | 33.2 MB, 408 files; already ships a Documentation page |
| JavaScript → C++ | `ProcessWebviewMsg` (`BacnetWebView.cpp`) | one string channel, dispatched by hand — the bridge a report page needs already exists |
| the Help entry | `MainFrm.cpp`, `ShellExecute` of the help URL | opens the site in the default browser |
| Temco Platform's protocol | `product.json` → `urlProtocol: "temco-platform"` | registered at launch (`src/vs/platform/url/electron-main/electronUrlListener.ts`); the main process routes `temco-platform://…` into the workbench (`app.ts`, `handleProtocolUrl`) |
| Temco Platform's issue page | Help ▸ Report an Issue (`src/temco/menus/temco.menus.ts` → `workbench.action.openIssueReporter`) | VS Code's reporter, which reads `reportIssueUrl` |
| where issues land | `product.json` → `reportIssueUrl` | `https://github.com/temcocontrols/temco-platform/issues/new` |
| the site's feedback | [09 — Feedback, subscriptions and notifications](../../temco-learn/design/09-feedback-subscriptions-notifications.md) | a prefilled issue with the `docs-feedback` label |

Nothing above is replaced. Three pieces are added — a page, a message family, and a route — and the page is the only one a customer ever sees.

---

## 6. The shape

```text
  T3000 window  (the thing being reported)
        │  Help ▸ Help & Learn · Report an Issue
        ▼
 ┌──────────────────────────────────────────────────────────────┐
 │ Support — a page in T3000's existing webview                 │
 │  Report a problem  ·  Help & Learn                           │
 └───────────────┬──────────────────────────────────────────────┘
                 │  support:*  (the existing ProcessWebviewMsg channel)
                 ▼
 ┌──────────────────────────────────────────────────────────────┐
 │ T3000 host — C++, one module                                 │
 │  capture · context · logs · outbox · hand off                │
 └───────────────┬──────────────────────────────────────────────┘
                 │  temco-platform://support/new?bundle=…  (staff)
                 │  reportIssueUrl + clipboard             (customer)
                 ▼
 ┌──────────────────────────────────────────────────────────────┐
 │ Temco Platform — the queue, the AI, the draft                │
 └───────────────┬──────────────────────────────────────────────┘
                 │  submit
                 ▼
        GitHub issue  ──▶  bot triage  ──▶  (approved) forum topic
```

---

## 7. The window

One window, two destinations, four steps inside the report. It is a page, so it has no title bar of its own — T3000 hosts it — but it draws its own header, rail, content and footer.

| Region | Size | What it is |
|---|---|---|
| **Header** | 56 px | the title, the sentence under it, and the window controls T3000 draws |
| **Rail** | 176 px | the two destinations; inside a report, the four steps and their tick marks |
| **Content** | flexible | one question per screen |
| **Footer** | 44 px | what will happen next, and the two buttons that move |

Behavior rules the layouts assume:

- **The screen is captured when the window opens, not when it is sent.** The bug is usually gone by the time the form is filled. The host captures on the menu click, before the page loads, and the page shows the thumbnail it was given — with **Retake** for the state that is still there.
- **Nothing is transmitted until the person presses Send.** No telemetry, no prefetch, no upload on keystroke.
- **Esc closes; Tab follows the reading order; Ctrl+Enter sends on the review step.** The send button is never the default focus.
- **Every control has a label, and every image has alt text** — the capture's alt text is the report's own title.
- **The window follows T3000's theme** (light, dark, or system) and its language, using the web bundle's existing i18n rather than a new translation project.
- **The visual vocabulary is the platform's** — the same corner radii, spacing and control tiers as the mock — expressed in the bundle's own CSS variables, with no reference to the platform at runtime.
- **Widths are the page's, not the window's.** T3000 may host it at 760 px on a 1366 × 768 plant PC and at 1200 px on a desk; nothing is laid out in a fixed pixel row.

---

## 8. Layouts

Every surface, in the order a person meets them.

| | Surface | When it is seen |
|---|---|---|
| 8.1 | the T3000 Help menu | every session |
| 8.2 | the Support window at rest | first click |
| 8.3 | the kind of report | always |
| 8.4 | what happened | after the kind |
| 8.5 | the capture and its tools | after what happened |
| 8.6 | what goes with it | after the capture |
| 8.7 | review one attachment | before the send |
| 8.8 | the report, exactly | before the send |
| 8.9 | sent | after the send |
| 8.10 | the outbox | offline, or a failed send |
| 8.11 | the crash report | the next start after a crash |
| 8.12 | Help & Learn — search | the other destination |
| 8.13 | Help & Learn — a topic | after a result |
| 8.14 | Help & Learn — online, offline, stale | depending on the connection |
| 8.15 | the browser fallback | no platform, no protocol |
| 8.16 | the window at 760 px | a small plant PC |

### 8.1 The T3000 Help menu

Two entries, and they are the only new ones. `Help & Learn` replaces the bare `Help` link that opens a browser today; `Report an Issue…` is new. The ellipsis is honest: it opens something rather than doing something.

```text
Help
├─ Welcome
├─ Help & Learn                    F1
├─ Documentation
├─ Keyboard Shortcuts
├─ ─────────────────────────────
├─ Show Logs
├─ Report an Issue…
└─ About T3000
```

### 8.2 The window at rest

The first screen asks one question and shows the evidence it already has. It is the only screen reachable with nothing typed.

```text
┌──────────────┬─────────────────────────────────────────────────────────────┐
│ * Report     │  WHAT KIND OF REPORT?                                       │
├──────────────┼─────────────────────────────────────────────────────────────┤
│   Help &     │   (o) Something is broken                                   │
│   Learn      │       it crashed, a value is wrong, a button did nothing    │
│              │   ──────────────────────────────────────────────────────    │
│              │   ( ) Something is missing or unclear                       │
│              │   ──────────────────────────────────────────────────────    │
│              │   ( ) An idea for a feature                                 │
│              │                                                             │
│              │  CAPTURED WHEN YOU OPENED THIS WINDOW                       │
│              │   Devices > Trendlogs - 12 rows - T3-1027                   │
│              │   [ thumbnail ]   [ Retake ]   [ Hide this ]                │
├────────────────────────────────────────────────────────────────────────────┤
│  Nothing is sent until you press Send.                       [ Continue ]  │
└──────────────┴─────────────────────────────────────────────────────────────┘
```

### 8.3 A kind is chosen, and the rail appears

The kind decides the labels and the wording of two questions; it does not add a second form. Choosing *An idea for a feature* drops "What you expected" for "What would help", and labels the issue `feature-request`.

```text
┌──────────────┬─────────────────────────────────────────────────────────────┐
│ * Report     │  Something is broken                                        │
│   1  What    │  BUG - the report is labelled bug and source:t3000          │
│   2  Screen  │  ────────────────────────────────────────────────────────   │
│   3  Details │  A crash, a wrong value, a control that does nothing and    │
│   4  Review  │  should. Anything you can see go wrong on this screen.      │
│              │                                                             │
│              │  [ Start ]                                        [ Back ]  │
└──────────────┴─────────────────────────────────────────────────────────────┘
```

### 8.4 What happened

Three fields, and two that stay folded until they are needed. The title is what the issue will be called, so it is asked first and in the shape of a sentence.

```text
┌──────────────┬─────────────────────────────────────────────────────────────┐
│   1  What    │  TITLE                                                      │
│   2  Screen  │  [ Trendlog graph is empty after I picked 6 points      ]   │
│   3  Details │                                                             │
│   4  Review  │  WHAT HAPPENED                                              │
│              │  [ I opened Trendlogs, ticked six points and pressed    ]   │
│              │  [ Graph. The chart area stays blank, the table below   ]   │
│              │  [ fills in normally.                                   ]   │
│              │                                                             │
│              │  WHAT YOU EXPECTED                                          │
│              │  [ a line per point                                     ]   │
│              │                                                             │
│              │  + Steps to reproduce                                       │
│              │  + What I was doing before                                  │
├────────────────────────────────────────────────────────────────────────────┤
│  Kept in this window as you type.                            [ Continue ]  │
└──────────────┴─────────────────────────────────────────────────────────────┘
```

### 8.5 The capture and its tools

The one screen that needs care. A screenshot of a control system contains site names, IP addresses and point names; the tools are there so a person can take those out **before** the file becomes shareable.

```text
┌──────────────┬─────────────────────────────────────────────────────────────┐
│   1  What    │  SCREENSHOT                                                 │
│   2  Screen  │  ────────────────────────────────────────────────────────   │
│   3  Details │   DEVICES > T3-1027 > TRENDLOGS                             │
│   4  Review  │                                                             │
│              │            graph area is blank                              │
│              │            the region you drag stays inside                 │
│              │                                                             │
│              │  ────────────────────────────────────────────────────────   │
│              │  TOOLS                                                      │
│              │   [ ] crop    -> arrow    [#] box    [~] mark               │
│              │   [x] redact    <- undo                                     │
│              │                                                             │
│              │   Whole window v    1600 x 900    412 KB     [ Reset ]      │
├────────────────────────────────────────────────────────────────────────────┤
│  A redacted area is erased from the file, not covered.           [ Next ]  │
└──────────────┴─────────────────────────────────────────────────────────────┘
```

| Tool | Key | What it does | Why it is there |
|---|---|---|---|
| crop | `[ ]` | keeps one rectangle | the useful part is rarely the whole screen |
| arrow | `->` | draws one arrow | points at the value that is wrong |
| box | `[#]` | outlines a region | says "here", without covering it |
| mark | `[~]` | tints a region transparently | nothing is hidden |
| redact | `[x]` | **erases** the pixels, then flattens | a blurred box is not redaction; a reliable one is |
| undo | `<-` | back one step | redaction is irreversible in the file, so it must be reversible on screen |

The host captures at three sizes — `whole`, `client`, `screen` — because the fault is sometimes in a panel around the page rather than in the page.

### 8.6 What goes with it

The list is explicit, ticked or not, and it ends with what is **never** included. That last block is why a customer trusts the Send button.

```text
┌──────────────┬─────────────────────────────────────────────────────────────┐
│   3  Details │  WHAT GOES WITH IT                     2 of 5  [Review]     │
│   4  Review  │   [x]  the T3000 version and build   2026.0912 - 35.2 MB    │
│              │   [x]  the screen you were on        Devices > Trendlogs    │
│              │   [x]  the panels on screen          T3-1027 fw 4.2.1       │
│              │   [x]  today's log, last 200 lines   18 KB                  │
│              │   [ ]  this installation's settings  1.2 KB - names sites   │
│              │  ────────────────────────────────────────────────────────   │
│              │   NEVER INCLUDED                                            │
│              │   x  your database and your points' values                  │
│              │   x  your passwords, licence key or serial numbers          │
│              │   x  anything from another window                           │
├────────────────────────────────────────────────────────────────────────────┤
│  [ Review what will be sent ]                                [ Continue ]  │
└──────────────┴─────────────────────────────────────────────────────────────┘
```

`Review` opens the same text the issue will carry, so a person can read a log excerpt before it leaves the machine. A tick-box that cannot be reviewed is a tick-box nobody should trust.

### 8.7 Reviewing one attachment

The panel behind `Review`. It shows the exact lines that will be published, the lines that were dropped, and the button that removes the part entirely.

```text
┌────────────────────────────────────────────────────────────────────────────┐
│  WHAT WILL BE SENT                                              [ Close ]  │
│  t3000-2026-11-12.log - last 200 lines - 18 KB                             │
├────────────────────────────────────────────────────────────────────────────┤
│   09:11:42 [trendlog] read 6 points panel 1                                │
│   09:11:42 [trendlog] range 09:00-09:10 panel 09:12 pc 09:11               │
│   09:11:43 [trendlog] rows 0  -> chart skipped                             │
│   09:11:43 [trendlog] panel clock 09:12:24  pc clock 09:11:43              │
│   ... 196 more lines                                                       │
├────────────────────────────────────────────────────────────────────────────┤
│  i 3 lines before these were dropped: they named other panels.             │
├────────────────────────────────────────────────────────────────────────────┤
│  [ Remove this attachment ]                                   [ Keep it ]  │
└────────────────────────────────────────────────────────────────────────────┘
```

### 8.8 The report, exactly

The last screen before the send is the issue itself. Not a summary of it — the record, in the shape it will be published, with its labels and its attachments.

```text
┌──────────────┬─────────────────────────────────────────────────────────────┐
│   4  Review  │  THIS IS THE REPORT                             [ Copy ]    │
│              │  ────────────────────────────────────────────────────────   │
│              │  Title     Trendlog graph is empty after I picked six ...   │
│              │  Labels    support - bug - source:t3000 - area:trendlogs    │
│              │                                                             │
│              │  WHAT HAPPENED                                              │
│              │  I opened Trendlogs, ticked six points and pressed ...      │
│              │                                                             │
│              │  ENVIRONMENT                                                │
│              │  T3000 2026.0912 - Windows 11 26100                         │
│              │  panel T3-1027 firmware 4.2.1                               │
│              │                                                             │
│              │  ATTACHMENTS                                                │
│              │  trendlogs-empty.png    412 KB    1600 x 900                │
│              │  t3000-2026-11-12.log    18 KB                              │
├────────────────────────────────────────────────────────────────────────────┤
│  Your screenshot goes to the clipboard, so you can paste it into           │
│  the issue.                                                      [ Send ]  │
└──────────────┴─────────────────────────────────────────────────────────────┘
```

### 8.9 Sent

A receipt that says what happens next, because "your report has been submitted" is the sentence that teaches people not to bother.

```text
┌──────────────┬─────────────────────────────────────────────────────────────┐
│              │  ok  Sent as issue #4821                                    │
│              │  ────────────────────────────────────────────────────────   │
│              │  github.com/temcocontrols/temco-platform/issues/4821        │
│              │                                            [ Open ]         │
│              │                                                             │
│              │  WHAT HAPPENS NEXT                                          │
│              │   1   a bot reads it, and links anything it has seen before │
│              │   2   a person answers in the issue                         │
│              │   3   if the answer belongs in the help, the page is        │
│              │       corrected and the fix is named in the issue           │
├────────────────────────────────────────────────────────────────────────────┤
│  [ Copy the link ]   [ Start another report ]                   [ Close ]  │
└──────────────┴─────────────────────────────────────────────────────────────┘
```

### 8.10 The outbox

T3000 runs in plant rooms with no route to the internet, so a report has to survive being written offline. It is a file in the installation's data folder, not a hidden queue: it is listed, and it can be opened, sent or deleted.

```text
┌──────────────┬─────────────────────────────────────────────────────────────┐
│              │  i  No connection. Help comes from the copy installed with  │
│              │     T3000. Your report waits here and leaves when you are   │
│              │     online again.                                           │
│              │                                                             │
│              │  OUTBOX                                         1 waiting   │
│              │  ────────────────────────────────────────────────────────   │
│              │  Trendlog graph is empty after I picked 6 points            │
│              │  12 Nov 09:12 - 2 attachments - not sent                    │
│              │                          [ Open ]   [ Send now ]   [Delete] │
└──────────────┴─────────────────────────────────────────────────────────────┘
```

A failed send is the same screen with the reason above the row — `the issue form did not open`, `the clipboard is unavailable` — never a modal that replaces the report with an apology.

### 8.11 The crash report

The commonest bug report is the one that has no window to report from. T3000 writes a marker before it dies; the next start finds it and offers the report, with the log already in hand.

```text
┌────────────────────────────────────────────────────────────────────────────┐
│  T3000 closed unexpectedly last time.                                      │
│                                                                            │
│   Wed 12 Nov, 09:11      Devices > Trendlogs                               │
│   Exception 0xC0000005 in trendlog::BuildSeries                            │
│   The log and a screen capture request are ready.                          │
├────────────────────────────────────────────────────────────────────────────┤
│  [ Send a report ]   [ Not now ]   [ Do not ask again for this fault ]     │
└────────────────────────────────────────────────────────────────────────────┘
```

| Detail | Why it is like that |
|---|---|
| one prompt, on the next start | a crash dialog at crash time can crash too, and cannot be typed into |
| the fault is fingerprinted | `Do not ask again` is per-fault, not global — a second, different crash still asks |
| the screenshot is offered, not taken | the screen that crashed is gone; the report asks for a *current* screen and says so |
| the window is not the full report | it is a prompt. `Send a report` opens the Support window at §8.5, with the log already ticked |

### 8.12 Help & Learn — search

The other destination. It searches an **offline copy** of the help that ships in the bundle, so it answers in a plant room, and it offers the website when there is a connection.

```text
┌──────────────┬─────────────────────────────────────────────────────────────┐
│ * Help &     │  [ trendlog graph                                ] [ Go ]   │
│   Learn      │  12 results - offline copy 2026.11   [ Try the website ]    │
│              │  ────────────────────────────────────────────────────────   │
│              │  Trendlogs > Graph                                          │
│              │  Pick the points, then press Graph. The horizontal ...      │
│              │  ────────────────────────────────────────────────────────   │
│              │  Trendlogs > An empty graph                                 │
│              │  If the chart is empty the panel clock and the trend ...    │
├──────────────┴─────────────────────────────────────────────────────────────┤
│  Nothing answered it?               [ Report a problem with this search ]  │
└──────────────┴─────────────────────────────────────────────────────────────┘
```

### 8.13 Help & Learn — a topic

The same page the site serves, rendered from the offline copy, with the two buttons that turn a failed lookup into a report — carrying the page's own id, so the issue names the page that failed.

```text
┌────────────────────────────────────────────────────────────────────────────┐
│  Trendlogs > Graph                                   offline copy 2026.11  │
├────────────────────────────────────────────────────────────────────────────┤
│  Pick the points you want, then press Graph.                               │
│                                                                            │
│  The horizontal axis follows the interval the point is logged at;          │
│  the vertical axis is the engineering range of the point.                  │
│                                                                            │
│   Point    Interval    Value                                               │
│   IN-1     1 min       21.4 C                                              │
│   IN-2     1 min        0.0 %                                              │
├────────────────────────────────────────────────────────────────────────────┤
│  Was this helpful?   [ Yes ]   [ No ]   [ Report a problem ]               │
└────────────────────────────────────────────────────────────────────────────┘
```

### 8.14 Help & Learn — online, offline, stale

| State | What the page says | What is different |
|---|---|---|
| online | the offline copy, plus `[ Open the full site ]` | the site opens in the browser, as it does today |
| offline | `offline copy 2026.11` in the header, and no site link | nothing else changes; the copy is the same tree the site is built from |
| copy older than the app | a one-line note naming both versions | tells the reader which one to trust |
| no copy installed | search is replaced by the site link and the Report button | a bundle that shipped without its copy still has a working window |

### 8.15 The browser fallback

The path that must work when nothing else does: no Temco Platform installed, no protocol registered, no theme, no script. The host opens the GitHub form with the title and body filled, and leaves the capture on the clipboard.

```text
┌────────────────────────────────────────────────────────────────────────────┐
│  github.com/temcocontrols/temco-platform/issues/new                        │
├────────────────────────────────────────────────────────────────────────────┤
│  Add a title *                                                             │
│  Trendlog graph is empty after I picked 6 points                           │
│                                                                            │
│  Add a description                                                         │
│  I opened Trendlogs, ticked six points and pressed Graph. ...              │
│                                                                            │
│  Attach files   <-  click here, then press Ctrl+V                          │
│  Labels   support - bug - source:t3000                                     │
├────────────────────────────────────────────────────────────────────────────┤
│  ! Your screenshot is on the clipboard. Click the description,             │
│    then press Ctrl+V.                                                      │
└────────────────────────────────────────────────────────────────────────────┘
```

This is the whole of the first release (§14), and it is why that release needs no server, no token and no account.

### 8.16 The window at 760 px

The rail collapses to icons, the four steps become one line of ticks, and the content keeps its reading order. Nothing is dropped: a line that does not fit wraps rather than disappears.

```text
┌────────────────────────────────────────────────────────────────────────────┐
│  Support > Report a problem                                                │
├────────────────────────────────────────────────────────────────────────────┤
│  * o o o o    1 What  >  2 Screen  >  3 Details  >  4 Review               │
├────────────────────────────────────────────────────────────────────────────┤
│  WHAT GOES WITH IT                                       2 of 5  [Review]  │
│   [x]  the T3000 version and build      2026.0912 - 35.2 MB                │
│   [x]  the screen you were on           Devices > Trendlogs                │
│   [x]  the panels on screen             T3-1027 fw 4.2.1                   │
│   [x]  today's log, last 200 lines      18 KB                              │
│   [ ]  this installation's settings     1.2 KB - may name sites            │
│  ────────────────────────────────────────────────────────────────────────  │
│   NEVER INCLUDED: database and point values, passwords, keys               │
├────────────────────────────────────────────────────────────────────────────┤
│  [ Review what will be sent ]                                [ Continue ]  │
└────────────────────────────────────────────────────────────────────────────┘
```

---

## 9. The platform side

Three surfaces, all in Temco Platform, all for staff. They are ordinary editor tabs, per [the mock's own rule](../../mock/README.md): a surface is a tab, so it keeps the tabs, the panel and the status bar for free.

### 9.1 The support inbox

A bundle that arrives by `temco-platform://support/new` opens as one tab: the record in the editor, the AI's reading of it in the bar, and the reply being drafted in the panel.

```text
┌────────────────────────────────────────────────────────────────────────────┐
│ Temco Platform                    File  Edit  View  Go  Tools  Help        │
├───┬────────────────────────┬──────────────────────────────┬────────────────┤
│   │ SUPPORT > INBOX        │ #4821 Trendlogs  x           │ AI             │
│   │                        │                              │ Triage         │
│   │ * #4821 trendlog graph │ SUPPORT > #4821              │  bug 92 %      │
│   │   #4818 panel offline  │ Trendlog graph is empty ...  │  area          │
│   │   #4814 licence        │ ──────────────────────────   │  trendlogs     │
│   │                        │ WHAT HAPPENED                │                │
│   │ 3 open - 1 urgent      │ I opened Trendlogs, tick...  │ SIMILAR        │
│   │                        │                              │  #3902         │
│   │                        │ ENVIRONMENT                  │  #4106         │
│   │                        │ T3000 2026.0912 - Win 11 ... │                │
│   │                        │                              │ [ Draft a      │
│   │                        │ ATTACHMENTS                  │   reply ]      │
│   │                        │ trendlogs-empty.png  412 KB  │                │
└───┴────────────────────────┴──────────────────────────────┴────────────────┘
```

### 9.2 The issue draft

The bot's output is a file, not a message: a Markdown draft with the reply, the labels it proposes and the page it thinks is wrong. A person edits it and copies it into the issue, so nothing is posted by a machine.

```text
┌────────────────────────────────────────────────────────────────────────────┐
│  #4821 > draft.md               unsaved            [ Copy for the issue ]  │
├────────────────────────────────────────────────────────────────────────────┤
│   1  ## Diagnosis                                                          │
│   2  The panel clock and the PC clock differ by 41 s. Trendlogs are        │
│   3  read with the panel's own timestamps, so a range picked on the        │
│   4  PC falls outside the recorded window and the chart is empty.          │
│   5                                                                        │
│   6  ## What to check                                                      │
│   7  - Trendlogs > Settings > Use PC time, or synchronise the panel.       │
│   8                                                                        │
│   9  ## Documentation                                                      │
│  10  t3000/trendlogs/graph - says nothing about the clock. Proposed        │
│  11  paragraph attached.                                                   │
│  12                                                                        │
│  13  <!-- labels: bug, area:trendlogs, docs-owed -->                       │
└────────────────────────────────────────────────────────────────────────────┘
```

### 9.3 The forum draft

A public post is the one output with our name on it, so it is the one output with an approval step. The draft is shown **as it would appear**, not as a form.

```text
┌────────────────────────────────────────────────────────────────────────────┐
│  FORUM DRAFT                                   from #4821 - not published  │
├────────────────────────────────────────────────────────────────────────────┤
│  Trendlogs: why an empty graph is usually a clock difference               │
│                                                                            │
│  If you tick points, press Graph and get an empty chart while the          │
│  table below fills in, check the panel clock first.                        │
│                                                                            │
│   Category  Trendlogs      Answers 1      Visibility  public               │
├────────────────────────────────────────────────────────────────────────────┤
│  BEFORE PUBLISHING                                                         │
│   [x] the customer's words are gone     [x] no site names, no IPs          │
│   [x] the page it came from is linked   [ ] the reporter was asked         │
├────────────────────────────────────────────────────────────────────────────┤
│  [ Publish to the forum ]   [ Save as draft ]   [ Discard ]                │
└────────────────────────────────────────────────────────────────────────────┘
```

---

## 10. What the C++ side must provide

The contract below is the summary. The engineering companion — [t3000-support-engineering.md](./t3000-support-engineering.md) — carries the stack, the file-level method for each part, the failure modes and the work breakdown.

Eight messages. Each is a request the page sends and the host answers, correlated by an id, because the existing channel is one string in each direction.

```json
{ "message": "support:context", "id": 7 }
```

```json
{ "id": 7, "ok": true, "data": { "version": "2026.0912", "screen": "Devices > Trendlogs" } }
```

| Message | The host answers with | Why it must be C++ |
|---|---|---|
| `support:context` | version, build, Windows version, locale, the active screen's name, the panels on screen with their firmware | only the host knows what the user is looking at |
| `support:capture` | a PNG path, its size and its pixel dimensions; takes `whole`, `client` or `screen` | a page cannot photograph the window that hosts it, nor the panels around it |
| `support:logs` | a path to an excerpt: the last 200 lines of today's log, capped at 256 KB | the files are on disk, behind the process |
| `support:settings` | the settings snapshot, or the reason it was withheld | same |
| `support:clipboard` | whether the PNG was placed on the clipboard | the fallback path (§8.15) depends on it |
| `support:handoff` | opens `temco-platform://support/new?bundle=<path>`; falls back to `reportIssueUrl` | launching is the host's job, not the page's |
| `support:openUrl` | opens a URL in the default browser | the page must not navigate away from itself |
| `support:outbox` | `save`, `list`, `send` and `delete` on the offline queue (§8.10) | the queue outlives the window |

Caps, so that a report never becomes an upload:

| Part | Cap | If exceeded |
|---|---|---|
| the capture | PNG, long edge ≤ 2560 px, ≤ 1.5 MB | the host rescales and re-encodes once, then says so |
| the log excerpt | 256 KB | truncated at the top, with a marker naming what was dropped (§8.7) |
| the settings snapshot | 64 KB | withheld, and the report says it was withheld |
| the bundle | 2 MB zipped | the send button explains what must be unticked |

Two traps that decide whether this works at all:

- **WebView2 does not appear in a plain `BitBlt` capture.** The frame needs `PrintWindow(hwnd, …, PW_RENDERFULLCONTENT)`; without the flag a WebView2 child is black. One capture path serves both.
- **A multi-monitor window needs its own rectangle**, from `GetWindowRect` with `DwmGetWindowAttribute(DWMWA_EXTENDED_FRAME_BOUNDS)`, not the virtual screen — otherwise the capture contains the neighbouring monitor.

There is no new build target. `CMakeLists.txt` gains one source file, and that is the entire build change.

---

## 11. One record, three derived views

| Record | Owner | Rule |
|---|---|---|
| the GitHub issue | Temco Platform's `reportIssueUrl` | **the system of record.** Labels `support` · `bug` or `feature-request` · `source:t3000`, plus the area the bot proposes |
| the docs change | whoever owns the page the issue names | derived from the issue; the registry already resolves an owner |
| the forum topic | Temco Learn's forum | derived, **after a person approves it** (§9.3), because a public post carries our name |

A thread that answers a real question is good content; the same thread written by a bot on day one is not. Approval is the only thing that separates them, and it is one click.

---

## 12. The bot

A workflow in this repository. It writes **into the issue** and nowhere else: no pull requests, no forum posts, no email to the reporter.

| Step | What it does | Where the result appears |
|---|---|---|
| 1 find | searches closed issues and the help site for the same symptom | links, in the issue |
| 2 classify | sets the type and area labels | labels, in the issue |
| 3 ask | names what the report is missing — a log line, a firmware version, the step before the screenshot | one comment, merged with step 4 |
| 4 draft | a reply for a person to send, and a documentation draft when the answer is documentation's job (§9.2) | a comment written for a person to paste |
| 5 propose | when the answer generalises, a forum draft for approval (§9.3) | the platform, not the forum |

---

## 13. The token question

T3000 never holds a credential. Three ways to file, and only the first one is in the first release.

| Way | What it costs | When it is right |
|---|---|---|
| **the prefilled form** — the host opens `reportIssueUrl` with title and body filled, the capture on the clipboard | nothing; the person presses *Submit* | the first release, and the fallback forever |
| **a relay** — T3000 POSTs the bundle to one endpoint that files with a GitHub App installation token | a small service to run, log and rate-limit | when "one click, no GitHub account" is a requirement |
| **the device flow** — the person signs in once, the app keeps their own token | an OAuth app, a token store in the client | never for anonymous reports; only when a customer's own account should be the author |

The first one is also the honest one: the person sees exactly what will be published before it is.

---

## 14. Phases

| Phase | What ships | Layouts | What changes where |
|---|---|---|---|
| **1 — a day's work** | Report an Issue opens the prefilled GitHub form; the capture is on the clipboard | 8.1, 8.15 | T3000: `support:context`, `support:capture`, `support:clipboard`, `support:handoff`. No platform change |
| **2 — the window** | the Support page, the four steps, the outbox, the crash prompt, Help & Learn | 8.2–8.14, 8.16 | T3000: the page and its route, the rest of the message family. Platform: the `temco-platform://support/new` handler |
| **3 — the queue** | the inbox, the draft, the bot, the forum approval | 9.1–9.3 | this repository's workflows, and the forum's intake |

Each phase is useful on its own, and phase 1 is the one that answers "does anyone use it".

---

## 15. What must not be built

1. A second EXE, a second installer or a second updater for support.
2. A token, an app secret or a maintainer's PAT inside the T3000 build.
3. A second issue form with its own fields, drifting from `reportIssueUrl`'s template.
4. Automatic forum posting. Every public post is approved.
5. A capture that is sent before the person has seen it, cropped it, and can remove it.
6. A capture taken on send. By then the screen that showed the fault is gone.
7. A blurred box presented as redaction.

---

## 16. Decisions this document needs from the owner

| # | Question | Default if unanswered |
|---|---|---|
| 1 | anonymous through the prefilled form, or the customer's own GitHub account? | anonymous (§13) |
| 2 | do T3000 reports land here, or in the module they concern? | here, with an area label |
| 3 | who approves a forum draft — the triager, or the docs owner? | the person who answers the issue |
| 4 | is the log excerpt on by default? | yes, with the review panel in front of the send (§8.7) |
| 5 | does the capture default to the whole window or the client area? | the whole window — panels and toolbars are where the fault often is |
| 6 | does a crash prompt appear for every distinct fault, or once? | every distinct fault, fingerprinted (§8.11) |

---

## 17. Where the work goes

| Repository | The change |
|---|---|
| `T3000_Building_Automation_System` | the eight `support:*` messages in `ProcessWebviewMsg`, the capture, the outbox, the crash marker and the handoff; one source file in `CMakeLists.txt` |
| T3000's web UI, `T3000/ResourceFile/webview/www` | the Support page and its route, beside the Documentation page; its CSS variables mirror the platform's tokens |
| `temco-platform` | the `temco-platform://support/new` handler in the shell, the inbox, the draft view and the forum draft (§9) |
| `temco-learn` | the forum's intake: a topic from an approved draft |
| this repository, `.github/workflows` | the triage workflow (§12) |

---

## 18. What the build must satisfy

| # | Requirement |
|---|---|
| 1 | `Help & Learn` and `Report an Issue…` are the only two new menu entries, and both open the one window |
| 2 | the capture is taken when the window opens — never at send — with `Retake` available while the screen is unchanged |
| 3 | no bytes leave the machine before the person presses Send, and the report survives an offline write to the outbox |
| 4 | the review screen is the exact text and the exact attachment list that will be published, and any part can be removed there |
| 5 | nothing is ticked that has not been reviewed, and the *never included* list is the same list the host enforces |
| 6 | a redaction removes the pixels; a blurred box is never called redaction |
| 7 | with no platform, no protocol and no network, the prefilled form still opens and the capture is still on the clipboard |
| 8 | a crash produces a prompt on the next start, fingerprinted per fault, and the prompt is not a second report form |
| 9 | Help & Learn answers with no connection, and names the copy it answered from |
| 10 | the window is usable at 760 px, follows T3000's theme and language, and is keyboard-complete |
| 11 | Temco Platform's inbox opens a bundle as a tab, and the reply is copied by a person rather than posted by a workflow |
| 12 | no forum post exists without an approval, and the approval screen shows the post as it will appear |
| 13 | T3000 holds no credential of any kind |

---

## 19. Technical structure at a glance

The detail is in [t3000-support-engineering.md](./t3000-support-engineering.md); this is the shape it describes.

| Layer | Language and stack, all already in the product | Owns |
|---|---|---|
| T3000 shell | C++14 / MFC / CMake / WebView2 1.0.1150.38 / jsoncpp / GDI+ | capture, context, logs, outbox, handoff, crash marker |
| T3000 web UI | TypeScript / React 18 / Fluent UI v9 / React Router / Vite | the Support page: four steps, annotation, Help & Learn |
| T3000 local service | Rust / axum — HTTP on 9103, WebSocket on 9104 | serves the bundle, as it does today; unchanged |
| Temco Platform | TypeScript / the shell and its `temco-workbench` module | the inbox, the issue draft, the forum draft |
| Automation | GitHub Actions with `GITHUB_TOKEN` only | labels, dedupe, one comment, `docs-owed` |

How each part is achieved, in one line:

| Part | Method |
|---|---|
| capture | `PrintWindow(hwnd, dc, PW_RENDERFULLCONTENT)` into a memory DC, encoded to PNG by GDI+, cropped by `DWMWA_EXTENDED_FRAME_BOUNDS` |
| context | read from the running process: version resource, active view, the device list already in memory |
| logs | seek to the last 512 KB, keep the last 200 lines, convert to UTF-8, cap at 256 KB |
| outbox | one folder per report with a `report.json`, written to `.tmp` and renamed — a rename is atomic |
| handoff | `ShellExecuteEx` of `temco-platform://support/new?bundle=…`; no handler means the prefilled form plus `CF_DIB` on the clipboard |
| crash | `SetUnhandledExceptionFilter` writes a 200-byte fingerprint; dumps are Windows Error Reporting's job |
| the page | one React feature folder and one lazy route, beside the Documentation page |
| annotation | one `<canvas>`; redaction fills the export canvas, so the erased pixels never reach the file |
| the bridge | `{ action, msgId }` in, `{ action: "…_RES", msgId, ok }` out; a promise with a timeout per call |
| the panel | `IURLService.registerHandler` for the protocol, one webview panel, a draft written with a `WorkspaceEdit` |
| the bot | one workflow: label, dedupe by search, one marked comment, a Copilot draft only when enabled |

Three properties fall out of this and are worth stating: **no new dependency in any manifest** except `dwmapi.lib`; **no new runtime** on a customer machine; and **no credential** anywhere in the client.
