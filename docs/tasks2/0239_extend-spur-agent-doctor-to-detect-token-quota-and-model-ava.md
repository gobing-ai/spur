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
updated_at: "2026-07-10T04:12:49.155Z"
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
## Approach

Enhance `DoctorRunner` in `ts-ai-runner` (`~/xprojects/ts-libs/packages/ai-runner/src/doctor-runner.ts`) to probe model health for executors that specify a `model` override. The change spans two repos: `ts-libs` (the probe infrastructure) and `spur-new` (the CLI surface and pipeline precheck).


**New file**: `ts-libs/packages/ai-runner/src/model-health-probe.ts`

```typescript
export interface ModelHealthResult {
    status: 'available' | 'quota_exhausted' | 'rate_limited' | 'unavailable' | 'unknown';
    detail?: string;
    checkedAt: string; // ISO 8601
}

export interface ModelHealthProbe {
    probe(provider: string, model: string, config: ProbeConfig): Promise<ModelHealthResult>;
}

export interface ProbeConfig {
    apiKey: string;
    timeoutMs: number; // default 10000
    endpoint?: string; // provider-specific override
}
```

**Registry** (same file or adjacent `model-health-registry.ts`):

```typescript
export class ModelHealthProbeRegistry {
    private probes = new Map<string, ModelHealthProbe>();

    register(providerPrefix: string, probe: ModelHealthProbe): void {
        this.probes.set(providerPrefix, probe);
    }

    resolve(model: string): ModelHealthProbe | null {
        const provider = model.split('/')[0];
        return this.probes.get(provider) ?? null;
    }
}
```

**OmpModelProbe** (new file: `omp-model-probe.ts`): Issues a minimal completion request to the provider's API. For `omp` executors, the model string format is `provider/model-name` (e.g. `volc/glm-5.2`, `zai/glm-5.2`, `deepseek/deepseek-v4-pro`). The probe:
1. Extracts provider prefix and model name.
2. Looks up the API key from env (`VOLC_API_KEY`, `ZAI_API_KEY`, `DEEPSEEK_API_KEY`, etc. — the same env vars the `omp` binary uses).
3. Issues a 1-token completion request (`messages: [{role: 'user', content: 'ping'}]`, `max_tokens: 1`).
4. Interprets response: 200 → `available`; 429 + quota body → `quota_exhausted`; 429 + rate-limit body → `rate_limited`; 4xx/5xx → `unavailable`; AbortController timeout → `unknown`.

**DoctorRunner changes** (`doctor-runner.ts`):
- `DoctorResult` gains: `modelStatus?: ModelHealthResult | null`.
- In `buildResult()`, after the existing installation/version/auth checks, if the executor config includes a `model` override, resolve a probe from the registry and run it. Store the result in `modelStatus`.
- If no probe is registered for the provider prefix, `modelStatus = { status: 'unknown', detail: 'no probe registered for provider '<prefix>'', checkedAt: now }`.
- The probe runs with a bounded timeout (default 10s via `AbortController`); a probe timeout → `unknown`.
- `usable` field stays as-is (`installed && version !== null`) — model health is advisory, not a hard gate. The CLI surface decides how to present it.

**Executor config access**: `DoctorRunner.runAll()` currently iterates `DISPLAY_ORDER` (agent binary names). To probe model health, it needs access to executor configs from `.spur/config.yaml`. Add an optional `executors?: ExecutorConfig[]` parameter to `runAll()` / constructor. When provided, match executors to agents by `agent` field and probe their `model` overrides.


**`apps/cli/src/commands/agent/doctor.ts`** (or wherever the doctor command lives):
- Load executor configs from `.spur/config.yaml`.
- Pass them to `DoctorRunner.runAll(executors)`.
- Table output gains a `MODEL` column: shows `modelStatus.status` for executors with a model override, `—` for those without.
- Single-executor mode (`spur agent doctor <name>`) shows full detail: `status`, `detail`, `checkedAt`.

**JSON output** (`--json`): includes `modelStatus` per executor in the results array.


