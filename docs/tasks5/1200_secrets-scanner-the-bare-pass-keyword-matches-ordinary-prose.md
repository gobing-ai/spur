---
schema_version: 1
name: "secrets-scanner: the bare pass keyword matches ordinary prose (PASS: token) and hard-fails the pre-check preset"
status: done
template: standard
created_at: 2026-10-13T21:14:56.228Z
updated_at: "2026-10-14T00:53:46.421Z"

priority: P2
estimate_hours: 4
done_forced: "false"
done_reason: unforced close; PASS artifact at .spur/memory/evidence/1200-verdict.json
---

## 1200. secrets-scanner: the bare pass keyword matches ordinary prose (PASS: token) and hard-fails the pre-check preset

### Background

`rule run --preset recommended-pre-check` failed the whole quality gate on a **doc comment** during batch `runall-1193-1195-1068` (2026-10-13):

```
ERROR no-hardcoded-secrets packages/app/src/workflow/feature-verification-receipt.ts:107 potential secret (password)
```

Line 107 was prose: `Derived confidence in a PASS: \`HIGH\` when the selected definition's own command exited 0 ...`.

Mechanism (upstream, `@gobing-ai/ts-rule-engine`): the `password` category is built by `keyworded('passw[o]rd|passwd|pwd|pass', '[^"\'`]{4,}')` at `../ts-libs/packages/rule-engine/src/evaluators/secrets-scanner-evaluator.ts:25`, where `keyworded(keywords, value)` builds `(?i)(<keywords>)\s*[=:]\s*["'\`]<value>["'\`]`. The bare keyword `pass` therefore matches the word **PASS** followed by a colon and any backticked/quoted token of 4+ characters — ordinary prose, ADR text and doc comments included. The value shape `[^"'\`]{4,}` accepts spaces and any 4 characters, so almost any `PASS: \`X\`` or `pass: "word"` sentence matches.

Impact: the rule is enabled in `config/rules/structure/protected-files.yaml` (`categories: [api-key, token, private-key, password, connection-string]`, scope `apps/`, `packages/`, `scripts/`) and `test-pre-check` runs with `--fail-on warning`, so a false positive is a **hard gate failure** that reports as "potential secret (password)" — indistinguishable from a real leak in the gate log, and it costs a full pipeline cycle (the batch's first gate run died here).

Workaround already applied in-tree: the comment was reworded (commit `351db01d5`). The false-positive class remains for any prose shaped `PASS: \`SOMETHING\``, which this repo's own vocabulary (verdicts are PASS/PARTIAL/FAIL) makes likely to recur.

**Refine corrections (2026-10-13)** — ready audit against HEAD `4a3649ae1` and `../ts-libs` HEAD `067b5f47`. The single issue is **valid**:

- The matcher is unchanged upstream (`secrets-scanner-evaluator.ts:18`, `:25`). The installed copy, `@gobing-ai/ts-rule-engine` 0.5.24, carries the same pattern (`node_modules/@gobing-ai/ts-rule-engine/dist/evaluators/secrets-scanner-evaluator.js:14`). The catalog pin is `^0.5.24` (`package.json:41`).
- The FP class is wider than the task says. The keyword group has no left word boundary, so `bypass: "…"` and `compass = '…'` match too. Dropping `pass` removes both shapes.
- Evidence: `.spur/run/1193-test-gate.log` was overwritten by later runs and has no `no-hardcoded-secrets` line now. The durable evidence is the `351db01d5` diff. The Design's Evidence line now cites that diff.
- The upstream test file is `../ts-libs/packages/rule-engine/tests/evaluators/secrets-scanner-evaluator.test.ts`. It has no `PASS:` fixture today.
- Release coordination: 1195 also needs a ts-libs patch release plus a catalog bump. When both are ready, ship one release and one pin bump.

### Requirements

- [x] R1. The `password` category stops matching the word PASS (case-insensitively) followed by a colon and a 4-character token: the fixture line `Derived confidence in a PASS: \`HIGH\` when ...` produces no finding.
- [x] R2. Real password assignments still match: `password = "hunter2hunter2"`, `passwd: 'x9fJ2kLm'`, `pwd: "correct horse"` (or whatever set the chosen rule keeps — state it explicitly).
- [x] R3. The fix ships upstream from `../ts-libs` as a patch release and arrives here as a pinned `workspaces.catalog` version (the task 1195 shape), with the operator gate before publish.
- [x] R4. No category is silently disabled in this repo's rule config: `protected-files.yaml` keeps scanning all five categories.

### Acceptance Criteria

- [x] AC1 — The PASS-prose fixture yields no `no-hardcoded-secrets` finding (req: R1)
- [x] AC2 — The true-positive fixture still yields a finding (req: R2)
- [x] AC3 — `bun run test-pre-check` passes with the comment restored to its original wording (req: R1)
- [x] AC4 — Installed `ts-rule-engine` in `packages/app/node_modules` carries the fix and the catalog pin names the released version (req: R3)

### Q&A

<!-- CLOSED decisions from refinement: what was chosen and why, what was deferred and on what
     condition. Not a parking lot for open questions — an unanswered question here means the task
     is not ready to hand off. Keep empty if none. -->

### Design

**Fix direction (upstream, `../ts-libs/packages/rule-engine/src/evaluators/secrets-scanner-evaluator.ts:25`).** Drop the bare `pass` keyword: `keyworded('passw[o]rd|passwd|pwd', '[^"\'`]{4,}')`. The alternation has no left word boundary, so bare `pass` also matches `bypass:` and `compass =`. Its case-insensitive form also collides with this ecosystem's PASS verdict vocabulary. A real secret keyed `pass` is rare, and a real secret keyed `password`/`passwd`/`pwd` still matches. Keep the value shape `[^"'\`]{4,}` unchanged, so R2's three fixtures keep matching.

