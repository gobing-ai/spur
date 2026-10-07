# Native todo adoption audit (task 1101, map I13)

Date: 2026-10-06 (run timestamps UTC). Research artifact for wayfinder map I13 — Two-layer plan and progress visibility for dev
workflows. Evidence: local history DB (`.spur/spur.db`, `history_skill_call` + `history_tool_call.args_raw`),
official host docs, `packages/domain/src/analytics/derived.ts`, plugin sources.

## Verdict

The 0814 contract is followed only at its first step. Across 24 recent inline dev runs, the native list
appears late (median ~40 tool calls in, never at start), carries the setup rows A–D, and in 15 of 16
cases never shows the workflow plan. Where the plan does appear, it is the raw 15-state FSM whose letters
collide with the setup rows, and a third of the items never resolve. Nothing produces the list for the
agent: every run hand-writes it, with a different label format each time. The tool is not blocked in
commands; it is unavailable to Claude Code subagents.

## R1 — Host capability matrix

| Host | Native tool | Item shape (observed / documented) | Statuses | Hierarchy | Evidence |
| --- | --- | --- | --- | --- | --- |
| Claude Code | `TaskCreate` / `TaskUpdate` (legacy `TodoWrite`) | one item per call: `{subject, description, activeForm}`; update by `id` with `status`, `blockedBy` | pending / in_progress / completed | flat; `blockedBy` edges | history: 60 TaskCreate, 100 TaskUpdate, 1 TodoWrite |
| Codex | `update_plan` | full list per call: `{plan:[{step,status}], explanation?}` | pending / in_progress / completed | flat | history: 320 calls; superskill `docs/about_main_agent.md:169` |
| Gemini CLI | `write_todos` | full list: `{todos:[{description,status}]}` | pending / in_progress / completed / cancelled / blocked | flat | geminicli.com/docs/tools/todos; history: 0 calls |
| pi | `todo` (current) / `manage_todo_list` (older) | `todo`: one item per call, `{action:create|update, subject, description, activeForm, id, status, blockedBy}`; `manage_todo_list`: `{operation:"write", todoList:[{id,title,status}]}` | pending / in_progress / completed | flat; `blockedBy` | history: 10,104 `todo`, 1,043 `manage_todo_list` |
| omp | `todo` (ops) / `todo_write` | `{ops:[{op:init|append|start|done, list:[{phase,items}] , task}]}` | via ops | **phase → items (native two-level)** | history: 3,833 / 21; `derived.ts:183` |
| OpenCode | `todowrite` / `todoread` | full list: `{todos:[{id,content,status,priority}]}` | pending / in_progress / completed / cancelled | flat | history: 379; superskill `about_main_agent.md:299` |
| Grok | `todo_write` (observed); doc lists `update_plan` → `plan.md` | full list: `{todos:[{id,content,status}]}` | incl. cancelled | flat | history: 1,392 `todo_write`; superskill `about_main_agent.md:450` |
| Antigravity (agy) | `manage_task` | args not captured by importer | unknown | unknown | history: 6,022 calls, `args_raw` null; no todo tool in superskill `about_main_agent.md:336-349` — shape **unverified** |
| OpenClaw | none documented | — | — | — | superskill `about_main_agent.md:374-382` lists no todo tool; 0 history calls — **unverified** |
| Hermes | none documented | — | — | — | superskill `about_main_agent.md:404-416` lists no todo tool; 0 history calls — **unverified** |

Gating:

- **Command `allowed-tools` does not restrict.** Claude Code: "It does not restrict which tools are available:
  every tool remains callable" (code.claude.com/docs/en/slash-commands). So the missing todo entries in the
  `/sp:dev-*` frontmatter are not why the list fails. This corrects the charting note on map I13.
- **Subagents do not get the task tools.** Claude Code subagent `tools:` is an allowlist, and only agent-team
  teammates "additionally keep the task tools … `TaskCreate`, `TaskGet`, `TaskList`, `TaskUpdate`"
  (code.claude.com/docs/en/sub-agents). `sp:super-planner` and any worker subagent therefore cannot update
  the operator-visible list; only the parent host can.
- Superskill adapters do not translate todo tool names; each host's own tool is used as-is.

Consequences for the label model: most hosts are flat, so the two layers must be in the item text
(`B`, `B1`, …), not in tool nesting. Only omp has a native phase level. Two update styles exist: per-item
create/update (Claude Code, pi `todo`) and full-list rewrite (Codex, Gemini, OpenCode, Grok). Status
vocabularies differ: `skipped` exists nowhere, and `cancelled`/`blocked` exist only on some hosts.

## R2 — Observed behavior, 24 inline runs (2026-10-03 … 10-07)

Query: sessions whose `history_skill_call` invoked `sp:dev-run` / `sp:dev-runall` since 2026-09-01. In
practice every hit is a pi run from 10-03 to 10-07; the Claude/grok sample was 2 sessions. Reproduce with
the SQL in § Reproduction.

| Measure | Result |
| --- | --- |
| Runs with any todo call | 16 / 24 (8 never published; 5 of those are short sessions, 31–135 tool calls) |
| Tool calls before the first list item | 14–379, median ~40 — never at invocation start |
| Runs that published the setup rows (`A Quick readiness` …) | 14 / 16 |
| Runs that published the workflow plan | **1 / 16** (2026-10-05 17:45, task 1089) |
| Runs with two-layer labels (`A1`, `B2`) | 0 / 16 |
| Label separators used | `A. ` · `A, ` · `A — ` · `A · ` · `wf: A. ` — different per run |

Three representative traces (pi `todo` payloads, offsets = tool calls after invocation):

