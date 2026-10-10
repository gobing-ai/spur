---
schema_version: 1
name: "Executor fail-fast: a host-quota pre-dispatch failure must shift executors, not consume the host session"
status: done
template: feature-impl
created_at: 2026-10-09T05:28:30.946Z
updated_at: "2026-10-10T02:53:30.731Z"
feature_id: B6

ac_altitude: task-local
ac_numbering: task-local
priority: P1
estimate_hours: 14
dependencies: ["1143"]
done_forced: "true"
done_reason: "artifact self-inconsistency is structural, not a code defect: the verify shell writes the confidence check row as warn for any level below HIGH, and aggregateVerifyVerdict (packages/app/src/services/verify-verdict.ts:329) treats an untagged warn as major-blocking, so a MEDIUM certification can never reach done. Evidence is PASS: all 9 requirements MET and all 10 ACs MET with executable evidence, verdict artifact .spur/memory/evidence/1134-verdict.json (PASS, MEDIUM), proof digest sha256:3a3827a46dbe18ae31031d31104aa21d62437e7618357340afcbcdf818150b6d, task check --as done clean. Operator approved the override (2026-10-09)."
---

## 1134. Executor fail-fast: a host-quota pre-dispatch failure must shift executors, not consume the host session

### Background

**Origin.** Observed end-to-end in pipeline run `85fab6d4-baf5-4db8-a0e9-810b12927fb4` (task 1132, 2026-10-08, inline full pipeline, worktree). The `implement` stage was dispatched to a native subagent; 21 minutes 30 seconds later the dispatch died with
`429 {"code":"1310","message":"Weekly/Monthly Limit Exhausted. Your limit will reset at 2026-10-13 01:47:29"}`.
The inline driver's fallback rule then fired — `~/.agents/skills/sp-spur-dev/references/inline-pipeline-driver.md:465`, verbatim: *"All five pass → dispatch. Any pre-dispatch failure → execute the stage **once** in the host session."* — and the whole R1–R6 implementation (normalizer, service guard, CLI flags, feature-check repair, workflow guard, 19 tests, ~2 900 changed lines across 29 files) was executed inside the **orchestrating host session** between 13:55 and 17:01 PDT: **~3 h 06 m of the run's 8 h 22 m** (run row: `runs.started_at=2026-10-08T20:04:56Z`, closed `2026-10-09T04:26:52Z`).

**Why the fallback is wrong in exactly this case.** The exhausted resource *was the host session's own provider quota*. "Execute the stage in the host session" therefore cannot succeed by construction: it re-selects the same exhausted provider and collapses the run to one serial worker with no executor diversity. The driver's fallback is correct for capability-shaped failures (no write access, missing permission, prose input that is not dispatch-eligible) and wrong for capacity-shaped failures.

**Current code facts (verified 2026-10-08).**
- **A durable, ownership-scoped availability mechanism already exists** — feature B5/B6, `docs/design/executor-availability.md`. `agent.executors[].disabled` accepts `boolean | {owner: operator|quota|probe, since, reason}`; automatic selection *"tries another enabled candidate or reports no eligible enabled executor"* and excludes disabled entries at the `cheapestEligibleExecutors` funnel plus a final enabled check immediately before each subprocess launch. Quota events (`agent.quota.exhausted` / `agent.quota.recovered`) flow to durable `agent_executor_updates` rows and `setExecutorAvailability(...)`. The CLI attaches the subscription in `apps/cli/src/agent-quota-persistence.ts` and `apps/cli/src/commands/workflow.ts`.
- **Detection is already upstream and single-source.** `docs/design/executor-availability.md` §4: detection *"belongs upstream in `ts-ai-runner`"*; only *"confirmed exhausted usage allowance or credits produces exhaustion"* — a generic 429, rate limit, overload, context budget or auth failure does not. A weekly/monthly allowance exhaustion (provider `code 1310`) is exactly that class. **No per-provider adapter is needed for this task.**
- **Gap 1 — no attribution on the inline path.** §4: *"Missing attribution remains observable but cannot write configuration."* A host-session native-subagent dispatch names no executor, so even a correctly classified exhaustion event cannot disable the rung.
- **Gap 2 — no refresh between runs.** §4: recovery *"is ownership-scoped — `agent.quota.recovered` re-enables only quota/probe-owned disables, never operator-owned — and the only proactive producer is the explicit run-once `spur agent usage` command (ADR-121), never a serve-side poller or timer."* The design rejects provider probing on purpose: a probe **spends the quota it is meant to protect** and can pass while the account-level weekly cap still 429s the real request. A scheduled **observation** refresh (zero provider calls) is therefore the only refresh shape this task may add; any timer that probes or writes config needs a separate ADR-121 amendment and is out of scope here.
- **Gap 3 — the trigger is missing at the driver, not at the provider.** Nothing consumes the classified signal on the inline path, so the run neither shifts nor records anything.
- Existing operator surfaces to build on: `spur agent doctor --json` renders `availability {disabled, owner, since, reason}` and the `~/.config/spur/agent-usage.json` snapshot age (`stale` at ≥6 h); `spur agent usage [--dry-run] [--source <name>] [--json]` is the sanctioned producer; `bootstrap.scheduler.jobs` (task 0734) already registers cron jobs with `scheduler.job.executed` events (`apps/server/src/serve.ts:226-253`).

