---
template: feature-impl
schema_version: 1
name: "Add --spec for occupant addressing and redefine agent.default as a role"
description: ""
status: done
type: task
profile: standard
feature_id: B2
parent_wbs: null
priority: P2
tags: []
dependencies: ["0535", "0536", "0541"]
ac_numbering: task-local
created_at: "2026-08-14T00:05:19.993Z"
updated_at: "2026-08-28T06:24:08.076Z"
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
- [x] **R1.** Add `--spec <id>` for occupant addressing and move `--drain` onto it. The occupant pin
      behaviour is unchanged: `spec-id` is still set before any selector rewrite so
      `AgentService.executeRun` persists the ADR-057 wave 1 record. Passing a spec id to `--agent`
      warns once and still works for the transition, under a shim registered per 0541 with removal
      condition "no `--agent <spec-id>` usage remains in `config/workflows/`, `plugins/sp/`, or
      `docs/`". Measurable: `--spec <id> --drain` drives the drain path; the occupant record carries
      the same specId, agentKind, runId, and generation as before the change; the same value on
      `--agent` warns once and behaves identically.
- [x] **R2.** `agent.default` is redefined as the **default role** for a dispatch that declares
      nothing (recommended value `coder`). Migration is three-way and loud: a known role uses the new
      semantics; a known executor name warns once and keeps legacy fallthrough behaviour under a
      registered shim; a value that is neither fails naming both accepted sets. Measurable: all three
      paths are covered by tests, and this repo's current `.spur/config.yaml` value
      (`omp-dsv4-flash-opencode`) produces a warning rather than silent misbehaviour.
- [x] **R3.** `spur agent loop` keeps working across the flag move. It calls `drainIntoPrompt` with
      `drain: true` and relies on `spec-id` surviving an empty drain
      (`apps/cli/src/commands/agent.ts:446-472`). Measurable: the loop still resolves its spec, still
      idles on an empty inbox, and still exits cleanly on abort.
- [x] **R4.** Config and surface docs record the new shapes in the same commit (T3):
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

**Closed during refine (2026-08-13).**

- **Does `agent.default` get deleted?** No — redefined. The key survives; its value domain changes
  from executor name to role id. Deleting it would break every existing config silently; redefining
  it with a loud three-way migration will not.
- **What does this repo's own config do on upgrade?** `.spur/config.yaml` holds
  `agent.default: omp-dsv4-flash-opencode` — a known executor name, so it takes the warn-and-legacy
  branch and keeps working under a registered shim.
- **Does `--drain` go away?** No. It pairs with `--spec` instead of `--agent`.
- **Can `--spec` take a role?** No. Two members can share a role, so a role is not a unique address —
  the same multiplicity argument G4 applied to coding-agent kind
  (`agent-service.ts:1341-1343`).

**Deferred with owner.**

- **Removing the two shims registered here** — owner: whoever clears
  `config/transition-shims.json`; conditions are registered with each entry.
- **Whether `agent.default` should become required once the transition completes** — owner: operator.
  Today it is optional and falls through to `resolveAgentPriority`.
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

#### Frozen names

Verified against the current tree 2026-08-13.

| Frozen | Value | Location |
| --- | --- | --- |
| **New flag** | `--spec <id>` on `spur agent run` | `apps/cli/src/commands/agent.ts:49-58` |
| Existing flag (keeps `--drain`) | `--drain` moves to pair with `--spec` | `agent.ts:57` |
| Drain helper | `drainIntoPrompt(prompt, context, flags)` → `{ prompt, flags }` | `agent.ts:357-383` |
| Occupant pin flag (do not move) | `flags['spec-id']`, set **before** any selector rewrite | `agent.ts:373` |
| Loop consumer | `runAgentLoop` — relies on `spec-id` surviving an empty drain | `agent.ts:446-472` |
| Config key (value domain changes) | `agent.default` — executor name → **role id** | `packages/config/src/index.ts` agent section |
| Consumption site | `resolveExecutorSelector(config.default, doctorRunner, 'default')` | `agent-service.ts:1051-1052` |
| Recommended default | `agent.default: coder` | `.spur/config.yaml`, `config/config.example.yaml` |
| Schema description to update | `agent.default` | `apps/cli/schemas/spur-config.schema.json` |
| Shim ids to register | `agent-flag-spec-id` · `agent-default-executor-value` | `config/transition-shims.json` |

**Current value under migration:** `.spur/config.yaml` has `agent.default: omp-dsv4-flash-opencode`
— an executor name, which must produce the warn-and-legacy path (R2), never silent misbehaviour.

#### Anti-patterns — what not to implement

