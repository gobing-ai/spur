import { describe, expect, test } from 'bun:test';
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { main } from '../../src/index';
import type { CommandOutput } from '../../src/output';

function nullOutput(): CommandOutput {
    return { write: () => {}, error: () => {} };
}

describe('status command', () => {
    test('reports project status', async () => {
        const exitCode = await main(['status'], { output: nullOutput(), dbUrl: ':memory:' });
        expect(typeof exitCode).toBe('number');
    });

    test('reports agent specs found in .spur/agents/', async () => {
        const cwd = await mkdtemp(join(tmpdir(), 'spur-status-'));
        try {
            // status.ok requires package.json to exist for a 0 exit code.
            await writeFile(join(cwd, 'package.json'), '{}');
            const agentsDir = join(cwd, '.spur', 'agents');
            await mkdir(agentsDir, { recursive: true });
            await writeFile(join(agentsDir, 'planner.yaml'), 'id: planner\n');
            await writeFile(join(agentsDir, '.gitkeep'), '');

            const messages: string[] = [];
            const exitCode = await main(['status', '--json'], {
                cwd,
                output: { write: (m) => messages.push(m), error: () => {} },
                dbUrl: ':memory:',
            });
            expect(exitCode).toBe(0);
            const payload = JSON.parse(messages.at(-1) ?? '{}') as { agentSpecs: string[] };
            // .gitkeep is ignored; only the yaml spec stem is reported.
            expect(payload.agentSpecs).toEqual(['planner']);
        } finally {
            await rm(cwd, { recursive: true, force: true });
        }
    });
});
