---
schema_version: 1
name: Consolidate read-only self status through shared noun collectors
status: done
template: feature-impl
created_at: 2026-11-16T23:01:54.455Z
updated_at: "2026-11-17T00:15:28.317Z"
feature_id: A93
priority: P2
tags:
  - A93
estimate_hours: 6

dependencies: ["1351"]
done_forced: "false"
done_reason: unforced close
---

## 1352. Consolidate read-only self status through shared noun collectors

### Background

A93 implements R3 — Self status consolidates existing noun readiness without mutation; R4 — Unavailable status providers produce bounded partial results. Source ask: .spur/run/9e537a69-f2a1-4f80-be7d-065acca58ecc-idea-input.md. Owner contract: docs/design/concrete-spur-self.md. Plan quiz was auto-skipped under the operator's --auto; no public-contract consent is inferred.

**Refine corrections (2026-11-16)**

- Collector-only no-mutation claim → main opens/migrates DB before normal dispatch → include boot-free routing and malformed-config handling in scope.
- Existing decision status assumed read-only → handler calls getDb(); openExistingDb uses a WAL/create adapter → share safe catalog/agent collectors and report unsupported ledger reads as unavailable.
- Generic E2E intent → named real-CLI missing/invalid/configured fixtures and snapshots → freeze observable no-side-effect and deadline proofs.
- Pending public consent treated as unresolved design → behavior is specified and consent is owned by Robin → defer authorization at execution intake without claiming it granted.

Issue triage: the migration outcome remains valid. Already-recorded direction is verified, not reimplemented; existing implementation gaps and owner handoffs are corrected here. No task-level issue was cancelled or merged. Audit: main@134ea68a111b9d0aac739419a7259d7928498005; sole worktree; no wip tasks. Existing A93 changes preserved.

### Requirements

- [x] R1. Reuse/extract agent and decision status collectors into app services shared with their standalone verbs. Aggregate the nine sections defined in design §3 without invoking CLI recursively or enabling decision --probe/--reliability.
- [x] R2. Route self status and hidden status through boot-free dispatch before createMigratedDbAdapter; preserve legacy fields, path errors, config-error exit 1, and project-config-existence exit behavior. Add schemaVersion, overallState and scoped sections with redacted data.
- [x] R3. Enforce the 5000ms aggregate collection deadline using a shared cancellation signal for async probes, cancel timers/requests, and retain partial successes. Synchronous local reads must be bounded in scope; do not claim hard cancellation of arbitrary filesystem I/O.
- [x] R4. Use ProjectRegistry.peek and safe existing services. Never call getDb/openExistingDb merely to populate status: absent DB is missing; existing ledger data is unavailable when no proven non-mutating facade is installed. Report the limitation rather than empty counts. Prove missing/configured/invalid/unavailable and credential sentinel cases through the real CLI.

### Acceptance Criteria

- [x] AC1 — Self status consolidates existing noun readiness without mutation
- [x] AC2 — Unavailable status providers produce bounded partial results

Requirement and verification mapping: AC1 covers R1/R2/R4; AC2 covers R3/R4. Given isolated configured/missing/invalid projects and optional failures, invoke the real CLI; assert legacy fields/exit, explicit partial section states, protected file/schema/registry snapshots and no orphan probes.

### Q&A

<!-- CLOSED decisions from refinement: what was chosen and why, what was deferred and on what
     condition. Not a parking lot for open questions — an unanswered question here means the task
     is not ready to hand off. Keep empty if none. -->

#### Q&A entry — 2026-11-16T23:11:35.075Z

- Closed: 5000ms aggregate budget; bounded optional I/O, no repair/probe/reliability side effects. Local I/O is scope-bounded, not falsely advertised as preemptible.
- Closed: unsupported strict read-only ledger reads report unavailable; no raw adapter or fabricated counts. Upstream ts-db owns future readonly capability.
- Deferred to Robin before implementing public output: exact design §3 additive fields and safe decision collector reuse. This refinement grants no execution consent.

#### Q&A entry — 2026-11-16T23:49:24Z

- Grantee: Robin (operator). Granted scope: the additive `spur self status` output, `spur self install`, and the six `spur builder` verbs — exactly the scope recorded in `docs/design/concrete-spur-self.md` §7 and `docs/reports/A93-script-ownership.json` `deferredConsent`.
- Basis: operator answered the A93 batch consent question in this run (2026-11-16) with "grant all three scopes"; the grant is recorded in design §7. Step 0 of this task is therefore satisfied.
- Not granted: publishing, deployments, workflow/IAM edits, or any surface outside that list.

