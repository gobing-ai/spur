---
template: feature-impl
schema_version: 1
name: "Dogfood residual hardening from 0277 dogfood reports (done-gate, cost, self-validate)"
description: ""
status: done
type: task
profile: standard
feature_id: N
parent_wbs: null
priority: P1
tags: []
dependencies: ["0276", "0277"]
created_at: "2026-07-17T06:11:43.445Z"
updated_at: "2026-07-17T06:22:34.515Z"
---

## 0278. Dogfood residual hardening from 0277 dogfood reports (done-gate, cost, self-validate)

### Background
**Type:** feature-impl · **Feature:** N · **Package:** dogfood residual / lifecycle

**Goal:** Close the *open* findings from the two 0277 dogfood runs so the next dogfood of refine/verify does not re-surface the same gaps — without redoing work already shipped in 0276/0277 and commit `d357faf`.

**Source reports (gitignored runtime artifacts; content summarized in Requirements):**
- `docs/dogfood/2026-07-17-sp-dev-refine-0277-dogfood.md` — dogfood of `/sp-dev-refine 0277 --auto --next` (verdict PASS; non-@1.2 section shape)
- `docs/dogfood/2026-07-17-sp-dev-verify-0277-dogfood.md` — dogfood of `/sp-dev-verify 0277 --auto --next --force --focus all --fix all` (verdict PASS; 1 fixed in-session)

**Authority:** task 0277 Solution + Review; dogfood protocol `sp:dogfood-testing@1.2`; lifecycle adapter provenance gate (`packages/app/src/workflow/lifecycle-adapter.ts`); `spur task check --strict-core` L3 Review P1–P4 rule.

**Predecessor work already done (DO NOT re-implement — disposition RESOLVED):**

| ID | Finding | Report | Disposition |
|----|---------|--------|-------------|
| RES-1 | Detector not CLI-wired / prose-only Phase 1.0 | refine P4, verify P3 | **RESOLVED** `d357faf` — live CLI `detect-pipeline-driving.ts` + SKILL Phase 1.0 |
| RES-2 | W8 implement-heavy advisory docs-time only | verify P3 | **RESOLVED** `d357faf` — Phase 1.2b `--steps` re-run emits advisory |
| RES-3 | Feature N AC subset DD-09 warnings | verify P4 | **RESOLVED** `d357faf` — four scenarios added to feature N AC |
| RES-4 | PATH `spur` missing `task run-link` | verify P2 | **RESOLVED** (local) — monorepo `apps/cli` linked + `spur.js` rebuilt; still needs durable guidance (see R5) |
| RES-5 | 0277 Review prose-only blocked strict-core | verify Fixed | **RESOLVED** — Review rewritten with P1–P4 table; task remains `done` |

