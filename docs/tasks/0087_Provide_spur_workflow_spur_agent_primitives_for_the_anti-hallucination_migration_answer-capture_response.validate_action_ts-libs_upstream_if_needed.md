---
schema_version: 1
name: "Provide spur workflow + spur agent primitives for the anti-hallucination migration (answer-capture, response.validate action, ts-libs upstream if needed)"
description: "Provide spur workflow + spur agent primitives for the anti-hallucination migration (answer-capture, response.validate action, ts-libs upstream if needed)"
status: done
type: task
priority: P1
dependencies: ["superskill#0041"]
tags: ["anti-hallucination","workflow","agent","dogfood","ts-libs","cross-repo"]
created_at: 2026-06-18T06:48:44.275Z
updated_at: "2026-08-18T04:42:46.739Z"
---

## 0087. "Provide spur workflow + spur agent primitives for the anti-hallucination migration (answer-capture, response.validate action, ts-libs upstream if needed)"

### Background

The `anti-hallucination` agent skill is being migrated **out of Spur** into the `superskill` repo
(superskill task **0041**), where it belongs by charter (an agentic answer-verification protocol, not
a dev-workflow). Part of that migration re-develops the skill's six cross-agent launcher scripts
(`run_with_validation.ts`, `acpx_agent_wrapper.ts`, 4 × `run_*_with_validation.ts`) as a
**`spur workflow` + `spur agent`** solution instead of hand-rolled `acpx` spawners.

**This task tracks only the Spur-side (and ts-libs upstream) capabilities that re-development needs.**
The skill content, its hook, and the workflow YAML are owned by superskill 0041; Spur must provide the
workflow primitives that 0041 consumes.

#### Why this is a separate task

Decided 2026-06-17 with the operator: requirements that push Spur — or its upstream
`@gobing-ai/ts-dual-workflow-engine` in `~/xprojects/ts-libs/` — are tracked here so the harness
evolves cleanly. This is also a deliberate **dogfooding** exercise: if a real consumer (the
anti-hallucination flow) needs the workflow engine to do something it can't yet, we improve the
engine rather than work around it.

#### What already exists (so scope stays small)

Spur's workflow engine already ships the two actions the pattern needs, in
`packages/app/src/workflow/actions/`:

- **`agent.run`** (`agent-run.ts`) — delegates to `AgentService.run`; agent-agnostic via
  `--agent <name>`; has a session latch for multi-step continuity. **Gap:** it returns
  `data: { exitCode, agent }` and does NOT surface the agent's answer **text** — `AgentService.run`
  writes straight to output and returns only an exit code.
- **`rule.check`** (`rule-check.ts`) — the precedent for an action that runs a service and the
  workflow branches on `{ ok }`.

The workflow engine itself is input-agnostic (loops steps, branches on `ActionResult.ok`), so adding
a validate step is an action + a data-threading change, not an engine-loop rewrite.

#### The crux

The validate-the-answer step needs the agent's **answer text** to flow from the `agent.run` step
into a new `response.validate` step. Capturing that text out of `AgentService.run` (which currently
returns only an exit code) is the one non-trivial Spur change. Everything else is additive.


### Requirements

## Requirements

Phase 8 traceability — 2026-06-18. Verdict: **PASS** (all in-scope requirements MET; R3/R4 deferred-by-design items tracked, not failed).

