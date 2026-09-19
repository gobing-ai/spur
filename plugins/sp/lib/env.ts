/**
 * Vendored env gateway for the sp plugin.
 *
 * WHY this copy exists: hooks and scripts in this plugin are bundled
 * standalone by `superskill install` on targets that have no node_modules —
 * any `@gobing-ai/*` import fails to resolve there and aborts the install
 * ("Bundle failed", task 0669). This file mirrors the semantics of the
 * canonical gateway (`@gobing-ai/ts-utils` dist/env, ts-libs) so the plugin
 * stays self-contained. Keep in sync when the upstream gateway changes.
 *
 * These accessors are node-bun only: on `cloudflare-workers` there is no
 * `process`; inject config explicitly rather than calling them (ADR-008).
 */

/**
 * Read one environment variable. Only an unset variable yields `fallback`;
 * an empty string is a set value and is returned as-is.
 */
export function getEnvVar(name: string, fallback?: string): string | undefined {
    const raw = process.env[name];
    return raw === undefined ? fallback : raw;
}

/**
 * Read the live environment as a record. The returned object IS `process.env`
 * (not a copy): whole-record operations see later mutations, which child-spawn
 * composition relies on. For single variables prefer {@link getEnvVar}.
 */
export function getEnvVars(): Record<string, string | undefined> {
    return process.env;
}

/**
 * Set one environment variable through the gateway. Passing `undefined` removes
 * the key, so the save/restore idiom (`const prev = getEnvVar(k); …
 * setEnvVar(k, prev)`) restores absence exactly.
 */
export function setEnvVar(name: string, value: string | undefined): void {
    if (value === undefined) delete process.env[name];
    else process.env[name] = value;
}

/** Remove one environment variable; a no-op when the key is absent. */
export function removeEnvVar(name: string): void {
    delete process.env[name];
}
