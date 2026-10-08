import { describe, expect, test } from 'bun:test';
import { applyCliMigrations, DecisionLogDao } from '@gobing-ai/spur-domain';
import type { DbAdapter } from '@gobing-ai/ts-db';
import { createDbAdapter } from '@gobing-ai/ts-db';
import type { DecisionLogRecord } from '../../src/decision/decision-log';
import {
    buildDecisionLogRow,
    DECISION_LOG_SCHEMA_VERSION,
    decisionLogSink,
    writeDecisionLog,
} from '../../src/decision/decision-log';
import { DecisionLogQueryService } from '../../src/decision/decision-log-query';

const SECRETS = ['s3cret-value'];

function sink(mode: 'full' | 'metadata' = 'full', warn?: (message: string) => void) {
    return {
        dao: new DecisionLogDao({} as DbAdapter),
        secrets: SECRETS,
        mode,
        ...(warn !== undefined ? { warn } : {}),
    };
}

function record(overrides: Partial<DecisionLogRecord> = {}): DecisionLogRecord {
    return {
        id: 'dcl_it_1',
        decisionId: 'publish.pr',
        caller: 'cli',
        outcome: 'accepted',
        value: 'ship',
        source: 'model',
        reason: 'confidence',
        confidence: 0.9,
        startedAtMs: Date.parse('2026-07-04T01:00:00.000Z'),
        endedAtMs: Date.parse('2026-07-04T01:00:01.000Z'),
        phases: [{ phase: 'maker', startedAt: 1000, durationMs: 900 }],
        ...overrides,
    };
}

describe('decision log row builder', () => {
    test('accepted rows store the value and never the fallback; source rules hold', () => {
        const row = buildDecisionLogRow(sink(), record({ fallbackValue: 'default-pr' }));
        expect(row.outcome).toBe('accepted');
        expect(row.value).toBe('ship');
        expect(row.source).toBe('model');
        expect(row.fallback_value).toBeNull();
        expect(row.duration_ms).toBe(1000);
        expect(row.started_at).toBe('2026-07-04T01:00:00.000Z');
        expect(row.schema_version).toBe(DECISION_LOG_SCHEMA_VERSION);
    });

    test('fallback rows prefer the declared fallback value over the served one', () => {
        const row = buildDecisionLogRow(
            sink(),
            record({
                outcome: 'fallback',
                value: 'served',
                fallbackValue: 'declared',
                source: 'default',
                reason: 'low-confidence',
            }),
        );
        expect(row.value).toBe('served');
        expect(row.fallback_value).toBe('declared');
        expect(row.source).toBe('default');
    });

    test('rejected rows null value/source and keep the redacted error', () => {
        const row = buildDecisionLogRow(
            sink(),
            record({
                outcome: 'rejected',
                value: undefined,
                source: undefined,
                error: 'maker exploded with s3cret-value inside',
                makerSource: 'config-default',
            }),
        );
        expect(row.value).toBeNull();
        expect(row.source).toBeNull();
        expect(row.fallback_value).toBeNull();
        expect(row.error).not.toContain('s3cret-value');
        expect(row.maker_source).toBe('config-default');
    });

    test('metadata mode nulls input and question but keeps input keys', () => {
        const input = { pr: '1', secret: 's3cret-value' };
        const full = buildDecisionLogRow(sink('full'), record({ input, question: 'ship it?' }));
        expect(full.question).toBe('ship it?');
        expect(full.input_json).not.toContain('s3cret-value');
        expect(JSON.parse(full.input_json ?? '{}')).toEqual({ pr: '1', secret: '[REDACTED]' });
        expect(full.input_keys_json).toBe('["pr","secret"]');

        const meta = buildDecisionLogRow(sink('metadata'), record({ input, question: 'ship it?' }));
        expect(meta.question).toBeNull();
        expect(meta.input_json).toBeNull();
        // Keys survive every mode so the Board can show input shape.
        expect(meta.input_keys_json).toBe('["pr","secret"]');
    });

    test('oversized input re-wraps with a truncated marker inside the bound', () => {
        const input = { blob: 'x'.repeat(20 * 1024) };
        const row = buildDecisionLogRow(sink('full'), record({ input }));
        expect(row.input_json).not.toBeNull();
        expect((row.input_json ?? '').length).toBeLessThanOrEqual(16 * 1024);
        const parsed = JSON.parse(row.input_json ?? '{}') as { truncated?: boolean };
        expect(parsed.truncated).toBe(true);
    });

    test('empty catalog layer stores null (inline rows carry no layer)', () => {
        const row = buildDecisionLogRow(sink(), record({ catalogLayer: '' }));
        expect(row.catalog_layer).toBeNull();
    });
});

