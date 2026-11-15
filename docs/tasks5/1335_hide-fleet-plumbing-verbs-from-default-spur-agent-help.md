---
schema_version: 1
name: Hide fleet plumbing verbs from default spur agent help
status: done
template: feature-impl
created_at: 2026-11-15T04:06:32.615Z
updated_at: "2026-11-15T06:16:56.717Z"
feature_id: G8
priority: P2
tags:
  - agent
  - fleet
  - cli
  - usability
estimate_hours: 2

done_forced: "false"
done_reason: unforced close
---

## 1335. Hide fleet plumbing verbs from default spur agent help

### Background

Implements: R11 — Default agent help shows only the daily verbs.

`spur agent --help` lists fourteen verbs; four of them (`join`, `leave`, `wait`, `report`) are called by hooks, skills and guests, not typed by a user dispatching work. Operator accepted hiding them on 2026-11-14 (ADR-148, ADR-051 consent).

### Requirements

- [x] R1 — `join`, `leave`, `wait` and `report` are registered hidden, as `loop` already is; `spur agent --help` omits them.
- [x] R2 — Each still runs unchanged and `spur agent <verb> --help` still prints its help.
- [x] R3 — The `sp:spur-cli` agent reference and `sp:fleet-join` skill keep documenting them, marked as plumbing.
- [x] R4 — CLI contract baselines are regenerated; no verb is removed or renamed.

### Acceptance Criteria

- [x] AC1 — Default agent help shows only the daily verbs

### Q&A

<!-- CLOSED decisions from refinement: what was chosen and why, what was deferred and on what
     condition. Not a parking lot for open questions — an unanswered question here means the task
     is not ready to hand off. Keep empty if none. -->

### Design

Approach: commander's `{ hidden: true }` on the four registrations, the pattern `apps/cli/src/commands/agent/loop.ts` already uses.

