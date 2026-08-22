import { describe, expect, test } from 'bun:test';
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import {
    fmtDur,
    fmtInt,
    fmtMs,
    fmtPct,
    fmtTok,
    fmtTokAxis,
    niceTicks,
    resolveAutoBucket,
} from '../../../src/modules/history/charts';
import { module as historyModule } from '../../../src/modules/history/index';
import { HISTORY_TABS, type HistoryTab } from '../../../src/modules/history/tabs';

describe('History Board Web Module', () => {
    test('module metadata adheres to WebModule contract', () => {
        expect(historyModule.id).toBe('history');
        expect(historyModule.name).toBe('History');
        expect(historyModule.route).toBe('history');
        expect(historyModule.sidebarLabel).toBe('History');
        expect(historyModule.icon).toBe('📊');
        expect(historyModule.order).toBe(3);
        expect(historyModule.component).toBeDefined();
    });

    test('HISTORY_TABS declares exactly the 5 append-only tabs', () => {
        const tabIds = HISTORY_TABS.map((t: HistoryTab) => t.id);
        expect(tabIds).toEqual(['summary', 'timeline', 'sessions', 'insights', 'sources']);
    });

    test('resolveAutoBucket maps time range to bucket granularity', () => {
        expect(resolveAutoBucket('24h')).toBe('10m');
        expect(resolveAutoBucket('7d')).toBe('30m');
        expect(resolveAutoBucket('30d')).toBe('1d');
        expect(resolveAutoBucket('all')).toBe('1d');
        expect(resolveAutoBucket('custom')).toBe('1d');
    });

    test('formatting and scale utilities produce formatted strings', () => {
        expect(fmtTok(0)).toBe('0');
        expect(fmtTok(500)).toBe('500');
        expect(fmtTok(1500)).toBe('1.5K');
        expect(fmtTok(2500000)).toBe('2.5M');

        expect(fmtTokAxis(0)).toBe('0');
        expect(fmtTokAxis(1000)).toBe('1K');
        expect(fmtTokAxis(2000000)).toBe('2M');

        expect(fmtInt(1234)).toBe('1,234');
        expect(fmtPct(85.42)).toBe('85.4%');
        expect(fmtDur(0.5)).toBe('<1m');
        expect(fmtDur(45)).toBe('45m');
        expect(fmtDur(135)).toBe('2h 15m');
        expect(fmtMs(450)).toBe('450ms');
        expect(fmtMs(3500)).toBe('3.5s');

        const ticks = niceTicks(100, 4);
        expect(ticks.length).toBeGreaterThanOrEqual(4);
        expect(ticks[0]).toBe(0);
        expect(ticks[ticks.length - 1]).toBeGreaterThanOrEqual(100);
    });

    test('pure token rule: zero currency or dollar fields in web history module', () => {
        const moduleDir = join(import.meta.dir, '../../../src/modules/history');
        const files = readdirSync(moduleDir).filter((f) => f.endsWith('.ts') || f.endsWith('.tsx'));

        const currencyRegex = /\b(costUsd|cost|usd|dollar|currency|price)\b/i;

        for (const file of files) {
            const content = readFileSync(join(moduleDir, file), 'utf-8');
            const lines = content.split('\n');
            lines.forEach((line, idx) => {
                const match = line.match(currencyRegex);
                if (match) {
                    throw new Error(
                        `Forbidden currency keyword "${match[0]}" found in ${file}:${idx + 1}: ${line.trim()}`,
                    );
                }
            });
        }
    });
});
