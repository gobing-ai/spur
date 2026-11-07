---
schema_version: 1
name: Keep auto batches running past per-task pipeline failures with one pinned executor
status: done
template: feature-impl
created_at: 2026-11-07T08:05:53.809Z
updated_at: "2026-11-07T09:01:58.583Z"
feature_id: H51

priority: P1
ac_numbering: task-local
ac_altitude: task-local
estimate_hours: 2
done_forced: "false"
done_reason: unforced close; PASS artifact at .spur/memory/evidence/1318-verdict.json
---

## 1318. Keep auto batches running past per-task pipeline failures with one pinned executor

### Background

The 1294–1316 pi batch took about 33h wall clock, of which only about 4.1h was implement time. Breakdown, from `spur workflow trace` over the 37 task-pipeline runs plus the pi transcript:

- 13 of 37 runs reached `done`. Failed or cancelled runs consumed 10.4h.
- 9.1h was operator wait. The pi driver improvised a `batch-step.sh` loop that stopped the whole batch at every per-task failure, even though the operator had asked for an unattended `--auto` run. The skill allows it: `--auto` only refines-then-skips a *semantic precheck* failure (`execution-batch.md` "Semantic precheck failure under `--auto`"), and every other pipeline failure halts unless `--keep-going` is passed (§4.1).
- Six executors were used across the batch and 7 runs ended `failed-agent`. `--agent auto` is forwarded per task (§3.2), so each task re-resolves the tier chain and can land on a different executor. Each switch costs a cold context and makes runs incomparable.

Root cause: an unattended (`--auto`) batch still has a stop-for-a-human failure policy, and `--agent auto` is resolved per task instead of once per batch.

### Requirements

- [x] R1. Under `/sp:dev-runall --auto`, the failure policy is `--keep-going` (§4.2) whether or not the flag is passed. A failed, cancelled, `stale-evidence` or worker-lost (1317) task is recorded `failed`, its in-batch dependents are `skipped` with `dependency <wbs> failed`, and independent tasks keep running. Without `--auto`, the §4.1 stop-the-batch default is unchanged. No new flag.
- [x] R2. With `--agent auto` (sequential or parallel, non-inline), the driver pins one concrete executor for the batch. After the first task run it reads the resolved implement executor (`spur workflow trace <run> --json` → `.events[] | select(.node=="implement" and .actionKind=="agent.run") | .result.executor`) and dispatches every later task with `--agent <that executor>`. An explicit `--agent <name>` is already pinned and unchanged.
- [x] R3. A task whose run ends with `terminalReason == "failed-agent"` is re-dispatched exactly once with `--agent auto`. A different resolved executor then becomes the batch pin for the remaining tasks. If the retry also ends `failed-agent`, the task is `failed` under R1 and the pin is kept. Any other failure reason is never retried on a new executor.
- [x] R4. The batch report gains an executor column per task (pinned executor, or `A → B (failed-agent)` for a fallback) and a header line `Executor pin: <name> (from <wbs>|--agent)`. The `Mode:` line reads `--auto (keep-going)` under R1.
- [x] R5. The owning docs state R1–R4 consistently: `execution-batch.md` (semantic-precheck paragraph, §3.2, §4.1/§4.2), `dev-runall.md` (flag table for `--auto` and `--keep-going`), `flag-glossary.md` (`--keep-going` and `--auto` entries) and `execution-batch-report.md`. `plugins/sp` doc-contract tests, including `command-flag-parity` and `bootstrap-budget`, pass, and a contract test pins the R1 and R3 rules.

### Acceptance Criteria

```gherkin
Scenario: AC1 — An auto batch continues past a failed task (req: R1, R5)
  Given the runall driver contract in execution-batch.md and dev-runall.md
  When a batch runs with --auto and without --keep-going and a task's pipeline ends failed
  Then the documented policy marks that task failed, skips only its in-batch dependents, and runs independent tasks
  And without --auto the documented default still stops the batch at the first failure
```

```gherkin
Scenario: AC2 — An auto-selected executor is pinned for the whole batch (req: R2, R4)
  Given a batch dispatched with --agent auto
  When the first task's implement agent.run resolves executor X
  Then the documented driver dispatches every later task with --agent X and the report header records "Executor pin: X"
```

