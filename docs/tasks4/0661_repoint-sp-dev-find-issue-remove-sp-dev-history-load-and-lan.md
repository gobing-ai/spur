---
schema_version: 1
name: "Repoint /sp:dev-find-issue, remove /sp:dev-history-load, and land the coexistence and surface documentation"
status: done
template: feature-impl
created_at: 2026-08-25T04:06:58.604Z
updated_at: "2026-08-25T06:20:37.574Z"
feature_id: I8
priority: P2
tags: ["plugin", "command", "docs", "migration"]
dependencies: ["0658", "0660"]
---

## 0661. Repoint /sp:dev-find-issue, remove /sp:dev-history-load, and land the coexistence and surface documentation

### Background

The last slice of feature I8 is the operator-visible surface: shrink `/sp:dev-find-issue` from its
17-option hint to a thin forwarder over `sp:history-anatomy`, remove the obsolete
`/sp:dev-history-load` (its two supported import owners remain), and write down the bounded
coexistence and retirement gate for `sp:issue-finding` so coexistence cannot silently become
permanent. Surface documentation lands in the same change as the surface (constitution T3).

**Verified against the tree on 2026-08-24 — the full removal blast radius:**

| Surface | Evidence | Action |
| --- | --- | --- |
| The command file | `plugins/sp/commands/dev-history-load.md` | delete |
| The plugin script + twin | `plugins/sp/scripts/history-load.ts`, `history-load.mjs` | delete both |
| Its test | `plugins/sp/tests/history-load.test.ts` | delete |
| Manifest entry | `config/plugin-scripts.json` (`rel: history-load.ts`) | delete entry |
| Build chain | `package.json:60` — `build:scripts` names `history-load.ts` explicitly | remove from the chain |
| Role roster | `plugins/sp/references/roles.md:53` and `:97` | remove both mentions |
| Plugin README | `plugins/sp/README.md` | remove entry |
| Command-count assertion | `plugins/sp/tests/command-contract.test.ts:350` asserts **exactly 39** command files | update to 38 |
| Flag glossary `--source` | `flag-glossary.md:249-256` names **only** `dev-find-issue` and `dev-history-load` | entry becomes dead → delete it |
| Flag glossary `--task` | `flag-glossary.md:207-215` names `dev-history-load` | remove that mention |
| `pr-reviewing.test.ts:7` | comment reference only ("history-load pattern") | no change |
| `CHANGELOG.md` | historical record | no change |

**Preserved — verified independent of the plugin script:**

| Path | Evidence |
| --- | --- |
| `bun run load-history` | `package.json:93` — a standalone `history import && history analyze` chain; it does not call the plugin script |
| History UI **Import & Analyze** | `apps/web/src/modules/history/SourcesTab.tsx` |

**Two gates that make this self-enforcing:**

1. `flag-contract-parity.test.ts` carries a **C1 glossary-membership** check — a glossary entry
   naming a command that never declared the flag is a violation. Leaving `dev-history-load` in the
   `--source` / `--task` entries is therefore a *test failure*, not merely drift.
2. `script-contract-check` is two-sided — an orphaned `.mjs` twin with no manifest entry fails, and a
   manifest entry with no source fails. A half-finished removal cannot pass.

**Additions this task must make:**

- `--date <YYYY-MM-DD>` has **no** glossary entry today even though `dev-daily.md:4` already declares
  it. It becomes shared with `dev-find-issue`, so it earns a canonical entry.
- `--mode <kind>` (`flag-glossary.md:197-205`) lists per-command values; `daily|ad-hoc` on
  `dev-find-issue` joins that list.
- `--full` (`flag-glossary.md:299-311`) needs **no** change: `dev-find-issue` never declared it, and
  its two existing meanings (`dev-next`, `dev-dogfood`) survive.

Shapes: `docs/design/history-anatomy.md` §Operator surface, §Bounded coexistence and retirement,
§Removed surfaces.

### Requirements

