# 1403 surface reduction

schemaVersion: 1
report: surface-reduction
measuredAt: 2026-11-18T08:50:19.895Z
sourceArtifact: /tmp/1403-artifact.json (spur history analyze, 2026-10-19T00:00:00.000Z .. 2026-11-18T00:00:00.000Z)
sourceDatabase: /Users/robin/xprojects/spur-new/.spur/spur.db
window: 30 days, comparable=true

## Reason

Reduction candidates for the plugin's authored surfaces, derived from 30 days of real invocation evidence across 4 sources. A `delete` row has zero calls in a comparable window; an unmeasured surface is never cut. This report proposes only — no cut is applied here (1404 owns application).

## Totals

- items: 94
- delete: 42
- merge: 0
- keep: 43
- keep — no evidence: 9

## Rows

| Kind | Name | Calls | By source | Lifetime | Last use | Failure rate | Recommendation | Rationale |
| --- | --- | ---: | --- | ---: | --- | ---: | --- | --- |
| command | `sp:dev-wrapall` | 0 | — | 21 | 2026-10-08 | — | delete | zero calls in the 30-day window; last used 2026-10-08 (21 lifetime) |
| command | `sp:dev-job-dump` | 0 | — | 0 | — | — | delete | zero calls in the window and no lifetime calls in any source |
| command | `sp:dev-next` | 0 | — | 5 | 2026-09-14 | — | delete | zero calls in the 30-day window; last used 2026-09-14 (5 lifetime) |
| command | `sp:dev-feature-change` | 0 | — | 0 | — | — | delete | zero calls in the window and no lifetime calls in any source |
| command | `sp:dev-verifyall` | 16 | codex:9 grok:4 pi:3 | 93 | 2026-11-17 | — | keep | invoked 16× (codex 9, grok 4, pi 3) |
| command | `sp:rule-refine` | 0 | — | 1 | 2026-09-03 | — | delete | zero calls in the 30-day window; last used 2026-09-03 (1 lifetime) |
| command | `sp:dev-find-next` | 0 | — | 2 | 2026-08-10 | — | delete | zero calls in the 30-day window; last used 2026-08-10 (2 lifetime) |
| command | `sp:rule-add` | 0 | — | 9 | 2026-10-14 | — | delete | zero calls in the 30-day window; last used 2026-10-14 (9 lifetime) |
| command | `sp:dev-refactor` | 0 | — | 1 | — | — | delete | zero calls in the 30-day window; last used — (1 lifetime) |
| command | `sp:dev-simplify` | 0 | — | 0 | — | — | delete | zero calls in the window and no lifetime calls in any source |
| command | `sp:dev-refresh` | 0 | — | 0 | — | — | delete | zero calls in the window and no lifetime calls in any source |
| command | `sp:dev-wrap` | 1 | pi:1 | 65 | 2026-11-15 | — | keep | invoked 1× (pi 1) |
| command | `sp:dev-idea` | 5 | claude:1 codex:3 pi:1 | 63 | 2026-11-18 | — | keep | invoked 5× (claude 1, codex 3, pi 1) |
| command | `sp:dev-review-session` | 13 | pi:13 | 161 | 2026-10-25 | — | keep | invoked 13× (pi 13) |
| command | `sp:workflow-refine` | 0 | — | 0 | — | — | delete | zero calls in the window and no lifetime calls in any source |
| command | `sp:dev-find-way` | 0 | — | 0 | — | — | delete | zero calls in the window and no lifetime calls in any source |
| command | `sp:dev-verify` | 5 | codex:2 grok:1 pi:2 | 275 | 2026-11-15 | — | keep | invoked 5× (codex 2, grok 1, pi 2) |
| command | `sp:dev-unit` | 1 | pi:1 | 26 | 2026-11-15 | — | keep | invoked 1× (pi 1) |
| command | `sp:dev-fixgha` | 14 | pi:14 | 24 | 2026-11-18 | — | keep | invoked 14× (pi 14) |
| command | `sp:dev-job-resume` | 0 | — | 0 | — | — | delete | zero calls in the window and no lifetime calls in any source |
| command | `sp:dev-pr-review` | 0 | — | 2 | 2026-10-04 | — | delete | zero calls in the 30-day window; last used 2026-10-04 (2 lifetime) |
| command | `sp:workflow-add` | 0 | — | 0 | — | — | delete | zero calls in the window and no lifetime calls in any source |
| command | `sp:dev-handover` | 0 | — | 0 | — | — | delete | zero calls in the window and no lifetime calls in any source |
| command | `sp:dev-find-issue` | 1 | pi:1 | 5 | 2026-11-10 | — | keep | invoked 1× (pi 1) |
| command | `sp:dev-runall` | 39 | codex:10 pi:29 | 366 | 2026-11-18 | — | keep | invoked 39× (codex 10, pi 29) |
| command | `sp:rule-scan` | 0 | — | 0 | — | — | delete | zero calls in the window and no lifetime calls in any source |
| command | `sp:dev-daily` | 0 | — | 0 | — | — | delete | zero calls in the window and no lifetime calls in any source |
| command | `sp:dev-arch` | 0 | — | 0 | — | — | delete | zero calls in the window and no lifetime calls in any source |
| command | `sp:dev-fixall` | 15 | codex:6 pi:9 | 147 | 2026-11-08 | — | keep | invoked 15× (codex 6, pi 9) |
| command | `sp:spur-init` | 6 | pi:6 | 6 | 2026-11-10 | — | keep | invoked 6× (pi 6) |
| command | `sp:dev-gtd` | 0 | — | 2 | 2026-08-16 | — | delete | zero calls in the 30-day window; last used 2026-08-16 (2 lifetime) |
| command | `sp:dev-changelog` | 27 | pi:27 | 176 | 2026-11-18 | — | keep | invoked 27× (pi 27) |
| command | `sp:dev-refineall` | 8 | claude:3 codex:2 pi:3 | 64 | 2026-11-16 | — | keep | invoked 8× (claude 3, codex 2, pi 3) |
| command | `sp:dev-find-conflict` | 1 | pi:1 | 4 | 2026-11-14 | — | keep | invoked 1× (pi 1) |
| command | `sp:dev-brainstorm` | 0 | — | 3 | 2026-09-03 | — | delete | zero calls in the 30-day window; last used 2026-09-03 (3 lifetime) |
| command | `sp:dev-reverse` | 0 | — | 0 | — | — | delete | zero calls in the window and no lifetime calls in any source |
| command | `sp:dev-dogfood` | 4 | claude:2 grok:1 pi:1 | 39 | 2026-11-10 | — | keep | invoked 4× (claude 2, grok 1, pi 1) |
| command | `sp:dev-run` | 76 | claude:2 codex:56 pi:18 | 583 | 2026-11-18 | — | keep | invoked 76× (claude 2, codex 56, pi 18) |
| command | `sp:dev-debug` | 1 | pi:1 | 1 | 2026-11-09 | — | keep | invoked 1× (pi 1) |
| command | `sp:dev-refine` | 15 | codex:12 pi:3 | 76 | 2026-11-14 | — | keep | invoked 15× (codex 12, pi 3) |
| command | `sp:dev-gitmsg` | 81 | pi:81 | 600 | 2026-11-18 | — | keep | invoked 81× (pi 81) |
| command | `sp:dev-review` | 9 | codex:2 pi:7 | 232 | 2026-11-18 | — | keep | invoked 9× (codex 2, pi 7) |
| command | `sp:dev-plan` | 2 | claude:1 pi:1 | 9 | 2026-11-08 | — | keep | invoked 2× (claude 1, pi 1) |
| skill | `sp:parallel-execution` | 0 | — | 0 | — | — | delete | zero calls in the window and no lifetime calls in any source |
| skill | `sp:sys-architecture` | 2 | codex:1 pi:1 | 11 | 2026-11-09 | — | keep | invoked 2× (codex 1, pi 1) |
| skill | `sp:spur-doctor` | 1 | pi:1 | 1 | 2026-11-09 | — | keep | invoked 1× (pi 1) |
| skill | `sp:next-feature` | 1 | claude:1 | 4 | 2026-11-16 | — | keep | invoked 1× (claude 1) |
| skill | `sp:test-driven-development` | 9 | codex:7 pi:2 | 9 | 2026-11-15 | — | keep | invoked 9× (codex 7, pi 2) |
| skill | `sp:functional-review` | 9 | codex:8 pi:1 | 126 | 2026-11-07 | — | keep | invoked 9× (codex 8, pi 1) |
| skill | `sp:code-verification` | 42 | claude:13 codex:18 grok:4 pi:7 | 536 | 2026-11-17 | — | keep | invoked 42× (claude 13, codex 18, grok 4, pi 7) |
| skill | `sp:wayfinder` | 0 | — | 7 | 2026-10-09 | — | delete | zero calls in the 30-day window; last used 2026-10-09 (7 lifetime) |
| skill | `sp:spur-cli` | 58 | codex:47 grok:4 pi:7 | 85 | 2026-11-18 | — | keep | invoked 58× (codex 47, grok 4, pi 7) |
| skill | `sp:spur-composer` | 0 | — | 1 | 2026-10-04 | — | delete | zero calls in the 30-day window; last used 2026-10-04 (1 lifetime) |
| skill | `sp:brainstorm` | 2 | codex:2 | 12 | 2026-11-16 | — | keep | invoked 2× (codex 2) |
| skill | `sp:sp-bot-bootstrap` | 0 | — | 0 | — | — | delete | zero calls in the window and no lifetime calls in any source |
| skill | `sp:fleet-join` | 0 | — | 0 | — | — | delete | zero calls in the window and no lifetime calls in any source |
| skill | `sp:code-review` | 0 | — | 2 | 2026-09-13 | — | delete | zero calls in the 30-day window; last used 2026-09-13 (2 lifetime) |
| skill | `sp:history-anatomy` | 28 | grok:9 pi:19 | 81 | 2026-11-17 | — | keep | invoked 28× (grok 9, pi 19) |
| skill | `sp:indexed-context` | 0 | — | 4 | 2026-09-24 | — | delete | zero calls in the 30-day window; last used 2026-09-24 (4 lifetime) |
| skill | `sp:sys-debugging` | 2 | pi:2 | 5 | 2026-11-09 | — | keep | invoked 2× (pi 2) |
| skill | `sp:code-testing` | 1 | pi:1 | 18 | 2026-11-15 | — | keep | invoked 1× (pi 1) |
| skill | `sp:code-implementation` | 51 | claude:4 codex:27 grok:10 pi:10 | 291 | 2026-11-18 | — | keep | invoked 51× (claude 4, codex 27, grok 10, pi 10) |
| skill | `sp:reverse-engineering` | 0 | — | 0 | — | — | delete | zero calls in the window and no lifetime calls in any source |
| skill | `sp:spur-check` | 0 | — | 2 | 2026-10-16 | — | delete | zero calls in the 30-day window; last used 2026-10-16 (2 lifetime) |
| skill | `sp:branch-workflow` | 1 | pi:1 | 6 | 2026-11-14 | — | keep | invoked 1× (pi 1) |
| skill | `sp:daily-summary` | 0 | — | 0 | — | — | delete | zero calls in the window and no lifetime calls in any source |
| skill | `sp:dogfood-testing` | 6 | claude:3 grok:2 pi:1 | 40 | 2026-11-10 | — | keep | invoked 6× (claude 3, grok 2, pi 1) |
| skill | `sp:redesign-web-ui` | 0 | — | 0 | — | — | delete | zero calls in the window and no lifetime calls in any source |
| skill | `sp:spec-decomposition` | 2 | codex:1 pi:1 | 7 | 2026-11-08 | — | keep | invoked 2× (codex 1, pi 1) |
| skill | `sp:taste-refactoring-api` | 0 | — | 0 | — | — | delete | zero calls in the window and no lifetime calls in any source |
| skill | `sp:code-improvement` | 8 | codex:7 pi:1 | 107 | 2026-11-06 | — | keep | invoked 8× (codex 7, pi 1) |
| skill | `sp:pr-reviewing` | 0 | — | 2 | 2026-10-04 | — | delete | zero calls in the 30-day window; last used 2026-10-04 (2 lifetime) |
| skill | `sp:conflict-finding` | 4 | claude:3 pi:1 | 11 | 2026-11-14 | — | keep | invoked 4× (claude 3, pi 1) |
| skill | `sp:taste-refactoring-tests` | 0 | — | 0 | — | — | delete | zero calls in the window and no lifetime calls in any source |
| skill | `sp:doc-evolve` | 18 | codex:10 pi:8 | 74 | 2026-11-15 | — | keep | invoked 18× (codex 10, pi 8) |
| skill | `sp:code-refactoring` | 0 | — | 1 | — | — | delete | zero calls in the 30-day window; last used — (1 lifetime) |
| skill | `sp:code-simplification` | 0 | — | 0 | — | — | delete | zero calls in the window and no lifetime calls in any source |
| skill | `sp:doubt-driven-development` | 0 | — | 0 | — | — | delete | zero calls in the window and no lifetime calls in any source |
| skill | `sp:source-driven-development` | 1 | codex:1 | 2 | 2026-10-22 | — | keep | invoked 1× (codex 1) |
| skill | `sp:taste-refactoring-architect` | 0 | — | 1 | — | — | delete | zero calls in the 30-day window; last used — (1 lifetime) |
| skill | `sp:taste-refactoring-ui` | 0 | — | 0 | — | — | delete | zero calls in the window and no lifetime calls in any source |
| skill | `sp:next-router` | 4 | grok:2 pi:2 | 33 | 2026-11-10 | — | keep | invoked 4× (grok 2, pi 2) |
| skill | `sp:session-review` | 12 | claude:5 pi:7 | 180 | 2026-10-27 | — | keep | invoked 12× (claude 5, pi 7) |
| skill | `sp:issue-finding` | 0 | — | 5 | 2026-08-21 | — | delete | zero calls in the 30-day window; last used 2026-08-21 (5 lifetime) |
| skill | `sp:spur-dev` | 68 | claude:21 codex:19 grok:7 pi:21 | 603 | 2026-11-18 | — | keep | invoked 68× (claude 21, codex 19, grok 7, pi 21) |
| subagent | `sp:super-reviewer` | 0 | — | 40 | 2026-11-17 | — | keep — no evidence | history_skill_call does not record Agent-tool invocations by subagent_type, so a cut would rest on no measurement. |
| subagent | `sp:super-planner` | 0 | — | 1 | 2026-09-17 | — | keep — no evidence | history_skill_call does not record Agent-tool invocations by subagent_type, so a cut would rest on no measurement. |
| subagent | `sp:super-coder` | 0 | — | 2 | 2026-09-10 | — | keep — no evidence | history_skill_call does not record Agent-tool invocations by subagent_type, so a cut would rest on no measurement. |
| subagent | `sp:expert-spur` | 0 | — | 3 | 2026-11-10 | — | keep — no evidence | history_skill_call does not record Agent-tool invocations by subagent_type, so a cut would rest on no measurement. |
| mcp-tool | `task_show` | 0 | — | 0 | — | — | keep — no evidence | MCP tool events cover no 30-day window yet (the emitters shipped 2026-11-18); unmeasured is not zero-use. |
| mcp-tool | `task_list` | 0 | — | 0 | — | — | keep — no evidence | MCP tool events cover no 30-day window yet (the emitters shipped 2026-11-18); unmeasured is not zero-use. |
| mcp-tool | `workflow_status` | 0 | — | 0 | — | — | keep — no evidence | MCP tool events cover no 30-day window yet (the emitters shipped 2026-11-18); unmeasured is not zero-use. |
| mcp-tool | `workflow_run` | 0 | — | 0 | — | — | keep — no evidence | MCP tool events cover no 30-day window yet (the emitters shipped 2026-11-18); unmeasured is not zero-use. |
| mcp-tool | `workflow_continue` | 0 | — | 0 | — | — | keep — no evidence | MCP tool events cover no 30-day window yet (the emitters shipped 2026-11-18); unmeasured is not zero-use. |

