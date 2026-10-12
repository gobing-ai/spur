---
kind: design
title: Feature `deprecated` status — frozen-but-retained lifecycle state
status: proposed
created_at: 2026-10-11
updated_at: 2026-10-11
related: [F42, ADR-136, ADR-135, DD-13]
tags: [feature, lifecycle, status, planning]
---

# Feature `deprecated` status — frozen-but-retained lifecycle state

## 1. Issue and scope

Feature records have no way to say "kept for history, do not change unless removing it". Operators
have bent `done` and `cancelled` to cover it: M (Teams) is `done` although G64 retired its surface,
and M3/M6 were `cancelled` only to freeze them. `cancelled` is terminal and claims the work was
abandoned; `done` invites follow-up tasks through the reopen rule. Neither tells an agent to keep out.

Scope (F42): add `deprecated` as a canonical non-terminal `FeatureStatus`, wire it through the
lifecycle graph, freeze guards, checks, derivation, CLI, Board, skills and docs. Out of scope:
relabelling existing features, a feature delete verb, an override flag, and a task-level
`deprecated` status. This document is **proposed**; §3 lists the surfaces as they must change.

## 2. Context and constraints

- Status is file frontmatter only; no DB column or migration exists (`packages/domain/src/planning/schema.ts:23`).
- Contracts use `z.enum(FEATURE_STATUSES)` (`packages/contracts/src/feature.ts:16`), so the enum
  addition flows to oRPC/OpenAPI with no hand edits.
- Every status write is proven against `feature-lifecycle.yaml` or refused, on every transport (ADR-135).
- Corpus at design time: 128 done, 32 verifying, 15 active, 4 backlog, 4 cancelled — none deprecated.
- Consumer projects may carry a project-layer `feature-lifecycle.yaml`; it resolves before the
  shipped graph, so a stale override refuses the new edges until re-synced.

## 3. Solution

`deprecated` means **retained and frozen**: the record stays readable and countable, but nothing may
attach new work to it or advance it. Leaving the state is explicit — un-deprecate to `active`, or
`cancelled` once the feature is removed.

### 3.1 Affected-surface review

| # | Surface | Location | Change |
| --- | --- | --- | --- |
| S1 | Domain vocabulary | `packages/domain/src/planning/schema.ts:23,42,152,205,347` | Append `deprecated` to `FEATURE_STATUSES`; add icon in `FEATURE_STATUS_ICONS`; add only the identity alias `deprecated: 'deprecated'` (`normalizeFeatureStatus` throws on keys missing from the alias map). |
| S2 | Contracts / OpenAPI | `packages/contracts/src/feature.ts:16,32,61,69` | No edit; OpenAPI is built at runtime (`apps/server/src/openapi.ts`), so nothing to regenerate. |
| S3 | Lifecycle graph | `config/workflows/feature-lifecycle.yaml` (+ generated `apps/cli/config/`) | States + edges in §4.1; `deprecated` stays out of `terminalStates`. |
| S4 | Shipped graph copy | `apps/cli/config/workflows/feature-lifecycle.yaml` (generated) | Byte-identical to S3 via `build:bundle`; no separate init template exists. |
| S5 | Status derivation | `packages/app/src/services/feature-service.ts:441,463,470` | `deriveFeatureStatus` returns no proposal for `deprecated` (sticky); not terminal, never reopened. |
| S6 | Feature writes | `feature-service.ts:225` (`update --section`) | Write lands; append a freeze note to `warnings[]`. |
| S7 | One-active-goal | `feature-service.ts:786`, `feature-check.ts:511` | No change: only `active` counts. |
| S8 | Task link guard | `packages/app/src/services/task-service.ts:807,817,2040` | Reject `deprecated` parents on create / update `--feature` / batch-create, no reopen, `--no-reopen` irrelevant. |
| S9 | Task check | `packages/app/src/services/task-check.ts:1110` | New warning `L4.feature-deprecated` for a live task under a deprecated feature. |
| S10 | Feature check | `packages/app/src/services/feature-check.ts:239,706,806,821` | No verifying/done probes for `deprecated`; no new errors. |
| S11 | CLI `advance` | `apps/cli/src/commands/feature.ts:180` | Already stops (no `forwardPath` entry); add the un-deprecate hint. `list --status deprecated` works through the enum. |
| S12 | `sync` / `refresh` | `feature-service.ts` sync path; `docs/features/INDEX.md` | `sync`: no status change for deprecated. `refresh` is docs-only by contract; INDEX lists it. |
| S13 | Board | `apps/web/src/modules/features/feature-actions.ts`, `status-icons.tsx:20`, `FeaturesShell.tsx:265`, `FeatureDetail.tsx:489` | Lucide `Archive` icon (ADR-133); filter follows `FEATURE_STATUSES` automatically; `deprecate` action on backlog/active/verifying/blocked/done; deprecated shows only `undeprecate` and `cancel`. |
| S14 | Plugin scripts | `plugins/sp/scripts/wrapup-steps.ts:171,288`, `batch-preflight.ts:144,258` | Audit only — they read task statuses or `verifying`; expected no edit. |
| S15 | Skills | `plugins/sp/skills/next-feature/SKILL.md:67`; `spur-cli/references/features.md` | Drop deprecated candidates; document status, edges, guards. |
| S16 | Docs | `planning-record-contracts.md` §7.3.3, `rd3-migration-design.md` §2.3, `planning-workflow-contracts.md`, `e2e-workflow-for-system-development.md` | Update the status vocabulary and graph. |
| S17 | Persistence | — | None (frontmatter only). |

