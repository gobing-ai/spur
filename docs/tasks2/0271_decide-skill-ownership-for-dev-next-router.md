---
template: brainstorm
schema_version: 1
name: "Decide skill ownership for dev-next router"
description: ""
status: done
type: brainstorm
profile: standard
feature_id: H4
parent_wbs: null
priority: P1
tags: ["wayfinder:grilling", "workstream:dev-next"]
dependencies: []
created_at: "2026-07-17T00:54:25.959Z"
updated_at: "2026-08-18T04:42:47.484Z"
---

## 0271. Decide skill ownership for dev-next router

### Background
**Type:** `wayfinder:grilling` · **Feature:** N

**Question:** Where does `/sp:dev-next` **logic** live so it stays a thin command wrapper per `plugins/sp/README.md` ("commands are pass-through routers"), while remaining testable and maintainable?

**Options:**

| Option | Sketch | Pros | Cons |
| --- | --- | --- | --- |
| A. New skill `sp:next-router` (or `sp:dev-next`) | Command → Skill only | Clear owner; isolated tests | Another skill in the catalog |
| B. Extend `sp:spur-dev` + `dev-operations.md` | New operation on spine | Lifecycle knowledge co-located | Spine grows; coupling risk |
| C. Command-only (all logic in `dev-next.md`) | No skill | Fewest files | Violates pass-through design; hard to reuse |

**Locked constraints:**
- Commands remain pass-through routers
- Router **dispatches** existing commands; does not reimplement pipeline
- Non-Claude platforms need a documented manual protocol

**Out of this ticket:** Routing table content (0270), flag names (0272), implementation.
### Requirements
- [x] R1. Pick A, B, or C (or a hybrid with explicit file list) with written rationale against the README "pass-through routers" principle.
- [x] R2. Name exact files to add/edit for a later implementation task (command path, skill path, tests path, README row).
- [x] R3. State how structural tests (`plugins/sp/tests/…`) will assert the new surface exists.
- [x] R4. State how non-Claude platforms run the same protocol.
- [x] R5. Record decision in Solution + feature N Decisions so far on done.
### Acceptance Criteria
```gherkin
@core
Scenario: Ownership decision is implementation-ready
  Given 0271 Solution
  When an implementer opens the listed files
  Then they know exactly where routing logic and the thin command live
  And the choice does not violate pass-through command design
```
### Q&A
**Q (why not put next on spur-dev like run/refine).** run/refine are spine *phases*. next is a cross-cutting UX router over many phases; same reason dogfood is its own skill.

**Q (why not name skill sp:dev-next).** Keep skill ids function-oriented (dogfood-testing, parallel-execution); avoid conflating with the --next flag namespace.

**Q (does this block 0272).** No — unblocks it. 0272 Implementation section must cite Skill(skill="sp:next-router").
### Design
**Selected: Option A — `sp:next-router` skill + thin `dev-next.md`.**

**Rejected B:** spine is lifecycle/pipeline ownership; meta-router would bloat spur-dev (dogfood precedent stays outside the ops map).

**Rejected C:** violates README pass-through (commands must not hold domain logic).

**Rejected hybrid ownership:** single skill owns routing; spur-dev may only get a See-also pointer.
### Plan
1. Re-read README design principle + 2–3 peer command→skill pairs (dogfood, run, unit).
2. Score A/B/C against coupling, testability, catalog size.
3. Recommend default: **A (new skill)** unless spine co-location wins on evidence.
4. Write Solution with file list + test plan pointer.
### Solution
**Decision: Option A — new skill `sp:next-router`**, thin command `/sp:dev-next` → Skill only.

**Not B** (fold into `sp:spur-dev`): the spine owns planning/execution *pipelines* and gates. A status→command UX router is a meta-dispatcher over many operations, not a pipeline step. Putting TABLE A/B/C + dispatch protocol into `dev-operations.md` / spur-dev bloats the spine and couples every routing change to the lifecycle skill. Peer counterexample: `sp:dogfood-testing` is deliberately *outside* the numbered dev-operations table (`plugins/sp/skills/spur-dev/references/dev-operations.md:31-33`).

**Not C** (command-only): violates README pass-through principle (`plugins/sp/README.md:311-312` — commands contain zero domain logic). Also blocks reuse from agents / non-Claude platforms that load skills by name.

**Hybrid rejected as primary ownership:** do not split logic between spur-dev and a skill. Optional *pointer* only (see file list).

---

## Naming

| Surface | Name | Rationale |
| --- | --- | --- |
| Skill directory / Skill() id | `next-router` → `sp:next-router` | Function-named like `dogfood-testing`, `parallel-execution` (not 1:1 with `dev-*` command prefix) |
| Command file | `plugins/sp/commands/dev-next.md` | Matches operator-facing `/sp:dev-next` |
| Protocol label (optional metadata) | `sp:next-router@1.0` | Mirrors dogfood protocol versioning |

Do **not** name the skill `sp:dev-next` — keeps skill catalog free of the `dev-` command-namespace prefix and avoids collision with the `--next` flag vocabulary.

---

## Ownership split

