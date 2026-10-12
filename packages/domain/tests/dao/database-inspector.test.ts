import { describe, expect, test } from 'bun:test';
import { createDbAdapter, type DbAdapter } from '@gobing-ai/ts-db';
import {
    DATABASE_TEXT_CELL_MAX_BYTES,
    DatabaseInspector,
    DEFAULT_DATABASE_PAGE_SIZE,
    UnknownColumnError,
    UnknownTableError,
} from '../../src/index';

const LONG_TEXT = 'x'.repeat(5000);

/**
 * Fixture schema:
 * - `alpha` carries every cell shape the browser must survive (NULL, BLOB, REAL, NOT NULL, 5 KB text);
 * - `beta` is a plain second table (the count/list assertions do not touch it);
 * - `autoinc` uses AUTOINCREMENT so SQLite materializes `sqlite_sequence`, which the
 *   table list must exclude.
 */
async function fixtureDb(): Promise<DbAdapter> {
    const db = await createDbAdapter({ driver: 'bun-sqlite', url: ':memory:' });
    await db.exec(
        'CREATE TABLE alpha (id INTEGER PRIMARY KEY, name TEXT NOT NULL, score REAL, payload BLOB, note TEXT)',
    );
    await db.exec('CREATE TABLE beta (id INTEGER PRIMARY KEY, label TEXT)');
    await db.exec('CREATE TABLE autoinc (id INTEGER PRIMARY KEY AUTOINCREMENT, v TEXT)');
    await db.run(
        'INSERT INTO alpha (id, name, score, payload, note) VALUES (?, ?, ?, ?, ?)',
        1,
        'alice',
        1.5,
        new Uint8Array([1, 2, 3]),
        'plain',
    );
    await db.run(
        'INSERT INTO alpha (id, name, score, payload, note) VALUES (?, ?, ?, ?, ?)',
        2,
        'bob',
        null,
        null,
        null,
    );
    await db.run(
        'INSERT INTO alpha (id, name, score, payload, note) VALUES (?, ?, ?, ?, ?)',
        3,
        'a%b_c',
        3,
        null,
        'wildcard',
    );
    await db.run(
        'INSERT INTO alpha (id, name, score, payload, note) VALUES (?, ?, ?, ?, ?)',
        4,
        'zzz',
        4,
        null,
        LONG_TEXT,
    );
    await db.run('INSERT INTO beta (id, label) VALUES (?, ?)', 1, 'one');
    return db;
}

/** Wrap the adapter so any write statement a read path tried would throw and be recorded. */
function readOnlyProbe(db: DbAdapter): { adapter: DbAdapter; statements: string[] } {
    const statements: string[] = [];
    const forbidden = (method: string) => () => {
        throw new Error(`forbidden ${method} call during a browse read`);
    };
    const adapter = {
        queryAll: async <T>(sql: string, ...params: unknown[]): Promise<T[]> => {
            statements.push(sql);
            return db.queryAll<T>(sql, ...params);
        },
        queryFirst: async <T>(sql: string, ...params: unknown[]): Promise<T | undefined> => {
            statements.push(sql);
            return db.queryFirst<T>(sql, ...params);
        },
        run: forbidden('run'),
        exec: forbidden('exec'),
        batch: forbidden('batch'),
    } as unknown as DbAdapter;
    return { adapter, statements };
}

describe('DatabaseInspector.listTables', () => {
    test('lists user tables sorted, excluding SQLite internals', async () => {
        const db = await fixtureDb();
        const inspector = new DatabaseInspector(db);
        // sqlite_sequence exists because autoinc uses AUTOINCREMENT — it must not leak.
        expect(await db.queryAll("SELECT name FROM sqlite_master WHERE name = 'sqlite_sequence'")).not.toHaveLength(0);
        expect(await inspector.listTables()).toEqual(['alpha', 'autoinc', 'beta']);
        db.close();
    });
});

describe('DatabaseInspector.describe', () => {
    test('returns cid-ordered columns and the exact row count', async () => {
        const db = await fixtureDb();
        const inspector = new DatabaseInspector(db);
        const described = await inspector.describe('alpha');
        expect(described.name).toBe('alpha');
        expect(described.rowCount).toBe(4);
        expect(described.columns).toEqual([
            { name: 'id', type: 'INTEGER', notNull: false, pk: true },
            { name: 'name', type: 'TEXT', notNull: true, pk: false },
            { name: 'score', type: 'REAL', notNull: false, pk: false },
            { name: 'payload', type: 'BLOB', notNull: false, pk: false },
            { name: 'note', type: 'TEXT', notNull: false, pk: false },
        ]);
        db.close();
    });

    test('resolves a differently cased name to the schema spelling', async () => {
        const db = await fixtureDb();
        expect((await new DatabaseInspector(db).describe('ALPHA')).name).toBe('alpha');
        db.close();
    });
});

