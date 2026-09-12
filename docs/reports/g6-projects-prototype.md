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

- Fixture bar (bottom): **delay, netfail, dupretry, late-result, rehydrate, corrupt-storage** plus
  the R3 state toggles **zero-agent / orch-missing / orch-offline / rest-held /
  executor-unavailable / blocked / failed-delivery / outcome-unknown** and **reset to nominal**.
  `aria-pressed` mirrors the toggled state; the fixture note names the focused project path.
- Project selector (header): two projects **both labeled "Aurora"** (`/work/aurora-auth`,
  `/work/aurora-billing`). The shared label is deliberate — selection and identity key on the
  project path, and `hdr-worktree` always shows the focused path so the two cannot be confused.
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

## Scenario receipts (static code + happy-dom automation; screenshots not taken)

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

Automation receipts for the same matrix: `bun test tests/prototypes/g6-projects.test.ts` (11 tests,
148 assertions — including the load-bearing cross-project corruption case).

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

## Layout notes (inspected statically; NOT verified in a real browser)

- **1440px** — two-column grid: conversation + state cards / insights gutter on the left, agents &
  work on the right; the header fields sit on one line.
- **390px** — the grid collapses to one column via the single breakpoint; the fixture bar scrolls
  horizontally; the composer stays within the first viewport; states/cards stack but remain
  typographically intact (tokens from `DESIGN.md`, no truncated labels).
- HONESTY: **no real browser render, screenshot, or view-port measurement was taken for this
  deliverable.** The 390px/1440px claims come from reading the CSS (flex? columns + 390px
  breakpoint) and from DOM assertions in happy-dom; layout behavior in Chrome/Safari/Firefox is
  **unverified**.

## Retained controls and legacy routes (from the 0828 runtime inventory)

| Legacy control / route | Retained as | Note |
| ---------------------- | ----------- | ---- |
| `GlobalAgentBar` composer stub | prototype composer (textarea, `#composer`) | UI-only in production; the prototype stages the full capture contract |
| Project switcher label-driven selection | `#project-select` keyed on `option.value` = project path | malicious/identical labels can never retarget; header repeats the path |
| 0828 occupancy vocabulary (`working`/`idle`/`rest`) | state cards + member occupancy labels | `queued-awaiting-orchestrator` is never shown as "working" (R3-1) |
| 0828 "no first-class blocked signal" | `blocked` card / `⛔ blocked` receipt | treated as occupancy ambiguity, honestly labeled |
| Board / task URLs (`docs/tasks4`, feature ids) | Work view task rows → ref chips → `taskId`/`featureId` captured at submission | navigation cannot retarget a captured request (payload is immutable at submit time) |
| Strategy names (rest / GTD dispatch) | `#hdr-strategy` + state cards | same vocabulary as 0829 traces |

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
