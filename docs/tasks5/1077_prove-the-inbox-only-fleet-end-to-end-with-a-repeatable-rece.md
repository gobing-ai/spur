---
schema_version: 1
name: Prove the inbox-only fleet end to end with a repeatable receipt
status: todo
template: feature-impl
created_at: 2026-10-04T20:30:37.927Z
updated_at: "2026-10-04T20:57:55.158Z"
feature_id: G71

dependencies: ["1073", "1074", "1075", "1076", "1080", "1081"]
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

### Plan

1. Write the failure list first as a step table: each step's failure modes (timeout, wrong prompt, missing reply, missing lineage) map to assertion text.
2. Write the stub binary generator and the scaffold step.
3. Implement steps 2–9 with bounded polls and receipt rows.
4. Add `--inject-failure` and the nonzero exit.
5. Run it twice and diff the `{ step, status, assertion }` projection of the two receipts. Run with `--inject-failure trace` and expect exit 1.
6. Commit the script and the passing receipt.
7. Gate: `bun run spur-check`.

### Solution

<!-- Filled during implementation: file:line change map and concise rationale. -->

### Testing

<!-- Filled during verification: commands run, outcomes, coverage claim or N/A. -->

### Review

<!-- Filled during review: P1-P4 findings, residual risk, and final disposition. -->

### References

- Plan: `docs/plans/2026-10-04-agent-fleet-inbox-redesign.md`
- ADRs: 057, 086, 121, 126 (amended 2026-10-04); 132 (new)
- Feature: see `feature_id`

### History

- 2026-10-04T20:57:55.158Z backlog → todo (system)

