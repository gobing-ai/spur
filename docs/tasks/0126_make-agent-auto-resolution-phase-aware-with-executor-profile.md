---
template: standard
schema_version: 1
name: "Make agent auto resolution phase-aware with executor profiles"
description: "Extend `.spur/config.yaml` agent defaults so `spur agent run --agent auto` can choose phase-specific executor profiles and inject model overrides."
status: testing
type: task
profile: standard
feature_id: B1
parent_wbs: null
priority: P1
tags: [agent, config, cli, sp-dev]
dependencies: []
created_at: "2026-06-26T01:21:18.275Z"
updated_at: 2026-06-26T16:09:06.891Z
---

## 0126. Make agent auto resolution phase-aware with executor profiles

### Background
`spur agent run --agent auto` currently resolves to the first usable Tier-1 agent from
`@gobing-ai/ts-ai-runner`'s static `TIER1_PRIORITY`. It does not inspect the slash command, the
dev phase, `.spur/config.yaml`, or any model preference. That is now too weak for the `sp:dev-*`
surface: the slash commands can forward `--agent auto`, but the resolver still treats brainstorm,
plan, run, review, verify, changelog, and fixall as identical.

The desired behavior is config-driven executor selection:

```yaml
agent:
  default: omp
  executors:
    - name: omp
      agent: omp
    - name: omp-zai
      agent: omp
      model: zai//glm-5.2
    - name: omp-zai-volc
      agent: omp
      model: volc/glm-5.2
    - name: codex
      agent: codex
    - name: claude
      agent: claude
  default-by-phase:
    dev-brainstorm: claude
    dev-fixall: omp-zai-volc
    dev-plan: claude
    dev-run: omp-zai
    dev-changelog: omp-zai-volc
    dev-review: claude
    dev-verify: claude
```

Refinement from the initial proposal:

- Use `default-by-phase` as a map, not an array of single-key maps. The map is easier to validate,
  merge, document, and diff.
- Treat `agent.default` as an executor selector first, then as a legacy direct agent selector. This
  preserves existing configs such as `agent: { default: pi }` while enabling richer executor names.
- Resolve `auto` to an executor profile `{ agent, model? }`, not only to an `AgentName`. Without this,
  entries like `omp-zai` would lose their model override.
- Infer phase from the prompt slash command when possible, and allow a future explicit phase hint.
  The common path is `spur agent run "/sp:dev-run ..." --agent auto`, so the resolver can normalize
  `/sp:dev-run`, `/sp-dev-run`, and legacy `/rd3:dev-run` to `dev-run`.
- Wire validated app config into `AgentService` through `CliContext`. Do not make `packages/app`
  import `apps/cli/src/config/loader.ts` or re-read `.spur/config.yaml` independently.

Current code anchors (verified 2026-06-25 against the working tree):

- `packages/app/src/services/agent-service.ts` owns `resolveAgent(flags, doctorRunner)` which fans out
  to `resolveAgentAuto` / `resolveAgentCurrent` / `resolveAgentExplicit`. Each returns
  `AgentResolveResult = { ok: true; agent } | { ok: false; exitCode; message }`. Dispatch happens in
  `executeRun(prompt, flags, deps, silent)`, which calls `resolveAgent` **after** `prompt` is in scope
  (~line 225). Model is read once at ~line 252 (`stringFlag(flags, 'model', '')`).
- **The prompt is not threaded into resolution today** — `resolveAgent` takes only
  `(flags, doctorRunner)`. Phase extraction needs the raw prompt, so `resolveAgent`/`resolveAgentAuto`
  must receive the prompt (or a phase pre-extracted from it). The public `AgentService.resolve(flags,
  deps)` method has no prompt and is called **only from tests** (`agent-service.test.ts:1053,1060`) —
  there is no production caller — so a prompt-less `resolve()` yields no phase and keeps the current
  Tier-1 behavior (see R12).
