import { describe, expect, test } from 'bun:test';
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { NodeFileSystem, setFileSystem } from '@gobing-ai/ts-runtime';
import { runAgentCommand } from '../../src/commands/agent';
import { runTeamCommand } from '../../src/commands/team';
import { type CliContext, createCliContext } from '../../src/context';
import { createCapturedOutput } from '../helpers';

setFileSystem(new NodeFileSystem());

async function makeCtx(): Promise<{
    ctx: CliContext;
    cwd: string;
    out: ReturnType<typeof createCapturedOutput>;
    cleanup: () => Promise<void>;
}> {
    const cwd = await mkdtemp(join(tmpdir(), 'spur-team-cli-'));
    const out = createCapturedOutput();
    const ctx = createCliContext({ cwd, output: out, dbUrl: ':memory:' });
    return { ctx, cwd, out, cleanup: async () => rm(cwd, { recursive: true, force: true }) };
}

describe('spur team assign', () => {
    test('sets assignee in the task frontmatter', async () => {
        const { ctx, cwd, out, cleanup } = await makeCtx();
        try {
            const tasksDir = join(cwd, 'docs', 'tasks');
            await mkdir(tasksDir, { recursive: true });
            const taskPath = join(tasksDir, '0042_demo.md');
            await writeFile(taskPath, '---\nname: "Demo"\nstatus: Todo\n---\n\nbody\n');

            const code = await runTeamCommand('assign', ctx, {}, ['0042', 'planner']);
            expect(code).toBe(0);
            const updated = await readFile(taskPath, 'utf8');
            expect(updated).toContain('assignee: planner');
            expect(out.messages.join('\n')).toMatch(/assigned 0042 → planner/);
        } finally {
            await cleanup();
        }
    });

    test('requires both task id and agent id', async () => {
        const { ctx, out, cleanup } = await makeCtx();
        try {
            const code = await runTeamCommand('assign', ctx, {}, ['0042']);
            expect(code).toBe(2);
            expect(out.errors.join('\n')).toMatch(/requires <task-id> <agent-id>/);
        } finally {
            await cleanup();
        }
    });

    test('surfaces a missing task file as a clean exit 2', async () => {
        const { ctx, out, cleanup } = await makeCtx();
        try {
            const code = await runTeamCommand('assign', ctx, {}, ['9999', 'planner']);
            expect(code).toBe(2);
            expect(out.errors.join('\n')).toMatch(/No task file found/);
        } finally {
            await cleanup();
        }
    });
});

describe('spur team status', () => {
    test('lists created specs as stopped', async () => {
        const { ctx, out, cleanup } = await makeCtx();
        try {
            await runAgentCommand('create', ctx, { type: 'claude-code', purpose: 'plan it' }, ['planner']);
            const code = await runTeamCommand('status', ctx, { json: true }, []);
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
        const { ctx, out, cleanup } = await makeCtx();
        try {
            const code = await runTeamCommand('status', ctx, {}, []);
            expect(code).toBe(0);
            expect(out.messages.join('\n')).toMatch(/No agent specs found/);
        } finally {
            await cleanup();
        }
    });

    test('plain-text status formats one row per spec', async () => {
        const { ctx, out, cleanup } = await makeCtx();
        try {
            await runAgentCommand('create', ctx, { type: 'codex', purpose: 'write code' }, ['coder']);
            const code = await runTeamCommand('status', ctx, {}, []);
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
        const { ctx, out, cleanup } = await makeCtx();
        try {
            const code = await runTeamCommand('start', ctx, {}, []);
            expect(code).toBe(0);
            expect(out.messages.join('\n')).toMatch(/Team daemon not yet available/);
        } finally {
            await cleanup();
        }
    });

    test('stop prints the deferred message', async () => {
        const { ctx, out, cleanup } = await makeCtx();
        try {
            const code = await runTeamCommand('stop', ctx, {}, []);
            expect(code).toBe(0);
            expect(out.messages.join('\n')).toMatch(/Team daemon not yet available/);
        } finally {
            await cleanup();
        }
    });

    test('rejects an unknown subcommand', async () => {
        const { ctx, out, cleanup } = await makeCtx();
        try {
            const code = await runTeamCommand('bogus', ctx, {}, []);
            expect(code).toBe(1);
            expect(out.errors.join('\n')).toMatch(/Unknown team command/);
        } finally {
            await cleanup();
        }
    });
});
