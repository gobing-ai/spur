import { describe, expect, test } from 'bun:test';
import { createDbAdapter, type DbAdapter } from '@gobing-ai/ts-db';
import { applyCliMigrations, ProjectStrategyDao } from '../../src/index';

const P = '/tmp/proj-strategy';

async function makeDao(): Promise<{ dao: ProjectStrategyDao; adapter: DbAdapter }> {
    const adapter = await createDbAdapter({ driver: 'bun-sqlite', url: ':memory:' });
    await applyCliMigrations(adapter);
    return { dao: new ProjectStrategyDao(adapter), adapter };
}

describe('ProjectStrategyDao (0838 R1)', () => {
    test('get on a project with no row → null (the rest default lives in the runtime, not the table)', async () => {
        const { dao, adapter } = await makeDao();
        expect(await dao.get(P)).toBeNull();
        adapter.close();
    });

    test('first set persists version 1 with row fields intact', async () => {
        const { dao, adapter } = await makeDao();
        const row = await dao.set(P, 'gtd');
        expect(row).toMatchObject({ projectPath: P, strategy: 'gtd', strategyVersion: 1 });
        expect(typeof row.updatedAt).toBe('number');
        expect(await dao.get(P)).toEqual(row);
        adapter.close();
    });

    test('EVERY set bumps the version — a same-name re-set included (monotonic 0837 fence)', async () => {
        const { dao, adapter } = await makeDao();
        expect((await dao.set(P, 'rest')).strategyVersion).toBe(1);
        expect((await dao.set(P, 'rest')).strategyVersion).toBe(2); // same name, still bumps
        expect((await dao.set(P, 'gtd')).strategyVersion).toBe(3);
        expect((await dao.set(P, 'rest')).strategyVersion).toBe(4); // rest→gtd→rest cycle fences stale decisions
        const current = await dao.get(P);
        expect(current?.strategy).toBe('rest');
        expect(current?.strategyVersion).toBe(4);
        adapter.close();
    });

    test('rows are keyed per project — one project’s bumps never alias another’s', async () => {
        const { dao, adapter } = await makeDao();
        expect((await dao.set(P, 'gtd')).strategyVersion).toBe(1);
        expect((await dao.set('/tmp/proj-other', 'rest')).strategyVersion).toBe(1);
        expect((await dao.set(P, 'gtd')).strategyVersion).toBe(2);
        expect((await dao.get('/tmp/proj-other'))?.strategyVersion).toBe(1);
        adapter.close();
    });
});
