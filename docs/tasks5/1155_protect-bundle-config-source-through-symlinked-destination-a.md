---
schema_version: 1
name: Protect bundle-config source through symlinked destination ancestors
status: done
template: feature-impl
created_at: 2026-10-10T07:27:54.618Z
updated_at: "2026-10-10T18:57:28.581Z"
feature_id: A

ac_altitude: task-local
ac_numbering: task-local
priority: P1
estimate_hours: 3
done_forced: "false"
done_reason: unforced close; PASS artifact at .spur/memory/evidence/1155-verdict.json
---

## 1155. Protect bundle-config source through symlinked destination ancestors

### Background

Review a71c reproduced source deletion in a temporary repository: a symlinked parent aliases the repo, but the lexical target guard accepts alias/config and rm deletes the real config directory before cp fails. Evidence: `scripts/commands/bundle-config.ts:28` and `scripts/commands/bundle-config.ts:32`; reproduction receipt: `.spur/run/a71c-config-symlink-repro.json`. The separate gate-lock diagnostic was already corrected during triage. These are task-local packaging regression scenarios, not feature ship criteria.

**Refine corrections (2026-10-10)**
- Current bundleConfig guard at scripts/commands/bundle-config.ts:28 is lexical, then rm at :32; callers are spur-dev.ts and CLI init-template tests. The a71c repro artifact exists.
- Existing bundle-web precedent rejects both directions of physical overlap, including destination inside source; original R1 named only source/ancestors. Freeze the same bidirectional rule to prevent copying config into its own subtree.
- Current target-guard tests invoke destructive candidates against the real checkout. Migrate those to a copied-script fixture before running any red safety test; never rely on the production guard protecting this repository during its own regression test.

### Requirements

- [x] R1. Resolve destination aliases before destructive cleanup and reject physical overlap in either direction: destination equal to source, containing source, or inside source.
- [x] R2. Preserve ordinary bundle output and schema injection; reject unsafe paths before any removal.
- [x] R3. Cover symlinked ancestor aliases, direct source/ancestor destinations, and safe missing destination directories with isolated fixtures.

### Acceptance Criteria

```gherkin
Scenario: AC1 — Aliased source cannot be deleted (req: R1, R2)
  Given an isolated repo whose parent alias is a symlink
  When bundleConfig targets alias/config
  Then it rejects before removal and source sentinel bytes remain unchanged

Scenario: AC2 — Safe output still bundles (req: R2, R3)
  Given a safe destination with missing final directories
  When bundleConfig runs
  Then assets are copied and workflow schema directives remain unique

Scenario: AC3 — Direct ancestors are protected (req: R1, R3)
  Given source and ancestor destination paths
  When bundleConfig runs for each
  Then every unsafe destination is rejected before writes
```

### Q&A

- Closed: reject both physical overlap directions, matching bundle-web; source-subtree destinations are unsafe too.
- Closed: keep private local path helpers and the existing bundleConfig API. No filesystem framework or dependency.
- Closed: all destructive safety tests bind SOURCE to an isolated copied-script fixture, including old direct-ancestor tests. No chmod or destructive probe against the live repository.

### Design

**Chosen algorithm / no new API.** Keep bundleConfig(target) and its return/error contract. In scripts/commands/bundle-config.ts use the existing bundle-web canonicalPath and contains algorithm locally (private functions, no shared abstraction): realpath(resolve(path)); on ENOENT only, canonicalize dirname and append basename; propagate EACCES/ENOTDIR/ELOOP and other errors. Canonicalize SOURCE and target before rm/cp; refuse contains(source,target) OR contains(target,source). contains must test empty relative path, '..' exactly and '..'+sep boundary, never startsWith('..') alone. Keep safe-path rm/cp/schema behavior, exclude filter, usage error and injected counter. No command/flag/schema/dependency changes. Do not claim race-free hostile concurrent filesystem replacement; concurrent mutation is outside this local packaging operation's contract.

