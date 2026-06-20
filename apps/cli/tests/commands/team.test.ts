import { describe, expect, test } from 'bun:test';
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { main } from '../../src';
import { type CapturedOutput, createCapturedOutput } from '../helpers';

async function makeCtx(): Promise<{
    cwd: string;
    out: CapturedOutput;
    cleanup: () => Promise<void>;
}> {
    const cwd = await mkdtemp(join(tmpdir(), 'spur-team-cli-'));
    const out = createCapturedOutput();
    return { cwd, out, cleanup: async () => rm(cwd, { recursive: true, force: true }) };
}

describe('spur team assign', () => {
    test('sets assignee in the task frontmatter', async () => {
        const { cwd, out, cleanup } = await makeCtx();
        try {
            const tasksDir = join(cwd, 'docs', 'tasks');
            await mkdir(tasksDir, { recursive: true });
            const taskPath = join(tasksDir, '0042_demo.md');
            await writeFile(taskPath, '---\nname: "Demo"\nstatus: Todo\n---\n\nbody\n');

            const code = await main(['team', 'assign', '0042', 'planner'], { cwd, output: out, dbUrl: ':memory:' });
            expect(code).toBe(0);
            const updated = await readFile(taskPath, 'utf8');
            expect(updated).toContain('assignee: planner');
            expect(out.messages.join('\n')).toMatch(/assigned 0042 → planner/);
        } finally {
            await cleanup();
        }
    });

    test('requires both task id and agent id', async () => {
        const { cwd, out, cleanup } = await makeCtx();
        try {
            const code = await main(['team', 'assign', '0042'], { cwd, output: out, dbUrl: ':memory:' });
            expect(code).toBe(1);
            expect(out.errors.join('\n')).toMatch(/missing required argument/);
        } finally {
            await cleanup();
        }
    });

    test('surfaces a missing task file as a clean exit 1', async () => {
        const { cwd, out, cleanup } = await makeCtx();
        try {
            const code = await main(['team', 'assign', '9999', 'planner'], { cwd, output: out, dbUrl: ':memory:' });
            expect(code).toBe(1);
            expect(out.errors.join('\n')).toMatch(/No task file found/);
        } finally {
            await cleanup();
        }
    });
});

describe('spur team status', () => {
    test('lists created specs as stopped', async () => {
        const { cwd, out, cleanup } = await makeCtx();
        try {
            await main(['agent', 'create', '--type', 'claude-code', '--purpose', 'plan it', 'planner'], {
                cwd,
                output: out,
                dbUrl: ':memory:',
            });
            const code = await main(['team', 'status', '--json'], { cwd, output: out, dbUrl: ':memory:' });
            expect(code).toBe(0);
            const payload = JSON.parse(out.messages.at(-1) ?? '{}');
            expect(payload.agents).toHaveLength(1);
            expect(payload.agents[0].id).toBe('planner');
            expect(payload.agents[0].status).toBe('stopped');
        } finally {
            await cleanup();
        }
    });

    test('reports no specs on an empty project', async () => {
        const { cwd, out, cleanup } = await makeCtx();
        try {
            const code = await main(['team', 'status'], { cwd, output: out, dbUrl: ':memory:' });
            expect(code).toBe(0);
            expect(out.messages.join('\n')).toMatch(/No agent specs found/);
        } finally {
            await cleanup();
        }
    });

    test('plain-text status formats one row per spec', async () => {
        const { cwd, out, cleanup } = await makeCtx();
        try {
            await main(['agent', 'create', '--type', 'codex', '--purpose', 'write code', 'coder'], {
                cwd,
                output: out,
                dbUrl: ':memory:',
            });
            const code = await main(['team', 'status'], { cwd, output: out, dbUrl: ':memory:' });
            expect(code).toBe(0);
            const line = out.messages.at(-1) ?? '';
            // status \t id \t type \t purpose
            expect(line).toContain('stopped');
            expect(line).toContain('coder');
            expect(line).toContain('write code');
        } finally {
            await cleanup();
        }
    });
});

describe('spur team daemon stubs', () => {
    test('start prints the deferred message', async () => {
        const { cwd, out, cleanup } = await makeCtx();
        try {
            const code = await main(['team', 'start'], { cwd, output: out, dbUrl: ':memory:' });
            expect(code).toBe(0);
            expect(out.messages.join('\n')).toMatch(/Team daemon not yet available/);
        } finally {
            await cleanup();
        }
    });

    test('stop prints the deferred message', async () => {
        const { cwd, out, cleanup } = await makeCtx();
        try {
            const code = await main(['team', 'stop'], { cwd, output: out, dbUrl: ':memory:' });
            expect(code).toBe(0);
            expect(out.messages.join('\n')).toMatch(/Team daemon not yet available/);
        } finally {
            await cleanup();
        }
    });

    test('rejects an unknown subcommand', async () => {
        const { cwd, out, cleanup } = await makeCtx();
        try {
            const code = await main(['team', 'bogus'], { cwd, output: out, dbUrl: ':memory:' });
            expect(code).toBe(1);
            expect(out.errors.join('\n')).toMatch(/unknown command/);
        } finally {
            await cleanup();
        }
    });
});
