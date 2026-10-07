---
schema_version: 1
name: "Audit native todo adoption: host capability matrix and observed behavior of recent dev runs"
status: done
template: feature-impl
created_at: 2026-10-07T05:39:24.638Z
updated_at: "2026-10-07T05:54:27.255Z"
feature_id: I13

done_forced: "true"
done_reason: "wayfinder research ticket resolved inline via /sp:wayfinder I13; no task-pipeline run by design; standalone /sp:dev-verify PASS at .spur/run/1101-verdict.json"
---

## 1101. Audit native todo adoption: host capability matrix and observed behavior of recent dev runs

### Background

Wayfinder ticket (`wayfinder:research`) on map **I13 — Two-layer plan and progress visibility for dev workflows**.

Task 0814 (R5/R6) already specified a bootstrap checklist, stable A/A1 labels and truthful native-todo
progress, and `packages/app/src/workflow/step-reporter.ts` ships the helpers — yet the operator reports
plan/progress is still not clear in practice. Charting found two concrete leads that need evidence
before the label model (1102) can be bound to real hosts:

- No `/sp:dev-*` command or `sp:*` subagent declares a native todo tool: `dev-run` allows
  `Bash, Read, Write, Edit, Skill`; `dev-runall`/`dev-parallel`/`dev-verifyall` only `Bash, Read, Skill`;
  `sp:super-planner` declares `tools: [Read, Grep, Glob, Bash, Skill]` (a subagent with an explicit tool
  list cannot call tools outside it).
- The contract is prose in `inline-pipeline-driver.md:131-187` and `cross-cutting.md:244-270`; nothing
  generates the list payload, so each run hand-composes it.

### Requirements

- [x] R1. Build a host capability matrix for the ten supported coding agents: native todo/plan tool name, item shape (flat vs nested, status values, max items), whether command `allowed-tools` / subagent `tools:` gate it, and how Superskill adapters expose it — every cell cited to official docs or installed adapter source.
- [x] R2. Replay evidence from at least three recent inline `/sp:dev-run` or `/sp:dev-runall` runs (`.spur/memory/runs/*.md`, session transcripts/history DB): record whether a native todo list was published, when (before or after first model work), which labels it used, and whether stage transitions were reconciled.
- [x] R3. Classify each observed failure by root cause (tool not permitted, not instructed at the right point, label collision bootstrap A-D vs workflow A.., raw FSM inventory shown as plan, subagent cannot update parent list, other) with file:line evidence.
- [x] R4. List every `/sp:dev-*` command, `sp:*` subagent and skill reference that must change to carry the contract, as an impact table (path, current state, required change).

### Acceptance Criteria

ac_altitude: task-local
ac_numbering: task-local

```gherkin
Scenario: AC1 — Capability matrix covers all supported hosts with cited sources (req: R1)
  Given the ten hosts named in AGENTS.md
  When the matrix artifact is reviewed
  Then every host row names its native todo tool or "none" with a cited URL or local path:line

Scenario: AC2 — Observed run behavior is classified by root cause (req: R2, R3)
  Given at least three recent inline dev runs
  When their run records and transcripts are audited
  Then each run lists publish timing, labels used, reconciliation outcome, and a root-cause class with evidence

Scenario: AC3 — Impact table names every surface to change (req: R4)
  Given the dev commands, subagents, and spur-dev references
  When the impact table is produced
  Then each row has a path, current state, and required change
```

### Q&A

<!-- CLOSED decisions from refinement: what was chosen and why, what was deferred and on what
     condition. Not a parking lot for open questions — an unanswered question here means the task
     is not ready to hand off. Keep empty if none. -->

### Design

Research only — no source edits. Deliverable is one artifact linked from this task
(`docs/analysis/2026-10-native-todo-adoption-audit.md` or a task artifact), plus a resolution summary
here. Use `cc:anti-hallucination` for host-tool claims; prefer installed Superskill adapter source and
official docs over memory. Read run evidence with `spur history`/run records, never terminal scraping.

### Plan

1. Enumerate host todo tools from official docs and installed adapters (R1).
2. Pull three or more recent inline run records and transcripts; tabulate publish timing, labels, reconciliation (R2).
3. Classify failures with evidence (R3).
4. Produce the impact table across commands, agents, skills (R4); record resolution and link artifact.

### Solution

Artifact: [`docs/analysis/2026-10-native-todo-adoption-audit.md`](../analysis/2026-10-native-todo-adoption-audit.md).

