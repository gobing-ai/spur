---
schema_version: 1
name: Fix harness reliability findings from 0815 session review
status: done
template: issue
created_at: 2026-09-09T20:10:01.996Z
updated_at: "2026-09-10T05:30:26.777Z"

feature_id: D6
ac_altitude: task-local
ac_numbering: task-local
priority: P2
---

## 0818. Fix harness reliability findings from 0815 session review

### Background

Consolidated implementation specification for the session-review findings originally filed as 0818, 0819 and 0820. This task supersedes both removed tasks; it retains WBS 0818 and its original creation metadata. The original filename/title remains stable because the CLI has no rename operation. Scope: source-local test execution, review/verify handoff contracts, proof-input diagnostics, and task-local AC guidance.

The reports are hypotheses, not verified implementation evidence. Current source was inspected at `58cc87e27a47b4b9c659f79b8342827375d91751` on 2026-09-09. The Q&A disposition table accounts for every original requirement. No implementation or completion verdict is claimed by this consolidation.

This is a D6 harness follow-up, following predecessor 0817. Its regression scenarios intentionally sit below feature ship criteria: `ac_altitude: task-local`; `ac_numbering: task-local` independently enforces Requirements-to-AC coverage. These settings do not waive readiness, evidence, or completion gates.

### Requirements

- [x] **R1 — Restore the missing source-local test launcher (P2).** Supply the executable `scripts/test-shims/spur` expected by `tests/setup.ts`, using the checkout's `apps/cli/src/index.ts`. Resolve that entry relative to the launcher, quote paths/arguments, preserve the caller's cwd, propagate exit status, and commit executable mode. Do not depend on a prior bundle or the global Spur version. Retain the existing test-config skip precedence. Add a real child-process regression with a sentinel global `spur` later on PATH, a working directory different from the checkout root, and a checkout path containing spaces; prove the local entry runs, the sentinel does not, and cwd/arguments/status survive. Amend the inaccurate 0815 closure claim through `spur task update` after the fix is verified; append a dated correction to existing local buglog evidence if present, without deleting historical observations.

- [x] **R2 — Make delegated execution provenance and verify artifacts explicit (P2).** Update the native dispatch contract in `plugins/sp/skills/spur-dev/references/inline-pipeline-driver.md` to include the confirmed execution-tree cwd, the resolved absolute Spur invocation, the resolved output path, and the owning stage's artifact contract. Preserve the exact slash command and no-recursive-dispatch rule. Replace the conflicting "Send only" restriction deliberately. Delegates must use the supplied invocation for Spur commands; do not claim that `SPUR_BIN` alone changes bare-command resolution. Reuse the existing `resolveSpurBin`/`vars.spurBin`/plugin `--spur-bin` mechanisms for Spur-owned scripted calls. Verify handoffs must name the canonical answer-schema reference and carry this compact contract: top-level `Verdict: PASS|PARTIAL|FAIL`; requirement rows `MET|PARTIAL|UNMET`; AC rows additionally allow justified `N/A`; canonical evidence types `test|command|static-ref|manual-review|llm-judge|n/a`; exact AC identities; behavioral MET ACs require executable evidence. Keep `expectFile`, host lint, verdict derivation, proof checks and no-replay-on-started-failure intact. Review handoffs refer to R3, not the verify-answer schema. This is an explicit invocation/handoff fix, not a generic runtime PATH-injection subsystem or a guarantee over arbitrary host shells.

- [x] **R3 — Emit canonical review priorities at the authoring boundary (P2).** Correct the source coordinator template in `plugins/sp/agents/super-reviewer.md` and directly conflicting review examples so task Review findings carry `P1 (blocker)`, `P2 (major)`, `P3 (minor)`, or `P4 (advisory)` cells natively. Use one explicit mapping; preserve severity and disposition, evidence locations, aggregate verdict and functional traceability. Preserve a substantive no-findings row accepted by the existing checker; do not invent a defect merely to populate a table. Use section-relative headings when writing into `### Review` so report subheadings do not become new task sections. Keep `hasPopulatedPriorityTable` strict; do not accept word-only severity tables or add manual transcription to the driver. Author source capabilities through the Superskill lifecycle; generated adapters remain install-owned.

