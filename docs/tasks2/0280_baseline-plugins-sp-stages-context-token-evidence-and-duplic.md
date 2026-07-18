---
template: brainstorm
schema_version: 1
name: "Baseline plugins/sp stages, context, token evidence, and duplication"
description: ""
status: done
type: brainstorm
profile: standard
feature_id: O
parent_wbs: null
priority: P1
tags: ["wayfinder:research", "workstream:baseline", "sp-plugin"]
dependencies: []
created_at: "2026-07-18T17:29:34.845Z"
updated_at: "2026-07-18T19:11:20.710Z"
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
Resolution completed as a specification deliverable. The concrete WBS-specific artifact is recorded in `.spur/run/wayfinder-O/implementation-evidence.md:5` (with the matching numbered section for each WBS), backed by the task contract in `docs/tasks2/:1`, Feature O in `docs/features/O_sp-plugin-token-efficient-reliable-execution-architecture.md:1`, and the reusable driver in `config/workflows/wayfinder-resolution.yaml:1`. No plugin runtime implementation is required for these research/specification tickets; the artifact is the implementation-ready handoff.
### Testing
Coverage: N/A (research/specification deliverable; the shipped runtime surface is the reproducible collector `.spur/run/wayfinder-O/baseline/collect.ts`, exercised by direct execution — command evidence below).

**Per-Requirement Traceability (re-verify 0280, `/sp:dev-verify 0280 --auto --next --force --focus all --fix all`, 2026-07-18)**

| Req | Status | Evidence Type | Evidence |
|-----|--------|---------------|----------|
| R1 machine-readable inventory | MET | command | `bun .spur/run/wayfinder-O/baseline/collect.ts` → `inventory.json` counts `{commands:28, skills:25, skillReferences:40, agents:3, workflows:10 (.spur/workflows is a symlink alias of config/workflows), states:78, agentRunCalls:20, guards:111, edges:90}` |
| R2 footprint + duplication (reproducible) | MET | command | `footprint.json` totals (commands ~41.4K / skills ~63.7K / references ~89.1K / agents ~8.2K / workflows ~19.6K / scripts ~13.6K est tok) + `duplication.json` (exact+normalized clusters ~551 est wasted tok; semantic clusters flagged for manual pass); `meta.json` separates `estimated` from `provider` classes |
| R3 context acquisition/invalidation trace | MET | static-ref | `.spur/run/wayfinder-O/baseline/context-trace.md` — 5 acquisition paths, 5 invalidation events, all with anchors |
| R4 baseline evidence table | MET | static-ref | `evidence-table.md` + `runs.json` — 40 verdict artifacts (38 PASS / 1 PARTIAL / 1 non-JSON `0231`), 6 dogfood runs, token-ledger event counts (365 entries); provider dimensions explicitly `unavailable`, never inferred |
| R5 top-10 hotspots | MET | command | `hotspots.md` — `grep -c '^| H'` = 10 rows, each with file anchor, cause class, blast radius, confidence |
| R6 preserve-list | MET | command | `preserve-list.md` P1–P8; grep confirms all four named contracts (dev-next one-dispatch, dogfood @1.2, CLI-only corpus writes, PASS-only completion) |
| R7 consumable artifacts | MET | static-ref | `README.md` data contract: file → schema → evidence class → consumer tickets (0281–0291) |

**Acceptance Criteria Verification**

| AC | Status | Evidence Type | Evidence |
|----|--------|---------------|----------|
| Scenario: R1 Current plugin baseline is decision-ready | MET | command | collector executed this run (exit 0, 3 runs incl. 2 in-run bug fixes); every surface class present in `inventory.json`; hotspot ranking carries anchors/cause/blast-radius/confidence + downstream consumers; `meta.json` note forbids estimate→provider promotion |
| Scenario: Baseline remains usable when provider telemetry is absent | MET | command | `evidence-table.md` availability matrix marks provider dims `unavailable` explicitly; portable indicators (verdicts, retries, source footprints) defined identically for Claude Code and Codex; `runs.json` preserves raw pre-aggregation observations |

**SECUA Review (`--focus all`)**

- Security: none — collector is local-read-only; no secrets, no network.
- Efficiency/Correctness (minor, fixed in-run): Bun.Glob does not follow the `.spur/workflows` directory symlink (collector now scans the real `config/workflows` and records the alias); `Result:` parser missed the bold `**Result:**` form.
- Correctness (major, repaired): `config/workflows/wayfinder-resolution.yaml` auto path recorded `done` verdict-blind (`verify → record` guarded only on `approval = auto`) and bypassed lifecycle guards with `--no-lifecycle` — the mechanism behind this task's earlier forced `testing → done` on a PARTIAL verdict. Hardened: verify leg writes `.spur/run/wayfinder/<wbs>-resolution-verdict.txt`; auto `verify → record` requires `grep -qx PASS` (fail-closed to the approve HITL gate); `record` runs lifecycle-enforced `task update done`; `record → done` asserts the status actually changed. `spur workflow validate` passes. FSM-level enforcement remains task 0292 (References updated there).
- Architecture: the normalization layer the previous verify flagged as missing now exists (`README.md` dataset contract). Prior-run aggregation drift noted: core UNMET was reported PARTIAL; `verdict-schema.md` says FAIL — recorded as a process observation.

**Verdict: PASS** — the pre-fix verdict this run was FAIL (R3–R6 UNMET + 1 major SECUA finding); the `--fix all` pass materialized the baseline dataset (`.spur/run/wayfinder-O/baseline/`, 11 files) and repaired the workflow gate; re-verification finds all R1–R7 and both AC scenarios MET with deterministic evidence.
### Review
| Priority | Finding | Disposition |
|---|---|---|
| P1 | No unresolved implementation blocker in this specification artifact. | Implementation is deferred to the synthesized build backlog. |
| P2 | Provider/platform evidence may remain unavailable for some telemetry fields. | Preserve explicit unavailable/estimated labels and re-qualify during implementation. |
| P3 | CLI dependency mutation remains a known follow-up surface. | Track through WBS 0290 and the implementation backlog. |
| P4 | Documentation and compatibility details may evolve during build. | Recheck authoritative docs during implementation review. |

Review outcome: PASS for specification readiness. The evidence artifact provides the implementation handoff; runtime implementation and coding review belong to the dependency-ordered tasks produced by WBS 0291.
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
- 2026-07-18T18:35:15.333Z todo → done (system)
- 2026-07-18T18:37:50.222Z done → todo (system)
- 2026-07-18T18:42:44.019Z todo → wip (system)
- 2026-07-18T18:42:48.631Z wip → testing (system)
- 2026-07-18T18:44:10.491Z testing → done (system)
