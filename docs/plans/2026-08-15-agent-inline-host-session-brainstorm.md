# Brainstorm: `--agent inline` as a hard host-session selector

**Run:** `2e226f39-8546-4dcb-bde2-ed674039880c` (idea path) · **Date:** 2026-08-15
**Trigger:** `/sp:dev-idea` discovery dispatch of `sp:brainstorm`

## Overview

The unified `--agent <inline|auto|name>` table (ADR-047) documents `inline` as "interactive: stays
in the host session". Two amendments eroded that for the explicit value: 0508 lets eligible
sequential `agent.run` stages dispatch **once** to a native subagent even under interactive
omit/`inline`, and on headless surfaces (`spur agent run`, workflow `agent.run`) `inline` silently
resolves to `agent.default` — a subprocess — identical to `omit` (`agent-service.ts:1131-1136`,
`agent-run.ts:129-133`). Result: an `inline` request can run in a different session with no signal —
the exact failure mode that is hard to debug. The idea restores `inline` as a hard host-session
guarantee: slash commands and backend agent skills MUST execute inline in the invoking host session
(no subagent, no subprocess, no workflow hop), and the `spur` CLI surface — which is always a
subprocess and can never host a session — responds to `--agent inline` with a stable special error
and nothing else.

## Approaches

### Approach 1: CLI-boundary sentinel + host-session contract ⭐ Recommended

**Description:** Treat `inline` as a closed value whose semantics are "host-session only". At the
CLI boundary (`apps/cli/src/commands/agent.ts`), `validateAgentSelector` already accepts `inline`;
`runAgentRun` gains a branch that emits a distinct, stable error (e.g.
`--agent inline is host-session-only: spur agent run is a subprocess surface; run the prompt in the
host session instead of dispatching`) and returns without spawning (exit 2, matching other
validation errors). In `AgentService.resolveAgentSelector`, the `raw === 'inline' → resolveAgentAuto`
branch is removed — `inline` fails resolution with the same special error. The workflow `agent.run`
action (`agent-run.ts:129-133`) stops normalizing `inline` → `agentConfig.default` and surfaces the
same error. On the skill side, the inline-default execution-surface contract
(`cross-cutting.md` § Inline-default execution surface) gains an explicit-`inline` carve-out:
`--agent inline` forces **all** model-bearing work into the host session — the 0508 native-subagent
eligibility does not apply to explicit `inline` (only to `omit`). `omit`/`auto`/named selectors
keep current behavior.

**Trade-offs:**
- **Pros:**
  - Loud failure on mis-dispatch — the stated debugging goal: any `--agent inline` reaching a
    subprocess dies with a distinct error instead of silently running elsewhere.
  - Reuses the existing value domain; no new flag, no config knob (preserves ADR-041).
  - Small CLI diff: one branch + one message; validator already accepts `inline`.
  - Machine-detectable: stable message + exit code lets host-session tooling distinguish
    "inline attempted from a subprocess" from other failures.
- **Cons:**
  - Partially reverses 0508's native-subagent-first policy for explicit `inline` — model-bearing
    stages must run in host context on those runs (host-context growth is why 0508 relaxed).
  - Enforcement is convention, not mechanism: a skill that dispatches anyway bypasses the
    guarantee; the CLI error only catches subprocess dispatch.
  - Every surface documenting `inline ≡ omit` must be updated in the same change: `agent-service.ts`,
    `agent-run.ts`, `dev-plan.md`, flag glossary, `cross-cutting.md`, `docs/04 §7.8`.
  - `dev-parallel` defaults to `inline` but parallelism *is* dispatch — needs a decided behavior
    (sequential host-session fallback vs error) under explicit inline.

**Confidence:** HIGH — code read today (`agent.ts:167,400`, `agent-service.ts:1128-1136`,
`agent-run.ts:129-133`); ADR-047 + 0503/0508 amendments read today.

**Sources:** `docs/00_ADR.md` (ADR-047 + amendments); `apps/cli/src/commands/agent.ts`;
`packages/app/src/services/agent-service.ts`; `packages/app/src/workflow/actions/agent-run.ts`.

### Approach 2: Dispatch-point sentinel (softer)

**Description:** Keep `inline` flowing through validation and resolution, but at the exact point
where a subprocess would spawn (AgentService just before process start; workflow `agent.run` before
fork), return the special error instead of spawning. Slash commands get the same host-session
contract as Approach 1.

**Trade-offs:**
- **Pros:**
  - No change at the validator (already accepts `inline`); resolution pipeline and ledger capture
    the attempted selector before failing.
- **Cons:**
  - Error surfaces later, after flag rewriting, drain, and ledger attach — partial side effects
    before failure; harder to attribute.
  - More touch points than it appears (every spawn site), not fewer.
  - Does not match the stated contract: "the `spur` CLI surface layer responds with a special error,
    no other actions" — boundary-level, which Approach 1 is.

