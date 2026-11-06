import { describe, expect, test } from 'bun:test';
import { chmodSync, existsSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createMigratedDb } from '@gobing-ai/spur-domain';
import type { ActionRunContext } from '@gobing-ai/ts-dual-workflow-engine';
import type { AgentExecutionOptions } from '../../../src/observability/agent-execution';
import type { AgentRunDeps } from '../../../src/services/agent-service';
import type { FleetDispatchRequest } from '../../../src/services/fleet-dispatcher';
import type { FleetService } from '../../../src/services/fleet-service';
import { AgentRunActionRunner, type WorkflowAgentService } from '../../../src/workflow/actions/agent-run';
import type { FleetDispatchDeps } from '../../../src/workflow/fleet-dispatch';
import { runFleetWorkItem } from '../../../src/workflow/fleet-work-item';

/**
 * Admission matrix (1305): characterize existing guarantees BEFORE extraction.
 *
 * Policy                     Host                  Fleet                         Subprocess
 * session/role/input shape    common guard          common guard                  common guard
 * blank prompt               reject                reject                        accepted legacy prompt
 * timeout                    host pause            positive before enqueue       positive before spawn
 * stale expectFile           delete before pause   delete before enqueue/member  delete before spawn
 * stale expectFiles[]        delete before pause   metadata only                 metadata only
 * capability/budget shape    host pause            delegated member validation   native validation
 * unsupported capability     host pause            member fails before spawn     fail before spawn
 * P1 reviewer identity       host pause            actual member attempt         actual subprocess attempt
 * exhausted usage budget     host pause            member fails after execution  fail after execution
 * executor pin               common availability   declared member identity      pinned executor identity
 *
 * Failure modes: broadening host controls, accepting stale proof, moving native rejection
 * after deletion/spawn, losing the member contract, or checking the parent pin as reviewer.
 * Only process/transport boundaries are faked; fleet envelopes, member contracts, receipts,
 * file freshness, independence and budget evaluators are real in throwaway projects.
 */
const surfaces = ['host', 'fleet', 'subprocess'] as const;
type Surface = (typeof surfaces)[number];

async function fixture(surface: Surface, options: Record<string, unknown> = {}, vars: Record<string, string> = {}) {
    const cwd = mkdtempSync(join(tmpdir(), 'spur-1305-admission-'));
    const calls: Record<string, string | boolean>[] = [];
    const requests: FleetDispatchRequest[] = [];
    const absentAtSpawn: boolean[] = [];
    const service: WorkflowAgentService = {
        executorAvailability: async () => undefined,
        resolveRoleFresh: async () => ({ ok: true, agent: 'claude', source: 'role' }),
        resolve: async () => ({ ok: true, agent: 'gemini', source: 'role' }),
        runTraced: async (
            _input: string | undefined,
            flags: Record<string, string | boolean>,
            _deps?: AgentRunDeps,
            execution?: AgentExecutionOptions,
        ) => {
            await execution?.beforeDispatch?.({ agent: 'claude', executor: String(flags.agent ?? 'claude') });
            absentAtSpawn.push(!existsSync(join(cwd, 'proof.txt')));
            calls.push(flags);
            writeFileSync(join(cwd, 'proof.txt'), 'fresh');
            return {
                exitCode: 0,
                stdout: 'done',
                usage: { availability: 'measured', inputTokens: 50, outputTokens: 50 },
                invocation: {
                    agent: 'claude',
                    executor: String(flags.agent ?? 'claude'),
                    source: 'default',
                    command: 'claude',
                    argv: [],
                    cwd,
                    mode: 'text',
                    outputMode: 'buffered',
                    continue: false,
                    stdinInteractive: false,
                },
            };
        },
    };
    const deps: FleetDispatchDeps = {
        fleet: {
            load: async () => ({ enabled: true, strategy: 'rest', members: [] }),
            resolve: async () => ({
                projectPath: cwd,
                enabled: true,
                missing: [],
                members: [{ instanceId: 'member-1', executor: 'claude', role: options.role ?? 'coder', enabled: true }],
            }),
        } as unknown as FleetService,
        dispatcher: {
            enqueue: async (request) => {
                requests.push(request);
                return { messageId: 'message-1', replayed: false };
            },
            awaitReceipt: async () => {
                const envelope = join(cwd, '.spur/run/parent/prompts/stage.execution.json');
                if (existsSync(envelope)) {
                    const db = await createMigratedDb({ url: ':memory:' });
                    await runFleetWorkItem({
                        cwd,
                        recipient: 'member-1',
                        key: 'parent/stage',
                        messageId: 'message-1',
                        flags: { agent: 'claude', 'run-id': 'child' },
                        service,
                        getDb: async () => db,
                    });
                } else {
                    absentAtSpawn.push(!existsSync(join(cwd, 'proof.txt')));
                    writeFileSync(join(cwd, 'proof.txt'), 'fresh');
                }
                return { status: 'completed', messageId: 'message-1', runId: 'child' };
            },
        },
        now: () => 1,
    };
    const context: ActionRunContext = {
        runId: 'parent',
        stateOrNodeId: 'stage',
        workdir: cwd,
        env: {},
        vars: { ...(surface === 'subprocess' ? {} : { executor: surface }), ...vars },
    };
    const runner = new AgentRunActionRunner(service, undefined, undefined, {}, deps);
    return {
        cwd,
        calls,
        requests,
        absentAtSpawn,
        run: () => runner.execute({ role: 'coder', input: 'work', ...options }, context),
    };
}

