---
schema_version: 1
name: task record must re-pull newer verdict artifact; refresh done_reason on re-close
status: todo
template: issue
created_at: 2026-10-01T18:14:27.154Z
updated_at: "2026-10-01T18:19:31.733Z"

feature_id: F91
---

## 1040. task record must re-pull newer verdict artifact; refresh done_reason on re-close

### Background

**Origin.** Filed from the active session review (2026-10-01, `--triage`) after the inline pipeline for task 1039 hit the record-before-verdict trap, and task 1038's reopen→remediate→re-close left stale frontmatter. Enriched the same day with verified code anchors to pin the implementation and prevent fixing drift.

**Problem 1 — record never re-pulls the verdict artifact.** `spur task record <wbs>` reads `.spur/run/<wbs>-verdict.json` once and writes Testing/Review from it. Missing and malformed artifacts both collapse to the same sentinel: `verdict: 'UNKNOWN'` with empty arrays (`packages/app/src/services/task-record.ts:121`, `:135` — "Returns UNKNOWN on missing/malformed file. Never throws."). The record step then writes that UNKNOWN state into the task's Testing section. When the verdict step runs *after* record, nothing tells record to look again: re-running record does re-read the artifact, but no pipeline ordering enforces verdict-first, and the operator gets no signal that the stub is stale. Observed failure: 1039's `testing` transition was denied by the gate (`[WARN] L4` — Testing contains UNKNOWN stub markers contradicting the populated-Testing requirement); the fix was manually re-running `spur task record` after `spur task verdict`.

**Problem 2 — done_reason/done_forced are write-once and never cleared.** The done transition persists `done_forced` + `done_reason` only in the R3 forced-override path (`packages/app/src/services/task-transition.ts:219-229` → `updateField(wbs, 'done_reason', input.reason)`); `task-service.ts:817-835` documents them as override audit fields; the flag help is at `apps/cli/src/commands/task.ts:460`. No transition ever updates or clears them. Consequence observed on task 1038: its first close was forced (`--force-done --reason "…PARTIAL…"`), the reopen→remediate→re-close (commit `87721715f`) was a natural unforced close with a PASS verdict — yet the frontmatter still narrates the superseded PARTIAL acceptance and still asserts `done_forced: true`. The corpus now claims a forced close that did not happen. No CLI verb edits these fields without a status re-transition, and `done` is terminal.

**Why this drifts when under-specified.** Both defects sit on surfaces with legitimate-looking current behavior (UNKNOWN tolerance is deliberate for malformed files; write-once audit fields look intentional), so an implementer without these anchors tends to "fix" the wrong layer: changing the transition gates, changing verdict linting, or adding new CLI verbs. This task pins the layer: record refresh semantics + transition audit-field refresh only.

**Excluded (do not touch).** Verdict linting, transition gates (`done-transition-guard.ts`), gate messages, `status` mode's `{reuse, reason}` JSON contract, `task-pipeline.yaml`, and any new public `spur` noun/verb (public-surface consent rule). The verdict→record ordering workaround remains valid until this lands.

### Requirements

- [x] R1. `spur task record <wbs>` refreshes the Testing section from `.spur/run/<wbs>-verdict.json` whenever a *readable* artifact exists — including on a re-invocation after an earlier UNKNOWN stub was written. Missing artifact: record still writes the stub but stdout/`--json` says the verdict is absent and names the remedy (`run spur task verdict <wbs> first`); malformed artifact: distinct message naming the malformed path. No silent UNKNOWN without an actionable message.
- [x] R2. Every `done` transition reconciles the override audit fields with what actually happened: forced close (`--force-done --reason`) writes `done_forced: true` + the supplied reason (unchanged); unforced close overwrites any stale pair — `done_forced` cleared/absent and `done_reason` set from the current verdict artifact (e.g. `done: PASS — all requirements MET (verdict .spur/run/<wbs>-verdict.json)`), or a neutral no-verdict note when the artifact is absent. Reopening and re-closing can never leave a prior close's narrative or forced flag behind.
- [x] R3. Happy-path parity: verdict-then-record pipelines produce byte-identical Testing/Review sections to today, and unforced closes without a prior forced close behave as before except for the newly written `done_reason`. Existing record/verdict/transition tests stay green.
- [x] R4. Cross-task safety: a verdict artifact whose `wbs` field does not match the requested task is ignored exactly like a missing artifact (message names the mismatch). Record's box-flip semantics stay verdict-driven (PASS flips boxes; FAIL/UNKNOWN flip nothing — `task-record.ts:238`).

### Acceptance Criteria

- AC1: Record-before-verdict no longer yields a gate-denying UNKNOWN Testing stub: in a scratch corpus, record with no verdict artifact reports the verdict-first instruction; after `spur task verdict`, a second record refreshes Testing from the artifact (targeted tests + CLI probe).
- AC2: Reopen → remediate → re-close a done task (1038 pattern) leaves `done_reason` matching the final verdict, verified against a scratch task; 1038-style staleness cannot recur.
- AC3: Full `bun run spur-check` green; task record/verdict suites extended for both behaviors.

### Q&A

<!-- Clarifications and triage decisions. Keep empty if none. -->

#### Q&A entry — 2026-10-01T18:19:31.483Z

- 2026-10-01 (enrichment): Re-parented F96 → **F91**. Rationale: F96's Scope is a deterministic residual scanner (`.spur/run/<wbs>-residuals.json`) and its In-list excludes record/verdict changes; F91 owns "corpus gates tell the truth about evidence," which both defects are.
- 2026-10-01 (enrichment): Freshness via always-read + content-diff (no mtime ledger, no new hash infra). Malformed artifacts surface a distinct message but still leave the stub — the stub is honest ("unreadable"), silence is not.
- 2026-10-01 (enrichment): Drift guard — implementer must NOT modify verdict linting, transition gates, `status` mode JSON, or `task-pipeline.yaml`, and must NOT add public `spur` nouns/verbs (consent rule). If those look necessary, stop and re-scope with the operator.

