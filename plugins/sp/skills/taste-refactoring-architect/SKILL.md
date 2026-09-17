---
name: taste-refactoring-architect
description: Review, simplify, and refactor system architecture toward minimum sufficient architecture while preserving required capabilities, quality attributes, delivery safety, and data invariants. Backs architectural refactoring and boundary reviews.
license: Apache-2.0
metadata:
  author: spur
  version: "1.0"
  platforms: "claude-code,codex,openclaw,opencode,antigravity"
  category: execution
  interactions:
    - technique
  operations:
    - refactor-architecture
  openclaw:
    emoji: "🏛️"
---

# taste-refactoring-architect

## Purpose
Use this skill to review, simplify, and refactor software/system architecture while preserving required capabilities and delivery qualities.

The default objective is **minimum sufficient architecture**: the smallest coherent architecture that preserves required features, quality attributes, compliance obligations, delivery safety, and credible near-term evolution paths.

This is not a “modernize everything” skill. Prefer subtraction over addition, reversible change over big-bang redesign, and evidence over fashion.

## Core outcome
Given architecture diagrams, ADRs, repositories, service inventories, infrastructure, APIs, data flows, SLOs, incidents, costs, deployment topology, or a prose description, produce:

1. A concise model of the current system and its actual responsibilities.
2. A map of architectural complexity, coupling, duplication, and operational burden.
3. A list of invariants that must not regress: features, contracts, quality attributes, regulatory constraints, data semantics, SLOs, RTO/RPO, delivery cadence, and key business flows.
4. A prioritized refactoring plan using the intervention ladder below.
5. A safe migration sequence with validation/fitness functions, rollback boundaries, ownership, and evidence required before each step.
6. A simplified target architecture only when simplification by removal/consolidation is insufficient.

## Prime directive
**Preserve outcomes, not structures.** Existing components, services, queues, layers, databases, frameworks, and deployment units are not requirements unless evidence proves they are necessary.

Ask of every architectural element:
- What capability or quality does it protect?
- What failure or constraint justified it?
- Is that constraint still real?
- Can the same outcome be achieved with fewer moving parts?
- What is the cost of keeping it versus removing it?

## Non-negotiable principles

### 1. Simplify before redesign
Use this order unless evidence demands otherwise:
1. Remove dead or redundant elements.
2. Collapse needless indirection.
3. Standardize duplicated patterns.
4. Reassign unclear ownership.
5. Improve boundaries and contracts.
6. Enhance observability/reliability/security where required.
7. Redesign only when structural limits remain.

### 2. Features and delivery qualities are invariants
Do not simplify by silently degrading:
- functional completeness or correctness,
- reliability/availability/recoverability,
- latency/throughput/capacity,
- security/privacy/compliance,
- operability/observability,
- maintainability/testability,
- deployability/change safety,
- interoperability/compatibility,
- cost constraints,
- data integrity/retention,
- scalability where it is evidenced, not hypothetical.

### 3. Complexity needs a reason
Treat every service boundary, network hop, queue, cache, database, orchestration engine, abstraction layer, framework, runtime, deployment pipeline, and duplicated data model as a complexity cost that must pay rent.

### 4. Prefer cohesive ownership
A boundary is healthy when responsibility, data, runtime behavior, and team ownership line up. Shared ownership, distributed transactions, cross-service chatty workflows, and “everyone owns it” are strong refactoring signals.

### 5. Optimize for change
Prefer designs where common business changes touch one cohesive area, can be tested locally, and can be deployed independently when independence is actually valuable.

### 6. Prefer reversible decisions
Delay irreversible choices until evidence is sufficient. Favor incremental migration, strangler-style replacement, compatibility layers, feature flags, parallel runs, canaries, shadow traffic, and reversible data migrations when risk warrants them.

### 7. Quality is measurable
Translate architecture qualities into fitness functions or acceptance checks. “Scalable”, “resilient”, “secure”, and “maintainable” are not conclusions without observable criteria.

## The intervention ladder
Classify every finding into exactly one primary action. Use the least disruptive action that solves the real problem.

### A0 — KEEP
The element is justified, cohesive, owned, and proportionate. Do not churn it.

Use when:
- its value and constraints are clear,
- removal would harm an invariant,
- there is no material simplification benefit.

Output: `KEEP — <reason and evidence>`

### A1 — DIRECT REMOVE
Remove with little or no architectural replacement.

Use only when evidence shows the element is dead, duplicate, bypassed, unreachable, obsolete, or purely accidental complexity, and removal has a bounded blast radius.

