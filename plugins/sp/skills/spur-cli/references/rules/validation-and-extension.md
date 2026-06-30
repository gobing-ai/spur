---
name: validation-and-extension
description: Validate rule files and presets, extend the engine with custom evaluators/resolvers/formatters, and the CLI-vs-library capability gaps.
see_also:
  - spur-rules
---

# Validation & Extension

## Validating before you trust

`spur rule validate` checks a rule file or preset (schema + Zod) without evaluating it. Always
validate a rule you authored or edited before wiring it into a gate.

```bash
spur rule validate .spur/rules/typescript/no-debugger.yaml --json   # validate a file
spur rule validate --preset strict-check --json                     # validate a preset
spur rule validate <path> --no-schema --json                        # skip $schema ref, Zod only
```

What it catches:

- **Schema errors** — the file violates `rule-file.schema.json` / `preset.schema.json` (e.g. unknown
  key, wrong type). The quoted `$schema` ref is resolved from the bundled package — no network.
- **Zod errors** — internal validation (e.g. a regex `config` missing `pattern`, an invalid
  severity, a preset `override` targeting a non-existent rule ID).

A preset validation also surfaces broken `extends` references (a category folder that doesn't exist)
and invalid `overrides`/`disable` targets.

**`$schema` quoting gotcha:** the value starts with `@`, which YAML treats as reserved. It must be
quoted: `$schema: "@gobing-ai/ts-rule-engine/schemas/rule-file.schema.json"`. An unquoted value is a
parse error.

### Meta-rules: validating the catalog itself

Beyond per-file validation, rules can validate the *rule catalog*. Spur ships two:

- `rg-evaluator-patterns-are-ripgrep-dialect` (`rg-migration` preset) — fails if any `type: rg` rule
  uses lookbehind/backreferences ripgrep can't compile.
- `strict/rule-files-structural` — structural integrity of the rule YAML files.

Run them as a second-order gate after editing rules:

```bash
spur rule run --preset rg-migration --fail-on error --json
```

## Extending the engine

The built-in evaluators cover most needs. When they don't, the library (`@gobing-ai/ts-rule-engine`)
supports four extension kinds: **resolvers**, **evaluators**, **fixers** (since 0.3.4), and **formatters**.
Fixer extensions may be loaded from a preset or rule file via the `extensions.fixers` block (gated by
`allowExtensions`). The other kinds are library-level APIs consumed by code that drives `RuleEngine`
directly, or by `ts-rule-engine` gaining capabilities upstream.

### Custom evaluator (direct API)

For a check no built-in expresses, register a `RuleEvaluator`:

```ts
import { RuleEngine, createFinding, type RuleEvaluator } from "@gobing-ai/ts-rule-engine";

const evaluator: RuleEvaluator = {
  async evaluate(rule, context) {
    if (!context.workdir.includes("service")) {
      return { findings: [createFinding(rule, 'workdir must include "service"', null, { code: "custom:not-service" })], fixes: [] };
    }
    return { findings: [], fixes: [] };
  },
};

const engine = new RuleEngine();
engine.registerEvaluator("workspace-name", evaluator);
```

Then a rule references it by `evaluator.type: workspace-name`.

### Preset extensions (declared modules)

A preset can declare extension modules. They are **trust-gated**: disabled unless the caller passes
`allowExtensions: true` to `loadExtensionsIntoHost()`. Without the flag, loading throws — untrusted
presets cannot silently register code.

```yaml
# preset.yaml
extensions:
  resolvers:  ["./extensions/custom-resolver.ts"]   # source→test path mapping
  evaluators: ["./extensions/custom-evaluator.ts"]  # new rule type
  formatters: ["./extensions/compact-formatter.ts"] # output rendering
```

```ts
const loaded = await loadPreset("local", { roots: [".spur/rules"] });
const engine = new RuleEngine();
await loadExtensionsIntoHost(engine.host, loaded.extensions, { allowExtensions: true });
const result = await engine.evaluate(loaded.rules, process.cwd());
```

Each registered capability is origin-tracked (`builtin`/`extension`/`caller`) so an extension cannot
silently override a built-in — conflicts are surfaced, not swallowed.

### Custom resolvers and formatters

- **Resolver** — maps a source path to its expected test path for `test-location`. Built-ins:
  `typescript`, `python`, `go`, `rust`. Author one for non-standard monorepo conventions
  (`{ name, resolveTestPath(srcRelPath) }`).
- **Formatter** — renders a `RuleEngineResult` (`{ name, format(result) }`). For team-specific or
  compact output beyond the built-in `TextFormatter`/`JsonFormatter`.

## Capability gaps (be honest about these)

The library can do more than the CLI currently exposes. When you hit a wall, the gap type tells you
the fix path:

| Capability | In library? | On `spur rule` CLI? | Fix path |
| ---------- | ----------- | ------------------- | -------- |
| Apply fixes (`applyFixes`) | Yes | **Yes** — `--fix-mode auto` applies fixes; `--fix-mode auto --dry-run` previews the diff | Task 0027. Surfaces `evaluateWithFixes` + `applyFixes` from `ts-rule-engine`. |
| Fix authority `none`/`suggest`/`auto` | Yes (`min(rule, caller)`) | **Yes** — `--fix-mode none\|suggest\|auto` | Task 0027. Maps 1:1 to library `maxFixMode`. |
| Custom evaluators/resolvers/formatters | Yes (`allowExtensions`) | **No** loading flag | Drive `RuleEngine` from code, or add upstream CLI support. |
| `EventBus` observability (`rule.*` events, `durationMs`) | Yes | **No** | Library-only; for progress bars/dashboards. |
| Custom **fixer** providers | **Yes** (`extensions` includes `fixers` since `ts-rule-engine@0.3.4`) | **Yes** (loads via preset or rule-file `extensions.fixers` with `allowExtensions`) | Task 0027 (catalog bump to 0.3.4). Upstream: ts-libs 0023 moved fixers onto the host registry. |
| FP/FN rate tracking | **No** | No | Tool gap. Convention: track in YAML comments. |
| Rule-ID rename migration | **No** | No | Tool gap. Don't rename IDs. |

**Per project policy:** when `ts-rule-engine` can't support a Spur need cleanly, prefer enhancing the
shared package upstream over leaking a workaround into Spur. The remaining gaps above (custom
evaluator loading via CLI flag, `EventBus` observability, FP/FN tracking, rule-ID migration) are
`ts-rule-engine` evolution candidates or future CLI surface growth.
