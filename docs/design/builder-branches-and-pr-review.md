---
kind: design
title: Branch topology report, flat builder pr verbs and the local-first /sp:dev-pr-review
status: implemented
created_at: 2026-10-16
updated_at: 2026-10-16
related:
  - harness-surface-governance.md
  - cli-contracts.md
  - feature L1
tags: [cli, builder, git, pr-review]
---

# Branch topology report, flat `builder pr-<verb>` verbs and the local-first `/sp:dev-pr-review`

## 1. Issue and scope

Feature L1 (child of the `spur builder` umbrella L). Three related gaps:

- **Branch relationships are invisible.** On 2026-10-16, 26 of 31 `origin/*` branches had 0 commits
  not on `main` (`git rev-list --left-right --count main...<b>`). Nothing in Spur reports this, so
  stale branches accumulate and an operator reads topology with ad-hoc `git log --graph`.
- **`spur builder pr` is not a real verb surface.** `apps/cli/src/commands/builder/pr.ts` registers
  one `pr [argv...]` command with `allowUnknownOption(true)` and hands raw argv to
  `main()` in `packages/app/src/services/pr-review/index.ts`. Per-op `--help` does not exist and
  unknown flags are silently accepted.
- **`/sp:dev-pr-review` goes unused.** It was migrated from another project, routes every review
  through the GitHub `@codex review` bot, and exposes seven modes
  (`full|submit|collect|fix|rerun|status|rules`).

In scope: a new read-only `spur builder show-branches` verb; replacing the pass-through `pr <op>`
layer with four flat verbs (`pr-status`, `pr-check`, `pr-open`, `pr-review`) and shrinking
the Codex review workflow to match; a from-scratch `/sp:dev-pr-review` with three modes; the governance
consent amendments and CLI facade docs. Out of scope: branch deletion or pruning, renaming
`builder`, changing the Codex request/collect core logic, full-history graphs, a Board view.

## 2. Context and constraints

- `builder` is frozen at `bump-ver`, `drop-tags`, `publish`, `pr`
  ([harness-surface-governance §3](harness-surface-governance.md)). Each new verb needs its own
  consent-gate amendment. The operator's feature-L1 asks are that consent and must be recorded
  there: "add one more CLI `spur builder show-branches`" and the follow-up choice of four flat
  `pr-<verb>` verbs over a `pr` sub-noun (both 2026-10-16).
- The eight `pr` ops are called only by the Codex review workflow (and its generated copy),
  `sp:pr-reviewing` and the `sp:spur-cli` builder reference; nobody runs a single op by hand.
- Apps are thin transports (ADR-021): git logic belongs in `packages/app`, Commander wiring in
  `apps/cli/src/commands/builder/`.
- The workflow consumes `--json`, `--status-file <f>` and exit codes
  `0 ok · 1 usage · 2 hard failure · 3 wait timeout`. That contract carries over to the new verbs;
  the workflow's terminal states and `mode` values (full, submit, rerun) are unchanged.
- The pr-review service already owns a `CommandRunner` seam (`createSpawnRunner`,
  `setCommandRunner`) used by stubbed git/gh tests; the branch report reuses the same seam rather
  than adding a second git-exec helper.
- Mermaid syntax subset is fixed by the operator's reference (newdevsguide.com, "Illustrating git
  Branching with Markdown & Mermaid.js", 2023-04-11): `gitGraph`; `commit id:"…" tag:"…"
  type: NORMAL|HIGHLIGHT|REVERSE` (`id`/`tag` quoted, `type` bare); `branch`; `checkout`;
  `merge <b> tag:"…"`; optional `%%{init: { 'theme': '<name>' } }%%`.

## 3. Solution

### 3.1 `spur builder show-branches`

```text
apps/cli/src/commands/builder/show-branches.ts   Commander wiring + format dispatch
packages/app/src/services/branch-topology/
  index.ts      collectBranchTopology(runner, opts) → BranchTopology   (git via CommandRunner)
  render.ts     renderMarkdown / renderText / renderGitGraph            (pure)
