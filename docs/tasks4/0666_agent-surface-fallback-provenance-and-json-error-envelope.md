---
schema_version: 1
name: "Agent-surface fallback provenance and --json error envelope"
status: done
template: feature-impl
created_at: 2026-08-25T06:11:03.806Z
updated_at: "2026-08-25T18:12:59.721Z"
feature_id: A5
priority: P2
tags: ["config", "agent-surface", "json-error-contract"]
dependencies: ["0665"]
---

## 0666. Agent-surface fallback provenance and --json error envelope

### Background

Feature A5's agent-surface half, per accepted design docs/design/universal-config-loading.md (ADR-082; ADR-078 amendment). Today spur agent doctor coder fails live (exit 1, plain text under --json) despite globally defined executors, and DEFAULT_AGENT_ROLES masks misconfiguration silently. Once the merged config is threaded (sibling task), this task makes the agent surface honest: doctor resolves roles against the merged config, an active fallback is reported rather than silent, and agent/message failures under --json emit the standard toJson({ error: { code, message } }) envelope.

Implements: R6 — spur agent doctor resolves a globally defined executor when the project config has no agent: section; R7 — DEFAULT_AGENT_ROLES fallback is explicit (error-stream note in text mode, rolesSource field in the --json payload) when no config layer defines agent.roles; R8 — the fallback decision is recorded in the project decision record (ADR-078 amendment already drafted at design; verify it is landed); R9 — agent-surface failures (doctor unresolvable role, agent run dispatch failure) emit code 'agent-resolution' under --json with non-zero exit and no plain-text output; R10 — message send argument/usage failures emit code 'usage' under --json (message.ts:415 plain-text path removed).

Depends on: 'Wire merged config at composition roots and rewire every consumer' — this task reads the threaded spurConfig and the agentRolesSource provenance computed at the root; landing it before the sibling would leave nothing to consume.

Rejected alternatives (recorded per scope-creep guard): splitting fallback-provenance and envelope-normalization into two tasks — both edit the same doctor/run paths in agent.ts and agent-service, unreadable apart in review; changing DEFAULT_AGENT_ROLES content or applicability — unchanged per ADR-078, only observability changes; touching existing conforming envelope sites (agent.ts waitFail, message.ts sendWaitFail, builder/projects) — explicitly untouched by the design.

Rubric: this child E4 D1 L1 C0 R0 = 6 -> task (cohesion: one review context — agent-surface output behavior).

### Requirements

