---
schema_version: 1
name: feature-dev, pr-review, wayfinder, docs and basic stay within the composition budgets
status: done
template: feature-impl
created_at: 2026-09-10T23:51:14.074Z
updated_at: "2026-09-13T05:50:34.910Z"
feature_id: I21
priority: P2
tags:
  - workflow
  - composition

ac_numbering: task-local
dependencies: ["0822"]
---

## 0825. feature-dev, pr-review, wayfinder, docs and basic stay within the composition budgets

### Background

Measured 2026-09-11 with 0822's `countLogicalCommands` (commands / characters). A shell program warns at 6–10 commands and errors above 10 commands or 800 characters; a guard warns at 4–5 lines and errors above 5.
- `feature-dev.yaml`: shell actions `precheck:0` (43/2510), `feature-verify:0` (16/618) and `integration-review:0` (26/1258) are error-level. The `execute-tasks-auto:1` and `execute-tasks:1` `agent.run` steps have no output check.
- `pr-review.yaml`: `precheck:0` (12/314), `request:0` (17/786) and `collect:2` (16/685) are error-level. `preflight:0`, `hygiene:0`, `push:0`, `ensure-pr:0`, `wait:2` and the `request→pending` guard sit in the warn band.
- `wayfinder-resolution.yaml`: `precheck:0` (12/371) is error-level, and the `investigate` input is 1139 characters and not a slash command. `verify:1`, `verify:6` and the `verify→record` guard sit in the warn band.
- `docs-pipeline.yaml`: the `verify→record` guard (8 lines/491) is error-level, and `verify:6` has an `answerFile` but no `expectFile`. `verify:1`, `verify:3`, `verify:8` and the `record→done` guard sit in the warn band.
- `basic.yaml`: the `fix:1` `agent.run` has no output check, and `check:0` (10/252) sits in the warn band.

`integration-review:0` also carries a live defect. Its collect call wraps `--status-file "$COLLECT_STATUS"` onto a more-indented `>-` line. YAML keeps that newline, so the shell runs the flag as a command of its own (`--status-file: command not found`, rc 127). Collect never writes its status, so a run with `requireCleanReview=true` always blocks. A scan of every shipped workflow found no other command split this way.

Implements:
- R23 — feature-dev, pr-review, wayfinder, docs and basic stay within the composition budgets

Ordering: after the validator task. Grouped as the rest of the catalog; each workflow's share is small.

### Requirements

- [x] R1. `spur workflow validate --json` on `feature-dev.yaml`, `pr-review.yaml`, `wayfinder-resolution.yaml`, `docs-pipeline.yaml` and `basic.yaml` reports no error-level composition finding and no `agent-run-output` finding. Over-cap programs and the docs `verify→record` guard move to owners from the closed fix vocabulary (governance §1.1 (a)–(d)); a stays-shell reason (e) is valid only inside the warn band. Every remaining warn-band program, guard and non-slash `agent.run` input carries a one-line reason as a YAML comment directly above it. The `investigate` prompt body moves into an `sp:wayfinder` skill reference, and its input carries only the operation, its vars and the bundle path. The two `execute-tasks` steps and basic `fix` declare an `answerFile` equal to their `expectFile`, and docs `verify:6` adds an `expectFile` equal to its `answerFile`. Routes, `.spur/run` artifacts, status values, exit semantics and test-pinned messages stay the same, with two exceptions: the integration-review collect now receives its `--status-file`, and a seeded project without the `sp` plugin fails closed at the feature-dev precheck. Existing workflow assertions pass, moved with the logic they pin. The `run --dry-run` graphs are unchanged, `build:bundle` parity holds and no model query is added. A new public `spur` verb or flag lands only with its own consent entry.

Non-goals:
- `stateEffect`/`evidenceEffect` declarations. The progress projection hard-codes them and ADR-115 asks for none.
- Clearing warn-band findings. Each may remain with its reason.
- Changing integration review's advisory semantics (D5-P) or pr-review's pending/unavailable handling.
- task-pipeline (0823), idea and wrap-up (0824), the `spur-check` gate and budget coverage (0826).
- Pipeline budget changes.
- The docs precheck status path. `precheck:2` writes `.spur/run/$__runId-docs-precheck.status`, but the `precheck→draft` guard (`docs-pipeline.yaml:266`) reads `.spur/run/$wbs-docs-precheck.status`. That routing defect is deferred to its own task.

### Acceptance Criteria

```gherkin
Feature: feature-dev, pr-review, wayfinder, docs and basic stay within the composition budgets

  Scenario: R1 — feature-dev, pr-review, wayfinder, docs and basic stay within the composition budgets
    Given feature-dev.yaml, pr-review.yaml, wayfinder-resolution.yaml, docs-pipeline.yaml and basic.yaml in config/workflows
    When `spur workflow validate --json` runs on each
    Then none reports an error-level composition finding
    And every agent.run action declares expectFile or requireDiff
    And their workflow tests pass and their `run --dry-run` graphs are unchanged
```

### Q&A

