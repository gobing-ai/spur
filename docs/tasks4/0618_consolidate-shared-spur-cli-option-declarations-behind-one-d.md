---
schema_version: 1
name: "Consolidate shared spur CLI option declarations behind one definition site"
status: todo
template: feature-impl
created_at: 2026-08-20T23:18:21.568Z
updated_at: "2026-08-20T23:18:37.943Z"
feature_id: A3
priority: P1
dependencies: ["0613"]
---

## 0618. Consolidate shared spur CLI option declarations behind one definition site

### Background

The 14 command modules under `apps/cli/src/commands` declare **254** `.option(...)` calls. `--json`
is declared **66** times and `--folder` **25** times, each with its own independently-written
description. There is no shared definition site, so wording drift between two commands' `--help` for
the same flag is invisible until a user notices it.

The `sp` plugin already solved the analogous problem for the `/sp:dev-*` command family:
`plugins/sp/skills/spur-dev/references/flag-glossary.md` holds exactly one canonical entry per shared
flag, and a parity test fails the build when a command declares a shared flag without referencing it.
This task brings the same discipline to the CLI, in code rather than in markdown.

Sibling tasks that add new nouns and verbs depend on this landing first, so they declare their
options against the registry instead of adding entries the registry then has to sweep.

Rubric: E3 D1 L1 C3 R2 = 10 → decompose.

### Requirements

- [ ] R1. Add a single definition site for shared CLI option declarations — a shared option's flag string and description exist in exactly one place.
- [ ] R2. Convert the command modules to consume the registry for every option shared by two or more commands, leaving single-command options declared locally.
- [ ] R3. Add a parity check that fails when a command re-declares a shared option with divergent wording.
- [ ] R4. Keep every command's resolved `--help` output byte-identical before and after the consolidation, resolving any pre-existing wording divergence by choosing one canonical text and recording the change.
- [ ] R5. Document the registry as the place new shared options are added, in `docs/04_DESIGN.md` and the `sp:spur-cli` reference.

### Acceptance Criteria

```gherkin
@core
Scenario: R9 — Shared CLI option declarations resolve from one definition site
  Given the same option is declared independently across many command modules
  When a shared option is used by two or more commands
  Then its flag string and description come from a single definition site
  And a check fails when a command re-declares a shared option with divergent wording
  And every command's resolved help output is unchanged by the consolidation
```

### Q&A

<!-- CLOSED decisions from refinement: what was chosen and why, what was deferred and on what
     condition. Not a parking lot for open questions — an unanswered question here means the task
     is not ready to hand off. Keep empty if none. -->

### Design

**Shared means used by two or more commands** — the same mechanical rule the `sp` flag glossary
already uses. A flag used by one command stays in that command's module; hoisting it would centralize
something with no second consumer and make the registry a dumping ground.

**Code, not markdown.** The `/sp:dev-*` glossary is prose because those commands are markdown files.
The CLI's options are code, so the single definition site is a module the commands import — which
makes divergence a type-level impossibility for adopted options rather than a lint finding.

**Byte-identical help is the safety property.** This is a consolidation of a published contract, not a
redesign of it. Where two commands' existing descriptions already diverge for the same flag, the task
picks one canonical text and records the change explicitly rather than letting a wording change ride
along invisibly with a refactor.

**The parity check is what keeps it true.** Without a check, the next command added declares
`--json` inline and the registry silently becomes advisory — the same failure mode the flag-glossary
parity test was written to prevent.

**This lands before the new-surface tasks** so `spur self`, `spur builder`, `spur workflow show`, and
the two `--fix` flags are authored against the registry from the start.

### Plan

- [ ] Inventory the shared options mechanically across the 14 command modules and record the counts
- [ ] Add the registry module holding one declaration per shared option (R1)
- [ ] Convert the command modules to consume it, leaving single-command options local (R2)
- [ ] Diff resolved `--help` output for every command before and after; reconcile any pre-existing divergence deliberately (R4)
- [ ] Add the parity check that fails on a divergent re-declaration (R3)
- [ ] Document the registry as the home for new shared options (R5)
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
