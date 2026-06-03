// ── PluginConfig merge ────────────────────────────────────────────────
//
// Precedence (lowest → highest):
//   1. plugin.yaml config: defaults
//   2. .spur/plugins/<name>.yaml overrides
//   3. SPUR_PLUGIN_<NAME>_<KEY> env vars
//
// Pure function — objects in, merged object out. No file I/O.

/** Prefix for plugin-specific environment variables. */
const ENV_PREFIX = 'SPUR_PLUGIN_';

// ── Public API ───────────────────────────────────────────────────────

/**
 * Merge plugin configuration from three layers.
 *
 * @param defaults  — config: block from plugin.yaml
 * @param overrides — .spur/plugins/<name>.yaml overrides (may be null)
 * @param env       — process env record (or subset) for SPUR_PLUGIN_<NAME>_<KEY> extraction
 * @param pluginName — used for env var prefix: SPUR_PLUGIN_<NAME_UPPER>_
 */
export function mergePluginConfig(
    defaults: Record<string, unknown>,
    overrides: Record<string, unknown> | null,
    env: Record<string, string | undefined>,
    pluginName: string,
): Record<string, unknown> {
    const merged: Record<string, unknown> = { ...defaults };

    // Layer 2: file overrides
    if (overrides) {
        for (const key of Object.keys(overrides)) {
            merged[key] = overrides[key];
        }
    }

    // Layer 3: env vars (highest precedence)
    const normalizedName = pluginName.replace(/-/g, '_').toUpperCase();
    const prefix = `${ENV_PREFIX}${normalizedName}_`;
    for (const [envKey, envVal] of Object.entries(env)) {
        if (envVal === undefined) continue;
        if (!envKey.startsWith(prefix)) continue;
        const configKey = envKey.slice(prefix.length).toLowerCase();
        merged[configKey] = parseEnvValue(envVal);
    }

    return merged;
}

function parseEnvValue(raw: string): unknown {
    // Try JSON parse first (for numbers, booleans, objects)
    try {
        return JSON.parse(raw);
    } catch (e) {
        if (e instanceof SyntaxError) {
            return raw;
        }
        throw e;
    }
}
