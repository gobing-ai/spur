---
template: review
schema_version: 1
name: "Verify-fidelity and dogfood findings from 0282 re-audit"
description: ""
status: done
type: review
profile: standard
feature_id: null
parent_wbs: null
priority: P2
tags: ["review"]
dependencies: []
created_at: "2026-07-19T07:12:34.189Z"
updated_at: "2026-07-19T18:25:07.719Z"
---

## 0299. Verify-fidelity and dogfood findings from 0282 re-audit

### Background
#### Review Findings

| Severity | File | Finding | Recommendation |
|----------|------|---------|----------------|
| P2 | `plugins/sp/skills/code-verification/SKILL.md:60` | Verify fidelity: a verify run can mark objective rows MET from file-level citations whose line anchors resolve to other tickets' content (0282 was certified `done` citing `evidence:134`, which is 0281 telemetry text). | Add a line-anchor verification rule to Step 4/5: every `file:line` citation in the Testing table must be re-read at the cited lines and confirmed to name the requirement's subject (not merely exist) before a MET row is written. |
| P2 | `plugins/sp/skills/code-verification/SKILL.md` (Step 13) | `--force --next` on an already-terminal (`done`) task can never fire the transition, but the R9 note lives only in `dev-verify.md:124`; the verify report line doesn't state the no-op. | Surface the no-transition outcome in the verify skill's Step 13 report line (e.g. `--next: no-op — task already terminal`) rather than relying on the CLI print alone. |
| P3 | `plugins/sp/skills/code-verification/SKILL.md` (Step 12) | Fix-pass writes to `.spur/run/**` artifacts are gitignored, so a `--fix all` verify pass can mutate deliverables invisibly to `git status` and to drift guards. | Document in Step 12 that fix-pass writes under `.spur/run/` are invisible to git; require the Testing write-back to name the exact artifact+lines touched so the mutation is discoverable from the tracked task file. |
| P3 | dogfood run 20260718T235651 | Aggregate cache% 46% (<50% floor), step 1 at 27% (<40%): dogfood Phase-1 loads ~35k chars of scaffolding (SKILL.md + report-template + monitor-ledger + command doc) fresh each run. | Candidate for prompt trimming / cache-stable ordering of dogfood Phase-1 loads. Trend-only; no per-step telemetry exists to bill against. |

Source: `docs/dogfood/2026-07-18-sp-dev-verify-0282-auto-next-force-focus-all-fix-all-dogfood.md` (run `20260718T235651-dev-verify-0282`, verdict PARTIAL, validator `ok`).
### Requirements
R1. **Verify line-anchor verification rule.** In `plugins/sp/skills/code-verification/SKILL.md`, Steps 4–5: every `file:line` evidence citation written into the Testing table must be re-read at the cited lines and confirmed to name the requirement's subject (not merely exist on disk) before a MET row is written. A citation whose anchor resolves to another ticket's content fails the row to UNMET.

R2. **`--next` no-transition surfacing.** In the verify skill's Step 13 report, a `--next` invocation on an already-terminal (`done`/`cancelled`) task must state the no-op in the verify report line itself (e.g. `--next: no-op — task already terminal`), not rely solely on the CLI print in `dev-verify.md:124`.

R3. **Gitignored fix-pass write disclosure.** In Step 12, document that `--fix` writes under `.spur/run/**` are invisible to `git status` and to drift guards, and require the Testing write-back to name the exact artifact + line range the fix pass touched so the mutation is discoverable from the tracked task file.
### Acceptance Criteria
Scenario: Line-anchor verification catches cross-ticket citation
  Given a Testing table row cites `evidence:134` for requirement Rn
  When the cited lines name a different ticket's content, not Rn's subject
  Then the verify skill marks the row UNMET and surfaces the stale anchor as a finding

Scenario: Terminal-task --next states the no-op
  Given a task already at status `done` or `cancelled`
  When `/sp:dev-verify <wbs> --force --next` reaches its Step 13 report
  Then the report line states `--next: no-op — task already terminal` (or equivalent)

