import type { DbAdapter } from '@gobing-ai/ts-db';
import { RESOLVED_TOOL_NAME_SQL } from './tool-name-sql';

/**
 * The single alias-resolution seam (0739 R4).
 *
 * `history_tool_alias_map` groups the same logical tool across agents (`Bash`, `exec_command`,
 * `run_command` → `shell`). Resolution is the map lookup with fall-through to identity, and it
 * lives in exactly two forms here: {@link applyToolAliases} writes it onto `history_tool_call`,
 * and {@link ALIASED_TOOL_NAME_SQL} reads the persisted result. Nothing else resolves aliases —
 * adding a second rule elsewhere is what R4 forbids.
 */
const MAPPED_ALIAS_SQL = `(SELECT map.alias FROM history_tool_alias_map map
    WHERE map.source = history_tool_call.source
      AND map.effective_tool_name = history_tool_call.effective_tool_name)`;

/**
 * Alias-grouped tool name for rollup SQL, over a `history_tool_call tc`.
 *
 * Prefers the persisted alias, falling back to the effective name for rows written before the
 * column existed or never passed through {@link applyToolAliases}. With an empty mapping table
 * every alias equals its effective name, so alias-grouped breakdowns are identical to
 * effective-grouped ones (R6).
 */
export const ALIASED_TOOL_NAME_SQL = `CASE
    WHEN tc.tool_name_alias IS NOT NULL AND tc.tool_name_alias != '' AND tc.tool_name_alias != 'unknown'
    THEN tc.tool_name_alias
    ELSE ${RESOLVED_TOOL_NAME_SQL}
END`;

/**
 * Apply `history_tool_alias_map` to `history_tool_call.tool_name_alias` (0739 R7).
 *
 * Called before a rollup refresh so a mapping added since the last refresh regroups
 * alias-grouped breakdowns. `effective_tool_name` is never touched — breakdowns grouped by it
 * are unchanged by design. Removing a mapping entry restores identity on the next refresh,
 * because the alias is recomputed from the map rather than accumulated.
 */
export async function applyToolAliases(db: DbAdapter): Promise<void> {
    // ponytail: full scan of history_tool_call, guarded so an unchanged corpus writes nothing.
    // If the scan ever shows up in a refresh profile, narrow it to the sources named in the map.
    await db.run(
        `UPDATE history_tool_call
         SET tool_name_alias = COALESCE(${MAPPED_ALIAS_SQL}, effective_tool_name)
         WHERE tool_name_alias IS NOT COALESCE(${MAPPED_ALIAS_SQL}, effective_tool_name)`,
    );
}

/**
 * Selection predicate matching a chosen tool name against either identity (0739 R2).
 *
 * A selection can arrive from an alias-grouped list (the board's tool dimension) or an
 * effective-grouped one (forensic `byTool`). Under a non-empty mapping table those two lists
 * carry different labels for the same calls, so the drill-down filter has to accept both or it
 * reproduces the Summary-vs-Tool-Using mismatch R2 exists to fix. Bind `placeholders`' params
 * twice — once per side of the OR.
 */
export function toolSelectionSql(tc: string, placeholders: string): string {
    return (
        `(COALESCE(NULLIF(NULLIF(${tc}.effective_tool_name, 'unknown'), ''), ${tc}.tool_name) IN (${placeholders})` +
        ` OR ${tc}.tool_name_alias IN (${placeholders}))`
    );
}
