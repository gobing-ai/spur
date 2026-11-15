---
schema_version: 1
name: Guard history-anatomy against recurring false-positive findings
status: done
template: issue
created_at: 2026-11-15T17:52:11.815Z
updated_at: "2026-11-15T18:39:11.499Z"

ac_altitude: task-local
ac_numbering: task-local
done_forced: "false"
done_reason: unforced close
---

## 1339. Guard history-anatomy against recurring false-positive findings

### Background

Captured from the creation title: "Guard history-anatomy against recurring false-positive findings".

### Requirements

- [x] R1. In `packages/domain/src/analytics/forensic-query.ts`, cache-waste counts and offender rows must exclude the first assistant step after a model change while retaining subsequent same-model low-reuse steps; cover this in `packages/domain/tests/analytics/forensic-query.test.ts`.
- [x] R2. `packages/app/src/services/history-anatomy.ts` must reject the retired `coverage:spur-task-check:verified-outcome-absent` finding key; zero denominator is unavailable, and current completion evidence follows ADR-140.
- [x] R3. The deterministic structure gate must reject a projected section-9 candidate that cites none of the section-4 finding keys; a valid cited candidate must pass. Cover both in `packages/app/tests/services/history-anatomy.test.ts`.
- [x] R4. Update `plugins/sp/skills/history-anatomy/references/report-contract.md`, `operations.md`, `plugins/sp/tests/skill-structure.test.ts`, and the owning history design docs to teach the three guards.

### Acceptance Criteria

```gherkin
Scenario: AC1 — Model-switch cold start is not cache re-send waste (req: R1)
Given an assistant sequence whose model changes and whose first step in the new model has low cache reuse
When cache-waste aggregate and offender queries run
Then that first new-model step is excluded, while a subsequent same-model low-reuse step remains counted.

Scenario: AC2 — Retired verified-outcome absence cannot become a finding (req: R2)
Given a candidate containing `coverage:spur-task-check:verified-outcome-absent`
When the deterministic structure gate runs
Then it rejects the retired key, and the rubric classifies zero denominator as unavailable under ADR-140 rather than recommending a new proof-digest integration.

Scenario: AC3 — Projected candidates require observed findings (req: R3)
Given section 9 with a projected candidate that cites no section-4 finding key
When the deterministic structure gate runs
Then it rejects the candidate; the same candidate passes after citing an existing finding key.

Scenario: AC4 — Skill and design owners teach the guards (req: R4)
Given the history-anatomy contract, operations rubric, and history design documents
When an enricher or validator follows them
Then they name all three guards without adding minimax telemetry or project-selector work.
```

### Q&A

<!-- Clarifications and triage decisions. Keep empty if none. -->

### Design

Apply three narrow guards. In the two existing cache-waste queries, exclude only a low-reuse assistant row whose immediately preceding assistant row in the same source/session has a different, known model. Keep first-session and same-model behavior unchanged. In the existing structure gate, reject the retired verified-outcome-absence key and require each projected candidate bullet to cite at least one key declared in section 4. Update the existing skill rubrics and design satellites; do not alter the verifiedOutcome schema, add a project selector, or instrument executor cost.

### Plan

- [x] Add failing model-switch, retired-outcome, and projected-candidate regressions.
- [x] Implement the smallest analytics and structure-gate guards.
- [x] Update skill rubrics and design docs; run focused domain/app/plugin tests.

### Root Cause

Three independent evidence-to-finding gaps produced recurring false positives: cache-waste SQL counted the expected first cold request after a model change as re-send waste; the model rubric treated a zero, legacy verified-outcome denominator as a defect despite ADR-140 retiring that chain; and section 9 allowed projected candidates with no source finding, letting the contract's illustrative `AGENTS.md` example recur as though observed.

### Solution

