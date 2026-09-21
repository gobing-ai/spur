---
schema_version: 1
name: Complete DecisionMaker workflow policy, routing, diagnostics and operator guidance
status: done
template: standard
created_at: 2026-09-21T00:19:59.329Z
updated_at: "2026-09-21T07:18:07.896Z"
feature_id: D

priority: P1
estimate_hours: "24"
ac_altitude: task-local
ac_numbering: task-local
dependencies: ["0910"]
---

## 0911. Complete DecisionMaker workflow policy, routing, diagnostics and operator guidance

### Background

Task 0910 delivered the optional DecisionMaker responder. This follow-up turns its application policy into an explicit, observable workflow capability while preserving installed workflows and operator-owned approvals. The operator requested one implementation-ready task covering the remaining routing, CLI diagnostics, skills/slash-command guidance, workflow YAML, evidence, and test work identified in the 2026-09-20 discussion. This task is the single delivery unit; do not silently split or defer required rows during implementation.

**Current facts verified on 2026-09-20:**

- `packages/config/src/index.ts` declares optional `workflow.hitlDecisionMaker`; `packages/config/src/loader.ts` merges project over global. Credentials do not activate it.
- `packages/app/src/workflow/decision-hitl-responder.ts` lazily composes confirm/select answers, accepts confidence and selected probability >= 0.9, and delegates input, missing evidence, uncertainty and errors. It uses a generic latest-20 completed outcome projection and emits only a generic provider warning.
- `packages/app/src/services/workflow-service.ts` injects this responder at `registerSpurBuiltins`; existing HITL runners retain their action events and variables. There is no per-gate policy in the inspected implementation.
- `config/workflows/task-pipeline.yaml` skips approval for profile=auto. Its standard approve state declares pause=true; the upstream engine pauses after onEnter actions even when the model answered yes.
- `apps/cli/src/commands/workflow.ts` requires explicit --answer for headless continue; --yes only acknowledges resuming. Do not weaken this boundary.
- `plugins/sp/skills/spur-dev/references/inline-pipeline-driver.md` directly handles approvals with the operator. It does not invoke the application responder.
- Installed `@gobing-ai/ts-ai-runner` is 0.5.1 and exposes DecisionMaker; the old 0.5.0 deployment prerequisite is closed. No new upstream work is assumed.
- Existing focused checks passed: 133 app tests (responder and workflow service) plus 79 config loader tests. They use fake providers, and the decision service fixture has no pause=true. This is baseline evidence, not proof of this unimplemented task.

**Scope and altitude:** Feature D owns workflow behavior. These task-local AC exercise integration and compatibility rather than redefining feature D's ship criteria; use ac_altitude=task-local with requirement coverage enabled. Existing configuration activation is documented now in `docs/help/how_to_enable_jev_in_spur.md`; this task updates that guide as new behavior actually ships.

**Refine corrections (2026-09-20):** A confident answer does not remove a declared pause; profile=auto does not invoke an approval responder; inline execution is a separate surface; a missing key invokes the existing fallback rather than disabling the feature; fallback is not necessarily a human or a denial. The design below explicitly accounts for each fact. Planning estimate: 24 engineering hours for policy/evidence, routing, trace/status, docs and regression coverage; no live backend access required for deterministic acceptance.

**Implementation-ready checklist (2026-09-20):**

| ID | Result | Evidence |
| --- | --- | --- |
| requirements | PASS | R1-R10 define observable outcomes; D8 and Q&A close non-goals and inline scope |
| design | PASS | D1-D8 freeze option names, precedence, routing vars, provenance/status shapes, safety boundaries and file owners |
| plan | PASS | Ten ordered implementation steps map to R-items and actual test layers |
| ac | PASS | AC1-AC10 bind every R-item; task-local altitude explicitly justified; task check as todo returned no findings |
| decisions | PASS | Q&A closes activation, pause, approvals, failures, inline parity, upstream and live-call decisions |
| dependencies | PASS | 0910 is done and recorded in dependencies; installed ai-runner 0.5.1 provides the required facade |
| premises | PASS | Source and caller search confirms the facts; baseline tests passed; no wip tasks reported in the active corpus; separate worktree sp/run-0909-688b exists and must remain untouched |

Concurrency snapshot: current tree was clean before this documentation/task preparation. `git worktree list` also reports `/Users/robin/xprojects/spur-new-dev-run-0909-688b`; its existence is not evidence of active work. The implementer must re-check writer ownership at execution time. Source refinement also caught that ArtifactDao's existing run projection omits IDs and ActionRunDao ordering has timestamp ties; D4/D8 now specify safe handling instead of relying on nonexistent fields or invented chronological order. Readiness PASS certifies the specification only; implementation verification remains pending.

### Requirements

- [x] R1. Preserve the single merged boolean activation switch and existing legacy behavior for unmodified workflows, including no evidence/provider work when disabled, current key/endpoint environment behavior, fixed 0.9 thresholds, 15-second timeout and zero retries; do not add enablement flags, environment variables, model settings or provider SDK dependencies.
- [x] R2. Extend the existing confirm/select action options with the explicit per-action decision modes specified in Design: omitted retains legacy policy, never bypasses DecisionMaker, and evidence produces either an accepted choice or explicit defer. Validate new options before side effects and preserve the single existing action registration and original event/answer/cancellation contract for legacy and never modes.
- [x] R3. Make evidence-mode disabled, unavailable, uncertain, malformed and missing/stale-evidence outcomes route to defer without consuming the headless default responder; preserve original responder fallback only for legacy mode and explicitly operator-owned gates.
- [x] R4. Add gate-scoped, bounded, redacted evidence selection with explicit producing nodes and an optional registered structured summary artifact; enforce current-run ownership, artifact freshness/path constraints, stable evidence IDs and a reproducible input digest as defined in Design.
- [x] R5. Classify and explicitly protect every bundled operator-approval gate with never mode; preserve stock auto-profile bypass, pause=true and explicit resume semantics. Ship one safe bundled evidence-routing example showing accepted choice, explicit human defer and a bounded retry, without replacing deterministic quality/verification checks.
- [x] R6. Persist safe decision provenance with each HITL action result and expose it additively through existing workflow show/trace/progress JSON and human output, including accepted/deferred/fallback/disabled outcomes, reason, provider, confidence, selected probability, evidence identifiers/digest and elapsed time; historical rows remain readable.
- [x] R7. Add offline DecisionMaker readiness information to existing self status output using merged config and process-environment presence only; report disabled, missing-key or configured-not-probed without contacting the API, exposing credentials or changing existing status exit semantics.
- [x] R8. Update inline-driver, workflow authoring, execution and slash-command guidance plus parity tests to make unsupported inline provider execution explicit; legacy/never remains operator-driven, evidence mode takes its declared defer branch inline without a provider call, and no skill duplicates application decision policy.
- [x] R9. Synchronize the owning CLI/workflow design satellites, help and environment-variable references, in-scope plugin guidance, workflow inventory and generated bundle/schema surfaces. Distinguish new behavior from historical task 0910 behavior and document the no-hot-reload, no-live-probe and probability-calibration limitations.
- [x] R10. Add deterministic unit, engine integration, CLI, routing and plugin-contract regressions for all AC, including stock pause/headless behavior, config precedence, legacy compatibility, safe telemetry and evidence rejection; complete the applicable repository gates and a real task verify PASS before marking implementation done.

