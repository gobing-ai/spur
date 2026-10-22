---
schema_version: 1
name: ts-ai-runner correlated warm-turn session facade (upstream release)
status: todo
template: feature-impl
created_at: 2026-10-22T16:13:43.551Z
updated_at: "2026-10-22T16:26:37.914Z"
feature_id: G74

ac_altitude: task-local
ac_numbering: task-local
priority: P1
estimate_hours: 10
---

## 1284. ts-ai-runner correlated warm-turn session facade (upstream release)

### Background

**Origin.** Refine audit of G74 (2026-10-22) found the prerequisite of task 1275 absent: installed `@gobing-ai/ts-ai-runner@0.5.33` (identical to `/Users/robin/xprojects/ts-libs/packages/ai-runner` at 0.5.33, HEAD `48a62bfe`) has **no correlated turn facade**.

Evidence (ts-libs `packages/ai-runner`):
- `src/team-agent-process.ts:122` — `TeamAgentProcess.send()` only writes stdin and returns `{ok}`; acceptance ≠ completion.
- `src/agents/shims.ts:175` (`claudeStreamJsonFrame`), `:248`/`:374` (`piRpcFrame`) — `persistentStdinProtocol` carries **input framing only**; no output terminal parsing.
- `src/agents/shims.ts:533` `AGENT_SESSION_CAPABILITY` — codex `supportsPersistentStdin: false`; no Codex App Server support anywhere.
- `src/ai-runner.ts:56` `AgentRunCorrelation{runId, executionId, actionId?}` — env + event correlation for one-shot runs only.

Design authority: `docs/design/fleet-task-turn-execution.md` §4–5, ADR-145 — "ts-ai-runner owns process/protocol mechanics; Spur owns policy, receipts and validation."

**Authorization.** Robin (2026-10-22): "Edit ts-libs, you release" — implementation in `/Users/robin/xprojects/ts-libs` is authorized; **publishing/tagging is Robin's** (ts-libs `packages/ai-runner/package.json` `release` script: tag push → GitHub Actions trusted publishing). Supersedes design §5 "do not edit ts-libs without separate authorization".

Rubric: E8 D1 L2 C2 R2 = 15 → own task; it is the upstream half of 1275 and the base for drivers in 1276–1278.

### Requirements

- [ ] R1. ts-ai-runner exports a turn-session facade: `AiRunner.openTurnSession(agent, options)` returns either an open `TurnSession` or a typed refusal (`unsupported-agent` | `unqualified-version` | `spawn-failed` | `handshake-failed`) with detail; it never throws for an expected refusal.
- [ ] R2. `TurnSession.startTurn(input)` returns a `TurnHandle` whose `accepted` and `outcome` promises are separate; `outcome` resolves exactly once to one of `success` | `failure` | `interrupted` | `not-started` | `outcome-unknown` | `contract-violation`, carrying the caller's correlation (`runId`, `executionId`, `requestId`, `attempt`) and native session/turn ids only when the driver observed them.
- [ ] R3. A session admits one active turn: `startTurn` while busy rejects with `TurnSessionBusyError` (no hidden queue); events from another or an already-terminal turn are emitted as `diagnostic` and never change an outcome.
- [ ] R4. Process exit, handshake loss or cancel-grace expiry resolve deterministically: before acceptance → `not-started`; after acceptance without native terminal → `outcome-unknown`; `cancel()` awaits native terminal evidence up to a grace bound before `outcome-unknown`.
- [ ] R5. Drivers are per-agent behind one `TurnSessionDriver` contract and a built-in registry; 0.x ships the contract with no real-agent driver registered (claude/pi/codex land in 1276–1278) and a `./testing` subpath export with a fake driver that runs a real child process speaking a scripted JSONL protocol.
- [ ] R6. The package version bumps (minor, `0.6.0`), CHANGELOG records the API, ts-libs `bun run spur-check` is green, and a release-ready handoff note names the tag for Robin; no publish/tag by the implementer.

### Acceptance Criteria

