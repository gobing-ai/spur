---
name: fine-tuning
description: Dial in delivery quality — severity, glob scoping, exemptions, preset composition, layering, governance.
see_also:
  - spur-cli
---

# Fine-Tuning Rules and Presets

Authoring a rule is half the work; dialing it in so it catches real problems without crying wolf is
the other half. A gate with a high false-positive rate gets ignored, and an ignored gate is worthless.

## Severity calibration

Severity drives the `--fail-on` gate. Choose by blast radius:

| Severity | Use when | Gate behavior |
| -------- | -------- | ------------- |
| `error` | Breaks delivery: security, architecture seam, broken build | Blocks at `--fail-on error` (default) |
| `warning` | Should fix, won't break prod: style, missing docs | Blocks only at `--fail-on warning` |
| `info` | Advisory / informational | Blocks only at `--fail-on info` |

Default `--fail-on error` means warnings and info never fail the gate unless you ask. Reserve `error`
for things you are willing to block a commit on; over-using `error` trains people to bypass the gate.

## Glob scoping: the FP/FN dial

The single biggest source of false positives is a loose include glob; the biggest source of false
negatives is a missing nesting level.

- **Tighten `include`** to exactly the files the rule should police. A boundary rule for app source
  is `apps/**/src/**/*.ts`, not `apps/**`.
- **`exclude` the legitimate exceptions**: tests, generated code, the one package allowed to break
  the rule. Spur's `ts-db-only-in-domain` excludes `**/tests/**` and the domain schema dir.
- **Loose-match footgun (`regex`/`rg`/`forbidden-import`/`secrets-scanner`).** These evaluators match
  files in *loose* mode: the engine strips every `*`/`**` from your glob and matches the remainder by
  **substring / suffix**, not by true glob. So `apps/**/src/**/*.ts` effectively becomes the fragment
  `apps/src/.ts` and matches any path containing it. Practical consequences: write `include` as a
  **distinctive path fragment** (`apps/cli/src`, `/src/`, `.ts`) and lean on `exclude` for carve-outs;
  don't assume a precise multi-level glob narrows the way it reads. `coverage-gate`, `test-location`,
  and `path` use stricter glob matching — the loose behavior is specific to the content-scanning
  evaluators above. (Verified against `ts-rule-engine` `matchesAny`.)

Rule-level `include`/`exclude` scopes one rule; some evaluators (`forbidden-import`,
`coverage-gate`) take their own `scope`/`include` inside `config` — use the evaluator's own scoping
when present (see authoring-rules.md for the real shapes).

## Exemptions for known-legitimate cases

When one file legitimately violates a rule, prefer a scoped `exclude` with a rationale comment over
disabling the whole rule:

```yaml
evaluator:
  type: forbidden-import
  config:
    scope:
      include: ["packages/**/src/**/*.ts"]
      exclude:
        - "packages/domain/src/schema/**"   # the ONE place drizzle is allowed (ADR-011)
```

Never widen `exclude` just to make the gate green — that is gate-gaming (see SKILL.md gotchas).

### Exclusions are exceptions, not a whitelist

The chronic failure mode of refining is **exclusion creep**: each carve-out looks justified on its own,
but they accumulate until the rule's `exclude` hollows out its `include` and the rule enforces almost
nothing — a blocklist degraded into a de-facto allowlist. The per-change overlap check does not catch
this (it guards rule-vs-rule collision, not erosion of a rule's own coverage), so guard it explicitly
when adding any exclusion:

- **Every exclusion earns its place.** It needs a specific, documented reason — the legitimate case
  *and* why it is legitimate (`# the ONE place X is allowed (ADR-n)`), not a bare path. An exclusion
  you cannot justify in one line does not belong.
- **Narrowest possible.** Exclude a single file or the one directory that genuinely must be exempt —
  never a broad glob that silences a whole tree to dodge one finding.
- **Accumulation is a smell, not a solution.** When a rule keeps needing more exclusions, the rule's
  scope is wrong: re-scope its `include`, split it into concern-specific rules, or reconsider whether
  the policy holds — do not keep carving. A rule whose exclusions cover most of its scope should be
  re-scoped or retired, not extended.
- **Test the net.** After adding an exclusion, confirm the rule still fires on the cases it must catch
  (the should-fire fixture still fires); an exclusion that also suppresses a real violation is a
  false negative, not an exemption.

## Preset composition

A preset bundles rules for a lifecycle stage. The shape (verified against Spur's presets):

```yaml
$schema: "@gobing-ai/ts-rule-engine/schemas/preset.schema.json"
name: recommended-post-check
extends:                # category DIRECTORIES or other presets, resolved across roots
  - quality
  - surface
disable:                # suppress an inherited rule that doesn't fit this project
  - legacy-rule
overrides:              # re-tune an inherited rule without forking it
  no-console-log:
    severity: warning
    fix: { mode: suggest }
```

- **`extends`** pulls in whole category folders (`quality/`, `surface/`) or named presets.
- **`disable`** turns off an inherited rule by ID.
- **`overrides`** changes severity or fix mode of an inherited rule in place — the lever for
  project-specific tuning without copying the rule.

## Lifecycle-stage presets (Spur's actual layout)

| Preset | Stage | Why it exists |
| ------ | ----- | ------------- |
| `recommended-pre-check` | inner loop, before tests | Fast: style, boundaries, structure. No coverage (no lcov yet). |
| `recommended-post-check` | after tests | Adds `coverage-gate` (needs `.coverage/lcov.info`) + export docs + CLI surface. |
| `strict-check` | optional deep audit | Hardened runtime/http/rule-file structural boundaries. |
| `rg-migration` | on-demand, transitional | Meta-rule guarding `rg` patterns against ripgrep-incompatible constructs. |

**Gate ordering rationale (not arbitrary):** cheap, always-available checks run first (pre-check);
checks that need produced artifacts run after the step that produces them (coverage-gate after
tests). This minimizes feedback latency — you fail on a style violation in seconds, not after a full
test run.

## Layering — project shadows bundled

Rule roots resolve highest-priority-first: project `.spur/rules/` → user-global
(`~/.config/spur/rules`) → bundled (shipped with the package). If two roots contain the same relative
rule path, the **first wins** and lower roots fill gaps. This is why a project can shadow a single
bundled rule file while inheriting the rest of the catalog.

Confirm what is actually resolved before assuming:

```bash
spur rule list --json                          # discovered files + their source layer
spur rule list --preset recommended-pre-check --json   # the resolved rule set for one preset
```

## Governance & evolution

- **Where does a rule live?** Project-specific policy → `.spur/rules/`. A rule useful to every
  consumer of `ts-rule-engine` → propose it upstream in the shared library (per the project's
  shared-library evolution principle), don't fork it locally.
- **Track false positives.** There is no built-in FP tracking (a tool gap). Convention: log FP
  incidents in a YAML comment on the rule; if a rule cannot be tuned below an acceptable FP rate,
  retire it — a noisy rule erodes trust in the whole gate.
- **Link intent to decisions.** `description` carries the one-line why; reference the governing ADR
  so a future maintainer (human or agent) understands the rule before changing it.
- **Meta-rules keep the catalog honest.** `rg-migration` and the `strict/rule-files-structural`
  rules validate the rule files themselves — rule governance as code.
