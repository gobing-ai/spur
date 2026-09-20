---
schema_version: 1
name: Validate usage-to-availability decisions with sanitized fixtures and dry-run evidence
status: todo
template: brainstorm
created_at: 2026-09-20T00:51:03.294Z
updated_at: "2026-09-20T05:58:01.849Z"
feature_id: I31

priority: P1
ac_altitude: task-local
ac_numbering: task-local
estimate_hours: "2"
---

## 0904. Validate usage-to-availability decisions with sanitized fixtures and dry-run evidence

### Background

Type: `wayfinder:research`. This is the second independent investigation on map I31. It validates the existing usage-to-availability producer and consumer with sanitized fixtures and read-only dry-run evidence. The observed operator-owned `codex-astra` preview mismatch is a confirmed observation to explain; no-usage recovery, provider mapping, stale data, and latency/timeout behavior remain validation targets until reproduced. No quota producer or config write is proposed.

**Refine corrections (2026-09-19)**
- A live all-provider probe was a mandatory step → the selected research route is local-only → use sanitized fixtures and prior observations; no fresh CodexBar/network capture.
- Per-provider elapsed time was required → UsageCapture carries only exitCode/stdout/stderr and the producer aggregates the result → report capture-total timing when evidenced and per-provider timing as unavailable.
- A preview mismatch could be read as an actual re-enable → only the would-apply output was observed, while the consumer protects operator disables → compare preview and isolated apply separately.
- Write-boundary validation without any writes could not observe persistence → allow writes only to disposable temporary configs/in-memory DB, never real project/global state.

### Requirements

- [ ] R1. Build the fixed fixture matrix below using synthetic providers/executors, fixed timestamps, and sanitized JSON; include all ownership, signal, mapping, and layer cases without copying real provider auth data.
- [ ] R2. Exercise classifyProviderUsage, mapProvidersToExecutors, and runAgentUsageProducer with injected UsageSource, clock, loader, snapshot path, and in-memory DB; compare dry-run changes to actual disposable apply results.
- [ ] R3. Reproduce the operator-owned preview mismatch and no-usage hypothesis independently, recording expected contract, observed preview, persisted fixture state, drain disposition, and whether each defect reproduces.
- [ ] R4. Exercise the actual shared quota consumer and actual config updater/loader for project-only, global-only, and project-shadowing cases. Assert operator protection, layer isolation, and final file content; do not mock the writer whose correctness is being observed.
- [ ] R5. Inspect capture timeout ownership and freshness checks across source/producer/consumer. Report only observable timing: synthetic elapsed measurements describe the harness, not live provider latency; per-provider latency remains unavailable without evidence.
- [ ] R6. Deliver 0904-availability.md and 0904-availability-fixtures.json, with executable reproduction snippets, exact commands, case results, source anchors, sanitized diagnostics, and proposed fixes routed to B6 or explicit unowned follow-up.
- [ ] R7. Run the reproducibility/coverage checks in disposable state, prove real config and DB were not used for writes, and preserve failed observations without changing production source or weakening assertions.

### Acceptance Criteria

- [ ] AC1 — All fixed matrix cases have synthetic input, initial state, expected contract, and an explicit observation status. (req: R1)
- [ ] AC2 — Each tested case records dry-run output separately from apply/drain/file-state observations. (req: R2)
- [ ] AC3 — Operator-preview and no-usage cases are classified reproduced, ruled-out, or blocked with direct evidence; preview is never called a real config change. (req: R3)
- [ ] AC4 — Actual disposable project/global persistence and precedence are observable with protected records and correct target-layer checks. (req: R4)
- [ ] AC5 — Timeout/freshness ownership is source-linked, total timing is correctly labeled, and missing per-provider timing is not fabricated. (req: R5)
- [ ] AC6 — Both named artifacts contain runnable snippets/commands and owner-scoped recommendations, with no auth bodies. (req: R6)
- [ ] AC7 — Coverage and state-isolation checks are recorded; production files/config/DB remain unchanged. (req: R7)

### Q&A

Closed for this investigation: local evidence first; no new public API; no production mutations; no live provider refresh or new benchmark runs; missing evidence is explicit; bounded 90-minute session and 60-second process deadlines. Operator decisions on future CLI compatibility, refresh cadence, and unattended execution budgets remain owned by Robin on map I31 and do not block these evidence-only deliverables. They are not delegated to the investigator to invent.

