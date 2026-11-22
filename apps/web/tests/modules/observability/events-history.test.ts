/** A82 1424 — the shared `/api/events/history` URL builder. */
import { afterAll, describe, expect, test } from 'bun:test';
import { eventsHistoryUrl, HISTORY_LIMIT, historyUrl } from '../../../src/modules/observability/events-history';
import { registerHappyDom, teardownHappyDom } from '../../happy-dom';

registerHappyDom();
afterAll(teardownHappyDom);

describe('1424 — events-history URL builder', () => {
    test('is one builder, exported under both names', () => {
        expect(eventsHistoryUrl).toBe(historyUrl);
    });

    test('defaults the page size and encodes every filter', () => {
        const url = eventsHistoryUrl({
            prefix: 'mcp',
            names: 'a.b,c.d',
            runId: 'run 1',
            since: '2026-11-22T00:00:00.000Z',
        });
        expect(url).toContain('/events/history');
        expect(url).toContain(`limit=${HISTORY_LIMIT}`);
        expect(url).toContain('prefix=mcp');
        expect(url).toContain('names=a.b%2Cc.d');
        expect(url).toContain('runId=run%201');
    });

    test('an explicit limit and cursor travel through', () => {
        const url = eventsHistoryUrl({ prefix: 'a2a', limit: 50, cursor: 'next' });
        expect(url).toContain('limit=50');
        expect(url).toContain('cursor=next');
    });
});
