---
schema_version: 1
name: Make idea-pipeline ready-prepare audit premise correctness and re-stamp evidence after re-parenting
status: done
template: issue
created_at: 2026-09-24T00:36:30.606Z
updated_at: "2026-09-24T17:34:14.734Z"
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

- [x] R1a. The Step 5.6 "Ready preparation" contract in `plugins/sp/skills/spur-dev/references/planning-workflow.md` states that the `premises` check row passes only when each material premise was read against the current tree and its evidence cites at least one verified `path:line`; the ready-prepare `agent.run` input in `config/workflows/idea-pipeline.yaml` and the `prepareTaskBatch` prompt in `packages/app/src/services/task-readiness.ts` carry the same instruction.
- [x] R1b. A new exported `lintPremiseEvidence(evidence, io)` in `packages/app/src/services/task-readiness.ts` returns failing reasons when the `premises` row evidence contains no `path:line` citation, or when any cited file is missing or the line is out of range; `io` (file-exists + line-count) is injected for testability, matching the existing `ReadyPostCheck` seam style.
- [x] R1c. `finalizeIdeaHandoff` in `packages/app/src/workflow/idea-handoff.ts` runs R1b on every task's `premises` check row; a lint failure degrades that task to a precise preparation action (existing `/sp:dev-refine <wbs> --auto --depth ready` path), never a silent execution handoff.
- [x] R2. `finalizeIdeaHandoff` re-reads each task's frontmatter and degrades with reason `feature drift — task feature_id <x> != run feature <y>` when they differ (evidence strings stay advisory and are never auto-rewritten).
- [x] R3. Regression tests: `packages/app/tests/services/task-readiness.test.ts` covers `lintPremiseEvidence` (no citation → fail; missing file → fail; out-of-range line → fail; valid citations → pass); `packages/app/tests/workflow/idea-handoff.test.ts` covers the premises-lint degrade and the feature-drift degrade paths.
- [x] R4. No new public `spur` noun/verb; no new checklist id (the seven `READY_CHECKLIST_IDS` are unchanged); evidence rows keep their existing shape.

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

Two-layer fix, same-process; no new deps, no new public surface (R4), seven checklist ids unchanged.

**Layer 1 — stamp-time contract (R1a)**
- `config/workflows/idea-pipeline.yaml`: ready-prepare `agent.run` input now states the `premises` row passes only when each material premise was verified against the current tree and cites a verified `path:line`; state description notes handoff-finalize verifies feature binding too.
- `packages/app/src/services/task-readiness.ts` `prepareTaskBatch` prompt: same instruction carried into the generated prompt.
- `plugins/sp/skills/spur-dev/references/planning-workflow.md` § Step 5.6: contract updated with the read-then-cite procedure.

**Layer 2 — verify-time lint (R1b/R1c) + drift guard (R2)**
- New exported `lintPremiseEvidence(evidence, io)` (`packages/app/src/services/task-readiness.ts:479`) with injected `PremiseLintIo` (fileExists + lineCount, matching the `ReadyPostCheck` seam style): fails when evidence has no `path:line` citation, a cited file is missing, or a cited line is out of range.
- `finalizeIdeaHandoff` (`packages/app/src/workflow/idea-handoff.ts:358`) lints every task's `premises` row before handoff; lint failure degrades to the existing `/sp:dev-refine <wbs> --auto --depth ready` path, never a silent execution handoff.
- Frontmatter re-read per task: `feature_id` mismatch vs the run feature degrades with `feature drift — task feature_id <x> != run feature <y>` (`idea-handoff.ts:349`); evidence strings stay advisory and are never auto-rewritten.
- Regenerated mirror: `plugins/sp/lib/idea-handoff.generated.mjs`.

**Regression tests (R3)**
- `packages/app/tests/services/task-readiness.test.ts`: 5 `lintPremiseEvidence` cases — no citation → fail; missing file → fail; out-of-range line → fail; valid citations → pass (+ boundary).
- `packages/app/tests/workflow/idea-handoff.test.ts`: premises-lint degrade path and feature-drift degrade path.

