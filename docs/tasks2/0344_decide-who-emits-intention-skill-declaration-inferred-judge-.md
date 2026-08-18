---
template: issue
schema_version: 1
name: "Decide who emits intention: skill declaration, inferred judge, or hybrid"
description: ""
status: done
type: issue
profile: standard
feature_id: B2
parent_wbs: null
priority: P1
tags: ["wayfinder:grilling", "routing", "determinism"]
dependencies: []
created_at: "2026-07-27T01:27:19.129Z"
updated_at: "2026-08-18T04:42:48.070Z"
---

## 0344. Decide who emits intention: skill declaration, inferred judge, or hybrid

### Background
Wayfinder ticket for map B2. Type: grilling (`sp:dev-refine`). **Absorbed ticket 0345 on 2026-07-26.**

The operator's diagnosis is verified: `extractPhase` (`packages/app/src/services/agent-service.ts`)
only classifies prompts shaped like slash commands, so CLI, subagent, and workflow dispatches get no
stage and fall through to `agent.default`.

**The two-layer contract is already ruled (map B2 → Notes), and this ticket works inside it:**

| Layer | Owns | Home |
| --- | --- | --- |
| 1 | intention → tier | shared reference file under `plugins/sp`, included by the skills that need it |
| 2 | tier → executor | operator's `.spur/config.yaml` |

`sp` names intentions and tiers, never an executor or model. Two earlier proposals are already
closed out by that ruling: **per-skill intention declaration** does not survive the spine — a
comprehensive skill such as `plugins/sp/skills/spur-dev` carries refine, plan, implement, verify and
wrap intentions at once and cannot declare a single one — and **a separate LLM judge call per
dispatch** is not what "LLM-as-Judge" meant. The executing agent reads the reference table and picks
which intention applies to the operation it is already performing; the tier→executor step is then a
deterministic config lookup. The only judgment is intention classification, bounded by a fixed
vocabulary.

What remains open is the contract itself: what the intentions *are*, how a dispatcher on each of the
four paths carries one, and what happens when config does not map a declared intention. That is this
ticket.
### Requirements
R1. Define the intention vocabulary — the actual value list. Cover the work the 21 currently
    stage-less commands do, not just the 10 that have stage records today.

R2. Decide the reference file's location and format under `plugins/sp`, and which skills include it.
    Follow the existing `references/*.md` convention rather than inventing a new mechanism.

R3. For each of the four dispatch paths — slash command, `spur agent run`, subagent, workflow step —
    state concretely how the intention is carried and how a multi-intention skill like `sp:spur-dev`
    selects the right one per operation.

R4. Define the behavior when a skill declares an intention the operator's config does not map: hard
    error, silent default, or warning plus default.

R5. Define the behavior when no intention is available and none can be classified.

R6. State how an operator override interacts with a declared intention — whether an explicit
    executor bypasses routing entirely, or pins one axis and leaves escalation live.

R7. State the versioning story for `sp` and `spur` shipping on independent release cadences, given
    the vocabulary lives in the plugin and the mapping in the operator's config.

R8. Do not implement — end at a recorded decision. Implementation is decomposed once the map clears.
### Acceptance Criteria
N/A — decision ticket. Success is a recorded, operator-confirmed contract (Solution D1–D8 + Q&A confirmation), not executable scenarios. Traceability is under Requirements R1–R8; verification evidence is under Testing.
### Q&A
- **Refine 2026-07-26 (--auto, in-session).** Operator invoked `/skill:sp-dev-refine 0344 --auto --next`. Pre-synthesis gate (`spur task check 0344 --json`) returned PASS with empty findings — a false positive for `template: issue` decision tickets at `todo` status (issue-template matrix enforces no section content). Synthesized a proposed decision into Solution under `--auto`, then surfaced for operator confirmation rather than chaining `--next` into execution. Rationale: this is a taste/architecture decision (intention vocabulary, file location, versioning contract); Auto-Decision Principle 5 requires human confirmation before such decisions auto-advance to `done`. The `--next` flag is honored by surfacing the proposal for the operator to react to — once confirmed, the next step is implementation decomposition (likely a new wayfinder task batch), not pipeline execution against this ticket.
- **Confirmation 2026-07-26 (operator).** Both open questions resolved: keep `orchestrate` as capable; keep `utility` as single cheap intention. Decision recorded as final; advancing to `done`. R8 satisfied — deliverable was a recorded, confirmed decision.
### Design
Decision ticket: the approved design *is* Solution D1–D8 (vocabulary, reference file, four dispatch paths, unmapped/no-intention behavior, override, versioning, no-implementation boundary). No separate design artifact beyond that contract. Implementation design is deferred to the post-map task batch (D8).
### Plan
Decision ticket — no debugging checklist. Post-map implementation batch (from Solution D8):

