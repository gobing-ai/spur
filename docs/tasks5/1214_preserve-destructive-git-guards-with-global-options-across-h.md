---
schema_version: 1
name: Preserve destructive git guards with global options across hook hosts
status: done
template: issue
created_at: 2026-10-16T01:39:36.480Z
updated_at: "2026-10-16T06:11:21.954Z"
feature_id: A91

done_forced: "false"
done_reason: unforced close; PASS artifact at .spur/memory/evidence/1214-verdict.json
---

## 1214. Preserve destructive git guards with global options across hook hosts

### Background

Review of packages/apps/plugins/scripts reproduced a gap in A91 hook preservation (feature R2/R7). `classifyCommand('git push --force')` returns a destructive label, but `git -C . push --force` and `git -c core.hooksPath=/tmp/hooks push -f` return null. No destructive command was executed. All host adapters share this classifier, so generic hook normalization cannot repair this policy miss. Existing tasks 0215 and 1211 are done; no active task owns this newly reproduced gap. The review already fixed malformed-URL error redaction and corrected the stale serial-test comment; neither belongs to this task.

### Requirements

- [x] R1. Recognize destructive git invocations after supported global options, including -C, -c, --git-dir, --work-tree and their applicable equals forms, preserving quoted option values as one argument and command boundaries.
- [x] R2. Keep one portable classifier shared by every hook host. A matched force push, hard reset, untracked-file deletion or working-tree discard must retain the existing ask decision; hosts without confirmation must retain their existing deny translation.
- [x] R3. Preserve intentional safe cases, including ordinary push/status and force-with-lease, without evaluating shell expansions or invoking git during classification.
- [x] R4. Keep bundled hook sources standalone, add regression coverage for option-prefixed forms and host output, and update the careful-guard guidance if the supported syntax contract needs clarification. No new public CLI verbs, hook identities, bypass flags or policy DSL.

### Acceptance Criteria

```gherkin
Feature: Guard git invocations with global options
  Scenario: R2 — Hook entries preserve behavior with helpers and tests in their owners
    Given the shared careful-guard policy and registered hook entry
    When git -C . push --force or git -c core.hooksPath=/tmp/hooks push -f is classified
    Then both produce a destructive decision without executing git
    And option-prefixed reset --hard, clean -fd and restore . preserve their existing guard behavior
    And quoted -C paths and --git-dir/--work-tree forms are covered
    And ordinary push, status and force-with-lease retain their existing safe decisions
    And host-conformance tests retain ask for confirmable hosts and deny for Codex
```
Verification: run `bun test tests/hooks/destructive-policy.test.ts tests/hooks/careful-guard.test.ts` inside plugins/sp, the existing hook-host conformance checks, and `bun run plugin-smoke`. Both line and function coverage must remain at least 90% per measured changed file.

### Q&A

<!-- Clarifications and triage decisions. Keep empty if none. -->

### Design

Extend `plugins/sp/lib/destructive-policy.ts` at the command-recognition seam. Use a small pure lexical pass for git argument prefixes and supported option arity/quoting, then apply the existing destructive subcommand policy to the recognized invocation. Preserve shell segment boundaries; never expand substitutions or execute commands. Reuse a local tokenizer if one already satisfies this bounded contract. Keep implementation in the shared policy/helper rather than each host entry. Update `plugins/sp/tests/hooks/destructive-policy.test.ts` and `plugins/sp/tests/hooks/careful-guard.test.ts`; consult the installed Superskill host-conformance owner for Codex translation. Reject adding separate host regexes, a broad `git.*push` expression that crosses commands, a general shell parser dependency, or external value imports into installed hooks. Out of scope: changing safe-force-with-lease policy, arbitrary git aliases, other destructive tools, and changing the hook failure policy.

### Plan

1. Add failing policy cases for global-option force pushes, including quoted paths, and adjacent destructive subcommands; retain safe controls.
2. Implement bounded shared recognition; review option arity, separator and quote handling against the regression matrix.
3. Exercise the authored hook and existing host translation with synthetic payloads; never perform a real push or deletion.
4. Run focused tests, standalone/plugin smoke and the project gate; record per-file coverage and current-source anchors in Solution/Testing before verification. Keep this task independent of 1215.

