import { describe, expect, test } from 'bun:test';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createMigratedDb, type DbAdapter, TaskSessionDao } from '@gobing-ai/spur-domain';
import { HistoryService, type HistoryServiceContext } from '../../src/services/history-service';
import { attributeSessions } from '../../src/services/task-attribution';

function makeLocator(known: readonly string[], fail = false) {
    return {
        findByWbs: async (wbs: string) => {
            if (fail) throw new Error('locator exploded');
            return known.includes(wbs) ? { filePath: `/corpus/${wbs}.md` } : null;
        },
        /** Adapt the locator shape to attributeSessions' boolean predicate. */
        isKnownWbs: async (wbs: string) => {
            if (fail) throw new Error('locator exploded');
            return known.includes(wbs);
        },
    };
}

async function makeDb(): Promise<DbAdapter> {
    return createMigratedDb({ url: ':memory:' });
}

async function seedMessage(
    db: DbAdapter,
    input: {
        hash: string;
        source?: string;
        sessionId: string;
        role?: string;
        text: string;
        importedAt?: string;
    },
): Promise<void> {
    await db.run(
        `INSERT INTO history_message (record_hash, source, source_file, source_line, session_id, seq,
             role, record_type, disposition, ts, content_text, provenance, imported_at)
         VALUES (?, ?, '/h/.pi/agent/sessions/s.jsonl', 1, ?, 1, ?, 'message', 'conversation', NULL, ?, 'agent', ?)`,
        input.hash,
        input.source ?? 'pi',
        input.sessionId,
        input.role ?? 'user',
        input.text,
        input.importedAt ?? '2026-08-30T11:00:00.000Z',
    );
}

describe('attributeSessions (task 0722 R3/R4 composition)', () => {
    test('classifies seeded evidence, validates candidates through the locator, and writes links', async () => {
        const db = await makeDb();
        await seedMessage(db, { hash: 'm1', sessionId: 's1', text: '/sp:dev-run --mode implement 0703 --auto' });
        await seedMessage(db, {
            hash: 'm2',
            sessionId: 's2',
            text: 'pasted the /sp-dev skill docs, see task 0705 lines',
        });
        await db.run(
            `INSERT INTO history_tool_call (record_hash, message_hash, source, source_file, source_line,
                 session_id, seq, tool_name, args_raw, status, imported_at)
             VALUES ('t1', 'm3', 'pi', '/h/.pi/agent/sessions/s.jsonl', 2, 's3', 1, 'Bash',
                     'bun run spur task update 0704 --solution done', 'ok', '2026-08-30T11:00:00.000Z')`,
        );
        const summary = await attributeSessions({
            db,
            source: 'pi',
            sessionIds: ['s1', 's2', 's3'],
            isKnownWbs: makeLocator(['0703', '0704']).isKnownWbs,
            resolvedAt: '2026-08-30T12:00:00.000Z',
        });
        expect(summary).toEqual({
            sessionsEvaluated: 3,
            linksCreated: 2,
            linksAlreadyPresent: 0,
            skippedEvidence: 1, // the plain-prose user message
            ambiguousEvidence: 0,
        });
        const dao = new TaskSessionDao(db);
        const rows = await dao.listByWbs('0703');
        expect(rows).toHaveLength(1);
        expect(rows[0]).toMatchObject({
            source: 'pi',
            session_id: 's1',
            exactness: 'estimated',
            mechanism: 'slash-command',
            evidence_kind: 'user-command',
            evidence_ref: 's.jsonl#1',
        });
        expect((await dao.listByWbs('0704'))[0]).toMatchObject({ session_id: 's3', mechanism: 'spur-cli' });
    });

    test('a second identical pass is idempotent — counted present, not created', async () => {
        const db = await makeDb();
        await seedMessage(db, { hash: 'm1', sessionId: 's1', text: '/sp-dev-next 0703' });
        const base = {
            db,
            source: 'pi' as const,
            sessionIds: ['s1'],
            isKnownWbs: makeLocator(['0703']).isKnownWbs,
            resolvedAt: '2026-08-30T12:00:00.000Z',
        };
        expect((await attributeSessions(base)).linksCreated).toBe(1);
        expect(await attributeSessions(base)).toMatchObject({ linksCreated: 0, linksAlreadyPresent: 1 });
    });

    test('dry-run previews what would be created without persisting anything (R4)', async () => {
        const db = await makeDb();
        await seedMessage(db, { hash: 'm1', sessionId: 's1', text: '/sp:dev-run 0703' });
        const summary = await attributeSessions({
            db,
            source: 'pi',
            sessionIds: ['s1'],
            isKnownWbs: makeLocator(['0703']).isKnownWbs,
            resolvedAt: '2026-08-30T12:00:00.000Z',
            dryRun: true,
        });
        expect(summary).toMatchObject({ linksCreated: 1, linksAlreadyPresent: 0 });
        expect(await new TaskSessionDao(db).listByWbs('0703')).toEqual([]);
    });

    test('locator-unresolvable candidates are skipped evidence, never links (R3)', async () => {
        const db = await makeDb();
        await seedMessage(db, { hash: 'm1', sessionId: 's1', text: '/sp:dev-run 9999' });
        const summary = await attributeSessions({
            db,
            source: 'pi',
            sessionIds: ['s1'],
            isKnownWbs: makeLocator(['0703']).isKnownWbs,
            resolvedAt: '2026-08-30T12:00:00.000Z',
        });
        expect(summary).toMatchObject({ linksCreated: 0, skippedEvidence: 1 });
    });
});

