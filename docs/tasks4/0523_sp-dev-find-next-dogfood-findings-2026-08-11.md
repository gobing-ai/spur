---
template: review
schema_version: 1
name: "/sp:dev-find-next dogfood findings (2026-08-11)"
description: ""
status: done
type: review
profile: standard
feature_id: H12
parent_wbs: null
priority: P2
tags: ["review"]
dependencies: []
ac_numbering: task-local
created_at: "2026-08-12T05:40:20.005Z"
updated_at: "2026-08-12T06:34:04.198Z"
---

## 0523. /sp:dev-find-next dogfood findings (2026-08-11)

### Background
#### Review Findings

A 2026-08-11 fix-mode dogfood of `/sp:dev-find-next` reached PASS. The run already corrected one
issue: `signal-derivation.md:47` now reads `feature show --json.filePath` before counting feature AC,
because the JSON response has no body field.

Premise verification on 2026-08-12 confirmed two remaining documentation defects:

- `.spur/config.yaml` declares `docs/tasks4` active and four configured task folders. The current
  unscoped task list returns 34 records while 523 task Markdown files exist across those folders.
- `spur task list --feature H1 --json` returns active-folder task `0496`, but omits blocked task
  `0142` in `docs/tasks2`; `spur task show 0142 --json` resolves it and confirms
  `status: blocked`, `feature_id: H1`.
- The dogfood recorded a 38% cache-hit rate: the sync snapshot was fetched twice and candidate
  feature inputs were re-fetched instead of frozen once.

Task 0523 belongs to feature H12, whose R2/R3 contracts own corpus-derived ranking and gating.
Keeping it linked to H1 would mask the live H1 reproduction and violate task-to-feature AC
traceability. With the corrected H12 edge, the current sync dry-run proposes H1 `active -> blocked`
because all non-terminal linked tasks are blocked; the active-only list still cannot name `0142`.

| Severity | Finding | Disposition |
| --- | --- | --- |
| P2 | `signal-derivation.md` §1 treats active-folder `task list --feature` as the complete B3 input, so archived open tasks can be mislabeled terminal or absent. | Implement as R1. |
| P3 | §0/§2 do not explicitly freeze and reuse command outputs, allowing redundant calls. | Implement as R2. |
| P3 | The dogfood monitor ledger was finalized in one batch after a ~16-minute run. | Informational driver-discipline note; no product change. |
| P3 | `feature show --json` has no body field. | Deferred CLI surface question; operator-owned and outside this task. |
| P4 | Feature sync derives no status for zero-own-task containers. | Deferred design question; outside this task. |

Scope is one reference-file correction: R1 and R2 only.
### Requirements
- **R1 — Complete the B3 task roster before declaring a feature terminal or empty.** In
  `plugins/sp/skills/next-feature/references/signal-derivation.md` §1, document that
  `spur task list --feature <id> --json` is active-folder-only. When that active view has no B3
  frontier candidate and the run would record `all tasks terminal` or `no tasks`, the procedure
  must: reuse the cached §0 sync result as an anomaly hint; run
  `rg -l '^feature_id: "?<id>"?$' docs/tasks*/`; resolve every corpus-only WBS with
  `spur task show <wbs> --json`; union/deduplicate those records with the active list; and reapply
  runtime B3 to the complete set. The sync reason is never treated as a WBS source. If the union
  exposes task `0142` in blocked status, the classification names
  `blocked: 0142 — <reason>` rather than terminal.
- **R2 — Freeze each derivation input once per run.** In §0, require exactly one
  `spur feature sync --all --dry-run --json` capture reused by steps 1–4. In §2, require at most one
  `feature show <id> --json`, one read of its `.filePath`, and one
  `feature check <id> --json` per candidate; reuse those captures throughout the four-signal pass.
  Churn, dogfood, and authority signals continue using their own prescribed `git`/`rg` inputs—the
  task does not falsely claim they derive from feature show/check.

