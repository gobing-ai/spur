---
description: Generate or extend tests until the unit target is met
argument-hint: "<target> [--coverage <n>] [--agent <name|inherit|auto>] [--auto]"
allowed-tools: ["Bash", "Read", "Write", "Edit", "Skill"]
---

# Dev Unit

Run a **unit-testing workflow** that drives toward the default unit target:

- focused coverage evidence for the requested target, aiming for `>= 90%`
- `100%` passing tests

This command is **standalone**. It does not delegate to the orchestration pipeline.

## When to Use

- After implementation is complete and you want stronger unit coverage
- When a specific file or module needs focused test extension
- When a task file needs a dedicated testing pass before verification

## Arguments

| Argument | Required | Description |
|----------|----------|-------------|
| `target` | Yes | WBS task number, task file path, source file path, or file pattern |
| `--coverage <n>` | No | Override the default focused coverage target. Default: `90` |
| `--agent <name\|inherit\|auto>` | No | Agent override: `<name>` = explicit agent, `inherit` = default (current agent), `auto` = resolve current agent |
| `--auto` | No | Skip confirmations where the delegated workflow supports it |

## Target Resolution

| Input Pattern | Detection | Workflow |
|---------------|-----------|----------|
| Ends with `.ts` or `.js` | Source file path | Direct file-focused test workflow |
| Glob pattern (`*`, `**/*.ts`) | File glob | Direct file-focused test workflow |
| Digits only (for example `0274`) | WBS number | Task-scoped testing workflow |
| Ends with `.md` and is a task file | Task file path | Task-scoped testing workflow |
| Any other string | Treat as task ref first | Task-scoped testing workflow |

## Agent Override

`--agent` is optional.

Default behavior:
- run in the **current agent**
- do not delegate externally unless `--agent` is explicitly provided

Supported values:

| Value | Meaning |
|-------|---------|
| `inherit` | Run in the current agent (pipeline default) |
| `claude-code`, `codex`, `openclaw`, `opencode`, `antigravity`, `pi` | Delegate to the named agent |
| `auto` | Resolve the current runtime to its canonical agent name |

### Agent Alias Normalization

When `--agent` is passed to the backing `sp:spur-dev` skill, the value is normalized:

| `--agent` value | Canonical agent |
|-----------------|-----------------|
| `inherit` | (current agent — no delegation) |
| `auto` | Resolved from current runtime |
| `claude-code` | claude |
| `codex` | codex |
| `openclaw` | openclaw |
| `opencode` | opencode |
| `antigravity` | antigravity |
| `pi` | pi |

## Workflow A: File-Focused Unit Testing

Use this when `target` is a source file path or a file glob.

### Steps

1. Resolve the source file(s)
2. Derive or locate the corresponding test file(s)
3. Run tests with coverage instrumentation
4. Identify gaps
5. Add targeted tests
6. Re-run tests
7. Repeat until the target is met or the workflow escalates

### Test File Naming Convention

| Source File | Test File |
|-------------|-----------|
| `foo.ts` | `foo.test.ts` |
| `foo.js` | `foo.test.js` |
| `src/foo.ts` | `src/foo.test.ts` |
| Pattern `src/**/*.ts` | Matching test files at corresponding paths |

If no test file exists at the derived path, create one with the project's standard test structure.

### Execution Pattern

```text
bun test --coverage <test-file>
```

This coverage signal is repository-level, not a strict per-source-file proof. For file-focused usage, treat coverage as **target-focused evidence**, combining:

- the test run's coverage output
- direct assertion that the target file's behavior/path set is exercised by the added tests
- gap analysis tied to the requested source file or glob

Do not claim mathematically exact per-file coverage for the source target unless the underlying toolchain actually reports it.

### Iteration Rules

- If coverage is below the threshold, add targeted tests and re-run
- If tests fail, fix or extend tests until the suite passes
- Maximum gap-filling passes: `3` before escalation
- If coverage plateaus or `% Funcs` stays low while `% Lines` is high, consult **Coverage Gap Diagnostic** below before escalating

