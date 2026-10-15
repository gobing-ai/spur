---
schema_version: 1
name: Retire obsolete script infrastructure and finalize the sp CLI prerequisite
status: todo
template: standard
created_at: 2026-10-15T17:50:40.227Z
updated_at: "2026-10-15T17:51:07.216Z"
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

Implements task 1211 R2 / AC2 — PR-8 retires the script infrastructure, and R3 / AC3 — PR-10 decision recorded; contributes disposition documentation to R7. Starts after the accepted PR-9 completion task because both touch shared build/packaging contracts and the final caller inventory must include its retirements. PR #23 moves canonical hook entries to plugins/sp/scripts/hooks/<id>.ts and removes the Pi extension; task1211 AC2 supersedes the plan's stale statement that plugins/sp/scripts disappears entirely. Keep plugin-owned hook logic and hook-only backing libs. Owner: this task exclusively owns retirement of the remaining script-root/build/baseline infrastructure, packaging/checker contracts, and current owner docs. Parent 1211 owns final cross-repo acceptance and cleanup.

### Requirements

- [ ] R1. Delete remaining script-root.ts/.mjs, plugin lib/spur-bin.ts and its obsolete tests, generated bundles/twins, config/plugin-scripts.json, config/script-placement-baseline.json, and build:plugin-lib/build:scripts entries; remove bundle-plugin-lib only if still present. Preserve plugins/sp/scripts/hooks/<id>.ts and env.ts plus needed hook-only libs.
- [ ] R2. Rewrite script-contract-check and sp-script-placement to enforce the final plugin-owned hook contract without a shrinking baseline. Preserve trust-boundary checks, meaningful standalone import constraints, and plugin hook identities/events/timeouts; non-hook wrappers remain fewer than five lines.
- [ ] R3. Simplify plugin-install-smoke, verify-pack and bundle-plugins and their tests for the surviving installed layout; remove live superskill script path sp, bun plugins/sp skill-script and scriptRoot consumers from shipped docs/workflow YAML. Audit transition-shims.json and retire only entries whose consumers/targets are proven obsolete.
- [ ] R4. Check I3 via feature CLI before deleting surface-drift-inventory: if I3 remains open retain the repo-only inventory tool with a specific documented reason, otherwise delete it and callers/tests. Keep each retained old-path file justified by current responsibility; do not delete historical evidence.
- [ ] R5. Record PR-10 closed as originally designed because there are no context shims. Document sp requires spur >= 0.5.0 in current plugin documentation and plan under the owner hard-break decision. Explicitly defer optional runtime minimum-version enforcement/diagnostics; do not invent minCliVersion metadata or repurpose the unrelated consumer-compat generated-export parser.
- [ ] R6. Reconcile the plan revision, current disposition table and acceptance checklist §12 with canonical scripts/hooks entries, retained libs and Pi removal; clearly label superseded historical design sections. Update governance/README where behavior changed, correct any stale fail-open ask claim, and cite the released superskill/Pi reinstall requirement.
- [ ] R7. Keep root and scripts bunfig.toml unchanged, avoid adding spur-check-feature to gate/CI, and produce successful focused packaging/placement/standalone tests and the serialized required gate with per-file line and function coverage >=90% for changed measured code.

### Acceptance Criteria

```gherkin
Scenario: AC1 — PR-8 retires the script infrastructure (req: R1, R2, R3, R4, R6, R7)
Given the absorption PRs including accepted PR-9 have no live consumers of generated skill scripts
When final packaging, placement and plugin installation checks run
Then obsolete bundles, twins, script-root, spur-bin, baseline manifests and build scripts are absent
And canonical plugin hooks still resolve from scripts/hooks with their required standalone backing libs
And no shipped skill or workflow relies on the deleted infrastructure
And surface-drift-inventory is deleted only when I3 no longer requires it, otherwise its repository-only reason is recorded
And the current plan checklist matches the actual final layout
And bunfig files remain unchanged and the required gate succeeds with per-file coverage evidence

Scenario: AC2 — PR-10 decision recorded (req: R5, R6)
Given PR-10's context-shim implementation has no remaining purpose
When current plugin prerequisite documentation and the plan decision are read
Then they state spur >= 0.5.0 and close PR-10 as originally designed
And optional runtime minimum-version enforcement and diagnostics are explicitly deferred
And no unsupported manifest field, compatibility layer or misleading implementation claim is introduced
```

### Q&A

<!-- CLOSED decisions from refinement: what was chosen and why, what was deferred and on what
     condition. Not a parking lot for open questions — an unanswered question here means the task
     is not ready to hand off. Keep empty if none. -->

### Design

Retire infrastructure only after its last migrated consumer is accepted. Canonical hooks remain plugins/sp/scripts/hooks/<id>.ts, registered in hooks/hooks.json and executed generically by superskill; plugin lib keeps only actual hook dependencies. Own scripts/commands/{script-contract-check,plugin-install-smoke,verify-pack,bundle-plugins}.ts and tests, related package scripts/config/rules, transition-shims audit, and current placement/installation docs. Reject an extra tiny PR-10 task: declaring the prerequisite and closing the obsolete shim proposal share this final distribution contract. No new minimum-version schema is supported by the current plugin manifest, and consumer-compat.ts diagnoses legacy missing bundle exports, so runtime enforcement is explicitly deferred. Preserve recorded history; revise current summaries instead of deleting decision history.

### Plan

1. Incorporate the accepted PR-9 result, enumerate all surviving script infrastructure callers and read current I3 status via the feature CLI.
2. Delete only exhausted infrastructure and update packaging/placement/standalone assertions for canonical scripts/hooks plus surviving hook libs.
3. Reconcile remaining installed-layout consumers and transition shims, retaining needed repo-only inventory tooling with reasons.
4. Update plan current revision/dispositions/§12 and README/governance; close obsolete PR-10 with the documented >=0.5.0 prerequisite and explicit optional enforcement deferral.
5. Run focused checker, install/pack and standalone tests, then the serialized required gate with receipts; submit to parent reviewer for acceptance.

### Solution

<!-- Filled during implementation: file:line change map and concise rationale. -->

### Testing

<!-- Filled during verification: commands run, outcomes, coverage claim or N/A. -->

### Review

<!-- Filled during review: P1-P4 findings, residual risk, and final disposition. -->

### References

<!-- Links to features, docs, ADRs, related tasks, or external references. -->

### History
