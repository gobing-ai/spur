import { afterEach, describe, expect, test } from 'bun:test';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { z } from 'zod';
import type { CommandOutput } from '../src/output';
import {
    carrierTypeNames,
    defaultLiteralProbe,
    findLiteralProbe,
    parseVersionCarriers,
    type RegisteredCarrier,
    registerCarrierType,
} from '../src/version-carriers';

const quiet: CommandOutput = { write: () => {}, error: () => {} };
const dirs: string[] = [];

function tmpRepo(): string {
    const dir = mkdtempSync(join(tmpdir(), 'vc-'));
    dirs.push(dir);
    return dir;
}

afterEach(() => {
    for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true });
});

describe('version-carrier registry', () => {
    test('built-in types are registered', () => {
        expect(carrierTypeNames()).toEqual(['plugin-manifest', 'ts-literal']);
    });

    test('parseVersionCarriers validates known instances and rejects unknown types by name', () => {
        const carriers = parseVersionCarriers([
            { type: 'plugin-manifest', paths: ['a.json'] },
            { type: 'ts-literal', file: 'src/v.ts', identifier: 'V' },
        ]);
        expect(carriers.map((c) => c.type)).toEqual(['plugin-manifest', 'ts-literal']);

        expect(() => parseVersionCarriers([{ type: 'version-file', paths: ['VERSION'] }])).toThrow(
            'unknown version carrier type "version-file" (registered: plugin-manifest, ts-literal)',
        );
        expect(() => parseVersionCarriers([{ paths: ['x'] }])).toThrow('missing its "type" field');
        expect(() => parseVersionCarriers('nope')).toThrow('must be a list');
    });

    test('ts-literal default fills file/identifier and probe falls back to defaults without carriers', () => {
        const [withDefaults = null as never] = parseVersionCarriers([{ type: 'ts-literal' }]);
        expect(withDefaults.value).toEqual({ type: 'ts-literal', file: 'src/config.ts', identifier: 'binaryVersion' });

        expect(findLiteralProbe([], 'pkgs/lib')).toBeUndefined();
        expect(
            findLiteralProbe(parseVersionCarriers([{ type: 'plugin-manifest', paths: ['m.json'] }]), 'pkgs/lib'),
        ).toBeUndefined();
        const probed = findLiteralProbe([withDefaults as RegisteredCarrier], 'pkgs/lib');
        expect(probed).toEqual({ file: 'src/config.ts', identifier: 'binaryVersion' });
        expect(defaultLiteralProbe.identifier).toBe('binaryVersion');
    });

    test('plugin-manifest syncRepoWide rewrites, stages, and survives extra fields', async () => {
        const repo = tmpRepo();
        await Bun.write(
            join(repo, 'mirror.json'),
            `${JSON.stringify({ name: 'cc', version: '0.1.0', note: 'x' }, null, 4)}\n`,
        );
        const [carrier = null as never] = parseVersionCarriers([{ type: 'plugin-manifest', paths: ['mirror.json'] }]);
        const staged: string[] = [];
        await carrier.def.syncRepoWide?.(carrier.value, { repoRoot: repo }, '0.2.0', staged, quiet);
        expect(staged).toEqual(['mirror.json']);
        expect(await Bun.file(join(repo, 'mirror.json')).json()).toEqual({ name: 'cc', version: '0.2.0', note: 'x' });
    });

    test('plugin-manifest syncRepoWide warns and skips missing or malformed paths', async () => {
        const repo = tmpRepo();
        await Bun.write(join(repo, 'bad.json'), '{not json');
        const lines: string[] = [];
        const output: CommandOutput = { write: (m) => lines.push(m), error: quiet.error };
        const [carrier = null as never] = parseVersionCarriers([
            { type: 'plugin-manifest', paths: ['absent.json', 'bad.json'] },
        ]);
        const staged: string[] = [];
        await carrier.def.syncRepoWide?.(carrier.value, { repoRoot: repo }, '0.2.0', staged, output);
        expect(staged).toEqual([]);
        expect(lines.some((l) => l.includes('absent.json'))).toBe(true);
        expect(lines.some((l) => l.includes('bad.json'))).toBe(true);
    });

    test('registerCarrierType accepts new hook-only types', async () => {
        registerCarrierType('test-probe-only', {
            schema: z.object({ type: z.literal('test-probe-only') }),
            probePackageLiteral: () => ({ file: 'VERSION', identifier: 'V' }),
        });
        const [carrier = null as never] = parseVersionCarriers([{ type: 'test-probe-only' }]);
        expect(findLiteralProbe([carrier], 'pkgs/lib')).toEqual({ file: 'VERSION', identifier: 'V' });
    });
});
