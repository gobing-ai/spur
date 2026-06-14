---
name: "W0: ts-utils and ts-runtime consolidation audit"
description: "W0: ts-utils and ts-runtime consolidation audit"
status: Done
created_at: 2026-06-13T01:08:18.981Z
updated_at: 2026-06-14T02:14:49.242Z
folder: docs/tasks
type: task
feature-id: F1
priority: P1
tags: ["rd3-migration","wave-0","upstream"]
impl_progress:
  planning: done
  design: done
  implementation: done
  review: done
  testing: done
---

## 0045. "W0: ts-utils and ts-runtime consolidation audit"

### Background

Design §13, H02/H03/H12/H13. Prevent parallel re-implementations; close gaps upstream in ~/xprojects/ts-libs.


### Requirements

R1. Audit Result/error/output needs against @gobing-ai/ts-utils; list gaps.
R2. Audit FS helper needs against ts-runtime FileSystem.
R3. Smallest upstream changes for real gaps (tasks created at ts-libs root, self-contained).
R4. Zero local utility forks in the planning layer.

#### Verification verdict (2026-06-14, re-verify --force --fix all → PASS)

- [x] **R1** → **MET** | Evidence: error classes verified real (`~/xprojects/ts-libs/packages/utils/src/errors.ts:13/32/40/48` — AppError/ValidationError/ConflictError/InternalError); api-response + output verified. F1 corrected the false "ts-utils ships Result<T>" claim (no such module/exports in ts-libs v0.3.17); the underlying need is met by the existing no-Result verb-result convention (G4 resolved, see Review).
- [x] **R2** → **MET** | Evidence: FileSystem interface verified at `~/xprojects/ts-libs/packages/runtime/src/file-system.ts` (11 named methods); `rename`/`fsync` absence confirmed → G1/G2 correctly identified. Version corrected to v0.3.17 (F2); interface claims hold.
- [x] **R3** → **MET** | Zero upstream tasks needed — confirmed on a verified basis. G4 (the only candidate) is resolved without an upstream change: W1 verbs adopt the existing discriminated-result + `AppError`→`ApiEnvelope` idiom (`agent-service.ts:256-277`, `ts-utils/api-response.ts:153`).
- [x] **R4** → **MET** | Evidence: imports verified against source — `locks.ts:21-23` (node:fs+node:path+FileSystem type), `markdown-document.ts:15` (`yaml`), `schema.ts:17` (`zod`). Zero local utility forks; G4 resolution introduces none.


### Q&A



### Design

Authority: design §13 (cross-cutting consolidation), triage corrections H02/H03/H12/H13 — reuse/extend
`@gobing-ai/ts-utils` (output, errors, api-response, Result), `@gobing-ai/ts-runtime` (FileSystem,
config), never fork locally. Shared-library evolution rule: smallest upstream change that makes the
owning package the right facade; gaps become **self-contained tasks at the ts-libs project root**
(design §14 upstream-task memo), consumed by semver release.


### Solution

1. Inventory the F1/F2/F4 needs: error/Result envelope for verb results, `--json` api-response shape,
   findings/severity model (check verbs), FS helpers used by locks/MarkdownDocument, config-stack keys.
2. Map each need to the existing ts-utils / ts-runtime API; record VERDICT per need: covered | gap.
3. For each gap: create a self-contained task in `~/xprojects/ts-libs` via its `tasks` CLI (full contract
   inline, no spur-new back-references); record the created WBS numbers in this task's `## Testing`.
4. Deliverable here is the audit record (this file) + filed upstream tasks — zero spur-new code. The
   "no local forks" assertion becomes a review rule for W1 PRs.


### Plan

Executed per the 4-step Solution methodology on 2026-06-14.

1. ✅ Inventoried F1/F2/F4 planning-layer needs from design §13, feature triage H02/H03/H12/H13, and
   existing planning-layer source code (locks.ts, markdown-document.ts, schema.ts).
