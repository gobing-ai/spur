import { describe, expect, test } from 'bun:test';
import { existsSync, mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { AgentFleet } from '@gobing-ai/spur-config';
import type { ActionRunContext } from '@gobing-ai/ts-dual-workflow-engine';
import { createNodeFileSystem } from '@gobing-ai/ts-runtime';
import type { AgentRunInvocation, AgentRunTracedResult, AgentService } from '../../../src/services/agent-service';
import type { FleetDispatchRequest, FleetReceipt } from '../../../src/services/fleet-dispatcher';
import type { FleetService, ResolvedFleetMember } from '../../../src/services/fleet-service';
import { AgentRunActionRunner } from '../../../src/workflow/actions/agent-run';
import type { FleetDispatchDeps } from '../../../src/workflow/fleet-dispatch';
import { readReceipt, receiptPath } from '../../../src/workflow/receipt';

/**
 * Completion matrix (1306): what shared finalization must preserve on every executor
 * surface AFTER the dispatch settles. Characterized here so the extraction cannot
 * quietly change ownership, usage honesty, redaction or the receipt vocabulary.
 *
 * Completion            Host                      Fleet                         Subprocess
 * success               pause row, host receipt    reason=done, usage n/a        exitCode 0, measured usage
 * refusal (non-zero)    n/a (nothing dispatched)   reason=failed-agent, no signal classified from redacted stderr
 * timeout               n/a                       outcome-unknown receipt       signal row -> timeout signal
 * cancellation          n/a                       outcome-unknown receipt       signal row -> timeout signal
 * contract failure      host continue validates    delegated member result       contract-violation, not classified
 * partial work          n/a                       member-side artifact           partial artifact preserved
 * missing receipt       host continue rejects      no work-item result -> fail    write failure never masks failure
 * fleet fallback        n/a                       re-dispatched as subprocess    row carries fallbackReason
 *
 * Failure modes: an action-owned receipt for a host pause, a fabricated usage figure, a
 * classifier fed raw (unredacted) streams, a contract violation reported as a provider
 * failure, or a fleet fallback row that no longer names why the subprocess ran.
 */

const SECRET = 'sk-live-1306-secret';

function workdir(): string {
    return mkdtempSync(join(tmpdir(), 'spur-1306-completion-'));
}

function makeCtx(workdirPath: string, vars: Record<string, string> = {}): ActionRunContext {
    return { runId: 'run-1', stateOrNodeId: 'implement', workdir: workdirPath, vars, env: {} };
}

function invocation(): AgentRunInvocation {
    return {
        agent: 'claude',
        source: 'default',
        command: 'claude',
        argv: ['-p', 'implement'],
        cwd: '/tmp',
        mode: 'text',
        outputMode: 'buffered',
        continue: false,
        stdinInteractive: false,
    };
}

function svc(result: Partial<AgentRunTracedResult>): AgentService {
    return {
        runTraced: async () =>
            ({
                exitCode: 0,
                stdout: '',
                usage: { availability: 'measured', inputTokens: 10, outputTokens: 20 },
                invocation: invocation(),
                ...result,
            }) as AgentRunTracedResult,
    } as unknown as AgentService;
}

function fleetDeps(
    workdirPath: string,
    receipt: FleetReceipt,
): FleetDispatchDeps & { dispatchCalls: FleetDispatchRequest[] } {
    const dispatchCalls: FleetDispatchRequest[] = [];
    return {
        fleet: {
            load: async () => ({ enabled: true, strategy: 'rest', members: [] }) as unknown as AgentFleet,
            resolve: async () => ({
                projectPath: workdirPath,
                enabled: true,
                members: [
                    {
                        instanceId: 'proj-coder',
                        role: 'coder',
                        executor: 'claude',
                        enabled: true,
                        writeCapable: true,
                    } as ResolvedFleetMember,
                ],
                missing: [],
            }),
        } as unknown as FleetService,
        dispatcher: {
            enqueue: async (request: FleetDispatchRequest) => {
                dispatchCalls.push(request);
                return { messageId: 'msg-1', replayed: false };
            },
            awaitReceipt: async () => receipt,
        },
        now: () => 1,
        dispatchCalls,
    };
}

/** Fleet deps whose declaration is absent, so the surface is unavailable before dispatch. */
function unavailableFleetDeps(workdirPath: string): FleetDispatchDeps {
    const deps = fleetDeps(workdirPath, { status: 'completed', messageId: 'msg-1', runId: 'run-1' });
    return { ...deps, fleet: { ...deps.fleet, load: async () => null } as unknown as FleetService };
}

function data(result: { data?: Record<string, unknown> }): Record<string, unknown> {
    return (result.data ?? {}) as Record<string, unknown>;
}

describe('1306 shared completion finalization', () => {
    test('subprocess success: usage and the surface-owned fields survive finalization', async () => {
        const dir = workdir();
        const result = await new AgentRunActionRunner(svc({})).execute({ role: 'coder', input: 'go' }, makeCtx(dir));

        expect(result.ok).toBe(true);
        expect(data(result).usage).toMatchObject({ availability: 'measured' });
        expect(data(result).failureSignal).toBeUndefined();
        // A subprocess row stays surface-less (the fleet parity contract, 0942 R4).
        expect(data(result).surface).toBeUndefined();
        const receipt = await readReceipt(createNodeFileSystem(dir), dir, receiptPath(dir, 'run-1', 'implement'));
        expect(receipt?.outcome).toBe('done');
    });

    test('subprocess refusal: the failure is classified from the row’s own redacted evidence', async () => {
        const dir = workdir();
        const result = await new AgentRunActionRunner(
            svc({ exitCode: 3, stderr: `HTTP 429 Too Many Requests (key ${SECRET})` }),
            undefined,
            undefined,
            { secretValues: [SECRET] },
        ).execute({ role: 'coder', input: 'go' }, makeCtx(dir));

        expect(result.ok).toBe(false);
        expect(data(result).failureSignal).toBe('resource-exhaustion');
        // Redaction is upstream of classification: the secret never reaches the row.
        expect(String(data(result).stderrTail)).toContain('[REDACTED]');
        expect(String(data(result).stderrTail)).not.toContain(SECRET);
        expect(data(result).usage).toBeDefined();
    });

    test('subprocess timeout/cancellation: the signal rides the row and classifies as timeout', async () => {
        const dir = workdir();
        const result = await new AgentRunActionRunner(svc({ exitCode: 3, signal: 'SIGTERM' })).execute(
            { role: 'coder', input: 'go', timeoutMs: 1000 },
            makeCtx(dir),
        );

        expect(result.ok).toBe(false);
        expect(data(result).signal).toBe('SIGTERM');
        expect(data(result).failureSignal).toBe('timeout');
        // Partial work is preserved for the operator, and the receipt stays non-terminal.
        expect(existsSync(join(dir, '.spur/run/run-1-implement-partial.md'))).toBe(true);
        const receipt = await readReceipt(createNodeFileSystem(dir), dir, receiptPath(dir, 'run-1', 'implement'));
        expect(receipt?.outcome).toBe('outcome-unknown');
    });

    test('subprocess cancellation: a signal without a timeout is still a timeout classification, not a failed receipt', async () => {
        const dir = workdir();
        const result = await new AgentRunActionRunner(svc({ exitCode: 3, signal: 'SIGINT' })).execute(
            { role: 'coder', input: 'go' },
            makeCtx(dir),
        );

        expect(result.ok).toBe(false);
        expect(data(result).signal).toBe('SIGINT');
        expect(data(result).failureSignal).toBe('timeout');
        expect(String(result.error)).toContain('cancelled by signal');
        expect(existsSync(join(dir, '.spur/run/run-1-implement-partial.md'))).toBe(true);
        const receipt = await readReceipt(createNodeFileSystem(dir), dir, receiptPath(dir, 'run-1', 'implement'));
        expect(receipt?.outcome).toBe('outcome-unknown');
    });

    test('contract failure is never reported as a provider failure', async () => {
        const dir = workdir();
        const result = await new AgentRunActionRunner(svc({})).execute(
            { role: 'coder', input: 'go', expectFile: '.spur/run/never.txt' },
            makeCtx(dir),
        );

        expect(result.ok).toBe(false);
        expect(data(result).outcome).toBe('contract-violation');
        expect(data(result).failureSignal).toBeUndefined();
        const receipt = await readReceipt(createNodeFileSystem(dir), dir, receiptPath(dir, 'run-1', 'implement'));
        expect(receipt).toMatchObject({ outcome: 'contract-violation', contract: 'expectFile' });
    });

    test('fleet failure: the member identity survives and no signal is invented from a coarse status', async () => {
        const dir = workdir();
        const deps = fleetDeps(dir, { status: 'failed', messageId: 'msg-1', runId: 'run-1' });
        const result = await new AgentRunActionRunner(svc({}), undefined, undefined, {}, deps).execute(
            { role: 'coder', input: 'go' },
            makeCtx(dir, { executor: 'fleet' }),
        );

        expect(result.ok).toBe(false);
        expect(data(result).surface).toBe('fleet');
        expect(data(result).reason).toBe('failed-agent');
        expect(data(result).memberId).toBe('proj-coder');
        // `FleetReceipt` carries status only (no provider output), so the row holds no
        // evidence to classify — finalization adds nothing rather than guessing a cause.
        expect(data(result).failureSignal).toBeUndefined();
        expect(String(result.error)).toContain('fleet dispatch failed');
        // Fleet usage stays honestly unavailable — never a fabricated figure.
        expect(data(result).usage).toMatchObject({ availability: 'unavailable' });
    });

    test('host pause: no action-owned receipt and no completion decoration', async () => {
        const dir = workdir();
        const result = await new AgentRunActionRunner(svc({})).execute(
            { role: 'coder', input: 'go' },
            makeCtx(dir, { executor: 'host' }),
        );

        expect(result.pause).toBe(true);
        expect(data(result).surface).toBe('host');
        expect(data(result).failureSignal).toBeUndefined();
        expect(existsSync(receiptPath(dir, 'run-1', 'implement'))).toBe(false);
    });

    test('fleet fallback: one shared stamp names why the subprocess ran, on success and on a violation', async () => {
        const okDir = workdir();
        const okResult = await new AgentRunActionRunner(
            svc({}),
            undefined,
            undefined,
            {},
            unavailableFleetDeps(okDir),
        ).execute(
            { role: 'coder', input: 'go' },
            makeCtx(okDir, { executor: 'fleet', executorFallback: 'traditional' }),
        );
        expect(okResult.ok).toBe(true);
        expect(typeof data(okResult).fallbackReason).toBe('string');

        const badDir = workdir();
        const violation = await new AgentRunActionRunner(
            svc({}),
            undefined,
            undefined,
            {},
            unavailableFleetDeps(badDir),
        ).execute(
            { role: 'coder', input: 'go', expectFile: 'out/verdict.md' },
            makeCtx(badDir, { executor: 'fleet', executorFallback: 'traditional' }),
        );
        expect(violation.ok).toBe(false);
        expect(data(violation).outcome).toBe('contract-violation');
        expect(typeof data(violation).fallbackReason).toBe('string');
    });

    test('declared artifact paths resolve the same way whether relative or absolute', async () => {
        const dir = workdir();
        mkdirSync(join(dir, 'out'), { recursive: true });
        const absolute = join(dir, 'out', 'verdict.md');
        writeFileSync(absolute, 'stale', 'utf8');
        const result = await new AgentRunActionRunner(
            svc({ exitCode: 0, stdout: 'done' }),
            undefined,
            undefined,
            {},
        ).execute({ role: 'coder', input: 'go', expectFile: absolute }, makeCtx(dir));

        // Freshness deleted the stale absolute artifact, so the post-condition misses.
        expect(result.ok).toBe(false);
        expect(data(result).contract).toBe('expectFile');
        expect(existsSync(absolute)).toBe(false);
    });
});
