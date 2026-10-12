---
schema_version: 1
name: Deprecated status documentation and skill parity
status: done
template: meta
created_at: 2026-10-12T05:21:53.041Z
updated_at: "2026-10-12T20:52:28.637Z"
feature_id: F42
priority: P2
tags:
  - feature-lifecycle
  - docs

dependencies: ["1180", "1181"]
estimate_hours: 1.5
done_forced: "false"
done_reason: unforced close; PASS artifact at .spur/memory/evidence/1182-verdict.json
---

## 1182. Deprecated status documentation and skill parity

### Background

Implements: R7 — Owning documents and skills describe the deprecated status and its affected surfaces.

Design: docs/design/feature-deprecated-status.md; ADR-136. Surfaces S15–S16. Runs after 1180 and 1181 so docs quote shipped messages and codes.

**Refine corrections (2026-10-11)**
- "`03_ARCHITECTURE.md` names the status graph" → it carries no feature-status vocabulary (grep finds none) → dropped from scope.
- "`spur-dev/references/dev-operations.md` documents feature statuses" → it does not list them → dropped; the next-feature skill line is 1180's.
- Verified status-vocabulary sites: `docs/design/planning-record-contracts.md:221,225`; `docs/design/rd3-migration-design.md:138,168-171`; `docs/design/planning-workflow-contracts.md:31`; `docs/design/e2e-workflow-for-system-development.md:96`; `plugins/sp/skills/spur-cli/references/features.md:84,172`.
- "Seeded feature-lifecycle template matches the source graph" → there is no separate init template; parity is source `config/workflows/` vs bundled `apps/cli/config/workflows/` (owned by 1179) → this task only confirms it.

### Requirements

- [x] R1. The status vocabulary at every verified site lists `deprecated`; the graph descriptions (`rd3-migration-design.md` §2.3 diagram, `planning-workflow-contracts.md:31` row, e2e mermaid node) show its entry edges and its two exits.
- [x] R2. `plugins/sp/skills/spur-cli/references/features.md` documents the freeze: link refusal message, `L4.feature-deprecated` warning, section-write warning, sync no-op, `advance` refusal — quoting the strings 1180 shipped.
- [x] R3. `docs/00_ADR.md` ADR-136 status → `Accepted (implemented)`; `docs/design/feature-deprecated-status.md` frontmatter `status: current` and §1 wording updated from proposed to current.
- [x] R4. A CHANGELOG/release note states that project-layer `feature-lifecycle.yaml` overrides must be re-synced to gain the deprecated edges.
- [x] R5. Source and bundled `feature-lifecycle.yaml` are byte-identical (`cmp`).
- Out of scope: `03_ARCHITECTURE.md`, `dev-operations.md`, relabelling M/M3/M6.

### Acceptance Criteria

- [x] AC1 — Owning documents and skills describe the deprecated status and its affected surfaces (req: R1, R2, R3, R4, R5)

### Q&A

<!-- CLOSED decisions from refinement: what was chosen and why, what was deferred and on what
     condition. Not a parking lot for open questions — an unanswered question here means the task
     is not ready to hand off. Keep empty if none. -->

### Design

**Approach.** Update only owners whose facts changed (constitution §5); quote shipped strings from 1180 rather than paraphrasing. Run `sp:doc-evolve` drift check afterwards.

**Files.** As listed in Requirements; release note goes wherever the repo's CHANGELOG convention lives (check `CHANGELOG.md` at root, else the plugin README release section).

**Anti-patterns.** No new doc files; no edits to `99_PROJECT_CONSTITUTION.md`; no restating the affected-surface table outside the satellite.

**Dependencies.** Assumes 1180's messages/finding code and 1181's action labels are final.

### Plan

- [x] Step 0: 1180 and 1181 done; copy their final strings.
- [x] Vocabulary + graph sites (R1).
- [x] spur-cli features reference (R2).
- [x] ADR-136 + satellite status (R3).
- [x] Release note (R4).
- [x] `cmp config/workflows/feature-lifecycle.yaml apps/cli/config/workflows/feature-lifecycle.yaml` (R5).
- [x] `sp:doc-evolve` drift check; the full quality gate (`bun run spur-check`) runs in the pipeline's test stage — the implement stage is barred from it, so this step reports the focused checks instead.

