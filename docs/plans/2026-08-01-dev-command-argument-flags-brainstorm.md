# Dev Command Argument Flags Contract — Brainstorm

**Date:** 2026-08-01  
**Status:** Recommended approach selected; design approval pending  
**Decision owner:** Robin  
**Confidence:** High

## Overview

The 28 `plugins/sp/commands/dev-*.md` wrappers currently compress syntax, semantics, defaults, and
glossary navigation into `argument-hint`. That frontmatter is hard to scan and hard to validate:
24 commands contain Markdown links in their hints, while the command validator permits only
`## Usage` and `## Implementation`. The existing flag-parity test covers only commands represented
in the numbered dev-operation table, so its claim that the shared glossary is derived from all 28
commands is stronger than its actual coverage.

The real requirement is a three-layer contract:

1. `argument-hint` is syntax-only and suitable for native slash-command completion surfaces.
2. Every dev wrapper has a machine-checkable `## Argument Flags` table for command-local semantics
   and defaults.
3. The canonical flag glossary owns shared semantics, while command, skill, workflow, and
   dev-operation surfaces remain mechanically consistent.

This is a contract migration, not a prose cleanup. Every positional argument and flag must be
classified before editing, and removal requires compatibility evidence.

## Discovery Evidence

Repository inventory on 2026-08-01 found:

- 28 dev commands, 188 flag occurrences, and 64 unique flag spellings.
- 89 Markdown links in `argument-hint`; 24 of 28 hints contain at least one link.
- `validate-commands.ts` and `command-contract.test.ts` both hard-code the exact heading set
  `{Usage, Implementation}`.
- `command-flag-parity.test.ts` derives parity only from commands present in the numbered
  `dev-operations.md` table and requires a per-flag deep link from each command.
- Three wrappers already contain ad hoc flag tables inside `## Usage`, confirming the need for a
  uniform location and schema.
- ADR-032 makes command Markdown the hand-editable source of truth and Superskill adapters
  install-time output. A central generated command registry would reverse that decision.

Preliminary semantic drift found during discovery:

| Surface | Finding | Required disposition |
| --- | --- | --- |
| `dev-review` | Its positional target is intentionally optional, but detailed dev-operation prose says required. | Keep optional; correct the operation contract. |
| `dev-runall` | The operation map and command expose `--next`, while detailed prose still says “No `--next`.” | Retain `--next`; update detailed semantics to the batch-once behavior. |
| `dev-wrap`, `dev-wrapall` | Commands and operation map expose `--dry-run`; detailed input prose omits it. | Add it to the operation inputs. |
| `dev-fixall` | Its command exposes `[<validation-command>]` and `--max-retry`; detailed input prose documents only `--scope`. | Add the missing inputs and defaults. |
| `dev-debug` | The command exposes symptom, `--scope`, and `--task`; historical task evidence says this was intentional, but the backing skill lacks an explicit input contract. | Retain and add the missing skill contract. |
| `dev-dogfood` | The command exposes `--full`; the report contract defines it, but the skill argument table omits it. `--save` is an explicit compatibility no-op. | Add `--full`; retain and label `--save` until an evidenced retirement window. |
| `--keep-going` glossary | Names `dev-verifyall`, which does not expose the flag. | Remove that command from the entry unless implementation evidence proves the flag exists. |
| `--tasks` glossary | Omits `dev-refineall`. | Add the command and its selector/default semantics. |
| `--output` glossary | Names `dev-changelog`; public declarations are `dev-daily` and `dev-reverse`. | Reconcile against backing behavior, then correct the entry. |
| `--description` glossary | Names `dev-idea`, which uses positional `<idea>`. | Restrict to actual declaring commands. |
| `--scope` glossary | Its declaring-command description omits architecture, debug, and simplify wrappers. | Derive availability across all 28 commands. |
| `--full`, `--task` | Each spelling has command-context meanings not represented by the current single-meaning glossary prose. | Document context-specific semantics or introduce a compatible rename; do not silently collapse meanings. |

