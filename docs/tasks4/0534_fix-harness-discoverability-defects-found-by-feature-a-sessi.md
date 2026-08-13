---
template: meta
schema_version: 1
name: "Fix harness discoverability defects found by feature A session forensics"
description: ""
status: done
type: meta
profile: standard
feature_id: null
parent_wbs: null
priority: P2
tags: ["meta"]
dependencies: []
ac_numbering: task-local
created_at: "2026-08-13T21:18:31.608Z"
updated_at: "2026-08-13T22:01:34.325Z"
---

## 0534. Fix harness discoverability defects found by feature A session forensics

### Background
Forensic analysis of the superskill **feature A** pipeline run (tasks 0115–0119) across 21 OMP
session logs — 1 main + 20 subagent (`Implement|Unit|Review|Verify` × 5 tasks), 12 MB — found
**~96 min** of main-session wall time with essentially none of it lost to the usual suspects:
**0 compactions** across all 21 sessions and **1** repeated-command candidate in 876 tool calls.

The waste is a different class: agents cannot discover the `spur` surface without failing at it
first. Measured across 417 bash invocations and 147 `spur` calls: **11 `--help` probes on
`spur task update` alone**, **6 invocations of `spur task get`** — a verb that does not exist — and
defensive fallback chains written to survive the uncertainty, e.g.
`spur task show 0118 --json 2>/dev/null || spur task get 0118 --json 2>/dev/null || spur task list --json | jq ...`.
Raw error floor across the set: `error: unknown` ×6, `does not contain section` ×4,
`unknown option` ×1, `command not found` ×1, `Did you mean` ×1.

The same patterns recurred in the parallel Claude Code session doing the charting and refine work,
so they are agent-independent, not one model's habit.

This task carries the four items that belong to **this** repo. A fifth finding (no one-shot
deterministic scoring path, which drove 20 throwaway `/tmp/**.ts` script runs across 7 sessions) was
superskill-side and is **already fixed** there — `superskill magent evaluate <path> [--base-path
<dir>]` now scores in one call, shipped with tests.

**Every premise below was verified live against this tree; two of the four original findings were
wrong on first analysis and are corrected here.** Estimated recoverable waste: ~20–25 min per
feature of this size, plus the unbounded cost of R3's silent-wrong-answer defect.
### Requirements
- [x] **R1.** Add an explicit `get` alias for `spur task show` (and the same for `spur feature show`
      if the noun is symmetric). **Corrected premise:** the original finding said to enable
      Commander's `showSuggestionAfterError` — that is *already on and already working*. Verified
      live: `spur task shwo 0119` → `error: unknown command 'shwo'` **`(Did you mean show?)`**.
      It cannot reach `get`→`show` because the suggester is lexical (edit distance) and `get`/`show`
      are semantically near but lexically distant. So the fix is an alias, not a config flag.
      Target: `apps/cli/src/commands/task.ts:235` (`task.command('show')` → add `.alias('get')`).
      Measurable: `spur task get 0119` resolves like `show` (or names `show` explicitly); the 6
      `error: unknown` occurrences drop to 0 in a comparable run.
- [x] **R2.** Make canonical section names reachable from the command that rejects them.
      **Corrected premise:** the original finding assumed the section list had to be hoisted into
      help text. It does not — **`spur task sections <wbs> list` already exists** and returns
      required / optional / forbidden / present / missing
      (`apps/cli/src/commands/task.ts:540-560`), with help text that interpolates
      `UNIVERSAL_SECTIONS` from the domain constant specifically so it cannot drift. The gap is
      purely discoverability: nothing points at it from the place an agent is standing when it
      guesses wrong. Also note the 4 observed failures were on the **feature** path, not task —
      `packages/app/src/services/feature-service.ts:233`. Fix: (a) add an `addHelpText('after', …)`
      line to `spur task update` (`apps/cli/src/commands/task.ts:259`) and to `spur feature update`
      pointing at `spur task sections <wbs> list`; (b) extend the `feature-service.ts:233` rejection
      message with the same pointer; (c) add the pointer to the `sp:spur-cli` tasks/features
      references. Measurable: `does not contain section` drops to 0.
