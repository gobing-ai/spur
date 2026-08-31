import { describe, expect, test } from 'bun:test';
import { createDbAdapter, type DbAdapter } from '@gobing-ai/ts-db';
import {
    applyCliMigrations,
    type InsertTaskSessionInput,
    listAttributionSessions,
    loadAttributionEvidence,
    TaskSessionDao,
} from '../../src';

async function makeDb(): Promise<DbAdapter> {
    const adapter = await createDbAdapter({ driver: 'bun-sqlite', url: ':memory:' });
    await applyCliMigrations(adapter);
    return adapter;
}

function linkInput(overrides: Partial<InsertTaskSessionInput> = {}): InsertTaskSessionInput {
    return {
        wbs: '0703',
        source: 'pi',
        sessionId: 'sess-1',
        exactness: 'estimated',
        mechanism: 'slash-command',
        evidenceKind: 'user-command',
        evidenceRef: 'a.jsonl#12',
        resolvedAt: '2026-08-30T12:00:00.000Z',
        ...overrides,
    };
}

describe('TaskSessionDao (task 0722 R2)', () => {
    test('insert + both lookup directions', async () => {
        const db = await makeDb();
        const dao = new TaskSessionDao(db);
        await dao.insert(linkInput());
        await dao.insert(linkInput({ wbs: '0704', mechanism: 'spur-cli', evidenceKind: 'cli-tool' }));

        const byWbs = await dao.listByWbs('0703');
        expect(byWbs).toHaveLength(1);
        expect(byWbs[0]).toMatchObject({
            wbs: '0703',
            source: 'pi',
            session_id: 'sess-1',
            exactness: 'estimated',
            mechanism: 'slash-command',
            evidence_kind: 'user-command',
            evidence_ref: 'a.jsonl#12',
        });
        const bySession = await dao.listBySession('pi', 'sess-1');
        expect(bySession.map((r) => r.wbs)).toEqual(['0703', '0704']);
        expect(await dao.listBySession('pi', 'other')).toEqual([]);
        expect(await dao.listByWbs('9999')).toEqual([]);
        await dao.deleteAll();
        expect(await dao.listByWbs('0703')).toEqual([]);
    });

    test('insert is idempotent on (wbs, source, session_id) — second identical write is present', async () => {
        const db = await makeDb();
        const dao = new TaskSessionDao(db);
        expect(await dao.insert(linkInput())).toBe('created');
        expect(await dao.insert(linkInput({ evidenceRef: 'a.jsonl#99' }))).toBe('present');
        expect(await dao.listByWbs('0703')).toHaveLength(1);
        // The first evidence locator wins — re-imports never rewrite history.
        expect((await dao.listByWbs('0703'))[0]?.evidence_ref).toBe('a.jsonl#12');
    });

    test('exact-over-estimated precedence: exact write upgrades, estimated never shadows', async () => {
        const db = await makeDb();
        const dao = new TaskSessionDao(db);
        await dao.insert(linkInput());
        expect(
            await dao.insert(linkInput({ exactness: 'exact', mechanism: 'spur-cli', evidenceKind: 'cli-tool' })),
        ).toBe('created');
        const upgraded = (await dao.listByWbs('0703'))[0];
        expect(upgraded?.exactness).toBe('exact');
        expect(upgraded?.mechanism).toBe('spur-cli');
        // An estimated write after exact is a no-op.
        expect(await dao.insert(linkInput())).toBe('present');
        expect((await dao.listByWbs('0703'))[0]?.exactness).toBe('exact');
    });

    test('hasLink answers the dry-run preview without writing (R4)', async () => {
        const db = await makeDb();
        const dao = new TaskSessionDao(db);
        expect(await dao.hasLink('0703', 'pi', 'sess-1')).toBe(false);
        await dao.insert(linkInput());
        expect(await dao.hasLink('0703', 'pi', 'sess-1')).toBe(true);
        expect(await dao.hasLink('0703', 'pi', 'other')).toBe(false);
    });

    test('missing table reads as empty (unmigrated DB)', async () => {
        const adapter = await createDbAdapter({ driver: 'bun-sqlite', url: ':memory:' });
        const dao = new TaskSessionDao(adapter);
        expect(await dao.listByWbs('0703')).toEqual([]);
        expect(await dao.listBySession('pi', 's')).toEqual([]);
    });
});

