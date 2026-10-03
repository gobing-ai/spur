---
schema_version: 1
name: Make agent-driven corpus writes cwd-deterministic across pipeline surfaces
status: done
template: issue
created_at: 2026-10-02T22:50:39.301Z
updated_at: "2026-10-03T01:55:50.890Z"

feature_id: D63
ac_altitude: task-local
priority: P2
ac_numbering: task-local
estimate_hours: 3
done_forced: "false"
done_reason: unforced close; PASS artifact at /Users/robin/xprojects/spur-new-runall-d63-2ebbd97c/.spur/memory/evidence/1058-verdict.json
---

## 1058. Make agent-driven corpus writes cwd-deterministic across pipeline surfaces

### Background

During inline pipeline run `95522d21` (task 1057) the shell working directory drifted between tool calls three times, silently landing corpus writes (`feature update` AC rewrite, `task update` AC rewrite) in the invoking tree instead of the run worktree; each required manual spill-revert. Root cause: commands assumed an inherited cwd — undefined input for agent-driven shells, where every bash call may start in an arbitrary directory. Blast radius is any CLI that resolves the corpus from `process.cwd()`: silent wrong-tree writes with no error. Fix layers: pin the tree explicitly at the tool layer, fail fast when the pin mismatches, and codify the protocol where pipeline drivers are defined.

**Refine corrections (2026-10-02)**

The 45 process.cwd() sites were asserted to be corpus defects → the composition root already supplies context.cwd and the inspected task/feature transports use that context; shell-runner also binds context.workdir → drop the bulk migration and new --cwd flag. The reported host calls omitted an execution-tree pin → own a host-driver command protocol, not an engine patch. A PWD assertion alone cannot select a tree → cd first, then verify physical path and repository identity. Platform-specific pi limitations are unverified in this checkout → remove the upstream issue deliverable. Existing D63 binding is retained.

The corrected Requirements, Design and Plan below supersede the historical proposals above; incident narrative is preserved for provenance.

### Requirements

- [x] R1. Make each host-session corpus command select the confirmed absolute execution tree within the same tool call, independently of earlier calls, in inline-pipeline-driver.md. Pin reads, writes, absolute section-input files and output artifacts; fail before writing when the selected tree or expected Git identity is wrong.
- [x] R2. Apply the same protocol at execution-batch.md host command boundaries, including the deliberate change from execution tree to invoking tree at WT-4. Consume the already-confirmed WT-3 path/branch identity; leave integration safety and marker ordering to 1059.
- [x] R3. Provide a repeatable two-tree subprocess proof using the real source CLI and scratch task corpus: a call starting in the wrong tree updates only the explicitly selected tree; a missing/wrong identity aborts without changing either corpus. Source and installed invocation examples use their existing resolved command, with quoted paths containing spaces.

Out of scope: runtime engine changes, new public APIs, unrelated fixes from 1053–1056, production operations or external publication.

### Acceptance Criteria

```gherkin
Scenario: AC1 — Host writes select the execution tree (req: R1)
  Given two scratch trees and an intentionally stale host cwd
  When the documented pinned real CLI command edits a section
  Then only the selected task changes and its new section is returned by a pinned JSON read

Scenario: AC2 — Batch boundaries select the intended tree (req: R2)
  Given a batch with distinct execution and invoking trees
  When host examples cross from execution to WT-4
  Then each call explicitly pins its intended tree and delegates FF and marker policy to 1059

Scenario: AC3 — Wrong identities fail before writing (req: R3)
  Given a missing tree or mismatched repository branch and paths containing spaces
  When the subprocess canary runs
  Then the command fails nonzero and both original corpus hashes remain unchanged with a repeatable artifact
```

### Q&A

<!-- Clarifications and triage decisions. Keep empty if none. -->

#### Q&A entry — 2026-10-02T22:57:00.898Z

