---
template: standard
schema_version: 1
name: "Extend spur agent doctor to detect token quota and model availability"
description: ""
status: done
type: task
profile: standard
feature_id: H
parent_wbs: null
priority: P2
tags: []
dependencies: []
created_at: "2026-07-10T04:06:28.214Z"
updated_at: "2026-07-12T04:39:51.967Z"
---

## 0239. Extend spur agent doctor to detect token quota and model availability

### Background
When `omp-zai-volc` (executor: `agent: omp` + `model: volc/glm-5.2`) ran out of tokens, `spur agent doctor` reported it as `usable` — it only checks CLI installation, version, and auth state. The pipeline's `implement` step resolved to this executor via `default-by-phase.dev-run`, spawned an `agent.run`, and hung for 600s before timing out with no useful diagnostic. This caused a cascade: the prior model couldn't distinguish infrastructure failure from pipeline failure, and bypassed the execution pipeline entirely (see `docs/dogfood/2026-07-09-system-events-feature-L-workflow-bypass-dogfood.md` §7).

`DoctorRunner` (`ts-ai-runner/doctor-runner.ts:60`) checks: `detected.installed`, `detected.version`, and `isAuthenticated()`. The `usable` field is `installed && version !== null` — auth doesn't even gate it (line 121). There is no model-level liveness, quota, or availability probe. For `omp` executors configured with a `model` override (e.g. `volc/glm-5.2`, `zai/glm-5.2`, `deepseek/deepseek-v4-pro`), the model is invisible to doctor — it only sees the `omp` binary.

**Scope boundary:** This task covers the `ts-ai-runner` `DoctorRunner` enhancement AND the Spur CLI surface for surfacing model-level diagnostics. The actual provider API quota-check implementations are provider-specific and may need to be staged — but the interface, plumbing, and at least one provider probe (omp model liveness) must ship.
### Requirements
R1. `DoctorResult` gains an optional `modelStatus` field carrying per-model liveness/quota state for executors that specify a `model` override. For executors without a model override, `modelStatus` is `null`.
R2. A new `ModelHealthProbe` interface (in `ts-ai-runner`) defines `probe(provider: string, model: string, config: ProbeConfig): Promise<ModelHealthResult>` where `ModelHealthResult = { status: 'available' | 'quota_exhausted' | 'rate_limited' | 'unavailable' | 'unknown', detail?: string, checkedAt: string }`.
R3. At least one probe implementation ships: an `omp` model probe that issues a minimal completion request (1 token, prompt "ping") to the configured provider/model and interprets the response — 200 → available, 429 with quota/rate-limit body → quota_exhausted or rate_limited, 4xx/5xx → unavailable, timeout → unknown.
R4. `spur agent doctor` output includes model status per executor when a `model` override is present. The table gains a `MODEL` column showing `available` / `quota_exhausted` / `rate_limited` / `unavailable` / `unknown` / `—` (no model override).
R5. `spur agent doctor <executor-name>` (single) shows detailed model status including `detail` and `checkedAt` when available.
R6. The pipeline precheck (`task-pipeline.yaml` line 62, `spur agent doctor`) surfaces model-level failures. If a phase's executor has `modelStatus = quota_exhausted | unavailable`, the precheck warns (does not hard-block — the operator may override via `--agent`).
R7. `agent.run` timeout diagnostics improve: when an `agent.run` step times out, the `AgentRunActionRunner` (`packages/app/src/workflow/actions/agent-run.ts`) includes the executor name and model in the partial-work artifact, so the operator can correlate the timeout to a specific model.
R8. Probe timeout is bounded (default 10s, configurable) — the probe must not hang. A probe timeout resolves to `unknown`, not `available`.
R9. Probe implementations are pluggable — new providers can be added without modifying `DoctorRunner` core. Registry pattern: `ModelHealthProbeRegistry` maps provider prefixes (`volc/`, `zai/`, `deepseek/`, `minimax/`) to probe implementations.
R10. All new code is tested against in-memory mocks; no real API calls in the test suite. Tests cover: available, quota_exhausted, rate_limited, unavailable, timeout→unknown, no-model-override→null.
### Acceptance Criteria
- AC1: Given an executor with `model: volc/glm-5.2` configured, when `spur agent doctor <executor>` is run, then the output includes a `MODEL` column showing the model health status (`available` / `quota_exhausted` / `rate_limited` / `unavailable` / `unknown`).
- AC2: Given an executor with no `model` override (e.g. `name: omp, agent: omp`), when `spur agent doctor` is run, then the `MODEL` column shows `—` and no probe is issued.
- AC3: Given a provider API returning HTTP 429 with a quota-exceeded body, when the model health probe runs, then `modelStatus.status` is `quota_exhausted` and `detail` contains the provider's error message.
- AC4: Given a provider API timing out (no response within probe timeout), when the probe runs, then `modelStatus.status` is `unknown` (not `available`) and the probe completes within the configured timeout.
- AC5: Given `spur agent doctor` run as a task-pipeline precheck, when a phase executor has `modelStatus = quota_exhausted`, then the precheck output includes a warning naming the executor and model, and suggests switching executors via `--agent`.
- AC6: Given an `agent.run` step timeout, when the partial-work artifact is written, then the artifact includes the executor name and model that timed out.
- AC7: Given a new provider prefix `foo/`, when no probe is registered for `foo/`, then `modelStatus` is `unknown` with `detail: "no probe registered for provider 'foo'"` — the doctor run does not fail.
- AC8: All tests pass with `bun run test` and `bun run test-cf`; no real API calls are made in tests (all probes mocked).
### Q&A

