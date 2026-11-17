# T3000 Help & Report — technical design

Screenshots, self-check and issue reporting from inside T3000. The page is React in the existing webview app, the logic is Rust in the existing axum API on `:9103`, and the evidence comes from the C++ host over the message bridge that already exists. GitHub stays the record; the user never has to visit it.

## 1. The three parts

| # | Part | Origin | Runs | Who |
|---|---|---|---|---|
| 1 | Documentation | temco-learn | published site, `Help ▸ Documentation (F1)` | clients |
| 2 | Report an Issue | new | React page `/#/report` on `:9103` | clients |
| 3 | Triage | temco-platform | GitHub Actions + the issue | us |

## 2. Architecture

```text
┌────────────────────────── T3000.exe (C++ / MFC) ────────────────────────────┐
│ Help ▸ Documentation (F1)      Help ▸ Report an Issue…                      │
│ runtime ring buffer (200)      capture: PrintWindow → PNG → clipboard       │
└──────────▲──────────────────────────────────────────────┬───────────────────┘
           │ WebView2 message bridge (JSON, exists today)  │ window / browser
┌──────────┴──────────── localhost:9103 (axum) ────────────▼───────────────────┐
│ SPA  React 18 + Fluent v9  (src/t3-react)      route  /#/report              │
│                                                                             │
│ /api/report/self-check   /api/report/draft   /api/report/bundle             │
│ /api/report/send         /api/report/reports                                │
│                                                                             │
│ MCP tools (api/src/mcp/tools.rs)                                             │
│   docs.search · docs.page · diag.device · diag.ports · diag.fdd             │
│   diag.log_tail · diag.build · report.suggest                               │
│                                                                             │
│ data: docs index (built from temco-learn) · fdd rules · log files            │
│ AI chat (/api/ai/chat) uses the same tool registry                           │
└──────────┬──────────────────────────────────────────────────────────────────┘
           │ HTTPS, only when the user picks GitHub
           ▼
   GitHub issues  ◄── T3000_Builder (Action) ◄── forum · email · bundle file
```

## 3. Where the code goes

| Concern | Path | Note |
|---|---|---|
| the page | `src/t3-react/features/report/` | hash route `:9103/#/t3000/report` |
| API handlers | `api/src/support/routes.rs` | mounted beside `api/src/ai/` |
| self-check | `api/src/support/self_check.rs` | static rule table, no model |
| docs index | `api/src/support/docs_index.rs` | walks `T3000_DOCS_ROOT` (default `public/docs`) once per process |
| MCP tools | `api/src/mcp/tools.rs`, `api/src/mcp/dispatch.rs` | 3 new tools in the existing registry |
| capture + log | `BacnetWebView.cpp` (`REPORT_*` cases), `RuntimeLog.h` + `global_function.cpp` | existing WebView2 bridge, new cases |

No new process, no new port, no new installer.

## 4. Self-check — MCP tools

| Tool | Reads from | Returns |
|---|---|---|
| `t3000_report_docs_search` | docs index | top N pages: id, title, score, excerpt |
| `t3000_report_docs_page` | docs index | one page: title + markdown |
| `t3000_report_self_check` | rule table + docs index | suggestions, each with a doc link |
| `t3000_device_diagnostics` *(exists)* | `lan_scan`, `t3_device` | per-device health |
| `t3000_trendlog_query` *(exists)* | trend tables | whether history is actually stored |
| `t3000_doc_list` / `t3000_doc_read` *(exists)* | GitHub raw | the published help pages |

`t3000_report_self_check` is the one the page calls through `/api/report/self-check`.

```json
{
  "matched": true,
  "documents_searched": 543,
  "suggestions": [
    {
      "rule_id": "trendlog-not-saved",
      "severity": "warning",
      "title": "Trend log has no history",
      "detail": "A trend log only stores samples after it has been switched on and given a sample interval; enabling it does not backfill earlier data.",
      "action": "Open Trend Logs, check the log is enabled and that the interval is not 0 ...",
      "doc_id": "guides/troubleshooting",
      "doc_title": "Troubleshooting",
      "doc_url": "#/t3000/documentation?doc=guides/troubleshooting"
    }
  ]
}
```

## 5. What we suggest — the rule table

Not model prose: a table the API evaluates, so every remedy is reviewable and testable.