### Root Cause

<!-- For issue/bug tasks: the verified underlying cause, with a `file:line` anchor. -->

### Solution

#### 1182 Solution — documentation and skill parity for `deprecated`

Docs/skill parity only; no production code changed. Every edit is at a site already verified by
1180/1181 or listed in the task's "Refine corrections". Quoted strings were read out of the landed
code, not paraphrased.

#### Change map

| R | File:line | Subject at that line |
| --- | --- | --- |
| R1 | `docs/design/planning-record-contracts.md:221` | `FeatureStatus` vocabulary row now `backlog · active · verifying · blocked · done · cancelled · deprecated` (DD-13, ADR-136) |
| R1 | `docs/design/planning-record-contracts.md:225-226` | Input-normalization paragraph: `deprecated` is an identity-only mapping (no synonym alias) |
| R1 | `docs/design/rd3-migration-design.md:138` | Feature frontmatter `status` row lists `deprecated` |
| R1 | `docs/design/rd3-migration-design.md:168-178` | `FeatureStatus` list + §2.3 diagram: entry edges (`backlog · active · verifying · blocked · done → deprecated`) and the two exits (`deprecated → active`, `deprecated → cancelled`) |
| R1 | `docs/design/planning-workflow-contracts.md:31` | `feature-lifecycle.yaml` states column lists `deprecated`; guard cell names its entry edges, two exits and the `always` guard |
| R1 | `docs/design/e2e-workflow-for-system-development.md:96` | Mermaid `FeatureLifecycle` node lists `deprecated` and its entry/exit shape |
| R1, R2 | `plugins/sp/skills/spur-cli/references/features.md:84-85` | `update` status paragraph lists `deprecated` |
| R2 | `plugins/sp/skills/spur-cli/references/features.md:88-121` | Freeze block: entry edges, two exits and the five shipped guards/messages |
| R2 | `plugins/sp/skills/spur-cli/references/features.md:98` | Link-refusal message (`ParentFeatureStatusError` deprecated branch) |
| R2 | `plugins/sp/skills/spur-cli/references/features.md:106` | `L4.feature-deprecated` warning message |
| R2 | `plugins/sp/skills/spur-cli/references/features.md:112` | Section-write warning |
| R2 | `plugins/sp/skills/spur-cli/references/features.md:116` | `deriveFeatureStatus` sticky no-op proposal |
| R2 | `plugins/sp/skills/spur-cli/references/features.md:121` | `advance` refusal |
| R2 | `plugins/sp/skills/spur-cli/references/features.md:152` | `advance` paragraph points at the freeze block for the refusal |
| R2 | `plugins/sp/skills/spur-cli/references/features.md:257-259` | `sync` section: sticky derivation, `sync`/`check --fix` never move a frozen feature |
| R1 | `plugins/sp/skills/spur-cli/references/features.md:209` | Roadmap/priority paragraph lists the frozen `deprecated` status |
| R3 | `docs/00_ADR.md:2259` | ADR-136 status `Proposed` → `Accepted (implemented)` |
| R3 | `docs/design/feature-deprecated-status.md:4` | Satellite frontmatter `status: current` |
| R3 | `docs/design/feature-deprecated-status.md:6` | `updated_at: 2026-10-12` |
| R3 | `docs/design/feature-deprecated-status.md:23` | §1 now states F42/ADR-136 are shipped and §3 records the landed surfaces |
| R2 parity | `docs/design/feature-deprecated-status.md:78-87` | §4.2 corrected to the shipped strings: link guard names the un-deprecate command (no sibling hint for a deprecated parent) and the `advance` quote matches `apps/cli/src/commands/feature.ts:210` |
| R4 | `CHANGELOG.md:3-8` | `[Unreleased]` release note: project-layer `feature-lifecycle.yaml` overrides must be re-synced to gain the `deprecated` edges |
| R5 | — | No edit; `config/workflows/feature-lifecycle.yaml` and the bundled copy are byte-identical (see check below) |