- `apps/cli/src/config/schema.ts` — `AgentConfigSchema` validates only `default`. This is the schema
  `runNodeApplication` actually uses (via `SpurAppConfigSchema.safeParse`) to produce
  `appRt.config`. It is **separate** from `packages/config`'s `spurConfigSchema`, which owns only
  `tasks`/`features` and feeds the task/feature CLI — not `appRt.config`. Whatever houses the new
  agent schema, the CLI's `SpurAppConfigSchema` must compose it so `appRt.config.agent` is populated.
- `apps/cli/schemas/spur-config.schema.json` mirrors the project config for runtime/IDE validation;
  its `agent` block currently exposes only `default`.
- `apps/cli/src/index.ts` validates `SpurAppConfig` via `runNodeApplication`, but the `start` callback
  names the runtime param `_appRt` (unused, ~line 66) and builds `CliContext` without passing config.
- `apps/cli/src/context.ts` constructs `new AgentService({ cwd, env, output })` (~line 67); it must
  also pass the validated `agent` config block.
- `AgentName` is `'claude' | 'codex' | 'gemini' | 'pi' | 'opencode' | 'antigravity-cli' | 'openclaw' |
  'hermes' | 'omp'` — so each executor's `agent` field must canonicalize through `resolveAgentName()`;
  `model` strings (`zai//glm-5.2`, `volc/glm-5.2`) are opaque and pass straight to `PromptOptions.model`.
### Acceptance Criteria
```gherkin
Feature: Make agent auto resolution phase-aware with executor profiles

  @core
  Scenario: R1 phase-specific auto resolution selects a configured executor
    Given `.spur/config.yaml` defines `agent.executors` and `agent.default-by-phase.dev-run: omp-zai`
    When `spur agent run "/sp:dev-run 0126 --auto" --agent auto --json` resolves the agent
    Then Spur dispatches the canonical `omp` agent with model `zai//glm-5.2`

  @core
  Scenario: R2 auto resolution falls back to the configured default executor
    Given `.spur/config.yaml` defines `agent.default: omp` and no matching phase entry
    When `spur agent run "plain prompt" --agent auto --json` resolves the agent
    Then Spur dispatches the `omp` executor profile

  @core
  Scenario: R3 legacy config without executors keeps current behavior
    Given `.spur/config.yaml` has no `agent.executors` and no `agent.default-by-phase`
    When `spur agent run "plain prompt" --agent auto` resolves the agent
    Then Spur selects the first usable Tier-1 agent exactly as before

  @edge
  Scenario: R4 unknown configured executor fails before spawning an agent
    Given `.spur/config.yaml` maps `dev-review` to an unknown executor name
    When `spur agent run "/sp:dev-review 0126" --agent auto` resolves the agent
    Then Spur exits with code 2 and reports the missing executor and phase

  @edge
  Scenario: R7 configured-but-unusable phase executor fails fast without falling back
    Given `.spur/config.yaml` maps `dev-plan` to a known executor whose agent is not usable
    When `spur agent run "/sp:dev-plan 0126" --agent auto` resolves the agent
    Then Spur exits with code 1, names the agent and phase, and does not fall back to `agent.default`

  @edge
  Scenario: R6 explicit --model wins over the executor model override
    Given `agent.default-by-phase.dev-run` resolves to executor `omp-zai` with model `zai//glm-5.2`
    When `spur agent run "/sp:dev-run 0126" --agent auto --model my-model` resolves the agent
    Then Spur dispatches `omp` with `PromptOptions.model` equal to `my-model`