Recognized compatibility spellings must be audited even when absent from canonical hints:
`dev-idea --idea-approved/--design-approved`, `dev-plan --design-approved`,
`dev-verify* --skip-shipable`, `dev-review --fix`, `dev-dogfood --save`, and dogfood's accepted
single-dash forms. Canonical hints should remain canonical syntax; compatibility belongs in the
table description, owning contract, and tests.

## Constraints

- Preserve ADR-032: command Markdown remains the source; no parallel JSON/YAML command registry.
- Permit exactly one new level-two heading, `## Argument Flags`, immediately before `## Usage`.
- Use the exact table columns `Flag`, `Description`, and `Default` in every dev command.
- Include positional arguments in the `Flag` column so the table covers the complete public input
  contract rather than flags alone.
- Keep `argument-hint` free of Markdown hyperlinks and explanatory prose.
- Link once from each command's new section to the canonical flag glossary; do not restore per-flag
  hyperlinks in frontmatter.
- Add a public flag only when its backing capability already exists. If the capability is missing,
  record a follow-up rather than advertising fiction.
- Remove a spelling only with implementation, history, and compatibility evidence. Otherwise
  retain it as supported, alias, or deprecated no-op and state its migration behavior.
- Do not edit generated per-platform adapters; validate their dry-run projection through
  Superskill.
- Update authoritative and derived documentation in the same change as the command surface.

## Approaches

### Approach A — Dedicated command-local argument tables (recommended)

Add `## Argument Flags` immediately before `## Usage` in every dev command. Make frontmatter hints
plain syntax, put command-specific meaning and defaults in the table, and include one canonical
glossary reference. Expand the validator and parity tests to enforce structure and semantics across
all 28 commands.

**Benefits**

- Native slash-command hints become compact and renderer-safe.
- Users can discover defaults without leaving the command wrapper.
- Exact heading and table contracts are mechanically enforceable.
- Shared semantics remain centralized without making the glossary an availability registry.
- Preserves ADR-032 and requires no generator or new dependency.

**Costs and risks**

- Touches all 28 command wrappers plus validators, tests, references, and derived docs.
- Local descriptions can drift from shared glossary prose unless parity tests distinguish shared
  meaning from command-specific deltas.
- Context-overloaded spellings such as `--full` and `--task` require explicit treatment.

**Implementation note:** Migrate the contract atomically. A partially migrated tree would make the
validator ambiguous and produce inconsistent adapters.

### Approach B — Keep flag tables inside `## Usage`

Keep the two-heading contract and standardize a table at the top of each existing Usage section.

**Benefits**

- Smallest validator change.
- Avoids expanding the allowed heading vocabulary.

**Costs and risks**

- Mixes input contract, examples, and workflow prose in one section.
- Continues the ad hoc structure already present in only three wrappers.
- Makes table extraction and ordering rules less obvious.
- Does not satisfy the operator-selected dedicated-heading contract.

**Confidence:** Medium that it would work technically; low that it would remain legible.

### Approach C — Generate hints and tables from central metadata

Introduce a typed registry for positions, flags, defaults, aliases, and descriptions, then generate
command frontmatter and tables.

**Benefits**

- Strong single-source parity and easy machine inspection.
- Could generate documentation and adapters from one schema.

**Costs and risks**

- Conflicts with ADR-032's command-as-SSOT decision and repeats the rejected registry direction.
- Adds a generator lifecycle, review indirection, and new failure modes for 28 small wrappers.
- Overlaps Superskill's adapter ownership.

**Confidence:** High that it is unnecessary architecture for this problem.

## Recommendation

Proceed with **Approach A**. It is the smallest design that fixes both human usability and
mechanical completeness without introducing another source of truth. Treat the work as one atomic,
cohesive task because every possible phase edits the same command, validator, glossary, and test
surfaces; splitting audit, migration, and synchronization would create handoff and partial-contract
risk. The estimated effort is 12–16 hours, below the cohesion rule's forced split threshold.

## Design Summary

### 1. Command document contract

Every `plugins/sp/commands/dev-*.md` file has exactly these level-two headings, in order:

```text
## Argument Flags
## Usage
## Implementation
```

No other level-two headings are permitted. Headings inside fenced examples remain ignored by the
validator. Non-dev commands retain the repository-wide command rules unless the implementation
explicitly elects to migrate them; this task's scope is the 28 dev wrappers.

