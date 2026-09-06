---
schema_version: 1
name: "D61 batch execution findings register — consolidated fixes for pipeline, env leak, evidence, and watcher reliability"
status: todo
template: issue
created_at: 2026-09-06T00:03:27.768Z
updated_at: "2026-09-06T00:14:30.238Z"
feature_id: D61
---

## 0777. D61 batch execution findings register — consolidated fixes for pipeline, env leak, evidence, and watcher reliability

### Background
Consolidated register of every issue found during the feature D61 batch session (2026-09-05, review-session with --triage + batch post-mortem). Each finding carries an ID (F1–F10) referenced consistently across Requirements / Root Cause / Design / Solution / Testing below.

**Batch context.** Feature D61 ("Essential workflow checks and observable execution") drives 9 tasks through the task-pipeline workflow. Task 0765 completed and merged (commit `56e7e85cb`). Task 0766 was decomposed into 0773/0774/0775 (commit `7a9ac3454`) after two failed attempts. Task 0773 reached a milestone on attempt #8: the implement hop completed and committed (`8e0aa24f0`), proving the Design-addendum + requireDiff-guidance + pi-zai executor path works — but the run then FAILED at the test-fix hop (exit 3, 11m27s, run `7DAE0A1A-09ED-4DDE-991F-6996C3149FE8`), and its partial code edits were stashed (see F1). The operator stopped all background execution and moved the remaining batch to inline mode.

**Relationship to task 0776:** 0776 is the first execution slice covering F2 (stale executor doc) and F3 (0765 L4 evidence gap). This register contains all findings including those two, and is the planning surface for the rest. When fixes land, tick them off here and in 0776.

**Findings inventory (severity: blocker / high / medium / low):**