**Tests.** In `../ts-libs/packages/rule-engine/tests/evaluators/secrets-scanner-evaluator.test.ts`, add three negative fixtures and assert zero findings for each: the PASS-prose line, `bypass: "the cache"` and `compass = 'north'`. Add the three R2 positive fixtures and assert one `password` finding each. Build the fixture strings by concatenation, the same way the evaluator source does, so the test file does not trip the scanner when it scans itself.

**Rejected alternatives.**
- (a) Narrow this repo's rule scope to exclude `*.md`. Docs can leak real secrets, and the FP also fires in `.ts` doc comments. This weakens a security rule to hide a matcher bug.
- (b) Remove `password` from `categories` here. That silently disables password scanning.
- (c) Add a per-line allowlist comment to the scanner. That is new public surface for a matcher defect.
- (d) Keep `pass` and require a secret-shaped value. That shrinks R2's true-positive set (`pwd: "correct horse"` has a space), and the keyword collision stays.

**Anti-patterns.** Do not "fix" this by rewording consumer prose again; the class recurs. Do not publish without the operator gate: `spur-new`'s pin cannot resolve until the patch is on the registry.

**Evidence.** The `351db01d5` diff of `packages/app/src/workflow/feature-verification-receipt.ts` (original wording), `config/rules/structure/protected-files.yaml:7-13`, and `../ts-libs/packages/rule-engine/src/evaluators/secrets-scanner-evaluator.ts:16-25`.

### Plan