```gherkin
Scenario: AC3 — Fallback only on a failed-agent terminal reason (req: R3, R4)
  Given a pinned executor X and a task whose run ends terminalReason failed-agent
  When the driver applies the failure policy
  Then it retries that task once with --agent auto, pins the new executor Y for the rest of the batch, and the report shows "X → Y (failed-agent)"
  And a task failing with any other terminal reason is not retried on another executor
```

### Q&A

<!-- CLOSED decisions from refinement: what was chosen and why, what was deferred and on what
     condition. Not a parking lot for open questions — an unanswered question here means the task
     is not ready to hand off. Keep empty if none. -->

#### Q&A entry — 2026-11-07T08:13:56.309Z

- **Why not add `--no-keep-going`?** YAGNI, and a new flag goes against the command-surface rules. To stop on failure, run without `--auto`. `--auto` means "unattended", and an unattended batch that stops to wait for a human is the defect.
- **Code or prose?** Prose. The runall batch driver is the skill-defined loop in `execution-batch.md` (the host session or `sp:super-planner` executes it). There is no batch-driver module to change. Enforcement is the doc-contract test in R5, the same pattern as `batch-watch-bound-contract.test.ts`.
- **Where does the resolved executor come from?** The implement `agent.run` trace event's `result.executor`. It was verified on a 1294–1316 run, e.g. `{"agent":"codex-sol","executor":"codex-sol"}`. No new CLI field is needed.
- **Interaction with the in-run escalation ladder (0482 R1):** unchanged. A pinned run can still escalate inside one run on resource exhaustion. R3 covers only a run that terminates `failed-agent`.
- **`--agent inline` / omitted (host driver):** no executor to pin; R2 and R3 don't apply.

### Design

Docs-only behaviour change in the batch-driver contract, plus one contract test.

1. `plugins/sp/skills/spur-dev/references/execution-batch.md`:
   - "Semantic precheck failure under `--auto`": state that under `--auto` every per-task failure follows §4.2, and that the precheck refine pass is the extra step before it.
   - §3.2 `--agent` row: add the R2 pin rule (resolve once after the first run from the implement `agent.run` `result.executor`; dispatch later tasks with `--agent <executor>`) and the R3 fallback (once, `failed-agent` only, re-pin on success).
   - §3.3: list `failed-agent` as the only reason that triggers the R3 retry.
   - §4.1: "default unless `--auto`". §4.2: "`--keep-going`, or implied by `--auto`".
2. `plugins/sp/commands/dev-runall.md` flag table: `--keep-going` default → "off; on with `--auto`". Extend the `--auto` description to match.
3. `plugins/sp/skills/spur-dev/references/flag-glossary.md`: the same rule in the `--keep-going` and `--auto` entries (the glossary is the SSOT that `command-flag-parity` compares against).
4. `plugins/sp/skills/spur-dev/references/execution-batch-report.md`: the `Executor pin:` header line, an `Executor` column in the outcome table, and the `Mode:` value `--auto (keep-going)`.
5. New `plugins/sp/tests/batch-auto-failure-policy-contract.test.ts`, modelled on `batch-watch-bound-contract.test.ts`. It asserts that the four files carry the R1 sentence (auto implies keep-going), the R2 pin source (`result.executor`) and the R3 trigger (`failed-agent`, exactly once).

Budget: `execution-batch.md` is in the bootstrap budget (`plugins/sp/tests/bootstrap-budget.test.ts`; worktree mode about 89.6 KB of 110 KB). Keep additions to a few hundred bytes and don't raise the budget.

### Plan

- [x] 1. Write `plugins/sp/tests/batch-auto-failure-policy-contract.test.ts` first, asserting R1–R4 phrases in the four docs. Run it and confirm it fails.
- [x] 2. Edit `execution-batch.md` (precheck paragraph, §3.2, §3.3, §4.1, §4.2) for R1–R3.
- [x] 3. Edit `dev-runall.md` and `flag-glossary.md` flag semantics for R1.
- [x] 4. Edit `execution-batch-report.md` for R4.
- [x] 5. Focused checks: `(cd plugins/sp && bun test tests/batch-auto-failure-policy-contract.test.ts tests/command-flag-parity.test.ts tests/bootstrap-budget.test.ts tests/skill-structure.test.ts tests/batch-watch-bound-contract.test.ts)`. Then `bun run spur-check`.

### Solution

