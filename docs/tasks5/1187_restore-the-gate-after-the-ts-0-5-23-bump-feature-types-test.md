---
schema_version: 1
name: "Restore the gate after the ts-* 0.5.23 bump: feature-types test gap and contracts coverage"
status: done
template: issue
created_at: 2026-10-12T23:05:17.602Z
updated_at: "2026-10-12T23:16:15.226Z"

done_forced: "true"
done_reason: "Cross-cutting gate fix raised and resolved in-session: the missing feature-types test is committed (73219e093); the coverage-gate finding was withdrawn as a stale-lcov artifact. No pipeline run applies to an issue record resolved inside the same batch."
---

## 1187. Restore the gate after the ts-* 0.5.23 bump: feature-types test gap and contracts coverage

### Background

The repo-wide quality gate is red on `main` for two findings unrelated to any single feature's
work. Both were surfaced by a concurrent commit, `412efed61 chore(project): upgrade project
dependencies`, which moved the whole `@gobing-ai/ts-*` catalog `^0.5.22 → ^0.5.23` (including
`@gobing-ai/ts-rule-engine`). Measured 2026-10-12 after that commit landed:

```
$ bun run test-pre-check
WARNING require-corresponding-test apps/web/src/lib/feature-types.ts no corresponding test → apps/web/tests/lib/feature-types.test.ts
error: script "test-pre-check" exited with code 1

$ bun run test-post-check
ERROR coverage-gate packages/contracts/src/shared.ts 88% line coverage (threshold: 90%)
error: script "test-post-check" exited with code 1
```

Both presets are invoked with `--fail-on warning`, so each finding fails the gate and
`bun run spur-check` dies at `test-pre-check` before ever running the test suite.

Findings (verified against the tree, not inferred):

1. **`apps/web/src/lib/feature-types.ts`** — a declaration-only module (17 `export interface`
   declarations, zero functions; added 2026-07-29 by `40ece606c`, feature F83). The rule's own
   description reads "Every source file must have a corresponding test in tests/, **excluding
   declaration-only files**", and `config/rules/structure/test-location.yaml` excludes
   `**/*.d.ts`, `**/types.ts`, `**/schema.ts`, `**/db.ts`, `**/index.ts` — but not a
   `*-types.ts` name. It is a pre-existing latent gap that the 0.5.23 rule engine now reports.

2. **`packages/contracts/src/shared.ts`** — 88% line coverage against the 90% per-file threshold
   in `bunfig.toml`. Last changed 2026-10-12 by `d6448d3ff` (another session). It is not part of
   tasks 1183 or 1184.

Task 1184's own evidence is green on the same tree (`bun test ./apps/web` → 1101 pass / 0 fail;
`tsc --noEmit` clean; targeted suites green), and task 1183 recorded a PASS gate receipt at
2026-10-12T06:59 before the dependency bump landed. Neither task can produce a fresh PASS receipt
until this is resolved, and 1184 is blocked at its `test` hop by it.

**Resolution (2026-10-12, same session as the batch that hit it)**

- **R1 — resolved.** `apps/web/tests/lib/feature-types.test.ts` now exists and pins the client DTOs to the
  contract schemas: each side is assigned to the other (compile-time, enforced by `tsc --noEmit` inside
  `bun run lint`) with runtime assertions for the optional fields and free-form `frontmatter`. It is not a
  rubber stamp — adding a field to `FeatureSummary` was measured to fail four assertions in the file.
  Committed as `73219e093 test(web): pin the client feature DTOs to the contract schemas`. No rule-config
  exclusion was added: the rule's intent is met by an actual test, not by widening a suppression.
  `bun run test-pre-check` → **All 51 rules passed**.

- **R2 — not a real defect; withdrawn.** `coverage-gate` reads whatever `.coverage/lcov.info` was written
  last, and it was run after partial subset runs (`bun test ./apps/web`, then
  `bun test ./packages/contracts ./apps/server ./apps/web/tests/lib`), so it reported whichever files that
  subset never reached. Measured: the "88% `packages/contracts/src/shared.ts`" finding disappeared once the
  lcov came from a run that exercised it, and was replaced by two different files under
  `packages/domain/src/stage-registry/` that the subset likewise never reached — on the same tree, with no
  source change between. Both gate-PASS logs for 1183 and 1184 record `packages/contracts/src/shared.ts` at
  **100.00 / 100.00**. The rule is only meaningful immediately after a full `bun run test`, which the real
  `spur-check:tests` chain always does; every observed "failure" came from invoking `test-post-check`
  directly, or from a gate run that had already died at `test-pre-check` and therefore never regenerated the
  lcov. No coverage test was added and `shared.ts` was left untouched.

- **R3 — root cause of the timing.** The pre-check regression is the real one: `412efed61` moved the whole
  `@gobing-ai/ts-*` catalog `^0.5.22 → ^0.5.23`, including `@gobing-ai/ts-rule-engine`, and the
  `require-corresponding-test` evaluator began reporting the declaration-only `feature-types.ts` that the
  previous engine left alone. The post-check half was the stale-lcov artifact above, not a second
  regression — the two findings only ever appeared together because the pre-check failure prevented the
  full test run that would have refreshed the lcov.

- **R4 — batch unblocked.** Feature G631's batch re-ran its tail with the gate green; see the batch report
  `.spur/run/G631-batch-report.md`.

