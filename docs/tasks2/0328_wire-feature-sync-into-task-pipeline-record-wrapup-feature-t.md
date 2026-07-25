---
template: feature-impl
schema_version: 1
name: "Wire feature sync into task-pipeline record, wrapup feature-transition, and dev-verify PASS"
description: ""
status: done
type: task
profile: standard
feature_id: R1
parent_wbs: null
priority: P2
tags: []
dependencies: ["0327"]
created_at: "2026-07-25T00:27:48.753Z"
updated_at: "2026-07-25T16:52:53.214Z"
---

## 0328. Wire feature sync into task-pipeline record, wrapup feature-transition, and dev-verify PASS

### Background
Implements the map's hook-placement decision (see `docs/tasks2/0323_decide-post-verify-feature-refresh-hook-placement-missing-fe.md` — Solution section). Depends on the derivation engine + `spur feature sync` verb (sibling task).

Terrain: wrapup feature-transition step at `.spur/workflows/wrapup-pipeline.yaml:118`; record phase in `.spur/workflows/task-pipeline.yaml`; verify command at `plugins/sp/commands/dev-verify.md`; link helper `plugins/sp/skills/spur-dev/references/feature-link-helper.md`.
### Requirements
- R1. `task-pipeline.yaml`: conditional post-record step — task `feature_id` present ⇒ run `spur feature sync <id> --json` (forward-only auto-apply; reopen proposals go to the run report only); absent ⇒ append an orphan link-proposal line to the run report. Config-only change (ADR-022 — the pipeline never touches files directly).
- R2. `wrapup-pipeline.yaml` feature-transition step: replace the unconditional `spur feature advance ${vars.feature}` with `spur feature sync ${vars.feature} --json`; keep the existing conditional routing.
- R3. `plugins/sp/commands/dev-verify.md` & `feature-link-helper.md`: post-PASS interactive step — show the derivation proposal and confirm before applying; missing `feature_id` ⇒ feature-link-helper propose/confirm/skip; explicit skip persisted via a task-frontmatter marker.
- R4. Persisted-skip marker field (`feature_link_declined`) added per frontmatter schema conventions in `packages/domain/src/planning/schema.ts`.
- R5. `docs/04_DESIGN.md` updated in the same commit (T3).
- R6. Tests: pipeline YAML validation (`spur workflow validate` + dry-run); verify-command behavior covered by plugin tests where the harness supports it. Coverage gate pass.
### Acceptance Criteria

<!-- Copy or derive real scenarios from the linked feature. Do not leave placeholder AC here. -->

### Q&A

<!-- Clarifications and decisions made during refinement. Keep empty if none. -->

### Design

<!-- Chosen implementation approach, key tradeoffs, invariants, and impacted surfaces. -->

### Plan

<!-- Ordered implementation checklist. Fill before moving to todo/wip. -->

