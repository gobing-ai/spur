---
schema_version: 1
name: "A94 wave 4: rule check-shims and certify-coverage"
status: done
template: feature-impl
created_at: 2026-11-20T07:58:05.084Z
updated_at: "2026-11-20T16:47:14.508Z"
feature_id: A94
priority: P1
tags:
  - A94
  - tooling

dependencies: ["1410"]
estimate_hours: 5
done_forced: "false"
done_reason: unforced close
---

## 1412. A94 wave 4: rule check-shims and certify-coverage

### Background

Implements: R7 — Transition shim ledger is a downstream rule; R8 — Coverage provenance is enforceable downstream.

Transition-shim ledger and coverage certification are repository-only, so the shipped coverage-gate preset cannot trust LCOV downstream (C5, C6).

Design authority: docs/design/downstream-tooling-absorption.md (consent C1–C10 granted 2026-11-19).

**Refine corrections (2026-11-20)**

- R2 "`rule certify-coverage [--lcov]` writes certified provenance (write-only, single-shot)" → certification is **two-phase**. First `startCanonicalRun` (`scripts/commands/coverage-certification.ts:168`) opens a pending window and fingerprints the tree **before** tests run. Then `certifyCanonicalRun` (`:205`) publishes after the run. A single-shot verb invoked after a completed run has no pre-run fingerprint, so it cannot prove the LCOV came from the current tree. → **Open: needs operator consent** (see Q&A). The C6 argv as granted cannot carry the start phase without a mode flag (a rejected shape, §5) or an uncovered argv/verb.
- R5 "run-tests calls `rule certify-coverage`" → `run-tests.ts:39` imports start/certify in-process, and `:40` imports `./test-suite-termination`. → run-tests (retained, repo-only) imports the moved service from `@gobing-ai/spur-app` instead of spawning the CLI, so there is no subprocess hop inside the canonical run.
- R4 "presets invoke the verbs" → no shipped rule invokes `spur` today. CI does not `bun link` (`.github/workflows/ci.yml`). The existing pattern is a marker-guarded `sh -c` (`config/rules/boundary/sp-script-placement.yaml`). → Frozen preset command:
  - in the Spur checkout (marker `scripts/spur-dev.ts`): `bun run apps/cli/src/index.ts rule <verb>`;
  - otherwise: `spur rule <verb>`.

  `check-coverage-cert` outside Spur exits 0 with `SKIP: no coverage certification` when `.coverage/coverage-certification.json` is absent, so it is opt-in and non-breaking downstream.
- R1 → `config/transition-shims.json` (keys `entries`, `note`) is the default manifest. Missing manifest = pass, as stated.
- Preset placement → `recommended-post-check` extends `quality`, which holds `coverage-gate` (`config/rules/quality/coverage-gate.yaml`). → `check-coverage-cert` goes in `quality`, and `check-shims` goes in `boundary` (pre-check).

**Refine corrections, pass 2 (2026-11-20, after operator decision)**

- Q1 → the operator chose option 1: `spur rule certify-coverage [--lcov <path>] -- <command…>`. Recorded as consent amendment 2 in satellite §5. R2 is unblocked.
- Where the child writes its LCOV → `certifyCanonicalRun` reads `<start.coverageDir>/lcov.info` (`coverage-certification.ts:224`). Here `coverageDir = .coverage/run-<runId>` is created by `startCanonicalRun` (`:172`). run-tests injects it through a rewritten bunfig (`run-tests.ts:262-286`), because Bun's config `coverageDir` overrides the CLI flag. A generic wrapper cannot rewrite an arbitrary tool's config. → The wrapper exposes the run dir in two ways: the env var `SPUR_COVERAGE_DIR`, and substitution of the literal argv token `{coverageDir}`. The parent shell cannot expand a variable that only the wrapper sets, which is why the token is needed. The child must write `lcov.info` there.
- `--lcov` meaning → it is the **published** certified LCOV path, the same on both verbs (default `.coverage/lcov.info`, `LCOV_RELATIVE_PATH`). It never means the child's output path, so `certify-coverage --lcov X` and `check-coverage-cert --lcov X` agree.
- Failure parity (`run-tests.ts:288-297`) → a non-zero child skips certify and leaves the marker `pending` (fail-closed). When certify is refused, the wrapper prints `coverage-certification: refused (<reason>) — <message>` and exits 1. On success the run dir is removed.

