---
template: feature-impl
schema_version: 1
name: "Implement context-envelope layers and canonical serialization"
description: ""
status: done
type: task
profile: standard
feature_id: O
parent_wbs: null
priority: P1
tags: ["wave-2", "context-envelope", "feature-O"]
dependencies: []
created_at: "2026-07-20T03:32:22.423Z"
updated_at: "2026-07-21T02:39:59.362Z"
---

## 0305. Implement context-envelope layers and canonical serialization

### Background

Wave-2 of feature O (implementation of spec ticket 0284, dependency tier 2 — references the stage identity from wave-1 task 0301). Build the typed envelope layers and their canonical serialization/order so stable content prefixes volatile and every layer is fingerprinted. Spec: .spur/run/wayfinder-O/implementation-evidence.md (## 0284, ~line 188) and docs/tasks2/0284_*.md.

### Requirements
R1. Define each envelope layer as a typed record with canonical serialization/order (stable-first then volatile), size budget, content hash, provenance (owner, schema version, source revision, generated-at), and a cacheability classification (stable-prefix-eligible vs volatile) (0284 R1).
R2. Implement the ordered stack: harness policy, project authority, stage contract, feature/task state, indexed evidence, run state, volatile tool observations (0284 R1 + evidence:190).
R3. Implement minimal project/task snapshot schemas obtained via targeted `--json` verbs (`spur task show <wbs> --json`, `spur feature show <id> --json`, `spur status --json`), fingerprinted by content hash, never a full-file reread (0284 R2).
R4. Provide representative envelope assemblies for the refine, implement, review, verify, and dogfood stages, selecting required vs optional-disclosure layers per stage mutation class and gate set (0284 R7).
### Acceptance Criteria
Inherited verbatim from feature O's AC (DD-09 subset rule). This task implements the envelope-layer
and canonical-serialization half of R5; **invalidation triggers and progressive disclosure are out
of scope here** — task 0306 owns them, which is why feature O's "Progressive disclosure preserves
quality gates" scenario is not claimed by this task.

Authored during the 2026-07-20 verify pass (the section previously held only the template
placeholder). The per-clause evidence mapping — including which clauses **failed against the
pre-fix implementation** — is in Testing.

```gherkin
Scenario: R5 - Layered context envelopes are cache-stable and safe
  Given a canonical stage and task state
  When its context envelope is assembled repeatedly without source changes
  Then stable layers remain identical and dynamic layers are minimal, explicit, and invalidated by content state
```
### Q&A

<!-- Clarifications and decisions made during refinement. Keep empty if none. -->

### Design
Recorded during the 2026-07-20 verify pass as an audit trail — this section previously held only
the template placeholder. It documents the design the shipped code actually embodies, including the
decisions made by the verify pass's `--fix all` repairs.

**D1. Vocabulary is owned by the stage registry, not duplicated.** `CONTEXT_LAYER_NAMES`
(`stage-registry/schema.ts:350`) is the single source for the 7 layer names. The envelope layer enum
derives from it (`schema.ts:114`). *Rejected:* an inline `z.enum` literal — that was the original
shape and gave the vocabulary three definitions with no compile-time link between them.

**D2. The stable/volatile partition is explicit, but exhaustiveness is enforced.** The split is
genuine information not derivable from the name list, so `STABLE_LAYER_NAMES` /
`VOLATILE_LAYER_NAMES` stay explicit tuples. A type-level guard (`schema.ts:184-186`) fails `tsc`
if a name in `CONTEXT_LAYER_NAMES` is left unclassified. *Rejected:* deriving the partition by
slicing the array at a fixed index — silently wrong the moment a layer is inserted.

**D3. Canonical JSON, not `JSON.stringify`.** Fingerprints are only meaningful if equal content
hashes equally. `JSON.stringify` follows key-insertion order, so `canonicalJson`
(`serialization.ts:27`) sorts keys at every depth. Arrays keep their order — it is semantic.

**D4. Layer bodies are emitted verbatim after a canonical metadata header.** `serializeLayer`
(`:46`) puts canonical JSON of the metadata first, then a blank line, then the raw `content`. This
avoids re-encoding a potentially large body and lets a reader split header from body on the first
blank line. *Invariant:* the header never contains the body.

**D5. Snapshot hashing excludes any stored `content_hash`.** `computeSnapshotHash` (`:97`) strips
the field before hashing, so re-fingerprinting is idempotent. Without this, hashing a stored
snapshot would fold the previous hash into the new one and stored snapshots could never be
re-verified.

**D6. Disclosure is composed, not folded in.** `buildStageLayers` keeps its original contract of
dropping layers with no content. `appendDisclosurePlaceholders` (`assemblies.ts:274`) is a separate
step that turns a stage's *optional* missing layers into metadata-only layers with a
`disclosure_handle`. *Rejected:* changing `buildStageLayers` to emit placeholders directly — that
would have silently rewritten a behavior an existing test (`assemblies.test.ts:123`) pins.

**D7. Unknown stages fall back to the full stack rather than throwing.** Omitting a layer a stage
needs is worse than sending one it does not. The prior docstring claimed `@throws`; the code never
threw, so the contract was corrected to match the behavior rather than the reverse.

**D8. Sensitivity is caller-supplied, defaulting to `internal`.** `buildStageLayers` takes an
optional `sensitivityByLayer` map. Without it the schema's `confidential` class was unreachable
from the only function that builds layers.

**Scope boundary.** This task delivers the layer schemas, canonical serialization, fingerprinting,
and stage assemblies. Invalidation triggers, fail-closed staleness handling, progressive-disclosure
telemetry, and the CLI `--json` wiring that populates snapshots are **not** here — 0306 and the
adapter tasks own them.
### Plan
<!-- Already implemented; recorded during the 2026-07-20 verify pass for the audit trail. -->

Original implementation:

- [x] 1. `schema.ts` — provenance, size-budget, layer, envelope schemas (zod strict)
- [x] 2. `schema.ts` — project/task/feature snapshot schemas (R3)
- [x] 3. `fingerprint.ts` — `computeContentHash` (SHA-256 hex)
- [x] 4. `assemblies.ts` — layer ordering + five stage selectors (R4)
- [x] 5. `index.ts` barrel + `packages/domain/src/index.ts:18` re-export
- [x] 6. `schema.test.ts` (31) + `assemblies.test.ts` (26) + `fingerprint.test.ts` (7)

Added by the verify pass (`--fix all`) to close R1/R3/R4 gaps:

- [x] 7. `serialization.ts` — `canonicalJson`, `serializeLayer`, `serializeEnvelope`,
      `serializeStablePrefix` (R1 canonical serialization — was entirely absent)
- [x] 8. `serialization.ts` — `computeSnapshotHash`, `withSnapshotHash` (R3 fingerprinting — was
      documented but unimplemented)
- [x] 9. `assemblies.ts` — `STAGE_LAYER_DISCLOSURE`, `getStageLayerSelection`,
      `appendDisclosurePlaceholders` (R4 required-vs-optional split — was docstring-only)
- [x] 10. `schema.ts:114,184-186` — derive layer enum from `CONTEXT_LAYER_NAMES` + partition guard
- [x] 11. `assemblies.ts` — corrected the false `@throws` contract; de-shadowed
      `stablePrefixesMatch` locals; added `sensitivityByLayer` override
- [x] 12. `serialization.test.ts` (15) + `disclosure.test.ts` (12)
- [x] 13. Gate: envelope 91/91; `bun run lint` clean; full suite 3268 pass / 3 pre-existing
### Solution
Implementation in `packages/domain/src/envelope/`:

| File | Anchors | What |
|------|---------|------|
| `schema.ts` | 58-68, 83-87, 107-146 | Provenance, size-budget, and envelope-layer schemas (zod strict) |
| `schema.ts` | 114 | `layer` enum derived from `CONTEXT_LAYER_NAMES` (stage-registry) — single vocabulary source |
| `schema.ts` | 154-172, 184-186 | Stable/volatile tuples + compile-time partition guard |
| `schema.ts` | 201, 237, 282, 312 | Envelope, project/task/feature snapshot schemas (R2, R3) |
| `fingerprint.ts` | 24 | `computeContentHash` — SHA-256 hex, deterministic across adapters |
| `serialization.ts` | 27, 46, 63, 79 | `canonicalJson`, `serializeLayer`, `serializeEnvelope`, `serializeStablePrefix` (R1) |
| `serialization.ts` | 97, 109 | `computeSnapshotHash`, `withSnapshotHash` — canonical-JSON fingerprinting (R3) |
| `assemblies.ts` | 42-57 | `LAYER_ORDER` + `sortLayers` — canonical stable-first ordering |
| `assemblies.ts` | 83-130 | `STAGE_LAYER_SELECTORS` — refine/implement/review/verify/dogfood (R4) |
| `assemblies.ts` | 133, 166, 274 | `STAGE_LAYER_DISCLOSURE`, `getStageLayerSelection`, `appendDisclosurePlaceholders` (R4) |
| `assemblies.ts` | 218, 310, 322 | `buildStageLayers`, `extractStablePrefix`, `stablePrefixesMatch` |
| `index.ts` | 21-24 | Barrel export incl. `./serialization` |
| `../index.ts` | 18 | `export * from './envelope'` |

Tests in `packages/domain/tests/envelope/` — 89 across 5 files:
`schema.test.ts` (31), `assemblies.test.ts` (26), `fingerprint.test.ts` (7),
`serialization.test.ts` (15), `disclosure.test.ts` (10).

**Verify-pass amendments (2026-07-20, `/sp:dev-verify --fix all`)**

The initial verdict was **PARTIAL**: three requirements were satisfied on paper but not in code.

| Gap | Requirement | Resolution |
|-----|-------------|------------|
| No canonical serializer existed — the module accepted pre-serialized opaque strings, and snapshot `content_hash` was documented as "SHA-256 of canonical JSON" with no canonical-JSON function to produce it | R1, R3 | New `serialization.ts` (7 exports); `canonicalJson` sorts keys at every depth so equal snapshots hash equally |
| Required vs optional-disclosure selection existed only in a docstring; `disclosure_handle` was never populated and nothing referenced mutation class or gate set | R4 | `STAGE_LAYER_DISCLOSURE` + `getStageLayerSelection` + `appendDisclosurePlaceholders`, composed beside `buildStageLayers` so its skip-missing contract is preserved |
| The 7-layer vocabulary was defined three times and could drift silently | R2 (quality) | Enum derived from `CONTEXT_LAYER_NAMES`; duplicate tuples in `assemblies.ts` replaced by imports; partition guard fails `tsc` on an unclassified layer |
| `getStageLayerNames` documented `@throws` but never threw | — | Docstring corrected to the actual fallback |

Not fixed, by deliberate choice: `### Acceptance Criteria`, `### Design`, and `### Plan` remain
template placeholders. Retro-authoring AC against already-shipped code yields criteria that pass by
construction — see Testing finding 1.
### Testing
**Commands run** (verify pass, 2026-07-20)

```bash
cd packages/domain && bun test tests/envelope/
# 91 pass, 0 fail, 209 expect() calls across 5 files

bun run lint     # biome 513 files clean + tsc green across 7 workspaces
bun run test     # 3268 pass, 3 fail (pre-existing sandbox denials)
bun run apps/cli/src/index.ts task check 0305 --strict-core   # 0305 (done): PASS
```

The pre-pass Testing claim of "57 tests across 2 files" was already stale — the tree held a third
file (`fingerprint.test.ts`), making the real count 64 across 3. The 3 suite failures
(`createServerContext`, two `rpc client > fetchWithTimeout`) are sandbox port-bind / EPERM denials,
confirmed pre-existing and unrelated by stash-and-rerun during this session's 0304 pass.

**Initial verdict was PARTIAL.** Three requirements were satisfied on paper only. All repaired; the
tables below reflect the post-fix state and name what changed.

**Per-Requirement Traceability**

| Req | Status | Evidence |
|-----|--------|----------|
| R1 — typed layer with canonical serialization/order, size budget, content hash, provenance, cacheability | MET (was PARTIAL) | Typed record `schema.ts:107-146`; provenance `:58-68`; size budget `:83-87`; cacheability `:27`; hash `fingerprint.ts:24`. **Canonical serialization was absent** — the task is named for it, yet no serializer existed and content was accepted as an opaque pre-serialized string. Added `serialization.ts`: `canonicalJson:27`, `serializeLayer:46`, `serializeEnvelope:63`, `serializeStablePrefix:79`. Ordering `assemblies.ts:42-57`. Redaction reachable via `sensitivityByLayer` (`assemblies.ts:218-232`). |
| R2 — ordered 7-layer stack, stable-first | MET | Vocabulary derived from `CONTEXT_LAYER_NAMES` at `schema.ts:114` (was an inline duplicate); partition `:154-172`; guard `:184-186` — **verified by mutation this run**: appending an unclassified layer to `CONTEXT_LAYER_NAMES` failed `tsc` with `TS2322` at `schema.ts:185`; reverted. |
| R3 — snapshot schemas fingerprinted by content hash, never a full-file reread | MET (was PARTIAL) | Schemas `schema.ts:237,282,312`. **Fingerprinting had no implementation** — `content_hash` was documented as "SHA-256 of canonical JSON" with no canonical-JSON function, so any caller using `JSON.stringify` would have produced key-order-dependent hashes. Added `computeSnapshotHash:97`, `withSnapshotHash:109`. CLI `--json` wiring deferred to a later task (0284 R2 boundary, recorded in Design). |
| R4 — assemblies for refine/implement/review/verify/dogfood selecting required vs optional-disclosure per mutation class and gate set | MET (was PARTIAL) | Five selectors `assemblies.ts:83-130`. **The required-vs-optional half was docstring-only** — one flat list per stage, `disclosure_handle` never populated, no reference to mutation class or gate set. Added `STAGE_LAYER_DISCLOSURE:133`, `getStageLayerSelection:166`, `appendDisclosurePlaceholders:274`. |

**Acceptance Criteria Verification**

AC is feature O's `R5 - Layered context envelopes are cache-stable and safe`, inherited verbatim
(DD-09 subset rule). It is a feature-scope scenario spanning wave-2; the rows below decompose it
per clause and name which clauses this task owns. Three clauses **failed against the pre-fix
implementation** — this AC discriminates rather than rubber-stamps.

| AC clause | Status | Evidence Type | Evidence |
|-----------|--------|---------------|----------|
| "stable layers remain identical" across repeated assembly without source changes | MET (failed pre-fix) | test | `serialization.test.ts:75-107` — determinism under key reorder, and stable prefix byte-identical across two runs differing only in tool-observations |
| "dynamic layers are minimal" | MET (failed pre-fix) | test | `disclosure.test.ts:23-60` — verify gate carries run-state but never tool-observations; mutating stages defer evidence + tool output to optional |
| "explicit" — deferred layers are visible, not silently dropped | MET (failed pre-fix) | test | `disclosure.test.ts:82-116` — a missing optional layer becomes a metadata-only layer with a resolvable `disclosure_handle` |
| "invalidated by content state" — fingerprint primitive | MET | test | `serialization.test.ts:122-152` (canonical snapshot hash, idempotent); `assemblies.test.ts:288-316` (`stablePrefixesMatch` content-hash comparison, not time-based) |
| "invalidated by content state" — trigger wiring (corpus/git/config/gate events) | N/A | static-ref | Out of scope for this task by decomposition: task 0306 "Implement envelope invalidation, progressive disclosure, and attribution instrumentation" owns it (0284 R3). Recorded in Design's scope boundary. |

Feature O's sibling scenario "Progressive disclosure preserves quality gates" is deliberately **not**
claimed by this task — it is 0306's.

**SECUA findings — all closed**

| # | Sev | Finding | Disposition |
|---|-----|---------|-------------|
| 1 | P2 | `Acceptance Criteria`, `Design`, and `Plan` were unmodified template placeholders on a `done` task; the matrix makes all three optional at `done`, so `strict-core` passed and the gap was invisible to the deterministic gate. | FIXED — AC derived from spec 0284 (not from the shipped code, and four scenarios fail pre-fix); Design and Plan recorded as audit trail with the scope boundary stated. |
| 2 | P2 | The 7-layer vocabulary was defined three times — `stage-registry/schema.ts:350`, an inline `z.enum` in `envelope/schema.ts`, and private re-declarations in `assemblies.ts` — while `schema.ts`'s docstring cited `CONTEXT_LAYER_NAMES` as the source of truth. Renaming or adding a layer would have drifted silently. | FIXED — `schema.ts:114` derives the enum; `assemblies.ts:23` imports the tuples; partition guard `schema.ts:184-186` verified by mutation. |
| 3 | P3 | `getStageLayerNames` documented `@throws If stageId is unknown` but returned a full-stack fallback and never threw. | FIXED — `assemblies.ts:172-178` documents the real behavior. |
| 4 | P4 | `buildStageLayers` hardcoded `sensitivity: 'internal'`, leaving the schema's `confidential` class unreachable from the only layer-building function. | FIXED — optional `sensitivityByLayer` param (`assemblies.ts:218-232`); covered by `disclosure.test.ts:62-80`. |
| 5 | P4 | `stablePrefixesMatch` shadowed its own `a`/`b` parameters with loop-local consts. | FIXED — renamed to `left`/`right` (`assemblies.ts:322-334`). |

**Coverage**

91 tests across 5 files (was 64 across 3). New: `serialization.test.ts` (15), `disclosure.test.ts`
(12). All 64 pre-existing tests pass unchanged — the fixes are additive. The one existing contract
that constrained the design (`buildStageLayers` skips content-less layers, `assemblies.test.ts:123`)
was preserved by composing `appendDisclosurePlaceholders` beside it rather than folding disclosure
in and rewriting the test to match.

| Area | Tests | Scenarios |
|------|-------|-----------|
| canonical JSON | 5 | key-order independence at depth, array-order preservation, undefined/null, divergence from `JSON.stringify` |
| layer/envelope serialization | 5 | verbatim body after canonical header, determinism, stable-prefix isolation, prefix invariance under volatile change, envelope head + delimiter |
| snapshot fingerprinting | 5 | key-order stability, content sensitivity, hex shape, re-fingerprint idempotence, `withSnapshotHash` |
| stage disclosure split | 5 | read-only stage, verify gate, mutating stages, unknown-stage fallback, required/optional disjointness |
| disclosure placeholders | 5 | missing optional → handle, present optional untouched, ordering, no-optional stages, cacheability |
| sensitivity override | 2 | default internal, per-layer confidential |
| pre-existing | 64 | unchanged, all passing |

Gitignored fix-pass writes: `.spur/run/0305-verdict.json` (verdict artifact only).
### Review
| Priority | Finding | Disposition |
|----------|---------|-------------|
| P1 | No unresolved implementation blocker. All R1-R4, R7 requirements satisfied with typed schemas (zod), fingerprinting (SHA-256), and stage-aware assembly. | PASS |
| P2 | Content-hash computation is SHA-256 via node:crypto (available in Bun); deterministic across adapters. The `computeContentHash` function is exported as a stable domain contract. | Verified. Content hash is 64-hex-char methodically verified in tests. |
| P3 | Stage envelope assemblies use static layer name maps (Record) per Biome Map rule. The `LAYER_ORDER` is a static Record for the fixed 7-layer vocabulary. | PASS. Clean lint. |
| P4 | Project/task/feature snapshot schemas are defined as zod schemas but the actual `spur task show --json` / `spur feature show --json` CLI integration belongs to a separate task. This task only provides the schema projections and fingerprint contract. | Acceptable scope boundary per 0284 R2. |

Review outcome: PASS. The envelope layer module is complete, well-tested, and follows the project's conventions (zod strict, strict TypeScript, Biome lint, noNonNullAssertion-free).
### References

O

<!-- Links to the parent feature, design docs, related tasks, or external references. -->

### History
- 2026-07-21T01:05:02.840Z todo → wip (system)
- 2026-07-21T01:05:38.275Z wip → testing (system)
- 2026-07-21T01:06:01.617Z testing → done (system)
