---
schema_version: 1
name: task-pipeline stays within the composition budgets
status: done
template: feature-impl
created_at: 2026-09-10T23:51:14.072Z
updated_at: "2026-09-13T05:57:10.645Z"
feature_id: I21
priority: P2
tags:
  - workflow
  - composition

ac_numbering: task-local
dependencies: ["0822"]
---

## 0823. task-pipeline stays within the composition budgets

### Background

On 2026-09-10 `config/workflows/task-pipeline.yaml` has 14 shell actions over the ADR-115 caps. Keys below abbreviate `state:onEnter:i`. Figures are logical commands, then characters where over 800.

| Action | Measured | Action | Measured |
| --- | --- | --- | --- |
| `precheck:0` | 11 | `test-fix:0` | 17 / 857 |
| `precheck:2` | 11 | `test-recheck:1` | 45 / 1673 |
| `precheck:3` | 13 | `verify:4` | 11 |
| `precheck:4` | 13 | `record:1` | 17 |
| `precheck:5` | 19 / 857 | `record:2` | 11 |
| `implement:1` | 17 | `done:0` | 17 |
| `test:6` | 39 / 1486 | `done:2` | 10 / 817 |

- Guards: `verify→record` measures 9 (error above 5). `verify→test-fix` measures 5 (warn band).
- `review:onEnter:0` and `test-fix:onEnter:2` are `agent.run` steps with neither `expectFile` nor `requireDiff`.
- `implement:1`, `record:1` and `done:0` are the same 17-command `retry_transient` wrapper around one `spur task` call.
- `test:6` and `test-recheck:1` are the quality gate: the per-project `qualityGateCmd` run with a database-lock retry and a `file:line` findings extract.
- The task-pipeline table in `docs/design/workflow-shell-ownership.md` (:180-198) uses stale keys (`test:onEnter:0`, `verify:onEnter:5`, `done:onEnter:3`) and has no rows for `precheck:onEnter:4`/`:5`.

Implements:
- R21 — task-pipeline stays within the composition budgets

Ordering: after 0822 (the validator), before 0826 (the `spur-check` gate), independent of 0824/0825. One task, because the digest-bound verify/record proof chain couples these programs into one review context.

Consent: granted 2026-09-10 (governance §4) for behavior-preserving edits to the shared workflows and for a new plugin script. No public `spur` verb or flag changes.

### Requirements

- [x] R1. `spur workflow validate config/workflows/task-pipeline.yaml --json` reports no error-level composition finding and no `agent-run-output` finding. Each over-cap program and guard moves to an owner from the closed fix vocabulary (governance §1.1 (a)–(d)); a stays-shell reason is valid only inside the warn band. Every remaining warn-band program carries a one-line reason as a YAML comment directly above its action or guard. Routes, `.spur/run` artifacts, exit semantics, test-pinned messages and the `qualityGateCmd`/`gateProbeCmd` contract for adopting projects stay the same. The proof-chain suite passes and the `run --dry-run` graph is unchanged. `build:bundle` parity holds and no model query is added. A new public `spur` verb or flag lands only with its own consent entry.

Non-goals:
- `stateEffect`/`evidenceEffect` declarations. The progress projection hard-codes them and ADR-115 asks for none.
- Clearing warn-band findings. Each may remain with its reason.
- Other shared workflows (0824, 0825), the `spur-check` gate and budget coverage (0826).
- Pipeline budget changes. The model queries stay `implement`, `test-fix`, `review`, `verify`.

### Acceptance Criteria

```gherkin
Feature: task-pipeline stays within the composition budgets

  Scenario: R1 — task-pipeline stays within the composition budgets
    Given config/workflows/task-pipeline.yaml
    When `spur workflow validate --json` runs on it
    Then it reports no error-level composition finding
    And every agent.run action declares expectFile or requireDiff
    And the proof-chain suite passes and the `run --dry-run` graph is unchanged
```

### Q&A

<!-- CLOSED decisions from refinement: what was chosen and why, what was deferred and on what
     condition. Not a parking lot for open questions — an unanswered question here means the task
     is not ready to hand off. Keep empty if none. -->

#### Q&A entry — 2026-09-11T05:44:42.892Z

