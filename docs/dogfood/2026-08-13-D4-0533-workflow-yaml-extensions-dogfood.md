# Dogfood: D4 — Workflow YAML rule-style extensions (task 0533)

**Date:** 2026-08-13 · **Feature:** D4 · **Task:** 0533 · **Driver:** `spur workflow` CLI (inline)

## What was exercised

The self-referential surface task 0533 touches: `spur workflow validate` and `spur workflow run`
now load YAML-declared `extensions.actions` / `extensions.guards` modules before any step, with
fail-closed module/shape/path checks. Dogfooded through the real CLI, not the unit harness.

## Fixture

```yaml
# /tmp/spur-d4-dogfood/flow.yaml
name: d4-dogfood
kind: state-machine
initialState: start
extensions:
  guards:
    - ./exts/flag.ts        # relative to the workflow file's own directory
states:
  - id: start
  - id: done
transitions:
  - from: start
    to: done
    guard: { kind: feature-flag }
terminalStates:
  - done
```

```ts
// /tmp/spur-d4-dogfood/exts/flag.ts
export default {
    name: 'flag-ext',
    guards: [{ kind: 'feature-flag', async evaluate() { return true; } }],
};
```

## Runs

| Command | Result |
| --- | --- |
| `spur workflow validate flow.yaml` | `workflow valid: d4-dogfood` — the listed guard module imported + shape-checked, no error |
| `spur workflow validate flow.yaml --json` | `ok:true` with `extensions.guards: ["./exts/flag.ts"]` in the parsed def |
| `spur workflow run flow.yaml --run-id d4-dog-1 --no-log` | `workflow done: d4-dogfood -> done` — extension guard `feature-flag` evaluated on the start→done transition (would fail with unknown-guard otherwise) |
| `spur workflow validate bad.yaml` (missing module `./exts/nope.ts`) | `workflow invalid` — `"d4-bad" extension "./exts/nope.ts" cannot be canonicalized: ENOENT` — fail-closed before any step |

## Evidence it works (not just "doesn't crash")

1. **Guard registration + evaluation:** the run reached `done` through the `feature-flag` guard
   declared only in YAML. If `loadWorkflowExtensionsIntoHost` had not run, the engine would have
   thrown `Unknown workflow guard "feature-flag"` — it did not.
2. **Fail-closed:** a missing module surfaced as `workflow invalid` with the module path, exit 1
   path taken, before the workflow's first step.
3. **Relative resolution:** `./exts/flag.ts` resolved against the workflow file's directory
   (`/tmp/spur-d4-dogfood/`), not the process cwd — confirmed by the fixture living outside the
   repo.

## Coverage of unit tests

Unit coverage for the same behavior: `packages/app/tests/services/workflow-service.test.ts`
(8 tests: action + guard happy paths, missing module, mis-shaped module, dry-run same host,
continue same host, abs path + `..` rejection). This dogfood confirms the wiring end-to-end
through the CLI surface the feature ships.

## Verdict

PASS — the CLI loads and evaluates YAML-declared workflow extensions as designed; bad modules
fail closed before any step.