| Rule id | Fires when | Suggestion | Docs |
|---|---|---|---|
| `no-device-selected` | no panel chosen | pick the panel first | select device |
| `empty-building` | the host counted zero devices | run Discover | discover devices |
| `not-in-t3000` | page opened outside the desktop app | continue, but say so | — |
| `no-runtime-log` | the ring buffer is empty | reproduce once, then capture | runtime log |
| `device-offline` | offline / timeout / no response | power, cabling, port, then Discover | network & IP |
| `trendlog-not-saved` | trend log / no data / not saved | enable it, set a non-zero interval | trend logs |
| `write-rejected` | cannot write / setpoint / auto | release from Auto to Hand | points |
| `com-port-busy` | COM port / access denied | close whatever holds the port | COM ports |
| `firmware-version` | firmware / version mismatch | compare both version numbers | firmware |
| `schedule-not-running` | schedule / holiday / occupancy | check enabled rows, clock, holidays | schedules |
| `graphic-missing` | graphic / blank screen | reselect the panel to reload its cache | graphics |
| `database-sync` | database / sync / duplicate | check Settings → Database | database |
| `ai-not-configured` | ai / model / ollama | set `T3000_OLLAMA_URL` | — |
| `installer-update` | install / msi / permission | rerun as administrator | installation |
| `license` | licence / dongle / expired | include the licence ID | — |
| `doc-match` | anything the docs answer | read the page first | the page itself |

The text lives in `RULES` in `api/src/support/self_check.rs`, so a wrong remedy is a one-line fix.

## 6. API surface

| Method | Path | Body → result |
|---|---|---|
| POST | `/api/report/self-check` | `ClientContext` → `{ matched, suggestions[], documents_searched }` |
| POST | `/api/report/draft` | `ReportInput` → `{ title, body, labels[], github_url, mailto_url, forum_url }` |
| POST | `/api/report/bundle` | `ReportInput` → `{ id, dir, markdown_path, files[], attachments[] }` |
| POST | `/api/report/send` | `{ kind, title, body, labels[], bundleId? }` → `{ ok, route, issue_number?, issue_url?, url?, message }` |
| GET | `/api/report/list` | → `{ reports[], total, dir }` |
| GET | `/api/docs/search` | `?q=&limit=` → `{ query, results[], total_docs }` |
| GET | `/api/docs/page` | `?id=` → `{ id, title, markdown }` |

`send` never holds a GitHub token in the client. With `T3000_REPORT_GITHUB_TOKEN` set on the
machine the issue is filed server-side (`route: "github"`); otherwise it returns a prefilled URL
(`route: "browser"`) that the page opens, and the user's own GitHub session does the rest.
`bundle` always runs first, so a failed send never loses the screenshot or the log.

Bundles go to `T3000_REPORT_DIR` (default `./t3000-reports`); the repository is
`T3000_REPORT_GITHUB_REPO` (default `temcocontrols/T3000_Building_Automation_System`).

## 7. C++ contract

| Message (numeric action) | Answer |
|---|---|
| `REPORT_CONTEXT` (19) | `{ version, windows, locale, building, panel, device_serial, log_lines }` |
| `REPORT_LOGS` (20) | `{ text, saved }` — the ring buffer tail (default 200 lines) |
| `REPORT_CAPTURE` (21) | `{ ok, path, width, height }` (or `{ ok:false, error }`) |
| `REPORT_CLIPBOARD` (22) | `{ ok }` — the PNG at `path` on the clipboard |

Each answer carries `action: "<NAME>_RES"`, which is how the page matches it. The enum lives in
`BacnetWebView.cpp` next to the existing `WEBVIEW_MESSAGE_TYPE` values.

Capture: `PrintWindow(hwnd, …, PW_RENDERFULLCONTENT)` — plain `BitBlt` renders the WebView2 child black. Rectangle from `DwmGetWindowAttribute(DWMWA_EXTENDED_FRAME_BOUNDS)`. Long edge ≤ 2560 px, ≤ 1.5 MB, PNG via WIC.

## 8. Flow

```text
Help ▸ Report an Issue…
        │
        ▼
   E  Entry              what are you trying to do?   kind: broken · how-do-I · feature
        │  [ Find an answer ]
        ▼
   1  Self-check          docs hits · checks T3000 already ran · what to try
        │
        ├── "Yes, solved" ──────────────►  S  Solved      nothing sent ──► close
        │
        └── "No, still stuck"
                 ▼
   2  Screen              capture · whole window or one panel · include log + info
                 ▼
   3  Words + review      what happened · what you expected · what will be sent
                 ▼
   4  Send                forum · email · file · GitHub
                 ▼
   R  Result              reference · what happens next
```

