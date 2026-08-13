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
updated_at: "2026-08-13T20:18:19.931Z"
---

## 0532. Record G2 supervision AC verdicts so verifying can go done

### Background
G2 supervision is shipped (0195, 0207–0210 `done`) but those archive tasks predate `<wbs>-verdict.json`. `feature sync` therefore stops at `verifying→done` (`feature check --strict`). This task only produces those verdicts from existing tests/code evidence and closes the gate. No new CLI verb, no `team attach`, no supervisor rewrite.
### Requirements
- [x] R1. After re-running the tests in Design, write `.spur/run/<wbs>-verdict.json` for 0195, 0207, 0208, 0209, and 0210. Each file is `verdict: PASS` with `acceptanceCriteria[]` (and/or `requirements[]`) whose `id` or title **matches** the G2 scenario titles (R-prefix stripped). Evidence fields cite a real `file:line` or `bun test <file>` command that was just run. Then `spur feature check G2 --strict --as done` exits 0 and `spur feature sync G2` reaches `done`. Do not add `spur team attach` or any new noun/flag. Do not write PASS without a passing test run in this session.
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
1. [x] R1 — Run each targeted test in the Design table; keep the exit code.
2. [x] R1 — Write the five verdict JSON files (0195, 0207–0210) with MET rows whose ids match G2 titles.
3. [x] R1 — `spur feature check G2 --strict --as done --json` (must exit 0).
4. [x] R1 — `spur feature sync G2 --json` → `done`.
5. [x] Record 0532 Testing/Review via `spur task verdict` / `record`.
### Solution
Verdict artifacts only — no product code. Change map:

- **`.spur/run/0195-verdict.json`**, **`.spur/run/0207-verdict.json`**, **`.spur/run/0208-verdict.json`**, **`.spur/run/0209-verdict.json`**, **`.spur/run/0210-verdict.json`** (new, gitignored `.spur/run/`) — `verdict: PASS` with `acceptanceCriteria[]` rows whose `id` matches each G2 scenario title (R-prefix stripped, per `rowMatchesScenario` at `packages/app/src/services/feature-check.ts:923-934`). Each row cites the targeted `bun test` command re-run on the 2026-08-13 verify pass:
  - Autostart → 0207/0195: `supervisor-service.test.ts --test-name-pattern "startAutostart"` (2 pass / 0 fail)
  - Listable over API → 0208/0195: `apps/server/tests/modules/team/index.test.ts --test-name-pattern "GET /api/team/processes"` (11 pass / 0 fail)
  - Attach replay+tail → 0208/0195: `--test-name-pattern "stream"` (12 pass / 0 fail)
  - Stdin lines → 0208/0195: `--test-name-pattern "stdin"` (4 pass / 0 fail)
  - Detaching keeps running → 0208/0195: stream suite abort/disconnect cases (12 pass / 0 fail)
  - Team stop graceful → 0209/0195: `apps/cli/tests/commands/team.test.ts --test-name-pattern "start/stop"` (12 pass / 0 fail) + `supervisor-service.test.ts --test-name-pattern "stop"` (6 pass / 0 fail)
  - Process List tab → 0210/0195: `supervisor-service.test.ts --test-name-pattern "list"` (2 pass / 0 fail, registry) + path evidence `apps/web/src/modules/teams/ProcessesTab.tsx:7-15,40`, `apps/web/src/modules/observability/ProcessListTab.tsx:31-39`

- **Feature G2 gate (landed).** `spur feature check G2 --strict --as done --json` exits 0 with 0 findings (all 8 scenarios verified). `spur feature sync G2` is `done→done` ("All linked tasks are terminal and feature is closed"). G2 frontmatter `status: done` (2026-08-13T18:30:35Z). 0532's own scenario is covered by `.spur/run/0532-verdict.json` (`id` = `Historical covering tasks have PASS verdict artifacts`, MET, command).

Anti-patterns respected: no fabricated PASS (every row maps to a green test run); no `spur team attach` CLI; no `--force` done on G2; no edits to `docs/tasks2/` bodies.
### Testing
**Re-verify 2026-08-13 (`/sp-dev-verify 0532 --auto --next --force --focus all --fix all`).** `--force` re-audit of an already-`done` task. All Design-table tests re-ran this session (0 fail). Fix pass: flipped R1 checklist `[ ]` → `[x]`; refreshed `.spur/run/{0195,0207,0208,0209,0210}-verdict.json` evidence to this-run counts.