## Workflow B: Task-Scoped Unit Testing

Use this when `target` is a WBS task number or a task file path.

### Steps

1. Resolve the task reference
2. Before moving to `testing`, ensure the task has real `Solution` content and real `Plan` content, and add enough `Design` content to avoid warning-driven `--force` usage
3. Set task status to `testing` via `spur task update <wbs> testing`
4. Run a task-scoped test/coverage pass
5. If testing reveals implementation gaps, move the task back to `wip`
6. Repeat until tests are green and coverage target is satisfied

### Task Status Rules

| Workflow Moment | Required Status Action |
|-----------------|------------------------|
| Start task-scoped testing | Ensure `Solution` and `Plan` exist, backfill `Design` if needed, then `spur task update <wbs> testing` |
| Testing reveals implementation work remains | `spur task update <wbs> wip` |
| Testing pass succeeds | Keep current status; do **not** mark `done` here |

`dev-unit` is a testing command, not a completion command. Final closure belongs to the broader workflow.

### Pre-Testing Guard

The `spur task check` CLI gates `testing` status on required sections. Task-scoped `dev-unit` must not move a task to `testing` blindly.

Minimum required behavior:

1. Ensure `Solution` describes the implemented behavior being tested
2. Ensure `Plan` records the concrete execution/testing steps already taken
3. Add minimal real `Design` content if needed to avoid warning-driven usage
4. Only then call `spur task update <wbs> testing`

## Completion Criteria

The command is successful only when all of the following are true:

1. The relevant tests pass with `0` failures
2. The coverage target is met, using `--coverage` when provided or `90%` by default
3. No unresolved blocker remains from the last test pass

For file-focused usage, "coverage target is met" means the workflow has enough focused evidence that the requested file or glob is adequately exercised to the requested threshold. It does not mean `bun test --coverage` has proven an isolated per-file percentage for that source file.

If coverage is still below target after focused extension attempts, escalate instead of pretending success.

## Coverage Gap Diagnostic (Bun + TypeScript)

Consult this section when iteration fails to close the coverage gap. Bun uses V8 function coverage, which produces several artifacts that look like missing tests but are actually instrumentation or code-structure issues. **Add tests only after ruling these out** — otherwise you will write tests that cannot move the metric.

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

This is the **only** sanctioned use of `biome-ignore lint/complexity/noUselessConstructor` in this project. Do not generalize it.

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
import "../src/baz";
// Or maintain src/index.ts re-exporting everything, then `import "../src"` once.
```

V8 only counts files that are actually loaded. A barrel is the lowest-maintenance option for "cover the whole module surface".

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

If real `import()` cannot be avoided: place teardown in `afterAll`, not `afterEach`, and treat temp paths in the coverage output as benign when the suite reports `0` failures.

### When to escalate instead of patch

- The diagnostic does not match any symptom in the table → escalate per the rule below
- Applying the matching fix changes the metric < 1% → likely a different root cause; escalate to debugging
- The fix would require disabling type/lint checks beyond Snippet 1's sanctioned suppression → stop and surface to the operator

## Escalation Rule

Escalate when:

- coverage plateaus after repeated passes
- a failure requires debugging rather than more test authoring
- environment or dependency issues block meaningful testing

Preferred escalation:

- switch to debugging mode for failing or flaky tests
- leave the task in `wip` if implementation changes are still required

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

Delegates to **sp:spur-dev** skill (unit operation). `$ARGUMENTS` passes all flags including `--agent` through verbatim:

```
Skill(skill="sp:spur-dev", args="unit $ARGUMENTS")
```

## Platform Notes

- **Claude Code:** native — `Skill()` delegation and `$ARGUMENTS` work directly.
- **Other platforms:** `Skill()` and `$ARGUMENTS` are Claude-specific. Invoke the `sp:spur-dev` skill's `unit` operation directly.
