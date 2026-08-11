---
template: meta
schema_version: 1
name: "Fix executor routing and pipeline resilience from the 0502 post-mortem"
description: ""
status: done
type: meta
profile: standard
feature_id: null
parent_wbs: null
priority: P1
tags: ["meta"]
dependencies: []
ac_numbering: task-local
created_at: "2026-08-11T00:03:52.022Z"
updated_at: "2026-08-11T02:22:57.997Z"
---

## 0503. Fix executor routing and pipeline resilience from the 0502 post-mortem

### Background
`/sp-dev-run 0502 --auto --next` (2026-08-10, 22:16–23:40 UTC) completed in ~84 minutes of wall time for a 12-minute implement (codex, 226k tokens), after three terminal executor failures, one pipeline death mid-transition, and ~25 minutes of DB-lock contention with the operator's concurrent `spur history import` runs. The operator's core complaint: omitting `--agent` should route the work to the invoking session, but the pipeline dispatched `omp`/`codex` subprocesses, and the `--agent inline` retry was equally slow.

Root causes, ranked: (RC1) the resource-exhaustion escalation classifier (0482 R1/R5) misses the exact provider messages claude and grok emitted — a single ad-hoc regex that cannot scale to every provider's error vocabulary; (RC2) the precheck doctor gate (0487 R2) hard-blocks `agent.default` on an env-probe `unauthenticated` that cannot see relay-held credentials — the same executor+model the wrap pipeline ran successfully 90 minutes later; (RC3) a concurrent coding agent's `bun link` surgery in the same checkout transiently dangled the `ts-llm-jsonl-importer` symlink for the exact second of the post-implement transition, which has no retry → terminal `failed` with completed work; (RC4) full-mode stages resolve omit/`inline` to a subprocess of `agent.default` (ADR-047) — the operator's remembered "inline default" fix (f88979bb) only covers single-skill commands and implement mode; (RC5) the quality-gate probe fails hard on a SQLite lock held by any concurrent spur process.

