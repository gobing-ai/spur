---
name: expose_rule-engine_stopOnFirst_as_spur_rule_run_stop-on-first_flag
description: expose_rule-engine_stopOnFirst_as_spur_rule_run_stop-on-first_flag
status: Done
created_at: 2026-06-04T22:24:49.553Z
updated_at: 2026-06-04T22:24:53.008Z
folder: docs/tasks
type: task
feature-id: ""
priority: low
estimated_hours: 1
dependencies: ["ts-libs#0014"]
tags: ["spur","rule-engine","cli","stop-on-first"]
impl_progress:
  planning: done
  design: done
  implementation: done
  review: done
  testing: done
preset: simple
---

## 0017. expose_rule-engine_stopOnFirst_as_spur_rule_run_stop-on-first_flag

### Background

spur consumes @gobing-ai/ts-rule-engine@^0.3.1 (PUBLISHED dep, not workspace). The rule verdict already lives spur-side: apps/cli/src/commands/rule.ts parses --fail-on (default error) and RuleService.evaluate (packages/app/src/services/rule-service.ts:196) computes exitCode from findings vs failOn via SEVERITY_RANK. The --fail-on OVERRIDE already works and needs no change. ts-libs task 0014 adds an opt-in RuleEngine.evaluate(rules, cwd, { stopOnFirst }) traversal mode (break after first rule meeting a severity threshold) for the interactive find-first-breach-then-fix loop. This task exposes that engine capability as a spur CLI flag. HARD GATE: cannot start until ts-libs publishes a release whose ts-rule-engine version exposes stopOnFirst; spur must bump its ^0.3.1 dep to that version first.


### Requirements

- **R1**: Bump `@gobing-ai/ts-rule-engine` dep (and lockstep siblings) to the released version exposing `stopOnFirst`. → **Done when**: `package.json` range points at the release that ships the `stopOnFirst` param; `bun install` resolves; typecheck sees the 3rd `evaluate(rules, cwd, stopOnFirst?)` param.
- **R2**: Add `spur rule run --stop-on-first [<severity>]` flag in `apps/cli/src/commands/rule.ts` (default `'error'` when bare); parse + validate via the same path as `parseFailOn`. → **Done when**: `--stop-on-first` parses to `'error'`, `--stop-on-first warning` to `'warning'`, and an invalid value throws the same shape of error as `parseFailOn`; help text lists the flag.
- **R3**: Thread `stopOnFirst` into `RuleService.evaluate` (`rule-service.ts:173` engine call) and the verbose path (`rule-service.ts:331`). → **Done when**: the resolved severity reaches `engine.evaluate(rules, cwd, stopOnFirst)` in both verbose and non-verbose branches; omitting the flag passes `undefined` (exhaustive, unchanged).
- **R4**: `--stop-on-first` (TRAVERSAL) is orthogonal to `--fail-on` (VERDICT); document the distinction in CLI help and confirm they compose. → **Done when**: help text states stop-on-first halts evaluation early while fail-on thresholds the result; a test runs both together (stop early on first error, then exit-code computed from the partial findings via `--fail-on`).
- **R5**: Tests in `apps/cli` + `packages/app` rule-service for the new flag, including the stop-on-first × fail-on interaction. → **Done when**: new tests cover flag parsing (bare/with-severity/invalid), threading to the engine, and the compose case; all green.
- **R6**: Full gate + build green; no change to existing verdict logic. → **Done when**: spur's gate + build pass; `rule-service.ts:196` verdict computation is untouched; non-`--stop-on-first` runs behave identically (existing tests unmodified).


### Q&A

_Refined via `rd3:dev-refine 0017 --auto` (synthesis-only, no interactive Q&A). Decisions derived from existing Background/Solution:_

