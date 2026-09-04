import { afterEach, describe, expect, test } from 'bun:test';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createDbAdapter, type DbAdapter } from '@gobing-ai/ts-db';
import { runJsonlImport } from '@gobing-ai/ts-llm-jsonl-importer';
import { applyCliMigrations } from '../../src/migrations';

/**
 * Tool identity is populated by the IMPORT PATH, not just by a backfill (0739 R1).
 *
 * ADR-105 axis two puts `effective_tool_name` / `tool_name_alias` on the importer, so Spur owns no
 * code that fills them — but Spur's whole tool read path groups and filters on them. Migration 0034
 * backfills rows that already exist; nothing proved that a *newly imported* row lands populated.
 * That gap is what made R1 UNMET against importer 0.4.55, where every fresh row stayed `'unknown'`.
 * Neither repo had a test for it, so an upstream regression would reintroduce the defect silently
 * and Spur's suite would stay green. This is that contract test, placed here because this is where
 * the dependency bites.
 */

let workdir: string | undefined;
let db: DbAdapter | undefined;

afterEach(async () => {
    db?.close();
    db = undefined;
    if (workdir !== undefined) {
        await rm(workdir, { recursive: true, force: true });
        workdir = undefined;
    }
});

/**
 * Import a claude transcript into a database whose migrations have ALREADY run.
 *
 * The order is the point. Migration 0034 backfills `WHERE effective_tool_name = 'unknown'`, so
 * importing first and migrating second would let the backfill repair an importer regression and
 * this test would pass on exactly the broken state it exists to catch. Migrating first journals
 * 0034 as applied, which leaves the import path as the only thing that can populate these columns —
 * and matches production, where an established database imports into a migrated schema.
 */
async function importFixture(lines: readonly string[]): Promise<DbAdapter> {
    workdir = await mkdtemp(join(tmpdir(), 'spur-tool-identity-'));
    const file = join(workdir, 'history.jsonl');
    await writeFile(file, `${lines.join('\n')}\n`);

    const adapter = await createDbAdapter({ driver: 'bun-sqlite', url: ':memory:' });
    await applyCliMigrations(adapter);
    await runJsonlImport('claude', { db: adapter, files: [file], mode: 'full' });
    db = adapter;
    return adapter;
}

function assistantLine(callId: string, name: string, input: unknown): string {
    return JSON.stringify({
        type: 'assistant',
        sessionId: 'sess-identity',
        timestamp: '2026-09-03T00:00:00.000Z',
        message: {
            id: `msg-${callId}`,
            model: 'claude-opus-5',
            content: [{ type: 'tool_use', id: callId, name, input }],
        },
    });
}

describe('tool identity at import (0739 R1)', () => {
    test('an imported tool call lands with effective_tool_name and tool_name_alias populated', async () => {
        const adapter = await importFixture([assistantLine('toolu_a', 'Bash', { command: 'ls' })]);

        const rows = await adapter.queryAll<{
            tool_name: string;
            effective_tool_name: string;
            tool_name_alias: string;
        }>('SELECT tool_name, effective_tool_name, tool_name_alias FROM history_tool_call');

        expect(rows).toHaveLength(1);
        expect(rows[0]?.effective_tool_name).toBe('Bash');
        // R3: the alias defaults to that row's effective name, never to the unresolved sentinel.
        expect(rows[0]?.tool_name_alias).toBe('Bash');
    });

    test('no imported row is left on the unresolved sentinel', async () => {
        const adapter = await importFixture([
            assistantLine('toolu_a', 'Read', { file_path: '/x' }),
            assistantLine('toolu_b', 'Edit', { file_path: '/y' }),
            assistantLine('toolu_c', 'Grep', { pattern: 'q' }),
        ]);

        // 'unknown' is the DEFAULT the column carries when nothing populates it — the exact state
        // R1 was failing in. Asserting its absence is what fails if the importer stops deriving.
        const unresolved = await adapter.queryFirst<{ c: number }>(
            `SELECT COUNT(*) AS c FROM history_tool_call
             WHERE effective_tool_name = 'unknown' OR tool_name_alias = 'unknown'`,
        );
        expect(unresolved?.c).toBe(0);
    });

    test('the supporting index Spur queries through exists after migration', async () => {
        // R1's index half is Spur's under ADR-105 axis one (whoever runs the query owns the index),
        // so it comes from migration 0034, not from the importer DDL.
        const adapter = await importFixture([assistantLine('toolu_a', 'Bash', { command: 'ls' })]);

        const indexes = await adapter.queryAll<{ name: string }>(
            "SELECT name FROM sqlite_master WHERE type = 'index' AND tbl_name = 'history_tool_call'",
        );
        expect(indexes.map((i) => i.name)).toContain('idx_history_tool_call_effective_tool_name');
    });
});