- [x] **R4 — Reject non-task proof input at the shared read boundary (P2).** Add task-document shape validation to `readProofInputContents` in `packages/app/src/workflow/proof-input-fingerprint.ts`, shared by `proof.fingerprint` and proof-bound `run.artifact`. After the existing type/readability/regular-file/workdir checks, a supplied nonempty `taskFile` must contain task markdown: a nonempty canonical `## <WBS>. <title>` heading and at least one recognized task specification section (Background, Requirements, Acceptance Criteria, Design or Plan), parsed using the existing MarkdownDocument machinery. Reject a path-pointer file, arbitrary text, or a feature document with an error naming `taskFile`, the supplied/resolved path and the expected task-document shape before digest computation or artifact writes. Do not auto-dereference pointer contents. Do not require a `wbs` frontmatter field (normal CLI-created tasks omit it), full lifecycle readiness, or hardcoded/configured corpus-folder membership: valid supplied task specs can live under custom in-workdir paths. Preserve omitted/empty optional spec compatibility for `proof.fingerprint`, bound registration's mandatory taskFile rule, existing featureFile behavior, and all proof/run identity checks. Keep genuine changed-spec failures distinguishable as digest mismatches.

- [x] **R5 — Document the existing AC-altitude choice without weakening gates (P3).** Update `plugins/sp/skills/spur-cli/references/tasks.md` and its owning detailed task reference to document the standing pattern: link an issue/fix-batch to a substantively relevant feature; choose `--ac-altitude task-local` only when its regression scenarios intentionally do not represent feature ship criteria, and record that rationale. Explain that this differs from `--ac-numbering task-local` (R-to-AC coverage). Keep graduating as the default and retain DD-09 enforcement for graduating tasks. Include a source-local CLI example and retain ordinary orphan warnings; no checker-policy change is needed. Task 0816 already owns the individual 0587 ruling; do not reopen it or relink unrelated corpus to silence diagnostics.

### Acceptance Criteria

```gherkin
Feature: Correct and reproducible harness follow-ups

  Scenario: R1 — Bare Spur resolves to the checkout under the test preload
    Given an isolated checkout path containing spaces and a sentinel global spur later on PATH
    When a test child invokes bare spur from a fixture cwd through the normal preload environment
    Then the checkout source entry runs and the global sentinel is untouched
    And the caller cwd, a spaced argument and the underlying exit status are preserved
    And the launcher is tracked executable and works without a built bundle

  Scenario: R1 — Config isolation and historical correction remain truthful
    Given the repaired launcher and existing project-config skip behavior
    When focused hermeticity checks run for unpinned and explicitly pinned cwd calls
    Then unpinned calls skip project config and pinned fixture calls retain it
    And the 0815 closure text and any existing local buglog correction describe the verified launcher behavior

  Scenario: R2 — A delegated stage receives its execution and output contract
    Given a native-eligible verify action in an isolated execution tree
    When the host prepares the handoff using the updated dispatch contract
    Then it supplies the exact slash command, absolute cwd, resolved Spur invocation and output path
    And the child is told to use that invocation without recursively dispatching the stage
    And a controlled child command uses the supplied checkout invocation despite a competing PATH Spur
    And the host still applies expectFile, lint, verdict and proof gates after join

  Scenario: R2 — Verify examples round-trip through the real validators
    Given an answer fixture authored from the handoff contract for a fixture task
    When verify-answer-lint and task verdict parse the answer
    Then valid requirement and AC status rows are accepted without a repair pass
    And PASS in a requirement Status cell and N/A in a requirement Status cell are rejected
    And behavioral MET ACs with only static evidence cannot yield a passing verdict

  Scenario: R3 — Review output satisfies the existing priority and section contracts
    Given coordinator examples covering P1 through P4 and a substantive no-findings case
    When their emitted task Review bodies are checked by the existing parser and priority checker
    Then every valid example passes without severity transcription or phantom task sections
    And word-only severity rows and empty priority scaffolds still fail

  Scenario: R4 — Both proof actions reject a pointer before proof capture
    Given a readable taskFile containing only the path to a real task
    When proof.fingerprint or proof-bound run.artifact consumes it
    Then the action fails with the supplied path and expected task-document shape
    And no digest is captured and no artifact ledger row is written
    And arbitrary text and feature-document inputs are rejected by the same shared validation

  Scenario: R4 — Valid and optional proof inputs retain their contracts
    Given valid task markdown in a custom in-workdir path without wbs frontmatter
    When either proof action consumes it with its other required inputs
    Then the document-shape check accepts it and normal proof identity validation still applies
    And proof.fingerprint still allows an omitted or empty taskFile while bound registration refuses it
    And a changed valid task produces the existing digest mismatch rather than a document-shape error

  Scenario: R5 — Fix-batch guidance uses the existing independent altitude controls
    Given an isolated feature and a linked task whose regression scenario is not a feature ship scenario
    When the documented task-local altitude command is applied through the CLI
    Then the DD-09 subset finding is absent and the rationale is recorded
    And the same task at graduating altitude still reports the unmatched scenario
    And R-to-AC coverage remains independently controlled by ac_numbering
```