Typical candidates:
- unused services/endpoints/queues/topics,
- duplicate caches,
- dead adapters,
- obsolete feature infrastructure,
- pass-through proxy layers with no policy value,
- duplicated schedulers or pipelines,
- abandoned migration bridges.

Required proof:
- dependency/traffic evidence,
- contract search,
- data retention check,
- operational/rollback plan.

### A2 — SUGGEST REMOVE
Likely unnecessary, but evidence is incomplete or organizational/business coupling raises risk.

Use when:
- utilization is near-zero but not proven zero,
- ownership is unclear,
- a component exists for a historical reason that may still matter,
- external consumers may exist.

Output must specify the evidence needed to graduate to A1.

### A3 — CONSOLIDATE / SIMPLIFY
Keep the capability, reduce the number of concepts or moving parts.

Typical moves:
- merge nano-services with the same owner/change cadence/data lifecycle,
- collapse redundant layers,
- consolidate duplicate databases or queues,
- replace custom infrastructure with one standard platform capability,
- unify duplicated policy/enforcement points,
- remove premature extensibility.

### A4 — SUGGEST ENHANCE
Structure is basically sound, but delivery quality is insufficient.

Enhance only for a named quality gap, for example:
- add idempotency for retry safety,
- add circuit breaking/timeouts/backpressure,
- improve SLOs and observability,
- add schema/contract tests,
- isolate secrets/permissions,
- add automated recovery,
- partition hotspots,
- introduce caching where measured latency/cost justifies it.

Never add “best practice” machinery without a demonstrated risk or requirement.

### A5 — RE-BOUNDARY
The main problem is domain, data, dependency, or ownership boundaries rather than technology.

Signals:
- one change routinely spans many services,
- cyclic dependencies,
- distributed transactions for ordinary workflows,
- shared database tables across supposed service boundaries,
- high coordination cost between teams,
- duplicated domain rules,
- unstable interfaces between tightly coupled components.

Possible moves:
- move capabilities to the team/domain that owns the invariant,
- modularize a monolith before extracting services,
- merge services that are operationally inseparable,
- split a component only around a proven independent lifecycle or scale/security boundary.

### A6 — SUGGEST RE-DESIGN
Use only when local simplification cannot meet requirements or the current architecture is fundamentally mismatched to constraints.

Triggers include:
- hard reliability/scalability limits,
- unacceptable security/compliance exposure,
- data consistency model incompatible with business rules,
- architecture prevents required delivery cadence,
- extreme coupling makes change unsafe,
- platform/runtime is no longer supportable,
- economics remain structurally unacceptable after simpler fixes.

A redesign recommendation must include:
- explicit constraints driving it,
- rejected lower-level interventions,
- at least two viable target options,
- trade-offs,
- migration strategy,
- exit/rollback strategy where feasible.

### A7 — DEFER / OBSERVE
Do not change yet. Add instrumentation or gather evidence first.

Use when architecture debate is speculative. Define what to measure and the decision threshold.

## Architecture review workflow

### Phase 0 — Establish scope
Identify:
- business capabilities in scope,
- system boundaries,
- actors and external dependencies,
- critical user/business journeys,
- teams and ownership,
- deployment and data boundaries.

If diagrams disagree with production behavior, trust runtime evidence and record the mismatch.

### Phase 1 — Capture invariants
Build a `Preservation Contract`:
- features/business flows,
- public/internal contracts,
- data ownership and semantics,
- SLO/SLI targets,
- RTO/RPO,
- security/compliance obligations,
- peak load and capacity needs,
- cost envelopes,
- deployment/release expectations,
- regional/residency requirements.

Unknown values are risks, not assumptions.

### Phase 2 — Build a complexity inventory
Inventory architecture elements and tag each with:
- responsibility,
- owner,
- consumers/providers,
- state owned,
- synchronous dependencies,
- asynchronous dependencies,
- deployment unit,
- failure modes,
- traffic/load,
- cost,
- change frequency,
- incident history,
- rationale/ADR if known.

### Phase 3 — Detect architecture smells
Look for:
- accidental distribution,
- needless indirection,
- cyclic dependencies,
- shared mutable data,
- duplicate sources of truth,
- pass-through services,
- chatty synchronous chains,
- orchestration with no business value,
- event buses used as hidden RPC,
- too many persistence technologies,
- cache inconsistency complexity,
- generic “platform” layers used by one consumer,
- bespoke infrastructure replacing managed/common capabilities,
- boundary/ownership mismatch,
- premature multi-region or multi-cloud complexity,
- speculative extensibility,
- duplicated cross-cutting logic,
- orphaned components,
- manual operational steps,
- architecture that cannot be tested or observed.

