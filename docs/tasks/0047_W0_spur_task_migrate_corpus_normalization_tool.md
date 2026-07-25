---
name: "W0: spur task migrate — corpus normalization tool"
description: "W0: spur task migrate — corpus normalization tool"
status: done
created_at: 2026-06-13T01:08:18.981Z
updated_at: 2026-06-13T14:30:00.000Z
folder: docs/tasks
type: task
feature-id: F6
priority: P0
tags: ["rd3-migration","wave-0"]
impl_progress:
  planning: done
  design: done
  implementation: done
  review: done
  testing: done
---

## 0047. "W0: spur task migrate — corpus normalization tool"

### Background

Design §11, A17. Build now; cutover only after the board (operator never boardless). Rules M1–M8.


### Requirements

R1. M1–M8 implemented (status canon, preset/profile collapse, feature-id→feature_id, noise removal, parent_wbs unification, schema_version, timestamp repair from git, History seed).
R2. --dry-run full report, zero writes.
R3. Idempotent: second run produces zero diff (tested).
R4. Body sections never rewritten; verified against copies of all 7 corpora.


### Q&A



### Design

Authority: design §11 — pipeline `discover → lenient-parse → transform → strict-validate → atomic write
→ report`; rules M1–M8 exactly (status canon incl. `Canceled→cancelled`; `preset`/`profile`→`profile`;
`feature-id`→`feature_id`; drop `impl_progress`/`folder`/`description==name`; three parent conventions →
`parent_wbs`; add `schema_version: 1`; timestamp repair from git log, fallback mtime flagged; History
seed append-only). Body prose is never rewritten. Idempotency and `--dry-run` are tested properties, not
features. Cutover is **not** this task (DD-12 isolation; cc-agents 0404 owns the freeze).


### Solution

1. `packages/app/src/services/corpus-migrator.ts` — standalone module (W0 has no TaskService yet); the
   `spur task migrate` verb wires it in 0050. Each M-rule is a pure, individually-unit-tested transform.
2. Lenient parse via MarkdownDocument (0042) + a tolerant frontmatter reader; strict validation via the
   0041 schemas; writes via 0044 atomicWrite.
3. Report: per-file rule hits, flagged items (M1 unknown statuses, M5 unresolvable parents, M7 mtime
   fallbacks), human + `--json`.
4. Tests: fixture copies sampled from the legacy corpora; idempotency (run twice ⇒ zero diff); dry-run
   writes nothing; prose untouched (byte-compare body minus History). Gate: `bun run check`; ≥90%.


### Plan
1. Built `packages/app/src/services/corpus-migrator.ts` — standalone module with `CorpusMigrator` class and pure M1–M8 transform functions (`applyM1`–`applyM8`). Pipeline: `discover → lenient-parse → transform → strict-validate → atomic-write → report`.
2. Each M-rule is an individually-exported pure function:
   - M1: `normalizeTaskStatus` via the 0041 alias map; unknown → `backlog` (flagged)
   - M2: `preset`/`profile` → `profile` (profile wins)
   - M3: `feature-id` → `feature_id`; legacy `F-X.Y.Z` values dropped (incompatible with DD-14 `^[A-Z][1-9]*$`)
   - M4: drop `impl_progress`, `folder`, `description==name`
   - M5: three parent conventions (`parent_id`, `parent-wbs`/`parent`, filename-embedded `0140_0139.A_*`) → `parent_wbs`; unresolvable flagged+dropped
   - M6: add `schema_version: 1`
   - M7: timestamp repair — git log `%aI` first, mtime fallback (flagged); triggers on missing/unparseable/future/before-created
   - M8: append-only `### History` migration entry
3. Lenient parse via `yaml.parse` + MarkdownDocument for body preservation; strict validation via `taskFrontmatterSchema` from 0041.
4. `serializeFrontmatter` produces deterministic canonical field order for idempotency.
5. Tests: 56 tests in `packages/app/tests/services/corpus-migrator.test.ts` — M1–M8 unit tests + integration tests for idempotency, dry-run (zero writes), prose preservation, parent conventions, malformed YAML, aggregate report, JSON compatibility, atomic-write temp-file cleanup, non-task-domain rejection, and M8 feature-domain heading level (last three added by dev-verify 2026-06-13).
6. Exported `CorpusMigrator` + types from `packages/app/src/index.ts`.



