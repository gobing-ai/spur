---
schema_version: 1
name: Add spur builder show-branches branch topology report
status: todo
template: feature-impl
created_at: 2026-10-16T18:16:16.605Z
updated_at: "2026-10-16T18:25:24.793Z"
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

<!-- Filled during review: P1-P4 findings, residual risk, and final disposition. -->

### References

<!-- Links to the parent feature, design docs, related tasks, or external references. -->

### History

- 2026-10-16T18:23:10.575Z feature_id Q → L1 (system)