The operator's direction (2026-08-10): fix RC1 and RC4 **fundamentally** — a deterministic classification mechanism for provider failures, and an ADR-047 amendment making interactive full-mode stages run in the host session when no executor is named — not workarounds. RC3 is a race between a concurrent writer (violating the one-writer rule, task 0487 R5) and a pipeline with no transient-failure retry; both sides are investigated here.
### Requirements
- [ ] R1. Deterministic failure-classification registry. Replace the single ad-hoc regex in `classifyObjectiveFailure` (`packages/app/src/services/agent-service.ts:1522-1537`) with a typed, data-driven classification table: per-provider rows (anthropic/claude, grok/xai, openai, volc, zai, ollama, gemini) mapping real provider messages and HTTP status codes (401/402/403/429/529) to objective signals (`resource-exhaustion`, `auth`). Classification is a pure, deterministic function `(exitCode, stdout, stderr, signal) → ObjectiveEscalationSignal | undefined`; every provider row has a unit test asserting its literal message classifies correctly and ordinary stderr noise does not (0407 R1 precision bias preserved). Adding a provider = one table row + one test — the mechanism never grows by regex whack-a-mole, and every process that relies on classification (escalation, failover, verdicts) sees the same predictable result.
- [ ] R2. Precheck doctor gate aligned with the 0407/0482 doctor guidance. The task-pipeline precheck gate (0487 R2, `config/workflows/task-pipeline.yaml`) must not hard-fail omp-style executors on an env-probe `authenticated: unauthenticated` — the doctor reads `${PROVIDER}_API_KEY` from the CLI process env and cannot see an agent-owned credential store (cross-cutting.md "Executor exhaustion is survivable"), proven by the 0502 wrap running `volc/deepseek-v4-flash-ga-260731` successfully after the gate blocked it. Env-probe misses degrade to soft (`unknown`); a hard FAIL is retained only for genuinely unauthenticated non-omp agents, and any FAIL names the remediation (`--vars '{"agent":…}'`, fix `agent.default`, or `spur agent doctor <exe> --json`).
- [ ] R3. Lifecycle transition steps survive transient env failures. The post-implement `task update wip` and the record/done transition shell steps retry once on transient ENOENT/EBUSY/ENOTEMPTY (dangling `node_modules` link from a concurrent `bun link`/install, SQLite lock), and the failure output names the broken dependency path with a `bun install` remediation hint, so a completed implement cannot be orphaned into a terminal `failed` run by a race that clears seconds later.
- [ ] R4. ADR-047 amendment: interactive full-mode stages run in the host session. Replace the "warn that inline resolves to agent.default" workaround with the fundamental fix: `/sp-dev-run <wbs> --mode full` (and dev-runall) in an interactive session with `--agent` omitted or `inline` executes the model-bearing stages (implement/review/verify/test-fix) in the host session, not as subprocesses of `agent.default`. `--agent <name>`, `--agent auto`, and headless invocation (`spur workflow run` / `spur agent run`) keep subprocess dispatch. Amend ADR-047 (host-stage control inversion for the interactive case), update cross-cutting.md's "Workflow-driven commands accept inline as agent.default" section, and record inline-stage provenance in the run log (stage executed in-session, session id) so auditability survives the inversion.
- [ ] R5. Quality-gate probe survives DB contention. The pipeline `test`/`test-recheck` probe retries with bounded backoff when the gate fails with `SQLiteError: database is locked` (a concurrent `spur history import` or second session holding spur.db), instead of routing to `test-fix`/`failed` on a transient collision.
- [ ] R6. Gates green. `bun run lint`, `bun run test`, `bun run build`, `bun run spur-check-new` exit 0 with the changes; the new registry carries unit coverage in `packages/app/tests/` and the pipeline changes are covered by the pipeline's existing test fixtures or a targeted smoke.
### Acceptance Criteria
```gherkin
Feature: Executor routing and pipeline resilience (0502 post-mortem)

  Scenario: R1 — provider failures classify deterministically
    Given the classification registry is fed claude's "You've hit your weekly limit · resets Aug 12 at 6pm"
    And grok's "API error (status 402 Payment Required): Grok Build usage balance exhausted"
    And an HTTP-status-only message "status 529"
    Then all three classify as resource-exhaustion
    And an unrelated stderr line ("warning: deprecated") classifies as undefined
    And each provider row in the registry has a passing unit test with its literal message
    And a dispatch whose output contains a classified message escalates (the run log shows "Escalating:")

  Scenario: R2 — relay-authenticated omp executors pass precheck
    Given agent.default is an omp executor whose doctor row reads authenticated: unauthenticated with an env-key probe detail
    When the task-pipeline precheck doctor gate runs
    Then the gate is soft (no FAIL) for the omp executor
    And a genuinely unauthenticated non-omp executor still hard-FAILs with a remediation hint naming --vars agent

  Scenario: R3 — transient transition failures retry with a remediation hint
    Given a completed implement whose `task update wip` shell step hits a transient ENOENT on a dangling node_modules link
    When the step retries once
    Then the transition succeeds and the run continues to test
    And on persistent failure the output names the broken path and suggests bun install

  Scenario: R4 — interactive full mode runs stages in the host session
    Given an interactive session invoking /sp-dev-run <wbs> --mode full with no --agent
    When the pipeline reaches the implement/review/verify stages
    Then each stage executes in the host session (no subprocess of agent.default)
    And the run log records each stage as inline with the session id
    And --agent <name> / --agent auto / headless spur workflow run still dispatch subprocesses
    And the same task-pipeline.yaml guards (precheck, task check, verdict PASS) still gate every transition

  Scenario: R5 — gate probe survives DB lock
    Given a concurrent process holds spur.db
    When the pipeline test probe runs
    Then it retries with backoff until the lock clears and reports PASS
    And a lock that never clears within the bound still routes to test-fix/failed with the lock error named

  Scenario: R6 — gates green
    When bun run lint, bun run test, bun run build, bun run spur-check-new run
    Then each exits 0
    And the failure-classification registry tests and the pipeline fixture tests pass
```
### Q&A
- **Q1 — Why did `/sp-dev-run 0502 --auto --next` dispatch subprocesses when no executor was given?** Because full-mode pipeline stages resolve omit/`inline` to a subprocess of `agent.default` (ADR-047; cross-cutting.md "Workflow-driven commands accept inline as agent.default"). The "inline default" fix (f88979bb) governs single-skill commands and `--mode implement`; pipeline stages were deliberately excluded (ADR-046→047: triggers 2/3 — unattended step + durable run record). The operator's expectation — no executor named → the invoking session does the work — is the correct UX; the contract is what is wrong with it. R4 amends the contract instead of warning around it.
- **Q2 — Was the remembered inline-default a regression?** No — it was never implemented for pipeline stages. The one-rule contract ("`--agent` names who does the thinking; inline when that executor is the current session") is intact; in full mode the executor is `agent.default`, which the host cannot supply — so subprocess was *derived*, not chosen. The actual regressions are RC1 (escalation never fired) and RC2 (gate false-negative), fixed by R1/R2.
- **Q3 — What does the ADR-047 amendment cost?** Running stages in the host session forfeits per-stage subprocess isolation: no independent timeout/abort boundary, no separate agent-run trace, host-session token/workspace exposure. The operator has decided the interactive UX wins (direct, simple solution). The amendment designs in the one non-negotiable remainder: provenance — the run log records each inline stage with the session id, so auditability survives. Headless and explicit-executor paths keep full isolation.
- **Q4 — Why was R2's gate added, and why is it now wrong?** 0487 R2 hardens precheck after runs e8cb00e7/b16bfbf4 died at implement with "API key not found for provider 'volc'". The gate is a blunt env probe that cannot distinguish "relay has no key" from "CLI env lacks the key" — cross-cutting.md already documents the doctor as unreliable for GLM-style executors. The 0502 wrap proved the false negative: `omp -p --model volc/deepseek-v4-flash-ga-260731` succeeded 90 minutes after the gate blocked the same executor. Fix: soft for env-probe misses, rely on R1 escalation for real auth failures.
- **Q5 — Why a registry for failure classification instead of a longer regex?** A regex is a growing, untestable heuristic: every new provider message requires pattern surgery, and the same message shape yields different results across code versions. A typed per-provider table makes classification deterministic (pure function of exit code + status codes + message), extensible (one row + one test per provider), and shared — every consumer (escalation loop, failover ladder, verdict derivation) reads the same registry and gets the same answer. "Accumulate all possible failures into a deterministic result" = the table IS the accumulation, and the tests pin it.
- **Q6 — Expected savings.** R1+R2 remove the executor-failure cascade (3 dead runs + manual executor substitution): ~20–30 min per incident and, once R4 lands, the operator never sees it. R4 removes the subprocess round-trips and the expectation mismatch on every interactive full-mode run. R3 removes the ~40 min manual pipeline-emulation detour when a transition step races a concurrent writer. R5 removes ~25 min of manual gate retries under concurrent-process contention.
- **Q7 — Is R4 too large for one implement pass?** R4 is the biggest item (orchestrator + docs), but it is one coherent change: the in-session driver. The 0503 task sits at 6 requirements / 6 plan items / ~6 files — under the split heuristics (>10 requirements, >8 files). If the implementer finds R4's driver or the ADR amendment genuinely oversized mid-run, split R4 out at that point (stop and record) rather than raise the budget — the rest of the task is independent.
- **Q8 — How does the driver know the invocation is interactive?** The command wrapper runs inside the session, so interactivity is a property of the invocation context it already has (`--agent` omitted/`inline` on a session-backed command surface). Headless surfaces (`spur workflow run`, `spur agent run`, scheduled) are by definition not interactive and never take the inline path. No new env sniffing is required.
- **Q9 — Why does R1's registry return `undefined` on ambiguity instead of a default?** Deterministic and predictable means the same input yields the same signal forever — not that every input gets a signal. `undefined` preserves the 0407 precision bias: an unclassified failure stands as-is (exit code + output) instead of being mis-escalated, and the run log keeps the raw text for a future registry row.
### Design
**Frozen names (implement exactly — do not rename, do not invent alternatives).**