### Requirements

- [x] R1. `spur rule check-shims [--manifest <path>]` (default `config/transition-shims.json`) validates the two-sided shim ledger with today's `transition-shim-check` semantics. A missing manifest passes. Exit 0/1/2, with the `--json` findings envelope.
- [x] R2. `spur rule certify-coverage [--lcov <path>] -- <command…>`, consented (satellite §5 amendment 2):
  1. Run `startCanonicalRun(cwd)` (pre-run fingerprint plus pending marker).
  2. Spawn `<command…>` as argv with no shell and stdio inherited. Set env `SPUR_COVERAGE_DIR=<run dir>`, replace every argv token `{coverageDir}` with the run dir, and forward SIGINT/SIGTERM to the child.
  3. On child exit 0, run `certifyCanonicalRun`, then publish the LCOV to `--lcov` (default `.coverage/lcov.info`) and the marker to `.coverage/coverage-certification.json`.

  Exit codes:
  - the child's code when non-zero (marker left pending, nothing certified);
  - 1 when certify is refused (`coverage-certification: refused (<reason>) — <message>`);
  - 0 when certified;
  - 2 when `--` or the command is missing.
- [x] R3. `spur rule check-coverage-cert [--lcov <path>]` runs `validateCoverageCertification` and exits:
  - 0 certified;
  - 1 stale, byte-mismatched or missing (when an `.coverage/` certification is expected);
  - 2 usage.

  `--json` emits findings `{kind: "coverage-artifact", detail}`. Root `package.json:81` `test-post-check` calls it in place of `coverage-provenance-check`.
- [x] R4. Shipped rules:
  - `config/rules/quality/coverage-cert.yaml` and `config/rules/boundary/transition-shims.yaml` use the `exit-code` evaluator with the marker-guarded command above;
  - `check-coverage-cert` downstream SKIPs (exit 0) when no certification file exists;
  - `ts-rule-engine` is unchanged.
- [x] R5. `scripts/commands/run-tests.ts` keeps the hermetic env scrub and suite termination and imports start/certify from `@gobing-ai/spur-app`. `coverage-certification.ts`, `coverage-provenance-check.ts` and `transition-shim-check.ts` are deleted from `scripts/commands`, RETIRED entries are added, and A94 is updated.

**Out of scope:** native evaluator types, the coverage threshold policy, CI edits.

### Acceptance Criteria

- [x] AC1 — Transition shim ledger is a downstream rule (req: R1, R4, R5)
- [x] AC2 — Coverage provenance is enforceable downstream (req: R2, R3, R4, R5)

### Q&A

<!-- CLOSED decisions from refinement: what was chosen and why, what was deferred and on what
     condition. Not a parking lot for open questions — an unanswered question here means the task
     is not ready to hand off. Keep empty if none. -->

#### Q&A entry — 2026-11-20T08:35:08.440Z

- **Q1 (OPEN, blocks R2):** coverage certification is two-phase (a pre-run fingerprint at `coverage-certification.ts:168`, then certify at `:205`), but consent C6 grants only a single-shot `rule certify-coverage [--lcov <path>]`. Which shape is approved?
  - (1) `certify-coverage [--lcov <path>] -- <command…>` wrapper. Recommended.
  - (2) Add the verb `rule open-coverage-cert` paired with `certify-coverage`.
  - (3) Single-shot with a certify-time fingerprint, which weakens provenance.
- **Q2:** How do presets reach the CLI when CI doesn't link `spur`? **A (closed):** a marker-guarded `sh -c` that runs the source CLI in the Spur checkout and `spur` elsewhere.
- **Q3:** Should `check-coverage-cert` fail downstream projects without certification? **A (closed):** no. It SKIPs (exit 0) when the file is absent and stays strict in Spur, where `bun run test` always certifies.