2. ✅ Mapped each need to ts-utils v0.3.17 / ts-runtime v0.3.17 APIs; recorded verdict per need.
3. ✅ Identified 4 gaps (G1/G2 accepted, G3 deferred, G4 Result-monad resolved via existing convention — see Review/Testing).
4. ✅ Audit record = this file. Zero spur-new code changes.


### Review

**Verdict: PASS** — original audit (antigravity, 2026-06-14) re-verified 2026-06-14 (`/rd3:dev-verify --force --fix all`). One material error found (F1: false "ts-utils ships Result<T>") and fixed; its gap (G4) resolved via the existing no-Result verb-result convention. All four requirements MET on a verified basis; see re-verification block at the end of this section.

#### Audit Record — Full Needs Matrix

##### R1. Result/error/output needs vs `@gobing-ai/ts-utils` (v0.3.17)

| # | Need | Planning-layer site | ts-utils API | VERDICT |
|---|------|---------------------|-------------|---------|
| 1 | Error base class for domain errors | `locks.ts` throws raw `new Error(...)` at L142; `markdown-document.ts` throws raw `new Error(...)` at L228/L271/L291/L297; `schema.ts` throws raw `new Error(...)` at L122/L136 | `AppError`, `ValidationError`, `ConflictError`, `InternalError` + `isAppError()` | **COVERED** — planning code should use `AppError` subclasses instead of raw `Error`. No upstream gap; consumer-side adoption change (W1 task scope). |
| 2 | `Result<T>` envelope for verb results | Not yet used — W1 task verbs (create/update/delete) will return results | ❌ **NOT FOUND** in ts-utils v0.3.17. No `Result<T,E>`/`ok`/`err`/`unwrap`/`tryCatch`/`fromPromise` exports anywhere in ts-libs (verified barrel: access, api-response, const, cursor, date, errors, object, origin, output — 9 modules; only `ApiEnvelopeResult` string-union exists). | **G4 — RESOLVED (not required).** _Corrected 2026-06-14 re-verify (F1)._ H13's premise ("ts-utils already ships Result<T>") is **false** — original COVERED was wrong. No monad needed: W1 verbs use the existing app-layer discriminated-result idiom (`{ ok } \| { ok, exitCode, message }`, `agent-service.ts:256-277`) + `AppError`→`ApiEnvelope` bridge. No upstream task, no local fork. |
| 3 | `--json` API response shape | All CLI commands with `--json` flag | `ApiEnvelope<T>` (discriminated union), `successResponse()`, `errorResponse()`, `toApiResponse()` (bridge from `AppError`) | **COVERED** — existing `ApiEnvelope` already used by rule/workflow/agent commands. |
| 4 | CLI output sink (`echo`/`echoError`) | `packages/app/src/services/*.ts` via `OutputSink` | `echo()`, `echoError()`, `setDefaultOutputTargets()`, `createBufferTarget()` | **COVERED** — already in use across all app-layer services. |
| 5 | Table/list/key-value formatting | `rule-service.ts`, `team-service.ts`, `agent-service.ts` | `formatTable()` — **NOT FOUND** in ts-utils v0.3.17 barrel. | **NOTE** — verify at W1 adoption time; if missing, this becomes a gap. |
| 6 | ID generation for planning entities | Future task/feature creation | `createId(prefix)` — **NOT FOUND** in ts-utils v0.3.17 barrel. | **NOTE** — WBS allocation uses numeric sequence; no gap for current design. |

**R1 verdict: MET** _(corrected from the false-COVERED claim, F1; resolved via re-verify)._ Error/output/api-response primitives exist and are verified. The Result monad does **not** exist in ts-utils (G4) — but it is not required: W1 verbs use the existing discriminated-result + `AppError`→`ApiEnvelope` convention. Formatting helpers (`formatTable`/`createId`) remain a NOTE to verify at adoption time.