<!-- CLOSED decisions from refinement: what was chosen and why, what was deferred and on what
     condition. Not a parking lot for open questions — an unanswered question here means the task
     is not ready to hand off. Keep empty if none. -->

#### Q&A entry — 2026-09-11T15:40:17.353Z

Refined at depth=ready (refineall I21, 2026-09-10). Closed decisions:
- **Consent granted 2026-09-10** (governance §4) for behavior-preserving edits to the shared workflows and for the new plugin script `feature-dev-precheck.ts`. No public verb or flag changes.
- **Effects dropped.** The old R1 kept "the docs proof chain's effect declarations", but `docs-pipeline.yaml` declares none and ADR-115 asks for none. The `verify→record` and `record→done` guards enforce the proof chain.
- **Frozen programs.** The Design programs and inputs were measured with 0822's helper on 2026-09-11 and diffed against the current programs in a stub harness. The tightest margins are `request:0` at 10 of 10 commands, `integration-review:1` at 734 of 800 chars and the wayfinder SKILL.md at 26255 of its 26264-byte baseline. Re-measure after any edit.
- **Warn-band reasons are YAML comments** directly above the action (the last line of any existing block) or above the transition's `guard:` key, never shell `#` lines inside a `>-` scalar. pr-review comments avoid the literals `pr-reviewing.test.ts` pins against the raw file.
- **Output checks are `answerFile` = `expectFile`.**
  - The child chooses the runall batch report path, so it cannot be the `expectFile`. `requireDiff` does not fit basic `fix`, because fixall may leave no diff.
  - The check proves an answer was captured, not its quality, as with 0824's `ready-prepare`.
  - The relative `expectFile` appends the 0689 absolute-path hint after the slash args; wayfinder `verify:4` dispatches the same shape today. Capture does not change streaming.
- **feature-dev precheck is a plugin script, not a condensed shell.** Its roster checks cannot fit 10 commands. Seeded projects need the `sp` plugin: without it, the wrapper records FAIL with a `superskill install sp` hint. Its `execute-tasks` hops already dispatch `/sp:dev-runall`, so such a project could not run the batch anyway.
- **Integration-review collect fix.** Splitting the program also fixes the folded-line defect. Behavior changes only where collect runs: the collect status now exists, so `requireCleanReview=true` can pass on a CLEAN review. No test pinned the old, always-missing status.
- **pr-review `request:0`.** The old `[ -f ".spur/run/$__runId-pr-request.json" ]` test was always true, because the redirect creates the file. The `jq -e .` guard keeps the old `JSON.parse` outcome for an unreadable record: the since and head files are not written. The new program matched the current one in 6 of 6 diff cases.
- **Test migration.** Assertions follow the logic they pin. The feature-dev dispatch-equality checks compare first lines, because the hint follows the slash args.
- **R44 measures SKILL.md only.** `references/pipeline-resolution.md` sits outside the byte budget; only the 52-byte pointer counts.
- **Docs precheck status path deferred.** `precheck:2` and the `precheck→draft` guard name different files. That routing defect is unrelated to the composition caps, and fixing it here would change a route.

### Design

**Approach.** Each over-cap program and the docs `verify→record` guard get one owner from the governance §1.1 fix vocabulary; everything else in the five workflows stays as it is. States, transitions and guard kinds stay unchanged. `integration-review` gains a second shell action, but actions are not graph nodes. The programs below are frozen text, measured with 0822's `countLogicalCommands` on 2026-09-11 and diffed against the current programs in a stub harness. A program may wrap across `>-` lines only at a single space and only onto a line with the same indent. YAML keeps the newline before a more-indented line, and the shell then runs that line as a separate command; that is the integration-review defect. Add or remove no other character. Where this Design is silent, the current program is the reference for messages, arguments and file names.

**Owner map.**

| Before | Measured | Owner | After (cmds / chars) |
| --- | --- | --- | --- |
| feature-dev `precheck:0` | 43 / 2510 | (d) `feature-dev-precheck.ts` plugin script plus a wrapper | 9 / 434, warn |
| feature-dev `feature-verify:0` | 16 / 618 | (e) condensed | 9 / 510, warn |
| feature-dev `integration-review:0` | 26 / 1258 | (e) split into a request program and a collect program | `:0` 5 / 374, clean; `:1` 8 / 734, warn |
| pr-review `precheck:0` | 12 / 314 | (e) condensed | 7 / 178, warn |
| pr-review `request:0` | 17 / 786 | (e) condensed | 10 / 624, warn |
| pr-review `collect:2` | 16 / 685 | (e) condensed | 9 / 550, warn |
| wayfinder `precheck:0` | 12 / 371 | (e) condensed | 8 / 282, warn |
| wayfinder `investigate` input | 1139 chars | skill reference | 260 chars, non-slash warn |
| docs `verify→record` guard | 8 / 491 | (e) condensed | 4 / 235, guard warn |
| feature-dev `execute-tasks-auto:1`, `execute-tasks:1`; basic `fix:1` | no output check | `answerFile` = `expectFile` | — |
| docs `verify:6` | `answerFile` only | `expectFile` = `answerFile` | — |
| pr-review `preflight:0`, `hygiene:0`, `push:0`, `ensure-pr:0`, `wait:2`, `request→pending` guard; wayfinder `verify:1`, `verify:6`, `verify→record` guard; docs `verify:1`, `verify:3`, `verify:8`, `record→done` guard; basic `check:0` | warn band | (e) unchanged | reason comment only |