- [x] R1. `plugins/sp/commands/dev-find-issue.md` contains exactly one skill invocation naming `sp:history-anatomy`, an argument-hint listing `--mode`, `--date`, `--since`, `--until`, `--recompute`, `--agent` and `--output` and none of the fourteen dropped flags, and a link to the shared flag glossary. Plugin command structure tests pass.
- [x] R2. Remove `plugins/sp/commands/dev-history-load.md`, its helper script, the `.mjs` twin, its test, its build-conversion entry and its `config/plugin-scripts.json` declaration. `bun run script-contract-check` passes and no shipped surface still references the removed command.
- [x] R3. `package.json`'s `load-history` script is unchanged, and the History module's **Import & Analyze** action and its queued refresh path are unchanged. Running the new command never triggers an import.
- [x] R4. `sp:issue-finding` remains packaged and directly invocable, documented as the legacy path, while `/sp:dev-find-issue` resolves to `sp:history-anatomy`. No logic is copied between them.
- [x] R5. The retirement gate is written down: parity fixtures covering typed history analysis, daily and focused range selection, repeated-work and error reporting, evidence and confidence, remediation proposals, performance, process observations and positive patterns; raw JSONL parsing and task creation named as intentional exclusions; adoption evidence defined as successful workflow run records across both modes with no bespoke telemetry added; a review point of one minor release or 30 days, whichever is later; and the statement that retirement needs explicit operator approval and is a separate change.
- [x] R6. The shared flag glossary carries a canonical `--date` entry (shared with `dev-daily`) and no dead roster references to the removed flags; the roles inventory, `plugins/sp/README.md` and `docs/04_DESIGN.md` describe the new command, skill and workflow.
- [x] R7. `bun run spur-check` passes and `git status` is intentional only.

### Acceptance Criteria

```gherkin
Feature: Command repoint, history-load removal, and coexistence documentation

  @core
  Scenario: R1 — The command is a thin forwarder carrying only the reduced surface
    Given the sp plugin command file "plugins/sp/commands/dev-find-issue.md"
    When the plugin command structure test suite loads it
    Then its body contains exactly one skill invocation and that invocation names "sp:history-anatomy"
    And its argument-hint lists "--mode", "--date", "--since", "--until", "--recompute", "--agent" and "--output"
    And its argument-hint names none of "--full", "--save", "--source", "--sessions", "--feature", "--template", "--priority", "--severity", "--category", "--top", "--min-cost", "--strict-topic", "--create-task" or "--json"
    And the body links the shared flag glossary at "../skills/spur-dev/references/flag-glossary.md"

  @core
  Scenario: R33 — Both supported import paths are preserved unchanged
    Given the feature is fully implemented
    When the import surfaces are inspected
    Then the "load-history" script in "package.json" is unchanged
    And the History module's "Import & Analyze" action and its queued refresh path are unchanged
    And running the new command never triggers an import

  @core
  Scenario: R34 — The obsolete history-load command is removed cleanly
    Given "/sp:dev-history-load" and its plugin helper are removed
    When the repository gates run
    Then "plugins/sp/commands/dev-history-load.md", the helper script, its ".mjs" twin, its test and its build-conversion entry are absent
    And its "config/plugin-scripts.json" declaration is absent
    And "bun run script-contract-check" passes
    And no shipped surface still references the removed command

  @core
  Scenario: R35 — Coexistence: the legacy skill stays invocable while the command resolves to the new one
    Given the feature is shipped
    When the plugin package is inspected
    Then "sp:issue-finding" remains packaged and directly invocable
    And it is documented as the legacy path
    And "/sp:dev-find-issue" resolves to "sp:history-anatomy"
    And no logic is copied from the legacy skill into the new one

  @core
  Scenario: R36 — The retirement gate is written down with a parity fixture set and a review date
    Given the coexistence window is defined
    When the retirement contract is inspected
    Then it lists parity fixtures covering typed history analysis, daily and focused range selection, repeated-work and error reporting, evidence and confidence, remediation proposals, performance, process observations, and positive patterns
    And it names raw JSONL parsing and task creation as intentional exclusions rather than parity gaps
    And it defines adoption evidence as successful workflow run records across both modes, with no bespoke telemetry added
    And it sets a review point of one minor release or 30 days, whichever is later
    And it states that retirement requires explicit operator approval and is a separate change

  @core
  Scenario: R37 — Shared surface documentation lands in the same change as the surface
    Given the command, skill and workflow surfaces have changed
    When the documentation gates run
    Then the shared flag glossary carries a canonical "--date" entry and no dead roster references to removed flags
    And the roles inventory, "plugins/sp/README.md" and "docs/04_DESIGN.md" describe the new surfaces
    And "bun run spur-check" passes
```

### Q&A

**Q: Feature I5 (`dev-history-load command: on-demand cumulative import + analyze`, status
`verifying`) shipped the command this task removes. What happens to it?**