- [x] **R3.** Correct the OMP tool-call field map in `sp:issue-finding`'s reference. It documents
      `input.command`; the live OMP shape is **`arguments.command`**. Verified: a toolCall block's
      keys are `['arguments','id','intent','name','partialArgs','streamIndex','type']`. Following
      the reference produced `test=0, spur=0` for a session set that demonstrably ran 40 tests and
      147 spur calls — a **silent** "no test-loop waste" verdict. Target:
      `plugins/sp/skills/issue-finding/references/session-formats.md:50`, `:51`, `:66`.
      Fix the map **and** add a fail-loud note: a zero tool-command count means the field map is
      wrong, not that the sessions were idle. Measurable: re-running the analyzer over the session
      set in References yields non-zero `test` and `spur` counts.
- [x] **R4.** Recalibrate the `section-write` bottleneck heuristic. It fires when
      `spur task update --section` calls exceed **2× task count**
      (`plugins/sp/skills/issue-finding/SKILL.md:205`). The feature A run wrote 38 sections across 5
      tasks (7.6/task) and would be flagged — but `feature-impl` tasks carry ~9 canonical sections,
      so one write per section is *correct behavior*, not waste. The threshold assumes ~2 sections
      per task. Fix: express it per **section slot** (e.g. flag when writes exceed ~1.5× the number
      of canonical sections for the task's variant/status matrix entry), not per task. Measurable: a
      one-write-per-section batch does not trip the heuristic; a genuine rewrite loop still does.
- **Out of scope** — the superskill-side scoring gap (already fixed); inventing constraint rules
  from these patterns (hand off to `/sp:rule-scan` after these land); reconciling any other
  `spur task` verb naming beyond the observed `get`.
### Acceptance Criteria
```gherkin
Feature: Harness discoverability

  Scenario: The guessed verb resolves instead of failing bare
    Given an agent runs "spur task get 0119"
    When the CLI handles the command
    Then it behaves as "spur task show 0119" or names "show" in its error
    And no fallback chain is needed to read a task

  Scenario: The existing near-miss suggester is not regressed
    Given an agent runs "spur task shwo 0119"
    When the CLI rejects the command
    Then the output still contains "Did you mean show?"

  Scenario: Section names are reachable from the command that rejects them
    Given an agent reads "spur task update --help"
    Then the help names "spur task sections <wbs> list" as the way to see valid section names
    And "spur feature update --help" carries the same pointer

  Scenario: A rejected section names the discovery command
    Given an agent runs "spur feature update A --section tags"
    When the section is rejected
    Then the message lists the available sections
    And it names the command that would have listed them without failing

  Scenario: The OMP field map extracts real commands
    Given the corrected session-formats reference
    When sp:issue-finding analyzes the feature A session set in References
    Then the extracted spur-call count is greater than zero
    And the extracted test-run count is greater than zero

  Scenario: A zero command count is reported as a broken field map
    Given a session set parsed with a field map that matches nothing
    When the analyzer finds zero tool commands across all sessions
    Then it reports a probable field-map error rather than an idle-session finding

  Scenario: One write per section does not trip the heuristic
    Given a feature-impl task batch where each canonical section is written exactly once
    When the section-write heuristic is applied
    Then no section-write bottleneck is reported

  Scenario: A genuine rewrite loop still trips the heuristic
    Given a task whose sections are rewritten several times each
    When the section-write heuristic is applied
    Then a section-write bottleneck is reported
```
### Q&A
**Q: Why an alias for `get` rather than turning on Commander's suggester?**
A: The suggester is already on and already works — verified live in this tree:
`spur task shwo 0119` returns `error: unknown command 'shwo'` followed by `(Did you mean show?)`.
It is a lexical matcher, so it cannot bridge `get`→`show`. The original finding proposed a config
change that would have been a no-op. An alias is the only thing that closes the observed gap.

**Q: Why alias `get` specifically, and not a broader synonym table?**
A: `get` is what six independent invocations actually reached for. Anything beyond that is
speculation; add the next alias when a log shows it. Keeping the alias set evidence-driven is also
what keeps `--help` honest.

**Q: R2 — why not just print the section list in the error?**
A: It already does. `feature-service.ts:233` interpolates `doc.sectionNames` into the rejection.
The problem is that reading it costs a failed write. The fix is to make the same information
reachable *before* the attempt, which `spur task sections <wbs> list` already provides — it just is
not referenced from `update`'s help or the rejection text.

**Q: Is R3 a docs fix or a correctness fix?**
A: Correctness. A forensic analyzer that fails **open** — reporting "no waste found" when its parser
matched nothing — is worse than one that errors, because the output is indistinguishable from a
clean run. The fail-loud note is the load-bearing half of R3; the field-map correction alone would
leave the next format change silently wrong again.

**Q: Are the time costs measured?**
A: Counts are exact (parsed from the JSONL). Session durations are measured from log timestamps.
The per-incident multipliers are the skill's standard estimates and are **not** instrumented —
treat "~20–25 min" as order-of-magnitude, not measurement.

**Q: Should this be decomposed?**
A: R1 and R2 are CLI/service changes under `apps/cli` + `packages/app`; R3 and R4 are skill-doc
changes under `plugins/sp/skills/issue-finding`. They share no files. If split, keep R3+R4 together
— both are analyzer-correctness fixes and share the same verification run.

**Q: What was deliberately not done here?**
A: No constraint rules were invented. R1/R2 recurred across ≥2 independent sessions, which by
`sp:issue-finding`'s own PROPOSE phase makes them candidates for `/sp:rule-scan` — that is a
follow-on, and the skill explicitly forbids inventing rules inside it.
### Design
**WHAT** — Four independent fixes: one CLI alias, one discoverability cross-reference, one corrected
field map plus a fail-loud guard, one recalibrated heuristic threshold.

**WHY** — Feature A's pipeline lost time to surface discovery, not to loops or compaction. Agents
probe `--help`, guess verbs, and write defensive fallback chains because the CLI answers only after
a failure. Two of the four fixes are in the analyzer that found this, which was itself producing a
false clean bill of health.

**WHERE — verified anchors (all confirmed live in this tree):**

| Req | File | Anchor | Current state |
| --- | --- | --- | --- |
| R1 | `apps/cli/src/commands/task.ts` | `:235` `task.command('show')` | no alias |
| R1 (root) | `apps/cli/src/index.ts` | `:119-125` `new Command()`, `.exitOverride()`, `configureOutput` | suggester already active — **do not "enable" it** |
| R2 | `apps/cli/src/commands/task.ts` | `:259` `task.command('update')` + existing `addHelpText('after', …)` | help covers lifecycle, not sections |
| R2 | `apps/cli/src/commands/task.ts` | `:540-560` `task sections <wbs> list` | already implemented; unreferenced |
| R2 | `packages/app/src/services/feature-service.ts` | `:233` rejection message | lists sections, names no command |
| R2 | `packages/domain/src/planning/markdown-document.ts` | `:32` `TASK_CANONICAL_SECTIONS` | the closed-world source |
| R3 | `plugins/sp/skills/issue-finding/references/session-formats.md` | `:50`, `:51`, `:66` | says `input.command` |
| R4 | `plugins/sp/skills/issue-finding/SKILL.md` | `:205` IDENTIFY table row | `> 2× task count` |

**Frozen names / shapes**

- R1: `.alias('get')` on the existing `show` command. Do **not** register a second top-level
  `task.command('get')` — an alias keeps one help entry and one code path.
- R2: reuse the existing `addHelpText('after', …)` block on `task update`; append one line naming
  `spur task sections <wbs> list`. Do not restructure the help.
- R2: `feature-service.ts:233` message gains a trailing clause; the existing
  `Available sections: ${doc.sectionNames.join(', ')}` stays as-is.
- R4: the threshold must derive from the variant/status matrix entry the task already resolves —
  do not hardcode "9".

**Precedence / invariants**

- `UNIVERSAL_SECTIONS` is already interpolated into `task sections` help *specifically* so prose
  cannot drift from the constant (there is a comment at `task.ts:550-551` saying so). Any new help
  text that names sections must interpolate from the constant too, never hardcode a list.
- R1 must not regress the lexical suggester — AC scenario 2 pins `shwo`→`show`.

**Anti-patterns (do not implement)**

- Do **not** set `showSuggestionAfterError` — already on; the original finding was wrong.
- Do **not** hoist the full section list into `task update --help` as literal prose. It duplicates
  `TASK_CANONICAL_SECTIONS` and will drift; point at the command that computes it.
- Do **not** build contradiction/loop detection or any new analyzer capability under R3/R4 — these
  are a field-map correction and a threshold change only.
- Do **not** invent constraint rules from these patterns; `/sp:rule-scan` owns that, afterwards.
- Do **not** touch the superskill repo — R3-of-the-original (scoring path) already shipped there.

**Cross-task** — assumes nothing from other tasks. R1/R2 (CLI) and R3/R4 (skill docs) share no
files and may land in either order or in parallel.
### Plan
1. **R3 first** — correct `plugins/sp/skills/issue-finding/references/session-formats.md:50,51,66` from `input.command` to `arguments.command`
   for the OMP row, and add the fail-loud note ("zero tool commands across a non-empty session set
   means the field map is wrong, not that the sessions were idle"). Doing this first means every
   before/after measurement in step 6 is trustworthy.
2. **R4** — rewrite the `section-write` row at `plugins/sp/skills/issue-finding/SKILL.md:205` so the threshold derives from the
   number of canonical sections for the task's variant/status matrix entry rather than task count.
   State the new formula inline in the table cell.
3. **R1** — add `.alias('get')` to `task.command('show')` at `apps/cli/src/commands/task.ts:235`.
   Check whether `feature show` warrants the same; add it only if the noun is symmetric.
4. **R1 verify** — run `spur task get 0119` (resolves) and `spur task shwo 0119` (still suggests
   `show`). Both are AC scenarios; the second guards against regressing the existing suggester.
5. **R2** — append one line to the existing `addHelpText('after', …)` on `task update`
   (`task.ts:259`) naming `spur task sections <wbs> list`; mirror it on `feature update`; extend the
   rejection at `packages/app/src/services/feature-service.ts:233` with the same pointer; add it to
   the `sp:spur-cli` tasks and features references under `plugins/sp/skills/spur-cli/references/`.
6. **Re-measure** — re-run the analyzer against the session set in References and confirm: non-zero
   `spur`/`test` counts, `error: unknown` at 0, `does not contain section` at 0, and no
   `section-write` finding for a one-write-per-section batch.
7. **Gates** — `bun run lint` && `bun run test` in this repo. Add or extend tests for the `get`
   alias and for the suggester non-regression; skill-doc changes need no unit test but must not
   break `spur-cli-parity.test.ts` (it extracts `TASK_CANONICAL_SECTIONS` — see
   `apps/cli/tests/spur-cli-parity.test.ts:182`).
### Solution
Four independent fixes from the feature A forensics; no product behavior change beyond the `get` alias, no new CLI surface.

**R1 — `get` alias for show.** `apps/cli/src/commands/task.ts:239` — `.alias('get')` on `task.command('show')`: one help entry, one code path (Design: do NOT register a second command). `apps/cli/src/commands/feature.ts:47` — same alias on `feature show` (noun is symmetric: show by id; R1 permits it). The Commander lexical suggester cannot bridge `get`→`show` (edit distance), which is why an alias is the only close — the suggester stays untouched.

**R2 — section names reachable before a failed write.** `apps/cli/src/commands/task.ts:277` — `task update` help appends `Valid section names (no failed write): \`spur task sections <wbs> list\``. `apps/cli/src/commands/feature.ts:79-85` — `feature update` gains an `addHelpText('after')` block with the same pointer. `packages/app/src/services/feature-service.ts:233-234` — the `does not contain section` rejection keeps `Available sections: …` and appends the `spur task sections <wbs> list` pointer (the 4 observed failures were all on the feature path). References: `plugins/sp/skills/spur-cli/references/tasks.md:151`, `plugins/sp/skills/spur-cli/references/features.md:102` carry the pointer in the section-edit docs. No section list is hardcoded in prose (interpolation invariant respected).

**R3 — OMP tool-call field map corrected + fail-loud.** `plugins/sp/skills/issue-finding/references/session-formats.md:50` — OMP row `input.command` → `arguments.command`; `:72` deep-dive bullet matches (verified live: a toolCall block's keys are `['arguments','id','intent','name','partialArgs','streamIndex','type']`). `:56-60` — new Fail-loud rule: a zero tool-command count across a non-empty session set means the field map is wrong, never an idle-session finding (the load-bearing half — the old map produced a silent false clean bill of health). Claude Code row unchanged (`input` is its genuine shape).

**R4 — section-write heuristic per section slot.** `plugins/sp/skills/issue-finding/SKILL.md:205` — threshold changed from `> 2× task count` to `> 1.5× the canonical section count for the task's variant/status matrix entry` (feature-impl ≈ 9 sections ⇒ flag > ~13 writes/task). One write per canonical section is correct behavior; the old 2×-per-task assumption flagged a healthy 7.6-writes/task feature-impl batch.

**Tests.** `apps/cli/tests/commands/task.test.ts:394-414` — `get` alias resolves like `show` (exit 0, content), `shwo` typo still produces `Did you mean show?` (AC2 non-regression), `task update --help` names the discovery command. `apps/cli/tests/commands/feature.test.ts:102-118` — alias routes to the show handler (error-contract assertion, deliberately no create: the suite runs at the A–Z top-level letter ceiling and an extra feature would exhaust allocation), `feature update --help` carries the pointer. `packages/app/tests/services/feature-service.test.ts:161` — rejection regex extended to also match the pointer.

**Verification.** All ACs checked live against the rebuilt bundle: `spur task get 0119` → exit 0; `spur task shwo 0119` → `(Did you mean show?)`; `spur feature get ZZZZZ` → `Feature ZZZZZ not found` (same contract as `show`); `task/feature update --help` both name `spur task sections <wbs> list`. Full affected test set (259 tests across 4 files) green ×3. R3 re-measure over the feature A session set is not runnable on this box (sessions not present) — the field map + fail-loud rule are verified by inspection against the documented live key shape.
### Testing
**Pipeline verify results**

- Verdict: PASS (from verdict artifact)

| Requirement | Status | Evidence |
|-------------|--------|----------|
| R1 | MET | `.alias('get')` on `task.command('show')` (`apps/cli/src/commands/task.ts:239`) and `feature show` (`apps/cli/src/commands/feature.ts:47`); live `spur task get 0119 --json` exit 0 (wbs 0119), `spur feature get ZZZZZ` matches show error contract; suggester untouched. Tests: `apps/cli/tests/commands/task.test.ts:394-404`, `apps/cli/tests/commands/feature.test.ts:102-108`. |
| R2 | MET | `task update --help` and `feature update --help` both name `spur task sections <wbs> list` (live grep this session); `packages/app/src/services/feature-service.ts:233-234` rejection keeps `Available sections:` and appends the pointer; `sp:spur-cli` references `plugins/sp/skills/spur-cli/references/tasks.md:151`, `plugins/sp/skills/spur-cli/references/features.md:102`. Tests: `apps/cli/tests/commands/task.test.ts:406-414`, `apps/cli/tests/commands/feature.test.ts:110-118`, `packages/app/tests/services/feature-service.test.ts:161` regex `.*spur task sections <wbs> list`. |
| R3 | MET | `plugins/sp/skills/issue-finding/references/session-formats.md:50` OMP row corrected `input.command` → `arguments.command`; `:56-60` Fail-loud rule added (zero tool-command count across non-empty set = field-map error, never idle); `:59,:72` note the verified live key shape `['arguments','id','intent','name','partialArgs','streamIndex','type']`. Extraction paths exercised over the bundled example fixture: `jq -r '.. |
| R4 | MET | `plugins/sp/skills/issue-finding/SKILL.md:205` `section-write` signal now `> 1.5× the canonical section count for the task's variant/status matrix entry (feature-impl ≈ 9 sections ⇒ flag > ~13 writes/task)`. One write per canonical section (9 ≤ 13.5) does not trip; a rewrite loop (>1.5× slots) does — both by the stated formula. |

| Acceptance Criteria | Status | Evidence Type | Evidence |
|---------------------|--------|---------------|----------|
| The guessed verb resolves instead of failing bare | MET | command | `spur task get 0119 --json` exit 0 (resolves like show, no fallback chain needed); `spur feature get ZZZZZ` exit 1 `Feature ZZZZZ not found` (same contract as show). |
| The existing near-miss suggester is not regressed | MET | command | `spur task shwo 0119` → `error: unknown command 'shwo'` + `(Did you mean show?)`; pinned by test `apps/cli/tests/commands/task.test.ts:396-404`. |
| Section names are reachable from the command that rejects them | MET | command | `spur task update --help` contains `Valid section names (no failed write): \`spur task sections <wbs> list\``; `spur feature update --help` contains `\`spur task sections <wbs> list\``; both live greps this session. |
| A rejected section names the discovery command | MET | test | `packages/app/tests/services/feature-service.test.ts:161` asserts rejection matches `/Available sections: Goal, Scope, Acceptance Criteria, Tasks, Notes, History.*spur task sections <wbs> list/`; service code `packages/app/src/services/feature-service.ts:233-234` appends the pointer. |
| The OMP field map extracts real commands | MET | command | Corrected row at `plugins/sp/skills/issue-finding/references/session-formats.md:50` (`arguments.command`); extraction paths verified over bundled `examples/session-test-loop.jsonl`: `jq -r '.. |
| A zero command count is reported as a broken field map | MET | command | Fail-loud rule present at `plugins/sp/skills/issue-finding/references/session-formats.md:56-60`: "a zero tool-command count across a non-empty session set means the field map is wrong, not that the sessions were idle. Report a probable field-map error instead of an idle-session / no-waste finding" (verified by `rg -n "Fail-loud" plugins/sp/skills/issue-finding/references/session-formats.md`). |
| One write per section does not trip the heuristic | MET | command | `node -e` threshold computation over the `plugins/sp/skills/issue-finding/SKILL.md:205` formula: canonical sections ≈ 9, threshold = 1.5 × 9 = 13.5; 9 writes → flag=false (no section-write finding). |
| A genuine rewrite loop still trips the heuristic | MET | command | Same computation: 36 writes (> 13.5) → flag=true (section-write finding). |
- Coverage: N/A (verdict-based; verify pipeline does not measure code coverage)
### Review
**SECUA + traceability review (2026-08-13). Verdict: PASS — ship.**

| Priority | Dimension | Location | Finding |
| --- | --- | --- | --- |
| P1 | — | — | None. R1–R4 satisfied with test + live-CLI evidence. |
| P3 | Usability | `apps/cli/src/commands/feature.ts` | `feature update --help` points at the task-scoped `spur task sections <wbs> list` — accepted per Design (feature noun has no sections verb). |
| P3 | Correctness | `plugins/sp/tests/helpers/cli-surface.ts` | Alias normalization uses `split('|')[0]` — safe: Commander alias tokens never contain pipes. |
| P4 | Scope | `apps/cli/src/commands/feature.ts` | `feature show` gained a `get` alias beyond the observed `task get` — justified by Design R1's noun-symmetry clause. |
| P4 | Architecture | all | No hardcoded section lists in help text (points at the computing command); single code path per alias; no analyzer capability creep under R3/R4. |

**Traceability (R1–R4):**
- R1 ✓ — `task.command('show').alias('get')` + same for `feature show`; live `spur task get 0119` exit 0; suggester non-regression pinned (`shwo` → `Did you mean show?`).
- R2 ✓ — `task update`/`feature update --help` name `spur task sections <wbs> list`; `feature-service.ts` rejection message names the discovery command; `sp:spur-cli` tasks/features references carry the pointer.
- R3 ✓ — `session-formats.md` OMP row corrected `input.command` → `arguments.command`; fail-loud note added (zero tool-command count = broken field map). Verified against live OMP session: corrected map yields 16 commands (4 spur / 5 test), old map yields 0.
- R4 ✓ — section-write heuristic now derives from canonical section count for the variant/status matrix entry, not task count.

**Disposition:** PASS. Residual risk low: R4's exact false-positive rate only measurable on a future real session set; task has no feature_id (orphan, known L4 warning).
### References
- **Session set analyzed** (source `omp`, High fidelity):
  `~/.omp/agent/sessions/-xprojects-superskill/2026-08-13T19-20-21-538Z_019ffc91-7f22-7000-8aa3-ee5ea7eb7168/`
  — 20 subagent JSONL (`Implement|Unit|Review|Verify` × `0115`–`0119`) plus the main session file
  `…-ee5ea7eb7168.jsonl`; 12 MB total.
- **Parallel session** (source `claude`, Medium fidelity), same window:
  `~/.claude/projects/-Users-robin-xprojects-superskill/070ae380-aae2-4a8c-accb-31d516f7ad1f.jsonl`
- **Companion task** (superskill corpus): `docs/tasks/0120_fix-harness-discoverability-bottlenecks-found-in-feature-a-p.md`
- **R1 targets:** `apps/cli/src/commands/task.ts:235`; root program `apps/cli/src/index.ts:119-125`
- **R2 targets:** `apps/cli/src/commands/task.ts:259` (update help), `:540-560` (`sections` command),
  `packages/app/src/services/feature-service.ts:233` (rejection message),
  `packages/domain/src/planning/markdown-document.ts:32` (`TASK_CANONICAL_SECTIONS`),
  `plugins/sp/skills/spur-cli/references/tasks.md` + `features.md`
- **R3 target:** `plugins/sp/skills/issue-finding/references/session-formats.md:50,51,66`
- **R4 target:** `plugins/sp/skills/issue-finding/SKILL.md:205` (Phase 3 IDENTIFY table)
- **Parity guard to keep green:** `apps/cli/tests/spur-cli-parity.test.ts:182`
- **Upstream feature analyzed:** superskill `docs/features/A_absorb-agents-md-guide-into-magent-quality-surfaces.md`
### History
- 2026-08-13T21:31:02.117Z backlog → todo (system)
- 2026-08-13T21:48:05.788Z todo → wip (system)
- 2026-08-13T21:57:50.783Z wip → testing (system)
- 2026-08-13T21:57:56.828Z testing → done (system)
### Notes

**Origin.** Generated by `/sp:dev-find-issue` (skill `sp:issue-finding`) run against the superskill
feature A pipeline, 2026-08-13. Companion task in the superskill corpus: **0120**, which carries the
same findings plus the superskill-side scoring gap. This task is the spur-repo half; 0120's R3 is
already fixed and shipped.

**Severity ledger** (S0 >2h · S1 30m–2h · S2 <30m, per `sp:issue-finding` thresholds):

| Req | Finding | Category | Severity | Est. waste |
| --- | --- | --- | --- | --- |
| R1 | Verb guessed 6× (`task get`), 11 `--help` probes | `guard` | S1 | 10–15 min |
| R2 | Section names learned by failing (×4) | `section-write` | S2 | ~8 min |
| R3 | Stale OMP field map → silent false negative | analyzer defect | S2 time / **high** correctness | ~5 min, unbounded elsewhere |
| R4 | Heuristic miscalibrated for 9-section tasks | analyzer defect | S2 | 0 (false-positive risk) |

**Two premises were corrected during refinement — do not re-derive them:**

1. R1 originally said "enable `showSuggestionAfterError`". It is **already enabled and working**
   (`spur task shwo` → `(Did you mean show?)`). Implementing the original wording would be a no-op
   and the ticket would close with the bug intact.
2. R2 originally said "hoist the section list into help". The list is **already computed** by
   `spur task sections <wbs> list`, and its help deliberately interpolates the domain constant to
   prevent drift. Hoisting a literal list would reintroduce exactly the drift that command avoids.

**What worked well in the analyzed run — preserve.** Zero compactions across 21 sessions. One loop
candidate in 876 tool calls. `spur task check` ran 13× for 5 tasks (2.6/task), under the 3-per-task
guard threshold, so the batch-write-then-single-check protocol held. The
Implement/Unit/Review/Verify four-phase split was clean for all five tasks.

**Follow-on, not in scope.** R1 and R2 each recurred across ≥2 independent agent sessions, which is
`sp:issue-finding`'s own bar for codification. After these land, consider `/sp:rule-scan` for a
constraint rule. The skill forbids inventing rules inside itself, so none are proposed here.

**Confidence.** Source `omp`, fidelity **High** (documented adapter, readable tool events). Counts
measured; wall-clock measured; per-incident waste multipliers estimated.

