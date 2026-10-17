---
schema_version: 1
name: Add spur builder show-branches branch topology report
status: done
template: feature-impl
created_at: 2026-10-16T18:16:16.605Z
updated_at: "2026-10-17T01:09:29.734Z"
feature_id: L1
priority: P2
tags:
  - cli
  - builder
  - git
estimate_hours: 6

done_forced: "false"
done_reason: unforced close; PASS artifact at .spur/memory/evidence/1218-verdict.json
---

## 1218. Add spur builder show-branches branch topology report

### Background

Implements: R1 — show-branches reports every branch relative to a base; R2 — Markdown is the default format and carries a condensed mermaid gitGraph; R3 — The gitGraph text uses only the referenced mermaid syntax and stays renderable; R4 — json and text formats expose the same branch model; R5 — Pull-request state enriches branches when gh is available and degrades when it is not; R13 — The builder surface is documented where the CLI facade and design index look (show-branches half); R14 — show-branches handles empty, detached and large repositories.

Today nothing in Spur reports branch relationships: on 2026-10-16, 26 of 31 origin branches had 0 commits ahead of main. Design: docs/design/builder-branches-and-pr-review.md §3.1.

### Requirements

- [x] R1. `spur builder show-branches` collects, read-only, per branch: name, fork point, ahead/behind vs base, contained flag (ahead == 0), last-commit date/subject, worktree path; base = `--base` else origin/HEAD target else main; `--local`/`--remote` filters.
- [x] R2. `--format markdown|json|text`, default markdown; unknown value exits 1 naming the three values.
- [x] R3. Markdown = summary table + one condensed mermaid gitGraph (base line, one branch per non-contained ref, at most `--max-commits` (default 3) nodes plus a `+N earlier` summary node, tip HIGHLIGHT, revert commits REVERSE, contained branches joined back unless `--hide-contained`, base tags as `tag:`), sanitized ids, optional `--theme` init directive.
- [x] R4. json = `{ base, generatedAt, branches[], omitted, warnings[] }` with the same rows as the table; text = aligned table without mermaid.
- [x] R5. `--pr` enriches rows from one `gh pr list` call; gh missing/unauthenticated yields null PR fields and one warning, never a failure.
- [x] R6. Detached HEAD row by short sha; `--limit <n>` (default 30) with omitted-count footer; single-branch repo renders base-only graph.
- [x] R7. Governance §3 amendment row records operator consent for the fifth builder verb; `sp:spur-cli` builder reference documents the verb and lifts the frozen-set sentence to five verbs.

### Acceptance Criteria

- [x] AC1 — show-branches reports every branch relative to a base
- [x] AC2 — Markdown is the default format and carries a condensed mermaid gitGraph
- [x] AC3 — The gitGraph text uses only the referenced mermaid syntax and stays renderable
- [x] AC4 — json and text formats expose the same branch model
- [x] AC5 — Pull-request state enriches branches when gh is available and degrades when it is not
- [x] AC6 — The builder surface is documented where the CLI facade and design index look
- [x] AC7 — show-branches handles empty, detached and large repositories

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

Change-map (auto-generated — implement step did not record a Solution).
Each entry cites the first changed line per file (`file:line`).

| Change (`file:line`) |
|----------------------|
| `apps/cli/src/commands/builder.ts:12` |
| `apps/cli/src/commands/builder.ts:16` |
| `apps/cli/src/commands/builder.ts:170` |
| `apps/cli/src/commands/builder.ts:6` |
| `apps/cli/src/commands/builder/show-branches.ts:1` |
| `apps/cli/src/index.ts:323` |
| `apps/cli/src/index.ts:328` |
| `apps/cli/tests/commands/builder.test.ts:65` |
| `apps/cli/tests/commands/builder.test.ts:76` |
| `apps/cli/tests/commands/builder.test.ts:78` |
| `apps/cli/tests/commands/builder/show-branches.test.ts:1` |
| `apps/web/tests/branch-topology-graph.heavy.test.ts:1` |
| `docs/design/builder-branches-and-pr-review.md:101` |
| `docs/design/builder-branches-and-pr-review.md:89` |
| `docs/design/cli-contracts.md:166` |
| `docs/design/cli-contracts.md:258` |
| `docs/design/cli-contracts.md:48` |
| `docs/design/harness-surface-governance.md:182` |
| `docs/features/INDEX.md:182` |
| `docs/features/L1_pr-review-and-branch-topology-for-daily-use.md:173` |
| `docs/features/L1_pr-review-and-branch-topology-for-daily-use.md:183` |
| `docs/features/L1_pr-review-and-branch-topology-for-daily-use.md:5` |
| `docs/features/L1_pr-review-and-branch-topology-for-daily-use.md:9` |
| `docs/help/cmd_builder.md:111` |
| `docs/help/cmd_builder.md:22` |
| `docs/help/cmd_builder.md:6` |
| `docs/help/cmd_projects.md:31` |
| `docs/help/spur-cli-matrix.md:115` |
| `docs/help/spur-cli-matrix.md:119` |
| `docs/help/spur-cli-matrix.md:76` |
| `docs/help/spur-cli-matrix.md:93` |
| `docs/help2/builder.md:12` |
| `docs/help2/builder.md:3` |
| `docs/help2/builder.md:55` |
| `docs/help2/projects.md:28` |
| `packages/app/package.json:29` |
| `packages/app/src/services/branch-topology/index.ts:1` |
| `packages/app/src/services/branch-topology/render.ts:1` |
| `packages/app/tests/services/branch-topology/index.test.ts:1` |
| `packages/app/tests/services/branch-topology/render.test.ts:1` |
| `plugins/sp/skills/spur-cli/SKILL.md:47` |
| `plugins/sp/skills/spur-cli/references/builder.md:18` |
| `plugins/sp/skills/spur-cli/references/builder.md:29` |
| `plugins/sp/skills/spur-cli/references/builder.md:3` |
| `plugins/sp/skills/spur-cli/references/builder.md:73` |

