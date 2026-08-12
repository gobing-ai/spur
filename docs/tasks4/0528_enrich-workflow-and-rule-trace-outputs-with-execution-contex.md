---
template: feature-impl
schema_version: 1
name: "Enrich workflow and rule trace outputs with execution context and next actions"
description: ""
status: done
type: task
profile: standard
feature_id: J5
parent_wbs: null
priority: P1
tags: ["observability", "workflow", "rule", "cli"]
dependencies: ["0526"]
ac_numbering: task-local
created_at: "2026-08-12T13:24:51.438Z"
updated_at: "2026-08-12T16:52:00.717Z"
---

## 0528. Enrich workflow and rule trace outputs with execution context and next actions

### Background

Implements: R7 — Workflow trace exposes persisted execution context and failure action; R8 — Rule trace exposes source, evaluator context, and failure action; R10 — Malformed or unknown event data fails safe. The DAOs already return action timestamps/results and rule source/evaluator data, but the public trace projections and formatters discard most of it. Enrich the existing commands in place; do not add verbs or flags. Runs after the envelope foundation so project-context vocabulary is shared.

Rubric: E1 D1 L2 C1 R1 = 6 → decompose (independent CLI/DTO review across workflow and rule stores).

### Requirements
- [x] R1. Extend workflow trace projections additively with project context, run duration, full transition endpoints, action id/node/status/timestamps, safe allow-listed result/invocation metadata, outcome/error/cost, artifacts, and an exact existing follow or recovery next action; use the same fields in list/detail/follow human output and preserve existing JSON keys.
- [x] R2. Enrich rule trace with project, source kind/value, timing, dry-run/fix policy, applied fixes, and per-evaluation severity/evaluator/timestamps/findings/fixes/error; provide a safe existing command or source reference only when reconstructable and preserve existing JSON keys.
- [x] R3. Degrade missing/malformed stored metadata to explicit unavailable values with no raw output or fabricated action; add service/formatter/command/JSON-compatibility tests for running, success, failure, artifacts, unavailable cost, rule failure, and malformed metadata; update the exact CLI/DTO design surface.
### Acceptance Criteria
```gherkin
Feature: Actionable persisted trace output

Scenario: R1 — Workflow trace exposes persisted execution context and failure action
  Given a persisted workflow run with phases, transitions, actions, results, and optional artifacts
  When workflow trace renders human or JSON output
  Then project, timing, transition, action, safe invocation, outcome, error, cost, and deterministic next-action context are available without removing existing JSON fields

Scenario: R2 — Rule trace exposes source, evaluator context, and failure action
  Given a persisted rule run and evaluation rows
  When rule trace renders human or JSON output
  Then project, source, timing, policy, severity, evaluator, findings, fixes, error, and safe next-action context are available

Scenario: R3 — Malformed or unknown event data fails safe
  Given missing or malformed persisted optional metadata
  When either trace command renders
  Then the command succeeds with explicit unavailable values and no fabricated action
```
### Q&A

<!-- CLOSED decisions from refinement: what was chosen and why, what was deferred and on what
     condition. Not a parking lot for open questions — an unanswered question here means the task
     is not ready to hand off. Keep empty if none. -->

### Design
Approach: widen existing `WorkflowTraceEntry`/`TimelineEvent` projections and rule trace result projection from columns the DAOs already select. Parse `result_json` through a small allow-listed projector; never print arbitrary stdout/stderr. Human formatters use the same normalized fields returned in JSON and append `Next:` only when an existing command/path is exact.

Rejected: reading System Events to reconstruct traces (workflow/rule stores are the durable authorities); a new generic trace framework (only two concrete commands, three similar lines beat an abstraction); new detail flags (the requested context is the useful default).

