---
schema_version: 1
name: persist-out forwards task-cited .spur/run evidence artifacts
status: backlog
template: feature-impl
created_at: 2026-09-29T18:18:18.307Z
updated_at: "2026-09-29T19:28:50.435Z"
feature_id: A9

ac_altitude: task-local
---

## 1012. persist-out forwards task-cited .spur/run evidence artifacts

### Background

Observed during run 785c3ca9-fa8e-4ea8-b75e-81ccac2db600 (task 1008, WT-4 finish per task 0975 R1, `--task-file` per 0984 R2): `bun plugins/sp/scripts/inline-run-setup.ts --persist-out --from <worktree> --task-file <abs task path>` copied the run record (`<runId>.state.json` + `<runId>.md`) into the main tree's `.spur/run/` — and nothing else. The evidence artifacts the task file cites all lived only in the gitignored worktree `.spur/run/`: `1008-verdict.json`, `1008-test-gate.log/.status/.txt`, `1008-*.digest`, `<runId>-*.txt/.digest/.status`. They had to be hand-copied before `git worktree remove` (which refuses on untracked files but would otherwise destroy them with the directory). Gap: persist-out as implemented covers run rows only; task-cited evidence forwarding was manual.

Script surface: `plugins/sp/scripts/inline-run-setup.ts` — usage line :37 (`--persist-out --from <worktree-path> [--task-file <path>]... [--spur-bin <path>]`), mode docs :55, implementation entry :596, flag parsing :650/:670.

### Requirements

- **R1 (evidence forwarding)** — when `--task-file` is given, persist-out additionally copies each `.spur/run/<name>` artifact the task file body cites (detection: scan the task markdown for `.spur/run/<file>` tokens — that is how task 1008's Solution/Review cite `1008-verdict.json` etc.) from the `--from` tree into the target tree's `.spur/run/`. Optional repeatable `--evidence <path>` flag for explicit lists (bounded alternative to scanning).
- **R2 (safe re-run)** — idempotent: target file with identical content → skipped (counted in the JSON report); differing content → reported as a conflict and left untouched (never overwritten); missing source file → warning row, not a crash.

Detail: extend the existing JSON result rows (persisted/skipped) with the evidence outcomes; keep the current run-record copy behavior byte-identical.

### Acceptance Criteria

- [ ] AC1 — persist-out forwards task-cited `.spur/run/` evidence artifacts alongside the run record; demonstrated by a fixture run (temp worktree with a task file citing fake evidence names → the named files appear in the target `.spur/run/`) (req: R1)
- [ ] AC2 — Re-running persist-out over the same fixture reports identical files as skipped and does not modify them; conflicting content is reported, not overwritten (req: R2)

### Q&A

<!-- CLOSED decisions from refinement: what was chosen and why, what was deferred and on what
     condition. Not a parking lot for open questions — an unanswered question here means the task
     is not ready to hand off. Keep empty if none. -->

### Design

<!-- Chosen implementation approach, key tradeoffs, invariants, and impacted surfaces. -->

### Plan

<!-- Ordered implementation checklist. Fill before moving to todo/wip. -->

### Solution

Implementation steps:

1. In the persist-out path (`plugins/sp/scripts/inline-run-setup.ts:596+`), after copying run rows: read the `--task-file` body, extract candidates with a bounded regex over `.spur/run/<token>` occurrences (`[A-Za-z0-9._-]+`), dedupe.
2. Copy each from `<from>/.spur/run/<name>` to the target `.spur/run/<name>`: identical → skip; differs → conflict row; absent → warn row.
3. Report rows: extend the existing result object (persisted/skipped/conflicts/warnings); evidence copy failure must not fail the whole persist — report and continue; "never overwrite" is the hard rule.
4. Keep the script standalone (plugins/sp contract: only `node:*`/`bun:*`/relative imports — `sp-plugin-standalone` rule); regenerate the plugin bundle in the same commit if this script is bundled (bundles ride the branch, task 1008 precedent); `bun run plugin-smoke` passes.

Constraints (anti-drift):

- No new dependencies; portable Node APIs only (no shell-out to cp/rsync).
- Do NOT copy the whole `.spur/run/` directory — bounded to cited/flagged files.
- Do NOT change run-record format or the `--close` path.
- `ac_altitude: task-local` is already set — do not remove.

Verify: fixture script run in a temp dir (AC1/AC2 evidence); `bun run plugin-smoke`; targeted script invocation against a synthetic worktree.

### Testing

<!-- Filled during verification: commands run, outcomes, coverage claim or N/A. -->

### Review

<!-- Filled during review: P1-P4 findings, residual risk, and final disposition. -->

### References

- Task 0975 R1 (persist-out contract), 0984 R2 (`--task-file`) · run 785c3ca9 observation (this gap's provenance, hand-copy evidence)
- Code anchor: `plugins/sp/scripts/inline-run-setup.ts` :37 / :55 / :596 / :650 / :670
- Tasks: 1008 (WT-4 run), 1009–1011 (sibling follow-ups) · Feature: A9 · `sp-plugin-standalone` rule

### History
