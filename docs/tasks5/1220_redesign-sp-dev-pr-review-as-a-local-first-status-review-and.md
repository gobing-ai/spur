---
schema_version: 1
name: Redesign /sp:dev-pr-review as a local-first status, review and fix command
status: done
template: feature-impl
created_at: 2026-10-16T18:16:16.610Z
updated_at: "2026-10-17T00:33:03.252Z"
feature_id: L1
priority: P2
tags:
  - plugin
  - command
  - pr-review
estimate_hours: 4

dependencies: ["1218", "1219"]
done_forced: "false"
done_reason: unforced close; PASS artifact at .spur/memory/evidence/1220-verdict.json
---

## 1220. Redesign /sp:dev-pr-review as a local-first status, review and fix command

### Background

Implements: R8 — dev-pr-review status mode shows the branch graph and the pull-request state; R9 — dev-pr-review review mode runs a local review of the branch diff by default; R10 — dev-pr-review review --codex requests the GitHub Codex review through the existing spine; R11 — dev-pr-review fix mode triages and fixes findings from either reviewer; R12 — The redesigned command replaces the old mode set with three modes.

The migrated command is Codex-only with seven modes and goes unused. Design: docs/design/builder-branches-and-pr-review.md §3.3.

### Requirements

- [x] R1. `plugins/sp/commands/dev-pr-review.md` is rewritten from scratch: modes `status` (default), `review` and `fix`; flags `--codex`, `--force`, `--no-wait`, `--base`, `--agent`, plus free-text focus.
- [x] R2. `status` runs `spur builder show-branches --base <b> --pr` (task 1218) and `spur builder pr-status --json` (task 1219). It is read-only.
- [x] R3. `review` runs `spur builder pr-check --base <b> --scan-only --json` (BLOCK stops), then the local `/sp:dev-review` over the `base...HEAD` changed files. `review --codex` runs `pr-review.yaml` with `mode=full`, or `mode=rerun` with `--force` and `mode=submit` with `--no-wait`.
- [x] R4. `fix` validates each current-head finding (from the local review verdict, or from `pr-status --json` `.review` for Codex) before editing, fixes the legitimate ones, verifies, makes one focused commit and pushes without force.
- [x] R5. Retired modes (full, submit, rerun, collect) print one notice and run their replacement. `rules` prints a notice pointing to `cc:cc-magents`.
- [x] R6. `sp:pr-reviewing` SKILL.md is slimmed to the three modes with updated `pipeline_steps` and only the four `pr-<verb>` commands. Installed adapters are regenerated through `superskill install sp`, never hand-edited.

### Acceptance Criteria

- [x] AC1 — dev-pr-review status mode shows the branch graph and the pull-request state
- [x] AC2 — dev-pr-review review mode runs a local review of the branch diff by default
- [x] AC3 — dev-pr-review review --codex requests the GitHub Codex review through the existing spine
- [x] AC4 — dev-pr-review fix mode triages and fixes findings from either reviewer
- [x] AC5 — The redesigned command replaces the old mode set with three modes

### Q&A

<!-- CLOSED decisions from refinement: what was chosen and why, what was deferred and on what
     condition. Not a parking lot for open questions — an unanswered question here means the task
     is not ready to hand off. Keep empty if none. -->

#### Q&A entry — 2026-10-16T18:25:26.797Z

- Q: How does the local review target `base...HEAD` when `/sp:dev-review` has no diff-range flag? A: Pass the changed-file list from `git diff --name-only <base>...HEAD` as `--scope`. Closed 2026-10-16.
- Q: Where does `rules` point? A: `cc:cc-magents` (the `cc` plugin). Closed 2026-10-16.

#### Q&A entry — 2026-10-16T18:34:35.326Z

- Q: How does the local review target `base...HEAD` when `/sp:dev-review` has no diff-range flag? A: Pass the changed-file list from `git diff --name-only <base>...HEAD` as `--scope`. Closed 2026-10-16.
- Q: Where does `rules` point? A: `cc:cc-magents` (the `cc` plugin). Closed 2026-10-16.
- Q: Which pull-request commands does the command use? A: Only the four flat verbs from task 1219 (`pr-status`, `pr-check`, `pr-open`, `pr-review` via `pr-review.yaml`). Closed 2026-10-16.

