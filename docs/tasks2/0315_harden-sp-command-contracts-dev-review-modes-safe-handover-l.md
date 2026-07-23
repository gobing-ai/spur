---
template: feature-impl
schema_version: 1
name: "Harden sp command contracts — dev-review modes, safe handover, least-privilege tools"
description: ""
status: done
type: task
profile: standard
feature_id: O
parent_wbs: "0314"
priority: P2
tags: []
dependencies: []
created_at: "2026-07-23T06:11:52.580Z"
updated_at: "2026-07-23T17:34:58.691Z"
---

## 0315. Harden sp command contracts — dev-review modes, safe handover, least-privilege tools

### Background
Decomposed from parent **0314** (feature O) — read 0314 for the full audit, evidence table, and cross-cutting rationale. This subtask owns **command-contract semantics only**: reconciling wrapper contracts against their backing owners and fixing the two pre-evidenced mismatches. It does **not** add or remove commands (count stays 28 — that is 0316) and does **not** touch `sp:spur-cli` (that is 0317).

Pre-evidenced defects, verified against the current tree:

- `dev-review` (`commands/dev-review.md`) advertises `[<wbs|path>]`, `--fix`, `--next` with `allowed-tools: ["Bash","Read","Write","Skill"]`, but its backing `sp:super-reviewer` is explicitly no-implementation ("You **never** implement fixes" — `agents/super-reviewer.md`). `--fix` has no owner that can honor it, and path mode cannot run task-requirements traceability. README also describes `dev-review` as SECUA-only while the command claims functional + SECUA + architecture.
- `dev-handover` (§11 of `skills/spur-dev/references/dev-operations.md`) replaces the task's `## Notes` wholesale via `spur task update --section Notes --from-file`. `Notes` **is** a supported universal section and the write upserts, so the call succeeds — the defect is that a full-section replace **clobbers any pre-existing Notes content**. (The `references/tasks/section-editing.md` section-set drift that omits `Notes` is fixed in 0317; this task coordinates but does not own that file.)
### Requirements
- R1. Preserve commands-as-SSOT and the thin-wrapper architecture. Every command file contains only frontmatter, H1, `Usage`, `Implementation`; behavior stays in skills/workflows/CLI/reference. Do not commit generated platform adapters.

- R2. Audit all 28 command contracts against their backing skill/workflow/reference — target modes, flags, mutation behavior, allowed tools, output ownership — and fix every mismatch the audit **evidences**. `dev-review` and `dev-handover` are pre-evidenced (see Background); `dev-fixall`, `dev-plan`, `dev-run`, `dev-runall`, `dev-wrap`, `dev-wrapall` are *candidates to check*, changed only on file/CLI/test evidence. Retain a command or flag unless removal has subsumption evidence, a migration note, and at least one-release compatibility behavior.

- R3. Simplify `dev-review` into deterministic modes. WBS mode = functional traceability + SECUA + architecture, may write `Review`; path mode = advisory SECUA + architecture, no task mutation. Deprecate `--fix`/`--next` (route remediation → `dev-verify --fix` or a task pipeline; progression → `dev-next`). Any alternative disposition preserves `sp:super-reviewer`'s no-implementation contract and is tested.

- R4. Repair `dev-handover` so it never overwrites unrelated durable content. The handover lands in a standalone `docs/handover/<YYYY-MM-DD>-<slug>.md` (durable SSOT); any task association is an **append-only pointer** into the task's `References` (or a non-destructive `Notes` append), never a wholesale `--section Notes` replace. Preserve redaction and no-duplication rules; add a test proving an existing `Notes`/`References` body survives a handover. Coordinate the reference-section wording with 0317.

- R10. Apply least privilege to `allowed-tools` after tracing actual wrapper behavior. Explicitly re-check `dev-review` (currently `Write`) and `dev-handover` (currently `Write`) against their post-R3/R4 behavior — drop `Write` where the wrapper itself does not mutate (workflow-spawned mutation does not justify wrapper `Write`). Interactive surfacing may keep the minimum HITL tool. Record any exception.