Scenario: Fix-pass writes to .spur/run are disclosed
  Given a `--fix` pass that mutates an artifact under `.spur/run/**`
  When the Testing section is written back
  Then it names the exact artifact path and line range the fix touched
### Q&A
- Scope: only the two P2 findings are in scope for this task (R1–R3). The two P3 findings (dogfood cache-health; fix-pass `.spur/run/` visibility *telemetry*) are explicitly deferred — P3-2's disclosure rule is R3, but measuring dogfood cache% per-step has no telemetry and is `[unverifiable]` as billed-cost proof.
- Edits are documentation-only (skill `.md` files); no runtime code path changes.
- R1 is a *process rule* in the skill runbook, not a deterministic gate — enforcement depends on the skill being followed. If a machine gate is wanted, that is a separate (larger) task.
### Design

<!-- Fix approach and tradeoffs if the findings require design judgment. -->

### Plan
- [x] Fix P1 findings
- [x] Fix P2 findings
- [x] Fix all the remaining findings if any
- [x] Re-review the changed code
### Solution
| File | Lines | What / Why |
|------|-------|------------|
| `plugins/sp/skills/code-verification/SKILL.md` | 125-131 | **R1 (Step 4).** Added line-anchor verification rule: every `file:line` citation in the Testing table must be re-read at the cited lines this run and confirmed to name the requirement's subject before a MET row is written. Stale/cross-ticket anchors fail the row to UNMET + surface as a P2+ finding. Closes the 0282 re-audit gap where `evidence:134` was 0281 telemetry text. |
| `plugins/sp/skills/code-verification/SKILL.md` | 166-168 | **R1 (Step 5).** Extended the line-anchor rule to AC evidence citations - same re-read + subject-name check before MET. Keeps requirement and AC evidence under one rule. |
| `plugins/sp/skills/code-verification/SKILL.md` | 308-312 | **R3 (Step 12).** Documented that `.spur/run/**` fix-pass writes are gitignored (invisible to `git status` and drift guards); required the Testing write-back to name the exact artifact path + line range touched so the mutation is discoverable from the tracked task file. |
| `plugins/sp/skills/code-verification/SKILL.md` | 320-325 | **R2 (Step 13).** Added `--next` no-op surfacing: when `--next` hits an already-terminal (`done`/`cancelled`) task, the verify report line itself must state `--next: no-op - task already terminal (<status>)`, not rely solely on the CLI print in `dev-verify.md`. |

**Scope:** documentation-only (skill `.md`); no runtime code path changed. All three in-scope findings (R1-R3) fixed; the P3 dogfood cache% finding is explicitly deferred per task Q&A (no per-step telemetry exists to bill against). Re-review of the changed sections confirms the new rules are internally consistent with Steps 4/5/10/11/12/13 and the `dev-verify.md` `--next` chain contract.
### Testing
**Per-Requirement Traceability**

| Req | Status | Evidence |
|-----|--------|----------|
| R1 | MET | `plugins/sp/skills/code-verification/SKILL.md:125-131` (Step 4 line-anchor rule), `:166-168` (Step 5 AC extension). Line-anchor verified this run: cited lines name the requirement's subject (anti-stale-citation rule for `file:line` evidence). |
| R2 | MET | `plugins/sp/skills/code-verification/SKILL.md:320-325` (Step 13 `--next` no-op surfacing). Line-anchor verified this run: cited lines name the requirement's subject (terminal-task no-op must appear in the report line). |
| R3 | MET | `plugins/sp/skills/code-verification/SKILL.md:308-312` (Step 12 gitignored fix-pass write disclosure). Line-anchor verified this run: cited lines name the requirement's subject (`.spur/run/**` writes invisible to git; Testing write-back must name artifact+lines). |

**Acceptance Criteria Verification**

