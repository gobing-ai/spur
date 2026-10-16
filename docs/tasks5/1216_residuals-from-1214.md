---
schema_version: 1
name: Residuals from 1214
status: cancelled
template: standard
created_at: 2026-10-16T03:36:32.921Z
updated_at: "2026-10-16T05:22:23.172Z"

---

## 1216. Residuals from 1214

### Background

Source task: 1214 (feature A91) — deferred residuals filed by residual-scan settle (unlinked: a deferral must not hold the completing feature open).

- review-finding:b305edce — plugins/sp/lib/destructive-policy.ts:140: The lexical pass recognizes 4 of git's global options, so sibling forms of the *same* defect class still hide a destructive subcommand. Replayed this round against `plugins/sp/lib/destructive-policy.ts:140`: `git --no-pager push --force`, `git -p push -f`, `git --bare push --force`, `git --namespace=x reset --hard` and `git --no-replace-objects push --force` all return null, while git (2.55.0, locally installed) parses those options before the subcommand (they proceed to normal git behavior and fail only on repository lookup — `git --no-pager rev-parse --is-inside-work-tree`). Pre-existing: the pre-diff classifier returned null for every one of these too, and none is in R1's enumerated set — so this is a bounded-scope residual, not a regression introduced here.

### Requirements

<!-- One R-item per line, exactly `- [ ] R1. <text>` (checkbox + `R<n>.`); `spur task check` flags any other form. Keep empty until requirements are known. -->

### Acceptance Criteria

<!-- Number items AC1, AC2, … (never R<n> — that is the Requirements namespace). Preferred: `Scenario: AC1 — <concrete outcome> (req: R1)` blocks with Given/When/Then, declaring both `ac_altitude: task-local` and `ac_numbering: task-local` for task-local regression criteria (altitude skips only the feature-subset check; numbering makes `(req: R<n>)` count toward requirement coverage). Parsed checkbox rows `- [ ] AC1 — <title>` are supported but never bind requirements — only `Scenario:` titles read `(req: R<n>)`. Bare `- AC1` bullets are legacy unparsed records, not a traceability bypass. Requirements use `- [ ] R1. <text>`, checked at close. Keep empty if this task has no objective AC yet. -->

### Q&A

<!-- CLOSED decisions from refinement: what was chosen and why, what was deferred and on what
     condition. Not a parking lot for open questions — an unanswered question here means the task
     is not ready to hand off. Keep empty if none. -->

#### Contained — no deferral remains

Contained in commit `9b1291a1c` (fix(destructive-policy): strip any git global option run before the subcommand).

- **Gap fixed.** The strip matched a four-form whitelist; it now strips a whole option run: value-less flags (`--no-pager`, `-p`, `--paginate`, `--bare`, `--no-replace-objects`, `--literal-pathspecs`, `--glob-pathspecs`, `--icase-pathspecs`, `--no-optional-locks`), glued `--name=value`, and the long options that really consume a separated value (`--git-dir`, `--work-tree`, `--namespace`, `--config-env`, `--attr-source`). `-C`/`-c` keep consuming their next word.
- **Arity grounded, not assumed** (git 2.55.0): glued short forms (`-C.`, `-cfoo=bar`) and a bare `--` are usage errors; `--exec-path` is optional-value, so bare or separated it prints the exec path and exits and is deliberately **not** in the value-taking set — listing it would swallow the subcommand and hide a destructive verb. The glued `--exec-path=<path>` form does reach the subcommand.
- **Regression coverage.** 17 destructive option-prefixed rows and 7 safe controls added to the `plugins/sp/tests/hooks/destructive-policy.test.ts` matrix, which also drives the Claude adapter parity block end-to-end, plus the spawned-hook ask/allow lists in `plugins/sp/tests/hooks/careful-guard.test.ts`. Plugin hooks suite: 399 pass / 0 fail (was 338).
- **Verification.** `bun run lint` (biome + all workspace typechecks) clean; `bun run plugin-smoke` PASS; `bun run script-contract-check` PASS; full `bun run spur-check`: 11223 pass / 0 fail, 2 post-check rules clean, `plugins/sp/lib/destructive-policy.ts` at 100 % funcs / 100 % lines.
- **Class confirmed live while working:** the glued optional-value form `git --exec-path=/tmp/p reset --hard` executed a hard reset; the pre-fix classifier returned null for it.

### Design

<!-- Chosen approach, key tradeoffs, invariants, and impacted surfaces. Keep snippets short. -->

### Plan

<!-- Ordered implementation checklist. Fill before moving to todo/wip. -->

### Solution

<!-- Filled during implementation: file:line change map and concise rationale. -->

### Testing

<!-- Filled during verification: commands run, outcomes, coverage claim or N/A. -->

### Review

<!-- Filled during review: P1-P4 findings, residual risk, and final disposition. -->

### References

<!-- Links to features, docs, ADRs, related tasks, or external references. -->

### History

- 2026-10-16T05:22:23.172Z backlog → cancelled (system)

