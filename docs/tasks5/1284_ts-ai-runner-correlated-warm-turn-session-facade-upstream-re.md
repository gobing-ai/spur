---
schema_version: 1
name: ts-ai-runner correlated warm-turn session facade (upstream release)
status: done
template: feature-impl
created_at: 2026-10-22T16:13:43.551Z
updated_at: "2026-10-25T03:36:13.420Z"
feature_id: G74

ac_altitude: task-local
ac_numbering: task-local
priority: P1
estimate_hours: 10
done_forced: "true"
done_reason: "Behavior-bearing test citations resolve in the external ts-libs repo @ 0.6.0 (packages/ai-runner/tests/turn-session.test.ts 16/16, tests/testing 6/6 + 5/5, full gate exit 0) — outside this repo's tree by design (upstream-release task); verified in the task Testing section"
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

- [x] R1. ts-ai-runner exports a turn-session facade: `AiRunner.openTurnSession(agent, options)` returns either an open `TurnSession` or a typed refusal (`unsupported-agent` | `unqualified-version` | `spawn-failed` | `handshake-failed`) with detail; it never throws for an expected refusal.
- [x] R2. `TurnSession.startTurn(input)` returns a `TurnHandle` whose `accepted` and `outcome` promises are separate; `outcome` resolves exactly once to one of `success` | `failure` | `interrupted` | `not-started` | `outcome-unknown` | `contract-violation`, carrying the caller's correlation (`runId`, `executionId`, `requestId`, `attempt`) and native session/turn ids only when the driver observed them.
- [x] R3. A session admits one active turn: `startTurn` while busy rejects with `TurnSessionBusyError` (no hidden queue); events from another or an already-terminal turn are emitted as `diagnostic` and never change an outcome.
- [x] R4. Process exit, handshake loss or cancel-grace expiry resolve deterministically: before acceptance → `not-started`; after acceptance without native terminal → `outcome-unknown`; `cancel()` awaits native terminal evidence up to a grace bound before `outcome-unknown`.
- [x] R5. Drivers are per-agent behind one `TurnSessionDriver` contract and a built-in registry; 0.x ships the contract with no real-agent driver registered (claude/pi/codex land in 1276–1278) and a `./testing` subpath export with a fake driver that runs a real child process speaking a scripted JSONL protocol.
- [x] R6. The package version bumps (minor, `0.6.0`), CHANGELOG records the API, ts-libs `bun run spur-check` is green, and a release-ready handoff note names the tag for Robin; no publish/tag by the implementer.

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

<!-- ts-libs @ ca234528 (feat fa1f8702, test 4287a609, release ca234528). Upstream repo: /Users/robin/xprojects/ts-libs. -->

**Change map (ts-libs packages/ai-runner, release 0.6.0):**

- src/turn-session.ts:31 — `TurnWireEvent` wire contract.
- src/turn-session.ts:117 — `TurnProtocolError` (malformed line / overflow).
- src/turn-session.ts:148 — `OpenTurnSessionResult` (typed refusals; never throws).
- src/turn-session.ts:141 — `TurnSessionDriver` (encode/decode + optional `handshake(pull)` closure).
- src/turn-session.ts:157 — `TURN_SESSION_DRIVERS` registry, empty in 0.x by design (contract-only; real claude/pi/codex drivers land in Spur tasks 1276–1278 with `verifiedAgainst` qualification evidence per ADR-145).
- src/turn-session.ts:160,162,164 — constants `TURN_CANCEL_GRACE_MS=5_000`, `TURN_HANDSHAKE_TIMEOUT_MS=10_000`, `TURN_MAX_LINE_BYTES=1MiB`.
- src/turn-session.ts:183 — `turnSessionPolicyDigest` (stable policy fingerprint surfaced in handshake/metadata).
- src/turn-session.ts:205 — `readLines` JSONL reader; throws `TurnProtocolError` on >1MiB lines (caught in the pump → contract violation, not a callback).
- src/turn-session.ts:360 — `TurnSessionImpl`: single-pump JSONL loop; `route()` resolves the active turn with a `lastTurn` fallback so late/duplicate terminals surface as `diagnostic` events instead of being dropped; terminal handler clears `active` and returns the session to `ready`; cancel writes the driver's `encodeCancel` frame and races the child terminal against the grace timer; sleeps wake not clear.
- src/turn-session.ts:546 — `openTurnSessionWithDriver`: typed refusals (`unqualified-version` / `spawn-failed` / `handshake-failed`), handshake timeout, exactly-once settlement (acceptance ≠ completion).
- src/ai-runner.ts:232 — `AiRunner.openTurnSession`; resolves `options.binary` or delegates to resolveTurnBinary.
- src/ai-runner.ts:264 — `resolveTurnBinary` (agent → binary+version); refuses `unsupported-agent` when no driver is registered.
- src/testing/fake-turn-driver.ts:24,44 — `fakeTurnAgentPath` (`.ts`/`.js` sibling via `import.meta.dir` + `/dist/` marker, no `node:fs`) and `createFakeTurnSessionDriver` (JSONL `encodeTurn`/`encodeCancel` are `\n`-terminated; `decode` maps garbage → `TurnProtocolError`); exported via the `./testing` subpath only.
- src/testing/fake-turn-agent.ts — scripted REAL child process (ops `ready|accept|output|terminal|stray|sleep|ignore-cancel|flood|exit`); raw stdout frames ARE the protocol under test (sanctioned rule seam); cancel wakes pending sleeps via a timer→resolver map; exits 0 on stdin EOF/EPIPE.
- src/index.ts + package.json — re-exports and the `./testing` subpath entry.

