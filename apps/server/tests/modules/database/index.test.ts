import { describe, expect, test } from 'bun:test';
import { createDbAdapter, type DbAdapter } from '@gobing-ai/ts-db';
import { Hono } from 'hono';
import type { ServerContext } from '../../../src/context';
import { databaseModule } from '../../../src/modules/database';

const LONG_TEXT = 'y'.repeat(5000);

async function fixtureDb(): Promise<DbAdapter> {
    const db = await createDbAdapter({ driver: 'bun-sqlite', url: ':memory:' });
    await db.exec('CREATE TABLE people (id INTEGER PRIMARY KEY, name TEXT NOT NULL, blob_col BLOB, note TEXT)');
    await db.run(
        'INSERT INTO people (id, name, blob_col, note) VALUES (?, ?, ?, ?)',
        1,
        'ada',
        new Uint8Array([1, 2]),
        null,
    );
    await db.run('INSERT INTO people (id, name, blob_col, note) VALUES (?, ?, ?, ?)', 2, 'bob', null, LONG_TEXT);
    await db.run('INSERT INTO people (id, name, blob_col, note) VALUES (?, ?, ?, ?)', 3, 'cyd', null, 'short');
    return db;
}

function mountWithDb(db: DbAdapter): Hono {
    const app = new Hono();
    databaseModule.mount(app, { getDb: async () => db } as unknown as ServerContext);
    return app;
}

function mountWithThrowingDb(): Hono {
    const app = new Hono();
    databaseModule.mount(app, {
        getDb: async () => {
            throw new Error('D1 not configured');
        },
    } as unknown as ServerContext);
    return app;
}

describe('database module routes', () => {
    test('GET /tables lists the live tables', async () => {
        const db = await fixtureDb();
        const res = await mountWithDb(db).request('/api/project/database/tables');
        expect(res.status).toBe(200);
        expect(await res.json()).toEqual({ tables: ['people'] });
        db.close();
    });

    test('GET /tables/:name returns the schema and exact row count', async () => {
        const db = await fixtureDb();
        const res = await mountWithDb(db).request('/api/project/database/tables/people');
        expect(res.status).toBe(200);
        expect(await res.json()).toEqual({
            name: 'people',
            columns: [
                { name: 'id', type: 'INTEGER', notNull: false, pk: true },
                { name: 'name', type: 'TEXT', notNull: true, pk: false },
                { name: 'blob_col', type: 'BLOB', notNull: false, pk: false },
                { name: 'note', type: 'TEXT', notNull: false, pk: false },
            ],
            rowCount: 3,
        });
        db.close();
    });

    test('GET /tables/:name/rows pages on the server and projects cells', async () => {
        const db = await fixtureDb();
        const res = await mountWithDb(db).request('/api/project/database/tables/people/rows?page=1&pageSize=2');
        expect(res.status).toBe(200);
        const body = (await res.json()) as {
            page: number;
            pageSize: number;
            total: number;
            columns: string[];
            rows: unknown[][];
        };
        expect(body.page).toBe(1);
        expect(body.pageSize).toBe(2);
        expect(body.total).toBe(3);
        expect(body.columns).toEqual(['id', 'name', 'blob_col', 'note']);
        expect(body.rows).toHaveLength(2);
        expect(body.rows[0]).toEqual([
            { t: 'num', v: 1 },
            { t: 'text', v: 'ada' },
            { t: 'blob', bytes: 2 },
            { t: 'null' },
        ]);
        // Long text is cut on the wire with the truncation mark.
        const note = body.rows[1]?.[3] as { t: string; truncated?: boolean } | undefined;
        expect(note?.t).toBe('text');
        expect(note?.truncated).toBe(true);
        db.close();
    });

    test('GET /tables/:name/rows clamps pageSize and honours sort + filter', async () => {
        const db = await fixtureDb();
        const app = mountWithDb(db);
        const clamped = await app.request('/api/project/database/tables/people/rows?pageSize=100000');
        expect(clamped.status).toBe(200);
        expect(((await clamped.json()) as { pageSize: number }).pageSize).toBe(200);

        const filtered = await app.request(
            '/api/project/database/tables/people/rows?sort=name&dir=desc&filterColumn=name&filter=b',
        );
        expect(filtered.status).toBe(200);
        const body = (await filtered.json()) as { total: number; rows: unknown[][] };
        expect(body.total).toBe(1);
        expect(body.rows[0]?.[1]).toEqual({ t: 'text', v: 'bob' });
        db.close();
    });

    test('GET /tables/:name/row returns one untruncated row at the offset', async () => {
        const db = await fixtureDb();
        const res = await mountWithDb(db).request('/api/project/database/tables/people/row?offset=1&sort=name&dir=asc');
        expect(res.status).toBe(200);
        const body = (await res.json()) as { columns: string[]; row: unknown[] };
        expect(body.columns).toEqual(['id', 'name', 'blob_col', 'note']);
        expect(body.row[1]).toEqual({ t: 'text', v: 'bob' });
        expect(body.row[3]).toEqual({ t: 'text', v: LONG_TEXT });
        db.close();
    });
});

describe('database module error mapping', () => {
    test('unknown table and column map to 404', async () => {
        const db = await fixtureDb();
        const app = mountWithDb(db);
        const table = await app.request('/api/project/database/tables/ghost');
        expect(table.status).toBe(404);
        expect(await table.json()).toEqual({ error: 'unknown-table' });
        const column = await app.request('/api/project/database/tables/people/rows?sort=nope');
        expect(column.status).toBe(404);
        expect(await column.json()).toEqual({ error: 'unknown-column' });
        db.close();
    });

    test('a bad dir or offset maps to 400', async () => {
        const db = await fixtureDb();
        const app = mountWithDb(db);
        const dir = await app.request('/api/project/database/tables/people/rows?dir=sideways');
        expect(dir.status).toBe(400);
        expect(await dir.json()).toEqual({ error: 'invalid-request' });
        const offset = await app.request('/api/project/database/tables/people/row?offset=-1');
        expect(offset.status).toBe(400);
        expect(await offset.json()).toEqual({ error: 'invalid-request' });
        db.close();
    });

    test('a throwing getDb maps every route to 503 database-unavailable', async () => {
        const app = mountWithThrowingDb();
        const urls = [
            '/api/project/database/tables',
            '/api/project/database/tables/people',
            '/api/project/database/tables/people/rows',
            '/api/project/database/tables/people/row?offset=0',
        ];
        for (const url of urls) {
            const res = await app.request(url);
            expect(res.status).toBe(503);
            expect(await res.json()).toEqual({ error: 'database-unavailable' });
        }
    });
});
