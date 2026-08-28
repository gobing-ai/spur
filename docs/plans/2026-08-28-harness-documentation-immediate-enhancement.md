# Harness Documentation Immediate Enhancement Plan

**Date:** 2026-08-28

**Input:** `docs/report/2026-08-28-harness-engineering-playbook-vs-spur.md`

**Scope:** Documentation-only reliability improvements

**Status:** Approved for direct execution by the operator

## 1. Decision and boundary

Split the harness refinement into two delivery lanes:

1. **Direct documentation lane:** correct current facts, remove duplication, improve navigation, and make shipped versus
   proposed status explicit. These edits may not create new product commitments.
2. **Feature/task lane:** implement or specify runtime behavior, workflow semantics, schemas, automated checks, public
   surfaces, or other code/config changes through the normal Spur feature/task lifecycle.

This plan authorizes only lane 1. Task creation and all code/config implementation are postponed because another coding
agent is active in the same working tree.

## 2. Immediate objectives

| ID | Objective | Files | Done when |
| --- | --- | --- | --- |
| D1 | Compact the always-loaded project guide | `AGENTS.md` | Material headroom below the 32 KiB platform limit; duplicated depth replaced by one-hop owner links; safety and routing remain intact |
| D2 | Synchronize guide-governance rules | `docs/99_PROJECT_CONSTITUTION.md` | Project constitution carries the portable file-perishability and approximate 150–200 instruction-budget rules; version/date updated |
| D3 | Preserve portable guide alignment | `config/templates/AGENTS.md`, `config/templates/docs/99_PROJECT_CONSTITUTION.md` only if drift requires edits | Project-specific compaction does not weaken the portable H2/routing contract; no speculative template expansion |
| D4 | Clarify current versus proposed architecture | `docs/03_ARCHITECTURE.md`, `docs/04_DESIGN.md`, and related indexes only where a verified ambiguity exists | Every touched statement is explicitly shipped, accepted-but-unbuilt, or proposed; no future behavior is presented as current |
| D5 | Make the comparison evidence discoverable | Existing documentation navigation/report surface | The comparison report has one stable inbound pointer and remains a working-layer input, not an authority |
| D6 | Verify documentation integrity | Documentation checks and repository gates | Drift/sync/contract checks recorded; links and formatting clean; only intended documentation files changed |

## 3. Execution sequence

### Stage A — Inventory before editing

1. Record `AGENTS.md` line, word, byte, heading, and instruction counts.
2. Map every removable root-guide block to an existing owner in `docs/00`–`05`, `docs/design/`, or a shipped skill.
3. Compare the project and portable constitution `§6.7` clauses.
4. Search `03`/`04` for status vocabulary around proof state, permissions, budgets, trip wires, and other findings from
   the comparison report.
5. Check the working tree before each edit; do not touch task corpus or files changed by the concurrent coding agent.

### Stage B — Compact `AGENTS.md`

Keep:

- project identity and product boundary;
- harness-first routing and non-negotiable safety;
- canonical documentation map and authority rule;
- stack/module boundary summary;
- essential build/test commands and completion gate;
- concise conventions that prevent destructive or architecturally invalid work;
- one-hop pointers to deeper owners.

Remove or relocate:

- long verb catalogs already owned by `sp:spur-cli` or `docs/04_DESIGN.md`;
- implementation histories and task-specific incident narratives;
- detailed subsystem payload/schema descriptions owned by `03`/`04` satellites;
- duplicated verification rationale already owned by the constitution;
- repeated routing or safety statements where one stronger statement suffices.

Target: **16–20 KiB**, with correctness taking priority over the numeric target. No safety, authority, or gate instruction
may be dropped merely to meet the target.

### Stage C — Synchronize governance

1. Add the portable constitution's perishable-path guidance to project `§6.7`.
2. Add the approximate 150–200 instruction-budget guidance, preserving its stated MEDIUM confidence.
3. Bump the constitution minor version and `updated_at` per `§4.3`.
4. Re-check that root `AGENTS.md` remains an instantiated entry document, not a second constitution.
5. Record sibling-project propagation as outstanding; do not modify repositories outside this worktree.

