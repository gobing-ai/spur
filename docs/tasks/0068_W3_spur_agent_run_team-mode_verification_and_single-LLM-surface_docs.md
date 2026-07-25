---
name: "W3: spur agent run team-mode verification and single-LLM-surface docs"
description: "W3: spur agent run team-mode verification and single-LLM-surface docs"
status: done
created_at: 2026-06-13T01:08:18.985Z
updated_at: 2026-06-15T04:18:13.790Z
folder: docs/tasks
type: task
feature-id: B1
priority: P1
tags: ["rd3-migration","wave-3"]
impl_progress:
  planning: done
  design: done
  implementation: done
  review: done
  testing: done
---

## 0068. "W3: spur agent run team-mode verification and single-LLM-surface docs"

### Background

Delivery doc §1.4, M12. Not new — verify team-mode, harden, document as the single LLM execution surface for skills and workflow YAML.


### Requirements

R1. Team-mode verified end-to-end (or gaps filed upstream to ts-ai-runner).
R2. Hardening fixes from verification.
R3. 04_DESIGN documents agent run as the single LLM surface; sp skills reference it.


### Q&A



### Design

Authority: delivery doc §1.4 + B1 feature AC (M12): `spur agent run` is not new — verify team-mode
end-to-end, harden, and document it as the **single LLM execution surface** for skills and workflow YAML.
01_PRD §5.1 baseline: single-shot done, team-mode pending verification. Upstream owner for engine-side
gaps: `@gobing-ai/ts-ai-runner` (self-contained ts-libs tasks per the §14 memo).


### Solution

Verification + hardening + documentation task (`spur agent run` already exists). No new feature code;
the deliverables are a real end-to-end test, a doc statement, and a grounded single-surface claim.

**R1 — team-mode verified end-to-end.** The chain is `spur team assign` → `spur message send` →
`spur agent run --drain <spec-id>`: drain pulls the spec's pending inbox, folds the messages into the
prompt ahead of the operator instruction, and rewrites `--agent <spec-id>` to the spec's coding-agent
type before dispatch (`apps/cli/src/commands/agent.ts:271 drainIntoPrompt`). No spur-side gaps; no
upstream `ts-ai-runner` filing needed (prepend-on-drain is the Phase 1-3 design — no live stdin).

**R2 — hardening: fixed a false-positive test.** `agent-team.test.ts`'s headline drain test was named
"folds pending messages into the prompt" but asserted only `receivedInput.toContain('do work')` (the
original prompt) — its own comment admitted the per-call `:memory:` DBs were isolated so drain never
saw the message. It passed while testing nothing about drain. Rewrote it to seed the spec + message
through the shared `ctx` (one cached DB), then assert: the drained body is present, it precedes the
operator prompt, and the spec id `planner` mapped to runner type `claude`. Now genuinely verifies R1.

**R3 — single LLM execution surface documented.** `04_DESIGN.md:69` agent-run section now leads with
the statement: every model invocation in Spur (sp skills generating prose, workflow `agent.run`
actions, team-mode) routes through `spur agent run`; Spur owns no other model-reaching path; it is the
seam for a future remote/SSE channel. Grep-verified no alternative execution paths in `plugins/sp/skills/`
or `config/workflows/` (model calls are exclusively `kind: agent.run`). Grounded at the code level:
the `agent.run` action runner (`packages/app/src/workflow/actions/agent-run.ts:63`) delegates to the
same `AgentService.run` the CLI verb uses.


### Plan