Refined at depth=ready (refineall I21, 2026-09-10). Closed decisions:
- **Consent granted 2026-09-10** (governance §4) for behavior-preserving edits to the shared workflows and for the new plugin script. No public verb or flag changes.
- **Effects dropped.** ADR-115 asks for no effect declarations, and the progress projection hard-codes them. R1's effects clause is removed.
- **Frozen programs.** The Design programs were measured with 0822's helper on 2026-09-10. If one must change, re-measure it and stay inside the warn band.
- **Warn-band reasons are YAML comments** directly above the action or guard, never shell `#` lines inside a `>-` scalar, because folding would comment out the rest of the program.
- **Guard design.** The probe-file guard (`run.artifact` or an extension guard) is rejected. One `jq -e` over the verdict file measures 1 and checks the same proof fields.
- **Bun-install hint dropped.** `command.gate` has no hint text. The retry class and the resultFile keep the behavior. The resilience :233/:252 tests become option assertions.
- **Retry regex.** `command.gate`'s `sqlite-busy` class did not match `SQLite database … is busy`, which the old `retry_transient` retried. 0823 extends the class and adds a unit test.
- **Output checks.** `answerFile` equal to `expectFile` proves that an answer was captured, not its quality. The review proof digest and the verify verdict remain the quality gates.
- **Quality gate is a plugin script, not an application service.** The logic is task-pipeline-only, and adopting projects keep their `qualityGateCmd`/`gateProbeCmd` strings.
- **Dry-run check.** Compare the parsed state ids and transitions. `workflow show --format mermaid` includes actions, so it changes by design.
- **Test migration.** Assertions follow the logic they pin, into `quality-gate.test.ts` and `command-gate.test.ts`. Pins on unchanged programs stay. lifecycle-drift R2 excludes `quality-gate.ts`, since the gate never shells spur.

### Design

**Approach.** Each program gets one owner from the governance §1.1 fix vocabulary. States, transitions and guard kinds stay unchanged. The programs below are frozen text, measured with 0822's `countLogicalCommands`. A program may wrap across `>-` lines only at a single space, since folding restores it; add or remove no other character.

**Owner map.**

| Before | Measured | Owner | After (cmds / chars) |
| --- | --- | --- | --- |
| `implement:onEnter:1`, `record:onEnter:1`, `done:onEnter:0` | 17 each | (c) `command.gate` | no shell |
| `test:onEnter:6` | 39 / 1486 | (d) `quality-gate.ts run` + wrapper | 9 / 387, warn |
| `test-recheck:onEnter:1` | 45 / 1673 | (d) `quality-gate.ts recheck` + wrapper | 9 / 395, warn |
| `precheck:onEnter:0` | 11 | (e) condensed | 7 / 449, warn |
| `precheck:onEnter:2` | 11 | (e) condensed | 9 / 402, warn |
| `precheck:onEnter:3` | 13 | (d) wrapper, condensed | 9 / 478, warn |
| `precheck:onEnter:4` | 13 | (d) wrapper, condensed | 9 / 421, warn |
| `precheck:onEnter:5` | 19 / 857 | (e) condensed | 8 / 620, warn |
| `test-fix:onEnter:0` | 17 / 857 | (e) split into `:0` and `:1` | 5 / 471 clean; 9 / 312, warn |
| `verify:onEnter:4` | 11 | (e) condensed | 8 / 695, warn |
| `record:onEnter:2` | 11 | (d) wrapper, condensed | 10 / 613, warn |
| `done:onEnter:2` | 10 / 817 | (e) condensed | 8 / 775, warn |
| guard `verify→record` | 9 | one `jq -e` predicate | 1 / 455 |
| guard `verify→test-fix` | 5 | (e) unchanged | 5, warn |

The `test-fix` split moves the `file.read.into-var` action to `test-fix:onEnter:2` and the `agent.run` to `test-fix:onEnter:3`.

**Built-in (c): the three lifecycle transitions.** Replace `implement:onEnter:1` with:

```yaml
      - kind: command.gate
        options:
          id: task-implement-transition
          executable: "${vars.spurBin}"
          args: ["task", "update", "${vars.wbs}", "wip", "--no-lifecycle"]
          retry:
            maxAttempts: 2
            delayMs: 2000
            on: ["sqlite-busy", "ENOENT", "EBUSY", "ENOTEMPTY"]
          resultFile: .spur/run/${vars.__runId}-implement-transition.status
          softFail: false
          timeoutMs: 120000
```

