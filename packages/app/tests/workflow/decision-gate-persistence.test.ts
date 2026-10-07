/**
 * Persisted gate-evidence fallback rows through the real run tap (task 1106 R2).
 *
 * The bus-level lifecycle assertion lives in decision-gate-catalog.test.ts with
 * a recording bus; the proof that the same rows reach `system_events` must not
 * rely on a gitignored artifact (the .spur/run/1099-gate.json gap this task
 * closes). This wires registerSystemEventTap over in-memory SQLite, runs the
 * same no-backend gate-evidence fallback, and asserts the persisted rows:
 * decision source family, run_id from the nested correlation.runId, caller
 * `gate`, one shared invocationId in lifecycle order, and the no-backend
 * fallback shape. The no-backend fallback IS the tested path — no model maker
 * is stubbed (anti-pattern per task spec).
 */
import { describe, expect, test } from 'bun:test';
import { join } from 'node:path';
import { getEnvVar, setEnvVar } from '@gobing-ai/spur-config';
import type { ActionRunRow } from '@gobing-ai/spur-domain';
import { applyCliMigrations, SystemEventDao, type SystemEventRow } from '@gobing-ai/spur-domain';
import { createDbAdapter } from '@gobing-ai/ts-db';
import type { HitlRequest } from '@gobing-ai/ts-dual-workflow-engine';
import { EventBus } from '@gobing-ai/ts-infra';
import { DecisionService } from '../../src/decision/decision-service';
import { registerSystemEventTap } from '../../src/services/system-event-tap';
import {
    type DecisionConfig,
    type DecisionEvaluationDeps,
    type DecisionEvaluationResult,
    evaluateDecision,
} from '../../src/workflow/decision-hitl-responder';

const CONFIRM: HitlRequest = { kind: 'confirm', prompt: 'Ship the batch?', runId: 'run-gate', node: 'approve-gate' };

const EVIDENCE_CONFIRM: DecisionConfig = {
    mode: 'evidence',
    statusVar: 'gateStatus',
    evidenceNodes: ['build'],
};

function producerRow(): ActionRunRow {
    return {
        id: 'a1',
        node: 'build',
        kind: 'shell',
        status: 'done',
        ok: 1,
        duration_ms: 1,
        result_json: JSON.stringify({ data: { stdout: '10 passed' } }),
        started_at: null,
        completed_at: '2026-01-01T00:00:00Z',
        created_at: 0,
    };
}

function gateDeps(overrides: Partial<DecisionEvaluationDeps> = {}): DecisionEvaluationDeps {
    return { enabled: true, evidence: async () => [producerRow()], ...overrides };
}

describe('gate-evidence fallback persistence through the run tap (1106 R2)', () => {
    test('no-backend fallback persists start → failure → end rows to system_events', async () => {
        const repoRoot = join(import.meta.dir, '..', '..', '..', '..');
        const service = await DecisionService.create(null, repoRoot, join(repoRoot, 'config'));
        const adapter = await createDbAdapter({ driver: 'bun-sqlite', url: ':memory:' });
        await applyCliMigrations(adapter);
        const dao = new SystemEventDao(adapter);
        const bus = new EventBus();
        const tap = registerSystemEventTap(bus, dao, { warn: () => {}, debug: () => {} });

        // No decision backend: the typesafe maker needs TYPESAFE_API_KEY. Env is
        // seeded/restored through the config gateway (env-var-hygiene rule); the
        // registry only memoises successful factories, so removing the key around
        // the call keeps this deterministic on machines that export one.
        const saved = getEnvVar('TYPESAFE_API_KEY');
        setEnvVar('TYPESAFE_API_KEY', undefined);
        let result: DecisionEvaluationResult;
        try {
            result = await evaluateDecision(
                CONFIRM,
                EVIDENCE_CONFIRM,
                gateDeps({ decisionService: () => Promise.resolve(service), bus }),
            );
        } finally {
            setEnvVar('TYPESAFE_API_KEY', saved);
        }
        expect(result.kind).toBe('deferred');
        expect(result.provenance.reason).toBe('no-backend');
        await tap.flush();

        const rows: SystemEventRow[] = await dao.query({
            names: ['decision.start', 'decision.failure', 'decision.end'],
        });
        // query() is newest-first; lifecycle order is the monotonic sequence.
        const ordered = [...rows].sort((a, b) => (a.sequence ?? 0) - (b.sequence ?? 0));
        expect(ordered.map((row) => row.event_name)).toEqual(['decision.start', 'decision.failure', 'decision.end']);

        // Correlation: run_id is populated from the nested correlation.runId, and
        // every row belongs to the decision source family.
        for (const row of ordered) {
            expect(row.run_id).toBe('run-gate');
            expect(row.event_name.startsWith('decision.')).toBe(true);
        }

        // One shared invocationId across the lifecycle rows, in sequence order.
        // Persisted payloads use the tap's envelope shape — the retained event
        // fields live under `data` (flat fallback for the raw-payload shape).
        const envelopes = ordered.map((row) => JSON.parse(row.payload_json ?? '{}') as Record<string, unknown>);
        const payloads = envelopes.map((envelope) => {
            const data = envelope.data;
            return typeof data === 'object' && data !== null ? (data as Record<string, unknown>) : envelope;
        });
        expect(new Set(payloads.map((payload) => payload.invocationId)).size).toBe(1);

        const [start, failure, end] = payloads as Array<Record<string, unknown> | undefined>;
        expect(start).toBeDefined();
        expect(failure).toBeDefined();
        expect(end).toBeDefined();
        if (!start || !failure || !end) return;
        expect(start.caller).toBe('gate');
        expect(start.minConfidence).toBe(0.7);
        expect(start.makerSource).toBe('catalog-default');
        expect((start.correlation as Record<string, unknown>).nodeId).toBe('approve-gate');
        expect(failure.reason).toBe('no-backend');
        expect(failure.fallbackValue).toBe('defer');
        expect(end.source).toBe('default');

        tap.unsubscribe();
    });
});