### Design

Feature L1 (child of the `spur builder` umbrella L). Satellite: `docs/design/builder-branches-and-pr-review.md` §3.3. Depends on 1218 (`show-branches`) and 1219 (the four `pr-<verb>` verbs and the four-state `pr-review.yaml`).

**Chosen.** `plugins/sp/commands/dev-pr-review.md` is rewritten from scratch as a thin wrapper that calls `Skill(skill="sp:pr-reviewing", args=...)`. `plugins/sp/skills/pr-reviewing/SKILL.md` owns mode routing and is slimmed to three modes. The local review reuses `/sp:dev-review` rather than adding a parallel reviewer. The Codex path runs `config/workflows/pr-review.yaml` as its single source of truth. Reason: reuse, and a local review needs no Codex quota.

**Frozen surface.** `/sp:dev-pr-review [status|review|fix] [--codex] [--force] [--no-wait] [--base <branch>] [--agent <inline|auto|name>] [<focus>]`; the default mode is `status`.

| Mode | Steps |
| --- | --- |
| `status` | `spur builder show-branches --base <b> --pr --format markdown`, with the report filtered to the current branch and its base, plus `spur builder pr-status --json` (PR number, CI, local changes, latest current-head review in `.review`). Read-only. |
| `review` | `spur builder pr-check --base <b> --scan-only --json`; `BLOCK` stops, `WARN` is reported. Then `git diff --name-only <b>...HEAD` → `/sp:dev-review --scope <comma-joined paths> --focus <focus>`. `/sp:dev-review` takes `--scope` paths, not a diff range (`plugins/sp/commands/dev-review.md:31`). An empty diff ends with "nothing to review". Posts nothing to GitHub. |
| `review --codex` | `spur workflow run pr-review.yaml` (or the inline driver) with `mode=full`; `--force` → `mode=rerun`; `--no-wait` → `mode=submit`; `focus`/`baseBranch` passed as vars. States: check → precheck → open → review. `pending` is reported as pending, not failure. |
| `fix` | Takes findings from the latest local review verdict, or from `spur builder pr-status --json` `.review` when the last review was Codex. Validates each finding against the code before editing; rejected findings are listed with a reason. Fixes the legitimate ones, runs the project gate, makes one focused commit and pushes without force (`spur builder pr-open` handles a first push). |

Retired modes print one notice line and run their replacement: `full` → `review --codex`; `submit` → `review --codex --no-wait`; `rerun` → `review --codex --force`; `collect` → `status`. `rules` prints a notice that `AGENTS.md` review-rule authoring belongs to `cc:cc-magents` (in the `cc` plugin, not `sp`) and exits.

**Skill frontmatter.** `pipeline_steps` becomes `[status, check, review, open, triage, fix]`. The description says local-first with Codex opt-in, and the triggers keep "codex review" and "review my PR". Bump `version` to 2.0.0. No `spur builder pr <op>` spellings remain in the skill or command.

**Invariants.** Never force-push, rewrite history, close or integrate the PR, or discard unrelated changes. `review` without `--codex` makes no GitHub writes.

**Anti-patterns.** No hand-edits to generated per-platform adapters; regenerate through `superskill install sp`. No re-implementation of `dev-review` dimensions inside the skill. No new `spur` verbs. No direct `pr-review` calls that bypass the workflow on the Codex path.

**Rejected.** Deleting the command (loses the daily status hook). Keeping seven modes (the reason it went unused).

### Plan