**Isolated test layout.** Create mkdtemp repo with scripts/commands/bundle-config.ts copied byte-for-byte from the implementation and config/ containing a source sentinel, a workflow with existing quoted schema and one without schema, excluded fixtures and a normal asset. Dynamically import the copied script using its unique absolute file URL, so import.meta.url binds SOURCE to this temporary config. Migrate existing source/ancestor guard cases into that fixture before red tests. Alias fixture: symlink alias-parent→fixtureRepo, then target alias-parent/config or alias-parent/config/subdir; test direct root/config/config-child, symlink final source and aliased ancestor separately. Check source sentinel/schema bytes and tree inventory unchanged after rejection.

**Safe cases / edge tests.** Safe missing nested target under an aliased outside parent must bundle, exclude fixture junk and inject exactly one schema per relevant YAML. Safe sibling names beginning '..' must not be rejected by a loose '..' prefix check. Keep absolute/relative target behavior and ordinary init-template callers. A realpath non-ENOENT error must reject before cleanup; use a deterministic ENOTDIR ancestor fixture rather than permission bits. No symlink/destructive aliases against this checkout.

**Scope/verification.** Only bundle-config.ts/test.ts and task evidence; do not change bundle-web or export its private helper. Run the focused scripts test using the root preload explicitly if invoking outside the root, then CLI init-template suite inside apps/cli and the required gate. 1152 changes source workflow content but not this algorithm; no logical dependency. 1154 moves test tiers and does not own bundler safety.

### Plan

1. [ ] R3: build the copied-script fixture and migrate direct source/ancestor safety tests off the real repository.
2. [ ] R1/R3: add aliased ancestor, exact source, source-child, direct ancestor, final symlink and non-ENOENT path cases; demonstrate source deletion only inside the disposable fixture on the pre-fix implementation.
3. [ ] R1/R2: add local canonicalPath/contains and reject bidirectional physical overlap before rm; retain other errors.
4. [ ] R2/R3: check safe missing/aliased output, '..'-prefixed safe siblings, exclusion filter and schema uniqueness with unchanged source bytes.
5. [ ] Run bun test --preload ./tests/setup.ts scripts/commands/bundle-config.test.ts from root, then apps/cli init-templates suite in its workspace and task gate. Review/verify/record and commit.

### Solution

Made `bundleConfig`'s destructive clean-up refuse **physical** overlap in either direction: it now resolves source and destination through symlinks (walking up only on a genuine `ENOENT`) and rejects `contains(source, target) || contains(target, source)` before the first `rm`.

Change map (one anchor per row):

| file:line | What changed |
| --- | --- |
| `scripts/commands/bundle-config.ts:27` | `canonicalPath`: `realpath(resolve(path))`, and on `ENOENT` only, canonicalize the dirname and re-append the basename. `EACCES`/`ENOTDIR`/`ELOOP` propagate, so a resolution failure never degrades to a lexical answer. Same algorithm as `bundle-web`'s private helper: kept local, no shared abstraction and no new API. |
| `scripts/commands/bundle-config.ts:38` | `contains`: empty relative path, `..` exactly, or a `..` + separator prefix — deliberately not a bare `startsWith('..')`, so a safe sibling named `..safe-out` is not rejected. |
| `scripts/commands/bundle-config.ts:49` | The guard itself: both sides are canonicalized before `rm`, and either direction of overlap refuses with the existing `refusing to replace` error. The previous lexical `relative(resolve(target), SOURCE)` check missed a symlinked parent that aliased the repo — the target was wiped and the real `config/` deleted before `cp` failed (`.spur/run/a71c-config-symlink-repro.json`). |
| `scripts/commands/bundle-config.ts:54` | Unchanged error contract: same message shape, no new flags, exit behaviour and callers (`scripts/spur-dev.ts`, the CLI init-template tests) untouched. |
| `scripts/commands/bundle-config.test.ts:64` | The destructive safety cases moved off the live checkout: the fake target `repoRoot`/`config`/`/` list is replaced by an isolated `mkdtemp` repo whose `scripts/commands/bundle-config.ts` is copied byte-for-byte and imported by absolute file URL, so the module's `SOURCE` binds to the fixture's `config/` (1155 R3). Every rejection asserts the sentinel bytes and the source tree inventory are unchanged. |
| `scripts/commands/bundle-config.test.ts:136` | The a71c reproduction: a symlinked parent aliasing the repo, refusing `alias/config`, `alias/config/subdir` and `alias` itself. |
| `scripts/commands/bundle-config.test.ts:154` | A non-`ENOENT` realpath failure (a regular file as the ancestor, deterministic via `ENOTDIR`) rejects before clean-up. |
| `scripts/commands/bundle-config.test.ts:162` | Safe-path regressions: a missing nested destination bundles with the exclusion filter applied and exactly one `$schema` per YAML, a destination under an aliased *outside* parent bundles, and a `..`-prefixed safe sibling is not rejected. |