- `record:onEnter:1`: the same, with `id: task-record-transition`, `args: ["task", "record", "${vars.wbs}", "--solution-from-diff", "--transition", "testing"]` and `resultFile: .spur/run/${vars.__runId}-record-transition.status`.
- `done:onEnter:0`: the same, with `id: task-done-transition`, `args: ["task", "update", "${vars.wbs}", "done", "--no-lifecycle"]` and `resultFile: .spur/run/${vars.__runId}-done-transition.status`.
- A multi-word `spurBin` (`bun apps/cli/src/index.ts`) still works: `splitLaunchCommand` splits `executable` on whitespace, as the unquoted `$spurBin` did.
- `packages/app/src/workflow/actions/command-gate.ts:61`: the `sqlite-busy` class adds `|sqlite database .*is busy`, which the old `retry_transient` matched. The other `on` entries already match case-insensitive substrings.
- The old "run bun install" hint is dropped (Q&A).

**Plugin script (d): `plugins/sp/scripts/quality-gate.ts`.**
- Standard ADR-065 entry: `node:` imports, an `if (import.meta.main)` block and a `.mjs` twin.
- Register `{ "rel": "quality-gate.ts", "contract": "standard", "twin": "quality-gate.mjs" }` in `config/plugin-scripts.json`. Append `&& superskill script convert sp quality-gate.ts` to `build:scripts` (`package.json:61`).
- It reproduces the current `test:onEnter:6` and `test-recheck:onEnter:1` programs, which are the reference for any detail not listed here.

Contract:
- Usage: `quality-gate.ts run|recheck`. Any other mode exits 2 with a usage line.
- Inputs come from env (workflow vars): `wbs`, `qualityGateCmd`, `gateProbeCmd`, `proofDigest`.
- Files: `.spur/run/$wbs-test-gate.status`, `.spur/run/$wbs-test-gate.log`, `.spur/run/$wbs-test-gate.findings`.
- `run` writes `0` to `.spur/run/$wbs-test-fix-attempt` and truncates the log.
- `recheck` truncates the log, then runs `gateProbeCmd`. A non-zero probe exit writes `FAIL` and skips the gate.
- Gate: up to 5 `sh -c "$qualityGateCmd"` attempts, with stdout and stderr on one fd, appended to the log.
  - Retry only when the attempt output matches `SQLiteError: database is locked|SQLite database .*is busy|SQLITE_BUSY`.
  - Each retry prints `quality gate: database is locked; retrying (n/5) in 10s` and appends it to the log.
  - The 10-second delay is injectable for tests.
- On PASS it prints `quality gate PASS (attempts: N; log: L; bytes: B)`.
- On FAIL it prints `quality gate FAIL — last 40 lines follow (full log: L)`, then the last 40 log lines.
- Findings: the unique matches of `[A-Za-z0-9_./-]+\.[A-Za-z]+:[0-9]+` in the log, sorted by code unit, first 20, each followed by one space.
- It writes `PASS` or `FAIL` to the status file, appends `proof-digest: <proofDigest>` to the log and exits 0.

**Condensed programs.** Write each exactly as below. Put the reason as a YAML comment directly above `- kind: shell` (or above `guard:`). Never write it as a shell `#` line inside the `>-` scalar: folding joins lines, so the `#` would comment out the rest of the program. YAML comments do not count toward `command.length`.

- `precheck:onEnter:0`, reason `# (e) git-status hygiene advisory; never fails the run`:

```sh
D=$(git status --porcelain -- . ':(exclude)docs/tasks*' ':(exclude)docs/features' 2>/dev/null); [ -z "$D" ] || printf 'precheck: WARNING - working tree has uncommitted non-corpus changes — commit or stash before starting a new task:\n%s\n' "$D"; C=$(git status --porcelain -- ':(glob)docs/tasks*/**' 2>/dev/null); [ -z "$C" ] || printf 'precheck: NOTE - task corpus has uncommitted changes — review before staging with this task:\n%s\n' "$C"; exit 0
```

- `precheck:onEnter:2`, reason `# (e) auto-profile feature reopen; exit 1 when reactivation fails (0723 R3)`:

```sh
[ "$profile" = auto ] || exit 0; FID=$($spurBin task show $wbs --json 2>/dev/null | jq -r '.feature_id // .frontmatter.feature_id // empty' 2>/dev/null); [ -z "$FID" ] || $spurBin feature sync "$FID" --force 2>/dev/null || $spurBin feature update "$FID" active 2>/dev/null || { echo "precheck: FAIL - feature reactivation $FID failed — feature sync + feature update both errored" >&2; exit 1; }; exit 0
```

- `precheck:onEnter:3`, reason `# (d) task-size-precheck.ts owns the check; shell only resolves it and fails closed`. The `"FAIL"` literal keeps its double quotes for the resilience pin.

