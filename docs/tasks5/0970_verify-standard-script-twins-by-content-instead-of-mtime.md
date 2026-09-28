---
schema_version: 1
name: Verify standard-script twins by content instead of mtime
status: done
template: feature-impl
created_at: 2026-09-26T06:13:44.341Z
updated_at: "2026-09-28T19:56:40.375Z"
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

- [x] R1. Rule 1's staleness test compares content. For each `contract: standard` entry whose `.ts` and twin both exist, the check regenerates the twin into a temp dir with `superskill script convert sp <rel> --out <tmp>/<twin>` and reports `stale_twin` when the bytes differ from the committed twin. File mtimes are no longer consulted, and `STALE_TWIN_TOLERANCE_MS` and its comment are deleted.
- [x] R2. The converter is injectable. `validateContract(manifest, scriptsDir, pluginDir, opts?: { convertTwin?: (rel: string, outPath: string) => boolean })`, where the function returns false when conversion could not run. `run()` supplies the real spawn-based converter; unit tests supply a deterministic fake.
- [x] R3. When the converter cannot run (spawn error / ENOENT, non-zero exit, or no output file), the check reports one `converter_unavailable` violation naming the command and its stderr, then stops content-checking the remaining entries. It never silently passes.
- [x] R4. The live-repo gate (`bun run script-contract-check`) passes at HEAD and fails when any committed standard twin is edited by hand, regardless of mtimes.

### Acceptance Criteria

Graduates all three of feature A32's scenarios (exact titles below); the numbered rows are the verify lens.

- [x] AC1 — R1 — Stale twin with a newer mtime is caught (req: R1, R2)
- [x] AC2 — R2 — Fresh twin with an older mtime passes (req: R1, R2)
- [x] AC3 — R3 — Missing converter fails loudly (req: R3)

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

- [x] Branch from main (executed on pipeline worktree branch `sp/run-0970-87caae`).
- [x] Tests first: rewrite the mtime tests into AC1/AC2, add the AC3 tests, add `fakeConvert`/`twinOf`. Confirm AC1 fails against the pre-change behavior (a newer twin passed the mtime rule).
- [x] Implement `ConvertTwin`, `spawnConvertTwin`, the `opts` parameter and the new Rule 1 loop. Delete the tolerance code and update the header comment.
- [x] Thread `fakeConvert` into the existing tests that reach Rule 1 with both files present (R4 forbidden-invocation, "Clean setup"); adapt the in-process `run()` fixture (see Solution).
- [x] Gates: focused test file, `bun run script-contract-check`, the drift proof, `bun run typecheck`, `bunx biome check plugins/sp/scripts plugins/sp/tests`, `bun run spur-check-feature`, `bun run spur-check`.
- [x] Commit: `fix(scripts): verify standard-script twins by content instead of mtime`.

### Solution

`plugins/sp/scripts/script-contract-check.ts`

- `plugins/sp/scripts/script-contract-check.ts:7` — header rule 1 now reads "byte-identical to a fresh convert of its .ts source".
- `plugins/sp/scripts/script-contract-check.ts:47` — `Violation['kind']` gains `'converter_unavailable'`.
- `plugins/sp/scripts/script-contract-check.ts:226-245` — `ConvertTwin` and `spawnConvertTwin(repoRoot, bin = 'superskill')`, which runs `superskill script convert sp <rel> --out <out>` from the repo root and returns false (never throws), recording the command plus stderr in `lastError`.
- `plugins/sp/scripts/script-contract-check.ts:248-254` — `validateContract(..., opts: { convertTwin?: ConvertTwin } = {})`.
- `plugins/sp/scripts/script-contract-check.ts:270-311` — Rule 1: `missing_twin` unchanged; otherwise regenerate into one `mkdtempSync` dir and compare bytes; a converter failure pushes one `converter_unavailable` and sets `converterDown`, and the temp dir is removed in `finally`. `STALE_TWIN_TOLERANCE_MS` and its comment are deleted; mtime is no longer read for staleness.

`plugins/sp/tests/script-contract-check.test.ts`

- `plugins/sp/tests/script-contract-check.test.ts:136,161,184,207` — `twinOf`/`fakeConvert` helpers plus the AC1/AC2/AC3 tests.
- `plugins/sp/tests/script-contract-check.test.ts:355` — the live-repo runner timeout is raised to 30 s (measured 1.5 s; headroom for loaded full-suite runs, cf. task 0981).
- `plugins/sp/tests/script-contract-check.test.ts:370` — the in-process `run()` fixture is now `repo-only`: `run()` supplies the real converter and cannot inject a fake, so a standard entry there would require a genuine `superskill` convert. Rule 1's content path stays covered by the `validateContract` tests and the live-repo runner test.

