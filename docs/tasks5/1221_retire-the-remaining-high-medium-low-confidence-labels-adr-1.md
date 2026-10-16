---
schema_version: 1
name: Retire the remaining HIGH/MEDIUM/LOW confidence labels (ADR-138 completion)
status: done
template: standard
created_at: 2026-10-16T22:01:08.349Z
updated_at: "2026-10-16T22:45:05.748Z"

done_forced: "false"
done_reason: unforced close; PASS artifact at .spur/memory/evidence/1221-verdict.json
---

## 1221. Retire the remaining HIGH/MEDIUM/LOW confidence labels (ADR-138 completion)

### Background

Operator decision (2026-10-16): confidence-level grading imported from `cc:anti-hallucination` adds ceremony without evidence. ADR-138 retired the asserted family but kept a "derived" one that re-imported the same labels. Retire every HIGH/MEDIUM/LOW label; keep the decision engine's numeric routing threshold (out of scope).

### Requirements

- [x] R1. The docs rule `sourced-api-claims.yaml` is citation-only (level rules deleted).
- [x] R2. Feature-verification receipts carry no derived confidence; `--confidence`/`--ack-low-confidence` and the workflow vars are removed; legacy receipts parse.
- [x] R3. The dead `response.validate` workflow action is removed.
- [x] R4. Skill/agent/command prose no longer requires HIGH/MEDIUM/LOW tokens.
- [x] R5. History-anatomy findings drop the `confidence` field and its check.
- [x] R6. Stale tests/fixtures/notes are updated; historical drift guards kept.
- [x] R7. `docs/00_ADR.md` binds the invariant (ADR-138 amendment; ADR-024, ADR-119/1196 marked).

### Acceptance Criteria

<!-- Number items AC1, AC2, … (never R<n> — that is the Requirements namespace). Preferred: `Scenario: AC1 — <concrete outcome> (req: R1)` blocks with Given/When/Then, declaring both `ac_altitude: task-local` and `ac_numbering: task-local` for task-local regression criteria (altitude skips only the feature-subset check; numbering makes `(req: R<n>)` count toward requirement coverage). Parsed checkbox rows `- [ ] AC1 — <title>` are supported but never bind requirements — only `Scenario:` titles read `(req: R<n>)`. Bare `- AC1` bullets are legacy unparsed records, not a traceability bypass. Requirements use `- [ ] R1. <text>`, checked at close. Keep empty if this task has no objective AC yet. -->

### Q&A

<!-- CLOSED decisions from refinement: what was chosen and why, what was deferred and on what
     condition. Not a parking lot for open questions — an unanswered question here means the task
     is not ready to hand off. Keep empty if none. -->

### Design

Delete rather than deprecate: legacy artifacts stay readable by ignoring retired keys, so no migration is needed. The decision engine's numeric routing threshold is out of scope (an engine input, not a graded label).

### Plan

<!-- Ordered implementation checklist. Fill before moving to todo/wip. -->

### Solution

Removed every HIGH/MEDIUM/LOW label surface in one pass (commit c1c708e3b):

- Feature receipt: dropped `confidence`/`confidenceBasis`/`confidenceAcknowledged`, the derivation, the `--confidence`/`--ack-low-confidence` flags, the workflow vars and `L4.feature-receipt-confidence`; legacy keys are ignored on parse (`packages/app/src/workflow/feature-verification-receipt.ts:314`).
- Docs rule `config/rules/docs/sourced-api-claims.yaml` reduced to the two citation rules.
- Deleted the never-wired `response.validate` action and its registration.
- History-anatomy finding contract down to 11 fields (`packages/app/src/services/history-anatomy.ts:102`).
- Skill/agent/command prose: confidence tokens replaced by citation/evidence wording.
- ADR-138 amended with a binding invariant; ADR-024 and ADR-119/1196 marked (`docs/00_ADR.md:2392`).

### Testing

**Pipeline verify results**

- Verdict: PASS (from verdict artifact)

| Requirement | Status | Evidence |
|-------------|--------|----------|
| R1 | MET | `config/rules/docs/sourced-api-claims.yaml:12` citation-only header, level rules deleted; pinned by `plugins/sp/tests/skill-structure.test.ts:1555` (plugins/sp 107 pass / 0 fail) |
| R2 | MET | `packages/app/src/workflow/feature-verification-receipt.ts:314` ignores legacy keys; `packages/app/tests/workflow/feature-verification-receipt.test.ts:608` legacy receipt parses (app 190 pass / 0 fail); CLI verify + PR-5/PR-6 parity 81 pass / 0 fail; server transition-gate 8 pass / 0 fail |
| R3 | MET | action file deleted (ls: no such file); registration gone from builtins; recorded at `docs/00_ADR.md:201` |
| R4 | MET | `plugins/sp/skills/source-driven-development/SKILL.md:71` forbids a confidence label; rg over plugins/sp skills/agents/commands finds only absence notes |
| R5 | MET | `packages/app/src/services/history-anatomy.ts:102` FINDING_FIELDS has 11 entries; `plugins/sp/tests/skill-structure.test.ts:1170` asserts no confidence field; `packages/app/tests/services/history-anatomy.test.ts:608` legacy bullet tolerated |
| R6 | MET | `packages/app/tests/workflow/task-pipeline-proof-chain.test.ts:688` table head without confidence; stale pipeline comment fixed at `config/workflows/task-pipeline.yaml:61` (workflow validate valid, cli workflow tests 111 pass / 0 fail) |
| R7 | MET | `docs/00_ADR.md:2392` ADR-138 amendment and `docs/00_ADR.md:2402` binding invariant; superseded note at `docs/00_ADR.md:1898` |
- Coverage: N/A (verdict-based; verify pipeline does not measure code coverage)

### Review

<!-- spur:record-review -->

**SECU findings** (pipeline verify step — verdict: PASS)

| Priority | Dimension | Location | Finding |
|----------|-----------|----------|----------|
| P4 | — | — | No findings (verify verdict PASS) |

### References

<!-- Links to features, docs, ADRs, related tasks, or external references. -->

### History

- 2026-10-16T22:22:23.815Z backlog → todo (system)
- 2026-10-16T22:22:24.047Z todo → wip (system)
- 2026-10-16T22:44:56.317Z wip → testing (system)
- 2026-10-16T22:45:05.643Z testing → done (system)

