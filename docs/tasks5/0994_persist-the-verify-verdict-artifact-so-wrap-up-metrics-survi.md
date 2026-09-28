---
schema_version: 1
name: Derive the wrap-up metrics verdict from the tracked Testing record
status: todo
template: feature-impl
created_at: 2026-09-28T08:31:25.123Z
updated_at: "2026-09-28T17:46:22.353Z"
feature_id: D62

ac_altitude: task-local
---

## 0994. Derive the wrap-up metrics verdict from the tracked Testing record

### Background

Found during the 2026-09-28 `sp:dev-review-session --triage` of the 0981 → 0974 → 0970 → 0973 run; re-verified 2026-09-28 against the code and `.spur/memory/wrapup-metrics.jsonl`.

`runMetrics` (`plugins/sp/scripts/wrapup-steps.ts:278`) derives each row's verdict only from the gitignored `.spur/run/<wbs>-verdict.json` (`:326-337`), defaulting to `UNKNOWN`. `/sp:dev-run --worktree` FF-merges and removes the tree on success (WT-4/WT-5), so the artifact dies with the tree and `/sp:dev-wrap` in the main tree finds nothing.

0984 does not cover it: persist-out copies only `.spur/run/<name>` files the fast-forwarded task file *cites* (`RUN_CITATION_RE`, `packages/app/src/services/inline-run-setup.ts:207`), and `renderTesting` (`packages/app/src/services/task-record.ts:150`) writes a pathless `- Verdict: PASS (from verdict artifact)` line.

The verdict is not actually lost: `task record` writes it into the tracked `### Testing` section before merge, and `runMetrics` already fetches that content through `spur task show <wbs> --json` (`:309`). It just never reads it.

Evidence (reproducible now): the log holds 28 `UNKNOWN` rows. Task 0967 is `done` with `- Verdict: PASS` in its tracked Testing section and no `.spur/run/0967-verdict.json` in the main tree; its row (2026-09-27T06:27:31Z) is `UNKNOWN`. The 0981 `UNKNOWN` row cited by the triage is no longer in the log (only a later hand-assisted `PASS` row remains), so 0967 is the reference case.

AC altitude: task-local. Regression fix on the wrap-up metrics path, not a new feature ship criterion.

### Requirements

- [ ] R1. When `.spur/run/<wbs>-verdict.json` is absent or yields no verdict, `runMetrics` derives the row verdict from the `Verdict:` line of the tracked `Testing` section in the `task show --json` content it already fetches. The artifact stays the first source, so existing single-tree behavior is unchanged.
- [ ] R2. The fallback matches only a line-anchored `Verdict: PASS|PARTIAL|FAIL|UNKNOWN` inside the Testing section, with the same semantics as `parseVerdictLine` (`packages/app/src/services/task-record.ts:336`). Evidence text elsewhere in the task must not match. Because of the plugin standalone contract (ADR-065), the check is a local copy with a comment pointing to `parseVerdictLine`, not an import.
- [ ] R3. When neither source gives a verdict, the row stays `UNKNOWN` and stderr, which the workflow run log captures, names the task, the missing artifact path and the missing Testing verdict. The step status is unchanged: `UNKNOWN` stays telemetry, not failure (`config/workflows/wrapup-pipeline.yaml:281`).
- [ ] R4. The metrics row schema does not change (`wbs, feature_id, status, verdict, timestamp`, same key order), so existing rows stay readable.

### Acceptance Criteria

- [ ] AC1 — Tracked verdict used when the artifact is gone (req: R1, R2)
  - Verify: `plugins/sp/tests/wrapup-steps.test.ts` has a case where the stubbed `task show` content has a `### Testing` section with `- Verdict: PASS` and there is no artifact. The row has `verdict: "PASS"`. A second case has `Verdict: FAIL` only inside an evidence table cell, and the row stays `UNKNOWN`.
- [ ] AC2 — Artifact precedence kept (req: R1)
  - Verify: a test case where the artifact says `PARTIAL` and the tracked line says `PASS` records `PARTIAL`.
- [ ] AC3 — Absent verdict is honest (req: R3)
  - Verify: the existing no-artifact case (`plugins/sp/tests/wrapup-steps.test.ts:290`) still records `UNKNOWN`, and stderr names `.spur/run/0770-verdict.json`.
- [ ] AC4 — Schema unchanged (req: R4)
  - Verify: the key-order assertion at `plugins/sp/tests/wrapup-steps.test.ts:294` passes unchanged.
- [ ] AC5 — Real-data reproduction (req: R1)
  - Verify: in a scratch copy, a metrics run over a capture of `["0967"]` in the main tree records `PASS` (before the fix: `UNKNOWN`). Then `bun run spur-check` is green.

### Q&A

<!-- CLOSED decisions from refinement: what was chosen and why, what was deferred and on what
     condition. Not a parking lot for open questions — an unanswered question here means the task
     is not ready to hand off. Keep empty if none. -->

### Design

**Chosen: read the tracked task record as the fallback** (F93's direction: the gate reads the tracked record). Artifact first, tracked `Testing` verdict line second, honest `UNKNOWN` last. This is about 15 lines in `runMetrics`, with no new process call, because the `task show --json` content is already in hand.

**Rejected: citing `.spur/run/<wbs>-verdict.json` from `renderTesting`** so 0984's persist-out copies it:
- 0984 R1 makes a cited file that is missing in both trees *block teardown*. That would turn a telemetry gap into a merge blocker.
- It adds a gitignored path to every tracked task file. The path dangles in any fresh clone.
- It only fixes future worktree runs. The copied file is still gitignored, so it is lost on another clone. The 28 existing `UNKNOWN` rows' tasks stay unrecoverable.
- It changes `renderTesting` output, which every task record and its tests pin.

**Rejected: a derived `verdict` field on `spur task show --json`.** It is a public CLI surface change (needs consent), and the plugin can already read the line.

**Rejected: reading the verdict inside the worktree during `dev-run`.** `dev-run` does not produce the wrap, so this would couple two commands' responsibilities.

Out of scope (note only): backfilling the 28 historical `UNKNOWN` rows. The log is append-only telemetry. A rerun of `/sp:dev-wrap` for a task would append a corrected row if anyone needs it.

Residual: a stale main-tree artifact from an earlier non-worktree attempt still wins over a newer tracked verdict. This is the existing behavior and is not widened by this fix.

### Plan

- [ ] Add the failing tests (AC1, AC2, AC3 stderr) to `plugins/sp/tests/wrapup-steps.test.ts`.
- [ ] Implement the Testing-section slice + line-anchored verdict match in `runMetrics`; add the stderr line for the no-source case.
- [ ] Regenerate the `plugins/sp/scripts/wrapup-steps.mjs` twin (`superskill script convert sp wrapup-steps.ts`, part of `bun run build:scripts`), then run `bun run plugin-smoke`.
- [ ] AC5 real-data reproduction on 0967 in a scratch copy (do not append to the real metrics log).
- [ ] `bun run spur-check`; commit.

### Solution

<!-- Filled during implementation: file:line change map and concise rationale. -->

### Testing

<!-- Filled during verification: commands run, outcomes, coverage claim or N/A. -->

### Review

<!-- Filled during review: P1-P4 findings, residual risk, and final disposition. -->

### References

<!-- Links to the parent feature, design docs, related tasks, or external references. -->

### History

- 2026-09-28T08:31:44.582Z backlog → todo (system)