describe('DatabaseInspector.readRows pagination', () => {
    test('pages with the default size and reports the filter-aware total', async () => {
        const db = await fixtureDb();
        const inspector = new DatabaseInspector(db);
        const page = await inspector.readRows('alpha');
        expect(DEFAULT_DATABASE_PAGE_SIZE).toBe(50);
        expect(page.total).toBe(4);
        expect(page.columns).toEqual(['id', 'name', 'score', 'payload', 'note']);
        expect(page.rows.map((row) => row[0])).toEqual([
            { t: 'num', v: 1 },
            { t: 'num', v: 2 },
            { t: 'num', v: 3 },
            { t: 'num', v: 4 },
        ]);
        db.close();
    });

    test('a page beyond the end returns no rows and leaves the total intact', async () => {
        const db = await fixtureDb();
        const page = await new DatabaseInspector(db).readRows('alpha', { page: 10, pageSize: 2 });
        expect(page.total).toBe(4);
        expect(page.rows).toEqual([]);
        db.close();
    });
});

describe('DatabaseInspector.readRows sort + filter', () => {
    test('sorts by one column in either direction', async () => {
        const db = await fixtureDb();
        const inspector = new DatabaseInspector(db);
        const asc = await inspector.readRows('alpha', { sort: 'name', dir: 'asc', pageSize: 10 });
        // ASCII: '%' (0x25) sorts before letters, so `a%b_c` leads `alice`.
        expect(asc.rows.map((row) => (row[1] as { v: string }).v)).toEqual(['a%b_c', 'alice', 'bob', 'zzz']);
        const desc = await inspector.readRows('alpha', { sort: 'name', dir: 'desc', pageSize: 10 });
        expect(desc.rows.map((row) => (row[1] as { v: string }).v)).toEqual(['zzz', 'bob', 'alice', 'a%b_c']);
        db.close();
    });

    test('contains filter matches a substring and counts only matching rows', async () => {
        const db = await fixtureDb();
        const page = await new DatabaseInspector(db).readRows('alpha', {
            filterColumn: 'name',
            filterValue: 'li',
            pageSize: 10,
        });
        expect(page.total).toBe(1);
        expect(page.rows.map((row) => (row[1] as { v: string }).v)).toEqual(['alice']);
        db.close();
    });

    test('escapes LIKE wildcards so % and _ match literally', async () => {
        const db = await fixtureDb();
        const inspector = new DatabaseInspector(db);
        const percent = await inspector.readRows('alpha', { filterColumn: 'name', filterValue: '%', pageSize: 10 });
        expect(percent.total).toBe(1);
        expect(percent.rows.map((row) => (row[1] as { v: string }).v)).toEqual(['a%b_c']);
        const underscore = await inspector.readRows('alpha', { filterColumn: 'name', filterValue: '_', pageSize: 10 });
        expect(underscore.total).toBe(1);
        expect(underscore.rows.map((row) => (row[1] as { v: string }).v)).toEqual(['a%b_c']);
        db.close();
    });

    test('filters and sorts together over the same column', async () => {
        const db = await fixtureDb();
        const page = await new DatabaseInspector(db).readRows('alpha', {
            sort: 'name',
            dir: 'desc',
            filterColumn: 'name',
            filterValue: 'a',
            pageSize: 10,
        });
        expect(page.total).toBe(2);
        expect(page.rows.map((row) => (row[1] as { v: string }).v)).toEqual(['alice', 'a%b_c']);
        db.close();
    });
});

