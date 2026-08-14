---
template: feature-impl
schema_version: 1
name: "Add --spec for occupant addressing and redefine agent.default as a role"
description: ""
status: todo
type: task
profile: standard
feature_id: B2
parent_wbs: null
priority: P2
tags: []
dependencies: ["0535", "0536", "0541"]
ac_numbering: task-local
created_at: "2026-08-14T00:05:19.993Z"
updated_at: "2026-08-14T00:07:39.243Z"
---

## 0542. Add --spec for occupant addressing and redefine agent.default as a role

### Background
Feature G4 made `--agent` accept a team spec id under `--drain`, giving one flag three meanings
disambiguated by an unrelated flag. Task 0536 makes `--agent` the role selector, which leaves spec
addressing without a home.

A role cannot replace a spec id as an address: two team members can share a role, and G4 explicitly
rejects non-unique addressing (`packages/app/src/services/agent-service.ts:1341-1343`,
`occupant_lookup_kind_rejected: address the occupant by specId, not agentKind`). Role addressing has
the identical multiplicity problem. So the spec namespace needs its own flag.

Separately, `agent.default` (`agent-service.ts:1051-1052`) is a fallthrough *executor* selector. Under
role routing every dispatch resolves through a role to a tier to a cheapest-eligible executor, so the
fallthrough is unreachable — but the key is still useful as the **default role** for a dispatch that
declares nothing.

Operator ruling 2026-08-13: redefine the key rather than dropping it. That changes its value domain
from executor name to role name, which makes every existing config's value wrong — so the migration
must be loud, never a silent reinterpretation.

Split out of task 0536 to keep both inside the size budget. Runs after it; both edit
`apps/cli/src/commands/agent.ts`, so they must not run concurrently in the same working tree.
### Requirements
- [ ] **R1.** Add `--spec <id>` for occupant addressing and move `--drain` onto it. The occupant pin
      behaviour is unchanged: `spec-id` is still set before any selector rewrite so
      `AgentService.executeRun` persists the ADR-057 wave 1 record. Passing a spec id to `--agent`
      warns once and still works for the transition, under a shim registered per 0541 with removal
      condition "no `--agent <spec-id>` usage remains in `config/workflows/`, `plugins/sp/`, or
      `docs/`". Measurable: `--spec <id> --drain` drives the drain path; the occupant record carries
      the same specId, agentKind, runId, and generation as before the change; the same value on
      `--agent` warns once and behaves identically.
- [ ] **R2.** `agent.default` is redefined as the **default role** for a dispatch that declares
      nothing (recommended value `coder`). Migration is three-way and loud: a known role uses the new
      semantics; a known executor name warns once and keeps legacy fallthrough behaviour under a
      registered shim; a value that is neither fails naming both accepted sets. Measurable: all three
      paths are covered by tests, and this repo's current `.spur/config.yaml` value
      (`omp-dsv4-flash-opencode`) produces a warning rather than silent misbehaviour.
- [ ] **R3.** `spur agent loop` keeps working across the flag move. It calls `drainIntoPrompt` with
      `drain: true` and relies on `spec-id` surviving an empty drain
      (`apps/cli/src/commands/agent.ts:446-472`). Measurable: the loop still resolves its spec, still
      idles on an empty inbox, and still exits cleanly on abort.
- [ ] **R4.** Config and surface docs record the new shapes in the same commit (T3):
      `docs/04_DESIGN.md`, `config/config.example.yaml`, `apps/cli/schemas/spur-config.schema.json`,
      and the `sp:spur-cli` agent reference. Both shims created here are registered in
      `config/transition-shims.json` with objectively checkable removal conditions. Measurable: the
      JSON schema's `agent.default` description states the role vocabulary, and the shim gate passes.
### Acceptance Criteria
```gherkin
Scenario: R1 — Occupant addressing moves to its own flag
  Given a team spec id
  When spur agent run --spec <id> --drain is invoked
  Then the drain path runs against that spec
  And the occupant record carries the same specId, agentKind, runId, and generation as before
  And passing that spec id to --agent instead warns once and behaves identically

Scenario: R2 — agent.default is a role, and a legacy executor value migrates loudly
  Given agent.default holds a value
  When config is loaded
  Then a known role is used as the default role for undeclared dispatches
  And a known executor name warns once and keeps legacy behaviour under a registered shim
  And a value that is neither fails naming both accepted sets

Scenario: R3 — The supervised loop survives the flag move
  Given spur agent loop is spawned for a team member
  When its inbox is empty
  Then it retains its spec id and idles rather than exiting
  And it exits cleanly on abort as before

Scenario: R4 — Config surfaces and shims are recorded
  Given the new flag and the redefined key have shipped
  When the config schema and surface docs are read
  Then agent.default is documented as taking a role
  And both transition shims appear in config/transition-shims.json with checkable removal conditions
```
### Q&A

