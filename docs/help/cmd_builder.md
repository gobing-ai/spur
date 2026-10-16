# spur builder

> Release plumbing for the package workspace: bump one package (or the `workspace:`-pinned
> release set), commit, tag, and optionally push. Promoted from the internal `spur-dev release`
> script (task 0617, ADR-051); `scripts/commands/release.ts` is now a thin forwarder to the same
> implementation. The noun is **frozen at these eight verbs** (`bump-ver`, `drop-tags`, `publish`,
> plus `show-branches` (2026-10-16 feature-L1 consent, task 1218) and the four flat PR verbs
> `pr-status`, `pr-check`, `pr-open`, `pr-review` (2026-10-16 feature-L1 consent, task 1219) — future
> promotions land only with their own justification
> (`docs/design/harness-surface-governance.md` §3). The old `pr <op>` layer stays registered as a
> hidden, deprecated alias for one release.

## Subcommands

| Subcommand | Description |
|---|---|
| `bump-ver <package-id> <version>` | Bump one package: manifest + in-source `binaryVersion`, commit, annotated tag |
| `bump-ver --all <version>` | Bump every `workspace:`-pinned package, plus aggregate publish tag |
| `drop-tags <package-id> <version>` | Delete one package's local release tag |
| `drop-tags --all <version>` | Delete all local per-package + aggregate release tags |
| `pr-check [flags]` | Submission gate: preflight then hygiene (`PASS` / `WARN` / `BLOCK` / `FAIL`) |
| `pr-open [flags]` | Publish the branch and reuse or create its PR (`FOUND` / `CREATED` / `FAIL`) |
| `pr-review [flags]` | Request the GitHub Codex review and collect it (`CLEAN` / `FINDINGS` / `PENDING` / `FAIL`) |
| `pr-status [flags]` | Read-only PR/CI/Codex status with the current-HEAD review as `review` |
| `publish <dir> [--otp code]` | Resolve workspace/catalog ranges, build, and `npm publish` a package (CI) |
| `show-branches [flags]` | Read-only branch topology report against a base (`markdown` / `json` / `text`) |

## spur builder bump-ver

```
spur builder bump-ver [options] <package-id|--all> <version>
```

| Argument | Description |
|---|---|
| `package-id` | Unscoped short name (`@gobing-ai/spur` → `spur`); omit with `--all` |
| `version` | Target semver (e.g. `0.2.0`) |

| Option | Description |
|---|---|
| `--check` | Only verify marketplace/plugin versions match the package version (no writes) |
| `--all` | Bump the whole released set instead of one package |
| `--push` | Also push the branch and the release tag to `origin` |
| `--json` | Output machine-readable JSON |

Behavior: rewrites the manifest version (and `workspace:` pins of consumers, plus the
`binaryVersion` literal in `src/config.ts` when present), stages `bun.lock` when non-empty,
commits `chore(release): bump <pkg> to <version>`, and creates an annotated tag
`<pkg>-v<version>`. `--all` adds per-package trace tags plus the aggregate
`@<scope>/<root>-v<version>` publish tag. Aborts with exit 1 on invalid semver, an unknown
package id, a dirty tree, a detached HEAD, or an existing local/origin tag.

With `--check [target]` the command is a read-only pre-publish drift guard (used by
`prepublishOnly`): it exits `1` when `.claude-plugin/marketplace.json` or a listed `plugin.json`
drifted from the package version; target defaults to the aggregate package. Incompatible write
flags (`--push`/`--all`) are rejected instead of silently ignored, and no manifest, tag, or
process mutation happens.

## spur builder publish

```
spur builder publish <dir> [--otp <code>]
```

| Argument | Description |
|---|---|
| `dir` | Package directory, relative to the workspace root |

| Option | Description |
|---|---|
| `--otp <code>` | npm one-time password (local publishes only) |

CI publish for npm Trusted Publishing (OIDC): rewrites `workspace:`/`catalog:` ranges in
`<dir>/package.json`, runs `bun run build:bundle`, then `npm publish --access public`; the
original manifest bytes are restored on every exit path (success, publish failure, or a thrown
build/runner error).

## spur builder drop-tags

```
spur builder drop-tags [options] <package-id|--all> <version>
```

| Option | Description |
|---|---|
| `--all` | Drop the whole released set's tags (per-package + aggregate) |
| `--remote` | Also delete the tag(s) on `origin` |
| `--json` | Output machine-readable JSON |

No-ops gracefully when a local or remote tag is already absent.

## spur builder pr-status

```
spur builder pr-status [options]
```

Read-only composition of the PR status and collect operations: repository, branch, PR number/url/base,
local changes, CI and Codex state, plus `review` — the current-HEAD Codex record when the branch has a
PR, else `null`. A status probe is not a gate, so it writes no verdict (`--status-file` is accepted
for symmetry).

| Option | Description |
|---|---|
| `--since <iso>` | Only count review output submitted at or after this time |
| `--head <sha>` | Pin the reviewed commit (default: the current local HEAD; a pin that no longer matches the PR head fails loud) |
| `--json` | Output machine-readable JSON |
| `--status-file <path>` | Accepted for symmetry; a read-only status writes no verdict |

Exit codes: `0` ok, `2` probe failure.

## spur builder pr-check

```
spur builder pr-check [options]
```

Submission gate: preflight (git/gh/repo checks, detached HEAD, dirty tree, base-branch refusal) then
the hygiene scan of `base...HEAD` for secrets, `.env` files, conflict markers (`BLOCK`) and debug
residue (`WARN`). A preflight failure stops before hygiene.

| Option | Description |
|---|---|
| `--base <branch>` | Base branch for the `base...HEAD` diff (default: the PR base, else the repo default) |
| `--scan-only` | Hygiene only; skip preflight (a dirty tree is expected, e.g. a local review) |
| `--json` | Output machine-readable JSON |
| `--status-file <path>` | Write the one-word verdict (`PASS` / `WARN` / `BLOCK` / `FAIL`) |

Exit codes: `0` ok, `2` BLOCK, preflight failure, or probe failure.

## spur builder pr-open

```
spur builder pr-open [options]
```

Publish the branch (normal push only — never force; sets upstream when missing), then reuse the
branch's PR or create one with `gh pr create --fill`. A rejected push stops before any PR work.

| Option | Description |
|---|---|
| `--base <branch>` | Base for a newly created PR (default: the repo default branch) |
| `--json` | Output machine-readable JSON |
| `--status-file <path>` | Write the one-word verdict (`FOUND` / `CREATED` / `FAIL`) |

Exit codes: `0` ok, `2` push rejected or ensure failed.

## spur builder pr-review

```
spur builder pr-review [options]
```

Post the `@codex review` request (per-HEAD dedupe unless `--force`), poll for the result, then collect
it. An already-reviewed HEAD is collected without a new request; an in-flight request or `--no-wait`
returns `PENDING` immediately.

| Option | Description |
|---|---|
| `--force` | Request a fresh review even when the current HEAD is already reviewed |
| `--focus <text>` | Extra review focus appended to the request |
| `--no-wait` | Post the request and return `PENDING` without polling |
| `--timeout <s>` | Wait budget in seconds (service default 600) |
| `--interval <s>` | Poll interval in seconds (service default 30) |
| `--json` | Output machine-readable JSON |
| `--status-file <path>` | Write the one-word verdict (`CLEAN` / `FINDINGS` / `PENDING` / `FAIL`) |

Exit codes: `0` ok, `1` usage, `2` hard failure, `3` wait timeout (verdict `PENDING` — pending, never
failure).

## Deprecated alias: `spur builder pr <op>`

The former pass-through layer stays registered for one release. It is hidden from
`spur builder --help`, prints one stderr deprecation line naming the replacement verb, and then runs
unchanged. `preflight`/`hygiene` map to `pr-check`, `push`/`ensure` to `pr-open`, `request`/`wait` to
`pr-review`, and `collect`/`status` to `pr-status`.

## spur builder show-branches

```
spur builder show-branches [options]
```

| Option | Description |
|---|---|
| `--format <format>` | Output format: `markdown` (default) / `json` / `text` |
| `--json` | Alias of `--format json`; prints the raw `BranchTopology` object |
| `--base <ref>` | Base ref to measure every branch against (default: the `origin/HEAD` target, else `main`) |
| `--local` | Only local branches |
| `--remote` | Only remote branches (mutually exclusive with `--local`) |
| `--pr` | Enrich rows with open pull-request state (one `gh pr list` call; degrades with a warning) |
| `--limit <n>` | Maximum branch rows, most recent last-commit first (default 30) |
| `--max-commits <n>` | Maximum commit nodes per branch line in the graph (default 3) |
| `--hide-contained` | Drop contained branches from the graph instead of drawing their join |
| `--theme <name>` | Mermaid theme name for the graph init directive |

Read-only report: per branch it prints the fork point, commits ahead/behind the base, the
contained flag (`ahead == 0`), the last commit, the worktree binding, and (with `--pr`) the open
pull-request number, state and review decision. `markdown` is the default and adds one condensed
mermaid `gitGraph`; `json` prints the `{ base, generatedAt, branches[], omitted, warnings[] }`
object; `text` prints the aligned table only.
Exit codes: `0` ok, `1` usage (bad `--format`/`--limit`/`--max-commits`, unknown base ref,
`--local` with `--remote`), `2` git failure (not a repository, `git` missing).
