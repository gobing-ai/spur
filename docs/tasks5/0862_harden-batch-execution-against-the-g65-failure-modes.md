---
schema_version: 1
name: Harden batch execution against the G65 failure modes
status: done
template: issue
created_at: 2026-09-15T20:37:23.908Z
updated_at: "2026-09-15T22:37:20.422Z"
feature_id: D6

ac_altitude: task-local
---

## 0862. Harden batch execution against the G65 failure modes

### Background

Session-review triage of the G65 batch (2026-09-15). Six tasks shipped and landed on `main` (`26d0df827`), but the
batch cost **6:49:31 of agent-active time** for roughly 2:00 of certified work. This task owns the
harness defects behind that bill. Scope follows the operator direction of the same day: simplify the
workflow and reduce corpus verification. Fix where a tool misreads the corpus or stays silent; do not
add checkpoints.

**Where the time went** (`.spur/run/worktree-runall-g65-ac87-batch-report.md`):

- **1:45 lost to three killed implement dispatches** — 0858 timed out twice and 0860 once at the
  30-minute host limit, each with a half-migrated tree that then needed host completion.
- **1:37 to three remediation hops** — 0857's constant-rendered member model, 0860's dropped `teamId`
  wire key, 0861's stale help-diagram node: all invisible to a green gate.
- **~0:56 to twelve quality-gate runs** plus three host diagnostics; one was a coverage-only red gate
  (`0 fail`, exit 1) with an empty findings file.
- The size precheck printed `PASS — 0 R-items, 0 Plan items` for 0858, a task with seven
  `- **R1** — …` requirements and a five-step Plan: its counter recognizes only `- [ ] R1.`.

**Premise corrections (verified against the tree):**

- **No D6 scenario is graduated here.** D6 `R1`/`R3` are delivered by 0607 and `R9` by 0781, all
  `done`, so the Acceptance Criteria are task-local.
- **A correct count alone would not have stopped 0858.** Since 0723 the precheck is count-only
  (10 requirements / 16 Plan items), so 0858 (7/5) and 0860 (5) pass when counted correctly.
  `execution-workflow.md` "Large tasks" item 3 and the `plugins/sp/README.md` precheck row still
  describe the removed capability-tier gate.
- **Stale-anchor warnings block nothing.** `L4.stale-line-anchor` is a warning outside the completion
  set; on recorded `## Testing` bodies it is noise on historical evidence.
- **The inline driver must validate a fresh proof digest** before record (0808 R4, 0809 R4) but has no
  documented command to compute one.

