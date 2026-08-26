---
schema_version: 1
id: "B4"
name: "Agent doctor as the routing inspection surface: capability-tier rendering, full eligible ladder, auth removal, and cached probes"
status: done
priority: P2
tags: []
created_at: "2026-08-26T18:44:51.338Z"
updated_at: "2026-08-26T22:42:03.976Z"
---

# B4: Agent doctor as the routing inspection surface: capability-tier rendering, full eligible ladder, auth removal, and cached probes

## Goal

`spur agent doctor` is the documented preflight for executor routing, but it renders the pre-0343
axis and hides the ladder. Make it show the routing model Spur actually implements — capability tier,
every eligible executor, the elected one, and the pinned model — and delete the auth signal that
0621 already declared unreliable, which is simultaneously 74% of the command's wall clock.

Measured against HEAD `212972e74` on 2026-08-26 with a 15-executor global config:

| Command | Wall clock |
| --- | --- |
| `spur --version` (boot floor) | 0.28 s |
| `spur agent list` (detection only) | 1.62 s |
| `spur agent doctor` | 6.20 s |

The 4.6 s delta is **not** LLM provider traffic — `probeModel` short-circuits to
`{status:'unknown'}` before any HTTP when the provider key is absent, which is also why every MODEL
cell reads `unknown`. It is `isAuthenticated`, called once per executor row in `buildResult`, so a
config with nine `omp` executors spawns nine identical `omp` auth probes.

## Scope

- In:
  - `renderDoctorTable` — replace the agent support tier (1/2) with the capability tier
      (`cheap|standard|capable-1..3`) as the `TIER` column; add `AGENT` (underlying binary),
      `MODEL` (pinned config string), and `ROLES` (eligible roles, elected one starred) columns;
      retire the `missing (tier-1)` footer for a count keyed on the same axis the table shows.
  - `doctor <role>` — render every eligible executor cheapest-first with the elected one marked
      and a skip reason on each row above it, instead of the single elected row.
  - Removal of the auth signal from the doctor path: `isAuthenticated` call in `buildResult`
      consumption, the `authenticated` field in `--json`, `renderAuth`, and the `auth:` line in
      `renderDoctorDetail`.
  - `packages/app/src/workflow/actions/doctor-probe.ts` — delete the `RELAY_FAMILY` /
      `ENV_MISS_PATTERN` / `AUTH_FAIL_PATTERN` classifier and the `auth === 'unauthenticated'` gate
      that exist only to neutralize the removed signal; the probe becomes a usability check.
  - `--probe-health` opt-in flag: model health probing stops firing implicitly when a provider key
      happens to be exported.
  - Detection cache at `.spur/run/agent-doctor.json` with a TTL and `--force-refresh`, plus a
      cache-age line in the output so a cached `usable` is never read as a live one.
  - `--json` additions: `model` (pinned string), `roles`, `elected`; `.agents[0]` stays the elected
      executor so `doctor-probe`'s existing parse keeps working.
  - Same-commit updates to `docs/04_DESIGN.md`, the `sp:spur-cli` agent reference, and the pinned
      output assertions in `apps/cli/tests/commands/agent.test.ts` and
      `packages/app/tests/services/agent-service.test.ts`.

- Out:
  - `resolveRole` resolution semantics (`agent-service.ts:1783-1823`). First-usable-wins is correct
      for dispatch; this feature changes rendering only.
  - `TeamService.materializeTeam`'s `[0]` selection (`team-service.ts:737`) — config-time, no
      liveness probe, unaffected by a display change.
  - The stage fallback / escalation ladder at runtime (task 0482 R1) — already correct.
  - New CLI nouns or verbs. `--probe-health` and `--force-refresh` are flags on the existing
      `agent doctor` verb (ADR-051: expansion via flags, operator consent recorded in this session).
  - Changing `DoctorResult.tier` (support tier) itself, or removing it from `--json` — it still
      backs the exit code.
  - Reinstating any provider-credential or local-config-file read for authentication.

## Acceptance Criteria

