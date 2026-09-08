---
schema_version: 1
name: Observability P4 polish follow-ups from J31 batch
status: done
template: issue
created_at: 2026-09-07T18:51:08.761Z
updated_at: "2026-09-08T02:15:59.027Z"

priority: P3
done_forced: "true"
done_reason: "Operator ruling (2026-09-08): accept honest PARTIAL per 0801 precedent. Verdict PARTIAL solely from AC5 evidence-rule downgrade (docs-only AC untagged in spec; implementation fully verified — review PASS, all other ACs MET with executable evidence). Force-done waives the verdict only; FSM path applied."
---

## 0802. Observability P4 polish follow-ups from J31 batch

### Background

Consolidates the non-blocking P4 review residuals left by J31 tasks 0793/0794 (batch runall-j31-56a6, landed on main in df48b7900). Each finding is recorded with file:line evidence in the owning task's Review section (docs/tasks4/0793_*.md:333-336, docs/tasks4/0794_*.md:446-449) as a "fold into a later polish task" pointer; none had an owning task. Filed by the 2026-09-07 session review (--triage) so they have an owner. Direct inline fixes were deliberately not applied at review time — the surfaces are verified-and-merged code and deserved tracked, tested changes. The server-shutdown item (R2) carries the only real data-loss semantics (in-flight uncataloged persists discarded on shutdown, matching the pre-existing best-effort tap pattern).

Refined to implementation-ready depth on 2026-09-07: all seven file:line anchors re-verified against source (Root Cause), the two open either/or choices settled (Q&A D1–D3), and the design-doc sync surfaces named (R2/R3/R7 → docs/design/observabilities-module-polish.md, per T3).

### Requirements

- [x] R1. Remove the unreachable `?? name` fallback in `genericSystemEventCatalogEntry` (packages/app/src/services/system-event-catch-all.ts:69) — `String.split` never returns an empty array; keep existing test behavior for empty-string names.
- [x] R2. Document the best-effort, lossy-on-shutdown policy for uncataloged persists at the serve.ts catch-all attach site (apps/server/src/serve.ts:495-517) plus one sentence in the design doc — decision D1 (document, not drain); no change to the CLI path.
- [x] R3. Record the `matchesClientFilter` export (apps/web/src/modules/observability/SystemEventsTab.tsx:604) Q3 letter-deviation as accepted in docs/design/observabilities-module-polish.md — decision D2 (keep the export); no code change.
- [x] R4. Drop dead defaults: `timeRange = '4h'` on the required prop (apps/web/src/modules/observability/JobsTab.tsx:133) and `serializeFilter`'s `timeRange = '24h'` default (SystemEventsTab.tsx:575) whose sole production caller passes it explicitly; update the one-argument test callers (components.test.tsx:861-862).
- [x] R5. Hoist the double `resolveApiUrl()` evaluation in RoutingTab.tsx:236-238 to one local when `since` is defined.
- [x] R6. Narrow the tab-facing props (decision D3): remove the unused required `onTimeRangeChange` from `ObservabilityTabProps` (apps/web/src/modules/observability/tabs.ts:31), drop the shell's pass (ObservabilityShell.tsx:134), and fix the mandate comment at tabs.ts:25.
- [x] R7. Document the per-sink drift-warn dedup Set scope (system-event-catch-all.ts:117-125) in the design doc — documentation only.

### Acceptance Criteria

- [x] AC1. R1/R4/R5/R6 code edits land with no behavior change: `cd apps/web && bun test` and
      `cd packages/app && bun test` pass, including the updated `serializeFilter` test callers and
      the empty-string prefix test.
- [x] AC2. `matchesClientFilter` remains exported and its tests pass unmodified; the Q3 deviation
      is recorded as accepted in `docs/design/observabilities-module-polish.md`.
- [x] AC3. The serve.ts catch-all attach site carries a comment stating the best-effort,
      lossy-on-shutdown policy, mirrored by one sentence in the design doc; the CLI flush path
      (`system-event-ledger.ts:108-111`) is byte-identical.