**`task-pipeline.yaml`** (line 62 area): The `spur agent doctor` precheck step already runs. Enhance the doctor command to emit warnings when a phase executor has `modelStatus = quota_exhausted | unavailable`. The pipeline precheck step should:
- Run `spur agent doctor --json`.
- Parse results for any executor with failing model status.
- If the failing executor matches the current task's phase executor (from `default-by-phase`), emit a warning with a suggestion: "Executor <name> (model <model>) reports <status>. Consider `--agent <alt>` or check token quota."
- Does NOT hard-block (R6) — the operator may override.


**`packages/app/src/workflow/actions/agent-run.ts:53`**: When `agent.run` times out (non-zero exit / timeout), include executor name and model in the partial-work artifact. The runner already has access to the executor config via the workflow context. Add `executor` and `model` fields to the artifact's diagnostic section.

- Provider probes for non-omp agents (claude, codex, gemini) — these have their own auth flows and doctor checks; can be added incrementally.
- Automatic executor failover — the pipeline warns but does not switch. Operator decides.
- Quota amount reporting (e.g. "47% remaining") — only available/unavailable, not percentage.
### Testing
## Testing Strategy

**Coverage target:** Per-file line ≥ 90%, function ≥ 90% for all new files (per `bunfig.toml`).


**New test file**: `model-health-probe.test.ts`

1. `OmpModelProbe — available`: Mock fetch returning 200 with a valid completion body → `status: 'available'`.
2. `OmpModelProbe — quota_exhausted`: Mock fetch returning 429 with body `{ error: { type: 'insufficient_quota' } }` → `status: 'quota_exhausted'`, `detail` contains error message.
3. `OmpModelProbe — rate_limited`: Mock fetch returning 429 with body `{ error: { type: 'rate_limit_exceeded' } }` → `status: 'rate_limited'`.
4. `OmpModelProbe — unavailable`: Mock fetch returning 500 → `status: 'unavailable'`.
5. `OmpModelProbe — timeout → unknown`: Mock fetch with delay > timeoutMs → `status: 'unknown'`, probe resolves within `timeoutMs + 100ms`.
6. `OmpModelProbe — missing API key → unknown`: No env var set → `status: 'unknown'`, `detail: 'API key not found'`.
7. `ModelHealthProbeRegistry — resolve`: Register probes for `volc`, `zai`, `deepseek`; verify `resolve('volc/glm-5.2')` returns the volc probe, `resolve('unknown/model')` returns null.
8. `DoctorRunner — modelStatus populated for executor with model override`: Provide `executors: [{ name: 'omp-zai-volc', agent: 'omp', model: 'volc/glm-5.2' }]` → result includes `modelStatus` with probed status.
9. `DoctorRunner — modelStatus null for executor without model override`: Provide `executors: [{ name: 'omp', agent: 'omp' }]` (no model) → `modelStatus: null`.
10. `DoctorRunner — unknown provider → unknown status`: Executor with `model: 'foo/bar'`, no probe registered → `modelStatus: { status: 'unknown', detail: "no probe registered for provider 'foo'" }`.

All tests mock `fetch` via `globalThis.fetch = mockFetch`. No real API calls.


11. `spur agent doctor — table includes MODEL column`: Run doctor with a mock `DoctorRunner` returning `modelStatus` → table output includes `MODEL` header and status values.
12. `spur agent doctor — single executor shows detail`: `spur agent doctor omp-zai-volc` → output includes `status`, `detail`, `checkedAt` for the model probe.
13. `spur agent doctor --json — includes modelStatus`: JSON output array entries include `modelStatus` field.
14. `spur agent doctor — no model override shows —`: Executor without model → `MODEL` column shows `—`.


15. `task-pipeline precheck — warns on quota_exhausted`: Mock doctor returning `quota_exhausted` for the task's phase executor → precheck output includes warning naming executor + model.
16. `task-pipeline precheck — no warning when available`: Mock doctor returning `available` → no warning emitted.


17. `agent-run timeout — artifact includes executor and model`: Mock `agent.run` timing out → partial-work artifact includes `executor` and `model` fields.

Verifies: R1–R10 (probe interface, registry, doctor integration, CLI surface, pipeline precheck, agent-run diagnostic, bounded timeout, pluggability, mock-only tests).
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
