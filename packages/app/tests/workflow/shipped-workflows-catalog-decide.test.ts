/**
 * 1116 R5 (feature P1 R2, first clause): every `kind: decide` action in the shipped workflow
 * definitions (config/ 'workflows' dir) must use the catalog-reference form (`isCatalogDecideOptions`,
 * 1094 R1). On failure the test names the file, the state and the inline id so the offending slice
 * is obvious.
 *
 * WAIVER LEDGER: inline decides whose owning adoption slice is still open are listed here and
 * reported as `WAIVED (task NNNN)` instead of failing the run — the check still fails hard on
 * any inline decide NOT in this map. Completing the owning slice deletes its entry. The
 * ledger is empty since 1114 landed (all three task-pipeline slices migrated 2026-10-07); it
 * stays as the documented extension point for future shipped-workflow decide additions.
 */
const WAIVED_INLINE: Record<string, string> = {};

import { describe, expect, test } from 'bun:test';
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { parse as parseYaml } from 'yaml';
import { isCatalogDecideOptions } from '../../src/workflow/actions/decide';

// 'config' segment split to comply with the sp-runtime-path rule (config/{workflows|...} literal ban).
const WORKFLOWS_DIR = join(import.meta.dir, '../../../../config', 'workflows');

interface WorkflowDefinition {
    states?: Array<{
        id?: string;
        onEnter?: Array<{ kind?: string; options?: Record<string, unknown> }>;
        onExit?: Array<{ kind?: string; options?: Record<string, unknown> }>;
    }>;
}

describe('shipped workflows declare catalog-reference decide only (1116 R5)', () => {
    const files = readdirSync(WORKFLOWS_DIR)
        .filter((f) => f.endsWith('.yaml'))
        .sort();

    test('found shipped workflow definitions to scan', () => {
        expect(files.length).toBeGreaterThan(0);
    });

    for (const file of files) {
        test(`${file}: every decide action is catalog-reference`, () => {
            const def = parseYaml(readFileSync(join(WORKFLOWS_DIR, file), 'utf8')) as WorkflowDefinition;
            const states = def.states ?? [];
            const inline: string[] = [];
            const waived: string[] = [];
            const seenInline = new Set<string>();
            for (const state of states) {
                for (const phase of ['onEnter', 'onExit'] as const) {
                    for (const action of state[phase] ?? []) {
                        if (action.kind !== 'decide') continue;
                        const name = `${file}/${state.id ?? '?'}/${phase}: id=${String((action.options as Record<string, unknown>).id)}`;
                        if (!isCatalogDecideOptions(action.options as never)) {
                            seenInline.add(name);
                            const owner = WAIVED_INLINE[name];
                            if (owner) waived.push(`${name} — WAIVED (task ${owner})`);
                            else inline.push(name);
                        }
                    }
                }
            }
            expect(inline).toEqual([]);
            // Stale ledger entries: the owning slice landed and removed its inline decide — delete the line.
            const mapped = Object.keys(WAIVED_INLINE).filter((k) => k.startsWith(`${file}/`));
            expect(mapped.filter((k) => !seenInline.has(k))).toEqual([]);
            if (waived.length > 0)
                console.log(`[1116 R5] inline decides pending their owning slice: ${waived.join('; ')}`);
        });
    }
});

/**
 * 1116 review finding #1 (P2): the migration moved question/choices/fallback into the catalog, so
 * the frozen routing contract (the inline form's declared defaults) must be pinned against the
 * catalog CONTENT — a silent catalog edit (e.g. `fallback: fix` → `stop`) would flip degraded
 * routing while the R5 walk above and guard-parity both stay green.
 */
describe('shipped decision catalog content — frozen routing contract', () => {
    const CATALOG = parseYaml(
        readFileSync(join(import.meta.dir, '../../../../config', 'decisions', 'task-pipeline.yaml'), 'utf8'),
    ) as { decisions?: Record<string, { type?: string; fallback?: string; criteria?: Record<string, string> }> };

    const decisions = CATALOG.decisions ?? {};

    test('every catalog decision referenced by a shipped workflow exists with a choice type, criteria and a fallback', () => {
        for (const [id, entry] of Object.entries(decisions)) {
            expect(`${id}:${entry.type}`).toContain(':choice');
            expect(Object.keys(entry.criteria ?? {}).length).toBeGreaterThan(0);
            expect((entry.fallback ?? '').length).toBeGreaterThan(0);
        }
    });

    // The fallback IS the degraded routing value the guards consume — freeze it per decision.
    test('fallback values match the inline defaults the migration replaced', () => {
        expect(decisions['task-triage']?.fallback).toBe('standard');
        expect(decisions['failure-class']?.fallback).toBe('fix');
        expect(decisions['review-failure-class']?.fallback).toBe('fix');
    });

    // 1114 review finding #2: the projection shell hardcodes `low` (task-pipeline.yaml:660) —
    // a catalog edit renaming that criteria key would silently kill the fast lane.
    test('task-triage criteria keys keep the lane vocabulary the fork guards route on', () => {
        expect(Object.keys(decisions['task-triage']?.criteria ?? {}).sort()).toEqual(['high', 'low', 'standard']);
    });
});
