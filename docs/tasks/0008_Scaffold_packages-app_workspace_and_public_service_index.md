---
name: Scaffold packages-app workspace and public service index
description: Scaffold packages-app workspace and public service index
status: Done
created_at: 2026-06-03T06:12:03.247Z
updated_at: 2026-06-03T06:24:33.296Z
folder: docs/tasks
type: task
feature-id: F-4 app-services
priority: high
estimated_hours: 3
tags: ["refactor","architecture","app-services","scaffold"]
impl_progress:
  planning: pending
  design: pending
  implementation: pending
  review: pending
  testing: pending
---

## 0008. Scaffold packages-app workspace and public service index

### Background

Parent task 0005 extracts an application-services layer (packages/app) from fat CLI command files. Before any service can be extracted, the new Bun workspace must exist and resolve. This is the dependency root for all service extractions (RuleService, AgentService, WorkflowService, HistoryService): it creates packages/app with package.json (name @gobing-ai/spur-app, type module, exports, catalog: refs for shared deps per AGENTS.md version-SSOT rule), a tsconfig.json extending @gobing-ai/ts-base, registration in the root workspaces array, and an initial src/index.ts placeholder. Without this, bun install will not resolve the new package and downstream extractions cannot import from @gobing-ai/spur-app.


### Requirements

