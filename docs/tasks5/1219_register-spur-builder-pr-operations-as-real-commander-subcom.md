---
schema_version: 1
name: Register spur builder pr operations as real Commander subcommands
status: done
template: feature-impl
created_at: 2026-10-16T18:16:16.609Z
updated_at: "2026-10-17T01:09:30.272Z"
feature_id: L1
priority: P2
tags:
  - cli
  - builder
  - pr-review
estimate_hours: 3

done_forced: "false"
done_reason: unforced close; PASS artifact at .spur/memory/evidence/1219-verdict.json
---

## 1219. Register spur builder pr operations as real Commander subcommands

### Background

Implements: R6 — The pull-request operations are four flat builder verbs with their own help; R7 — The pr-review workflow runs on the four verbs with its verdict contract intact; R13 — The builder surface is documented where the CLI facade and design index look (pull-request half).

**Reshaped on 2026-10-16 by the operator:** this task no longer registers eight `pr` subcommands. It replaces the `pr <op>` layer with four flat `pr-<verb>` verbs. The title predates that change; the CLI has no title-update verb, and the sections below are authoritative.

Today `apps/cli/src/commands/builder/pr.ts:13-21` registers one pass-through `pr [argv...]` with `.allowUnknownOption(true)` and `.allowExcessArguments(true)`, so per-op help is missing and typos are silently accepted. The only callers of the eight operations are `config/workflows/pr-review.yaml` (plus its generated copy `apps/cli/config/workflows/pr-review.yaml`), `plugins/sp/skills/pr-reviewing/SKILL.md` and `plugins/sp/skills/spur-cli/references/builder.md`. Design: `docs/design/builder-branches-and-pr-review.md` §3.2.

### Requirements

- [x] R1. `spur builder` registers four flat verbs that compose the existing service operations: `pr-status` (status, with the collect result as a `review` field), `pr-check` (preflight, then hygiene), `pr-open` (push, then ensure), `pr-review` (request, then wait, then collect). Each declares only its own flags plus `--json` and `--status-file <path>`; unknown flags exit 1 naming the flag.
- [x] R2. Each verb's stdout JSON, `--status-file` verdict and exit code (0 ok, 1 usage, 2 hard failure, 3 wait timeout) equal the composition of the former operations for the same stubbed git/gh responses, as specified in Design.
- [x] R3. `config/workflows/pr-review.yaml` (and its generated copy) runs check → precheck → open → review with terminal states done, pending and failed, and keeps the `mode` values full, submit and rerun plus `noWait`, `focus`, `baseBranch`, `waitTimeoutSec`, `waitIntervalSec` and `preReviewCmd`.
- [x] R4. `spur builder pr <op>` remains as a hidden alias for one release: it prints one stderr deprecation line naming the replacement verb, then runs the unchanged pass-through.
- [x] R5. `docs/design/harness-surface-governance.md` §3 records the four verbs (operator consent 2026-10-16, feature L1) and the deprecation of `pr`; `plugins/sp/skills/spur-cli/references/builder.md` documents the four verbs and their flags; the existing `sp:pr-reviewing` calls switch to the new verbs so the skill keeps working before task 1220.

### Acceptance Criteria

- [x] AC1 — The pull-request operations are four flat builder verbs with their own help
- [x] AC2 — The pr-review workflow runs on the four verbs with its verdict contract intact
- [x] AC3 — The builder surface is documented where the CLI facade and design index look

### Q&A

<!-- CLOSED decisions from refinement: what was chosen and why, what was deferred and on what
     condition. Not a parking lot for open questions — an unanswered question here means the task
     is not ready to hand off. Keep empty if none. -->

#### Q&A entry — 2026-10-16T18:25:25.832Z

- Q: Do Commander-rejected usage errors break the `--status-file` contract? A: No. The service writes the status file only on exit 2; usage errors exit 1 with no status file on both paths. Closed 2026-10-16.
- Q: Pass Commander defaults for `--timeout`/`--interval`? A: No. Defaults stay in the service parser. Closed 2026-10-16.

#### Q&A entry — 2026-10-16T18:34:07.560Z

- Q: Flatten all eight operations? A: No. The operator chose four composed verbs (2026-10-16): `pr-status`, `pr-check`, `pr-open`, `pr-review`. Closed.
- Q: Keep `spur builder pr <op>`? A: As a hidden alias with a deprecation line for one release; remove it in a follow-up. Closed 2026-10-16.
- Q: Where does sequencing live? A: In the service (`runPrVerb`), not in the CLI or YAML shell. Closed 2026-10-16.
- Q: How does local review run hygiene on a dirty tree? A: `pr-check --scan-only` skips preflight. Closed 2026-10-16.