**Rationale:** acceptance ≠ completion — `TurnHandle.accepted`/`.outcome` are separate promises with exactly-once settlement, never upgraded; determinism: exit before acceptance → `not-started`, after → `outcome-unknown`; framing lives in the driver encoders; handshake takes a `pull(timeoutMs)` closure (an early-return AsyncIterable would close the shared iterator the pump still needs).

**Recovered release proof and current verification (2026-10-24).** The earlier release-evidence PARTIAL is resolved. The original `/tmp/tslibs-gate9.log` was recovered and copied byte-for-byte with SHA-256 into `.spur/run/G74-completion/upstream-original-gate.log:1`: 3153 tests, 0 failures, 63 pre-rules, 6 post-rules and 62/62 rule fixture pairs pass. Fresh inspection of immutable release commit ca234528049059796ca0ca8587c28edea2f533d5 confirms version 0.6.0, the original empty driver registry, the testing subpath and facade changelog. Annotated 0.6.0 release tags were created 2276 seconds after the handoff commit; no tags or publications were created in this pass. The machine-checked provenance is `.spur/run/G74-completion/upstream-release-proof.json:1`.

The current upstream `bun run spur-check` was also run, with no upstream source changes: 3200 tests, 0 failures, both rule gates and 62/62 fixture pairs pass (`.spur/run/G74-completion/upstream-current-gate.log:1`). This complements the 63 published-dist runner/driver tests; it does not mislabel the installed successor release as 0.6.0.

### Testing

**Pipeline verify results**

- Verdict: PASS (from verdict artifact)

