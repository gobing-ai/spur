---
schema_version: 1
name: "/sp:dev-run 0129 --auto --next dogfood findings"
description: ""
status: todo
type: review
template: review
profile: standard
feature_id: null
parent_wbs: null
priority: P2
tags: ["review"]
dependencies: []
created_at: "2026-06-26T18:53:42.741Z"
updated_at: 2026-06-27T16:13:14.537Z
---

## 0130. /sp:dev-run 0129 --auto --next dogfood findings

### Background
#### Review Findings

The `/sp:dev-run 0129 --auto --next` dogfood run surfaced six findings against the
dev-pipeline + dogfood tooling. Two are **safety-of-execution** (P1): nothing
deterministically prevents a dogfood run from launching a mutating, multi-hour pipeline
against a live task, and `--next`-ignored-in-full-mode is only enforced by agent prose,
not the harness. Two are **state-consistency** (P2): the pipeline transitions
`backlog→wip` before the implement step succeeds (half-state on halt), and the review-task
template's scaffold was reported as missing its P-table. Two are **operator-experience**
(P3): no dedicated `spur workflow cancel` verb, and low cache-hit rate (~46%) when
`dev-run` is driven programmatically.

Source: `docs/dogfood/2026-06-26-dev-run-0129-auto-next-dogfood.md`.

#### Finding disposition

| Finding | Severity | Final disposition |
|---------|----------|-------------------|
| F1 — dogfood observe-only not enforced for pipeline testees | P1 | ✅ fixed — `dev-dogfood` now defaults to observe-only (`--max-retry 0`) for all testees (0135) |
| F2 — `--next` ignored in full mode is prose-only, not deterministic | P1 | ✅ fixed — mandatory emission step in command + SSOT reference (0136) |
| F3 — `implement` transitions `backlog→wip` before code is written (half-state) | P2 | ✅ fixed — pipeline onEnter reordered; transition fires after implement succeeds (0137) |
| F4 — review template `### Review` ships empty scaffold with no P-table | P2 | ✅ closed inline — template already ships the table; finding was stale (no code change) |
| F5 — no dedicated `spur workflow cancel <run-id>` verb | P3 | ◐ partial — `cancel` verb shipped (0138); subprocess-kill (R2) deferred to 0140 (needs PID-tracking layer) |
| F6 — low cache-hit rate when `dev-run` driven programmatically | P3 | ⏳ reframed — measurement-first diagnostic (0139); optimization gated on a reproducible baseline |

**Remaining work to close 0130:** 0139 (F6 measurement + levers) and 0140 (F5 R2 subprocess kill).

#### Constraints

In-scope: F1–F6 (fix in priority order P1 → P2 → P3). Out-of-scope: redesigning the
dogfood protocol; changing the task-pipeline stage sequence beyond the F3 transition move;
the `spur workflow run`/`trace` core. Boundary: fixes land in `plugins/sp/**`,
`apps/cli/src/commands/{workflow,task}.ts`, and `config/workflows/task-pipeline.yaml`;
touch `.github/workflows/` only if F1's confirm-gate needs CI surfacing — get approval
first. Safety: any `task-pipeline.yaml` change must keep the existing happy-path green
(run an existing task end-to-end through the pipeline as regression cover).
### Requirements
- [ ] R1. Every open finding (F1, F2, F3, F5, F6) is addressed per its severity tier, and
      F4 is verified-and-closed with evidence (it is already satisfied —
      `config/templates/task/review.md:40-48` ships the P-table). The per-finding fix
      steps and verification criteria live in the `### Plan` checklist.
- [ ] R2. The `### Review` section is filled after the fix round with the post-fix
      disposition per finding, and the Background findings-table "Status at refine time"
      column is updated to reflect the final state.
### Plan
0130 is a **parent/umbrella task** — it owns the findings and the roster but implements nothing
itself. The work lives in its children. 0130 is complete only when every child is `done` or
`cancelled`. F4 is closed inline below (already satisfied — not a child task).

**Sub-task roster.**

| Sub-task | Covers | Title | Status |
|----------|--------|-------|--------|
| `[0137](0137_f3-eliminate-implement-step-half-state-backlog-wip-before-co.md)` | F3 (P2) | eliminate implement-step half-state (backlog→wip before code written) | ✅ done |
| `[0135](0135_f1-dogfood-pipeline-mutating-gate-for-pipeline-driving-teste.md)` | F1 (P1) | dogfood/pipeline mutating-gate for pipeline-driving testees | ✅ done |
| `[0136](0136_f2-deterministic-cli-warning-when-next-is-ignored-in-full-mo.md)` | F2 (P1) | deterministic CLI warning when --next is ignored in full mode | ✅ done |
| `[0138](0138_f5-spur-workflow-cancel-run-id-verb.md)` | F5 (P3) | spur workflow cancel <run-id> verb (R1 done; R2 subprocess-kill deferred to 0140) | ✅ done |
| `[0140](0140_f5-follow-up-track-async-run-pid-so-spur-workflow-cancel-can.md)` | F5 R2 (P3) | follow-up: track async-run pid so cancel can kill the in-flight subprocess | ⏳ todo |
| `[0139](0139_f6-improve-cache-hit-rate-for-programmatic-dev-run-drives.md)` | F6 (P3) | cache-hit rate — REFRAMED to measurement-first diagnostic (option b) | ⏳ todo |

**F4 — verify-and-close (inline, not a child task).**

- [x] **F4 (P2)** — Confirmed: `config/templates/task/review.md:40-48` ships the P1–P4 table in
  its `### Review` scaffold (and `:29-32` in `#### Review Findings`). The dogfood finding
  ("ships empty prose scaffold with no P-table") is **stale** — already satisfied at refine
  time. Closed with evidence; no code change.
- [ ] **R7** — After 0139 + 0140 are `done`, fill `### Review` with the post-fix disposition
  per finding and update the Background findings-table "Status at refine time" column to the
  final state. Then transition 0130 to `done`.
### Review
Post-implementation reflection — filled **after** the first fix round: what went wrong, what
remains to fix before closing, and any **back-issues** (new findings surfaced by the fix).

| Priority | Status | Note |
|----------|--------|------|
| P1 | TODO | (filled after first fix round) |
| P2 | TODO | (filled after first fix round) |
### References

### History
- 2026-06-27T06:50:18.806Z backlog → todo (system)
