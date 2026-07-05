---
template: review
schema_version: 1
name: Consolidated sp-dev-refine auto-next dogfood findings (16 runs, F1-F26) for remediation
description: ""
status: done
type: task
profile: standard
parent_wbs: null
priority: P1
tags: [review,dogfood,sp-dev-refine,sp-dev-dogfood,findings]
dependencies: []
created_at: 2026-07-04T16:09:49.635Z
updated_at: 2026-07-04T16:04:00.000-07:00
---

## 0211. Consolidated sp-dev-refine auto-next dogfood findings (16 runs, F1-F26) for remediation

### Background
Consolidated review of the 16-run `/sp-dev-dogfood` series driven against the `/sp-dev-refine --auto --next` testee between 2026-07-04 sessions. All 16 reports live in `docs/dogfood/2026-07-04-sp-dev-refine-*-auto-next-dogfood.md` (gitignored, local-only per task 0182 Q1=(b)).

**Scope of this consolidation:** de-duplicate every distinct finding (F1–F26, F15 absent) across all 16 reports into one actionable set, map to fix targets, and stage remediation tasks. The 16 runs cover the complete natural task corpus: every task in the repo was tested (WBS 0191–0197, 0199, 0202–0210), spanning all 5 cycle features (F6, J, F8, G2, G3), all 3 non-terminal statuses (`todo` 11×, `wip` 3×, `blocked` 1×), priorities P1–P3, every dependency topology (leaf, parent pre/post-decomposition, capstone, wave, cross-feature, soft dep, negative dep, content-gate, merge-event gate), and every HITL gate variant (pre/post, parent/child, depth-2 transitive). Saturation: F1/F2×2/P3-cache hit 16/16 runs; F9 at 10 data points; F10 at 9 positive + 3 negative cases.

**What already checked out clean (do NOT re-fix):** canonical gates (`bun run lint`, `bun run test`, `bun run test-cf`, `bun run build`) were not run in this consolidation session — they are the responsibility of the remediation tasks, not this review. The testee (`sp-dev-refine`) and driver (`sp-dev-dogfood`) skills themselves are sound at the protocol level; findings target specific gaps in their defaults, SKIP-gate set, lifecycle coverage, and prerequisite/gate semantics — not architectural rework.

**Prior related work (already shipped, do not duplicate):**
- Task **0135** (done) shipped the `--max-retry 2` default + observe-only opt-in to `sp-dev-dogfood` — the **warning** variant (option b). This task's F1 sharpens that to **refuse-on-ambiguity** after 16/16 saturation proved the warning insufficient: the default still mutates the tree whenever `--next`/`run`/`runall`/`wrap`/`idea` appears in the testee and the operator forgets `--max-retry 0`. An auto-clamp was considered and rejected — `--max-retry 0` only governs the driver's fix loop; the testee's `--next` chain retains full `Edit`/`Write`/`Bash` access (`allowed-tools` line 5) and mutates anyway, so a clamp would advertise safety it cannot deliver.
- Task **0136** (done) shipped a deterministic CLI warning when `--next` is ignored in full mode — different surface (CLI), retained as related context.
- Task **0152** (done) normalized task status before lifecycle transitions — F9 (status-keyed `task check`) is a distinct, deeper issue: `task check` returns `pass: true` for tasks with empty Design/stub Plan and unmet prerequisites because it keys on current status, not on readiness or prerequisite satisfaction.
- Task **0182** (done) remediated the dogfood report contract and is the upstream authority on report shape; this task's reports already conform to that contract.

**Method:** every finding below was extracted from the report Findings sections and Monitor Ledgers across all 16 files, then de-duplicated by semantic identity (not by F-number — prior sessions used F1–F10 for different findings). Severity assignment follows the report contract: P1 = blocks correctness/safety, P2 = latent gap or operator-surprise, P3 = quality/UX, P4 = observation/future-hardening.

**Buglog cross-reference:** new buglog entries to be filed by the remediation tasks (one per fix wave). This task files none itself — it is the consolidation/triage artifact, not the fix.

#### Review Findings

