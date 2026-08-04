registerHappyDom();

import { afterAll, describe, expect, test } from 'bun:test';
import { appendFrame, type Frame, nextBackoff, parseFrame, streamUrl } from '../../src/lib/process-stream';
import { registerHappyDom, teardownHappyDom } from '../happy-dom';

afterAll(async () => {
    await teardownHappyDom();
});

describe('parseFrame', () => {
    test('accepts a well-formed stdout frame with seq', () => {
        const f = parseFrame({ stream: 'stdout', ts: '2026-01-01T00:00:00Z', line: 'hello', seq: 5 });
        expect(f).toEqual({ stream: 'stdout', ts: '2026-01-01T00:00:00Z', line: 'hello', seq: 5 });
    });

    test('accepts a meta frame without seq', () => {
        const f = parseFrame({ stream: 'meta', ts: '2026-01-01T00:00:00Z', line: '--replay-done--' });
        expect(f).toEqual({ stream: 'meta', ts: '2026-01-01T00:00:00Z', line: '--replay-done--' });
    });

    test('rejects null / non-object / missing fields', () => {
        expect(parseFrame(null)).toBeNull();
        expect(parseFrame('string')).toBeNull();
        expect(parseFrame({ stream: 'stdout' })).toBeNull();
        expect(parseFrame({ stream: 'stdout', ts: 'x' })).toBeNull();
        expect(parseFrame({ stream: 'invalid', ts: 'x', line: 'y' })).toBeNull();
    });

    test('rejects non-number seq', () => {
        expect(parseFrame({ stream: 'stdout', ts: 'x', line: 'y', seq: '5' })).toBeNull();
    });
});

describe('appendFrame', () => {
    test('appends a stdout frame with seq > lastSeq and updates watermark', () => {
        const result = appendFrame([], { stream: 'stdout', ts: 'x', line: 'a', seq: 1 }, -1);
        expect(result.frames).toHaveLength(1);
        expect(result.lastSeq).toBe(1);
    });

    test('drops a frame with seq <= lastSeq (dedup, R6)', () => {
        const result = appendFrame([], { stream: 'stdout', ts: 'x', line: 'dup', seq: 1 }, 1);
        expect(result.frames).toHaveLength(0);
        expect(result.lastSeq).toBe(1);
    });

    test('always appends meta frames (no seq)', () => {
        const result = appendFrame([], { stream: 'meta', ts: 'x', line: '--replay-done--' }, 5);
        expect(result.frames).toHaveLength(1);
        expect(result.lastSeq).toBe(5);
    });

    test('caps the buffer at MAX_FRAMES (1000)', () => {
        let frames: Frame[] = [];
        let lastSeq = -1;
        for (let i = 0; i < 1050; i++) {
            const r = appendFrame(frames, { stream: 'stdout', ts: 'x', line: `l${i}`, seq: i }, lastSeq);
            frames = r.frames;
            lastSeq = r.lastSeq;
        }
        expect(frames.length).toBe(1000);
        expect(lastSeq).toBe(1049);
    });
});

describe('nextBackoff', () => {
    test('returns 1s for attempt 0', () => {
        expect(nextBackoff(0)).toBe(1000);
    });

    test('schedules exponentially: 1s, 2s, 4s, 8s', () => {
        expect(nextBackoff(1)).toBe(2000);
        expect(nextBackoff(2)).toBe(4000);
        expect(nextBackoff(3)).toBe(8000);
    });

    test('caps at 15s', () => {
        expect(nextBackoff(4)).toBe(15_000);
        expect(nextBackoff(10)).toBe(15_000);
    });

    test('returns 1s for negative attempt (safety)', () => {
        expect(nextBackoff(-1)).toBe(1000);
    });
});

describe('streamUrl', () => {
    test('includes sinceSeq for resume on reconnect', () => {
        const url = streamUrl('alpha-claude', 42);
        expect(url).toContain('/team/processes/alpha-claude/stream');
        expect(url).toContain('sinceSeq=42');
    });

    test('omits sinceSeq for initial attach', () => {
        const url = streamUrl('alpha-claude');
        expect(url).toContain('/team/processes/alpha-claude/stream');
        expect(url).not.toContain('sinceSeq');
    });
});
