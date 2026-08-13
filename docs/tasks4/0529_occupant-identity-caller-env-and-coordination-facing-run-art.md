---
template: feature-impl
schema_version: 1
name: "Occupant identity, caller env, and coordination-facing run artifacts"
description: ""
status: todo
type: task
profile: standard
feature_id: G4
parent_wbs: null
priority: P1
tags: []
dependencies: []
ac_numbering: task-local
created_at: "2026-08-13T04:48:31.368Z"
updated_at: "2026-08-13T05:47:49.981Z"
---

## 0529. Occupant identity, caller env, and coordination-facing run artifacts

### Background
Implements G4 R1–R3 (ADR-057 wave 1). `--drain` today rewrites `--agent <specId>` to `spec.type` and drops the spec id before `AiRunner` (`apps/cli/src/commands/agent.ts`). Supervised loop children do not receive `SPUR_SPEC_ID` / `SPUR_RUN_ID`. There is no addressable run record another agent can read. This task adds the occupant pin, injects caller env, and persists a coordination-facing run with artifact **paths** only.

Does not add `agent wait`, `send --wait`, a new noun, terminal reads, or the Phase-2 rich inspector.
### Requirements
- [ ] R1. Every `AgentService.executeRun` that was addressed by a **spec id** persists `OccupantRef { specId, agentKind, processId, runId, generation }`. `drainIntoPrompt` sets `flags['spec-id']` to the spec id **before** rewriting `flags.agent` to `spec.type`. `runId` is the existing `correlation.runId` from `defaultExecutionOptions` (flag `run-id` or `crypto.randomUUID()`). `AgentService.getOccupant({ specId })` returns the live pin; `getOccupant({ agentKind })` throws. Bare `spur agent run --agent codex` (no spec) does **not** create an occupant.
- [ ] R2. Persist `CoordinationRun` in SQLite (`coordination_runs`). Status `running|exited|errored`; timestamps ISO-8601; `artifact_refs_json` is a JSON array of `{ kind: 'result'|'log'|'verdict', path }` to existing project-relative files only — never stdout/stderr bodies. `AgentService.getCoordinationRun(runId)` returns occupant + refs. `spur agent run --json` **adds** optional `occupant` and `run` keys and keeps `exitCode`, `stdout`, `stderr`, `durationMs` (and `signal` when present).
- [ ] R3. `SupervisorService.start` merges into `pipeOpts.env`: `SPUR_SPEC_ID=<agentId>`, `SPUR_TEAM_ID` when a `team:` tag exists, `SPUR_RUN_ID` minted for that process generation, `SPUR_SERVE_URL` from constructor/`SPUR_SERVE_URL` env when set. Each `start` increments `generation` for that spec. Unsupervised `agent run` with `spec-id` still persists occupant; env injection is supervisor-only.
### Acceptance Criteria
```gherkin
Feature: Inter-agent control plane

  Scenario: R1 — Occupant identity distinguishes spec, kind, process, and run
    Given a team spec `reviewer` whose type is `codex`
    When `spur agent run --drain --agent reviewer` starts an invoke
    Then the occupant record retains specId `reviewer`, agentKind `codex`, a new runId, and a generation
    And resolving that occupant by agentKind alone is rejected

  Scenario: R2 — Another agent can address a sibling run artifact
    Given occupant `reviewer` has completed a run with at least one artifact path
    When a sibling asks for that run by runId
    Then it receives the occupant pin and artifact paths
    And it does not receive a terminal snapshot or raw stdout body in the row

  Scenario: R3 — Supervised spawn injects caller identity env
    Given `spur team start reviewer` launches `spur agent loop`
    When the loop process environment is inspected
    Then `SPUR_SPEC_ID` is `reviewer` and `SPUR_RUN_ID` is set for the current iteration
```
### Q&A
- **Q: New CLI noun / `agent run-get`?** A: No in this task. Read is `getCoordinationRun` + additive `agent run --json` keys. Closed 2026-08-12.
- **Q: Does `spur agent run --agent codex` create an occupant?** A: No. Occupant only when the address is a spec id (`spec-id` flag or `--agent` matching `.spur/agents/<id>.yaml`). Closed 2026-08-12.
- **Q: Phase-2 rich inspector?** A: No. Paths only. Closed 2026-08-12.
- **Q: Store stdout in the DAO?** A: No. Closed 2026-08-12.
### Design
WHAT: Occupant pin + path-only run row + supervisor env. No wait verb.