| Kind | Name |
| --- | --- |
| Registry module | `packages/app/src/services/failure-classification.ts` (new) |
| Rule type | `FailureRule = { provider: string; signal: ObjectiveEscalationSignal; statusCodes?: number[]; patterns: RegExp[] }` |
| Registry | `FAILURE_RULES: FailureRule[]` — one row per provider (anthropic, grok, openai, volc, zai, ollama, gemini); row patterns ANDed; statusCodes ORed; row matches when statusCodes hit OR every pattern matches |
| Classifier | `export function classifyDispatch(result: Pick<AgentRunResult, 'exitCode' | 'stdout' | 'stderr' | 'signal'>): ObjectiveEscalationSignal | undefined` — pure, no I/O, no env |
| Thin adapter | `classifyObjectiveFailure(result)` in `agent-service.ts:1522-1537` delegates to `classifyDispatch` (kept so the escalation loop's call site is unchanged) |
| Barrel export | `export { classifyDispatch } from './services/failure-classification';` in `packages/app/src/index.ts` |
| Registry tests | `packages/app/tests/services/failure-classification.test.ts` (new) |
| Precheck probe classifier | `classifyDoctorProbe(detail: string, agent: string): 'env-miss' | 'auth-fail' | 'unknown'` — `env-miss` for `/API key not found for provider/`, `/no probe registered/` on omp/pi agents; `auth-fail` for explicit negative auth; else `unknown` |
| R4 provenance line | `stage <id> executed inline in session <session-id>` appended to `.spur/run/<runId>.log` |

**R1 — classification registry.** Current defect: `classifyObjectiveFailure`'s alternation misses claude's "You've hit your weekly limit · resets Aug 12 at 6pm" (run `c558d71c`, exit 3, no escalation) and grok's "API error (status 402 Payment Required): Grok Build usage balance exhausted" (run `415ad467`, exit 3, no escalation). Implementation: create the registry module; seed rows from the 0502 log literals (claude, grok) plus documented messages for openai (`429 Too Many Requests`, `insufficient_quota`), volc/zai/ollama/gemini (use the provider's documented quota/limit wording; where unknown, status-code rows 401/402/403/429/529 with no patterns). `classifyDispatch` checks `result.signal` (timeout-kill) first, then `statusCodes` against a status-code extractor (`/\b(4\d\d|5\d\d)\b/` near "status"/"http"), then ANDed row patterns. Keep the precision bias (0407 R1): `undefined` on any ambiguity — never classify noise as exhaustion. Consumers that already read the signal (escalation loop `agent-service.ts:769-818`, sideways failover `:998-1005`, attempted-set exclusion `:1083`) need no change — the fix is upstream. Anti-patterns: no classification logic in consumers; no new regex literals outside the registry; do not return `resource-exhaustion` for exit-code-only evidence without a message/status match.

