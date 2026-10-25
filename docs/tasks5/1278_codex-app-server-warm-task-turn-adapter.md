---
schema_version: 1
name: Codex App Server warm task-turn adapter
status: done
template: feature-impl
created_at: 2026-10-22T07:00:34.915Z
updated_at: "2026-10-25T03:36:12.137Z"
feature_id: G74
priority: P2
tags:
  - fleet
  - performance

dependencies: ["1275"]
ac_altitude: task-local
ac_numbering: task-local
estimate_hours: 8
done_forced: "false"
done_reason: unforced close; PASS artifact at .spur/memory/evidence/1278-verdict.json
---

## 1278. Codex App Server warm task-turn adapter

### Background

Implements: R5 — Codex completes keyed tasks through native thread and turn identity.
Work package E5. Runs after the correlated task-turn seam. Transport: Codex App Server stdio (initialize, thread/start|resume, turn/start, turn/completed).
Rubric: E7 D1 L2 C1 R1 = 12 → own task.

**Refine corrections (2026-10-22)**
- Claim "adapter selection in the Spur turn seam" → reality: protocol mechanics belong to ts-ai-runner (ADR-145); the 1284 facade defines a per-agent `TurnSessionDriver` registry. → resolution: the driver is written in ts-libs `packages/ai-runner/src/turn-drivers/codex-app-server.ts` and released by Robin; Spur's part is the catalog bump, capability evidence and receipt rows. ts-libs edits authorized by Robin on 2026-10-22; publishing is his.
- Capability row is stale: `AGENT_SESSION_CAPABILITY.codex` (ts-libs `src/agents/shims.ts:533`) — verifiedAgainst 0.155.1, supportsPersistentStdin false; observed on this host 2026-10-22: codex 0.163.0. → resolution: re-probe and update `verifiedAgainst` with the driver.
- Transport premise: Codex App Server over stdio (JSON-RPC: initialize → thread/start or thread/resume → turn/start → turn/completed with status) — **unverified against the installed binary**; step 1 records the observed record shapes as redacted fixtures before any parser is written.

### Requirements

- [x] R1. Qualify the installed Codex binary/version App Server sequence; record provenance in `verifiedAgainst` and the receipt.
- [x] R2. Two related keyed tasks run as native turns in one process; thread and turn ids link to each validated task receipt.
- [x] R3. Native failed and interrupted turn statuses can never become successful task results; cancellation awaits terminal evidence.
- [x] R4. Unqualified versions keep exec-resume/one-shot fallback with a named reason.

### Acceptance Criteria

```gherkin
Scenario: AC1 — The App Server sequence is qualified with evidence (req: R1)
  Given the installed codex binary
  When qualification runs
  Then the recorded transcript shows initialize, thread start/resume, turn start and turn completion, and `verifiedAgainst` equals the probed version

Scenario: AC2 — Native ids link to receipts (req: R2)
  Given two keyed tasks on one Codex App Server process
  When both complete
  Then each receipt carries the same native thread id and distinct native turn ids, plus passing action contracts

Scenario: AC3 — Failed or interrupted never becomes success (req: R3)
  Given turns completing with failed and interrupted statuses, and a cancel
  When each settles
  Then outcomes are `failure`, `interrupted`, and the cancel resolves only after the native completion (or `outcome-unknown` after grace)

Scenario: AC4 — Unqualified Codex falls back by name (req: R4)
  Given a version not in `verifiedAgainst`
  When a keyed task dispatches
  Then it runs once via `exec resume`/one-shot with reason `unqualified-version`
```

Feature scenario coverage (the detailed task-local scenarios above remain the behavior contract):

- [x] R5 — Codex completes keyed tasks through native thread and turn identity

### Q&A

<!-- CLOSED decisions from refinement: what was chosen and why, what was deferred and on what
     condition. Not a parking lot for open questions — an unanswered question here means the task
     is not ready to hand off. Keep empty if none. -->

