---
schema_version: 1
name: Harden close-projection sidecar semantics in projectInlineRunClose
status: todo
template: issue
created_at: 2026-10-02T20:15:00.291Z
updated_at: "2026-10-02T20:44:30.888Z"
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

**Per-finding approach** (decide-then-implement; owner-confirm marked where contract-level):

- **F1 (stale error)**: after building `state`, delete the `error` key on every *successful* projection regardless of `status` — mirror of the 0948 R7 rule at `inline-run-setup.ts:962-964` ("a successful re-setup explicitly drops any prior `error`"). The sidecar then carries no `error` after any committed close; run-level failure semantics stay in `status` + DB `terminal_reason`, not in the sidecar. *Rejected*: keeping prior error for failed/paused closes (mixes setup-era error with the terminal status — ambiguous for E7 readers). **Owner-confirm**: the invariant "error absent after any successful projection" is the proposal; get E7 owner sign-off before coding.
- **F2 (.tmp residue)**: wrap `writeFileSync`+`renameSync` in try and clean the temp in the failure path, mirroring `writeInlineRunOutcome:972-975` (0926 R1: "never leaves `.tmp` residue"). Best-effort unlink — a failing unlink must not mask the returned replay-guidance detail.
- **F3 (ok semantics)**: proposed contract — `ok` = *sidecar projection integrity* (write succeeded), NOT run outcome (run outcome is `status`). Under this reading the `ok: true` literal becomes correct but must be documented at `:1030` with a comment citing this contract + the 0948 R7 origin, and pinned by a test per terminal status. *Rejected alternative*: `ok:false` for failed/paused runs — duplicates `status`, adds a second failure channel, and would silently change what `run-record.ts` readers see (`:140-141` already classify per shape, not per ok). **Owner-confirm** before coding.
- **F4 (startedAt)**: **Implementation step 0 — inspect what the emit result carries** at the `runInlineRunTrace` call site (`inline-run-setup.ts:1188-1194`): if the close emit result exposes the committed `runs.started_at`, thread it into `projectInlineRunClose` as an optional param and use it as the fallback seed (preferred — keeps the function fs-only, no DB handle). If it does not, either extend the emit result or keep the projection-time fallback with an explicit bounded-fallback comment and an AC4 test seeded with a `runs` row asserting the documented behavior. Do not open a DB handle inside `projectInlineRunClose` (the service layer is fs-only by design).

**Cross-cutting constraints:**
- Keep `{schemaVersion: 1}`. `run-record.ts:124-141` classifies `state-invalid` vs `state-missing` by shape; a v2 bump changes E7 inspection results for pre-existing on-disk sidecars — out of scope.
- The DB commit always stands (0975 R2 zero-action guard + AC2's "commit stands" test at `inline-run-driver.test.ts:796`): the projection stays best-effort-with-loud-failure — failure returns the replay-guidance string, never throws, never blocks the committed close.
- Preserve the repair-by-replay contract: re-running the same close must converge (AC2 test `:781-807` must stay green).
- The installed twin `plugins/sp/scripts/inline-run-setup.ts` mirrors this source — regenerate via `bun run build:scripts` and commit together (1051 precedent, commit `e6829ec3a`), then `script-contract-check`.

### Plan

1. Owner sign-off on the two marked decisions in Design (F1 error-drop invariant; F3 ok contract). Do not proceed on assumptions.
2. Step 0 from Design F4: inspect the emit-result shape at `inline-run-setup.ts:1188-1194` for `started_at`; pick param-threading vs documented fallback.
3. Implement F1+F2+F3 in `projectInlineRunClose` (`inline-run-setup.ts:1012-1046`) — one cohesive edit: drop `error` after successful projection, temp cleanup in failure path, `ok` contract comment.
4. Implement F4 per step-0 outcome.
5. Tests (see AC↔test mapping below) in `packages/app/tests/services/inline-run-driver.test.ts` close-describe block; reuse `makeProject`/`inDir`/`setupRun`/`recordAction`/`readRunState`; injection seam for AC2-style failure = replace the `.state.json` path with a directory (`:784-785`).
6. Replace the vacuous prior-state assertion at `:604` (its fixture never carried an `error`) with an error-carrying prior.
7. `bun run build:scripts`, commit installed twin with source.
8. Focused: `(cd packages/app && bun test tests/services/inline-run-driver.test.ts)` → then full `bun run spur-check` (repo gate, 4-space biome, per-workspace typecheck).

### Root Cause

Verified by line inspection 2026-10-02 (session review pass; all HIGH except F4-remedy MEDIUM):
- F1: doc comment `:1000-1002` promises "any stale `error` dropped on success"; the plain `{...prior}` spread at `:1023` never deletes `error` — no conditional path exists. Independent read-only repro in 1051 ## Review.
- F2: catch at `:1040-1045` returns the replay detail without unlinking `temp`; parity site `writeInlineRunOutcome:966-975` cleans up citing 0926 R1.
- F3: `ok: true` literal at `:1030` applies to done/failed/paused alike; 0948 R7 contract comment at `:962-964` defines `ok` as the *setup* outcome with `error` present only when `ok === false` — undocumented divergence.
- F4: `:1033` ternary `typeof prior.startedAt === 'string' ? prior.startedAt : at` fabricates projection time when the prior sidecar is missing. Remedy feasibility MEDIUM: whether the close emit result carries `runs.started_at` unverified (Design step 0).

### Solution

<!-- Filled during implementation: file:line change map and concise rationale. -->

### Testing

<!-- Filled during verification: regression command(s), outcomes, coverage claim or N/A. -->

### Review

<!-- Filled during review: P1-P4 findings, residual risk, and final disposition. -->

### References

- Origin: task 1051 AC2 (`projectInlineRunClose` introduced); review findings F1–F4 in 1051 `## Review`.
- Contracts: 0948 R7 (setup sidecar `ok`/`error` semantics, `inline-run-setup.ts:962-964`); 0926 R1 (`.tmp` cleanup, `:972-975`); 0925 R1 (atomic same-directory temp+rename publish); 0975 R2 (zero-action done guard — adjacent at `:1195-1200`, must keep working); E7 / 0926 (pair-record inspection reader, `packages/app/src/workflow/run-record.ts:99-141`).
- Tests pinning current behavior: `packages/app/tests/services/inline-run-driver.test.ts` — AC1 projection `:604`, AC2 inject+replay `:781-807`, installed-twin parity `:199-215`.
- Session evidence: verification Q&A entry (this task), findings table with confidence levels.

### History
