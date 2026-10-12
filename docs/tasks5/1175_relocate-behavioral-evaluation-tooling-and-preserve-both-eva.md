---
schema_version: 1
name: Relocate behavioral evaluation tooling and preserve both evaluation tiers
status: todo
template: feature-impl
created_at: 2026-10-12T03:34:10.715Z
updated_at: "2026-10-12T04:01:54.308Z"
feature_id: A91
priority: P1
tags:
  - script-consolidation
estimate_hours: 4

dependencies: ["1173"]
---

## 1175. Relocate behavioral evaluation tooling and preserve both evaluation tiers

### Background

Implements: R3 — Behavioral evals retain free and opt-in live execution after relocation.

Plan and detailed dispositions: docs/plans/2026-10-11-harness-script-consolidation.md. Scope is this vertical slice only; unrelated current edits are foreign.

**Refine corrections (2026-10-11)**

- Evals might be legacy → root package entry and judge tests are active; relocate, do not delete the capability.
- Live failures were all SKIPPED → freeze ENOENT-only unavailable handling, real execution failures as FAIL.
- Missing fixture behavior was ambiguous → it is a fixture-data FAIL, not an unavailable-agent skip.
- Runner destination lacked invocation details → root eval directly executes the repo runner; no new dispatcher/public command.

### Requirements

- [ ] R1. Keep bun run eval as the repository entry and move its runner to scripts/commands/skill-eval.ts, keeping paid/live execution opt-in.
- [ ] R2. Move judge/scenarios/recorded fixtures/tests under plugins/sp/tests/evals and remove the old eval source directory only after current consumers migrate.
- [ ] R3. Distinguish fixture corruption and live execution failure from an unavailable executor, with deterministic tests and no live model calls in normal checks.

Out of scope: No new public CLI API: do not add/change a spur noun, verb, flag, hidden command, output/error contract or implicit automation. Use current services and the explicitly documented standalone packaging exception. Do not edit generated adapters by hand. Preserve supported installed argv and exit behavior, redaction, validation, run identities and durable evidence. No new dependency, generic runner, lock manager or unrelated refactor. Only planning sections are changed by this refinement; implementation owns Solution/Testing/Review.

### Acceptance Criteria

- [ ] AC1 — Behavioral evals retain free and opt-in live execution after relocation (req: R1)

Given the supported source and installed contracts, when the focused fixtures exercise this migration, then behavior and failure policy remain compatible. Verification lens: Before/after fixtures should yield the same scenario PASS for valid data. Tests in scripts/commands/skill-eval.test.ts cover missing fixture, ENOENT, timeout, nonzero status and empty output through injected spawn results. Plugin tests/evals/judge.test.ts must still distinguish disciplined/undisciplined fixtures. Existing bundle-plugins/verify-pack tests prove neither tests nor evals ship. Run tests inside scripts and plugins/sp workspaces. No authenticated agent required.

### Q&A

<!-- CLOSED decisions from refinement: what was chosen and why, what was deferred and on what
     condition. Not a parking lot for open questions — an unanswered question here means the task
     is not ready to hand off. Keep empty if none. -->

#### Q&A entry — 2026-10-12T03:58:06.950Z

- Closed: relocation preserves root eval name and the free/live split.
- Closed: missing executable skips; timeout/nonzero/empty result from an installed executable fails.
- Closed: default verification uses recorded fixtures and injected process outcomes only; paid execution remains operator-invoked.

### Design

Frozen paths: `scripts/commands/skill-eval.ts` is the executable runner; `plugins/sp/tests/evals/judge.ts`, `scenarios.ts`, `judge.test.ts` own plugin behavior fixtures/judgment. Preserve `judgeTranscript` and EVAL_SCENARIOS/EVAL_FIXTURES names. Set root `eval` to run the new source runner directly; do not add another spur-dev dispatcher branch or public eval command. Move eval README content under the plugin test owner and link from plugins/sp/README.md; update skill-structure layout assertions and dispatch-surface documentation. The runner may import its repository-only test fixtures; these are intentionally not shipping dependencies.