- Q: Flag name — `--cwd` vs `--project`? A: `--cwd` — matches `MainOptions.cwd` (`index.ts:56`), no new vocabulary; `--project` implies profile selection, not tree pinning.
- Q: Why exit 91 for the tree assert? A: Distinct, greppable code far from CLI exit conventions (0/1/2); a loud wrong-tree abort beats a silent write; drivers can detect it distinctly.
- Q: Why is 1058 unbound to a feature (DD-07 WARN accepted)? A: Scope spans CLI + workflows + upstream pi; binding to a mismatched feature imports DD-09 subset pressure. Bind during refine or wrap into a feature via /sp:dev-idea when scheduled.
- Q: Why skip-ready? A: Backlog capture per operator request; model-ready refinement deferred to /sp:dev-refine 1058.
- Q: Why replace wholesale instead of --append for these sections? A: Dogfood note — 1057 shipped `--append` for extend-mode; initial authoring of empty template sections is replace semantics by design.

#### Q&A entry — 2026-10-02T23:26:50.081Z

#### Q&A entry — feature binding (2026-10-02)

- Q: Which feature owns 1058 now that it is scheduled? A: **D63 (Reliable and measured daily-workflow adoption)**. Same origin inline run `95522d21` as sibling task 1057 (already D63); D63's scope covers the supporting CLI transports and wrapup/pipeline completion-reliability integration this task hardens (`--cwd` pinning, task-pipeline/wrapup-pipeline protocol, inline-pipeline-driver).
- Q: Why not D3? A: D3 is deliberately scoped to three reproduced `workflow run` engine defects (0431–0433); corpus-write cwd determinism is not one of them.
- Q: What about the earlier DD-09 subset-pressure concern? A: Resolved with `--ac-altitude task-local` — 1058's ACs are task-local hardening (CLI flag, driver protocol, regression test, upstream note), intentionally not D63 feature ship criteria. `spur task check 1058` passes with zero findings.

#### Q&A entry — 2026-10-02T23:58:04.745Z

Closed: use native per-call cwd/subshell pinning, no public --cwd option or ADR expansion. The incident demonstrates a missing host pin, not a proven defect in every process.cwd() call. Closed: workflow YAML and upstream pi changes are outside this task. Closed: 1058 is command targeting; 1059 is integration transaction ordering. Implementation must not reopen the merged 1053–1056 scope.

### Design

No new API, flag, dependency or workflow YAML change. Primary owners: plugins/sp/skills/spur-dev/references/inline-pipeline-driver.md and execution-batch.md. Reuse confirmed execution-tree path, branch and resolved Spur invocation from bootstrap/WT-3. Every host shell call uses a self-contained subshell: change directory with `cd --` to the quoted absolute tree, obtain `pwd -P`, compare to the recorded physical tree, verify Git top-level and expected branch, then execute the already-resolved CLI command. A native tool cwd option may additionally pin the call, but does not replace identity checks. Pin task/feature show as well as update; validate returned filePath belongs to the expected configured corpus/tree (including intentional configured locations), and verify the requested section through a fresh pinned task show JSON response. Do not use a heading-only grep as proof of section contents. Resolve section input/output paths before changing tree. Reject a failed cd/identity check with a nonzero exit and a named expected/actual tree; no magic exit-91 contract. Engine shell actions already use context.workdir (packages/app/src/workflow/actions/shell.ts:98); leave them alone. Keep the existing bootstrap instruction but replace its reliance on persistent cd with per-call pinning. 1059 exclusively owns FF ancestry, marker and cleanup sequencing. No helper framework or service-wide process.chdir.

### Plan

1. Recheck clean task tree and current owners. Write the scratch subprocess canary first in plugins/sp/tests/dogfood-testing/execution-batch-contract.test.ts or an existing driver-contract test; exercise actual CLI task update with explicit fixture configuration, not a mock write function. Save JSON and before/after hashes in .spur/run/1058-cwd-proof/.
2. Update inline-pipeline-driver.md bootstrap and all affected host corpus command examples with the per-call pin and identity check (R1).
3. Update execution-batch.md host boundaries by reference to the canonical protocol; explicitly select invoking tree at WT-4 without implementing 1059 sequencing (R2).
4. Run the two-tree proof with paths containing spaces, stale initial cwd, missing directory and wrong branch (R3); assert selected file contents and unchanged other-tree hashes. Run affected plugin contract tests, plugin-smoke and task-local spur-check; check task 1058 as done only after implementation evidence exists. Use Superskill dry-run for installed adapter projection, not hand edits or an unsolicited installation.