```sh
mkdir -p .spur/run; S=plugins/sp/scripts/task-size-precheck.ts; [ -f "$S" ] || S="$(superskill script path sp task-size-precheck.ts 2>/dev/null)"; if [ -f "$S" ]; then bun "$S" "$wbs" --spur-bin "$spurBin" --max-reqs "$maxImplementReqs" --max-plan-items "$maxImplementPlanItems"; else echo "task-size-precheck failed closed — checker not found in plugins/sp/scripts/ nor staged — run 'superskill install sp'." >&2; echo "FAIL" > ".spur/run/$wbs-precheck-size.status"; fi; exit 0
```

- `precheck:onEnter:4`, reason `# (d) task-evidence-precheck.ts owns the check; shell only resolves it and fails closed`:

```sh
mkdir -p .spur/run; S=plugins/sp/scripts/task-evidence-precheck.ts; [ -f "$S" ] || S="$(superskill script path sp task-evidence-precheck.ts 2>/dev/null)"; if [ -f "$S" ]; then bun "$S" "$wbs" --spur-bin "$spurBin"; else echo "task-evidence-precheck failed closed — checker not found in plugins/sp/scripts/ nor staged — run 'superskill install sp'." >&2; echo "FAIL" > ".spur/run/$wbs-precheck-evidence.status"; fi; exit 0
```

- `precheck:onEnter:5`, reason `# (e) route-reason lookup and routes log; proportional-routing tests locate it`. It keeps the `REASON_FILE=` literal that the proof-chain :484 locator finds.

```sh
mkdir -p .spur/run .spur/memory; RUN_ID="${__runId:-pipeline-$wbs}"; case "$RUN_ID" in *'$'*|*'{'*|*'}'*|*vars.*|*/*|*'\'*|*..*) echo "route-reason: refusing unsafe run id: $RUN_ID" >&2; exit 1 ;; esac; REASON_FILE=".spur/run/$RUN_ID-route-reason.txt"; jq -rn --arg m "$mode" '{"fast":"fast:evidence complete+consistent","":"safety:standard verification","unknown":"safety:unknown evidence quality","conflict":"safety:conflicting evidence"}[$m] // "safety:unrecognized evidence (mode=\($m))"' > "$REASON_FILE"; printf '%s %s %s\n' "$RUN_ID" "$wbs" "$(cat "$REASON_FILE")" >> .spur/memory/task-pipeline-routes.log; exit 0
```

- `test:onEnter:6`, reason `# (d) quality-gate.ts owns the gate; shell only resolves it and fails closed`:

```sh
mkdir -p .spur/run; if [ -f plugins/sp/scripts/quality-gate.ts ]; then bun plugins/sp/scripts/quality-gate.ts run; elif Q="$(superskill script path sp quality-gate.mjs 2>/dev/null)" && [ -f "$Q" ]; then node "$Q" run; else echo "quality gate failed closed — quality-gate script not found — run 'superskill install sp'" >&2; printf 'FAIL\n' > ".spur/run/$wbs-test-gate.status"; fi; exit 0
```

- `test-recheck:onEnter:1`, reason `# (d) quality-gate.ts owns the recheck; shell only resolves it and fails closed`. It is the `test:onEnter:6` program with `run` replaced by `recheck` in both invocations.
- `test-fix:onEnter:0` (clean, no reason):

```sh
TASK_POLICY=$($spurBin task show "$wbs" --json | jq -er '.frontmatter.mutationPolicy // ([.content | scan("(?m)^mutationPolicy:[ \t]*([^ \r\n]+)[ \t]*$") | .[0]] | if length == 0 then "code" elif length == 1 then .[0] else "ambiguous" end)') || exit 1; [ "$mutationPolicy:$TASK_POLICY" = "code:code" ] || { echo "test-fix: mutation policy forbids automatic code repair (run=$mutationPolicy, task=$TASK_POLICY) — gate failure preserved, no agent dispatched" >&2; exit 1; }
```

- `test-fix:onEnter:1`, reason `# (e) fixall attempt counter and verdict hand-off to the remediation log`:

```sh
mkdir -p .spur/run; A=".spur/run/$wbs-test-fix-attempt"; n=$(cat "$A" 2>/dev/null); printf '%s\n' "$((${n:-0} + 1))" > "$A"; [ ! -f ".spur/run/$wbs-verdict.json" ] || { echo '--- verify verdict (remediation input, task 0703 R4) ---'; cat ".spur/run/$wbs-verdict.json"; } >> ".spur/run/$wbs-test-gate.log"; exit 0
```