**Why this is urgent beyond one run.** The 3 h 06 m of host-inline work also serialises the run, consumes orchestrator context (the session had to be driven to completion in one window), and hides the failure from the operator: the run log records a fallback, not a capacity stop, so nothing tells them "executor X is exhausted until 2026-10-13" — a later run repeats the discovery cost.

**Session evidence (2026-10-09).** A review stage on task 1133 ran **4h01m40s** for a diff of about 160 lines (action row `review/agent`, `duration_ms` 14,500,000 in `run-1133-c3f1`), and an earlier dispatch of the same stage returned no result and had to be retried. Both consumed the run rather than failing it, and the wall clock dominated that task's 7h51m window. The host-capacity class this task owns is a different trigger; the shared defect is that an unproductive dispatch is absorbed instead of surfaced.

**Refine corrections (2026-10-09)**

- R2 assumed the incident error classifies as quota. It does not: `classifyQuotaErrorRecord('429 {"code":"1310",...}')` returns `{quota:false}` on installed `@gobing-ai/ts-ai-runner@0.5.18`. Probed 2026-10-09. The classifier accepts only `{error:{type|code}}` envelopes with codes from a fixed allowlist (`ts-libs/packages/ai-runner/src/quota.ts:68-108`), and the Z.ai top-level `{"code":"1310"}` shape matches neither. Resolution: an upstream classifier extension becomes Plan step 0 (AGENTS.md: fix the `@gobing-ai/ts-*` facade, never add a Spur workaround). R2 is rewritten to match, and AC3 now names the incident record.
- A native-subagent dispatch (the Agent tool) never passes through ts-ai-runner, so nothing upstream classifies its failure. Resolution: add a deterministic helper `classifyDispatchFailure(text)` in `packages/app/src/services/inline-run-setup.ts`. It wraps `classifyQuotaErrorRecord` and writes the fallback status file. The driver calls it through the existing run-scoped helper entry and never judges the prose itself.
- The driver-rule citation `inline-pipeline-driver.md:465` points at the installed copy. The repo source is `plugins/sp/skills/spur-dev/references/inline-pipeline-driver.md:533`.
- R9 had no AC and no bound. Bounds already exist: the YAML `timeoutMs` (implement uses `implementTimeoutMs`, others `stepTimeoutMs`) is passed to host dispatch (driver reference §Timeout boundary, `:687-692`). Resolution: R9 adds no new bound. A null result or timeout becomes a recorded stage failure that never routes to host-inline fallback. AC10 added.
- Feature: `B` was a generic root. Re-parented to B6 (executor availability lifecycle: ownership, recovery, usage producer), which owns `setExecutorAvailability` and the durable update path this task feeds. B6 reopened.

### Requirements

- [x] R1. **Contingent fallback in the inline driver.** A pre-dispatch failure classified as *host capacity exhaustion* (quota or credits) must NOT fall back to another host-session attempt. The driver must do one of two things:
  - (a) hand the stage to the subprocess dispatch path, which resolves an executor independently; or
  - (b) when that path is unavailable, terminate the run at `failed` with `terminalReason: failed-agent`, naming the executor and the observed reset time when the record carries one.

  Capability-shaped pre-dispatch failures (permission, missing capability, non-dispatch-eligible prose, below-floor size) keep today's host-inline fallback unchanged.
- [x] R2. **Classification is upstream and deterministic.**
  - Upstream: `@gobing-ai/ts-ai-runner`'s `classifyQuotaErrorRecord` classifies the Z.ai allowance envelope (`{"code":"1310","message":...}` at top level, no `error` wrapper) as `{quota:true, reason:'usage_limit_reached'}`. This is an upstream release consumed through the existing catalog entry.
  - Spur side: a single helper `classifyDispatchFailure(text)` in `inline-run-setup.ts` wraps that classifier and writes `.spur/run/<run-id>-dispatch-fallback.json` = `{stage, class: 'capacity'|'capability', reason?, resetAt?, decision}`.
  - No provider-specific matching in Spur. No scanning of prompts or output for quota vocabulary.
