import { afterAll, describe, expect, test } from 'bun:test';
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { getDecisionService } from '../../src/decision/decision-service';

const newRoot = async (): Promise<string> => mkdtemp(join(tmpdir(), 'spur-decision-service-'));

// One catalog file per scenario, written on demand into a private shared root.
const writeCatalog = async (dir: string, name: string, yaml: string): Promise<void> => {
    const shared = join(dir, 'shared', 'decisions');
    await mkdir(shared, { recursive: true });
    await writeFile(join(shared, name), yaml);
};

const CATALOG = `
version: 1
defaults:
    minConfidence: 0.8
    maker: typesafe
decisions:
    pick-lane:
        type: choice
        criteria:
            fast: go fast
            slow: go slow
        fallback: slow
    scoped-maker:
        type: choice
        criteria:
            a: a
            b: b
        fallback: a
        maker: fm-local
`;

const roots: string[] = [];

afterAll(async () => {
    await Promise.all(roots.map((r) => rm(r, { recursive: true, force: true })));
});

describe('DecisionService (task 1092, design §3.3/§3.6)', () => {
    test('list layers, describe maker precedence and lazy registry', async () => {
        const root = await newRoot();
        roots.push(root);
        await writeCatalog(root, 'base.yaml', CATALOG);
        const service = await getDecisionService(null as never, root, join(root, 'shared'));
        expect(service.list().map((d) => `${d.id}@${d.layer}`)).toEqual(['pick-lane@shared', 'scoped-maker@shared']);
        // no config: catalog decision entry beats catalog defaults
        expect(service.describe('scoped-maker').effectiveMaker).toEqual({
            name: 'fm-local',
            source: 'catalog-decision',
        });
        expect(service.describe('pick-lane').effectiveMaker).toEqual({ name: 'typesafe', source: 'catalog-default' });
        // status: nothing configured is broken; registry stays lazy but reports registered names
        const status = service.status();
        expect(status.ok).toBe(true);
        expect(status.layers).toEqual({ project: 0, registered: 0, shared: 1 });
        expect(status.registeredMakers).toContain('typesafe');
        expect(status.perDecision.map((r) => `${r.id}:${r.maker}:${r.source}:${r.registered}`)).toEqual([
            'pick-lane:typesafe:catalog-default:true',
            'scoped-maker:fm-local:catalog-decision:true',
        ]);
    });

    test('dup ids decide fail-closed; config outranks catalog; unregistered config maker errors', async () => {
        // Own root: the service cache is keyed by cwd, so tests must not share one.
        const root = await newRoot();
        roots.push(root);
        await writeCatalog(root, 'base.yaml', CATALOG);
        // Same ids in a later shared file: BOTH ids become duplicates (same basename layer order).
        await writeCatalog(root, 'dup.yaml', CATALOG);
        const service = await getDecisionService(
            {
                decisions: { makers: { 'scoped-maker': 'nope-missing' } },
            } as never,
            root,
            join(root, 'shared'),
        );
        // config makers.<id> outranks any catalog source…
        expect(service.describe('scoped-maker').effectiveMaker).toEqual({
            name: 'nope-missing',
            source: 'config-decision',
        });
        // …but decide fails closed on the duplicate id before any maker work.
        await expect(service.decide('scoped-maker', { x: 1 })).rejects.toThrow('multiple winning catalogs');
        const status = service.status();
        expect(status.ok).toBe(false);
        expect(status.errors.join(' ')).toContain('nope-missing');
        await expect(service.decide('scoped-maker', { x: 1 }, { maker: 'nope-missing' })).rejects.toThrow();
    });
});
