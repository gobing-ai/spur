/**
 * B9 task 1372 — the embedded `mcpModule` on `spur self serve`.
 *
 * The failure modes come first (task Plan step 1): a mounted endpoint when the module is off
 * (AC1), a request that sneaks past bearer auth, a delegation that reaches for a service the
 * dispatcher does not own, a continue with no paused run, and a `spur://context/` read that
 * escapes the indexed-context directory.
 */
import { afterAll, describe, expect, test } from 'bun:test';
import { mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { MCP_BUILTIN_TOOL_NAMES } from '@gobing-ai/spur-app';
import { createNodeFileSystem } from '@gobing-ai/ts-runtime';
import { Hono } from 'hono';
import type { ServerContext } from '../../src/context';
import { createMcpHandler, mcpModule } from '../../src/modules/mcp';
import { MIN_MCP_PROTOCOL_VERSION } from '../../src/modules/mcp/protocol';

const TOKEN = 'mcp-test-token-1234';
const VERSION = MIN_MCP_PROTOCOL_VERSION;

interface Recorded {
    calls: string[];
    taskService(): unknown;
    featureService(): unknown;
    workflowService(): unknown;
}

/** Stub services that record delegation so each test asserts its own seam only. */
function makeRecorder(pausedRun: { runId: string } | null = { runId: 'r-paused' }): Recorded {
    const calls: string[] = [];
    return {
        calls,
        taskService: () => ({
            show: async (wbs: string) => {
                calls.push(`task.show:${wbs}`);
                return { wbs, name: 'the task', status: 'todo', content: `# task ${wbs}` };
            },
            list: async (filters?: Record<string, string>) => {
                calls.push(`task.list:${JSON.stringify(filters ?? {})}`);
                return [{ wbs: '1372', status: 'todo' }];
            },
        }),
        featureService: () => ({
            show: async (id: string) => {
                calls.push(`feature.show:${id}`);
                return id === 'B9' ? { id, content: `# feature ${id}` } : null;
            },
        }),
        workflowService: () => ({
            trace: async (runId?: string) => {
                calls.push(`workflow.trace:${runId ?? '(all)'}`);
                return runId === undefined ? { entries: [], total: 0 } : { run: { runId }, events: [] };
            },
            run: async (file: string, opts?: Record<string, unknown>) => {
                calls.push(`workflow.run:${file}:${JSON.stringify(opts ?? {})}`);
                return { runId: 'r-new', file };
            },
            latestPausedRun: async () => {
                calls.push('workflow.latestPausedRun');
                return pausedRun === null
                    ? null
                    : { runId: pausedRun.runId, workflowName: 'task-pipeline.yaml', startedAt: '2026-11-17T00:00:00Z' };
            },
            continuePaused: async (runId: string, opts?: Record<string, unknown>) => {
                calls.push(`workflow.continuePaused:${runId}:${JSON.stringify(opts ?? {})}`);
                return { runId };
            },
        }),
    };
}

/** A minimal ServerContext slice: cwd/fs/env, the boot config switch, and the stub services. */
function makeHarness(
    bootMcp: { enabled: boolean; authEnv: string | null } | undefined,
    env: Record<string, string | undefined> = { SPUR_MCP_TOKEN: TOKEN },
    pausedRun: { runId: string } | null = { runId: 'r-paused' },
): { app: Hono; recorder: Recorded } {
    const recorder = makeRecorder(pausedRun);
    const ctx = {
        cwd: tempDir,
        fs: createNodeFileSystem(),
        env,
        logger: { debug: () => {}, info: () => {}, warn: () => {}, error: () => {} },
        ...(bootMcp === undefined ? {} : { bootConfig: () => ({ mcp: bootMcp }) }),
        taskService: recorder.taskService,
        featureService: recorder.featureService,
        workflowService: recorder.workflowService,
    } as unknown as ServerContext;
    const app = new Hono();
    mcpModule.mount(app, ctx);
    return { app, recorder };
}

async function post(
    app: Hono,
    init: { headers?: Record<string, string>; body?: unknown; token?: string } = {},
): Promise<Response> {
    const headers: Record<string, string> = {
        'Mcp-Protocol-Version': VERSION,
        'Content-Type': 'application/json',
        ...(init.headers ?? {}),
    };
    if (init.token !== undefined) headers.Authorization = `Bearer ${init.token}`;
    return (await app.request('http://localhost/mcp', {
        method: 'POST',
        headers,
        body: JSON.stringify(init.body ?? { jsonrpc: '2.0', id: 1, method: 'server/discover' }),
    })) as Response;
}

async function jsonOf(res: Response): Promise<unknown> {
    return (await res.json()) as unknown;
}

function envelopeResult(res: Response): Promise<unknown> {
    return jsonOf(res).then((body) => (body as { result: unknown }).result);
}

let tempDir: string;

function setupTempDir(): void {
    tempDir = join(tmpdir(), `spur-mcp-module-${Date.now()}-${Math.random().toString(36).slice(2)}`);
    mkdirSync(join(tempDir, '.spur', 'context'), { recursive: true });
    writeFileSync(join(tempDir, '.spur', 'context', 'learnings.md'), '# learnings\n');
}

setupTempDir();

afterAll(() => {
    rmSync(tempDir, { recursive: true, force: true });
});

describe('AC1 — default-off mounting', () => {
    test('no mcp key in the boot config mounts nothing (404, not 401)', async () => {
        const { app } = makeHarness(undefined);
        const res = await post(app, { token: TOKEN });
        expect(res.status).toBe(404);
    });

    test('enabled: false mounts nothing', async () => {
        const { app } = makeHarness({ enabled: false, authEnv: null });
        const res = await post(app, { token: TOKEN });
        expect(res.status).toBe(404);
    });

    test('enabled: true mounts POST /mcp', async () => {
        const { app } = makeHarness({ enabled: true, authEnv: 'SPUR_MCP_TOKEN' });
        const res = await post(app, { token: TOKEN });
        expect(res.status).toBe(200);
    });
});

describe('AC1 — bearer auth', () => {
    const enabled = { enabled: true, authEnv: 'SPUR_MCP_TOKEN' };

    test('a missing Authorization header is 401 with the spur-mcp challenge', async () => {
        const { app } = makeHarness(enabled);
        const res = await post(app);
        expect(res.status).toBe(401);
        expect(res.headers.get('WWW-Authenticate')).toBe('Bearer realm="spur-mcp"');
    });

    test('a wrong token is 401', async () => {
        const { app } = makeHarness(enabled);
        const res = await post(app, { token: 'not-the-token' });
        expect(res.status).toBe(401);
    });

    test('a non-bearer Authorization scheme is 401', async () => {
        const { app } = makeHarness(enabled);
        const res = await app.request('http://localhost/mcp', {
            method: 'POST',
            headers: { Authorization: 'Basic dXNlcjpwYXNz', 'Mcp-Protocol-Version': VERSION },
            body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'server/discover' }),
        });
        expect(res.status).toBe(401);
    });

    test('enabled with an unset token variable refuses every request instead of serving open', async () => {
        const { app } = makeHarness({ enabled: true, authEnv: 'SPUR_MCP_TOKEN' }, {});
        const res = await post(app, { token: TOKEN });
        expect(res.status).toBe(500);
        expect(res.headers.get('WWW-Authenticate')).toBeNull();
    });
});