### Design

Feature L1 (child of the `spur builder` umbrella L). Satellite: `docs/design/builder-branches-and-pr-review.md` §3.2.

**Chosen.** Four flat verbs in `apps/cli/src/commands/builder/pr.ts`, registered by `registerBuilderPrCommands(builder, context)` from `apps/cli/src/commands/builder.ts`. Composition lives in the service, not the CLI: add `runPrVerb(verb: PrVerb, opts: PrVerbOptions, sink: PrReviewIo, context?: PrReviewContext): number` to `packages/app/src/services/pr-review/index.ts`. It calls the existing `cmd*` functions in sequence inside one `createRuntime(context)` and keeps the existing `ScriptExit`/`writeFailureStatus` handling from `runSpine`. `main()` and `parseArgs` stay unchanged for the alias. Reason: one place owns sequencing and status words; the CLI stays a thin transport (ADR-021); `pr-review.yaml` loses three states and the `file.read.into-var` plumbing for `prSince`/`prHead`, because `pr-review` passes the request record to wait/collect in-process.

**Frozen verbs, flags and verdicts.**

| Verb | Composes | Flags | `--status-file` verdict | Exit |
| --- | --- | --- | --- | --- |
| `pr-status` | status + collect | `--since <iso>`, `--head <sha>` | none (read-only) | 0, or 2 on probe failure |
| `pr-check` | preflight, then hygiene (stops after a preflight FAIL) | `--base <branch>`, `--scan-only` (hygiene only; for local review on a dirty tree) | `PASS` \| `WARN` \| `BLOCK` \| `FAIL` | 0 on PASS/WARN/BLOCK/FAIL verdicts, 2 on probe failure |
| `pr-open` | push, then ensure | `--base <branch>` | `FOUND` \| `CREATED` \| `FAIL` (push rejected or ensure failed) | 0, 2 |
| `pr-review` | request; `ALREADY_REVIEWED` → collect; `ALREADY_REQUESTED` → `PENDING`; `REQUESTED` → `--no-wait` ? `PENDING` : wait, then collect | `--force`, `--focus <text>`, `--no-wait`, `--timeout <s>` (default 600), `--interval <s>` (default 30) | `CLEAN` \| `FINDINGS` \| `PENDING` \| `FAIL` | 0, 2, or 3 on wait timeout (verdict `PENDING`) |

`--json` output is one object per verb: `pr-status` → the existing status object plus `review` (the collect object, or null when no request exists); `pr-check` → `{ ok, verdict, preflight, hygiene }`; `pr-open` → `{ ok, verdict, push, pr }`; `pr-review` → `{ ok, verdict, request, findings }`. These embed the existing per-op objects unchanged.

**Workflow.** `pr-review.yaml` states: `check` (`pr-check --base`; PASS|WARN → precheck; else failed), `precheck` (unchanged), `open` (`pr-open --base`; FOUND|CREATED → review; else failed), `review` (`pr-review --focus`, `--force` when `mode=rerun`, `--no-wait` when `mode=submit` or `noWait=true`; CLEAN|FINDINGS → done, PENDING → pending, else failed). The `review` state also writes `.spur/run/<runId>-pr-findings.json` and `-pr-status.json` (via `pr-status --json`), so `fix` and the report read the same artifacts as today. Regenerate `apps/cli/config/workflows/` with `bun run --filter @gobing-ai/spur build:bundle`; never hand-edit it.

**Alias.** Keep the current `pr [argv...]` registration with `.hideHelp()`. Before delegating to `main()`, write one stderr line: `spur builder pr <op> is deprecated; use spur builder <verb>`. Removal is a follow-up task in the next release.

**Invariants.** Never force-push. Codex request/collect logic is unchanged. `pr-review` exit 3 means pending, never failure. Service code changes are limited to `runPrVerb` and its types.

**Anti-patterns.** No per-op flat verbs (`pr-preflight`, `pr-wait`, …). No sub-noun layer. No sequencing in shell inside the YAML. No hand-edits to generated workflow copies or plugin adapters.

**Rejected.** Eight `pr <op>` Commander subcommands (adds a command layer). Eight flat `pr-<op>` verbs (noisy `builder --help`, eight consent rows). Deleting `pr` immediately (installed plugin copies in other projects may still call it).

**Handoff.** Task 1220 uses `pr-status --json`, `pr-check --base <b> --scan-only --json` and the workflow `mode` values; keep these shapes stable.

