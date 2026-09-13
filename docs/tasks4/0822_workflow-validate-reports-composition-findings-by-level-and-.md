---
schema_version: 1
name: Workflow validate reports composition findings by level and fails on the caps
status: done
template: feature-impl
created_at: 2026-09-10T23:51:14.069Z
updated_at: "2026-09-13T05:57:08.848Z"
feature_id: I21
priority: P2
tags:
  - cli
  - workflow

ac_numbering: task-local
---

## 0822. Workflow validate reports composition findings by level and fails on the caps

### Background

ADR-115 turns the ADR-069 composition advisory into a two-tier budget. Today `spur workflow validate` splits shell programs on newline and `;` only, exempts shell guards, skips slash-led `agent.run` inputs of any length and never changes its exit status. On 2026-09-10 the 11 shared definitions hold 27 shell actions, 2 shell guards and 3 `agent.run` inputs over the new caps, plus 7 `agent.run` steps with no output check. This task lands the measure and the levels, so the extraction tasks have a real tool to verify against.

Implements:
- R17 — composition caps are error-level validate findings
- R18 — composition findings never block a run

Ordering: first. The extraction tasks 0823–0825 verify against this validator, and the `spur-check` gate (0826) lands after them.
- Only two tests run `spur workflow validate` on shipped definitions and expect exit 0: `apps/cli/tests/commands/workflow.test.ts:100-133` (the bundled-definition loop) and `apps/cli/tests/commands/init.test.ts:80-85`.
- Shipped definitions exit 1 between this task and 0826. This task therefore relaxes both tests (Plan step 5), and 0826 restores exit 0.
- `plugins/sp/scripts/surface-drift-inventory.ts:744` records a `mismatch` row for any non-zero validate exit. Those rows are expected until 0823–0825 land. No test runs it against the live catalog.

Consent: granted 2026-09-10 (governance §4) for the `level` field, the new `measure.kind` values and exit 1 on error-level findings.

### Requirements

- [x] R1. `collectCompositionAdvisory` (`packages/app/src/services/workflow-service.ts`) counts logical commands and applies the governance §1.2 tiers to three element types:
  - `shell` actions: state-machine `onEnter`/`onExit` and transition-flow nodes;
  - shell transition guards: state-machine `transitions[].guard` and transition-flow `edges[].condition`;
  - `agent.run` actions.

  A logical command is a segment split on newline, `;`, `&&` and `||`, skipping blank segments, `#` comment segments and bare structure tokens. A pipeline counts once. Each element yields at most one size finding, plus a separate `agent-run-output` finding when an `agent.run` declares no output check.

  Each finding carries `level: 'warn'|'error'` and a `measure.kind` of `shell-lines`, `shell-chars`, `guard-lines`, `agent-run-chars` or `agent-run-output`. A guard finding names its source state in `state` and `<from>→<to>` in `actionKey`.

  `spur workflow validate` exits 1 when the definition is invalid or carries any error-level finding, in human and `--json` mode alike. It exits 0 on warn-only findings. Human mode prints every finding to stderr. A parity test keeps the cap constants, `docs/design/cli-contracts.md`, the governance §1.2 tier table and the `workflow-fit-and-tuning.md` §3 table in agreement.
- [x] R2. `spur workflow run`, `spur workflow run --dry-run` and `spur workflow continue` never compute or act on composition findings, for shared, project and explicit-path definitions alike.

Non-goals:
- `stateEffect`/`evidenceEffect` declarations. The progress projection hard-codes them and ADR-115 asks for none.
- The `spur-check` gate and budget coverage (0826).
- Edits to any `config/workflows` definition (0823–0825).
- Any behavior change to `run`, `run --dry-run` or `continue`.

### Acceptance Criteria

```gherkin
Feature: Workflow validate reports composition findings by level and fails on the caps

  Scenario: R1 — composition caps are error-level validate findings
    Given a workflow with an 11-command shell action, a 6-command shell guard and a 1001-character slash-led agent.run input
    When `spur workflow validate <file> --json` runs
    Then each is reported with level "error" and the command exits 1
    And a workflow with only warn-level findings exits 0

  Scenario: R2 — composition findings never block a run
    Given a workflow with an error-level composition finding
    When `spur workflow run`, `spur workflow run --dry-run` and `spur workflow continue` process it
    Then none of them computes or reports composition findings
    And each behaves as it does for a definition with no findings
```

### Q&A