describe('attribution evidence reads (task 0722, ADR-011 raw SQL in domain)', () => {
    async function seedMessage(
        db: DbAdapter,
        input: { hash: string; sessionId: string; role: string; text: string | null; importedAt?: string },
    ): Promise<void> {
        await db.run(
            `INSERT INTO history_message (record_hash, source, source_file, source_line, session_id, seq,
                 role, record_type, disposition, ts, content_text, provenance, imported_at)
             VALUES (?, 'pi', '/h/.pi/sessions/a.jsonl', 1, ?, 1, ?, 'message', 'conversation', NULL, ?, 'ambient', ?)`,
            input.hash,
            input.sessionId,
            input.role,
            input.text,
            input.importedAt ?? '2026-08-30T12:00:00.000Z',
        );
    }

    test('listAttributionSessions scopes all/changed and skips placeholder ids', async () => {
        const db = await makeDb();
        await seedMessage(db, { hash: 'm1', sessionId: 's1', role: 'user', text: 'hello' });
        await seedMessage(db, {
            hash: 'm2',
            sessionId: 's2',
            role: 'user',
            text: 'hello',
            importedAt: '2026-08-30T13:00:00.000Z',
        });
        await seedMessage(db, { hash: 'm3', sessionId: '', role: 'user', text: 'hello' });
        expect(await listAttributionSessions(db, 'pi', { scope: 'all' })).toEqual(['s1', 's2']);
        expect(
            await listAttributionSessions(db, 'pi', { scope: 'changed', changedSince: '2026-08-30T12:30:00.000Z' }),
        ).toEqual(['s2']);
        expect(await listAttributionSessions(db, 'codex', { scope: 'all' })).toEqual([]);
    });

    test('loadAttributionEvidence prefilters allowlisted syntax per session, bounded', async () => {
        const db = await makeDb();
        await seedMessage(db, {
            hash: 'e1',
            sessionId: 's1',
            role: 'user',
            text: '/sp:dev-run --mode implement 0703 --auto',
        });
        await seedMessage(db, { hash: 'e2', sessionId: 's1', role: 'user', text: 'plain mention of 0704 in prose' });
        await seedMessage(db, { hash: 'e3', sessionId: 's1', role: 'assistant', text: '/sp:dev-run 0705' });
        await seedMessage(db, { hash: 'e4', sessionId: 's2', role: 'user', text: '/sp-dev-next 0706' });
        await db.run(
            `INSERT INTO history_tool_call (record_hash, message_hash, source, source_file, source_line,
                 session_id, seq, tool_name, args_raw, status, imported_at)
             VALUES ('t1', 'e1', 'pi', '/h/.pi/sessions/a.jsonl', 2, 's1', 1, 'Bash',
                     'bun run spur task update 0705 --solution done', 'ok', '2026-08-30T12:00:00.000Z')`,
        );
        const s1 = await loadAttributionEvidence(db, 'pi', 's1');
        // user-command evidence only from user rows; assistant rows and other sessions excluded;
        // the tool-call side contributes the spur-task args.
        expect(s1.map((e) => e.kind)).toEqual(['user-message', 'tool-call']);
        expect(s1[0]?.text).toContain('/sp:dev-run');
        expect(s1[1]?.text).toContain('spur task update 0705');
        expect(await loadAttributionEvidence(db, 'pi', 's2').then((rows) => rows.length)).toBe(1);
        expect(await loadAttributionEvidence(db, 'pi', 'missing')).toEqual([]);
    });

    test('missing importer tables read as empty (foundation-only DB)', async () => {
        const adapter = await createDbAdapter({ driver: 'bun-sqlite', url: ':memory:' });
        expect(await listAttributionSessions(adapter, 'pi', { scope: 'all' })).toEqual([]);
        expect(await loadAttributionEvidence(adapter, 'pi', 's')).toEqual([]);
    });
});
