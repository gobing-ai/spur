/** PR-L lazy CLI loading — the full DB + config runtime, reached only through `main()`'s dynamic import. */

import { describe, expect, test } from 'bun:test';
import { join } from 'node:path';
import { getEnvVars } from '@gobing-ai/spur-config';
import { createMigratedDb } from '@gobing-ai/spur-domain';
import { runFullCli } from '../src/cli-runtime';
import { createTempProject } from './helpers';

function capture() {
    const out: string[] = [];
    const err: string[] = [];
    return { out, err, output: { write: (m: string) => out.push(m), error: (m: string) => err.push(m) } };
}

describe('runFullCli', () => {
    test('dispatches a noun-scoped tree and closes its database', async () => {
        const cwd = await createTempProject();
        const real = await createMigratedDb({ url: ':memory:' });
        let closed = false;
        const db = new Proxy(real, {
            get: (target, prop, receiver) =>
                prop === 'close'
                    ? async () => {
                          closed = true;
                          return target.close();
                      }
                    : Reflect.get(target, prop, receiver),
        });
        const { out, output } = capture();
        const code = await runFullCli(['task', '--help'], { cwd, db }, output, cwd, getEnvVars());
        expect(code).toBe(0);
        expect(out.join('')).toContain('Usage: spur task');
        expect(closed).toBe(true);
    });

    test('a broken project config fails once, JSON-first under --json', async () => {
        const cwd = await createTempProject();
        await Bun.write(join(cwd, '.spur', 'config.yaml'), 'version: [unterminated\n');
        const { out, err, output } = capture();
        const code = await runFullCli(
            ['task', 'list', '--json'],
            { cwd, dbUrl: ':memory:' },
            output,
            cwd,
            getEnvVars(),
        );
        expect(code).toBe(1);
        expect(JSON.parse(out.join(''))).toMatchObject({ error: { code: 'config' } });
        expect(err).toEqual([]);
    });
});
