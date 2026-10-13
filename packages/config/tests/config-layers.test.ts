import { afterEach, describe, expect, test } from 'bun:test';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
    GLOBAL_CONFIG_FILE,
    invalidateSpurConfig,
    resolveConfigLayers,
    SPUR_CONFIG_DIR,
    SPUR_CONFIG_FILE,
    spurConfigCache,
} from '../src/config-layers';
import * as loader from '../src/loader';

describe('config-layers', () => {
    const dirs: string[] = [];
    afterEach(() => {
        spurConfigCache.clear();
        for (const d of dirs.splice(0)) rmSync(d, { recursive: true, force: true });
    });

    test('constants describe the layout', () => {
        expect(SPUR_CONFIG_DIR).toBe('.spur');
        expect(SPUR_CONFIG_FILE).toBe('config.yaml');
        expect(GLOBAL_CONFIG_FILE.endsWith(join('.config', 'spur', 'config.yaml'))).toBe(true);
    });

    test('resolveConfigLayers finds the project layer for an explicit cwd', () => {
        const d = mkdtempSync(join(tmpdir(), 'spur-layers-'));
        dirs.push(d);
        expect(resolveConfigLayers(d).project).toBeUndefined();
        mkdirSync(join(d, '.spur'));
        writeFileSync(join(d, '.spur', 'config.yaml'), 'version: 1\n');
        expect(resolveConfigLayers(d).project).toBe(join(d, '.spur', 'config.yaml'));
    });

    test('invalidateSpurConfig clears by path or entirely', () => {
        const p = Promise.resolve({}) as never;
        spurConfigCache.set('/a\0schema', p);
        spurConfigCache.set('/b\0/a\0zod', p);
        spurConfigCache.set('/c\0zod', p);
        invalidateSpurConfig('/a');
        expect([...spurConfigCache.keys()]).toEqual(['/c\0zod']);
        invalidateSpurConfig();
        expect(spurConfigCache.size).toBe(0);
    });

    test('loader re-exports the same functions', () => {
        expect(loader.resolveConfigLayers).toBe(resolveConfigLayers);
        expect(loader.invalidateSpurConfig).toBe(invalidateSpurConfig);
    });
});
