---
schema_version: 1
name: "Config 1.2: key-by-key merge strategy and layer-scope classification"
status: done
template: brainstorm
created_at: 2026-08-23T20:51:10.444Z
updated_at: "2026-08-23T22:13:37.890Z"
feature_id: A4
---

## 0639. Config 1.2: key-by-key merge strategy and layer-scope classification

### Background
**Wayfinder ticket** (`wayfinder:research`) under map **[A4 Spur config 1.2: global + project
layered configuration](../features/A4_spur-config-1-2-global-project-layered-configuration.md)**.

The operator ruled on 2026-08-23 that one `spurConfigSchema` validates both the global
`~/.config/spur/config.yaml` and the project `.spur/config.yaml`, that the loader deep-merges the
whole tree automatically, that `agent.executors` merges by `name`, and that validation runs once on
the merged result.

What is **not** decided is what "deep merge" means for every other key. `rules.paths` and
`workflows.paths` are arrays but are search paths, not named records — the executors answer does not
transfer. `tasks.folders`, `tasks.severity`, `agent.roles`, and `agent.team` are maps. And several
keys hold **project-relative** values (`tasks.active: docs/tasks4`,
`bootstrap.database.url: .spur/spur.db`) that are meaningless — or actively harmful — in a
machine-wide file, which the "same schema both layers" ruling deliberately does not fence off.

This ticket produces the merge table the loader prototype (0640) implements against.
### Requirements
- [x] R1. Enumerate every key in `spurConfigSchema` (`packages/config/src/index.ts:676`) down to leaf
  level, plus the `bootstrap` block that exists only in `apps/cli/schemas/spur-config.schema.json:19`
  and is unvalidated passthrough in zod.
- [x] R2. Classify each key's merge strategy from a closed vocabulary: `scalar-replace`,
  `object-deep-merge`, `array-replace`, `array-concat`, `merge-by-key:<field>`. No key may be left
  unclassified.
- [x] R3. Flag every key whose value is **project-relative** and therefore hazardous when set in the
  global layer — at minimum `name`, `tasks.active`, `tasks.folders.*`, `features.dir`, `rules.paths`,
  `bootstrap.database.url`, `bootstrap.logging.filePath`.
- [x] R4. For each flagged key, state the concrete merged behavior under the operator's no-whitelist
  ruling and whether it constitutes a real footgun (e.g. a stray global `tasks.active` retargeting
  every project on the machine) or is harmless in practice.
- [x] R5. Produce the operator-facing decision brief for map open question 3: do `rules.paths` and
  `workflows.paths` concat or replace? Give a recommendation with the reasoning, not just options.
### Acceptance Criteria
```gherkin
Feature: Config 1.2 merge-strategy classification

  Scenario: Every schema leaf carries a merge verdict
    Given the enumerated key list from spurConfigSchema plus the bootstrap block
    When the classification table is complete
    Then every leaf key names exactly one strategy from the closed vocabulary
    And no entry reads "TBD" or is omitted

  Scenario: Project-relative keys are identified as global-layer hazards
    Given the classification table
    When the project-relative keys are reviewed
    Then each is flagged with its concrete merged behavior under the no-whitelist ruling
    And each carries a footgun verdict with reasoning

  Scenario: The path-array question reaches the operator as a brief
    Given rules.paths and workflows.paths are arrays of search paths
    When the decision brief is written
    Then it states concat and replace consequences and recommends one
```
### Q&A
**Open (operator) — do `rules.paths` and `workflows.paths` concat or replace?** Both are arrays of
search paths, not named records, so the `merge-by-key:name` ruling for `agent.executors` does not
transfer. R5 produces the brief; the operator rules before 0640 implements. Recorded as open
question 3 on the A4 map.

**Deferred with a stated default.** If the operator has not ruled when 0640 starts, 0640 implements
`array-concat` (global paths first, project paths second) — it is the only option under which a
project that declares one extra rule path does not lose the global set, which is A4's whole premise.
The default is recorded here so the dependent task is never blocked; it is not a substitute for the
ruling.

