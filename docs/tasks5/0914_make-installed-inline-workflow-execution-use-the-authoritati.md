---
schema_version: 1
name: Make installed inline workflow execution use the authoritative application boundary
status: done
template: standard
created_at: 2026-09-22T02:56:46.296Z
updated_at: "2026-09-22T21:46:54.454Z"
feature_id: D63
priority: P2
tags:
  - next-generation-workflows
  - proposal-w01
estimate_hours: 8

ac_altitude: task-local
---

## 0914. Make installed inline workflow execution use the authoritative application boundary

### Background

The inline-run-setup helper explicitly requires a repository checkout, although interactive commands are intended to work through an installed plugin. Existing setup, fingerprint, action and close operations already own the necessary semantics. Reuse them; do not add a second journal. Covers proposed feature R1.

Planning reference: docs/plans/2026-09-21-next-generation-spur-workflows.md. Registered under accepted feature D63; W01 is the planning cross-reference. Refine against concurrent changes before implementation.

Rubric: E8 D1 L2 C1 R1 = 13. One vertical deliverable and rollback boundary; keep its coupled implementation and verification together. Split further only if refinement reveals a separate outcome or exceeds the size limit.

### Requirements

- [x] R1. Make supported inline setup, fingerprint, action recording and terminal closure work from a bundle-only installation with no repository source imports.
- [x] R2. Use the existing application resolver, run identity, persistence and fingerprint owners; preserve source-layer precedence and refusal of incompatible attachments.
- [x] R3. Keep action-observation failure distinct from mandatory identity/terminal bookkeeping failure; document unsupported inline capabilities explicitly.
- [x] R4. Update the inline driver, affected command consumers and generated plugin artifacts together without adding an unreviewed public CLI surface.

### Acceptance Criteria

- [x] AC1 — An isolated installed-plugin fixture with no checkout performs authoritative setup and closure and exposes the same definition identity as the application resolver. (req: R1)
- [x] AC2 — Project override, registered config and shared fallback fixtures use the application precedence and reject incompatible run attachments. (req: R2)
- [x] AC3 — A failed action observation remains reported without fabricating success for failed identity setup or terminal closure, and unsupported capabilities are named. (req: R3)
- [x] AC4 — Affected callers and generated artifacts pass installation/script-contract checks with no duplicate persistence policy or undeclared public verb. (req: R4)
- [x] AC5 — Installed and source execution preserve authoritative identity (req: R1)

Feature-level traceability: this task delivers D63 scenario R1; AC1–AC4 give its task-local regression evidence.

### Q&A

<!-- CLOSED decisions from refinement: what was chosen and why, what was deferred and on what
     condition. Not a parking lot for open questions — an unanswered question here means the task
     is not ready to hand off. Keep empty if none. -->

### Design

Use the existing app setup, fingerprint and action-trace owners through a generated standalone bundle. Source checkouts keep the current source-module path; bundle-only installs fall back to `plugins/sp/lib/inline-run.generated.mjs`. The Node-runnable standard script twin re-enters Bun for the existing bun:sqlite runtime; no new dependency/toolchain or public CLI verb is introduced.

For source and installed setup, read the existing `workflow show --format todo --json` projection using the selected Spur invocation. The shared app service validates the projection, loads/schema-validates the selected file, compares name/kind/digest and retains its authoritative layer. The CLI composition root owns configuration loading; the service accepts the resolved projection or caller-supplied registered paths without reloading configuration. Missing/malformed/drifted projection fails closed before run creation. Fingerprinting and trace/closure reuse existing app functions; action failure remains best-effort but setup/closure failure stays nonzero. Preserve source stub seams for cleanup/error tests.

Owned paths: `packages/app/src/services/inline-run-setup.ts`, `packages/app/src/workflow/workflow-inventory.ts`, `packages/app/tests/services/inline-run-setup.test.ts`, `packages/app/tests/workflow/`, `plugins/sp/scripts/inline-run-setup.ts`, `plugins/sp/scripts/inline-run-setup.mjs`, `plugins/sp/lib/inline-run.generated.mjs`, `plugins/sp/lib/inline-run.generated.d.mts`, `plugins/sp/tests/inline-run-setup.test.ts`, `scripts/commands/bundle-plugin-lib.ts`, `scripts/commands/bundle-plugin-lib.test.ts`, `config/plugin-scripts.json`, `package.json`, `plugins/sp/skills/spur-dev/references/inline-pipeline-driver.md`, `docs/design/workflow-execution-economy.md`. Adjacent regression tests may use new files under the named test directories.

Runtime proof: the narrow entry bundles 800 modules to approximately 0.93 MB, with only node:* and bun:sqlite imports. Standalone execution is the remaining acceptance test, not yet a PASS claim. Budget: one implementation pass within the existing 1800-second stage bound; preserve partial state in this task and `.spur/run/d63-0914-20260922*` if exceeded. requireDiff requires code for this task; no unrelated workflow/CLI/corpus edits. Verification includes isolated installed runtime, projection drift, layer precedence, rejected attachments, error and DB cleanup behavior, existing regression suites and required project gates.

### Plan

- [x] 1. Trace all setup/fingerprint/action/close callers and classify their runtime dependencies and installed-path resolution.
- [x] 2. Implement the smallest viable portable bridge and wire the existing consumers through it.
- [x] 3. Update source-layer documentation to the actual resolver and generate portable artifacts through the existing toolchain.
- [x] 4. Exercise source and isolated bundle-only fixtures, wrong digest/run/workdir attachment, trace failure and terminal-close failure; run plugin and relevant source gates.