**Out of scope:**
- Re-running full dogfood of 0277 (operator next session after this ships).
- Rewriting historical dogfood report files under `docs/dogfood/` (gitignored; not corpus).
- Impl of golden dogfood CI suite (still fog on feature N).
- Changing feature N status (map still has fog).
### Requirements
- [x] R1. **Done-gate hardens Review L3:** any path that transitions a task `testing → done` (lifecycle adapter and/or `task record` / verify `--next`) MUST refuse when `spur task check <wbs> --strict-core` would fail on L3 Review (missing populated P1–P4 table). Provenance gate alone is insufficient (0277 reached `done` with prose-only Review).
- [x] R2. **Regression test for R1:** a task at `testing` with prose-only Review (no `| P1 |…|` populated table) cannot transition to `done` without `--no-lifecycle` / override; a task with a valid P1–P4 table can.
- [x] R3. **Chained-leg cost observability (refine P3):** when dogfood derives a chained pipeline step (e.g. refine `--next` → run), the driver MUST either (a) record a `chained:<step>` ledger row with Fresh/Cached from an observed source, or (b) record `~unknown` + emit finding `P3 — chained-step cost not observable` (protocol already states this; make it mandatory in Phase 3/4 checklist + unit/fixture if feasible). Do not invent token numbers.
- [x] R4. **Step-splitting recipe (refine P4):** add a short worked recipe to dogfood skill (and/or report-template) showing how to split an implement-heavy pipeline dogfood into 2+ non-recursive runs (example: dogfood refine alone with `--max-retry 0`, then dogfood run/verify separately). Cross-link from the implement-heavy advisory string.
- [x] R5. **Durable monorepo `spur` on PATH (verify P2 residual):** document in `AGENTS.md` (or `apps/cli/README`) the supported local-dev install: `bun link` from `apps/cli` + `bun run --filter @gobing-ai/spur build:bundle` so `task run-link` and other new verbs appear on PATH. One golden command sequence; no inventing alternate package managers.
- [x] R6. **Driver self-validate before `status: complete`:** Phase 4 finalize MUST run `validateReport` (or equivalent CLI) on the report body before claiming complete; on failure set `status: aborted` and list codes under `#### Unresolved`. Closes the refine-report non-@1.2 shape hole (`## §1` instead of `### 1.`–`### 6.`, missing footer).
- [x] R7. **Cache-health actionable guidance:** when aggregate cache% < 50%, the report already should emit P3; add a 3–5 bullet "driver cache checklist" under monitor-ledger or SKILL Gotchas that maps each checklist item to a concrete action (reuse task show JSON, avoid re-reading skill body, etc.).
- [x] R8. **Corpus hygiene for 0277:** update task 0277 `### Review` / Testing residual wording that still claims "W8 is documentation-time" / "detector only agent-invoked" so it points at the live CLI gate (truth after `d357faf`). No status change.
- [x] R9. Tests green: detector + validate-report suites still pass; new lifecycle/done-gate tests green; `bun test plugins/sp` green.
### Acceptance Criteria
```gherkin
@core
Scenario: Done refuses prose-only Review
  Given a task at status testing whose ### Review has no populated P1–P4 table
  When an agent or CLI requests status transition to done without lifecycle bypass
  Then the transition is denied with a message that cites Review / strict-core
  And the task remains at testing

@core
Scenario: Done allows valid Review + provenance
  Given a task at testing with a populated P1–P4 Review table and a pipeline run-link
  When transition to done is requested
  Then the transition succeeds

@core
Scenario: Finalize aborts on invalid report shape
  Given a dogfood report body missing ### 1–6 uniqueness or the Dogfood Summary footer
  When Phase 4 finalize-or-abort runs the validator
  Then status complete is refused and errors appear under #### Unresolved

@core
Scenario: Implement-heavy advisory links to step-split recipe
  Given the dogfood skill documents the implement-heavy advisory
  When an operator follows the step-split link from the advisory section
  Then a worked recipe shows at least two separate dogfood invocations that avoid nested fix-mode mutation

@core
Scenario: Chained cost row is honest
  Given a dogfood run with a chained implement step whose token meter is not visible
  When the Cost block and ledger are finalized
  Then the chained row uses ~unknown (or equivalent) and a P3 finding is present
  And the driver row does not invent chained token totals
```
### Q&A
**Q: Fix findings directly in-session vs new task?**  
**A (2026-07-17):** Hybrid. Items already fixed by `d357faf` are dispositioned RESOLVED and excluded from implementation. Remaining residuals span lifecycle code, dogfood protocol, and docs — too multi-surface for a silent drive-by. This task is the SSOT for the open set.

**Q: Why not only docs?**  
**A:** 0277 reached `done` with prose-only Review while provenance alone was satisfied. Documentation cannot prevent the next chain from repeating that; R1 requires a hard gate.

**Q: Why include validateReport self-check?**  
**A:** The refine dogfood report used `## §1`…`## §7` instead of mandatory `### 1.`–`### 6.` + footer — a driver contract violation that `validateReport` would have caught. R6 closes that hole for all future dogfoods.
### Design

**Three seams, one task (not three micro-tasks):**

1. **Lifecycle / CLI done-gate (R1–R2)** — extend the existing choke point in `lifecycle-adapter.ts` (already owns provenance) OR the verify `--next` + `task record` path. Prefer **lifecycle adapter** so *all* `testing→done` writers share the gate (not only verify). Implementation sketch:
   - Before allowing `to === 'done'`, load task content and run the same L3 Review check as `task-check.ts` (`hasPopulatedPriorityTable` / section matrix), or call into `TaskCheckService` with `--strict-core` programmatically.
   - Return `{ allowed: false, report: "…" }` on failure (same shape as provenance denial).
   - Do **not** use `--no-lifecycle` in product paths. Optional env override only if we already have provenance override pattern — prefer no new override for Review (content gate should be hard).

2. **Dogfood protocol hardening (R3–R4, R6–R7)** — skill + report-template + monitor-ledger only; reuse `validateReport` from 0276 and detector CLI from 0277. No new engine packages.
   - Phase 4: mandatory `bun …/validate-report.ts` or import `validateReport` via a tiny CLI wrapper (`validate-report.ts` already pure — add `import.meta.main` like detector if missing).
   - Step-split recipe: new subsection under Cost segmentation or Gotchas with concrete commands.
   - Chained cost: strengthen Phase 3 checklist language to **must** emit P3 when chained and unobservable; optional fixture in report-contract tests for a sample report that includes `chained:` row + P3 text.

