---
template: issue
schema_version: 1
name: "Decide where the intention vocabulary is defined, owned, and versioned"
description: ""
status: cancelled
type: issue
profile: standard
feature_id: B2
parent_wbs: null
priority: P2
tags: ["wayfinder:grilling", "boundary", "sp-plugin"]
dependencies: ["0344"]
created_at: "2026-07-27T01:27:19.136Z"
updated_at: "2026-07-27T01:51:39.282Z"
---

## 0345. Decide where the intention vocabulary is defined, owned, and versioned

### Background

Wayfinder ticket for map B2. Type: grilling (`sp:dev-refine`). Blocked by B2-02 — the emission model determines what the vocabulary must support.

The operator's goal is that plugin `sp` holds no executor knowledge and the operator declares everything in config. Achievable, but `sp` must still own *something*: if skills declare intentions, `sp` owns the intention vocabulary — the contract — while the operator owns the intention→tier→executor mapping.

Open: where that vocabulary lives (sp plugin, a domain package, config, or a published schema), who may extend it, what happens when a skill declares an intention the operator's config does not map, and how it is versioned across `sp` and `spur` releases that ship independently.

This also decides the fate of the 21 commands with no stage record today — whether every command must declare an intention or whether an unmapped command is legal.

### Requirements
R1. Decide the home and owner of the intention vocabulary, and record the reason.

R2. State whether operators may define custom intentions or only map the supplied ones.

R3. Define the behavior for an intention a skill declares but the operator's config does not map — hard error, silent default, or warning plus default.

R4. State the versioning and compatibility story for `sp` and `spur` shipping on independent release cadences.

R5. State whether every dispatcher must declare an intention, or whether un-annotated dispatch stays legal — and what it resolves to.

R6. Do not implement — end at a recorded decision.
### Acceptance Criteria

<!-- Given/When/Then regression scenario or checklist proving the bug is fixed. -->

### Q&A

<!-- Clarifications and triage decisions. Keep empty if none. -->

### Design

<!-- Fix approach and tradeoffs. Keep this short unless the issue changes architecture. -->

### Plan

<!-- Ordered debugging/fix checklist. Fill before moving to todo/wip. -->

### Root Cause

<!-- Verified underlying cause with file:line evidence. Fill once reproduced/isolated. -->

### Solution
**Merged into 0344 on 2026-07-26 — not resolved independently.**

The operator's two-layer ruling answered this ticket's core question directly:

- **Layer 1 — intention → tier** lives in a shared reference file under `plugins/sp`, included by the
  skills that need it. It names intentions and tiers only, never an executor, model, or vendor.
- **Layer 2 — tier → executor** lives in the operator's `.spur/config.yaml`.

That settles ownership (`sp` owns the vocabulary and its tier mapping; the operator owns the roster)
and settles the home (a reference file, not per-skill frontmatter — because comprehensive skills such
as `plugins/sp/skills/spur-dev` carry multiple intentions and cannot declare just one).

What remains — defining the actual vocabulary, the unmapped-intention behavior, and the `sp`/`spur`
release-cadence compatibility story — is now carried by 0344, which owns the whole intention contract.
Closing this separately would split one contract across two tickets.
### Testing

<!-- Filled during verification: regression command(s), outcomes, coverage claim or N/A. -->

### Review

<!-- Filled during review: P1-P4 findings, residual risk, and final disposition. -->

### References

<!-- Links to failing logs, related issues, tasks, docs, or external references. -->

### History
- 2026-07-27T01:51:39.282Z todo → cancelled (system)