### Acceptance Criteria

```gherkin
Scenario: AC1 — Activation and legacy compatibility (req: R1)
  Given global and project configs cover absent, true and false overrides and legacy workflow options are unchanged
  When engine actions execute with the effective switch disabled or enabled
  Then disabled actions do not read evidence or construct a provider and enabled legacy actions retain the original fallback
  And credentials alone never enable the feature and existing request limits stay unchanged

Scenario: AC2 — Explicit gate policy is validated (req: R2)
  Given confirm and select actions declare never or evidence modes
  When workflow validation and runtime validation inspect their options
  Then never uses the original responder without a model and malformed modes, variables, producers or pausing evidence states fail before side effects
  And old action event, cancellation and answer-variable behavior remains compatible

Scenario: AC3 — Evidence failures never become implicit approval (req: R3)
  Given an evidence-mode action and SPUR_HITL_AUTO_APPROVE is enabled
  When the provider is disabled, missing, failing, uncertain, malformed or explicitly defers
  Then the answer variable is cleared and the status variable is deferred without calling the default responder
  And accepted valid choices set accepted status and the exact declared answer

Scenario: AC4 — Evidence is scoped and reproducible (req: R4)
  Given completed producers and a registered current-run summary artifact
  When evidence is assembled for the named nodes
  Then only bounded redacted allow-listed evidence is sent with stable action identifiers and an input digest
  And a stale attempt, in-flight replacement, mismatched summary, foreign run, oversized input or unsafe path defers before a provider call

Scenario: AC5 — Workflow routing preserves operator and deterministic gates (req: R5)
  Given the bundled routing example and stock task, idea, wrapup and wayfinder approval states
  When accepted, deferred, rejected, cancelled and retry-limit branches execute
  Then the example follows explicit bounded routes and defer reaches an operator pause
  And stock approvals never call the model, profile auto retains its task bypass, and verify PASS remains mandatory

Scenario: AC6 — Decision provenance survives trace and resume (req: R6)
  Given accepted, deferred, fallback and disabled decisions and historical rows without decision metadata
  When existing show, trace and progress output reads persisted results before and after resume
  Then safe additive provenance identifies outcomes and reasons and old JSON fields remain compatible
  And secrets, raw evidence and provider exception text are absent and historical attribution is unavailable

Scenario: AC7 — Offline readiness explains configuration (req: R7)
  Given disabled, enabled-without-key and enabled-with-key merged configurations
  When self status runs in human, JSON and envelope modes
  Then it reports disabled, missing-key or configured-not-probed with credential presence only
  And it makes no provider or network call and preserves existing exit semantics

Scenario: AC8 — Inline behavior is explicit and safe (req: R8)
  Given the inline driver executes a declared evidence decision followed by an operator defer state
  When DecisionMaker is enabled in project configuration
  Then the inline driver records unsupported-inline, clears the answer, selects deferred and follows the operator route without a provider call
  And legacy and never approvals retain inline operator handling and slash-command references describe the same boundary

Scenario: AC9 — Operator guidance matches shipped surfaces (req: R9)
  Given the completed options, result metadata and readiness implementation
  When owning docs, help, plugin references and bundled workflow inventories are checked
  Then their examples validate and defaults, precedence, local overrides, fallback and execution-path limitations match source
  And generated adapters and bundled files are produced by their owning tools

Scenario: AC10 — Integration and delivery gates establish completion (req: R10)
  Given regression fixtures cover each requirement without a live backend
  When focused tests, lint, typecheck, applicable workflow and plugin checks and task verification run
  Then all required checks pass and the task records a real verify PASS with requirement and scenario evidence
  And a stock pause-state regression proves that even a legacy model answer does not skip pause or explicit headless resume answers
```

### Q&A

- Q: Is activation inferred from an API key? A: No. The existing boolean remains the explicit opt-in; project overrides global. No new activation surface is authorized or needed.
- Q: Should a model answer automatically clear pause=true? A: No. Use a separate non-pausing evidence node and an explicit defer edge to the existing operator state. Engine pause/resume semantics remain unchanged.
- Q: Should all stock approvals become model judgments? A: No. Mark operator approval/taste/consent gates never. Unmodified third-party YAML retains task 0910 legacy behavior for compatibility.
- Q: What happens if the provider is unavailable in evidence mode? A: Defer; never reuse SPUR_HITL_AUTO_APPROVE or first-option fallback to manufacture an accepted decision.
- Q: Is full inline Jev parity included? A: No provider bridge is added. The earlier proposal made full parity conditional; this task delivers explicit support detection, safe defer routing and tested documentation. Future full parity is owned by the Spur application/inline execution maintainers and is triggered only by an explicit operator request for provider calls from inline runs. It must reuse the same application policy, not call TypeSafe from skills or bundle application imports into standalone plugin scripts.
- Q: Are new public CLI nouns/verbs or upstream engine work required? A: No. Extend existing HITL options, existing status output and existing trace projections. If an implementation discovers an unavoidable upstream contract change, stop at that named seam and report it; do not improvise engine internals in Spur or claim completion.
- Q: Can evidence routing replace verify PASS, repair loops or deterministic checks? A: No. It chooses among explicitly declared recovery routes; checks and retry bounds remain authoritative.
- Q: Does this authorize deployment or real service calls during implementation? A: No. Use injected fake DecisionMaker drivers and local fixtures. A live smoke test, if separately authorized, is supplementary and must not persist its key or sensitive payload.