#### Q&A entry — 2026-10-22T16:25:48.650Z

- **Q: Where does the driver live?** CLOSED — ts-libs `packages/ai-runner/src/turn-drivers/codex-app-server.ts`, registered in `TURN_SESSION_DRIVERS` (1284). Spur imports nothing agent-specific.
- **Q: Which versions qualify?** CLOSED — exactly the probed version(s) recorded in `verifiedAgainst`; `qualify()` refuses others with `unqualified-version`, and Spur falls back (`exec resume <id>` then one-shot) with that reason (1275).
- **Q: Release?** CLOSED — implementer stops at a green, committed, untagged ts-libs tree with version 0.6.x (next patch); Robin tags/publishes; Spur catalog bump + evidence follow in this task's last steps.
- **Q: Real-agent runs?** CLOSED — opt-in (`fleet-e2e --perf --real-agents --agents codex`); deterministic lane replays recorded fixtures.

### Design

**Driver:** ts-libs `packages/ai-runner/src/turn-drivers/codex-app-server.ts`; JSON-RPC client over stdio: handshake = initialize (+ thread start/resume) → `handshake-failed` on refusal; `startTurn` = turn start; terminal = the recorded turn-completed status (completed → `success`, failed → `failure`, interrupted → `interrupted`). Method/field names come from the step-1 transcript, not from this text.
**Capability row:** set `supportsPersistentStdin` per evidence; keep the `exec resume` note for fallback.
**Rejected:** inferring identity from PID or a stored thread id.
**Invariants:** native ids recorded only when observed.

### Plan

- [x] 1. Qualification spike: probe `codex --version` and the persistent protocol on the installed binary; capture redacted transcripts (two turns, an error turn, a cancel) to ts-libs `packages/ai-runner/tests/fixtures/turn-drivers/codex/*.jsonl`. No parser before fixtures.
      Captured 2026-10-24 against codex-cli 0.164.0 and copied for the Spur proof at `packages/app/tests/fixtures/codex-warm/README.md:1`. The deterministic receipt re-probed `/opt/homebrew/bin/codex` 0.164.0 at `docs/reports/fleet-perf-receipt.json:475`.
- [x] 2. Failure cases first in ts-libs `tests/turn-drivers/codex.test.ts`: failed turn status; interrupted turn status; cancel awaiting turn/completed; server exit mid-turn (outcome-unknown); initialize refusal (handshake-failed); two serial turns on one thread; notification for another thread (diagnostic).
      Those cases ship in the released driver suite. Evidence: @gobing-ai/ts-ai-runner `tests/turn-drivers/codex-app-server.test.ts` line 36. This pass did not re-run that suite. The Spur integration cases are `packages/app/tests/workflow/codex-warm-work-item.test.ts:17` (failed, interrupted, cancel-after-accept, exit-after-accept, missing artifact, unqualified, two turns).
- [x] 3. Implement `src/turn-drivers/codex-app-server.ts`, register it, update `AGENT_SESSION_CAPABILITY.codex.verifiedAgainst`/note; fixture-replay tests pass through a real child (fake agent replaying the captured transcript).
      Already in the released package. This pass did not reimplement it. Spur consumes the registered `codex` driver. Evidence: @gobing-ai/ts-ai-runner `src/turn-session.ts` line 219. Evidence: @gobing-ai/ts-ai-runner `src/agents/shims.ts` line 575.
- [x] 4. ts-libs `bun run spur-check`; commit `feat(ai-runner): codex turn-session driver`; version 0.6.x (next patch); CHANGELOG. Handoff note in Solution; **Robin releases**.
      Released as 0.7.1, not 0.6.x. ts-libs commits `3533696f`, `f38a1f65`, and `d81001c4`. This pass did not re-run the upstream check. Robin already published. Installed version is `node_modules/@gobing-ai/ts-ai-runner/package.json:3`.