| Requirement | Status | Evidence |
|-------------|--------|----------|
| R1 | MET | `node_modules/@gobing-ai/ts-ai-runner/src/turn-session.ts:644`; Fresh copied upstream suites against the installed published dist: 63 pass, 0 fail (18 facade cases plus all three native drivers). Expected unsupported/unqualified/spawn/handshake refusals remain typed values across the real process boundary. Commands: published-dist runner suites 63 pass; current upstream bun run spur-check exit 0, 3200 pass; recovered original release gate and tag chronology asserted in .spur/run/G74-completion/upstream-release-proof.json:1. Re-audit artifact writes: .spur/run/1284-verify-answer.txt:1-42; .spur/run/1284-verdict.json:1-117. Final gate: .spur/run/1273-test-gate.log:599 (11697 pass). |
| R2 | MET | `.spur/run/verifyall-G74-20261024/runner-proof/tests/turn-session.test.ts:158`; Fresh copied upstream suites against the installed published dist: 63 pass, 0 fail (18 facade cases plus all three native drivers). Acceptance precedes terminal outcome, caller correlation survives and native ids are observed rather than invented. Commands: published-dist runner suites 63 pass; current upstream bun run spur-check exit 0, 3200 pass; recovered original release gate and tag chronology asserted in .spur/run/G74-completion/upstream-release-proof.json:1. |
| R3 | MET | `.spur/run/verifyall-G74-20261024/runner-proof/tests/turn-session.test.ts:206`; Fresh copied upstream suites against the installed published dist: 63 pass, 0 fail (18 facade cases plus all three native drivers). Busy admission rejects and foreign/duplicate terminals are diagnostic only. Commands: published-dist runner suites 63 pass; current upstream bun run spur-check exit 0, 3200 pass; recovered original release gate and tag chronology asserted in .spur/run/G74-completion/upstream-release-proof.json:1. |
| R4 | MET | `.spur/run/verifyall-G74-20261024/runner-proof/tests/turn-session.test.ts:254`; Fresh copied upstream suites against the installed published dist: 63 pass, 0 fail (18 facade cases plus all three native drivers). Death before acceptance is not-started; after acceptance and cancel grace expiry are outcome-unknown; native cancel completion is interrupted. Commands: published-dist runner suites 63 pass; current upstream bun run spur-check exit 0, 3200 pass; recovered original release gate and tag chronology asserted in .spur/run/G74-completion/upstream-release-proof.json:1. |
| R5 | MET | `node_modules/@gobing-ai/ts-ai-runner/src/turn-session.ts:644`; Fresh copied upstream suites against the installed published dist: 63 pass, 0 fail (18 facade cases plus all three native drivers). Driver contract and testing subpath remain published. Fresh immutable release inspection confirms the original contract-only registry; later driver registrations are intentional successor work. Commands: published-dist runner suites 63 pass; current upstream bun run spur-check exit 0, 3200 pass; recovered original release gate and tag chronology asserted in .spur/run/G74-completion/upstream-release-proof.json:1. |
| R6 | MET | `node_modules/@gobing-ai/ts-ai-runner/src/turn-session.ts:644`; `.spur/run/G74-completion/upstream-release-proof.json:11`; `.spur/run/G74-completion/upstream-original-gate.log:262`; `.spur/run/G74-completion/upstream-current-gate.log:247`; fresh provenance assertions verify immutable handoff ca234528 at version 0.6.0, the original empty registry/testing export and the facade changelog. The recovered original full gate has 3153 tests, zero failures, both rule gates and 62/62 fixtures passing; current upstream gate has 3200 tests and zero failures with both gates green. Annotated release tags were created 2276 seconds after the handoff commit. This pass created no tags and published nothing. Commands: published-dist runner suites 63 pass; current upstream bun run spur-check exit 0, 3200 pass; recovered original release gate and tag chronology asserted in .spur/run/G74-completion/upstream-release-proof.json:1. |