describe('DatabaseInspector cell projection', () => {
    test('projects null, blob and long text cells', async () => {
        const db = await fixtureDb();
        const page = await new DatabaseInspector(db).readRows('alpha', { pageSize: 10 });
        expect(page.rows[0]?.slice(2)).toEqual([
            { t: 'num', v: 1.5 },
            { t: 'blob', bytes: 3 },
            { t: 'text', v: 'plain' },
        ]);
        expect(page.rows[1]).toEqual([
            { t: 'num', v: 2 },
            { t: 'text', v: 'bob' },
            { t: 'null' },
            { t: 'null' },
            { t: 'null' },
        ]);
        const long = page.rows[3]?.[4];
        expect(long?.t).toBe('text');
        if (long?.t === 'text') {
            expect(long.truncated).toBe(true);
            expect(long.v.length).toBeLessThan(LONG_TEXT.length);
            expect(Buffer.byteLength(long.v, 'utf8')).toBeLessThanOrEqual(DATABASE_TEXT_CELL_MAX_BYTES);
        }
        db.close();
    });

    test('cuts a multi-byte character at the byte boundary without corrupting it', async () => {
        const db = await fixtureDb();
        // 4095 ASCII bytes + 'é' (2 bytes) = 4097 bytes: the cut must drop the whole character.
        await db.run('INSERT INTO alpha (id, name, note) VALUES (?, ?, ?)', 5, 'edge', `${'x'.repeat(4095)}é`);
        const page = await new DatabaseInspector(db).readRows('alpha', { filterColumn: 'name', filterValue: 'edge' });
        const cell = page.rows[0]?.[4];
        expect(cell?.t).toBe('text');
        if (cell?.t === 'text') {
            expect(cell.truncated).toBe(true);
            expect(cell.v).toBe('x'.repeat(4095));
            expect(cell.v.includes('\uFFFD')).toBe(false);
        }
        db.close();
    });
});

describe('DatabaseInspector.readRow', () => {
    test('returns the row at the offset with untruncated values', async () => {
        const db = await fixtureDb();
        const detail = await new DatabaseInspector(db).readRow('alpha', { offset: 3 });
        expect(detail.columns).toEqual(['id', 'name', 'score', 'payload', 'note']);
        expect(detail.row[1]).toEqual({ t: 'text', v: 'zzz' });
        expect(detail.row[4]).toEqual({ t: 'text', v: LONG_TEXT });
        db.close();
    });

    test('returns an empty row past the end', async () => {
        const db = await fixtureDb();
        const detail = await new DatabaseInspector(db).readRow('alpha', { offset: 99 });
        expect(detail.row).toEqual([]);
        expect(detail.columns).toHaveLength(5);
        db.close();
    });
});

describe('DatabaseInspector identifier safety', () => {
    test('rejects an unknown table and an unknown sort/filter column', async () => {
        const db = await fixtureDb();
        const inspector = new DatabaseInspector(db);
        await expect(inspector.describe('nope')).rejects.toBeInstanceOf(UnknownTableError);
        await expect(inspector.readRows('nope')).rejects.toBeInstanceOf(UnknownTableError);
        await expect(inspector.readRows('alpha', { sort: 'nope' })).rejects.toBeInstanceOf(UnknownColumnError);
        await expect(inspector.readRows('alpha', { filterColumn: 'nope', filterValue: 'x' })).rejects.toBeInstanceOf(
            UnknownColumnError,
        );
        db.close();
    });

    test('rejects SQL-looking identifiers without touching the schema', async () => {
        const db = await fixtureDb();
        const inspector = new DatabaseInspector(db);
        for (const name of ['alpha"; DROP TABLE beta; --', 'alpha" OR "1"="1', 'nope; DELETE FROM alpha']) {
            await expect(inspector.describe(name)).rejects.toBeInstanceOf(UnknownTableError);
            await expect(inspector.readRows(name)).rejects.toBeInstanceOf(UnknownTableError);
        }
        await expect(inspector.readRows('alpha', { sort: 'id"; DROP TABLE beta; --' })).rejects.toBeInstanceOf(
            UnknownColumnError,
        );
        // The rejected names never reached SQL: both tables are still intact.
        expect(await inspector.listTables()).toEqual(['alpha', 'autoinc', 'beta']);
        expect((await inspector.describe('beta')).rowCount).toBe(1);
        db.close();
    });

    test('issues only SELECT and PRAGMA statements', async () => {
        const db = await fixtureDb();
        const { adapter, statements } = readOnlyProbe(db);
        const inspector = new DatabaseInspector(adapter);
        await inspector.listTables();
        await inspector.describe('alpha');
        await inspector.readRows('alpha', { sort: 'name', dir: 'desc', filterColumn: 'name', filterValue: 'a' });
        await inspector.readRow('alpha', { offset: 1 });
        await expect(inspector.readRows('alpha"; DROP TABLE beta; --')).rejects.toBeInstanceOf(UnknownTableError);
        expect(statements.length).toBeGreaterThan(0);
        for (const sql of statements) {
            expect(sql.trimStart().startsWith('SELECT') || sql.trimStart().startsWith('PRAGMA')).toBe(true);
        }
        db.close();
    });
});