<!-- CLOSED decisions from refinement: what was chosen and why, what was deferred and on what
     condition. Not a parking lot for open questions — an unanswered question here means the task
     is not ready to hand off. Keep empty if none. -->

#### Q&A entry — 2026-09-11T05:21:09.093Z

Refined at depth=ready (refineall I21, 2026-09-10). Closed decisions:
- **Consent granted 2026-09-10** (governance §4, row 0822/0826) for the `level` field, the `shell-chars`/`guard-lines`/`agent-run-chars`/`agent-run-output` kinds and exit 1 on error-level findings. The `spur-check` gate is 0826's.
- **§3 ownership with 0820.** This task owns the `workflow-fit-and-tuning.md` §3 numbers, posture and owners (a)–(e). 0820 only adds the consolidation and cache-window rule text next to them.
- **Precedence.** One size finding per element: error lines, then error chars, then warn lines. The counts then equal the governance §1.2 measured table. `agent-run-output` is a separate finding on the same action.
- **Guard key `→` (U+2192).** This is the format the engine already uses for guard locations. The `->` in cli-contracts was a typo and is fixed here.
- **`threshold`** is the cap the measure exceeded (5/10/800, 3/5, 1000), no longer the first flagged value (6).
- **Temporary test relax.** Shipped definitions exit 1 between this task and 0826. The two shipped-definition tests assert `valid: true` and accept exit 1 only with an error-level finding. 0826 restores exit 0.
- **Effects dropped.** `progress-projection.ts` hard-codes may-write/none, and ADR-115 asks for no effect declarations. No I21 task declares effects.
- **Transition-flow edges** are measured as guards for completeness. No shipped definition uses them.

#### Q&A entry — 2026-09-11T05:44:52.374Z

**Reason placement (refineall I21, 2026-09-10).** The one-line `#` reason for a warn-band program is a YAML comment directly above the action or guard, for example `# (e) <why it stays shell>` or `# (d) <script> owns <what>`. Never write it as a shell `#` line inside a folded `>-` scalar: folding joins the lines, so the `#` comments out the rest of the program. YAML comments do not count toward `command.length`. The §3 bullet in Design says the same, and 0823–0825 follow it.

### Design

**Approach.** Extend the existing validate-path advisory in `packages/app/src/services/workflow-service.ts` (`collectCompositionAdvisory`, ~:1921-1983); add no module.

**Type** (`CompositionFinding`, ~:236). `CompositionAdvisory` stays `{ findings }`, with no `suppressed` field.

```ts
export interface CompositionFinding {
    workflow: string;
    state: string;
    actionKey: string;
    level: 'warn' | 'error';
    measure: {
        kind: 'shell-lines' | 'shell-chars' | 'guard-lines' | 'agent-run-chars' | 'agent-run-output';
        measured: number;
        threshold?: number;
        severity?: string;
    };
    recommendation: string;
}
```

**Constants.** Exported next to the type; they are the single source for the tiers and the parity test.

```ts
export const COMPOSITION_CAPS = {
    shell: { warnAbove: 5, errorAbove: 10, charsErrorAbove: 800 },
    guard: { warnAbove: 3, errorAbove: 5 },
    agentRunInput: { charsErrorAbove: 1000, lowSeverityBelow: 200 },
} as const;
```

**Helper.** Export `countLogicalCommands(command: string): number` for tests. It is the same algorithm that produced the 2026-09-10 measurements:

```ts
const STRUCTURE_TOKENS = new Set(['then', 'else', 'fi', 'do', 'done', 'esac', '{', '}', '(', ')', ';;']);
command.split(/\n|;|&&|\|\|/).map((s) => s.trim())
    .filter((s) => s.length > 0 && !s.startsWith('#') && !STRUCTURE_TOKENS.has(s)).length;
```

The split is deliberately naive. It also splits inside `$(…)` and quotes, so a `;` in a quoted message counts. A single `|` never splits.

**Findings.** Each element gets at most one size finding. `threshold` is the cap the measure exceeded.