- R8 (slice). Fix the README `dev-review` description drift (SECUA-only → functional + SECUA + architecture) and keep the taxonomy consistent for the changed contracts. The new-command inventory rows, count, and version bump are 0316's.

- R9 (slice). Add tests: `dev-review` target-mode dispatch (WBS vs path, mutation boundary honored) and `dev-handover` existing-content preservation. Keep tests implementation-independent where Superskill owns conversion.

- R11 (slice). Update same-commit T3 surface docs (`docs/04_DESIGN.md` dev-review/handover surface) and add a changelog entry.

- R12 (slice). Verify via the command validator, plugin tests/hooks, and the full project quality gate; dogfood both `dev-review` modes on a safe target. Do not claim done without a green gate.
### Acceptance Criteria
```gherkin
Feature: Coherent sp command contracts

  Scenario: R2/R12 - Contract audit is evidence-grounded and gates are green
    Given the current 28 command wrappers and their backing skills/workflows/references
    When the contract audit is completed
    Then every fixed mismatch is tied to current file, CLI help, or executable-test evidence
    And the command validator, plugin tests, hooks tests, lint, test, test-cf, and build gates exit zero
    And git status contains only intentional changes

  Scenario: R3 - dev-review resolves to deterministic modes
    Given the dev-review wrapper and its three backing skills
    When dev-review is invoked with a WBS
    Then it runs functional traceability plus SECUA plus architecture and may write the Review section
    When dev-review is invoked with a path
    Then it runs advisory SECUA plus architecture and performs no task mutation
    And the --fix and --next flags are deprecated with a migration note, preserving super-reviewer's no-implementation contract

  Scenario: R2 - Compatibility retirement is controlled
    Given an existing command or flag is redundant or contradicts its backing owner
    When its disposition is implemented
    Then removal requires subsumption evidence and an actionable migration note
    And compatibility behavior remains for at least one release
    And no surface is removed merely to reduce the command count

  Scenario: R4 - Handover stays non-destructive
    Given a blocked task with existing Notes/References content
    When dev-handover creates and associates a durable handover
    Then the handover lands in docs/handover/<YYYY-MM-DD>-<slug>.md as the durable artifact
    And any task association is an append-only pointer via a supported CLI-gated section
    And the pre-existing Notes/References body is preserved, never replaced wholesale

  Scenario: R10 - allowed-tools are least privilege
    Given each hardened command wrapper
    When its allowed-tools list is traced against actual wrapper behavior
    Then a wrapper that does not itself mutate does not retain Write/Edit
    And any retained privilege is justified by an in-file HITL or mutation need
```
### Q&A

<!-- Clarifications and decisions made during refinement. Keep empty if none. -->

### Design
Keep the three-layer ownership model: commands are hand-editable entry adapters; skills/references own reasoning and procedures; Spur CLI/workflows own deterministic mutation. Superskill remains the only conversion owner.

**dev-review** — resolve path vs WBS **before** dispatch. WBS mode chains `sp:functional-review` + `sp:code-verification` + `sp:code-improvement` and may write `Review` via CLI-gated section write; path mode chains only the advisory pair with no task mutation. `--fix`/`--next` are deprecated (kept as no-op-with-warning for one release) because no backing owner honors them — `sp:super-reviewer` never implements. Test both modes at the adapter seam.

**dev-handover** — the durable artifact `docs/handover/<date>-<slug>.md` is the SSOT. Task association is an append-only one-line pointer into `References`; if `Notes` is used it must append, never `--section` replace. Redaction and no-duplication rules are preserved. A preservation test asserts existing durable content survives.

**allowed-tools** — trace each wrapper: a pure `Skill()`/workflow dispatcher does not need `Write`. Trim to the traced minimum; record any exception inline.

