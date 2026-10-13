import type { ArtifactSelector } from './artifact';
import { toolSelectionSql } from './tool-alias';

// Selector → WHERE clause builder shared by forensic-query and watermark. Extracted from
// forensic-query so watermark no longer imports the module that imports it (cycle).

export function escapeLike(value: string): string {
    return value.replaceAll('!', '!!').replaceAll('%', '!%').replaceAll('_', '!_');
}

/**
 * Selector predicate clauses against `history_message`, parameterized by alias so
 * the watermark queries can reuse the same scope against a second alias (`m2`).
 */
export function buildMessageWhereClauses(
    sel: ArtifactSelector,
    alias: string,
): { clauses: string[]; params: unknown[] } {
    const clauses: string[] = [];
    const params: unknown[] = [];
    if (sel.since != null) {
        clauses.push(`${alias}.ts >= ?`);
        params.push(sel.since);
    }
    if (sel.until != null) {
        clauses.push(`${alias}.ts <= ?`);
        params.push(sel.until);
    }
    if (sel.sources != null && sel.sources.length > 0) {
        clauses.push(`${alias}.source IN (${sel.sources.map(() => '?').join(', ')})`);
        params.push(...sel.sources);
    }
    if (sel.models != null && sel.models.length > 0) {
        clauses.push(`${alias}.model IN (${sel.models.map(() => '?').join(', ')})`);
        params.push(...sel.models);
    }
    if (sel.tools != null && sel.tools.length > 0) {
        const validTools = sel.tools.map((t) => (t && t.trim() !== '' ? t.trim() : 'unknown'));
        if (validTools.length > 0) {
            const placeholders = validTools.map(() => '?').join(', ');
            clauses.push(
                'EXISTS (SELECT 1 FROM ' +
                    `history_tool_call tc_filt WHERE tc_filt.message_hash = ${alias}.record_hash AND ${toolSelectionSql('tc_filt', placeholders)})`,
            );
            params.push(...validTools, ...validTools);
        }
    }
    if (sel.skills != null && sel.skills.length > 0) {
        const validSkills = sel.skills.filter((s) => s && s.trim() !== '' && s !== 'unknown');
        if (validSkills.length > 0) {
            const skillConditions = validSkills.map(
                () => "tc_filt.tool_name LIKE ? ESCAPE '!' OR tc_filt.args_raw LIKE ? ESCAPE '!'",
            );
            clauses.push(
                'EXISTS (SELECT 1 FROM ' +
                    `history_tool_call tc_filt WHERE tc_filt.message_hash = ${alias}.record_hash AND (${skillConditions.join(' OR ')}))`,
            );
            for (const sk of validSkills) {
                const escaped = escapeLike(sk);
                params.push(`%${escaped}%`, `%${escaped}%`);
            }
        }
    }
    if (sel.sessionId != null) {
        clauses.push(`${alias}.session_id = ?`);
        params.push(sel.sessionId);
    }
    if (sel.runId != null && sel.taskWbs != null) {
        clauses.push(
            `EXISTS (
                SELECT 1 FROM history_run_session hrs_scope
                JOIN task_run_links trl_scope ON trl_scope.run_id = hrs_scope.run_id
                WHERE hrs_scope.run_id = ? AND trl_scope.wbs = ?
                  AND hrs_scope.session_id IS NOT NULL
                  AND hrs_scope.source = ${alias}.source
                  AND hrs_scope.session_id = ${alias}.session_id
            )`,
        );
        params.push(sel.runId, sel.taskWbs);
    } else if (sel.runId != null) {
        clauses.push(
            `EXISTS (
                SELECT 1 FROM history_run_session hrs_scope
                WHERE hrs_scope.run_id = ? AND hrs_scope.session_id IS NOT NULL
                  AND hrs_scope.source = ${alias}.source
                  AND hrs_scope.session_id = ${alias}.session_id
            )`,
        );
        params.push(sel.runId);
    } else if (sel.taskWbs != null) {
        // Task 0722 R5: task-only selection matches the union of the established
        // run chain (task_run_links → history_run_session) and the direct
        // import-recovered task↔session authority. Task+run keeps intersection
        // semantics through the real run chain above; unresolved/ambiguous
        // mappings never match (`session_id IS NOT NULL`, and direct rows exist
        // only for locator-validated evidence).
        clauses.push(
            `(
                EXISTS (
                    SELECT 1 FROM task_run_links trl_scope
                    JOIN history_run_session hrs_scope ON hrs_scope.run_id = trl_scope.run_id
                    WHERE trl_scope.wbs = ? AND hrs_scope.session_id IS NOT NULL
                      AND hrs_scope.source = ${alias}.source
                      AND hrs_scope.session_id = ${alias}.session_id
                )
                OR EXISTS (
                    SELECT 1 FROM history_task_session hts_scope
                    WHERE hts_scope.wbs = ?
                      AND hts_scope.source = ${alias}.source
                      AND hts_scope.session_id = ${alias}.session_id
                )
            )`,
        );
        params.push(sel.taskWbs, sel.taskWbs);
    }
    return { clauses, params };
}