| Element | Condition, in precedence order | level / kind / threshold |
| --- | --- | --- |
| `shell` action | lines > 10 | error / `shell-lines` / 10 |
| | else `command.length` > 800 | error / `shell-chars` / 800 |
| | else lines > 5 | warn / `shell-lines` / 5 |
| shell guard | lines > 5 | error / `guard-lines` / 5 |
| | else lines > 3 | warn / `guard-lines` / 3 |
| `agent.run` input | `input.length` > 1000, slash-led or not | error / `agent-run-chars` / 1000, severity `high` |
| | else not slash-led (`!input.trimStart().startsWith('/')`) | warn / `agent-run-chars`, severity `low` (<200) or `medium` |
| `agent.run` output | `options.expectFile` unset and `options.requireDiff !== true` | warn / `agent-run-output`, measured 0, no threshold; always a separate finding |

- **Keys.**
  - Actions keep `state:onEnter:i` / `state:onExit:i`.
  - Transition-flow nodes keep `${node.id}:onEnter:0`.
  - Guards use `state = from`, `actionKey = ${from}→${to}` (U+2192). This is the format `validateShellVarRefs` already uses at ~:1894/:1910.
- **Guard scope.** State-machine `transitions[]` entries with `guard.kind === 'shell'`, measured on `guard.options.command`. Transition-flow `edges[]` entries with `condition.kind === 'shell'`, measured on `condition.options.command`. Every shipped definition is a state machine today.
- **Recommendations.** Tests assert substrings, not whole strings.
  - `shell-lines`: `shell action at ${key} measures ${n} logical commands (${level} above ${threshold}, ADR-115) — move it to an owner from the governance §1.1 fix vocabulary`.
  - `shell-chars`: `shell action at ${key} is ${n} chars (error above 800, ADR-115) — …` (same tail).
  - `guard-lines`: `shell guard ${key} measures ${n} logical commands (${level} above ${threshold}, ADR-115) — reduce it to one predicate over a result file`.
  - `agent-run-chars`: keep the current text and add the level.
  - `agent-run-output`: `agent.run at ${key} declares neither expectFile nor requireDiff — declare the artifact it must produce`.
- **Doc comment.** Update the comment on `collectCompositionAdvisory`: guards are now measured, and error-level findings set the validate exit status.

**CLI** (`apps/cli/src/commands/workflow.ts:440-469`).
- Human mode prints each finding to stderr: `composition ${level}: ${actionKey} — ${m} — ${recommendation}`, where `m` is:
  - `${n} logical commands (threshold ${t})` for `shell-lines` and `guard-lines`;
  - `${n} chars (threshold 800)` for `shell-chars`;
  - `${n} prompt chars (severity ${s})` for `agent-run-chars`;
  - `no output check` for `agent-run-output`.
- JSON mode keeps `toEnvelopeJson(result)` unchanged.
- Both modes then call `context.setExitCode(!result.valid || hasError ? 1 : 0)`, where `hasError = composition.findings.some((f) => f.level === 'error')`.

**Docs.**
- `docs/design/cli-contracts.md:561-578`:
  - `composition: {findings[]}`, dropping `suppressed` and the "0775 retired the suppression snapshot, so none are suppressed" sentence;
  - `<from>→<to>`;
  - one sentence: "`threshold` is the cap the measure exceeded".
- `plugins/sp/skills/spur-cli/references/workflows/workflow-fit-and-tuning.md` §3 (:130-152), rewritten:
  - the table becomes the §1.2 tiers (shell action, shell guard, `agent.run` input, `agent.run` output check), plus the existing node-count row;
  - the "Guards are exempt" and "0775 retired the recorded stays-shell exception" text goes;
  - owners (a)–(e) are listed, with (e) valid only inside the warn band;
  - every remaining warn-band shell program, including (d) wrapper shells, carries a one-line `#` reason as a YAML comment directly above the action or guard (never a shell `#` line inside a folded `>-` scalar, where folding joins lines and comments out the rest of the program);
  - the posture paragraph becomes the ADR-115 posture: warn never changes the validate exit and never blocks a run; error exits validate 1 and gates `config/workflows` in `spur-check` (0826); a finding never blocks `run`/`continue` and is never a reason to hot-edit an executing pipeline.
- 0820 adds the consolidation and cache-window rule text next to this section. This task does not write it.

**Parity test** (in `composition-advisory.test.ts`, paths resolved from the repo root). From `COMPOSITION_CAPS`, derive:
- `${shell.warnAbove + 1}–${shell.errorAbove}`, `>${shell.errorAbove}` and `${shell.charsErrorAbove}`;
- `${guard.warnAbove + 1}–${guard.errorAbove}` and `>${guard.errorAbove}`;
- `${agentRunInput.charsErrorAbove}` and `${agentRunInput.lowSeverityBelow}`.

