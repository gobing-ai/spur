---
description: Generate or extend tests until the unit target is met
argument-hint: "<target> [--coverage <n>] [--agent <name|auto>] [--auto]"
allowed-tools: ["Bash", "Read", "Write", "Edit", "Skill"]
---

# Dev Unit

Run a **unit-testing workflow** that drives toward the unit target: focused coverage evidence for the
requested target (per-file line/function `>= 90%` by default) with `100%` passing tests.

Two workflows: file-focused (when target is a source path or glob) or task-scoped (when target is a
WBS number or task file). The deep testing competency (`sp:code-testing`) owns gap analysis,
coverage-vs-quality rules, escalation logic, and per-stack adapters. This command owns the workflow
steps — resolve target, locate/create test files, run/iterate, complete or escalate.

This command is standalone; it does not delegate to the orchestration pipeline.

## When to use

- After implementation, when you want stronger unit coverage.
- When a specific file or module needs focused test extension.
- When a task file needs a dedicated testing pass before verification.

## Arguments

| Argument | Required | Description |
|----------|----------|-------------|
| `target` | Yes | WBS task number, task file path, source file path, or file glob |
| `--coverage <n>` | No | Override the focused coverage target. Default: `90` |
| `--agent <name\|auto>` | No | Spawn the test-generation step under a specific agent via `spur agent run`. Omit (the default) to run it **in the current session** — no subprocess |
| `--auto` | No | Skip confirmations where the delegated workflow supports it |

## Target resolution

| Input pattern | Detected as | Workflow |
|---------------|-------------|----------|
| Ends with `.ts` / `.js`, or a glob (`*`, `**/*.ts`) | Source path / file glob | **A — File-focused** |
| Digits only (e.g. `0274`) | WBS number | **B — Task-scoped** |
| Ends with `.md` and is a task file | Task file path | **B — Task-scoped** |
| Any other string | Task ref | **B — Task-scoped** |

## Agent override

`--agent` is an **inline** command (per the two-surface contract in
[cross-cutting.md](../skills/spur-dev/references/cross-cutting.md) § "Honor `--agent`"): the default
(no flag) runs the test-generation step **in the current session**. An explicit `--agent <name>` or
`--agent auto` spawns it via `spur agent run` instead. The default never shells out.

## Workflow A: File-Focused Unit Testing

Use when `target` is a source file path or file glob. The agent navigates the user directly to the
targeted file(s): resolve them, locate or create the corresponding test file(s), run coverage, add
targeted tests, and iterate.

### Steps

1. **Resolve the source file(s)** — expand globs to concrete paths.
2. **Derive or locate the corresponding test file(s)** — use the naming convention below. If no
   matching test file exists, create one with the project's standard test structure.
3. **Run tests with coverage** against the test file(s). Use the project's test command (e.g.
   `bun test <test-file> --coverage`).
4. **Identify gaps** — read the coverage output. Categorize gaps per the `sp:code-testing` gap
   analysis (error paths, complex logic, edge cases, external deps, unreachable).
5. **Add targeted tests** for the highest-priority gaps first. Delegate test authoring to the
   `Tester` subagent for high-signal tests, or write them directly for simple cases.
6. **Re-run tests** — compare before/after coverage.
7. **Repeat** until the target is met or the workflow escalates (max 3 gap-filling passes).

### Test File Naming Convention

| Source File | Test File |
|-------------|-----------|
| `foo.ts` | `foo.test.ts` (co-located) or `<tests-dir>/foo.test.ts` |
| `foo.js` | `foo.test.js` (co-located) or `<tests-dir>/foo.test.js` |
| `src/modules/obs/tabs.ts` | `<tests-dir>/modules/obs/tabs.test.ts` (mirror dir structure) |
| Pattern `src/**/*.ts` | Matching test files at corresponding paths under `<tests-dir>` |

The project's test directory convention is detected from the stack. For Bun/TS projects in Spur,
tests live in `apps/<name>/tests/` mirroring the `src/` structure. If no test file exists at the
derived path, create one following the project's existing test patterns.

### Execution Pattern