Deferred to the operator, not decided here. Removing a shipped deliverable from a feature that has
not reached `done` is a corpus decision with two defensible answers — transition I5 to `cancelled`
with a pointer to I8, or let it reach `done` and record the supersession in its Notes. This task
does **not** transition I5 either way; it records the dependency so the decision is made
deliberately rather than as a side effect. Raise it at wrap-up.

**Q: `--full` — why is it dropped rather than kept alongside `--mode`?**

Closed. `--full` conflated report *intent* with *verbosity*, and the glossary already records two
unrelated meanings for it (`dev-next`, `dev-dogfood`); `dev-find-issue` would have been a third.
`--mode <daily|ad-hoc>` names the intent directly, and because mode is part of the daily cache
identity tuple, a boolean verbosity flag could not have keyed the cache at all. No glossary change
to `--full` is needed — `dev-find-issue` never declared it.

### Design

**WHAT.** Repoint one command, delete another and its whole surface footprint, add the retirement
gate for `sp:issue-finding`, and reconcile the shared flag glossary and rosters.

**WHY.** The command surface is what operators actually see. Leaving the 17-option hint or the
obsolete loader in place would ship the feature's cost without its benefit.

**WHERE.** See the blast-radius table in Background — it is the file list, verified against the
tree, and is the authority for this task's scope.

**Frozen command surface** (`plugins/sp/commands/dev-find-issue.md` frontmatter):

```yaml
role: reviewer
argument-hint: "[<focus>] [--mode <daily|ad-hoc>] [--date <YYYY-MM-DD>] [--since <RFC3339>] [--until <RFC3339>] [--recompute] [--agent <inline|auto|name>] [--output <path>]"
```

Body: the execution-surface prelude, the Argument Flags table, a link to the shared flag glossary,
and exactly one invocation — `Skill(skill="sp:history-anatomy", args="$ARGUMENTS")`. Nothing else.

**Fourteen flags leave the hint:** `--full`, `--save`, `--source`, `--sessions`, `--feature`,
`--template`, `--priority`, `--severity`, `--category`, `--top`, `--min-cost`, `--strict-topic`,
`--create-task`, `--json`.

**Ordering within the task.** Do the glossary edits **with** the command edits, not after — the C1
membership gate reads both surfaces together, so a split leaves the tree red between steps.

**ADR-065 amendment.** Its Decision enumerates the seven standard scripts by name; removing
`history-load.ts` changes that roster. Land an `**Amendment (YYYY-MM-DD)**` block per constitution
§6.1 rule 3 — never a rewrite. If 0659 lands in the same commit, one amendment block covers both the
removal and the addition.

**Retirement gate (new content, written into `plugins/sp/README.md` beside the skill roster):**

- **Parity fixtures** the new contract must cover before retirement is considered: typed history
  analysis; daily and focused range selection; repeated-work and error reporting; evidence and
  confidence; remediation proposals; performance analysis; process observations; positive patterns.
- **Intentional exclusions, not gaps:** raw JSONL parsing and task creation.
- **Adoption evidence:** successful `history-anatomy.yaml` run records across both modes and the
  available source families. No bespoke telemetry is added to count adoption.
- **Review point:** one minor release or 30 days, whichever is later.
- **Gate:** parity PASS + demonstrated use of both modes + no open high-impact regression + explicit
  operator approval. A failed gate records the missing evidence and one dated extension.
- **Retirement is a separate change.** This task does not remove `sp:issue-finding`.

**Anti-patterns — do not implement.**

- Do **not** touch `package.json:93` `load-history`. It is the preserved import owner and is
  independent of the deleted plugin script. Deleting it would remove a supported ingress path the
  feature explicitly protects.
- Do **not** remove or modify `sp:issue-finding`, its fixtures, or its references. Coexistence is the
  deliverable; retirement is a later, separately-approved change.
- Do **not** leave `dev-history-load` in the `--source` or `--task` glossary entries. The `--source`
  entry names only the two commands losing it and must be **deleted**, not edited.
- Do **not** copy the removed command's behavior into `dev-find-issue.md`. The forwarder carries one
  skill invocation.
- Do **not** rewrite ADR-065's original entry. Append an amendment block.
- Do **not** forget `plugins/sp/tests/command-contract.test.ts:350` — it asserts exactly 39 command
  files and will fail at 38 until updated.
- Do **not** silently transition feature I5. See Q&A.

