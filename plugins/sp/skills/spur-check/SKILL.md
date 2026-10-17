---
name: spur-check
description: 'Two-tier check primitive for the sp pipeline: light (changed-scope biome, per-workspace typecheck, related tests) during development; full (`spur self exec check`) once at the quality boundary. Reads/writes fingerprint-bound check receipts (.spur/run/<wbs>-check-receipt.json) and reuses a PASS full receipt only at the same proof digest.'
license: Apache-2.0
version: 1.0.0
metadata:
  author: spur
  platforms: "claude-code,codex,openclaw,opencode,antigravity,pi"
  category: check-execution
  interactions:
    - pipeline
  operations:
    - check
    - accumulate
    - reuse
  openclaw:
    emoji: "🧾"
see_also:
  - sp:spur-dev
  - sp:spur-cli
  - sp:code-verification
---

# sp:spur-check — the two-tier check primitive (ADR-124)

One check primitive with two tiers behind `spur task gate <wbs> <mode>`
([task 0939](../../../../docs/tasks5/0939_add-the-two-tier-spur-check-primitive-with-fingerprint-bound.md),
[workflow catalogue refactor §4](../../../../docs/design/workflow-catalogue-refactor.md)): light
checks accumulate during development, the full chain runs once at the quality boundary, and every
gate writes a fingerprint-bound receipt that downstream stages read instead of re-running checks.

## Tiers

| Tier | Mode | When | Scope |
| --- | --- | --- | --- |
| `light` | `spur task gate <wbs> light` | after each implement/fix edit | `bunx biome check` on the changed files (`git diff --name-only HEAD` + untracked), `bun run typecheck` per touched workspace, and related tests (`<ws>/src/**/x.ts` → `<ws>/tests/**/x.test.ts` filename mapping) run via `cd <ws> && bun test …` — never from the repo root, whose bunfig preload does not apply inside the workspace |
| `full` | `spur task gate <wbs> run` | once at the task quality boundary (`test`) | today's chain: `spur self exec lint` + `spur self exec rules-pre` + `spur self exec test` + `spur self exec rules-post` (=`spur self exec check`), with bounded findings, SQLite-busy retry, and the `recheck` probe |

Exit contract: `run` and `recheck` return 0 on PASS and 1 on FAIL; `deferred` returns 0 on
DEFERRED and 1 on FAIL. `light` and `status` return 0; invalid usage returns 2. The pipeline
wraps selected calls with `; exit 0` and branches on `*-test-gate.status` or receipt `status`;
that soft shell wrapper does not change the standalone CLI contract.

## Receipt

`.spur/run/<wbs>-check-receipt.json`, schema `check-receipt/v1`:

```json
{
  "schemaVersion": "check-receipt/v1",
  "wbs": "0939",
  "runId": "pipeline-0939",
  "tier": "full",
  "inputDigest": "<proof-input digest>",
  "checks": [{ "id": "test", "cmd": "…", "status": "PASS", "durationMs": 0, "logPath": "…" }],
  "status": "PASS",
  "completedAt": "2026-09-25T00:00:00.000Z"
}
```

- `inputDigest` is the shared `ProofInputFingerprint` (task markdown + git tree of tracked
  sources). The plugin never computes it — the pipeline captures it with the `proof.fingerprint`
  action into `env.proofDigest` (ADR-124: no second fingerprint, no `@gobing-ai/*` import);
  standalone callers use `spur workflow inline fingerprint`.
- `run` and `recheck` write full-tier receipts; only a PASS at the current digest is reusable. Without a digest, `run` writes no receipt and says
  so in the gate log. The gate executes `qualityGateCmd` as one unit, so the full receipt carries a
  single `test` row for the whole chain; `lint`, `typecheck`, `test-pre-check`,
  `test-post-check` name the chain steps the full tier covers.
- `light` merges its rows under `tier: light` and skips any sub-check already `PASS` in a light
  receipt at the same `{id, inputDigest}` (accumulation). Light rows never make a receipt
  reusable for review.

## Reuse rule

Check `status` mode before re-running a gate. The gate ships inside the CLI (no plugin script to
resolve):

```bash
spur task gate <wbs> status --proof-digest "$proofDigest" --no-logo   # final stdout line: {"reuse":…,"reason":…}
```

`reuse: true` only when the receipt is `status: PASS`, `tier: full`, and `inputDigest` equals the
current digest. Otherwise the reason is one of `missing | failed | stale | light-only`:

- `missing` — no readable receipt (or foreign schema version)
- `failed` — last full run failed
- `stale` — digest mismatch (or no current digest supplied)
- `light-only` — a valid PASS receipt that came from the light tier

Only `full` may satisfy a review/verify/record boundary: "review only after a green full gate" is
preserved by construction. `recheck` stays the no-progress probe path for fix loops.

## Composition

- **Pipeline:** `sp:spur-dev` runs `run` at `test` and `recheck` at `test-recheck`; light mode
  belongs to implement/fix edits, not to the gate state.
- **Fix loops:** `/sp:dev-fixall --gate-log` consumes `<wbs>-test-gate.log` (and the bounded
  `<wbs>-test-gate.findings` anchors) after a red gate; it never writes receipts. A green fixall
  output still requires a fresh `run` receipt before review.
- **Verification:** `sp:code-verification` and the review checklists read the receipt (status
  mode) instead of re-running `bun run test`.
- **Feature scope:** `spur-check-feature` remains the ADR-119 repo-wide pass; this primitive is
  task-local. A public `spur check` verb is out of scope without separate consent.

## Gotchas

1. **Keep gate logic in the CLI/application owner** — plugin skills invoke `spur task gate`;
   they do not restore a script or bundle. The digest arrives via `--proof-digest` or `env.proofDigest`.
2. **Never run light tests from the repo root** — the workspace `bunfig.toml` preload (coverage,
   thresholds) only applies inside the workspace; `cd <ws> && bun test …` is the contract.
3. **Light is a filter, not a boundary** — unmapped files (root-level scripts, non-src layouts)
   are simply not covered by light; the full tier is the safety net. Do not widen the mapping
   without an ADR.
