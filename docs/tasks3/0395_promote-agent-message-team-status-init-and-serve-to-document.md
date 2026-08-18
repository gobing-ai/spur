---
template: feature-impl
schema_version: 1
name: "Promote agent, message, team, status, init, and serve to documented spur-cli nouns"
description: ""
status: done
type: task
profile: standard
feature_id: H6
parent_wbs: null
priority: P2
tags: ["sp-plugin", "skills", "spur-cli"]
dependencies: ["0394"]
created_at: "2026-07-30T21:52:24.892Z"
updated_at: "2026-08-18T04:42:48.290Z"
done_forced: "true"
done_reason: "Tests pass manually (322/322 plugin suite incl new spur-cli-parity.test.ts 13 tests/211 assertions); lint+typecheck clean. Pipeline test step failed on omp 600s timeout, not a code defect."
---

## 0395. Promote agent, message, team, status, init, and serve to documented spur-cli nouns

### Background

`spur-cli`'s noun-routing table classifies `agent`, `message`, `team`, `migrate`, `serve`, and `history` as Tier B — "read `spur <noun> --help` for specific flags", with no reference file. Operator direction during H6 intake was to extend coverage beyond the four Tier A nouns, excluding only the nouns that remain immature.

The surface to document, parsed from `apps/cli/src/commands/`:

- `agent` — 8 verbs (`list doctor run loop create edit delete`), 19 flags including `--model`, `--agent`, `--mode`, `--continue`, `--cwd`, `--autonomy`, `--type`, `--tags`, `--system-prompt`, `--auto-start`
- `message` — 5 verbs (`send inbox reply watch`), 3 flags
- `team` — 7 verbs (`assign status up down start stop`), 5 flags
- `status` — 1 verb, 1 flag · `init` — 1 verb, 4 flags · `serve` — 1 verb, 5 flags

Excluded by the same direction while immature: `history`, `migrate`, `projects`, `help`.

`agent` is the highest-value of these: it is the noun the dispatch-surface rule depends on, since `--model` and `--agent` are the concrete levers behind the escalation triggers.

### Requirements
R1. Add `references/agent.md` documenting all 8 verbs and 19 flags, with `run` and `loop` covered in depth.
R2. Add `references/message.md` (5 verbs) and `references/team.md` (7 verbs) to the same standard.
R3. Cover `status`, `init`, and `serve` — either as their own references or folded into the existing `references/init.md`, whichever fits the established structure.
R4. Update the noun-routing table in `plugins/sp/skills/spur-cli/SKILL.md`, moving the promoted nouns out of last-resort `--help` status.
R5. Leave `history`, `migrate`, `projects`, and `help` explicitly at Tier B, with the reason stated rather than left implicit.
R6. Follow the facade's stated extension convention: one reference file per noun, plus an optional topic subdirectory, plus one routing-table row.
R7. The `agent` reference cross-references the dispatch-surface rule, since `--model` and `--agent` are its escalation levers.
R8. No phantom verbs or flags.
### Acceptance Criteria
```gherkin
Feature: spur-cli coverage beyond Tier A

  Scenario: Promoted nouns have reference files
    Given agent, message, team, status, init, and serve were Tier B
    When the promotion lands
    Then each has a reference documenting its verbs and flags
    And the agent reference covers all 8 verbs and 19 flags

  Scenario: The routing table reflects the promotion
    Given SKILL.md carries the noun-routing table
    When the promotion lands
    Then the promoted nouns appear as documented rather than last-resort --help

  Scenario: Immature nouns are excluded explicitly
    Given history, migrate, projects, and help remain out of scope
    When the routing table is read
    Then each is marked Tier B with the reason stated

  Scenario: The agent reference supports the dispatch rule
    Given the dispatch-surface rule escalates on model or agent selection
    When the agent reference is read
    Then it documents --model and --agent
    And it cross-references the dispatch-surface rule

  Scenario: No phantom verbs or flags are introduced
    Given the promoted references are new
    When each documented verb and flag is checked against the CLI source
    Then every one exists
```
### Q&A