1. Write the failure list first: no PR for the branch; gh missing; empty diff; `pr-check` BLOCK; Codex pending or wait timeout (workflow `pending`); a finding that refers to a stale head; a retired mode passed; `rules` passed.
2. Rewrite `plugins/sp/commands/dev-pr-review.md` with the frozen surface and the retired-mode table (R1, R5).
3. Rewrite the `sp:pr-reviewing` mode table, routes and frontmatter on the four verbs and the four-state workflow; move the Codex-only sections behind `--codex` (R2–R4, R6).
4. Dogfood each mode on a scratch branch of this repo (status, review, review --codex --no-wait, fix on a seeded finding, one retired mode). Save transcripts under `.spur/run/1220-dogfood/` as the repeatable E2E artifact (R2–R5).
5. Run `superskill skill evaluate plugins/sp/skills/pr-reviewing` and `superskill command evaluate plugins/sp/commands/dev-pr-review.md`; run `bun run plugin-smoke`; then `superskill install sp` to regenerate the adapters (R6).
6. `bun run spur-check`.

### Solution

Change-map (auto-generated — implement step did not record a Solution).
Each entry cites the first changed line per file (`file:line`).

| Change (`file:line`) |
|----------------------|
| `plugins/sp/commands/dev-pr-review.md:10` |
| `plugins/sp/commands/dev-pr-review.md:19` |
| `plugins/sp/commands/dev-pr-review.md:2` |
| `plugins/sp/commands/dev-pr-review.md:31` |
| `plugins/sp/commands/dev-pr-review.md:39` |
| `plugins/sp/commands/dev-pr-review.md:4` |
| `plugins/sp/skills/pr-reviewing/SKILL.md:133` |
| `plugins/sp/skills/pr-reviewing/SKILL.md:136` |
| `plugins/sp/skills/pr-reviewing/SKILL.md:14` |
| `plugins/sp/skills/pr-reviewing/SKILL.md:147` |
| `plugins/sp/skills/pr-reviewing/SKILL.md:187` |
| `plugins/sp/skills/pr-reviewing/SKILL.md:19` |
| `plugins/sp/skills/pr-reviewing/SKILL.md:197` |
| `plugins/sp/skills/pr-reviewing/SKILL.md:200` |
| `plugins/sp/skills/pr-reviewing/SKILL.md:207` |
| `plugins/sp/skills/pr-reviewing/SKILL.md:222` |
| `plugins/sp/skills/pr-reviewing/SKILL.md:234` |
| `plugins/sp/skills/pr-reviewing/SKILL.md:240` |
| `plugins/sp/skills/pr-reviewing/SKILL.md:27` |
| `plugins/sp/skills/pr-reviewing/SKILL.md:29` |
| `plugins/sp/skills/pr-reviewing/SKILL.md:3` |
| `plugins/sp/skills/pr-reviewing/SKILL.md:40` |
| `plugins/sp/skills/pr-reviewing/SKILL.md:44` |
| `plugins/sp/skills/pr-reviewing/SKILL.md:47` |
| `plugins/sp/skills/pr-reviewing/SKILL.md:5` |
| `plugins/sp/skills/pr-reviewing/SKILL.md:51` |
| `plugins/sp/skills/pr-reviewing/SKILL.md:58` |
| `plugins/sp/skills/pr-reviewing/SKILL.md:62` |
| `plugins/sp/skills/pr-reviewing/SKILL.md:74` |
| `plugins/sp/skills/pr-reviewing/SKILL.md:82` |
| `plugins/sp/skills/pr-reviewing/SKILL.md:86` |
| `plugins/sp/skills/pr-reviewing/SKILL.md:88` |
| `plugins/sp/skills/pr-reviewing/SKILL.md:90` |
| `plugins/sp/skills/pr-reviewing/SKILL.md:98` |
| `plugins/sp/skills/spur-dev/references/flag-glossary.md:212` |

### Testing

**Pipeline verify results**

- Verdict: PASS (from verdict artifact)