### Stage D — Status-label audit

Audit only statements related to this report's findings:

- proof-state invariant and live `--fix all` behavior;
- docs-pipeline synthetic verdict;
- permission/capability enforcement boundary;
- live usage and runtime budget availability;
- trip-wire/control behavior;
- verifier independence.

Repair factual ambiguity only. A missing design decision becomes a deferred finding or report pointer, not newly accepted
architecture. Append-only ADRs are not rewritten.

### Stage E — Discoverability

Add one inbound pointer to the comparison report from an existing working-document navigation surface. If no suitable
surface exists, add a minimal `docs/report/README.md` index because the folder already contains multiple reports. Do not
duplicate the report's conclusions in numbered authority docs.

### Stage F — Verification

Run:

1. deterministic drift-audit detection for affected surfaces;
2. `sp:doc-evolve` sync-check reasoning against the final diff;
3. frontmatter contract verification for touched numbered docs;
4. `git diff --check` and the repository link check;
5. guide size/count comparison;
6. relevant lint/typecheck/tests as allowed by the concurrent worktree state.

If a repository-wide gate fails on an unchanged file, record the exact pre-existing blocker rather than editing outside
this plan.

## 4. Explicit non-goals

This direct lane will not:

- edit `config/workflows/*.yaml` or production/test code;
- create or update task/feature corpus files;
- implement proof-state, capability-attestation, budget, trip-wire, or verifier-routing behavior;
- add a package, database, workflow engine, policy DSL, public CLI noun, or configuration key;
- change accepted product scope or architecture without the future feature/task workflow;
- modify sibling repositories while another agent is active here.

## 5. Deferred feature/task backlog

Create later through the Spur lifecycle, in this order:

1. **Verdict integrity:** observe-only final verification, same-digest evidence, removal of synthetic PASS.
2. **Guide-budget sensor:** enforce the guide budget only after this compaction establishes a measured baseline.
3. **Capability attestation:** declare stage requirements and verify native executor enforcement.
4. **Operational controls:** runtime usage budgets, verified-result metrics, safe-boundary trip wires, escalation packet.
5. **Verifier and memory hardening:** independent verifier identity/context and bounded checkpoint/context lifecycle.

## 6. Completion record

- **Files changed:** `AGENTS.md`, `docs/99_PROJECT_CONSTITUTION.md`, this plan, and
  `docs/report/README.md`. The comparison report was used as input; only its trailing-whitespace
  formatting was normalized.
- **`AGENTS.md` before/after:** 501 → 256 lines; 4,060 → 1,557 words; 32,577 → 11,898 bytes
  (63.5% smaller, 20,870 bytes of 32 KiB headroom). Approximate instruction/table/list rows: 58.
- **Drift repaired:** root guide was 191 bytes below the stated platform cap; duplicated subsystem
  depth and an unrelated trading-system guidance block were removed. The project constitution was
  missing the portable file-perishability and instruction-budget rules plus required frontmatter
  pointers; it now matches the template's `§6.7` contract at version 1.4.0.
- **Status audit:** proof state, docs-pipeline verdict behavior, sandbox scope, usage availability,
  trip-wire behavior, and verifier independence were checked. Existing authority/design docs already
  distinguish current, accepted-but-unbuilt, and proposed behavior, so no `00`–`05` content was
  changed.
- **Proposed items deliberately unchanged:** proof-chain implementation, synthetic-verdict removal,
  capability attestation, runtime budget/trip-wire controls, and verifier routing remain deferred to
  the future feature/task lane.
- **Verification:** portable AGENTS alignment 4/4 PASS; repository link check PASS; `git diff
  --check` PASS; Biome/lint and all workspace typechecks PASS; touched `99` frontmatter matches its
  `§4.1`/`§4.3` process contract. T7 is satisfied by the same-change `AGENTS.md` sync; the portable
  template already contained the promoted rules.
- **Concurrent-worktree files observed and left untouched:** task corpus files 0698–0702. No code,
  workflow YAML, tests, feature corpus, or sibling repository was modified.
