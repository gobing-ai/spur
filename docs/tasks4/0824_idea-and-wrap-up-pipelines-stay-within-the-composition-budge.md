---
schema_version: 1
name: idea and wrap-up pipelines stay within the composition budgets
status: todo
template: feature-impl
created_at: 2026-09-10T23:51:14.073Z
updated_at: "2026-09-11T06:08:29.664Z"
feature_id: I21
priority: P2
tags:
  - workflow
  - composition

ac_numbering: task-local
dependencies: ["0822"]
---

## 0824. idea and wrap-up pipelines stay within the composition budgets

### Background

On 2026-09-10 two shared workflows exceed the ADR-115 caps. Keys below abbreviate `state:onEnter:i`. Figures are logical commands, then characters.

| Workflow | Element | Measured |
| --- | --- | --- |
| `idea-pipeline.yaml` | `handoff-finalize:0` | 70 / 3100 |
| | `batch-create-run:0` | 9 / 821 |
| | `decompose:1` `agent.run` input | 1697 chars |
| | `ready-prepare:0` `agent.run` input | 1485 chars, no output check |
| `wrapup-pipeline.yaml` | `task-resolve:1` | 34 / 1644 |
| | `task-resolve:2` | 25 / 1083 |
| | `metrics-record:0` | 30 / 1849 |
| | `feature-transition:0` | 64 / 3645 |

- Warn band, no change required: idea `decompose:2` (10 / 531) and `ready-prepare:1` (6 / 537), wrap-up `doc-sync:1` (7 / 343), and eight idea guards at 4–5 commands: `ac-generate→{system-design, decompose, ac-generate, failed}` and `feature-check→{system-design, decompose, ac-generate, failed}`.
- `handoff-finalize:0` runs `idea-handoff-cli.ts` (the tested `finalizeIdeaHandoff`) in the monorepo. The other ~65 commands are the D5-O portable shell copy of the same contract for seeded projects.
- `task-resolve:1`, `metrics-record:0` and `feature-transition:0` are run-local JSON handling, status probes and the bounded feature sync. Exec tests in `packages/app/tests/workflow/wrapup-pipeline.test.ts` pin each one.
- The `decompose` and `ready-prepare` inputs restate skill guidance inline.
- `docs/design/workflow-shell-ownership.md` is stale for wrap-up: its table (:208) says "(4 compound)" and has no `task-resolve` rows.

Implements:
- R22 — idea and wrap-up pipelines stay within the composition budgets

Ordering: after 0822 (the validator), before 0826 (the `spur-check` gate), independent of 0823/0825. Grouped for size: each workflow alone is under a day, and both review against the same corpus-write services.

Consent: granted 2026-09-10 (governance §4) for behavior-preserving edits to the shared workflows and for the new plugin scripts. No public `spur` verb or flag changes.

### Requirements

- [ ] R1. `spur workflow validate --json` on `idea-pipeline.yaml` and `wrapup-pipeline.yaml` reports no error-level composition finding and no `agent-run-output` finding. Over-cap programs move to owners from the closed fix vocabulary (governance §1.1 (a)–(d)); a stays-shell reason is valid only inside the warn band. Every remaining warn-band program and guard carries a one-line reason as a YAML comment directly above it. The `decompose` and `ready-prepare` prompt bodies move into the skill references they paraphrase, and their inputs carry only the operation, its vars and its output paths. Routes, `.spur/run` artifacts, handoff output, corpus writes, exit semantics and test-pinned messages stay the same, except that a seeded project without the `sp` plugin now fails closed at `handoff-finalize`. Existing workflow assertions pass, moved with the logic they pin. The `run --dry-run` graphs are unchanged, `build:bundle` parity holds and no model query is added. A new public `spur` verb or flag lands only with its own consent entry.

Non-goals:
- `stateEffect`/`evidenceEffect` declarations. The progress projection hard-codes them and ADR-115 asks for none.
- Clearing warn-band findings, including the non-slash `agent.run` inputs. Each may remain with its reason.
- task-pipeline (0823), the other shared workflows (0825), the `spur-check` gate and budget coverage (0826).
- Pipeline budget changes. idea keeps its 6 model queries and wrap-up keeps its single `doc-sync` query.
- Merging `decompose` and `ready-prepare` (composition rule 5).