### Q&A

#### Consolidation decisions — 2026-09-09

| Original item | Disposition | Evidence and corrected direction |
| --- | --- | --- |
| 0818 R1: executor auth preflight | Rejected as contrary to the current design | `AgentService.checkUsable` already probes liveness before dispatch; auth is deliberately not consulted. `docs/design/agent-doctor-inspection-surface.md` section 4 removes auth probes. An omp HTTP 403 is not evidence of a missing liveness check. Do not add mandatory inference probes, guarantee that later steps cannot fail, or silently substitute an explicitly pinned executor. Runtime authentication failure remains an agent/operator remediation. |
| 0818 R2: distinct worktree config leak | Duplicate of completed 0817 R1; no new loader fix | `resolveConfigLayers` bases suppression on omitted cwd and the skip flag, independent of main checkout versus worktree. Four existing focused hermeticity tests passed during refinement. R1 retains this behavior. A separately reproduced explicit-cwd caller defect would need its own evidence; the reports provide none. |
| 0818 R3: verify vocabulary | Retained and corrected in R2 | Req rows cannot use N/A; only AC rows can. The owning verification skill already specifies the contract; the handoff omits it and restricts its payload. A deterministic fixture can prove schema compatibility; one model run cannot guarantee all future first attempts succeed. |
| 0818 R4: taskFile pointer | Retained in R4, shared boundary and narrower validation | A readable pointer currently passes `readProofInputContents`; both actions call it. Enforce task-document shape there. Folder membership is not a reliable document-shape check and would reject supported custom input locations. Do not change digest normalization or dereference the pointer. |
| 0819 R1: review severity friction | Retained in R3 | Source coordinator examples emit blocker/major/minor while the task checker requires P1-P4 cells. Correct the producer; preserve the checker and semantic severity. |
| 0819 R2: all subagent shells are hermetic | Narrowed to R1/R2 | The test shim was never present, so the original claim that test children were already pinned was false. Source-local workflow commands already receive `vars.spurBin`; native host shells are a different boundary. Bind the handoff to an explicit invocation and repair the test launcher. Neither importer auto-remedy nor rebuilding a global CLI proves prevention. No guarantee is made over arbitrary agent-generated bare commands or external interactive shells. |
| 0819 R3: orphan/altitude tension | Retained as documentation-only R5 | The existing flag expresses a legitimate distinction, not a gate escape hatch. 0816 owns the particular 0587 decision; this task owns missing reusable guidance. No duplicate corpus campaign or blanket orphan relinking. |
| 0820 R1: missing launcher | Merged into R1 | `tests/setup.ts` prepends a directory whose `spur` executable is absent from disk and tracked files. Pointing PATH at `apps/cli` cannot make `spur.js` resolve as bare `spur`; setting SPUR_BIN alone also cannot. Use the small actual launcher and test the child boundary. |
| 0820 R2: delete/recreate 0818 to prove CLI provenance | Rejected; bookkeeping resolved by this CLI-gated refinement | Commit wording and empty History do not prove how a file was created. CLI-created issue tasks can have empty History; history is transition-oriented, not creation attestation. Recreating changes allocation/timestamps and cannot rewrite the original Git history. Preserve WBS and original metadata, record this consolidation honestly, and validate current structure. No fabricated creation event or required commit-message evidence. |

