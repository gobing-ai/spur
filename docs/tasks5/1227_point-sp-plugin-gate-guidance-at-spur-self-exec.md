---
schema_version: 1
name: Point sp plugin gate guidance at spur self exec
status: done
template: feature-impl
created_at: 2026-10-17T04:04:39.233Z
updated_at: "2026-10-17T07:36:09.786Z"
feature_id: A92
priority: P2
tags:
  - plugin
  - docs
estimate_hours: 2

dependencies: ["1223", "1226"]
done_forced: "false"
done_reason: unforced close; PASS artifact at .spur/memory/evidence/1227-verdict.json
---

## 1227. Point sp plugin gate guidance at spur self exec

### Background

Feature A92 (docs/design/sdlc-actions.md §3.4 plugin row). About 22 sp plugin markdown files instruct agents to run `bun run spur-check`, `bun run lint` or `bun run gate`. Covers R10.

**Refine corrections (2026-10-16)**
- Said ~22 plugin files → `rg -l 'bun run (spur-check|lint|gate)\b' plugins/sp` returns 25 → requirements cover the full list from that query, not a fixed count.
- Assumed `superskill install sp --dry-run` exists → confirmed (`superskill install --help`: `--dry-run`).

### Requirements

- [x] R1. Every hit of `rg -l 'bun run (spur-check|lint|gate)\b' plugins/sp` (25 files at refine time) instructs `spur self exec check|lint|check-feature|autofix` instead, except where R2 applies.
- [x] R2. Bun-specific prose remains only where it documents spur-new's own development setup, and such lines name it as spur-new-specific.
- [x] R3. A pin in plugins/sp/tests/skill-structure.test.ts fails on `bun run (spur-check|lint|gate)` in plugin markdown outside an explicit allowlist (R2 files).
- [x] R4. `superskill install sp --dry-run` completes without errors after the edits.

### Acceptance Criteria

- [x] AC1 — Plugin guidance invokes actions through spur self exec

Requirement map: AC1 → R1–R4. Test layer: plugins/sp/tests/skill-structure.test.ts scanning real plugin markdown.

### Q&A

<!-- CLOSED decisions from refinement: what was chosen and why, what was deferred and on what
     condition. Not a parking lot for open questions — an unanswered question here means the task
     is not ready to hand off. Keep empty if none. -->

#### Q&A entry — 2026-10-17T04:05:56.796Z

- Enforcement lives in the existing plugin skill-structure test, not a new config rule.

#### Q&A entry — 2026-10-17T04:16:48.749Z