describe('namespace resolution degradation (task 1392 coverage)', () => {
    test('an unreadable plugins dir leaves the namespace unset instead of failing the mount', async () => {
        // The handler resolves the namespace in the background; a project whose fs cannot answer
        // (a permissions error, a torn mount) must degrade to "no namespace", never a crash.
        const ctx = {
            cwd: tempDir,
            fs: {
                ...createNodeFileSystem(),
                // Only the namespace lookup fails: the mount must degrade, not crash.
                stat: async (path: string) => {
                    if (path.includes('plugins')) throw new Error('fs down');
                    return createNodeFileSystem().stat(path);
                },
            },
            env: { SPUR_MCP_TOKEN: TOKEN },
            logger: { debug: () => {}, info: () => {}, warn: () => {}, error: () => {} },
            bootConfig: () => ({ mcp: { enabled: true, authEnv: 'SPUR_MCP_TOKEN' } }),
            taskService: makeRecorder().taskService,
            featureService: makeRecorder().featureService,
            workflowService: makeRecorder().workflowService,
        } as unknown as ServerContext;
        const app = new Hono();
        mcpModule.mount(app, ctx);
        await Bun.sleep(20);
        const res = await post(app, { token: TOKEN, body: { jsonrpc: '2.0', id: 1, method: 'server/discover' } });
        expect(res.status).toBe(200);
        const body = (await res.json()) as { result: { namespace?: string } };
        expect(body.result.namespace).toBeUndefined();
    });
});