**R2 — precheck gate.** `config/workflows/task-pipeline.yaml` precheck doctor step (0487 R2) fails on `authenticated: unauthenticated` for `$agent`/`$implementAgent`. For `omp-dsv4-flash-volc` the doctor's model probe reads `VOLC_API_KEY` from the CLI process env → "API key not found for provider 'volc'" (run `9f9444f9`); the wrap ran the same executor+model successfully (`ee7a7dfc`, invocation `omp -p --model volc/deepseek-v4-flash-ga-260731`). Implementation: in the precheck shell, after reading `AUTH`/`DETAIL` (doctor JSON `.agents[0].authenticated` / `.modelStatus.detail`), classify the detail via `classifyDoctorProbe`: `env-miss` → treat as `unknown` (skip the FAIL branch — the old soft behavior); `auth-fail`/other on a NON-omp/pi agent → keep the FAIL and append the remediation line `precheck: FAIL - executor <EXE> is unauthenticated; fix agent.default or pass --vars '{\"agent\":\"<authenticated-executor>\"}' (spur agent doctor <EXE> --json)`. Hard-fail logic for genuine non-omp auth failures is retained. Anti-patterns: do not remove the doctor probe entirely; do not treat `usable: true` alone as pass; do not bypass the size gate.

**R3 — transition retry.** Run `7686fbde`: implement succeeded (exit 0, `requireDiff` passed) then `task update wip --no-lifecycle` exited 1 with `ENOENT reading …/node_modules/@gobing-ai/ts-llm-jsonl-importer` at 22:31:11.010Z (symlink rewritten 22:31Z by a concurrent `bun link`; re-pointed seconds later) → terminal `failed` → ~40 min manual continuation. Implementation: a reusable shell snippet in the pipeline — `retry_transient() { "$@" || { sleep 2; "$@"; }; }` — applied to the implement→wip (`task update wip --no-lifecycle`), record (`task record`), and done (`task update done --no-lifecycle`) transition commands; on final failure, if the output matches `ENOENT|EBUSY|ENOTEMPTY`, append `node_modules link/dependency broken — run bun install and retry`. Only these three statuses retry (logic/guard failures must surface immediately). Anti-patterns: no retry on guard denials or non-transient errors; no infinite retry; no swallowing the original error on persistent failure.

**R4 — inline driver (ADR-047 amendment).** Current: workflow `agent.run` always subprocesses; omit/`inline` → `agent.default` (cross-cutting.md:103-109; ADR-047 "Host-stage control inversion remains deferred"). Implementation — the orchestrator, not the engine, inverts: `/sp-dev-run --mode full` (and dev-runall) run **in the host session** detect `--agent` omitted or `inline` and drive the pipeline in-session instead of launching `spur workflow run`:
1. Read `config/workflows/task-pipeline.yaml` as the **SSOT** — never define a second FSM. Walk states: precheck → implement → test → (test-fix/test-recheck) → review → verify → record → done, evaluating each state's onEnter actions in order and each outgoing transition guard (shell) in declaration order.
2. `kind: shell` / `note` / `file.read.into-var` actions execute exactly as today (same commands, same `.spur/run/<wbs>-*.status` files), via the host shell.
3. `kind: agent.run` actions execute the action's `input` slash command **in-session** — the backing competency runs inline (the same path `--mode implement` uses today); `answerFile` capture (verify) still writes the file; `requireDiff` still checked against the pre-dispatch snapshot; `timeoutMs` does not apply (host-session semantics — document in the run log).
4. Confirm actions pause only when `profile != auto` (unchanged).
5. Provenance: every inline stage appends the frozen provenance line to `.spur/run/<runId>.log`; a run-id is allocated for the inline drive (same run-scoped artifact layout).
6. Retained subprocess: `--agent <name>`, `--agent auto`, headless `spur workflow run`/`spur agent run` — unchanged.
Docs same-commit (T3): `docs/00_ADR.md` ADR-047 Detail (host-stage control inversion granted for the interactive case, with the provenance obligation); `plugins/sp/skills/spur-dev/references/cross-cutting.md` "Workflow-driven commands accept inline as agent.default" → "…executes stages in the host session when invoked interactively; subprocess otherwise"; `/Users/robin/.agents/skills/sp-dev-run/SKILL.md` flag table row; sp-spur-dev execution half Step 2.
Anti-patterns: no AiRunner/engine-level inline threading (false implementation — the engine cannot reach back into the host session); no duplicate FSM definition (read the YAML); no silent subprocess fallback when inline was requested interactively; no `--no-lifecycle` guard bypasses (the same `task check` / verdict gates still gate transitions).

**R5 — gate backoff.** `test`/`test-recheck` probe (`bun run format && bun run spur-check`) failed repeatedly with `SQLiteError: database is locked` while concurrent `spur history import` held spur.db (~25 min of retries across imports #1–#3); each failure flipped the soft status to FAIL → spurious `test-fix` hop. Implementation: in the probe shell, wrap the gate run in a bounded loop — `for i in $(seq 1 5); do ( sh -c "$qualityGateCmd" ) > "$LOG" 2>&1; rc=$?; grep -q "database is locked" "$LOG" || break; sleep 10; done` — then write the status from the final rc. Anti-patterns: retry only on the lock marker; never extend past the bound; the log must contain the original lock error when the bound is exhausted.

**Invariants (all R-items):**
- The two-sided baseline semantics and `task check`/`feature check` surfaces are untouched (no corpus-behavior change beyond 0502's own promotion).
- `spur workflow run` (headless) and `spur agent run` surfaces keep their exact resolution, output, timeout, and trace contracts (ADR-047; cross-cutting.md "Explicit subprocess surfaces are unchanged").
- No new first-layer CLI noun; no changes to `.spur/config.yaml` executor entries (operator-owned).
- Every transition still runs its lifecycle guards — inline execution changes the *surface*, never the *gates*.

**Out of scope:** the full-mode-inline driver for *headless* invocation (trigger 2/3 remain subprocess); changing the operator's default executor choice in `.spur/config.yaml`; worktree-isolation enforcement for parallel agents (operator process; R3 makes spur survive it).

**Risk:**

| Risk | Mitigation |
| --- | --- |
| Registry pattern misses a future provider message | Status-code rows catch 401/402/403/429/529 regardless of phrasing; adding a row is a one-line + test change (R1 AC) |
| Precheck soft gate lets a genuinely dead executor burn implement time | R1 escalation now catches real auth/quota failures mid-run; the doctor's explicit negative auth for non-omp agents still hard-fails |
| Inline driver diverges from the FSM | Driver reads task-pipeline.yaml as SSOT; R4 AC asserts the same guards gate every transition |
| R4 in-session stage loses timeout isolation and hangs the session | Interactive-only surface; operator is present; headless/explicit paths keep isolation (documented in ADR-047 Detail) |
| R3 retry masks a real regression as "transient" | Only ENOENT/EBUSY/ENOTEMPTY retry; persistent failures surface the original error |
### Plan
- [ ] T1 (R1) — Create `packages/app/src/services/failure-classification.ts`: `FailureRule` type, `FAILURE_RULES` table (claude/grok rows from the 0502 log literals; openai/volc/zai/ollama/gemini rows from documented messages or status-code-only rows), pure `classifyDispatch`, thin `classifyObjectiveFailure` delegation, barrel export. Acceptance: `packages/app/tests/services/failure-classification.test.ts` passes — claude "weekly limit · resets" → resource-exhaustion; grok "402 Payment Required … balance exhausted" → resource-exhaustion; "status 529" → resource-exhaustion; "warning: deprecated" → undefined; `bun test packages/app/tests/services/failure-classification.test.ts` green.
- [ ] T2 (R2) — Precheck doctor gate: add `classifyDoctorProbe` (env-miss vs auth-fail vs unknown) and rewire the `config/workflows/task-pipeline.yaml` precheck shell to degrade env-probe misses to soft and append the remediation line on real FAIL. Acceptance: fixture/smoke — omp executor with "API key not found for provider" detail passes precheck; a non-omp unauthenticated executor fails with the remediation hint; the 0502 scenario (blocked omp-dsv4-flash-volc) no longer reproduces.
- [ ] T3 (R3) — Transition retry: `retry_transient` snippet applied to implement→wip, record, and done transition commands in task-pipeline.yaml; ENOENT/EBUSY/ENOTEMPTY + `bun install` hint on persistent failure. Acceptance: smoke with an injected transient ENOENT retries once and proceeds; a persistent ENOENT surfaces the original error + hint; guard denials never retry.
- [ ] T4 (R4) — Inline driver: in-session pipeline driving in `/sp-dev-run --mode full` + dev-runall for interactive omit/inline; read task-pipeline.yaml as SSOT; inline agent.run execution + provenance line; ADR-047 Detail, cross-cutting.md, sp-dev-run SKILL.md, sp-spur-dev execution half updated same-commit. Acceptance: live smoke on a small fixture task — stages execute in-session (no `agent.run` subprocess), provenance lines present, guards still gate; `--agent auto`/`--agent <name>`/headless `spur workflow run` still dispatch subprocesses.
- [ ] T5 (R5) — Gate backoff: bounded lock-aware retry loop in the `test`/`test-recheck` probe. Acceptance: with a held spur.db, the probe retries and reports PASS once the lock clears; a never-clearing lock routes to test-fix/failed with the lock error named.
- [ ] T6 (R6) — Gates: `bun run lint && bun run test && bun run build && bun run spur-check-new` exit 0; no skipped tests; `git status` intentional only.
### Solution
Implemented all five post-mortem fixes without changing the headless workflow engine or operator-owned executor configuration.

| Requirement | Change map |
| --- | --- |
| R1 — deterministic provider classification | Added the typed seven-provider registry and pure classifier in `packages/app/src/services/failure-classification.ts:1-95`; imported it and reduced the existing adapter to delegation in `packages/app/src/services/agent-service.ts:43` and `packages/app/src/services/agent-service.ts:1499-1514`; exported the classifier from `packages/app/src/index.ts:82-83`. Added `auth` as an additive stage signal and bumped schema 1.1 → 1.2 in `packages/domain/src/stage-registry/schema.ts:41-373`. |
| R1 tests | Added literal-message, status-only, noise, success, and timeout cases in `packages/app/tests/services/failure-classification.test.ts:1-44`; updated the stage signal/version contract in `packages/domain/tests/stage-registry/schema.test.ts:82-544`. Existing escalation-loop tests also pass against the registry-backed adapter. |
| R2/R3/R5 — pipeline resilience | Hardened the doctor probe, transition retries, persistent ENOENT remediation, and five-attempt SQLite-lock backoff in `config/workflows/task-pipeline.yaml:134-522`. Added executable shell fixtures covering soft omp relay auth, hard non-omp auth, transient/persistent transition failures, lock-clear PASS, and bounded persistent-lock FAIL in `plugins/sp/tests/task-pipeline-resilience.test.ts:1-179`. |
| R4 — interactive host driver | Added the YAML-SSOT host-session interpreter and frozen provenance contract in `plugins/sp/skills/spur-dev/references/inline-pipeline-driver.md:1-87`. Routed interactive full single/sequential batch omit/inline through it while keeping named/auto/parallel/headless subprocess paths in `plugins/sp/commands/dev-run.md:17-46`, `plugins/sp/commands/dev-runall.md:20-81`, and `plugins/sp/skills/spur-dev/SKILL.md:83-113`. |
| R4 — orchestration consistency | Updated the shared selector and driver mechanics in `plugins/sp/skills/spur-dev/references/cross-cutting.md:93-188`, `plugins/sp/skills/spur-dev/references/dev-operations.md:140-145`, `plugins/sp/skills/spur-dev/references/execution-workflow.md:13-259`, and `plugins/sp/skills/spur-dev/references/execution-batch.md:23-230`. Extended mechanical contract coverage in `plugins/sp/tests/inline-execution-contract.test.ts:50-148`. |
| R4 — authority and derived docs | Appended the ADR-047 amendment in `docs/00_ADR.md:343-348`; recorded the runtime boundary in `docs/03_ARCHITECTURE.md:245-257`; updated the surface index/schema vocabulary in `docs/04_DESIGN.md:40-1308` and its detail satellite `docs/design/dev-agent-flag-and-dogfood-skill.md:22-34`; synchronized the entry contracts in `AGENTS.md:39-70` and `config/templates/AGENTS.md:39-71`. |

Targeted classifier/domain/workflow/contract tests and affected-package typechecks are green. Full repository gates remain owned by the pipeline test hop and were intentionally not duplicated inside this implement-only step.
### Testing
**Pipeline verify results**

- Verdict: PASS (from verdict artifact)

| Requirement | Status | Evidence |
|-------------|--------|----------|
| R1 | MET | Typed seven-provider registry and pure classifier: `packages/app/src/services/failure-classification.ts:5-96`; literal/status/noise cases: `packages/app/tests/services/failure-classification.test.ts:15-43`; canonical `auth` fallback: `packages/domain/src/stage-registry/schema.ts:360-372,779-807`; end-to-end dispatch escalation (`pi` → `claude`, `Escalating: … failed with auth`): `packages/app/tests/services/agent-service.test.ts:2138-2167`. |
| R2 | MET | Omp/pi env-probe misses degrade to soft while non-omp explicit auth remains actionable: `config/workflows/task-pipeline.yaml:134-186`; executable branches: `plugins/sp/tests/task-pipeline-resilience.test.ts:58-88`. |
| R3 | MET | Transition shell actions retry only ENOENT/EBUSY/ENOTEMPTY/SQLite-lock failures once and preserve the dependency path plus `bun install` hint: `config/workflows/task-pipeline.yaml:263-279,461-477,507-523`; transient/persistent fixtures: `plugins/sp/tests/task-pipeline-resilience.test.ts:90-132`. |
| R4 | MET | Interactive omit/inline routes through the YAML-backed host driver while explicit/headless routes remain subprocesses: `plugins/sp/commands/dev-run.md:31-47`, `plugins/sp/skills/spur-dev/references/inline-pipeline-driver.md:11-88`, `docs/00_ADR.md:343-347`. Executable smoke traverses the real task-pipeline graph, resolves Codex `session_id`, records inline stage provenance, reaches `done` on PASS, and blocks on verdict/task-check failures: `plugins/sp/tests/inline-pipeline-driver.test.ts:49-230`. |
| R5 | MET | Five-attempt lock-only backoff is present in test/recheck: `config/workflows/task-pipeline.yaml:305-341,379-407`; lock-clear and persistent-lock fixtures: `plugins/sp/tests/task-pipeline-resilience.test.ts:134-178`. |
| R6 | MET | Fresh host runs this session: `bun run lint` exit 0; `bun run test` exit 0 (4,837 pass, 0 fail; 99.29% aggregate lines/functions); `bun run build` exit 0; `bun run test-cf` exit 0 (1 pass); `bun run spur-check-new` exit 0 (4,837 pass, corpus-check OK, 2 baselined / 0 new errors). |

| Acceptance Criteria | Status | Evidence Type | Evidence |
|---------------------|--------|---------------|----------|
| Scenario: R1 — provider failures classify deterministically | MET | test | `packages/app/tests/services/failure-classification.test.ts:15-43` covers claude, grok, status 529, all registry providers, noise, success, and termination; `packages/app/tests/services/agent-service.test.ts:2138-2167` proves classified auth dispatch emits escalation and switches executors. Fresh full suite: 4,837 pass. |
| Scenario: R2 — relay-authenticated omp executors pass precheck | MET | test | `plugins/sp/tests/task-pipeline-resilience.test.ts:58-88` executes soft omp and hard non-omp paths, including the remediation hint. |
| Scenario: R3 — transient transition failures retry with a remediation hint | MET | test | `plugins/sp/tests/task-pipeline-resilience.test.ts:90-132` executes transient success and persistent failure with the broken path and `bun install` hint. |
| Scenario: R4 — interactive full mode runs stages in the host session | MET | test | `plugins/sp/tests/inline-pipeline-driver.test.ts:203-230` drives the real YAML graph with host-stage callbacks and real shell guards/artifacts; asserts inline session provenance, no `spur agent run`, PASS → done, non-PASS/task-check denial → failed. Explicit/headless subprocess contracts remain mechanically covered by `plugins/sp/tests/inline-execution-contract.test.ts:151-176`. |
| Scenario: R5 — gate probe survives DB lock | MET | test | `plugins/sp/tests/task-pipeline-resilience.test.ts:134-178` proves lock-clear PASS and bounded persistent-lock FAIL. |
| Scenario: R6 — gates green | MET | command | Fresh host runs this session: `bun run lint`, `bun run test`, `bun run build`, `bun run test-cf`, and `bun run spur-check-new` all exited 0. |
- Coverage: N/A (verdict-based; verify pipeline does not measure code coverage)
### Review
| Priority | Dimension | Location | Finding |
| --- | --- | --- | --- |
| P2 | Correctness / Architecture | `packages/app/src/services/agent-service.ts:771`; `packages/domain/src/stage-registry/schema.ts:779` | `classifyDispatch` can return `auth`, but no canonical stage declares an `auth` fallback. `AgentService` stops immediately when `matchingFallbacks` is empty, so real 401/403 failures cannot produce the promised `Escalating:` recovery after the omp doctor gate is softened. Add an `auth` fallback/availability policy and an end-to-end agent-service test proving a classified auth failure dispatches the next executor. |
| P2 | Correctness / Testability | `plugins/sp/tests/inline-execution-contract.test.ts:132`; `plugins/sp/skills/spur-dev/references/inline-pipeline-driver.md:42` | R4's only automated evidence asserts that documentation contains selected phrases. It never drives the YAML FSM, proves that `agent.run` stays in-session, writes a real run-link/provenance line, or demonstrates that a denied guard blocks transition. The task's required live smoke remains absent; add an executable host-driver smoke/dogfood artifact before certifying the control inversion. |
| P3 | Usability / Provenance | `plugins/sp/skills/spur-dev/references/inline-pipeline-driver.md:29` | The driver reads only `.session.json#session`; the active Codex session in this workspace exposes `session_id`, so the driver fabricates `host-session-<run-id>` and loses correlation to the real host session. Accept both canonical keys (or document a normalized accessor) before relying on the line as cross-agent audit provenance. |
| P3 | Verification | `bun run spur-check-new` | The exact R6 aggregate gate exited 1 in this sandbox: its second full-suite pass reported 24 unrelated failures from forbidden localhost listeners, `ps`, and a `$HOME` temp write. Standalone `bun run test` passed 4,833/4,833. Re-run `spur-check-new` on a normal host; do not certify R6 from this environment. |

| Req | Status | Evidence |
| --- | --- | --- |
| R1 | PARTIAL | `packages/app/src/services/failure-classification.ts:5-96` implements the typed seven-provider registry and pure classifier; `packages/app/tests/services/failure-classification.test.ts:15-43` covers literal/status/noise/timeout cases; full suite passed. Gap: `auth` has no fallback consumer, so the classified 401/403 path cannot escalate (`agent-service.ts:771-782`). |
| R2 | MET | `config/workflows/task-pipeline.yaml:141-185` classifies omp/pi env misses as soft and retains an actionable hard failure for non-omp; `plugins/sp/tests/task-pipeline-resilience.test.ts:58-88` exercises both branches. |
| R3 | MET | `config/workflows/task-pipeline.yaml:266-279,463-476,508-521` retries only named transient transition failures once and preserves output/remediation; `plugins/sp/tests/task-pipeline-resilience.test.ts:90-132` exercises transient and persistent ENOENT paths. |
| R4 | PARTIAL | `plugins/sp/commands/dev-run.md:31-47`, `plugins/sp/skills/spur-dev/references/inline-pipeline-driver.md:22-73`, and `docs/00_ADR.md:343-347` define the interactive inversion, YAML SSOT, guards, and provenance. Gap: `plugins/sp/tests/inline-execution-contract.test.ts:132-148` is string-only; no live/executable smoke proves the behavior or retained subprocess branches. |
| R5 | MET | `config/workflows/task-pipeline.yaml:314-341,381-406` implements five-attempt lock-only backoff; `plugins/sp/tests/task-pipeline-resilience.test.ts:134-178` proves lock-clear PASS and persistent-lock FAIL. |
| R6 | PARTIAL | Fresh commands: `bun run lint` exit 0; `bun run test` exit 0 (4,833 pass, 0 fail); `bun run build` exit 0; `bun run spur-check-new` exit 1 from 24 sandbox-only network/process/home-write failures. Targeted assertions also passed (11 classifier, 21 escalation, 15 pipeline, 78 domain), although partial-suite commands exit 1 under the repo-wide coverage threshold. |

| Check | Status | Evidence |
| --- | --- | --- |
| design-conformance | partial | Frozen registry/module/classifier names, YAML transition retry, ADR amendment, and inline-driver contract are present; actionable auth fallback and the required R4 live smoke are missing. |

**Architecture candidates**

**C1 — Wrong seam between failure classification and escalation policy**

- **Severity:** major
- **Signal:** wrong seam
- **Location:** `packages/app/src/services/agent-service.ts:771`; `packages/domain/src/stage-registry/schema.ts:779`
- **Symptom:** the classifier publishes `auth`, while every stage policy understands only the older triggers, so the new vocabulary terminates at the consumer boundary.
- **Evidence:** `bun -e` inspection of all registered stage fallbacks returned `[]` for trigger `auth`.
- **Deepening proposal:** make authentication unavailability a first-class fallback policy (including same-account exclusion semantics) or deliberately map it into the existing availability signal; pin the choice with an escalation test.
- **Affected files:** `packages/domain/src/stage-registry/schema.ts`, `packages/app/src/services/agent-service.ts`, corresponding tests.

**C2 — Poor executable test surface for the inline pipeline driver**

- **Severity:** major
- **Signal:** poor test surface
- **Location:** `plugins/sp/tests/inline-execution-contract.test.ts:132`
- **Symptom:** the new control plane can only be checked by searching Markdown strings, so action ordering, guard behavior, answer-file capture, and provenance can regress while tests stay green.
- **Evidence:** the test's assertions at lines 137-147 are all `toContain`; none invokes `/sp:dev-run`, interprets YAML, or inspects a run artifact.
- **Deepening proposal:** add a bounded fixture/dogfood execution with stubbed model stages and real shell/guard/run-link artifacts, retaining YAML as the sole FSM.
- **Affected files:** inline-driver test fixture/harness plus `plugins/sp/tests/inline-execution-contract.test.ts`.

Functional Verdict: PARTIAL
### References
- **Sessions analyzed (source: spur workflow run logs + agent.run subprocess captures, 2026-08-10):**
  - `9f9444f9-8067-4b18-942a-825525333f7c.log` — precheck doctor FAIL (omp-dsv4-flash-volc env-probe unauthenticated) → terminal failed, 2s
  - `c558d71c-81d3-4df7-a3a5-1fa5cf3abd3b.log` — claude weekly limit → implement exit 3, 6s
  - `415ad467-cced-49fe-b4e1-75183bc4bb3c.log` — grok 402 balance exhausted → implement exit 3, 5s
  - `7686fbde-e3df-4964-8fc6-aa6a13e98188.log` — codex implement ✓ 11m53s (226,595 tokens) → `task update wip` ENOENT at 22:31:11.010Z → terminal failed
  - review agent.run (codex) — ~6 min, 165,811 tokens, found P1 + 2 P3 (P1 dispositioned out of scope)
  - `ee7a7dfc-5358-4208-83c8-7ec9ed51a32d.log` — wrapup: done; doc-sync/metrics-record agent.run ran `omp-dsv4-flash-volc` (`volc/deepseek-v4-flash-ga-260731`) successfully — proves RC2
  - verify agent.run (codex) — cancelled by operator; completed inline
  - Operator's concurrent `spur history import --source opencode --mode full` ×3 (~18+13+5 min) — RC5 contention; the same feature's coding session caused the RC3 link churn (history-service.ts edit 22:25Z, ts-libs re-links 22:31Z, rebuild 22:47Z)
- **Contract sources:** `plugins/sp/skills/spur-dev/references/cross-cutting.md` ("Inline-default execution surface", "Executor exhaustion is survivable (0482 R1/R5)", "Workflow-driven commands accept inline as agent.default (ADR-047)"); `docs/00_ADR.md` ADR-046/047; `config/workflows/task-pipeline.yaml` precheck (0487 R2, lines 120-132).
- **Code anchors:** `packages/app/src/services/agent-service.ts:1522-1537` (classifier), `:779-808` (escalation loop), `:998-1005` (sideways failover), `config/workflows/task-pipeline.yaml` (precheck gate, implement→wip transition, test probe).
- **Commits:** `f88979bb` (execution-surface contract + inline default, 0480/0482/0483/0484), `a3a93661` (disable unauthenticated omp-zai), `a801891d` (default → omp-dsv4-flash-volc), `7ee8187b` (0502 itself).
- **Resolution:** 0502 completed PASS via manual continuation; no runtime bug in 0502's delivered surface. This task (0503) captures the five root causes and the operator's fundamental-fix direction.
### History
- 2026-08-11T00:04:26.651Z backlog → cancelled (system)
- 2026-08-11T01:14:26.805Z backlog → wip (system)
- 2026-08-11T02:22:57.803Z wip → testing (system)
- 2026-08-11T02:22:57.997Z testing → done (system)
### Notes

**RC1 — Ad-hoc regex classifier misses the real provider messages (S1).** `classifyObjectiveFailure`'s alternation does not match claude's "weekly limit · resets <date>" nor grok's "402 Payment Required … balance exhausted"; both runs died with `agent.run exited with code 3` and zero `Escalating:` lines, despite the 0482 R1/R5 survivability contract. The mechanism — one growing regex — cannot scale to every provider's error vocabulary; R1 replaces it with a deterministic registry. Evidence: `.spur/run/c558d71c-81d3-4df7-a3a5-1fa5cf3abd3b.log`, `.spur/run/415ad467-cced-49fe-b4e1-75183bc4bb3c.log`; `agent-service.ts:1522-1537`.

**RC2 — Precheck doctor gate false-negative on relay-authenticated omp executor (S1).** The 0487 R2 gate hard-fails on `authenticated: unauthenticated`, which for omp executors is an env-probe artifact (doctor reads `VOLC_API_KEY` from the CLI process, cannot see the omp relay's credential store). Run `9f9444f9` was blocked; run `ee7a7dfc` later executed `omp -p --model volc/deepseek-v4-flash-ga-260731` successfully. The gate contradicts cross-cutting.md's explicit doctor guidance and the 0482 survivability contract. Evidence: `.spur/run/9f9444f9*.log`, `.spur/run/ee7a7dfc*.log`.

**RC3 — Concurrent writer race orphaned a completed implement (S1).** Mechanism, with timestamps: run `7686fbde` implement completed at 22:31:10.9Z; the transition `task update wip` failed at 22:31:11.010Z with `ENOENT reading packages/app/node_modules/@gobing-ai/ts-llm-jsonl-importer`; the symlink's mtime shows it was rewritten at 22:31 UTC (15:31 PDT) — a `bun link`/install operation by the concurrent opencode-history-import coding session that was actively editing `history-service.ts` (22:25Z) and re-linking ts-libs packages. The link flapped through three targets that evening (global `.bun/install` path → ts-libs dev checkout → workspace `.bun` store) and was dangling for seconds — exactly the window the transition step hit. The CLI eagerly imports the app package → history-service → ts-llm-jsonl-importer, so ANY spur CLI call was at risk during the window, and the pipeline has no retry. The concurrent session violated the one-writer rule (AGENTS.md, task 0487 R5); worktree isolation is the standard remedy. Verdict on whether to fix: **yes, on the spur side** (R3: retry-once + remediation hint — a race that clears in seconds must not be fatal), and the coordination side is operator process, not code. Evidence: `.spur/run/7686fbde*.log:18`; `ls -la packages/app/node_modules/@gobing-ai/` mtimes; the three readlink targets captured 22:33–22:47Z.

**RC4 — Full-mode `inline` resolves to `agent.default` with no host-session path (S1).** The operator's retry `/sp-dev-run 0502 --auto --next --agent inline` ran the same slow path because ADR-047 maps `inline` to a subprocess of `agent.default` for workflow-driven commands. The remembered "inline default" fix (f88979bb) never covered pipeline stages. R4 amends ADR-047 fundamentally instead of warning. Evidence: invocation log; cross-cutting.md:103-109; ADR-047.

**RC5 — Gate probe fails on DB lock contention (S2).** `spur-check`'s rule-gate repeatedly failed with `SQLiteError: database is locked` while the operator's concurrent `spur history import` held spur.db; ~6 manual gate re-runs and ~25 min of waiting across imports #1–#3. The probe treats the collision as a hard gate FAIL (routes to test-fix) rather than a transient retry. Evidence: `.spur/run/0502-spur-check-new.log`; lsof snapshots of spur.db holders.

**What worked well (preserve):** the precheck dirty-tree warning and size gate fired correctly; the doctor precheck caught genuinely missing env keys in earlier sessions; run-log retention (`.spur/run/<runId>.log`) made this post-mortem possible; the `--json` verdict derivation produced an honest PASS with per-requirement evidence; the runbook-referenced recovery paths kept the manual continuation deterministic.