Every state the user can reach, including the ways out:

| State | Step | The page does |
|---|---|---|
| solved | 1 | 8.3 — confirms nothing was sent |
| no page matched | 1 | 8.2b — checks only, no docs block |
| capture failed | 2 | 8.4b — explains why, offers "continue without a picture" |
| send failed | 4 | 8.6b — bundle kept on disk, offers another route |
| back | 2, 3, 4 | previous step, nothing typed is lost |
| cancel | E, 1, 2, 3 | "Discard this report?" unless something was sent |

## 9. Pages

### 9.1 E — entry

```text
┌─ Help & Report ──────────────────────────────────────────────┐
│  What are you trying to do?                                  │
│  ┌────────────────────────────────────────────────────────┐  │
│  │ the trend log is not saving                         ▮  │  │
│  └────────────────────────────────────────────────────────┘  │
│                                                              │
│  This is…                                                    │
│   (•) something is broken       ( ) I don't know how to …    │
│   ( ) I want to ask for a feature                            │
│                                                              │
│  [ Find an answer ]                           [ My reports ] │
│                                                              │
│  Answer first — most questions end here, with nothing sent.   │
└──────────────────────────────────────────────────────────────┘
```

### 9.2 1 — self-check (the post button is not yet on screen)

```text
┌─ 1 of 4 · Before you report ─────────────────────────────────┐
│  You said: "the trend log is not saving"                     │
│                                                              │
│  Likely pages                                                │
│   1  Trend logs — logging a point                   open ›    │
│   2  Why a trend may not record                     open ›    │
│   3  Trend log setup  (forum)                       open ›    │
│                                                              │
│  Checks T3000 ran                                            │
│   ✗  T3-Nano 192.168.1.20 is offline — no reply in 3 s        │
│   ✗  COM5 is held by Modbus Poll (pid 812)                   │
│   ✓  Trend log 2 is enabled on the panel                     │
│                                                              │
│  What to try                                                 │
│   • Close Modbus Poll — it is holding COM5.                   │
│   • Power-cycle the T3-Nano, then ping 192.168.1.20.          │
│                                                              │
│  [ Yes, solved ]             [ No, still stuck → continue ]   │
└──────────────────────────────────────────────────────────────┘
```

### 9.2b variant — nothing matched

```text
┌─ 1 of 4 · Before you report ─────────────────────────────────┐
│  You said: "output 3 will not switch"                        │
│                                                              │
│  No page matched yet.                                        │
│                                                              │
│  Checks T3000 ran                                            │
│   ✓  T3-Nano 192.168.1.20 is online                          │
│   ✗  Output 3 is in Hand mode, value 0 — expected Auto       │
│                                                              │
│  What to try                                                 │
│   • Set output 3 back to Auto, then re-send the program.      │
│                                                              │
│  [ Yes, solved ]             [ No, still stuck → continue ]   │
└──────────────────────────────────────────────────────────────┘
```

### 9.3 S — solved

```text
┌─ Solved ─────────────────────────────────────────────────────┐
│  ✓ Good — nothing was sent.                                  │
│                                                              │
│  You checked it here in 40 seconds.                          │
│                                                              │
│  [ Back to work ]   [ Search again ]   [ Report it anyway ]   │
└──────────────────────────────────────────────────────────────┘
```

### 9.4 2 — screen

```text
┌─ 2 of 4 · Show us your screen ───────────────────────────────┐
│  A picture saves ten sentences.                              │
│                                                              │
│  ┌─────────────────────────────┐   What to include           │
│  │                             │    (•) Whole T3000 window   │
│  │       captured image        │    ( ) Only this panel      │
│  │                             │                             │
│  └─────────────────────────────┘    [x] Today's log           │
│                                     [x] System info           │
│  [ Capture ]  [ Retake ]  [ Remove ]                         │
│                                                              │
│  [ Capture another window… ]   for a fault in another program │
│                                                              │
│                                      [ Back ]    [ Next ]     │
└──────────────────────────────────────────────────────────────┘
```

### 9.4b variant — capture failed

```text
┌─ 2 of 4 · Show us your screen ───────────────────────────────┐
│  ⚠ The screen could not be captured.                         │
│    T3000 is running as administrator and this window is not,  │
│    or the WebView2 runtime is too old.                        │
│                                                              │
│  [ Try again ]   [ Capture another window… ]                 │
│                                                              │
│  You can continue without a picture — the log and the system  │
│  info still go with the report.                               │
│                                      [ Back ]    [ Next ]     │
└──────────────────────────────────────────────────────────────┘
```

