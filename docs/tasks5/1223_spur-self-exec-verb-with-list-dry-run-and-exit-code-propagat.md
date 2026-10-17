---
schema_version: 1
name: spur self exec verb with list, dry-run and exit-code propagation
status: todo
template: feature-impl
created_at: 2026-10-17T04:04:39.231Z
updated_at: "2026-10-17T04:16:42.987Z"
feature_id: A92
priority: P1
tags:
  - cli
  - self
estimate_hours: 4

dependencies: ["1222"]
---

## 1223. spur self exec verb with list, dry-run and exit-code propagation

### Background

Feature A92 (docs/design/sdlc-actions.md §3.3). Operator-named public verb `spur self exec <action>`; runs a bound action in the project root. Covers R3, R4.

**Refine corrections (2026-10-16)**
- Verbs under `self` are registered from apps/cli/src/index.ts:264 (`program.command('self')`), with each verb in its own file (maintain.ts:16) → exec.ts registers through the same selfCommand block; no other wiring point.

### Requirements

- [ ] R1. `spur self exec <action>` runs a resolved string action via `sh -c` in the project root, inherits stdio, sets `SPUR_ACTION=<name>` for the child, and exits with the child's exit code.
- [ ] R2. `-- <args>` are shQuote'd and appended to a string action; a composite with extra args exits 2 with `composite action "<a>" does not accept arguments`.
- [ ] R3. A composite runs its steps in order, stops at the first non-zero exit (spur exits with that code), and prints `▶ <step>` per step on stderr.
- [ ] R4. `--dry-run` prints the resolved command (or one line per composite step) and runs nothing.
- [ ] R5. `--list` prints a table; `--list --json` prints an array of `{ name, reserved, source, command? , steps? }` for every reserved and declared action.
- [ ] R6. An unbound action exits 2 with `action "<a>" is not bound; add builder.actions.<a> to .spur/config.yaml`; a missing action argument without `--list` exits 2 with usage.
- [ ] R7. `--json` without `--list` prints a final `{ action, steps: [{ name, exitCode, durationMs }], exitCode }` after streaming.
- [ ] R8. The spur-cli self reference (plugins/sp/skills/spur-cli/references) and docs/design/sdlc-actions.md §3.3 document the verb and flags.

Out of scope: changing any workflow/engine default (1224); init (1225); parallel composites; env-var templating in commands.

### Acceptance Criteria

- [ ] AC1 — spur self exec runs a configured action and propagates its exit code
- [ ] AC2 — spur self exec lists actions with their source

Requirement map: AC1 → R1, R2, R3, R4, R6, R7; AC2 → R5, R8. Test layer: apps/cli/tests/commands/exec.test.ts spawning the real CLI (E2E).

### Q&A

<!-- CLOSED decisions from refinement: what was chosen and why, what was deferred and on what
     condition. Not a parking lot for open questions — an unanswered question here means the task
     is not ready to hand off. Keep empty if none. -->

#### Q&A entry — 2026-10-17T04:05:53.272Z

- Owner noun is `self`, not `builder`: `self` owns project-local operations; `builder` is release plumbing.
- The operator named the verb; the flag set (--list, --dry-run, --json, --) is recorded in docs/design/sdlc-actions.md §3.3 and the operator confirms it at this task's review.

#### Q&A entry — 2026-10-17T04:16:42.791Z

- Owner noun is `self`, not `builder` (closed: ADR-139).
- The operator named the verb; the flag set (--list, --dry-run, --json, --) is recorded in docs/design/sdlc-actions.md §3.3 and is confirmed by the operator at this task's review (deferred, owner: operator, at review of 1223).
- Exit 2 for usage/unbound mirrors commander usage errors (closed).

### Design

WHAT: thin CLI transport over `packages/app/src/services/sdlc-actions.ts` (1222).
WHERE: new `apps/cli/src/commands/exec.ts` exporting `registerExecCommand(self: Command, context: CliContext, options?: { hidden?: boolean })`, wired in the `selfCommand` block at apps/cli/src/index.ts:264; tests under `apps/cli/tests/commands/exec.test.ts`.

Frozen surface: `spur self exec [action] [-- args...]` with `--list`, `--dry-run`, `--json`. Exit codes: child's code; 2 for unbound/usage/composite-args. Env: `SPUR_ACTION`. Project root = the CLI's resolved project root (same as other self verbs), not cwd.

Execution: `spawnSync('sh', ['-c', command], { cwd: root, stdio: 'inherit', env: { ...process.env, SPUR_ACTION } })` per step; composite steps recurse through `resolveAction` (cycles already rejected at load).

Why `self`: it owns project-local operations (init/status/migrate/serve/maintain); `builder` is release plumbing. The operator named the verb; the flag set is confirmed by the operator at this task's review (public-surface consent).

Anti-patterns: no in-CLI resolution logic (resolver only); no output capture/buffering (stream); do not swallow the child exit code into 1; no stack guessing when unbound.

Handoff: 1224 invokes `${spurBin:-spur} self exec <action>` from workflow vars and relies on R1/R3 exit semantics; 1227 cites this verb in plugin prose.

### Plan

1. List failure modes: unbound, composite with args, child non-zero, missing config file (bun preset still applies), no action and no --list.
2. Add exec.ts and register it under selfCommand (R1, R6).
3. Implement run / composite runner / dry-run / list / json paths (R2–R5, R7).
4. E2E in apps/cli/tests/commands/exec.test.ts: spawn the real CLI against a temp project fixture with `.spur/config.yaml` (exit-3 command, composite with a failing middle step, unbound, `--list --json`, `--dry-run`); persist captured stdout/stderr/exit codes under the test tmp dir as the artifact.
5. Update the spur-cli self reference and satellite §3.3 (R8); `bun run spur-check`.

### Solution

<!-- Filled during implementation: file:line change map and concise rationale. -->

### Testing

<!-- Filled during verification: commands run, outcomes, coverage claim or N/A. -->

### Review

<!-- Filled during review: P1-P4 findings, residual risk, and final disposition. -->

### References

<!-- Links to the parent feature, design docs, related tasks, or external references. -->

### History
