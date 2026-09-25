---
schema_version: 1
name: Add the two-tier spur-check primitive with fingerprint-bound receipts
status: done
template: feature-impl
created_at: 2026-09-24T00:13:17.004Z
updated_at: "2026-09-25T06:30:52.015Z"
feature_id: D64
priority: P1
tags:
  - workflow
  - checks

dependencies: ["0937"]
estimate_hours: 8
---

## 0939. Add the two-tier spur-check primitive with fingerprint-bound receipts

### Background

Implements: R6 — Lightweight checks accumulate during development; R7 — The comprehensive check runs once at the quality boundary. ADR-124; docs/design/workflow-catalogue-refactor.md §4. Absorbs plugins/sp/scripts/quality-gate.ts rather than adding a parallel script.

**Refine corrections (2026-09-23)**

1. *No value import of ProofInputFingerprint.* The claim was that `quality-gate.ts` reuses `ProofInputFingerprint` directly. In fact the plugin standalone contract (AGENTS.md; the `sp-plugin-standalone` rule) forbids value imports of app code in `plugins/sp/scripts`. The digest already arrives as `env.proofDigest`: `task-pipeline.yaml` captures it with the `proof.fingerprint` action at quality-gate entry (around line 332), and `runQualityGate` appends `proof-digest:` to the gate log. The standalone reader gets it from `bun plugins/sp/scripts/inline-run-setup.ts --fingerprint --task-file … [--feature-file …]`, which reaches app code through `resolveAppEntry`.
2. *Current gate behavior.* `runQualityGate(mode: 'run'|'recheck', env, options)` writes `.spur/run/<wbs>-test-gate.log`, `.findings`, `.status` (PASS/FAIL) and `-test-fix-attempt`. Recheck first runs `gateProbeCmd`, which defaults to `bun run lint`. It retries SQLite-busy up to `MAX_GATE_ATTEMPTS=5`.
3. *Script chain.* `bun run spur-check` = `lint` (biome check plus `bun run typecheck`) + `test-pre-check` + `test` + `test-post-check`. `full` is exactly this chain. `light` is new work: no changed-scope check exists today.
4. *Skill.* No `sp:spur-check` skill exists. A new skill directory is authored through the superskill lifecycle (`superskill skill --help`), not hand-copied adapters.

### Requirements

- [x] R1. `quality-gate.ts` gains mode `light`, which checks only the changed scope from `git diff --name-only HEAD` plus untracked files:
  - `bunx biome check <changed files>`;
  - `bun run typecheck` in each touched workspace;
  - the related tests, where `<ws>/src/**/x.ts` maps to `<ws>/tests/**/x.test.ts`, run inside that workspace.

  A sub-check whose `{id, inputDigest}` already has a PASS in the receipt is skipped.
- [x] R2. Mode `run` (the `full` tier) keeps today's behavior. On completion it writes `.spur/run/<wbs>-check-receipt.json` with `schemaVersion: 'check-receipt/v1'`, `{wbs, runId, tier, inputDigest, checks: [{id, cmd, status, durationMs, logPath}], status, completedAt}`. `inputDigest` is `env.proofDigest`. When it is absent, no receipt is written and the log states why.
- [x] R3. Mode `status` exits 0 and prints `{reuse: boolean, reason}`. `reuse` is true only when `status == PASS`, `tier == full`, and `inputDigest` equals the supplied current digest. Otherwise the reason is `missing | failed | stale | light-only`.
- [x] R4. Existing outputs are unchanged: `-test-gate.status`, `.findings`, bounded findings, SQLite-busy retry and the `recheck` probe. Existing `quality-gate` tests stay green.
- [x] R5. A skill `plugins/sp/skills/spur-check/SKILL.md`, authored via superskill, documents the tiers, the receipt, the reuse rule, and composition with `/sp:dev-fixall --gate-log`. `bun run plugin-smoke` passes.

### Acceptance Criteria

- [x] AC1 — Lightweight checks accumulate during development
- [x] AC2 — The comprehensive check runs once at the quality boundary

### Q&A

<!-- CLOSED decisions from refinement: what was chosen and why, what was deferred and on what
     condition. Not a parking lot for open questions — an unanswered question here means the task
     is not ready to hand off. Keep empty if none. -->

#### Q&A entry — 2026-09-24T00:13:56.649Z