### Testing

**Pipeline verify results**

- Verdict: PASS (from verdict artifact)

| Requirement | Status | Evidence |
|-------------|--------|----------|
| R1 | MET | `collectBranchTopology` + `buildRow` gather name/forkPoint/ahead/behind/contained/lastCommitAt/subject/worktree (`packages/app/src/services/branch-topology/index.ts:120`, `packages/app/src/services/branch-topology/index.ts:216`); base chain `--base` → `origin/HEAD` → `main` (`packages/app/src/services/branch-topology/index.ts:155`); refs, remote-twin folding and `--local`/`--remote` (`packages/app/src/services/branch-topology/index.ts:184`); worktrees (`packages/app/src/services/branch-topology/index.ts:282`). Executed in throwaway repos: JSON rows carried all eight fields; base defaulted to `main`, became `origin/release` from `origin/HEAD`, `--base origin/side` overrode it, `--base nope` exited 1; `--local`/`--remote` filtered kinds; `git for-each-ref` output unchanged around a `--pr` run. Re-verified 2026-10-16 (verifyall L1 --force): `(cd apps/cli && bun test tests/commands/builder/show-branches.test.ts …)` 94 pass / 0 fail; `(cd packages/app && bun test tests/services/branch-topology tests/services/pr-review)` 122 pass / 0 fail; throwaway repo: `feature/a` ahead 2 / behind 1, `feature/contained` contained true, `--base nope` exit 1 `unknown base ref`, `--local --remote` exit 1, `git for-each-ref` digest unchanged. |
| R2 | MET | Flags + dispatch (`apps/cli/src/commands/builder/show-branches.ts:39`), format resolution with `--json` alias (`apps/cli/src/commands/builder/show-branches.ts:108`). Executed: default stdout equalled `--format markdown`; `--format xml` exited 1 with `unknown --format 'xml'` and named markdown, json and text; `--json` and `--format=json` emitted bare `{` JSON with no banner. Re-verified 2026-10-16 (verifyall L1 --force): default output vs `--format markdown` differ only in `generatedAt`; `--format xml` exit 1 `unknown --format 'xml': expected markdown \| json \| text`. |
| R3 | MET | `renderGitGraph` (`packages/app/src/services/branch-topology/render.ts:120`), tip `HIGHLIGHT`/revert `REVERSE` (`packages/app/src/services/branch-topology/render.ts:267`), id de-duplication (`packages/app/src/services/branch-topology/render.ts:325`). Executed on throwaway repos: exactly one fenced `gitGraph` with a base line, one `branch`+`commit` lane per non-contained ref, `commit id:"+2 earlier"` for the hidden commits, `type: HIGHLIGHT` tips, a non-tip revert rendered `type: REVERSE`, contained joins dropped by `--hide-contained`, `tag:"v0"`/`tag:"v1"` on shown base commits, sanitized ids (`1.x`, `fix/quote-name`), and `%%{init: { 'theme': 'dark' } }%%` from `--theme dark`. Re-verified 2026-10-16 (verifyall L1 --force): single-commit repo rendered `gitGraph` + one `type: HIGHLIGHT` commit; heavy `bun test --config=bunfig.heavy.toml apps/web/tests/branch-topology-graph.heavy.test.ts` 10 pass / 0 fail. |
| R4 | MET | `renderText` (`packages/app/src/services/branch-topology/render.ts:45`), `markdownTable`/`rowCells` (`packages/app/src/services/branch-topology/render.ts:62`). Executed: json = `{ base, generatedAt, branches[], omitted, warnings[] }`; text = aligned `branch ahead behind contained last commit worktree PR` table with no mermaid fence; both formats listed the same rows with identical values. Re-verified 2026-10-16 (verifyall L1 --force): `--format text` printed the aligned header + `feature/a 2 1 no` row with 0 mermaid lines. |
| R5 | MET | One `gh pr list` call (`packages/app/src/services/branch-topology/index.ts:368`), head-ref mapping incl. remote twin (`packages/app/src/services/branch-topology/index.ts:413`). Executed: a fake `gh` exiting 1 gave `warnings: ["--pr: gh pr list failed: exit 1"]`, every `pr` null and exit 0; a fake `gh` returning `[{"number":42,"headRefName":"feature/a","state":"OPEN","reviewDecision":""}]` gave `feature/a.pr = {number:42, state:'OPEN', reviewDecision:null}` after exactly one `gh` invocation. Re-verified 2026-10-16 (verifyall L1 --force): failing gh stub on PATH → `warnings:["--pr: gh pr list failed: exit 1"]`, all `pr` null, exit 0. |
| R6 | MET | Detached row (`packages/app/src/services/branch-topology/index.ts:257`), `--limit`/`omitted` (`packages/app/src/services/branch-topology/index.ts:140`). Executed: detached HEAD reported as row `d8c4cc7` (kind `detached`); a 41-ref repo at the default limit kept 30 rows with `omitted: 11` and the `Omitted: 11 branches beyond --limit.` footer; a single-branch repo rendered a base-only graph (`gitGraph` plus one `HIGHLIGHT` commit). Re-verified 2026-10-16 (verifyall L1 --force): 38-ref repo at default limit → 30 rows, `omitted: 8`; `--limit 100` → 38 rows, `omitted: 0`; detached HEAD → row `f8b359d`. |
| R7 | MET | Governance amendment `docs/design/harness-surface-governance.md:176` is the consent-gate entry for the fifth builder verb `show-branches` (operator consent 2026-10-16, feature L1); `plugins/sp/skills/spur-cli/references/builder.md:19` carries the frozen-set sentence (since widened to eight verbs by task 1219 — a documented later amendment, not drift) and `plugins/sp/skills/spur-cli/references/builder.md:105` the `show-branches` section; `plugins/sp/skills/spur-cli/SKILL.md:47` lists it; `docs/design/cli-contracts.md:47` names it. Re-verified 2026-10-16 (verifyall L1 --force): `bun apps/cli/src/index.ts builder --help` lists `show-branches`. Prior anchors `:182`/`builder.md:18` were stale after 1219 and are replaced here. |

