---
schema_version: 1
name: Integrations E2E proof with a repeatable receipt
status: todo
template: feature-impl
created_at: 2026-11-22T02:10:29.289Z
updated_at: "2026-11-22T04:03:59.746Z"
feature_id: A82
priority: P2
tags: ["integrations", "A82"]

dependencies: ["1422", "1424"]
estimate_hours: 5
---

## 1425. Integrations E2E proof with a repeatable receipt

### Background

Implements: R14 — An E2E proof exercises the protocol fixes and the module and leaves an artifact.

Design satellite: docs/design/integrations-module.md §4. Follows the existing scripts/commands/a2a-serve-e2e.ts receipt convention.

**Refine corrections (2026-11-21)**
- "`scripts/commands/integrations-e2e.ts` … the Board check uses the repo's browser harness" → the CDP harness lives in `apps/web/tests/test-helpers/cdp.ts` (`launchBrowser`, `availableBrowserBinary`), consumed by `*.heavy.test.ts` (`apps/web/tests/board-base-path.heavy.test.ts:4`; the screenshot helper is in `apps/web/tests/modules/module-kit-template-browser.heavy.test.ts:159`). A script under `scripts/commands` importing it would be a deep cross-workspace relative import (AGENTS.md conventions). → split the proof into two legs:
  - the protocol leg is the script, which writes the receipt;
  - the Board leg is `apps/web/tests/modules/integrations-browser.heavy.test.ts` under `test:heavy`, which writes the screenshot next to the receipt.
- "a stub member" for cancel → a seeded `coordination_runs` row (the a2a-serve-e2e approach, `scripts/commands/a2a-serve-e2e.ts:15`) has no child to abort, so it would only prove `runStopped:false`. → use fleet-e2e's model stub: a scratch `bin/` with a stub binary named after the agent, put on PATH (`scripts/commands/fleet-e2e.ts:28,107`). The stub sleeps 60s, so a cold drain spawns a real child for the cancel to abort.
- The script is registered in three places: the `COMMANDS` list and the switch in `scripts/spur-dev.ts:77,133`, and a `package.json` script entry beside `a2a-serve-e2e` (`package.json:103`).
- The Board route is `/board/integrations` (1424 Design), not `/integrations`.

### Requirements

- [ ] R1. `scripts/commands/integrations-e2e.ts` (run as `bun scripts/spur-dev.ts integrations-e2e`) boots `spur self serve` on a free port in a temp project with MCP and A2A enabled and one cold A2A member whose agent is a 60s-sleep stub binary.
- [ ] R2. The protocol leg asserts:
  - a `tools/call` with an unknown argument returns `errorCode: invalid_arguments` (F1);
  - `tools/list` entries carry `annotations` (F2);
  - an unauthenticated card GET returns 200 with a non-empty `skills`, and an unauthenticated `message:send` returns 401 (F3, F4);
  - send then cancel on the stub member returns 202 with `runStopped: true`, the member instance is still running, and a second send is claimed (F6);
  - `integrations.status`, serialized, does not contain the token value (R7).
- [ ] R3. It writes `docs/reports/integrations-e2e-receipt.json` (stable name, overwritten each run). Each step records the command, exit or HTTP status, and the observed and expected value. It exits nonzero on any failed assertion.
- [ ] R4. `apps/web/tests/modules/integrations-browser.heavy.test.ts` loads `/board/integrations` against a served build with MCP and A2A enabled. It asserts one `integrations-row-<surface>` per surface and writes `docs/reports/integrations-e2e-summary-{light,dark}.png`. It skips with a reason when no browser binary is available, as the existing heavy tests do.

Out of scope: real model agents, a gateway-served run (covered by K4 heavy tests), and CI wiring.

### Acceptance Criteria

- [ ] AC1 — An E2E proof exercises the protocol fixes and the module and leaves an artifact

### Q&A

<!-- CLOSED decisions from refinement: what was chosen and why, what was deferred and on what
     condition. Not a parking lot for open questions — an unanswered question here means the task
     is not ready to hand off. Keep empty if none. -->

#### Q&A entry — 2026-11-22T04:03:59.354Z

- **Closed: one script vs two legs.** Two legs, because the browser harness is a web-workspace test helper. The receipt covers the protocol, and the heavy test plus screenshots cover the Board. Both are named under `docs/reports/integrations-e2e-*`.
- **Closed: cancel proof.** A real spawned stub child, not a seeded row, because only a real child proves the abort reaches the process group.

### Design

- **Protocol leg:** copy the boot and teardown, free-port and step-recorder shape from `scripts/commands/a2a-serve-e2e.ts`. Copy the stub-binary-on-PATH and member config from `scripts/commands/fleet-e2e.ts`. Use plain `fetch` with JSON-RPC bodies for MCP and A2A; the `a2a` CLI is not needed for these assertions. The tokens are random per run and live only in the child env; they never enter the receipt.
- **Determinism:** asserted fields carry no timestamps, ports, temp paths or ids. Those are recorded under an unasserted `context` key. Two consecutive runs must produce byte-identical `steps`.
- **Board leg:** reuse `buildBoardToTemp`, `serveBoard`, `launchBrowser` and the screenshot helper pattern from the existing heavy tests. Stub the API with a fixture `integrations.status` response (MCP on, A2A on with the token unset, gateway not served), so the test is about rendering, not boot.
- **Frozen names:** `integrations-e2e` (command), `docs/reports/integrations-e2e-receipt.json`, `docs/reports/integrations-e2e-summary-{light,dark}.png`.
- **Anti-patterns:** no import from `apps/web/tests` in `scripts/`; no sleeps for synchronization (poll with a bound); no wall-clock values in asserted fields.
- **Depends on 1421–1424.** Leaves nothing for later tasks; this is the feature's proof.

### Plan

Premises (verified 2026-11-21):
- Receipt convention: `scripts/commands/a2a-serve-e2e.ts:32`. Command registry: `scripts/spur-dev.ts:77,133`.
- Model stub on PATH: `scripts/commands/fleet-e2e.ts:28`.
- CDP browser harness: `apps/web/tests/test-helpers/cdp.ts`, used at `apps/web/tests/board-base-path.heavy.test.ts:4`.

- [ ] 1. Failure modes the script must surface as a nonzero exit:
  - serve never answers health (bounded wait);
  - any of the five assertions fails;
  - cancel returns `runStopped:false`;
  - the member is gone after cancel;
  - a token string appears anywhere in the receipt (self-check before write).
- [ ] 2. Write the protocol leg and register it in `scripts/spur-dev.ts` and `package.json`.
- [ ] 3. Write the Board heavy test with a fixture status and screenshots.
- [ ] 4. Run `bun run integrations-e2e` twice and diff the `steps` arrays; they must be identical. Run `bun run test:heavy` for the browser leg. Then run `bun run spur-check`.

### Solution

<!-- Filled during implementation: file:line change map and concise rationale. -->

### Testing

<!-- Filled during verification: commands run, outcomes, coverage claim or N/A. -->

### Review

<!-- Filled during review: P1-P4 findings, residual risk, and final disposition. -->

### References

<!-- Links to the parent feature, design docs, related tasks, or external references. -->

### History

- 2026-11-22T02:19:02.338Z feature_id S → A82 (system)

