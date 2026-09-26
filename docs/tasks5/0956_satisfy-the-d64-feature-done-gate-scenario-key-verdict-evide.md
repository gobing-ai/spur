---
schema_version: 1
name: "Satisfy the D64 feature-done gate: scenario-key verdict evidence and add dogfood artifact"
status: todo
template: feature-impl
created_at: 2026-09-25T23:21:04.700Z
updated_at: "2026-09-26T00:01:28.366Z"
feature_id: D64

ac_altitude: task-local
---

## 0956. Satisfy the D64 feature-done gate: scenario-key verdict evidence and add dogfood artifact

### Background

Deferred from the D64 runall wrapup (2026-09-25). The ADR-119 feature-done gate (`spur feature check D64 --strict --as done`) fails with these finding codes after the batch merged (4a8f7daa8):

- `L4.verdict-rows-match-no-scenario` ×10 — every task 0937–0946 carries verdict/Testing evidence rows not keyed to feature scenarios (repair per gate: `/sp:dev-verify <wbs>` per task).
- `L4.scenario-unverified` ×10 — same root cause.
- `L4.dogfood-missing` ×1 — no dogfood artifact for D64 (precedents: E7, H14 close commits).
- `L4.feature-receipt-contract` ×1 (observed after wrapall d7cf0c8d5) — the recorded feature-verification receipt predates the wrapall doc-sync commit, the gate requires a fresh receipt from the `feature-verification` workflow after the re-keying work (the bundled-CLI message says "definition changed", but the actual cause is a verifier `sourcePath` mismatch plus stale inputs — see Q&A correction).

Dispositions from the batch: tasks are genuinely done (all runs closed done/done, reviews/verifies PASS); only the scenario KEYING of verdict rows and the dogfood artifact are missing. Digest-defect scare during wrapup was a stale-install artifact: node_modules had ts-dual-workflow-engine 0.5.0 vs lockfile 0.5.6; after `bun install` + `build:bundle` + `bun link` the receipt digest check passes in bundled mode — no code defect.

