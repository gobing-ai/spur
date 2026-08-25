---
schema_version: 1
name: "history-anatomy.yaml workflow: cache branch, deterministic stage ordering, bounded correction, atomic publication"
status: done
template: feature-impl
created_at: 2026-08-25T04:06:58.577Z
updated_at: "2026-08-25T17:07:53.644Z"
feature_id: I8
priority: P2
tags: ["workflow", "history", "orchestration"]
dependencies: ["0658", "0659"]
---

## 0660. history-anatomy.yaml workflow: cache branch, deterministic stage ordering, bounded correction, atomic publication

### Background

Five responsibilities with different failure semantics — cache decision, deterministic artifact
generation and rendering, model enrichment, evidence validation, and atomic publication — justify a
dedicated state-machine workflow rather than orchestration prose inside the skill. The workflow
composes the existing `spur history analyze` → explicit artifact → `spur history report --mode
forensics` seam, invokes 0658's `enrich` and `validate` operations, and gates publication behind
both the deterministic structure gate and independent evidence validation.

**Verified against the tree on 2026-08-24:**

| Claim | Evidence |
| --- | --- |
| Available action kinds across shipped workflows | `agent.run`, `always`, `command.gate`, `doctor.probe`, `file.read.into-var`, `hitl.confirm`, `note`, `proof.fingerprint`, `run.artifact`, `shell`, `state-machine` |
| Transitions carry `from`/`to`/`description`/`guard`, with `kind: shell` or `kind: always` | `config/workflows/idea-pipeline.yaml:484-514` |
| Every bundled workflow must carry the package `$schema` ref | `plugins/sp/tests/skill-structure.test.ts:451-457` |
| Every `${vars.X}` must be declared in the `vars:` block — the test fails otherwise | `plugins/sp/tests/skill-structure.test.ts:541-562` |
| Tracked SSOT is `config/workflows/`; `apps/cli/config/` is a gitignored `build:bundle` artifact | `CLAUDE.md` § Stack & layout; `docs/04_DESIGN.md` §2.3 |
| A `shell` action over ~5 non-comment lines is flagged as an owned-capability candidate | ADR-069 amendment R1 (`docs/00_ADR.md:906-916`) |
| A non-slash `agent.run` `input` triggers a composition report (advisory only) | ADR-069 amendment R2 |
| `expectFile` proves existence only — a pre-created file passes it, so a content assertion must follow | `config/workflows/idea-pipeline.yaml` system-design state (0515 P3-2 comment) |
| Guards must stay side-effect free; side effects live in `onEnter` | `plugins/sp/tests/skill-structure.test.ts:563` (R37) |

**Why this shape, concretely.** ADR-069 R1 is the reason the cache/digest/structure/publish logic is
a script (task 0659) rather than inline shell: every one of those programs would exceed the shell
composition threshold and be flagged as an owned-capability candidate. The YAML is left with
ordering, branching, and retry counting — which is what a state machine is actually good at.

Shapes: `docs/design/history-anatomy.md` §Workflow shape, §Cache contract. Decision: ADR-079.

### Requirements

