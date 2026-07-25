---
name: bump_ts-libs_catalog_to_0.3.2_and_absorb_MessageService_removal
description: bump_ts-libs_catalog_to_0.3.2_and_absorb_MessageService_removal
status: done
created_at: 2026-06-05T19:12:38.331Z
updated_at: 2026-06-05T19:13:02.365Z
folder: docs/tasks
type: task
feature-id: ""
priority: low
estimated_hours: 1
dependencies: ["ts-libs#0.3.2-release","release-gate"]
tags: ["spur","ts-libs","catalog","dep-bump","ts-ai-runner","MessageService","breaking-change","downstream","release-gate"]
preset: simple
impl_progress:
  planning: done
  design: done
  implementation: done
  review: done
  testing: done
---

## 0019. bump_ts-libs_catalog_to_0.3.2_and_absorb_MessageService_removal

### Background

spur consumes the `@gobing-ai/ts-*` libraries as PUBLISHED catalog deps pinned at `^0.3.1` (root `package.json` `workspaces.catalog`, all 8 packages lockstep). ts-libs is releasing **0.3.2**. This task bumps spur's catalog to `^0.3.2` and absorbs the one hard breaking change, so the downstream compiles + gates clean before sibling tasks 0017/0018 (which depend on 0.3.2-only APIs) can run.

**0.3.1 → 0.3.2 impact triage (verified against ts-libs source + spur usage, 2026-06-05):**

- **HARD BREAK — `ts-ai-runner` removed `MessageService`** (CHANGELOG 0.3.2 "Removed": class inlined into `TeamOrchestrator`). spur imports + instantiates it in `packages/app/src/services/team-service.ts` (`import { MessageService }` line 8; `messageServicePromise` line 104; `messageService()` helper line 280-282) and — critically — **passes it into the orchestrator constructor** at line 286 (`new TeamOrchestrator(this.configDir, messages)`). In 0.3.2 the orchestrator constructor signature is `new TeamOrchestrator(configDir, inbox: InboxMessageDao, options?)` — it now takes the `InboxMessageDao` **directly**, not a `MessageService`. `TeamOrchestrator.sendMessage(fromId, toId, body, inReplyTo?)` owns routing internally. This is the only change that fails typecheck on the bump.

- **NO break — `getFs()` / `setFileSystem()` still exported.** 0.3.2 adds the `RuntimeFactory` pattern (ADR-011, supersedes ADR-008) as the *recommended* seam, but the legacy global filesystem helpers remain exported from `@gobing-ai/ts-runtime` for back-compat. spur's `apps/cli/src/context.ts` (`getFs`, `setFileSystem`, `NodeFileSystem`) and `team-service.ts` (`getFs`) keep compiling untouched. Adopting `loadRuntimeFactory()` / `createRuntimeContextFromFactory()` is an OPTIONAL alignment, not required by this bump.

- **NO break — `buildIdentityPreamble` still exported** from `ts-ai-runner` (`identity.ts`). The changelog's "dropped dead identityPreamble computation" was an internal `TeamAgentProcess` cleanup; the public helper spur calls in `team-service.ts:260` is unchanged.

- **NO break — `ts-rule-engine` `CapabilityRegistry` removal** (now re-exported from `@gobing-ai/ts-runtime/plugin`): spur does NOT import `CapabilityRegistry` (grep clean). No action.

- **Informational — `runtime-boundaries` spur rule (node: imports):** ts-libs enforces "no direct `node:fs/path/os/child_process`, `Bun.spawn`, `process.env`" *inside the ts-libs workspace*. That rule is ts-libs-internal and does NOT bind spur. spur's own `node:*` imports (context.ts, migrate.ts, rule-service.ts, etc.) are out of scope here; no change.

**Net:** the only forced edit is rewiring `team-service.ts` off `MessageService` onto `InboxMessageDao` (already imported from `ts-db`, identical `enqueue`/`inbox` signatures). Everything else is a clean catalog bump.

**Execution sequence:** 0019 (this task — bump + absorb the break) → 0017 (`--stop-on-first` flag, needs the 0.3.2 `stopOnFirst` param) → 0018 (EventBus per-rule progress, needs 0.3.2 `RuleEngineEvents`). 0019 is the release-gate unblocker for both: once it lands, 0017 and 0018 no longer need a separate dep bump — their R1 (bump deps) is satisfied by 0019.


### Requirements

- **R1**: Bump the catalog from `^0.3.1` to `^0.3.2` for all 8 `@gobing-ai/ts-*` entries in root `package.json` (`workspaces.catalog`); `bun install` resolves the published 0.3.2 set. → **Done when**: every `@gobing-ai/ts-*` catalog range reads `^0.3.2`, `bun.lock` resolves to 0.3.2 (not the stale 0.2.9 currently in `node_modules`), and `bun install` is clean.