#### Q&A entry — 2026-11-20T08:40:23.576Z

- **Q1:** Which certify-coverage shape? **A (closed, operator 2026-11-20):** option 1, the `certify-coverage [--lcov <path>] -- <command…>` wrapper.
- **Q1a:** How does an arbitrary command learn the run dir? **A (closed):** the env `SPUR_COVERAGE_DIR` and the `{coverageDir}` argv token.
- **Q2:** How do presets reach the CLI when CI doesn't link `spur`? **A (closed):** a marker-guarded `sh -c` that runs the source CLI in the Spur checkout and `spur` elsewhere.
- **Q3:** Should `check-coverage-cert` fail downstream projects without certification? **A (closed):** no. It SKIPs (exit 0) when the file is absent and stays strict in Spur, where `bun run test` always certifies.

### Design

**WHAT/WHY.** Shim-ledger and coverage-provenance checks become rule verbs that downstream presets can run. Certification semantics (pre-run fingerprint, byte binding) are preserved exactly.

**WHERE (frozen).**
- `packages/app/src/rules/coverage-certification.ts`: `git mv` from `scripts/commands/coverage-certification.ts`. Exports `startCanonicalRun`, `certifyCanonicalRun`, `validateCoverageCertification`, `CANONICAL_RECOVERY`, `CERT_RELATIVE_PATH`, `LCOV_RELATIVE_PATH`, with `cwd` parameterized.
- `packages/app/src/rules/transition-shims.ts`: `git mv` from `scripts/commands/transition-shim-check.ts`.
- Tests move with them to `packages/app/tests/rules/`.
- CLI: `apps/cli/src/commands/rule/{check-shims,check-coverage-cert,certify-coverage}.ts`, registered in `rule/index.ts`.
- Rules: `config/rules/quality/coverage-cert.yaml` and `config/rules/boundary/transition-shims.yaml`. Command template:

  ```sh
  sh -c 'if [ -f scripts/spur-dev.ts ]; then bun run apps/cli/src/index.ts rule <verb>; else spur rule <verb>; fi'
  ```

**certify-coverage (Q1 closed, option 1).**
- **WHERE:** `certifyCommand({cwd, lcov, argv, spawn})` in `packages/app/src/rules/coverage-certification.ts`. The spawner is injected for tests and defaults to `Bun.spawn`.
- **Commander config:** `.argument('<command...>')` plus `.passThroughOptions()`, so flags after `--` reach the child.
- **Publish destination:** it honors `--lcov` (today `renameSync(producedPath, lcovPath(cwd))`, `:241`). The default stays byte-identical.
- **run-tests:** keeps its in-process start/certify and never shells out to the verb.
- **Docs:**
  - document `SPUR_COVERAGE_DIR` in `docs/help/environment_variables.md`;
  - add a downstream Bun example to the spur-cli reference: `spur rule certify-coverage -- bun test --coverage --coverage-reporter=lcov --coverage-dir={coverageDir}`. State that a bunfig `coverageDir` overrides that flag.

**Handoff.** 1415's surface-shape test includes `rule certify-coverage`, `check-coverage-cert` and `check-shims`.

**Anti-patterns.**
- No `--check`/`--start` mode flag.
- No spawning of the CLI from run-tests.
- No weakening of the byte binding or recovery messages.
- No preset that fails downstream projects lacking certification.

### Plan

- [x] 0. Consent closed (option 1, amendment 2 in satellite §5). No gate remains.
- [x] 1. Write a failing E2E `apps/cli/tests/commands/rule/a94-rule-checks.e2e.test.ts`:
  - check-shims: no manifest → 0; a broken ledger → 1 with `--json`;
  - check-coverage-cert: certified → 0; mutated lcov → 1; absent downstream → SKIP 0;
  - certify-coverage: `-- bun test … --coverage-dir={coverageDir}` on a mini fixture → certified 0; child exits 3 → 3 with the marker pending; a tree edited mid-run → 1 with a `stale-tree` refusal; missing `--` → 2; a custom `--lcov` publishes there and `check-coverage-cert --lcov` accepts it.

  (R1–R4)
