---
template: feature-impl
schema_version: 1
name: "Establish the transition-shim marker and two-sided manifest gate"
description: ""
status: done
type: task
profile: standard
feature_id: B2
parent_wbs: null
priority: P2
tags: []
dependencies: []
ac_numbering: task-local
created_at: "2026-08-13T23:55:21.972Z"
updated_at: "2026-08-14T00:53:37.605Z"
---

## 0541. Establish the transition-shim marker and two-sided manifest gate

### Background
Feature B2's role model replaces three things at once — `--agent`'s accepted values, `agent.default`'s
value domain, and the spec-addressing path. Each needs a compatibility shim during the transition,
and shims that nobody tracks become permanent.

Operator ruling 2026-08-13: compatibility is accepted for the transition period, but every shim
carries a mark so it can be found and removed once the new model is proven.

This repo already has the correct pattern for that. `config/corpus-baseline.json` is **two-sided**:
an unlisted error fails the gate, **and** a listed entry that no longer reproduces also fails. That
second half is what stops it decaying into a silent suppression list
(`packages/app/src/services/corpus-check.ts`). Shim tracking needs exactly the same property.

This task builds the gate before the shims it governs, so 0536/0537/0538 have somewhere to register.
### Requirements
- [x] **R1.** Define a source marker `@transition-shim(<id>)` usable in a comment on any compatibility
      path, plus `config/transition-shims.json` recording per id: the owning WBS, the file, what it
      keeps working, and the condition under which it is removed. Measurable: the manifest parses and
      every field is required.
- [x] **R2.** The gate is two-sided, matching `corpus-baseline.json`. A marker in source with no
      manifest entry fails, **and** a manifest entry whose marker no longer appears in source fails.
      Measurable: a test proves both directions independently — adding an unregistered marker fails,
      and deleting a registered marker's code fails until its manifest entry is removed.
- [x] **R3.** The gate runs in the existing quality gate, not as a separate opt-in step. Wire it where
      `corpus-check` already runs so a shim cannot be added or forgotten without CI noticing.
      Measurable: `bun run spur-check` fails on both violation directions in R2.
- [x] **R4.** The manifest is the removal worklist. Document in `docs/04_DESIGN.md` that emptying
      `config/transition-shims.json` is the definition of the transition being complete, and that a
      shim's removal condition must be objectively checkable rather than "when convenient".
      Measurable: the doc states both, and every seeded entry has a checkable condition.
### Acceptance Criteria
```gherkin
Scenario: R1 — A shim marker has a manifest entry describing its removal
  Given a compatibility path marked @transition-shim(<id>) in source
  When config/transition-shims.json is read
  Then an entry with that id records the owning WBS, the file, what it keeps working, and its removal condition
  And every field is required

Scenario: R2 — An unregistered marker fails the gate
  Given a source marker whose id has no manifest entry
  When the gate runs
  Then it fails naming the marker id and the file
  And it reports the violation as a new unregistered shim

Scenario: R3 — A stale manifest entry fails the gate
  Given a manifest entry whose marker no longer appears in source
  When the gate runs
  Then it fails naming the entry id
  And it reports the violation as a stale entry, distinct from an unregistered marker

Scenario: R4 — The gate runs inside the existing quality gate
  Given the project quality gate is bun run spur-check
  When either violation direction is present
  Then spur-check exits non-zero
  And no separate opt-in step is required to detect it

Scenario: R5 — Removal conditions are objectively checkable
  Given a manifest entry's removal condition
  When it is read
  Then it states a condition that can be evaluated against the repository
  And a condition resolvable only by human judgement is rejected in review
```
### Q&A

<!-- CLOSED decisions from refinement: what was chosen and why, what was deferred and on what
     condition. Not a parking lot for open questions — an unanswered question here means the task
     is not ready to hand off. Keep empty if none. -->

### Design
**Reuse, do not invent.** `packages/app/src/services/corpus-check.ts` already implements the
two-sided baseline comparison. Model the shim gate on it — same failure semantics, same
"observed vs baselined vs new vs stale" reporting vocabulary — so an operator reading either output
reads the same shape.

**Marker in a comment, not in code.** The marker must not change runtime behavior; it is a grep
target and a review signal. A comment keeps it free of any import or helper.

