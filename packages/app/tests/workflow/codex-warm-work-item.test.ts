/**
 * 1278 failure-first E2E: the registered Codex driver, a real replay child, the warm dispatcher,
 * AgentService and the workflow action validator. Only process launch is redirected.
 *
 * A native `failed` or `interrupted` status must not become a successful task result, even when
 * the expected artifact was written. An unqualified version falls back once. Two successful keyed
 * tasks share one process, one native thread id and distinct native turn ids.
 */
import { expect, test } from 'bun:test';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createMigratedDb } from '@gobing-ai/spur-domain';
import { AiRunner, type TurnOutcome, type TurnSession } from '@gobing-ai/ts-ai-runner';
import { NodeProcessExecutor, type PipeProcess, type PipeProcessOptions } from '@gobing-ai/ts-runtime';
import { type AgentRunDeps, AgentService } from '../../src/services/agent-service';
import { createWarmTurnDispatcher, type TurnReceipt } from '../../src/services/warm-turn-dispatch';
import { FRESH_SESSION_ROLES } from '../../src/workflow/fleet-dispatch';
import { readFleetWorkItemResult, runFleetWorkItem, writeFleetWorkItem } from '../../src/workflow/fleet-work-item';

const THREAD = '01a1705e-c0ab-7ab1-aa00-9f3e09be957a';
const TURN_IDS = ['01a1705e-c10f-71b2-b1f3-2ef7b4570cfe', '01a1705e-d0a4-7fd2-8171-8194a14bd2e8'] as const;
const FAILED_THREAD = '01a1705e-8422-7252-9036-f4722755605a';
const FAILED_TURN = '01a1705e-8485-7af2-9257-c160a1c6bc18';
const INTERRUPTED_THREAD = '01a1705e-7c14-7252-b522-83c36a064a81';
const INTERRUPTED_TURN = '01a1705e-7c7a-7363-b409-c97aaf7275bf';

class CodexReplayExecutor extends NodeProcessExecutor {
    readonly launches: Array<{ command: string; args: string[]; pid: number | null }> = [];

    constructor(private readonly scenario: string) {
        super();
    }

    override runStreaming(options: PipeProcessOptions): PipeProcess {
        const child = super.runStreaming({
            ...options,
            command: process.execPath,
            args: [join(import.meta.dir, '../fixtures/codex-warm/replay.ts'), this.scenario],
        });
        this.launches.push({ command: options.command, args: options.args ?? [], pid: child.pid });
        return child;
    }
}

function resolutionDeps(runner: AiRunner): AgentRunDeps {
    return {
        runner,
        detector: {
            detectOne: async () => ({ name: 'codex', installed: true, version: '0.164.0', channels: [], error: null }),
        } as unknown as AgentRunDeps['detector'],
        doctorRunner: {
            runOne: async () => ({
                agent: 'codex',
                installed: true,
                version: '0.164.0',
                authenticated: 'authenticated',
                usable: true,
                tier: 1,
                channels: [],
                error: null,
            }),
        } as unknown as AgentRunDeps['doctorRunner'],
    };
}

