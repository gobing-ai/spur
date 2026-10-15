# spur builder

> Release plumbing for the package workspace: bump one package (or the `workspace:`-pinned
> release set), commit, tag, and optionally push. Promoted from the internal `spur-dev release`
> script (task 0617, ADR-051); `scripts/commands/release.ts` is now a thin forwarder to the same
> implementation. The noun is **frozen at these four verbs** (`bump-ver`, `drop-tags`, `pr`, and
> `publish`, added by the
> 2026-10-15 script-absorption consent entry) — future promotions land only with their own
> justification (`docs/design/harness-surface-governance.md` §3).

## Subcommands

| Subcommand | Description |
|---|---|
| `bump-ver <package-id> <version>` | Bump one package: manifest + in-source `binaryVersion`, commit, annotated tag |
| `bump-ver --all <version>` | Bump every `workspace:`-pinned package, plus aggregate publish tag |
| `drop-tags <package-id> <version>` | Delete one package's local release tag |
| `drop-tags --all <version>` | Delete all local per-package + aggregate release tags |
| `pr <op> [flags]` | Deterministic PR-review spine ops for `/sp:dev-pr-review` (`preflight`, `push`, `ensure`, `hygiene`, `request`, `wait`, `collect`, `status`) |
| `publish <dir> [--otp code]` | Resolve workspace/catalog ranges, build, and `npm publish` a package (CI) |

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

## spur builder pr

```
spur builder pr <op> [flags]
```

The deterministic spine behind `/sp:dev-pr-review` (`sp:pr-reviewing`, driven by
the `pr-review` workflow). Absorbed from the retired `plugins/sp/scripts/pr-reviewing.ts`
(script-absorption PR-7); output and exit codes are byte-identical to the script.

| Op | Description |
|---|---|
| `preflight` | git/gh/repo checks; FAILs on detached HEAD or a dirty tree |
| `push` | Push the branch (never force); sets upstream when missing |
| `ensure [--base b]` | Reuse the branch's PR or create one with `gh pr create --fill` (`ensure-pr` is an alias) |
| `hygiene [--base b]` | Scan `base...HEAD` for secrets/.env/conflict markers (BLOCK) and debug residue (WARN) |
| `request [--force] [--focus text]` | Post `@codex review` (dedupes a reviewed/in-flight HEAD unless `--force`) |
| `wait [--since iso] [--head sha] [--timeout 600] [--interval 30]` | Poll for Codex output; exit 3 on timeout |
| `collect [--since iso] [--head sha]` | Fetch the current-HEAD Codex result (FINDINGS, CLEAN, or PENDING) |
| `status [--since iso] [--head sha]` | Composite repo/PR/CI/Codex status (read-only) |

Global flags: `--json` (single JSON object), `--status-file <path>` (one-word verdict).
Exit codes: `0` ok, `1` usage, `2` hard failure, `3` wait timeout.