### Root Cause

The reported host commands assumed a prior shell call had left the next call in the run worktree. Current CLI context and engine shell actions already carry cwd/workdir; no general corpus-service cwd defect was reproduced. The missing host per-call execution-tree pin is the bounded root cause addressed by this task.

### Solution

**R1 — Host writes select the execution tree** (`plugins/sp/skills/spur-dev/references/inline-pipeline-driver.md`):

- `:221` — new section `## Per-call execution-tree pin (task 1058)`: canonical pin subshell template (`cd --` to the quoted tree → `pwd -P` → `git rev-parse --show-toplevel` → `git branch --show-current` → `exec <resolved-spur-invocation> …`); rules: pin reads as well as writes, validate the returned `filePath` against the configured corpus, prove sections with a fresh pinned `task show --json` (heading-only grep is not proof), resolve section input/output paths before changing tree, fail closed nonzero naming expected/actual **before the CLI runs** (no designated exit code; Q&A 2026-10-02), native tool cwd options additive only, host-only scope (`packages/app/src/workflow/actions/shell.ts:98` engine binding untouched), dispatched subagents re-pin every shell call from the dispatch payload identity. No new flag, API, or helper framework.
- `:145` — Run setup step 7: bootstrap `cd` confirms the tree once; every later call re-selects it (a host shell carries no cwd between calls). `:225` blanket rule: all `spur …` examples in the driver (workflow inventory, run-link, fingerprint, record/done) abbreviate the pinned subshell form.
- `:459` — dispatch payload field 4: delegates re-pin with the supplied invocation/identity, never re-derive.
- `:362` — fingerprint capture runs inside a per-call pin subshell (cwd feeds the git-tree digest half).
- `:706` — record/done sequencing: both hops per-call pinned.

**R2 — Batch boundaries select the intended tree** (`plugins/sp/skills/spur-dev/references/execution-batch.md`):

- `:629` — Worktree isolation intro: "process cwd" is a bootstrap convenience, never a carried guarantee; every host command boundary (corpus reads/writes, WT-3b commit, WT-4 merge/evidence, WT-4a persist-out) re-selects its tree in-call via the canonical protocol; identity is consumed from the WT-3 marker (`path` + `branch`), not re-derived; WT-4's invoking-tree selection is the one deliberate tree change; FF ancestry, marker and cleanup sequencing remain owned by 1059.
- `:854` — WT-3b commit block rewritten as a pinned subshell (`cd --` + branch check on `$BRANCH`; no persistent `cd`, no trailing `cd -`).
- `:882` — WT-4 create-mode comment: every terminal merge command explicitly pins the **invoking** tree.
- `:782` — "`spur` on PATH" example: run via pin subshell instead of relying on a persistent `cd`.

**R3 — Wrong identities fail before writing** (`plugins/sp/tests/dogfood-testing/execution-batch-contract.test.ts`):

- `:277` — spec pins: both docs carry the protocol elements; WT-4 selects the invoking tree; 1059 ownership; `exit 91` absent.
- `:360` — two-tree subprocess canary against the real source CLI: scratch git trees (selected path contains spaces), pinned write from a stale cwd updates only the selected task file, pinned `show --json` returns `filePath` inside the selected tree with the new body, missing-tree and wrong-branch cases abort nonzero with named expected/actual and both corpora hashes unchanged; writes repeatable proof JSON on every run.

Proof artifacts (repeatable, gitignored): `.spur/run/1058-cwd-proof/canary-ac1-pinned-write.json`, `.spur/run/1058-cwd-proof/canary-ac3-negative.json`.