```gherkin
Feature: Agent doctor as the routing inspection surface

  @core
  Scenario: R1 — The doctor table renders capability tier, not agent support tier
    Given a config declaring executors at tiers cheap, standard, capable-2 and capable-3
    When the operator runs "spur agent doctor"
    Then the TIER column reads "cheap", "standard", "capable-2" and "capable-3" on the matching rows
    And no row renders the agent support tier values "1" or "2" in that column
    And the footer counts usable and missing executors without naming a support tier

  @core
  Scenario: R2 — Each executor row names its underlying agent binary and pinned model
    Given an executor "omp-dsv4-flash-volc" with agent "omp" and model "volc/deepseek-v4-flash-ga-260731"
    When the operator runs "spur agent doctor"
    Then that row's AGENT column reads "omp"
    And that row's MODEL column reads "volc/deepseek-v4-flash-ga-260731"
    And the MODEL column never reads "unknown" for an executor whose config declares a model

  @core
  Scenario: R3 — Each executor row lists the roles it can serve and stars the roles that elect it
    Given roles scribe=cheap, coder=standard, reviewer=capable-1 and planner=capable-2
    And a usable cheap executor "minimax" and a usable capable-2 executor "grok"
    When the operator runs "spur agent doctor"
    Then the "minimax" row's ROLES column lists "scribe" only
    And the "grok" row's ROLES column lists "scribe", "coder", "reviewer" and "planner"
    And exactly one executor row carries the elected marker for each role that has a usable executor

  @core
  Scenario: R4 — A role selector renders the full eligible ladder, not just the elected executor
    Given twelve executors are eligible for role "coder" and the cheapest usable one is "omp-dsv4-flash-volc"
    When the operator runs "spur agent doctor coder"
    Then all twelve eligible executors are listed in cheapest-eligible-first order
    And "omp-dsv4-flash-volc" is marked as elected
    And each non-usable row states why it is not runnable
    And the summary line reports the eligible count, the usable count and the elected executor

  @core
  Scenario: R5 — A role selector with no usable executor reports the whole tried ladder
    Given role "planner" has three eligible executors and none of them is runnable
    When the operator runs "spur agent doctor planner"
    Then all three executors are listed with their individual failure reasons
    And the command exits non-zero
    And the message names every executor that was tried

  @core
  Scenario: R6 — No authentication field appears anywhere in the doctor output
    Given a config with fifteen executors across five agent binaries
    When the operator runs "spur agent doctor"
    Then the table contains no auth column
    And when the operator runs "spur agent doctor omp-zai"
    Then the detail view contains no auth line
    And when the operator runs "spur agent doctor --json"
    Then no agents entry carries an "authenticated" key

  @core
  Scenario: R7 — Removing the auth signal removes the classifier that existed to neutralize it
    Given the doctor payload no longer carries an authentication field
    When the "doctor.probe" workflow action probes a resolved executor
    Then it classifies the executor on usability alone
    And the relay-family, env-miss and auth-failure pattern classifiers are gone from the action
    And no probe outcome is decided by an authentication value

  @core
  Scenario: R8 — The doctor path spawns no authentication probe
    Given a config with fifteen executors across five agent binaries
    When the operator runs "spur agent doctor"
    Then no authentication probe subprocess is spawned for any executor
    And no local agent credential file is read for authentication
    And the command completes faster than a run that performs per-executor auth probing

  @core
  Scenario: R9 — Model health probing is opt-in
    Given a provider API key is present in the environment for a configured executor's provider
    When the operator runs "spur agent doctor" without "--probe-health"
    Then no model health request is issued to any provider
    And when the operator runs "spur agent doctor --probe-health"
    Then the model health status is probed and reported for that executor

  @core
  Scenario: R10 — Detection results are cached and the cache is visibly dated
    Given no cache file exists at ".spur/run/agent-doctor.json"
    When the operator runs "spur agent doctor"
    Then detection runs and the result is written to ".spur/run/agent-doctor.json"
    And when the operator runs "spur agent doctor" again inside the cache TTL
    Then detection does not re-run
    And the output states that the result came from cache and how old it is

  @core
  Scenario: R11 — --force-refresh bypasses the cache and rewrites it
    Given a fresh cache file exists at ".spur/run/agent-doctor.json"
    When the operator runs "spur agent doctor --force-refresh"
    Then detection re-runs for every executor
    And the cache file is rewritten with the new result
    And the output is not marked as coming from cache

  @core
  Scenario: R12 — The --json payload carries the routing fields the text view shows
    When the operator runs "spur agent doctor --json"
    Then each agents entry carries "capabilityTier", "model", "roles" and "elected"
    And when the operator runs "spur agent doctor coder --json"
    Then "agents[0]" is the elected executor for role "coder"
    And the remaining entries are the rest of the eligible ladder in resolution order

  @core
  Scenario: R13 — Role resolution semantics are unchanged by the rendering work
    Given role "coder" resolves to executor "omp-dsv4-flash-volc" before this feature
    When an agent dispatch selects role "coder" after this feature
    Then it dispatches to "omp-dsv4-flash-volc"
    And resolveRole still returns exactly one executor
    And TeamService materialization still selects the first eligible executor for a role-only member

  @edge
  Scenario: R14 — A corrupt or unreadable cache file degrades to a live run
    Given ".spur/run/agent-doctor.json" contains malformed JSON
    When the operator runs "spur agent doctor"
    Then detection runs live
    And the command succeeds
    And the cache file is rewritten with the valid result

  @edge
  Scenario: R15 — An executor with no declared model renders a placeholder, not a fabricated value
    Given an executor entry that declares no model
    When the operator runs "spur agent doctor"
    Then that row's MODEL column renders the em-dash placeholder
    And the "--json" entry's "model" field is null
```

## Tasks

<!-- AUTO-GENERATED by spur feature refresh -->
| WBS | Task | Status |
| --- | ---- | ------ |
| 0681 | Render the agent doctor as a routing inspection surface: capability tier, executor/agent/model/roles columns, and the full role ladder | done |
| 0682 | Remove the authentication signal from the doctor surface and collapse the doctor.probe classifier that existed to neutralize it | done |
| 0683 | Make model health probing opt-in and cache doctor detection with a dated cache and --force-refresh | done |
| 0684 | Add a probeAuth option to ts-ai-runner DoctorRunner and wire Spur to stop spawning per-executor auth probes | done |
<!-- END AUTO-GENERATED -->

## Notes

## History

- 2026-08-26T22:37:26.838Z backlog → active (system)
- 2026-08-26T22:37:27.062Z active → verifying (system)
- 2026-08-26T22:42:03.976Z verifying → done (system)