- [x] R1: team-mode (drain) verified end-to-end — `assign`/`message send`/`agent run --drain` chain exists; the fold-into-prompt + spec-id→type mapping now has a REAL assertion (`agent-team.test.ts:262`)
- [x] R2 (hardening): fixed the false-coverage test — it claimed to verify "folds pending messages into the prompt" but the `:memory:` DB isolation meant drain never saw the message; it only asserted the original prompt survived. Rewrote to seed spec+message through the shared `ctx`, assert the drained body precedes the operator prompt and the spec id maps to runner type
- [x] R3: `04_DESIGN.md:69` agent-run section gains the **single LLM execution surface** statement (every model call routes through `spur agent run`; Spur owns no other path; the remote/SSE seam)
- [x] R3: grep-verified — zero alternative LLM-execution paths in `plugins/sp/skills/` + `config/workflows/`; workflow YAML invokes the model only via `kind: agent.run`
- [x] R3 grounding: confirmed `agent.run` workflow action (`workflow/actions/agent-run.ts:63`) delegates to the same `AgentService.run` as the CLI verb — the single-surface claim is true at the code level
- [x] Same-commit traceability: B1 feature AC (all 3) checked; `spur feature refresh` synced the Tasks blocks corpus-wide (B1's 0068 row → Done; also caught stale 0066/0067 rows in H2)
- [x] No spur-side gaps requiring upstream `ts-ai-runner` filings — the surface is complete; team-mode is prepend-on-drain by design (no live stdin in Phase 1-3)


### Review

**SECU verdict: PARTIAL → PASS** (verified + fixed 2026-06-14 via `/rd3:dev-verify 0068 --auto --fix all --force`)

`spur agent run` (incl. `--drain` team-mode) already existed, but R1 was not genuinely verified (a
false-coverage test), the R3 single-surface doc statement was absent, and the single-surface claim was
unverified. Fixed all three; no spur-side feature gaps and no upstream `ts-ai-runner` filing needed.

**S — Security:** No new attack surface. The drain path folds DB-stored inbox messages into a prompt —
those are operator/agent-authored team messages, not external content; the trust boundary is the team
itself. No secrets; auth stays the agent's concern (Spur stores no keys).

**C — Correctness / architecture:**
- R1 ✓ team-mode chain (assign→send→run --drain) verified end-to-end with a real assertion.
- R2 ✓ hardening = removed a false-positive test that passed while testing nothing (R8 violation:
  the name claimed a behavior the assertion didn't check).
- R3 ✓ `04_DESIGN` documents the single LLM surface; grep + the `agent.run`→`AgentService.run` binding
  confirm it; sp skills reference `spur agent run` and nothing else.

**U — Usability:** the doc statement makes the architectural invariant explicit for future contributors
(where to attach a remote channel; what not to add).

### Findings

| # | Finding | Dim | Location | P | Disposition |
|---|---------|-----|----------|---|-------------|
| 1 | Drain test was false-coverage: named "folds pending messages into the prompt" but asserted only the original prompt survived; per-call `:memory:` isolation meant drain never ran. R1 unverified. | Correctness | `agent-team.test.ts:262` | P2 | **FIXED** — rewrote to seed via shared `ctx`; asserts drained body + ordering + spec-id→type mapping. |
| 2 | R3 single-LLM-surface statement absent from `04_DESIGN`. | Process | `04_DESIGN.md:69` | P2 | **FIXED** — added the statement; grep-verified no alternative paths. |
| 3 | Single-surface claim was unverified at the code level. | Correctness | `workflow/actions/agent-run.ts:63` | P3 | **VERIFIED** — the workflow `agent.run` action delegates to the same `AgentService.run` as the CLI verb. |
| 4 | B1 feature AC unchecked + Tasks blocks stale (H2 still showed 0066/0067 backlog). | Process | `docs/features/*` | P3 | **FIXED** — B1 AC checked; `spur feature refresh` synced 18 Tasks blocks to real status. |
| 5 | `spur feature update B1 done` fails with `SQLiteError: no such column: external_key` — the live `.spur/spur.db` predates the workspace `external_key` column. | Correctness | `.spur/spur.db` | P3 | **DEFERRED** — stale-DB/stale-install class (same as the catalog-link deferral); not a 0068 code bug. The feature-status flip is blocked by DB state, not by anything 0068 changed; B1 AC (the real sync) are done. |

No remaining P1/P2.

**Gate:** lint clean · test 1115 pass / 0 fail · test-cf 1 pass · build OK · no alternative LLM
execution paths in skills/workflow YAML.


### Findings

| # | Finding | Dim | Location | P | Disposition |
|---|---------|-----|----------|---|-------------|
| 1 | Drain test was false-coverage: named "folds pending messages into the prompt" but asserted only the original prompt survived; per-call `:memory:` isolation meant drain never ran. R1 unverified. | Correctness | `agent-team.test.ts:261` | P2 | **FIXED** — rewrote to seed via shared `ctx`; asserts drained body + ordering + spec-id→type mapping. |
| 2 | R3 single-LLM-surface statement absent from `04_DESIGN`. | Process | `04_DESIGN.md:69` | P2 | **FIXED** — added the statement; grep-verified no alternative paths. |
| 3 | Single-surface claim was unverified at the code level. | Correctness | `workflow/actions/agent-run.ts:63` | P3 | **VERIFIED** — the workflow `agent.run` action delegates to the same `AgentService.run` as the CLI verb. |

No remaining P1/P2.

**Gate:** lint clean · test 1115 pass / 0 fail · test-cf 1 pass · build OK · no alternative LLM
execution paths in skills/workflow YAML.


### Testing

Verified 2026-06-14. Verification + docs task — verified by a real end-to-end test, grep, and the gate.

- **R1 team-mode end-to-end (`apps/cli/tests/commands/agent-team.test.ts:262`):** seeds an agent spec
  + a pending message through the shared `ctx`, runs `runAgentRun(..., {drain:true})` with a fake
  runner, and asserts the runner received: (a) the drained message body, (b) the operator prompt,
  (c) the drained body BEFORE the prompt, (d) `--agent` resolved to the spec's type `claude`. 16/16 in
  the file pass.
- **R2 hardening:** the prior version of that test was false-coverage (asserted only the original
  prompt survived; drain was a no-op due to per-call `:memory:` isolation). Replaced; the +3 assertions
  now fail if the fold/mapping breaks.
- **R3 single-surface grep:** `plugins/sp/skills/` + `config/workflows/` carry NO alternative LLM path
  (no anthropic/openai/raw-api/direct-claude); model calls are exclusively `kind: agent.run`. Code
  grounding: `workflow/actions/agent-run.ts:63` → `AgentService.run` (same as the CLI verb).
- **Traceability sync:** B1 feature AC checked; `spur feature refresh` updated the Tasks blocks.

**Status before verify:** the surface existed and the docs lacked the single-surface statement; R1 was
NOT actually verified (the existing test was false-coverage). R2/R3 unmet. Closed here.

Gate: `bun run lint` clean · `bun run test` 1115 pass / 0 fail · `bun run test-cf` 1 pass ·
`bun run build` all workspaces OK.


### Artifacts

| Type | Path | Agent | Date |
| ---- | ---- | ----- | ---- |

### References