describe('AC2 — tools delegate to @gobing-ai/spur-app', () => {
    const harness = () => makeHarness({ enabled: true, authEnv: 'SPUR_MCP_TOKEN' });

    test('server/discover advertises the ten harness tools and the three spur:// resources', async () => {
        const { app } = harness();
        const result = (await envelopeResult(await post(app, { token: TOKEN }))) as {
            capabilities: { tools: { name: string }[]; resources: { uri: string }[] };
        };
        // Order is the descriptor order, which is not the contract; the SET is.
        expect([...result.capabilities.tools.map((tool) => tool.name)].sort()).toEqual(
            [
                'sp_task_show',
                'sp_task_list',
                'sp_workflow_status',
                'sp_workflow_run',
                'sp_workflow_continue',
                // 1392: the guarded corpus write tools.
                'sp_task_create',
                'sp_task_update',
                'sp_task_transition',
                'sp_feature_check',
                'sp_rule_run',
            ].sort(),
        );
        expect(result.capabilities.resources.map((res) => res.uri)).toEqual([
            'spur://tasks/{wbs}',
            'spur://features/{id}',
            'spur://context/{name}',
        ]);
    });

    test('sp_task_show passes the wbs through to TaskService.show', async () => {
        const { app, recorder } = harness();
        const result = (await envelopeResult(
            await post(app, {
                token: TOKEN,
                body: {
                    jsonrpc: '2.0',
                    id: 1,
                    method: 'tools/call',
                    params: { name: 'sp_task_show', arguments: { wbs: ' 1372 ' } },
                },
            }),
        )) as { wbs: string; content: string };
        expect(recorder.calls).toEqual(['task.show:1372']);
        expect(result.wbs).toBe('1372');
        expect(result.content).toBe('# task 1372');
    });

    test('sp_task_show without a wbs is an error, not a silent undefined', async () => {
        const { app } = harness();
        const res = await post(app, {
            token: TOKEN,
            body: { jsonrpc: '2.0', id: 1, method: 'tools/call', params: { name: 'sp_task_show', arguments: {} } },
        });
        expect(res.status).toBe(500);
        expect(JSON.stringify(await jsonOf(res))).toContain('wbs is required');
    });

    test('sp_task_list forwards the filters', async () => {
        const { app, recorder } = harness();
        const result = (await envelopeResult(
            await post(app, {
                token: TOKEN,
                body: {
                    jsonrpc: '2.0',
                    id: 1,
                    method: 'tools/call',
                    params: { name: 'sp_task_list', arguments: { status: 'todo', featureId: 'B9' } },
                },
            }),
        )) as { wbs: string; status: string }[];
        expect(recorder.calls).toEqual(['task.list:{"status":"todo","featureId":"B9"}']);
        expect(result).toEqual([{ wbs: '1372', status: 'todo' }]);
    });

    test('sp_workflow_status with a runId reads the per-run timeline', async () => {
        const { app, recorder } = harness();
        const result = (await envelopeResult(
            await post(app, {
                token: TOKEN,
                body: {
                    jsonrpc: '2.0',
                    id: 1,
                    method: 'tools/call',
                    params: { name: 'sp_workflow_status', arguments: { runId: 'r-1' } },
                },
            }),
        )) as { run: { runId: string } };
        expect(recorder.calls).toEqual(['workflow.trace:r-1']);
        expect(result.run.runId).toBe('r-1');
    });

    test('sp_workflow_status without a runId lists recent runs', async () => {
        const { app, recorder } = harness();
        const result = (await envelopeResult(
            await post(app, {
                token: TOKEN,
                body: {
                    jsonrpc: '2.0',
                    id: 1,
                    method: 'tools/call',
                    params: { name: 'sp_workflow_status', arguments: {} },
                },
            }),
        )) as { total: number };
        expect(recorder.calls).toEqual(['workflow.trace:(all)']);
        expect(result.total).toBe(0);
    });

    test('sp_workflow_run forwards file, string vars and dryRun', async () => {
        const { app, recorder } = harness();
        const result = (await envelopeResult(
            await post(app, {
                token: TOKEN,
                body: {
                    jsonrpc: '2.0',
                    id: 1,
                    method: 'tools/call',
                    params: {
                        name: 'sp_workflow_run',
                        arguments: { file: 'task-pipeline.yaml', vars: { profile: 'auto' }, dryRun: true },
                    },
                },
            }),
        )) as { runId: string };
        expect(recorder.calls).toEqual(['workflow.run:task-pipeline.yaml:{"vars":{"profile":"auto"},"dryRun":true}']);
        expect(result.runId).toBe('r-new');
    });

    test('sp_workflow_run refuses non-string vars instead of coercing', async () => {
        const { app } = harness();
        const res = await post(app, {
            token: TOKEN,
            body: {
                jsonrpc: '2.0',
                id: 1,
                method: 'tools/call',
                params: { name: 'sp_workflow_run', arguments: { file: 'x.yaml', vars: { n: 3 } } },
            },
        });
        expect(res.status).toBe(500);
        expect(JSON.stringify(await jsonOf(res))).toContain('vars must be a map of strings');
    });

    test('sp_workflow_continue without a runId resumes the most recent paused run', async () => {
        const { app, recorder } = harness();
        const result = (await envelopeResult(
            await post(app, {
                token: TOKEN,
                body: {
                    jsonrpc: '2.0',
                    id: 1,
                    method: 'tools/call',
                    params: { name: 'sp_workflow_continue', arguments: { answerText: 'the receipt' } },
                },
            }),
        )) as { runId: string };
        expect(recorder.calls).toEqual([
            'workflow.latestPausedRun',
            'workflow.continuePaused:r-paused:{"answerText":"the receipt"}',
        ]);
        expect(result.runId).toBe('r-paused');
    });

    test('sp_workflow_continue with no paused run and no runId is refused with a clear message', async () => {
        const { app } = makeHarness({ enabled: true, authEnv: 'SPUR_MCP_TOKEN' }, { SPUR_MCP_TOKEN: TOKEN }, null);
        const res = await post(app, {
            token: TOKEN,
            body: {
                jsonrpc: '2.0',
                id: 1,
                method: 'tools/call',
                params: { name: 'sp_workflow_continue', arguments: {} },
            },
        });
        expect(res.status).toBe(500);
        expect(JSON.stringify(await jsonOf(res))).toContain('no paused workflow run');
    });

    test('an unknown tool name names the supported set', async () => {
        const { app } = harness();
        const res = await post(app, {
            token: TOKEN,
            body: { jsonrpc: '2.0', id: 1, method: 'tools/call', params: { name: 'task_delete', arguments: {} } },
        });
        expect(res.status).toBe(500);
        const body = JSON.stringify(await jsonOf(res));
        expect(body).toContain('unknown tool');
        expect(body).toContain('task_delete');
    });
});

