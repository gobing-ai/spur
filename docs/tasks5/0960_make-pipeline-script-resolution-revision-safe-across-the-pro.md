---
schema_version: 1
name: Make pipeline script resolution revision-safe across the project copy and the installed twin
status: done
template: issue
created_at: 2026-09-26T00:36:38.726Z
updated_at: "2026-09-28T22:08:29.473Z"
feature_id: I

ac_altitude: task-local
priority: P1
estimate_hours: 8
---

## 0960. Make pipeline script resolution revision-safe across the project copy and the installed twin

### Background

Pipeline steps resolve sp plugin scripts **project-first**. The workflow YAML ships with the Spur CLI, so a consuming project runs the probe too. Any stale hand-vendored `plugins/sp/scripts/` copy in that project then **shadows** the installed twin. Verified at HEAD `938ec4c30`, where 18 sites run from the project tree:

| file | sites | forms |
| --- | --- | --- |
| `config/workflows/task-pipeline.yaml` | 10 | `if [ -f plugins/sp/scripts/X.ts ]` at :428, :511, :531; `S=plugins/sp/scripts/X.ts; [ -f "$S" ] \|\| S=…twin…` at :210, :215, :730, :794, :808, :855; `LINT_SCRIPT=` at :708 |
| `config/workflows/wrapup-pipeline.yaml` | 5 | `if [ -f … ]` / `elif [ -f … ]` at :146, :166, :193, :291, :325 |
| `config/workflows/idea-pipeline.yaml` | 1 | `S=plugins/sp/scripts/idea-coverage-check.ts` at :257 |
| `config/workflows/feature-verification.yaml` | 1 | **unconditional** `bun plugins/sp/scripts/feature-verification-steps.ts verify` at :56. It has no twin fallback and no fail-closed branch, so in a consumer without a vendored copy the feature `verifying` step cannot run at all. This is the likeliest reason consumers started vendoring. |
| `plugins/sp/skills/spur-dev/references/inline-pipeline-driver.md` | 1 | `SETUP_SCRIPT="plugins/sp/scripts/inline-run-setup.ts"` at :79 |

The probes exist for **dogfooding**. In the spur-new source repo, `plugins/sp/scripts/*.ts` is the live source, and the wrapup comment at `wrapup-pipeline.yaml:140` says "monorepo first, registered twin under node". Nothing restricts the probe to that repo.

#### What happens in a consuming project

In knowledge-kit (measured 2026-09-25, against installed plugin 0.3.92), the vendored set was incomplete and drifted at once: 7 plugin scripts were absent and 23 had drifted. So one run mixed revisions:

- `quality-gate`, `task-size-precheck`, `task-evidence-precheck` and `wrapup-steps` ran the project's stale copy.
- `residual-scan`, `record-feature-sync` and `feature-verification-steps` ran the installed twin.

These are the scripts that write and read the cross-step artifacts (status files, verdict artifacts, proof digests). The inline driver's `SETUP_SCRIPT` probe picked the vendored `inline-run-setup.ts`, which had no `--fingerprint` mode, so a `/sp:dev-runall --feature D6` batch had to hand-roll the proof digest (the provenance recorded in 0958).

#### Why the project vendored at all (0959 folded in here)

0959 said consumers have "no supported way" to obtain the scripts. That premise is false:

- `superskill install sp --marketplace <locator> [--no-global]` installs them, as the root `README.md:67-75` documents.
- `superskill script path sp <rel> --json` already resolves project-level first and global second, reporting `source`.
- knowledge-kit's `superskill install sp` failed with `Plugin 'sp' not found. Available: kk` because it omitted `--marketplace`.

The misleading instruction came from Spur itself. All 13 fail-closed remedies across the three YAMLs and the driver reference say only `run 'superskill install sp'` (task-pipeline 7, wrapup 4, idea 1, driver 1).

