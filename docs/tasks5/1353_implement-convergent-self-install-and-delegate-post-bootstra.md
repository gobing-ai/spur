---
schema_version: 1
name: Implement convergent self install and delegate post-bootstrap setup
status: todo
template: feature-impl
created_at: 2026-11-16T23:01:54.456Z
updated_at: "2026-11-16T23:11:37.397Z"
feature_id: A93
priority: P2
tags:
  - A93
estimate_hours: 8

dependencies: ["1351"]
---

## 1353. Implement convergent self install and delegate post-bootstrap setup

### Background

A93 implements R5 — Installation has a distinct owner and verified bootstrap; R6 — Repeated and interrupted installation converges safely. Source ask: .spur/run/9e537a69-f2a1-4f80-be7d-065acca58ecc-idea-input.md. Owner contract: docs/design/concrete-spur-self.md. Plan quiz was auto-skipped under the operator's --auto; no public-contract consent is inferred.

**Refine corrections (2026-11-16)**

- Only command implementation scoped → ordinary main boot creates project DB → install must dispatch before project boot.
- Global seed helper zero files assumed success → helpers return zero when assets are missing → require an explicit missing-assets failure for install while preserving init behavior.
- All adapter mtimes assumed stable → Superskill owns adapter rewriting and has no install JSON flag → limit byte/mtime identity to Spur seeds; adapter convergence remains delegated.
- Superskill command deferred without shape → installed help verified install sp --marketplace with default configured targets → freeze that supported delegation and selected-step failures.

Issue triage: the migration outcome remains valid. Already-recorded direction is verified, not reimplemented; existing implementation gaps and owner handoffs are corrected here. No task-level issue was cancelled or merged. Audit: main@134ea68a111b9d0aac739419a7259d7928498005; sole worktree; no wip tasks. Existing A93 changes preserved.

### Requirements

- [ ] R1. Implement proposed self install with repeatable --with <tool> options for zg, a2a and sp-plugin, plus JSON/envelope. Unknown tool names exit 2 before mutation. Bare invocation seeds machine assets only and skips optional tools visibly.
- [ ] R2. Extract shared machine seed services from init; preserve existing custom files and default init behavior. Install fails on missing required seed assets, bypasses project DB/config boot, and never scaffolds cwd, migrates SQL or edits shell profiles.
- [ ] R3. Retain verified atomic first-binary acquisition in install.sh and delegate setup to the absolute installed binary. Preserve SPUR_VERSION/SPUR_INSTALL/SPUR_RELEASE_URL/verification controls and translate SPUR_INSTALL_ZG/A2A defaults to explicit requests; do not swallow setup failures.
- [ ] R4. Report every attempted step as created/unchanged/skipped/failed with required/message and ok/changed summary; required or explicitly selected failure exits 1 while the verified binary remains installed. Retry only missing/failed work, preserve Spur seed bytes/mtimes on rerun, and delegate adapter convergence without promising Superskill timestamp identity.

### Acceptance Criteria

- [ ] AC1 — Installation has a distinct owner and verified bootstrap
- [ ] AC2 — Repeated and interrupted installation converges safely

Requirement and verification mapping: AC1 covers R1/R2/R3; AC2 covers R4. Given local verified release fixtures and isolated homes, run actual source/packed/standalone install, then rerun and interrupt selected steps; assert seed identity, no cwd database/scaffold, selected failure exits and retry convergence.

### Q&A

<!-- CLOSED decisions from refinement: what was chosen and why, what was deferred and on what
     condition. Not a parking lot for open questions — an unanswered question here means the task
     is not ready to hand off. Keep empty if none. -->

#### Q&A entry — 2026-11-16T23:11:37.200Z

- Closed: separate self install, never overload init or migrate. Optional tools use repeatable --with; unknown tool exits before writes.
- Closed: failed selected tool exits 1 while retaining the binary, matching the proposed documented compatibility change; shell defaults become explicit selections.
- Closed: seed mtimes/bytes are Spur-owned invariants; Superskill owns semantic adapter convergence and may refresh timestamps.
- Deferred to Robin before public implementation: new verb, flags and installer error-policy consent. Real host/tool installation remains outside task proof scope.

### Design

Frozen API proposal: spur self install [--with <tool> ...] [--json] [--json-envelope], with repeatable --with flags and choices zg|a2a|sp-plugin. No force/version/download/target flags. Body results: {ok,changed,steps:[{name,state,required,message}]}; state created|unchanged|skipped|failed. Exit 0 success, 1 required/selected step failure, 2 usage. Machine setup does not require valid project config. Existing init adoption remains the sole backed-up config replacement path.

Own apps/cli/src/commands/self/install.ts and index registration, apps/cli/src/index.ts boot-free selection, packages/app/src/services/self-install.ts, and extraction of globalRulesRoot/resolveGlobalConfigDir/seedGlobalRules/seedGlobalConfig from commands/init.ts into shared services. Freeze installSelf(context,{tools}) -> InstallReport and reuse the existing SPUR_GLOBAL_RULES_DIR isolation/override semantics without renaming it. Missing bundled config/rule sources are explicit required failures for install; preserve init's existing scaffold behavior. No install journal, host profile edits or auto SQL. Existing healthy optional executable means unchanged; package-manager work is explicit and bounded, stdout diagnostics never corrupt the single JSON result.

sp-plugin delegates exactly superskill install sp --marketplace <bundled marketplace directory>, default configured targets, no --json or --prune. Use installed/shipped asset resolution, not import.meta.url ancestry into a checkout. Missing Superskill or selected installer failure returns a failed step. Superskill owns adapter state; do not implement a duplicate stamp/adapter writer. Optional installers must be exercised only through fixture PATH binaries; actual host installs and network mutations remain unauthorized.

Keep scripts/install.sh checksum/download/atomicity test ownership at scripts/commands/install-sh.test.ts; add apps/cli/tests/commands/self/install.e2e.test.ts FIRST for actual CLI repeated/custom/partial/no-assets/selected-failure cases. Isolate HOME, SPUR_GLOBAL_RULES_DIR, PATH and release assets. Source + packed + standalone run the same app setup. Persist .spur/run/1353-install-e2e.json with seed hashes/mtimes and per-step results.

1351 supplies ownership and concrete consent prerequisites; 1352 owns status collectors only, not seed extraction. Shared main.ts edits run sequentially. 1356 consumes final bootstrap/setup disposition. Robin owns deferred exact public-verb/error-policy consent before implementation; no new dependency, global install or workflow edit. Budget 8h; requireDiff shared seed+bootstrap+CLI+E2E.

### Plan

1. Step 0: verify 1351 ownership and Robin's exact install/error-policy grant; capture source/packed asset roots and retain existing environment controls.
2. R2/R4: enumerate missing-assets, write-denied, custom-config, repeat and selected-tool failures; write failing isolated real-CLI tests before extraction.
3. R1/R2: extract shared seed ownership, implement boot-free install, option validation and per-step rendering; preserve init behavior.
4. R3/R4: reduce shell setup to absolute CLI delegation and preserve local-release checksum tests; run focused install E2E and install-sh tests in their workspaces, required link/bundle and task gate; retain retry/seed/artifact receipt.

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
- Verified current tree: apps/cli/src/commands/init.ts:381.
- Verified current tree: apps/cli/src/commands/init.ts:401.
- Verified current tree: apps/cli/src/commands/init.ts:415.
- Verified current tree: scripts/install.sh:1.
- Verified current tree: scripts/commands/install-sh.test.ts:19.
- Refinement report: docs/reports/2026-11-16-A93-ready-refinement.md.

### History