- [x] 5. Spur: bump catalog to the released version; run `bun run fleet-e2e --perf` (deterministic) and, opt-in, `--real-agents --agents codex`; warm rows replace `unsupported` in `docs/reports/fleet-perf-receipt.json`.
      The catalog was already `^0.7.1` at `package.json:32` (HEAD `8fb475754`). The deterministic receipt's Codex warm row is qualified at `docs/reports/fleet-perf-receipt.json:475`. The real-agent lane stays opt-in and was not run. Claude's warm row stays unsupported at `docs/reports/fleet-perf-receipt.json:450` (1276, not this task).
- [x] 6. `bun run spur-check` — PASS in the parent pipeline gate (`.spur/run/1278-check-receipt.json`, tier `full`, tree digest `2e917f70d7e0`).
      Unchecked on purpose. The parent pipeline gate owns this command. Implement did not run it. The light gate at `.spur/run/1278-light-gate.log:6` fails only on coverage-provenance stale-tree; lint, pre-check, app typecheck, and the targeted app tests passed.

### Solution

**Codex warm turns consume the released App Server driver. Ready for the parent gate.** This is an implement handoff: no verify PASS, no status transition, and no full-project gate is claimed.

The driver, capability row, and catalog pin were already released as `@gobing-ai/ts-ai-runner` 0.7.1. This pass proves the Spur work-item seam against that package and records qualification. It does not reimplement the protocol (ADR-145) and does not vendor a local ts-libs tree.

**Change map**

- `packages/app/tests/workflow/codex-warm-work-item.test.ts:17` imports the warm dispatcher and drives the installed Codex driver through a real replay child. `packages/app/tests/workflow/codex-warm-work-item.test.ts:85` opens one session for the keyed tasks. `packages/app/tests/workflow/codex-warm-work-item.test.ts:164` expects one `unqualified-version` fallback and no `app-server` launch when the binary reports `0.155.1`. `packages/app/tests/workflow/codex-warm-work-item.test.ts:170` requires `nativeOutcome: 'failure'` and `result.ok` false even though the artifact was written. `packages/app/tests/workflow/codex-warm-work-item.test.ts:176` does the same for a native `interrupted` status. `packages/app/tests/workflow/codex-warm-work-item.test.ts:185` expects `outcome-unknown` with `acceptedAt` set when the process exits after acceptance. `packages/app/tests/workflow/codex-warm-work-item.test.ts:212` requires one `codex app-server` launch, one thread id, and distinct turn ids. `packages/app/tests/workflow/codex-warm-work-item.test.ts:226` calls `handle.cancel` and accepts only the native interrupted completion.
- `packages/app/tests/fixtures/codex-warm/replay.ts:14` selects the scenario and replays the captured JSONL over a real child. `packages/app/tests/fixtures/codex-warm/README.md:1` records provenance: redacted captures from `codex-cli` 0.164.0 on 2026-10-24. Success thread `01a1705e-c0ab-7ab1-aa00-9f3e09be957a` with turns `01a1705e-c10f-71b2-b1f3-2ef7b4570cfe` and `01a1705e-d0a4-7fd2-8171-8194a14bd2e8`.
- `packages/app/src/services/agent-loop-service.ts:577` updates the 1275 seam comment so the registry names claude (1276), pi (1277), and codex (1278). Comment only.
- `packages/app/tests/services/agent-service.test.ts:4815` expects Codex `verifiedAgainst: '0.164.0'` and persistent stdin. `packages/app/tests/services/agent-service.test.ts:4838` expects a stale detection of `0.999.0` against `0.164.0`.
- `docs/design/fleet-task-turn-execution.md:126` records the released handshake: `turn/start` acceptance, then `turn/completed` mapped to success, failure, or interrupted, and cancel waiting for that completion or `outcome-unknown`.
- `docs/reports/fleet-perf-receipt.json:475` records the Codex warm row: binary `/opt/homebrew/bin/codex`, version `0.164.0`, driver `codex`, `verifiedVersion` `0.164.0`, `status` `qualified`. `docs/reports/fleet-perf-receipt.md:33` is that row. `docs/reports/fleet-perf-receipt.md:3` stamps the receipt `2026-10-25T01:14:18.324Z`. `docs/reports/fleet-perf-receipt.md:14` through `docs/reports/fleet-perf-receipt.md:22` are nine validated cold/resume trials from the deterministic lane.
- `docs/reports/fleet-perf-receipt.json:459` still records Claude warm as unsupported (`2.1.309` against verified `2.1.308`). That row is pre-existing and belongs to 1276, not this task.