Invariants: existing JSON keys retain name/type/meaning; additions are optional; no raw output or secrets; workflow status, not final-state naming, determines terminality; exact command suggestions only; malformed stored JSON degrades to unavailable rather than failing trace.
### Plan
1. Extend workflow DAO/service projections and safe result parsing.
2. Enrich workflow list/detail/follow formatters and deterministic next-action selection.
3. Extend rule trace service projection from existing run/eval columns.
4. Enrich rule list/detail formatters and safe next-action selection.
5. Add service/formatter/command and JSON-compatibility tests.
6. Update workflow/rule trace design docs and run targeted gates.
### Solution
- `packages/app/src/services/workflow-service.ts:279` widens the existing workflow trace entry/timeline DTOs with canonical project context, run duration/outcome/action, transition timestamps, and action identity/timing/result/invocation/error/artifact fields.
- `packages/app/src/services/workflow-service.ts:1301` normalizes missing timestamps and statuses; `:1403` parses `result_json` through exact scalar allow-lists, redacts configured secrets, omits argv/stdout/stderr, and creates only validated follow/continue/path actions.
- `apps/cli/src/commands/workflow.ts:777` uses the same normalized fields in list, detail, and follow human output while retaining every existing JSON key.
- `packages/app/src/services/rule-service.ts:113` adds project/source/timing/policy/outcome/action DTOs without changing DAO storage; `:980` sanitizes metadata and finding/fix JSON, excluding finding messages and replacement bodies.
- `apps/cli/src/commands/rule.ts:257` renders source, timing, dry-run/fix policy, applied fixes, evaluator/severity/error, and exact safe next actions in list/detail output.
- Service and CLI tests at `packages/app/tests/services/workflow-service.test.ts:793`, `packages/app/tests/services/rule-service.test.ts:1014`, `apps/cli/tests/commands/workflow.test.ts:1025`, and `apps/cli/tests/commands/rule.test.ts:302` cover success/failure/running-style projections, artifacts, unavailable cost/metadata, malformed JSON, redaction, human output, and additive JSON compatibility.
- `docs/04_DESIGN.md` and `docs/design/actionable-observability-context.md` define the shipped trace DTO and formatter surface. No new verb, flag, dependency, or upstream ts-libs change was needed.
### Testing
**Re-verify (2026-08-12, `--force --focus all --fix all`)**

| Check | Result |
| --- | --- |
| Targeted trace tests | PASS — 236 pass / 0 fail / 656 assertions (`bun test packages/app/tests/services/workflow-service.test.ts packages/app/tests/services/rule-service.test.ts apps/cli/tests/commands/workflow.test.ts apps/cli/tests/commands/rule.test.ts`) |
| `spur task check 0528 --strict-core` | PASS after corpus repair (Review table, checked R-boxes, full-path anchors) |

**Per-Requirement Traceability**

| Req | Status | Evidence |
| --- | --- | --- |
| R1 | MET | `packages/app/src/services/workflow-service.ts:279` DTO; `packages/app/src/services/workflow-service.ts:1301` `rowToTraceEntry` (project/durationMs/outcome); `packages/app/src/services/workflow-service.ts:1389` `traceNextAction` (follow/continue/log only); `packages/app/src/services/workflow-service.ts:1403` `projectActionTraceResult` allow-list + redaction. Human list/detail/follow: `apps/cli/src/commands/workflow.ts:777`, `apps/cli/src/commands/workflow.ts:798`, `apps/cli/src/commands/workflow.ts:830`, `apps/cli/src/commands/workflow.ts:874`. Tests: `packages/app/tests/services/workflow-service.test.ts:793`; `apps/cli/tests/commands/workflow.test.ts:1025`. |
| R2 | MET | `packages/app/src/services/rule-service.ts:113` DTOs; `packages/app/src/services/rule-service.ts:980` `projectRuleTraceRun`; `packages/app/src/services/rule-service.ts:1004` eval sanitizer; `packages/app/src/services/rule-service.ts:1029` `ruleTraceNextAction`. Human: `apps/cli/src/commands/rule.ts:257`, `apps/cli/src/commands/rule.ts:295`. Tests: `packages/app/tests/services/rule-service.test.ts:1014`; `apps/cli/tests/commands/rule.test.ts:301`. |
| R3 | MET | Malformed `result_json`/`metadata_json` → unavailable/`{}` and no fabricated action (`packages/app/src/services/workflow-service.ts:1413`, `packages/app/src/services/rule-service.ts:1039`). Cost n/a never $0.00 (`apps/cli/tests/commands/workflow.test.ts:1695`). Formatters emit `unavailable` (`apps/cli/src/commands/workflow.ts:786`, `apps/cli/src/commands/rule.ts:274`). Design surface: `docs/04_DESIGN.md:295`, `docs/04_DESIGN.md:348`; `docs/design/actionable-observability-context.md:88`. |

