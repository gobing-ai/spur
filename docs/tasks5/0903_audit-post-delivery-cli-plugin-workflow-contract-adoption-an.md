---
schema_version: 1
name: Audit post-delivery CLI-plugin-workflow contract adoption and existing backlog ownership
status: todo
template: brainstorm
created_at: 2026-09-20T00:51:02.732Z
updated_at: "2026-09-20T05:58:01.521Z"
feature_id: I31

priority: P1
ac_altitude: task-local
ac_numbering: task-local
estimate_hours: "2"
---

## 0903. Audit post-delivery CLI-plugin-workflow contract adoption and existing backlog ownership

### Background

Type: `wayfinder:research`. This is the first independent investigation on map I31. It audits the post-delivery contract across the live `spur` CLI, plugin source, installed Superskill adapters, and workflow callers, then assigns confirmed drift and evidence gaps to existing owners. B6, B7, B8, and G66 are inputs; their completion is not re-verified here. This ticket produces an inventory and routing artifact, not a code fix.

**Refine corrections (2026-09-19)**
- An open feature status implied unfinished implementation → sync dry-run proposes 35 done transitions, including D62/E6/P-adjacent deliveries → distinguish bookkeeping from residual work using complete task rosters.
- P was treated as wholly unimplemented → task-pipeline already documents auto selection and guards mutationPolicy; resilience tests exist → inventory only remaining behavioral or evidence gaps.
- Source/installed drift inventory had no denominator or output contract → freeze the reachable surface set, precise evidence rows, and owned artifacts below.

### Requirements

- [ ] R1. Freeze an explicit surface inventory reachable from dev-run, dev-runall, dev-parallel, super-planner, super-coder, super-reviewer, spur agent, spur message, and every model-bearing workflow action. Include each directly referenced runtime contract and installed adapter target that can be located; list missing installed targets without inventing paths.
- [ ] R2. Compare CLI flags/output/selector semantics, quota ownership, role pins, reuse/fresh sessions, capability fallback, receipt identity, and mutation policy across the frozen surfaces; each mismatch cites current source and asserted guidance.
- [ ] R3. Capture feature sync --all --dry-run once; use its proposed statuses only in the report. Resolve archived linked tasks through task show before calling a feature empty or terminal. Cover I7, P, D62, E6, B1, B3, G1, G4, G65, and I4 without modifying them.
- [ ] R4. Map four journeys—inspect/select executor, dispatch one task, send/wait for a request, and recover an interrupted member—to existing commands, identity keys, receipts, and failure outcomes. Propose simplification only for demonstrated redundant steps.
- [ ] R5. Assign each confirmed finding an existing owner or explicit unowned disposition; separate shipped behavior, stale prose, absent adoption, unverified behavior, and already-owned work. No new feature/task allocation in this investigation.
- [ ] R6. Deliver 0903-contract-adoption.md and 0903-contract-adoption.json with the schema and coverage accounting below; enumerate concrete scenarios for dependent task 0905.
- [ ] R7. Validate row IDs, source anchors, inventory coverage, dispositions, and scenario references with a repeatable local check; report all unknowns and execution constraints.

### Acceptance Criteria

- [ ] AC1 — Every frozen surface has an observed result or a named unavailable reason; installed-target coverage is explicit. (req: R1)
- [ ] AC2 — Session, quota, selector, capability, receipt, and mutation-policy comparisons carry source-versus-guidance evidence. (req: R2)
- [ ] AC3 — Status/ownership conclusions use one sync capture and complete roster lookup, with zero status mutations. (req: R3)
- [ ] AC4 — All four journeys have steps, identity/receipt semantics, error paths, and evidence-backed simplification dispositions. (req: R4)
- [ ] AC5 — Each finding has exactly one disposition and owner or unowned marker; existing deliveries are not proposed anew. (req: R5)
- [ ] AC6 — Both named artifacts parse/read and scenario IDs provide a deterministic handoff to 0905. (req: R6)
- [ ] AC7 — The report includes the checker command/result, provenance, unknowns, and no unsupported completion claims. (req: R7)

