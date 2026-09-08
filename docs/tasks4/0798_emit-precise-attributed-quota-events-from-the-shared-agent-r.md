---
schema_version: 1
name: Emit precise attributed quota events from the shared agent runner
status: done
template: feature-impl
created_at: 2026-09-07T17:12:18.726Z
updated_at: "2026-09-08T00:05:33.320Z"
feature_id: B5
priority: P2
tags:
  - executor-availability
  - upstream-ts-libs

---

## 0798. Emit precise attributed quota events from the shared agent runner

### Background

Spur's current resource-exhaustion classifier combines quota failures with throttling, overload and context limits. Persistent disabling needs a separate precise upstream observation contract shared by buffered and streaming execution. This task owns the upstream implementation and the verified integration handoff, not a Spur-only regex patch.

Implements:
- R10 — Confirmed quota failures emit one precise attributed event
- R11 — Transient and unrelated failures never persistently disable executors

Approved design: docs/design/executor-availability.md; ADR-111. Planning run: bd360df4-561f-40f5-94a7-ae7132c55984.
Rubric: E6 D1 L2 C2 R1 = 12; estimated 6h. Retain this cohesive deliverable; tests and doc sync are included rather than split into phase tasks.

### Requirements

- [x] R1. Implement reusable quota classification and agent.quota.exhausted event production in ts-ai-runner for supported instrumented invocation and opt-in health observation paths; emit once per observation with stable observationId, normalized observedAt, reason/evidenceSource and available exact project/executor/agent/model and run correlation. Define agent.quota.recovered and its explicit-recovery payload without an automatic producer.
- [x] R2. Do not classify generic HTTP 429, temporary throttling, overload, authentication, context/output limits, timeout, unknown errors or quoted prompt content as quota exhaustion; preserve original runner results and use the same precise classification for bounded streaming error records and buffered failures.

### Acceptance Criteria

```gherkin
Feature: Emit precise attributed quota events from the shared agent runner

  @core
  Scenario: R1 — Confirmed quota failures emit one precise attributed event
    Given a supported instrumented invocation or health observation confirms exhausted usage allowance or credits
    When the shared runner classifies the observation
    Then one agent.quota.exhausted event carries stable observation identity and the exact available project and executor attribution across buffered and streaming paths

  @core
  Scenario: R2 — Transient and unrelated failures never persistently disable executors
    Given a failure is generic HTTP 429, throttling, overload, authentication, context length, output budget, timeout, or unrelated quoted text
    When the failure is classified
    Then no quota-exhaustion event or persistent disable occurs solely from that evidence and the original failure result remains intact
```

### Q&A

<!-- CLOSED decisions from refinement: what was chosen and why, what was deferred and on what
     condition. Not a parking lot for open questions — an unanswered question here means the task
     is not ready to hand off. Keep empty if none. -->

### Design

Upstream owner is @gobing-ai/ts-ai-runner in the ts-libs project. Inspected installed baseline: node_modules/@gobing-ai/ts-ai-runner/src/ai-runner.ts, events.ts, model-health-probe.ts, agents/shims.ts and team-agent-process.ts. Verified upstream checkout: /Users/robin/xprojects/ts-libs, package packages/ai-runner at version 0.4.56. Own packages/ai-runner/src/{ai-runner,events,model-health-probe,team-agent-process}.ts, relevant agents/shims.ts and tests/{lifecycle-bus,team-agent-process,model-health-probe}.test.ts, with any additional shared-classifier file kept in that package. Re-read its AGENTS and resolve an upstream harness task before implementation; never edit node_modules or vendors as the deliverable. Record the upstream harness task ID, source commit and tested package artifact in this Spur task's evidence. This task cannot be completed by writing a handoff document alone.

Add typed AgentQuotaObservation and an optional quotaContext on AgentRunOptions (projectId, executor, agent/model binding); preserve existing callers without Spur attribution. Normalize observedAt to UTC millisecond precision; retain observationId across redelivery. Exact attribution is optional for upstream observability but mandatory for subsequent Spur mutation. Export the shared classifier/observation types needed by runner-owned streaming/team adapters; keep provider rules upstream, with no dependency on Spur config or filesystem mutation.

Prefer structured provider codes or verified error records. Do not scan arbitrary successful stdout or full prompt/transcript text. Bound streaming evidence collection; propagate semantic error records through the same classifier and preserve the existing output callback. Build regression fixtures covering confirmed credits/usage allowance exhaustion plus every negative family. Ordinary doctor remains read-only; only an explicitly opted-in health observation can produce a quota mutation signal.

Decisions: quota is narrower than resource-exhaustion; existing fallback decisions remain compatible. No new provider polling, recovery timer or account-wide identity inference. Dependencies: none on Spur code; this may be prepared independently in a clean upstream worktree. Execution prerequisites are separate from specification readiness: use a clean upstream worktree and its task pipeline. Its package manifest routes publication through tagged GitHub Actions Trusted Publishing; prepare a tested build first and use that established release flow only with operator release authorization. Never invent a package version or treat an unpublished API as installed.

Handoff: export names/types, fixture evidence, source commit, built package/tarball identity, upstream task reference, and the release/version required by the final integration task. A local tested artifact can prove the producer; production Spur integration remains gated on an available approved package release.

Preserve unrelated/concurrent edits. Start implementation in a clean isolated working tree; one writer and one conventional commit per task. No .env, workflow, IAM or deployment changes are needed.

### Plan

