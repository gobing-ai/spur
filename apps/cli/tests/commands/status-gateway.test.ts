import { describe, expect, test } from 'bun:test';
import type { SelfStatusSection } from '@gobing-ai/spur-app';
import { gatewayCountersLine } from '../../src/commands/status';

/**
 * 1385 R3 text output. The probe matrix (gateway / free port / foreign listener) is owned by the app
 * layer's `self-status-gateway` test with an injected fetch; this covers the one rendering rule the
 * CLI adds, which must never invent numbers for a section that did not answer.
 */
describe('status text — gateway counters line (1385 R3)', () => {
    const counters = {
        since: '2026-11-18T00:00:00.000Z',
        requests: 12,
        status4xx: 3,
        status5xx: 2,
        upstreamRestarts: { '/kk': 2, '/sp': 1 },
    };

    test('renders one line with the counters, summing restarts across prefixes', () => {
        const section: SelfStatusSection = {
            state: 'ready',
            scope: 'machine',
            source: 'services/project-gateway.ts',
            message: '',
            data: { port: 3000, host: 'localhost', counters },
        };
        expect(gatewayCountersLine('gateway', section)).toBe(
            '  gateway counters: requests=12 4xx=3 5xx=2 restarts=3 since=2026-11-18T00:00:00.000Z',
        );
    });

    test('renders nothing when the gateway did not answer', () => {
        const section: SelfStatusSection = {
            state: 'not-applicable',
            scope: 'machine',
            source: 'services/project-gateway.ts',
            message: 'no gateway is listening on localhost:3000; `spur serve` starts one',
            data: { port: 3000, host: 'localhost' },
        };
        expect(gatewayCountersLine('gateway', section)).toBeNull();
    });

    test('renders nothing for another section that happens to carry counters', () => {
        const section: SelfStatusSection = {
            state: 'ready',
            scope: 'project',
            source: 'services/project-registry.ts',
            message: '',
            data: { counters },
        };
        expect(gatewayCountersLine('projects', section)).toBeNull();
    });
});
