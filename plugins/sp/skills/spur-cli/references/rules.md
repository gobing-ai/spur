---
name: spur-cli-rules
description: "spur-cli noun reference: operate `spur rule` as the project's constraint quality gate across its full lifecycle — run presets, author rules, fine-tune for delivery quality, validate rule files and preset schemas, and extend the engine. The deterministic verifier in the LLM code-delivery loop."
see_also:
  - spur-cli
---

# spur rule — the constraint quality gate

`spur rule` runs declarative YAML constraint rules (powered by `@gobing-ai/ts-rule-engine`) over the
working tree and reports policy violations. It is the **deterministic verifier** in an LLM delivery
loop: a coding agent is overconfident, the rule engine is not. Putting the deterministic check inside
the agent's loop catches forbidden patterns, missing tests, leaked secrets, broken import boundaries,
and coverage regressions that the agent would otherwise confidently ship.

Operating the gate well is a full lifecycle — not just running it. This skill covers all of it.

## Lifecycle map

| Phase | Activity | Where |
| ----- | -------- | ----- |
| **Run & fix** | Gate the diff, interpret findings, self-correct, re-run until green | this file |
| **Author** | Add a constraint by writing a new rule when a standard/anti-pattern emerges | [rules/authoring-rules.md](rules/authoring-rules.md) |
| **Fine-tune** | Dial in quality: severity, glob scoping, exemptions, preset `disable`/`overrides`, layering | [rules/fine-tuning.md](rules/fine-tuning.md) |
| **Validate & extend** | Validate files/presets, smoke-test, add custom evaluators/resolvers/formatters | [rules/validation-and-extension.md](rules/validation-and-extension.md) |

## When to use

Use this skill to:

- **Gate generated code** — run a preset over changes before declaring a task done or committing.
- **Add a constraint** — codify a new rule (forbidden pattern, import boundary, required test,
  coverage floor) so the gate enforces it forever. → authoring-rules.md
- **Fine-tune delivery quality** — adjust severity, scope a rule to kill false positives, exempt a
  legitimate case, or re-tune an inherited rule via preset `overrides`. → fine-tuning.md
- **Validate before trusting** — schema/Zod-check a rule file or preset; smoke-test a new rule
  against known-good/known-bad files. → validation-and-extension.md
- **Extend the engine** — write a custom evaluator/resolver/formatter when built-ins fall short.
  → validation-and-extension.md
- **Interpret a failing gate** — turn `ERROR <rule-id> <file>:<line>` into the exact fix, re-run.

## Operations

The skill's logic divides by **whether the LLM adds value**:

- **Direct CLI** (`run`, `validate`, `list`) — deterministic, single-verb commands. Run them
  straight: `spur rule run`, `spur rule validate`, `spur rule list`. A slash-command wrapper here
  would only forward flags and add drift; **there is no command for these — use the CLI**. The skill
  still drives them when asked in natural language (e.g. interpreting findings, the fix loop below).
- **Agent-driven** (`scan`, `add`, `refine`) — convert fuzzy human intent into a reliable sequence the
  CLI cannot express as one verb. `scan` discovers candidate rules; `add`/`refine` author and tune
  them. These are the operations worth a slash command, and the skill owns all their logic. Full
  procedures: [rules/operations.md](rules/operations.md).