- **R2**: Rewire `packages/app/src/services/team-service.ts` off the removed `MessageService`. Drop the `MessageService` import (line 8), the `messageServicePromise` field (line 104), and the `messageService()` helper (lines 280-282). → **Done when**: no reference to `MessageService` remains in the file; typecheck passes.

- **R3**: Repoint the two `messageService()` call sites onto `InboxMessageDao` directly (already imported from `@gobing-ai/ts-db`, already exposed via the `inboxDao()` helper). `sendMessage` → `(await this.inboxDao()).enqueue(fromId, toId, body, replyTo)`; `getInbox` → `(await this.inboxDao()).inbox(agentId, limit, offset)`. The DAO method signatures are identical to the old `MessageService` proxy, so this is a 1-to-1 swap. → **Done when**: `sendMessage`/`getInbox` behave identically (same `SendResult`/`InboxResult` shapes), no `MessageService` indirection.

- **R4**: Update the orchestrator constructor call. 0.3.2 signature is `new TeamOrchestrator(configDir, inbox: InboxMessageDao, options?)`. Change `orchestrator()` (line 285-289) from `this.messageService().then(messages => new TeamOrchestrator(this.configDir, messages))` to `this.inboxDao().then(dao => new TeamOrchestrator(this.configDir, dao))`. → **Done when**: the orchestrator is constructed with the `InboxMessageDao`; team start/stop/sendMessage paths typecheck and pass existing tests.

- **R5**: Confirm NON-breaking surfaces are genuinely untouched — `getFs`/`setFileSystem`/`NodeFileSystem` (`apps/cli/src/context.ts`), `getFs` (`team-service.ts:resolveTaskFile`), and `buildIdentityPreamble` (`team-service.ts:buildIdentity`) all still resolve against 0.3.2 with no edits. → **Done when**: these files are NOT modified by this task and typecheck passes against 0.3.2 (proves the bump is clean beyond the `MessageService` rewire).

- **R6**: Update/verify tests in `packages/app` team-service for the rewired messaging path. Any test that constructed/mocked `MessageService` or asserted on the orchestrator's `MessageService` arg must move to `InboxMessageDao`. → **Done when**: team-service tests are green against 0.3.2; no test references `MessageService`; messaging behavior (enqueue, inbox listing, reply threading) is covered.

- **R7**: Full gate + build green on 0.3.2. → **Done when**: spur's `bun run lint` (biome + per-pkg typecheck), `bun run test`, and `bun run build` all pass; `git status` shows only intentional changes (catalog bump, `team-service.ts`, its tests, `bun.lock`). No `--no-verify`, no skipped tests, no biome-ignore added to silence the gate.

- **R8 (optional, non-blocking — DEFER unless trivial)**: Adopt the 0.3.2 `RuntimeFactory` seam (`loadRuntimeFactory()` / `createRuntimeContextFromFactory()` / `nodeBunFactory`) in `apps/cli/src/context.ts` to replace the legacy `setFileSystem(fs)` + `getFs()` global swap (ADR-011). → **Done when** (if pursued): `context.ts` builds its `fs` from the factory instead of the global setter, tests pass. **If it expands scope or risk, SKIP it** — the legacy helpers remain supported in 0.3.2, so this is alignment, not a fix. Flag as a separate follow-up task if deferred.


### Q&A



### Design

**Nature of the change:** a downstream dependency bump that absorbs exactly one upstream breaking change. spur consumes PUBLISHED `@gobing-ai/ts-*` deps via the root catalog, not workspace links — so the bump is a catalog edit + `bun install`, and the only code that breaks is the `MessageService` consumer.

**Constraints / invariants:**

- **One forced edit only.** The `MessageService` removal is the sole 0.3.1→0.3.2 break that touches spur. Everything else in the bump is source-compatible — do NOT refactor adjacent code while in `team-service.ts` (R5 proves the rest is untouched).
- **1-to-1 swap, not a redesign.** `InboxMessageDao.enqueue(fromId, toId, body, inReplyTo?)` and `.inbox(toId, limit?, offset?)` have the **identical signatures** the old `MessageService` proxied — spur already imports `InboxMessageDao` from `ts-db` and already has an `inboxDao()` helper. Reuse it; don't introduce a new abstraction.
- **Orchestrator constructor changed.** 0.3.2: `new TeamOrchestrator(configDir, inbox: InboxMessageDao, options?)`. The second arg is now the DAO, not a `MessageService`. This is the subtle part — easy to miss because the old code threaded `MessageService` through the orchestrator.
- **Legacy seams stay.** `getFs`/`setFileSystem`/`NodeFileSystem` and `buildIdentityPreamble` are still exported in 0.3.2. Touching them is OUT OF SCOPE (R8 factory adoption is optional/deferred).
- **Catalog, not per-package.** All 8 entries bump together (lockstep). Don't hand-edit individual workspace `package.json` ranges — they reference the catalog.
- **Gate non-negotiable.** Full lint + typecheck + test + build green; no `--no-verify`, no skipped tests, no biome-ignore to silence.
- **Release gate.** Stays **Blocked** until ts-libs publishes 0.3.2 to npm (catalog consumes published deps). Unblock = 0.3.2 on npm.

