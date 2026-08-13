---
template: feature-impl
schema_version: 1
name: "Record G2 supervision AC verdicts so verifying can go done"
description: ""
status: todo
type: task
profile: standard
feature_id: G2
parent_wbs: null
priority: P2
tags: []
dependencies: []
ac_numbering: task-local
created_at: "2026-08-13T05:25:12.480Z"
updated_at: "2026-08-13T05:47:52.870Z"
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

<!-- Filled during implementation: file:line change map and concise rationale. -->

### Testing

<!-- Filled during verification: commands run, outcomes, coverage claim or N/A. -->

### Review

<!-- Filled during review: P1-P4 findings, residual risk, and final disposition. -->

### References
- Feature G2 (active until this task done). Covering tasks: `docs/tasks2/0195_*`, `0207_*`, `0208_*`, `0209_*`, `0210_*`
- Parser: `packages/app/src/services/feature-check.ts` `readVerdictArtifact` / `rowMatchesScenario`
- Shape: `packages/app/src/services/task-record.ts` `VerifyVerdict`
- Tests: `packages/app/tests/services/supervisor-service.test.ts`, `apps/cli/tests/commands/team.test.ts`, `apps/server/tests/modules/team/index.test.ts`
### History
