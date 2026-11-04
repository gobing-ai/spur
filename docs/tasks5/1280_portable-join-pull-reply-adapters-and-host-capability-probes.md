---
schema_version: 1
name: Portable join/pull/reply adapters and host capability probes
status: done
template: feature-impl
created_at: 2026-10-22T07:00:38.144Z
updated_at: "2026-10-26T23:48:25.321Z"
feature_id: G75
priority: P2
tags:
  - fleet
  - performance

dependencies: ["1279"]
ac_altitude: task-local
ac_numbering: task-local
estimate_hours: 6
done_forced: "false"
done_reason: unforced close; PASS artifact at .spur/memory/evidence/1280-verdict.json
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

- [x] R1. Record exact host binary path/version and mode (interactive, headless) provenance and a supported/unsupported native wake capability per Codex, Claude Code and Pi, from installed-host evidence only.
- [x] R2. Each host joins, waits for a bounded inbox request, performs the work and replies with hooks absent, through the durable inbox.
- [x] R3. An unsupported native wake channel is reported as an explicit `pull-only` capability with an actionable reason.

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

| File | Change | Why |
| --- | --- | --- |
| `scripts/commands/fleet-e2e.ts:1331-1478` | New host-probe model: `HOST_PROBE_REPORT_PATH`, `HOST_PROBE_AGENTS`, `HOST_PROBE_MODES`, `HostCapabilityRow`/`HostCapabilityReport`, `classifyHostWake`, `buildHostRow`, `hostReportViolations`, `redactProbeOutput` | The report's contract has to be decided by code, not prose: an absent binary can never advertise a wake channel, and a non-`pull-only` wake with no recorded evidence is downgraded — an unprovable capability is not a capability (R1/R3). Precedence is specificity: a server endpoint outranks a flag that merely names hooks, which is why Codex reports `app-server` rather than `hook`. |
| `scripts/commands/fleet-e2e.ts:1500-1520` | `wakeEvidenceLine` — cites the one `--help` line that proves the channel, preferring a line that documents the surface over one that disables or bypasses it | AC1 requires every non-`pull-only` value to cite the probe command and the observed output. A truncated help dump proves nothing; `--bare Minimal mode: skip hooks` proves hooks exist but not that they are a wake channel. |
| `scripts/commands/fleet-e2e.ts:1522-1545` | `probeHostBinary` + `probeEvidence`: `Bun.which`, `<bin> --version`, full `<bin> --help` for classification, bounded per-row evidence | Full help text is required — the capability line sits hundreds of lines into `claude --help`, and truncating the probe text silently turned a hook-capable host into `pull-only` during development. |
| `scripts/commands/fleet-e2e.ts:1547-1630` | `runFixtureHost` — spawns one fixture child per executor, waits for its guest record, sends the bounded request, then requires the operator inbox to show a reply linked to that request | AC2: the portable loop has to be proven by a **real child process** driving the CLI with hooks absent, not by the harness playing the session. |
| `scripts/commands/fleet-e2e.ts:1631-1683` | `runRealHost` — the opt-in lane; `<bin>` non-interactive invocation, guest join/wait/reply, exact failure recorded when the host never joins | AC3: strictly opt-in, and a host that cannot participate records why instead of manufacturing a pass. The default lane never reaches this function. |
| `scripts/commands/fleet-e2e.ts:1691-1760` | `runHostProbe` — scratch project (`git init` + `self init`), per-agent probe + fixture lane, report written only after `hostReportViolations` is empty | Fail-closed artifact: a report that breaks its own contract is not written. The unrequested agents still get rows so the file stays one row per host×mode. |
| `scripts/commands/fleet-e2e.ts:711-781, 1756-1762` | `parseArgs` gains `--host-probe`, `--real-hosts`, `--agents <csv>`; the mode dispatches before the matrix lane | Internal repo runner (`scripts/commands`, ADR-130) — no new `spur` noun or verb, per governance §2. |
| `scripts/commands/fixtures/fleet-host-fixture.ts:1-82` | New scripted fixture host: reads its agent/guest id from env, runs `agent join` → `wait --inbox` → `message reply` → `agent leave`, writes a JSON result | One parameterized fixture instead of three near-identical copies; it is the real child process AC2 asserts on. |
| `scripts/commands/fleet-e2e-host-probe.test.ts:1-171` | New suite pinning the contract failures first: absent binary advertising wake, help-only evidence, headless claiming a callback, unredacted secrets/home path, missing/duplicate rows, unknown `--agents`, fixture verb order | The matrix lane's precedent (`fleet-e2e-matrix.test.ts`): the harness body only collects observations, the decision functions carry the pass/fail words. |
| `plugins/sp/skills/fleet-join/SKILL.md` | Pull loop restated as the default path (never repeated model turns or busy polling), plus a probed capability table pointing at the report instead of asserting parity | Surface truth for the host that runs the skill; the table carries a re-read-the-report instruction because the values are installed-host evidence. |
| `docs/reports/fleet-host-capabilities.json` | The artifact: 6 rows (3 hosts × 2 modes) with binary path/version, wake, evidence line, and the fixture-lane result per host | AC1's repeatable artifact, regenerated by `bun run fleet-e2e --host-probe`. |