**Unchanged seams**

- `packages/app/src/services/warm-turn-dispatch.ts:221` already copies an observed `nativeSessionId` and `nativeTurnId` onto the receipt. No dispatcher edit.
- `packages/app/src/services/agent-run-executor.ts:78` already maps `success` to exit 0 so the action contract stays the success authority. `packages/app/src/services/agent-run-executor.ts:79` maps `outcome-unknown` to exit 3, and `packages/app/src/services/agent-run-executor.ts:82` maps `interrupted` to exit 3. No executor edit.
- `package.json:32` already pins `@gobing-ai/ts-ai-runner` to `^0.7.1` at HEAD `8fb475754`. This pass did not edit the catalog or the lockfile. The light-gate stale-tree note names those files because the certified coverage artifact predates that commit.

**Installed driver (read this pass)**

`node_modules/@gobing-ai/ts-ai-runner/package.json:3` is version `0.7.1`. `qualify()` accepts only `0.164.0`. The registry entry is `codex`. A process exit before acceptance settles `not-started`; after acceptance it settles `outcome-unknown`. The capability row sets `verifiedAgainst` to `0.164.0`.

Evidence: @gobing-ai/ts-ai-runner `src/turn-drivers/codex-app-server.ts` line 41
Evidence: @gobing-ai/ts-ai-runner `src/turn-drivers/codex-app-server.ts` line 86
Evidence: @gobing-ai/ts-ai-runner `src/turn-session.ts` line 219
Evidence: @gobing-ai/ts-ai-runner `src/turn-session.ts` line 627
Evidence: @gobing-ai/ts-ai-runner `src/agents/shims.ts` line 575
Evidence: @gobing-ai/ts-ai-runner `tests/turn-drivers/codex-app-server.test.ts` line 36

ts-libs `main` already contains `3533696f` (register the driver), `f38a1f65` (native interrupted and the identity fence), and `d81001c4` (release 0.7.1). The plan's `0.6.x` estimate landed as `0.7.1`. This pass did not edit ts-libs and did not re-run its check. Robin already published.

`fleet-e2e --perf --real-agents --agents codex` stays opt-in and was not run. Warm rows certify qualification and carry no model-latency claim.

**Verification**

`spur task gate 1278 light` wrote `.spur/run/1278-light-gate.log:1` (format-lint PASS), `.spur/run/1278-light-gate.log:3` (rules:pre PASS, 51 rules, no violations at `.spur/run/1278-light-gate.log:5`), `.spur/run/1278-light-gate.log:6` (rules:post FAIL), `.spur/run/1278-light-gate.log:11` (typecheck `packages/app` PASS), and `.spur/run/1278-light-gate.log:13` (tests PASS). The only failing check is `.spur/run/1278-light-gate.log:8`: `coverage-artifact: stale-tree`. Recovery at `.spur/run/1278-light-gate.log:9` is `bun run test:full`. This implement pass does not run that command or `bun run spur-check`. The app tests at `.spur/run/1278-light-gate.log:17` include all seven Codex cases, and `.spur/run/1278-light-gate.log:274` records 252 pass, 0 fail, 926 expect() calls.

