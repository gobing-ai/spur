import type { DbAdapter } from '@gobing-ai/ts-db';

/**
 * Resolves a tool's cross-agent alias from an alias map or falls through to identity.
 * An absent mapping returns effectiveToolName unchanged.
 */
export function resolveToolAlias(
    source: string,
    effectiveToolName: string,
    mapping?: Map<string, string> | Record<string, string>,
): string {
    if (!mapping) {
        return effectiveToolName;
    }
    if (mapping instanceof Map) {
        return mapping.get(`${source}\0${effectiveToolName}`) ?? mapping.get(effectiveToolName) ?? effectiveToolName;
    }
    return mapping[`${source}\0${effectiveToolName}`] ?? mapping[effectiveToolName] ?? effectiveToolName;
}

/**
 * Loads the complete tool alias map from the database.
 */
export async function loadToolAliasMap(db: DbAdapter): Promise<Map<string, string>> {
    const map = new Map<string, string>();
    try {
        const rows = await db.queryAll<{ source: string; effective_tool_name: string; alias: string }>(
            'SELECT source, effective_tool_name, alias FROM history_tool_alias_map',
        );
        for (const row of rows) {
            map.set(`${row.source}\0${row.effective_tool_name}`, row.alias);
        }
    } catch {
        // Table may not exist yet in unmigrated databases
    }
    return map;
}

/**
 * Resolves a tool alias directly from the database, falling through to identity.
 */
export async function resolveToolAliasFromDb(
    db: DbAdapter,
    source: string,
    effectiveToolName: string,
): Promise<string> {
    try {
        const row = await db.queryFirst<{ alias: string }>(
            'SELECT alias FROM history_tool_alias_map WHERE source = ? AND effective_tool_name = ?',
            source,
            effectiveToolName,
        );
        return row?.alias ?? effectiveToolName;
    } catch {
        return effectiveToolName;
    }
}