1. Create `plugins/sp/references/intentions.md` (D1 vocabulary + D2 format).
2. Add `intention:` frontmatter to all 31 command files under `plugins/sp/commands/`.
3. Add `--intention` flag to `spur agent run`.
4. Thread intention through `AgentRunActionRunner` (`packages/app/src/workflow/actions/agent-run.ts`).
5. Retire `extractPhase` (`packages/app/src/services/agent-service.ts:942-955`).
6. Document surface under `docs/04_DESIGN.md` (T3).
### Root Cause
Verified diagnosis (Background): `extractPhase` (`packages/app/src/services/agent-service.ts:942-955`) only classifies prompts shaped like slash commands (`/sp:…`, `/sp-…`, `/skill:sp-…`, `$sp-…`). CLI, subagent, and workflow dispatches therefore get no stage and fall through to `agent.default` (`resolveAgentAuto` at `agent-service.ts:666-672`). The decision replaces prompt-text inference with declared intention on all four dispatch paths (Solution D3), so the regex gap is retired rather than widened.
### Solution
**Decision recorded and confirmed 2026-07-26.** Implementation decomposed separately once the wayfinder map clears; this section is the contract, not the code.

**D1. Intention vocabulary (R1) — 8 values.** Intentions are coarser than stage IDs. Multiple stages fold into one intention; stage-less commands adopt an existing intention or one of two new ones (`orchestrate`, `utility`). The vocabulary covers all 31 commands:

| Intention | Default tier | Stage IDs folded | Commands |
| --- | --- | --- | --- |
| `plan` | capable | plan, refine, brainstorm | dev-plan, dev-refine, dev-brainstorm, dev-idea |
| `implement` | standard | implement | dev-run, dev-arch, dev-reverse, dev-simplify, dev-fixall, dev-debug |
| `test` | standard | test | dev-unit |
| `verify` | capable | verify, review | dev-verify, dev-review, dev-verifyall |
| `wrap` | standard | wrap, changelog | dev-wrap, dev-wrapall, dev-changelog, dev-daily |
| `dogfood` | capable | dogfood | dev-dogfood |
| `orchestrate` | capable | — *(new)* | dev-runall, dev-parallel, dev-next |
| `utility` | cheap | — *(new)* | dev-gitmsg, dev-handover, dev-refresh, rule-add, rule-refine, rule-scan, workflow-add, workflow-refine, spur-init |

Why 8, not the raw 10 stages or 31 commands: stages already carry redundant tier signals (`review`/`verify` are both verdict-class capable; `brainstorm`/`plan`/`refine` are all planning-class capable). Collapsing to intentions gives the operator one row per tier semantic in config, not three. Two new intentions (`orchestrate`, `utility`) plus adoption of existing intentions cover the 21 stage-less commands whose work is real but falls outside the implement→test→verify pipeline: batch drivers and navigation need capable-tier orchestration logic; gitmsg/handover/rule-authoring/init are mechanical.

Mapping is exhaustive and closed. Every command in `plugins/sp/commands/` appears in exactly one row. Adding a command requires adding it to a row (or declaring a new intention in the reference file — R7).

**D2. Reference file location and format (R2).**

- **Location:** `plugins/sp/references/intentions.md`. Follows the existing `references/*.md` convention already used by `spur-dev` (11 reference files under `plugins/sp/skills/spur-dev/references/`). The file lives at the **plugin root** (`plugins/sp/references/`, not inside any one skill) because it is consumed by multiple skills (`spur-dev`, `spur-cli`, `code-verification`, etc.) and by the dispatcher itself.
- **Format:** a fenced YAML block (machine-parseable) plus prose annotations for the executing agent.

