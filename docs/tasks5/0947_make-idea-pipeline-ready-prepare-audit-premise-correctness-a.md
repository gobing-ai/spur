---
schema_version: 1
name: Make idea-pipeline ready-prepare audit premise correctness and re-stamp evidence after re-parenting
status: todo
template: issue
created_at: 2026-09-24T00:36:30.606Z
updated_at: "2026-09-24T00:44:01.465Z"
feature_id: D64

estimate_hours: 6
---

## 0947. Make idea-pipeline ready-prepare audit premise correctness and re-stamp evidence after re-parenting

### Background

Filed by /sp:dev-review-session --triage (2026-09-24) from the D64 idea process findings.

During the D64 idea run (7c3e2ea1-1b00-4a08-8652-70f8fbdd6b43), idea-pipeline `ready-prepare`
emitted 10/10 tasks with all seven checks (`requirements design plan ac decisions dependencies
premises`) passing, yet five material premises were wrong and were only caught by the later
`/sp:dev-refineall --depth ready` audit:

1. Terminal reason needs an upstream `ts-dual-workflow-engine` change — `finalizeRun(runId, status, completedAt)` takes no reason (`ts-libs/packages/dual-workflow-engine/src/persistence.ts:103`, `:398`).
2. `verify`, `record` and `precheck` never run the quality gate — only `test` (`config/workflows/task-pipeline.yaml:293`), `test-fix` (:350) and `test-recheck` (:411) do.
3. The `mode` fast-path edges already exist with no producer (`task-pipeline.yaml:55` defaults `mode: ""`).
4. DecisionMaker v1 methods are `choice|noul` (ask/score deferred) and backends are `typesafe|laya-local` (`node_modules/@gobing-ai/ts-ai-runner/dist/decision/decision-maker.d.ts`).
5. `inline-pipeline-parity-check` compares action/guard kinds only (`plugins/sp/scripts/inline-pipeline-parity-check.ts:40`).

Root cause: the ready-checklist `premises` row is verified only for *presence* — a passing row
with a nonempty free-text evidence string (`verifyReadyChecks`,
`packages/app/src/services/task-readiness.ts:433`). Neither the Step 5.6 contract
(`plugins/sp/skills/spur-dev/references/planning-workflow.md:276`) nor the deterministic
handoff verification (`packages/app/src/workflow/idea-handoff.ts:290-301`) requires that a
premise was checked against the tree.

Separately, the operator re-parented the run's feature O → D64 after handoff, and the run's
ready evidence keeps stale prose ("AC bullets are verbatim feature O scenario titles") while
the run's binding identifier (`spur feature show O` → not found) silently drifted.

**Refine corrections (2026-09-24)**

- R2 reshaped: full prose re-stamping is rejected (evidence strings are advisory; auto-rewriting
  them violates the no-fabrication rule in Step 5.6). The deterministic fix is a drift detector:
  handoff-finalize degrades with a precise reason when a task's frontmatter `feature_id` no
  longer matches the run's featureId, instead of blessing stale evidence as current.
- The premise audit is two layers: (a) prompt-side — the planner must verify each material
  premise against the tree and cite `path:line` in the check-row evidence; (b) deterministic —
  handoff-finalize lints the `premises` row evidence: it must carry at least one `path:line`
  citation and every cited file must exist with the line in range.
- Scope note: `prepareTaskBatch` (`task-readiness.ts:332`) is the CLI ready-by-default path
  (`spur task create`, 0788); the pipeline path is the `agent.run` input in
  `config/workflows/idea-pipeline.yaml:478-486`. Both prompts get the same premises-citation
  instruction so the contract is uniform.

### Requirements

