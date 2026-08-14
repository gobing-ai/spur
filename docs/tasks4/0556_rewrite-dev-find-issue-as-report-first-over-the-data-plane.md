---
template: feature-impl
schema_version: 1
name: "Rewrite dev-find-issue as report-first over the data plane"
description: ""
status: todo
type: task
profile: standard
feature_id: E5
parent_wbs: null
priority: P2
tags: []
dependencies: ["0555"]
ac_numbering: task-local
created_at: "2026-08-14T01:01:43.828Z"
updated_at: "2026-08-14T01:22:58.144Z"
---

## 0556. Rewrite dev-find-issue as report-first over the data plane

### Background
`/sp:dev-find-issue` re-parses raw JSONL today. Its command file is a thin wrapper
(`Skill(skill="sp:issue-finding", args="$ARGUMENTS")` plus flag tables); the substance is
`plugins/sp/skills/issue-finding/SKILL.md` (424 lines), whose Phase 2 currently states *"Do not treat
history ETL as a substitute for raw tool-loop evidence."*

Ticket 0492 settled the rewrite, and it is an **inversion of that written position**, not a new
integration — `--use-history` already ships. The data plane becomes primary; raw JSONL becomes a
named fallback for three specific conditions.

Two operator rulings shape it: the command becomes **report-first** (default output is the markdown
report; task creation moves behind `--create-task`, and `--use-history` / `--no-task` are removed),
and the **command/skill split** puts DISCOVER/ANALYZE extraction and rendering in the CLI while the
skill keeps IDENTIFY/PROPOSE and a gated GENERATE.
### Requirements
- [ ] **R1.** `/sp:dev-find-issue` is report-first: default output is the markdown report to stdout,
      composed of the 8 CLI-derivable sections (task 0555) plus the 6 model-authored ones. Task
      creation happens only behind `--create-task`. `--use-history` and `--no-task` are removed.
      Measurable: a default invocation writes no task file and emits a report; `--create-task`
      writes one; the removed flags are rejected with a message naming the replacement.
- [ ] **R2.** Apply the command/skill split (0492 R2): the CLI absorbs DISCOVER and ANALYZE extraction
      plus report rendering; the skill keeps IDENTIFY and PROPOSE, and a `--create-task`-gated
      GENERATE. Measurable: the skill no longer performs extraction, and its length reflects the
      removal rather than growing.
- [ ] **R3.** Invert the skill's raw-evidence stance without abandoning it. The data plane is primary;
      raw JSONL parsing is the fallback under exactly three conditions — a source with no typed
      mapper, an explicit `--sessions`, or a primitive the typed tables do not retain (0492 R7).
      Measurable: the SKILL.md states the inverted position and enumerates the three fallback
      conditions; a source with a typed mapper does not trigger raw parsing.
- [ ] **R4.** Issue categorization continues to work from the raw-JSONL fallback, since tool result
      content is deliberately not retained (ruling 2026-08-09). Measurable: categorization produces
      the same findings as before the rewrite on a fixture session.
- [ ] **R5.** The rewritten command and skill agree with the shipped CLI surface — flags, modes, and
      `--json` shapes are checked against the real commands rather than described from memory.
      Measurable: an assertion or test ties the documented flags to the actual command definitions.
### Acceptance Criteria
Covers feature E4 scenarios:

- **R6 — find-issue is report-first**
- **R7 — The data plane is primary and raw JSONL is the named fallback**

```gherkin
Scenario: R6 — find-issue is report-first
  Given a session set
  When /sp:dev-find-issue runs with no extra flags
  Then it emits a markdown report rather than writing a task file
  And a task file is written only when --create-task is passed

Scenario: R7 — The data plane is primary and raw JSONL is the named fallback
  Given a source with a typed mapper
  When find-issue runs
  Then extraction reads the data plane
  And raw JSONL parsing occurs only for a source with no typed mapper, an explicit --sessions, or a primitive the typed tables do not retain
```
### Q&A

<!-- CLOSED decisions from refinement: what was chosen and why, what was deferred and on what
     condition. Not a parking lot for open questions — an unanswered question here means the task
     is not ready to hand off. Keep empty if none. -->

**Closed during refine (2026-08-13).**

- **Do the removed flags become aliases?** No. `--use-history` inverts in meaning (history becomes
  the default), so keeping it would be a confusing no-op. Both removed flags fail with a message
  naming the replacement.
- **Which flags survive?** All the current ones except `--use-history` and `--no-task` — frozen in
  the table above, read from `dev-find-issue.md`'s `argument-hint` on 2026-08-13.
