---
schema_version: 1
name: Settle D63 0917 inline-run evidence debt and close the feature
status: done
template: feature-impl
created_at: 2026-09-23T22:33:55.639Z
updated_at: "2026-09-24T00:35:53.880Z"
feature_id: D63

ac_altitude: task-local
---

## 0935. Settle D63 0917 inline-run evidence debt and close the feature

### Background

Filed by the 2026-09-23 session review (--triage) after D63 round 3 (task 0921) landed on main as 5227e2f39. Excluded as already resolved this session: promotion-gate baseline vocabulary fix (scripts/commands/workflow-promotion.ts:304-330,611-627), D63 feature-check traceability repairs (feature check D63 → 0 findings), composition-contract/economy doc sync, and worktree/branch cleanup. v2 (same day, operator request): widened to carry every open item from the session review — 0917 evidence debt (R1–R2), registration-baseline policy (R3), feature close (R4), origin/main push sync (R5), stale sibling directory removal (R6), and the P4/P3 record-keeping residues from 0921's Review (R7). Deadline-gated work (R1–R2) takes precedence; the sequencing constraints for R5 and R6 live in their requirement lines.

### Requirements

- [x] R1. Produce at least three real terminal inline history-anatomy runs (attributable DB rows, not estimated) through the 0914 bridge before the frozen 2026-10-06 deadline, and record their measured citations (agent.run actions/run, ms/run) as the post-adoption cohort evidence 0917 lacked.
- [x] R2. Re-evaluate 0917's INSUFFICIENT_EVIDENCE close against the new cohort and record the inline-run decision: confirm the scope-normalization promotion stands with the smallest bounded experiment named, or propose the one bounded speed candidate with predeclared primary metric, threshold, reliability floor, exclusions, sample requirement, owner and deadline. An observability improvement is not a measured speed improvement.
- [x] R3. Decide and record the candidate-registration policy follow-up from 0921's Review P3: whether future registrations must pin `delta.baselineAgentRunCount` (registry validator rule or documented convention in workflow-execution-economy.md §5). Do not re-open the resolved history-anatomy-scope-inline candidate.
- [x] R4. When R1–R2 are recorded, close feature D63 through the wrap process (task done → feature sync/transition plus final owning-doc sync). Do not claim speed gains the evidence does not show.
- [x] R5. Sync origin/main: after representative gates pass, push the accumulated local commits (83 ahead as of 2026-09-23) so the branch is no longer ahead; obtain explicit operator confirmation immediately before the push (external action).
- [x] R6. Remove the three stale sibling worktree directories in ~/xprojects — `spur-new-run-0850-5f6382`, `spur-new-runall-g65-ac87`, `spur-new-runall-h13-604b08` — only after verifying none contains unmerged work (no commits absent from main; not registered in `git worktree list`).
- [x] R7. Carry the 0921 Review record-keeping findings to closure: strengthen the promotion test's degenerate baseline==live assertion to pin exact phrasing (P4), and re-verify workflow-execution-economy.md §5.2 drift-refusal text matches the implemented guard (P3, drift-guard coupling is intentional and stays).

### Acceptance Criteria

- [x] AC1 — At least three attributable real inline runs exist with measured citations (actions/run, ms/run) recorded as post-adoption cohort evidence, dated on or before 2026-10-06. (req: R1)
- [x] AC2 — 0917's close carries a recorded decision: INSUFFICIENT_EVIDENCE stands with a named bounded experiment, or one predeclared speed candidate enters evaluation through the existing process. (req: R2)
- [x] AC3 — Registration-baseline policy decision recorded in the owning design: require pinned `baselineAgentRunCount` for new candidates, or an explicit documented convention. (req: R3)
- [x] AC4 — Feature D63 transitioned per the wrap process with owning docs synced, or a dated deferral recorded. (req: R4)
- [x] AC5 — origin/main contains every local commit: `git status` on main clean and ahead-count 0 after push. (req: R5)
- [x] AC6 — The three stale directories are gone from ~/xprojects with a recorded unmerged-work check showing zero missing commits. (req: R6)
- [x] AC7 — workflow-promotion.test.ts pins exact phrasing for both baseline==live and baseline<live outcomes; promotion suite green. (req: R7)
- [x] AC8 — §5.2 drift-refusal documentation verified against implementation behavior and corrected if drifted. (req: R7)

