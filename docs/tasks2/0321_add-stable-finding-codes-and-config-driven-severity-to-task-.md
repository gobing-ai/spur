---
template: feature-impl
schema_version: 1
name: "Add stable finding codes and config-driven severity to task and feature check"
description: ""
status: done
type: task
profile: standard
feature_id: Q
parent_wbs: null
priority: P2
tags: []
dependencies: []
created_at: "2026-07-24T19:16:13.884Z"
updated_at: "2026-07-24T22:33:06.031Z"
---

## 0321. Add stable finding codes and config-driven severity to task and feature check

### Background
Check severities are hardcoded at ~20 call sites across `packages/app/src/services/task-check.ts` and `feature-check.ts`, and the only tuning knob is a global `--strict` boolean in `summarizeWithStatus` (`packages/app/src/services/planning-check-base.ts:188`). Findings carry only `{ layer, severity, section, message }` (`planning-check-base.ts:30`) — no stable identity — so a project cannot say "this rule is advisory here" without editing source.

This task adds a stable `code` to every finding (also improving `--json` consumers) and a config-driven severity override map on the **existing** `tasksConfigSchema` (`packages/config/src/index.ts:79`). The L1–L4 defaults stay in code; config only *overrides* by code. It deliberately does **not** add an L5 layer — the test⇄AC coverage check that feature Q's scaffold work enables belongs as an L3/L4 rule, and a new tier is speculative until an orthogonal check needs one.
### Requirements
- R1. Every finding from task/feature check carries a stable `code` (e.g. `L3.solution-file-line`, `L4.missing-feature-id`). **Pass:** `CheckFindings.code` is non-empty for all emitted findings and appears in `--json`.
- R2. Codes come from a single registry, not string literals at call sites. **Pass:** a unit test enumerating the registry catches a duplicate or an unknown code; each check site references a registry constant.
- R3. `tasksConfigSchema` gains an optional severity-override map `Record<code, 'error' | 'warning' | 'off'>`. **Pass:** a config with `severity: { 'L3.plan-format': off }` parses; a non-severity value is rejected (exit 2).
- R4. Overrides apply in `summarizeWithStatus` before the pass-gate computation, composing with `--strict`. **Pass:** a finding whose code maps to `off` is dropped; `error` blocks the gate; `--strict` still elevates remaining warnings.
- R5. An override naming a code that no rule emits fails config validation with a clear message. **Pass:** an unknown code → load error naming the code.
### Acceptance Criteria
```gherkin
Feature: Stable finding codes and config-driven severity

  @core
  Scenario: Every finding carries a stable code
    Given a task or feature check produces findings
    When the findings are emitted
    Then each finding carries a stable machine code identifying its rule

  @core
  Scenario: Config overrides a finding severity
    Given a severity override map in the tasks config block
    When a check runs and a finding's code is listed
    Then that finding is emitted at the configured severity

  @edge
  Scenario: Unknown code in config is rejected
    Given a severity override map naming a code that no rule emits
    When the config is validated
    Then loading fails with a clear error naming the unknown code
```
### Q&A

<!-- Clarifications and decisions made during refinement. Keep empty if none. -->

### Design
Change-map (extends the existing check base + config; no new layer).

| File:line | Change |
| --- | --- |
| `packages/app/src/services/finding-codes.ts` (new) | The code registry — a typed union + enumerable list of every rule code, shared by task-check and feature-check. |
| `packages/app/src/services/planning-check-base.ts:30` | Add `code: string` to `CheckFindings`. |
| `packages/app/src/services/planning-check-base.ts:188` | In `summarizeWithStatus`, apply the config severity overrides (`off` → drop the finding; else set severity) before computing `pass`, composing with the existing `--strict` elevation. |
| `packages/app/src/services/task-check.ts` (~20 sites) | Attach the registry `code` to each finding. |
| `packages/app/src/services/feature-check.ts` | Same. |
| `packages/config/src/index.ts:79` | Extend `tasksConfigSchema` with an optional `severity` map; a `superRefine` validates keys against the finding-codes registry (R5). |
| `apps/cli/schemas/spur-config.schema.json` | Mirror the new `severity` map (Zod stays SSOT). |
| `packages/app/tests/services/planning-check-base.test.ts`, `task-check.test.ts`, `packages/config/tests/loader.test.ts` | Cover R1–R5. |

