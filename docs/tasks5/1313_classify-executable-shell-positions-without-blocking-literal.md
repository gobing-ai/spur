---
schema_version: 1
name: Classify executable shell positions without blocking literal read-only searches
status: done
template: feature-impl
created_at: 2026-11-05T20:01:23.920Z
updated_at: "2026-11-07T06:55:53.706Z"
ac_altitude: task-local
ac_numbering: task-local
feature_id: A6
priority: P2
tags:
  - simplification-2026-11
  - w8
  - approved
estimate_hours: 8

dependencies: []
done_forced: "false"
done_reason: unforced close; PASS artifact at .spur/memory/evidence/1313-verdict.json
---

## 1313. Classify executable shell positions without blocking literal read-only searches

### Background

Approved program: `docs/plans/2026-11-05-simplification-and-product-enhancement.md`, package W8; evidence and defect/candidate mapping: `docs/reports/2026-11-05-codebase-review.md`.

Robin approved this plan and requested feature updates/new features and implementation tasks on 2026-11-05; continued the same corpus conversion in the next message. Approval covers planning this scope, not deployment, new public verbs, new dependencies, gate weakening, or production data changes.

Implements feature A6: Destructive-command policy distinguishes literal data from execution.

Owned surfaces/callers/fixtures/config/docs: plugins/sp/lib/destructive-policy.ts; plugins/sp/scripts/hooks/careful-guard.ts and portable callers; plugins/sp/tests/hooks/careful-guard.test.ts and shared classifier tests.

Duplicate review: source-local task list over all five configured folders found no nonterminal task owning this work; the four legacy blocked records are unrelated. Historical done tasks remain intact.

Rubric: E8 D1 L2 C1 R2 = 14. Keep this candidate as one cohesive deliverable with one review/rollback boundary. The overall program exceeds 16 hours and spans independent owners, so its feature/task split is justified. Sequential same-file work is ordered explicitly rather than run concurrently.

**Refine corrections (2026-11-05)**

- Do not leave parser/library choice open or claim a complete shell parser is needed. Freeze a conservative lexical pass: allow only proven literal read-only searches; everything ambiguous retains the current classifier behavior.
- Verified source seams: `plugins/sp/lib/destructive-policy.ts:190`; `plugins/sp/lib/destructive-policy.ts:185`; `plugins/sp/scripts/hooks/careful-guard.ts:84`.
- One worktree at the audited HEAD; no wip task was reported. Preserve the prior review source diff and concurrent edits; recheck before implementation.

### Requirements

- [x] R1. Destructive-command policy distinguishes literal data from execution; implement the exact Given/When/Then contract below.

### Acceptance Criteria

```gherkin
Feature: Classify executable shell positions without blocking literal read-only searches

  Scenario: AC1 — Destructive-command policy distinguishes literal data from execution (req: R1)
    Given quoted ripgrep patterns containing destructive vocabulary and destructive commands inside executable positions or substitutions
    When the shared classifier and host hook evaluate the command
    Then literal data causes no false permission prompt while all destructive positive controls still request approval without weakening nested-execution detection
```

### Q&A

<!-- CLOSED decisions from refinement: what was chosen and why, what was deferred and on what
     condition. Not a parking lot for open questions — an unanswered question here means the task
     is not ready to hand off. Keep empty if none. -->

#### Q&A entry — 2026-11-05T20:38:18.595Z

Closed: use a bounded internal lexer and conservative fallback; no new parser package, no claim of full shell-language coverage.

Dependency status is scheduling, not a missing design decision. Ready specification does not mean upstream tasks are already complete. Start only when direct prerequisite tasks are integrated; no additional unrecorded go/no-go question remains.

### Design

#### Frozen implementation contract

No new dependency or public API. Add private shellWords/command-segment scanner in destructive-policy.ts tracking single/double quotes, escapes, ; | & newlines and backtick/$() substitutions. Proven standalone rg/grep operands are data; in single quotes never recurse, in double/unquoted substitutions recursively classify executable contents. Also recursively inspect sh/bash/zsh -c argument and env/command prefixes. For malformed/unclosed/unsupported constructs, fall back to existing conservative classifyCommand patterns, not allow. Keep existing SQL/git/rm policy and safe-target rules intact. Do not exempt arbitrary programs or blanket-whitelist rg. Preserve permission ask semantics across portable hook callers.

#### Dependencies and handoff

