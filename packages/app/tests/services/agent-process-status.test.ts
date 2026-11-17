import { expect, test } from 'bun:test';
import { existsSync } from 'node:fs';
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { getEnvVars } from '@gobing-ai/spur-config';

// Failure cases: wrong wire identity, exited processes counted as running, malformed rows,
// lost partial results, or a readiness read creating the project database.
test('real CLI reads supervisor process identities through the shared reader', async () => {
    const root = await mkdtemp(join(tmpdir(), 'spur-process-status-e2e-'));
    const server = Bun.serve({
        hostname: '127.0.0.1',
        port: 0,
        fetch: () =>
            Response.json({
                processes: [
                    { agentId: 'planner', status: 'running', pid: 42 },
                    { agentId: 'finished', status: 'exited', pid: null },
                    { agentId: 'failed', status: 'errored', pid: 43 },
                    { agentId: 'other', status: 'new-status', pid: null },
                    { agentId: 7, status: 'running' },
                    null,
                ],
            }),
    });
    try {
        await mkdir(join(root, '.spur', 'agents'), { recursive: true });
        await writeFile(join(root, '.spur', 'config.yaml'), 'project: fixture\n');
        await writeFile(join(root, '.spur', 'agents', 'planner.yaml'), 'id: planner\n');
        const registry = join(root, 'projects.json');
        await writeFile(
            registry,
            JSON.stringify({
                schema_version: 1,
                projects: [{ name: 'fixture', path: root, host: '127.0.0.1', port: server.port }],
            }),
        );
        const child = Bun.spawn(
            [
                Bun.which('bun') ?? 'bun',
                resolve(import.meta.dir, '../../../../apps/cli/src/index.ts'),
                'self',
                'status',
                '--json',
            ],
            {
                cwd: root,
                env: {
                    ...getEnvVars(),
                    HOME: root,
                    SPUR_SKIP_PROJECT_CONFIG: '0',
                    SPUR_GLOBAL_RULES_DIR: join(root, 'global'),
                    SPUR_PROJECTS_FILE: registry,
                },
                stdout: 'pipe',
                stderr: 'pipe',
            },
        );
        const [stdout, stderr, code] = await Promise.all([
            new Response(child.stdout).text(),
            new Response(child.stderr).text(),
            child.exited,
        ]);
        expect(code, stderr).toBe(0);
        expect(JSON.parse(stdout).sections.agents.data).toMatchObject({ live: true, running: ['planner'] });
        expect(existsSync(join(root, '.spur', 'spur.db'))).toBe(false);
    } finally {
        server.stop(true);
        await rm(root, { recursive: true, force: true });
    }
});
