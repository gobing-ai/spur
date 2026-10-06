---
schema_version: 1
name: Prove the inbox-only fleet end to end with a repeatable receipt
status: done
template: feature-impl
created_at: 2026-10-04T20:30:37.927Z
updated_at: "2026-10-06T16:40:49.294Z"
feature_id: G71

dependencies: ["1073", "1074", "1075", "1076", "1080", "1081", "1091"]
priority: P1
estimate_hours: 6
done_forced: "false"
done_reason: unforced close; PASS artifact at .spur/memory/evidence/1077-verdict.json
---

## 1077. Prove the inbox-only fleet end to end with a repeatable receipt

### Background

Implements G71 R8 and closes the G7 umbrella criteria (plan `docs/plans/2026-10-04-agent-fleet-inbox-redesign.md` §1 "Done when", §3.2 item 11). Project rule: E2E is the primary test mechanism and must leave a repeatable artifact.

Scenario from plan §1: a `fleet:auto` task goes todo → done by the coder process; `spur message send --to planner "status?"` is answered; a killed coder is re-dispatched with `--continue`; the inbox shows the exchange; a joined Claude session receives a review request; `spur agent trace <root>` shows the lineage and stream.

**Refine corrections (2026-10-04)**

- R1 says "a script under `scripts/`" → internal self-dev commands live in `scripts/commands/<name>.ts`, are dispatched by `scripts/spur-dev.ts`, and get a `package.json` entry (AGENTS.md "Public-surface consent"; ADR-130 placement) → `scripts/commands/fleet-e2e.ts` + `"fleet-e2e": "bun scripts/spur-dev.ts fleet-e2e"`.
- R3 allows "a stub executor" without saying how → the script prepends a scratch `bin/` to `PATH` holding a stub binary named after the configured member's agent type. The stub logs each received prompt to `stub-prompts.jsonl` and performs deterministic side effects through the source-local CLI.

### Requirements

- [x] R1. A script under `scripts/` scaffolds a scratch project with a declared fleet, runs every plan §1 step against the source-local CLI, and tears down.
- [x] R2. Each step records its command, exit code and observed evidence (message ids, receipt rows, trace output) into a JSON receipt under `docs/reports/`.
- [x] R3. The script reruns deterministically: a stub executor is allowed for the member's model work; the fleet, inbox, receipt and trace paths are real.
- [x] R4. The guest-join step runs only when task 1081 has landed; otherwise it is recorded as `skipped` with the reason.

### Acceptance Criteria

- [x] AC1 — The inbox-only fleet is proven end to end

Task-local verification:

- Running the script twice produces receipts with identical step outcomes.
- A deliberately broken step (e.g. the member bypass reintroduced) makes the receipt record a failure and the script exit nonzero.

### Q&A

<!-- CLOSED decisions from refinement: what was chosen and why, what was deferred and on what
     condition. Not a parking lot for open questions — an unanswered question here means the task
     is not ready to hand off. Keep empty if none. -->

#### Q&A entry — 2026-10-04T20:57:24.304Z

- **Q: Where does the receipt go?** A: `docs/reports/fleet-e2e-receipt.json`, a stable name overwritten each run. It records volatile ids (message ids, run ids). The repeatability comparison checks only `{ step, status, assertion }`.
- **Q: How does the stub drive a task to done?** A: It reads `/sp:dev-run <wbs>` from the prompt and moves the task with `spur task update <wbs> wip`, then `done` through the CLI's verdict-guard override (`done_forced`/`done_reason`, task 0292). Look up the exact flag with `spur task update --help`; never guess it. On a `status?` message, it calls `spur message reply <id> "idle"`.
- **Q: How is the kill/re-dispatch step simulated?** A: The stub blocks (sleep loop) on a task tagged `e2e:hang`. The script kills the coder loop, restarts it, and asserts that the next logged prompt for that wbs ends with `--continue` and uses a new attempt key.
- **Q: How is a failure injected?** A: `--inject-failure <step>` flips that step's assertion. The script must then record `failed` and exit nonzero; this proves the harness fails.

### Design

**Command** `scripts/commands/fleet-e2e.ts`, registered in `scripts/spur-dev.ts`, with `package.json` script `"fleet-e2e"`.

**Steps** (each produces a receipt row `{ step, command, exitCode, status: passed|failed|skipped, assertion, evidence }`):

1. **scaffold**
   - create `$TMPDIR/spur-fleet-e2e-<ts>` and run `git init`
   - run the source-local `bun run <repo>/apps/cli/src/index.ts self init`
   - write `agent.fleet` with `planner` (owner, role planner) and `coder-1` (role coder, stub executor)
   - put the stub on `PATH`
