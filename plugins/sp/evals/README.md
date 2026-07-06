# Skill behavioral eval harness (task 0215 R2)

`skill-structure.test.ts` checks skill **file shape**. This harness checks skill **behavior** — that a
gate-bearing skill actually shapes an agent under pressure: a rationalization is resisted, a red flag
is caught, a gate blocks a premature "done". It is deliberately small in its first slice (one skill,
one scenario) to prove the harness before scaling the scenario corpus.

## Two tiers (free vs paid)

| Tier | What runs | Cost | Entry point |
|---|---|---|---|
| **Deterministic (free)** | The pure `judgeTranscript` judge asserted against recorded fixtures (a disciplined transcript passes, an undisciplined one fails). | none — no agent | `bun test ./plugins/sp/evals/judge.test.ts` (also part of the default `bun run test`), and `bun run eval -- --fixtures` for the end-to-end report. |
| **Live (paid)** | Each scenario is driven through `spur agent run`; the live transcript is judged. | an LLM call per scenario | `bun run eval` — requires an installed, authenticated coding agent; reports SKIPPED (never FAIL) when none is available. |

## Why it is a separate entry point

The costly live tier is **not** wired into `bun run spur-check` or the default `bun run test`: a paid,
non-deterministic behavioral eval must never gate the always-on structural suite (D4). The runner
(`run-eval.ts`) is a standalone script, not a `*.test.ts`, so `bun test` never picks it up. Only the
fast, deterministic judge unit test (`judge.test.ts`) runs in the default suite.

## Layout

- `scenarios.ts` — the scenario corpus (`EVAL_SCENARIOS`) + recorded transcripts (`EVAL_FIXTURES`).
- `judge.ts` — the deterministic `judgeTranscript` judge (an LLM-judge can replace it in the paid tier).
- `judge.test.ts` — the free-tier assertion that the discipline fires (in the default suite).
- `run-eval.ts` — the `bun run eval` runner (live tier + `--fixtures` deterministic demo).

## Scaling the corpus

Add a scenario to `EVAL_SCENARIOS` and a recorded fixture to `EVAL_FIXTURES`. Keep the free tier
deterministic; reserve live-agent runs for the paid tier.
