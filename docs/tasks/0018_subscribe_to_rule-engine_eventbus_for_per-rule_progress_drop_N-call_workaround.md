---
name: subscribe_to_rule-engine_eventbus_for_per-rule_progress_drop_N-call_workaround
description: subscribe_to_rule-engine_eventbus_for_per-rule_progress_drop_N-call_workaround
status: Done
created_at: 2026-06-04T23:36:46.003Z
updated_at: 2026-06-04T23:36:49.605Z
folder: docs/tasks
type: task
feature-id: ""
priority: low
estimated_hours: 1.5
dependencies: ["ts-libs#0015","release-gate","task-0017"]
tags: ["spur","rule-engine","eventbus","observability","verbose","refactor","downstream"]
impl_progress:
  planning: done
  design: done
  implementation: done
  review: done
  testing: done
preset: simple
---

## 0018. subscribe_to_rule-engine_eventbus_for_per-rule_progress_drop_N-call_workaround

### Background

spur consumes @gobing-ai/ts-rule-engine@^0.3.1 (PUBLISHED dep, not workspace). Today spur streams per-rule progress in verbose mode by re-entering the engine ONCE PER RULE: evaluateVerbose (packages/app/src/services/rule-service.ts:330) loops rules and calls engine.evaluate([singleRule], cwd) per rule (rule-service.ts:344), paying per-call engine setup N times — a workaround for the rule engine being a silent black box. ts-libs task 0015 adds a typed RuleEngineEvents EventBus to RuleEngine (events: rule.run.start, rule.eval.start {ruleId,index,total}, rule.eval.done {ruleId,findings,durationMs}, rule.eval.error, rule.run.done) injectable via new RuleEngine({ events }). This task rewires spur to subscribe to those events and stream progress from a SINGLE evaluate() call over all rules — removing the N-call loop. HARD GATE: cannot start until ts-libs publishes a release whose ts-rule-engine + ts-infra (EventBus) versions expose RuleEngineEvents; spur must bump its ^0.3.1 deps to that version first.


### Requirements

- **R1**: Bump `@gobing-ai/ts-rule-engine` and `@gobing-ai/ts-infra` deps to the released version exposing `RuleEngineEvents` (lockstep). → **Done when**: `package.json` ranges point at the release that ships `RuleEngineEvents`; `bun install` resolves; typecheck sees the `events` option on `RuleEngine`.
- **R2**: Construct an `EventBus<RuleEngineEvents>` and pass it via `new RuleEngine({ events })` in `RuleService` (`rule-service.ts:169`). → **Done when**: the engine is constructed once per `evaluate()` with the bus injected; a unit test asserts events reach a subscriber.
- **R3**: Rewrite `evaluateVerbose` (`rule-service.ts:330`) to subscribe to `rule.eval.start`/`rule.eval.done`/`rule.eval.error` and stream per-rule progress from a SINGLE `engine.evaluate(allRules, cwd)` call. → **Done when**: the per-rule loop at `rule-service.ts:339-344` is deleted; verbose mode invokes `engine.evaluate` exactly ONCE (asserted via spy), and per-rule progress still streams in rule order.
- **R4**: Preserve current verbose UX exactly — same stderr progress lines, same indented colored detail, same summary line (`rule-service.ts:186`). This is a refactor, not a UX change. → **Done when**: existing `rule-service` verbose tests pass UNMODIFIED; a captured-stderr snapshot before/after the refactor is byte-identical for a representative multi-rule run.
- **R5**: Non-verbose path unchanged (already a single `evaluate` call). → **Done when**: the non-verbose branch is untouched; its tests pass unmodified.
- **R6**: Surface `rule.eval.error` (evaluator crash) distinctly from a violation finding in verbose output. → **Done when**: a run with a throwing evaluator shows a distinct "evaluator error" line (not a normal violation line); a pure-violation run shows no such line.
- **R7**: Full gate + build green; no per-call perf regression. → **Done when**: spur's gate + build pass; a timing assertion (or call-count assertion from R3) confirms one `evaluate` replaces N — engine setup is paid once, not per rule.


### Q&A

_Refined via `rd3:dev-refine 0018 --auto` (synthesis-only, no interactive Q&A). Decisions derived from existing Background/Solution:_

- **Q: Requirements format?** → Reformatted the dense single-paragraph requirements into a numbered list (R1–R7), each with a verifiable **"Done when"** acceptance clause.
- **Q: Constraints section?** → The scaffold has no `### Constraints` heading and the `tasks` CLI only writes existing sections; constraints (refactor-not-redesign, single-evaluate, non-verbose frozen, release gate, sibling-bump-with-0017) were synthesized into the **Design** section, with a subscription sketch.
- **Q: Preset?** → `simple`. Single file (`packages/app/src/services/rule-service.ts`), one consumer rewire, ~30 LOC, low risk, single domain; the only "dependency" is the upstream release gate (already captured in frontmatter `dependencies`). 3+ simple-column signals, 0 complex → simple.
- **Q: How to prove "byte-identical UX"?** → R4 pins it to existing verbose tests passing UNMODIFIED + a before/after stderr snapshot; R3 pins "single call" to a spy asserting `evaluate` is invoked exactly once.
- **Open (deferred, non-blocking):** EventBus lifetime — per-`evaluate()` vs per-`RuleService` (recommend per-call to keep handlers run-scoped).
- **Status note:** remains **Blocked** on ts-libs#0015 release (do not start before the dep bump). Coordinate the dep-bump with sibling task 0017 for a single spur release.