| Acceptance Criteria | Status | Evidence Type | Evidence |
|---------------------|--------|---------------|----------|
| AC1 — show-branches reports every branch relative to a base | MET | command | `builder show-branches --format json` in a throwaway repo listed `feature/a` (ahead 2 / behind 2), `feature/contained` (ahead 0 → contained), `feature/deep`, `feature/revert`, `feature/wide`, `main`, each with a forkPoint measured against the resolved base; base resolution exercised (`main`, `origin/release`, `--base origin/side`, `--base nope` exit 1). Anchor `packages/app/src/services/branch-topology/index.ts:120`. |
| AC2 — Markdown is the default format and carries a condensed mermaid gitGraph | MET | command | Bare `builder show-branches` printed the `## Branch topology vs main` H2, the summary table (branch, ahead, behind, contained, last commit, worktree, PR columns), and exactly one fenced `mermaid` block holding a single `gitGraph` (`packages/app/src/services/branch-topology/render.ts:120`); `--format text` printed the same rows with no mermaid fence. |
| AC3 — The gitGraph text uses only the referenced mermaid syntax and stays renderable | MET | test | `apps/web/tests/branch-topology-graph.heavy.test.ts` run independently as `bun test --config=bunfig.heavy.toml apps/web/tests/branch-topology-graph.heavy.test.ts` → 10 pass / 0 fail: every CLI-rendered line matched the statement allow-list and the pinned `mermaid@11.15.0` parsed and rendered the graphs (`apps/web/tests/branch-topology-graph.heavy.test.ts:265`). |
| AC4 — json and text formats expose the same branch model | MET | command | On one throwaway repo `--format json` and `--format text` listed the same branches with identical `ahead`/`behind`/`contained`/last-commit/worktree values, and json carried `{ base, generatedAt, branches[], omitted, warnings[] }` (`packages/app/src/services/branch-topology/render.ts:45`). |
| AC5 — Pull-request state enriches branches when gh is available and degrades when it is not | MET | command | Failing fake `gh` → one `--pr: gh pr list failed: exit 1` warning, every `pr` null, exit 0; succeeding fake `gh` → `feature/a.pr = {number:42, state:'OPEN', reviewDecision:null}` from exactly one `gh pr list` call (`packages/app/src/services/branch-topology/index.ts:368`). |
| AC6 — The builder surface is documented where the CLI facade and design index look | MET | command | Re-verified 2026-10-16 (verifyall L1 --force): `bun apps/cli/src/index.ts builder --help` lists `show-branches`; the verb is documented at `plugins/sp/skills/spur-cli/references/builder.md:105`, `docs/help/cmd_builder.md:7`, and `docs/help2/builder.md`; `docs/04_DESIGN.md:87` indexes `docs/design/builder-branches-and-pr-review.md`; `(cd plugins/sp && bun test tests/help-docs-parity.test.ts)` 3 pass / 0 fail. |
| AC7 — show-branches handles empty, detached and large repositories | MET | command | Detached HEAD reported as row `d8c4cc7`; single-branch repo rendered a base-only graph; a 41-ref repo at the default limit kept 30 rows with `omitted: 11` and the omitted footer (`packages/app/src/services/branch-topology/index.ts:257`). An unborn-HEAD repo (`git init`, no commit) exits 1 with `unknown base ref 'main' (no --base given; tried origin/HEAD, then main)` — the recorded, accepted reading where "empty" means no branches besides the base, satisfied by the single-branch fixture. |
- Coverage: N/A (verdict-based; verify pipeline does not measure code coverage)

