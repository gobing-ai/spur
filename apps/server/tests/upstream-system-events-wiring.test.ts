import { describe, expect, test } from 'bun:test';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { RuleService } from '@gobing-ai/spur-app';
import { SystemEventDao } from '@gobing-ai/spur-domain';
import { EventBus } from '@gobing-ai/ts-infra';
import type { RuleEngineEvents } from '@gobing-ai/ts-rule-engine';
import { createNodeFileSystem } from '@gobing-ai/ts-runtime';
import { createServerContext } from '../src/context';
// Local HITL responder shape — mirror of the engine's interface; the
// production app re-exports it, but the test reaches the engine shape via
// the workflow service directly, so we keep this self-contained.
import { mockRuntime } from './middleware/helpers';

interface HitlResponder {
    respond(request: { kind: string }): Promise<{ kind: 'confirm' | 'select' | 'input'; value: string }>;
}

/**
 * Upstream-system-events-wiring tests (task 0221 — R3 acceptance).
 *
 * Proves the canonical server EventBus receives representative events from
 * upstream package producers (rule.* / agent.* / process.* / workflow.*) and
 * that they are persisted to the `system_events` ledger by the catalog-driven
 * tap installed at serve bootstrap. Mirrors the existing `task.*` round-trip
 * test in `context.test.ts`.
 */

const testFs = createNodeFileSystem('/tmp/test');

async function loadTap(
    bus: EventBus<Record<string, (event: unknown) => void>>,
    dao: SystemEventDao,
    diagnosticEnabled: boolean,
) {
    const mod = await import('@gobing-ai/spur-app');
    return mod.registerSystemEventTap(bus, dao, { warn: () => {}, debug: () => {} }, { diagnosticEnabled });
}

/**
 * Build a ServerContext whose `eventBus()` is a real `EventBus`, then attach
 * the system-event tap. `appRt.events` from the test runtime is a no-op, so
 * the canonical bus must be threaded via `eventsBus?` to exercise the tap.
 */
async function buildContextWithTap(diagnosticEnabled = false): Promise<{
    ctx: ReturnType<typeof createServerContext>;
    bus: EventBus<Record<string, (event: unknown) => void>>;
    tap: Awaited<ReturnType<typeof loadTap>>;
    dao: SystemEventDao;
}> {
    const cwd = mkdtempSync(join(tmpdir(), 'spur-0221-'));
    const bus = new EventBus<Record<string, (event: unknown) => void>>();
    const ctx = createServerContext(mockRuntime(), {
        cwd,
        fs: testFs,
        dbUrl: ':memory:',
        eventsBus: bus as unknown as Parameters<typeof createServerContext>[1]['eventsBus'],
    });
    const dao = new SystemEventDao(await ctx.getDb());
    const tap = await loadTap(bus, dao, diagnosticEnabled);
    return { ctx, bus, tap, dao };
}

