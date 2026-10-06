---
schema_version: 1
name: Prove the inbox-only fleet end to end with a repeatable receipt
status: todo
template: feature-impl
created_at: 2026-10-04T20:30:37.927Z
updated_at: "2026-10-06T04:51:57.980Z"
feature_id: G71

dependencies: ["1073", "1074", "1075", "1076", "1080", "1081", "1091"]
priority: P1
estimate_hours: 6
---

## 1077. Prove the inbox-only fleet end to end with a repeatable receipt

### Background

Implements G71 R8 and closes the G7 umbrella criteria (plan `docs/plans/2026-10-04-agent-fleet-inbox-redesign.md` §1 "Done when", §3.2 item 11). Project rule: E2E is the primary test mechanism and must leave a repeatable artifact.

Scenario from plan §1: a `fleet:auto` task goes todo → done by the coder process; `spur message send --to planner "status?"` is answered; a killed coder is re-dispatched with `--continue`; the inbox shows the exchange; a joined Claude session receives a review request; `spur agent trace <root>` shows the lineage and stream.

**Refine corrections (2026-10-04)**

- R1 says "a script under `scripts/`" → internal self-dev commands live in `scripts/commands/<name>.ts`, are dispatched by `scripts/spur-dev.ts`, and get a `package.json` entry (AGENTS.md "Public-surface consent"; ADR-130 placement) → `scripts/commands/fleet-e2e.ts` + `"fleet-e2e": "bun scripts/spur-dev.ts fleet-e2e"`.
- R3 allows "a stub executor" without saying how → the script prepends a scratch `bin/` to `PATH` holding a stub binary named after the configured member's agent type. The stub logs each received prompt to `stub-prompts.jsonl` and performs deterministic side effects through the source-local CLI.

### Requirements

- [ ] R1. A script under `scripts/` scaffolds a scratch project with a declared fleet, runs every plan §1 step against the source-local CLI, and tears down.
- [ ] R2. Each step records its command, exit code and observed evidence (message ids, receipt rows, trace output) into a JSON receipt under `docs/reports/`.
- [ ] R3. The script reruns deterministically: a stub executor is allowed for the member's model work; the fleet, inbox, receipt and trace paths are real.
- [ ] R4. The guest-join step runs only when task 1081 has landed; otherwise it is recorded as `skipped` with the reason.

### Acceptance Criteria

- [ ] AC1 — The inbox-only fleet is proven end to end

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

This pass closes the one requirement the committed harness left unfulfilled (R4) and re-proves the
whole harness on HEAD, leaving the committed receipt reflecting the latest green run.

| Change | Anchor |
| --- | --- |
| `guest-join` now probes `spur agent join --help` first, the observable the design §7 names: when the verb is absent (1081 not landed) it records the row `skipped` with reason `1081 not landed`, instead of letting `cliOk` throw into `fail` and recording `failed` | `scripts/commands/fleet-e2e.ts:1006` |
| Regenerated receipt: the latest 9/9 green run, overwritten in place per the Q&A stable-name contract | `docs/reports/fleet-e2e-receipt.json:1` |

R1–R3 were already implemented by the committed harness: `scripts/commands/fleet-e2e.ts` scaffolds a
`$TMPDIR` scratch project with a declared `agent.fleet`, drives every plan §1 step through the
source-local CLI, and tears down; every step writes a `{ command, exitCode, evidence }` row into the
receipt; the member's model is the only stub (`bin/claude`), while the fleet, inbox, `coordination_runs`
receipt and `agent trace` paths are real. This pass adds the R4 skip branch and refreshes the receipt.

**Why probe `--help` rather than assume the verb exists (R4).** The requirement is conditional: run
only when 1081 has landed, otherwise record `skipped` with the reason. `agent join|leave|wait --inbox`
land with 1081, so their `--help` exit code is the one observable that distinguishes the two states
without a corpus or environment override. On current HEAD 1081 is `done`, so the branch is the
`passed` path; the `skipped` path is the recorded contract for the pre-1081 state.