**Verification**: focused `(cd packages/app && bun test tests/services/task-readiness.test.ts tests/workflow/idea-handoff.test.ts)` → 43 pass / 0 fail; full `bun run spur-check` from the worktree root → lint/typecheck clean, 8885 tests pass / 0 fail, post-check rules 0 violations.

### Testing

**Pipeline verify results**

- Verdict: PASS (from verdict artifact)

| Requirement | Status | Evidence |
|-------------|--------|----------|
| R1 | MET | [R1a] All three prompt surfaces carry the same read-then-cite premises instruction (each re-read at the cited lines this run): `plugins/sp/skills/spur-dev/references/planning-workflow.md:280-284` ("The `premises` row passes only when each material premise was read against the current tree… record the evidence as verified `path:line` citations — handoff-finalize lints the row"); `config/workflows/idea-pipeline.yaml:488-490` (ready-prepare `agent.run` input, same clause naming handoff-finalize lint) and `:464-466` (state description adds "tree-verified path:line citations" + "feature binding" verification); `packages/app/src/services/task-readiness.ts:336-337` (`prepareBatchTaskReady` prompt, same clause). Regenerated mirrors current: gitignored `apps/cli/plugins/sp/skills/spur-dev/references/planning-workflow.md:280` carries the contract; bundled `plugins/sp/lib/idea-handoff.generated.mjs` contains the lint + drift wiring (grep-verified this run). |
| R2 | MET | `packages/app/src/workflow/idea-handoff.ts:347-350`: task file re-read for the digest (`taskRaw`, `:319-322` region) is re-parsed via `taskFrontmatterFeatureId` (`:66-70`, `MarkdownDocument` from `@gobing-ai/spur-domain`, same machinery as `computePlanningDigest` — import added at `:2`); mismatch degrades with the exact reason `feature drift — task feature_id <x> != run feature <y>` (`:349`). No evidence prose is auto-rewritten anywhere in the diff — the new code only reads evidence strings. Covered by `idea-handoff.test.ts:342-373` asserting the exact drift reason (green this run). |
| R3 | MET | `packages/app/tests/services/task-readiness.test.ts:410-483`: `lintPremiseEvidence` table (no citation → fail; missing file → fail; out-of-range → fail; valid citations → pass) plus mixed-bad-token and line 0/unreadable `-1` boundary tests, stub io, no real fs. `packages/app/tests/workflow/idea-handoff.test.ts:304-339` (premises-lint degrade: UNREADY + `no path:line citation` + per-task refine action + refineall nextCommand) and `:342-373` (feature-drift degrade: UNREADY + exact drift reason + refineall nextCommand). Rerun this session: both files → 43 pass / 0 fail; `-t "0947"` filter → the 2 new handoff scenarios pass. |
| R4 | MET | `READY_CHECKLIST_IDS` unchanged — seven ids at `packages/app/src/services/task-readiness.ts:31-39`; the task-readiness.ts diff is purely additive (49 insertions, 0 deletions; hunks only at :333 and :450). No new public `spur` noun/verb: `git diff --name-only 70fe0a953..100f9c3f0` touches only `config/workflows/idea-pipeline.yaml`, the task file, 2 src files, 2 test files, `plugins/sp/lib/idea-handoff.generated.mjs`, and `plugins/sp/skills/spur-dev/references/planning-workflow.md` — no CLI command/noun surface files. Evidence row shape unchanged: `ReadyEvidenceTask` (`task-readiness.ts:417+`) outside both diff hunks. |
- Coverage: N/A (verdict-based; verify pipeline does not measure code coverage)

### Review

**Verdict: PASS-with-findings** (0 P1 / 0 P2 / 1 P3 / 4 P4). Reviewed commit `100f9c3f0` vs parent `70fe0a953` on `sp/run-0947-579a`; all four requirements are implemented as specified and verified against the diff. Findings are operational/advisory; none break the handoff contract.

**Functional traceability (R1a–R4)**

