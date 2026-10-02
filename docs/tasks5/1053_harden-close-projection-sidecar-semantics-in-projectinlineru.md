---
schema_version: 1
name: Harden close-projection sidecar semantics in projectInlineRunClose
status: todo
template: issue
created_at: 2026-10-02T20:15:00.291Z
updated_at: "2026-10-02T20:18:06.002Z"
feature_id: D62

priority: P2
---

## 1053. Harden close-projection sidecar semantics in projectInlineRunClose

### Background

Follow-up from task 1051's fresh-session review (recorded in 1051 ## Review, 2026-10-02): `projectInlineRunClose` (`packages/app/src/services/inline-run-setup.ts:1012-1046`) passes AC2's letter but the review reproduced four projection-semantics defects around the run-record sidecar:

- **F1 · P3** — the `...prior` spread at `:1028` keeps a prior `error` after a successful close (reproduced read-only: prior `{ok:false,error:"stale attach mismatch"}` → done close leaves `{status:"done", ok:true, error:"stale attach mismatch"}`), contradicting the function comment (`:1000-1002`) and 1051's Solution claim. Same staleness class 0948 R7 fixed for re-setup (`:945-948`). The test at `packages/app/tests/services/inline-run-driver.test.ts:601` is vacuous — its prior state never carries an error.
- **F2 · P4** — the projection catch (`:1040-1045`) leaves `${statePath}.tmp` residue on a failed rename; `writeInlineRunOutcome` cleans up per 0926 R1 (`:966-971`). The injected-failure test itself creates residue.
- **F3 · P4** — `ok:true` is hard-coded for failed/paused projections (`:1030`), silently redefining the sidecar `ok` contract 0948 R7 defined as the setup outcome, undocumented and unversioned; no production consumer of `state.ok` outside raw E7 inspection was found.
- **F4 · P4** — a missing prior sidecar yields `startedAt` = projection time (`:1033`) although the open DB at the call site can supply authoritative `runs.started_at`; rebuild-from-nothing fabricates a start time.

Direct fixes were excluded in triage: this is the shared close write path; the `ok` and `startedAt` decisions need the E7 contract owner's input before code changes.

### Requirements

- R1: On a successful close projection (done/failed/paused with `ok` semantics settled by R3), a prior sidecar `error` must not survive unless the projection contract explicitly preserves it; the surviving-error behavior and the contract must agree with the function comment.
- R2: A failed rename during projection leaves no `${statePath}.tmp` residue (parity with `writeInlineRunOutcome`'s 0926 R1 cleanup); the injected-failure test must not itself create residue.
- R3: The sidecar `ok` semantics for failed/paused terminals are decided against the 0948 R7 contract, documented at the projection site, and versioned (or proven unnecessary) — not hard-coded.
- R4: When the prior sidecar is missing, `startedAt` comes from the authoritative `runs.started_at` available at the call site, or the fallback is explicitly documented as bounded.

### Acceptance Criteria

- AC1: A test seeds a prior sidecar with `ok:false` + `error`, runs a successful close, and asserts the projected sidecar satisfies R1; fails against the current `...prior` spread.
- AC2: The injected rename-failure test asserts the working directory contains no `.tmp` residue after the failure, and the test no longer creates residue by construction.
- AC3: The `ok` field for every terminal status matches a documented, commented contract at the projection site; a test pins each terminal status's projected `ok`.
- AC4: With no prior sidecar, `startedAt` equals `runs.started_at` from the open DB (or the documented bounded fallback), asserted by a test with a seeded `runs` row.

### Q&A

<!-- Clarifications and triage decisions. Keep empty if none. -->

#### Q&A entry — 2026-10-02T20:18:06.001Z

#### Q&A entry — 2026-10-02T20:19Z

**Session review verification pass (confidence levels, HIGH/MEDIUM/LOW):**
- R1/F1 — **HIGH**: line inspection of `inline-run-setup.ts:1000-1030` is conclusive — the doc comment promises "any stale `error` dropped on success" but the plain `{...prior}` spread never deletes `error`; independent read-only repro recorded in 1051 ## Review.
- R2/F2 — **HIGH**: catch at `:1040-1045` returns without unlink; parity site `writeInlineRunOutcome:966-972` cleans up and cites 0926 R1.
- R3/F3 — **HIGH**: `ok: true` literal at `:1030` applies to done/failed/paused alike; contradicts the 0948 R7 contract comment at `:962-964` (ok = setup outcome, error only on failure).
- R4/F4 — behavior **HIGH** (`:1033` ternary fabricates projection time when prior missing); remedy feasibility **MEDIUM** — the caller committed the run row moments earlier so a `runs.started_at` read-back is feasible, but whether the emit result already carries it was not verified.

### Design

<!-- Fix approach and tradeoffs. Keep this short unless the issue changes architecture. -->

### Plan

<!-- Ordered debugging/fix checklist. Fill before moving to todo/wip. -->

### Root Cause

<!-- Verified underlying cause with file:line evidence. Fill once reproduced/isolated. -->

### Solution

<!-- Filled during implementation: file:line change map and concise rationale. -->

### Testing

<!-- Filled during verification: regression command(s), outcomes, coverage claim or N/A. -->

### Review

<!-- Filled during review: P1-P4 findings, residual risk, and final disposition. -->

### References

<!-- Links to failing logs, related issues, tasks, docs, or external references. -->

### History
