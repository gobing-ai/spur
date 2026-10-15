/**
 * context-session-start — session pointer + `session_start` ledger row (tasks 0398 R3, 0711 R4, 1159),
 * ported to `@gobing-ai/spur-app/hooks` for `spur self hook` (script-absorption PR-2a). The end-to-end
 * and idempotency suites live in context-hooks.test.ts; this file pins the unit contracts.
 */

import { afterEach, describe, expect, test } from 'bun:test';
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { getEnvVar, removeEnvVar, setEnvVar } from '@gobing-ai/spur-config';
import {
    recordSessionStart,
    recordSessionStartFromPayloadText,
    resolveActiveSession,
} from '../../src/hooks/context-session-start';

const dirs: string[] = [];
function tempDir(): string {
    const dir = mkdtempSync(join(tmpdir(), 'spur-hook-start-'));
    dirs.push(dir);
    return dir;
}
afterEach(() => {
    for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true });
});

const NOW = new Date('2026-10-14T12:00:00.000Z');

describe('resolveActiveSession', () => {
    test('null when there is no pointer or it is corrupt / sessionless', () => {
        const dir = tempDir();
        expect(resolveActiveSession(dir, NOW, {})).toBeNull();
        writeFileSync(join(dir, '.session.json'), '{oops');
        expect(resolveActiveSession(dir, NOW, {})).toBeNull();
        writeFileSync(join(dir, '.session.json'), JSON.stringify({ session: '', started: NOW.toISOString() }));
        expect(resolveActiveSession(dir, NOW, {})).toBeNull();
    });

    test('reuses a fresh pointer and retires a stale, future-dated or unparsable one', () => {
        const dir = tempDir();
        const write = (started: unknown) =>
            writeFileSync(join(dir, '.session.json'), JSON.stringify({ session: 's-1', started }));
        write(new Date(NOW.getTime() - 60_000).toISOString());
        expect(resolveActiveSession(dir, NOW, {})).toBe('s-1');
        write(new Date(NOW.getTime() - 24 * 3_600_000).toISOString());
        expect(resolveActiveSession(dir, NOW, {})).toBeNull();
        write(new Date(NOW.getTime() + 60_000).toISOString());
        expect(resolveActiveSession(dir, NOW, {})).toBeNull();
        write('not a date');
        expect(resolveActiveSession(dir, NOW, {})).toBeNull();
        write(7);
        expect(resolveActiveSession(dir, NOW, {})).toBeNull();
    });
});

describe('recordSessionStart', () => {
    test('mints a session, writes the owned pointer and appends one session_start row', () => {
        const dir = join(tempDir(), 'context');
        const id = recordSessionStart(dir, { SPUR_AGENT: 'claude', SPUR_MODEL: 'm' }, () => NOW, undefined, {
            host: 'claude',
            sessionId: ' owner-1 ',
        });
        expect(id).toMatch(/^session-2026-10-14-\d{6}-[0-9a-f]{8}$/);
        const pointer = JSON.parse(readFileSync(join(dir, '.session.json'), 'utf-8'));
        expect(pointer).toMatchObject({
            session: id,
            agent: 'claude',
            model: 'm',
            owner: { host: 'claude', sessionId: 'owner-1' },
        });
        const rows = readFileSync(join(dir, 'token-ledger.jsonl'), 'utf-8')
            .trim()
            .split('\n')
            .map((l) => JSON.parse(l));
        expect(rows).toHaveLength(1);
        expect(rows[0]).toMatchObject({ session: id, type: 'session_start', agent: 'claude', model: 'm' });
        expect(rows[0].contextFreshness).toBeDefined();
    });

    test('an invalid owner leaves the pointer ownerless', () => {
        const dir = tempDir();
        recordSessionStart(dir, {}, () => NOW, undefined, { host: 'claude', sessionId: '   ' });
        expect(JSON.parse(readFileSync(join(dir, '.session.json'), 'utf-8')).owner).toBeUndefined();
    });

    test('returns null (fail-open) when the context dir cannot be created', () => {
        const file = join(tempDir(), 'a-file');
        writeFileSync(file, 'x');
        expect(recordSessionStart(join(file, 'context'), {}, () => NOW)).toBeNull();
    });
});

describe('recordSessionStartFromPayloadText', () => {
    test('opens the session under CLAUDE_PROJECT_DIR/.spur/context with the payload owner', () => {
        const project = tempDir();
        const prev = getEnvVar('CLAUDE_PROJECT_DIR');
        setEnvVar('CLAUDE_PROJECT_DIR', project);
        try {
            const id = recordSessionStartFromPayloadText('{"session_id":"cs-9"}', {});
            const dir = join(project, '.spur', 'context');
            expect(existsSync(join(dir, '.session.json'))).toBe(true);
            expect(JSON.parse(readFileSync(join(dir, '.session.json'), 'utf-8'))).toMatchObject({
                session: id,
                owner: { host: 'claude', sessionId: 'cs-9' },
            });
        } finally {
            if (prev === undefined) removeEnvVar('CLAUDE_PROJECT_DIR');
            else setEnvVar('CLAUDE_PROJECT_DIR', prev);
        }
    });
});