<!-- Clarifications and decisions made during refinement. Keep empty if none. -->

### Design

<!-- Chosen approach, key tradeoffs, invariants, and impacted surfaces. Keep snippets short. -->

### Plan

<!-- Ordered implementation checklist. Fill before moving to todo/wip. -->

### Solution
Cross-repo feature: model-level doctor health for executors with a `model` override.

**ts-ai-runner (`@gobing-ai/ts-ai-runner` ≥0.4.7):**
- `packages/ai-runner/src/model-health-probe.ts` — `ModelHealthResult`, `ModelHealthProbe`, `ModelHealthProbeRegistry`, `OmpModelProbe` (1-token ping; 200/429/4xx/5xx/timeout mapping; default timeout 10s).
- `packages/ai-runner/src/doctor-runner.ts` — `DoctorResult.modelStatus`; executor-aware `runAll`/`runOne`; `probeModel()` with no-probe → `unknown` and missing-key → `unknown`.

**Spur:**
- `packages/app/src/services/agent-service.ts:165-193` — doctor threads `agentConfig.executors`; MODEL table column; single-executor detail (`status`/`detail`/`checkedAt`); stderr warning on `quota_exhausted|unavailable` with `--agent` suggestion (R6/AC5).
- `packages/app/src/services/agent-service.ts:627-631` — MODEL column renders full status enum (R4/AC1).
- `packages/app/src/workflow/actions/agent-run.ts:188-237` — partial-work artifact includes agent + model on captured failure/timeout (R7/AC6).
- `config/workflows/task-pipeline.yaml:62` — precheck still runs `spur agent doctor ${vars.agent}` (warnings surface via doctor, non-blocking).

Tests: `ts-libs/.../model-health-probe.test.ts`, `doctor-runner.test.ts` (modelStatus cases); `packages/app/tests/services/agent-service.test.ts` (MODEL/AC2/AC5/json/detail); `agent-run.test.ts` (model in partial artifact).
### Testing
**Verify run:** 2026-07-11 — `/sp:dev-verify 0239 --auto --focus all --fix all --force` (standalone re-audit of `done` task).

**Coverage (focused suites this run):**
- `ts-libs` `model-health-probe.ts`: **91.67% funcs / 100% lines**
- `spur` `agent-run.ts` under its suite: **100% funcs / 100% lines**

**Command evidence (this run):**
```
# ts-libs
bun test packages/ai-runner/tests/model-health-probe.test.ts packages/ai-runner/tests/doctor-runner.test.ts
33 pass, 0 fail

# spur
bun test packages/app/tests/services/agent-service.test.ts packages/app/tests/workflow/actions/agent-run.test.ts
115 pass, 0 fail

# post-fix doctor MODEL labels
bun test packages/app/tests/services/agent-service.test.ts -t "MODEL|modelStatus|quota|detail mode|available model|full"
7 pass, 0 fail
```

**`--fix all` applied this run:**
1. MODEL column now prints full status enum (`available`, `quota_exhausted`, …) instead of compact `ok`/`quota` — aligns R4/AC1.
2. Updated agent-service doctor tests accordingly.
3. Solution/Testing rewritten as implementation evidence (prior bodies were design drafts).

**Per-Requirement Traceability**

| Req | Status | Evidence |
|-----|--------|----------|
| R1 | MET | `DoctorResult.modelStatus` in ts-ai-runner doctor-runner; null when no model override (doctor-runner tests) |
| R2 | MET | `ModelHealthProbe` + `ModelHealthResult` in model-health-probe.ts |
| R3 | MET | `OmpModelProbe` 200/429-quota/429-rate/500/timeout cases (model-health-probe.test.ts) |
| R4 | MET | MODEL column + full status strings (agent-service render + tests post-fix) |
| R5 | MET | `renderDoctorDetail` shows status/detail/checkedAt; single-executor test |
| R6 | MET | doctor stderr warning on quota_exhausted/unavailable; pipeline precheck invokes doctor |
| R7 | MET | agent-run partial artifact includes agent + model (agent-run.test.ts) |
| R8 | MET | default 10s timeout; timeout → unknown (probe tests) |
| R9 | MET | `ModelHealthProbeRegistry` register/resolve; pluggable probes |
| R10 | MET | All suites mock fetch / DoctorRunner; no live API in tests |

