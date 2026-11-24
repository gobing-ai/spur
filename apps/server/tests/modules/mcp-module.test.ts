/**
 * B9 task 1372 — the embedded `mcpModule` on `spur self serve`.
 *
 * The failure modes come first (task Plan step 1): a mounted endpoint when the module is off
 * (AC1), a request that sneaks past bearer auth, a delegation that reaches for a service the
 * dispatcher does not own, a continue with no paused run, and a `spur://context/` read that
 * escapes the indexed-context directory.
 */
import { afterAll, describe, expect, test } from 'bun:test';
import { spawnSync } from 'node:child_process';
import { appendFileSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { MCP_BUILTIN_TOOL_NAMES, SYSTEM_EVENT_CATALOG } from '@gobing-ai/spur-app';
import { getEnvVars } from '@gobing-ai/spur-config';
import { createNodeFileSystem } from '@gobing-ai/ts-runtime';
import { Hono } from 'hono';
import type { ServerContext } from '../../src/context';
import { BUILTIN_TOOL_NAMES, createMcpHandler, mcpModule, readMcpCatalog } from '../../src/modules/mcp';
import { MIN_MCP_PROTOCOL_VERSION } from '../../src/modules/mcp/protocol';

const TOKEN = 'mcp-test-token-1234';
const VERSION = MIN_MCP_PROTOCOL_VERSION;

interface Recorded {
    calls: string[];
    /** `undefined` models a context that booted without a section matrix (no check service). */
    checkSvc: unknown;
    taskService(): unknown;
    featureService(): unknown;
    transitionFeature(input: { id: string; to: string }): Promise<unknown>;
    ruleService(): unknown;
    workflowService(): unknown;
    checkService(): unknown;
    planningFolders(): unknown;
    coordination(): unknown;
    inbox(): unknown;
    systemEventDao(): Promise<unknown>;
}

/** Stub services that record delegation so each test asserts its own seam only. */
function makeRecorder(pausedRun: { runId: string } | null = { runId: 'r-paused' }): Recorded {
    const calls: string[] = [];
    // One in-memory inbox for the harness lifetime, so a send → inbox → reply round trip reaches
    // the same rows the way the real service's database would.
    const messages: Array<{
        id: string;
        fromId: string;
        toId: string;
        body: string;
        status: string;
        inReplyTo: string | null;
    }> = [];
    let inbox: unknown;
    const recorder: Recorded = {
        calls,
        checkSvc: {
            check: async (filePath: string, wbs: string, options?: Record<string, unknown>) => {
                calls.push(`task.check:${wbs}:${filePath}:${JSON.stringify(options ?? {})}`);
                return { wbs, status: 'todo', pass: true, findings: [], missingSections: [] };
            },
        },
        checkService: () => recorder.checkSvc,
        planningFolders: () => ({ tasksDir: 'docs/tasks', featuresDir: 'docs/features' }),
        taskService: () => ({
            show: async (wbs: string) => {
                calls.push(`task.show:${wbs}`);
                return {
                    wbs,
                    name: 'the task',
                    status: 'todo',
                    filePath: join(tempDir, `${wbs}_task.md`),
                    dependencies: [],
                    frontmatter: { dependencies: [] },
                    content: `# task ${wbs}`,
                };
            },
            list: async (filters?: Record<string, string>) => {
                calls.push(`task.list:${JSON.stringify(filters ?? {})}`);
                return [{ wbs: '1372', status: 'todo' }];
            },
            // The real writer reads a source file and lands the section in the task file; this
            // stub does the same to the temp task file, so the append/replace effect is on disk.
            updateSection: async (wbs: string, section: string, sourceFile: string, append: boolean) => {
                const body = readFileSync(sourceFile, 'utf8');
                calls.push(`task.updateSection:${wbs}:${section}:${String(append)}`);
                const file = join(tempDir, `${wbs}_task.md`);
                writeFileSync(file, `${append ? readFileSync(file, 'utf8') : ''}### ${section}\n${body}\n`);
                return { eventName: 'task.updated', warnings: [] };
            },
            mutateSections: async (wbs: string, op: string, section?: string) => {
                calls.push(`task.mutateSections:${wbs}:${op}:${section ?? '-'}`);
                if (op !== 'list' && section !== undefined) {
                    appendFileSync(join(tempDir, `${wbs}_task.md`), `\n### ${section}\n`);
                }
                return {
                    op,
                    ref: { id: wbs, filePath: join(tempDir, `${wbs}_task.md`) },
                    variant: 'feature-impl',
                    status: 'todo',
                    added: op === 'list' || section === undefined ? [] : [section],
                    matrix: { required: ['Plan'], optional: [], forbidden: [] },
                    present: [],
                    missing: ['Plan'],
                };
            },
            mutateDependencies: async (wbs: string, op: string, values: string[]) => {
                calls.push(`task.mutateDependencies:${wbs}:${op}:${values.join(',')}`);
                writeFileSync(join(tempDir, `${wbs}_deps.json`), JSON.stringify(values));
                return { dependencies: values, eventName: 'task.updated', warnings: [] };
            },
        }),
        featureService: () => ({
            show: async (id: string) => {
                calls.push(`feature.show:${id}`);
                return id === 'B9' ? { id, content: `# feature ${id}` } : null;
            },
            list: async () => {
                calls.push('feature.list');
                return [
                    { id: 'A1', name: 'parent', status: 'backlog', priority: 'P2' },
                    { id: 'A11', name: 'child', status: 'active', priority: 'P1' },
                    { id: 'B2', name: 'other', status: 'backlog', priority: 'P2' },
                ];
            },
            create: async (name: string, parentId?: string) => {
                calls.push(`feature.create:${name}:${parentId ?? '-'}`);
                return {
                    ref: { id: parentId === undefined ? 'C1' : `${parentId}1`, filePath: join(tempDir, 'C1_new.md') },
                    warnings: [],
                };
            },
            update: async (id: string, key: string, value: string) => {
                calls.push(`feature.update:${id}:${key}:${value}`);
                return { eventName: 'feature.updated', warnings: [] };
            },
            // Same shape as the task writer: the source file is read inside the service.
            updateSection: async (id: string, section: string, sourceFile: string) => {
                calls.push(`feature.updateSection:${id}:${section}:${readFileSync(sourceFile, 'utf8')}`);
                return { eventName: 'feature.updated', warnings: [] };
            },
            syncFeature: async (id: string, options?: Record<string, unknown>) => {
                calls.push(`feature.syncFeature:${id}:${JSON.stringify(options ?? {})}`);
                return { proposal: { from: 'backlog', to: 'active' }, applied: false, appliedHops: [] };
            },
            syncAllFeatures: async (options?: Record<string, unknown>) => {
                calls.push(`feature.syncAllFeatures:${JSON.stringify(options ?? {})}`);
                return { results: [], updatedCount: 0 };
            },
            refresh: async (options?: Record<string, unknown>) => {
                calls.push(`feature.refresh:${JSON.stringify(options ?? {})}`);
                return { index: '# INDEX', tasksUpdated: 0, skipped: [] };
            },
        }),
        // The guarded seam signals a refusal through the error CLASS; `done` models one.
        transitionFeature: async (input: { id: string; to: string }) => {
            calls.push(`feature.transition:${input.id}:${input.to}`);
            if (input.to === 'done') {
                const denied = new Error(`feature transition ${input.id} → done is not declared (GUARD_DENIED)`);
                denied.name = 'GuardDeniedError';
                throw denied;
            }
            return { eventName: 'feature.transitioned', warnings: [] };
        },
        ruleService: () => ({
            list: async (preset?: string) => {
                calls.push(`rule.list:${preset ?? '-'}`);
                return {
                    preset,
                    ruleCount: 1,
                    rules: [{ id: 'sp-scope', description: 'scope', severity: 'error', enabled: true }],
                    mode: preset === undefined ? 'layered' : 'preset',
                    layers: [],
                    totalFiles: 1,
                    categories: [],
                    uncategorized: [],
                    presets: [],
                };
            },
            validate: async (opts: { source: { kind: string; value: string } }) => {
                calls.push(`rule.validate:${opts.source.kind}:${opts.source.value}`);
                return {
                    valid: true,
                    kind: opts.source.kind,
                    source: opts.source.value,
                    ruleCount: 2,
                    rules: ['a', 'b'],
                    exitCode: 0,
                };
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
            list: async (paths?: string[]) => {
                calls.push(`workflow.list:${JSON.stringify(paths ?? [])}`);
                return { layers: [], entries: [], totalFiles: 0 };
            },
            validate: async (file: string) => {
                calls.push(`workflow.validate:${file}`);
                return { valid: true, file, workflow: { name: 'task-pipeline' }, errors: [] };
            },
            cancel: async (runId: string) => {
                calls.push(`workflow.cancel:${runId}`);
                return runId === 'missing'
                    ? { runId, finalized: false, status: 'not_found', killed: false }
                    : { runId, finalized: true, status: 'failed', killed: false };
            },
        }),
        coordination: () => ({
            listAgentSpecs: async () => {
                calls.push('coordination.listAgentSpecs');
                return [{ id: 'proj-worker', name: 'worker', type: 'claude', executor: 'claude' }];
            },
            listFleetMembers: async () => {
                calls.push('coordination.listFleetMembers');
                return [{ instanceId: 'proj-worker', localId: 'worker', executor: 'claude', enabled: true }];
            },
        }),
        inbox: () => {
            inbox ??= {
                send: async (input: { from: string; to: string; body: string }) => {
                    calls.push(`inbox.send:${input.from}->${input.to}:${input.body}`);
                    const message = {
                        id: `msg_${messages.length + 1}`,
                        fromId: input.from,
                        toId: input.to,
                        body: input.body,
                        status: 'queued',
                        inReplyTo: null,
                    };
                    messages.push(message);
                    return { message, replayed: false };
                },
                get: async (id: string) => {
                    calls.push(`inbox.get:${id}`);
                    return messages.find((message) => message.id === id) ?? null;
                },
                list: async (member: string, direction: string) => {
                    calls.push(`inbox.list:${member}:${direction}`);
                    return { messages: messages.filter((message) => message.toId === member), nextCursor: null };
                },
                requests: async (member?: string) => {
                    calls.push(`inbox.requests:${member ?? '-'}`);
                    return messages.filter((message) => member === undefined || message.toId === member);
                },
                reply: async (id: string, from: string, body: string) => {
                    calls.push(`inbox.reply:${id}:${from}:${body}`);
                    const original = messages.find((message) => message.id === id);
                    if (original === undefined) throw new Error(`No message found with id "${id}"`);
                    const reply = {
                        id: `msg_${messages.length + 1}`,
                        fromId: from,
                        toId: original.fromId,
                        body,
                        status: 'queued',
                        inReplyTo: id,
                    };
                    messages.push(reply);
                    return reply;
                },
            };
            return inbox;
        },
        // The decision readiness overlay reads the ledger through this dao and nothing else.
        systemEventDao: async () => {
            calls.push('systemEventDao');
            return {
                decisionSummary: async () => {
                    calls.push('dao.decisionSummary');
                    return [];
                },
                decisionOutcomePairs: async () => {
                    calls.push('dao.decisionOutcomePairs');
                    return [];
                },
            };
        },
    };
    return recorder;
}

/** A minimal ServerContext slice: cwd/fs/env, the boot config switch, and the stub services. */
function makeHarness(
    bootMcp: { enabled: boolean; authEnv: string | null; namespace?: string } | undefined,
    env: Record<string, string | undefined> = { SPUR_MCP_TOKEN: TOKEN },
    pausedRun: { runId: string } | null = { runId: 'r-paused' },
    /** Extra context fields one suite needs (e.g. a `spurConfig` that pins the decision maker). */
    overrides: Record<string, unknown> = {},
): {
    app: Hono;
    recorder: Recorded;
    ctx: ServerContext;
    events: Array<{ name: string; payload: Record<string, unknown> }>;
} {
    const recorder = makeRecorder(pausedRun);
    const events: Array<{ name: string; payload: Record<string, unknown> }> = [];
    const ctx = {
        cwd: tempDir,
        fs: createNodeFileSystem(),
        env,
        logger: { debug: () => {}, info: () => {}, warn: () => {}, error: () => {} },
        ...(bootMcp === undefined ? {} : { bootConfig: () => ({ mcp: bootMcp }) }),
        taskService: recorder.taskService,
        featureService: recorder.featureService,
        transitionFeature: recorder.transitionFeature,
        ruleService: recorder.ruleService,
        workflowService: recorder.workflowService,
        checkService: recorder.checkService,
        planningFolders: recorder.planningFolders,
        coordination: recorder.coordination,
        inbox: recorder.inbox,
        systemEventDao: recorder.systemEventDao,
        ...overrides,
        eventBus: () => ({
            emit: (name: string, payload: Record<string, unknown>) => {
                events.push({ name, payload });
            },
        }),
    } as unknown as ServerContext;
    const app = new Hono();
    mcpModule.mount(app, ctx);
    return { app, recorder, ctx, events };
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

interface ToolCallOutcome<T> {
    recorder: Recorded;
    result: T;
    status: number;
    failures: Array<{ payload: Record<string, unknown> }>;
}

/** Call one tool over the mounted endpoint: its result, its status and the failure events it emitted. */
async function callToolWith<T>(
    name: string,
    args: Record<string, unknown>,
    overrides: Record<string, unknown> = {},
): Promise<ToolCallOutcome<T>> {
    const { app, recorder, events } = makeHarness(
        { enabled: true, authEnv: 'SPUR_MCP_TOKEN' },
        { SPUR_MCP_TOKEN: TOKEN },
        undefined,
        overrides,
    );
    const res = await post(app, {
        token: TOKEN,
        body: { jsonrpc: '2.0', id: 1, method: 'tools/call', params: { name, arguments: args } },
    });
    const body = (await jsonOf(res)) as { result: T };
    return {
        recorder,
        result: body.result,
        status: res.status,
        failures: events.filter((event) => event.name === 'mcp.tool.failed'),
    };
}

let tempDir: string;

function setupTempDir(): void {
    tempDir = join(tmpdir(), `spur-mcp-module-${Date.now()}-${Math.random().toString(36).slice(2)}`);
    mkdirSync(join(tempDir, '.spur', 'context'), { recursive: true });
    writeFileSync(join(tempDir, '.spur', 'context', 'learnings.md'), '# learnings\n');
    // The project-layer decision the wave C decision tools list, show, report and run.
    mkdirSync(join(tempDir, '.spur', 'decisions'), { recursive: true });
    writeFileSync(
        join(tempDir, '.spur', 'decisions', 'probe.yaml'),
        `version: 1
decisions:
    ${DECISION_ID}:
        type: choice
        description: Pick a word.
        instructions: |
            Answer yes when the note asks for yes; otherwise no.
        parameters:
            note:
                type: string
                default: nothing
        criteria:
            'yes': The note asks for yes.
            'no': The note asks for anything else.
        fallback: 'no'
`,
    );
    // `sp_builder_show_branches` reads a real repository, so the temp project is one.
    git('init', '-b', 'main');
    git('-c', 'user.email=mcp@test', '-c', 'user.name=mcp', 'commit', '--allow-empty', '-m', 'init');
}

/** The one decision the temp project declares (wave C, task 1445 R4). */
const DECISION_ID = 'mcp-probe-decision';

function git(...args: string[]): void {
    const result = spawnSync('git', args, { cwd: tempDir, encoding: 'utf8' });
    if (result.status !== 0) throw new Error(`git ${args.join(' ')} failed: ${result.stderr}`);
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

    test('server/discover advertises the built-in harness tools and the three spur:// resources', async () => {
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
                // 1445 R1: the task tools, check/sections/deps/preflight/batch-plan.
                'sp_task_check',
                'sp_task_sections',
                'sp_task_deps',
                'sp_task_preflight',
                'sp_task_batch_plan',
                // 1445 R2/R3: the feature, workflow and rule tools.
                'sp_feature_show',
                'sp_feature_list',
                'sp_feature_create',
                'sp_feature_update',
                'sp_feature_transition',
                'sp_feature_sync',
                'sp_feature_refresh',
                'sp_workflow_list',
                'sp_workflow_show',
                'sp_workflow_validate',
                'sp_workflow_cancel',
                'sp_rule_list',
                'sp_rule_validate',
                // 1445 R4/R5/R6: decision, coordination/builder and self tools.
                'sp_decision_list',
                'sp_decision_show',
                'sp_decision_status',
                'sp_decision_run',
                'sp_agent_status',
                'sp_message_send',
                'sp_message_inbox',
                'sp_message_reply',
                'sp_builder_check_deps',
                'sp_builder_show_branches',
                'sp_self_status',
                'sp_self_search',
                'sp_self_actions',
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
        expect(result.result.tools).toHaveLength(MCP_BUILTIN_TOOL_NAMES.length);
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

/**
 * 1421 R1 — the failure classes an MCP client can cause by sending bad arguments must be ONE
 * catalog code (`invalid_arguments`), not a growing set of message-shaped guesses. Before this, the
 * emit site inferred the code from four message suffixes, so every new validator message silently
 * degraded to `tool_error` and the Board's error split lied.
 */
describe('1421 R1 — argument-validation failures classify as invalid_arguments', () => {
    const harness = () => makeHarness({ enabled: true, authEnv: 'SPUR_MCP_TOKEN' });

    /** Call one tool and return the failure event the ledger would group by `errorCode`. */
    async function failureOf(
        name: string,
        args: Record<string, unknown>,
    ): Promise<{ status: number; errorCode: unknown; message: string }> {
        const { app, events } = harness();
        const res = await post(app, {
            token: TOKEN,
            body: { jsonrpc: '2.0', id: 1, method: 'tools/call', params: { name, arguments: args } },
        });
        const event = events.find((entry) => entry.name === 'mcp.tool.failed');
        if (event === undefined) throw new Error(`expected an mcp.tool.failed event for ${name}`);
        const body = (await res.json()) as { error?: { errorCode?: string } };
        expect(body.error?.errorCode).toBe(
            event.payload.errorCode === 'invalid_arguments' ? 'invalid_arguments' : undefined,
        );
        return { status: res.status, errorCode: event.payload.errorCode, message: String(event.payload.error) };
    }

    test('an unknown argument', async () => {
        const failed = await failureOf('sp_task_list', { bogus: 'x' });
        expect(failed.status).toBe(500);
        expect(failed.errorCode).toBe('invalid_arguments');
        expect(failed.message).toContain('unknown argument');
    });

    test('an enum violation', async () => {
        const failed = await failureOf('sp_feature_check', { id: 'A82', as: 'nope' });
        expect(failed.errorCode).toBe('invalid_arguments');
        expect(failed.message).toContain('must be one of');
        expect((await failureOf('sp_task_transition', { wbs: '1421', to: 'invalid' })).errorCode).toBe(
            'invalid_arguments',
        );
    });

    test('a string, boolean and array type violation', async () => {
        expect((await failureOf('sp_workflow_status', { runId: 5 })).errorCode).toBe('invalid_arguments');
        expect((await failureOf('sp_feature_check', { id: 'A82', strict: 'yes' })).errorCode).toBe('invalid_arguments');
        expect((await failureOf('sp_task_update', { wbs: '1421', addTags: 'x' })).errorCode).toBe('invalid_arguments');
    });

    test('a missing required argument', async () => {
        const failed = await failureOf('sp_task_show', {});
        expect(failed.errorCode).toBe('invalid_arguments');
        expect(failed.message).toContain('wbs is required');
    });

    test('a map-of-strings violation', async () => {
        const failed = await failureOf('sp_workflow_run', { file: 'x.yaml', vars: { n: 3 } });
        expect(failed.errorCode).toBe('invalid_arguments');
        expect(failed.message).toContain('vars must be a map of strings');
    });

    test('a workflow tool refuses an argument it does not declare', async () => {
        // A real project layer: the exposed workflow is what makes a non-built-in tool exist.
        const root = mkdtempSync(join(tmpdir(), 'spur-mcp-wf-'));
        mkdirSync(join(root, '.spur', 'workflows'), { recursive: true });
        writeFileSync(
            join(root, '.spur', 'workflows', 'daily-report.yaml'),
            `name: daily-report
kind: state-machine
metadata:
  mcp:
    expose: true
vars:
  target: default
initialState: start
states:
  - id: start
  - id: done
transitions:
  - from: start
    to: done
    guard: { kind: always }
terminalStates:
  - done
`,
        );
        const events: Array<{ name: string; payload: Record<string, unknown> }> = [];
        const recorder = makeRecorder();
        const app = new Hono();
        mcpModule.mount(app, {
            cwd: root,
            fs: createNodeFileSystem(),
            env: { SPUR_MCP_TOKEN: TOKEN },
            logger: { debug: () => {}, info: () => {}, warn: () => {}, error: () => {} },
            bootConfig: () => ({ mcp: { enabled: true, authEnv: 'SPUR_MCP_TOKEN', namespace: 'ops' } }),
            taskService: recorder.taskService,
            featureService: recorder.featureService,
            workflowService: recorder.workflowService,
            eventBus: () => ({
                emit: (name: string, payload: Record<string, unknown>) => {
                    events.push({ name, payload });
                },
            }),
        } as unknown as ServerContext);
        try {
            const res = await post(app, {
                token: TOKEN,
                body: {
                    jsonrpc: '2.0',
                    id: 1,
                    method: 'tools/call',
                    params: { name: 'ops_daily_report', arguments: { bogus: 'x' } },
                },
            });
            expect(res.status).toBe(500);
            const event = events.find((entry) => entry.name === 'mcp.tool.failed');
            expect(event?.payload.errorCode).toBe('invalid_arguments');
            expect(String(event?.payload.error)).toContain('invalid_arguments:');
        } finally {
            rmSync(root, { recursive: true, force: true });
        }
    });

    test('an unknown tool stays unknown_tool and a service throw stays tool_error', async () => {
        expect((await failureOf('task_delete', {})).errorCode).toBe('unknown_tool');
        // `sp_feature_check` with an id the service does not know is the service's own failure.
        expect((await failureOf('sp_feature_check', { id: 'nope' })).errorCode).toBe('tool_error');
    });
});

/**
 * 1421 R2 — a client must be able to tell a read from a write without knowing Spur's tool names, so
 * every advertised descriptor carries the three MCP annotations.
 */
describe('1421 R2 — tool descriptors declare read/write annotations', () => {
    const harness = () => makeHarness({ enabled: true, authEnv: 'SPUR_MCP_TOKEN' });

    interface Annotations {
        readOnlyHint: boolean;
        destructiveHint: boolean;
        idempotentHint: boolean;
    }

    async function annotated(): Promise<Map<string, Annotations>> {
        const { app } = harness();
        const result = (await envelopeResult(
            await post(app, {
                token: TOKEN,
                body: { jsonrpc: '2.0', id: 1, method: 'tools/list' },
            }),
        )) as { tools: Array<{ name: string; annotations?: Annotations }> };
        return new Map(result.tools.map((tool) => [tool.name, tool.annotations ?? ({} as Annotations)]));
    }

    test('the read tools are read-only and idempotent', async () => {
        const tools = await annotated();
        for (const name of [
            'sp_task_show',
            'sp_task_list',
            'sp_feature_check',
            'sp_rule_run',
            'sp_workflow_status',
            'sp_task_check',
            'sp_task_preflight',
            'sp_task_batch_plan',
            'sp_feature_show',
            'sp_feature_list',
            'sp_workflow_list',
            'sp_workflow_show',
            'sp_workflow_validate',
            'sp_rule_list',
            'sp_rule_validate',
            'sp_decision_list',
            'sp_decision_show',
            'sp_decision_status',
            'sp_agent_status',
            'sp_message_inbox',
            'sp_builder_check_deps',
            'sp_builder_show_branches',
            'sp_self_status',
            'sp_self_search',
            'sp_self_actions',
        ]) {
            expect(tools.get(name)).toEqual({ readOnlyHint: true, destructiveHint: false, idempotentHint: true });
        }
    });

    test('the write tools are neither read-only nor idempotent', async () => {
        const tools = await annotated();
        for (const name of [
            'sp_task_create',
            'sp_task_update',
            'sp_task_transition',
            'sp_workflow_run',
            'sp_workflow_continue',
            'sp_task_sections',
            'sp_task_deps',
            'sp_feature_create',
            'sp_feature_update',
            'sp_feature_transition',
            'sp_feature_sync',
            'sp_feature_refresh',
            'sp_workflow_cancel',
            'sp_decision_run',
            'sp_message_send',
            'sp_message_reply',
        ]) {
            expect(tools.get(name)).toEqual({ readOnlyHint: false, destructiveHint: false, idempotentHint: false });
        }
    });

    test('every advertised tool carries all three hints, and none is destructive', async () => {
        const tools = await annotated();
        expect(tools.size).toBe(MCP_BUILTIN_TOOL_NAMES.length);
        for (const [name, annotations] of tools) {
            expect(typeof annotations.readOnlyHint, name).toBe('boolean');
            expect(typeof annotations.idempotentHint, name).toBe('boolean');
            expect(annotations.destructiveHint, name).toBe(false);
        }
    });
});

/**
 * 1445 R1 (wave A) — the task tools: check, sections, deps, preflight and the inline batch plan,
 * plus `append` on `sp_task_update`. Dispatcher level, like the rest of this file: each tool must
 * reach its service seam, and the section/deps stubs write the temp task file so the effect the
 * caller asked for is asserted on disk rather than trusted from the call log.
 */
describe('1445 R1 — task check, sections, deps, preflight, batch plan and append', () => {
    const harness = () => makeHarness({ enabled: true, authEnv: 'SPUR_MCP_TOKEN' });

    const callWith = callToolWith;

    test('sp_task_check forwards the target status and returns the CLI --json result list', async () => {
        const { recorder, result } = await callWith<Array<Record<string, unknown>>>('sp_task_check', {
            wbs: '1445',
            as: 'done',
        });
        expect(recorder.calls[0]).toBe('task.show:1445');
        expect(recorder.calls[1]).toContain('task.check:1445:');
        expect(recorder.calls[1]).toContain('"asStatus":"done"');
        expect(result).toEqual([{ wbs: '1445', status: 'todo', pass: true, findings: [], missingSections: [] }]);
    });

    test('sp_task_check names the missing check service instead of reporting a null result', async () => {
        const { app, recorder } = harness();
        recorder.checkSvc = undefined;
        const res = await post(app, {
            token: TOKEN,
            body: {
                jsonrpc: '2.0',
                id: 1,
                method: 'tools/call',
                params: { name: 'sp_task_check', arguments: { wbs: '1445' } },
            },
        });
        expect(res.status).toBe(500);
        expect(JSON.stringify(await jsonOf(res))).toContain('task check is unavailable');
    });

    test('sp_task_sections op=list reads the matrix without writing', async () => {
        const { recorder, result } = await callWith<{ op: string; missing: string[] }>('sp_task_sections', {
            wbs: '1446',
            op: 'list',
        });
        expect(recorder.calls).toEqual(['task.mutateSections:1446:list:-']);
        expect(result.missing).toEqual(['Plan']);
    });

    test('sp_task_sections op=add writes the canonical section', async () => {
        const { recorder, result } = await callWith<{ op: string; added: string[] }>('sp_task_sections', {
            wbs: '1446',
            op: 'add',
            section: 'Notes',
        });
        expect(recorder.calls).toEqual(['task.mutateSections:1446:add:Notes']);
        expect(result.added).toEqual(['Notes']);
        expect(readFileSync(join(tempDir, '1446_task.md'), 'utf8')).toContain('### Notes');
    });

    test('sp_task_deps forwards op and values, and the dependency write lands on disk', async () => {
        const { recorder, result } = await callWith<{ dependencies: string[] }>('sp_task_deps', {
            wbs: '1447',
            op: 'add',
            values: ['1445', '1446'],
        });
        expect(recorder.calls).toEqual(['task.mutateDependencies:1447:add:1445,1446']);
        expect(result).toMatchObject({ dependencies: ['1445', '1446'], eventName: 'task.updated', warnings: [] });
        expect(JSON.parse(readFileSync(join(tempDir, '1447_deps.json'), 'utf8'))).toEqual(['1445', '1446']);
    });

    test('sp_task_preflight reads the corpus facts and returns the TABLE A decision', async () => {
        const { recorder, result } = await callWith<{ exitCode: number; result: { action: string } }>(
            'sp_task_preflight',
            { wbs: '1445' },
        );
        expect(recorder.calls).toEqual(['task.show:1445']);
        expect(result.exitCode).toBe(0);
        expect(result.result.action).toBe('run');
    });

    test('sp_task_preflight honours an explicit status and asks only for the recovery hop', async () => {
        const { recorder, result } = await callWith<{ exitCode: number; result: { recovery: { code: string } } }>(
            'sp_task_preflight',
            { wbs: '1445', status: 'blocked', recovery: true },
        );
        expect(recorder.calls).toEqual([]);
        expect(result.exitCode).toBe(0);
        expect(result.result.recovery.code).toBe('A7');
    });

    test('sp_task_batch_plan order projects the inline JSON task list', async () => {
        const tasks = JSON.stringify([{ wbs: '0002', dependencies: ['0001'] }, { wbs: '0001' }]);
        const { result } = await callWith<{ order: string[]; mode: string }>('sp_task_batch_plan', {
            mode: 'order',
            tasks,
        });
        expect(result.order).toEqual(['0001', '0002']);
    });

    test('sp_task_batch_plan refuses anything that is not inline JSON as invalid_arguments', async () => {
        const { status, failures } = await callWith('sp_task_batch_plan', {
            mode: 'waves',
            tasks: '/tmp/tasks.json',
        });
        expect(status).toBe(500);
        expect(failures[0]?.payload.errorCode).toBe('invalid_arguments');
        expect(String(failures[0]?.payload.error)).toContain('cannot read');
    });

    test('sp_task_update append adds to the existing section body instead of replacing it', async () => {
        const first = await callWith<{ section: string }>('sp_task_update', {
            wbs: '1448',
            section: 'Plan',
            content: 'first',
        });
        expect(first.recorder.calls).toEqual(['task.updateSection:1448:Plan:false']);
        expect(readFileSync(join(tempDir, '1448_task.md'), 'utf8')).toBe('### Plan\nfirst\n');

        const second = await callWith<Record<string, unknown>>('sp_task_update', {
            wbs: '1448',
            section: 'Plan',
            content: 'second',
            append: true,
        });
        expect(second.recorder.calls).toEqual(['task.updateSection:1448:Plan:true']);
        expect(second.result).toEqual({ wbs: '1448', section: 'Plan', eventName: 'task.updated', warnings: [] });
        const written = readFileSync(join(tempDir, '1448_task.md'), 'utf8');
        expect(written).toBe('### Plan\nfirst\n### Plan\nsecond\n');
    });

    test('sp_task_update refuses append with field as invalid_arguments', async () => {
        const { status, failures } = await callWith('sp_task_update', {
            wbs: '1448',
            field: 'priority',
            value: 'P1',
            append: true,
        });
        expect(status).toBe(500);
        expect(failures[0]?.payload.errorCode).toBe('invalid_arguments');
        expect(String(failures[0]?.payload.error)).toContain('append is only valid with section+content');
    });
});

/**
 * 1445 R2/R3 (wave B) — the feature, workflow and rule tools. Dispatcher level, same shape as the
 * wave A suite: each tool must reach its service seam, the argument-group rules must refuse before
 * any service runs, and a guard refusal must keep its machine code.
 */
describe('1445 R2/R3 — feature, workflow and rule tools', () => {
    const callWith = callToolWith;

    test('sp_feature_list filters the service list by status and by direct parent id', async () => {
        const all = await callWith<Array<{ id: string }>>('sp_feature_list', {});
        expect(all.recorder.calls).toEqual(['feature.list']);
        expect(all.result.map((feature) => feature.id)).toEqual(['A1', 'A11', 'B2']);

        const active = await callWith<Array<{ id: string }>>('sp_feature_list', { status: 'Active' });
        expect(active.result.map((feature) => feature.id)).toEqual(['A11']);

        const children = await callWith<Array<{ id: string }>>('sp_feature_list', { parentId: 'A1' });
        expect(children.result.map((feature) => feature.id)).toEqual(['A11']);
    });

    test('sp_feature_list refuses an unknown status as invalid_arguments', async () => {
        const { status, failures } = await callWith('sp_feature_list', { status: 'nope' });
        expect(status).toBe(500);
        expect(failures[0]?.payload.errorCode).toBe('invalid_arguments');
        expect(String(failures[0]?.payload.error)).toContain('Unknown feature status');
    });

    test('sp_feature_show returns the feature and refuses an unknown id', async () => {
        const found = await callWith<{ id: string; content: string }>('sp_feature_show', { id: 'B9' });
        expect(found.recorder.calls).toEqual(['feature.show:B9']);
        expect(found.result.content).toBe('# feature B9');

        const missing = await callWith('sp_feature_show', { id: 'NOPE' });
        expect(missing.status).toBe(500);
        expect(JSON.stringify(missing.result ?? missing.failures)).toContain('Feature NOPE not found');
    });

    test('sp_feature_create forwards the name and parent id and returns the allocated ref', async () => {
        const { recorder, result } = await callWith<{
            id: string;
            filePath: string;
            eventName: string | null;
            warnings: string[];
        }>('sp_feature_create', { name: 'New feature', parentId: 'A1' });
        expect(recorder.calls).toEqual(['feature.create:New feature:A1']);
        expect(result).toEqual({ id: 'A11', filePath: join(tempDir, 'C1_new.md'), eventName: null, warnings: [] });
    });

    test('sp_feature_update field=priority writes the field and reports the write', async () => {
        const { recorder, result } = await callWith<Record<string, unknown>>('sp_feature_update', {
            id: 'A1',
            field: 'priority',
            value: 'P1',
        });
        expect(recorder.calls).toEqual(['feature.update:A1:priority:P1']);
        expect(result).toEqual({ id: 'A1', field: 'priority', eventName: 'feature.updated', warnings: [] });
    });

    test('sp_feature_update section+content writes through the inline bridge, never a caller path', async () => {
        const { recorder, result } = await callWith<Record<string, unknown>>('sp_feature_update', {
            id: 'A1',
            section: 'Scope',
            content: 'inline body',
        });
        expect(recorder.calls).toEqual(['feature.updateSection:A1:Scope:inline body']);
        expect(result).toEqual({ id: 'A1', section: 'Scope', eventName: 'feature.updated', warnings: [] });
    });

    test('sp_feature_update refuses field "status" with a pointer to the transition tool', async () => {
        const { status, failures } = await callWith('sp_feature_update', { id: 'A1', field: 'status', value: 'done' });
        expect(status).toBe(500);
        expect(failures[0]?.payload.errorCode).toBe('invalid_arguments');
        expect(String(failures[0]?.payload.error)).toContain('use sp_feature_transition');
    });

    test('sp_feature_update refuses both and neither argument group', async () => {
        const both = await callWith('sp_feature_update', {
            id: 'A1',
            section: 'Scope',
            content: 'x',
            field: 'priority',
            value: 'P1',
        });
        expect(both.failures[0]?.payload.errorCode).toBe('invalid_arguments');
        expect(String(both.failures[0]?.payload.error)).toContain('exactly one of');

        const neither = await callWith('sp_feature_update', { id: 'A1' });
        expect(neither.failures[0]?.payload.errorCode).toBe('invalid_arguments');
        expect(String(neither.failures[0]?.payload.error)).toContain('exactly one of');
    });

    test('sp_feature_transition returns the guarded write result', async () => {
        const { recorder, result } = await callWith<Record<string, unknown>>('sp_feature_transition', {
            id: 'A1',
            to: 'active',
        });
        expect(recorder.calls).toEqual(['feature.transition:A1:active']);
        expect(result).toEqual({ eventName: 'feature.transitioned', warnings: [] });
    });

    test('a guard-denied feature transition keeps its GUARD_DENIED code', async () => {
        const { failures } = await callWith('sp_feature_transition', { id: 'A1', to: 'done' });
        expect(failures[0]?.payload.errorCode).toBe('tool_error');
        expect(String(failures[0]?.payload.error)).toStartWith('GUARD_DENIED:');
        expect(String(failures[0]?.payload.error)).toContain('is not declared');
    });

    test('sp_feature_sync previews one feature, and syncs all when no id is given', async () => {
        const one = await callWith<{ applied: boolean }>('sp_feature_sync', { id: 'A1', dryRun: true });
        expect(one.recorder.calls).toEqual(['feature.syncFeature:A1:{"dryRun":true}']);
        expect(one.result.applied).toBe(false);

        const all = await callWith('sp_feature_sync', { force: true });
        expect(all.recorder.calls).toEqual(['feature.syncAllFeatures:{"force":true}']);
    });

    test('sp_feature_refresh scopes the Tasks rewrite to one feature when given an id', async () => {
        const scoped = await callWith<{ index: string }>('sp_feature_refresh', { id: 'A1' });
        expect(scoped.recorder.calls).toEqual(['feature.refresh:{"featureId":"A1"}']);
        expect(scoped.result.index).toBe('# INDEX');

        const everything = await callWith('sp_feature_refresh', {});
        expect(everything.recorder.calls).toEqual(['feature.refresh:{}']);
    });

    test('sp_workflow_list scans the configured workflow layers', async () => {
        const { recorder, result } = await callWith<{ totalFiles: number }>('sp_workflow_list', {});
        expect(recorder.calls).toHaveLength(1);
        expect(recorder.calls[0]).toStartWith('workflow.list:');
        expect(result.totalFiles).toBe(0);
    });

    test('sp_workflow_show resolves a project workflow into states, transitions, vars and mcp exposure', async () => {
        mkdirSync(join(tempDir, '.spur', 'workflows'), { recursive: true });
        writeFileSync(
            join(tempDir, '.spur', 'workflows', 'task-pipeline.yaml'),
            `name: task-pipeline
kind: state-machine
version: '1'
vars:
  target: default
initialState: start
states:
  - id: start
  - id: done
transitions:
  - from: start
    to: done
    guard: { kind: always }
terminalStates:
  - done
`,
        );
        const { result } = await callWith<{
            name: string;
            version: string | null;
            states: Array<{ id: string }>;
            transitions: Array<{ from: string; to: string; guard?: unknown }>;
            vars: Record<string, unknown>;
            mcp: unknown;
            source: { layer: string; path: string };
            definitionDigest: string;
        }>('sp_workflow_show', { file: 'task-pipeline.yaml' });
        expect(result.name).toBe('task-pipeline');
        expect(result.version).toBe('1');
        expect(result.states.map((state) => state.id)).toEqual(['start', 'done']);
        expect(result.transitions).toEqual([{ from: 'start', to: 'done', guard: { kind: 'always' } }]);
        expect(result.vars).toEqual({ target: 'default' });
        expect(result.mcp).toBeNull();
        expect(result.source.layer).toBe('project');
        expect(result.source.path).toBe(join(tempDir, '.spur', 'workflows', 'task-pipeline.yaml'));
        expect(result.definitionDigest.length).toBeGreaterThan(0);
    });

    test('sp_workflow_show refuses an unresolvable file instead of returning a partial definition', async () => {
        const { status, failures } = await callWith('sp_workflow_show', { file: 'no-such-workflow.yaml' });
        expect(status).toBe(500);
        expect(String(failures[0]?.payload.error)).toContain('Workflow not found');
    });

    test('sp_workflow_validate forwards the file to the service', async () => {
        const { recorder, result } = await callWith<{ valid: boolean; file: string }>('sp_workflow_validate', {
            file: 'task-pipeline.yaml',
        });
        expect(recorder.calls).toEqual(['workflow.validate:task-pipeline.yaml']);
        expect(result).toMatchObject({ valid: true, file: 'task-pipeline.yaml' });
    });

    test('sp_workflow_cancel refuses an unknown run id as an error result, not a crash', async () => {
        const missing = await callWith('sp_workflow_cancel', { runId: 'missing' });
        expect(missing.recorder.calls).toEqual(['workflow.cancel:missing']);
        expect(missing.status).toBe(500);
        expect(missing.failures[0]?.payload.errorCode).toBe('tool_error');
        expect(String(missing.failures[0]?.payload.error)).toContain('Run missing not found');

        const cancelled = await callWith<{ runId: string; finalized: boolean; status: string; killed: boolean }>(
            'sp_workflow_cancel',
            {
                runId: 'r-1',
            },
        );
        expect(cancelled.result).toEqual({ runId: 'r-1', finalized: true, status: 'failed', killed: false });
    });

    test('sp_rule_list lists every layer without a preset and one preset with it', async () => {
        const all = await callWith<{ mode: string }>('sp_rule_list', {});
        expect(all.recorder.calls).toEqual(['rule.list:-']);
        expect(all.result.mode).toBe('layered');

        const preset = await callWith<{ mode: string; preset: string }>('sp_rule_list', {
            preset: 'recommended-pre-check',
        });
        expect(preset.recorder.calls).toEqual(['rule.list:recommended-pre-check']);
        expect(preset.result.mode).toBe('preset');
    });

    test('sp_rule_validate defaults to the recommended preset and resolves a project file path', async () => {
        const preset = await callWith<{ kind: string; source: string }>('sp_rule_validate', {});
        expect(preset.recorder.calls).toEqual(['rule.validate:preset:recommended-pre-check']);
        expect(preset.result.kind).toBe('preset');

        const file = await callWith<{ kind: string; source: string }>('sp_rule_validate', {
            file: 'rules/sp-scope.yaml',
        });
        expect(file.recorder.calls).toEqual([`rule.validate:file:${join(tempDir, 'rules', 'sp-scope.yaml')}`]);
        expect(file.result.kind).toBe('file');
    });

    test('sp_rule_validate refuses a path outside the project as invalid_arguments', async () => {
        const { status, failures } = await callWith('sp_rule_validate', { file: '../../../etc/rules.yaml' });
        expect(status).toBe(500);
        expect(failures[0]?.payload.errorCode).toBe('invalid_arguments');
        expect(String(failures[0]?.payload.error)).toContain('must be inside the project');
    });
});

/**
 * 1445 R4 (wave C) — decision tools over `getDecisionService(config, cwd)` and
 * `readDecisionStatusReadiness(dao, …)`. The catalog is the temp project's own layer, and the
 * maker is pinned to an unregistered name through `spurConfig`, so `sp_decision_run` reaches the
 * service's maker resolution and stops there: no test ever calls a live backend.
 */
describe('1445 R4 — decision list, show, status and run', () => {
    const callWith = callToolWith;

    test('sp_decision_list filters the service list by layer', async () => {
        const project = await callWith<Array<{ id: string; layer: string }>>('sp_decision_list', {
            layer: 'project',
        });
        expect(project.result.map((entry) => entry.id)).toEqual([DECISION_ID]);
        expect(project.result[0]?.layer).toBe('project');

        const all = await callWith<Array<{ id: string; layer: string }>>('sp_decision_list', {});
        // The bundled shared catalogs are always there; the project layer joins them.
        expect(all.result.length).toBeGreaterThan(project.result.length);
        expect(all.result.some((entry) => entry.layer === 'shared')).toBe(true);
    });

    test('sp_decision_list refuses a layer outside the three-layer vocabulary', async () => {
        const { status, failures } = await callWith('sp_decision_list', { layer: 'bundled' });
        expect(status).toBe(500);
        expect(failures[0]?.payload.errorCode).toBe('invalid_arguments');
        expect(String(failures[0]?.payload.error)).toContain('must be one of');
    });

    test('sp_decision_show returns the served contract and the effective maker', async () => {
        const { result } = await callWith<Record<string, unknown>>('sp_decision_show', { id: DECISION_ID });
        expect(result).toMatchObject({
            id: DECISION_ID,
            type: 'choice',
            layer: 'project',
            fallback: 'no',
            catalog: join(tempDir, '.spur', 'decisions', 'probe.yaml'),
        });
        expect(result.effectiveMaker).toMatchObject({ name: expect.any(String), source: expect.any(String) });
    });

    test('sp_decision_show refuses an unknown id instead of returning a partial description', async () => {
        const { status, failures } = await callWith('sp_decision_show', { id: 'no-such-decision' });
        expect(status).toBe(500);
        expect(String(failures[0]?.payload.error)).toContain('Unknown decision "no-such-decision"');
    });

    test('sp_decision_status reports readiness from the ledger and never probes a maker', async () => {
        const { recorder, result } = await callWith<Record<string, unknown>>('sp_decision_status', {});
        // The overlay's ledger reads prove the dao seam; `probes` absent proves no liveness ask.
        expect(recorder.calls).toContain('dao.decisionSummary');
        expect(recorder.calls).toContain('dao.decisionOutcomePairs');
        expect('probes' in result).toBe(false);
        const perDecision = result.perDecision as Array<{ id: string; maker: string; evidence: unknown }>;
        const own = perDecision.find((row) => row.id === DECISION_ID);
        expect(own?.evidence).toEqual({ recorded: 0, accepted: 0, lastSeen: null });
        expect(Array.isArray(result.makers)).toBe(true);
        expect(result.ok).toBe(true);
    });

    test('sp_decision_run forwards params and inline evidence to the service maker resolution', async () => {
        const { status, failures } = await callWith(
            'sp_decision_run',
            { id: DECISION_ID, params: { note: 'yes please' }, evidence: 'inline evidence text' },
            // Pin an unregistered maker: the run stops at maker resolution, so no test calls a backend.
            { spurConfig: { decisions: { maker: 'no-such-maker' } } },
        );
        expect(status).toBe(500);
        expect(failures[0]?.payload.errorCode).toBe('tool_error');
        expect(String(failures[0]?.payload.error)).toContain(`maker "no-such-maker" for decision "${DECISION_ID}"`);
    });

    test('sp_decision_run refuses an evidencePath argument as invalid_arguments', async () => {
        const { status, failures } = await callWith('sp_decision_run', {
            id: DECISION_ID,
            evidencePath: 'evidence.json',
        });
        expect(status).toBe(500);
        expect(failures[0]?.payload.errorCode).toBe('invalid_arguments');
        expect(String(failures[0]?.payload.error)).toContain('unknown argument "evidencePath"');
    });
});

/**
 * 1445 R5 (wave C) — coordination, message and builder tools. Every call goes through the
 * context accessors (`coordination()`, `inbox()`); the builder tools are read-only, so the
 * assertion is that they return data and leave the working tree untouched.
 */
describe('1445 R5 — agent, message and builder tools', () => {
    const callWith = callToolWith;

    test('sp_agent_status returns the roster and the fleet bindings from coordination()', async () => {
        const { recorder, result } = await callWith<{
            agents: Array<{ id: string; name: string; type: string; executor: string }>;
            members: Array<{ instanceId: string; localId: string; executor: string; enabled: boolean }>;
        }>('sp_agent_status', {});
        expect(recorder.calls).toEqual(['coordination.listAgentSpecs', 'coordination.listFleetMembers']);
        expect(result.agents).toEqual([{ id: 'proj-worker', name: 'worker', type: 'claude', executor: 'claude' }]);
        expect(result.members).toEqual([
            { instanceId: 'proj-worker', localId: 'worker', executor: 'claude', enabled: true },
        ]);
    });

    test('a message round-trips send → inbox → reply through ctx.inbox()', async () => {
        const { app, recorder } = makeHarness({ enabled: true, authEnv: 'SPUR_MCP_TOKEN' });
        const call = async (name: string, args: Record<string, unknown>): Promise<unknown> => {
            const res = await post(app, {
                token: TOKEN,
                body: { jsonrpc: '2.0', id: 1, method: 'tools/call', params: { name, arguments: args } },
            });
            return ((await jsonOf(res)) as { result: unknown }).result;
        };

        const sent = (await call('sp_message_send', { to: 'worker', from: 'operator', body: 'ping' })) as {
            message: { id: string; toId: string; body: string };
            replayed: boolean;
        };
        expect(sent.message).toMatchObject({ toId: 'worker', body: 'ping' });
        expect(sent.replayed).toBe(false);

        const inboxPage = (await call('sp_message_inbox', { member: 'worker' })) as {
            messages: Array<{ id: string; body: string }>;
            nextCursor: string | null;
        };
        expect(inboxPage.messages.map((message) => message.id)).toEqual([sent.message.id]);
        expect(inboxPage.nextCursor).toBeNull();

        const reply = (await call('sp_message_reply', { messageId: sent.message.id, body: 'pong' })) as {
            toId: string;
            body: string;
            inReplyTo: string;
        };
        expect(reply).toMatchObject({ toId: 'operator', body: 'pong', inReplyTo: sent.message.id });

        const requests = (await call('sp_message_inbox', { member: 'worker', mode: 'requests' })) as unknown[];
        expect(Array.isArray(requests)).toBe(true);
        expect(recorder.calls).toEqual([
            'inbox.send:operator->worker:ping',
            'inbox.list:worker:in',
            'inbox.get:msg_1',
            'inbox.reply:msg_1:worker:pong',
            'inbox.requests:worker',
        ]);
    });

    test('sp_message_reply refuses an unknown message instead of writing an orphan reply', async () => {
        const { failures } = await callWith('sp_message_reply', { messageId: 'msg_missing', body: 'pong' });
        expect(String(failures[0]?.payload.error)).toContain('message msg_missing not found');
    });

    test('sp_message_inbox refuses mode list without a member', async () => {
        const { status, failures } = await callWith('sp_message_inbox', { mode: 'list' });
        expect(status).toBe(500);
        expect(failures[0]?.payload.errorCode).toBe('invalid_arguments');
        expect(String(failures[0]?.payload.error)).toContain('requires member');
    });

    test('sp_builder_check_deps reports findings without writing a file', async () => {
        const before = readdirSync(tempDir).sort();
        const { result } = await callWith<unknown[]>('sp_builder_check_deps', {});
        // No `builder.dependencyScope` in the temp project: the check has nothing in scope.
        expect(result).toEqual([]);
        expect(readdirSync(tempDir).sort()).toEqual(before);
    });

    test('sp_builder_show_branches reports the topology without writing a file', async () => {
        const before = readdirSync(tempDir).sort();
        // The handler reads git through the context env, so this harness keeps PATH.
        const { app } = makeHarness(
            { enabled: true, authEnv: 'SPUR_MCP_TOKEN' },
            { SPUR_MCP_TOKEN: TOKEN, PATH: getEnvVars().PATH ?? '' },
        );
        const res = await post(app, {
            token: TOKEN,
            body: {
                jsonrpc: '2.0',
                id: 1,
                method: 'tools/call',
                params: { name: 'sp_builder_show_branches', arguments: {} },
            },
        });
        const result = ((await jsonOf(res)) as { result: { base: string; branches: Array<{ name: string }> } }).result;
        expect(result.base).toBe('main');
        expect(result.branches.map((branch) => branch.name)).toEqual(['main']);
        expect(readdirSync(tempDir).sort()).toEqual(before);
    });
});

/**
 * 1445 R6 (wave C) — the read-only self tools: status (no gateway-daemon probe), search, and
 * action resolution. `sp_self_actions` must never start a child process, which the spawn patch
 * below asserts directly.
 */
describe('1445 R6 — self status, search and actions', () => {
    const callWith = callToolWith;

    test('sp_self_status reports the aggregate with no gateway-daemon section', async () => {
        const { result } = await callWith<{ ok: boolean; sections: Record<string, unknown> }>('sp_self_status', {});
        expect(typeof result.ok).toBe('boolean');
        expect(result.sections.configuration).toBeDefined();
        // The daemon probe is CLI-local (`readDaemonStatusOrNull`); the server never reports it.
        expect('daemon' in result).toBe(false);
    });

    test('sp_self_search returns hits for an inline query', async () => {
        writeFileSync(join(tempDir, 'search-fixture.md'), '# fixture\nTOOL_DESCRIPTORS marker\n');
        const { result } = await callWith<{
            query: string;
            groups: { exact: Array<{ path: string }> | null };
        }>('sp_self_search', { query: 'TOOL_DESCRIPTORS', mode: 'exact' });
        expect(result.query).toBe('TOOL_DESCRIPTORS');
        expect(result.groups.exact?.map((hit) => hit.path)).toContain('search-fixture.md');
    });

    test('sp_self_search refuses a missing query without status', async () => {
        const { status, failures } = await callWith('sp_self_search', { mode: 'exact' });
        expect(status).toBe(500);
        expect(failures[0]?.payload.errorCode).toBe('invalid_arguments');
        expect(String(failures[0]?.payload.error)).toContain('requires query');
    });

    test('sp_self_search status reports backend readiness instead of results', async () => {
        const { result } = await callWith<{ rg: { available: boolean }; zg: { available: boolean } }>(
            'sp_self_search',
            { status: true },
        );
        expect(typeof result.rg.available).toBe('boolean');
        expect(typeof result.zg.available).toBe('boolean');
    });

    test('sp_self_actions lists every action and resolves one command without running it', async () => {
        const realSpawn = Bun.spawn;
        const spawned: unknown[] = [];
        Bun.spawn = ((...args: unknown[]) => {
            spawned.push(args[0]);
            throw new Error('sp_self_actions must never start a child process');
        }) as unknown as typeof Bun.spawn;
        try {
            const listed = await callWith<Array<{ name: string; kind: string }>>('sp_self_actions', {});
            expect(listed.result.some((action) => action.name === 'lint')).toBe(true);

            const resolved = await callWith<{
                name: string;
                reserved: boolean;
                source: string;
                kind: string;
                command: string;
            }>('sp_self_actions', { name: 'lint' });
            expect(resolved.result).toEqual({
                name: 'lint',
                reserved: true,
                source: 'preset',
                kind: 'command',
                command: 'bun run lint',
            });

            const unbound = await callWith<{ kind: string; source: string }>('sp_self_actions', {
                name: 'no-such-action',
            });
            expect(unbound.result).toMatchObject({ kind: 'unbound', source: 'unbound' });
        } finally {
            Bun.spawn = realSpawn;
        }
        expect(spawned).toEqual([]);
    });
});

/**
 * 1446 R1 — every tool-call event names what the tool is (`origin`), how it reaches state
 * (`access`), which hop delivered the request (`via`), and who claimed to call it (`actor`).
 * `origin`/`access`/`via` are always present; `actor` is omitted when unknown so the ledger's
 * own actor column stays null.
 */
describe('1446 R1 — tool-call events carry origin, access, via and actor', () => {
    function payloadOf(
        events: Array<{ name: string; payload: Record<string, unknown> }>,
        name: string,
    ): Record<string, unknown> | undefined {
        return events.find((entry) => entry.name === name)?.payload;
    }

    function callTool(
        app: Hono,
        name: string,
        args: Record<string, unknown>,
        headers: Record<string, string>,
    ): Promise<Response> {
        return post(app, {
            token: TOKEN,
            headers,
            body: { jsonrpc: '2.0', id: 1, method: 'tools/call', params: { name, arguments: args } },
        });
    }

    test('a built-in read tool over the stdio bridge records stdio and the client actor', async () => {
        const { app, events } = makeHarness({ enabled: true, authEnv: 'SPUR_MCP_TOKEN' });

        const res = await callTool(
            app,
            'sp_task_show',
            { wbs: '1372' },
            {
                'X-Spur-Mcp-Via': 'stdio',
                'X-Spur-Actor': 'claude-code',
            },
        );

        expect(res.status).toBe(200);
        expect(payloadOf(events, 'mcp.tool.called')).toMatchObject({
            tool: 'sp_task_show',
            origin: 'built-in',
            access: 'read',
            via: 'stdio',
            actor: 'claude-code',
        });
    });

    test('an invalid actor is dropped, not stored', async () => {
        const { app, events } = makeHarness({ enabled: true, authEnv: 'SPUR_MCP_TOKEN' });

        // CR/LF never reaches this point (fetch refuses such a header value), so the charset and
        // length bounds are what the sanitizer must actually hold.
        const res = await callTool(app, 'sp_task_show', { wbs: '1372' }, { 'X-Spur-Actor': 'bad actor!' });

        expect(res.status).toBe(200);
        const payload = payloadOf(events, 'mcp.tool.called');
        expect(payload?.via).toBe('direct');
        expect('actor' in (payload ?? {})).toBe(false);
    });

    test('an unknown via value falls back to direct', async () => {
        const { app, events } = makeHarness({ enabled: true, authEnv: 'SPUR_MCP_TOKEN' });

        await callTool(app, 'sp_task_show', { wbs: '1372' }, { 'X-Spur-Mcp-Via': 'carrier-pigeon' });

        expect(payloadOf(events, 'mcp.tool.called')?.via).toBe('direct');
    });

    test('an unknown tool records origin unknown and no access', async () => {
        const { app, events } = makeHarness({ enabled: true, authEnv: 'SPUR_MCP_TOKEN' });

        const res = await callTool(app, 'task_delete', {}, {});

        expect(res.status).toBe(500);
        const payload = payloadOf(events, 'mcp.tool.failed');
        expect(payload).toMatchObject({ tool: 'task_delete', origin: 'unknown', errorCode: 'unknown_tool' });
        expect('access' in (payload ?? {})).toBe(false);
    });

    test('a workflow tool with no headers records workflow origin, write access and no actor', async () => {
        const root = mkdtempSync(join(tmpdir(), 'spur-mcp-wf-1446-'));
        mkdirSync(join(root, '.spur', 'workflows'), { recursive: true });
        writeFileSync(
            join(root, '.spur', 'workflows', 'daily-report.yaml'),
            `name: daily-report
kind: state-machine
metadata:
  mcp:
    expose: true
vars:
  target: default
initialState: start
states:
  - id: start
  - id: done
transitions:
  - from: start
    to: done
    guard: { kind: always }
terminalStates:
  - done
`,
        );
        const events: Array<{ name: string; payload: Record<string, unknown> }> = [];
        const recorder = makeRecorder();
        const app = new Hono();
        mcpModule.mount(app, {
            cwd: root,
            fs: createNodeFileSystem(),
            env: { SPUR_MCP_TOKEN: TOKEN },
            logger: { debug: () => {}, info: () => {}, warn: () => {}, error: () => {} },
            bootConfig: () => ({ mcp: { enabled: true, authEnv: 'SPUR_MCP_TOKEN', namespace: 'ops' } }),
            taskService: recorder.taskService,
            featureService: recorder.featureService,
            workflowService: recorder.workflowService,
            eventBus: () => ({
                emit: (name: string, payload: Record<string, unknown>) => {
                    events.push({ name, payload });
                },
            }),
        } as unknown as ServerContext);
        try {
            const res = await callTool(app, 'ops_daily_report', { target: 'weekly' }, {});

            expect(res.status).toBe(200);
            expect(payloadOf(events, 'mcp.tool.called')).toMatchObject({
                origin: 'workflow',
                access: 'write',
                via: 'direct',
            });
            expect('actor' in (payloadOf(events, 'mcp.tool.called') ?? {})).toBe(false);
        } finally {
            rmSync(root, { recursive: true, force: true });
        }
    });
});

/**
 * 1446 R2 — one lifecycle event per protocol request, keyed on the method the client sent
 * (`server/discover` lists tools AND resources, so a per-list-method emission would double count).
 * A status read (`catalog()`) is not protocol traffic and records nothing.
 */
describe('1446 R2 — discovery and catalog requests emit one lifecycle event each', () => {
    function named(
        events: Array<{ name: string; payload: Record<string, unknown> }>,
        name: string,
    ): Array<Record<string, unknown>> {
        return events.filter((entry) => entry.name === name).map((entry) => entry.payload);
    }

    test('each method emits exactly one event, and the tool counts match the catalog', async () => {
        const { app, events } = makeHarness({ enabled: true, authEnv: 'SPUR_MCP_TOKEN' });

        expect((await post(app, { token: TOKEN })).status).toBe(200);
        expect(
            (
                await post(app, {
                    token: TOKEN,
                    body: { jsonrpc: '2.0', id: 2, method: 'tools/list' },
                })
            ).status,
        ).toBe(200);
        expect(
            (
                await post(app, {
                    token: TOKEN,
                    body: { jsonrpc: '2.0', id: 3, method: 'resources/list' },
                })
            ).status,
        ).toBe(200);

        const discovered = named(events, 'mcp.server.discovered');
        const listed = named(events, 'mcp.tools.listed');
        const resources = named(events, 'mcp.resources.listed');
        expect(discovered.length).toBe(1);
        expect(listed.length).toBe(1);
        expect(resources.length).toBe(1);

        expect(discovered[0]).toMatchObject({ via: 'direct' });
        expect(typeof discovered[0]?.durationMs).toBe('number');
        // The temp project exposes no workflows, so every advertised tool is a built-in.
        expect(listed[0]).toMatchObject({
            toolCount: BUILTIN_TOOL_NAMES.length,
            builtinCount: BUILTIN_TOOL_NAMES.length,
            workflowCount: 0,
            via: 'direct',
        });
        expect(resources[0]).toMatchObject({ resourceCount: 3, via: 'direct' });
    });

    test('the lifecycle events carry the request transport identity', async () => {
        const { app, events } = makeHarness({ enabled: true, authEnv: 'SPUR_MCP_TOKEN' });

        await post(app, {
            token: TOKEN,
            headers: { 'X-Spur-Mcp-Via': 'gateway', 'X-Spur-Actor': 'codex' },
            body: { jsonrpc: '2.0', id: 1, method: 'tools/list' },
        });

        expect(named(events, 'mcp.tools.listed')[0]).toMatchObject({ via: 'gateway', actor: 'codex' });
    });

    test('a catalog() status read emits nothing', async () => {
        const { ctx, events } = makeHarness({ enabled: true, authEnv: 'SPUR_MCP_TOKEN' });

        const catalog = await readMcpCatalog(ctx);

        expect(catalog.tools.length).toBe(BUILTIN_TOOL_NAMES.length);
        expect(events).toEqual([]);
    });

    test('the three catalog entries are diagnostic tier and metadata-only', () => {
        for (const name of ['mcp.server.discovered', 'mcp.tools.listed', 'mcp.resources.listed']) {
            const entry = SYSTEM_EVENT_CATALOG.find((candidate) => candidate.name === name);
            expect(entry, name).toBeDefined();
            expect(entry?.tier, name).toBe('diagnostic');
            expect(entry?.payloadPolicy, name).toBe('metadata-only');
        }
    });
});

describe('1447 — manifest tools, typed workflow params, and sp dogfood', () => {
    function makeProjectDir(): string {
        const dir = mkdtempSync(join(tmpdir(), 'spur-mcp-1447-'));
        mkdirSync(join(dir, 'plugins', 'zz'), { recursive: true });
        writeFileSync(join(dir, 'plugins', 'zz', 'plugin.json'), JSON.stringify({ name: 'zz' }));
        return dir;
    }

    test('AC1 & AC3: lists manifest tool with typed schema and executes via stub executor without shell', async () => {
        const dir = makeProjectDir();
        try {
            writeFileSync(
                join(dir, 'plugins', 'zz', 'mcp-tools.yaml'),
                `schema_version: 1
tools:
  - name: echo
    description: Echo message
    annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true }
    params:
      msg: { type: string, required: true, description: Message }
      loud: { type: boolean }
    command: [printf, "%s"]
    args:
      msg: ["{value}"]
      loud: ["--loud"]
    output: text
`,
            );
            const spawned: Array<{ command: string; args?: string[]; cwd?: string }> = [];
            const { app, events, ctx } = makeHarness(
                { enabled: true, authEnv: 'SPUR_MCP_TOKEN' },
                { SPUR_MCP_TOKEN: TOKEN },
                null,
                {
                    cwd: dir,
                    processExecutor: () => ({
                        run: async (opts: { command: string; args?: string[]; cwd?: string }) => {
                            spawned.push(opts);
                            return {
                                command: opts.command,
                                args: opts.args ?? [],
                                exitCode: 0,
                                stdout: 'ok-out',
                                stderr: '',
                                durationMs: 1,
                                outcome: 'exit',
                            };
                        },
                    }),
                },
            );

            const catalog = await readMcpCatalog(ctx);
            expect(catalog.exposureIssues).toEqual([]);
            expect(catalog.manifestToolNames).toContain('zz_echo');
            const echoDesc = catalog.tools.find((t) => t.name === 'zz_echo');
            expect(echoDesc).toMatchObject({
                name: 'zz_echo',
                annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true },
                inputSchema: {
                    type: 'object',
                    properties: { msg: { type: 'string', description: 'Message' }, loud: { type: 'boolean' } },
                    required: ['msg'],
                    additionalProperties: false,
                },
            });

            const callRes = await post(app, {
                token: TOKEN,
                body: {
                    jsonrpc: '2.0',
                    id: 1,
                    method: 'tools/call',
                    params: { name: 'zz_echo', arguments: { msg: 'a; rm -rf ~ $(id)', loud: false } },
                },
            });
            expect(callRes.status).toBe(200);
            const body = (await callRes.json()) as { result: { stdout: string } };
            expect(body.result).toEqual({ stdout: 'ok-out' });
            expect(spawned).toHaveLength(1);
            expect(spawned[0]?.command).toBe('printf');
            expect(spawned[0]?.args).toEqual(['%s', 'a; rm -rf ~ $(id)']);

            const called = events.find((e) => e.name === 'mcp.tool.called');
            expect(called?.payload).toMatchObject({ tool: 'zz_echo', origin: 'manifest', access: 'read' });

            // Option-injection guard refuses before spawn
            const badRes = await post(app, {
                token: TOKEN,
                body: {
                    jsonrpc: '2.0',
                    id: 2,
                    method: 'tools/call',
                    params: { name: 'zz_echo', arguments: { msg: '--evil' } },
                },
            });
            expect(badRes.status).toBe(500);
            const badBody = (await badRes.json()) as { error: { errorCode?: string } };
            expect(badBody.error.errorCode).toBe('invalid_arguments');
            expect(spawned).toHaveLength(1);
        } finally {
            rmSync(dir, { recursive: true, force: true });
        }
    });

    test('AC4: real-process JSON output, non-zero exit with stderr tail, timeout, and authEnv blanking', async () => {
        const dir = makeProjectDir();
        const runtimeEnv = getEnvVars() as Record<string, string | undefined>;
        const prevSecret = runtimeEnv.SPUR_TEST_MANIFEST_SECRET;
        runtimeEnv.SPUR_TEST_MANIFEST_SECRET = 'super-secret-value';
        try {
            writeFileSync(
                join(dir, 'plugins', 'zz', 'mcp-tools.yaml'),
                `schema_version: 1
tools:
  - name: json_ok
    description: Prints JSON
    annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true }
    command: [bun, -e, "console.log(JSON.stringify({ ok: true, count: 2 }))"]
    output: json
  - name: fail_cmd
    description: Exits 3 with stderr
    annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true }
    command: [bun, -e, "console.error('boom-stderr-tail'); process.exit(3)"]
    output: text
  - name: slow_cmd
    description: Times out
    annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true }
    command: [bun, -e, "setTimeout(() => {}, 5000)"]
    output: text
    timeoutMs: 1000
  - name: env_check
    description: Prints authEnv
    annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true }
    command: [bun, -e, "const k='env'; process.stdout.write((globalThis.process[k].SPUR_TEST_MANIFEST_SECRET) ?? '')"]
    output: text
`,
            );
            const { app } = makeHarness(
                { enabled: true, authEnv: 'SPUR_TEST_MANIFEST_SECRET' },
                { SPUR_TEST_MANIFEST_SECRET: 'super-secret-value' },
                null,
                { cwd: dir },
            );

            const okRes = await post(app, {
                token: 'super-secret-value',
                body: { jsonrpc: '2.0', id: 1, method: 'tools/call', params: { name: 'zz_json_ok', arguments: {} } },
            });
            expect(okRes.status).toBe(200);
            expect(((await okRes.json()) as { result: unknown }).result).toEqual({ ok: true, count: 2 });

            const failRes = await post(app, {
                token: 'super-secret-value',
                body: { jsonrpc: '2.0', id: 2, method: 'tools/call', params: { name: 'zz_fail_cmd', arguments: {} } },
            });
            expect(failRes.status).toBe(500);
            const failBody = (await failRes.json()) as { error: { message: string } };
            expect(failBody.error.message).toContain('exited 3');
            expect(failBody.error.message).toContain('boom-stderr-tail');

            const slowRes = await post(app, {
                token: 'super-secret-value',
                body: { jsonrpc: '2.0', id: 3, method: 'tools/call', params: { name: 'zz_slow_cmd', arguments: {} } },
            });
            expect(slowRes.status).toBe(500);
            const slowBody = (await slowRes.json()) as { error: { message: string } };
            expect(slowBody.error.message).toContain('timed out');

            const envRes = await post(app, {
                token: 'super-secret-value',
                body: {
                    jsonrpc: '2.0',
                    id: 4,
                    method: 'tools/call',
                    params: { name: 'zz_env_check', arguments: {} },
                },
            });
            expect(envRes.status).toBe(200);
            expect(((await envRes.json()) as { result: { stdout: string } }).result).toEqual({ stdout: '' });
        } finally {
            if (prevSecret === undefined) delete runtimeEnv.SPUR_TEST_MANIFEST_SECRET;
            else runtimeEnv.SPUR_TEST_MANIFEST_SECRET = prevSecret;
            rmSync(dir, { recursive: true, force: true });
        }
    });

    test('AC5: typed workflow call validates enum/allowlist and stringifies booleans for WorkflowService.run', async () => {
        const dir = makeProjectDir();
        try {
            mkdirSync(join(dir, '.spur', 'workflows'), { recursive: true });
            writeFileSync(
                join(dir, '.spur', 'workflows', 'typed.yaml'),
                `name: typed-run
description: Typed workflow
kind: state-machine
metadata:
  mcp:
    expose: true
    params:
      mode: { type: string, enum: [daily, ad-hoc], required: true }
      recompute: { type: boolean }
vars:
  mode: daily
  recompute: "false"
  spurBin: spur
initialState: start
states:
  - id: start
terminalStates:
  - start
`,
            );
            const { app, recorder } = makeHarness(
                { enabled: true, authEnv: 'SPUR_MCP_TOKEN' },
                { SPUR_MCP_TOKEN: TOKEN },
                null,
                { cwd: dir },
            );

            const okRes = await post(app, {
                token: TOKEN,
                body: {
                    jsonrpc: '2.0',
                    id: 1,
                    method: 'tools/call',
                    params: { name: 'zz_typed_run', arguments: { mode: 'daily', recompute: true } },
                },
            });
            expect(okRes.status).toBe(200);
            expect(recorder.calls.some((c) => c.includes('"recompute":"true"') && c.includes('"mode":"daily"'))).toBe(
                true,
            );

            const badEnum = await post(app, {
                token: TOKEN,
                body: {
                    jsonrpc: '2.0',
                    id: 2,
                    method: 'tools/call',
                    params: { name: 'zz_typed_run', arguments: { mode: 'weekly' } },
                },
            });
            expect(badEnum.status).toBe(500);
            expect(((await badEnum.json()) as { error: { errorCode?: string } }).error.errorCode).toBe(
                'invalid_arguments',
            );

            const undeclared = await post(app, {
                token: TOKEN,
                body: {
                    jsonrpc: '2.0',
                    id: 3,
                    method: 'tools/call',
                    params: { name: 'zz_typed_run', arguments: { mode: 'daily', spurBin: '/evil' } },
                },
            });
            expect(undeclared.status).toBe(500);
            expect(((await undeclared.json()) as { error: { errorCode?: string } }).error.errorCode).toBe(
                'invalid_arguments',
            );
        } finally {
            rmSync(dir, { recursive: true, force: true });
        }
    });

    test('AC7: repo-root inventory exposes sp_plugin_smoke and sp_history_anatomy with no exposure issues', async () => {
        const repoRoot = join(import.meta.dir, '../../../..');
        const { ctx } = makeHarness({ enabled: true, authEnv: 'SPUR_MCP_TOKEN' }, { SPUR_MCP_TOKEN: TOKEN }, null, {
            cwd: repoRoot,
        });
        const catalog = await readMcpCatalog(ctx);
        expect(catalog.exposureIssues).toEqual([]);
        const smoke = catalog.tools.find((t) => t.name === 'sp_plugin_smoke');
        expect(smoke).toBeDefined();
        expect(smoke?.annotations?.readOnlyHint).toBe(true);
        expect(catalog.manifestToolNames).toContain('sp_plugin_smoke');

        const anatomy = catalog.tools.find((t) => t.name === 'sp_history_anatomy');
        expect(anatomy).toBeDefined();
        const props = (anatomy?.inputSchema as { properties?: Record<string, unknown> })?.properties ?? {};
        expect(props.mode).toMatchObject({ type: 'string', enum: ['daily', 'ad-hoc'] });
        expect(props.recompute).toMatchObject({ type: 'boolean' });
        expect(props.output).toBeUndefined();
        expect(props.spurBin).toBeUndefined();
    });
});