<!-- CLOSED decisions from refinement: what was chosen and why, what was deferred and on what
     condition. Not a parking lot for open questions — an unanswered question here means the task
     is not ready to hand off. Keep empty if none. -->

### Design
**One flag per concept, now that `--agent` is being redefined anyway.** Splitting `--spec` was
deferred twice (0346 R4, and again on 2026-08-13 when `--agent` was not otherwise changing). The role
ruling reverses that calculus: doing it inside the same migration costs one deprecation window
instead of two.

**Do not touch the occupant pin logic.** `drainIntoPrompt`
(`apps/cli/src/commands/agent.ts:357-383`) sets `flags['spec-id']` *before* rewriting the selector,
and the comment there records why (the flag must survive an empty inbox because `runAgentLoop`
depends on it). Task 0537 has already changed what the selector is rewritten *to*; this task changes
only where the spec id is *read from*. Keep the ordering.

**`agent.default` migration is a three-way branch, not a fallback chain:**

| Value | Behaviour |
| --- | --- |
| a known role | new semantics — the default role |
| a known executor name | warn once, legacy fallthrough, registered shim |
| neither | fail loud, naming both accepted sets |

The middle row is the one that matters: silently treating a stale executor name as an unknown role
would route every undeclared dispatch to the wrong tier with no signal.

**Reuse `warnDeprecationOnce`** (`agent-service.ts:608-612`, call site `:646-648`) for both shims.

**Not in scope:** removing `--drain` itself, changing occupant semantics, or Teams redefinition
(batch 2).
### Plan
- [ ] Add `--spec <id>` to `spur agent run` and route `--drain` through it (R1)
- [ ] Keep `spec-id` set before any selector rewrite so the occupant pin is byte-identical (R1)
- [ ] Accept a spec id on `--agent` with a one-time warning; register the shim (R1)
- [ ] Redefine `agent.default` as the default role with the three-way migration branch (R2)
- [ ] Register the legacy-executor-value shim with a checkable removal condition (R2)
- [ ] Verify `spur agent loop` still resolves its spec, idles on empty inbox, and exits on abort (R3)
- [ ] Update `docs/04_DESIGN.md`, `config.example.yaml`, the config JSON schema, and `sp:spur-cli` (R4)
- [ ] Run `bun run autofix && bun run spur-check`
### Solution

<!-- Filled during implementation: file:line change map and concise rationale. -->

### Testing

<!-- Filled during verification: commands run, outcomes, coverage claim or N/A. -->

### Review

<!-- Filled during review: P1-P4 findings, residual risk, and final disposition. -->

### References
- **R1 targets:** `apps/cli/src/commands/agent.ts:52-58` (`run` options), `:341-345` (drain branch),
  `:357-383` (`drainIntoPrompt`), `:446-472` (`runAgentLoop`)
- **Occupant model (do not regress):** `packages/app/src/services/agent-service.ts:655-675`
  (spec-id → occupant record), `:1341-1343` (`getOccupant`, kind rejected), `:1337-1371`
- **R2 targets:** `packages/app/src/services/agent-service.ts:1051-1052` (`agent.default`
  fallthrough), `:1228` (selector source `default`), `packages/config/src/index.ts:299-345`
  (`agent` section schema)
- **R4 targets:** `apps/cli/schemas/spur-config.schema.json:133`, `config/config.example.yaml`,
  `docs/04_DESIGN.md:190`, `plugins/sp/skills/spur-cli/references/` agent noun
- **Current config under migration:** `.spur/config.yaml` `agent.default: omp-dsv4-flash-opencode`
- **Prior decisions:** feature G4 § AC R1/R3 (occupant identity, caller env), ADR-057 wave 1,
  task 0346 R4 (rename deferred), feature B2 § *The role vocabulary*
### History