### Acceptance Criteria

```gherkin
Feature: idea and wrap-up pipelines stay within the composition budgets

  Scenario: R1 — idea and wrap-up pipelines stay within the composition budgets
    Given config/workflows/idea-pipeline.yaml and config/workflows/wrapup-pipeline.yaml
    When `spur workflow validate --json` runs on each
    Then neither reports an error-level composition finding
    And every agent.run action declares expectFile or requireDiff
    And their workflow tests pass and their `run --dry-run` graphs are unchanged
```

### Q&A

<!-- CLOSED decisions from refinement: what was chosen and why, what was deferred and on what
     condition. Not a parking lot for open questions — an unanswered question here means the task
     is not ready to hand off. Keep empty if none. -->

#### Q&A entry — 2026-09-11T06:08:29.664Z

Refined at depth=ready (refineall I21, 2026-09-10). Closed decisions:
- **Consent granted 2026-09-10** (governance §4) for behavior-preserving edits to the shared workflows and for the new plugin scripts `idea-handoff.ts` and `wrapup-steps.ts`. No public verb or flag changes.
- **Effects dropped.** ADR-115 asks for no effect declarations, and the progress projection hard-codes them.
- **Frozen programs.** The Design programs and inputs were measured with 0822's helper on 2026-09-10. `task-resolve:2` has 7 chars of margin (793/800); re-measure after any edit.
- **Warn-band reasons are YAML comments** directly above the action or guard, never shell `#` lines inside a `>-` scalar.
- **Handoff fallback: bundle, not port.** The plugin script calls the bundled, tested `finalizeIdeaHandoff`. The bundle costs ~0.66 MB minified plus the same-size `.mjs` twin. Unminified, it would be 1.25 MB.
- **Seeded projects need the `sp` plugin for the handoff.** Without it, `handoff-finalize` fails closed with a `superskill install sp` hint instead of running a shell copy. The idea model steps already dispatch `sp:*` skills, so such a project could not reach the handoff anyway. An existing seeded project picks the scripts up with its next plugin update.
- **ready-prepare writes go through `spur task update --section`** (AGENTS non-negotiable 1). The old prompt said "open the task doc".
- **ready-prepare output check.** `answerFile` equal to `expectFile` on an answer file proves that an answer was captured, not its quality. The READY sidecar keeps its seed-and-validate step and the handoff's evidence gate.
- **Order sidecar `[]` is per item** (`depends_on_names: []`), matching the `decompose:2` validator.
- **Test migration.** Assertions follow the logic they pin. The `finalizeCmd` pins are deleted, because `idea-handoff.test.ts` pins the same contract on `finalizeIdeaHandoff`.
- **Model queries.** idea keeps 6. The budget file says 5; that drift predates this task and belongs to 0826's Q&A, pending Robin's decision.

### Design

**Approach.** Each over-cap program gets one owner from the governance §1.1 fix vocabulary. States, transitions and guard kinds stay unchanged. The programs below are frozen text, measured with 0822's `countLogicalCommands`. A program may wrap across `>-` lines only at a single space, since folding restores it; add or remove no other character. Where this Design is silent, the current program is the reference for messages, arguments and file names.

**Owner map.**

| Before | Measured | Owner | After (cmds / chars) |
| --- | --- | --- | --- |
| idea `handoff-finalize:0` | 70 / 3100 | (d) `idea-handoff` plugin script over the bundled `finalizeIdeaHandoff`, plus a wrapper | 7 / 328, warn |
| idea `batch-create-run:0` | 9 / 821 | (e) condensed | 10 / 495, warn |
| idea `decompose:1` input | 1697 chars | skill reference | 222 chars |
| idea `ready-prepare:0` input | 1485 chars, no output check | skill reference, `answerFile` = `expectFile` | 251 chars |
| wrap-up `task-resolve:1` | 34 / 1644 | (d) `wrapup-steps.ts resolve` plus a wrapper | 8 / 383, warn |
| wrap-up `task-resolve:2` | 25 / 1083 | (e) condensed | 9 / 793, warn |
| wrap-up `metrics-record:0` | 30 / 1849 | (d) `wrapup-steps.ts metrics` plus a wrapper | 8 / 383, warn |
| wrap-up `feature-transition:0` | 64 / 3645 | (d) `wrapup-steps.ts feature-transition` plus a wrapper | 8 / 402, warn |
| idea `decompose:2`, `ready-prepare:1`, wrap-up `doc-sync:1`, the 8 idea guards | warn band | (e) unchanged | reason comment only |