### Plan

1. Write the failure list first: preflight FAIL must stop before hygiene; push rejected must stop before ensure; `ALREADY_REVIEWED` must collect without a new request; `--no-wait` must stop at PENDING; wait timeout must exit 3 with PENDING; unknown flag must exit 1; usage errors must not write a status file; the alias must still pass through byte-identically.
2. Write the E2E cases in `apps/cli/tests/commands/builder/pr.test.ts` with the stubbed runner (`setCommandRunner`): for each verb, compare stdout/status/exit to the old op sequence run through `main()` (R1, R2). Update `apps/cli/tests/script-absorption-pr7/` cases and `apps/cli/tests/fixtures/script-absorption-pr7-golden.json` only where the alias deprecation line changes stderr.
3. Implement `runPrVerb` in the service, then register the four verbs and hide the alias (R1, R4).
4. Rewrite `config/workflows/pr-review.yaml` to four states, run `build:bundle`, and run the workflow tests plus `packages/app/tests/services/pr-review/pr-review.test.ts` (R3). Save one dry-run trace of the workflow under `.spur/run/1219-pr-review-trace.txt` as the repeatable artifact.
5. Docs and callers (R5): governance §3 rows, `builder.md` reference, and switch the `spur builder pr <op>` calls in `plugins/sp/skills/pr-reviewing/SKILL.md` to the new verbs.
6. `bun run spur-check`.

### Solution

Change-map (auto-generated — implement step did not record a Solution).
Each entry cites the first changed line per file (`file:line`).