So vendoring was never needed. The probe then executed the vendored copy, which is the actual defect. This agrees with ADR-065 (`docs/00_ADR.md:719`): shipped surfaces resolve through the canonical Superskill path and never run `plugins/sp/scripts/` directly. It also shows a gap in script-contract-check rule 4 (`plugins/sp/scripts/script-contract-check.ts:314`). `scanShippedSurfaces` scans only `commands/`, `skills/`, `agents/` and `README.md`, for the literal `bun plugins/sp/scripts/`. It never scans `config/workflows/*.yaml`, and it misses the `[ -f … ]` / `S=` / `SETUP_SCRIPT=` indirections.

#### Dedup

- **0959 is cancelled as superseded.** Its sync verb duplicates `superskill install --no-global`. Its manifest and drift check guard a vendored copy that this task stops executing. Its fingerprint repro is the `SETUP_SCRIPT` probe fixed here.
- **0970** (A32) checks twin-vs-source parity inside the spur repo. It is a different defect with no overlap.
- There is no overlap in 0964–0976. `rg` for vendor / project-first / `superskill script path` / marketplace / `SETUP_SCRIPT` finds only 0975's use of the `$SETUP_SCRIPT` variable, which it inherits unchanged.

**Refine corrections (2026-09-27)**

- The separately checked R1a/AC1a labels normalize to R1/AC1 in the checklist parser; moved them to R7/AC7 while retaining their feature-verification scope.

### Requirements

- [x] R1. Every project-first `plugins/sp/scripts/` probe (the 18 sites in Background) takes the project-tree branch only inside the Spur source repo, detected by `config/plugin-scripts.json`. Everywhere else, a step resolves only through `superskill script path sp <rel>`, so a vendored `plugins/sp/scripts/` copy in a consuming project is never executed.
- [x] R2. Each of `task-pipeline`, `wrapup-pipeline`, `idea-pipeline` and `feature-verification` runs one resolution action at run start. It writes `.spur/run/<runId>-script-root.json` with `{ mode: "source-repo" | "installed", source, dir, scriptSetDigest }`. `source` and `dir` come from `superskill script path … --json`. `scriptSetDigest` is one sha256 over the sorted `name:sha256` list of the resolved dir's files. The same action prints one warning naming an ignored vendored `plugins/sp/scripts/` dir when one exists outside the source repo.
- [x] R3. Fail-closed behaviour is unchanged: when no script resolves, each step still writes its per-step FAIL status or error exactly as today. The run-start action never aborts the run.
- [x] R4. Every fail-closed remedy message names the working install command, `superskill install sp --marketplace gobing-ai/spur`, instead of the bare `superskill install sp`.
- [x] R5. script-contract-check rule 4 also scans `config/workflows/*.yaml`, and it flags any project-first `plugins/sp/scripts/` reference (`[ -f`, `S=`, `*_SCRIPT=`, or `bun plugins/sp/scripts/`) that is not inside the source-repo guard. A new ungated probe then fails `bun run script-contract-check`.
- [x] R6. The Spur source repo keeps its dogfood behaviour: with `config/plugin-scripts.json` present, steps still run `bun plugins/sp/scripts/<name>.ts`, and `script-root.json` records `mode: "source-repo"`.
- [x] R7. `feature-verification.yaml:56` gains the same twin fallback (`superskill script path sp feature-verification-steps.mjs`) and a fail-closed branch that writes the step's FAIL status, matching the other pipelines.

### Acceptance Criteria

- [x] AC1 — In a project without `config/plugin-scripts.json` that carries a stale vendored `plugins/sp/scripts/`, every step runs the installed twin, and the run prints one warning naming the ignored dir (req: R1, R2)
- [x] AC2 — A run writes `script-root.json` with mode, source, dir and a script-set digest that changes when any resolved script changes (req: R2)
- [x] AC3 — With no resolvable script, each step keeps its existing per-step fail-closed output, and the run is not aborted (req: R3)
- [x] AC4 — Every fail-closed remedy names `superskill install sp --marketplace gobing-ai/spur` (req: R4)
- [x] AC5 — A fixture workflow with an ungated `S=plugins/sp/scripts/x.ts` probe fails script-contract-check, and the shipped YAMLs pass (req: R5)
- [x] AC6 — Inside the source repo, steps run `plugins/sp/scripts/*.ts` and `script-root.json` records `source-repo` (req: R6)
- [x] AC7 — In a consumer with no vendored copy, the feature-verification `verify` step runs the installed twin; with no twin, it writes FAIL and names the install command (req: R7, R4)

