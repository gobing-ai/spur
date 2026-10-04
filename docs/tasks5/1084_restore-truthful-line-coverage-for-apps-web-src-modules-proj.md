---
schema_version: 1
name: Restore truthful line coverage for apps/web/src/modules/projects/conversation.ts
status: cancelled
template: feature-impl
created_at: 2026-10-04T22:36:54.230Z
updated_at: "2026-10-04T22:48:07.636Z"
feature_id: C

ac_altitude: task-local
ac_numbering: task-local
priority: P1
estimate_hours: 2
---

## 1084. Restore truthful line coverage for apps/web/src/modules/projects/conversation.ts

### Background

`bun run gate` cannot pass on this checkout for a reason no test can fix: `bun run test` reports
**0 failing tests** yet exits `1`, and `bun run test-post-check` prints exactly one violation —
`ERROR coverage-gate apps/web/src/modules/projects/conversation.ts 8% line coverage (threshold: 90%)`.

Evidence captured by a `/sp-dev-fixall "bun run gate"` session:

- **Deterministic**: the full-suite coverage table reports `92.31` funcs / `7.98` lines for that file,
  identically across four full runs.
- **Not a missing-test gap**: `apps/web/tests/modules/projects/conversation.test.ts` passes 13 tests
  that call the module's exports, and lcov records `FNF:13 / FNH:12` with `LF:163 / LH:13` — the
  functions are hit while the lines are not attributed.
- **Content-triggered, not path/cache**: a probe importing the file from a temp dir and calling
  `encodeRequestEnvelope`, `sameRef`, `decodeRequestEnvelope`, `buildThread` reports `LH:0`; a
  comment-stripped copy still reports `LH:0`.
- **Negative result (do not redo)**: the newest function `buildRecentMessagesThread` (added by
  `196cdde0f`, 2026-10-03) is *not* the trigger — measuring `196cdde0f~1`'s revision of the file still
  yields `LH:3 / FNF:12 / FNH:6`. The trigger is an older construct.
- **Localized**: every sibling in `apps/web/src/modules/projects/` reports `100.00 / 100.00`
  (`activity-history.ts`, `receipt.ts`, `roster.ts`, `useProjectRequests.ts`, `useProjectTab.ts`).
- **Not caused by that session's diff**: reproduced with both of its changed files reverted to
  `50438e546`.

Impact: `bun run gate` and `bun run spur-check-feature` exit non-zero for every session in this repo
with zero test failures and no actionable location, and the coverage numbers contradict themselves
(`92.31`% functions vs `8`% lines) for the same file.

Feature: C (Rules) — the deliverable is the coverage gate's signal integrity.

### Requirements

- [ ] R1. Identify the construct in `apps/web/src/modules/projects/conversation.ts` that makes Bun's lcov line attribution report `LH ~ 0` while its functions are executed, and rewrite or remove that construct so the file's reported line coverage is proportionate to the code its tests execute.
- [ ] R2. If no construct-level fix restores attribution, record the minimal reproduction and land a reasoned `exemptions` entry for that file in `config/rules/quality/coverage-gate.yaml` — an explicit, evidence-named exception — instead of lowering the threshold or adding a blanket exclusion.
- [ ] R3. Preserve the gate's strength everywhere else: `threshold` stays `90`, no growth of `exclude` / `coveragePathIgnorePatterns`, and no test-only addition that leaves the reported numbers unchanged.

### Acceptance Criteria

```gherkin
Scenario: AC1 — the file's reported line coverage is proportionate to its executed code (req: R1)
  Given the full suite ran with coverage from the repo root
  When `.coverage/lcov.info` is read for `apps/web/src/modules/projects/conversation.ts`
  Then its `LH/LF` ratio is at least 0.90

Scenario: AC2 — the coverage gate stops blocking the repo (req: R1; R2)
  Given a full-suite coverage artifact
  When `bun run test-post-check` runs
  Then it exits 0
  And no `coverage-gate` finding names `apps/web/src/modules/projects/conversation.ts`

Scenario: AC3 — the module still behaves as its tests specify (req: R3)
  Given the R1 rewrite, when one was taken
  When `bun test apps/web/tests/modules/projects/conversation.test.ts` runs
  Then all 13 existing tests pass unchanged
  And `bunx biome check apps/web/src/modules/projects/conversation.ts` reports no finding

Scenario: AC4 — the gate keeps its strength (req: R3)
  Given this task's change set
  When `config/rules/quality/coverage-gate.yaml`, `bunfig.toml` and the post-check preset are diffed against the pre-task revision
  Then `threshold: 90` is unchanged
  And no path was added to `exclude`, `coveragePathIgnorePatterns`, or any inline ignore directive
```

### Q&A

<!-- CLOSED decisions from refinement: what was chosen and why, what was deferred and on what
     condition. Not a parking lot for open questions — an unanswered question here means the task
     is not ready to hand off. Keep empty if none. -->

### Design

**WHAT.** Make Bun's per-line attribution for `apps/web/src/modules/projects/conversation.ts`
truthful — or, only if that proves impossible, land one reasoned exemption — so the repo-wide
coverage gate stops reporting a violation no test can clear.

**WHY per-file.** The gate is per measured file (`bunfig.toml`
`coverageThreshold = { lines = 0.9, functions = 0.9 }` and `config/rules/quality/coverage-gate.yaml`
both 90). Siblings in the same directory measure 100/100, so the defect is file-specific and the fix
belongs in the file, not in the gate.

