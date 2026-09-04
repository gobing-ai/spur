import { describe, expect, test } from 'bun:test';
import {
    type HistoryInsightsResponse,
    type HistorySessionsResponse,
    type HistorySourcesResponse,
    type HistorySummaryResponse,
    type HistoryTimelineResponse,
    type HistoryToolSequenceResponse,
    historyInsightsResponseDataSchema,
    historySessionsResponseDataSchema,
    historySourcesResponseDataSchema,
    historySummaryResponseDataSchema,
    historyTimelineResponseDataSchema,
    historyToolSequenceResponseDataSchema,
} from '@gobing-ai/spur-contracts';
import { MockHistoryBoardService } from '../../src';

/**
 * 0745 R3 — every History endpoint returns the same response shape the contract
 * declares. The shape is compared against the contract zod schemas (NOT
 * hand-written literals), so a field added, removed, or retyped in
 * packages/contracts/src/history.ts fails the assertion.
 *
 * Each assertion is two-sided:
 *   - compile-time: the service result is assigned to the contract data type, so
 *     a retyped or added-but-missing field breaks the build;
 *   - runtime: the returned object's keys exactly match the contract schema's
 *     keys, so an added or removed field is caught even without a type error.
 */

type ContractSchema = { shape: Record<string, unknown> };

function assertExactShape(data: object, schema: ContractSchema): void {
    const actual = Object.keys(data).sort();
    const expected = Object.keys(schema.shape).sort();
    expect(actual).toEqual(expected);
}

describe('History response shape matches the contract (0745 R1/R2/R3)', () => {
    const service = new MockHistoryBoardService();

    test('Summary endpoint returns exactly the contract data keys', async () => {
        const data: HistorySummaryResponse['data'] = await service.getSummary({ range: '30d' });
        assertExactShape(data as object, historySummaryResponseDataSchema as unknown as ContractSchema);
    });

    test('Timeline endpoint returns exactly the contract data keys', async () => {
        const data: HistoryTimelineResponse['data'] = await service.getTimeline({ mode: 'consolidated' });
        assertExactShape(data as object, historyTimelineResponseDataSchema as unknown as ContractSchema);
    });

    test('Sessions endpoint returns exactly the contract data keys', async () => {
        const data: HistorySessionsResponse['data'] = await service.getSessions({ page: 1, pageSize: 10 });
        assertExactShape(data as object, historySessionsResponseDataSchema as unknown as ContractSchema);
    });

    test('Insights endpoint returns exactly the contract data keys', async () => {
        const data: HistoryInsightsResponse['data'] = await service.getInsights({ range: '30d' });
        assertExactShape(data as object, historyInsightsResponseDataSchema as unknown as ContractSchema);
    });

    test('Sources endpoint returns exactly the contract data keys', async () => {
        const data: HistorySourcesResponse['data'] = await service.getSources();
        assertExactShape(data as object, historySourcesResponseDataSchema as unknown as ContractSchema);
    });

    test('Tool Using endpoint returns exactly the contract data keys', async () => {
        const data: HistoryToolSequenceResponse['data'] = await service.getToolSequence({
            mode: 'consolidated',
            status: 'all',
        });
        assertExactShape(data as object, historyToolSequenceResponseDataSchema as unknown as ContractSchema);
    });
});
