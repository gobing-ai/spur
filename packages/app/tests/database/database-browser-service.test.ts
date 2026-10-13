import { describe, expect, test } from 'bun:test';
import { DEFAULT_DATABASE_PAGE_SIZE } from '@gobing-ai/spur-domain';
import { createDbAdapter, type DbAdapter } from '@gobing-ai/ts-db';
import { DatabaseBrowserService, MAX_DATABASE_PAGE_SIZE } from '../../src/index';

async function fixtureDb(): Promise<DbAdapter> {
    const db = await createDbAdapter({ driver: 'bun-sqlite', url: ':memory:' });
    await db.exec('CREATE TABLE people (id INTEGER PRIMARY KEY, name TEXT NOT NULL)');
    await db.run('INSERT INTO people (id, name) VALUES (?, ?)', 1, 'ada');
    await db.run('INSERT INTO people (id, name) VALUES (?, ?)', 2, 'bob');
    await db.run('INSERT INTO people (id, name) VALUES (?, ?)', 3, 'cyd');
    return db;
}

describe('DatabaseBrowserService.describe', () => {
    test('passes a live table through and names an unknown one', async () => {
        const db = await fixtureDb();
        const service = new DatabaseBrowserService(db);
        const found = await service.describe('people');
        expect(found.ok).toBe(true);
        if (found.ok) expect(found.value.rowCount).toBe(3);
        expect(await service.describe('ghost')).toEqual({
            ok: false,
            outcome: 'unknown-table',
            message: 'unknown table: ghost',
        });
        db.close();
    });

    test('lists tables through the domain inspector', async () => {
        const db = await fixtureDb();
        expect(await new DatabaseBrowserService(db).listTables()).toEqual(['people']);
        db.close();
    });
});

describe('DatabaseBrowserService.readRows normalization', () => {
    test('defaults page size to 50 and normalises page to 1', async () => {
        const db = await fixtureDb();
        const result = await new DatabaseBrowserService(db).readRows('people', {});
        expect(result.ok).toBe(true);
        if (result.ok) {
            expect(result.value.page).toBe(1);
            expect(result.value.pageSize).toBe(DEFAULT_DATABASE_PAGE_SIZE);
            expect(result.value.total).toBe(3);
            expect(result.value.columns).toEqual(['id', 'name']);
        }
        db.close();
    });

    test('clamps pageSize over the cap and any page below 1', async () => {
        const db = await fixtureDb();
        const service = new DatabaseBrowserService(db);
        const over = await service.readRows('people', { pageSize: '5000' });
        expect(over.ok).toBe(true);
        if (over.ok) expect(over.value.pageSize).toBe(MAX_DATABASE_PAGE_SIZE);
        const below = await service.readRows('people', { page: '0', pageSize: '0' });
        expect(below.ok).toBe(true);
        if (below.ok) {
            expect(below.value.page).toBe(1);
            expect(below.value.pageSize).toBe(DEFAULT_DATABASE_PAGE_SIZE);
        }
        // Malformed numbers fall back to the defaults rather than failing the read.
        const malformed = await service.readRows('people', { page: 'abc', pageSize: 'ten' });
        expect(malformed.ok).toBe(true);
        if (malformed.ok) expect(malformed.value.pageSize).toBe(DEFAULT_DATABASE_PAGE_SIZE);
        db.close();
    });

    test('a page beyond the end carries the total but no rows', async () => {
        const db = await fixtureDb();
        const result = await new DatabaseBrowserService(db).readRows('people', { page: '9', pageSize: '2' });
        expect(result.ok).toBe(true);
        if (result.ok) {
            expect(result.value.total).toBe(3);
            expect(result.value.rows).toEqual([]);
        }
        db.close();
    });
});