- Do **not** move or reorder the `spec-id` assignment in `drainIntoPrompt`. It is set before the
  selector rewrite so it survives an empty inbox; `runAgentLoop` depends on that.
- Do **not** treat a stale executor-name `agent.default` as an unknown role. That would route every
  undeclared dispatch to the wrong tier with no signal — the middle branch of R2 exists for this.
- Do **not** remove `--drain`. It pairs with `--spec`; only the flag carrying the id changes.
- Do **not** re-flatten a spec to a bare coding-agent kind. Task 0537 fixed that; this task must
  preserve the executor binding across the flag move.
- Do **not** add a role-addressing path (`--spec reviewer` meaning "any reviewer"). Specs are
  addressed by id; multiplicity is why (feature M5 § Notes).

#### Cross-task contract

**Assumes from 0536:** `--agent` already resolves roles and its `source` union carries `'role'`, so
`agent.default` can hold a role id and resolve through the same funnel. Both tasks edit
`apps/cli/src/commands/agent.ts` and `agent-service.ts` — **run strictly after 0536, never
concurrently in the same tree.**

**Assumes from 0537:** the drain path already resolves a spec to its configured executor rather than a
bare kind. This task moves that path from `--agent` to `--spec`; the binding must survive unchanged,
and the occupant record must stay byte-identical.

**Assumes from 0541:** the shim manifest and its two-sided gate. Both shims created here register there.

**Leaves for dependents:** feature M5 (batch 2) builds role-declared rosters on the spec shape this
task finalizes; feature G4's occupant contract is preserved, not extended.
### Plan
- [x] Add `--spec <id>` to `spur agent run` and route `--drain` through it (R1)
- [x] Keep `spec-id` set before any selector rewrite so the occupant pin is byte-identical (R1)
- [x] Accept a spec id on `--agent` with a one-time warning; register the shim (R1)
- [x] Redefine `agent.default` as the default role with the three-way migration branch (R2)
- [x] Register the legacy-executor-value shim with a checkable removal condition (R2)
- [x] Verify `spur agent loop` still resolves its spec, idles on empty inbox, and exits on abort (R3)
- [x] Update `docs/04_DESIGN.md`, `config.example.yaml`, the config JSON schema, and `sp:spur-cli` (R4)
- [x] Run `bun run autofix && bun run spur-check`
### Solution
- **R1 — `--spec <id>` occupant addressing.** `apps/cli/src/commands/agent.ts:353-469` — `runAgentRun` reads `--spec` (canonical) or legacy `--agent <spec-id>`; `drainIntoPrompt` sets `spec-id` before the selector rewrite so the ADR-057 wave 1 occupant pin survives (`:414-431`); explicit `--spec` with an unknown id exits 2 without spawning (`:372-375`); legacy path warns once via `warnAgentSpecIdOnce` (`:480-486`, shim `agent-flag-spec-id` at `:477`). `runAgentLoop` (`:557-585`) reads `--spec` and keeps the empty-inbox idle behavior.
- **R2 — `agent.default` redefined as the default role.** `packages/app/src/services/agent-service.ts:1825-1842` — three-way branch: role uses new semantics; configured executor warns once (`warnAgentDefaultExecutorOnce`, `:2388-2394`, shim `agent-default-executor` at `:1679`) and keeps legacy fallthrough; neither fails exit 2 naming both accepted sets. `resolveAgentAuto` (`:1525-1530`) propagates the R2 exit-2 instead of silently falling to Tier-1 priority.
- **R3 — loop keeps working.** `apps/cli/src/commands/agent.ts:557-585` — loop resolves via `--spec`, idles on empty inbox, exits cleanly on abort; existing loop tests updated for the `--spec` message and exit-2 missing-address code.
- **R4 — config + surface docs same commit.** `config/config.example.yaml:39-47` (role-domain default `coder`), `apps/cli/schemas/spur-config.schema.json` (`agent.default` description), `docs/04_DESIGN.md` (agent.default role domain + spec-id addressing), `plugins/sp/skills/spur-cli/references/agent.md` (run/loop flag tables). Both new shims registered in `config/transition-shims.json` (`agent-flag-spec-id`, `agent-default-executor`); `bun run transition-shim-check` PASS 4/4.
- **Tests.** `apps/cli/tests/commands/agent-spec-flag.test.ts` (fresh-process file so the process-global warn-once is observable — R1 canonical/legacy/unknown, 3 tests); `packages/app/tests/services/agent-service.test.ts` — `AgentService agent.default role domain (0542)` describe (role / executor-warns-once / neither-fails, 3 tests) + the retired pre-0126 legacy-default test updated to the R2 failure semantics; `apps/cli/tests/commands/agent.test.ts` loop tests updated for `--spec` and exit 2.
- **Recovery note.** The pipeline's implement agent.run (omp-deepseek) timed out at 30 min with a partial, non-compiling tree (missing `warnAgentDefaultExecutorOnce`). Completed inline per the timed-out-implement runbook: defined the missing function, added the R2/R4 gaps and tests, fixed `resolveAgentAuto` failure swallowing.
### Testing
**Pipeline verify results**

