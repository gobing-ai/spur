---
schema_version: 1
name: Add spur builder show-branches branch topology report
status: wip
template: feature-impl
created_at: 2026-10-16T18:16:16.605Z
updated_at: "2026-10-16T21:07:15.538Z"
feature_id: L1
priority: P2
tags:
  - cli
  - builder
  - git
estimate_hours: 6

---

## 1218. Add spur builder show-branches branch topology report

### Background

Implements: R1 — show-branches reports every branch relative to a base; R2 — Markdown is the default format and carries a condensed mermaid gitGraph; R3 — The gitGraph text uses only the referenced mermaid syntax and stays renderable; R4 — json and text formats expose the same branch model; R5 — Pull-request state enriches branches when gh is available and degrades when it is not; R13 — The builder surface is documented where the CLI facade and design index look (show-branches half); R14 — show-branches handles empty, detached and large repositories.

Today nothing in Spur reports branch relationships: on 2026-10-16, 26 of 31 origin branches had 0 commits ahead of main. Design: docs/design/builder-branches-and-pr-review.md §3.1.

### Requirements

- [ ] R1. `spur builder show-branches` collects, read-only, per branch: name, fork point, ahead/behind vs base, contained flag (ahead == 0), last-commit date/subject, worktree path; base = `--base` else origin/HEAD target else main; `--local`/`--remote` filters.
- [ ] R2. `--format markdown|json|text`, default markdown; unknown value exits 1 naming the three values.
- [ ] R3. Markdown = summary table + one condensed mermaid gitGraph (base line, one branch per non-contained ref, at most `--max-commits` (default 3) nodes plus a `+N earlier` summary node, tip HIGHLIGHT, revert commits REVERSE, contained branches joined back unless `--hide-contained`, base tags as `tag:`), sanitized ids, optional `--theme` init directive.
- [ ] R4. json = `{ base, generatedAt, branches[], omitted, warnings[] }` with the same rows as the table; text = aligned table without mermaid.
- [ ] R5. `--pr` enriches rows from one `gh pr list` call; gh missing/unauthenticated yields null PR fields and one warning, never a failure.
- [ ] R6. Detached HEAD row by short sha; `--limit <n>` (default 30) with omitted-count footer; single-branch repo renders base-only graph.
- [ ] R7. Governance §3 amendment row records operator consent for the fifth builder verb; `sp:spur-cli` builder reference documents the verb and lifts the frozen-set sentence to five verbs.

### Acceptance Criteria

- [ ] AC1 — show-branches reports every branch relative to a base
- [ ] AC2 — Markdown is the default format and carries a condensed mermaid gitGraph
- [ ] AC3 — The gitGraph text uses only the referenced mermaid syntax and stays renderable
- [ ] AC4 — json and text formats expose the same branch model
- [ ] AC5 — Pull-request state enriches branches when gh is available and degrades when it is not
- [ ] AC6 — The builder surface is documented where the CLI facade and design index look
- [ ] AC7 — show-branches handles empty, detached and large repositories

### Q&A

<!-- CLOSED decisions from refinement: what was chosen and why, what was deferred and on what
     condition. Not a parking lot for open questions — an unanswered question here means the task
     is not ready to hand off. Keep empty if none. -->

#### Q&A entry — 2026-10-16T18:25:24.792Z

- Q: Should `--json` and `--format json` differ (envelope vs raw)? A: No. Both emit the raw `BranchTopology` object; `--json` is an alias. Closed 2026-10-16.
- Q: Validate mermaid with a new dependency? A: No. Use the regex allow-list in E2E plus one heavy proof with `apps/web`'s existing mermaid. Closed 2026-10-16.
- Q: Prune stale branches? A: Out of scope (feature L1 Scope). Closed.

### Design

Feature L1 (child of the `spur builder` umbrella L). Satellite: `docs/design/builder-branches-and-pr-review.md` §3.1.

**Chosen.** Git collection lives in `packages/app/src/services/branch-topology/index.ts` and runs through the existing pr-review `CommandRunner` seam (`createSpawnRunner(context)` at `packages/app/src/services/pr-review/index.ts:126`, `setCommandRunner` at `:154`), so tests stub git and gh exactly as `packages/app/tests/services/pr-review/pr-review.test.ts` does. Pure renderers go in `branch-topology/render.ts`. Commander wiring goes in `apps/cli/src/commands/builder/show-branches.ts` (`registerBuilderShowBranchesCommand(builder, context)`), registered next to `registerBuilderPrCommand` in `apps/cli/src/commands/builder.ts`; the noun docstring/summary lists five verbs. Export the service through the same `@gobing-ai/spur-app/*` subpath pattern used by `@gobing-ai/spur-app/pr-review`. Reason: ADR-021 thin transport and one git-exec seam.

