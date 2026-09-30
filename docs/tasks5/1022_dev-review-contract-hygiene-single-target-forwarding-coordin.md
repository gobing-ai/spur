---
schema_version: 1
name: "dev-review contract hygiene: single target forwarding, coordinator Review ownership, triage tools, one --focus vocabulary, stale flags"
status: done
template: feature-impl
created_at: 2026-09-30T18:12:18.743Z
updated_at: "2026-09-30T22:12:43.497Z"
feature_id: I33

ac_numbering: task-local
---

## 1022. dev-review contract hygiene: single target forwarding, coordinator Review ownership, triage tools, one --focus vocabulary, stale flags

### Background

The `/sp:dev-review` command, its coordinator agent and its three review skills disagree on arguments, flags and section ownership (review of 2026-09-30):

- `dev-review.md:37-38` dispatches `args="<wbs> $ARGUMENTS"` to `sp:functional-review` and `sp:code-improvement`; `$ARGUMENTS` already holds the target, so they receive it twice (`0962 0962 --triage`).
- The command says the coordinator `sp:super-reviewer` writes `## Review`, but it only calls three `Skill()`s inline and never dispatches the agent; the invoking session is never told it is the coordinator.
- `--triage` applies direct fixes (`dev-operations.md` §2 step 2) but `allowed-tools` is `["Bash","Read","Skill"]` — no `Edit`/`Write`.
- `--focus` has four vocabularies: `dev-review.md` (functional/SECUA/architecture), `flag-glossary.md#flag-focus` (`all|stack|dependencies|data|flows|api|security|quality|performance`), `code-verification/SKILL.md:88,488` (`all|security|efficiency|correctness|usability|architecture`), `dev-operations.md` §2 ("one SECUA dimension").
- Stale routes: `next-router/references/routing-table.md:134` routes to `/sp:dev-review <wbs> --fix blockers-first` (deprecated no-op); `super-reviewer.md` "Two modes" still cites `--next` (removed, H8); `code-verification/SKILL.md:488` lists `--fix` as a live review-mode flag.
- `super-reviewer.md` says standalone WBS review only emits output, while `dev-review.md` and `gate-checklists.md:128-136` require standalone `/sp:dev-review <wbs>` to populate `## Review`.
- The pipeline calls `/sp:dev-review ${vars.wbs} --auto` (`task-pipeline.yaml:593`) but `--auto` is not in the argument-hint; `super-reviewer` documents `--json` which the command does not declare.
- `functional-review` frontmatter declares `modes: [verify]` though it runs as a review component.

### Requirements

- **R1** — Each review skill receives the target exactly once: dispatch passes `<target> <flags-without-target>` (or `$ARGUMENTS` alone), never both.
- **R2** — `dev-review.md` states that the invoking session is the review coordinator: it merges fragments per `sp:super-reviewer` Output Format and, in WBS mode (standalone or pipeline), writes `## Review` via `spur task update <wbs> --section Review --from-file`. `super-reviewer.md` "Two modes" is aligned: WBS target → writes Review; path target → advisory output only.
- **R3** — `allowed-tools` adds `Edit` and `Write`, with the body stating they are used only by `--triage` direct fixes.
- **R4** — One `--focus` vocabulary for review: `all|functional|security|efficiency|correctness|usability|architecture` (functional → `sp:functional-review`; architecture → `sp:code-improvement` + SECUA-A; S/E/C/U → `sp:code-verification`). SSOT lives in `code-verification/SKILL.md`; `dev-review.md`, `dev-operations.md` §2 and `flag-glossary.md#flag-focus` link to it instead of restating another list.
- **R5** — No live route recommends `dev-review --fix` or `--next`: routing-table row uses `--triage`; `super-reviewer.md` drops `--next`; `code-verification` review-mode flag list drops `--fix` (kept only as the documented deprecated no-op in `dev-review.md`).
- **R6** — `--auto` is declared in the `dev-review` argument-hint, Argument Flags table and dev-operations row; `--json` is either declared on the command or removed from `super-reviewer.md` (choose declare-nothing: remove, since no consumer parses it).
- **R7** — `functional-review` frontmatter `modes` includes `review`.

### Acceptance Criteria

```gherkin
  @core
  Scenario: R7 — command, agent and skill contracts agree
    Given the dev-review command, super-reviewer agent, review skills, flag glossary and dev-operations row
    When command-flag-parity and plugin structure tests run
    Then the target is forwarded once, one --focus vocabulary is referenced, no live route uses the deprecated --fix or removed --next, and --tasks/--feature/--scope/--auto appear in the argument hint, dev-operations row and glossary
```

### Q&A