### Q&A

<!-- CLOSED decisions from refinement: what was chosen and why, what was deferred and on what
     condition. Not a parking lot for open questions — an unanswered question here means the task
     is not ready to hand off. Keep empty if none. -->

### Design

<!-- Chosen implementation approach, key tradeoffs, invariants, and impacted surfaces. -->

### Plan

<!-- Ordered implementation checklist. Fill before moving to todo/wip. -->

### Solution

R1 — three real terminal inline history-anatomy runs through the 0914 bridge (2026-09-23, before the frozen 2026-10-06 deadline). Run ids and shapes: `d6e3ec3f-3e0f-4155-bd6b-c23134a971fe` (cache miss: render→enrich→structure-gate FAIL→correct→gate PASS→validate FAIL→correct→gate/validate PASS→stamp→publish), `a3e79428-a30e-4e68-9d9d-d138461aecac` (cache miss `data-changed`: full path, gates PASS first pass), `75fed91a-be3c-4d32-be64-fd6b48502d95` (same-day cache `hit`: refresh-provenance→publish, zero model hops). All three rows are terminal `status=done` with 19 attributable `action_runs` rows in `.spur/spur.db` (bridge modes used: setup/`--action`/`--close`, entry `plugins/sp/scripts/inline-run-setup.ts:78`; identity outcome artifacts `.spur/run/<run-id>-inline-setup.json`). Measured citation via the gate's own owner `measureAgentRunHistory` (`scripts/commands/workflow-promotion.ts:289`) over the three run ids: **3 real run(s), median 2 agent.run action(s)/run, median 238,500 ms/run** (runs=3 for count; duration folded over the 2 runs carrying model hops — the cache-hit run honestly recorded 0 `agent.run` actions; min 0 / max 5 actions). Run 1 exercised both bounded-correction loops for real (structure-gate TODO-wording hit; validate caught an "all 30 tools" overreach — both repaired under the shared cap). Reports published through the workflow's own validate gate to `docs/report/2026-09-23-history-anatomy.md:1` (twice published, once provenance-refreshed).

R2 — re-evaluation recorded in 0917's Solution (`docs/tasks5/0917_deliver-the-measured-task-pipeline-optimization-selected-by-.md:65`): INSUFFICIENT_EVIDENCE stands for any speed candidate with the cohort now measured — no repeatable model-cost bottleneck a graph edit could remove (the same-day cache hit already records zero model hops; remaining enrichment/validation hops are what a legitimate forensic report costs); scope-normalization promotion stands as applied; no graph edit.

R3 — registration-baseline policy recorded in the owning design: `docs/design/workflow-execution-economy.md:198` — new candidate registrations pin `delta.baselineAgentRunCount` as a documented convention (not a validator rule; legacy unpinned records stay loadable and fall back to the live canonical comparator per §5.2). The resolved `history-anatomy-scope-inline` candidate was not re-opened (`config/workflow-candidates.json` untouched).