```yaml
# plugins/sp/references/intentions.md
version: 1
intentions:
  - id: plan
    default_tier: capable
    commands: [dev-plan, dev-refine, dev-brainstorm, dev-idea]
    stages: [plan, refine, brainstorm]
  - id: implement
    default_tier: standard
    commands: [dev-run, dev-arch, dev-reverse, dev-simplify, dev-fixall, dev-debug]
    stages: [implement]
  # ... (8 rows total per D1)
```

- **Which skills include it:** any skill whose SKILL.md invokes `spur agent run` or classifies its own operation against the D1 table. Multi-intention / dispatcher skills **must** include it: `sp:spur-dev`, `sp:spur-cli`, `sp:code-verification` (verify + review modes). Single-intention specialist skills **need not** include the full table — their intention is implicit in the skill identity (`sp:code-implementation` → `implement`, `sp:code-testing` → `test`, `sp:code-review` → `verify`, `sp:dogfood-testing` → `dogfood`). Specialists that shell out to `spur agent run` may still pass `--intention` from that implicit identity without loading the full vocabulary.

**D3. Four dispatch paths (R3).**

| Path | How intention is carried | Multi-intention skill selection |
| --- | --- | --- |
| **Slash command** (`/sp:dev-run`) | Each command `.md` declares `intention:` in YAML frontmatter. The command dispatcher passes `--intention <id>` to `spur agent run`. `extractPhase` is retired; the regex gap (agent-service.ts:953) closes because the command carries the intention explicitly, not the prompt text. | N/A — each command is single-intention. `sp:spur-dev` is multi-intention but each *invocation* (`/sp:dev-refine` vs `/sp:dev-plan`) is single-intention; the command selects. |
| **`spur agent run`** (direct) | `--intention <id>` flag, or `--stage <id>` (stage implies intention via D1 mapping). When neither is passed and the prompt is a slash command, fall back to extracting from the command frontmatter lookup. When neither is passed and the prompt is free text, the agent classifies (see subagent row). | The caller (operator or agent) passes `--intention` explicitly. |
| **Subagent** (host-internal) | The host agent (claude/codex/etc.) reads `intentions.md`, classifies its own operation against the D1 table, and passes `--intention` when shelling out to `spur agent run`. This is the only path where classification is bounded-LLM: the agent picks from a fixed 8-value vocabulary, not open-ended. | A multi-intention skill like `sp:spur-dev` includes `intentions.md` and its procedure text names the intention per operation: "when refining, you are `plan`; when implementing, you are `implement`." The agent declares which phase it is in. |
| **Workflow `agent.run` step** | The workflow YAML step declares `intention: <id>` alongside `agent:`. The `AgentRunActionRunner` (agent-run.ts:71) threads it through as `--intention` on the underlying `spur agent run` invocation. | Each step is single-intention by construction (a workflow step does one thing). |

The regex gap closes without a new classifier. `extractPhase` (agent-service.ts:942-955) tried to infer the phase from prompt text and missed every non-slash-command dispatch. Under this decision, the intention is **declared** by the command frontmatter (path 1), the `--intention` flag (path 2), the agent's self-classification against a fixed table (path 3), or the workflow YAML (path 4). No prompt-text inference.

**D4. Unmapped intention in config (R4).** Warning + default. When config does not map a declared intention, emit:

```
warning: intention 'orchestrate' not mapped in config; using default tier 'capable'
```

and resolve via the intention's `default_tier` from `intentions.md`. Not a hard error — config may be from an older plugin version (R7) and breaking execution for a missing mapping is disproportionate. The warning is emitted once per resolve (reuse `warnDeprecationOnce` pattern, agent-service.ts:608-612 / call site 646-648).

**D5. No intention available (R5).** Fall through to `agent.default`. When no intention is declared and none can be classified (free-text `spur agent run "hello"` with no flags), behavior is unchanged from today: `resolveAgentAuto` falls through to `config.default` selector, then Tier-1 priority (agent-service.ts:666-672). Intentions optimize routing; they do not gate it.

