---
schema_version: 1
name: "Workflow engine: wildcard from transitions for cancel/deprecate edges (deferred)"
status: cancelled
template: standard
created_at: 2026-10-18T05:22:19.813Z
updated_at: "2026-10-19T01:04:15.306Z"

feature_id: D66
ac_altitude: task-local
estimate_hours: 6
priority: P3
---

## 1253. Workflow engine: wildcard from transitions for cancel/deprecate edges (deferred)

### Background

> Deferred: D66 shipped without it (2026-10-18). Wildcard `from` transitions are a released `@gobing-ai/ts-dual-workflow-engine` change, tracked separately; the cancel/deprecate edges stay explicit in feature-lifecycle and task-lifecycle until then.

Deferred follow-up from feature D66 (operator decision 2026-10-17: record it, do not implement yet).
`transition.from` in the state-machine schema is a plain string and `requestTransition` matches one
`(from, to)` pair, so every non-terminal state repeats its own cancel/deprecate edge:
config/workflows/feature-lifecycle.yaml has 10 `to: cancelled|deprecated` edges and
config/workflows/task-lifecycle.yaml has 12. The schema lives in the released
`@gobing-ai/ts-dual-workflow-engine` package, so this is an upstream engine change first, then a Spur
definition cleanup. Linked to D66 so it stays visible: D66 cannot close while this task is open, so
when 1252 lands, implement it, cancel it, or move it to the feature that owns the engine upgrade.


**Refine corrections (2026-10-17)**

- Edge counts were re-verified: feature-lifecycle.yaml has 10 and task-lifecycle.yaml has 12 `to: cancelled|deprecated` edges. The design doc's "17 boilerplate edges" counted all feature-lifecycle always-guard edges; the cancel/deprecate fan-in is 10.
- Engine match sites live in ../ts-libs/packages/dual-workflow-engine/src: `service.ts:420` (external `requestTransition`, exact `find`), `state-machine.ts:186` (auto-advance outbound filter) and `config.ts:86-90` (source validation, outbound index). All three compare `transition.from ===` a single state id.
- Spur also reads `transition.from` directly, so R3 must keep these consumers correct: packages/app/src/workflow/{lifecycle-adapter,composition-lint,mermaid-render,step-reporter,progress-projection}.ts, packages/app/src/services/{feature-transition,run-store-service,planning-write-service}.ts and apps/web/src/modules/observability/TraceTab.tsx. An engine-only change would leave the Board graph and the legal-path denial text blind to wildcard edges.
- Status stays backlog (operator decision: deferred); the refine fills it to ready depth so it can be scheduled without re-planning.

### Requirements

- [ ] R1. The engine schema accepts `from: "*"` or `from: [<state>, …]` on a state-machine transition. Matching is exact pair first; a wildcard or list edge is used only when no exact `(from, to)` edge exists.
- [ ] R2. Terminal states never match a wildcard `from`. A list `from` naming a terminal state is a validation error.
- [ ] R3. feature-lifecycle and task-lifecycle each replace their per-state cancel and deprecate edges with wildcard edges, and the allowed transition set enumerated per `(from, to)` pair is identical before and after.
- [ ] R4. Every Spur consumer of `transition.from` (listed in Background) handles the wildcard. The Board graph, Mermaid render and the legal-path denial text show the same edges as before.
- [ ] R5. Spur takes the change by upgrading the released `@gobing-ai/ts-dual-workflow-engine` package; there is no Spur-side expansion pass.

Out of scope: DAG `edges`, which have no fan-in boilerplate; any other lifecycle edge reshaping.

### Acceptance Criteria

- [ ] AC1 — Wildcard from edges resolve only when no exact edge exists (req: R1, R2)
- [ ] AC2 — Both lifecycles keep an identical allowed transition set after the wildcard rewrite (req: R3, R4, R5)

### Q&A

<!-- CLOSED decisions from refinement: what was chosen and why, what was deferred and on what
     condition. Not a parking lot for open questions — an unanswered question here means the task
     is not ready to hand off. Keep empty if none. -->

#### Q&A entry — 2026-10-18T05:44:22.482Z

- Blocked 2026-10-17 by operator decision: deferred, not to be implemented under the D66 run. Unblock with `spur task update 1253 todo` when the engine upgrade is scheduled. It was promoted to todo before the deferral was recorded, and the lifecycle has no todo→backlog edge.

### Design

Deferred; frozen for scheduling.

Chosen: `from: "*" | string | string[]` in the engine transition schema, with one engine helper `transitionMatches(transition, state)` used at every match site. Resolution is exact pair first, so explicit edges keep their guards and the wildcard only fills the cancel/deprecate fan-in.

Rejected:
- A Spur-side YAML expansion pre-pass: a second definition dialect that the engine, the Board graph and the validators would not see.
- Regex `from`: unbounded, and it hides edges from review.

Frozen names:
- Engine export `transitionMatches`.
- Spur consumers that need concrete edges call an engine-exported `expandTransitions(workflow)` (concrete `(from, to)` pairs) instead of reading `transition.from`.

File targets:
- Engine (../ts-libs/packages/dual-workflow-engine/src): `config.ts:86-90`, `service.ts:420`, `state-machine.ts:186`, the schema JSON and tests.
- Spur: the consumers listed in Background, then config/workflows/feature-lifecycle.yaml and task-lifecycle.yaml.

Anti-patterns:
- No Spur workaround before the engine release.
- Never let a wildcard reach a terminal state's outbound set.
- Do not change any guard on an existing explicit edge.

Proof: a parity test that enumerates `expandTransitions` for both lifecycles before and after the rewrite and asserts set equality.

Handoff: when 1252 lands and this task is still deferred, cancel it or move it with `spur task update 1253 --field feature_id` to the feature that owns the engine upgrade, so it does not block D66 close.

### Plan

- [ ] 1. Engine: failing tests for exact-first matching, the terminal exclusion and list validation (R1, R2).
- [ ] 2. Engine: add `transitionMatches` and `expandTransitions`, switch the three match sites, update the schema, release a minor version (R1, R2).
- [ ] 3. Spur: bump the catalog version. Add a failing parity test that snapshots `expandTransitions` for both lifecycles from the current YAML (R3).
- [ ] 4. Spur: switch the `transition.from` consumers to `expandTransitions` (R4).
- [ ] 5. Spur: rewrite both lifecycle YAMLs with wildcard edges. The parity test must stay green (R3).
- [ ] 6. Run targeted tests in packages/app and apps/web, then `bun run spur-check`.

### Solution

<!-- Filled during implementation: file:line change map and concise rationale. -->

### Testing

<!-- Filled during verification: commands run, outcomes, coverage claim or N/A. -->

### Review

<!-- Filled during review: P1-P4 findings, residual risk, and final disposition. -->

### References

<!-- Links to features, docs, ADRs, related tasks, or external references. -->

### History

- 2026-10-18T05:30:34.347Z backlog → todo (system)
- 2026-10-18T05:44:22.769Z todo → blocked (system)
- 2026-10-19T01:04:05.816Z blocked → todo (system)
- 2026-10-19T01:04:15.306Z todo → cancelled (system)