## 4. Contract and compatibility

### 4.1 Lifecycle edges

| From | To | Guard | Note |
| --- | --- | --- | --- |
| backlog, active, verifying, blocked, done | deprecated | `always` | Freeze. |
| deprecated | active | `always` | Un-deprecate; History entry mandatory. |
| deprecated | cancelled | `always` | Feature removed. |

Any other edge out of `deprecated` (`done`, `verifying`, `blocked`, `backlog`) is undeclared and
refused by the graph (ADR-135). `cancelled → deprecated` is not declared; cancelled stays terminal.

### 4.2 Guards and findings

- **Link guard (S8):** `spur task create|update --feature F|batch-create` with a deprecated parent
  exits non-zero, writes nothing, names the status and up to three `active` sibling ids. Batch-create
  rejects the whole batch in its phase-1 parent check.
- **`L4.feature-deprecated` (S9):** warning, not error — existing live tasks are surfaced, not blocked;
  `--strict` elevates it as usual.
- **Section-write warning (S6):** `warnings[]` gains `Feature <id> is deprecated (frozen); change it
  only as part of removal`. Exit code 0.
- **`advance` (S11):** exit 1 with `Feature <id> is deprecated; run spur feature update <id> active first`.
- **Derivation (S5/S12):** `sync`, `refresh` and `check --fix` never propose a status for a
  deprecated feature.
- **next-feature (S15):** deprecated features are never candidates.

### 4.3 Compatibility

- Additive enum: old readers that validate with an older enum reject `deprecated` frontmatter;
  shipped in one release with the server, CLI and Board.
- Consumer projects with a project-layer `feature-lifecycle.yaml` must re-sync it (release note);
  until then the graph refuses `→ deprecated` with the standard undeclared-edge message.

## 5. Tradeoffs and open questions

- **Non-terminal over terminal:** a terminal `deprecated` would duplicate `cancelled` and lose
  un-deprecate. Decision recorded in ADR-136.
- **Warning over error for live tasks:** making it an error would turn every deprecation into a red
  gate for unrelated work; the link guard already stops new attachments.
- **No override flag:** removal work runs under its own feature; YAGNI until a real case needs to
  attach a task to a frozen feature.
- **No synonym aliases** (`obsolete`, `retired`): add when an importer needs them.
- Open: relabel M, M3, M6 after ship — operator decision, tracked outside F42.