**Frozen programs.** Each one replaces the whole `command:` of its action. Each YAML comment sits directly above its `- kind: shell` line.

`handoff-finalize:onEnter:0`. Delete the F1/D5-O comment block (:450-462), which describes the removed shell copy.

```yaml
      # (d) idea-handoff owns finalization (bundled finalizeIdeaHandoff); the monorepo runs the TS writer directly.
      - kind: shell
        options:
          command: >-
            if [ -f packages/app/src/workflow/idea-handoff-cli.ts ]; then bun packages/app/src/workflow/idea-handoff-cli.ts; elif H="$(superskill script path sp idea-handoff.mjs 2>/dev/null)" && [ -f "$H" ]; then node "$H"; else echo "idea handoff failed closed — idea-handoff script not found — run 'superskill install sp'" >&2; exit 1; fi
```

`batch-create-run:onEnter:0`:

```yaml
      # (e) one batch-create call plus the once-per-attempt sentinels the guards read; workflow-local glue.
      - kind: shell
        options:
          command: >-
            P=".spur/run/$__runId-idea-batch-create"; test ! -f "$P.done" || exit 0; rm -f "$P.failed" "$P-result.json" "$P-result.json.tmp"; if $spurBin task batch-create --file .spur/run/$__runId-idea-task-batch.json --skip-ready --json > "$P-result.json.tmp" && jq -e ".created == (.wbs | length)" "$P-result.json.tmp" >/dev/null 2>&1; then mv "$P-result.json.tmp" "$P-result.json" && date -u +%Y-%m-%dT%H:%M:%SZ > "$P.done"; else rm -f "$P-result.json.tmp"; date -u +%Y-%m-%dT%H:%M:%SZ > "$P.failed"; fi
```

`task-resolve:onEnter:1`, with the reason `# (d) wrapup-steps.ts resolve owns task capture and status resolution; the wrapper only locates it and fails closed.`:

```sh
mkdir -p .spur/run; if [ -f plugins/sp/scripts/wrapup-steps.ts ]; then bun plugins/sp/scripts/wrapup-steps.ts resolve; elif W="$(superskill script path sp wrapup-steps.mjs 2>/dev/null)" && [ -f "$W" ]; then node "$W" resolve; else echo "wrapup-steps failed closed — script not found — run 'superskill install sp'" >&2; printf 'FAIL\n' > ".spur/run/$__runId-wrapup-resolve.status"; fi
```

- `metrics-record:onEnter:0`: the same wrapper with `metrics` as the subcommand and `-wrapup-metrics.status` as the status file. Reason: `# (d) wrapup-steps.ts metrics owns the metrics-row append; the wrapper only locates it and fails closed.`
- `feature-transition:onEnter:0`: the same wrapper with `feature-transition` and `-wrapup-sync.status`, 402 chars. Reason: `# (d) wrapup-steps.ts feature-transition owns sync, observation and the gate; the wrapper only locates it and fails closed.`
- Keep the `feature-transition` YAML text "cannot convert a failed sync into" (pinned at `wrapup-pipeline.test.ts:797`).

`task-resolve:onEnter:2`, with the reason `# (e) route-reason writer: one jq table lookup over the mode var; workflow-local routing glue.`. It has 7 chars of margin, so re-measure it after any edit.