The `argument-hint` value is a one-line syntax expression only. It may contain positional tokens,
flags, alternatives, optional brackets, literals, and quoting, but not Markdown links or prose
definitions. Canonical public spellings appear there; deprecated aliases do not.

### 2. Argument Flags section

Each section contains exactly one table with this header:

```markdown
| Flag | Description | Default |
| --- | --- | --- |
```

The first column includes positional arguments and canonical flags. Alternatives rendered as one
syntax group, such as `--inline | --subprocess`, receive separate rows because they have different
semantics and defaults. Descriptions state the command-local effect; defaults are explicit
(`required`, `omitted`, `off`, a literal value, or a deterministic derived default).

Each section includes one mechanically detectable link to
`../skills/spur-dev/references/flag-glossary.md`. Per-flag deep links are removed from
`argument-hint`; individual table rows may avoid links entirely.

### 3. Semantic ownership and classification

Audit each input across four evidence sources: command surface, backing skill/inline implementation,
workflow variable contract, and repository history/task decisions. Classify it as:

| Class | Meaning | Surface rule |
| --- | --- | --- |
| Required positional | Command cannot operate without it. | Hint + table; default `required`. |
| Optional positional | Deterministic fallback exists. | Bracketed hint + table with fallback. |
| Supported public flag | Backing behavior consumes it. | Canonical hint + table; glossary if shared. |
| Compatibility alias | Accepted spelling maps to a canonical spelling. | Omit from hint; document mapping and test it. |
| Deprecated no-op | Accepted only to avoid breakage. | Omit from canonical hint unless current compatibility policy requires visibility; label clearly. |
| Obsolete candidate | No backing behavior and no compatibility obligation. | Remove only with dated evidence and migration note. |
| Missing public flag | Backing capability exists but the wrapper cannot express it. | Add to hint/table and synchronize owners. |
| Missing capability | Desirable behavior has no implementation. | Do not advertise; create a follow-up outside this task. |

An obsolete removal requires all of: no current consumer, history showing replacement or that it
never worked, no live workflow/adapter dependency, and an explicit compatibility disposition.
Absent that evidence, retention wins.

### 4. Validation architecture

Extend the existing validator rather than add a registry:

- recognize the exact three-heading contract and required order;
- reject Markdown link syntax in dev-command `argument-hint`;
- require one Argument Flags table with exact columns;
- require one canonical glossary reference;
- compare canonical hint tokens with table rows, including positional arguments;
- report command path and offending token/heading in every diagnostic;
- update help text without changing the existing machine-readable output envelope.

Refactor `command-flag-parity.test.ts` so shared-flag discovery uses all 28 dev command
hints/tables. Preserve the separate bidirectional parity check against numbered
`dev-operations.md` rows for commands that belong to that catalog. Compatibility aliases are
validated from explicit owning-contract assertions rather than counted as canonical hint flags.

### 5. Surface synchronization

In the same change:

- rewrite the flag glossary's reference-form contract from per-flag hint links to one command-level
  canonical reference;
- correct shared availability and contextual meanings discovered by the audit;
- reconcile numbered operation rows and detailed Inputs prose;
- add missing argument contracts to backing skills where behavior already exists;
- reconcile workflow variables and documented aliases without inventing new runtime behavior;
- append the command contract decision to `docs/00_ADR.md`, update the surface contract in
  `docs/04_DESIGN.md`, and update `plugins/sp/README.md`.

### 6. Rollout and rollback

Land validator, all 28 wrappers, parity tests, glossary, operation references, and docs atomically.
Superskill-generated adapters are not committed by this task. A dry-run install proves that the new
frontmatter remains portable. Rollback is one cohesive revert; no data or schema migration exists.

### 7. Design approval gate

This design is ready for operator review. The chosen direction is already Approach A, but task
corpus creation should occur only after the idea-evaluation taste gate approves this design
summary. Any request to add a central registry, generate command files, or rename a compatibility
flag changes the approved design and must return to this gate.

## Implementation-Ready Task

### Task: Normalize all dev-command argument contracts

**Goal:** Adopt the dedicated Argument Flags contract across all 28 dev commands and prove every
public or compatibility input against its owning implementation, skill, workflow, and historical
contract.

