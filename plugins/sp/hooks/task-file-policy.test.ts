/**
 * task-file-policy — the pre-filter must never disagree with the corpus filename
 * convention it stands in for.
 *
 * The guard skips its `spur task resolve --strict` subprocess when this predicate
 * returns false, so a false negative here is a silently disabled guard. The last
 * block reads the convention straight out of `task-locator.ts` and fails if the two
 * drift apart.
 */
import { describe, expect, test } from 'bun:test';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { couldBeTaskFile } from './task-file-policy';

describe('couldBeTaskFile — matches the corpus convention', () => {
    test('accepts a task file basename', () => {
        expect(couldBeTaskFile('0042_add-widget.md')).toBe(true);
        expect(couldBeTaskFile('docs/tasks/0042_add-widget.md')).toBe(true);
        expect(couldBeTaskFile('/abs/path/docs/tasks2/0564_forensic-report.md')).toBe(true);
        expect(couldBeTaskFile('docs\\tasks\\0042_windows-path.md')).toBe(true);
    });

    test('rejects ordinary source paths — these skip the subprocess', () => {
        for (const p of [
            'packages/app/src/services/agent-service.ts',
            'apps/web/src/modules/task-kanban/TaskDetail.tsx',
            'README.md',
            'docs/00_ADR.md',
            'plugins/sp/hooks/careful-guard.ts',
            '.spur/config.yaml',
        ]) {
            expect(couldBeTaskFile(p), p).toBe(false);
        }
    });

    test('rejects near-misses on the convention', () => {
        expect(couldBeTaskFile('042_three-digits.md')).toBe(false);
        expect(couldBeTaskFile('00420_five-digits.md')).toBe(false); // five digits then `0_`… still not <4>_
        expect(couldBeTaskFile('0042-dash-not-underscore.md')).toBe(false);
        expect(couldBeTaskFile('0042_no-extension')).toBe(false);
        expect(couldBeTaskFile('0042_wrong-ext.txt')).toBe(false);
        expect(couldBeTaskFile('0042_.md')).toBe(false); // empty slug
        expect(couldBeTaskFile('')).toBe(false);
    });

    test('every real task file in this repo passes the pre-filter', () => {
        // A single miss here is a guard that silently stops protecting part of the corpus.
        const { readdirSync, existsSync } = require('node:fs') as typeof import('node:fs');
        const folders = ['docs/tasks', 'docs/tasks2', 'docs/tasks3'].filter((d) => existsSync(d));
        expect(folders.length).toBeGreaterThan(0);
        const missed: string[] = [];
        let checked = 0;
        for (const dir of folders) {
            for (const name of readdirSync(dir)) {
                if (!/^\d{4}_.*\.md$/.test(name)) continue;
                checked++;
                if (!couldBeTaskFile(join(dir, name))) missed.push(join(dir, name));
            }
        }
        expect(checked).toBeGreaterThan(0);
        expect(missed).toEqual([]);
    });

    test('stays in lockstep with TASK_FILENAME_RE in task-locator.ts', () => {
        // The predicate exists only because it mirrors the locator's convention;
        // if the locator's regex changes, this test is the tripwire.
        const locator = readFileSync('packages/app/src/services/task-locator.ts', 'utf8');
        expect(locator).toContain('const TASK_FILENAME_RE = /^(\\d{4})_(.+)\\.md$/;');
    });
});
