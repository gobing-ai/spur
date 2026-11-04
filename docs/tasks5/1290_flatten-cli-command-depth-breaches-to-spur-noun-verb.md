---
schema_version: 1
name: Flatten CLI command-depth breaches to spur <noun> <verb>
status: done
template: standard
created_at: 2026-11-04T05:13:54.386Z
updated_at: "2026-11-04T16:42:00.370Z"
feature_id: A35

ac_altitude: task-local
ac_numbering: task-local
priority: P2
done_forced: "false"
done_reason: unforced close; PASS artifact at .spur/memory/evidence/1290-verdict.json
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

- [x] R1. Flatten every breach mechanically as `<noun> <group> <sub>` → `<noun> <group>-<sub>` (and `<verb> <mode>` → `<verb>-<mode>` for the split mode), with unchanged flags, arguments, exit codes and JSON output: B1 → `workflow commit-guard-start|commit-guard-stage|commit-guard-check`; B2 → `agent dogfood-gate|dogfood-validate-report`; B3 → `history anatomy-digest|anatomy-check|anatomy-paths|anatomy-assert-clean|anatomy-probe|anatomy-stamp|anatomy-refresh|anatomy-publish`; B5 → `task batch-plan <waves|order>` plus new `task batch-plan-children`.
- [x] R2. Delete the hidden deprecated `spur builder pr` dispatcher (B4) and its fixture/doc references; the flat `pr-check|pr-status|pr-open|pr-review` verbs remain the only PR surface.
- [x] R3. Remove the B1/B2/B3/B5 old forms outright (BREAKING, no deprecation shims, operator 2026-11-03): each old spelling exits nonzero with no stdout, and no follow-up shim-removal task is filed.
- [x] R4. B1's new verbs stay boot-free: `WORKFLOW_TRANSPORT_VERBS` (`apps/cli/src/workflow-transport-argv.ts:8`) and the early dispatch serve the new verbs; the bare `commit-guard` group is no longer a transport verb.
- [x] R5. Add a command-depth guard test that walks `buildProgram()` and fails on any command, hidden or visible, at depth ≥ 3 (no allowlist).
- [x] R6. Migrate every caller to the new verbs: bundled workflow YAML (`config/workflows/history-anatomy.yaml`), app-layer invocations (`packages/app/src/workflow/actions/command-gate.ts`, `packages/app/src/services/history-anatomy*.ts`, `packages/app/src/workflow/batch-plan.ts`), rules (`config/rules/**`), and test fixtures/parity cases; regenerate `apps/cli/config/` via `build:bundle`.
- [x] R7. Update agent-facing surfaces: `plugins/sp/skills/spur-cli/references/{workflows,agent,history,builder,tasks}.md`, `plugins/sp/skills/spur-dev/references/execution-{batch,batch-report,worktree-setup,worktree-landing}.md`, `plugins/sp/skills/dogfood-testing/{SKILL.md,references/report-template.md}`, `plugins/sp/skills/history-anatomy/references/modes.md`, `plugins/sp/commands/dev-runall.md`, and their plugin parity tests.
- [x] R8. Update docs: `docs/help/cmd_{workflow,agent,history,builder,task}.md` and `docs/help/spur-cli-matrix.md`; affected `docs/design/*` satellites (workflow-execution-foundation, environment-improvement-lens, history-cli-contracts, workflow-consolidation, workflow-execution-economy, builder-branches-and-pr-review, cli-contracts); a dated consent row in `docs/design/harness-surface-governance.md`; and an ADR-051 amendment that marks the grandfathered list migrated, drops the stale `dogfood contract`, and records `self exec`'s named operand and the top-level `self` aliases as allowed shapes.

### Acceptance Criteria