| Acceptance Criteria | Status | Evidence Type | Evidence |
|---------------------|--------|---------------|----------|
| Scenario: AC1 — A refused open is typed, never thrown (req: R1, R5) | MET | test | `node_modules/@gobing-ai/ts-ai-runner/src/turn-session.ts:644`; Fresh copied upstream suites against the installed published dist: 63 pass, 0 fail (18 facade cases plus all three native drivers). Expected unsupported/unqualified/spawn/handshake refusals remain typed values across the real process boundary. `node_modules/@gobing-ai/ts-ai-runner/src/turn-session.ts:644`; Fresh copied upstream suites against the installed published dist: 63 pass, 0 fail (18 facade cases plus all three native drivers). Driver contract and testing subpath remain published. Fresh immutable release inspection confirms the original contract-only registry; later driver registrations are intentional successor work. Commands: published-dist runner suites 63 pass; current upstream bun run spur-check exit 0, 3200 pass; recovered original release gate and tag chronology asserted in .spur/run/G74-completion/upstream-release-proof.json:1. |
| Scenario: AC2 — Acceptance and terminal outcome are separate and correlated (req: R2) | MET | test | `.spur/run/verifyall-G74-20261024/runner-proof/tests/turn-session.test.ts:158`; Fresh copied upstream suites against the installed published dist: 63 pass, 0 fail (18 facade cases plus all three native drivers). Acceptance precedes terminal outcome, caller correlation survives and native ids are observed rather than invented. Commands: published-dist runner suites 63 pass; current upstream bun run spur-check exit 0, 3200 pass; recovered original release gate and tag chronology asserted in .spur/run/G74-completion/upstream-release-proof.json:1. |
| Scenario: AC3 — One active turn; foreign and late events are diagnostic (req: R3) | MET | test | `.spur/run/verifyall-G74-20261024/runner-proof/tests/turn-session.test.ts:206`; Fresh copied upstream suites against the installed published dist: 63 pass, 0 fail (18 facade cases plus all three native drivers). Busy admission rejects and foreign/duplicate terminals are diagnostic only. Commands: published-dist runner suites 63 pass; current upstream bun run spur-check exit 0, 3200 pass; recovered original release gate and tag chronology asserted in .spur/run/G74-completion/upstream-release-proof.json:1. |
| Scenario: AC4 — Crashes and cancels resolve deterministically (req: R4) | MET | test | `.spur/run/verifyall-G74-20261024/runner-proof/tests/turn-session.test.ts:254`; Fresh copied upstream suites against the installed published dist: 63 pass, 0 fail (18 facade cases plus all three native drivers). Death before acceptance is not-started; after acceptance and cancel grace expiry are outcome-unknown; native cancel completion is interrupted. Commands: published-dist runner suites 63 pass; current upstream bun run spur-check exit 0, 3200 pass; recovered original release gate and tag chronology asserted in .spur/run/G74-completion/upstream-release-proof.json:1. |
| Scenario: AC5 — Release-ready without publishing (req: R6) | MET | test | `node_modules/@gobing-ai/ts-ai-runner/src/turn-session.ts:644`; `.spur/run/G74-completion/upstream-release-proof.json:11`; `.spur/run/G74-completion/upstream-original-gate.log:262`; `.spur/run/G74-completion/upstream-current-gate.log:247`; fresh provenance assertions verify immutable handoff ca234528 at version 0.6.0, the original empty registry/testing export and the facade changelog. The recovered original full gate has 3153 tests, zero failures, both rule gates and 62/62 fixtures passing; current upstream gate has 3200 tests and zero failures with both gates green. Annotated release tags were created 2276 seconds after the handoff commit. This pass created no tags and published nothing. Commands: published-dist runner suites 63 pass; current upstream bun run spur-check exit 0, 3200 pass; recovered original release gate and tag chronology asserted in .spur/run/G74-completion/upstream-release-proof.json:1. |
- Coverage: N/A (verdict-based; verify pipeline does not measure code coverage)

### Review

Inline super-reviewer pass over the 1284 upstream work in ts-libs @ 0.6.0 (worktree sp/runall-g74-53db; spur side is seam/observer only).

**Traceability** — R1/R2/R3/R4 behaviors are pinned by the turn-session suite in `packages/ai-runner/tests/turn-session.test.ts:1` (ts-libs): typed refusals return `{ok:false, reason, detail}` without throwing (`src/turn-session.ts:546`); acceptance resolves before the outcome with caller correlation carried through (`:148`); `TurnSessionBusyError` on double start and stray terminals as `diagnostic` only (`:360`); crash/cancel map to not-started / outcome-unknown / interrupted deterministically (fake-turn-agent children over real pipes, `src/testing/fake-turn-driver.ts:44`). R5: `TURN_SESSION_DRIVERS` is empty in 0.x (contract only) and `./testing` ships the fake driver/agent (`src/turn-session.ts:157`, `src/testing/fake-turn-agent.ts:24`). R6: `bun run gate` exit 0 (tslibs-gate9), package.json/CHANGELOG lockstep at 0.6.0, committed and untagged.

**SECUA** — no throw-on-refusal paths; cancel is wake-not-clear with a bounded 5s grace (`:160`); line overflow raises `TurnProtocolError` (`:117`); child exit is driven by stdin EOF with EPIPE tolerated as exit 0; no new dependencies; no secrets or raw stdout in library code (fake agent exempted by explicit global rule seam).

**Verification** — turn-session 16/16, fake-driver 6/6, fake-agent 5/5, package 349/349, ts-libs full gate exit 0 at 0.6.0; spur-side diff is documentation/config only.

**Findings**

| Priority | Finding | Disposition |
| --- | --- | --- |
| P1 | none | — |
| P2 | none | — |
| P3 | none | — |
| P4 | none | — |

**Captured answer**

Confidence: HIGH

