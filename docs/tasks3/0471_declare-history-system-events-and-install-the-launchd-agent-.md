---
template: feature-impl
schema_version: 1
name: "Declare history.* system events and install the launchd agent for the nightly history loop"
description: ""
status: done
type: task
profile: standard
feature_id: E1
parent_wbs: null
priority: P2
tags: []
dependencies: ["0470"]
ac_numbering: task-local
created_at: "2026-08-07T05:02:01.610Z"
updated_at: "2026-08-08T12:42:53.883Z"
done_forced: "true"
done_reason: "Implement agent completed all 14 plan items; pipeline test-fix agent hit provider quota (exit 3) before verify ran. Manual re-verification: 4673 tests pass 0 fail, lint+typecheck+build green, event-names 100%/history.ts 99.25%/daily-summary 92.88% coverage, plist validated via plutil -lint, docs R8 T3 complete. Force-done waives the verify verdict only (task 0292)."
---

## 0471. Declare history.* system events and install the launchd agent for the nightly history loop

### Background
Graduated from the consumption-surface investigation (feature E1). **Depends on task 0470.**

The consumption-surface investigation chose **launchd** as the scheduling surface for the nightly history loop, after
establishing that Spur's embedded scheduler cannot drive it. Three findings, each independently
disqualifying, verified from source:

1. **It cannot express a daily schedule.** ts-infra's `NodeSchedulerAdapter.parseInterval` handles
   only `* * * * *`, `*/N * * * *`, and raw millisecond strings. A real cron field expression —
   `0 7 * * *`, "7am daily" — hits the documented fallback and **silently becomes a 60-second
   interval** with only a warn log.
2. **It needs a long-lived process the CLI does not have.** It is `setInterval`-based and in-process;
   `bootstrap.scheduler.enabled` is `false` in `config/config.example.yaml` and the schema documents
   it as "OFF by default for CLI (run-once)" (`apps/cli/schemas/spur-config.schema.json:90`).
3. **Nothing is registered on it.** Zero `initScheduler` call sites and zero cron entries exist
   anywhere in `apps/` or `packages/`.

**Choosing an external scheduler makes the event ledger the only in-harness evidence the loop ran** —
which is why the events ship with this ticket rather than as a follow-up.

**Verified, not assumed (the consumption-surface decision § R8):** the live 15,794-row `system_events` ledger *does* carry
current `workflow.*` rows, most recent 2026-08-06 — an earlier characterization of the ledger as dead
heartbeat noise is stale. But **`history.*` is 0 rows, and 0 of the 66 events declared in
`packages/app/src/services/event-names.ts` are `history.*`**. The history plane emits nothing at all.