### Phase 4 — Score findings
Score each finding from 1–5 on:
- `Complexity Cost` — cognitive, operational, dependency, infrastructure.
- `Change Friction` — coordination and deployment burden.
- `Failure Blast Radius`.
- `Quality Risk` — reliability/security/performance/etc.
- `Evidence Confidence`.
- `Removal/Rework Risk`.
- `Business Value Protected`.

Do not sum mechanically. Use scores to expose trade-offs.

### Phase 5 — Apply the intervention ladder
For each finding choose A0–A7 and explain why lower-intervention actions are insufficient when recommending A4+.

### Phase 6 — Design the simpler target
Target architecture should reduce at least one of:
- number of deployable units,
- number of runtime dependencies,
- number of data stores/technologies,
- synchronous path length,
- concepts engineers must understand,
- team handoffs per change,
- duplicated policy/rules,
- bespoke operational mechanisms.

If none decrease, challenge whether the proposal is truly simplification.

### Phase 7 — Prove preservation with fitness functions
Define checks before migration. Examples:
- API/contract compatibility tests,
- end-to-end business flow tests,
- latency percentile budgets,
- availability/error-rate SLOs,
- RTO/RPO recovery tests,
- security policy checks,
- architecture dependency rules,
- data reconciliation thresholds,
- deployment lead time/failure rate,
- cost per transaction/request/tenant,
- number of cross-team dependencies for representative changes.

### Phase 8 — Sequence migration
Prefer small, independently verifiable increments.
For each step include:
- change,
- precondition,
- validation,
- rollback/exit,
- observability,
- owner,
- dependency,
- risk.

Avoid “rewrite then switch” unless incremental migration is demonstrably worse.

## System-level heuristics

### Monolith vs services
Do not default to microservices. A well-modularized monolith is often simpler when:
- one/few teams own the product,
- scaling characteristics are similar,
- deployment independence has little value,
- strong consistency dominates,
- domain boundaries are not stable.

Services earn their cost when there is a proven independent boundary such as:
- team ownership,
- deployment cadence,
- security/trust boundary,
- data lifecycle,
- scaling profile,
- failure isolation,
- regulatory boundary.

### Synchronous vs asynchronous
Prefer synchronous communication for simple request/response workflows with immediate consistency needs.
Use asynchronous messaging when it buys concrete value: temporal decoupling, buffering, fan-out, resilience, independent processing, or long-running workflows.
Do not introduce queues just to appear decoupled.

### Orchestration vs choreography
Use explicit orchestration when a business process needs visible state, ordering, compensation, auditability, or timeout handling.
Use choreography only when event reactions are independently meaningful and the global process remains understandable.
If nobody can explain the end-to-end flow, centralize visibility before adding more events.

### Data
Prefer one authoritative owner per business fact.
Avoid shared-write databases across independent services.
Do not duplicate data unless latency, availability, autonomy, analytics, or integration needs justify synchronization cost.
Treat caches and replicas as derived state with explicit invalidation/reconciliation rules.

### Abstractions
An abstraction is justified when it hides stable repeated complexity from multiple real consumers.
Delete or inline abstractions that add indirection without reducing change cost.

### Platforms
Platform capabilities should reduce cognitive load for product teams. A platform that requires every team to understand its internals is shifting complexity, not removing it.

### Build vs buy / managed vs custom
Favor managed/common capabilities when differentiation is low and operational burden is high, unless constraints around cost, latency, regulation, portability, or lock-in materially change the decision.

## Quality model
Use a context-specific subset of these qualities, with explicit priorities and thresholds:
- functional suitability,
- reliability and recoverability,
- security/privacy,
- performance efficiency and capacity,
- compatibility/interoperability,
- maintainability/modifiability/testability,
- operability/observability,
- deployability/change safety,
- cost efficiency,
- sustainability/resource efficiency,
- portability/flexibility where required.

Do not maximize every quality. Architecture is trade-offs under constraints.

## Ownership and organizational fit
Architecture and team topology should reinforce each other.
Flag:
- one service owned by multiple teams,
- a team owning too many unrelated services,
- components with no accountable owner,
- changes that require recurring coordination across many teams,
- centralized bottleneck teams for routine delivery.

Prefer clear end-to-end ownership and interfaces that reflect stable collaboration boundaries.