```sh
mkdir -p .spur/run .spur/memory; RUN_ID="$__runId"; case "$RUN_ID" in '') echo "task-resolve: __runId is empty — refusing to write a route reason" >&2; exit 1 ;; esac; REASON_FILE=".spur/run/$RUN_ID-route-reason.txt"; case "$(cat ".spur/run/$RUN_ID-wrapup-resolve.status" 2>/dev/null)" in FAIL) exit 0 ;; esac; N=$(jq length ".spur/run/$RUN_ID-wrapup-tasks.json" 2>/dev/null); jq -rn --arg m "$mode" --arg n "$N" 'if $n == "0" then "skipped:empty task list" else {"fast":"fast:evidence complete+consistent","":"safety:missing evidence (mode empty)","unknown":"safety:unknown evidence quality","conflict":"safety:conflicting evidence"}[$m] // "safety:unrecognized evidence (mode=\($m))" end' > "$REASON_FILE"; printf '%s %s\n' "$RUN_ID" "$(cat "$REASON_FILE")" >> .spur/memory/wrapup-routes.log
```

It is equivalent to the current program: a failed `jq length` leaves `N` empty, which is not `"0"`, so the mode lookup runs, just as `N=-1` did.

**Warn-band reasons** (YAML comments only, no program change):
- `decompose:onEnter:2`, as the last line of the existing comment block: `# (e) one jq predicate over the two run files; the fail-closed sidecar check.`
- `ready-prepare:onEnter:1`, likewise: `# (e) seeds the empty sidecar and runs one jq shape check; workflow-local glue.`
- wrap-up `doc-sync:onEnter:1`: `# (e) best-effort append of the captured learnings; workflow-local glue.`
- The 8 idea guards. Each comment goes directly above the transition's `guard:` key.
  - `ac-generate→system-design`, `ac-generate→decompose`, `feature-check→system-design` and `feature-check→decompose`: `# (e) route predicate: profile or HITL answer, AC check status, design route and needs_design.`
  - `ac-generate→ac-generate`, `ac-generate→failed`, `feature-check→ac-generate` and `feature-check→failed`: `# (e) route predicate: profile or HITL answer, AC check status and retry count.`

**The two inputs.** `role`, `agent`, `timeoutMs` and the existing comments stay.
- `decompose:onEnter:1` keeps `expectFile: .spur/run/${vars.__runId}-idea-task-batch.json` and gets this input (222 chars):

  `Run sp:spec-decomposition for feature ${vars.featureId} per its references/decomposition.md § Idea-pipeline emission: write .spur/run/${vars.__runId}-idea-task-batch.json and .spur/run/${vars.__runId}-idea-task-order.json.`

- `ready-prepare:onEnter:0` gets this input (251 chars). It also gains `answerFile` and `expectFile`, both `.spur/run/${vars.__runId}-ready-prepare-answer.txt`.

  `Run the ready-prepare stage for feature ${vars.featureId} per sp:spur-dev references/planning-workflow.md § Step 5.6 (Ready preparation): read .spur/run/${vars.__runId}-idea-batch-create-result.json and write .spur/run/${vars.__runId}-idea-ready.json.`

- The output check is the answer file, not `idea-ready.json`. `ready-prepare:1` seeds an empty READY sidecar so the handoff degrades to refineall; an `expectFile` on `idea-ready.json` would fail the run instead.

**Moved prompt bodies.**
- **`plugins/sp/skills/spec-decomposition/references/decomposition.md`.** Add a new `## Idea-pipeline emission` section before `## Common schema violations` (:528). It carries the current `decompose:1` input as reference prose:
  - the inputs: brainstorm artifact, feature AC, design doc;
  - sizing first, per `Default to NOT decomposing`: a score of 0–2 means a one-entry batch;
  - scenario count is not task count, with the merge rule and "list every scenario a task covers in its background";
  - the batch path, the schema and the local validation;
  - the order sidecar path and shape.
  - Keep these literals verbatim, because tests move here:
    - `Schema-permitted fields per entry` with the backticked field list;
    - `the per-task refine step after batch-create still deepens them`;
    - `depends_on_names`;
    - `exactly one batch item`.
  - State `[]` per item, as `depends_on_names: []`, which is what the `decompose:2` validator accepts.