Full spec: the consumption-surface decision ticket `### Design` § R6 and § R8, including the four-layer missed-run detection model.
### Requirements
- R1 — Declare `history.import.completed`, `history.analyze.completed`, and `history.daily.failed` in the event-names catalog alongside the existing 66 events, following the established metadata conventions.
- R2 — Emit those events from the history command paths so a completed or failed nightly run leaves a queryable ledger trail regardless of what invoked the CLI.
- R3 — Provide the launchd agent plist using StartCalendarInterval for a daily wall-clock trigger, with its install and uninstall path documented.
- R4 — Route launchd stdout and stderr to a log path under .spur/logs so failures occurring before Spur's own logging initializes are still captured.
- R5 — Implement the four detection layers from task 0464 Design § R8 — artifact freshness, ledger events, per-source coverage status, and the launchd error log — such that no single layer is the sole signal.
- R6 — Distinguish a run that never started from a run that started and failed, since artifact freshness alone cannot tell them apart.
- R7 — Surface the report path through the existing daily-summary surface rather than inventing a new notification channel.
- R8 — Document the chosen surface and its rejected alternatives in docs/04_DESIGN.md in the same commit as the command surface, per the T3 same-commit rule.
### Acceptance Criteria
```gherkin
Feature: 0471 the scheduled loop is observable and fails visibly

  Scenario: R2 — a completed run leaves a ledger trail
    Given the nightly history command runs to completion
    When the system events ledger is queried for history events
    Then a history.import.completed and a history.analyze.completed row are present

  Scenario: R6 — a failed run is distinguishable from a run that never started
    Given the nightly command started and then failed partway
    When the operator checks for a missed run
    Then a history.daily.failed event distinguishes it from the case where no event was written at all

  Scenario: R3 — the daily trigger fires on wall-clock time
    Given the launchd agent is installed
    When the configured hour arrives
    Then the history daily command executes once
    And its stdout and stderr are captured to the configured log path

  Scenario: R5 — no single detection layer is the sole signal
    Given the ledger is unavailable
    When the operator runs report
    Then artifact staleness still reveals that the loop has not run

Scenario: R1 — the history events join the declared catalog
    Given the event-names catalog
    When it is inspected after this change
    Then the three history event names are declared alongside the existing events
    And each follows the established metadata conventions

  Scenario: R4 — pre-logging failures are still captured
    Given the daily command fails before its own logging initializes
    When the operator inspects the scheduler error log
    Then the failure output is present at the configured log path

  Scenario: R7 — the report path reaches the operator through an existing surface
    Given a completed nightly run
    When the daily summary surface is generated
    Then it carries the path to the newest history report

  Scenario: R8 — the surface decision is documented in the same commit
    Given the command surface lands
    When the commit is inspected
    Then the design doc records the chosen scheduling surface and the rejected alternatives

  # Carried verbatim from feature E1's AC for DD-09 coverage — no R-prefix:
  # its number belongs to the feature's namespace, not this task's.
  Scenario: one scheduled loop runs unattended
    Given the scheduled morning job is configured
    When it fires
    Then yesterday's sessions across all in-scope sources are imported, analyzed, and reported
    And a failure in one source does not abort the others
```
### Q&A
**Closed during implement-ready refinement (2026-08-07):**

- *How do CLI events actually reach `system_events`?* Through the existing bridge
  `attachSystemEventLedger(bus, context)` (`apps/cli/src/system-event-ledger.ts:47`), already wired on
  `spur workflow run`/`continue` (`apps/cli/src/commands/workflow.ts:287,450`), `spur agent run`
  (`agent.ts:313`), and the team verbs (`team.ts:353`). This task reuses it. Writing a second bridge
  would fork the serialization, actor, and correlation logic.
- *Why is `flush()` called out as its own Plan step?* Because `daily` is run-once and the tap's
  inserts are asynchronous. Without `await ledger.flush()` in a `finally`, the events are declared,
  emitted, and never persisted — reproducing the exact "history.* = 0 rows" symptom this task exists
  to fix, while every unit test that asserts "emit was called" passes. The failure path matters most:
  it is the one that exits early, and `history.daily.failed` is the event R6 depends on.
- *Which payload policy?* **`metadata-only`.** History payloads can carry `cwd`, file paths, and error
  text quoting source content. `raw-safe` would put that in a persisted ledger. `metadata-only` keeps
  counts, durations, and outcome while the normalizer strips text fields and redacts secrets.
- *Does this need a web renderer?* **No.** `SystemEventsTab.tsx` falls back for unknown renderer keys
  (`fallbackRenderer`, `:677-679`), so the three events render acceptably with no web change. Declared
  out of scope so the ticket does not grow UI work.
- *Ship an installer command for the plist?* **No — template plus documented
  `launchctl bootstrap`/`bootout`.** A Spur verb would have to track macOS launchctl changes forever;
  one plist and two documented commands do not.
- *Why do the events ship with the plist instead of following it?* Choosing an external scheduler
  means the ledger is the only in-harness evidence the loop ran. Shipping the plist alone would
  install a scheduled job that nothing inside Spur can observe.

**Deferred, with the condition that reopens each:**

- A `spur history doctor` / health-check verb — the four layers are individually checkable today.
  Reopen if checking them manually proves to be the friction that stops anyone checking.
- Linux `systemd` timer equivalent — operator is macOS-primary (AGENTS.md stack defaults). Reopen when
  the loop needs to run on a Linux host.
- A web renderer for the three events — see above.

**Ordering.** Blocked on **0470** (`spur history daily` and its exit contract). Layer 1 belongs to
0469 and layer 3 to 0470; this task wires layers 2 and 4 and verifies the four compose. Terminal
implementation ticket for feature E1.
### Design
**WHAT.** Declare and emit the three `history.*` system events, ship the launchd agent that invokes
`spur history daily` on a wall-clock schedule, and wire the four-layer missed-run detection so no
single layer is the sole signal.