- **Who reduces `session-formats.md`?** Task 0553 (its R5). This task consumes the reduced file and
  must not re-add fidelity prose.
- **Why does issue categorization still read raw JSONL?** Because tool *result* content is
  deliberately not retained (operator ruling 2026-08-09; ~100 KB–5 MB/session). That is the
  retention policy working, not a gap to close here.

**Deferred with owner.**

- **Typed mappers for gemini / opencode / antigravity / openclaw** — owner: operator, blocked by the
  2026-08-06 source-support ruling. Until then those sources always take the raw-JSONL fallback.
- **Whether `--create-task` should default on for `--strict-topic` runs** — owner: operator. Raise
  only if report-first proves annoying in practice; defaulting it on would re-create the behaviour
  0492 deliberately removed.
### Design
**This is an inversion, not an integration.** `--use-history` already exists; the skill's Phase 2
explicitly tells the reader not to trust it. The rewrite reverses that default. Read the existing
SKILL.md before editing — the position being inverted is written down, and the new text must replace
it rather than sit next to it.

**The skill should get shorter.** 424 lines today, with extraction logic the CLI is taking over
(0492 R2). If the rewrite grows the skill, the split has not actually happened.

**Three fallback conditions, named exhaustively (R3).** "Fall back when the data plane is
insufficient" is not a contract — an agent will interpret it liberally and re-parse everything. The
three conditions from 0492 R7 are the whole list: no typed mapper, explicit `--sessions`, or a
primitive the typed tables do not retain.

**Categorization stays on raw JSONL by design (R4).** Tool result content is deliberately not
retained (~100 KB–5 MB/session if it were). This is not a gap to close in this task; it is the
retention ruling working as intended.

**Removed flags fail loudly (R1).** `--use-history` and `--no-task` disappearing must produce a
message naming what replaced them, not an unknown-flag error. An operator with the old invocation in
their shell history should be told what to type instead.

**Verify against the real surface (R5).** This repo's recurring defect is plugin prose asserting CLI
behaviour that has drifted — feature I3 exists for it. Do not describe a flag without checking it.

**Not in scope:** the report renderer itself (task 0555), and adding typed mappers for the
unsupported sources (deferred by the 2026-08-06 ruling).


Verified against the current tree 2026-08-13.

| Frozen | Value | Location |
| --- | --- | --- |
| Command file | `plugins/sp/commands/dev-find-issue.md` | thin wrapper, `Skill(skill="sp:issue-finding", …)` |
| Skill file | `plugins/sp/skills/issue-finding/SKILL.md` | 424 lines; Phase 2 holds the stance being inverted |
| Flag **added** | `--create-task` | gates task-file creation |
| Flags **removed** | `--use-history` · `--no-task` | must fail with a message naming the replacement |
| Flags **retained** | `--sessions` `--source` `--feature` `--template` `--priority` `--severity` `--category` `--since` `--until` `--top` `--min-cost` `--strict-topic` `--agent` `--json` | unchanged semantics |
| Report source | `spur history report --mode forensics` | task 0555 |
| Reduced reference | `plugins/sp/skills/issue-finding/references/session-formats.md` | root table + fallback note only (task 0553 R5) |

**No new CLI noun or verb.** The rewrite changes a command's flags and a skill's body; the `spur`
surface gains only what task 0555 adds.


- Do **not** leave `--use-history` working as an alias. Its meaning inverts — history becomes the
  default, so a flag that used to opt *in* would now be a confusing no-op (R1).
- Do **not** let removed flags surface as a generic "unknown option" error. Name the replacement.
- Do **not** widen the fallback conditions beyond the three in R3. "Fall back when the data plane
  seems insufficient" is not a contract; an agent will re-parse everything.
- Do **not** grow the skill. Extraction moves to the CLI (0492 R2); if `SKILL.md` gets longer, the
  split has not happened.
- Do **not** add typed mappers for unsupported sources to make the fallback unnecessary — deferred
  by the 2026-08-06 ruling.
- Do **not** describe a flag without checking it against the real command definition (R5). This is
  the exact drift class feature I3 exists to catch.


**Assumes from 0555:** `spur history report --mode forensics` emits the 8 derivable sections with
stable names and order; sections whose derived inputs are missing render as "not available". This
task composes those with the 6 model-authored sections and does not re-derive any of the 8.

**Assumes from 0553:** `session-formats.md` has already been reduced to the root-path table plus the
fallback note (0553 R5). This task must not re-add per-source fidelity prose there — the importer
`mappers.ts` is the single code authority (0489).

**Leaves for dependents:** none. This is the terminal task of feature E5's chain.

#### Frozen names

Verified against the current tree 2026-08-13.