### Q&A

<!-- Clarifications and triage decisions. Keep empty if none. -->

#### Q&A entry — 2026-09-26T00:37:19.957Z

- **CLOSED — fail-closed per step is correct and stays.** The defect is *silence*, not the fallback. A
  missing script must keep producing a loud per-step failure; this task adds agreement, it does not relax
  the guard.
- **CLOSED — this task does not implement the sync.** 0959 provides the mechanism to make a project
  current; 0960 makes resolution safe *whether or not* the sync has run. They are independent and can land
  in either order; neither is a prerequisite for the other.
- **CLOSED — the check must stay cheap.** The pipeline already pays many shell hops per run; a per-step
  content hash of every script would add cost to the hot path. One resolution pass at run start, comparing
  the project set against the resolved source once, is the budget.
- **CLOSED — do not abort on a per-step missing script.** Aborting the run when one optional script is
  absent would turn a partial install into a total outage. The run-level concern is *revision agreement*;
  the step-level concern stays *fail closed*.
- **OPEN — warn vs fail on mismatch (blocks ready).** Warning keeps existing runs working while a project is
  mid-vendor; failing enforces agreement but breaks any project with a partially vendored set until it is
  synced. Suggested default: **warn with the file list, plus a strict mode** that fails, so the gate can be
  tightened per project. Operator decision required.

#### Q&A entry — 2026-09-26T17:05:34.241Z

#### Q&A entry — 2026-09-26 (refinement; supersedes the 2026-09-26T00:37 entry)

- **Warn vs fail on mismatch: resolved as warn-once (closed).** The old open question assumed the vendored copy would keep executing and needed an agreement check. Under R1 it is never executed in a consuming project, so the two can no longer mix. The only remaining signal is that a dead vendored dir exists. That is worth a single warning, but it is not worth failing a run. No strict mode.
- **Direction: gate the probe on the source repo, not a `$SCRIPT_ROOT` thread (closed).** The old Direction A rewrote every step to call `$SCRIPT_ROOT/<name>`, and Direction B added a preflight next to the probes. Both kept executing project copies in consumers. Guarding each probe on `config/plugin-scripts.json` fixes the root cause with the smallest diff at the existing 17 sites. R5 then keeps future sites honest.
- **Why `config/plugin-scripts.json` is the marker (closed).** It is the plugin-script manifest owned by the Spur repo (`script-contract-check` reads it). It lives outside `plugins/sp/`, so copying `plugins/sp` wholesale cannot reproduce it, and knowledge-kit has no such file. `superskill script path --project` is not a substitute, because it reports the superskill project root, not the plugin source tree.
- **No sync verb, no vendor manifest (closed; 0959 cancelled).** `superskill install sp --marketplace … --no-global` is the supported project-level install, and `superskill script path` already prefers project over global. A second resolver or emitter would recreate the two-resolver drift. The ADR-065 direction is "resolve the installed twin", not "copy scripts into the project".
- **Revision identity is a script-set digest (closed).** The staged root `~/.agents/scripts/sp/` has no version file. One sha256 over the resolved dir's files, computed once per run, answers "which revision produced this run?" without a Superskill change. A version stamp in Superskill's staging is Superskill-side follow-up work and out of scope here.
- **Fail-closed per step stays, and the run is never aborted (closed; kept from the prior entry).** The defect was executing the wrong copy, not the fallback. A missing optional script must not become a total outage.
- **Consumers delete their vendored dir themselves (closed).** Spur never deletes project files. The R2 warning names the dir, and knowledge-kit's cleanup is a downstream action.

#### Q&A entry — 2026-09-26T17:10:48.978Z

#### Q&A entry — 2026-09-26 (refinement; supersedes the 2026-09-26T00:37 entry)