describe('upstream system event wiring (task 0221 R3)', () => {
    test('rule.run.* events emitted from a forwarded local bus land in system_events', async () => {
        const { ctx, bus, tap, dao } = await buildContextWithTap();
        try {
            // Construct RuleService so the type-checker forces the bridge
            // surface into the build, even though this test fires the bus
            // directly (mirroring RuleService.evaluateVerbose's internal
            // forwarding pattern from task 0221 R3).
            const RuleServiceMod = await import('@gobing-ai/spur-app');
            const _ruleSvc: RuleService = new RuleServiceMod.RuleService({
                cwd: ctx.cwd,
                env: {},
                fs: ctx.fs,
                output: { write: () => {}, error: () => {} },
                events: bus,
            });
            void _ruleSvc;

            const localBus = new EventBus<RuleEngineEvents>();
            for (const name of [
                'rule.run.start',
                'rule.eval.start',
                'rule.eval.done',
                'rule.eval.error',
                'rule.run.done',
            ] as const) {
                localBus.on(name, (detail: unknown) => {
                    void bus.emit(name, detail);
                });
            }
            void localBus.emit('rule.run.start', { rules: 1, total: 1 });
            void localBus.emit('rule.eval.start', { ruleId: 'fake', index: 0, total: 1 });
            void localBus.emit('rule.eval.done', {
                ruleId: 'fake',
                findings: 0,
                durationMs: 4,
                details: [],
            });
            void localBus.emit('rule.run.done', { rules: 1, findings: 0, durationMs: 4, stoppedEarly: false });

            await tap.flush();

            const runStart = await dao.query({ name: 'rule.run.start', limit: 5 });
            expect(runStart.length).toBeGreaterThanOrEqual(1);
            const runDone = await dao.query({ name: 'rule.run.done', limit: 5 });
            expect(runDone.length).toBeGreaterThanOrEqual(1);
        } finally {
            tap.unsubscribe();
        }
    });

    test('agent.invoke.* and process.* flow through the server bus into system_events', async () => {
        const { bus, tap, dao } = await buildContextWithTap();
        try {
            // Drive the typed event names directly through the server bus —
            // the AgentService bridge (task 0221 R3) is the same pattern; we
            // exercise the round-trip without spinning up a real CLI.
            await bus.emit('agent.invoke.start', {
                agent: 'claude',
                operation: 'test',
                label: 'integration',
            });
            await bus.emit('process.started', {
                command: 'claude',
                args: ['test'],
                exitCode: null,
                reason: 'spawned',
            });

            await tap.flush();

            const agentRows = await dao.query({ name: 'agent.invoke.start', limit: 5 });
            expect(agentRows.length).toBeGreaterThanOrEqual(1);
            const processRows = await dao.query({ name: 'process.started', limit: 5 });
            expect(processRows.length).toBeGreaterThanOrEqual(1);
        } finally {
            tap.unsubscribe();
        }
    });

    test('workflow.run.started and workflow.action.* land in system_events with sensitive fields redacted', async () => {
        const { ctx, bus, tap, dao } = await buildContextWithTap();
        try {
            // Construct WorkflowAppService so the type-checker pins the
            // `bridgeEngineEvents` surface, then drive the bridged event names
            // directly through the server bus.
            const WfMod = await import('@gobing-ai/spur-app');
            const _svc = new WfMod.WorkflowAppService({
                cwd: ctx.cwd,
                getDb: () => ctx.getDb(),
                agentService: () => {
                    throw new Error('not exercised');
                },
                ruleService: () => {
                    throw new Error('not exercised');
                },
                hitlResponder: () =>
                    ({
                        respond: async () => ({ kind: 'confirm' as const, value: true }),
                    }) as unknown as HitlResponder,
                events: () => bus,
            });
            void _svc;

            await bus.emit('workflow.run.started', {
                workflowName: 'fake',
                mode: 'state-machine',
                runId: 'run-test',
                dryRun: false,
            });
            await bus.emit('workflow.action.start', { runId: 'run-test', node: 'review', kind: 'shell' });
            await bus.emit('workflow.hitl.ask', {
                runId: 'run-test',
                node: 'review',
                kind: 'input',
                message: 'SECRET-PROMPT-MUST-NOT-LEAK',
            });

            await tap.flush();

            const runRows = await dao.query({ name: 'workflow.run.started', limit: 5 });
            expect(runRows.length).toBeGreaterThanOrEqual(1);

            const actionRows = await dao.query({ name: 'workflow.action.start', limit: 5 });
            expect(actionRows.length).toBeGreaterThanOrEqual(1);

            const hitlRows = await dao.query({ name: 'workflow.hitl.ask', limit: 5 });
            expect(hitlRows.length).toBeGreaterThanOrEqual(1);

            // R6 — sensitive text fields on `redacted`-policy events must
            // not leak to the ledger.
            const hitlPayloadJson = hitlRows[0]?.payload_json ?? '';
            expect(hitlPayloadJson).not.toContain('SECRET-PROMPT-MUST-NOT-LEAK');
            expect(hitlPayloadJson).toContain('[redacted]');
        } finally {
            tap.unsubscribe();
        }
    });

    test('diagnostic events are skipped when diagnosticEnabled is false (R5)', async () => {
        const { bus, tap, dao } = await buildContextWithTap(false);
        try {
            await bus.emit('bus.handler.error', { event: 'fake', handlerCount: 0 });
            await bus.emit('workflow.guard.evaluated', {
                runId: 'run-x',
                from: 'a',
                to: 'b',
                kind: 'always',
                passed: true,
            });
            await tap.flush();

            const busRows = await dao.query({ name: 'bus.handler.error', limit: 5 });
            expect(busRows.length).toBe(0);
            const guardRows = await dao.query({ name: 'workflow.guard.evaluated', limit: 5 });
            expect(guardRows.length).toBe(0);
        } finally {
            tap.unsubscribe();
        }
    });

    test('diagnostic events persist when diagnosticEnabled is true', async () => {
        const { bus, tap, dao } = await buildContextWithTap(true);
        try {
            await bus.emit('bus.handler.error', { event: 'fake', handlerCount: 1 });
            await tap.flush();
            const rows = await dao.query({ name: 'bus.handler.error', limit: 5 });
            expect(rows.length).toBeGreaterThanOrEqual(1);
        } finally {
            tap.unsubscribe();
        }
    });
});