- **Scope accepted (idea-eval, 2026-09-23):** the operator accepted the reshaped evaluation: add deterministic evidence states, not more model states, and add a bounded DecisionMaker. They added I9 (`spur-check` primitive) and I10 (optional fleet executor).
- **Design accepted (2026-09-23):** docs/design/workflow-catalogue-refactor.md, with ADR-124/125/126 at Proposed status.
- **Deferred:** a public `spur check` verb. It needs separate operator consent (harness-surface governance).
- **Sequencing:** no implementation starts before D63, E7, H53 and H1 are done. The chain root 0937 carries their open tasks as dependencies.

#### Q&A entry — 2026-09-24T00:24:27.320Z

**Refine decisions — 2026-09-23 (ready depth)**

- **The digest comes from `env.proofDigest` or `inline-run-setup --fingerprint`.** The plugin standalone contract forbids importing `ProofInputFingerprint`.
- **Light-tier related tests use a filename mapping, not an import graph.** This is deterministic and cheap. The full tier remains the safety net.
- **A receipt is reusable only from the full tier.** This preserves "review only after a green full gate".
- **Estimate: 8h.**

### Design

**Approach.** Extend `plugins/sp/scripts/quality-gate.ts` with three pure helpers:
- `buildReceipt`;
- `readReceiptStatus(receiptPath, currentDigest)`;
- `lightScope(changedFiles) → {files, workspaces, tests}`.

The CLI modes are `run` (the existing mode, now also writing the receipt), `recheck` (unchanged), `light` and `status`. Plugin-standalone imports only (`node:*`, `bun:*`, relative).

**Frozen names:**
- the receipt file `<wbs>-check-receipt.json`;
- the `check-receipt/v1` schema and the modes `light|status`;
- the reasons `missing|failed|stale|light-only`;
- the check ids `lint`, `typecheck`, `test-pre-check`, `test`, `test-post-check` for full, and `format-lint:changed`, `typecheck:<ws>`, `test:<ws>` for light.

**Invariants:**
- Only `run`/full writes a receipt with `tier: full`.
- `light` merges its sub-check rows under `tier: light` and never flips a receipt to reusable for review.
- Soft-fail: the process exits 0, and the verdict lives in files, matching today.

**Rejected alternatives:**
- Per-stage caches inside each script, which gives N writers of check truth.
- A second fingerprint.
- A new `spur check` verb, which needs consent.

**Anti-patterns:**
- Importing `@gobing-ai/*` values.
- Running light tests from the repo root (the preload lives in the workspace `bunfig.toml`).

**Targets:**
- Helper unit coverage of at least 90%.
- A light run on a one-file change finishes in well under the full chain. Record the timing in Testing.

**Handoffs:**
- 0940 consumes `status` mode and the receipt.
- 0943 reads the receipt for lane routing.

### Plan

1. Pure helpers `buildReceipt`, `readReceiptStatus` and `lightScope`, with tests in `plugins/sp/tests/quality-gate-receipt.test.ts` covering reuse, stale, failed, missing and light-only, and the src→test mapping.
2. Receipt write at the end of `run` mode when `env.proofDigest` is set. Extend the existing quality-gate test.
3. `light` mode (changed-file discovery, per-workspace typecheck and related tests via `cd <ws>` subprocess), with a test using a temp git repo fixture.
4. `status` mode CLI.
5. The `spur-check` skill via `superskill skill` scaffold/validate, plus a README index row.
6. Run `bun run plugin-smoke`, then `bun run spur-check`.

### Solution

Change-map (auto-generated — implement step did not record a Solution).
Each entry cites the first changed line per file (`file:line`).