No new public nouns/verbs, new dependencies, workflow policy edits, authentication design reversal, global installation changes, or live importer/database mutations are required. The user authorized consolidation and deletion of 0819/0820, not implementation of this future task.

### Design

Implement at existing ownership boundaries: launcher/preload for R1; native handoff and existing invocation facilities for R2; coordinator output for R3; shared proof reader for R4; task CLI reference for R5. Reuse the existing validators and Bun test setup. Do not introduce a generic subprocess wrapper service, a second verdict parser, a second review vocabulary, or a new corpus provenance subsystem.

R2's contract belongs in the source driver and verification reference; generated installed skills are not edited by hand. R3 uses Superskill's agent/skill authoring lifecycle. R4 is an input diagnostic improvement, not a new proof identity policy; it leaves normalized digest fields, feature input semantics and run-binding rules intact. Add the validation to file-path reads, not to the pure fingerprint function's optional content API.

Document the changed proof-input surface and test launcher behavior in `docs/04_DESIGN.md` alongside their existing contracts, and run the doc-evolve sync check during implementation. Workflow YAML changes are not planned. Execution is sequential in one owned clean worktree; independent future agents need isolated worktrees and integration review.

### Plan

1. Recheck this specification against the current tree, load applicable instructions, and reproduce the missing launcher, producer schema mismatch and pointer acceptance in isolated fixtures. Existing config suppression is a preservation check, not a new worktree fix.
2. Implement R1 and run the child-launcher and config hermeticity checks. Repair 0815's historical closure through its CLI-owned References section with a dated correction. Never mutate a live importer DB for the reproduction.
3. Implement R2 and R3 together because they touch the handoff/output boundary. Validate real answer examples with verify-answer-lint and task verdict; validate review examples with the existing priority/section checker. Use a fake child process for deterministic invocation evidence; report any real model smoke run separately.
4. Implement R4 in the shared reader. Exercise both actions with pointer/non-task inputs, valid custom paths, optional inputs and genuine digest drift. Assert failure precedes process/digest work and ledger writes.
5. Implement R5 using the existing CLI flags; exercise both altitude choices in a fixture corpus. Update owning surface docs, run Superskill checks for changed source capabilities and doc-evolve sync checks, then inspect the combined diff.
6. Run focused workspace tests, affected task/feature checks and the repository's required final code gates once on the final implementation. Record real review/verify results through the pipeline and commit only this task's authorized changes. Do not mark implementation complete on the strength of this refinement's structural checks.

### Root Cause

Source-confirmed findings at refinement time:

- `tests/setup.ts:71` prepends `scripts/test-shims`; no tracked or on-disk `scripts/test-shims/spur` exists. The claimed protection is not executable.
- `plugins/sp/skills/spur-dev/references/inline-pipeline-driver.md:244` restricts the handoff to stage id, slash command and no-recursion notice even though output paths and execution context are resolved at that boundary. It does not carry a compact verifier contract or pinned CLI invocation.
- `plugins/sp/agents/super-reviewer.md:132` emits word-only Severity cells; `packages/app/src/services/task-check.ts:113` requires populated P1-P4 cells. The producer and consumer disagree.
- `packages/app/src/workflow/proof-input-fingerprint.ts:102` checks types, lexical workdir confinement and file readability/regularity, then returns arbitrary file content without task-shape validation. Both proof actions consume it.
- `plugins/sp/skills/spur-cli/references/tasks/verbs.md:185` describes feature-AC subset matching without the task-local altitude distinction available in live update help.

Counterevidence: `packages/config/src/loader.ts:180` already suppresses unpinned project config irrespective of checkout layout; `packages/app/src/services/agent-service.ts:2185` explicitly defines a liveness-only readiness gate. Original session failures were not replayed against live providers/databases.

### Solution

Fix batch for the 0815 session-review reliability findings (commit `5e80e787b`; this verification run also adds the two contract-satellite doc paragraphs listed under R1/R4 documentation):

