/**
 * 1262 R1/AC1 — the bundled install resolves the shipped `laya-local` worker script.
 *
 * In a source checkout there is no `worker/` sibling beside the repo `config/`, so nothing is
 * passed and the upstream package default applies. In a bundle the script ships beside the
 * bundled config root and every laya client — serving and probe — must point at it.
 */
import { afterAll, describe, expect, test } from 'bun:test';
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { bundledLayaWorkerScript } from '../../src/decision/decision-service';

const roots: string[] = [];

afterAll(async () => {
    await Promise.all(roots.map(async (root) => await rm(root, { recursive: true, force: true })));
});

async function fixture(withWorker: boolean): Promise<{ configRoot: string; script: string }> {
    const root = await mkdtemp(join(tmpdir(), 'spur-laya-bundle-'));
    roots.push(root);
    const configRoot = join(root, 'config');
    await mkdir(join(configRoot, 'rules'), { recursive: true });
    const script = join(root, 'worker', 'laya_worker.py');
    if (withWorker) {
        await mkdir(join(root, 'worker'), { recursive: true });
        await writeFile(script, '# worker\n');
    }
    return { configRoot, script };
}

describe('bundledLayaWorkerScript (task 1262 R1)', () => {
    test('AC1: a bundled install resolves worker/laya_worker.py beside its config root', async () => {
        const { configRoot, script } = await fixture(true);
        expect(bundledLayaWorkerScript(configRoot, {})).toBe(script);
    });

    test('a source checkout (no worker sibling) passes nothing', async () => {
        const { configRoot } = await fixture(false);
        expect(bundledLayaWorkerScript(configRoot, {})).toBeUndefined();
    });

    test('an unresolved config root passes nothing', () => {
        expect(bundledLayaWorkerScript(null, {})).toBeUndefined();
    });

    test('LAYA_WORKER_SCRIPT wins: the operator override reaches the upstream client untouched', async () => {
        const { configRoot } = await fixture(true);
        expect(bundledLayaWorkerScript(configRoot, { LAYA_WORKER_SCRIPT: '/opt/custom_worker.py' })).toBeUndefined();
    });
});
