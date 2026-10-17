---
schema_version: 1
name: Route quality gate and shipped workflows through SDLC actions
status: todo
template: feature-impl
created_at: 2026-10-17T04:04:39.232Z
updated_at: "2026-10-17T04:16:44.455Z"
feature_id: A92
priority: P1
tags:
  - quality-gate
  - workflow
estimate_hours: 6

dependencies: ["1222", "1223"]
---

## 1224. Route quality gate and shipped workflows through SDLC actions

### Background

Feature A92 (docs/design/sdlc-actions.md §3.4). The gate light tier hard-codes bunx biome / bun test (packages/app/src/services/quality-gate.ts:548-576) and workflows default to bun scripts (config/workflows/task-pipeline.yaml:174,180; feature-verification.yaml:54; packages/app/src/workflow/feature-verification-run.ts:187; wrapup-pipeline.yaml:132). Covers R5, R6, R11.

**Refine corrections (2026-10-16)**
- Bun defaults listed as three vars → there is a fourth, `formatCmd: "bun run format"` (config/workflows/task-pipeline.yaml:195, run at :367) → added as R4.
- Design implied `spur self exec …` literals → gate vars run via `sh -c` (packages/app/src/services/quality-gate.ts:762) and the CLI injects `spurBin` at run start (config/workflows/wrapup-pipeline.yaml:59), so a bare `spur` could hit a stale PATH binary → defaults use `${spurBin:-spur}`.
- Feature verification was treated like the shell vars → `verificationCmd` goes through the safe argv splitter with no shell (packages/app/src/workflow/feature-verification-run.ts:219) → default stays literal `spur self exec check-feature` (PATH `spur`); splitter invariant kept.
- Light tier would call `spur self exec` → it resolves in-process through sdlc-actions (no CLI re-entry, no PATH dependency); plan ids unchanged.
- Test-scope discovery splits on `/tests/` (quality-gate.ts:567) and is bun-layout-shaped → unchanged here; recorded out of scope.
- No project-layer `.spur/workflows/` overrides exist in spur-new (ls) → only config/workflows + regenerated apps/cli/config change.

### Requirements

- [ ] R1. `planLightChecks` (packages/app/src/services/quality-gate.ts:548) resolves `lint-changed`, `rules-pre`, `rules-post`, `typecheck-changed`, `test-changed` in-process through sdlc-actions; no `bun`, `bunx` or `biome` literal remains in quality-gate.ts.
- [ ] R2. An unbound scoped action yields a plan entry note `skipped:unbound` (no command run); `workspaceHasTypecheck` gates `typecheck-changed` only when the resolved source is `preset` (bun); plan ids stay `format-lint:changed`, `rules:pre`, `rules:post`, `typecheck:<ws>`, `test:<ws>`.
- [ ] R3. task-pipeline defaults: `qualityGateCmd: "${spurBin:-spur} self exec check"`, `gateProbeCmd: "${spurBin:-spur} self exec lint"` (config/workflows/task-pipeline.yaml:174,180).
- [ ] R4. task-pipeline `formatCmd` default becomes `"${spurBin:-spur} self exec format"` (task-pipeline.yaml:195), still best-effort.
- [ ] R5. feature-verification default is `spur self exec check-feature` in config/workflows/feature-verification.yaml:54 and the fallback at feature-verification-run.ts:187.
- [ ] R6. wrapup `docTripwireCmd` (config/workflows/wrapup-pipeline.yaml:132) runs `$spurBin self exec test-repo-wide` only when `$spurBin self exec --list --json` reports it with a source other than `unbound`.
- [ ] R7. Explicit `--vars` and `spur task gate run --cmd/--probe-cmd` (apps/cli/src/commands/task/gate.ts:21-22) still take precedence.
- [ ] R8. Under the bun preset, the planned light-tier commands for a fixed scope on this repo are byte-identical to the pre-change baseline.
- [ ] R9. apps/cli/config is regenerated (`bun run --filter @gobing-ai/spur build:bundle`) and changed workflow versions are bumped per the promotion check.

