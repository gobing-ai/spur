---
schema_version: 1
name: Verify standard-script twins by content instead of mtime
status: todo
template: feature-impl
created_at: 2026-09-26T06:13:44.341Z
updated_at: "2026-09-27T16:45:04.915Z"
feature_id: A32

priority: P1
estimate_hours: 3
---

## 0970. Verify standard-script twins by content instead of mtime

### Background

`script-contract-check` Rule 1 (`plugins/sp/scripts/script-contract-check.ts:239-262`) flags a standard script's `.mjs` twin as `stale_twin` only when the twin's **mtime** is more than 1s older than its `.ts` source (`STALE_TWIN_TOLERANCE_MS`, added in task 0606 for fresh worktrees). Git does not store mtimes: every clone, checkout or `git worktree add` stamps files at checkout time. So a twin that was committed without a rebuild (the `.ts` was edited and `build:scripts` / `superskill script convert` was skipped) **passes** the gate in CI and in every fresh worktree. The only case the rule exists to catch is invisible exactly where it matters. Only a dirty local tree where the developer edited the `.ts` after the last build is caught.

Checked 2026-09-25 at HEAD 3571e710a:
- `superskill script convert` is byte-deterministic. The repo-pinned devDependency (`node_modules/.bin/superskill` 0.3.17) and the global 0.3.32 both reproduce `plugins/sp/scripts/quality-gate.mjs` exactly.
- A fresh convert of all 17 `contract: standard` entries in `config/plugin-scripts.json` is byte-identical to the committed twins, so switching to a content check starts green.
- Each convert takes about 0.2s, so about 3.5s for all 17.
- `convert` resolves `plugins/<plugin>/scripts/<rel>` relative to the process cwd; it fails with "Source not found" elsewhere.

Origin: `/sp:dev-review plugins` minor finding (correctness).

### Requirements

- [ ] R1. Rule 1's staleness test compares content. For each `contract: standard` entry whose `.ts` and twin both exist, the check regenerates the twin into a temp dir with `superskill script convert sp <rel> --out <tmp>/<twin>` and reports `stale_twin` when the bytes differ from the committed twin. File mtimes are no longer consulted, and `STALE_TWIN_TOLERANCE_MS` and its comment are deleted.
- [ ] R2. The converter is injectable. `validateContract(manifest, scriptsDir, pluginDir, opts?: { convertTwin?: (rel: string, outPath: string) => boolean })`, where the function returns false when conversion could not run. `run()` supplies the real spawn-based converter; unit tests supply a deterministic fake.
- [ ] R3. When the converter cannot run (spawn error / ENOENT, non-zero exit, or no output file), the check reports one `converter_unavailable` violation naming the command and its stderr, then stops content-checking the remaining entries. It never silently passes.
- [ ] R4. The live-repo gate (`bun run script-contract-check`) passes at HEAD and fails when any committed standard twin is edited by hand, regardless of mtimes.

### Acceptance Criteria

Graduates all three of feature A32's scenarios (exact titles below); the numbered rows are the verify lens.

- [ ] AC1 — R1 — Stale twin with a newer mtime is caught (req: R1, R2)
- [ ] AC2 — R2 — Fresh twin with an older mtime passes (req: R1, R2)
- [ ] AC3 — R3 — Missing converter fails loudly (req: R3)

**Verify lens**

