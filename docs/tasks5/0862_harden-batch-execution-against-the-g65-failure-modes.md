---
schema_version: 1
name: Harden batch execution against the G65 failure modes
status: todo
template: issue
created_at: 2026-09-15T20:37:23.908Z
updated_at: "2026-09-15T21:20:34.315Z"
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

Task-local criteria (`ac_altitude: task-local`); each checklist label is the declared AC id.

- [ ] R1: a fixture with seven `- **Rn** —` requirements and five numbered Plan steps prints `7 R-items, 5 Plan items` and PASS from both counters; an 11-requirement fixture FAILs; a legacy `- [ ] R1.` item still counts; a prose line starting `R1 ` does not; neither `execution-workflow.md` nor `plugins/sp/README.md` describes an executor-capability or tier gate for the precheck.
- [ ] R2: a `runQualityGate` test whose command prints `0 fail` plus a coverage row below a 0.9 / 0.9 bunfig threshold and exits 1 produces a findings file containing that row's `path:line`; with a `1 fail` log or no bunfig threshold the findings are unchanged; `quality-gate.mjs` is regenerated and `bun run script-contract-check` passes.
- [ ] R3: a `done` fixture task citing a missing file in `## Testing` yields no `L4.stale-line-anchor`; the same citation on a `wip` task still does.
- [ ] R4: a lint fixture whose AC section has `- **AC2 — The roster runtime is gone (R3).** Given …` accepts answer rows keyed `AC2` and `AC2 — The roster runtime is gone (R3).`; an undeclared `AC9` row still fails.
- [ ] R5: `bun plugins/sp/scripts/inline-run-setup.ts --fingerprint --task-file <fixture>` prints the same `sha256:` digest as a direct `computeProofInputFingerprint` over the same temp git fixture; `inline-pipeline-driver.md` names the command.
- [ ] R6: `review-lenses.md` Correctness contains the wire-shape bullet with its P2 severity.

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

<!-- Filled during implementation: file:line change map and concise rationale. -->

### Testing

<!-- Filled during verification: regression command(s), outcomes, coverage claim or N/A. -->

### Review

<!-- Filled during review: P1-P4 findings, residual risk, and final disposition. -->

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