`docs/design/feature-deprecated-status.md` §3 (affected-surface table) and `docs/04_DESIGN.md`'s
index pointer were left as-is: their facts did not change. Not touched: `99_PROJECT_CONSTITUTION.md`,
`03_ARCHITECTURE.md`, `spur-dev/references/dev-operations.md` (none carries the vocabulary), and no
existing M/M3/M6 feature was relabelled.

#### Checks run (exact commands and observed output)

**R5 — source vs bundled graph**

```console
$ cmp config/workflows/feature-lifecycle.yaml apps/cli/config/workflows/feature-lifecycle.yaml; echo "cmp exit=$?"
cmp exit=0
```

**R2 — shipped-string parity (`bun /tmp/1182-string-parity.mjs`)** reconstructs each message from the
landed source line (ids replaced by `<id>`/`<wbs>` placeholders) and asserts it is quoted verbatim in
`plugins/sp/skills/spur-cli/references/features.md`:

```console
PASS | ParentFeatureStatusError (task-service.ts:216-217) link refusal
       source: parent-feature-status: feature <id> is deprecated (frozen); new tasks cannot link to it. Run removal work under its own feature, or un-deprecate: spur feature update <id> active
PASS | L4.feature-deprecated message (task-check.ts:1151)
       source: Feature "<id>" is deprecated (frozen) — re-parent this live task (`spur task update <wbs> --feature <otherId>`) or cancel it.
PASS | section-write warning (feature-service.ts:276)
       source: Feature <id> is deprecated (frozen); change it only as part of removal
PASS | deriveFeatureStatus reason (feature-service.ts:473)
       source: Feature is deprecated (frozen)
PASS | advance refusal (apps/cli/src/commands/feature.ts:210)
       source: <id> is deprecated; un-deprecate first: spur feature update <id> active
RESULT: all 5 shipped strings quoted byte-identically
```

`FINDING_CODES.L4_FEATURE_DEPRECATED = 'L4.feature-deprecated'` (`packages/config/src/finding-codes.ts:143`)
is the code named in the skill and in the warning message above.

**Changed-path self-check**

```console
$ bun apps/cli/src/index.ts rule run --preset recommended-pre-check --json
exit=0
$ # parsed summary
preset=recommended-pre-check ruleCount=51 findings=0 fixes=0
```