| File | Change | Why |
| --- | --- | --- |
| `packages/domain/src/analytics/forensic-query.ts:1182-1186,1202-1214,1254-1266` | Excluded the first low-reuse assistant step after a known model change from both cache-waste queries. | Expected cold-cache initialization is no longer mislabeled re-send waste; later same-model offenders remain. |
| `packages/domain/tests/analytics/forensic-query.test.ts:838-886` | Added a three-step model-transition regression. | Old code counted both new-model steps; the fix counts only the repeated same-model offender. |
| `packages/app/src/services/history-anatomy.ts:446-466,515-521,550-555,564` | Rejected the retired verified-outcome key and required projected candidates to cite section-4 keys, including legacy pipe rows. | Prevents unsupported remediations and copied examples while preserving legacy report compatibility. |
| `packages/app/tests/services/history-anatomy.test.ts:671-722` | Added retired-key, missing/cited-source, and legacy-row cases. | Covers both new guards and the legacy compatibility edge. |
| `plugins/sp/skills/history-anatomy/references/report-contract.md:116-126,199-214` | Made cold-start, zero-denominator, and mandatory source-finding rules explicit. | Enrichers no longer receive the old ambiguous instructions. |
| `plugins/sp/skills/history-anatomy/references/operations.md:54-61,94-99` | Added matching enrich/validate rubrics. | Independent validation rejects the same false positives. |
| `plugins/sp/tests/skill-structure.test.ts:2277-2289` | Pinned all three rubric guards and the design owner. | Prevents documentation drift. |
| `docs/design/history-cli-contracts.md:397-400,437-443` | Documented model-switch analytics and ADR-140 current-completion reading. | Keeps the analytics design aligned with behavior. |
| `docs/design/history-anatomy.md:161-168` | Documented the deterministic guard codes and evidence requirements. | Keeps the anatomy design aligned with the gate. |

Probe: `history anatomy-check` on the original report fails only with the two intended findings (`finding-retired-key` and `projected-candidate-without-source-finding`); the valid cited-candidate control passes. A real SQLite query narrowed to the original session returns `steps: 0`, `offenders: []` in 19 ms.

### Testing

**Pipeline verify results**

- Verdict: PASS (from verdict artifact)

| Requirement | Status | Evidence |
|-------------|--------|----------|
| R1 | MET | `packages/domain/src/analytics/forensic-query.ts:1182-1186,1202-1214,1254-1266`; `packages/domain/tests/analytics/forensic-query.test.ts:838-886`; original-session SQLite `steps=0`, `offenders=[]`. |
| R2 | MET | `packages/app/src/services/history-anatomy.ts:515-521,550-555`; `packages/app/tests/services/history-anatomy.test.ts:671-675,720-721`; original report CLI rejects the retired key. |
| R3 | MET | `packages/app/src/services/history-anatomy.ts:446-466,564`; `packages/app/tests/services/history-anatomy.test.ts:677-717`; negative original-report and positive cited-candidate CLI probes. |
| R4 | MET | `plugins/sp/skills/history-anatomy/references/report-contract.md:116-126,199-214`; `operations.md:54-61,94-99`; `plugins/sp/tests/skill-structure.test.ts:2277-2289`; `docs/design/history-cli-contracts.md:397-400,437-443`; `docs/design/history-anatomy.md:161-168`. |

| Acceptance Criteria | Status | Evidence Type | Evidence |
|---------------------|--------|---------------|----------|
| AC1 | MET | test | `packages/domain/tests/analytics/forensic-query.test.ts:838-886` — first new-model step excluded, subsequent same-model offender retained; real SQLite probe agrees. |
| AC2 | MET | command | Original Nov 15 report through `history anatomy-check` fails with `finding-retired-key:coverage:spur-task-check:verified-outcome-absent`; `packages/app/tests/services/history-anatomy.test.ts:671-675`. |
| AC3 | MET | command | Original report also fails with `projected-candidate-without-source-finding:workflow:agents-md:navigation`; valid cited-candidate control returns PASS; `packages/app/tests/services/history-anatomy.test.ts:677-717`. |
| AC4 | MET | test | `plugins/sp/tests/skill-structure.test.ts:2277-2289` plus design documents named in R4; 96/96 plugin structure tests passed. |
- Coverage: N/A (verdict-based; verify pipeline does not measure code coverage)