Rationale: the guard asked a *lexical* question ("is `target` textually inside the repo?") of a *physical* filesystem. Two aliases of the same directory gave opposite answers, so the safety check passed while the `rm` deleted the source. Canonicalizing both sides before any destructive step is the smallest change that makes the check answer the question it was written to ask; rejecting both directions (matching `bundle-web`) closes the "destination inside source" half that the original guard's own wording implied. Concurrency is explicitly out of scope: a racing filesystem replacement between resolve and `rm` is not covered, and the error message says so through the unchanged contract rather than a new one.

### Testing

**Pipeline verify results**

- Verdict: PASS (from verdict artifact)
- Confidence: HIGH

| Requirement | Status | Evidence |
|-------------|--------|----------|
| R1 | MET | `scripts/commands/bundle-config.ts:51-54` canonicalizes source and destination and refuses physical overlap in both directions before `rm`; `canonicalPath` (`:27`) walks up only on `ENOENT`, so a non-ENOENT resolution error propagates; `contains` (`:38`) uses the empty-relative-path/`..`-exact/`..`-separator test, never a loose `startsWith('..')`. Tests: `scripts/commands/bundle-config.test.ts:136` (symlinked parent aliasing the repo, refusing `alias/config`, `alias/config/subdir` and `alias`), plus `:154` (non-ENOENT), and the direct source/ancestor/source-child/aliased-final-component cases |
| R2 | MET | The bundle body is unchanged (`scripts/commands/bundle-config.ts:56`); `apps/cli/tests/init-templates.test.ts` source-vs-bundle parity is byte-for-byte green (24 pass / 0 fail) and the two pre-existing `$schema` tests still pass, so ordinary output and schema injection are preserved; unsafe targets are refused before any removal (every rejection asserts the sentinel bytes and source inventory) |
| R3 | MET | The destructive cases moved off the live checkout onto an isolated `mkdtemp` repo whose `scripts/commands/bundle-config.ts` is copied byte-for-byte and imported by absolute file URL, so `SOURCE` binds to the fixture's `config/`; safe-path cases cover a missing nested destination, an aliased outside parent and a `..`-prefixed sibling name |

| Acceptance Criteria | Status | Evidence Type | Evidence |
|---------------------|--------|---------------|----------|
| AC1 — Aliased source cannot be deleted (req: R1, R2) | MET | test | `scripts/commands/bundle-config.test.ts:136` — `bun test --preload ./tests/setup.ts scripts/commands/bundle-config.test.ts` 11 pass / 0 fail; the symlinked-parent case rejects all three aliased targets and asserts `SENTINEL.txt` is byte-identical afterwards |
| AC2 — Safe output still bundles (req: R2, R3) | MET | test | `scripts/commands/bundle-config.test.ts:162` asserts assets copied, `fixtures/` excluded and exactly one `$schema` directive per bundled YAML; `(cd apps/cli && bun test tests/init-templates.test.ts)` 24 pass / 0 fail including the source-vs-bundle byte-for-byte parity case |
| AC3 — Direct ancestors are protected (req: R1, R3) | MET | test | `scripts/commands/bundle-config.test.ts:64` block — direct source destination, repo-root ancestor, source-child destination (including missing final directories) and the symlinked-final-component case, each rejected with the unchanged `refusing to replace` error and the source inventory re-verified |
- Coverage: N/A (verdict-based; verify pipeline does not measure code coverage)

### Review

#### Review Report — 1155
**Scope:** 1155 diff (2 files: `scripts/commands/bundle-config.ts`, `scripts/commands/bundle-config.test.ts`, plus the task file)
**Dimensions:** functional, security, efficiency, correctness, usability, architecture
**Verdict:** PASS

##### Findings (ranked)

