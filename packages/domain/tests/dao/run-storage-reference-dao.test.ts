import { describe, expect, test } from 'bun:test';
import { createDbAdapter } from '@gobing-ai/ts-db';
import { applyCliMigrations, redirectRunStorageReferences } from '../../src';

describe('run-storage reference ownership', () => {
    const source = '/repo/.spur/run/r/agent-sessions/omp';
    const target = '/repo/.spur/memory/runs/r/agent-sessions/omp';
    const moves = [{ source, target }];

    test('closed references redirect atomically while identities and unrelated values remain stable', async () => {
        const db = await createDbAdapter({ driver: 'bun-sqlite', url: ':memory:' });
        try {
            await applyCliMigrations(db);
            await db.run(
                "INSERT INTO runs (id,status,started_at,metadata_json) VALUES ('r','done','now',?)",
                JSON.stringify({ dirs: [source, '/unrelated'], digest: 'sha256:unchanged', value: null }),
            );
            await db.run("INSERT INTO artifacts (id,path,kind,run_id) VALUES ('a',?,'test','r')", source);
            await db.run(
                "INSERT INTO workflow_states (id,run_id,state,data_json) VALUES ('s','r','done',?)",
                JSON.stringify({ vars: { '__session.coder.dir': source } }),
            );
            await db.run(
                "INSERT INTO action_runs (id,run_id,node,kind,status,result_json) VALUES ('a','r','n','test','done',?)",
                JSON.stringify({ path: source }),
            );
            await redirectRunStorageReferences(db, moves);
            await redirectRunStorageReferences(db, moves);
            expect((await db.queryFirst<{ path: string }>("SELECT path FROM artifacts WHERE id='a'"))?.path).toBe(
                target,
            );
            const row = await db.queryFirst<{ metadata_json: string }>("SELECT metadata_json FROM runs WHERE id='r'");
            expect(JSON.parse(row?.metadata_json ?? '{}')).toEqual({
                dirs: [target, '/unrelated'],
                digest: 'sha256:unchanged',
                value: null,
            });
            expect(
                (await db.queryFirst<{ data_json: string }>("SELECT data_json FROM workflow_states WHERE id='s'"))
                    ?.data_json,
            ).toContain(target);
            expect(
                (await db.queryFirst<{ result_json: string }>("SELECT result_json FROM action_runs WHERE id='a'"))
                    ?.result_json,
            ).toContain(target);
            await db.run("UPDATE runs SET metadata_json=? WHERE id='r'", `{"dir":"${source}", broken`);
            await db.run("UPDATE artifacts SET path=? WHERE id='a'", source);
            await expect(redirectRunStorageReferences(db, moves)).rejects.toThrow();
            expect((await db.queryFirst<{ path: string }>("SELECT path FROM artifacts WHERE id='a'"))?.path).toBe(
                source,
            );
        } finally {
            db.close();
        }
    });

    test('live artifact, session and checkpoint consumers block migration without partial reference writes', async () => {
        const db = await createDbAdapter({ driver: 'bun-sqlite', url: ':memory:' });
        try {
            await applyCliMigrations(db);
            await db.run("INSERT INTO runs (id,status,started_at) VALUES ('live','paused','now')");
            await db.run("INSERT INTO artifacts (id,path,kind,run_id) VALUES ('a',?,'test','live')", source);
            await expect(redirectRunStorageReferences(db, moves)).rejects.toThrow('live artifact');
            await db.run('DELETE FROM artifacts');
            await db.run("UPDATE runs SET metadata_json=? WHERE id='live'", JSON.stringify({ dir: source }));
            await expect(redirectRunStorageReferences(db, moves)).rejects.toThrow('live session');
            await db.run("UPDATE runs SET metadata_json='{}' WHERE id='live'");
            await db.run(
                "INSERT INTO workflow_states (id,run_id,state,data_json) VALUES ('s','live','paused',?)",
                JSON.stringify({ dir: source }),
            );
            await expect(redirectRunStorageReferences(db, moves)).rejects.toThrow('live session');
            expect(
                (await db.queryFirst<{ data_json: string }>("SELECT data_json FROM workflow_states WHERE id='s'"))
                    ?.data_json,
            ).toContain(source);
        } finally {
            db.close();
        }
    });
});