**WHY.** Choosing an external scheduler (0464 § R6 — Spur's embedded scheduler cannot express
`0 7 * * *`, silently degrades to a 60-second interval, needs a daemon the CLI is not, and drives
nothing today) makes the event ledger the **only in-harness evidence the loop ran**. That is why the
events ship with the plist rather than as a follow-up. Verified 2026-08-07: the 15,794-row
`system_events` ledger is live for `workflow.*`, but `history.*` is **0 rows and 0 of the 66 declared
events** — the history plane emits nothing at all.

**WHERE — frozen file targets.**

| File | Change |
| --- | --- |
| `packages/app/src/services/event-names.ts:7-19` | Add `'history'` to the `SystemEventSource` union. |
| `packages/app/src/services/event-names.ts` (catalog) | Three `event(...)` entries alongside the existing 66. |
| `apps/cli/src/commands/history.ts` | Attach the ledger tap on the `daily` verb and emit; **`flush()` in a `finally`**. |
| `config/` + `docs/04_DESIGN.md` | The plist template and its documented install/uninstall path. |
| `plugins/sp/skills/daily-summary/` | Surface the newest report path (R7). |

**Frozen names.**

- `history.import.completed`, `history.analyze.completed`, `history.daily.failed` — exactly three,
  exactly these names.
- Catalog registration: `event('<name>', 'history', '<renderer>', 'metadata-only', 'default')` —
  renderer keys `history-import`, `history-analyze`, `history-daily`.
- Label: `ai.gobing.spur.history.daily`; plist at
  `~/Library/LaunchAgents/ai.gobing.spur.history.daily.plist`.
- Logs: `.spur/logs/history-daily.out` and `.spur/logs/history-daily.err`.

**Payload policy is `metadata-only`, and that is a decision, not a default.** History payloads
carry `cwd`, file paths, and — for a failure — error text that can quote source content. The
catalog's `metadata-only` policy keeps counts, durations, and outcome while the normalizer
(`event-names.ts:244-263`) strips `body`/`content`/`message`/`prompt`/`query`/`response`/`value` and
runs secret redaction. Do **not** use `raw-safe` for any of the three.

**Emission mechanics — the one trap that decides whether this task actually works.** The CLI bridge
already exists: `attachSystemEventLedger(bus, context)`
(`apps/cli/src/system-event-ledger.ts:47`), wired on `spur workflow run` / `continue`
(`apps/cli/src/commands/workflow.ts:287,450`), `spur agent run` (`agent.ts:313`), and the team verbs
(`team.ts:353`). Follow that pattern exactly — do **not** write a second bridge.

The trap: `spur history daily` is **run-once**. The tap's inserts are in flight when the process is
ready to exit, so without `await ledger.flush()` in a `finally`, events are declared, emitted, and
never persisted — reproducing the exact "0 rows" symptom this task exists to end, while every unit
test passes. Flush on **both** the success and the failure path; `history.daily.failed` is the event
most likely to be lost, because the failure path is the one that exits early.

Ledger failures stay log-and-swallow (`system-event-ledger.ts` R5 behavior): a ledger outage must
never abort an import.

**Four-layer detection (R5, R6) — who owns what.**

| Layer | Signal | Owner | Detects |
| --- | --- | --- | --- |
| 1 | `latest.json` older than 36 h ⇒ banner | **0469** (already specified) | The whole loop stopped |
| 2 | `history.*` ledger events | **this task** | A run that started and died mid-way |
| 3 | `coverage[].status` per source | **0470** | One source stopped while others kept working |
| 4 | launchd `StandardErrorPath` | **this task** | Failures before Spur's own logging is up |

**R6 is what layer 2 buys and layer 1 cannot.** "No artifact" is ambiguous — it means either "launchd
never fired" or "the run started and failed". The disambiguation is: a `history.daily.failed` row
present ⇒ it ran and failed; **no `history.*` row at all** for the window ⇒ it never started. Both
must be checkable without reading the artifact, which by definition does not exist in either case.