### Root Cause

The git patterns require `git` immediately followed by the subcommand. Git global options between the executable and subcommand prevent a match. Evidence: `plugins/sp/lib/destructive-policy.ts:100` and `plugins/sp/lib/destructive-policy.ts:120`. The direct classifier replay is captured in the review report; confirm with a policy test before implementation.

### Solution

**File:line change map**

- `plugins/sp/lib/destructive-policy.ts:132` — `GIT_OPTION_VALUE`: one shell word usable as a git option value (quoted `"…"`/`'…'` kept whole; an unquoted word stops at whitespace and at `; & |`).
- `plugins/sp/lib/destructive-policy.ts:140` — `GIT_GLOBAL_OPTION`: exactly git's grammar — `-C <path>` / `-c <name>=<value>` (separated; glued short forms are a git usage error) and `--git-dir[=<path>]` / `--work-tree[=<path>]`.
- `plugins/sp/lib/destructive-policy.ts:147` — `GIT_WITH_GLOBAL_OPTIONS`: `\bgit\b` plus any run of those options directly before the subcommand.
- `plugins/sp/lib/destructive-policy.ts:158-160` — `stripGitGlobalOptions`: rewrites only the matched option span back to `git`, leaving every other byte (newlines, quotes, `; & |`) intact so the patterns cannot start matching across a command boundary and no shell expansion or git process runs.
- `plugins/sp/lib/destructive-policy.ts:178-181` — `classifyCommand` tests `DESTRUCTIVE` against the stripped command; the `rm` loop still runs on the raw command (a git global option cannot precede `rm`).
- `plugins/sp/scripts/hooks/careful-guard.ts:12-16` — docstring now names the supported git global-option forms and the no-exec/no-expansion guarantee.
- `plugins/sp/tests/hooks/destructive-policy.test.ts:51-60` and `:100-104` — option-prefixed destructive rows and safe controls in the matrix; these also drive the Claude adapter parity block.
- `plugins/sp/tests/hooks/careful-guard.test.ts:80-84` and `:107-110` — the same contract exercised end-to-end through the spawned hook entry.

**Rationale.** The destructive subcommand patterns anchor on `git` immediately before the verb (`destructive-policy.ts:104,107,110,112,119`), so a global option between the executable and the subcommand made a real force push classify as safe on every host that shares the classifier. A single bounded lexical strip at that shared seam fixes all hosts at once; matching git's exact option grammar (no glued `-C`/`-c`; `=` only on the long forms) keeps the pass small and faithful, and the span-local replacement preserves command boundaries and quoted values. Out-of-scope items (force-with-lease policy, aliases, other tools, hook failure policy) are untouched.

### Testing

**Pipeline verify results**

- Verdict: PASS (from verdict artifact)