- `verify:onEnter:4`, reason `# (e) one jq mutation binds the verdict to the proof digest`:

```sh
V=".spur/run/$wbs-verdict.json"; [ -f "$V" ] && [ -n "$proofDigest" ] || exit 0; jq --arg d "$proofDigest" --arg r "$__runId" --arg dd "$__definitionDigest" --arg rp "$(cat .spur/run/$__runId-review-proof.digest 2>/dev/null)" --arg g "$(cat .spur/run/$wbs-test-gate.status 2>/dev/null || echo UNKNOWN)" '. + {proof: {digest: $d, runId: $r, definitionDigest: $dd, capturePoint: "quality-gate-entry", stages: {qualityGate: {status: $g, digest: $d}, review: {status: (if $rp == $d then "completed" else "skipped" end), digest: $d}, verification: {status: .verdict, digest: $d}}}} | .checks += [{name: "proof-input-digest", status: "pass", evidence: $d}]' "$V" > "$V.tmp" && mv "$V.tmp" "$V"; exit 0
```

- `record:onEnter:2`, reason `# (d) feature-sync-bounded.ts owns the sync; shell adds the orphan note and fallbacks`. The orphan note's `; proposal` becomes ` — proposal`; no test pins it.

```sh
FID=$($spurBin task show $wbs --json 2>/dev/null | jq -r '.feature_id // .frontmatter.feature_id // empty' 2>/dev/null); if [ -z "$FID" ]; then echo "Orphan task $wbs — no feature_id linked — proposal: consider linking to a parent feature." >> ".spur/run/$wbs-report.txt"; elif [ -f plugins/sp/scripts/feature-sync-bounded.ts ]; then bun plugins/sp/scripts/feature-sync-bounded.ts "$FID" --spur-bin "$spurBin" --json; elif M="$(superskill script path sp feature-sync-bounded.mjs 2>/dev/null)" && [ -f "$M" ]; then node "$M" "$FID" --spur-bin "$spurBin" --json; else $spurBin feature sync "$FID" --json; fi; exit 0
```

- `done:onEnter:2`, reason `# (e) advisory terminal checkpoint, one printf`. It drops the `CP_DIGEST`/`CP_RUN` aliases; the checkpoint lines are unchanged.

```sh
mkdir -p .spur/memory/sessions; CP_TS="$(date -u +%Y-%m-%dT%H:%M:%SZ)"; CP_COMMIT="$(git rev-parse HEAD 2>/dev/null || echo unknown)"; printf '%s\n' '---' 'schema_version: 1' "session_id: $(date -u +%Y-%m-%d)-$wbs" 'workflow: task-pipeline' "run_id: $__runId" "task_wbs: $wbs" 'feature_id: ""' 'phase: done' 'status: done' 'last_gate: record' "source_commit: $CP_COMMIT" "digest: $proofDigest" "generated_at: $CP_TS" "updated_at: $CP_TS" "next_action: none - task $wbs complete (terminal; advisory only)" 'artifacts:' "  - .spur/run/$wbs-verdict.json" "  - .spur/run/$wbs-test-gate.log" '---' '' '## Session Notes' '' "Terminal checkpoint for task $wbs (task-pipeline done)." 'Advisory only; the task file is authoritative.' > .spur/memory/sessions/$wbs-checkpoint.md; exit 0
```

**Guards.**
- `verify→record` becomes one predicate over the verdict file. It checks what the 9-command guard checked: a PASS verdict; proof, quality-gate, review and verification digests equal to `proofDigest`; review status `completed`; matching run id and definition digest.

```sh
jq -e --arg d "$proofDigest" --arg r "$__runId" --arg dd "$__definitionDigest" '.verdict == "PASS" and (.proof.digest // "") == $d and (.proof.stages.qualityGate.digest // "") == $d and (.proof.stages.review.digest // "") == $d and (.proof.stages.review.status // "") == "completed" and (.proof.stages.verification.digest // "") == $d and (.proof.runId // "") == $r and (.proof.definitionDigest // "") == $dd' ".spur/run/$wbs-verdict.json" >/dev/null 2>&1
```

- `verify→test-fix` keeps its program. Add `# (e) remediation route: verdict not PASS and fix attempts below qualityGateMaxFixAttempts` above its `guard:`.

