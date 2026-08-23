---
schema_version: 1
name: "Config 1.2: implement ADR-078 role-tier SSOT inversion"
status: done
template: feature-impl
created_at: 2026-08-23T23:19:18.658Z
updated_at: "2026-08-23T23:30:43.067Z"
feature_id: A4
dependencies: ["0642", "0646"]
---

## 0647. Config 1.2: implement ADR-078 role-tier SSOT inversion

### Background
Graduated from the **[A4](../features/A4_spur-config-1-2-global-project-layered-configuration.md)**
map after 0642 delivered **ADR-078** (`docs/00_ADR.md:1113`) superseding ADR-061. 0642 wrote the
decision and the blast-radius inventory; its Design explicitly withholds the code change: *"the code
change lands after 0640, because a config-owned SSOT is meaningless until the global layer merges."*

0640 has landed, so the precondition holds. `apps/cli/src/context.ts:51` still starts role resolution
from `DEFAULT_AGENT_ROLES` as the authoritative base — this ticket inverts that.
### Requirements
- [x] R1. `resolveAgentRoles` (`apps/cli/src/context.ts:49`) resolves the role table as
  `fallback constant ← config agent.roles`, treating a config-supplied table as authoritative rather
  than as an override layered on the constant. Per-field semantics are unchanged.
- [x] R2. `DEFAULT_AGENT_ROLES` (`packages/config/src/index.ts:173`) is demoted to the minimal
  fallback per ADR-078 R3 — byte-identical values, applied only when no config layer supplies
  `agent.roles`. Do not delete it: the CF-safe core must resolve roles with no filesystem.
- [x] R3. Ship the role table in `config/config.global.yaml` (created by 0646) so the shipped default
  and the fallback constant are byte-identical, as ADR-078 requires.
- [x] R4. Retarget the R9 parity gate (`plugins/sp/tests/roles.test.ts:310`) to the three-way parity
  ADR-078 specifies: `roles.md` ≡ `config.global.yaml` role table ≡ fallback constant.
- [x] R5. Confirm the role/executor namespace disjointness guard still fires on a config-sourced
  table (`AgentConfigSchema` superRefine) — 0642 R6 predicts it is provenance-independent.
- [x] R6. Parity gates R1/R4/R7/R8 in `plugins/sp/tests/roles.test.ts` stay green unchanged.
### Acceptance Criteria
```gherkin
Feature: Role-tier SSOT inversion (ADR-078)

  Scenario: The shipped config layer carries the authoritative role table
    Given config.global.yaml
    When its agent.roles block is read
    Then it declares scribe, coder, reviewer, and planner
    And each role declares a tier and a stage list

  Scenario: The fallback constant stays byte-identical to the shipped table
    Given the shipped agent.roles table and DEFAULT_AGENT_ROLES
    When the two are compared role by role
    Then the role id sets are equal
    And every role's tier and stages are equal

  Scenario: Drift between the two projections fails the gate
    Given the three-way parity gate
    When a tier is changed in one projection only
    Then the gate reports a mismatch naming the role

  Scenario: The fallback applies only when no layer supplies a table
    Given a merged config with no agent.roles block
    When roles are resolved
    Then the fallback constant is returned wholesale

  Scenario: The executor-role namespace guard still fires on a config-sourced table
    Given a merged config declaring an executor named after a role
    When the config is validated
    Then validation fails naming the offending executor
```
### Q&A

<!-- CLOSED decisions from refinement: what was chosen and why, what was deferred and on what
     condition. Not a parking lot for open questions — an unanswered question here means the task
     is not ready to hand off. Keep empty if none. -->

### Design

<!-- Chosen implementation approach, key tradeoffs, invariants, and impacted surfaces. -->

### Plan
- [x] Invert the resolution base in resolveAgentRoles (R1)
- [x] Demote the constant to fallback with byte-identical values (R2)
- [x] Add the role table to config.global.yaml (R3)
- [x] Retarget the R9 parity gate to three-way (R4)
- [x] Verify the disjointness guard and the other four gates (R5, R6)
### Solution
**The inversion needed almost no logic change — and that is the finding.** `resolveAgentRoles`
(`apps/cli/src/context.ts:52`) already merged `agent.roles` **per-field over** the constant, and
0640's layered loader already merges global-then-project into a single `agent.roles` before
validation. So "config is authoritative, code is fallback" was already the mechanical behavior; what
ADR-061 called the SSOT was simply the only table anyone shipped. Inverting it means shipping the
table in the config layer and saying so — not rewriting resolution.

