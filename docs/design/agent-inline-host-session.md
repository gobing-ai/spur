# Design: `--agent inline` — host-session-only execution guarantee

Feature G5 · ADR-047 amendment · supersedes the 0508 relaxation for the explicit-`inline` value only.

## Problem

`inline` is accepted at the CLI boundary but silently equivalent to `omit` → `agent.default` on
headless surfaces (`packages/app/src/services/agent-service.ts:1131-1136`,
`packages/app/src/workflow/actions/agent-run.ts:129-133`). An operator debugging an agent-dispatch
issue has no selector that guarantees "this work never leaves my session" — an `inline` request can
run in another session with zero signal, which is the exact trap being debugged.

## Decision

Explicit `--agent inline` is a **hard host-session guarantee**:

- **Host-session surfaces** (slash commands, backend agent skills): all model-bearing work executes
  in the invoking session. No subagent, no subprocess, no workflow hop. The 0508 native-subagent
  eligibility applies to **`omit` only** — never to explicit `inline`.
- **Headless surfaces** (`spur agent run`, workflow `agent.run`, serve-side dispatch): these cannot
  host a session, so `inline` is rejected with a **stable, greppable error** and **no further
  action** — no dispatch, no `agent.default` fallback, no partial side effects.
- `omit`, `--agent auto`, and named role/executor selectors are **unchanged**.

### Error contract (operator decision 2026-08-15: hard error, no fallback, split by class)

| Class | Where | Behavior |
| --- | --- | --- |
| `inline` on a headless surface | CLI boundary (`validateAgentSelector` / `runAgentRun`) | exit 2, stable message naming `inline` and that the surface cannot host a session; zero spawn |
| invalid name (not inline/auto/role/executor) | CLI flag boundary, before any spawn | exit 2, explicit error naming the valid values (existing 0536 R3 behavior — kept) |
| `inline` reaching service/workflow resolution | `agent-service` resolution, workflow `agent.run` | same special error surfaces (defense in depth — the CLI boundary is the primary gate) |

Exit code 2 reused (usage-class error); the **message string** is the greppable contract, kept
stable as a tested constant. Dedicated exit code rejected — exit-code taxonomy is already crowded;
the message carries attribution.

### `dev-parallel --agent inline`

Parallel fan-out **is** dispatch, so explicit `inline` cannot mean "run in parallel elsewhere."
Decision: **sequential host-session execution with a printed notice** (deterministic, zero
dispatch) — this keeps the primary use case (debugging dispatch issues on a batch) possible.
Alternative considered: hard error — rejected; it makes the debugger's override useless exactly
where batch dispatch bugs live.

## Components

1. `apps/cli/src/commands/agent.ts` — `inline` branch in `validateAgentSelector`/`runAgentRun`:
   special error, no spawn; `--agent` help lists `inline`.
2. `packages/app/src/services/agent-service.ts` — remove the `inline → resolveAgentAuto`
   equivalence (~:1131-1136); resolution fails with the same error; ADR-047 comment updated.
3. `packages/app/src/workflow/actions/agent-run.ts` — remove the `inline → agentConfig.default`
   normalization (~:129-133); surface the special error. Workflow YAMLs that need a headless
   default say so explicitly (`omit` / `agent.default`).
4. `plugins/sp/skills/spur-dev/references/cross-cutting.md` § inline-default execution surface —
   explicit-`inline` carve-out (zero dispatch; 0508 eligibility is omit-only); `flag-glossary.md`
   and `dev-plan.md` inline rows (no longer ≡ omit); `dev-parallel.md` sequential-notice row.
5. `docs/00_ADR.md` — ADR-047 amendment; `docs/04_DESIGN.md` §7.8 + this satellite index row
   (T3 same commit).
6. Tests at three layers: CLI boundary (error + exit 2 + no spawn), service resolution (inline
   rejected), workflow action (inline rejected); `omit`/`auto`/named regression coverage.

## Boundaries

- No new flags, config knobs, or env gates (single-flag design, ADR-041).
- No schema/migration impact.
- Skill-side enforcement is **convention, not mechanism** — the CLI error is the mechanical backstop
  for subprocess dispatch; a skill that dispatches anyway is a contract bug, not a gate bypass.
- Enforcement does not touch `omit` — host-context growth stays opt-in per invocation.

## Rejected alternatives

- **Fallback to `agent.default` for `inline`** — silently runs in another session; defeats the
  debugging purpose; contradicts fail-loud standard. (Operator decision, above.)
- **Env/config gate (`SPUR_INLINE_HOST_ONLY`)** — flag multiplicity ADR-041 removed; invisible in
  help; not per-invocation.
- **Separate `--no-dispatch` flag** — two mechanisms for one concept.
- **Dispatch-point sentinel** — partial side effects before failure; weaker attribution; operator's
  contract is a CLI-boundary error.