Direct prerequisites: none. This slice has no functional upstream prerequisite; program wave order is scheduling guidance, not a fabricated dependency.

Output/handoff: Independent safety fix; no functional dependency on Markdown renderer discovery.

#### Boundaries and verification

(cd plugins/sp && bun test tests/hooks/destructive-policy.test.ts tests/hooks/careful-guard.test.ts). Extend the existing shared classifier matrix in destructive-policy.test.ts. Save false-positive and destructive control matrix; plugin-smoke is required only if actual plugin dependency graph changes.

No production implementation occurs during this refinement. No new dependency, public noun/verb, workflow/IAM/env edit, production migration or new control guarantee is implied. Preserve successful outputs, validation, errors, redaction, proof freshness, cancellation, accessibility and one writer per tree. New unit or isolated policy failure cases must precede production code; prefer cross-layer/fixture journeys. Use the applicable harness gate once after focused checks and record real implementation results through Spur. Update owning contracts for actual surface changes, architecture for mechanisms, and an ADR before lasting boundary reversal. Save repeatable JUnit/JSON proof under the task run directory and durable evidence in the task Testing record. Scope is the named source seams and necessary callers/tests/docs; no speculative framework or broad cleanup.


#### Repo gate conventions

The post-check preset requires a TSDoc comment on every exported symbol (`every-export-has-tsdoc`),
and per-file line and function coverage must stay at or above 90%. Give each new export a doc
comment and exercise every new branch before reporting done.


#### Repo gate conventions

The post-check preset requires a TSDoc comment on every exported symbol (`every-export-has-tsdoc`),
and per-file line and function coverage must stay at or above 90%. Give each new export a doc
comment and exercise every new branch before reporting done.

### Plan

- [x] 1. Write literal-search positives plus destructive substitutions, nested sh, malformed quoting, git global options and escaped-token negative controls first.
- [x] 2. Implement the conservative command-position scanner and apply existing dangerous-command logic only to known executable regions; unknown regions retain conservative fallback.
- [x] 3. Exercise the shared function and real hook payload path, keeping every existing destructive positive control and standalone import rule.
- [x] 4. Run the exact focused checks above, inspect the diff against R-items/feature AC, synchronize owners and record evidence through the task pipeline; do not fabricate completion.

### Solution

`classifyCommand` lexes quotes, escapes, command separators, substitutions, and `sh` / `bash` / `zsh -c` before the existing whole-string scan. A proven standalone `rg` or `grep` (exact argv0, optional `env` / `command` prefixes with known flags) treats its operands as data, including inside single quotes. Substitutions, backticks, and `-c` scripts are classified again. `--pre` keeps the invocation on the destructive scan. Unknown `env` flags leave argv0 at `env`. Malformed or unsupported syntax (`$'…'`, arithmetic, heredoc, process substitution, subshell, unclosed quotes) keeps the previous `rm` / git / SQL scan. Escape-normalized words are scanned as well, so `rm \-rf /` and `git\ push --force` still ask.

- `plugins/sp/lib/destructive-policy.ts:18-24` documents the executable-position rules.
- `plugins/sp/lib/destructive-policy.ts:197-619` is the private lexer and `classifyCommand`. `plugins/sp/lib/destructive-policy.ts:599-618` is the previous scan, including `stripGitGlobalOptions`.
- `plugins/sp/scripts/hooks/careful-guard.ts:20-23` states the same rule. The hook still decides at `plugins/sp/scripts/hooks/careful-guard.ts:89`.
- `plugins/sp/lib/destructive-policy.ts:603` extends the shared matrix (literal searches, nested shells, substitutions, `--pre`, escaped tokens, malformed syntax). Its parity describe spawns the hook for every row.
- `plugins/sp/tests/hooks/careful-guard.test.ts:94-100` and `plugins/sp/tests/hooks/careful-guard.test.ts:132-138` cover the same allow/ask split on the hook payload.

No new export, dependency, or public noun/verb. `plugins/sp/README.md` already names the policy module and describes the guard as asking on destructive commands, so that page stayed as written. No ADR.

Checks from this tree:

- `cd /Users/robin/xprojects/spur-new-runall-1300-1316-af3570ab/plugins/sp && bun test tests/hooks/destructive-policy.test.ts tests/hooks/careful-guard.test.ts` — 434 pass, 0 fail.
- From the repo root, `bun test tests/hooks/destructive-policy.test.ts --test-name-pattern classification` — 182 pass, 0 fail. Measured coverage of `plugins/sp/lib/destructive-policy.ts`: 100% functions, 99.76% lines. The uncovered line is 272, the `continue` after a backtick escape; the allow row for an escaped backtick runs that statement. Both ratios are above the 90% per-file floor.
- `bunx biome check` on the four plugin files — clean after format.
- Light gate `rules:pre` (`bun apps/cli/src/index.ts rule run --preset recommended-pre-check --fail-on warning --no-logo`) — all 51 rules passed.
- `bun apps/cli/src/index.ts rule run --preset recommended-post-check --fail-on warning --no-logo` — all 2 rules passed.
- `bun scripts/spur-dev.ts script-contract-check` — `script-contract-check: hook-only script layout over plugins/sp — 0 violation(s) — PASS`.
- `bun apps/cli/src/index.ts task gate 1313 light` — format-lint PASS, rules:pre PASS, `test:plugins/sp` PASS (434). `rules:post` FAIL: `coverage-provenance-check` reported `lcov-mismatch` because a root `bun test` in this step rewrote `.coverage/lcov.info` after certification (run `9770ed0a-b508-44ea-86ee-f5cef9190929`). The check names `bun run test:full` as the republish. This implement step does not run that full suite. Log: `.spur/run/1313-light-gate.log`.

Probe from throwaway dir `/tmp/spur-1313-probe`.

Allow, stdout empty, exit 0:

```
cd /tmp/spur-1313-probe && bun /Users/robin/xprojects/spur-new-runall-1300-1316-af3570ab/plugins/sp/scripts/hooks/careful-guard.ts < /tmp/spur-1313-probe/allow.json
```

stdin: `{"tool_name":"Bash","tool_input":{"command":"rg 'rm -rf /' ."}}`. Observed stdout: empty. Exit 0.

Ask, exit 0:

```
cd /tmp/spur-1313-probe && bun /Users/robin/xprojects/spur-new-runall-1300-1316-af3570ab/plugins/sp/scripts/hooks/careful-guard.ts < /tmp/spur-1313-probe/ask.json
```

stdin: `{"tool_name":"Bash","tool_input":{"command":"sh -c 'rm -rf /'"}}`. Observed stdout:

`{"hookSpecificOutput":{"hookEventName":"PreToolUse","permissionDecision":"ask","permissionDecisionReason":"This command looks like a recursive remove outside the project (rm -r on an absolute, ~, or ../ path) — a destructive operation. Confirm you intend to run it. Set SPUR_CAREFUL=off to disable this guard."},"systemMessage":"This command looks like a recursive remove outside the project (rm -r on an absolute, ~, or ../ path) — a destructive operation. Confirm you intend to run it. Set SPUR_CAREFUL=off to disable this guard."}`

Testing, Review, and status stay with the pipeline. Status remains `todo`.


Review follow-up (2026-11-06): a redirection `&` is no longer read as a pipeline separator, so `rg "rm -rf /" x 2>&1 | bash` keeps the pipe-into-executor rule; `-c` detection now steps over value-taking shell options (`-O extglob`, `--rcfile`). Regressions in `plugins/sp/tests/hooks/destructive-policy.test.ts`.

### Testing

**Pipeline verify results**

- Verdict: PASS (from verdict artifact)

| Requirement | Status | Evidence |
|-------------|--------|----------|
| R1 | MET | `plugins/sp/lib/destructive-policy.ts:18-27` documents executable-position lexing; `plugins/sp/lib/destructive-policy.ts:621` `classifyCommand` entry; `plugins/sp/tests/hooks/destructive-policy.test.ts:93-96` single-quoted rg/grep literals allow; `plugins/sp/tests/hooks/destructive-policy.test.ts:210-211` substitutions in operands ask; plugins/sp destructive-policy 568 pass / 0 fail. |

| Acceptance Criteria | Status | Evidence Type | Evidence |
|---------------------|--------|---------------|----------|
| AC1 — Destructive-command policy distinguishes literal data from execution (req: R1) | MET | test | `plugins/sp/tests/hooks/destructive-policy.test.ts:315` matrix runs each case (literals `:93-113` allow; `:153`, `:210`, `:220`, `:230` execution asks); `plugins/sp/tests/hooks/destructive-policy.test.ts:335` redirect does not hide the pipe; `plugins/sp/tests/hooks/destructive-policy.test.ts:389` Claude Code adapter parity — pass this session. |
- Coverage: N/A (verdict-based; verify pipeline does not measure code coverage)