| Requirement | Status | Evidence |
|-------------|--------|----------|
| R1 | MET | `plugins/sp/commands/dev-pr-review.md:4` — `argument-hint: "[status\|review\|fix] [--codex] [--force] [--no-wait] [--base <branch>] [--agent <inline\|auto\|name>] [<focus>]"`; flag table `plugins/sp/commands/dev-pr-review.md:17-25` declares `--codex`/`--force`/`--no-wait`/`--base`/`--agent` plus free-text `<focus>` with defaults, default mode `status`. |
| R2 | MET | `plugins/sp/skills/pr-reviewing/SKILL.md:86-106` status route; executed in throwaway `/tmp/rv1220c`: `builder show-branches --base main --pr --format markdown` exit 0 renders the branch table + mermaid gitGraph (PR column degrades with a `--pr: gh pr list failed` warning when no remote); `builder pr-status --json` with a gh stub + PR exit 0 returns `{"ok":true,...,"pr":{...},"ci":"unavailable","codex":"not requested","review":{...}}`. SKILL.md:88 states read-only. |
| R3 | MET | `plugins/sp/skills/pr-reviewing/SKILL.md:108-124` local route (`pr-check --base <b> --scan-only --json`; BLOCK stops) and `:126-141` Codex route (`pr-review.yaml`, `mode=full`/`rerun`/`submit`). Executed `builder pr-check --base main --scan-only --json`: clean+gh stub → exit 0 `verdict:"PASS"`; debug residue → exit 0 `verdict:"WARN"`; seeded AWS key → exit 2 `verdict:"BLOCK"`; gh failure → exit 2 `verdict:"FAIL"` (distinct from BLOCK, matching SKILL.md:114-116). Spine states check → precheck → open → review in `config/workflows/pr-review.yaml:40-118`. |
| R4 | MET | `plugins/sp/skills/pr-reviewing/SKILL.md:143-165` — collect before editing (`:147-152`), validate/classify each finding and list rejections (`:153-156`), smallest coherent fix (`:157-159`), verify (`:160-161`), one focused defect-named commit (`:162-163`), normal push never force (`:164-165`). Executed `builder pr-status --json` `.review` shape (the Codex finding source) exit 0 with `"review":{...,"verdict":"PENDING","findings":[]}`. |
| R5 | MET | `plugins/sp/skills/pr-reviewing/SKILL.md:67-70` and `plugins/sp/commands/dev-pr-review.md:42-45` — one notice line then replacement: `full`→`review --codex`, `submit`→`review --codex --no-wait`, `rerun`→`review --codex --force`, `collect`→`status`; `rules` prints the `cc:cc-magents` pointer and exits. |
| R6 | MET | `plugins/sp/skills/pr-reviewing/SKILL.md:5` `version: 2.0.0`; `:13-19` `pipeline_steps: [status, check, review, open, triage, fix]`; `grep -on "builder pr-"` over the command+skill yields only `pr-status`/`pr-check`/`pr-open`/`pr-review` plus the generic `pr-<verb>` placeholder; `git status --porcelain` shows only 3 plugin source paths + the pipeline-owned task file, so no generated adapter is hand-edited (installed adapters are gitignored build outputs). |

