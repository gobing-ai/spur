---
schema_version: 1
name: Observability P4 polish follow-ups from J31 batch
status: todo
template: issue
created_at: 2026-09-07T18:51:08.761Z
updated_at: "2026-09-07T19:24:44.593Z"

priority: P3
---

## 0802. Observability P4 polish follow-ups from J31 batch

### Background

Consolidates the non-blocking P4 review residuals left by J31 tasks 0793/0794 (batch runall-j31-56a6, landed on main in df48b7900). Each finding is recorded with file:line evidence in the owning task's Review section (docs/tasks4/0793_*.md:333-336, docs/tasks4/0794_*.md:446-449) as a "fold into a later polish task" pointer; none had an owning task. Filed by the 2026-09-07 session review (--triage) so they have an owner. Direct inline fixes were deliberately not applied at review time — the surfaces are verified-and-merged code and deserved tracked, tested changes. The server-shutdown item (R2) carries the only real data-loss semantics (in-flight uncataloged persists discarded on shutdown, matching the pre-existing best-effort tap pattern).

Refined to implementation-ready depth on 2026-09-07: all seven file:line anchors re-verified against source (Root Cause), the two open either/or choices settled (Q&A D1–D3), and the design-doc sync surfaces named (R2/R3/R7 → docs/design/observabilities-module-polish.md, per T3).

### Requirements

- [ ] R1. Remove the unreachable `?? name` fallback in `genericSystemEventCatalogEntry` (packages/app/src/services/system-event-catch-all.ts:69) — `String.split` never returns an empty array; keep existing test behavior for empty-string names.
- [ ] R2. Document the best-effort, lossy-on-shutdown policy for uncataloged persists at the serve.ts catch-all attach site (apps/server/src/serve.ts:495-517) plus one sentence in the design doc — decision D1 (document, not drain); no change to the CLI path.
- [ ] R3. Record the `matchesClientFilter` export (apps/web/src/modules/observability/SystemEventsTab.tsx:604) Q3 letter-deviation as accepted in docs/design/observabilities-module-polish.md — decision D2 (keep the export); no code change.
- [ ] R4. Drop dead defaults: `timeRange = '4h'` on the required prop (apps/web/src/modules/observability/JobsTab.tsx:133) and `serializeFilter`'s `timeRange = '24h'` default (SystemEventsTab.tsx:575) whose sole production caller passes it explicitly; update the one-argument test callers (components.test.tsx:861-862).
- [ ] R5. Hoist the double `resolveApiUrl()` evaluation in RoutingTab.tsx:236-238 to one local when `since` is defined.
- [ ] R6. Narrow the tab-facing props (decision D3): remove the unused required `onTimeRangeChange` from `ObservabilityTabProps` (apps/web/src/modules/observability/tabs.ts:31), drop the shell's pass (ObservabilityShell.tsx:134), and fix the mandate comment at tabs.ts:25.
- [ ] R7. Document the per-sink drift-warn dedup Set scope (system-event-catch-all.ts:117-125) in the design doc — documentation only.

### Acceptance Criteria

- [ ] AC1. R1/R4/R5/R6 code edits land with no behavior change: `cd apps/web && bun test` and
      `cd packages/app && bun test` pass, including the updated `serializeFilter` test callers and
      the empty-string prefix test.
- [ ] AC2. `matchesClientFilter` remains exported and its tests pass unmodified; the Q3 deviation
      is recorded as accepted in `docs/design/observabilities-module-polish.md`.
- [ ] AC3. The serve.ts catch-all attach site carries a comment stating the best-effort,
      lossy-on-shutdown policy, mirrored by one sentence in the design doc; the CLI flush path
      (`system-event-ledger.ts:108-111`) is byte-identical.
- [ ] AC4. `onTimeRangeChange` no longer appears in `ObservabilityTabProps` or the shell's tab
      props; `grep -rn onTimeRangeChange apps/web/src` hits only `ObservabilityFilters.tsx` /
      `ObservabilityShell.tsx:120`; typecheck passes.
