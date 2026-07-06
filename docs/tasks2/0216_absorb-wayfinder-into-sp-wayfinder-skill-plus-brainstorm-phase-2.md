---
schema_version: 1
name: "Absorb wayfinder into sp as sp:wayfinder skill + wire into /sp:dev-brainstorm Phase 2 escalation"
status: done
template: standard
created_at: 2026-07-06T07:00:00.000Z
updated_at: "2026-07-06T15:53:13.983Z"
priority: P2
---

## 0216. Absorb wayfinder into sp as `sp:wayfinder` skill + wire into `/sp:dev-brainstorm` Phase 2 escalation

### Background

`vendors/skills/skills/in-progress/wayfinder/SKILL.md` fills a gap none of the existing sp skills cover: when a loose idea is **too big and foggy to spec in one session**, wayfinder charts a persistent, multi-session **map** of investigation tickets (research / prototype / grilling / task) and resolves them one at a time until the route to the destination becomes visible. The "fog of war" concept (things you know are coming but can't yet specify) is the key insight.

sp's current flow is brainstorm → spec → decompose → implement — it assumes the destination is clear enough to decompose. Wayfinder handles the case where **the spec itself is the destination**, requiring multiple sessions of investigation to even write.

**Operator decision (2026-07-06):** absorb wayfinder as `sp:wayfinder`, wire it into `/sp:dev-brainstorm` as a **semi-automatic** Phase 2 escalation (`--wayfind`). NOT fully automatic — the scope judgment ("is this a multi-session investigation?") needs human confirmation. The map lives as a `spur feature` + child `spur task` entries; the fog-of-war lives in the feature description; the one-ticket-per-session constraint pairs with sp's existing batch execution model.

**Hard boundary (same as 0187 / 0214 / 0215):** ABSORB, never cite — no file under `plugins/sp` may reference `vendors/`; the `sp-no-vendor-refs` rule + structural test R20 enforce it. Provenance lives only in this task's References. Write everything in sp vocabulary.

### Requirements

- [ ] R1. `sp:wayfinder` skill. New `plugins/sp/skills/wayfinder/SKILL.md`: a meta-process skill for multi-session investigation when the destination itself is foggy. Full anatomy per 0214 R1 conventions: Overview / When to Use / Process / Common Rationalizations (≥5 rows) / Red Flags (≥5 items) / Verification. Absorb the following wayfinder concepts into sp vocabulary:
  - **Map** → a `spur feature` (the feature description IS the map body: Destination, Notes, Decisions-so-far, Not-yet-specified/fog, Out-of-scope)
  - **Ticket types** (research/prototype/grilling/task) → map to existing sp skills: research → `sp:brainstorm`/deep-research; prototype → `sp:code-implementation` rough-take; grilling → `sp:dev-refine`; task → manual checklist
  - **Frontier** (open, unblocked, unclaimed) → sp's existing `spur task` dependency graph + status — already there
  - **One ticket per session** → sp's batch execution model with dependency ordering — already there
  - **Fog of war** → feature description's "Not yet specified" section
  - **Claim a ticket** → `spur task update <wbs> wip` — assign to self before work
  - **Resolution comment** → `spur task update <wbs> done` with the answer in the task body
  - **Refer by name** → use WBS + title, never bare WBS numbers — sp already does this
- [ ] R2. Wire into `/sp:dev-brainstorm` as semi-automatic Phase 2 escalation. At the end of the discovery interview (Phase 1), run a **scope check**: "Can this be spec'd in one session, or is the destination itself still foggy?" If foggy → offer wayfinding as the escalation path with a prompt like: _"This is a multi-session investigation. Want me to chart a wayfinder map so we can work through it one decision at a time?"_ User confirms before wayfinding begins. The `--wayfind` flag skips the prompt and enters wayfinding directly.
- [ ] R3. `--wayfind` flag on `/sp:dev-brainstorm`. When `--wayfind` is passed, after the discovery interview: (a) name the destination (one-line spec/decision/change this effort is finding its way to), (b) map the frontier breadth-first (fan out across the whole space, surface open decisions and first takeable steps), (c) create the map as a `spur feature`, (d) create child tasks for what can be specified now, wire blocking edges, (e) populate the feature description with the fog-of-war (Not yet specified) and out-of-scope sections, (f) stop — charting is one session; do not also resolve tickets.
- [ ] R4. Wayfinder operational mode. When invoked with an existing map (feature ID): (a) load the feature (the low-res view, not every task body), (b) pick the first frontier task (open, unblocked, unclaimed), (c) claim it, (d) resolve it per its type (research → summarize; prototype → build rough artifact; grilling → one-question-at-a-time interview; task → do-or-checklist), (e) record the resolution, close the task, append to Decisions-so-far, (f) graduate fog into new tickets where specifiable, (g) stop after ONE ticket — never resolve more than one per session.
- [ ] R5. Structural test enforcement. Extend `plugins/sp/tests/skill-structure.test.ts` to assert: the `wayfinder` skill carries the full anatomy (R1), `brainstorm` references wayfinder in its escalation path (R2), the `--wayfind` trigger is documented in the skill's When-to-Use table. Add to the load-bearing skill set.

### Acceptance Criteria

- [ ] AC1. R1 — MET when `plugins/sp/skills/wayfinder/SKILL.md` exists with full anatomy (Overview / When to Use / Process / Common Rationalizations ≥5 rows / Red Flags ≥5 items / Verification), all wayfinder concepts are expressed in sp vocabulary (map = feature, tickets = spur tasks, fog = feature description section), and no `vendors/` reference appears anywhere in the shipped file.
- [ ] AC2. R2 — MET when the scope check is a documented step at the end of `brainstorm` Phase 1, the escalation prompt text is exact (not a paraphrase), and the user-confirmation gate is explicit (not automatic).
- [ ] AC3. R3 — MET when `--wayfind` is documented in both `brainstorm/SKILL.md` and `commands/dev-brainstorm.md`, the flag triggers the charting sub-workflow (destination → frontier → create-feature → create-tasks → wire-blocks → populate-fog → stop), and the command delegates to `sp:wayfinder` for the charting logic.
- [ ] AC4. R4 — MET when the wayfinder skill documents the "work through the map" operational mode: load feature → pick frontier task → claim → resolve per type → record → graduate fog → stop after ONE.
- [ ] AC5. R5 — MET when the structural suite asserts wayfinder anatomy + brainstorm→wayfinder reference, and `bun run test` is green with zero skipped tests.
- [ ] AC6. Global gate — MET when `bun run autofix && bun run spur-check` passes clean (biome format + typecheck, lint, recommended-pre-check incl. `sp-no-vendor-refs`, full test suite with zero skipped tests, recommended-post-check) and no file under `plugins/sp` references `vendors/`.

### Design

**Key decisions:**

- **D1. Absorb, never cite** (`sp-no-vendor-refs` rule + structural test R20). Wayfinder concepts are rewritten in sp vocabulary; provenance lives only in this task's References.
- **D2. Map = spur feature, tickets = spur tasks.** sp already has the nouns (feature, task, dependency graph, WBS, status lifecycle). Wayfinder's GitHub-issue-based map maps cleanly onto them — no new data model needed. The feature description carries the map body (Destination, Notes, Decisions-so-far as a running log, Not-yet-specified as the fog, Out-of-scope). Each investigation ticket is a `spur task` child of the feature.
- **D3. Semi-automatic, not fully automatic.** The scope check at the end of brainstorm Phase 1 offers wayfinding; the user confirms. `--wayfind` skips the prompt for power users. Never silently escalate — the user might have a 30-minute quick-answer need that just happens to touch a big domain.
- **D4. One ticket per session is a hard rule, not a suggestion.** The wayfinder skill stops after resolving exactly one ticket. Multiple tickets in one session defeat the purpose (deliberate, bounded investigation steps). This pairs naturally with sp's batch execution model — the batch driver can loop over frontier tickets one per session.
- **D5. Ticket types map to existing sp skills.** No new competencies needed — wayfinder is an orchestration layer over sp's existing skill set (brainstorm, dev-refine, code-implementation).
- **D6. Scope guard.** Touch only `plugins/sp` markdown/frontmatter, its tests, and the new skill files. NO behavioral change to the `spur` CLI, pipeline YAMLs, or section-write contract.

**Adaptation table (wayfinder → sp):**

| Wayfinder concept                          | sp equivalent                                               | Notes                                 |
| ------------------------------------------ | ----------------------------------------------------------- | ------------------------------------- |
| Map (GitHub issue, `wayfinder:map` label)  | `spur feature`                                              | Feature description IS the map body   |
| Child tickets (GitHub issues)              | `spur task` children of the feature                         | WBS numbering, dependency graph       |
| Ticket type: research                      | `sp:brainstorm` / deep-research via `spur agent run`        | Fact-finding, doc reading             |
| Ticket type: prototype                     | `sp:code-implementation` rough-take                         | Cheap concrete artifact to react to   |
| Ticket type: grilling                      | `sp:dev-refine`                                             | One question at a time                |
| Ticket type: task                          | Manual checklist in task body                               | Literal work, not a decision          |
| Frontier (open, unblocked, unclaimed)      | `spur task list --status todo` filtered by dependency graph | Already exists                        |
| Claim a ticket                             | `spur task update <wbs> wip`                                | Assign to self before work            |
| Resolution comment                         | `spur task update <wbs> done` + answer in body              | Close + record                        |
| Decisions-so-far                           | Feature description `## Decisions so far` section           | Running log, one line per closed task |
| Fog of war / Not yet specified             | Feature description `## Not yet specified` section          | In-scope but not yet ticketable       |
| Out of scope                               | Feature description `## Out of scope` section               | Ruled beyond destination              |
| Refer by name                              | WBS + title, never bare WBS                                 | sp convention                         |
| Blocking edges (native tracker dependency) | `spur task` dependency graph                                | Already exists                        |

**Impacted surfaces:** NEW `plugins/sp/skills/wayfinder/SKILL.md` (+ references if >100 lines); EDIT `plugins/sp/skills/brainstorm/SKILL.md` (Phase 1 scope check + Phase 2 wayfinding escalation); EDIT `plugins/sp/commands/dev-brainstorm.md` (`--wayfind` flag); EDIT `plugins/sp/README.md` (new skill + optional command index row); EDIT `plugins/sp/tests/skill-structure.test.ts` (new structural assertions). Nothing outside `plugins/sp` changes except this task file.

**Risk / mitigation:** wayfinder is still `in-progress/` in the vendor repo (not a promoted skill) — its design is sound but less battle-tested than promoted skills. Mitigation: the sp adaptation simplifies it (no GitHub issue tracker dependency, no cross-session concurrency concern — sp's local-first model eliminates the concurrent-editing problem entirely).

### Plan

Single vertical slice — one new skill + one site edit (brainstorm Phase 2 escalation) + structural test enforcement. Small enough to run directly through the pipeline without sub-task decomposition.

- [ ] R1: author `plugins/sp/skills/wayfinder/SKILL.md` with full anatomy, sp vocabulary throughout.
- [ ] R2 + R3: add scope check + `--wayfind` escalation to `brainstorm/SKILL.md` and `commands/dev-brainstorm.md`.
- [ ] R4: document the "work through the map" operational mode in the wayfinder skill.
- [ ] R5: extend `skill-structure.test.ts` with wayfinder anatomy + brainstorm→wayfinder reference assertions.
- [ ] Gate: `bun run autofix && bun run spur-check` clean.

### Solution

<!-- Change map — HOW/WHERE. A `file:line` table of every touched site, one sentence each. (Filled at `wip`/`testing`.) -->

### Testing

<!-- Test results + a numeric coverage claim, or explicit `N/A`. (Filled at `testing`.) -->

### Review

<!-- P1–P4 findings table (Severity / File / Finding / Recommendation). (Filled at `done`.) -->

### References

Vendor source studied (reference-only; NEVER cite this path from plugin files — `sp-no-vendor-refs` + structural test R20 forbid it):

- `vendors/skills/skills/in-progress/wayfinder/SKILL.md` — the wayfinder meta-process: map, ticket types, fog of war, frontier, claim-then-resolve, one-ticket-per-session, refer-by-name.

sp surfaces this builds on:

- `plugins/sp/skills/brainstorm/SKILL.md` — Phase 1 discovery interview + candidate commands section (wayfinding is a new candidate).
- `plugins/sp/skills/spur-dev/references/cross-cutting.md` — verification-before-completion rule (wayfinder's one-ticket-per-session discipline).
- `plugins/sp/tests/skill-structure.test.ts` — structural test suite (R46–R49 from 0214, extended with wayfinder assertions).
- `plugins/sp/commands/dev-brainstorm.md` — thin command wrapper (extended with `--wayfind` flag).

Program relationship: 0187 (Matt Pocock, done) → 0214 (Superpowers/gstack/agent-skills behavioral hardening, done) → 0215 (out-of-scope remainders, done) → THIS task (wayfinder — the last vendor skill not covered by the prior three tasks).

### History

- 2026-07-06T07:00:00.000Z backlog → todo (system)
- 2026-07-06T15:53:13.983Z todo → done (system)