Scope when picked up: run `/sp:dev-verify 0937..0946` re-keying evidence rows to feature scenarios (or re-record verdicts keyed by scenario/AC-N alias), produce the D64 dogfood artifact, close 0956, record a fresh receipt via the `feature-verification` workflow, then the strict gate to PASS, then transition D64 verifying → done and sync docs. Batch report: `.spur/run/batch-report-d64-9001.md` (now in the main tree's `.spur/run/`; the batch worktree was removed after full merge).

### Requirements

- [ ] R1. Re-key the recorded verdict evidence of tasks 0937–0946 so each mapped D64 scenario has a MET row whose `id` is the task's **full AC label** (e.g. `AC1 — Refactor work starts only after its prerequisite features finish`) per the coverage map in Design; overall verdict PASS. Rows are **additive**: every existing requirement row (`R1`…`Rn`) and its evidence stays; only bare `ACn` ids are replaced by full labels, evidence sentences carried over verbatim. Use the sanctioned correction chain (answer file → `spur task verdict --from-answer` → `spur task record`) so the tracked `## Testing` copy carries the keys too. No production code changes.
- [ ] R2. Produce the D64 dogfood artifact: drive one D64-delivered surface end-to-end, write `docs/dogfood/<date>-d64-<slug>-dogfood.md`, and append the tracked `docs/dogfood/INDEX.md` line containing a `d64` filename segment (the gate reads INDEX.md; reports are gitignored).
- [ ] R3. Close 0956 (verdict recorded, status done) **before** the receipt pass — task record/done writes touch the D64 feature file, which is part of the receipt input digest. 0956's AC section must not contain D64 scenario titles (it would become a covering task and its task-local rows would fire `L4.verdict-rows-match-no-scenario`).
- [ ] R4. Post-close: record a fresh feature-verification receipt with `spur workflow run feature-verification.yaml --vars '{"featureId":"D64"}'` (`bun run spur-check-feature` alone does NOT write a receipt), using the **same `spur` binary** that evaluates the gate; then `spur feature check D64 --strict --as done --json` PASS with zero errors.
- [ ] R5. Transition D64 verifying → done, `spur feature refresh D64`, sync derived docs in the same commit; tree ends with only intentional changes.

### Acceptance Criteria

- [ ] AC1 — After re-keying, `spur feature check D64 --strict --as done --json` contains zero `L4.verdict-rows-match-no-scenario` and zero `L4.scenario-unverified` findings (req: R1)
- [ ] AC2 — `spur task check <wbs> --as done` still passes for every task 0937–0946 (additive re-key causes no L3 regression) (req: R1)
- [ ] AC3 — `docs/dogfood/INDEX.md` has a line with a `d64` filename segment and the report file exists in `docs/dogfood/` (req: R2)
- [ ] AC4 — At 0956 close, the only remaining error findings of the strict done gate are `L4.feature-receipt-*` and `L4.verifying-incomplete-tasks` (0956) (req: R3)

(ac_altitude: task-local — gate/process outcomes for this meta-task. R4/R5 run after 0956 is done by construction — the receipt must follow the last feature-file write — so their evidence lives in the D64 close commit and feature History, not in this task's verdict.)

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

#### Q&A entry — 2026-09-26T00:01:27.921Z

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

#### Q&A entry — 2026-09-25 refinement correction (verified from source)

Supersedes conflicting points in the earlier entry:

- **Scenario-only rows? No — additive.** `L4.verdict-rows-match-no-scenario` fires only when **no** row matches any scenario (`feature-check.ts:920`, `rows.some(...)`), so task-local `R*` rows are harmless. Dropping them would also fail `verify-answer-lint` (missing requirement IDs) and regress L3 `task check --as done`. Keep all rows; re-key only the AC ids.
- **What id matches?** Proven with `normalizeTitle` (`packages/domain/src/bdd/coverage.ts:61`): `AC1` / `R1` → no match; `AC1 — <title>` or `R1 — <title>` → match. Each task's AC label already equals `ACn — <scenario text>`, so the full label also satisfies the lint's "task AC label" identity.
- **Full `/sp:dev-verify` rerun?** Not required. No `<wbs>-verify-answer.txt` survives, but the skill's correction chain (answer file → `task verdict --from-answer` → `task record`) is sanctioned and re-lints anchors against the tree. Reconstruct each answer file from the existing verdict JSON with full-label AC ids. Fall back to `/sp:dev-verify <wbs>` only if lint rejects an anchor (real drift → stop per the earlier entry).
- **Receipt finding is binary-dependent, not "definition changed".** Recorded and evaluated digests are identical; the mismatch is `sourcePath` — bundled `spur` resolves `apps/cli/config/workflows/feature-verification.yaml`, source-local resolves `config/workflows/…` (identical bytes). The source-local CLI reports `L4.feature-receipt-stale` instead (wrapall `d7cf0c8d5` changed inputs). Record and evaluate with one binary (`spur`). The path-identity non-portability is a product defect → follow-up task, out of scope here.
- **Does `spur-check-feature` refresh the receipt?** No — it only runs checks. The receipt is written only by the `feature-verification` workflow (`config/workflows/feature-verification.yaml`).
- **Why close 0956 before the receipt?** Digest = git tree (excl. `docs/tasks*`, `docs/features*`) + normalized feature content + learnings. Task record/done updates the D64 feature file (precedent `2b8e5601a`), so any task write after the receipt makes it stale. Likewise no `sp:dev-wrap`/learnings writes between receipt and gate.

### Design

## Gate mechanics (verified from source)

`spur feature check D64 --strict --as done` (`packages/app/src/services/feature-check.ts`) reads, per covering done task, the recorded verdict artifact `.spur/run/<wbs>-verdict.json` — **authoritative whenever it exists**; the tracked `## Testing` section is fallback only for a missing artifact (F93/0672). Rows match scenarios by exact scenario title or AC-N alias after normalization (strip `Scenario:` / `AC<N>` / `R<N>` prefixes, lowercase, collapse whitespace — `packages/domain/src/bdd/coverage.ts`). A scenario is **verified** iff ANY covering task is `done` with overall PASS and a MET row matching it. Task-local row ids like bare `R1` collide with feature ids but never match a title — that is the entire keying defect.

## Baseline (recorded: `.spur/run/d64-gate-now.json`, 23 findings)

10× `L4.verdict-rows-match-no-scenario` (every task 0937–0946) · 10× `L4.scenario-unverified` (consequence) · 1× `L4.dogfood-missing` · 1× `L4.feature-receipt-contract` (receipt sha256:65989f82… predates wrapall doc-sync `d7cf0c8d5` — definition changed after the pass) · 1× `L4.verifying-incomplete-tasks` (0956 itself; expected until close).

## Coverage map (authoritative — from the gate's own scenario-unverified output)

| Task | Scenarios it must key (row id = full task AC label `ACn — <title>`, equivalently the scenario title) |
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

Additive re-key. Keep every requirement row (`R1`…`Rn`) and evidence unchanged. Replace each bare AC id (`AC1`) with the task's full AC label (`AC1 — <title>`), which normalizes to the mapped scenario title; status `MET`, evidence carried over, overall verdict `PASS`. The gate fires `verdict-rows-match-no-scenario` only when **no** row matches (`feature-check.ts:920`), so non-matching R rows are harmless and are required by `verify-answer-lint`.

## Dogfood gate predicate (0700 R4 / 0625 R5b)

The gate reads tracked `docs/dogfood/INDEX.md` lines and tests each against `( ^|[^A-Za-z0-9])D64([^A-Za-z0-9]|$)` (case-insensitive) — the feature id must appear as a **filename segment** in the INDEX entry, e.g. `2026-09-26-d64-feature-done-dogfood.md`. `docs/dogfood/*.md` reports are gitignored; INDEX.md is the durable evidence (precedent: F96 close `ee7d885a8`).

## Receipt contract

Receipt is written only by `spur workflow run feature-verification.yaml --vars '{"featureId":"D64"}'` (not by `bun run spur-check-feature`). Validation compares verifier name/sourcePath/layer/digest, then the command, then the input digest (git tree excluding `docs/tasks*`/`docs/features*` + normalized feature content + learnings). Current `contract-mismatch` is a `sourcePath` difference between bundled `spur` (`apps/cli/config/workflows/`) and source-local CLI (`config/workflows/`); record and evaluate with the same binary. Any feature-file (incl. task record/done sync), learnings or non-corpus tree change after the pass invalidates it — so the receipt runs last.

## Ordering constraints

Re-key + record → dogfood commit → close 0956 → receipt run → final gate PASS → `spur feature transition D64 done`. 0956 must close before the receipt (its done write touches the feature file); transition only after PASS.

## Residual risk

L3 task-check regression on re-keyed closed tasks (see Q&A); canary-first contains it. Dogfood report quality is un-gated beyond ledger presence — keep the report honest regardless.

### Plan

1. [ ] Baseline: `spur feature check D64 --strict --as done --json > .spur/run/d64-gate-baseline.json`; confirm 23 findings (10 rows-no-scenario, 10 scenario-unverified, dogfood, receipt-contract, incomplete-tasks).
2. [ ] Canary 0937: build `.spur/run/0937-verify-answer.txt` from `0937-verdict.json` (all R rows unchanged; AC rows keyed `AC1 — …`, `AC2 — …`) → `spur task verdict 0937 --from-answer …` → `spur task record 0937` → confirm no record-time drop/no-match warning, the gate no longer lists 0937, and `spur task check 0937 --as done` passes.
3. [ ] Repeat for 0938–0946 per the coverage map; stop on lint rejection or non-PASS (real regression → follow-up task, D64 stays open).
4. [ ] Intermediate gate: only dogfood-missing + receipt + incomplete-tasks errors remain.
5. [ ] Dogfood: drive one D64 surface end-to-end → report → INDEX.md line → commit (together with the re-recorded task files).
6. [ ] File the follow-up task for bundled-vs-source verifier `sourcePath` non-portability (note only, no fix here).
7. [ ] Close 0956: record verdict (AC1–AC4), status done; commit. From here, no task/feature/learnings/tree writes until the gate passes.
8. [ ] Receipt: `spur workflow run feature-verification.yaml --vars '{"featureId":"D64"}'` → PASS.
9. [ ] Final `spur feature check D64 --strict --as done --json` → `pass: true`, zero errors (same `spur` binary as step 8).
10. [ ] `spur feature transition D64 done` + `spur feature refresh D64` + derived-doc sync in one commit; `git status` intentional only.

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