**D6. Operator override interaction (R6).** Explicit `--agent foo` bypasses routing entirely. This matches the current `resolveAgentExplicit` path (agent-service.ts:621-622, 808-820): `--agent` short-circuits before `resolveAgentAuto` runs. An explicit override pins the executor unconditionally; it does not pin one axis and leave escalation live. If the operator wants to pin the agent but keep tier escalation, they pass `--intention` instead of `--agent` and let config's tier→executor mapping handle the rest.

**D7. Versioning (R7).**

- `intentions.md` carries `version: N` (starts at 1). The plugin ships it; `spur` does not hardcode the vocabulary.
- Config carries `agent.intentions_version` (optional, defaults to 1). On resolve, if the plugin's vocabulary version is higher than config's declared version, unmapped intentions trigger the R4 warning. If config's version is higher than the plugin's, the extra mappings are inert (the plugin won't emit those intentions).
- Adding an intention is backwards-compatible (new row, old config → R4 warning + default). Removing or renaming one is a major version bump and requires a migration note in the reference file.
- `sp` and `spur` release independently. The vocabulary lives in the plugin (`sp`); the mapping lives in config (project-local, edited by `spur init` / operator). The `intentions_version` field is the contract between them. A stale config degrades with a warning, never a crash.

**D8. No implementation (R8).** This ticket ends at the recorded decision. The implementation is decomposed once the wayfinder map clears; likely tasks: (a) create `plugins/sp/references/intentions.md`; (b) add `intention:` frontmatter to the 31 command files; (c) add `--intention` flag to `spur agent run`; (d) thread intention through `AgentRunActionRunner`; (e) retire `extractPhase`; (f) document in `docs/04_DESIGN.md` under T3.

**Resolved (operator, 2026-07-26).**

- `orchestrate` (capable) **kept**. Batch driver coordination benefits from the stronger model; revisit only on observed cost regressions.
- `utility` granularity **kept** as a single `cheap` intention. Split to a `standard`-tier `author` only if dogfooding shows quality regressions on rule/workflow authoring under cheap-tier models.

**Verify fix-pass (2026-07-26, `--fix all`).** Cleared D2 dual-listing of `sp:code-testing` (was both "must include" and "need not include"). Multi-intention vs single-intention rule is now exclusive. Minor prose: "two new intentions cover 21 stage-less" → "two new intentions plus adoption of existing intentions cover the 21 stage-less commands."

---

**Superseded 2026-08-13 by task 0535 (§ feature B2, operator ruling).** The eight-intention
vocabulary above collapses to **four roles — `scribe` / `coder` / `reviewer` / `planner`**, one
per tier, because the eight intentions carried only four distinct stage floors (`plan` capable-2;
`verify`/`dogfood` capable-1; `changelog` cheap; everything else standard) — four names had no
routing consequence. The Layer-1 table now lives at `plugins/sp/references/roles.md` (this
decision named `plugins/sp/references/intentions.md`; that path was never built). `--agent` becomes
the role selector; the Layer-2 tier→executor mapping stays operator-owned in `.spur/config.yaml`.
This note is an append; the D1–D8 decision above remains the recorded 2026-07-26 decision.
### Testing
**Verdict: PASS** (re-audit 2026-07-26, `/sp:dev-verify 0344 --force --fix all --focus all --next`)

Decision-only ticket (`template: issue`, R8). Deliverable is the recorded Solution (D1–D8), not code. Coverage: N/A (documentation-only / decision-only change; no runtime code path added).

**Per-Requirement Traceability**

| Req | Status | Evidence |
| --- | --- | --- |
| R1 | MET | Solution D1: 8-value vocabulary table; set-diff of `plugins/sp/commands/*.md` vs D1 command cells = empty (31/31 exclusive). 10 stage records in `packages/domain/src/stage-registry/schema.ts:655-849` (`REGISTERED_CANONICAL_STAGES`); 21 stage-less covered by adopt-existing + `orchestrate`/`utility`. |
| R2 | MET | Solution D2: location `plugins/sp/references/intentions.md` (plugin-root); fenced YAML + prose; skills-include rule exclusive after fix-pass (multi-intention must / single-intention need not). Existing convention: 11 files under `plugins/sp/skills/spur-dev/references/`. |
| R3 | MET | Solution D3 table: four paths (slash / `spur agent run` / subagent / workflow). Anchors re-read: `extractPhase` `packages/app/src/services/agent-service.ts:942-955`; regex at `:953`; `AgentRunActionRunner` `packages/app/src/workflow/actions/agent-run.ts:71`. |
| R4 | MET | Solution D4: warning + `default_tier` (not hard error / silent). Pattern reuse: `warnDeprecationOnce` `packages/app/src/services/agent-service.ts:608-612`, call site `:646-648`. |
| R5 | MET | Solution D5: fall through to `agent.default` then priority. Anchor re-read: `resolveAgentAuto` fallthrough `packages/app/src/services/agent-service.ts:666-672`. |
| R6 | MET | Solution D6: `--agent` full bypass. Anchors: `resolveAgent` `packages/app/src/services/agent-service.ts:621-622`; `resolveAgentExplicit` `:808-820`. |
| R7 | MET | Solution D7: `intentions.md` `version: N`; config `agent.intentions_version`; add = compatible, rename/remove = major; independent `sp`/`spur` cadences. |
| R8 | MET | No implementation this ticket. `plugins/sp/references/intentions.md` absent; no `--intention` wiring in agent CLI / agent-run; working tree code files clean (only task corpus modified). Operator confirmed 2026-07-26 (Q&A). |

**Acceptance Criteria Verification**

| AC | Status | Evidence Type | Evidence |
| --- | --- | --- | --- |
| *(section empty)* | N/A | n/a | `### Acceptance Criteria` body is empty — no checklist or Gherkin scenarios to evaluate. |

**Design conformance**

| Check | Status | Evidence |
| --- | --- | --- |
| design-conformance | pass | `### Design` intentionally empty for issue-template decision ticket; approved contract is Solution D1–D8 (all DONE as recorded decisions). |
| scope-creep | pass | Diff is task corpus only (Solution/Q&A/Review/History); no code hunks outside R8 boundary. |
| evidence-rule-pass | pass | No behavior-bearing AC rows; decision-only deliverable. |
| cli-golden-path-present | n/a | No CLI surface change in this ticket (implementation deferred D8). |

**Commands run this verify**

```
spur task show 0344 --json                    # exit 0; status=done; R1–R8 + Solution present
spur task check 0344 --json                   # pass: true, findings: []
spur task check 0344 --strict-core --json     # pass: true
python3 set-diff D1 vs plugins/sp/commands    # missing=[], extra=[], 31==31
ls plugins/sp/references/intentions.md        # absent (R8)
rg intention apps/cli/... agent-service agent-run  # no --intention wiring (R8)
```

**Fix-pass disclosure (`--fix all`)**

- Touched: task Solution section via `spur task update 0344 --section Solution` (D2 skills-include exclusivity; D1 prose precision; line-anchor polish D4/D5/D6).
- Artifact written: `.spur/run/0344-verdict.json` (standalone verify; gitignored — discoverable from this Testing section).
- Residual after one retry: none.

**`--next`:** no-op — task already terminal (`done`).
### Review
**Decision review — recorded 2026-07-26 (operator-confirmed); re-audited 2026-07-26 under `/sp:dev-verify --force`.**

This is a `template: issue` decision ticket (type: grilling, wayfinder B2). R8 explicitly excludes implementation; the deliverable is the recorded decision itself. The review surface for a decision is therefore not code review (SECUA) but a priority findings table over the decision's soundness, internal consistency, and downstream risk. Operator confirmation 2026-07-26 closes the review; verify re-audit confirmed R1–R8 MET and cleared one residual consistency defect (D2 skills-include dual-list).

| Priority | Finding | Evidence | Disposition |
| --- | --- | --- | --- |
| P1 | None. | — | — |
| P2 | `extractPhase` retirement (D3) removes the only prompt-text inference path. If a future dispatch path carries no declared intention, the only fallback is `agent.default` (D5) — there is no longer any prompt-shape heuristic to recover a tier. | D3 + D5: acceptable; matches today's behavior for non-slash prompts, and the new declaration paths cover the four canonical dispatch surfaces. | Accepted. Residual risk: a future dispatch surface that neither declares `--intention` nor passes a slash command will silently use `default`. Mitigated by the D4 warning (declared-but-unmapped → warn) and by the closed 8-value vocabulary. |
| P3 | Two new intentions (`orchestrate`, `utility`) are not stage-backed; their tier is declared in `intentions.md` rather than derived from `REGISTERED_CANONICAL_STAGES`. This creates a second tier-declaration source for non-stage intentions. | D1: `orchestrate`/`utility` rows have empty "Stage IDs folded" cells. | Accepted. The `intentions.md` YAML is the single source for non-stage intention tiers; stage-backed intentions still derive from `model_policy.min_tier`. No tier drift. |
| P3 | `intentions_version` contract (D7) is forward-only by convention; there is no automated check that a renamed intention triggers a major version bump. | D7: "Removing or renaming one is a major version bump." | Accepted as process control. Documented in the reference file; the D4 warning is the runtime backstop if convention is violated. |
| P4 | Operator confirmed both open questions as recommended (keep `orchestrate` capable; keep `utility` cheap) without modification. | Q&A 2026-07-26. | Closed. |
| P4 | D2 skills-include listed `sp:code-testing` under both must-include and need-not. | Solution D2 (pre-fix). | **Fixed** in verify fix-pass: exclusive multi-intention must / single-intention need-not rule. |

**Residual risk:** low. The decision is non-breaking — `extractPhase` removal is the only behavior change, and it only affects paths that today silently fall through to `agent.default` anyway (no regression for correctly-shaped slash commands; improvement for everything else). Implementation will surface concrete regressions during dogfooding.

**Final disposition:** decision recorded as final in Solution (D1–D8). Status is `done`. Implementation is a separate task batch once the wayfinder map clears (D8). Verify re-audit: **PASS** (see Testing; `.spur/run/0344-verdict.json`).
### References
- **Wayfinder map:** feature B2 (invocation-agnostic executor selection); absorbed ticket 0345 (2026-07-26).
- **Two-layer contract (pre-ruled):** Layer 1 intention→tier lives in plugin reference; Layer 2 tier→executor lives in operator `.spur/config.yaml`.
- **Code anchors (current tree, pre-implementation):**
  - `extractPhase` / regex gap: `packages/app/src/services/agent-service.ts:942-955`
  - `resolveAgentAuto` fallthrough: `packages/app/src/services/agent-service.ts:666-672`
  - `resolveAgent` / `--agent` bypass: `packages/app/src/services/agent-service.ts:618-622`, `808-820`
  - `warnDeprecationOnce`: `packages/app/src/services/agent-service.ts:608-612`
  - `AgentRunActionRunner` (future `--intention` thread): `packages/app/src/workflow/actions/agent-run.ts:71`
  - Canonical stages (10): `packages/domain/src/stage-registry/schema.ts:655-849` (`REGISTERED_CANONICAL_STAGES`)
- **Command surface:** `plugins/sp/commands/` (31 files; D1 inventory closed).
- **Planned artifact (D2/D8, not created this ticket):** `plugins/sp/references/intentions.md`
- **Verdict artifact (verify re-audit, gitignored):** `.spur/run/0344-verdict.json`
### History
- 2026-07-26: Refined under `--auto`. Synthesized 8-decision proposal (D1–D8) covering intention vocabulary, reference file location/format, four dispatch paths, unmapped/no-intention behavior, override interaction, and versioning. Two open questions flagged for operator. No status change — awaiting confirmation before advancing.
- 2026-07-26: Operator confirmed both open questions (keep `orchestrate` capable; keep `utility` cheap). Decision finalized; transitioning to `done`. Implementation decomposed separately once wayfinder map clears.
- 2026-07-27T03:25:58.071Z todo → wip (system)
- 2026-07-27T03:26:03.453Z wip → testing (system)
- 2026-07-27T03:26:12.766Z testing → done (system)
- 2026-07-26: `/sp:dev-verify 0344 --force --fix all --focus all --next` re-audit. R1–R8 MET; empty AC N/A; design-conformance pass (Solution is contract). Fix-pass cleared D2 dual-listing of `sp:code-testing`. Verdict PASS written to Testing + `.spur/run/0344-verdict.json`. `--next` no-op (already terminal `done`).
