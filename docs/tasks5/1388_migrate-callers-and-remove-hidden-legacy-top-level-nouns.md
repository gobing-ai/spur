---
schema_version: 1
name: Migrate callers and remove hidden legacy top-level nouns
status: todo
template: feature-impl
created_at: 2026-11-18T05:29:30.253Z
updated_at: "2026-11-18T05:52:47.698Z"
feature_id: A36
priority: P1
tags:
  - phase-1
  - protocol-surfaces
estimate_hours: 6

dependencies: ["1387"]
---

## 1388. Migrate callers and remove hidden legacy top-level nouns

### Background

`init`, `maintain`, `migrate`, `serve` and `status` are registered as hidden top-level aliases (`apps/cli/src/index.ts:323-327`), and `migrate`/`status` are also registered on the boot-free fast path (`:144`, `:168`).

**Refine corrections (2026-11-17)**
- "internal callers may still spawn them" → confirmed, a live one: `startProject` spawns `[...invocation, 'serve', …]` (`packages/app/src/services/project-start.ts:464-473`), so every `spur projects start` and every gateway-started project uses the legacy noun. The LaunchAgent plist already uses `self serve` (`packages/app/src/services/gateway-daemon.ts:82`). → Migrate the spawn argv first. It is the one caller whose breakage would take every gateway-routed project down.
- The scope was larger than the inventory step implied → `rg "spur (serve|init|maintain|migrate|status)\b"` finds 89 non-test source mentions (mostly user-facing remedy strings such as "restart it with `spur serve`"), plus scripts (`scripts/commands/a2a-serve-e2e.ts:136` spawns `bun CLI serve`), `scripts/commands/surface-drift-inventory.test.ts` rows, plugin references and templates (`config/templates/AGENTS.md`).
- Fast path missed → the boot-free `migrate`/`status` registrations at `index.ts:144,168` must go too, or the alias survives on the fast path.
- `scripts/install.sh` was suspected → it already runs `self install` (`:121`). Only its comment at `:19` needs updating.

### Requirements

- [ ] R1. Migrate every executable caller to `self <verb>`: the `project-start.ts` spawn argv, script spawns (`a2a-serve-e2e.ts`, `a2a-member-e2e.ts`, `fleet-e2e.ts` and any others `rg` finds), and package scripts.
- [ ] R2. Migrate user-facing strings (remedy messages, help summaries such as "requires spur serve"), plugin references, templates, READMEs and drift-inventory rows to the `spur self <verb>` spelling.
- [ ] R3. Remove the five hidden registrations at `index.ts:323-327` and the fast-path `migrate`/`status` registrations at `:144,168`, keeping the `self` fast path intact. Drop the `hidden` option from the register helpers if nothing else uses it.
- [ ] R4. Prove after removal that `spur projects start` spawns a healthy serve, the gateway starts and proxies to it, `spur serve` is an unknown command, and the parity suites pass. `rg` over executable sources returns no legacy spelling.

### Acceptance Criteria

- [ ] AC1 — Legacy top-level nouns are removed with no internal caller left (req: R1, R2, R3, R4)

Test layer: the real commander program, the real `startProject` spawn seam, and one real gateway proxy smoke.

### Q&A

<!-- CLOSED decisions from refinement: what was chosen and why, what was deferred and on what
     condition. Not a parking lot for open questions — an unanswered question here means the task
     is not ready to hand off. Keep empty if none. -->

#### Q&A entry — 2026-11-18T05:52:45.710Z

- **Split string migration from removal?** Closed: no. It lands as one commit so no tree ships with documented-but-removed spellings.
- **Stale plugin copies elsewhere?** Accepted break pre-1.0; the remedy is `superskill install sp`.

### Design

**WHAT.** Do callers first and the removal last, in one commit:
1. Change the argv in `project-start.ts` to `[...invocation, 'self', 'serve', …]`, and pin it with a spawn-seam test.
2. Do a mechanical string migration over the files `rg` lists, reviewing each file. Generated files such as `apps/cli/schemas/*.json` and `apps/cli/config/` are regenerated, never hand-edited.
3. Delete the registrations.

**WHY.** The spawn argv is the only runtime caller. Everything else is text that would teach agents and operators a dead spelling. A single commit means no intermediate tree ships with a broken `projects start`.

**WHERE.** `packages/app/src/services/project-start.ts`, `apps/cli/src/index.ts`, `apps/cli/src/commands/{serve,init,maintain,migrate,status}.ts` (hidden options), the remedy strings across `apps/` and `packages/`, `scripts/commands/*`, `plugins/sp/**`, `config/templates/*` and READMEs.

**Anti-patterns.** Don't sed-replace inside CHANGELOG, done tasks, ADR history or migrations (`drizzle/0047` mentions the spelling in a comment, which is history). Don't touch `vendors/`.

**Blast radius.** Projects started by an older binary keep running. Stale plugin copies in other projects that call `spur serve` break until re-installed (`superskill install sp`). That break is accepted pre-1.0 (feature Notes).

### Plan

- [ ] Step 1 (test first, R1/R4): add a `startProject` spawn-seam test asserting the argv contains `self serve`, and a program test asserting `spur serve` / `spur status` are unknown commands on both the normal path and the fast path.
- [ ] Step 2 (R1): migrate the executable callers.
- [ ] Step 3 (R2): migrate strings and docs, file by file from the `rg` inventory, and regenerate generated files.
- [ ] Step 4 (R3): remove the registrations.
- [ ] Step 5 (R4): `bun run --filter @gobing-ai/spur build:bundle`, then a real `spur projects start` plus a gateway proxy smoke on a temp project. Then the parity suites, `bun run spur-check`, and `bun run test:heavy` for the gateway e2e.

### Solution

<!-- Filled during implementation: file:line change map and concise rationale. -->

### Testing

<!-- Filled during verification: commands run, outcomes, coverage claim or N/A. -->

### Review

<!-- Filled during review: P1-P4 findings, residual risk, and final disposition. -->

### References

<!-- Links to the parent feature, design docs, related tasks, or external references. -->

### History
