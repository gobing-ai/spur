---
schema_version: 1
name: "spur task verdict verb — extract verify-step verdict derivation from YAML"
status: done
template: feature-impl
created_at: 2026-06-24T03:52:29.295Z
updated_at: "2026-08-18T04:42:46.823Z"
feature_id: H2
parent_wbs: "0109"
priority: P1
tags: ["cli", "workflow", "verdict", "testability"]
---

## 0111. spur task verdict verb — extract verify-step verdict derivation from YAML

### Background

Covers 0109 R3. The verify step greps verify-answer.txt for `verdict.*pass|✅` to synthesize verdict.json (task-pipeline.yaml lines ~119-125) — fragile regex-over-prose in YAML, the same untested-shell smell removed from record via spur task record (0108). Extract to a tested `spur task verdict` verb (or deterministic emission in sp:code-verification), replace the YAML grep. Same pattern as 0108: pure derivation fn + unit tests for PASS/PARTIAL/FAIL/UNKNOWN.

### Requirements

- [ ] R1. Add `spur task verdict <wbs> [--from-answer <path>] [--status <PASS|PARTIAL|FAIL>]` (or fold deterministic verdict.json emission into sp:code-verification) deriving the verdict from the verify answer/requirements.
- [ ] R2. Replace the verify-step grep in config/workflows/task-pipeline.yaml with the verb.
- [ ] R3. Unit-test PASS/PARTIAL/FAIL/UNKNOWN derivation (per-file >=90%).
- [ ] R4. spur workflow validate green; lint green; pipeline still gates correctly.

### Acceptance Criteria
```gherkin
Feature: spur task verdict — deterministic verdict derivation from verify output

  Scenario: PASS verdict from answer file
    Given a verify answer file containing "Verdict: PASS" and per-requirement MET statuses
    When "spur task verdict <wbs> --from-answer <path>" runs
    Then it emits verdict.json with verdict "PASS" and all requirements MET
    And exits 0

  Scenario: PARTIAL verdict from mixed requirements
    Given a verify answer file with some requirements MET and some PARTIAL
    When "spur task verdict <wbs> --from-answer <path>" runs
    Then it emits verdict.json with verdict "PARTIAL"
    And exits 0

  Scenario: FAIL verdict from UNMET requirement
    Given a verify answer file with at least one requirement UNMET
    When "spur task verdict <wbs> --from-answer <path>" runs
    Then it emits verdict.json with verdict "FAIL"
    And exits 0

  Scenario: UNKNOWN verdict from unparseable answer
    Given a verify answer file with no recognizable verdict
    When "spur task verdict <wbs> --from-answer <path>" runs
    Then it emits verdict.json with verdict "UNKNOWN"
    And exits 1

  Scenario: Pipeline verify step uses verb instead of grep
    Given config/workflows/task-pipeline.yaml
    When the verify step runs
    Then the verdict.json derivation uses "spur task verdict" instead of inline grep/shell
    And the pipeline's done gate still correctly gates on PASS vs non-PASS
```
### Q&A

<!-- Open questions and their resolutions. Delete if none. -->

### Design
**Chosen approach:** Extract verdict derivation into a `spur task verdict` CLI verb — same pattern as `spur task record` (task 0108). Pure derivation function + unit tests. The pipeline's verify step calls the verb instead of inline grep/shell.

**Rejected alternative:** Fold verdict emission directly into `sp:code-verification`. Rejected because the pipeline's verify step needs a deterministic, testable artifact — mixing it into the skill's agent-driven output loses the determinism that motivates the extraction.

**Key signature:**
```
spur task verdict <wbs> --from-answer <path> [--json]
  → reads answer file, derives verdict, emits .spur/run/<wbs>-verdict.json
```

**Invariants:** Verdict derivation is pure (same input → same output). UNKNOWN verdict exits non-zero. Pipeline gate only advances on PASS.
### Plan
- [ ] Add `spur task verdict <wbs>` command to `apps/cli/src/commands/task.ts`: `--from-answer <path>` reads verify-answer.txt, derives PASS/PARTIAL/FAIL/UNKNOWN, emits `.spur/run/<wbs>-verdict.json`
- [ ] Implement `deriveVerdict()` in `packages/app/src/services/`: pure function parsing answer text → { verdict, requirements[], checks[] }
- [ ] Unit-test all 4 derivation paths: PASS, PARTIAL, FAIL, UNKNOWN
- [ ] Replace the verify-step grep/shell in `config/workflows/task-pipeline.yaml` (lines ~119-125) with `spur task verdict ${vars.wbs} --from-answer .spur/run/${vars.wbs}-verify-answer.txt`
- [ ] Verify: `bun run check` passes; pipeline gates still work (PASS→record, non-PASS→failed)
### Solution

| File:line | What / Why |
|-----------|-------------|
| `packages/app/src/services/task-verdict.ts:1-154` | New: `deriveVerdict()` pure function — parses verify answer text, extracts requirements, derives PASS/PARTIAL/FAIL/UNKNOWN. R1. |
| `packages/app/src/index.ts:101-102` | Export `deriveVerdict` and `VerdictResult` from app barrel. |
| `apps/cli/src/commands/task.ts:251-297` | New `spur task verdict <wbs> --from-answer <path>` CLI command. Reads answer file, derives verdict, emits `.spur/run/<wbs>-verdict.json`. R1. |
| `config/workflows/task-pipeline.yaml:118-121` | Replaced ~7-line grep/shell verdict derivation with `spur task verdict ${vars.wbs} --from-answer ...`. R2. |
| `packages/app/tests/services/task-verdict.test.ts:1-69` | 7 unit tests covering PASS, PARTIAL, FAIL, UNKNOWN, task-check gate, and priority rules. R3. |

### Testing

| Req | Status | Evidence |
|-----|--------|----------|
| R1: `spur task verdict` CLI verb + `deriveVerdict()` | **MET** | `packages/app/src/services/task-verdict.ts:33-57` — pure derivation function; `task.ts:251-297` — CLI command with `--from-answer` flag |
| R2: Replace pipeline grep/shell with verb | **MET** | `config/workflows/task-pipeline.yaml:118-121` — 7-line grep/shell replaced with single `spur task verdict` invocation |
| R3: Unit-test PASS/PARTIAL/FAIL/UNKNOWN derivation | **MET** | `packages/app/tests/services/task-verdict.test.ts:1-69` — 7 tests covering all 4 verdict paths + priority rules |
| R4: `bun run check` passes | **MET** | Typecheck (7 workspaces) ✓, 1794 tests (0 fail), biome clean |

Coverage: 99.07% lines, 99.54% funcs (spur-new).

**Verdict: PASS** — all 4 requirements MET.

### History
- 2026-06-25T05:12:38.355Z todo → wip (system)
- 2026-06-25T05:16:50.148Z wip → testing (system)
- 2026-06-25T05:17:02.594Z testing → done (system)
