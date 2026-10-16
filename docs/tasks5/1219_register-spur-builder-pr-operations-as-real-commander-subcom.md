---
schema_version: 1
name: Register spur builder pr operations as real Commander subcommands
status: todo
template: feature-impl
created_at: 2026-10-16T18:16:16.609Z
updated_at: "2026-10-16T18:34:07.561Z"
feature_id: L1
priority: P2
tags:
  - cli
  - builder
  - pr-review
estimate_hours: 3

---

## 1219. Register spur builder pr operations as real Commander subcommands

### Background

Implements: R6 — The pull-request operations are four flat builder verbs with their own help; R7 — The pr-review workflow runs on the four verbs with its verdict contract intact; R13 — The builder surface is documented where the CLI facade and design index look (pull-request half).

**Reshaped on 2026-10-16 by the operator:** this task no longer registers eight `pr` subcommands. It replaces the `pr <op>` layer with four flat `pr-<verb>` verbs. The title predates that change; the CLI has no title-update verb, and the sections below are authoritative.

Today `apps/cli/src/commands/builder/pr.ts:13-21` registers one pass-through `pr [argv...]` with `.allowUnknownOption(true)` and `.allowExcessArguments(true)`, so per-op help is missing and typos are silently accepted. The only callers of the eight operations are `config/workflows/pr-review.yaml` (plus its generated copy `apps/cli/config/workflows/pr-review.yaml`), `plugins/sp/skills/pr-reviewing/SKILL.md` and `plugins/sp/skills/spur-cli/references/builder.md`. Design: `docs/design/builder-branches-and-pr-review.md` §3.2.

### Requirements

- [ ] R1. `spur builder` registers four flat verbs that compose the existing service operations: `pr-status` (status, with the collect result as a `review` field), `pr-check` (preflight, then hygiene), `pr-open` (push, then ensure), `pr-review` (request, then wait, then collect). Each declares only its own flags plus `--json` and `--status-file <path>`; unknown flags exit 1 naming the flag.
- [ ] R2. Each verb's stdout JSON, `--status-file` verdict and exit code (0 ok, 1 usage, 2 hard failure, 3 wait timeout) equal the composition of the former operations for the same stubbed git/gh responses, as specified in Design.
- [ ] R3. `config/workflows/pr-review.yaml` (and its generated copy) runs check → precheck → open → review with terminal states done, pending and failed, and keeps the `mode` values full, submit and rerun plus `noWait`, `focus`, `baseBranch`, `waitTimeoutSec`, `waitIntervalSec` and `preReviewCmd`.
- [ ] R4. `spur builder pr <op>` remains as a hidden alias for one release: it prints one stderr deprecation line naming the replacement verb, then runs the unchanged pass-through.
- [ ] R5. `docs/design/harness-surface-governance.md` §3 records the four verbs (operator consent 2026-10-16, feature L1) and the deprecation of `pr`; `plugins/sp/skills/spur-cli/references/builder.md` documents the four verbs and their flags; the existing `sp:pr-reviewing` calls switch to the new verbs so the skill keeps working before task 1220.

### Acceptance Criteria

- [ ] AC1 — The pull-request operations are four flat builder verbs with their own help
- [ ] AC2 — The pr-review workflow runs on the four verbs with its verdict contract intact
- [ ] AC3 — The builder surface is documented where the CLI facade and design index look

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

<!-- Filled during implementation: file:line change map and concise rationale. -->

### Testing

<!-- Filled during verification: commands run, outcomes, coverage claim or N/A. -->

### Review

<!-- Filled during review: P1-P4 findings, residual risk, and final disposition. -->

### References

<!-- Links to the parent feature, design docs, related tasks, or external references. -->

### History

- 2026-10-16T18:23:10.575Z feature_id Q → L1 (system)