- [x] AC4. `onTimeRangeChange` no longer appears in `ObservabilityTabProps` or the shell's tab
      props; `grep -rn onTimeRangeChange apps/web/src` hits only `ObservabilityFilters.tsx` /
      `apps/web/src/modules/observability/ObservabilityShell.tsx:120`; typecheck passes.
- [x] AC5. The design doc documents the per-sink drift-warn dedup scope (R7).
- [x] AC6. `bun run spur-check` green on the final diff; up to three focused commits (catch-all +
      design doc, server comment, web polish).

### Q&A

<!-- Clarifications and triage decisions. Keep empty if none. -->

#### Q&A entry — 2026-09-07T19:20:36.917Z

Refinement decisions (2026-09-07) — the two open either/or choices in the filed requirements are
now settled:

- **D1 (R2) — document, not drain.** Server discards the cataloged tap handle too
  (`serve.ts:504-508`); draining only the catch-all would not close the loss window and would
  introduce the asymmetry 0794 deliberately avoided. A real graceful-shutdown drain for the whole
  server event plane is out of scope here.
- **D2 (R3) — accept and record, not un-export.** Testing through the module surface would force
  DOM renders for a pure function; the export is behavior-inert and was praised by the 0794
  review. The fix is honesty: record the Q3 deviation as accepted in the design doc.
- **D3 (R6) — narrow the props.** Follows the 0793 review's explicit suggestion ("a later task
  could narrow the tab-facing props"); the shell keeps its own `setTimeRange` for
  `TimeRangePresets`.
- **Dependencies/premises.** No prerequisite tasks; do not start before the J31 batch merge
  (df48b7900) — already on main. Premises: all seven file:line anchors re-verified on 2026-09-07
  (Root Cause); R4 has a test-caller consequence (`apps/web/tests/modules/observability/components.test.tsx:861-862`); R2/R3/R7 carry
  the design-doc sync in the same commits per T3.
- **No feature link.** Polish register spanning J31 residuals; the L4 missing-feature_id advisory
  is accepted deliberately (same disposition as task 0801 D4).

### Design

Per-finding approach (decisions D1–D3 in Q&A are settled here):

- R1: delete `?? name`; behavior is identical for all inputs including `''` (split yields `['']`).
  Keep the existing empty-string test as the regression pin.
- R2 (D1): document, do not drain. The cataloged tap is equally undrained on the server
  (`serve.ts:504-508`), so a catch-all-only drain buys no real durability and adds asymmetry;
  a genuine graceful-shutdown drain is separate scope. Add a short comment at the serve.ts
  catch-all attach site stating the best-effort/lossy-on-shutdown policy, and one sentence in
  `docs/design/observabilities-module-polish.md`. CLI path untouched.
- R3 (D2): keep the export; record the Q3 letter-deviation as accepted in
  `docs/design/observabilities-module-polish.md` (pure-function test surface, behavior-inert —
  the 0794 review itself rated it an improvement). No code change.
- R4: drop both dead defaults (`apps/web/src/modules/observability/JobsTab.tsx:133`, `apps/web/src/modules/observability/SystemEventsTab.tsx:575`); make
  `serializeFilter`'s `timeRange` required and update the one-argument test callers
  (`apps/web/tests/modules/observability/components.test.tsx:861-862`) to pass it explicitly.
- R5: hoist `resolveApiUrl()` to one `const` above the ternary in `apps/web/src/modules/observability/RoutingTab.tsx:236-238`.
- R6 (D3): narrow per the 0793 review's own suggestion — remove `onTimeRangeChange` from
  `ObservabilityTabProps` (`apps/web/src/modules/observability/tabs.ts:31`), drop the shell's pass (`apps/web/src/modules/observability/ObservabilityShell.tsx:134`,
  keeping `TimeRangePresets`' own handler at `:120`), and fix the mandate comment at `apps/web/src/modules/observability/tabs.ts:25`.
- R7: one paragraph in `docs/design/observabilities-module-polish.md` documenting the per-sink
  (≈ per-process) dedup scope; documentation only.

