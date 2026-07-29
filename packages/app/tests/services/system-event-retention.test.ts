import { describe, expect, test } from 'bun:test';
import { SYSTEM_EVENT_PREFIXES } from '../../src/services/event-names';
import {
    DEFAULT_SYSTEM_EVENT_RETENTION_QUOTA,
    resolveRetentionQuotas,
} from '../../src/services/system-event-retention';

describe('resolveRetentionQuotas (R3 — configuration, not compiled constants)', () => {
    test('applies the documented default to every catalog prefix when config is empty', () => {
        const quotas = resolveRetentionQuotas();
        // One quota per catalog prefix — no prefix left unbounded.
        expect(quotas.map((q) => q.prefix).sort()).toEqual([...SYSTEM_EVENT_PREFIXES].sort());
        // Every quota equals the documented compiled-in default fallback.
        for (const { quota } of quotas) {
            expect(quota).toBe(DEFAULT_SYSTEM_EVENT_RETENTION_QUOTA);
        }
    });

    test('default override changes the fallback for prefixes without an explicit override', () => {
        const quotas = resolveRetentionQuotas({ default: 5000 });
        for (const { quota } of quotas) {
            expect(quota).toBe(5000);
        }
    });

    test('per-prefix override wins over default and leaves siblings untouched', () => {
        const quotas = resolveRetentionQuotas({
            default: 5000,
            prefixes: { task: 2000, feature: 3000 },
        });
        expect(quotas.find((q) => q.prefix === 'task')?.quota).toBe(2000);
        expect(quotas.find((q) => q.prefix === 'feature')?.quota).toBe(3000);
        // A sibling without an override falls back to default, not the override.
        expect(quotas.find((q) => q.prefix === 'queue')?.quota).toBe(5000);
    });

    test('ignores override keys for prefixes not in the catalog (no unbounded bucket)', () => {
        const quotas = resolveRetentionQuotas({
            default: 1000,
            prefixes: { nonExistentPrefix: 999_999 },
        });
        // Unknown prefix must not appear in the resolved quotas.
        expect(quotas.find((q) => q.prefix === 'nonExistentPrefix')).toBeUndefined();
        // Known prefixes still resolve to the default.
        expect(quotas.find((q) => q.prefix === 'task')?.quota).toBe(1000);
    });
});