- **`plugins/sp/skills/spur-dev/references/planning-workflow.md`.** Append a `**Ready preparation (ready-prepare, 0788).**` paragraph to Step 5.6, before `## Step 6` (:273). It carries the current `ready-prepare:0` input:
  - The input is `.wbs` in `.spur/run/<runId>-idea-batch-create-result.json`.
  - Per WBS, apply the ready-refinement checklist (requirements, design, plan, acceptance criteria, decisions, dependencies, premises) so that `spur task check <wbs> --json` exits 0.
  - Write planning sections only, through `spur task update <wbs> --section <Name> --from-file <file>`, never Solution, Testing, Review or History. This replaces the old "open the task doc".
  - Record one checklist row per id, with evidence.
  - The digest resolves the file with `spur task path <wbs> --json`, then runs the existing `bun -e '…computePlanningDigest…' <task-file>` command. When it cannot run, the status is `skipped`.
  - The exact READY JSON shape, including `planningDigest`.
  - "never fabricate evidence; the handoff degrades to refineall".
  - `computePlanningDigest` and `planningDigest` must appear, because tests move here.

**Handoff bundle (d).**
- **`scripts/commands/bundle-plugin-lib.ts`.** Add `bundleIdeaHandoffLib(outDir = OUT_DIR)` next to `bundlePluginLib`; the existing API stays as it is.
  - `Bun.build` options:
    - entry `packages/app/src/workflow/idea-handoff-cli.ts`;
    - `target: 'node'`, `format: 'esm'`, `minify: true`;
    - `define: { 'import.meta.main': 'false' }`, so the CLI's own main block (:62) stays inert on import;
    - output named `idea-handoff.generated.mjs`.
  - It also writes `idea-handoff.generated.d.mts`:

    ```ts
    export interface IdeaHandoffCliEnv { __runId?: string; featureId?: string; spurBin?: string; }
    export declare function runIdeaHandoffCli(env: IdeaHandoffCliEnv): Promise<{ exitCode: number }>;
    ```

  - The main block calls both bundlers. Update the header doc.
  - Measured 2026-09-10: ~659 KB minified (1.25 MB unminified), no `bun:` imports, runs under node 24.
- **`plugins/sp/scripts/idea-handoff.ts`**, a standard ADR-065 entry:

  ```ts
  import { runIdeaHandoffCli } from '../lib/idea-handoff.generated.mjs';

  if (import.meta.main) {
      const outcome = await runIdeaHandoffCli(process.env);
      process.exit(outcome.exitCode);
  }
  ```

- Register `{ "rel": "idea-handoff.ts", "contract": "standard", "twin": "idea-handoff.mjs" }` in `config/plugin-scripts.json`. Append `&& superskill script convert sp idea-handoff.ts` to `build:scripts` (`package.json:61`). Biome already ignores `plugins/sp/lib`.
- `packages/app/src/workflow/idea-handoff-cli.ts:33-35` doc comment: "seeded projects fall back to the portable shell program" becomes "seeded projects run the bundled `idea-handoff` plugin script (0824)".

**Plugin script (d): `plugins/sp/scripts/wrapup-steps.ts`.**
- A standard ADR-065 entry: `node:` imports, an `if (import.meta.main)` block and a `.mjs` twin.
- Register `{ "rel": "wrapup-steps.ts", "contract": "standard", "twin": "wrapup-steps.mjs" }` and append it to `build:scripts`.
- Usage is `wrapup-steps.ts resolve|metrics|feature-transition`. Any other subcommand exits 2 with a usage line.
- Env comes from the workflow vars:
  - `__runId`, `tasks`, `feature`, `featureGateCmd`;
  - `spurBin`, which is split on whitespace into a command plus prefix args, so `bun apps/cli/src/index.ts` works.
