/**
 * 1263 AC1 — a served decision result joins its ledger rows.
 *
 * Acceptance and accuracy both read the ledger by `invocationId`, so the served result must carry
 * that key (and the digest `decision.start` recorded) out to the caller. Without it the `.decision`
 * result file cannot be joined to `decision.*` events or to its `decision_logs` row, and an outcome
 * could never be scored against the decision that produced it.
 */
import { afterAll, describe, expect, spyOn, test } from 'bun:test';
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { applyCliMigrations, DecisionLogDao } from '@gobing-ai/spur-domain';
import { DecisionHub } from '@gobing-ai/ts-ai-decision';
import { createDbAdapter } from '@gobing-ai/ts-db';
import { EventBus } from '@gobing-ai/ts-infra';
import { decisionLogSink } from '../../src/decision/decision-log';
import { getDecisionService } from '../../src/decision/decision-service';
import type { SystemEventBus } from '../../src/services/system-event-tap';

const roots: string[] = [];

afterAll(async () => {
    await Promise.all(roots.map(async (root) => await rm(root, { recursive: true, force: true })));
});

describe('served decision ledger identity (task 1263 R1)', () => {
    test('AC1: the result carries the invocation id and digest every ledger row uses', async () => {
        const root = await mkdtemp(join(tmpdir(), 'spur-decision-identity-'));
        roots.push(root);
        const shared = join(root, 'shared', 'decisions');
        await mkdir(shared, { recursive: true });
        await writeFile(
            join(shared, 'base.yaml'),
            [
                'version: 1',
                'defaults:',
                '    minConfidence: 0.8',
                '    maker: typesafe',
                'decisions:',
                '    pick-lane:',
                '        type: choice',
                '        criteria:',
                '            fast: go fast',
                '            slow: go slow',
                '        fallback: slow',
                '',
            ].join('\n'),
        );
        const adapter = await createDbAdapter({ driver: 'bun-sqlite', url: ':memory:' });
        await applyCliMigrations(adapter);
        const sink = decisionLogSink(adapter, null, {} as never);
        expect(sink).toBeDefined();

        const events: Array<{ name: string; payload: Record<string, unknown> }> = [];
        const bus = new EventBus<Record<string, (event: unknown) => void>>();
        for (const name of ['decision.start', 'decision.success', 'decision.failure', 'decision.end']) {
            bus.on(name, (event) => events.push({ name, payload: event as Record<string, unknown> }));
        }

        // A maker double over the hub seam: the service under test keeps its real resolution,
        // evidence digest and ledger writes.
        const spy = spyOn(DecisionHub.prototype, 'decide').mockResolvedValue({
            id: 'pick-lane',
            type: 'choice',
            value: 'fast',
            confidence: 0.93,
            source: 'model',
            reason: 'accepted',
            maker: 'typesafe',
            durationMs: 4,
        } as never);
        let served: Record<string, unknown>;
        try {
            const service = await getDecisionService(null as never, root, join(root, 'shared'));
            served = (await service.decide(
                'pick-lane',
                { instructions: 'the change set' },
                {
                    bus: bus as unknown as SystemEventBus,
                    ...(sink !== undefined ? { decisionLog: { sink } } : {}),
                    context: { caller: 'cli' },
                },
            )) as unknown as Record<string, unknown>;
        } finally {
            spy.mockRestore();
        }

        const start = events.find((event) => event.name === 'decision.start')?.payload;
        const end = events.find((event) => event.name === 'decision.end')?.payload;
        expect(start?.invocationId).toEqual(expect.any(String));
        // The served result is the join key for every ledger row of this invocation.
        expect(served.invocationId).toBe(start?.invocationId as string);
        expect(end?.invocationId).toBe(start?.invocationId as string);
        expect(served.evidenceDigest).toEqual(expect.stringMatching(/^sha256:/));
        expect(served.evidenceDigest).toBe(start?.evidenceDigest as string);

        // The decision_logs row is keyed by the same id (the row is written asynchronously).
        const rows = await new DecisionLogDao(adapter).list({ limit: 5 });
        expect(rows.rows.map((row) => row.id)).toEqual([start?.invocationId as string]);
        adapter.close();
    });

    test('AC1: a decide row written by the action carries both fields', async () => {
        // The runner maps the served result onto the frozen schemaVersion-1 row; the fields the
        // outcome verb reads back from the resultFile must survive that mapping.
        const { DecideActionRunner } = await import('../../src/workflow/actions/decide');
        const writes: Record<string, string> = {};
        const fs = {
            readFile: async () => '',
            writeFile: async (path: string, content: string) => {
                writes[path] = content;
            },
            stat: async () => null,
        } as never;
        const runner = new DecideActionRunner(fs, {
            enabled: true,
            decisionService: async () =>
                ({
                    describe: () => ({ id: 'pick-lane', type: 'choice', fallback: 'slow', parameters: [] }),
                    decide: async () => ({
                        id: 'pick-lane',
                        type: 'choice',
                        value: 'fast',
                        maker: 'typesafe',
                        makerSource: 'catalog-default',
                        confidence: 0.93,
                        source: 'model',
                        reason: 'accepted',
                        durationMs: 4,
                        invocationId: 'inv-1',
                        evidenceDigest: 'sha256:abc',
                    }),
                }) as never,
        });
        const result = await runner.execute(
            { id: 'lane-gate', decision: 'pick-lane', resultFile: 'out/lane.json' },
            { runId: 'run-1', stateOrNodeId: 'gate', workdir: '.', vars: {}, env: {} },
        );
        expect(result.ok).toBe(true);
        expect(JSON.parse(writes['out/lane.json'] ?? '{}')).toMatchObject({
            invocationId: 'inv-1',
            evidenceDigest: 'sha256:abc',
        });
    });
});