**Closed.** Executor merge strategy (`merge-by-key:name`), one-schema-both-layers, total automatic
merge, and validate-once-after-merge were all ruled by the operator on 2026-08-23 and are recorded
in the A4 map's Decisions so far. They are inputs here, not questions.
### Design
**WHAT.** A classification table, not code. Every key in the config schema gets exactly one merge
strategy and a global-layer hazard verdict. 0640 implements against this table; nothing here ships.

**WHY.** A naive deep merge is wrong for this schema in two directions at once. Merged index-wise,
`agent.executors` produces hybrid executors that validate and misroute. Merged as whole-array
replace, the project must re-paste the global list — the duplication A4 exists to remove. The
operator already ruled `merge-by-key:name` for executors specifically; every *other* container key
still has no answer, and `rules.paths` / `workflows.paths` almost certainly want a different one.

**WHERE.** Reads `packages/config/src/index.ts` (`spurConfigSchema:671` and every referenced
sub-schema) and `apps/cli/schemas/spur-config.schema.json` (for `bootstrap`, which has no zod
counterpart). Writes only this task's `### Solution`.

**Frozen vocabulary.** The strategy column takes exactly these five tokens — 0640 implements one
code path per token, so a sixth token is an API change, not a note:

| Token | Meaning |
| --- | --- |
| `scalar-replace` | Project value wins when present; global otherwise |
| `object-deep-merge` | Recurse key-by-key |
| `array-replace` | Project array wins wholesale when present |
| `array-concat` | Global entries first, then project entries |
| `merge-by-key:<field>` | Match entries on `<field>`; same-key entries deep-merge; new keys append |

**Frozen output shape.** One markdown table in `### Solution` with these columns:
`key path | value type | strategy | global-legal | hazard`. `key path` is dotted and leaf-level
(`agent.executors[].tier`, not `agent`). `global-legal` is yes/no. `hazard` is empty or a one-line
statement of what a wrong global value does to every project on the machine.

**Precedence rule (applies to every strategy).** Project layer over global layer. There is no
third layer and no per-key opt-out — the operator ruled the merge total and automatic.

**Anti-patterns — do not.**
- Do not implement the merge. 0640 owns `packages/config/src/loader.ts`; touching it here forks the work.
- Do not pick or add a merge library. The table is the spec; 0640 decides the implementation.
- Do not rule on the `rules.paths` / `workflows.paths` question. R5 produces a decision **brief**;
  the operator rules. A table row that quietly picks one is the failure mode this split prevents.
- Do not propose a global-layer key whitelist. The operator explicitly chose one schema with no
  scope fence; R3/R4 document the resulting hazards rather than re-litigating the ruling.

**Handoff to dependents.** 0640 consumes the strategy column verbatim as its implementation
checklist. 0642 consumes the single `agent.roles` row — its per-field, closed-vocabulary override
semantics are the contract the role-SSOT inversion inherits.

**No new API.** This task adds no exported symbol, flag, or config key.
### Plan
- [x] Enumerate schema leaves from `packages/config/src/index.ts` and the JSON Schema (R1)
- [x] Classify each leaf against the closed strategy vocabulary (R2)
- [x] Flag project-relative keys and trace their merged behavior (R3, R4)
- [x] Write the path-array decision brief with a recommendation (R5)
- [x] Record the table in Solution; report back to the A4 map
### Solution
**Merge-strategy classification for `spurConfigSchema` + `bootstrap`** - the table 0640 implements against. Strategy column takes only the frozen five-token vocabulary (`packages/config/src/index.ts:676` for every zod key; `apps/cli/schemas/spur-config.schema.json:20` for `bootstrap`, which is zod-passthrough - `spurConfigSchema` has no `bootstrap` key, so validate-once-after-merge does not cover it today). Precedence for every row: project layer over global layer, total automatic merge, one validation on the merged result (operator ruling 2026-08-23).

