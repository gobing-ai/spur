---
schema_version: 1
name: "Add the spur builder noun with bump-ver and drop-tags promoted from spur-dev"
status: todo
template: feature-impl
created_at: 2026-08-20T23:18:21.555Z
updated_at: "2026-08-20T23:18:38.364Z"
feature_id: A3
priority: P1
dependencies: ["0613", "0618"]
---

## 0617. Add the spur builder noun with bump-ver and drop-tags promoted from spur-dev

### Background

`bumpVer` and `dropTags` live in `scripts/commands/release.ts` behind
`bun scripts/spur-dev.ts bump-ver|drop-tags`. Unlike the rest of spur-dev — which builds Spur
itself, packages it, or gates this monorepo — version bumping and release-tag cleanup are
project-agnostic: any Spur-managed project wants them, and today every such project would reimplement
them.

`release.ts` has no test sibling, which ADR-051 requires even for internal spur-dev commands; the
promotion adds one rather than carrying the omission across the boundary.

The operator's constraint is explicit and is part of the deliverable: exactly these two verbs move.
`spur builder` must not become a dumping ground, because every verb landed there is a permanent
public API commitment for every Spur-managed project.

Rubric: E2 D1 L1 C2 R2 = 8 → decompose.

### Requirements

- [ ] R1. Add a `builder` noun exposing `bump-ver` and `drop-tags` whose behavior matches the current `scripts/commands/release.ts` implementations, including flags such as `--all`, `--push`, and `--remote`.
- [ ] R2. Leave the `bun scripts/spur-dev.ts bump-ver|drop-tags` entries working as thin forwarders to the promoted implementation, with no second copy of the logic.
- [ ] R3. Add the missing test sibling covering both verbs, including the tag and push paths.
- [ ] R4. Record in the ADR-051 amendment site and `docs/04_DESIGN.md` that no further spur-dev command is promoted by this work, and that each future promotion needs its own justification.
- [ ] R5. Update `docs/help/spur-cli-matrix.md` and add the `docs/help/cmd_builder.md` page in the same commit.

### Acceptance Criteria

```gherkin
@core
Scenario: R8 — spur builder exposes exactly the two promoted verbs
  Given release plumbing that is genuinely useful to any project rather than to this monorepo alone
  When the builder noun ships
  Then bump-ver and drop-tags are reachable as spur builder verbs with behavior matching their internal originals
  And no further internal command is promoted as part of this work
  And the record states that each future promotion needs its own justification
```

### Q&A

<!-- CLOSED decisions from refinement: what was chosen and why, what was deferred and on what
     condition. Not a parking lot for open questions — an unanswered question here means the task
     is not ready to hand off. Keep empty if none. -->

### Design

**One implementation, two entry points.** The logic moves into the CLI and the spur-dev dispatcher
forwards to it. Copying would give this repo's release path and every other project's release path
two divergent behaviors of the same command — the misplacement pattern this feature is closing.

**Why these two and not the rest.** `publish`, `bundle-*`, `verify-pack`,
`check-marketplace-version`, `build-cli`, `build-binaries`, `dev-all`, and `link-check` all encode
facts about *this* monorepo: its package layout, its tarball contents, its marketplace, its linked
`@gobing-ai` dependencies. Version bump and tag drop encode only git and semver. That is the line,
and it is written down so the next promotion argues against it explicitly.

**The missing test sibling is fixed on the way through, not after.** Promoting an untested command
into a published contract is how an untested command becomes permanently untested.

**Consent is recorded centrally** by the authority task; this task implements against it.

### Plan

- [ ] Read `scripts/commands/release.ts` and the `spur-dev.ts` dispatch entries to fix the extraction boundary
- [ ] Move the implementations into the CLI under a `builder` noun with both verbs and their flags (R1)
- [ ] Replace the spur-dev entries with thin forwarders, leaving no duplicated logic (R2)
- [ ] Add the test sibling covering both verbs including tag and push paths (R3)
- [ ] Record the no-further-promotion rule in the ADR amendment site and `docs/04_DESIGN.md` (R4)
- [ ] Update the CLI matrix and add `docs/help/cmd_builder.md` (R5)
- [ ] Run `bun run lint`, `bun run test`, and the `sp:spur-cli` parity gate

### Solution

<!-- Filled during implementation: file:line change map and concise rationale. -->

### Testing

<!-- Filled during verification: commands run, outcomes, coverage claim or N/A. -->

### Review

<!-- Filled during review: P1-P4 findings, residual risk, and final disposition. -->

### References

<!-- Links to the parent feature, design docs, related tasks, or external references. -->

### History