**Dependencies:** No open task dependency. Completed conceptual prerequisites are ADR-032 and the
existing command validation, inline-execution, and shared-flag glossary work. Do not begin while a
concurrent change is editing the same command/glossary/test surfaces.

**Affected files:**

- `plugins/sp/commands/dev-*.md` (all 28 files)
- `plugins/sp/scripts/validate-commands.ts`
- `plugins/sp/tests/command-contract.test.ts`
- `plugins/sp/tests/command-flag-parity.test.ts`
- `plugins/sp/tests/inline-execution-contract.test.ts` if parsing or explicit exceptions change
- `plugins/sp/skills/spur-dev/references/flag-glossary.md`
- `plugins/sp/skills/spur-dev/references/dev-operations.md`
- backing skill contracts proven stale by the audit, initially including
  `plugins/sp/skills/sys-debugging/SKILL.md`,
  `plugins/sp/skills/sys-architecture/SKILL.md`, its relevant reference, and
  `plugins/sp/skills/dogfood-testing/SKILL.md`
- workflow contracts only where audit evidence proves a declared alias or variable needs
  synchronization
- `docs/00_ADR.md`, `docs/04_DESIGN.md`, and `plugins/sp/README.md`

**Requirements:**

- R1. Build a 28-command audit ledger during implementation. For every positional and flag, record
  its classification, owning consumer, default, compatibility status, and evidence path. Preserve
  the decision summary in task Notes; do not create a second shipped registry.
- R2. Migrate all 28 wrappers to the exact heading, table, reference, and syntax-only hint contract.
- R3. Retain supported and compatibility inputs; remove only obsolete candidates that satisfy the
  complete evidence rule. Add only missing public flags backed by existing capability.
- R4. Extend validation and tests to derive canonical availability across all 28 commands and keep
  numbered dev-operation parity as an additional contract.
- R5. Correct every contradiction identified by the audit across glossary, operation, skill,
  workflow, README, ADR, and design surfaces.
- R6. Preserve command-as-SSOT and Superskill adapter ownership; add no registry, generator,
  package, runtime, schema, or DTO.

**Acceptance Criteria:**

- AC1 — Given any of the 28 dev command files, when command validation runs, then its only
  level-two headings are `Argument Flags`, `Usage`, and `Implementation` in that order, with
  `Argument Flags` immediately before `Usage`.
- AC2 — Given any dev command frontmatter, when `argument-hint` is parsed, then it contains only
  canonical syntax, contains no Markdown hyperlink, and its canonical positional/flag set matches
  the Argument Flags table.
- AC3 — Given any Argument Flags section, when its table is inspected, then it has exactly `Flag`,
  `Description`, and `Default` columns, covers every public positional and flag, and contains one
  canonical glossary reference.
- AC4 — Given a shared flag declared by two or more of all 28 dev commands, when parity tests run,
  then exactly one glossary entry describes its shared or explicitly context-specific semantics;
  availability is derived from command surfaces rather than hand-maintained prose.
- AC5 — Given a compatibility spelling, when audit evidence classifies it, then it is either
  retained with canonical mapping/deprecation behavior and a regression test, or removed with
  dated replacement, consumer, and migration evidence in task Notes.
- AC6 — Given the known discovery contradictions, when authoritative surfaces are reviewed, then
  review target optionality, runall `--next`, wrap dry-run, fixall inputs, dogfood `--full`/`--save`,
  and the identified glossary membership errors are reconciled consistently.
- AC7 — Given a command represented in the numbered dev-operation map, when the command hint/table
  and operation row/detail are compared, then their public positional and flag sets and defaults
  agree bidirectionally.
- AC8 — Given a command not represented in the numbered dev-operation map, when its backing skill,
  inline implementation, or workflow is inspected, then every advertised input has a named
  consumer and every public consumer input is advertised or explicitly internal.
- AC9 — Given Superskill's staged conversion of the plugin, when dry-run installation targets Codex,
  then all dev wrappers convert without frontmatter or Markdown-contract errors and no generated
  adapter is committed.
- AC10 — Given the completed change, when the full repository gate runs, then autofix/spur-check,
  lint, tests, Cloudflare tests, and build pass with only intentional working-tree changes.