`probe: not-applicable (no public surface changed)`. No CLI verb, HTTP route, or plugin script changed, so `script-contract-check` does not apply.

Plan step 6 stays unchecked. The parent pipeline gate owns `bun run spur-check`.

**Requirement trace**

- R1 / AC1. `verifiedAgainst` is `0.164.0` (capability row and `docs/reports/fleet-perf-receipt.json:481`), matching the probed binary at `docs/reports/fleet-perf-receipt.json:478`.
- R2 / AC2. Two keyed tasks share one process and one thread id and carry distinct turn ids at `packages/app/tests/workflow/codex-warm-work-item.test.ts:212`.
- R3 / AC3. Failed and interrupted stay unsuccessful at `packages/app/tests/workflow/codex-warm-work-item.test.ts:170` and `packages/app/tests/workflow/codex-warm-work-item.test.ts:176`. Cancel waits for the native interrupted completion at `packages/app/tests/workflow/codex-warm-work-item.test.ts:243`. Exit after acceptance is `outcome-unknown` at `packages/app/tests/workflow/codex-warm-work-item.test.ts:185`.
- R4 / AC4. Version `0.155.1` falls back once with reason `unqualified-version` and does not spawn `app-server`, at `packages/app/tests/workflow/codex-warm-work-item.test.ts:164`.

### Testing

**Pipeline verify results**

- Verdict: PASS (from verdict artifact)

| Requirement | Status | Evidence |
|-------------|--------|----------|
| R1 | MET | `packages/app/tests/workflow/codex-warm-work-item.test.ts:68`; `scripts/commands/fleet-e2e.ts:2027`; Fresh copied upstream suites against the installed published dist: 63 pass, 0 fail (18 facade cases plus all three native drivers). Captured App Server initialize/thread/turn sequence and installed binary agree on Codex 0.164.0 qualification. Command (cwd packages/app): bun test ../../.spur/run/verifyall-G74-20261024/runner-proof/tests --timeout 20000; exit 0, 63 pass. Work-item suite separately passed 39 cases across 5 files. Re-audit artifact writes: .spur/run/1278-verify-answer.txt:1-40; .spur/run/1278-verdict.json:1-107. Final gate: .spur/run/1273-test-gate.log:599 (11697 pass). |
| R2 | MET | `packages/app/tests/workflow/codex-warm-work-item.test.ts:68`; Current packages/app targeted run: 39 pass, 0 fail across 5 files; dispatcher/executor and all native work-item adapters. Two keyed results share one native thread id with distinct native turn ids, each coupled to its validated artifact receipt. Command (cwd packages/app): bun test ../../.spur/run/verifyall-G74-20261024/runner-proof/tests --timeout 20000; exit 0, 63 pass. Work-item suite separately passed 39 cases across 5 files. |
| R3 | MET | `packages/app/tests/workflow/codex-warm-work-item.test.ts:68`; `packages/app/tests/workflow/codex-warm-work-item.test.ts:226`; Fresh copied upstream suites against the installed published dist: 63 pass, 0 fail (18 facade cases plus all three native drivers). Failure/interrupted/accepted-exit cases remain unsuccessful, and cancellation waits for the observed native interrupted completion. Command (cwd packages/app): bun test ../../.spur/run/verifyall-G74-20261024/runner-proof/tests --timeout 20000; exit 0, 63 pass. Work-item suite separately passed 39 cases across 5 files. |
| R4 | MET | `packages/app/tests/workflow/codex-warm-work-item.test.ts:68`; `scripts/commands/fleet-e2e.ts:1953`; Current packages/app targeted run: 39 pass, 0 fail across 5 files; dispatcher/executor and all native work-item adapters. Unqualified version falls back once and spawns no App Server child. Command (cwd packages/app): bun test ../../.spur/run/verifyall-G74-20261024/runner-proof/tests --timeout 20000; exit 0, 63 pass. Work-item suite separately passed 39 cases across 5 files. |