describe('1305 admission matrix across existing executors', () => {
    for (const surface of surfaces) {
        for (const row of [
            { name: 'invalid session', options: { session: 'unsafe' }, error: "session must be 'reuse' or 'fresh'" },
            { name: 'unknown role', options: { role: 'operator' }, error: 'Layer-1 role' },
            { name: 'missing role', options: { role: null }, error: 'Layer-1 role' },
            { name: 'missing input', options: { input: null }, error: 'input is required' },
        ]) {
            test(`${surface}: rejects ${row.name} before any dispatch`, async () => {
                const f = await fixture(surface, row.options);
                const result = await f.run();
                expect(result.ok).toBe(false);
                expect(result.error).toContain(row.error);
                expect(f.calls).toHaveLength(0);
                expect(f.requests).toHaveLength(0);
            });
        }

        test(`${surface}: preserves blank-prompt admission semantics`, async () => {
            const f = await fixture(surface, { input: '   ' });
            const result = await f.run();
            expect(result.ok).toBe(surface === 'subprocess');
            expect(f.calls).toHaveLength(surface === 'subprocess' ? 1 : 0);
            expect(f.requests).toHaveLength(0);
            if (surface !== 'subprocess') {
                expect(result.error).toContain(`agent.run: ${surface} dispatch requires an input prompt`);
            }
        });

        test(`${surface}: removes stale singular proof at its existing boundary`, async () => {
            const f = await fixture(surface, { expectFile: 'proof.txt' });
            writeFileSync(join(f.cwd, 'proof.txt'), 'stale');
            const result = await f.run();
            expect(result.ok).toBe(true);
            if (surface === 'host') {
                expect(result.pause).toBe(true);
                expect(f.calls).toHaveLength(0);
                expect(f.requests).toHaveLength(0);
                expect(existsSync(join(f.cwd, 'proof.txt'))).toBe(false);
            } else {
                expect(f.absentAtSpawn).toEqual([true]);
                expect(readFileSync(join(f.cwd, 'proof.txt'), 'utf8')).toBe('fresh');
            }
        });

        test(`${surface}: stale-proof removal failure stops before dispatch`, async () => {
            const f = await fixture(surface, { expectFile: 'proof.txt' });
            writeFileSync(join(f.cwd, 'proof.txt'), 'stale');
            chmodSync(f.cwd, 0o555);
            try {
                const result = await f.run();
                expect(result.ok).toBe(false);
                expect(result.error).toContain('exists from a previous run and could not be removed');
                expect(f.calls).toHaveLength(0);
                expect(f.requests).toHaveLength(0);
            } finally {
                chmodSync(f.cwd, 0o755);
            }
        });

        for (const row of [
            { name: 'invalid capability vocabulary', options: { requiresCapabilities: { invented: 'enforced' } } },
            { name: 'unsupported native capability', options: { requiresCapabilities: { resumeById: 'enforced' } } },
            { name: 'invalid budget shape', options: { maxTokens: -1 } },
            { name: 'exhausted usage budget', options: { maxTokens: 1 }, spawns: true },
            {
                name: 'same P1 reviewer identity',
                options: { role: 'reviewer', priority: 'P1' },
                vars: { __agentRouting_implement: '{"agent":"claude"}' },
            },
            { name: 'missing P1 reviewer identity', options: { role: 'reviewer', priority: 'P1' } },
        ]) {
            test(`${surface}: preserves policy boundary for ${row.name}`, async () => {
                const f = await fixture(surface, row.options, row.vars);
                const result = await f.run();
                expect(result.ok).toBe(surface === 'host');
                expect(f.calls).toHaveLength(surface !== 'host' && row.spawns ? 1 : 0);
                expect(f.requests).toHaveLength(surface === 'fleet' ? 1 : 0);
                if (surface === 'host') expect(result.pause).toBe(true);
                else if (surface === 'fleet') expect(result.error).toContain('contract failed');
                else expect(result.error).toBeString();
            });
        }

        test(`${surface}: keeps timeout validation after the host pause boundary`, async () => {
            const f = await fixture(surface, { timeoutMs: '0', expectFile: 'proof.txt' });
            writeFileSync(join(f.cwd, 'proof.txt'), 'stale');
            const result = await f.run();
            expect(result.ok).toBe(surface === 'host');
            expect(existsSync(join(f.cwd, 'proof.txt'))).toBe(surface !== 'host');
            expect(f.calls).toHaveLength(0);
            expect(f.requests).toHaveLength(0);
            if (surface !== 'host') expect(result.error).toBe('agent.run: timeoutMs must be > 0');
        });

        test(`${surface}: retains plural proof semantics and de-duplicates host declarations`, async () => {
            const f = await fixture(surface, { expectFiles: ['other.txt', 'other.txt'] });
            writeFileSync(join(f.cwd, 'other.txt'), 'stale');
            const result = await f.run();
            expect(result.ok).toBe(true);
            expect(existsSync(join(f.cwd, 'other.txt'))).toBe(surface !== 'host');
            if (surface === 'host') expect(result.data?.workItem).toMatchObject({ expectFiles: ['other.txt'] });
        });

        test(`${surface}: keeps pin identity separate from the fleet member identity`, async () => {
            const f = await fixture(
                surface,
                { session: 'reuse' },
                { '__executor.coder': '{"name":"pinned-profile","agent":"claude"}' },
            );
            const result = await f.run();
            expect(result.ok).toBe(true);
            if (surface === 'subprocess')
                expect(f.calls[0]).toMatchObject({ agent: 'pinned-profile', pinResolved: 'true' });
            if (surface === 'fleet') expect(f.calls[0]?.agent).toBe('claude');
            if (surface === 'host') expect(f.calls).toHaveLength(0);
        });
    }
});
