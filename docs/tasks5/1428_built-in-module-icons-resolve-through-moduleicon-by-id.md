---
schema_version: 1
name: Built-in module icons resolve through ModuleIcon by id
status: done
template: feature-impl
created_at: 2026-11-22T02:21:32.650Z
updated_at: "2026-11-22T07:42:04.804Z"
feature_id: A83

tags: ["A83"]
priority: P2
estimate_hours: 3
done_forced: "false"
done_reason: unforced close
---

## 1428. Built-in module icons resolve through ModuleIcon by id

### Background

Implements: R2 — Built-in module icons resolve through ModuleIcon by module id; R3 — Downstream module icon declarations keep working unchanged.

ADR-133 (`docs/00_ADR.md:2307`) owns the icon contract. The downstream `bootstrap.modules[].icon` field is A8 public config (`packages/config/src/board-modules.ts:64`, required non-empty string) and must not break.

**Refine corrections (2026-11-21)**
- Background read "Implements: R2 R3 — ." and AC1 was blank → both now name the feature scenarios R2 and R3.
- "icon flow: modules/*/index.tsx → compose.ts:137 → LeftSidebar" → `compose.ts:137` (`entryMetadata`) only maps **downstream** descriptors. Built-in modules reach the sidebar straight from discovery (`apps/web/src/modules/discover.ts:44-55`). That guard `isWebModule` *requires* `typeof value.icon === 'string'`, so dropping the built-in field without relaxing the guard would silently drop every built-in module.
- Today's real defect is `search`. Its id has no vector branch in `ModuleIcon` (`apps/web/src/components/ModuleIcon.tsx:49-67`), so it renders the raw emoji `🔎` (`apps/web/src/modules/search/index.tsx:339`). The map also uses `features: '🎯'` while the descriptor says `🏷️`; the fallback map and descriptors disagree.
- The emoji-equality branches (`icon === '📡'` …) are what let a downstream module that declares a built-in emoji get the matching vector icon. Keep those as the downstream compatibility path. Only the id-keyed `fallbackEmojiMap` (used as sr-only text) is built-in-only.
- No `ModuleIcon` test exists. The compose tests (`apps/web/tests/modules/compose.test.ts:23,55,75`) cover downstream icon pass-through.

### Requirements

- [x] R1. `WebModule.icon` becomes optional (`apps/web/src/modules/types.ts:7`), and the discovery guard (`discover.ts:49-50`) accepts a module with no `icon`, or with a string one.
- [x] R2. The nine built-in descriptors (designs, features, history, observability, plans, projects, search, settings, tasks) drop their `icon:` emoji.
- [x] R3. `ModuleIcon` resolves a vector icon by id for all nine built-in ids, adding `search` (Lucide `Search`). It renders a raw emoji `<span>` only when `icon` is set and matches neither a built-in id nor a known emoji.
- [x] R4. sr-only text for `size="lg"` comes from an id → **label** map ("Search", "Tasks", …) instead of an emoji, because a screen reader announcing "📡" is noise. The `fallbackEmojiMap` is deleted.
- [x] R5. A downstream declaration with `icon: '📡'` still renders `Radio`. A downstream declaration with any other string still renders that string. `bootstrap.modules[].icon` validation is unchanged.

Out of scope: changing the config schema, adding icon names (e.g. `icon: 'radio'`) to downstream config, and new Lucide icons for downstream modules.

### Acceptance Criteria

- [x] AC1 — Built-in module icons resolve through ModuleIcon by module id
- [x] AC2 — Downstream module icon declarations keep working unchanged

### Q&A

<!-- CLOSED decisions from refinement: what was chosen and why, what was deferred and on what
     condition. Not a parking lot for open questions — an unanswered question here means the task
     is not ready to hand off. Keep empty if none. -->

#### Q&A entry — 2026-11-22T04:07:22.752Z

- **Closed: sr text.** Use a label, not an emoji. Emoji sr text was a holdover from emoji rendering, and ADR-133 makes vectors primary.
- **Closed: keep the emoji → vector compatibility.** Downstream configs in the wild declare built-in emoji. Removing the mapping would be a visible regression with no config change on their side (R3).

### Design

- **One table, not an if-chain.** `const BUILTIN: Record<string, { Icon: LucideIcon; label: string; emoji: string[] }>` keyed by module id. Resolution order:
  1. `BUILTIN[id]`;
  2. the entry whose `emoji` list includes `icon` (the downstream compatibility path);
  3. if `icon` is set, a `<span>` showing it;
  4. otherwise `Layers`.

  The emoji lists carry today's literals, including `🏷`/`🏷️`/`🎯` and `⚙`/`⚙️`, and `🔎` for search.
- **Type:** `readonly icon?: string` on `WebModule`. Downstream entries still always set it from the descriptor, because config requires it. Only built-ins omit it.
- **Guard:** `(!('icon' in value) || value.icon === undefined || typeof value.icon === 'string')`.
- **Frozen names:** `ModuleIcon` props are unchanged (`id`, `icon?`, `size?`, `className?`, `aria-hidden?`).
- **Anti-patterns:** no config schema change; no emoji in built-in descriptors; no second icon component.
- **Leaves for 1426/1427/1430:** every built-in shell header renders `<ModuleIcon id={moduleId} size="lg" />` with no `icon` prop. 1430 asserts there is no emoji text node in the sidebar.

### Plan

Premises (verified 2026-11-21):
- Icon branches: `apps/web/src/components/ModuleIcon.tsx:49-67`. Sidebar call: `LeftSidebar.tsx:200`.
- Discovery guard requires `icon`: `apps/web/src/modules/discover.ts:49-50`.
- Downstream schema: `packages/config/src/board-modules.ts:64`.

