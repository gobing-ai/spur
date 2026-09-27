---
schema_version: 1
name: Make pipeline script resolution revision-safe across the project copy and the installed twin
status: todo
template: issue
created_at: 2026-09-26T00:36:38.726Z
updated_at: "2026-09-27T16:45:01.921Z"
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

- [ ] R1. Every project-first `plugins/sp/scripts/` probe (the 18 sites in Background) takes the project-tree branch only inside the Spur source repo, detected by `config/plugin-scripts.json`. Everywhere else, a step resolves only through `superskill script path sp <rel>`, so a vendored `plugins/sp/scripts/` copy in a consuming project is never executed.
- [ ] R2. Each of `task-pipeline`, `wrapup-pipeline`, `idea-pipeline` and `feature-verification` runs one resolution action at run start. It writes `.spur/run/<runId>-script-root.json` with `{ mode: "source-repo" | "installed", source, dir, scriptSetDigest }`. `source` and `dir` come from `superskill script path … --json`. `scriptSetDigest` is one sha256 over the sorted `name:sha256` list of the resolved dir's files. The same action prints one warning naming an ignored vendored `plugins/sp/scripts/` dir when one exists outside the source repo.
- [ ] R3. Fail-closed behaviour is unchanged: when no script resolves, each step still writes its per-step FAIL status or error exactly as today. The run-start action never aborts the run.
- [ ] R4. Every fail-closed remedy message names the working install command, `superskill install sp --marketplace gobing-ai/spur`, instead of the bare `superskill install sp`.
- [ ] R5. script-contract-check rule 4 also scans `config/workflows/*.yaml`, and it flags any project-first `plugins/sp/scripts/` reference (`[ -f`, `S=`, `*_SCRIPT=`, or `bun plugins/sp/scripts/`) that is not inside the source-repo guard. A new ungated probe then fails `bun run script-contract-check`.
- [ ] R6. The Spur source repo keeps its dogfood behaviour: with `config/plugin-scripts.json` present, steps still run `bun plugins/sp/scripts/<name>.ts`, and `script-root.json` records `mode: "source-repo"`.
- [ ] R7. `feature-verification.yaml:56` gains the same twin fallback (`superskill script path sp feature-verification-steps.mjs`) and a fail-closed branch that writes the step's FAIL status, matching the other pipelines.

### Acceptance Criteria

- [ ] AC1 — In a project without `config/plugin-scripts.json` that carries a stale vendored `plugins/sp/scripts/`, every step runs the installed twin, and the run prints one warning naming the ignored dir (req: R1, R2)
- [ ] AC2 — A run writes `script-root.json` with mode, source, dir and a script-set digest that changes when any resolved script changes (req: R2)
- [ ] AC3 — With no resolvable script, each step keeps its existing per-step fail-closed output, and the run is not aborted (req: R3)
- [ ] AC4 — Every fail-closed remedy names `superskill install sp --marketplace gobing-ai/spur` (req: R4)
- [ ] AC5 — A fixture workflow with an ungated `S=plugins/sp/scripts/x.ts` probe fails script-contract-check, and the shipped YAMLs pass (req: R5)
- [ ] AC6 — Inside the source repo, steps run `plugins/sp/scripts/*.ts` and `script-root.json` records `source-repo` (req: R6)
- [ ] AC7 — In a consumer with no vendored copy, the feature-verification `verify` step runs the installed twin; with no twin, it writes FAIL and names the install command (req: R7, R4)

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

- [ ] 1. Apply the guard idiom at all 18 sites (task-pipeline 10, wrapup 5, idea 1, feature-verification 1, `inline-pipeline-driver.md` 1). The feature-verification site also gains the twin and fail-closed branches (R7). Keep the twin and fail-closed branches byte-identical apart from the R4 remedy text.
- [ ] 2. Add `plugins/sp/scripts/script-root.ts`, build its `.mjs` twin (`bun run build:scripts`), and register it in `config/plugin-scripts.json`. Unit tests cover source-repo mode, installed mode (fake `superskill` on PATH), unresolved mode (exit 0), the digest changing on one file edit, and the vendored-dir warning.
- [ ] 3. Wire `script-root` as the first action of task-, wrapup-, idea- and feature-verification pipelines, and into the inline driver's setup step.
- [ ] 4. Replace the 13 remedy strings (R4).
- [ ] 5. Extend script-contract-check rule 4 (R5). Add a fixture test with an ungated probe (fails) and a guarded probe (passes). Confirm the live-repo test stays green.
- [ ] 6. Consumer replay: in a temp project with a stale vendored `plugins/sp/scripts/` and no marker, run one pipeline step shell per form. Assert the twin path ran and the warning printed. Record the evidence in Solution.
- [ ] 7. `bun run --filter @gobing-ai/spur build:bundle`, then `bun run spur-check`, then `bun run plugin-smoke`.

### Root Cause

The project-first probe was written for dogfooding in the Spur repo, but it is unconditional. The workflow YAML and the driver reference ship to every consumer, so in a consuming project the probe executes whatever `plugins/sp/scripts/` happens to contain. The fail-closed remedy text omitted `--marketplace`, so the documented install failed in consumers, and operators hand-vendored instead. Script-contract-check rule 4 does not scan workflow YAML, and it misses the `[ -f` / `S=` indirections, so nothing flagged the shadowing path. The mixed-revision runs and the missing `--fingerprint` are symptoms of this one unguarded branch.

### Solution

<!-- Filled during implementation: file:line change map and concise rationale. -->

### Testing

<!-- Filled during verification: regression command(s), outcomes, coverage claim or N/A. -->

### Review

<!-- Filled during review: P1-P4 findings, residual risk, and final disposition. -->

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