**Output checks.**
- `review:onEnter:0`: add `answerFile` and `expectFile`, both `.spur/run/${vars.__runId}-review-answer.txt`.
- `test-fix:onEnter:3` (was `:2`): add both, set to `.spur/run/${vars.__runId}-test-fix-answer.txt`.
- The engine writes `answerFile` before the `expectFile` check. The check proves that an answer was captured. Quality stays with the review proof digest and the verify verdict.

**Ownership doc.** In `docs/design/workflow-shell-ownership.md`, replace the task-pipeline table (:180-198) with these rows and drop the `retry_transient` follow-up wording:

| Program | Disposition | Reason |
| --- | --- | --- |
| `precheck:onEnter:0` | GLUE | git-status hygiene WARNING/NOTE; advisory |
| `precheck:onEnter:2` | GLUE | auto-profile feature reopen; a failed reactivation exits 1 (0723 R3) |
| `precheck:onEnter:3` | EXT | wrapper for `task-size-precheck.ts` (option d); a missing checker writes FAIL |
| `precheck:onEnter:4` | EXT | wrapper for `task-evidence-precheck.ts` (option d); a missing checker writes FAIL |
| `precheck:onEnter:5` | GLUE | route-reason lookup + routes log |
| `implement:onEnter:1` | BUILTIN | `command.gate` `task update wip --no-lifecycle` with transient retry |
| `implement:onEnter:2` | POLICY | `$formatCmd ; exit 0`; project-only formatter, best-effort |
| `test:onEnter:6` | EXT | wrapper for `quality-gate.ts run` (option d); runs the per-project `qualityGateCmd` |
| `test-fix:onEnter:0` | GLUE | mutation-policy gate |
| `test-fix:onEnter:1` | GLUE | fixall attempt counter + verdict hand-off |
| `test-recheck:onEnter:1` | EXT | wrapper for `quality-gate.ts recheck`; `gateProbeCmd` fast path, then `qualityGateCmd` |
| `verify:onEnter:2` | EXT | wrapper for `verify-answer-lint.ts` (option d) |
| `verify:onEnter:3` | SIMPLE | single `task verdict --from-answer` |
| `verify:onEnter:4` | GLUE | proof-digest injection into the verdict json (one jq mutation) |
| `record:onEnter:1` | BUILTIN | `command.gate` `task record --solution-from-diff --transition testing` with transient retry |
| `record:onEnter:2` | EXT | `feature-sync-bounded.ts` (option d) + `feature sync` fallback + orphan note |
| `done:onEnter:0` | BUILTIN | `command.gate` `task update done --no-lifecycle` with transient retry |
| `done:onEnter:2` | GLUE | terminal checkpoint write |

**Test migration.**

| Suite | Change |
| --- | --- |
| `plugins/sp/tests/task-pipeline-resilience.test.ts` | Tests :219/:241 (`commandFor('implement'\|'record')`, sleep 2) and :233/:252 (the bun-install hint) become assertions on the three `command.gate` options. The db-lock and sleep-10 tests (:255, :266, :278, :281, :289, :335, :353) move to `quality-gate.test.ts`. The pins at :84-98, :110-117, :137, :166-205 and :312-330 stay. |
| `plugins/sp/tests/quality-gate.test.ts` (new) | The contract cases above, in a temp cwd with `<repo>/plugins` symlinked and the delay injected. |
| `packages/app/tests/workflow/actions/command-gate.test.ts` | `SQLite database … is busy` output retries under `sqlite-busy`. |
| `packages/app/tests/workflow/task-pipeline-proof-chain.test.ts` | :336 asserts the new `jq -e` guard. :378-460 become `command.gate` option assertions plus `quality-gate.test.ts` cases. :79, :87, :319-321, :477 and :484 stay. |
| `packages/domain/tests/planning/lifecycle-drift.test.ts` | R2 (:232) filters out commands containing `quality-gate.ts`, since the gate never shells spur. R3 (:250) part 1 asserts the `test`/`test-recheck` wrappers call `quality-gate.ts run`/`recheck` and that the `quality-gate.ts` source contains `-test-gate.log`, `-test-gate.findings` and the 20-anchor bound. Parts 2–3 stay. |
| Unchanged; run to confirm | `plugins/sp/tests/task-evidence-precheck.test.ts` (:282), `plugins/sp/tests/inline-pipeline-driver.test.ts` (:295, :303), `scripts/commands/eval-pipeline.test.ts` (:158-227), `plugins/sp/tests/verify-answer-lint.test.ts` (:459), `plugins/sp/tests/inline-run-setup.test.ts`, `packages/app/tests/services/inline-run-setup.test.ts`, `packages/app/tests/workflow/composition-baseline.test.ts`, `packages/app/tests/workflow/task-pipeline-proportional-routing.test.ts`, `packages/app/tests/workflow/proportional-routing-pilots.test.ts`. |