```
### Requirements
- R1. Extend the agent config schema with executor profiles. **Pass: `SpurAppConfigSchema` accepts `agent.executors[]` entries with `name`, `agent`, and optional `model`, and rejects missing `name`/`agent`, duplicate executor names, or non-string model values.**
- R2. Represent `default-by-phase` as `Record<string, string>` in config. **Pass: config with `default-by-phase.dev-run: omp-zai` parses; array-of-map syntax is rejected with a clear schema error and the docs show only the map form.**
- R3. Thread validated app config into the app layer. **Pass: `apps/cli/src/index.ts` renames `_appRt` -> `appRt` and passes `appRt.config.agent` into `createCliContext`, which passes it into `new AgentService(...)` as an optional `agentConfig`; no `packages/app` import from `apps/cli`. The agent schema is composed into `SpurAppConfigSchema` (not only into `spurConfigSchema`), so `appRt.config.agent` is actually populated.**
- R4. Resolve `--agent auto` from phase-specific executor config. **Pass: slash prompts `/sp:dev-run ...`, `/sp-dev-run ...`, and `/rd3:dev-run ...` normalize to phase `dev-run`, look up `agent.default-by-phase.dev-run`, then resolve the named executor.**
- R5. Preserve fallback behavior. **Pass: if no phase match exists, use `agent.default`; if no usable configured default exists, fall back to the current static Tier-1 priority resolver; existing configs with only `agent.default: pi` continue to work.**
- R6. Apply executor model overrides without clobbering explicit CLI model. **Pass: an executor `model` becomes `PromptOptions.model` only when the user did not pass `--model`; explicit `--model` wins.**
- R7. Tighten readiness checks for configured executors, with a fail-fast exit-code split. **Pass: a configured phase whose executor name is unknown exits 2; a configured phase whose executor's canonical agent is installed-but-not-usable (or not installed) exits 1; both messages name the offending executor/agent and the phase. A configured-but-broken phase mapping does NOT fall back — only an absent phase mapping falls back to `agent.default`.**
- R8. Keep `current` and explicit names semantics stable. **Pass: `--agent current` still reads `SPUR_AGENT`; `--agent claude` still resolves directly and does not consult phase config.**
- R9. Update config examples and authoritative docs. **Pass: `config/config.example.yaml`, `docs/04_DESIGN.md`, and `apps/cli/schemas/spur-config.schema.json` all document the executor profile shape and `spur agent run` auto behavior consistently.**
- R10. Add focused regression tests. **Pass: tests cover phase match, default fallback, legacy no-config fallback, model injection, explicit-model override, unknown executor (exit 2), configured-but-unusable executor (exit 1), duplicate executor (schema reject), slash-command phase normalization across `/sp:`/`/sp-`/`/rd3:`, and prompt-less `resolve()` yielding no phase.**
- R11. Full gate. **Pass: `bun run lint`, `bun run test`, `bun run test-cf`, and `bun run build` all pass without skipped tests or new suppressions.**
- R12. Define prompt-less resolution behavior. **Pass: the public `AgentService.resolve(flags, deps)` (no prompt; test-only call site today) derives no phase and resolves via `agent.default` then the static Tier-1 priority resolver — never throwing for a missing prompt. Phase-aware resolution applies only on the `run`/`executeRun` path where the prompt is in scope.**
### Design
Implement `auto` as a two-stage selector. Resolution is a function of `(prompt, flags, config)` —
the prompt must be threaded into `resolveAgent` so the phase can be derived.

1. Resolve the requested selector:
   - `current` -> `SPUR_AGENT` -> explicit canonical agent path (no phase, no config lookup).
   - explicit value -> existing `resolveAgentExplicit()` path (no phase, no config lookup).
   - `auto` -> phase-aware executor path below.
2. For `auto`, extract phase from the **raw prompt** before slash translation:
   - `/sp:dev-run 0126 --auto` -> `dev-run`.
   - `/sp-dev-run 0126 --auto` -> `dev-run`.
   - `/rd3:dev-run 0126 --auto` -> `dev-run`.
   - no prompt (public `resolve()`), or any non-`/sp|sp-|rd3` prompt -> no phase.
3. Resolve the configured executor selector:
   - If phase exists and `agent.default-by-phase[phase]` exists, that value must name a configured
     executor (or a legacy direct agent). If the named executor is unknown -> exit 2 with the missing
     name + phase. If the executor's canonical agent is not usable -> exit 1 with the agent + phase.
     A phase that is **explicitly configured but broken does not fall back** (R7).
   - Else, if `agent.default` is present, resolve it as an executor selector, then as a legacy direct
     agent. If neither resolves to a usable agent, fall through to the priority resolver.
   - Else preserve the current static Tier-1 priority resolver.
4. Convert the selected executor into an execution profile:
   - `agent` is canonicalized through `resolveAgentName()`.
   - `model` is optional and is applied only when no explicit `--model` was supplied.
   - `source: 'phase' | 'default' | 'priority' | 'current' | 'explicit'` is carried for
     diagnostics/tests; it need not be printed unless useful.

Resolution-result shape:

- Replace `AgentResolveResult` with an execution-profile result:
  `{ ok: true; agent: AgentName; model?: string; source: ... } | { ok: false; exitCode; message }`.
  Both internal call sites (`resolve()` public, `executeRun()`) and the two test call sites must move
  to the new shape. `executeRun` then sets `promptOptions.model` from the resolved `model` **only if**
  the user did not pass `--model` (explicit `--model` wins, R6).

Configuration ownership (precise):

- The agent config zod shape must end up in `apps/cli/src/config/schema.ts`'s `SpurAppConfigSchema`,
  because that is the schema `runNodeApplication` parses into `appRt.config`. Defining the shape in
  `packages/config` (alongside `tasksConfigSchema`) and **re-exporting/composing it** into
  `SpurAppConfigSchema` is acceptable and avoids a reverse import from `packages/app` into `apps/cli`;
  defining it directly in the CLI schema is also acceptable. Do **not** add it only to
  `spurConfigSchema` — that schema does not feed `appRt.config` and R3 would silently fail.
- `apps/cli/src/index.ts` must pass the already-validated `appRt.config` (rename `_appRt` -> `appRt`)
  into `createCliContext`. Re-loading `.spur/config.yaml` inside `AgentService` would violate the
  app-layer boundary and duplicate config resolution.
- `createCliContext` threads `config.agent` into `new AgentService({ cwd, env, output, agentConfig })`;
  `AgentServiceContext` gains an optional `agentConfig` field (optional so the no-config CLI path and
  existing tests keep compiling). When absent, resolution behaves exactly as today.
- `apps/cli/schemas/spur-config.schema.json` must mirror the zod shape because runtime schema
  validation (`loadSpurConfig`) uses this embedded JSON schema. Keep the two in lock-step.
### Plan
- [ ] 1. Define agent config types:
  `AgentExecutorConfig { name: string; agent: string; model?: string }` and
  `AgentConfig { default?: string; executors?: AgentExecutorConfig[]; 'default-by-phase'?: Record<string, string> }`.
  Place the zod shape so the CLI's `SpurAppConfigSchema` composes it (in `apps/cli/src/config/schema.ts`,
  or in `packages/config` and re-exported into the CLI schema) — never only in `spurConfigSchema`.
- [ ] 2. Validate uniqueness/shape: reject missing `name`/`agent`, duplicate executor names, and
  non-string `model`. Reject the legacy array-of-single-key-maps form for `default-by-phase`.
- [ ] 3. Mirror the shape into `apps/cli/schemas/spur-config.schema.json` and update config tests.
- [ ] 4. Rename `_appRt` -> `appRt` in `apps/cli/src/index.ts`; pass `appRt.config.agent` into
  `createCliContext`; thread it into `new AgentService(...)`. Add optional `agentConfig` to
  `AgentServiceContext` (absent => current behavior).
- [ ] 5. Refactor `AgentService` resolution: thread the prompt into `resolveAgent`/`resolveAgentAuto`;
  replace `AgentResolveResult` with the execution-profile result
  `{ ok; agent; model?; source }`; update both call sites (`resolve()`, `executeRun()`) and the two
  test call sites.
- [ ] 6. Implement phase extraction from the raw prompt **before** slash translation
  (`/sp:dev-run` / `/sp-dev-run` / `/rd3:dev-run` -> `dev-run`; none otherwise).
- [ ] 7. Apply the resolved executor `model` when building `PromptOptions`, with explicit `--model`
  taking precedence (R6).
- [ ] 8. Enforce R7 fail-fast: unknown executor name -> exit 2; configured-but-unusable executor ->
  exit 1; both messages name the phase. Only an absent phase mapping falls back to default.
- [ ] 9. Add/adjust tests in `packages/app/tests/services/agent-service.test.ts` and config tests
  covering R10's full matrix (phase match, default fallback, legacy no-config fallback, model
  injection, explicit-model override, unknown executor, unusable executor, duplicate executor,
  slash-command phase normalization, prompt-less `resolve()` yields no phase).
- [ ] 10. Sync `config/config.example.yaml` and `docs/04_DESIGN.md` (`spur agent run` auto behavior).
- [ ] 11. Run the full verification gate (`bun run lint`, `bun run test`, `bun run test-cf`,
  `bun run build`) and record the result in this task.
### Solution
Phase-aware `--agent auto` resolution with named executor profiles. `auto` now derives a dev phase from the prompt's slash command, looks up a configured executor via `agent.default-by-phase`, and applies that executor's model override (unless an explicit `--model` wins). A configured phase mapping is authoritative — a broken mapping fails fast (unknown executor → exit 2; unusable agent → exit 1) and does not fall back. Absent config preserves the legacy Tier-1 priority behavior.

| File | What / Why |
|------|------------|
| `apps/cli/src/config/schema.ts:12` | Add `AgentExecutorConfigSchema` (`name`/`agent`/optional `model`); extend `AgentConfigSchema` with `executors[]` + `default-by-phase` map; `superRefine` rejects duplicate executor names; export `AgentExecutorConfig`/`AgentConfig` types. (R1, R2) |
| `apps/cli/schemas/spur-config.schema.json:101` | Mirror the zod shape into the embedded JSON schema (executors array + `default-by-phase` map) so `loadSpurConfig` runtime validation stays in lock-step. (R9) |
| `apps/cli/src/index.ts:66` | Rename `_appRt`→`appRt`; thread `appRt.appConfig?.agent` into `createCliContext`. ts-infra exposes app config on `.appConfig`, not `.config`. (R3) |
| `apps/cli/src/context.ts:67` | Import `AgentConfig` from spur-app; add optional `agentConfig` to `createCliContext`; pass it into `new AgentService(...)`. (R3) |
| `apps/cli/src/commands/agent.ts:251` | **Bug fix:** `runAgentRun` resolves via `context.agentService()` instead of a bare `new AgentService(...)` — the bare construction dropped `agentConfig` and disabled phase-aware auto. (R3 integration gap) |
| `packages/app/src/services/agent-service.ts:31` | Replace `AgentResolveResult` with execution-profile result (`{ok;agent;model?;source}`); add structural `AgentConfig`/`AgentExecutorConfig` types (no `apps/cli` import, R3). |
| `packages/app/src/services/agent-service.ts:294` | Thread `prompt` into `resolveAgent`; add `resolveAgentAuto` (phase→executor→default→priority), `resolveExecutorSelector` (fail-fast split, R7), `checkUsable`. (R4, R5, R7, R8, R12) |
| `packages/app/src/services/agent-service.ts:243` | Apply executor model to `PromptOptions` only when no explicit `--model` (R6). |
| `packages/app/src/services/agent-service.ts:391` | `extractPhase` maps `/sp:`,`/sp-`,`/rd3:` prefixed commands to a bare phase. (R4) |
| `packages/app/src/index.ts:5` | Export `AgentConfig`, `AgentExecutorConfig`, `AgentResolveSource` from the barrel. |
| `packages/app/tests/services/agent-service.test.ts:1158` | Phase-aware matrix: R1–R8, R12, slash normalization, default→priority fallthrough. (R10) |
| `apps/cli/tests/config/schema.test.ts:75` | Schema matrix: accepts executors+phase map; rejects missing name/agent, non-string model, duplicate names, array-of-map form. (R10) |
| `apps/cli/tests/commands/agent.test.ts:30` | Regression lock: `runAgentRun` routes through `context.agentService()` (guards the bug fix). |
| `config/config.example.yaml:38` | Document executor profile + `default-by-phase` map (commented examples). (R9) |
| `docs/04_DESIGN.md:95` | Document phase-aware `spur agent run --agent auto`, fail-fast exit split, model precedence. (R9) |
### Testing

Full verification gate (R11): all green.

- `bun run lint` — Biome clean (377 files) + per-workspace `tsc --noEmit` all exit 0.
- `bun run test` — **1912 pass, 0 fail** across 147 files (was 1911; +1 net new file effect, +~22 new test cases).
- `bun run test-cf` — server Workers runtime: 1 file / 1 test passed.
- `bun run build` — all workspaces built (cli/server/web).

New coverage: phase-aware resolution matrix (12 cases) in `agent-service.test.ts`; executor schema matrix (5 cases) in `schema.test.ts`; service-wiring regression in `agent.test.ts`. End-to-end smoke against a real `.spur/config.yaml` confirmed R1 (omp+zai//glm-5.2), R4 (exit 2), R6 (explicit --model wins) via the actual CLI dispatch diagnostics.

### Review
**Verdict: PASS** (self-review; workflow-owned verification).

All 12 requirements (R1–R12) verified against the implementation and the full gate. End-to-end smoke against a real `.spur/config.yaml` confirmed R1 (resolves `omp` + model `zai//glm-5.2`), R4 (unknown executor → exit 2, no dispatch), and R6 (explicit `--model my-model` overrides the executor model) via the actual CLI dispatch diagnostics.

