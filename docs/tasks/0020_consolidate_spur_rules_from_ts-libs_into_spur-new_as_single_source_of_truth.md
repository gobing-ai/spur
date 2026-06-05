---
name: consolidate_spur_rules_from_ts-libs_into_spur-new_as_single_source_of_truth
description: consolidate_spur_rules_from_ts-libs_into_spur-new_as_single_source_of_truth
status: Done
created_at: 2026-06-05T19:42:35.555Z
updated_at: 2026-06-05T22:35:02.906Z
folder: docs/tasks
type: task
feature-id: ""
priority: medium
estimated_hours: 2
tags: ["spur","spur-rules",".spur","single-source-of-truth","coverage-gate","no-biome-suppressions","quality-gate","curation"]
impl_progress:
  planning: done
  design: done
  implementation: done
  review: done
  testing: done
preset: simple
---

## 0020. consolidate_spur_rules_from_ts-libs_into_spur-new_as_single_source_of_truth

### Background

Goal: make `~/xprojects/spur-new/.spur/rules/` the **single source of truth** for the Spur quality-gate ruleset, by closing the remaining gaps against the rules that still live only in `ts-libs/.spur/rules/`.

**Important — most of the harvest is already done.** A prior pass already absorbed and *adapted* (not blindly copied) the ts-libs rules that matter to an application repo. Each absorbed file carries an explicit `# Absorbed from ts-libs/.spur/rules/...` header documenting the re-scoping and any deliberate omissions. Do NOT re-copy these; they are the canonical spur versions and are more evolved than the ts-libs originals:

| ts-libs rule | spur-new canonical | Notes |
|---|---|---|
| `typescript/runtime-boundaries` | `strict/runtime-boundaries` | re-scoped to `apps/**`+`packages/**`, severities relaxed to `warning`, sanctioned-site allowlists added, `no-direct-process-env` intentionally dropped (config-from-env is Spur's design) |
| `typescript/db-boundaries` | `boundary/dao-boundary` | recast for the `spur-domain` facade (ts-db only inside `packages/domain`) |
| `typescript/bun-only` | `typescript/bun-tooling` | re-scoped, allows the server's sanctioned Cloudflare Vitest `*.cf.ts` |
| `typescript/no-raw-output` | `typescript/output-boundaries` | same rule ids (`no-console-output`, `no-raw-stdout-stderr`) |
| `typescript/external-api-boundaries` | `strict/http-boundaries` | same rule ids (`no-direct-fetch`, `no-globalthis-fetch`, `no-xml-http-request`, `no-third-party-http-clients`) |
| `meta/rule-files-structural` | `strict/rule-files-structural` | adds `yq`/`rg` PATH skip-guards |
| `structure/test-location` | `structure/test-location` | local override; project-specific excludes |
| `structure/protected-files` | `structure/protected-files` | re-scoped; `no-github-workflows` deliberately NOT absorbed (Spur is an app repo that legitimately ships `ci.yml`/`publish.yml`) |

**The genuine remaining gaps (this task's scope):**

1. **`quality/` category is MISSING entirely.** `recommended-post-check.yaml` does `extends: [quality]`, and `config.yaml` resolves rules ONLY from local `.spur/rules/**/*.yaml` (no global fallback). With no `quality/` dir, the post-test gate resolves to an empty/erroring category — coverage and TSDoc enforcement are effectively absent locally. This is the biggest single-source-of-truth hole.
   - **`coverage-gate`** — ts-libs has `quality/coverage-gate.yaml` (per-file line coverage from lcov, threshold 90). Spur needs a re-scoped version (its lcov path + `apps/**`+`packages/**` scope).
   - **TSDoc-export** — the post-check preset comment promises "TSDoc on exports", but no `tsdoc-export` rule exists anywhere in spur-new. Either author one under `quality/` or consciously drop the promise from the preset comment.

2. **`no-biome-suppressions` not present.** ts-libs has `typescript/no-biome-suppressions.yaml` (regex: forbid `biome-ignore`). This directly encodes a Spur AGENTS.md gate rule ("No `biome-ignore` added solely to silence the gate"). Strong fit; currently unenforced as a rule.

**Out of scope / not relevant to Spur (do NOT absorb):**
- `typescript/esm-build-conventions` — governs ts-libs' library *publish/dist-extension-fixer* flow (`scripts/builder.ts`, extensionless dist imports). Spur apps don't publish libraries this way. Evaluate; almost certainly N/A — if so, record the decision, don't absorb.
- `migration/rg-dialect`, `rg-migration` — one-time `grep`→`rg` migration helpers. Not architectural invariants. Skip.

**Net effect:** after this task, `.spur/rules/` carries every architecturally-relevant rule locally, the `recommended-post-check` preset resolves against a real local `quality/` category, and no Spur gate silently depends on the global install or on ts-libs. ts-libs and spur-new then maintain their rulesets independently — spur-new is authoritative for Spur.

**Independence:** this task is pure local rule curation — it has NO dependency on the ts-libs 0.3.2 release and does NOT touch package code. It can run in parallel with / ahead of 0019/0017/0018.


### Requirements

- **R1**: Create the missing local `quality/` category and absorb `coverage-gate`. Copy `ts-libs/.spur/rules/quality/coverage-gate.yaml` → `spur-new/.spur/rules/quality/coverage-gate.yaml`, re-scoped to Spur's layout (lcov path Spur actually emits; `include: apps/** + packages/**`; an `# Absorbed from ts-libs/...` header documenting the re-scope, matching the convention of the other absorbed files). → **Done when**: `quality/coverage-gate.yaml` exists locally, `spur rule run --preset recommended-post-check` resolves the `quality` category to a real rule set (no empty/missing-category error), and the coverage gate runs against Spur's lcov.

- **R2**: Resolve the TSDoc-export gap. Either (a) author `quality/tsdoc-export.yaml` (the `tsdoc-export` evaluator, scoped to exported declarations in `packages/**/src` / `apps/**/src`), OR (b) if Spur deliberately does not enforce TSDoc-on-exports, remove the "TSDoc on exports" promise from the `recommended-post-check.yaml` comment so the preset doesn't claim a gate it doesn't run. → **Done when**: the post-check preset's documented behavior matches what it actually enforces — either a real `tsdoc-export` rule under `quality/`, or an honest preset comment; decision recorded in the Review section.

- **R3**: Absorb `no-biome-suppressions`. Copy `ts-libs/.spur/rules/typescript/no-biome-suppressions.yaml` → `spur-new/.spur/rules/typescript/no-biome-suppressions.yaml`, re-scoped (`apps/**/src` + `packages/**/src`, `.tsx` included, tests excluded where `noExplicitAny`/`useLiteralKeys` suppressions are legitimate), with the `# Absorbed from ts-libs/...` header. It joins the `typescript` category already in `recommended-pre-check`. → **Done when**: the rule exists locally, `spur rule run --preset recommended-pre-check` picks it up via `extends: [typescript]`, and a planted `biome-ignore` in a non-test src file is flagged.

- **R4**: Adjudicate the not-relevant ts-libs rules explicitly. For `typescript/esm-build-conventions`, `migration/rg-dialect`, and `rg-migration`: confirm they are Spur-irrelevant (library-publish / one-time-migration concerns) and record the decision NOT to absorb them in the Review section, with one-line rationale each. → **Done when**: each non-absorbed ts-libs rule has a recorded keep-out decision; none are silently forgotten.

- **R5**: Confirm no regression to the already-absorbed rules. This task ADDS rules and the missing `quality/` category only — it must NOT edit `strict/runtime-boundaries`, `boundary/dao-boundary`, `typescript/{bun-tooling,output-boundaries}`, `strict/{http-boundaries,rule-files-structural}`, or `structure/{test-location,protected-files}`. → **Done when**: `git diff --stat` shows only ADDED files under `quality/` + `typescript/no-biome-suppressions.yaml` (and at most the `recommended-post-check.yaml` comment edit from R2); no existing absorbed rule is modified.

- **R6**: Verify the full local ruleset resolves and runs clean. → **Done when**: `spur rule run --preset recommended-pre-check` and `spur rule run --preset recommended-post-check --fail-on warning` both execute against Spur with all categories resolving from LOCAL `.spur/rules/` (no reliance on the global install); each new rule's structural validity passes `strict/rule-files-structural`; and the Spur gate is green (no NEW violations introduced by newly-added rules — if a newly-added rule surfaces real pre-existing violations, record them as follow-up, do not weaken the rule to hide them).

- **R7 (documentation)**: Note in `.spur/rules/` (a brief README or a header in a top-level preset) that spur-new's `.spur/rules/` is now the single source of truth for Spur rules, independent of ts-libs. → **Done when**: a reader can tell that these rules are self-contained and authoritative for Spur, and that ts-libs maintains its own separate set.


### Q&A

_Refined via `rd3:dev-refine 0020 --auto` (synthesis-only, no interactive Q&A). Decisions derived from the existing Background/Requirements/Design:_

- **Q: Is further requirements elicitation needed?** → No. Background (2.4k chars, WHY + full coverage-map table), Requirements (R1–R7, each with a verifiable **"Done when"**), Design (constraints + file plan), and Solution are already complete and testable. This refine pass is convention-conformance (seed Q&A) + pinning two latent implementation decisions, not gap-filling.

- **Q: Preset?** → `simple` (re-validated, unchanged). Signals: ~3 new files + 1 edit, **0** dependencies, single domain (spur rule curation), no external constraints, 1 person. 4 simple-column signals, 0 complex → `simple`. The work is additive YAML curation, not logic — low blast radius.

- **Q: R2 TSDoc-export — author the rule (a) or drop the preset claim (b)?** → **Recommend (b): drop the "TSDoc on exports" claim from the `recommended-post-check` comment.** Rationale: ts-libs added per-export JSDoc to *published libraries* (a library-API-docs concern, CHANGELOG 0.3.2 `ts-utils`); Spur is an **application** repo, not a published-API surface, so blanket TSDoc-on-exports is low-value churn against app code. Author the rule only if Spur later publishes a library package (`plugin-sdk`?) that warrants documented exports — capture that as a follow-up, not this task. Final call recorded in Review (R2 done-when).

- **Q: coverage-gate `threshold` — inherit ts-libs' 90, or match Spur's current gate?** → **Match Spur's existing coverage expectation, don't blindly inherit 90.** Before writing the rule, read Spur's current coverage config / AGENTS.md gate and set `threshold` to what Spur actually holds today; raising the bar to 90 in the same change that *introduces* the gate risks turning a curation task into a coverage-remediation task (R6 explicitly forbids weakening rules to pass — so an over-high threshold would either block the gate or force scope creep). If Spur has no documented threshold, start at the value its current suite already clears, and note any gap to 90 as a follow-up.

- **Q: Compound requirements (R1/R2/R6 bundle multiple checks)?** → Left intentionally bundled. Each compound R maps to ONE atomic deliverable (R1 = the `quality/` category existing + resolving; R6 = the whole local ruleset resolving green) with a single coherent "Done when". Splitting them would fragment one verification into several without adding testability. Acceptable for a `simple` preset.

- **Open (deferred, non-blocking):** whether the single-source-of-truth note (R7) lives in a new `.spur/rules/README.md` vs. a header comment in a top-level preset — recommend a short `README.md` (discoverable, doesn't couple the note to a preset's lifecycle).

- **Status note:** **Todo**, runnable now. NO dependency on the ts-libs 0.3.2 release and no package-code changes — fully parallel to 0019/0017/0018.


### Design

**Nature of the change:** local rule curation only — add the 2-3 architecturally-relevant rules that still live only in ts-libs, plus the missing `quality/` category, so `.spur/rules/` is self-contained and authoritative for Spur. No package code, no dep bump, no ts-libs edits.

**Constraints / invariants:**

- **Adapt, don't mirror.** Every absorbed rule already in spur-new was *re-scoped* (paths → `apps/**`+`packages/**`, severities tuned, allowlists for sanctioned sites, deliberate omissions). New absorptions MUST follow the same convention: re-scope to Spur's layout and carry an `# Absorbed from ts-libs/.spur/rules/<path>` header stating what changed and why. A verbatim copy is a bug.
- **Categories drive presets.** spur-new presets use `extends: [<category-dir>]`, not file lists. `coverage-gate` + any TSDoc rule go under a NEW `quality/` dir (consumed by `recommended-post-check`); `no-biome-suppressions` goes under existing `typescript/` (consumed by `recommended-pre-check`). Placement = wiring; get the directory right and the preset picks it up automatically.
- **Local-only resolution.** `config.yaml` resolves `.spur/rules/**/*.yaml` with NO global fallback. That's the whole point of "single source of truth" — verify the presets resolve with the global spur rules dir unavailable/ignored (R6).
- **Don't touch the already-absorbed eight.** R5 guards this — additive only.
- **Honest presets.** If TSDoc isn't enforced, the preset comment must not claim it (R2). A preset that advertises a gate it doesn't run is worse than an explicit omission.
- **Don't absorb the irrelevant three.** `esm-build-conventions` (library dist-fixer), `rg-dialect`, `rg-migration` (one-time migration) are out — but record the keep-out decision (R4), don't silently drop.
- **Gate non-negotiable.** New rules must be structurally valid (pass `strict/rule-files-structural`) and must not be weakened to hide real violations they surface (R6).

**File plan:**
```
ADD  .spur/rules/quality/coverage-gate.yaml          # absorbed + re-scoped (R1)
ADD  .spur/rules/quality/tsdoc-export.yaml           # IF R2 path (a); else skip
ADD  .spur/rules/typescript/no-biome-suppressions.yaml  # absorbed + re-scoped (R3)
EDIT .spur/rules/recommended-post-check.yaml         # ONLY if R2 path (b): drop TSDoc claim
ADD  .spur/rules/README.md (or preset header)        # single-source-of-truth note (R7)
```

**Coverage-gate re-scope specifics:** ts-libs uses `lcovPath: .coverage/lcov.info`, `threshold: 90`, `include: [packages/**]`. Spur emits coverage from `apps/**` too — confirm Spur's actual lcov output path and set `include` to `apps/**` + `packages/**`; keep `**/node_modules/**` excluded; drop the ts-libs `**/drizzle/**` exclude unless Spur vendors drizzle output.

**Verification approach:** run both presets explicitly (`spur rule run --preset recommended-pre-check`, `... recommended-post-check --fail-on warning`); assert every category resolves locally; plant a `biome-ignore` in a throwaway src file to confirm R3 fires, then remove it. If a newly-added rule surfaces genuine pre-existing violations in Spur's tree, that is a real finding → record as a follow-up task, do NOT relax the rule.


### Solution

Local rule curation: most ts-libs rules already absorbed+adapted into spur-new (each with an 'Absorbed from' header). Remaining gaps: (1) create missing quality/ category — recommended-post-check extends [quality] but no quality/ dir exists, so absorb coverage-gate + resolve the TSDoc-export claim; (2) absorb no-biome-suppressions into typescript/. Adjudicate esm-build-conventions + rg-migration as Spur-irrelevant (keep out, recorded). Additive only — must not edit the 8 already-absorbed rules. ~3 new rule files, ~2hr, Low risk. Makes .spur/rules/ self-contained + authoritative for Spur, independent of ts-libs. No dep on 0.3.2 release.


### Plan

- [x] Create `.spur/rules/quality/` directory
- [x] Author `quality/coverage-gate.yaml` — re-scoped from ts-libs (lcov path → `.coverage/lcov.info`, include → `apps/**` + `packages/**`)
- [x] Drop "TSDoc on exports" claim from `recommended-post-check.yaml` — Spur is an app repo, not published API surface
- [x] Create `quality/tsdoc-exports.yaml` with `enabled: false` to shadow global install's version (file-level dedup needs matching relative path)
- [x] Author `typescript/no-biome-suppressions.yaml` — re-scoped from ts-libs (`src/` fragment include, tests excluded)
- [x] Record keep-out decisions for esm-build-conventions, rg-dialect, rg-migration
- [x] Add `.spur/rules/README.md` — single-source-of-truth note
- [x] Verify additive-only diff (no edits to existing 8 absorbed rules)
- [x] Run both presets — all rules resolve locally
- [x] Run `bun test` and `bun run lint` to confirm no regression


### Review

**Verdict: PASS**

**R1 (quality/ category):** DONE. `quality/coverage-gate.yaml` created, re-scoped to Spur's layout. `recommended-post-check` resolves `quality` category to real local rules. Coverage gate reads from `.coverage/lcov.info`, threshold 90 (matching bunfig.toml and `bun run test --coverage-dir=.coverage`), scope `apps/**` + `packages/**`.

**R2 (TSDoc-export gap):** DONE — path (b): claim dropped from preset comment. Spur is an application repo, not a published API surface. Additionally, `quality/tsdoc-exports.yaml` created with `enabled: false` to shadow the global install's active version — without this shadow, the global `tsdoc-exports.yaml` would leak into local preset resolution because the rule engine deduplicates by relative file path, not rule id.

**R3 (no-biome-suppressions):** DONE. `typescript/no-biome-suppressions.yaml` created, re-scoped. Rule appears in `recommended-pre-check` (17 rules, up from 16). Structural validation passes. A planted `biome-ignore` probe in `apps/cli/src/__no_biome_probe.ts` was flagged after switching the include scope from deep globs to the regex evaluator's supported `src/` path fragment.

**R4 (keep-out decisions):** Recorded below and in `.spur/rules/README.md`.
- `typescript/esm-build-conventions` — governs ts-libs' library publish/dist-fixer flow. Spur apps don't publish libraries this way. **Not absorbed.**
- `migration/rg-dialect` — one-time grep→rg migration helper. Not an architectural invariant. **Not absorbed.**
- `migration/rg-migration` — one-time grep→rg migration helper. Not an architectural invariant. **Not absorbed.**

**R5 (no regression to existing rules):** PASS with fix-pass scope expansion. No existing absorbed rule file was modified; only `recommended-post-check.yaml` was edited among existing rule files. The new `no-biome-suppressions` rule surfaced real production suppressions, so the fix pass also removed them from `apps/web/src/pages/index.astro` and `packages/plugin-sdk/src/registries/base.ts` instead of weakening the rule.

**R6 (full ruleset resolves):** PASS.
- `recommended-pre-check`: 17 rules, all passed, all resolved from local `.spur/rules/`.
- `recommended-post-check --fail-on warning`: 2 rules (coverage-gate active, tsdoc-export disabled), all passed against `.coverage/lcov.info`.
- Rule file structural validation passes for both presets.
- **Finding fixed in this task:** the regex evaluator's `matchesAny` loose glob matcher strips `**/` and `*` then does substring matching — this means deeply-nested patterns like `apps/**/src/**/*.ts` may not match intermediate directories correctly (e.g., `apps/cli/src/args.ts` doesn't match the collapsed fragment). `no-biome-suppressions` now uses the supported `src/` fragment and excludes tests/dist/node_modules.
- **Production violations fixed:** the new rule found existing `biome-ignore` suppressions in `apps/web/src/pages/index.astro` and `packages/plugin-sdk/src/registries/base.ts`. Both were removed by fixing the underlying lint/type patterns.

**R7 (documentation):** DONE. `.spur/rules/README.md` documents single-source-of-truth status, category map, preset wiring, ts-libs relationship, and keep-out decisions.


### Testing

- Command: `env SPUR_GLOBAL_RULES_DIR=/private/tmp/spur-empty-rules bun run apps/cli/src/index.ts rule run --preset recommended-pre-check`
- Scope: All 17 rules in pre-check preset (typescript + structure + boundary categories)
- Result: PASS — 0 findings
- Evidence: `All 17 rules passed — no violations found.`

- Command: `env SPUR_GLOBAL_RULES_DIR=/private/tmp/spur-empty-rules bun run apps/cli/src/index.ts rule run --preset recommended-post-check --fail-on warning`
- Scope: 2 rules in post-check preset (quality category — coverage-gate + shadowed tsdoc-export)
- Result: PASS — 0 findings
- Evidence: `All 2 rules passed — no violations found.`

- Command: `env SPUR_GLOBAL_RULES_DIR=/private/tmp/spur-empty-rules bun run apps/cli/src/index.ts rule validate --preset strict-check`
- Result: 7 strict structural rules passed

- Command: `env SPUR_GLOBAL_RULES_DIR=/private/tmp/spur-empty-rules bun run apps/cli/src/index.ts rule run --preset recommended-pre-check --rule no-biome-suppressions --json`
- Result: PASS after fixes — `findings: []`

- Command: `bun run lint`
- Result: PASS — Biome clean and all workspaces typecheck

- Command: `bun run test`
- Result: PASS — 542 tests pass, 0 failures; no logger output leak in dots reporter output

- Command: `bun run test-cf`
- Result: PASS — 2 Cloudflare Worker tests pass

- Command: `bun run build`
- Result: PASS — cli/server/web build succeeded

- Next action: None.


### Artifacts

| Type | Path | Agent | Date |
| ---- | ---- | ----- | ---- |
| rule | `.spur/rules/quality/coverage-gate.yaml` | Lord Robb | 2026-06-05 |
| rule | `.spur/rules/quality/tsdoc-exports.yaml` | Lord Robb | 2026-06-05 |
| rule | `.spur/rules/typescript/no-biome-suppressions.yaml` | Lord Robb | 2026-06-05 |
| doc | `.spur/rules/README.md` | Lord Robb | 2026-06-05 |
| edit | `.spur/rules/recommended-post-check.yaml` | Lord Robb | 2026-06-05 |

### References

- ts-libs source: `~/xprojects/ts-libs/.spur/rules/quality/coverage-gate.yaml`
- ts-libs source: `~/xprojects/ts-libs/.spur/rules/typescript/no-biome-suppressions.yaml`
- Rule engine `matchesAny` loose matcher: `@gobing-ai/ts-rule-engine/dist/evaluators/file-utils.js:59`
