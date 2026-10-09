---
schema_version: 1
name: "Executor fail-fast: a host-quota pre-dispatch failure must shift executors, not consume the host session"
status: todo
template: feature-impl
created_at: 2026-10-09T05:28:30.946Z
updated_at: "2026-10-09T05:30:21.971Z"
feature_id: B

ac_altitude: task-local
ac_numbering: task-local
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

### Requirements

- [ ] R1. **Contingent fallback in the inline driver.** A pre-dispatch failure classified as *host capacity exhaustion* (quota / credits / auth) must NOT fall back to another host-session attempt. The driver must (a) hand the stage to the subprocess dispatch path, which resolves an executor independently, or (b) when that path is unavailable, terminate the run at `failed` with `terminalReason: failed-agent` naming the executor and the observed reset time. Capability-shaped pre-dispatch failures (permission, missing capability, non-dispatch-eligible prose, below-floor size) keep today's host-inline fallback unchanged.
- [ ] R2. **Reuse the upstream classifier; never invent text matching.** The driver reads the classified signal the runner already produces (`classifyQuotaErrorRecord` / the provider error's structured code such as `{"code":"1310"}`) and writes the outcome to a run-scoped status file. No new provider-specific matching, no scanning of prompts or output for quota vocabulary.
- [ ] R3. **Inline attribution.** An inline host-session dispatch records the executor identity it actually used (`agent`, `model?`) into the run record before the stage runs, so a later classified exhaustion can be attributed. When no named executor is resolvable the driver records the classified no-op (the design's "observable but cannot write configuration") — never a silent drop.
- [ ] R4. **Durable memory across runs.** An attributed exhaustion observation must reach the existing durable path (`agent_executor_updates` → `setExecutorAvailability`, `owner: quota`, with `since`/`reason`) so that the NEXT dispatch skips that rung **without any provider call**. Older/duplicate observations must not overwrite a newer one (the design's `(observedAt, observationId)` order).
- [ ] R5. **Scheduled observation refresh — zero provider calls.** `bootstrap.scheduler.jobs` gains a job that (a) drains pending `agent_executor_updates`, (b) reports the `~/.config/spur/agent-usage.json` snapshot age, and (c) re-checks `owner: quota|probe` disables against their recorded TTL, re-enabling only through the ownership-scoped recovery path. It must make no provider request and must never auto-re-enable an `operator`-owned disable.
- [ ] R6. **Make the gap observable.** `spur agent doctor --json` (already rendering `availability {disabled, owner, since, reason}` and the usage age) additionally reports the refresh job's last-run status and a count of inline stages that ran without executor attribution, so the operator can see whether fail-fast is actually able to fire.
- [ ] R7. **Explicitly out of scope (do not build).** Per-provider health-check adapters; probing entries that are already disabled (forbidden by `docs/design/executor-availability.md` §2); a health probe per candidate executor at dispatch time; and any serve-side poller/timer that writes configuration without a separate operator-consented ADR-121 amendment. R5's zero-call observation refresh needs no amendment; anything that probes or writes config on a timer does.
- [ ] R8. **Same-change docs and bundle.** Update the driver reference (`inline-pipeline-driver.md` dispatch/fallback and trace sections), the executor-availability design satellite (new section for the inline attribution + refresh job), and the run-record contract for the new status artifacts; rebuild the bundle with `bun run --filter @gobing-ai/spur build:bundle` and `bun run build:scripts`.

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
  Given a dispatch failure carrying a structured provider error code
  When the driver classifies it
  Then it consults the existing runner classification rather than pattern-matching text
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

### Q&A

<!-- CLOSED decisions from refinement: what was chosen and why, what was deferred and on what
     condition. Not a parking lot for open questions — an unanswered question here means the task
     is not ready to hand off. Keep empty if none. -->

### Design

- **The fix lives in the driver contract, not in provider code.** The 3 h 06 m loss was a *rule* failure: the driver asked the host to do work the host's own quota could not fund. Detection is already upstream and already single-source (`ts-ai-runner`), so this task adds no provider adapter, no new probe, and no new lexicon — it adds a **branch** on the classified signal plus the attribution that lets the existing durable path act on it. Blast radius: `plugins/sp/skills/spur-dev/references/inline-pipeline-driver.md` (the fallback rule and the trace/dispatch sections), the run-scoped status artifacts it already writes, and `packages/app/src/services/inline-run-setup.ts` only where the driver needs a status-file helper.

- **Contingent fallback (R1/R2).** Today: any pre-dispatch failure → host-inline, unconditionally. New: classify first. Capacity-shaped → escalate to the subprocess path (the same one `--agent auto|name` uses, which resolves an executor through the registry and therefore *can* pick another rung) or stop at `failed-agent` naming the executor and reset time. Capability-shaped → unchanged host-inline fallback. The two paths must be distinguishable in the run log, and the decision must be a status file (`.spur/run/<run-id>-dispatch-fallback.json`), not a prose judgement, so the guard can read it.

- **Attribution (R3) is the load-bearing link.** Without it the durable machinery is unreachable: §4 of the design says attribution-less events are observable but cannot write configuration. So the inline dispatch writes `{agent, model?, stage, observedAt}` before the stage runs; when nothing is resolvable it writes the explicit no-attribution marker (and R6 counts those).

- **Durable memory (R4) reuses B5/B6 verbatim.** `agent_executor_updates` + `setExecutorAvailability({layer, projectRoot, executor, disabled: {owner:'quota', since, reason}})` already exist, are ownership-scoped, and already coalesce older/duplicate observations. This task must NOT introduce a second availability model: "Configuration remains the source used for execution eligibility" (design §1).

- **Refresh shape (R5) — the deliberate constraint.** A scheduled job on `bootstrap.scheduler` that touches **observations only**: drain pending updates, report snapshot age, expire TTL'd `quota`/`probe` disables through the ownership-scoped recovery. Zero provider calls, because (a) a probe spends the quota it protects, (b) a successful probe does not disprove an account-level weekly cap (the exact `code 1310` case), and (c) ADR-121 deliberately made the run-once `spur agent usage` the only proactive producer. A timer that probes or writes config is a **separate, operator-consented ADR-121 amendment** and is explicitly out of scope (R7).

- **Boundaries.** Do not touch the tier/ladder policy (`cheapestEligibleExecutors`, tier floors, `requiresCapabilities`, the P0/P1 distinctness gate) — shifting must respect those floors, and a stage that cannot be satisfied at or above its floor after exhaustion must stop, not silently degrade. Do not cancel an already-running subprocess. Do not probe or re-enable an operator-owned disable. Do not add a queue or an event-replay framework (design §5's rejected alternatives).

### Plan

1. **Write the failure inventory first** — each row a way this change can be wrong: (a) a capacity failure misrouted to host-inline (the original defect); (b) a capability failure misrouted to subprocess escalation, breaking the existing fallback; (c) exhaustion misclassified as a rate limit / auth error, so nothing is disabled; (d) an unattributed event silently dropped; (e) an older observation overwriting a newer one, resurrecting an exhausted rung; (f) the refresh job re-enabling an operator-owned disable; (g) the refresh job making a provider call; (h) escalation landing on an executor below the stage's tier floor; (i) a run that cannot escalate and does not stop, i.e. hangs or retries forever; (j) docs drifting from the driver's real branch.
2. **Tests before implementation**, one per inventory row, at the cheapest surface that can fail: a driver-contract fixture (the inline driver smoke harness `plugins/sp/tests/inline-pipeline-driver.test.ts` already executes the real graph), a service test for the attribution/observation path, and a scheduler-job test asserting zero provider calls (spy on the executor/runner).
3. **Implement R1–R3 (driver)** — classify, branch, escalate-or-stop, write the fallback status file, record attribution (or the no-attribution marker) before the stage runs. Keep the existing host-inline fallback for every non-capacity failure.
4. **Implement R4** — route the attributed observation into the existing durable path; assert the `(observedAt, observationId)` ordering is honoured (no regression of a newer state).
5. **Implement R5 + R6** — the `bootstrap.scheduler.jobs` observation-refresh entry with its zero-provider-call contract, plus the doctor additions (refresh last-run status, unattributed-stage count).
6. **Docs and bundle (R8)** — driver reference, executor-availability satellite, run-record contract; `bun run --filter @gobing-ai/spur build:bundle` and `bun run build:scripts`.
7. **Verify with a real re-run**, not only unit tests: force an exhausted executor (a disabled rung is enough) and confirm the next dispatch skips it with no provider call, and that a simulated capacity failure at dispatch routes to escalation instead of host-inline. Record both command outputs in Testing.
8. Run `bun run spur-check` once on the final tree and record the evidence.

### Solution

<!-- Filled during implementation: file:line change map and concise rationale. -->

### Testing

<!-- Filled during verification: commands run, outcomes, coverage claim or N/A. -->

### Review

<!-- Filled during review: P1-P4 findings, residual risk, and final disposition. -->

### References

- Incident: pipeline run `85fab6d4-baf5-4db8-a0e9-810b12927fb4` (task 1132), 2026-10-08. Dispatch died after 21 m 30 s with `429 {"code":"1310","message":"Weekly/Monthly Limit Exhausted. Your limit will reset at 2026-10-13 01:47:29"}`; host-inline fallback consumed 13:55–17:01 PDT (~3 h 06 m of an 8 h 22 m run).
- Driver rule to change: `~/.agents/skills/sp-spur-dev/references/inline-pipeline-driver.md:465` ("Any pre-dispatch failure → execute the stage **once** in the host session"); related dispatch contract in the same file (native-subagent dispatch, chunked implement dispatch contract, trace emission).
- Existing mechanism to reuse: `docs/design/executor-availability.md` §1 (ownership), §2 (eligibility, `disabled: boolean | {owner,since,reason}`, `cheapestEligibleExecutors`, final launch check, doctor rendering), §3 (`setExecutorAvailability`), §4 (quota events, upstream classification, ADR-121's no-poller decision, attribution rule), §5 (durable `agent_executor_updates`, migration 0048 owner/layer columns).
- Code touchpoints: `apps/cli/src/agent-quota-persistence.ts`, `apps/cli/src/commands/workflow.ts` (subscription attach), `packages/app/src/services/inline-run-setup.ts` (run-scoped status helpers), `apps/server/src/serve.ts:226-253` (`bootstrap.scheduler.jobs` registration + `scheduler.job.executed`), `packages/config/src/index.ts:317-356` (`executorDisabledObjectSchema`, `AgentExecutorConfigSchema`).
- Related features: B5/B6 (implemented), B7 (run-scoped executor session), B8 (runner capability matrix), I31 (post-B6 roadmap), ADR-111 / ADR-121.

### History

- 2026-10-09T05:30:21.971Z backlog → todo (system)

