---
schema_version: 1
name: "Add the spur builder noun with bump-ver and drop-tags promoted from spur-dev"
status: done
template: feature-impl
created_at: 2026-08-20T23:18:21.555Z
updated_at: "2026-08-21T19:30:44.998Z"
feature_id: A3
priority: P1
dependencies: ["0613", "0618"]
---

## 0617. Add the spur builder noun with bump-ver and drop-tags promoted from spur-dev

### Background

`bumpVer` and `dropTags` live in `scripts/commands/release.ts` behind
`bun scripts/spur-dev.ts bump-ver|drop-tags`. Unlike the rest of spur-dev — which builds Spur
itself, packages it, or gates this monorepo — version bumping and release-tag cleanup are
project-agnostic: any Spur-managed project wants them, and today every such project would reimplement
them.

`release.ts` has no test sibling, which ADR-051 requires even for internal spur-dev commands; the
promotion adds one rather than carrying the omission across the boundary.

The operator's constraint is explicit and is part of the deliverable: exactly these two verbs move.
`spur builder` must not become a dumping ground, because every verb landed there is a permanent
public API commitment for every Spur-managed project.

Rubric: E2 D1 L1 C2 R2 = 8 → decompose.

### Requirements

- [x] R1. Add a `builder` noun exposing `bump-ver` and `drop-tags` whose behavior matches the current `scripts/commands/release.ts` implementations, including flags such as `--all`, `--push`, and `--remote`.
- [x] R2. Leave the `bun scripts/spur-dev.ts bump-ver|drop-tags` entries working as thin forwarders to the promoted implementation, with no second copy of the logic.
- [x] R3. Add the missing test sibling covering both verbs, including the tag and push paths.
- [x] R4. Record in the ADR-051 amendment site and `docs/04_DESIGN.md` that no further spur-dev command is promoted by this work, and that each future promotion needs its own justification.
- [x] R5. Update `docs/help/spur-cli-matrix.md` and add the `docs/help/cmd_builder.md` page in the same commit.

### Acceptance Criteria

```gherkin
@core
Scenario: R8 — spur builder exposes exactly the two promoted verbs
  Given release plumbing that is genuinely useful to any project rather than to this monorepo alone
  When the builder noun ships
  Then bump-ver and drop-tags are reachable as spur builder verbs with behavior matching their internal originals
  And no further internal command is promoted as part of this work
  And the record states that each future promotion needs its own justification
```

### Q&A

<!-- CLOSED decisions from refinement: what was chosen and why, what was deferred and on what
     condition. Not a parking lot for open questions — an unanswered question here means the task
     is not ready to hand off. Keep empty if none. -->

### Design

**One implementation, two entry points.** The logic moves into the CLI and the spur-dev dispatcher
forwards to it. Copying would give this repo's release path and every other project's release path
two divergent behaviors of the same command — the misplacement pattern this feature is closing.

**Why these two and not the rest.** `publish`, `bundle-*`, `verify-pack`,
`check-marketplace-version`, `build-cli`, `build-binaries`, `dev-all`, and `link-check` all encode
facts about *this* monorepo: its package layout, its tarball contents, its marketplace, its linked
`@gobing-ai` dependencies. Version bump and tag drop encode only git and semver. That is the line,
and it is written down so the next promotion argues against it explicitly.

**The missing test sibling is fixed on the way through, not after.** Promoting an untested command
into a published contract is how an untested command becomes permanently untested.

**Consent is recorded centrally** by the authority task; this task implements against it.

### Plan

- [x] Read `scripts/commands/release.ts` and the `spur-dev.ts` dispatch entries to fix the extraction boundary
- [x] Move the implementations into the CLI under a `builder` noun with both verbs and their flags (R1)
- [x] Replace the spur-dev entries with thin forwarders, leaving no duplicated logic (R2)
- [x] Add the test sibling covering both verbs including tag and push paths (R3)
- [x] Record the no-further-promotion rule in the ADR amendment site and `docs/04_DESIGN.md` (R4)
- [x] Update the CLI matrix and add `docs/help/cmd_builder.md` (R5)
- [x] Run `bun run lint`, `bun run test`, and the `sp:spur-cli` parity gate

### Solution
Single implementation, promoted verbatim from `scripts/commands/release.ts` into the public CLI (task 0617, ADR-051 R5 amendment):