**Frozen names.**
- `collectBranchTopology(runner: CommandRunner, opts: BranchTopologyOptions): BranchTopology`
- `interface BranchTopologyOptions { base?: string; scope: 'all' | 'local' | 'remote'; pr: boolean; limit: number }`
- `interface BranchRow { name: string; kind: 'local' | 'remote' | 'detached'; tip: string; forkPoint: string; ahead: number; behind: number; contained: boolean; lastCommitAt: string; subject: string; worktree: string | null; pr: { number: number; state: string; reviewDecision: string | null } | null }`
- `interface BranchTopology { base: string; generatedAt: string; branches: BranchRow[]; omitted: number; warnings: string[] }`
- `renderMarkdown(t, g: GraphOptions)`, `renderText(t)`, `renderGitGraph(t, g: GraphOptions)` with `interface GraphOptions { maxCommits: number; hideContained: boolean; theme?: string }`
- Flags: `--format <markdown|json|text>` (default `markdown`), `--json` (alias of `--format json`; JSON is the raw `BranchTopology`, matching `--format json`), `--base <ref>`, `--local`, `--remote` (mutually exclusive, exit 1 when both), `--pr`, `--limit <n>` (default 30), `--max-commits <n>` (default 3), `--hide-contained`, `--theme <name>`.
- Exit codes: 0 ok, 1 usage (bad format, bad number, unknown base ref), 2 git failure (not a repository, git missing).

**Algorithm.** As specified in satellite §3.1: base resolution `--base` → `git symbolic-ref --short refs/remotes/origin/HEAD` → `main`; refs from `git for-each-ref --format=... refs/heads refs/remotes`, skipping `*/HEAD` and folding a remote ref into its local twin when both point at the same sha; per ref `merge-base`, `rev-list --left-right --count base...ref`, `log -1 --format=%H%x00%cI%x00%s`; worktrees from `git worktree list --porcelain`; `--pr` from one `gh pr list --state open --json number,headRefName,state,reviewDecision --limit 200`. Rows sorted by `lastCommitAt` desc, then name. Mermaid rendering follows the satellite's condensed-graph rules and the allowed statement set: `gitGraph`, `commit id:"…" [tag:"…"] [type: NORMAL|HIGHLIGHT|REVERSE]`, `branch <name>`, `checkout <name>`, `merge <name> [tag:"…"]`, optional `%%{init: { 'theme': '<name>' } }%%`.

**Invariants.** Never writes refs, config, the index or worktrees. `--pr` is the only network path. Output is deterministic for a fixed repo state apart from `generatedAt`. The CLI passes `{ cwd: context.cwd, env: context.env }` into `createSpawnRunner` (task 1215 lesson: never the process-global cwd).

**Anti-patterns.** No new runtime dependency (no git library, no mermaid in `apps/cli`). No full-history graph. No branch deletion or `--prune` flag. No second git-exec helper beside `CommandRunner`.

**Rejected.** A full-history gitGraph (unreadable at ~5k commits). A new `git` noun (public-surface churn). A git library dependency (porcelain is enough).

**Handoff.** Task 1220 consumes `spur builder show-branches --base <b> --pr` and the `BranchTopology` JSON shape; keep both stable.

### Plan

1. Write the failure list first as E2E cases against throwaway repos built with `git init` in `$TMPDIR` (no stubs for git): no remote/origin HEAD, unknown `--base`, detached HEAD, single-branch repo, branch names with `/`, `.`, quotes, more branches than `--limit`, a revert commit, a contained branch, gh absent (stub runner only for gh).
2. Implement `collectBranchTopology` and the three renderers (R1, R4, R6).
3. Wire `show-branches` with the frozen flags and exit codes; register it in `apps/cli/src/commands/builder.ts` (R2).
4. Graph checks (R3): an E2E assertion that every emitted graph line matches the allowed-statement regex set, plus one `test:heavy` proof that parses a fixture with `mermaid.parse` using the dependency already present in `apps/web`; if `mermaid.parse` cannot run headless under Bun, record that in Testing and keep the regex check. Do not add mermaid to any other workspace.
5. `--pr` enrichment and degradation with a stubbed gh in the runner (R5).
6. Docs (R7): add the `show-branches` amendment row to `docs/design/harness-surface-governance.md` §3 citing operator consent (2026-10-16, feature L1); update `plugins/sp/skills/spur-cli/references/builder.md` (frontmatter description and the "frozen at exactly four verbs" sentence at line 18 → five, plus a `show-branches` section); add the builder bullet to `docs/design/cli-contracts.md`.
7. Run `spur builder show-branches` against this repo; save the markdown output under `.spur/run/1218-show-branches.md` as the repeatable artifact and cite it in Testing.
8. `bun run spur-check`.