### Design

Frozen proposed output: legacy ok/packageJson/spurConfig/git/agentSpecs/decisionMaker/target plus schemaVersion:1, overallState:ready|degraded|missing, sections with keys installation/configuration/schema/dependencies/projects/agents/decisions/corpus/workflows. Each section is {state,scope,source,message,data?}, state and scope per design §3. The 5000ms deadline is internal, no new public flag/config. Optional provider failure degrades overallState without altering legacy ok/exit. Invalid config/path and top-level errors still exit 1.

Implement packages/app/src/services/self-status.ts (collectSelfStatus), services/agent-status.ts (collectAgentStatus), decision/status.ts (collectDecisionStatus) using narrow contexts with cwd/env/fs/config and an AbortSignal; no CliContext imports into app. Reuse existing DecisionService.status/decisionStatusReadiness and ProjectRegistry.peek. Move only shared agent read helpers from CLI as necessary, preserving standalone JSON and text shapes; the aggregate may additionally record server availability. Preserve decision --probe and --reliability command paths as explicit standalone modes.

Critical scope: apps/cli/src/index.ts must add the existing boot-free dispatch pattern for self status and legacy status before eager DB creation; safe config load errors are passed to the renderer with exit 1. No raw SQLite adapter, new ts-db facade workaround, quota refresh or read-triggered repair. The installed ts-db facade lacks strict readonly support: schema/ledger-driven data report unavailable until its upstream owner supplies it. Base catalog/spec data are still collected; do not relabel missing evidence as an empty healthy database.

Tests first: apps/cli/tests/commands/self/status.e2e.test.ts drives the actual source CLI and isolated packed CLI, temporary HOME/SPUR_GLOBAL_RULES_DIR/PATH, configured/non-project cwd, missing/locked DB, malformed config, unreachable server and secret sentinel. Snapshot cwd/home/schema/registry and journal mode before/after; prove no DB/log/config creation and no lingering probe. Retain commands/status.test.ts and commands/agent/status.test.ts coverage; do not mock the collector being tested.

Input from 1351: status source ownership and concrete consent brief; requires Robin's grant before observable changes. Output to 1356: collector ownership and no-mutation receipt. No dependency on install/build implementation. Current tree has only main and no wip tasks; sequential writer preserves prior A93 changes. Budget 6h; requireDiff collector/boot/renderer+proof; receipt .spur/run/1352-status-e2e.json.

### Plan

1. Step 0: verify 1351 inventory and concrete public-output consent; if no grant, preserve plan and stop public implementation. Recheck installed dependency drift and source bootstrap.
2. R1/R4: write failing real-CLI fixtures first for missing DB, malformed config, decision evidence, registry snapshot and secret sentinel; capture before/after artifacts.
3. R1/R2: extract safe app collectors, add boot-free dispatch and compatible text/JSON rendering; report unavailable ledger reads honestly.
4. R3/R4: exercise deadline/cancellation and partial success, run (cd apps/cli && bun test tests/commands/self/status.e2e.test.ts), retained focused status tests, required CLI link/bundle and the task gate; save receipt and update cli-contracts/facade.

### Solution

Collection is app-owned and additive:

- `packages/app/src/services/self-status.ts` (new) — `collectSelfStatus()`. Nine sections (design §3) with `{state, scope, source, message, data?}` plus `schemaVersion: 1` and `overallState`. One `AbortController` supplies the shared `SELF_STATUS_DEADLINE_MS = 5000` budget; each async probe races it and the signal cancels in-flight requests. No `getDb`/`openExistingDb` call exists on the path: a missing database is `missing`, an existing one makes ledger sections `unavailable` with the ts-db reason, never a zero count. Registry access is `ProjectRegistry.peek()`; tool readiness is a PATH stat, never an install.
- `packages/app/src/services/git-context.ts` (moved from `apps/cli/src/git-context.ts`) — the Git read now lives in app so one service builds the aggregate; `apps/cli/src/git-context.ts` re-exports it for `dispatch-inspect` and its tests.
- `packages/app/src/index.ts` — barrel export for the collector, its types and the deadline constant.
- `apps/cli/src/commands/status.ts` — now only reads the optional `[path]` target and renders. Legacy text lines and the whole legacy JSON shape are preserved (including the full `decisionMaker: DecisionReadiness`), then `Readiness: <overallState>` and one line per section are appended.
- `apps/cli/src/index.ts` — `status` / `self status` join the boot-free dispatch set, so the aggregate runs before `createMigratedDbAdapter`; a config load failure takes the same exit-1 path as full boot (one error, no project contents echoed).
- `apps/cli/tests/commands/self/status.e2e.test.ts` (new, written first — 5 of 9 cases failed before the implementation) — real-CLI subprocess with isolated HOME/registry/config root: missing project (exit 1, nothing created), configured project (legacy fields + sections, no `.spur/spur.db`), honest ledger `unavailable`, credential sentinel never echoed, legacy `[path]` contract, legacy text lines, malformed config (exit 1, code `config`), refused port degradation, and a listener that never answers bounded by the 5 s deadline.
- `plugins/sp/skills/spur-cli/references/self.md`, `docs/design/cli-contracts.md` — the owning surface docs for the additive output.