| Acceptance Criteria | Status | Evidence Type | Evidence |
|---------------------|--------|---------------|----------|
| AC1 — dev-pr-review status mode shows the branch graph and the pull-request state | MET | command | Executed `bun apps/cli/src/index.ts builder show-branches --base main --pr --format markdown` in `/tmp/rv1220c` → exit 0, prints the branch table + `gitGraph` mermaid; executed `bun apps/cli/src/index.ts builder pr-status --json` (gh stub, PR present) → exit 0 with `"pr":{"number":42,...}` and the Codex `.review` record. Anchors `plugins/sp/skills/pr-reviewing/SKILL.md:86-106`, `plugins/sp/commands/dev-pr-review.md:19`. |
| AC2 — dev-pr-review review mode runs a local review of the branch diff by default | MET | command | Executed `builder pr-check --base main --scan-only --json` (step 1 of the local route) → PASS/WARN exit 0, BLOCK exit 2 (BLOCK stops). Executed `git diff --name-only main...HEAD` → comma-joinable path list for `--scope`; on a branch with no commits ahead it returns an empty list ("nothing to review"). Default route is local because SKILL.md:108-124 is the default and the `--codex` opt-in is gated. Anchors `plugins/sp/skills/pr-reviewing/SKILL.md:108-124`. |
| AC3 — dev-pr-review review --codex requests the GitHub Codex review through the existing spine | MET | test | `packages/app/tests/services/pr-review/pr-review.test.ts` → 81 pass / 0 fail, covering the flat composer verbs and the `pr-review.yaml` spine (check → precheck → open → review); `config/workflows/pr-review.yaml:36-118` is the SSOT with `mode` full/submit/rerun. Verified up to the GitHub boundary; the write step (`gh pr comment`/`pr-open`) was not invoked. Anchors `plugins/sp/skills/pr-reviewing/SKILL.md:126-141`. |
| AC4 — dev-pr-review fix mode triages and fixes findings from either reviewer | MET | command | Executed `builder pr-status --json` with a gh stub → exit 0, `.review` is the current-HEAD Codex finding source (`"review":{"verdict":"PENDING","findings":[]}`); SKILL.md:143-165 defines collect → validate/classify → fix → verify → one focused commit → non-force push for both sources. Anchors `plugins/sp/skills/pr-reviewing/SKILL.md:143-165`. |
| AC5 — The redesigned command replaces the old mode set with three modes | MET | command | Executed `grep -on "builder pr-"` over command+skill → only the four flat verbs remain; `argument-hint` declares exactly `status`/`review`/`fix` (`plugins/sp/commands/dev-pr-review.md:4`); mode table `plugins/sp/skills/pr-reviewing/SKILL.md:60-70` carries only the three modes with retired names appearing solely in the replacement map. `plugins/sp` suite (incl. `plugins/sp/tests/command-flag-parity.test.ts`, `plugins/sp/tests/cli-surface-parity.test.ts`) → 908 pass / 0 fail. |
- Coverage: N/A (verdict-based; verify pipeline does not measure code coverage)

### Review

#### Review Report — 1220 (round 2)

**Scope:** uncommitted working-tree diff of task 1220 on `a12a91025` — three plugin paths `plugins/sp/commands/dev-pr-review.md`, `plugins/sp/skills/pr-reviewing/SKILL.md`, `plugins/sp/skills/spur-dev/references/flag-glossary.md` (188 insertions / 236 deletions), plus the pipeline-owned task file (63/3, excluded from the change set). Round 2 is a fresh review that re-verifies the round-1 P3 repair; tasks 1218/1219 are committed, consumed surfaces and are not re-reviewed.
**Dimensions:** functional traceability, security, correctness, usability, architecture
**Verdict:** PASS

##### Findings (ranked)

