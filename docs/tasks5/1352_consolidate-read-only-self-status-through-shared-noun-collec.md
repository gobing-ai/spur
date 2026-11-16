---
schema_version: 1
name: Consolidate read-only self status through shared noun collectors
status: todo
template: feature-impl
created_at: 2026-11-16T23:01:54.455Z
updated_at: "2026-11-16T23:11:35.267Z"
feature_id: A93
priority: P2
tags:
  - A93
estimate_hours: 6

dependencies: ["1351"]
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

- [ ] R1. Reuse/extract agent and decision status collectors into app services shared with their standalone verbs. Aggregate the nine sections defined in design §3 without invoking CLI recursively or enabling decision --probe/--reliability.
- [ ] R2. Route self status and hidden status through boot-free dispatch before createMigratedDbAdapter; preserve legacy fields, path errors, config-error exit 1, and project-config-existence exit behavior. Add schemaVersion, overallState and scoped sections with redacted data.
- [ ] R3. Enforce the 5000ms aggregate collection deadline using a shared cancellation signal for async probes, cancel timers/requests, and retain partial successes. Synchronous local reads must be bounded in scope; do not claim hard cancellation of arbitrary filesystem I/O.
- [ ] R4. Use ProjectRegistry.peek and safe existing services. Never call getDb/openExistingDb merely to populate status: absent DB is missing; existing ledger data is unavailable when no proven non-mutating facade is installed. Report the limitation rather than empty counts. Prove missing/configured/invalid/unavailable and credential sentinel cases through the real CLI.

### Acceptance Criteria

- [ ] AC1 — Self status consolidates existing noun readiness without mutation
- [ ] AC2 — Unavailable status providers produce bounded partial results

Requirement and verification mapping: AC1 covers R1/R2/R4; AC2 covers R3/R4. Given isolated configured/missing/invalid projects and optional failures, invoke the real CLI; assert legacy fields/exit, explicit partial section states, protected file/schema/registry snapshots and no orphan probes.

### Q&A

<!-- CLOSED decisions from refinement: what was chosen and why, what was deferred and on what
     condition. Not a parking lot for open questions — an unanswered question here means the task
     is not ready to hand off. Keep empty if none. -->

#### Q&A entry — 2026-11-16T23:11:35.075Z

- Closed: 5000ms aggregate budget; bounded optional I/O, no repair/probe/reliability side effects. Local I/O is scope-bounded, not falsely advertised as preemptible.
- Closed: unsupported strict read-only ledger reads report unavailable; no raw adapter or fabricated counts. Upstream ts-db owns future readonly capability.
- Deferred to Robin before implementing public output: exact design §3 additive fields and safe decision collector reuse. This refinement grants no execution consent.

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

<!-- Filled during implementation: file:line change map and concise rationale. -->

### Testing

<!-- Filled during verification: commands run, outcomes, coverage claim or N/A. -->

### Review

<!-- Filled during review: P1-P4 findings, residual risk, and final disposition. -->

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