describe('HistoryService attribution wiring (task 0722 R6)', () => {
    test('import returns zeroed attribution when no evidence exists', async () => {
        const ctx: HistoryServiceContext = {
            getDb: makeDb,
            taskLocator: makeLocator([]),
            historyHome: mkdtempSync(join(tmpdir(), 'spur-attr-home-')),
        };
        const svc = new HistoryService(ctx);
        const result = await svc.import('pi', { mode: 'full', root: mkdtempSync(join(tmpdir(), 'spur-attr-empty-')) });
        expect(result.attribution).toEqual({
            sessionsEvaluated: 0,
            linksCreated: 0,
            linksAlreadyPresent: 0,
            skippedEvidence: 0,
            ambiguousEvidence: 0,
        });
    });

    test('full import attributes a pre-existing session with allowlisted evidence (R4 repair)', async () => {
        const db = await makeDb();
        await seedMessage(db, { hash: 'm1', sessionId: 's1', text: '/sp:dev-run --mode implement 0703 --auto' });
        const ctx: HistoryServiceContext = {
            getDb: async () => db,
            taskLocator: makeLocator(['0703']),
            historyHome: mkdtempSync(join(tmpdir(), 'spur-attr-home-')),
        };
        const svc = new HistoryService(ctx);
        const result = await svc.import('pi', { mode: 'full', root: mkdtempSync(join(tmpdir(), 'spur-attr-empty-')) });
        expect(result.attribution).toMatchObject({ sessionsEvaluated: 1, linksCreated: 1 });
        expect(result.attributionError).toBeUndefined();
        expect(await new TaskSessionDao(db).listByWbs('0703')).toHaveLength(1);

        // Incremental import evaluates only what it touches — the pre-existing
        // session is outside the changed set, so nothing is re-counted.
        const incremental = await svc.import('pi', { root: mkdtempSync(join(tmpdir(), 'spur-attr-empty-')) });
        expect(incremental.attribution).toMatchObject({ sessionsEvaluated: 0 });
    });

    test('import without a task locator skips attribution (attribution: null)', async () => {
        const svc = new HistoryService({ getDb: makeDb });
        const result = await svc.import('pi', { mode: 'full', root: mkdtempSync(join(tmpdir(), 'spur-attr-empty-')) });
        expect(result.attribution).toBeNull();
    });

    test('a failed attribution pass degrades the report: attributionError + attribution-failed warning', async () => {
        const db = await makeDb();
        await seedMessage(db, { hash: 'm1', sessionId: 's1', text: '/sp:dev-run 0703' });
        const ctx: HistoryServiceContext = {
            getDb: async () => db,
            taskLocator: makeLocator(['0703'], true),
            historyHome: mkdtempSync(join(tmpdir(), 'spur-attr-home-')),
        };
        const svc = new HistoryService(ctx);
        const single = await svc.import('pi', { mode: 'full', root: mkdtempSync(join(tmpdir(), 'spur-attr-empty-')) });
        expect(single.attribution).toBeNull();
        expect(single.attributionError).toContain('locator exploded');

        const fanOut = await svc.importAll({
            sources: ['pi'],
            mode: 'full',
            root: mkdtempSync(join(tmpdir(), 'spur-attr-empty-')),
        });
        expect(fanOut.warnings.some((w) => w.code === 'attribution-failed' && w.source === 'pi')).toBe(true);
        expect(fanOut.attribution).toEqual({
            sessionsEvaluated: 0,
            linksCreated: 0,
            linksAlreadyPresent: 0,
            skippedEvidence: 0,
            ambiguousEvidence: 0,
        });
    });
});
