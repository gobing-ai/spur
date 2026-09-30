/**
 * spur-bin lib rung test (task 1007 R9; review round 1 F1).
 *
 * Pins `defaultSpurBin()`'s monorepo rung: the relative walk from
 * `plugins/sp/lib/` must land on this repo's CLI entry, not fall through to
 * bare `spur`. The twin embeds the same literal (workflow-step-profile.mjs);
 * parity is owned by script-contract-check, this suite owns resolution.
 */

import { describe, expect, test } from 'bun:test';
import { existsSync } from 'node:fs';
import { removeEnvVar, setEnvVar } from '../lib/env';
import { defaultSpurBin, spurCommand } from '../lib/spur-bin';

describe('spur-bin lib', () => {
    test('defaultSpurBin honours SPUR_BIN', () => {
        setEnvVar('SPUR_BIN', 'bun /custom/spur.ts');
        try {
            expect(defaultSpurBin()).toBe('bun /custom/spur.ts');
        } finally {
            removeEnvVar('SPUR_BIN');
        }
    });

    test('defaultSpurBin resolves the monorepo rung to the existing CLI entry', () => {
        removeEnvVar('SPUR_BIN');
        try {
            const resolved = defaultSpurBin();
            expect(resolved.startsWith('bun ')).toBe(true);
            const cliEntry = resolved.slice('bun '.length);
            expect(existsSync(cliEntry)).toBe(true);
            expect(cliEntry.endsWith('apps/cli/src/index.ts')).toBe(true);
        } finally {
            removeEnvVar('SPUR_BIN');
        }
    });

    test('spurCommand splits command and prefix args', () => {
        expect(spurCommand('bun /x/y.ts')).toEqual({ cmd: 'bun', prefix: ['/x/y.ts'] });
        expect(spurCommand(undefined)).toEqual({ cmd: 'spur', prefix: [] });
    });
});