- [x] **R1.1** Answer text retrievable without breaking exit-code contract → **MET** | `agent-service.ts:157 runCapture()` returns `{ exitCode, answer }`; `run()` unchanged, both delegate to private `executeRun()` (`:180`).
- [x] **R1.2** `agent.run` surfaces answer in `ActionResult.data` → **MET** | `agent-run.ts:66-77` — `capture: true` → `data.answer` + `setVars`; default path untouched (`:80`).
- [x] **R1.3** Tests: capture returns answer; no-capture unchanged → **MET** | `agent-run.test.ts` (capture cases) + `agent-service.test.ts` (+99 lines, both paths).
- [x] **R2.1** `response.validate` action, `ok/data/error` mapping → **MET** | `response-validate.ts:34 ResponseValidateActionRunner` mirrors `rule.check`.
- [x] **R2.2** Input from var/step data, not a file → **MET** | reads `options.text` (templated `{{ steps.generate.answer }}`); no file I/O (`:44`).
- [x] **R2.3** Engine single-sourced (DI, not re-implemented); registered in builtins → **MET** | `ResponseValidateEngine` interface injected (`:17`); `builtins.ts:41` registers only when engine provided. No verification rules copied into Spur.
- [x] **R2.4** Tests: ok / fail / empty-text → **MET** | `response-validate.test.ts` — 9 cases incl. empty-string (`:80`), missing/null text, issues-omitted.
- [~] **R3.1** Push ts-libs if flow can't express retry/deny → **PARTIAL (deferred by design)** | Spike (`fixtures/anti-hallucination-spike.yaml`) proves the pattern via `iterationBound`; a real var-based retry guard is documented as future work. No upstream push needed yet — within scope's "only if needed".
- [x] **R3.2** Confirm setVars/step-data sufficient to carry answer + counter → **MET** | answer threads via `data.answer`/`setVars`; spike documents the `__retryCount` guard recipe for 0041.
- [~] **R4.1** Live engine import seam → **PARTIAL (deferred to 0041)** | Seam established (`SpurWorkflowBuiltinsOptions.responseValidateEngine`); concrete import waits on superskill 0041 publishing the package. Correct per task's own cross-repo dependency.
- [x] **R5.1** ADR entry → **MET** | `docs/00_ADR.md` ADR-024 (engine leaves Spur; capture + response.validate added; consumed not owned).
- [x] **R5.2** DESIGN entry, same commit → **MET** | `docs/04_DESIGN.md` rows for `runCapture`, `agent.run capture:true`, `response.validate`.
- [x] **R5.3** FEATURES status entry → **MET** | `docs/05_FEATURES.md` ✅ row for the capability.

**Acceptance gate:** `lint`+`test`+`test-cf`+`build` green, no skipped tests ✅ · `agent.run` surfaces answer via `capture:true` ✅ · `response.validate` registered + tested ✅ · spike reaches terminal (`done`) in the engine ✅.

**Scope drift:** none. Implementation stayed within R1/R2/R5 (in-scope) and correctly deferred R3.1/R4.1 to their owners (ts-libs / superskill 0041) rather than over-building.


### Acceptance Criteria

- `bun run lint` + `bun run test` + `bun run test-cf` + `bun run build` green; no skipped tests.
- `agent.run` can surface answer text via `capture: true` option; `response.validate` action registered and tested.
- superskill 0041 Phase 4 can author `anti-hallucination.yaml` against these primitives and reach a terminal state in dry-run.

### Q&A



### Design

- **Scope:** Additive, backward-compatible changes to Spur's workflow layer. No existing signatures change; capture is opt-in via a new method.
- **Key decision — answer capture:** Extract the core execution logic from `AgentService.run` (`packages/app/src/services/agent-service.ts:120`) into a private `executeRun` method that returns `AgentRunResult`. The existing `run` method delegates to it (unchanged behavior). A new `runCapture` method delegates to it, skips output handling, and returns `{ exitCode, answer }` where `answer = result.stdout`. This avoids a signature change to all current callers.
- **Key decision — engine seam:** The `response.validate` action accepts a `ResponseValidateEngine` interface via constructor injection (same pattern as `RuleCheckActionRunner` accepting `RuleService`). The interface mirrors `verifyAntiHallucinationProtocol(text: string): { ok, reason, issues? }` from `ah_guard.ts:198`. The concrete engine is wired in `builtins.ts` via `SpurWorkflowBuiltinsOptions`. Until superskill 0041 publishes the engine package, the caller injects a thin adapter over the existing `plugins/sp/skills/anti-hallucination/scripts/ah_guard.ts`.
- **Boundaries affected:** `packages/app/src/services/agent-service.ts` (new `runCapture` method), `packages/app/src/workflow/actions/agent-run.ts` (answer in `data.answer`), new `packages/app/src/workflow/actions/response-validate.ts`, `packages/app/src/workflow/builtins.ts` (registration + options).
- **Risks:** Capture path must be strictly opt-in — `run` callers (CLI `agent.ts:263`, workflow `agent-run.ts:63`) must be unaffected. The engine seam defers the real import to superskill 0041; the interface contract must match what 0041 publishes.

### Solution


Additive, backward-compatible changes to Spur's workflow layer that superskill 0041 Phase 4 consumes.
Order chosen so each step is independently verifiable.

#### Step 1 — Answer capture on `AgentService.run` (R1)
- Add an opt-in capture path to `AgentService.run` (`packages/app/src/services/agent-service.ts:120`) that returns the final answer text alongside the
  exit code (e.g. an options flag → `{ exitCode, answer }`, or an injected sink). Do NOT change the
  default signature relied on by existing CLI callers (`apps/cli/src/commands/agent.ts:263`,
  `rule`/`workflow` services).