**Out of scope / non-goals:** CLI changes (`task list --all-folders`, `feature show` body output),
new flags/schema/state/cache files, gate-reason vocabulary changes, copying the B3 predicate out of
`routing-table.md`, changes to ranking signals or numeric scoring, dogfood ledger changes, container
sync semantics, and any file other than `signal-derivation.md`. Stable guidance must not embed the
current 34/523 measurements; those are evidence, not behavior.
### Acceptance Criteria
```gherkin
Feature: Complete and cache-efficient next-feature signal derivation

  Scenario: R2 — ranking derives from the corpus as it stands
    Given a dry-walk of steps 0 through 4 over N candidate features
    When the updated section 0 and section 2 guidance is followed
    Then the invocation ledger contains exactly one feature sync --all --dry-run call for the run
    And at most N feature show calls, N feature-file reads, and N feature check calls
    And no signal re-invokes a frozen candidate capture

  Scenario: R3 — unactionable features are gated, not ranked
    Given the current H1 active-folder list omits task 0142
    And task 0142 resolves from docs/tasks2 with status blocked and feature_id H1
    When the updated section 1 procedure reaches the would-be all-tasks-terminal branch for H1
    Then the corpus scan discovers task 0142
    And task show supplies its status, dependencies, and blocker text
    And B3 is reapplied to the union of active-folder and corpus-only task records
    And the classification is blocked: 0142 — <reason>, not all tasks terminal
```
### Q&A
**Q: Why not add `task list --all-folders`?**

A: That is an ADR-051 consent-gated CLI surface change. This task fixes prompt guidance using the
existing CLI and corpus tools only.

**Q: Is the cached feature-sync result authoritative for missing tasks?**

A: No. It is reused as an anomaly hint and may summarize state without naming a WBS. The corpus
scan discovers WBS values; `task show` supplies authoritative task metadata and body.

**Q: Why is task 0523 linked to H12 rather than H1?**

A: H12 owns `sp:next-feature`; its R2/R3 scenarios are exactly the corpus-ranking and gating
contracts changed here. H1 is only the live regression fixture.

**Q: Should the fallback scan run for every candidate?**

A: No. Run it only when the active view yields no B3 frontier and would otherwise produce
`all tasks terminal` or `no tasks`.

**Q: Do all four signals derive from feature show/check?**

A: No. Only feature metadata, body, and AC validity use those captures. Churn, dogfood, and
authority retain their existing `git`/`rg` derivations; the rule is one capture per reusable input.

**Q: Why does `task check 0523 --strict` report `L4.gate-language`?**

A: The task must reuse H12's frozen R3 title, `unactionable features are gated, not ranked`, for
DD-09 traceability. The checker lexically treats `gated` as workflow-gate prose even though it names
product classification behavior here. Preserve the feature title; the normal task gate passes and
the corpus/feature gates remain clean. Fixing that heuristic is outside this task.
### Design
**WHAT / WHERE:** Edit only
`plugins/sp/skills/next-feature/references/signal-derivation.md`:

1. **§0, after the current Rules list:** state that the sync dry-run is captured once per run and
   reused through steps 1–4. This is an in-memory prompt-run capture, not a cache/state file.
2. **§1, immediately after the existing `task list --feature` block:** state its active-folder-only
   scope. After applying B3 to that list, enter the fallback only if no frontier candidate exists
   and the tentative reason is `all tasks terminal` or `no tasks`:
   - consult the already-cached sync row for the feature as an anomaly hint;
   - substitute the feature id into `rg -l '^feature_id: "?<id>"?$' docs/tasks*/`;
   - parse the leading WBS from each matched basename, resolve corpus-only WBS values with
     `spur task show <wbs> --json`, union/deduplicate by WBS, and reapply runtime B3;
   - emit the existing reason vocabulary from the complete roster. Never claim the sync reason
     identifies a task; for blocked tasks, derive blocker text from the resolved task body.
3. **§2, after the signal table:** require one frozen `feature show` response, one read of its
   `.filePath`, and one `feature check` response per candidate. Reuse them wherever the four-signal
   pass needs feature metadata/body/AC validity; leave the existing per-signal `git`/`rg` commands
   unchanged.

**WHY:** `task list` intentionally remains active-folder-only, but B3 needs all linked tasks. A
rare-path union fixes the consumer without widening public CLI semantics or paying a corpus scan on
the common path. Explicit capture reuse removes redundant calls without introducing persistent
cache machinery.

**Frozen surface:** keep headings `## §0 — Sync-first precondition (step zero)`,
`## §1 — Actionability gate (runtime citation, never restated)`, and
`## §2 — The four surviving signals`; keep reason strings `all tasks terminal`,
`blocked: <task wbs> — <reason>`, and `no tasks`; add no API or file.

**Anti-patterns:** do not copy or paraphrase the B3 algorithm (read row B3 at runtime); do not scan
the corpus unconditionally; do not special-case H1/0142 in shipped guidance; do not embed current
corpus counts; do not infer a WBS from sync prose; do not add TypeScript, flags, schemas, state, or
numeric scoring.