```gherkin
Scenario: AC1 — A refused open is typed, never thrown (req: R1, R5)
  Given an agent with no registered turn driver, and a fake driver whose qualify() rejects the version
  When openTurnSession is called for each
  Then the results are `{ok:false, reason:'unsupported-agent'}` and `{ok:false, reason:'unqualified-version', detail}` and no process was spawned

Scenario: AC2 — Acceptance and terminal outcome are separate and correlated (req: R2)
  Given an open session over the fake child driver scripted to accept, stream output, then emit a success terminal
  When startTurn runs with correlation {runId, executionId, requestId, attempt:1}
  Then `accepted` resolves before `outcome`, and `outcome` is `success` with the same correlation and the driver-reported native turn id

Scenario: AC3 — One active turn; foreign and late events are diagnostic (req: R3)
  Given a busy session
  When a second startTurn is called and the child emits a terminal for an unknown turn id and a duplicate terminal after completion
  Then the second call rejects with TurnSessionBusyError and both stray terminals surface only as `diagnostic` events

Scenario: AC4 — Crashes and cancels resolve deterministically (req: R4)
  Given scripted children that exit before acceptance, exit after acceptance, and ignore cancel
  When each turn settles
  Then the outcomes are `not-started`, `outcome-unknown`, and `outcome-unknown` after the cancel grace, and a child that answers cancel yields `interrupted`

Scenario: AC5 — Release-ready without publishing (req: R6)
  Given the change set in ts-libs
  When `bun run spur-check` runs at the ts-libs root
  Then it passes, package.json reads 0.6.0, CHANGELOG lists the facade, and no git tag was created by the implementer
```

### Q&A

<!-- CLOSED decisions from refinement: what was chosen and why, what was deferred and on what
     condition. Not a parking lot for open questions — an unanswered question here means the task
     is not ready to hand off. Keep empty if none. -->

#### Q&A entry — 2026-10-22T16:18:40.262Z

- **Q: Who releases?** CLOSED — implementer edits ts-libs and stops at a green, committed, untagged tree; Robin tags `@gobing-ai/ts-ai-runner-v0.6.0`. Spur's catalog bump happens in 1275 step 0, after the release exists on npm.
- **Q: Queue turns inside the session?** CLOSED — no. Busy is an error; Spur's MemberSession/keyed drain already serializes. A hidden queue would hide acceptance timing from receipts.
- **Q: Extend `TeamAgentProcess` or add a new module?** CLOSED — new module `src/turn-session.ts`. `TeamAgentProcess` is a fire-and-forget team transport with other callers; changing its `send()` contract is a breaking change.
- **Q: Validate artifacts in the runner?** CLOSED — no. `success` means "native terminal success"; Spur's action contract stays the sole success authority (ADR-145). `contract-violation` is reserved for protocol violations the driver detects (malformed terminal, wrong correlation echo).
- **Q: Real-agent drivers here?** CLOSED — no; each lands with its qualification evidence in 1276 (claude), 1277 (pi), 1278 (codex). Deferred condition: none.

### Design

**Repo / files (ts-libs `packages/ai-runner`):**
- `src/turn-session.ts` (new) — types, `TURN_SESSION_DRIVERS` registry, session state machine; exported from `src/index.ts`.
- `src/ai-runner.ts` — add `openTurnSession()` method on `AiRunner` (reuse its agent resolution/spawn env helpers; no duplicate spawn code).
- `src/testing/fake-turn-driver.ts` (new) + `package.json` `exports["./testing"]` — `createFakeTurnSessionDriver(script)`; spawns `bun src/testing/fake-turn-agent.ts` (a real child) that replays a JSONL script.
- `tests/turn-session.test.ts` (new) — E2E over the real child process (process boundary crossed).