- [ ] 1. Failure modes to cover: a built-in without `icon` is dropped by discovery; search falls back to emoji; downstream `📡` loses its vector icon; downstream custom emoji is rewritten; sr text is an emoji.
- [ ] 2. Write failing tests in `apps/web/tests/components/module-icon.test.tsx`: every built-in id renders an `svg` and no emoji text; downstream `📡` renders the `Radio` svg; downstream `🦊` renders the text; `size="lg"` sr text is the label. Also add a test in `apps/web/tests/modules/discover*.test.ts` (or `compose.test.ts`) that a module without `icon` is accepted.
- [ ] 3. Implement R1 (type + guard), then R3/R4 (table), then R2 (drop the nine `icon:` lines).
- [ ] 4. Run `rg -n "icon: '" apps/web/src/modules/*/index.tsx` and confirm it is empty. Then run `bun run spur-check`.

### Solution

| File | Change | Why |
| --- | --- | --- |
| `apps/web/src/components/ModuleIcon.tsx` | one `BUILTIN` table (id → Lucide icon, screen-reader label, legacy emoji aliases); resolution id → emoji alias → declared literal → `Layers`; `fallbackEmojiMap` and the if-chain deleted | R3/R4: every built-in resolves by id, `search` gains `Search`, and the sr-only text is a NAME instead of a glyph |
| `apps/web/src/modules/types.ts:6-11` | `WebModule.icon` optional | R1: built-ins declare no glyph; downstream still sets one from config |
| `apps/web/src/modules/discover.ts:46-52` | guard accepts a missing `icon` or a string | R1: a built-in without a glyph is still discovered |
| the nine `apps/web/src/modules/*/index.tsx` descriptors | `icon:` removed (also `integrations`, which follows the same rule) | R2 |
| `apps/web/tests/components/module-icon.test.tsx` | every built-in id renders an `svg` + no glyph text; `search` ≠ fallback; downstream `📡` → vector; unknown glyph verbatim; no entry → vector | R3/R4/R5 failing-first |
| `apps/web/tests/modules/{observability,discover,history/history-module}.test.ts` | the emoji assertions become "no declared icon" | The contract changed on purpose; those three tests asserted the old literal |

Notes
- The sr-only label map lives in the same table as the icon, so a new built-in cannot get an icon without a name.
- Downstream compatibility is the emoji ALIAS list, not a special case per module: `🏷`/`🏷️`/`🎯` all still resolve to `Tag`, `⚙`/`⚙️` to `Settings`, `🔎` to `Search`.
- `integrations` (added in A82) carried `🔌`; it is not in the nine, so it now falls back to `Layers` until a table entry is added — recorded as a review finding rather than silently inventing a mapping.

### Testing

**Pipeline verify results**

- Verdict: PASS (from verdict artifact)

| Requirement | Status | Evidence |
|-------------|--------|----------|
| R1 `WebModule.icon` optional; the discovery guard accepts a missing icon or a string | MET | `apps/web/src/modules/types.ts:6-11`, `apps/web/src/modules/discover.ts:46-52` — `apps/web/tests/modules/discover.test.ts` ("every discovered module is WebModule-shaped" now allows absent) |
| R2 the nine built-in descriptors drop their emoji | MET | `apps/web/src/modules/{designs,features,history,observability,plans,projects,search,settings,task-kanban}/index.tsx` (no `icon:`), plus `integrations` — `apps/web/tests/modules/{observability,history/history-module}.test.ts` assert `icon` is undefined |
| R3 `ModuleIcon` resolves a vector icon by id for all nine, adding `Search`; a raw glyph `<span>` only for an unmatched declared string | MET | `apps/web/src/components/ModuleIcon.tsx:26-44` (one `BUILTIN` table), `:66-84` (resolution order) — `apps/web/tests/components/module-icon.test.tsx`: every id renders an `svg`, `search` differs from the fallback, unknown glyph renders verbatim |
| R4 sr-only text for `size="lg"` comes from the id → label map; `fallbackEmojiMap` deleted | MET | `ModuleIcon.tsx:38-42` (labels in the same table), `:79-86` — `module-icon.test.tsx` asserts no emoji code point in the `lg` text and that a non-empty name renders |
| R5 downstream `icon: '📡'` still renders the Radio vector, any other string renders verbatim, config validation unchanged | MET | `ModuleIcon.tsx:47-56` (emoji alias lookup), no change to `packages/config/src/board-modules.ts` — `module-icon.test.tsx` ("a legacy emoji still renders its vector icon" asserts the sr label is `Observability`; "an unknown glyph renders verbatim") |

| Acceptance Criteria | Status | Evidence Type | Evidence |
|---------------------|--------|---------------|----------|
| AC1 — Built-in module icons resolve through ModuleIcon by module id | MET | test | `apps/web/tests/components/module-icon.test.tsx` (nine ids, svg + label) |
| AC2 — Downstream module icon declarations keep working unchanged | MET | test | `module-icon.test.tsx` (legacy emoji alias, unknown glyph verbatim, no-entry fallback) + `packages/config` schema untouched |
- Coverage: N/A (verdict-based; verify pipeline does not measure code coverage)

### Review

<!-- spur:record-review -->

**SECU findings** (pipeline verify step — verdict: PASS)

| Priority | Dimension | Location | Finding |
|----------|-----------|----------|----------|
| P4 | — | — | No findings (verify verdict PASS) |

### References

<!-- Links to the parent feature, design docs, related tasks, or external references. -->

### History

- 2026-11-22T02:22:12.866Z backlog → todo (system)
- 2026-11-22T07:41:44.509Z todo → wip (system)
- 2026-11-22T07:42:02.629Z wip → testing (system)
- 2026-11-22T07:42:04.800Z testing → done (system)