- **Q: Requirements format?** → Reformatted the dense single-paragraph requirements into a numbered list (R1–R6), each with a verifiable **"Done when"** acceptance clause.
- **Q: Constraints section?** → The scaffold has no `### Constraints` heading and the `tasks` CLI only writes existing sections; constraints (traversal-vs-verdict orthogonality, verdict-frozen, default-exhaustive, release gate, sibling-bump-with-0018) were synthesized into the **Design** section with a flag-plumbing sketch.
- **Q: Preset?** → `simple`. 1-2 files (`apps/cli/src/commands/rule.ts`, `packages/app/src/services/rule-service.ts`), ~20 LOC pure plumbing, low risk, single domain, no logic change; only the upstream release gate as a dependency. 3+ simple-column signals, 0 complex → simple.
- **Q: Key correctness guard?** → R4 pins the orthogonality: `--stop-on-first` (traversal) and `--fail-on` (verdict) must compose, not conflict — a test runs both together (stop early, threshold the partial list).
- **Open (deferred, non-blocking):** bare `--stop-on-first` defaults to `'error'` (recommend yes, mirrors `--fail-on`).
- **Status note:** remains **Blocked** on ts-libs#0014 release. If ts-libs 0014 and 0015 ship in one lockstep bump, 0017 and 0018 unblock together — do them as a single spur dep-bump + release.


### Design