| Req | Status | Evidence |
| --- | --- | --- |
| R1 | MET | test `turn-session` suite 16/16 (packages/ai-runner/tests/turn-session.test.ts, ts-libs): unsupported-agent and unqualified-version refusals returned as `{ok:false, reason, detail}` — openTurnSessionWithDriver never throws for expected refusals (static-ref ts-libs packages/ai-runner/src/turn-session.ts:546) |
| R2 | MET | test `turn-session` suite: accepted resolves before outcome; outcome settles exactly once to success with caller correlation {runId, executionId, requestId, attempt:1} and driver-observed native turn id (OpenTurnSessionResult/TurnHandle contract, static-ref ts-libs packages/ai-runner/src/turn-session.ts:148) |
| R3 | MET | test `turn-session` suite: second startTurn rejects with TurnSessionBusyError; unknown-turn-id and duplicate terminals surface only as `diagnostic` via the lastTurn fallback (static-ref ts-libs packages/ai-runner/src/turn-session.ts:360) |
| R4 | MET | test `turn-session` suite: exit-before-accept → not-started, exit-after-accept → outcome-unknown, ignore-cancel → outcome-unknown after TURN_CANCEL_GRACE_MS=5_000, answered cancel → interrupted (command fake-turn-agent scripted children over real pipes, 5/5) |
| R5 | MET | test TURN_SESSION_DRIVERS empty in 0.x (unsupported-agent for claude/pi/codex); ./testing subpath ships createFakeTurnSessionDriver + real scripted child process (command packages/ai-runner tests/testing 6/6 + 5/5) |
| R6 | MET | command ts-libs `bun run gate` exit 0 (rule-fixtures 62/62, changelog-claim-citation 9 cases, gate log tslibs-gate9); version 0.6.0 lockstep in package.json files (ts-libs packages/ai-runner/package.json:3); CHANGELOG.md `[0.6.0]` lists the facade with claim citations; tree committed (fa1f8702, 4287a609, ca234528) and untagged — release handoff to Robin recorded in the task Solution section |

| AC | Status | Evidence Type | Evidence |
| --- | --- | --- | --- |
| AC1 — A refused open is typed, never thrown (req: R1, R5) | MET | test | ts-libs packages/ai-runner/tests/turn-session.test.ts — `{ok:false, reason:'unsupported-agent'}` for an unregistered agent and `{ok:false, reason:'unqualified-version', detail}` for a rejecting qualify(), with no process spawned (fake driver spawn spy) |
| AC2 — Acceptance and terminal outcome are separate and correlated (req: R2) | MET | test | ts-libs packages/ai-runner/tests/turn-session.test.ts — scripted accept→output→success terminal; accepted resolves first, outcome = success with identical correlation and native turn id |
| AC3 — One active turn; foreign and late events are diagnostic (req: R3) | MET | test | ts-libs packages/ai-runner/tests/turn-session.test.ts — busy rejection + unknown-turn-id terminal and post-completion duplicate terminal emitted only as `diagnostic` events, outcomes untouched |
| AC4 — Crashes and cancels resolve deterministically (req: R4) | MET | test | ts-libs packages/ai-runner/tests/turn-session.test.ts + tests/testing/fake-turn-agent.test.ts — not-started / outcome-unknown / outcome-unknown after grace / interrupted, each from a real spawned child |
| AC5 — Release-ready without publishing (req: R6) | MET | command | ts-libs `bun run gate` exit 0 at 0.6.0 (superset of spur-check: autofix + lint + rules + tests + TSDoc/coverage post-checks); package.json 0.6.0 (ts-libs packages/ai-runner/package.json:3); CHANGELOG lists the facade (ts-libs CHANGELOG.md:12); `git tag --list` shows no 0.6.0 tag |

Verdict: PASS

### References

- Feature: `docs/features/G74_*.md` (R6–R8 via 1275).
- Design: `docs/design/fleet-task-turn-execution.md` §4–5; ADR-145 in `docs/00_ADR.md`.
- Consumer: task 1275 (Spur seam); drivers: 1276, 1277, 1278.
- ts-libs anchors: `packages/ai-runner/src/team-agent-process.ts:122`, `src/agents/shims.ts:175,248,374,533`, `src/ai-runner.ts:56`.
- ts-libs gates: root `package.json` `spur-check`; release flow: `packages/ai-runner/package.json` `release` script (tag push only).

### History

- 2026-10-22T16:26:37.914Z backlog → todo (system)
- 2026-10-22T21:59:37.310Z todo → wip (system)
- 2026-10-22T22:14:29.722Z wip → testing (system)
- 2026-10-22T22:14:54.766Z testing → done (system)