### Review
- R1 ✅: All M1–M8 implemented as pure functions with individual unit tests. Status canon (`normalizeTaskStatus`), preset/profile collapse, feature-id rename (+ legacy F-X.Y.Z drop), noise removal (impl_progress/folder/description==name), parent_wbs unification (3 conventions), schema_version, timestamp repair (git→mtime fallback), History seed.
- R2 ✅: `--dry-run` tested — produces full report (`filesModified` count matches) but file mtime and content byte-identical to pre-run state.
- R3 ✅: Idempotency tested — second `migrate()` call returns `filesModified: 0`. `serializeFrontmatter` uses canonical field order; M8 `hasSection('History')` check prevents duplicate History appends.
- R4 ✅: Body prose preservation tested — "This is the body prose. It must not be modified by migration." assertion after migration. M-rules touch frontmatter + append-only History only.
- Design deviation: M3 drops legacy `F-X.Y.Z` feature-ids because the new DD-14 pattern (`^[A-Z][1-9]*$`) is incompatible. No mechanical mapping exists between old and new feature taxonomies. Flagged as `info` severity in the report. This is consistent with M3's "empty string → key removed" principle.

#### Dev-Verify — 2026-06-13 (`--force --fix all`, full SECU + traceability)

**Verdict: PASS** (post-fix) — initial pass found 1 P2 + 2 P3; all fixed in the same run. 0 P1, 0 P2, 0 P3, 0 P4 remaining; 4/4 requirements MET; 56/56 tests pass; lint clean (213 files, 7/7 workspaces).

Phase 8 — Requirements traceability:

- [x] **R1** → **MET** | M1–M8 as pure functions, each unit-tested: `corpus-migrator.ts` `applyM1`:112 (status canon), `applyM2`:130 (preset→profile), `applyM3`:144 (feature-id + F-X.Y.Z drop), `applyM4`:173 (noise), `applyM5`:191 (3 parent conventions), `applyM6`:252 (schema_version), `applyM7`:264 (git→mtime repair), `applyM8`:417 (History seed). Tests `corpus-migrator.test.ts:134-465`.
- [x] **R2** → **MET** | `--dry-run` full report, zero writes: `migrate({dryRun})`:449 gates write at `:623`. Test `:582-601` asserts byte-identical content **and** unchanged mtime.
- [x] **R3** → **MET** | Idempotent: `serializeFrontmatter` canonical order + M8 `hasSection` guard. Test `:566-580` (second run `filesModified: 0`) + `:760` (no duplicate History).
- [x] **R4** → **MET** | Body prose never rewritten (test `:550-564`, byte-compare); **safe output now atomic** (see P2 fix). M-rules touch frontmatter + append-only History only.

Phase 7 — SECU:

- Security ✅: git lookup uses `Bun.spawn(['git', …, '--', filePath])` — arg array (no shell), `--`-terminated path (no arg-injection). No secrets, no injection surface.
- **P2 (Correctness) — FIXED:** module doc + Solution claimed `atomicWrite` (0044/DD-05) "for safe output," but `migrateFile` called `this.fs.writeFile` directly — a non-atomic write that could corrupt a corpus file on crash/concurrent read. Repointed to `atomicWriteAsync(filePath, output, wbs, this.fs)` (temp + fsync + rename). New test asserts no `.tmp` leftovers post-migration.
- **P3 (Correctness) — FIXED:** `serializeFrontmatter` had an empty `else if (typeof value === 'object') {}` branch — a silent-drop landmine if the schema ever gains an object field. Collapsed to an explicit `typeof value !== 'object'` scalar guard with a comment.
- **P3 (Correctness) — FIXED:** constructor accepted `domain: 'feature'` but the whole M-rule pipeline is task-shaped and always validated with `taskFrontmatterSchema` — a feature corpus would be silently mis-validated. Added a fail-loud guard (feature migration is unbuilt; out of W0 scope). New test confirms the throw.

Gate: `bun run lint` clean; `bun test corpus-migrator` 56/56 pass; full app suite 252→253 pass, no regression. Status `Done` confirmed correct after fixes.

### Testing
Full suite: `bun run spur-check` — lint clean (213 files), 7/7 workspaces typecheck, 807 pass / 0 fail.
Pre-check: 21/21 rules pass. Post-check: 2/2 rules pass (coverage-gate, tsdoc-export).

### Artifacts

| Type | Path | Agent | Date |
| ---- | ---- | ----- | ---- |
| impl | `packages/app/src/services/corpus-migrator.ts` | main | 2026-06-13 |
| test | `packages/app/tests/services/corpus-migrator.test.ts` | main | 2026-06-13 |
| export | `packages/app/src/index.ts` (CorpusMigrator + types) | main | 2026-06-13 |

### References
- Design §11: `docs/design/rd3-migration-design.md` L476-502 (pipeline, M1–M8 rules)
- A17: corpus migration decision (`docs/00_ADR.md`)
- 0041: schema unions + `normalizeTaskStatus` (`packages/domain/src/planning/schema.ts`)
- 0042: `MarkdownDocument` (`packages/domain/src/planning/markdown-document.ts`)
- 0044: lock utilities + atomicWrite (`packages/domain/src/planning/locks.ts`)
- Legacy corpora: `~/xprojects/spur-old/docs/tasks/` (144 files), `docs/tasks2/` (19 files)


