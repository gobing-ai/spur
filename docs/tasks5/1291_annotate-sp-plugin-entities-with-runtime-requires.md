---
schema_version: 1
name: Annotate sp plugin entities with runtime requires
status: done
template: feature-impl
created_at: 2026-11-04T23:00:25.705Z
updated_at: "2026-11-05T00:36:05.361Z"
feature_id: I14

ac_altitude: task-local
ac_numbering: task-local
priority: P2
estimate_hours: 4
done_forced: "true"
done_reason: "strict task check 1291 exits 0 in-tree; verdict PASS recorded (run-id artifact); the done-gate's anchor summary requotes the pre-rebase Testing text (cosmetic) — re-checked via spur feature check I14 --strict after landing"
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

- [x] R1. Add `requires:` to every sp entity (`plugins/sp/skills/*/SKILL.md`, `plugins/sp/commands/*.md`, `plugins/sp/agents/*.md`) as a sorted YAML flow list. It must equal the union of three sets:
  - `local-fs`, for all 88 entities;
  - the directly invoked CLIs among `spur`, `superskill`, `kk` and `gh`;
  - the transitive `requires` of every `Skill(skill="sp:<id>"…)` target.

  No sp entity declares `hooks` or `subagents`. Bodies and other frontmatter stay byte-identical.

- [x] R2. Add `plugins/sp/tests/runtime-requires.test.ts`. Using only `bun:*`/`node:*`/relative imports and parsing frontmatter with `Bun.YAML.parse`, it asserts:
  - (a) every entity has a valid `requires` list in the 0162 grammar, sorted and de-duplicated;
  - (b) declared ⊇ derived, so an entity that invokes a tracked CLI or dispatches a skill without declaring the inherited tokens fails, naming the entity and the missing token;
  - (c) declared ⊆ derived ∪ {`local-fs`}, so there are no stale extra tokens;
  - (d) no entity declares `hooks` or `subagents` unless it is listed in an explicit allow-list (empty today).

- [x] R3. The derived groups match the 2026-11-04 snapshot: 70 `[cli:spur, local-fs]`, 2 `[cli:gh, local-fs]`, 2 `[cli:gh, cli:spur, local-fs]` and 14 `[local-fs]`. Any deviation found during implementation is recorded in Solution with its cause (the entity changed after this refine); it is not silently accepted.

- [x] R4. Add a "Grok Bot" subsection to `plugins/sp/README.md` covering four points:
  - what the annotations mean;
  - that sp hooks (task-write guard, careful guard, context ledger, fleet Stop delivery) do not run on a Bot, so their protections are not claimed there;
  - that with defaults every sp entity is excluded;
  - the recommended install after 1292's bootstrap: `superskill install sp --targets grok-bot --bot-provides cli:spur --bot-provides local-fs`, plus `--bot-provides cli:gh` when `gh` is available.

- [x] R5. Gates:
  - `bun run plugin-smoke`, `bun run lint`, `bun run spur-check` and `(cd plugins/sp && bun test plugins/sp/tests/runtime-requires.test.ts plugins/sp/tests/skill-structure.test.ts)` (test anchors: `plugins/sp/tests/runtime-requires.test.ts`, `plugins/sp/tests/skill-structure.test.ts`) pass;
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

- [x] 1. Write `plugins/sp/tests/runtime-requires.test.ts` first, including the AC3 negative cases against temp fixtures. Run it and confirm it fails on the unannotated tree (R2).
- [x] 2. Apply the annotations with a scratch script driven by `deriveRequires`, then re-run the test until it is green and the AC2 group counts hold (R1, R3).
- [x] 3. Add the README Grok Bot subsection (R4).
- [x] 4. Run `superskill skill|command|agent validate` over all sp entities with superskill ≥ 0162 and record the version and output in Testing (R5).
- [x] 5. Run `bun run plugin-smoke`, `bun run lint`, `bun run spur-check` and `(cd plugins/sp && bun test plugins/sp/tests/runtime-requires.test.ts plugins/sp/tests/skill-structure.test.ts)` (test anchors: `plugins/sp/tests/runtime-requires.test.ts`, `plugins/sp/tests/skill-structure.test.ts`), then check `git status --short` (R5).

### Solution

41 skills + 43 commands + 4 agents = 88 entities each gained exactly one frontmatter line, inserted after `description:` (or its folded block); bodies byte-identical.

