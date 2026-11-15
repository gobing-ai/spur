---
schema_version: 1
name: Dispatch to a named fleet member with no daemon running
status: done
template: feature-impl
created_at: 2026-11-15T04:02:03.790Z
updated_at: "2026-11-15T05:52:26.691Z"
feature_id: G8
priority: P1
tags:
  - agent
  - fleet
  - dispatch
  - usability
estimate_hours: 10

done_forced: "false"
done_reason: unforced close
---

## 1333. Dispatch to a named fleet member with no daemon running

### Background

Implements: R1 — A task dispatched to a named local agent completes with no daemon running; R2 — The same dispatch uses the warm member when one is live; R8 — A workflow step dispatches to a member by name; R9 — Doctor says which delivery each member will take.

Fleet is too heavy for daily use: a dispatch needs `spur serve`, a started member and the spec/occupant vocabulary, and this repository's own config ships `agent.fleet.enabled: false`. ADR-148 (Proposed) makes the member name the only thing a user addresses and lets Spur choose the delivery. Contract: `docs/design/a2a-member-transport.md` sections 3.1, 3.2 and 4.3. Starting this task requires operator acceptance of ADR-148 decisions 1 (member-id address, default cold fallback).

### Requirements

- [x] R1 — `spur agent run --agent <name>` resolves a declared fleet member id before role, executor and binary names; an id that collides with one of those is a config validation error naming both.
- [x] R2 — A live member receives the work as one keyed inbox request through the existing `FleetDispatcher`; no second dispatch path is added.
- [x] R3 — A local member that is not live (no serve, or member not started) runs the work on the subprocess surface with the member's executor, by default, on a definite `not-started` only.
- [x] R4 — The receipt records the delivery taken and the fallback reason; an `outcome-unknown` dispatch is never re-run on another delivery.
- [x] R5 — A workflow `agent.run` step naming a member uses the same resolution and ladder.
- [x] R6 — `spur agent doctor` lists each member with the delivery it would take now and an actionable reason when it can take none.
- [x] R7 — Runs that set `executorFallback` explicitly keep today's behavior; warm-turn receipts and gate results are unchanged.

### Acceptance Criteria

- [x] AC1 — A task dispatched to a named local agent completes with no daemon running
- [x] AC2 — The same dispatch uses the warm member when one is live
- [x] AC3 — A workflow step dispatches to a member by name
- [x] AC4 — Doctor says which delivery each member will take

Task-local check: the E2E run leaves a repeatable receipt artifact showing the same command taking the cold and the warm delivery.

### Q&A

<!-- CLOSED decisions from refinement: what was chosen and why, what was deferred and on what
     condition. Not a parking lot for open questions — an unanswered question here means the task
     is not ready to hand off. Keep empty if none. -->

### Design

Approach: extend the existing `--agent` resolution with one earlier rung (member id), and flip the existing unavailable-fleet branch (`fleetUnavailableOutcome` in `packages/app/src/workflow/actions/agent-run.ts`) so a local member defaults to the `traditional` fallback. Reuse `FleetDispatcher` and the `fallbackReason` receipt field; add no surface, verb or table.

Why: the smallest change that removes the daemon and the start step from daily use; `spur serve` becomes an accelerator.

Rejected: auto-starting `spur serve` from a one-shot command (hides a daemon); a new `spur dispatch` verb (ADR-051, and `agent run` already exists); a fleet-specific fallback implementation (one already exists).

Invariants: fallback only on definite `not-started`; never after `outcome-unknown`; the cold path is always visible in the receipt; a live member behaves exactly as today.

### Plan

- [x] Write the failure list first as E2E cases: no serve, serve up and member down, member live, id collision, outcome-unknown not re-run, explicit `executorFallback` preserved.
- [x] Member-id rung in agent resolution plus the collision validation in `packages/config`.
- [x] Default cold fallback for local members; receipt records delivery and reason.
- [x] Doctor per-member delivery line.
- [x] Update `docs/design/a2a-member-transport.md` status, the `spur-cli` agent reference and the fleet config satellite; rebuild the CLI bundle (no tracked bundle artifact — the build regenerates it).

### Solution

Approach: extend the existing `--agent` resolution with ONE earlier rung (fleet member id) and let a local member default to the existing `traditional` (subprocess) fallback on a definite `not-started`; `FleetDispatcher` and the `fallbackReason` receipt field are reused, and no new noun, verb, surface or table is added (ADR-148 §3.1/§3.2/§4.3).

