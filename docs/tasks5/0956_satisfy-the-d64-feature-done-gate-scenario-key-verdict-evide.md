---
schema_version: 1
name: "Satisfy the D64 feature-done gate: scenario-key verdict evidence and add dogfood artifact"
status: todo
template: feature-impl
created_at: 2026-09-25T23:21:04.700Z
updated_at: "2026-09-25T23:54:06.266Z"
feature_id: D64

ac_altitude: task-local
---

## 0956. Satisfy the D64 feature-done gate: scenario-key verdict evidence and add dogfood artifact

### Background

Deferred from the D64 runall wrapup (2026-09-25). The ADR-119 feature-done gate (`spur feature check D64 --strict --as done`) fails with these finding codes after the batch merged (4a8f7daa8):

- `L4.verdict-rows-match-no-scenario` ×10 — every task 0937–0946 carries verdict/Testing evidence rows not keyed to feature scenarios (repair per gate: `/sp:dev-verify <wbs>` per task).
- `L4.scenario-unverified` ×10 — same root cause.
- `L4.dogfood-missing` ×1 — no dogfood artifact for D64 (precedents: E7, H14 close commits).
- `L4.feature-receipt-contract` ×1 (observed after wrapall d7cf0c8d5) — the recorded feature-verification receipt predates the wrapall doc-sync commit, so the gate also requires re-running the feature-scoped verification pass (`spur-check-feature`) after the re-keying work ("the selected definition changed after the pass").

Dispositions from the batch: tasks are genuinely done (all runs closed done/done, reviews/verifies PASS); only the scenario KEYING of verdict rows and the dogfood artifact are missing. Digest-defect scare during wrapup was a stale-install artifact: node_modules had ts-dual-workflow-engine 0.5.0 vs lockfile 0.5.6; after `bun install` + `build:bundle` + `bun link` the receipt digest check passes in bundled mode — no code defect.