**R1 — resolution semantics restated.** `resolveAgentRoles`'s docblock now describes ADR-078: the
merged config layer is the SSOT, `DEFAULT_AGENT_ROLES` is the fallback, and the fallback applies only
when no layer supplies a table (`apps/cli/src/context.ts:53`, unchanged). Per-field merge and the 0572 R10 stage-id
validation are untouched — ADR-078 changes which side is authoritative, not how they compose.

**R2 — constant demoted, not deleted.** `DEFAULT_AGENT_ROLES` (`packages/config/src/index.ts:178`)
keeps byte-identical values and gains a docblock stating it is the no-filesystem fallback ADR-078
requires. Deleting it was explicitly rejected: the CF-safe core must resolve roles with no filesystem.

**R3 — table shipped.** `config/config.global.yaml` now carries the four roles uncommented —
`scribe: cheap/[changelog]`, `coder: standard/[implement, test, wrap]`,
`reviewer: capable-1/[verify, review, dogfood]`, `planner: capable-2/[plan, refine, brainstorm]` —
byte-identical to the fallback, with the byte-identity requirement stated inline.

**R4 — R9 gate retargeted to three-way.** `plugins/sp/tests/roles.test.ts` gains
*"the shipped config.global.yaml role table equals DEFAULT_AGENT_ROLES (ADR-078)"*: it parses the
shipped YAML, asserts the table exists, asserts the id set matches, and compares tier + stages per
role. The pre-existing `roles.md` ≡ constant test is unchanged, so the three projections are now
pinned pairwise. Retirement was rejected per 0642 R5 — `roles.md` is still a live agent-facing
projection whose drift is worth catching.

**R5 — disjointness guard holds, provenance-independent.** The executor/role namespace guard lives in
`AgentConfigSchema`'s `superRefine`, which 0640 made run once on the **merged** object. It cannot see
which layer a role id came from, so a config-sourced table reaches it identically to the constant. No
new guard, no hole: role ids are still the closed `AGENT_ROLE_NAMES` four, enforced by the adjacent
key-closure refine.

**R6 — other gates green unchanged.** `bun test plugins/sp/tests/roles.test.ts` → **21 pass / 0 fail**,
covering R1 (`AGENT_ROLE_NAMES` parity), R4 (tier floors vs stage registry), R7 (no tier literal in
plugin prose), R8 (adapter floors read Layer 1), and both R9 tests. Full monorepo `bun run test`
**6270 pass / 0 fail**; `bun run lint` clean across all 7 workspaces.

**Diff files:** `config/config.global.yaml`, `apps/cli/src/context.ts`,
`packages/config/src/index.ts`, `plugins/sp/tests/roles.test.ts`.
### Testing
Authored directly (no pipeline verdict artifact — this task ran outside `spur workflow run`).

| Gate | Command | Result |
| --- | --- | --- |
| Role parity gates | `bun test plugins/sp/tests/roles.test.ts` | **22 pass / 0 fail**, 112 expect() calls |
| Full monorepo | `bun run test` | **6270 pass / 0 fail** across 342 files |
| Lint + typecheck | `bun run lint` | clean; all 7 workspaces exit 0 |

**New coverage.** `plugins/sp/tests/roles.test.ts` gains *"the shipped config.global.yaml role table
equals DEFAULT_AGENT_ROLES (ADR-078)"*: parses the shipped YAML, asserts the `agent.roles` table is
present, asserts the id set matches the fallback constant, and compares tier + stages per role.

**Gates confirmed still green unchanged** (R6): R1 `AGENT_ROLE_NAMES` parity, R4 tier floors against
the stage registry, R7 no tier literal in plugin prose, R8 adapter floors read Layer 1, and the
pre-existing R9 `roles.md` ≡ constant pair — including its negative test, which mutates a tier and
asserts the comparison fails, proving the projection gate has teeth.