### Solution

<!-- Filled during implementation: file:line change map and concise rationale. -->

### Testing

<!-- Filled during verification: commands run, outcomes, coverage claim or N/A. -->

### Review

#### Review Report — 1218 (feature L1)

**Scope:** uncommitted working-tree change set (21 paths: 6 new, 15 modified), built from
`git status --porcelain` + `git diff` + untracked paths, reviewed against task 1218 R1–R7 /
AC1–AC7, `docs/design/builder-branches-and-pr-review.md` §3.1, and feature-L1 R1–R6/R13/R14.
**Dimensions:** functional, security, efficiency, correctness, usability, architecture
**Verdict:** PARTIAL

##### Findings (ranked)

| # | Priority | Dimension | Finding | Location | Disposition |
|---|----------|-----------|---------|----------|-------------|
| 1 | P2 (major) | correctness | Base-line fork commits are appended after the base's newest window, so a branch forked deeper than `--max-commits` renders its fork point to the right of the base tip. `renderGitGraph` emits the base row's window first (`render.ts:136-142`) and each row's fork point afterwards (`render.ts:151-161`); mermaid places commits in statement order, so a fork point older than the base window reads as newer than the base tip. Verified by rendering the exact CLI output of a repo (`main` = c1..c6, `feat` forked at c2): base line renders `c4→c5→c6→c2`, with `ba3cf0e` (=c2 fork, x=160) right of `e8ca7b0` (=c6 tip, x=110) and `feat` branching off c2 — under mermaid@11.15.0 (`apps/web/package.json:28`). The markdown/text tables have no fork-point column (`render.ts:27`), so the graph is the only place a fork point is shown, and §3.1 asks for branches "in fork-point order". | `packages/app/src/services/branch-topology/render.ts:136-161` | OPEN |
| 2 | P4 (advisory) | usability | A zero-commit repository (unborn HEAD — `git init` then run) exits 1 with `unknown base ref 'main' (no --base given; tried origin/HEAD, then main)` instead of rendering a base-only report. R14's gherkin scopes "empty" to "no branches besides the base" (single-branch, which passes) and the Design maps an unknown base to exit 1, so this is a wording ambiguity rather than a broken AC. | `packages/app/src/services/branch-topology/index.ts:155-182` | ACCEPTED |
| 3 | P4 (advisory) | architecture | `BranchRow` carries `commits: BranchCommit[]`, an additive field beyond the task's Frozen-names `BranchRow`; required so the renderers stay pure and git-free (the collector owns the commit window). Documented at the field. | `packages/app/src/services/branch-topology/index.ts:60-68` | ACCEPTED |
| 4 | P4 (advisory) | scope | The diff also fixes unrelated `projects add --host` drift in `docs/help/cmd_projects.md` and `docs/help2/projects.md` — outside 1218's R7 doc set but required by the help-docs-parity gate (task 1020). The live CLI does expose `--host`, so the doc is correct. | `docs/help/cmd_projects.md:31` | ACCEPTED |
| 5 | P4 (advisory) | documentation | The task's `### Solution` and `### Testing` sections are still empty placeholders and no R/AC checkbox is checked, so traceability rests on code + `.spur/run/1218-show-branches.md` rather than the task body; the verify/wrap stages own the Testing fill. | `docs/tasks5/1218_add-spur-builder-show-branches-branch-topology-report.md` | ACCEPTED |
| 6 | P4 (advisory) | usability | When the base is `origin/main` and the local `main` diverged, the `main` row is drawn by `checkout main` on mermaid's implicit branch (which starts at the graph root), so the row reads as forking from the beginning rather than from its fork point. Documented workaround (mermaid rejects re-creating `main`); the fork commit is still emitted on the base line. | `packages/app/src/services/branch-topology/render.ts:162-165` | ACCEPTED |

##### Functional Traceability