**Seed it empty.** This task ships the mechanism with a manifest containing no entries (or only
entries for shims that already exist and are already known). The role-model shims are registered by
the tasks that create them — 0536 (`agent.default` legacy executor value, `--agent <binary-name>`),
0537 (spec with no executor field), 0538 (commands not yet declaring a role).

**Removal conditions must be checkable (R4).** "Remove when the binary-name form is unused" is not
checkable; "remove when `docs/` and `config/workflows/` contain no bare-binary `--agent` value" is.
An unfalsifiable condition is how a transition shim becomes permanent.

**Not in scope:** removing any existing compatibility path. This task only makes them visible and
countable.
### Plan
- [x] Define the `@transition-shim(<id>)` comment marker convention (R1)
- [x] Add `config/transition-shims.json` with the required per-entry fields (R1)
- [x] Implement the two-sided gate, modelled on `corpus-check.ts` semantics and reporting (R2)
- [x] Test that an unregistered marker fails the gate (R2)
- [x] Test that a manifest entry whose marker is gone fails the gate (R2)
- [x] Wire the gate into `bun run spur-check` alongside `corpus-check` (R3)
- [x] Document the manifest as the removal worklist and require checkable conditions (R4)
- [x] Run `bun run autofix && bun run spur-check`
### Solution
- **Marker convention + manifest (R1).** `config/transition-shims.json` — seeded empty two-sided manifest; every entry requires `id` (lowercase kebab), `wbs` (owning task), `file`, `keepsWorking`, `removalCondition` (all non-empty strings; validated by the gate). Marker convention documented in `docs/04_DESIGN.md:909`.
- **Two-sided gate (R2).** `plugins/sp/scripts/transition-shim-check.ts:176` — scans source roots `apps, packages, plugins, config, scripts, tooling` for `@transition-shim(<id>)` comment markers and reconciles against the manifest, modeled on `packages/app/src/services/corpus-check.ts` (same observed-vs-baselined vocabulary, same two-sided semantics): an unregistered marker fails as **new unregistered shim** naming id + file; a manifest entry whose marker no longer appears fails as **stale entry** (reported distinctly); incomplete entries fail naming the missing field. Build output, `docs/`, and `tests/` directories are excluded (prose examples and gate-fixture marker text are not shims).
- **Gate wiring (R3).** `package.json:78-88` — `transition-shim-check` script appended to `spur-check`, `spur-check-new`, `spur-check:full`, `spur-check-new:full`, so `bun run spur-check` exits non-zero on either violation direction with no opt-in step.
- **Removal worklist (R4).** `docs/04_DESIGN.md:909` — §2.5 documents that emptying `config/transition-shims.json` is the definition of the transition being complete, and that removal conditions must be objectively checkable against the repository (checkable example given; "when unused" explicitly rejected).
- **Tests (R2 measurable).** `plugins/sp/tests/transition-shim-check.test.ts` — 7 tests: unregistered marker fails naming id+file, stale entry fails distinctly from unregistered, both directions green for a registered marker, required-field validation (R1), lowercase-kebab id enforcement, missing-manifest degradation to strictest mode, duplicate marker ids in two files reported once naming both.
### Testing
**Re-verify 2026-08-13 (`/sp-dev-verify 0541 --auto --next --force --focus all --fix all`).** Task already `done`; `--force` re-audited. Line anchors re-read this run.

**Per-Requirement Traceability**

| Req | Status | Evidence |
| --- | --- | --- |
| R1 | MET | Manifest `config/transition-shims.json:1-4` seeds `{note, entries:[]}` and documents the five required fields. `ManifestEntry` at `plugins/sp/scripts/transition-shim-check.ts:69-76` requires `id`, `wbs`, `file`, `keepsWorking`, `removalCondition`. `validateEntry` at `plugins/sp/scripts/transition-shim-check.ts:152-174` rejects empty/missing fields and non-kebab ids. Marker convention in `docs/04_DESIGN.md:909-928`. Tests: `plugins/sp/tests/transition-shim-check.test.ts:63-84` (7/7 pass this run). |
| R2 | MET | Two-sided reconcile at `plugins/sp/scripts/transition-shim-check.ts:201-218`: unregistered marker → `new unregistered shim` naming id+file; missing marker → `stale manifest entry` naming id (distinct kind). Independent tests `plugins/sp/tests/transition-shim-check.test.ts:86-124`. Live probe this run (temp `--manifest`/`--roots`): unregistered `ghost-probe` exit 1 + `unregistered`; stale `gone-probe` exit 1 + `stale` and not `unregistered`; registered match exit 0 PASS. |
| R3 | MET | `package.json:78-88` appends `&& bun run transition-shim-check` to `spur-check`, `spur-check-new`, and both `:full` mirrors; `transition-shim-check` script is `bun plugins/sp/scripts/transition-shim-check.ts`. No opt-in flag. `&&` means a failing last step fails the chain. Live `bun run transition-shim-check` this run: `0 marker(s) observed, 0 manifest entries baselined — PASS`. |
| R4 | MET | `docs/04_DESIGN.md:938-943` states emptying `config/transition-shims.json` is the definition of transition complete, and removal conditions must be objectively checkable (checkable example given; "when unused" / human judgement rejected in review). Seeded `entries: []` so no entries to audit. |