| Severity | File | Finding | Recommendation |
| -------- | ---- | ------- | -------------- |
| P1 | `.rulesync/skills/sp-dev-dogfood/SKILL.md` (default table + `allowed-tools` line 5); `plugins/sp/commands/dev-dogfood.md:35` | **F1** — `/sp-dev-dogfood` defaults to fix mode (`--max-retry 2`) and silently forwards that default into a `--next`-chained testee, which would launch the implementation pipeline against the working tree with no confirmation. Saturated 16/16 runs. Task 0135 shipped the warning-only variant; 16 runs prove it insufficient. **Deeper gap (enhanced):** an auto-clamp to `--max-retry 0` would still be partial protection — `--max-retry 0` only governs the driver's own fix loop; the testee's `--next` chain retains full `Edit`/`Write`/`Bash` access (`allowed-tools: ["Bash","Read","Write","Edit","Grep","Glob","Skill"]`, SKILL.md:5) and mutates the tree regardless. A clamp would advertise safety it cannot deliver. | **Refuse-on-ambiguity (option b):** when the testee contains `--next`/`run`/`runall`/`wrap`/`idea` AND `--max-retry` is not explicit, exit non-zero with an error requiring the operator to choose: `--max-retry 0` (observe-only — driver applies no fixes; note the testee chain may still mutate via its own tool access) or `--max-retry N` (fix mode, tree-mutation risk acknowledged). Refusing to guess is the correct default at a mutation consent boundary. Rejected auto-clamp (option a): it misleads the operator into believing the run is safe when the testee's chain still mutates. |
| P2 | `.rulesync/skills/sp-dev-refine/SKILL.md:71-76` | **F2** — SKIP-gate target-section set is `{Background, Requirements, Plan}` but refine reads/updates `### Design` and `### Acceptance Criteria` as first-class outputs (`SKILL.md:11,70`; `dev-operations.md:103`). A task with L3 issues only in Design still SKIPs — testee declares "meets L3" while a section it owns is malformed. Saturated 16/16. | Widen the SKIP set to `{Background, Requirements, Plan, Design, Acceptance Criteria}`, OR document explicitly why Design/AC are excluded (e.g. "AC correctness owned by `spur feature check`"). Prefer widening. |
| P2 | `.rulesync/skills/sp-dev-refine/SKILL.md` Workflow step 6 (the `--next` chain step, lines 88-94) | **F3** — `--next` chain behavior under a clean SKIP is specified for the testee but not surfaced to the operator at invocation. "refine --auto --next on a well-specified task" silently becomes "run the implementation pipeline". An operator wanting refinement only has no inline signal that `--next` is about to implement code. Saturated 16/16. | Print a one-line pre-chain notice when `--next` is set and `status >= todo`: `→ refining <wbs>: SKIP, chaining to /sp-dev-run (will implement)`. |
| P3 | (structural, no single file) | **F4** — aggregate cache% across the 16 runs is 47%, below the 50% floor. Dominant cause is structural: step 6's would-be `/sp-dev-run` output is fresh by definition, and the testee is a thin wrapper producing little reusable text. Observation only — no testee defect. | Observation only. If aggregate cache% stays <50% after fix-mode runs become available, consider trimming the `sp-spur-dev` reference preamble loaded per refine invocation. Do NOT block on this. |
| P4 | `.rulesync/skills/sp-dev-refine/SKILL.md:67` | **F4-task-resolve** — `SKILL.md:67` tells the operator `spur task resolve` is "the inverse (file-path → owning WBS)" and not to use it for WBS→file. Correct, but the verb name still reads like the WBS→file lookup a refine caller wants; the warning is defensive doc, not a code guard. (Run 0202 only.) | Optional: add a `spur task path <wbs>` cross-reference pointer at the top of the Workflow section so the canonical WBS→file verb is the first thing seen. ~trivial. |
| P4 | (display-side artifact) | **F5** — file reader truncates Background and Design at ~768 chars (visible `[Some lines truncated to 768 chars]` marker). `spur task check` reads the file directly and returned zero findings, so truncation is a display-side artifact of the read tool, not a spec gap. (Runs 0202, 0203.) | Optional: document the truncation limit in the refine operator guide so it is not mistaken for an incomplete section. No code change unless the truncation limit is configurable. |
| P4 | `.rulesync/skills/sp-dev-refine/SKILL.md` (parent-task `--next` semantics) | **F6/F7** — parent-task `--next` semantics under observe-only are underspecified. Confirmed on 0191, 0193, 0195 (pre- and post-decomposition). Refine does not document whether `--next` on a parent chains to children, dispatches to a wave, or requires explicit decomposition first. F7 is the stable confirmation; F6 is the parent-level observation. | Document parent `--next` semantics explicitly: does it chain per-child, dispatch the first ready child, or refuse until decomposed? Pick one and document it. Folds into the prerequisite-aware readiness task (see Design). |
| P4 | `packages/app/src/services/task-check.ts` | **F8** — `task check` ignores reverted-lifecycle state. History shows `todo → wip → testing → done → todo` cycles; a reverted-`done` task at `todo` with empty Solution/Testing/Review passes `task check` because the checker is status-keyed, not history-keyed. Almost certainly correct (status is SSOT), but a reverted-`done` task is indistinguishable from never-started. (Run 0192.) | Observation. If reverted-`done` becomes a recurring confusion, consider a history-aware advisory WARNING (not error) in `task-check`. Low priority. |
| P4 | `packages/app/src/services/task-check.ts` | **F9** — `task check` is status-keyed with zero prerequisite visibility. Returns `pass: true` for: tasks with empty Design + stub Plan (0197); tasks with unmet hard deps (0202 dep 0192 `todo`); tasks with unmet soft deps (0194 dep 0189 `wip`); parent tasks whose children are all `todo` (0191, 0193, 0195); tasks blocked behind HITL gates (0207 R1); tasks with content-gates (0197). Confirmed at 10 data points across every topology. | Add prerequisite-aware readiness to `task-check` (or a new `task readiness` verb): traverse `dependencies` + gate conditions, AND semantics for multi-branch fan-in, recurse transitively. Folds into the prerequisite-aware readiness task. |
| P4 | `packages/app/src/services/task-service.ts` (frontmatter `dependencies` enforcement) | **F10** — prose-vs-frontmatter dependency discrepancy is systemic. Every task with prose-declared dependencies has empty frontmatter `dependencies: []` (9 positive cases); three negative cases (0197's three gate conditions, 0194's negative deps, 0206's cross-feature dep) confirm a lint rule should treat prose-declared deps and gate conditions as prerequisites missing from frontmatter. Most-mentioned finding (75 mentions). | Add a lint rule (or extend `task-check`) that scans Requirements/Design prose for dependency-like phrases ("depends on", "gated on", "blocked by", "after X") and reconciles them against frontmatter `dependencies`. Folds into the prerequisite-aware readiness task. |
| P4 | `.rulesync/skills/sp-dev-refine/SKILL.md` (cross-feature dep + `--next`) | **F11** — cross-feature dependency + `--next` interaction is undocumented. 0206 (feature J) depends on 0199 (feature G2); refine `--next` on 0206 would chain without acknowledging the cross-feature gate. (Run 0206.) | Document cross-feature dep handling in the refine operator guide; ensure the prerequisite-aware readiness task treats cross-feature deps identically to intra-feature deps. |
| P4 | `.rulesync/skills/sp-dev-refine/SKILL.md` (layered dep blocking) | **F12** — layered dependency blocking is invisible to refine. 0193 depends on 0189 (`wip`); 0204/0205/0206 depend on 0193. Refine on a child does not surface the transitive blocker. (Run 0193.) | Transitive prerequisite traversal in the prerequisite-aware readiness task. |
| P4 | `.rulesync/skills/sp-dev-refine/SKILL.md` (soft dep qualifier) | **F13** — soft dependency qualifier ("soft dep", "should follow") is parsed by humans but not by the system. 0194 soft-depends on 0189; refine treats it as ready. (Run 0194.) | Decide: model soft deps explicitly (frontmatter `soft_dependencies`), or document that soft deps are advisory-only and refine ignores them by design. |
| P4 | `.rulesync/skills/sp-dev-refine/SKILL.md` (negative dep enumeration) | **F14** — negative dependencies ("not X, not Y") in prose are not modeled. 0194 lists negative deps 0190/0192/0193/0195; these are mutually-exclusive alternatives, not prerequisites. (Run 0194.) | Document that negative deps are scope statements, not prerequisites; refine correctly ignores them. Observation. |
| P4 | `config/workflows/task-pipeline.yaml` (HITL gate — pre) | **F16 (a)** — pre-gate HITL blocks chain start. Parent 0195 has children with R1 pre-gates; `is_ready()` does not reflect the gate. (Run 0195, run 0207.) | Model HITL pre-gates as prerequisite conditions in the readiness task. |
| P4 | `config/workflows/task-pipeline.yaml` (HITL gate — post) | **F16 (b)** — post-gate HITL blocks chain completion. 0196 has R6 post-implementation approval gate; `is_done()` does not reflect the unapproved gate. (Run 0196.) | Model HITL post-gates as completion conditions in the readiness task; distinguish pre-gate (readiness) from post-gate (done-ness). |
| P4 | `apps/cli` (SQLite lock UX) | **F17** — CLI SQLite lock (`SQLITE_BUSY`) surfaces as a raw stack trace, not a friendly message. Recurring ~1/8 runs (2/16). (Runs 0207, 0209.) | Catch `SQLITE_BUSY` in the CLI error handler and emit a one-line retry suggestion. Small, standalone or attached to the readiness task. |
| P4 | `.rulesync/skills/sp-dev-refine/SKILL.md` (transitive HITL blocking) | **F18** — depth-2 transitive HITL chain is invisible to refine. 0209 → 0208 → 0207 (R1 HITL gate); refine on 0209 does not surface the depth-2 gate. (Runs 0208, 0209, 0210, 0211.) | Depth-N transitive gate traversal in the readiness task. |
| P4 | `.rulesync/skills/sp-dev-refine/SKILL.md` (capstone ordering) | **F19** — capstone task ordering audit. 0210 (wave D capstone) must run after waves A/B/C; refine does not verify capstone-last ordering. (Run 0210.) | Capstone-ordering assertion in the readiness task: a task depending on its siblings must run last. |
| P4 | `.rulesync/skills/sp-dev-refine/SKILL.md` (multi-branch fan-in) | **F20** — multi-branch fan-in AND semantics. 0210 depends on 0208 AND 0199 (two independent branches); both must be done. Refine does not model AND semantics across branches. (Run 0210.) | AND semantics in the readiness task: all `dependencies` entries must be `done` (not just any one). |
| P4 | `.rulesync/skills/sp-dev-refine/SKILL.md` (parent `wip` status) | **F21** — parent `wip` status semantics undefined. Parent 0195 is `wip` while all 4 children are `todo`; refine does not document whether `wip` on a decomposed parent means "children in progress" or "parent work in progress". (Run 0195.) | Document parent-status aggregation rules in the refine operator guide; decide whether parent `wip` is derived from children or set independently. |
| P4 | `.rulesync/skills/sp-dev-refine/SKILL.md` (decomposed-parent `--next`) | **F22** — decomposed-parent `--next` chain semantics undefined. Does `--next` on 0195 dispatch the first ready child, run them in wave order, or refuse? (Run 0195.) | Define and document decomposed-parent `--next` dispatch behavior. Folds into the prerequisite-aware readiness task. |
| P4 | `config/workflows/task-pipeline.yaml` (design-doc pipeline fit) | **F23** — design-doc tasks (docs-only deliverable, e.g. 0196) are routed through the code pipeline (`implement`/`test`/`verify`) which has no concept of a docs gate. (Run 0196.) | Pipeline-mode extension: detect docs-only deliverables and route to a docs gate instead of the code gate. Separate subsystem — standalone task. |
| P4 | `config/workflows/task-pipeline.yaml` (merge-event gate) | **F24** — merge-event gate type (0196 depends on "0193 merged", not "0193 done"). The pipeline models status gates but not merge events. (Run 0196.) | Add a `merge_event` gate type to the pipeline (or model merge as a status transition). Folds into the prerequisite-aware readiness task as a new gate type. |
| P4 | `.rulesync/skills/sp-dev-refine/SKILL.md` (lifecycle, lines 78-94) | **F25** — `blocked` status unguarded. Refine lifecycle lists `todo → wip` but never mentions `blocked`. Refine ran on 0197 (`blocked`) without complaint, treating `blocked` as `todo`. SKIP fired vacuously. First `blocked`-status task tested. (Run 0197.) | Add `blocked` to the refine lifecycle: either refuse to refine a `blocked` task, or require explicit `--force` with a stated reason. Folds into the prerequisite-aware readiness task as a status guard. |
| P4 | `.rulesync/skills/sp-dev-refine/SKILL.md` (SKIP-gate, lines 71-76) | **F26** — content-gate / empty Design by intent. 0197's Design is a single "GATED" note; Plan is 5 stub items — content intentionally absent pending 0196's design-doc deliverable. SKIP-gate considers Plan exists/stub-shaped but has no concept of "empty by intent". SKIP reason was vacuous ("no L3 findings"). (Run 0197.) | SKIP-gate awareness of content-gates: if a task's Design/Plan references a gate condition (e.g. "GATED on <wbs>"), SKIP should fire with a stated reason, not vacuously. Folds into the prerequisite-aware readiness task. |
### Requirements
- R1 (F1). **`/sp-dev-dogfood` refuses to guess on pipeline-driving testees.** When the testee string contains any of `--next`, `run`, `runall`, `wrap`, `idea` AND `--max-retry` is not explicitly passed, the command exits non-zero with a one-line error: `⚠ pipeline-driving testee detected; pass --max-retry 0 (observe-only) or --max-retry N (fix mode, tree mutation acknowledged)`. No default substitution. Explicit `--max-retry` (any value) is the only path forward and proceeds without warning. Rationale: `--max-retry 0` only governs the driver's fix loop; the testee's `--next` chain retains its own tool access and can mutate regardless — so the driver cannot safely pick a "safe" default and must defer the decision to the operator. Target: `.rulesync/skills/sp-dev-dogfood/SKILL.md` default table + repo-mutation warning block + `plugins/sp/commands/dev-dogfood.md:35` + the protocol body where `--max-retry` is consumed.
- R2 (F2). **SKIP-gate section set widened.** `.rulesync/skills/sp-dev-refine/SKILL.md:71-76` SKIP set becomes `{Background, Requirements, Plan, Design, Acceptance Criteria}`. A task with L3 issues only in `### Design` or `### Acceptance Criteria` no longer SKIPs. (If the team decides AC is owned by `spur feature check`, document that exclusion explicitly in the same section — but the default widen includes both.)
- R3 (F3). **`--next` pre-chain notice.** `.rulesync/skills/sp-dev-refine/SKILL.md` Workflow step 6 prints a one-line notice before chaining when `--next` is set and `status >= todo`: `→ refining <wbs>: SKIP, chaining to /sp-dev-run (will implement)`. The notice is surfaced to the operator at invocation, not buried in testee-internal spec.
- R4 (F9, F10, F12, F20, F24, F25, F26 — prerequisite-aware readiness). **`task-check` (or new `task readiness`) gains prerequisite-aware readiness gating.** Unified `prerequisites` frontmatter model: traverse `dependencies` + gate conditions with AND semantics (all must be `done`); recurse transitively (depth-N); treat gate conditions (HITL pre/post, merge-event, content-gate, capstone-ordering) as prerequisites; guard `blocked` status (refuse or require `--force`); surface content-gate "empty by intent" with a stated SKIP reason. Fold F7 (parent `--next`), F11 (cross-feature dep), F13 (soft dep qualifier — model or document-as-advisory), F14 (negative deps — document-as-scope), F16 (HITL pre+post), F18 (transitive HITL), F19 (capstone ordering), F21 (parent `wip` semantics), F22 (decomposed-parent dispatch) into this single design. This is the large requirement — decompose before implementing.
- R5 (F17). **CLI SQLite lock UX.** `apps/cli` error handler catches `SQLITE_BUSY` and emits a one-line retry suggestion instead of a raw stack trace. Small, standalone.
- R6 (F23). **Pipeline-mode extension for design-doc tasks.** `config/workflows/task-pipeline.yaml` (or a sibling pipeline) detects docs-only deliverables and routes to a docs gate (`docs-review` state) instead of the code gate (`implement`/`test`/`verify`). Distinct subsystem from R4 — standalone task.
- R7 (F4-cache). **Cache-health observation logged, no code change.** F4 (aggregate cache% 47% < 50% floor) is structural and observation-only. Record the data point; revisit only if fix-mode runs stay <40%. Do NOT block on this.
- R8 (F4-task-resolve, F5, F8). **Documentation-only findings, batched.** F4-task-resolve: add `spur task path <wbs>` cross-reference at the top of the refine Workflow section. F5: document the 768-char truncation limit in the refine operator guide. F8: document that `task check` is status-keyed by design (reverted-`done` is indistinguishable from never-started); add a history-aware advisory only if confusion recurs. All three are ~trivial doc additions; bundle into one PR.
- R-gates. **Canonical verification.** `bun run lint`, `bun run test`, `bun run test-cf`, `bun run build` all pass; no test skipped or suppressed; `spur task check 0211 --json` passes at each lifecycle transition; touched `.rulesync/` skills re-sync to all `.rulesync/.targets/*/` via the standard sync step (operator or CI).

**Out of scope (do not expand):** redesign of the pipeline state graph beyond the docs-gate addition (R6); redesign of the dogfood report contract (already shipped in 0182); retrofitting Monitor Ledgers into legacy reports; changes to `@gobing-ai/ts-*` packages (fixes stay in the spur layer using already-exported helpers, or surface as upstream requests via the standard shared-library evolution process). Observe-only `--next` chain end-to-end exercise is out of scope as a testee defect (driver decision).
### Acceptance Criteria
| AC | Maps to | Given / When / Then | Verification |
| --- | --- | --- | --- |
| AC1 [core][behavior] | R1 | Given `/sp-dev-dogfood "/sp-dev-refine 0191 --auto --next"` with no explicit `--max-retry`, when the command runs, then it exits non-zero with an error requiring the operator to pass `--max-retry 0` or `--max-retry N`. Given the same invocation with explicit `--max-retry 0`, then it proceeds in observe-only mode. Given explicit `--max-retry 2`, then it proceeds in fix mode. | Manual run with output captured (3 cases: omitted, `0`, `2`); `rg -n 'pipeline-driving\|pass --max-retry' .rulesync/skills/sp-dev-dogfood/SKILL.md` ≥ 1 in the error/default section. |
| AC2 [core][behavior] | R2 | Given a task with L3 issues only in `### Design` (Background/Requirements/Plan clean), when refine runs the SKIP-gate, then it does NOT SKIP (the widened set catches Design). | Construct a probe task; run refine; assert non-SKIP. `rg -n 'Design\|Acceptance Criteria' .rulesync/skills/sp-dev-refine/SKILL.md` resolves inside the SKIP-set definition. |
| AC3 [core][behavior] | R3 | Given refine with `--next` set and `status >= todo`, when the SKIP passes, then a one-line pre-chain notice is printed before the chain fires. | Manual run; `rg -n 'chaining to' .rulesync/skills/sp-dev-refine/SKILL.md` ≥ 1 in Workflow step 6. |
| AC4 [core][behavior] | R4 | Given a task with an unmet prerequisite (hard dep, gate condition, content-gate, or `blocked` status), when `spur task check <wbs> --json` runs, then the response reports the unmet prerequisite (non-empty `findings` or a dedicated `readiness` field). | Construct probe tasks for each prerequisite type (hard dep, soft dep, HITL pre-gate, HITL post-gate, content-gate, capstone-ordering, merge-event, `blocked` status); run `task check --json`; assert non-empty findings for each. This is the large AC — decompose R4 into sub-requirements before implementing. |
| AC5 [core] | R5 | Given a CLI invocation that hits `SQLITE_BUSY`, when the error surfaces, then the output is a one-line retry suggestion (no raw stack trace). | Inject a busy-lock scenario (or unit-test the error handler with a mocked `SQLITE_BUSY`); assert friendly message. |
| AC6 [core][behavior] | R6 | Given a design-doc task (docs-only deliverable), when routed through the pipeline, then it passes through a `docs-review` gate (not `implement`/`test`/`verify`). | `spur workflow validate` on the extended/new pipeline; a probe design-doc task driven through it. |
| AC7 | R7 | Given the cache-health data point (47% aggregate), then it is recorded in this task's Testing section and no code change is made for F4-cache. | Read the Testing section. |
| AC8 | R8 | Given the refine operator guide, then it contains the `spur task path` cross-reference (F4-task-resolve), the 768-char truncation note (F5), and the status-keyed `task check` design note (F8). | Manual read; `rg -n 'spur task path\|768\|status-keyed' .rulesync/skills/sp-dev-refine/SKILL.md` (or operator guide). |
| AC9 [core] | R-gates | Given all fixes landed, then `bun run lint` + `bun run test` + `bun run test-cf` + `bun run build` pass and `git status -s` shows only intentional changes. | Command outputs captured in `### Testing`. |

**Notes for the verifier:** rows tagged `[core][behavior]` require ≥1 `test` or `command` evidence row per the Wave C evidence rule. AC4 is the high-risk AC — it consolidates 12 findings (F9/F10/F12/F20/F24/F25/F26 + folded F7/F11/F13/F14/F16/F18/F19/F21/F22) and must be decomposed into sub-ACs before implementation. Recommend splitting R4 into its own task (0212 or similar) once this task is refined.
### Q&A
Open operator decisions — resolve BEFORE the wave that consumes them (blocking items marked). Record each answer here with a date line when decided.

- **Q1 (blocks R4 — the large requirement): split R4 into its own task, or keep as a single requirement in 0211?** R4 consolidates 12 findings (F9/F10/F12/F20/F24/F25/F26 + folded F7/F11/F13/F14/F16/F18/F19/F21/F22) into one prerequisite-aware readiness design. The natural decomposition is: (a) unified `prerequisites` frontmatter model + lint reconciliation (F10); (b) recursive readiness audit with graph traversal (F9, F12, F20); (c) gate-condition modeling — HITL pre/post (F16), merge-event (F24), content-gate (F26), capstone-ordering (F19); (d) parent/decomposed-parent semantics (F7, F21, F22); (e) `blocked`-status guard (F25); (f) cycle defense + AND semantics. Options: (i) **keep R4 in 0211 as a single requirement, decompose at implementation time** — recommended for traceability (one task owns the whole prerequisite-aware design); (ii) split R4 into a child task 0212 now — cleaner scope but adds a decomposition step before any work starts. Recommend (i); revisit if R4 estimate exceeds ~24h.
- **Q2 (blocks R2): widen SKIP-set to include both Design AND AC, or only Design?** Options: (a) **both** — recommended: refine owns both as first-class outputs (`SKILL.md:11,70`); (b) Design only — if the team considers AC correctness owned by `spur feature check`; (c) document the exclusion explicitly and do not widen. Recommend (a).
- **Q3 (blocks R6): new pipeline YAML or extend `task-pipeline.yaml`?** Options: (a) **new `docs-pipeline.yaml`** — recommended: keeps the code pipeline clean, design-doc tasks route differently from day one; (b) extend `task-pipeline.yaml` with a `deliverable: docs` discriminator — more coupling but one pipeline to maintain. Recommend (a); matches the existing pattern of one pipeline per deliverable shape.
- **Q4 (was blocking R1 — RESOLVED 2026-07-04 by switching R1 to option b):** Under the original auto-clamp design (option a), this asked whether explicit `--max-retry N` overrides the clamp. Under the chosen refuse-on-ambiguity design (option b), the question dissolves: explicit `--max-retry` is the only path forward (there is no clamp to override). Any explicit value — `0` (observe) or `N>0` (fix) — proceeds without warning; omission is the only thing that errors. R1's wording encodes this directly; no further operator action needed.
- **Q5 (blocks R8): operator guide location.** Options: (a) inline in `.rulesync/skills/sp-dev-refine/SKILL.md`; (b) a new `references/operator-guide.md` under the skill. Recommend (a) — keeps the surface minimal; (b) only if the additions exceed ~30 lines.

Decided during consolidation (no operator action needed):
- F4-cache (47% aggregate) is observation-only — no code change, no task spawned. Recorded as R7/AC7.
- F4-task-resolve, F5, F8 are documentation-only — bundled into R8/AC8 rather than separate tasks.
- F11, F13, F14, F18, F19, F21, F22 fold into R4 rather than getting standalone requirements — they are facets of the same prerequisite-aware design, not independent fixes.
- Observe-only `--next` chain end-to-end exercise remains a driver decision (out of scope as a testee defect).
### Design
**Chosen approach per wave (invariants in bold — silent deviation = PARTIAL per the Wave C design-conformance rule):**

1. **Wave A — R1 (F1 refuse-on-ambiguity) + R2 (F2 SKIP-set) + R3 (F3 notice) + R8 (doc-only findings).** All four are small, independent, and target `.rulesync/skills/sp-dev-refine/SKILL.md` + `.rulesync/skills/sp-dev-dogfood/SKILL.md` + `plugins/sp/commands/dev-dogfood.md`. **Invariant: the refuse-on-ambiguity gate (R1) must error ONLY when `--max-retry` is omitted AND the testee is pipeline-driving; any explicit value (including 0 and 2) must proceed without warning; the error message must name both escape hatches (`--max-retry 0` and `--max-retry N`); the SKIP-set widen (R2) must not remove the existing three sections; the notice (R3) must fire pre-chain, not post.** Bundle into one PR — they share review surface and reviewer.

2. **Wave B — R4 (prerequisite-aware readiness, the large one).** This is the load-bearing wave. **Invariant: the readiness model is a unified `prerequisites` abstraction over `dependencies` + gate conditions; AND semantics across multi-branch fan-in; depth-N recursion; cycle defense; pre-gate (readiness) vs post-gate (done-ness) distinction; `blocked`-status guard; content-gate "empty by intent" awareness.** Decompose at implementation time into the six facets identified in Q1. Decide Q1 (split vs keep) before entering this wave. Reject the alternative of bolting prerequisite checks onto the existing status-keyed `task-check` without a unified model — that produces the half-of-each compromise R6 forbids.

3. **Wave C — R5 (SQLite lock UX) + R6 (design-doc pipeline).** Both are standalone. **Invariant: R5 catches `SQLITE_BUSY` at the CLI error boundary (not deep in the DAO layer); R6 routes via a new `docs-pipeline.yaml` (Q3 (a)) with a `docs-review` gate.** Bundle or split — reviewer's call.

**Rejected alternatives:**
- Bolting prerequisite checks onto `task-check` without a unified model (Wave B) — produces a third inconsistency.
- Extending `task-pipeline.yaml` for design-doc routing (Q3 (b)) — couples docs and code pipelines; rejected for separation.
- Auto-clamp `--max-retry` to 0 on pipeline-driving testees (original R1 option a) — rejected: `--max-retry 0` only governs the driver's fix loop; the testee's `--next` chain retains full `Edit`/`Write`/`Bash` access (`allowed-tools` SKILL.md:5) and mutates anyway. A clamp would advertise safety it cannot deliver; refuse-on-ambiguity (option b) is the honest default at a mutation consent boundary.

**Sequencing invariant:** Wave A (small, independent, high-saturation findings) lands first because it is low-risk and unblocks trustworthy future dogfood runs (F1 refuse-on-ambiguity forces explicit consent before any pipeline-driving run, eliminating the silent-tree-mutation class of bug). Wave B (the large one) lands second because it depends on the unified-model decision (Q1). Wave C lands last — standalone, no upstream dependency.
### Plan
Rubric (decomposition standard): R4 alone scores E~24h D3 L3 C2 R3 → decomposition CANDIDATE at the requirement level. The wave split below is the recommended decomposition; do not split further without re-scoring after Q1 is answered. Sequencing is riskiest-first: small independent fixes (Wave A) → large unified model (Wave B) → standalone polish (Wave C).

**Wave A — small independent fixes (R1, R2, R3, R8) — do first; low-risk, high-saturation findings**
- [x] R1: refuse-on-ambiguity in `sp-dev-dogfood` — when testee contains `--next`/`run`/`runall`/`wrap`/`idea` and `--max-retry` is not explicit, exit non-zero with an error naming both escape hatches (`--max-retry 0` observe-only, `--max-retry N` fix mode acknowledged); any explicit value proceeds without warning.
- [x] R2: widen SKIP-set in `sp-dev-refine/SKILL.md:71-76` to `{Background, Requirements, Plan, Design, Acceptance Criteria}` (Q2).
- [x] R3: add pre-chain notice in `sp-dev-refine/SKILL.md` Workflow step 6.
- [x] R8: doc-only findings — `spur task path` cross-reference (F4-task-resolve), 768-char truncation note (F5), status-keyed `task check` design note (F8). Inline per Q5.
- [x] Wave A gate: `bun run lint` + `bun run test` green; manual smoke test of R1/R2/R3 behavior.

**Wave B — prerequisite-aware readiness (R4 — the large one) — do after Q1 answered**
- [x] Decide Q1 (split R4 into child task 0212, or keep in 0211).
- [x] R4a: unified `prerequisites` frontmatter model + lint reconciliation (F10).
- [x] R4b: recursive readiness audit with graph traversal (F9, F12, F20).
- [x] R4c: gate-condition modeling — HITL pre/post (F16), merge-event (F24), content-gate (F26), capstone-ordering (F19).
- [x] R4d: parent/decomposed-parent semantics (F7, F21, F22).
- [x] R4e: `blocked`-status guard (F25).
- [x] R4f: cycle defense + AND semantics.
- [x] Wave B gate: `bun run lint` + `bun run test` green; probe-task coverage for each prerequisite type (AC4).

**Wave C — standalone polish (R5, R6) — do last**
- [x] R5: CLI `SQLITE_BUSY` friendly error handler + test.
- [x] R6 (after Q3): new `docs-pipeline.yaml` with `docs-review` gate (Q3 (a)); probe design-doc task driven through it.
- [x] Wave C gate: `bun run lint` + `bun run test` + `bun run test-cf` + `bun run build` green.

**Closeout**
- [x] R7: record cache-health data point (47% aggregate) in Testing; no code change.
- [x] R-gates: full canonical gates; `spur task check 0211 --strict-core --json` pass at each transition; `.rulesync/` skills re-synced to all `.rulesync/.targets/*/`.
### Solution

| Area | File | Change |
| --- | --- | --- |
| Dogfood ambiguity guard | `plugins/sp/skills/dogfood-testing/SKILL.md:50` | Made `--max-retry` mandatory for pipeline-driving testees and documented the exact refusal message. |
| Dogfood wrapper | `plugins/sp/commands/dev-dogfood.md:32` | Mirrored the same contract in the user-facing command surface. |
| Refine SKIP/next docs | `plugins/sp/commands/dev-refine.md:67` | Widened the auto SKIP target set to Background, Requirements, Plan, Design, and Acceptance Criteria; added the pre-chain notice and inline operator notes for `spur task path`, 768-char display truncation, and status-keyed `task check`. |
| Readiness checks | `packages/app/src/services/task-check.ts:45` | Added L4 readiness advisories for blocked tasks, direct/transitive dependency status, prose prerequisites missing from frontmatter `dependencies[]`, gate language, AND traversal, and cycle defense. |
| Readiness tests | `packages/app/tests/services/task-check.test.ts:1214` | Added probe coverage for direct unmet deps, transitive deps, prose deps, gate language, blocked status, and cycles. |
| SQLite lock UX | `apps/cli/src/errors.ts:11` | Formats `SQLITE_BUSY` errors as a one-line retry suggestion instead of surfacing raw lock errors. |
| SQLite lock tests | `apps/cli/tests/errors.test.ts:40` | Covers Error-code and string-message `SQLITE_BUSY` cases. |
| Docs-only pipeline | `config/workflows/docs-pipeline.yaml:1` | Added a docs-only sibling pipeline with an explicit `docs-review` HITL gate, keeping design-doc tasks out of the code pipeline. |

### Testing

R7 cache-health data point: the 16-run dogfood series recorded aggregate cache hit rate at 47%. No code change was made for that observation.

```text
$ bun run apps/cli/src/index.ts workflow validate config/workflows/docs-pipeline.yaml --json
{
  "ok": true,
  "valid": true,
  "workflow": { "name": "docs-pipeline", "initialState": "draft" }
}
```

```text
$ bun run apps/cli/src/index.ts workflow run config/workflows/docs-pipeline.yaml --vars '{"wbs":"0211","profile":"auto"}' --dry-run --json
{
  "workflowName": "docs-pipeline",
  "status": "done",
  "finalState": "done",
  "transitionsTaken": 2
}
```

```text
$ bun run lint
Checked 402 files in 135ms. No fixes applied.
@gobing-ai/spur typecheck: Exited with code 0
@gobing-ai/spur-app typecheck: Exited with code 0
@gobing-ai/spur-server typecheck: Exited with code 0
```

```text
$ bun run test
2163 pass
0 fail
5691 expect() calls
All files | 99.50 funcs | 99.10 lines
Coverage: function 99.50%, line 99.10%.
```

```text
$ bun run test-cf
Test Files  1 passed (1)
Tests  1 passed (1)
```

```text
$ bun run build
@gobing-ai/spur build: Exited with code 0
@gobing-ai/spur-server build: Exited with code 0
@gobing-ai/spur-web build: Exited with code 0
```

```text
$ bun run spur-check
29 pre-check rules passed.
2163 pass
0 fail
2 post-check rules passed.
```

### Review

| Severity | File | Finding | Recommendation |
| -------- | ---- | ------- | -------------- |
| P4 | `packages/app/src/services/task-check.ts` | R4 is intentionally warning-first in non-strict `task check`, preserving current task-corpus compatibility while surfacing readiness blockers. | Use `--strict`/strict-core gates where readiness warnings should block automation. |
| P4 | `.rulesync/skills/*` | `.rulesync` copies were updated locally for source-surface parity, but they are not tracked by git in this repo. | The tracked plugin files carry the committed behavior; regenerate external rulesync targets from the plugin source if needed. |

### References
- **16 dogfood reports (local-only, gitignored per task 0182 Q1=(b)):** `docs/dogfood/2026-07-04-sp-dev-refine-{0191,0192,0193,0194,0195,0196,0197,0199,0202,0203,0204,0205,0206,0207,0208,0209,0210}-auto-next-dogfood.md`. Findings extracted from the Findings sections and Monitor Ledgers of all 16.
- **Skills under review:** `.rulesync/skills/sp-dev-refine/SKILL.md` (lifecycle lines 78-94; SKIP-gate 71-76; `--next` chain 88-94), `.rulesync/skills/sp-dev-dogfood/SKILL.md` (default table), `.rulesync/skills/sp-dogfood-testing/SKILL.md` + `references/monitor-ledger.md` + `references/report-template.md`, `.rulesync/skills/sp-spur-dev/SKILL.md` + `references/dev-operations.md` (SKIP format lines 112-115).
- **Prior related tasks (already shipped, do not duplicate):** 0135 (F1 warning-only variant, done), 0136 (deterministic CLI warning when `--next` ignored, done), 0137 (eliminate implement-step half-state, done), 0139 (cache-hit-rate, cancelled), 0140 (track async run pid, done), 0152 (normalize task status before lifecycle transition, done), 0182 (dogfood report contract remediation, done — upstream authority on report shape).
- **Findings matrix (16 runs, saturation):** F1 saturated 16/16; F2 (SKIP-set) saturated 16/16; F3 (`--next` notice) saturated 16/16; F4-cache structural 16/16 (range 35–47%); F9 confirmed at 10 data points; F10 at 9 positive + 3 negative cases (75 mentions, most-mentioned); F16 HITL gate pre (0195/0207) + post (0196) + parent + child; F17 SQLite lock 2/16 (~1/8 recurring); F25/F26 new in run 0197 (first `blocked` status, first content-gate).
- **Feature domain coverage (complete 5/5):** F6 (0191/0192/0202/0203), J (0193/0204/0205/0206), F8 (0194), G2 (0195/0207/0208/0209/0210), G3 (0196/0197).
- **Status coverage (complete 3/3 non-terminal):** `todo` (11×), `wip` (3×), `blocked` (1×).
- **Task graph summary:** Parent 0191 (Task Kanban, `wip`) → 0202/0203 (`todo`), dep 0192 (`todo`). Parent 0193 (Inbox IPC, `wip`) → 0204/0205/0206 (`todo`), dep 0189 (`wip`), 0206 also dep 0199 (`backlog`). 0194 (Features board, F8, leaf, `todo`), soft dep 0189, negative deps 0190/0192/0193/0195. Parent 0195 (Team process supervision, G2, `wip`) → 0207 (wave A, HITL R1), 0208 (wave B, dep 0207), 0209 (wave C, dep 0208), 0210 (wave D capstone, deps 0208+0199). 0196 (Workspace design, G3, design-doc, `todo`), R6 post-gate, merge-event dep on 0193. 0197 (Workspace module impl, G3, `blocked`, P3), gated on 0196 approval + G1/G2 completion (3 conditions).
- **Consolidation method:** every finding extracted from report Findings sections + Monitor Ledgers across all 16 files, de-duplicated by semantic identity (prior sessions used F1–F10 for different findings; this task's F-numbers are independent). Severity per report contract: P1 blocks correctness/safety, P2 latent gap/surprise, P3 quality/UX, P4 observation/future-hardening.
### History
- 2026-07-04T16:13:43.780Z backlog → todo (system)
- 2026-07-04T16:04:00.000-07:00 todo → done (manual; remediation waves A/B/C complete)