Validation: execution-batch/startup/dispatch-handoff/command-flag-parity/task-diffstat contract tests 181 pass; scripts/commands inline-execution + parity-check tests 25 pass; `inline-pipeline-parity-check.ts` ok (11 actions, 4 guards, 0 spurious edges); `bun run plugin-smoke` PASS; `superskill install sp --dry-run` clean (40 skills detected, nothing written).

Deviations: none beyond deferring Plan step 4 (checking this task done) — the delegation forbids status/lifecycle writes; the pipeline owns transitions. No workflow YAML, no engine code, no public surface changes; 1053–1056 untouched.

### Testing

**Pipeline verify results**

- Verdict: PASS (from verdict artifact)

| Requirement | Status | Evidence |
|-------------|--------|----------|
| R1 | MET | R1 — Host writes select the execution tree: `plugins/sp/skills/spur-dev/references/inline-pipeline-driver.md:221` new canonical section `## Per-call execution-tree pin (task 1058)`: template at `:231-245` (`cd -- "$SPUR_TREE"` → `pwd -P` → `git rev-parse --show-toplevel` → `git branch --show-current` → `exec` resolved invocation, all quoted paths); rules pin **reads** (`:247-249`), validate returned `filePath` against the configured folder set (`:250-254`), prove sections via fresh pinned `task show --json`, not heading-grep (`:255-257`), resolve section input/output paths before `cd` (`:258-260`), fail closed nonzero naming expected/actual **before the CLI runs**, explicitly no designated exit code (`:261-264`), native cwd options additive only (`:265-266`), host-only scope (`:267-270`). Applied at bootstrap step 7 (`:144-148`), blanket abbreviation rule (`:272-276`), fingerprint capture (`:362-363`), dispatch payload field 4 (`:459-461`), record/done hops (`:706-708`). Engine untouched, confirmed at source: `packages/app/src/workflow/actions/shell.ts:98` = `const cwd = stringOption(options, 'cwd', context.workdir);`. Diff contains no engine, workflow-YAML, flag, or API change. |
| R2 | MET | R2 — Batch boundaries select the intended tree: `plugins/sp/skills/spur-dev/references/execution-batch.md:629-642` — every host command boundary (corpus reads/writes, WT-3b commit, WT-4 merge/evidence, WT-4a persist-out) re-selects its tree in-call via the canonical protocol by reference; identity **consumed** from the WT-3 marker `path` + `branch`, not re-derived (`:639-640`); WT-4's invoking-tree selection is the one deliberate tree change (`:637-639`); "FF ancestry, marker and cleanup sequencing remain owned by 1059" (`:640-641`). Concrete forms: WT-3b rewritten as a real pinned subshell — `cd --` + branch check on `$BRANCH`, no persistent `cd`, no trailing `cd -` (`:854-870`); WT-4 create-mode comment pins the INVOKING tree (`:882-886`, narrative — see residual); `spur`-on-PATH example re-run via pin subshell (`:782-785`). Spec-pinned in `plugins/sp/tests/dogfood-testing/execution-batch-contract.test.ts:301-309`. 1059 integration surface left alone as required. |
| R3 | MET | R3 — Wrong identities fail before writing: `plugins/sp/tests/dogfood-testing/execution-batch-contract.test.ts:281-309` spec pins (both docs carry protocol elements; WT-4 selects the **invoking** tree; 1059 ownership; `exit 91` negatively asserted at `:296` — grep confirms `exit 91` appears in neither reference doc). `:313-497` two-tree subprocess canary against the **real source CLI** (`process.execPath` + `apps/cli/src/index.ts`): scratch git trees seeded via `git init -b` (`:351-364`), selected tree path contains spaces (`spur exec tree a`, `:377`), write executed from a stale cwd (tree-b) via `runPinned` (`:384-394`, `:404-409`), fresh pinned `show --json` asserts `filePath` inside the selected tree and the new body while the seed body is gone (`:411-419`), sha256 hashes prove only the selected corpus changed (`:421-424`), missing-tree/wrong-branch abort nonzero with named expected/actual and both corpora unchanged (`:426-436`, `:437-442`), repeatable proof JSON written every run (`:444-492`). |