### Plan

- [x] 1. Catch-all + design doc commit: R1 (drop `?? name`), R3 + R7 design-doc entries
      (`docs/design/observabilities-module-polish.md`); run packages/app tests.
- [x] 2. Server comment commit: R2 policy comment at `apps/server/src/serve.ts` catch-all attach
      site (+ design-doc sentence); no code behavior change.
- [x] 3. Web polish commit: R4 (drop both defaults; fix `apps/web/tests/modules/observability/components.test.tsx:861-862` callers),
      R5 (hoist `resolveApiUrl()`), R6 (narrow `ObservabilityTabProps`, shell pass, tabs.ts:25
      comment); run apps/web tests + typecheck.
- [x] 4. Final gate: `bun run spur-check`; verify via the task pipeline.

### Root Cause

All seven anchors verified against source on 2026-09-07 (none stale):

- R1 `packages/app/src/services/system-event-catch-all.ts:69` — `prefix: name.split('.')[0] ?? name`;
  `String.split` never returns `[]`, so the fallback is dead in every case including `''`.
- R2 `apps/cli/src/system-event-ledger.ts:108-111` — CLI `flush()` drains tap AND catch-all;
  `apps/server/src/serve.ts:495-517` discards both handles (tap at :504-508, catch-all at
  :511-517) — the server has no shutdown drain for either sink.
- R3 `apps/web/src/modules/observability/SystemEventsTab.tsx:604` — `matchesClientFilter` exported;
  imported only by `apps/web/tests/modules/observability/system-events-tab.test.ts:7` (production
  uses are internal: `:933`, `:988`). Export exists solely for the task-0794 R7 test.
- R4 `apps/web/src/modules/observability/JobsTab.tsx:133` — `timeRange = '4h'` default on a required prop (`apps/web/src/modules/observability/tabs.ts:30`);
  `apps/web/src/modules/observability/SystemEventsTab.tsx:575` — `serializeFilter` default `'24h'`; sole production caller passes it
  explicitly (`:831`). Test callers use one argument (`apps/web/tests/modules/observability/components.test.tsx:861-862`) and must be
  updated with the signature.
- R5 `apps/web/src/modules/observability/RoutingTab.tsx:236-238` — `resolveApiUrl()` evaluated in both ternary branches.
- R6 `apps/web/src/modules/observability/tabs.ts:31` — required `onTimeRangeChange`; no tab consumes it; only producer is the shell
  (`apps/web/src/modules/observability/ObservabilityShell.tsx:134` passes `setTimeRange`); the doc comment at `apps/web/src/modules/observability/tabs.ts:25` still
  mandates it.
- R7 `system-event-catch-all.ts:117-125` — drift-warn dedup `Set` is per-sink (≈ per process);
  documented in code, absent from the design doc.

Source reviews verified: 0793 Review (`docs/tasks4/0793_*.md:333-336`), 0794 Review
(`docs/tasks4/0794_*.md:446-449`) — the P4 tables match these findings one-to-one.

### Solution

Implementation notes — task 0802. Three of the seven requirements were already
landed on main before this run began and required no new edit (verified against
source and git history; recorded here for honesty, not re-applied):

- R1 (drop `?? name` in `genericSystemEventCatalogEntry`) — landed in commit
  `6e5bc4aae` ("derive uncataloged event prefix without dead fallback"): the
  source now uses `name.replace(/\..*/, '')`, which needs neither the index nor
  the fallback and is behavior-identical for all inputs including `''`. The
  catch-all test suite (`packages/app/tests/services/system-event-catch-all.test.ts`)
  pins the prefix derivation (first dot-segment, no-dot fallback, severity default).
- R4 (drop dead time-range defaults + test callers) — landed in commit
  `8a101d1a7` ("drop dead time-range defaults, hoist routing base URL"):
  `apps/web/src/modules/observability/JobsTab.tsx:133` no longer defaults `timeRange`, `serializeFilter`'s
  `timeRange` is required, and the one-argument test callers in
  `apps/web/tests/modules/observability/components.test.tsx:861-862` pass `'24h'` explicitly.