Out of scope: test-scope discovery for non-bun layouts (follow-up); the CLI verb itself (1223); plugin prose (1227); package.json script edits (1226).

### Acceptance Criteria

- [ ] AC1 — Quality gate tiers resolve commands through the action map
- [ ] AC2 — Workflows and feature verification call actions instead of bun scripts
- [ ] AC3 — Existing bun projects keep working without config changes

Requirement map: AC1 → R1, R2; AC2 → R3, R4, R5, R6, R7, R9; AC3 → R8. Test layer: E2E gate runs on a temp python-shaped fixture and on this repo (real shell execution, stub tools record calls — no mocked resolver).

### Q&A

<!-- CLOSED decisions from refinement: what was chosen and why, what was deferred and on what
     condition. Not a parking lot for open questions — an unanswered question here means the task
     is not ready to hand off. Keep empty if none. -->

#### Q&A entry — 2026-10-17T04:05:54.155Z

- No --vars seam is added for the light tier; the resolver replaces the literals directly.
- The wrapup tripwire probes the action list instead of package.json, so non-npm projects can opt in.

#### Q&A entry — 2026-10-17T04:16:44.263Z

- No --vars seam is added for the light tier; in-process resolution replaces the literals (closed).
- The wrapup tripwire probes the action list instead of package.json (closed).
- Shell vars use `${spurBin:-spur}`; argv-split verificationCmd uses PATH `spur` (closed 2026-10-16, see correction block).
- Non-bun test-scope discovery deferred to a follow-up task once a non-bun adopter exists (owner: operator).

### Design

WHAT: delete bun literals from the engine and shipped workflow defaults; route through the action map.
WHERE: packages/app/src/services/quality-gate.ts (planLightChecks + signature), config/workflows/{task-pipeline,feature-verification,wrapup-pipeline}.yaml, packages/app/src/workflow/feature-verification-run.ts:187, regenerated apps/cli/config/.

Frozen: `planLightChecks(scope, hasTypecheck = workspaceHasTypecheck, builder?: BuilderConfig)` — builder comes from the loaded project config at the existing call site (quality-gate.ts:661). `LightCheckPlan` gains optional `skipped?: 'unbound'`. YAML defaults exactly as R3–R6.

Why `${spurBin:-spur}`: the vars execute under `sh -c` and the CLI injects spurBin, so the gate re-enters the binary that drives the run; the `:-spur` fallback keeps a hand-run `spur task gate run` working. Feature verification stays argv-split (security invariant from its own design) and therefore uses PATH `spur`.

Anti-patterns: no bun fallback when an action is unbound; do not spawn `spur self exec` from inside the engine (in-process resolution only); do not change plan ids (receipts/logs key on them); do not touch test-scope discovery.

Assumes from deps: 1222 resolver/renderScoped/BuilderConfig; 1223 verb with exit-code propagation. Leaves for 1226: spur-new's `.spur/config.yaml` dogfood block declaring `test-repo-wide`.

### Plan

1. Baseline: dump `planLightChecks` output for a fixed scope on this repo to an artifact file (R8).
2. Swap planLightChecks to the resolver; add `skipped:unbound`; thread builder config from the call site (R1, R2).
3. Change YAML defaults and the feature-verification fallback (R3–R6); confirm `--vars`/`--cmd` precedence untouched (R7).
4. Regenerate apps/cli/config; bump workflow versions; run `bun run workflow-promotion-check` (R9).
5. E2E: run the gate (light + full) on a python-shaped temp fixture (`preset: none`, ruff/pytest stub scripts recording invocations) asserting no bun/bunx/biome executed; rerun on this repo and diff against the baseline (R8). Keep both outputs as the artifact.
6. `bun run spur-check`.

### Solution

<!-- Filled during implementation: file:line change map and concise rationale. -->

### Testing

<!-- Filled during verification: commands run, outcomes, coverage claim or N/A. -->

### Review

<!-- Filled during review: P1-P4 findings, residual risk, and final disposition. -->

### References

<!-- Links to the parent feature, design docs, related tasks, or external references. -->

### History