**Handoff:** feature H12 owns the changed R2/R3 behavior; H1 is only a verification fixture. There
are no task dependencies. The implementer owns this one reference file; `Solution`, `Testing`, and
`Review` remain pipeline-owned.
### Plan
- [x] **P1 (R2):** In `signal-derivation.md` §0, add the one-sync-capture-per-run rule and reuse it
      through protocol steps 1–4.
- [x] **P2 (R1):** In §1, document active-folder scope and the conditional complete-roster fallback:
      cached sync hint → corpus `rg -l` → `task show` for corpus-only WBS values → deduplicated union
      → runtime B3. Preserve the existing reason vocabulary.
- [x] **P3 (R2):** In §2, freeze one feature show response and one feature check response per
      candidate (count `Scenario:` in frozen `.content`; `.filePath` re-read only when body text
      is absent); keep other signal derivations unchanged.
- [x] **P4 (R1 verification):** Confirm current `task list --feature H1` omits 0142, corpus `rg`
      finds 0142, `task show 0142` reports blocked, and the cached sync row reports H1 blocked.
      Dry-walk the all-terminal branch and verify the union yields `blocked: 0142 — <reason>`.
- [x] **P5 (R2 verification):** Dry-walk N candidates and record the invocation ledger: one sync
      total and no more than one show/file-read/check per candidate.
- [x] **P6 (gates):** Run `bun test plugins/sp/tests/skill-structure.test.ts`, then the repository
      verification gates required by `AGENTS.md`; finish with source-local
      `task check 0523 --json`, `feature check H12 --json`, `task check --corpus --json`, and
      intentional `git status`. Record the expected strict-only `L4.gate-language` advisory caused
      by H12's frozen R3 scenario title; do not rename the scenario or suppress the checker.
### Solution
- `plugins/sp/skills/next-feature/references/signal-derivation.md:22-26` (§0, after the Rules
  list): added the one-capture rule — the single `spur feature sync --all --dry-run --json` result
  is the sole post-sync status view for protocol steps 1–4 (gating, roster completion, signal
  derivation); the run never issues a second sync call and no state/cache file is added. (R2)
- `plugins/sp/skills/next-feature/references/signal-derivation.md:40-45` (§1, immediately after the
  `task list --feature <id> --json` block): documented that the verb is **active-folder-only**
  (enumerates `.spur/config.yaml`'s active folder, omits linked tasks in other configured folders).
- `plugins/sp/skills/next-feature/references/signal-derivation.md:47-66` (§1): added the conditional
  complete-roster fallback, entered only when the active view yields no B3 frontier candidate and
  the tentative reason is `all tasks terminal` or `no tasks`: (1) reuse the §0 sync capture as an
  anomaly hint — its reason never names/derives a WBS; (2) `rg -l '^feature_id: "?<id>"?$'
  docs/tasks*/` corpus scan; (3) resolve corpus-only WBS values with `spur task show <wbs> --json`;
  (4) union/deduplicate by WBS and reapply runtime B3; (5) classify from the complete roster — a
  blocked task surfaced only by the union is `blocked: <task wbs> — <reason>`, never `all tasks
  terminal`, with blocker text from the resolved body. (R1)
- `plugins/sp/skills/next-feature/references/signal-derivation.md:80-87` (§2, after the signal table):
  added the per-candidate freeze rule — at most one `spur feature show <id> --json` and at most one
  `spur feature check <id> --json` per candidate, reused wherever the four-signal pass needs feature
  metadata/body/AC validity. Count `Scenario:` in the frozen show response's `.content` (body is
  carried as `.content`, so no `.filePath` re-read is required when the response carries corpus
  text). Churn, dogfood, and authority pull retain their own prescribed `git`/`rg` derivations. (R2)

**Design deviation (documented, goal-equivalent):** Design P3 required a mandatory `.filePath` read;
implementation counts `Scenario:` in frozen `.content` instead (field confirmed present; H1 dry-walk:
536 lines, 70 `Scenario:` hits). Documented in Solution; classify as CHANGED, not silent drift.