**Frozen programs.** Each one replaces the whole `command:` of its action or guard. Each YAML reason comment sits directly above its `- kind:` line, as the last line of any existing comment block.

feature-dev `precheck:onEnter:0`. The `note` action after it stays.

```yaml
      # (d) feature-dev-precheck.ts owns identity/roster validation and the frozen todo list; the wrapper only locates it and fails closed.
      - kind: shell
        options:
          command: >-
            mkdir -p .spur/run; if [ -f plugins/sp/scripts/feature-dev-precheck.ts ]; then bun plugins/sp/scripts/feature-dev-precheck.ts; elif W="$(superskill script path sp feature-dev-precheck.mjs 2>/dev/null)" && [ -f "$W" ]; then node "$W"; else echo "feature-dev precheck failed closed — feature-dev-precheck script not found — run 'superskill install sp'" >&2; printf 'FAIL\n' > ".spur/run/$__runId-feature-dev-precheck.status"; fi; exit 0
```

feature-dev `feature-verify:onEnter:0`, with the reason `# (e) one completion check per run (0782 R3); PASS needs exit 0 and every returned scope passing.`:

```sh
mkdir -p .spur/run; rm -f ".spur/run/$__runId-feature-dev-verify.status"; $spurBin feature check "$featureId" --as done --json > ".spur/run/$__runId-feature-dev-verify.json" 2>&1 && jq -e 'type == "array" and length > 0 and all(.[]; .pass == true)' ".spur/run/$__runId-feature-dev-verify.json" > /dev/null 2>&1 && R=PASS || R=FAIL; printf '%s\n' "$R" > ".spur/run/$__runId-feature-dev-verify.status.tmp" && mv -f ".spur/run/$__runId-feature-dev-verify.status.tmp" ".spur/run/$__runId-feature-dev-verify.status"
```

feature-dev `integration-review:onEnter:0` and `:1` replace the combined program (`feature-dev.yaml:214-243`). The `note` action becomes `:2`, and the state description stays.
- `:0`, the request. It is clean, so it needs no reason.

  ```sh
  mkdir -p .spur/run; bun "$(superskill script path sp pr-reviewing.ts)" request --base "$baseBranch" --json --status-file ".spur/run/$__runId-integration-review-pr-request.status" > ".spur/run/$__runId-integration-review.json" 2>&1 && printf 'PASS\n' > ".spur/run/$__runId-integration-review.status" || printf 'FAIL\n' > ".spur/run/$__runId-integration-review.status"; exit 0
  ```

- `:1`, the collect, with the reason `# (e) one advisory collect against the captured head (D5-P); the branches carry the recorded messages.`:

  ```sh
  if H=$(jq -er '.head // empty | select(. != "")' ".spur/run/$__runId-integration-review.json" 2>/dev/null); then bun "$(superskill script path sp pr-reviewing.ts)" collect --head "$H" --json --status-file ".spur/run/$__runId-integration-review-collect.status" > ".spur/run/$__runId-integration-review-collect.json" 2>&1; rc=$?; echo "integration-review: collect rc=$rc status=$(cat ".spur/run/$__runId-integration-review-collect.status" 2>/dev/null || echo missing) — verdict captured to .spur/run/$__runId-integration-review-collect.json" >&2; else echo "integration-review: request result carried no head SHA — collect not run, recorded FAIL" >&2; printf 'FAIL\n' > ".spur/run/$__runId-integration-review-collect.status"; fi; exit 0
  ```

- The diff harness shows a difference only in the cases where collect runs, and only in the collect status file. That file now exists, so the `requireCleanReview` edges can see a CLEAN review.

pr-review `precheck:onEnter:0`, with the reason `# (e) runs the operator's preReviewCmd verbatim (POLICY); records SKIP/PASS/FAIL only.`:

```sh
mkdir -p .spur/run; if [ -z "$preReviewCmd" ]; then R=SKIP; elif sh -c "$preReviewCmd"; then R=PASS; else R=FAIL; fi; printf '%s\n' "$R" > ".spur/run/$__runId-pr-precheck.status"
```

pr-review `request:onEnter:0`, with the reason `# (e) one pr-reviewing.ts request call plus the one-time requestedAt/head extraction the wait and collect states read.`. It sits at 10 of 10 commands.

