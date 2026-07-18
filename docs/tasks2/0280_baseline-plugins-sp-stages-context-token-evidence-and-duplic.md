---
template: brainstorm
schema_version: 1
name: "Baseline plugins/sp stages, context, token evidence, and duplication"
description: ""
status: todo
type: brainstorm
profile: standard
feature_id: O
parent_wbs: null
priority: P1
tags: ["wayfinder:research", "workstream:baseline", "sp-plugin"]
dependencies: []
created_at: "2026-07-18T17:29:34.845Z"
updated_at: "2026-07-18T18:28:02.188Z"
---

## 0280. Baseline plugins/sp stages, context, token evidence, and duplication

### Background

Type: wayfinder:research. Establish the evidence baseline before proposing optimization. Inventory the 28 command definitions, 25 skills, 3 agents, nine workflows, context hooks, behavioral evals, history analytics, and representative dogfood reports. Measure prompt/reference sizes, repeated contracts, subprocess boundaries, re-reads, gate outcomes, retries, and whatever provider usage is actually observable. Reconcile feature N and cancelled task 0139 so finished work is preserved and unverifiable cache claims are not repeated. The deliverable is a reproducible baseline dataset plus an evidence-backed hotspot/risk report; no redesign or implementation belongs in this ticket.

### Requirements
R1. Produce a machine-readable inventory of every command, skill, agent, workflow state, agent.run call, gate, and ownership edge in plugins/sp and .spur/workflows.
R2. Quantify source/prompt footprint and duplicated instruction clusters with a reproducible script or documented command sequence; distinguish lines/chars/estimated tokens from provider-metered tokens.
R3. Trace current context acquisition and invalidation across inline commands, workflow subprocesses, indexed-context hooks, and dogfood drivers.
R4. Build a baseline evidence table for fresh input, total input/output, cache-read/create when present, retries, escalation-equivalent repair loops, duration, and PASS/PARTIAL/FAIL; mark unavailable dimensions explicitly.
R5. Identify at least the top ten token/complexity hotspots with file anchors, cause class, blast radius, and confidence.
R6. Preserve-list existing contracts that must not regress, including dev-next one-dispatch, dogfood @1.2, CLI-only writes, and PASS-only completion.
R7. Deliver artifacts consumable by the stage-registry, context-envelope, model-routing, workflow, campaign, and synthesis tickets.
### Acceptance Criteria
Scenario: R1 Current plugin baseline is decision-ready
  Given the current plugins/sp corpus, .spur/workflows, feature N, task 0139, and available execution evidence
  When the baseline inventory and measurements are completed
  Then every command, skill, agent, workflow state, subprocess edge, gate, and context source is represented in a machine-readable inventory
  And prompt footprint, duplicated contracts, context re-reads, retries, verdicts, and observable usage dimensions are reported with reproducible collection steps
  And estimated-token evidence is never labeled as provider-metered cache evidence
  And the ten highest-confidence optimization hotspots include file anchors, cause, blast radius, confidence, and downstream ticket consumers

Scenario: Baseline remains usable when provider telemetry is absent
  Given a run or platform does not expose cache-read, cache-create, or stage-level usage
  When the baseline is recorded
  Then the missing dimension is explicit rather than inferred
  And the portable leading indicators remain comparable across Claude Code and Codex
  And the dataset preserves the raw observation needed for later reinterpretation
### Q&A
- Locked: this ticket measures the current system; it does not select or implement the target architecture.
- Locked: price is excluded from the primary metric because prices and model portfolios change independently of plugin quality.
- Locked: the primary efficiency metric is fresh/uncached input tokens per verified PASS; total input plus output tokens per PASS is a non-regression guard.
- Locked: provider-reported cache fields are authoritative where available; source-size and heuristic token estimates are portable diagnostics only.
- Question to resolve: which current logs can correlate a command/workflow stage, model, usage record, retry, and final verification verdict without manual joins?
- Question to resolve: which repeated text is intentionally stable cache prefix versus accidental duplication or wrapper-owned domain logic?
- Question to resolve: what historical samples are sufficiently complete to seed later qualification without survivorship bias?
### Design
Selected method: build one normalized evidence workbook/dataset with four linked views: surface inventory, execution graph, prompt/context footprint, and run telemetry. Every numeric field carries an evidence class (`provider`, `derived`, `estimated`, or `unavailable`) and collection provenance.

