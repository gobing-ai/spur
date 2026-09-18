import { expect, test } from 'bun:test';
import { isRfc3339Timestamp } from '../src/rfc3339';

test('accepts canonical RFC 3339 shapes', () => {
    expect(isRfc3339Timestamp('2026-01-15T10:30:00Z')).toBe(true);
    expect(isRfc3339Timestamp('2026-01-15T10:30:00.123Z')).toBe(true);
    expect(isRfc3339Timestamp('2026-01-15T10:30:00+08:00')).toBe(true);
    expect(isRfc3339Timestamp('2026-01-15T10:30:00-05:00')).toBe(true);
});

test('accepts the lowercase t/z spellings the pattern encodes', () => {
    expect(isRfc3339Timestamp('2026-01-15t10:30:00z')).toBe(true);
    expect(isRfc3339Timestamp('2026-01-15t10:30:00+00:00')).toBe(true);
});

test('rejects malformed shapes', () => {
    expect(isRfc3339Timestamp('')).toBe(false);
    expect(isRfc3339Timestamp('2026-01-15')).toBe(false);
    expect(isRfc3339Timestamp('2026-01-15 10:30:00Z')).toBe(false);
    expect(isRfc3339Timestamp('2026-01-15T10:30:00')).toBe(false);
    expect(isRfc3339Timestamp('2026-01-15T10:30Z')).toBe(false);
    expect(isRfc3339Timestamp('2026-01-15T10:30:00+0800')).toBe(false);
    expect(isRfc3339Timestamp('20260115T103000Z')).toBe(false);
});

test('rejects shape-valid values that do not parse as real dates', () => {
    expect(isRfc3339Timestamp('2026-13-01T00:00:00Z')).toBe(false);
    expect(isRfc3339Timestamp('2026-01-32T00:00:00Z')).toBe(false);
    expect(isRfc3339Timestamp('2026-01-15T25:00:00Z')).toBe(false);
});