**Reality vs docs (focused tests; the full gate belongs to the pipeline's test stage)**

```console
$ (cd packages/app && bun test tests/services/task-check.test.ts tests/services/feature-service.test.ts tests/services/feature-transition.test.ts)
 283 pass | 0 fail | Ran 283 tests across 3 files.
$ (cd apps/cli && bun test tests/commands/feature.test.ts)
 52 pass | 0 fail | Ran 52 tests across 1 file.
```

**Graph ↔ docs vocabulary detection (doc-evolve drift-audit input)**

```console
$ # states/edges read from config/workflows/feature-lifecycle.yaml (source of truth)
states: backlog · active · verifying · blocked · done · cancelled · deprecated
edges:  backlog->deprecated, active->deprecated, verifying->deprecated, blocked->deprecated,
        done->deprecated, deprecated->active, deprecated->cancelled
$ grep -c deprecated docs/design/planning-record-contracts.md docs/design/rd3-migration-design.md \
    docs/design/planning-workflow-contracts.md docs/design/e2e-workflow-for-system-development.md \
    plugins/sp/skills/spur-cli/references/features.md
2 · 4 · 2 · 1 · 14   (all > 0)
$ grep -n feature-deprecated-status docs/04_DESIGN.md
38:| Feature `deprecated` status — frozen lifecycle state and affected surfaces (F42) | [feature-deprecated-status](design/feature-deprecated-status.md) |
$ git diff --name-only | grep -E "03_ARCHITECTURE|99_PROJECT_CONSTITUTION|dev-operations"   # → no output
```

#### `sp:doc-evolve` sync-check / drift-audit (§5, §7)

- **sync-check — T3 (non-UI contract/behavior):** the behavior shipped in 1179–1181; this change
  updates the owning satellites in the same change (`planning-record-contracts.md`,
  `rd3-migration-design.md`, `planning-workflow-contracts.md`, `e2e-workflow-for-system-development.md`,
  the `feature-deprecated-status.md` satellite, `00_ADR.md` ADR-136 status,
  `plugins/sp/skills/spur-cli/references/features.md`). No un-synced owner found.
- **T9:** no satellite added or moved; `docs/04_DESIGN.md:38` already indexes the satellite and its
  indexed description is still accurate — no index edit required.
- **T7:** `99_PROJECT_CONSTITUTION.md` untouched (explicitly out of scope).
- **drift-audit:** zero delta — the four vocabulary sites plus the skill reference each name
  `deprecated`, and the graph/guard/message facts above match the code. One real drift was found and
  repaired: the satellite's §4.2 quoted a planned `advance` message that never shipped.
- Frontmatter (contract-verify, §4.3): the satellite uses the design template's `proposed | current`
  vocabulary (`plugins/sp/skills/spur-dev/templates/design.md:4`); `status: current` + a plausible
  `updated_at` (2026-10-12). `CHANGELOG.md` is not a key doc under §4.1.

### Testing

**Pipeline verify results**

- Verdict: PASS (from verdict artifact)
- Confidence: MEDIUM

| Requirement | Status | Evidence |
|-------------|--------|----------|
| R1 | MET | `docs/design/planning-workflow-contracts.md:31` — Vocabulary and five-entry/two-exit graph checked in owning satellites; documentation assertion sweep exit 0. Verification artifacts refreshed: `.spur/run/1182-verify-answer.txt:1-35`; `.spur/run/1182-verdict.json:1-10` (verdict header, requirements and AC rows re-derived by CLI). |
| R2 | MET | `plugins/sp/skills/spur-cli/references/features.md:98` — All five shipped freeze messages compared verbatim; sticky sync and advance guidance present; doc parity assertions exit 0. |
| R3 | MET | `docs/00_ADR.md:2259` — ADR-136 accepted; satellite current at docs/design/feature-deprecated-status.md:4 and shipped wording at line 23, read this run. |
| R4 | MET | `CHANGELOG.md:5` — Release note requires project-layer graph overrides to be re-synced, read this run. |
| R5 | MET | `config/workflows/feature-lifecycle.yaml:151` — Source and bundled graph byte-identical; cmp exit 0 this run. |

| Acceptance Criteria | Status | Evidence Type | Evidence |
|---------------------|--------|---------------|----------|
| Scenario: R7 — Owning documents and skills describe the deprecated status and its affected surfaces | MET | command | `docs/design/feature-deprecated-status.md:43`, `plugins/sp/skills/spur-cli/references/features.md:98`, `docs/design/planning-workflow-contracts.md:31`, `CHANGELOG.md:5` — documentation presence and five quoted messages assertion sweep exit 0; source/bundle cmp exit 0; ADR accepted and satellite current read back. |
- Coverage: N/A (verdict-based; verify pipeline does not measure code coverage)

### Review

#### Review Report — 1182
**Scope:** docs + skill reference for the `deprecated` feature status (task 1182 diff; deps 1179/1180/1181 judged only as the sources 1182 quotes)
**Dimensions:** functional, security, efficiency, correctness, usability, architecture
**Verdict:** PASS

##### Findings (ranked)

| # | Priority | Dimension | Finding | Location | Disposition |
|---|----------|-----------|---------|----------|-------------|
| 1 | P4 (advisory) | correctness | The updated mermaid node condenses the entry edges to "deprecated entered from any state"; `cancelled` is terminal and cannot enter `deprecated`, so "any state" is a summary-altitude gloss (the graph's own comment is "any non-terminal-or-done state"). The higher-fidelity sites (`rd3-migration-design.md` §2.3, `planning-workflow-contracts.md:31`, `features.md` freeze block) enumerate the five sources correctly, and both exits in this node are correct, so this is wording, not a graph error. Tightening to "entered from any non-terminal state" would remove the caveat. | `docs/design/e2e-workflow-for-system-development.md:96` | ACCEPTED |
| 2 | P4 (advisory) | correctness | The preserved "Valid statuses: `backlog → active → verifying → blocked → done → cancelled`" arrow chain implies `verifying → blocked → done`; the real graph has `active ↔ blocked` off the main chain (`feature-lifecycle.yaml`) with no `verifying→blocked`/`blocked→done` edge. Pre-existing wording carried forward unchanged while 1182 edited this line (only appending "plus the frozen `deprecated`"); outside R1–R5 scope. | `plugins/sp/skills/spur-cli/references/features.md:84` | ACCEPTED |

No P1/P2/P3 findings. The five shipped freeze strings are byte-identical to source; the lifecycle graph in the docs matches `config/workflows/feature-lifecycle.yaml`; R3/R4/R5 are all met and the process boundaries hold.

##### Functional Traceability

| Req | Status | Evidence |
|-----|--------|----------|
| R1 | MET | `planning-record-contracts.md:221,225` vocabulary + identity-only alias; `rd3-migration-design.md:138,168-178` (§2.3 diagram shows the five entry edges + `deprecated→active`/`deprecated→cancelled`); `planning-workflow-contracts.md:31`; `e2e-workflow-for-system-development.md:96` (exits correct; entry condensed — see P4 #1); `features.md:84-85,209`. All five entry sources (`backlog/active/verifying/blocked/done`) and both exits match `config/workflows/feature-lifecycle.yaml`. |
| R2 | MET | Independent reconstruction from source → byte-identical in `features.md`: link refusal `task-service.ts:216-217` (`features.md:98`), `L4.feature-deprecated` `task-check.ts:1151` (`features.md:106`), section-write warning `feature-service.ts:276` (`features.md:112`), derive reason `feature-service.ts:473` (`features.md:116`), advance refusal `apps/cli/src/commands/feature.ts:210` (`features.md:121`). Code value `L4_FEATURE_DEPRECATED='L4.feature-deprecated'` (`finding-codes.ts:143`). No paraphrase. |
| R3 | MET | `00_ADR.md:2258` `Status: Accepted (implemented)`; satellite `status: current` + `updated_at: 2026-10-12` (`feature-deprecated-status.md:4,6`); §1 now reads "F42 and ADR-136 are shipped; §3 records the surfaces as they landed" (`:23`). |
| R4 | MET | `CHANGELOG.md:3-8` `[Unreleased]` note: project-layer `feature-lifecycle.yaml` overrides must be re-synced to gain the `deprecated` edges. |
| R5 | MET | `cmp config/workflows/feature-lifecycle.yaml apps/cli/config/workflows/feature-lifecycle.yaml` → exit 0 (byte-identical). |
| AC1 | MET | All of R1–R5 above; owning docs and the `spur-cli` skill describe the status and its affected surfaces; satellite §4.2 corrected to the shipped strings. |

##### Process boundaries

- No new doc files authored by 1182 (untracked `docs/tasks5/1183_residuals-from-1181.md` is 1181's residual-scan output, not 1182).
- No edits inside `docs/99_PROJECT_CONSTITUTION.md`, `03_ARCHITECTURE.md`, or `spur-dev/references/dev-operations.md` (diff filename grep empty).
- No relabelling of M/M3/M6; the only feature-status change is F42's own `backlog → active` (lifecycle-generated, `docs/features/F42…:5`, `INDEX.md:74`).
- Affected-surface table (S1–S17) lives only in the satellite; `features.md` adds the freeze guards/messages, not a restated S-table.

**Next:** none — no P1–P3 findings; adopt the two P4 wording tightenings opportunistically.

### References

<!-- Links to docs, tasks, decisions, or external references. -->

### History

- 2026-10-12T08:19:16.125Z todo → wip (system)
- 2026-10-12T08:30:02.274Z wip → testing (system)
- 2026-10-12T08:33:27.926Z testing → done (system)

