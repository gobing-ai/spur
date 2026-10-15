/**
 * guards — the `spur task resolve` ownership child (both exit-code policies) and the host formatters.
 */

import { afterAll, beforeAll, describe, expect, test } from 'bun:test';
import { chmodSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
    formatCarefulGuardClaude,
    formatGuardPi,
    formatWriteGuardClaude,
    spurOwnershipResolver,
} from '../../src/hooks/guards';

let dir: string;
let fakeSpur: string;

beforeAll(() => {
    dir = mkdtempSync(join(tmpdir(), 'spur-guards-'));
    fakeSpur = join(dir, 'spur');
    // Exit code is chosen by the path: …owned… → 0, …broken… → 127, anything else → 1.
    writeFileSync(
        fakeSpur,
        '#!/bin/sh\necho "$@" > "$(dirname "$0")/argv.txt"\ncase "$3" in *owned*) exit 0;; *broken*) exit 127;; *) exit 1;; esac\n',
    );
    chmodSync(fakeSpur, 0o755);
});

afterAll(() => rmSync(dir, { recursive: true, force: true }));

describe('spurOwnershipResolver', () => {
    test('maps exit 0 → owned and 1 → unowned under both policies', () => {
        for (const strict of [false, true]) {
            const resolver = spurOwnershipResolver([fakeSpur], strict);
            expect(resolver('/p/owned/0001_a.md', dir)).toBe('owned');
            expect(resolver('/p/free/0001_a.md', dir)).toBe('unowned');
        }
    });

    test('a broken interpreter (127) is unowned for Claude but unknown for Pi', () => {
        expect(spurOwnershipResolver([fakeSpur])('/p/broken/0001_a.md', dir)).toBe('unowned');
        expect(spurOwnershipResolver([fakeSpur], true)('/p/broken/0001_a.md', dir)).toBe('unknown');
    });

    test('a missing binary is unknown; an argv prefix is passed before the verb', () => {
        expect(spurOwnershipResolver([join(dir, 'does-not-exist')])('/p/0001_a.md', dir)).toBe('unknown');
        // `/bin/sh <script>` keeps the script's positional args, so the verb still lands at $1..$3.
        expect(spurOwnershipResolver(['/bin/sh', fakeSpur])('/p/owned/0001_a.md', dir)).toBe('owned');
        expect(readFileSync(join(dir, 'argv.txt'), 'utf-8').trim()).toBe(
            'task resolve /p/owned/0001_a.md --strict --json',
        );
    });
});

describe('formatters', () => {
    test('match the plugin hook shapes byte-for-byte', () => {
        expect(formatWriteGuardClaude({ decision: 'allow' })).toBe(
            '{"hookSpecificOutput":{"hookEventName":"PreToolUse","permissionDecision":"allow"}}',
        );
        expect(formatWriteGuardClaude({ decision: 'deny', reason: 'r' })).toBe(
            '{"hookSpecificOutput":{"hookEventName":"PreToolUse","permissionDecision":"deny"},"systemMessage":"r"}',
        );
        expect(formatCarefulGuardClaude({ decision: 'ask', reason: 'r' })).toBe(
            '{"hookSpecificOutput":{"hookEventName":"PreToolUse","permissionDecision":"ask","permissionDecisionReason":"r"},"systemMessage":"r"}',
        );
        expect(formatGuardPi({ decision: 'allow' })).toBe('{"action":"allow"}');
        expect(formatGuardPi({ decision: 'deny', reason: 'r' })).toBe('{"action":"deny","reason":"r"}');
    });
});