### Review

#### Review Report — 1313
**Scope:** working-tree diff for 1313 (no `(1313)` commit): `plugins/sp/lib/destructive-policy.ts`, `plugins/sp/scripts/hooks/careful-guard.ts`, `plugins/sp/tests/hooks/destructive-policy.test.ts`, `plugins/sp/tests/hooks/careful-guard.test.ts`
**Dimensions:** functional, security, efficiency, correctness, usability, architecture
**Verdict:** PARTIAL
Confidence: LOW

##### Findings (ranked)

| # | Priority | Dimension | Finding | Location | Disposition |
| --- | --- | --- | --- | --- | --- |
| 1 | P2 (major) | security | Path-qualified and wrapped `-c` scripts skip recursive classification. `isShellBin` (`plugins/sp/lib/destructive-policy.ts:522-524`) accepts only the exact words sh, bash, and zsh, and `classifySegment` tests `head.text` (`plugins/sp/lib/destructive-policy.ts:649-653`). Pipeline consumers already use the argv0 basename (`plugins/sp/lib/destructive-policy.ts:617-632`), so a search piped to `/bin/sh` asks (`plugins/sp/tests/hooks/destructive-policy.test.ts:157`). The `-c` path does not. Bare `sh -c` of an escape-normalized `r\m -rf /` asks; `/bin/sh -c`, `/usr/bin/bash -c`, `/bin/zsh -c` of `git\ push --force`, `/usr/bin/env sh -c`, `env /bin/sh -c`, and `command /bin/sh -c` of the same escaped script allow. `sudo`, `exec`, `nice`, and `xargs` before `sh -c` allow the same script. The same miss false-asks `/bin/sh -c` around a literal rg search that bare `sh -c` allows (`plugins/sp/tests/hooks/destructive-policy.test.ts:112`). AC1's no-false-prompt clause and its nested-execution clause are unmet for those spellings. | `plugins/sp/lib/destructive-policy.ts:649-653` | FIXED in 1d9722a82 — basename `isShellBin` (`plugins/sp/lib/destructive-policy.ts:540`) and wrapper-aware head (`:696`); guarded by `plugins/sp/tests/hooks/destructive-policy.test.ts:320`; all 13 listed spellings probed 2026-11-06 re-verify (ask/allow as required) |

The hook still decides only through `classifyCommand` at `plugins/sp/scripts/hooks/careful-guard.ts:89`. The lexer stays private in `plugins/sp/lib/destructive-policy.ts`. No separate architecture finding. Literal searches, bare nested shells, and the basename pipeline rule are covered by the shared matrix and the hook parity describe in `plugins/sp/tests/hooks/destructive-policy.test.ts:277-314`.

##### Functional Traceability

| Req | Status | Evidence |
| --- | --- | --- |
| R1 | PARTIAL | Literal rg/grep allow at `plugins/sp/tests/hooks/destructive-policy.test.ts:93` and hook payload `plugins/sp/tests/hooks/careful-guard.test.ts:133`. Bare `sh -c` still asks at `plugins/sp/tests/hooks/destructive-policy.test.ts:176`. Path-qualified `-c` does not re-lex: `plugins/sp/lib/destructive-policy.ts:522-524` and `plugins/sp/lib/destructive-policy.ts:649-653` compare the exact argv0, while pipeline consumers use the basename at `plugins/sp/lib/destructive-policy.ts:617-632`. Focused check `(cd plugins/sp && bun test tests/hooks/destructive-policy.test.ts tests/hooks/careful-guard.test.ts)` 476 pass, 0 fail. |


**Re-verify 2026-11-06 (forced `/sp:dev-verifyall`):** finding 1 is resolved. The current code classifies every path-qualified, `env`/`command`/`sudo`/`exec`/`nice`/`xargs`-wrapped and escape-normalized `-c` spelling above, and `/bin/sh -c` around a literal rg search now allows. Destructive-policy suite: 568 pass / 0 fail. The PARTIAL verdict above is historical; the current verdict lives in Testing.

### References

<!-- Links to the parent feature, design docs, related tasks, or external references. -->

### History

- 2026-11-06T19:43:53.346Z todo → wip (system)
- 2026-11-07T00:57:15.310Z wip → testing (system)
- 2026-11-07T00:58:01.213Z testing → done (system)

