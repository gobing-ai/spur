---
schema_version: 1
name: Flatten CLI command-depth breaches to spur <noun> <verb>
status: backlog
template: standard
created_at: 2026-11-04T05:13:54.386Z
updated_at: "2026-11-04T06:18:37.322Z"
feature_id: A35

ac_altitude: task-local
ac_numbering: task-local
priority: P2
---

## 1290. Flatten CLI command-depth breaches to spur <noun> <verb>

### Background

ADR-051's 2026-10-17 amendment (`docs/00_ADR.md:511`) makes every public command exactly
`spur <noun> <verb>`: a verb is a leaf, with no group below it and no first operand that selects
sub-operations with different argument grammars. A full walk of the live commander tree
(`buildProgram()`, 127 commands, 2026-11-03) found five breaches, and nothing enforces the rule:

| ID | Current shape | Kind | ADR status |
|---|---|---|---|
| B1 | `spur workflow commit-guard <start\|stage\|check>` | real 3-level group (`apps/cli/src/commands/workflow/commit-guard.ts:41`) | grandfathered |
| B2 | `spur agent dogfood <gate\|validate-report>` | real 3-level group (`apps/cli/src/commands/agent/dogfood.ts:28`) | grandfathered (ADR still lists a removed `contract`) |
| B3 | `spur history anatomy <digest\|check\|paths\|assert-clean\|probe\|stamp\|refresh\|publish> [argv...]` | disguised group: 8 sub-ops with distinct grammars (`apps/cli/src/commands/history/anatomy.ts:21`) | grandfathered |
| B4 | `spur builder pr <preflight\|push\|ensure\|hygiene\|request\|wait\|collect\|status> [argv...]` (hidden) | disguised group; already a deprecated shim over `pr-check`/`pr-status`/`pr-open`/`pr-review` (`apps/cli/src/commands/builder/pr.ts:168`) | **not listed** |
| B5 | `spur task batch-plan <waves\|order\|task-children>` | `task-children` takes `--letter/--plan`, the others `--tasks` (`apps/cli/src/commands/task/batch-plan.ts:11`) | **not listed** |

Out of scope (reviewed, compliant):

- Hidden top-level `spur init|maintain|migrate|serve|status`: deliberate back-compat aliases of the
  canonical `spur self <verb>` paths (operator decision, 2026-11-03). Kept.
- `spur self exec <action> [args...]`: open, config-declared named operand with one grammar
  (`npm run` shape), not a sub-verb. Kept; the ADR amendment records it as an allowed shape.
- Closed single-grammar mode operands: `task gate`, `task residual`, `task wrapup`, `task deps`,
  `task sections`. Allowed by the ADR text.

### Requirements

- [ ] R1. Flatten every breach mechanically as `<noun> <group> <sub>` → `<noun> <group>-<sub>` (and `<verb> <mode>` → `<verb>-<mode>` for the split mode), with unchanged flags, arguments, exit codes and JSON output: B1 → `workflow commit-guard-start|commit-guard-stage|commit-guard-check`; B2 → `agent dogfood-gate|dogfood-validate-report`; B3 → `history anatomy-digest|anatomy-check|anatomy-paths|anatomy-assert-clean|anatomy-probe|anatomy-stamp|anatomy-refresh|anatomy-publish`; B5 → `task batch-plan <waves|order>` plus new `task batch-plan-children`.
- [ ] R2. Delete the hidden deprecated `spur builder pr` dispatcher (B4) and its fixture/doc references; the flat `pr-check|pr-status|pr-open|pr-review` verbs remain the only PR surface.
- [ ] R3. Keep the B1/B2/B3/B5 old forms for one release as hidden shims that delegate to the new verb and print one `<old> is deprecated; use <new>` line on stderr (pattern: `apps/cli/tests/commands/builder/pr.test.ts:853`); file the removal as a follow-up task.
- [ ] R4. B1's new verbs stay boot-free: `WORKFLOW_TRANSPORT_VERBS` (`apps/cli/src/workflow-transport-argv.ts:8`) and the early dispatch serve both the new verbs and the deprecated shims.
- [ ] R5. Add a command-depth guard test that walks `buildProgram()` and fails on any non-hidden command at depth ≥ 3 and on any hidden depth-3 command not in an explicit deprecated-shim allowlist (B1/B2/B3 shims only).
- [ ] R6. Migrate every caller to the new verbs: bundled workflow YAML (`config/workflows/history-anatomy.yaml`), app-layer invocations (`packages/app/src/workflow/actions/command-gate.ts`, `packages/app/src/services/history-anatomy*.ts`, `packages/app/src/workflow/batch-plan.ts`), rules (`config/rules/**`), and test fixtures/parity cases; regenerate `apps/cli/config/` via `build:bundle`.
- [ ] R7. Update agent-facing surfaces: `plugins/sp/skills/spur-cli/references/{workflows,agent,history,builder,tasks}.md`, `plugins/sp/skills/spur-dev/references/execution-{batch,batch-report,worktree-setup,worktree-landing}.md`, `plugins/sp/skills/dogfood-testing/{SKILL.md,references/report-template.md}`, `plugins/sp/skills/history-anatomy/references/modes.md`, `plugins/sp/commands/dev-runall.md`, and their plugin parity tests.
- [ ] R8. Update docs: `docs/help/cmd_{workflow,agent,history,builder,task}.md` and `docs/help/spur-cli-matrix.md`; affected `docs/design/*` satellites (workflow-execution-foundation, environment-improvement-lens, history-cli-contracts, workflow-consolidation, workflow-execution-economy, builder-branches-and-pr-review, cli-contracts); a dated consent row in `docs/design/harness-surface-governance.md`; and an ADR-051 amendment that marks the grandfathered list migrated, drops the stale `dogfood contract`, and records `self exec`'s named operand and the top-level `self` aliases as allowed shapes.

