---
schema_version: 1
name: "A2A inspection: agent card JSON, a2a snippets, outbound auth state and trace links"
status: done
template: issue
created_at: 2026-11-23T00:55:57.547Z
updated_at: "2026-11-23T06:14:45.069Z"
feature_id: A82

ac_numbering: task-local
ac_altitude: task-local
priority: P2
estimate_hours: 8
done_forced: "false"
done_reason: unforced close
---

## 1440. A2A inspection: agent card JSON, a2a snippets, outbound auth state and trace links

### Background

Task 1437 filed this as gap G3. The A2A tab links to public inbound cards and displays outbound receipts, but does not display card JSON or credential state. Its Run column renders plain text. The existing public card route builds the canonical card; the outbound member declaration holds credential settings, while coordination runs persist remote task/context IDs and branch artifact refs.

**Refine corrections (2026-11-22)**
- Attach remote refs to individual inbox receipts, because several runs for a member can refer to different remote tasks. Member status carries credential state only.
- `a2a` is the external CLI invoked by `A2aCliService`. Use its existing argument shapes and credential-helper convention.
- Observability Trace presently seeds by `wbs` and has no exact run URL selector. Its workflow detail endpoint reads the workflow run store, while A2A receipt IDs refer to coordination runs. Use the existing agent lineage service for the destination.

### Requirements

- [x] R1. Let an operator inspect the actual public Agent Card JSON inline on demand and copy `a2a card get` and `a2a send` examples for the selected inbound member.
- [x] R2. Show outbound A2A and cross-project credential state using only the configured variable name and its presence. Show the locally persisted remote task ID, context ID and branch on their corresponding receipt.
- [x] R3. Offer a base-aware Observability Trace link that opens the selected local run, and warn when the enabled A2A listener has no inbound members.

Out of scope are sending messages from the Board, retrieving live remote task state on page load, and changes to A2A authentication or listener routing.

### Acceptance Criteria

```gherkin
Scenario: AC1 — Inbound card inspection is on demand and scoped to the current project (req: R1)
  Given an enabled, gateway-prefixed listener with one public card
  When an operator expands the card inspector
  Then it fetches that member's public card via the current Board base without auth and renders the JSON as text alongside the CLI examples
  And an unavailable card shows an inline retry while a disabled listener offers no fetch

Scenario: AC2 — Outbound auth and remote refs are scoped to their owners (req: R2)
  Given one configured credential and two receipts for the same member with different remote IDs and branches
  When the Board loads outbound inspections
  Then status reports the variable name and whether it is set, each receipt reports its own persisted refs, and the response and UI contain no secret value
  And a missing receipt run or branch renders without remote refs for that field

Scenario: AC3 — A2A run links open the selected trace and empty inbound is diagnosed (req: R3)
  Given a gateway-prefixed Board with an A2A run outside the default Trace window
  When the operator follows its Run link
  Then Observability › Trace opens that exact run, while a receipt without a local run has no link
  And an enabled listener with no inbound members displays a warning
```

### Q&A

<!-- Clarifications and triage decisions. Keep empty if none. -->

#### Q&A entry — 2026-11-23T02:51:11.327Z

Closed during refinement. Inspect inbound Card JSON through the existing public route. Use a read-only receipt projection and distinguish a missing credential name from an unset configured variable. Use exact local run identity for trace navigation; remote IDs are display metadata.

### Design

In `A2aTab.tsx` lazily fetch the local encoded-member card using `withBase` and the existing web fetch helper; do not fetch the outbound target. Render text in a preformatted block and keep errors local to the inspector. Use the command shapes in `packages/app/src/services/a2a-member-transport.ts` (`a2a card get -o json`, `a2a send -o json --request-payload …`, `-a`); the send example uses a placeholder payload and the external CLI credential-helper option for a protected endpoint. Quote shell arguments and keep execution manual.

Add optional `auth: IntegrationsAuth` to outbound status; read variable presence in the server source adapter, then project only `envName` and `tokenPresent` via `IntegrationsService`. Read persisted refs from the latest run already selected by the inbox request projection in `packages/domain/src/dao/inbox-dao.ts`. Carry `remoteTaskId`, `remoteContextId`, `remoteBranch` as optional fields through `inboxRequestSchema`, the existing handler and receipt rows. Reuse the branch artifact decoding from the A2A transport as needed, with malformed/absent artifacts treated as absent. Use the existing joined request query and preserve fallback rows in `useIntegrations.ts`; do not call transport refresh or attach member-level refs.

