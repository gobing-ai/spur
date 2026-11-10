
## Solution

Change map (commit 6953e495c):
- `packages/app/src/services/adaptive-timeout.ts` (new) — R2/R3 core: `resolveAdaptiveTimeoutMs` (3×mean / 1.5×p95, 30s floor, YAML cap; no history → static), `ladderScore` (latency ÷ success, clamp ≥0.1), `readExecutorLatency`/`loadExecutorLatency` (history_board_model_stats; failure → empty, never throws).
- `packages/app/src/services/agent-run-executor.ts` — R1 run-scoped breaker keyed by flags run-id; unavailability evidence (exit 2 / unavailable) trips it; retry-bound re-resolution excludes tripped set (zero dead dispatches); breaker-exhausted → exitCode 2; per-attempt derived budget + pre-dispatch timeout-exhausted failover; ladder decisions + `agent.invoke.ladder` events.
- `packages/app/src/services/agent-resolver.ts` — measured-latency escalation ordering (`orderEligibleByMeasuredLatency`), `ordering` rows on resolve result; empty history → declaration order.
- `packages/app/src/services/agent-service.ts` — `AgentLadderDecision`, `LadderOrderingEntry`, traced `ladder`, `timeoutBudget`, `historyLatency` seam.
- `packages/app/src/services/failure-classification.ts` — `executorUnavailabilityEvidence`.
- `packages/app/src/workflow/actions/agent-run.ts` — persists `traced.ladder` on the action result row (AC3 trace evidence).