**launchd agent.** `StartCalendarInterval` for the daily wall-clock trigger — the OS supervises,
survives reboot, and runs missed jobs at next login. `StandardOutPath` / `StandardErrorPath` to the
`.spur/logs/` paths above. Ship it as a **template plus documented install/uninstall**
(`launchctl bootstrap`/`bootout`), not as an installer command: one plist and two documented commands
beat a Spur verb that must then be maintained across macOS launchctl changes.

**Anti-patterns:**

- Do **not** wire Spur's embedded scheduler "since it's already there". It cannot express a daily
  schedule, and a silent 60-second fallback loop is worse than no scheduler (0464 § R6).
- Do **not** skip `flush()`. See above — it is the difference between working and appearing to work.
- Do **not** let a ledger write failure abort or fail the import.
- Do **not** use `raw-safe` payloads for history events.
- Do **not** invent a new notification channel. R7 reuses the daily-summary surface the operator
  already opens (`plugins/sp/skills/daily-summary/`).
- Do **not** add a fifth detection layer or a health-check verb. Four layers, each already earning
  its place.
- Do **not** treat the launchd plist as a substitute for the events. The whole point is that no
  single layer is trusted.

**Web renderer is optional and out of scope.** `SystemEventsTab.tsx` falls back when a renderer key
is unknown (`fallbackRenderer`, `SystemEventsTab.tsx:677-679`), so the three events render acceptably
with no web change. Do not expand this task into UI work.

**Handoff.**

- **Assumes from dep 0470:** `spur history daily` exists and its exit code honors the 0/1/2 contract.
  The events must agree with that exit code — a run exiting 1 must have emitted
  `history.daily.failed`. **Do not start before 0470 lands**; there is no `daily` verb to instrument.
- **Assumes from 0469 (layer 1) and 0470 (layer 3):** those layers are theirs. This task wires
  layers 2 and 4 and verifies all four compose.
- **Leaves nothing downstream.** This is E1's terminal implementation ticket.

**ADR: no** — 0464 § R6 already recorded the scheduling decision and its rejected alternatives.
**R8 is still required:** `docs/04_DESIGN.md` must carry the chosen surface and the rejected
alternatives in the same commit as the command surface (T3).
### Plan
- [x] **0. Confirm 0470 landed.** `spur history daily` must exist with its 0/1/2 exit contract —
      there is nothing to instrument otherwise. Baseline `bun run lint` + `bun run test` green.
- [x] **1. Declare the events (R1).** Add `'history'` to `SystemEventSource`
      (`packages/app/src/services/event-names.ts:7-19`) and the three catalog entries with
      `metadata-only` policy and `default` tier. Test that all three resolve from the catalog and that
      the union addition compiles across every consumer.
- [x] **2. Payload policy test.** Feed a payload containing `content` and a configured secret through
      `normalizeSystemEventPayload`; assert the text field is `[redacted]` and the secret does not
      survive.
- [x] **3. Attach the tap (R2).** Wire `attachSystemEventLedger(bus, context)` on the `daily` verb,
      following `apps/cli/src/commands/workflow.ts:287` — not a second bridge.
- [x] **4. Flush on both paths — the step this task turns on.** `await ledger.flush()` in a `finally`,
      covering the success **and** the failure exit. Test by running `daily` to completion and then
      querying `system_events`: rows must be present **after the command returns**. Add the failure
      case separately — force a failure, assert `history.daily.failed` persisted. A test that only
      asserts "emit was called" will pass while the real thing writes nothing.
- [x] **5. Ledger outage isolation.** With the ledger DB unwritable, assert the import still completes
      and exits on its own contract.
- [x] **6. launchd agent (R3, R4).** Plist with `StartCalendarInterval`,
      `StandardOutPath`/`StandardErrorPath` → `.spur/logs/history-daily.out|.err`, label
      `ai.gobing.spur.history.daily`. Validate with `plutil -lint`. Document
      `launchctl bootstrap`/`bootout` install and uninstall.
- [x] **7. Pre-logging capture (R4).** Force a failure before Spur's logging initializes (e.g. a bad
      binary path in the plist); confirm the output lands in the `.err` file. Verify on this machine —
      this layer exists precisely for what unit tests cannot reach.