**Acceptance Criteria Verification**

| AC | Status | Evidence Type | Evidence |
| --- | --- | --- | --- |
| Scenario: R1 — A shim marker has a manifest entry describing its removal | MET | test | `plugins/sp/tests/transition-shim-check.test.ts:63-84` — missing `removalCondition` fails naming the field; non-kebab id rejected. Gate enforces all five fields (`plugins/sp/scripts/transition-shim-check.ts:152-174`). Seeded empty by design; matching registered-marker path passes at `plugins/sp/tests/transition-shim-check.test.ts:115-124`. |
| Scenario: R2 — An unregistered marker fails the gate | MET | test | `plugins/sp/tests/transition-shim-check.test.ts:86-98` — exit 1, stderr contains `@transition-shim(ghost)`, `compat.ts`, `unregistered`. Live probe this run: `ghost-probe` → FAIL (unregistered). |
| Scenario: R3 — A stale manifest entry fails the gate | MET | test | `plugins/sp/tests/transition-shim-check.test.ts:100-113` — `stale manifest entry gone`, stdout `1 stale`, stderr does not contain `unregistered`. Live probe this run: `gone-probe` → FAIL (stale). |
| Scenario: R4 — The gate runs inside the existing quality gate | MET | command | `package.json:78` `spur-check` ends with `&& bun run transition-shim-check`. Isolated two-direction probes of that last step this run exited 1. `bun run transition-shim-check` on the clean tree exited 0 (`0 marker(s) observed, 0 manifest entries baselined — PASS`). |
| Scenario: R5 — Removal conditions are objectively checkable | MET | command | `rg`/`read` of `docs/04_DESIGN.md:939-942` this run: "must be objectively checkable against the repository" and "A condition resolvable only by human judgement is rejected in review." Seeded manifest has zero entries to audit. |

**Design conformance:** 5/5 claims DONE (model corpus-check two-sided vocabulary; marker is a comment/grep target; seed empty; checkable removal conditions documented; no existing compatibility path removed).

**Checks**

| Check | Status | Evidence |
| --- | --- | --- |
| design-conformance | pass | 5/5 Design claims DONE |
| scope-creep | pass | ADR-058 + `docs/03_ARCHITECTURE.md` §18 are constitution same-commit authority/how sync, not extra product scope |
| evidence-rule-pass | pass | Behavior-bearing AC rows have test or command evidence |
| tests-pass | pass | `bun test plugins/sp/tests/transition-shim-check.test.ts` — 7 pass, 0 fail, 23 expects (this run) |
| lint-clean | pass | `bunx biome check plugins/sp/scripts/transition-shim-check.ts plugins/sp/tests/transition-shim-check.test.ts config/transition-shims.json` — 3 files, no fixes (this run) |
| task-check | pass | `spur task check 0541 --strict-core --json` pass:true. `--fix all` flipped 12 leftover `[ ]` boxes in Requirements + Plan (L3.unchecked-checklist). |
| cli-golden-path-present | pass | N/A — no new `spur` noun/verb (ADR-051); gate is a `package.json` script |

Coverage: N/A (standalone gate script invoked via `Bun.spawnSync` / `bun run`; bun coverage does not instrument the child process). Fix-pass writes: `.spur/run/0541-verdict.json` (rewritten this run after re-evaluation); `.spur/run/0541-verify-answer.txt` (rewritten this run).