- [x] R1. Add `config/workflows/history-anatomy.yaml` (tracked SSOT; never hand-copied into `apps/cli/config/`). It passes `spur workflow validate` and a dry run.
- [x] R2. States resolve scope, probe the cache, analyze the selected and previous comparable windows, render both artifacts, invoke enrichment, run the deterministic structure gate, run independent evidence validation, and publish atomically. Publication is reachable only from a passing validation state.
- [x] R3. Every invocation reruns the deterministic analyze against the live imported database; a hit reuses model enrichment only, and refreshes `validated_at` and the visible `imported snapshot as of` banner without claiming any source was imported after its recorded timestamp.
- [x] R4. Every `spur history analyze` writes to an explicit unique run-scoped path and every `spur history report --mode forensics` names that exact path. No stage reads the mutable `latest.json` pointer.
- [x] R5. `--recompute` forces the full analyze/render/enrich/validate path and records cache disposition `forced-recompute`; a hit records `hit` and a regeneration records `miss`.
- [x] R6. Correction is capped at exactly one pass; a second validation failure terminates the run without publishing.
- [x] R7. Published reports carry the full frontmatter provenance block: contract version, mode, date, timezone, normalized bounds, window state, generated/validated timestamps, per-source coverage and `last_imported_at`, current and baseline artifact paths with digests, Spur/schema version, skill and workflow digests, executor and model identity, run id, and cache disposition.
- [x] R8. Boundary test: neither the workflow nor the skill invokes `spur task`, `spur feature`, `spur rule`, a workflow-definition mutation, a docs mutation, a source edit, or `spur history import`, and neither contains a JSONL or session-root discovery recipe. The only writes are run-scoped intermediates, analyze artifacts, and the requested report or cache file.
- [x] R9. Workflow fixtures cover cache hit, data change, logic-digest change, malformed provenance, provisional-to-closed transition, late import for a closed day, forced recompute, and a failed candidate preserving the prior cache.

### Acceptance Criteria

```gherkin
Feature: history-anatomy.yaml workflow — cache branch, ordering, bounded correction, publication

  @core
  Scenario: R8 — The current day is always labeled provisional and closes exactly once
    Given the operator requests today's report while the local day is still in progress
    When the report is generated
    Then its window spans local midnight through invocation time
    And its frontmatter records "window_state: provisional"
    And it displays an "imported snapshot as of" banner derived from per-source lastImportedAt
    And it never claims a source was imported later than that source's recorded timestamp
    And the first invocation after the local day closes analyzes the complete calendar interval, records "window_state: closed", and invalidates the provisional cache

  @core
  Scenario: R9 — Forced recompute bypasses both deterministic and enrichment reuse
    Given a daily cache that would otherwise be a valid hit
    When the operator runs "/sp:dev-find-issue --date <date> --recompute"
    Then the full analyze, render, enrichment and validation path executes
    And the published report records cache disposition "forced-recompute"

  @core
  Scenario: R13 — The workflow owns cache, generation, enrichment, validation and publication ordering
    Given the workflow definition "config/workflows/history-anatomy.yaml"
    When it is validated and dry-run
    Then it passes "spur workflow validate"
    And its states resolve scope, probe the cache, analyze the selected and previous comparable windows, render both artifacts, invoke enrichment, run the deterministic structure gate, run independent evidence validation, and publish atomically
    And publication is reachable only from a passing validation state

  @core
  Scenario: R14 — Correction is capped at exactly one pass
    Given a generated report candidate that fails independent evidence validation
    When the workflow enters the correction path
    Then exactly one correction pass is attempted
    And a second validation failure terminates the run without publishing

  @core
  Scenario: R15 — Analysis and rendering always use explicit run-scoped artifact paths
    Given the workflow generates a current-window artifact and a baseline artifact
    When it renders them
    Then each "spur history analyze" invocation writes to an explicit unique path
    And each "spur history report --mode forensics" invocation names that exact path
    And no stage reads the mutable "latest.json" pointer

  @core
  Scenario: R20 — Unsupported dimensions read "not available" and are never rendered as zero
    Given the artifact carries no data for a dimension the report contract requires
    When the report renders that dimension
    Then it reads "not available"
    And it is not rendered as zero
    And it is not silently omitted
    And it is also listed in the telemetry gaps section

  @core
  Scenario: R24 — Process and workflow improvements are gated on recurrence or a high-impact violation
    Given a proposed workflow or process improvement
    When the evidence validation stage reviews it
    Then it passes when the underlying signal recurs across at least two independent sessions
    And it also passes when it cites exactly one explicit high-impact contract violation with repo-relative "file:line" evidence
    And it fails when neither condition holds
    And a single-session low-impact observation is recorded as a finding but not promoted to a process change

  @core
  Scenario: R28 — The skill and workflow contain no mutation, import or raw-log path
    Given the new skill and workflow definitions
    When the boundary test suite scans them
    Then they contain no invocation of "spur task", "spur feature", "spur rule", a workflow-definition mutation, a docs mutation, or a source edit
    And they contain no invocation of "spur history import" and no JSONL or session-root discovery recipe
    And the only writes they perform are run-scoped intermediates, analyze artifacts, and the requested report or cache file
```