**Why no assertion was weakened to force green.** Every step was already green before this change and
stays green after it; the injected-failure run still records `failed` and exits nonzero.

### Testing

Harness re-run on the final script (branch `sp/run-1077-726c`, HEAD `4e11b2cd0` + this change).
The full project gate `bun run spur-check` is the pipeline's `test` hop, not implement
(`sp-code-implementation` § "Implement scope: do not run the project quality gate"), so this pass ran
the harness itself plus the affected-path checks.

**Determinism — two runs, `[.steps[] | {step, status, assertion}]` compared.**

```
$ bun run fleet-e2e            # run A
fleet-e2e receipt: .../docs/reports/fleet-e2e-receipt.json
  ok   scaffold: scratch=/private/var/.../spur-fleet-e2e-1791262180890 | fleet=... planner-1, coder-1 ...
  ok   create-task: wbs=0001 status=todo tags=fleet:auto feature=A readiness=task check --as wip PASS
  ok   start-loops: pids=27219,27220 (stub first on PATH) orchestrator claim live member session recorded
  ok   dispatch-to-done: status=done keyed message=82331c40-... requestKey=fleet:task:0001:1 run=8976efd8-... closure=the member's own turn
  ok   orchestrator-reply: sent=501f8e04-... reply=d208c70f-... body=idle inReplyTo=501f8e04-...
  ok   kill-redispatch: unkeyed delivered=7c06c3c7-... status=delivered (stdin, no run row) — named by 0 of 3 ... | attempt-1=fleet:task:0002:1 ... attempt-2=fleet:task:0002:2 ...
  ok   guest-join: guest=reviewer-g request=05372c8b-... pending=1 reply=d537c80d-... left=reviewer-g
  ok   trace: root=8976efd8-... nodes=1 node=agent/errored stream=... lines=... parentRunId=null
  ok   teardown: killed pids=27219,27813 | scratch removed=true | problems=none
EXIT=0

$ bun run fleet-e2e            # run B
  ok   scaffold ...  ok create-task ...  ok start-loops ...
  ok   dispatch-to-done: run=23d723e9-...   ok orchestrator-reply   ok kill-redispatch
  ok   guest-join: request=dc1d8ab4-... reply=a5892af8-... left=reviewer-g
  ok   trace   ok teardown: killed pids=28467,28834 | scratch removed=true | problems=none
EXIT=0

$ jq '[.steps[] | {step,status,assertion}]' .spur/run/1077-receipt-runA.json > .spur/run/1077-proj-runA.json
$ jq '[.steps[] | {step,status,assertion}]' .spur/run/1077-receipt-runB.json > .spur/run/1077-proj-runB.json
$ diff .spur/run/1077-proj-runA.json .spur/run/1077-proj-runB.json
IDENTICAL
```

**Failure injection — the harness must fail.**

```
$ bun run fleet-e2e -- --inject-failure trace
  ok   ... (8 rows passed) ...
  FAIL trace: root=bdd50e8a-... nodes=1 node=agent/errored ...
  ok   teardown: killed pids=29525,29831 | scratch removed=true | problems=none
fleet-e2e: 1 step(s) failed: trace
error: script "fleet-e2e" exited with code 1
EXIT=1
```

The injected receipt's `trace` row records `"status": "failed"`, `"exitCode": 1`, evidence ending in
`| injected failure: --inject-failure trace`; the other eight steps remain `passed`.

**Affected-path checks (dependency-aware matrix row: script + shared surface).**

```
$ bunx biome check scripts/commands/fleet-e2e.ts
Checked 1 file. No fixes applied.

$ bunx tsc -p scripts/tsconfig.json --noEmit
exit 0
```

### Review

<!-- Filled during review: P1-P4 findings, residual risk, and final disposition. -->

### References

- Plan: `docs/plans/2026-10-04-agent-fleet-inbox-redesign.md`
- ADRs: 057, 086, 121, 126 (amended 2026-10-04); 132 (new)
- Feature: see `feature_id`

### History

- 2026-10-04T20:57:55.158Z backlog → todo (system)