| Frozen | Value | Location |
| --- | --- | --- |
| Command file | `plugins/sp/commands/dev-find-issue.md` | thin wrapper, `Skill(skill="sp:issue-finding", …)` |
| Skill file | `plugins/sp/skills/issue-finding/SKILL.md` | 424 lines; Phase 2 holds the stance being inverted |
| Flag **added** | `--create-task` | gates task-file creation |
| Flags **removed** | `--use-history` · `--no-task` | must fail with a message naming the replacement |
| Flags **retained** | `--sessions` `--source` `--feature` `--template` `--priority` `--severity` `--category` `--since` `--until` `--top` `--min-cost` `--strict-topic` `--agent` `--json` | unchanged semantics |
| Report source | `spur history report --mode forensics` | task 0555 |
| Reduced reference | `plugins/sp/skills/issue-finding/references/session-formats.md` | root table + fallback note only (task 0553 R5) |

**No new CLI noun or verb.** The rewrite changes a command's flags and a skill's body; the `spur`
surface gains only what task 0555 adds.

#### Anti-patterns — what not to implement

- Do **not** leave `--use-history` working as an alias. Its meaning inverts — history becomes the
  default, so a flag that used to opt *in* would now be a confusing no-op (R1).
- Do **not** let removed flags surface as a generic "unknown option" error. Name the replacement.
- Do **not** widen the fallback conditions beyond the three in R3. "Fall back when the data plane
  seems insufficient" is not a contract; an agent will re-parse everything.
- Do **not** grow the skill. Extraction moves to the CLI (0492 R2); if `SKILL.md` gets longer, the
  split has not happened.
- Do **not** add typed mappers for unsupported sources to make the fallback unnecessary — deferred
  by the 2026-08-06 ruling.
- Do **not** describe a flag without checking it against the real command definition (R5). This is
  the exact drift class feature I3 exists to catch.

#### Cross-task contract

**Assumes from 0555:** `spur history report --mode forensics` emits the 8 derivable sections with
stable names and order; sections whose derived inputs are missing render as "not available". This
task composes those with the 6 model-authored sections and does not re-derive any of the 8.

**Assumes from 0553:** `session-formats.md` has already been reduced to the root-path table plus the
fallback note (0553 R5). This task must not re-add per-source fidelity prose there — the importer
`mappers.ts` is the single code authority (0489).

**Leaves for dependents:** none. This is the terminal task of feature E5's chain.
### Plan
- [ ] Read the current `plugins/sp/skills/issue-finding/SKILL.md` Phase 2 stance, then make report-first the default with task creation behind `--create-task` (R1, R3)
- [ ] Remove `--use-history` and `--no-task`, failing with a message naming the replacement (R1)
- [ ] Move DISCOVER/ANALYZE extraction and rendering into the CLI (R2)
- [ ] Shrink the skill to IDENTIFY/PROPOSE plus a `--create-task`-gated GENERATE (R2)
- [ ] Rewrite the raw-evidence stance and enumerate exactly the three fallback conditions (R3)
- [ ] Confirm categorization still works from the raw-JSONL fallback on a fixture session (R4)
- [ ] Tie documented flags to the real command definitions by assertion or test (R5)
- [ ] Update `docs/04_DESIGN.md` in the same commit (T3), then run `bun run autofix && bun run spur-check`
### Solution

<!-- Filled during implementation: file:line change map and concise rationale. -->

### Testing

<!-- Filled during verification: commands run, outcomes, coverage claim or N/A. -->

### Review

<!-- Filled during review: P1-P4 findings, residual risk, and final disposition. -->

### References
- **Specification:** feature E2 § *Decisions so far* — "`/sp:dev-find-issue` becomes report-first"
  (0492 R3, operator ruling 2026-08-10); "The command / skill split after the rewrite" (0492 R2);
  fallback conditions (0492 R7)
- **Files to rewrite:** `plugins/sp/commands/dev-find-issue.md` (thin wrapper),
  `plugins/sp/skills/issue-finding/SKILL.md` (424 lines; Phase 2 holds the stance being inverted)
- **Reduced by task 0553 (do not duplicate):**
  `plugins/sp/skills/issue-finding/references/session-formats.md`
- **Report this consumes:** task 0555 (`report --mode forensics`, 8 derivable sections)
- **Why categorization stays on raw JSONL (R4):** tool result content not retained — operator ruling
  2026-08-09 (~100 KB–5 MB/session)
- **Drift risk this must not add to (R5):** feature I3 (plugin prose versus the live CLI surface)
- **Surface docs (T3, same commit):** `docs/04_DESIGN.md`
### History