Rejected: removing or renaming the verbs (breaks hooks and the fleet-join skill); a `--all` help flag (commander already prints a hidden verb's own help).

Invariant: behavior of the four verbs is byte-identical.

### Plan

- [ ] Add `hidden: true` to the four registrations.
- [ ] Update the help-output test and regenerate the CLI contract baseline.
- [ ] Mark the four as plumbing in the agent reference; rebuild the CLI bundle.

### Solution

Approach: register the four fleet plumbing verbs with commander's `hidden: true` option — the same mechanism `loop` already used — and leave every verb, flag and action untouched. Visibility is a presentation change only: the verbs stay registered, run unchanged, and keep their own `--help`.

| File:line | Change |
| --- | --- |
| `apps/cli/src/commands/agent/join.ts:214` | `command('join', { hidden: true })` — fleet plumbing, called by the `fleet-join` skill; verb unchanged |
| `apps/cli/src/commands/agent/leave.ts:83` | `command('leave', { hidden: true })` — the `fleet-join` skill releases the lease here |
| `apps/cli/src/commands/agent/wait.ts:283` | `command('wait', { hidden: true })` — guests and supervised loops wait on occupants |
| `apps/cli/src/commands/agent/report.ts:140` | `command('report', { hidden: true })` — a host hook reports member lifecycle |
| `apps/cli/tests/commands/agent/help-visibility.test.ts:47` | R1/R2 pins: `Help.visibleCommands` omits the plumbing set, the daily verbs stay listed, and every hidden verb keeps its own help and description |
| `plugins/sp/tests/cli-surface-parity.test.ts:166` | the reference's plumbing marker is parsed into `VerbRow.hidden` (the agent row purpose cell starts with `*Plumbing (hidden).*`) |
| `plugins/sp/tests/cli-surface-parity.test.ts:352` | the parity contract for a marked row: it must be ABSENT from `<noun> --help` and still registered (its own `--help` resolves); a visible row stays bidirectional |
| `plugins/sp/skills/spur-cli/references/agent.md:20` | verb map marks `wait`/`report`/`join`/`leave` as hidden plumbing and names the reason |
| `plugins/sp/skills/fleet-join/SKILL.md:17` | the skill states that the three verbs it drives are plumbing (hidden, still registered) |

Why: `spur agent --help` listed fourteen verbs, four of which no user dispatching work types — they are the members' and guests' plumbing. Hiding them keeps the daily surface (run/list/status/doctor/trace/start/stop/usage) and removes the fleet vocabulary from the default help, which is the operator's complaint behind ADR-148.

Baselines regenerated (correcting an earlier claim in this section): one *does* enumerate the visible agent verbs — `plugins/sp/tests/cli-surface-parity.test.ts` derives the live inventory by parsing `<noun> --help` text, so hiding the four verbs surfaced them as `documentedNotOnCli`. The reference now marks those rows, and the parity contract inverted for them (listed must be false, registered must be true), so hiding can never silently become removal. `help-doc-parity`, `cli-depth-guard` and `spur-cli-parity` needed no change: they are flag-set and row based, and no verb was removed or renamed.

### Testing

**Pipeline verify results**

- Verdict: PASS (from verdict artifact)

| Requirement | Status | Evidence |
|-------------|--------|----------|
| R1 — `join`, `leave`, `wait`, `report` registered hidden as `loop` already is; `spur agent --help` omits them | MET | `apps/cli/src/commands/agent/join.ts:217`, `leave.ts:84`, `wait.ts:284`, `report.ts:141` vs precedent `loop.ts:36`; live `spur agent --help` `Commands:` block lists only the 8 daily verbs + `help`; `apps/cli/tests/commands/agent/help-visibility.test.ts:42-54` (3 pass) |
| R2 — each still runs unchanged and `spur agent <verb> --help` still prints its help | MET | four diffs add only `{ hidden: true }` + comment; `_hidden` read only at `node_modules/.bun/commander@14.0.3/node_modules/commander/lib/help.js:41,43`; live `join`/`leave`/`wait`/`report --help` → exit 0 with `Usage: spur agent <verb> …`; `help-visibility.test.ts:57-63` |
| R3 — `sp:spur-cli` agent reference and `sp:fleet-join` skill keep documenting them, marked as plumbing | MET | `plugins/sp/skills/spur-cli/references/agent.md:21-24` + rows `:30,33,34,35`; `plugins/sp/skills/fleet-join/SKILL.md:19-21` |
| R4 — CLI contract baselines regenerated; no verb removed or renamed | MET | the one baseline that enumerated visible agent verbs is updated and green: `plugins/sp/tests/cli-surface-parity.test.ts:360-419` (marker parse `:205-210`), 22 pass / 0 fail; no verb removed or renamed (`apps/cli/src/commands/agent/index.ts` untouched, registration diffs change only the options arg); `help-doc-parity`/`cli-depth-guard`/`spur-cli-parity` unaffected (flag-set, in-process-tree and docs↔docs respectively) |

| Acceptance Criteria | Status | Evidence Type | Evidence |
|---------------------|--------|---------------|----------|
| AC1 — Default agent help shows only the daily verbs | MET | test | `apps/cli/tests/commands/agent/help-visibility.test.ts:42-54` (3 pass / 0 fail); live `spur agent --help` lists `list, status, usage, doctor, dogfood-gate, dogfood-validate-report, run, trace, start, stop, help` — no `join`/`leave`/`wait`/`report`/`loop` |
- Coverage: N/A (verdict-based; verify pipeline does not measure code coverage)

### Review

<!-- spur:record-review -->

**SECU findings** (pipeline verify step — verdict: PASS)

| Priority | Dimension | Location | Finding |
|----------|-----------|----------|----------|
| P4 | — | — | No findings (verify verdict PASS) |

### References

<!-- Links to the parent feature, design docs, related tasks, or external references. -->

### History

- 2026-11-15T05:59:49.261Z todo → wip (system)
- 2026-11-15T06:16:55.252Z wip → testing (system)
- 2026-11-15T06:16:56.713Z testing → done (system)

