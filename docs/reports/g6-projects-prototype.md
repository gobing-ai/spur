# G6 Projects prototype — conversation, agents, work, global input (task 0830)

Prototype-only simulation at **`docs/prototypes/g6-projects/index.html`** with automated
interaction checks in **`apps/web/tests/prototypes/g6-projects.test.ts`** (happy-dom, run inside
apps/web). Design tokens come from `DESIGN.md` (`--ink-*`, `--surface-*`, `--s-*`, `--r-*`,
`--hairline`). Everything visible is labeled "simulation", "MOCK", or "(SIMULATED)". No network,
no CDN, no framework — one HTML file, open it and it works offline.

## Viewing instructions

Open the file directly in a browser (double-click, or `open docs/prototypes/g6-projects/index.html`).
No build step, no server, no storage prerequisites. The page boots into the **Conversation** view of
the first fixture project.

- Fixture controls (in the document flow): **delay, netfail, dupretry, late-result, rehydrate, corrupt-storage** plus
  the R3 state toggles **zero-agent / orch-missing / orch-offline / rest-held /
  executor-unavailable / blocked / failed-delivery / outcome-unknown** and **reset to nominal**.
  `aria-pressed` mirrors the toggled state; the fixture note names the focused project path.
- Project selector (header): two projects **both labeled "Aurora"** (`/work/aurora-auth`,
  `/work/aurora-billing`). The shared label is deliberate — selection and identity key on the
  project path, and the conversation and live region always show the focused path; `hdr-worktree` shows the fixture branch/revision so the two cannot be confused.
- Header: worktree, dispatch strategy, orchestrator binding, capacity — all update with the
  focused project. The orchestrator is a **planner-role member bound as orchestrator**; the role
  vocabulary stays the closed set `scribe/coder/reviewer/planner`.
- Views (keyboard tabs): **Conversation** (default), **Agents** (roster → member detail with
  process/terminal/messages/activity panels), **Work** (task list → links a task into the *same*
  conversation).
- `window.__g6.state()` is a debug hook for the session state (prototype-only).

Storage contract: `localStorage["spur:g6:projects-prototype:v1"]`, versioned (`version: 1`),
drafts + conversations **per project path**. Invalid/unavailable storage is a nonfatal notice; the
stored bytes are left untouched and the page stays session-only.

## Scenario receipts (happy-dom + Chrome browser checks)

| # | Scenario | How to drive it | Expected outcome (observed) |
| - | -------- | --------------- | --------------------------- |
| R2-1 | Capture with task ref | Work → "Use in conversation" → type → Enter | pending receipt row with `taskId=T-101`, `featureId=G6`, projectPath; composer keeps text until acceptance |
| R2-2 | Draft retention per project | type A → switch → type B → switch back | each project's draft rehydrates; drafts never leak |
| R2-3 | Durable acceptance clears only the submitted revision | "Durable accept now" after typing; edits while waiting retained | only the submitted revision clears; edited newer draft survives |
| R2-4 | Retry idempotency | netfail on → submit → acceptance fails → same text → Enter | same `requestId`, no second row; attempts bump on duplicate resend; edited text → NEW requestId |
| R2-5 | Duplicate suppression | re-Enter identical payload while pending | "Duplicate suppressed — no second request was created" |
| R2-6 | Late result into originating project | accept in A → switch to B → "late-result" | result lands in `/work/aurora-auth`; B conversation/list untouched |
| R2-7 | Refresh | "rehydrate" | conversations rebuild from `spur:g6:projects-prototype:v1`, split preserved |
| R3-1 | Zero agent fleet | zero-agent → submit → accept | `queued-awaiting-orchestrator` (durable receipt), **never "working"**; card explains action |
| R3-2 | Orchestrator missing / offline | orch-missing / orch-offline → submit → accept | `queued-awaiting-orchestrator`; header shows "missing — no orchestrator bound" / "offline — bound but unreachable" |
| R3-3 | Rest-held | rest-held → submit → accept | `rest-held`; results from running work keep arriving |
| R3-4 | Executor unavailable | executor-unavailable → submit → accept | `executor-unavailable`; "fix the member's executor binding, then retry — same payload, same requestId" |
| R3-5 | Blocked | blocked → submit → accept | `blocked` with honest note: today's runtime has no first-class blocked signal (0828) |
| R3-6 | Failed delivery | netfail (or failed-delivery) → accept | `failed-delivery`; draft preserved; retry reuses the requestId |
| R3-7 | Outcome unknown | accept → outcome-unknown | `outcome-unknown`; guidance is inspect Messages/Activity and **reconcile** — no unconditional retry button exists |
| R3-8 | Run exit ≠ verified result | row action "Arrive run-exit-only result" | `completed-exit-only` labeled "run exit 0 recorded (unverified)" — never a verified receipt |
| KB-1 | Enter submits | composer + Enter | pending receipt row captured at submission (projectPath, requestId, text, taskId/featureId if a ref chip is set) |
| KB-2 | Shift+Enter | composer + Shift+Enter | newline inserted, no submission |
| KB-3 | IME Enter | composition login (IME) then Enter | **never** submits (isComposing guard) |
| KB-4 | Escape closes detail; focus restore | Agents → Open detail (dry-focus test) | detail closes; focus returns to the opener's member button; the roster button is keyboard reachable, `aria-selected` mirrors detail tabs, live region announces view/notice changes; status is never color-alone (icon + label text on every receipt) |
| ST-1 | Corrupt storage | "corrupt-storage" | page keeps working; notice names the key and says session-only; bytes untouched |
| LB-1 | Identical labels | select either "Aurora" option | options carry the two paths as value; rows show both path and shared label; no name-based retargeting possible |