```

Collection (git only, read-only):

1. Base = `--base <ref>` else `origin/HEAD` symbolic target else `main`.
2. Refs = `git for-each-ref refs/heads refs/remotes` (`--local`/`--remote` filter; `origin/HEAD`
   skipped; a remote ref whose local twin points at the same sha is folded into one row).
3. Per ref: `git merge-base <base> <ref>` (fork point), `git rev-list --left-right --count
   <base>...<ref>` (behind/ahead), `git log -1 --format=%H%x00%cI%x00%s <ref>`.
   `contained = ahead == 0`.
4. Worktrees: `git worktree list --porcelain` → branch → path.
5. `--pr` (opt-in): one `gh pr list --state open --json number,headRefName,state,reviewDecision
   --limit 200`; any gh failure yields `pr: null` on every row plus one warning naming the reason.
6. Rows sorted by last-commit date desc; `--limit <n>` (default 30) truncates with an
   omitted-count footer. Detached HEAD adds a row named by short sha.

Rendering:

- **markdown (default)**: H2 title with base + generated time, the summary table
  (`branch | ahead | behind | contained | last commit | worktree | PR`), then one ```` ```mermaid ````
  block.
- **Condensed gitGraph**: emit the base as the main line **in age order**, because mermaid places
  commits in statement order — first one `commit` per fork point that sits deeper than the shown
  window, deepest first (`behind >= --max-commits`, deduplicated across branches sharing it), then
  the window's newest `--max-commits` (default 3) base commits oldest to newest with the tip last; a
  fork point the window already draws is one of its own commits, so it is never repeated, and every
  fork point is therefore on the base line — no per-branch fork statement exists. Then, for each
  non-contained branch: `checkout <base>` → `branch <name>` → up to `--max-commits` `commit` nodes for
  the newest commits, preceded by one `commit id:"+N earlier"` when more are hidden → tip as
  `type: HIGHLIGHT`. Commits whose subject starts with `Revert "` render `type: REVERSE`.
  Contained branches render as a short branch joined back with `merge <name>` so they read as
  integrated rather than as open lines (`--hide-contained` drops them). Base tags at shown commits
  become `tag:"…"`. Names/labels are sanitized: characters outside `[A-Za-z0-9._/-]` → `-`,
  quotes stripped, ids truncated to 40 chars and de-duplicated. The layout claims behind the ordering
  are `mermaid@11.15.0` behaviour (HIGH — `apps/web/package.json:28` pins it, and
  `apps/web/tests/branch-topology-graph.heavy.test.ts:298` asserts it), and `behind` is git's left count
  of a symmetric difference (HIGH — `git rev-list` documents the `<`/`>` sides; exercised against real
  repositories by `apps/cli/tests/commands/builder/show-branches.test.ts`).
- **json**: `{ base, generatedAt, branches: BranchRow[], omitted, warnings[] }` — the same rows the
  table renders.
- **text**: aligned plain table, no mermaid.
- Unknown `--format` → exit 1 naming `markdown|json|text`. `--theme <name>` adds the init line.

### 3.2 Four flat `pr-<verb>` verbs

The eight ops collapse into four verbs that compose the existing service operations. Sequencing
lives in a new service entry `runPrVerb(verb, opts, sink, ctx)` in
`packages/app/src/services/pr-review/index.ts`, which reuses the existing `cmd*` functions and
`ScriptExit` handling. The CLI registers the verbs flat under `builder` with Commander-validated
flags plus `--json` and `--status-file`.

| Verb | Composes | Flags | Status verdict | Exit |
| --- | --- | --- | --- | --- |
| `pr-status` | status + collect (as `review`) | `--since`, `--head` | — (read-only) | 0, 2 |
| `pr-check` | preflight → hygiene | `--base`, `--scan-only` | `PASS\|WARN\|BLOCK\|FAIL` | 0, 2 |
| `pr-open` | push → ensure | `--base` | `FOUND\|CREATED\|FAIL` | 0, 2 |
| `pr-review` | request → (wait →) collect | `--force`, `--focus`, `--no-wait`, `--timeout`, `--interval` | `CLEAN\|FINDINGS\|PENDING\|FAIL` | 0, 2, 3 (timeout = `PENDING`) |

`pr-review` routes on the request result: `ALREADY_REVIEWED` collects without a new request,
`ALREADY_REQUESTED` and `--no-wait` return `PENDING`, `REQUESTED` waits and then collects. Because
the request record stays in-process, the workflow no longer needs the `prSince`/`prHead`
file-var plumbing.