2. **create-task**: `spur task create … --tags fleet:auto`, promoted to `todo`.
3. **start-loops**: start background `spur agent loop --spec planner` and `spur agent loop --spec coder-1` (hidden verb), saving their pids.
4. **dispatch-to-done**
   - poll `spur task show <wbs> --json` (bounded at 120 s) until `done`
   - evidence: the keyed message id (`spur message inbox --json`) and the receipt via `spur agent trace --json`
5. **orchestrator-reply**: `spur message send --to planner "status?"`, then poll the operator inbox for the reply (bounded).
6. **kill-redispatch**: run the `e2e:hang` task, kill the coder pid mid-turn, restart it, and assert the `--continue` prompt and an attempt-2 key.
7. **guest-join**
   - if `spur agent join --help` exits 0 (1081 landed): join as guest `reviewer-g`, send `--to reviewer-g`, assert the reply
   - otherwise record `skipped` with reason `1081 not landed`
8. **trace**: `spur agent trace <root> --json`; assert lineage depth ≥ 2, a session id or `[]`, and non-empty stream lines.
9. **teardown**: kill the loop pids, remove the scratch dir (only under `$TMPDIR`), and write the receipt.

Exit code 1 if any step `failed`.

**Determinism.** No wall-clock assertions, polling only, fixed task ids from a fresh corpus. The stub output is fixed text.

**Blocker (2026-10-05, session review).** The harness reaches 8 of 9 steps; the `kill-redispatch` leg is refuted, not flaky: see `docs/reports/2026-10-05-fleet-e2e-kill-leg-findings.md` for the two reproducible findings (K1 orchestrator does not dispatch a task created after its loops started; K2 an operator-dispatched/ unkeyed turn never finalizes when the member is killed) and `docs/reports/fleet-e2e-receipt.json` for the failing row. Task **1091** (feature G71) owns both product fixes and restoring the strategy attempt-2 assertion. This task stays open until the harness reports 9 of 9.

**Blocker refined (2026-10-05, re-verification).** Task 1091 re-verified the original findings and dropped both. K1 was a misread: the late task is ticked on every pass but held by a GTD-global `outcome-unknown` gate. K2 was also a misread: the unkeyed persistent-stdin path never writes a run row, by design. 1091 now owns three fixes:
- N1: unkeyed deliveries wedge GTD.
- N2: ungraceful member death leaves `running` rows forever.
- H: the kill leg must dispatch through the strategy, with SIGKILL and the attempt-2 assertion.

1091 is a declared dependency; start 1077 only after 1091 is `done` and the harness reports 9 of 9.

### Plan

1. Write the failure list first as a step table: each step's failure modes (timeout, wrong prompt, missing reply, missing lineage) map to assertion text.
2. Write the stub binary generator and the scaffold step.
3. Implement steps 2–9 with bounded polls and receipt rows.
4. Add `--inject-failure` and the nonzero exit.
5. Run it twice and diff the `{ step, status, assertion }` projection of the two receipts. Run with `--inject-failure trace` and expect exit 1.
6. Commit the script and the passing receipt.
7. Gate: `bun run spur-check`.

### Solution

This pass leaves no unexecuted contract in the harness: every receipt row's branch — including the
R4 pre-1081 skip arm — is now driven by a real run of the harness, and the pipeline defect found by
the first inline run is fixed at its root.