| Req | Status | Evidence |
| --- | --- | --- |
| R1a | satisfied | `plugins/sp/skills/spur-dev/references/planning-workflow.md:280-284` (Step 5.6 read-then-cite contract); `config/workflows/idea-pipeline.yaml:488-490` (ready-prepare `agent.run` input) and `:464-466` (state description notes feature-binding verification); `packages/app/src/services/task-readiness.ts:336-337` (`prepareBatchTaskReady` prompt) — one instruction text across all three surfaces. |
| R1b | satisfied | `packages/app/src/services/task-readiness.ts:455` (`PREMISE_CITATION_PATTERN`), `:458-463` (`PremiseLintIo`: fileExists + lineCount, `-1` fails closed), `:479-498` (`lintPremiseEvidence`: no-citation / missing-file / out-of-range reasons). `io` injected, matching the async `ReadyPostCheck` seam style per the R1b text (the Design's synchronous sketch was superseded by the requirement's "match ReadyPostCheck" wording). |
| R1c | satisfied | `packages/app/src/workflow/idea-handoff.ts:356-366`: per-task lint after `verifyReadyChecks`; the first lint reason becomes the degrade reason; action is `readyRefineCommand(wbs)` = `/sp:dev-refine <wbs> --auto --depth ready` (`task-readiness.ts:55-57`); any failure flips `nextCommand` to `/sp:dev-refineall --feature <f> --auto --depth ready` (`idea-handoff.ts:402-404`). Never a silent execution handoff. |
| R2 | satisfied | `idea-handoff.ts:347-351` re-parses frontmatter via `taskFrontmatterFeatureId` (`:62-68`, `MarkdownDocument`, same machinery as the digest) and degrades with the exact reason `feature drift — task feature_id <x> != run feature <y>`. No evidence prose is auto-rewritten anywhere in the diff. |
| R3 | satisfied | `packages/app/tests/services/task-readiness.test.ts:410-483` (no-citation → fail, missing file → fail, out-of-range → fail, valid citations → pass, plus mixed-bad-token and line 0/unreadable `-1` cases); `packages/app/tests/workflow/idea-handoff.test.ts:304-339` (premises-lint degrade) and `:342-373` (feature-drift degrade), both asserting UNREADY + precise reason + per-task refine action + refineall `nextCommand`. Reviewer rerun: 43 pass / 0 fail. |
| R4 | satisfied | `READY_CHECKLIST_IDS` unchanged (`task-readiness.ts:31-40`; absent from the diff); no `spur` noun/verb touched; ready-evidence row shape unchanged (`ReadyEvidenceTask`, `task-readiness.ts:417-427`). |

**SECUA**

- **Security: PASS.** Lint is read-only (exists + line count); degrade reasons are built from regex-bounded tokens (`[\w./@-]`), so evidence text cannot break the handoff-report markdown table. Minor: `resolve(root, p)` lets absolute-path citations escape the repo root (P4 below) — read-only, fail-closed, operator-local.
- **Efficiency: PASS.** At most two fs ops per citation per task; bounded token class, no regex pathology.
- **Correctness: PASS.** 43/43 focused tests, 41/41 `idea-pipeline-definition.test.ts`, 2/2 plugin-twin tests (`plugins/sp/tests/idea-handoff-script.test.ts`) over the regenerated bundle; bundle parity confirmed (`lintPremiseEvidence`, `taskFrontmatterFeatureId`, `premiseLintIo`, drift + lint wiring all present in `plugins/sp/lib/idea-handoff.generated.mjs`); the gitignored `apps/cli/plugins/sp/.../planning-workflow.md` mirror is current (line 280 carries the new contract). Edge behavior fails closed throughout (missing file, unreadable `-1`, line 0, empty evidence).
- **Usability: PASS.** Precise degrade reasons surface in the handoff report with per-task refine actions and a refineall next command.
- **Architecture: PASS.** Both layers land in existing seams (service function beside `verifyReadyChecks`, handoff-gate call site, three prompt surfaces); no new checklist id, artifact shape, dependency, or public surface; `PremiseLintIo` mirrors `ReadyPostCheck`; the new cross-workspace import uses `@gobing-ai/spur-domain` per monorepo convention; `docs/design/workflow-shell-ownership.md:160` boundary (EXT script over shared `finalizeIdeaHandoff`) is unchanged and still accurate.

**Findings**

