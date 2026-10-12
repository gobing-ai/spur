---
schema_version: 1
name: Consolidate inline workflow adapters on the application runtime owner
status: todo
template: feature-impl
created_at: 2026-10-12T03:34:10.718Z
updated_at: "2026-10-12T04:01:24.155Z"
feature_id: A91
priority: P1
tags:
  - script-consolidation
estimate_hours: 12

dependencies: ["1176"]
---

## 1177. Consolidate inline workflow adapters on the application runtime owner

### Background

Implements: R5 — Workflow adapters use one approved runtime persistence path.

Plan and detailed dispositions: docs/plans/2026-10-11-harness-script-consolidation.md. Scope is this vertical slice only; unrelated current edits are foreign.

**Refine corrections (2026-10-11)**

- Generic cutover required an unapproved CLI transport → current high-level app runners already exist; consolidate their packaging now and defer new public transport separately.
- Plugin bundle was treated as a separate policy implementation → source policy is already app-owned; retire the exposed low-level capability without rewriting existing runners.
- Duplicated setup/dispatch entry resolution → share resolution in existing inline-run-app loader, retaining Node-to-Bun reentry and source fixture behavior.
- All bundles could be collapsed → pure profile/planning consumers support Node; keep them independent of the SQLite runtime.

### Requirements

- [ ] R1. Consolidate inline setup/dispatch application-entry resolution in the existing loader and preserve all supported source/portable modes without introducing a CLI transport.
- [ ] R2. Remove exposed DB/DAO bundle exports after 1176 migrates the feature receipt caller; application operations retain the sole persistence implementation.
- [ ] R3. Preserve already-extracted setup, dispatch, handoff, plan, persist, quality, residual and profile behavior. Keep Node-pure bundles separate from Bun/SQLite operations and document the remaining packaging exception.
- [ ] R4. Prove isolated installed invocation, stale bundle refusal, owning project/run binding, action/trace/artifact registration and terminal close with real operation fixtures.

Out of scope: No new public CLI API: do not add/change a spur noun, verb, flag, hidden command, output/error contract or implicit automation. Use current services and the explicitly documented standalone packaging exception. Do not edit generated adapters by hand. Preserve supported installed argv and exit behavior, redaction, validation, run identities and durable evidence. No new dependency, generic runner, lock manager or unrelated refactor. Only planning sections are changed by this refinement; implementation owns Solution/Testing/Review.

### Acceptance Criteria

- [ ] AC1 — Workflow adapters use one approved runtime persistence path (req: R1)

Given the frozen supported source and installed contracts, when this slice runs against deterministic fixtures, then plugin tests inline-run-setup.test.ts, inline-run-trace.test.ts, inline-run-close-reason.test.ts and inline-run-installed.heavy.test.ts preserve behavior and prove absent/stale bundle errors before writes; app tests/services/inline-run-setup.test.ts and inline-run-driver.test.ts prove actual trace/close/artifact persistence. scripts/commands/bundle-plugin-lib.test.ts proves export removal, byte determinism and Node-pure entries; inline-pipeline-parity-check and plugin-smoke prove installed callers. Test the real app writer with isolated temp/in-memory backing; do not mock the writer carrying the AC.

### Q&A

<!-- CLOSED decisions from refinement: what was chosen and why, what was deferred and on what
     condition. Not a parking lot for open questions — an unanswered question here means the task
     is not ready to hand off. Keep empty if none. -->

#### Q&A entry — 2026-10-12T04:01:22.991Z

- Closed: no new public CLI API; canonical application services and current script contracts are sufficient for this batch.
- Closed: generated application operations remain an explicit standalone packaging exception with a single source owner, compatibility tests and no plugin DAO facade.
- Deferred owner: operator, separately approved owning-noun transport can retire the exception later. It is outside this implementation scope; --auto does not approve it.

### Design

WHAT/WHY: reduce duplicated adapter plumbing and remove the low-level persistence facade while keeping the already canonical app runtime. No new public CLI API. WHERE: `plugins/sp/lib/inline-run-app.ts`, setup/dispatch scripts, `scripts/commands/bundle-plugin-lib.ts`, focused plugin/app/bundle tests and governance §2.

Frozen internal addition: `resolveInlineAppEntry(spurBin): { entry: string; portable: boolean }` in the existing loader, used by both inline-run-setup and inline-run-dispatch. Preserve the current source command token resolution, checkout-local app selection, generated installed entry, required-function skew diagnostics and test injection seam in loadInlineApp. Source minimal-module fixtures retain their existing behavior; portable required-export checks remain strict. Node wrappers must reenter Bun before loading SQLite services. Resolve one entry before execution; never retry a mutation through a fallback after a failure.