describe('decisionLogSink', () => {
    test('off mode returns undefined', () => {
        expect(decisionLogSink({} as DbAdapter, { decisions: { log: 'off' } } as never, {})).toBeUndefined();
    });

    test('absent config defaults to full mode', () => {
        expect(decisionLogSink({} as DbAdapter, null, {})?.mode).toBe('full');
    });
});

describe('decision log persistence + query service', () => {
    test('written rows are readable through the query service with p95 and facets', async () => {
        const adapter = await createDbAdapter({ driver: 'bun-sqlite', url: ':memory:' });
        await applyCliMigrations(adapter);
        const dao = new DecisionLogDao(adapter);
        const liveSink = { dao, secrets: SECRETS, mode: 'full' as const };

        // 20 rows: durations 1..20ms — nearest-rank p95 over 20 samples is the 19th.
        for (let i = 1; i <= 20; i++) {
            writeDecisionLog(
                liveSink,
                buildDecisionLogRow(
                    liveSink,
                    record({
                        id: `dcl_${i}`,
                        outcome: i % 2 === 0 ? 'fallback' : 'accepted',
                        source: i % 2 === 0 ? 'default' : 'model',
                        value: `v${i}`,
                        startedAtMs: Date.parse('2026-07-04T01:00:00.000Z') + i,
                        endedAtMs: Date.parse('2026-07-04T01:00:00.000Z') + i + i,
                    }),
                ),
            );
            await new Promise<void>((resolve) => setTimeout(resolve, 0)); // let fire-and-forget inserts settle
        }
        await new Promise<void>((resolve) => setTimeout(resolve, 10));

        const service = new DecisionLogQueryService(dao);
        const page = await service.list({ decisionId: 'publish.pr', limit: 5 });
        expect(page.rows).toHaveLength(5);
        expect(page.nextCursor).not.toBeNull();
        expect(page.summary.count).toBe(20);
        expect(page.summary.acceptedRate).toBeCloseTo(0.5, 5);
        expect(page.summary.fallbackRate).toBeCloseTo(0.5, 5);
        // Nearest-rank p95: ceil(0.95*20)=19 → the 19th smallest duration.
        expect(page.summary.p95DurationMs).toBe(19);
        expect(page.facets.decisionIds).toEqual(['publish.pr']);

        const detail = await service.get('dcl_20');
        expect(detail?.outcome).toBe('fallback');
        expect(detail?.fallbackValue ?? detail?.value).toBe('v20');
        expect(detail?.phases).toEqual([{ phase: 'maker', startedAt: 1000, durationMs: 900 }]);
        expect(await service.get('dcl_missing')).toBeNull();

        // Cursor pagination resumes after the boundary.
        const page2 = await service.list({ decisionId: 'publish.pr', limit: 5, before: page.nextCursor ?? undefined });
        expect(page2.rows.map((r) => r.id)).toEqual(['dcl_15', 'dcl_14', 'dcl_13', 'dcl_12', 'dcl_11']);
        adapter.close();
    });

    test('a DAO failure reaches warn and never throws', async () => {
        const warnings: string[] = [];
        const failing = {
            dao: { insert: () => Promise.reject(new Error('db gone')) } as unknown as DecisionLogDao,
            secrets: SECRETS,
            mode: 'full' as const,
            warn: (message: string) => warnings.push(message),
        };
        writeDecisionLog(failing, buildDecisionLogRow(failing, record()));
        await new Promise<void>((resolve) => setTimeout(resolve, 10));
        expect(warnings).toHaveLength(1);
        expect(warnings[0]).toContain('db gone');
    });

    test('empty sets return zeroed summary and empty facets', async () => {
        const adapter = await createDbAdapter({ driver: 'bun-sqlite', url: ':memory:' });
        await applyCliMigrations(adapter);
        const service = new DecisionLogQueryService(new DecisionLogDao(adapter));
        const page = await service.list({});
        expect(page.rows).toEqual([]);
        expect(page.summary).toEqual({ count: 0, acceptedRate: 0, fallbackRate: 0, p95DurationMs: null });
        expect(page.facets).toEqual({ decisionIds: [], makers: [] });
        expect(page.nextCursor).toBeNull();
        adapter.close();
    });
});

describe('decisionLogP95 (nearest-rank)', () => {
    test('matches ceil(0.95n) rank and handles empty/small sets', async () => {
        const { decisionLogP95 } = await import('../../src/decision/decision-log-query');
        expect(decisionLogP95([])).toBeNull();
        expect(decisionLogP95([5])).toBe(5);
        expect(decisionLogP95([1, 2, 3, 4])).toBe(4); // ceil(3.8) = 4
        expect(decisionLogP95([10, 1, 7, 3, 9, 2, 8, 6, 4, 5, 11, 12, 13, 14, 15, 16, 17, 18, 19, 100])).toBe(19);
    });
});
