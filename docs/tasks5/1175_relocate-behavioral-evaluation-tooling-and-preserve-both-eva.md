---
schema_version: 1
name: Relocate behavioral evaluation tooling and preserve both evaluation tiers
status: done
template: feature-impl
created_at: 2026-10-12T03:34:10.715Z
updated_at: "2026-10-12T05:58:17.154Z"
feature_id: A91
priority: P1
tags:
  - script-consolidation
estimate_hours: 4

dependencies: ["1173"]
done_forced: "false"
done_reason: unforced close; PASS artifact at .spur/memory/evidence/1175-verdict.json
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

- [x] R1. Keep bun run eval as the repository entry and move its runner to scripts/commands/skill-eval.ts, keeping paid/live execution opt-in.
- [x] R2. Move judge/scenarios/recorded fixtures/tests under plugins/sp/tests/evals and remove the old eval source directory only after current consumers migrate.
- [x] R3. Distinguish fixture corruption and live execution failure from an unavailable executor, with deterministic tests and no live model calls in normal checks.

Out of scope: No new public CLI API: do not add/change a spur noun, verb, flag, hidden command, output/error contract or implicit automation. Use current services and the explicitly documented standalone packaging exception. Do not edit generated adapters by hand. Preserve supported installed argv and exit behavior, redaction, validation, run identities and durable evidence. No new dependency, generic runner, lock manager or unrelated refactor. Only planning sections are changed by this refinement; implementation owns Solution/Testing/Review.

### Acceptance Criteria

- [x] AC1 — Behavioral evals retain free and opt-in live execution after relocation (req: R1)

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

- [x] 1. Capture the current fixture report and unit expectations; test unavailable versus failed runner cases with injected results.
- [x] 2. Move judge, scenario data, tests and README to plugins/sp/tests/evals; implement the small executable repo runner at scripts/commands/skill-eval.ts.
- [x] 3. Update package.json, skill-structure, plugin README and dispatch-surface references; remove the old source folder after the active reference sweep.
- [x] 4. Run deterministic fixture report, judge tests, new scripts/commands/skill-eval.test.ts, packaging and plugin structural tests, placement rule and task-local gate. Live paid mode is not executed.

### Solution

Task 1175 relocated the behavioral-eval tooling without losing either tier or loosening the failure contract.

Runner (repository tooling, not shipped):

- `scripts/commands/skill-eval.ts:1` — the `bun run eval` runner, invoked directly from `package.json:103`. It imports the corpus and judge from the plugin test owner, which is legitimate repository tooling: nothing here ships, so the fixtures are not a shipped dependency.
- `scripts/commands/skill-eval.ts:85` — `runLiveAttempt` is now a small injectable unit: the spawn result is a parameter, so ENOENT, timeout, non-zero exit and empty stdout are unit-tested without ever spawning a model. `SPUR_BIN` keeps its space-splitting contract (no shell interpolation).
- `scripts/commands/skill-eval.ts:96` — unavailable means ENOENT only; `scripts/commands/skill-eval.ts:99`, `:108`, `:111` and `:120` classify timeout, signal kill, non-zero exit and empty stdout as FAIL; `scripts/commands/skill-eval.ts:147` and `:151` make a missing or empty recorded fixture a FAIL rather than a skipped row. Exit is 1 only when a FAIL remains, and the Markdown report plus scenario identifiers are unchanged.

Corpus and judge (plugin test owner):

- `plugins/sp/tests/evals/judge.ts:1` and `plugins/sp/tests/evals/scenarios.ts:1` — `judgeTranscript`, `EVAL_SCENARIOS` and `EVAL_FIXTURES` moved with their names intact; `plugins/sp/tests/evals/judge.test.ts:1` still asserts the disciplined/undisciplined split in the default suite.
- `plugins/sp/tests/evals/README.md:1` — the tier documentation moved with the harness and now names the runner's real path; `plugins/sp/README.md:285` links it and the empty `plugins/sp/evals/` tree is gone.

Consumers and assertions:

- `plugins/sp/tests/skill-structure.test.ts:1644` — the layout assertion now expects the corpus under `tests/evals` and asserts the runner's presence at `plugins/sp/tests/skill-structure.test.ts:1648`; `:1656` keeps the "separate entry point, never a test file" invariant.
- `plugins/sp/skills/parallel-execution/references/dispatch-surface.md:170` and `docs/design/harness-surface-governance.md:96` — the two live documents that named the old runner/dir now name the new ones.
- `scripts/commands/bundle-plugins.ts:34` — the exclusion comment reflects that the corpus sits under `tests/`; the exclusion regex is unchanged, so eval fixtures stay out of the staged plugin and `verify-pack` keeps rejecting them (both suites pass at the gate's cwd).

Deferred: the live paid tier was not executed (it needs an authenticated agent and an LLM call per scenario), and the pre-existing cwd-relative fixture read in `scripts/commands/verify-pack.test.ts:17` is reported, not changed — it is unrelated to this slice.

### Testing

**Pipeline verify results**

- Verdict: PASS (from verdict artifact)
- Confidence: MEDIUM

| Requirement | Status | Evidence |
|-------------|--------|----------|
| R1 | MET | Root entry kept and repointed at the relocated source runner `package.json:103` (`bun run scripts/commands/skill-eval.ts`); the runner's CLI surface is `scripts/commands/skill-eval.ts:186` and `scripts/commands/skill-eval.ts:195`; the paid tier stays opt-in because only the default path spawns an agent (`scripts/commands/skill-eval.ts:85`), while `--fixtures` never spawns — asserted by `scripts/commands/skill-eval.test.ts:102` |
| R2 | MET | Corpus and judge now under the plugin test owner: `plugins/sp/tests/evals/judge.ts:1`, `plugins/sp/tests/evals/scenarios.ts:1`, `plugins/sp/tests/evals/judge.test.ts:1` and `plugins/sp/tests/evals/README.md:1`; `plugins/sp/evals` no longer exists, and no live reference names it (the sweep in `plugins/sp/tests/skill-structure.test.ts:1644` and `:1648` asserts the new layout plus the runner location); documentation moved and linked from `plugins/sp/README.md:285`, with the dispatch surface `plugins/sp/skills/parallel-execution/references/dispatch-surface.md:170` and the governance table `docs/design/harness-surface-governance.md:96` repointed |
| R3 | MET | Three outcomes are distinguished in the runner: unavailable is ENOENT-only `scripts/commands/skill-eval.ts:96`, while timeout `scripts/commands/skill-eval.ts:99`, signal kill `:108`, non-zero exit `:111` and empty stdout `:120` are FAIL; a missing or empty recorded fixture is FAIL as corrupt data `scripts/commands/skill-eval.ts:147` and `:151`. Deterministic coverage without any model call: `scripts/commands/skill-eval.test.ts:40` (ENOENT), `:49` (timeout), `:58` (non-zero), `:64` (empty stdout), `:86` (missing fixture), `:93` (empty fixture). No live call runs in a default check — `bun run eval -- --fixtures` completes with zero spawns |

| Acceptance Criteria | Status | Evidence Type | Evidence |
|---------------------|--------|---------------|----------|
| AC1 — Behavioral evals retain free and opt-in live execution after relocation (req: R1) | MET | command | Full gate through the sanctioned primitive (`wbs=1175 bun plugins/sp/scripts/quality-gate.ts run`) → `quality gate PASS (attempts: 1)`; durable `.spur/run/1175-test-gate.status` (`PASS`) and `.spur/run/1175-test-gate.log:455` (`11087 pass`, `0 fail`), `:15` (51 pre-check rules), `:460` (2 post-check rules), `:3` (1357 files formatted/linted). Tier lenses: `bun run eval -- --fixtures` prints the Markdown report and exits 0 with the same scenario PASS as before the move; `plugins/sp/tests/evals/judge.test.ts` still separates disciplined from undisciplined fixtures (`4 pass`); script runner suites `scripts/commands/skill-eval.test.ts` (`10 pass`) |
- Coverage: N/A (verdict-based; verify pipeline does not measure code coverage)

### Review

<!-- spur:record-review -->

**SECU findings** (pipeline verify step — verdict: PASS)

| Priority | Dimension | Location | Finding |
|----------|-----------|----------|----------|
| P4 | — | — | No findings (verify verdict PASS) |

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

- 2026-10-12T05:57:58.398Z todo → wip (system)
- 2026-10-12T05:58:08.263Z wip → testing (system)
- 2026-10-12T05:58:17.149Z testing → done (system)