Scope when picked up: run `/sp:dev-verify 0937..0946` re-keying evidence rows to feature scenarios (or re-record verdicts keyed by scenario/AC-N alias), produce the D64 dogfood artifact, re-run `spur-check-feature` then the strict gate to PASS, then transition D64 verifying → done and sync docs. Batch report: `.spur/run/batch-report-d64-9001.md` (now in the main tree's `.spur/run/`; the batch worktree was removed after full merge).

### Requirements

- [ ] R1. Re-key the recorded verdict evidence of tasks 0937–0946 to D64 feature scenario titles per the coverage map in Design — each covering task re-verified via `/sp:dev-verify <wbs>` (the gate's sanctioned repair), rows titled by the exact scenario text with status MET and overall verdict PASS; existing evidence sentences are preserved, only ids are re-keyed. No production code changes in this task.
- [ ] R2. Produce the D64 dogfood artifact: drive one D64-delivered surface end-to-end, write the report to `docs/dogfood/<date>-d64-<slug>-dogfood.md`, and append the tracked `docs/dogfood/INDEX.md` line whose filename contains a D64 filename segment (the gate predicate reads INDEX.md, not the gitignored reports).
- [ ] R3. Refresh the feature-scoped verification receipt (`bun run spur-check-feature`) so the recorded receipt sha equals the sha used at completion evaluation, clearing `L4.feature-receipt-contract`.
- [ ] R4. Close task 0956 itself (record verdict, status done) before the final gate — `L4.verifying-incomplete-tasks` is an error at the done position until this task is done — then reach `spur feature check D64 --strict --as done` PASS with zero error-severity findings.
- [ ] R5. Transition D64 verifying → done, `spur feature refresh D64`, and sync derived docs in the same commit; tree ends with only intentional changes.

### Acceptance Criteria

- [ ] AC1 — `spur feature check D64 --strict --as done --json` returns `pass: true` with zero error-severity findings (req: R4)
- [ ] AC2 — gate output contains no `L4.verdict-rows-match-no-scenario` and no `L4.scenario-unverified` findings; all ten D64 scenarios verify (req: R1)
- [ ] AC3 — dogfood ledger entry exists: `docs/dogfood/INDEX.md` line with a D64 filename segment plus the report file present in `docs/dogfood/` (req: R2)
- [ ] AC4 — no `L4.feature-receipt-contract` finding: recorded receipt sha equals the completion-evaluation sha (req: R3)
- [ ] AC5 — D64 feature file `status: done`, docs synced in the same commit, `git status` shows only intentional files (req: R5)

(ac_altitude: task-local — the ACs above are gate/process outcomes for this meta-task, not D64 feature scenario coverage; D64 scenario coverage is produced by R1 on tasks 0937–0946.)

### Q&A

<!-- CLOSED decisions from refinement: what was chosen and why, what was deferred and on what
     condition. Not a parking lot for open questions — an unanswered question here means the task
     is not ready to hand off. Keep empty if none. -->

#### Q&A entry — 2026-09-25T23:53:45.191Z

- **In-place JSON edits vs re-verify?** Never edit `.spur/run/<wbs>-verdict.json` directly — bypassing the record chain breaks the receipt trail. Sanctioned path (the gate's own repair hint): `/sp:dev-verify <wbs>` re-verifies evidence against the tree and re-records keyed rows.
- **Keep task-local R rows alongside scenario rows?** No. Any row matching no scenario re-fires `L4.verdict-rows-match-no-scenario`; keyed verdicts carry only scenario-titled rows. Risk: the already-closed tasks' own `spur task check --as done` may regress (task-local requirements no longer mirrored). Canary step 2 detects this on 0937 before the batch; acceptance authority for THIS task is the feature gate. If L3 regression hard-blocks, surface to operator — do not silently waive.
- **A re-verify turns a task non-PASS?** That is a real regression: halt the batch, do not force MET, file a follow-up task, leave the D64 gate open.
- **0947?** Untouched — pre-batch task, zero gate findings.
- **Dogfood scope?** One end-to-end drive of a D64-delivered surface (wrapup-pipeline run or the feature-check flow itself), recorded in the established docs/dogfood report shape (commands + outcomes). INDEX.md is the tracked gate evidence; the report file is the audit trail.
- **Why receipt refresh is last:** any doc/surface mutation after the pass invalidates the fingerprinted receipt again (that is exactly how wrapall `d7cf0c8d5` invalidated the wrapall-time receipt). Refresh order: evidence re-keying → dogfood commit → receipt pass → close 0956 → final gate → transition.

### Design

## Gate mechanics (verified from source)

`spur feature check D64 --strict --as done` (`packages/app/src/services/feature-check.ts`) reads, per covering done task, the recorded verdict artifact `.spur/run/<wbs>-verdict.json` — **authoritative whenever it exists**; the tracked `## Testing` section is fallback only for a missing artifact (F93/0672). Rows match scenarios by exact scenario title or AC-N alias after normalization (strip `Scenario:` / `AC<N>` / `R<N>` prefixes, lowercase, collapse whitespace — `packages/domain/src/bdd/coverage.ts`). A scenario is **verified** iff ANY covering task is `done` with overall PASS and a MET row matching it. Task-local row ids like bare `R1` collide with feature ids but never match a title — that is the entire keying defect.

## Baseline (recorded: `.spur/run/d64-gate-now.json`, 23 findings)

10× `L4.verdict-rows-match-no-scenario` (every task 0937–0946) · 10× `L4.scenario-unverified` (consequence) · 1× `L4.dogfood-missing` · 1× `L4.feature-receipt-contract` (receipt sha256:65989f82… predates wrapall doc-sync `d7cf0c8d5` — definition changed after the pass) · 1× `L4.verifying-incomplete-tasks` (0956 itself; expected until close).

## Coverage map (authoritative — from the gate's own scenario-unverified output)

| Task | Scenarios it must key (row id = exact title) |
| --- | --- |
| 0937 | `R1 — Refactor work starts only after its prerequisite features finish` · `R2 — Every workflow run ends with a classified terminal reason` |
| 0938 | `R3 — A per-workflow cost baseline is reproducible from recorded runs` |
| 0939 | `R6 — Lightweight checks accumulate during development` · `R7 — The comprehensive check runs once at the quality boundary` |
| 0940 | `R4 — Workflow shape changes are accepted only on measured benefit` · `R7 — The comprehensive check runs once at the quality boundary` |
| 0941 | `R5 — Fuzzy branching uses an explicit non-pausing decide action` |
| 0942 | `R8 — The agent fleet is an optional executor surface` |
| 0943 | `R4 — Workflow shape changes are accepted only on measured benefit` · `R9 — Task pipeline routes work by triage lane and failure class` |
| 0944 | `R4 — Workflow shape changes are accepted only on measured benefit` |
| 0945 | `R2 — Every workflow run ends with a classified terminal reason` · `R4 — Workflow shape changes are accepted only on measured benefit` |
| 0946 | `R10 — Catalogue workflows are kept, fixed or retired on evidence` |

Titles are copied verbatim from `docs/features/D64_measured-decision-explicit-check-deduplicated-workflow-catalogue.md`; a single-character drift breaks the match.

## Keying contract

Each re-verify emits, per mapped scenario: row id = exact scenario title, status `MET`, evidence = the task's existing evidence sentence for that scenario (carried over from the current verdict artifact), overall verdict `PASS`. Nothing else in the artifact.

## Dogfood gate predicate (0700 R4 / 0625 R5b)

The gate reads tracked `docs/dogfood/INDEX.md` lines and tests each against `( ^|[^A-Za-z0-9])D64([^A-Za-z0-9]|$)` (case-insensitive) — the feature id must appear as a **filename segment** in the INDEX entry, e.g. `2026-09-26-d64-feature-done-dogfood.md`. `docs/dogfood/*.md` reports are gitignored; INDEX.md is the durable evidence (precedent: F96 close `ee7d885a8`).

## Receipt contract

Verifier `feature-verification@shared` is fingerprinted; recorded sha must equal the evaluating sha at completion. Any doc/surface change after the pass invalidates it (how wrapall invalidated its own receipt). Therefore receipt refresh runs **last**, after all evidence/doc mutations, immediately before the final gate.

## Ordering constraints

0956 close precedes the final gate (incomplete-tasks is an error at done) → final gate PASS → `spur feature transition D64 done`. Transition after PASS, never before.

## Residual risk

L3 task-check regression on re-keyed closed tasks (see Q&A); canary-first contains it. Dogfood report quality is un-gated beyond ledger presence — keep the report honest regardless.

### Plan

1. [ ] Baseline: `spur feature check D64 --strict --as done --json > .spur/run/d64-gate-baseline.json`; confirm the 23 findings match Design.
2. [ ] Canary 0937: `/sp:dev-verify 0937` keyed to the two mapped scenario titles (MET/PASS, evidence preserved) → record → gate stops listing 0937 → `spur task check 0937 --as done` observed for L3 regression (decision point per Q&A).
3. [ ] Batch re-key 0938–0946 per the coverage map, one `/sp:dev-verify <wbs>` each; halt on any non-PASS (real regression → follow-up task).
4. [ ] Intermediate gate: expect only `dogfood-missing` + `feature-receipt-contract` + `verifying-incomplete-tasks` errors remaining.
5. [ ] Dogfood: drive one D64 surface end-to-end → write `docs/dogfood/<date>-d64-<slug>-dogfood.md` → append the INDEX.md line → commit.
6. [ ] Receipt refresh: `bun run spur-check-feature` → receipt-contract finding cleared.
7. [ ] Close 0956: record this task's verdict (AC1–AC5 evidence), status done.
8. [ ] Final `spur feature check D64 --strict --as done --json` → `pass: true`, zero errors.
9. [ ] `spur feature transition D64 done` + `spur feature refresh D64` + doc-sync same commit; `git status` intentional only.

### Solution

<!-- Filled during implementation: file:line change map and concise rationale. -->

### Testing

<!-- Filled during verification: commands run, outcomes, coverage claim or N/A. -->

### Review

<!-- Filled during review: P1-P4 findings, residual risk, and final disposition. -->

### References

<!-- Links to the parent feature, design docs, related tasks, or external references. -->

### History

- 2026-09-25T23:54:06.266Z backlog → todo (system)