- [ ] R1a. The Step 5.6 "Ready preparation" contract in `plugins/sp/skills/spur-dev/references/planning-workflow.md` states that the `premises` check row passes only when each material premise was read against the current tree and its evidence cites at least one verified `path:line`; the ready-prepare `agent.run` input in `config/workflows/idea-pipeline.yaml` and the `prepareTaskBatch` prompt in `packages/app/src/services/task-readiness.ts` carry the same instruction.
- [ ] R1b. A new exported `lintPremiseEvidence(evidence, io)` in `packages/app/src/services/task-readiness.ts` returns failing reasons when the `premises` row evidence contains no `path:line` citation, or when any cited file is missing or the line is out of range; `io` (file-exists + line-count) is injected for testability, matching the existing `ReadyPostCheck` seam style.
- [ ] R1c. `finalizeIdeaHandoff` in `packages/app/src/workflow/idea-handoff.ts` runs R1b on every task's `premises` check row; a lint failure degrades that task to a precise preparation action (existing `/sp:dev-refine <wbs> --auto --depth ready` path), never a silent execution handoff.
- [ ] R2. `finalizeIdeaHandoff` re-reads each task's frontmatter and degrades with reason `feature drift — task feature_id <x> != run feature <y>` when they differ (evidence strings stay advisory and are never auto-rewritten).
- [ ] R3. Regression tests: `packages/app/tests/services/task-readiness.test.ts` covers `lintPremiseEvidence` (no citation → fail; missing file → fail; out-of-range line → fail; valid citations → pass); `packages/app/tests/workflow/idea-handoff.test.ts` covers the premises-lint degrade and the feature-drift degrade paths.
- [ ] R4. No new public `spur` noun/verb; no new checklist id (the seven `READY_CHECKLIST_IDS` are unchanged); evidence rows keep their existing shape.

### Acceptance Criteria

<!-- Number items AC1, AC2, … (never R<n> — that is the Requirements namespace): `- [ ] AC1 — <feature scenario title without its R-number>` bullets or `Scenario: AC1 — <title>` blocks; add `(req: R<n>)` to bind a task requirement; task-only checks go in prose below, or set `ac_altitude: task-local`. Use a regression scenario proving the bug is fixed. -->

### Q&A

<!-- Clarifications and triage decisions. Keep empty if none. -->

#### Q&A entry — 2026-09-24T00:43:44.953Z

- Q: Auto-rewrite stale "feature O" evidence prose after a re-parent? — A: No (2026-09-24). Evidence is an audit trail; rewriting it is fabrication. R2 detects the drift deterministically (`feature_id` frontmatter vs run featureId) and degrades with a precise reason instead.
- Q: Bind premises into `computePlanningDigest`? — A: No. The digest already binds Background content; the observed defect is unverified claims, not tampering.
- Q: Add an eighth checklist id `premise-citations`? — A: No. The lint enforces evidence quality of the existing `premises` row; `READY_CHECKLIST_IDS` stays frozen.
- Q: Lint the task Background instead of the check-row evidence? — A: No. Background legitimately contains prose claims without citations; the check-row evidence is the audit trail the contract (R1a) now requires to carry verified `path:line` citations, so that is the falsifiable lint target.
- Q: Does the lint run for CLI-created tasks (`spur task create`)? — A: Prompt-side only (R1a covers `prepareTaskBatch`); the deterministic lint runs in `finalizeIdeaHandoff`, the pipeline's execution-handoff gate where stale preparation caused the observed damage.

### Design

Two layers close the "premises verified for presence, not correctness" gap; both land in
existing seams. No new checklist id, no new artifact shape, no public CLI surface.

**Layer 1 — prompt-side audit (the model must look).**

- `plugins/sp/skills/spur-dev/references/planning-workflow.md` Step 5.6 "Ready preparation
  (ready-prepare, 0788)": extend the checklist sentence so the `premises` row requires the
  planner to (1) identify each material premise in the task Background, (2) open the cited
  file at the cited line and confirm the claim, (3) record the evidence as verified
  `path:line` citations. The bundled copy under `apps/cli/plugins/sp/...` is regenerated by
  `bun run --filter @gobing-ai/spur build:bundle` — never edited directly.
- `config/workflows/idea-pipeline.yaml` ready-prepare `description` (line ~457): one clause
  noting the premises row carries tree-verified `path:line` citations.
- `packages/app/src/services/task-readiness.ts` `prepareTaskBatch` prompt (~:332): append the
  same premises-citation instruction so `spur task create` ready preparation and the pipeline
  share one contract.

**Layer 2 — deterministic lint (the handoff must check).**

New export beside `verifyReadyChecks` in `packages/app/src/services/task-readiness.ts`:

```ts
export interface PremiseLintIo {
    fileExists(path: string): boolean;
    lineCount(path: string): number; // -1 when unreadable
}
export function lintPremiseEvidence(
    evidence: string,
    io: PremiseLintIo,
): { ok: boolean; reasons: string[] }
```

