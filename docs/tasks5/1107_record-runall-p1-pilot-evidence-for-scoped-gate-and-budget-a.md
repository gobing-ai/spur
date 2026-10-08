---
schema_version: 1
name: Record runall-P1 pilot evidence for scoped-gate and budget adoption (feature R, D62 input)
status: done
template: feature-impl
created_at: 2026-10-07T07:29:48.676Z
updated_at: "2026-10-08T15:08:04.470Z"
feature_id: H15

priority: P2
estimate_hours: 2
done_forced: "false"
done_reason: unforced close; PASS artifact at .spur/memory/evidence/1107-verdict.json
---

## 1107. Record runall-P1 pilot evidence for scoped-gate and budget adoption (feature R, D62 input)

### Background

The i31 baseline (`docs/reports/i31/0912-workflow-baseline.md`) marks scoped-gate claims F3/F4 INSUFFICIENT_EVIDENCE pending a pilot sample; the D62 driver-adoption decision (ADR) is blocked on exactly that evidence. Session batch runall-P1-20261006-02 (P1 tasks 1095–1099, 2026-10-06) produced the sample but the numbers live only in the session transcript and gitignored `.spur/run/` driver artifacts (driver tree `spur-new-wt-p1` was removed after merge).

**Refine corrections (2026-10-07)**

- D62 is a **feature** (`docs/features/D62_workflow-execution-economy-*.md`, status done), not an ADR; there is no "D62 adoption note". The pilot criterion lives in the i31 baseline: `docs/reports/i31/0912-workflow-baseline.md:42` defines F3 (full-loss test-fix timeout) / F4 (gate measures tree, not diff) and `:55` requires "sample 3 code-changing runs with retained failing-gate output and diff-attribution before freezing any target". That report is **Frozen (2026-09-22)** — append a dated addendum, never rewrite rows.
- One batch with no retained failing-gate output and no diff attribution probably does **not** meet the `:55` criterion. R3 now maps the sample element-by-element instead of presuming the INSUFFICIENT_EVIDENCE mark converts.
- "1095 ~3.5h" is unsupported: durable timestamps give batch start ≈ 01:32Z → 1095 done 03:52Z (≈ 2h20m).
- "4 per-slice gates replaced by 1 integrated gate (388s)" is not an observation — per-slice gates **did** run in worktrees (1096 10352/0 in 367s; 1097 10356/0). The saving is a projection; 388s is transcript-only.
- "1096–1099 four consecutive first-attempt PASS" is wrong: 1096 needed an AC2 evidence-type patch (~3 min). The briefs were written at 05:04Z, mid-1096.
- The timeout kills were the **pi host subagent limit** ("Subagent timed out after 1800000ms"), not the YAML `implementTimeoutMs` — see 1108.
- The ephemeral sources (`/tmp/p1-batch-state.json`, removed worktree `spur-new-wt-p1`, missing `.spur/memory/sessions/109{5..9}-checkpoint.md`) are snapshotted in Design § Evidence snapshot so the task stays implementable after they vanish.

### Requirements

- [x] R1. A committed report `docs/reports/i31/1107-runall-p1-pilot.md` records the runall-P1-20261006-02 timeline from durable sources: per-task wip/done timestamps (task History), commit and merge SHAs, batch start ≈ 01:32Z, main merge `90a435a0f` at 07:03Z; serial phase 1095→1096, parallel phase 1097–1099. Every number carries a source label: `durable` (git / task History), `transcript` (pi session JSONL path + line), or `projection`.
- [x] R2. The report states gate economy as observed: per-slice full gates ran in worktrees, then one integrated gate (10367 pass / 0 fail over 606 files; 388s `transcript`). The "~28 min → 1 run" saving is labeled `projection`. The verify chain is stated exactly: 1095 fix loop; 1096 PASS after an AC2 evidence-type patch; 1097–1099 PASS; briefs introduced 05:04Z.
- [x] R3. The report maps the sample against the `0912-workflow-baseline.md:55` pilot criterion (≥3 code-changing runs, retained failing-gate output, diff attribution) element-by-element and ends with exactly one verdict token: `criterion met` or `partial — INSUFFICIENT_EVIDENCE retained`, with the unmet elements named.
- [x] R4. `0912-workflow-baseline.md` gains a dated append-only addendum (`## Addendum (2026-10-xx, task 1107)`) citing the report and the R3 verdict; F3/F4 rows are untouched. The D62 feature record gets a Notes pointer through `spur feature` (no direct write).
- [x] R5. The report attributes the 30m kills to the host subagent limit, cites `plugins/sp/skills/spur-dev/references/inline-pipeline-driver.md:600-612` (0727 timeout boundary), and points to 1108 for the fix.