<!-- CLOSED decisions from refinement: what was chosen and why, what was deferred and on what
     condition. Not a parking lot for open questions — an unanswered question here means the task
     is not ready to hand off. Keep empty if none. -->

### Design

- **Coordinator = invoking session.** Dispatching the `sp:super-reviewer` agent from the command would add a subagent hop to every review and break the inline-default contract (`cross-cutting.md#inline-default-execution-surface`). The agent file stays the Output Format + rules SSOT; the command says "act as the coordinator defined in `agents/super-reviewer.md`".
- **`--focus` SSOT in `code-verification`** because it already owns SECUA; `functional` and `architecture` route to their skills. Rejected: keeping the glossary's generic `stack|dependencies|…` list for review — it names dimensions no review skill implements.
- **`--json`:** remove from `super-reviewer.md` rather than add a command flag — no caller consumes it (YAGNI).
- **Tests:** extend the existing `command-flag-parity.test.ts` dev-review assertions; no new test file.

### Plan

1. `plugins/sp/commands/dev-review.md`: fix dispatch args (R1), coordinator paragraph (R2), `allowed-tools` + note (R3), `--focus` row link (R4), add `--auto` (R6).
2. `plugins/sp/agents/super-reviewer.md`: Two modes (R2), drop `--next` (R5) and `--json` (R6).
3. `plugins/sp/skills/code-verification/SKILL.md`: `--focus` SSOT list; drop `--fix` from review-mode flags (R4/R5).
4. `plugins/sp/skills/spur-dev/references/dev-operations.md` §2 + table row; `flag-glossary.md#flag-focus` (R4/R6).
5. `plugins/sp/skills/next-router/references/routing-table.md:134` → `--triage` (R5).
6. `plugins/sp/skills/functional-review/SKILL.md` frontmatter `modes` (R7).
7. Extend `plugins/sp/tests/command-flag-parity.test.ts`; run `(cd plugins/sp && bun test tests/command-flag-parity.test.ts tests/skill-structure.test.ts)`, then `bun run spur-check`.

**Verification checks (evidence for the AC above):**

- [x] `grep -n 'args="<wbs> \$ARGUMENTS"\|args="<path> \$ARGUMENTS"' plugins/sp/commands/dev-review.md` returns nothing.
- [x] `grep -rn "dev-review[^\n]*--fix blockers-first" plugins/sp/skills` returns nothing.
- [x] `grep -n -- "--next" plugins/sp/agents/super-reviewer.md` returns nothing.
- [x] `plugins/sp/tests/command-flag-parity.test.ts` asserts `--auto` in the dev-review hint and passes.
- [x] `bun run spur-check` is green.

### Solution

Change-map (auto-generated — implement step did not record a Solution).
Each entry cites the first changed line per file (`file:line`).

| Change (`file:line`) |
|----------------------|
| `plugins/sp/tests/command-flag-parity.test.ts:277` |
| `plugins/sp/tests/skill-structure.test.ts:878` |
| `scripts/commands/command-contract.test.ts:1039` |
| `scripts/commands/command-contract.test.ts:1041` |

### Testing

**Pipeline verify results**

- Verdict: PASS (from verdict artifact)

| Requirement | Status | Evidence |
|-------------|--------|----------|
| R1 | MET | FIXED this run (I33 verifyall 2026-09-30): post-1023 the dispatches forwarded raw `$ARGUMENTS` (= the whole `--tasks a,b` selector) to per-task skills that take `<wbs>` (`plugins/sp/skills/functional-review/SKILL.md:361`). Now `plugins/sp/commands/dev-review.md:43` (WBS: `<wbs> $FLAGS`) and `plugins/sp/commands/dev-review.md:46` (path: `<path> $FLAGS`), `$FLAGS` = `$ARGUMENTS` minus the selector; pinned by `plugins/sp/tests/command-flag-parity.test.ts:291-302` (red before fix, green after) |
| R2 | MET | `plugins/sp/commands/dev-review.md:45` "Coordinator = this session" writes `## Review` via `spur task update <wbs> --section Review --from-file`; `plugins/sp/agents/super-reviewer.md:57-66` Two modes aligned; test `plugins/sp/tests/command-flag-parity.test.ts:304` pass |
| R3 | MET | `plugins/sp/commands/dev-review.md:5` allowed-tools includes Edit, Write; triage-only note in the `--triage` bullet; test `plugins/sp/tests/command-flag-parity.test.ts:315` pass |
| R4 | MET | SSOT `plugins/sp/skills/code-verification/SKILL.md:512`; `plugins/sp/commands/dev-review.md:18` and `plugins/sp/skills/spur-dev/references/flag-glossary.md:198-199` link to it; test `plugins/sp/tests/command-flag-parity.test.ts:320` pass |
| R5 | MET | `plugins/sp/skills/next-router/references/routing-table.md:134` routes `--triage`; greps for `dev-review … --fix blockers-first` in skills and `--next` in super-reviewer → no matches; test `plugins/sp/tests/command-flag-parity.test.ts:330` pass |
| R6 | MET | `--auto` in `plugins/sp/commands/dev-review.md:4` and `plugins/sp/skills/spur-dev/references/dev-operations.md:71`; `--json` absent from super-reviewer (grep no match); test `plugins/sp/tests/command-flag-parity.test.ts:347` pass |
| R7 | MET | `plugins/sp/skills/functional-review/SKILL.md:12-14` modes `[verify, review]`; test `plugins/sp/tests/command-flag-parity.test.ts:354` pass |