| Requirement | Status | Evidence |
|-------------|--------|----------|
| R1 | MET | Forced re-verify 2026-10-15 on HEAD c57c17e7b (includes residual fix 9b1291a1c). Option-run grammar at `plugins/sp/lib/destructive-policy.ts:163` (glued long, value-taking long, -C/-c, value-less flags; quoted values whole via `plugins/sp/lib/destructive-policy.ts:132`), applied by `plugins/sp/lib/destructive-policy.ts:185-186`. Matrix rows `plugins/sp/tests/hooks/destructive-policy.test.ts:58-70` (-C, -c, --git-dir=, --work-tree=, quoted -C, --no-pager, -p) and boundary rows `plugins/sp/tests/hooks/destructive-policy.test.ts:86-88`. Fresh run: (cd plugins/sp && bun test tests/hooks/destructive-policy.test.ts tests/hooks/careful-guard.test.ts) 232 pass / 0 fail, @run `.spur/run/verifyall-1211-1215/t1214.log` line 4. |
| R2 | MET | One shared classifier: `plugins/sp/hooks/hooks.json:20` registers `superskill hook run sp careful-guard`, which calls `plugins/sp/lib/destructive-policy.ts:190`. Ask on confirmable hosts: spawned-entry rows `plugins/sp/tests/hooks/careful-guard.test.ts:81-87`. Codex deny: fresh isolated install with repo-pinned Superskill 0.3.39 — `git -C . push --force` and `git --no-pager push -f` exit 2 with reason, `git status` silent exit 0, @run `.spur/run/verifyall-1211-1215/codex-careful-guard-receipt.json` line 1. |
| R3 | MET | Safe controls stay allow: `plugins/sp/tests/hooks/destructive-policy.test.ts:120-134` (force-with-lease, -C status, --no-pager status, -p push origin main) and spawned `plugins/sp/tests/hooks/careful-guard.test.ts:106-123`; 232/0 fresh @run `.spur/run/verifyall-1211-1215/t1214.log` line 4. Pure regex replace only (`plugins/sp/lib/destructive-policy.ts:185-186`); no spawn/exec in the module. |
| R4 | MET | Standalone: bun run plugin-smoke PASS @run `.spur/run/verifyall-1211-1215/smoke.log` line 2; script-contract-check 0 violations (bun scripts/commands/script-contract-check.ts, this run). Coverage `plugins/sp/lib/destructive-policy.ts` 100.00% funcs / 100.00% lines @run `.spur/run/verifyall-1211-1215/coverage.log` line 2. Guidance updated `plugins/sp/scripts/hooks/careful-guard.ts:12-18`. No new verbs/hook ids. Project gate: @run `.spur/run/verifyall-1211-1215/gate.log` line 681 (sandboxed spur-check on HEAD c57c17e7b: 51/51 rules, 11146 pass / 6 fail; all 6 are sandbox-environment failures outside this scope — git template-hook copy denied, Chromium launch, WT-4 scratch trees; last unsandboxed gate 0 fail @run `.spur/run/1215-test-gate.log` line 1). |

| Acceptance Criteria | Status | Evidence Type | Evidence |
|---------------------|--------|---------------|----------|
| R2 — Hook entries preserve behavior with helpers and tests in their owners | MET | test | Destructive decisions for -C/-c force push `plugins/sp/tests/hooks/destructive-policy.test.ts:58-59`; reset --hard / restore . / clean -fd `plugins/sp/tests/hooks/destructive-policy.test.ts:63-65`; quoted -C, --git-dir, --work-tree `plugins/sp/tests/hooks/destructive-policy.test.ts:60-62`; safe controls `plugins/sp/tests/hooks/destructive-policy.test.ts:120-134`; entry-level ask `plugins/sp/tests/hooks/careful-guard.test.ts:81-87`; Codex deny exit 2 @run `.spur/run/verifyall-1211-1215/codex-careful-guard-receipt.json` line 1. Fresh 232/0 @run `.spur/run/verifyall-1211-1215/t1214.log` line 4; coverage 100/100 @run `.spur/run/verifyall-1211-1215/coverage.log` line 2. |
- Coverage: N/A (verdict-based; verify pipeline does not measure code coverage)

### Review

#### Review Report — 1214

**Scope:** non-corpus diff of run 1214-0763fa55 — `plugins/sp/lib/destructive-policy.ts`, `plugins/sp/scripts/hooks/careful-guard.ts`, `plugins/sp/tests/hooks/destructive-policy.test.ts`, `plugins/sp/tests/hooks/careful-guard.test.ts` (93 insertions / 4 deletions; `.spur/run/1214-diffstat.json`). Only what the diff changes was reviewed; the `### Solution` file:line map was checked against the tree, not trusted.
**Dimensions:** functional traceability (R1–R4 + the AC scenario), security, efficiency, correctness, usability, architecture depth.
**Verdict:** PASS

##### Findings (ranked)