### Acceptance Criteria

- [x] AC1 — The runall-P1-20261006-02 pilot evidence is recorded with source-labeled numbers and mapped against the D62 pilot criterion (req: R1, R2, R3, R4, R5)

### Q&A

<!-- CLOSED decisions from refinement: what was chosen and why, what was deferred and on what
     condition. Not a parking lot for open questions — an unanswered question here means the task
     is not ready to hand off. Keep empty if none. -->

#### Q&A entry — 2026-10-07T16:13:31.606Z

- **Q: Does one batch convert F3/F4 from INSUFFICIENT_EVIDENCE?** A: Not by assumption. The `:55` criterion asks for 3 runs plus failing-gate output plus diff attribution; R3 maps it and the verdict says which elements are unmet. Decided 2026-10-07 refine.
- **Q: Where does the report live?** A: `docs/reports/i31/` beside the baseline it amends, named by WBS like its siblings (`0903-*`, `0912-*`).
- **Q: Edit the Frozen baseline?** A: Append-only dated addendum; rows unchanged.

### Design

Docs-only task; no code.

**Frozen names**

- Report path: `docs/reports/i31/1107-runall-p1-pilot.md` (i31 sibling layout `<wbs>-<slug>.md`).
- Source labels: `durable`, `transcript`, `projection`.
- Verdict tokens: `criterion met` | `partial — INSUFFICIENT_EVIDENCE retained`.
- Addendum heading: `## Addendum (<date>, task 1107)`.

**Report layout:** Summary (verdict first) → Timeline table (task, wip, done, commit, merge, source) → Gate economy → Verify chain → Timeout attribution → Criterion mapping (criterion element | evidence | met?) → Root-cause list (the five session fixes, each tagged with its owning task 1108–1111 or "not productized").

**Evidence snapshot** (copied 2026-10-07 from `/tmp/p1-batch-state.json` and the pi transcript; these sources are ephemeral):

| Fact | Value | Source |
| --- | --- | --- |
| Batch branch / base | `batch-p1-20261006-1832` / `6a2cb7c` | transcript |
| Run ids | 1095 `runall-P1-20261006-01`; 1096–1099 `-02` | transcript |
| 1095 | wip 02:52Z, done 03:52Z, commit `c59d9312c` | durable |
| 1096 | wip 04:37Z, done 05:38Z, commit `93f19a02f`; gate 10352/0 (367s), PASS after AC2 patch | durable + transcript |
| 1097 | done 06:33Z, commit `e36a1636a`, merge `bfe4db572`; gate 10356/0; anchor repair `test.ts:99→:126` (line drift) | durable + transcript |
| 1098 | done 06:26Z, commit `3d4024c6e`, merge `414b62302` | durable |
| 1099 | done 07:01Z, commit `4f682cb96`; 45m timeout while isolating one repo test failure, resumed (subagent `142f32cc`) | durable + transcript |
| Wrap / main merge | `01b2ca063` / `90a435a0f` 07:03Z | durable |
| Integrated gate | 10367 pass / 0 fail, 606 files, 388s | transcript |
| Briefs written | `verify-answer-contract.md` 05:04:48Z (JSONL line 407), `implement-context.md` (line 409) | transcript |
| Timeout kill text | "Subagent timed out after 1800000ms" | transcript |

Transcript: `~/.pi/agent/sessions/--Users-robin-xprojects-spur-new--/2026-10-07T01-27-51-768Z_01a113f9-5cd7-7195-8e4d-b6e7c7643917.jsonl` (compaction summary at line 890; subagent transcripts under `subagent-artifacts/`).

**Anti-patterns**

- Rewriting any Frozen baseline row, or declaring F3/F4 resolved without the criterion mapping.
- Presenting `transcript` or `projection` numbers as measurements; quoting the unsourced "~40% less wall clock".
- Calling D62 an ADR or inventing a "D62 adoption note".
- Estimating durations from conversation timing (the session review itself refused to).

**Dependency handoff:** 1111 reads the R3 verdict — `partial` keeps `deferQualityGate` opt-in and labelled a pilot. 1108 cites R5. No task blocks on this one except 1111.

### Plan