- Enforcement lives in the existing plugin skill-structure test, not a new config rule (closed).
- `gate` maps to autofix + check (closed: same effect as today's gate script).

### Design

WHAT: prose migration so agents call the stack-neutral verb in any project.
WHERE: plugins/sp/{commands,skills,agents}/**/*.md from the R1 query; plugins/sp/tests/skill-structure.test.ts.

Mapping: `bun run spur-check` → `spur self exec check`; `bun run spur-check-feature` → `spur self exec check-feature`; `bun run lint` → `spur self exec lint`; `bun run gate` → `spur self exec autofix` followed by `spur self exec check` (gate = write-format + typecheck + tests today).

Anti-patterns: no new config rule (the existing skill-structure test owns plugin prose invariants); do not hand-edit generated per-platform adapters (superskill regenerates them).

Assumes from 1223: the verb and flags exist; from 1226: removed script names are gone, so prose cannot cite them.

### Plan

1. Run the R1 query and save the file list as the artifact.
2. Rewrite each instruction with the mapping; mark any R2 exception.
3. Add the R3 pin with the allowlist.
4. `superskill install sp --dry-run` (R4); `(cd plugins/sp && bun test tests/skill-structure.test.ts)`; `bun run spur-check`.

### Solution

Gate guidance now names the stack-neutral action (`spur self exec check|lint|check-feature|autofix`,
docs/design/sdlc-actions.md §3.1/§3.4) instead of the repo's bun scripts. Action choice follows what
each instruction actually means: full gate → `check`, lint-only step → `lint`, repo-wide once-per-feature
pass → `check-feature`, format+fix → `autofix` (and `gate` — write-format + typecheck + tests — is
stated as `autofix`+`check`, per the closed Q&A decision). Two spur-new-specific lines keep their bun
literal under R2 and are named in the prose; the R3 pin lists exactly those two files.

| File:line | What changed |
| --- | --- |
| `plugins/sp/commands/dev-changelog.md:29` | scribe no-gate list: `spur self exec autofix`/`check`/`lint` instead of `bun run gate`/`spur-check`/lint |
| `plugins/sp/commands/dev-gitmsg.md:20,39` | `--check` example is `spur self exec check`; the no-gate list follows the same mapping |
| `plugins/sp/commands/dev-handover.md:27` | scribe no-gate list, same mapping |
| `plugins/sp/commands/dev-job-dump.md:28` | scribe no-gate list, same mapping |
| `plugins/sp/README.md:357` | `spur-check` catalog row: the full chain is `spur self exec check` |
| `plugins/sp/skills/code-implementation/SKILL.md:107,120,166-167` | `qualityGateCmd` is `spur self exec check`; the implement NEVER-run list and the "never authorizes" clause name actions, not scripts |
| `plugins/sp/skills/code-refactoring/SKILL.md:45` | `--check` default: the project gate is `spur self exec check` when bound |
| `plugins/sp/skills/code-verification/references/secu-review.md:86` | stale-receipt recovery runs `spur self exec check` |
| `plugins/sp/skills/doc-evolve/SKILL.md:80` | doc-evolve gate is `spur self exec lint` |
| `plugins/sp/skills/next-router/references/routing-table.md:118` | C2 cheap workspace health probe is `spur self exec lint` |
| `plugins/sp/skills/spur-check/SKILL.md:3,37` | skill description and the `full` tier row: `spur self exec lint`/`rules-pre`/`test`/`rules-post`, i.e. `spur self exec check` |
| `plugins/sp/skills/spur-cli/references/tasks/l3-guard-cheatsheet.md:84` | evidence example records `spur self exec lint: exit 0` |
| `plugins/sp/skills/spur-cli/references/tasks/verbs.md:359` | AC evidence cell: `spur self exec lint` exit 0 |
| `plugins/sp/skills/spur-dev/references/cross-cutting.md:499,597` | fresh-evidence rule and the tests-green auto-continue rule name the actions |
| `plugins/sp/skills/spur-dev/references/dev-operations.md:571,598,681,689-690,697-698` | gate ownership, the two scribe invariants, fixall steps 1/2/9/10 (lint probe, confirming gate) |
| `plugins/sp/skills/spur-dev/references/done-housekeeping.md:49-51,96-97` | R2: the raw-tail list is labelled as spur-new's own scripts; the manual "establish green" block runs `spur self exec lint` + `test` |
| `plugins/sp/skills/spur-dev/references/execution-batch.md:611` | static-check-first step is `spur self exec lint` |
| `plugins/sp/skills/spur-dev/references/execution-workflow.md:49,328` | `qualityGateCmd` default and the timed-out-implement recovery step |
| `plugins/sp/skills/spur-dev/references/execution-worktree-landing.md:411` | MERGE_HEAD survival note (historical) cites `spur self exec lint` |
| `plugins/sp/skills/spur-dev/references/gate-checklists.md:20,92,182` | verification-command step and the receipt-reuse rule name actions; R2: the sandbox-baseline block keeps `bun run spur-check` and now says "spur-new's" |
| `plugins/sp/skills/spur-dev/references/inline-pipeline-driver.md:427,921,931,954` | detached-gate guidance, measured runtime, the nohup snippet and the one-gate-per-tree lesson |
| `plugins/sp/tests/evals/README.md:17` | eval tier is not wired into `spur self exec check` |
| `plugins/sp/tests/feature-verification-scope.test.ts:5,7` | R2/R3 docblock names `spur self exec check` / `check-feature` |
| `plugins/sp/tests/inline-pipeline-driver.test.ts:283,363` | sandbox comments: the recheck probe is `spur self exec lint` |
| `plugins/sp/tests/skill-structure.test.ts:21,2114,2499-2543` | the R3 pin: `SPUR_NEW_BUN_GATE_ALLOWLIST` (two named, justified files) + two-sided assertions (`bun run` literal outside it fails; an allowlisted file must name spur-new and must still carry a literal); the code-implementation "never authorizes" assertion follows the new prose |

Verification of the rewrite itself (probe, throwaway project root `/tmp/p1227-probe`, `preset: none`
with `lint`/`check` bound — proves the prose works off-bun):

```text
$ spur self exec check --dry-run
printenv SPUR_ACTION >/dev/null && echo "probe lint ok"
spur rule run --preset recommended-pre-check --fail-on warning --no-logo
$ spur self exec lint            # real action
probe lint ok                    # exit 0
$ spur self exec autofix         # unbound in a project that does not declare it
action "autofix" is not bound; add builder.actions.autofix to .spur/config.yaml   # exit 2
```

In this repo the same action resolves through the bun preset:
`spur self exec check --dry-run` → `bun run spur-check`, `spur self exec lint --dry-run` → `bun run lint`.

### Testing

**Pipeline verify results**

- Verdict: PASS (from verdict artifact)

| Requirement | Status | Evidence |
|-------------|--------|----------|
| R1 | MET | Baseline re-derived from `HEAD` (`d9b062578c042bc421f5d8eddb38ea9ce39afd37`) without trusting the implementer's count: `git grep -n -E 'bun run (spur-check\|lint\|gate)' HEAD -- plugins/sp` returns **45 hits** and `git grep -l …` returns **25 files** (git's ERE has no `\b`, so the task's `\b` spelling is ripgrep-only and matches the same 45 lines). Working tree `rg -n 'bun run (spur-check\|lint\|gate)\b' plugins/sp -g '!node_modules'` returns **2 hits**, both inside the two R2 allowlist files. All 25 baseline files are in the change set — `comm -23` of the two sorted path lists is empty, so no hit was dropped by omission — and each of the 25 now carries at least one `spur self exec …` reference (58 plugin-wide: `check` 22, `lint` 19, `autofix` 7, `test` 6, `check-feature` 2, `--list` 2, `rules-pre`/`rules-post`/`format`/`build` 1 each). Action-vs-intent at every site read: full-gate contexts carry `check` (`plugins/sp/skills/code-implementation/SKILL.md:107`, `plugins/sp/skills/spur-dev/references/execution-workflow.md:49`, `plugins/sp/skills/spur-check/SKILL.md:37`), lint/typecheck probes carry `lint` (`plugins/sp/skills/spur-dev/references/dev-operations.md:698`, `plugins/sp/skills/spur-dev/references/gate-checklists.md:20`), and the repo-wide pass carries `check-feature` (`plugins/sp/tests/feature-verification-scope.test.ts:7`). Bindings resolve to exactly the pre-migration command: `spur self exec {check,lint,check-feature,autofix,format,test,rules-pre,rules-post} --dry-run --no-logo` printed `bun run spur-check`, `bun run lint`, `bun run spur-check-feature`, `bun run autofix`, `bun run format`, `bun run test`, `bun run test-pre-check`, `bun run test-post-check`. `package.json:92` defines `spur-check` as `lint` + `spur-check:tests` and `package.json:74` defines `gate` as format + typecheck + `spur-check:tests`, so the recorded `autofix`+`check` decomposition of `gate` is a strict superset of it. |
| R2 | MET | Exactly two exempt lines survive, and each is spur-new-specific at the line itself. `plugins/sp/skills/spur-dev/references/gate-checklists.md:181-182` opens "In spur-new's restricted Bash sandbox" and its subject is this repo's local script exit code (~24 port-binding suites denied `listen`), which an action name would obscure. `plugins/sp/skills/spur-dev/references/done-housekeeping.md:48-51` prefixes the raw-tail capture list with "Include the tails of spur-new's own gate scripts (any other project: the same actions through `spur self exec lint` / `test`)", and the separate establish-green block at `plugins/sp/skills/spur-dev/references/done-housekeeping.md:96-97` runs the actions instead. No third plugin markdown file keeps a gate literal: the whole-tree `rg` total is exactly those 2 hits. |
| R3 | MET | Pin at `plugins/sp/tests/skill-structure.test.ts:2507-2541`. The allowlist `SPUR_NEW_BUN_GATE_ALLOWLIST` (`plugins/sp/tests/skill-structure.test.ts:2507-2512`) is a `Record<string,string>` keyed by the two exact repo-relative paths with a mandatory justification string per entry — no glob, no prefix match — and the scan source is `allMarkdown = walk(PLUGIN_ROOT, .md)` (`plugins/sp/tests/skill-structure.test.ts:50`), covering all 220 plugin markdown files. Two-sided: `plugins/sp/tests/skill-structure.test.ts:2522-2531` fails on any offender outside the allowlist and names the replacement action in the assertion message; `plugins/sp/tests/skill-structure.test.ts:2533-2541` fails when an allowlisted file loses its literal or stops naming spur-new. Falsified this run: a planted `plugins/sp/skills/zzz-p1227-stray-probe.md` carrying `bun run lint` produced `+ "plugins/sp/skills/zzz-p1227-stray-probe.md:3: Run `bun run lint` before landing.",` and `(fail) 1227 — gate guidance uses `spur self exec` > R1 — no `bun run` gate literal outside the allowlist` with `93 pass / 1 fail`; probe deleted, `git status --porcelain` back to 26 entries and 0 untracked files. |
| R4 | MET | `superskill install sp --dry-run` in this tree prints `pi: 9 hook(s) emitted as native extension module(s) in /Users/robin/.pi/agent/extensions`, `hermes: 10 hook(s) merged (rung c — copy-step)` and `[DRY-RUN] No files were written to install targets.` over 3 lines, and exits 0 (`EXITCODE=0`) with no error output. |

| Acceptance Criteria | Status | Evidence Type | Evidence |
|---------------------|--------|---------------|----------|
| AC1 — Plugin guidance invokes actions through spur self exec | MET | test | (a) Real hit comparison re-derived from `HEAD` `d9b062578c042bc421f5d8eddb38ea9ce39afd37`: `git grep -n -E 'bun run (spur-check\|lint\|gate)' HEAD -- plugins/sp` → 45 hits, `git grep -l …` → 25 files; working tree `rg -n 'bun run (spur-check\|lint\|gate)\b' plugins/sp -g '!node_modules'` → 2 hits, both in the two R2 allowlist files, with all 25 baseline files present in the change set. (b) `cd plugins/sp && bun test plugins/sp/tests/skill-structure.test.ts` → `94 pass`, `0 fail`, `940 expect() calls`, including `(pass) 1227 — gate guidance uses `spur self exec` > R1 — no `bun run` gate literal outside the allowlist` and `> R2 — each exception says spur-new where it applies, and is still needed`. (c) All three touched test files together → `110 pass`, `0 fail`, `1115 expect() calls`, `Ran 110 tests across 3 files` (`plugins/sp/tests/skill-structure.test.ts`, `plugins/sp/tests/feature-verification-scope.test.ts`, `plugins/sp/tests/inline-pipeline-driver.test.ts`). (d) Skill byte budgets pass in that same run (R42 description caps and R44 body caps, budget at `plugins/sp/tests/skill-structure.test.ts:883`): `plugins/sp/skills/code-implementation/SKILL.md` 19,256 B, `plugins/sp/skills/spur-check/SKILL.md` 5,934 B, `plugins/sp/skills/code-refactoring/SKILL.md` 7,500 B — every one under the 20,000 B body budget. Test runs used the workspace `plugins/sp/bunfig.toml` (preload only, no coverage table), so `.coverage/lcov.info` kept sha256 `5d6ab691d055167a15834eb59366b39028c1e580600655cf8848c21d2a2591dc` before and after. |
- Coverage: N/A (verdict-based; verify pipeline does not measure code coverage)

### Review

Verdict: PASS

#### Review Report — 1227
**Scope:** uncommitted change set of task 1227 — 26 files: 21 plugin markdown + `plugins/sp/README.md` + `plugins/sp/tests/evals/README.md`, three plugin test files, and the task spec.
**Dimensions:** functional traceability (R1–R4, AC1), SECUA, architectural depth.
**Verdict:** PASS

##### Findings (ranked)

| # | Priority | Dimension | Finding | Location | Disposition |
|---|----------|-----------|---------|----------|-------------|
| 1 | P4 (advisory) | usability | Partial vocabulary migration leaves adjacent lines speaking two dialects: `cross-cutting.md:498` keeps a `bun run test` tail beside the new `spur self exec lint` at `:499`; `execution-batch.md:611` now reads `spur self exec lint` while `:616-617` still name `bun run test-pre-check`/`bun run test-post-check`; `dev-operations.md:689` keeps `bun run format` beside the new `spur self exec lint`. All three literals sit outside R1's three-script scope (`spur-check\|lint\|gate`), so this breaches no requirement — a finish-the-vocabulary pass is follow-up, not a defect here | `plugins/sp/skills/spur-dev/references/cross-cutting.md:498-499`, `plugins/sp/skills/spur-dev/references/execution-batch.md:611,616-617`, `plugins/sp/skills/spur-dev/references/dev-operations.md:689` | ACCEPTED |
| 2 | P4 (advisory) | correctness | `dev-gitmsg.md:20` maps the `--check` example `bun run gate` → `spur self exec check`, while the closed Q&A decision maps `gate` → `autofix` + `check`. This repo's `gate` opens with a write-mode biome pass (`package.json:74`), while `spur-check` does not (`package.json:92`), so the format-write half is not in the example. Defensible for a pre-commit check (it should not rewrite the tree), but the deviation from the recorded mapping is implicit | `plugins/sp/commands/dev-gitmsg.md:20` | ACCEPTED |
| 3 | P4 (advisory) | correctness | `code-implementation/SKILL.md:120` drops the third literal from the NEVER-list. `bun run check` is a distinct script here (`package.json:90` = lint + coverage suite + heavy), not `spur-check` (`package.json:92`), so its explicit name is gone. The trailing "or any other full-suite / project-gate command" still covers it, and `spur self exec check` — the action an agent would reach for — stays listed | `plugins/sp/skills/code-implementation/SKILL.md:120` | ACCEPTED |
| 4 | P4 (advisory) | architecture | The R2 exemption assertion is file-scoped: `text.toContain('spur-new')` passes on any spur-new mention anywhere in a large reference file, so a future entry could be justified by an unrelated occurrence. It still cannot widen *silently* — a new entry needs a same-diff test edit plus a non-empty justification string — but line-scoping the check to the offending line would make the exemption as tight as the R3 pin itself (`plugins/sp/tests/skill-structure.test.ts:2533-2541`) | `plugins/sp/tests/skill-structure.test.ts:2533-2541` | ACCEPTED |
| 5 | P4 (advisory) | correctness | `inline-pipeline-driver.test.ts:283,363` attribute the recheck probe's redness to `spur self exec lint`; mechanically the probe is red because env `gateProbeCmd` carries the YAML default `${spurBin:-spur} self exec lint` unexpanded — `expand()` only substitutes `${vars.x}`, so `sh` tries to execute a command literally named `${spurBin:-spur}`. Test outcome is unaffected (fresh run: 110 pass), only the explanation is optimistic | `plugins/sp/tests/inline-pipeline-driver.test.ts:82-84,283,363` | ACCEPTED |
| 6 | P4 (advisory) | usability | `execution-worktree-landing.md:411` rewrites a historical observation ("MERGE_HEAD survived …") with a command that postdates the 2026-09-27 event. R1 mandated the rewrite and the `lint` action resolves to the same `bun run lint` (`package.json:71`), so the observation stays true; a "then `bun run lint`" aside would keep the chronology honest | `plugins/sp/skills/spur-dev/references/execution-worktree-landing.md:411` | ACCEPTED |

##### Functional Traceability

| Req | Status | Evidence |
|-----|--------|----------|
| R1 | MET | Baseline re-derived at HEAD: `git grep -E 'bun run (spur-check\|lint\|gate)' HEAD -- plugins/sp` = **45 hits in 25 files**. Post-change `rg -n` over `plugins/sp` = **2 hits, both inside the R2 allowlist files**. All 25 baseline files are in the change set (`git status`), so no hit was missed by omission. Plugin-wide `spur self exec` = 58 occurrences: `check` 22, `lint` 19, `autofix` 7, `test` 6, `check-feature` 2, `--list` 2, `rules-pre`/`rules-post`/`format`/`build` 1 each. Action-vs-intent spot-check passed at every site read: full-gate contexts carry `check` (`code-implementation/SKILL.md:107` `qualityGateCmd`, `execution-workflow.md:49` qualityGateCmd default, `inline-pipeline-driver.md:427,921,931,954`, `spur-check/SKILL.md:37`), lint/typecheck probes carry `lint` (`dev-operations.md:690,698`, `routing-table.md:118`, `execution-batch.md:611`, `doc-evolve/SKILL.md:80`), repo-wide feature gates carry `check-feature`, and gate enumerations carry `autofix\|check\|lint` (`dev-changelog.md:29`, `dev-handover.md:27`, `dev-job-dump.md:28`, `dev-gitmsg.md:39`, `dev-operations.md:571`). Bindings verified live: `spur self exec <a> --dry-run` resolves `check`→`bun run spur-check`, `lint`→`bun run lint`, `check-feature`→`bun run spur-check-feature`, `autofix`→`bun run autofix`, `format`→`bun run format`, `test`→`bun run test`, `rules-pre`→`bun run test-pre-check`, `rules-post`→`bun run test-post-check` — i.e. the pre-migration command in every case, and `spur-check` = lint + (pre + test + post) per `package.json:92`, so `spur-check/SKILL.md:37`'s decomposition is faithful. `autofix`+`check` for `gate` is a superset of `gate` (`package.json:73-74,92`), matching the closed Q&A decision |
| R2 | MET | Exactly two exemptions exist and each is genuinely spur-new-specific *at the offending line*: `gate-checklists.md:181-182` — the subject is this repo's restricted Bash sandbox, where ~24 port-binding tests fail environmentally, so the local script (not an action) is what is being explained, and the sentence now opens "In spur-new's restricted Bash sandbox"; `done-housekeeping.md:48-51` — the raw-tail capture list is now prefixed "Include the tails of spur-new's own gate scripts (any other project: the same actions through `spur self exec lint` / `test`)", and the separate establish-green block at `:96-97` uses the actions. No other file keeps a bun gate literal |
| R3 | MET | Pin at `plugins/sp/tests/skill-structure.test.ts:2507-2541`, scanning `allMarkdown = walk(PLUGIN_ROOT, …)` (`:50`) so every plugin `.md` is in scope. The allowlist is a `Record<string, string>` of two exact repo-relative paths (`:2507-2512`) — no glob, no prefix match, and `rel in` on path-shaped keys cannot be hit by a prototype key. Two-sided: `:2523-2531` fails on any offender with the action to use in the message; `:2533-2541` fails when an allowlisted file no longer carries a literal or does not name spur-new. Falsified fresh: adding `plugins/sp/skills/zzz-p1227-stray-probe.md` containing `bun run lint` failed the R1 test with `plugins/sp/skills/zzz-p1227-stray-probe.md:2: Run \`bun run lint\` before landing.` (R2 test still passed); file removed, tree back to the same 26 modified paths and no untracked files |
| R4 | MET | `superskill install sp --dry-run` run fresh in this tree: `pi: 9 hook(s) …`, `hermes: 10 hook(s) merged (rung c — copy-step)`, `[DRY-RUN] No files were written to install targets.`, exit 0 |
| AC1 | MET | AC1 → R1–R4, all four MET above. Independent execution evidence: 110 pass / 0 fail across the three touched test files (`skill-structure` 94, `feature-verification-scope`, `inline-pipeline-driver`), run with coverage disabled via a throwaway `/tmp` bunfig so `.coverage/lcov.info` was not rewritten |

##### Quality, SECUA and architecture notes

- **Correctness/structure (SECUA · C):** the rewrite is prose-only; no executable path changed except the three test files, whose edits are comments plus one new `describe` block reusing already-imported `readFileSync`/`join`/`relative`/`sep` and the pre-existing `allMarkdown`/`REPO_ROOT`. `git diff -U0 \| grep '^+.*import'` is empty — the plugin standalone contract (no new non-relative / non-`import type` value imports) is untouched.
- **Efficiency (SECUA · E):** the pin walks the plugin tree once per test file load and re-reads only the two allowlisted files; 26 ms for both cases. No new I/O class.
- **Usability (SECUA · U):** the failure message names the replacement action, which is what makes the pin teach rather than block.
- **Budgets:** `code-implementation/SKILL.md` = 19,256 B, `code-refactoring/SKILL.md` under 17 KB — both inside the 20,000 B `SKILL.md` body budget, and the R44 ratchet plus R42 description caps pass inside the 110-test run (the `spur-check` description grew by 3 chars and stays within cap).
- **Architecture:** the invariant lives in the existing structure test rather than a new config rule (the closed refine decision), the allowlist is data with a mandatory justification string, and the assertion is ratcheted in both directions — so the exemption list cannot rot into a wildcard. Depth is appropriate for a documentation invariant.

##### Confidence level (F511)

No asserted `Confidence` grade (`HIGH`/`MEDIUM`/`LOW`) is recorded here — that is a deliberate,
verified omission, not a gap: task 1207 (F511) retired the self-graded level because a verifier that
can write a PASS can write `HIGH` (`plugins/sp/skills/code-verification/references/verdict-schema.md:43-51`),
and the review gate reads only the findings table plus its citation predicate
(`packages/app/src/services/residual-scan.ts:322-343`). What the level used to compress is in the
report body: the P1–P4 rows, the per-requirement evidence cells, and the residual-risk section.

| Check | Result | Evidence |
|-------|--------|----------|
| Artifact contract: no asserted grade in this review | HOLDS — verdict line plus evidence cells; nothing for a gate to read as a self-assessment | `plugins/sp/skills/code-verification/references/verdict-schema.md:43-51`; `packages/app/src/services/residual-scan.ts:322-328` |
| Change set introduces no confidence field or line | HOLDS — the only `confidence` occurrence in the diff is the pre-existing "No confidence level is recorded (ADR-138)" clause, carried through the rewrite with unchanged meaning | `plugins/sp/commands/dev-changelog.md:29` |
| Derived confidence family untouched | HOLDS — feature-verification receipts (ADR-131), the decision-subsystem threshold and history-anatomy reading are outside the diff: plugin markdown plus three plugin test files, and the `feature-verification-scope.test.ts` hunks are docblock and nothing else | `plugins/sp/tests/feature-verification-scope.test.ts:5-9` |


##### Residual risk

- `.coverage/lcov.info` (843,937 B, mtime 00:26) postdates the certified digest (00:02:51). That is the pre-existing `coverage-artifact: lcov-mismatch` the implementer recorded, it is outside this diff, and this review did not rewrite it — all test runs used coverage disabled. Clearing it needs `bun run test:full`, which the review stage forbids.
- Finding 1 means an agent hand-following `execution-batch.md` step 2 still runs `bun run test-pre-check`; harmless here (the bun preset binds `rules-pre` to exactly that script) but it is the visible seam of a partial migration.

**Next:** no action required — `record` → `done` may proceed; the only outstanding gate risk is the pre-existing coverage artifact.

### References

<!-- Links to the parent feature, design docs, related tasks, or external references. -->

### History

- 2026-10-17T07:22:17.059Z todo → wip (system)
- 2026-10-17T07:35:59.013Z wip → testing (system)
- 2026-10-17T07:36:09.778Z testing → done (system)