Evidence: focused file 18 pass / 0 fail; plugin suite 1674 pass / 0 fail; `bun run script-contract-check` PASS at HEAD; drift proof — append `// drift` to `plugins/sp/scripts/quality-gate.mjs` and touch → FAIL `stale_twin`, `git checkout` → PASS; `bun run spur-check-feature` green; `bun run spur-check` 9381 pass / 0 fail. A targeted strict `tsc` on both files adds 0 new errors (the remaining ones are task 0973's `plugins/sp` backlog, including `'gobing_ai_import'` in the same union).

### Testing

**Pipeline verify results**

- Verdict: PASS (from verdict artifact)

| Requirement | Status | Evidence |
|-------------|--------|----------|
| R1 | MET | `plugins/sp/scripts/script-contract-check.ts:271-317` — Rule 1 regenerates into one `mkdtempSync` dir, compares bytes (`:303`), removes the dir in `finally` (`:315-316`); no mtime read for staleness, `STALE_TWIN_TOLERANCE_MS` absent (`rg` 2026-09-28); header `plugins/sp/scripts/script-contract-check.ts:7` |
| R2 | MET | `plugins/sp/scripts/script-contract-check.ts:228-254` — `ConvertTwin`, `spawnConvertTwin(repoRoot, bin)`, optional `opts.convertTwin`; default wired at `plugins/sp/scripts/script-contract-check.ts:278` |
| R3 | MET | `plugins/sp/scripts/script-contract-check.ts:290-301` — one `converter_unavailable` carrying `lastError` (command + stderr), then `converterDown` stops further checks |
| R4 | MET | 2026-09-28: `bun run script-contract-check` exit 0 at HEAD; append `// drift` + `touch` `plugins/sp/scripts/quality-gate.mjs` → exit 1 `stale_twin … quality-gate.mjs does not match a fresh convert of quality-gate.ts`; `git checkout` → exit 0 |

| Acceptance Criteria | Status | Evidence Type | Evidence |
|---------------------|--------|---------------|----------|
| R1 — Stale twin with a newer mtime is caught | MET | test | `plugins/sp/tests/script-contract-check.test.ts:136` — newer-mtime twin with differing content → `stale_twin`; file 18 pass / 0 fail 2026-09-28 |
| R2 — Fresh twin with an older mtime passes | MET | test | `plugins/sp/tests/script-contract-check.test.ts:161` — older-mtime twin matching a fresh convert → no `stale_twin`; green 2026-09-28 |
| R3 — Missing converter fails loudly | MET | test | `plugins/sp/tests/script-contract-check.test.ts:184` (fake false → exactly one `converter_unavailable`) + `plugins/sp/tests/script-contract-check.test.ts:207` (bogus binary → `converter_unavailable`); green 2026-09-28 |
- Coverage: N/A (verdict-based; verify pipeline does not measure code coverage)

### Review

**SECU findings** (self-review)

| Priority | Dimension | Location | Finding |
|----------|-----------|----------|---------|
| P4 | Performance | `plugins/sp/scripts/script-contract-check.ts:270-311` | The gate now spawns `superskill` once per standard entry (~1.5 s for 17). Acceptable for a repo gate; the cost buys mtime-independent proof. |
| P4 | Test coverage | `plugins/sp/tests/script-contract-check.test.ts:370` | The in-process `run()` test no longer exercises a standard entry, because `run()` cannot inject a converter. Accepted: the `validateContract` tests and the live-repo runner cover Rule 1. |

No P1–P3 findings. The gate is now fail-closed: a missing converter reports `converter_unavailable` instead of passing.

### References

- `plugins/sp/scripts/script-contract-check.ts:222` (`validateContract`), `:239-262` (Rule 1 mtime check), `:344` (`run`)
- `plugins/sp/tests/script-contract-check.test.ts:118`, `:140` (mtime tests to replace), `:284` (live-repo runner)
- `config/plugin-scripts.json` (manifest; 17 standard entries at HEAD 3571e710a)
- `package.json:61` (`build:scripts`), `:94` (`script-contract-check`), `:118` (`@gobing-ai/superskill` 0.3.17)
- Task 0606 R1 (origin of the sub-second mtime tolerance being removed)

### History

- 2026-09-26T06:18:48.322Z backlog → todo (system)
- 2026-09-28T06:30:57.278Z todo → wip (system)
- 2026-09-28T06:30:58.118Z wip → testing (system)
- 2026-09-28T06:43:21.796Z testing → done (system)

