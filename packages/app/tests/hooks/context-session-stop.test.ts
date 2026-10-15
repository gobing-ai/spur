/**
 * context-session-stop — owner-gated session finalization (tasks 0969 R3, 1159), ported to
 * `@gobing-ai/spur-app/hooks` for `spur self hook` (script-absorption PR-2a). The full ownership
 * matrix lives in context-hooks.test.ts; this file pins the core contracts.
 */

import { afterEach, describe, expect, test } from 'bun:test';
import { appendFileSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { getEnvVar, removeEnvVar, setEnvVar } from '@gobing-ai/spur-config';
import { recordSessionEnd, recordSessionEndFromPayloadText } from '../../src/hooks/context-session-stop';

const dirs: string[] = [];
function tempDir(): string {
    const dir = mkdtempSync(join(tmpdir(), 'spur-hook-stop-'));
    dirs.push(dir);
    return dir;
}
afterEach(() => {
    for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true });
});

const OWNER = { host: 'claude' as const, sessionId: 'owner-1' };
const NOW = () => new Date('2026-10-14T12:00:00.000Z');

function seed(dir: string, owner: unknown = OWNER): void {
    writeFileSync(
        join(dir, '.session.json'),
        JSON.stringify({ session: 's-1', started: '2026-10-14T11:00:00.000Z', owner }),
    );
    appendFileSync(
        join(dir, 'token-ledger.jsonl'),
        `${JSON.stringify({ ts: 't', session: 's-1', type: 'tool_use', tokens: 5 })}\n`,
    );
}
const ledgerRows = (dir: string) =>
    readFileSync(join(dir, 'token-ledger.jsonl'), 'utf-8')
        .trim()
        .split('\n')
        .map((l) => JSON.parse(l));

describe('recordSessionEnd', () => {
    test('the recorded owner finalizes: appends one session_end row and removes the pointer', () => {
        const dir = tempDir();
        seed(dir);
        const event = recordSessionEnd(dir, NOW, OWNER);
        expect(event).toMatchObject({ session: 's-1', type: 'session_end', ts: '2026-10-14T12:00:00.000Z' });
        expect(existsSync(join(dir, '.session.json'))).toBe(false);
        expect(ledgerRows(dir).filter((r) => r.type === 'session_end')).toHaveLength(1);
    });

    test('a replay after a failed cleanup reuses the existing end row instead of duplicating it', () => {
        const dir = tempDir();
        seed(dir);
        const first = recordSessionEnd(dir, NOW, OWNER);
        seed(dir); // pointer restored as if removal had failed
        const second = recordSessionEnd(dir, NOW, OWNER);
        expect(second).toEqual(first);
        expect(ledgerRows(dir).filter((r) => r.type === 'session_end')).toHaveLength(1);
    });

    test('a missing, mismatched or ownerless identity writes nothing and keeps the pointer', () => {
        for (const [pointerOwner, caller] of [
            [OWNER, undefined],
            [OWNER, { host: 'claude', sessionId: 'someone-else' }],
            [OWNER, { host: 'pi', sessionId: 'owner-1' }],
            [null, OWNER],
        ] as const) {
            const dir = tempDir();
            seed(dir, pointerOwner);
            expect(recordSessionEnd(dir, NOW, caller as typeof OWNER | undefined)).toBeNull();
            expect(existsSync(join(dir, '.session.json'))).toBe(true);
            expect(ledgerRows(dir).some((r) => r.type === 'session_end')).toBe(false);
        }
    });

    test('no pointer, corrupt pointer or sessionless pointer → null', () => {
        const dir = tempDir();
        expect(recordSessionEnd(dir, NOW, OWNER)).toBeNull();
        writeFileSync(join(dir, '.session.json'), '{oops');
        expect(recordSessionEnd(dir, NOW, OWNER)).toBeNull();
        writeFileSync(join(dir, '.session.json'), JSON.stringify({ session: '', owner: OWNER }));
        expect(recordSessionEnd(dir, NOW, OWNER)).toBeNull();
    });
});

describe('recordSessionEndFromPayloadText', () => {
    test('resolves CLAUDE_PROJECT_DIR and finalizes only for the payload owner', () => {
        const project = tempDir();
        const dir = join(project, '.spur', 'context');
        mkdirSync(dir, { recursive: true });
        seed(dir);
        const prev = getEnvVar('CLAUDE_PROJECT_DIR');
        setEnvVar('CLAUDE_PROJECT_DIR', project);
        try {
            expect(recordSessionEndFromPayloadText('{not json', {})).toBeNull();
            expect(recordSessionEndFromPayloadText('{"session_id":"owner-1"}', {})).toMatchObject({
                type: 'session_end',
            });
        } finally {
            if (prev === undefined) removeEnvVar('CLAUDE_PROJECT_DIR');
            else setEnvVar('CLAUDE_PROJECT_DIR', prev);
        }
    });
});
