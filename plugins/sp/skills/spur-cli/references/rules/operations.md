---
name: operations
description: Named operation procedures (run/scan/add/refine/validate/list), the shared find-existing-coverage and validate-and-smoke-test cores that back the spur rule slash commands.
see_also:
  - spur-cli
---

# Operations

The skill's operations as discrete procedures. The deterministic ones (`run`, `validate`, `list`) are
direct CLI verbs — documented briefly here for completeness, but you run them straight (no slash
command). The agent-driven ones (`scan`, `add`, `refine`) convert fuzzy intent into a reliable
sequence and are what the slash commands delegate to; their full steps live below.

A rule you have not watched fire is a rule you do not trust. So both `add` and `refine` end in the
same verification core ([validate-and-smoke-test](#sub-procedure-validate-and-smoke-test)) — that
shared core is why a tightened rule is re-checked exactly like a freshly authored one. Behavioral
rule-testing ("does this rule fire correctly?") is that core, not a separate operation. `scan`, `add`,
and `refine` also share the [find-existing-coverage](#sub-procedure-find-existing-coverage) core so the
catalog never diverges no matter which operation touches it.

## Fixture convention

Smoke-testing needs a file the rule **should fire on** and a file it **should stay quiet on**. Without
a convention, fixtures are invented ad-hoc and verification is not reproducible. Convention:

```
.spur/rules/fixtures/<rule-id>/should-fire.<ext>   # MUST produce a finding
.spur/rules/fixtures/<rule-id>/should-pass.<ext>   # MUST produce no finding
```

`<ext>` matches the rule's target (`.ts` for a TS rule, `.yaml` for a meta-rule, etc.). Keep fixtures
minimal — the smallest snippet that exercises the constraint. If a caller supplies `--fixture-fire` /
`--fixture-pass`, use those paths instead; otherwise default to the convention. When neither exists,
synthesize a fire fixture from the rule's own pattern/intent and a pass fixture by negating it, write
them to the convention path, then run the core.

**Fixtures must live inside the repo** (`.spur/rules/fixtures/...`) — the engine scans relative to the
working tree, so an out-of-repo fixture (e.g. under `/tmp`) silently never fires. **Smoke-test runs
use a copy of the rule with `include` pointed at the fixture fragment** (e.g. `fixtures/<rule-id>`),
not the shipped rule's `apps/`/`packages/` scope — otherwise the fixture is out of scope and the
fire-test produces a false negative. The shipped rule's scope is never changed to accommodate a
fixture. (Verified: an in-repo fixture matched by any distinctive path fragment fires correctly; an
out-of-repo fixture does not.)

## Sub-procedure: find-existing-coverage

Reconciliation core — run this **before authoring anything**. Authoring without checking the catalog
breeds redundant, diverged, and contradictory rules (two `no-console` variants, one rule for `apps/**`
and a twin for `packages/**`, the same concern at conflicting severities). In a layered preset system
that is silent conflict, not just noise. Inputs: the clarified constraint (one checkable sentence).
Steps:

1. **Enumerate the catalog** — `spur rule list --json` for every rule ID + source layer, plus grep the
   rule files for evaluator `type`, `pattern`/`specifier`, and `scope`/`include` so matches are found
   by *substance*, not just by ID text.
2. **Classify the strongest match** against the new constraint:

   | Match | Meaning | Action |
   | ----- | ------- | ------ |
   | Exact / near-duplicate | A rule already enforces this concern on this scope | **STOP — do not add.** It is covered; if behavior is off, hand to [refine](#refine). |
   | Same concern, different scope | A twin exists for other paths/specifiers | **EXTEND** — widen the existing rule's globs / add the specifier. One rule, not two. |
   | Adjacent, same category/file | A sibling rule lives in the file this concern belongs to | **ADD into the existing file** (group by concern); reuse the category's preset wiring. |
   | No real match | Genuinely new concern | **ADD new** — the only branch that authors from scratch. |

3. **extend vs. refine boundary** (they are close): **extend** = the rule should now *also* cover this
   case (same intent, wider net → broaden scope / add specifier). **refine** = the rule's *behavior*
   is wrong (same net, better tuned → severity/scope/FP-FN). If the match means "already covered, you
   want it tuned," that is refine, not add.
4. **Recommend + confirm** — report the strongest match, the classification, and the recommended
   action (extend / refine / add-into-file / add-new). **Require user confirmation before acting** —
   surface the conflict; the human decides. Never silently duplicate, and never silently edit a rule
   the user did not name.

Output contract: `{ match: rule-id|none, classification, recommendation, evidence }` + the confirmed
action to take.

## Sub-procedure: validate-and-smoke-test

The shared verification core. Inputs: a rule file path + a rule ID. Steps:

1. **Schema/Zod validate** — `spur rule validate --file <rule-file> --json`. On error, surface
   root-cause + fix (see [validate](#validate)); stop until clean. The most common error is an
   unquoted `$schema` (`@` is YAML-reserved).
2. **Smoke-test FIRE** — write a copy of the rule whose `include` points at the fire fixture
   (the shipped scope won't match an in-repo fixture — see [fixture convention](#fixture-convention)),
   then `spur rule run --file <fixture-scoped-rule> --rule <id> --fail-on info --json`. **Expect a
   finding.** Zero findings means the rule does not catch what it claims — a false negative; fix the
   pattern. (Verify the *pattern*, not the shipped scope.)
3. **Smoke-test PASS** — same fixture-scoped rule against the pass fixture; **expect zero findings**.
   A finding here is a false positive — fix the pattern (the shipped `include`/`exclude` is tested
   separately by scoping precision, not by the fixture).
4. **Report** — `{ schemaValid, firedAsExpected, falsePositiveFree }`. The rule is verified only when
   all three are true.

> The fixture must be in the rule's scope, or it cannot fire. A rule scoped to `apps/...` won't match
> a fixture under `.spur/rules/fixtures/<id>/` — and for content-scanning evaluators (`regex`/`rg`/
> `forbidden-import`/`secrets-scanner`) `include` is matched as a **substring/suffix fragment**, not a
> true glob (see [fine-tuning.md → loose-match footgun](fine-tuning.md#glob-scoping-the-fpfn-dial)),
> so the fixture path must contain the rule's scope fragment. Two safe options: (a) keep fixtures
> under a path the rule's scope already covers, or (b) for the smoke-test run only, point `include` at
> the fixture path — **never widen the shipped rule's scope to make a fixture match.**

## run (direct CLI — the harness loop)

`spur rule run` is a direct CLI verb; there is no slash command for it. The skill drives the loop when
asked in natural language. Detailed in SKILL.md → "The harness loop". Procedure:

1. `spur rule run [--preset <name>] [--rule <id>] [--file <path>] [--fail-on <sev>] [--stop-on-first [<sev>]] [--fix-mode <none|suggest|auto>] [--dry-run] --json`
2. Read the exit code (binary gate) AND `findings[]` (actionable detail).
3. Split findings: policy violations (fix the code) vs. evaluator errors
   (`kind: "error"`, `code: "evaluator:<type>"`, `filePath: null` — fix the rule/environment).
4. Apply the **specific** fix per violation — no drive-by refactors. By default the CLI surfaces
   findings only; use `--fix-mode auto` to apply mechanically fixable violations, then re-run to
   confirm green.
5. Re-run the same command. Loop until exit 0.

Output contract: exit code + parsed findings + violation/evaluator-error split + per-finding fix + optional `fixes[]`/`applied` (when `--fix-mode` ≠ `none`).

## add

Turn a natural-language constraint into a validated, smoke-tested rule. Procedure:

1. **Clarify intent** — restate the constraint as one checkable sentence. If the description is
   ambiguous (which paths? forbid or require? which severity?), state the interpretation taken.
2. **Reconcile against the catalog** — run [find-existing-coverage](#sub-procedure-find-existing-coverage).
   This is mandatory and gating: if it finds the concern already covered, **stop and hand to refine
   (or extend the existing rule) on confirmation** — do not author a redundant rule. Only the
   "no real match" branch proceeds to author from scratch below.
3. **Select evaluator** — apply the decision tree in
   [authoring-rules.md → Evaluator selection](authoring-rules.md#evaluator-selection)
   (`sg` for structural, `rg`/`regex` for text, `forbidden-import`/`import-boundary` for imports,
   `path` for files, `coverage-gate`/`test-location`/`tsdoc-export`/`secrets-scanner`/`schema-artifact`
   for their specific concerns, `exit-code` as the escape hatch).
4. **Write config** — use the **real config shapes** from
   [authoring-rules.md → Real config shapes](authoring-rules.md#real-config-shapes)
   (not the README's simplified ones). Set `id` (stable, kebab), `description` (the WHY + decision
   ref), `severity` (see [fine-tuning.md → Severity](fine-tuning.md#severity-calibration)), and tight
   `include`/`exclude`. Quote `$schema`.
5. **Place the file** — default `.spur/rules/<category>/<rule-id>.yaml`, grouped by concern (a
   `--file` arg overrides). One file per concern, not per mechanism.
6. **Verify** — run the [validate-and-smoke-test core](#sub-procedure-validate-and-smoke-test). Not
   done until all three checks pass.
7. **Wire into preset (optional)** — if `--preset <target>` was given, add the rule's category to the
   preset's `extends` (if not already present), or add the rule file under an extended category. Then
   `spur rule validate --preset <target> --json` to confirm the preset still resolves. Re-tuning an
   inherited rule uses `overrides`, not duplication.

Output contract: YAML rule content + destination path + smoke-test result (both directions) + validate
result. Done only when validate passes AND both smoke-test directions pass.

## refine

Tighten or adjust an existing rule/preset with the smallest change that meets the intent. Procedure:

1. **Locate the target** — if a rule file/preset is named, load it. If the user describes a *concern*
   instead ("the import-boundary rule is too noisy"), run
   [find-existing-coverage](#sub-procedure-find-existing-coverage) to resolve which rule they mean
   before editing. Read its current shape.
2. **Identify the dimension** from `--intent` and flags:
   - false positive → tighten `include` or add `exclude` (`--scope`, `--exempt`)
   - false negative → broaden `include` or fix the pattern
   - wrong blocking behavior → `--severity`
   - inherited rule wrong for this project → preset `--disable <id>` or `--override <id>`
   See [fine-tuning.md](fine-tuning.md) for each mechanism's real shape.
3. **Apply the smallest change.** Add a rationale comment for any exemption (`# <path> is the one
   place X is allowed (ADR-n)`). Never widen scope merely to pass a gate — that is gate-gaming.
   **For any `exclude`/`--exempt` change, apply exclusion discipline**
   ([fine-tuning.md → Exclusions are exceptions, not a whitelist](fine-tuning.md#exclusions-are-exceptions-not-a-whitelist)):
   each exclusion must be the narrowest possible, carry a one-line justification, and leave the rule
   still firing on the cases it must catch. If a rule needs ever more exclusions, re-scope or split it
   rather than carving further — accumulating carve-outs turns a blocklist into a de-facto allowlist.
4. **Preview if `--dry-run`** — emit a unified diff of the YAML change and stop (no write). This is a
   skill-level output; the CLI has no dry-run for edits.
5. **Verify** — run the [validate-and-smoke-test core](#sub-procedure-validate-and-smoke-test). A
   refine that improves FP/FN must prove it: the fixture that previously misbehaved now behaves.
6. **Overlap check (only when the change LOOSENS or WIDENS)** — broadening scope, relaxing a pattern,
   or lowering severity can make this rule collide with or subsume a sibling — the inverse of add's
   duplicate problem. Run [find-existing-coverage](#sub-procedure-find-existing-coverage) on the
   *widened* rule; if it now overlaps another rule's concern/scope, **stop and report the collision**,
   recommending which rule should own the overlap (merge, or keep the boundary). Require confirmation
   before persisting a widening that overlaps. Tightening/narrowing changes skip this step.
7. **Confirm preset (if target was a preset)** — `spur rule validate --preset <name> --json`.

Output contract: diff of the change + validate result + smoke-test result (both directions) + overlap
verdict on widening changes. With `--dry-run`, the diff only.

## scan

Proactive pattern discovery — survey the codebase for **recurring anti-patterns that should become
rules**, so the catalog gets ahead of defects instead of only reacting to them. **Propose-only:**
`scan` discovers and recommends candidates; it does **not** author. Each accepted candidate flows to
[add](#add) (which reconciles against the catalog) on confirmation. This keeps broad/fuzzy discovery
cleanly separated from precise/gated authoring. Procedure:

1. **Scope the survey** — default to changed/working-tree code; accept a path/glob to bound it. Heavy
   scans should run in a forked sub-context so raw output stays out of the main window.
2. **Hunt recurring patterns** — look for smells that *repeat* (a one-off is not a rule):
   - the same forbidden construct in multiple files (`console.log`, `debugger`, `as any`, raw `throw "string"`)
   - ad-hoc boundary violations (a package importing something it shouldn't, repeated)
   - modules with no corresponding test (systematic, not a single gap)
   - inconsistent conventions applied unevenly (naming, error handling, logging)
   Use `rg`/`sg` to count occurrences — evidence is the number of hits across files.
3. **Cluster into candidate concerns** — group hits by the single concern they imply, and for each
   pick the evaluator that would catch it ([authoring-rules.md → Evaluator selection](authoring-rules.md#evaluator-selection)).
4. **Filter against the catalog** — run [find-existing-coverage](#sub-procedure-find-existing-coverage)
   per candidate. Drop concerns already enforced; mark ones that an existing rule should *extend*
   (→ refine/extend) vs. genuinely new (→ add).
5. **Rank and report** — order candidates by occurrence count × severity-of-concern. For each:
   the concern, evidence (hit count + sample files), proposed evaluator, and the recommended route
   (`add` new / `refine`-extend existing / skip-already-covered). **Author nothing.**

Output contract: a ranked list of rule candidates, each with `{ concern, evidence, evaluator,
route: add|extend|covered }`. The user picks which to act on; accepted ones hand off to `add`/`refine`.

## validate / list (direct CLI — no command, no procedure)

Deterministic single-verb CLI calls. Run them straight; the skill interprets results when asked.

- `spur rule validate [--file <path>|--preset <name>|<path>] [--no-schema] --json` — schema + Zod
  check. Classify any error as **schema** (violates `rule-file.schema.json`/`preset.schema.json` —
  often an unquoted `$schema`, `@` reserved) vs. **Zod** (regex `config` missing `pattern`, invalid
  severity, a preset `override`/`disable`/`extends` targeting something that doesn't exist). The
  `validate-and-smoke-test` core calls this as step 1.
- `spur rule list --json` — discovered rule files + source layer (project/user/bundled).
- `spur rule list --preset <name> --json` — the resolved rule set for one preset (after layering).

Use `list` before `refine` to see which rules (and which shadowing layer) are actually in effect.
