---
schema_version: 1
name: Retire obsolete script infrastructure and finalize the sp CLI prerequisite
status: todo
template: standard
created_at: 2026-10-15T17:50:40.227Z
updated_at: "2026-10-15T18:32:43.810Z"
ac_altitude: task-local
ac_numbering: task-local
parent_wbs: "1211"
priority: P1
tags:
  - script-absorption
  - pr8
  - pr10-decision
estimate_hours: 6

dependencies: ["1212"]
feature_id: A91
---

## 1213. Retire obsolete script infrastructure and finalize the sp CLI prerequisite

### Background

Retire the final obsolete skill-script infrastructure after task 1212's PR-9 result is accepted and landed. The ready stack and hook cleanup already landed through PR #28 at bfdb9d6e6; hooks are plugin-owned under scripts/hooks and Superskill 0.3.39 supplies native Pi adapters and staged timeout metadata. Parent 1211 owns final integrated acceptance and cleanup.

Current inventory: seven scripts/hooks entries, script-root.ts/.mjs, nine lib TS files (eight hook-only including env.ts, plus obsolete spur-bin.ts). config/plugin-scripts.json has only the script-root entry; config/script-placement-baseline.json is empty but its checker still loads it. I3 is verifying, so surface-drift-inventory must currently remain with its repository-only reason. Recheck I3 before any conditional deletion.

**Refine corrections (2026-10-15)**
- Generated bundles, bundle-plugin-lib and build:plugin-lib treated as pending deletions → already removed by the accepted stack → drop those deletion subissues; assert absence without recreating work.
- R5/AC2 asked to create the PR-10 closure and minimum-version decision → already present in the landing plan and README → drop that completed issue and its standalone scenario; preserve the existing decision during final doc reconciliation.
- Distribution dependency pins unspecified → package.json still pins Superskill 0.3.37 and publish.yml smoke installs 0.3.28 → add R8/AC3 to align both with the documented supported runtime (at least 0.3.39).
- “Delete scripts” ambiguous → preserve all seven canonical hook entries and their eight hook-only libs, including fail-open error handling → retire only script-root/spur-bin and exhausted build/manifests.
- No concrete run-start cutover → task-pipeline.yaml:238 and inline-pipeline-driver.md:103 still invoke script-root → explicitly remove the obsolete script-resolution identity probe, retaining independent base-sha/evidence capture and CLI launch/provenance safeguards.

### Requirements

- [ ] R1. Delete script-root.ts/.mjs, lib/spur-bin.ts and their obsolete tests, config/plugin-scripts.json, config/script-placement-baseline.json and build:scripts plus its build caller. Keep already-deleted bundle infrastructure absent; preserve the seven canonical hook entries and eight needed hook-only libs.
- [ ] R2. Rewrite script-contract-check and the sp-script-placement rule for the final hook-only script layout without registry/twin/baseline machinery. Preserve hook identity/layout, standalone import, forbidden invocation, trust-boundary and application ownership checks without a blanket waiver.
- [ ] R3. Remove script-root consumers from task-pipeline run-start and the inline driver, and simplify plugin-install-smoke, verify-pack and bundle-plugins tests for the surviving installation. Remove live deleted-skill-script invocations; preserve independent CLI resolution, base-sha capture, evidence persistence and guard behavior. Audit transition shims but retain unrelated live agent-bare-binary-name compatibility.
- [ ] R4. Check I3 status through the feature CLI before touching surface-drift-inventory; retain it with a specific repository-only reason while I3 needs it, otherwise delete only when closure and replacement consumers are proven. Record a current reason for each retained old-path script.
- [ ] R6. Reconcile current plan dispositions and final checklist with the actual hook-only scripts layout, retained libs, already-completed PR-10 closure and documented Spur >=0.5.0/Superskill >=0.3.39 prerequisites. Preserve dated history and the explicit runtime-version-enforcement deferral.
- [ ] R7. Keep root/scripts bunfig.toml and gate scope unchanged. Prove checker, packaging and actual isolated staged-hook installation behavior with focused tests, serialized required gate and per-file function/line coverage >=90%; root reviewer accepts the result.
- [ ] R8. Align the root Superskill catalog/lockfile and existing publish workflow installation pin to a released supported version, using 0.3.39 as the minimum verified baseline. Pin one consistent exact version unless a newer version is explicitly selected before implementation; do not mix in the separately planned ts-* dependency upgrade.

### Acceptance Criteria

