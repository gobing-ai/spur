---
template: review
schema_version: 1
name: "Fix sp-dev-pr-review dogfood findings (P1/P2) + spur-dev slowness levers (P3)"
description: ""
status: done
type: review
profile: standard
feature_id: H1
parent_wbs: null
priority: P1
tags: ["review"]
dependencies: []
ac_numbering: task-local
created_at: "2026-08-18T07:06:36.802Z"
updated_at: "2026-08-19T03:45:38.329Z"
---

## 0587. Fix sp-dev-pr-review dogfood findings (P1/P2) + spur-dev slowness levers (P3)

### Background
Source: `docs/dogfood/2026-08-17-sp-dev-pr-review-dogfood.md` (run `20260817-235410`, verdict PARTIAL).
The dogfood drove `/sp:dev-pr-review full` with the focus "why are spur-dev workflows so slow" on this
tree (branch `main`, 1 local commit ahead of `origin/main`); full mode was redirected to observe (no
push) because the P1 below would have fast-forwarded the shared base. P1/P2 are defects in the
`pr-reviewing.ts` deterministic core; the P3 rows are the driver's measured slowness analysis.

**Re-evaluated 2026-08-18 against the live tree** (all anchors below re-derived; the original
draft's `task-pipeline.yaml` line refs were stale by ~150 lines). Four corrections landed:

1. **R3 was not implementable as first written.** "Targeted intermediate rechecks, full gate on the
   final recheck" cannot be expressed: `test-recheck` is one state whose `→ review` transition fires
   on `PASS` (`config/workflows/task-pipeline.yaml:610`), so a targeted-only green reaches `review`
   without any full gate — and which recheck is "final" is unknowable before it runs. Restructured as
   probe-then-full (see `### Design` D2), which keeps the invariant and captures the same saving.
2. **R4 was measured instead of implemented, and the measurement refuted it.** The lever's premise (coverage ≈ 2× the suite) does not reproduce — 64.68s vs 65.77s, ~1.7% — and Bun 1.3.14's
   `bunfig.toml [test] coverage` key overrides the `--coverage` CLI flag, so the proposed opt-in split
   is not expressible: a first attempt at it silently removed the 90/90 gate from CI and left
   `spur-check:full` red on `coverage:missing-lcov`. R4 now records the decision; no coverage config
   changes. Detail in R4 and `### Design` D3.
3. **No `.github/workflows/` edit is involved.** CI runs `bun run check`
   (`.github/workflows/ci.yml:21`), a `package.json` script; the draft's operator-approval gate was an
   artifact of the coverage lever and is moot now that the lever is dropped.
4. **R5 (model-hop latency investigation) split out to task `0588`.** It was an open-ended
   measurement blocking `done` on four otherwise deterministic changes, and it pinned this task at
   the pipeline's 5-R-item size cap.

Fix in priority order (P1 → P2 → …); re-review after.

#### Review Findings

| Severity | File | Finding | Recommendation |
| -------- | ---- | ------- | -------------- |
| P1 | `plugins/sp/scripts/pr-reviewing.ts:524` (`cmdPush`), `:560` (`cmdEnsurePr` guard) | full mode on the repository default branch pushes local commits to the shared base BEFORE the base-branch guard fires — the spine runs `push` then `ensure-pr` (`config/workflows/pr-review.yaml:107`, `:124`), so on `main` with commits ahead `git push` fast-forwards `origin/main` and only then does the run discover "nothing to review" | Refuse in `cmdPreflight` (`:495`), the earliest spine state — preflight FAIL routes straight to `failed` (`config/workflows/pr-review.yaml:213`) before `push` is ever entered. Keep the ensure-pr guard as defense-in-depth (R1) |
| P2 | `plugins/sp/scripts/pr-reviewing.ts:506-518` (`cmdPreflight` emit) | preflight output omits upstream divergence — an operator on `main` (1 ahead) cannot see the push coming | Emit `Upstream: <ref> (ahead N, behind M)` / `Upstream: none` in preflight human + JSON output (R2) |
| P3 | `config/workflows/task-pipeline.yaml:385-420` (`test-recheck`) | every red path re-runs the full quality gate (`bun run format && bun run spur-check` ≈ 110–140s, `:87`) after each fixall, up to `qualityGateMaxFixAttempts: 2` (`:90`) — and re-runs it to learn only that the tree is *still* red | Cheap probe first: red probe ⇒ record FAIL and skip the full gate (the saving); green probe ⇒ run the full gate to decide. `review` is still only ever reached through a full green gate (R3) |
| P3 | `bunfig.toml` (`[test] coverage`) | dogfood claim: coverage on every `bun test` gate run roughly doubles the measured 81.1s suite | **Measured, then dropped (R4).** Controlled pair: 64.68s without vs 65.77s with — ~1.1s (1.7%), not ~2×; and Bun 1.3.14's bunfig key overrides `--coverage`, so an opt-in split cannot be expressed with a flag. No change lands; the decision is the deliverable |
| P3 | `config/workflows/task-pipeline.yaml:71,77` (`stepTimeoutMs` / `implementTimeoutMs`) | model-hop wall-clock dominates task time; the 30-min budgets are headroom, not measured latency | **Split to task `0588`** — measure per-hop wall-clock, attribute the cost, record a decision. No code lands on inference |
| P3 | (driver process — no product file) | dogfood ledger batch-written for a ≥3-min run (protocol self-report) + aggregate cache 36% < 50% (cache-health rule) | Driver-process discipline for future dogfood runs — no product code change; excluded from R-items (recorded in Q&A) |
### Requirements
- [x] R1. **P1 — refuse the spine on the base branch, in `cmdPreflight`, before any push can fire.**
  In `plugins/sp/scripts/pr-reviewing.ts` → `cmdPreflight`: after the dirty-tree check and BEFORE
  `writeStatus(args, 'PASS')`, resolve the base exactly as `cmdEnsurePr` does —
  `const base = (args.flags.get('--base') ?? '').trim() || ctx.defaultBranch;` — and when
  `ctx.branch === base`, `writeStatus(args, 'FAIL')` + `fail(args, msg, 2)` with:
  `current branch is the base branch (<base>) — a PR reviews a feature branch against it; check out a feature branch (nothing on the base branch is reviewable)`.
  Preflight FAIL routes straight to `failed`, so the `push` state is never entered. Covers all three
  sub-states in one predicate: (a) commits ahead of upstream → the push fast-forwards the shared base
  (the dogfood P1); (b) no upstream → the `-u origin HEAD` publish path in `cmdPush` publishes the
  base; (c) up to date → nothing reviewable by contract.
  Also: (i) pass the base into preflight — add `--base "$baseBranch"` to the preflight invocation in
  `config/workflows/pr-review.yaml`, so a run with an overridden `baseBranch` is guarded on the same
  branch `ensure-pr` will use, not merely on the repo default; (ii) extend that state's
  `- from: preflight / to: failed` description and `plugins/sp/skills/pr-reviewing/SKILL.md` step 1
  (which lists preflight's hard-fail conditions) to name the base-branch refusal.
  Leave `cmdEnsurePr`'s guard untouched — defense-in-depth. Do NOT gate the `collect` / `status`
  routes (read-only, not preflight-gated). Edge notes: exact branch-name match is the contract (local
  git is case-sensitive, GitHub is not); detached HEAD still fails earlier in `preflightContext`.
- [x] R2. **P2 — preflight reports upstream divergence.** Add a `resolveUpstream()` helper next to
  `preflightContext` returning `{ ref, ahead, behind } | null`, using **non-fatal `run()`, never
  `runOk()`** (a missing upstream is a normal state, not an error):
  `git rev-parse --abbrev-ref --symbolic-full-name @{u}` (rc != 0 → `null`), then
  `git rev-list --count @{u}..HEAD` (ahead) and `git rev-list --count HEAD..@{u}` (behind), each
  parsed with a `0` fallback on non-numeric or failed output. Resolve **once** per preflight. Emit a
  human line `Upstream:   <ref> (ahead N, behind M)` — or
  `Upstream:   none (publishing would create origin/<branch>)` — in the `cmdPreflight` emit block, and
  add an `upstream: { ref, ahead, behind } | null` field to the JSON payload (additive; the skill
  reads this file at `.spur/run/<runId>-pr-context.json`).
  **The test fixture must be extended or these tests cannot run:** `writeStubBins` in
  `plugins/sp/tests/pr-reviewing.test.ts` matches on `"$*"` and its `*) exit 1` default would fail the
  new calls — add cases for `"rev-list --count @{u}..HEAD"` and `"rev-list --count HEAD..@{u}"`
  reading fixture files (e.g. `$FIX/ahead`, `$FIX/behind`), and seed `0` for both in `seedHealthy` so
  every existing test keeps passing.
- [x] R3. **Lever 1 — cheap probe before the full recheck gate (fail fast on the red path).**
  In `config/workflows/task-pipeline.yaml`: add var `gateProbeCmd: "bun run lint"` beside
  `qualityGateCmd`, documented as "cheap red-detector run before the full gate on **recheck only**;
  empty ⇒ no probe (full gate every recheck, the pre-0587 behavior); a project overriding
  `qualityGateCmd` should override this too". Then rewrite `test-recheck`'s shell as: when
  `$gateProbeCmd` is non-empty, run it first; **probe rc != 0 ⇒ write `FAIL` to
  `.spur/run/$wbs-test-gate.status`, write the probe output to `.spur/run/$wbs-test-gate.log`, run the
  existing anchor extraction into `.spur/run/$wbs-test-gate.findings`, `exit 0` — skipping the full
  gate entirely**; probe rc == 0 (or probe empty) ⇒ fall through to the existing full-gate loop
  unchanged (SQLite-lock retry, log, anchors, PASS/FAIL). The `test` first probe is UNCHANGED — full
  gate, always. Invariant to preserve and to state in the YAML comment: **`review` is only ever
  entered through a full green `qualityGateCmd`** (the `→ review` guard reads `PASS`, which only the
  full gate can now write). Do **not** introduce a new `file.read.into-var` action for this: the
  engine drops non-final `setVars` (task `0571`) — read the findings file inside the shell step if the
  probe needs it.
- [x] R4. **Lever 2 — measure the coverage cost, then decide; the decision is the deliverable.**
  The dogfood asserted `bunfig.toml [test] coverage = true` roughly doubles the 81.1s suite and
  proposed making coverage opt-in. **Measure both arms under control before changing a gate**, then
  record the decision here.
  **Decision (2026-08-18): the lever is DROPPED — premise refuted, mechanism unsound.**
  (a) *Premise refuted.* Same-session, same-machine full-suite runs: `coverage = false` → **64.68s**;
  `coverage = true` → **65.77s**. The real cost is **~1.1s (1.7%)**, not ~2×. The dogfood's 81.1s
  figure was never paired against a controlled plain run.
  (b) *Mechanism unsound.* In Bun `1.3.14` the bunfig key **overrides** the `--coverage` CLI flag —
  isolated two-arm scratch probe: `coverage = false` + `--coverage` → no reporter output, no
  `.coverage/lcov.info`, no threshold enforcement; `coverage = true` → both. So an opt-in split cannot
  be expressed with a CLI flag at all, and the first attempt at it silently removed the 90/90 gate
  from CI (`bun run check`) and left `spur-check:full` red on `coverage:missing-lcov`.
  (c) *Therefore:* `bunfig.toml` stays `coverage = true`; no `test:coverage` script; `check`,
  `test-post-check`, and the `*:full` chains stay as they were; no `AGENTS.md` /
  `coverage-gate.yaml` / `04_DESIGN.md` edits for this lever. Any future attempt needs a separate
  config surface, not a flag — and a re-measurement that justifies it.
  (d) *Surfaced by the measurement, left as separate work:* `packages/app/src/services/process-inspector.ts`
  sits at 84% line coverage against the 90% `coverage-gate` threshold.
### Acceptance Criteria
- [x] AC1. Base-branch refusal proven by unit test: `bun test plugins/sp/tests/pr-reviewing.test.ts --test-name-pattern preflight` — default-branch fixtures in all three sub-states (commits ahead / no upstream / up to date) each exit 2 with a message containing `base branch`, and an `--base <other>` fixture on that same branch also exits 2; feature-branch fixtures still exit 0.
- [x] AC2. No push is reachable from the refusal: a default-branch preflight fixture records zero `git push` entries in the fixture `calls.txt`, and `config/workflows/pr-review.yaml` passes `--base "$baseBranch"` to the preflight step.
- [x] AC3. Divergence output asserted: fixture with upstream ahead 2 / behind 1 → preflight JSON contains `upstream.ahead == 2` and `upstream.behind == 1`, human output contains `ahead 2, behind 1`; no-upstream fixture → `upstream` is `null` and the human line contains `Upstream:   none`.
- [ ] AC4. Live repro of the dogfood P1 on this tree: `bun plugins/sp/scripts/pr-reviewing.ts preflight --json` run from `main` exits 2 with a `base branch` message (before this task: exit 0, with the push one state away).
- [x] AC5. `bun run lint` green AND `bun test plugins/sp/tests/pr-reviewing.test.ts` fully green (no regressions across the 856-line suite).
- [x] AC6. `spur workflow validate .spur/workflows/task-pipeline.yaml` green and an engine dry-run green. Red-path smoke with a deliberately failing file: the `test-recheck` log shows the probe command only (no `spur-check`) when the probe is red, and shows the full `qualityGateCmd` when the probe is green; `.spur/run/<wbs>-test-gate.findings` is non-empty in the probe-red case (so the next `test-fix` hop still names anchors). Setting `gateProbeCmd` to `''` reproduces the pre-0587 behaviour (full gate every recheck).
- [x] AC7. R4's decision is recorded with both measurements pasted: the controlled pair (`coverage = false` 64.68s vs `coverage = true` 65.77s on the same suite/session) and the isolated flag-precedence probe (Bun 1.3.14: `coverage = false` + `--coverage` produces no reporter output and no `.coverage/lcov.info`; `coverage = true` produces both). `bunfig.toml` reads `coverage = true`, `package.json` carries no `test:coverage` script, and `git diff` shows no coverage-related edit to `package.json`, `AGENTS.md`, `config/rules/quality/coverage-gate.yaml`, or the `recommended-post-check` line of `docs/04_DESIGN.md`.
- [x] AC8. `spur task check 0587` green.
### Q&A
- **R5 split out to task `0588` (2026-08-18).** The model-hop latency lever is a measurement whose
  done-condition is a judgment call; bundling it made this task un-delegable and pinned it at the
  pipeline's 5-R-item size cap (`config/workflows/task-pipeline.yaml:103`). 0588 carries the dogfood
  evidence and the "no code on inference" bound.
- **P1 guard placement:** preflight (earliest — blocks the push) **plus** the existing ensure-pr guard
  (defense-in-depth). Accepted consequence: preflight now refuses *all* base-branch spine runs,
  including an up-to-date one — by contract nothing on the base branch is reviewable. The read-only
  direct routes (`collect`, `status`) are unaffected. The guard keys on the resolved base
  (`--base` override, else repo default), not the repo default alone, because `push` runs before
  `ensure-pr` and would otherwise still publish an overridden base.
- **Why R3 is probe-then-full rather than "targeted intermediate, full on the last hop":**
  `test-recheck` is a single state and its `→ review` transition fires on `PASS`
  (`config/workflows/task-pipeline.yaml:604-610`). A targeted-only `PASS` therefore reaches `review`
  with no full gate ever having run after the fix, and "which recheck is the final one" is not
  knowable before the recheck runs. Probe-then-full keeps the invariant exactly and captures the same
  saving, because the waste being removed is *re-running a 110–140s gate to learn the tree is still
  red* — not the gate that decides.
- **R3 saving, honestly:** red recheck ~6s instead of ~110–140s (saved once per failed fixall hop, up
  to `qualityGateMaxFixAttempts: 2`); green recheck pays the probe as ~6s overhead on top of the full
  gate. Net positive on red paths, marginal cost on green ones.
- **R3 probe scope deliberately narrow.** The probe is `gateProbeCmd` only (`bun run lint` — biome +
  per-workspace `tsc`, 6.1s measured). Running the failing files' tests as well would catch more red
  states cheaply, and the anchors are already extracted to
  `.spur/run/<wbs>-test-gate.findings` — add it if red rechecks are still dominated by test failures
  after this lands. An under-inclusive probe is safe by construction: it only ever falls through to
  today's behaviour.
- **R4 measured and dropped (2026-08-18).** Two probes, both run before any decision: a controlled
  timing pair on the same suite/session (`coverage = false` 64.68s vs `coverage = true` 65.77s — ~1.1s,
  1.7%) and an isolated flag-precedence probe (Bun `1.3.14`: `coverage = false` + `--coverage` → no
  reporter output, no `.coverage/lcov.info`; `coverage = true` → both). The dogfood's "roughly double"
  premise came from an 81.1s reading that was never paired against a plain run. A first implementation
  of the lever shipped before those probes and demonstrated the cost of skipping them: it removed the
  90/90 gate from every path including CI's `bun run check`, and left `spur-check:full` red on
  `coverage:missing-lcov`. That wiring is reverted; `bunfig.toml` stays `coverage = true`.
- **No `.github/workflows/` edit was ever needed.** CI runs `bun run check`
  (`.github/workflows/ci.yml:21`), a `package.json` script — the draft's operator-approval gate was an
  artifact of the coverage lever and is moot now that the lever is dropped.
- **Collateral from R3's YAML insert, repaired in this task:** the `gateProbeCmd` var block shifted
  `config/workflows/task-pipeline.yaml` down 6 lines, breaking task `0511`'s evidence anchors
  (`:204-208` → `:210-214`, `:196-202` → `:202-208`, `:209` → `:215`, and two ranges in its Solution
  and Testing sections). Re-anchored via `spur task update --section`; `spur task check 0511` green.
  Editing a file that other tasks cite by line means checking `spur task check --corpus` for new
  `L4.anchor-subject-mismatch` errors before calling the change done.
- **Driver-process P3 rows (cache-health 36%, batch-ledger self-report) stay out of R-items.** They
  are `sp:dogfood-testing` driver discipline, not product code. Kept in the findings table for
  traceability.
- **Fix source of truth:** `plugins/sp/scripts/pr-reviewing.ts` is the in-repo source. The installed
  copy at `~/.agents/scripts/sp/pr-reviewing.ts` is **not** byte-identical (the earlier draft claimed
  it was): `superskill install sp` rewrites the namespace prefix (`sp:` → `sp-`, `/sp:dev-pr-review`
  → `/sp-dev-pr-review`) at install time — 3 comment/string lines on 2026-08-18, no logic difference.
  Fix and test in-repo; never edit the installed copy; re-run `superskill install sp` to deploy.
- **Measured baseline (dogfood run `20260817-235410`, for regression comparison):** lint 6.1s; full
  suite with coverage 81.1s (5766 tests / 304 files); corpus-check 44.9s; rule engine 3.9s × 2; CLI
  ops ≤ 0.3s; composed quality gate ≈ 110–140s per run, 1–3 runs per task.
### Design
**D1 — P1/P2 (`pr-reviewing.ts` preflight).** Move the base-branch refusal from `cmdEnsurePr`
(post-push) into `cmdPreflight` (pre-push, the earliest spine state), keyed on the same resolved base
the later guard uses so an overridden `baseBranch` is covered too. One shared `resolveUpstream()`
helper (ref + ahead/behind, all non-fatal) feeds both the refusal context and the R2 output, so the
two can never disagree. Tradeoff: refusing on the base branch outright is broader than the P1 trigger
(commits ahead), but it is the correct contract — a PR cannot review the base against itself — and it
closes the no-upstream and up-to-date sub-states at zero extra cost. Rejected: gating only on
"commits ahead", which leaves the other two sub-states to the same confusing late refusal.

**D2 — R3 (probe-then-full recheck).** The measured waste is not the gate that decides; it is
re-running a 110–140s gate after a fixall hop only to learn the tree is *still* red. So the recheck
runs a cheap red-detector first: **red probe ⇒ record FAIL and skip the full gate** (the saving);
**green probe ⇒ run the full gate**, which is what actually writes `PASS`. Because only the full gate
can write `PASS`, the `test-recheck → review` guard (`config/workflows/task-pipeline.yaml:610`) still
means "a full green gate ran" — the invariant is preserved by construction rather than by an
attempt-counting rule. Rejected: "targeted intermediate rechecks, full gate on the final recheck" —
unimplementable, since a targeted `PASS` transitions to `review` immediately and no state knows in
advance that it is the last one. Also rejected: narrowing `qualityGateCmd` itself, which would weaken
the first probe for every task, green and red alike.

**D3 — R4 (coverage lever: measured, then dropped).** The dogfood proposed making coverage opt-in on
the strength of an 81.1s suite reading described as "roughly double a plain run" — a comparison it
never actually ran. Two probes settled it. Controlled pair on the same suite and session:
`coverage = false` 64.68s, `coverage = true` 65.77s — the gate costs ~1.1s (1.7%), so there is no
saving worth a gate for. Isolated flag-precedence probe on Bun 1.3.14: with `coverage = false`,
`bun test --coverage` emits no reporter output and writes no `.coverage/lcov.info`, i.e. the bunfig
key overrides the CLI flag, so "opt-in coverage via a script that passes `--coverage`" cannot work at
all. The first implementation of the lever demonstrated the failure mode directly: it disabled the
90/90 threshold on every path, took CI's `bun run check` with it, and left `spur-check:full` red on a
missing lcov — a gate traded away for one second. Decision: keep `coverage = true`, land no coverage
wiring, record the numbers so the lever is not re-proposed from the same unverified premise. Rejected
alternative: a separate bunfig for coverage runs — Bun has no per-invocation config override, so this
needs a real config surface and a fresh measurement to justify it.
### Plan
- [x] Add the base-branch refusal to `cmdPreflight`, wire `--base` through the workflow's preflight step, sync the state description + SKILL.md (R1)
- [x] Add `resolveUpstream()`, the `Upstream:` human line and the JSON field, and extend the git stub with `rev-list --count` cases (R2)
- [x] Unit tests for both: three default-branch sub-states, `--base` override, ahead/behind, no-upstream (R1, R2)
- [x] Add `gateProbeCmd` and rewrite `test-recheck` as probe-then-full-gate; document the invariant in the YAML comment (R3)
- [x] Measure the coverage lever both ways (controlled timing pair + flag-precedence probe) and record the decision (R4)
- [x] Revert the coverage wiring the first R4 attempt landed; re-anchor task 0511's citations shifted by the `gateProbeCmd` insert
- [x] Verify: lint, the pr-reviewing suite, workflow validate, red-path smoke, `spur-check`, `spur task check`
- [x] Deploy the script fix with `superskill install sp` (installed copy verified identical to source modulo the `sp:`→`sp-` namespace rewrite) and populate `### Review`
### Solution
Change-map (auto-generated — implement step did not record a Solution).
Each entry cites the first changed line per file (`file:line`).

| Change (`file:line`) |
|----------------------|
| `plugins/sp/scripts/pr-reviewing.ts:442` |
| `plugins/sp/scripts/pr-reviewing.ts:532` |
| `plugins/sp/scripts/pr-reviewing.ts:546` |
| `plugins/sp/scripts/pr-reviewing.ts:552` |
| `plugins/sp/scripts/pr-reviewing.ts:91` |
| `plugins/sp/tests/pr-reviewing.test.ts:302` |
| `plugins/sp/tests/pr-reviewing.test.ts:360` |
| `plugins/sp/tests/pr-reviewing.test.ts:441` |
### Testing
**Pipeline verify results**

- Verdict: PARTIAL (from verdict artifact)

| Requirement | Status | Evidence |
|-------------|--------|----------|
| R1 | MET | `plugins/sp/scripts/pr-reviewing.ts:532-541` — base resolved with the same predicate as `cmdEnsurePr`, refusal placed after the dirty check and before `writeStatus(args,'PASS')`; `config/workflows/pr-review.yaml:69` passes `--base "$baseBranch"` into preflight; `:217` names the refusal in the failure transition; `plugins/sp/skills/pr-reviewing/SKILL.md:138-143` documents it. `bun test plugins/sp/tests/pr-reviewing.test.ts --test-name-pattern preflight` → 8 pass / 0 fail. |
| R2 | MET | `plugins/sp/scripts/pr-reviewing.ts:443-455` `resolveUpstream()` — non-fatal `run()`, `0` fallback on unparseable counts, resolved once at `:533`, consumed by the human line `:552` and the additive JSON field `:546`. Divergence output asserted at `plugins/sp/tests/pr-reviewing.test.ts:526-536`. |
| R3 | MET | `config/workflows/task-pipeline.yaml:88-93` (`gateProbeCmd` + invariant comment) and `:398-434` (probe-then-full). `spur workflow validate .spur/workflows/task-pipeline.yaml` → `workflow valid: task-pipeline`, rc 0 this run. Smoke: `.spur/run/0587smoke-red6.log` ends at the lint failure with no `FULL_GATE_RAN` (full gate skipped) and `-red6.findings` holds the anchor; `-green.log` shows probe then `FULL_GATE_RAN`; `-empty.log` is `FULL_GATE_RAN` alone. |
| R4 | MET | Deliverable is the recorded decision, and both measurements are pasted in the task (`### Requirements` R4, `### Design` D3, `### Q&A`): controlled timing pair 64.68s (`coverage = false`) vs 65.77s (`coverage = true`) → ~1.1s / 1.7%; isolated flag-precedence probe on Bun 1.3.14 → `coverage = false` + `--coverage` yields no reporter output and no `.coverage/lcov.info`, `coverage = true` yields both. Decision "lever dropped" is enacted: `bunfig.toml:8` reads `coverage = true`, `package.json` has no `test:coverage` script, and `git diff HEAD --stat -- package.json AGENTS.md config/rules/quality/coverage-gate.yaml bunfig.toml` is empty. |

| Acceptance Criteria | Status | Evidence Type | Evidence |
|---------------------|--------|---------------|----------|
| AC1. Base-branch refusal proven by unit test | MET | test | `plugins/sp/tests/pr-reviewing.test.ts:441` — test covering the base-branch refusal across all three sub-states; the resolved-base override case is the next test in the same file. 8 preflight tests pass / 0 fail this run. |
| AC2. No push reachable from the refusal | MET | test | `plugins/sp/tests/pr-reviewing.test.ts:450` — the refusal test asserts the fixture call log records no push; the same assertion repeats in the resolved-base override test. |
| AC3. Divergence output asserted | MET | test | `plugins/sp/tests/pr-reviewing.test.ts:526` — `preflight passes on a feature branch and reports upstream divergence`, asserting ahead 2 / behind 1 in both output forms; the missing-upstream case is the following test in the same file. |
| AC4. Live repro on the base branch | PARTIAL | command | Not executable in this environment: `bun plugins/sp/scripts/pr-reviewing.ts preflight --json` on `main` exits 2 on `gh CLI missing or unauthenticated` — `gh auth status` fails (keyring) in the sandbox — and the tree is dirty, so both earlier guards fire before the base-branch check is reached. Covered instead by AC1's in-process tests, which drive the same `main()` path with stubbed git/gh. |
| AC5. lint green + pr-reviewing suite green | MET | command | `bun run lint` exit 0 after the reverts; `bun test plugins/sp/tests/pr-reviewing.test.ts` → 56 pass / 0 fail (16.5s) |
| AC6. workflow validate + red-path smoke | MET | command | `spur workflow validate .spur/workflows/task-pipeline.yaml` rc 0; smoke artifacts `.spur/run/0587smoke-{red6,green,empty}.{log,status,findings}` show probe-only on red, probe+full on green, full-only when `gateProbeCmd` is empty |
| AC7. R4 decision recorded and enacted | MET | command | Both measurements pasted in the task; `grep -n '^coverage = ' bunfig.toml` → `8:coverage = true`; `test:coverage` script absent from `package.json`; `git diff HEAD --stat` lists none of `package.json`, `AGENTS.md`, `config/rules/quality/coverage-gate.yaml`, `bunfig.toml`; the `recommended-post-check` line of `docs/04_DESIGN.md` is back to its committed text |
| AC8. `spur task check 0587` green | MET | command | `spur task check 0587` → `0587 (done): PASS` this run |
- Coverage: N/A (verdict-based; verify pipeline does not measure code coverage)
### Review
Post-implementation reflection, written after the re-audit round (`/sp:dev-verify 0587 --force
--fix all`, 2026-08-18). The first implementation round shipped R1–R3 correctly and R4 wrongly; the
rework replaced R4's mechanism with the measurement it should have started from.

| Severity | File | Finding | Recommendation |
| -------- | ---- | ------- | -------------- |
| P1 → **RESOLVED** | `bunfig.toml`, `package.json` | R4's first implementation set `[test] coverage = false` and routed the enforcing chains through a new `bun test --coverage` script. In Bun `1.3.14` the bunfig key **overrides** the CLI flag, so the script collected nothing: no reporter output, no `.coverage/lcov.info`, no 90/90 threshold — and `check`, which is what CI runs, had just been pointed at it. `spur-check:full` went red on `coverage:missing-lcov`. Root cause: an assumed precedence between config file and CLI flag that was never probed. | **Closed this round.** Isolated two-arm probe established the precedence; a controlled timing pair (64.68s vs 65.77s → ~1.1s, 1.7%) refuted the premise that motivated the lever. All coverage wiring reverted; R4 rewritten as a recorded decision. Lesson appended to `docs/99_PROJECT_CONSTITUTION.md` § Lessons for `AGENTS.md`. |
| P2 → **RESOLVED** | `docs/99_PROJECT_CONSTITUTION.md` | Out-of-scope record edit: a historical lesson about task 0572 was re-dated `[2026-08-16]` → `[2026-08-18]` with byte-identical text. Dated lesson entries record when a lesson was learned; rewriting the date falsifies the log. | Reverted to `[2026-08-16]`. The doc version bump now carries real content — the new coverage lesson. |
| P2 → **RESOLVED** | `config/workflows/task-pipeline.yaml`, `docs/tasks4/0511…` | R3's `gateProbeCmd` var block shifted the file down 6 lines and broke task 0511's evidence anchors (`:204-208`, `:196-202`, `:209`, plus two ranges), surfacing as a new `L4.anchor-subject-mismatch` corpus error. | Re-anchored 0511 via `spur task update --section` (`:210-214`, `:202-208`, `:215`); `spur task check 0511` green. Standing lesson: editing a file other tasks cite by line means re-running `spur task check --corpus` before calling the change done. |
| P3 → **NOT A DEFECT** (task `0589` cancelled) | `packages/app/src/services/process-inspector.ts` | The verify run read this file at 83.95% lines against the 90% `coverage-gate` threshold and reported `bun run spur-check` red. That reading is a **sandbox artifact**: `apps/server/tests/context.test.ts:385` covers `defaultRunPs` (`:126-138`) by really shelling out to `ps`, and it self-skips under `[SKIP:spawn-denied]` when process spawn is denied — as it is here. Unsandboxed and in CI the file is 100/100 and the gate is green. | No work needed; 0589 cancelled. Standing lesson: a coverage or gate failure under the sandbox must be checked against the `[SKIP:*]` guards before it is called a defect — the same trap as the `[SKIP:port-bind-denied]` suites. |
| P3 → **DEFERRED** (task `0590`) | `packages/app/src/services/task-verdict.ts` | `extractAcceptanceCriteria` never resets its `inTable` flag on a heading, so it consumes the documented `### SECUA Review` table as AC rows — every schema-conformant verify answer file emits a spurious `ac-row-dropped` check. The AC rows themselves parse correctly, so this is a false failing check rather than data loss. | Add a heading boundary + regression test. Tracked as task `0590`. |
| P3 | `plugins/sp/scripts/pr-reviewing.ts` | `resolveUpstream()` is called before the base-branch refusal but its result is not used in the refusal message, so a refused run pays two `git rev-list` calls for nothing. Harmless; the requirement asked for a single resolution and got one. | Optional: move the call below the refusal, or include `ahead N` in the refusal text so the operator sees what would have been published. |

**What went right.** R3's smoke evidence is the model to copy: three artifact sets
(`0587smoke-{red6,green,empty}`) proving probe-only on red, probe-then-full on green, and full-only
with an empty probe — the invariant demonstrated rather than asserted.

**What to carry forward.** Both R4 failures were the same failure: acting on an unverified premise.
The dogfood's "roughly double" was never a controlled comparison, and the flag/config precedence was
never probed. A gate is not something to disable for a saving you have not measured.
### References
- Dogfood report: `docs/dogfood/2026-08-17-sp-dev-pr-review-dogfood.md` (run `20260817-235410`, verdict PARTIAL; findings §6, slowness analysis §4.2–4.5)
- Split-out follow-up: task `0588` — model-hop wall-clock measurement + latency decision (was R5)
- Source: `plugins/sp/scripts/pr-reviewing.ts` — `preflightContext:413`, `cmdPreflight:495` (emit `:506-518`), `cmdPush:524` (no-upstream publish `:526-531`), `cmdEnsurePr:544` (base `:556`, guard `:557-560`)
- Tests: `plugins/sp/tests/pr-reviewing.test.ts` — `writeStubBins:288`, `seedHealthy:353`, `describe('CLI subcommands over stubbed git/gh'):407`
- Review spine: `config/workflows/pr-review.yaml` — `preflight:56` (invocation `:67`), `push:107`, `ensure-pr:124`, `preflight → failed:213-217`
- Task pipeline: `config/workflows/task-pipeline.yaml` — vars `:49`, `stepTimeoutMs:71`, `implementTimeoutMs:77`, `qualityGateCmd:87`, `qualityGateMaxFixAttempts:90`, `gateFindings:100`, `maxImplementReqs:103`, `test:316`, `test-fix:355` (`file.read.into-var:371`), `test-recheck:385`, `review:422`, `test-recheck → review:604-610`
- Skill doc: `plugins/sp/skills/pr-reviewing/SKILL.md:138-140` (preflight hard-fail contract)
- Coverage config: `bunfig.toml:8-11`; `package.json` scripts `test` / `check` / `spur-check` / `test-post-check` / `*:full`; `.github/workflows/ci.yml:21` (`bun run check`)
- Coverage rules: `config/rules/recommended-post-check.yaml:9-10` (`extends: [quality]`), `config/rules/quality/coverage-gate.yaml:17-23` (lcov path + `severity: error`), `config/rules/quality/tsdoc-exports.yaml:23` (`every-export-has-tsdoc`)
- Engine `setVars` drop affecting `file.read.into-var`: task `0571`
- Deploy: `superskill install sp` — the installed `~/.agents/scripts/sp/pr-reviewing.ts` differs from the in-repo source only by install-time namespace rewrites (`sp:` → `sp-`), verified 2026-08-18
### History
- 2026-08-18T15:54:59.341Z backlog → todo (system)
- 2026-08-18T16:25:48.562Z todo → wip (system)
- 2026-08-18T16:40:21.257Z wip → testing (system)
- 2026-08-18T16:40:28.310Z testing → done (system)