- [x] 2. Move the services and tests into `packages/app/src/rules`, register the three verbs. (R1–R3)
- [x] 3. Add the two rule YAMLs, rewire `package.json:81`, reduce run-tests to import from spur-app. (R3–R5)
- [x] 4. Delete the scripts, add RETIRED entries, update A94. Receipt `.spur/run/1412-receipt.md`: a canonical `bun run test` certifies, `test-post-check` passes, and packed and standalone proofs pass. (all)

### Solution

**WHAT.** The two repository-only checks became shipped rule verbs: `spur rule check-shims` (two-sided ledger), `spur rule check-cert` family — `check-coverage-cert` (verify) and `certify-coverage -- <command>` (produce, two-phase in one call) — with the shim and certification services moved into `packages/app/src/rules/`. The repository launcher and post-check now call the verbs.

**WHY.** A shipped preset could not trust LCOV downstream and could not run the shim ledger at all: both lived in `scripts/commands/`, so a downstream project had no way to enforce provenance and the ledger could rot unnoticed.

**Change map** (one anchored row per file):

| Area | Anchor | Change |
| --- | --- | --- |
| certification service | packages/app/src/rules/coverage-certification.ts:33 | moved from `scripts/commands/`, `cwd` parameterized, TSDoc added, executor-based sync git read |
| two-phase verb body | packages/app/src/rules/coverage-certification.ts:392 | `certifyCommand({cwd, argv, lcov, run})`: fingerprint → child in the isolated dir → certify/publish |
| certified publish target | packages/app/src/rules/coverage-certification.ts:247 | `--lcov` publishes to the caller's path (parent created), default unchanged |
| child contract | packages/app/src/rules/coverage-certification.ts:352 | `SPUR_COVERAGE_DIR` + `{coverageDir}` token |
| ledger service | packages/app/src/rules/transition-shims.ts:196 | `checkShims({cwd, manifest, roots})` returns findings + a one-line summary; no console/exit in the app layer |
| app barrel | packages/app/src/index.ts:180 | exports both rule services and their types |
| rule noun | apps/cli/src/commands/rule/index.ts:19 | `rule.ts` became the `rule/` noun directory; registers the three verbs |
| shim verb | apps/cli/src/commands/rule/check-shims.ts:25 | exit 0/1/2 + findings envelope |
| verify verb | apps/cli/src/commands/rule/check-coverage-cert.ts:34 | `coverage-artifact:` diagnostic + recovery, envelope |
| produce verb | apps/cli/src/commands/rule/certify-coverage.ts:42 | `--` operand passthrough, child code/t 1 refusal/0 certified |
| boundary preset rule | config/rules/boundary/transition-shims.yaml:9 | `exit-code` evaluator, marker-guarded command, SKIP without a manifest |
| quality preset rule | config/rules/quality/coverage-cert.yaml:9 | same shape, SKIP without a certification |
| launcher | scripts/commands/run-tests.ts:37 | imports start/certify from `@gobing-ai/spur-app` (no subprocess hop) |
| post-check | package.json:81 | `test-post-check` runs `rule check-coverage-cert` |
| shim script | package.json:99 | `transition-shim-check` runs `rule check-shims` |
| dispatcher | scripts/spur-dev.ts:110 | two more RETIRED names; cases/imports/usage removed |
| inventory | docs/reports/A94-script-ownership.json:1 | 45 → 40 entries, caller anchors re-resolved |
| boundary rule | config/rules/strict/runtime-boundaries.yaml:88 | two fs-io exemptions (atomic marker publish/lock; recursive marker scan) |
| help page | docs/help/cmd_rule.md:17 | three verb sections with their flags |
| plugin help page | docs/help2/rule.md:17 | same three sections |
| prompt reference | plugins/sp/skills/spur-cli/references/rules.md:27 | command surface + the downstream `certify-coverage` example |
| env doc | docs/help/environment_variables.md:52 | `SPUR_COVERAGE_DIR` (per-run child contract) |
| surface matrix | docs/help/spur-cli-matrix.md:22 | `rule` 4 → 7 verbs, unique verbs 99 → 102, cells 126 → 129 |
| baseline fixtures | apps/cli/tests/fixtures/raw-json-baseline/rule-run.json:1 | recaptured (the boundary category gained a rule) |
| service tests | packages/app/tests/rules/coverage-certification.test.ts:1 | moved with the service; `certifyCommand`, `treeFingerprint` and the verb wiring covered |
| ledger tests | packages/app/tests/rules/transition-shims.test.ts:1 | moved with the service, now calling `checkShims` directly |
| transport tests | apps/cli/tests/commands/rule/check-shims.test.ts:1 | exit contracts, text/JSON/envelope renderings |
| transport tests | apps/cli/tests/commands/rule/check-coverage-cert.test.ts:1 | uncertified, certified and envelope branches |
| transport tests | apps/cli/tests/commands/rule/certify-coverage.test.ts:1 | certified, refused, child-failure and usage branches |

