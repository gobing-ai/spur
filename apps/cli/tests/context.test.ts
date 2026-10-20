import { describe, expect, test } from 'bun:test';
import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { SystemEventBus } from '@gobing-ai/spur-app';
import type { AgentConfig, SpurConfig } from '@gobing-ai/spur-config';
import { EventBus } from '@gobing-ai/ts-infra';
import { createCliContext, executorRescue } from '../src/context';
import type { CommandOutput } from '../src/output';

function nullOutput(): CommandOutput {
    return { write: () => {}, error: () => {} };
}

describe('context', () => {
    test('createCliContext returns CliContext with required fields', () => {
        const ctx = createCliContext({ output: nullOutput() });
        expect(ctx.cwd).toBeString();
        expect(ctx.env).toBeObject();
        expect(ctx.fs).toBeDefined();
        expect(ctx.output).toBeDefined();
        expect(typeof ctx.getDb).toBe('function');
        // Default setExitCode is the exported no-op — exercise it so V8 func coverage counts.
        expect(() => ctx.setExitCode(0)).not.toThrow();
    });

    test('hitlResponder under --json never prompts interactively (returns the configured default)', async () => {
        // With json=true the selection must yield the non-interactive default regardless of TTY,
        // so a confirm resolves to the default without reading stdin (no hang, no JSON corruption).
        const ctx = createCliContext({ output: nullOutput() });
        const responder = ctx.hitlResponder(true);
        const answer = await responder.respond({ kind: 'confirm', prompt: 'x', runId: 'r', node: 'n' });
        expect(answer.value).toBe('no'); // DefaultHitlResponder deny-by-default
    });

    test('agentService forwards optional events bus for the 0370 ledger bridge', () => {
        // Direct `spur agent run` path: context.agentService({ events }) must thread the
        // bus into AgentService without dropping agentConfig (R4 dual of workflow path).
        const sentinel = { kind: 'cli-events-bus' };
        const agentConfig = { default: 'pi' } as never;
        const ctx = createCliContext({
            output: nullOutput(),
            agentConfig,
        });
        const svc = ctx.agentService({ events: sentinel as never });
        // AgentService keeps context private; runtime field is `ctx`.
        const internal = svc as unknown as { ctx: { events?: unknown; agentConfig?: unknown } };
        expect(internal.ctx.events).toBe(sentinel);
        expect(internal.ctx.agentConfig).toBe(agentConfig);
    });

    test('merged Spur config exposes executors to direct agent command validation (0718 R3)', () => {
        const agentConfig = {
            executors: [{ name: 'configured', agent: 'pi', tier: 'standard' }],
        } as AgentConfig;
        const ctx = createCliContext({
            output: nullOutput(),
            spurConfig: { agent: agentConfig } as never,
        });

        expect(ctx.agentConfig).toBe(agentConfig);
    });

    test('createCliContext threads the merged role map so --agent <role> resolves without the plugin tree (0572 R1)', () => {
        const ctx = createCliContext({ output: nullOutput() });
        expect(ctx.agentRoles?.get('planner')?.tier).toBe('capable-2');
        const overridden = createCliContext({
            output: nullOutput(),
            agentConfig: { roles: { reviewer: { tier: 'capable-2' } } },
        });
        expect(overridden.agentRoles?.get('reviewer')?.tier).toBe('capable-2');
    });
});

/**
 * 1264 R4 — the executor rescue is wired only under its opt-in flag.
 *
 * The seam is one function on the service context; the composition root is the only place that
 * reads `workflows.executorFailureDecisionMaker`, and with the flag absent nothing is added (the
 * default context stays byte-identical, AC4). With it on, the function redacts the failure text
 * and resolves through the real decision service, so an offline maker degrades to "no rescue"
 * instead of failing the run.
 */
describe('executorRescue (task 1264 R4)', () => {
    function projectWithConfig(configBody: string): string {
        const dir = mkdtempSync(join(tmpdir(), 'spur-cli-context-rescue-'));
        mkdirSync(join(dir, '.spur'), { recursive: true });
        writeFileSync(join(dir, '.spur', 'config.yaml'), configBody);
        return dir;
    }

    function deps(_cwd: string): {
        config: SpurConfig;
        env: Record<string, string | undefined>;
        output: { write: (m: string) => void; error: (m: string) => void };
        errors: string[];
        getDb: () => Promise<never>;
    } {
        const errors: string[] = [];
        return {
            config: { workflows: { executorFailureDecisionMaker: true } } as SpurConfig,
            env: { SPUR_TEST_TOKEN: 'secret-value-12345' },
            output: { write: () => {}, error: (message: string) => errors.push(message) },
            errors,
            // No DB in this sandbox: the sink path must degrade, not throw.
            getDb: () => Promise.reject(new Error('no db in this test')),
        };
    }

    test('AC4: an absent/off flag adds no seam at all', () => {
        const d = deps(projectWithConfig('{}'));
        expect(executorRescue(null, '/tmp', d.env, d.output, d.getDb)).toEqual({});
        expect(
            executorRescue(
                { workflows: { executorFailureDecisionMaker: false } } as SpurConfig,
                '/tmp',
                d.env,
                d.output,
                d.getDb,
            ),
        ).toEqual({});
    });

    test('AC5: the wired seam redacts the failure text and degrades when the maker cannot answer', async () => {
        const cwd = projectWithConfig('{}');
        const d = deps(cwd);
        const wired = executorRescue(d.config, cwd, d.env, d.output, d.getDb);
        expect(typeof wired.classifyUnmatchedFailure).toBe('function');
        // The offline `typesafe` maker serves the `task-defect` fallback, so the rescue declines —
        // and the run keeps today's behaviour rather than failing on the rescue.
        await expect(
            wired.classifyUnmatchedFailure?.('provider said: credits depleted secret-value-12345', { runId: 'run-1' }),
        ).resolves.toBeUndefined();
        // A non-auth failure is not re-raised as an error string either.
        expect(d.errors.join(' ')).not.toContain('secret-value-12345');
    });

    test('AC5 (R5): the wired seam emits its decision events on the run bus, attributed to executor', async () => {
        const cwd = projectWithConfig('{}');
        const d = deps(cwd);
        const bus = new EventBus<Record<string, (event: unknown) => void>>();
        const ends: Record<string, unknown>[] = [];
        const rejected: unknown[] = [];
        bus.on('decision.end', (event) => ends.push(event as Record<string, unknown>));
        bus.on('decision.rejected', (event) => rejected.push(event));
        // Without the run's bus the rescue wrote decision_logs only, so `--reliability` and the
        // 1263 outcome verb never saw it; and the shipped catalog's required `wbs` param (which
        // the seam cannot supply) rejected every rescue before it reached a maker.
        const wired = executorRescue(d.config, cwd, d.env, d.output, d.getDb, bus as unknown as SystemEventBus);
        await wired.classifyUnmatchedFailure?.('provider said: credits depleted', { runId: 'run-r5' });
        expect(rejected).toHaveLength(0);
        expect(d.errors).toEqual([]);
        expect(ends).toHaveLength(1);
        expect(JSON.stringify(ends[0])).toContain('"caller":"executor"');
        expect(JSON.stringify(ends[0])).toContain('run-r5');
    });
});