### 9.5 3 — words and review

```text
┌─ 3 of 4 · Tell us in your own words ─────────────────────────┐
│  What happened?                                              │
│  ┌────────────────────────────────────────────────────────┐  │
│  │ the trend log is not saving                            │  │
│  └────────────────────────────────────────────────────────┘  │
│  What did you expect?                                        │
│  ┌────────────────────────────────────────────────────────┐  │
│  │ a new row every 15 minutes                             │  │
│  └────────────────────────────────────────────────────────┘  │
│  Any language is fine — it is translated for the team.        │
│                                                              │
│  ── What will be sent ──────────────────────────────────────  │
│   ✓  screen.png   1280×720                          [Remove]  │
│   ✓  log.txt      last 200 lines, 4 KB              [Remove]  │
│   ✓  info.txt     T3000 2026.0912 · Win 10 · zh-CN            │
│   ✗  devices list                                   [Add]     │
│                                                              │
│                                      [ Back ]    [ Next ]     │
└──────────────────────────────────────────────────────────────┘
```

### 9.6 4 — how to send

```text
┌─ 4 of 4 · How do you want to send it? ───────────────────────┐
│  Everything above goes with whichever you pick.              │
│                                                              │
│  (•) Post on the forum                                       │
│      you already have a login · the community answers and     │
│      the team sees it                              [ Send ]   │
│                                                              │
│  ( ) Email it to support                                     │
│      your mail app opens with everything attached  [ Send ]   │
│                                                              │
│  ( ) Save it as a file                                       │
│      for a colleague, or any channel you use   [ Save file ]  │
│                                                              │
│  ( ) Post on GitHub                                          │
│      only with a GitHub account · staff and partners          │
│                                                 [ Open form ] │
│                                                              │
│                                                   [ Back ]    │
└──────────────────────────────────────────────────────────────┘
```

### 9.6b variant — send failed

```text
┌─ 4 of 4 · How do you want to send it? ───────────────────────┐
│  ⚠ The forum could not be reached.                           │
│                                                              │
│  Your report is safe on this machine.                        │
│                                                              │
│  [ Try again ]   [ Email instead ]   [ Save file ]           │
│                                                              │
│  The bundle is at Documents\T3000\reports\20261116-2018.zip   │
└──────────────────────────────────────────────────────────────┘
```

### 9.7 R — sent

```text
┌─ Sent ───────────────────────────────────────────────────────┐
│  ✓ Your report is on its way.                                │
│                                                              │
│  Reference   T3000-20261116-2018                             │
│  Posted to   forums.temcocontrols.com / trend-log-setup       │
│  Attached    screen · log · system info                       │
│                                                              │
│  What happens next                                           │
│   1  a person reads it — usually within a working day         │
│   2  if it is a defect it becomes a tracked issue             │
│   3  the answer appears in your forum thread                  │
│                                                              │
│  [ Open my post ]   [ Copy reference ]   [ Close ]            │
└──────────────────────────────────────────────────────────────┘
```

### 9.8 M — my reports

```text
┌─ My reports ─────────────────────────────────────────────────┐
│  Nov 16   the trend log is not saving   forum · answered   › │
│  Nov 03   T3-Nano drops off wifi        forum · waiting    › │
│  Oct 28   add a freeze-layout button    issue #455 · planned›│
│                                                              │
│  Kept on this machine, and in your own threads.               │
│                                                   [ Close ]   │
└──────────────────────────────────────────────────────────────┘
```

Empty state:

```text
┌─ My reports ─────────────────────────────────────────────────┐
│  No reports yet.                                             │
│  Anything you send from this page is listed here.             │
│                                     [ Report an issue ]       │
└──────────────────────────────────────────────────────────────┘
```

## 10. Delivery routes

| Route | The user needs | How it reaches the record |
|---|---|---|
| forum | their forum login | the Action polls `forums.temcocontrols.com/latest.json` (200, unauthenticated), opens the issue, links the topic |
| email | a mail app | support mailbox → the same Action, or a person |
| file | nothing | attached anywhere; staff drops it in |
| GitHub | a GitHub account | prefilled form, direct |

All four carry the same bundle, so triage never depends on the door used.

One trap on the GitHub route: do not add an issue **form** (`ISSUE_TEMPLATE/*.yml`) while the prefilled card is the primary door — forms ignore the `body` parameter and the prefill dies silently. A markdown template is safe.