| File | Change |
| --- | --- |
| `plugins/sp/skills/spur-dev/references/execution-batch.md:152-158` | R1: `--auto` implies `--keep-going` — under `--auto` every per-task failure follows §4.2 (failed task `failed`, in-batch dependents `skipped`, independents run); the precheck refine pass is only the extra step before it. |
| `plugins/sp/skills/spur-dev/references/execution-batch.md:421-429` | R2/R3: the `--agent auto` executor pin — resolved once per batch from the first run's implement `agent.run` `result.executor`, dispatched to later tasks as `--agent <that executor>`; only a `terminalReason == "failed-agent"` ending re-dispatches, exactly once, and the new executor becomes the pin. |
| `plugins/sp/skills/spur-dev/references/execution-batch.md:531-535,556-559` | §4.1 is the default "unless `--auto`"; §4.2 is "`--keep-going`, or implied by `--auto`". |
| `plugins/sp/commands/dev-runall.md:20-22,53-56` | Flag table + prose: `--keep-going` default "off; on with `--auto`", `--auto` states the implied keep-going policy, `--agent auto` states the once-per-batch pin and the `failed-agent` fallback. |
| `plugins/sp/skills/spur-dev/references/flag-glossary.md:141-146,154-157` | The same rules in the `--auto` and `--keep-going` entries — the SSOT `command-flag-parity` compares against. |
| `plugins/sp/skills/spur-dev/references/execution-batch-report.md:23-28,33-40` | R4: the `Mode: --auto (keep-going)` value, the `Executor pin: <name> (from <wbs>\|--agent)` header line and the per-task `Executor` column (`A → B (failed-agent)` for a fallback). |
| `plugins/sp/skills/spur-dev/references/dev-operations.md:484` | R1 on the fifth owning surface: the runall Inputs line states `--keep-going` `(default off; `--auto` implies `--keep-going` …)` — the cross-surface parity gate (C2) rejects a command table and this Inputs line disagreeing about the default. |
| `plugins/sp/tests/batch-auto-failure-policy-contract.test.ts` | New doc contract (modelled on `batch-watch-bound-contract.test.ts`) pinning R1's sentence on all four surfaces, R2's `result.executor` source and `Executor pin` line, R3's `failed-agent`-only "exactly once" retry, and R4's report shape. |

No code change: the batch driver is the skill-defined loop in `execution-batch.md` (the host session or `sp:super-planner` executes it), so the policy is enforced as a doc contract.

### Testing

**Pipeline verify results**

- Verdict: PASS (from verdict artifact)

