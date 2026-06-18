---
name: "Review findings: packages (dev-review --focus all)"
description: "Review findings: packages (dev-review --focus all)"
status: Done
created_at: 2026-06-17T23:41:43.584Z
updated_at: 2026-06-18T03:57:40.826Z
folder: docs/tasks
type: task
feature-id: ""
preset: simple
impl_progress:
  planning: pending
  design: pending
  implementation: pending
  review: pending
  testing: pending
---

## 0086. "Review findings: packages (dev-review --focus all)"

### Background

SECU + architecture review findings for packages/ — run 2026-06-17 via /rd3:dev-review --focus all --fix all --auto


### Requirements

See Review section


### Q&A



### Design

Findings-only task (output of `/rd3:dev-review packages --focus all`). No design surface — see Review section for the SECU + architecture terrain map. Disposition of each finding is recorded inline (deferred, with rationale).


### Solution

Review completed 2026-06-17. 6 findings (0 P1, 0 P2, 4 P3, 2 P4) — full table in Review section. Verdict **PASS**: security posture strong (exemplary SSRF defense in http-request.ts; no secrets/shell-exec/SQLi; zero empty catches; zero `any`), correctness clean. All findings are P3/P4 improvements; none blocks. 0 auto-fixed — each finding is either a decision needing sign-off (#1 SSRF redirect semantics, #4 contract-shape change) or an architecture-dimension refactor (#3/#5/#6, design-conversation per skill contract) or a negligible cold-path micro-opt (#2). Gate green: lint + 1659 tests pass; no source modified.


### Plan

- [x] SECU sweep (security/efficiency/correctness/usability) across packages/{app,domain,contracts,config}
- [x] Architecture survey (deletion test on check-services, lifecycle adapters, DAOs, contract seams)
- [x] Record 6 findings with file:line + disposition in Review section
- [x] Gate verification (lint + tests green; non-destructive)
- [ ] FOLLOW-UP (backlog, owner decides): #1 harden redirect:'follow' SSRF re-validation
- [ ] FOLLOW-UP (backlog): #4 adopt apiSuccessSchema across contracts (ADR-005 sign-off)
- [ ] FOLLOW-UP (backlog): #3 PlanningCheck base · #5 resolveCorpusFile helper · #6 parameterize lifecycle adapters


### Review


---

## Fix-pass — 2026-06-17 (all 4 P3 issues resolved)

All four P3 findings fixed and verified. Gates green: lint clean (353 files, 7 typechecks) · 1502 tests pass / 0 fail · test-cf pass · build green.

| # | Finding | Resolution | Files |
|---|---------|-----------|-------|
| 1 | SSRF: redirect:'follow' bypasses host gate | Reject `redirect:'follow'` at the URL security gate before any request is issued (was the only option that escaped per-hop validation). `manual` (default) + `error` remain. Docstring + test updated; new test asserts `follow` is rejected and no request fires. | http-request.ts:180-197,95-114 · http-request.test.ts |
| 2 | Serial await fs.stat in nested loop | Parallelized the inner stat calls with `Promise.all` (order-independent — results feed a Set). | rule-service.ts:724-736 |
| 3 | PlanningCheck scaffold duplicated across check services | Extracted `PlanningCheckService` abstract base (planning-check-base.ts) owning the shared scaffold: finding/result/matrix types, generic L1 schema parse, L2 matrix presence, resolveMatrixEntry, strict-elevation + result summarize. task-check/feature-check now extend it; only the divergent L3/L4 bodies + check() orchestration remain per-entity. All public exports preserved (CheckResult.wbs, CheckFeatureResult.id, DEFAULT_FEATURE_MATRIX, all type aliases). Net −75 LOC (1007 → 932 incl. base); scaffold lives once. | NEW planning-check-base.ts · task-check.ts (459→327) · feature-check.ts (548→406) |
| 4 | apiSuccessSchema is a seam with 0 production adapters | Replaced 14 inline `z.object({ok:z.literal(true),data})` envelopes with `apiSuccessSchema(...)` across the contract surface. Factory now has 14 production usages (was 0). Type-compatible — `implement(contract)` + 45 contract tests + server/web typecheck all clean. | contracts/{task,feature,planning-event}.ts |

**Behavioral equivalence:** 54 check-service tests + 32 http-request tests + 45 contract tests all pass unchanged (except the intentionally-updated redirect test). No public interface changed.


### P1 — Blockers
_None._

### P2 — Warnings
_None._

### P3 — Info
| # | Title | Dimension | Location | Recommendation |
|---|-------|-----------|----------|----------------|
| 1 | SSRF: redirect:'follow' bypasses private-host gate | Security | packages/app/src/workflow/actions/http-request.ts:138,218,231 | The allowlist + private-host gates validate only the INITIAL URL. With `redirect:'follow'`, a redirect to a private/metadata host (e.g. 169.254.169.254) is not re-validated. Either forbid `'follow'` (keep manual/error only) or re-run the gate on each redirect hop inside the requester adapter (out of packages/ scope). NOT auto-fixed: security-semantics decision; auto-changing risks breaking workflows relying on follow + giving false assurance. |
| 2 | Serial `await fs.stat` in nested loop | Efficiency | packages/app/src/services/rule-service.ts:733 | `discoverRootPresetNames` stats files one-by-one inside a nested dir loop. `Promise.all` over the entries would parallelize. Cold path (preset discovery on `spur rule list`), bounded by dir size → low impact. NOT auto-fixed: cold path, negligible gain, restructuring a working loop carries more risk than the win. |
| 3 | PlanningCheck scaffold duplicated across check services | Usability | packages/app/src/services/task-check.ts:80-101,426-458 + feature-check.ts:120-144,510-547 | ~150 lines of identical 4-layer scaffold (check flow, buildResult, strict-elevation, resolveMatrixEntry, MatrixEntry types). Extract a `PlanningCheckService<TFrontmatter,TMatrix>` base; leave L1 schema + L3/L4 bodies as overrides. Architecture candidate — design conversation, not auto-fix. |
| 4 | apiSuccessSchema is a real seam with 0 production adapters | Usability | packages/contracts/src/shared.ts:24,52 vs task.ts/feature.ts (9 inline envelopes) | Factory schemas exist + are unit-tested but unused; task.ts/feature.ts hand-roll 9 `z.object({ok:z.literal(true),data})`. Replace inline envelopes with `apiSuccessSchema(...)`. Mechanical but a CONTRACT change (ADR-005 oRPC seam) — belongs in architecture review with sign-off, not silent auto-fix. |

### P4 — Suggestions
| # | Title | Dimension | Location | Recommendation |
|---|-------|-----------|----------|----------------|
| 5 | Corpus dir-scan pattern repeated 6× | Maintainability | task-check.ts:349,412 · feature-check.ts:335,386 · task-service.ts:468 · feature-service.ts:437 | "readDir → match `${id}_*.md` → return path" reimplemented 6 ways. Extract `resolveCorpusFile(fs,dir,id)` into packages/domain/planning (domain op, not app). NOTE: the two `slugify` methods (task-service.ts:507 vs feature-service.ts:453) are NOT identical — task collapses `-` runs + truncates@60, feature does neither. Merging would change generated filenames on a persistence path — do NOT consolidate without a deliberate decision. |
| 6 | Lifecycle adapters ~80% duplicated; misc shallow modules | Maintainability | lifecycle-adapter.ts + feature-lifecycle-adapter.ts (138 each); dao/base.ts (misnamed); ArtifactDao/WorkflowStateDao (shallow) | Parameterize one LifecycleAdapter via `{linkKind,workflowName,keyPrefix,varName}`. Rename dao/base.ts → id.ts (it's a createId util, not a base class). ArtifactDao/WorkflowStateDao add one method renaming super.create() — collapse if they stay one-method. Advisory: rebuild-events.ts:12-13 points domain→DAO dependency edge upward; DEFAULT_FEATURE_MATRIX (feature-check.ts:63) is domain policy living in app layer. All backlog. |

**Fix-pass rationale (2026-06-17):** 0 fixed, 0 failed, 6 deferred. No P1/P2 to fix. All 6 findings are P3/P4. None qualifies for safe mechanical auto-fix: #1 and #4 are decisions (security semantics / contract shape) needing sign-off; #2 is a cold-path micro-opt where the restructure risk exceeds the gain; #3/#5/#6 are architecture-dimension refactors (design conversation per skill contract, not auto-applied). Verdict already PASS — no blocker/warning prevents it.


### Testing



### Artifacts

| Type | Path | Agent | Date |
| ---- | ---- | ----- | ---- |

### References