Verification dry-walk (2026-08-11 re-verify, current corpus): `spur task list --feature H1 --json`
returns only 0496 (done); `rg -l '^feature_id: "?H1"?$' docs/tasks*/` matches 19 files including
`docs/tasks2/0142_*.md`; `spur task show 0142 --json` reports `status: blocked`, `feature_id: H1`;
sync dry-run proposes H1 `active -> blocked` with reason `"All non-terminal linked tasks are
blocked"` (no WBS named). Union + reapply runtime B3 ⇒
`blocked: 0142 — hard blocker: workspace + inbox + spur agent team mode`, not `all tasks terminal`.
Frozen surface preserved (headings, reason vocabulary); B3 predicate not copied; no H1/0142 ids
embedded in shipped guidance; no corpus counts embedded.
### Testing
**Force re-verify (2026-08-11) — standalone `/sp:dev-verify 0523 --auto --force --fix all --focus all`**

- Verdict: PASS
- Coverage: N/A (documentation-only change; no runtime code path added)
- Fix-pass hygiene: Plan checkboxes flipped; Solution/Testing line anchors use full repo-relative paths (lines re-read this run). Artifacts: `.spur/run/0523-verdict.json`, `.spur/run/0523-verify-answer.txt`.

**Per-Requirement Traceability**

| Req | Status | Evidence |
| --- | --- | --- |
| R1 | MET | `plugins/sp/skills/next-feature/references/signal-derivation.md:40-45` documents `task list --feature` as active-folder-only; `plugins/sp/skills/next-feature/references/signal-derivation.md:47-66` adds conditional complete-roster fallback (cached §0 sync as anomaly hint → corpus `rg -l` → `task show` for corpus-only WBS → union/dedupe → reapply runtime B3 → `blocked: <wbs> — <reason>` from body, never `all tasks terminal`). Live dry-walk this run: `task list --feature H1 --json` = [0496 done] only (0142 omitted); corpus `rg` = 19 matches incl. `docs/tasks2/0142_batch-execution-v2-parallel-runs-worktree-isolation-interact.md`; `task show 0142 --json` = status blocked, feature_id H1; sync dry-run proposes H1 active→blocked reason-only ("All non-terminal linked tasks are blocked", no WBS). Union {0496 done, 0142 blocked} + B3 ⇒ `blocked: 0142 — hard blocker: workspace + inbox + spur agent team mode`, not `all tasks terminal`. |
| R2 | MET | `plugins/sp/skills/next-feature/references/signal-derivation.md:22-26` (§0 one-capture: single `feature sync --all --dry-run --json` sole post-sync view for steps 1–4); `plugins/sp/skills/next-feature/references/signal-derivation.md:80-87` (§2 freeze: at most one show + one check per candidate; count `Scenario:` in frozen `.content`; no re-invoke). Dry-walk ledger N=1 (H1): 1 sync, 1 show (.content 536 lines / 70 `Scenario:`), 1 check, 0 file reads; no frozen capture re-invoked. Churn/dogfood/authority keep own git/rg paths. |

**Acceptance Criteria Verification**

| AC | Status | Evidence Type | Evidence |
| --- | --- | --- | --- |
| Scenario: R2 — ranking derives from the corpus as it stands | MET | command | Dry-walk steps 0–4 over candidate H1 under updated §0/§2: ledger = exactly 1 `spur feature sync --all --dry-run --json`, 1 `spur feature show H1 --json` (.content 536 lines / 70 `Scenario:`), 1 `spur feature check H1 --json`; 0 `.filePath` reads (≤ N); no signal re-invoked a frozen capture. |
| Scenario: R3 — unactionable features are gated, not ranked | MET | command | Live H1: `task list --feature H1 --json` = [0496 done] (0142 omitted); corpus `rg` discovers 0142 in docs/tasks2; `task show 0142 --json` supplies status blocked + feature_id H1 + blocker body text; §0 sync capture = H1 active→blocked reason-only (no WBS). Union + reapply B3 (`plugins/sp/skills/next-router/references/routing-table.md:83`) ⇒ classification `blocked: 0142 — …`, not `all tasks terminal`. |

**Design conformance**

| Claim | Status | Evidence |
| --- | --- | --- |
| §0 one-sync-capture-per-run | DONE | `plugins/sp/skills/next-feature/references/signal-derivation.md:22-26` |
| §1 active-folder scope + complete-roster fallback | DONE | `plugins/sp/skills/next-feature/references/signal-derivation.md:40-66` |
| §2 freeze show + filePath + check | CHANGED | Design required mandatory `.filePath` read; Solution implements `.content` count with optional file read (`plugins/sp/skills/next-feature/references/signal-derivation.md:80-87`) — goal-equivalent, documented |