### Design

#### D1. Ownership, alternatives and delivery boundary

Keep provider construction/validation in released ts-ai-runner; execution, state transitions and persistence correctness stay in ts-dual-workflow-engine. Keep evidence selection, decision acceptance and fallback in packages/app. CLI commands only project the application result. Dependencies: task 0910 (done) provides the responder and upstream release consumption; do not reopen or replace it.

Alternatives considered: (a) auto-resume every model-answered approval would violate declared pause and operator consent; reject. (b) add a new decision CLI noun/action family would duplicate the existing action seam and enlarge the public surface; reject. (c) add explicit options to existing confirm/select, return a distinct defer outcome and express routing in YAML; selected. No new public noun/verb, generic decision service framework, engine fork, backend registry, DB table or migration is needed.

This task extends ADR-123's application policy and retains ADR-122's explicit resume boundary. Before implementation, update ADR-123 with a concise dated clarification only if needed to express the new explicit mode distinction; do not misstate the historical default. Put exact options and result shapes in docs/design/cli-contracts.md and trace fields in docs/design/workflow-observability.md. No constitution or PRD scope rewrite.

#### D2. Frozen action surface and precedence

Add an optional `decision` object only to existing `hitl.confirm` and `hitl.select` action options:

```yaml
kind: hitl.select
options:
  prompt: Choose the next safe recovery step using the recorded failure summary.
  options: [retry, stop]
  var: recoveryChoice
  decision:
    mode: evidence
    statusVar: recoveryDecisionStatus
    evidenceNodes: [classify-failure]
    summaryArtifact: .spur/run/${vars.__runId}-recovery-summary.json
```

- `decision` omitted: exact task 0910 legacy semantics, including fallback policy. Do not require new variables or evidence declarations in old workflows.
- `decision: {mode: never}`: original injected responder only; no evidence lookup/provider construction. Used for bundled operator gates. Existing headless defaults remain explicit operator configuration; never means no model, not a guarantee of interactive stdin.
- `mode: evidence`: valid only for confirm/select; requires `statusVar` and non-empty `evidenceNodes`. `summaryArtifact` is optional. `statusVar` and the answer `var` must differ. Use the existing default answer var when omitted. Select options must be distinct non-empty strings (at least two), and cannot use the reserved synthetic defer label. Confirm supplies yes/no choices.
- Reject malformed/unknown decision keys/modes, invalid variable identifiers, duplicate/unknown producer nodes and evidence mode on input during application workflow validation and defensively at action execution. Do not change the upstream generic options schema or reinterpret invalid input as legacy. Variable identifiers use `[A-Za-z_][A-Za-z0-9_]*`.
- Effective disabled setting: legacy/never keeps the old responder; evidence returns defer without evidence reads/provider construction. Effective enabled + evidence: apply D3/D4, with no call to fallback on failure.
- Reject evidence-mode actions located in pause=true states: authors must split decision evaluation from the operator pause. Require at most one evidence-mode action per state/node so its route variables cannot be overwritten by a sibling decision. Validate declared producer node existence; runtime requires a completed producer in this run.
- Config is a per-invocation snapshot. Preserve explicit --answer and --yes meanings. No hot reload or credential-presence activation.

Extend the current action constructors/builtins dependency injection minimally with an application-owned decision evaluator and original responder. Reuse the same evaluator from the legacy responder wrapper; do not copy the acceptance algorithm into runners or skills. Keep upstream HitlRequest/HitlAnswer intact. Preserve one registered runner per hitl kind. Enumerate all registerSpurBuiltins and runner constructor callers before changing optional injected dependencies; direct tests and other hosts retain legacy defaults.

#### D3. Outcomes, variables and routing contract

For evidence mode, application evaluation returns a discriminated accepted/deferred result. Store additive `data.decision` (D5) alongside existing data.answer. Both valid accepted and deferred evaluations are successful action execution (`ok: true`); provider failure is a routing outcome, not an engine crash. Invalid action configuration is `ok: false` before any provider call.

- Accepted: answer var gets the exact original choice (yes/no for confirm); statusVar gets `accepted`.
- Deferred: answer var is explicitly cleared to the empty string, statusVar gets `deferred`. This prevents a previous iteration's answer from steering the next transition. Do not encode defer as no, cancel, first choice or approval. Do not call the legacy responder here.
- YAML guards check status first, then choice. A final unconditional transition goes to an explicit operator gate; unknown states never silently proceed.
- The operator gate uses never mode and pause=true. Resume consumes the existing explicit operator answer. For the example use hitl.confirm so existing `continue --answer yes|no|cancel` works; do not add headless select-resume flags.
- No changes to unconditional engine pause, resume re-entry ownership or explicit CLI answer requirements. Historical legacy custom workflows still pause if they declare pause=true even after a model answer.

#### D4. Evidence and transport

Keep the existing legacy latest-20 projection unchanged. Evidence mode filters completed non-HITL rows to the explicitly named producing nodes of the current run, then chooses the latest completed attempt per named node using persisted timestamps and IDs. ActionRunDao currently orders only by created_at; use stable ID ordering for serialization, and defer on ambiguous latest attempts sharing a timestamp rather than treating random ID order as chronology. A missing producer, an in-flight newer attempt for a selected producer, malformed result or evidence from another run yields deferred with a bounded reason code. Never infer task success from command exit alone when the decision needs review content.