| # | Priority | Dimension | Finding | Location | Disposition |
|---|----------|-----------|---------|----------|-------------|
| 1 | P4 (advisory) | correctness | The guard canonicalizes both sides and only then removes, so a filesystem mutation racing between resolution and `rm` is outside the contract — the task records this explicitly rather than claiming TOCTOU safety. | `scripts/commands/bundle-config.ts:51` | ACCEPTED |
| 2 | P4 (advisory) | architecture | `canonicalPath`/`contains` now exist in both `bundle-web` and `bundle-config`. The Q&A closed this deliberately (private local helpers, no shared abstraction, and `bundle-web`'s helper is not exported); a future shared `scripts/lib` path module would collapse the pair. | `scripts/commands/bundle-config.ts:27` | ACCEPTED |

##### Functional Traceability

| Req | Status | Evidence |
|-----|--------|----------|
| R1 | MET | `scripts/commands/bundle-config.ts:51` canonicalizes source and destination (only `ENOENT` is walked up; `EACCES`/`ENOTDIR`/`ELOOP` propagate) and `:53` refuses `contains(source,target) \|\| contains(target,source)` before the first `rm`; `contains` (`:38`) tests empty-relative-path, `..` exactly and the `..`+separator boundary. Pinned at `scripts/commands/bundle-config.test.ts:136` (aliased ancestor — the a71c reproduction), plus direct source, ancestor, source-child, aliased-final-component and non-`ENOENT` cases |
| R2 | MET | Unchanged bundle output, `$schema` injection and exclusion filter (asserted at `scripts/commands/bundle-config.test.ts:162`); `apps/cli/tests/init-templates.test.ts` source-vs-bundle parity 24 pass / 0 fail; the existing duplicate/`at-least-one` `$schema` tests still pass unchanged |
| R3 | MET | Every destructive case now runs against the isolated copied-script fixture (`scripts/commands/bundle-config.test.ts:64`): the copy is imported by absolute file URL so `SOURCE` binds to the fixture, each rejection asserts sentinel bytes and the full source inventory, and the fixture repo sits under a `tests/…/fixtures/…` path so Bun does not instrument the copy as a measured source file |

##### Acceptance Criteria Verification

AC1 (aliased source survives), AC2 (safe output still bundles) and AC3 (direct ancestors protected) are all
exercised in the new fixture-based cases, with the source sentinel read back after every rejection.

##### Residual Risk

Nothing security-relevant is left open beyond the documented non-goal: a concurrent filesystem mutation
between `realpath` and `rm` is not detected, which matches this local packaging operation's contract and
`bundle-web`'s existing precedent. The only behavioural widening is that a destination *inside* the
source is now refused — previously accepted, and it would have copied the config into its own subtree.

**Next:** proceed to verify.

### References

- `scripts/commands/bundle-config.ts:28` — lexical-only containment.
- `scripts/commands/bundle-config.ts:32` — destructive cleanup.
- `scripts/commands/bundle-web.ts:103` — existing physical path precedent.

#### Readiness review (2026-10-10)

Outcome: refined; depth: ready; status: todo → todo; corrections: 3.

| id | pass | evidence |
| --- | --- | --- |
| requirements | true | Current-tree audit; observable R-items and explicit scope below. |
| design | true | Chosen seams, fixtures, edge behavior and non-goals frozen in Design. |
| plan | true | Ordered implementation and test plan linked to R-items. |
| ac | true | Task-local scenarios and req links; task check --as todo PASS, no errors. |
| decisions | true | Closed decisions in Q&A; no unresolved implementation decision. |
| dependencies | true | Prerequisite and sibling ownership recorded in Design; declared edges where needed. |
| premises | true | Source/callers/tests inspected; verified facts and corrected hypotheses recorded in Background. |

Planning-only receipt: no implementation pipeline or behavior-change verification PASS is claimed. Recheck source and ownership before implementation; batch began on main at 13da1554f with one worktree, no WIP tasks and a clean tree. Runtime Bun 1.3.14; no dependency install needed for refinement.

### History

- 2026-10-10T07:28:44.925Z backlog → todo (system)
- 2026-10-10T18:30:16.344Z todo → wip (system)
- 2026-10-10T18:57:26.134Z wip → testing (system)
- 2026-10-10T18:57:28.577Z testing → done (system)

