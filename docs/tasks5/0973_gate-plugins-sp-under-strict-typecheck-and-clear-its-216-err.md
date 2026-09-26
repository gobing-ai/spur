---
schema_version: 1
name: Gate plugins/sp under strict typecheck and clear its 216 errors
status: todo
template: feature-impl
created_at: 2026-09-26T07:23:27.739Z
updated_at: "2026-09-26T07:31:45.486Z"
feature_id: A33

---

## 0973. Gate plugins/sp under strict typecheck and clear its 216 errors

### Background

Found during the 2026-09-26 `/sp:dev-review-session --triage`. Root `bun run typecheck` used to run only
`bun run --filter '*' typecheck`, which covers the workspaces (`apps/*`, `packages/*`) and nothing else. That left
`scripts/` and `plugins/sp/` without a strict typecheck, so violations of `noUncheckedIndexedAccess` (from
`tooling/typescript/base.json`) accumulated there unseen.

The triage closed the `scripts/` half: root `typecheck` now also runs `tsc -p scripts/tsconfig.json --noEmit`, with 0
errors. This task leaves `scripts/` alone and covers `plugins/sp/`.

**Baseline (measured 2026-09-26, TypeScript 6.0.3, bun 1.3.14).** The measurement used a temporary tsconfig that
extends `tooling/typescript/base.json`, sets `types: ["bun"]` and includes `plugins/sp/**/*.ts`. It reports
**216 errors**:

- By code: TS2532 65, TS2345 61, TS2322 35, TS18048 17, TS2769 15, TS2307 7, TS2339 6, TS2454 3, TS2741 2, TS2367 2,
  TS6133 1, TS2783 1, TS2554 1.
- Almost all of them are the mechanical fallout of `noUncheckedIndexedAccess`: TS2532, TS18048 and TS2345/TS2322
  on `T | undefined`.

**Root causes of the non-mechanical errors.** Each was verified by reading the code and, for the TS2307s, by trial
edits that were then reverted:

1. **TS2307 ×6.** `scripts/feature-verification-steps.ts:48-53` uses `typeof import('../../packages/app/src/...')`.
   From `plugins/sp/scripts/` that path is one level short; the correct prefix is `../../../packages/app/src/...`.
   These are type-only positions (`typeof import(...)` inside an `interface`), which Bun erases at runtime, so
   **runtime behavior is unaffected**. The trial fix removed all 6 errors and introduced none.
2. **TS2307 ×1.** `scripts/inline-run-setup.ts:340` has `import type { WorkflowActionTraceWriter } from
   '@gobing-ai/spur-app'`. The import is type-only, which the standalone contract allows (and
   `tests/inline-run-close-reason.test.ts:30-32` pins it). It fails only because the repo root `node_modules/@gobing-ai/`
   does not link `spur-app`; only `spur` and `spur-config` are linked there.
   - Trial fix: a tsconfig `paths` mapping `"@gobing-ai/spur-app": ["<repo>/packages/app/src/index.ts"]`, with no
     `baseUrl`. TS 6 deprecates `baseUrl` and errors with TS5101.
   - The mapping resolves the import, and that exposes 2 real errors: `inline-run-setup.ts:430`
     (TS2345) and `:435` (TS2322), where a `string` status is passed where the engine's `WorkflowStatus` is expected.
3. **TS2322/TS2367 ×3.** The `Violation.kind` union in `scripts/script-contract-check.ts:39-45` is missing
   `'gobing_ai_import'`. Rule 5 at `:331` emits that value, and `tests/script-contract-check.test.ts:95,112` compare
   against it. At runtime the rule works; only the type is stale.
4. **TS2554 ×1.** `tests/surface-drift-inventory.test.ts:434` closes a `describe(...)` block (opened at `:413`) with a
   third argument, `60_000`. In bun-types 1.3.14, `Describe` is `(label, fn)` only, so **that timeout is probably
   ignored**. That is a MEDIUM-confidence reading: the type says so, but it was not confirmed at runtime. If it is
   ignored, the three live-spawn `runCli` tests in that block run under the default 5 s test timeout.