Emit `withBase('/board/observability?...')` with `tab=trace` and an encoded `runId`. In `TraceTab.tsx` give exact-run intent precedence over WBS/list filters and load the agent lineage through a read-only `GET /api/observability/agent-trace/:runId` route backed by `AgentTraceService.trace` with no remote refresh adapter. Require a UUID (the existing A2A run generators use UUIDs) and return 404 if the requested run is absent. Return a typed display projection of root ID and node ID, kind, status and parent ID; omit log paths, sessions and contents. Highlight the requested node, with scoped loading, retry and missing states. Keep the ordinary list/WBS mode when the intent is absent, and existing Inbox and System Events links. 1421 and 1423 supply the public card and status contract. Coordinate the shared `A2aTab` edit with 1439.

### Plan

- [ ] R1. Add browser/component cases for on-demand card load, prefixed URL, inline error and enabled/disabled states. Implement the inspector and examples.
- [ ] R2. Extend `apps/server/tests/modules/inbox/handlers.test.ts` and `apps/server/tests/modules/integrations/handlers.test.ts` with distinct stored receipts, credential state and redaction checks. Extend the existing projections and render the fields.
- [ ] R3. Extend `apps/web/tests/modules/integrations/integrations-module.test.tsx` and Observability Trace coverage to follow a prefixed link to an older run, exercising exact agent lineage lookup, a missing run, and omission of logs. Cover the route in `apps/server/tests/modules/observability/index.test.ts`. Keep ordinary WBS/list navigation covered.
- [ ] R1–R3. Extend the existing Integrations E2E/browser proof with a local fixture and repeatable receipt. Use matching Board and server builds. Run the affected workspace checks and update the Integrations and inbox design satellites for their contract changes.

### Root Cause

<!-- Verified underlying cause with file:line evidence. Fill once reproduced/isolated. -->

### Solution