## Evidence hierarchy
Prefer evidence in this order:
1. production telemetry and incident history,
2. contracts and actual dependency graphs,
3. tests and deployment data,
4. cost/usage data,
5. current code/config/infrastructure,
6. current ADRs/runbooks,
7. diagrams,
8. stakeholder recollection,
9. assumptions.

Mark assumptions explicitly.

## Output format
Use this structure unless the user asks otherwise.

### 1. Executive assessment
- Current architecture in 3–8 sentences.
- Biggest complexity sources.
- What must be preserved.
- Overall refactoring direction.

### 2. Preservation Contract
A compact table of capabilities/qualities and required thresholds.

### 3. Findings
For each finding:
- `ID`
- `Scope`
- `Observation`
- `Why it matters`
- `Evidence`
- `Action`: A0–A7
- `Expected simplification`
- `Quality impact`
- `Risk`
- `Confidence`

### 4. Target simplifications
Describe only meaningful structural changes. Prefer a current → target mapping.

### 5. Migration plan
Ordered, incremental steps with validation and rollback.

### 6. Fitness functions
Measurable checks that prove feature and quality preservation.

### 7. Decisions / ADR candidates
List irreversible or high-cost decisions that deserve an ADR.

### 8. Deferred questions
Unknowns that could materially change recommendations.

## Anti-patterns for this skill
Never:
- recommend microservices merely because the system is large,
- add Kafka/event sourcing/CQRS/service mesh/Kubernetes/multi-cloud without an evidenced need,
- call a rewrite “refactoring” without a migration strategy,
- remove redundancy that exists to satisfy availability/recovery requirements,
- collapse trust boundaries for convenience,
- merge data ownership casually,
- optimize hypothetical scale while ignoring present change friction,
- confuse fewer boxes on a diagram with simpler operations,
- use “industry best practice” as a substitute for context,
- preserve accidental structures just because they already exist.

## Daily-use commands
Interpret prompts like these as shortcuts:

- `architecture taste review` → full review using this skill.
- `simplify architecture` → prioritize A1–A3 before considering redesign.
- `find removable architecture` → focus on A1/A2 candidates and required proof.
- `quality-preserving refactor` → establish Preservation Contract first, then refactor.
- `service boundary review` → focus on ownership/domain/data/change-coupling boundaries.
- `redesign threshold` → determine whether A6 is justified or lower interventions suffice.
- `migration plan` → produce incremental migration with fitness functions and rollback.
- `ADR review` → identify decisions that are stale, unnecessary, or need replacement.

## When information is incomplete
Do not block on perfect documentation. Produce:
- confirmed findings,
- hypotheses,
- evidence gaps,
- instrumentation/research actions,
- decisions that can safely proceed now.

Use A7 DEFER/OBSERVE when evidence is too weak for a structural change.

## Spur contract

Machine-facing adapter for `sp:code-refactoring` dispatch (feature H13). Everything above is the
lens's native output and is unchanged; this section only maps it to the shared finding schema.

**Inputs received:** a scope path, an optional change description, and the `architect` focus.
Read first: the intervention ladder and workflow above, then
`../code-refactoring/references/finding-schema.md` for shared field semantics.

**Native finding → schema mapping:** `ID` → `id` as `RF-architect-<nnn>`; `Action` (A0–A7) →
`rung` verbatim; `Observation`/`Why it matters` → `title` plus `proposal` (imperative); `Evidence`
→ `evidence` as `{file, line}` entries inside scope; `Fitness functions` → `verify`; new findings
start at `status: open`. ADR candidates and migration plans stay prose findings with
`fix_eligibility: suggest`.

**Severity mapping (design §5):** any axis ≤1 with a correctness/safety consequence → `P1`; axis
≤2 or A5–A7 seam problems → `P2`; A3–A4 → `P3`; A0–A2, ADR candidates, deferred questions → `P4`.

**Preserved-behavior inventory (required before proposals):** emit the Preservation Contract
table — capabilities, quality attributes, data invariants, and their thresholds — for everything
in scope before the first finding.

**Preservation class:** A0/A3/A4 mechanical consolidations with identical behavior →
`preserving`; A1/A2 removal of a live service, endpoint, queue, or code path with callers →
`cutting`; A5–A7 seam or behavior changes → `breaking`; migration plans and ADR candidates →
`preserving` prose with `fix_eligibility: suggest`.

**Stop rules:** no removal without dependency/traffic/contract evidence; `cutting`/`breaking` is
never below `P2` and never `fix_eligibility: auto`; multi-task migrations are `suggest`, applied
only after an explicit operator answer; anything outside the scope path is not a finding.
