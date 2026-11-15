import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { basename, join } from 'node:path';
import { _resetAgentServiceShimsForTest, FleetDispatcher } from '@gobing-ai/spur-app';
import type { SpurConfig } from '@gobing-ai/spur-config';
import { createMigratedDb } from '@gobing-ai/spur-domain';
import { runAgentRun } from '../../../src/commands/agent';
import { resetAgentServerFetchForTesting, setAgentServerFetchForTesting } from '../../../src/commands/agent/shared';
import { createCliContext } from '../../../src/context';
import { main } from '../../../src/index';
import type { CommandOutput } from '../../../src/output';

/**
 * 1333 (ADR-148): `spur agent run --agent <member>` — the named-member rung with no daemon
 * running (cold), with a live member (warm), and the doctor delivery block.
 */
function captureOutput(): CommandOutput & { stdout: string[]; stderr: string[] } {
    const stdout: string[] = [];
    const stderr: string[] = [];
    return {
        stdout,
        stderr,
        write: (msg: string) => {
            stdout.push(msg);
        },
        error: (msg: string) => {
            stderr.push(msg);
        },
    };
}

/** The fetch seam is typed as `typeof fetch`; a test stub only needs to be callable. */
function stubFetch(handler: () => Promise<Response>): typeof fetch {
    return handler as unknown as typeof fetch;
}

/** A project config declaring one local member `coder` on the `codex-fast` executor. */
function fleetConfig(): SpurConfig {
    return {
        agent: {
            executors: [{ name: 'codex-fast', agent: 'codex' }],
            // AC1's own member name: an id equal to a role is allowed — the member rung wins.
            fleet: { enabled: false, strategy: 'rest', members: [{ id: 'coder', executor: 'codex-fast' }] },
        },
    } as unknown as SpurConfig;
}

beforeEach(() => {
    _resetAgentServiceShimsForTest();
});

afterEach(() => {
    resetAgentServerFetchForTesting();
});