Project only the existing allow-listed node/kind/ok/error/stdout/stderr/summary fields. Apply configured secret redaction and credential-pattern redaction to evidence, prompt and option descriptions before transport. Bound projected output text to 2,000 characters per row and no more than 20 rows as in 0910; bound the complete serialized request evidence to 32 KiB UTF-8 without splitting characters. If truncation would discard a required producer/summary, defer instead of deciding on an incomplete input. Do not transmit environment, arbitrary vars, command argv, raw files or provider errors.

Optional summaryArtifact is one JSON file already registered to the current run by the existing run.artifact action/ArtifactDao. Resolve beneath the run's workdir/.spur/run using canonical real paths; reject absolute, traversal, symlink escape, unregistered or other-run paths. Read at most 8 KiB; oversized, missing, malformed, mismatched or stale summaries defer. Use this exact producer envelope:

```json
{"schemaVersion":1,"runId":"run-id","producerNode":"classify-failure","producerActionId":"action-id","summary":"bounded relevant outcome"}
```

Validate the envelope before projection; producerNode must be in evidenceNodes and producerActionId must identify the latest completed action selected for that node. Only `summary` becomes model evidence; envelope IDs become provenance. The producing action must emit the same summary in its recorded output so a different or stale file cannot supply unrelated evidence; compare the redacted bounded summary to that recorded field. A stock workflow lacking such a producer does not gain unrestricted file reads: use node outputs or defer. No new proof authority or replacement for existing proof fingerprints is introduced.

Compute a SHA-256 digest of the canonical redacted evidence actually sent (stable sorted keys and deterministic producer order). Record producer action IDs and the registered artifact ID/digest when used; no absolute path, raw evidence or credentials in decision telemetry. Same unchanged evidence yields the same digest; a new producer attempt or different supplied evidence changes it.

Keep lazy upstream createDecisionMaker with 15,000 ms timeout, maxRetries=0 and existing acceptance validation (>=0.9 confidence and selected probability, valid exact label/probability keys, finite bounded values and lower rivals). Accept only original declared choices through synthetic labels, plus explicit defer. Provider errors become allow-listed reason codes; never persist exception messages or request bodies. No claim that confidence is a calibrated correctness guarantee.

#### D5. Provenance and existing projections

Persist `data.decision` on the existing action result with this stable additive shape:

```typescript
interface DecisionProvenance {
    schemaVersion: 1;
    mode: 'legacy' | 'never' | 'evidence';
    outcome: 'accepted' | 'deferred' | 'fallback' | 'disabled';
    reason: string; // closed allow-list below
    provider: string | null;
    confidence: number | null;
    selectedProbability: number | null;
    evidenceActionIds: string[];
    evidenceDigest: string | null;
    artifactId: string | null;
    durationMs: number;
}
```

Reason vocabulary: accepted, disabled, policy-never, unsupported-input, missing-key, provider-unavailable, uncertain, explicit-defer, invalid-answer, missing-evidence, stale-evidence, invalid-evidence, oversized-evidence, unsupported-inline. Use generic provider-unavailable for transport/auth/rate errors unless a safe existing upstream typed code can be mapped without recording text. No raw label/prompt in provenance; the existing answer field remains the answer authority. Duration is nonnegative elapsed evaluation time, not model token cost. Numeric confidence/probability is null unless validated; provider is null when never constructed. Never invent a model/version/usage value absent from upstream answers.

For enabled legacy fallback store outcome=fallback plus the reason. For disabled legacy store disabled. For never store fallback/policy-never. Evidence failure always records deferred. Free-text can carry fallback/unsupported-input without a model call. Old rows lacking data.decision render as unavailable, not inferred human/model attribution. Malformed historical metadata must not break trace.

Use existing persisted action result and existing observability/projection plumbing; do not create a decision database or duplicate raw logs. Project additive metadata through WorkflowAppService trace/progress and CLI show/trace/progress. Human output should show source/outcome/reason and confidence when present; JSON preserves all old fields. If a status stream does not contain individual actions, show only an honest available aggregate, never fabricate a per-action result.

#### D6. Offline readiness

Add an application-owned pure readiness helper consumed by existing `spur self status`. Frozen additive JSON field:

```json
{"decisionMaker":{"enabled":false,"provider":"typesafe","credentialPresent":false,"state":"disabled","connectivity":"not-probed","inlineSupport":"defer-only"}}
```

States: disabled when effective boolean is false; missing-key when enabled without a non-empty TYPESAFE_API_KEY; configured-not-probed when enabled with a key. `credentialPresent` is presence only; never output its value or endpoint userinfo/query. Read config through the existing merged loader/context and key presence from the invoking environment. Do not read project .env files explicitly, construct the provider, contact the network, import all of ai-runner for diagnosis or change self status exit code because optional readiness is missing. This reports configuration, not API validity/export health. Include one corresponding human-readable line.

#### D7. YAML rollout and inline boundary

Inspect every bundled `hitl.*` occurrence in config/workflows, including task-pipeline, idea-pipeline, wrapup-pipeline and wayfinder-resolution. Mark actual operator approval/consent/taste gates `decision: {mode: never}`. Preserve their prompts, rejection feedback artifacts, cancellation routes and pause declarations. Deterministic gates stay deterministic. Do not rewrite project-local .spur/workflows automatically; document that local copies override bundled definitions and need an intentional merge to adopt new policies.

Add `config/workflows/decision-routing-example.yaml` as a safe, locally runnable state-machine example: a shell producer emits a fixed recovery summary; a non-pausing hitl.select evidence node chooses retry/stop; accepted retry is bounded to one attempt; stop reaches a named terminal; deferred goes to a never-mode pause=true hitl.confirm whose yes/no/cancel branches are explicit. It must not publish, commit, mutate task status or require a real provider. Test provider behavior via injected drivers and service fixtures. Optional registered artifact evidence is tested in a fixture and documented without forcing every example to create artifacts. Add the example to the appropriate existing workflow inventory, not the default task-pipeline path. Add comments making auto-profile task bypass and operator gate semantics explicit.