**Rewire sketch (`packages/app/src/services/team-service.ts`):**
```
// REMOVE: import { MessageService } from '@gobing-ai/ts-ai-runner';
// REMOVE: private messageServicePromise?: Promise<MessageService>;
// REMOVE: messageService() helper

// sendMessage(): was  const messages = await this.messageService(); messages.enqueue(...)
const msgId = await (await this.inboxDao()).enqueue(fromId, toId, body, replyTo);

// getInbox():    was  const messages = await this.messageService(); messages.inbox(...)
const rows = await (await this.inboxDao()).inbox(agentId, limit, offset);

// orchestrator(): was  this.messageService().then(m => new TeamOrchestrator(this.configDir, m))
this.orchestratorPromise ??= this.inboxDao().then(dao => new TeamOrchestrator(this.configDir, dao));
```

**Coordination with 0017 / 0018:** this task satisfies their R1 (dep bump to the 0.3.2 release). Land 0019 first; 0017 and 0018 then run against the already-bumped catalog without their own dep-bump step. Sequence: **0019 → 0017 → 0018**.


### Solution

Catalog bump ^0.3.1 → ^0.3.2 (8 pkgs) + one rewire: team-service.ts off the removed MessageService onto InboxMessageDao (identical enqueue/inbox signatures) and the new TeamOrchestrator(configDir, inboxDao, options?) constructor. getFs/setFileSystem/buildIdentityPreamble stay exported — no change. ~15 src LOC + test updates, ~1hr, Low risk. Release-gate unblocker for 0017 + 0018.


### Plan



### Review

**Verification — 2026-06-05 (`rd3-dev-verify 0019 --auto --fix all --force`)**

| # | Title | Dimension | Location | Recommendation |
|---|-------|-----------|----------|----------------|
| 1 | R5 underestimated the 0.3.2 runtime surface | Correctness | `apps/cli/src/context.ts:4`, `apps/cli/src/commands/init.ts:167` | Fixed: keep legacy globals available, but use `createNodeFileSystem()` for values typed as `FileSystem` and `ensureDir()` where `mkdir()` was removed. |

**SECU verdict:** PASS after fix. No P1/P2 security/correctness findings remain. The `MessageService` removal is absorbed via direct `InboxMessageDao` usage, and stale `MessageService` documentation was removed from `TeamService`.

**Requirements traceability:**

| Requirement | Verdict | Evidence |
|---|---|---|
| R1 | MET | `package.json` catalog and `bun.lock` resolve all 8 `@gobing-ai/ts-*` packages to `^0.3.2` / `0.3.2`. |
| R2 | MET | `packages/app/src/services/team-service.ts` has no `MessageService` import, field, helper, or source/test references. |
| R3 | MET | `sendMessage()` and `getInbox()` call `InboxMessageDao.enqueue()` / `.inbox()` directly. |
| R4 | MET | `orchestrator()` constructs `new TeamOrchestrator(this.configDir, dao)`. |
| R5 | MET after correction | `getFs`, `setFileSystem`, `NodeFileSystem`, and `buildIdentityPreamble` still export in 0.3.2, but `FileSystem` consumers needed `createNodeFileSystem()` plus `ensureDir()` for type compatibility. |
| R6 | MET | Existing team-service messaging/threading tests pass; no tests reference `MessageService`. |
| R7 | MET | `bun run lint`, `bun run test`, `bun run test-cf`, `bun run build`, and `bun run check` pass. |
| R8 | DEFERRED | Full RuntimeFactory adoption was not needed; only the minimal 0.3.2 filesystem factory compatibility was applied. |

**Fix-pass 2026-06-05T22:04:38Z:** 1 fixed, 0 failed, 0 skipped.


### Testing

Verification commands:

- `bun run lint` — PASS.
- `bun run test` — PASS, 542 tests, coverage gate green.
- `bun run test-cf` — PASS, 2 Workers tests.
- `bun run build` — PASS, CLI/server/web built.
- `bun run check` — PASS (`lint + test`).


### Artifacts

| Type | Path | Agent | Date |
| ---- | ---- | ----- | ---- |
| Verification | `docs/tasks/0019_bump_ts-libs_catalog_to_0.3.2_and_absorb_MessageService_removal.md` | Codex | 2026-06-05 |

### References