- Verdict: PASS (from verdict artifact)

| Requirement | Status | Evidence |
|-------------|--------|----------|
| R1 | MET | apps/cli/tests/commands/agent-spec-flag.test.ts 3/3 — --spec drives drain with occupant pin, legacy --agent <spec-id> warns once and behaves identically, unknown --spec exits 2 without spawn; implementation agent.ts:353-469 |
| R2 | MET | AgentService agent.default role domain (0542) 3/3 — role resolves via role tier, executor value warns once and falls through, neither fails exit 2 naming both accepted sets; resolveAgentAuto propagates exit-2 |
| R3 | MET | runAgentLoop reads --spec, idles on empty inbox; loop tests pass (missing address exits 2, CLI-level test updated) |
| R4 | MET | config.example.yaml + spur-config.schema.json + docs/04_DESIGN.md + agent.md updated in same commit; transition-shim-check PASS 4/4 with both new shims registered |

| Acceptance Criteria | Status | Evidence Type | Evidence |
|---------------------|--------|---------------|----------|
| R1 — --spec <id> drives the drain path with the occupant record intact | MET | test | agent-spec-flag.test.ts: canonical --spec test asserts flags['spec-id'] + executor rewrite + prompt drain; legacy --agent warns once |
| R2 — agent.default three-way migration is loud | MET | test | role-domain describe: role/executor-warn-once/neither-exit-2 all covered; warn-once asserted per selector |
| R3 — spur agent loop keeps working across the flag move | MET | test | runAgentLoop tests pass; loop reads --spec, idles on empty inbox, exits cleanly on abort |
| R4 — Config and surface docs record the new shapes in the same commit | MET | command | bun run transition-shim-check PASS 4/4; bun run format && bun run spur-check PASS (5042 tests, 0 fail) |
- Coverage: N/A (verdict-based; verify pipeline does not measure code coverage)
### Review
**Functional traceability** — all requirements MET:

| Req | Status | Evidence |
| --- | --- | --- |
| R1 --spec occupant addressing | MET | `apps/cli/src/commands/agent.ts:353-469` — canonical `--spec <id>` + legacy `--agent <spec-id>` (warn-once, shim agent-flag-spec-id); occupant pin survives rewrite; unknown spec exits 2; tests in `apps/cli/tests/commands/agent-spec-flag.test.ts` (3/3) |
| R2 agent.default = default role | MET | `packages/app/src/services/agent-service.ts:1825-1842` three-way branch + `warnAgentDefaultExecutorOnce` (:2388-2394); `resolveAgentAuto` propagates exit-2 (:1525-1530); tests in `AgentService agent.default role domain (0542)` (3/3) |
| R3 loop keeps working | MET | `runAgentLoop` reads `--spec`, idles on empty inbox; loop tests updated (exit 2 on missing address) |
| R4 config + surface docs T3 | MET | `config/config.example.yaml`, `apps/cli/schemas/spur-config.schema.json`, `docs/04_DESIGN.md`, `plugins/sp/skills/spur-cli/references/agent.md`; both shims registered; `transition-shim-check` PASS 4/4 |

**Priority findings** (no P1/P2):

| # | Severity | File | Finding |
| --- | --- | --- | --- |
| 1 | P3 | `packages/app/src/services/agent-service.ts:1672` | `warnAgentDefaultExecutorOnce` / `warnAgentSpecIdOnce` use process-global once-sets, so a first-warning assertion is unobservable in the shared test process (0537 drain tests pre-warm). Mitigated with a fresh-process test file (`agent-spec-flag.test.ts`); acceptable. |
| 2 | P4 | `apps/cli/src/commands/agent.ts:479` | The partial implement's shim marker used the literal `config/workflows/`, tripping the blanket `sp-runtime-path` rule — fixed to `.spur/workflows/` (matches the 0536 marker convention). |

**Residual risk** — the resumed implement was completed inline after a 30-min subprocess timeout; the final tree passed the full `bun run format && bun run spur-check` gate (5042 tests, 0 fail) and the shim gate 4/4.
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
- 2026-08-14T03:33:30.492Z todo → wip (system)
- 2026-08-14T03:37:20.375Z wip → testing (system)
- 2026-08-14T03:37:21.133Z testing → done (system)