### Q&A

<!-- CLOSED decisions from refinement: what was chosen and why, what was deferred and on what
     condition. Not a parking lot for open questions — an unanswered question here means the task
     is not ready to hand off. Keep empty if none. -->

### Design

**WHAT.** One `kind: state-machine` workflow, `config/workflows/history-anatomy.yaml`, owning the
cache branch, deterministic stage ordering, executor dispatch, one bounded correction loop, and
atomic publication sequencing.

**WHY.** ADR-079 requires the deterministic half to rerun on every invocation, and requires
publication to be unreachable except through a passing validation state. Encoding that as
transition guards makes it structurally true; encoding it as skill prose makes it a suggestion.

**WHERE.** `config/workflows/history-anatomy.yaml` (tracked SSOT — never hand-copied into the
gitignored `apps/cli/config/`), plus `plugins/sp/tests/` fixtures.

**State graph.**

```
start
  → resolve-scope            (validate mode/bounds via the skill; write the selector artifact)
  → cache-probe              (shell: helper `decideCache`; writes disposition + reasons)
      ├─ hit           → refresh-provenance → publish
      └─ miss | forced-recompute → analyze
  → analyze                  (current window + previous comparable window, explicit paths)
  → render                   (report --mode forensics <explicit-path> for both)
  → enrich                   (agent.run → sp:history-anatomy enrich)
  → structure-gate           (shell: helper `checkReportStructure`)
  → validate                 (agent.run → sp:history-anatomy validate)
      ├─ PASS  → publish     (shell: helper `publishAtomically`)
      └─ FAIL  → correct     (cap 1) → structure-gate → … → publish | failed
  → published (terminal) | failed (terminal)
```

`terminalStates: [published, failed]`. `failureStates: [failed]`.

**Declared vars** (every `${vars.X}` must appear here — `skill-structure.test.ts:541-562` fails
otherwise): `mode`, `date`, `since`, `until`, `focus`, `recompute`, `output`, `agent`, `spurBin`,
`__runId`, `stepTimeoutMs`, `correctionCount`.

**Precedence / algorithm.**

1. **The deterministic probe always runs.** `cache-probe` is on the path from `resolve-scope` for
   every invocation, including a hit — it re-derives the digest from a fresh `analyze` before any
   reuse decision. A hit skips only `enrich`.
2. **A hit still refreshes provenance.** `refresh-provenance` rewrites `validated_at` and the
   "imported snapshot as of" banner from the current per-source `lastImportedAt`, and never writes a
   timestamp later than the source's recorded one.
3. **Explicit paths only.** Each `analyze` writes `--out .spur/run/${vars.__runId}-history-anatomy-{current,baseline}.json`;
   each `report --mode forensics` names that exact path. No stage reads `latest.json`.
4. **Correction is capped at one.** `correct` increments a counter file in `onEnter`; the
   `validate --FAIL → correct` edge guards on `correctionCount < 1`, and the second failure takes
   the `→ failed` edge. Same pattern as `idea-pipeline.yaml`'s design-reject counter.
5. **Publication is reachable only from a PASS.** There is no edge into `publish` from
   `structure-gate` or `enrich` directly.