Inline default continues to execute legacy/never gates through its existing operator interaction. For evidence-mode nodes, the inline contract writes empty answer + deferred status with reason unsupported-inline and follows the declared defer edge; it does not call the provider or pretend that config=true provided parity. Use the existing inline trace/checkpoint mechanism to record this reason where action metadata is supported, otherwise record it in the existing inline run log without claiming engine metadata parity. Update the inline action inventory/parity test and relevant execution/authoring references. Thin slash commands link to that owner instead of duplicating algorithms. Full inline provider invocation is explicitly outside this task, with the trigger/owner in Q&A.

#### D8. File map, compatibility and non-goals

Primary existing targets: packages/app/src/workflow/decision-hitl-responder.ts; packages/app/src/workflow/actions/hitl-confirm.ts, hitl-select.ts, hitl-input.ts; packages/app/src/workflow/builtins.ts; packages/app/src/services/workflow-service.ts; apps/cli/src/commands/workflow.ts and status.ts; apps/cli/src/context.ts only if injection needs it. Add small application evidence/readiness modules only where they keep policy out of transports. Reuse ActionRunDao, ArtifactDao, result storage and observability projections. ArtifactDao.artifactsByRunId currently projects only path/kind: add a narrowly scoped domain query for id/path/kind constrained by run ID when reading decision evidence, rather than assuming the current projection exposes an ID. Preserve existing projection consumers and keep SQL in packages/domain. Discover schema generation owners before editing generated output; config schema remains the existing boolean.

Documentation/plugin targets: docs/design/cli-contracts.md, workflow-observability.md and e2e-workflow-for-system-development.md where its inventory changes; docs/help/how_to_enable_jev_in_spur.md, cmd_workflow.md, cmd_status.md and environment_variables.md; plugins/sp/skills/spur-cli/references/workflows.md and self.md, spur-dev/references/inline-pipeline-driver.md, cross-cutting.md, glossary.md and execution-workflow.md; affected thin commands only for a real contradictory statement. Use Superskill for generated adapters, never hand-edit installed skills. Bundle generation owns apps/cli/config. Keep plugin standalone imports compliant.

Non-goals: new CLI nouns/verbs, new activation env vars, changing profile=auto, implicit approval, removing pause, changing continue --answer, replacing verification, generic LLM routing, provider/model settings, configurable thresholds/retries, live-health polling, token billing, historical attribution backfill, global rollout, UI redesign, upstream engine edits, arbitrary artifact ingestion, full inline provider parity, committing credentials or editing .github/workflows. Existing custom YAML stays compatible; the deliberate bundled approval-policy tightening is documented and tested. Implementation commits per this task from a clean tree; coordinate any concurrent writer before touching shared files.

### Plan

1. [ ] Re-read task 0910 through CLI and the D1/D8 sources; confirm clean worktree, installed 0.5.1 exports and every builtins/HITL constructor caller. Record any changed premise before editing; do not silently change frozen modes or deferred scope. (R1-R10)
2. [ ] Amend the owning design contract first for explicit modes/outcomes/metadata and offline status. Preserve ADR-123 history and ADR-122 resume authority; update only owners whose facts change. (R2-R9)
3. [ ] Add failing focused regressions for disabled identity, never mode, evidence accepted/deferred, stale-answer clearing, validation and headless auto-approve isolation. Refactor the existing responder into a shared application evaluator plus legacy fallback composition; wire existing runners once. (R1-R3)
4. [ ] Implement producer-node selection, bounded optional registered summary validation, redaction and deterministic digest; exercise fake drivers that capture exactly what would be sent. (R4)
5. [ ] Add persisted decision metadata to existing action results and safe projections to existing workflow outputs; cover malformed historical rows and no-secret logging. (R6)
6. [ ] Add the offline readiness helper and self status human/JSON projection, with merged precedence and zero-network tests. (R7)
7. [ ] Inventory bundled operator gates, add never mode, and add the safe recovery example with accepted/deferred/retry/stop/cancel branches. Test actual engine pause and existing CLI explicit resume behavior, not just responder mocks. (R5, R10)
8. [ ] Update inline defer semantics, action inventory/parity checks, thin-command pointers, workflow authoring guidance and the enablement guide; document local workflow overrides and the explicit full-inline-parity non-goal. (R8-R9)
9. [ ] Run focused tests inside their workspace; validate all changed YAML through the source-local workflow CLI; regenerate relevant schemas/bundles using repository owners. After CLI changes run bun link in apps/cli and the documented build:bundle command. (R9-R10)
10. [ ] Run bun run spur-check, applicable feature-scoped gate once, bun run test-cf, bun run build and bun run plugin-smoke when plugin surfaces changed. Review diff, deterministic-gate preservation and git status. Use task verify to produce real per-R/per-AC PASS evidence, then record and transition through the CLI; do not equate spec readiness with implementation completion. (R10)

### Solution

Change-map (auto-generated — implement step did not record a Solution).
Each entry cites the first changed line per file (`file:line`).