```gherkin
Scenario: AC1 — PR-8 retires the script infrastructure (req: R1, R2, R3, R4, R6, R7)
Given task 1212 is accepted and landed and the remaining reusable script callers are enumerated
When checker, packaging, standalone, task-pipeline resilience and isolated installation tests run
Then script-root, spur-bin, exhausted manifests and build:scripts are absent without resurrecting already-removed bundles
And the seven canonical hooks and their eight required libs still resolve with preserved error handling and deadlines
And the pipeline retains base-sha capture, CLI resolution and durable evidence safeguards without a script-root probe
And placement checks reject actual forbidden imports, non-hook skill scripts, shadow hook entries and retired invocations
And I3 inventory and unrelated live transition shims remain unless their verified removal conditions hold
And current plan dispositions match the final layout, bunfig files remain unchanged and the required gate passes with per-file coverage evidence

Scenario: AC3 — Distribution uses the supported hook runtime (req: R6, R7, R8)
Given the documented hook runtime floor is Superskill 0.3.39 and the catalog and publish install currently select older versions
When both exact pins and the lockfile are aligned and an actual isolated Codex installation runs
Then all seven hook identities resolve, declared deadlines retain the 500 ms margin and inert force-push input is denied with exit 2 and a reason
And the existing Spur 0.5.0 prerequisite and PR-10 closure/optional runtime-enforcement deferral remain documented without an invented manifest field
```

### Q&A

<!-- CLOSED decisions from refinement: what was chosen and why, what was deferred and on what
     condition. Not a parking lot for open questions — an unanswered question here means the task
     is not ready to hand off. Keep empty if none. -->

#### Q&A entry — 2026-10-15T18:32:42.610Z

Closed by ready audit: retain seven canonical scripts/hooks entries and their eight hook-only libs; hook logic/error handling is an approved exception. Delete only the obsolete script-root identity probe, not independent launch/provenance/base-sha protection. Generated bundle/build:plugin-lib deletion and the PR-10 decision are already done; former R5/AC2 are removed without renumbering the remaining identities. Add R8/AC3 for supported Superskill pins and actual installed runtime proof. Minimum verified runtime is 0.3.39; a newer explicit operator selection may replace the exact pin before implementation, but no unrelated ts-* upgrade is introduced. I3 currently verifying means keep its inventory. Retain the live agent-bare-binary-name transition until its own removal condition holds. Parent1211 owns final acceptance and any later branch cleanup.

### Design

No new public CLI/API. Task 1212 must be accepted/landed first and leave its five reusable tools migrated to approved CLI surfaces; this task retires the last non-hook installation machinery and must not re-own unfinished PR-9 behavior. Handoff to parent 1211: final retained-file disposition, integrated hook/layout/coverage receipts and accepted commit for umbrella closure.

Frozen targets and operations:

- Delete plugins/sp/scripts/script-root.{ts,mjs}, plugins/sp/lib/spur-bin.ts, plugins/sp/tests/{script-root,spur-bin}.test.ts, config/{plugin-scripts,script-placement-baseline}.json. Remove root build:scripts and its invocation from build. bundle-plugin-lib/build:plugin-lib and generated bundles are already absent: no repeated migration.
- Keep hooks/hooks.json as registry; scripts/hooks contains only the seven currently registered entries. Keep lib/{env,agent-hint,context-owner,context-post-tool,context-session-start,context-session-stop,destructive-policy,task-file-policy}.ts. Hook payload/error logic is the explicit plugin exception; do not shorten safety/error handling to meet a cosmetic wrapper count. No new non-hook helper or compatibility wrapper.
- In config/workflows/task-pipeline.yaml precheck onEnter remove only the obsolete script-resolution identity action. In plugins/sp/skills/spur-dev/references/inline-pipeline-driver.md remove its corresponding probe and obsolete script-root artifact assumptions. Preserve CLI launch argv/installed-binary checks, base SHA, workflow trace, attribution, persisted task evidence and guard semantics. Update plugins/sp/tests/task-pipeline-resilience.test.ts to assert those surviving safeguards rather than script-root execution.
- Keep scripts/commands/script-contract-check.ts as the repo checker and its existing --placement-only entry used by config/rules/boundary/sp-script-placement.yaml; retain default package script entry. Remove manifest/baseline/twin-specific internals and their caller-free private options. Assert no non-hook skill scripts, registry IDs resolve to canonical hook files, no shadow entries in hooks/, and no forbidden value imports or retired invocation patterns. Rewrite checker tests to exercise actual valid/invalid layouts, not an empty checker/no-op.
- Simplify scripts/commands/{plugin-install-smoke,verify-pack,bundle-plugins}.ts and tests plus affected source contract tests. Keep standalone and packaging checks substantive. An actual temporary Codex installation through the pinned Superskill verifies all seven identities, 5/10/15-second declaration margins and careful-guard exit-2 denial with force-push supplied solely as JSON; do not execute a force push. Existing native Pi rendering tests remain; live Pi TUI calls are not a normal gate.
- Update package.json catalog and bun.lock, and the pre-existing .github/workflows/publish.yml Superskill installation line from 0.3.28, to the same supported exact release (baseline 0.3.39). This narrow packaging caller correction follows the approved dependency contract; no new workflow, triggers, secrets, providers or gate policy edits. The separate ts-*0.5.28 upgrade is not part of this task; merge any already-landed version change rather than undo it.
- Keep config/transition-shims.json's agent-bare-binary-name entry while its marker/consumers remain. Keep surface-drift-inventory while I3 is verifying; only remove after a fresh CLI status and consumer audit support it. Update current placement/installation docs and plan §12; preserve historical proposals with a clear current overlay.