Keep runInlineRunSetup, runInlineRunTraceMode (action/close/node-enter/actions-file), runInlineRunTraceBatch, runInlineRunDecide/Fingerprint/PersistOut, recordInlineRunAttribution and runInlineRunDispatchFailure in their current app service. Plugin entries keep argv/env/host callbacks, not persistence policy. Preserve --attribution, --dispatch-failure, --no-summary close-only validation, safe run IDs, definition fingerprints, owning tree and close behavior. idea-handoff/quality/residual/profile already delegate: audit imports/callers, do not re-extract or create an umbrella runner.

After 1176 removes plugin feature verification's raw facade, sweep every handwritten caller and remove ArtifactDao, RunDao and openInlineRunProjectDb from INLINE_RUN_EXPORTS and generated declarations. Preserve app-internal DB access and operation exports actually used by scripts. Generated bundles may contain internal persistence code; the prohibited seam is a plugin entry owning persistence via exported constructors. Keep pure plan-projection/step-profile entries Node-compatible, separate from inline Bun runtime. Regenerate deterministic bundles and Superskill twins, never edit outputs by hand.

Document this exact compatibility exception in existing governance §2: app service source owner; installed plugin needs these high-level operations because current workflow CLI has no equivalent host-inline writer contract; named current callers; isolated Node/Bun/source/skew tests; retirement only when an explicitly approved owning-noun CLI transport passes parity. No extra registry and no hidden verb. Existing installed adapters continue to work; exception is bounded packaging, not a second writer or implicit surface consent.

Dependencies and handoff: Requires 1176 high-level receipt runner and removal of plugin DAO callers (1173 conventions are transitive). Set dependency to 1176 only. Leaves canonical runtime/loader and packaging exports for 1178 summary integration; 1178 must not move DB ownership back into plugin lib.

Environment: use current Bun/TypeScript workspaces and Superskill conversion; no dependency or migration change. No wip tasks or extra worktrees existed at batch kickoff. Recheck file conflicts and generated freshness before implementation.

No new public CLI API: do not add/change a spur noun, verb, flag, hidden command, output/error contract or implicit automation. Use current services and the explicitly documented standalone packaging exception. Do not edit generated adapters by hand. Preserve supported installed argv and exit behavior, redaction, validation, run identities and durable evidence. No new dependency, generic runner, lock manager or unrelated refactor. Only planning sections are changed by this refinement; implementation owns Solution/Testing/Review.

### Plan

- [ ] 1. R1/R2: verify 1176 high-level receipt handoff and all current generated export callers; capture supported argv/source/portable fixtures and reject any unresolved low-level consumer before deleting its export.
- [ ] 2. R1: extract duplicate entry resolution to resolveInlineAppEntry in the existing loader; update setup/dispatch with unchanged mode runners, Bun reentry and fail-visible skew behavior.
- [ ] 3. R2/R3: remove unused DB/DAO export rows/declarations after caller sweep, retain needed high-level runners and separate pure bundles; regenerate bundles and twins.
- [ ] 4. R3: record the named compatibility exception and retirement condition in governance, update only live callers/refs/manifests affected by extraction; no public workflow command changes.
- [ ] 5. R4: run focused source/installed/skew/action/close tests, deterministic bundle tests, inline parity, plugin standalone/smoke and task-local gate.

### Solution

<!-- Filled during implementation: file:line change map and concise rationale. -->

### Testing

<!-- Filled during verification: commands run, outcomes, coverage claim or N/A. -->

### Review

<!-- Filled during review: P1-P4 findings, residual risk, and final disposition. -->

### References

Feature A91; ADR-130 (2026-10-11 amendment), ADR-129, ADR-065, ADR-021. Investigation: `docs/plans/2026-10-11-harness-script-consolidation.md`.

Premise sources:
- `plugins/sp/lib/inline-run-app.ts:12`
- `plugins/sp/scripts/inline-run-setup.ts:1`
- `plugins/sp/scripts/inline-run-dispatch.ts:1`
- `packages/app/src/services/inline-run-setup.ts:1245`
- `scripts/commands/bundle-plugin-lib.ts:744`
- `scripts/commands/bundle-plugin-lib.ts:809`
- `plugins/sp/scripts/idea-handoff.ts:1`
- `apps/cli/src/commands/workflow.ts:1`

### History
