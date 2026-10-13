import { expect, test } from 'bun:test';
import { join } from 'node:path';
import { WEB_ROOT } from '../test-helpers/board-build';

test('Astro dev serves the Board without building distribution facades', async () => {
    const proc = Bun.spawn(
        ['bun', join(WEB_ROOT, 'node_modules/.bin/astro'), 'dev', '--host', '127.0.0.1', '--port', '0'],
        {
            cwd: WEB_ROOT,
            stdout: 'pipe',
            stderr: 'pipe',
        },
    );
    let output = '';
    const drain = async (stream: ReadableStream<Uint8Array>) => {
        for await (const chunk of stream) output += new TextDecoder().decode(chunk);
    };
    const drains = Promise.all([drain(proc.stdout), drain(proc.stderr)]);
    const artifact = join(WEB_ROOT, '../../.spur/run/apps-conflict-repairs/dev-smoke');
    try {
        const deadline = Date.now() + 45_000;
        let origin: string | undefined;
        while (Date.now() < deadline) {
            origin = output.match(/http:\/\/127\.0\.0\.1:\d+/)?.[0];
            if (origin) break;
            if (proc.exitCode !== null) throw new Error(`Astro dev exited ${proc.exitCode}:\n${output}`);
            await Bun.sleep(50);
        }
        if (!origin) throw new Error(`Astro dev did not listen:\n${output}`);
        const response = await fetch(origin);
        expect(response.status).toBe(200);
        expect(await response.text()).toContain('astro-island');
        const health = await fetch(`${origin}/api/health`);
        expect(health.status).toBe(200);
        await Bun.write(
            `${artifact}.json`,
            JSON.stringify({ origin, boardStatus: response.status, healthStatus: health.status }, null, 2),
        );
    } finally {
        proc.kill();
        await proc.exited;
        await drains;
        await Bun.write(`${artifact}.log`, output);
    }
}, 60_000);