### Testing

**Pipeline verify results**

- Verdict: PASS (from verdict artifact)

| Requirement | Status | Evidence |
|-------------|--------|----------|
| R1 | MET | packages/app/src/rules/transition-shims.ts:196 `checkShims`; `bun apps/cli/src/index.ts rule check-shims` reports `1 marker(s) observed, 1 manifest entry baselined … PASS`; transport cases at apps/cli/tests/commands/rule/check-shims.test.ts |
| R2 | MET | packages/app/src/rules/coverage-certification.ts:392 `certifyCommand` (two-phase, `{coverageDir}` + `SPUR_COVERAGE_DIR`, `--lcov`); receipts cover certified / refused / child-exit-3 / missing-command |
| R3 | MET | apps/cli/src/commands/rule/check-coverage-cert.ts:34 exits 1 with `coverage-artifact:` + recovery and 0 when certified; package.json:81 routes `test-post-check` through it |
| R4 | MET | config/rules/boundary/transition-shims.yaml:9 and config/rules/quality/coverage-cert.yaml:9 use the `exit-code` evaluator with the marker-guarded command and SKIP downstream; `rule list` reports 81 rules (79 → 81); ts-rule-engine unchanged |
| R5 | MET | three scripts deleted (services + tests moved to packages/app); scripts/commands/run-tests.ts:37 imports from `@gobing-ai/spur-app`; RETIRED carries both retired names; inventory 45 → 40 |

| Acceptance Criteria | Status | Evidence Type | Evidence |
|---------------------|--------|---------------|----------|
| AC1 — Transition shim ledger is a downstream rule (req: R1) | MET | test | packages/app/tests/rules/transition-shims.test.ts (both directions, id shape, missing manifest) + apps/cli/tests/commands/rule/check-shims.test.ts (exit contract) |
| AC2 — Coverage provenance is enforceable downstream (req: R2, R3, R4) | MET | command | `rule certify-coverage -- sh -c 'exit 3'` → exit 3 and nothing certified; `rule check-coverage-cert` on a certified fixture → exit 0, on none → exit 1 with `coverage-artifact: missing` |
- Coverage: N/A (verdict-based; verify pipeline does not measure code coverage)

### Review

<!-- spur:record-review -->

**SECU findings** (pipeline verify step — verdict: PASS)

| Priority | Dimension | Location | Finding |
|----------|-----------|----------|----------|
| P4 | — | — | No findings (verify verdict PASS) |

### References

- Satellite §4 (check verbs, exit-code evaluator), §5 C5/C6 plus the 2026-11-20 shape amendment.
- Code: `scripts/commands/coverage-certification.ts:168,205`, `scripts/commands/run-tests.ts:39-40`, `config/rules/boundary/sp-script-placement.yaml`, `config/rules/quality/coverage-gate.yaml`, `package.json:81`.
- Upstream: 1410. Downstream: 1415.

### History

- 2026-11-20T16:25:03.583Z todo → wip (system)
- 2026-11-20T16:47:13.327Z wip → testing (system)
- 2026-11-20T16:47:14.504Z testing → done (system)