- **Warn vs fail on mismatch: resolved as warn-once (closed).** The old open question assumed the vendored copy would keep executing and needed an agreement check. Under R1 it is never executed in a consuming project, so the two can no longer mix. The only remaining signal is that a dead vendored dir exists. That is worth a single warning, but it is not worth failing a run. No strict mode.
- **Direction: gate the probe on the source repo, not a `$SCRIPT_ROOT` thread (closed).** The old Direction A rewrote every step to call `$SCRIPT_ROOT/<name>`, and Direction B added a preflight next to the probes. Both kept executing project copies in consumers. Guarding each probe on `config/plugin-scripts.json` fixes the root cause with the smallest diff at the existing 18 sites. R5 then keeps future sites honest.
- **Why `config/plugin-scripts.json` is the marker (closed).** It is the plugin-script manifest owned by the Spur repo (`script-contract-check` reads it). It lives outside `plugins/sp/`, so copying `plugins/sp` wholesale cannot reproduce it, and knowledge-kit has no such file. `superskill script path --project` is not a substitute, because it reports the superskill project root, not the plugin source tree.
- **No sync verb, no vendor manifest (closed; 0959 cancelled).** `superskill install sp --marketplace … --no-global` is the supported project-level install, and `superskill script path` already prefers project over global. A second resolver or emitter would recreate the two-resolver drift. The ADR-065 direction is "resolve the installed twin", not "copy scripts into the project".
- **Revision identity is a script-set digest (closed).** The staged root `~/.agents/scripts/sp/` has no version file. One sha256 over the resolved dir's files, computed once per run, answers "which revision produced this run?" without a Superskill change. A version stamp in Superskill's staging is Superskill-side follow-up work and out of scope here.
- **Fail-closed per step stays, and the run is never aborted (closed; kept from the prior entry).** The defect was executing the wrong copy, not the fallback. A missing optional script must not become a total outage.
- **Consumers delete their vendored dir themselves (closed).** Spur never deletes project files. The R2 warning names the dir, and knowledge-kit's cleanup is a downstream action.

### Design

**Guard form (one idiom, used at all 18 sites).** Only the project-first branch changes; the twin branch and the fail-closed branch are untouched.

```sh
# if-form (task-pipeline :428/:511/:531, wrapup :146/:166/:193/:291/:325)
if [ -f config/plugin-scripts.json ] && [ -f plugins/sp/scripts/X.ts ]; then bun plugins/sp/scripts/X.ts …;
elif Q="$(superskill script path sp X.mjs 2>/dev/null)" && [ -f "$Q" ]; then node "$Q" …;
else …unchanged fail-closed…; fi

# S=-form (task-pipeline :210/:215/:708/:730/:794/:808/:855, idea :257, driver.md :79)
S=; [ -f config/plugin-scripts.json ] && S=plugins/sp/scripts/X.ts;
[ -f "$S" ] || S="$(superskill script path sp X.mjs 2>/dev/null)"; …unchanged…
```

- Where a site currently falls back to a `.ts` twin (for example `task-size-precheck.ts`, `verify-answer-lint.ts`), keep the existing `rel` and runner selection. This task changes *which tree*, not *which file*.
- Edit only `config/workflows/*.yaml` and `plugins/sp/…`. `apps/cli/config/` and `apps/cli/plugins/` are regenerated by `build:bundle`.

**`feature-verification.yaml:56` (R7).** Convert it to the if-form above. For the fail-closed branch, write FAIL to the same status file that `feature-verification-steps.ts verify` writes, so the existing transition guard routes the run to `failed`. Verify: the guard reads that file, not the exit code.

**Run-start resolution action (R2).** A new plugin script, `plugins/sp/scripts/script-root.ts`, plus its `.mjs` twin, is registered in `config/plugin-scripts.json` as `contract: standard`. It stays standalone (node/bun builtins only).