- Citation token regex: `/[\w./@-]+\.(?:ts|tsx|yaml|yml|json|md|sql):(\d+)/g` (covers the
  observed citation styles; `path:line-range` matches on the start line).
- Fails when: zero citations found; any cited path does not exist (paths resolve repo-root
  relative); any cited line is `> lineCount` or `lineCount < 0`.
- Pure function, fs injected — same seam style as `ReadyPostCheck`.

Call site: `finalizeIdeaHandoff` per-task evidence loop
(`packages/app/src/workflow/idea-handoff.ts`, after `verifyReadyChecks`, ~:297): when the
`premises` row passes structurally, run the lint with a node:fs-backed `PremiseLintIo` rooted
at the resolved repo root; on failure set `reason` to the first lint failure and take the
existing degrade path (`/sp:dev-refine <wbs> --auto --depth ready`).

**R2 — feature-drift detector.** In the same loop, the task file is already re-read for the
digest; parse frontmatter `feature_id` via the existing `MarkdownDocument` (already imported
for `computePlanningDigest`). Mismatch with `options.featureId` →
`reason = 'feature drift — task feature_id <x> != run feature <y>'`, degrade path unchanged.
Evidence prose is never rewritten.

**Tests (R3).**
- `packages/app/tests/services/task-readiness.test.ts`: four `lintPremiseEvidence` cases with a
  stub `io` (table-driven; no real fs).
- `packages/app/tests/workflow/idea-handoff.test.ts`: two new scenarios on the existing
  finalize harness — premises row whose evidence has no citation → task degrades with lint
  reason; task whose frontmatter `feature_id` differs → feature-drift reason. Both assert the
  nextCommand degrades to refineall.

**Why not alternatives.**
- Auto-rewriting stale evidence prose: rejected — evidence is an audit trail; rewriting it is
  fabrication (Step 5.6 "never fabricate evidence").
- Binding premises into the planning digest: rejected — digest already covers Background
  content; the gap is *verification*, not tamper-evidence.
- A seventh→eighth checklist id (`premise-citations`): rejected — the lint enforces the
  *evidence quality* of the existing `premises` row; `READY_CHECKLIST_IDS` stays frozen (R4).

### Plan

1. **Tests first (R3 skeletons).** Add the failing `lintPremiseEvidence` table cases in
   `packages/app/tests/services/task-readiness.test.ts` and the two degrade scenarios in
   `packages/app/tests/workflow/idea-handoff.test.ts`. Run:
   `(cd packages/app && bun test tests/services/task-readiness.test.ts tests/workflow/idea-handoff.test.ts)` — red.
2. **Layer 2 implementation.** Add `PremiseLintIo` + `lintPremiseEvidence` to
   `packages/app/src/services/task-readiness.ts`; wire the premises-row lint and the
   `feature_id` drift check into `finalizeIdeaHandoff` (idea-handoff.ts, in the existing
   per-task evidence loop after `verifyReadyChecks`). Re-run the two test files — green.
3. **Layer 1 prompt changes.** Edit Step 5.6 in
   `plugins/sp/skills/spur-dev/references/planning-workflow.md`, the ready-prepare
   `description` in `config/workflows/idea-pipeline.yaml`, and the `prepareTaskBatch` prompt
   string in `packages/app/src/services/task-readiness.ts`. Update any prompt-pinned snapshot
   in `idea-pipeline-definition.test.ts` if the description text is asserted.
4. **Regenerate bundle.** `bun run --filter @gobing-ai/spur build:bundle` so
   `apps/cli/plugins/sp/...` mirrors the skill edit.
5. **Gates.** `bun run spur-check` (lint/typecheck/tests/pre-post rules); run the full
   readiness/handoff suites once repo-wide:
   `(cd packages/app && bun test tests/services tests/workflow)`.
6. **Overlap note.** 0945 also edits `config/workflows/idea-pipeline.yaml` (guard files and
   failure-edge terminalReasons on route and design-answer states — disjoint from the ready-prepare
   description line here); if both run in parallel, the second writer rebases. No dependency
   edge is added for this.

Definition of done: R1a–R4 checked, new tests green, `spur-check` green, bundle regenerated,
`git status --short` limited to the six touched files plus generated bundle output.

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