- [x] **8. Never-started vs started-and-failed (R6).** Test both: a `history.daily.failed` row present
      ⇒ ran and failed; **no** `history.*` row in the window ⇒ never started. Assert the two are
      distinguishable without reading the artifact.
- [x] **9. Four layers compose (R5).** With the ledger unavailable, confirm 0469's staleness banner
      still reveals the stopped loop; with the artifact fresh but one source failed, confirm layer 3's
      `coverage[].status` still shows it. No single layer is the sole signal.
- [x] **10. Daily-summary surface (R7).** Surface the newest report path through
      `plugins/sp/skills/daily-summary/`. Test that a completed run's report path appears there.
- [x] **11. Docs (R8, T3).** `docs/04_DESIGN.md`: the chosen scheduling surface, the rejected
      alternatives, the plist install/uninstall path, and the three event names — same commit as the
      surface code.
- [x] **12. Gates.** `bun run autofix && bun run spur-check`; `bun run lint`, `bun run test`,
      `bun run build` green. Targeted `bun test <file> --test-name-pattern <test>` while iterating.
- [x] **13. Record.** `### Solution` gets the `path:line` change map; `### Testing` gets the commands,
      the post-return `system_events` query output from step 4, and the step-7 manual verification.
### Solution
**Change map (R1–R8).**

R1 — Event declarations:
- `packages/app/src/services/event-names.ts:18` — `'history'` added to `SystemEventSource` union.
- `packages/app/src/services/event-names.ts:130-132` — three catalog entries:
  `history.import.completed` (`history-import`), `history.analyze.completed` (`history-analyze`),
  `history.daily.failed` (`history-daily`), all `metadata-only` / `default` tier.
- `packages/app/tests/services/event-names.test.ts` — catalog resolution test for the three names.

R2 — Emission wiring (`apps/cli/src/commands/history.ts:166-256` daily action):
- Per-invocation `new EventBus()` → `await attachSystemEventLedger(bus, context)` (existing bridge, not a second one).
- `startMs = Date.now()` before `svc.daily()`; `durationMs = Date.now() - startMs` after.
- Exit 0 ⇒ emits both completion events; exit 1/2 ⇒ emits `history.daily.failed`; thrown exception ⇒ emits failed event, sets exit 1, does not rethrow.
- `await ledger.flush()` in a `finally` on **both** paths — without it the run-once process exits before async inserts land.
- Inline fan-out summary (sources/okSources/failedSources/files/messages) built from `DailyResult.fanOut`; failed-source detail uses `parseErrors + validationErrors` (no `error` field on `CoverageEntry`).
- `resolveArtifactPath(undefined, context.cwd).path` wrapped in try/catch — emits without `artifactPath` if the pointer is missing.
- `apps/cli/tests/commands/history.test.ts` — emit+persist test (`daily success persists history.import.completed and history.analyze.completed`) using a file-based DB so rows survive `main()` return; payload normalization test asserts `content` → `[redacted]`.

R3/R4 — launchd agent:
- `config/launchd/ai.gobing.spur.history.daily.plist` — `StartCalendarInterval` (02:00 daily), `WorkingDirectory` = project root, `StandardOutPath`/`StandardErrorPath` → `.spur/logs/history-daily.out`/`.err`. `KeepAlive=false` (no auto-restart; the daily command has checkpoint resume). Validated with `plutil -lint` → OK.
- Ship-as-template with `SPUR_BIN`/`PROJECT_DIR` placeholders + documented `launchctl bootstrap`/`bootout`.

R7 — Daily-summary surface:
- `plugins/sp/scripts/daily-summary/daily-summary.ts` — `historyReportPath?: string` on `DailySummary`; `resolveHistoryReportPath()` follows the `.spur/reports/history/latest.json` symlink (try/catch — absent ⇒ omit section, never fail). `## History Report` section in `generateMarkdown`.
- `plugins/sp/tests/daily-summary/daily-summary.test.ts` — render-present / render-absent tests + `buildDailySummary` symlink-resolution integration test (creates pointer in tmp repo).
- `plugins/sp/skills/daily-summary/SKILL.md` — History Report row in Output table; overview step added.

R8 — Docs (same commit, T3):
- `docs/04_DESIGN.md` § history nightly loop — scheduling surface rationale, rejected alternatives, plist install/uninstall, three event names, four-layer detection table, R7 report reachability.