The workflow becomes `check → precheck → open → review` with the same terminal states
(`done`, `pending`, `failed`) and the same `mode` values (`rerun` → `--force`, `submit` →
`--no-wait`). The `review` state also writes the findings and status artifacts that `fix` reads.
*(Superseded two days later: D66 task 1251 deleted the definition outright — see §5.)*

`spur builder pr <op>` stays for one release as a hidden alias that prints a deprecation line
naming the replacement verb, then runs the unchanged pass-through `main()`. A parity test compares
each verb against the old op sequence on the same stubbed runner (stdout, status file, exit code).

### 3.3 `/sp:dev-pr-review` redesign

| Mode | Route | Behavior |
| --- | --- | --- |
| `status` (default) | direct CLI | `spur builder show-branches --base <pr-base> --pr` scoped to current branch + `spur builder pr-status --json`; read-only |
| `review` | local stack | `spur builder pr-check --scan-only` (BLOCK stops) → `/sp:dev-review --scope <base...HEAD changed files>`; findings by severity with `file:line`; nothing posted |
| `review --codex` | flat verbs (was: the Codex review workflow, §5) | `pr-check` → `pr-open` → `pr-review`; `--force` re-requests, `--no-wait` returns `pending` |
| `fix` | skill model work | findings from the local verdict or `pr-status --json` `.review`; validate each, fix, verify, one focused commit, push; never force-push |

Retired modes print one notice and run their replacement: `full`→`review --codex`,
`submit`→`review --codex --no-wait`, `rerun`→`review --codex --force`, `collect`→`status`.
`rules` is dropped (AGENTS.md authoring belongs to `sp:cc-magents`); the notice says so.
`sp:pr-reviewing` is slimmed to these three modes and its `pipeline_steps` updated.

## 4. Contract and compatibility

- `show-branches` never writes refs, config or worktrees; `--pr` is the only network path.
- Each `pr-<verb>` produces the same stdout, `--status-file` verdict and exit code as the old op
  sequence it replaces, for the same runner responses. The `pr` alias is byte-identical to today
  apart from one stderr deprecation line.
- Exit codes for `show-branches`: `0` ok, `1` usage (bad format/ref), `2` git failure.
- Governance: §3 gains amendment rows for `show-branches` (task 1218: read-only branch report)
  and for `pr-status`, `pr-check`, `pr-open`, `pr-review` (task 1219), plus a deprecation note for
  `pr`. After the alias release, `builder`'s frozen set becomes `bump-ver`, `drop-tags`,
  `publish`, `show-branches`, `pr-status`, `pr-check`, `pr-open`, `pr-review`.
- Docs: `sp:spur-cli` `references/builder.md` verb map + `show-branches` and `pr-<verb>`
  sections; this satellite indexed in `docs/04_DESIGN.md`.

## 5. Tradeoffs and open questions

- **Condensed vs full graph.** Full history is literal to the example but unreadable at 5k
  commits; condensed keeps relationships. `--max-commits` is the knob.
- **`show-branches` vs `branches`.** Kept the operator's spelling; it is a verb-shaped name, which
  fits `spur <noun> <verb>` better than a bare noun.
- **No prune verb.** Listing contained branches is enough to act on; deletion remains a deliberate
  `git` action. Add `--prune-hint` (print the delete commands) only if asked.
- **Four flat verbs vs a `pr` sub-noun.** The operator chose flat `pr-<verb>` verbs to avoid a
  second command layer. The cost is a coarser workflow (one `review` state instead of
  request/wait/collect); resuming after a timeout means rerunning `pr-review`, which is safe
  because a request already made for the same head is collected, not repeated.
- **Local review default.** Shifts cost from Codex quota to the local session; Codex stays one
  flag away.
- **Superseded: the Codex review workflow is gone (D66 task 1251, 2026-10-18).** Shrinking the
  definition to `check → precheck → open → review` (§3.2) left a four-state graph whose every
  state ran one flat verb — a shell script in YAML, and the last caller keeping the definition
  alive against its own zero real completions (0866). `--codex` now calls `pr-check` → `pr-open` →
  `pr-review` → `pr-status` directly from `sp:pr-reviewing`, which is also where the mode→flag
  mapping the YAML held now lives. The verb contracts in §2 and §4 are unchanged — only the
  caller is. See [workflow-consolidation.md](workflow-consolidation.md).
