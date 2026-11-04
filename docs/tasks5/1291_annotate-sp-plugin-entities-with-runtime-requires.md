---
schema_version: 1
name: Annotate sp plugin entities with runtime requires
status: todo
template: feature-impl
created_at: 2026-11-04T23:00:25.705Z
updated_at: "2026-11-04T23:53:45.831Z"
feature_id: I14

ac_altitude: task-local
ac_numbering: task-local
priority: P2
estimate_hours: 4
---

## 1291. Annotate sp plugin entities with runtime requires

### Background

Task 1291 delivers feature I14 scenario R1 (`docs/features/I14_grok-bot-interop-for-spur-and-the-sp-plugin.md`). Every sp skill, command and agent declares its runtime needs using the `requires:` contract from superskill task 0162 (feature D1). A grok-bot install of sp then carries only entries the Bot can run, and a check fails when an entity uses something it has not declared.

Contract consumed verbatim from superskill 0162, R1:
- frontmatter `requires:` is a YAML list of tokens;
- the tokens are `hooks`, `subagents`, `local-fs` and `cli:<name>`, where `<name>` matches `^[a-z0-9][a-z0-9._-]*$`;
- the list is sorted with no duplicates.

0162 owns parsing, validation and the Bot filter. This task only annotates and guards.

Current tree state (verified 2026-11-04):