| Requirement | Status | Evidence |
|-------------|--------|----------|
| R1 | MET | `plugins/sp/skills/spur-dev/references/execution-batch.md:152-158` states `--auto` implies `--keep-going`: under `--auto` every per-task failure follows §4.2 (failed task `failed`, in-batch dependents `skipped` with `dependency <wbs> failed`, independents keep running), with §4.1's stop-the-batch default scoped to "without `--auto`" (`plugins/sp/skills/spur-dev/references/execution-batch.md:531-535`) and §4.2 named "`--keep-going`, or implied by `--auto`" (`plugins/sp/skills/spur-dev/references/execution-batch.md:556`). No new flag. Mirrored on the other owning surfaces: `plugins/sp/commands/dev-runall.md:20-22`, `plugins/sp/skills/spur-dev/references/flag-glossary.md:141-146,154-157`, `plugins/sp/skills/spur-dev/references/dev-operations.md:484`. |
| R2 | MET | `plugins/sp/skills/spur-dev/references/execution-batch.md:421-425` pins `--agent auto` once per batch: the resolved implement executor is read from `spur workflow trace <run> --json` → `.events[] |
| R3 | MET | `plugins/sp/skills/spur-dev/references/execution-batch.md:425-429` — a run ending `terminalReason == "failed-agent"` is re-dispatched **exactly once** with `--agent auto`, the newly resolved executor becomes the pin, a second `failed-agent` records the task `failed`, and no other terminal reason is ever retried on a new executor. |
| R4 | MET | `plugins/sp/skills/spur-dev/references/execution-batch-report.md:23-28` sets the `Mode: --auto (keep-going)` value and the `Executor pin: <name> (from <wbs> |
| R5 | MET | `plugins/sp/tests/batch-auto-failure-policy-contract.test.ts` pins R1's sentence on all five owning surfaces, R2's `result.executor` source and the `Executor pin` line, R3's `failed-agent`-only "exactly once" retry and R4's report shape. Doc-contract suites green: `plugins/sp/tests/command-flag-parity.test.ts`, `plugins/sp/tests/bootstrap-budget.test.ts`, `plugins/sp/tests/skill-structure.test.ts`, `plugins/sp/tests/batch-watch-bound-contract.test.ts` — 223/223, and `scripts/commands/flag-contract-parity.test.ts` 40/40. |

| Acceptance Criteria | Status | Evidence Type | Evidence |
|---------------------|--------|---------------|----------|
| AC1 — An auto batch continues past a failed task (req: R1, R5) | MET | test | `plugins/sp/tests/batch-auto-failure-policy-contract.test.ts` "R1: `--auto` implies `--keep-going` on every owning surface, and the non-auto default still halts" asserts both halves across the five docs (`plugins/sp/skills/spur-dev/references/execution-batch.md:152-158`). |
| AC2 — An auto-selected executor is pinned for the whole batch (req: R2, R4) | MET | test | `plugins/sp/tests/batch-auto-failure-policy-contract.test.ts` "R2" (pin source `result.executor`, dispatch form, `Executor pin` header) and "R4" (report column + mode value) cases over `plugins/sp/skills/spur-dev/references/execution-batch.md:421-425` and `plugins/sp/skills/spur-dev/references/execution-batch-report.md:23-40`. |
| AC3 — Fallback only on a failed-agent terminal reason (req: R3, R4) | MET | test | `plugins/sp/tests/batch-auto-failure-policy-contract.test.ts` "R3: only `failed-agent` re-dispatches, exactly once…" asserts the trigger, the single retry and the "No other terminal reason" clause over `plugins/sp/skills/spur-dev/references/execution-batch.md:425-429`. |
- Coverage: N/A (verdict-based; verify pipeline does not measure code coverage)

### Review

Scope: the five owning doc surfaces (`execution-batch.md`, `execution-batch-report.md`, `flag-glossary.md`, `dev-operations.md`, `dev-runall.md`) and the new doc contract. Reviewed the wording against its consumers and against the remaining batch references, not only against the test's assertions.

| Priority | Finding | Location | Disposition |
| --- | --- | --- | --- |
| P4 | none found | — | — |

Checked: the surfaces agree after the cross-surface parity gate's own normalization — the gate caught the first draft's `--keep-going` default disagreement between `plugins/sp/commands/dev-runall.md:20` and `plugins/sp/skills/spur-dev/references/dev-operations.md:484`, and the corrected wording is in the tree; the additions stay inside the bootstrap budget (`execution-batch.md` worktree mode passes `plugins/sp/tests/bootstrap-budget.test.ts`); no new noun, verb or flag; `--agent inline` is explicitly out of scope for the pin (R2/R3); §3.2's dispatch pin and §4.2's batch failure policy do not collide (one governs later dispatches, the other the batch loop).

Residual risk: the policy is prose-enforced by contract tests rather than by code — there is no batch-driver module (`execution-batch.md` *is* the driver), which the task's Q&A decided deliberately. The tests bind the wording; a future rewrite of the loop must keep reading it.

Confidence: HIGH
Verdict: PASS

### References

- Feature H51 (batch execution reliability guardrails; reopened from done for this task).
- `plugins/sp/skills/spur-dev/references/execution-batch.md`: "Semantic precheck failure under `--auto`", §3.2 (flag passthrough), §3.3, §4.1/§4.2. `execution-batch-report.md`, `flag-glossary.md` `#flag-keep-going`, `plugins/sp/commands/dev-runall.md`.
- `packages/app/src/services/agent-resolver.ts:112-145` (auto vs pinned resolution, 0482 escalation ladder).
- Evidence: 37 runs and 7 `failed-agent` endings in the 1294–1316 batch (`spur workflow trace --workflow task-pipeline --since 2026-11-05 --json`).
- Sibling: 1317 (supplies the worker-lost failure that R1 skips past).

### History

- 2026-11-07T08:14:05.785Z backlog → todo (system)
- 2026-11-07T08:51:45.486Z todo → wip (system)
- 2026-11-07T09:01:45.766Z wip → testing (system)
- 2026-11-07T09:01:58.578Z testing → done (system)

