---
kind: plan
title: Script placement migration and pipeline check diet (A9)
status: draft
created_at: 2026-09-28
updated_at: 2026-09-28
related: [A9, ADR-130, ADR-051, ADR-065, ADR-115, ADR-129]
tags: [plugin, cli, governance, workflow]
---

# Script placement migration and pipeline check diet (A9)

## 1. Objective and outcome

Bring every script under the ADR-130 placement contract
([harness surface governance §2](../design/harness-surface-governance.md#2-script-placement-adr-051-r4-amendment-adr-130)).
Spur-domain logic moves into `packages/app` behind flags on existing nouns. Duplicates and dead code are deleted.
Plugin scripts and hooks shrink to glue. Pipelines keep only core gates strict. Done means:

- the `sp-script-placement` baseline is empty (or holds only exemptions listed in §2);
- no sp skill, command or workflow references a moved script path;
- idea-pipeline and task-pipeline onEnter/onExit action counts are within the targets in §3 W4.

## 2. Inventory (complete, 2026-09-28)

Legend: **Move→CLI** = logic to `packages/app`, and the plugin/pipeline calls the flag. **→scripts** = moves to
`scripts/commands` and is dispatched by `spur-dev.ts`. **Keep** = legitimate glue; slim only if noted. **Delete** = no
owner needs it. C-numbers refer to the consent list in §2.1.

### `plugins/sp/scripts` (26 top-level entries, 13.6k LOC)

| Script | LOC | Runtime consumers | Target | Wave |
| --- | --- | --- | --- | --- |
| stage-registry-adapter | 1533 | none (tests + README only; the `checkpoint-contract.ts` mention is a comment) | **Delete** with its 4 tests; drop the manifest row | W1 |
| history-anatomy-cache | 1152 | history-anatomy.yaml, history-anatomy skill | Logic → `packages/app` + `history-anatomy` lib bundle; script ≤250 LOC glue (C6 unfit: `history report` never opens the DB) | W3 |
| surface-drift-inventory | 989 | repo gate | →scripts | W1 |
| pr-reviewing | 927 | sp:pr-reviewing | Keep (sp-owned git/gh loop, no Spur-domain logic; cited exemption) | — |
| validate-flag-contracts | 890 | repo gate | →scripts | W1 |
| inline-run-setup | 813 | inline driver, 3 refs | Keep as glue; move run-identity logic into the existing `inline-run` lib bundle and aim for ≤250 LOC. No new surface | W3 |
| quality-gate | 710 | task-pipeline test-gate, 7 refs | Logic → `packages/app` + `quality-gate` lib bundle; script ≤250 LOC glue. Not folded into `command.gate` (receipts, light mode and coverage scan are pipeline policy, not engine semantics) | W3 |
| validate-commands | 689 | repo gate | →scripts | W1 |
| residual-scan | 641 | task-pipeline, dev-verify(all), code-verification | Logic → `packages/app` + `residual-scan` lib bundle; script ≤250 LOC. Fold stays in `record` (task 0967 ordering) | W2 |
| wrapup-steps | 598 | wrapup-pipeline | Keep (budget exemption); its feature-sync branch calls `spur feature sync` directly | W2 |
| verify-answer-lint | 549 | 7 refs | Move→CLI: `spur task verdict` lints its answer (C2) | W2 |
| script-contract-check | 506 | repo gate | →scripts; becomes the `sp-script-placement` evaluator | W0 |
| feature-sync-bounded | 481 | runall/wrapall | Move→CLI: `spur feature sync` suppresses a repeated BLOCKED outcome (C4, narrowed; `--force` bypasses). Delete | W2 |
| workflow-step-profile | 459 | spur-doctor | Logic → `packages/app` + `step-profile` lib bundle; script ≤250 LOC glue (C5 unfit: `workflow progress` is per-run, the profile spans N runs) | W3 |
| batch-preflight | 459 | super-planner, routing-table, 6 refs | Keep (sp-owned TABLE A knowledge); budget exemption, reviewed in W4 | — |
| inline-pipeline-parity-check | 298 | repo gate | →scripts | W1 |
| feature-verification-steps | 275 | feature-verification.yaml | Keep (ADR-119 receipt writer; budget exemption) | — |
| wrapup-drift-probe | 260 | wrapup-pipeline | Keep (glue over the capture file) | — |
| transition-shim-check | 238 | repo gate | →scripts | W1 |
| task-diffstat | 229 | task-pipeline triage | Keep (SENSITIVE-path classification, ADR-125/0943; exemption) | — |
| task-size-precheck | 212 | task-pipeline | Move→CLI: `spur task check --precheck` (C1). Reuses the existing `packages/app` service. Delete | W2 |
| script-root | 195 | pipelines | Keep; it is the single run-start resolver, and W4 removes the per-action fallbacks it replaced | W4 |
| task-evidence-precheck | 189 | task-pipeline, 2 refs | Move→CLI: `spur task check --precheck` (C1). Delete | W2 |
| idea-coverage-check | 168 | idea-pipeline | Move→CLI: `spur feature check --inventory <report>` (C3). Delete | W2 |
| record-feature-sync | 84 | task-pipeline record | **Delete**; record runs `task show` → `spur feature sync <id>` inline | W2 |
| idea-handoff | 47 | idea-pipeline | Keep (already thin over the `idea-handoff` lib bundle) | — |
| daily-summary/, dogfood-testing/ | — | their skills | Keep | — |

### `plugins/sp/hooks` (7 hooks + pi adapter)

| Hook | Target |
| --- | --- |
| context-post-tool (425), context-session-start, context-session-stop | Keep: ADR-129 cores. Budget exemption, cited in the baseline |
| careful-guard, destructive-policy, task-write-guard, task-file-policy, agent-hint | Keep; within budget |
| pi/guard-extension | Keep (ADR-129 normalizer) |

### `plugins/sp/lib`

`env.ts` plus the generated `inline-run`, `idea-handoff` and `artifact-digest` bundles already follow the contract, so there is
nothing to move. W2–W3 add `residual-scan`, `step-profile`, `history-anatomy` and `quality-gate` bundles and widen `inline-run`.

### `scripts/commands` (22 commands) and `scripts/spur-dev.ts`

All 22 are self-dev (build, bundle, release, measurement, repo gates), so none move. The dispatcher is already one line per
command; that is not overengineering, so it stays. W1 adds the five gates moved from the plugin (invoked from `package.json`). No `.mjs` twins exist for them; they are repoOnly manifest rows.

### 2.1 Consent list

The operator must confirm each item at design review. None adds a noun.

| # | Surface change | Replaces |
| --- | --- | --- |
| C1 | `spur task check <wbs> --precheck`: new flag. Runs the size and evidence prechecks, with the pipeline exit contract | task-size-precheck, task-evidence-precheck |
| C2 | `spur task verdict`: observable-output change, no flag. Lints the answer before deriving the verdict; findings go in `lintFindings` (residual fold withdrawn at refine) | verify-answer-lint |
| C3 | `spur feature check <id> --inventory <report>`: new flag. Checks requirement-inventory ↔ AC coverage | idea-coverage-check |
| C4 | `spur feature sync`: observable-output change. Replays a repeated BLOCKED outcome with `suppressed: true`; existing `--force` also bypasses suppression (narrowed at refine) | feature-sync-bounded, record-feature-sync |
| C5 | `spur workflow progress <run-id> --profile`: consented, **unexercised** (shape mismatch) | — |
| C6 | `spur history report --anatomy`: consented, **unexercised** (shape mismatch) | — |

## 3. Execution sequence

Each wave is one or more tasks. Each is independently revertible, runs `plugin-smoke`, and updates every sp
skill, command and workflow reference to the moved path in the same task. That last step is proven with
`rg '<old-script>' plugins/sp config/workflows` returning nothing.

1. **W0: contract and enforcement.** Land ADR-130 and governance §2, and add an AGENTS.md pointer plus the init
   template pointer. Move `script-contract-check` into `scripts/commands` and extend it with the glue-budget
   check (>250 LOC, direct DB access, corpus parsing) and a `scripts/commands` ↔ public-verb name clash check.
   Seed `config/script-placement-baseline.json` from §2. Add `config/rules/boundary/sp-script-placement.yaml`
   (exit-code evaluator).
2. **W1: dead code and repo gates.** Delete stage-registry-adapter. Move the five repo-only gates into
   `scripts/commands`, updating `package.json` and the plugin-scripts manifest. Shrink the baseline.
3. **W2: task and feature domain (C1–C4).** Services go in `packages/app`, flags on `task check`, `task verdict`,
   `feature check` and `feature sync`. The pipelines, dev-verify(all), code-verification, runall/wrapall and
   wrapup-steps call the verbs. Delete the replaced scripts; residual-scan moves to a lib bundle.
4. **W3: workflow, history and inline runs (no new surface).** Move workflow-step-profile,
   history-anatomy-cache and quality-gate logic into `packages/app` behind generated lib bundles; slim
   inline-run-setup through the `inline-run` bundle. Every script keeps its argv and exit contract.
5. **W4: check diet and final sweep.**
   - One `inline-run-setup --actions-file` call per state; `action_runs` rows stay per action (ADR-117).
   - Pipelines (including pr-review and history-anatomy, which gain a `script-root` action) read the run-start script root instead of repeating the `plugin-scripts.json || superskill script path` probe.
   - Surviving scripts share one `plugins/sp/lib/spur-bin.ts` instead of per-script `spurCommand`/`defaultSpurBin` copies.
   - One route-fact writer per boundary.
   - Composition, drift and BDD-warning findings stay advisory and never retry.
   - Strict gates remain: `feature check` / `task check` errors, `spur-check` tests, verify verdict, plugin
     standalone and smoke.
   - Targets, pinned by a new action-budget test (`pipeline-budgets` measures model queries, not actions)
     against today's 34 / 56 onEnter+onExit actions: idea-pipeline ≤30, task-pipeline ≤48.
   - Final reference sweep; the baseline keeps only cited exemptions.

W1 can run in parallel with W0's rule work. W2 uses C1–C4 consent. W3 adds no surface.

## 4. Risks and verification

- **Plugin/CLI skew.** An older CLI lacks the new flags. Releases bump every package in lockstep and an unknown
  flag is rejected, so a skewed install fails closed; each wave runs `plugin-smoke`. No CLI-floor mechanism exists
  or is added.
- **Loosened checks hide real failures.** Only non-core checks are loosened. Every removed check is listed with its
  replacement in the task evidence.
- **Verification:** `spur rule run` with the placement rule, `bun run spur-check`, `plugin-smoke`, `pipeline-budgets`,
  and the reference-sweep `rg`.

## 5. Follow-up

- Exemptions (batch-preflight, pr-reviewing, wrapup-steps, wrapup-drift-probe, feature-verification-steps,
  task-diffstat, ADR-129 hooks) are re-evaluated when they grow. batch-preflight may shrink once TABLE A reads
  `spur task list --json` directly.
- Any new noun proposal goes through §3/§4 of the governance satellite first.