Verification owners: scripts/commands/{script-contract-check,verify-pack,bundle-plugins}.test.ts, plugins/sp/tests/task-pipeline-resilience.test.ts and plugins/sp/tests/hooks/*.test.ts. Add scripts/commands/plugin-install-smoke.test.ts only if its real-install regression cannot be covered by the existing checker/packaging test harness. No standalone-lib-imports test file currently exists; standalone import negatives already live in script-contract-check.test.ts. Use temporary fixtures without node_modules to observe standalone behavior, and native process argv for fake external collaborators. Preserve existing timeout/fail-open semantics distinct from fail-closed asks.

Non-goals: new minCliVersion schema/runtime version check, unrelated transition cleanup, feature restructuring, shortening guards, generic harness moved into repository scripts, changing publishing behavior, dependency-family upgrades, or deleting historical evidence. One main worktree and parent1211 only at wip were observed; recheck ownership and installed lockfile versions after 1212 lands.

### Plan

1. (R1,R4,R8) Wait for accepted/landed 1212, start a clean task branch/worktree from current main, reconcile any intervening dependency upgrades, and verify installed versions match the lockfile. Capture I3 status and final surviving caller inventory.
2. (R1,R3) Remove script-root probes from canonical workflow/inline driver and retire its files/tests plus spur-bin and exhausted manifests/build:scripts. Preserve base-sha/evidence capture and CLI resolution; update resilience tests to prove those retained safeguards.
3. (R2,R3) Rewrite placement/checker tests for hook-only scripts and standalone libs, retaining --placement-only and substantive rejection paths. Simplify packaging/smoke consumers; preserve unrelated live transition shims and I3 inventory with reasons.
4. (R6,R8) Align exact supported Superskill root/release-smoke pins and lockfile; reconcile current README/governance/plan disposition and final acceptance layout while preserving the already-closed PR-10 decision and historical records.
5. (R2,R3,R7,R8) Run focused checker/pack/install/standalone/resilience tests. Perform an actual isolated Codex install with supported Superskill, verify all hook IDs/timeouts and inert force-push denial, and scan shipped skills/YAML for deleted invocations.
6. (R7) Rebuild generated CLI config through its owner, link/bundle CLI only if source changed, run serialized required gate and plugin-smoke; record exact head, per-file coverage and remaining environmental limits. Keep feature gate out of normal gate/CI.
7. (R6,R7) Submit to root review/acceptance with retained-file reasons and final integrated receipts. Parent1211 then performs final umbrella review/verification/status evidence; this task does not mark the parent done or delete pre-existing remote branches.

### Solution

<!-- Filled during implementation: file:line change map and concise rationale. -->

### Testing

<!-- Filled during verification: commands run, outcomes, coverage claim or N/A. -->

### Review

<!-- Filled during review: P1-P4 findings, residual risk, and final disposition. -->

### References

- Parent task1211, prerequisite1212, existing active feature A91; no feature restructuring.
- docs/plans/2026-10-14-spur-script-absorption.md landing revision and §12; ADR-065/ADR-130; docs/design/harness-surface-governance.md.
- Accepted ready stack https://github.com/gobing-ai/spur/pull/28; Superskill generic/native hooks https://github.com/gobing-ai/superskill/pull/5 and staged-timeout correction https://github.com/gobing-ai/superskill/pull/6.
- config/workflows/task-pipeline.yaml:238 and plugins/sp/skills/spur-dev/references/inline-pipeline-driver.md:103 are surviving script-root consumers.
- package.json:44 still selects Superskill0.3.37; .github/workflows/publish.yml:48 installs0.3.28; plugins/sp/README.md:557 already documents0.3.39 and :563 Spur0.5.0.
- I3 was verifying at refinement; repeat feature show I3 before conditional deletion. config/transition-shims.json carries one unrelated agent-bare-binary-name entry.
- One main worktree and only orchestration parent1211 at wip were observed; execution remains serial after1212.

### History