| key path | value type | strategy | global-legal | hazard |
| --- | --- | --- | --- | --- |
| `version` | string | scalar-replace | yes | none - project label wins; cosmetic |
| `name` | string | scalar-replace | no | PROJECT-RELATIVE: a global `name` labels every project on the machine identically - mislabeled runs/history. Footgun: real but cosmetic (mild) |
| `tasks` | object | object-deep-merge | yes | block recursion is the total-merge ruling |
| `tasks.folders` | record<path→object> | object-deep-merge | no | PROJECT-RELATIVE keys: global entries inject folders a project never declared into every folder map; same-path entries cross-pollinate state. Footgun: real - a global `docs/tasks` entry with `baseCounter` shifts task numbering in every project using that path |
| `tasks.folders.<path>.baseCounter` | int | scalar-replace | no | global counter silently overrides a project that omits it (default 0 applies post-merge) |
| `tasks.folders.<path>.label` | string | scalar-replace | no | mislabels the folder in every project sharing the path |
| `tasks.active` | path string | scalar-replace | no | PROJECT-RELATIVE: a stray global `tasks.active` retargets every project's default create folder - new tasks land in a nonexistent/wrong corpus. Footgun: real, high severity |
| `tasks.severity` | record<code→enum> | object-deep-merge | yes | not project-relative; a global severity policy silently re-tiers task-check verdicts machine-wide - an intended capability, noted for visibility |
| `tasks.severity.<code>` | error/warning/off | scalar-replace | yes | project may re-override any code over global |
| `features` | object | object-deep-merge | yes | block recursion |
| `features.dir` | path string | scalar-replace | no | PROJECT-RELATIVE: a global `features.dir` retargets feature-corpus reads/writes for every project to the wrong tree. Footgun: real, high severity |
| `agent` | object | object-deep-merge | yes | block recursion |
| `agent.default` | executor selector | scalar-replace | yes | canonical machine preference - flagship global key |
| `agent.executors` | array<object> | merge-by-key:name | yes | OPERATOR RULED (2026-08-23); shared executor profiles are the global layer's main use case |
| `agent.executors[].name` | string | scalar-replace | yes | identity field for merge-by-key:name - matched, not meaningfully merged (equal by definition on match) |
| `agent.executors[].agent` | string | scalar-replace | yes | none - project refines a shared profile's agent |
| `agent.executors[].model` | string | scalar-replace | yes | none |
| `agent.executors[].tier` | enum | scalar-replace | yes | none |
| `agent.roles` | record<role→object> | object-deep-merge | yes | per-field override over `DEFAULT_AGENT_ROLES` composes naturally across layers - this row's semantics are the contract 0642 inherits |
| `agent.roles.<role>.tier` | enum | scalar-replace | yes | none - machine-wide role tier is an intended global preference |
| `agent.roles.<role>.stages` | array<string> | array-replace | yes | stage sets are whole-set semantics; concat builds hybrid stage lists that misroute |
| `agent.team` | record<teamId→object> | object-deep-merge | yes | shared team definitions across projects are legitimate |
| `agent.team.<id>.name` | string | scalar-replace | yes | none |
| `agent.team.<id>.work_dir` | path string | scalar-replace | no | PROJECT-RELATIVE: a tilde-expanded global `work_dir` points every project's team members at one machine directory - cross-project dirty trees (the one-writer rule violated machine-wide). Footgun: real |
| `agent.team.<id>.autostart` | boolean | scalar-replace | yes | none |
| `agent.team.<id>.members` | array<object/string> | merge-by-key:id | yes | key is the normalized local id (`id ?? executor`, per `normalizeMember`); index-wise merge recreates the hybrid-executor failure the operator ruled against for `executors` |
| `agent.team.<id>.members[].id` | string | scalar-replace | yes | identity field for merge-by-key:id - matched, not meaningfully merged (equal by definition on match) |
| `agent.team.<id>.members[].{executor,role,purpose,model,autonomy,systemPrompt,autostart}` | string/bool leaves | scalar-replace | yes | none within a matched member |
| `agent.team.<id>.members[].command` | array<string> | array-replace | yes | command lines are whole-command semantics |
| `agent.team.<id>.members[].workspace` | path string | scalar-replace | no | PROJECT-RELATIVE: per-member workspace inherits the `work_dir` hazard |
| `agent.output` | object | object-deep-merge | yes | machine-wide capture caps are intended |
| `agent.output.max-bytes` | int | scalar-replace | yes | none |
| `agent.output.max-lines` | int | scalar-replace | yes | none |
| `agent.sessionAffinity` | boolean | scalar-replace | yes | machine preference |
| `rules` | object | object-deep-merge | yes | block recursion |
| `rules.paths` | array<path> | array-concat | no | PROJECT-RELATIVE, and OPEN: strategy shown is the recorded deferred default (Q&A), not a ruling - see decision brief below. Global search paths resolve against every project's root; loader must skip missing dirs |
| `workflows` | object | object-deep-merge | yes | block recursion |
| `workflows.paths` | array<path> | array-concat | no | PROJECT-RELATIVE, and OPEN: same as `rules.paths` - deferred default, see decision brief below |
| `workflow` | object | object-deep-merge | yes | block recursion |
| `workflow.logRetentionDays` | int | scalar-replace | yes | machine policy - intended global |
| `redaction` | object | object-deep-merge | yes | block recursion |
| `redaction.enabled` | boolean | scalar-replace | yes | not project-relative, but directional: a project layer can switch OFF a machine-mandated redaction-on policy (project wins under scalar-replace). Flagged for 0642 if policy precedence is wanted |
| `history` | object | object-deep-merge | yes | block recursion |
| `history.refresh` | object | object-deep-merge | yes | block recursion |
| `history.refresh.on_completion` | boolean | scalar-replace | yes | machine policy - intended global |
| `history.refresh.debounce_ms` | int | scalar-replace | yes | machine policy - intended global |
| `bootstrap` | object | object-deep-merge | yes | zod-passthrough (no key in `spurConfigSchema`); merged-result validation does not cover it - 0640 must decide whether the validator folds in the JSON Schema or `bootstrap` stays app-layer-validated |
| `bootstrap.logging` | object | object-deep-merge | yes | block recursion |
| `bootstrap.logging.{enabled,level,console,json,file}` | bool/enum leaves | scalar-replace | yes | machine logging policy - intended global |
| `bootstrap.logging.filePath` | path string | scalar-replace | no | PROJECT-RELATIVE: the relative default (`.spur/logs/spur.log`) resolves per-project (benign), but a global ABSOLUTE path merges every project's logs into one file - forensics confusion + unbounded growth. Footgun: real, moderate |
| `bootstrap.telemetry` | object | object-deep-merge | yes | block recursion |
| `bootstrap.telemetry.{enabled,serviceName,environment}` | leaves | scalar-replace | yes | machine telemetry policy - intended global |
| `bootstrap.database` | object | object-deep-merge | yes | block recursion |
| `bootstrap.database.{enabled,driver}` | leaves | scalar-replace | yes | machine policy |
| `bootstrap.database.url` | path string | scalar-replace | no | PROJECT-RELATIVE, worst in table: a global ABSOLUTE url points every project at ONE sqlite file - cross-project task writes, lock contention, corruption. Relative values resolve per-project (benign). Footgun: real, severe |
| `bootstrap.scheduler.enabled` | boolean | scalar-replace | yes | machine policy |

