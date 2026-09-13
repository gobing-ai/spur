# Architecture Refactoring Playbook

## 1. Definition of “better”
A refactored architecture is better when it preserves required business behavior and delivery qualities while decreasing unnecessary complexity, coordination, operational burden, or irreversible commitments.

A useful before/after scorecard tracks:
- runtime components and dependencies,
- synchronous call depth,
- deployable units,
- persistence technologies,
- duplicated domain rules,
- cross-team handoffs per representative change,
- deployment lead time and failure rate,
- incident frequency/blast radius/recovery time,
- cost per useful business unit,
- time for a new engineer to understand/change a critical flow.

## 2. Simplification lenses

### Capability lens
Map components to business capabilities. Unmapped components are deletion candidates; multiple components for one capability may be consolidation candidates.

### Change-coupling lens
Inspect which components change together. If independent services are almost always changed/deployed together, the boundary may be false.

### Runtime-coupling lens
Inspect critical request paths. Long synchronous chains multiply latency and failure probability.

### Data lens
Identify sources of truth, replicas, caches, shared writes, synchronization, and reconciliation. Complexity often hides in data movement rather than boxes.

### Ownership lens
Map every component to one accountable team. Misalignment creates coordination tax and unreliable operations.

### Failure lens
For each dependency, ask what happens when it is slow, unavailable, duplicated, reordered, or partially successful.

### Quality lens
Tie each structural decision to a measurable quality requirement. Redundancy, isolation, caching, asynchronous processing, and extra deployment units may all be justified — but only by a requirement.

## 3. Complexity budget
Think of architecture complexity as a budget. Spend it only where it buys a material capability or quality.

Common costs:
- network boundaries,
- distributed consistency,
- async semantics,
- schema evolution,
- independent deployment pipelines,
- observability surface,
- access control surface,
- operational ownership,
- version compatibility,
- data synchronization,
- incident diagnosis.

## 4. Refactoring patterns

### Delete
Remove dead services, queues, adapters, databases, caches, gateways, compatibility layers, feature flags, or pipelines after proving they are unused.

### Inline
Inline a thin service/module that only delegates and has no independent ownership, policy, scaling, security, or lifecycle reason.

### Merge
Merge components with the same owner, lifecycle, data, and change cadence when separation creates more coordination than isolation value.

### Modularize in place
Before extracting services, create explicit module boundaries, ownership, dependency rules, and tests inside the existing deployment unit.

### Split by proven axis
Split only where independence is valuable: ownership, security, scale, failure isolation, data lifecycle, or release cadence.

### Replace bespoke with standard capability
Retire custom schedulers, service discovery, retry frameworks, configuration systems, or deployment machinery when a standard platform/managed capability can satisfy requirements with less burden.

### Strangle incrementally
Place a seam around legacy behavior, route selected flows to a replacement, compare results, migrate consumers/data gradually, then delete the legacy path.

### Collapse integration hops
Remove unnecessary gateways/translators/brokers in a path where they add no policy, protocol, security, buffering, or ownership value.

### Make data ownership explicit
Assign one authoritative writer and expose controlled reads/events/APIs rather than shared writes.

### Introduce async deliberately
Use a queue/event log for buffering, fan-out, long-running work, temporal decoupling, or resilience. Pair it with idempotency, retries, DLQ/recovery, ordering assumptions, and observability.

### Introduce cache deliberately
Add cache only for measured cost/latency/load. Define key ownership, TTL/invalidation, stampede protection, consistency expectations, and failure behavior.

## 5. Redesign triggers
Redesign is warranted when evidence shows the architecture cannot economically or safely satisfy required qualities with local improvements.

Strong triggers:
- repeated systemic incidents caused by structural coupling,
- scaling ceiling that cannot be relieved locally,
- security/compliance requires a new trust boundary,
- core data model prevents correctness,
- common changes require coordinated releases across many independently owned systems,
- platform is unsupported and blocks safe delivery,
- operational cost dominates product value despite optimization.

Weak triggers (not enough alone):
- “old technology”,
- “not cloud native”,
- “competitors use microservices”,
- desire for a new framework,
- preference for a pattern,
- aesthetically messy diagrams.

## 6. Quality-preservation matrix
For each refactor, explicitly assess:

| Quality | Questions |
|---|---|
| Functionality | Are all user/business flows preserved? Any edge-case behavior lost? |
| Reliability | Does failure isolation improve or regress? What new dependencies appear? |
| Recoverability | Are backup, replay, restore, rollback, RTO/RPO preserved? |
| Performance | What happens to latency, throughput, capacity, and tail behavior? |
| Security | Do trust boundaries, least privilege, auditability, and secrets improve? |
| Data | Is ownership clearer? Are consistency and retention semantics unchanged? |
| Operability | Is it easier to deploy, observe, diagnose, and recover? |
| Maintainability | Does a common change touch fewer concepts/components/teams? |
| Compatibility | Are existing consumers/contracts preserved during migration? |
| Cost | Does total runtime + engineering + operational cost improve? |

## 7. Architecture fitness functions
Examples:
- no domain package may depend on infrastructure packages except through defined ports,
- no synchronous request path may exceed N remote calls,
- critical APIs must meet p99 latency and error-rate thresholds,
- all externally consumed schemas pass compatibility checks,
- critical business flows meet availability SLO,
- restore drill meets RTO/RPO,
- no production component lacks an owning team and runbook,
- no service may directly write another service’s owned tables,
- representative feature change must require no more than N team handoffs,
- architecture cost per transaction stays below threshold.

## 8. Migration safety
Each migration step should be independently deployable and observable.

Use as appropriate:
- consumer inventory,
- contract tests,
- compatibility adapters,
- feature flags,
- shadow reads/writes,
- dual run with reconciliation,
- canary rollout,
- traffic splitting,
- backfill checkpoints,
- immutable migration logs,
- rollback-safe schema changes,
- explicit decommission criteria.

## 9. Architecture decision quality
Record ADRs for decisions that are expensive to reverse, constrain many teams, or encode important trade-offs.

A concise ADR contains:
- context/constraints,
- decision,
- alternatives considered,
- trade-offs,
- consequences,
- validation/fitness functions,
- review trigger/date.

Delete or supersede stale ADRs when their constraints disappear.

## 10. “Simple” does not mean simplistic
A simpler architecture may still include redundancy, asynchronous processing, partitioning, isolation, or multiple data stores if those elements are essential to required quality. The goal is justified complexity, not minimal box count.
