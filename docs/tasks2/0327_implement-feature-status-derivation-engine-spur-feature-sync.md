---
template: feature-impl
schema_version: 1
name: "Implement feature-status derivation engine, spur feature sync verb, and Board sync endpoint"
description: ""
status: done
type: task
profile: standard
feature_id: F821
parent_wbs: null
priority: P2
tags: []
dependencies: []
created_at: "2026-07-25T00:27:46.310Z"
updated_at: "2026-08-18T04:42:47.842Z"
---

## 0327. Implement feature-status derivation engine, spur feature sync verb, and Board sync endpoint

### Background
Implements the map's derivation-rules decision (see `docs/tasks2/0322_decide-feature-status-derivation-rules-and-where-the-sync-lo.md` — Solution section).

Terrain: sync handler stub at `apps/server/src/modules/feature/handlers.ts:121`; direction enum at `packages/contracts/src/feature.ts:147`; status enum at `packages/domain/src/planning/schema.ts:23`; existing service `packages/app/src/services/feature-service.ts` (`collectTasksByFeature` at :276 already groups tasks per feature); link helper `plugins/sp/skills/spur-dev/references/feature-link-helper.md`.
### Requirements
- R1. `deriveFeatureStatus(featureId)` in `packages/app` feature-service: pure proposal `{ from, to, reason, requiresConfirm? , gateBlocked? }` implementing the conservative forward-only mapping.
- R2. Application goes through `spur feature advance` hops / lifecycle guards — never raw status sets.
- R3. CLI verb `spur feature sync <id> [--all] [--dry-run] [--json]`: prints proposals with derivation reasons; `--all` sweeps features with linked tasks; `--dry-run` reports only.
- R4. Un-stub `POST /features/{id}/sync`: `pull` delegates to the same service and returns `{ direction, affectedTasks, newStatus? }`; `push` returns an explicit not-implemented error.
- R5. `docs/04_DESIGN.md` updated in the same commit (T3): verb surface + pull/push semantics.
- R6. Tests: unit tests per mapping rule incl. gate interaction and reopen flag; CLI verb integration test; handler contract test. Coverage gate pass.
### Acceptance Criteria

<!-- Copy or derive real scenarios from the linked feature. Do not leave placeholder AC here. -->

### Q&A

<!-- Clarifications and decisions made during refinement. Keep empty if none. -->

### Design

<!-- Chosen implementation approach, key tradeoffs, invariants, and impacted surfaces. -->

### Plan

<!-- Ordered implementation checklist. Fill before moving to todo/wip. -->