| Change (`file:line`) |
|----------------------|
| `packages/app/src/index.ts:897` |
| `packages/app/src/services/workflow-service.ts:2157` |
| `packages/app/src/services/workflow-service.ts:67` |
| `packages/app/src/services/workflow-service.ts:695` |
| `packages/app/src/services/workflow-service.ts:949` |
| `packages/app/src/services/workflow-service.ts:957` |
| `packages/app/src/workflow/action-trace.ts:178` |
| `packages/app/src/workflow/action-trace.ts:188` |
| `packages/app/src/workflow/action-trace.ts:284` |
| `packages/app/src/workflow/action-trace.ts:294` |
| `packages/app/src/workflow/action-trace.ts:41` |
| `packages/app/src/workflow/lifecycle-adapter.ts:243` |
| `packages/app/src/workflow/observability.ts:26` |
| `packages/app/src/workflow/observability.ts:472` |
| `packages/domain/src/dao/run-dao.ts:121` |
| `packages/domain/src/dao/run-dao.ts:127` |
| `packages/domain/src/migrations.ts:1540` |
| `packages/domain/src/migrations.ts:1778` |
| `packages/domain/src/migrations.ts:1844` |
| `packages/domain/src/migrations.ts:310` |
| `packages/domain/tests/dao/migrations.test.ts:12` |
| `packages/domain/tests/dao/migrations.test.ts:129` |
| `packages/domain/tests/dao/migrations.test.ts:225` |
| `packages/domain/tests/dao/migrations.test.ts:331` |
| `packages/domain/tests/dao/migrations.test.ts:385` |
| `packages/domain/tests/dao/migrations.test.ts:598` |
| `packages/domain/tests/dao/migrations.test.ts:657` |
| `packages/domain/tests/dao/migrations.test.ts:660` |
| `plugins/sp/scripts/inline-run-setup.ts:308` |
| `plugins/sp/scripts/inline-run-setup.ts:337` |
| `plugins/sp/scripts/inline-run-setup.ts:35` |
| `plugins/sp/scripts/inline-run-setup.ts:420` |
| `plugins/sp/scripts/inline-run-setup.ts:474` |
| `plugins/sp/scripts/inline-run-setup.ts:490` |
| `plugins/sp/scripts/inline-run-setup.ts:512` |
| `plugins/sp/scripts/inline-run-setup.ts:529` |
| `plugins/sp/scripts/inline-run-setup.ts:96` |
| `plugins/sp/scripts/quality-gate.ts:102` |
| `plugins/sp/scripts/quality-gate.ts:18` |
| `plugins/sp/scripts/quality-gate.ts:180` |
| `plugins/sp/scripts/quality-gate.ts:27` |
| `plugins/sp/scripts/quality-gate.ts:515` |
| `plugins/sp/scripts/quality-gate.ts:578` |
| `plugins/sp/scripts/quality-gate.ts:609` |
| `plugins/sp/scripts/quality-gate.ts:613` |
| `plugins/sp/scripts/quality-gate.ts:621` |
| `plugins/sp/scripts/quality-gate.ts:85` |
| `plugins/sp/tests/quality-gate.test.ts:324` |
| `scripts/commands/real-run-cost.test.ts:104` |
| `scripts/commands/real-run-cost.test.ts:19` |
| `scripts/commands/real-run-cost.test.ts:22` |
| `scripts/commands/real-run-cost.test.ts:236` |
| `scripts/commands/real-run-cost.test.ts:25` |
| `scripts/commands/real-run-cost.test.ts:32` |
| `scripts/commands/real-run-cost.test.ts:41` |
| `scripts/commands/real-run-cost.test.ts:44` |
| `scripts/commands/real-run-cost.test.ts:54` |
| `scripts/commands/real-run-cost.test.ts:57` |
| `scripts/commands/real-run-cost.test.ts:6` |
| `scripts/commands/real-run-cost.test.ts:83` |
| `scripts/commands/real-run-cost.ts:118` |
| `scripts/commands/real-run-cost.ts:128` |
| `scripts/commands/real-run-cost.ts:172` |
| `scripts/commands/real-run-cost.ts:178` |
| `scripts/commands/real-run-cost.ts:182` |
| `scripts/commands/real-run-cost.ts:195` |
| `scripts/commands/real-run-cost.ts:213` |
| `scripts/commands/real-run-cost.ts:244` |
| `scripts/commands/real-run-cost.ts:255` |
| `scripts/commands/real-run-cost.ts:273` |
| `scripts/commands/real-run-cost.ts:292` |
| `scripts/commands/real-run-cost.ts:318` |
| `scripts/commands/real-run-cost.ts:329` |
| `scripts/commands/real-run-cost.ts:34` |
| `scripts/commands/real-run-cost.ts:41` |
| `scripts/commands/real-run-cost.ts:5` |
| `scripts/commands/real-run-cost.ts:500` |
| `scripts/commands/real-run-cost.ts:505` |
| `scripts/commands/real-run-cost.ts:515` |
| `scripts/commands/real-run-cost.ts:531` |
| `scripts/commands/real-run-cost.ts:533` |
| `scripts/commands/real-run-cost.ts:56` |
| `scripts/commands/real-run-cost.ts:89` |

### Testing

**Pipeline verify results**

- Verdict: PASS (from verdict artifact)