**Nature of the change:** pure CLI plumbing — expose an engine capability (`stopOnFirst`, added in ts-libs#0014) as a spur flag. No new logic; the parameter already exists on `RuleEngine.evaluate` post-0014.

**Constraints / invariants:**
- **Two orthogonal axes — do NOT conflate.** `--stop-on-first` controls TRAVERSAL (stop evaluating rules early); `--fail-on` controls VERDICT (what severity sets exit code). They compose: stop early, then threshold the partial findings list. The CLI help must make this distinction explicit (R4).
- **Verdict logic frozen.** Must NOT touch `rule-service.ts:196` exit-code computation. This task only adds a traversal flag and threads it to the engine.
- **Default = exhaustive.** Omitting `--stop-on-first` passes `undefined` → today's full-scan behavior, zero change.
- **Hard release gate.** Cannot start until ts-libs publishes a release exposing `stopOnFirst` (task 0014); spur consumes PUBLISHED deps (`^0.3.x`), not workspace — bump first (R1).
- **Sibling dep-bump with 0018.** Task 0018 (EventBus subscription) bumps the same published ts-libs deps. If 0017 and 0018 land together: ONE dep-bump + ONE spur release instead of two — coordinate. (Note: 0018 needs the 0015 release, 0017 needs the 0014 release; if 0014 and 0015 ship in the same lockstep bump, both spur tasks unblock together.)
- **Gate non-negotiable.** spur's full gate + build must pass; no `--no-verify`, no skipped tests.

**Flag-plumbing sketch:**
```
// rule.ts
const stopOnFirst = parseStopOnFirst(stringFlag(flags, 'stop-on-first'));  // bare → 'error'
const result = await service.evaluate({ preset, failOn, stopOnFirst, file, rule, json, verbose, color });
// rule-service.ts:173 / :331
await engine.evaluate(rules, this.context.cwd, opts.stopOnFirst);
```

**Open (decide at implementation, non-blocking):** whether `--stop-on-first` with no value defaults to `'error'` (recommend yes — mirrors `--fail-on` default) or requires an explicit severity.


### Solution

~20 src + ~40 test, ~1hr, Low risk. Pure plumbing: flag parse (rule.ts) → option (RuleService) → engine param (already exists post-0014). No verdict logic change. Blocked-by: ts-libs 0014 release.


### Plan

1. Verify ts-rule-engine@0.3.2 exposes `stopOnFirst` on `evaluate()` — confirmed in engine.d.ts.
2. Add `parseStopOnFirst()` in `rule.ts` mirroring `parseFailOn()` — bare `--stop-on-first` → `'error'`, `--stop-on-first warning` → `'warning'`, invalid throws.
3. Add `stopOnFirst?: FailOnSeverity` to `RuleEvaluateOptions`, destructure in `evaluate()`, thread to both `engine.evaluate()` and `evaluateVerbose()`.
4. In `evaluateVerbose()`, break the per-rule loop when findings meet `stopOnFirst` threshold; emit stop message.
5. Update help text with `--stop-on-first` flag, traversal-vs-verdict distinction, restore `--verbose`.
6. Write 4 CLI flag tests (bare, with-severity, invalid, compose with fail-on) + 3 service tests (batch stop, composition, verbose stop message).


### Review

- **Verification verdict (2026-06-05, `rd3-dev-verify 0017 --auto --fix all --force`): PASS after fix pass.**
- **Finding fixed:** original stop-on-first tests proved parsing and a one-finding case, but did not fail if traversal ignored `stopOnFirst` in some branches. Strengthened the CLI composition test so `--stop-on-first warning --fail-on error` returns 0 only when traversal stops before a later error, and strengthened service tests so the second failing rule is skipped in batch and verbose paths.
- **R1 (dep bump):** Already satisfied — `@gobing-ai/ts-rule-engine@^0.3.2` in root catalog; `packages/app` resolves ts-rule-engine 0.3.2 and `RuleEngine.prototype.evaluate.length === 3`; engine.d.ts confirms `evaluate(rules, cwd, stopOnFirst?)`.
- **R2 (flag parsing):** `parseStopOnFirst()` added; bare flag reads `flags['stop-on-first'] === true` → defaults to `'error'`. Tests cover bare, string, invalid.
- **R3 (threading):** `stopOnFirst` flows through `RuleEvaluateOptions` → `engine.evaluate(filteredRules, cwd, stopOnFirst)` (non-verbose) and `evaluateVerbose(..., stopOnFirst)` → per-rule `engine.evaluate([rule], cwd)`.
- **R4 (orthogonality):** Help text explicitly distinguishes traversal from verdict. Composition test: `stopOnFirst='warning'` + `failOn='error'` → findings present but exit 0.
- **R5 (tests):** 7 new tests across CLI and service layers — strengthened during verification; all green (549 pass, 0 fail).
- **R6 (gate):** `bun run lint` clean, `bun run test` 549 pass, `bun run test-cf` 2 pass, `bun run build` success. Verdict logic at line 196 untouched.


### Testing

**CLI tests** (`apps/cli/tests/commands/rule.test.ts`):
- bare `--stop-on-first` defaults to error
- `--stop-on-first warning` parses valid severity
- invalid `--stop-on-first bogus` throws
- `--stop-on-first warning` + `--fail-on error` compose

**Service tests** (`packages/app/tests/services/rule-service.test.ts`):
- `stopOnFirst` stops batch evaluation after first finding at threshold; regression asserts the second failing rule is not evaluated
- `stopOnFirst × failOn` composition: stop on warning, fail only on error → exit 0
- `stopOnFirst` verbose emits "Stopping: first error+ finding reached." and does not start the second rule

Verification commands:
- `bun run lint` — PASS
- `bun run test` — PASS, 549 pass / 0 fail
- `bun run test-cf` — PASS, 2 pass / 0 fail
- `bun run build` — PASS
- Focused suites (`apps/cli/tests/commands/rule.test.ts`, `packages/app/tests/services/rule-service.test.ts`) — 34 pass / 0 fail; command exits nonzero only because Bun applies repo-wide coverage thresholds to focused runs.

Coverage: rule-service.ts 99.71% lines, rule.ts 97.89% lines.


### Artifacts

| Type | Path | Agent | Date |
| ---- | ---- | ----- | ---- |
| src | apps/cli/src/commands/rule.ts | lord-robb | 2026-06-05 |
| src | packages/app/src/services/rule-service.ts | lord-robb | 2026-06-05 |
| test | apps/cli/tests/commands/rule.test.ts | lord-robb | 2026-06-05 |
| test | packages/app/tests/services/rule-service.test.ts | lord-robb | 2026-06-05 |

### References

- ts-rule-engine engine.d.ts: `evaluate(rules, cwd, stopOnFirst?: 'error'|'warning'|'info')`
- ts-rule-engine@0.3.2 published with stopOnFirst support (ts-libs#0014)