- [ ] R1. CliContext gains non-optional agentRolesSource: 'config' | 'fallback' computed at the CLI root from the merged agent?.roles (fallback iff no layer supplied an agent.roles table at all — whole-table, not per-role); AgentServiceContext gains optional rolesSource?: 'config' | 'fallback' and the CLI passes it through agentService(). CLI-only: the server's lazy AgentService is deliberately NOT threaded — see ### Q&A Q6.
- [ ] R2. spur agent doctor coder resolves the role against the merged config: with a globally defined executor for coder and no project agent: section, doctor reports the coder executor as configured. Expected to need no code change once 0665 lands — verify against 0665's tripwire case rather than adding a load here.
- [ ] R3. When no config layer defines agent.roles, doctor reports the active fallback: text mode writes one note line to the error stream ('agent.roles: no config layer defines a table — built-in DEFAULT_AGENT_ROLES fallback in effect'); --json mode instead adds top-level rolesSource: 'config' | 'fallback' to the doctor payload; the note never changes exit codes and never fires when a layer supplies agent.roles.
- [ ] R4. Verify the decision to retain DEFAULT_AGENT_ROLES as an explicit fallback is recorded in docs/00_ADR.md — the ADR-078 amendment is ALREADY LANDED at docs/00_ADR.md:1150. Confirm it still matches what ships (note wording, rolesSource field name); amend only on divergence, and do not author a second amendment.
- [ ] R5. agent doctor with an unresolvable role and agent run dispatch failures under --json print toJson({ error: { code: 'agent-resolution', message } }) on stdout with non-zero exit and nothing plain-text on either stream; the two real plain-text sites are packages/app/src/services/agent-service.ts:456 (doctor !resolved.ok) and :525 (run !outcome.ok) — NOT agent.ts:746, which is the already-conforming waitUsageError (see ### Q&A Q1). Post-dispatch exits at :539/:542 stay plain-text. Exit codes unchanged; reuse the module-private toJson at agent-service.ts:1996.
- [ ] R6. spur message send argument/usage failures under --json print toJson({ error: { code: 'usage', message } }) on stdout with non-zero exit; the real plain-text site is apps/cli/src/commands/message.ts:114 (empty body, exit 2) — NOT message.ts:415, which is the already-conforming sendWaitFail (see ### Q&A Q2). message watch (:72) and message reply (:263) are out of scope.

### Acceptance Criteria

```gherkin
Feature: Agent-surface fallback provenance and --json error envelope

  @core
  Scenario: R6 — `spur agent doctor` resolves a globally defined executor when the project config has no `agent:` section
    Given the global config defines an executor for role `coder` and the project config has no `agent:` section
    When the user runs `spur agent doctor coder`
    Then doctor resolves the role against the merged config and reports the `coder` executor as configured

  @core
  Scenario: R7 — The DEFAULT_AGENT_ROLES fallback is explicit when no config defines the role
    Given neither the global config nor the project config defines an executor for role `coder`
    When the user runs `spur agent doctor coder`
    Then doctor reports that the built-in DEFAULT_AGENT_ROLES fallback is in effect instead of applying it silently
    And `--json` output carries top-level `rolesSource: "fallback"` while text mode writes one note line to the error stream
    And the exit code is unchanged by the note

  @core
  Scenario: R8 — The DEFAULT_AGENT_ROLES fallback decision is recorded
    When the fallback behavior in R7 ships
    Then the decision to retain DEFAULT_AGENT_ROLES as an explicit fallback is recorded in the project's decision record

  @core
  Scenario: R9 — Agent-surface failures emit the standard `--json` error envelope
    Given an agent command invocation that will fail, such as `spur agent doctor` with an unresolvable role
    When the user runs the command with `--json`
    Then stdout carries `toJson({ error: { code: 'agent-resolution', message } })`, the exit code is non-zero, and no plain-text error is printed on either stream

  @core
  Scenario: R10 — Message-surface failures emit the standard `--json` error envelope
    Given a `spur message send` invocation that will fail on an empty body
    When the user runs the command with `--json`
    Then stdout carries `toJson({ error: { code: 'usage', message } })`, the exit code is non-zero, and the former plain-text error path is gone
```

### Q&A

Closed at refine `--depth ready` (2026-08-24). Premise checks were run against the working tree.
**Three of this task's stated file anchors were wrong** — they are corrected below and in
`### Design`, which is the authority for file placement.

**Q1. Is `agent.ts:746` a plain-text error path to remove?**
CLOSED — **no; the opposite.** `apps/cli/src/commands/agent.ts:743-751` is `waitUsageError`, and
`:753-760` is `waitFail` — both already emit `toJson({ error: { code, message } })` under `--json`.
The satellite lists them under "existing envelope sites … untouched". The **real** non-conforming
agent sites are in `packages/app/src/services/agent-service.ts`:
`:456` (`doctor` → `resolveRole` failure: `this.ctx.output.error(resolved.message)` regardless of
`args.json`) and `:525` (`run` → `!outcome.ok` dispatch failure:
`this.ctx.output.error(outcome.message)` regardless of `flags.json`). R5 retargets to those two.

**Q2. Is `message.ts:415` a plain-text error path to remove?**
CLOSED — **no.** `apps/cli/src/commands/message.ts:413-420` is `sendWaitFail`, already conforming
and listed as untouched. The real site is `apps/cli/src/commands/message.ts:114` —
`message send` with an empty body: `context.output.error(...)`, `return 2`, no `--json` branch,
even though `options.json` is in scope. R6 retargets there.

**Q3. Which failures on the agent `run` path are in scope?**
CLOSED — the **dispatch** failure only (`agent-service.ts:525`, the `!outcome.ok` branch). The two
post-dispatch process-exit messages at `:539` (`Agent terminated by signal`) and `:542`
(`Agent exited with code`) report a *successfully dispatched* agent's own exit and stay plain-text.
The satellite scopes R9 to "dispatch failure"; widening it would change the meaning of exit 3.

**Q4. Does `packages/app` need to import `toJson` from the CLI?**
CLOSED — no. `agent-service.ts` already has a module-private
`function toJson(value: unknown): string` at `:1996` (identical to `apps/cli/src/output.ts:20`) and
uses it at `:420`, `:501`, `:1947`. Reuse it. Do not add a cross-package import; `toJson` stays
CLI-owned as a *convention*, and this duplication predates the task.

**Q5. Is the ADR-078 amendment (R4) still to be authored?**
CLOSED — **already landed**, `docs/00_ADR.md:1150`: *"Amendment (2026-08-24) — the fallback is
explicit, never silent (feature A5 R7/R8)"*, naming both the error-stream note and the `rolesSource`
field. R4 is therefore **verify-only**: confirm the amendment still describes what ships (note text
and JSON field name must match the implementation) and correct it only on divergence. Do not author
a second amendment.

**Q6. Does the server's lazy `AgentService` need `rolesSource`?**
CLOSED — no. `apps/server/src/context.ts:484-497` constructs `AgentServiceImpl` with neither
`agentConfig` nor `roles` today, and no server surface runs `doctor` — `rolesSource` is doctor-only
observability, so threading it there would be a field nothing reads. This task's R1 is **CLI-only**;
the satellite's "server context does the same" clause is dropped. Companion decision in 0665
`### Q&A` Q4.

**Q7. What exactly makes `rolesSource` `'fallback'`?**
CLOSED — `agentConfig?.roles === undefined`, i.e. **no config layer supplied an `agent.roles` table
at all**. It is *not* per-role: a table that omits `coder` while defining `planner` is still
`'config'`. This matches `resolveAgentRoles` (`apps/cli/src/context.ts:52-53`), which reads
`agentConfig?.roles` as a whole-table override merged per-field over `DEFAULT_AGENT_ROLES`.

**Q8. Does R6's global-only-executor case belong to this task's tests?**
CLOSED — no; 0665 lands it. Per the satellite's test table the global-only-executor row is the
reversion tripwire and ships in `apps/cli/tests/config-layering.test.ts` with 0665. This task
**appends** the `rolesSource: 'fallback'` row to that same file rather than creating a second
layering suite.

**Deferred with owner:** none. This task is unblocked once 0665 lands `CliContext.spurConfig`.

### Design

Frozen at refine `--depth ready` on 2026-08-24. Names below are the contract — implement verbatim.
**This section, not the satellite's consumer table, is the authority for file placement**: three of
the anchors this task inherited point at already-conforming code (`### Q&A` Q1/Q2).

**WHY.** Two independent honesty gaps on the agent surface. (a) `spur agent doctor coder` resolves
roles from `this.ctx.agentConfig` (`agent-service.ts:439`), which reaches it via
`CliContext.agentConfig` — single-layer today, merged once 0665 lands, so R6 is *fixed by the
dependency* and this task only proves it. (b) When no layer defines `agent.roles`,
`resolveAgentRoles` silently substitutes `DEFAULT_AGENT_ROLES`; and three failure sites print plain
text under `--json`, so a machine consumer sees an empty stdout and a non-zero code.

**WHERE — primary file targets**

| File | Change |
| --- | --- |
| `apps/cli/src/context.ts` | `agentRolesSource` on `CliContext`; pass through `agentService()` |
| `packages/app/src/services/agent-service.ts` | `rolesSource` on ctx; note line + `rolesSource` in doctor payload; envelope at `:456` and `:525` |
| `apps/cli/src/commands/message.ts` | envelope at `:114` |
| `docs/00_ADR.md` | **verify only** — the ADR-078 amendment is already at `:1150` |
| `apps/cli/tests/config-layering.test.ts` | append the fallback case (file created by 0665) |

**WHAT — frozen shapes**

```ts
// apps/cli/src/context.ts
export interface CliContext {
    // …existing… (0665 adds spurConfig)
    /** Provenance of agentRoles: 'fallback' iff no config layer supplied agent.roles. */
    agentRolesSource: 'config' | 'fallback';
}
// in createCliContext, after agentConfig is derived from options.spurConfig?.agent:
const agentRolesSource: 'config' | 'fallback' = agentConfig?.roles === undefined ? 'fallback' : 'config';
```

Non-optional on `CliContext` (always computable), and passed into `agentService()` as
`rolesSource: context.agentRolesSource`.

```ts
// packages/app/src/services/agent-service.ts:283
export interface AgentServiceContext {
    // …existing…
    /** Provenance of `roles`. Absent → treated as 'config' (no note). */
    rolesSource?: 'config' | 'fallback';
}
```

Optional here, because the server constructs `AgentServiceImpl` without it (`### Q&A` Q6) and every
existing test constructs the ctx literal.

**Frozen strings — copy exactly.**

- Text-mode note (single line, error stream):
  `agent.roles: no config layer defines a table — built-in DEFAULT_AGENT_ROLES fallback in effect`
- JSON key: top-level `rolesSource`, values `"config"` | `"fallback"`.
- Error codes: `agent-resolution` (both agent sites), `usage` (message site).

**Behavior — doctor fallback note (R2, R3).** In `doctor()` (`agent-service.ts:438`), before
dispatching to `renderDoctor`, emit the note **once per invocation** when
`this.ctx.rolesSource === 'fallback'`:

```
text mode  → this.ctx.output.error(<frozen note>)
json mode  → no note; renderDoctor adds `rolesSource` to the payload instead
```

`renderDoctor` (`:465`) gains a `rolesSource` parameter and emits the JSON as
`toJson({ agents: rows, rolesSource })` (`:501`) — top-level sibling of `agents`, not per-row.
Exit-code logic at `:511` is **unchanged**. The note fires on every `doctor` form (with and without
a role argument) and never when any layer supplied `agent.roles`.

**Behavior — `--json` error envelope (R5, R6).** Three sites, one shape. Reuse the module-private
`toJson` already at `agent-service.ts:1996` — no new import.

| Site | Before | After |
| --- | --- | --- |
| `agent-service.ts:456` (doctor, `!resolved.ok`) | `output.error(resolved.message)` | `args.json` → `output.write(toJson({ error: { code: 'agent-resolution', message: resolved.message } }))`; else `output.error(...)`. `return resolved.exitCode` unchanged |
| `agent-service.ts:525` (run, `!outcome.ok`) | `output.error(outcome.message)` | `booleanFlag(flags, 'json')` → same envelope with `code: 'agent-resolution'`; else `output.error(...)`. `return outcome.exitCode` unchanged |
| `commands/message.ts:114` (send, empty body) | `output.error('message send requires a non-empty body')` | `options.json` → `output.write(toJson({ error: { code: 'usage', message } }))`; else `output.error(...)`. `return 2` unchanged |

Message text is propagated **verbatim** in both branches — the envelope changes the wrapper, never
the wording, so existing text-mode assertions keep passing.

**Invariants**

- Exit codes are untouched at all three sites: `resolved.exitCode`, `outcome.exitCode`, `2`.
- Under `--json`, **nothing** plain-text reaches either stream from these sites. Under text mode,
  nothing JSON does.
- The fallback note is on the **error** stream, so `--json` stdout stays machine-parseable even if a
  future caller mixes modes; and it never alters an exit code.
- `DEFAULT_AGENT_ROLES` content, its applicability rule, and the `roles.md` parity gate are
  **unchanged** (ADR-078). Only observability changes.

**Anti-patterns — do not implement**

- Do **not** touch `agent.ts:743-760` (`waitUsageError` / `waitFail`) or
  `message.ts:413-420` (`sendWaitFail`). Already conforming; explicitly untouched by the design.
  Same for the builder / projects envelope sites.
- Do **not** convert `agent-service.ts:539` / `:542` (`Agent terminated by signal` /
  `Agent exited with code`). Those report a *successfully dispatched* agent's own exit — out of
  scope (`### Q&A` Q3).
- Do **not** normalize the other `output.error` calls in `agent.ts` (`:238`, `:243`, `:302`, …) or
  `message.ts` (`:72` watch, `:263` reply). Different verbs; not in A5's AC.
- Do **not** make `rolesSource` per-role. It is whole-table provenance (`### Q&A` Q7).
- Do **not** change `DEFAULT_AGENT_ROLES` values or `resolveAgentRoles`'s signature.
- Do **not** author a new ADR-078 amendment — one is already landed (`### Q&A` Q5).
- Do **not** thread `rolesSource` into the server's `AgentService` (`### Q&A` Q6).
- Do **not** re-implement the layering test harness; append to 0665's file.

**Assumes from 0665** (`dependencies: ["0665"]`): `CliContext.spurConfig` exists and `agentConfig`
is derived from the **merged** config; `apps/cli/tests/config-layering.test.ts` exists with the
`runCli(args, cwd, env)` helper and the global-only-executor tripwire case. Landing this task first
would leave `agentRolesSource` computed from a single layer — a wrong `'config'`/`'fallback'` verdict
on any machine whose global layer alone defines `agent.roles`.

**Leaves for dependents:** nothing. A5 closes with this task.

### Plan

Ordered. Start only on a tree where 0665 has landed — step 1 reads config that 0665 makes merged.

- [ ] 1. **Provenance at the CLI root** — R1. `apps/cli/src/context.ts`: add non-optional
      `agentRolesSource: 'config' | 'fallback'` to `CliContext` (`:97`); compute it in
      `createCliContext` right after `agentConfig` is derived, as
      `agentConfig?.roles === undefined ? 'fallback' : 'config'`; pass
      `rolesSource: context.agentRolesSource` at the `agentService()` construction site (`:185`).
      `packages/app/src/services/agent-service.ts:283`: add optional
      `rolesSource?: 'config' | 'fallback'` to `AgentServiceContext`. → `bun run lint`
- [ ] 2. **Doctor fallback note** — R3. In `doctor()` (`agent-service.ts:438`), emit the frozen note
      line via `this.ctx.output.error(...)` when `this.ctx.rolesSource === 'fallback'` **and**
      `args.json` is false — once per invocation, before any `renderDoctor` call, on all three
      dispatch paths (`args.agent` undefined, role hit, executor hit). Thread `rolesSource` into
      `renderDoctor` (`:465`) and emit `toJson({ agents: rows, rolesSource })` at `:501`. Leave the
      exit-code expression at `:511` alone.
- [ ] 3. **Prove R2 (global-only executor)** — R2. No code change expected: `doctor` reads
      `this.ctx.agentConfig`, which 0665 makes merged. Confirm by running the 0665 tripwire case; if
      it fails, the defect is in 0665's threading, not here — fix there, do not add a second load.
- [ ] 4. **Agent envelope sites** — R5. `agent-service.ts:456` (doctor `!resolved.ok`) and `:525`
      (run `!outcome.ok`): branch on `args.json` / `booleanFlag(flags, 'json')` to
      `this.ctx.output.write(toJson({ error: { code: 'agent-resolution', message } }))`, else keep
      `output.error(message)`. Reuse the module-private `toJson` at `:1996`. Return values unchanged.
      Do not touch `:539` / `:542`.
- [ ] 5. **Message envelope site** — R6. `apps/cli/src/commands/message.ts:114`: branch on
      `options.json` to `context.output.write(toJson({ error: { code: 'usage', message } }))`, else
      `context.output.error(message)`. `return 2` unchanged. Do not touch `:72` or `:263`.
      → `bun run lint`
- [ ] 6. **Tests.** Append to `apps/cli/tests/config-layering.test.ts` (0665's file): neither layer
      defines `agent.roles` → `agent doctor coder --json` payload carries `rolesSource: "fallback"`,
      and text mode writes the frozen note to stderr with an unchanged exit code; a layer defining
      `agent.roles` → `rolesSource: "config"` and **no** note. In
      `packages/app/tests/services/agent-service.test.ts`, add unit cases for the two envelope sites
      (json → exactly one envelope on stdout, empty stderr; text → unchanged message, empty stdout)
      and assert the exit codes are unchanged. In `apps/cli/tests/commands/message.test.ts`, the same
      pair for the empty-body path. Then `bun test apps/cli packages/app` and repoint anything the
      `renderDoctor` signature change breaks.
- [ ] 7. **Verify the ADR record** — R4. Read `docs/00_ADR.md:1150` (the 2026-08-24 ADR-078
      amendment) and confirm it matches what shipped — specifically the note wording and the
      `rolesSource` field name. Amend **only** on divergence; do not add a second amendment. Record
      the verification (file:line + verdict) in `### Solution`.
- [ ] 8. **Doc sync + gate** — T3. `docs/04_DESIGN.md`: document `rolesSource` on the `agent doctor`
      `--json` payload and the three newly conforming envelope sites with their codes, in the same
      commit. `docs/design/universal-config-loading.md`: correct the stale `agent.ts:746` /
      `message.ts:415` anchors to the real sites from `### Q&A` Q1/Q2. Then
      `bun run autofix && bun run spur-check`, `bun run test-cf`, `bun run build`.

### Solution
Agent-surface fallback provenance (R1/R3) and `--json` error envelope (R5/R6); ADR-078 amendment verified (R4).

**R1 — rolesSource provenance on CliContext, threaded to AgentService**

- `apps/cli/src/context.ts:123` — `CliContext.agentRolesSource: 'config' | 'fallback'` (non-optional).
- `apps/cli/src/context.ts:178` — computed at the CLI root: `agentConfig?.roles === undefined ? 'fallback' : 'config'` (whole-table, not per-role).
- `apps/cli/src/context.ts:206` — passed into `agentService()` as `rolesSource`.
- `packages/app/src/services/agent-service.ts:297` — `AgentServiceContext.rolesSource?: 'config' | 'fallback'` (optional; server lazy AgentService not threaded per Q6).

**R2 — global-only executor resolves for doctor (proved by 0665's tripwire + 0666 fallback case)**

- `apps/cli/tests/config-layering.test.ts` — the 0665 global-only-executor case + this task's `rolesSource: 'fallback'` doctor case both run against the real CLI entry; no code change was needed (per design, R2 is proved, not re-implemented).

**R3 — doctor reports the active fallback**

- `packages/app/src/services/agent-service.ts:455` — text mode writes the frozen note to the error stream (`agent.roles: no config layer defines a table — built-in DEFAULT_AGENT_ROLES fallback in effect`) when `this.ctx.rolesSource === 'fallback'`.
- `packages/app/src/services/agent-service.ts:515` — json mode adds top-level `rolesSource: this.ctx.rolesSource ?? 'config'` to the doctor payload. The note never fires when a layer supplies `agent.roles` and never changes the exit code.

**R4 — ADR-078 amendment verified**

- `docs/00_ADR.md:1169` — the amendment names `rolesSource` for the `--json` field and the error-stream note for text mode; it matches what ships, so no new amendment is authored (verify-only).

**R5 — agent `--json` error envelope (doctor + run dispatch failures)**

- `packages/app/src/services/agent-service.ts:467` — doctor `!resolved.ok` → `args.json` ⇒ `toJson({ error: { code: 'agent-resolution', message: resolved.message } })`; else `output.error(...)`. `return resolved.exitCode` unchanged.
- `packages/app/src/services/agent-service.ts:540` — run `!outcome.ok` → `booleanFlag(flags,'json')` ⇒ same `agent-resolution` envelope; else `output.error(...)`. `return outcome.exitCode` unchanged. Post-dispatch exits at :549/:552 stay plain-text (Q3).

**R6 — message send `--json` usage envelope**

- `apps/cli/src/commands/message.ts:116` — empty body with `options.json` ⇒ `toJson({ error: { code: 'usage', message: 'message send requires a non-empty body' } })`; else `output.error(...)`. `return 2` unchanged. `message watch` / `message reply` are out of scope.

**Tests**

- `packages/app/tests/services/agent-service.test.ts` — the 5 previously-text-envelope agent-error tests re-targeted to read the `agent-resolution` envelope (`lines`), plus a new doctor `!resolved.ok` envelope test. 163 pass / 0 fail.
- `apps/cli/tests/commands/message.test.ts` — new `--json` empty-body `usage` envelope test.
- `apps/cli/tests/config-layering.test.ts` — two new fallback cases (`rolesSource: 'fallback'` json + text-mode note). 7 pass / 0 fail.
### Testing
**Pipeline verify results**

- Verdict: PASS (from verdict artifact)

| Requirement | Status | Evidence |
|-------------|--------|----------|
| R1 | MET | `apps/cli/src/context.ts:178` — agentRolesSource computed at the CLI root (fallback iff agentConfig?.roles === undefined); passed to agentService() as rolesSource at :206; AgentServiceContext.rolesSource at agent-service.ts:297 |
| R2 | MET | `apps/cli/tests/config-layering.test.ts` — the 0665 global-only-executor tripwire case + this task's rolesSource:'fallback' doctor case run against the real CLI entry; no code change needed (design: R2 is proved, not re-implemented) |
| R3 | MET | `packages/app/src/services/agent-service.ts:515` — json mode adds top-level rolesSource to the doctor payload; text mode (:455) emits the frozen default-fallback note on the error stream; never fires when a layer supplies agent.roles, exit code unchanged |
| R4 | MET | `docs/00_ADR.md:1169` — amendment names rolesSource + the error-stream note; matches what ships, no new amendment authored |
| R5 | MET | `packages/app/src/services/agent-service.ts:467` — doctor !resolved.ok emits toJson({error:{code:'agent-resolution'}}) under json; :540 run !outcome.ok same envelope; exit codes unchanged; post-dispatch text stays plain-text |
| R6 | MET | `apps/cli/src/commands/message.ts:116` — empty body with options.json emits toJson({error:{code:'usage'}}); return 2 unchanged; watch/reply out of scope |

| Acceptance Criteria | Status | Evidence Type | Evidence |
|---------------------|--------|---------------|----------|
| R6 — spur agent doctor resolves a globally defined executor when the project config has no agent: section | MET | test | apps/cli/tests/config-layering.test.ts global-only executor case → 7 pass / 0 fail |
| R7 — The DEFAULT_AGENT_ROLES fallback is explicit when no config defines the role | MET | test | apps/cli/tests/config-layering.test.ts rolesSource:'fallback' json case + text-mode note case |
| R8 — The DEFAULT_AGENT_ROLES fallback decision is recorded [docs-only] | MET | static-ref | `docs/00_ADR.md:1169` — amendment naming rolesSource + the error-stream note, matching what ships |
| R9 — Agent-surface failures emit the standard --json error envelope | MET | test | packages/app/tests/services/agent-service.test.ts agent-resolution envelope (doctor + run) → 163 pass / 0 fail |
| R10 — Message-surface failures emit the standard --json error envelope | MET | test | apps/cli/tests/commands/message.test.ts --json empty body usage envelope |
- Coverage: N/A (verdict-based; verify pipeline does not measure code coverage)
### Review
**SECU findings** (pipeline verify step — verdict: PASS)

| Priority | Dimension | Location | Finding |
|----------|-----------|----------|----------|
| P1 | Security | — | None — no secret/injection/unsafe-input path introduced. The `--json` envelope routes the existing error strings verbatim; no new external input is parsed. |
| P2 | Correctness | — | None — exit codes are untouched at all three sites (`resolved.exitCode`, `outcome.exitCode`, `2`); under `--json` nothing plain-text reaches either stream, and under text mode nothing JSON does. Message text is propagated verbatim in both branches. |
| P3 | Architecture | — | Intentional exceptions (Q3/Q6): post-dispatch exits (`Agent terminated by signal` / `Agent exited with code`) stay plain-text (they report a *successfully dispatched* agent's own exit, not a dispatch failure), and the server's lazy `AgentService` is NOT threaded with `rolesSource` (no server surface runs `doctor`; threading it would add an unread field). `message watch` / `message reply` are out of scope. |
| P4 | — | — | No P1–P3 findings; verify verdict PASS |
### References

**Authority**

- `docs/00_ADR.md:1113` — ADR-078: role→tier SSOT in the config layer, `DEFAULT_AGENT_ROLES`
  demoted to a byte-identical fallback that applies only when no layer supplies `agent.roles`.
- `docs/00_ADR.md:1150` — **ADR-078 amendment (2026-08-24)**: the fallback is explicit, never
  silent (feature A5 R7/R8). Already landed; R4 verifies it rather than authoring it.
- `docs/00_ADR.md:1213` — ADR-082: merged config loads once at the composition root. The premise
  that makes R2 true once 0665 lands.
- `docs/design/universal-config-loading.md` §"Role-fallback provenance" and §"`--json` error
  envelope" — the accepted shapes. **Its `agent.ts:746` / `message.ts:415` anchors are stale** —
  see `### Q&A` Q1/Q2; `### Design` is the corrected authority.

**Feature + siblings**

- `docs/features/A5_universal-config-loading-composition-root-merged-config-wiring-consumer-audit-and-agent-surface-json-error-contract.md` — parent feature; this task owns feature R6-R10.
- Task `0665` — composition-root wiring. **Hard dependency**: supplies `CliContext.spurConfig`, the
  merged `agentConfig`, `apps/cli/tests/config-layering.test.ts`, and the `runCli(args, cwd, env)`
  helper this task's tests reuse.

**Code anchors (verified 2026-08-24)**

- `apps/cli/src/context.ts:52` `resolveAgentRoles(agentConfig?)` — reads `agentConfig?.roles` as a
  whole-table override; `:97` `CliContext`; `:158` roles resolution; `:185` `agentService()` ctx.
- `packages/app/src/services/agent-service.ts:261` `AgentServiceOutput` (`write` / `error`);
  `:283` `AgentServiceContext`; `:438` `doctor(args: { json, agent? })`; `:456` doctor
  `!resolved.ok` **(R5 target)**; `:465` `renderDoctor`; `:501` the `--json` payload write;
  `:511` exit-code expression (unchanged); `:517` `run(prompt, flags, deps)`; `:525` run
  `!outcome.ok` **(R5 target)**; `:539` / `:542` post-dispatch exits (**out of scope**);
  `:1748` `resolveRole`; `:1996` module-private `toJson`.
- `apps/cli/src/commands/message.ts:114` empty-body usage failure **(R6 target)**;
  `:413-420` `sendWaitFail` (**already conforming — untouched**).
- `apps/cli/src/commands/agent.ts:743-751` `waitUsageError`, `:753-760` `waitFail`
  (**already conforming — untouched**).
- `apps/server/src/context.ts:484-497` — `AgentServiceImpl` built with no `agentConfig` / `roles`;
  the reason `rolesSource` is CLI-only (`### Q&A` Q6).
- `apps/cli/src/output.ts:20` `toJson` — the CLI-owned original the packages/app copy mirrors.

**Upstream work this builds on**

- Task `0572` — `DEFAULT_AGENT_ROLES` + `resolveAgentRoles`; the fallback whose silence this task
  ends. Values and parity gate unchanged.
- Task `0622` — the role→ranked-doctor-walk resolution in `doctor` that R2 exercises.
- Task `0640` — the layered loader supplying the merged `agent.roles` view.

### History
- 2026-08-25T18:12:40.046Z todo → wip (system)
- 2026-08-25T18:12:40.600Z wip → testing (system)
- 2026-08-25T18:12:59.721Z testing → done (system)