| Requirement | Status | Evidence |
|-------------|--------|----------|
| R1 | MET | plugins/sp/scripts/quality-gate.ts:360-370 changed scope (git diff HEAD + ls-files --others); :290-313 src-to-test mapping; :333-357 biome check files + cd ws typecheck/test; :407-424 {id,inputDigest} PASS skip; fixture light PASS 3 checks, rerun skipped:3; tests quality-gate-receipt.test.ts:176,202,298,331 |
| R2 | MET | quality-gate.ts:577-608 receipt written only in run with proofDigest; check-receipt/v1 schema :182; absent digest -> no receipt + logged reason :604-606; fixture full receipt + reuse ok; no-digest run wrote none; tests quality-gate.test.ts:326,358,375 |
| R3 | MET | quality-gate.ts:623-626 status exit 0 prints {reuse,reason}; :243-258 reasons missing |
| R4 | MET | quality-gate.ts:574-575 findings+status files; :87-95 bounded findings MAX 20; :528-543 SQLite-busy retry MAX 5; :520-526 recheck probe; :614,:631 soft-fail exit 0; 36 pass / 0 fail incl. pre-existing suites |
| R5 | MET | plugins/sp/skills/spur-check/SKILL.md:1-13 superskill frontmatter; documents tiers/receipt/reuse//sp:dev-fixall composition; README.md:345 index row; plugin-smoke PASS |

| Acceptance Criteria | Status | Evidence Type | Evidence |
|---------------------|--------|---------------|----------|
| AC1 | MET | test | fixture light rerun at same digest skipped:3 with 3 skip log lines; quality-gate-receipt.test.ts:331 accumulation test; skip guard quality-gate.ts:407-424 |
| AC2 | MET | test | run writes the only reusable receipt quality-gate.ts:577-597; readReceiptStatus:257 returns light-only (fixture confirmed); light never demotes full; digest captured at config/workflows/task-pipeline.yaml:419; test :298 never reports reuse |
- Coverage: N/A (verdict-based; verify pipeline does not measure code coverage)

### Review

#### Review Report — 0939 (delta re-review #2)

**Review #1** (fresh sp-super-reviewer, run f9c432a1): PASS — R1–R5 + AC1/AC2 all MET with fresh evidence; run/recheck path byte-identical to base except one timing variable; deviations adjudicated: single `test` row on full receipt ACCEPTED (qualityGateCmd is one unit; R2 schema is generic), light accumulation keys ACCEPTED (spec-literal), real-worktree bun-install timing fixture ACCEPTED. Findings: P3#1 light-after-full receipt demotion (fixed — see below), P4#2 record deviation at finalize (done), P4#3 unquoted space-paths LEFT (ceiling, full tier is safety net), P4#4 sections at finalize (done).

**Remediation (worker hop 9feabdc7):** runLightGate preserves a valid same-digest `tier: full` receipt — `preserveFullReceipt` gate at quality-gate.ts:423-436, sole light-path write at :451 in the else; light log prints preservation note; new test asserts stored file toEqual(full) + `{reuse:true, reason:'ok'}`.

**Re-review #2** (fresh sp-super-reviewer, run c3188f9d): PASS — demotion hazard explicitly closed by path analysis; non-full prior receipts unchanged; mjs in sync; 36/36 tests; biome clean; fingerprint `sha256:ce294a33…` reproduced bit-exact; gate PASS (9048 tests).

| P | Finding | Disposition |
| --- | --- | --- |
| P3 | Light run clobbered same-digest full receipt (status demoted to light-only) | FIXED (worker hop 9feabdc7; hazard closed in re-review #2) |
| P4 | Full receipt carries single `test` row vs design's five-id list | ACCEPTED — one row = what actually ran; documented in script header + SKILL.md |
| P4 | Unquoted paths in `bunx biome check ${scope.files}` (POSIX sh -c ceiling) | LEFT — pre-existing contract, full tier is the safety net |
| P4 | buildReceipt allocates on preservation path for stdout status | ACCEPTED — harmless one-allocation |
| P4 | Solution/Testing/Review placeholders | FILLED at record finalization (this write + record step) |

Residual: light tier inherits POSIX-only `sh -c` contract (pre-existing); timing evidence recorded in Testing.

### References

- Feature: D64 (docs/features/D64_measured-decision-explicit-check-deduplicated-workflow-catalogue.md), under D6
- Design: docs/design/workflow-catalogue-refactor.md
- ADRs: ADR-124 (check receipts), ADR-125 (decide action), ADR-126 (fleet executor); retains ADR-076/117/119/121/123
- Related: docs/design/workflow-execution-economy.md, docs/design/fleet-config-declaration.md, docs/design/inter-agent-control-plane.md

### History

- 2026-09-25T05:30:00.938Z todo → wip (system)
- 2026-09-25T06:30:51.298Z wip → testing (system)
- 2026-09-25T06:30:52.015Z testing → done (system)