- It is invoked once, as the first shell action of each pipeline, using the same guard idiom to locate itself.
- It decides the mode from the marker. In installed mode, `dir` comes from `superskill script path sp script-root.mjs --json`: `dirname(path)`, plus `source`.
- It hashes the dir's regular files (sorted `name:sha256`, non-recursive) into `scriptSetDigest`, writes `.spur/run/<runId>-script-root.json`, and warns once on stderr if `plugins/sp/scripts/` exists without the marker.
- Every error path writes `{ mode: "unresolved", error }` and exits 0 (R3).
- The inline driver reference records the same file from its setup step. Add one line after `SETUP_SCRIPT` resolution that runs the script.

**Remedy text (R4).** Replace every `run 'superskill install sp'` in the three YAMLs and `inline-pipeline-driver.md` with `run 'superskill install sp --marketplace gobing-ai/spur'`.

**Rule 4 extension (R5), in `plugins/sp/scripts/script-contract-check.ts`.**

- `scanShippedSurfaces` (:118) gains `config/workflows/*.yaml` as a scan root. The rule is repo-only, so it resolves `config/` from `pluginDir/../..`.
- It adds a pattern for the indirections `\[ -f "?plugins/sp/scripts/`, `\b[A-Z_]*S(?:CRIPT)?="?plugins/sp/scripts/` and `bun plugins/sp/scripts/`. A hit is allowed only when the same line contains `config/plugin-scripts.json`.
- Comment lines (`#`) and Markdown prose references (backticked paths without an assignment or `[ -f`) are not hits, so documentation that names a script's source path stays legal.

**Out of scope:**

- Superskill-side version stamps.
- Deleting consumers' vendored dirs.
- Twin-vs-source parity (0970).
- Changing what any script does.

### Plan

- [x] 1. Apply the guard idiom at all 18 sites (task-pipeline 10, wrapup 5, idea 1, feature-verification 1, `inline-pipeline-driver.md` 1). The feature-verification site also gains the twin and fail-closed branches (R7). Keep the twin and fail-closed branches byte-identical apart from the R4 remedy text.
- [x] 2. Add `plugins/sp/scripts/script-root.ts`, build its `.mjs` twin (`bun run build:scripts`), and register it in `config/plugin-scripts.json`. Unit tests cover source-repo mode, installed mode (fake `superskill` on PATH), unresolved mode (exit 0), the digest changing on one file edit, and the vendored-dir warning.
- [x] 3. Wire `script-root` as the first action of task-, wrapup-, idea- and feature-verification pipelines, and into the inline driver's setup step.
- [x] 4. Replace the 13 remedy strings (R4).
- [x] 5. Extend script-contract-check rule 4 (R5). Add a fixture test with an ungated probe (fails) and a guarded probe (passes). Confirm the live-repo test stays green.
- [x] 6. Consumer replay: in a temp project with a stale vendored `plugins/sp/scripts/` and no marker, run one pipeline step shell per form. Assert the twin path ran and the warning printed. Record the evidence in Solution.
- [x] 7. `bun run --filter @gobing-ai/spur build:bundle`, then `bun run spur-check`, then `bun run plugin-smoke`.

### Root Cause

The project-first probe was written for dogfooding in the Spur repo, but it is unconditional. The workflow YAML and the driver reference ship to every consumer, so in a consuming project the probe executes whatever `plugins/sp/scripts/` happens to contain. The fail-closed remedy text omitted `--marketplace`, so the documented install failed in consumers, and operators hand-vendored instead. Script-contract-check rule 4 does not scan workflow YAML, and it misses the `[ -f` / `S=` indirections, so nothing flagged the shadowing path. The mixed-revision runs and the missing `--fingerprint` are symptoms of this one unguarded branch.

### Solution

Change-map (auto-generated — implement step did not record a Solution).
Each entry cites the first changed line per file (`file:line`).