1. Reproduce upstream: add the negative fixtures to `../ts-libs/packages/rule-engine/tests/evaluators/secrets-scanner-evaluator.test.ts` and confirm they fail today.
2. Drop `pass` from the `password` keyword group. Negative and positive fixtures go green.
3. Run `(cd ../ts-libs/packages/rule-engine && bun run test && bun run lint)`.
4. OPERATOR GATE: publish the patch release (one release with 1195's clef fix if both are ready). Then pin `@gobing-ai/ts-rule-engine` in `spur-new`'s root `workspaces.catalog` and run `bun install`.
5. Verify here: restore the original wording from `351db01d5^` in `feature-verification-receipt.ts`, run `bun run test-pre-check` (green), then run `bun run spur-check`.

### Solution

Upstream fix (`../ts-libs`, commit `fb5dfd67`, released as lockstep `0.5.25` via the
Trusted-Publishing workflow run 38477585336):

- `../ts-libs/packages/rule-engine/src/evaluators/secrets-scanner-evaluator.ts:25` — dropped the
  bare `pass` keyword from the `password` category's keyword group. The alternation has no left
  word boundary and the group is compiled case-insensitively, so `pass` matched the ecosystem's own
  PASS verdict vocabulary in prose/doc comments (`PASS: \`HIGH\``) and the `bypass`/`compass`
  substrings; the resulting `--fail-on warning` finding is indistinguishable from a real leak.
  New group: `passw[o]rd|passwd|pwd`. The value shape `[^"'\`]{4,}` is unchanged, so real
  assignments (`password = "hunter2hunter2"`, `passwd: 'x9fJ2kLm'`, `pwd: "correct horse"`) keep
  firing.
- `../ts-libs/packages/rule-engine/tests/evaluators/secrets-scanner-evaluator.test.ts:44-92` — six
  fixtures: three negatives (the PASS-prose line, `bypass: "the cache"`, `compass = 'north'`) assert
  zero findings; three positives assert exactly one `secret:password` finding each. Fixture text is
  assembled at runtime so the test file does not trip the scanner it tests. All three negatives fail
  against the old matcher (reproduced).
- `../ts-libs/CHANGELOG.md` — `[Unreleased] → Fixed` entry for the matcher fix.

Consumer side (this repo):

- `package.json:41` — `workspaces.catalog` pin `@gobing-ai/ts-rule-engine` `^0.5.24 → ^0.5.25`;
  `bun.lock:237` re-resolved to 0.5.25.
- `packages/app/src/workflow/feature-verification-receipt.ts:107-111` — reverted the `351db01d5`
  prose reword, restoring the wording that reproduced the false positive. This is the AC3 fixture:
  it is red on 0.5.24 and green on 0.5.25.
- `config/rules/structure/protected-files.yaml` is untouched: all five secret categories stay
  enabled (R4). No rung of the rule config was narrowed, and no allowlist surface was added.

Verification already observed: `bun run test-pre-check` FAILS on
`packages/app/src/workflow/feature-verification-receipt.ts:107 potential secret (password)` with the
installed 0.5.24, and passes with 0.5.25 installed (they resolve through the same
`packages/app/node_modules` symlink, so the engine version is the only variable).

### Testing

**Pipeline verify results**

- Verdict: PASS (from verdict artifact)
- Confidence: MEDIUM

| Requirement | Status | Evidence |
|-------------|--------|----------|
| R1 | MET | The bare-keyword alternative is gone: the shipped matcher's password keyword group is `passw[o]rd`, `passwd`, `pwd` with no bare alternative at `packages/app/node_modules/@gobing-ai/ts-rule-engine/dist/evaluators/secrets-scanner-evaluator.js:14`. The restored consumer line at `packages/app/src/workflow/feature-verification-receipt.ts:107` yields 0 findings against the shipped engine and 1 `secret:password` finding against the pre-fix engine (both installed dists imported and run in-session over the same one-line fixture). |
| R2 | MET | Retained set stated explicitly: `passw[o]rd`, `passwd`, `pwd`, value shape unchanged. The three upstream positive fixtures each assert exactly one `secret:password` finding; `bun test tests/evaluators/secrets-scanner-evaluator.test.ts` prints 8 pass / 0 fail. Re-derived in-session against the shipped engine: `password = "hunter2hunter2"`, `passwd: 'x9fJ2kLm'` and `pwd: "correct horse"` each match. |
| R3 | MET | Ships upstream as the lockstep 0.5.25 release (upstream commit fb5dfd67, published by the Trusted-Publishing workflow named in the task Solution); the operator gate is recorded in the run's escalation artifact. Consumer side: `package.json:41` pins `@gobing-ai/ts-rule-engine` at ^0.5.25, `bun.lock:526` resolves it, the installed copy is a registry artifact under node_modules/.bun rather than a workspace link, and `npm view @gobing-ai/ts-rule-engine version` prints 0.5.25. |
| R4 | MET | `config/rules/structure/protected-files.yaml` is untouched (absent from `git status --porcelain`) and still lists all five categories at `config/rules/structure/protected-files.yaml:13`; no allowlist surface was added and no scope narrowed. |

| Acceptance Criteria | Status | Evidence Type | Evidence |
|---------------------|--------|---------------|----------|
| AC1 | MET | test | The three upstream negative fixtures (the PASS-prose line, `bypass: "the cache"`, `compass = 'north'`) each assert zero findings; `bun test tests/evaluators/secrets-scanner-evaluator.test.ts` prints 8 pass / 0 fail. The same three lines each match the pre-fix keyword group and not the shipped one, reproduced in-session. |
| AC2 | MET | test | The three upstream positive fixtures each assert exactly one `secret:password` finding: `password = "hunter2hunter2"`, `passwd: 'x9fJ2kLm'`, `pwd: "correct horse"`; 8 pass / 0 fail in the same run. |
| AC3 | MET | command | `bun run test-pre-check` prints `All 51 rules passed — no violations found.` and exits 0 with the wording restored at `packages/app/src/workflow/feature-verification-receipt.ts:107`; that restored block is byte-identical to the pre-reword state of commit 351db01d5. Red half: the same line yields one `secret:password` finding on the pre-fix engine. |
| AC4 | MET | command | `npm view @gobing-ai/ts-rule-engine version` prints 0.5.25; the installed copy is 0.5.25 (`packages/app/node_modules/@gobing-ai/ts-rule-engine/package.json:3`) and its dist carries the fixed keyword group with no bare-keyword alternative; the catalog pin `package.json:41` names ^0.5.25. |
- Coverage: N/A (verdict-based; verify pipeline does not measure code coverage)

**Gate certification (post-record addendum — audit disclosure, no evidence removed).**

`bun run spur-check` — the canonical invocation — was observed **red four times** in this run, and
every failure was a host-contention timing failure, not an assertion failure: run #1 9 fails
(3 were real defects of this change — a partial `@gobing-ai/ts-*` pin bump that left two
`@gobing-ai/ts-infra` copies, and committed plugin bundles still embedding
`HISTORY_IMPORT_SCHEMA_VERSION` 0.5.24; both fixed), run #2 2 fails, run #3 53 fails, run #4 5 fails
(4 timeouts + one wall-clock bound, `packages/domain/tests/analytics/forensic-query-history.test.ts:502`
`toBeLessThan(100)` receiving 143.2 ms). A 10-minute watch showed load1 never falling below 22.74
with three other batches running their own suites; the unmodified main tree reproduces the same
timeouts (`plugins/sp/tests/inline-run-setup.test.ts`, 3 failures at its 5 s budget with 14-19 s per
test), and every red test passes in isolation.

The PASS recorded above comes from the project's own test runner with two assertion-neutral deltas —
cross-file `--parallel` dropped and the liveness budget raised 20 s -> 60 s — so the identical file
roots, pre-check and post-check rules, and every assertion executed:

```
bun run lint && bun run test-pre-check && bun run bundle:config && bun scripts/commands/run-tests.ts test --reporter=dots --timeout 60000 ./apps/cli ./apps/server ./apps/web ./apps/desktop ./packages ./plugins ./scripts && bun run test-post-check
```

Result: `11379 pass / 0 fail` across 657 files at the certified digest
`sha256:f91edd4b144c9fbb2bb937844a53c2a89e55801bff5a9e3914eed3fc8c109297` (full tier, exit 0,
831 s). This is a **variant** of `bun run spur-check`, recorded as such rather than claimed as the
canonical invocation — the operator authorized the variant explicitly on 2026-10-13.


**Landing certification (canonical gate, post-merge on `main` @ `aa242b5e2`).**

The variant above was the *in-flight* certification; the canonical gate was then re-run on the
merged `main` tree once the host quieted (load average 9.3, down from 22-52) and **passed with no
variant at all**:

```
bun run spur-check
```

`All 51 rules passed` (pre-check) · `11379 pass / 0 fail` across 657 files in 102 s · `All 2 rules
passed` (post-check) — exit chain clean. This also refreshed `main`'s stale `.coverage` artifact,
which had made a standalone `bun run test-post-check` report a spurious
`coverage-gate packages/app/src/services/scheduler-custom-job-service.ts 87%` finding.

Effect on the residual: the host-contention flake story above is now explained end-to-end — the same
suite that took 831 s serial under load 20-50 and produced timeout failures ran green in 102 s at
load 9.3 with zero assertion changes. The `no-hardcoded-secrets` false positive is gone from both the
rule set and the consumer comment, and the project's own gate certifies the landed tree.

### Review

#### Review Report — 1200

**Scope:** task 1200 change set on `sp/run-1200-1b84` — 8 files, +102/−69: `package.json:32-43` (all 12 `@gobing-ai/ts-*` catalog pins `^0.5.24` → `^0.5.25`), `bun.lock:228-240` and `:508-532`, `packages/app/src/workflow/feature-verification-receipt.ts:107-111` (revert of the `351db01d5` prose reword, i.e. the AC3 fixture), `plugins/sp/lib/idea-handoff.generated.mjs`, `plugins/sp/lib/inline-run.generated.mjs`, `plugins/sp/lib/quality-gate.generated.mjs`, `plugins/sp/scripts/quality-gate.mjs` (regenerated), plus the task file. Upstream fix inspected read-only at `../ts-libs` commit `fb5dfd67`.

**Dimensions:** functional traceability, security, efficiency, correctness, usability, architecture.

Verdict: PASS
Confidence: MEDIUM

#### Findings (ranked)

| # | Priority | Dimension | Finding | Location | Disposition |
|---|----------|-----------|---------|----------|-------------|
| 1 | P4 (advisory) | process | The event trace's residue count for the final digest understates the recorded artifact: the trace says the last recheck was 2 timeouts, while the gate log and receipt for the same digest record 11326 pass and 53 fail. The parent brief's ordering (9 → 2 → 53) disagrees with the trace's (9 → 9 → 2); only the final run's log survives, so the intermediate counts are unverifiable. The authoritative artifacts are honest (`.spur/run/1200-test-gate.status` is FAIL, `.spur/run/1200-check-receipt.json` is status FAIL, tier full) — only this one count line is wrong. | `.spur/run/run-1200-1b84-event-trace.md:13` | OPEN |
| 2 | P4 (advisory) | security | Detection loss is real and deliberate: the new keyword group no longer matches a secret keyed exactly `pass` or `PASS`, nor the `_pass` / `-pass` suffix forms. Reproduced against both groups: `db_pass: "hunter2hunter2"` matched the legacy group and does not match the shipped one (legacy group read from the installed previous package at `packages/app/node_modules/@gobing-ai/ts-rule-engine/dist/evaluators/secrets-scanner-evaluator.js:14`); `password`, `passwd` and `pwd` assignments still match. No compensating word-boundary or verdict-vocabulary exclusion was added; the tradeoff is stated in the Design and in the upstream CHANGELOG entry. | `../ts-libs/packages/rule-engine/src/evaluators/secrets-scanner-evaluator.ts:25` | ACCEPTED |
| 3 | P4 (advisory) | security | The residual false-positive class for the surviving keywords is unchanged: the loose value shape (4+ non-quote characters, spaces allowed) still reads prose shaped like an assignment to `password`, `passwd` or `pwd`. This fix removes the PASS-prose, `bypass` and `compass` shapes only. Tightening the value shape was rejected (it would drop the spaced `pwd` fixture), so this residual is accepted rather than overlooked. | `../ts-libs/packages/rule-engine/src/evaluators/secrets-scanner-evaluator.ts:23-25` | ACCEPTED |
| 4 | P4 (advisory) | correctness | The bundle refresh also carried pre-existing bundle drift into this change set: the finding code `L4.feature-receipt-confidence` is present in the source at HEAD (`packages/config/src/finding-codes.ts:85`) but absent from HEAD's committed gate bundle, so the build adds it at `plugins/sp/scripts/quality-gate.mjs:24317` and `plugins/sp/lib/quality-gate.generated.mjs:24315`. Unrelated to this task, correct as generated output, and reproducible: re-running the build leaves the working tree byte-identical (sha256 of all four bundles unchanged). | `plugins/sp/scripts/quality-gate.mjs:24317` | ACCEPTED |
| 5 | P4 (advisory) | process | The full-gate acceptance is recorded and not papered over: `bun run spur-check` never went green in this run (final run 11326 pass / 53 fail in 397 s; all 53 fails are timeout-shaped), the FAIL token in `.spur/run/1200-test-gate.status` is not rewritten, and the override names host load, the light-tier evidence and the unmodified-main reproduction. Two completeness gaps remain: the task's Testing section is still empty, so this Review section is the first durable carrier of the residual; and a green `test-post-check` (2/2 rules, reproduced here) holds only against the coverage file of a full-suite run, since the rule reads the last artifact rather than measuring (`config/rules/quality/coverage-gate.yaml:24`). | `.spur/run/run-1200-1b84-event-trace.md:13-19` | ACCEPTED |

#### Functional Traceability

| Req | Status | Evidence |
|-----|--------|----------|
| R1 | MET | The bare-keyword alternative is gone from the `password` category group at `../ts-libs/packages/rule-engine/src/evaluators/secrets-scanner-evaluator.ts:25`; the PASS-prose fixture asserts zero findings and passes. Mechanism reproduced in isolation: the restored comment line matches the legacy group and does not match the shipped group under the same case-insensitive `(keywords)\s*[=:]\s*["'\`]value["'\`]` construction. |
| R2 | MET | Retained set stated explicitly: `passw[o]rd`, `passwd`, `pwd`, value shape unchanged. All three positive fixtures (`password = "hunter2hunter2"`, `passwd: 'x9fJ2kLm'`, `pwd: "correct horse"`) pass and each asserts exactly one `secret:password` finding. |
| R3 | MET | Shipped upstream in `../ts-libs` commit `fb5dfd67` as lockstep `0.5.25`, published via the Trusted-Publishing run named in the task Solution; the operator gate is recorded (`.spur/run/1200-escalation.md` Q0/A0). Consumer side: `package.json:41` pins the release, `bun.lock:237` resolves it, the installed copy is a registry artifact under `node_modules/.bun/@gobing-ai+ts-rule-engine@0.5.25+473ffacabfa9a78c/` (not a workspace link), and `npm view @gobing-ai/ts-rule-engine version` returns `0.5.25`. |
| R4 | MET | `config/rules/structure/protected-files.yaml` is absent from `git status --porcelain` (untouched) and still lists all five categories at `config/rules/structure/protected-files.yaml:13`; no allowlist surface was added and no scope was narrowed. |
| AC1 | MET | `bun test tests/evaluators/secrets-scanner-evaluator.test.ts` in `../ts-libs/packages/rule-engine`: 8 pass / 0 fail, including the three negative fixtures (the PASS prose line, `bypass: "the cache"`, `compass = 'north'`). Positive control: all three negatives match against the pre-fix group. |
| AC2 | MET | Same run: the three true-positive fixtures each yield exactly one `secret:password` finding. |
| AC3 | MET | With the restored wording at `packages/app/src/workflow/feature-verification-receipt.ts:107`, `bun run test-pre-check` prints `All 51 rules passed — no violations found.` and exits 0, with no `no-hardcoded-secrets` finding. The red half is reproduced by mechanism: the same line matches the pre-fix keyword group and not the shipped one. |
| AC4 | MET | Installed `packages/app/node_modules/@gobing-ai/ts-rule-engine/package.json:3` carries 0.5.25; its `dist/evaluators/secrets-scanner-evaluator.js` carries the fixed keyword group with zero occurrences of the bare-keyword form; the catalog pin names the released version. |

#### Verification (fresh, this review)

- `bun run test-pre-check` → `All 51 rules passed`, exit 0.
- `bun run test-post-check` → `All 2 rules passed`, exit 0 (against the final gate run's coverage artifact, restored after my isolation runs overwrote it).
- `bun run lint` (biome over 1397 files, every workspace typecheck plus two tsconfigs) → exit 0.
- `bun test tests/evaluators/secrets-scanner-evaluator.test.ts` (upstream) → 8 pass / 0 fail.
- `bun run build:scripts` re-run → all four bundles byte-identical, `git status` unchanged: the regenerated bundles are reproducible output, not hand edits.
- Isolation of the gate residue: `apps/cli/tests/commands/workflow-run-from.test.ts` → 10 pass; `packages/app/tests/workflow/proportional-routing-pilots.test.ts` → 9 pass (both timed out in the full gate). Control: on the unmodified main worktree `/Users/robin/xprojects/spur-new` (engine 0.5.24), `plugins/sp/tests/inline-run-setup.test.ts` → 19 pass / 3 fail, all three at their 5000 ms budget, against 2 such fails here — the change set does not introduce them.
- Class sweep (same-round sibling search): the pre-fix pattern appears nowhere else in the tree except the task doc that documents it (no vendored or bundled copy of the matcher; every `@gobing-ai/ts-*` dependency is `catalog:`), and the reverted comment in `feature-verification-receipt.ts` is the only remaining consumer-surface instance of the false positive.

#### Residual risk (explicit)

1. **The security rule is genuinely narrower (finding 2).** Dropping the bare keyword does remove real detection: an assignment keyed exactly `pass` or `PASS`, or ending in `_pass` / `-pass` (`db_pass: …`, `user_pass = …`), matched before and does not now. `password`, `passwd` and `pwd` — the key names a real configuration would use — still match, and R2's accepted set is stated explicitly in the task. A left word boundary would not have helped: `\bpass` still matches `PASS:` case-insensitively. So the choice was a case-sensitive special case or removal; removal was chosen, documented, and mirrored by upstream fixtures plus a CHANGELOG entry. Residual: a leak whose only signal is a key named `pass` is now undetected by this category.
2. **The false-positive class is reduced, not eliminated (finding 3).** Ordinary prose that looks like an assignment to `password`, `passwd` or `pwd` still trips the rule, and the loose value shape still accepts spaced or short values. The gate log line remains indistinguishable from a real leak for those shapes.
3. **The repository-wide gate never went green (finding 5), and this review did not obtain a green full-suite run.** Evidence: the last recorded `bun run spur-check` run is 11326 pass / 53 fail / 1 error in 397 s with `.spur/run/1200-test-gate.status` = FAIL; every one of the 53 fail lines carries a `timed out after 20000`, `30000` or `60000ms` window (checked mechanically over all 53, not sampled); neighbouring tests in the same files run 10–19 s; and the unmodified main tree reproduces the same failures (3 timeouts in `inline-run-setup.test.ts` at its 5 s budget). Mitigations: pre-check (51/51), post-check (2/2) and lint/typecheck are green and freshly reproduced here; two of the gate's red test files pass in isolation; the bundle build is byte-identical on re-run. What is NOT eliminated: no green full-suite run exists, so a genuine defect hidden inside the timeout set cannot be excluded by inspection alone. The strongest available counter-evidence is that the same failures occur without this change.
4. **The pin imports more than this fix.** The release is lockstep and also carries task 1195's changes (the ai-runner neutral-state fix and the process-driver disposal seam, per `.spur/run/1200-escalation.md`). The reviewed consumer diff is only the pin and the regenerated bundles, but the runtime surface of the bump is wider than this task's commit. The two `@gobing-ai/ts-infra` directories under `node_modules/.bun/` are distinct peer resolutions of the same version; `bun run typecheck` is green, including the `rule-service.ts` boundary that failed during the mixed-version cycle.
5. **Confidence basis.** MEDIUM rather than HIGH for one reason only: item 3 — no green full-gate run, so the repository-wide verdict rests on reproduced counter-evidence rather than a fresh green suite. Every requirement row above is MET with file:line evidence, every finding carries a disposition, and the commands behind each claim are listed in this report.

### References

<!-- Links to features, docs, ADRs, related tasks, or external references. -->

### History

- 2026-10-13T21:45:13.840Z backlog → todo (system)
- 2026-10-13T22:29:34.326Z todo → wip (system)
- 2026-10-14T00:32:13.901Z wip → testing (system)
- 2026-10-14T00:32:43.183Z testing → done (system)

