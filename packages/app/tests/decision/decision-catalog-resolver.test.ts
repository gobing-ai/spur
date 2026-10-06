import { afterAll, beforeAll, describe, expect, test } from 'bun:test';
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { SpurConfig } from '@gobing-ai/spur-config';
import { decisionLayers, resolveDecisionCatalogs } from '../../src/decision/decision-catalog-resolver';
import { DecisionService, getDecisionService } from '../../src/decision/decision-service';

/** Minimal valid catalog body (upstream format version 1). */
const catalog = (ids: string[], fallbackValue?: string): string => {
    const decisions = Object.fromEntries(
        ids.map((id) => [
            id,
            {
                type: 'choice',
                description: `${id} fixture`,
                criteria: { a: 'first', b: 'second' },
                fallback: fallbackValue ?? 'a',
            },
        ]),
    );
    return `version: 1\ndecisions:\n${Object.entries(decisions)
        .map(
            ([id, body]) =>
                `    ${id}:\n${Object.entries(body)
                    .map(([k, v]) => `        ${k}: ${JSON.stringify(v)}`)
                    .join('\n')}`,
        )
        .join('\n')}\n`;
};

describe('decision catalog resolver (E2E, task 1092)', () => {
    let root: string;

    beforeAll(async () => {
        root = await mkdtemp(join(tmpdir(), 'spur-decision-resolver-'));
        await mkdir(join(root, 'project/.spur/decisions'), { recursive: true });
        await mkdir(join(root, 'registered/decisions'), { recursive: true });
        await mkdir(join(root, 'shared/decisions'), { recursive: true });
        // Same basename in all three layers: project must win.
        await writeFile(join(root, 'project/.spur/decisions/a.yaml'), catalog(['proj-only', 'shared-id']));
        await writeFile(join(root, 'registered/decisions/a.yaml'), catalog(['registered-only', 'shared-id']));
        await writeFile(join(root, 'shared/decisions/a.yaml'), catalog(['shared-id']));
        await writeFile(join(root, 'shared/decisions/dup.yaml'), catalog(['shared-id']));
        // Registered layer also sees a bundled: entry expanding against the shared root.
        await writeFile(join(root, 'shared/decisions/bundled.yaml'), catalog(['bundled-only']));
        await writeFile(join(root, 'shared/decisions/broken.yaml'), 'version: 1\ndecisions: {broken: {type: nope}}\n');
    });

    afterAll(async () => {
        await rm(root, { recursive: true, force: true });
    });

    test('layers follow project → registered → shared with bundled: expansion', () => {
        const layers = decisionLayers({
            cwd: join(root, 'project'),
            registered: [join(root, 'registered/decisions'), 'bundled:decisions'],
            sharedRoot: join(root, 'shared'),
        });
        expect(layers.map((l) => l.id)).toEqual(['project', 'registered', 'registered', 'shared']);
        expect(layers[3]?.path).toBe(join(root, 'shared/decisions'));
    });

    test('first layer wins per basename; duplicates and load failures are reported, not thrown', async () => {
        const resolution = await resolveDecisionCatalogs({
            cwd: join(root, 'project'),
            registered: [join(root, 'registered/decisions')],
            sharedRoot: join(root, 'shared'),
        });
        // Winner for a.yaml is the project copy: proj-only survives, registered-only is shadowed.
        const winner = resolution.files.find((f) => f.basename === 'a.yaml');
        expect(winner).toBeDefined();
        expect(winner?.layer).toBe('project');
        const ids = resolution.files.flatMap((f) => Object.keys(f.catalog.decisions));
        expect(ids).toContain('proj-only');
        expect(ids).toContain('bundled-only');
        expect(ids).not.toContain('registered-only');
        // shared-id is declared by two DIFFERENT winning files (a.yaml project + dup.yaml shared).
        expect(resolution.duplicateIds.map((d) => d.id)).toEqual(['shared-id']);
        // broken.yaml is reported; the other shared catalogs still serve.
        expect(resolution.loadErrors).toHaveLength(1);
        expect(resolution.loadErrors[0]?.path).toContain('broken.yaml');
    });

    test('service: precedence flag → makers.<id> → maker → catalog, dup id decide fails, unregistered config maker errors', async () => {
        const config = {
            decisions: { maker: 'nope-missing', makers: { 'proj-only': 'nope-missing' } },
        } as unknown as SpurConfig;
        const service = await DecisionService.create(config, join(root, 'project'), join(root, 'shared'));
        // Shared layer works with no config at all (same resolution, empty config).
        const bare = await DecisionService.create(null, join(root, 'project'), join(root, 'shared'));
        expect(bare.list().length).toBeGreaterThan(0);

        // Unregistered configured makers are reported, never silently fallen back.
        const status = service.status();
        expect(status.ok).toBe(false);
        expect(status.errors.join(' ')).toContain('nope-missing');

        // decide on a duplicate id fails closed before any backend call.
        expect(service.decide('shared-id', {})).rejects.toThrow();

        // Registered maker resolution still works: describe reports the selecting source.
        const config2 = { decisions: { maker: 'typesafe', makers: {} } } as unknown as SpurConfig;
        const service2 = await DecisionService.create(config2, join(root, 'project'), join(root, 'shared'));
        const described = service2.describe('proj-only');
        expect(described.effectiveMaker.name).toBe('typesafe');
        expect(described.effectiveMaker.source).toBe('config-default');
        const flagResult = await service2.decide('proj-only', {}, { maker: 'typesafe' });
        expect(flagResult.makerSource).toBe('flag');
    });

    test('getDecisionService caches per cwd per process', async () => {
        const a = await getDecisionService(null, join(root, 'project'), join(root, 'shared'));
        const b = await getDecisionService(null, join(root, 'project'), join(root, 'shared'));
        expect(a).toBe(b);
    });
});