## 11. Runtime log

`MainFrm.cpp`, one ring buffer, 200 entries, rotated file `T3000-runtime.log` (1 MB).

```text
[20:04:12.331] nav    Devices > Trendlogs
[20:04:15.002] cmd    Build > Send program
[20:04:15.884] err    COM5 timeout after 3000 ms
[20:04:16.010] dlg    "Send failed" shown
```

Recorded: screen changes, menu commands, errors, dialogs shown, connect/disconnect, last status-bar line. Returned by `report:logs`, offered with a checkbox on 9.5.

## 12. AI

| Where | What | Key |
|---|---|---|
| `api/src/support/draft` | tidy + translate the user's text; hidden unless `T3000_OLLAMA_URL` is set (existing convention, default `qwen2.5:7b`) | none |
| `report.suggest` | no model — a rule table, so it cannot hallucinate a remedy | none |
| T3000_Builder (Action) | classify, find duplicates, ask for the missing fact, draft the reply, propose a forum topic | `GITHUB_TOKEN` |

Never a model key inside T3000.

## 13. Steps

| # | Step | Where | State |
|---|---|---|---|
| 1 | `Documentation (F1)`, `Report an Issue…` | `T3000.rc`, `MainFrm.cpp` | done |
| 2 | stop MFC restoring stale menu text | `MainFrm.cpp` | done |
| 3 | runtime ring buffer + `T3000-runtime.log` | `RuntimeLog.h`, `global_function.cpp` | done |
| 4 | `REPORT_CONTEXT` / `_LOGS` / `_CAPTURE` / `_CLIPBOARD` | `BacnetWebView.cpp` | done |
| 5 | docs index | `api/src/support/docs_index.rs` | done |
| 6 | MCP tools + self-check | `api/src/mcp/tools.rs`, `dispatch.rs`, `support/self_check.rs` | done |
| 7 | `/api/report/*` + `/api/docs/*` | `api/src/support/routes.rs` | done |
| 8 | React pages | `src/t3-react/features/report/` | done |
| 9 | bundle + four send routes | API + page | done |
| 10 | triage Action, forum mirror | `.github/workflows/support-triage.yml` | done |

## 14. Non-goals

Each of these looks reasonable and breaks something, so they are recorded rather than re-argued.

1. **A second EXE, installer or updater** — the reporter lives inside T3000; a separate process would have to ask T3000 for everything it already knows.
2. **A token or model key on a client machine** — anything the client holds is shipped.
3. **Automatic forum posting, or a bot reply that reads as a company statement** — a person sends every public reply.
4. **Model-written remedies in `report.suggest`** — it is a rule table, because a wrong remedy is worse than no remedy.

## 15. What is built

| Piece | Files |
|---|---|
| T3000 menu + capture/log | `MainFrm.cpp` (`OnHelpAndLearn`, `OnHelpReportIssue`, `RestoreOriginalState`), `RuntimeLog.h`, `global_function.cpp`, `BacnetWebView.cpp` |
| Rust support module | `api/src/support/{mod,model,docs_index,self_check,routes}.rs`, mounted in `api/src/server.rs` |
| MCP | `api/src/mcp/tools.rs`, `api/src/mcp/dispatch.rs` — `t3000_report_self_check`, `t3000_report_docs_search`, `t3000_report_docs_page` |
| React | `src/t3-react/features/report/{types.ts,services/,pages/ReportPage.tsx,pages/ReportPage.module.css}`, route `/t3000/report` in `app/App.tsx` + `app/router/routes.ts`, `services/helpMenuService.ts` |
| Triage | `.github/workflows/support-triage.yml` |

Verified: `cargo check --lib` (clean), `tsc --noEmit -p tsconfig.json` (only the pre-existing
`ignoreDeprecations` config warning), `rc.exe` on `T3000.rc`, and `msbuild /t:ClCompile` on
`BacnetWebView.cpp`, `global_function.cpp`, `MainFrm.cpp` (0 errors).

Two behaviours worth knowing:

* `docs_index` resolves its root from `T3000_DOCS_ROOT`, then `public/docs`, then `docs`. With no
  docs on disk the index is empty, `documents_searched` is 0 and only rule-table suggestions fire —
  the flow still works.
* Outside T3000 (`:9103` opened in a browser) `webviewBridge` falls back to `getDisplayMedia` for
  the screenshot and reports an empty context, so the page can be developed without the desktop app.
