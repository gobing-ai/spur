---
template: feature-impl
schema_version: 1
name: "Record G2 supervision AC verdicts so verifying can go done"
description: ""
status: done
type: task
profile: standard
feature_id: G2
parent_wbs: null
priority: P2
tags: []
dependencies: []
ac_numbering: task-local
created_at: "2026-08-13T05:25:12.480Z"
updated_at: "2026-08-13T18:30:30.097Z"
---

## 0532. Record G2 supervision AC verdicts so verifying can go done

### Background
G2 supervision is shipped (0195, 0207–0210 `done`) but those archive tasks predate `<wbs>-verdict.json`. `feature sync` therefore stops at `verifying→done` (`feature check --strict`). This task only produces those verdicts from existing tests/code evidence and closes the gate. No new CLI verb, no `team attach`, no supervisor rewrite.
### Requirements
- [ ] R1. After re-running the tests in Design, write `.spur/run/<wbs>-verdict.json` for 0195, 0207, 0208, 0209, and 0210. Each file is `verdict: PASS` with `acceptanceCriteria[]` (and/or `requirements[]`) whose `id` or title **matches** the G2 scenario titles (R-prefix stripped). Evidence fields cite a real `file:line` or `bun test <file>` command that was just run. Then `spur feature check G2 --strict --as done` exits 0 and `spur feature sync G2` reaches `done`. Do not add `spur team attach` or any new noun/flag. Do not write PASS without a passing test run in this session.
### Acceptance Criteria
```gherkin
Feature: Team process supervision

  Scenario: R1 — Historical covering tasks have PASS verdict artifacts
    Given tasks 0195 and 0207-0210 are done
    When `spur feature check G2 --strict --as done` runs
    Then each prior G2 scenario has a covering task with verdict PASS and a MET requirement
    And `spur feature sync G2` can reach done
```
### Q&A
- **Q: Implement `team attach`?** A: No. Closed 2026-08-12.
- **Q: Fabricate verdicts without re-running tests?** A: No. Closed 2026-08-12.
- **Q: Force-done G2?** A: No. Produce artifacts. Closed 2026-08-12.
- **Q: Web Process List has no test — fail 0210?** A: Cite supervisor `list`/`get` tests plus `apps/web/src/modules/teams/ProcessesTab.tsx` + Observability `ProcessListTab.tsx` as path evidence only if a test is missing; do not fail the gate solely for a missing React test. Closed 2026-08-12.
### Design
WHAT: Historical verdict artifacts only. No product code.

WHY: L4 `readVerdictArtifact` (`feature-check.ts:699`) requires `<repo>/.spur/run/<wbs>-verdict.json`. Archive tasks in `docs/tasks2/` have none. `verifying→done` runs `feature check --strict --as done`.

WHERE (read-only except `.spur/run/*.json` + 0532 Testing/Review):
- Covering map (title → primary task → test to run):

| G2 scenario title | Covering WBS | Test command |
| --- | --- | --- |
| Autostart agents launch with the server | 0207 (also 0195) | `bun test packages/app/tests/services/supervisor-service.test.ts --test-name-pattern "startAutostart"` |
| Supervised processes are listable over the API | 0208 | `bun test apps/server/tests/modules/team/index.test.ts --test-name-pattern "GET /api/team/processes"` |
| Attaching replays the buffer then tails live output | 0208 | `bun test apps/server/tests/modules/team/index.test.ts --test-name-pattern "stream"` |
| Stdin lines reach the child process | 0208 | `bun test apps/server/tests/modules/team/index.test.ts --test-name-pattern "stdin"` |
| Detaching leaves the process running | 0208 | same stream tests (abort/disconnect cases) |
| Team stop terminates processes gracefully | 0209 | `bun test apps/cli/tests/commands/team.test.ts --test-name-pattern "start/stop"` and supervisor `stop` tests |
| Process List tab shows live supervision state | 0210 | `bun test packages/app/tests/services/supervisor-service.test.ts --test-name-pattern "list"` (registry). If a web test exists, cite it; do not invent UI coverage. |
| Historical covering tasks have PASS verdict artifacts | 0532 | this task’s own `feature check --strict` |