Automation receipts for the same matrix: `bun test tests/prototypes/g6-projects.test.ts` (19 tests,
200 assertions — including the load-bearing cross-project corruption case).

## Keyboard / IME / focus steps (manual check list)

1. Tab to project selector → change with arrow keys — focus announcements go to
   `#g6-live` (`role="status"`, announced visually in `#g6-live-visual` too — not color-alone).
2. In Conversation: Shift+Enter inserts a newline; Enter submits; with an IME active, Enter that
   ends the composition is ignored.
3. Tabs are keyboard-tab list (`roving tabindex`): ArrowRight/ArrowLeft move selection,
   Enter selects, `tabindex` follows `aria-selected`.
4. Agents roster: each "Open detail" is a real button (`type="button"`), opens detail; Esc closes
   it and restores focus to the opener (re-resolved across roster re-render).
5. All receipt rows carry an icon **plus** a text label (`queued-awaiting-orchestrator`,
   `rest-held`, …) — nothing relies on color alone.

## Browser evidence — 2026-09-12

Chrome **153.0.8010.36**, fresh headless contexts at **390×900** and **1440×900**, zero page errors and no horizontal overflow. The browser checks passed Enter, native Shift+Enter newline insertion, Chromium composition via CDP `Input.imeSetComposition` (Enter did not submit), tab arrow navigation, member-detail focus, Escape restoration, mock start/stop and actual page-reload isolation. Native operating-system candidate windows and mobile keyboards were not exercised; these remain compatibility checks, not claimed evidence.

Initial browser inspection exposed the fixed composer obscuring content. The composer now sits before the active view in normal document flow, and fixture controls also occupy normal flow. At 390 px the view is one column and roster/task rows wrap; 1440 px retains the wider conversation grid. Scrolling keeps every control reachable without an overlay. No production design tokens or Board layout changed.

| View | 390 px | 1440 px |
| --- | --- | --- |
| Conversation | [Screenshot](../prototypes/g6-projects/conversation-390.png) | [Screenshot](../prototypes/g6-projects/conversation-1440.png) |
| Agents | [Screenshot](../prototypes/g6-projects/agents-390.png) | [Screenshot](../prototypes/g6-projects/agents-1440.png) |

Reproduction: open the prototype at the indicated viewport widths and follow the keyboard checklist above. Browser automation receipt: `.spur/run/g6-verifyall/browser-results.json`; runner: `.spur/run/g6-verifyall/browser-check.mjs` (uses the already-installed local Playwright module and Chrome, no project dependency added). Happy-dom regression suite: `cd apps/web && bun test tests/prototypes/g6-projects.test.ts` → 19 pass, 0 fail, 200 assertions.

## Retained controls and legacy routes (from the 0828 runtime inventory)