| Change (`file:line`) |
|----------------------|
| `apps/cli/src/commands/status.ts:104` |
| `apps/cli/src/commands/status.ts:3` |
| `apps/cli/src/commands/status.ts:42` |
| `apps/cli/src/commands/status.ts:53` |
| `apps/cli/src/commands/status.ts:66` |
| `apps/cli/src/commands/workflow.ts:1795` |
| `apps/cli/tests/commands/status.test.ts:45` |
| `apps/cli/tests/commands/workflow.test.ts:14` |
| `apps/cli/tests/commands/workflow.test.ts:2304` |
| `packages/app/src/index.ts:667` |
| `packages/app/src/index.ts:743` |
| `packages/app/src/services/workflow-service.ts:1634` |
| `packages/app/src/services/workflow-service.ts:1753` |
| `packages/app/src/services/workflow-service.ts:1812` |
| `packages/app/src/services/workflow-service.ts:2008` |
| `packages/app/src/services/workflow-service.ts:2711` |
| `packages/app/src/services/workflow-service.ts:2714` |
| `packages/app/src/services/workflow-service.ts:2719` |
| `packages/app/src/services/workflow-service.ts:2727` |
| `packages/app/src/services/workflow-service.ts:2778` |
| `packages/app/src/services/workflow-service.ts:2783` |
| `packages/app/src/services/workflow-service.ts:498` |
| `packages/app/src/services/workflow-service.ts:50` |
| `packages/app/src/services/workflow-service.ts:511` |
| `packages/app/src/services/workflow-service.ts:52` |
| `packages/app/src/services/workflow-service.ts:61` |
| `packages/app/src/services/workflow-service.ts:684` |
| `packages/app/src/services/workflow-service.ts:9` |
| `packages/app/src/workflow/actions/hitl-confirm.ts:12` |
| `packages/app/src/workflow/actions/hitl-confirm.ts:17` |
| `packages/app/src/workflow/actions/hitl-confirm.ts:2` |
| `packages/app/src/workflow/actions/hitl-confirm.ts:29` |
| `packages/app/src/workflow/actions/hitl-confirm.ts:41` |
| `packages/app/src/workflow/actions/hitl-confirm.ts:55` |
| `packages/app/src/workflow/actions/hitl-confirm.ts:62` |
| `packages/app/src/workflow/actions/hitl-input.ts:12` |
| `packages/app/src/workflow/actions/hitl-input.ts:2` |
| `packages/app/src/workflow/actions/hitl-input.ts:32` |
| `packages/app/src/workflow/actions/hitl-select.ts:11` |
| `packages/app/src/workflow/actions/hitl-select.ts:13` |
| `packages/app/src/workflow/actions/hitl-select.ts:19` |
| `packages/app/src/workflow/actions/hitl-select.ts:2` |
| `packages/app/src/workflow/actions/hitl-select.ts:36` |
| `packages/app/src/workflow/actions/hitl-select.ts:54` |
| `packages/app/src/workflow/actions/hitl-select.ts:72` |
| `packages/app/src/workflow/actions/hitl-select.ts:79` |
| `packages/app/src/workflow/actions/hitl-select.ts:88` |
| `packages/app/src/workflow/builtins.ts:26` |
| `packages/app/src/workflow/builtins.ts:52` |
| `packages/app/src/workflow/builtins.ts:91` |
| `packages/app/src/workflow/decision-hitl-responder.ts:14` |
| `packages/app/src/workflow/decision-hitl-responder.ts:201` |
| `packages/app/src/workflow/decision-hitl-responder.ts:228` |
| `packages/app/src/workflow/decision-hitl-responder.ts:3` |
| `packages/app/src/workflow/decision-hitl-responder.ts:5` |
| `packages/app/src/workflow/decision-hitl-responder.ts:514` |
| `packages/app/src/workflow/decision-hitl-responder.ts:516` |
| `packages/app/src/workflow/decision-hitl-responder.ts:532` |
| `packages/app/src/workflow/decision-hitl-responder.ts:60` |
| `packages/app/src/workflow/decision-hitl-responder.ts:62` |
| `packages/app/src/workflow/decision-hitl-responder.ts:64` |
| `packages/app/src/workflow/decision-hitl-responder.ts:68` |
| `packages/app/tests/services/workflow-service.test.ts:104` |
| `packages/app/tests/services/workflow-service.test.ts:125` |
| `packages/app/tests/services/workflow-service.test.ts:137` |
| `packages/app/tests/services/workflow-service.test.ts:264` |
| `packages/app/tests/services/workflow-service.test.ts:9` |
| `packages/domain/src/dao/artifact-dao.ts:41` |
| `packages/domain/tests/dao/artifact-dao.test.ts:26` |
| `plugins/sp/scripts/inline-pipeline-parity-check.ts:47` |
| `plugins/sp/tests/inline-pipeline-parity-check.test.ts:18` |
| `plugins/sp/tests/inline-pipeline-parity-check.test.ts:23` |
| `repo-wide-tests/adr-supersession.test.ts:164` |
| `repo-wide-tests/adr-supersession.test.ts:202` |

### Testing

**Pipeline verify results**

- Verdict: PASS (from verdict artifact)

| Requirement | Status | Evidence |
|-------------|--------|----------|
| R1 | MET | Legacy and disabled paths unchanged (`decision-hitl-responder.ts:255-356`); `packages/app/tests/services/workflow-service.test.ts` "DecisionMaker switch composes with real builtins…" asserts 0 provider calls when the switch is off and the original `legacy` responder answer when on; no new env var, model setting or provider dependency (`git diff` shows none) |
| R2 | MET | `parseDecisionConfig` rejects unknown keys, non-object decisions, `hitl.input` use, malformed identifiers and duplicate producers before any side effect (`decision-hitl-responder.ts:126-206`); the validator reads and normalizes the same choice key as the runner and its fixtures cover a wrong key plus empty choices (`workflow-service.ts:2068-2080`; `decision-evidence.test.ts` "validates the same choice key and normalization the runtime runner reads") |
| R3 | MET | Only `legacy`/`never` delegate to the responder (`decision-hitl-responder.ts:101-124`); every evidence failure returns `deferred` with a cleared answer var, never the headless default responder (`:380,:388,:419,:432,:462,:466`), covered by the defer matrix in `decision-evidence.test.ts` |
| R4 | MET | Bounds 20 rows / 2000 chars / 32 KiB payload / 8 KiB summary and allow-listed redacted fields (`decision-evidence.ts:6-9,159-177`), in-flight → `stale-evidence` (`:74`), timestamp tie → `invalid-evidence` (`:104-109`), run-id envelope match (`:137`), canonical-path plus registered-artifact ownership (`workflow-service.ts:1802-1820`) |
| R5 | MET | All 7 stock gates declare `mode: never` (`idea-pipeline.yaml:148,287,365,425`; `task-pipeline.yaml:467`; `wrapup-pipeline.yaml:311`; `wayfinder-resolution.yaml:166`); `decision-routing-example.yaml` implements D2 and is executed end to end by the three `decision policy (0911)` integration tests; `profile=auto` bypass untouched (`task-pipeline.yaml:744`) |
| R6 | MET | Provenance persisted with each HITL action result and projected by `workflow trace` — JSON `decision` object (`TimelineActionDecision`) plus the human `decision=` line — asserted in `workflow-service.test.ts` (trace projection) and `apps/cli/tests/commands/workflow.test.ts` (renderer), with work without provenance omitted |
| R7 | MET | `computeDecisionReadiness` reports `disabled` / `missing-key` / `configured-not-probed` from merged config plus env presence only, constructing no provider and making no network call (`decision-readiness.ts:16`, `apps/cli/src/commands/status.ts:42-53`); `apps/cli/tests/commands/status.test.ts` covers all three states in JSON, human and `--json --json-envelope` and asserts the key value is never echoed |
| R8 | MET | Inline defer semantics, no-hot-reload and the full-inline-parity non-goal documented in `plugins/sp/skills/spur-dev/references/inline-pipeline-driver.md`; parity checker agrees three ways (`bun plugins/sp/scripts/inline-pipeline-parity-check.ts` → 10 actions, 4 guards, 0 spurious edges) and no skill restates application decision policy |
| R9 | MET | ADR-123 dated clarification (historical text preserved), `docs/design/cli-contracts.md`, `docs/design/workflow-observability.md`, `docs/help/{cmd_workflow,cmd_status,environment_variables,how_to_enable_jev_in_spur}.md`, `plugins/sp/skills/spur-cli/references/{self,workflows}.md`, `spur-dev/references/glossary.md`, both bundled-workflow inventories; bundle regenerated after CLI changes (4.89 MB, 34 `$schema` directives, example copied byte-identical) |
| R10 | MET | Regressions: `decision-evidence.test.ts` (26), `decision-readiness.test.ts` (2), `artifact-dao.test.ts` (2), 3 engine-integration tests, 2 trace-renderer tests, 1 status CLI test, updated plugin parity test; gates all green — `bun run spur-check` PASS (8655 tests, 0 fail), `bun run spur-check-feature` PASS, `bun run test-cf` PASS, `bun run build` PASS, `bun run plugin-smoke` PASS, 5/5 changed YAMLs `valid: true` |