| Change (`file:line`) |
|----------------------|
| `packages/app/tests/workflow/idea-pipeline-definition.test.ts:596` |
| `packages/app/tests/workflow/task-pipeline-triage-routing.test.ts:154` |
| `plugins/sp/scripts/script-contract-check.ts:123` |
| `plugins/sp/scripts/script-contract-check.ts:125` |
| `plugins/sp/scripts/script-contract-check.ts:136` |
| `plugins/sp/scripts/script-contract-check.ts:151` |
| `plugins/sp/scripts/script-contract-check.ts:208` |
| `plugins/sp/scripts/script-contract-check.ts:241` |
| `plugins/sp/scripts/script-contract-check.ts:246` |
| `plugins/sp/scripts/script-contract-check.ts:249` |
| `plugins/sp/tests/feature-verification-scope.test.ts:80` |
| `plugins/sp/tests/script-contract-check.test.ts:316` |
| `plugins/sp/tests/task-pipeline-resilience.test.ts:136` |
| `plugins/sp/tests/task-pipeline-resilience.test.ts:143` |
| `plugins/sp/tests/task-pipeline-resilience.test.ts:155` |
| `plugins/sp/tests/task-pipeline-resilience.test.ts:173` |
| `plugins/sp/tests/task-pipeline-resilience.test.ts:186` |
| `plugins/sp/tests/task-pipeline-resilience.test.ts:208` |
| `plugins/sp/tests/task-pipeline-resilience.test.ts:298` |
| `plugins/sp/tests/task-pipeline-resilience.test.ts:310` |

### Testing

**Pipeline verify results**

- Verdict: PASS (from verdict artifact)

| Requirement | Status | Evidence |
|-------------|--------|----------|
| R1 | MET | Guard idiom at all 18 inventoried sites plus a 19th found in `plugins/sp/skills/spur-dev/references/execution-batch.md:855`: `config/workflows/{task-pipeline,wrapup-pipeline,idea-pipeline,feature-verification}.yaml` + the two reference files now take the project branch only under `[ -f config/plugin-scripts.json -a -f … ]`. `bun plugins/sp/scripts/script-contract-check.ts` → 0 violations; consumer replay with a stale vendored dir and no marker ran the installed twin for both probe forms |
| R2 | MET | `plugins/sp/scripts/script-root.ts` (+ built `script-root.mjs` twin) writes `.spur/run/<runId>-script-root.json` with `{mode, source, dir, scriptSetDigest}`; registered in `config/plugin-scripts.json` as `standard`; wired as the first shell action of task-pipeline `precheck`, wrapup `start`, idea `start`, feature-verification `verify`, and the inline driver's setup snippet. Consumer replay recorded `{"mode":"installed","source":"global","dir":…,"scriptSetDigest":"sha256:…"}` and printed the one vendored-dir warning |
| R3 | MET | Every `script-root` error path writes `{mode:"unresolved", error}` and exits 0 (`runScriptRoot` never throws past `write`); tests "unresolved mode" and "main … rejects an unknown flag" pin it. The pipeline action appends `; exit 0`. The 0824 fail-closed wrapper contract is unchanged (`bun run spur-check` green, 9414 pass) |
| R4 | MET | All 13 remedy strings in the three YAMLs (task 7, wrapup 4, idea 1) + the driver reference now name `superskill install sp --marketplace gobing-ai/spur`; `${…}`-free shell keeps the workflow validator green |
| R5 | MET | `scanShippedSurfaces` gained `config/workflows/*.yaml` (resolved from `pluginDir/../..`) with `[ -f …`, `[A-Z_]*S(?:CRIPT)?=`, and `bun plugins/sp/scripts/` patterns, allowed only when the line/block names `config/plugin-scripts.json`; new fixture test "R5 — an ungated project-first probe in a workflow YAML fails; a guarded probe passes" plus the live-repo test |
| R6 | MET | `source-repo` mode returns `dir: plugins/sp/scripts`, `source: project`; test "source-repo mode" asserts it never probes superskill. The four sp-probe shells keep running `bun plugins/sp/scripts/<name>.ts` under the marker |
| R7 | MET | `feature-verification.yaml` `verify` gained the `plugins/sp/scripts/feature-verification-steps.ts` project probe gated on the marker, the `.mjs` twin fallback, and a fail-closed `printf 'FAIL …' > .spur/run/$__runId-feature-verification.status` branch naming the install command |