- `plugins/sp` ships 41 skills, 43 commands and 4 agents (88 entities). None has `requires:`.
- A scan of entity bodies, with the frontmatter stripped, for CLI invocations ``(^|[`( ])<name> [a-z]`` found:
  - 59 entities that invoke `spur` directly;
  - 3 that invoke `gh` directly (`commands/dev-fixgha.md`, `commands/dev-gtd.md`, `skills/pr-reviewing/SKILL.md`);
  - none that invoke `superskill` or `kk` directly.
- Commands are thin wrappers that dispatch skills with `Skill(skill="sp:<id>", …)` (for example `plugins/sp/commands/dev-unit.md:30`, `plugins/sp/commands/dev-simplify.md:31`). A command therefore inherits the needs of the skills it dispatches.
- Applying that transitive closure over `Skill(skill="sp:…")` references gives these groups:

  | `requires` group | Entities |
  | --- | --- |
  | `[cli:spur]` | 70 |
  | `[cli:gh]` | 2 (`commands/dev-fixgha.md`, `commands/dev-gtd.md`) |
  | `[cli:gh, cli:spur]` | 2 (`commands/dev-pr-review.md`, `skills/pr-reviewing/SKILL.md`) |
  | no CLI | 14 |

  These counts come from a scratch script run 2026-11-04 and are what AC2 asserts.
- Subagent mentions resolve to `spur agent run`, the subprocess surface (`plugins/sp/skills/brainstorm/SKILL.md:94`, `plugins/sp/skills/wayfinder/SKILL.md:293`, `plugins/sp/agents/expert-spur.md:129`), or to optional native fan-out (`plugins/sp/skills/parallel-execution/SKILL.md:144`). Both count as `cli:spur`. No entity hard-requires native subagent dispatch.
- sp hooks (`plugins/sp/hooks/hooks.json`) cover write and safety guards, context ledger, agent lifecycle and fleet Stop delivery. The entities that mention them degrade explicitly without hooks:
  - `plugins/sp/skills/indexed-context/SKILL.md:165-170`: "On agents without hook support, the ledger simply doesn't accumulate".
  - `plugins/sp/skills/fleet-join/SKILL.md:62-64,126`: "hooks are acceleration only".

  So no entity requires `hooks`. The Bot simply does not get the guards, which the README must say (feature I14 Scope: "hook-dependent gates must not be claimed on Bot").
- Every sp workflow reads or writes the operator's project repository: corpus, code, docs or git.

**Refine corrections (2026-11-04)**

- The feature estimated "≈109 skill files call the `spur` CLI". That count included reference files, which are not entities. The real entity count is 88, of which 72 need `cli:spur` after closure.
- A 70-row hand table would drift as soon as an entity changes. Instead, the guard test derives the expected CLI set from each body plus the `Skill()` closure, and asserts declared ⊇ derived, so undeclared use fails (feature R1 "a check fails on undeclared use").
- `subagents` and `hooks` were assumed to apply to several entities. The tree evidence above shows none hard-requires either, so neither token is used.

### Requirements

- [ ] R1. Add `requires:` to every sp entity (`plugins/sp/skills/*/SKILL.md`, `plugins/sp/commands/*.md`, `plugins/sp/agents/*.md`) as a sorted YAML flow list. It must equal the union of three sets:
  - `local-fs`, for all 88 entities;
  - the directly invoked CLIs among `spur`, `superskill`, `kk` and `gh`;
  - the transitive `requires` of every `Skill(skill="sp:<id>"…)` target.

  No sp entity declares `hooks` or `subagents`. Bodies and other frontmatter stay byte-identical.

- [ ] R2. Add `plugins/sp/tests/runtime-requires.test.ts`. Using only `bun:*`/`node:*`/relative imports and parsing frontmatter with `Bun.YAML.parse`, it asserts:
  - (a) every entity has a valid `requires` list in the 0162 grammar, sorted and de-duplicated;
  - (b) declared ⊇ derived, so an entity that invokes a tracked CLI or dispatches a skill without declaring the inherited tokens fails, naming the entity and the missing token;
  - (c) declared ⊆ derived ∪ {`local-fs`}, so there are no stale extra tokens;
  - (d) no entity declares `hooks` or `subagents` unless it is listed in an explicit allow-list (empty today).

- [ ] R3. The derived groups match the 2026-11-04 snapshot: 70 `[cli:spur, local-fs]`, 2 `[cli:gh, local-fs]`, 2 `[cli:gh, cli:spur, local-fs]` and 14 `[local-fs]`. Any deviation found during implementation is recorded in Solution with its cause (the entity changed after this refine); it is not silently accepted.

- [ ] R4. Add a "Grok Bot" subsection to `plugins/sp/README.md` covering four points:
  - what the annotations mean;
  - that sp hooks (task-write guard, careful guard, context ledger, fleet Stop delivery) do not run on a Bot, so their protections are not claimed there;
  - that with defaults every sp entity is excluded;
  - the recommended install after 1292's bootstrap: `superskill install sp --targets grok-bot --bot-provides cli:spur --bot-provides local-fs`, plus `--bot-provides cli:gh` when `gh` is available.

- [ ] R5. Gates:
  - `bun run plugin-smoke`, `bun run lint`, `bun run spur-check` and `(cd plugins/sp && bun test tests/runtime-requires.test.ts tests/skill-structure.test.ts)` pass;
  - with superskill ≥ the 0162 release, `superskill skill|command|agent validate` reports no `requires` finding on sp entities. Record the command and version in Testing.

Out of scope:
- kk and cc annotations;
- changing entity bodies to drop dependencies;
- declaring baseline tools (`git`, `bun`, POSIX shell);
- a plugin version bump or release;
- any spur CLI surface change.

### Acceptance Criteria

```gherkin
Scenario: R1 — sp entities declare runtime requirements (req: R1, R2, R3, R4)
  Given the sp plugin skills, commands and agents
  When the requires annotations are validated
  Then every entity that shells out to spur, superskill or kk, or relies on hooks or subagents, declares it and a check fails on undeclared use

Scenario: AC1 — Every sp entity declares a valid requires list (req: R1, R2)
  Given the 88 sp entities
  When `plugins/sp/tests/runtime-requires.test.ts` runs
  Then every entity's `requires` parses under the 0162 grammar, is sorted and de-duplicated, and contains `local-fs`
  And no entity declares `hooks` or `subagents`

Scenario: AC2 — Declared requirements equal the derived closure (req: R1, R3)
  Given the body CLI scan and the `Skill(skill="sp:…")` closure
  When the test compares declared and derived sets
  Then the groups are 70 `[cli:spur, local-fs]`, 2 `[cli:gh, local-fs]`, 2 `[cli:gh, cli:spur, local-fs]` and 14 `[local-fs]`
  And every entity's declared set equals its derived set plus `local-fs`

Scenario: AC3 — Undeclared use fails the guard (req: R2)
  Given a temp copy of a `[local-fs]` skill whose body gains a `spur task list --json` line
  When the guard's pure check function runs on it
  Then it reports that entity missing `cli:spur`
  And a command dispatching that skill through `Skill(skill="sp:<id>")` without `cli:spur` is also reported

Scenario: AC4 — README states Bot behavior honestly (req: R4)
  Given `plugins/sp/README.md`
  When the Grok Bot subsection is read
  Then it lists the four tokens' meaning, states that sp hooks do not run on a Bot, and gives the exact `--bot-provides` install line

Scenario: AC5 — Gates pass and validator is clean (req: R5)
  Given the annotated tree
  When `bun run plugin-smoke`, `bun run lint`, `bun run spur-check` and the focused sp tests run
  Then all pass, and Testing records a superskill validate run with zero `requires` findings and the superskill version used
```

### Q&A

<!-- CLOSED decisions from refinement: what was chosen and why, what was deferred and on what
     condition. Not a parking lot for open questions — an unanswered question here means the task
     is not ready to hand off. Keep empty if none. -->

#### Q&A entry — 2026-11-04T23:33:11.022Z

- **CLOSED — `local-fs` on all 88.** sp is a project-lifecycle plugin. Each workflow reads or writes the project repo (corpus, code, docs or git), which on a Bot exists only once a repo is cloned. The operator opts in with `--bot-provides local-fs`.
- **CLOSED — tracked CLIs are `spur`, `superskill`, `kk` and `gh`.** These are the non-baseline tools a Bot computer lacks until 1292's bootstrap or a connector provides them. `git`, `bun` and the shell are baseline: 1292 installs `bun`, and git ships with the computer. Declaring them would add noise without excluding anything meaningful.
- **CLOSED — transitive closure via `Skill(skill="sp:…")` only.** This is the dispatch syntax commands use. Prose mentions like "/sp:dev-fixall" are not dispatch, so they do not propagate. `dev-gtd` therefore stays `[cli:gh, local-fs]`.
- **CLOSED — no `hooks` and no `subagents`.** Each hook-mentioning entity documents graceful degradation. Subagent work goes through `spur agent run` (`cli:spur`) or optional native fan-out.
- **CLOSED — derive, don't hand-list.** The test computes the expected set, so a future body edit that adds a `spur` call fails until the entity is annotated (feature R1).
- **DEFERRED — kk/superskill invocations.** None exist today. The scanner tracks them, so a future use fails the guard until it is declared.

### Design

**WHAT.** A one-line `requires:` frontmatter key on all 88 sp entities, plus a self-deriving guard test and a README subsection.

**WHERE.** These paths:
- `plugins/sp/skills/*/SKILL.md`, `plugins/sp/commands/*.md`, `plugins/sp/agents/*.md` (frontmatter only);
- new `plugins/sp/tests/runtime-requires.test.ts`;
- `plugins/sp/README.md`.

**Frozen names (test module).**

| Name | Shape |
| --- | --- |
| `TRACKED_CLIS` | `['spur', 'superskill', 'kk', 'gh'] as const` |
| `CLI_INVOCATION_RE(name)` | `` new RegExp(`(^|[\`( ])${name} [a-z]`, 'm') `` applied to the body after stripping the leading `---…---` block |
| `SKILL_DISPATCH_RE` | `/Skill\(skill="sp:([a-z0-9-]+)"/g` |
| `REQUIRES_TOKEN_RE` | `/^(hooks\|subagents\|local-fs\|cli:[a-z0-9][a-z0-9._-]*)$/` (mirrors 0162; superskill is not imported, per the plugin standalone contract) |
| `HOOKS_OR_SUBAGENTS_ALLOW` | `new Set<string>()` (entity paths relative to `plugins/sp`) |
| `deriveRequires(entities): Map<path, string[]>` | direct CLIs ∪ closure over dispatched skills (cycle-safe, memoized) ∪ `local-fs` |
| `checkRequires(entities): string[]` | violation messages `<path>: missing <token>` / `<path>: extra <token>` / `<path>: invalid <token>` / `<path>: unsorted` |

The test also snapshots group sizes (AC2) as a literal object.

**Placement.** Put the key on the line after `description:`, or after its folded block. Do not change any other line.

**Mechanical apply.** A one-off scratch script computes `deriveRequires` and inserts the line. The script stays in scratch and is not committed. Re-run the test to prove the result.

**Invariants.**
- Bodies are byte-identical.
- The test imports no `@gobing-ai/*` value (enforced by the `sp-plugin-standalone` rule and `bun run plugin-smoke`).
- `local-fs` is universal.

**Anti-patterns.**
- Hand-maintaining a 88-row expected table.
- Declaring `hooks` for indexed-context or fleet-join.
- Adding `cli:git`/`cli:bun`.
- Propagating through prose `/sp:` mentions.

**Handoff.** 1292's bootstrap provides `cli:spur` (plus `superskill`/`kk`). 1293's recipes cite the README install line. Superskill 0163 and kk 0342 use the same classification rules.

### Plan

- [ ] 1. Write `plugins/sp/tests/runtime-requires.test.ts` first, including the AC3 negative cases against temp fixtures. Run it and confirm it fails on the unannotated tree (R2).
- [ ] 2. Apply the annotations with a scratch script driven by `deriveRequires`, then re-run the test until it is green and the AC2 group counts hold (R1, R3).
- [ ] 3. Add the README Grok Bot subsection (R4).
- [ ] 4. Run `superskill skill|command|agent validate` over all sp entities with superskill ≥ 0162 and record the version and output in Testing (R5).
- [ ] 5. Run `bun run plugin-smoke`, `bun run lint`, `bun run spur-check` and `(cd plugins/sp && bun test tests/runtime-requires.test.ts tests/skill-structure.test.ts)`, then check `git status --short` (R5).

### Solution

<!-- Filled during implementation: file:line change map and concise rationale. -->

### Testing

<!-- Filled during verification: commands run, outcomes, coverage claim or N/A. -->

### Review

<!-- Filled during review: P1-P4 findings, residual risk, and final disposition. -->

### References

- Feature: `docs/features/I14_grok-bot-interop-for-spur-and-the-sp-plugin.md` (scenario R1)
- Contract: superskill task 0162 (`requires:` grammar, `--bot-provides`/`--bot-unmet`), feature D1. Sibling annotation tasks: superskill 0163 (cc), knowledge-kit 0342 (kk)
- Downstream: 1292 (bootstrap provides `cli:spur`), 1293 (recipes cite the README install line)

### History

- 2026-11-04T23:03:29.488Z feature_id Q → I14 (system)
- 2026-11-04T23:33:21.805Z backlog → todo (system)