**Frozen types:**
```ts
export type TurnOutcomeKind = 'success' | 'failure' | 'interrupted' | 'not-started' | 'outcome-unknown' | 'contract-violation';
export interface TurnCorrelation extends AgentRunCorrelation { requestId: string; attempt: number }
export interface TurnSessionPolicy { workspace: string; role: string; model?: string; provider?: string; reasoning?: string; tools?: readonly string[]; permissions?: string }
export interface TurnOutcome { kind: TurnOutcomeKind; turnId: string; correlation: TurnCorrelation; nativeSessionId?: string; nativeTurnId?: string; reason?: string; finalText?: string; startedAt: string; acceptedAt?: string; firstOutputAt?: string; terminalAt: string }
export type TurnEvent = { type: 'accepted' | 'output' | 'diagnostic' | 'terminal'; turnId: string; at: string; data?: unknown };
export interface TurnHandle { turnId: string; accepted: Promise<{ acceptedAt: string } | null>; outcome: Promise<TurnOutcome>; events: AsyncIterable<TurnEvent>; cancel(reason: string): Promise<TurnOutcome> }
export interface TurnSession { readonly agent: AgentName; readonly policyDigest: string; readonly nativeSessionId?: string; readonly state: 'ready' | 'busy' | 'closed'; startTurn(input: { prompt: string; correlation: TurnCorrelation; timeoutMs?: number; signal?: AbortSignal }): TurnHandle; close(): Promise<void> }
export interface TurnSessionDriver { agent: AgentName; qualify(binary: { path: string; version: string | null }): { qualified: true } | { qualified: false; reason: string }; /* spawn argv, handshake, encodeTurn, decode(line) → TurnEvent[], encodeCancel */ }
export type OpenTurnSessionResult = { ok: true; session: TurnSession } | { ok: false; reason: 'unsupported-agent' | 'unqualified-version' | 'spawn-failed' | 'handshake-failed'; detail: string };
```
`policyDigest` = sha256 of the canonical-JSON `TurnSessionPolicy` (stable key order) — Spur compares digests for reuse eligibility.
Constants: `TURN_CANCEL_GRACE_MS = 5_000` (exported; overridable per call for tests).

**Invariants:** exactly one terminal per turn; outcome never upgraded after resolution; decoding is line-buffered with a bounded buffer (1 MiB → `contract-violation` on overflow); no Spur types or paths; no new runtime dependency.
**Anti-patterns:** do not change `TeamAgentProcess.send()`; do not infer completion from process exit or silence; do not register real-agent drivers without a recorded `verifiedAgainst`.
**Handoff to 1275:** Spur consumes only `openTurnSession`, `TurnSession`, `TurnHandle`, `TurnOutcome`, and `./testing` in tests.

### Plan

1. Write the failure list first as test names in `tests/turn-session.test.ts` (no implementation yet): unsupported agent; unqualified version; spawn failure; handshake timeout; exit before accept; exit after accept; duplicate terminal; foreign turn id; busy startTurn; cancel answered; cancel ignored past grace; buffer overflow; close while busy.
2. Implement the fake child (`src/testing/fake-turn-agent.ts`) and `createFakeTurnSessionDriver`.
3. Implement `src/turn-session.ts` + `AiRunner.openTurnSession`; export from `src/index.ts`; add `./testing` export.
4. Make every failure test pass over the real child process.
5. Bump `packages/ai-runner/package.json` to `0.6.0`; CHANGELOG entry; README section (API sketch only).
6. ts-libs gate: `bun run spur-check` at `/Users/robin/xprojects/ts-libs` root (lint + rules + tests). Commit `feat(ai-runner): add correlated turn-session facade`.
7. Handoff: write the release note in Solution (tag `@gobing-ai/ts-ai-runner-v0.6.0`, commit SHA); **do not tag or publish** — Robin releases.

### Solution

<!-- Filled during implementation: file:line change map and concise rationale. -->

### Testing

<!-- Filled during verification: commands run, outcomes, coverage claim or N/A. -->

### Review

<!-- Filled during review: P1-P4 findings, residual risk, and final disposition. -->

### References

- Feature: `docs/features/G74_*.md` (R6–R8 via 1275).
- Design: `docs/design/fleet-task-turn-execution.md` §4–5; ADR-145 in `docs/00_ADR.md`.
- Consumer: task 1275 (Spur seam); drivers: 1276, 1277, 1278.
- ts-libs anchors: `packages/ai-runner/src/team-agent-process.ts:122`, `src/agents/shims.ts:175,248,374,533`, `src/ai-runner.ts:56`.
- ts-libs gates: root `package.json` `spur-check`; release flow: `packages/ai-runner/package.json` `release` script (tag push only).

### History

- 2026-10-22T16:26:37.914Z backlog → todo (system)