| # | Priority | Dimension | Finding | Location | Disposition |
|---|----------|-----------|---------|----------|-------------|
| 1 | P3 (minor) | correctness / usability | Round 1's open P3 is repaired, verified by execution. The false "the local paths need only `git`" prerequisite claim is gone: `SKILL.md:224-230` now names every gh-gated path (`status`'s `pr-status` half, `review` step 1's `pr-check --scan-only`, `review --codex`, and `fix` when it reads a Codex verdict or pushes through `pr-open`) and lists what genuinely needs only `git` (`SKILL.md:228-229`). Step 1 now has three explicit outcomes with a distinct non-BLOCK failure branch (`SKILL.md:110-118`): `PASS`/`WARN` continue, `BLOCK` stops, and a hard failure (exit 2) stops with the tool's message plus a one-line remedy, explicitly "not a `BLOCK`". The gh dependency is real and the prose matches the tool, executed in throwaway `/tmp/rv1220b` repos: no `gh` on PATH → exit 2, `verdict":"FAIL"`, `"gh CLI missing or unauthenticated"`; `gh` stub (`auth status` ok + `repo view` JSON) → exit 0 `verdict":"PASS"`; seeded AWS key → exit 2 `verdict":"BLOCK"`; `console.log` residue → exit 0 `verdict":"WARN"`. Root cause remains `packages/app/src/services/pr-review/index.ts:696` (`cmdHygiene` → `preflightContext`) and `:488-505`. | `plugins/sp/skills/pr-reviewing/SKILL.md:110-118`, `:224-230`; `packages/app/src/services/pr-review/index.ts:696` | RESOLVED — repaired in this working tree and re-verified by execution |
| 2 | P4 (advisory) | correctness | Carried forward from round 1 (accepted). `review --codex --force --no-wait` cannot round-trip: both flags collapse onto the single `mode` var (`SKILL.md:136`) and the workflow's `noWait` var is never passed, so one flag is lost. The implementation is faithful to the frozen Design's lossy `--force`/`--no-wait` → `mode` mapping, so this is a contract gap, not an implementation deviation. Follow-up: carry `noWait` alongside `mode`, or add a tie-break. | `plugins/sp/skills/pr-reviewing/SKILL.md:136`; `config/workflows/pr-review.yaml:126` | ACCEPTED |
| 3 | P4 (advisory) | usability | Carried forward from round 1 (accepted; declared out of the frozen scope). The retired seven-mode surface is still advertised on the operator-read surfaces: the command index row `plugins/sp/README.md:111`, the skill index row `plugins/sp/README.md:351` (also stale version cell `1.0` against `version: 2.0.0` at `SKILL.md:5`, and the retired `spur builder pr` spine name), and the daily-use help table `docs/help/how_to_use_dev_slash_commands_for_daily_software_development.md:86`. R6/AC5 scope the three-mode claim to the command, the skill and its `pipeline_steps`, so this does not fail the contract. Sweep with `sp:doc-evolve` in a follow-up. | `plugins/sp/README.md:111`, `:351`; `docs/help/how_to_use_dev_slash_commands_for_daily_software_development.md:86` | ACCEPTED |

##### Functional Traceability

| Req | Status | Evidence |
|-----|--------|----------|
| R1 | MET | `plugins/sp/commands/dev-pr-review.md:4` — `argument-hint: "[status\|review\|fix] [--codex] [--force] [--no-wait] [--base <branch>] [--agent <inline\|auto\|name>] [<focus>]"`, byte-equal to the Design's frozen surface; `:17-25` declares the same flag set with a Default column (`<mode>` default `status`); usage `:31-33`; implementation `:35-49`. Mode set is exactly `status`/`review`/`fix`. |
| R2 | MET | `SKILL.md:86-106` — status runs `spur builder show-branches --base "$base" --pr --format markdown` scoped to the current branch and its base plus `spur builder pr-status --json`; `:88` states read-only. Executed: `show-branches --base main --pr --format markdown` exits 0 and renders the table + mermaid graph (R5 degradation with the gh warning held); `pr-status --json` with a gh stub and no PR exits 0 with `"pr":null,"review":null`. |
| R3 | MET | `SKILL.md:110-124` — `pr-check --base "$base" --scan-only --json` with `BLOCK` stopping and the hard-failure branch, then `git diff --name-only "$base"...HEAD` → `/sp:dev-review --scope … --focus …`; nothing posted. `SKILL.md:126-141` — `review --codex` runs `pr-review.yaml` (`:133`) with `mode=full`/`mode=rerun` on `--force`/`mode=submit` on `--no-wait` (`:136`), states check → precheck → open → review, and reports `pending` as pending, never failure (`:137-138`). The first command needs gh (finding 1). |
| R4 | MET | `SKILL.md:143-165` — findings collected before editing (`:147-152`: local verdict, else `pr-status --json` `.review` for Codex; pending/stale/unavailable → stop without edits), each finding validated and classified with rejected ones listed (`:153-156`), smallest coherent fix (`:157-159`), repository checks (`:160-161`), one focused defect-named commit (`:162-163`), normal push never force with `pr-open` handling a first push (`:164-165`). |
| R5 | MET | `SKILL.md:67-70` and `commands/dev-pr-review.md:42-45` — one notice line then the replacement: `full`→`review --codex`, `submit`→`review --codex --no-wait`, `rerun`→`review --codex --force`, `collect`→`status`; `rules` prints the `cc:cc-magents` notice and exits. Matches Design §3.3 and the task Q&A. |
| R6 | MET | `SKILL.md:5` `version: 2.0.0`; `:13-19` `pipeline_steps: [status, check, review, open, triage, fix]` exactly as the Design froze it; `grep "builder pr "` over the command + skill → 0 hits, so only the four flat `pr-<verb>` verbs remain; no generated adapter is in the diff. |
| AC1 | MET | Status mode's report block (`SKILL.md:96-106`) plus the branch-report scope (`:91-92`) satisfy scenario R8; read-only at `:88`. |
| AC2 | MET | `SKILL.md:108-124` + `commands/dev-pr-review.md:19` — local `base...HEAD` review by default, GitHub Codex behind `--codex`. |
| AC3 | MET | `SKILL.md:126-141` + `commands/dev-pr-review.md:20` — the spine is `pr-review.yaml` (`config/workflows/pr-review.yaml`, states check → precheck → open → review, terminal done/pending/failed). |
| AC4 | MET | `SKILL.md:143-165` — finding triage from either reviewer, validate-then-fix, one focused commit, non-force push. |
| AC5 | MET | `commands/dev-pr-review.md:19` and `SKILL.md:60-70` carry only `status`/`review`/`fix`; the retired names appear solely inside the replacement map, never as modes. |

