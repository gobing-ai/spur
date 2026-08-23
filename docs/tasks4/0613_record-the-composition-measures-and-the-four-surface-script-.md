---
schema_version: 1
name: "Record the composition measures and the four-surface script placement rule as authority"
status: done
template: feature-impl
created_at: 2026-08-20T23:18:21.495Z
updated_at: "2026-08-22T06:28:27.701Z"
feature_id: A3
priority: P1
---

## 0613. Record the composition measures and the four-surface script placement rule as authority

### Background

ADR-069 ("Workflow YAML Orchestrates Owned Capabilities") is still **Proposed** and states the
ownership principle without any detectable measure, so nothing can act on it. ADR-043 already prefers
pure slash commands in `agent.run` inputs but attaches no measure either.
`docs/design/workflow-shell-ownership.md` (accepted, task 0608) classifies all 58 `onEnter`/`onExit`
shell programs into five owner options (a–e) and grants a bulk exception for the 92 transition
guards — the fix vocabulary exists; the trigger does not.

On the script side, ADR-051 owns the public-CLI-vs-internal-spur-dev boundary and ADR-065 owns the
`plugins/sp/scripts` entrypoint contract, but neither mentions `package.json` script entries, and no
single record answers "which of the four surfaces does this new script belong on?". The gap is why
misplacement keeps accruing.

This task writes authority first: the measures, the placement table, and the operator consent record
that unblocks every sibling task under ADR-051's consent gate. No code and no advisory ships here.

Rubric: E2 D0 L1 C2 R2 = 7 → decompose (authority must land before the tooling that cites it).

### Requirements
- [x] R1. Amend ADR-069 with the `shell` composition measure — a line-count threshold above which an action is reported as to-be-enhanced — and name the recommended fixes as the five owner options already recorded in `docs/design/workflow-shell-ownership.md`, justified against the classified programs on this tree rather than asserted.

- [x] R2. Amend ADR-069 with the `agent.run` composition measure: a non-slash `input` is the reporting trigger (per ADR-043), raw prompt length sets severity only, and the recommended fix is to move the operation behind a centralized agent skill or slash command.

- [x] R3. State in the ADR-069 amendment that composition findings are advisory: they never change a validate exit status, never block a run, and are not added to `spur-check` / `spur-check-new`.

- [x] R4. Amend ADR-051 with one placement table covering all four script surfaces (`apps/cli/src/commands`, `scripts/commands`, `package.json`, `plugins/sp/scripts`), cross-referencing ADR-065 for the plugin-script entrypoint contract instead of restating it.

- [x] R5. Record in the ADR-051 amendment the operator consent granted for this feature's public-surface changes (`spur self`, `spur builder`, `--fix` on the two check verbs, `spur workflow show`, the doctor AUTH column removal, and the `workflow validate` composition output), and author `docs/design/harness-surface-governance.md` plus its `docs/04_DESIGN.md` §0 index row in the same commit.
### Acceptance Criteria

```gherkin
@core
Scenario: R1 — ADR-069 carries a mechanical shell composition measure with its fix options
  Given ADR-069 states that reusable deterministic behavior belongs to an owning module but names no detectable threshold
  When the decision record is amended
  Then it states a line-count threshold above which a shell action is reported as to-be-enhanced
  And it names the recommended fixes as the owner options already recorded for shell programs
  And the threshold is justified against the classified programs on this tree, not asserted

@core
Scenario: R2 — ADR-069 carries an agent.run composition measure keyed on non-slash invocation
  Given ADR-043 already prefers pure slash commands in agent.run inputs but attaches no measure
  When the decision record is amended
  Then a non-slash agent.run input is the condition that reports the action as to-be-enhanced
  And raw prompt length sets the reported severity rather than triggering the report
  And the recommended fix is to move the operation behind a centralized agent skill or slash command

@core
Scenario: R6 — ADR-051 records the four-surface placement table and this feature's consent
  Given script placement is governed by two partial records that omit package.json entries entirely
  When ADR-051 is amended
  Then one table names all four script surfaces with the condition that selects each
  And the amendment records the operator consent granted for this feature's public surface changes
  And the plugin-script contract remains owned by its existing record rather than being restated
```