**Acceptance Criteria Verification**

| AC | Status | Evidence Type | Evidence |
| --- | --- | --- | --- |
| Scenario: R7 — Workflow trace exposes persisted execution context and failure action | MET | test | `packages/app/tests/services/workflow-service.test.ts:793`; `apps/cli/tests/commands/workflow.test.ts:1025` |
| Scenario: R8 — Rule trace exposes source, evaluator context, and failure action | MET | test | `packages/app/tests/services/rule-service.test.ts:1014`; `apps/cli/tests/commands/rule.test.ts:301` |
| Scenario: R10 — Malformed or unknown event data fails safe | MET | test | `packages/app/tests/services/workflow-service.test.ts:840`; `packages/app/tests/services/rule-service.test.ts:1023` |

**Design conformance**

| Claim | Status | Evidence |
| --- | --- | --- |
| Widen existing projections; allow-listed result_json | DONE | `packages/app/src/services/workflow-service.ts:279`, `packages/app/src/services/workflow-service.ts:1403` |
| Next: only when exact existing command/path | DONE | `packages/app/src/services/workflow-service.ts:1389`; `packages/app/src/services/rule-service.ts:1029` |
| Preserve existing JSON keys | DONE | CLI JSON tests retain `runId`/`workflowName`/`id`/`preset` |
| Malformed stored JSON degrades | DONE | catch → null/`{}`; command still succeeds |
| No new verbs/flags/framework | DONE | existing `workflow trace` / `rule trace` only |

**SECUA**

| Priority | Dimension | Location | Finding |
| --- | --- | --- | --- |
| P1–P3 | All | — | None |
| P4 | Correctness | `packages/app/src/services/rule-service.ts:980` | Raw DAO keys remain in JSON beside sanitized `source` (preserve-existing-keys). |
| P4 | Usability | `apps/cli/src/commands/workflow.ts:831` | Null phase timestamp can render empty in human output. |

Fix-pass artifacts this run: `.spur/run/0528-verdict.json`, `.spur/run/0528-verify-answer.txt` (AC ids aligned to feature R7/R8/R10).
### Review
| Priority | Dimension | Location | Finding |
| --- | --- | --- | --- |
| P1 | All | — | None. |
| P2 | All | — | None. |
| P3 | All | — | None. |
| P4 | Correctness | `packages/app/src/services/rule-service.ts:980` | `projectRuleTraceRun` spreads the raw DAO row so JSON keeps stored `source_value`/`preset` beside the sanitized `source` field. Required by preserve-existing-keys; sanitized field drives human output. |
| P4 | Usability | `apps/cli/src/commands/workflow.ts:831` | Phase timeline events pass persisted timestamps; human formatter can render an empty string for a null phase timestamp instead of `unavailable`. Cosmetic; JSON remains explicit. |
- Security: `result_json` and rule metadata/findings/fixes go through allow-lists; argv/stdout/stderr, finding messages, and replacement bodies are omitted; configured secrets are redacted.
- Architecture: existing DTOs widened in place; no new trace framework, verbs, or flags.
- Disposition: PASS.
### References

J5

<!-- Links to the parent feature, design docs, related tasks, or external references. -->

### History
- 2026-08-12T14:55:10.168Z todo → wip (system)
- 2026-08-12T16:17:17.193Z wip → todo (system)
- 2026-08-12T16:20:58.574Z todo → wip (system)
- 2026-08-12T16:47:07.262Z wip → testing (system)
- 2026-08-12T16:47:17.705Z testing → done (system)