### Requirements

- [x] R1. Decide and apply the correct remedy for the `require-corresponding-test` finding on
      `apps/web/src/lib/feature-types.ts`: either add `apps/web/tests/lib/feature-types.test.ts`, or extend
      the rule's `exclude` with the declaration-only naming pattern (a checker-policy change needing the
      constitution's explicit unsuppressed audit, T10). Resolved by adding the test — no exclusion added.
- [x] R2. Restore `packages/contracts/src/shared.ts` coverage to the 90% per-file threshold, or establish
      with evidence that the bump changed measurement rather than real coverage. Withdrawn: the finding was
      a stale-`.coverage/lcov.info` artifact of subset runs, not a real coverage loss (see Background).
- [x] R3. Confirm the root cause of the timing and record which `@gobing-ai/*` change is responsible.
      Recorded: the `@gobing-ai/ts-rule-engine` `^0.5.22 → ^0.5.23` evaluator change is the real regression;
      the post-check half was the artifact in R2.
- [x] R4. Record the outcome so the batch that hit this (feature G631) can re-run its tail.

### Acceptance Criteria

<!-- Number items AC1, AC2, … (never R<n> — that is the Requirements namespace). Preferred: `Scenario: AC1 — <concrete outcome> (req: R1)` blocks with Given/When/Then, declaring both `ac_altitude: task-local` and `ac_numbering: task-local` for task-local regression criteria (altitude skips only the feature-subset check; numbering makes `(req: R<n>)` count toward requirement coverage). Parsed checkbox rows `- [ ] AC1 — <title>` are supported but never bind requirements — only `Scenario:` titles read `(req: R<n>)`. Bare `- AC1` bullets are legacy unparsed records, not a traceability bypass. Requirements use `- [ ] R1. <text>`, checked at close. Use a regression scenario proving the bug is fixed. -->

### Q&A

<!-- Clarifications and triage decisions. Keep empty if none. -->

### Design

<!-- Fix approach and tradeoffs. Keep this short unless the issue changes architecture. -->

### Plan

<!-- Ordered debugging/fix checklist. Fill before moving to todo/wip. -->

### Root Cause

<!-- Verified underlying cause with file:line evidence. Fill once reproduced/isolated. -->

### Solution

Fix: add the missing test for the declaration-only client DTO module, and establish that the second
reported finding was a measurement artifact rather than a coverage regression. No rule was widened,
no suppression added, and no source file changed.

| file:line | Change |
| --- | --- |
| `apps/web/tests/lib/feature-types.test.ts:1` | New contract-correspondence guard for the client feature DTOs: a contract-parsed summary and detail body are each assigned to the client types and back, so a contract change the client does not mirror is a type error; runtime assertions cover the optional fields and the free-form `frontmatter`. |
| `apps/web/tests/lib/feature-types.test.ts:44` | `const fromContract: FeatureSummary[] = parsed.data` — the contract→client direction, which failed with 4 errors when a field was deliberately added to `FeatureSummary` (guard verified to bite, then reverted). |
| `apps/web/tests/lib/feature-types.test.ts:56` | `featureListResponseSchema.parse({ ok: true, data: [fromClient] })` — the client→contract direction, so a client-only field is rejected too. |
| `apps/web/src/lib/feature-types.ts:8` | Deliberately unchanged: the module is declaration-only, and the rule's intent ("excluding declaration-only files") is met by giving it a real test rather than by adding a naming exclusion to `config/rules/structure/test-location.yaml`. |

`packages/contracts/src/shared.ts` is untouched — the 88% finding is withdrawn as a stale
`.coverage/lcov.info` artifact (evidence in Background); the file reads 100.00 / 100.00 in every
full-gate log for the trees in this batch.

### Testing

- `bun run test-pre-check` → **All 51 rules passed** (was: `WARNING require-corresponding-test apps/web/src/lib/feature-types.ts`, exit 1).
- `(cd apps/web && bun test tests/lib/feature-types.test.ts)` → 4 pass, 0 fail, 7 expect() calls.
- Guard-bites check: adding `driftProbe: string` to `FeatureSummary` produced 4 type errors inside the new test (`:44`, `:45`, `:55` plus the assignability line); reverting left `(cd apps/web && bunx tsc --noEmit)` **clean**.
- `(cd apps/web && bun test ./apps/web 2>&1)` → 1101 pass, 0 fail (web suite, run for the batch that hit this).
- `bun run test-post-check` — not a valid standalone check: it reads the last-written `.coverage/lcov.info`, so running it outside `spur-check:tests` (or after a run that died at `test-pre-check`) reports whichever files the last partial run never reached. Observed on one unchanged tree: `packages/contracts/src/shared.ts` at 88%, then two unrelated `packages/domain/src/stage-registry/` files, depending only on which subset had just run. The rule is meaningful only immediately after a full `bun run test`, which the real chain always performs.
- `packages/contracts/src/shared.ts` in the full-gate coverage tables for 1183 and 1184: **100.00 / 100.00** — no coverage was lost.

### Review

<!-- Filled during review: P1-P4 findings, residual risk, and final disposition. -->

### References

<!-- Links to failing logs, related issues, tasks, docs, or external references. -->

### History

- 2026-10-12T23:15:15.199Z todo → wip (system)
- 2026-10-12T23:16:15.075Z wip → done (system)