**WHERE (frozen).**
- Primary: `apps/web/src/modules/projects/conversation.ts` — behavior-preserving only; exported names
  and signatures stay frozen.
- Fallback config: `config/rules/quality/coverage-gate.yaml` — the evaluator already supports
  `exemptions: [{ path, threshold, reason }]` and renders the reason in the finding
  (`node_modules/@gobing-ai/ts-rule-engine/dist/evaluators/coverage-gate-evaluator.js`), so R2 needs no
  engine change.
- Do not touch: `bunfig.toml` thresholds, the rule's `threshold`/`include`, sibling modules, or the
  assertions of `conversation.test.ts`.

**Repro (frozen, cheap — no full suite needed).**
```bash
mkdir -p /tmp/cov && cp apps/web/src/modules/projects/conversation.ts /tmp/cov/conv-current.ts
# /tmp/cov/p.test.ts imports /tmp/cov/conv-current and calls encodeRequestEnvelope, sameRef,
# decodeRequestEnvelope, buildThread and buildRecentMessagesThread
cd /tmp/cov && bun test --coverage --coverage-reporter=lcov --coverage-dir=/tmp/cov/.cov p.test.ts
grep -E '^(SF|LF|LH|FNF|FNH):' /tmp/cov/.cov/lcov.info
```
A truthful mapping shows `LH` proportional to `FNH`; the current file reports `LH:2` with `FNH:7`.
Bisect by neutralizing one construct per variant — the template literal at
`conversation.ts:58`, the regex `/\r?\n\r?\n/` at `conversation.ts:74`, the `buildThread`/`toEntry`
chain, and the `.map().sort()` comparator at `conversation.ts:152-168` — until `LH` jumps; that
construct is the trigger.

**Precedence.** R1's construct rewrite wins. R2 is a fallback that requires the recorded minimal
reproduction (`/tmp` probe output plus `bun --version`) in `Testing`, never a bare ignore.

**Anti-patterns (rejected).**
- Adding tests: 13 already pass and call the exports; attribution is the defect.
- Lowering `threshold`, widening `exclude`, or `coveragePathIgnorePatterns`: a suppression that hides
  the signal for every future reader, and the rule file's own comment forbids per-file exclusions.
- Blaming or reverting `196cdde0f` / `buildRecentMessagesThread`: measured false (see Background).
- A new heuristic guard for stale/partial lcov artifacts: real but separate and pre-existing (a
  targeted `bun test <file>` overwrites the shared artifact, after which the gate reports phantom
  violations for files the full suite covers at 100%); it needs engine-side provenance and is out of
  this task's scope.

**Hypothesis (labeled, not a premise).** Bun 1.3.14's lcov line attribution is empty for this file's
transpiled output while function hit counts survive. Confirming repro: the `/tmp` probe above
(`LH:0`/`LH:2` with `FNH>0`) at the affected `bun --version`. If bisect finds no construct-level
trigger, R2 applies.

### Plan

1. Record the baseline: `bun --version` plus the `/tmp` probe numbers for the current file (`LH`/`LF`/`FNH`/`FNF`).
2. Bisect the file — one construct neutralized per variant, probe after each — until `LH` becomes proportionate to the executed code; record which construct flips it.
3. Rewrite that construct behavior-preservingly in `apps/web/src/modules/projects/conversation.ts` (exported names/signatures frozen).
4. Verify the module: `bun test apps/web/tests/modules/projects/conversation.test.ts` (13 pass) and `bunx biome check apps/web/src/modules/projects/conversation.ts`.
5. Only if step 2 finds no trigger: add the reasoned `exemptions` entry for the file in `config/rules/quality/coverage-gate.yaml`, carrying the recorded minimal repro and Bun version.
6. Confirm end-to-end on a full artifact: `bun run test` then `bun run test-post-check` — no `coverage-gate` finding for the file (AC1/AC2 evidence).
7. Record baseline-vs-after numbers in `Testing`, so a later reader can tell the fix from a suppression.

### Solution

<!-- Filled during implementation: file:line change map and concise rationale. -->

### Testing

<!-- Filled during verification: commands run, outcomes, coverage claim or N/A. -->

### Review

<!-- Filled during review: P1-P4 findings, residual risk, and final disposition. -->

### References

- `apps/web/src/modules/projects/conversation.ts` — the measured file.
- `apps/web/tests/modules/projects/conversation.test.ts` — 13 passing tests calling the module's exports.
- `config/rules/quality/coverage-gate.yaml` — the rule; its evaluator supports reasoned `exemptions`.
- `bunfig.toml` — `[test] coverage = true`, `coverageThreshold = { lines = 0.9, functions = 0.9 }`.
- `196cdde0f` (2026-10-03) — added `buildRecentMessagesThread`; measured *not* the trigger.
- Capturing session: `/sp-dev-fixall "bun run gate"` (format/lint/typecheck/pre-check clean, 9981 pass / 0 fail; `test-post-check` prints this single `coverage-gate` ERROR, so the gate exits 1).
- Related, out of scope: `.coverage/lcov.info` carries no provenance, so a targeted `bun test <file>` overwrites it and `coverage-gate` then reports phantom violations (`apps/web/src/lib/rpc-client.ts` 83%, `packages/contracts/src/shared.ts` 84%, `packages/domain/src/planning/schema.ts` 85% — all 100% in a full run). Reported as a session note, not filed here.

### History

- 2026-10-04T22:38:03.558Z backlog → todo (system)
- 2026-10-04T22:48:07.636Z todo → cancelled (system)