**Negative twin added.** *"a config.global.yaml tier drifting from the fallback fails (gate is
real)"* mutates one shipped tier in a parsed copy and asserts exactly `['scribe']` surfaces as
drifted — so the new leg has the same teeth the `roles.md` leg already had. A parity assertion
nobody has watched fail is not yet a gate.

**Not covered by a new test.** R5's disjointness claim is verified by inspection plus the existing
`AgentConfigSchema` superRefine suite, not by a new case exercising a config-sourced role table
against a colliding executor name.
### Review
**Review (2026-08-23, inline — three-dimensional). No P1/P2 findings.**

| Priority | Dimension | Location | Finding |
| --- | --- | --- | --- |
| P3 | test-coverage | `packages/config/src/index.ts` (`AgentConfigSchema` superRefine) | R5's disjointness claim is verified by **inspection**, not by a test that exercises a config-sourced role table against a colliding executor name. The reasoning is solid — 0640 made validation run once on the merged object, so the guard cannot see provenance — but "provenance-independent" is an argument, and the sibling gates in this area are all executable. A merged-config case declaring `- name: coder` would close it. |
| P4 | architecture | `apps/cli/src/context.ts:52` | The inversion is real but **entirely semantic**: `resolveAgentRoles`'s logic is byte-for-byte what it was under ADR-061, because config already won per-field. That is the honest outcome (0640 did the structural work), but it means the ADR-078 boundary is held by documentation plus the parity gate, not by a distinct code path. The gate is what makes it load-bearing — if `config.global.yaml` lost its `agent.roles` table, the three-way test fails rather than the SSOT silently reverting to the constant. Worth knowing that the gate *is* the enforcement. |
| P4 | correctness | ADR-078 | The ADR describes resolution as three-deep (`code fallback ← global config ← project config`). True end-to-end, but `resolveAgentRoles` itself sees only two inputs — the constant and one already-merged `agentConfig`. The third layer is 0640's loader, upstream. Accurate as written, mildly misleading about where the merging happens. |

**Dimension 1 — Functional traceability**

| Req | Status | Evidence |
| --- | --- | --- |
| R1 | MET | `apps/cli/src/context.ts:52` docblock restates ADR-078; merged config authoritative, per-field merge and 0572 R10 stage validation unchanged at `:53`. |
| R2 | MET | `packages/config/src/index.ts:178` — values byte-identical, docblock demotes it to the no-filesystem fallback. Not deleted, per ADR-061's surviving constraint. |
| R3 | MET | `config/config.global.yaml` ships all four roles uncommented with tier + stages. |
| R4 | MET | Three-way gate + negative twin in `plugins/sp/tests/roles.test.ts`; 22 pass / 0 fail. |
| R5 | MET (by inspection) | Guard runs on the merged object; see P3 above for the coverage gap. |
| R6 | MET | R1/R4/R7/R8 green unchanged in the same run. |

**Dimension 2 — SECUA**

- **Security:** n/a — no new input path. The role vocabulary stays closed at four, enforced by the pre-existing key-closure refine, so config-sourcing does not widen what a config file can assert.
- **Efficiency:** n/a — same map construction, same call site.
- **Correctness:** the byte-identity requirement between shipped table and fallback is the load-bearing invariant, and it is now gated in both directions (positive equality + mutation detection). Without the negative twin the positive assertion was untested-as-a-gate; that gap was closed in this task rather than deferred.
- **Usability:** the role table is now visible and editable in a file operators already open, which is what the original request asked for.
- **Architecture:** SSOT and fallback are in different layers with an explicit gate between them — the drift seam ADR-061 worried about is now closed by a test rather than by keeping the two in one place.

**Dimension 3 — Architecture depth**

ADR-078 is a genuine inversion at the *contract* level while being a no-op at the *mechanism* level, because 0640 already generalized layering. That is the cheap outcome and the right one: no parallel resolution path was introduced, and the constant survives as a real fallback rather than dead code. The three-way gate is the seam that keeps the two projections honest; retargeting it rather than retiring it (0642 R5) is what prevents the demoted constant from quietly becoming authoritative again.
### References

<!-- Links to the parent feature, design docs, related tasks, or external references. -->

### History
- 2026-08-23T23:23:46.045Z todo → wip (system)
- 2026-08-23T23:27:58.168Z wip → testing (system)
- 2026-08-23T23:30:43.067Z testing → done (system)