```sh
mkdir -p .spur/run; case "$mode" in rerun) F=--force ;; *) F= ;; esac; bun "$(superskill script path sp pr-reviewing.ts)" request --focus "$focus" $F --json --status-file ".spur/run/$__runId-pr-request.status" > ".spur/run/$__runId-pr-request.json"; [ -f ".spur/run/$__runId-pr-request.status" ] || printf 'FAIL\n' > ".spur/run/$__runId-pr-request.status"; jq -e . ".spur/run/$__runId-pr-request.json" > /dev/null 2>&1 && jq -r '.requestedAt // ""' ".spur/run/$__runId-pr-request.json" > ".spur/run/$__runId-pr-since.txt" && jq -r '.head // ""' ".spur/run/$__runId-pr-request.json" > ".spur/run/$__runId-pr-head.txt"; exit 0
```

pr-review `collect:onEnter:2`, with the reason `# (e) collect then composite status against the requested head; either failure records FAIL.`:

```sh
mkdir -p .spur/run; bun "$(superskill script path sp pr-reviewing.ts)" collect --since "$prSince" --head "$prHead" --json --status-file ".spur/run/$__runId-pr-collect.status" > ".spur/run/$__runId-pr-findings.json"; c=$?; bun "$(superskill script path sp pr-reviewing.ts)" status --since "$prSince" --head "$prHead" --json > ".spur/run/$__runId-pr-status.json" && [ "$c" -eq 0 ] && [ -f ".spur/run/$__runId-pr-collect.status" ] || printf 'FAIL\n' > ".spur/run/$__runId-pr-collect.status"; cat ".spur/run/$__runId-pr-findings.json" 2>/dev/null; exit 0
```

No pr-review comment may contain a literal that `pr-reviewing.test.ts:71-97` pins against the raw file: `pr-since.txt`, `pr-head.txt`, `kind: file.read.into-var`, `--since "$prSince"`, `--head "$prHead"`, `node -e` or `PAIR=`.

wayfinder `precheck:onEnter:0`, with the reason `# (e) task check plus the show capture that doubles as the investigate bundle; always exit 0.`:

```sh
mkdir -p .spur/run; $spurBin task check $wbs; c=$?; $spurBin task show $wbs --json > .spur/run/$__runId-wayfinder-input.json && [ "$c" -eq 0 ] && printf 'PASS\n' > .spur/run/$__runId-wayfinder-precheck.status || printf 'FAIL\n' > .spur/run/$__runId-wayfinder-precheck.status; exit 0
```

docs `verify→record` guard (`docs-pipeline.yaml:313-326`). Delete the `# Hardened (0703 P2 carry)…` comment (:316-317) and put the reason `# (e) fail-closed: both digests non-empty and equal, and the verdict's PASS is bound to proofDigest (0703 P2).` directly above `guard:`. The stub harness gives 0 for a bound PASS and 1 for FAIL, another digest, a malformed verdict, a missing verdict and empty vars.

```sh
test -n "$proofDigest" && test -n "$proofDigestNow" && test "$proofDigestNow" = "$proofDigest" && test "$(jq -r --arg d "$proofDigest" 'select(.proof.digest == $d) | .verdict // empty' ".spur/run/$wbs-verdict.json" 2>/dev/null)" = PASS
```

**Warn-band reasons** (YAML comments only, no program change):
- pr-review:
  - `preflight:0`: `# (e) one pr-reviewing.ts preflight call; rc maps to PASS/FAIL, all git/gh logic stays in the script.`
  - `hygiene:0`, `push:0` and `ensure-pr:0`: `# (e) one pr-reviewing.ts <verb> call; the script writes the status, the fallback records FAIL.`, with the real verb in place of `<verb>`.
  - `wait:2`: `# (e) one bounded pr-reviewing.ts wait call; the script writes the status, the fallback records FAIL.`
  - the `request→pending` guard: `# (e) status read plus the submit/noWait mode test; no probe runs here.`
- wayfinder:
  - `verify:1`: `# (e) fail-closed task-path lookup (0760 R1); exits 1 with a named message on a miss.`
  - `verify:6`: `# (e) stamps the proof block into the verdict artifact; the verify→record guard fails closed on a missing stamp.`
  - the `verify→record` guard: `# (e) auto approval, proof bracket and PASS verdict read from captured state; no probe runs here.`
- docs:
  - `verify:1`: the wayfinder `verify:1` reason.
  - `verify:3`: `# (e) fail-closed feature-spec lookup (0785 R2); an orphan task legitimately resolves empty.`
  - `verify:8`: the wayfinder `verify:6` reason.
  - the `record→done` guard: `# (e) captured record status plus the persisted verdict and digest re-assertion (0769); reads files only.`
- basic `check:0`: `# (e) runs the operator's qualityGateCmd verbatim (POLICY); records PASS/FAIL only.`

