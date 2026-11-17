---
schema_version: 1
name: Registry prefix contract for local projects
status: done
template: feature-impl
created_at: 2026-11-17T00:06:29.302Z
updated_at: "2026-11-17T01:11:14.065Z"
feature_id: K4
priority: P1
tags:
  - registry
  - config
  - cli
estimate_hours: 4

done_forced: "false"
done_reason: unforced close
---

## 1357. Registry prefix contract for local projects

### Background

Feature K4 (ADR-151, `docs/design/project-gateway.md` §3). Local entries in `~/.config/spur/projects.json` gain an optional `prefix` so the gateway can route them on one port; remote entries keep `host`+`port`. This task owns only the registry contract and the `spur projects add --prefix` flag; no gateway code. Covers R1, R2.

### Requirements

- [x] R1. Local entries accept an optional `prefix`; absent → derived `/` + slug(name); invalid slug, reserved first segment (`api`, `board`, `modules`, `_astro`, `openapi.json`, `health`) or a collision with another local entry's explicit prefix is rejected with an actionable error; existing files load unchanged.
- [x] R2. Remote entries never get, require or accept a prefix; `resolveProjectPrefix` returns `null` for them and their host/port behavior is unchanged.

### Acceptance Criteria

- [x] AC1 — Local entries accept an optional validated prefix (req: R1)
- [x] AC2 — Remote entries keep host and port semantics (req: R2)

Verification: `(cd packages/config && bun test tests/projects*.test.ts)` and `(cd packages/app && bun test tests/services/project-registry*.test.ts)` plus a CLI E2E `(cd apps/cli && bun test tests/commands/projects*.test.ts)` driving `spur projects add <tmpdir> --prefix /kk --json` against `SPUR_PROJECTS_FILE=<tmp>/projects.json`; artifact: the resulting projects.json fixture asserted byte-for-byte for untouched entries.

### Q&A

- Derived collisions (two local names that slugify alike, no explicit prefix) are **not** a load error — the file must keep loading. They are reported by `findPrefixCollisions()` for `projects list`/gateway to surface; only an explicit write (`add --prefix`) is refused. Chosen so a pre-existing registry never becomes unreadable.
- Prefix is stored with its leading slash (`/knowledge-kit`), matching the operator's requested form; input without the slash is normalized on write.
- No schema_version bump: the field is optional and additive.

### Design

Files and signatures:

- `packages/config/src/projects.ts`
  - `projectEntrySchema` (line 7): add `prefix: z.string().optional()` with a doc comment "local entries only; `/slug`".
  - `export const RESERVED_PREFIX_SEGMENTS = ['api','board','modules','_astro','openapi.json','health'] as const;`
  - `export function slugifyProjectName(name: string): string` — lowercase, non `[a-z0-9]` runs → `-`, trim `-`, cap 63 chars; empty result → `project`.
  - `export function normalizePrefix(input: string): string` — trim, add leading `/`, drop trailing `/`, lowercase.
  - `export function validatePrefix(prefix: string): string | null` — returns an error message or null: must match `^/[a-z0-9][a-z0-9-]{0,62}$`; first segment not reserved.
  - `export function resolveProjectPrefix(entry: Pick<ProjectEntry,'name'|'host'|'prefix'>): string | null` — `null` when `!isLocalHost(entry.host)` (`isLocalHost` lives in `packages/app/src/services/project-process.ts:191`; config must not import app, so move it into `packages/config/src/projects.ts` and re-export it from `project-process.ts` so existing callers are untouched), else `entry.prefix ?? '/' + slugifyProjectName(entry.name)`.
  - `export function findPrefixCollisions(entries: ProjectEntry[]): Map<string, string[]>` — resolved prefix → entry names, only for prefixes with >1 local entry (case-insensitive).
- `packages/app/src/services/project-registry.ts`
  - `upsert(entry: { name; path; port?; host?; prefix? })` (line 306): when `prefix` is supplied → refuse for remote host (`Prefix is only valid for local projects; remove --prefix or --host`), `normalizePrefix` + `validatePrefix`, refuse when another local entry's **resolved** prefix equals it (`Prefix /x is already used by "<name>"; choose another with --prefix`). When `prefix` is **omitted**, preserve the existing stored prefix (callers such as `project-start.ts` path healing call `upsert({name,path,port})` and must not erase it).
  - `setPort` / `healStale` / `allocatePort` untouched in this task.
