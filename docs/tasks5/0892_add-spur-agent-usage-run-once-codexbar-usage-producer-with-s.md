---
schema_version: 1
name: "Add spur agent usage: run-once codexbar usage producer with snapshot file, provider-to-executor mapping, dry run, fail-closed exit, and the ADR-051 consent row"
status: todo
template: feature-impl
created_at: 2026-09-17T23:19:46.554Z
updated_at: "2026-09-18T01:07:57.766Z"
feature_id: B6
priority: P1
tags:
  - cli
  - agent
  - usage
  - codexbar
  - B6
estimate_hours: 8

dependencies: ["0891"]
---

## 0892. Add spur agent usage: run-once codexbar usage producer with snapshot file, provider-to-executor mapping, dry run, fail-closed exit, and the ADR-051 consent row

### Background

The operator's original design: an external scheduler runs a command that dumps `codexbar usage --format json --provider all` and refreshes executor availability. Authority: `docs/design/session-pinned-dispatch.md` §3.4, AC R5/R6/R7/R9; ADR-051 consent for the new verb `spur agent usage` granted at design-approval 2026-09-17 (rejected shape: `spur agent doctor --refresh-usage`).

Premise P1 (codexbar JSON shape) was partially verified on 2026-09-17 with CodexBar 0.60.4, run inside the sandbox:

- The command prints a JSON array of per-provider entries and **exits 1 whenever any provider fails**, even when the array is valid. The exit code alone is therefore not a failure signal.
- A failing entry is `{ "provider", "source", "error": { "code", "message", "kind" } }`.
- A healthy entry is `{ "provider", "source", "usage": { "primary", "secondary", "tertiary", "extraRateWindows", "updatedAt", "identity", ... } }`. Each rate window carries `usedPercent`, `resetsAt`, `windowMinutes` and an optional `resetDescription`; `tertiary` may be `null`.
- Only `antigravity` was healthy in the sandbox (cookie-cache lock EPERM and missing CLIs broke the rest). A redacted sample is at `/Users/robin/xprojects/spur-new/.spur/run/3fc16af1-f2e7-4afd-9f05-59fc6ce555c5-codexbar-sample.redacted.json`. Plan step 1 still captures a sample with healthy `claude`/`codex` entries outside the sandbox before any adapter code.

Exhaustion rule (fixed at readiness, not left to the implementer): a provider is exhausted when any non-null `primary|secondary|tertiary` window has `usedPercent >= 100`, and has headroom when every non-null window is below 100. `extraRateWindows` stays in `raw` only. Known ceiling: a provider whose windows split by model family (antigravity: Gemini vs Claude/GPT) is judged as a whole; per-family mapping is a later item if it misfires.

### Requirements

- [ ] R1. `spur agent usage [--dry-run] [--source codexbar] [--json]` exists under the `agent` noun; it runs `codexbar usage --format json --provider all`, writes `~/.config/spur/agent-usage.json` (`captured_at`, `source`, `providers[]`, `raw`) atomically, maps providers to executors via `agent.executors[].agent` + model/provider prefix, and emits `owner: quota` availability observations through the task-4 updater path using the Background exhaustion rule (`resetsAt` and the window name go into the observation reason); unmapped providers are listed in the output and never guessed.
- [ ] R2. `--dry-run` prints the would-be changes (executor, from → to, owner, reason) and writes neither the snapshot nor any config file.
- [ ] R3. A missing codexbar binary, or output that is not a parsable JSON array of provider entries (whatever the exit code), exits non-zero with the cause on stderr and changes nothing; the previous snapshot is left intact. A non-zero exit with a parsable array is not a failure: each `{ "error": … }` entry is skipped for its provider (listed in the output, no observation emitted, never treated as recovery) while healthy entries are still applied.
- [ ] R4. `spur serve` contains no scheduler, timer or hook that invokes the producer (asserted by a test that greps the serve module for the command and by the design's R9 scenario); the `agent.md` reference documents the external-scheduler pattern (cron/launchd, same as `spur history daily`).
- [ ] R5. The codexbar adapter is a small `UsageSource` interface with one implementation and a fixture captured from a real `codexbar` run (redacted), used by the tests.
- [ ] R6. `docs/design/harness-surface-governance.md` gains the consent row (date, task WBS, verb + flags, rationale, rejected shape); `plugins/sp/skills/spur-cli/references/agent.md` documents the verb; the `setProjectExecutorDisabled` wrapper from task 4 is deleted.
- [ ] R7. Tests in `apps/cli/tests/commands/agent*` cover R1–R3 with the fixture and a stubbed binary; `bun run spur-check` passes.

### Acceptance Criteria

Covers feature B6 scenarios R5, R6, R7, R9.

- [ ] AC1 — The usage producer captures a snapshot and applies quota-owned changes (req: R1)
- [ ] AC2 — The usage producer supports a dry run (req: R2)
- [ ] AC3 — A missing or failing codexbar changes nothing (req: R3)
- [ ] AC4 — The producer is never scheduled by spur serve (req: R4)

### Q&A

<!-- CLOSED decisions from refinement: what was chosen and why, what was deferred and on what
     condition. Not a parking lot for open questions — an unanswered question here means the task
     is not ready to hand off. Keep empty if none. -->

### Design

Decision: one run-once command, scheduled outside Spur, rather than a poller in `spur serve` (docs/design/session-pinned-dispatch.md §3.4; feature Scope 'no hidden automation'). The producer reuses task 4's updater so there is exactly one write path to availability; it emits observations, it does not edit YAML itself. `UsageSource` is an interface with one implementation because the operator named a second candidate source in the idea; if that never materializes the interface is a five-line cost. Dry-run is the default-safe verification path for cron authoring. Mutation policy: `apps/cli/src/commands/agent.ts` (verb), `packages/app/src/services/agent-usage-*.ts` (adapter, mapping, snapshot), tests + fixture, governance row, spur-cli `agent.md`, `config/config.example.yaml` comment; no doctor rendering (task 6).

### Plan

1. Outside the sandbox, run `codexbar usage --format json --provider all` and save a redacted sample under `apps/cli/tests/fixtures/codexbar-usage.json`; note the codexbar version in the fixture header.
2. Read design §3.4 and the task-4 updater API; define `UsageSource` and the codexbar adapter; define the snapshot shape.
3. Implement provider→executor mapping and observation emission; implement `--dry-run` and the fail-closed exits.
4. Register the verb in `agent.ts`; add the governance row and the `agent.md` reference; delete the task-4 wrapper.
5. Write the tests (fixture, stubbed binary, serve-has-no-scheduler assertion); run `cd apps/cli && bun test tests/commands/agent*` then `bun run spur-check`.
6. Record `## Solution` with a file:line map via `spur task update <wbs> --section Solution --from-file`.

### Solution

<!-- Filled during implementation: file:line change map and concise rationale. -->

### Testing

<!-- Filled during verification: commands run, outcomes, coverage claim or N/A. -->

### Review

<!-- Filled during review: P1-P4 findings, residual risk, and final disposition. -->

### References

<!-- Links to the parent feature, design docs, related tasks, or external references. -->

### History
