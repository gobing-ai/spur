---
schema_version: 1
name: MCP protocol-revision policy amendment and enforcement
status: todo
template: feature-impl
created_at: 2026-11-22T02:21:34.123Z
updated_at: "2026-11-22T04:26:15.227Z"
feature_id: B93

tags: ["B93"]
priority: P2
estimate_hours: 2
---

## 1431. MCP protocol-revision policy amendment and enforcement

### Background

Implements: R3 — The server's MCP protocol-revision policy is explicit and tested.

ADR-152 owns the MCP version contract. `docs/design/mcp-agent-adoption.md` §3 flags the per-agent revision gap.

**Refine corrections (2026-11-21)**
- "Decide range vs exact-with-clear-error" → **already decided and shipped.** It is an open-ended floor:
  - `MIN_MCP_PROTOCOL_VERSION = '2026-07-28'` (`apps/server/src/modules/mcp/protocol.ts:20`);
  - `validateVersion` (:108-129) rejects a missing header, a malformed version or a version below the floor with `400 PROTOCOL_VERSION_UNSUPPORTED`, and the message names the floor;
  - ADR-152 (`docs/00_ADR.md:2975`, amended 2026-11-20 by 1417) says legacy versions are rejected, not negotiated, and that "the bridge owns stdio compatibility" (`spur mcp`, `apps/cli/src/commands/mcp.ts:27,83-121`, which translates `initialize` for `2024-11-05 … 2025-11-25`).

  What is missing is stating the consequence and making the error lead somewhere. A client that speaks the 2025 lifecycle sends `initialize` with **no** `Mcp-Protocol-Version` header. Over direct HTTP it gets "missing the Mcp-Protocol-Version header; send 2026-07-28 or newer", with no pointer to the bridge that would work. This is the prime suspect for the Codex HTTP "no tools" case (1433).
- "initialize with an accepted revision succeeds" → MCP 2.0+ has no `initialize`. The accepted-path probe is `server/discover` with `Mcp-Protocol-Version: 2026-07-28`, which is already tested.
- Tests exist for the rejection path (`apps/server/tests/modules/mcp/protocol.test.ts:62-79`), but the legacy list there and in the `protocol.ts:15` comment omits `2025-06-18`, which the bridge's `LEGACY_VERSIONS` includes.
- External claim to verify while implementing: that `2026-07-28` is the published MCP revision that removes `initialize`/sessions. Cite the modelcontextprotocol.io spec page in the amendment; if it cannot be confirmed, write the amendment as "Spur's floor" without claiming spec status.

### Requirements

- [ ] R1. An ADR-152 amendment (dated, appended to its Amended list) states:
  - accepted = any `YYYY-MM-DD` revision ≥ `2026-07-28` (open-ended floor);
  - pre-2.0 clients are supported only through `spur mcp` (stdio bridge), and direct HTTP rejects them;
  - the consequence: an agent is `mcp-http` only if its HTTP client speaks ≥ the floor.

  Cite the spec source, or label it Spur policy.
- [ ] R2. Every `PROTOCOL_VERSION_UNSUPPORTED` message (missing, malformed, below floor) names the accepted floor **and** the fallback (`use the stdio bridge: spur mcp`). A body that is a legacy `initialize` with no version header gets that same actionable message rather than only "missing header".
- [ ] R3. Tests in `apps/server/tests/modules/mcp/protocol.test.ts` cover the following:
  - `server/discover` at the floor and at a later date succeeds;
  - each of `2024-11-05`, `2025-03-26`, `2025-06-18`, `2025-11-25` is rejected with a message containing `2026-07-28` and `spur mcp`;
  - a header-less legacy `initialize` body is rejected with the same message.
- [ ] R4. The `protocol.ts:15` legacy list matches the bridge's `LEGACY_VERSIONS`.

Out of scope: accepting the legacy lifecycle on HTTP (rejected by ADR-152 §Alternatives); the status code or error code change (both stay `400 PROTOCOL_VERSION_UNSUPPORTED`, so this is a non-breaking message change).

### Acceptance Criteria

- [ ] AC1 — The server's MCP protocol-revision policy is explicit and tested

### Q&A

<!-- CLOSED decisions from refinement: what was chosen and why, what was deferred and on what
     condition. Not a parking lot for open questions — an unanswered question here means the task
     is not ready to hand off. Keep empty if none. -->

#### Q&A entry — 2026-11-22T04:26:11.497Z

- **Closed: range vs exact.** It is an open-ended floor, already in code and ADR-152. This task states it and makes the rejection actionable. It does not reopen the decision.
- **Closed: accept legacy on HTTP.** No. ADR-152 already rejected it (bridge owns compatibility). Revisit only if 1432 shows that most agents cannot use the bridge.

### Design

- **Single source for the message:** one `versionError(detail)` helper in `protocol.ts` builds `"${detail}; this server accepts ${MIN}+ — pre-2.0 clients connect through the stdio bridge (spur mcp)"`. The three `fail(...)` sites call it.
- **Legacy initialize detection:** before `validateVersion` throws for a missing header, peek at the parsed body (`method === 'initialize'`). If it matches, the detail becomes `"legacy initialize handshake (protocolVersion <x>)"`. Reorder parse vs validate only if needed; the body is read once.
- **Frozen:** HTTP 400, code `PROTOCOL_VERSION_UNSUPPORTED`, JSON-RPC -32000, the `MIN_MCP_PROTOCOL_VERSION` name and value, and bridge behavior.
- **Anti-patterns:** no version negotiation or downgrade; no per-client sniffing (User-Agent); do not import the server constant into the CLI (ADR forbids deep imports; the mirror comment at `mcp.ts:23` stays).
- **Handoff to 1432/1433:** the error text is the signal the interop harness classifies as `rejected-legacy-revision`.

### Plan

Premises (verified 2026-11-21): floor at `protocol.ts:20`; `validateVersion` at :108-129; rejection tests at `protocol.test.ts:62-79`; bridge translation at `apps/cli/src/commands/mcp.ts:27,83-121`; ADR-152 at `docs/00_ADR.md:2975`.

- [ ] 1. Failure modes: the message omits the bridge; a header-less `initialize` is classified as generic; `2025-06-18` slips through untested; the status or code changes and breaks clients.
- [ ] 2. Extend `protocol.test.ts` with the R3 cases. Run `(cd apps/server && bun test tests/modules/mcp/protocol.test.ts)`; the new message assertions fail.
- [ ] 3. Implement `versionError` and the legacy-initialize detail. Fix the :15 comment. The tests go green.
- [ ] 4. Verify the spec revision source, then write the ADR-152 amendment.
- [ ] 5. Run `bun run spur-check`.

### Solution

<!-- Filled during implementation: file:line change map and concise rationale. -->

### Testing

<!-- Filled during verification: commands run, outcomes, coverage claim or N/A. -->

### Review

<!-- Filled during review: P1-P4 findings, residual risk, and final disposition. -->

### References

<!-- Links to the parent feature, design docs, related tasks, or external references. -->

### History

- 2026-11-22T02:22:13.966Z backlog → todo (system)