- `apps/cli/src/commands/projects.ts:26` `add`: `.option('--prefix <slug>', 'URL path prefix for a local project on the gateway (default: /<name slug>)')`, passed to `upsert`; JSON response unchanged shape (`project` now carries `prefix` when set).

Invariants: no migration; zod parse of an old file yields entries without `prefix`; remote entries round-trip byte-identically.
Rejected: storing the derived prefix on load (would rewrite every operator's file); a separate prefixes map.

### Plan

1. Failure cases first (write these tests before code):
   - `--prefix "Knowledge Kit"` → invalid (space survives normalization) → error names the slug rule.
   - `prefix: "/api"`, `"/board/x"`, `"/_astro"` → reserved error names the segment.
   - explicit prefix equal to another local entry's derived prefix → collision error names that entry.
   - `--prefix` with `--host 192.168.87.27` → refused, exit 1, registry untouched.
   - `upsert({name,path,port})` on an entry with a stored prefix → prefix preserved.
   - legacy file without any prefix → loads; remote entry with `port: 3003` keeps it; `resolveProjectPrefix(remote) === null`.
   - two local entries named `kk` and `KK` without prefixes → `findPrefixCollisions` reports both; load still succeeds.
2. Implement config helpers, then `upsert`, then the CLI flag.
3. Run: `(cd packages/config && bun test)`, `(cd packages/app && bun test tests/services/project-registry*.test.ts)`, `(cd apps/cli && bun test tests/commands/projects*.test.ts)`, then `bun run spur-check`.
4. CLI E2E artifact: projects.json before/after `add --prefix` committed as a test fixture assertion.

### Solution

| File | Lines | What / why |
| --- | --- | --- |
| `packages/config/src/projects.ts` | 17 | Optional `prefix` on `projectEntrySchema` — additive, no schema bump, so legacy files parse unchanged. |
| `packages/config/src/projects.ts` | 21-95 | Registry prefix contract: `RESERVED_PREFIX_SEGMENTS`, `isLocalHost` (moved here from app so config never imports app), `slugifyProjectName`, `normalizePrefix`, `validatePrefix`, `resolveProjectPrefix`, `findPrefixCollisions`. |
| `packages/app/src/services/project-process.ts` | 5, 192 | Re-exports `isLocalHost` from `@gobing-ai/spur-config`, keeping every existing app/CLI caller untouched. |
| `packages/app/src/services/project-registry.ts` | 9-18, 47-80 | Imports the config helpers; `resolvePrefixWrite` enforces the write contract — remote refusal, normalize+validate, collision against another local entry's **resolved** prefix, and "omitted ⇒ preserve". |
| `packages/app/src/services/project-registry.ts` | 353-390 | `upsert` accepts `prefix?`, stores it only when resolved, and never erases a stored prefix on path-healing re-upserts (`project-start.ts`). |
| `apps/cli/src/commands/projects.ts` | 29-33, 50 | `spur projects add --prefix <slug>`; JSON response shape unchanged, `project.prefix` present when set. |
| `packages/config/tests/projects-prefix.test.ts` | new | Slug/normalize/validate/resolve/collisions + legacy-load cases. |
| `packages/app/tests/services/project-registry-prefix.test.ts` | new | Store-normalized, invalid, reserved, collision, remote refusal (registry untouched), preserve-on-omit, remote round-trip identity. |
| `apps/cli/tests/commands/projects-prefix.test.ts` | new | CLI E2E: `add --prefix`, refused invalid prefix, refused remote prefix; untouched entry asserted byte-for-byte in the written `projects.json`. |

Derived collisions (two names slugifying alike with no explicit prefix) stay a **load-success / report-only** state per the task Q&A: `findPrefixCollisions` exposes them for `projects list` and the gateway; only an explicit write is refused.

### Testing

**Pipeline verify results**

- Verdict: PASS (from verdict artifact)

| Requirement | Status | Evidence |
|-------------|--------|----------|
| R1 — local entries accept an optional validated prefix; absent derives `/` + slug(name); invalid slug, reserved segment or explicit collision refused with an actionable error; existing files load unchanged | MET | `packages/config/src/projects.ts:17,21,34-95` (schema field + slug/normalize/validate/resolve/collisions); `packages/app/src/services/project-registry.ts:41-72,353-390` (write contract); tests `packages/config/tests/projects-prefix.test.ts`, `packages/app/tests/services/project-registry-prefix.test.ts`, `apps/cli/tests/commands/projects-prefix.test.ts` |
| R2 — remote entries never get, require or accept a prefix; `resolveProjectPrefix` returns `null` for them and their host/port behaviour is unchanged | MET | `packages/config/src/projects.ts:68-75`; remote refusal `packages/app/src/services/project-registry.ts:56-58`; remote round-trip test `packages/app/tests/services/project-registry-prefix.test.ts` ("keeps remote entries byte-identical"), CLI refusal `apps/cli/tests/commands/projects-prefix.test.ts` |

| Acceptance Criteria | Status | Evidence Type | Evidence |
|---------------------|--------|---------------|----------|
| AC1 — Local entries accept an optional validated prefix (req: R1) | MET | test | `(cd packages/config && bun test)` 315 pass; `(cd packages/app && bun test tests/services/project-registry)` 52 pass; `(cd apps/cli && bun test tests/commands/projects)` 31 pass — slug/reserved/collision/derived/preserve cases |
| AC2 — Remote entries keep host and port semantics (req: R2) | MET | test | probe `spur projects add /tmp/remote --host 192.168.87.27 --prefix kk --json` → exit 1, `Prefix is only valid for local projects…`; registry untouched; remote entry round-trip asserted in `packages/app/tests/services/project-registry-prefix.test.ts` |
- Coverage: N/A (verdict-based; verify pipeline does not measure code coverage)

### Review

| Req | Status | Evidence |
| --- | --- | --- |
| R1 | MET | `packages/config/src/projects.ts:17,21,34-95`; `packages/app/src/services/project-registry.ts:41-72,353-390`; config/app/cli prefix suites green |
| R2 | MET | `packages/config/src/projects.ts:68-75`; remote refusal `packages/app/src/services/project-registry.ts:56-58`; remote byte-identical round-trip test |

| AC | Status | Evidence Type | Evidence |
| --- | --- | --- | --- |
| AC1 | MET | test | `(cd packages/config && bun test)` 315 pass; `(cd packages/app && bun test tests/services/project-registry)` 52 pass; `(cd apps/cli && bun test tests/commands/projects)` 31 pass |
| AC2 | MET | command + test | `spur projects add /tmp/remote --host 192.168.87.27 --prefix kk --json` → exit 1 "Prefix is only valid for local projects"; remote entry unchanged |

Findings: no P1–P3. P4: `resolvePrefixWrite` re-derives `isLocalHost(host)` redundantly (`project-registry.ts:41-55`); the 63-char prefix bound is encoded twice (`projects.ts:32,62`).

Residual risk: prefix is validated on write only — a hand-edited `/API` resolves verbatim until rewritten (gateway normalizes at request time, task 1359).

**Disposition: PASS.**

### References

- Feature K4 R1, R2; ADR-151; `docs/design/project-gateway.md` §3.
- `packages/config/src/projects.ts:7`, `packages/app/src/services/project-registry.ts:306`, `apps/cli/src/commands/projects.ts:26`, `packages/app/src/services/project-start.ts` (path-healing `upsert` caller).
- Downstream: 1359 (gateway prefix lookup), 1361 (`/api/projects` + `projects list` URL).

### History

- 2026-11-17T00:21:24.181Z feature_id Q → K4 (system)
- 2026-11-17T01:09:49.037Z todo → wip (system)
- 2026-11-17T01:11:12.446Z wip → testing (system)
- 2026-11-17T01:11:14.061Z testing → done (system)