R4 — dated deferral recorded: feature D63's final close/transition is owned by the pipeline's post-record wrap hop (this implement stage writes neither lifecycle transitions nor feature records); pre-conditions are now in place (R1–R2 recorded this pass; owning-doc sync = R3's §5 edit). Deferral dated 2026-09-23; the wrap hop must close D63 without claiming speed gains.

R5 — push state prepared, push NOT executed (external action, explicit operator confirmation required in the host session): main @ 08be6cf2 is **84 ahead / 0 behind** origin/main; working tree carries this task's diff only.

R6 — the three stale sibling directories under `~/xprojects/` (`spur-new-run-0850-5f6382`, `spur-new-runall-g65-ac87`, `spur-new-runall-h13-604b08`) removed after verification: `git worktree list` shows only the main checkout (none registered), and none contains a git repository anymore (`not a git repository` from `git -C` in each), so zero commits exist to be absent from main — the recorded zero-missing-commits check holds trivially. Two dirs were fully empty; the third held only a worktree `.spur` copy (3 files: spur.db + 2 logs; the 0917 audit had already verified that DB copy as legacy-only). All three removed; nothing else touched.

R7 — P4 closure: degenerate assertions pinned to exact phrasing in `scripts/commands/workflow-promotion.test.ts:252` (baseline==live — takes the canonical-context branch, phrasing intentionally differs) and `scripts/commands/workflow-promotion.test.ts:267` (baseline<live applied-regression — incumbent-baseline phrasing); full promotion suite green (31 pass / 0 fail). P3 closure: §5.2 drift-refusal text verified against the implemented guard — doc sentence ("refuses when a registered baseline matches neither the live count nor the projection") matches the implemented guard at `scripts/commands/workflow-promotion.ts:644-651` (refusal condition + re-register message + exit 1), covered by the green drift test at `scripts/commands/workflow-promotion.test.ts:355`; no drift found, no correction needed; drift-guard coupling stays.

Note: untracked `docs/tasks5/0936_preserve-feature-scenario-key-rows-when-re-verifying-and-re-.md` predates this pass (created 23:05Z, before dispatch) — foreign D63 triage output, preserved untouched.

### Testing

**Pipeline verify results**

- Verdict: PASS (from verdict artifact)

| Requirement | Status | Evidence |
|-------------|--------|----------|
| R1 | MET | 3 attributable terminal runs in .spur/spur.db: d6e3ec3f…971fe (11 action_runs), a3e79428…aecac (4), 75fed91a…2d95 (4) = 19 rows, all done/history-anatomy, 2026-09-23 ≤ frozen 2026-10-06; setup artifacts .spur/run/<id>-inline-setup.json; measured citation re-reproduced via measureAgentRunHistory (workflow-promotion.ts:289): agentRunCount {runs:3,median:2,min:0,max:5}, agentRunDurationMs {runs:2,median:238500,min:150000,max:327000}. Round-2: stands. |
| R2 | MET | Marker spur:0935-r2-reevaluation at docs/tasks5/0917_deliver-the-measured-task-pipeline-optimization-selected-by-.md:65 — INSUFFICIENT_EVIDENCE stands, scope-normalization promotion stands, no graph edit, bounded 3-run cohort executed. Round-2: stands. |
| R3 | MET | docs/design/workflow-execution-economy.md:198 pin-delta.baselineAgentRunCount convention + §5.2 legacy fallback; config/workflow-candidates.json candidates: [] untouched. Round-2 spot-check: :198 registration-policy line re-read intact; candidates: [] confirmed. |
| R4 | MET | Deferral branch: spur feature show D63 status=blocked, updated_at 2026-09-23T18:22:08.867Z; dated deferral (2026-09-23) in task Solution R4; wrap hop owns close. Round-2: stands. |
| R5 | MET | Push executed between rounds: git rev-list --left-right --count origin/main...main = 0 0; git rev-parse origin/main = git rev-parse main = f10628a0ac11883d77c3a190601d80989e876b2c (fresh round-2 measurement; task Review :137 corroborates). |
| R6 | MET | spur-new-run-0850-5f6382, spur-new-runall-g65-ac87, spur-new-runall-h13-604b08 absent from /Users/robin/xprojects; git worktree list = main only. Round-2: stands. |
| R7 | MET | Exact-phrasing pins at scripts/commands/workflow-promotion.test.ts:252 and :267; fresh suite 31 pass / 0 fail / 70 expects; §5.2 text (workflow-execution-economy.md:213) matches guard workflow-promotion.ts:641-651; drift test :355 green. Round-2 spot-check: pins re-read intact at :252/:267, drift test :355 present; suite re-run fresh 31 pass / 0 fail / 70 expects. |

| Acceptance Criteria | Status | Evidence Type | Evidence |
|---------------------|--------|---------------|----------|
| AC1 | MET | command | {runs:3,median:2,min:0,max:5} actions / {runs:2,median:238500} ms over runs d6e3ec3f/a3e79428/75fed91a (19 action_runs). Round-2: stands. |
| AC2 | MET | command | `grep -n 'spur:0935-r2-reevaluation' docs/tasks5/0917_*.md` exit 0 → docs/tasks5/0917_deliver-the-measured-task-pipeline-optimization-selected-by-.md:65 `<!-- spur:0935-r2-reevaluation -->`. Round-3 fresh execution. |
| AC3 | MET | command | `sed -n '198p' docs/design/workflow-execution-economy.md` exit 0 → "Registration policy (0935): new candidate registrations **pin `delta.baselineAgentRunCount`** to"; `jq '.candidates' config/workflow-candidates.json` exit 0 → `[]`. Round-3 fresh execution. |
| AC4 | MET | command | `spur feature show D63 --json` exit 0 → "status": "blocked", "updated_at": "2026-09-23T18:22:08.867Z"; dated deferral (2026-09-23) in task Solution R4 corroborates. Round-3 fresh execution. |
| AC5 | MET | command | git rev-list --left-right --count origin/main...main = 0 0; origin/main == main == f10628a0ac11883d77c3a190601d80989e876b2c (fresh round-2 measurement). |
| AC6 | MET | command | 3 stale dirs absent; worktree list main-only. Round-2: stands. |
| AC7 | MET | test | 31 pass / 0 fail / 70 expect() calls (fresh round-2 re-run); exact-phrasing pins :252, :267 intact; 0921 drift test :355 present and green in the run. |
| AC8 | MET | test | Fresh round-3 `bun test scripts/commands/workflow-promotion.test.ts` exit 0 → 31 pass / 0 fail / 70 expect() calls; 0921 drift test (scripts/commands/workflow-promotion.test.ts:355) green in the run; economy.md:213 ≡ promotion.ts:641-651 equivalence carried from round 2. |
- Coverage: N/A (verdict-based; verify pipeline does not measure code coverage)

### Review

#### Review Report — 0935 (pipeline Phase 7, --auto)

**Scope:** working-tree diff vs pre-task state, 0935-attributable set only: `scripts/commands/workflow-promotion.test.ts`, `docs/design/workflow-execution-economy.md`, `docs/report/2026-09-23-history-anatomy.md` (gitignored by convention, `.gitignore:192`), task 0935 record, the marker-anchored 0917 re-evaluation block (`docs/tasks5/0917_deliver-the-measured-task-pipeline-optimization-selected-by-.md:65`), and 3 removed sibling dirs under ~/xprojects. Excluded as starting changes: `docs/tasks5/0914`–`0921` corpus re-verification rewrites (except the 0917 marker block). Foreign riders noted, not attributed: `AGENTS.md:169`, `plugins/sp/skills/spur-dev/references/cross-cutting.md:515`.

**Dimensions:** functional, security, efficiency, correctness, usability, architecture

**Verdict:** PASS — no blocker/major findings. Functional traceability 7/8 ACs MET, AC5 PENDING (external operator-gated push, honestly recorded). All evidence below re-verified fresh this review (DB queries, `measureAgentRunHistory` reproduction, test-suite run, filesystem checks) — none taken from the implement transcript.

##### Findings (ranked)

| # | Priority | Dimension | Finding | Location |
|---|----------|-----------|---------|----------|
| 1 | P3 (minor) | correctness | AC5/R5 not executed: origin/main sync is prepared (main @ 08be6cf2, 84 ahead / 0 behind — fresh `git rev-list --left-right --count origin/main...main` = `0 84`) but the push awaits explicit operator confirmation, and the working tree (incl. this task's deliverables) is uncommitted. The wrap hop must disposition the foreign riders, commit, obtain confirmation, and push. External action by design, not a work-product defect. | `docs/tasks5/0935_settle-d63-0917-inline-run-evidence-debt-and-close-the-featu.md` (Solution R5) |
| 2 | P4 (advisory) | scope | Foreign riders in the working tree: `AGENTS.md` and `cross-cutting.md` add coherent subshell-`cd` test guidance (cwd-persistence caveat). Benign content, but not 0935 deliverables and unreviewed by this task's gates — operator must disposition (commit separately or revert) before the R5 push. | `AGENTS.md:169`, `plugins/sp/skills/spur-dev/references/cross-cutting.md:515` |
| 3 | P4 (advisory) | correctness | "Inline" provenance nuance: the 0914 bridge writes `runs.mode='state-machine'` for bridge-created runs, so the DB mode column cannot certify inline origin; attribution rests on `.spur/run/<run-id>-inline-setup.json` artifacts + run-id citations — all three verified present and matching this review. | `packages/app/src/services/inline-run-setup.ts:284` |
| 4 | P4 (advisory) | functional | The three cohort runs carry no `task_run_links` rows binding them to wbs 0935; attribution is via Solution/0917 run-id citations + setup artifacts (verified). Acceptable, but a links row would make the attribution chain self-contained in the DB. | `.spur/spur.db` `task_run_links` (0 rows for the 3 run ids) |
| 5 | P4 (advisory) | correctness | R6's zero-missing-commits check is vacuous as performed post-removal (dirs no longer contain git repos, so "no missing commits" holds trivially); the Solution discloses exactly this ("holds trivially") and the substantive pre-checks (`git worktree list`, not-a-git-repo) are recorded. Honest, but the record should not be cited as a positive unmerged-work proof. | `docs/tasks5/0935_*.md` (Solution R6) |
| 6 | P4 (advisory) | architecture | Starting changes ride the same tree: 0914–0921 diffs are corpus re-verification rewrites from an earlier pass; only 0917's `spur:0935-r2-reevaluation` block is 0935-attributable; untracked `docs/tasks5/0936_*.md` is foreign D63 triage output (pre-dispatch, 23:05Z), correctly preserved untouched. | `docs/tasks5/0917_*.md:65` |
| 7 | P4 (advisory) | architecture | Exact-phrasing pins intentionally duplicate fixture-derived strings (11 runs / 3 actions / 400000 ms) inline — brittle by design (wording lock, per 0921 P4 intent). The marker-anchored re-evaluation append in 0917 (preserve-don't-rewrite) is a good archival pattern. | `scripts/commands/workflow-promotion.test.ts:252,267` |

##### Functional Traceability

| Req | Status | Evidence |
|-----|--------|----------|
| R1 | MET | 3 bridge runs in `.spur/spur.db`: all `status=done`, `workflow_name=history-anatomy`, current digest `sha256:ce65aeb7…`, 19 `action_runs` rows (11/4/4). Measured citation reproduced this review via the gate's own `measureAgentRunHistory` (`scripts/commands/workflow-promotion.ts:289`): `{"runs":3,"median":2,"min":0,"max":5}` actions, duration `{"runs":2,"median":238500}` ms — exact match to the recorded claim. Setup artifacts `.spur/run/<run-id>-inline-setup.json` present; dated 2026-09-23 ≤ frozen 2026-10-06. |
| R2 | MET | Re-evaluation recorded at `docs/tasks5/0917_*.md:65` (marker `spur:0935-r2-reevaluation`, anchor verified): INSUFFICIENT_EVIDENCE stands for any speed candidate, scope-normalization promotion stands, bounded experiment executed. |
| R3 | MET | `docs/design/workflow-execution-economy.md:198` — pin-`baselineAgentRunCount` convention (not validator rule; legacy fallback per §5.2); `config/workflow-candidates.json` untouched (`candidates: []`, absent from git status). |
| R4 | MET | Deferral branch: D63 feature record still `blocked` (unchanged, `updated_at 2026-09-23T18:22`); dated deferral 2026-09-23 in Solution R4; close owned by the wrap hop without speed-gain claims. |
| R5 | PENDING | Push prepared, not executed (see finding 1). |
| R6 | MET | Three stale dirs absent from `~/xprojects` (fresh `ls`); `git worktree list` = main checkout only. |
| R7 | MET | Exact-phrasing tests at `workflow-promotion.test.ts:252` (baseline==live) and `:267` (baseline<live); fresh suite run: **31 pass / 0 fail** (70 expect calls). §5.2 drift-refusal text matches the guard at `scripts/commands/workflow-promotion.ts:644-651` (condition + re-register message + exit 1); drift test `:355` green in the same suite. |

| AC | Status | Evidence |
|----|--------|----------|
| AC1 | MET | see R1 |
| AC2 | MET | see R2 |
| AC3 | MET | see R3 |
| AC4 | MET | dated deferral branch satisfied (see R4) |
| AC5 | PENDING | external operator-gated push (see R5 / finding 1) |
| AC6 | MET | see R6 |
| AC7 | MET | see R7 |
| AC8 | MET | see R7 |

##### SECUA Quality

No runtime surface changed (test + docs only). Correctness: the two new pins verified by execution against `evaluateCandidate`'s string template (`workflow-promotion.ts:335-344`) — suite green. Security: no new inputs, no interpolation, no public surface. Efficiency: n/a. Usability: §5.1 policy text and §5.2 refusal text are precise and match implementation behavior. No P1–P3 findings.

##### Architecture Depth

Pins lock the verdict-string contract that downstream consumers and corpus checks depend on — deepening, not churn. Policy documented once at the owning design surface (§5.1) with the convention-vs-validator tradeoff stated. 0917 marker-append preserves the historical audit record instead of rewriting it. Residual P4s only (findings 6–7).

**Residual risk:** AC5 remains open until the operator-gated push; the foreign riders (finding 2) will enter whatever commit is made next unless dispositioned first.

**Next:** wrap hop — operator dispositions the two riders, wrap commits the 0935 deliverable set, obtains explicit confirmation, executes the R5 push, then closes feature D63 without speed-gain claims.

#### Round-2 re-entry confirmation — pipeline run d58920e8, delta re-review after the test-fix remediation hop

**Verdict:** PASS — round-1 verdict holds on the pushed state; zero new findings (no P1–P4).

- **Push verified (AC5/R5 now MET):** `git rev-list --left-right --count origin/main...main` = `0 0`; `git rev-parse origin/main main` both = `f10628a0a`; both round-2 commits are the tip of origin/main. Residual working-tree dirt is concurrent-session D64 work (out of scope per dispatch), not 0935 deliverables — every 0935 file is committed and pushed. Round-1 finding 1 (P3) resolved. Requirements checkbox status remains wrap-hop-owned (review writes Review only).
- **Commit f10628a0a (deliverable set):** matches the round-1-reviewed diff. Pinned strings verified character-for-character against the source templates: countContext branches at `scripts/commands/workflow-promotion.ts:331-335` and the rejection reason at `:344` reproduce both exact-`toBe` pins (`workflow-promotion.test.ts:252` baseline==live canonical-context, `:267` baseline<live applied-regression); fixture values (`workflow-promotion.test.ts:228-229`: runs 11 / median 3 / median 400000 ms) match the cited measured citation. Drift-refusal test `:355` (exit 1, verdict stays null) matches the guard at `scripts/commands/workflow-promotion.ts:643-651`. Fresh suite run this review: **31 pass / 0 fail** (70 expect() calls). Quality gate re-ran green (probe-then-full, PASS) per dispatch.
- **Commit 4c84ec3c5 (foreign riders):** dispositioned exactly as round-1 finding 2 prescribed — separate chore commit. `AGENTS.md:166-175` adds subshell/absolute-path mechanics to the existing run-inside-workspace rule (no conflict with the hook-bypass prohibition at `:168` or the root coverage-denominator rule); `plugins/sp/skills/spur-dev/references/cross-cutting.md:514-518` adds the same sourced friction note (dated 2026-09-23) to step 1 of the iterate-to-green rule without altering rule order or authority. Benign learnings-class; no rule/authority conflicts.
- **SECUA/architecture delta lenses:** nothing off — delta is test-string pins + docs only, no runtime surface; pins remain wording-lock deepening (round-1 finding 7 unchanged).

### References

- docs/tasks5/0917_* — frozen 2026-10-06 decision date, ≥3 real terminal inline runs target, INSUFFICIENT_EVIDENCE close (:23-40).
- scripts/commands/workflow-promotion.ts:304-330 (baseline rule), :611-627 (drift guard); scripts/commands/workflow-promotion.test.ts (degenerate baseline==live case).
- docs/design/workflow-execution-economy.md §5.1-5.2 (baseline semantics + drift-refusal contract).
- docs/tasks5/0921_complete-measured-workflow-migration-and-catalogue-reconcili.md — Review table P3/P4 records; Solution §R3/R4.
- config/workflow-candidates.json — resolved candidate history-anatomy-scope-inline; retirements[] for planning-pipeline; do not re-open either.
- plugins/sp/skills/spur-dev references — inline-run bridge (0914) execution context.

### History

- 2026-09-23T22:40:27.217Z backlog → todo (system)
- 2026-09-23T23:33:56.590Z todo → wip (system)
- 2026-09-24T00:35:32.974Z wip → testing (system)
- 2026-09-24T00:35:53.880Z testing → done (system)