| Concern | Owner |
| --- | --- |
| Argument parse + `Skill()` one-liner + operator prose | `commands/dev-next.md` (thin) |
| Resolve target, TABLE A/B/C, light-gate order, HITL stop, chain budget | `skills/next-router/SKILL.md` + `references/routing-table.md` |
| Lifecycle FSM, implement/verify/refine procedures | unchanged in `sp:spur-dev` / competencies (only *dispatched to*) |
| Routing table SSOT content | `references/routing-table.md` seeded from task 0270 Solution |

---

## File list (implementation-ready)

**Create**
1. `plugins/sp/commands/dev-next.md` — frontmatter, When to use, Arguments (from 0272), Behavior summary, Implementation:
   ```
   Skill(skill="sp:next-router", args="$ARGUMENTS")
   ```
2. `plugins/sp/skills/next-router/SKILL.md` — protocol: parse → resolve → load corpus → table lookup → probe → dispatch or HITL stop → optional chain; Platform Notes for non-Claude.
3. `plugins/sp/skills/next-router/references/routing-table.md` — paste/adapt 0270 TABLES A/B/C + algorithm (file:line anchors retained).

**Edit**
4. `plugins/sp/README.md` — `### Command index` row for `dev-next` (R43 requires exact once); skill-dispatch / skills list mention `sp:next-router`.
5. `plugins/sp/skills/spur-dev/references/dev-operations.md` — short **See also** note (not a numbered spine operation): `/sp:dev-next` backs onto `sp:next-router`; not part of the 1–16 operation map (same pattern as dogfood).
6. `Agents.md` harness routing table (optional same-commit) — row: "unsure which dev command" → `/sp:dev-next`.

**Do not edit for ownership alone**
- `task-pipeline.yaml` / lifecycle YAML
- Competency skills (code-implementation, etc.)

**Tests**
7. `plugins/sp/tests/skill-structure.test.ts` — no mandatory new case if R43 + existing skill frontmatter scans cover the tree; **recommended additive test** (implementer):
   - `dev-next.md` contains `Skill(skill="sp:next-router"`
   - `skills/next-router/SKILL.md` exists with `name: next-router`
   - `references/routing-table.md` exists

---

## Structural tests (how green is proven)

| Gate | Mechanism |
| --- | --- |
| Command indexed | R43 walks `commands/*.md` vs README Command index (`plugins/sp/tests/skill-structure.test.ts:535`) |
| Skill description budget | Existing skill-description length tests over all `skills/*/SKILL.md` — keep `description:` under router/non-router budget |
| Reference integrity | Existing markdown link / skill reference scans |
| Recommended R-next | Assert command→skill wiring string + routing-table file present |

Run: `bun test plugins/sp/tests/skill-structure.test.ts`

---

## Non-Claude platforms (R4)

Same contract as `dev-dogfood` / dogfood-testing Platform Notes:

1. No `Skill()` — agent reads `plugins/sp/skills/next-router/SKILL.md` + `references/routing-table.md` as the procedure SSOT.
2. Corpus signals via `spur task show|list --json`, `spur feature show|list --json`, `spur task check --json`.
3. Dispatch by invoking the target command protocol (or its backing skill) with forwarded flags — never by reimplementing refine/run/verify inside next-router.
4. HITL multi-candidate stops use the decision-brief format (`spur-dev/references/decision-brief.md`).

---

## Scorecard (for the record)

| Criterion | A new skill | B spur-dev | C command-only |
| --- | --- | --- | --- |
| Pass-through commands | yes | yes | **no** |
| Spine size / coupling | isolated | grows | n/a |
| Testability of routing table | high (own refs) | mixed with lifecycle | low |
| Peer precedent | dogfood, parallel-execution | run/refine/plan | inline fixall/gitmsg (wrong shape — those are short procedures, not multi-op routers) |
| Catalog cost | +1 skill | 0 | 0 |

**Winner: A.**

---

## Source anchors (file:line)

- Pass-through principle: `plugins/sp/README.md:311-312`
- Dogfood outside ops table: `plugins/sp/skills/spur-dev/references/dev-operations.md:31-33`
- Dogfood thin command: `plugins/sp/commands/dev-dogfood.md:62-68`
- R43 command index test: `plugins/sp/tests/skill-structure.test.ts:535-562`
- 0270 routing SSOT: `docs/tasks2/0270_define-sp-dev-next-v1-routing-table-status-signals-command.md` (Solution)
### Testing
**Validation.**
- Re-read plugins/sp/README.md:311-312 pass-through principle
- Compared peers: dev-dogfood.md:62-68, dev-operations.md:31-33, skill-structure.test.ts:535 R43
- Confirmed dogfood is the closest meta-tool peer (outside numbered ops)

**Runtime tests.** N/A (decision ticket; no production code in this session).
### Review

<!-- Risks, open concerns, and follow-up review notes. -->

### References
- Peer patterns: `dev-dogfood.md` → `dogfood-testing`; `dev-run.md` → `spur-dev` / `code-implementation`
- Blocks: 0272 (CLI docs need owner names)
- Parallel with: 0270
### History
- 2026-07-17T01:06:05.893Z todo → wip (system)
- 2026-07-17T01:07:05.521Z wip → testing (system)
- 2026-07-17T01:07:08.289Z testing → done (system)