### Solution

Portable inline execution reuses the existing application setup, fingerprint and trace owners through a generated bundle. The installed Node twin re-enters Bun for SQLite; source and installed setup both consume the CLI-selected workflow projection. Launching the CLI uses the existing argument parser without a shell.

| File | Change |
|---|---|
| `packages/app/src/services/inline-run-setup.ts:141` | createOrAttachInlineRun validates selected source identity and actual workflow kind before persistence. |
| `plugins/sp/scripts/inline-run-setup.ts:146` | readInstalledInventory delegates resolution to the selected CLI and returns its projection. |
| `scripts/commands/bundle-plugin-lib.ts:109` | bundleInlineRunLib generates the portable application bridge. |
| `plugins/sp/tests/inline-run-installed.test.ts:8` | Detached installation regression covers setup, fingerprint, action, closure and rejected shell syntax. |

Updated the script manifest/converter, inline driver and owning workflow design. No new public CLI verb, persistence implementation, digest algorithm or workflow engine.

Recovery: the original worktree under .spur was excluded by Biome; run d63-0914-20260922 was paused before moving it intact to /Users/robin/xprojects/spur-new-0914. Recovery run d63-0914-recovery-20260922 uses fresh gate/review/verify evidence. Pre-existing contract TSDoc failures were resolved by fast-forwarding the already-merged fix from main.

### Testing

**Pipeline verify results**

- Verdict: PASS (from verdict artifact)

| Requirement | Status | Evidence |
|-------------|--------|----------|
| R1 | MET | `plugins/sp/tests/inline-run-installed.test.ts:8` — detached Node twin setup, fingerprint, action and closure passed in the final quality gate. Real compiled CLI smoke also passed. |
| R2 | MET | `packages/app/tests/services/inline-run-setup.test.ts:49` — source identity, digest drift, malformed layer and actual workflow-kind refusal; existing attachment/workdir tests passed. |
| R3 | MET | `plugins/sp/tests/inline-run-installed.test.ts:145` — missing action reports ok:false with exit0; missing closure exits1. |
| R4 | MET | `scripts/commands/bundle-plugin-lib.ts:109` — generated application bridge; installation smoke, script contracts and workflow parity passed; no new public CLI noun/verb. |

| Acceptance Criteria | Status | Evidence Type | Evidence |
|---------------------|--------|---------------|----------|
| AC1 | MET | test | `plugins/sp/tests/inline-run-installed.test.ts:8` — detached fixture binds resolver identity and closes authoritative run; final suite PASS. |
| AC2 | MET | test | `packages/app/tests/services/inline-run-setup.test.ts:118` — project/registered/shared precedence; companion identity tests reject incompatible attachment. Real compiled CLI layer fixtures also passed. |
| AC3 | MET | test | `plugins/sp/tests/inline-run-installed.test.ts:145` — distinct action-observation and mandatory closure failure behavior. Unsupported inline engine resume/artifact-ledger/DecisionMaker remain documented. |
| AC4 | MET | command | bun run plugin-smoke; bun run script-contract-check; bun run inline-pipeline-parity-check — PASS,24scripts and10workflows; generated-artifact regeneration also passed in full suite. |
| AC5 | MET | test | `plugins/sp/tests/inline-run-installed.test.ts:8` — installed/source resolver identity equality and idempotent attachment passed. |
- Coverage: N/A (verdict-based; verify pipeline does not measure code coverage)

### Review

#### Review Report — 0914

**Scope:** Task 0914 portable inline execution diff.
**Dimensions:** functional, security, efficiency, correctness, usability, architecture.
**Verdict:** PASS

##### Findings (ranked)

| # | Priority | Dimension | Finding | Location |
|---|---|---|---|---|
| 1 | P3 (minor) | Correctness | Resolved: array-valued source layers are rejected before identity persistence; regression asserts the specific error against unchanged definition inputs. | `packages/app/src/workflow/workflow-inventory.ts:70` |
| 2 | P3 (minor) | Correctness | Resolved: the actual loaded definition must be a state machine, even when a supplied inventory claims otherwise with a matching digest. | `packages/app/src/services/inline-run-setup.ts:162` |
| 3 | P4 (advisory) | Architecture | No remaining P1–P3 findings after independent review; existing resolver, fingerprint and trace owners are reused. The installed runtime still requires Bun. | `plugins/sp/scripts/inline-run-setup.ts:146` |

##### Functional Traceability

| Req | Status | Evidence |
|---|---|---|
| R1 | MET | `plugins/sp/tests/inline-run-installed.test.ts:8` — detached setup, fingerprint, action and closure. |
| R2 | MET | `packages/app/tests/services/inline-run-setup.test.ts:49` — selected identity, malformed layer, definition kind and digest refusal. |
| R3 | MET | `plugins/sp/tests/inline-run-installed.test.ts:8` — observation failure versus mandatory closure failure. |
| R4 | MET | `scripts/commands/bundle-plugin-lib.ts:109` — generated application bridge; no new public CLI noun or verb. |

Independent reviewer: /root/review_0914_bounded, fresh context, read-only; final response confirmed both fixes and no remaining P1–P3 findings. Detached compiled CLI setup/closure and project/registered/shared selection were additionally exercised by the host. Final pipeline quality and verify certification are separate gates.

### References

<!-- Links to features, docs, ADRs, related tasks, or external references. -->

### History

- 2026-09-22T03:46:32.212Z todo → wip (system)
- 2026-09-22T21:46:33.545Z wip → testing (system)
- 2026-09-22T21:46:54.454Z testing → done (system)