**Invariants.**
- State ids and transitions (`from`, `to`, `guard.kind`) are identical before and after. Compare them by parsing the YAML with the `yaml` package. `workflow show --format mermaid` includes actions, so it is not the check.
- The model queries stay `implement`, `test-fix`, `review`, `verify` (composition-baseline pins).
- Status files and test-pinned text keep their form: the `"FAIL"` writes, `REASON_FILE=`, `route-reason`, `routes.log` and the checkpoint lines.
- Adopting projects keep the semantics of `qualityGateCmd`, `gateProbeCmd`, `qualityGateMaxFixAttempts` and `formatCmd`.
- `collectUndeclaredShellVarViolations` stays clean. New locals are assigned in the program or are UPPER_SNAKE, and jq variables sit inside single quotes.

**Rejected.**
- Raising the cap for this pipeline: that needs an ADR-115 amendment and reverses the direction.
- Folding a program onto one long line: the 800-character cap catches it.
- A probe action plus a result file for the verify guards (`run.artifact` or an extension guard): the verdict already carries the proof, and one `jq -e` measures 1.
- An application service for the quality gate: the logic is task-pipeline-only. A plugin script keeps adopting projects on the shipped wrapper, with no new public verb.
- A shared `retry_transient` shell helper: `command.gate` already owns retry.

### Plan

1. Record the baseline (R1). Save `spur workflow validate config/workflows/task-pipeline.yaml --json`, and the state ids plus transitions (`from`, `to`, `guard.kind`) parsed with the `yaml` package from the repo root, under `.spur/run/0823-baseline.*`.
2. Retry class (R1). Add the `SQLite database … is busy` case to `packages/app/tests/workflow/actions/command-gate.test.ts`, watch it fail, then extend the `sqlite-busy` regex at `command-gate.ts:61`.
3. Quality gate (R1).
   - Write `plugins/sp/tests/quality-gate.test.ts`: the Design contract cases and the moved resilience tests.
   - Implement `plugins/sp/scripts/quality-gate.ts`.
   - Register it in `config/plugin-scripts.json` and `build:scripts`, then run `bun run build:scripts`.
4. Edit `config/workflows/task-pipeline.yaml` (R1):
   - the three `command.gate` transitions;
   - the `test`/`test-recheck` wrappers;
   - the condensed programs and the `test-fix` split;
   - the `verify→record` guard;
   - the YAML-comment reasons;
   - the `review` and `test-fix` output checks.
5. Migrate the assertions per the Design test-migration table.
6. Rewrite the task-pipeline table in `docs/design/workflow-shell-ownership.md`.
7. Verify:
   - `validate --json` shows no error-level finding, no `agent-run-output` finding and no var-ref violation;
   - the parsed state and transition list equals the baseline;
   - the focused suites from the Design table pass (`bun test <paths>` from the repo root);
   - run `bun run --filter @gobing-ai/spur build:bundle`, then `bun run spur-check`.

### Solution

Change-map (auto-generated — implement step did not record a Solution).
Each entry cites the first changed line per file (`file:line`).

| Change (`file:line`) |
|----------------------|
| `packages/app/src/workflow/actions/command-gate.ts:61` |
| `packages/app/tests/workflow/actions/command-gate.test.ts:272` |
| `packages/app/tests/workflow/task-pipeline-proof-chain.test.ts:2` |
| `packages/app/tests/workflow/task-pipeline-proof-chain.test.ts:224` |
| `packages/app/tests/workflow/task-pipeline-proof-chain.test.ts:338` |
| `packages/app/tests/workflow/task-pipeline-proof-chain.test.ts:341` |
| `packages/app/tests/workflow/task-pipeline-proof-chain.test.ts:348` |
| `packages/app/tests/workflow/task-pipeline-proof-chain.test.ts:359` |
| `packages/app/tests/workflow/task-pipeline-proof-chain.test.ts:377` |
| `packages/app/tests/workflow/task-pipeline-proof-chain.test.ts:398` |
| `packages/app/tests/workflow/task-pipeline-proportional-routing.test.ts:127` |
| `packages/app/tests/workflow/task-pipeline-proportional-routing.test.ts:131` |
| `packages/domain/tests/planning/lifecycle-drift.test.ts:184` |
| `packages/domain/tests/planning/lifecycle-drift.test.ts:210` |
| `packages/domain/tests/planning/lifecycle-drift.test.ts:226` |
| `packages/domain/tests/planning/lifecycle-drift.test.ts:232` |
| `packages/domain/tests/planning/lifecycle-drift.test.ts:260` |
| `packages/domain/tests/planning/lifecycle-drift.test.ts:285` |
| `packages/domain/tests/planning/lifecycle-drift.test.ts:291` |
| `packages/domain/tests/planning/lifecycle-drift.test.ts:295` |
| `plugins/sp/tests/inline-pipeline-driver.test.ts:235` |
| `plugins/sp/tests/task-pipeline-resilience.test.ts:211` |
| `plugins/sp/tests/task-pipeline-resilience.test.ts:242` |
| `plugins/sp/tests/task-pipeline-resilience.test.ts:262` |
| `plugins/sp/tests/task-pipeline-resilience.test.ts:287` |

