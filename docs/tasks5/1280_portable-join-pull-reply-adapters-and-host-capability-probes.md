---
schema_version: 1
name: Portable join/pull/reply adapters and host capability probes
status: todo
template: feature-impl
created_at: 2026-10-22T07:00:38.144Z
updated_at: "2026-10-22T16:36:56.082Z"
feature_id: G75
priority: P2
tags:
  - fleet
  - performance

dependencies: ["1279"]
ac_altitude: task-local
ac_numbering: task-local
estimate_hours: 6
---

## 1280. Portable join/pull/reply adapters and host capability probes

### Background

Implements: R2 — Codex Claude Code and Pi participate through portable inbox adapters.
Work packages B0 + B2. Generated per-platform adapters are installed through Superskill, never hand-maintained. Runs after the lease renewal task.
Rubric: E6 D1 L2 C1 R1 = 11 → own task (plugin surface, distinct review).

**Refine corrections (2026-10-22)**
- Existing flow: `plugins/sp/skills/fleet-join/SKILL.md` (68 lines) = join → `spur agent wait --inbox <id> --timeout 540000 --json` → `spur message reply <msgId>` → `spur agent leave`. Hook acceleration today is only the Claude Stop hook (`plugins/sp/hooks/hooks.json:87`). → resolution: harden and probe; no new transport.
- Claim "harden the skill flow" → constraint: governance forbids plugin scripts beyond hook entries and requires skills to call the installed `spur` CLI (`docs/design/harness-surface-governance.md` §2). → resolution: probe logic lives in `scripts/commands/fleet-e2e.ts` (`--host-probe` mode, internal), not in the plugin.
- Design §6 lists official references checked 2026-10-21 but "no hook/endpoint parity is asserted without installed-host evidence" → resolution: capability rows are evidence-only; absent evidence = `pull-only`.
- Renewal during long work comes from 1279; this task depends on it.

### Requirements

- [ ] R1. Record exact host binary path/version and mode (interactive, headless) provenance and a supported/unsupported native wake capability per Codex, Claude Code and Pi, from installed-host evidence only.
- [ ] R2. Each host joins, waits for a bounded inbox request, performs the work and replies with hooks absent, through the durable inbox.
- [ ] R3. An unsupported native wake channel is reported as an explicit `pull-only` capability with an actionable reason.

### Acceptance Criteria

```gherkin
Scenario: AC1 — R2 — Codex Claude Code and Pi participate through portable inbox adapters (req: R1, R3)
  Given `bun run fleet-e2e --host-probe`
  When it runs on a host with some agents absent
  Then `docs/reports/fleet-host-capabilities.json` has one row per host×mode with binary path/version or `absent`, a `wake` value of `hook`|`rpc`|`app-server`|`pull-only`, and every non-`pull-only` value cites the probe command and observed output

Scenario: AC2 — The portable loop works with hooks absent (req: R2)
  Given a scripted fixture host per executor (a real child process driving the installed `spur` CLI) with no hooks installed
  When an operator sends a bounded request to its guest id
  Then the fixture joins, `wait --inbox` returns the message, it replies via `spur message reply`, leaves, and the inbox shows the request settled with the reply linked

Scenario: AC3 — Real hosts are opt-in (req: R2)
  Given `--host-probe --real-hosts --agents claude,codex,pi`
  When the operator runs it
  Then each installed host's row records an end-to-end join/wait/reply result or the exact failure, and the default lane never launches a real host
```

### Q&A

<!-- CLOSED decisions from refinement: what was chosen and why, what was deferred and on what
     condition. Not a parking lot for open questions — an unanswered question here means the task
     is not ready to hand off. Keep empty if none. -->

#### Q&A entry — 2026-10-22T16:25:56.322Z

- **Q: Where does probing live?** CLOSED — `scripts/commands/fleet-e2e.ts --host-probe [--real-hosts] [--agents <csv>]` (repo evaluation runner, ADR-130 `scripts/commands` row). No plugin script, no new `spur` verb.
- **Q: Skill changes?** CLOSED — `fleet-join/SKILL.md` gains: per-host notes from the capability report, the hooks-absent loop as the default path, and "never start repeated model turns or terminal polling while busy". Adapters regenerate via `superskill install sp` — never hand-edited.
- **Q: Native wake implementation?** CLOSED — out of scope here; this task only probes and reports. Acceleration adapters are later work gated on this report.

### Design

**Files:** `scripts/commands/fleet-e2e.ts` (`--host-probe` arm in `parseArgs` `:711`; probe = `<bin> --version`, help-surface checks for hook/rpc/app-server modes, recorded verbatim, redacted); fixture hosts `scripts/commands/fixtures/fleet-host-<agent>.ts` (child processes that run join → wait → reply → leave against the scratch project); `plugins/sp/skills/fleet-join/SKILL.md`.
**Report schema:** `{schemaVersion:1, generatedAt, hosts:[{agent, mode:'interactive'|'headless', binary:{path, version}|'absent', wake:'hook'|'rpc'|'app-server'|'pull-only', evidence:{command, output}|null, reason?, e2e?:{status, detail}}]}` at `docs/reports/fleet-host-capabilities.json`.
**Invariants:** hooks are acceleration only; durable inbox is the only coordination path; generated adapters via `superskill install`.
**Rejected:** polling via repeated model turns or terminal commands; a new messaging transport.

### Plan

1. Failure cases first: host absent; version unparsable; wake unsupported; wait timeout with no message; reply to a released claim; leave while a message is claimed (returns to queued, `fleet-guest-service.ts:276`).
2. `--host-probe` mode + report writer.
3. Fixture hosts + hooks-absent E2E in the deterministic lane.
4. Skill update; `superskill install sp --dry-run` to confirm adapters regenerate.
5. `bun run fleet-e2e --host-probe` (artifact: `docs/reports/fleet-host-capabilities.json`); `bun run spur-check`.

### Solution

<!-- Filled during implementation: file:line change map and concise rationale. -->

### Testing

<!-- Filled during verification: commands run, outcomes, coverage claim or N/A. -->

### Review

<!-- Filled during review: P1-P4 findings, residual risk, and final disposition. -->

### References

- Feature G75 R2; design `docs/design/fleet-attached-occupants.md` §3, §6; ADR-146; governance `docs/design/harness-surface-governance.md` §2.
- Anchors: `plugins/sp/skills/fleet-join/SKILL.md`; `plugins/sp/hooks/hooks.json:87`; `scripts/commands/fleet-e2e.ts:711`; `apps/cli/src/commands/agent/wait.ts:47,63`.
- Depends on 1279. Consumer: 1283.

### History