**Cross-task.** Depends on 0658 (the skill must exist before the command can point at it) and 0660
(the docs describe the workflow). Assumes 0659 landed the new script's manifest entry; if both this
task and 0659 edit `config/plugin-scripts.json` and `package.json:60` in the same commit, reconcile
them in one edit rather than two conflicting ones.

### Plan

- [x] 1. Rewrite `plugins/sp/commands/dev-find-issue.md` to the frozen frontmatter and a body of
      prelude + flags table + glossary link + one `Skill(skill="sp:history-anatomy", …)`
      invocation. (R1)
- [x] 2. Delete `plugins/sp/commands/dev-history-load.md`, `plugins/sp/scripts/history-load.ts`,
      `plugins/sp/scripts/history-load.mjs`, and `plugins/sp/tests/history-load.test.ts`. (R2)
- [x] 3. Remove the `history-load.ts` entry from `config/plugin-scripts.json` and its
      `superskill script convert` call from `package.json:60` `build:scripts`. (R2)
- [x] 4. Update `plugins/sp/tests/command-contract.test.ts:350` from 39 to 38 command files. (R2)
- [x] 5. Remove the `dev-history-load` mentions at `plugins/sp/references/roles.md:53` and `:97`,
      and from `plugins/sp/README.md`. (R2, R6)
- [x] 6. Glossary, in the same step as the command edits (the C1 membership gate reads both):
      delete the now-dead `--source` entry; drop `dev-history-load` from `--task`; add
      `daily|ad-hoc` on `dev-find-issue` to `--mode`; add the canonical `--date` entry shared with
      `dev-daily`. Leave `--full` untouched. (R6)
- [x] 7. Verify `package.json:93` `load-history` and the History UI **Import & Analyze** path are
      byte-unchanged, and that no new-command path invokes an import. (R3)
- [x] 8. Confirm `sp:issue-finding` remains packaged and directly invocable, documented as the
      legacy path, with no logic shared with the new skill. (R4)
- [x] 9. Write the retirement gate (parity fixtures, intentional exclusions, adoption evidence,
      review point, approval requirement, separate-change statement) beside the skill roster in
      `plugins/sp/README.md`. (R5)
- [x] 10. Add the ADR-065 amendment block for the standard-script roster change; reconcile with
      0659's edit if both land in one commit. (R2)
- [x] 11. Add the new command, skill and workflow to `docs/04_DESIGN.md` (same-commit T3). (R6)
- [x] 12. Raise the feature I5 disposition (see Q&A) with the operator at wrap-up; do not transition
      it in this task.
- [x] 13. Gate: `bun test plugins/sp/tests/command-contract.test.ts` and
      `plugins/sp/tests/flag-contract-parity.test.ts` first, then `bun run script-contract-check`,
      then `bun run spur-check`, then confirm `git status` is intentional only. (R7)

### Solution

**Goal:** shrink `/sp:dev-find-issue` to a thin `sp:history-anatomy` forwarder carrying the reduced
surface, remove the obsolete `/sp:dev-history-load` and its whole footprint, and write down the
bounded coexistence/retirement gate for `sp:issue-finding` — surface documentation in the same change.

| File | Change |
| --- | --- |
| `plugins/sp/commands/dev-find-issue.md:4` | Rewritten to the frozen `argument-hint` (line 4): the kept flag set (mode, date, since, until, recompute, agent, output) with no dropped flag; one Skill invocation at `:47` naming sp:history-anatomy; glossary link; Usage section added. |
| deleted | dev-history-load.md plus the history-load helper script, its twin, and its test — the removed command's full footprint. |
| `config/plugin-scripts.json` | history-load.ts manifest entry removed. |
| `package.json` | history-load.ts removed from the build:scripts convert chain; the load-history script unchanged. |
| `plugins/sp/tests/command-contract.test.ts` | Command counts 39 to 38; the wrapper test repointed to sp:history-anatomy with the reduced surface. |
| `plugins/sp/tests/skill-structure.test.ts` | R24b repointed to the new delegation; legacy sp:issue-finding still asserted packaged. |
| `plugins/sp/tests/issue-finding-fallback.test.ts` | The 0556 R5 command assertion updated to the reduced surface. |
| `plugins/sp/skills/spur-dev/references/flag-glossary.md` | task entry cleaned; dead source entry deleted; mode gains daily-or-adhoc; canonical date entry added; output lists dev-find-issue. |
| `plugins/sp/references/roles.md` | dev-history-load removed from the scribe roster and placement notes; count note to 38. |
| `plugins/sp/README.md` | command row removed; find-issue row rewritten; issue-finding marked legacy; the retirement gate written; counts to 38. |
| `docs/00_ADR.md` | Second ADR-065 amendment recording the roster drop of history-load.ts. |
| `docs/04_DESIGN.md` | 0556 paragraph superseded; history-anatomy surfaces documented (T3). |