### Q&A

Closed for this investigation: local evidence first; no new public API; no production mutations; no live provider refresh or new benchmark runs; missing evidence is explicit; bounded 90-minute session and 60-second process deadlines. Operator decisions on future CLI compatibility, refresh cadence, and unattended execution budgets remain owned by Robin on map I31 and do not block these evidence-only deliverables. They are not delegated to the investigator to invent.

Preparation is ready-to-investigate, not proof the product behavior passes. Follow the wayfinder research route, one ticket per session. Any later source fix gets its own planned implementation task.

### Design

Type: wayfinder:research. Execute one ticket per session through the sp-wayfinder work-through-map procedure and its wayfinder-resolution research route. Do not use task-pipeline, dev-run, dev-runall, or eval-pipeline to resolve this ticket. Claim the selected ticket before investigation; verification and completion use the existing wayfinder verdict/record route. Preparation here is not execution or verification of its findings.

mutationPolicy: none

Production source, plugin/workflow definitions, installed adapters, real configuration, credentials, and real databases are read-only. Allowed deliverables are this task's CLI-owned evidence sections and the named report/JSON artifacts under docs/reports/i31/. Use an OS temporary directory for executable reproduction snippets and disposable fixture files; include the exact snippet and command in the report so it remains reproducible. No new public API, CLI verb, service, schema, dependency, scheduler, or production fix. No network probes or paid agent invocations inside the investigation; the surrounding delegated research/review session is the only model execution.

At start record git HEAD, git status, git worktree list, source-local CLI provenance, and task list --status wip --json. Use the current checkout; do not reset other work. If competing work changes a sampled source, refresh that row's evidence and record both revisions. Parallel delegates require separate worktrees; task 0905 starts only after 0903 is done and its artifact is available.

Bound one investigation to 90 minutes. Give any child shell/process a 60-second deadline, permit at most one retry for a read-only transient failure, and checkpoint partial artifacts at the budget boundary. A timeout or absent evidence is unknown, never success and never permission to rerun a pipeline. Do not mark the ticket done with unmet required deliverables. Report-only negative findings can be a valid investigation result when all specified observations and missing-data dispositions are recorded.

Choose a bounded comparison matrix over a wholesale plugin rewrite: it exposes adoption gaps with no runtime blast radius. Reuse plugins/sp/scripts/surface-drift-inventory.ts, validate-flag-contracts.ts, and the CLI parity tests as evidence sources; inspect their entrypoints before invoking because scripts with workflow/spawn/write side effects are excluded from the default read-only route.

Start at plugins/sp/commands/dev-{run,runall,parallel}.md, plugins/sp/agents/super-{planner,coder,reviewer}.md, plugins/sp/skills/spur-dev/references/{cross-cutting,execution-workflow,execution-batch,inline-pipeline-driver}.md, plugins/sp/skills/spur-cli/references/{agent,message}.md, config/workflows/, apps/cli/src/commands/agent.ts, packages/app/src/workflow/actions/agent-run.ts, and docs/design/session-pinned-dispatch.md. Follow direct references/callers needed to prove each comparison, not a full repository reread. Inspect installed skill/adapter metadata through existing Superskill read-only surfaces; never install/sync as part of the audit.

Verified seeds: wayfinder/SKILL.md:123 still uses --section tags; execution-workflow.md:278 still describes doctor auth checks; task-pipeline.yaml:199 resolves role pins and :233/:376/:442/:505 declares reuse/fresh policy; :355 guards mutationPolicy and plugins/sp/tests/task-pipeline-resilience.test.ts covers it. Resolve actual line numbers at execution. These seeds are not an exhaustive defect list.