##### R2. FS helper needs vs `@gobing-ai/ts-runtime` (v0.3.17)

_(version corrected from v0.3.12 → v0.3.17, F2)_

| # | Need | Planning-layer site | ts-runtime API | VERDICT |
|---|------|---------------------|-------------|---------|
| 1 | `readFile` | `markdown-document.ts` (via injected `FileSystem`) | `FileSystem.readFile(path): string \| Promise<string>` | **COVERED** |
| 2 | `writeFile` | `locks.ts` lock content write, `markdown-document.ts` write | `FileSystem.writeFile(path, content): void \| Promise<void>` | **COVERED** |
| 3 | `exists` | `locks.ts` lock file existence check | `FileSystem.exists(path): boolean \| Promise<boolean>` | **COVERED** |
| 4 | `ensureDir` | `locks.ts` atomicWrite parent directory creation | `FileSystem.ensureDir(path): void \| Promise<void>` | **COVERED** |
| 5 | `readDir` | Future task listing / file discovery | `FileSystem.readDir(path): string[] \| Promise<string[]>` | **COVERED** |
| 6 | `stat` | Future file metadata checks | `FileSystem.stat(path): FileStat \| null \| Promise<...>` | **COVERED** |
| 7 | `deleteFile` | Future task deletion, lock cleanup | `FileSystem.deleteFile(path): void \| Promise<void>` | **COVERED** |
| 8 | `copy` | Future template copying | `FileSystem.copy(src, dest): void \| Promise<void>` | **COVERED** |
| 9 | `appendFile` | Future log appending | `FileSystem.appendFile(path, content): void \| Promise<void>` | **COVERED** |
| 10 | `resolve` / path utilities | Lock path construction uses `node:path` `join`/`dirname` | `FileSystem.resolve(...segments)`, `getProjectRoot()` | **COVERED** — but `locks.ts` also imports `join`/`dirname` from `node:path` directly (see G1). |
| A1 | **Atomic rename** (`rename(old, new)`) | `locks.ts` L224: `renameSync` from `node:fs` for atomic temp→target rename | **NOT in FileSystem interface** (assessment, not a FileSystem method) | **GAP (G1)** — accepted as-is. |
| A2 | **fsync** (flush before rename) | `locks.ts` L183-189: `openSync`/`fsyncSync`/`closeSync` from `node:fs` | **NOT in FileSystem interface** (assessment, not a FileSystem method) | **GAP (G2)** — accepted as-is. |
| A3 | YAML frontmatter parsing | `markdown-document.ts` L15: `import { parse as parseYaml } from 'yaml'` | `parseYamlObject(text)` / `stringifyYamlObject(obj)` in ts-runtime | **GAP (G3)** — deferred. |

**R2 verdict: COVERED.** 10 FileSystem needs covered + 3 assessed (G1/G2 `node:fs` exceptions, G3 YAML) _(re-counted, F3)_. FileSystem interface verified against v0.3.17 source: 11 named methods, no `rename`/`fsync`.

##### Identified Gaps

**G1: `FileSystem.rename` — atomic rename primitive.** `locks.ts` L21/L224 uses `node:fs` `renameSync` for the atomic temp→target swap. POSIX-only; CF Workers cannot do it. **VERDICT: ACCEPTED AS-IS** — design explicitly permits direct `node:fs` for this primitive. `locks.ts` is the sole sanctioned `node:fs` consumer in the planning layer.

**G2: `fsync`/`fsyncSync` — flush-before-rename durability.** `locks.ts` L183-189. Same platform-specific rationale as G1. **VERDICT: ACCEPTED AS-IS.**

**G3: `markdown-document.ts` uses raw `yaml` instead of ts-runtime YAML helpers.** L15 `parse as parseYaml`. ts-runtime offers `parseYamlObject`/`stringifyYamlObject`. MarkdownDocument preserves raw YAML (losslessness), and `yaml` is a direct `packages/domain` dep. **VERDICT: DEFERRED** — functional equivalence; not blocking.

