import { describe, expect, test } from 'bun:test';
import { mockRuntime, noopChild } from './helpers';

describe('mockRuntime', () => {
    test('produces a usable ApplicationRuntime mock', () => {
        const rt = mockRuntime();
        expect(rt).toBeDefined();
        rt.logger.info('test');
        rt.logger.child({}).info('test');
        rt.events.emit('scheduler.job.executed', { name: 'test', durationMs: 1, severity: 'info' });
        rt.stop();
    });
});

describe('noopChild', () => {
    test('returns a logger-like object', () => {
        const child = noopChild();
        expect(child).toBeDefined();
        child.info?.();
        child.warn?.();
        child.error?.();
        const grandchild = child.child;
        expect(typeof grandchild).toBe('function');
    });
});
