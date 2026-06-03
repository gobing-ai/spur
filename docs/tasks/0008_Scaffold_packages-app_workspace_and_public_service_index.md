---
name: Scaffold packages-app workspace and public service index
description: Scaffold packages-app workspace and public service index
status: Testing
created_at: 2026-06-03T06:12:03.247Z
updated_at: 2026-06-03T06:22:05.668Z
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

**Verdict: PASS**

Requirements traceability:

| Req | Requirement | Evidence | Status |
|-----|-------------|----------|--------|
| R1 | `packages/app/package.json` — `@gobing-ai/spur-app`, type module, exports, R7 deps with `catalog:`/`workspace:` refs | File created; mirrors `config`/`domain` shape; shared ts-* via `catalog:`, spur-* via `workspace:0.1.0` (matches cli convention) | ✅ |
| R2 | `tsconfig.json` extends ts-base preset | Extends `../../tooling/typescript/base.json`, same as every sibling | ✅ |
| R3 | Registered in root workspaces; resolves | Root globs `packages/*`; `bun pm ls` shows `@gobing-ai/spur-app@workspace:packages/app`; lockfile has the entry | ✅ |
| R4 | `src/index.ts` placeholder re-export module | `export {};` with a comment pointing to 0009–0011 | ✅ |
| R5 | `bun install` clean; lint green; sibling resolves | `bun install` exit 0, lockfile saved; `bun run lint` all 7 workspaces exit 0; in-repo import probe resolved (0 keys) | ✅ |

SECU: no new external surface, no secrets, no input handling — empty placeholder. N/A.

Notes / follow-ups for children:
- Dependency drift (parent flag): `bun install` reported "no changes" for ts-* — the resolved tree is lockfile-consistent; 0009 (which actually imports ts-rule-engine) will be the real test of 0.3.0 API compatibility.
- Stray global `bun link` for `ts-rule-engine` left untouched (AGENTS.md temporary-link policy). If 0009 hits a missing export, reconcile the link there.
- `workspace:0.1.0` (not `workspace:*`) chosen to match the existing `apps/cli` convention exactly.


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


