# 00 ADR — Spur Re-Foundation

## ADR-001: Greenfield Re-Foundation in `spur-new`

**Status:** Accepted
**Date:** 2026-05-30

Spur is re-founded in `~/xprojects/spur-new/` as a clean Bun workspace monorepo. The existing `~/xprojects/spur/` tree remains the read-only reference and rollback source until the final swap.

## ADR-002: Bun Workspaces, No Turborepo

**Status:** Accepted

The new foundation uses Bun workspace filtering for orchestration:

- `apps/*`
- `packages/*`

Turborepo is intentionally not included. At the target scale, Bun native orchestration keeps the graph explicit and avoids another cache/config layer.

## ADR-003: Shared TypeScript Tooling from ts-base

**Status:** Accepted

The scaffold imports ts-base conventions for Biome, Lefthook, and shared TypeScript presets under `tooling/typescript/`. Root scripts use Biome plus `tsc --noEmit` as the lint/type gate.

## ADR-004: ts-libs as External Semver Dependencies

**Status:** Accepted

The foundation consumes published `@gobing-ai/ts-*` packages by semver:

- `@gobing-ai/ts-db`
- `@gobing-ai/ts-infra`
- `@gobing-ai/ts-runtime`
- `@gobing-ai/ts-utils`

These packages live in the separate `~/xprojects/ts-libs/` repository. `workspace:*` is not valid for committed manifests in this repo. Local `bun link` is allowed only as temporary extraction-loop tooling.

## ADR-005: oRPC as the New Type Seam

**Status:** Accepted

The re-foundation adopts oRPC as the server/web type seam, replacing the old Hono RPC plus `@hono/zod-openapi` seam. Follow-up porting tasks own the concrete app and API migration; this scaffold records the architectural direction and keeps the foundation ready for that boundary.

## ADR-006: Legacy Drizzle Migrations Are Reference-Only

**Status:** Accepted

The old `drizzle/` directory is copied only as historical/reference material. New migrations are regenerated after the data model is reconciled in the follow-up schema tasks.