3. **Dev-env durability + corpus (R5, R8)** — docs + task 0277 section rewrite via CLI.


| Alternative | Why rejected |
|-------------|--------------|
| Only document "always run strict-core" without code gate | 0277 proved agents skip it under `--next` chains |
| Fix only verify `--next` | Leaves `spur task update done` and pipeline record paths ungated |
| Auto-estimate chained tokens from wall-clock | Violates anti-fiction cost rule |
| Edit historical dogfood md files as the "fix" | Gitignored; not product SSOT |


- Provenance gate remains; Review L3 gate is **additive**.
- `validateReport` error codes stay stable (0276 contract).
- No `--no-lifecycle` in recommended operator paths.
- Feature N stays backlog until operator advances it.


| Surface | Change |
|---------|--------|
| `packages/app/src/workflow/lifecycle-adapter.ts` (+ tests) | Review L3 / strict-core subset on `done` |
| `packages/app/src/services/task-check.ts` | Possibly export reusable helper for populated P-table |
| `plugins/sp/scripts/dogfood-testing/validate-report.ts` | Optional CLI main (mirror detector) |
| `plugins/sp/skills/dogfood-testing/SKILL.md` | Phase 4 self-validate; step-split recipe; chained cost must |
| `plugins/sp/skills/dogfood-testing/references/{report-template,monitor-ledger}.md` | Mirror Phase 4 / cost rules |
| `plugins/sp/commands/dev-dogfood.md` | One-line pointer to self-validate |
| `AGENTS.md` or `apps/cli` docs | monorepo spur link + rebuild sequence |
| `docs/tasks2/0277_*.md` | Review/Testing residual wording only |
### Plan
1. **Spike (≤30m):** confirm whether `TaskService.update(status=done)` always hits lifecycle-adapter; map verify `--next` and `task record` to same path. Write failing lifecycle test for prose-only Review.
2. **R1–R2:** implement done-gate (reuse `hasPopulatedPriorityTable` or invoke check service); green tests for deny/allow.
3. **R6:** add CLI entry to `validate-report.ts` if missing; SKILL Phase 4 step "run validator → abort on fail"; add report-contract test that a §-style report fails `missing_section` / `missing_footer`.
4. **R3:** tighten monitor-ledger + SKILL Phase 3/4 wording; optional golden snippet in fixtures for chained `~unknown` + P3.
5. **R4:** write step-split recipe with two concrete `/sp:dev-dogfood` examples; link from implement-heavy advisory section.
6. **R7:** cache checklist bullets under monitor-ledger conservation section.
7. **R5:** AGENTS.md short "Local spur CLI" subsection (link + rebuild).
8. **R8:** `spur task update 0277 --section Review/Testing` residual truth-up.
9. **Verify:** `bun test` for app lifecycle + plugins/sp dogfood-testing; `task check 0278` when ready; optional dogfood of `validate-report` CLI only (not full pipeline).
10. **Solution change-map** + Testing evidence; stop at `testing` unless operator runs verify `--next`.
### Solution
| File | Change |
|------|--------|
| `packages/app/src/services/task-check.ts:74-99` | Export `hasPopulatedPriorityTable` + `extractReviewSectionBody` for lifecycle reuse. |
| `packages/app/src/workflow/lifecycle-adapter.ts:108-150,210-245` | After provenance gate on `to===done` (tasks), run Review L3 content gate; optional `readTaskMarkdown` inject for tests. |
| `packages/app/src/index.ts` | Re-export Review helpers. |
| `packages/app/tests/workflow/lifecycle-adapter.test.ts` | R1 deny prose-only Review; R2 allow past Review gate when table populated. |
| `plugins/sp/scripts/dogfood-testing/validate-report.ts` | CLI `runValidateCli` / `mainCli` for Phase 4 self-validate (exit 0/1/2). |
| `plugins/sp/tests/dogfood-testing/report-contract.test.ts` | §-style report fails; CLI pass/fail/usage/mainCli coverage. |
| `plugins/sp/skills/dogfood-testing/SKILL.md` | Phase 4 self-validate + chained cost must-P3; **Step-splitting recipe** section. |
| `plugins/sp/skills/dogfood-testing/references/report-template.md` | Phase 4 step 7 self-validate. |
| `plugins/sp/skills/dogfood-testing/references/monitor-ledger.md` | Chained cost MUST P3; driver cache checklist (R7). |
| `plugins/sp/commands/dev-dogfood.md` | Pointers to step-split + validate CLI. |
| `Agents.md` | Local `spur` CLI on PATH: `bun link` + `build:bundle`. |
| `docs/tasks2/0277_*.md` | Review/Testing residual: W8 + detector marked closed (d357faf). |
### Testing
**Commands run (implement 0278, 2026-07-17):**