- [ ] AC5. The design doc documents the per-sink drift-warn dedup scope (R7).
- [ ] AC6. `bun run spur-check` green on the final diff; up to three focused commits (catch-all +
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
  (Root Cause); R4 has a test-caller consequence (`components.test.tsx:861-862`); R2/R3/R7 carry
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
- R4: drop both dead defaults (`JobsTab.tsx:133`, `SystemEventsTab.tsx:575`); make
  `serializeFilter`'s `timeRange` required and update the one-argument test callers
  (`components.test.tsx:861-862`) to pass it explicitly.
- R5: hoist `resolveApiUrl()` to one `const` above the ternary in `RoutingTab.tsx:236-238`.
- R6 (D3): narrow per the 0793 review's own suggestion — remove `onTimeRangeChange` from
  `ObservabilityTabProps` (`tabs.ts:31`), drop the shell's pass (`ObservabilityShell.tsx:134`,
  keeping `TimeRangePresets`' own handler at `:120`), and fix the mandate comment at `tabs.ts:25`.
- R7: one paragraph in `docs/design/observabilities-module-polish.md` documenting the per-sink
  (≈ per-process) dedup scope; documentation only.

### Plan

- [ ] 1. Catch-all + design doc commit: R1 (drop `?? name`), R3 + R7 design-doc entries
      (`docs/design/observabilities-module-polish.md`); run packages/app tests.
- [ ] 2. Server comment commit: R2 policy comment at `apps/server/src/serve.ts` catch-all attach
      site (+ design-doc sentence); no code behavior change.
- [ ] 3. Web polish commit: R4 (drop both defaults; fix `components.test.tsx:861-862` callers),
      R5 (hoist `resolveApiUrl()`), R6 (narrow `ObservabilityTabProps`, shell pass, tabs.ts:25
      comment); run apps/web tests + typecheck.
- [ ] 4. Final gate: `bun run spur-check`; verify via the task pipeline.

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
- R4 `JobsTab.tsx:133` — `timeRange = '4h'` default on a required prop (`tabs.ts:30`);
  `SystemEventsTab.tsx:575` — `serializeFilter` default `'24h'`; sole production caller passes it
  explicitly (`:831`). Test callers use one argument (`components.test.tsx:861-862`) and must be
  updated with the signature.
- R5 `RoutingTab.tsx:236-238` — `resolveApiUrl()` evaluated in both ternary branches.
- R6 `tabs.ts:31` — required `onTimeRangeChange`; no tab consumes it; only producer is the shell
  (`ObservabilityShell.tsx:134` passes `setTimeRange`); the doc comment at `tabs.ts:25` still
  mandates it.
- R7 `system-event-catch-all.ts:117-125` — drift-warn dedup `Set` is per-sink (≈ per process);
  documented in code, absent from the design doc.

Source reviews verified: 0793 Review (`docs/tasks4/0793_*.md:333-336`), 0794 Review
(`docs/tasks4/0794_*.md:446-449`) — the P4 tables match these findings one-to-one.

### Solution

<!-- Filled during implementation: file:line change map and concise rationale. -->

### Testing

<!-- Filled during verification: regression command(s), outcomes, coverage claim or N/A. -->

### Review

<!-- Filled during review: P1-P4 findings, residual risk, and final disposition. -->

### References

- Source findings: `docs/tasks4/0793_*.md:333-336` (0793 Review P4 table), `docs/tasks4/0794_*.md:446-449`
  (0794 Review P4 table); J31 batch runall-j31-56a6, merged in df48b7900.
- Design doc to update: `docs/design/observabilities-module-polish.md` (R2 policy, R3 Q3
  deviation, R7 dedup scope).
- Authority context: ADR-110 (catalog-open ingestion; the catch-all these findings polish).

### History