1. **dev-run 1089, 2026-10-05 17:45 — the only full plan.** At +45, setup rows `A. Quick readiness … D.
   Comprehensive checking`. At +149/+158, 15 workflow rows `wf: A. precheck … wf: O. cancelled`, including
   `escalate`, `test-fix`, `test-recheck`, `test-fail-triage`, `approve`, `failed`, `cancelled`. Two `A`
   items were live at once. At +203, setup row `D. Comprehensive checking` was marked completed as
   implement began, although the comprehensive gates had not run. The run ended with 7 of 21 items
   permanently pending (the unentered branch and terminal states).
2. **dev-runall E92, 2026-10-06 16:57 — batch without a task layer.** Setup rows A–D at +14. Row `D` was
   relabeled "drive task pipelines". Tasks were added late and ad hoc: `Run 0200 …` at +282, then one item
   `Run 0201–0204 … + 0205 fix + wrap/merge` covering five tasks. No per-task stage progress was shown.
   After +1182 the list collected unrelated follow-up work in the same session.
3. **dev-runall 2026-10-06 18:33.** The first item appeared at +379 and was a fix-up chore, not a plan.

## R3 — Root-cause classes

| # | Class | Seen in | Evidence |
| --- | --- | --- | --- |
| C1 | **No generator; the agent hand-writes the list.** The contract is prose: `cross-cutting.md:251-253`, `inline-pipeline-driver.md:131-187`. Labels and wording drift every run. | 16/16 | separator table above |
| C2 | **Late publication.** Publish is step 5, after run-id allocation, the setup script, session resolution and readiness; agents do that work first. | 16/16 | median ~40 calls |
| C3 | **The workflow plan step is skipped.** Step 8 (`workflow show --format todo`) yields a JSON inventory the agent must transcribe again. It is almost never done, so the setup rows are the whole plan. | 15/16 | 1/16 published |
| C4 | **Raw FSM shown as plan; labels collide.** The inventory includes branch/terminal states; setup and workflow both start at `A`. | 1/1 runs that published | trace 1 |
| C5 | **Batch has no layout.** `execution-batch.md` defines a durable ledger, not a visible list; tasks are coalesced or added late. | all runall runs | trace 2 |
| C6 | **Truthfulness breaks under bulk updates.** Setup rows are completed together; unentered states stay pending forever; there is no `skipped` status to use. | trace 1 | +203, final state |
| C7 | **Subagents cannot update the parent list.** Claude Code subagents lack the task tools; worker progress must come back through the parent. | design constraint | sub-agents doc |
| — | "Tool not permitted by command frontmatter" | refuted | slash-commands doc |

## R4 — Impact table

| Path | Current | Required change |
| --- | --- | --- |
| `plugins/sp/skills/spur-dev/references/cross-cutting.md:244-270` | setup rows A–D, separate from the workflow inventory | One plan: `A Prepare` (A1–A3) plus workflow phases, published as the **first** action (C2, C4) |
| `plugins/sp/skills/spur-dev/references/inline-pipeline-driver.md:131-187` | publish at step 5, inventory at step 8, labels A..Z/AA | Publish the generated plan verbatim at invocation; insert-on-entry for branch states; per-host status mapping (C1, C3, C6) |
| `plugins/sp/skills/spur-dev/references/execution-batch.md` | ledger only | Batch plan: `A` prepare, letter per task, `Z` report, waves > 24 (C5) |
| `packages/app/src/workflow/step-reporter.ts:255-278` | `columnLabel` → AA…, no child cap | A–Z / 1–9 cap; phase grouping; emit ready-to-publish items (C1, C4) |
| `apps/cli` `workflow show --format todo` | flat declared-state inventory | Emit the labeled two-layer plan the agent copies 1:1 (**public surface — needs consent**) (C1, C3) |
| `config/workflows/task-pipeline.yaml`, `idea-pipeline.yaml` | no phase metadata | Per-state display phase; mark branch/terminal states hidden until entered (C4) |
| `plugins/sp/commands/dev-{run,runall,parallel,idea,plan,refineall,verifyall}.md` | no plan instruction at the top | First instruction: publish the generated plan; optional pre-approval of the host todo tool (convenience, not a fix) |
| `plugins/sp/agents/super-planner.md` | owns the batch loop as a subagent | State that the parent host owns the visible list; the subagent reports per-task progress back (C7) |
| `packages/domain/src/analytics/derived.ts:179-197` | pi parsed as `{todoList}`; Claude `TaskCreate` not parsed | Side finding: pi `todo` `{action,subject}` and Claude `TaskCreate/TaskUpdate` shapes are missed by phase analytics; outside I13's destination, but it limits measuring the fix |

## Reproduction

```sql
-- runs + todo timing (pi), against .spur/spur.db read-only
with runs as (select session_id, min(seq) sseq, min(started_at) st, skill_name from history_skill_call
  where skill_name in ('sp:dev-run','sp:dev-runall') and started_at >= '2026-10-03' group by session_id)
select r.st, r.skill_name,
  (select min(t.seq)-r.sseq from history_tool_call t where t.session_id=r.session_id and t.seq>=r.sseq and t.tool_name='todo') first_todo_after,
  (select count(*) from history_tool_call t where t.session_id=r.session_id and t.seq>=r.sseq and t.tool_name='todo') n_todo
from runs r order by r.st;
```

Payload traces: same join, `select t.seq-r.sseq, t.args_raw … and t.tool_name='todo' order by t.seq`.

## Limits

- The run sample is almost entirely pi. Claude Code dev runs barely appear in `history_skill_call`; whether
  slash commands are imported as skill calls is unverified.
- Antigravity, OpenClaw and Hermes tool shapes are unverified (no captured args).
- "Never at start" is measured in tool-call offsets, not wall-clock.