describe('AC2 — spur:// resources delegate to @gobing-ai/spur-app', () => {
    const harness = () => makeHarness({ enabled: true, authEnv: 'SPUR_MCP_TOKEN' });

    test('spur://tasks/{wbs} reads the task', async () => {
        const { app, recorder } = harness();
        const result = (await envelopeResult(
            await post(app, {
                token: TOKEN,
                body: { jsonrpc: '2.0', id: 1, method: 'resources/read', params: { uri: 'spur://tasks/1372' } },
            }),
        )) as { content: string };
        expect(recorder.calls).toEqual(['task.show:1372']);
        expect(result.content).toBe('# task 1372');
    });

    test('spur://features/{id} reads the feature', async () => {
        const { app, recorder } = harness();
        const result = (await envelopeResult(
            await post(app, {
                token: TOKEN,
                body: { jsonrpc: '2.0', id: 1, method: 'resources/read', params: { uri: 'spur://features/B9' } },
            }),
        )) as { id: string };
        expect(recorder.calls).toEqual(['feature.show:B9']);
        expect(result.id).toBe('B9');
    });

    test('an unknown feature id is an error, not null-as-success', async () => {
        const { app } = harness();
        const res = await post(app, {
            token: TOKEN,
            body: { jsonrpc: '2.0', id: 1, method: 'resources/read', params: { uri: 'spur://features/NOPE' } },
        });
        expect(res.status).toBe(500);
        expect(JSON.stringify(await jsonOf(res))).toContain('unknown feature NOPE');
    });

    test('spur://context/{name} reads a file from the indexed-context directory', async () => {
        const { app } = harness();
        const result = (await envelopeResult(
            await post(app, {
                token: TOKEN,
                body: {
                    jsonrpc: '2.0',
                    id: 1,
                    method: 'resources/read',
                    params: { uri: 'spur://context/learnings.md' },
                },
            }),
        )) as { uri: string; text: string };
        expect(result.text).toBe('# learnings\n');
        expect(result.uri).toBe('spur://context/learnings.md');
    });

    for (const uri of ['spur://context/../spur/config.yaml', 'spur://context/..', 'spur://context/.']) {
        test(`spur://context/ cannot escape the directory by traversal (${uri})`, async () => {
            const { app } = harness();
            const res = await post(app, {
                token: TOKEN,
                body: { jsonrpc: '2.0', id: 1, method: 'resources/read', params: { uri } },
            });
            expect(res.status).toBe(500);
            expect(JSON.stringify(await jsonOf(res))).toContain('unknown resource');
        });
    }

    test('an unknown resource scheme is refused', async () => {
        const { app } = harness();
        const res = await post(app, {
            token: TOKEN,
            body: { jsonrpc: '2.0', id: 1, method: 'resources/read', params: { uri: 'file:///etc/passwd' } },
        });
        expect(res.status).toBe(500);
        expect(JSON.stringify(await jsonOf(res))).toContain('unknown resource');
    });
});