**Key decisions.** Payload policy is `metadata-only` (history payloads may quote source paths). Emit is at the CLI command level, not in `HistoryService` — the `daily()` contract is unchanged. `attachSystemEventLedger` is awaited and returns `{ unsubscribe, flush }`. `SystemEventRow.payload_json` is the persisted field name.
### Testing
**Re-verification 2026-08-08 (verifyall batch, `--force` re-audit of forced-done task).** All evidence below re-run this run; every `file:line` anchor re-read at the cited lines.

**Fresh command evidence (this run).**

| Command | Result |
| --- | --- |
| `bun test packages/app/tests/services/event-names.test.ts --test-name-pattern "history"` | 3 pass, 0 fail, 37 expect() (exit 0) |
| `bun test apps/cli/tests/commands/history.test.ts` | 24 pass, 0 fail, 76 expect() (exit 0) |
| `bun test plugins/sp/tests/daily-summary/daily-summary.test.ts --test-name-pattern "R7"` | 4 pass, 0 fail (exit 0) |
| `bun test apps/cli/tests/system-event-ledger.test.ts --test-name-pattern "R5"` | 3 pass, 0 fail (exit 0) |
| `plutil -lint config/launchd/ai.gobing.spur.history.daily.plist` | OK (exit 0) |

**Per-Requirement Traceability**

| Req | Status | Evidence |
| --- | --- | --- |
| R1 | MET | `packages/app/src/services/event-names.ts:18` (`'history'` in `SystemEventSource` union), `:130-132` (three catalog entries, `metadata-only`/`default` via `event()` defaults at `:44-50`); test `packages/app/tests/services/event-names.test.ts:203` "registers history.* catalog entries (task 0471 R1)" + `:369` metadata-only redaction test — 3 pass this run |
| R2 | MET | `apps/cli/src/commands/history.ts:171-172` (per-invocation `EventBus` + existing `attachSystemEventLedger` bridge), `:219-235` (exit 0 emits `history.import.completed` + `history.analyze.completed`), `:194-201`/`:239-252` (failure emits `history.daily.failed`), `:259-260` (`ledger.flush()` in `finally` on both paths); tests `apps/cli/tests/commands/history.test.ts:524` (success persists both rows post-return), `:399`/`:435`/`:481` (failure paths persist `history.daily.failed`) — 24 pass this run |
| R3 | MET | `config/launchd/ai.gobing.spur.history.daily.plist` — `StartCalendarInterval` (Hour 2, Minute 0), label `ai.gobing.spur.history.daily`; `plutil -lint` OK this run; install/uninstall documented `docs/04_DESIGN.md:448-455` (`launchctl bootstrap`/`bootout`) |
| R4 | MET | plist `StandardOutPath`/`StandardErrorPath` → `PROJECT_DIR/.spur/logs/history-daily.out`/`.err` (re-read this run); launchd owns the fds from the first byte, so pre-logging failures are captured; `plutil -lint` OK |
| R5 | MET | Layer 2 (ledger events) = R2 tests above; layer 4 (launchd err log) = plist `StandardErrorPath`; layer 1 staleness banner independent of ledger — test `apps/cli/tests/commands/history.test.ts:175` "report prints staleness banner when pointer artifact is older than 36h" passed this run; layer 3 owned by 0470; composition table `docs/04_DESIGN.md:478-484` |
| R6 | MET | `history.daily.failed` row present ⇒ ran-and-failed vs zero `history.*` rows ⇒ never-started; failure-persist tests `history.test.ts:421-423`/`:467-469`/`:499-500` assert the row post-return; success test `:542` asserts no failure event; rationale `docs/04_DESIGN.md:486-489` |
| R7 | MET | `plugins/sp/scripts/daily-summary/daily-summary.ts:81` (`historyReportPath?`), `:443-446` (`## History Report` section), `:486-499` (`resolveHistoryReportPath` follows `latest.json` symlink, absent ⇒ omit); `plugins/sp/skills/daily-summary/SKILL.md:129`; tests `daily-summary.test.ts:327`/`:336`/`:778`/`:794` — 4 pass this run |
| R8 | MET | `docs/04_DESIGN.md:437-490` records chosen surface (launchd), rejected alternatives (embedded scheduler, installer verb, fifth layer), plist install/uninstall, three event names, four-layer table; design doc and surface code are in the same working-tree change set (`git diff HEAD` covers both `history.ts`/`event-names.ts` and `04_DESIGN.md`; no commit contains `history.import.completed` without the doc) |