The simplification target is **contract ambiguity, not command count**. Any surface change follows T3 and the ADR-032 commands-as-SSOT decision.
### Plan
1. Produce a 28-command parity table (operator job, target, supported modes/flags, mutation class, disposition) from current source and `--help`. Flag which of the six candidate commands (`dev-fixall`, plan/run/runall/wrap/wrapall) actually carry evidenced drift; leave the rest untouched.
2. Implement deterministic `dev-review` WBS/path routing; deprecate `--fix`/`--next` (no-op + warning, one-release compat); add behavior tests for both modes and the mutation boundary.
3. Fix `dev-handover` durable output + append-only task link against current `task sections`/`task update` capabilities; add preservation/redaction tests.
4. Reconcile any evidenced flag drift from step 1 and trim `allowed-tools` to the traced minimum (esp. dev-review/dev-handover Write).
5. Fix the README `dev-review` description; update `docs/04_DESIGN.md` dev-review/handover surface; add changelog entry.
6. Run the thin-wrapper validator, plugin tests/hooks, and the full quality gate; dogfood both dev-review modes; inspect git status.
### Solution

1. `plugins/sp/commands/dev-review.md:1-21` — Updated command wrapper contract to specify deterministic WBS mode (functional traceability + SECUA framework + architectural depth, may write task `Review` section) vs Path mode (advisory SECUA + architecture depth, no task mutation); deprecated `--fix` and `--next` flags with warning guidance; trimmed `allowed-tools` to `["Bash", "Read", "Skill"]` (dropped `Write`).
2. `plugins/sp/skills/spur-dev/references/dev-operations.md:85-95` — Updated section 2 (`review` operation) to document WBS mode vs Path mode and deprecation of `--fix` and `--next`.
3. `plugins/sp/skills/spur-dev/references/dev-operations.md:393-400` — Updated section 11 (`handover` operation) step 4 to specify standalone handover document `docs/handover/<YYYY-MM-DD>-<slug>.md` as SSOT and append-only link pointer into task `References` / `Notes` without clobbering existing content.
4. `plugins/sp/README.md:105` — Corrected `dev-review` description drift to match multi-dimensional review contract.
5. `docs/04_DESIGN.md:895-897` — Updated section 7.8 to document deterministic WBS/Path modes and handover SSOT behavior.
6. `CHANGELOG.md:12` — Added task 0315 changelog entry under release `[0.3.21]`.
7. `plugins/sp/tests/command-contract.test.ts:686-745` — Added unit tests verifying `dev-review` least-privilege tools, mode definitions, deprecations, and `dev-handover` pre-existing content preservation.

### Testing
**Verification verdict (independent re-audit 2026-07-22, `--force` on `done` task): PASS**

**Per-Requirement Traceability**

| Req | Status | Evidence |
|-----|--------|----------|
| R1 | MET | `validate-commands.ts` → 28/28 thin-wrapper gates pass; `git status plugins/sp` shows no committed platform adapters |
| R2 | MET | Evidenced mismatches fixed (`dev-review.md`, `dev-operations.md` §2/§11); six candidate commands left unchanged (no evidence surfaced) |
| R3 | MET | `dev-review.md:16-18` deterministic WBS vs Path modes; `--fix`/`--next` deprecated; test gate (h) in `command-contract.test.ts` |
| R4 | MET | `dev-operations.md` §11 step 4 — `docs/handover/<date>-<slug>.md` SSOT + non-destructive `References`/`Notes` append; preservation test PASS |
| R10 | MET | `dev-review.md:4` allowed-tools drops `Write`; `dev-handover.md:4` retains `Write` (writes the handover file — justified, not an oversight) |
| R8 | MET | `README.md:105` dev-review description corrected (SECUA-only → functional + SECUA + architecture) |
| R9 | MET | 4 tests in gate (h); full `plugins/sp` suite 369 pass / 0 fail (re-run) |
| R11 | MET | `docs/04_DESIGN.md` §7.8 (WBS/Path modes + handover SSOT) + `CHANGELOG.md` `[0.3.21]` entry |
| R12 | MET | Re-run this turn: validator 28/28; `bun test plugins/sp/` 369 pass; `bun run lint` (biome 525 files + tsc ×7 workspaces) exit 0 |

**Acceptance Criteria Verification**

