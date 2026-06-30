---
name: authoring-rules
description: Author new spur constraint rules — evaluator selection, real config shapes, JSON finding schema, smoke-testing.
see_also:
  - spur-rules
---

# Authoring Rules

A rule codifies one constraint as machine-checkable policy. When a new standard or anti-pattern
emerges, turn it into a rule so the gate catches it forever instead of relying on review.

## Rule anatomy

A rule file is YAML (or JSON) with an optional quoted `$schema` and a `rules:` array. Each rule:

```yaml
rules:
  - id: no-console-log          # stable identifier — NEVER rename (CI/reports/suppressions reference it)
    description: >              # the WHY, not the WHAT. A consuming agent fixes from this line alone.
      console.log leaks to stdout and breaks --json output. Use the project logger. (ADR-xxx)
    severity: error             # error | warning | info — see fine-tuning.md
    evaluator:
      type: regex               # which check to run
      config: { mode: forbid, pattern: "console\\.log\\(" }
    include: ["apps/**/src/**/*.ts"]   # rule-level globs (optional)
    exclude: ["**/*.test.ts"]
```

Norms (verified against Spur's own catalog):

- **`description` is a contract.** Encode the reason + a decision reference (`ADR-011`). Spur rules
  do this in YAML block scalars (`>`). An agent reading a finding fixes from the description.
- **Group by concern, not by mechanism.** `boundary/dao-boundary.yaml` holds all DAO rules; do not
  make an `all-regex-rules.yaml`.
- **Co-locate rationale.** A top-of-file comment explains why the file exists and any re-scoping
  ("absorbed from ts-libs, re-scoped to Spur's monorepo layout").
- **Rule IDs are stable.** Renaming an ID silently breaks every downstream reference. Pick a good
  name once.

## Evaluator selection

Pick the narrowest evaluator that expresses the constraint. Decision order:

```
Is it a structural code pattern (throw a string, await in loop, specific call shape)?
  → sg (ast-grep). AST-aware, won't match comments/strings. Requires the `sg` CLI.
Is it a text pattern (forbidden/required substring or regex)?
  → rg if the pattern is ripgrep-dialect-safe (fast, ReDoS-immune, parallel)
  → regex if it needs lookbehind (?<=) or backreferences (\1)  [rg can't compile these]
Is it about imports / package boundaries?
  → forbidden-import (block specifiers) or import-boundary (scoped architectural seams)
Is it about files existing / not existing?
  → path / file-exist
Is it about test presence for sources?
  → test-location (with a ts/python/go/rust resolver)
Is it about coverage thresholds?
  → coverage-gate (reads lcov.info)
Is it about doc comments on exports?
  → tsdoc-export
Is it a hardcoded-secret scan?
  → secrets-scanner
Is it a JSON schema artifact's structure?
  → schema-artifact
Can none of the built-ins express it?
  → exit-code: run any command, gate on its exit status (escape hatch)
```

## Real config shapes

These match Spur's live catalog and differ from the README's simplified examples — copy from here.

### regex / rg — forbidden or required text

```yaml
- id: no-debugger
  description: Do not commit debugger statements
  severity: error
  evaluator:
    type: regex                 # use `rg` instead if pattern is dialect-safe
    config: { mode: forbid, pattern: "\\bdebugger\\b" }
  include: ["apps/**/src/**/*.ts"]
```

`mode: require` flips the meaning — the finding fires when the pattern is *absent*. `rg` rules run
the real ripgrep CLI: no lookbehind, no backreferences. Use `isRipgrepCompatiblePattern(pattern)`
(exported by `@gobing-ai/ts-rule-engine`) or the `rg-migration` preset to check before promoting a
`regex` rule to `rg`.

### forbidden-import — block specifiers in a scope

The real shape uses `forbidden: [{ specifier }]` + a `scope` block (NOT a flat `forbidden: [string]`):

```yaml
- id: ts-db-only-in-domain
  description: "@gobing-ai/ts-db may only be imported inside packages/domain. (ADR-011)"
  severity: error
  evaluator:
    type: forbidden-import
    config:
      forbidden:
        - specifier: "@gobing-ai/ts-db"
        - specifier: "@gobing-ai/ts-db/schema"
      scope:
        include: ["apps/**/src/**/*.ts", "packages/config/src/**/*.ts"]
        exclude: ["**/node_modules/**", "**/tests/**"]
```

This is an **architecture fitness function** — an architectural decision (ADR-011) made into an
assertion that runs on every gate. Keep the seam honest without spending review bandwidth.

### coverage-gate — per-file line coverage

The real Spur rule uses `include`/`exclude` globs (not the README's `exemptions` array):

```yaml
- id: coverage-gate
  description: "Per-file line coverage meets 90% threshold (read from lcov)"
  severity: error
  evaluator:
    type: coverage-gate
    config:
      lcovPath: .coverage/lcov.info     # Spur writes here via bun test --coverage-dir=.coverage
      threshold: 90
      include: ["apps/**", "packages/**"]
      exclude: ["**/node_modules/**"]
```

Because it reads `lcov.info`, this rule belongs in a **post-test** preset (`recommended-post-check`),
never the pre-check — there is no coverage file before tests run.

### exit-code — the escape hatch

When no built-in fits, shell out and gate on exit status. Spur's `rg-dialect` meta-rule uses this to
scan the rule catalog itself with `rg` + `yq`:

```yaml
- id: rg-evaluator-patterns-are-ripgrep-dialect
  description: "rg-typed rules must use ripgrep dialect (no lookbehind/backreferences)."
  severity: error
  evaluator:
    type: exit-code
    config:
      command: sh
      args: ["-c", "…script that exits non-zero on violation…"]
```

This is also how you build **meta-rules** — rules that validate the rule catalog. Any required CLI
(`rg`, `sg`, `yq`) must be present in every environment that runs the gate, including CI.

## The JSON finding schema (verified against live CLI)

`spur rule run --json` emits:

```json
{
  "preset": "recommended-pre-check",
  "ruleCount": 17,
  "findings": [
    {
      "ruleId": "probe-forbid-shape",
      "severity": "error",
      "message": "forbidden pattern found: registerRuleCommand",
      "filePath": "apps/cli/src/commands/rule.ts",
      "line": 12,
      "code": "regex:found"
    }
  ],
  "fixes": []
}
```

Field notes (ground truth, not assumptions):

- `line` is **optional** — present on a forbid-match (`code: regex:found`), absent on a require-miss
  (`code: regex:missing`). Do not assume every finding has a location.
- `column` is generally **not** present. Locate by `filePath` + `line` (when present) + `message`.
- `code` is `"<evaluator>:<result>"`, e.g. `regex:found`, `regex:missing`.
- `fixes` is populated only when a rule declares `fix:` and the engine is invoked with fix authority.
  **The `spur rule run` CLI never applies fixes** — it surfaces findings. The agent reads the
  finding and makes the edit itself, then re-runs. (Library `applyFixes()` exists for programmatic
  consumers only.)

### Evaluator error vs. policy violation (first-class distinction)

A finding with `kind: "error"` and `code: "evaluator:<type>"` and `filePath: null` is **not** a code
violation — the rule itself crashed (missing `rg`/`sg`/`lcov.info`, or a misconfigured pattern). The
fix is the rule or the environment, never the source code. Filter them apart:

```ts
const evaluatorErrors = findings.filter((f) => f.kind === "error");
const violations = findings.filter((f) => f.kind !== "error");
```

## Smoke-test a new rule before trusting it

A rule you have not watched fire is a rule you do not trust. Before adding it to a gate preset, run
the shared **validate-and-smoke-test** core ([operations.md](operations.md#sub-procedure-validate-and-smoke-test)):
schema/Zod validate → run against a **should-fire** fixture (expect a finding) → run against a
**should-pass** fixture (expect none). Fixtures follow the
[convention](operations.md#fixture-convention) `.spur/rules/fixtures/<rule-id>/should-{fire,pass}.<ext>`.

```bash
spur rule validate --file path/to/new-rule.yaml --json   # 1. schema/Zod
# 2 & 3: run a FIXTURE-SCOPED copy (include → the fixture path) so the fixture is in scope:
spur rule run --file /tmp/<id>-fixture-scoped.yaml --rule <id> --fail-on info --json
```

The smoke-test copy points `include` at the in-repo fixture (the shipped `apps/`/`packages/` scope
won't match a fixture under `.spur/rules/fixtures/`); never change the shipped rule's scope to match.
Only after schema-valid AND both directions pass do you fold the rule into a preset (see
fine-tuning.md → Preset composition).