| Change | Anchor |
| --- | --- |
| The guest-join leg's CLI under test became a parameter (`cliAs`/`cliOkAs` take entry + label), so one code path serves the source-local transport and a pre-1081 fixture alike | `scripts/commands/fleet-e2e.ts:178`, `scripts/commands/fleet-e2e.ts:200` |
| `probeAgentCommand`/`agentCommandListed`: the skip predicate reads the `agent` command column of the interrogated CLI's `agent --help` — the observable that differs between pre/post 1081 | `scripts/commands/fleet-e2e.ts:656`, `scripts/commands/fleet-e2e.ts:669` |
| `--guest-join-fixture`: the skip arm is EXECUTED — the harness generates a hermetic pre-1081 fixture CLI, drives the same predicate against it, and writes a separate skip-arm receipt so the land-arm receipt stays a truthful 9/9 | `scripts/commands/fleet-e2e.ts:610`, `scripts/commands/fleet-e2e.ts:1387` |
| The generated pre-1081 fixture: `agent --help` frozen to the historical pre-1081 command set (reconstructed from this repo's own history, parent of `0411c912b` which added `report\|join\|leave`); no machine path, no published-bundle dependency | `scripts/commands/fleet-e2e.ts:464`, `scripts/commands/fleet-e2e.ts:490` |
| The skip row carries the REAL probe invocation, exit code and evidence (R2), with a skip-specific assertion (no guest ran, so it must not carry the leg's join assertion) | `scripts/commands/fleet-e2e.ts:560`, `scripts/commands/fleet-e2e.ts:1151`, `scripts/commands/fleet-e2e.ts:1159` |
| Receipts gain a `guestJoinCli` discriminator (`source-local` vs `pre-1081-fixture`); receipts refreshed from the current build in both arms | `docs/reports/fleet-e2e-receipt.json:1`, `docs/reports/fleet-e2e-receipt-skip-arm.json:1` |
| Pipeline fix (operator-directed, same task): verify's `task verdict` action is `onError: continue` — it exits 1 on any non-PASS verdict by design (1003 R2), but the default 'fail' policy halted the state before the verify guards could run, making the declared `verify → test-fix` remediation lane unreachable; test-fix also gained the review-lane evidence projection; definition version 4 → 5 | `config/workflows/task-pipeline.yaml` (commit `c940a00cf`) |

**Why the probe reads the parent help's command column rather than `agent join --help`'s exit code
(R4).** Commander falls through to the PARENT command for an unknown verb, so pre-1081
`agent join --help` exited 0 and printed the same parent help that `agent bogus --help` prints on
HEAD (both exit 0 — verified 2026-10-06). The exit code is identical in the two states and the skip
branch would be dead code. The `join [options]` line in the parent help exists only once 1081 has
landed; `agentCommandListed(scratch, 'join')` reads exactly that line.

**Why the skip arm is now executed, not just reachable.** Run 1's verify verdict was PARTIAL on
exactly this point: the `skipped` arm rested on code plus a guard probe because 1081 is `done` on
this tree, so no run ever emitted a `skipped` row. The operator adjudicated: give R4 executed
evidence. `--guest-join-fixture` runs the WHOLE harness with only the guest-join leg's interrogated
CLI swapped for the generated pre-1081 fixture — the skip branch, its row and its receipt are
produced by execution, deterministically, on any machine (the fixture is generated in the scratch
dir from a frozen in-source constant, so the receipt is reproducible for everyone).

**Why no assertion was weakened to force green.** The land arm stays 9/9 (its `guest-join` row still
asserts the joined-guest leg and still runs it); the skip arm's row asserts the skip itself;
`--inject-failure` still records `failed` and exits nonzero.

### Testing

**Pipeline verify results**

- Verdict: PASS (from verdict artifact)
- Confidence: HIGH

| Requirement | Status | Evidence |
|-------------|--------|----------|
| R1 | MET | `scripts/commands/fleet-e2e.ts:679` runFleetE2e scaffolds a scratch fleet project, runs the step list `scripts/commands/fleet-e2e.ts:66` against the source-local CLI and tears down. Fresh run this pass: 9 of 9 steps ok, scratch removed (`.spur/run/G71-verifyall-e2e-final.log`). |
| R2 | MET | Each step row records command, exit code, assertion and evidence into `docs/reports/fleet-e2e-receipt.json:41-86` (receipt path `scripts/commands/fleet-e2e.ts:57`). Fixed this pass (e3e74a69c): the trace row now names the done task's own run — `docs/reports/fleet-e2e-receipt.json:78`. |
| R3 | MET | Only the model is stubbed: stub binary on PATH (`scripts/commands/fleet-e2e.ts:245-258`), the loop spawns the real CLI; deterministic reruns — fresh run this pass and the committed run both pass 9 of 9. |
| R4 | MET | Guest-join skip arm: `scripts/commands/fleet-e2e.ts:585` records skipped with the reason; skip-arm receipt `docs/reports/fleet-e2e-receipt-skip-arm.json:65`. Task 1081 has landed, so the fresh run executes guest-join (ok). |

| Acceptance Criteria | Status | Evidence Type | Evidence |
|---------------------|--------|---------------|----------|
| AC1 — The inbox-only fleet is proven end to end | MET | command | `bun scripts/spur-dev.ts fleet-e2e` this run -> exit 0, 9 of 9 steps (scaffold, create-task, start-loops, dispatch-to-done, orchestrator-reply, kill-redispatch, guest-join, trace, teardown) — `.spur/run/G71-verifyall-e2e-final.log`; committed receipt `docs/reports/fleet-e2e-receipt.json:17-86`. |
- Coverage: N/A (verdict-based; verify pipeline does not measure code coverage)

### Review

<!-- spur:record-review -->

**SECU findings** (pipeline verify step — verdict: PASS)

| Priority | Dimension | Location | Finding |
|----------|-----------|----------|----------|
| P4 | — | — | No findings (verify verdict PASS) |

### References

- Plan: `docs/plans/2026-10-04-agent-fleet-inbox-redesign.md`
- ADRs: 057, 086, 121, 126 (amended 2026-10-04); 132 (new)
- Feature: see `feature_id`

### History

- 2026-10-04T20:57:55.158Z backlog → todo (system)
- 2026-10-06T04:53:29.913Z todo → wip (system)
- 2026-10-06T06:36:18.964Z wip → testing (system)
- 2026-10-06T06:47:40.755Z testing → done (system)