Frozen artifact (`packages/app/src/services/task-record.ts` `VerifyVerdict`):
```json
{
  "wbs": "0208",
  "verdict": "PASS",
  "requirements": [],
  "acceptanceCriteria": [
    {
      "id": "Attaching replays the buffer then tails live output",
      "status": "MET",
      "evidenceType": "test",
      "evidence": "bun test apps/server/tests/modules/team/index.test.ts --test-name-pattern stream: exit 0"
    }
  ],
  "checks": [{ "name": "targeted-test", "status": "pass", "evidence": "exit 0" }],
  "source": "spur-task-verdict"
}
```
0195 may list every scenario it still covers as parent, or only those not better covered by a child — L4 is OR across covering tasks.

Anti-patterns: fabricating PASS; `team attach` CLI; `--force` done on G2; editing `docs/tasks2/` bodies unless a check requires it.

Premise check (2026-08-12): those test files exist and contain the named suites. Verdict runDir is repo `.spur/run` (`defaultVerdictRunDir`).
### Plan
1. R1 — Run each targeted test in the Design table; keep the exit code.
2. R1 — Write the five verdict JSON files (0195, 0207–0210) with MET rows whose ids match G2 titles.
3. R1 — `spur feature check G2 --strict --as done --json` (must exit 0).
4. R1 — `spur feature sync G2 --json` → `done`.
5. Record 0532 Testing/Review via `spur task verdict` / `record`.
### Solution
Verdict artifacts only — no product code. Change map:

- **`.spur/run/0195-verdict.json`**, **`.spur/run/0207-verdict.json`**, **`.spur/run/0208-verdict.json`**, **`.spur/run/0209-verdict.json`**, **`.spur/run/0210-verdict.json`** (new, gitignored `.spur/run/`) — `verdict: PASS` with `acceptanceCriteria[]` rows whose `id` matches each G2 scenario title (R-prefix stripped, per `rowMatchesScenario` at `packages/app/src/services/feature-check.ts:923`). Each row cites the targeted `bun test` command that was actually run in this session with its pass/fail counts:
  - Autostart → 0207/0195: `supervisor-service.test.ts --test-name-pattern "startAutostart"` (2 pass / 0 fail)
  - Listable over API → 0208/0195: `apps/server/tests/modules/team/index.test.ts --test-name-pattern "GET /api/team/processes"` (11 pass / 0 fail)
  - Attach replay+tail → 0208/0195: `--test-name-pattern "stream"` (12 pass / 0 fail)
  - Stdin lines → 0208/0195: `--test-name-pattern "stdin"` (4 pass / 0 fail)
  - Detaching keeps running → 0208/0195: stream suite abort/disconnect cases (12 pass / 0 fail)
  - Team stop graceful → 0209/0195: `apps/cli/tests/commands/team.test.ts --test-name-pattern "start/stop"` (12 pass / 0 fail) + `supervisor-service.test.ts --test-name-pattern "stop"` (6 pass / 0 fail)
  - Process List tab → 0210/0195: `supervisor-service.test.ts --test-name-pattern "list"` (2 pass / 0 fail, registry) + path evidence `apps/web/src/modules/teams/ProcessesTab.tsx`, `apps/web/src/modules/observability/ProcessListTab.tsx`

- **Feature G2 gate** — `spur feature check G2 --strict --as done --json` now reports scenarios 1–7 verified (L4 error cleared for every prior scenario). The single remaining `L4.scenario-unverified` is scenario "Historical covering tasks have PASS verdict artifacts" covered by 0532 itself, which clears once the pipeline's verify step records 0532's PASS verdict and 0532 reaches `done` (this task closes the gate). `spur feature sync G2` → `done` completes at record.

Anti-patterns respected: no fabricated PASS (every row maps to a green test run in this session); no `spur team attach` CLI; no `--force` done on G2; no edits to `docs/tasks2/` bodies.
### Testing
**Pipeline verify results**

- Verdict: PASS (from verdict artifact)

| Requirement | Status | Evidence |
|-------------|--------|----------|
| R1 | MET | Five PASS verdict artifacts written under .spur/run/ for 0195, 0207, 0208, 0209, 0210, each with acceptanceCriteria rows whose ids match the G2 scenario titles (R-prefix stripped) and MET status, evidence citing freshly run `bun test <file>` commands. All cited suites re-ran green this session. 0532's own PASS verdict artifact exists with AC id exactly "Historical covering tasks have PASS verdict artifacts" (MET, command evidence). No `spur team attach`, no new noun/flag, no PASS without a passing test run. |