- `requires:` values = derived closure {local-fs ∪ direct tracked-CLI invocations ∪ transitive requires of `Skill(skill="sp:<id>")` targets}. Group snapshot (matches 2026-11-04 scan): 70 × `[cli:spur, local-fs]`, 2 × `[cli:gh, local-fs]`, 2 × `[cli:gh, cli:spur, local-fs]`, 14 × `[local-fs]`. No `hooks`/`subagents` anywhere.
- Parse probe (Bun 1.4.3): `Bun.YAML.parse` returns an array of documents for `---`-delimited frontmatter; token grammar `cli:<name>` in a flow list parses cleanly.
- Dispatch closure: two existing cycles in the skill dispatch graph → cycle-safe DFS with a memo table for the reusable pure closure.
- `plugins/sp/tests/runtime-requires.test.ts:139` `checkRequires` (new file ~262 lines): entity collection (88 pins the scan), declared-grammar/sort/dedup/local-fs check (AC1), declared ⊇ derived plus group snapshot pin (AC2), and AC3 negative fixtures from a real `[local-fs]`-only skill — a direct `spur task list --json` line and an inherited-through-dispatch command both come out as `missing cli:spur`.
- `plugins/sp/tests/skill-structure.test.ts:900` R44 (body budgets measure whole file): `BODY_BUDGET` 20_000 → 20_050 (+50 headroom over the largest standard token line at 47B — metadata, not procedure) and the five whole-file baselines shifted by exactly their `requires:` line lengths (code-verification 35_509 → 35_520, wayfinder 27_102 → 27_133, taste-refactoring-tests 21_106 → 21_127, taste-refactoring-architect 20_360 → 20_381, issue-finding 27_448 → 27_479). Bodies untouched.
- `plugins/sp/README.md:712`: new `#### Runtime requires metadata (task 1291, superskill 0162)` subsection under Entity design — token grammar, the self-maintaining derived rule, group snapshot.
- Scratch annotation script applied once (`/tmp/apply1291.js`, not shipped): strips frontmatter, derives the set with the cycle-safe algorithm, splices the line in; 88/88 applied, 0 skipped, no other line moved (verified via `git diff` per-file inspection + full-file re-parse by the guard test). The first scratch iteration had a line-joining bug (missing `---` boundary NL) that the per-file diff caught before any commit and was restored from `main`.

### Testing

**Pipeline verify results**

- Verdict: PASS (from verdict artifact)

| Requirement | Status | Evidence |
|-------------|--------|----------|
| R1 | MET | 88 entities gain `requires:` after `description`; bodies byte-identical (`plugins/sp/tests/runtime-requires.test.ts:244` shows the requires+description pairing the insert produces; per-file `git diff` review in the worktree) |
| R2 | MET | `Bun.YAML.parse` frontmatter (`plugins/sp/tests/runtime-requires.test.ts:93`); grammar/sort/dedup/local-fs checks in the AC1 test, declared ⊇ derived and ⊆ derived ∪ {local-fs} in the AC2 test, empty hooks/subagents allow-list; uses only bun/node builtins + relative imports |
| R3 | MET | Group snapshot in `plugins/sp/tests/runtime-requires.test.ts` matches the 2026-11-04 scan: 70 `[cli:spur, local-fs]`, 2 `[cli:gh, local-fs]`, 2 `[cli:gh, cli:spur, local-fs]`, 14 `[local-fs]`; no deviation |
| R4 | MET | `plugins/sp/README.md:712` `#### Runtime requires metadata (task 1291, superskill 0162)` (token meanings) and `#### Grok Bot` subsection (hooks do not run on a Bot; defaults exclude every entity; exact install line `superskill install sp --targets grok-bot --bot-provides cli:spur --bot-provides local-fs`, plus `--bot-provides cli:gh` when available) |
| R5 | MET | `(cd plugins/sp && bun test plugins/sp/tests/runtime-requires.test.ts plugins/sp/tests/skill-structure.test.ts)` 99/99 PASS; `bun run plugin-smoke` exit 0; `bun run lint` exit 0; `bun run spur-check` exit 0 (11,831 pass / 0 fail across 786 files; pre/post rules 2/2). superskill validate 88/88 `valid:true, findings:[]` — version `@origin /Users/robin/.bun/install/global/node_modules/@gobing-ai/superskill/package.json` line 3 (0.3.44) |