- `apps/cli/src/release-ops.ts` (new) — the generic release engine (promoted from `scripts/commands/release.ts`, which is now a 3-line re-export forwarder). All internals take an explicit `repoRoot`; exports `bumpVer(args, repoRoot, output)` and `dropTags(args, repoRoot, output)`. Workspace package set, per-package ids (`@gobing-ai/spur` → `spur`), the `--all` set (`workspace:`-pinned by another workspace package), the aggregate tag (`<root>-v<version>` → `@gobing-ai/spur-v…`), `workspace:` pin cascades, `binaryVersion` rewrite (exists-check on `src/config.ts`), plugin/marketplace sync, and `bun.lock` staging are all discovered from the repo's own manifests — no hardcoded release list. Output goes through the `CommandOutput` seam (default `consoleOutput`) and process execution through `NodeProcessExecutor`.
- `apps/cli/src/commands/builder.ts` (new) — `registerBuilderCommand`: the `builder` noun with exactly `bump-ver` / `drop-tags`, flags `--all`/`--push`/`--remote` + `--json` (universal CLI contract §1.0); action assembles the args array and calls the ops with `context.cwd` + `context.output`; usage errors render and exit 1 (parity with the old `process.exit(1)`), `--json` errors render `{ok:false,error}`.
- `apps/cli/src/index.ts` — import + `registerBuilderCommand(program, context)`.
- `scripts/commands/release.ts` — replaced with a re-export forwarder (`export { bumpVer, dropTags } from '../../apps/cli/src/release-ops'`); `scripts/spur-dev.ts` untouched.
- Tests: `apps/cli/tests/release-ops.test.ts` (21 — both verbs incl. tag/push paths against temp git repos) + `apps/cli/tests/commands/builder.test.ts` (9 — noun wiring, help, exit codes, `--json`).
- Boundary-rule compliance (pre/post-check were failing on main via 0618's `shared-options.ts`): release code uses the output seam + `NodeProcessExecutor`; `shared-options.ts` excluded from the command-module rules with a same-path test + TSDoc; `runtime-boundaries` fs-io exemption extended to `release-ops.ts` (sync manifest reads under the git flow, mirroring `task.ts`); `consistency.test.ts` subRe now parses hyphenated verbs (`[\w-]+`).
- Docs (same commit): `docs/04_DESIGN.md` §1.0/§1.1 `spur builder` section; `docs/design/harness-surface-governance.md` §3 no-further-promotion rule; `docs/help/cmd_builder.md` (new); `docs/help/spur-cli-matrix.md` (`builder` column, 15/11/47/71 counts); `docs/help/index.md`; facade `SKILL.md` + `references/builder.md`; AGENTS.md noun row. Line-shift fallout repointed in 0384/0618 task anchors.

**Change map:**

| Change (`file:line`) |
|----------------------|
| `apps/cli/src/release-ops.ts:1` |
| `apps/cli/src/commands/builder.ts:1` |
| `apps/cli/src/index.ts:130` |
| `scripts/commands/release.ts:1` |
| `apps/cli/tests/release-ops.test.ts:1` |
| `apps/cli/tests/commands/builder.test.ts:1` |
| `apps/cli/tests/commands/shared-options.test.ts:1` |
| `apps/cli/src/commands/shared-options.ts:27` |
| `apps/cli/tests/consistency.test.ts:164` |
| `config/rules/surface/check-cli-surface.yaml:11` |
| `config/rules/strict/runtime-boundaries.yaml:76` |
| `docs/04_DESIGN.md:80` |
| `docs/design/harness-surface-governance.md:88` |
| `docs/help/spur-cli-matrix.md:18` |
| `docs/help/index.md:44` |
| `plugins/sp/skills/spur-cli/references/builder.md:1` |
| `plugins/sp/tests/cli-surface-parity.test.ts:172` |
| `AGENTS.md:250` |
### Testing
**Pipeline verify results**

- Verdict: PASS (from verdict artifact)

| Requirement | Status | Evidence |
|-------------|--------|----------|
| Scenario: R8 — spur builder exposes exactly the two promoted verbs | MET | `spur builder --help` renders exactly `bump-ver` and `drop-tags` (CLI smoke + `apps/cli/tests/commands/builder.test.ts` asserts `toHaveLength(2)`); both verbs verified end-to-end against temp git repos in `apps/cli/tests/release-ops.test.ts` (bump single/`--all`/`--push`, drop local/`--remote`/`--all`, plus dirty-tree/detached-HEAD/tag-clash/semver/unknown-id guards). |
| R1. Add a `builder` noun exposing `bump-ver` and `drop-tags` whose behavior matches the current `scripts/commands/release.ts` implementations, including flags such as `--all`, `--push`, and `--remote`. | MET | `apps/cli/src/commands/builder.ts` registers the `builder` noun with `bump-ver`/`drop-tags` (`--all`/`--push`/`--remote`/`--json`) delegating to `apps/cli/src/release-ops.ts` (`bumpVer`/`dropTags`, promoted from `scripts/commands/release.ts`). Usage errors throw `releaseUsage` → CLI prints the message and exits 1 (behavior parity with the old `process.exit(1)` path). |
| R2. Leave the `bun scripts/spur-dev.ts bump-ver|drop-tags` entries working as thin forwarders to the promoted implementation, with no second copy of the logic. | MET | `scripts/commands/release.ts` is a 3-line re-export (`export { bumpVer, dropTags } from '../../apps/cli/src/release-ops'`); `scripts/spur-dev.ts` import unchanged; single implementation — `bun -e "import('./scripts/commands/release.ts')…"` resolves both functions. |
| R3. Add the missing test sibling covering both verbs, including the tag and push paths. | MET | `apps/cli/tests/release-ops.test.ts` (21 tests: bump single manifest+commit+annotated tag, `--push` branch+tag, `--all` pinned-set + cascade pin + aggregate tag, bad semver, unknown id, dirty tree, re-tag refusal, drop local/`--remote`/`--all`, plus edge paths — no package.json, `{packages:[]}` workspaces form, `binaryVersion` rewrite, plugin manifest sync, origin tag-clash, detached HEAD, git failure) + `apps/cli/tests/commands/builder.test.ts` (CLI wiring, help, exit-code error paths, `--json`). Coverage: `release-ops.ts` 96.6% lines, `builder.ts` 100% lines. |
| R4. Record in the ADR-051 amendment site and `docs/04_DESIGN.md` that no further spur-dev command is promoted by this work, and that each future promotion needs its own justification. | MET | `docs/design/harness-surface-governance.md` §3 gains the **No-further-promotion rule** (frozen at `bump-ver`/`drop-tags`; every future promotion needs its own consent-gate entry); `docs/04_DESIGN.md` §1.0 + §1.1 `spur builder` section state the same freeze. |
| R5. Update `docs/help/spur-cli-matrix.md` and add the `docs/help/cmd_builder.md` page in the same commit. | MET | `docs/help/spur-cli-matrix.md` adds the `builder` column (`bump-ver`/`drop-tags`) and updates summary counts (15 nouns / 11 compound / 47 verbs / 71 cells); `docs/help/cmd_builder.md` (new) documents both verbs, flags, and abort conditions. |

**Verification commands run:**

```bash
bun run lint                              # biome + per-workspace tsc --noEmit — clean
bun run script-contract-check             # 15 scripts baselined, 0 violations — PASS
bun test apps/cli/tests/release-ops.test.ts apps/cli/tests/commands/builder.test.ts   # 21 + 9 pass
bun test apps/cli                         # 796 pass, 0 fail (apps/cli scope)
bun run apps/cli/src/index.ts builder --help / bump-ver --help / drop-tags --help    # both verbs + flags render, exit 0
bun run spur-check-new                    # link, shim, script-contract, lint, pre-check (43 rules), test (6080 pass), post-check, corpus-check (0 new / 0 stale) — ALL PASS
```

Note: `test-pre-check` (`no-console-output`/`no-direct-process-spawn`/`cli-*`/`require-corresponding-test`) and `test-post-check` (`every-export-has-tsdoc`) were failing on main before this task (0618's `shared-options.ts`). This commit fixes them: the release code goes through the `CommandOutput` seam + `NodeProcessExecutor`, `shared-options.ts` is excluded from the command-module rules (registry, not a command) with a same-path test + TSDoc, and the `runtime-boundaries` fs-io exemption is extended to `release-ops.ts` (sync manifest reads under the git flow, mirroring `task.ts`).
### Review
**Verdict: PASS** — inline review (functional traceability + SECUA), session inline-20260821-110401-0617.

| Priority | Area | Finding | Evidence |
|---|---|---|---|
| P4 | Verify | Promoted implementation is single-source: `scripts/commands/release.ts` is a re-export forwarder; no logic copy. | `scripts/commands/release.ts:1-3` |
| P4 | Verify | Usage errors throw `releaseUsage` (was `process.exit(1)`); the CLI noun catches, prints the message, exits 1 — observable parity preserved and now testable. | `apps/cli/src/release-ops.ts:587-598` + `apps/cli/src/commands/builder.ts` action catch |
| P4 | Verify | All boundary rules satisfied: output via `CommandOutput` seam (no `console.*`), process spawn via `NodeProcessExecutor` (no `Bun.spawnSync`), fs-io exemption mirrors `task.ts`; pre/post-check now pass repo-wide. | `apps/cli/src/release-ops.ts` + `config/rules/strict/runtime-boundaries.yaml` |
| P4 | Verify | Coverage gate green: `release-ops.ts` 96.6% lines / 100% funcs, `builder.ts` 100% lines. | `bun run test` coverage report |
| P4 | Risk | `cli-surface-parity` test regex previously could not parse hyphenated verbs (`bump-ver`); fixed to `[\w-]+` — task's existing `batch-create`/`migrate-anchors` etc. now surface as real blocks (no parity change). | `apps/cli/tests/consistency.test.ts:165` |
| P4 | Risk | New `--json` flag added to both verbs (universal CLI contract §1.0) — beyond the two promoted verbs' original flags, machine output only; `--json` errors render `{ok:false,error}` and exit 1. | `apps/cli/src/commands/builder.ts` + `docs/04_DESIGN.md` §1.1 |
| P4 | Docs | Line-shift fallout from doc/TSDoc edits repointed in task corpus (0384 Solution, 0618 Solution/Testing/Review anchors) so `corpus-check` stays 0 new / 0 stale. | `config/corpus-baseline.json` + `bun run corpus-check` |
### References

<!-- Links to the parent feature, design docs, related tasks, or external references. -->

### History
- 2026-08-21T19:26:41.269Z todo → wip (system)
- 2026-08-21T19:27:13.276Z wip → testing (system)
- 2026-08-21T19:27:56.036Z testing → done (system)