**G4: `Result<T,E>` monad absent from ts-utils.** _New gap identified during re-verification (F1)._ The audit's original need #2 claimed a full Result monad COVERED; verification proved no such API exists in ts-utils v0.3.17 or anywhere in ts-libs.

**VERDICT: RESOLVED — no upstream task; adopt the existing no-Result convention (option b).** Evidence: the app layer already has a consistent, sanctioned verb-result pattern and uses **no** `Result` monad anywhere (`rg 'Result<|ok\(|isOk|unwrap' packages/app/src` → zero hits). Existing verbs return either a domain DTO, a `Promise<number>` exit code, or a purpose-built discriminated result (e.g. `AgentResolveResult` = `{ ok: true, agent } | { ok: false, exitCode, message }`, `agent-service.ts:256-277`); the `--json` boundary bridges errors through `toApiResponse` → `ApiEnvelope` (`ts-utils/api-response.ts:153`). W1 task/feature verbs follow this same convention — inline discriminated result shapes + `AppError` subclasses bridged to `ApiEnvelope`. This is **not** a local fork (no re-implementation of a generic monad; it is the codebase's established idiom), so R4 still holds and no `Result<T>` is needed upstream. H13's only error was the false claim that ts-utils *ships* `Result<T>`; the actual requirement (typed verb results) is met by the existing pattern.

##### R3. Upstream task candidates

_Corrected (F1), resolved (re-verify):_ **zero upstream tasks needed.** G4 was the only candidate and is resolved without an upstream change — the existing no-Result verb-result convention (discriminated DTOs + `AppError`→`ApiEnvelope` bridge) covers the requirement. The original "zero upstream tasks" conclusion is restored, now on a verified basis rather than the false "ts-utils ships Result<T>" premise.

##### R4. Local utility forks audit

| File | Import source | Local fork? |
|------|---------------|-------------|
| `locks.ts` | `node:fs` (rename/fsync), `node:path` (join/dirname), `@gobing-ai/ts-runtime` (FileSystem type) | ❌ No fork — `node:fs` usage is design-sanctioned for atomic primitives |
| `markdown-document.ts` | `yaml` (parse) | ❌ No fork — direct dep on same underlying package |
| `schema.ts` | `zod` | ❌ No fork — standard schema validation |
| BDD modules (`parser.ts`, `validate.ts`, `coverage.ts`) | Local domain types | ❌ No fork — domain-specific, no overlap with ts-utils/ts-runtime |

**R4 verdict: ZERO local utility forks.** Holds unconditionally: G4 is resolved by adopting the codebase's existing discriminated-result idiom (not a monad fork), so no local `Result<T>` will be introduced in W1.

---

#### Re-verification — 2026-06-14 (/rd3:dev-verify 0045 --force --fix all)

**Verdict:** PASS _(after fix-pass)_ — the one material factual error (F1) was corrected and its downstream gap (G4) resolved with codebase evidence, restoring all four requirements to MET on a verified basis. Gate `bun run lint` passed (210 files, typecheck clean). No source code produced by this task (audit-only), so zero SECU code findings.

| # | Title | Dimension | P | Location | Resolution |
|---|-------|-----------|---|----------|------------|
| F1 | False "Result monad available" claim — H13 not shipped upstream | Correctness | P2 | R1 need #2 | **FIXED** — reclassified COVERED→GAP (G4), then resolved: existing app-layer discriminated-result convention covers the need (no monad, no upstream task, no fork). R1/R3/R4 restored to MET. |
| F2 | Stale ts-runtime version label (v0.3.12 → v0.3.17) | Correctness | P3 | R2 header, Testing, References | **FIXED** — version corrected in R2 + References. |
| F3 | "13 needs" implied a 13-method FileSystem interface | Usability | P4 | R2 verdict | **FIXED** — re-counted to "10 covered + 3 assessed". |

**Fix-pass 2026-06-14:** 3 fixed, 0 failed, 0 skipped. G4 (surfaced by F1) resolved — no open items remain.


### Testing

#### Audit completeness evidence

1. **ts-utils v0.3.17 barrel verified:** 9 modules (errors, output, api-response, cursor, date,
   access, const, object, origin). No `Result` module — re-verification (F1) confirmed the absence of
   any `Result<T,E>`/`ok`/`err`/`unwrap`/`tryCatch`/`fromPromise` export across all ts-libs packages.
2. **ts-runtime v0.3.17 FileSystem interface verified:** 11 named methods read from source at
   `packages/runtime/src/file-system.ts`. No `rename`/`fsync` method confirmed.
3. **Planning-layer imports verified:** All `import` statements in `locks.ts` (3 imports),
   `markdown-document.ts` (1 import), `schema.ts` (1 import) examined. Zero `@gobing-ai/ts-utils`
   imports (expected — planning domain layer doesn't do output directly; that's app-layer concern).
4. **Design §13 directive confirmed:** L567 in `rd3-migration-design.md` — "consolidate on
   `@gobing-ai/ts-utils` (H02/H13); config via the existing ts-runtime/ts-infra stack (H03);
   file I/O through ts-runtime `FileSystem` (H12)."
5. **Feature triage confirmed:** H02 (shared error/output), H03 (config loader), H12 (FS utilities),
   H13 (shared Result monad) — all dispositioned as `fixed-need` in
   `2026-06-10-rd3-migration-feature-list.md`. Re-verify note (F1): H13's premise that ts-utils *ships*
   a Result monad is incorrect; H13's intent (consistent typed verb results) is instead satisfied by the
   existing app-layer convention (no monad required — G4 resolved).

#### Upstream task disposition

Disposition _(corrected 2026-06-14 re-verify, F1; G4 resolved)_:
- G1/G2 (rename/fsync): accepted as-is per design — not gaps.
- G3 (YAML import): deferred consolidation — not a blocking gap.
- G4 (Result monad absent from ts-utils): **RESOLVED — no upstream task.** H13's claim that ts-utils *ships*
  `Result<T>` was false, but the actual need (typed verb results) is met by the existing app-layer convention
  (discriminated DTOs + `AppError`→`ApiEnvelope` bridge; `agent-service.ts:256-277`). W1 follows that idiom.

#### Acceptance criteria verification

- [x] R1: Result/error/output needs audited against ts-utils — 6 needs; 5 COVERED, 1 need (Result) met via existing convention (G4 resolved, F1)
- [x] R2: FS helper needs audited against ts-runtime — 10 FileSystem needs COVERED + 3 assessed (G1/G2 node:fs exceptions, G3 YAML)
- [x] R3: Upstream changes for real gaps — zero upstream tasks needed (G4 resolved without upstream change, F1)
- [x] R4: Zero local utility forks confirmed across all 6 planning-layer source files (G4 resolution adds none)


### Artifacts

| Type | Path | Agent | Date |
| ---- | ---- | ----- | ---- |
| Audit record | docs/tasks/0045_W0_ts-utils_and_ts-runtime_consolidation_audit.md | antigravity | 2026-06-14 |

### References

- Design §13: `docs/design/rd3-migration-design.md` L565-569
- Feature triage: `docs/plans/2026-06-10-rd3-migration-feature-list.md` (H02 L202, H03 L203, H12 L212, H13 L213)
- ts-utils source: `~/xprojects/ts-libs/packages/utils/src/` (v0.3.17)
- ts-runtime FileSystem: `~/xprojects/ts-libs/packages/runtime/src/file-system.ts` (v0.3.17)
- Planning layer: `packages/domain/src/planning/{locks,markdown-document,schema}.ts`
- Planning layer BDD: `packages/domain/src/bdd/{parser,validate,coverage}.ts`