**Plan:**

1. Freeze the command inventory and fill the audit ledger from command, skill/inline, workflow, and
   history evidence; resolve contradictions before editing public syntax.
2. Update the validator and negative/positive command-contract fixtures for the new heading,
   table, reference, and syntax-only rules.
3. Migrate all 28 wrappers atomically, including positional rows, explicit defaults, canonical
   spellings, and compatibility descriptions.
4. Expand all-command parity, retain numbered operation parity, and add regression assertions for
   compatibility aliases and contextual shared spellings.
5. Synchronize the flag glossary, dev-operation details, proven-stale backing skills/workflows,
   ADR, design documentation, and README.
6. Run targeted tests, staged adapter conversion, the full repository gate, and a final audit-ledger
   diff against the shipped surfaces.

**Verification:**

```bash
bun test plugins/sp/tests/command-contract.test.ts \
  plugins/sp/tests/command-flag-parity.test.ts \
  plugins/sp/tests/inline-execution-contract.test.ts
bun plugins/sp/scripts/validate-commands.ts --json
rg -n '^argument-hint:.*\]\(' plugins/sp/commands/dev-*.md
superskill install sp --targets codex --dry-run --verbose
bun run autofix
bun run spur-check
bun run lint
bun run test
bun run test-cf
bun run build
git diff --check
git status --short
```

The `rg` command must return no matches. Tests must also include negative fixtures proving that a
linked hint, missing table row, incorrect heading order, duplicate glossary reference, or
unsupported compatibility removal fails loudly.

### Decomposition decision

One task is intentional. Audit, validator change, 28-file migration, glossary reconciliation, and
tests form one deliverable, one rollback unit, and one review context. Candidate phase splits would
edit the same files and permit an invalid intermediate tree. Estimated effort is 12–16 hours;
depth is one dependency layer, the change spans three logical modules (commands, validation/tests,
references/docs), coordination is local, and risk is medium. The cohesion rule overrides a numeric
decomposition suggestion; the greater-than-16-hour forced split does not fire.

## Decision Trace

| Decision | Rationale | AC mapping |
| --- | --- | --- |
| Select Approach A | Best usability and validation gain while preserving ADR-032. | AC1–AC4 |
| Put positional arguments in the Flag column | The table must describe the complete invocation, not only `--` tokens. | AC2, AC3 |
| One glossary link per command | Keeps hints syntax-only and avoids 89 deep links while preserving discoverability. | AC2–AC4 |
| Audit all 28 commands | The current numbered-operation gate leaves coverage gaps. | AC4, AC7, AC8 |
| Retain aliases until evidence permits removal | Public command compatibility is more important than cosmetic uniformity. | AC5, AC6 |
| Keep one cohesive implementation task | Partial migration is invalid and all phases share the same surfaces. | AC1–AC10 |

## The needs_design Signal

`needs_design` is **true**. The work changes a cross-cutting command convention, validator behavior,
test derivation, glossary ownership, and 28 user-facing command surfaces. It does not add a runtime
dependency, schema, DTO, or service boundary, but the breadth and ownership decisions meet the
skill's cross-cutting-convention criterion.

## Sources

All sources were inspected locally on 2026-08-01:

- `plugins/sp/scripts/validate-commands.ts`
- `plugins/sp/tests/command-contract.test.ts`
- `plugins/sp/tests/command-flag-parity.test.ts`
- `plugins/sp/tests/inline-execution-contract.test.ts`
- `plugins/sp/commands/dev-*.md`
- `plugins/sp/skills/spur-dev/references/flag-glossary.md`
- `plugins/sp/skills/spur-dev/references/dev-operations.md`
- `plugins/sp/skills/dogfood-testing/SKILL.md`
- `plugins/sp/skills/sys-debugging/SKILL.md`
- `plugins/sp/skills/sys-architecture/SKILL.md`
- `plugins/sp/README.md`
- `docs/00_ADR.md` (ADR-032)
- `docs/04_DESIGN.md`

## Next Step

Approve or reject the idea-evaluation report. Approval authorizes feature/task corpus creation
through the Spur CLI; rejection creates no feature or task.