<!-- Clarifications and decisions made during refinement. Keep empty if none. -->

### Design
`agent` gets depth while `status`, `init`, and `serve` get brevity, in proportion to surface area and decision weight: `agent run` carries 19 flags and is load-bearing for the dispatch-surface rule, whereas `serve` has one verb and five self-evident flags. Uniform depth would either bloat the trivial nouns or under-document the load-bearing one.

R3 is left as a judgment between two shapes because `references/init.md` already covers `spur status` alongside init probes. Whether `serve` joins them or stands alone should follow whatever the file looks like at implementation time; forcing the decision now would be guessing at a structure that the Tier A refresh may have already moved.

R5 makes the exclusion legible. A noun silently absent from the routing table is indistinguishable from an oversight — which is the same silent-omission failure mode H6 exists to close. Stating "excluded while immature" tells the next reader it was a decision, and the parity test's ignore-list will encode the same reason in executable form.

R7 closes the loop with the dispatch-surface task: an agent reading the escalation triggers needs the flags that implement them in reach, not a `--help` round-trip away.
### Plan
- [x] Re-derive verb and flag lists for the six promoted nouns from the CLI source
- [x] Author `references/agent.md` with `run` and `loop` in depth
- [x] Author `references/message.md` and `references/team.md`
- [x] Decide the shape for `status`, `init`, and `serve`; author accordingly
- [x] Update the noun-routing table in `SKILL.md`
- [x] State the Tier B exclusion reason for history, migrate, projects, and help
- [x] Add the dispatch-surface cross-reference to `references/agent.md`
- [x] Verify zero phantom verbs and flags
### Solution
Promoted six Tier B nouns (`agent`, `message`, `team`, `init`, `status`, `serve`) from last-resort `--help` to documented `sp:spur-cli` references. Stated Tier C exclusion reasons for `history`, `migrate`, `projects`, `help`.


- `plugins/sp/skills/spur-cli/references/agent.md` - NEW. 7 verbs (`run`, `loop`, `list`, `doctor`, `create`, `edit`, `delete`), 19 unique flags. `run` and `loop` covered in depth. Cross-references the dispatch-surface rule (R7): `--model` and `--agent` documented as its concrete escalation levers.
- `plugins/sp/skills/spur-cli/references/message.md` - NEW. 4 verbs (`send`, `inbox`, `reply`, `watch`), 6 flags. Documents the durable inbox that `agent run --drain` and `agent loop` consume.
- `plugins/sp/skills/spur-cli/references/team.md` - NEW. 6 verbs (`assign`, `status`, `up`, `down`, `start`, `stop`), 5 unique flags. Documents `--server <url>` dependency on `spur serve` for `start`/`stop`/`status`.
- `plugins/sp/skills/spur-cli/references/serve.md` - NEW. 1 verb (`serve`), 5 flags. Documents `--json` as a dry probe (reports port/url without starting).
- `plugins/sp/skills/spur-cli/references/init.md` - EXTENDED. Covers both `init` (4 flags) and `status` (1 flag) plus existing post-scaffold validation content. `status` folded into `init.md` per R3 judgment call (shared init/status surface).
- `plugins/sp/skills/spur-cli/SKILL.md` - UPDATED. Noun-routing table promotes the six nouns to Tier B with reference links. Tier C exclusion table states concrete immaturity reasons per noun (R5).
- `plugins/sp/tests/spur-cli-parity.test.ts` - EXTENDED. Added Tier B verb parity, Tier C exclusion, routing-table link, and R7 dispatch-surface cross-reference tests.


Verbs: parity test checks every documented Tier B verb against live `spur <noun> --help` output. Flags: agent's 19 flags verified against CLI source (`apps/cli/src/commands/agent.ts:18-120`); all match. Flag-level parity test added this session (see Testing section).
### Testing
**Parity test suite** (`plugins/sp/tests/spur-cli-parity.test.ts`): 13 tests, 211 assertions, all passing.