| Acceptance Criteria | Status | Evidence Type | Evidence |
|---------------------|--------|---------------|----------|
| AC1 | MET | command | `bash /tmp/replay-0960.sh` in a temp project (stale `plugins/sp/scripts/*.ts`, no marker): S=-form → `TWIN tool`, if-form → `TWIN wrapup-steps`, run-start → `TWIN script-root` + the vendored-dir warning |
| AC2 | MET | test | `plugins/sp/tests/script-root.test.ts` "scriptSetDigest is non-recursive and changes when one resolved file changes"; replay emitted a live `scriptSetDigest` |
| AC3 | MET | test | "unresolved mode: nothing resolves → error recorded, exit 0, run never aborted"; the pipeline action ends `; exit 0` |
| AC4 | MET | command | `grep -rn "superskill install sp" config/workflows/*.yaml plugins/sp/skills/spur-dev/references/*.md` — every remedy carries `--marketplace gobing-ai/spur`; `bun run spur-check` rule `recommended-pre-check` green |
| AC5 | MET | test | `plugins/sp/tests/script-contract-check.test.ts` R5 fixture (ungated → `forbidden_invocation` on `ungated.yaml`; guarded → none); live repo `script-contract-check` → 0 violations |
| AC6 | MET | test | `script-root.test.ts` "source-repo mode: the marker selects the project tree and never probes superskill"; the four pipelines keep `bun plugins/sp/scripts/<name>.ts` under the marker |
| AC7 | MET | command | `config/workflows/feature-verification.yaml` `verify` resolves `plugins/sp/scripts/feature-verification-steps.ts` under the marker, else `superskill script path sp feature-verification-steps.mjs`, else writes `FAIL …` naming the install command |
- Coverage: N/A (verdict-based; verify pipeline does not measure code coverage)

### Review

<!-- spur:record-review -->

**SECU findings** (pipeline verify step — verdict: PASS)

| Priority | Dimension | Location | Finding |
|----------|-----------|----------|----------|
| P4 | spur task check | — | task check passed |
| P4 | evidence-rule-pass | — | All behavior-bearing AC rows have executable evidence or are explicitly non-behavioral. |
| P4 | proof-input-digest | — | sha256:ffa8724fb6293c925722f90836d0e894b6d9cc16540b7ffc11f6fe52c11f4fa8 |

### References

- Parent feature: `docs/features/I_sp-plugin.md` ("sp plugin")
- Decision: `docs/00_ADR.md:719` (ADR-065: portable scripts resolve through the canonical Superskill path)
- Probe sites: `config/workflows/task-pipeline.yaml` :210, :215, :428, :511, :531, :708, :730, :794, :808, :855; `config/workflows/wrapup-pipeline.yaml` :146, :166, :193, :291, :325; `config/workflows/idea-pipeline.yaml:257`; `config/workflows/feature-verification.yaml:56` (unconditional); `plugins/sp/skills/spur-dev/references/inline-pipeline-driver.md:79`
- Gate: `plugins/sp/scripts/script-contract-check.ts` (rule 4 at :314, `scanShippedSurfaces` at :118)
- Install surface: root `README.md:67-75` (`superskill install sp --marketplace …`); `superskill script path --json` (`source: project|global`)
- Cancelled as superseded: **0959** (sync verb and vendor manifest). Its knowledge-kit inventory (7 absent, 23 drifted) and commits `3e32e642`, `f1744081`, `11605024`, `f3d51034`, `e8b07e70` are the consumer evidence for this task.
- Related, no overlap: **0970** (A32, twin content parity in the spur repo); **0958** (records the `--fingerprint` provenance)
- Consumer evidence: knowledge-kit `/sp:dev-runall --feature D6` (2026-09-25)

### History

- 2026-09-26T00:37:29.824Z todo → backlog (system)
- 2026-09-27T16:45:01.921Z backlog → todo (system)
- 2026-09-28T22:08:27.962Z todo → wip (system)
- 2026-09-28T22:08:28.478Z wip → testing (system)
- 2026-09-28T22:08:29.473Z testing → done (system)