for (const scenario of ['plain', 'missing-artifact', 'failed', 'interrupted', 'exit-after-accept', 'unqualified']) {
    test(`1278 keyed Codex work through the action contract: ${scenario}`, async () => {
        const cwd = mkdtempSync(join(tmpdir(), 'codex-warm-work-'));
        const db = await createMigratedDb({ url: ':memory:' });
        const executor = new CodexReplayExecutor(scenario);
        const runner = new AiRunner({ processExecutor: executor });
        let fallbackCalls = 0;
        runner.runPromptCommand = async () => {
            fallbackCalls++;
            writeFileSync(join(cwd, 'artifact-1.txt'), 'fallback');
            return { exitCode: 0, stdout: 'fallback', stderr: '', durationMs: 1 };
        };
        const service = new AgentService({ cwd, env: {}, output: { write: () => {}, error: () => {} } });
        const binding = { memberId: 'member-codex', ownerEpoch: 4, occupantGeneration: 9 };
        let session: TurnSession | undefined;
        let openCalls = 0;
        const outcomes: TurnOutcome[] = [];
        const receipts: TurnReceipt[] = [];
        const turn = createWarmTurnDispatcher({
            openSession: async (agent, policy) => {
                expect(agent).toBe('codex');
                openCalls++;
                return runner.openTurnSession('codex', {
                    policy,
                    binary: { path: 'codex', version: scenario === 'unqualified' ? '0.155.1' : '0.164.0' },
                    handshakeTimeoutMs: 5_000,
                });
            },
            holder: {
                turnSession: () => session,
                turnBinding: () => (session === undefined ? undefined : binding),
                adoptTurnSession: (opened) => {
                    session = opened;
                },
                closeTurnSession: async () => {
                    await session?.close();
                    session = undefined;
                },
            },
            binding,
            freshRoles: FRESH_SESSION_ROLES,
        });
        try {
            const count = scenario === 'plain' || scenario === 'missing-artifact' ? 2 : 1;
            for (let index = 1; index <= count; index++) {
                const state = `task-${index}`;
                const requestId = `request-${index}`;
                const artifact = `artifact-${index}.txt`;
                await writeFleetWorkItem(
                    cwd,
                    'parent',
                    state,
                    {
                        role: 'coder',
                        input: `Replay turn ${index}\nREPLAY_ARTIFACT ${join(cwd, artifact)}`,
                        expectFile: artifact,
                    },
                    {},
                );
                const result = await runFleetWorkItem({
                    cwd,
                    recipient: binding.memberId,
                    key: `parent/${state}`,
                    messageId: requestId,
                    flags: { agent: 'codex', 'run-id': `child-${index}`, 'execution-id': `execution-${index}` },
                    service,
                    runDeps: resolutionDeps(runner),
                    getDb: async () => db,
                    turn: {
                        ...turn,
                        dispatchTurn: async (context) => {
                            const dispatched = await turn.dispatchTurn(context);
                            if (dispatched.kind === 'warm') {
                                expect(dispatched.outcome.correlation).toMatchObject({
                                    runId: `child-${index}`,
                                    requestId,
                                    attempt: 0,
                                });
                                outcomes.push(dispatched.outcome);
                            } else {
                                expect(scenario).toBe('unqualified');
                                expect(dispatched.reason).toBe('unqualified-version');
                            }
                            return dispatched;
                        },
                    },
                });
                const succeeds =
                    scenario === 'plain' ||
                    scenario === 'unqualified' ||
                    (scenario === 'missing-artifact' && index === 1);
                expect(result?.ok).toBe(succeeds);
                expect(await readFleetWorkItemResult(cwd, 'parent', state)).toEqual(result);
                const receipt = turn.lastTurn();
                expect(receipt).toMatchObject({ ...binding, requestId, attempt: 0 });
                expect(result?.data?.turn).toEqual(receipt);
                if (receipt !== undefined) receipts.push(receipt);
                if (scenario === 'unqualified') {
                    expect(receipt).toMatchObject({ mode: 'one-shot', fallbackReason: 'unqualified-version' });
                } else if (scenario === 'failed') {
                    expect(outcomes[0]?.kind).toBe('failure');
                    expect(receipt).toMatchObject({
                        mode: 'warm',
                        nativeOutcome: 'failure',
                        nativeSessionId: FAILED_THREAD,
                        nativeTurnId: FAILED_TURN,
                    });
                    expect(readFileSync(join(cwd, artifact), 'utf8')).toBe('alpha');
                    expect(result?.ok).toBe(false);
                } else if (scenario === 'interrupted') {
                    expect(outcomes[0]?.kind).toBe('interrupted');
                    expect(receipt).toMatchObject({
                        mode: 'warm',
                        nativeOutcome: 'interrupted',
                        nativeSessionId: INTERRUPTED_THREAD,
                        nativeTurnId: INTERRUPTED_TURN,
                    });
                    expect(result?.ok).toBe(false);
                } else if (scenario === 'exit-after-accept') {
                    expect(outcomes[0]?.kind).toBe('outcome-unknown');
                    expect(outcomes[0]?.acceptedAt).toBeDefined();
                    expect(receipt).toMatchObject({ mode: 'warm', nativeOutcome: 'outcome-unknown' });
                    expect(result?.ok).toBe(false);
                } else {
                    expect(receipt).toMatchObject({
                        mode: 'warm',
                        nativeOutcome: 'success',
                        nativeSessionId: THREAD,
                        nativeTurnId: TURN_IDS[index - 1],
                        acceptedAt: expect.any(String),
                    });
                    if (succeeds) {
                        expect(readFileSync(join(cwd, artifact), 'utf8')).toBe(index === 1 ? 'alpha' : 'beta');
                    } else {
                        expect(result?.data).toMatchObject({ outcome: 'contract-violation', contract: 'expectFile' });
                    }
                }
            }
            expect(openCalls).toBe(1);
            expect(fallbackCalls).toBe(scenario === 'unqualified' ? 1 : 0);
            expect(executor.launches).toHaveLength(scenario === 'unqualified' ? 0 : 1);
            if (scenario !== 'unqualified') {
                expect(executor.launches[0]).toMatchObject({ command: 'codex', pid: expect.any(Number) });
                expect(executor.launches[0]?.args).toEqual(['app-server']);
            }
            if (count === 2) {
                expect(receipts[0]?.nativeSessionId).toBe(receipts[1]?.nativeSessionId);
                expect(receipts[0]?.nativeTurnId).not.toBe(receipts[1]?.nativeTurnId);
                expect(outcomes[0]?.turnId).not.toBe(outcomes[1]?.turnId);
                expect(receipts[0]?.policyDigest).toBe(receipts[1]?.policyDigest);
            }
        } finally {
            await session?.close();
            db.close();
            rmSync(cwd, { recursive: true, force: true });
        }
    }, 20_000);
}

test('1278 a cancel resolves only after the native interrupted completion', async () => {
    const executor = new CodexReplayExecutor('cancel');
    const runner = new AiRunner({ processExecutor: executor });
    const opened = await runner.openTurnSession('codex', {
        policy: { workspace: '/tmp', role: 'coder' },
        binary: { path: 'codex', version: '0.164.0' },
        handshakeTimeoutMs: 5_000,
    });
    expect(opened.ok).toBe(true);
    if (!opened.ok) return;
    try {
        const handle = opened.session.startTurn({
            prompt: 'count slowly',
            correlation: { runId: 'run-1278', executionId: 'exec-1278', requestId: 'req-1278', attempt: 1 },
        });
        const accepted = await handle.accepted;
        expect(accepted).not.toBeNull();
        const outcome = await handle.cancel('operator cancelled', { graceMs: 2_000 });
        expect(outcome.kind).toBe('interrupted');
        expect(outcome.nativeSessionId).toBe(INTERRUPTED_THREAD);
        expect(outcome.nativeTurnId).toBe(INTERRUPTED_TURN);
        expect(executor.launches).toHaveLength(1);
    } finally {
        await opened.session.close();
    }
}, 20_000);
