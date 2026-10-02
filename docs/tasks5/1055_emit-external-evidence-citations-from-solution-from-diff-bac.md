---
schema_version: 1
name: Emit external-evidence citations from solution-from-diff backfill
status: todo
template: issue
created_at: 2026-10-02T20:15:07.448Z
updated_at: "2026-10-02T20:45:27.794Z"
feature_id: D62

---

## 1055. Emit external-evidence citations from solution-from-diff backfill

### Background

Session defect observed 2026-10-02 while completing task 1051: the Solution change-map cited `@gobing-ai/ts-dual-workflow-engine/src/persistence.ts:108` and `:104-115` as repo-relative anchors, which the L4 anchor checker cannot resolve from the project root (`packages/app/src/services/task-check.ts`, L4.anchor-unresolved) — this blocked the `done` transition until both citations were manually rewritten to the frozen external-evidence form (`task-check.ts:255-262`: origin + backticked path + line number OUTSIDE the backticks).

**Attribution (verified 2026-10-02, supersedes the earlier "diff-backfill" attribution):** the mechanical backfill `renderSolutionFromDiff` is exonerated — it emits only `+++ b/<repo-path>` anchors from `git diff -U0` hunk headers (`packages/app/src/services/task-record.ts:718-761`), which are always resolvable. The bad citations were **implement-phase-authored change-map rows** (the model writes the change-map in section-matrix format; non-repo paths slipped through as `file:line` anchors). The task title keeps the original name (CLI has no rename verb); this Background is the corrected owner map. Every diff whose implementer cites an external `@gobing-ai/ts-*` engine line risks the same blocked done gate.

### Requirements

- R1: Close the authoring↔checking gap for external-package change-map citations, on two surfaces: (a) **authoring guidance** — the implement-phase change-map contract (sp-code-implementation skill / pipeline implement guidance) states the frozen external-evidence form for non-repo paths (`@scope/...` backticked, line number outside the backticks); (b) **gate-side precise failure** — when L4 finds an unresolvable anchor whose path looks like `@scope/...`, the `task-check` failure message emits the exact external-evidence replacement (still fail-closed). The `task record --solution-from-diff` backfill needs no change (provably repo-path-only).
- R2: The failure mode stays fail-closed; the improvement removes the avoidable manual repair loop (diagnose-why-did-this-fail), not the gate.

### Acceptance Criteria

- AC1: A task whose change-map cites an external package path passes `spur task check <wbs> --as done` without manual citation repair (repro of the 1051 blocker now green by construction).
- AC2: In-repo citations still require repo-relative anchors (checker R2 behavior unchanged).

### Q&A

<!-- Clarifications and triage decisions. Keep empty if none. -->

#### Q&A entry — 2026-10-02T20:45:27.794Z

#### Q&A entry — 2026-10-02T20:50Z

**Attribution correction (verified against source):** earlier framing blamed the `--solution-from-diff` backfill; `renderSolutionFromDiff` (`task-record.ts:718-761`) provably emits only repo-relative `+++ b/<path>` anchors. The blocking `@gobing-ai/...` citations were implement-phase-authored change-map rows. Requirements/Background corrected accordingly; title unchanged (no CLI rename verb). AC1 restated for the new surfaces: a scratch task whose change-map uses the external-evidence form passes `task check --as done` (surface a), and an unresolvable `@scope/` anchor fails with the exact rewrite in the message (surface b, fail-closed).

### Design

- **Surface (a) — authoring guidance**: locate the change-map authoring contract in the pipeline/skill text (`plugins/sp/skills/sp-code-implementation/` and/or the implement-phase guidance referenced by `config/workflows/task-pipeline.yaml`); add one normative line with a correct and incorrect example pair. Prompt-level, so pair with (b).
- **Surface (b) — precise gate failure**: in `task-check.ts` L4 anchor resolution, when the path is unresolvable AND matches `^@scope/`, append to the failure detail: the exact external-evidence rewrite (`origin + backticked path + line outside backticks, per task-check.ts:255-262`) instead of the generic unresolved message. Optionally also accept already-correct external-evidence form for `@scope/` origins (verify against the checker's existing rules at `:250-300` before adding an accept path — do not weaken the gate for repo paths).
- **Rejected**: teaching L4 to resolve `node_modules` paths into package origins (heavy, couples the checker to install layout); auto-rewriting authored Solution text in `task record` (record must not rewrite author content — the 1051 sed repair was exceptional, mechanically justified, and should not become a pathway).

### Plan

1. Read the L4 rules and messages in `task-check.ts:250-300` end-to-end; identify the unresolved-anchor failure site and message shape.
2. Implement surface (b): `@scope/`-shaped unresolvable anchors get a message carrying the exact external-evidence replacement.
3. Implement surface (a): one normative guidance line + example pair in the change-map authoring contract.
4. Tests: unit for the L4 message (unresolvable `@scope/...` anchor → message contains the external-evidence rewrite; unresolvable plain repo path → unchanged generic failure); authoring-guidance is prose — verified via AC1's end-to-end repro on a scratch task.
5. Focused `(cd packages/app && bun test tests/services/task-check*)` (locate exact path) → full `bun run spur-check`. Corpus-audit changes: `bun run corpus-check` if checker policy files change.

### Root Cause

Root cause is a contract asymmetry, not a rendering bug: the checker's external-evidence rule exists and documents the correct form (`task-check.ts:255-262`), but the change-map authoring guidance does not teach it, and the L4 failure message does not bridge the gap — the implementer emitted a plausible `file:line` anchor and the gate failed with an unactionable unresolved error. Live evidence: 1051 done-transition blocked, two manual sed repairs, re-check PASS (session record 2026-10-02).

### Solution

<!-- Filled during implementation: file:line change map and concise rationale. -->

### Testing

<!-- Filled during verification: regression command(s), outcomes, coverage claim or N/A. -->

### Review

<!-- Filled during review: P1-P4 findings, residual risk, and final disposition. -->

### References

- Checker: `packages/app/src/services/task-check.ts:250-300` (external-evidence rule), L4 anchor resolution + message sites.
- Renderer (exonerated): `packages/app/src/services/task-record.ts:703-761` (`renderSolutionFromDiff`, `+++ b/<path>`-only).
- Backfill trigger: `apps/cli/src/commands/task.ts` (`task record --solution-from-diff`, backfills only when Solution is bare).
- Authoring contract: sp-code-implementation change-map guidance / `config/workflows/task-pipeline.yaml` implement phase.
- Origin evidence: task 1051 Solution rows citing `@gobing-ai/ts-dual-workflow-engine/src/persistence.ts` (lines ~82/:138 post-repair), session record 2026-10-02.

### History