### Review

| Priority | Finding | Disposition | Evidence |
| --- | --- | --- | --- |
| P4 (advisory) | Domain-only light coverage is insufficient for this cross-workspace query module; the required full-tier gate passed instead. | ACCEPTED | `.spur/run/1339-check-receipt.json` has tier `full`, status `PASS`. |

| Check | Status | Evidence |
| --- | --- | --- |
| design-conformance | pass | 4/4 claims DONE; no minimax, project-selector, schema, or dependency work added. |
| SECUA | pass | Fixed SQL predicates only; no new input/trust boundary. Original-session query returned in 19 ms. |
| architecture | pass | Analytics stays in the domain query owner; report policy stays in the existing structure gate and skill rubrics. |

| Req | Status | Evidence |
| --- | --- | --- |
| R1 | MET | `packages/domain/src/analytics/forensic-query.ts:1182-1186,1202-1214,1254-1266`; `packages/domain/tests/analytics/forensic-query.test.ts:838-886`; original-session SQLite `steps=0`, `offenders=[]`. |
| R2 | MET | `packages/app/src/services/history-anatomy.ts:515-521,550-555`; `packages/app/tests/services/history-anatomy.test.ts:671-675,720-721`; original report CLI rejects the retired key. |
| R3 | MET | `packages/app/src/services/history-anatomy.ts:446-466,564`; `packages/app/tests/services/history-anatomy.test.ts:677-717`; negative original-report and positive cited-candidate CLI probes. |
| R4 | MET | `plugins/sp/skills/history-anatomy/references/report-contract.md:116-126,199-214`; `operations.md:54-61,94-99`; `plugins/sp/tests/skill-structure.test.ts:2277-2289`; `docs/design/history-cli-contracts.md:397-400,437-443`; `docs/design/history-anatomy.md:161-168`. |

| AC | Status | Evidence Type | Evidence |
| --- | --- | --- | --- |
| AC1 | MET | test | `packages/domain/tests/analytics/forensic-query.test.ts:838-886` — first new-model step excluded, subsequent same-model offender retained; real SQLite probe agrees. |
| AC2 | MET | command | Original Nov 15 report through `history anatomy-check` fails with `finding-retired-key:coverage:spur-task-check:verified-outcome-absent`; `packages/app/tests/services/history-anatomy.test.ts:671-675`. |
| AC3 | MET | command | Original report also fails with `projected-candidate-without-source-finding:workflow:agents-md:navigation`; valid cited-candidate control returns PASS; `packages/app/tests/services/history-anatomy.test.ts:677-717`. |
| AC4 | MET | test | `plugins/sp/tests/skill-structure.test.ts:2277-2289` plus design documents named in R4; 96/96 plugin structure tests passed. |

| Verification | Result |
| --- | --- |
| `task gate 1339 run` | PASS — full-tier receipt `.spur/run/1339-check-receipt.json`. |
| Focused suites | 33/33 domain forensic-query, 68/68 app history-anatomy, 72/72 app history-service, 96/96 plugin structure, 16/16 CLI history-report tests passed. |
| Real-data probes | Original session `steps=0`, `offenders=[]` in 19 ms; original report rejects exactly the two intended problems; valid report PASS. |

Verdict: PASS

### References

<!-- Links to failing logs, related issues, tasks, docs, or external references. -->

### History

- 2026-11-15T18:34:51.901Z todo → wip (system)
- 2026-11-15T18:39:10.590Z wip → testing (system)
- 2026-11-15T18:39:11.400Z testing → done (system)