- R5 (hoist double `resolveApiUrl()` in RoutingTab) — landed in the same
  commit `8a101d1a7`: `apps/web/src/modules/observability/RoutingTab.tsx:236-238` now resolves `baseUrl` once.

The four remaining items (R2, R3, R6, R7) were implemented in this run:

| File:line | Change |
| --- | --- |
| apps/web/src/modules/observability/tabs.ts:29 | R6: removed the unused required `onTimeRangeChange` from `ObservabilityTabProps` |
| apps/web/src/modules/observability/tabs.ts:25 | R6: fixed the mandate comment — the shell owns `timeRange`; tabs only consume it |
| apps/web/src/modules/observability/ObservabilityShell.tsx:132 | R6: dropped the shell's `onTimeRangeChange={setTimeRange}` pass to the active tab |
| apps/web/tests/modules/observability/summary-tab.test.tsx:127 | R6 consequence: removed `onTimeRangeChange={() => {}}` from 7 `SummaryTab` renders |
| apps/web/tests/modules/observability/routing-tab.test.tsx:16 | R6 consequence: removed `onTimeRangeChange` from `baseProps` + 3 renders |
| apps/web/tests/modules/observability/jobs-tab.test.tsx | R6 consequence: removed `onTimeRangeChange={() => {}}` from `JobsTab` renders |
| apps/web/tests/modules/observability/components.test.tsx:34 | R6 consequence: removed `onTimeRangeChange` from `tabProps` (spread into `SystemEventsTab`) |
| apps/server/src/serve.ts:511 | R2 (D1): comment at the catch-all attach site stating the best-effort, lossy-on-shutdown policy; documented, not drained |
| docs/design/observabilities-module-polish.md:69 | R2 (D1): one sentence mirroring the lossy-on-shutdown policy in the design doc |
| docs/design/observabilities-module-polish.md:81 | R7: per-sink (≈ per-process) drift-warn dedup `Set` scope documented |
| docs/design/observabilities-module-polish.md:95 | R3 (D2): `matchesClientFilter` Q3 letter-deviation recorded as accepted (kept exported) |

Rationale: R6 narrows the tab-facing props per the 0793 review's own suggestion
(decision D3) — no tab consumes `onTimeRangeChange`; the shell keeps
`TimeRangePresets`' own handler. R2 documents rather than drains (decision D1):
the cataloged tap is equally undrained on the server, so a catch-all-only drain
buys no real durability and adds asymmetry; the CLI ledger path remains the
durable seam. R3 records the accepted export rather than un-exporting (decision
D2): the pure function is behavior-inert when exported and testing through the
module surface would force DOM renders. R7 documents the existing dedup scope.
All changes are documentation-only or prop-narrowing — no runtime behavior
change, which AC1 requires.

### Testing

**Pipeline verify results**

- Verdict: PARTIAL (from verdict artifact)