**Output checks.**
- feature-dev `execute-tasks-auto:onEnter:1` (:142-148) and `execute-tasks:onEnter:1` (:161-167) gain `answerFile` and `expectFile`, both `.spur/run/${vars.__runId}-feature-dev-runall-answer.txt`. The input stays the pure slash command.
- basic `fix:onEnter:1` (:82-88) gains `answerFile` and `expectFile`, both `.spur/run/${vars.__runId}-basic-fix-answer.txt`. `basic.yaml:37` already declares `__runId`.
- docs `verify:onEnter:6` (:184-193) adds `expectFile: .spur/run/${vars.__runId}-docs-verify-answer.txt`, equal to its `answerFile`. Its input stays.
- The runtime facts this relies on (`packages/app/src/workflow/actions/agent-run.ts`):
  - `answerFile` implies capture. The answer file is written before the `expectFile` check, even when stdout is empty.
  - Capture only adds the answer to the result data. The non-interactive path already captures stdout, so streaming is unchanged.
  - A relative `expectFile` or `answerFile` appends `\n\nWrite the required artifact to this absolute path: <abs>` to the input, slash inputs included (precedent: wayfinder `verify:4`). The first dispatched line is still the slash command.

**Skill reference (wayfinder `investigate`).**
- New `plugins/sp/skills/wayfinder/references/pipeline-resolution.md`; the `references/` directory is new. It carries the current `investigate:onEnter:0` input (`wayfinder-resolution.yaml:89-104`) as reference prose:
  - the inputs: the prepared bundle `.spur/run/<runId>-wayfinder-input.json`, the resolution mode and the evidence policy;
  - local shell and file reads plus the `spur` CLI only, with no network search or MCP tools;
  - never invoke `task-pipeline.yaml`, `/sp:dev-run`, `/sp:dev-runall` or code implementation;
  - read the task, map its Requirements and Acceptance Criteria to its Design, Plan and References, then author concise Solution, Testing and Review sections;
  - the evidence-anchor contract (0299 R1): resolve a shared evidence file's section start with `grep -n "^## <wbs> " <evidence-file>`, never copy another ticket's line number, and re-read each cited line before finishing;
  - finish with a short summary and stop.
  - Keep these literals verbatim, because tests move here: `grep -n`, `re-read each cited line`, `spur task update --section --from-file` and `Preserve the research boundary`. Do not write "at least" anywhere in the file.
- The input becomes this (260 chars). `agent`, `capture`, `role`, `mode`, `answerFile`, `expectFile`, `timeoutMs` and the role comment stay.

  `Resolve wayfinder task ${vars.wbs} per the sp:wayfinder skill (references/pipeline-resolution.md). Mode ${vars.resolutionMode}; evidence policy ${vars.evidencePolicy}; bundle .spur/run/${vars.__runId}-wayfinder-input.json. Finish with a short summary and stop.`

- Its reason goes directly above `- kind: agent.run`: `# (e) free-form: no pure-slash research surface yet; the contract lives in sp:wayfinder references/pipeline-resolution.md.`
- `plugins/sp/skills/wayfinder/SKILL.md:131` ("Invoked when a map already exists …"): append `` Pipeline runs: `references/pipeline-resolution.md`. `` (52 bytes with the leading space). The file goes from 26203 to 26255 bytes, against the `wayfinder: 26_264` R44 baseline (`skill-structure.test.ts:815`). Never bump the baseline; a markdown link would exceed it.

**Plugin script (d): `plugins/sp/scripts/feature-dev-precheck.ts`.**
- A standard ADR-065 entry: a header doc, `node:` imports (`child_process` `spawnSync`, `fs`, `path`, `url`), exported pure check functions, a thin `if (import.meta.main)` CLI and a `.mjs` twin.
- Register `{ "rel": "feature-dev-precheck.ts", "contract": "standard", "twin": "feature-dev-precheck.mjs" }` in `config/plugin-scripts.json` `entries`. Append `&& superskill script convert sp feature-dev-precheck.ts` to `build:scripts` (`package.json:61`).
- Env: `featureId`, `__runId` and `spurBin`, which is split on whitespace into a command plus prefix args.
- Artifacts: `.spur/run/$__runId-feature-dev-{feature.json,roster.json,tasks.txt,precheck.status}`.
- It ports `precheck:onEnter:0` (`feature-dev.yaml:95-122`) step for step:
  1. Create `.spur/run` and remove the status file.
  2. `id_rc` is 0 when `featureId` and `__runId` are both non-empty, else 1.
  3. When `id_rc` is 0, run `feature show "$featureId" --json` with stdout and stderr in `feature.json`. `show_rc` is its exit code (127 on a spawn error), else 1.
  4. When both are 0 and `feature.json` parses as a non-array object whose `.id` equals `featureId`, run `task list --feature "$featureId" --json` into `roster.json`. `list_rc` is its exit code, else 1.
  5. The first failing check prints its message to stderr and writes `FAIL`:
     - any rc non-zero: message 1;
     - the roster is not a non-empty JSON array: message 2;
     - a `wbs` that is empty or not a string, a duplicate `wbs`, or a status outside todo/done/cancelled/backlog/wip/testing/blocked: message 3;
     - any backlog/wip/testing/blocked task: message 4.
  6. Otherwise it writes the sorted `todo` WBS ids joined with `,`, with no trailing newline, to `tasks.txt`, then writes `PASS`.
  7. It always exits 0.