### Solution
| File:line | Change |
| --- | --- |
| [`packages/app/src/services/feature-service.ts:310`](file:///Users/robin/xprojects/spur-new/packages/app/src/services/feature-service.ts#L310) | Added `deriveFeatureStatus`, `syncFeature`, and `syncAllFeatures` implementing conservative forward-only mapping per ADR/0322, including L4 AC gate evaluation before `verifying`/`done` and confirm-gated reopen proposals. |
| [`packages/app/src/index.ts:77`](file:///Users/robin/xprojects/spur-new/packages/app/src/index.ts#L77) | Re-exported `FeatureSyncProposal`, `FeatureSyncOptions`, `FeatureSyncResult`, and `FeatureSyncAllResult`. |
| [`apps/cli/src/commands/feature.ts:358`](file:///Users/robin/xprojects/spur-new/apps/cli/src/commands/feature.ts#L358) | Registered `spur feature sync [id] [--all] [--dry-run] [--force] [--json]` CLI subcommand. |
| [`apps/server/src/modules/feature/handlers.ts:121`](file:///Users/robin/xprojects/spur-new/apps/server/src/modules/feature/handlers.ts#L121) | Un-stubbed `POST /features/{id}/sync` HTTP endpoint: `pull` delegates to `FeatureService.syncFeature`; `push` returns explicit not-implemented error. |
| [`docs/04_DESIGN.md:297`](file:///Users/robin/xprojects/spur-new/docs/04_DESIGN.md#L297) | Documented `spur feature sync` CLI command surface and HTTP sync handler semantics. |
| [`packages/app/tests/services/feature-service.test.ts:597`](file:///Users/robin/xprojects/spur-new/packages/app/tests/services/feature-service.test.ts#L597) | Added comprehensive unit tests for feature derivation rules, L4 gate interaction, confirm-gated reopening, and bulk sync. |
| [`apps/cli/tests/commands/feature.test.ts:454`](file:///Users/robin/xprojects/spur-new/apps/cli/tests/commands/feature.test.ts#L454) | Added integration tests for `spur feature sync` CLI flags (`--dry-run`, `--all`, `--json`). |
| [`apps/server/tests/modules/feature/handlers.test.ts:295`](file:///Users/robin/xprojects/spur-new/apps/server/tests/modules/feature/handlers.test.ts#L295) | Added unit tests for server sync handler `pull` and `push` responses. |
### Testing
**Verdict: PASS** — re-audit of commit `1b46ebd2` via `/sp:dev-verify 0327 --force --focus all --fix all` (2026-07-25). The `affectedTasks` semantic P4 from the audit was repaired in a follow-up fix pass and re-verified green (evidence below).

**Per-Requirement Traceability**

| Req | Status | Evidence |
| --- | --- | --- |
| R1 `deriveFeatureStatus(featureId)` pure proposal with conservative forward-only mapping | MET | `packages/app/src/services/feature-service.ts:313-442` — no-op empty set (`:323-330`), reopen `requiresConfirm` on closed features (`:339-356`), all-terminal ⇒ done with L4-gate stop-before-verifying (`:370-406`), active-work ⇒ active (`:409-420`), all-blocked ⇒ blocked (`:423-434`) |
| R2 application via lifecycle hops, never raw sets | MET | `syncFeature` applies `proposal.hops` through `this.transition(featureId, hop)` (`packages/app/src/services/feature-service.ts:462-472`) — the lifecycle-guarded path; reopen skipped without `forceConfirm` (`:458-460`) |
| R3 CLI verb `spur feature sync <id> [--all] [--dry-run] [--force] [--json]` with reasons | MET | `apps/cli/src/commands/feature.ts` sync action (commit 1b46ebd2, +65); smoke: `./apps/cli/spur.js feature sync --all --dry-run --json` → `{evaluated: 28, updatedCount: 0}` with per-feature reason lines |
| R4 un-stub `POST /features/{id}/sync`: pull delegates, push explicit error | MET | `apps/server/src/modules/feature/handlers.ts:121-136` — push throws explicit not-implemented; pull returns `{ direction, affectedTasks (linked-task count), applied, newStatus }`; handler tests incl. push-rejection passed |
| R5 docs/04_DESIGN.md same commit (T3) | MET | commit 1b46ebd2 + follow-up fix — sync endpoint line now documents `affectedTasks` / `applied` semantics (`docs/04_DESIGN.md:303`) |
| R6 tests per mapping rule, CLI integration, handler contract | MET | `packages/app/tests/services/feature-service.test.ts` (+119), `apps/cli/tests/commands/feature.test.ts` (+31), `apps/server/tests/modules/feature/handlers.test.ts` — 94 pass / 0 fail across the three files; web feature-client suite green after the contract fix |

**Acceptance Criteria Verification**

N/A — task AC section is the empty template stub; requirements traceability is the verify axis.

**Design Conformance**

Verified against the locked derivation-rules decision (docs/tasks2/0322 Solution): logic home in app service + CLI verb + HTTP delegation — DONE; conservative forward-only mapping incl. L4-gated verifying — DONE; reopen only operator-confirmed (`requiresConfirm` + `--force` escape) — DONE; pull now / push defined-but-deferred with explicit error — DONE. 4/4 claims DONE.

**SECUA Review (focus: all)**

| Severity | File | Finding | Disposition |
| --- | --- | --- | --- |
| P4 | `apps/server/src/modules/feature/handlers.ts:132` | `affectedTasks: res.applied ? 1 : 0` — counted the transitioned feature, not tasks | FIXED — `affectedTasks` = linked-task count (`collectTasksByFeature`, now public on the service); new `applied: boolean` field carries transition outcome; contract (`packages/contracts/src/feature.ts:157-166`), web type (`apps/web/src/lib/feature-types.ts:113-124`), handler test, and feature-client test updated |
| P4 | `packages/app/src/services/feature-service.ts:377-386` | Gate-blocked `to` targets `active` without checking the active→verifying legality edge for every `from` | Advisory — FSM currently permits it; the hook-wiring sibling task (0328) exercises unattended auto-apply paths |
| P4 | environment | PATH `spur` resolves to the global `~/.bun/node_modules` copy, not the monorepo — `spur feature sync` works only via `./apps/cli/spur.js` or `bun run apps/cli/src/index.ts` until `bun link` runs outside the sandbox | Advisory — operator action (sandbox blocked the link) |

Residual risk: unattended auto-apply semantics (0328) will exercise the engine under batch runs; engine behavior itself verified by unit + CLI + handler tests and live dry-runs.

**Evidence (run this audit)**

- `bun test packages/app/tests/services/feature-service.test.ts apps/cli/tests/commands/feature.test.ts apps/server/tests/modules/feature/handlers.test.ts` — 94 pass / 0 fail / 408 expects
- After the fix pass: `bun test apps/web/tests/lib/feature-client.test.ts packages/app/tests/services/feature-service.test.ts apps/server/tests/modules/feature/handlers.test.ts` — 87 pass / 0 fail
- `bun run lint` — clean (biome + all 5 workspace typechecks exit 0, re-run after the fix)
- `bun run test` — 3550 pass / 3 fail, all three pre-existing sandbox denials: 2× `EADDRINUSE` port-bind in `apps/web/tests/lib/rpc-client.test.ts:44,79` + 1× `ps` EPERM in `packages/app/src/services/process-inventory-service.ts:92` (matches the recorded sandbox memory; unrelated to this diff)
- `./apps/cli/spur.js feature sync F2 --dry-run` → `NOOP backlog -> backlog (No linked tasks found)` — data-true: zero docs/tasks2 files carry `feature_id: F2` (verified via `rg -l 'feature_id: F2' docs/tasks2/` = 0); O (27 linked) derives `active -> done` correctly
- `./apps/cli/spur.js feature sync --all --dry-run --json` → `{evaluated: 28, updatedCount: 0}`; derivations match the mapping (F4/F6/M3/O/P/Q → done with L4 gate passed; H1 → blocked; M1 no-op)
- `bun run --filter @gobing-ai/spur build:bundle` — rebuilt `apps/cli/spur.js` (00:26); PATH `spur` is the global copy (P4 above)
- Line-anchor rule: `packages/app/src/services/feature-service.ts:313-474`, `handlers.ts:121-136` re-read this run; cited lines name the requirement subjects
- Fix-pass disclosure: the fix pass touched `packages/contracts/src/feature.ts:156-166` (response schema + `applied`), `apps/server/src/modules/feature/handlers.ts:121-136` (linked-task count + applied), `packages/app/src/services/feature-service.ts:502` (`collectTasksByFeature` public), `apps/web/src/lib/feature-types.ts:113-124` (response type), `apps/server/tests/modules/feature/handlers.test.ts` (mock + assertion), `apps/web/tests/lib/feature-client.test.ts:234` (fixture), `docs/04_DESIGN.md:303` (semantics line); untracked artifact updated at `.spur/run/0327-verdict.json`
- Verdict artifact: `.spur/run/0327-verdict.json` (written last, standalone path)
### Review
| Severity | File | Finding | Recommendation |
| --- | --- | --- | --- |
| P4 | [`packages/app/src/services/feature-service.ts:310`](file:///Users/robin/xprojects/spur-new/packages/app/src/services/feature-service.ts#L310) | Derivation mapping logic | None — conservative forward-only mapping verified by unit tests; L4 gate correctly blocks premature transition to verifying/done |

Residual risk: None.
### References

R1

<!-- Links to the parent feature, design docs, related tasks, or external references. -->

### History
- 2026-07-25T06:43:15.711Z todo → wip (system)
- 2026-07-25T06:46:17.167Z wip → testing (system)
- 2026-07-25T06:46:18.688Z testing → done (system)