| Operation | Backed by | Input | Output (done-when) |
| --------- | --------- | ----- | ------------------ |
| `run` | `spur rule run` (CLI) | `[--preset <name>] [--rule <id>] [--file <path>] [--fail-on <sev>] [--stop-on-first [<sev>]] [--fix-mode none\|suggest\|auto] [--dry-run] [--verbose]` | Gate to exit 0; findings interpreted, code fixed, re-run clean (the harness loop below) |
| `validate` | `spur rule validate` (CLI) | `[file-or-preset] [--file <path>] [--preset <name>] [--kind file\|preset] [--no-schema]` | Schema + Zod verdict |
| `list` | `spur rule list` (CLI) | `[--preset <name>]` | Discovered files + source layer, or resolved rules for a preset |
| `trace` | `spur rule trace` (CLI) | `[run-id] [--preset <name>] [--status done\|failed] [--since <iso>] [--last <n>]` | Persisted rule-run history / per-run detail |
| `scan` | agent procedure | `[<path-or-glob>]` | **Propose-only** discovery: surveys code for recurring anti-patterns, clusters them, filters against the catalog, and reports ranked rule candidates (`add` new / `refine`-extend / already-covered). Authors nothing → [scan](rules/operations.md#scan) |
| `add` | agent procedure | `"<nl-description>" [--file <path>] [--preset <target>]` | **First reconciles against the existing catalog** (extend/refine an existing rule rather than duplicate, on confirmation); only a genuinely new concern is authored, then **validated AND smoke-tested both directions** (fires on bad, quiet on good); optionally wired into a preset → [add](rules/operations.md#add) |
| `refine` | agent procedure | `<rule-file-or-preset> [--intent "<goal>"] [--severity <sev>] [--scope <glob>] [--exempt <path>] [--disable <id>] [--override <id>] [--dry-run]` | Smallest change meeting the intent, re-validated and re-smoke-tested; `--dry-run` emits a diff only → [refine](rules/operations.md#refine) |

`scan`, `add`, and `refine` are not CLI verbs. `add`/`refine` compose `validate` + `run` around a
generated/edited YAML rule and both end in the same **validate-and-smoke-test** core
([operations.md](rules/operations.md#sub-procedure-validate-and-smoke-test)) so a tightened rule
is verified exactly like an authored one. They also share the **find-existing-coverage** core
([operations.md](rules/operations.md#sub-procedure-find-existing-coverage)): `add` runs it up
front (don't duplicate), `refine` runs it to locate a target and to catch overlap after a widening,
and `scan` runs it to filter candidates against the catalog. Behavioral rule-testing (does a rule fire
correctly?) is not a standalone operation — it **is** the verify core, invoked by `add` and `refine`.

## The harness loop (run → interpret → fix → re-run)

```
generate / edit code
        │
        ▼
spur rule run --preset recommended-pre-check --json   ← deterministic gate
        │
   exit 0? ──yes──▶ proceed to tests / commit
        │ no
        ▼
parse findings[] → apply the SPECIFIC fix per finding → re-run
        │
        └──────────── loop until exit 0 ◀──────────────
```

Two signals, two purposes: the **exit code** is the binary pass/fail (the gate); the **`findings[]`**
carry the actionable detail (what to fix). Always use `--json` when an agent consumes the result.

### Step 1: Run

```bash
spur rule run --json                                              # fast inner-loop (default preset)
spur rule run --preset recommended-pre-check --fail-on error --json
spur rule run --preset recommended-post-check --fail-on error --json   # final gate (after tests)
```

`spur rule run` exits non-zero when a finding meets `--fail-on` (default `error`). A non-zero exit
means **not done**. `--stop-on-first error` fails fast while iterating; drop it for the final pass to
surface every violation.

### Step 2: Interpret

Each finding has `ruleId`, `severity`, `message`, `filePath`, optional `line`, and `code`. Two kinds:

- **Policy violation** — code broke a rule. Fix the code.
- **Evaluator error** (`kind: "error"`, `code: "evaluator:<type>"`, `filePath: null`) — the rule
  crashed (missing `rg`/`sg`/`lcov.info`, or a bad pattern). Fix the rule or the environment, **not**
  the code. This distinction is first-class — never edit source to silence a broken rule.

Full JSON schema and field nuances (e.g. `line` is present on forbid-matches, absent on
require-misses): [rules/authoring-rules.md](rules/authoring-rules.md).

### Step 3: Fix and re-run

Fix the *specific* violation the finding names — no drive-by refactors — then re-run the same
command. By default, `spur rule run` surfaces findings only; the agent makes the edit and re-runs.
Loop until exit 0.

**`--fix-mode` shortcut:** when the violation is mechanically fixable (e.g. a regex replacement),
`spur rule run --fix-mode auto` applies the fix and reports the result. The exit code still reflects
the *findings* (not whether fixes were applied), so re-run to confirm green. `--fix-mode suggest`
surfaces candidate fixes in `--json` output without writing.

## Command surface

```
spur rule run      [--preset <name>] [--file <path>] [--rule <id>] [--fail-on <sev>] [--stop-on-first [<sev>]] [--fix-mode <none|suggest|auto>] [--dry-run] [--verbose] [--json]
spur rule validate [file-or-preset] [--file <path>] [--preset <name>] [--kind file|preset] [--no-schema] [--json]
spur rule list     [--preset <name>] [--json]
spur rule trace    [run-id] [--preset <name>] [--status done|failed] [--since <iso-date>] [--last <n>] [--json]
```

Default preset is `recommended-pre-check`. `--fail-on`/`--stop-on-first` take `error|warning|info`.
List what is actually enforced before assuming — presets are layered (project shadows bundled):

```bash
spur rule list --json                                    # discovered files + source layer
spur rule list --preset recommended-pre-check --json     # resolved rules for one preset
spur rule trace --last 10 --json                         # recent rule runs
spur rule trace <run-id> --json                          # per-run detail
```

Repo presets: `recommended-pre-check` (inner loop), `recommended-post-check` (final, adds coverage),
`strict-check` (hardened boundaries), `rg-migration` (ripgrep-dialect guard). Rationale for the
ordering and how to compose a new preset: [rules/fine-tuning.md](rules/fine-tuning.md).

## Behavior

This skill behaves as a **reviewer** (apply a deterministic rule set, return ranked findings) feeding
a **pipeline** (gate → interpret → fix → re-run until green). It also covers authoring/tuning the
rules the reviewer applies. It does not generate feature code; it constrains code another agent wrote.

## Gotchas

1. **Exit code is the source of truth, not the printed text.** A clean-looking run still exits
   non-zero if a finding meets `--fail-on`. Check the exit code / `--json` summary before claiming
   the gate passed.
2. **Evaluator errors are not policy violations.** `code: "evaluator:<type>"` + `filePath: null`
   means a tool is missing or the rule is misconfigured — fix the rule/environment, not the source.
3. **Don't game the gate.** An LLM will try the cheapest path to "passed": adding `biome-ignore`,
   deleting a test, lowering `--fail-on`, or excluding the offending file. Each defeats the harness.
   The `no-biome-suppressions` meta-rule exists specifically to catch suppression-to-pass. Fix root
   causes.
4. **`rg` uses ripgrep dialect — no lookbehind/backreferences.** A `type: rg` rule with `(?<=...)`
   or `\1` won't compile. Keep it on `type: regex`, or run the `rg-migration` preset to catch it.
   `isRipgrepCompatiblePattern()` (library export) checks a pattern before promotion.
5. **`line` is optional on findings.** Present on forbid-matches, absent on require-misses. Don't
   assume every finding has a location; locate by `filePath` + `message`.
6. **Real config shapes differ from the README's simplified examples.** `forbidden-import` uses
   `forbidden: [{specifier}]` + `scope`; `coverage-gate` uses `include`/`exclude` globs. Copy from
   `.spur/rules/` or authoring-rules.md, not from a half-remembered snippet.
7. **`$schema` must be quoted** — it starts with `@`, which YAML reserves. Unquoted is a parse error.
8. **Presets are layered.** A surprising finding may come from a shadowing project rule. Run
   `spur rule list --preset <name>` to see the resolved set and its source layer.

## Additional Resources

- [rules/operations.md](rules/operations.md) — the operation procedures
  (run/scan/add/refine/validate/list), the shared find-existing-coverage and validate-and-smoke-test
  cores, and the fixture convention. The entry point for slash-command delegation.
- [rules/authoring-rules.md](rules/authoring-rules.md) — add constraints: evaluator
  selection, real config shapes, the JSON finding schema, smoke-testing a new rule.
- [rules/fine-tuning.md](rules/fine-tuning.md) — dial in quality: severity, glob scoping,
  exemptions, preset `extends`/`disable`/`overrides`, layering, governance.
- [rules/validation-and-extension.md](rules/validation-and-extension.md) — validate files
  and presets, custom evaluators/resolvers/formatters, and the CLI-vs-library capability gaps.
- `@gobing-ai/ts-rule-engine` README — authoritative library reference (every evaluator, fixer,
  preset mechanism, observability event).
- `.spur/rules/` — this repo's live rule catalog; copy real config shapes from here.

## Platform Notes

### Claude Code
Run `spur rule` via the Bash tool. During development the CLI entry is a `.ts` file that runs only
under Bun: `bun run apps/cli/src/index.ts rule run --json`. The installed `spur` binary works once
built.

### Codex / OpenClaw / OpenCode / Antigravity
Run `spur rule ...` via the Bash tool; parse `--json` output programmatically. Arguments are passed
directly on the command line.

---

**Template type**: technique
**Purpose**: Operate `spur rule` across its full lifecycle as the deterministic constraint gate in LLM code delivery