Assert each appears in the matching row of the governance §1.2 tier table and of the fit-and-tuning §3 table, and in the cli-contracts composition paragraph.

**Invariants.**
- Findings stay derived from the definition (`extractResolvedWorkflowFacts`). No snapshot or suppression list returns (ADR-108).
- The run, dry-run and continue paths never call `collectCompositionAdvisory`.
- `shell-lines` and `agent-run-chars` keep their kinds. Only the counting unit, the `threshold` value and `level` change.
- The `packages/app/tests/workflow/composition-baseline.test.ts` pins stay green unchanged: modelQueries `['implement','test-fix','review','verify']` and the `implement:onEnter:0` agent.run.

**Rejected.**
- Blocking runs: an upgrade would stop adopting projects' workflows.
- A per-workflow allowlist during migration: that is the disposition snapshot ADR-108 retired. The gate lands after the extractions instead.
- An error on non-slash inputs: slash-led is the ideal, a soft constraint (operator, 2026-09-10).
- One finding per exceeded tier: one finding per element keeps the counts equal to the governance measured table.

### Plan

1. Write the tests first, in `packages/app/tests/workflow/composition-advisory.test.ts`:
   - helper cases: `&&`/`||` chains, structure tokens, `#` segments, a pipeline, and a `;` inside a quoted string;
   - shell tier boundaries at 5/6/10/11 commands and 800/801 characters;
   - guards at 3/4/5/6 commands, for a state-machine transition and a transition-flow edge;
   - `agent.run` inputs: a 1001-character slash-led input (error) and non-slash inputs of 199, 200 and 1000 characters;
   - a missing output check, and `requireDiff: false` still counting as missing;
   - precedence: an 11-command, 900-character action yields exactly one `shell-lines` error;
   - a transition-flow node;
   - the parity test.

   Update the existing expectations (split unit, `threshold`, `level`).
2. Implement the type, `COMPOSITION_CAPS`, `countLogicalCommands`, the guard scope, the levels and the output-check finding in `workflow-service.ts`. Update the doc comment.
3. Change the CLI validate path in `apps/cli/src/commands/workflow.ts:440-469` to the stderr line format and the exit rule. In `apps/cli/tests/commands/workflow.test.ts`, add:
   - a warn-only fixture that exits 0 in human and `--json` mode;
   - an error fixture that exits 1 in both modes, with `level: "error"` in the JSON;
   - an invalid definition that still exits 1.
4. R2 test: on the error fixture, `run --dry-run` and `continue` behave as they do on a clean fixture and print no `composition` line.
5. Relax the two shipped-definition tests:
   - `apps/cli/tests/commands/workflow.test.ts:100-133` and `apps/cli/tests/commands/init.test.ts:80-85` assert `valid: true`, and accept exit 1 only when `composition.findings` holds an error-level finding;
   - add a comment in each: `// I21: exit 0 is restored by 0826 once 0823–0825 land`;
   - run `rg -n "workflow validate" scripts plugins config package.json` and confirm no other caller expects exit 0 on a shared definition.
6. Edit `docs/design/cli-contracts.md` and the `workflow-fit-and-tuning.md` §3 rewrite, then run the parity test.
7. Run `bun run spur-check`, then `bun run --filter @gobing-ai/spur build:bundle`.

### Solution

Change-map (auto-generated — implement step did not record a Solution).
Each entry cites the first changed line per file (`file:line`).