describe('direct handler seam', () => {
    test('createMcpHandler answers a discover call without Hono', async () => {
        const recorder = makeRecorder();
        const handler = createMcpHandler({
            cwd: tempDir,
            // 1381: tools/list resolves the project namespace and its exposed workflows from
            // the context filesystem, so the seam needs the documented `fs` member.
            fs: createNodeFileSystem(),
            taskService: recorder.taskService,
            featureService: recorder.featureService,
            workflowService: recorder.workflowService,
        } as unknown as ServerContext);
        const res = await handler(
            new Request('http://localhost/mcp', {
                method: 'POST',
                headers: { 'Mcp-Protocol-Version': VERSION },
                body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'tools/list' }),
            }),
        );
        expect(res.status).toBe(200);
        const result = (await res.json()) as { result: { tools: { name: string }[] } };
        expect(result.result.tools).toHaveLength(10);
    });
});

// 1381 R4 reads MCP_BUILTIN_TOOL_NAMES (the app-layer copy `workflow validate` uses), while the
// dispatcher advertises TOOL_DESCRIPTORS. A drift between the two would let validate accept a
// workflow tool the server then refuses — so the lists must stay identical.
describe('mcp built-in tool names (1381 R4)', () => {
    test('the app-layer reserved list matches the advertised descriptors', async () => {
        const { BUILTIN_TOOL_NAMES } = await import('../../src/modules/mcp/index');
        expect([...MCP_BUILTIN_TOOL_NAMES].sort()).toEqual([...BUILTIN_TOOL_NAMES].sort());
    });
});
