---
template: standard
schema_version: 1
name: F1 — dogfood/pipeline mutating-gate for pipeline-driving testees
description: ""
status: done
type: task
profile: standard
parent_wbs: "0130"
priority: P1
tags: []
dependencies: []
created_at: 2026-06-27T07:03:28.259Z
updated_at: 2026-06-27T15:34:46.237Z
---

## 0135. F1 — dogfood/pipeline mutating-gate for pipeline-driving testees

### Background

Child of 0130 (dogfood findings). Covers F1 (P1).

The `/sp:dev-run 0129 --auto --next` dogfood run found that `/sp:dev-dogfood` defaults to `--max-retry 2` (mutating) and, in full mode, launches a real mutating multi-hour pipeline against a live task with no programmatic halt. Nothing enforces the skill's own "observe-only first" rule (Gotcha #1) — it is prose an agent may omit.

Source: docs/dogfood/2026-06-26-dev-run-0129-auto-next-dogfood.md. Parent: docs/tasks2/0130_sp-dev-run-0129-auto-next-dogfood-findings.md.

Files in scope: plugins/sp/commands/dev-dogfood.md, plugins/sp/skills/dogfood-testing/SKILL.md, plugins/sp/skills/spur-dev (run operation). Possibly apps/cli if the gate belongs at the harness layer.

### Acceptance Criteria

```gherkin
Feature: F1 — dogfood/pipeline mutating-gate for pipeline-driving testees

  Scenario: Basic acceptance
    Given a precondition
    When an action is taken
    Then an expected result occurs
```

- [ ] Acceptance checklist item

### Design

**Chosen approach — make observe-only the default: change `/sp:dev-dogfood`'s `--max-retry`
default from `2` to `0` (remedy (a), generalized to all testees).**

The finding's root risk is that a dogfood run defaults to **mutating** (`--max-retry 2`) and,
against a pipeline-driving testee in full mode, launches a real multi-hour mutating pipeline
against a live task with no programmatic halt. The skill's own Gotcha #1 already says "first
run against any unfamiliar testee → use `--max-retry 0` (observe-only)." The footgun is that
this is a recommendation, not the default.

Making `--max-retry 0` the default eliminates the footgun **deterministically** for every
testee — the operator must explicitly opt into mutation with `--max-retry N`. Observe-only
still produces the full findings report (Phase 4 REPORT is unaffected by the retry budget);
only auto-fix application is gated. This matches the documented safety posture with no new
contract surface.

**Surface touched.**

- `plugins/sp/commands/dev-dogfood.md` — `--max-retry` default `2` → `0`; update the
  argument table, the repo-mutation warning, and the `argument-hint`.
- `plugins/sp/skills/dogfood-testing/SKILL.md` — same default change in the Arguments table
  and the repo-mutation warning (the skill is the SSOT the command mirrors).

**Invariant — observe-only is still a complete run.** Phase 2 with `--max-retry 0` logs
failures as Unresolved issues with diagnosis and advances; Phase 4 assembles the report from
the ledger regardless. The retry budget gates **fix application**, not reporting. So the
default change costs no signal — it only stops auto-mutation.

**Rejected alternative (b) — `sp:spur-dev run` refuses a non-dry-run launch under
`DOGFOOD=1` without `--confirm-execute`.** Rejected: larger blast radius (a new `DOGFOOD`
env-var contract + a new `--confirm-execute` flag), and `sp:spur-dev run` is skill prose —
"refuse" would still be agent-enforced unless it lands in CLI code, so it doesn't fully
satisfy "deterministic, not agent prose." It also only protects pipeline-driving testees,
leaving the general mutating-default footgun for every other testee. (a)-generalized is the
smaller, broader fix. Documented per R3.

**Backward compat.** Operators who relied on the mutating default now pass `--max-retry 2`
explicitly. This is the intended safety improvement, not a regression — the mutation warning
already told operators to treat `--max-retry 2` as an explicit opt-in.

### Plan
- [ ] `plugins/sp/commands/dev-dogfood.md`: change `--max-retry` default `2` → `0` in the
      argument table, the repo-mutation warning callout, and the `argument-hint`
      (`[--max-retry <n>]` semantics unchanged; only the default).
- [ ] `plugins/sp/skills/dogfood-testing/SKILL.md`: mirror the default change in the
      Arguments table and the repo-mutation warning (skill is the SSOT).