Frozen result contract: row outcomes PASS/FAIL/SKIPPED and exit 1 only when at least one FAIL remain. In --fixtures mode a missing/empty requested fixture is FAIL. A missing executable (ENOENT) is SKIPPED in live mode; timeout, nonzero exit, malformed/empty stdout from a present executable is FAIL, with sanitized details. No new CLI flag. Keep stdout Markdown report and stable scenario identifiers. runLive becomes a small injectable runner in this repo command, sufficient to unit-test ENOENT/nonzero/timeout without spawning a model. Preserve SPUR_BIN handling and use existing command splitting rather than inventing shell interpolation.

Packaging: bundle-plugins already excludes tests/evals, verify-pack rejects both, and skill-structure currently requires the old eval folder. Update relevant assertions and current references; retaining general exclude coverage for arbitrary eval dirs is fine. Do not rewrite historical task/report citations. No need to add a new package or generalized eval engine.

Dependencies and handoff: Requires 1173 placement conventions. Independent of hook/task-policy changes after that; no task-policy dependency on eval relocation.

Primary references: `package.json:103`; `plugins/sp/evals/run-eval.ts:35`; `plugins/sp/evals/judge.ts:24`; `plugins/sp/evals/judge.test.ts:13`; `plugins/sp/evals/scenarios.ts:39`; `plugins/sp/tests/skill-structure.test.ts:1643`; `scripts/commands/bundle-plugins.ts:1`; `scripts/commands/verify-pack.ts:76`.

Environment and scope: root Bun/TypeScript workspaces and existing Superskill conversion; no dependency change. No wip tasks or extra worktrees were present at the frozen batch kickoff. Recheck conflict scope before implementation; prior A91 planning edits are part of the operator-authorized context.

No new public CLI API: do not add/change a spur noun, verb, flag, hidden command, output/error contract or implicit automation. Use current services and the explicitly documented standalone packaging exception. Do not edit generated adapters by hand. Preserve supported installed argv and exit behavior, redaction, validation, run identities and durable evidence. No new dependency, generic runner, lock manager or unrelated refactor. Only planning sections are changed by this refinement; implementation owns Solution/Testing/Review.

### Plan

- [ ] 1. Capture the current fixture report and unit expectations; test unavailable versus failed runner cases with injected results.
- [ ] 2. Move judge, scenario data, tests and README to plugins/sp/tests/evals; implement the small executable repo runner at scripts/commands/skill-eval.ts.
- [ ] 3. Update package.json, skill-structure, plugin README and dispatch-surface references; remove the old source folder after the active reference sweep.
- [ ] 4. Run deterministic fixture report, judge tests, new scripts/commands/skill-eval.test.ts, packaging and plugin structural tests, placement rule and task-local gate. Live paid mode is not executed.

### Solution

<!-- Filled during implementation: file:line change map and concise rationale. -->

### Testing

<!-- Filled during verification: commands run, outcomes, coverage claim or N/A. -->

### Review

<!-- Filled during review: P1-P4 findings, residual risk, and final disposition. -->

### References

Feature A91; ADR-130 (2026-10-11 amendment), ADR-129, ADR-065 and ADR-021. Detailed investigation: `docs/plans/2026-10-11-harness-script-consolidation.md`.

Premise sources:
- `package.json:103`
- `plugins/sp/evals/run-eval.ts:35`
- `plugins/sp/evals/judge.ts:24`
- `plugins/sp/evals/judge.test.ts:13`
- `plugins/sp/evals/scenarios.ts:39`
- `plugins/sp/tests/skill-structure.test.ts:1643`
- `scripts/commands/bundle-plugins.ts:1`
- `scripts/commands/verify-pack.ts:76`

### History