- The messages are verbatim from `feature-dev.yaml:107/110/113/116`, with `$ROSTER_JSON` expanded to the path and the rc triple filled in:
  1. `feature-dev precheck: missing featureId/runId, unknown feature '$featureId', or unreadable roster (rc $id_rc/$show_rc/$list_rc) — supply an existing planned feature via /sp:dev-plan or /sp:dev-idea; nothing was auto-created or re-planned`
  2. `feature-dev precheck: roster at $ROSTER_JSON is malformed, not an array, or empty — plan the feature first via /sp:dev-plan; refusing to replan or run an empty batch`
  3. `feature-dev precheck: roster has empty/duplicate/mismatched WBS identities or unknown statuses at $ROSTER_JSON — repair the task corpus; refusing to batch a broken roster`
  4. `feature-dev precheck: linked task(s) are backlog/wip/testing/blocked — refine or resume them through their own task pipelines before batching; refusing to launch overlapping work`

**Test migration.** Assertions follow the logic they pin. Run everything from the repo root with `bun test <paths>`.

| Test | Change |
| --- | --- |
| `packages/app/tests/workflow/feature-dev-definition.test.ts:171-189` | Keep the negative `agent doctor` loop. Replace the precheck pins (:178-188) with `feature-dev-precheck.ts`, `feature-dev-precheck.mjs`, `superskill install sp` and `feature-dev-precheck.status`. The artifact-name and jq pins move to the script test. |
| same file `:72-104` (integration review) | Hold: the first shell is the request program. |
| same file `:233-256` (verify) | Hold: exactly one shell carries `feature check`, with `--as done --json`, `feature-dev-verify.json`/`.status` and `all(.[]; .pass == true)`. |
| same file `:167-169`, `:191-211`, `:213-231` | Unchanged. |
| same file exec harness `:314-322` | Import `symlinkSync` (:2) and add `symlinkSync(join(<repo>, 'plugins'), join(workdir, 'plugins'))` after :321, so the wrapper finds the script from the temp cwd. |
| same file `:407`, `:450` | Compare `h.dispatches.map((d) => d.split('\n')[0])` with the current arrays, and assert that the dispatch contains `feature-dev-runall-answer.txt`. |
| same file, the other exec cases | Hold, because the stub `runTraced` returns stdout `''` and the answer file is still written. In the integration-review cases the `REVIEWER_TS` stub (:306-307) now writes CLEAN to the real collect status instead of a cwd file named `collect`; `reviewCalls` stays 2. |
| new `plugins/sp/tests/feature-dev-precheck.test.ts` | Spawn `bun <repo>/plugins/sp/scripts/feature-dev-precheck.ts` in a temp cwd with a stub `spurBin`. Cases: happy (`tasks.txt` is `0781,0782`, `PASS`), unknown feature, empty roster, malformed roster, duplicate WBS and a blocking status; assert the message, the status and the artifacts. Add the wrapper fail-closed case: a temp cwd without `plugins/` and a failing `superskill` on PATH writes `FAIL`, prints `failed closed` and exits 0. |
| `packages/app/tests/workflow/wayfinder-resolution.test.ts:95-98`, `:116-124` | Hold. |
| same file `:126-134` | The negative pins stay on the input. The `grep -n` and `re-read each cited line` pins move to an assertion on `references/pipeline-resolution.md`; the input test asserts `references/pipeline-resolution.md` and `-wayfinder-input.json`. |
| `plugins/sp/tests/pr-reviewing.test.ts:71-97` | Hold. |
| `docs-pipeline-measured-verdict.test.ts:140/144/147` and the `docs-pipeline-proof-chain.test.ts` exec cases | Hold: the guard keeps `= PASS` and `.proof.digest`. |
| `basic-workflow.test.ts:111` | Holds; no fixall dispatch equality is pinned. |
| `apps/cli/tests/commands/workflow.test.ts`, `wrapup-pipeline.test.ts` | Unchanged; run them as the other feature-dev consumers. |