| ID | Finding | Severity | Status |
| --- | --- | --- | --- |
| F1 | `SPUR_WORKFLOW_RUN_ACTIVE` env marker leaks into pipeline test gates — every workflow-run test stage fails on the 0610 R4 nested-run refusal | blocker | open |
| F2 | Stale executor doc `omp-zai` at `config/workflows/task-pipeline.yaml:68` — dispatch fails with Unknown agent | medium | main copy fixed (uncommitted); worktree pending |
| F3 | `L4.evidence-not-recoverable` on 0765 — `--feature D61 --strict` preflight aborts | high | open (bypassed via `--tasks` selectors) |
| F4 | Executors must be capability-attested before pinning (0706 R5) — no preflight warning | medium | pi-zai fixed (`cbf4d20b6`); warning absent |
| F5 | `implementAgent=auto` follows capability attestation, not the operator's session model | medium | open, operator-owned decision |
| F6 | Corpus-scale implement times out on volc (30m/60m×2); agent wanders into pipeline mechanics when the diff gate is unclear | high | mitigated: requireDiff guidance in 0773 Design; explicit executor pin |
| F7 | Long-lived watcher subagents: stale child re-reported a dead run as its own; both watchers ran long and needed manual interrupts | medium | open |
| F8 | Duplicate content-equivalent SHAs main ↔ worktree | medium | open, end-of-batch |
| F9 | Stale scratch artifacts (`.spur/run/d61-0773-RESUME.md`) contradict the authoritative task file | low | annotated SUPERSEDED this session |
| F10 | Test-fix hop mutated source code on a classification-only task whose charter forbids code mutation | high | partial edits stashed `stash@{0}`; charter needs a mutation-policy bound |
### Requirements
- **R1 (F1):** Running `bun run test` (or any workspace test) as a child of a `spur workflow run` process must pass; the `SPUR_WORKFLOW_RUN_ACTIVE=1` marker (0610 R4) must not leak into non-workflow child processes. Nested-workflow refusal for actual nested `workflow run` invocations stays fully intact.
- **R2 (F2):** `config/workflows/task-pipeline.yaml` contains no reference to a nonexistent executor id in either checkout; the pin example uses registry-valid `pi-zai`.
- **R3 (F3):** `spur feature check D61 --strict --json` returns `pass=true`: no `L4.evidence-not-recoverable` for 0765, and the three `L4.scenario-unverified` findings on scenarios R1–R3 clear — without any `--tasks` selector bypass.
- **R4 (F4):** When a pipeline profile pins an executor whose `executionCapabilities` are unattested, precheck (or plan validation) warns before the run starts, instead of failing 1s after launch.
- **R5 (F5):** The model-selection semantics of `implementAgent=auto` are documented (follows capability attestation, ignores the session's interactive model) and the operator decides: keep, or add a documented resolution order. No silent behavior change.
- **R6 (F6):** Corpus-scale implement hops have a stated execution budget and the task file carries the requireDiff guidance so classification-only tasks never stall on diff-gate mechanics. (Mitigation already in 0773 Design; generalize the pattern for future corpus tasks.)
- **R7 (F7):** A parent accepting a watcher/child report verifies run identity freshness (report run-id matches the dispatched id; log mtime ≥ dispatch time). Long-lived watch loops get a bounded lifetime or poll-count cap.
- **R8 (F8):** End-of-batch merge reconciles duplicate content-equivalent SHAs; main history ends linear-or-explicitly-merged with no content duplicated across commits.
- **R9 (F9):** Scratch artifacts under `.spur/run/` that are superseded carry a SUPERSEDED banner pointing at the authoritative instruction (task-file Design section).
- **R10 (F10):** The test-fix stage's mutation scope is bounded by the task's declared mutation policy; classification-only tasks never receive source-code edits from test-fix.
### Acceptance Criteria
- **AC1 (F1):** `SPUR_WORKFLOW_RUN_ACTIVE=1 bun run test` from the repo root passes (today it fails on 0610 R4 refusal); `apps/cli/tests/commands/workflow.test.ts` refusal-guard test still passes unmodified.
- **AC2 (F2):** `grep -rn 'omp-zai' config/workflows/task-pipeline.yaml` returns nothing in both checkouts.
- **AC3 (F3):** `spur feature check D61 --strict --json` → `pass=true`, zero `L4.*` findings, no `--tasks` bypass.
- **AC4 (F4):** Dry-run/plan of a profile pinning an unattested executor emits a warning naming the executor and the missing capabilities before any agent dispatch.
- **AC5 (F10):** A classification-only task (mutation policy: none) whose test gate fails receives NO source-code edits from test-fix — the hop halts with the failure surfaced instead.
### Q&A

<!-- Clarifications and triage decisions. Keep empty if none. -->

#### Q&A entry — 2026-09-06T00:05:41.564Z

- **2026-09-06 (operator):** All background subagents stopped mid-batch ("both of them not very smooth"); pipeline run `7DAE0A1A` killed — it had already failed its own test-fix hop (exit 3). Restart approved as inline run: `/skill:sp-dev-runall --feature D61 --auto --next --agent inline --worktree /Users/robin/xprojects/spur-new-runall-d61-8229`.
- **2026-09-06:** Test-fix partial edits stashed, not reverted — they contain the F1 diagnosis and a reviewable draft fix; keep until F1 is re-derived and verified.
- **2026-09-06:** F5 is operator-owned (model-pin semantics); document, don't change behavior, until the operator decides.
- **2026-09-06:** 0776 remains the execution slice for F2+F3; this register owns the rest and cross-references it.

#### Q&A entry — 2026-09-06T00:14:30.237Z

- **2026-09-06 (operator):** All background subagents stopped mid-batch ("both of them not very smooth"); pipeline run `7DAE0A1A` killed — it had already failed its own test-fix hop (exit 3). Restart approved as inline run: `/skill:sp-dev-runall --feature D61 --auto --next --agent inline --worktree /Users/robin/xprojects/spur-new-runall-d61-8229`.
- **2026-09-06:** Test-fix partial edits stashed, not reverted — they contain the F1 diagnosis and a reviewable draft fix; keep until F1 is re-derived and verified.
- **2026-09-06:** F5 is operator-owned (model-pin semantics); document, don't change behavior, until the operator decides.
- **2026-09-06:** 0776 remains the execution slice for F2+F3; this register owns the rest and cross-references it.
- **2026-09-06 (F3 repair outcome):** 0765 Testing repaired honestly — added `Verdict: PASS` line + per-requirement traceability table keyed to the FEATURE scenario title (`R1 — Normal checks preserve essential completion integrity | MET`), citing only evidence already in the section. Preflight `feature check D61 --strict --json` now emits only `L4.scenario-unverified` (11× — the expected pre-run state per execution-batch.md 0510 R2: reported verbatim, non-aborting). R1 verifies; R2–R12 clear as their covering tasks complete during the batch. Original repair goal "pass=true pre-batch" was a wrong premise — verified from check source (`isScenarioVerified` requires done covering tasks) and skill contract; corrected here.
### Design
**F1 (blocker, fix first — unblocks every pipeline test gate):** Two candidate seams. (a) `tests/setup.ts`: `delete process.env.SPUR_WORKFLOW_RUN_ACTIVE` after the existing `SPUR_SKIP_GLOBAL_CONFIG` guard (the stashed fix; comments already justify it and cite 0753 R3 coverage). (b) Workflow runner: set the marker only on nested `workflow run` invocations rather than the whole child environment. Prefer (a) for smallest diff; (b) is the cleaner long-term seam — do (a) now, file (b) as a follow-up decision. The stash (`stash@{0}`) holds a reviewable draft; re-derive rather than blind-apply, then verify AC1 both ways (marker set + unset).

**F2:** One-line comment fix. Main copy already fixed (uncommitted by design — main HEAD must stay FF-compatible until end-of-batch); commit at wrap-up and port to the worktree (or cherry-pick after merge).

**F3:** Read the L4 check implementation first (find `evidence-not-recoverable` in `packages/app` planning-check rules). Then repair honestly — do NOT fabricate a verdict artifact. Two honest paths: (a) enrich 0765's Testing section via `spur task update` with the real evidence that exists (verification command, test counts, merge commit `56e7e85cb`, date); (b) if the check requires the verdict artifact specifically, regenerate it via the documented history surfaces (source-local CLI, `docs/04_DESIGN.md`). Scenario findings R1–R3 are expected to clear with 0765's evidence (same root).

**F4:** Add a precheck/plan-validation warning: when a pinned `implementAgent` resolves to an executor without attested `executionCapabilities`, emit a warning naming executor + missing capabilities before dispatch. Locate the attestation check (0706 R5) and surface it one stage earlier.

**F5:** Document in `task-pipeline.yaml` comments + `docs/04_DESIGN.md` history surfaces: `auto` resolution order. Operator decision pending on whether to change behavior — documentation only until then.

**F6:** Generalize the 0773 pattern: task-file Design sections for corpus-scale tasks must carry (i) an execution-budget note, (ii) requireDiff guidance, (iii) persisted-artifact expectations. Add to the sp-dev-plan/refine checklist rather than pipeline code.

**F7:** Parent-side habit (immediate): before accepting a watcher report, verify run-id match + log mtime ≥ dispatch time. Structural (follow-up): bound watcher lifetimes (poll-count cap) in the runall/watch skill guidance.

**F8:** End-of-batch: `git fetch` main state → rebase worktree branch onto main (drop content-duplicates) → FF. If rebase is too entangled, explicit merge commit is acceptable; no force-push anywhere.

**F9:** Convention, already applied: superseded scratch gets a SUPERSEDED banner pointing at the authoritative instruction. Codify in `.spur/context/pitfalls.md` (via sp:indexed-context) rather than code.

**F10:** Add a mutation-policy input to the test-fix stage: tasks declare `mutationPolicy: none|tests|code` (0773 = none); test-fix with `none` halts on test failure and surfaces the failure instead of editing. Smallest seam: the pipeline profile/vars already flow into the hop brief — extend the brief template, not the engine.
### Plan
1. **F1:** apply the setup.ts marker-drop fix (re-derive from `stash@{0}`), verify `SPUR_WORKFLOW_RUN_ACTIVE=1 bun run test` passes AND the refusal-guard test still refuses; keep the stash until verified.
2. **F2:** port the yaml:68 fix to the worktree copy; commit the main copy at end-of-batch wrap.
3. **F3:** read the L4 check; repair 0765 evidence honestly (Testing-section enrichment first, artifact regeneration second); `spur feature check D61 --strict --json` until `pass=true`.
4. **F4:** precheck warning for unattested pinned executors; verify with a dry-run pinning an unattested id.
5. **F5:** document auto resolution order (yaml comment + 04_DESIGN); record operator decision in Q&A when made.
6. **F7:** freshness guard in watcher charters; bounded watch loops.
7. **F10:** mutation-policy bound for test-fix; verify AC5 with a synthetic classification-only failure.
8. **F8:** end-of-batch rebase-then-FF reconciliation.
9. **F9:** pitfalls entry via sp:indexed-context. F6: checklist addition via sp-dev-plan/refine skill docs.
Order rationale: F1 unblocks the test gate the whole batch depends on; F3 unblocks `--feature D61` selectors; F2/F4 are one-liners riding along; F5–F10 are follow-ups that must not block the batch restart.
### Root Cause
**F1 — env marker leak (verified this session).** `apps/cli` marks workflow-run child processes with `SPUR_WORKFLOW_RUN_ACTIVE=1` to enforce the 0610 R4 nested-run refusal. The pipeline's `test`/`test-recheck` gates shell out to `bun run test` as children of the workflow process, inherit the marker, and are refused as "nested pipelines". Evidence: run `7DAE0A1A` log — test-fix hop exited code 3 after 11m27s; the stashed partial fix (`.spur/run` → `stash@{0}`) contains the agent's own diagnosis in `tests/setup.ts`: "Tests are legitimate top-level processes, not nested pipelines, so drop the leaked marker here." Root cause: the marker is set process-environment-wide by the workflow runner instead of being injected only into actual nested `workflow run` invocations.

**F2 — stale doc (verified).** `config/workflows/task-pipeline.yaml:68` documents `--vars '{"implementAgent":"omp-zai"}'`. `omp-zai` is not in the runtime registry; run `531e6c03` failed dispatch in 1.1s: `Unknown agent: 'omp-zai'. Accepted: role (scribe, coder, reviewer, planner), configured executor (minimax, pi-dsv4-flash-volc, pi-zai-volc, pi-zai, pi-zai-cn, pi-zai-nvidia, agy-gemini, pi-deepseek, agy-opus, grok, claude), 'inline', or 'auto'`. Root cause: doc example written from a stale/remembered id, never validated against the registry.

**F3 — 0765 evidence gap (verified 2026-09-06T00:00Z).** `spur feature check D61 --strict --json` → `pass=false`: `L4.evidence-not-recoverable` — "Task 0765 has no verdict artifact and its tracked ## Testing section carries no recoverable coverage evidence" — plus three `L4.scenario-unverified` findings (scenarios R1–R3, covered by 0765). 0765 reached done and merged (`56e7e85cb`) but its verify/record stage output is not where the L4 check looks (no `0765-verdict.json` artifact recoverable). Root cause: evidence placement/retention mismatch between the record stage and the check's recovery rules; exact contract needs reading the L4 check implementation (`packages/app` planning-check rules) before repair.

**F4 — attestation tripwire (verified).** Run `bda16b4d` failed in 1.35s: `executor/spec 'pi-zai' cannot satisfy required capabilities — fsWrite/processSpawn: actual=unknown provenance=unattested`. Per 0706 R5 unknown never satisfies a requirement. Fixed for pi-zai by `cbf4d20b6` (project-layer `.spur/config.yaml` `agent.executors[]` entry restating capabilities, mirroring `b36193142`). Root cause: nothing warns at plan/precheck time that a pinned executor lacks attestation.

**F5 — auto model pin (verified).** Attempt #3 (run `2d33f201`) proved the operator's session-model change never reached the pipeline: `auto` resolves via capability attestation to `pi-dsv4-flash-volc`. Not a defect per se — attestation-driven resolution is deterministic — but it is undocumented and surprised the operator. Root cause: resolution order (attestation > session model) is implicit.

**F6 — timeouts + diff-gate wandering (verified).** Runs `46734bfc` (30m timeout), `f4b2f664` (60m SIGTERM, ~90% complete), `2d33f201` (60m, substance complete but agent looped on requireDiff mechanics instead of committing). Root causes: (a) corpus-scale classification (299 warnings) exceeds practical agent budgets on volc; (b) the requireDiff gate had no declared answer for classification-only tasks. Mitigations landed: artifacts persisted in `.spur/run/d61-0773-*`, requireDiff guidance authored into 0773 Design, explicit `implementAgent=pi-zai`. Attempt #8 completed implement (commit `8e0aa24f0`) on this path.

**F7 — watcher reliability (verified).** Child `a6321e28` was dispatched for dead run `bda16b4d` and later re-reported that dead run as its result while its own live run was in progress — the parent almost accepted a stale verdict. Both watchers (`a6321e28`, `9372280e`) ran long (60–90+ min) and required manual interrupts. Root causes: no run-id/log-mtime freshness check before accepting child reports; watch loops had no bounded lifetime.

**F8 — duplicate SHAs (known).** Main carries `37e5c2ec2`/`1567c5059`; the worktree carries content-equivalent `6d6d6c34f`/`b36193142`. Plain FF will fail once main moves; a rebase-then-FF or explicit merge is required at batch end.

**F9 — stale scratch (verified).** `.spur/run/d61-0773-RESUME.md` predated run `2d33f201` and contradicted the 0773 Design section; annotated with a SUPERSEDED banner this session. Root cause: scratch outlives its context; no convention forced staleness marking.

**F10 — test-fix scope drift (verified).** Run `7DAE0A1A`'s test-fix hop edited six source files (planning-check-base + test, history-analysis-service, history-board-rollup, analytics index, tests/setup.ts) on task 0773 — a classification-only task whose charter states no code/config/corpus mutation may be invented. The edits were stashed as `stash@{0}` ("killed run 7DAE0A1A test-fix hop partial edits"). Root cause: the test-fix stage has no knowledge of the task's mutation policy; F1 made the test gate fail, and test-fix responded the only way it knows — editing code.
### Solution
Filled during implementation. Proposed change map (per Root Cause):

- **F1:** `tests/setup.ts` — after `SPUR_SKIP_GLOBAL_CONFIG` guard: `delete process.env.SPUR_WORKFLOW_RUN_ACTIVE;` with a WHY comment (0610 R4 marker leaks to test gates; tests are top-level processes; refusal guard stays covered by the explicit-set refusal test in `apps/cli/tests/commands/workflow.test.ts`, 0753 R3). Draft available in `stash@{0}`. Follow-up (separate decision): narrow the marker to nested workflow invocations at the runner seam.
- **F2:** `config/workflows/task-pipeline.yaml:68` — `omp-zai` → `pi-zai` (main copy done, uncommitted).
- **F3:** `docs/tasks4/0765_*.md` Testing section via `spur task update --section Testing` — record the real verification evidence (command, 5429 passing tests at verify time, merge commit `56e7e85cb`, 2026-09-05). Escalate to artifact regeneration only if the check still refuses.
- **F4:** warning emission at plan validation, adjacent to the 0706 R5 attestation check in `packages/app` pipeline planning.
- **F10:** test-fix hop brief gains a mutation-policy clause sourced from the task's declared policy; `none` ⇒ halt-and-surface.
### Testing
- F1: `SPUR_WORKFLOW_RUN_ACTIVE=1 bun run test` (repo root) — must pass; `cd apps/cli && bun test tests/commands/workflow.test.ts` — refusal guard must still fire when the marker is set explicitly by a real nested workflow; both sides of AC1.
- F2: grep across both checkouts (AC2).
- F3: `spur feature check D61 --strict --json` → pass=true, zero L4 findings (AC3).
- F4: plan/dry-run with unattested executor pin → warning present, before dispatch (AC4).
- F10: synthetic run: classification-only task + failing test gate → test-fix halts, zero source edits (AC5).
- Batch regression after F1 lands: `bun run spur-check` green on the worktree.
### Review

<!-- Filled during review: P1-P4 findings, residual risk, and final disposition. -->

### References
- Run logs (`.spur/run/`): `7DAE0A1A-09ED-4DDE-991F-6996C3149FE8.log` (implement commit `8e0aa24f0` + test-fix exit 3), `2d33f201` (requireDiff wandering), `f4b2f664` (60m SIGTERM), `46734bfc` (30m timeout), `531e6c03` (Unknown agent omp-zai, verbatim registry list), `bda16b4d` (capability tripwire).
- Commits: `56e7e85cb` (0765 merged), `7a9ac3454` (decomposition), `f049333a7`/`1870dcbde` (citation fixes), `cbf4d20b6` (pi-zai attestation), `8e0aa24f0` (0773 implement finalized), `b36193142` (attestation pattern).
- `stash@{0}` — "killed run 7DAE0A1A test-fix hop partial edits" — F1 draft fix + F10 evidence (six source files).
- Reproduction commands in Testing section; L4 finding text quoted in Root Cause.
- Session review report 2026-09-05/06 (active session, --triage) — conversation is the primary evidence plane for F5–F7, F9.
- Related: task 0776 (execution slice for F2+F3).
### History