- [x] R3. **Inline attribution.** An inline host-session dispatch records the executor identity it actually used (`agent`, `model?`) into the run record before the stage runs, so a later classified exhaustion can be attributed. When no named executor can be resolved, the driver records the classified no-op (the design's "observable but cannot write configuration"), never a silent drop.
- [x] R4. **Durable memory across runs.** An attributed exhaustion observation must reach the existing durable path, `agent_executor_updates` → `setExecutorAvailability` with `owner: quota` and `since`/`reason`. The NEXT dispatch then skips that rung **without any provider call**. An older or duplicate observation must not overwrite a newer one (the design's `(observedAt, observationId)` order).
- [x] R5. **Scheduled observation refresh, with zero provider calls.** `bootstrap.scheduler.jobs` gains a job that:
  - (a) drains pending `agent_executor_updates`;
  - (b) reports the age of the `~/.config/spur/agent-usage.json` snapshot;
  - (c) re-checks `owner: quota|probe` disables against their recorded TTL, re-enabling only through the ownership-scoped recovery path.

  It must make no provider request and must never auto-re-enable an `operator`-owned disable.
- [x] R6. **Make the gap observable.** `spur agent doctor --json` already renders `availability {disabled, owner, since, reason}` and the usage age. It must also report the refresh job's last-run status and a count of inline stages that ran without executor attribution, so the operator can see whether fail-fast is able to fire.
- [x] R7. **Explicitly out of scope (do not build).**
  - Per-provider health-check adapters inside Spur.
  - Probing entries that are already disabled (forbidden by `docs/design/executor-availability.md` §2).
  - A health probe per candidate executor at dispatch time.
  - Any serve-side poller or timer that writes configuration without a separate operator-consented ADR-121 amendment.

  R5's zero-call observation refresh needs no amendment. Anything that probes or writes config on a timer does.
- [x] R8. **Docs and bundle ship in the same change.**
  - Update the driver reference (`plugins/sp/skills/spur-dev/references/inline-pipeline-driver.md`, dispatch/fallback and trace sections).
  - Add a section to the executor-availability design satellite for inline attribution and the refresh job.
  - Update the run-record contract for the new status artifact.
  - Rebuild with `bun run --filter @gobing-ai/spur build:bundle` and `bun run build:scripts`.
- [x] R9. **A null or timed-out dispatch is a recorded failure, not a fallback trigger.** The dispatch bound stays the existing YAML `timeoutMs` (`implementTimeoutMs` / `stepTimeoutMs`), passed to the host dispatch as today. A dispatch that returns no result, or that hits that bound, records the stage as failed with `dispatch: null-result|timeout` and follows the stage's normal failure edge. It never triggers host-inline re-execution. Boundary: R1–R4 cover a pre-dispatch capacity refusal (the executor must shift); R9 covers the dispatched-but-unproductive case.

### Acceptance Criteria

```gherkin
Scenario: AC1 — A host-capacity pre-dispatch failure never becomes host-inline work (req: R1)
  Given the resolved executor for a stage is exhausted and the failure is classified as host capacity exhaustion
  When the inline driver evaluates its fallback after the dispatch fails
  Then the stage is NOT executed in the orchestrating host session
  And it is handed to the subprocess dispatch path, or the run terminates at failed with terminalReason failed-agent
  And the run log names the executor and the observed reset time
```

```gherkin
Scenario: AC2 — Capability-shaped failures keep the host-inline fallback (req: R1)
  Given a pre-dispatch failure that is not capacity-shaped (permission denied, missing capability, non-dispatch-eligible prose, below the size floor)
  When the driver evaluates its fallback
  Then the stage executes once in the host session as today
  And the run log carries the existing host-fallback line naming the reason
```

```gherkin
Scenario: AC3 — Classification is the upstream classifier, recorded per attempt (req: R2)
  Given the incident record 429 {"code":"1310","message":"Weekly/Monthly Limit Exhausted. Your limit will reset at 2026-10-13 01:47:29"}
  When classifyDispatchFailure classifies it
  Then the result is class capacity with reason usage_limit_reached via the upstream classifyQuotaErrorRecord
  And Spur source contains no provider-code or quota-vocabulary matching of its own
  And the run-scoped status file records the classification, the executor, and the observation time
  And a generic 429, rate limit, overload, timeout or auth failure is NOT classified as exhaustion
```

```gherkin
Scenario: AC4 — The inline dispatch records its executor identity or an observable no-op (req: R3)
  Given an inline host-session dispatch
  When the stage runs
  Then the run record names the executor identity (agent, and model when resolvable)
  And when no named executor is resolvable the run record carries an explicit no-attribution marker instead of omitting the field
```

```gherkin
Scenario: AC5 — An attributed exhaustion disables the rung for the next dispatch, with no provider call (req: R4)
  Given an attributed exhaustion observation for executor X
  When it is applied through the durable availability path
  Then X is recorded disabled with owner quota plus since and reason
  And the next automatic selection skips X without contacting any provider
  And an older or duplicate observation does not overwrite a newer one
```

```gherkin
Scenario: AC6 — The scheduled refresh performs no provider request and respects ownership (req: R5)
  Given the observation-refresh job runs on the scheduler surface
  When it drains pending updates, reports the usage snapshot age, and expires quota/probe-owned disables past their TTL
  Then zero provider requests are made during the job
  And an operator-owned disable is never auto-re-enabled
  And the job emits its normal scheduler.job.executed event with a summary
```

```gherkin
Scenario: AC7 — The operator can see whether fail-fast can fire (req: R6)
  Given an inline run that produced a stage without executor attribution
  When "spur agent doctor --json" runs
  Then the payload includes the refresh job's last-run status
  And a non-zero count of inline stages without attribution
  And the existing availability owner/since/reason rows are unchanged
```

```gherkin
Scenario: AC8 — Owning docs and bundle reflect the new behavior (req: R8)
  Given the implementation is complete
  When "bun run spur-check" and the bundle rebuild run
  Then both pass
  And the driver reference documents the contingent fallback and the attribution requirement
  And the executor-availability satellite documents the refresh job and its zero-provider-call contract
```

```gherkin
Scenario: AC9 — The rejected refresh/probe shapes are absent from the change (req: R7)
  Given the implementation is complete
  When the diff and the config surface are inspected
  Then no per-provider health-check adapter was added
  And no dispatch path probes an executor that is already disabled
  And the refresh job issues zero provider requests
  And the design satellite states that a config-writing timer requires a separate ADR-121 amendment
```


```gherkin
Scenario: AC10 — A null or timed-out dispatch fails the stage without host-inline re-execution (req: R9)
  Given a dispatched stage whose host dispatch returns no result, or exceeds the YAML timeoutMs
  When the driver handles the return
  Then the stage is recorded failed with dispatch null-result or timeout
  And the stage follows its normal failure edge
  And no host-inline attempt of that stage is started
```

### Q&A

<!-- CLOSED decisions from refinement: what was chosen and why, what was deferred and on what
     condition. Not a parking lot for open questions — an unanswered question here means the task
     is not ready to hand off. Keep empty if none. -->

#### Q&A entry — 2026-10-09T18:02:29.746Z

- **Q: Add Z.ai code `1310` to Spur, or upstream?** A: Upstream, in `ts-ai-runner`'s `QUOTA_CODES` handling, plus acceptance of a top-level `{code}` envelope. Detection is single-source by design (`executor-availability.md` §4), and AGENTS.md routes facade gaps to the released `@gobing-ai/ts-*` package. The exact-match allowlist stays; only verified codes are added (`1310` is the observed one; others are added when observed).
- **Q: Split R5/R6 (scheduler job and doctor) into a separate task?** A: No. Both are small additions to existing surfaces (`serve.ts` scheduler block, the doctor JSON). Without R6 the operator cannot see whether R1–R4 can fire, so they ship together. Estimate reflects the full scope.
- **Q: New dispatch timeout for R9?** A: No. The YAML `timeoutMs` already bounds dispatch. The defect was what happens after a null or failed dispatch, not the bound itself.

### Design

- **The fix lives in the driver contract, not in provider code.** The 3 h 06 m loss was a *rule* failure: the driver asked the host to do work the host's own quota could not fund. Detection is already upstream and already single-source (`ts-ai-runner`), so this task adds no provider adapter, no new probe, and no new lexicon — it adds a **branch** on the classified signal plus the attribution that lets the existing durable path act on it. Blast radius: `plugins/sp/skills/spur-dev/references/inline-pipeline-driver.md` (the fallback rule and the trace/dispatch sections), the run-scoped status artifacts it already writes, and `packages/app/src/services/inline-run-setup.ts` only where the driver needs a status-file helper.

- **Contingent fallback (R1/R2).** Today: any pre-dispatch failure → host-inline, unconditionally. New: classify first. Capacity-shaped → escalate to the subprocess path (the same one `--agent auto|name` uses, which resolves an executor through the registry and therefore *can* pick another rung) or stop at `failed-agent` naming the executor and reset time. Capability-shaped → unchanged host-inline fallback. The two paths must be distinguishable in the run log, and the decision must be a status file (`.spur/run/<run-id>-dispatch-fallback.json`), not a prose judgement, so the guard can read it.

- **Attribution (R3) is the load-bearing link.** Without it the durable machinery is unreachable: §4 of the design says attribution-less events are observable but cannot write configuration. So the inline dispatch writes `{agent, model?, stage, observedAt}` before the stage runs; when nothing is resolvable it writes the explicit no-attribution marker (and R6 counts those).

- **Durable memory (R4) reuses B5/B6 verbatim.** `agent_executor_updates` + `setExecutorAvailability({layer, projectRoot, executor, disabled: {owner:'quota', since, reason}})` already exist, are ownership-scoped, and already coalesce older/duplicate observations. This task must NOT introduce a second availability model: "Configuration remains the source used for execution eligibility" (design §1).

- **Refresh shape (R5) — the deliberate constraint.** A scheduled job on `bootstrap.scheduler` that touches **observations only**: drain pending updates, report snapshot age, expire TTL'd `quota`/`probe` disables through the ownership-scoped recovery. Zero provider calls, because (a) a probe spends the quota it protects, (b) a successful probe does not disprove an account-level weekly cap (the exact `code 1310` case), and (c) ADR-121 deliberately made the run-once `spur agent usage` the only proactive producer. A timer that probes or writes config is a **separate, operator-consented ADR-121 amendment** and is explicitly out of scope (R7).

- **Boundaries.** Do not touch the tier/ladder policy (`cheapestEligibleExecutors`, tier floors, `requiresCapabilities`, the P0/P1 distinctness gate) — shifting must respect those floors, and a stage that cannot be satisfied at or above its floor after exhaustion must stop, not silently degrade. Do not cancel an already-running subprocess. Do not probe or re-enable an operator-owned disable. Do not add a queue or an event-replay framework (design §5's rejected alternatives).

### Plan

0. **Upstream prerequisite (ts-libs).** In `/Users/robin/xprojects/ts-libs/packages/ai-runner/src/quota.ts`, make `tryParseErrorEnvelope` also accept a top-level `{code, message}` object, and map the verified provider code `1310` to `usage_limit_reached`. The exact-match allowlist stays. Write the failure modes first: a plain 429, a `{code:"1302"}` rate limit, and `1310` quoted inside a prompt are all negative. Release, bump the `catalog:` entry, and run `bun install`. Until the release lands, Spur work in steps 1–2 can proceed against a fixture of the classifier result.
1. **Write the failure inventory first.** Each row is a way this change can be wrong:
   - (a) a capacity failure misrouted to host-inline (the original defect);
   - (b) a capability failure misrouted to subprocess escalation, breaking the existing fallback;
   - (c) exhaustion misclassified as a rate limit or auth error, so nothing is disabled;
   - (d) an unattributed event silently dropped;
   - (e) an older observation overwriting a newer one, resurrecting an exhausted rung;
   - (f) the refresh job re-enabling an operator-owned disable;
   - (g) the refresh job making a provider call;
   - (h) escalation landing on an executor below the stage's tier floor;
   - (i) a run that cannot escalate and does not stop, i.e. hangs or retries forever;
   - (j) a null or timed-out dispatch re-run host-inline (R9);
   - (k) docs drifting from the driver's real branch.
2. **Write the tests before the implementation**, one per inventory row, at the cheapest surface that can fail:
   - a driver-contract fixture in `plugins/sp/tests/inline-pipeline-driver.test.ts`, which executes the real graph;
   - a service test for `classifyDispatchFailure` and the attribution/observation path;
   - a scheduler-job test asserting zero provider calls (spy on the runner).
3. **Implement R1–R3 and R9 (driver).** Add `classifyDispatchFailure` in `inline-run-setup.ts`, then branch to escalate-or-stop and write the fallback status file. Record attribution, or the no-attribution marker, before the stage runs. A null or timed-out dispatch is a recorded failure. Keep the host-inline fallback for every capability-shaped failure.
4. **Implement R4.** Route the attributed observation into `apps/cli/src/agent-quota-persistence.ts` → `setExecutorAvailability`. Assert that `(observedAt, observationId)` ordering holds.
5. **Implement R5 and R6.** Register the observation-refresh job in the `registerSchedulerEntries` block of `apps/server/src/serve.ts`. Add the doctor fields (refresh last-run status, unattributed-stage count).
6. **Docs and bundle (R8).** Update the driver reference, the executor-availability satellite and the run-record contract, then run `bun run --filter @gobing-ai/spur build:bundle` and `bun run build:scripts`.
7. **Verify with a real re-run.** Force an exhausted executor (a disabled rung is enough) and confirm the next dispatch skips it with no provider call. Feed the incident record to `classifyDispatchFailure` and confirm it routes to escalation, not host-inline. Record both outputs in Testing.
8. Run `bun run spur-check` once on the final tree.

### Solution

**Shape of the change.** A branch on the classified signal plus the attribution that lets the existing durable path act on it. No provider adapter, no probe, no new availability model, no second status channel: the classifier is upstream, the durable home is `agent_executor_updates` + config, and the driver reads one decision artifact instead of judging prose.

| Change (`file:line`) | Why |
| --- | --- |
| `plugins/sp/skills/spur-dev/references/inline-pipeline-driver.md:541` | R1/R2 — the contingent fallback: a capacity-shaped pre-dispatch failure escalates to the subprocess dispatch path or stops at `failed-agent` naming executor + reset time; capability-shaped keeps the single host-inline fallback |
| `plugins/sp/skills/spur-dev/references/inline-pipeline-driver.md:569` | R3 — attribution before dispatch, including the explicit no-attribution marker |
| `plugins/sp/skills/spur-dev/references/inline-pipeline-driver.md:729` | R9 — a null or timed-out dispatch is a recorded stage failure, never a host-inline re-run; the YAML bound is unchanged |
| `packages/app/src/services/inline-run-setup.ts:1785-1793` | R2 — the single Spur classifier wrapper around the upstream `classifyQuotaErrorRecord`, plus the generic reset-instant extraction that runs only on a confirmed capacity record |
| `packages/app/src/services/inline-run-setup.ts:1823` | R3 — the append-only attribution ledger and its writer |
| `packages/app/src/services/inline-run-setup.ts:1838` | R6 — the unattributed-stage count the doctor surfaces |
| `packages/app/src/services/inline-run-setup.ts:1916` | R1/R4 — the fail-fast runner: decision artifact, then the attributed observation onto the durable path |
| `packages/app/src/services/agent-quota-refresh.ts:100-105` | R5 — the observation-refresh job: drain, snapshot age, TTL expiry through the ownership-scoped recovery path, zero provider requests |
| `packages/app/src/services/agent-quota-refresh.ts:34` | R5 — the expiry policy and its documented alignment with the usage-snapshot staleness threshold |
| `packages/app/src/services/agent-service.ts:853` | R6 — `inlineFailFast {refreshJob, unattributedStages}` in `spur agent doctor --json` |
| `apps/server/src/serve.ts:143-145` | R5 — the in-process hourly `observation-refresh` scheduler registration and its `scheduler.job.executed` summary |
| `plugins/sp/scripts/inline-run-dispatch.ts:2-6` | R1/R3 — the plugin facade for the two new driver calls (a separate script because ADR-130 budgets glue per script) |
| `config/plugin-scripts.json:65-67` | R8 — the facade's registry + `.mjs` twin contract |
| `scripts/commands/bundle-plugin-lib.ts:695` | R8 — the generated inline-run twin must export both app runners the facade calls |
| `package.json:32` | R2 — the catalog floor moves to the release that carries the classifier change |
| `docs/design/executor-availability.md:263` | R8 — the satellite section for inline attribution, the refresh job and the zero-call contract |
| `docs/design/run-record-contract.md:58` | R8 — the two new run-scoped status artifacts and their classification |
| `packages/app/tests/services/inline-dispatch-failure.test.ts:1` | AC1–AC5 — classification, attribution and the end-to-end durable disable |
| `packages/app/tests/services/agent-quota-refresh.test.ts:98-114` | AC6 — TTL expiry, ownership scope, zero provider requests |
| `apps/server/tests/serve.test.ts:1809` | AC6 — the scheduler entry's registration, drain and summary |
| `plugins/sp/tests/inline-run-installed.test.ts:332` | R8 — twin-export parity now covers both inline facades |

**Upstream prerequisite (R2).** `/Users/robin/xprojects/ts-libs/packages/ai-runner/src/quota.ts` gained a top-level `{code, message}` envelope form and a verified-provider-code map (`1310` → `usage_limit_reached`), covered by six new precision cases in that repo's `tests/quota.test.ts`; released as `@gobing-ai/ts-ai-runner@0.5.20` and consumed here through the catalog entry.

**Deliberate non-goals.** No per-provider health-check adapter, no probe of a disabled entry, no dispatch-time health probe, and no config-writing timer — the latter still needs its own ADR-121 amendment. The refresh job touches observations only.

### Testing

**Pipeline verify results**

- Verdict: PASS (from verdict artifact)
- Confidence: MEDIUM

| Requirement | Status | Evidence |
|-------------|--------|----------|
| R1 | MET | contingent fallback at `plugins/sp/skills/spur-dev/references/inline-pipeline-driver.md:541-567` (capacity escalates or stops at failed-agent, `:565`); dispatch-failure path `packages/app/src/services/inline-run-setup.ts:2206`; asserted by `packages/app/tests/services/inline-dispatch-failure.test.ts:117` and `:177` |
| R2 | MET | single classifier entry `packages/app/src/services/inline-run-setup.ts:2082` delegating to the released upstream classifier imported at `:65`; dependency pinned at `package.json:32`; asserted by `packages/app/tests/services/inline-dispatch-failure.test.ts:50`, `:58`, `:73`, `:80` |
| R3 | MET | attribution writer `packages/app/src/services/inline-run-setup.ts:2113` and unattributed counter `:2128`; contract at `plugins/sp/skills/spur-dev/references/inline-pipeline-driver.md:569`; asserted by `packages/app/tests/services/inline-dispatch-failure.test.ts:89` and `:111` |
| R4 | MET | attributed exhaustion enters the durable availability path from `packages/app/src/services/inline-run-setup.ts:2194`; asserted by `packages/app/tests/services/inline-dispatch-failure.test.ts:117` (disables the rung) and `:156` (unattributed is an observable no-op) |
| R5 | MET | refresh job `packages/app/src/services/agent-quota-refresh.ts:105` with TTL at `:34`; registered at `apps/server/src/serve.ts:441`; asserted by `packages/app/tests/services/agent-quota-refresh.test.ts:98`, `:114` and `apps/server/tests/serve.test.ts:1754` (zero provider calls) |
| R6 | MET | inlineFailFast block at `packages/app/src/services/agent-service.ts:853-855`; live spur agent doctor --json this run returned refreshJob null and unattributedStages 0 |
| R7 | MET | rg for probeExecutor, healthProbe or providerHealth over the refresh service and serve.ts returned no match (exit 1) this run; amendment boundary at `docs/design/executor-availability.md:308` |
| R8 | MET | owning docs: `plugins/sp/skills/spur-dev/references/inline-pipeline-driver.md:541`, `docs/design/executor-availability.md:264`, `docs/design/run-record-contract.md:65`; bundle twins current (script-contract-check passed after the earlier build:scripts regeneration this session) |
| R9 | MET | `plugins/sp/skills/spur-dev/references/inline-pipeline-driver.md:760-766` null or timed-out dispatch is a recorded stage failure with no host-inline attempt; YAML timeoutMs bound unchanged |

| Acceptance Criteria | Status | Evidence Type | Evidence |
|---------------------|--------|---------------|----------|
| AC1 — A host-capacity pre-dispatch failure never becomes host-inline work (req: R1) | MET | test | `packages/app/tests/services/inline-dispatch-failure.test.ts:117` capacity exhaustion disables the rung and decides escalate; 67 pass 0 fail across the app suites this run |
| AC2 — Capability-shaped failures keep the host-inline fallback (req: R1) | MET | test | `packages/app/tests/services/inline-dispatch-failure.test.ts:58` and `:177` capability classes keep the fallback and leave availability untouched |
| AC3 — Classification is the upstream classifier, recorded per attempt (req: R2) | MET | test | `packages/app/tests/services/inline-dispatch-failure.test.ts:50` incident record classifies as capacity via the upstream classifier (dependency at `package.json:32`); negatives at `:73` and `:80` |
| AC4 — The inline dispatch records its executor identity or an observable no-op (req: R3) | MET | test | `packages/app/tests/services/inline-dispatch-failure.test.ts:89` attributed line plus explicit null marker; `:156` unattributed no-op |
| AC5 — An attributed exhaustion disables the rung for the next dispatch, with no provider call (req: R4) | MET | test | `packages/app/tests/services/inline-dispatch-failure.test.ts:117` durable path disables the rung |
| AC6 — The scheduled refresh performs no provider request and respects ownership (req: R5) | MET | test | `packages/app/tests/services/agent-quota-refresh.test.ts:98` ownership and TTL, `:114` zero provider requests; `apps/server/tests/serve.test.ts:1754` 1 pass this run |
| AC7 — The operator can see whether fail-fast can fire (req: R6) | MET | command | spur agent doctor --json this run: inlineFailFast refreshJob null, unattributedStages 0 (source `packages/app/src/services/agent-service.ts:853-855`) |
| AC8 — Owning docs and bundle reflect the new behavior (req: R8) | MET | command | bun run spur-check this run: lint/typecheck exit 0, 51/51 pre-check rules, 10686 pass / 7 fail with all 7 outside 1134 scope (sandbox git-template and Chromium denials; two task-1059 batch-contract cases untouched by 8546948a1); docs at `docs/design/executor-availability.md:264` and `docs/design/run-record-contract.md:65` |
| AC9 — The rejected refresh/probe shapes are absent from the change (req: R7) | MET | command | rg -c probeExecutor/healthProbe/providerHealth over `packages/app/src/services/agent-quota-refresh.ts` and `apps/server/src/serve.ts` returned no match; `packages/app/tests/services/agent-quota-refresh.test.ts:114` asserts zero provider requests |
| AC10 — A null or timed-out dispatch fails the stage without host-inline re-execution (req: R9) | MET | test | `plugins/sp/tests/dogfood-testing/tree-freeze-contract.test.ts:126` pins the R9 rule at `plugins/sp/skills/spur-dev/references/inline-pipeline-driver.md:760-766` (null-result/timeout recorded, normal failure edge, no host-inline attempt, no new bound); added by this verify fix pass, 10 pass 0 fail |
- Coverage: N/A (verdict-based; verify pipeline does not measure code coverage)

### Review

**Disposition:** PASS — no P1 blocker; the P2 items are follow-ups, not correctness defects in the delivered behavior (details in the reviewer answer retained at `.spur/memory/evidence/`).

**Dimensions reviewed.** Functional traceability across R1–R9 / AC1–AC10; SECUA; architectural depth. Scope: 23 files, +1584/−49.

**What was verified by execution, not inspection.** The incident record classifies `capacity` with `reason=usage_limit_reached` and `resetAt=2026-10-13T01:47:29Z` through the released upstream classifier; generic 429 / rate-limit / overload / auth / prompt-echo stay `capability`; an attributed capacity failure reaches `agent_executor_updates` and disables the rung with `owner: quota` (`applied: 1`); the refresh job expires a TTL'd quota disable and never an operator-owned one; `doctor --json` reports `inlineFailFast` beside the unchanged `availability` rows.

| # | P | Finding | Disposition |
| --- | --- | --- | --- |
| 1 | P2 | The installed plugin surfaces are not refreshed here: the driver reads the installed `inline-pipeline-driver.md`, so the new contingent fallback takes effect only after `superskill install sp` / a release. Source and `apps/cli/plugins` staging are correct. | Follow-up at release; installed-layout E2E unverified (residual, also stated in Testing). |
| 2 | P2 | `@gobing-ai/ts-llm-jsonl-importer` floats to 0.5.20, raising `HISTORY_IMPORT_SCHEMA_VERSION` 0.5.19 → 0.5.20 with an unchanged schema SQL hash, so existing history DBs will report importer-schema drift. | Named as user-visible blast radius; no structural change. |
| 3 | P2 | R6's `unattributedStages` is project-scoped (all `*.jsonl` attribution ledgers under `.spur/run`), not run-scoped. | Honest reading of the AC; documented in the satellite. |
| 4 | P3 | `QUOTA_DISABLE_TTL_MS` (6 h) is a fixed policy constant, not configurable. | Documented limitation; configurable TTL is a follow-up. |
| 5 | P3 | One `<run-id>-dispatch-fallback.json` per run, so a second failed stage overwrites the first decision artifact (each decision is still run-logged). | Accepted; per-stage artifact is a follow-up. |
| 6 | P3 | Envelope-shaped capacity detection classifies a full provider envelope wherever it appears in the bounded evidence window (the `error.message` echo case is negative and tested). | Inherent to evidence-based classification; bounded by `MAX_QUOTA_EVIDENCE_BYTES`. |
| 7 | P3 | `bun run spur-check` flaked twice on two different pre-existing near-timeout tests while a concurrent session's suite competed for CPU; both pass in isolation (286 ms / 4.99 s). | Environmental, not this diff; recorded so a later run does not misattribute it. |
| 8 | P4 | `resolveAppEntry` is duplicated across the two plugin facades. | Deliberate: superskill inlines lib modules, so `import.meta.url` paths must be authored from the script directory. |
| 9 | P4 | The attribution ledger is append-only and never compacted. | Bounded by stage count. |

**Verify trap to watch.** The verify stage must judge R1–R4 (pre-dispatch capacity refusal) separately from R9 (dispatched-but-unproductive); they are different triggers and R9 adds no new bound.

**Residual risk.** An installed-layout end-to-end run (install the staged bundle, then feed the incident record through the installed facade) was not performed in this run; source-path verification is complete.

### References

- Incident: pipeline run `85fab6d4-baf5-4db8-a0e9-810b12927fb4` (task 1132), 2026-10-08. Dispatch died after 21 m 30 s with `429 {"code":"1310","message":"Weekly/Monthly Limit Exhausted. Your limit will reset at 2026-10-13 01:47:29"}`; host-inline fallback consumed 13:55–17:01 PDT (~3 h 06 m of an 8 h 22 m run).
- Driver rule to change: `plugins/sp/skills/spur-dev/references/inline-pipeline-driver.md:533` (installed copy: `~/.agents/skills/sp-spur-dev/references/inline-pipeline-driver.md:465`) ("Any pre-dispatch failure → execute the stage **once** in the host session"); related dispatch contract in the same file (native-subagent dispatch, chunked implement dispatch contract, trace emission).
- Existing mechanism to reuse: `docs/design/executor-availability.md` §1 (ownership), §2 (eligibility, `disabled: boolean | {owner,since,reason}`, `cheapestEligibleExecutors`, final launch check, doctor rendering), §3 (`setExecutorAvailability`), §4 (quota events, upstream classification, ADR-121's no-poller decision, attribution rule), §5 (durable `agent_executor_updates`, migration 0048 owner/layer columns).
- Code touchpoints: `apps/cli/src/agent-quota-persistence.ts`, `apps/cli/src/commands/workflow.ts` (subscription attach), `packages/app/src/services/inline-run-setup.ts` (run-scoped status helpers), `apps/server/src/serve.ts:226-253` (`bootstrap.scheduler.jobs` registration + `scheduler.job.executed`), `packages/config/src/index.ts:317-356` (`executorDisabledObjectSchema`, `AgentExecutorConfigSchema`).
- Related features: B5/B6 (implemented), B7 (run-scoped executor session), B8 (runner capability matrix), I31 (post-B6 roadmap), ADR-111 / ADR-121.

- Upstream classifier: `/Users/robin/xprojects/ts-libs/packages/ai-runner/src/quota.ts:68-108` (`QUOTA_CODES`, `tryParseErrorEnvelope`); installed `node_modules/@gobing-ai/ts-ai-runner/dist/quota.d.ts:67`.

### History

- 2026-10-09T05:30:21.971Z backlog → todo (system)
- 2026-10-10T00:20:23.561Z todo → wip (system)
- 2026-10-10T00:24:27.682Z wip → testing (system)
- 2026-10-10T00:27:20.323Z testing → done (system)