##### SECUA notes

- **Security.** No force-push path: `SKILL.md:169-171` names force-push/`--force-with-lease`, destructive `git reset`, `git clean`, history rewrite, PR close/integrate and unrelated-change discard as "never"; `fix`'s push is normal-only (`:164`) and the spine's push is normal-only (`config/workflows/pr-review.yaml:88-93`). No GitHub write on the non-codex path: `SKILL.md:173-174` ("`review` without `--codex` makes no GitHub writes"), "Post nothing to GitHub" (`:124`), and the retired `full`/`submit`/`rerun` modes route into the Codex path only. Prompt-injection surface unchanged (no new untrusted interpolation).
- **Correctness.** Mode routing and the retired-mode replacement map match Design §3.3 and R5; default mode is `status` (`:58`); `BLOCK` stops (`:112-113`); empty diff ends with "nothing to review" (`:119-120`); the hard-failure branch is now distinct from `BLOCK` (`:114-116`); `pending` is reported as pending on the Codex path (`:137-138`); `fix` validates each finding before editing (`:153-156`). The three `pr-check --scan-only` outcomes were executed and match the prose (finding 1).
- **Usability.** `argument-hint` (`commands/dev-pr-review.md:4`) and the flag table (`:17-25`) are consistent with the frozen surface and the skill's Arguments section (`SKILL.md:72-84`); each flag states its mode scope; `allowed-tools: ["Bash","Read","Skill"]` matches the reviewer-command convention and gate (d) coherence passes.
- **Architecture.** The command stays a thin wrapper — one `Skill(skill="sp:pr-reviewing", args="$ARGUMENTS")` delegation (`commands/dev-pr-review.md:38`) and nothing else; the skill refuses to re-implement `dev-review` dimensions ("It owns the review dimensions — do not re-implement them here", `SKILL.md:122-123`); no new `spur` verb is introduced; the Codex path keeps `pr-review.yaml` as the single SSOT with the YAML-wins rule (`SKILL.md:47-49`). Plugin standalone contract holds — `bun run plugin-smoke` PASS.
- **Deepening opportunity (one, not worth the change here).** `SKILL.md:91-92`'s "keep only the rows for the current branch and its base" is a prose-only filter the executing agent must apply by hand; a `show-branches --branch <ref>` narrow mode would make it mechanical — but that is a new public flag on a verb outside this task's frozen surface. Recommend, do not require.

##### Fresh verification evidence (round 2)