```gherkin
Scenario: AC1 — no public command sits below a verb (req: R1, R5)
Given the CLI built from this change
When the depth guard test walks `buildProgram()`
Then no command, hidden or visible, sits at depth ≥ 3

Scenario: AC2 — flattened verbs keep their contract (req: R1, R4)
Given each existing command test for commit-guard, dogfood, history anatomy and batch-plan
When it is re-pointed at the new verb names
Then it passes unchanged in flags, exit codes and `--json` output, and `isWorkflowTransportInvocation` is true for `workflow commit-guard-start|stage|check`

Scenario: AC3 — old forms are removed (req: R3)
Given `spur workflow commit-guard check`, `spur agent dogfood gate`, `spur history anatomy digest <f>` and `spur task batch-plan task-children ...`
When each runs
Then it exits nonzero, prints nothing on stdout, and performs no side effect

Scenario: AC4 — builder pr is gone (req: R2)
Given the CLI built from this change
When `spur builder pr preflight` runs
Then Commander rejects it as an unknown command, and `rg "builder pr "` finds no hits outside history/changelog records

Scenario: AC5 — callers and docs use only the flat verbs (req: R6, R7, R8)
Given the repository after the change
When `rg -n "commit-guard (start|stage|check)|dogfood (gate|validate-report)|history anatomy (digest|check|paths|assert-clean|probe|stamp|refresh|publish)|batch-plan task-children"` runs over `plugins/ config/ packages/ apps/ docs/help docs/design AGENTS.md`
Then the only matches are removal tests and dated ADR/governance history
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

#### Q&A entry — 2026-11-04T07:11:57.059Z

<!-- CLOSED decisions from refinement: what was chosen and why, what was deferred and on what
     condition. Not a parking lot for open questions — an unanswered question here means the task
     is not ready to hand off. Keep empty if none. -->

#### Q&A entry — 2026-11-04T05:13:55.863Z

- **Naming:** mechanical `<group>-<sub>` (e.g. `history anatomy-digest`) over shorter or merged names. Why: a predictable one-to-one rename keeps workflow YAML and doc diffs trivially reviewable and lets one regex find stale callers; prefixed verbs stay contiguous in `spur <noun> --help`. Merging anatomy ops (e.g. probe/stamp/refresh) is deferred; reopen only if the eight verbs prove noisy in `history --help`.
- **Back-compat:** none. B1/B2/B3/B5 old spellings are removed outright alongside B4 (operator, 2026-11-03: no follow-up task 1291). Bundled plugin, workflows and rules call only the flat verbs; installed plugin copies older than this binary must be re-synced via `superskill install sp`.
- **Top-level `init|maintain|migrate|serve|status`:** kept as back-compat aliases of `spur self <verb>` (operator, 2026-11-03).
- **`self exec <action>`:** kept; open, config-declared named operand with one grammar.
- **Consent:** the operator requested this migration on 2026-11-03; the governance row records it.

### Design

- **Rename rule:** `<noun> <group> <sub>` → `<noun> <group>-<sub>`; split mode `<verb> <mode>` → `<verb>-<mode>`. Each new verb registers directly on the noun and calls the same app-layer function the sub-command calls today (`packages/app/src/workflow/commit-guard.ts`, `packages/app/src/services/dogfood/*-cli.ts`, `packages/app/src/services/history-anatomy-cli.ts`, `packages/app/src/workflow/batch-plan.ts`). Only transport wiring changes; no app-layer logic or output changes.
- **No shims:** the old groups/operand are unregistered; Commander rejects them as unknown commands, and `batch-plan` rejects any mode other than `waves|order` with its usage line (exit 2). The depth guard has no allowlist.
- **Boot-free transport:** `WORKFLOW_TRANSPORT_VERBS` gains `commit-guard-start|commit-guard-stage|commit-guard-check`; the bare `commit-guard` entry is dropped.
- **`batch-plan`:** `waves|order` keep the shared `--tasks [--concurrency]` grammar; `batch-plan-children` owns `--letter --plan`.
- **Invariants:** stdout/`--json` payloads, exit codes and `.spur/run/*` artifact names are byte-identical; the existing command tests are the regression oracle.
- **Impacted surfaces:** CLI (`apps/cli/src/commands/{workflow,agent,history,builder,task}`), transport argv, bundled workflows, app-layer callers, rules, the `sp` plugin skills/commands, `docs/help`, design satellites, ADR-051.

### Plan

1. Depth guard test (R5); red → green as each step lands.
2. B4: delete `builder pr` dispatcher, its tests/fixture, and doc/reference lines (R2).
3. B1: add `commit-guard-*` verbs; update transport verb list and early dispatch; migrate app/rule/plugin callers (R1, R3, R4, R6, R7).
4. B2: `dogfood-*` verbs; migrate dogfood skill and reference docs.
5. B3: `anatomy-*` verbs; migrate `config/workflows/history-anatomy.yaml`, app services, parity cases.
6. B5: `batch-plan-children`; migrate `dev-runall.md` and execution-batch reference.
7. Docs (R8): `docs/help`, design satellites, governance row, ADR-051 amendment.
8. `bun link` + `build:bundle`; run `spur-check`, `plugin-smoke`, help-doc parity.

### Solution

Delivered in `54133745c` (core flattening), `45be3fb70` (guard, docs, ADR, alias removal), `13595ecd7` (stale nested-verb wording), `67390886c` (shim removal that absorbed former task 1291, deleted per operator 2026-11-03), `316e96480` (last stale test callers) and a final help-doc table fix (`docs/help/cmd_{agent,history,task}.md`, `docs/help2/{agent,history,task,workflow}.md`).

**Source (B1–B3, B5)** — old spellings removed outright (BREAKING, no shims)
- `agent dogfood <gate|validate-report>` → `agent dogfood-gate` / `agent dogfood-validate-report` registered directly (`apps/cli/src/commands/agent/dogfood.ts:28`).
- `workflow commit-guard <start|stage|check>` → `workflow commit-guard-*` (`apps/cli/src/commands/workflow/commit-guard.ts:44`); bare `commit-guard` dropped from `WORKFLOW_TRANSPORT_VERBS` (`apps/cli/src/workflow-transport-argv.ts:9`).
- `history anatomy <op>` → `history anatomy-<op>` (8 verbs, `apps/cli/src/commands/history/anatomy.ts`); the positional group is gone.
- `task batch-plan task-children` → `task batch-plan-children`; `batch-plan` now rejects any mode but `waves|order` with its usage line, exit 2 (`apps/cli/src/commands/task/batch-plan.ts:39-52`).
- `workflow cost` given a `.summary()` (`apps/cli/src/commands/workflow/cost.ts:34`) so the help parser stops emitting bogus verbs.
- Kept by decision: hidden top-level `init|maintain|migrate|serve|status` (back-compat aliases), `self exec <action>` and `task wrapup <op>` positional args (not commands).

**B4 builder pr alias** — hidden `builder pr <op>` removed; `registerBuilderPrCommands` → `registerBuilderPrCommand` (`apps/cli/src/commands/builder/pr.ts:21`, `apps/cli/src/commands/builder.ts:173`). The app-layer spine help/doc comments describe the internal op spine, not a CLI group (`packages/app/src/services/pr-review/index.ts:203`).

**R5 regression guard** — `apps/cli/tests/cli-depth-guard.test.ts:7-9` walks `buildProgram()` (incl. `self`) and fails on any command, hidden or visible, at depth ≥3; no allowlist. `apps/cli/tests/help-doc-parity.test.ts` back to the plain walk (no hidden filters).

**Removal tests (R3)** — `apps/cli/tests/commands/agent/dogfood.test.ts:96`, `apps/cli/tests/commands/workflow/commit-guard.test.ts:97` (also asserts no tree-start snapshot), `apps/cli/tests/commands/history/anatomy.test.ts:35`, `apps/cli/tests/commands/task/batch-plan.test.ts:51`; transport argv expectations in `apps/cli/tests/workflow-transport-argv.test.ts`.

**Docs/skills** — `docs/00_ADR.md:517` ADR-051 amendment (old spellings removed, no shims; top-level aliases allowed); `docs/design/harness-surface-governance.md:226` consent row 1290 (BREAKING, rejected-shape now one-release shims); `docs/help/spur-cli-matrix.md:139`, `docs/help/cmd_{history,workflow,task,builder}.md`, `docs/design/cli-contracts.md:49`; spur-cli references `agent.md`, `history.md`, `workflows.md`, `builder.md`; rule comments in `config/rules/{surface,boundary,strict}/*.yaml`; feature A35 Scope/AC updated via `spur feature update`.

Frozen fixture `apps/cli/tests/fixtures/script-absorption-pr9/workflows/pr-review.yaml` intentionally untouched.

### Testing

**Pipeline verify results**

- Verdict: PASS (from verdict artifact)

| Requirement | Status | Evidence |
|-------------|--------|----------|
| R1 | MET | `apps/cli/src/commands/workflow/commit-guard.ts:43-80`, `apps/cli/src/commands/agent/dogfood.ts:26-64`, `apps/cli/src/commands/history/anatomy.ts:49-57`, `apps/cli/src/commands/task/batch-plan.ts:25-63`; focused suite 48 pass / 0 fail this run |
| R2 | MET | `apps/cli/tests/commands/builder/pr.test.ts:53-56` asserts unknown command 'pr'; probe exit 1 |
| R3 | MET | `apps/cli/tests/commands/workflow/commit-guard.test.ts:97-107`, `apps/cli/tests/commands/agent/dogfood.test.ts:96-100`, `apps/cli/tests/commands/history/anatomy.test.ts:35-39`, `apps/cli/tests/commands/task/batch-plan.test.ts:50-58`; former task 1291 deleted |
| R4 | MET | `apps/cli/src/workflow-transport-argv.ts:8-14`; `apps/cli/tests/workflow-transport-argv.test.ts:17-26` |
| R5 | MET | `apps/cli/tests/cli-depth-guard.test.ts:17-35` (hidden included, no allowlist) |
| R6 | MET | `config/workflows/history-anatomy.yaml:115`; `packages/app/src/workflow/actions/command-gate.ts:18`; bundled `apps/cli/config/workflows/history-anatomy.yaml` regenerated |
| R7 | MET | `plugins/sp/commands/dev-runall.md:105`, `plugins/sp/skills/spur-dev/references/execution-batch.md:314`, `plugins/sp/skills/dogfood-testing/SKILL.md:85`, `plugins/sp/skills/spur-cli/references/tasks.md:52-53` |
| R8 | MET | `docs/00_ADR.md:517-525`, `docs/design/harness-surface-governance.md:226`, `docs/help/cmd_agent.md:19`, `docs/help/cmd_history.md:16`, `docs/help/cmd_task.md:21-22`, `docs/help/spur-cli-matrix.md:139` |

| Acceptance Criteria | Status | Evidence Type | Evidence |
|---------------------|--------|---------------|----------|
| AC1 — no public command sits below a verb (req: R1, R5) | MET | test | `apps/cli/tests/cli-depth-guard.test.ts:33-35` passes this run |
| AC2 — flattened verbs keep their contract (req: R1, R4) | MET | test | `apps/cli/tests/commands/agent/dogfood.test.ts:88-90`, `apps/cli/tests/commands/history/anatomy.test.ts:27-29`, `apps/cli/tests/commands/task/batch-plan.test.ts:40-47`, `apps/cli/tests/workflow-transport-argv.test.ts:17-23`; 48 pass / 0 fail |
| AC3 — old forms are removed (req: R3) | MET | test | removal tests above, plus a probe of the four old forms: all nonzero, empty stdout under `--no-logo`, no tree-start snapshot written |
| AC4 — builder pr is gone (req: R2) | MET | test | `apps/cli/tests/commands/builder/pr.test.ts:53-56`; the remaining `rg "builder pr "` hits are history/plan/report records, removal headings (`docs/help/cmd_builder.md:171`) and the exempted pr9 fixture |
| AC5 — callers and docs use only the flat verbs (req: R6, R7, R8) | MET | test | The AC5 regex (with `docs/help2` added) finds only the removal record `docs/help/spur-cli-matrix.md:139`, the removal test `apps/cli/tests/commands/task/batch-plan.test.ts:50` and unrelated prose in `packages/app/tests/services/feature-check.test.ts:1790`. help-docs-parity passes 3/0 this run. The operator's `spur self exec check` gate passed at the 316e96480 tree (code-identical to HEAD). The coordinator reports `plugin-smoke` was not re-run this round |
- Coverage: N/A (verdict-based; verify pipeline does not measure code coverage)

### Review

#### Review Report — 1290 (round 2)
**Scope:** commits 54133745c, 45be3fb70, 13595ecd7, 67390886c, 316e96480, 7a172e857 (union of `(1290)`-tagged diff-trees; task file excluded). 7a172e857 touches only `docs/` and the task corpus (`git diff 316e96480 HEAD --name-only` lists no path outside `docs/`).
**Dimensions:** functional, security, efficiency, correctness, usability, architecture
**Gate receipt:** `.spur/run/1290-test-gate.log` reuses the full-tier PASS for tree 881ec98de5de (316e96480). HEAD 7a172e857 has tree 974a4c886510, which differs from that tree only in docs. This run re-ran the gates those docs feed and both passed: `plugins/sp/tests/help-docs-parity.test.ts` (3 pass / 0 fail) and the apps/cli focused suite including `apps/cli/tests/help-doc-parity.test.ts` (48 pass / 0 fail). If the done gate requires a receipt matching the HEAD tree, the operator must re-run `spur task gate 1290 run`. This review does not fail on it.
Confidence: MEDIUM

##### Findings (ranked)

| # | Priority | Dimension | Finding | Location | Disposition |
|---|----------|-----------|---------|----------|-------------|
| 1 | P3 (minor) | usability | Round 1: the verb-summary tables in both help trees still listed the removed nested groups, and help2/workflow claimed the commit-guard shim was still a hidden alias. Fixed: `docs/help/cmd_agent.md:19` and `docs/help2/agent.md:16` now list `dogfood-gate` / `dogfood-validate-report`. `docs/help/cmd_history.md:16` and `docs/help2/history.md:15` list `anatomy-<op>`. `docs/help/cmd_task.md:21-22` and `docs/help2/task.md:19-20` gained a `batch-plan-children` row. The help2 heading at `docs/help2/agent.md:183` now names the flat verbs, and `docs/help2/workflow.md:25` and `:230-231` say the nested spelling was removed. A re-sweep for bare-group cells finds only removal records | `docs/help2/workflow.md:230` | RESOLVED (fixed in 7a172e857) |
| 2 | P3 (minor) | functional | Round 1: the ADR-051 amendment said the guard covers only visible commands. Fixed: it now reads "fails on any command, hidden or visible, at depth 3 or more", which matches `apps/cli/tests/cli-depth-guard.test.ts:21-35` | `docs/00_ADR.md:525` | RESOLVED (fixed in 7a172e857) |
| 3 | P4 (advisory) | correctness | Without `--no-logo`, an old spelling still prints the global ASCII banner on stdout before the Commander error. The banner comes from the entry point and predates this task. The command layer itself writes nothing to stdout, as the removal tests assert | `apps/cli/tests/commands/history/anatomy.test.ts:35-39` | ACCEPTED |
| 4 | P4 (advisory) | correctness | Old-flag `task batch-plan task-children --letter A --plan p.json` exits 1 because Commander rejects `--letter` first. Bare `task-children` exits 2 with the usage line. Both are nonzero with empty stdout, so AC3 holds | `apps/cli/src/commands/task/batch-plan.ts:39-44` | ACCEPTED |
| 5 | P4 (advisory) | architecture | Each new verb is a thin registration over the unchanged app-layer function. The transport list is flat (`apps/cli/src/workflow-transport-argv.ts:8-14`) and run ids are still validated (`apps/cli/src/commands/workflow/commit-guard.ts:39`). No security or efficiency surface was added. The Solution now lists every commit | `apps/cli/src/commands/history/anatomy.ts:49-57` | ACCEPTED |

##### Functional Traceability

| Req | Status | Evidence |
| --- | --- | --- |
| R1 | MET | `apps/cli/src/commands/workflow/commit-guard.ts:43-80`, `apps/cli/src/commands/agent/dogfood.ts:26-64`, `apps/cli/src/commands/history/anatomy.ts:49-57`, `apps/cli/src/commands/task/batch-plan.ts:25-63`; focused suite 48 pass / 0 fail this run |
| R2 | MET | `apps/cli/tests/commands/builder/pr.test.ts:53-56` asserts unknown command 'pr'; probe exit 1 |
| R3 | MET | `apps/cli/tests/commands/workflow/commit-guard.test.ts:97-107`, `apps/cli/tests/commands/agent/dogfood.test.ts:96-100`, `apps/cli/tests/commands/history/anatomy.test.ts:35-39`, `apps/cli/tests/commands/task/batch-plan.test.ts:50-58`; former task 1291 deleted |
| R4 | MET | `apps/cli/src/workflow-transport-argv.ts:8-14`; `apps/cli/tests/workflow-transport-argv.test.ts:17-26` |
| R5 | MET | `apps/cli/tests/cli-depth-guard.test.ts:17-35` (hidden included, no allowlist) |
| R6 | MET | `config/workflows/history-anatomy.yaml:115`; `packages/app/src/workflow/actions/command-gate.ts:18`; bundled `apps/cli/config/workflows/history-anatomy.yaml` regenerated |
| R7 | MET | `plugins/sp/commands/dev-runall.md:105`, `plugins/sp/skills/spur-dev/references/execution-batch.md:314`, `plugins/sp/skills/dogfood-testing/SKILL.md:85`, `plugins/sp/skills/spur-cli/references/tasks.md:52-53` |
| R8 | MET | `docs/00_ADR.md:517-525`, `docs/design/harness-surface-governance.md:226`, `docs/help/cmd_agent.md:19`, `docs/help/cmd_history.md:16`, `docs/help/cmd_task.md:21-22`, `docs/help/spur-cli-matrix.md:139` |

| AC | Status | Evidence Type | Evidence |
| --- | --- | --- | --- |
| AC1 — no public command sits below a verb | MET | test | `apps/cli/tests/cli-depth-guard.test.ts:33-35` passes this run |
| AC2 — flattened verbs keep their contract | MET | test | `apps/cli/tests/commands/agent/dogfood.test.ts:88-90`, `apps/cli/tests/commands/history/anatomy.test.ts:27-29`, `apps/cli/tests/commands/task/batch-plan.test.ts:40-47`, `apps/cli/tests/workflow-transport-argv.test.ts:17-23`; 48 pass / 0 fail |
| AC3 — old forms are removed | MET | test+command | removal tests above, plus a probe of the four old forms: all nonzero, empty stdout under `--no-logo`, no tree-start snapshot written |
| AC4 — builder pr is gone | MET | test+command | `apps/cli/tests/commands/builder/pr.test.ts:53-56`; the remaining `rg "builder pr "` hits are history/plan/report records, removal headings (`docs/help/cmd_builder.md:171`) and the exempted pr9 fixture |
| AC5 — callers and docs use only the flat verbs | MET | command+test | The AC5 regex (with `docs/help2` added) finds only the removal record `docs/help/spur-cli-matrix.md:139`, the removal test `apps/cli/tests/commands/task/batch-plan.test.ts:50` and unrelated prose in `packages/app/tests/services/feature-check.test.ts:1790`. help-docs-parity passes 3/0 this run. The operator's `spur self exec check` gate passed at the 316e96480 tree (code-identical to HEAD). The coordinator reports `plugin-smoke` was not re-run this round |

**Next:** if the done gate needs a receipt matching the HEAD tree, re-run `spur task gate 1290 run` on 7a172e857. No other action is needed.

Verdict: PASS

### References

- `docs/00_ADR.md:511` — ADR-051 amendment (2026-10-17): every public command is `spur <noun> <verb>`
- `docs/design/harness-surface-governance.md` — public-surface consent ledger
- `apps/cli/tests/help-doc-parity.test.ts:33` — existing `buildProgram()` tree walker to reuse
- `apps/cli/tests/commands/workflow/inline-removal.test.ts` — precedent: ADR-140 removal of `workflow inline`

### History

- 2026-11-04T06:21:27.716Z backlog → wip (system)
- 2026-11-04T16:40:08.011Z wip → testing (system)
- 2026-11-04T16:42:00.357Z testing → done (system)