**Already resolved — not in scope here:** commit `0afd1405f` landed the C5 documentation half (the
`ac-style-guide` rule that a single-line `- **ACn — …**` criterion declares no id — R4 replaces that
rule with parsing) and the C10 documentation half (the inline driver's delegate-hygiene paragraph),
plus the review's carried documentation findings. Commit `d78ffdaf0` removed the stale `TeamSvc`
diagram node.

**Pointers, not owned here** (each needs its own owner decision): G65 cannot advance to `done` because
0857's verdict rows match no feature scenario and no `docs/dogfood/` artifact exists; the carried
product findings are the fleet snapshot's `enabled` misreporting a declared-but-unresolvable roster
(0858), the strategy default silently downgrading a persisted `gtd` row and a non-atomic reconcile
(0859), `getStatus()`'s zero callers and the dead Board Team column (0860), and the untested `task.`
activity prefix (0860).

**Evidence:** `.spur/run/worktree-runall-g65-ac87-{batch-report.md,verdicts/,reviews/}`;
`.spur/run/runall-g65-*-ac87.log` (dispatch boundaries and host-fallback provenance);
`.spur/run/refineall-g65-event-trace.md`.

### Requirements

Operator direction (2026-09-15): simplify the workflow and reduce corpus verification. Each requirement
either makes an existing tool read the corpus as it is written, deletes stale text or checks, or reuses
an existing surface. None adds a finding code, lint rule, repo check, report field or script.

- **R1** — The size precheck counts the house requirement form. Both counters
  (`packages/app/src/services/task-size-precheck.ts`, `plugins/sp/scripts/task-size-precheck.ts`)
  count distinct `- **Rn** —` and legacy `- [ ] Rn.` items in `Requirements`, and top-level numbered
  or checklist items in `Plan`; the 0858 shape (7 requirements, 5 numbered Plan steps) prints
  `7 R-items, 5 Plan items`. Limits (10 / 16), output format and exit contract are unchanged. The
  stale capability-tier gate text in `execution-workflow.md` ("Large tasks" item 3) and the
  `plugins/sp/README.md` precheck row is deleted.
- **R2** — A coverage-only quality-gate failure names its files. When `quality-gate.ts` sees a
  non-zero gate exit whose log reports `0 fail`, it writes one `path:line` shortfall line per
  coverage-table row below the `<cwd>/bunfig.toml` `coverageThreshold`, so the existing findings
  extraction picks them up. Real test failures, an absent threshold, the findings pattern and the
  always-exit-0 contract behave as today.
- **R3** — Line-anchor checking skips terminal records. `checkLineAnchors` emits nothing for `done`
  and `cancelled` tasks (historical evidence, ADR-092); live records keep today's path, bounds and
  subject checks. Recorded `## Testing` bodies stop producing `L4.stale-line-anchor` warnings once
  the task is done, with no record-time rewriting.
- **R4** — AC ids are read from the bold head of a single-line bullet. `verify-answer-lint`
  `buildAcIdentityIndex` declares the bold span of a `- **AC2 — Title.** Given …` bullet, and its
  head before ` — ` or `:`, as identities, so answer rows keyed `AC2` or by the bold title resolve.
  The `ac-style-guide.md` section "A single-line criterion bullet declares no id" shrinks to the
  rules that still bind.
- **R5** — The inline driver has one documented proof-capture command.
  `plugins/sp/scripts/inline-run-setup.ts` gains `--fingerprint --task-file <path> [--feature-file <path>]`,
  printing the engine digest (`sha256:<hex>`) from the exported proof-input functions;
  `inline-pipeline-driver.md` names it where `proofBinding: current` is validated. No new script,
  contract entry or `spur` verb.
- **R6** — Review catches wire-shape drift. `review-lenses.md` Correctness gains one bullet: a
  changed route response shape or client parser needs a server-side key-shape assertion and a
  real-payload-through-real-parser test; missing either is P2.

**Not doing** (decided 2026-09-15; reasons in Q&A):

- No new finding code or lint failure for AC id forms — the parser accepts the form instead (R4).
- No strict feature preflight in `refineall` — the batch 0510 preflight already stops a run on it.
- No mermaid label check in `spur-check` — the only instance was fixed in `d78ffdaf0`.
- No base-ref watch — the WT-4 fast-forward-only merge already halts when the base moved.
- No `Debris:` report field, run-log size line, 0727 cross-link, or `migrate-anchors` hint.
- No record-time anchor qualification — R3 removes the noise it targeted.
- No threshold or limit changes; no fixes for the pointer findings in Background.

### Acceptance Criteria

Task-local criteria (`ac_altitude: task-local`); each bullet's bold head — `AC1` … `AC6` — is its declared AC id.

- **AC1: both counters read the house requirement form.** A fixture with seven `- **Rn** —` requirements and five numbered Plan steps prints `7 R-items, 5 Plan items` and PASS from both counters; an 11-requirement fixture FAILs; a legacy `- [ ] R1.` item still counts; a prose line starting `R1 ` does not; neither `execution-workflow.md` nor `plugins/sp/README.md` describes an executor-capability or tier gate for the precheck.
- **AC2: a coverage-only quality-gate failure names its files.** A `runQualityGate` test whose command prints `0 fail` plus a coverage row below a 0.9 / 0.9 bunfig threshold and exits 1 produces a findings file containing that row's `path:line`; with a `1 fail` log or no bunfig threshold the findings are unchanged; `quality-gate.mjs` is regenerated and `bun run script-contract-check` passes.
- **AC3: terminal records are not re-checked.** A `done` fixture task citing a missing file in `## Testing` yields no `L4.stale-line-anchor`; the same citation on a `wip` task still does.
- **AC4: AC ids are read from the bold head of a single-line bullet.** A lint fixture whose AC section has `- **AC2 — The roster runtime is gone (R3).** Given …` accepts answer rows keyed `AC2` and `AC2 — The roster runtime is gone (R3).`; an undeclared `AC9` row still fails.
- **AC5: the inline driver has one documented proof-capture command.** `bun plugins/sp/scripts/inline-run-setup.ts --fingerprint --task-file <fixture>` prints the same `sha256:` digest as a direct `computeProofInputFingerprint` over the same temp git fixture; `inline-pipeline-driver.md` names the command.
- **AC6: review catches wire-shape drift.** `review-lenses.md` Correctness contains the wire-shape bullet with its P2 severity.

### Q&A

**Refine `--depth ready` (2026-09-15, inline, `--auto`), re-scoped the same day to the operator
direction "simplify the workflow and skip or reduce the corpus verification".** The first refine
(12 requirements, five slices) added checks. This entry replaces it and is the live decision record.

- **Q: Does 0862 graduate D6 scenarios?** — **Decided: no.** D6 R1/R3 are delivered by 0607 and R9 by
  0781, all `done`. AC is task-local.
- **Q: What keeps a requirement in scope?** — **Decided:** it deletes or loosens something, makes an
  existing tool read the corpus correctly, or reuses an existing surface. New finding codes, lints,
  repo checks, report fields and scripts are out.
- **Q: Undeclared single-line AC ids — a new `L3` warning plus a lint failure, or tolerant parsing?** —
  **Decided: tolerant parsing (R4)**; the style-guide rule shrinks.
- **Q: Record-time anchor qualification plus a `migrate-anchors` hint, or skip terminal records?** —
  **Decided: skip terminal records (R3).** It clears the warnings for every done task, not only future
  records, and leaves verifier output verbatim. `L4.stale-line-anchor` is a warning outside the
  completion set, so no transition depended on it. Reverses 0714 R1 for terminal records only.
- **Q: Strict feature preflight in `refineall`?** — **Decided: no.** The batch 0510 preflight already
  stops a run on the same findings.
- **Q: Mermaid retired-name check, base-ref watch, debris report field?** — **Decided: no.** The
  diagram defect was one-off and fixed; WT-4's fast-forward-only merge already halts on a moved base;
  `git status` at wrap shows debris.
- **Q: Should the size limits move, or admission estimate a dispatch budget?** — **Deferred — owner:
  operator.** 0858 (7 / 5) and 0860 (5) were killed below the 10 / 16 limits; three data points do
  not support a threshold. R1 only makes the count true.
- **Q: Inline proof capture — a new script, a mode on `inline-run-setup.ts`, or declaring proof binding
  not applicable inline (like `timeoutMs`)?** — **Decided: a `--fingerprint` mode (R5)**, the smallest
  change that keeps the 0785/0808/0809 inline certification contract. Dropping inline binding would
  relax that contract. **Deferred — owner: operator**; if accepted, R5 becomes a driver-doc deletion.
- **Q: Split the task?** — **Decided: no.** 6 requirements / 6 Plan steps is under the limits.

### Design

**Principles** (supersede the first refine's "no gate is weakened"). Prefer, in order: delete stale
text or checks → make the existing parser accept the form the corpus uses → reuse an existing script
or helper → only then add code. No new finding code, lint rule, repo check, report field, script,
contract-test file or `spur` verb. Thresholds stay (size 10 / 16, coverage 0.9 / 0.9). Tests extend
existing test files. One implement pass, no slices: 6 requirements / 6 Plan steps is under the limits
R1 makes real.

**R1 — size counting.** WHERE: `packages/app/src/services/task-size-precheck.ts` (`R_ITEM_RE` :39,
`countRItems`, `countPlanItems`) and the lockstep copy `plugins/sp/scripts/task-size-precheck.ts`
(:33; repo-only, no twin). WHAT: Requirements = body under `^#{2,3}\s+Requirements\s*$` to the next
`^#{2,3}\s` (no heading → whole content, as today); count distinct `n` over
`/^\s*[-*]\s+(?:\[[ xX]\]\s*)?[*_]{0,2}R(\d+)\.?[*_]{0,2}(?:\s|$)/gm` (list marker required; dedupe so
a continuation citing `R1` does not double-count). Plan = top-level `/^\d+\.\s/` plus
`/^\s*[-*]\s+\[[ xX]\]/` lines. Docs: in `execution-workflow.md` "Large tasks and timed-out implement
resume" item 3, delete the paragraph claiming the precheck resolves `capabilityTier` and blocks below
the `reviewer` floor, leaving one sentence: the gate is count-only (10 / 16), FAIL → split or a
`--vars` override; keep the executor-choice advice as advice. In `plugins/sp/README.md` (~505) drop
"+ size-vs-executor-capability gate (R3)". Tests: extend `plugins/sp/tests/task-size-precheck.test.ts`
and `packages/app/tests/services/task-size-precheck.test.ts`; update assertions that encoded the
legacy-only count. Handoff: the `task-service.ts` authoring warning uses the same service and starts
warning on >10-requirement tasks — expected.

**R2 — coverage findings.** WHERE: `plugins/sp/scripts/quality-gate.ts`; regenerate its `standard`
twin `quality-gate.mjs` with `superskill script convert`. WHAT: after the gate loop, before the
PASS/FAIL summary, only when `gateRc !== 0`, the log matches `/^\s*0 fail\b/m` and does not match
`/^\s*[1-9]\d*\s+fail\b/m`: read `<cwd>/bunfig.toml` and parse
`coverageThreshold = { lines = x, functions = y }` (a missing key leaves that axis unchecked; absent or
unparseable → do nothing). Scan rows `^\s*(\S+\.[A-Za-z]+)\s*\|\s*([\d.]+)\s*\|\s*([\d.]+)\s*\|\s*(\S*)`
(bun's `File | % Funcs | % Lines | Uncovered Line #s`), skip `All files`, keep rows below either axis
(×100), dedupe by path; write `quality gate: coverage shortfall <path>:<line> funcs=<f> lines=<l>` to
stdout and append to the log, `line` = first number of the uncovered column, else `1`. Two exported
pure helpers for the parse and the scan; no new module. Keep `FINDINGS_PATTERN`, `MAX_FINDINGS`, the
status verdict and exit 0. Tests: extend `plugins/sp/tests/quality-gate.test.ts`.

**R3 — terminal anchor skip.** WHERE: `packages/app/src/services/task-check.ts` `checkLineAnchors`
(~1455). WHAT: return before the section loop when `terminal`; delete terminal-only branches that
become dead; rewrite the method comment (terminal evidence is historical per ADR-092 — neither
existence nor bounds are re-checked). This reverses 0714 R1's "path existence and line bounds
regardless of status" for terminal records only; live-record behavior, `L4.anchor-subject-mismatch`
and the external-evidence form are untouched. Tests: in `packages/app/tests/services/task-check.test.ts`
add the `done` no-finding case, keep a live stale-anchor case, and flip any assertion that expected
terminal findings. Checker-policy change → one `bun run corpus-check` (T10); findings only disappear.

**R4 — bold-head AC ids.** WHERE: `plugins/sp/scripts/verify-answer-lint.ts` `buildAcIdentityIndex`
(:319). WHAT: one more loop over the AC section,
`/^[-*]\s+(?:\[[ xX]\]\s+)?\*\*(.+?)\*\*/gm` → `declareIdentity(inner)`, then
`head = inner.split(/\s+[—–]\s+|:/)[0]?.trim()`, declared when non-empty and different. Existing
loops, `normalizeAcTitle`, `resolveAcIdentity` and the AC-N rules are untouched; undeclared tokens
still fail. Docs: replace the `ac-style-guide.md` section "A single-line criterion bullet declares no
id" (~130) with three lines: the bold head of a bullet is its id; at least one answer row cites the
verbatim graduated feature scenario title; requirements keep the `- **R1** — …` form. Tests: extend
`plugins/sp/tests/verify-answer-lint.test.ts`.

**R5 — proof capture.** WHERE: `plugins/sp/scripts/inline-run-setup.ts` (reuse `resolveAppEntry` :91
and the argv loop :129); `packages/app/src/index.ts` adds `readProofInputContents` to the existing
`./workflow/proof-input-fingerprint` export block (~744); `inline-pipeline-driver.md` `run.artifact`
bullet (~208). WHAT: `--fingerprint --task-file <path> [--feature-file <path>] [--spur-bin <path>]`,
refused together with `--run-id`/`--file` (usage, exit 2). Import the app entry, call
`readProofInputContents(fs, cwd, { taskFile, featureFile })`, and on ok call
`computeProofInputFingerprint` with the options `ProofFingerprintActionRunner` (`builtins.ts:100`)
builds; print the digest, exit 0; read/resolve failure → exit 1. No `--expect`: the host compares the
string. Driver: "capture the fresh digest with `bun "$SETUP_SCRIPT" --fingerprint --task-file …
[--feature-file …]`". Tests: extend `plugins/sp/tests/inline-run-setup.test.ts` — stdout equals a
direct call over a temp git fixture. Anti-patterns: reimplementing the digest; a new script or verb.

**R6 — wire-shape lens.** WHERE: `plugins/sp/skills/code-review/references/review-lenses.md`
Correctness (13-23). One bullet with its P2 severity; no contract test.

### Plan

One pass; each step lands with its test failing first.

1. **R1** — widen both size counters and extend their tests (7/5 PASS, 11 FAIL, legacy form, prose
   `R1`); delete the stale tier-gate text in `execution-workflow.md` item 3 and the README row.
2. **R2** — coverage-shortfall lines in `quality-gate.ts` with tests; regenerate `quality-gate.mjs`.
3. **R3** — early return for terminal records in `checkLineAnchors`; adjust task-check tests.
4. **R4 + R6** — bold-head identities in `verify-answer-lint.ts` with tests; shrink the style-guide
   section; add the review-lens bullet.
5. **R5** — `--fingerprint` mode in `inline-run-setup.ts`, the `readProofInputContents` export, the
   driver sentence and the digest-equality test.
6. **Gates** — focused workspace tests, then `bun run spur-check`, `bun run corpus-check` once (R3 is a
   checker-policy change, T10), and `spur task check 0862 --json`.

### Root Cause

The G65 bill traces to tools that misread the corpus as it is written, or stay silent, rather than to
missing checks:

1. **The size counter reads zero.** It matches only the legacy `- [ ] Rn.` form, and the docs still
   promise the capability-tier gate that 0723 removed.
2. **A coverage-only failure is silent.** `bun test` exits 1 with `0 fail`; `quality-gate.ts` builds
   findings only from `file.ext:line` anchors, so the fix hop gets an empty findings file.
3. **Terminal records are re-verified.** `checkLineAnchors` re-checks path existence on `done` tasks,
   so every recorded `## Testing` body that quotes verifier basenames becomes permanent warning noise.
4. **The AC parser rejects the natural form.** A single-line `- **ACn — …**` bullet declares no id, so
   answer rows lose their key; a style-guide rule was added to compensate instead of fixing the parser.
5. **The inline driver must validate a digest it has no way to compute**, so it improvised a script.
6. **Review has no lens for server/client wire-shape drift** (0860's dropped `teamId` key).

The remaining G65 frictions (refineall preflight, the retired diagram name, base-ref movement,
delegate debris) are either caught at one existing checkpoint or were one-off. Adding a second
checkpoint for each is the verification growth this task declines.

### Solution

Both size counters read the requirement form the corpus is written in, a coverage-only gate failure names its files, terminal records stop being re-checked, the AC parser declares a bullet's bold head, the inline driver can capture the proof digest it validates, and the review lens covers wire-shape drift.

Implement step did not author this change map: it is written after record from the reviewed diff, one anchor per row (each row's cited line names its subject).

| Change | Anchor |
| --- | --- |
| Requirement item pattern: one list marker required, an optional checkbox, the R-number in the house or legacy form | `packages/app/src/services/task-size-precheck.ts:36-38` |
| Same counting in the lockstep plugin copy | `plugins/sp/scripts/task-size-precheck.ts:36` |
| Plan items: top-level numbered steps plus checklist items under the Plan heading | `packages/app/src/services/task-size-precheck.ts:53` |
| `countRItems` deduped by number, scoped to the Requirements section | `packages/app/src/services/task-size-precheck.ts:66` |
| House 7/5 shape, prose `R1` non-match and over-ceiling fail-closed tests | `packages/app/tests/services/task-size-precheck.test.ts:216` |
| Same through the shipped script: `PASS — 7 R-items, 5 Plan items` | `plugins/sp/tests/task-size-precheck.test.ts:180` |
| Stale capability-tier claim deleted from the size-gate paragraph | `plugins/sp/skills/spur-dev/references/execution-workflow.md:330` |
| Precheck row no longer claims a size-vs-executor-capability gate | `plugins/sp/README.md:505` |
| bun coverage-table row pattern for shortfall extraction | `plugins/sp/scripts/quality-gate.ts:60` |
| `coverageThreshold` parser: per-axis floors, absent setting means no scan | `plugins/sp/scripts/quality-gate.ts:121` |
| One coverage shortfall line per distinct table row below either axis | `plugins/sp/scripts/quality-gate.ts:133-136` |
| Coverage-only failures carry no anchor, so findings extraction would hand the fix hop an empty file | `plugins/sp/scripts/quality-gate.ts:235-236` |
| a coverage-only failure names the under-threshold row as a findings anchor | `plugins/sp/tests/quality-gate.test.ts:247` |
| Terminal records (`done`/`cancelled`) are not checked at all | `packages/app/src/services/task-check.ts:1450-1451` |
| Done and cancelled fixtures silent, live stale-anchor reporting retained | `packages/app/tests/services/task-check.test.ts:3542` |
| Bold head of a single-line criterion bullet: the bold span and its head are declared ids | `plugins/sp/scripts/verify-answer-lint.ts:335-337` |
| Declared AC identities keyed by canonical normalized title, plus the AC-N ordinal sources | `plugins/sp/scripts/verify-answer-lint.ts:306-307` |
| Lint fixture for the bold-head identities and the undeclared `AC9` negative | `plugins/sp/tests/verify-answer-lint.test.ts:614` |
| Style guide section replaced by the bold-head rule | `plugins/sp/skills/spur-dev/references/ac-style-guide.md:130` |
| `argv[i]`: `--run-id`, `--file`, `--fingerprint`, `--task-file`, `--feature-file`, `--spur-bin` | `plugins/sp/scripts/inline-run-setup.ts:189-194` |
| async function printFingerprint(taskFile, featureFile, spurBin) | `plugins/sp/scripts/inline-run-setup.ts:141` |
| `readProofInputContents` exported from the app barrel for the capture delegate | `packages/app/src/index.ts:753` |
| export async function readProofInputContents fileSystem FileSystem | `packages/app/src/workflow/proof-input-fingerprint.ts:147-148` |
| Digest-equality test against a direct `computeProofInputFingerprint` call | `plugins/sp/tests/inline-run-setup.test.ts:244` |
| `proofBinding: current` is honored against a freshly captured proof digest — capture it with --fingerprint | `plugins/sp/skills/spur-dev/references/inline-pipeline-driver.md:208-209` |
| Correctness lens: key-shape assertion and real-payload parser test, either missing is P2 | `plugins/sp/skills/code-review/references/review-lenses.md:23` |

### Testing

**Pipeline verify results**

- Verdict: PASS (from verdict artifact)

| Requirement | Status | Evidence |
|-------------|--------|----------|
| R1 | MET | Both counters widened in `packages/app/src/services/task-size-precheck.ts:41-90` and the lockstep `plugins/sp/scripts/task-size-precheck.ts:36-72`. Fresh reproduction: `bun plugins/sp/scripts/task-size-precheck.ts 0862` prints `PASS — 6 R-items, 6 Plan items`; fixture probes through the same script give the house 7-requirement / 5-numbered-step shape `PASS — 7 R-items, 5 Plan items`, an 11-requirement fixture `FAIL — 11 R-items`, a legacy `- [ ] R1.` fixture `2 R-items`, and a prose `R1 ...` line `0 R-items`; the service agrees (`evaluateTaskSize` ok=true / ok=false at `packages/app/src/services/task-size-precheck.ts:66-90`). Tests: `plugins/sp/tests/task-size-precheck.test.ts:180,192` (7/5 PASS, prose not counted) and `packages/app/tests/services/task-size-precheck.test.ts:216,224` (house 7/5 passes, over-ceiling fails closed). Stale tier-gate text deleted: `plugins/sp/skills/spur-dev/references/execution-workflow.md:331` is now count-only and `plugins/sp/README.md:505` reads `Pipeline size precheck guard (R2)`. Limits stay 10/16 (`task-size-precheck.ts:31-32`); output format and exit contract unchanged. |
| R2 | MET | `plugins/sp/scripts/quality-gate.ts:60` (COVERAGE_ROW_PATTERN), `:121-160` (parseCoverageThreshold + scanCoverageShortfalls), `:237-247` (trigger block, before `extractFindings` at `:260`). Tests `plugins/sp/tests/quality-gate.test.ts:247` (0 fail + coverage row + exit 1 yields a findings file carrying `src/short.ts:12`), `:266` (1 fail leaves findings unchanged), `:281` (no bunfig threshold unchanged), `:294,304` (both helpers). Regenerated twin: `bun run script-contract-check` prints `24 script(s) baselined (12 standard, 12 repo-only), 0 violation(s) — PASS`, and a fresh `superskill script convert sp quality-gate.ts` produced a byte-identical `plugins/sp/scripts/quality-gate.mjs` (sha256 462266148d285affdd5be2b49ebfa9775b420e86c4092c0b71df7aa84558c205 before and after). |
| R3 | MET | `packages/app/src/services/task-check.ts:1468-1469` returns before the section loop for `done`/`cancelled`; the dead terminal branch is gone. Fresh tests: `packages/app/tests/services/task-check.test.ts:3556,3568,3580` (done and cancelled citations yield no `L4.stale-line-anchor`) and `:3665,3678` (a live record still reports the missing path and out-of-range line); whole file 178 pass / 0 fail. Corpus-wide: `bun run corpus-check` exits 1 on 377 pre-existing findings (248 scenario-unverified, 60 evidence-not-recoverable, 41 dogfood-missing, 28 verdict-rows-match-no-scenario) with 0 `L4.stale-line-anchor`. |
| R4 | MET | `plugins/sp/scripts/verify-answer-lint.ts:338-344` declares the bold span of a single-line criterion bullet and its head before ` — ` / `:`. Fixture probe over `- **AC2 — The roster runtime is gone (R3).** ...`: rows keyed `AC2` and `AC2 — The roster runtime is gone (R3).` both PASS (exit 0); `AC9` FAILs (exit 1). Tests `plugins/sp/tests/verify-answer-lint.test.ts:615,621,631`; whole file 39 pass / 0 fail. Docs: `plugins/sp/skills/spur-dev/references/ac-style-guide.md:130-137` now carries `### A bullet's bold head is its id`. |
| R5 | MET | `plugins/sp/scripts/inline-run-setup.ts:141-180` adds the `--fingerprint` mode (refused with `--run-id`/`--file` via `usage()` exit 2 at `:199-201`), `packages/app/src/index.ts:753` exports `readProofInputContents`, and `packages/app/src/workflow/proof-input-fingerprint.ts:148` adds the Node-FS default. Fresh live run: `bun plugins/sp/scripts/inline-run-setup.ts --fingerprint --task-file docs/tasks5/0862_harden-batch-execution-against-the-g65-failure-modes.md --feature-file docs/features/D6_workflow-cost-deterministic-ownership-surface-and-role-addressed-coordination.md` prints `sha256:8c9859f5ed6115fc7c258c6bbf87702099217b81a97df69fd3142b378b1cbd0f`, identical to the `proof-digest:` line of `.spur/run/0862-test-gate.log`. Tests `plugins/sp/tests/inline-run-setup.test.ts:244,269,281` (9 pass / 0 fail). Driver doc: `plugins/sp/skills/spur-dev/references/inline-pipeline-driver.md:209-211` names the command. |
| R6 | MET | `plugins/sp/skills/code-review/references/review-lenses.md:21-23` — the Correctness lens now carries the wire-shape bullet requiring a server-side key-shape assertion plus a real-payload-through-real-parser test and closes `Missing either → P2.` |

| Acceptance Criteria | Status | Evidence Type | Evidence |
|---------------------|--------|---------------|----------|
| AC1 | MET | test | House-form fixture (7 `- **Rn** —` requirements, 5 numbered Plan steps) prints `7 R-items, 5 Plan items` and PASS from the script and `ok: true` from the service; an 11-requirement fixture FAILs; a legacy `- [ ] R1.` fixture counts 2; a prose `R1 ...` line counts 0. Tests `plugins/sp/tests/task-size-precheck.test.ts:180,192` and `packages/app/tests/services/task-size-precheck.test.ts:216,224`; both stale tier-gate descriptions are gone (`execution-workflow.md:331`, `plugins/sp/README.md:505`). |
| AC2 | MET | test | `plugins/sp/tests/quality-gate.test.ts:247` — a `runQualityGate` fixture whose command prints `0 fail` plus a coverage row below a 0.9/0.9 bunfig threshold and exits 1 writes a findings file containing `src/short.ts:12`; `:266` (`1 fail`) and `:281` (no threshold) leave findings unchanged. `quality-gate.mjs` regenerates byte-identically and `script-contract-check` PASSes. |
| AC3 | MET | test | `packages/app/tests/services/task-check.test.ts:3556,3580` — a `done` and a `cancelled` fixture citing a missing file in `## Testing` yield no `L4.stale-line-anchor`, while `:3665,3678` show the same citation on a live record still reporting; corpus-wide count of the code is 0. |
| AC4 | MET | test | Lint fixture with `- **AC2 — The roster runtime is gone (R3).** Given ...` accepts answer rows keyed `AC2` and the full bold title, and an undeclared `AC9` row fails; `plugins/sp/tests/verify-answer-lint.test.ts:615,621,631`. |
| AC5 | MET | test | `plugins/sp/tests/inline-run-setup.test.ts:244` asserts `bun plugins/sp/scripts/inline-run-setup.ts --fingerprint --task-file <fixture>` prints the same digest as a direct `computeProofInputFingerprint` over the same temp git fixture; the live command prints `sha256:8c9859f5ed6115fc7c258c6bbf87702099217b81a97df69fd3142b378b1cbd0f`, matching `.spur/run/0862-test-gate.log`; `inline-pipeline-driver.md:209-211` names it. |
| AC6 | MET | command | `grep -n "Missing either" plugins/sp/skills/code-review/references/review-lenses.md` returns `23:  must fail something). Missing either → P2.` inside the new Correctness wire-shape bullet at `plugins/sp/skills/code-review/references/review-lenses.md:21-23`. |
- Coverage: N/A (verdict-based; verify pipeline does not measure code coverage)

### Review

#### Review Report — 0862 (Harden batch execution against the G65 failure modes) — post-remediation re-run

**Scope:** uncommitted worktree diff (`git diff`; no untracked files) — 21 files, +715 / −98: 20 code/doc files +647 / −88 (byte-identical to the tree the previous review read) and the corpus file `docs/tasks5/0862_harden-batch-execution-against-the-g65-failure-modes.md` +68 / −10, whose only content change since that review is the AC rewrite `- [ ] Rn: <text>` → `- **ACn: <head>.** <text>` plus this report.
**Dimensions:** functional traceability (R1–R6), SECUA (security, efficiency, correctness, usability, architecture) via `plugins/sp/skills/code-review/references/review-lenses.md`, architecture depth.
**Verdict:** PASS — all six requirements and all six AC blocks are MET on fresh evidence; no P1/P2 finding, so the gate is not blocked. 4 P3 + 6 P4 findings are recorded for disposition.

##### Findings (ranked)

| # | Priority | Dimension | Finding | Location |
|---|----------|-----------|---------|----------|
| 1 | P3 (minor) | usability | An AC row keyed by the bold head **minus the sentence-final period** is still rejected (exit 1) while `AC1` and the verbatim bold span resolve; the failure hint lists only the pre-0862 accepted forms, so the bold-head form R4 adds is invisible from the diagnostic. Fresh probe over this task's rewritten ACs: `AC1` PASS, `AC1: both counters read the house requirement form` (no period) FAIL, `AC9` FAIL, `AC-1` PASS. | `plugins/sp/scripts/verify-answer-lint.ts:335-344` (head split `:342`); hint `:502-505` |
| 2 | P3 (minor) | usability | The documented capture command names neither invariant the digest depends on: cwd must be the worktree root (`workdir = process.cwd()` feeds the git-tree half) and `--feature-file` must be the spec the pipeline folded in. Fresh: omitting `--feature-file` prints `sha256:34b512c28e1fc25b8887609b343c6a858143dd10ccf1aa60da7b46019819f238` against the gate's `sha256:8c9859f5…`; a non-worktree cwd fails closed. The mismatch surfaces later as a refused `run.artifact` registration — the hop this task set out to remove. | `plugins/sp/scripts/inline-run-setup.ts:141-176`; `plugins/sp/skills/spur-dev/references/inline-pipeline-driver.md:209-211` |
| 3 | P3 (minor) | traceability | Plan step 6's T10 evidence is still missing: no `bun run corpus-check` artifact exists in `.spur/run/` (the green `spur-check` chain does not include it). Review re-ran it: exit 1 on 377 pre-existing L4 findings (248 `scenario-unverified`, 60 `evidence-not-recoverable`, 41 `dogfood-missing`, 28 `verdict-rows-match-no-scenario`), **0** `L4.stale-line-anchor` — R3's "findings only disappear" claim holds corpus-wide. | `.spur/run/` (no corpus-check artifact); task Plan step 6 |
| 4 | P3 (minor) | traceability | **New this re-run.** The pre-remediation answer artifact is now stale against the rewritten corpus: `.spur/run/0862-verify-answer.txt` still holds `Verdict: PARTIAL` and six AC rows keyed `R<n>: <old bullet text>`; linting that exact path today gives `verify-answer-lint: FAIL — 6 finding(s)`, exit 1. The verify contract is append-in-place (`Verdict: PARTIAL` first, then one row at a time) and the pipeline lints precisely this path, so a verify re-run that appends instead of rewriting reproduces the hard halt that caused this remediation hop. The file is gitignored/ephemeral: delete or truncate it before the verify stage. | `.spur/run/0862-verify-answer.txt:18-23`; append contract `plugins/sp/skills/code-verification/SKILL.md:312-315`; linted path `config/workflows/task-pipeline.yaml:484,501` |
| 5 | P4 (advisory) | architecture | R5 still builds two mirrors instead of reusing a contract: `readProofInputContents` gained a Node-FS default parameter (an app API change outside the Design's WHERE list) so the script can pass `undefined`, and the script re-declares the app module's option/return types in a hand-written cast — a silent-drift surface if the app signature moves. The default does mirror `createGitAlternateTree`'s existing precedent. | `packages/app/src/workflow/proof-input-fingerprint.ts:148`; `plugins/sp/scripts/inline-run-setup.ts:150-153,162` |
| 6 | P4 (advisory) | correctness | R2's trigger is broader than "coverage-only": any non-zero gate exit whose log contains `0 fail` runs the shortfall scan, so a post-test rule failure would emit coverage lines too (latent: sweep of the real gate log finds 0 rows below the 0.9 floor). Separately, `parseCoverageThreshold` returns `null` for a scalar bunfig and compares a percent-form threshold as a fraction — fresh probes: `coverageThreshold = 0.9` → `null`; `{ lines: 90 }` against a `20.00` row reports that row. | `plugins/sp/scripts/quality-gate.ts:237-247`; `:121-134` |
| 7 | P4 (advisory) | correctness | The widened counters newly push 12 historical records past a ceiling (9 requirement, 3 plan — e.g. `docs/tasks/0007_…` Plan 0→43), all `done`/`cancelled`; 0 live tasks affected. A repair or refine re-run on one of them now FAILs the precheck without a `--vars` override. Fresh sweep over 863 task docs: 203 requirement-count and 320 plan-count changes. | `packages/app/src/services/task-size-precheck.ts:41-90` |
| 8 | P4 (advisory) | traceability | Still a contract deviation, non-blocking: `## Solution` is a bare placeholder in a `wip` task whose implement stage completed, so the change-map will come from the record step's `git diff --name-only` backfill rather than the authored `file:line` table. `## Testing` is legitimately empty (record owns it). `spur task check 0862` → `pass: true`. | task `## Solution` (line 259), `## Testing` (line 263) |
| 9 | P4 (advisory) | usability | `usage()` still moves the pre-existing create/attach mode's exit code 1 → 2; R5 asked for exit 2 only in the new mode. No caller, test or doc depends on 1 (repo-wide grep: none) and the driver contract requires only non-zero. Fresh: mixed `--fingerprint … --run-id …` → exit 2; unreadable task file in the new mode → exit 1. | `plugins/sp/scripts/inline-run-setup.ts:60-67` |
| 10 | P4 (advisory) | correctness | **New this re-run.** The AC-N positional alias still credits feature scenarios this task explicitly does not graduate: with the rewritten AC section `featureScenarios` is D6's list, so rows keyed `AC-1`…`AC-6` resolve (fresh probe: lint PASS) to D6 scenarios 1–6, while Background says `No D6 scenario is graduated here` and the task is `ac_altitude: task-local`. Author the verify rows as `AC1`…`AC6` (the declared bold heads) so a PASS cannot durably credit D6 R1–R6. | `plugins/sp/scripts/verify-answer-lint.ts:380-410` (alias path `:385`), `:361`; task Background line 36 |

##### Functional Traceability

| Req | Status | Evidence |
|-----|--------|----------|
| R1 | MET | Both counters widened (`packages/app/src/services/task-size-precheck.ts:41-90`, lockstep `plugins/sp/scripts/task-size-precheck.ts:30-72`); fresh `task-size-precheck 0862` → `PASS — 6 R-items, 6 Plan items`; focused suites cover house 7/5 PASS, 11-requirement FAIL, legacy `- [ ] R1.`, prose `R1 …`, dedupe and section scoping. Stale tier-gate text deleted (`execution-workflow.md:331` now only denies the tier read; `plugins/sp/README.md:505` reads `Pipeline size precheck guard (R2)`); repo grep finds no remaining capability-tier claim. Limits, output format and exit contract untouched. |
| R2 | MET | `plugins/sp/scripts/quality-gate.ts:56-62, 121-160, 237-247` + regenerated twin `quality-gate.mjs`; `bun run script-contract-check` → `24 script(s) baselined (12 standard, 12 repo-only), 0 violation(s) — PASS` (fresh). Tests in `plugins/sp/tests/quality-gate.test.ts` cover the coverage-only fixture, the `1 fail` case, the missing-threshold case and both pure helpers (93 focused tests pass); fresh helper sweep on the real gate log yields 0 shortfalls below the 0.9 floor, i.e. the feature is inert on a green log. |
| R3 | MET | `packages/app/src/services/task-check.ts:1469` returns before the section loop for `done`/`cancelled` and the now-dead terminal branch is deleted. Fresh: `bun test packages/app/tests/services/task-check.test.ts` → 178 pass / 0 fail, `-t "terminal records are not re-checked"` → 4 pass, the two live stale-anchor cases → 2 pass. `bun run corpus-check` → 0 `L4.stale-line-anchor` corpus-wide. |
| R4 | MET | `plugins/sp/scripts/verify-answer-lint.ts:335-344` declares the bold span and its head before ` — `/`:`; `plugins/sp/tests/verify-answer-lint.test.ts:596-637` covers head key, verbatim bold title and the undeclared `AC9` refusal (fresh: 93-pass run). `ac-style-guide.md:130-137` shrank to `A bullet's bold head is its id`. |
| R5 | MET | `plugins/sp/scripts/inline-run-setup.ts:133-180` `--fingerprint` (mixed invocation → exit 2, unreadable task file → exit 1, no `--expect`); `packages/app/src/index.ts:753` exports `readProofInputContents`; `packages/app/src/workflow/proof-input-fingerprint.ts:148` adds the Node-FS default. Fresh live run reproduces the gate digest byte-for-byte (below); `plugins/sp/tests/inline-run-setup.test.ts` → 9 pass / 0 fail; `inline-pipeline-driver.md:209-211` names the command. |
| R6 | MET | `plugins/sp/skills/code-review/references/review-lenses.md:21-23` — the Correctness wire-shape bullet requires both a server-side key-shape assertion and a real-payload-through-real-parser test and closes `Missing either → P2.` |

| AC | Status | Evidence |
|----|--------|----------|
| AC1 | MET | House-form fixture 7 R-items / 5 numbered Plan steps → `ok: true` from the service and `PASS — 7 R-items, 5 Plan items` from the script; 11-requirement fixture FAILs; legacy item counts; prose line does not; both doc deletions re-checked by grep (fresh focused suite: 93 pass / 0 fail). |
| AC2 | MET | Coverage-only fixture (`0 fail`, coverage row, exit 1, 0.9/0.9 bunfig) produces a findings file carrying that row's `path:line`; `1 fail` and no-threshold runs are unchanged (`plugins/sp/tests/quality-gate.test.ts:246-320`); `quality-gate.mjs` regenerated and `script-contract-check` PASS (fresh). |
| AC3 | MET | `done` fixture citing a missing file yields no `L4.stale-line-anchor` (4 terminal cases pass), while the same citation on a `wip` task still does (2 live cases pass); corpus-wide `L4.stale-line-anchor` count is 0. |
| AC4 | MET | Fixture `- **AC2 — The roster runtime is gone (R3).** …` accepts rows keyed `AC2` and the verbatim bold title, and an undeclared `AC9` row still fails (3 new fixture tests; 93-pass run). |
| AC5 | MET | `--fingerprint` prints the same digest as a direct `computeProofInputFingerprint` over the same temp git fixture (`plugins/sp/tests/inline-run-setup.test.ts:244`; 9 pass / 0 fail) and reproduces the live gate digest; `inline-pipeline-driver.md:209-211` names the command. |
| AC6 | MET | `review-lenses.md:21-23` carries the wire-shape bullet with its P2 severity. |

##### Verification performed (fresh, this re-run)

- **Proof binding (closes the "did the corpus edit invalidate the gate" question):** `bun plugins/sp/scripts/inline-run-setup.ts --fingerprint --task-file docs/tasks5/0862_harden-batch-execution-against-the-g65-failure-modes.md --feature-file docs/features/D6_workflow-cost-deterministic-ownership-surface-and-role-addressed-coordination.md` → `sha256:8c9859f5ed6115fc7c258c6bbf87702099217b81a97df69fd3142b378b1cbd0f`, identical to the `proof-digest:` line of `.spur/run/0862-test-gate.log` (`8353 pass / 0 fail`, 472 files, status `PASS`). The review therefore reads exactly the tree and folded specs (Background/Requirements/AC/Design/Plan) the green gate certified — the AC rewrite is the only spec-side delta and it re-ran green.
- **AC-identity remediation (the reason for this re-run):** `bun plugins/sp/scripts/verify-answer-lint.ts 0862 --answer <probe>` with rows keyed `AC1`…`AC6` → `PASS — 6 requirement row(s), 6 AC row(s), verdict PASS` (exit 0). The old keys `R1`…`R6` → `FAIL — 6 finding(s)` (the pre-remediation form), `AC9` → refused, `AC-1`…`AC-6` → PASS (finding 10).
- **Focused suites:** `plugins/sp/tests/{task-size-precheck,quality-gate,verify-answer-lint}.test.ts` + `packages/app/tests/services/task-size-precheck.test.ts` → 93 pass / 0 fail; `packages/app/tests/services/task-check.test.ts` → 178 pass / 0 fail; `plugins/sp/tests/inline-run-setup.test.ts` → 9 pass / 0 fail.
- **Corpus policy (R3):** `bun run corpus-check` → exit 1 on 377 pre-existing findings, 0 `L4.stale-line-anchor`.
- **Counter sweep (finding 7):** 863 task docs re-evaluated with the shipped service — 203 requirement-count and 320 plan-count changes, 9 requirement + 3 plan newly over a ceiling, all `done`/`cancelled`, 0 live.
- **Stale artifact (finding 4):** `bun plugins/sp/scripts/verify-answer-lint.ts 0862 --answer .spur/run/0862-verify-answer.txt` → `FAIL — 6 finding(s)`, exit 1.
- **Structural:** `spur task check 0862 --json` → `pass: true`, no findings; `bun run script-contract-check` → 24 scripts, 0 violations.

##### Previous findings: status

- **Closed:** none of the eight findings recorded by the previous review — the code diff is unchanged, so all eight re-reproduce (rows 1, 2, 3, 5, 6, 7, 8, 9 above keep their original numbering and severity; row 8's numbering shifts by one because finding 4 is new).
- **Closed by this corpus edit:** the previous **verify-stage P2** (`plugins/sp/scripts/verify-answer-lint.ts:294` — `normalizeAcTitle` stripping the checklist label `R<n>` to an empty key, so every honest answer row for this task's ACs halted the lint). The rewritten bold-head ACs now resolve: `AC1`…`AC6` keys lint clean (probe above), and the same defect is what rows 1 and 10 now bound.

##### Residual Risk

- R3 stops terminal anchor re-verification outright (ADR-092 applied to the whole check): a `done` record may cite evidence that never existed. Coarser terminal checks survive at the corpus layer (`L4.evidence-not-recoverable`, observed in this run) and live records keep every check — a real but bounded loosening.
- R4 declares more than AC ids: any AC-section bullet whose first content is bold declares that span and its head, so `- **R1**: …` declares `r1` and non-id bold heads declare keys. Intended by the design, yet it widens acceptance rather than only adding forms.
- R2 findings stay capped at `MAX_FINDINGS = 20` (pre-existing): a large coverage failure hands the fix hop the first 20 anchors.
- R1's counters are shape-sensitive in both directions: a Requirements continuation bullet beginning `R<n>` counts toward the ceiling, and requirements carrying sub-ids (`- R1.1 …`) are not counted at all.
- The rewritten AC ids are task-local by decision (`ac_altitude: task-local`, Background: `No D6 scenario is graduated here`), so 0862 credits no D6 scenario — intended, and unchanged by the edit.
- Findings 1–4 are worth a small follow-up before the next batch run; finding 4 is free to clear now.
- No P1/P2 finding, so this verdict does not block the gate.

**Next:** none blocking — proceed to verify; delete `.spur/run/0862-verify-answer.txt` first (finding 4) and carry findings 1–3 into a follow-up task.

### References

- Evidence: `.spur/run/worktree-runall-g65-ac87-batch-report.md`, `.spur/run/refineall-g65-event-trace.md`
- Size gate: `plugins/sp/scripts/task-size-precheck.ts`, `packages/app/src/services/task-size-precheck.ts`, `config/workflows/task-pipeline.yaml` (`maxImplementReqs`, `maxImplementPlanItems`)
- Quality gate: `plugins/sp/scripts/quality-gate.ts`, `bunfig.toml` (`coverageThreshold`)
- Anchors: `packages/app/src/services/task-check.ts` `checkLineAnchors` (0584, 0714); ADR-092
- AC ids: `plugins/sp/scripts/verify-answer-lint.ts` (0804 R4, 0817 R3), `plugins/sp/skills/spur-dev/references/ac-style-guide.md`
- Proof: `plugins/sp/scripts/inline-run-setup.ts`, `packages/app/src/workflow/proof-input-fingerprint.ts`, `packages/app/src/workflow/actions/proof-fingerprint.ts`, `plugins/sp/skills/spur-dev/references/inline-pipeline-driver.md` (0785, 0808 R4, 0809 R4)
- Docs: `plugins/sp/skills/spur-dev/references/execution-workflow.md`, `plugins/sp/README.md`, `plugins/sp/skills/code-review/references/review-lenses.md`
- Commits: `0afd1405f` (C5/C10 doc halves), `d78ffdaf0` (TeamSvc diagram), `26d0df827` (G65 merge)
- Related tasks: 0583, 0607, 0714, 0723, 0781, 0785, 0808, 0809, 0817

### History

- 2026-09-15T21:47:12.109Z todo → wip (system)
- 2026-09-15T22:35:36.848Z wip → testing (system)
- 2026-09-15T22:37:20.422Z testing → done (system)