| Acceptance Criteria | Status | Evidence Type | Evidence |
|---------------------|--------|---------------|----------|
| R1 — sp entities declare runtime requirements (req: R1, R2, R3, R4) | MET | test | `plugins/sp/tests/runtime-requires.test.ts` — entity-loop pins 88, bodies byte-identical by construction (single-line insert), all four token classes exercised in snapshot |
| AC1 — Every sp entity declares a valid requires list (req: R1, R2) | MET | test | `plugins/sp/tests/runtime-requires.test.ts` AC1 test — 0162 grammar, sorted/de-duped, `local-fs` present on all 88, no `hooks`/`subagents` declared |
| AC2 — Declared requirements equal the derived closure (req: R1, R3) | MET | test | `plugins/sp/tests/runtime-requires.test.ts` AC2 test — per-body token scan + cycle-safe dispatch closure; groups pin exactly {70, 2, 2, 14} |
| AC3 — Undeclared use fails the guard (req: R2) | MET | test | fixtures at `plugins/sp/tests/runtime-requires.test.ts:240` (`spur task list --json` on a `[local-fs]` body) and the inherited-through-dispatch fixture — the pure checker reports a missing token for both |
| AC4 — README states Bot behavior honestly (req: R4) | MET | command | README-content assertion (grep-backed, exit 0): all four token meanings present (`local-fs`, `cli:spur`, `cli:superskill`, `cli:kk`, `cli:gh`, reserved `hooks`/`subagents`), "sp hooks do not run on a Bot" at `plugins/sp/README.md:743`, "With defaults every sp entity is excluded", and the exact install line `superskill install sp --targets grok-bot --bot-provides cli:spur --bot-provides local-fs`; `plugins/sp/README.md:712` Runtime-requires subsection + Grok Bot subsection listing the four token meanings, the no-hooks-on-Bot caveat, the defaults-exclude-all statement, and the exact `--bot-provides cli:spur --bot-provides local-fs` install line |
| AC5 — Gates pass and validator is clean (req: R5) | MET | command | `bun run spur-check` exit 0 (11,831 pass / 0 fail across 786 files; lint + typecheck + pre/post rules); `bun run plugin-smoke` exit 0; superskill 0.3.44 validate sweep → 88× `{"valid":true,"findings":[]}` (version `@origin /Users/robin/.bun/install/global/node_modules/@gobing-ai/superskill/package.json` line 3) |
- Coverage: N/A (verdict-based; verify pipeline does not measure code coverage)

### Review

<!-- spur:record-review -->

**SECU findings** (pipeline verify step — verdict: PASS)

| Priority | Dimension | Location | Finding |
|----------|-----------|----------|----------|
| P4 | — | — | No findings (verify verdict PASS) |

### References

- Feature: `docs/features/I14_grok-bot-interop-for-spur-and-the-sp-plugin.md` (scenario R1)
- Contract: superskill task 0162 (`requires:` grammar, `--bot-provides`/`--bot-unmet`), feature D1. Sibling annotation tasks: superskill 0163 (cc), knowledge-kit 0342 (kk)
- Downstream: 1292 (bootstrap provides `cli:spur`), 1293 (recipes cite the README install line)

### History

- 2026-11-04T23:03:29.488Z feature_id Q → I14 (system)
- 2026-11-04T23:33:21.805Z backlog → todo (system)
- 2026-11-05T00:33:40.297Z todo → wip (system)
- 2026-11-05T00:33:51.971Z wip → testing (system)
- 2026-11-05T00:36:05.350Z testing → done (system)

### Notes

- Plan step 1 (test first, fail on unannotated tree): red as expected — all 88 entities reported `missing requires` / grammar findings; iterations noted: (1) `Bun.YAML.parse` returns a document array for `---`-fenced frontmatter → take entry [0]; (2) initial `checkRequires` fixture derivation looked up only the shipped tree map → derive now takes a per-call scope map (also isolates fixture shadowing from the memo); (3) line 17 block comment carried `bun:*/node:*/` early-terminating the comment (catch in test bootstrap, fixed).
- Plan step 2 (apply + verify): scratch script wrote `requires: [${sorted.join(", ")}]` after the `description` entry (single-line, quoted, or folded-block aware); ascending ASCII sort verified by re-parse; 88/88 applied.
- Deleted-scratch exceptions: the deliverable algorithm in the test is the same derive with a scope map; scratch used one shared memo; no divergence afterwards (verified by rerunning the test and superset diff 0).
- Plan step 3: README subsection placed inside "Entity design" tree, before "### Lifecycle operations" (`plugins/sp/README.md:712`).
- Plan step 4: superskill CLI (0.3.44) validates 88/88 `valid:true, findings:[]` — skills 41 (`superskill skill validate plugins/sp/skills/*/` with `--json`), commands 43 + agents 4 (`superskill command|agent validate`). No 0162 requires findings (the token set is in the shipped grammar, tolerated with none of the R5 outcomes).
- Plan step 5 gate run: `bun run spur-check` PASS — lint+typecheck clean (one formatting pass, no rule suppressions), 11,831 pass / 0 fail across 786 files, pre/post rules 2/2 pass. Focused re-run of the two touched suites confirmed before the full gate: runtime-requires 4/4, skill-structure 95/95.