### Testing

**Pipeline verify results**

- Verdict: PASS (from verdict artifact)

| Requirement | Status | Evidence |
|-------------|--------|----------|
| R1 | MET | `scripts/commands/fleet-e2e.ts:1545` `buildHostRow` builds each host×mode row from installed evidence only (absent binary → no wake channel); `docs/reports/fleet-host-capabilities.json:6` records codex/claude/pi path, version, wake and the probe command + observed output; `scripts/commands/fleet-e2e-host-probe.test.ts:123` pins one row per host×mode, evidence-or-nothing (re-run 2026-10-26: 56 pass / 0 fail) |
| R2 | MET | `scripts/commands/fixtures/fleet-host-fixture.ts:1` real child process drives join → wait --inbox → message reply → leave with no hooks; `scripts/commands/fleet-e2e.ts:1737` requires the operator inbox to show a reply linked to the request; `scripts/commands/fleet-e2e-host-probe.test.ts:170` pins the verb order |
| R3 | MET | `scripts/commands/fleet-e2e.ts:1514` headless mode is `pull-only` with a reason; `scripts/commands/fleet-e2e.ts:1571` downgrades an unproven help-text claim to `pull-only` with an actionable reason; `scripts/commands/fleet-e2e-host-probe.test.ts:75` covers the downgrade |

| Acceptance Criteria | Status | Evidence Type | Evidence |
|---------------------|--------|---------------|----------|
| AC1 — R2 — Codex Claude Code and Pi participate through portable inbox adapters (req: R1, R3) | MET | test | `scripts/commands/fleet-e2e-host-probe.test.ts:123` report contract (one row per host×mode, non-pull-only wake needs probe evidence) passes this run; generated report `docs/reports/fleet-host-capabilities.json:6` carries 6 rows with `e2e` fixture-lane results |
| AC2 — The portable loop works with hooks absent (req: R2) | MET | test | `scripts/commands/fleet-e2e-host-probe.test.ts:170` fixture verb order passes this run; `scripts/commands/fleet-e2e.ts:1737` linked-reply check |
| AC3 — Real hosts are opt-in (req: R2) | MET | test | `scripts/commands/fleet-e2e-host-probe.test.ts:165` unknown `--agents` entry refused before host work; `scripts/commands/fleet-e2e.ts:1867` real-host lane only when `realHosts === true` |
- Coverage: N/A (verdict-based; verify pipeline does not measure code coverage)

### Review

Confidence: MEDIUM

#### Review Report — 1280

**Scope:** 1280 diff (5 files, +~430 lines) against Requirements R1–R3 and AC1–AC3
**Dimensions:** functional, security, correctness, usability, architecture
**Verdict:** PASS

##### Findings (ranked)