```bash
# Spur web app (from repo root)
bun test apps/web/tests/<path>.test.ts --coverage

# Or from workspace dir
cd apps/web && bun test ./tests/<path>.test.ts --coverage
```

Coverage is repository-level, not per-source-file. For file-focused usage, treat coverage as
**target-focused evidence**: combine the coverage output with a direct assertion that the target
file's behavior is exercised by the added tests. Do not claim mathematically exact per-file coverage
unless the toolchain reports it.

### Iteration Rules

- If coverage is below the threshold, add targeted tests and re-run.
- If tests fail, fix or extend until the suite passes.
- **Max 3 gap-filling passes** before escalation.
- If coverage plateaus or `% Funcs` stays low while `% Lines` is high, consult the **[Coverage Gap
  Diagnostic](#coverage-gap-diagnostic-bun--typescript)** below before escalating.

## Workflow B: Task-Scoped Unit Testing

Use when `target` is a WBS number or task file path. This workflow moves task status and is gated by
the CLI.

### Steps

1. **Resolve the task** — `spur task path <wbs> --json` to find the file.
2. **Pre-testing guard** — ensure `Solution` and `Plan` have real content, backfill `Design` if
   needed. Run `spur task check <wbs> --json` to confirm required sections.
3. **Transition status** — `spur task update <wbs> testing`.
4. **Run a task-scoped test/coverage pass** — see Workflow A steps 3-7.
5. **If testing reveals implementation gaps** — `spur task update <wbs> wip` and address them.
6. **Repeat** until tests are green and coverage target is satisfied.

### Task Status Rules

`dev-unit` is a **testing** command, not a completion command — it never marks a task `done`.

| Workflow moment | Required status action |
|-----------------|------------------------|
| Start task-scoped testing | Ensure `Solution` + `Plan` exist, backfill `Design` if needed, then `spur task update <wbs> testing` |
| Testing reveals implementation work remains | `spur task update <wbs> wip` |
| Testing pass succeeds | Keep current status — do **not** mark `done` |

### Pre-Testing Guard

`spur task check` gates `testing` status on required sections. Never move a task to `testing` blindly:

1. Ensure `Solution` describes the implemented behavior being tested.
2. Ensure `Plan` records the concrete execution/testing steps taken.
3. Add minimal real `Design` content if needed to avoid warning-driven `--force` usage.
4. Only then call `spur task update <wbs> testing`.

## Completion Criteria

The command succeeds only when **all** are true:

1. The relevant tests pass with `0` failures.
2. The coverage target is met (`--coverage` when provided, else per-file line/function ≥ 90%).
3. No unresolved blocker remains from the last test pass.

For file-focused usage, "coverage target is met" means enough focused evidence that the requested
file or glob is adequately exercised. It does not mean `bun test --coverage` has proven an isolated
per-file percentage for that source file.

If coverage is still below target after focused extension, **escalate** — do not pretend success.

## Coverage Gap Diagnostic (Bun + TypeScript)

Consult this section when iteration fails to close the coverage gap. Bun uses V8 function coverage,
which produces several artifacts that look like missing tests but are actually instrumentation or
code-structure issues. **Add tests only after ruling these out** — otherwise you will write tests
that cannot move the metric.

| Symptom | Likely Cause | Fix |
|---------|-------------|-----|
| `% Funcs` < threshold while `% Lines` ≥ threshold; child classes show "uncovered" | Implicit/synthetic constructor on a class that `extends` without writing `constructor()` | Add an explicit empty constructor with the project-approved suppression (see snippet 1) |
| `% Funcs` < threshold; flagged functions are module-level arrows you never call directly | Anonymous/unused arrow at module scope counted as an uncovered function | Either `export` the arrow as a named pure function and test it, or inline it into the function that uses it (see snippet 2) |
| Coverage swings between runs; some source files missing from the report entirely | File never imported by any test path, so V8 doesn't see it | Ensure the test (or a barrel `index.ts` imported by the test) statically imports every target module (see snippet 3) |
| Worker / temp paths appearing in coverage output; `coverageExclude` in `bunfig.toml` has no effect | Dynamic `import()` spawns a worker; V8 tracks worker coverage globally and ignores `coverageExclude` | Prefer a mock module-loader pattern over real `import()`; if `import()` is required, clean up with `afterAll` (not `afterEach`) and accept temp paths when failures == 0 (see snippet 4) |

### Snippet 1 — Explicit empty constructor

```typescript
class Derived extends Base {
  // biome-ignore lint/complexity/noUselessConstructor: V8 function coverage requires explicit constructor
  constructor() {
    super();
  }
}
```

### Snippet 2 — Promote module-level arrows

```typescript
// Before: anonymous arrow at module scope, counted as an uncovered function
const transform = (x: number) => x * 2;
export function run(input: number[]) { return input.map(transform); }

// After option A: export the pure function and test it directly
export const transform = (x: number) => x * 2;

// After option B: inline into the only caller, removing the module-level entry point
export function run(input: number[]) {
  return input.map((x) => x * 2);
}
```

### Snippet 3 — Ensure targets are loaded

```typescript
// In a test entry or a barrel imported by tests
import "../src/foo";
import "../src/bar";
// Or maintain src/index.ts re-exporting everything, then `import "../src"` once.
```

V8 only counts files that are actually loaded. A barrel is the lowest-maintenance option for "cover
the whole module surface."

### Snippet 4 — Avoid the `import()` worker leak

```typescript
// Prefer: inject a loader so production code uses import() but tests use a mock
type Loader = (id: string) => Promise<unknown>;
export async function loadAndRun(id: string, load: Loader = (i) => import(i)) {
  const mod = await load(id);
  return mod;
}

// In tests, pass a mock loader — no real import(), no worker thread
test("loadAndRun uses injected loader", async () => {
  const result = await loadAndRun("ignored", async () => ({ ok: true }));
  expect(result).toEqual({ ok: true });
});
```

If real `import()` cannot be avoided: place teardown in `afterAll`, not `afterEach`, and treat temp
paths in the coverage output as benign when the suite reports `0` failures.

### When to escalate instead of patch

- The diagnostic does not match any symptom in the table → escalate per the rule below.
- Applying the matching fix changes the metric < 1% → likely a different root cause; escalate to
  `sp:sys-debugging`.
- The fix would require disabling type/lint checks beyond Snippet 1's sanctioned suppression → stop
  and surface to the operator.

## Escalation

Escalate when:

- Coverage plateaus after repeated passes (**max 3 gap-filling passes**).
- A failure requires debugging rather than more test authoring.
- Environment or dependency issues block meaningful testing.

On escalation:

1. Switch to `sp:sys-debugging` for failing or flaky tests.
2. **Document the untestable code** — some gaps are unreachable by design.
3. **Report status honestly** — which gaps remain, which are documented-skipped, final coverage
   achieved.
4. For task-scoped runs, leave the task in `wip` if implementation changes are still required; do
   not force it forward.

## Examples

```bash
# File-focused: test a specific file
/sp:dev-unit src/utils/helper.ts

# File-focused: stricter threshold
/sp:dev-unit src/utils/helper.ts --coverage 95

# File-focused: glob
/sp:dev-unit "src/**/*.ts"

# Task-scoped: local by default
/sp:dev-unit 0266

# Task-scoped: delegated testing
/sp:dev-unit 0266 --coverage 95 --agent codex --auto
```

## Implementation

Delegates to the **sp:code-testing** competency skill for gap analysis, coverage-vs-quality rules,
per-stack adapters, and escalation logic. This command owns the workflow steps above (resolve,
locate/create, run, iterate, complete/escalate); the skill owns the *how to test well*.

```
Skill(skill="sp:code-testing", args="$ARGUMENTS")
```

## See Also

- **`/sp:dev-run`** — full task workflow with implement ↔ test loop and verification gate.
- **`/sp:dev-verify`** — verification pass after testing.
- **`sp:code-testing`** — deep testing competency (gap analysis, per-stack adapters, quality rules).
- **`sp:sys-debugging`** — use when tests fail for reasons beyond straightforward test extension.

## Platform Notes

- **Claude Code:** native — `Skill()` delegation and `$ARGUMENTS` work directly.
- **Other platforms:** `Skill()` and `$ARGUMENTS` are Claude-specific. Invoke the `sp:code-testing` skill directly.