describe('DatabaseBrowserService failure outcomes', () => {
    test('rejects a dir outside asc/desc', async () => {
        const db = await fixtureDb();
        const result = await new DatabaseBrowserService(db).readRows('people', { sort: 'name', dir: 'sideways' });
        expect(result.ok).toBe(false);
        if (!result.ok) {
            expect(result.outcome).toBe('invalid-request');
            expect(result.message).toContain('sideways');
        }
        db.close();
    });

    test('names an unknown table and an unknown sort/filter column', async () => {
        const db = await fixtureDb();
        const service = new DatabaseBrowserService(db);
        const table = await service.readRows('ghost', {});
        expect(table.ok).toBe(false);
        if (!table.ok) expect(table.outcome).toBe('unknown-table');
        const sort = await service.readRows('people', { sort: 'nope' });
        expect(sort.ok).toBe(false);
        if (!sort.ok) expect(sort.outcome).toBe('unknown-column');
        const filter = await service.readRows('people', { filterColumn: 'nope', filter: 'x' });
        expect(filter.ok).toBe(false);
        if (!filter.ok) expect(filter.outcome).toBe('unknown-column');
        db.close();
    });

    test('normalises dir case and passes sort + contains filter through', async () => {
        const db = await fixtureDb();
        const result = await new DatabaseBrowserService(db).readRows('people', {
            sort: 'name',
            dir: 'DESC',
            filterColumn: 'name',
            filter: 'b',
        });
        expect(result.ok).toBe(true);
        if (result.ok) {
            expect(result.value.total).toBe(1);
            expect(result.value.rows.map((row) => row[1])).toEqual([{ t: 'text', v: 'bob' }]);
        }
        db.close();
    });
});

describe('DatabaseBrowserService.readRow', () => {
    test('rejects a missing, malformed or negative offset', async () => {
        const db = await fixtureDb();
        const service = new DatabaseBrowserService(db);
        for (const offset of [undefined, '', 'abc', '-1', '1.5']) {
            const result = await service.readRow('people', { offset });
            expect(result.ok).toBe(false);
            if (!result.ok) expect(result.outcome).toBe('invalid-request');
        }
        db.close();
    });

    test('returns the offset row with full values', async () => {
        const db = await fixtureDb();
        const result = await new DatabaseBrowserService(db).readRow('people', {
            offset: '2',
            sort: 'name',
            dir: 'asc',
        });
        expect(result.ok).toBe(true);
        if (result.ok) {
            expect(result.value.columns).toEqual(['id', 'name']);
            expect(result.value.row).toEqual([
                { t: 'num', v: 3 },
                { t: 'text', v: 'cyd' },
            ]);
        }
        db.close();
    });
});

// ── 1186: page/offset must be representable before they reach SQL ─────────────
// `Number.isInteger(1e21)` is true, so the value passed normalisation and was bound
// as an OFFSET the driver rejected — 500 `{"error":"datatype mismatch"}` on the route
// instead of a named outcome. A page past the end is still legal paging; only the
// values that cannot be represented as an integer bound are rejected.
describe('DatabaseBrowserService page/offset representability (1186)', () => {
    test('rejects a page above the representable integer bound', async () => {
        const db = await fixtureDb();
        const service = new DatabaseBrowserService(db);
        for (const page of ['1e21', '1e300', '9007199254740992']) {
            const result = await service.readRows('people', { page });
            expect(result.ok, `page=${page} must be rejected`).toBe(false);
            if (!result.ok) expect(result.outcome).toBe('invalid-request');
        }
        db.close();
    });

    test('rejects an offset above the representable integer bound', async () => {
        const db = await fixtureDb();
        const service = new DatabaseBrowserService(db);
        for (const offset of ['1e21', '1e300', '9007199254740992']) {
            const result = await service.readRow('people', { offset });
            expect(result.ok, `offset=${offset} must be rejected`).toBe(false);
            if (!result.ok) expect(result.outcome).toBe('invalid-request');
        }
        db.close();
    });

    test('still answers a representable page past the end with an empty page, not a clamp', async () => {
        const db = await fixtureDb();
        const result = await new DatabaseBrowserService(db).readRows('people', { page: '99999' });
        expect(result.ok).toBe(true);
        if (result.ok) {
            expect(result.value.rows).toEqual([]);
            expect(result.value.total).toBe(3);
            expect(result.value.page).toBe(99999);
        }
        db.close();
    });
});
