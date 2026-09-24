---
schema_version: 1
name: Add the two-tier spur-check primitive with fingerprint-bound receipts
status: todo
template: feature-impl
created_at: 2026-09-24T00:13:17.004Z
updated_at: "2026-09-24T00:24:27.517Z"
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

- [ ] R1. `quality-gate.ts` gains mode `light`, which checks only the changed scope from `git diff --name-only HEAD` plus untracked files:
  - `bunx biome check <changed files>`;
  - `bun run typecheck` in each touched workspace;
  - the related tests, where `<ws>/src/**/x.ts` maps to `<ws>/tests/**/x.test.ts`, run inside that workspace.

  A sub-check whose `{id, inputDigest}` already has a PASS in the receipt is skipped.
- [ ] R2. Mode `run` (the `full` tier) keeps today's behavior. On completion it writes `.spur/run/<wbs>-check-receipt.json` with `schemaVersion: 'check-receipt/v1'`, `{wbs, runId, tier, inputDigest, checks: [{id, cmd, status, durationMs, logPath}], status, completedAt}`. `inputDigest` is `env.proofDigest`. When it is absent, no receipt is written and the log states why.
- [ ] R3. Mode `status` exits 0 and prints `{reuse: boolean, reason}`. `reuse` is true only when `status == PASS`, `tier == full`, and `inputDigest` equals the supplied current digest. Otherwise the reason is `missing | failed | stale | light-only`.
- [ ] R4. Existing outputs are unchanged: `-test-gate.status`, `.findings`, bounded findings, SQLite-busy retry and the `recheck` probe. Existing `quality-gate` tests stay green.
- [ ] R5. A skill `plugins/sp/skills/spur-check/SKILL.md`, authored via superskill, documents the tiers, the receipt, the reuse rule, and composition with `/sp:dev-fixall --gate-log`. `bun run plugin-smoke` passes.

### Acceptance Criteria

- [ ] AC1 — Lightweight checks accumulate during development
- [ ] AC2 — The comprehensive check runs once at the quality boundary

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

<!-- Filled during implementation: file:line change map and concise rationale. -->

### Testing

<!-- Filled during verification: commands run, outcomes, coverage claim or N/A. -->

### Review

<!-- Filled during review: P1-P4 findings, residual risk, and final disposition. -->

### References

- Feature: D64 (docs/features/D64_measured-decision-explicit-check-deduplicated-workflow-catalogue.md), under D6
- Design: docs/design/workflow-catalogue-refactor.md
- ADRs: ADR-124 (check receipts), ADR-125 (decide action), ADR-126 (fleet executor); retains ADR-076/117/119/121/123
- Related: docs/design/workflow-execution-economy.md, docs/design/fleet-config-declaration.md, docs/design/inter-agent-control-plane.md

### History