Preparation is ready-to-investigate, not proof the product behavior passes. Follow the wayfinder research route, one ticket per session. Any later source fix gets its own planned implementation task.

### Design

Type: wayfinder:research. Execute one ticket per session through the sp-wayfinder work-through-map procedure and its wayfinder-resolution research route. Do not use task-pipeline, dev-run, dev-runall, or eval-pipeline to resolve this ticket. Claim the selected ticket before investigation; verification and completion use the existing wayfinder verdict/record route. Preparation here is not execution or verification of its findings.

mutationPolicy: none

Production source, plugin/workflow definitions, installed adapters, real configuration, credentials, and real databases are read-only. Allowed deliverables are this task's CLI-owned evidence sections and the named report/JSON artifacts under docs/reports/i31/. Use an OS temporary directory for executable reproduction snippets and disposable fixture files; include the exact snippet and command in the report so it remains reproducible. No new public API, CLI verb, service, schema, dependency, scheduler, or production fix. No network probes or paid agent invocations inside the investigation; the surrounding delegated research/review session is the only model execution.

At start record git HEAD, git status, git worktree list, source-local CLI provenance, and task list --status wip --json. Use the current checkout; do not reset other work. If competing work changes a sampled source, refresh that row's evidence and record both revisions. Parallel delegates require separate worktrees; task 0905 starts only after 0903 is done and its artifact is available.

Bound one investigation to 90 minutes. Give any child shell/process a 60-second deadline, permit at most one retry for a read-only transient failure, and checkpoint partial artifacts at the budget boundary. A timeout or absent evidence is unknown, never success and never permission to rerun a pipeline. Do not mark the ticket done with unmet required deliverables. Report-only negative findings can be a valid investigation result when all specified observations and missing-data dispositions are recorded.

Choose a disposable fixture reproduction over a fresh all-provider probe: deterministic inputs reveal preview/apply disagreements without consuming quota or touching operator state. This is an investigation, not the remediation implementation. Do not add another production classifier or change the exhaustion policy.

Primary files: packages/app/src/services/agent-usage-producer.ts (classifyProviderUsage, mapProvidersToExecutors, runAgentUsageProducer), agent-quota-updates.ts (drainPendingAgentQuotaUpdates), apps/cli/src/services/agent-usage-source.ts (CodexbarUsageSource), and the existing tests packages/app/tests/services/{agent-usage-producer,agent-quota-updates}.test.ts and apps/cli/tests/commands/agent-usage.test.ts. The actual writer is setExecutorAvailability in packages/config/src/executor-update.ts, re-exported by packages/config/src/loader.ts; declaring-layer selection wins over the request layer. Copy the existing test setup into a temporary reproduction snippet, not production code. Use createDbAdapter({driver:'bun-sqlite',url:':memory:'}), applyCliMigrations, temporary project/global paths, and SPUR_SKIP_GLOBAL_CONFIG for project-only cases. For global cases use a fresh Bun subprocess, mock only node:os homedir to the temporary home BEFORE dynamically importing the loader, and keep the real loader/updater/filesystem writes unmocked. This confines path discovery without changing HOME or USERPROFILE. packages/config/tests/executor-update.test.ts:528 provides the real-global assertions, but do not copy its HOME override. Never change HOME/CODEX_HOME or load real secrets. Assert all writable paths are descendants of the temporary root before any apply.

Fixed cases: C01 healthy named window/headroom; C02 any named window >=100/exhausted; C03 all three windows null/no-usage; C04 provider error; C05 malformed/non-array capture; C06 quota-owned disable with headroom; C07 bare disabled:true (operator-owned); C08 explicit operator-owned disable; C09 probe-owned disable; C10 agent-equality/model-prefix mapping, case handling, unmapped provider, and two providers mapped to one executor; C11 observation older than persisted observation and missing/old updatedAt; C12 project-only, global-only, and shadowed declarations; C13 dry run writes neither snapshot/config nor observation rows; C14 consumer/write failure versus reported action. Use subcases where a case lists several inputs. Treat named-window exhaustion as the current contract; extraRateWindows are raw-only today, not an authorized policy change.

