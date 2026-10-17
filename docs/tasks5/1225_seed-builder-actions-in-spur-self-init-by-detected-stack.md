---
schema_version: 1
name: Seed builder actions in spur self init by detected stack
status: todo
template: feature-impl
created_at: 2026-10-17T04:04:39.232Z
updated_at: "2026-10-17T04:16:45.939Z"
feature_id: A92
priority: P2
tags:
  - init
estimate_hours: 3

dependencies: ["1222"]
---

## 1225. Seed builder actions in spur self init by detected stack

### Background

Feature A92 (docs/design/sdlc-actions.md §3.4 init row). Init scaffolds .spur/config.yaml from a template (apps/cli/src/commands/init.ts); it carries no builder block. Covers R9.

**Refine corrections (2026-10-16)**
- Said init scaffolds .spur/config.yaml from a template file → it writes an inline YAML string (apps/cli/src/commands/init.ts:307); SCAFFOLD_MANIFEST (apps/cli/src/config/scaffold-manifest.ts:39) holds rules/templates/docs only → the builder block is appended to that inline string.
- Earlier premise cited init.ts:160 for project config → that block is global-config seeding (seedGlobalConfig) → citation replaced.
- R4 'never overwrite on re-run' → init without --force already converges without rewriting config (init.ts:223); with --force the config is rewritten by existing semantics → R4 restated against that behavior.

### Requirements

- [ ] R1. A fresh `spur self init` in a directory with `bun.lock` or `bun.lockb` writes `builder:\n  preset: bun` into .spur/config.yaml.
- [ ] R2. With a Makefile and no bun lockfile, init writes `preset: none` plus `builder.actions.<a>: make <a>` for each reserved action name that is a Makefile target.
- [ ] R3. With neither (e.g. only pyproject.toml), init writes `preset: none` and a commented `actions:` skeleton listing the reserved names.
- [ ] R4. Re-running init without `--force` leaves an existing .spur/config.yaml untouched (existing converge path); `--force` regenerates it with the R1–R3 detection.
- [ ] R5. The generated config loads cleanly under the 1222 schema.

Out of scope: detecting npm/pnpm/yarn, poetry, just, cargo; parsing Makefile includes or pattern rules; invoking make.

### Acceptance Criteria

- [ ] AC1 — spur init seeds builder.actions for the detected stack

Requirement map: AC1 → R1–R5. Test layer: apps/cli/tests/commands/init.test.ts spawning the real CLI on temp fixtures (E2E).

### Q&A

<!-- CLOSED decisions from refinement: what was chosen and why, what was deferred and on what
     condition. Not a parking lot for open questions — an unanswered question here means the task
     is not ready to hand off. Keep empty if none. -->

#### Q&A entry — 2026-10-17T04:05:55.038Z

- Stack detection happens only at init and is written down for review (ADR-139 rejects runtime detection).
- Makefile targets are parsed with `^([a-z][a-z0-9-]*):`; make is never invoked.

#### Q&A entry — 2026-10-17T04:16:45.744Z

- Stack detection happens only at init and is written down for review (closed: ADR-139).
- Makefile targets are parsed with a regex; make is never invoked (closed).
- When both bun lockfile and Makefile exist, bun wins (closed: spur-new itself has both shapes possible; bun preset is the compatibility default).

### Design

WHAT: init-time stack detection that writes a reviewable builder block.
WHERE: apps/cli/src/commands/init.ts — a pure helper `renderBuilderBlock(files: { bunLock: boolean; makefile: string | null }): string[]` appended to the inline config lines at init.ts:307; tests in apps/cli/tests/commands/init.test.ts (extend).

Detection order: bun lockfile → bun; else Makefile → none + targets; else skeleton. Target parse: lines matching `^([a-z][a-z0-9-]*):(?!=)` (skip `:=` assignments), intersected with RESERVED_ACTIONS from 1222.

Why: ADR-139 allows stack detection only at init, written down for review.

Anti-patterns: no runtime detection anywhere else; no make invocation; no new init flag; do not touch SCAFFOLD_MANIFEST.

Assumes from 1222: RESERVED_ACTIONS export and the schema (R5).

### Plan

1. List failure modes: no manifest, bun lock + Makefile both present (bun wins), Makefile with `:=` assignments, Makefile with no matching targets, re-run without/with --force.
2. Add renderBuilderBlock and append it at init.ts:307 (R1–R3).
3. E2E: run the real `spur self init` on temp fixtures (bun, make, pyproject, re-run, --force) and keep the generated configs as the artifact; load each through the config loader (R4, R5).
4. `bun run spur-check`.

### Solution

<!-- Filled during implementation: file:line change map and concise rationale. -->

### Testing

<!-- Filled during verification: commands run, outcomes, coverage claim or N/A. -->

### Review

<!-- Filled during review: P1-P4 findings, residual risk, and final disposition. -->

### References

<!-- Links to the parent feature, design docs, related tasks, or external references. -->

### History