| # | Priority | Dimension | Finding | Location | Disposition |
|---|----------|-----------|---------|----------|-------------|
| 1 | P4 (advisory) | efficiency | `runHostProbe` probes each binary twice (once for the real-host lane, once for the row loop), costing two extra `--version`/`--help` spawns per agent | `scripts/commands/fleet-e2e.ts:1691` | ACCEPTED |
| 2 | P4 (advisory) | correctness | `runFixtureHost` lets a fixture that never joins throw, aborting the probe instead of recording one failed row — deliberate: `runRealHost` records because a real host declining to join is a host property, while a fixture that cannot join is a harness defect that must fail loudly | `scripts/commands/fleet-e2e.ts:1547` | ACCEPTED |
| 3 | P4 (advisory) | usability | the wrapped `--help` evidence line can be a continuation fragment (`claude` cites `filtering (e.g., --debug=hooks,mcp or`) rather than a whole flag | `scripts/commands/fleet-e2e.ts:1505` | ACCEPTED |

##### Verified evidence

- `bun run fleet-e2e --host-probe` → exit 0, `docs/reports/fleet-host-capabilities.json` regenerated with 6 rows: codex `app-server`, claude `hook`, pi `rpc`, all headless `pull-only`, and `e2e: passed` on every interactive row (fixture lane, hooks absent).
- Full quality gate (`spur self exec check`, tier `full`) green on this tree: `.spur/run/1280-test-gate.status` = `PASS` (tree `7e06974e`).
- `bun test scripts/commands/fleet-e2e-host-probe.test.ts` → 15 pass, 0 fail; `spur self exec rules-pre` → all 51 rules passed.
- Security: the report is the only external artifact and it is redacted by construction (`scripts/commands/fleet-e2e.ts:1367`); a credential-shaped token or the operator's home prefix never reaches it (pinned at `scripts/commands/fleet-e2e-host-probe.test.ts:104`). The probe only *runs* installed binaries with `--version`/`--help`; the opt-in real-host lane is the only path that launches an agent and the default lane cannot reach it (`scripts/commands/fleet-e2e.ts:1691`).

##### Residual risk (named, not blocking)

- The opt-in `--real-hosts` lane was **not** executed in this batch: it spends real agent tokens on the operator's account, and the task's Plan requires only the default lane's artifact. Its failure recording is covered by unit tests, not by a live run — the first operator invocation is the real proof.
- Wake classification is help-surface evidence. A host that gains or renames a surface changes its row; the report is regenerated by one command, and `fleet-join/SKILL.md` tells readers to re-read it rather than trust the table.
- The report is written from whichever tree runs the probe; a worktree batch commits the worktree's copy (the same rule as every other corpus write).

##### Functional Traceability

| Req | Status | Evidence |
|-----|--------|----------|
| R1 | MET | `scripts/commands/fleet-e2e.ts:1407` builds each row from installed evidence only; `docs/reports/fleet-host-capabilities.json:6` carries path/version + wake + the matching `--help` line for codex/claude/pi × interactive/headless |
| R2 | MET | `scripts/commands/fixtures/fleet-host-fixture.ts:1` drives join → `wait --inbox` → `message reply` → `agent leave` as a real child process; `scripts/commands/fleet-e2e.ts:1547` sends the bounded request and requires the reply linked to it |
| R3 | MET | `scripts/commands/fleet-e2e.ts:1379` returns `pull-only` with a reason for headless and for any unproven surface; `scripts/commands/fleet-e2e.ts:1407` downgrades a help-only claim to `pull-only` |

**Next:** wrap 1280, then run 1281.

### References

- Feature G75 R2; design `docs/design/fleet-attached-occupants.md` §3, §6; ADR-146; governance `docs/design/harness-surface-governance.md` §2.
- Anchors: `plugins/sp/skills/fleet-join/SKILL.md`; `plugins/sp/hooks/hooks.json:87`; `scripts/commands/fleet-e2e.ts:711`; `apps/cli/src/commands/agent/wait.ts:47,63`.
- Depends on 1279. Consumer: 1283.

### History

- 2026-10-22T20:00:21.501Z todo → wip (system)
- 2026-10-22T20:35:31.851Z wip → testing (system)
- 2026-10-22T20:35:34.689Z testing → done (system)