- `git status --porcelain` + `git diff --numstat` → exactly 4 modified paths (3 plugin + the pipeline-owned task file); plugin-only change 188+/236−, whole diff 251+/239−. No staged files, no untracked adapter files.
- `(cd plugins/sp && bun test)` → **908 pass / 0 fail** (34 files), 3662 expect() calls — includes `command-flag-parity.test.ts`, `flag-contract-parity.test.ts`, `skill-structure.test.ts`, `cli-surface-parity.test.ts`.
- `bun test scripts/commands/flag-contract-parity.test.ts scripts/commands/command-contract.test.ts` → **106 pass / 0 fail**, including `0934 AC3 — commands are thin wrappers` and the least-privilege `allowed-tools` sweep.
- `bun run plugin-smoke` → `plugin-install-smoke PASS — plugin surface is standalone and installs clean`.
- `superskill command evaluate plugins/sp/commands/dev-pr-review.md` → `Verdict: PASS` (aggregate 0.90); `superskill skill evaluate plugins/sp/skills/pr-reviewing` → `Verdict: PASS` (aggregate 0.77).
- **`pr-check --scan-only` locality, executed** (throwaway repos under `/tmp/rv1220b/`, this tree untouched): no `gh` + no remote → exit 2 `{"ok":false,"verdict":"FAIL","preflight":null,"hygiene":{"ok":false,"error":"gh CLI missing or unauthenticated …"}}`; `gh` stub → exit 0 `{"ok":true,"verdict":"PASS","hygiene":{"ok":true,"verdict":"PASS"}}`; seeded AWS key → exit 2 `{"ok":false,"verdict":"BLOCK","hygiene":{"blockers":["AWS access key id: redacted"]}}`; debug residue → exit 0 `{"ok":true,"verdict":"WARN","hygiene":{"warnings":["debug logging: …"]}}`.
- **`pr-status --json`, executed:** no `gh` → exit 2 `{"ok":false,"error":"gh CLI missing or unauthenticated …","review":null}`; `gh` stub + no PR → exit 0 `{"pr":null,"review":null}`.
- **`show-branches --pr` degradation, executed:** no `gh` → exit 0, `> warning: --pr: gh pr list failed: Executable not found in $PATH: "gh"`, table + mermaid graph still rendered.
- `spur workflow run --help` → `--vars <json>` present, confirming `SKILL.md:133`'s invocation shape; `config/workflows/pr-review.yaml:47-51`, `:114-126` declares vars `mode`/`noWait` and the `--no-wait --force` argv.
- `spur task residual 1220 review-gate` before this section write → exit 1 (`blocking=1`, the open round-1 P3 row); after → exit 0 (only P4 advisory rows remain).
- Not run by this review: `bun run spur-check` (task-briefed GREEN on this tree), and no `builder pr-review` invocation (no-wait/timeout discipline).

##### Residual risk

- The implementer did **not** run `superskill install sp` (it mutates the operator's live agent config outside the project), so the operator's installed `/sp:dev-pr-review` adapter and `sp:pr-reviewing` skill still carry the v1.0 seven-mode surface until the next install. R6's in-repo obligation (no hand-edited generated adapter) is met; regeneration remains an operator action.
- `pr-check --scan-only` still resolves the repository through `gh` (`packages/app/src/services/pr-review/index.ts:696`), so the local `review` mode's step 1 cannot run in a gh-less local repo even though the review body itself needs no `gh`. The prose now documents this; if a follow-up makes `--scan-only` truly local, the skill wording must be re-swept in the same change.
- The `mode`-only var mapping (finding 2) silently drops one of `--force`/`--no-wait`; no gate covers it, so it will not resurface without a deliberate follow-up.

##### Next

Verdict is PASS — hand off to verify. The operator's remaining action is `superskill install sp`; findings 2-3 are advisory follow-ups, and the PR-help/README sweep belongs to a `sp:doc-evolve` follow-up.

### References

<!-- Links to the parent feature, design docs, related tasks, or external references. -->

### History

- 2026-10-16T18:23:10.575Z feature_id Q → L1 (system)
- 2026-10-17T00:01:50.845Z todo → wip (system)
- 2026-10-17T00:32:59.727Z wip → testing (system)
- 2026-10-17T00:33:03.245Z testing → done (system)