| Acceptance Criteria | Status | Evidence Type | Evidence |
|---------------------|--------|---------------|----------|
| AC-1 | MET | test | `workflow-service.test.ts` decision switch composition (disabled ⇒ 0 provider calls; enabled ⇒ provider answer; `legacy` responder preserved) |
| AC-2 | MET | test | Parser reject matrix plus validator key-parity fixtures (`decision-evidence.test.ts`), and `workflow validate` on every changed YAML reports 0 errors/0 warnings |
| AC-3 | MET | test | Evidence-mode defer assertions: cleared answer var, `statusVar` = `deferred`, no responder invocation (`decision-evidence.test.ts`; service-level defer path in the example test) |
| AC-4 | MET | test | Rejection matrix (missing, in-flight/stale, timestamp tie, foreign run, oversized, unsafe path, mismatched summary) plus the run-scoped `artifactsWithIdByRunId` query test |
| AC-5 | MET | test | The shipped example runs end to end: evidence defers to the never-mode `pause=true` gate and resumes to `published`; an accepted answer runs exactly one bounded retry then escalates; stock gates ship `never` |
| AC-6 | MET | test | Persisted provenance read before/after resume via `action_runs.result_json`, projected on `workflow trace` JSON and human output; historical rows without the field render unchanged; no raw evidence or exception text in the object |
| AC-7 | MET | test | `status.test.ts` readiness matrix across JSON/human/`--json --json-envelope`, exit code 0 preserved and credential value never printed |
| AC-8 | MET | test | Executable: `plugins/sp/tests/inline-pipeline-parity-check.test.ts` (runs the checker over all 10 workflows and both reference sets, so the inline driver's action/guard inventory cannot drift) and the `decision policy (0911)` integration test on the same action path (evidence defers with a cleared answer and follows the declared operator route, no provider call). Guidance text: `plugins/sp/skills/spur-dev/references/inline-pipeline-driver.md`; bundled gates ship `never` |
| AC-9 | MET | command | `bun run apps/cli/src/index.ts workflow validate <file> --json` on all 5 changed workflows → `valid: true`; doc/help/plugin/reference claims cross-checked against source; bundle regenerated by its owning script |
| AC-10 | MET | test | `bun run spur-check` PASS (8655 tests, 0 fail), `spur-check-feature` PASS, `test-cf` PASS, `build` PASS, `plugin-smoke` PASS; stock pause regression proves a legacy model answer does not skip `pause` (run stays `paused`, explicit resume completes) |
- Coverage: N/A (verdict-based; verify pipeline does not measure code coverage)

### Review

#### Review Report — 0911 (pass 2, post-remediation)

**Scope:** WBS 0911 diff after the verify→test-fix remediation hop (41 changed/untracked paths)
**Dimensions:** functional, security, efficiency, correctness, usability, architecture
**Verdict:** PASS

##### Findings (ranked)

| # | Priority | Dimension | Finding | Location |
|---|----------|-----------|---------|----------|
| 1 | P4 (advisory) | architecture | The classification inventory (`workflow-shell-ownership.md`) is not extended for the new example. Deliberate: it records the 2026-08-20 shell-program census and already excludes post-inventory workflows (`history-anatomy.yaml`); the bundled-workflow inventory rows live in `plugins/sp/README.md` and `docs/help/cmd_workflow.md`, both updated | `docs/design/workflow-shell-ownership.md:46-52` |
| 2 | P4 (advisory) | usability | `docs/design/e2e-workflow-for-system-development.md` keeps its command→workflow table unchanged: the example has no slash entry, so no row's owner changed | `docs/design/e2e-workflow-for-system-development.md:177-188` |
| 3 | P4 (advisory) | correctness | Inline evidence handling is a documented host contract, not executable code in this repo (`sp:spur-dev` inline driver), so AC8 is proven by the guidance + parity checker rather than a runnable inline test | `plugins/sp/skills/spur-dev/references/inline-pipeline-driver.md` |

No P1–P3 findings remain. Pass 1 raised six findings; all are closed:

| Pass-1 finding | Disposition |
| --- | --- |
| #1 R6 provenance never projected (show/trace/progress) | Fixed — `TimelineActionDecision` projection on `workflow trace` (JSON + human `decision=`), asserted at service and renderer level |
| #2 No engine/CLI regression for decision flows | Fixed — three integration tests execute the shipped example (defer → pause → resume, accepted bounded retry, legacy answer vs pause) plus a CLI readiness test |
| #3 Example missing from workflow inventories | Fixed — rows added to `plugins/sp/README.md` and `docs/help/cmd_workflow.md` |
| #4 No CLI regression for status readiness | Fixed — `status.test.ts` asserts disabled / missing-key / configured-not-probed in JSON, human and `--json --json-envelope`, and that the key value is never echoed |
| #5 Outcome vocabulary drift (`delegated`) | Fixed — the observability section now states the real closed vocabulary and the real surface |
| #6 `workflow.hitl.ask` emitted for evidence mode | Accepted — the event is the legacy operator-prompt signal; evidence mode still asks nothing and the run confirms it (deferral path asserted) |

Two further defects were found and fixed while remediating (both would have shipped broken):

- **P1** the bundled example declared `choices:` while `hitl.select` reads `options.options`, and the
  validator read `choices` too — so the example validated clean and failed at run time, and a real
  mis-declared choice list escaped validation. The walker now reads and normalizes exactly the
  runtime key (asserted by a wrong-key fixture).
- **P1** the example did not implement D2 (it used an `agent.run` producer, no bounded retry, no
  stop terminal, no cancel branch). Rewritten to D2: shell producer, `[retry, stop]`, one bounded
  retry, explicit `yes`/`no`/`cancel` branches on `$__hitlAnswer`, no artifact required.

##### Functional Traceability

| Req | Status | Evidence |
|-----|--------|----------|
| R1 | MET | Legacy/disabled composition unchanged; `workflow-service.test.ts` asserts 0 provider calls when disabled and the original responder answer when enabled |
| R2 | MET | `parseDecisionConfig` rejects unknown keys/modes/vars/duplicate producers before side effects; wrong-key and empty-choice validation fixtures in `decision-evidence.test.ts` |
| R3 | MET | Evidence outcomes return `deferred` with a cleared answer and never consume the headless responder; defer matrix in `decision-evidence.test.ts` |
| R4 | MET | Bounds (20/2000/32 KiB/8 KiB), allow-listed redacted fields, in-flight → `stale-evidence`, run-id envelope match, canonical-path + registered-artifact ownership |
| R5 | MET | All 7 stock gates `mode: never`; the example now matches D2 and is executed end to end by `workflow-service.test.ts`; `profile=auto` bypass untouched |
| R6 | MET | Provenance persisted with the action result and projected into `workflow trace` JSON + human output, with renderer and service assertions |
| R7 | MET | `computeDecisionReadiness` + `status.ts` wiring; CLI test covers all three states across JSON, human and envelope with no key leakage |
| R8 | MET | Inline defer semantics + full-inline-parity non-goal documented; parity checker agrees across 10 workflows and both reference sets |
| R9 | MET | ADR-123 dated clarification, design satellites, help pages, plugin references, both workflow inventories, regenerated bundle (4.89 MB, 34 `$schema` directives) and 5/5 changed YAMLs `valid: true` |
| R10 | MET | 30 new/updated regressions (unit + engine + CLI + plugin contract); `spur-check` PASS (8655 tests, 0 fail), `spur-check-feature` PASS, `test-cf` PASS, `build` PASS, `plugin-smoke` PASS |

##### Security / Efficiency notes

- Evidence payloads stay bounded, allow-listed and secret-redacted; provenance carries no raw evidence or provider exception text (provider failures collapse to `provider-unavailable`).
- Summary resolution fails closed on unsafe paths, unregistered artifacts, run mismatch and read errors — an unresolvable artifact defers rather than accepts.
- No new noun/verb, dependency, table or migration; one evaluator per engine host, one wiring point.

**Next:** verify PASS → record → done.

### References

- Predecessor: task 0910, resolved with `spur task show 0910 --json`; dependency recorded in frontmatter.
- Operator request, 2026-09-20: create the enablement help page and one detailed implementation-ready task for the findings and proposals from the preceding discussion.
- Current-use guide: `docs/help/how_to_enable_jev_in_spur.md`.
- Ownership: `docs/00_ADR.md` ADR-123 and ADR-122; `docs/99_PROJECT_CONSTITUTION.md` sections 5/T3/T11 and 6.5.
- Config: `packages/config/src/index.ts` WorkflowConfigSchema; `packages/config/src/loader.ts` loadSpurConfig and mergeSpurConfigLayers.
- Application: `packages/app/src/workflow/decision-hitl-responder.ts`, `packages/app/src/workflow/builtins.ts`, `packages/app/src/services/workflow-service.ts`.
- Existing response behavior: `packages/app/src/workflow/actions/hitl-confirm.ts`, `hitl-select.ts`, `hitl-input.ts`; `apps/cli/src/workflow/hitl/default-responder.ts`; `apps/cli/src/context.ts`.
- Existing CLI seams: `apps/cli/src/commands/workflow.ts` registerWorkflowCommand; `apps/cli/src/commands/status.ts` runStatusCore.
- Evidence owners: `packages/domain/src/dao/action-run-dao.ts`; `packages/app/src/workflow/actions/run-artifact.ts`; existing ArtifactDao.
- Upstream inspected installed source: `node_modules/@gobing-ai/ts-ai-runner/src/decision/decision-maker.ts` and typesafe-driver.ts; `node_modules/@gobing-ai/ts-dual-workflow-engine/src/state-machine.ts`. Do not modify node_modules as an implementation strategy.
- Inline owner: `plugins/sp/skills/spur-dev/references/inline-pipeline-driver.md`; `plugins/sp/scripts/inline-pipeline-parity-check.ts`.

### History

- 2026-09-21T00:26:43.908Z backlog → todo (system)
- 2026-09-21T07:17:38.120Z todo → wip (system)
- 2026-09-21T07:17:41.889Z wip → testing (system)
- 2026-09-21T07:18:07.896Z testing → done (system)

