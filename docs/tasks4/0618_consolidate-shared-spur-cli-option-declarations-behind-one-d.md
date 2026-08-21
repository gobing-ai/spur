---
schema_version: 1
name: "Consolidate shared spur CLI option declarations behind one definition site"
status: done
template: feature-impl
created_at: 2026-08-20T23:18:21.568Z
updated_at: "2026-08-21T19:21:33.585Z"
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

- [x] R1. Add a single definition site for shared CLI option declarations — a shared option's flag string and description exist in exactly one place.
- [x] R2. Convert the command modules to consume the registry for every option shared by two or more commands, leaving single-command options declared locally.
- [x] R3. Add a parity check that fails when a command re-declares a shared option with divergent wording.
- [x] R4. Keep every command's resolved `--help` output byte-identical before and after the consolidation, resolving any pre-existing wording divergence by choosing one canonical text and recording the change.
- [x] R5. Document the registry as the place new shared options are added, in `docs/04_DESIGN.md` and the `sp:spur-cli` reference.

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

- [x] Inventory the shared options mechanically across the 14 command modules and record the counts
- [x] Add the registry module holding one declaration per shared option (R1)
- [x] Convert the command modules to consume it, leaving single-command options local (R2)
- [x] Diff resolved `--help` output for every command before and after; reconcile any pre-existing divergence deliberately (R4)
- [x] Add the parity check that fails on a divergent re-declaration (R3)
- [x] Document the registry as the home for new shared options (R5)
- [x] Run `bun run lint`, `bun run test`, and the `sp:spur-cli` parity gate

### Solution
Single definition site: `apps/cli/src/commands/shared-options.ts` exports `SHARED_OPTIONS` (72 `readonly [flags, description] as const` tuples), `SharedOptionKey` (`apps/cli/src/commands/shared-options.ts:124`), and the derived membership set `SHARED_OPTION_FLAGS` (28 flag strings, `apps/cli/src/commands/shared-options.ts:127`). Membership rule: a flag string declared in ≥2 command modules qualifies; **every** (flag, desc) pair of that flag string gets an entry, so single-module texts of a shared flag are also registry-owned — this makes the parity check total.

**Design decision — split, no `--json` unification.** The prior session leaned toward unifying `--json`'s descriptions behind one canonical text. Overturned: the 9 `--json` description variants are not divergent wording for one concept but semantically distinct texts (e.g. serve's `Output { port, url, pid } and exit`). R4's byte-identical clause and scenario R9's "help output is unchanged" would both be violated by rewriting 9 published help pages — exactly the wording change riding along with a refactor that the Design section forbids. R4's "choose one canonical text" clause is per-divergence discretion; the chosen resolution is the registry split (one entry per pair), recorded here. Registry completeness was re-derived from source: the prior 39/64-entry plans missed 8 declarations (`--json` has 9 distinct descs, `--from-file` has 3); the final registry holds all 72 (flag,desc) pairs, script-validated `missing: set(), extra: set()`.

**Conversion.** All 13 command modules consume the registry at 161 call sites via `.option(...SHARED_OPTIONS.<key>)` (task 52, feature 28, workflow 17, agent 14, rule 12, history 10, message 8, projects 7, team 5, init 3, serve 3, migrate 1, status 1; `stubs.ts` has none). Parser/default/collector arguments are preserved at the call sites, appended after the spread — e.g. `--dedupe-within` keeps its `Number` parser (`apps/cli/src/commands/task.ts:150-153`) and `task batch-create` keeps `requiredOption(...SHARED_OPTIONS.fileTaskBatch)` (`apps/cli/src/commands/task.ts:812`). Spreading the literal tuple preserves `@commander-js/extra-typings` `opts.<name>` inference — verified by a tsc probe after converting `task.ts` first, then `tsc --noEmit` exit 0 across all 14 modules.

**Downstream surface-parser fix.** `apps/cli/tests/consistency.test.ts` (noun inventory + `--json` claims vs doc) reads source text; it now excludes `shared-options.ts` from the noun scan and recognizes `.option(...SHARED_OPTIONS.json*)` spreads as `--json` claims (`apps/cli/tests/consistency.test.ts:179-189`).
### Testing
**Pipeline verify results**