**Ownership and doc rows** (`docs/design/workflow-shell-ownership.md`; line numbers as of 2026-09-11, before 0824's edits to the same file):
- pr-review table (:102-113): `precheck` stays POLICY and the rest stay EXT. Rename the `wait` and `collect` rows to their real indexes (`wait:onEnter:2`, `collect:onEnter:2`). Update the `request` and `collect` reasons for the condensed programs.
- docs table (:154-178): add a note that the `verify→record` guard is condensed to 4 lines with the same fail-closed semantics.
- feature-dev table (:217-222) is stale (the `agent doctor` probe and a checkpoint row that no longer exist). Rewrite it:
  - `precheck:onEnter:0` EXT via `feature-dev-precheck.ts`;
  - `feature-verify:onEnter:0` GLUE;
  - `integration-review:onEnter:0` and `:1` EXT (advisory, D5-P).
  - The heading becomes "(4 compound)".
- Recount the "Individual classification (58 programs)" heading (:93) after both 0824 and this task.
- wayfinder (:115-128) and basic (:200-206) are unchanged.

**Invariants.**
- States, transitions, guard kinds and the model-query count stay unchanged.
- `.spur/run` artifact names, status values and stderr messages stay unchanged, apart from the integration-review collect status now being written.
- Integration review stays advisory; only `requireCleanReview=true` blocks.
- The monorepo runs TS sources through `bun`; seeded projects run the `.mjs` twins through `node`.

**Rejected.**
- `command.gate` for `feature-verify`: it records exit status only. PASS also needs the `all(.[]; .pass == true)` predicate over the captured JSON (0782 R3), which the tests pin.
- A pr-review extension script: each program is already one `pr-reviewing.ts` call plus glue, and condensing fits the warn band.
- `requireDiff` for basic `fix`: fixall may legitimately leave no diff.
- `expectFile` on the runall batch report: the child chooses that path, not the pipeline.
- Keeping the combined integration-review program: at 1258 chars it cannot fit 800, and it carries the folded-line defect.
- Bumping the wayfinder R44 baseline: the 52-byte pointer fits.

### Plan

1. Record the baseline (R1). For all five workflows, save `spur workflow validate config/workflows/<name>.yaml --json` and the state ids plus transitions (`from`, `to`, `guard.kind`), parsed with the `yaml` package from the repo root, under `.spur/run/0825-baseline.*`.
2. Precheck script (R1).
   - Write `plugins/sp/tests/feature-dev-precheck.test.ts` first and watch it fail.
   - Implement `plugins/sp/scripts/feature-dev-precheck.ts`, register it in `config/plugin-scripts.json` and `build:scripts`, then run `bun run build:scripts`.
3. feature-dev YAML (R1): the precheck wrapper, the condensed `feature-verify:0`, the split `integration-review:0`/`:1`, the two `execute-tasks` output checks and the reason comments. Migrate `feature-dev-definition.test.ts` per the Design table, then run it with `workflow.test.ts` and `wrapup-pipeline.test.ts`.
4. pr-review YAML (R1): the three condensed programs and the six reason comments; run `pr-reviewing.test.ts`.
5. wayfinder (R1).
   - Write `plugins/sp/skills/wayfinder/references/pipeline-resolution.md` and append the SKILL.md pointer.
   - Replace the `investigate` input, condense `precheck:0` and add the reason comments.
   - Move the `:126-134` pins, then run `wayfinder-resolution.test.ts` and `skill-structure.test.ts`.
6. docs and basic YAML (R1): the condensed `verify→record` guard, the `verify:6` `expectFile`, the basic `fix:1` output check and the reason comments; run both docs suites and `basic-workflow.test.ts`.
7. Update `docs/design/workflow-shell-ownership.md` per the Design.
8. Verify:
   - `validate --json` on all five shows no error-level finding, no `agent-run-output` finding and no var-ref violation;
   - the parsed graphs equal the baseline;
   - the focused suites pass (`bun test <paths>` from the repo root): `feature-dev-definition`, `workflow` (apps/cli), `wrapup-pipeline`, `pr-reviewing`, `wayfinder-resolution`, `docs-pipeline-measured-verdict`, `docs-pipeline-proof-chain`, `basic-workflow`, `skill-structure` and `feature-dev-precheck`;
   - `bun run build:scripts` regenerates `feature-dev-precheck.mjs` with no further diff;
   - run `bun run --filter @gobing-ai/spur build:bundle`, then `bun run spur-check`.

### Solution

Change-map (auto-generated — implement step did not record a Solution).
Each entry cites the first changed line per file (`file:line`).

| Change (`file:line`) |
|----------------------|
| `packages/app/tests/workflow/feature-dev-definition.test.ts:16` |
| `packages/app/tests/workflow/feature-dev-definition.test.ts:180` |
| `packages/app/tests/workflow/feature-dev-definition.test.ts:2` |
| `packages/app/tests/workflow/feature-dev-definition.test.ts:323` |
| `packages/app/tests/workflow/feature-dev-definition.test.ts:410` |
| `packages/app/tests/workflow/feature-dev-definition.test.ts:456` |
| `packages/app/tests/workflow/wayfinder-resolution.test.ts:133` |

Re-audit fix (R1, 2026-09-12): `plugins/sp/scripts/feature-dev-precheck.ts:107` rejects null and primitive roster members before field access, preserving the existing FAIL status and error route. The Superskill-generated twin is `plugins/sp/scripts/feature-dev-precheck.mjs:52`. Regression `plugins/sp/tests/feature-dev-precheck.test.ts:220` reproduced the crash and now verifies the persisted FAIL artifact.

### Testing

**Pipeline verify results**

- Verdict: PASS (from verdict artifact)

| Requirement | Status | Evidence |
|-------------|--------|----------|
| R1 | MET | (1) Driver-attested validate ×5 zero error-level and zero agent-run-output; spot-check from shape holds — every agent.run in the five declares expectFile or requireDiff (feature-dev.yaml:141-142,162-163; basic.yaml:100-101; wayfinder-resolution.yaml:90-91,129-130; docs-pipeline.yaml:184-186 answerFile+expectFile, draft requireDiff docs-pipeline.yaml:176), all shell actions ≤10 commands and ≤800 chars per the recorded measures in the reason comments (pr-review.yaml:155 10-of-10, feature-dev.yaml:195 8/734), guards ≤5 (docs-pipeline.yaml:317 4-line, wayfinder-resolution.yaml:233 5-line, pr-review.yaml:297 4-predicate); caps confirmed unedited at workflow-service.ts:262-265; full gate 8073 pass 0 fail with proof-digest 193960b4… matching .spur/run/0825-proof.digest (0825-test-gate.log). (2) Owners per governance §1.1 closed vocabulary (harness-surface-governance.md:25-29): feature-dev precheck → (d) plugin script wrapper (feature-dev.yaml:94-100, plugins/sp/scripts/feature-dev-precheck.ts:1-58 registered config/plugin-scripts.json feature-dev-precheck.ts entry + package.json:61 build:scripts convert), feature-verify condensed 9 lines (feature-dev.yaml:160-163), integration-review split request+collect (feature-dev.yaml:187-197), pr-review precheck/request/collect condensed (pr-review.yaml:107,155,204), wayfinder precheck condensed (wayfinder-resolution.yaml:63-66), docs verify→record guard condensed 4-line one-jq-select (docs-pipeline.yaml:313-322). (3) Every warn-band item carries a one-line (e) YAML reason directly above the action/guard: feature-dev.yaml:160,187,195; pr-review.yaml:70,88,107,119,136,155,177,204,297; wayfinder-resolution.yaml:63,81,104,140,233; docs-pipeline.yaml:141,158,201,317,338; basic.yaml:59 — wrapping/placement residual is known-accepted. (4) investigate prompt body moved to plugins/sp/skills/wayfinder/references/pipeline-resolution.md (boundary/procedure/evidence-anchor contract, all pinned literals present), input at wayfinder-resolution.yaml:84-86 is operation+vars+bundle path only with reason at :81; SKILL.md:131 pointer appended; pins migrated with whitespace collapse (wayfinder-resolution.test.ts:126-158); R44 baseline wayfinder 26_264 unchanged (skill-structure.test.ts:820). (5) execute-tasks-auto:1 and execute-tasks:1 answerFile===expectFile feature-dev-runall-answer.txt (feature-dev.yaml:141-142,162-163); basic fix:1 answerFile===expectFile basic-fix-answer.txt (basic.yaml:100-101); docs verify:6 expectFile added equal to answerFile (docs-pipeline.yaml:184-186). (6) integration-review collect passes --status-file .spur/run/$__runId-integration-review-collect.status (feature-dev.yaml:195-197); seeded project without sp plugin fails closed — wrapper else-branch echoes 'superskill install sp', writes FAIL, exit 0 (feature-dev.yaml:94-100) pinned by plugins/sp/tests/feature-dev-precheck.test.ts wrapper fail-closed case. (7) Routes/artifacts/status/exit semantics unchanged apart from the two deltas: transition order pinned (feature-dev-definition.test.ts:203-218), pr-reviewing.test.ts:71-97 counts hold (since/head ×3, into-var ×4, no node -e, no PAIR=), docs guard keeps test -n proofDigest/proofDigestNow, = PASS, .proof.digest, = "$proofDigest" (docs-pipeline-measured-verdict.test.ts:181-189), assertions moved with logic (precheck pins feature-dev-definition.test.ts:176-189, plugins symlink :321, dispatch first-line equality + answer-file pin :407-413,451-458, REVIEWER_TS writes CLEAN to the real collect status), baseline graphs recorded ×5 (.spur/run/0825-baseline-*-graph.json), no agent.run added (no model query added), no new public verb/flag (script-only surface, script-contract-check 23 baselined PASS in gate log), build:bundle parity driver-attested via bundle-config regeneration. (8) Non-goals untouched: no 0825 markers in task-pipeline/idea-pipeline/wrapup-pipeline.yaml (driver-attested byte-identical empty diff), docs precheck:2 $wbs status-path defect deferred unchanged (docs-pipeline.yaml writes $__runId-docs-precheck.status at :110-114, guard precheck→draft still reads $wbs-docs-precheck.status at :254-257), no stateEffect/evidenceEffect anywhere in config/workflows, advisory D5-P and pr-review pending/TIMEOUT edges unchanged (feature-dev.yaml:213-238, pr-review.yaml wait→pending/collect→pending), COMPOSITION_CAPS and the spur-check chain (package.json:81) unedited. |
- Coverage: N/A (verdict-based; verify pipeline does not measure code coverage)

### Review

<!-- spur:record-review -->

**SECU findings** (pipeline verify step — verdict: PASS)

| Priority | Dimension | Location | Finding |
|----------|-----------|----------|----------|
| P4 | spur task check | — | task check passed |

### References

<!-- Links to the parent feature, design docs, related tasks, or external references. -->

### History

- 2026-09-12T03:00:31.033Z todo → wip (system)
- 2026-09-12T04:23:50.915Z wip → testing (system)
- 2026-09-12T04:23:51.712Z testing → done (system)