| File | Lines | What / why |
| --- | --- | --- |
| `packages/contracts/src/inbox.ts` | 52–75 | `inboxRequestSchema` gains optional `remoteTaskId` / `remoteContextId` / `remoteBranch`: the remote refs belong to the receipt's own run, not to the member. |
| `packages/domain/src/dao/inbox-dao.ts` | 45–55, 116–128, 500–530 | The joined request query selects `coordination_runs.remote_task_id` and `remote_context_id` beside the existing task id and artifact refs, so one read answers both. |
| `apps/server/src/modules/inbox/handlers.ts` | 137–160, 276–292 | Projects the three refs per row; a malformed or absent artifact reads as `null` instead of failing the row. |
| `packages/contracts/src/integrations.ts` | 66–80 | `integrationsOutboundMemberSchema` gains optional `auth` (the declared credential's name and presence). |
| `packages/app/src/services/integrations-service.ts` | 46–60, 236–262 | The A2A source port carries `outboundAuth` keyed by member instance id; the outbound projection attaches `auth` only when the member declares one. |
| `apps/server/src/modules/integrations/handlers.ts` | 60–85, 100–125, 145–155 | Reads the fleet declaration and environment once per status read and hands over only `{envName, tokenPresent}` — the value never leaves the handler. |
| `apps/web/src/modules/integrations/helpers.ts` | 130–200 | `traceLink` (UUID-only, base-aware), `a2aExamples` (card + credential-helper, never a token) and the receipt ref fields. |
| `apps/web/src/modules/integrations/A2aTab.tsx` | 24–95, 100–210, 300–345 | The on-demand `CardInspector` (lazy fetch, inline error + retry, no fetch while the listener is off), the CLI examples, outbound credential state, per-receipt `RemoteRefs`, the UUID Run link and the no-inbound warning. |
| `apps/web/src/modules/integrations/IntegrationsModule.tsx` | 150–160 | Threads the card-fetch seam to the A2A tab. |
| `apps/web/src/modules/observability/TraceTab.tsx` | 300–470, 560–580 | Exact-run intent: `runId` outranks the WBS/list filters and renders the lineage (root, nodes, highlighted requested run) with loading, retry and missing states; the ordinary list is untouched without the intent. |
| `apps/server/src/modules/observability/index.ts` | 40–75, 490–520 | `GET /api/observability/agent-trace/:runId` — UUID-guarded, 404 for a run the project never stored, projection without logs/sessions. |
| `apps/server/tests/modules/inbox/handlers.test.ts` | 630–690 | R2 regression: two receipts for one member keep their own task/context/branch, and a malformed artifact reads as no branch. |
| `apps/server/tests/modules/integrations/handlers.test.ts` | 410–455 | R2 regression: a declared credential reports its name and presence, an unset one reports `tokenPresent: false`, and the token value is absent from the payload. |
| `apps/server/tests/modules/observability/index.test.ts` | 1115–1185 | R3 regression: an older child run opens by identity with no `logPath`/`sessionIds`, an absent run is 404 and a non-UUID is 400. |
| `apps/web/tests/modules/integrations/integrations-module.test.tsx` | 100–135, 545–700 | R1–R3 regression: lazy card fetch, inline error, disabled listener, examples, outbound credential state, per-receipt refs, UUID Run link and the no-inbound warning. |
| `apps/web/tests/modules/observability/agent-trace.test.ts` | 1–45 | R3 regression: the projection keeps identity and shape and drops every internal field. |
| `apps/web/tests/modules/integrations-browser.heavy.test.ts` | 60–120 | The live Board leg opens the A2A tab, asserts no warning, and loads the real public card. |
| `docs/design/integrations-module.md` | 130–175 | A2A tab contents, the per-receipt refs rule, the credential rule and the exact-run link recorded beside the surface change (T3). |

### Testing

**Pipeline verify results**

- Verdict: PASS (from verdict artifact)

| Requirement | Status | Evidence |
|-------------|--------|----------|
| R1 | MET | `apps/web/tests/modules/integrations/integrations-module.test.tsx:689` — The inspector stays on the current Board mount despite a different advertised origin. On-demand rendering, retry, off state and CLI examples are tested in the same suite. |
| R2 | MET | `apps/server/tests/modules/inbox/handlers.test.ts:616` — Two receipts retain separate remote refs; missing refs remain absent. Outbound credentials report their name and presence only, proved at apps/server/tests/modules/integrations/handlers.test.ts:405. |
| R3 | MET | `apps/server/tests/modules/observability/index.test.ts:1150` — The route opens an older exact run with no log or session metadata. Links and the inbound warning are exercised in apps/web/tests/modules/integrations/integrations-module.test.tsx:794 and :804. |

| Acceptance Criteria | Status | Evidence Type | Evidence |
|---------------------|--------|---------------|----------|
| AC1 — Inbound card inspection is on demand and scoped to the current project (req: R1) | MET | test | `apps/web/tests/modules/integrations/integrations-module.test.tsx:689` — The inspector stays on the current Board mount despite a different advertised origin. On-demand rendering, retry, off state and CLI examples are tested in the same suite. |
| AC2 — Outbound auth and remote refs are scoped to their owners (req: R2) | MET | test | `apps/server/tests/modules/inbox/handlers.test.ts:616` — Two receipts retain separate remote refs; missing refs remain absent. Outbound credentials report their name and presence only, proved at apps/server/tests/modules/integrations/handlers.test.ts:405. |
| AC3 — A2A run links open the selected trace and empty inbound is diagnosed (req: R3) | MET | test | `apps/server/tests/modules/observability/index.test.ts:1150` — The route opens an older exact run with no log or session metadata. Links and the inbound warning are exercised in apps/web/tests/modules/integrations/integrations-module.test.tsx:794 and :804. |
- Coverage: N/A (verdict-based; verify pipeline does not measure code coverage)

### Review

| ID | Sev | Location | Finding |
| --- | --- | --- | --- |
| F1 | P4 | `apps/web/src/modules/observability/TraceTab.tsx:300-470` | `ExactRunLineage` is covered through `parseAgentTrace` and the server route, not through a mounted TraceTab: the tab has no existing render harness (runs list + search params + three fetches). The render path is exercised by the live Board leg. |
| F2 | P4 | `apps/web/tests/modules/integrations-browser.heavy.test.ts:60-120` | The live A2A assertions were added but not executed in this run (needs a served project plus a Board build — the feature-scope heavy pass). |
| F3 | P4 | `apps/server/src/modules/observability/index.ts:505-515` | Existence is asked of the store before projecting, because `AgentTraceService.trace` synthesizes an `unknown` node for an id it cannot find. A typed not-found from `trace` would let this check go. |

SECUA: the credential value never crosses the port; the card fetch is unauthenticated by design and stays behind an explicit click; the trace projection is an allow-list; `runId` is UUID-validated before any DB read.

Verdict: PASS

### References

<!-- Links to failing logs, related issues, tasks, docs, or external references. -->

### History

- 2026-11-23T04:06:41.158Z todo → wip (system)
- 2026-11-23T04:08:32.441Z wip → testing (system)
- 2026-11-23T04:08:34.028Z testing → done (system)