Priority findings:

| Priority | File | Finding | Recommendation |
|----------|------|---------|----------------|
| P1 | — | None — no blocking defects. | — |
| P2 | `apps/cli/src/commands/agent.ts:251` | `runAgentRun` originally built a bare `AgentService`, dropping the threaded `agentConfig` (would have silently disabled the whole feature). Caught by end-to-end smoke, not unit tests. | **Fixed** in this change + regression test added (`agent.test.ts`). |
| P3 | `apps/cli/src/index.ts:66` | Task design referenced `appRt.config.agent`; ts-infra actually exposes app config on `appRt.appConfig`. | **Fixed** — used `.appConfig`; design doc note added. |
| P4 | — | None. | — |

Traceability — every requirement met:
- R1 executor schema ✅ · R2 phase map ✅ · R3 config threading (+bug fix) ✅ · R4 phase normalization ✅
- R5 fallback ✅ · R6 model precedence ✅ · R7 fail-fast exit split ✅ · R8 current/explicit stable ✅
- R9 docs sync ✅ · R10 regression matrix ✅ · R11 full gate green (lint, 1912 tests, test-cf, build) ✅ · R12 prompt-less resolve ✅
### References

- `packages/app/src/services/agent-service.ts`
- `apps/cli/src/config/schema.ts`
- `apps/cli/schemas/spur-config.schema.json`
- `apps/cli/src/index.ts`
- `apps/cli/src/context.ts`
- `config/config.example.yaml`
- `docs/04_DESIGN.md`

### History
- 2026-06-26: Created from `sp-dev-brainstorm` refinement of phase-aware `--agent auto` proposal.
- 2026-06-25: Reviewed and refined (Lord Robb). Verified all code anchors against the working tree.
  Closed four gaps before execution: (1) the prompt is not threaded into `resolveAgent` today — added
  the signature-change requirement and R12 for prompt-less `resolve()`; (2) the agent schema must be
  composed into the CLI's `SpurAppConfigSchema` (feeds `appRt.config`), not just `packages/config`'s
  `spurConfigSchema` — clarified R3 + Design ownership; (3) split R7's fail-fast into exit 2 (unknown
  executor) vs exit 1 (configured-but-unusable) with a dedicated @edge AC; (4) added an @edge AC for
  explicit `--model` precedence (R6). Plan expanded to 11 steps.
- 2026-06-26T15:54:04.002Z todo → wip (system)
- 2026-06-26T16:07:48.926Z wip → testing (system)