1. [ ] Resolve the ts-libs source owner and its harness task, inspect all invocation/streaming/team/health callers, and record the verified installed-to-source provenance.
2. [ ] Add positive and negative quota fixtures before implementing the shared classifier and typed observation contract.
3. [ ] Wire buffered and streaming error records to one producer path; propagate optional exact routing context without changing unrelated invoke/error results.
4. [ ] Reserve recovery types only; verify ordinary doctor has no new mutation-producing behavior and missing attribution stays observable without guessing.
5. [ ] Run upstream required tests and build, record the source commit and tested package identity, and prepare the release handoff without publishing absent authorization.
6. [ ] Update upstream event/API documentation, record a real upstream verify PASS, and attach producer evidence and export/version contract to this Spur task.

### Solution

Deliverable implemented upstream (per task Design: upstream owner is @gobing-ai/ts-ai-runner; this Spur task records the verified handoff).

Upstream: ts-libs branch `sp/quota-observation-0798`, commit `9285ab4` (base `60a98c2` = v0.4.56); upstream harness task **0065** (status done). Not bumped, not tagged, not pushed.

Change map (upstream file:line):
- packages/ai-runner/src/quota.ts (new): shared classifier (exact allowlist over structured error envelopes), bounded 8 KiB trailing evidence, buildQuotaObservation with deterministic sha256 observationId, normalizeObservedAt UTC-ms, QuotaObservationProducer (once per observationId), explicit-only produceRecovery
- src/events.ts:39: AgentEvents += agent.quota.exhausted / agent.quota.recovered
- src/ai-runner.ts:45 / :170 / :268: optional quotaContext; per-runner producer; buffered-path classification
- src/team-agent-process.ts:53/:152: events+quotaContext options, bounded stderr tail, classify on errored exit
- src/model-health-probe.ts:245: observeQuotaHealthResult — only opted-in health path produces observations; ordinary doctor read-only
- src/index.ts: barrel export of ./quota

Rationale: quota is narrower than resource-exhaustion; structured provider codes only, no prompt/transcript scanning; attribution optional upstream, exact when quotaContext supplied; recovery is a reserved contract with no producer/timer.

Integration contract for 0799: exports QuotaExhaustionReason, QuotaEvidenceSource, QuotaAttribution, AgentQuotaObservation, AgentQuotaRecovery, QuotaClassification, QuotaHealthObservationOptions, classifyQuotaErrorRecord, buildQuotaObservation, normalizeObservedAt, MAX_QUOTA_EVIDENCE_BYTES, QuotaObservationProducer, observeQuotaHealthResult; AgentRunOptions.quotaContext, AgentProcessOptions.events/quotaContext. Requires the first release containing 9285ab4 (published 0.4.56 predates it); release is operator-gated.
Full evidence: .spur/run/0798-upstream-report.md

### Testing

**Pipeline verify results**

- Verdict: PASS (from verdict artifact)

| Requirement | Status | Evidence |
|-------------|--------|----------|
| R1 | MET | Upstream @gobing-ai/ts-ai-runner commit 9285ab4 (branch sp/quota-observation-0798): packages/ai-runner/src/quota.ts builds AgentQuotaObservation with deterministic sha256 observationId (stable across redelivery), normalizeObservedAt UTC-ms, reason/evidenceSource, exact QuotaAttribution (projectId/executor/agent/model) from optional AgentRunOptions.quotaContext (ai-runner.ts:45-52) and team/health paths; QuotaObservationProducer emits agent.quota.exhausted at most once per observationId; agent.quota.recovered payload type defined with explicit-only produceRecovery, no automatic producer. Upstream harness task 0065 done; tested package identity 0.4.56+9285ab4, version not bumped/published (release is operator-gated) |
| R2 | MET | quota.ts classifies ONLY confirmed-exhaustion codes (insufficient_quota, insufficient_credit_balance, quota_exceeded, usage_limit_reached, credits_exhausted, billing_hard_limit_reached, provider_quota_exhausted) over structured JSON error envelopes; generic HTTP 429 rate_limit_error, overloaded_error, authentication_error, context-length, timeout, free text, quoted prompt content, non-JSON stderr all tested as negatives producing no event with original result intact; evidence bounded to trailing 8 KiB (MAX_QUOTA_EVIDENCE_BYTES); no successful-stdout or transcript scanning; same classifier drives buffered (ai-runner.ts:268-281), streaming/team (team-agent-process.ts:152-180) and opt-in health probe (model-health-probe.ts:245-286) |

| Acceptance Criteria | Status | Evidence Type | Evidence |
|---------------------|--------|---------------|----------|
| R10 — Confirmed quota failures emit one precise attributed event | MET | command | Upstream bun test packages/ai-runner: 217 pass / 0 fail (+35 quota fixtures: positives insufficient_quota/insufficient_credit_balance/usage_limit_reached across buffered, streaming subprocess and health-probe paths; one-event dedup per observationId; attribution exact when quotaContext present, observable without guessing when absent); bun run lint exit 0; bun run spur-check exit 0 (per-file 0.9 coverage gate); bun run build exit 0 |
| R11 — Transient and unrelated failures never persistently disable executors | MET | command | Upstream negative-family fixtures each assert zero quota events with intact original result: rate_limit_error 429, overloaded_error, authentication_error, context-length, timeout, free-text quota mention, quoted prompt content, non-JSON stderr, successful run; classifier allowlist is exact-match over structured envelopes only — no quota event can arise from those families |
- Coverage: N/A (verdict-based; verify pipeline does not measure code coverage)

### Review

<!-- spur:record-review -->

**SECU findings** (pipeline verify step — verdict: PASS)

| Priority | Dimension | Location | Finding |
|----------|-----------|----------|----------|
| P4 | spur task check | — | task check passed |
| P4 | evidence-rule-pass | — | All behavior-bearing AC rows have executable evidence or are explicitly non-behavioral. |

### References

<!-- Links to the parent feature, design docs, related tasks, or external references. -->

### History

- 2026-09-08T00:05:33.320Z todo → done (system)

