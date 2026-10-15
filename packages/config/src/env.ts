/**
 * Lightweight env gateway subpath (`@gobing-ai/spur-config/env`).
 *
 * The same funnel the package root re-exports (single-sourced from `@gobing-ai/ts-utils`), without
 * the root barrel's zod schemas. Startup-critical paths — the CLI entry, `spur --version` and the
 * `spur self hook` transport — import this so a host hook does not pay for config validation it
 * never runs (script-absorption plan PR-L, lazy CLI loading).
 */
export { getAppOptions, getEnvVar, getEnvVars, removeEnvVar, setEnvVar } from '@gobing-ai/ts-utils';