| Change (`file:line`) |
|----------------------|
| `apps/cli/src/commands/workflow.ts:436` |
| `apps/cli/src/commands/workflow.ts:453` |
| `apps/cli/tests/commands/init.test.ts:84` |
| `apps/cli/tests/commands/workflow.test.ts:130` |
| `apps/cli/tests/commands/workflow.test.ts:133` |
| `apps/cli/tests/commands/workflow.test.ts:274` |
| `packages/app/src/services/workflow-service.ts:1931` |
| `packages/app/src/services/workflow-service.ts:1935` |
| `packages/app/src/services/workflow-service.ts:1964` |
| `packages/app/src/services/workflow-service.ts:1999` |
| `packages/app/src/services/workflow-service.ts:2008` |
| `packages/app/src/services/workflow-service.ts:2010` |
| `packages/app/src/services/workflow-service.ts:2014` |
| `packages/app/src/services/workflow-service.ts:2058` |
| `packages/app/src/services/workflow-service.ts:2065` |
| `packages/app/src/services/workflow-service.ts:2077` |
| `packages/app/src/services/workflow-service.ts:2088` |
| `packages/app/src/services/workflow-service.ts:235` |
| `packages/app/src/services/workflow-service.ts:240` |
| `packages/app/src/services/workflow-service.ts:245` |
| `packages/app/src/services/workflow-service.ts:255` |
| `packages/app/tests/workflow/composition-advisory.test.ts:15` |
| `packages/app/tests/workflow/composition-advisory.test.ts:156` |
| `packages/app/tests/workflow/composition-advisory.test.ts:161` |
| `packages/app/tests/workflow/composition-advisory.test.ts:167` |
| `packages/app/tests/workflow/composition-advisory.test.ts:171` |
| `packages/app/tests/workflow/composition-advisory.test.ts:174` |
| `packages/app/tests/workflow/composition-advisory.test.ts:18` |
| `packages/app/tests/workflow/composition-advisory.test.ts:191` |
| `packages/app/tests/workflow/composition-advisory.test.ts:35` |
| `packages/app/tests/workflow/composition-advisory.test.ts:4` |
| `packages/app/tests/workflow/composition-advisory.test.ts:402` |
| `packages/app/tests/workflow/composition-advisory.test.ts:408` |
| `packages/app/tests/workflow/composition-advisory.test.ts:415` |
| `packages/app/tests/workflow/composition-advisory.test.ts:469` |
| `packages/app/tests/workflow/composition-advisory.test.ts:8` |

### Testing

**Pipeline verify results**

- Verdict: PASS (from verdict artifact)

| Requirement | Status | Evidence |
|-------------|--------|----------|
| R1 | MET | Logical command counts, tier boundaries, guards, output checks, findings and exit semantics match ADR-115. `packages/app/src/services/workflow-service.ts:1942`; `packages/app/tests/workflow/composition-advisory.test.ts:176`. Executed: `bun run spur-check` (exit 0). |
| R2 | MET | Run, dry-run and continue do not evaluate or act on composition findings. `apps/cli/tests/commands/workflow.test.ts:405`. Executed: `bun run spur-check` (exit 0). |

| Acceptance Criteria | Status | Evidence Type | Evidence |
|---------------------|--------|---------------|----------|
| Scenario: R1 — composition caps are error-level validate findings | MET | test | Logical command counts, tier boundaries, guards, output checks, findings and exit semantics match ADR-115. `packages/app/src/services/workflow-service.ts:1942`; `packages/app/tests/workflow/composition-advisory.test.ts:176`. Executed: `bun run spur-check` (exit 0). |
| Scenario: R2 — composition findings never block a run | MET | test | Run, dry-run and continue do not evaluate or act on composition findings. `apps/cli/tests/commands/workflow.test.ts:405`. Executed: `bun run spur-check` (exit 0). |
- Coverage: N/A (verdict-based; verify pipeline does not measure code coverage)

### Review

<!-- spur:record-review -->

**SECU findings** (pipeline verify step — verdict: PASS)

| Priority | Dimension | Location | Finding |
|----------|-----------|----------|----------|
| P4 | spur task check | — | task check passed |
| P4 | design-conformance | — | Requirements, Design and Plan mapped to current implementations and tests; documented extraction choices preserved. |
| P4 | quality-gate | — | `bun run spur-check` exit 0; final log `.spur/run/I21-verifyall-20260912/spur-check-final.log`. |
| P4 | build-and-cloudflare | — | build:scripts, CLI/server/web builds, build:bundle and test-cf exited 0. |
| P4 | secua-review | — | All five dimensions checked; re-audit fixes on 0819, 0823 and 0825 have red/green regression evidence. |
| P4 | artifact-disclosure | — | Rebuilt `.spur/run/0822-verify-answer.txt:1-35` and `.spur/run/0822-verdict.json` from fresh evidence; Testing rendered by task record. |
| P4 | cli-golden-path-present | — | Source-local workflow show/validate --json invocations and CLI subprocess regression passed. |
| P4 | evidence-rule-pass | — | All behavior-bearing AC rows have executable evidence or are explicitly non-behavioral. |

### References

<!-- Links to the parent feature, design docs, related tasks, or external references. -->

### History

- 2026-09-11T20:50:20.437Z todo → wip (system)
- 2026-09-11T21:09:17.176Z wip → testing (system)
- 2026-09-11T21:09:17.979Z testing → done (system)