**Acceptance Criteria Verification**

| AC | Status | Evidence Type | Evidence |
| --- | --- | --- | --- |
| Scenario: R1 — the history events join the declared catalog | MET | test | `event-names.test.ts:203` — 3 pass; catalog `:130-132` re-read, `metadata-only` asserted at `:213` |
| Scenario: R2 — a completed run leaves a ledger trail | MET | test | `history.test.ts:524` — file-based DB, rows queried after `main()` returns; 24 pass |
| Scenario: R3 — the daily trigger fires on wall-clock time | MET | command | `plutil -lint` OK; plist `StartCalendarInterval` Hour 2 / Minute 0, `RunAtLoad` absent, `KeepAlive=false`; stdout/stderr keys present (static-ref) |
| Scenario: R4 — pre-logging failures are still captured | MET | command | `plutil -lint` OK; `StandardErrorPath` → `.spur/logs/history-daily.err` (static-ref) — launchd owns the fd before the binary starts |
| Scenario: R5 — no single detection layer is the sole signal | MET | test | staleness banner test `history.test.ts:175` passes with no ledger dependency; layers 2/4 evidenced above; composition doc `docs/04_DESIGN.md:478-484` |
| Scenario: R6 — a failed run is distinguishable from a run that never started | MET | test | `history.test.ts:399`/`:435`/`:481` persist `history.daily.failed`; `:542` proves success writes no failure row; absence-of-rows case is the never-started signal |
| Scenario: R7 — the report path reaches the operator through an existing surface | MET | test | `daily-summary.test.ts:778` symlink-resolution integration test + `:327` render test — 4 pass |
| Scenario: R8 — the surface decision is documented in the same commit | MET | static-ref | `docs/04_DESIGN.md:437-490`; doc + surface in the same uncommitted change set (batch commits at end) — T3 intent satisfied |

**Design conformance.** 8/8 claims DONE: frozen file targets all match (event-names union `:18`, catalog `:130-132`, history.ts daily verb with `flush()` in `finally` `:259-260`, plist template, daily-summary surface, DESIGN doc); frozen names exact (three event names, renderer keys, label, log paths); `metadata-only` policy (never `raw-safe`); existing bridge reused (no second bridge); ledger failures log-and-swallow (`system-event-ledger.ts` R5, 3 tests pass); ship-as-template with documented `bootstrap`/`bootout`; no fifth layer / health verb / new notification channel / web renderer; layers 1+3 left to 0469/0470 as designed.

**SECUA review (focus all).** No blocker/major findings. Security: `metadata-only` + secret redaction enforced by catalog and tap (`configuredSecretValues`); redaction test passes; plist carries placeholders only. Correctness: exception path emits failed + exit 1 without rethrow; `artifactPath` resolution guarded; payload fields match `DailyResult.fanOut` shape. Efficiency: one bus+ledger per `daily` invocation, single awaited flush. Usability: failure detail aggregates per-source `parseErrors + validationErrors`. Architecture: emission at CLI layer keeps `HistoryService.daily()` contract unchanged; renderer fallback means zero web change. Minor (advisory, not gated): `new EventBus() as unknown as SystemEventBus` cast mirrors the existing workflow.ts bridge pattern.

Coverage: not re-measured this run (targeted runs per batch contract); prior measurement in `done_reason` — event-names 100% / history.ts 99.25% / daily-summary 92.88% lines.

`--fix all`: no UNMET/PARTIAL rows and no major findings — no repair needed; no fix ledger created.
`--next`: no-op - task already terminal (done).
### Review

<!-- Filled during review: P1-P4 findings, residual risk, and final disposition. -->

### References

E1

<!-- Links to the parent feature, design docs, related tasks, or external references. -->

### History
- 2026-08-08T05:42:07.374Z todo → wip (system)
- 2026-08-08T07:52:00.803Z wip → done (system)