- **R1 — hermetic test CLI shim:** `scripts/test-shims/spur` (tracked `100755`) exec's this checkout's `apps/cli/src/index.ts` via bun, resolving relative to its own location so caller cwd and spaces in the checkout path cannot misroute; `tests/setup.ts:74-76` prepends the shim dir with `fileURLToPath` (fixing the `URL.pathname` percent-encoding) so a bare `spur` in any test child shadows stale globals. Regression: `apps/cli/tests/test-shim-launcher.test.ts` (sentinel global shadowing, non-root cwd, spaced path, exit-status propagation). Dated correction appended to the 0815 doc + `.spur/context/buglog.md`.
- **R2 — inline-pipeline-driver handoff:** the driver reference now names the execution-tree `cd`, confirmed absolute cwd, CLI/process/model invocation identity, and the owning artifact contract; `plugins/sp/tests/dispatch-handoff-contract.test.ts` pins cwd/invocation/output-path/artifact elements, exact slash command, no-recursive-dispatch, SPUR_BIN truth, and untouched post-join gates.
- **R3 — super-reviewer priority vocabulary:** `plugins/sp/agents/super-reviewer.md` carries the canonical `P1 (blocker)`–`P4 (advisory)` vocabulary with severity-word mapping, example and no-findings tables, and the never-invent rule; `packages/app/tests/services/review-priority-contract.test.ts` blocks placeholder scaffolds and word-only severity rows without loosening the checker.
- **R4 — proof-input shape validation:** `readProofInputContents` (shared read boundary in `packages/app/src/workflow/proof-input-fingerprint.ts`) rejects a non-task `taskFile` (path pointer / arbitrary text / feature document) via `taskDocumentShapeError` before any digest input is derived, never dereferencing the pointer; `featureFile` unchanged. Regression: 6 shape tests in `proof-input-fingerprint.test.ts` + run-artifact/inline-run-setup rejection coverage.
- **R5 — AC altitude docs:** `tasks.md` "AC altitude" section (independence table, rationale, source-local example) + `verbs.md` AC controls bullet and L4 exemption; checker behavior pinned by 3 `task-check` altitude tests (`task-local` skips DD-09, graduating still reports, R↔AC coverage independent).

### Testing

**Pipeline verify results**

- Verdict: PASS (from verdict artifact)