| AC | Status | Evidence Type | Evidence |
|----|--------|---------------|----------|
| Scenario: Line-anchor verification catches cross-ticket citation [docs-only] | MET | static-ref | `plugins/sp/skills/code-verification/SKILL.md:129-130` - "A citation whose anchor resolves to another ticket's content... fails the row to UNMET and surfaces the stale anchor as a finding (severity >= P2)." |
| Scenario: Terminal-task --next states the no-op [docs-only] | MET | static-ref | `plugins/sp/skills/code-verification/SKILL.md:320-322` - "the verify report line MUST state the no-op itself (e.g. `--next: no-op - task already terminal (<status>)`)" |
| Scenario: Fix-pass writes to .spur/run are disclosed [docs-only] | MET | static-ref | `plugins/sp/skills/code-verification/SKILL.md:310-312` - "The Testing write-back MUST name the exact artifact path and line range the fix pass touched" |

**SECUA Review**

Documentation-only change (skill `.md` runbook rules); no runtime code path modified. No security, efficiency, correctness, usability, or architecture findings. The new rules are internally consistent with Steps 4/5/10/11/12/13 and the `dev-verify.md` `--next` chain contract.

**Checks**

- `design-conformance`: PASS - `### Design` was bare (placeholder); implementation follows the Plan's fix approach directly.
- `scope-creep`: PASS - all four edits map to R1/R2/R3; no out-of-scope changes.
- `evidence-rule-pass`: PASS - all AC rows marked `[docs-only]`; no executable-evidence requirement applies.
- `lint-clean`: PASS - `bun run format` (biome check . --write): "No fixes applied. Checked 498 files in 356ms."

Coverage: N/A (documentation-only change; no runtime code path added).

Verdict: PASS
### Review
Post-implementation reflection - filled **after** the first fix round: what went wrong, what
remains to fix before closing, and any **back-issues** (new findings surfaced by the fix).

All three in-scope findings (R1, R2, R3) are fixed via documentation edits to
`plugins/sp/skills/code-verification/SKILL.md`. No runtime code path changed, so no regression
surface was introduced. Re-review of Steps 4/5/10/11/12/13 confirms the new rules are internally
consistent and do not conflict with the `dev-verify.md` `--next` chain contract.

| Severity | File | Finding | Recommendation |
| -------- | ---- | ------- | -------------- |
| P1       | -    | (none)  | -              |
| P2       | `plugins/sp/skills/code-verification/SKILL.md:125-131, 166-168` | R1 FIXED: line-anchor verification rule added to Steps 4-5; stale/cross-ticket citations now fail the row to UNMET + surface as P2+ findings. | No further action - rule is in place. |
| P2       | `plugins/sp/skills/code-verification/SKILL.md:320-325` | R2 FIXED: `--next` no-op surfacing added to Step 13; report line now states `--next: no-op - task already terminal (<status>)`. | No further action - rule is in place. |
| P3       | `plugins/sp/skills/code-verification/SKILL.md:308-312` | R3 FIXED: `.spur/run/**` fix-pass write disclosure added to Step 12; Testing write-back now required to name exact artifact + line range. | No further action - rule is in place. |
| P3       | dogfood run `20260718T235651` | DEFERRED: aggregate cache% 46% (<50% floor), step 1 at 27% (<40%). No per-step telemetry exists to bill against. | Out of scope per task Q&A. Trend-only; candidate for a separate prompt-trimming task if telemetry is added. |
| P4       | -    | (none)  | -              |

**Back-issues (new findings from the fix):** none. The edits are additive runbook rules in a
skill `.md`; they introduce no new code paths, gates, or schema. The Step 5 cross-reference to
the Step 4 rule is a one-line pointer, not a divergent rule.
### References

<!-- Links to source review, dogfood report, PR/diff, related tasks, or external references. -->

### History
- 2026-07-19T18:16:58.711Z backlog → todo (system)
- 2026-07-19T18:19:09.745Z todo → wip (system)
- 2026-07-19T18:22:59.720Z wip → testing (system)
- 2026-07-19T18:24:42.865Z testing → done (system)
