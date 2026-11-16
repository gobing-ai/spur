---
kind: plan
title: Concrete Spur self and tooling ownership
status: approved
created_at: 2026-11-16
updated_at: 2026-11-16
related: [docs/00_ADR.md, docs/design/harness-surface-governance.md]
tags: [brainstorm, cli, planning]
needs_design: true
run_id: 9e537a69-f2a1-4f80-be7d-065acca58ecc
---

# Concrete Spur self and tooling ownership

## 1. Objective and outcome

Make installation, readiness and reusable developer operations accessible through their owning Spur nouns. First amend the architectural decision that currently treats build and packaging as repository-only by category. Produce a staged migration with explicit destinations and repeatable evidence; this idea run plans the implementation rather than executing it.

## 2. Premises and dependencies

- ADR-051 preserves consent and the two-level command shape (`docs/00_ADR.md:499`). ADR-130 currently assigns build, packaging and repository gates to scripts (`docs/00_ADR.md:2221`). Amend ADR-130 in place, preserving its historical decision, rather than adding a competing placement ADR.
- The `self` noun registers init/migrate/status through shared legacy builders (`apps/cli/src/commands/self/index.ts:18`). Status currently exposes project/Git/agent-spec/decision readiness (`apps/cli/src/commands/status.ts:36`). Only agent and decision additionally register a literal status verb today; other nouns must use existing read-only services without inventing status commands.
- `self init` scaffolds projects and has explicit global-config adoption (`apps/cli/src/commands/init.ts:445`); `self migrate` owns database schemas (`apps/cli/src/commands/migrate.ts:60`). Neither should become a binary/package installer.
- The shell installer verifies a release binary before atomic replacement, seeds through hidden `init`, and best-effort installs zg/a2a (`scripts/install.sh:1`). A bootstrap remains necessary before a CLI exists.
- The developer dispatcher is registered explicitly, with L1–L4 responsibilities (`scripts/spur-dev.ts:1`). Existing release verbs already provide a precedent for promoting behavior, not copying the dispatcher.

## 3. Approaches

| Approach | Benefits | Costs |
| --- | --- | --- |
| Keep scripts; only document them | Smallest immediate change; no surface growth | Does not satisfy installation/status consolidation or remove reusable script behavior |
| Move every script to self | One visible entry | Mixes project lifecycle, build, release, fixtures and bootstrap; inflates the shipped CLI |
| Responsibility-based absorption, retaining bootstrap and irreducible fixtures (recommended) | Shared services; self owns its installation/readiness, builder owns build/package operations; controlled waves | Requires caller inventory, bootstrapping proofs and consent for concrete promoted verbs |

The evidence for all alternatives is the existing placement table and dispatcher above; no external API assumptions are needed.

## Design Summary

Amend ADR-130 first: a repository caller and repository paths do not alone justify a second implementation. App services own reusable operations, CLI modules remain thin, and repository-specific inputs/fixtures may remain local. Preserve ADR-051 consent and flat verbs. Design `self install` as the explicit machine setup action; keep init for project scaffolding and migrate for SQL. Retain a minimal verified shell bootstrap that delegates post-bootstrap setup to the installed CLI. Make installation convergent, observable and resumable with no default overwrite of user configuration or reinstall of healthy optional dependencies. Superskill continues to own plugin adapters.

Expand self status through shared read-only collectors, including agent/decision status, installation provenance, config layers, schema readiness, search/dependency readiness, registered project/server and run/corpus summaries where local services support them. Include scope, unavailable/error states and bounded collection; never run repairs, refresh usage, install tools, start servers or expose credentials. Preserve existing top-level JSON fields and path behavior while adding named sections.

Classify every non-test script and test/fixture companion before migration. Build/package behavior goes to builder services only when it has a usable shipped contract and does not require its own missing build artifact. Noun-specific operations go to that noun. Repository-only gates, benchmark scenarios, fixtures and generators may remain with a recorded reason. Never ship repository test harnesses just to empty scripts/commands. Route package scripts to the new owners only after tarball, source and standalone proofs pass; account for CI callers without editing workflows in this planning run.

## 4. Execution sequence

1. Record the ADR amendment and complete the exhaustive ownership/caller matrix.
2. Implement consolidated read-only self status.
3. Implement idempotent self install and slim bootstrap; prove cold, repeated and interrupted setup in isolated homes.
4. Absorb approved builder/noun operations by coherent responsibility, update callers and test locations, and remove obsolete dispatch routes only after compatibility proofs.

## 5. Risks and verification

Decomposition: six cohesive deliverables (inventory/contracts 3h; status 6h; install 8h; compile 8h;
artifact staging 5h; workflow evaluation/final audit 4h). Split by observable ownership and artifact,
not implementation phase. Status failure scenarios and install rerun scenarios stay with their
respective primary behavior. The compile/artifact split has distinct restoration versus destructive
path/archive review contexts. Shared builder registration/package files are edited sequentially.
The pre-batch quiz is auto-skipped under the operator's --auto. Public-contract consent remains an
explicit implementation prerequisite. Full migration scope is roughly 34h, not one implementation task.

Critical risks are bootstrap cycles, hidden mutation in status, destructive config adoption, duplicate collectors and promoting repository-only fixtures. Use real CLI E2E checks with isolated homes/PATH and local release fixtures; retain machine-readable before/after receipts. Record partial/optional dependency failure honestly. Test the packed artifact and compiled binary as well as source invocation. Every promoted public contract needs its own recorded scope; planning auto-approval does not authorize execution or workflow edits.

## 6. Recommendation and self-review

Proceed with responsibility-based absorption. Urgency 3/5: existing paths work but split ownership is costly. Necessity 4/5: cohesive install/status is a product boundary. Self-review: no placeholders, contradictory destinations or unbounded implementation step; needs_design=true for cross-module and public contract changes. The operator's --auto selects this recommendation. No task execution is authorized by the idea pipeline.

## 7. Planning handoff

Feature A93 contains eight scenarios and tasks 1351–1356, allocated through the workflow's atomic
batch-create step. Run 9e537a69-f2a1-4f80-be7d-065acca58ecc reached terminal handoff. Task order is
1351 first; 1352/1353/1354 depend on it; 1355 also follows 1354; 1356 follows all earlier slices.
This describes dependency independence, not permission for concurrent writers in one checkout.

Planning verification: runtime batch schema accepted six items; feature check with requirement
inventory passed; all six task structural checks passed; new document links and placeholders were
checked; git diff --check passed. No implementation tests/build or feature completion verdict ran.
Four tasks (1352–1355) have an explicitly failing decisions readiness row because public-contract
consent is pending. No blocker was hidden behind a structural PASS.

Recommended next command: `/sp:dev-refineall --feature A93 --auto --depth ready`. Resolve the exact
public-contract consent prerequisite using the concrete design before executing those changes.
The run-scoped caller baseline and ready/handoff evidence are under `.spur/run/` with the run-id
prefix; the design's exhaustive disposition and this plan remain the tracked handoff.

### Ready refinement — 2026-11-16

The [ready-depth refinement report](../reports/2026-11-16-A93-ready-refinement.md) supersedes the
initial readiness assessment above. All six tasks have frozen plans and passing seven-row readiness
evidence; public-contract authorization remains explicitly deferred to Robin before implementation.
The audit corrected eager DB boot, decision ledger reads, missing seed assets, compile cleanup,
archive version/safety and web transport-constant ownership. Task 1355 is now estimated at 6h;
current total is 35h. No implementation task was run and no approval was inferred.