**SECUA (focus=all)**

| Priority | Dimension | Location | Finding |
| --- | --- | --- | --- |
| P4 | — | — | No P1–P3 findings; verify verdict PASS. Prior accepted P3 (fallback skips all-blocked active views) remains out of R1 scope per Q&A. |

**Gates this run**

- `task check 0523 --json` → pass (Plan checkboxes + full-path anchors)
- `feature check H12 --json` → pass: true, findings: []
- All H12 linked tasks status ∈ {done}
- `bun test plugins/sp/tests/skill-structure.test.ts` → 54 pass / 0 fail
### Review
Reviewed the R1/R2 fix diff on `plugins/sp/skills/next-feature/references/signal-derivation.md` (+35/−2, sole implementation file). Traceability verified against the live CLI: all six doc-referenced verbs resolve; `feature show --json` returns no `body` field but carries `.filePath` and the full body in `.content`; sync dry-run `results[].proposal` rows carry `featureId` + prose `reason` with no WBS (validating the anomaly-hint rule); `rg -l '^feature_id: "?H1"?$' docs/tasks*/` matches 19 files incl. `docs/tasks2/0142_*.md`; `task show 0142 --json` reports `status: blocked`, `feature_id: H1`; sync proposes H1 `active -> blocked` ("All non-terminal linked tasks are blocked"). R1's fallback triggers correctly on the H1 live case (active list = 0496 done → tentative `all tasks terminal` → union ⇒ `blocked: 0142 — <reason>`).

Verdict: **PASS** — R1/R2 fully implemented; frozen surface (headings §0/§1/§2, reason vocabulary) preserved; B3 predicate not copied (runtime citation intact); no fixture ids/counts embedded; no unconditional corpus scan; no new API/schema/state file.

| Severity | Dimension | Finding | Disposition |
| --- | --- | --- | --- |
| P1 | — | (none) | — |
| P2 | — | (none) | — |
| P3 | Functional | §2 AC-coverage premise "the JSON carries no body field" is literal-only: `feature show <id> --json` carries the full body in `.content` (verified H1: 536 lines, 70 `Scenario:` hits). The mandated per-candidate `.filePath` read is therefore redundant — counting `Scenario:` in the frozen show response satisfies the signal with zero file reads, and R2's freeze rule would collapse to one show + one check per candidate. | Optional: align with the deferred CLI-surface question — if `.content` is contractually stable, drop the file read; else parenthesize "(body available as `.content`)" to stop future `body`-key hunts. |
| P3 | Functional | §1 fallback keys only on tentative `all tasks terminal` / `no tasks`. An active view whose every task is blocked (tentative `blocked: <wbs> — <reason>`) skips the corpus scan, so an archived *open* task stays invisible — the same misclassification class the fallback fixes. | Accepted per requirement scope + Q&A ("run only for terminal/empty"); revisit if dogfood surfaces an all-blocked misclassification. |
| P4 | SECUA | §0 "no other verb reproduces it" is run-level guidance (matches design verbatim) but reads literally as a CLI-semantics claim — `feature show`/`list` do surface status. | Wording nit: qualify "(in this run)" — no behavior change. |
| P4 | SECUA | §1 step 2 interpolates `<id>` into the `rg` pattern with no regex-safety note; a metachar-bearing id would corrupt the scan. | Theoretical only (corpus ids are `[A-Z][0-9]+`-shaped); a parenthetical would future-proof. |
### References
- `plugins/sp/skills/next-feature/references/signal-derivation.md` — sole implementation target (§0/§1/§2)
- `plugins/sp/skills/next-router/references/routing-table.md:83` — B3 SSOT read at runtime
- `plugins/sp/skills/next-feature/references/ranking-rubric.md` — gated reason vocabulary
- `.spur/config.yaml` — active and configured task folders
- Feature H12 — owner of the matched R2/R3 acceptance scenarios
- Task 0142 — archived H1 blocker; resolve with `spur task show 0142 --json`
- Source-local evidence commands: `spur task list --feature H1 --json`,
  `spur feature sync --all --dry-run --json`, and
  `rg -l '^feature_id: "?H1"?$' docs/tasks*/`
### History
- 2026-08-12T06:22:14.350Z backlog → wip (system)
- 2026-08-12T06:29:31.074Z wip → testing (system)
- 2026-08-12T06:29:31.613Z testing → done (system)