- Messages are verbatim ports; `…` marks text completed from the current program.
- **`resolve`** ports `task-resolve:1`:
  1. An empty `__runId` prints `task-resolve: __runId is empty — refusing the legacy fixed-path fallback` to stderr and exits 1.
  2. It creates `.spur/run`.
  3. `tasks` must be a JSON array of strings matching `^[0-9]{4}$`. Otherwise it:
     - prints `task-resolve: tasks must be a JSON array of canonical four-digit WBS strings (whitespace is rejected, not trimmed)` to stderr;
     - writes `failed:tasks is not a JSON array of canonical four-digit WBS strings` to `.spur/run/$__runId-route-reason.txt`;
     - writes `FAIL`.
  4. It dedupes in first-seen order and writes `.spur/run/$__runId-wrapup-tasks.json` as compact JSON plus a newline.
  5. For each WBS, it runs `task show <wbs> --json` and reads the status as `.frontmatter.status // .status`. A status other than `done`/`cancelled` prints `task-resolve: task <wbs> did not resolve to a completed status (status=<status or unresolved>)`.
  6. All completed writes `PASS`. Otherwise it writes the reason `failed:unresolved or non-completed task (see <tasks file>)` and `FAIL`.
  7. The status file is `.spur/run/$__runId-wrapup-resolve.status`, and the exit is 0.
- **`metrics`** ports `metrics-record:0`:
  1. It creates `.spur/run` and `.spur/memory`.
  2. A missing, corrupt or non-canonical `-wrapup-tasks.json` prints `metrics-record: run-scoped task capture missing, corrupted or non-canonical — refusing to record metrics` and writes `FAIL`.
  3. For each WBS, a failed lookup or a null `(.frontmatter.status // .status)` prints `metrics-record: task <wbs> lookup failed or was malformed — recording FAIL instead of silently omitting its metrics row`.
  4. Otherwise it appends one compact line `{"wbs","feature_id","status","verdict","timestamp"}`, in that key order, to `.spur/memory/wrapup-metrics.jsonl`:
     - `feature_id`: `.frontmatter.feature_id // .feature_id // ""`;
     - `status`: `… // "unknown"`;
     - `verdict`: `.verdict // "UNKNOWN"` from `.spur/run/<wbs>-verdict.json`, with jq `//` semantics (null and false count as missing);
     - `timestamp`: UTC `%Y-%m-%dT%H:%M:%SZ`, no milliseconds.
  5. A failed append prints `metrics-record: metrics append failed for task <wbs> — recording FAIL instead of claiming the row landed`.
  6. It writes `PASS` or `FAIL` to `.spur/run/$__runId-wrapup-metrics.status`, and the exit is 0.
- **`feature-transition`** ports `feature-transition:0`:
  1. An empty `feature` prints `feature-transition: vars.feature is empty — refusing no-op feature sync (mis-invocation, not a blocked sync)` and exits 1.
  2. The sync takes the first of three branches that exists, relative to the cwd, with the current arguments including `--spur-bin`:
     1. `bun plugins/sp/scripts/feature-sync-bounded.ts`;
     2. `node` on `superskill script path sp feature-sync-bounded.mjs`;
     3. `$spurBin feature sync "$feature" --json`.
  3. It captures stdout, prints it and keeps the exit code.
  4. The observed status is `feature show --json` `.status // .frontmatter.status`, else `unreadable`.
  5. The validation reasons are verbatim:
     - `sync exited nonzero (rc=…)`;
     - `malformed or unreadable sync result`;
     - `sync proposal does not match feature <feature>`;
     - `sync proposal is gate-blocked — a blocked sync is not a no-change success`;
     - `sync proposal requires operator confirmation`;
     - `applied sync did not land on the proposal target (observed=…, to=…)`;
     - `sync applied nothing without a from==to observed no-op (from=…, to=…, observed=…)`.
  6. When the sync applied or exited nonzero, it runs the gate as `sh -c "$featureGateCmd"` with inherited stdio, and echoes gate PASS, FAIL or skipped verbatim.
  7. The final messages are verbatim:
     - `required synchronization failed … — <reason>; gate=<gate>`;
     - `feature sync verified … (from==to observed at …, gate=…) — explicit no-change`;
     - `feature sync verified … (applied, observed=…, gate=…)`.
  8. It writes `PASS` or `FAIL` to `.spur/run/$__runId-wrapup-sync.status`, and the exit is 0.

