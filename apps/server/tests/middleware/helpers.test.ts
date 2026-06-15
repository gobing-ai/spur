import { describe, expect, test } from 'bun:test';
import { mockRuntime, noopChild } from './helpers';

describe('mockRuntime', () => {
    test('produces a usable ApplicationRuntime mock', () => {
        const rt = mockRuntime();
        expect(rt).toBeDefined();
        rt.logger.info('test');
        rt.logger.child().info('test');
        rt.events.emit();
        rt.stop();
    });
});

describe('noopChild', () => {
    test('returns a logger-like object', () => {
        const child = noopChild();
        expect(child).toBeDefined();
        child.info();
        child.warn();
        child.error();
        child.child().info();
    });
});