- Verdict: PASS (from verdict artifact)

| Requirement | Status | Evidence |
|-------------|--------|----------|
| Scenario: R9 — Shared CLI option declarations resolve from one definition site | MET | Flag string + description of every option shared by ≥2 commands live once in `apps/cli/src/commands/shared-options.ts:1-18` (72 (flag,desc) tuples over 28 flag strings); all 13 command modules spread registry entries (161 sites); any literal of a `SHARED_OPTION_FLAGS` member fails (`apps/cli/tests/shared-option-parity.test.ts:34-45`); all 87 `--help` pages byte-identical before/after. |
| R1. Add a single definition site for shared CLI option declarations — a shared option's flag string and description exist in exactly one place. | MET | `SHARED_OPTIONS` + `SharedOptionKey` + `SHARED_OPTION_FLAGS` at `apps/cli/src/commands/shared-options.ts:1-18`; command modules contain zero literal declarations of registry flag strings (script sweep: 0 leftover, all 72 entries spread). |
| R2. Convert the command modules to consume the registry for every option shared by two or more commands, leaving single-command options declared locally. | MET | 161 call sites converted across 13 modules (task 52, feature 28, workflow 17, agent 14, rule 12, history 10, message 8, projects 7, team 5, init 3, serve 3, migrate 1, status 1); parsers/defaults/collectors preserved after the spread (e.g. `apps/cli/src/commands/task.ts:150-153` keeps `Number`); single-command options untouched. |
| R3. Add a parity check that fails when a command re-declares a shared option with divergent wording. | MET | `apps/cli/tests/shared-option-parity.test.ts:34-45` fails on any literal declaration of a `SHARED_OPTION_FLAGS` member (stricter than divergent wording); mutation check: injected `--json` literal made it fail, removal restored green; reverse checks pin spread≥1 module and flags≥2 modules. |
| R4. Keep every command's resolved `--help` output byte-identical before and after the consolidation, resolving any pre-existing wording divergence by choosing one canonical text and recording the change. | MET | 87 help pages dumped before/after; `diff -r` empty. No rewrite needed: one registry entry per (flag,desc) pair preserves every published description verbatim; the prior session's `--json` unification lean was overturned and recorded in Solution. |
| R5. Document the registry as the place new shared options are added, in `docs/04_DESIGN.md` and the `sp:spur-cli` reference. | MET | `SHARED_OPTIONS` documented: `docs/04_DESIGN.md` §1.0.1 "Shared option registry" (`docs/04_DESIGN.md:111-117`) + `plugins/sp/skills/spur-cli/SKILL.md:106-112` + note appended to all 8 noun reference files. |
- Coverage: N/A (verdict-based; verify pipeline does not measure code coverage)
### Review
**Verdict: PASS** — inline review (functional traceability + SECUA), session inline-20260821-094623-0618.

| Priority | Area | Finding | Evidence |
|---|---|---|---|
| P4 | Verify | No P1–P3 findings. Registry documented in `docs/04_DESIGN.md` §1.0.1 (`docs/04_DESIGN.md:111`) and `sp:spur-cli` SKILL.md "Shared option registry" (`plugins/sp/skills/spur-cli/SKILL.md:106`) + a note appended to all 8 noun references | R5 MET |
| P4 | Risk | Registry is source-of-truth for 28 flag strings; drift now structurally impossible (parity test fails on any literal of a shared flag) | `apps/cli/tests/shared-option-parity.test.ts:34-45` |
| P4 | Risk | Anchor citations in 5 older task files (0384, 0591, 0609, 0622) repointed after line renumbering; task 0570 baseline entry went STALE (anchor now matches) — pruned this commit | `config/corpus-baseline.json` |
| P4 | Verify | Help output unchanged across the entire CLI surface: 87/87 pages byte-identical | R4 MET |
### References

<!-- Links to the parent feature, design docs, related tasks, or external references. -->

### History
- 2026-08-21T16:46:23.966Z todo → wip (system)
- 2026-08-21T17:47:15.279Z wip → testing (system)
- 2026-08-21T17:47:45.277Z testing → done (system)