**Why `merge-by-key` only twice.** Only `agent.executors` (operator-ruled) and `agent.team.<id>.members` carry a natural identity field. Every other array is either ordered semantics (`command` - whole-command lines) or a set whose merge question is exactly R5's (`rules.paths` / `workflows.paths`). Maps (`folders`, `severity`, `roles`, `team`) already have identity in their keys, so `object-deep-merge` subsumes what `merge-by-key` would express.

**Decision brief (R5): do `rules.paths` and `workflows.paths` concat or replace?**

Both are arrays of search paths scanned for YAML - not named records - so the `merge-by-key:name` ruling for `agent.executors` does not transfer (no identity field).

**Option A - `array-concat` (global first, project second).** A project that declares one extra path keeps the global pack: extend, don't re-paste - A4's premise. Costs: global entries resolve per-project (`<project>/<global-relative-path>` mostly will not exist), so the loader must skip missing search paths without error; duplicate rule/workflow ids across layers need a pinned collision convention.

**Option B - `array-replace` (project array wins wholesale).** Simple, zero collision ambiguity. Cost: a project declaring any paths entry silently drops the global pack - the duplication A4 exists to remove; operators will copy-paste global lists into every project config to compensate.

**Recommendation: `array-concat`** (global first, project second; project entry wins id collisions; missing search paths skipped silently). It is the only option under which a project that declares one extra rule path does not lose the global set - A4's whole premise. This matches the deferred default recorded in this task's Q&A; an operator ruling to the contrary overrides it.