**Acceptance Criteria Verification**

| AC | Status | Evidence Type | Evidence |
|----|--------|---------------|----------|
| AC1 MODEL column with health status | MET | test | agent-service.test.ts MODEL header + full `available`/`quota_exhausted` |
| AC2 no model → — | MET | test | `text table renders — in MODEL column…` |
| AC3 429 quota → quota_exhausted | MET | test | OmpModelProbe quota case + doctor-runner |
| AC4 timeout → unknown | MET | test | OmpModelProbe timeout → unknown |
| AC5 precheck warning | MET | test | `warns on quota_exhausted model status (AC5)` |
| AC6 timeout artifact has executor+model | MET | test | agent-run partial artifact with model |
| AC7 unregistered provider → unknown | MET | test | doctor-runner no probe registered detail |
| AC8 tests pass, no real API | MET | command | 33 + 115 pass; mocks only |

**Design conformance:** task `### Design` empty; Solution design intent implemented across ts-ai-runner + spur surfaces. DONE (with R4 display-label fix this run).

**SECUA Review (answer-file; Review section owned by `/sp:dev-review`)**

| Sev | Dim | Finding |
|-----|-----|---------|
| — | S | API keys from env only; detail sanitized; not logged in doctor output. |
| — | E | Bounded probe timeout; parallel executor probes via doctor path. |
| — | C | modelStatus advisory (usable gate unchanged); timeout→unknown not available. |
| — | U | Full status strings in table; warnings suggest `--agent`. |
| — | A | Probe registry open-closed; DoctorRunner DI for testability. |

No blocker/major findings after R4 fix.

**Verdict:** PASS — R1–R10 and AC1–AC8 MET with executable evidence.
### Review
## Review Checklist

- `ModelHealthProbe` interface is minimal and provider-agnostic — no omp-specific fields leak into the interface.
- Registry pattern allows new providers without modifying `DoctorRunner` core (open-closed).
- `modelStatus` is advisory, not a hard gate on `usable` — backward compatible with existing doctor consumers.
- Probe timeout is bounded and non-blocking — a hanging provider API cannot stall `spur agent doctor`.
- Executor config is passed to DoctorRunner, not pulled from disk inside it — testability (DI).
- API key resolution follows the same env var conventions the `omp` binary uses (no new env var names invented).

- API keys are read from env, never logged, never included in `modelStatus.detail`.
- Probe requests are minimal (1 token, no user data) — no PII sent to provider.
- `--json` output does not include API keys or request bodies.
- Probe error messages from the provider are sanitized before inclusion in `detail` (no raw headers, no key fragments).

- Provider prefix extraction from model string handles edge cases: `volc/glm-5.2` → `volc`; `deepseek/deepseek-v4-pro` → `deepseek`; bare `glm-5.2` (no slash) → no probe, `unknown`.
- 429 response body parsing distinguishes quota vs rate-limit by error type/code, not by string matching.
- `AbortController` timeout fires before the probe's internal fetch timeout — doctor controls the deadline, not the provider.
- Concurrent probes (multiple executors with model overrides) are run in parallel via `Promise.allSettled` — one slow provider doesn't block the rest.

- `ts-libs` changes are published/released (or `bun link`ed temporarily with a documented task note per AGENTS.md dependency-source rule).
- Spur consumes the released version (or explicit temporary link).
- `task-pipeline.yaml` precheck step enhancement is backward compatible — if doctor doesn't return `modelStatus` (old version), the precheck skips the model warning gracefully.
- `AgentRunActionRunner` artifact change is backward compatible — old artifacts without executor/model fields still parse.

- This task itself was executed via `task-pipeline.yaml` (not direct implementation) — provenance: a `task-pipeline.yaml` run for WBS 0239 exists.
- Dogfood: this task touches `packages/app/src/workflow/actions/agent-run.ts` (a workflow-related service) → P3 mandatory dogfood applies. A `docs/dogfood/` artifact for this feature must exist before feature `done`.


| Priority | Finding | Status |
|----------|---------|--------|
| P1 | None — design is sound, backward compatible, security-conscious | — |
| P2 | None — no architectural concerns identified | — |
| P3 | None — integration path via `ts-libs` release + Spur consumption is standard | — |
| P4 | None — testing strategy covers all 10 requirements with mock-only tests | — |
### References

<!-- Links to features, docs, ADRs, related tasks, or external references. -->

### History
- 2026-07-10T04:09:25.655Z backlog → todo (system)
- 2026-07-10T04:09:25.832Z todo → wip (system)
- 2026-07-10T04:11:06.419Z wip → testing (system)
- 2026-07-10T04:11:06.907Z testing → done (system)