### Review

#### Review Report — 1218 (feature L1) — round 4

**Scope:** `git diff main...HEAD` (22 paths, ~3.16k insertions) — `9cf497759` (implementation, 21
paths) plus `f8cef56c0` (base-line fork ordering) — together with the **uncommitted rounds 2–3
repair** (`packages/app/src/services/branch-topology/render.ts`,
`packages/app/tests/services/branch-topology/render.test.ts`,
`apps/web/tests/branch-topology-graph.heavy.test.ts`,
`docs/design/builder-branches-and-pr-review.md`). A fresh reviewer read the whole change, not only
the last round. Reviewed against task 1218 R1–R7 / AC1–AC7,
`docs/design/builder-branches-and-pr-review.md` §3.1 (authority on the graph's statement order) and
feature-L1 R1–R6, R13, R14. The pipeline-owned corpus writes (`docs/features/L1_*.md`,
`docs/features/INDEX.md`, `docs/tasks5/1218_*.md`) were not reviewed and not touched.
**Dimensions:** functional traceability, security, efficiency, correctness, usability, architecture
**Verdict:** PASS — no open P1–P3 finding. Round 3's P3 (`emittedShas`) is **RESOLVED** by the
uncommitted tree; rounds 1–2 stay resolved and were re-verified by execution. Nine P4 advisories are
recorded: seven carried forward (all re-judged non-blocking this round) and two documentation /
scope observations.

##### Findings (ranked)

| # | Priority | Dimension | Finding | Location | Disposition |
|---|----------|-----------|---------|----------|-------------|
| 1 | P4 (advisory) | documentation | `--max-commits` is silently capped at `GRAPH_COMMIT_WINDOW` (10). Reproduced: on an 8-commit base with a branch 4 ahead, `--max-commits 12` and `--max-commits 20` both draw the same 10 nodes plus a `+2 earlier` summary node, while `--help`, `plugins/sp/skills/spur-cli/references/builder.md:74` and `docs/design/cli-contracts.md` describe the flag as the per-line node cap with no ceiling. "At most `--max-commits`" stays literally true, so this is documentation, not behavior. | `packages/app/src/services/branch-topology/index.ts:27` | ACCEPTED |
| 2 | P4 (advisory) | usability | `--limit` can truncate the base row itself out of the report. Reproduced on a 36-ref fixture whose base commit predates every branch: the default `--limit 30` prints `Omitted: 6 branches beyond --limit.` and a table/graph with no `main` row, although the title is `## Branch topology vs \`main\`` and every cell is measured against it (the graph degrades to a hoisted base-tip node because an absent base row leaves the window empty). | `packages/app/src/services/branch-topology/index.ts:140` | ACCEPTED |
| 3 | P4 (advisory) | usability | A dangling `refs/remotes/origin/HEAD` ends the base chain one link early: with `origin/HEAD` pointing at a deleted ref and a resolvable `main`, the verb exits 1 with `unknown base ref 'origin/gone' (no --base given; tried origin/HEAD, then main)`, a message asserting a `main` attempt that never happened. Reproduced in a throwaway repo. Judged non-blocking: the failure is loud, `--base main` is a one-flag workaround, and the state is an already-broken remote. | `packages/app/src/services/branch-topology/index.ts:161-176` | ACCEPTED |
| 4 | P4 (advisory) | usability | A repository whose HEAD is unborn (`git init`, no commit) exits 1 with the derived-base message instead of rendering a base-only report; feature R14's "empty" case is "no branches besides the base", which the single-branch fixture satisfies. Reproduced. | `packages/app/src/services/branch-topology/index.ts:175` | ACCEPTED |
| 5 | P4 (advisory) | efficiency | Collection is O(refs) before `--limit` truncates. Measured with a counting `git` shim on a 36-ref repository: 144 git calls in 2.2 s, of which 108 are per-ref (`merge-base`, `rev-list --left-right --count`, `log -1` — 3 × 36) for the 30 rows and the base row the report keeps. Acceptable for triage; it is the cost center on a large repository. | `packages/app/src/services/branch-topology/index.ts:127-140` | ACCEPTED |
| 6 | P4 (advisory) | usability / fidelity | Every lane hangs off the base tip and shared commits are re-emitted per lane, so each re-emission shows a de-duplication suffix as the node label. Reproduced on a chained fixture (`feature` then `feature-2`): lane `feature-2` renders `19fab97-2` beside `feature`'s `19fab97`, and the pinned mermaid renders both labels. The same effect makes the `+N earlier` summaries read `+1 earlier`, `+1 earlier-2`, `+1 earlier-3` on three equal branches. Both follow the model §3.1 prescribes ("`checkout <base>` → `branch <name>`"; mermaid needs unique ids) and both graphs are valid, so this is a readability cost, not a defect. | `packages/app/src/services/branch-topology/render.ts:195-203` | ACCEPTED |
| 7 | P4 (advisory) | usability | `--remote` with a base that only exists locally (e.g. `main` with no `origin/HEAD`) matches no base row (`isBaseRow` matches a local row to an `origin/<branch>` base, never the reverse), so the graph draws no base-line tip and the base tip reappears as the contained `origin/<base>` join node without `HIGHLIGHT`. Reproduced (`--remote` in a repo with a remote but no `refs/remotes/origin/HEAD`). Same degradation class as Finding 2, reachable without `--limit`. | `packages/app/src/services/branch-topology/render.ts:316` | ACCEPTED |
| 8 | P4 (advisory) | documentation | `docs/help/cmd_builder.md:22` and `:120` carry raw `\|` inside cells for the three format names, so GFM splits those rows into four columns while the help-parity splitter honours only `\|` and stays green. Separately, `docs/help/spur-cli-matrix.md:20` still shows the pre-1218 `builder 3` / `workflow 13` counts in the matrix's leading `Verb count` row while its own trailing twin at `:93` was updated to `5` / `14`; the parity parser reads last-wins, and the leading row was already stale at `main` (`builder 3` vs the then-live 4), so this is pre-existing drift the change partially repaired. | `docs/help/cmd_builder.md:22` | ACCEPTED |
| 9 | P4 (advisory) | scope | The implementation commit also edits `docs/help/cmd_projects.md` and `docs/help2/projects.md` (`projects add --host`), outside R7's builder surface. Not drive-by: the R2 help-parity check (`plugins/sp/tests/help-docs-parity.test.ts:319-350`) requires every live flag to be mentioned in each tree's owning page, and `--host` is absent from both pages at `main` (re-checked with the suite's own word-boundary matcher against `git show main:<page>`), so the baseline gate was red and this line is the repair. Worth naming because it lands an unrelated fix inside a task commit. | `docs/help/cmd_projects.md:31` | ACCEPTED |
| — | P3 (minor) | correctness / maintainability | **Round 3's P3 — RESOLVED.** `emittedShas` is gone: `grep -rn emittedShas packages apps plugins` → no hits, `commitStatement` takes four parameters (`render.ts:216-222`), and the round-1 fork guard's replacement is the mermaid-id de-duplication in `uniqueId` (`render.ts:325`). No test asserted the removed state, so nothing was weakened: `(packages/app) bun test tests/services/branch-topology/` → 41 pass / 0 fail and the heavy proof stays green. | `packages/app/src/services/branch-topology/render.ts:216` | RESOLVED (working tree, uncommitted) |
| — | P2 (major) | correctness | **Round 2's P2 — RESOLVED, re-verified by execution.** The `+N earlier` summary now runs through `uniqueId` like every other id (`render.ts:203`). Two branches each hiding one commit render `commit id:"+1 earlier"` and `commit id:"+1 earlier-2"`, and the pinned `mermaid@11.15.0` renders two distinct labels (`+1 earlier`, `+1 earlier-2`) on two lanes — the pre-fix shape collapses them into one node and robs a lane of its summary. Regression evidence: `render.test.ts:527` (exact emitted lines) and `branch-topology-graph.heavy.test.ts:360` (mounted SVG labels), both green. | `packages/app/src/services/branch-topology/render.ts:203` | RESOLVED (working tree, uncommitted) |
| — | P3 (minor) | documentation | **Round 2's P3 — RESOLVED.** §3.1 no longer instructs a per-branch fork node; it now states "a fork point the window already draws is one of its own commits, so it is never repeated, and every fork point is therefore on the base line — no per-branch fork statement exists" (`docs/design/builder-branches-and-pr-review.md:90-97`). The claim is sound: the hoist covers every fork point at or beyond the window (`behind >= windowLength`, `render.ts:247-260`, correct because `behind` is the fork point's index in the base's newest-first history), the window covers the rest, an absent base row degrades to `windowLength = 0` and hoists every drawn fork point, and no per-branch fork statement is emitted on any of the ten CLI-rendered fixtures re-checked this round. | `docs/design/builder-branches-and-pr-review.md:94` | RESOLVED (working tree, uncommitted) |
| — | P2 (major) | correctness | **Round 1's P2 — RESOLVED** by `f8cef56c0`, re-verified by execution. On a deep-fork fixture (fork 6 commits before the base tip, default `--max-commits 3`) the base line emits the fork point first and then the window oldest to newest with the tip last (`type: HIGHLIGHT`), so no base-line commit is drawn right of a newer one; the in-tree x-position proof (`branch-topology-graph.heavy.test.ts:318-355`) passes. | `packages/app/src/services/branch-topology/render.ts:149-168` | RESOLVED (f8cef56c0) |

##### Functional Traceability

| Req | Status | Evidence |
|-----|--------|----------|
| R1 | MET | Base chain `--base` → `origin/HEAD` target → `main` (`index.ts:155-177`); refs + remote-twin folding `index.ts:184-206`; per-ref `merge-base` / `rev-list --left-right --count` / `log -1` `index.ts:216-243`; worktrees `index.ts:282-318`; `--local`/`--remote` `index.ts:185`. Executed: base defaults to `main` with no remote, becomes `origin/main` from `origin/HEAD`, `--base <branch>` overrides, `--base nope` exits 1, detached row by short sha, remote-only row, worktree path for a linked checkout, `--local`/`--remote` namespaces; refs/HEAD/`.git/config` hashes unchanged around a `--pr` run. The one gap in this chain is Finding 3. |
| R2 | MET | Flags `show-branches.ts:39-48`; format resolution + `--json` alias `show-branches.ts:108-120`; usage/exit codes `:90-102`, `:132-135`. Executed: `--format yaml` → exit 1 naming `markdown \| json \| text`; default stdout == `--format markdown` modulo `generatedAt`; `--json` == `--format json` == `--format=json` (byte-identical modulo the timestamp); `--local --remote`, `--json --format text`, `--limit 0/abc`, `--max-commits 0`, an extra positional → exit 1; non-repo → exit 2; `gh` absent → exit 0 with a warning. |
| R3 | MET | `renderGitGraph` `render.ts:120-218`; sanitization `render.ts:297-311`; tag claiming `:233-246`; base-tip `HIGHLIGHT` `:161-162`, branch-tip `HIGHLIGHT` `:199`; `REVERSE` `:267-269`. Executed independently: ten CLI-rendered graphs (tags, deep fork, `--limit` truncation, detached, `--remote`, identical branches, chained branches, `1.x` / `a"b` / `a-b` / `x%y` / `x@y` refnames, adversarial `'; alert(1); //` theme) **parsed and rendered** under the pinned `mermaid@11.15.0` (`apps/web/node_modules/mermaid`) with zero duplicate commit ids and every declared id visible in the SVG. Round 2's collision was the last fidelity gap. |
| R4 | MET | `markdownTable`/`rowCells` `render.ts:32-76`; `renderText` `:45-60`. Executed: json = `{ base, generatedAt, branches[], omitted, warnings[] }`, text = aligned table with no fence, identical rows between formats, `--json` alias parity, unknown format exit 1. |
| R5 | MET | One `gh pr list` call `index.ts:368-411`; head-ref mapping incl. the remote twin `:413-420`; empty `reviewDecision` → null `:404`. Executed: with `gh` hidden from `PATH` → one warning `--pr: gh pr list failed: Executable not found in $PATH: "gh"`, every `pr` null, exit 0; with `gh` present but no remote → one warning `no git remotes found`, exit 0. Enrichment and the unauthenticated path are covered by `apps/cli/tests/commands/builder/show-branches.test.ts:341,362,377` and `packages/app/tests/services/branch-topology/index.test.ts:309-395` (read, not re-run). |
| R6 | MET | Detached row `index.ts:257-265`; `--limit` + `omitted` `:140-141`. Executed: detached row named by short sha; 36-ref repo at the default limit → 30 rows, `omitted: 6`, `Omitted: 6 branches beyond --limit.`; single-branch repo → base line only. Finding 2 is the base-row edge. |
| R7 | MET | Governance amendment `docs/design/harness-surface-governance.md:182-193`; `plugins/sp/skills/spur-cli/references/builder.md:3,18,74-110`; `SKILL.md:47`; `docs/design/cli-contracts.md:258-292`; `docs/04_DESIGN.md:87`; `docs/help/cmd_builder.md`, `docs/help2/builder.md:55`, `docs/help/spur-cli-matrix.md`. Gates re-run: `bun test plugins/sp/tests/help-docs-parity.test.ts` → 3 pass / 0 fail, `(apps/cli) bun test tests/commands/builder.test.ts` → 10 pass / 0 fail, `builder --help` lists five verbs. Findings 8 and 9 are the residual doc/scope notes. |
| AC1 | MET | R1 evidence — every branch (local, remote-only, detached) reported relative to a base, `--base` override, contained flag = `ahead == 0`. |
| AC2 | MET | R2/R3 evidence — default format is markdown and carries exactly one fenced `gitGraph`. |
| AC3 | MET | R3 evidence — allow-list on every emitted line plus ten independent mermaid parses/renders of CLI-generated graphs. |
| AC4 | MET | R4 evidence — same row model across json/text/markdown. |
| AC5 | MET | R5 evidence — enrichment plus both degradation paths, exit 0 with one warning. |
| AC6 | MET | R7 evidence — help facade, `sp:spur-cli` reference, `04_DESIGN.md` index; Findings 8–9 are cosmetic. |
| AC7 | MET | R6 evidence — single-branch, detached and 36/120-branch limit cases; the unborn-HEAD repo is Finding 4. |

Feature L1: R1 MET, R2 MET, R3 MET, R4 MET, R5 MET, R13 MET, R14 MET (single-branch, detached,
36/120-branch + `--limit`; unborn-HEAD caveat = Finding 4). L1 R6 covers the four flat `pr-<verb>`
verbs and belongs to task 1219 — out of scope here.

##### SECUA

- **Security — clean.** Every git/gh call goes through the shared `CommandRunner` with argv arrays
  (no shell interpolation anywhere in `show-branches.ts`); `--pr` is the only network path; mermaid
  ids, labels, tags, theme names and ref tokens are sanitized before they reach the graph
  (`render.ts:233-246`, `:297-311`) and an adversarial `--theme "'; alert(1); //"` renders as
  `'---alert-1---//'`; markdown cells escape `|` and backticks (`render.ts:95`). The verb never
  writes refs, config, index or worktrees (confirmed by hashing `for-each-ref` + `HEAD` +
  `.git/config` around a `--pr` run; the `.spur/` a run creates in a bare directory is generic CLI
  bootstrap — `spur status` and even `builder --help` create it too, so it is not a `show-branches`
  side effect).
- **Efficiency — acceptable, with Finding 5.** No new runtime dependency (`packages/app/package.json`
  gains only a subpath export); per-ref git work is the only avoidable cost, measured at 144 calls
  for 36 refs.
- **Correctness — verified.** `behind`/`ahead` map to git's left/right counts correctly (measured:
  `1 4` for a branch forked at `main~1` with four commits; `6 1` for a six-deep fork); remote-twin
  folding, annotated-vs-lightweight tag peeling (an annotated tag lands on its commit, a lightweight
  tag on the same commit, first tag name emitted once), sort order, `--limit`/`omitted` arithmetic,
  detached and unrelated-history rows, id/tag/ref-token uniqueness under sanitize collisions
  (`a"b`→`a-b`, `a-b`→`a-b-2`, `x%y`→`x-y`) all behave as documented, and the round-2 fix introduced
  no new id collision across the ten rendered fixtures. Findings 1–4 and 7 are the residual edges.
- **Usability — good with advisories.** Exit codes 0/1/2, three formats, the omitted footer, the
  degradation warning and banner suppression for `--format json`/`--format=json`
  (`apps/cli/src/index.ts:325-332`, verified: stdout is pure JSON with no `--no-logo`). Findings 2,
  4, 6, 7 are advisory.
- **Architecture — clean.** ADR-021 holds: `show-branches.ts` carries no git logic, `packages/app`
  owns collection and the pure renderers, the existing `createSpawnRunner`/`setCommandRunner` seam is
  reused with `{ cwd: context.cwd, env: context.env }` (`show-branches.ts:69`), and no second
  git-exec helper or mermaid dependency was added.

##### Verification performed

By execution — throwaway `git init` repositories under `/tmp/review1218d` (never this tree, never its
corpus) driven by `bun <tree>/apps/cli/src/index.ts builder show-branches`: default markdown/json/text;
`--json` / `--format json` / `--format=json` equality; `--base` override, unknown `--base`, empty
`--base`; `--local`, `--remote`, `--local --remote`; detached HEAD; unborn HEAD; single-branch;
36-ref `--limit` with and without a droppable base row; a base older than every branch; `--max-commits`
1/3/12/20; `--hide-contained`; `--theme` adversarial; sanitize-collision refnames (`1.x`, `a"b`,
`a-b`, `fix/x`, `x%y`, `x@y`) and a quote in a branch name; revert → `REVERSE`; annotated +
lightweight tags; deep fork behind the window; chained and identical branches; a remote with and
without `origin/HEAD`; a dangling `refs/remotes/origin/HEAD`; `gh` absent via a `PATH` shim and `gh`
present without a remote; extra positional; non-repo (exit 2); refs/HEAD/`.git/config` hash equality
around a run; a counting `git` shim for the call histogram. Ten CLI-rendered graphs were **parsed and
rendered** with `mermaid@11.15.0` from `apps/web/node_modules` under the heavy suite's happy-dom +
DOMPurify shims: all OK, zero duplicate ids, every id visible in the SVG.
Test runs: `(packages/app) bun test tests/services/branch-topology/` → 41 pass / 0 fail;
`(apps/cli) bun test tests/commands/builder/show-branches.test.ts` → 34 pass / 0 fail;
`(apps/cli) bun test tests/commands/builder.test.ts` → 10 pass / 0 fail;
`bun test --config=bunfig.heavy.toml apps/web/tests/branch-topology-graph.heavy.test.ts` → 10 pass /
0 fail; `bun test plugins/sp/tests/help-docs-parity.test.ts` → 3 pass / 0 fail;
`bunx biome check` on the five changed sources → clean; `tsc --noEmit -p packages/app` → clean.
By reading: `index.ts`, `render.ts`, `show-branches.ts`, the three suites, the heavy proof, the
satellite §3.1, the governance amendment, the CLI/help/skill doc set, `plugins/sp/agents`' help-parity
test logic, and the git blame for Findings 6 and 8.
Not run: `bun run spur-check` (green on this tree by instruction) and the repo-wide coverage run.
Not verified: real `gh` against a GitHub repository (local bare origin plus `PATH` shims only), the
report inside the live Board (mermaid was exercised through the pinned library, not the UI), and the
merge-heavy/clock-skew corner where the window could fail to contain a fork point with
`behind < windowLength` (not constructible in the fixtures tried; the effect would be a missing
base-line node, never invalid output).

##### Architectural depth

One opportunity worth the change (round 3 proposed it; still open, still non-blocking): make the
collector fetch only what the report keeps. Today every ref gets `merge-base` + `rev-list` + `log -1`
before `--limit` truncates (`index.ts:127-140`), measured at 108 of 144 git calls for a 36-ref
repository. Because commits are already ordered by date, the same pass could read
`%(committerdate:iso-strict)` in the existing `for-each-ref` (`index.ts:187`), sort and slice first,
and run the three per-ref commands (plus the window fetch) only for the surviving rows and the base
row — `BranchTopology`/`BranchRow`, the renderers and every user-visible assertion stay unchanged,
and the `generatedAt`-only determinism claim holds. Cost: the ref record grows a date field and the
collector's order becomes sort-then-collect, so the existing route-map tests need reordering.

### References

<!-- Links to the parent feature, design docs, related tasks, or external references. -->

### History

- 2026-10-16T18:23:10.575Z feature_id Q → L1 (system)
- 2026-10-16T20:34:34.537Z todo → wip (system)
- 2026-10-16T22:20:18.277Z wip → testing (system)
- 2026-10-16T22:20:32.616Z testing → done (system)