| Acceptance Criteria | Status | Evidence Type | Evidence |
|---------------------|--------|---------------|----------|
| Scenario: AC1 — The App Server sequence is qualified with evidence (req: R1) | MET | test | `packages/app/tests/workflow/codex-warm-work-item.test.ts:68`; `scripts/commands/fleet-e2e.ts:2027`; Fresh copied upstream suites against the installed published dist: 63 pass, 0 fail (18 facade cases plus all three native drivers). Captured App Server initialize/thread/turn sequence and installed binary agree on Codex 0.164.0 qualification. Command (cwd packages/app): bun test ../../.spur/run/verifyall-G74-20261024/runner-proof/tests --timeout 20000; exit 0, 63 pass. Work-item suite separately passed 39 cases across 5 files. |
| Scenario: AC2 — Native ids link to receipts (req: R2) | MET | test | `packages/app/tests/workflow/codex-warm-work-item.test.ts:68`; Current packages/app targeted run: 39 pass, 0 fail across 5 files; dispatcher/executor and all native work-item adapters. Two keyed results share one native thread id with distinct native turn ids, each coupled to its validated artifact receipt. Command (cwd packages/app): bun test ../../.spur/run/verifyall-G74-20261024/runner-proof/tests --timeout 20000; exit 0, 63 pass. Work-item suite separately passed 39 cases across 5 files. |
| Scenario: AC3 — Failed or interrupted never becomes success (req: R3) | MET | test | `packages/app/tests/workflow/codex-warm-work-item.test.ts:68`; `packages/app/tests/workflow/codex-warm-work-item.test.ts:226`; Fresh copied upstream suites against the installed published dist: 63 pass, 0 fail (18 facade cases plus all three native drivers). Failure/interrupted/accepted-exit cases remain unsuccessful, and cancellation waits for the observed native interrupted completion. Command (cwd packages/app): bun test ../../.spur/run/verifyall-G74-20261024/runner-proof/tests --timeout 20000; exit 0, 63 pass. Work-item suite separately passed 39 cases across 5 files. |
| Scenario: AC4 — Unqualified Codex falls back by name (req: R4) | MET | test | `packages/app/tests/workflow/codex-warm-work-item.test.ts:68`; `scripts/commands/fleet-e2e.ts:1953`; Current packages/app targeted run: 39 pass, 0 fail across 5 files; dispatcher/executor and all native work-item adapters. Unqualified version falls back once and spawns no App Server child. Command (cwd packages/app): bun test ../../.spur/run/verifyall-G74-20261024/runner-proof/tests --timeout 20000; exit 0, 63 pass. Work-item suite separately passed 39 cases across 5 files. |
| R5 — Codex completes keyed tasks through native thread and turn identity | MET | test | `packages/app/tests/workflow/codex-warm-work-item.test.ts:68`; Current packages/app targeted run: 39 pass, 0 fail across 5 files; dispatcher/executor and all native work-item adapters. Two keyed results share one native thread id with distinct native turn ids, each coupled to its validated artifact receipt. Command (cwd packages/app): bun test ../../.spur/run/verifyall-G74-20261024/runner-proof/tests --timeout 20000; exit 0, 63 pass. Work-item suite separately passed 39 cases across 5 files. |
- Coverage: N/A (verdict-based; verify pipeline does not measure code coverage)

### Review

#### Review Report — 1278

**Scope:** task 1278 (G74 E5) — the Spur side of the Codex App Server warm task-turn adapter: replay fixtures, the keyed-work integration suite, the capability assertion, the perf-receipt warm row, and the design note. The protocol driver itself is released in `@gobing-ai/ts-ai-runner` 0.7.1 (ADR-145); this review reads it and does not modify it.
**Dimensions:** functional, security, efficiency, correctness, usability, architecture
**Verdict:** PASS
**Confidence:** MEDIUM

##### Findings (ranked)