| Change (`file:line`) |
|----------------------|
| `apps/cli/src/commands/builder.ts:12` |
| `apps/cli/src/commands/builder.ts:173` |
| `apps/cli/src/commands/builder.ts:5` |
| `apps/cli/src/commands/builder/pr.ts:12` |
| `apps/cli/src/commands/builder/pr.ts:129` |
| `apps/cli/src/commands/builder/pr.ts:131` |
| `apps/cli/src/commands/builder/pr.ts:142` |
| `apps/cli/src/commands/builder/pr.ts:175` |
| `apps/cli/src/commands/builder/pr.ts:2` |
| `apps/cli/src/commands/builder/pr.ts:22` |
| `apps/cli/tests/commands/builder.test.ts:65` |
| `apps/cli/tests/commands/builder.test.ts:73` |
| `apps/cli/tests/commands/builder/pr.test.ts:2` |
| `apps/cli/tests/commands/builder/pr.test.ts:21` |
| `apps/cli/tests/commands/builder/pr.test.ts:234` |
| `apps/cli/tests/commands/builder/pr.test.ts:24` |
| `apps/cli/tests/commands/builder/pr.test.ts:29` |
| `apps/cli/tests/script-absorption-pr7-parity.test.ts:33` |
| `apps/cli/tests/script-absorption-pr7-parity.test.ts:58` |
| `config/workflows/pr-review.yaml:10` |
| `config/workflows/pr-review.yaml:101` |
| `config/workflows/pr-review.yaml:104` |
| `config/workflows/pr-review.yaml:111` |
| `config/workflows/pr-review.yaml:113` |
| `config/workflows/pr-review.yaml:117` |
| `config/workflows/pr-review.yaml:120` |
| `config/workflows/pr-review.yaml:126` |
| `config/workflows/pr-review.yaml:132` |
| `config/workflows/pr-review.yaml:135` |
| `config/workflows/pr-review.yaml:138` |
| `config/workflows/pr-review.yaml:143` |
| `config/workflows/pr-review.yaml:148` |
| `config/workflows/pr-review.yaml:154` |
| `config/workflows/pr-review.yaml:158` |
| `config/workflows/pr-review.yaml:163` |
| `config/workflows/pr-review.yaml:176` |
| `config/workflows/pr-review.yaml:182` |
| `config/workflows/pr-review.yaml:186` |
| `config/workflows/pr-review.yaml:190` |
| `config/workflows/pr-review.yaml:196` |
| `config/workflows/pr-review.yaml:199` |
| `config/workflows/pr-review.yaml:203` |
| `config/workflows/pr-review.yaml:207` |
| `config/workflows/pr-review.yaml:25` |
| `config/workflows/pr-review.yaml:38` |
| `config/workflows/pr-review.yaml:40` |
| `config/workflows/pr-review.yaml:56` |
| `config/workflows/pr-review.yaml:59` |
| `config/workflows/pr-review.yaml:6` |
| `config/workflows/pr-review.yaml:61` |
| `config/workflows/pr-review.yaml:67` |
| `config/workflows/pr-review.yaml:70` |
| `config/workflows/pr-review.yaml:73` |
| `config/workflows/pr-review.yaml:92` |
| `config/workflows/pr-review.yaml:94` |
| `docs/design/harness-surface-governance.md:195` |
| `docs/help/cmd_builder.md:103` |
| `docs/help/cmd_builder.md:124` |
| `docs/help/cmd_builder.md:186` |
| `docs/help/cmd_builder.md:21` |
| `docs/help/cmd_builder.md:26` |
| `docs/help/cmd_builder.md:6` |
| `docs/help/cmd_builder.md:92` |
| `docs/help/cmd_builder.md:95` |
| `docs/help/cmd_builder.md:98` |
| `docs/help/spur-cli-matrix.md:118` |
| `docs/help/spur-cli-matrix.md:122` |
| `docs/help/spur-cli-matrix.md:20` |
| `docs/help/spur-cli-matrix.md:53` |
| `docs/help/spur-cli-matrix.md:55` |
| `docs/help/spur-cli-matrix.md:96` |
| `docs/help2/builder.md:13` |
| `docs/help2/builder.md:3` |
| `docs/help2/builder.md:81` |
| `docs/help2/builder.md:84` |
| `docs/help2/builder.md:87` |
| `packages/app/src/services/pr-review/index.ts:1021` |
| `packages/app/tests/services/pr-review/pr-review.test.ts:103` |
| `packages/app/tests/services/pr-review/pr-review.test.ts:120` |
| `packages/app/tests/services/pr-review/pr-review.test.ts:125` |
| `packages/app/tests/services/pr-review/pr-review.test.ts:138` |
| `packages/app/tests/services/pr-review/pr-review.test.ts:1522` |
| `packages/app/tests/services/pr-review/pr-review.test.ts:26` |
| `packages/app/tests/services/pr-review/pr-review.test.ts:41` |
| `packages/app/tests/services/pr-review/pr-review.test.ts:92` |
| `packages/app/tests/services/pr-review/pr-review.test.ts:97` |
| `plugins/sp/skills/pr-reviewing/SKILL.md:130` |
| `plugins/sp/skills/pr-reviewing/SKILL.md:136` |
| `plugins/sp/skills/pr-reviewing/SKILL.md:142` |
| `plugins/sp/skills/pr-reviewing/SKILL.md:156` |
| `plugins/sp/skills/pr-reviewing/SKILL.md:180` |
| `plugins/sp/skills/pr-reviewing/SKILL.md:198` |
| `plugins/sp/skills/pr-reviewing/SKILL.md:294` |
| `plugins/sp/skills/pr-reviewing/SKILL.md:45` |
| `plugins/sp/skills/pr-reviewing/SKILL.md:50` |
| `plugins/sp/skills/pr-reviewing/SKILL.md:74` |
| `plugins/sp/skills/spur-cli/SKILL.md:47` |
| `plugins/sp/skills/spur-cli/references/builder.md:10` |
| `plugins/sp/skills/spur-cli/references/builder.md:19` |
| `plugins/sp/skills/spur-cli/references/builder.md:3` |
| `plugins/sp/skills/spur-cli/references/builder.md:33` |
| `plugins/sp/skills/spur-cli/references/builder.md:70` |
| `plugins/sp/skills/spur-cli/references/builder.md:73` |
| `plugins/sp/skills/spur-cli/references/builder.md:82` |

### Testing

**Pipeline verify results**

- Verdict: PASS (from verdict artifact)