### Acceptance Criteria

```gherkin
Scenario: AC1 — no public command sits below a verb (req: R1, R5)
Given the CLI built from this change
When the depth guard test walks `buildProgram()`
Then no non-hidden command sits at depth ≥ 3, and the only hidden depth-3 commands are the allowlisted B1/B2/B3 deprecated shims

Scenario: AC2 — flattened verbs keep their contract (req: R1, R4)
Given each existing command test for commit-guard, dogfood, history anatomy and batch-plan
When it is re-pointed at the new verb names
Then it passes unchanged in flags, exit codes and `--json` output, and `isWorkflowTransportInvocation` is true for `workflow commit-guard-start|stage|check`

Scenario: AC3 — old forms warn and delegate (req: R3)
Given `spur workflow commit-guard check`, `spur agent dogfood gate`, `spur history anatomy digest <f>` and `spur task batch-plan task-children ...`
When each runs
Then it produces the same stdout and exit code as its new verb and prints exactly one deprecation line naming the replacement on stderr

Scenario: AC4 — builder pr is gone (req: R2)
Given the CLI built from this change
When `spur builder pr preflight` runs
Then Commander rejects it as an unknown command, and `rg "builder pr "` finds no hits outside history/changelog records

Scenario: AC5 — callers and docs use only the flat verbs (req: R6, R7, R8)
Given the repository after the change
When `rg -n "commit-guard (start|stage|check)|dogfood (gate|validate-report)|history anatomy (digest|check|paths|assert-clean|probe|stamp|refresh|publish)|batch-plan task-children"` runs over `plugins/ config/ packages/ apps/ docs/help docs/design AGENTS.md`
Then the only matches are deprecation shims, their tests, and dated ADR/governance history
And `bun run spur-check`, `bun run plugin-smoke` and the help-doc parity tests pass
```

### Q&A

<!-- CLOSED decisions from refinement: what was chosen and why, what was deferred and on what
     condition. Not a parking lot for open questions — an unanswered question here means the task
     is not ready to hand off. Keep empty if none. -->

#### Q&A entry — 2026-11-04T05:13:55.863Z

- **Naming:** mechanical `<group>-<sub>` (e.g. `history anatomy-digest`) over shorter or merged names. Why: a predictable one-to-one rename keeps workflow YAML and doc diffs trivially reviewable and lets one regex find stale callers; prefixed verbs stay contiguous in `spur <noun> --help`. Merging anatomy ops (e.g. probe/stamp/refresh) is deferred; reopen only if the eight verbs prove noisy in `history --help`.
- **Back-compat:** one-release hidden deprecation shims for B1/B2/B3/B5 because installed plugins can lag the binary; B4 is deleted outright because it already completed its deprecation window and has no non-test callers.
- **Top-level `init|maintain|migrate|serve|status`:** kept as back-compat aliases of `spur self <verb>` (operator, 2026-11-03).
- **`self exec <action>`:** kept; open, config-declared named operand with one grammar.
- **Consent:** the operator requested this migration on 2026-11-03; the governance row records it.

### Design

- **Rename rule:** `<noun> <group> <sub>` → `<noun> <group>-<sub>`; split mode `<verb> <mode>` → `<verb>-<mode>`. Each new verb registers directly on the noun and calls the same app-layer function the sub-command calls today (`packages/app/src/workflow/commit-guard.ts`, `packages/app/src/services/dogfood/*-cli.ts`, `packages/app/src/services/history-anatomy-cli.ts`, `packages/app/src/workflow/batch-plan.ts`). Only transport wiring changes; no app-layer logic or output changes.
- **Shims:** the old group/operand stays registered `{ hidden: true }`, writes one deprecation line to stderr, then delegates to the new verb's handler. The depth guard's allowlist names exactly these shims so a new sub-verb still fails.
- **Boot-free transport:** `WORKFLOW_TRANSPORT_VERBS` gains `commit-guard-start|commit-guard-stage|commit-guard-check`; `commit-guard` stays in the list for the shim.
- **`batch-plan`:** `waves|order` keep the shared `--tasks [--concurrency]` grammar; `batch-plan-children` owns `--letter --plan`.
- **Invariants:** stdout/`--json` payloads, exit codes and `.spur/run/*` artifact names are byte-identical; the existing command tests are the regression oracle.
- **Impacted surfaces:** CLI (`apps/cli/src/commands/{workflow,agent,history,builder,task}`), transport argv, bundled workflows, app-layer callers, rules, the `sp` plugin skills/commands, `docs/help`, design satellites, ADR-051.