- **AC1**: in `plugins/sp/tests/script-contract-check.test.ts`, replace the mtime test at `:118` with the following. Write `tool.ts` = `A` and `tool.mjs` = `fake(B)`, then set the twin mtime 100s **newer** than the source. Call `validateContract` with a fake `convertTwin` that writes `fake(<contents of scriptsDir/rel>)` (e.g. `// twin\n` + source) to `outPath` and returns true. Assert that one `stale_twin` violation names `tool.ts`.
- **AC2**: replace the sub-second tolerance test at `:140`. The twin is `fake(source)` and its mtime is 100s **older** than the source. Same fake converter. Assert there is no `stale_twin`.
- **AC3**: with a fake `convertTwin` that returns false, two standard entries produce exactly one `converter_unavailable` violation and no `stale_twin`. A second case: the real default converter with a PATH that lacks `superskill` (spawn with `env: { ...process.env, PATH: '' }` through a test seam, or call the exported default converter factory with an explicit bogus binary name) also yields `converter_unavailable`.
- **R4 lens**: the existing live-repo test (`'CLI runner exits 0 for live repo manifest and scripts'`, `:284`) stays green, with its timeout raised if needed (about 3.5s of converts). Manual proof recorded in Solution:
  1. Append `// drift` to `plugins/sp/scripts/quality-gate.mjs`.
  2. `touch` it so it is newer.
  3. `bun run script-contract-check` must exit 1 with `stale_twin`.
  4. `git checkout` the file and re-run; it must exit 0.
- All other existing tests in the file (R1 missing twin, R2, R3, R4, R5, "Clean setup…", `run()`) pass. Those that build standard twins pass a fake converter whose output matches their fixture twin. `bun run spur-check-feature` is green.

### Q&A

<!-- CLOSED decisions from refinement: what was chosen and why, what was deferred and on what
     condition. Not a parking lot for open questions — an unanswered question here means the task
     is not ready to hand off. Keep empty if none. -->

#### Q&A entry — 2026-09-26T06:18:39.992Z

- **Q:** Regenerate and compare, or embed a source hash in the twin header? **A:** Regenerate and compare. The twin is produced by the external `superskill script convert` (a separate package). Adding a hash header means changing Superskill's output format and a release. It would also prove only that the twin was built from this source, not that it was built by the pinned converter. Converts are deterministic and cheap (about 3.5s for 17), so the direct comparison is the smaller, stronger check.
- **Q:** Which `superskill` binary? **A:** Spawn the bare name `superskill` with cwd = repo root (`resolve(pluginDir, '..', '..')`), which is required because convert resolves `plugins/sp/scripts/<rel>` against cwd. `bun run` prepends `node_modules/.bin` to PATH, so both `bun run build:scripts` (package.json:61) and `bun run script-contract-check` resolve the same pinned devDependency (`@gobing-ai/superskill` 0.3.17, package.json:118). No version pin logic in the checker.
- **Q:** Keep mtime as a fast pre-filter? **A:** No. It cannot prove freshness in either direction, and the content check is cheap. Delete it (Design & scope: "delete, don't layer").
- **Q:** Converter missing: skip with a warning? **A:** No, fail with `converter_unavailable` (deterministic over implicit; no silent fallback). It is a devDependency, so `bun install` always provides it.
- **Q:** Temp dir? **A:** One `mkdtempSync(join(tmpdir(), 'script-twin-'))` per `validateContract` call, removed in `finally`. Preserve the twin's relative subpath (e.g. `daily-summary/daily-summary.mjs`) under it.
- **Q:** Does this change a public surface? **A:** No. `script-contract-check` is an internal repo gate (package.json:94). The `Violation['kind']` union gains `converter_unavailable`; the only consumer is this script and its test.

### Design

All changes are in `plugins/sp/scripts/script-contract-check.ts` and its test. It is repo-only (it runs as `.ts` via `bun`; no `.mjs` twin), so no rebuild is needed. Confirm with `jq '.entries[] | select(.rel=="script-contract-check.ts")' config/plugin-scripts.json`.

```ts
export type ConvertTwin = (rel: string, outPath: string) => boolean;

export function spawnConvertTwin(repoRoot: string, bin = 'superskill'): ConvertTwin & { lastError?: string } {
    // spawnSync(bin, ['script', 'convert', 'sp', rel, '--out', outPath], { cwd: repoRoot, encoding: 'utf-8' })
    // true iff !res.error && res.status === 0 && existsSync(outPath); on failure record `${bin} …: ${stderr || error}`
}

export function validateContract(manifest, scriptsDir, pluginDir, opts: { convertTwin?: ConvertTwin } = {}): Violation[]
```