| Requirement | Status | Evidence |
|-------------|--------|----------|
| R1 | MET | `packages/app/src/services/system-event-catch-all.ts:69` — `prefix: name.replace(/\..*/, '')`; the `?? name` fallback is gone (landed in ancestor 6e5bc4aae, confirmed ancestor of HEAD; sole file in that commit). Behavior identity verified programmatically this run for `''`, `a`, `a.b`, `a.b.c`, `.a`, `daemonbeat`, `db.connection.error` — all SAME. Tests pin first-dot + no-dot fallback: `packages/app/tests/services/system-event-catch-all.test.ts:85-87,100-101`; `cd packages/app && bun test` → 2702 pass / 0 fail this run. |
| R2 | MET | Comment at the catch-all attach site: `apps/server/src/serve.ts:511-517` — states best-effort, lossy-on-shutdown policy (D1, documented-not-drained); design-doc sentence: `docs/design/observabilities-module-polish.md:69-72`; CLI flush path `apps/cli/src/system-event-ledger.ts:108-111` byte-identical (git diff: 0 files match system-event-ledger). |
| R3 | MET | `matchesClientFilter` still exported: `apps/web/src/modules/observability/SystemEventsTab.tsx:604`; imported by the 0794 R7 test (`apps/web/tests/modules/observability/system-events-tab.test.ts:7`, tier-visibility tests `:410-436`); Q3 letter-deviation recorded as accepted: `docs/design/observabilities-module-polish.md:95-103` (D5). |
| R4 | MET | `apps/web/src/modules/observability/JobsTab.tsx:133` — `export default function JobsTab({ timeRange, onNavigate }: ObservabilityTabProps)` — no `timeRange = '4h'` default; `apps/web/src/modules/observability/SystemEventsTab.tsx:575` — `serializeFilter(filter, timeRange: ObservabilityTimeRange)` — `timeRange` required, no `'24h'` default; sole production caller passes explicitly (`apps/web/src/modules/observability/SystemEventsTab.tsx:831`); one-argument test callers updated to pass `'24h'` (`apps/web/tests/modules/observability/components.test.tsx:862,864`). Landed in ancestor 8a101d1a7, confirmed ancestor of HEAD. |
| R5 | MET | `apps/web/src/modules/observability/RoutingTab.tsx:236-238` — `const baseUrl = resolveApiUrl()` hoisted to one local above the ternary; both branches use `baseUrl` (landed in ancestor 8a101d1a7). |
| R6 | MET | `apps/web/src/modules/observability/tabs.ts:29-33` — `onTimeRangeChange` removed from `ObservabilityTabProps` (only `onLivenessChange?`, `timeRange`, `onNavigate?`); mandate comment fixed at `apps/web/src/modules/observability/tabs.ts:24-26`; shell pass dropped — `apps/web/src/modules/observability/ObservabilityShell.tsx:131` renders `<Active onLivenessChange={...} timeRange={timeRange} onNavigate={...} />` with no `onTimeRangeChange`; shell keeps its own `TimeRangePresets` handler at `:120`. All four consumers destructure only the narrowed interface (SystemEventsTab.tsx:773, SummaryTab.tsx:109, RoutingTab.tsx:229, JobsTab.tsx:133); web typecheck exit 0 this run. Test-caller updates: `apps/web/tests/modules/observability/components.test.tsx:34`, `apps/web/tests/modules/observability/summary-tab.test.tsx`, `apps/web/tests/modules/observability/routing-tab.test.tsx:16`, `apps/web/tests/modules/observability/jobs-tab.test.tsx` — all `onTimeRangeChange={() => {}}` removals verified in diff; 0 lingering hits in apps/web/tests. |
| R7 | MET | Design doc documents the per-sink (approx per-process) drift-warn dedup `Set` scope: `docs/design/observabilities-module-polish.md:81-85`; source confirms `driftWarned = new Set<string>()` lives inside `createSystemEventCatchAllSink` (`packages/app/src/services/system-event-catch-all.ts:117-125`). |