**Verdict: PASS**

**Per-Requirement Traceability**

| Requirement | Status | Evidence |
|-------------|--------|----------|
| R1 | MET | Five PASS artifacts rewritten this run: `.spur/run/0195-verdict.json` (7 AC), `.spur/run/0207-verdict.json` (1), `.spur/run/0208-verdict.json` (4), `.spur/run/0209-verdict.json` (1), `.spur/run/0210-verdict.json` (1). AC `id`s match G2 titles (R-prefix stripped; matcher `packages/app/src/services/feature-check.ts:923-934`). This-run tests (0 fail): `startAutostart` 2, `GET /api/team/processes` 11, `stream` 12, `stdin` 4, CLI `start/stop` 12, supervisor `stop` 6, supervisor `list` 2. `spur feature check G2 --strict --as done --json` exit 0, findings []. `spur feature sync G2 --dry-run` → already `done`. No `team attach` (`spur team --help` has start/stop only). |

**Acceptance Criteria Verification**

| Acceptance Criteria | Status | Evidence Type | Evidence |
|---------------------|--------|---------------|----------|
| Scenario: Historical covering tasks have PASS verdict artifacts | MET | command | `spur feature check G2 --strict --as done --json` this run: exit 0, `pass: true`, 0 findings (scenarios 1–8 covered). Covering tasks 0195/0207–0210/0532 all `done`. Sync proposal `done→done` ("All linked tasks are terminal and feature is closed"). |

**Checks**

| Check | Status | Evidence |
|-------|--------|----------|
| design-conformance | pass | 6/6 claims DONE (artifacts only; no product code; ids match titles; tests re-run; gate exit 0; no attach/force-done) |
| scope-creep | pass | No product/CLI surface change this task |
| evidence-rule-pass | pass | Core AC has `command` evidence this turn |
| cli-golden-path-present | pass | `spur feature check G2 --strict --as done --json` exit 0 |

**Coverage:** N/A (verdict-artifact / documentation-only change; no runtime code path added).

**Fix-pass artifacts (gitignored; disclosed here):** `.spur/run/0195-verdict.json`, `.spur/run/0207-verdict.json`, `.spur/run/0208-verdict.json`, `.spur/run/0209-verdict.json`, `.spur/run/0210-verdict.json`, `.spur/run/0532-verify-answer.txt`, `.spur/run/0532-verdict.json` rewritten this run. `.spur/run/0532-fix-created.json` = `[]`.

**`--next`:** no-op — task already terminal (`done`).
### Review
**SECUA + traceability review (0532, 2026-08-13). Re-audit after G2 reached `done`.**

| Prio | Dimension | Location | Finding | Status |
| --- | --- | --- | --- | --- |
| P4 | Correctness | `.spur/run/0195-verdict.json` | Parent 0195 covers all 7 G2 product scenarios while children 0207–0210 cover subsets. | accepted — Design: L4 is OR across covering tasks |
| P4 | Traceability | `.spur/run/0532-verdict.json` | Scenario 8 ("Historical covering tasks have PASS verdict artifacts") was pending while 0532 was `wip`. | cleared — 0532 is `done`; `feature check G2 --strict --as done` 0 findings |

**Traceability (R1):**
- R1 ✓ — five historical PASS artifacts + 0532 PASS; AC ids match G2 titles; this-session tests green; `feature check G2 --strict --as done` exit 0; G2 `done`. No `team attach`, no new noun/flag, no `--force` on G2.

**Disposition:** PASS. Residual risk low: gitignored verdict files can be deleted; re-create with the Design table + a fresh test run.
### References
- Feature G2 (`done` after this task). Covering tasks: `docs/tasks2/0195_*`, `0207_*`, `0208_*`, `0209_*`, `0210_*`
- Parser: `packages/app/src/services/feature-check.ts` `readVerdictArtifact` / `rowMatchesScenario` (`:923-934`)
- Shape: `packages/app/src/services/task-record.ts` `VerifyVerdict`
- Tests: `packages/app/tests/services/supervisor-service.test.ts`, `apps/cli/tests/commands/team.test.ts`, `apps/server/tests/modules/team/index.test.ts`
### History
- 2026-08-13T18:15:07.859Z todo → wip (system)
- 2026-08-13T18:30:10.778Z wip → testing (system)
- 2026-08-13T18:30:30.097Z testing → done (system)
