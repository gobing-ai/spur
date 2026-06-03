import { describe, expect, test } from 'bun:test';
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { NodeFileSystem, setFileSystem } from '@gobing-ai/ts-runtime';
import { runStatusCommand } from '../../src/commands/status';
import { createCliContext } from '../../src/context';
import type { CommandOutput } from '../../src/output';

setFileSystem(new NodeFileSystem());

function nullOutput(): CommandOutput {
    return { write: () => {}, error: () => {} };
}

describe('status command', () => {
    test('reports project status', async () => {
        const ctx = createCliContext({ output: nullOutput(), dbUrl: ':memory:' });
        const exitCode = await runStatusCommand(ctx, {});
        expect(typeof exitCode).toBe('number');
    });

    test('reports agent specs found in .spur/agents/', async () => {
        const cwd = await mkdtemp(join(tmpdir(), 'spur-status-'));
        try {
            const agentsDir = join(cwd, '.spur', 'agents');
            await mkdir(agentsDir, { recursive: true });
            await writeFile(join(agentsDir, 'planner.yaml'), 'id: planner\n');
            await writeFile(join(agentsDir, '.gitkeep'), '');

            const messages: string[] = [];
            const ctx = createCliContext({
                cwd,
                output: { write: (m) => messages.push(m), error: () => {} },
                dbUrl: ':memory:',
            });
            await runStatusCommand(ctx, { json: true });
            const payload = JSON.parse(messages.at(-1) ?? '{}') as { agentSpecs: string[] };
            // .gitkeep is ignored; only the yaml spec stem is reported.
            expect(payload.agentSpecs).toEqual(['planner']);
        } finally {
            await rm(cwd, { recursive: true, force: true });
        }
    });
});