**Collision convention:** with load-all search-path semantics, list order must not decide precedence - pin "project entry wins on id collision" so the project-over-global precedence rule holds regardless of ordering.

**Handoff.** 0640 consumes the strategy column verbatim as its implementation checklist (and must settle the two flagged loader behaviors: skip-missing-search-path, and whether `bootstrap` joins merged validation). 0642 consumes the `agent.roles` row's per-field closed-vocabulary override semantics as the role-SSOT contract. The operator rules on R5 before 0640 starts, or 0640 takes the recorded default. Map update deferred to the batch wrap hop.
### Testing
**Pipeline verify results**

- Verdict: PASS (from verdict artifact)

| Requirement | Status | Evidence |
|-------------|--------|----------|
| R1 | MET | Solution classification table `docs/tasks4/0639_config-1-2-key-by-key-merge-strategy-and-layer-scope-classif.md:135-195`: all 11 JSON-schema top-level keys + zod-only `workflow` + full `bootstrap` block, leaf-level. Schema sources verified: `packages/config/src/index.ts:671-745` (`spurConfigSchema`), `apps/cli/schemas/spur-config.schema.json:20` (bootstrap) - member/team leaf fields confirmed against TeamMemberConfigSchema/TeamConfigSchema in the same file |
| R2 | MET | every strategy cell carries exactly one of the five vocabulary tokens; identity fields (`executors[].name`, `members[].id`) use `scalar-replace` with matched-not-merged note; zero TBD/unclassified cells |
| R3 | MET | all seven required keys flagged PROJECT-RELATIVE with `no` in global-legal: `name` (:139), `tasks.active` (:144), `tasks.folders.*` (:140-142), `features.dir` (:148), `rules.paths` (:181), `bootstrap.database.url` (:192), `bootstrap.logging.filePath` (:190); plus extras `workflows.paths`, `agent.team.<id>.work_dir`, `members[].workspace` |
| R4 | MET | each flagged row states concrete merged behavior + footgun verdict with severity: `bootstrap.database.url` "worst in table, severe" (:192); `tasks.active` "real, high severity" (:144); `name` "real but cosmetic (mild)" (:139); `work_dir`/`filePath`/`folders.*` each carry behavior + verdict |
| R5 | MET | Decision brief :197-205: Option A (concat) and Option B (replace) consequences, explicit recommendation `array-concat` with reasoning (:205), collision convention pinned (project wins id collisions, order does not decide precedence); deferred default recorded, operator ruling preserved as open |

| Acceptance Criteria | Status | Evidence Type | Evidence |
|---------------------|--------|---------------|----------|
| AC1 - Every schema leaf carries a merge verdict | MET | command | `grep -cE '^\| \`[^\`]+\` \| [^ |
| AC2 - Project-relative keys identified as global-layer hazards | MET | command | `grep -c 'PROJECT-RELATIVE' docs/tasks4/0639_*.md` -> 10 flags; the seven required keys each flagged with concrete merged behavior + footgun verdict at :139, :140-142, :144, :148, :181, :190, :192 |
| AC3 - The path-array question reaches the operator as a brief | MET | command | `grep -n 'Decision brief (R5)' docs/tasks4/0639_*.md` -> :197; `grep -c 'Recommendation: \`array-concat\`' docs/tasks4/0639_*.md` -> 1 at :205 with consequences + reasoning for both options |
- Coverage: N/A (verdict-based; verify pipeline does not measure code coverage)
### Review
**SECU findings** (pipeline verify step — verdict: PASS)

| Priority | Dimension | Location | Finding |
|----------|-----------|----------|----------|
| P4 | spur task check | — | task check passed |
| P4 | evidence-rule-pass | — | All behavior-bearing AC rows have executable evidence or are explicitly non-behavioral. |
### References

<!-- Links to docs, examples, related tasks/features, or external references. -->

### History
- 2026-08-23T22:03:18.986Z todo → wip (system)
- 2026-08-23T22:13:07.168Z wip → testing (system)
- 2026-08-23T22:13:37.890Z testing → done (system)
