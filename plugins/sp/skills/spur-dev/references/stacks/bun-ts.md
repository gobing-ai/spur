---
name: stacks/bun-ts
description: "Stack adapter for Bun + TypeScript (and Node/TS) — test command, V8 coverage parsing, the V8 coverage-gap diagnostic, framework idioms. Loaded by unit-testing.md when the project uses bun/vitest/jest."
see_also:
  - unit-testing
---

# Stack adapter: Bun + TypeScript

Mechanics for the [unit-testing.md](../unit-testing.md) spine when the project is Bun/TS (or Node/TS).
The spine owns the procedure; this file owns Bun/TS commands, parsing, idioms, and gotchas.

## Test + coverage command

```bash
bun test --coverage
```

Bun reports per-file `% Funcs` and `% Lines` (V8 coverage):

```
File          | % Funcs | % Lines | Uncovered Line #s
--------------|---------|---------|------------------
auth.ts       |   80.00 |   92.31 | 23-27
--------------|---------|---------|------------------
All files     |   77.00 |   90.48 |
```

Spur target: **per-file line ≥ 90% and function ≥ 90%** (`bunfig.toml`), suite fully passing.

## Test-file convention

Tests live in `<workspace>/tests/**/*.test.ts` next to the code (AGENTS.md). Use `bun:test`
(`import { test, expect, describe } from "bun:test"`). For a loose source file with no test, create
`tests/<name>.test.ts`.

## Idioms

**Branch / parameterized tests** — one test per branch:

```typescript
import { test, expect } from 'bun:test';

for (const [user, amount, expected] of [
  ['vip', 150, 120],
  ['vip', 50, 45],
  ['regular', 100, 100],
] as const) {
  test(`discount: ${user} on ${amount} → ${expected}`, () => {
    expect(calculateDiscount(makeUser(user), amount)).toBe(expected);
  });
}
```

**Mock at the boundary** — inject the dependency; do not mock internal collaborators:

```typescript
test('fetchUser returns null on 404', async () => {
  const result = await fetchUser(999, async () => ({ status: 404 }));
  expect(result).toBeNull();
});
```

**Inline coverage-exclusion rationale** (the accept-lower-coverage case):

```typescript
// NOTE: unreachable in production — the adapter guarantees a non-null row here.
if (row == null) throw new Error('unreachable: adapter contract violated');
```

## Coverage-gap diagnostic (V8)

Bun uses V8 function coverage, which produces artifacts that look like missing tests but are
instrumentation/code-structure issues. **Rule these out before writing tests** — otherwise you write
tests that cannot move the metric.

| Symptom | Likely cause | Fix |
|---------|-------------|-----|
| `% Funcs` < threshold while `% Lines` ≥ threshold; child classes show "uncovered" | Implicit/synthetic constructor on a class that `extends` without an explicit `constructor()` | Add an explicit empty constructor with the sanctioned suppression (snippet 1) |
| `% Funcs` < threshold; flagged functions are module-level arrows never called directly | Anonymous/unused arrow at module scope counted as an uncovered function | `export` the arrow as a named pure function and test it, or inline it (snippet 2) |
| Coverage swings between runs; some files missing from the report entirely | File never imported by any test path, so V8 doesn't see it | Ensure the test (or a barrel imported by the test) statically imports every target module (snippet 3) |
| Worker/temp paths in coverage output; `coverageExclude` in `bunfig.toml` has no effect | Dynamic `import()` spawns a worker; V8 tracks worker coverage globally and ignores `coverageExclude` | Prefer a mock module-loader over real `import()`; if required, clean up in `afterAll` and accept temp paths when failures == 0 (snippet 4) |

### Snippet 1 — explicit empty constructor

```typescript
class Derived extends Base {
  // biome-ignore lint/complexity/noUselessConstructor: V8 function coverage requires explicit constructor
  constructor() {
    super();
  }
}
```

This is the **only** sanctioned use of `biome-ignore lint/complexity/noUselessConstructor` in this
project. Do not generalize it.

### Snippet 2 — promote module-level arrows

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

### Snippet 3 — ensure targets are loaded

```typescript
// In a test entry or a barrel imported by tests
import '../src/foo';
import '../src/bar';
import '../src/baz';
// Or maintain src/index.ts re-exporting everything, then `import '../src'` once.
```

V8 only counts files that are actually loaded. A barrel is the lowest-maintenance way to cover the
whole module surface.

### Snippet 4 — avoid the `import()` worker leak

```typescript
// Prefer: inject a loader so production code uses import() but tests use a mock
type Loader = (id: string) => Promise<unknown>;
export async function loadAndRun(id: string, load: Loader = (i) => import(i)) {
  return load(id);
}

// In tests, pass a mock loader — no real import(), no worker thread
test('loadAndRun uses the injected loader', async () => {
  const result = await loadAndRun('ignored', async () => ({ ok: true }));
  expect(result).toEqual({ ok: true });
});
```

If real `import()` cannot be avoided: place teardown in `afterAll` (not `afterEach`) and treat temp
paths in the coverage output as benign when the suite reports `0` failures.

### When to escalate instead of patch

- The diagnostic matches no symptom in the table → escalate (spine § Escalation).
- Applying the matching fix moves the metric < 1% → likely a different root cause; escalate to debugging.
- The fix would require disabling type/lint checks beyond snippet 1's sanctioned suppression → stop
  and surface to the operator.

## Node + TypeScript/JS (Vitest / Jest)

When the project is Node-based (no `bun.lock`) the spine is identical; only the command and reporter
change.

| Framework | Command | Coverage report |
|-----------|---------|-----------------|
| Vitest | `npx vitest run --coverage` | `% Stmts / % Branch / % Funcs / % Lines` table (istanbul or v8 provider) |
| Jest | `npx jest --coverage` | same table shape |

Vitest with the `v8` provider shares the V8 gotchas above (synthetic constructors, module loading).
With the istanbul provider, branch coverage is reported directly — prefer it for branch-sensitive
code. Test files: `*.test.ts` / `*.spec.ts` per the project's existing convention.