1. Re-verify each durable row: `git show -s --format='%h %cI' <sha>` for every SHA; `spur task show <wbs> --json` History for 1095–1099.
2. Re-read transcript lines 407, 409 and 890 to confirm the `transcript` rows; record path + line beside each.
3. Write `docs/reports/i31/1107-runall-p1-pilot.md` per Design layout.
4. Fill the criterion-mapping table; choose the verdict token.
5. Append the addendum to `docs/reports/i31/0912-workflow-baseline.md`.
6. Add the D62 Notes pointer through `spur feature` (check `spur feature --help` for the section-write verb).
7. `spur task check 1107 --as done --json`; `bun run corpus-check` if the report path is under a checked tree.

### Solution

Docs-only deliverable: a new pilot-evidence report plus two corpus edits. No source or configuration file changed.

| File:line | Change |
| --- | --- |
| `docs/reports/i31/1107-runall-p1-pilot.md:1-13` | New report: summary leading with the verdict (`partial — INSUFFICIENT_EVIDENCE retained`), the source-label contract, and what the batch does establish |
| `docs/reports/i31/1107-runall-p1-pilot.md:17-26` | Timeline table — one row per phase (serial 1095–1096, parallel 1097–1099, wrap, land) with wip/terminal timestamps, commit and merge identifiers, all rows labeled `durable` |
| `docs/reports/i31/1107-runall-p1-pilot.md:23-26` | Serial-vs-parallel established from commit topology: `e36a1636a`, `3d4024c6e` and `4f682cb96` all name `93f19a02f` as their parent, each folded back by its own merge commit, with transcript corroboration |
| `docs/reports/i31/1107-runall-p1-pilot.md:45-52` | Gate economy — per-slice gates named with their real results, the integrated gate `10367 pass / 0 fail · 606 files · [388.07s]`, and the "~28 min saved" claim explicitly labeled `projection` |
| `docs/reports/i31/1107-runall-p1-pilot.md:61-68` | Timeout attribution — both kills named as host subagent notifications and `implementTimeoutMs` explicitly ruled out as the cause, fix owner 1108 |
| `docs/reports/i31/1107-runall-p1-pilot.md:70-79` | Criterion mapping — element-by-element table against the frozen `:55` criterion, closing with the single verdict token |
| `docs/reports/i31/0912-workflow-baseline.md:78-92` | Append-only dated addendum citing the report, the criterion mapping and the F3 note; F3/F4 rows untouched |
| `docs/features/D62_workflow-execution-economy-contract-first-stages-inline-traceability-and-graph-retirement.md:227-231` | D62 Notes pointer to the report and the R3 verdict, written through `spur feature update D62 --section Notes --from-file` |

**Rationale.** The deliverable is evidence, so every number carries a provenance label and every disputed number from the brief was re-derived from a durable source rather than restated: the missing merge commit came from the git graph, the parallel phase from commit topology, and the brief's "1096 10352/0 (367 s)" is reported as contradicted by the transcript. The baseline is amended append-only because it is frozen; the D62 pointer routes through the feature CLI, so no frozen row and no direct corpus write are involved. 1111 consumes the verdict, so the report states explicitly that `partial` keeps `deferQualityGate` opt-in.

### Testing

**Pipeline verify results**

- Verdict: PASS (from verdict artifact)
- Confidence: HIGH

| Requirement | Status | Evidence |
|-------------|--------|----------|
| R1 | MET | Timeline section from durable sources at `docs/reports/i31/1107-runall-p1-pilot.md:15` (re-read this run) |
| R2 | MET | Gate economy section `docs/reports/i31/1107-runall-p1-pilot.md:38`; integrated gate row 10367 pass / 0 fail at `docs/reports/i31/1107-runall-p1-pilot.md:48`; projection labelled separately in the same section |
| R3 | MET | Criterion mapping against the 0912 pilot criterion at `docs/reports/i31/1107-runall-p1-pilot.md:70`; verdict token at `docs/reports/i31/1107-runall-p1-pilot.md:81` |
| R4 | MET | Dated append-only addendum at `docs/reports/i31/0912-workflow-baseline.md:78`; D62 Notes pointer at `docs/features/D62_workflow-execution-economy-contract-first-stages-inline-traceability-and-graph-retirement.md:229` |
| R5 | MET | Timeout attribution section `docs/reports/i31/1107-runall-p1-pilot.md:61`; timeout-boundary citation refreshed this run to `plugins/sp/skills/spur-dev/references/inline-pipeline-driver.md:639` (heading "Timeout boundary (task 0727, amended by task 1108)"), recorded in References at `docs/reports/i31/1107-runall-p1-pilot.md:102` |