- **Rule 1 loop** (replaces `:239-262`): keep the `missing_twin` branch as is. When both files exist, and the converter has not already failed:
  1. `out = join(tmp, expectedTwinRel)`, then `mkdirSync(dirname(out), {recursive:true})`.
  2. If `!convert(entry.rel, out)`, push `{kind:'converter_unavailable', target: entry.rel, message: …}` and set `converterDown = true`. That stops further content checks, so one violation is reported, not 17.
  3. Otherwise, if `!readFileSync(out).equals(readFileSync(twinPath))`, push `stale_twin` with the message `standard script .mjs twin ${expectedTwinRel} does not match a fresh convert of ${entry.rel} — run bun run build:scripts`.
- **Default converter.** When `opts.convertTwin` is absent, `validateContract` uses `spawnConvertTwin(resolve(pluginDir, '..', '..'))`. `run()` needs no change beyond that. Tests that exercise other rules but have standard entries must pass a fake. Add a tiny helper in the test file: `const fakeConvert = (scriptsDir) => (rel, out) => { writeFileSync(out, twinOf(readFileSync(join(scriptsDir, rel), 'utf-8'))); return true; }`, and write fixture twins as `twinOf(source)`.
- **Delete** `STALE_TWIN_TOLERANCE_MS`, its comment block (`:239-244`), the `statSync` import if it becomes unused, and the 0606 sub-second test. Its rationale (fresh-worktree mtimes) no longer applies, because content checks are mtime-independent by construction.
- Update the header doc comment's rule list (`:1-20`) from "not older than the .ts source" to "byte-identical to a fresh convert".

**Invariants.**
- The gate outcome is independent of file mtimes.
- A missing converter is never a pass.
- The temp dir is always removed.
- No change to the manifest schema, `build:scripts` or the other rules.

### Plan

1. Branch `fix/script-twin-content-check` from main.
2. Tests first: rewrite the tests at `:118` and `:140` into AC1/AC2, add the AC3 tests, and add `fakeConvert`/`twinOf` helpers. Confirm AC1 fails against current code: the twin is newer, so the mtime rule passes it.
3. Implement `ConvertTwin`, `spawnConvertTwin`, the `opts` parameter and the new Rule 1 loop. Delete the tolerance code and update the header comment.
4. Thread `fakeConvert` into the existing tests that declare standard entries (`:70`, `:84`, `:101`, `:261`, `:295`, if they reach Rule 1 with both files present).
5. Gates: `bun test plugins/sp/tests/script-contract-check.test.ts`, `bun run script-contract-check`, the manual drift proof from the AC R4 lens, `bun run typecheck`, `bunx biome check plugins/sp/scripts plugins/sp/tests`, `bun run spur-check-feature`.
6. Commit: `fix(scripts): verify standard-script twins by content instead of mtime`.

### Solution

<!-- Filled during implementation: file:line change map and concise rationale. -->

### Testing

<!-- Filled during verification: commands run, outcomes, coverage claim or N/A. -->

### Review

<!-- Filled during review: P1-P4 findings, residual risk, and final disposition. -->

### References

- `plugins/sp/scripts/script-contract-check.ts:222` (`validateContract`), `:239-262` (Rule 1 mtime check), `:344` (`run`)
- `plugins/sp/tests/script-contract-check.test.ts:118`, `:140` (mtime tests to replace), `:284` (live-repo runner)
- `config/plugin-scripts.json` (manifest; 17 standard entries at HEAD 3571e710a)
- `package.json:61` (`build:scripts`), `:94` (`script-contract-check`), `:118` (`@gobing-ai/superskill` 0.3.17)
- Task 0606 R1 (origin of the sub-second mtime tolerance being removed)

### History

- 2026-09-26T06:18:48.322Z backlog → todo (system)