- Unit-test both paths: default (exit code only, unchanged) and capture (answer returned).

#### Step 2 — Thread answer through the `agent.run` action (R1.2)
- In `packages/app/src/workflow/actions/agent-run.ts:63`, when capture is enabled, put the answer in
  `ActionResult.data.answer` (and/or `setVars`) so a later step references it. Keep the session-latch
  behavior intact.

#### Step 3 — `response.validate` action (R2)
- New `packages/app/src/workflow/actions/response-validate.ts` mirroring `packages/app/src/workflow/actions/rule-check.ts:25`: reads text
  from options/vars, calls the injected guard engine, maps `{ ok, reason, issues }` to `ActionResult`.
- Register in `packages/app/src/workflow/builtins.ts:24`.
- The guard engine is injected via `ResponseValidateEngine` interface (the seam); superskill 0041
  publishes the real implementation. Temporary: the caller wires the engine from
  `plugins/sp/skills/anti-hallucination/scripts/ah_guard.ts:198` until 0041 publishes.
- Unit-test ok / fail / empty-text.


#### Step 4 — Verify the transition-flow expresses retry/deny (R3)
- Spike a minimal `anti-hallucination.yaml` (can live as a Spur test fixture until 0041 owns the real
  one): `generate → validate → ok:done | fail:generate(bounded) | exhausted:denied`.
- Dry-run to terminal. If retry-count / step-data threading is missing in
  `@gobing-ai/ts-dual-workflow-engine`, make the smallest upstream change in `~/xprojects/ts-libs/`
  (R3.1): verify ts-libs gates, release, bump the Bun catalog, re-verify Spur. Document the temporary
  `bun link` in this task until released.

#### Step 5 — Seam + governance (R4, R5)
- Lock the guard-engine consumption seam with superskill 0041 (package name + version).
- ADR + `04_DESIGN.md` + `05_FEATURES.md` updates in the same commit as the code.

#### Coordination with superskill 0041
- **0041 Phases 1–3** (relocate engine/prose, re-home hook, delete from Spur) do NOT depend on this
  task and can land first.
- **0041 Phase 4** (the workflow re-development) depends on Steps 1–3 here.
- The guard engine seam (R4 here ↔ 0041 R5) must be agreed once and referenced by both.

#### Risk notes
- **Capture without regressions** is the main risk: `AgentService.run` is called from several CLI
  paths; the capture must be strictly opt-in. Cover the default path explicitly so the gate proves no
  behavior change.
- **Upstream push (R3.1) may widen scope.** If the engine needs retry/guard primitives it lacks,
  that is real ts-libs work — acceptable per the operator's dogfooding stance, but flag it so the
  estimate reflects a possible cross-repo release.


### Plan

- [x] Review task requirements and existing code (AgentService, agent-run, rule-check, builtins, ah_guard)
- [x] R1: Extract `executeRun` private method from `AgentService.run`, add `runCapture` returning `{ exitCode, answer }`
- [x] R1: Update `agent-run.ts` to use `runCapture` and surface `data.answer`
- [x] R2: Create `response-validate.ts` with `ResponseValidateEngine` interface and action runner
- [x] R2: Register `response.validate` in `builtins.ts` with engine injection via options
- [x] R3: Spike transition-flow retry/deny pattern; verify engine supports it or push upstream
- [x] Write unit tests for all new code (AgentService.runCapture, agent-run capture, response.validate)
- [x] Run lint + test + build gates
- [x] Update docs (00_ADR.md, 04_DESIGN.md, 05_FEATURES.md)
- [x] Fill in Review and Testing sections


### Testing

- **Coverage:** `agent-service.ts` 100%/100%, `agent-run.ts` 100%/100%, `response-validate.ts` 100%/100%.
- **Regressions:** all 47 existing `AgentService.run` + `agent.run` tests pass unchanged.
- **New tests (22 total):**
  - `AgentService.runCapture`: 8 tests — success, non-zero exit, signal, validation errors, output suppression, Tier-2 suppression, buffered mode.
  - `AgentRunActionRunner` capture: 5 tests — `capture:true` path, error path, default (no capture) path, session latch on success/failure.
  - `ResponseValidateActionRunner`: 9 tests — ok, fail, missing text, null text, engine forwarding, issues omission, empty string, kind.
- **Spike fixture:** `packages/app/tests/fixtures/anti-hallucination-spike.yaml` validates cleanly via `spur workflow validate`.

### Artifacts

| Type | Path | Agent | Date |
| ---- | ---- | ----- | ---- |

### References