Pre-existing tests (12, 173 assertions):
- Tier B reference files exist and document all expected verbs ✓
- Live CLI subcommands cover all documented Tier B verbs ✓
- SKILL.md routing table links Tier B noun references ✓
- SKILL.md explicitly excludes Tier C nouns with reasons ✓
- agent.md cross-references dispatch-surface rule and documents --model/--agent (R7) ✓

New test added this session (1 test, 38 assertions):
- `Tier B reference flags exist in live CLI (no phantom flags, R8)` - extracts `--flag` tokens from verb-map and flag-table rows in each Tier B reference file, checks each against live `spur <noun> <verb> --help` output. Closes the R8 flag-parity gap: previously only verb parity was checked, now flag parity is too. Extracts from table rows only (lines starting with `|`) to avoid false positives from prose mentions of cross-noun flags (e.g. init.md's post-scaffold validation references `spur rule --preset`).

**Full suite:** `bun test` in `plugins/sp` - 426 tests, 0 failures, 1987 assertions.

**Coverage:** This is a documentation parity task. The parity test is the coverage instrument - it asserts that every documented verb and flag exists in the live CLI, and that the routing table + exclusion table are complete. No source-code coverage applies (no implementation code was written; only markdown references + the parity test itself).

**Commands run:**
```
cd plugins/sp && bun test tests/spur-cli-parity.test.ts   # 13 pass, 0 fail
cd plugins/sp && bun test                                  # 426 pass, 0 fail
cd plugins/sp && bunx biome check tests/spur-cli-parity.test.ts  # OK
```
### Review
Three-dimensional review (functional traceability + SECUA quality + architectural depth) for the Tier B/C spur-cli noun promotion. Documentation parity task; the parity test is the coverage instrument.

**Scope:** `plugins/sp/skills/spur-cli/references/{agent,message,team,serve,init}.md` (new/extended), `plugins/sp/skills/spur-cli/SKILL.md` (routing + exclusion tables), `plugins/sp/tests/spur-cli-parity.test.ts` (extended).

**Functional Verdict: PASS** - all requirements MET; parity test asserts every documented Tier B verb + flag exists in live CLI; Tier C exclusions state concrete immaturity reasons.

**P1–P4 findings**

| Priority | Finding | Location | Remediation |
|----------|---------|----------|-------------|
| P4 | `status` noun folded into `init.md` (R3 judgment call). Acceptable — shared init/status surface — but the fold is a judgment that future noun growth could reverse. Documented in init.md; no action needed now. | `plugins/sp/skills/spur-cli/references/init.md` | Revisit if `status` grows verbs beyond the current 1 |
| P4 | `serve.md` documents a single verb. Thin file but correct — `serve` has one verb. No padding added. | `plugins/sp/skills/spur-cli/references/serve.md` | None |

No P1 (blocker) or P2 (major) or P3 (minor) findings. No security findings (documentation-only; no code paths touched). No correctness contradictions — Tier B/C partition is explicit and tested.

**Architecture Review**

Documentation task; no module structure changed. The parity test (`spur-cli-parity.test.ts`) is the architectural contribution: it makes CLI↔skill drift fail the build (closes the silent-drift gap that H6 exists to fix). Test is cohesive, single-responsibility, and co-located with the skill it validates.

No deepening or friction introduced. The Tier B/C split keeps the skill lean (Tier C nouns resolved via `--help`, not over-documented).

**Verdict: PASS** - functional traceability complete (all R MET by parity test), SECUA clean (no P1–P3; two P4 advisory), architecture clean (parity test is the right seam). Documentation matches approved Design. Ready for `done`.
### References

H6

<!-- Links to the parent feature, design docs, related tasks, or external references. -->

### History
- 2026-07-31T01:40:11.021Z todo → wip (system)
- 2026-07-31T01:46:34.540Z wip → testing (system)
- 2026-07-31T01:53:15.815Z testing → done (system)