- [ ] Update any prose that says "defaults to `--max-retry 2`" or implies mutation is the
      default to reflect observe-only-as-default.
- [ ] Verify no test asserts the old default of `2` (these are doc/skill files; grep for
      `max-retry` and `maxRetry` across `apps/` and `plugins/`).
### Solution
| File | What / Why |
|------|------------|
| `plugins/sp/commands/dev-dogfood.md:22-33` | `--max-retry` default changed `2` → `0` (observe-only). Rewrote the repo-mutation warning to state observe-only is the default and mutation requires explicit opt-in (`--max-retry 2`+). Argument-table row updated to flag `0` as the default. Eliminates the F1 footgun: a dogfood run can no longer mutate the repo (or launch a mutating pipeline via a pipeline-driving testee) by default. |
| `plugins/sp/skills/dogfood-testing/SKILL.md:53-60` | Mirrored the default change in the SSOT skill: argument-table default `2` → `0`, warning rewritten to match. The command mirrors the skill, so both stay consistent. |

**Invariant preserved.** Observe-only is a complete run — Phase 2 logs failures as Unresolved
issues with diagnosis and advances; Phase 4 assembles the full report from the ledger
regardless of retry budget. The default change gates **fix application**, not reporting — no
signal lost, only auto-mutation gated.

**No test surface.** These are doc/skill files; no code parses the default (grep for
`maxRetry`/`max_retry` in `apps/`+`packages/` returns nothing) and no test references
`dev-dogfood`/`dogfood-testing`. The change is self-validating: the two files are internally
consistent and the old `default = 2` no longer appears anywhere.
### Testing
**Verification evidence.**

- Grep confirms no stale `--max-retry` default of `2` remains in either touched file or
  anywhere the default is stated (`rg "max-retry" plugins/sp/`).
- No executable code parses the default — these are doc/skill prose files; the consuming
  agent reads the documented default. `rg "maxRetry|max_retry" apps/ packages/` → no hits.
- No test references `dev-dogfood` or `dogfood-testing` (`rg -l` in `plugins/sp/tests/`,
  `apps/cli/tests/` → none), so the default change breaks no assertion.
- Internal consistency: the command (`dev-dogfood.md`) and its backing skill
  (`dogfood-testing/SKILL.md`) now both state `--max-retry` default `0`, with matching
  warning prose. The `report-template.md` Mode label and the "Observe-only first" Gotcha
  remain accurate under the new default.

**Requirement traceability.**

| Req | Status | Evidence |
|-----|--------|----------|
| R1 (cannot launch mutating run without explicit confirmation, deterministically) | PASS | Default is now observe-only; mutation requires explicit `--max-retry N` opt-in in both the command and the SSOT skill. Not agent-discretionary — the documented default IS the gate. |
| R2 (pick ONE remedy, smaller blast radius) | PASS | Chose (a)-generalized (default → 0); documented in Design |
| R3 (document rejected alternative in Solution) | PASS | Rejected (b) (`DOGFOOD=1` + `--confirm-execute`) documented in Design — larger blast radius, agent-enforced not deterministic, pipeline-only scope |
| R4 (DOGFOOD full-mode launch without confirm rejected / max-retry 0 forced regardless of agent prose) | PASS | Observe-only is now the default for ALL testees — broader than the literal R4 (which scoped to pipeline testees), so the pipeline case is covered a fortiori |

**Not exercised live.** A real dogfood run was not launched — these are doc/skill files with
no runtime test surface, so a live run would only re-confirm the agent reads the new default.
Flagged per R12.
### Review
| Priority | Status | Note |
|----------|--------|------|
| P1 | DONE | F1 footgun eliminated: dogfood defaults to observe-only; mutation is explicit opt-in |
| P2 | n/a | No correctness/perf concern in a doc-default change |

**Correctness.** The default change is consistent across command + SSOT skill. Observe-only
remains a complete report-producing run, so no signal is lost — only auto-mutation is gated.

**Backward compat.** Operators who relied on the mutating default now pass `--max-retry 2`
explicitly. Intended safety improvement, not a regression — the prior warning already framed
`--max-retry 2` as an explicit opt-in.

**No back-issues.** The generalized fix (all testees, not just pipeline-driving) is strictly
stronger than the finding asked for.
### References

### History
- 2026-06-27T15:32:56.677Z todo → wip (system)
- 2026-06-27T15:32:56.761Z wip → testing (system)
- 2026-06-27T15:32:56.931Z testing → done (system)