### Design

Single-layer changes, both in `packages/app` services; CLI (`apps/cli/src/commands/task.ts`) only passes through what it already has.

**R1 — record refresh (`packages/app/src/services/task-record.ts`).** The artifact reader (`:39-74`, verdict path option, default `.spur/run/<wbs>-verdict.json`; tolerance block `:111-135`) already returns UNKNOWN for missing/malformed. Change shape:
- Distinguish the three artifact states at read time: `readable` | `missing` | `malformed` (never throw). Return the state alongside the parsed verdict instead of collapsing both failures into `'UNKNOWN'` (`:121`, `:135`).
- Record always attempts the read; on `readable` it writes/refreshes Testing from the artifact (content-diff before rewriting the section so a no-change re-record writes nothing); on `missing`/`malformed` it writes the stub once and surfaces the state + remedy in the command result (`--json` gains a `verdictState` field; human output gains one line). No mtime bookkeeping needed: always-read + content-diff is simpler and self-healing.
- Wbs mismatch guard: if the artifact's `wbs` ≠ requested wbs, treat as `missing` with a mismatch message (R4).

**R2 — done-transition audit-field reconciliation (`packages/app/src/services/task-transition.ts`).** Today `done_forced`/`done_reason` are written only inside the R3 override branch (`:219-229`). Move the write out of the override-only branch so every successful `done` transition runs one reconciliation step:
- forced: `updateField(wbs, 'done_forced', true)` + `updateField(wbs, 'done_reason', input.reason)` (current behavior preserved).
- unforced: clear `done_forced` (empty/absent via `deps.tasks.updateField`) and set `done_reason` from the verdict artifact read at transition time — reuse the same three-state reader as R1 rather than duplicating it (export it from `task-record.ts` or a tiny shared helper; no new module if the import is clean). Absent artifact → neutral note, not UNKNOWN narration.

**Tests** extend the existing record and transition suites (`packages/app/tests/services/`): three artifact states × record, re-record refresh, wbs mismatch, forced/unforced × fresh/stale audit fields, happy-path parity snapshot.

**Out of scope by design:** gates and lints unchanged (`done-transition-guard.ts` untouched); `status` mode untouched; no `task-pipeline.yaml` change — the pipeline keeps working with either order, just without the trap.

### Plan

1. Reproduce both defects in a scratch corpus: record-before-verdict (expect UNKNOWN stub, no signal) and forced-close → reopen → unforced-close (expect stale `done_forced`/`done_reason`).
2. Implement the three-state artifact reader + always-read/content-diff record refresh in `task-record.ts`; add `verdictState` to the command result.
3. Implement the done-transition audit-field reconciliation in `task-transition.ts` (forced preserves, unforced overwrites/clears), reusing the reader.
4. Extend `packages/app/tests/services/` record + transition suites per Design; keep one parity test pinning byte-identical Testing output on the happy path.
5. Scratch-CLI probes: replay the 1039 order both ways (record→verdict→record, verdict→record) and the 1038 reopen/re-close cycle; quote rc, stdout, and resulting sections/frontmatter.
6. Targeted suites for record/verdict/transition, then full `bun run spur-check`; then pipeline gates for this task (record AFTER its own verdict, Review table populated) and close.

### Root Cause

**Verified causes (file:line).**

1. *Record staleness:* the artifact reader collapses missing and malformed into the same `'UNKNOWN'` sentinel (`packages/app/src/services/task-record.ts:121`, `:135`) and record treats a first write as terminal — no state is persisted that a later invocation could compare against, and no caller-facing message distinguishes "artifact not written yet" from "artifact unreadable". The 1039 pipeline hit this because `task-pipeline.yaml`'s inline driver runs record and verdict as independent steps; nothing encodes their order.
2. *Stale close narrative:* `done_forced`/`done_reason` exist only as R3 forced-override audit fields (`packages/app/src/services/task-transition.ts:219-229`, `:80`; service contract `task-service.ts:817-835`; flag doc `apps/cli/src/commands/task.ts:460`). An unforced close runs no reconciliation branch at all, so a prior close's fields survive indefinitely. Task 1038 demonstrates the end state: unforced PASS re-close (commit `87721715f`) with frontmatter still narrating the earlier forced PARTIAL close.

Both are one-layer fixes; neither requires gate, lint, or pipeline changes.

### Solution

<!-- Filled during implementation: file:line change map and concise rationale. -->

### Testing

<!-- Filled during verification: regression command(s), outcomes, coverage claim or N/A. -->

### Review

<!-- Filled during review: P1-P4 findings, residual risk, and final disposition. -->

### References

- Session evidence: 1039 gate denial (`[WARN] L4` UNKNOWN stub) and 1038 stale frontmatter — filed from the 2026-10-01 active session review (`--triage`).
- Commits: `1a398cf02`, `68285698a` (1039 pipeline), `87721715f` (1038 remediation whose re-close exposed Problem 2).
- Tasks: 1039 (failure transcript), 1038 (stale-close example, `docs/tasks5/1038_guard-quality-gate-recheck-against-empty-qualitygatecmd-vacu.md:11`).
- Feature: F91 (corpus gate integrity — evidence truth in the task corpus); initially misfiled under F96, re-parented during enrichment.
- Anchors: `packages/app/src/services/task-record.ts:39-74,111-135,238` · `task-transition.ts:24,80,219-229` · `task-service.ts:817-835` · `apps/cli/src/commands/task.ts:460` · `packages/app/src/services/done-transition-guard.ts:29`.

### History