### Plan

1. Depth guard test (R5) with an initial allowlist of today's breaches; red → green as each step lands.
2. B4: delete `builder pr` dispatcher, its tests/fixture, and doc/reference lines (R2).
3. B1: add `commit-guard-*` verbs + shims; update transport verb list and early dispatch; migrate app/rule/plugin callers (R1, R3, R4, R6, R7).
4. B2: `dogfood-*` verbs + shims; migrate dogfood skill and reference docs.
5. B3: `anatomy-*` verbs + shims; migrate `config/workflows/history-anatomy.yaml`, app services, parity cases.
6. B5: `batch-plan-children` + shim; migrate `dev-runall.md` and execution-batch reference.
7. Docs (R8): `docs/help`, design satellites, governance row, ADR-051 amendment.
8. `bun link` + `build:bundle`; run `spur-check`, `plugin-smoke`, help-doc parity; file the shim-removal follow-up task.

### Solution

Delivered in two commits: `54133745c` (core flattening + shims) and `45be3fb70` (guard, docs, ADR, alias removal).

**Source (B1–B3, B5)**
- `agent dogfood <gate|validate-report>` → `agent dogfood-gate` / `agent dogfood-validate-report`; hidden shim group at `apps/cli/src/commands/agent/dogfood.ts:77` warns once on stderr.
- `workflow commit-guard <start|stage|check>` → `workflow commit-guard-*`; hidden shim group at `apps/cli/src/commands/workflow/commit-guard.ts:96`.
- `history anatomy <op>` → `history anatomy-<op>` (8 verbs, `apps/cli/src/commands/history/anatomy.ts:49`); positional shim at `:60`. `task batch-plan task-children` → `task batch-plan-children` (shim `apps/cli/src/commands/task/batch-plan.ts:44`).
- `workflow cost` given a `.summary()` (`apps/cli/src/commands/workflow/cost.ts:34`) so the help parser stops emitting bogus verbs.
- Kept by decision: hidden top-level `init|maintain|migrate|serve|status` (back-compat aliases), `self exec <action>` and `task wrapup <op>` positional args (not commands).

**B4 builder pr alias** — hidden `builder pr <op>` removed; `registerBuilderPrCommands` → `registerBuilderPrCommand` (`apps/cli/src/commands/builder/pr.ts:21`, `apps/cli/src/commands/builder.ts:173`) for `cli-register-pattern`.

**R5 regression guard** — `apps/cli/tests/cli-depth-guard.test.ts:12` walks `buildProgram()` (incl. `self`); fails on any visible depth ≥3 command and any hidden depth-3 command outside `SHIM_ALLOWLIST` (5 shims; emptied by task 1291).

**Docs/skills** — `docs/00_ADR.md:517` ADR-051 amendment (grandfathered list resolved); `docs/design/harness-surface-governance.md:226` consent row 1290; `docs/help/spur-cli-matrix.md` counts; builder docs (`cmd_builder.md`, `help2/builder.md`, `cli-contracts.md`, `builder-branches-and-pr-review.md`, `workflow-consolidation.md`, `README.md`); spur-cli references `agent.md`, `history.md`, `workflows.md`, `builder.md`; rule comments in `config/rules/{surface,boundary,strict}/*.yaml`.

**Tests updated to the flat surface** — `apps/cli/tests/commands/builder.test.ts` (eight verbs, no `pr`), `packages/app/tests/services/pr-review/pr-review.test.ts` (`builder --help` lists `pr-*`, no `pr` group), dogfood/anatomy CLI tests, gate-builtins fixture test, plugin parity/retired-ref tests, repo-wide workflow-consolidation-absence.

Frozen fixture `apps/cli/tests/fixtures/script-absorption-pr9/workflows/pr-review.yaml` intentionally untouched. Follow-up: task 1291 removes the shims.

### Testing

<!-- Filled during verification: commands run, outcomes, coverage claim or N/A. -->

### Review

<!-- Filled during review: P1-P4 findings, residual risk, and final disposition. -->

### References

- `docs/00_ADR.md:511` — ADR-051 amendment (2026-10-17): every public command is `spur <noun> <verb>`
- `docs/design/harness-surface-governance.md` — public-surface consent ledger
- `apps/cli/tests/help-doc-parity.test.ts:33` — existing `buildProgram()` tree walker to reuse
- `apps/cli/tests/commands/workflow/inline-removal.test.ts` — precedent: ADR-140 removal of `workflow inline`

### History