The execution graph should use canonical candidate stage names only as annotations; it must also retain the actual current command/workflow node names so later synthesis can compare present and target states. Duplicate-instruction analysis should separate exact, normalized, and semantic clusters and include manual confirmation for the highest-impact clusters.

Rejected shortcuts: counting repository tokens as cache savings; treating Claude history fields as Codex semantics; using one happy-path dogfood run as a baseline; or collapsing PASS, PARTIAL, and FAIL into an average token number.
### Plan
1. Freeze corpus revision, platform/tool versions, config profile, and collection commands.
2. Enumerate surfaces and parse ownership/call/reference edges into a stable machine-readable schema.
3. Sample representative planning, execution, verification, wrap, next-router, and dogfood paths; record raw observations before aggregation.
4. Measure footprints and repetition, then classify each hotspot by stable prefix, dynamic suffix, redundant wrapper logic, subprocess reset, or unbounded/retry behavior.
5. Join usage and outcome evidence where possible; preserve explicit nulls and confidence where not possible.
6. Publish preserve-list, hotspot ranking, reproducibility instructions, and handoff data contracts.
7. Feed findings to tickets “Verify Claude and Codex prompt-cache and usage telemetry semantics”, “Specify the canonical stage-contract registry”, and all later design tickets.
### Solution
Execution status: reopened. Prior charting/specification artifacts exist, but implementation/resolution work has not been completed. The task contract is in the corresponding WBS file under `docs/tasks2/:1`; Feature O is defined in `docs/features/O_sp-plugin-token-efficient-reliable-execution-architecture.md:1`; the reusable driver is `config/workflows/wayfinder-resolution.yaml:1`. Continue execution through the workflow before claiming completion. No plugin implementation has been changed yet.
### Testing
Not complete — only structural checks have run. `spur task check` and `spur workflow validate config/workflows/wayfinder-resolution.yaml` pass for the current artifacts, but no implementation/resolution evidence has been produced yet. Re-run substantive verification after execution.
### Review
| Priority | Finding | Disposition |
|---|---|---|
| P1 | No unresolved implementation blocker in this specification artifact. | Implementation is deferred to the synthesized build backlog. |
| P2 | Provider/platform evidence may remain unavailable for some telemetry fields. | Preserve explicit unavailable/estimated labels and re-qualify during implementation. |
| P3 | CLI dependency mutation remains a known follow-up surface. | Track through WBS 0290 and the implementation backlog. |
| P4 | Documentation and compatibility details may evolve during build. | Recheck authoritative docs during implementation review. |

Review outcome: OPEN — the prior status transition was reversed because implementation/resolution evidence is still missing. Re-review after the task's workflow execution completes.
### References
- `plugins/sp/commands/`, `plugins/sp/skills/`, `plugins/sp/agents/`
- `.spur/workflows/`
- `plugins/sp/evals/` and current plugin tests
- `.spur/context/` token ledger and indexed-context artifacts when present
- Feature N and tasks 0270–0279: preserve completed dev-next and dogfood v1.2 work
- Task 0139: preserve the documented boundary between estimates and cache proof
- Feature O: scenarios R1, R3–R10, and R12 consume this baseline
### History
- 2026-07-18T18:11:41.254Z todo → wip (system)
- 2026-07-18T18:24:06.998Z wip → done (system)
- 2026-07-18T18:27:39.986Z done → todo (system)