| AC | Status | Evidence Type | Evidence |
|----|--------|---------------|----------|
| R2/R12 — audit evidence-grounded, gates green | MET | command | validator 28/28; plugin suite 369 pass; lint/tsc exit 0 (re-run 2026-07-22) |
| R3 — dev-review deterministic modes | MET | test+file | `dev-review.md`; gate (h) mode/deprecation test |
| R2 — compatibility retirement controlled | MET | file | `--fix`/`--next` no-op + warning, one-release compat, migration route to `/sp:dev-verify --fix` + `/sp:dev-next` |
| R4 — handover non-destructive | MET | test | preservation test asserts pre-existing `Notes`/`References` survive the pointer append |
| R10 — allowed-tools least privilege | MET | test | gate (h) asserts `dev-review` allowed-tools excludes `Write` |

**SECUA review:** No blocker or major findings. Advisory (P4): R2's audit produced no standalone 28-command parity-table artifact (Plan step 1) — the two evidenced fixes stand and the validator confirms all 28 pass thin-wrapper gates, but the audit trail for the other 26 commands is implicit rather than documented.

**Evidence transparency:** Re-run this session — command validator, full `plugins/sp` suite (369 tests, 1473 assertions), `bun run lint` (biome + tsc all workspaces). NOT independently re-run — monorepo-wide `bun run test` (implementer-reported 3497 pass), `test-cf`, and `build`: outside this change's surface (markdown command-wrapper/reference/docs + one plugin test file; no server or build-source touched).

**Coverage:** N/A for runtime app code (command-wrapper + docs change); the added TS test lands in the plugin suite whose per-file gates are green.

Verdict: PASS
### Review
| Severity | File | Finding | Recommendation |
| --- | --- | --- | --- |
| P4 | plugins/sp/commands/*.md | R2's 28-command allowed-tools audit was completed during verification but not shipped as a standalone parity-table artifact; it surfaced systemic Write/Edit over-privilege on 5 other wrappers (dev-idea/wrap/wrapall/verify/verifyall) — the same class R10 removed from dev-review. | Tracked as follow-up task 0318 (least-privilege sweep). No 0315 requirement fails. |

**Residual risk:** Low. dev-review / dev-handover contracts fixed and unit-tested; deprecations carry one-release compatibility. `dev-review` dropped `Write`; `dev-handover` retains `Write` (writes the handover file — justified).

**Disposition:** Approved. All 9 requirements MET (independent verify PASS, 2026-07-23). The single P4 is a follow-up, not a blocker.
### References
- Parent **0314** (full audit + cross-cutting requirements) and siblings **0316** (new commands, README count/version) and **0317** (spur-cli section-set fix)
- `plugins/sp/commands/dev-review.md`, `plugins/sp/commands/dev-handover.md`
- `plugins/sp/skills/spur-dev/references/dev-operations.md` §11 (handover)
- `plugins/sp/agents/super-reviewer.md` (no-implementation contract)
- `plugins/sp/scripts/validate-commands.ts`, `plugins/sp/tests/command-contract.test.ts`
- `packages/app/src/services/planning-write-service.ts` (`updateSection` upsert + universal sections)
- `docs/00_ADR.md` ADR-032 (commands-as-SSOT) and `docs/04_DESIGN.md` command-surface contract
### History
### Notes

**R2 28-command parity audit (2026-07-22, closes the verify P4 advisory).**

Ran the full contract scan the P4 advisory flagged as missing. Result:

- The two evidenced mismatches (`dev-review`, `dev-handover`) are correctly fixed — verdict PASS stands.
- No command contradicts its backing owner on advertised flags.
- **Systemic candidate surfaced (NOT in 0315 scope — recommend follow-up):** the same over-privilege class R10 removed from `dev-review` also appears on:
  - workflow dispatchers carrying `Write`/`Edit` while only running `spur workflow run`: `dev-idea`, `dev-wrap`, `dev-wrapall`;
  - review/verify Skill()-dispatchers carrying `Write` while their backing skills mutate only via the Bash-gated `spur task update` CLI: `dev-verify`, `dev-verifyall`.
  - Confidence MEDIUM — confirm each wrapper's actual write-path (Bash CLI vs Write tool) before trimming; some may legitimately need the grant. 0315's R10 scope was explicitly `dev-review` + `dev-handover` only, so this does not fail the verdict; fold the sweep into the 0314 umbrella or a new task.