| Acceptance Criteria | Status | Evidence Type | Evidence |
|---------------------|--------|---------------|----------|
| AC1 | MET | command | `grep -c '^ |
| R5 — The runall-P1-20261006-02 pilot evidence is recorded with source-labeled numbers and mapped against the D62 pilot criterion | MET | command | Same command set as AC1 run this run; Source-labeled integrated gate row `docs/reports/i31/1107-runall-p1-pilot.md:48`; criterion mapping `docs/reports/i31/1107-runall-p1-pilot.md:70`; baseline addendum `docs/reports/i31/0912-workflow-baseline.md:78` |
- Coverage: N/A (verdict-based; verify pipeline does not measure code coverage)

### Review

**Verdict: PASS** — 3-dimensional review (functional traceability, SECUA, architecture depth) over a docs-only diff. Executed in-session by the inline driver; reviewer independence is not achievable on the host-inline path (recorded limitation, P4).

**Requirement traceability**

| Req | Status | Evidence |
| --- | --- | --- |
| R1 | MET | `docs/reports/i31/1107-runall-p1-pilot.md` `## Timeline` — SHAs re-read with `git show -s --format='%h %cI'`, wip/done from task History, source labels declared in the header |
| R2 | MET | `## Gate economy` (per-slice gates named; integrated gate 10367/0 over 606 files, 388.07s labelled `transcript`; saving labelled `projection`); `## Verify chain` corrects the brief's "1096 first-attempt PASS" claim |
| R3 | MET | `## Criterion mapping against 0912-workflow-baseline.md:55` — element-by-element, ends with the single token `partial — INSUFFICIENT_EVIDENCE retained`, unmet elements named |
| R4 | MET | Addendum diff is 17 insertions / 0 deletions (append-only, F3/F4 rows untouched); D62 pointer written through `spur feature update D62 --section Notes --from-file` (`feature.updated`) |
| R5 | MET | `## Timeout attribution` cites `plugins/sp/skills/spur-dev/references/inline-pipeline-driver.md:600-612` and names 1108 as the fix owner |

**Findings**

| P | Finding | Disposition |
| --- | --- | --- |
| P3 | Timeline omitted 1099's merge SHA `c3542bd32` (R1 requires merge SHAs) | fixed in-flight from the git graph |
| P4 | The F3 "characterized" row is not one of the `:55` criterion's three named elements | accepted as clearly-marked context |
| P4 | This run's missing `check-receipt.json` (gate ran before digest capture) is recorded only in the run log | accepted — out of the report's subject |
| P4 | In-session review (no independent reviewer on the inline path) | accepted — P2 task, no distinct-executor policy |

No P1/P2 findings. Residual risk: single-transcript study by construction; every such row is labelled.

### References

- Feature: `docs/features/H15_batch-execution-performance-productization-budget-defaults-integrated-gates-shipped-worker-briefs.md`
- Baseline and criterion: `docs/reports/i31/0912-workflow-baseline.md:42`, `docs/reports/i31/0912-workflow-baseline.md:55`
- D62 feature: `docs/features/D62_workflow-execution-economy-*.md`
- Timeout boundary: `plugins/sp/skills/spur-dev/references/inline-pipeline-driver.md:600-612`
- Related: 1108 (budget), 1110 (briefs), 1111 (deferred gate)

### History

- 2026-10-07T07:34:13.238Z backlog → todo (system)
- 2026-10-07T18:03:06.303Z todo → wip (system)
- 2026-10-07T18:32:29.503Z wip → testing (system)
- 2026-10-07T18:34:41.616Z testing → done (system)

### Notes

Re-homed: created under transient root feature "R", then moved to H15 (spur-dev umbrella family, owner of 0931 parallel batch isolation) with the rest of the batch-execution performance set. Source anchors for the numbers: batch commits `c59d9312c`…`4f682cb96` + wrap `01b2ca063` + merge `90a435a0f` (git history is the durable record); scratch state `/tmp/p1-batch-state.json` may be gone — do not depend on it. Report contract: see `sp:spur-dev` plan/report templates (`references/document-authoring.md`); place under `docs/reports/` following the i31 baseline's sibling layout. Do not edit the ADR text of D62 itself — cite it from the baseline rows and the report; adoption wording belongs to the decision owner.