| Req | Status | Evidence |
|-----|--------|----------|
| R1 | MET | `index.ts:120` collect, `:155` base chain (--base→origin/HEAD→main), `:184` refs + remote-twin folding, `:216` per-ref merge-base/rev-list/log-1, `:282` worktrees; E2E `apps/cli/tests/commands/builder/show-branches.test.ts` asserts name/forkPoint/ahead/behind/contained/date/worktree, the `--base` override, `--local`/`--remote`, and that refs + worktrees are unchanged after a run |
| R2 | MET | `show-branches.ts:39-48` flags, `:108-118` format resolution; execution: `--format yaml` → exit 1 naming `markdown | json | text`; default output == `--format markdown` |
| R3 | PARTIAL | Allowed-statement allow-list + mermaid parse proof pass (`apps/web/tests/branch-topology-graph.heavy.test.ts`, 8 pass); base-line fork placement is wrong for forks deeper than `--max-commits` — Finding 1 (`render.ts:136-161`) |
| R4 | MET | `render.ts:32-60`; execution: json `{base,generatedAt,branches,omitted,warnings}` with the same rows, text aligned table without mermaid; `--json` byte-identical to `--format json` |
| R5 | MET | `index.ts:368-411` (one `gh pr list` call), `:413-421` head-ref mapping, empty `reviewDecision`→`null`; execution: `gh` absent → one warning + exit 0; E2E covers the unauthenticated case |
| R6 | MET | `index.ts:257-265` detached row, `:120-134` `--limit` + omitted count; execution: detached row named by short sha, `--limit 2` → `omitted: 2` + footer, single-branch → base-only graph |
| R7 | MET | Governance §3 amendment `docs/design/harness-surface-governance.md:182`; `plugins/sp/skills/spur-cli/references/builder.md:3,18,29,74-110` (five verbs + show-branches); `SKILL.md:47`; `docs/04_DESIGN.md:87` indexes the satellite |

##### Acceptance Criteria

| AC | Status | Evidence |
|----|--------|----------|
| AC1 | MET | R1 row |
| AC2 | MET | R2 row — default markdown, one fenced block whose first line is `gitGraph` |
| AC3 | MET | `apps/web/tests/branch-topology-graph.heavy.test.ts` — mermaid 11.15.0 parses the CLI-rendered graph (8 pass) |
| AC4 | MET | R4 row |
| AC5 | MET | R5 row |
| AC6 | MET | R7 row |
| AC7 | PARTIAL | Detached + single-branch verified by execution; a zero-commit "empty" repo exits 1 (Finding 2, advisory); "large" (>50 branches) is not exercised E2E, but `--limit`/omitted arithmetic is unit-tested (`packages/app/tests/services/branch-topology/index.test.ts`) |

##### Verification performed

By execution — throwaway `git init` repos under `$TMPDIR`, real CLI at
`bun <tree>/apps/cli/src/index.ts builder show-branches` (tree `git status --porcelain` unchanged
afterwards): default/markdown/json/text formats; `--json` alias; `--base` override + unknown base
(exit 1); `--format yaml` (exit 1); `--local`+`--remote` (exit 1); detached HEAD row; single-branch
base-only graph; remote twin folding + `origin/HEAD` base; `--limit 2` omitted arithmetic;
`--max-commits`/`--theme`/`--hide-contained` graph shaping; `--pr` with `gh` off `PATH` (one warning,
exit 0); non-repository cwd (exit 2); and a mermaid render of the exact CLI graph (Finding 1).
Focused suites re-run: `apps/cli/tests/commands/builder/show-branches.test.ts` **34 pass / 0 fail**,
`packages/app/tests/services/branch-topology/` **39 pass / 0 fail**,
`apps/web/tests/branch-topology-graph.heavy.test.ts` **8 pass / 0 fail**.

By reading: ADR-021 thin transport (no git in `apps/cli`; the single `createSpawnRunner` seam is
reused rather than a second git-exec helper; `packages/app/package.json:29` adds only the export
subpath — no new runtime dependency); the read-only git verb set; annotated-vs-lightweight tag peel
(`index.ts:321-338`); date-offset-aware sort determinism (`index.ts:267-279`); help-docs parity docs.

**Not verified:** a real `gh`-authenticated `--pr` enrichment against live PRs (only shimmed/stubbed),
and a >50-branch repository (covered by `--limit` unit tests, not an E2E).

**Next:** fix Finding 1 — build the base line in commit order (interleave the fork-point commits with
the base window, or emit them in fork-point order) so a fork deeper than `--max-commits` draws at its
true position; the markdown/text tables convey no fork point, so the graph is the only correction site.

### References

<!-- Links to the parent feature, design docs, related tasks, or external references. -->

### History

- 2026-10-16T18:23:10.575Z feature_id Q → L1 (system)
- 2026-10-16T20:34:34.537Z todo → wip (system)