describe('agent run --agent <member> (1333 R1/R3)', () => {
    test('AC1: with no daemon running the member runs cold on its executor', async () => {
        const output = captureOutput();
        const db = await createMigratedDb({ url: ':memory:' });
        const cwd = mkdtempSync(join(tmpdir(), 'spur-member-cold-'));
        // No `spur serve` process answers the liveness probe.
        setAgentServerFetchForTesting(stubFetch(async () => new Response('{}', { status: 500 })));
        try {
            const ctx = createCliContext({ cwd, output, db, spurConfig: fleetConfig() });
            let seen: Record<string, string | boolean> = {};
            const run = async (_prompt: string | undefined, flags: Record<string, string | boolean>) => {
                seen = flags;
                return 0;
            };
            const code = await runAgentRun('do the thing', { ...ctx, agentService: () => ({ run }) } as never, {
                agent: 'coder',
            });
            expect(code).toBe(0);
            // The member's executor is what actually spawns; the cold rung is named.
            expect(seen.agent).toBe('codex-fast');
            expect(String(seen.dispatchDelivery)).toContain('cold subprocess executor');
            expect(output.stderr.join('\n')).toContain('member "coder"');
        } finally {
            rmSync(cwd, { recursive: true, force: true });
        }
    });

    test('AC2: a live member takes one keyed inbox request instead of the subprocess', async () => {
        const output = captureOutput();
        const db = await createMigratedDb({ url: ':memory:' });
        const cwd = mkdtempSync(join(tmpdir(), 'spur-member-warm-'));
        const liveId = `${basename(cwd)}-coder`;
        setAgentServerFetchForTesting(
            stubFetch(
                async () =>
                    new Response(JSON.stringify({ processes: [{ agentId: liveId, pid: 42, status: 'busy' }] }), {
                        status: 200,
                    }),
            ),
        );
        const dispatch = FleetDispatcher.prototype.dispatch;
        const calls: unknown[][] = [];
        FleetDispatcher.prototype.dispatch = async (...args: unknown[]) => {
            calls.push(args);
            return { status: 'completed', messageId: 'msg-warm-1', runId: 'run-warm-1' };
        };
        try {
            const ctx = createCliContext({ cwd, output, db, spurConfig: fleetConfig() });
            const run = async () => {
                throw new Error('the subprocess must not run when the member is live');
            };
            const code = await runAgentRun('do the thing', { ...ctx, agentService: () => ({ run }) } as never, {
                agent: 'coder',
            });
            expect(code).toBe(0);
            expect(calls).toHaveLength(1);
            // P3: the sender is the operator's real inbox id, not the `spur` system address.
            expect(calls[0]?.[0]).toMatchObject({ member: liveId, fromId: 'operator', body: 'do the thing' });
            // P3: the warm wait is BOUNDED (the CLI's own 10-min wait budget) and abortable —
            // an infinite wait blocks `spur agent run` forever on a live-but-stuck member.
            const dispatchOpts = calls[0]?.[1] as { timeoutMs?: number; signal?: unknown } | undefined;
            expect(dispatchOpts?.timeoutMs).toBe(600_000);
            expect(dispatchOpts?.signal).toBeInstanceOf(AbortSignal);
            // P2: the warm delivery line goes to STDERR — stdout stays JSON-parseable.
            expect(output.stderr.join('\n')).toContain('warm inbox turn');
            expect(output.stdout).toHaveLength(0);
        } finally {
            FleetDispatcher.prototype.dispatch = dispatch;
            rmSync(cwd, { recursive: true, force: true });
        }
    });

    test('P2: a live member under --json keeps stdout free of prose', async () => {
        const output = captureOutput();
        const db = await createMigratedDb({ url: ':memory:' });
        const cwd = mkdtempSync(join(tmpdir(), 'spur-member-warm-json-'));
        const liveId = `${basename(cwd)}-coder`;
        setAgentServerFetchForTesting(
            stubFetch(
                async () =>
                    new Response(JSON.stringify({ processes: [{ agentId: liveId, pid: 42, status: 'idle' }] }), {
                        status: 200,
                    }),
            ),
        );
        const dispatch = FleetDispatcher.prototype.dispatch;
        FleetDispatcher.prototype.dispatch = async () => ({ status: 'completed', messageId: 'msg-json-1' });
        try {
            const ctx = createCliContext({ cwd, output, db, spurConfig: fleetConfig() });
            const code = await runAgentRun(
                'do the thing',
                { ...ctx, agentService: () => ({ run: async () => 0 }) } as never,
                { agent: 'coder', json: true },
            );
            expect(code).toBe(0);
            // Every stdout line must be JSON (here: none at all) — a prose line would break
            // any script consuming `spur agent run --json`.
            for (const line of output.stdout) expect(() => JSON.parse(line)).not.toThrow();
            expect(output.stderr.join('\n')).toContain('warm inbox turn');
        } finally {
            FleetDispatcher.prototype.dispatch = dispatch;
            rmSync(cwd, { recursive: true, force: true });
        }
    });

    test('R3/R5: a DEFINITE not-started warm dispatch steps down to the cold rung on the member executor', async () => {
        const output = captureOutput();
        const db = await createMigratedDb({ url: ':memory:' });
        const cwd = mkdtempSync(join(tmpdir(), 'spur-member-nostart-'));
        const liveId = `${basename(cwd)}-coder`;
        setAgentServerFetchForTesting(
            stubFetch(
                async () =>
                    new Response(JSON.stringify({ processes: [{ agentId: liveId, pid: 42, status: 'idle' }] }), {
                        status: 200,
                    }),
            ),
        );
        const dispatch = FleetDispatcher.prototype.dispatch;
        FleetDispatcher.prototype.dispatch = async () => ({
            status: 'not-started',
            messageId: 'msg-nostart-1',
            reason: 'the member never claimed the request',
        });
        try {
            const ctx = createCliContext({ cwd, output, db, spurConfig: fleetConfig() });
            const seen: string[] = [];
            const run = async (_prompt: string, runFlags: Record<string, string | boolean>) => {
                seen.push(String(runFlags.agent));
                return 0;
            };
            const code = await runAgentRun('do the thing', { ...ctx, agentService: () => ({ run }) } as never, {
                agent: 'coder',
            });
            // The ladder steps down (design §3.2): nothing ran, so the member's executor takes it.
            expect(code).toBe(0);
            expect(seen).toEqual(['codex-fast']);
            expect(output.stderr.join('\n')).toContain("cold subprocess executor 'codex-fast'");
        } finally {
            FleetDispatcher.prototype.dispatch = dispatch;
            rmSync(cwd, { recursive: true, force: true });
        }
    });

    test('R4: an outcome-unknown warm dispatch is reported and NEVER re-run on the cold rung', async () => {
        const output = captureOutput();
        const db = await createMigratedDb({ url: ':memory:' });
        const cwd = mkdtempSync(join(tmpdir(), 'spur-member-unknown-'));
        const liveId = `${basename(cwd)}-coder`;
        setAgentServerFetchForTesting(
            stubFetch(
                async () =>
                    new Response(JSON.stringify({ processes: [{ agentId: liveId, pid: 42, status: 'idle' }] }), {
                        status: 200,
                    }),
            ),
        );
        const dispatch = FleetDispatcher.prototype.dispatch;
        FleetDispatcher.prototype.dispatch = async () => ({ status: 'outcome-unknown', messageId: 'msg-unknown-1' });
        try {
            const ctx = createCliContext({ cwd, output, db, spurConfig: fleetConfig() });
            let ran = false;
            const run = async () => {
                ran = true;
                return 0;
            };
            const code = await runAgentRun('do the thing', { ...ctx, agentService: () => ({ run }) } as never, {
                agent: 'coder',
            });
            expect(code).toBe(1);
            expect(ran).toBe(false);
            expect(output.stderr.join('\n')).toContain('never re-run on another delivery');
        } finally {
            FleetDispatcher.prototype.dispatch = dispatch;
            rmSync(cwd, { recursive: true, force: true });
        }
    });

    test('P2: a DISABLED member is an exit-2 refusal naming the member — never a silent role re-target', async () => {
        const output = captureOutput();
        const db = await createMigratedDb({ url: ':memory:' });
        const cwd = mkdtempSync(join(tmpdir(), 'spur-member-disabled-'));
        setAgentServerFetchForTesting(stubFetch(async () => new Response('{}', { status: 500 })));
        const config = {
            agent: {
                executors: [{ name: 'codex-fast', agent: 'codex' }],
                fleet: {
                    enabled: false,
                    strategy: 'rest',
                    // `coder` is ALSO a role name, so a fall-through would silently run that role.
                    members: [{ id: 'coder', executor: 'codex-fast', enabled: false }],
                },
            },
        } as unknown as SpurConfig;
        try {
            const ctx = createCliContext({ cwd, output, db, spurConfig: config });
            let ran = false;
            const run = async () => {
                ran = true;
                return 0;
            };
            const code = await runAgentRun('do the thing', { ...ctx, agentService: () => ({ run }) } as never, {
                agent: 'coder',
            });
            expect(code).toBe(2);
            expect(ran).toBe(false);
            const err = output.stderr.join('\n');
            expect(err).toContain("--agent 'coder' cannot be dispatched");
            expect(err).toContain('-coder" — member is disabled');
            expect(err).toContain('disabled');
        } finally {
            rmSync(cwd, { recursive: true, force: true });
        }
    });

    test('an unknown selector still fails the boundary with the established diagnostic', async () => {
        const output = captureOutput();
        const db = await createMigratedDb({ url: ':memory:' });
        const cwd = mkdtempSync(join(tmpdir(), 'spur-member-unknown-'));
        setAgentServerFetchForTesting(stubFetch(async () => new Response('{}', { status: 500 })));
        try {
            const ctx = createCliContext({ cwd, output, db, spurConfig: fleetConfig() });
            const code = await runAgentRun(
                'do the thing',
                { ...ctx, agentService: () => ({ run: async () => 0 }) } as never,
                { agent: 'ghost' },
            );
            expect(code).toBe(2);
            expect(output.stderr.join('\n')).toContain("Unknown agent: 'ghost'");
        } finally {
            rmSync(cwd, { recursive: true, force: true });
        }
    });

    test('R1: a member id that claims a coding-agent binary name is refused, naming both', async () => {
        const output = captureOutput();
        const db = await createMigratedDb({ url: ':memory:' });
        const cwd = mkdtempSync(join(tmpdir(), 'spur-member-binary-'));
        setAgentServerFetchForTesting(stubFetch(async () => new Response('{}', { status: 500 })));
        const config = {
            agent: {
                executors: [{ name: 'codex-fast', agent: 'codex' }],
                fleet: { enabled: false, strategy: 'rest', members: [{ id: 'claude', executor: 'codex-fast' }] },
            },
        } as unknown as SpurConfig;
        try {
            const ctx = createCliContext({ cwd, output, db, spurConfig: config });
            const code = await runAgentRun(
                'do the thing',
                { ...ctx, agentService: () => ({ run: async () => 0 }) } as never,
                { agent: 'claude' },
            );
            expect(code).toBe(2);
            expect(output.stderr.join('\n')).toContain('names both the fleet member');
        } finally {
            rmSync(cwd, { recursive: true, force: true });
        }
    });
});