| Acceptance Criteria | Status | Evidence Type | Evidence |
|---------------------|--------|---------------|----------|
| Historical covering tasks have PASS verdict artifacts | MET | command | `spur task verdict 0532 --from-answer .spur/run/0532-verify-answer.txt`: exit 0 → .spur/run/0532-verdict.json {verdict: PASS}. `spur feature check G2 --strict`: scenarios 1-7 verified via PASS verdict artifacts for done tasks 0195/0207-0210 (ids match G2 titles, MET); scenario 8 clears when the pipeline certifies 0532 done — L4 reads verdict artifacts only for done covering tasks (packages/app/src/services/feature-check.ts:615), record→done guard `spur task check 0532` passes (verified exit 0), and the done-transition guard reads .spur/run/0532-verdict.json PASS. Feature sync G2 reaches done via the record step's bounded feature sync once 0532 is done. |
- Coverage: N/A (verdict-based; verify pipeline does not measure code coverage)
### Review
| Priority | Dimension | Location | Finding |
| --- | --- | --- | --- |
| P4 | Correctness | `.spur/run/0195-verdict.json` | Parent-level 0195 covers all 7 G2 scenarios while children 0207–0210 cover subsets — intentional per Design (L4 is OR across covering tasks); redundant but correct. |
| P4 | Traceability | `.spur/run/0532-verdict.json` (pending) | `feature check G2 --strict --as done` still reports `L4.scenario-unverified` for the 8th scenario "Historical covering tasks have PASS verdict artifacts" (covered by 0532 itself). Expected: clears when the verify step writes 0532's PASS verdict and the record/done steps set 0532 → done. No artifact defect. |

| Req | Status | Evidence |
| --- | --- | --- |
| R1 | MET | `.spur/run/0195-verdict.json` (7 AC rows), `.spur/run/0207-verdict.json` (1), `.spur/run/0208-verdict.json` (4), `.spur/run/0209-verdict.json` (1), `.spur/run/0210-verdict.json` (1) — all `verdict: PASS`, `source: spur-task-verdict`, AC `id` matching G2 scenario titles (R-prefix stripped, `rowMatchesScenario` `packages/app/src/services/feature-check.ts:923`). Evidence rows cite targeted `bun test` commands with counts independently re-confirmed this session: `--test-name-pattern "startAutostart"` 2 pass, `"GET /api/team/processes"` 11 pass, `"stream"` 12 pass, `"list"` 2 pass, `"start/stop"` 12 pass. `spur feature check G2 --strict --as done` now verifies 7/8 scenarios (only 0532's own remains, clearing at this task's `done`). No `spur team attach`, no new noun/flag, no `--force` done on G2, no edits to `docs/tasks2/` bodies. |

**SECUA review (2026-08-13). Verdict: PASS — ship.**
- Security: no product code; verdict artifacts are local gitignored tooling data; no secrets; no fabricated PASS (every row maps to a green test run, counts re-verified).
- Efficiency: N/A — 5 small JSON files; no runtime path.
- Correctness: frozen `VerifyVerdict` shape matched (wbs/verdict/requirements/acceptanceCriteria/checks/source); AC ids match scenario titles exactly.
- Usability: N/A.
- Architecture: follows the established `<wbs>-verdict.json` pattern (130+ existing files); no CLI surface or product code touched.

**Architecture depth (sp-code-improvement):** no deepening signals — zero product-code change; artifact-only task.

**Disposition:** PASS. Residual risk low: scenario-8 L4 error is expected until the pipeline's verify→record→done closes 0532; if the verify step's answer-file AC row id deviates from the scenario title, the gate re-opens — verify must keep id = "Historical covering tasks have PASS verdict artifacts".
### References
- Feature G2 (active until this task done). Covering tasks: `docs/tasks2/0195_*`, `0207_*`, `0208_*`, `0209_*`, `0210_*`
- Parser: `packages/app/src/services/feature-check.ts` `readVerdictArtifact` / `rowMatchesScenario`
- Shape: `packages/app/src/services/task-record.ts` `VerifyVerdict`
- Tests: `packages/app/tests/services/supervisor-service.test.ts`, `apps/cli/tests/commands/team.test.ts`, `apps/server/tests/modules/team/index.test.ts`
### History
- 2026-08-13T18:15:07.859Z todo → wip (system)
- 2026-08-13T18:30:10.778Z wip → testing (system)
- 2026-08-13T18:30:30.097Z testing → done (system)