| Acceptance Criteria | Status | Evidence Type | Evidence |
|---------------------|--------|---------------|----------|
| AC1 — Host writes select the execution tree (req: R1) | MET | test | Canary (`plugins/sp/tests/dogfood-testing/execution-batch-contract.test.ts:404-424`): pinned `task update 1100 --section Background --from-file` from stale cwd in tree-b → exit 0; pinned `task show --json` returns `filePath` inside spaced tree-a with the new body (seed body absent); treeA hash `bc3ede64…→3722ee99…`, treeB unchanged. Artifact `.spur/run/1058-cwd-proof/canary-ac1-pinned-write.json` (real CLI run) shows exactly this: `updateEnvelope.ref.filePath/folder` inside `"…/spur exec tree a/docs/tasks"`, `pinnedShow.content` contains "Pinned canary body — written from an intentionally stale cwd.", hash deltas as above. |
| AC2 — Batch boundaries select the intended tree (req: R2) | MET | test | `plugins/sp/tests/dogfood-testing/execution-batch-contract.test.ts:301-309` (whitespace-collapsed containment: `Per-call tree pinning (task 1058)`, `canonical per-call pin protocol`, `select the **invoking** tree`, 1059 ownership, WT-3b `cd -- "../<worktree-dir>"`); doc evidence `plugins/sp/skills/spur-dev/references/execution-batch.md:629-642`, `:782-785`, `:854-870`, `:882-886`. Note: AC2's evidence is static containment of the doc contract, not a subprocess proof of the WT-3b/WT-4 forms — appropriate for a doc deliverable, flagged as residual. |
| AC3 — Wrong identities fail before writing (req: R3) | MET | test | Canary negatives (`plugins/sp/tests/dogfood-testing/execution-batch-contract.test.ts:426-442`): missing tree (`missing tree`, spaced) → nonzero + `tree missing: expected …`; wrong branch → nonzero + `branch mismatch: expected sp/canary-alpha, got sp/canary-beta`; `afterNegative` equals post-AC1 state for treeA and seed for treeB. Artifact `.spur/run/1058-cwd-proof/canary-ac3-negative.json`: both cases `exitCode: 1` with those exact stderr strings, `bothCorporaUnchanged: true`, hash chains cross-consistent with the AC1 artifact (before `bc3ede64…` both trees; afterNegative treeA `3722ee99…` = AC1's post-write state — i.e., the failing calls changed nothing). |
- Coverage: N/A (verdict-based; verify pipeline does not measure code coverage)

### Review

<!-- spur:record-review -->

**SECU findings** (pipeline verify step — verdict: PASS)

| Priority | Dimension | Location | Finding |
|----------|-----------|----------|----------|
| P4 | — | — | No findings (verify verdict PASS) |

### References

apps/cli/src/index.ts:56; apps/cli/src/context.ts:132; apps/cli/src/commands/task.ts:251; packages/app/src/workflow/actions/shell.ts:98; plugins/sp/skills/spur-dev/references/inline-pipeline-driver.md:142; execution-batch.md WT-3/WT-4. Historical run 95522d21 remains reported incident evidence; live validation of pi tool schema is not available and is not a fix premise.

Audit: HEAD 8467f6f6d; only the main worktree was registered; `task list --status wip --json` returned []; active todo titles reviewed for duplicate ownership. Recheck before delegation. No implementation dependencies. 1058 and 1059 share execution-batch.md: serialize their writes or use isolated worktrees and review integration.

### History

- 2026-10-03T01:04:36.947Z todo → wip (system)
- 2026-10-03T01:53:04.997Z wip → testing (system)
- 2026-10-03T01:55:50.885Z testing → done (system)