**Test migration.** Assertions follow the logic they pin. Run everything from the repo root with `bun test <paths>`.

| Test | Change |
| --- | --- |
| `idea-pipeline-definition.test.ts:372-378` (`depends_on_names`, `exactly one batch item`) | Assert them on the decomposition.md `## Idea-pipeline emission` slice. The input test asserts `sp:spec-decomposition`, `Idea-pipeline emission` and both artifact paths. |
| same file `:395-400` | Pin `P=".spur/run/$__runId-idea-batch-create"`, `"$P-result.json.tmp"` and `"$P.done"`. `--json` and `.created == (.wbs \| length)` stay. |
| same file `:417-431` | The input keeps the `idea-ready.json` pin. `computePlanningDigest`/`planningDigest` move to the planning-workflow.md Step 5.6 slice. Add `answerFile === expectFile`. The shell pins stay. |
| same file `:437-461`, `:489-505` (`finalizeCmd`) | Delete them: `idea-handoff.test.ts` pins the same contract on `finalizeIdeaHandoff`. Add wrapper pins `idea-handoff-cli.ts`, `superskill script path sp idea-handoff.mjs`, `failed closed` and `exit 1`. |
| `plugins/sp/tests/skill-structure.test.ts` R40 (:641-666) | Same assertions, on the decomposition.md `## Idea-pipeline emission` slice. |
| `wrapup-pipeline.test.ts` exec tests: resolve 211, 230, 237, 256, 301, 330; metrics 449, 468, 495, 517, 543, 570; feature-transition 617, 634, 654, 685, 703, 727 | Move to `plugins/sp/tests/wrapup-steps.test.ts`, spawning `bun <repo>/plugins/sp/scripts/wrapup-steps.ts <sub>` in a temp cwd with the same env and assertions. feature-transition keeps `stubSyncEnv`. |
| same file 345 | Stays; its step 1 runs through the script. |
| same file 154, 379 | Unchanged. |
| same file `:196-208` | `shells[0]` contains `wrapup-steps`, `resolve` and `wrapup-resolve.status`; the route pins stay. |
| same file `:439-446` | The wrapper contains `wrapup-steps`, `metrics` and `wrapup-metrics.status`. Exec test 570 covers the serialization. |
| same file `:165-166`, `:607-614` | Wrapper pins on `wrapup-sync.status`. The script exec tests cover the proposal and gate text. |
| same file `:784-790` | Narrow to the route writer (`shellsOf` index 1). |
| `proportional-routing-pilots.test.ts` pins on the last `task-resolve` shell | Hold, because the route writer stays last. |
| new: wrapper fail-closed | A temp cwd without `plugins/` and a failing `superskill` on PATH. Each wrap-up wrapper writes `FAIL` and exits 0; the idea wrapper exits 1 with `failed closed` on stderr. |
| new: `scripts/commands/bundle-plugin-lib.test.ts` | The handoff lib exists, regenerates byte-identically, contains `runIdeaHandoffCli` and not `import.meta.main`. |
| new: `plugins/sp/tests/idea-handoff-script.test.ts` | `node plugins/sp/scripts/idea-handoff.mjs` without `__runId`/`featureId` exits 1 with `__runId and featureId env vars are required`. |

**Ownership and doc rows.**
- `docs/design/workflow-shell-ownership.md`:
  - idea table (:151): `handoff-finalize` goes DUAL → EXT (bundled plugin script). `batch-create-run` stays GLUE (condensed).
  - wrap-up table (:208): "(4 compound)" becomes 6.
    - Add `task-resolve:onEnter:1` EXT (`wrapup-steps.ts resolve`) and `task-resolve:onEnter:2` GLUE.
    - `metrics-record` becomes EXT.
    - `feature-transition` becomes EXT + POLICY via `wrapup-steps.ts`.
  - Portability rule (:234-241): replace the "Application services … monorepo-only … dual implementation … steady state" paragraph. The new text says a plugin script reaches an application service through a generated `plugins/sp/lib/*.generated.mjs` bundle (the 0669 precedent), and the idea handoff has used one since 0824.