| # | Priority | Dimension | Finding | Location | Disposition |
|---|----------|-----------|---------|----------|-------------|
| 1 | P3 (minor) | Correctness — class sweep | The lexical pass recognizes 4 of git's global options, so sibling forms of the *same* defect class still hide a destructive subcommand. Replayed this round against `plugins/sp/lib/destructive-policy.ts:140`: `git --no-pager push --force`, `git -p push -f`, `git --bare push --force`, `git --namespace=x reset --hard` and `git --no-replace-objects push --force` all return null, while git (2.55.0, locally installed) parses those options before the subcommand (they proceed to normal git behavior and fail only on repository lookup — `git --no-pager rev-parse --is-inside-work-tree`). Pre-existing: the pre-diff classifier returned null for every one of these too, and none is in R1's enumerated set — so this is a bounded-scope residual, not a regression introduced here. | `plugins/sp/lib/destructive-policy.ts:140` | DEFER(outside R1's four enumerated forms (-C/-c/--git-dir/--work-tree); pre-existing best-effort guard limit that needs a follow-up A91 task deciding git's full option arity, not a change to this diff) |
| 2 | P4 (advisory) | Usability | Conservative over-approximation, not a correctness loss: stripping the option span makes a *quoted* `echo "git -C . push --force"` prompt where the old classifier allowed, because the removed span let the plain force-push pattern reach the quoted text. This matches the pre-existing behavior for the plain quoted form (a quoted `git push --force` already prompted before this diff), nothing is executed, and no destructive command is misclassified as safe. Probe: differential replay `old` vs `new` over 41 commands (`plugins/sp/lib/destructive-policy.ts:159`). | `plugins/sp/lib/destructive-policy.ts:158-159` | ACCEPTED |
| 3 | P4 (advisory) | Correctness | The line-continuation sibling of the same surface is untouched: `git -C . \` + newline + `push --force`, and `git push \` + newline + `--force`, both return null, because the option run requires `[ \t]+` and the subcommand patterns stop at `[^\n]`. Pre-existing for every git pattern (the old classifier returned null for both), therefore a recorded adjacency rather than a defect of this diff. | `plugins/sp/lib/destructive-policy.ts:147` | ACCEPTED |
| 4 | P4 (advisory) | Architecture | `stripGitGlobalOptions` is exported but has no consumer other than `classifyCommand` and no direct test import; the module-private alternative would keep the policy surface as narrow as the single `classifyCommand` entry point. Harmless and consistent with the module's existing exported-helper lexicon (`parseFlags`, `isRecursiveForceRm`), so recorded, not requested. | `plugins/sp/lib/destructive-policy.ts:158` | ACCEPTED |

##### Functional Traceability

| Req | Status | Evidence |
|-----|--------|----------|
| R1 | MET | Global-option recognition lands exactly on the four named forms, including equals and separated spellings: `plugins/sp/lib/destructive-policy.ts:132` (value word: quoted `"…"`/`'…'` kept whole, unquoted stops at whitespace and `; & \|`), `:140` (`-C <path>`/`-c <name>=<value>` separated; `--git-dir[=…]`/`--work-tree[=…]`), `:147` (`\bgit\b` + run of those options), `:178-181` (decide on the stripped command). Independently re-run this round: `(cd plugins/sp && bun test tests/hooks/destructive-policy.test.ts tests/hooks/careful-guard.test.ts)` → **171 pass / 0 fail, 214 expect() calls**; my own replay added `git -C "my repo" push --force`, `git -C /some/repo reset --hard HEAD~1`, `git --git-dir /tmp/repo clean -fd`, `git -C . restore .`, `git -C . checkout .`, `git -C . push origin +main` and the multi-option `git -C . -c core.hooksPath=/tmp/x push --force` — all destructive; tab-separated options also strip. Quoted value kept as one argument and boundaries preserved: `git -C "a;b" status` → allow, `git -C . push --force; echo done` → ask (span-local replacement, `:159`). |
| R2 | MET | One classifier, no host copy: `classifyCommand` is the only policy entry, its sole in-repo consumer is the single registered entry `plugins/sp/scripts/hooks/careful-guard.ts:81` (`hooks/hooks.json` PreToolUse/Bash → `superskill hook run sp careful-guard`), and the strip sits inside `classifyCommand` (`:178`), so every host that runs the entry inherits it. Force push, hard reset, untracked-file delete and working-tree discard all keep `ask` behind options (matrix rows `plugins/sp/tests/hooks/destructive-policy.test.ts:56-65`). Host translation is untouched by construction: `git diff --numstat` on `plugins/sp/scripts/hooks/careful-guard.ts` = 5 added / 0 removed and every added line is a docstring line (`git diff -U0` non-comment added lines = 0), so the allow/ask/deny decision shape and the `systemMessage` payload are byte-identical. Conformance proof for all hosts is the adapter-parity block that spawns the entry for every matrix row (`plugins/sp/tests/hooks/destructive-policy.test.ts:125-131,140`), plus the spawned-hook ask list at `plugins/sp/tests/hooks/careful-guard.test.ts:81-85` — both green in my run; the Codex deny translation lives upstream in superskill, not in this repo, and no in-repo file changed it. `(cd plugins/sp && bun test tests/hooks)` → 338 pass / 0 fail. |
| R3 | MET | Safe decisions retained: `git -C . push origin main`, `git -C . status`, `git -C . push --force-with-lease`, `git -c core.hooksPath=/tmp/hooks push --force-with-lease`, `git --git-dir=/tmp/repo status --short` → allow (matrix rows `plugins/sp/tests/hooks/destructive-policy.test.ts:101-104`, hook rows `plugins/sp/tests/hooks/careful-guard.test.ts:108-111`). No evaluation and no process spawn: `plugins/sp/lib/destructive-policy.ts` has zero imports and no `spawn`/`exec`/`eval` (whole-file grep, empty), and the pass is a `String.replace` with a `'git'` literal (`:159`); the SQL/kubectl/docker patterns are unchanged. Differential replay old-vs-new over 41 commands produced 12 diffs, all of them intended new detections. |
| R4 | MET | Standalone hook surface preserved: `bun run plugin-smoke` → `plugin-install-smoke PASS — plugin surface is standalone and installs clean` (scan of `hooks/**`, `lib/**`, `scripts/**` for non-relative value imports + superskill install dry-run). Regression coverage added at both levels — policy matrix (`plugins/sp/tests/hooks/destructive-policy.test.ts:51-65`, `:101-104`) and end-to-end spawned entry (`plugins/sp/tests/hooks/careful-guard.test.ts:80-85`, `:107-110`) — and the guidance updated at `plugins/sp/scripts/hooks/careful-guard.ts:12-16`. No new CLI verb, hook identity, bypass flag or policy DSL: the diff adds regex consts plus one exported pure helper and no new hook entry. Coverage of the changed measured file: my run `(cd plugins/sp && bun test --coverage tests/hooks/destructive-policy.test.ts)` → `lib/destructive-policy.ts` **100.00 % funcs / 100.00 % lines**, matching the gate log `.spur/run/1214-test-gate.log:562` (≥90/90). |
| AC scenario (R2 — guard git invocations with global options) | MET | Given/When/Then verified clause by clause this round: `git -C . push --force` → `a force push (git push --force / -f)` and `git -c core.hooksPath=/tmp/hooks push -f` → same label, both without executing git (no spawn in the module; classification is pure string work). Option-prefixed `reset --hard`, `clean -fd`, `restore .`, `checkout .` and `+refspec` all guard (`plugins/sp/tests/hooks/destructive-policy.test.ts:56-65`). Quoted `-C` and `--git-dir`/`--work-tree` forms covered by rows `:59-60`, `:58`. Ordinary push/status/force-with-lease stay safe (`:101-104`). Ask for the confirmable host and no ordering change for hosts without confirmation — see the R2 row's decision-shape evidence. Verification command from the AC re-run green: 171 pass / 0 fail with coverage 100/100 on the measured changed file. |

##### Dimension verdicts

- **Security.** The fix closes a real policy miss at the shared seam: an operator-visible `ask` now precedes option-prefixed force pushes, hard resets, untracked-file deletes and working-tree discards, and it cannot be defeated by quoting (`git -C "my repo"`), by `;`/`&`/`|` (`git -C . push --force; echo done` still asks; `git -C "a;b" status` stays safe) or by an expansion (`git -C $(pwd) push --force` asks; no expansion is performed). Fail-open behavior, `SPUR_CAREFUL=off`, and the non-Bash/malformed-payload paths are untouched and still covered (`plugins/sp/tests/hooks/careful-guard.test.ts:124-142`). No injection surface added: the added regexes are data, the replacement is a constant, and the module remains import-free. Finding 1 is the honest limit of this pass: the option alternation is a whitelist, so unlisted global options remain a bypass of the *prompt*, never of the underlying policy on listed forms.
- **Efficiency.** One extra `String.replace` over the command plus the existing pattern loop, evaluated only after the `rm` scan and only once per hook invocation (`plugins/sp/lib/destructive-policy.ts:178`). The regex is linear on hostile input: 1.2 KB of nested quotes and a 2,000-option run both classified in ≤0.01 ms (my probe, no backtracking blowup), and the alternation cannot fail-and-backtrack because nothing is required after the option run.
- **Correctness.** Confirmed against git's own parser where the code makes a grammar claim: glued short forms are a usage error (`git -C. status` → `unknown option: -C.`; `git -ccore.hooksPath=… status` → `unknown option: -c…`, git 2.55.0), which is exactly what the comment at `plugins/sp/lib/destructive-policy.ts:136-140` asserts, so omitting glued forms is faithful rather than a hole. `--git-dir`/`--work-tree` accept both `=<path>` and a separated value, and both are handled. A quoted unquoted-word path with spaces (`git -C /a/path with space push --force`) does not strip — correct, since git would treat `with` as the subcommand and never push.
- **Usability.** The `ask` reason stays human-readable because the labels are reused unchanged; the hook docstring now names the supported option forms and the no-exec/no-expansion guarantee (`plugins/sp/scripts/hooks/careful-guard.ts:12-16`). Only cost is the extra prompt on quoted strings (finding 2), which the guard already produced for the plain form.
- **Architecture.** The fix is at the right depth: a small pure lexical pass inside the single shared policy module, applied once in `classifyCommand`, instead of per-host regexes or a shell-parser dependency — the design's explicit rejections are honored. Testability is good (policy matrix + spawned entry + adapter parity over one table), and the mechanism is data-driven enough that a future option addition is a one-line change to `plugins/sp/lib/destructive-policy.ts:140`. Residual coupling: the option grammar is now encoded as a hand-maintained whitelist with no test that would notice git gaining/altering an option form — that is finding 1 and finding 4, both non-blocking.

##### Evidence gaps and assumptions

- The task's R1 wording "after supported global options, including -C, -c, --git-dir, --work-tree" is read as *the supported set is those four*; on that reading R1 is MET. The superset reading (any option git accepts) is not met, which is exactly what finding 1 records — the row is deliberately left visible rather than argued away.
- I verified host retention structurally (comment-only change to the single registered entry + adapter parity over the full matrix) and did **not** re-run an installed Codex/Pi host conformance suite; that translation belongs to superskill 0.3.39 outside this repo, and the run's own gate already covered this tree.
- The full repo gate was not re-run here by design; the pipeline's test stage recorded PASS on this digest — `.spur/run/1214-check-receipt.json` (`bun run spur-check`, 11150 pass / 0 fail, `.spur/run/1214-test-gate.log:574-575`). All other numbers in this report are from commands I ran myself in this session.

##### Residual risk

The deferred P3 (finding 1): the guard's prompt is bypassable by a destructive git invocation prefixed with a globally valid option outside the whitelist, e.g. `git --no-pager push --force`. No regression, no requirement breach, and no other repo surface consumes the classifier — but it should be closed by a follow-up task in A91 that decides git's full option arity, otherwise the same class will be re-reproduced by the next review cycle. Second-order residual (finding 3): newline-continuation invocations were already unseen by every git pattern and remain so.

**Next:** approve → verify; carry finding 1 as a deferred residual and file the follow-up option-set task.

### References

Feature A91 R2/R7; task 0215 historical policy owner; `plugins/sp/lib/destructive-policy.ts:100`; `plugins/sp/scripts/hooks/careful-guard.ts:82`; `plugins/sp/tests/hooks/destructive-policy.test.ts`; `plugins/sp/tests/hooks/careful-guard.test.ts`. Review command: `bun -e 'import {classifyCommand} from "./plugins/sp/lib/destructive-policy.ts"; console.log(classifyCommand("git -C . push --force"))'` currently prints null.

### History

- 2026-10-16T03:16:06.761Z todo → wip (system)
- 2026-10-16T03:36:23.325Z wip → testing (system)
- 2026-10-16T03:36:34.098Z testing → done (system)