| Priority | Finding | Location | Action |
| --- | --- | --- | --- |
| P1 | none | — | — |
| P2 | none | — | — |
| P3 | Generated-bundle determinism: committed `idea-handoff.generated.mjs` was built in this worktree and carries unrelated minified-identifier renames; fail-safe (determinism test catches mismatch) | `plugins/sp/lib/idea-handoff.generated.mjs` | one `bun run build:plugin-lib` regeneration in main tree after merge |
| P4 | Citation token regex omits `.mjs`/`.mts` — genuine citations to such files degrade fail-closed | `packages/app/src/services/task-readiness.ts:455` | widen only if false degrades observed in real runs |
| P4 | Absolute-path citations resolve outside repo root (read-only leniency, undocumented) | `packages/app/src/workflow/idea-handoff.ts:71-84` | document or reject absolute citations |
| P4 | Defensive dead branches after digest + `verifyReadyChecks` success | `packages/app/src/workflow/idea-handoff.ts:347,357` | optional cleanup in a later pass |
| P4 | Doc-sync: design satellite predates the two new degrade causes | `docs/design/task-creation-readiness.md:96-97` | next `sp:doc-evolve` sync-check |

- **P3 · generated-bundle determinism (operational).** The committed `plugins/sp/lib/idea-handoff.generated.mjs` was built inside this worktree and carries minified-identifier renames unrelated to 0947 (`var common` → `var common2`, `init_custom` → `init_custom2`, …; parent has `var common,` ×1, the commit has `var common2,` ×1 and `var common,` ×0). Known harness residual (`.spur/memory/learnings.md:1500`; same rode-along pattern accepted in 0900/0901). Fail-safe — the determinism test (`scripts/commands/bundle-plugin-lib.test.ts`) catches any mismatch — but after merging to the main tree, one `bun run build:plugin-lib` regeneration there is required or the main-tree determinism gate will trip.
- **P4 · citation extension allowlist omits `.mjs`/`.mts`.** A genuine premise citation to `plugins/sp/**.mjs` (such files exist in this repo) does not match the token regex and degrades fail-closed (`task-readiness.ts:455`). The regex is design-specified; widen only if false degrades are observed in real runs.
- **P4 · absolute-path citation leniency.** `resolve(root, p)` in `premiseLintIo` (`idea-handoff.ts:71-84`) resolves absolute citations outside the repo root. Read-only and fail-closed; acceptable, just undocumented leniency.
- **P4 · defensive dead branches.** `taskRaw === undefined` (`idea-handoff.ts:347`) and the `checks !== undefined` guard on the lint call (`:357`) are unreachable after digest + `verifyReadyChecks` success; harmless but slightly obscures the invariant that the `premises` row exists when the lint runs.
- **P4 · doc-sync nit.** `docs/design/task-creation-readiness.md:96-97` still describes the handoff gate as "seven successful checks with nonempty evidence" without the two new degrade causes (premise-citation lint, feature drift). The outcome contract is unchanged (same ready-refinement handoff), so this is advisory — candidate for the next `sp:doc-evolve` sync-check, not a same-commit T3 violation.

**Residual risk**

- Full `bun run spur-check` (8885 tests) is the implementer's self-report in the Solution section; this review independently reran the focused suites (43 pass), definition tests (41 pass), plugin-twin tests (2 pass), and biome on the four changed TS files (clean). The known worktree residual above bounds the value of rerunning the full gate in this worktree.
- The feature-drift check is fail-open when a task has no/blank frontmatter `feature_id`; acceptable because created tasks are zod-validated to carry `feature_id`, and any later frontmatter edit invalidates the planning digest anyway.

Review proof digest: `sha256:bf7b31ada15f094a167e35372e0e5fd2cb39bb6538e504ec1e1655adcb268863`

Disposition: **PASS-with-findings** — no in-task remediation required; the P3 is a pre-merge operational step (main-tree bundle regeneration), the P4s are advisory.

### References

<!-- Links to failing logs, related issues, tasks, docs, or external references. -->

### History

- 2026-09-24T17:00:57.993Z todo → wip (system)
- 2026-09-24T17:33:50.427Z wip → testing (system)
- 2026-09-24T17:34:14.734Z testing → done (system)