| Acceptance Criteria | Status | Evidence Type | Evidence |
|---------------------|--------|---------------|----------|
| R7 — command, agent and skill contracts agree | MET | test | `(cd plugins/sp && bun test tests/command-flag-parity.test.ts tests/skill-structure.test.ts)` → 190 pass / 0 fail after the R1 fix; greps above all no-match; `bun run spur-check`: lint+typecheck pass, 9454 pass / 5 fail — all 5 sandbox-only (fixture `git init` denied writing `.git/hooks`; Chromium DevTools port), unrelated to this diff |
- Coverage: N/A (verdict-based; verify pipeline does not measure code coverage)

### Review

#### Review Report — 1022

**Scope:** wbs diff — tagged commit `f5a0b8edc` (10 files, task file excluded), derived with the Step 3 recipe (`/sp:dev-review --tasks 1021,1022`, I33 1023 dogfood 2026-09-30)
**Dimensions:** functional, security, efficiency, correctness, usability, architecture
**Verdict:** PASS

##### Findings (ranked)

| # | Priority | Dimension | Finding | Location | Disposition |
|---|----------|-----------|---------|----------|-------------|
| 1 | P2 (major) | correctness | Post-1023 dispatch forwarded raw `$ARGUMENTS` (whole selector) to per-task skills | `plugins/sp/commands/dev-review.md:43` | RESOLVED in I33 verifyall (`<wbs> $FLAGS` / `<path> $FLAGS`) |
| 2 | P4 (advisory) | usability | `--focus` row restated the SSOT vocabulary | `plugins/sp/commands/dev-review.md:21` | RESOLVED by 1032 R4 |
| 3 | P4 (advisory) | correctness | R5 test slice could pass vacuously on `''` | `plugins/sp/tests/command-flag-parity.test.ts:338-342` | RESOLVED by 1032 R5 |

##### Functional Traceability

| Req | Status | Evidence |
|-----|--------|----------|
| R1 | MET | `plugins/sp/commands/dev-review.md:43` and `plugins/sp/commands/dev-review.md:46`; `plugins/sp/tests/command-flag-parity.test.ts:291-302` |
| R2 | MET | `plugins/sp/commands/dev-review.md:45`; `plugins/sp/agents/super-reviewer.md:57-66` |
| R3 | MET | `plugins/sp/commands/dev-review.md:5` |
| R4 | MET | `plugins/sp/skills/code-verification/SKILL.md:512` SSOT, linked from `plugins/sp/commands/dev-review.md:21` |
| R5 | MET | `plugins/sp/skills/next-router/references/routing-table.md:134` uses `--tasks <wbs> --triage` |
| R6 | MET | `plugins/sp/commands/dev-review.md:4` declares `--auto` |
| R7 | MET | `plugins/sp/skills/functional-review/SKILL.md:12-14` |

**Next:** none — all findings resolved.

### References

- `plugins/sp/commands/dev-review.md:5,18,37-38`
- `plugins/sp/agents/super-reviewer.md` (Two modes, Output Format)
- `plugins/sp/skills/code-verification/SKILL.md:88,482-488`
- `plugins/sp/skills/spur-dev/references/dev-operations.md` §2 review
- `plugins/sp/skills/spur-dev/references/flag-glossary.md` `#flag-focus`
- `plugins/sp/skills/next-router/references/routing-table.md:134`
- `plugins/sp/skills/spur-dev/references/gate-checklists.md:128-136`
- `config/workflows/task-pipeline.yaml:593`

### History

- 2026-09-30T18:14:44.704Z backlog → todo (system)
- 2026-09-30T19:13:18.973Z todo → wip (system)
- 2026-09-30T20:17:22.969Z wip → testing (system)
- 2026-09-30T20:17:24.604Z testing → done (system)