| Requirement | Status | Evidence |
|-------------|--------|----------|
| R1 | MET | `apps/cli/src/commands/builder/pr.ts:46` registers four flat verbs (`:59` pr-status, `:84` pr-check, `:109` pr-open, `:131` pr-review), each with only its own flags plus `--json`/`--status-file`; composers in `packages/app/src/services/pr-review/index.ts:1333` + `:1342`. Direct probes: `builder <verb> --help` exits 0 for all four; `builder pr-check --bogus`, `pr-review --scan-only`, `pr-status --bogus-flag`, `pr-open --force` each exit 1 with `error: unknown option '<flag>'`. Suites: `apps/cli/tests/commands/builder/pr.test.ts:778` (usage error names the flag, writes no status file), `:831` (per-verb help). Re-verified 2026-10-16 (verifyall L1 --force): all four `--help` exit 0; `builder pr-check --bogus` exit 1 `error: unknown option '--bogus'`; 94 pass / 0 fail across builder + pr + parity CLI suites. |
| R2 | MET | Composition equivalence tests in `apps/cli/tests/commands/builder/pr.test.ts`: `:496` pr-check = preflight→hygiene, `:521` preflight FAIL stops, `:541` BLOCK verdict, `:577` pr-open = push→ensure, `:619` rejected push stops, `:639` pr-status = status+collect as `review`, `:677` pr-review = request→wait→collect, `:722` --no-wait → PENDING, `:754` exit 3 → verdict PENDING (never FAIL); all against the argv-recording stubbed runner. Run: `(bun test apps/cli/tests/commands/builder/pr.test.ts apps/cli/tests/commands/builder.test.ts)` → 39 pass / 0 fail. |
| R3 | MET | `config/workflows/pr-review.yaml:40` `initialState: check`, states `:59` check → `:80` precheck → `:92` open → `:111` review, terminals `:140` done / `:142` pending / `:144` failed; vars `:49-57` mode/baseBranch/focus/noWait/waitTimeoutSec/waitIntervalSec/preReviewCmd. Generated copy `apps/cli/config/workflows/pr-review.yaml` is byte-identical to the source (diff clean). Run: `(bun test packages/app/tests/services/pr-review/pr-review.test.ts)` → 81 pass / 0 fail, incl. `:143` state order/terminals and `:222` mode/noWait → one word per flag. Re-verified 2026-10-16 (verifyall L1 --force): `diff -q config/workflows/pr-review.yaml apps/cli/config/workflows/pr-review.yaml` identical; pr-review service suite green (122 pass / 0 fail with branch-topology). |
| R4 | MET | `apps/cli/src/commands/builder/pr.ts:166` `registerBuilderPrAliasCommand`, `:168` `.command('pr', { hidden: true })`. Probe `bun apps/cli/src/index.ts builder pr` → exactly one stderr line `spur builder pr is deprecated; use spur builder pr-status` followed by the other three verb names pipe-joined, and `pr` is absent from `builder --help`. `apps/cli/tests/commands/builder/pr.test.ts:847` (single line naming the replacement verb) and `:857` (pass-through unchanged). Run: `(bun test apps/cli/tests/script-absorption-pr7-parity.test.ts)` → 21 pass / 0 fail, golden parity with only the deprecation line stripped. Re-verified 2026-10-16 (verifyall L1 --force): `builder pr` printed `spur builder pr is deprecated; use spur builder pr-status |
| R5 | MET | `docs/design/harness-surface-governance.md:189` records the 2026-10-16 feature-L1 consent for replacing `pr` with four flat verbs plus the hidden one-release deprecation, with the new frozen list at `docs/design/harness-surface-governance.md:205`; `plugins/sp/skills/spur-cli/references/builder.md:19` (frozen at eight verbs) + `plugins/sp/skills/spur-cli/references/builder.md:36-39` (per-verb flag table); `plugins/sp/skills/pr-reviewing/SKILL.md:63` and `plugins/sp/skills/pr-reviewing/SKILL.md:110` call `spur builder pr-check`. Re-verified 2026-10-16 (verifyall L1 --force): `(cd plugins/sp && bun test tests/help-docs-parity.test.ts)` 3 pass / 0 fail. |

| Acceptance Criteria | Status | Evidence Type | Evidence |
|---------------------|--------|---------------|----------|
| AC1 — The pull-request operations are four flat builder verbs with their own help | MET | command | `bun apps/cli/src/index.ts builder <verb> --help` exits 0 for pr-status/pr-check/pr-open/pr-review, each listing only its own flags plus `--json` and `--status-file` (`apps/cli/src/commands/builder/pr.ts:59`); `bun apps/cli/src/index.ts builder pr-check --bogus` exits 1 with `error: unknown option '--bogus'` (`apps/cli/tests/commands/builder/pr.test.ts:831`). Re-verified 2026-10-16 (verifyall L1 --force): four `--help` exit 0; `--bogus` exit 1 (`apps/cli/tests/commands/builder/pr.test.ts:778`). |
| AC2 — The pr-review workflow runs on the four verbs with its verdict contract intact | MET | test | `(bun test packages/app/tests/services/pr-review/pr-review.test.ts)` → 81 pass / 0 fail: `:143` asserts `config/workflows/pr-review.yaml:59` runs check → precheck → open → review with terminals done/pending/failed, and `:222` asserts the mode/noWait flag composition (`mode=submit` passes a separate `--no-wait` word; no `--no-wait--force` concatenation). |
| AC3 — The builder surface is documented where the CLI facade and design index look | MET | test | `(bun test plugins/sp/tests/help-docs-parity.test.ts)` → 3 pass / 0 fail (R1/R2/R3: every invocation in `docs/help{,2}` names a live verb/flag, every live verb/flag is documented, and `docs/help/spur-cli-matrix.md` cells/counts equal the live surface); `docs/help/cmd_builder.md:171` and `docs/help2/builder.md:151` document the deprecated alias, `plugins/sp/skills/spur-cli/references/builder.md:19` the four verbs, `docs/04_DESIGN.md:87` links the design satellite. |
- Coverage: N/A (verdict-based; verify pipeline does not measure code coverage)

### Review

#### Review Report — 1219 (round 2)

**Scope:** working-tree diff of task 1219 (16 paths on `1a68a4c59`: `apps/cli/src/commands/builder/pr.ts` + `builder.ts`, `packages/app/src/services/pr-review/index.ts`, `config/workflows/pr-review.yaml` + generated twin, three CLI test files, one app test file, governance + three help docs + two skill docs). Pipeline-owned corpus paths (`docs/tasks5/1219_*.md` status flips, `docs/features/**`) excluded. Round 1's two blockers were repaired in this tree; this pass verifies the repairs and re-walks the whole contract.
**Dimensions:** functional, security, efficiency, correctness, usability, architecture
**Verdict:** PASS

##### Findings (ranked)

| # | Priority | Dimension | Finding | Location | Disposition |
|---|----------|-----------|---------|----------|-------------|
| 1 | P1 (blocker) | correctness | Round 1: `mode=submit` never passed `--no-wait`, so submit polled to `waitTimeoutSec` and could return `done` where the contract says `pending`. Fixed: the substitution is now two distinct command substitutions, the first testing `[ "$mode" = submit ] \|\| [ "$noWait" = "true" ]` — so every documented route emits `--no-wait`. Verified by executing the real state command under `/bin/sh -c` (argv-recording stub) and by full `workflow run`s: `submit`/`noWait=true` → argv `--no-wait`, final state `pending`. | `config/workflows/pr-review.yaml:126`, `:129` | RESOLVED |
| 2 | P2 (major) | correctness | Round 1: the two flag halves concatenated with no separator, so `noWait=true` + `mode=rerun` produced the single token `--no-wait--force`, which Commander rejects → no status file → `FAIL` fallback → `failed`. Fixed: two separate `$(…)` substitutions separated by a space, and the unquoted `$O` splits into words. Verified: `mode=rerun noWait=true` → argv `--no-wait --force`, `review → pending`; a regression test now pins all six `mode`/`noWait` combinations and asserts the verb's own verdict landed (no `FAIL` fallback). | `config/workflows/pr-review.yaml:126`, `:129`; `packages/app/tests/services/pr-review/pr-review.test.ts:222-285` | RESOLVED |
| 3 | P4 (advisory) | correctness | `pr-check` exits 2 on `BLOCK` while the task's own verb table exit column reads "0 on PASS/WARN/BLOCK/FAIL verdicts". The shipped value is the one R2/S4 require (composition parity with the retired `hygiene` op, which exits 2 on BLOCK), matches satellite §3.2 ("0, 2") and §4, and is documented in the verb description and help docs; the task-file cell is the outlier. Not blocking: the workflow's `check` guard accepts only `PASS\|WARN`, so BLOCK routes to `failed` under either exit code. Carried from round 1 without re-litigation. | `packages/app/src/services/pr-review/index.ts:1175-1194` | ACCEPTED |
| 4 | P4 (advisory) | architecture | The composition reaches the ops through their string/IO interface rather than a typed seam: `runVerbOp` swaps the module-global `io` to capture stdout (restored in `finally`) and builds op argv that `parseArgs` re-parses. Both are sound for a single-caller CLI process. The one deepening opportunity — carry the sink (and a pre-parsed `ParsedArgs`) on `SpineRuntime` so the composers call `cmd*` directly — is deferred: the task's Invariants bound service edits to `runPrVerb` and its types, and no behaviour depends on it today. Carried from round 1. | `packages/app/src/services/pr-review/index.ts:1106-1146` | ACCEPTED |

##### Functional Traceability

| Req | Status | Evidence |
|-----|--------|----------|
| R1 | MET | `apps/cli/src/commands/builder/pr.ts` registers the four flat verbs, each declaring only its own flags plus `--json` and `--status-file` (no cross-verb bleed: `pr-review --help` has no `--scan-only`, pinned at `apps/cli/tests/commands/builder/pr.test.ts:837-845`). Unknown flags exit 1 naming the flag — probed live on all four (`pr-status`/`pr-check`/`pr-open`/`pr-review` `--bogus` → `error: unknown option '--bogus'`, exit 1, no status file), and pinned for `pr-check`. |
| R2 | MET | `apps/cli/tests/commands/builder/pr.test.ts` runs each verb through the CLI and the former op sequence through the service `main()` against the same `setCommandRunner` stub, comparing stdout JSON parts, `--status-file` verdict and exit code — a genuine op-sequence comparison (`legacyReviewOps` rebuilds `request → wait → collect` from the request record, not restated expectations). Fresh run 60/60 pass across the three CLI files. The composition always drives the ops with `--json`, so each verb's payload embeds the ops' own records (verified: `pr-status.review` equals the `collect` payload; `pr-review.findings` equals the collected findings). |
| R3 | MET | `config/workflows/pr-review.yaml` collapses to `check → precheck → open → review` with terminal `done`/`pending`/`failed`, all seven tuning vars (`mode`, `baseBranch`, `focus`, `noWait`, `waitTimeoutSec`, `waitIntervalSec`, `preReviewCmd`) and no `file.read.into-var`/`prSince`/`prHead` plumbing. `workflow validate pr-review --json` → `valid: true` (only warn-level §1.2 composition advisories: precheck 7, open 6, review 10 logical commands). Live `workflow run` routes: `full` → done, `rerun` (argv `--force`) → done, `submit`/`noWait=true`/`rerun+noWait` (argv `--no-wait [--force]`) → pending, wait timeout (exit 3 + `PENDING`) → pending, review FAIL (exit 2) → failed, `check=BLOCK`/`check=FAIL`/`open=FAIL` → failed, `open=CREATED`/review `CLEAN`/`FINDINGS` → done. |
| R4 | MET | Hidden alias `apps/cli/src/commands/builder/pr.ts:166-178` prints exactly one stderr deprecation line naming the replacement verb (probed: `builder pr preflight` → `spur builder pr preflight is deprecated; use spur builder pr-check`; an unknown/absent op prints the four-verb list) and then runs the unchanged pass-through — `apps/cli/tests/script-absorption-pr7-parity.test.ts` replays the PR-7 golden with only that line stripped, and `pr.test.ts` pins the line's text and single occurrence. `main()`/`parseArgs` were not touched (the service diff is additive after `runSpine`). |
| R5 | MET | Governance §3 amendment (`docs/design/harness-surface-governance.md:194-212`) records the four verbs, the rejected shapes and the deprecation; `plugins/sp/skills/spur-cli/references/builder.md` documents all four verbs, flags, verdicts and exit codes; `plugins/sp/skills/pr-reviewing/SKILL.md` calls the new verbs in every mode (including `fix`'s `pr-review --force`); `docs/help/cmd_builder.md`, `docs/help2/builder.md`, `docs/help/spur-cli-matrix.md` updated (`help-doc-parity` 2/2 pass). |
| AC1 | MET | Per-verb `--help` renders for all four (probed); `builder --help` lists exactly `bump-ver, drop-tags, publish, show-branches, pr-status, pr-check, pr-open, pr-review` with `pr` hidden, pinned in `apps/cli/tests/commands/builder.test.ts:63-86`. |
| AC2 | MET | The four verbs carry the workflow: CLEAN/FINDINGS → `done`, PENDING (in-flight, `--no-wait`, wait timeout exit 3) → `pending`, red check/preflight/push/ensure/probe failure → `failed` — all executed end-to-end against the real workflow definition in a throwaway cwd. Round 1's `submit` gap is closed (finding 1). |
| AC3 | MET | Builder surface documented where the CLI facade and design index look: matrix verb count 8, both help trees, the `sp:spur-cli` reference, and `docs/04_DESIGN.md:87` indexes the satellite. |

##### SECUA notes

- **Security:** no force-push path anywhere in the change — `cmdPush` uses `git push`/`git push -u origin HEAD` only, `pr-open` exposes no force flag, and `--force` is scoped to the review request. Status files receive one verdict word; no token/credential is written. `pr-check --scan-only` is the only dirty-tree bypass and is preflight-only (hygiene still runs).
- **Efficiency:** one process per verb (four ops in one runtime), the ops always run `--json` so their records are read losslessly, and no extra git/gh round trips were added — the `--no-wait` path is pinned to a single `pulls/N/reviews` fetch, and the workflow lost three states and the request-record file-var reads.
- **Correctness:** in-process composition and verdict mapping verified above; `ALREADY_REVIEWED` collects without a second request (test asserts `next.posted` is empty); wait timeout exits 3 carrying `PENDING`, never `FAIL` (real run: exit 3, status file `PENDING`); usage errors exit 1 with no status file (validated `--timeout`/`--interval` before the request posts).
- **Usability:** `--help` per verb with per-verb descriptions and exit codes; unknown flags exit 1 naming the flag.
- **Architecture:** CLI stops at option mapping (ADR-021); sequencing lives in `runPrVerb`; the alias keeps the absorbed argv parser; the generated twin is byte-identical to its source (`diff` empty) and gitignored.

##### Fresh verification evidence (this run)

- `(cd apps/cli && bun test tests/commands/builder/pr.test.ts tests/commands/builder.test.ts tests/script-absorption-pr7-parity.test.ts)` → **60 pass / 0 fail**.
- `(cd packages/app && bun test tests/services/pr-review/pr-review.test.ts)` → **81 pass / 0 fail** (round 1 saw 80; the added case is the six-combination `review`-action flag test).
- `(cd apps/cli && bun test tests/help-doc-parity.test.ts)` → **2 pass / 0 fail**.
- `bun … workflow validate pr-review --json` → `valid: true`; `diff config/workflows/pr-review.yaml apps/cli/config/workflows/pr-review.yaml` → empty.
- YAML-level regression: the `review` state's exact command was extracted from the **validated** definition and run under `/bin/sh -c` with an argv-recording `spurBin` stub — `full/false → []`, `full/true → [--no-wait]`, `submit/false → [--no-wait]`, `submit/true → [--no-wait]`, `rerun/false → [--force]`, `rerun/true → [--no-wait --force]`; `FAIL` fallback did not fire.
- Full `workflow run <tree>/config/workflows/pr-review.yaml` in a throwaway cwd with a stub `spurBin` (7 cases): `full`→done, `rerun`→done, `submit`→pending, `noWait=true`→pending, `rerun+noWait`→pending, wait-timeout(ex.3)→pending, review-FAIL(ex.2)→failed; plus `check=BLOCK`/`FAIL`, `open=FAIL`→failed and `open=CREATED`, review `FINDINGS`→done.
- Real execution (throwaway `git init` repo + bare remote + fake `gh` on PATH, this tree untouched): `pr-review --timeout 0 --interval 1` → exit 3, verdict `PENDING`, status file `PENDING`; a genuinely non-fast-forward `pr-open` → exit 2, verdict `FAIL`, **zero** `gh` calls after the rejected push; `pr-check` on a dirty tree → exit 2/`FAIL`, `pr-check --scan-only` → exit 0/`PASS`; `pr-status` → exit 0 with `.review`; alias deprecation line and pass-through.
- Tree unchanged except the 16 already-dirty paths (`git status --porcelain` identical before and after this review).

##### Residual risk

- `.spur/run/<runId>-pr-findings.json` now holds the composed `{ ok, verdict, request, findings }` object instead of the retired collect record (`{ ok, verdict, pr, url, head, findings }`). No tracked consumer reads the removed fields (the `fix` route in `sp:pr-reviewing` was switched to `pr-status --json` `.review`), but an **installed** plugin copy or external script that parses `.pr`/`.url`/`.head` from that artifact would break. Carried from round 1.
- `pr-status --status-file <path>` is accepted and writes nothing (R1 requires the flag on every verb; the help text says so). A caller that treats the flag as a success signal on `pr-status` would read a stale/no file.
- `--status-file` writes still require an existing parent directory (pre-existing op behaviour — `writeStatus` uses `writeFileSync` without `mkdir`). The workflow always runs `mkdir -p .spur/run` first; a direct caller of a verb with a fresh relative path gets exit 2 (`ENOENT`), observed during probing and not introduced by this change.

##### Next

Verification/ship: R1–R5 and AC1–AC3 are all MET and the round-1 blockers are resolved with regression coverage. Only P4 advisories remain (finding 3 is a defect in the task file's own exit-code cell, which this change may not edit; finding 4 is deferred by the task Invariants). Follow-ups belong to task 1220 (`pr-status`/`pr-check --scan-only` shapes stay stable) and to the one-release `pr` alias removal.

### References

<!-- Links to the parent feature, design docs, related tasks, or external references. -->

### History

- 2026-10-16T18:23:10.575Z feature_id Q → L1 (system)
- 2026-10-16T22:45:04.113Z todo → wip (system)
- 2026-10-16T23:51:56.025Z wip → testing (system)
- 2026-10-16T23:52:50.837Z testing → done (system)