describe('agent doctor — member delivery block (1333 R6/AC4)', () => {
    test('each declared member is listed with its delivery and why', async () => {
        const root = mkdtempSync(join(tmpdir(), 'spur-member-doctor-'));
        // A fixed project directory name is the instance-id prefix (`proj`).
        const cwd = join(root, 'proj');
        mkdirSync(join(cwd, '.spur'), { recursive: true });
        writeFileSync(
            join(cwd, '.spur', 'config.yaml'),
            [
                'agent:',
                '  executors:',
                '    - name: codex-fast',
                '      agent: codex',
                '  fleet:',
                '    members:',
                '      - id: coder',
                '        executor: codex-fast',
                '      - id: verifier',
                '        executor: codex-fast',
                '',
            ].join('\n'),
        );
        let probes = 0;
        setAgentServerFetchForTesting(
            stubFetch(async () => {
                probes += 1;
                return new Response(
                    JSON.stringify({ processes: [{ agentId: 'proj-verifier', pid: 7, status: 'busy' }] }),
                    {
                        status: 200,
                    },
                );
            }),
        );
        const output = captureOutput();
        try {
            const code = await main(['agent', 'doctor'], {
                output,
                cwd,
                env: { SPUR_SKIP_GLOBAL_CONFIG: 'true' },
            });
            const text = output.stdout.join('\n');
            expect(text).toContain('fleet members (delivery each takes now):');
            expect(text).toMatch(/proj-coder\tcold\tnot live under spur serve/);
            expect(text).toMatch(/proj-verifier\twarm\tlive under spur serve/);
            // P3: ONE liveness probe serves every member — not one per member.
            expect(probes).toBe(1);
            expect(typeof code).toBe('number');
        } finally {
            rmSync(root, { recursive: true, force: true });
        }
    }, 60_000);
});
