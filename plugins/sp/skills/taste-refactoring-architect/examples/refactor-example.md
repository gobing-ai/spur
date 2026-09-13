# Worked Example — Simplifying an Over-Distributed Order Flow

## Situation
An order placement flow crosses six services synchronously:
`Web -> Checkout -> Pricing -> Promotion -> Inventory -> Order -> Notification`.
Pricing and Promotion are owned by the same team, deploy together, and share a database. Notification blocks the request even though delivery is not required before the order is accepted. An old “OrderFacade” proxy only forwards requests to Order. The system meets load requirements but has frequent partial-failure incidents.

## Preservation Contract
- Price and promotion rules remain functionally identical.
- Inventory reservation remains strongly validated before acceptance.
- Order acceptance p99 remains <= 900 ms.
- Notification may be delayed up to 60 seconds.
- No accepted order may be lost.
- Existing public checkout API remains compatible during migration.

## Findings

### F-01 OrderFacade
**Observation:** Pass-through hop with no policy, transformation, ownership, or compatibility role.
**Action:** A1 DIRECT REMOVE.
**Proof:** Trace/dependency analysis confirms only Checkout calls it; contract tests can move directly to Order.

### F-02 Pricing + Promotion split
**Observation:** Two services share owner, data, deployment cadence, and change together.
**Action:** A3 CONSOLIDATE / SIMPLIFY.
**Target:** One `CommercialRules` module/service depending on whether independent deployment is still useful.

### F-03 Notification on critical synchronous path
**Observation:** Notification availability increases checkout failure probability without contributing to acceptance correctness.
**Action:** A3 CONSOLIDATE / SIMPLIFY by removing it from the synchronous critical path; publish an `OrderAccepted` event after durable order commit.
**Required enhancement:** idempotent notification consumer and replay/dead-letter recovery.

### F-04 Inventory boundary
**Observation:** Inventory has independent scaling and correctness semantics; failure must prevent oversell.
**Action:** A0 KEEP.

### F-05 Overall redesign
**Observation:** Local changes remove two remote hops and one unnecessary blocking dependency.
**Action:** A7 DEFER / OBSERVE for broader redesign. A full rewrite/microservice re-platform is not justified.

## Resulting flow
`Web -> Checkout -> CommercialRules -> Inventory -> Order`
then asynchronous `OrderAccepted -> Notification`.

## Fitness functions
- public checkout contract tests pass unchanged,
- price/promotion golden test corpus has zero semantic diff,
- no accepted order without durable order record,
- p99 checkout <= 900 ms,
- notification delivered/recovered within 60 seconds for 99.9% of events,
- synchronous downstream dependency count reduced from 6 to 4,
- incident rate for notification failures no longer affects order acceptance.

## Why this is better
The target preserves business behavior while reducing synchronous failure surface, remote calls, and false service boundaries. It adds only the reliability machinery required by the newly asynchronous notification path.