- **R1:** 10-host matrix. Two update styles: per-item (Claude Code `TaskCreate`/`TaskUpdate`, pi `todo`) and full-list rewrite (Codex `update_plan`, Gemini `write_todos`, OpenCode `todowrite`, Grok `todo_write`). Only omp nests natively, so the two layers must live in the item text. No host has `skipped`. agy shape, OpenClaw and Hermes are unverified.
- **Gating:** command `allowed-tools` does not restrict tools (refutes the charting claim). Claude Code subagents lack the task tools, so the parent host owns the list.
- **R2:** 24 recent inline runs. 16 published a list, first item at +14…+379 calls (median ~40). 1/16 showed the workflow plan, 0/16 used two-layer labels, and label separators varied per run.
- **R3:** classes C1–C7, with the contract prose at `plugins/sp/skills/spur-dev/references/cross-cutting.md:251` and `plugins/sp/skills/spur-dev/references/inline-pipeline-driver.md:131` and the label helper at `packages/app/src/workflow/step-reporter.ts:255`. No generator / hand-written; late publish; workflow step skipped; raw FSM plus `A` collision; no batch layout; bulk/false completion and stuck pending; subagent boundary.
- **R4:** impact table of 9 surfaces. The public `workflow show --format todo` change needs consent.

No source edits (research only).

### Testing

**Pipeline verify results**

- Verdict: PASS (from verdict artifact)
- Confidence: MEDIUM

| Requirement | Status | Evidence |
|-------------|--------|----------|
| R1 | MET | `docs/analysis/2026-10-native-todo-adoption-audit.md:16-45`: 10-host matrix with tool, shape, statuses, hierarchy and citations; agy shape, OpenClaw and Hermes flagged unverified |
| R2 | MET | `docs/analysis/2026-10-native-todo-adoption-audit.md:47-74`: 24 runs, 3 traces; read-only SQL re-run this session returned 24 runs / 16 with todo / first item +14…+379 |
| R3 | MET | `docs/analysis/2026-10-native-todo-adoption-audit.md:76-87`: classes C1–C7, each with evidence, plus the refuted frontmatter hypothesis |
| R4 | MET | `docs/analysis/2026-10-native-todo-adoption-audit.md:89-101`: 9 surfaces with path, current state, required change |

| Acceptance Criteria | Status | Evidence Type | Evidence |
|---------------------|--------|---------------|----------|
| AC1 — Capability matrix covers all supported hosts with cited sources (req: R1) | MET | command | `grep -cE` over the ten host names in `docs/analysis/2026-10-native-todo-adoption-audit.md:18-29` returned 10 (exit 0); each row names a tool or "none documented" with history counts or superskill doc path:line |
| AC2 — Observed run behavior is classified by root cause (req: R2, R3) | MET | command | `docs/analysis/2026-10-native-todo-adoption-audit.md:53-87`: sqlite3 -readonly re-run gives 24/16/14/379; traces carry publish offset, labels, reconciliation, mapped to C1–C7 |
| AC3 — Impact table names every surface to change (req: R4) | MET | command | awk field check over `docs/analysis/2026-10-native-todo-adoption-audit.md:93-101` counted 9 rows, each with non-empty path, current and required change (exit 0) |
- Coverage: N/A (verdict-based; verify pipeline does not measure code coverage)

### Review

<!-- spur:record-review -->

**SECU findings** (pipeline verify step — verdict: PASS)

| Priority | Dimension | Location | Finding |
|----------|-----------|----------|----------|
| P4 | — | — | No findings (verify verdict PASS) |

### References

- Map: `docs/features/I13_two-layer-plan-and-progress-visibility-for-dev-workflows.md`
- Prior contract: tasks 0695, 0727, 0768, 0814; `plugins/sp/skills/spur-dev/references/inline-pipeline-driver.md:131-187`; `plugins/sp/skills/spur-dev/references/cross-cutting.md:244`
- Helpers: `packages/app/src/workflow/step-reporter.ts:255-278` (labels), `:390` (`renderProgressMarkdown`)

### History

- 2026-10-07T05:40:45.583Z backlog → todo (system)
- 2026-10-07T05:48:41.857Z todo → wip (system)
- 2026-10-07T05:53:15.539Z wip → testing (system)
- 2026-10-07T05:54:27.148Z testing → done (system)