**SECUA (focus=all):** no P1–P2. Residual P3/P4 from prior review still hold and are advisory: full-tree walk ~0.5s (`plugins/sp/scripts/transition-shim-check.ts:50-65` SKIP_DIRS); incomplete entry can double-report as unregistered (`plugins/sp/scripts/transition-shim-check.ts:197-208`); `file` field is worklist metadata, not scan-validated. New P4: `MARKER_RE` (`plugins/sp/scripts/transition-shim-check.ts:43`) only matches lowercase-kebab ids, so a malformed `@transition-shim(Not_Kebab)` in source is invisible to the gate (convention + review catch it; kebab-id test covers the manifest side).
### Review
**Functional traceability** — all requirements MET:

| Req | Status | Evidence |
| --- | --- | --- |
| R1 marker + manifest, every field required | MET | `config/transition-shims.json` (seeded empty, 5 required fields); marker convention in `docs/04_DESIGN.md:909`; field validation in `plugins/sp/scripts/transition-shim-check.ts:152` (`validateEntry`) |
| R2 two-sided gate | MET | `plugins/sp/scripts/transition-shim-check.ts:201-218` — unregistered marker and stale entry both fail, reported distinctly; tests `plugins/sp/tests/transition-shim-check.test.ts` (7/7 pass) prove each direction independently |
| R3 runs in the existing quality gate | MET | `package.json:78-88` — `transition-shim-check` appended to `spur-check`, `spur-check-new`, and both `:full` mirrors; last-step probes exit 1 on both violation directions |
| R4 removal worklist doc | MET | `docs/04_DESIGN.md:938-943` — emptying `config/transition-shims.json` = transition complete; removal conditions must be objectively checkable ("when unused" explicitly rejected) |
| AC R5 checkable conditions | MET | same doc section states the rule; seeded manifest empty so no entries to audit |

**Priority findings** (no P1/P2 — nothing blocking):

| # | Severity | File | Finding |
| --- | --- | --- | --- |
| 1 | P3 | `plugins/sp/scripts/transition-shim-check.ts:50-65` | Full tree walk over 6 source roots per gate run. Measured ~0.5 s in this repo; acceptable standing cost for a standing gate, node-builtin only for plugin portability. No action. |
| 2 | P4 | `plugins/sp/scripts/transition-shim-check.ts:197-208` | An invalid entry (missing field) whose id still appears in source is also reported as unregistered, in addition to the incomplete-field violation — minor double-report noise; the actionable message is the incomplete one. Acceptable. |
| 3 | P4 | `config/transition-shims.json` | The `file` manifest field is recorded info, not validated against the scan. Intentional per design: the two-sided marker scan is the enforcement; the field is the worklist's findability aid. |
| 4 | P4 | `plugins/sp/scripts/transition-shim-check.ts:43` | `MARKER_RE` only matches lowercase-kebab ids, so a malformed `@transition-shim(Not_Kebab)` in source is invisible to the gate. Convention + review catch it; the kebab-id test covers the manifest side. |

**Architecture depth** — modeled on `packages/app/src/services/corpus-check.ts` two-sided semantics per the task Design; no new CLI noun/verb (ADR-051); scan roots and manifest path overridable via `--roots`/`--manifest` for portability and tests.

**Residual risk** — the gate is trivially green until 0536/0537/0538/0542 register shims; that is by design (seed empty). If a shim task forgets to register, its own quality gate fails with a named violation — the two-sided gate is the tripwire.
### References
- **Pattern to reuse:** `packages/app/src/services/corpus-check.ts` (two-sided baseline: unlisted
  fails *and* stale-listed fails), `config/corpus-baseline.json`, CLI wiring in
  `apps/cli/src/commands/task.ts` (`check --corpus`), tests in `apps/cli/tests/commands/task.test.ts`
- **Gate wiring target:** the `spur-check` script chain in root `package.json`;
  `plugins/sp/skills/spur-dev/references/gate-checklists.md`
- **Shims this gate will receive:** task 0536 (bare binary names), task 0542 (spec id on `--agent`,
  legacy `agent.default` executor value), task 0537 (spec with no executor field)
- **Surface docs (T3, same commit):** `docs/04_DESIGN.md`
### History
- 2026-08-14T00:18:38.280Z todo → wip (system)
- 2026-08-14T00:37:29.890Z wip → testing (system)
- 2026-08-14T00:37:39.758Z testing → done (system)