**Confidence:** HIGH for behavior; rejected as a worse fit for the operator's stated contract.

### Approach 3: Env/config gate instead of the value

**Description:** Keep `--agent inline` ≡ `omit`, and add a separate mechanism (e.g.
`SPUR_INLINE_HOST_ONLY=1` env or config `agent.inline: host`) that slash commands consult to force
host-session execution; the CLI errors only when the gate is set.

**Trade-offs:**
- **Pros:** Zero change to the `--agent` value table; CLI surface untouched unless the gate is set.
- **Cons:** Reintroduces the flag/config multiplicity ADR-041 removed; env vars are invisible in
  command signatures and help; cannot be expressed per-invocation in workflow YAML; weaker
  debugging story — the flag no longer says what it means.

**Confidence:** MEDIUM — synthesized; this design conflicts with the documented single-flag table
(ADR-041) and the closed boundary validation (ADR-047/0536).

## Recommendations

**Adopt Approach 1.** It matches the operator's stated contract exactly (CLI-boundary special
error; skills own host-session execution), reuses the closed `--agent` table, and makes
mis-dispatch loud. Keep `omit`/`auto`/named selectors untouched so the 0508 native-subagent policy
survives on the default path. Use a stable message and exit code 2 (consistent with existing CLI
validation errors) — the message text is the grep-able contract; a dedicated exit code is a
decision point for the design step if machine consumers need to distinguish it.

**Open questions for the design step:**
1. `dev-parallel --agent inline` semantics: sequential host-session execution or special error?
   (Parallelism is dispatch by definition.)
2. Should the special error be a dedicated exit code (e.g. `3`) or reuse `2` with the stable
   message? (Recommendation: reuse `2`, keep message as the contract.)
3. Serve-side dispatch (`spur serve` web surface) — same special error, or reject `inline` in
   request payloads at the contract layer?

## Next Steps

1. ADR-047 new amendment: explicit `inline` = host-session-only; headless surfaces respond with the
   special error; `omit`/`auto`/name unchanged.
2. CLI branch + message in `runAgentRun`; add `inline` to the `--agent` help text.
3. Remove `inline → resolveAgentAuto` in `agent-service.ts`; remove `inline → agentConfig.default`
   normalization in `agent-run.ts`.
4. Skill contract: `cross-cutting.md` explicit-`inline` carve-out + flag glossary update +
   `dev-plan.md` inline row.
5. `docs/04_DESIGN.md` §7.8 + agent-run surface doc (T3, same commit).
6. Tests at three layers: CLI (`spur agent run --agent inline` → special error, exit 2, no spawn),
   service (`resolveAgentSelector('inline')` fails), workflow action (`agent: inline` errors).

## Design Summary

**Restore `inline` as a hard host-session selector in the unified `--agent` table** (ADR-047
amendment). Explicit `--agent inline` means: all model-bearing work executes in the invoking host
session — no subagent, no subprocess, no workflow hop; the 0508 native-subagent eligibility applies
only to `omit`. Headless `spur` surfaces (`spur agent run`, workflow `agent.run`, serve-side
dispatch) cannot host a session and respond to `inline` with a stable special error (distinct
message, exit code 2), taking no further action.

- **Components:**
  1. `apps/cli/src/commands/agent.ts` — `runAgentRun`/`validateAgentSelector`: `inline` branch →
     special error, no spawn; `--agent` help text lists `inline`.
  2. `packages/app/src/services/agent-service.ts` — remove `raw === 'inline' → resolveAgentAuto`
     (line 1136); `inline` fails resolution with the same error; ADR-047 comment updated.
  3. `packages/app/src/workflow/actions/agent-run.ts` — remove `agent === 'inline' →
     agentConfig.default` normalization (line 133); surface the special error. Workflow YAMLs that
     need headless default use `omit`/`agent.default` explicitly.
  4. `plugins/sp/skills/spur-dev/references/cross-cutting.md` § Inline-default execution surface —
     explicit-`inline` carve-out (zero dispatch); `flag-glossary.md` inline row; `dev-plan.md`
     inline row (no longer ≡ omit).
  5. `docs/00_ADR.md` — ADR-047 amendment; `docs/04_DESIGN.md` §7.8 + flag glossary (T3 same
     commit).
  6. Tests: CLI boundary, service resolution, workflow action (three layers, ≥90% gate).
- **Boundaries:** `omit`/`auto`/named selectors unchanged; no new flags or config; no
  schema/migration impact. `dev-parallel` explicit-inline behavior (sequential vs error) decided at
  design step.
- **Signal:** `needs_design: true` — cross-cutting convention change across CLI + app service +
  workflow engine + plugin skills + ADR/docs; multiple subsystems touched; ADR amendment required.