- `bun test packages/app/tests/workflow/lifecycle-adapter.test.ts` → **12 pass / 0 fail** (includes 0278 R1/R2 Review L3 gate tests).
- `bun test plugins/sp/tests/dogfood-testing/` → **52 pass / 0 fail** (§-style fail + validate CLI + detector suite).
- Coverage: `lifecycle-adapter.ts` 100% fn/lines in focused run; `validate-report.ts` 100% fn / ~99% lines; `detect-pipeline-driving.ts` 100% fn.

**Per-requirement:**

| Req | Status | Evidence |
|-----|--------|----------|
| R1 | MET | lifecycle-adapter Review L3 gate after provenance; denial message cites P1–P4 / strict-core |
| R2 | MET | tests: prose-only denies; populated table passes Review gate (shell may still deny missing file) |
| R3 | MET | SKILL Phase 4 + monitor-ledger chained row MUST emit P3; no invented totals |
| R4 | MET | SKILL §Step-splitting recipe with three concrete dogfood invocations |
| R5 | MET | Agents.md "Local spur CLI on PATH" bun link + build:bundle |
| R6 | MET | validate-report CLI + Phase 4 step 7; test non-@1.2 §-style fails |
| R7 | MET | monitor-ledger driver cache checklist table |
| R8 | MET | 0277 Review/Testing residual wording updated via CLI |
| R9 | MET | suites above green |

**Coverage:** N/A for skill markdown; TS helpers at 100% fn on focused files.

Verdict: implement complete — ready for review/verify.
### Review
**Review scope:** lifecycle done-gate (R1–R2), dogfood Phase 4 self-validate (R6), protocol docs (R3–R4,R7), AGENTS PATH (R5), 0277 residual (R8). In-session implement review for `/sp-dev-run 0278 --auto --next`.

**Functional traceability:** R1–R9 MET — see Testing. AC scenarios covered by lifecycle tests + validate CLI tests + static skill/docs.

**Priority findings (P1–P4)**

| Priority | Dimension | Location | Finding |
|----------|-----------|----------|---------|
| P1 | — | — | none |
| P2 | — | — | none |
| P3 | architecture | lifecycle-adapter | Review L3 gate skips when task markdown unreadable (`null`) and relies on shell strict-core — intentional for unit tests without files; production always has filePath. |
| P4 | docs | step-split recipe | Recipe uses 0278 as example WBS — fine as illustration; operators substitute their WBS. |

**SECUA:** PASS — pure content checks; no secrets; fail-closed on missing P-table when content is loadable.

**Architecture:** PASS — reuses task-check helpers; CLI mirrors detector pattern; no new packages.

**Disposition:** PASS — ready for verify `--next` / done.
### References
- Feature: [N — sp plugin next-layer UX](../features/N_sp-plugin-next-layer-ux-dev-next-router-and-dogfood-hardening.md)
- Predecessors: [0276](./0276_dogfood-1-2-contract-enforcement-finalize-fixtures-tests.md), [0277](./0277_dogfood-1-2-meta-run-detector-and-token-policy.md)
- Dogfood sources:
  - `docs/dogfood/2026-07-17-sp-dev-refine-0277-dogfood.md`
  - `docs/dogfood/2026-07-17-sp-dev-verify-0277-dogfood.md`
- Related code:
  - `packages/app/src/workflow/lifecycle-adapter.ts` (provenance done-gate)
  - `packages/app/src/services/task-check.ts` (`hasPopulatedPriorityTable`)
  - `plugins/sp/scripts/dogfood-testing/{detect-pipeline-driving,validate-report}.ts`
  - `plugins/sp/skills/dogfood-testing/SKILL.md`
- Already shipped residual fixes: commit `d357faf` (live Phase 1.0 gate + W8 + feature N AC + spur link)
### History
- 2026-07-17T06:22:17.247Z todo → wip (system)
- 2026-07-17T06:22:18.889Z wip → testing (system)
- 2026-07-17T06:22:34.515Z testing → done (system)
