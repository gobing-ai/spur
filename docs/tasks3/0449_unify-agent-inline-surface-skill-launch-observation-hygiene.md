---
template: feature-impl
schema_version: 1
name: "Unify --agent inline surface + skill launch/observation hygiene"
description: ""
status: todo
type: task
profile: standard
feature_id: H83
parent_wbs: null
priority: P1
tags: ["inline", "docs", "skills", "h83"]
dependencies: []
created_at: "2026-08-05T19:09:03.870Z"
updated_at: "2026-08-05T19:24:45.985Z"
---

## 0449. Unify --agent inline surface + skill launch/observation hygiene

### Background
Dual legacy confuses operators and coding agents: cross-cutting says omit ≡ `inline` (host session), while `AgentService.resolveAgent` **rejects** literal `inline` with exit 2 (ADR-046 era), and workflow-driven command hints advertise only `<auto|name>`. Separately, dogfood full-mode launches used `--vars '{"wbs":"…"}'` without `profile: auto` despite `--auto`, and observed via `trace --follow | tail` (buffers + hijack surface).

**Authority:** ADR-047 (supersedes ADR-046; amends ADR-041 reject-inline). **Independent of 0447/0448** for most of the work, but docs must not contradict affinity/streaming behavior those tasks ship.
### Requirements
R1. **`spur agent run --agent inline`:** resolve like omit → `agent.default` executor (subprocess). **Remove** exit-2 reject of literal `inline`. Unknown executor names still fail clearly.

R2. **Workflow vars:** if a caller passes `agent: "inline"`, treat as default-injection path (same as omit) — stages never fail solely because agent string is `inline`. Prefer normalizing to the configured default name before dispatch.

R3. **Interactive slash / skill contract (prompt-side):** omit/`inline` still means stay in the **host** coding-agent session; do not tell wrappers to call `spur agent run` for pure inline. Document that headless vs host is derived (ADR-041 who/where + ADR-047 table).

R4. **Single docs table** — update to remove "inline unrepresentable" / ADR-046 branch-b claims:
   - `plugins/sp/skills/spur-dev/references/cross-cutting.md`
   - `plugins/sp/skills/spur-dev/references/flag-glossary.md`
   - `plugins/sp/skills/spur-dev/references/execution-workflow.md`
   - `plugins/sp/skills/spur-dev/references/dev-operations.md` (as needed)
   - `plugins/sp/commands/dev-run.md`, `dev-plan.md`, `dev-runall.md` (and any WORKFLOW_DRIVEN_AGENT_COMMANDS tests)
   - `docs/help/cmd_agent.md` if present
   Point at **ADR-047** / H83.

R5. **Tests green:** `plugins/sp/tests/inline-execution-contract.test.ts`, `flag-contract-parity.test.ts`, `command-flag-parity.test.ts`, `packages/app/tests/services/agent-service.test.ts` (inline reject test becomes resolve-to-default). Update `validate-flag-contracts.ts` if it encodes ADR-046.

R6. **Launch hygiene (skills/docs):** full-mode `/sp:dev-run … --auto` must document vars including `"profile":"auto"` and `"wbs"`; when `--agent <name|auto>` set, merge `"agent":"…"`. Observation: `spur workflow trace <runId> --follow` and `--follow --output` — **never** `| tail` / sleep-poll loops.

R7. **No Phase D.** No affinity reimplementation (0448). No ts-libs shim work (0447).
### Acceptance Criteria
```gherkin
@core
Scenario: R6 — Unified --agent inline
  Given --agent inline on spur agent run
  When resolution runs
  Then agent.default is selected and a subprocess starts
  And exit code is not 2 solely because the value was inline
  And plugin docs no longer claim inline is unrepresentable on workflow-driven commands

@core
Scenario: R7 — Docs and tests agree
  Given cross-cutting.md, flag-glossary, dev-run/plan/runall, and plugin contract tests
  When the surface is inspected
  Then there is one value table consistent with ADR-047
  And full-mode --auto launch guidance includes profile auto in vars
  And observation guidance prefers workflow trace --follow --output without tail
```
### Q&A
**Q: Does inline mean host inside workflow YAML?** A: **No.** Headless stages always subprocess; inline ≡ agent.default there (ADR-047).

**Q: Order vs 0448?** A: Independent; can land in parallel. Docs mentioning affinity should say "default on (H83/0448)" without implementing it.
### Design
**WHAT — one operator mental model for --agent; skill/docs match runtime.**

**Value table (must appear in cross-cutting / flag-glossary)**

| Value | Interactive slash | spur agent run / workflow agent.run |
|-------|-------------------|-------------------------------------|
| omit / `inline` | Host session | Subprocess of `agent.default` |
| `auto` | Tier subprocess (or host if already that executor and no trigger) | Tier-resolved subprocess |
| `<name>` | Host if current agent is name; else subprocess | Subprocess of name |

**Runtime change (minimal)**
- `packages/app/src/services/agent-service.ts` `resolveAgent`: `raw === 'inline'` → resolve default executor (same path as missing agent / config default), **not** exit 2.
- Ensure workflow path that injects `vars.agent` does not pass through a code path that still errors on `inline` (normalize early if needed).

**Docs/tests**
- Delete WORKFLOW_DRIVEN "inline unrepresentable" special case **or** redefine it: workflow-driven commands **accept** `inline` as synonym for default, not as host stages.
- `dev-plan` / `dev-runall` argument-hint may use `<inline|auto|name>` again with prose "inline ≡ default executor for stages".
- Contract tests must assert the new table, not ADR-046.

**Launch examples (execution-workflow)**
```bash
VARS=$(jq -nc --arg wbs "$WBS" --arg profile auto '{wbs:$wbs, profile:$profile}')
# optional: --arg agent "$AGENT" '+ agent'
spur workflow run .spur/workflows/task-pipeline.yaml --vars "$VARS" --async --json
spur workflow trace "$RUN" --follow --output
```

**Anti-patterns**
- Leaving half the docs on ADR-046
- Documenting `| tail -60` as observation
- Implementing session affinity here
### Plan
- [ ] Change resolveAgent(inline) → agent.default; fix agent-service tests
- [ ] Sweep plugin commands/skills/help for ADR-046 unrepresentable language → ADR-047 table
- [ ] Fix plugin contract tests + validate-flag-contracts
- [ ] execution-workflow + dev-run: vars profile/agent + trace --follow --output
- [ ] bun test targeted plugin + app tests green
- [ ] Solution change-map
### Solution

<!-- Filled during implementation: file:line change map and concise rationale. -->

### Testing

<!-- Filled during verification: commands run, outcomes, coverage claim or N/A. -->

### Review

<!-- Filled during review: P1-P4 findings, residual risk, and final disposition. -->

### References
- Feature: H83 · ADR-047 · ADR-041 amendment 2026-08-05
- Related: 0448 (affinity runtime), 0447 (no direct dep)
- Key paths: `agent-service.ts` resolveAgent; `plugins/sp/tests/inline-execution-contract.test.ts`
### History