## Risk: delete candidates that were used before the window

- 18 of 42 delete candidates have calls before the window. Deleting them removes a capability that was used, not dead weight — read this list before approving anything.

  - `sp:dev-wrapall` — 21 lifetime calls, last 2026-10-08
  - `sp:dev-next` — 5 lifetime calls, last 2026-09-14
  - `sp:rule-refine` — 1 lifetime calls, last 2026-09-03
  - `sp:dev-find-next` — 2 lifetime calls, last 2026-08-10
  - `sp:rule-add` — 9 lifetime calls, last 2026-10-14
  - `sp:dev-refactor` — 1 lifetime calls, last —
  - `sp:dev-pr-review` — 2 lifetime calls, last 2026-10-04
  - `sp:dev-gtd` — 2 lifetime calls, last 2026-08-16
  - `sp:dev-brainstorm` — 3 lifetime calls, last 2026-09-03
  - `sp:wayfinder` — 7 lifetime calls, last 2026-10-09
  - `sp:spur-composer` — 1 lifetime calls, last 2026-10-04
  - `sp:code-review` — 2 lifetime calls, last 2026-09-13
  - `sp:indexed-context` — 4 lifetime calls, last 2026-09-24
  - `sp:spur-check` — 2 lifetime calls, last 2026-10-16
  - `sp:pr-reviewing` — 2 lifetime calls, last 2026-10-04
  - `sp:code-refactoring` — 1 lifetime calls, last —
  - `sp:taste-refactoring-architect` — 1 lifetime calls, last —
  - `sp:issue-finding` — 5 lifetime calls, last 2026-08-21

## Method

- Calls are counted per `(skill_name, source)` from `history_skill_call` over the window, so one heavy source (pi) cannot hide usage elsewhere.
- `failureRate` is read from `protocolUsage.tools[]`; it stays `—` where that surface has no events.
- `delete` requires zero calls across every source in a window of at least 30 days. A shorter or absent window yields `keep — no evidence`.
- `merge:<target>` requires a named target with an overlapping purpose and a rationale citing the overlap. No row met that bar, so the recommendation set is empty rather than invented.
- Unmeasured kinds stay: subagents (no `subagent_type` rows) and MCP tools without events are `keep — no evidence`.

## Per-kind counts

| Kind | Items | Delete | Keep | No evidence |
| --- | ---: | ---: | ---: | ---: |
| command | 43 | 22 | 21 | 0 |
| skill | 42 | 20 | 22 | 0 |
| subagent | 4 | 0 | 0 | 4 |
| mcp-tool | 5 | 0 | 0 | 5 |