R1: Create packages/app/package.json with name @gobing-ai/spur-app, type module, proper exports map, and dependencies per parent R7 (ts-ai-runner, ts-rule-engine, ts-dual-workflow-engine, ts-llm-jsonl-importer, spur-domain, spur-config, ts-runtime, ts-utils, ts-infra) using catalog: for any dep shared across >=2 workspaces, literals for app-only deps. R2: Create packages/app/tsconfig.json extending tooling/typescript base preset. R3: Register packages/app in root package.json workspaces (already covered by packages/* glob — verify it resolves). R4: Create packages/app/src/index.ts as an empty/placeholder re-export module. R5: bun install resolves the workspace cleanly; bun run lint stays green. Acceptance: bun install succeeds, @gobing-ai/spur-app resolves from a sibling import, lint+typecheck pass with the empty package.


### Q&A



### Design

- Scope: New `packages/app` Bun workspace as the dependency root for the 0005 service-extraction family. Empty/placeholder at this stage — no service code yet.
- Key decision: Mirror the existing `packages/config` and `packages/domain` manifest shape (private, type module, `exports: { ".": "./src/index.ts" }`, build/dev/test/typecheck scripts, `catalog:` for shared deps). tsconfig extends `tooling/typescript/base.json` like every sibling.
- Dependency reconciliation: The lockfile already resolves all `@gobing-ai/ts-*` to `0.3.0` (verified sha512 integrity present), but `node_modules` is half-stale (ts-ai-runner/ts-dual-workflow-engine/ts-llm-jsonl-importer still symlinked to 0.2.9). `bun install` reconciles node_modules to the lockfile (0.3.0). This satisfies R5 and clears the drift flagged in the parent.
- Boundaries affected: `packages/app/{package.json,tsconfig.json,src/index.ts}` (new); root `bun.lock` (reconciled by install). Root `package.json` workspaces already globs `packages/*` so no edit needed there (R3).
- Risks: Stray global `bun link` for `ts-rule-engine` (symlinks to global, not a versioned dir). Left untouched — may be intentional per AGENTS.md temporary-link policy. If `bun install` overwrites it, the gate will reveal any breakage.


### Solution

- [x] Inspect sibling package manifests (`config`, `domain`) + tsconfig + tooling presets for the canonical shape
- [x] Verify dependency drift: lockfile on 0.3.0, node_modules half-stale
- [ ] Create `packages/app/package.json` (`@gobing-ai/spur-app`, deps per parent R7, `catalog:` for shared)
- [ ] Create `packages/app/tsconfig.json` extending `tooling/typescript/base.json`
- [ ] Create `packages/app/src/index.ts` placeholder
- [ ] Run `bun install` → reconcile node_modules to lockfile (0.3.0), resolve `@gobing-ai/spur-app`
- [ ] Verify `@gobing-ai/spur-app` resolves; `bun run lint` green
- [ ] Smoke-test a sibling import of the empty package


### Plan

- [x] Inspect sibling package manifests (`config`, `domain`) + tsconfig + tooling presets for the canonical shape
- [x] Verify dependency drift: lockfile on 0.3.0, node_modules half-stale
- [ ] Create `packages/app/package.json` (`@gobing-ai/spur-app`, deps per parent R7, `catalog:` for shared)
- [ ] Create `packages/app/tsconfig.json` extending `tooling/typescript/base.json`
- [ ] Create `packages/app/src/index.ts` placeholder
- [ ] Run `bun install` → reconcile node_modules to lockfile (0.3.0), resolve `@gobing-ai/spur-app`
- [ ] Verify `@gobing-ai/spur-app` resolves; `bun run lint` green
- [ ] Smoke-test a sibling import of the empty package


### Review

## Review — 2026-06-03 (dev-verify --force)

**Verdict: PASS**
**Scope:** `packages/app/{package.json,tsconfig.json,src/index.ts}` (commit 7e9d2d4)
**Mode:** verify (Phase 7 SECU + Phase 8 traceability)
**Channel:** current (dogfood-safe)
**Gate:** `bun run lint` → PASS (7 workspaces typecheck clean, Biome clean)

### Phase 7 — SECU

No findings across all four dimensions. Scope is workspace config + an empty `export {}` placeholder: no secrets, no `any`, no unsafe sinks, no logic, no I/O. Nothing to fix (`--fix all` → 0 actionable findings).

### Phase 8 — Requirements traceability

- [x] **R1** package.json (`@gobing-ai/spur-app`, type module, exports, R7 deps) → **MET** | `packages/app/package.json`; shared ts-* via `catalog:`, spur-* via `workspace:0.1.0` (matches apps/cli convention)
- [x] **R2** tsconfig extends ts-base → **MET** | `packages/app/tsconfig.json` extends `../../tooling/typescript/base.json`
- [x] **R3** registered + resolves → **MET** | `bun pm ls` → `@gobing-ai/spur-app@workspace:packages/app`
- [x] **R4** placeholder index → **MET** | `packages/app/src/index.ts` (`export {}`)
- [x] **R5** install clean, lint green, sibling resolves → **MET** | gate green; in-repo import probe resolved

### Environment fix applied (unblocks 0009)

Found and repaired a **dangling global `bun link`** for `@gobing-ai/ts-rule-engine` (symlinked to a non-existent global target). `bun install --force` reconciled it to the registry `0.3.0` per the lockfile. Verified: `ts-rule-engine` now resolves from `packages/app` (31 exported keys). This was a pre-existing environment defect, not introduced by 0008 — surfaced here because 0009 (running in parallel) imports ts-rule-engine. Note: parallel worktree agents run their own `bun install` and resolve independently, so this fix primarily protects the main-checkout integration step.


### Testing

- Command: `bun run lint` (Biome + per-workspace `tsc --noEmit`); `bun run test`; sibling-import resolution probe
- Scope: New `packages/app` workspace registration, manifest/tsconfig correctness, `@gobing-ai/spur-app` resolvability, no regression to existing workspaces
- Result: PASS. Biome clean (122 files, +3 from the new package). All 7 workspaces typecheck exit 0 incl. `@gobing-ai/spur-app`. Full suite 242 pass / 0 fail across 40 files. Import probe from within the repo resolved `@gobing-ai/spur-app` (0 exported keys — correct for the empty placeholder).
- Evidence: `bun run lint` → "@gobing-ai/spur-app typecheck: Exited with code 0"; `bun run test` → "242 pass, 0 fail"; probe → "RESOLVED keys= 0". No unit suite for an empty scaffold package by design — the gate is the acceptance test (R5).
- Next action: none. 0009–0011 unblocked; each adds its service + its own test suite to this package.
- Timestamp: 2026-06-03T06:23:17Z


### Artifacts

| Type | Path | Agent | Date |
| ---- | ---- | ----- | ---- |

### References


