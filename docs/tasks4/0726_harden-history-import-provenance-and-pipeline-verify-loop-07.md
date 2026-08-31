---
schema_version: 1
name: "Harden history import provenance and pipeline verify loop (0722 session review)"
status: backlog
template: meta
created_at: 2026-08-31T15:58:12.645Z
updated_at: "2026-08-31T16:40:39.585Z"
feature_id: F91
ac_altitude: task-local
---

## 0726. Harden history import provenance and pipeline verify loop (0722 session review)

### Background

From the 0722 session review (--triage, 2026-08-31). Task 0722 took 3 runs and ~10h of execution because three failure classes each cost a full loop: (1) run-1/2 verified against a DB whose evidence channel (`history_tool_call.args_raw` for pi bash rows) did not exist in the published importer — discoverable in minutes with a precheck probe, cost ~2:23 in reruns; (2) a full-mode import with the broken published engine (BASH_TOOL_ALLOWLIST build, ts-libs 0.4.48) NULLed 73k args and required a ~2:57 detect→repair→re-verify cycle; (3) the async verifier hit the 30m timeout at ~90% and had to be resumed to emit one file, plus the verdict gate dropped 2 AC rows on non-enum evidence labels (mechanical retry).

Post-review re-audit (2026-08-31 09:27–09:29, corpus-check + targeted probes) settled the remaining open items:

- FIXED inline this review: run-3 review P4 doc gap (history-data-processing.md now names the `%index.ts task%` prefilter arm); 0722 Plan checklist boxes flipped (all six items done across runs 1–3); 0726 feature-linked to E6 and requirements checkbox-formatted.
- VERIFIED NOT A REPO DEFECT: the 4 recurring blocking LSP findings on `apps/cli/tests/commands/history.test.ts` L151/152/168/169 (`resetHistory`/`cleared` "not assignable"). `bunx tsc --noEmit` (apps/cli) exits 0; full suite 7034 pass. The LSP serves a stale union predating `914f0e464`, and its suggested fix ("remove unnecessary await" on type errors) is incoherent. Environmental (pi-lens/LSP cache), out of scope here.
- NOT RE-EMITTED: the post-check security flag on `packages/app/tests/services/history-board-service.test.ts:72` — flagged line is a parameterized test INSERT with bound args (fixture SQL, no secret); scanner did not re-fire post-commit. Owned by the 0724/0725 writers.
- EXTERNAL, NOT FIXED HERE (dependency for R1's clean solve): ts-libs importer fixes unreleased — `96762d5` (bash args retention) and the `record_hash` engine-version instability (~73k rewritten rows per full import under a changed engine). Standing rule until release: no `history import` against the published engine.
- ADJACENT, OUT OF SCOPE (listed so nothing is lost): feature F91 dogfood artifact missing (corpus-check `L4.dogfood-missing`) — belongs to F91's owner, not this task.

### Requirements

- [ ] R1 — Importer provenance guard. `history import` (packages/app/src/services/history-service.ts, import path) must refuse a full-mode import before any row is written when the installed `@gobing-ai/ts-llm-jsonl-importer` build is known data-destructive. Detection options (either suffices; prefer version predicate first): (a) importer version < the release containing 96762d5 (bash-args retention) when full mode + pi source is requested; (b) feature-marker probe of the installed engine (the 0.4.48 build's `maybeArgsRaw` keeps args only for the todo allowlist — detect by absence of the bash-args retention behavior marker). Behavior: exit with a named provenance error (engine version, reason, remedy: upgrade ts-libs / repoint the workspace symlink), zero DB mutations. Rollout: ship warn-only first (log + JSON `provenanceWarning` field), flip to refuse in the next minor. Note the upsert danger explicitly: full mode upserts by message hash, so re-import with a degraded engine does not add rows — it NULLs existing `args_raw` (observed: links 408→115, 73k args NULLed, repaired 2026-08-30 → 2026-08-31 via symlink + pi re-import; backup `.spur/spur.db.bak-20260830-2333`).
- [ ] R2 — Data-channel precheck probe. The task pipeline precheck stage (config/workflows/task-pipeline.yaml precheck, and/or `sp:dev-refine`) must, for tasks whose ACs depend on live imported data, sample the named channel and fail loudly before wip. Concrete probe used by 0722's R7: `SELECT COUNT(*) FROM history_tool_call WHERE args_raw IS NOT NULL AND source = 'pi'` — 0 means the AC cannot be evidenced and the task must scope the upstream fix first or re-stage the AC. Mechanics: AC text declares channels via a small convention (e.g. `evidence-channel: history_tool_call.args_raw[pi]` line in the task AC block) so the probe is deterministic, not model-judged; probe result is printed in precheck output.
- [ ] R3 — Verifier incremental output + answer-file lint. The verify stage (sp-dev-verify skill + pipeline verify step) must (a) write the answer file incrementally per certified requirement/AC row (append-safe format, e.g. one `## <row-id>` block per write) so a timeout resumes from partial output instead of restarting (observed: 30m timeout at ~90%, resume cost a full second pass, net ~0:30 overhead); and (b) schema-lint the answer file before the final write — evidence type must be one of the gate's enum values (observed failure: `query + command` / `query + test` dropped 2 AC rows at `spur task verdict --from-answer`), row ids must match the task's R/AC ids, and each row non-empty. Lint errors are row-level and mechanical (no model re-judgment needed).
- [ ] R4 — E6 verdict-evidence/scenario alignment. corpus-check flags `feature E6: L4.verdict-rows-match-no-scenario` because 0722's certified verdict evidence (`.spur/run/0722-verdict.json`) keys 10 rows by task-requirement id (R1–R7) while E6's scenarios are R8–R10; the matcher wants scenario-title or AC-N alias keys. Recorded decision (2026-08-31): NEVER rewrite certified verdict evidence to satisfy the matcher. Fix direction: extend the L4 matcher (corpus-check implementation) to accept task-requirement-keyed rows when the task file's AC block declares the feature-scenario coverage (0722's AC section states "Covers feature E6 scenarios R8–R10"), or update `sp-dev-verify` to emit scenario-alias keys for feature-linked tasks going forward. Do not regenerate 0722-verdict.json.
- [ ] R5 — Corpus-baseline acceptance ownership. After R1–R4 land, run `bun run corpus-check`, fix owned findings, then accept the remaining accepted-Open set by regenerating the snapshot (`bun run scripts/commands/regen-corpus-baseline.ts`) as commit-prep — a shared-state mutation that must not run while another writer has corpus edits in flight (current dirty: packages/domain/src/migrations.ts, packages/domain/tests/db.test.ts from the 0724/0725 session).

### Acceptance Criteria

- [ ] AC1 (R1): importing with a destructive-build engine exits non-zero with a named provenance error and the DB is unchanged (guard unit test + dry probe against the pinned 0.4.48 build).
- [ ] AC2 (R2): precheck against a DB missing the AC's declared evidence channel fails before wip with the probe query named in the message.
- [ ] AC3 (R3): a verify killed mid-run leaves a valid partial answer file that resumes without redoing certified rows; enum-invalid evidence labels are rejected with a row-level message before verdict derivation.
- [ ] AC4 (R4): corpus-check no longer reports `E6 L4.verdict-rows-match-no-scenario` for task-requirement-keyed evidence, and `.spur/run/0722-verdict.json` is byte-identical before/after.
- [ ] AC5 (R5): `bun run corpus-check` passes with the regenerated baseline, and the accepted-Open set is documented in the same commit.

### Q&A

<!-- CLOSED decisions from refinement: what was chosen and why, what was deferred and on what
     condition. Not a parking lot for open questions — an unanswered question here means the task
     is not ready to hand off. Keep empty if none. -->

### Design

<!-- Approach and tradeoffs for process/docs/config changes. Keep this short. -->

### Plan

<!-- Ordered checklist. Fill before moving to todo/wip. -->

### Root Cause

<!-- For issue/bug tasks: the verified underlying cause, with a `file:line` anchor. -->

### Solution

<!-- Filled during implementation: changed files/sections and concise rationale. -->

### Testing

<!-- Filled during verification: commands/checks run, outcomes, coverage claim or N/A. -->

### Review

<!-- Filled during review: P1-P4 findings, residual risk, and final disposition. -->

### References

- ts-libs fix `96762d5` (bash args retention) — release required to lift the standing no-import rule; `record_hash` engine-version instability is the same package's backlog (idempotency across engine versions).
- Incident evidence: `.spur/spur.db.bak-20260830-2333` (pre-repair backup); 0722 run-1/2/3 records; `.spur/run/0722-verdict.json` (certified, immutable).
- Guard site: `packages/app/src/services/history-service.ts` (import path); probe SQL in R2; verdict gate: `spur task verdict --from-answer` enum contract.
- Baseline regen: `bun run scripts/commands/regen-corpus-baseline.ts`; corpus-check rules: `L4.verdict-rows-match-no-scenario`, `L4.dogfood-missing`.
- Session review + cost breakdown: 0722 session review --triage (2026-08-31); task 0722 checkpoint `.spur/memory/sessions/0722-checkpoint.md`.

### History