| Acceptance Criteria | Status | Evidence Type | Evidence |
|---------------------|--------|---------------|----------|
| AC1. | MET | command | Fresh this run: `cd apps/web && bun test` → 760 pass / 0 fail; `cd packages/app && bun test` → 2702 pass / 0 fail. serializeFilter test callers pass `'24h'` explicitly (`components.test.tsx:862,864`); R1 empty-string prefix behavior preserved (programmatic SAME check this run). R1/R4/R5/R6 are no-runtime-behavior-change edits. |
| AC2. | MET | test | `matchesClientFilter` exported (`apps/web/src/modules/observability/SystemEventsTab.tsx:604`); tests pass unmodified in the web suite (`apps/web/tests/modules/observability/system-events-tab.test.ts:410-436`, included in this run's 760 pass); Q3 deviation recorded as accepted at `docs/design/observabilities-module-polish.md:95-103`. |
| AC3. | MET | command | Comment at `apps/server/src/serve.ts:511-517`; design-doc sentence at `docs/design/observabilities-module-polish.md:69-72`; CLI flush path byte-identical (`apps/cli/src/system-event-ledger.ts:108-111`; `git diff --name-only` shows 0 files matching system-event-ledger). |
| AC4. | MET | command | `grep -rn onTimeRangeChange apps/web/src` → only `ObservabilityFilters.tsx:49,57,70` + `apps/web/src/modules/observability/ObservabilityShell.tsx:120` (exactly the required set); absent from `ObservabilityTabProps` (`apps/web/src/modules/observability/tabs.ts:29-33`) and shell tab props (`apps/web/src/modules/observability/ObservabilityShell.tsx:131`); web typecheck exit 0 this run (`bunx tsc --noEmit`). |
| AC5. | PARTIAL | static-ref | `docs/design/observabilities-module-polish.md:81-85` documents the per-sink drift-warn dedup scope (R7). |
| AC6. | MET | command | Recorded gate `.spur/run/0802-test-gate.log`: link-check OK, biome "No fixes applied", typecheck all 7 workspaces exit 0, 44 pre + 2 post rules passed, full `bun test` → 7701 pass / 0 fail; `.spur/run/0802-test-gate.status` = PASS, findings empty. Note: diff uncommitted at verify time — the "up to three focused commits" structure is a wrap-stage action, not a verify blocker. |
- Coverage: N/A (verdict-based; verify pipeline does not measure code coverage)

### Review

Verdict: **PASS** (all P4; no P1–P3). Three-dimensional review of the combined 0802 state (base + working-tree diff) — functional traceability + SECUA + architecture — run with `--auto`. Scope: the 9-file working-tree diff (R2/R3/R6/R7) plus the pre-landed R1/R4/R5 ancestors (`6e5bc4aae`, `8a101d1a7`, both confirmed ancestors of HEAD). All `file:line` evidence re-read this run; AC1 test commands re-run fresh this turn (web 760 pass, app 2702 pass, full suite 7701 pass).

| Priority | Dimension | Location | Finding |
| --- | --- | --- | --- |
| P4 | SECUA (correctness, docs) | `apps/server/src/serve.ts:512` | New R2 comment says "like the cataloged tap below" — the cataloged tap (`registerSystemEventTap`) is registered ABOVE the comment (`serve.ts:501-506`), not below. Directional wording slip in the R2 documentation deliverable; the policy statement itself is accurate. Should read "above" (or cite `:501-506`). Advisory; no behavior impact. |
| P4 | SECUA (test coverage, honesty) | `packages/app/tests/services/system-event-catch-all.test.ts:84-101` | Task Design says "keep the existing empty-string test as the regression pin" (R1), but no explicit empty-string test exists — only the no-dot fallback (`daemonbeat` → `daemonbeat`) pins prefix derivation. Behavior is provably identical for `''` (verified programmatically: `''.replace(/\..*/, '')` === `''.split('.')[0] ?? name` === `''`), so this is a documentation-vs-reality gap in the task spec's Design section, not a functional miss. An explicit `''` regression pin would harden R1. Advisory. |
| P4 | Architecture (residual, accepted) | `apps/server/src/serve.ts:511-517` | Server has no graceful-shutdown drain for uncataloged persists (nor the cataloged tap) — in-flight rows are discarded on process exit. Documented, not drained per D1; the CLI ledger path (`apps/cli/src/system-event-ledger.ts:108-111`) drains both. A real graceful-shutdown drain is separate scope. Recorded as the accepted residual; do not silently reopen. |

#### Per-requirement traceability

| Req | Status | Evidence |
| --- | --- | --- |
| R1 | MET | `packages/app/src/services/system-event-catch-all.ts:69` — `prefix: name.replace(/\..*/, '')`; the `?? name` fallback is gone (landed in ancestor `6e5bc4aae`; only file in that commit). Behavior-identity verified programmatically this run for `''`, `a`, `a.b`, `a.b.c`, `.a`, `daemonbeat`, `db.connection.error` — all SAME. Tests pin first-dot + no-dot fallback: `packages/app/tests/services/system-event-catch-all.test.ts:86,101`; `cd packages/app && bun test` → 2702 pass this run. |
| R2 | MET | Comment at the catch-all attach site: `apps/server/src/serve.ts:511-517` — states best-effort, lossy-on-shutdown policy (D1, documented-not-drained); design-doc sentence: `docs/design/observabilities-module-polish.md:69`; CLI flush path `apps/cli/src/system-event-ledger.ts:108-111` byte-identical (git diff: 0 files match system-event-ledger). |
| R3 | MET | `matchesClientFilter` still exported: `apps/web/src/modules/observability/SystemEventsTab.tsx:604`; imported only by the 0794 R7 test (`apps/web/tests/modules/observability/system-events-tab.test.ts:7`, tier-visibility tests `:410-436`); Q3 letter-deviation recorded as accepted: `docs/design/observabilities-module-polish.md:95` (D5). |
| R4 | MET | `apps/web/src/modules/observability/JobsTab.tsx:133` — `export default function JobsTab({ timeRange, onNavigate }: ObservabilityTabProps)` — no `timeRange = '4h'` default; `apps/web/src/modules/observability/SystemEventsTab.tsx:575` — `serializeFilter(filter, timeRange: ObservabilityTimeRange)` — `timeRange` required, no `'24h'` default; sole production caller passes explicitly (`apps/web/src/modules/observability/SystemEventsTab.tsx:831`); test callers updated to pass `'24h'` (`apps/web/tests/modules/observability/components.test.tsx:862,864`). Landed in ancestor `8a101d1a7`. |
| R5 | MET | `apps/web/src/modules/observability/RoutingTab.tsx:236-238` — `const baseUrl = resolveApiUrl()` hoisted to one local above the ternary; both branches use `baseUrl` (landed in ancestor `8a101d1a7`). |
| R6 | MET | `apps/web/src/modules/observability/tabs.ts:29-33` — `onTimeRangeChange` removed from `ObservabilityTabProps` (only `onLivenessChange?`, `timeRange`, `onNavigate?`); mandate comment fixed at `apps/web/src/modules/observability/tabs.ts:24-25`; shell's pass dropped — `apps/web/src/modules/observability/ObservabilityShell.tsx:131` renders `<Active onLivenessChange={...} timeRange={timeRange} onNavigate={...} />` with no `onTimeRangeChange`; shell keeps its own `TimeRangePresets` handler at `:120`. All four consumers (SystemEventsTab:773, SummaryTab:109, RoutingTab:229, JobsTab:133) destructure only the narrowed interface; typecheck green. Test-caller updates: `apps/web/tests/modules/observability/components.test.tsx:34` (tabProps), `apps/web/tests/modules/observability/summary-tab.test.tsx`, `apps/web/tests/modules/observability/routing-tab.test.tsx:16`, `apps/web/tests/modules/observability/jobs-tab.test.tsx` — all `onTimeRangeChange={() => {}}` removals verified in diff. |
| R7 | MET | Design doc documents the per-sink (≈ per-process) drift-warn dedup `Set` scope: `docs/design/observabilities-module-polish.md:81`; source confirms `driftWarned = new Set<string>()` lives inside `createSystemEventCatchAllSink` (`packages/app/src/services/system-event-catch-all.ts:117-125`). |

#### Acceptance Criteria Verification

| AC | Status | Evidence Type | Evidence |
| --- | --- | --- | --- |
| AC1 | MET | command (fresh) | `cd apps/web && bun test` → 760 pass / 0 fail (this run); `cd packages/app && bun test` → 2702 pass / 0 fail (this run); serializeFilter test callers pass `'24h'` (`components.test.tsx:862,864`); empty-string prefix behavior preserved (programmatic SAME check). R1/R4/R5/R6 are no-runtime-behavior-change edits. |
| AC2 | MET | test + file | `matchesClientFilter` exported (`apps/web/src/modules/observability/SystemEventsTab.tsx:604`), tests pass unmodified in web suite (`apps/web/tests/modules/observability/system-events-tab.test.ts:410-436` included in 760 pass); Q3 deviation recorded accepted at `docs/design/observabilities-module-polish.md:95`. |
| AC3 | MET | file | Comment at serve.ts:511-517; design-doc sentence at `:69`; CLI flush path byte-identical (`system-event-ledger.ts:108-111`; git diff shows 0 files matching). |
| AC4 | MET | command + grep | `grep -rn onTimeRangeChange apps/web/src` → only `ObservabilityFilters.tsx:49,57,70` + `apps/web/src/modules/observability/ObservabilityShell.tsx:120` (exactly as required); absent from `ObservabilityTabProps` (`apps/web/src/modules/observability/tabs.ts:29-33`) and shell tab props (`apps/web/src/modules/observability/ObservabilityShell.tsx:131`); typecheck all 7 workspaces exit 0 (`test-gate.log:19-25`). |
| AC5 | MET | file | `docs/design/observabilities-module-polish.md:81` documents per-sink dedup scope. |
| AC6 | MET | command (recorded) | `bun run spur-check` chain green in `.spur/run/0802-test-gate.log`: link-check OK, biome lint "No fixes applied", typecheck all 0, 44 pre + 2 post rules passed, full `bun test` → 7701 pass / 0 fail; `0802-test-gate.status` = PASS, findings empty. Note: diff is uncommitted at review time — the "up to three focused commits" structure is a wrap-stage action, not a review blocker. |

#### Q&A closed decisions — honored

| Decision | Verdict | Evidence |
| --- | --- | --- |
| D1 (R2) — document, not drain | Honored | serve.ts:511-517 comment + design doc :69; CLI flush path untouched; no drain added. |
| D2 (R3) — accept and record, not un-export | Honored | `matchesClientFilter` kept exported (`apps/web/src/modules/observability/SystemEventsTab.tsx:604`); D5 recorded at design doc :95. |
| D3 (R6) — narrow the props | Honored | `onTimeRangeChange` removed from `ObservabilityTabProps` (`apps/web/src/modules/observability/tabs.ts:29-33`); shell keeps `setTimeRange` for `TimeRangePresets` (`ObservabilityShell.tsx:19,120`). |

#### SECUA summary

- **Security:** no new surface — diff removes a prop and adds comments/docs; no secrets, no injection, no I/O change. N/A.
- **Efficiency:** R5 hoist landed upstream; working-tree diff has no efficiency delta.
- **Correctness:** prop narrowing verified against all four consumers; typecheck + web/app suites green. One P4 comment-direction slip (serve.ts:512 "below" → should be "above").
- **Usability:** tabs.ts:24-25 mandate comment clarified; design doc now honestly records three accepted deviations (D1 shutdown, D2 export, D3 props). Good.
- **Architecture:** surface narrowed per the 0793 review's own suggestion; no coupling or locality regression; accepted residuals documented rather than hidden. Scope clean — every diff hunk maps to R2/R3/R6/R7 or their test consequences; no scope creep (all 9 modified files accounted for; no untracked files).

Residual risk: server-side in-flight uncataloged persists remain lossy on shutdown (accepted D1, documented, separate scope); no explicit empty-string regression pin for R1 (P4 advisory). These do not block the pipeline gate.

Disposition: all seven requirements MET, all six ACs MET, no P1–P3 findings — review **PASS** clears this task for the pipeline's `record → done` hop.

### References

- Source findings: `docs/tasks4/0793_*.md:333-336` (0793 Review P4 table), `docs/tasks4/0794_*.md:446-449`
  (0794 Review P4 table); J31 batch runall-j31-56a6, merged in df48b7900.
- Design doc to update: `docs/design/observabilities-module-polish.md` (R2 policy, R3 Q3
  deviation, R7 dedup scope).
- Authority context: ADR-110 (catalog-open ingestion; the catch-all these findings polish).

### History

- 2026-09-08T01:00:49.036Z todo → wip (system)
- 2026-09-08T02:04:50.019Z wip → testing (system)
- 2026-09-08T02:15:59.022Z testing → done (system)