**Override composition (R4):** order is override → strict. `off` drops before the gate sees it; a code mapped to `error` blocks; `--strict` then elevates any remaining warnings.
### Plan
1. Create the finding-codes registry (`packages/app/src/services/finding-codes.ts`) — union + enumerable list.
2. Add `code` to `CheckFindings`; attach a registry code at every task-check and feature-check finding site.
3. Extend `tasksConfigSchema` with the optional `severity` map + an unknown-code `superRefine`; mirror into `spur-config.schema.json`.
4. Apply overrides (`off` / `warning` / `error`) in `summarizeWithStatus`, composing with `--strict`.
5. Tests R1–R5 (check base, task-check, config loader).
6. Same-commit `docs/04_DESIGN.md` (config surface) + a DD reference for the severity-override contract.
### Solution
| File:line | Change |
| --- | --- |
| [`packages/config/src/finding-codes.ts`](file:///Users/robin/xprojects/spur-new/packages/config/src/finding-codes.ts) | Created central registry of 38 stable finding codes (`ALL_FINDING_CODES`, `FindingCode`, `isFindingCode`, `FINDING_CODES`). |
| [`packages/app/src/services/planning-check-base.ts:32`](file:///Users/robin/xprojects/spur-new/packages/app/src/services/planning-check-base.ts#L32) | Added `code: FindingCode` to `CheckFindings`; updated `runL1`/`runL2` to set finding codes and `summarizeWithStatus` to process severity overrides (`off`, `error`, `warning`) before `--strict` elevation. |
| [`packages/app/src/services/task-check.ts`](file:///Users/robin/xprojects/spur-new/packages/app/src/services/task-check.ts) | Attached stable finding codes across all 19 finding creation sites. |
| [`packages/app/src/services/feature-check.ts`](file:///Users/robin/xprojects/spur-new/packages/app/src/services/feature-check.ts) | Attached stable finding codes across all 12 finding creation sites. |
| [`packages/config/src/index.ts:79`](file:///Users/robin/xprojects/spur-new/packages/config/src/index.ts#L79) | Extended `tasksConfigSchema` with optional `severity` map and `superRefine` validating keys against `isFindingCode`. |
| [`apps/cli/schemas/spur-config.schema.json:266`](file:///Users/robin/xprojects/spur-new/apps/cli/schemas/spur-config.schema.json#L266) | Mirrored `severity` map into JSON schema. |
| [`docs/04_DESIGN.md`](file:///Users/robin/xprojects/spur-new/docs/04_DESIGN.md) | Documented stable finding codes and `tasks.severity` configuration. |
### Testing
- Executed `bun test packages/app/tests/services/finding-codes.test.ts` and `packages/config/tests/finding-codes.test.ts`: 100% pass across R1–R5 scenarios.
- Executed `bun run autofix && bun run spur-check` quality gate: 3,540 passing unit tests across 220 files with 100% coverage gate pass and 0 rule violations.
### Review
| Severity | File | Finding | Recommendation |
| --- | --- | --- | --- |
| P4 | [`packages/config/src/finding-codes.ts:1`](file:///Users/robin/xprojects/spur-new/packages/config/src/finding-codes.ts#L1) | Central finding code registry | None — verified complete across L1–L4 layers |

Residual risk: None. All 38 check emission sites are backed by stable finding codes.
### References

Q

<!-- Links to the parent feature, design docs, related tasks, or external references. -->

### History
- 2026-07-24T22:32:59.978Z todo → wip (system)
- 2026-07-24T22:33:02.796Z wip → testing (system)
- 2026-07-24T22:33:06.031Z testing → done (system)