Use source-local `bun run apps/cli/src/index.ts feature sync --all --dry-run --json` once, `feature show <id> --json`, and `task list --feature <id> --json`. If no frontier is visible, search only feature_id metadata in configured task folders, extract WBS, then use task show; do not derive WBS from sync prose. Current readiness audit found I7/P/E7 with zero linked tasks across folders; the execution snapshot can differ.

JSON contract: {schemaVersion:1, task:"0903", sourceCommit, capturedAt, surfaces:[{id,path,kind,status,reason}], findings:[{id,category,assertion,observed,evidence:[{path,line}],owner,disposition}], journeys:[{id,steps,identityKeys,receipt,failures,suggestion}], scenarios:[{id,mode,question,evidenceSources,findingIds}], unknowns:[]}. Modes are inline|pipeline|fleet; every row references existing inventory/finding IDs. Categories/dispositions use the vocabulary in R5; no forced bug classification. Markdown explains the smallest follow-up per confirmed finding.

Output feeds 0905 via the scenario IDs, source commit, and evidence source list. 0904 is independent and has separate artifacts. No upstream task prerequisite.

### Plan

- [ ] Step 1 (R1, AC1): Freeze an explicit surface inventory reachable from dev-run, dev-runall, dev-parallel, super-planner, super-coder, super-reviewer, spur agent, spur message, and every model-bearing workflow action. Include each directly referenced runtime contract and installed adapter target that can be located; list missing installed targets without inventing paths.
- [ ] Step 2 (R2, AC2): Compare CLI flags/output/selector semantics, quota ownership, role pins, reuse/fresh sessions, capability fallback, receipt identity, and mutation policy across the frozen surfaces; each mismatch cites current source and asserted guidance.
- [ ] Step 3 (R3, AC3): Capture feature sync --all --dry-run once; use its proposed statuses only in the report. Resolve archived linked tasks through task show before calling a feature empty or terminal. Cover I7, P, D62, E6, B1, B3, G1, G4, G65, and I4 without modifying them.
- [ ] Step 4 (R4, AC4): Map four journeys—inspect/select executor, dispatch one task, send/wait for a request, and recover an interrupted member—to existing commands, identity keys, receipts, and failure outcomes. Propose simplification only for demonstrated redundant steps.
- [ ] Step 5 (R5, AC5): Assign each confirmed finding an existing owner or explicit unowned disposition; separate shipped behavior, stale prose, absent adoption, unverified behavior, and already-owned work. No new feature/task allocation in this investigation.
- [ ] Step 6 (R6, AC6): Deliver 0903-contract-adoption.md and 0903-contract-adoption.json with the schema and coverage accounting below; enumerate concrete scenarios for dependent task 0905.
- [ ] Step 7 (R7, AC7): Validate row IDs, source anchors, inventory coverage, dispositions, and scenario references with a repeatable local check; report all unknowns and execution constraints.

### Solution

<!-- Final synthesized recommendation or output from the brainstorm. -->

### Testing

Not run during charting. The eventual investigation must record source-local commands, exit status, captured help/JSON provenance, and the distinction between observed behavior and inference; no implementation test or fix is claimed here.

### Review

Open until the investigation runs. Review must check that installed-versus-source drift is evidenced, hypotheses remain labeled, existing ownership is not duplicated, and no public surface or lifecycle status was changed.

### References

- `plugins/sp/skills/wayfinder/SKILL.md`
- `plugins/sp/skills/spur-dev/references/execution-workflow.md`
- `plugins/sp/skills/spur-dev/references/cross-cutting.md`
- `plugins/sp/skills/next-router/references/routing-table.md`
- `config/workflows/task-pipeline.yaml`
- `plugins/sp/tests/task-pipeline-resilience.test.ts`
- `docs/design/session-pinned-dispatch.md`
- Feature I31, via `spur feature show I31 --json`.
- Readiness provenance: HEAD d8ff752b2; one local worktree; no wip tasks at audit. Recheck on execution.

### History