| # | Priority | Dimension | Finding | Location | Disposition |
|---|----------|-----------|---------|----------|-------------|
| 1 | P4 (advisory) | correctness | The replay child re-serves the bootstrap notifications on every handshake frame: `thread/started` and the `warning` row are emitted in answer to `initialize` (before a thread exists) and again in answer to `thread/start`, so the replayed order is not the captured order the README describes (`packages/app/tests/fixtures/codex-warm/README.md:7`). No assertion depends on it — the released driver routes a foreign-thread frame to diagnostics — but the fixture is weaker evidence of handshake ordering than it appears. | `packages/app/tests/fixtures/codex-warm/replay.ts:86-92` | ACCEPTED |
| 2 | P4 (advisory) | correctness | `isTurnStart` identifies the acceptance frame with a hard-coded `row.id !== 2`; a recapture that renumbers the thread response would silently re-segment the fixture into the wrong turn. The capture is version-pinned, so this is a maintenance hazard rather than a live defect. | `packages/app/tests/fixtures/codex-warm/replay.ts:38` | ACCEPTED |
| 3 | P4 (advisory) | architecture | No repo-wide gate has run on this tree: the light gate's `rules:post` leg fails on `coverage-artifact: stale-tree` and plan step 6 deliberately leaves `bun run spur-check` to the parent pipeline gate. Review evidence is therefore the fresh targeted suite (7 pass / 0 fail) plus the light gate's own lint, typecheck, and app-test legs, not a full-project certification. | `.spur/run/1278-light-gate.log:6` | ACCEPTED |
| 4 | P4 (advisory) | correctness | AC3's grace alternative (`outcome-unknown` after the cancel grace expires) is implemented in the released ts-ai-runner driver and is not exercised by the Spur integration suite; the native-completion path is covered, the grace path rests on the upstream suite that this pass did not re-run. | `packages/app/tests/workflow/codex-warm-work-item.test.ts:226-251` | ACCEPTED |

##### Functional Traceability

| Req | Status | Evidence |
|-----|--------|----------|
| R1 | MET | `docs/reports/fleet-perf-receipt.json:475-484` records binary `/opt/homebrew/bin/codex`, version `0.164.0`, driver `codex`, `verifiedAgainst` `0.164.0`, status `qualified`; `packages/app/tests/services/agent-service.test.ts:4815` asserts the surfaced capability row; a fresh `codex --version` on this host printed `codex-cli 0.164.0`, matching the receipt. |
| R2 | MET | `packages/app/tests/workflow/codex-warm-work-item.test.ts:205-217` asserts one `codex app-server` launch, one shared native thread id and distinct native turn ids for the two keyed tasks; `:158-162` binds each receipt to its validated work-item result. |
| R3 | MET | `packages/app/tests/workflow/codex-warm-work-item.test.ts:166-189` keeps `result.ok` false for native `failure` and `interrupted` even though the artifact was written, and settles an exit after acceptance as `outcome-unknown`; `:226-247` accepts the cancel only once the native interrupted completion arrives, with the captured native ids. |
| R4 | MET | `packages/app/tests/workflow/codex-warm-work-item.test.ts:164-165` requires receipt mode `one-shot` with `fallbackReason: 'unqualified-version'` for a `0.155.1` binary; `:206-207` requires exactly one fallback call and no `app-server` launch. |

**Next:** parent pipeline gate runs `bun run spur-check`; fix the coverage artifact there, not in review.

### References

- Feature G74; design `docs/design/fleet-task-turn-execution.md` §5; ADR-145.
- Depends on: 1275 (seam) → 1284 (facade). Receipt: 1273.
- ts-libs anchors: `packages/ai-runner/src/agents/shims.ts:533` (capability rows).

### History

- 2026-10-25T01:21:31.684Z todo → wip (system)
- 2026-10-25T01:55:08.868Z wip → testing (system)
- 2026-10-25T01:55:34.015Z testing → done (system)