WHY: `drainIntoPrompt` (`apps/cli/src/commands/agent.ts:353`) overwrites `flags.agent` with `spec.type` and drops the spec id. `SupervisorService.start` (`packages/app/src/services/supervisor-service.ts:198`) copies `process.env` only. `defaultExecutionOptions` already mints `runId` (`agent-service.ts:845`) — reuse it.

WHERE:
- Types + DAO: `packages/domain/src/dao/coordination-run-dao.ts` (new) + `packages/domain/src/migrations.ts` increment `0010_spur_cli_coordination_runs` and include the table in `CLI_SCHEMA_SQL`.
- Service: `packages/app/src/services/agent-service.ts` (`executeRun` persist start/exit; new `getOccupant` / `getCoordinationRun`).
- Drain: `apps/cli/src/commands/agent.ts` `drainIntoPrompt` + `runAgentLoop` (loop must set `spec-id` every iteration even when inbox is empty).
- Env: `packages/app/src/services/supervisor-service.ts` `start`.
- Tests: `packages/app/tests/services/agent-service.test.ts`, `supervisor-service.test.ts`, `apps/cli/tests/commands/agent-team.test.ts`.
- Docs (same commit, T3): `docs/04_DESIGN.md` `agent run --json` additive keys; `docs/design/inter-agent-control-plane.md` §2–4 mark wave 1 landed.

Frozen names:
```
OccupantRef, CoordinationRun, CoordinationArtifactRef
flags['spec-id']
AgentService.getOccupant / getCoordinationRun
coordination_runs (spec_id, agent_kind, process_id, run_id PK, generation, status, started_at, completed_at, artifact_refs_json)
SPUR_SPEC_ID, SPUR_TEAM_ID, SPUR_RUN_ID, SPUR_SERVE_URL
0010_spur_cli_coordination_runs
```

Algorithm:
1. If `flags['spec-id']` or `--agent` equals a spec id → occupant path. Else coding-agent run (today).
2. `generation = 1 + max(generation) for spec_id` (supervisor `start` always increments; `executeRun` uses current max, or 1 if none).
3. Insert row `status=running` at invoke start; update `exited`/`errored` + `completed_at` on finish. `artifact_refs_json` starts `[]`; if `.spur/run/<runId>.log` or a verdict path exists at exit, append `{ kind:'log'|'verdict', path }`.
4. `getOccupant({ agentKind })` → throw `occupant_lookup_kind_rejected`.

Anti-patterns: new CLI noun; `spur agent run-get`; storing stdout in the row; using `SPUR_AGENT` as spec id; changing non-drain `agent run --agent <binary>` behavior; PTY/screen reads.

Handoff to 0530: wait consumes `getOccupant` + `runId`/`generation`. Do not implement wait here.

Premise check (2026-08-12): drain rewrite and supervisor env copy verified in the files/lines above. Next migration id is `0010` (0009 is history_message index).
### Plan
1. R1/R2 — Add `coordination_runs` DDL + DAO + in-memory SQLite tests (insert, get by runId, kind-only lookup throws).
2. R1 — Thread `flags['spec-id']` through `drainIntoPrompt` and `runAgentLoop`; persist occupant in `executeRun` using `correlation.runId`.
3. R2 — Update row on exit; additive `occupant`/`run` on `handleRunOutput` `--json`; keep existing keys.
4. R3 — Merge the four env vars in `SupervisorService.start`; generation increment; supervisor unit tests.
5. Tests: drain-with-spec keeps spec-id; unsupervised `codex` run has no occupant; start env contains `SPUR_SPEC_ID`.
6. T3: `04_DESIGN` + design satellite wave-1 note. No wait verb.
### Solution

<!-- Filled during implementation: file:line change map and concise rationale. -->

### Testing

<!-- Filled during verification: commands run, outcomes, coverage claim or N/A. -->

### Review

<!-- Filled during review: P1-P4 findings, residual risk, and final disposition. -->

### References
- Feature G4 R1–R3; ADR-057; `docs/03_ARCHITECTURE.md` §17; `docs/design/inter-agent-control-plane.md` §§2–4
- Seams: `apps/cli/src/commands/agent.ts` `drainIntoPrompt`; `packages/app/src/services/agent-service.ts` `executeRun` / `defaultExecutionOptions` / `handleRunOutput`; `packages/app/src/services/supervisor-service.ts` `start`; `packages/domain/src/migrations.ts` `CLI_MIGRATIONS`
- Follow-on: 0530 (wait). Not this task: 0531, 0532, G3
### History