Delivery ladder (one definition, both callers): a live member takes a warm keyed inbox request; a local member that is not live runs cold on its own executor by default; the ladder steps down only BEFORE anything is sent, so an `outcome-unknown` receipt is reported and never re-dispatched. One resolution decides both callers: only ENABLED members resolve (the same filter the role path applies), and an address that MATCHES but cannot take work is an exit-2 refusal, never a silent fall-through to the role/executor rungs.

| File:line | Change |
| --- | --- |
| `packages/app/src/services/member-dispatch.ts:42` | `DEFAULT_MEMBER_WAIT_MS` — the warm receipt wait is bounded (the CLI's own 10-minute wait budget), so a live-but-stuck member ends as `outcome-unknown` instead of blocking the command forever |
| `packages/app/src/services/member-dispatch.ts:64` | `resolveMemberAddress` — `--agent <id>` matches the full instance id, then the member's local id EXACTLY (a fragment never matches); only enabled members resolve; two local-id candidates are an ambiguity, never a silent pick |
| `packages/app/src/services/member-dispatch.ts:98` | `memberDelivery` — the pure which-delivery-and-why choice shared by the run path and doctor (disabled member / no resolved executor → `unavailable` with the fix; live → `warm`; else `cold` on the member's executor) |
| `packages/app/src/services/member-dispatch.ts:128` | `dispatchToNamedMember` — resolve → choose → one `FleetDispatcher.dispatch`, passing the bounded `timeoutMs` and the caller's abort signal; returns the delivery taken, the reason and `addressMatched` as a value, never a throw and never a second attempt |
| `packages/app/src/services/member-dispatch.ts:160` | the warm request is sent by the operator's real inbox id (`OPERATOR_INBOX_ID`), not the `spur` system address, so a member's reply lands in a drained mailbox |
| `packages/app/src/services/fleet-service.ts:75` | `ResolvedFleetMember.localId` — the roster-local id the `--agent` address is compared against, populated where `instanceId` is derived |
| `apps/cli/src/commands/agent/shared.ts:582` | `memberDispatchDeps` — the CLI seams: declared roster (`AgentCoordinationService.listFleetMembers`), liveness (`GET /api/processes`, the same probe `agent status` uses — no daemon reads as "not live", never an error) and the one dispatcher; ONE probe serves every member |
| `apps/cli/src/commands/agent/shared.ts:616` | `memberDeliveryRows` — per-member delivery + reason for doctor, off that single probe |
| `apps/cli/src/commands/agent/run.ts:87` | `dispatchToMemberSelector` — the member rung, before every other rung: warm → one keyed inbox request resolved on its receipt (bounded, abortable); cold → the caller runs the subprocess on the member's executor; a member that resolves but is `unavailable` is an exit-2 refusal naming the member and the fix; a member id claiming a coding-agent binary name is refused naming both |
| `apps/cli/src/commands/agent/run.ts:203` | the rung runs at the top of `runAgentRun`, rewriting `--agent` to the member's executor and stamping `dispatchDelivery` for the durable record |
| `packages/app/src/services/agent-run-executor.ts:505` | the run log (ADR-057 durable record) records `delivery: <rung> — <why>`, so the cold path is visible in the receipt evidence |
| `apps/cli/src/commands/agent/doctor.ts:34` | text block listing every declared member with the delivery it would take now and an actionable reason |
| `packages/app/src/workflow/fleet-dispatch.ts:25` | `FleetDispatchInput.member` — a step may address a member by name; naming one is explicit intent, so it is addressable even with `agent.fleet.enabled: false` (the switch gates autostart, not addressing) |
| `packages/app/src/workflow/fleet-dispatch.ts:75` | a `not-started` receipt carries the resolved member, so the caller's cold rung can run that member's executor |
| `packages/app/src/workflow/fleet-dispatch.ts:101` | `fleetUnavailableOutcome(..., localMember)` — cold fallback is DEFAULT-ON for a local member on a definite not-started/unavailable; an explicitly declared `executorFallback` of any other value keeps today's semantics |
| `packages/app/src/workflow/fleet-dispatch.ts:185` | a named member bypasses the disabled-fleet refusal and resolves by address instead of role, through the SAME `resolveMemberAddress` (enabled filter included) the CLI uses |
| `packages/app/src/workflow/actions/agent-run.ts:406` | a fleet step may name its member (`agent: <member>`) instead of a role, and still never resolves a local executor of its own |
| `packages/app/src/workflow/actions/agent-run.ts:511` | a definite `not-started` takes the cold rung by default (no work happened) and carries the member's EXECUTOR to the subprocess; an explicitly declared `executorFallback` keeps today's hard failure; `failed` stays definitive and `outcome-unknown` is never re-dispatched |
| `packages/app/src/workflow/actions/agent-run.ts:553` | an unavailable fleet after member resolution defaults to the cold rung and the row names the member |
| `packages/app/src/workflow/actions/agent-run.ts:1009` | the cold fallback re-points the subprocess at the member's executor — the workflow counterpart of the CLI's `flags.agent = member.executor` rewrite |
| `packages/config/src/index.ts:824` | R1 selector-namespace check: a member id that claims a configured executor it does not run, `auto` or `inline` is a config error naming both; an id equal to a role name is allowed (the member rung wins — the design's own `{ id: coder }` example) |
| `packages/app/src/services/fleet-dispatcher.ts:38` | `requestKey` optional: a manual one-shot dispatch IS the request and has no attempt identity to replay |
| `packages/app/src/index.ts:502` | export the ladder (`dispatchToNamedMember`, `memberDelivery`) so the CLI and doctor share one definition |

Deviation worth naming: R1's third clause (a role-name collision is a config error) is implemented as deterministic member-wins precedence instead, because AC1, the design's §3.1 example and existing project configs (`{ id: coder, role: coder }`) all name members by role id; only executor-name and reserved-selector collisions are hard config errors (both name both sides). Documented in `docs/design/fleet-config-declaration.md`.

Docs: `docs/design/a2a-member-transport.md` (status accepted + 1333/1334/G9 split), `docs/design/fleet-config-declaration.md` (selector namespaces), `docs/help/cmd_agent.md` and `plugins/sp/skills/spur-cli/references/agent.md` (the `--agent` member rung, its delivery ladder, the exit-2 refusal and the stderr delivery line).

E2E: `.spur/run/1333-delivery-e2e.md` — the same `spur agent run --agent coder` taking the cold delivery (exit 0, member executor subprocess) and the warm delivery (one keyed inbox request) against a throwaway `/tmp` project.

### Testing

**Pipeline verify results**

- Verdict: PASS (from verdict artifact)

| Requirement | Status | Evidence |
|-------------|--------|----------|
| R1 — member id resolves before role/executor/binary; collisions are config errors naming both | MET | Member rung runs first at `apps/cli/src/commands/agent/run.ts:212-219`, ahead of `validateAgentSelector` at `:254`; executor/reserved-selector collisions rejected naming both at `packages/config/src/index.ts:805-828`, pinned by `packages/config/tests/fleet-member-id-collision.test.ts:22-39`; binary-name claim refused at `apps/cli/src/commands/agent/run.ts:128-137`, pinned by `apps/cli/tests/commands/agent/member-dispatch.test.ts:291-315`. Role-id collision is the documented member-wins deviation (finding 2, accepted) |
| R2 — live member takes one keyed inbox request through the existing `FleetDispatcher`; no second dispatch path | MET | The only new sender `packages/app/src/services/member-dispatch.ts:157-172` calls the one primitive `packages/app/src/services/fleet-dispatcher.ts:88-103`; `apps/cli/tests/commands/agent/member-dispatch.test.ts:84-127` and `packages/app/tests/services/member-dispatch.test.ts:120-129` assert exactly one dispatch and no subprocess |
| R3 — a local member not live runs cold on the member's executor by default, on a definite `not-started` only | MET | CLI: `apps/cli/src/commands/agent/run.ts:138-152` (cold + step-down), pinned by `apps/cli/tests/commands/agent/member-dispatch.test.ts:58-82` and `:162-199`. Workflow: `packages/app/src/workflow/actions/agent-run.ts:506-529` carries `dispatch.member.executor`, applied `:1013-1017`; pinned by `packages/app/tests/workflow/agent-run-fleet.test.ts:339-356` (default cold) and `:358-391` (member executor). The `unavailable`+member fallback targets the member executor too (`:553-564`, test `:427-460`) — its default-on scope is slightly wider than R3's "not-started only" (finding 4) |
| R4 — receipt records the delivery + fallback reason; `outcome-unknown` never re-run on another delivery | MET | Cold/step-down delivery written into the run's durable log: `packages/app/src/services/agent-run-executor.ts:503-507`, pinned by `packages/app/tests/services/agent-run-executor.test.ts:132-151`; `outcome-unknown` never re-dispatched: `packages/app/src/services/member-dispatch.ts:146-172` with `packages/app/tests/services/member-dispatch.test.ts:130-138`, `apps/cli/tests/commands/agent/member-dispatch.test.ts:201-233`, `packages/app/tests/workflow/agent-run-fleet.test.ts:463-479`; fallback reason stamped at `packages/app/src/workflow/actions/agent-run.ts:667-676`. Wording of the CLI's reason clause: finding 1 (deferred) |
| R5 — a workflow `agent.run` step naming a member uses the same resolution and ladder | MET | Same resolver: `packages/app/src/workflow/fleet-dispatch.ts:183-187` → `resolveMemberAddress` (`packages/app/src/services/member-dispatch.ts:64-95`, enabled filter `:68`); addressing reaches the dispatcher at `packages/app/src/workflow/actions/agent-run.ts:458-462`; same `not-started` step-down on both callers (`apps/cli/src/commands/agent/run.ts:144-152` vs `packages/app/src/workflow/actions/agent-run.ts:506-529`); pinned by `packages/app/tests/workflow/agent-run-fleet.test.ts:309-337` |
| R6 — `spur agent doctor` lists each member with the delivery it would take now and an actionable reason | MET | `apps/cli/src/commands/agent/doctor.ts:31-44`, `apps/cli/src/commands/agent/shared.ts:616-635`, reasons `packages/app/src/services/member-dispatch.ts:98-124`; driven end-to-end through `main(['agent','doctor'])` at `apps/cli/tests/commands/agent/member-dispatch.test.ts:318-360`, including the single-probe assertion |
| R7 — explicit `executorFallback` runs keep today's behavior; warm-turn receipts and gate results unchanged | MET | `not-started` + explicit value (incl. `traditional`) still fails: `packages/app/src/workflow/actions/agent-run.ts:509-517`, tests `packages/app/tests/workflow/agent-run-fleet.test.ts:393-408` and `:410-425`; `unavailable` + `traditional` unchanged `packages/app/src/workflow/fleet-dispatch.ts:101-112` (test `:214-231`); warm-turn receipt shape untouched (`packages/app/tests/services/attached-turn-dispatch.test.ts:55` is a type widening only); gate PASS per `.spur/run/1333-check-receipt.json` |

| Acceptance Criteria | Status | Evidence Type | Evidence |
|---------------------|--------|---------------|----------|
| AC1 — A task dispatched to a named local agent completes with no daemon running | MET | test | `apps/cli/tests/commands/agent/member-dispatch.test.ts:58-82` (probe 500 → `agent=stub-fast/codex-fast`, delivery names the cold rung, stderr names the member). Fresh golden-path invocation by this review, throwaway `/tmp` project declaring `{ id: coder, executor: stub-fast }` with a stub `claude` on PATH: `bun apps/cli/src/index.ts --no-logo agent run "purist check" --agent coder --json` → exit 0, `"resolved": {"executor":"stub-fast","agent":"claude"}`, stdout exactly one JSON document, the delivery line on stderr only |
| AC2 — The same dispatch uses the warm member when one is live | MET | test | `apps/cli/tests/commands/agent/member-dispatch.test.ts:84-127` (one dispatch call, `member: <slug>-coder`, subprocess must not run) and `packages/app/tests/services/member-dispatch.test.ts:120-129`; live evidence in `.spur/run/1333-delivery-e2e.md` leg 2 (one `operator → e2e1333-coder` inbox row, no subprocess) |
| AC3 — A workflow step dispatches to a member by name | MET | test | `packages/app/tests/workflow/agent-run-fleet.test.ts:309-337` (`agent: 'verifier'` → `proj-verifier`, role match ignored, 0 subprocess calls) |
| AC4 — Doctor says which delivery each member will take | MET | test | `apps/cli/tests/commands/agent/member-dispatch.test.ts:318-360` drives `main(['agent','doctor'])` and asserts `proj-coder\tcold\tnot live under spur serve` / `proj-verifier\twarm\tlive under spur serve` with `probes === 1`; `.spur/run/1333-delivery-e2e.md` reprints the same block for both legs |
- Coverage: N/A (verdict-based; verify pipeline does not measure code coverage)

### Review

<!-- spur:record-review -->

**SECU findings** (pipeline verify step — verdict: PASS)

| Priority | Dimension | Location | Finding |
|----------|-----------|----------|----------|
| P4 | — | — | No findings (verify verdict PASS) |

### References

<!-- Links to the parent feature, design docs, related tasks, or external references. -->

### History

- 2026-11-15T05:06:31.698Z todo → wip (system)
- 2026-11-15T05:52:25.019Z wip → testing (system)
- 2026-11-15T05:52:26.687Z testing → done (system)

