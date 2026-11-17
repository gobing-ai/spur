---
schema_version: 1
name: Registry prefix contract for local projects
status: todo
template: feature-impl
created_at: 2026-11-17T00:06:29.302Z
updated_at: "2026-11-17T00:29:07.488Z"
feature_id: K4
priority: P1
tags:
  - registry
  - config
  - cli
estimate_hours: 4

---

## 1357. Registry prefix contract for local projects

### Background

Feature K4 (ADR-151, `docs/design/project-gateway.md` §3). Local entries in `~/.config/spur/projects.json` gain an optional `prefix` so the gateway can route them on one port; remote entries keep `host`+`port`. This task owns only the registry contract and the `spur projects add --prefix` flag; no gateway code. Covers R1, R2.

### Requirements

- [ ] R1. Local entries accept an optional `prefix`; absent → derived `/` + slug(name); invalid slug, reserved first segment (`api`, `board`, `modules`, `_astro`, `openapi.json`, `health`) or a collision with another local entry's explicit prefix is rejected with an actionable error; existing files load unchanged.
- [ ] R2. Remote entries never get, require or accept a prefix; `resolveProjectPrefix` returns `null` for them and their host/port behavior is unchanged.

### Acceptance Criteria

- [ ] AC1 — Local entries accept an optional validated prefix (req: R1)
- [ ] AC2 — Remote entries keep host and port semantics (req: R2)

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

<!-- Filled during implementation: file:line change map and concise rationale. -->

### Testing

<!-- Filled during verification: commands run, outcomes, coverage claim or N/A. -->

### Review

<!-- Filled during review: P1-P4 findings, residual risk, and final disposition. -->

### References

- Feature K4 R1, R2; ADR-151; `docs/design/project-gateway.md` §3.
- `packages/config/src/projects.ts:7`, `packages/app/src/services/project-registry.ts:306`, `apps/cli/src/commands/projects.ts:26`, `packages/app/src/services/project-start.ts` (path-healing `upsert` caller).
- Downstream: 1359 (gateway prefix lookup), 1361 (`/api/projects` + `projects list` URL).

### History

- 2026-11-17T00:21:24.181Z feature_id Q → K4 (system)