### Q&A

<!-- CLOSED decisions from refinement: what was chosen and why, what was deferred and on what
     condition. Not a parking lot for open questions — an unanswered question here means the task
     is not ready to hand off. Keep empty if none. -->

### Design

**Amend, do not invent.** ADR-069 already carries the decision; ADR-051 already owns the
CLI boundary. Adding a third record for either concern would create a competing authority, and the
constitution's conflict rule (lower number wins on content) would make the new record lose
immediately. Both changes are amendments in place.

**ADR-065 is cross-referenced, not absorbed.** The plugin-script entrypoint contract has its own
accepted record with a live two-sided gate (`script-contract-check`). The ADR-051 table names
`plugins/sp/scripts` as a surface and points at ADR-065 for what landing there requires.

**The threshold number is deliberately not frozen here.** The operator proposed 5 lines and marked it
TBD. This task states the measure and its shape; the calibration — flag rate measured at several
thresholds with dispositions applied — is the sibling advisory task's deliverable, and the ADR
records the chosen number once it survives contact. Writing a number here that the measurement later
contradicts is the failure mode to avoid.

**Consent is recorded once, centrally.** ADR-051's gate requires explicit operator consent with
design context for every noun/verb/flag/observable-output change. Six sibling tasks each carry one.
Recording all of them in one amendment means no sibling re-litigates the gate mid-implementation.

**The satellite lands with the ADRs.** `docs/design/harness-surface-governance.md` is derived from
these decisions; authoring it in the same commit satisfies the constitution's detail-first-then-index
order (§4.5 rule 5, sync trigger T9) and keeps the `04` index invariant of exactly one row per
satellite.

### Plan
- [x] Read ADR-069, ADR-043, ADR-051, ADR-065 and `docs/design/workflow-shell-ownership.md` to fix the exact amendment sites and the existing owner-option vocabulary
- [x] Amend ADR-069 with the shell measure, the agent.run measure, and the advisory-only posture (R1, R2, R3)
- [x] Promote ADR-069 from Proposed to Accepted, or record why it stays Proposed
- [x] Amend ADR-051 with the four-surface placement table, cross-referencing ADR-065 (R4)
- [x] Append the consent record for the six public-surface changes to the ADR-051 amendment (R5)
- [x] Author `docs/design/harness-surface-governance.md` and add its single `docs/04_DESIGN.md` §0 index row (R5)
- [x] Reconcile `AGENTS.md` § Spur CLI surface with the new placement table
- [x] Run `bun run lint` and the link check; confirm no gate was added by this task
### Solution
Authority-only change (no code, no tooling) implementing R1–R5:

- `docs/00_ADR.md:882-904` — ADR-069 amendment: R1 shell measure (unit = non-comment shell line split on newline/`;`; fixes closed to the five owner options in `docs/design/workflow-shell-ownership.md`; threshold deliberately unfrozen — measured flag rates >3→30, >4→25, >5→21, >6→18, >8→14 of 58; `>5` recorded as the candidate separator), R2 agent.run measure (non-slash `input` triggers per ADR-043; raw prompt length = severity only; fix = centralized skill/slash command), R3 advisory posture (never changes validate exit, never blocks, not in spur-check/spur-check-new); status Proposed → Accepted with rationale.
- `docs/00_ADR.md:482-503` — ADR-051 amendment: R4 four-surface placement table (`apps/cli/src/commands` / `scripts/commands` / `package.json` scripts / `plugins/sp/scripts`) with audience-selected condition per surface, ADR-065 cross-referenced for the plugin entrypoint contract (not restated); R5 consent record for the six feature-A3 public-surface changes (spur self 0616, spur builder 0617, --fix 0619, workflow show 0620, doctor AUTH-column removal 0621, workflow validate advisory output 0614).
- `docs/design/harness-surface-governance.md:1-94` — new derived satellite: operational view of both amendments (§1 measures + measured distribution table, §2 placement table + decision procedure, §3 consent table, §4 follow-ups).
- `docs/04_DESIGN.md:67` — `harness-surface-governance.md` single §0 index row; frontmatter `updated_at` → 2026-08-21.
- `AGENTS.md:260-276` — § Spur CLI surface "two surfaces" table → four-surface table with selection condition + consent-gate scope; ADR-051 amendment xref.
- Measurement evidence: `/tmp/measure-shell.mjs` parses `config/workflows/*.yaml` (57 state-hook shell actions joined programmatically + `doc-sync:onEnter:1` joined manually against the doc's stale key `learning-capture:onEnter:1` — 58/58 total).

Follow-up notes (outside scope):
- `docs/design/workflow-shell-ownership.md` key `learning-capture:onEnter:1` is stale (state renamed `doc-sync` by task 0607) — re-key + re-measure belongs to 0614.
- Threshold freeze + ADR number update: 0614 deliverable after calibration.

No gate added: no changes to `config/`, `package.json`, or `spur-check*`.
### Testing
Quality gate: `bun run format && bun run spur-check` — PASS (exit 0, 66 s; 6036 tests / 323 files, 0 fail).

- link-check, transition-shim-check, script-contract-check, lint, test-pre/post-check all green
- docs-only change set (AGENTS.md, docs/00_ADR.md, docs/04_DESIGN.md, docs/design/harness-surface-governance.md, task 0613 corpus file); coverage claim N/A — no production code touched
- artifacts: `.spur/run/0613-test-gate.{status,log,findings}` (status=0)
### Review
**Verdict: PASS** — inline review (functional traceability + SECUA + architecture), session host-session-inline-20260821-075903-11109.

**Traceability (AC → evidence):**
- R1 shell measure recorded with measured evidence: `docs/00_ADR.md:885-895` (58-program basis, flag rates >3→30, >4→25, >5→21, >6→18, >8→14, `>5` candidate, threshold unfrozen pending 0614) + distribution table `docs/design/harness-surface-governance.md` §1.1.
- R2 agent.run measure: `docs/04_DESIGN.md` D5 seam §20 unchanged; measure at `docs/00_ADR.md:896-898` (non-slash input = trigger per ADR-043, length = severity only, fix = centralized skill/slash).
- R3 advisory posture: `docs/00_ADR.md:899-900` (never changes validate exit, never blocks, not in spur-check/spur-check-new).
- R4 four-surface table: `docs/00_ADR.md:482-497` + satellite §2 + `AGENTS.md:260-276` (two-surface table replaced).
- R5 consent record: `docs/00_ADR.md:498-503` (six changes, each citing task).
- R6 promotion: `docs/00_ADR.md:902-904` — Proposed → Accepted with rationale (detectable measures + fix vocabulary = the acceptance case).
- Test gate: `.spur/run/0613-test-gate.{status,log,findings}` — `bun run format && bun run spur-check` exit 0, 6036 tests / 323 files, 0 fail.

**SECUA:** no new code; no security/surface change beyond documented authority text. No `any`, no error-handling, no logging changes.

**Architecture:** follows lower-number-wins (ADR-069/051 amended in place, no third record); satellite is derived (points to ADRs as authority); no second convention created — the five owner options and the ADR-065 plugin contract are cross-referenced, not restated.

**Findings: none (P1–P4).**

Out-of-scope follow-ups (recorded, not folded in):
- `docs/design/workflow-shell-ownership.md` stale key `learning-capture:onEnter:1` → re-key to `doc-sync` (state renamed by 0607); 0614 scope.
- Threshold freeze + ADR number update after 0614 calibration.

| Priority | Dimension | Location | Finding |
|---|---|---|---|
| P4 | Traceability | `docs/00_ADR.md:482-503` | ADR-051 R4 four-surface placement table and R5 consent record landed with six A3 public-surface changes and task cites; verified against `docs/design/harness-surface-governance.md` §1.1 measured distribution |
| P4 | Traceability | `docs/00_ADR.md:885-904` | ADR-069 R1–R3 recorded: R1 shell measure (58/58 classified), R2 agent.run measure, R3 advisory posture; status Proposed → Accepted per R6 |
### References

<!-- Links to the parent feature, design docs, related tasks, or external references. -->

### History
- 2026-08-21T15:31:43.420Z todo → done (system)