| Requirement | Status | Evidence |
|-------------|--------|----------|
| R1 | MET | `scripts/test-shims/spur:16-18` (tracked `100755`, self-locating via `dirname -- "$0"`, `exec bun` of this checkout's `apps/cli/src/index.ts`, quoted `"$@"`, exit status inherited, no bundle required); `tests/setup.ts:76` (`fileURLToPath` PATH prepend — space-safe, replaces the percent-encoding `URL.pathname` defect); regression `apps/cli/tests/test-shim-launcher.test.ts` 5/5 pass this run (sentinel global `spur` later on PATH stays unrun, non-root caller cwd preserved, spaced checkout path resolves, exit status propagates); config-skip precedence retained — `packages/config/tests/loader.test.ts -t hermeticity` 4/4 pass this run; dated corrections appended without deleting history at `docs/tasks4/0815_align-rundao-tracerowbyid-return-type-with-queryfirst-sql-nu.md:354-360` and `.spur/context/buglog.md:6993-7002` |
| R2 | MET | `plugins/sp/skills/spur-dev/references/inline-pipeline-driver.md:249-252` (the "send only stage id / slash command / no-recursion notice" restriction deliberately replaced), `:253-266` (five-field payload: stage id, exact unreformulated slash command, no-recursive-dispatch notice, confirmed absolute execution-tree cwd + resolved absolute `vars.spurBin` invocation reusing `resolveSpurBin()` / `--spur-bin` with the explicit "SPUR_BIN alone does not change bare-command resolution" truth, resolved absolute output path + owning artifact contract), `:269-283` (verify handoff names `code-verification/references/verdict-schema.md` and carries the compact contract: top-level `Verdict:`, Req rows MET / PARTIAL / UNMET with N-slash-A and PASS excluded, AC rows additionally justified N-slash-A, canonical evidence types, exact AC identities, behavioral MET requires executable evidence), `:285-288` (review handoffs carry R3's priority contract, not the verify schema), `:290-291` (explicit non-guarantee over arbitrary host shells), `:293-298` (post-join `answerFile`/`expectFile`/`requireDiff`/error-policy gates intact); execution-tree cwd confirmation at `:111-115` and event-trace provenance at `:175-177`; regression `plugins/sp/tests/dispatch-handoff-contract.test.ts:24-75` 10/10 pass this run |
| R3 | MET | `plugins/sp/agents/super-reviewer.md:100-101` (merge step emits native `P1 (blocker)` > `P2 (major)` > `P3 (minor)` > `P4 (advisory)` cells), `:132-140` (single explicit mapping table, severity words preserved in the same cell), `:142-146` (section-relative `####`+ headings so report subheadings never become task sections), `:156-168` (P1–P4 example findings table + preserved functional-traceability and aggregate-verdict blocks), `:173-175` (substantive no-findings `P4 (advisory)` row required; never-invent-a-defect rule; placeholder cells rejected); checker left strict — `packages/app/src/services/task-check.ts` `hasPopulatedPriorityTable` unchanged; regression `packages/app/tests/services/review-priority-contract.test.ts` pass this run (word-only severity rows and empty scaffolds still fail) |
| R4 | MET | `packages/app/src/workflow/proof-input-fingerprint.ts:113` (`CANONICAL_TASK_HEADING_RE`, numeric-WBS `##` heading separates a task spec from a feature `# <ID>: <title>`), `:130-137` (`taskDocumentShapeError` via the existing `MarkdownDocument.parse`; no `wbs` frontmatter, readiness, or corpus-folder membership required), `:192-205` (shape check is the last read-boundary check inside `readProofInputContents`, before any digest input is derived; error names `taskFile`, the supplied `raw` and `resolved` paths and the expected shape; pointer contents explicitly not dereferenced; `featureFile` untouched); regression `packages/app/tests/workflow/proof-input-fingerprint.test.ts` 6/6 shape tests + `proof-fingerprint`/`run-artifact`/`inline-run-setup` rejection coverage — 77/77 across 5 files pass this run |
| R5 | MET | `plugins/sp/skills/spur-cli/references/tasks.md:167-195` (one "AC altitude" section: independence table separating DD-09 feature-AC subset from `ac_numbering`'s Requirements↔AC coverage, the standing link-then-declare pattern with recorded rationale, source-local `bun run apps/cli/src/index.ts` example, `graduating` default and DD-09 enforcement retained, orphan warnings and checker policy unchanged); `plugins/sp/skills/spur-cli/references/tasks/verbs.md:70-84` (AC controls bullet + source-local example) and `:199-202` (L4 exemption scoped to the subset rule only); no checker change — `packages/app/src/services/task-check.ts:1058-1059` passes the field-only altitude through unchanged; regression `packages/app/tests/services/task-check.test.ts -t altitude` 3/3 pass this run; CLI surface `spur task update --help` exposes independent `--ac-altitude` / `--ac-numbering` |

| Acceptance Criteria | Status | Evidence Type | Evidence |
|---------------------|--------|---------------|----------|
| Scenario: R1 — Bare Spur resolves to the checkout under the test preload | MET | test | `apps/cli/tests/test-shim-launcher.test.ts` 5/5 pass this run — sentinel global `spur` later on PATH left unrun, fixture cwd different from checkout root preserved, checkout path containing spaces resolves, spaced argument and exit status survive, launcher tracked `100755` and runs with no built bundle |
| Scenario: R1 — Config isolation and historical correction remain truthful | MET | test | `packages/config/tests/loader.test.ts -t 'SPUR_SKIP_PROJECT_CONFIG hermeticity'` 4/4 pass this run (unpinned calls skip project config; explicitly pinned fixture cwd retains it); corrections re-read this run at `docs/tasks4/0815_align-rundao-tracerowbyid-return-type-with-queryfirst-sql-nu.md:354-360` and `.spur/context/buglog.md:6993-7002` — both appended and dated, original observations intact, and both describe the now-verified launcher behavior |
| Scenario: R2 — A delegated stage receives its execution and output contract | MET | test | `plugins/sp/tests/dispatch-handoff-contract.test.ts:24-75` 10/10 pass this run — payload carries cwd/invocation/output-path/artifact contract, exact slash command and no-recursive-dispatch rule survive the replacement, invocation is the existing `resolveSpurBin` chain with SPUR_BIN not overclaimed, a controlled child uses the supplied invocation despite a competing `spur` earlier on PATH, post-join gates untouched |
| Scenario: R2 — Verify examples round-trip through the real validators | MET | test | `plugins/sp/tests/dispatch-handoff-contract.test.ts:163-186` 4/4 pass this run — a contract-shaped answer lints clean and parses PASS with no repair pass; `PASS` in a requirement Status cell is rejected; `N/A` in a requirement Status cell is rejected; a behavioral MET AC carried only by `static-ref` yields PARTIAL, not PASS |
| Scenario: R3 — Review output satisfies the existing priority and section contracts | MET | test | `packages/app/tests/services/review-priority-contract.test.ts` pass this run — coordinator examples spanning `P1 (blocker)`–`P4 (advisory)` and the substantive no-findings case clear the existing parser and `hasPopulatedPriorityTable` without severity transcription or phantom task sections; word-only severity rows and empty priority scaffolds still fail |
| Scenario: R4 — Both proof actions reject a pointer before proof capture | MET | test | `packages/app/tests/workflow/proof-input-fingerprint.test.ts` shape tests plus `actions/proof-fingerprint.test.ts` and `actions/run-artifact.test.ts` rejection paths — 77/77 across 5 files pass this run: a readable taskFile containing only a real task's path fails naming the supplied path and expected shape, contents are never dereferenced, no digest is captured and no artifact ledger row is written, and arbitrary text and feature documents are rejected by the same shared `readProofInputContents` validation |
| Scenario: R4 — Valid and optional proof inputs retain their contracts | MET | test | `packages/app/tests/workflow/proof-input-fingerprint.test.ts` in the 77/77 run — canonical task markdown at a custom in-workdir path without `wbs` frontmatter is accepted and normal proof identity validation still applies; `proof.fingerprint` still allows an omitted/empty taskFile while bound registration still refuses it; a changed valid task yields the existing digest mismatch rather than a document-shape error; `featureFile` behavior unchanged |
| Scenario: R5 — Fix-batch guidance uses the existing independent altitude controls | MET | test | `packages/app/tests/services/task-check.test.ts -t altitude` 3/3 pass this run — a linked task at `ac_altitude: task-local` reports no DD-09 subset finding, the same task at `graduating` still reports the unmatched scenario, and Requirements↔AC coverage stays independently controlled by `ac_numbering`; documented rationale and source-local command re-read this run at `plugins/sp/skills/spur-cli/references/tasks.md:167-195` |
- Coverage: N/A (verdict-based; verify pipeline does not measure code coverage)

### Review

<!-- spur:record-review -->

**SECUA findings** (verify re-audit, `--force --focus all --fix all` — verdict: PASS)

| Priority | Dimension | Location | Finding |
|----------|-----------|----------|----------|
| P3 | correctness | `.spur/run/0818-verify-answer.txt:15-21` | **Fixed this run.** The prior committed verify answer paraphrased all 7 AC ids and omitted AC `R2 — Verify examples round-trip through the real validators` entirely, so `verify-answer-lint 0818` reported 7 unresolvable AC ids and the task reached `done` on an answer file that failed the project's own lint. Repaired to the eight verbatim `Scenario:` titles with per-AC evidence; lint now PASS (5 requirement rows, 8 AC rows). No implementation change was required. |
| P4 | security | `scripts/test-shims/spur:16-18` | `set -eu`, `CDPATH=` reset, `--` guards and quoted `"$@"` — no word-splitting or option-injection surface; adds no privilege and never consults the global install. |
| P4 | architecture | `packages/app/src/workflow/proof-input-fingerprint.ts:192-205` | Shape validation sits at the single shared read boundary both proof actions already call, so `proof.fingerprint` and proof-bound `run.artifact` are fixed by one guard rather than per-caller checks; digest normalization and run-binding rules untouched. |
| P4 | correctness | `plugins/sp/tests/dispatch-handoff-contract.test.ts:163-186` | R2's contract is enforced against the real `verify-answer-lint` and `spur task verdict` binaries rather than a restated fixture, so producer and consumer cannot drift apart silently. |
| P4 | test-evidence | — | Re-run this run: `apps/cli` test-shim-launcher 5/5 · `plugins/sp` dispatch-handoff-contract 10/10 · `packages/app` workflow+services 77/77 across 5 files · `packages/app` task-check `-t altitude` 3/3 · `packages/config` loader `-t hermeticity` 4/4. All 0 fail. |
| P4 | gates | — | `spur task check 0818 --strict-core --json` PASS, 0 findings. `spur rule run --preset recommended-post-check` PASS, 0 findings (first attempt hit a concurrent `.spur/spur.db` writer lock; re-run clean after the holder finished — no process was terminated). `spur feature check D6` PASS, 0 findings; no incomplete tasks under D6. |
| P4 | — | — | No P1–P2 findings across security, efficiency, correctness, usability and architecture. |

### References

- Original specifications are preserved in Git at `58cc87e27a47b4b9c659f79b8342827375d91751`: this task's original path, `docs/tasks4/0819_align-review-verify-contract-friction-and-close-subprocess-s.md`, and `docs/tasks4/0820_repair-0817-path-shadow-fix-and-convert-0818-to-cli-gated-co.md`. The latter two paths are historical, intentionally removed by this consolidation.
- Original reports cite task 0815 run `8ab8448a`, omp wrap failure `60f855f1`, and the 0817 residual sweep. These are reported provenance, not independently replayed evidence.
- `7f4cb94`: PATH prepend change; `6f04e0f00`: commit that first added 0818. A commit title is not CLI creation attestation.
- `apps/cli/src/workflow/resolve-spur-bin.ts:35`: existing launch-provenance resolver; `apps/cli/src/commands/workflow.ts:704`: workflow invocation default.
- `plugins/sp/skills/code-verification/SKILL.md:286` and its `references/verdict-schema.md`: answer and aggregation contracts; `plugins/sp/scripts/verify-answer-lint.ts:109`: distinct requirement/AC status normalization.
- `packages/app/src/workflow/actions/proof-fingerprint.ts:59` and `packages/app/src/workflow/actions/run-artifact.ts:188`: shared proof-reader callers.
- `docs/design/agent-doctor-inspection-surface.md:119`: removal of auth probes; `packages/app/src/services/task-service.ts:1126`: History is not creation attestation.
- Pre-refinement checks: 0818, 0819 and 0820 each passed structural check with one orphan-feature warning; feature D6 passed with no findings. Focused config tests from `packages/config`: `bun test tests/loader.test.ts --test-name-pattern 'SPUR_SKIP_PROJECT_CONFIG hermeticity'` — 4 pass, 0 fail. These establish triage evidence only.

#### Consolidation validation (not implementation verification)

- Controlled local pointer probe: `readProofInputContents` returned `ok: true` for a file containing only this task's path; `extractTaskProofData` returned `{ sections: {} }`. No live database or provider call was made.
- Source-local `task check 0818 --strict --json`: PASS, zero findings; five requirements and eight R-numbered scenarios. `rule run --preset recommended-pre-check --json`: 45 rules, zero findings. `bun run link-check`: PASS.
- After the operator-authorized removal, source-local `task show 0819 --json` and `task show 0820 --json` both exit 1 with task-not-found; `task refresh --json` reports 816 tasks across four folders. The CLI has no task-delete verb; only those two exact superseded files were removed directly.
- Linked feature D6 still passes its check with an expected `L4.verifying-incomplete-tasks` warning naming this todo follow-up. Feature status was not changed.
- `git diff --check` reports one extra blank line at this file's EOF: the section writer's `MarkdownDocument.replaceSection` always appends two newlines, including for History. A no-trailing-newline input reproduces the same output. Left as harness serialization behavior rather than bypassing CLI-gated corpus writes. No runtime implementation suite or pipeline verify was run for this specification-only change.

### History

- 2026-09-09: Operator requested consolidation of 0818/0819/0820 into 0818 and removal of 0819/0820. Requirements, AC, Q&A, Design, Plan, Root Cause and References refined through the source-local `spur task update --section --from-file` surface. Original WBS/created_at retained; status remains todo. This is a refinement entry, not a retroactive creation or implementation-verification claim.
- 2026-09-10T05:11:46.803Z todo → wip (system)
- 2026-09-10T05:12:38.594Z wip → testing (system)
- 2026-09-10T05:12:39.131Z testing → done (system)

