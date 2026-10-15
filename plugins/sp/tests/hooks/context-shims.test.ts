/**
 * The three `hooks/context-*.ts` transition shims (`@transition-shim(sp-context-hook-imports)`):
 * released superskill (≤0.3.37) imports these exact exports, so each must keep its signature and
 * forward the payload to `spur self hook <id> --host auto` — synchronously, fail-open.
 */

import { afterAll, describe, expect, test } from 'bun:test';
import { chmodSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { recordToolUseEvent } from '../../hooks/context-post-tool';
import { recordSessionStartFromPayloadText } from '../../hooks/context-session-start';
import { recordSessionEndFromPayloadText } from '../../hooks/context-session-stop';
import { getEnvVar, getEnvVars, setEnvVar } from '../../lib/env';

const HOOKS = resolve(import.meta.dir, '..', '..', 'hooks');
const root = mkdtempSync(join(tmpdir(), 'sp-context-shims-'));
const log = join(root, 'calls.log');
const fake = join(root, 'spur');
writeFileSync(fake, `#!/bin/sh\n{ echo "$PWD|$*"; cat; echo; } >> "${log}"\n`);
chmodSync(fake, 0o755);

const savedBin = getEnvVar('SPUR_BIN');
setEnvVar('SPUR_BIN', fake);
afterAll(() => {
    setEnvVar('SPUR_BIN', savedBin);
    rmSync(root, { recursive: true, force: true });
});

const calls = (): string[] => {
    const lines = existsSync(log) ? readFileSync(log, 'utf-8').split('\n').filter(Boolean) : [];
    rmSync(log, { force: true });
    return lines;
};

describe('context shims (superskill import contract)', () => {
    test('session start/stop forward their payload text and return null', () => {
        expect(recordSessionStartFromPayloadText('{"session_id":"s1"}')).toBeNull();
        expect(recordSessionEndFromPayloadText('{"session_id":"s1"}', { ...getEnvVars(), SPUR_BIN: fake })).toBeNull();
        expect(calls()).toEqual([
            `${process.cwd()}|self hook context-session-start --host auto`,
            '{"session_id":"s1"}',
            `${process.cwd()}|self hook context-session-stop --host auto`,
            '{"session_id":"s1"}',
        ]);
    });

    test('post-tool serializes the payload and runs from the project owning the context dir', () => {
        const project = join(root, 'proj');
        mkdirSync(join(project, '.spur', 'context'), { recursive: true });
        recordToolUseEvent(join(project, '.spur', 'context'), { tool_name: 'Read', tool_input: { file_path: 'a' } });
        expect(calls()).toEqual([
            `${project}|self hook context-post-tool --host auto`,
            '{"tool_name":"Read","tool_input":{"file_path":"a"}}',
        ]);
    });

    test('fail open when spur is missing: no throw, null result', () => {
        const missing = { ...getEnvVars(), SPUR_BIN: join(root, 'absent') };
        expect(recordSessionStartFromPayloadText('{}', missing)).toBeNull();
        expect(recordSessionEndFromPayloadText('{}', missing)).toBeNull();
        setEnvVar('SPUR_BIN', join(root, 'absent'));
        try {
            expect(() => recordToolUseEvent(join(root, '.spur', 'context'), {})).not.toThrow();
        } finally {
            setEnvVar('SPUR_BIN', fake);
        }
        expect(calls()).toEqual([]);
    });

    test('direct-run entries forward stdin and exit 0', async () => {
        for (const id of ['context-session-start', 'context-session-stop', 'context-post-tool']) {
            const proc = Bun.spawn([process.execPath, join(HOOKS, `${id}.ts`)], {
                cwd: root,
                stdin: new TextEncoder().encode('{"x":1}'),
                stdout: 'pipe',
                env: { ...getEnvVars(), SPUR_BIN: fake } as Record<string, string>,
            });
            expect(await proc.exited).toBe(0);
            expect(await new Response(proc.stdout).text()).toBe('');
            expect(calls()).toEqual([`${root}|self hook ${id} --host auto`, '{"x":1}']);
        }
    });
});