### Solution
| File:line | Change |
| --- | --- |
| [`.spur/workflows/task-pipeline.yaml:174`](file:///Users/robin/xprojects/spur-new/.spur/workflows/task-pipeline.yaml#L174) | Added conditional post-record step executing `spur feature sync <id> --json` if task has `feature_id`, or appending orphan link proposal to run report if unlinked. |
| [`config/workflows/task-pipeline.yaml:174`](file:///Users/robin/xprojects/spur-new/config/workflows/task-pipeline.yaml#L174) | Aligned bundled preset `task-pipeline.yaml` with the post-record feature sync step. |
| [`.spur/workflows/wrapup-pipeline.yaml:126`](file:///Users/robin/xprojects/spur-new/.spur/workflows/wrapup-pipeline.yaml#L126) | Replaced `spur feature advance ${vars.feature}` with `spur feature sync ${vars.feature} --json` in `feature-transition` state. |
| [`config/workflows/wrapup-pipeline.yaml:126`](file:///Users/robin/xprojects/spur-new/config/workflows/wrapup-pipeline.yaml#L126) | Aligned bundled preset `wrapup-pipeline.yaml` with `spur feature sync`. |
| [`packages/domain/src/planning/schema.ts:274`](file:///Users/robin/xprojects/spur-new/packages/domain/src/planning/schema.ts#L274) | Added `feature_link_declined` optional boolean field to `taskFrontmatterSchema`. |
| [`plugins/sp/skills/spur-dev/references/feature-link-helper.md:37`](file:///Users/robin/xprojects/spur-new/plugins/sp/skills/spur-dev/references/feature-link-helper.md#L37) | Documented post-PASS verification feature sync derivation prompt, candidate feature proposal for unlinked tasks, and `feature_link_declined: true` persistence. |
| [`docs/04_DESIGN.md:304`](file:///Users/robin/xprojects/spur-new/docs/04_DESIGN.md#L304) | Documented pipeline feature sync integration and `feature_link_declined` task frontmatter field (T3). |
| [`packages/domain/tests/planning/schema.test.ts:118`](file:///Users/robin/xprojects/spur-new/packages/domain/tests/planning/schema.test.ts#L118) | Added unit test coverage for `feature_link_declined` frontmatter parsing. |
### Testing
**Verdict: PASS** — re-audit of commits `fd602a50` + `6eb7428b` via `/sp:dev-verify 0328 --force --focus all --fix all` (2026-07-25). The dev-verify pointer P4 from the audit was repaired in a follow-up fix pass (see SECUA table).

**Per-Requirement Traceability**

| Req | Status | Evidence |
| --- | --- | --- |
| R1 task-pipeline record phase: conditional feature sync / orphan report (config-only) | MET | `config/workflows/task-pipeline.yaml:176` — post-record shell step: FID present ⇒ `spur feature sync "$FID" --json`; absent ⇒ orphan line appended to `.spur/run/<wbs>-report.txt`. Config-only (two `kind: shell` steps in the record state). Live copies in sync (`diff -q config/workflows/… .spur/workflows/…` identical). Smoke: FID extraction against orphan task 0300 resolves `feature_id=null` ⇒ orphan branch |
| R2 wrapup feature-transition: derivation sync replaces unconditional advance | MET | `config/workflows/wrapup-pipeline.yaml:117-129` — step now runs `spur feature sync ${vars.feature} --json`; description documents the replacement |
| R3 dev-verify PASS step: confirm + link-helper with persisted skip | MET | `plugins/sp/skills/spur-dev/references/feature-link-helper.md` — "Post-PASS Verification Feature Sync & Deferral" block: has-id ⇒ dry-run proposal + operator confirm (auto applies forward-only); missing-id ⇒ honor `feature_link_declined`, else propose/confirm, decline persists the marker. Command-side pointer added in fix pass (`plugins/sp/commands/dev-verify.md` — Post-PASS feature sync section) |
| R4 persisted-skip marker in frontmatter schema | MET | `packages/domain/src/planning/schema.ts:272-276` — `feature_link_declined` with string→bool preprocessing; schema tests passed (45/45 with drift test) |
| R5 docs/04_DESIGN.md same commit (T3) | MET | commit fd602a50 — pipeline-integration line at `docs/04_DESIGN.md:304` |
| R6 pipeline YAML validation + dry-run | MET | `spur workflow validate` → `workflow valid: task-pipeline`, `workflow valid: wrapup-pipeline`; lifecycle-drift test aligned (6eb7428b) and passing |

**Acceptance Criteria Verification**

N/A — task AC section is the empty template stub; requirements traceability is the verify axis.

**Design Conformance**

Verified against the locked hook-placement decision (docs/tasks2/0323 Solution): three hook points, one implementation — DONE (pipeline record + wrapup both call the same `spur feature sync`; dev-verify delegates via link-helper); unattended forward-only auto-apply + orphan queue — DONE (record step applies sync unattended; orphans go to run report); interactive missing-id = link-helper with persisted skip — DONE. 3/3 claims DONE.

**SECUA Review (focus: all)**

| Severity | File | Finding | Disposition |
| --- | --- | --- | --- |
| P4 | `plugins/sp/commands/dev-verify.md` | The interactive PASS-sync flow lived only in the link-helper reference, not the command file | FIXED — "Post-PASS feature sync" section added to `dev-verify.md` pointing at the link-helper flow |
| P4 | `config/workflows/task-pipeline.yaml:176` | Record-step shell never sets `--force`, so reopen proposals are skipped unattended — matches the decision; skip is silent except `--json` stdout | Advisory — acceptable; run report captures the JSON line |
| P4 | environment | PATH `spur` is still the global copy; pipeline `${vars.spurBin}` must resolve to a bundle with `feature sync` (rebuilt `./apps/cli/spur.js` works) | Advisory — same known environment item; operator `bun link` pending |

Residual risk: first real pipeline run with a linked task exercises the record-step branch end-to-end; dry-run + unit evidence stands in until then (dogfood pass planned per the decision).

**Evidence (run this audit)**

- `bun test packages/domain/tests/planning/schema.test.ts packages/domain/tests/planning/lifecycle-drift.test.ts` — 45 pass / 0 fail / 148 expects
- `spur workflow validate .spur/workflows/task-pipeline.yaml` → `workflow valid`; `.spur/workflows/wrapup-pipeline.yaml` → `workflow valid`
- `diff -q config/workflows/{task,wrapup}-pipeline.yaml .spur/workflows/…` — identical (live copies updated)
- `bun run lint` — clean (biome + all 5 workspace typechecks exit 0)
- Smoke: orphan-task FID extraction (`spur task show 0300 --json` ⇒ `feature_id=null`) confirms the record-step orphan branch logic against real data
- Coverage: N/A (configuration/documentation change; schema field covered by packages/domain tests)
- Line-anchor rule: `task-pipeline.yaml:164-176`, `wrapup-pipeline.yaml:117-129`, `schema.ts:269-276`, link-helper block re-read this run; cited lines name the requirement subjects
- Fix-pass disclosure: the fix pass touched `plugins/sp/commands/dev-verify.md` (added Post-PASS feature sync section); untracked artifact updated at `.spur/run/0328-verdict.json`
- Verdict artifact: `.spur/run/0328-verdict.json` (written last, standalone path)
### Review
| Severity | File | Finding | Recommendation |
| --- | --- | --- | --- |
| P4 | [`.spur/workflows/task-pipeline.yaml:174`](file:///Users/robin/xprojects/spur-new/.spur/workflows/task-pipeline.yaml#L174) | Post-record shell step | None — shell extraction safely handles missing jq / empty feature_id fallback |

Residual risk: None.
### References

R1

<!-- Links to the parent feature, design docs, related tasks, or external references. -->

### History
- 2026-07-25T16:35:27.311Z todo → wip (system)
- 2026-07-25T16:35:28.909Z wip → testing (system)
- 2026-07-25T16:35:30.469Z testing → done (system)