5. **TS6133 ×1.** `tests/residual-scan.test.ts:391` has an unused `_boxId`. The comment on the next line says the box
   approach was abandoned.

After fixes 1 and 2 (with fix 2's mapping), **211 errors remain**, all inside `plugins/sp/`. Their per-file counts
are in `### Design`.

### Requirements

- **R1** Add `plugins/sp/tsconfig.json`:
  ```json
  {
      "extends": "../../tooling/typescript/base.json",
      "compilerOptions": {
          "types": ["bun"],
          "paths": { "@gobing-ai/spur-app": ["../../packages/app/src/index.ts"] }
      },
      "include": ["**/*.ts"]
  }
  ```
  Without `baseUrl`, `paths` resolves relative to the tsconfig's directory, and TS 6 rejects `baseUrl` (TS5101).
  Exclude nothing unless a file has a proven reason; if you exclude one, record the reason in `### Solution`.
- **R2** Change the root `package.json` `typecheck` to
  `bun run --filter '*' typecheck && tsc -p scripts/tsconfig.json --noEmit && tsc -p plugins/sp/tsconfig.json --noEmit`.
- **R3** In `plugins/sp/scripts/feature-verification-steps.ts:48-53`, change every `import('../../packages/app/src/`
  to `import('../../../packages/app/src/`. These are type-only positions; do not change any runtime import.
- **R4** Add `| 'gobing_ai_import'` to the `Violation.kind` union in `plugins/sp/scripts/script-contract-check.ts:39-45`.
- **R5** In `plugins/sp/scripts/inline-run-setup.ts`, narrow the trace status so no cast is needed:
  - Make `ACTION_STATUSES` (`:337`) a typed set of `'done' | 'failed'`.
  - Add a type guard, e.g. `isActionStatus(s: string): s is 'done' | 'failed'`.
  - Use the guard at the existing validation point (`:634`, `if (!ACTION_STATUSES.has(status)) usage();`).
  - Type `TraceModeInput.status` as `'done' | 'failed'`.
  - `WorkflowStatus` (`'running' | 'done' | 'failed' | 'paused' | 'interrupted'`, from `ts-dual-workflow-engine`)
    is not re-exported from `@gobing-ai/spur-app`, so do not import it; the literal union is assignable to it.
- **R6** In `plugins/sp/tests/surface-drift-inventory.test.ts`, remove the `, 60_000` describe argument at `:434`.
  Pass `60_000` as the third argument to each of the three `test(...)` calls in the `runCli` block (`:413-433`)
  instead, so the timeout actually applies.
- **R7** Delete the unused `_boxId` declaration at `plugins/sp/tests/residual-scan.test.ts:391`. Keep the explanatory
  comment only if it still reads correctly without the line.
- **R8** Fix the remaining ~211 mechanical errors with no weakening:
  - Forbidden: `// @ts-ignore`, `// @ts-expect-error`, `as any`, `noUncheckedIndexedAccess: false`, and
    `skipLibCheck` changes.
  - Use the same idioms as the scripts triage:
    - `?.` or `?? fallback` on indexed access.
    - `const m = re.exec(s)?.[1]; if (!m) continue;` for regex captures.
    - `for (const [i, v] of arr.entries())` instead of `arr[i]` inside index loops.
    - Explicit tuple return types on `.map` callbacks that feed `new Map(...)`.
    - In tests, `expect(x).toBeDefined()` followed by `x!` is acceptable. `arr[0]?.field` in an assertion is
      preferred.
  - A non-null `!` in non-test code needs an earlier guard that makes presence certain, plus a one-line
    comment saying why.
- **R9** Behavior must not change. The plugin tests and `plugin-smoke` pass before and after. No test is skipped,
  deleted or loosened to go green.

### Acceptance Criteria

- [ ] `plugins/sp/tsconfig.json` exists as specified in R1, and `tsc -p plugins/sp/tsconfig.json --noEmit` exits 0.
- [ ] Root `bun run typecheck` runs the workspace, `scripts/` and `plugins/sp/` legs and exits 0.
- [ ] Gate proof: temporarily append `export const __probe: number = 's';` to `plugins/sp/scripts/quality-gate.ts`,
      confirm `bun run typecheck` exits non-zero, then remove the probe.
- [ ] `git diff main -- plugins/sp | rg '^\+.*(@ts-ignore|@ts-expect-error|as any)'` prints nothing.
- [ ] `rg -n "import\('\.\./\.\./packages" plugins/sp/scripts/feature-verification-steps.ts` prints nothing.
- [ ] `(cd plugins/sp && bun test)` passes with the same test count as on `main` before this task, and 0 fail.
- [ ] `bun run plugin-smoke` prints PASS.
- [ ] `bun run spur-check` is green.

### Q&A

<!-- CLOSED decisions from refinement: what was chosen and why, what was deferred and on what
     condition. Not a parking lot for open questions — an unanswered question here means the task
     is not ready to hand off. Keep empty if none. -->

#### Q&A entry — 2026-09-26T07:31:29.014Z

- **Q: Should tests be excluded from the plugin tsconfig to cut the work roughly in half?** A: No. The
  `scripts/` leg includes its tests, and test files are where the stale-type bugs surfaced (R4, R6).
- **Q: Import `WorkflowStatus` from the engine package for R5?** A: No. plugins/sp must not depend on engine
  internals. A local literal union narrowed by the existing validation is enough and is assignable.
- **Q: Is the R3 path change a runtime change?** A: No. `typeof import(...)` exists only at the type level. The
  script's runtime module loading is the `ModuleMode` bundle/source switch, which this task does not touch.
- **Q: What if a fix appears to need a behavior change?** A: Stop, record it in `### Solution` as a finding, and
  keep the type fix behavior-preserving. File the behavior change as a follow-up under A33.

### Design

**Shape.** Mirror the `scripts/` leg added by the triage. That means a standalone tsconfig per non-workspace
TypeScript tree, chained into root `typecheck`.

Rejected alternatives:
- **Make plugins/sp a Bun workspace.** It is an installed standalone plugin (ADR-065, `sp-plugin-standalone` rule),
  not a package. Making it a workspace would pull in the catalog and invite value imports of `@gobing-ai/*`.
- **Relax `noUncheckedIndexedAccess` for plugins/sp.** That recreates the blind spot this task closes.
- **Link `@gobing-ai/spur-app` at the root with a root devDependency.** That is a dependency change for a
  type-only resolution. The `paths` mapping is local to the plugin's tsconfig and has no runtime effect.

**Residual errors per file** (after R3 plus the R1 mapping; 211 total). Work top-down:

| File | Errors |
| --- | ---: |
| scripts/validate-flag-contracts.ts | 32 |
| tests/flag-contract-parity.test.ts | 24 |
| tests/skill-structure.test.ts | 17 |
| scripts/validate-commands.ts | 14 |
| tests/command-contract.test.ts | 12 |
| scripts/history-anatomy-cache.ts | 7 |
| tests/stage-registry-parity.test.ts, tests/helpers/cli-surface.ts, scripts/wrapup-drift-probe.ts, scripts/task-evidence-precheck.ts, scripts/dogfood-testing/validate-report.ts | 6 each |
| tests/roles.test.ts | 5 |
| tests/wrapup-drift-probe.test.ts, tests/inline-pipeline-driver.test.ts, tests/daily-summary/daily-summary.test.ts, tests/cli-surface-parity.test.ts, scripts/pr-reviewing.ts | 4 each |
| tests/history-anatomy-cache.test.ts, tests/command-flag-parity.test.ts, scripts/workflow-step-profile.ts, scripts/verify-answer-lint.ts, scripts/task-size-precheck.ts, scripts/script-contract-check.ts (R4), scripts/inline-run-setup.ts (R5), scripts/feature-sync-bounded.ts, scripts/daily-summary/daily-summary.ts | 3 each |
| tests/task-pipeline-resilience.test.ts, tests/stage-registry-adapter.test.ts, tests/script-contract-check.test.ts (R4), tests/pr-reviewing.test.ts, scripts/residual-scan.ts, scripts/dogfood-testing/detect-pipeline-driving.ts | 2 each |
| tests/surface-drift-inventory.test.ts (R6), tests/routing-table-parity.test.ts, tests/residual-scan.test.ts (R7), tests/quality-gate.test.ts, tests/issue-finding-fallback.test.ts, tests/inline-run-setup.test.ts, tests/batch-preflight.test.ts, scripts/stage-registry-adapter.ts, scripts/quality-gate.ts, hooks/token-estimate.test.ts, hooks/context-post-tool.ts | 1 each |

Paths are relative to `plugins/sp/`. Refresh the list at any time with
`tsc -p plugins/sp/tsconfig.json --noEmit 2>&1 | rg -o '^plugins/sp/[^(]+' | sort | uniq -c | sort -rn`.

**Twin files.** Some `plugins/sp/scripts/*.ts` files have generated `.mjs` twins, checked by
`script-contract-check`. If a TS edit changes emitted JS, regenerate the twin the way the repo documents
(see `plugins/sp/scripts/` README or `script-contract-check.ts` messages); never hand-edit it. Type-only edits
usually leave the twin byte-identical, and `bun run plugin-smoke` or the script-contract check will say if not.

**Size and slicing.** The work is about 225 mechanical edits across 43 files. It can land as one commit if the
diff stays under about 700 lines. Otherwise split it into (a) R3–R7 plus `scripts/` and `hooks/`, then (b) `tests/`,
and wire R1 and R2 **only in the final slice**, so root `typecheck` is never red on `main`.

### Plan

1. Baseline: `(cd plugins/sp && bun test) 2>&1 | tail -5`. Record the pass and fail counts in `### Testing`. Run
   `bun run plugin-smoke`.
2. Create `plugins/sp/tsconfig.json` (R1). Run `tsc -p plugins/sp/tsconfig.json --noEmit | rg -c 'error TS'`. Expect
   about 217; `paths` resolves spur-app, which exposes the 2 R5 errors.
3. Apply R3, R4, R5, R6 and R7. Re-run tsc and expect about 208.
4. Work through the per-file table in `### Design`, starting with `scripts/`, then `hooks/`, then `tests/`. After
   each file, run its test from inside `plugins/sp` (e.g. `bun test tests/flag-contract-parity.test.ts`).
5. When tsc reports 0, apply R2 to root `package.json`.
6. Run the gates in the AC order: typecheck, gate probe, the no-suppression grep, plugin tests with counts equal to the
   baseline, `plugin-smoke`, `spur-check`.
7. Make one conventional commit: `chore(sp): gate plugins/sp under strict typecheck`. If sliced per `### Design`,
   make one commit per slice.

### Solution

<!-- Filled during implementation: file:line change map and concise rationale. -->

### Testing

<!-- Filled during verification: commands run, outcomes, coverage claim or N/A. -->

### Review

<!-- Filled during review: P1-P4 findings, residual risk, and final disposition. -->

### References

- `package.json` (`typecheck` script); `scripts/tsconfig.json` (template for R1); `tooling/typescript/base.json`
- `plugins/sp/scripts/feature-verification-steps.ts:48-53`; `plugins/sp/scripts/inline-run-setup.ts:337,340,430-435,634`
- `plugins/sp/scripts/script-contract-check.ts:39-45,331`; `plugins/sp/tests/script-contract-check.test.ts:95,112`
- `plugins/sp/tests/surface-drift-inventory.test.ts:413-434`; `plugins/sp/tests/residual-scan.test.ts:391`
- `node_modules/.bun/bun-types@1.3.14/node_modules/bun-types/test.d.ts:227-230` (`Describe` signature)
- AGENTS.md § Conventions (plugin standalone contract); ADR-065
- Triage source: the scripts-leg fixes made in the same session (uncommitted on `main` when this task was filed)

### History

- 2026-09-26T07:31:45.486Z backlog → todo (system)