Re-audit fix (R1, 2026-09-12): `plugins/sp/scripts/quality-gate.ts:115` captures both streams through one file descriptor to preserve ordering and avoid the subprocess pipe-buffer cap; the Superskill-generated twin is `plugins/sp/scripts/quality-gate.mjs:57`. `plugins/sp/tests/quality-gate.test.ts:224` checks interleaved output and a 2 MiB capture. `docs/design/workflow-shell-ownership.md:200` owns the capture contract. The regression failed before the fix; all 13 quality-gate tests pass afterward.

### Testing

**Pipeline verify results**

- Verdict: PASS (from verdict artifact)

| Requirement | Status | Evidence |
|-------------|--------|----------|
| R1 | MET | Task graph and four model queries preserved; caps/output checks pass. Quality-gate capture now preserves stream order beyond 1 MiB; retries, proof chain and wrapper failures remain checked. `plugins/sp/scripts/quality-gate.ts:115`; `plugins/sp/tests/quality-gate.test.ts:223`; `packages/app/tests/workflow/task-pipeline-proof-chain.test.ts:40`; `plugins/sp/tests/task-pipeline-resilience.test.ts:245`. Executed: `bun run spur-check` (exit 0). |

| Acceptance Criteria | Status | Evidence Type | Evidence |
|---------------------|--------|---------------|----------|
| Scenario: R1 — task-pipeline stays within the composition budgets | MET | test | Task graph and four model queries preserved; caps/output checks pass. Quality-gate capture now preserves stream order beyond 1 MiB; retries, proof chain and wrapper failures remain checked. `plugins/sp/scripts/quality-gate.ts:115`; `plugins/sp/tests/quality-gate.test.ts:223`; `packages/app/tests/workflow/task-pipeline-proof-chain.test.ts:40`; `plugins/sp/tests/task-pipeline-resilience.test.ts:245`. Executed: `bun run spur-check` (exit 0). |
- Coverage: N/A (verdict-based; verify pipeline does not measure code coverage)

### Review

<!-- spur:record-review -->

**SECU findings** (pipeline verify step — verdict: PASS)

| Priority | Dimension | Location | Finding |
|----------|-----------|----------|----------|
| P4 | spur task check | — | task check passed |
| P4 | design-conformance | — | Requirements, Design and Plan mapped to current implementations and tests; documented extraction choices preserved. |
| P4 | quality-gate | — | `bun run spur-check` exit 0; final log `.spur/run/I21-verifyall-20260912/spur-check-final.log`. |
| P4 | build-and-cloudflare | — | build:scripts, CLI/server/web builds, build:bundle and test-cf exited 0. |
| P4 | secua-review | — | All five dimensions checked; re-audit fixes on 0819, 0823 and 0825 have red/green regression evidence. |
| P4 | artifact-disclosure | — | Rebuilt `.spur/run/0823-verify-answer.txt:1-33` and `.spur/run/0823-verdict.json` from fresh evidence; Testing rendered by task record. |
| P4 | workflow-audit | — | `bun .spur/run/I21-verifyall-20260912/workflow-audit.ts` exit 0: 11 definitions validate; eight graphs and dry-run outcomes equal pre-extraction baselines. |
| P4 | evidence-rule-pass | — | All behavior-bearing AC rows have executable evidence or are explicitly non-behavioral. |

### References

<!-- Links to the parent feature, design docs, related tasks, or external references. -->

### History

- 2026-09-11T22:02:11.947Z todo → wip (system)
- 2026-09-11T23:12:16.986Z wip → testing (system)
- 2026-09-11T23:12:17.833Z testing → done (system)