- `docs/design/workflow-composition-contract.md:32`: D5-O reads "landed as monorepo writer + bundled plugin-script fallback (0824)".

**Invariants.**
- States, transitions, guard kinds and the model-query count stay unchanged (idea 6, wrap-up 1).
- `.spur/run` artifact names, status values and stderr messages stay unchanged.
- `finalizeIdeaHandoff` is the single handoff implementation; no shell copy remains.
- The monorepo runs TS sources through `bun`; seeded projects run the `.mjs` twins through `node`.

**Rejected.**
- Merging `decompose` and `ready-prepare`: a model-step merge is a behavior change that needs its own evidence (composition rule 5). Doctor proposes it if the step profile supports it.
- Porting the handoff shell copy into its own script: that is a second `finalizeIdeaHandoff` to keep in parity. The bundle reuses the tested one.
- `expectFile` on `idea-ready.json`: a missing sidecar must degrade the recommendation, not fail the run.
- A public verb for wrap-up or handoff steps: it needs consent, and plugin scripts suffice.
- Three wrap-up scripts: they share the capture validation and the `spurBin` launch. One script with subcommands is less code.
- Generalizing `bundlePluginLib`: one more entry does not justify a config-driven bundler.
- `command.gate` for `batch-create-run`: it records a status, not the `--json` result that the handoff zips.

### Plan

1. Record the baseline (R1). For both workflows, save `spur workflow validate config/workflows/<name>.yaml --json` and the state ids plus transitions (`from`, `to`, `guard.kind`), parsed with the `yaml` package from the repo root, under `.spur/run/0824-baseline.*`.
2. Move the prompt bodies (R1).
   - Add `## Idea-pipeline emission` to `decomposition.md`.
   - Add the Ready preparation paragraph to `planning-workflow.md` Step 5.6.
   - Move the R40, `:372-378` and `:423-424` pins to those slices, then run both suites.
3. Handoff bundle (R1).
   - Write the new `bundle-plugin-lib.test.ts` cases and `idea-handoff-script.test.ts` first.
   - Implement `bundleIdeaHandoffLib` and `plugins/sp/scripts/idea-handoff.ts`.
   - Register the script in `config/plugin-scripts.json` and `build:scripts`, then run `bun run build:scripts`.
4. `wrapup-steps.ts` (R1).
   - Port the wrap-up exec tests into `plugins/sp/tests/wrapup-steps.test.ts` and watch them fail.
   - Implement the script, register it and rebuild the scripts.
5. Edit the YAML (R1):
   - idea: the handoff wrapper, the condensed `batch-create-run`, the two inputs and the `ready-prepare` output check;
   - wrap-up: the three wrappers and the condensed `task-resolve:2`;
   - both: every YAML-comment reason, including the 8 guards and `doc-sync:1`.
6. Migrate the remaining assertions per the Design table, and add the wrapper fail-closed tests.
7. Update the docs:
   - the ownership tables and the portability paragraph;
   - the composition-contract D5-O row;
   - the `idea-handoff-cli.ts` doc comment.
8. Verify:
   - `validate --json` on both workflows shows no error-level finding, no `agent-run-output` finding and no var-ref violation;
   - the parsed graphs equal the baseline;
   - the focused suites pass (`bun test <paths>` from the repo root): `idea-pipeline-definition`, `idea-handoff`, `idea-handoff-cli`, `wrapup-pipeline`, `proportional-routing-pilots`, `skill-structure`, `bundle-plugin-lib`, `wrapup-steps` and `idea-handoff-script`;
   - run `bun run --filter @gobing-ai/spur build:bundle`, then `bun run spur-check`.

### Solution

<!-- Filled during implementation: file:line change map and concise rationale. -->

### Testing

<!-- Filled during verification: commands run, outcomes, coverage claim or N/A. -->

### Review

<!-- Filled during review: P1-P4 findings, residual risk, and final disposition. -->

### References

<!-- Links to the parent feature, design docs, related tasks, or external references. -->

### History