Preserved and verified: package.json load-history and the History UI Import & Analyze path are
unchanged; the new command never triggers an import; sp:issue-finding remains packaged and directly
invocable with no shared logic. Feature I5's disposition is deferred to wrap-up.

### Testing

**Pipeline verify results**

- Verdict: PASS (from verdict artifact)

| Requirement | Status | Evidence |
| ------------- | -------- | ---------- |
| R1 | MET | plugins/sp/commands/dev-find-issue.md:1 thin forwarder; reduced surface; 14 dropped flags absent; structure tests pass. |
| R2 | MET | dev-history-load.md + history-load.{ts,mjs} + test deleted; manifest + build chain cleaned; script-contract-check PASS. |
| R3 | MET | package.json:93 load-history unchanged; SourcesTab.tsx:99 Import & Analyze untouched; no import trigger in the new command. |
| R4 | MET | sp:issue-finding packaged + legacy-documented; no shared logic. |
| R5 | MET | Retirement gate in plugins/sp/README.md beside the skill roster. |
| R6 | MET | flag-glossary (+ --date, --mode, --output; - --source, --task cleanup); roles.md; README; docs/04_DESIGN.md (T3). |
| R7 | MET | bun run spur-check PASS; git status intentional. |

- Coverage: N/A (verdict-based; verify pipeline does not measure code coverage)

### Review

**Final disposition: APPROVED** — implementation satisfies all seven requirements; no P1–P3 findings.

| Priority | Finding | Evidence |
| --- | --- | --- |
| P4 (note) | Feature I5 (`dev-history-load`, status `verifying`) records a shipped deliverable this task removed. Its disposition (cancelled vs. done-with-supersession-note) is deliberately deferred to wrap-up per the task Q&A — recorded, not decided here. | `docs/tasks4/0661_...md` Q&A |

No P1/P2/P3.

- R1 (thin forwarder, reduced surface): `plugins/sp/commands/dev-find-issue.md:1` — one `Skill(skill="sp:history-anatomy", …)` invocation; `--mode/--date/--since/--until/--recompute/--agent/--output` kept; the fourteen dropped flags absent; glossary linked. Plugin structure tests pass (185 across the four contract suites).
- R2 (full removal): dev-history-load.md, history-load.{ts,mjs}, history-load.test.ts deleted; manifest entry + build chain entry removed; `script-contract-check` PASS (15 scripts). Blast-radius grep shows only historical prose references remain.
- R3 (import owners preserved): `package.json:93` load-history byte-unchanged; History UI Import & Analyze untouched; the new command never triggers an import.
- R4 (coexistence): `sp:issue-finding` remains packaged + directly invocable, marked legacy in README; no logic shared.
- R5 (retirement gate): written in `plugins/sp/README.md` beside the skill roster — parity fixtures, intentional exclusions (raw history-file parsing, task creation), adoption evidence (workflow run records, no bespoke telemetry), review point (one minor release or 30 days), explicit operator approval, separate-change statement.
- R6 (surface docs): `--date` canonical glossary entry + `--mode` extended + `--source` dead entry removed + `--task` cleaned + `--output` updated; roles inventory, README, and `docs/04_DESIGN.md` describe the new surfaces (T3 same commit).
- R7 (gate + git status): `bun run spur-check` PASS.

- Security: no new trust boundary; the removal shrinks the command surface (fewer flags = smaller attack/churn surface). The preserved import paths are untouched, so no regression in the only supported ingress.
- Efficiency: the forwarder is one Skill() line; the previous 17-option hint is gone.
- Correctness: the C1 glossary-membership gate and the two-sided script-contract check make the removal self-enforcing; the reduced flag set is pinned by three test suites.
- Architecture: command surface, skill, and workflow align to one contract; the legacy skill stays isolated (no copied logic), keeping the coexistence clean and the future retirement a separate change.

None material. The I5 disposition decision is the only open item, intentionally deferred to wrap-up.

### References

<!-- Links to the parent feature, design docs, related tasks, or external references. -->

### History

- 2026-08-25T06:15:33.878Z todo → wip (system)
- 2026-08-25T06:20:37.574Z wip → done (system)