| Legacy control / route | Retained as | Note |
| ---------------------- | ----------- | ---- |
| `GlobalAgentBar` composer stub | prototype composer (textarea, `#composer`) | UI-only in production; the prototype stages the full capture contract |
| Project switcher project selection | `#project-select` keyed on `option.value` = project path | malicious/identical labels can never retarget; header repeats the path |
| 0828 occupancy vocabulary (`working`/`idle`/`rest`) | state cards + member occupancy labels | `queued-awaiting-orchestrator` is never shown as "working" (R3-1) |
| 0828 "no first-class blocked signal" | `blocked` card / `⛔ blocked` receipt | treated as occupancy ambiguity, honestly labeled |
| Board / task URLs (`docs/tasks4`, feature ids) | Work view task rows → ref chips → `taskId`/`featureId` captured at submission | navigation cannot retarget a captured request (payload is immutable at submit time) |
| Strategy names (rest / GTD dispatch) | `#hdr-strategy` + state cards | same vocabulary as 0829 traces |
| Workspace team selection + Overview/Team/Inbox/Tasks | One project selector + Conversation/Agents/Work | `apps/web/src/modules/workspace/WorkspaceShell.tsx:15`; team-specific selection is consolidated only in the prototype. |
| Inbox All/Supervisor/member tabs | Conversation + Agents → Messages/Activity | `apps/web/src/modules/inbox/InboxShell.tsx:14`; message history and occupancy remain distinct. |
| Teams supervisor/terminal/process/activity controls | Agents roster, detail Process and mock Start/Stop | `apps/web/src/modules/teams/TeamsShell.tsx:10`; mutations visibly simulated; no process is launched. |
| Member terminal stdout/stderr and stdin | Agents → Terminal inspection + labeled mock member input | `apps/web/src/modules/teams/MemberTerminal.tsx:47`; existing `POST /api/team/processes/:id/stdin` remains owned by the production terminal; mock input echoes locally without calling it. |
| Message send/reply/inbox | Project composer and Agents → Messages inspection + labeled mock member input | `/api/messages` and `/api/messages/:id/reply` remain production-owned; prototype requests do not call them. |
| Team process listing/start/stop/stream and team up/down | Agents Process/Terminal/Activity and mock lifecycle buttons | Existing `/api/team/*` transport stays intact; fleet-wide up/down is represented by fixtures, not performed. |
| Registered project list/start | Single project selector | `apps/web/src/components/ProjectSwitcher.tsx:27` and `:73`; existing `/api/projects` and `/api/projects/start` are never called by this file. |
| Board Workspace/Inbox/Teams navigation | Three Projects views in this standalone file | Existing Board routes remain usable; production route retirement and aliases await Robin's cutover decision. |

## Explicit mock / runtime limitations

- Receipts, results, retries, fleet, executor bindings, rest hold, and IDs are **simulation
  fixtures** — no durable production storage is read or written; Board/Projects storage is not
  touched.
- Requests/results only exist within the two fixture projects; there is no real orchestrator,
  IPC, or executor drive behind them.
- "Durable acceptance" is a simulated ~4 s arc (delay fixture) or a manual fixture button; no
  timers persist across reload.
- IME emulation in the automated test replays `KeyboardEvent` with `isComposing` — native IME
  nuances (candidate-window round-trips, mobile keyboards) remain manually testable only.
- Storage is per `localStorage` origin of `file://` — device- or browser-local, not synced.
- Retry identity (`lastFailedId`/`lastFailedKey`) and the failed-delivery covering scan ARE part
  of the serialized prototype state: a failed request survives simulated refresh (rehydrate fixture)
  and re-sending the same payload re-arms the same `requestId` instead of minting a duplicate.
- The identical "Aurora" labels are intentional fixtures; the production design must key every
  interactive identity on the project path (this prototype demonstrates the failure mode with
  label-keyed addressing by keeping both).

## Re-verification fixes

The added regression checks initially failed on three defects: same-text newer drafts were cleared, task-referenced retries created duplicates, and outcome-unknown could be resent through the composer. Drafts now carry a persisted revision; references remain attached until their accepted revision clears; payload comparison includes both task and feature IDs; unresolved outcomes suppress duplicate dispatch. Reload invalidates old timer captures and resets pending delay state. Structured malformed storage is rejected before rendering. Project switches close the prior member detail; detail tabs support keyboard arrows; Start/Stop changes only labeled mock occupancy.

Browser composition is now exercised through Chromium's input engine as well as the happy-dom `isComposing`/229 guards. OS IME candidate UI, other browsers and assistive-technology speech remain untested compatibility surfaces. The earlier all-browser-unverified receipt is superseded by the Chrome evidence above.

Result rows with a captured task reference expose **Open linked work (mock)**, which navigates to Work in the result's original project and announces its task/feature identity. Member Terminal/Messages input is a local simulated echo; it never calls stdin or message routes.