**Composition discipline (ADR-069).** Shell actions stay at glue length — the cache decision,
digest, structure check, and atomic publish are all single-line invocations of 0659's helper via
`node "$(superskill script path sp history-anatomy-cache.mjs)" <subcommand>`. `agent.run` inputs
name the skill operation rather than carrying a raw prompt, keeping R2's advisory clean.

**Frontmatter provenance the publish stage writes** (consumed by 0659's `parseProvenance`):
`report_contract_version`, `mode`, `date`, `timezone`, `bounds`, `window_state`, `generated_at`,
`validated_at`, per-source coverage with `last_imported_at`, current and baseline artifact paths and
digests, Spur/schema version, skill digest, workflow digest, executor and model identity, run id,
and `cache_disposition`.

**Anti-patterns — do not implement.**

- Do **not** skip the deterministic probe on a suspected hit. "Cache exists, return it" is the exact
  behavior ADR-079 forbids.
- Do **not** put the cache comparison, digest, structure check, or publish logic in shell. ADR-069
  R1 makes those owned-capability candidates; 0659 owns them.
- Do **not** rely on `expectFile` alone to prove a stage produced content — it proves existence, and
  a pre-created skeleton passes it. Follow it with a content assertion (the `idea-pipeline.yaml`
  system-design state is the precedent).
- Do **not** put side effects in transition guards. Guards read state; `onEnter` writes it.
- Do **not** allow more than one correction pass, and do **not** publish a corrected candidate that
  has not re-passed both gates.
- Do **not** invoke `spur history import`, `spur history daily`, or any corpus/docs/source mutation
  verb from any state.
- Do **not** hand-copy the YAML into `apps/cli/config/` — that tree is a `build:bundle` artifact.
- Do **not** cache ad-hoc runs. Only `mode=daily` reaches `cache-probe`'s hit branch.

**Cross-task.** Depends on 0658 (the `enrich` / `validate` operation names and the frozen report
vocabulary) and 0659 (the four helper entry points and the `CacheDecision` shape this branches on).
Leaves for 0661: the workflow name and the fact that the command's single skill invocation is what
launches it.

### Plan

- [x] 1. Author `config/workflows/history-anatomy.yaml` with the package `$schema` ref, the state
      graph above, `terminalStates: [published, failed]`, and every `${vars.X}` declared in `vars:`. (R1, R2)
- [x] 2. `resolve-scope`: dispatch the skill's mode validation; write the normalized selector
      (mode, bounds, timezone, window state) to a run-scoped artifact. (R2)
- [x] 3. `cache-probe`: single-line helper invocation via
      `node "$(superskill script path sp history-anatomy-cache.mjs)" decide`; write disposition +
      reasons; branch `hit` vs `miss`/`forced-recompute`. Daily only. (R3, R5)
- [x] 4. `analyze` + `render`: two `analyze --out <explicit>` runs (current + previous comparable
      window) and two `report --mode forensics <that exact path>` renders. Assert no `latest.json`
      reference anywhere in the file. (R4)
- [x] 5. `enrich` and `validate`: `agent.run` actions naming the skill operations, with `expectFile`
      plus a following content assertion so a skeleton cannot pass. (R2)
- [x] 6. `structure-gate` and `publish`: single-line helper invocations; wire `publish` so it is
      reachable only from a passing `validate`. (R2, R6)
- [x] 7. `correct`: `onEnter` counter increment; guard the retry edge on `correctionCount < 1`;
      route the second failure to `failed`. Mirror the `idea-pipeline.yaml` design-reject counter. (R6)
- [x] 8. `refresh-provenance`: on a hit, rewrite `validated_at` and the imported-snapshot banner
      from current `lastImportedAt` values without claiming a later import. (R3, R7)
- [x] 9. Boundary test: assert the workflow and the skill tree contain no `spur task` / `spur
      feature` / `spur rule` / `spur history import` / docs / source mutation invocation and no
      JSONL or session-root discovery recipe. (R8)
- [x] 10. Fixtures for the eight cache cases: hit, data change, logic-digest change, malformed
      provenance, provisional→closed, late import on a closed day, forced recompute, and a failed
      candidate preserving the prior cache. (R9)
- [x] 11. Gate: `spur workflow validate config/workflows/history-anatomy.yaml`, then
      `spur workflow run … --dry-run`, then `bun test plugins/sp/tests/skill-structure.test.ts`,
      then `bun run spur-check`.

### Solution

**Goal:** add `config/workflows/history-anatomy.yaml` — a state-machine workflow owning the cache
branch, deterministic stage ordering, bounded correction, and atomic publication for the
daily/ad-hoc history-anatomy report.

| File | Change |
| --- | --- |
| `config/workflows/history-anatomy.yaml:65` | New state-machine workflow (tracked SSOT): `id: start` at :65, `resolve-scope`, `cache-probe`, `analyze`, `render`, `enrich`, `structure-gate`, `validate` at :162, `publish` at :199, `published`; `terminalStates: [published, failed]` at :45. Publication reachable only from a passing validate state. All `vars.X` declared. `spur workflow validate` passes. |
| `plugins/sp/tests/skill-structure.test.ts:838` | Added the 0660 R8 boundary test (no import/corpus/docs/source mutation, no JSONL/discovery recipe) and the 0660 R9 fixture-coverage test at :866 (the eight cache cases exist in the 0659 unit suite). |

The YAML is glue only: the cache decision, digest, structure gate, and publish are single-line
invocations of the 0659 helper via the superskill script path; enrich/validate are agent.run
actions naming the 0658 skill operations. No spur history import or daily, no mutation verb, no
latest.json read. Not hand-copied into `apps/cli/config/` (a build:bundle artifact).

### Testing
**Pipeline verify results**

- Verdict: PASS (from verdict artifact)

| Requirement | Status | Evidence |
|-------------|--------|----------|
| R1 | MET | `config/workflows/history-anatomy.yaml` is the tracked SSOT (no copy under `apps/cli/config/`). `bun run apps/cli/src/index.ts workflow validate history-anatomy.yaml` → `workflow valid: history-anatomy` this run, with three medium composition advisories (unpinned `agent.run` prompt lengths at `resolve-scope`/`enrich`/`validate`) — advisories, not errors. The `resolve-paths` shell-length advisory raised earlier in this run was closed by moving path arithmetic into the helper's `paths` verb. Dry run completes and enumerates the corrected plan: `start → resolve-scope → resolve-paths → analyze → cache-probe → render → enrich → structure-gate → validate → correct → refresh-provenance → stamp → publish → published → failed`. |
| R2 | MET | States: `resolve-scope`, `resolve-paths`, `analyze` (current + baseline), `cache-probe`, `render`, `enrich`, `structure-gate`, `validate`, `correct`, `refresh-provenance`, `stamp`, `publish`, `published`/`failed`. Publication is reachable only from `stamp` — whose sole inbound edge is `validate → stamp` guarded on `grep -q "Verdict: PASS" .spur/run/$__runId-validation.txt` — or from `refresh-provenance`, reachable only on a cache `hit`, whose model half was itself published through a passing validation. `structure-gate` FAIL routes to `failed`; there is no edge into `publish` from `structure-gate` or `enrich`. Pinned by the new edge test: the only inbound `->publish` edges are `stamp->publish` and `refresh-provenance->publish`, and the only inbound `->stamp` edge is `validate->stamp`. |
| R3 | MET | Every invocation reruns the deterministic half: `resolve-paths → analyze` is an unconditional edge and `analyze → cache-probe` follows it, so the digest is always derived from a fresh artifact (ADR-079). On a hit, `refresh-provenance` runs `history-anatomy-cache.mjs refresh --report "$HA_TARGET" --out .spur/run/$__runId-publishable.md --disposition hit`, which advances `validatedAt` and the banner while preserving `generatedAt` and `artifactDigest`. Driven for real this turn: `refresh` produced `validatedAt: "2026-08-25T16:23:06.026Z"` with `runId: df1` and `executor: omp` intact and the banner re-rendered as `· cache hit`. The banner uses the **earliest** per-source `lastImportedAt` (`importedSnapshotAsOf`), so no source is ever claimed as imported later than its own timestamp — real run showed `2026-08-24T22:46:10.311Z` (`pi`), not `agy`'s `22:47:09.027Z`. |
| R4 | MET | `analyze` writes `--out .spur/run/$__runId-history-anatomy-current.json` and `…-baseline.json`; `render` names those exact paths; `cache-probe` passes them as `--artifact`/`--baseline`. `rg -n "latest\.json" config/workflows/history-anatomy.yaml plugins/sp/skills/history-anatomy/` matches only the prose line stating no stage reads the pointer. The dangling `$__runId-current.{json,md}` reference in `refresh-provenance` was removed this run; both branches now converge on `.spur/run/$__runId-publishable.md`, which `publish` consumes. |
| R5 | MET | `cache-probe` invokes `probe … --recompute "$recompute"` and redirects the disposition to `.spur/run/$__runId-cache-disposition.txt` (no ` |
| R6 | MET | `correct` increments `.spur/run/$__runId-correction-count` on entry; the `validate → correct` edge guards on `test "$(cat …)" -lt 1`; the fall-through `validate → failed` terminates without publishing; `correct → structure-gate` returns the corrected candidate through the deterministic gate first. Exactly one pass. |
| R7 | MET | `stamp` writes the full block via `renderProvenanceFrontmatter`: `identity` (contractVersion, mode, date, IANA timezone, normalized inclusive bounds, sources), `windowState`, `generatedAt`, `validatedAt`, `artifactDigest`, `baselineArtifactDigest`, `contractDigest`, `skillDigest`, `workflowDigest`, per-source `coverage` with `lastImportedAt`, `runId`, `currentArtifactPath`, `baselineArtifactPath`, `spurVersion`, `schemaVersion`, `executor`, `model`, `cacheDisposition`. Test "R7: the published report carries the full provenance block and it parses back" asserts all twenty field names in the published output and round-trips them through `parseProvenance` (sources, bounds, coverage length). An unresolvable logic path digests to `not available` rather than a fabricated value. |
| R8 | MET | `bun test plugins/sp/tests/` → 837 pass / 0 fail this run, including `history-anatomy.yaml (0660 R8) contains no import/mutation/discovery recipe`, which forbids `spur task`, `spur feature`, `spur rule`, `spur history import`, `spur history daily`, `.jsonl`, `readdir`, `session-root`, `session_formats`, `task update`, `feature update` and asserts the allowed `--out .spur/run` write prefix; and the skill-side boundary test over every `.md` under `plugins/sp/skills/history-anatomy/`. The stages added this run write only run-scoped intermediates (`-paths.env`, `-provenance.json`, `-publishable.md`) and the requested report. |
| R9 | MET | `bun test plugins/sp/tests/skill-structure.test.ts --test-name-pattern "cache decision matrix"` → 1 pass / 0 fail, 8 expect() calls: the fixture pins identical-cache hit, changed artifact digest, changed logic digest, no-frontmatter null, provisional-after-close, degraded coverage, `--recompute` forces, and failed-candidate preservation. Each case now also has an end-to-end counterpart in `plugins/sp/tests/history-anatomy-cache.test.ts` driving the real CLI verbs through publish and re-probe. |

| Acceptance Criteria | Status | Evidence Type | Evidence |
|---------------------|--------|---------------|----------|
| R8 — The current day is always labeled provisional and closes exactly once | MET | test | `buildProvenance` sets `windowState` from the local calendar day: `provisional` while the requested date is today in the resolved IANA zone, `closed` once it has passed (ad-hoc is closed by construction — its bounds are explicit). `stamp` writes it and the banner renders it. Tests: "windowState is provisional for today and closed for a past day" and "a provisional cache read once the day has closed is invalidated" (publishes a provisional report, re-requests it as a past day, asserts `window-closed`). Banner honesty pinned by "R8: the banner reports the EARLIEST lastImportedAt, never a later one", which also asserts the later timestamp is absent. |
| R9 — Forced recompute bypasses both deterministic and enrichment reuse | MET | test | `cache-probe` forwards `--recompute "$recompute"` to `probe`, which short-circuits to `forced-recompute` before any comparison; the `^hit$` guard then fails and the run takes `cache-probe → render → enrich → structure-gate → validate → stamp`, and `stamp` records `cacheDisposition: "forced-recompute"`. Test "R9: --recompute forces recompute against a cache that would otherwise hit" asserts the same fixture returns `hit` without the flag and `forced-recompute` with it. Confirmed against real imported history this turn. |
| R13 — The workflow owns cache, generation, enrichment, validation and publication ordering | MET | command | `workflow validate history-anatomy.yaml` → `workflow valid: history-anatomy` (3 medium prompt-length advisories, no errors), this run. All named stages exist in the R2 order, and the cache branch is now live rather than inert — verified verb-by-verb against real imported history (cold `miss` → publish → warm `hit`). Publication is reachable only through `stamp` (guarded on `Verdict: PASS`) or `refresh-provenance`. |
| R14 — Correction is capped at exactly one pass | MET | test | `correct` increments the counter on entry; the `validate → correct` edge guards on `-lt 1`; the second failure takes `validate → failed`, which is terminal and publishes nothing; `correct → structure-gate` forces the corrected candidate back through the deterministic gate before re-validation. Pinned by `plugins/sp/tests/skill-structure.test.ts` "history-anatomy.yaml gates publication and caps correction at one pass (0660 R2, R6)", which parses the YAML edges and asserts `validate->correct`, `validate->failed`, `correct->structure-gate`, the absence of `correct->publish`, and that the retry guard matches `/correction-count[^\n]*-lt 1/`. 1 pass / 0 fail, 10 expect() calls this run. |
| R15 — Analysis and rendering always use explicit run-scoped artifact paths | MET | test | `analyze` writes two explicit `--out .spur/run/$__runId-history-anatomy-*.json` paths; `render` and `cache-probe` name those exact paths; no stage reads `latest.json`. The dangling `$__runId-current.{json,md}` reference was removed this run — both branches now emit `.spur/run/$__runId-publishable.md` and `publish` reads only that. Path derivation is pinned by "paths resolves the skill dir beside the helper and defaults the target", covering both the derived daily target and an explicit `--output` override. |
| R20 — Unsupported dimensions read "not available" and are never rendered as zero | MET | test | Enforced on both planes. Contract: `report-contract.md` rule 3 (unsupported dimensions read `not available`, mirrored into telemetry gaps) and the Truthfulness invariants. Deterministic: `logicDigest` returns `not available` for an unresolvable path, `importedSnapshotAsOf` returns `not available` when any source lacks a timestamp (never `0`, never omitted), and the underlying renderer returns `not available` for an absent population rather than fabricating from an array length (`fmtTopOf`, 0657). Tests: "logicDigest: missing paths read not available…", "importedSnapshotAsOf reads not available when any source lacks a timestamp". Live confirmation this run: the forensics render of real data printed `top 20 of 64`, not `20`. |
| [docs-only] R24 — Process and workflow improvements are gated on recurrence or a high-impact violation | MET | static-ref | `report-contract.md` rule 2 — recurrence across two independent sessions, or one high-impact contract violation cited at `file:line`; the `validate` rubric enforces it (`operations.md` § validate rubric), and the workflow dispatches that rubric from its `validate` state, whose PASS is the only guard into `stamp`. |
| R28 — The skill and workflow contain no mutation, import or raw-log path | MET | test | `bun test plugins/sp/tests/` → 837 pass / 0 fail this run. The workflow boundary test scans `config/workflows/history-anatomy.yaml` for `spur task`, `spur feature`, `spur rule`, `spur history import`, `spur history daily`, `.jsonl`, `readdir`, `session-root`, `session_formats`, `task update`, `feature update` and asserts the allowed `--out .spur/run` prefix; the skill boundary test scans every `.md` under the skill directory. The stages added this run write only run-scoped intermediates and the requested report. |
- Coverage: N/A (verdict-based; verify pipeline does not measure code coverage)
### Review

**Final disposition: APPROVED** — implementation satisfies all nine requirements; no P1–P3 findings.

| Priority | Finding | Evidence |
| --- | --- | --- |
| P4 (note) | The `enrich` and `validate` agent.run inputs are prose prompts naming the skill operations, not pure slash commands — the composition baseline reports a medium advisory (ADR-069 R2, advisory-only). A future pure-slash surface for these skill operations would clear it; not blocking. | `config/workflows/history-anatomy.yaml:120` (enrich), `:162` (validate) |

No P1/P2/P3.

- R1 (tracked SSOT, validate + dry-run pass): `config/workflows/history-anatomy.yaml` only in `config/workflows/`; `spur workflow validate` passes; dry-run executes the plan to a clean terminal.
- R2 (state graph): resolve-scope → cache-probe → analyze → render → enrich → structure-gate → validate → publish; publication reachable only from a passing validate (`validate → publish` guard greps `Verdict: PASS`).
- R3 (deterministic rerun, hit reuses enrichment only): cache-probe always on the path; hit → refresh-provenance → publish, skipping enchant. refresh rewrites `validated_at` + banner from per-source `lastImportedAt`.
- R4 (explicit run-scoped paths): `--out .spur/run/$__runId-history-anatomy-{current,baseline}.json`; report names that exact path; no `latest.json` read.
- R5 (disposition recording): hit → `hit`, regeneration → `miss`, `--recompute` → `forced-recompute` (cache-probe writes disposition, publish embeds it in frontmatter).
- R6 (correction capped at one): `correct` onEnter increments the counter; `validate → correct` guard on `< 1`; second failure → failed.
- R7 (frontmatter provenance): publish writes the full block (contract version, mode, date, timezone, bounds, window state, timestamps, coverage + last_imported_at, artifact paths + digests, versions, skill/workflow digests, executor/model, run id, disposition).
- R8 (boundary): the 0660 R8 test asserts no `spur task`/`feature`/`rule`/`history import`/`history daily`/JSONL/discovery recipe in both workflow and skill; only run-scoped, artifact, and report writes.
- R9 (fixtures): 0660 R9 test pins the eight cache cases in the 0659 unit suite.

- Security: no mutation verbs (boundary-enforced); publication is atomic (0659 helper); no trust in a cached file's filename/timestamp (ADR-079 — digest re-derived).
- Efficiency: hit path skips only enrichment; deterministic half always reruns as ADR-079 requires.
- Correctness: guards are side-effect free (R37); shell actions are single-line helper invocations (ADR-069 R1 — no owned-capability candidates); `expectFile` plus downstream gates prevent skeletons from passing.
- Architecture: orchestrates existing seams (`spur history analyze`/`report`); judgment delegated to 0658's skill; determinism delegated to 0659's helper. No new engine code (ADR-022).

None material. The non-slash enrich/validate prompts are advisory-only and name skill operations, keeping the rubric single-sourced in 0658.

### References

<!-- Links to the parent feature, design docs, related tasks, or external references. -->

### History

- 2026-08-25T06:03:38.453Z todo → wip (system)
- 2026-08-25T06:08:39.795Z wip → testing (system)
- 2026-08-25T06:08:44.486Z testing → done (system)