### Design

**Nature of the change:** a pure CONSUMER rewire — spur moves per-rule progress streaming from an N-call workaround to an event subscription over a single engine call. The rule engine's behavior is unchanged; only how spur observes it changes.

**Constraints / invariants:**
- **Refactor, not redesign (must NOT change UX).** Verbose output (progress lines, colored detail, summary) must be byte-identical before/after. Verify against existing `rule-service` tests UNMODIFIED + a stderr snapshot. R4 is the guardrail.
- **Single evaluate call.** The whole point: replace the `rule-service.ts:339-344` per-rule loop with one `engine.evaluate(allRules)` + an `EventBus` subscription. Engine setup is paid once, not N times.
- **Non-verbose path frozen.** It already does a single call; do not touch it.
- **Hard release gate.** Cannot start until ts-libs publishes a release exposing `RuleEngineEvents` (task 0015); spur consumes PUBLISHED deps (`^0.3.x`), not workspace — bump first (R1).
- **Sibling dep-bump with 0017.** Task 0017 (stopOnFirst CLI flag) also bumps the same published ts-libs deps. If 0017 and 0018 land together, that is ONE dep-bump + ONE spur release instead of two — coordinate.
- **Gate non-negotiable.** spur's full gate + build must pass; no `--no-verify`, no skipped tests.

**Subscription sketch (in `evaluateVerbose`):**
```
const events = new EventBus<RuleEngineEvents>();
events.on('rule.eval.start', ({ ruleId, index, total }) => streamProgressLine(...));
events.on('rule.eval.done',  ({ ruleId, findings, durationMs }) => streamDetail(...));
events.on('rule.eval.error', ({ ruleId, error }) => streamEvaluatorError(...));  // R6, distinct from violation
const result = await new RuleEngine({ events }).evaluate(allRules, cwd);  // ONE call
printSummary(result);  // rule-service.ts:186, unchanged
```

**Open (decide at implementation, non-blocking):** whether to reuse a single long-lived `EventBus` per `RuleService` instance or construct one per `evaluate()` call (recommend per-call — handlers are run-scoped and avoid leak/`removeAllListeners` bookkeeping).


### Solution

~30 src + ~50 test, ~1.5hr, Low-Medium risk. Pure consumer rewire: bump deps, inject EventBus, move per-rule streaming from an N-call loop to event subscription over one call. UX output byte-identical (refactor). Blocked-by: ts-libs 0015 release. Net: removes the N-call workaround the rule engine's silence forced.


### Plan

1. Verify `@gobing-ai/ts-rule-engine@0.3.2` is installed and exports `RuleEngineEvents` + `EventBus` constructor option. ✓ (already at `^0.3.2` in catalog)
2. Add imports: `EventBus` from `ts-infra`, `RuleEngineEvents` type from `ts-rule-engine`.
3. Rewrite `evaluate()` to remove shared `engine` variable — non-verbose creates its own `new RuleEngine()`, verbose delegates to `evaluateVerbose`.
4. Rewrite `evaluateVerbose` to construct `EventBus<RuleEngineEvents>`, subscribe to `rule.eval.start` (progress lines), `rule.eval.done` (timing), `rule.eval.error` (R6 distinct error), then call `engine.evaluate(allRules)` once. Post-evaluate: group findings by ruleId and emit outcome+detail lines in evaluation order.
5. Add test for multi-rule verbose (verifies single evaluate call + both rules streamed).
6. Add test for R6 (evaluator error surfaced distinctly).
7. Run full gate.

### Review

- **Single evaluate call achieved.** `evaluateVerbose` now constructs `new RuleEngine({ events })` and calls `engine.evaluate([...rules], cwd, stopOnFirst)` exactly once. The N-call loop is deleted.
- **Event contract note.** The released `rule.eval.done` event carries `findings: number` (count), not the finding array. The design sketch assumed `findings: ConstraintFinding[]`. Adapted by tracking eval order + timings from events, then grouping aggregate findings by ruleId post-evaluate. This preserves per-rule outcome and detail lines without needing finding objects in events.
- **Output ordering.** Progress lines (`▶ [N/M] rule-id (type)`) now stream during evaluation via `rule.eval.start`. Outcome + detail lines emit after evaluation completes, grouped by ruleId in eval order. For stopOnFirst runs, the second rule never gets `rule.eval.start`, so it never appears.
- **R6 additive.** `rule.eval.error` handler emits a distinct `! evaluator error in <ruleId>: <message>` line. Existing tests pass unmodified; new test verifies the distinct line.
- **Non-verbose path frozen.** Only change: `new RuleEngine()` is constructed inline instead of shared variable. No behavioral change.

### Testing

- All 20 existing tests pass unmodified (R4 verified).
- 2 new tests added: `verbose uses a single engine.evaluate call (not one per rule)` + `verbose surfaces evaluator error distinctly from violation`.
- Total: 22 tests in rule-service.test.ts, 551 across full suite.
- Coverage: `rule-service.ts` at 98.46% function / 99.72% line coverage.
- Gate: lint + typecheck + full test suite green.

### Artifacts

| Type | Path | Agent | Date |
| ---- | ---- | ----- | ---- |

### References


