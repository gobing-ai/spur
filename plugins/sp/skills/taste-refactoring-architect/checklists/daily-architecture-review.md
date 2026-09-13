# Daily Architecture Review Checklist

Use this in 10–20 minutes for a feature, subsystem, or architecture change.

## Preservation
- [ ] What feature/business capability must remain unchanged?
- [ ] What contracts/consumers are affected?
- [ ] What SLO, security, data, compliance, RTO/RPO, cost, or capacity constraints matter?
- [ ] Which constraints are measured vs assumed?

## Simplification first
- [ ] Can anything be deleted outright?
- [ ] Can any layer/hop/adapter be inlined?
- [ ] Can duplicated capabilities be consolidated?
- [ ] Can one standard platform capability replace bespoke machinery?
- [ ] Can a service boundary become a module boundary instead?
- [ ] Can we reduce technologies, deployables, or cross-team handoffs?

## Boundaries
- [ ] Does each capability have a clear owner?
- [ ] Does each business fact have one authoritative owner?
- [ ] Do components that change together live together?
- [ ] Are supposed independent services actually sharing data or coordinated releases?
- [ ] Are there cycles or chatty synchronous chains?

## Quality
- [ ] Reliability/failure behavior explicit?
- [ ] Security/trust boundaries explicit?
- [ ] Latency/throughput/capacity measured?
- [ ] Data consistency and recovery explicit?
- [ ] Deployment/rollback observable and safe?
- [ ] Cost impact known?

## Intervention
- [ ] A0 KEEP
- [ ] A1 DIRECT REMOVE
- [ ] A2 SUGGEST REMOVE
- [ ] A3 CONSOLIDATE / SIMPLIFY
- [ ] A4 SUGGEST ENHANCE
- [ ] A5 RE-BOUNDARY
- [ ] A6 SUGGEST RE-DESIGN
- [ ] A7 DEFER / OBSERVE

## Proof
- [ ] What fitness function proves this is better?
- [ ] What metric proves no delivery quality regressed?
- [ ] What is the rollback/exit path?
- [ ] What can be deleted after migration?