`agentSpecs` keeps its tolerant file-stem contract; the richer fleet merge stays in `spur agent status` because it reads the project database, and the section says so instead of reporting a false empty set.

### Testing

**Pipeline verify results**

- Verdict: PASS (from verdict artifact)

| Requirement | Status | Evidence |
|-------------|--------|----------|
| R1 | MET | `packages/app/src/services/self-status.ts:249` builds all nine design §3 sections in app code. Decision readiness reuses the shared `computeDecisionReadiness` (`packages/app/src/workflow/decision-readiness.ts:16`); agent spec ids come from the same DB-free `loadAgentSpecs` reader the standalone `spur agent status` starts from (`packages/app/src/services/self-status.ts:135`), and the fleet merge that needs the database stays with that verb and is named in the section message. No recursive CLI call, no `--probe`/`--reliability`. |
| R2 | MET | `apps/cli/src/index.ts:96` routes `status` / `self status` into the boot-free dispatch set before `createMigratedDbAdapter`; a config load failure takes the same single-error exit 1 path (`apps/cli/src/index.ts:128`). Legacy fields and renderer lines are preserved (`apps/cli/src/commands/status.ts:64`), and all nine E2E cases assert them plus `schemaVersion`/`overallState`/`sections`. |
| R3 | MET | `SELF_STATUS_DEADLINE_MS = 5000` with one `AbortController` shared by every async probe (`packages/app/src/services/self-status.ts:120`). `bounded()` races the abort promise, so a provider that ignores its signal is still cut off — the coverage pass found the missing race and fixed it (`packages/app/src/services/self-status.ts:157`). Proven by `status.e2e.test.ts` "a serve that never answers…" (real subprocess, ~5 s) and the unit case "the hanging probe reports unavailable while answered sections still ship". |
| R4 | MET | `ProjectRegistry.peek()` only (`packages/app/src/services/self-status.ts:170`); no `getDb`/`openExistingDb` anywhere on the path, so a missing DB is `missing` and an existing one reports `unavailable` with the ts-db reason instead of counts. E2E covers missing/configured/invalid/unreachable plus a credential sentinel that never appears in stdout or stderr. |

| Acceptance Criteria | Status | Evidence Type | Evidence |
|---------------------|--------|---------------|----------|
| AC1 | MET | test | `apps/cli/tests/commands/self/status.e2e.test.ts:96` — configured project: legacy fields, sections, no `.spur/spur.db` created, filesystem snapshot unchanged |
| AC2 | MET | test | `apps/cli/tests/commands/self/status.e2e.test.ts:210` — refused port degrades its section; `status.e2e.test.ts:229` — non-answering listener bounded by the deadline with partial results intact |
- Coverage: N/A (verdict-based; verify pipeline does not measure code coverage)

### Review

<!-- spur:record-review -->

**SECU findings** (pipeline verify step — verdict: PASS)

| Priority | Dimension | Location | Finding |
|----------|-----------|----------|----------|
| P4 | — | — | No findings (verify verdict PASS) |

### References

- Feature: A93; [owning design](../design/concrete-spur-self.md).
- Source ask: .spur/run/9e537a69-f2a1-4f80-be7d-065acca58ecc-idea-input.md.
- Verified current tree: apps/cli/src/index.ts:135.
- Verified current tree: apps/cli/src/commands/status.ts:36.
- Verified current tree: apps/cli/src/commands/decision.ts:424.
- Verified current tree: packages/domain/src/db.ts:50.
- Verified current tree: packages/app/src/services/project-registry.ts:235.
- Refinement report: docs/reports/2026-11-16-A93-ready-refinement.md.

### History

- 2026-11-16T23:56:52.677Z todo → wip (system)
- 2026-11-17T00:15:26.955Z wip → testing (system)
- 2026-11-17T00:15:28.313Z testing → done (system)