For each case, assert contract expectations rather than current buggy output. A failed assertion is a reproduced finding: capture it, continue independent cases, report it honestly, and do not patch source. Where an isolated seam cannot be exercised after one bounded attempt, record blocked evidence and missing setup; required C07/C08 and C12 must be observed before the ticket can complete. Other missing observations must be explicit unmet deliverables, not silently counted as coverage. Re-run snippets from the report against a new temporary root to demonstrate reproducibility.

Artifact JSON: {schemaVersion:1,task:"0904",sourceCommit,capturedAt,cases:[{id,input,initialState,expected,preview,apply,finalState,status,evidence}],timing:{captureTotalMs:null,providerElapsedMs:null,source,timeoutOwner},findings:[{id,caseIds,owner,recommendation}],unknowns:[]}. status = reproduced|conforms|blocked; null means unmeasured. Store no real executor names or authentication diagnostics in fixtures. The previous real codex-astra preview observation is a seed in the report, not a new capture or proof of persisted change.

Baseline commands, when needed, run inside packages/app: `bun test tests/services/agent-usage-producer.test.ts tests/services/agent-quota-updates.test.ts`; inside apps/cli: `bun test tests/commands/agent-usage.test.ts`. Inspect setup for path isolation before running. These existing tests are baseline evidence, not substitutes for the missing C01–C14 observations. No upstream dependency; 0903/0905 can consume the final report later without blocking this ticket.

### Plan

- [ ] Step 1 (R1, AC1): Build the fixed fixture matrix below using synthetic providers/executors, fixed timestamps, and sanitized JSON; include all ownership, signal, mapping, and layer cases without copying real provider auth data.
- [ ] Step 2 (R2, AC2): Exercise classifyProviderUsage, mapProvidersToExecutors, and runAgentUsageProducer with injected UsageSource, clock, loader, snapshot path, and in-memory DB; compare dry-run changes to actual disposable apply results.
- [ ] Step 3 (R3, AC3): Reproduce the operator-owned preview mismatch and no-usage hypothesis independently, recording expected contract, observed preview, persisted fixture state, drain disposition, and whether each defect reproduces.
- [ ] Step 4 (R4, AC4): Exercise the actual shared quota consumer and actual config updater/loader for project-only, global-only, and project-shadowing cases. Assert operator protection, layer isolation, and final file content; do not mock the writer whose correctness is being observed.
- [ ] Step 5 (R5, AC5): Inspect capture timeout ownership and freshness checks across source/producer/consumer. Report only observable timing: synthetic elapsed measurements describe the harness, not live provider latency; per-provider latency remains unavailable without evidence.
- [ ] Step 6 (R6, AC6): Deliver 0904-availability.md and 0904-availability-fixtures.json, with executable reproduction snippets, exact commands, case results, source anchors, sanitized diagnostics, and proposed fixes routed to B6 or explicit unowned follow-up.
- [ ] Step 7 (R7, AC7): Run the reproducibility/coverage checks in disposable state, prove real config and DB were not used for writes, and preserve failed observations without changing production source or weakening assertions.

### Solution

<!-- Final synthesized recommendation or output from the brainstorm. -->

### Testing

Not run during charting. The eventual investigation must use sanitized fixtures, read-only or dry-run mode, source-local exit status, and bounded evidence capture; no config mutation or provider-auth diagnostic dump is part of the ticket.

### Review

Open until the investigation runs. Review must verify operator-owned protection, project/global write isolation, redaction, applied-versus-proposed honesty, and that latency/timeout claims are tied to captured timestamps rather than assumptions.

### References

- `packages/app/src/services/agent-usage-producer.ts`
- `packages/app/src/services/agent-quota-updates.ts`
- `apps/cli/src/services/agent-usage-source.ts`
- `packages/app/tests/services/agent-usage-producer.test.ts`
- `packages/app/tests/services/agent-quota-updates.test.ts`
- `apps/cli/tests/commands/agent-usage.test.ts`
- `docs/design/session-pinned-dispatch.md`
- Feature I31, via `spur feature show I31 --json`.
- Readiness provenance: HEAD d8ff752b2; one local worktree; no wip tasks at audit. Recheck on execution.

### History
