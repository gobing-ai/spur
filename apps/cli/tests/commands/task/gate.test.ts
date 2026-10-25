/**
 * Thin-wrapper tests for `spur task gate` (apps/cli/src/commands/task/gate.ts). The gate's
 * behavioral suite lives in packages/app/tests/services/quality-gate*.test.ts; these pin the
 * verb surface: argument → env mapping, flag overrides, and exit codes 0/1/2.
 */
import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import { existsSync, mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { main } from '../../../src/index';
import { createCapturedOutput } from '../../helpers';

let cwd: string;
let restore: () => void;

beforeEach(() => {
    cwd = mkdtempSync(join(tmpdir(), 'spur-task-gate-'));
    // The gate writes its progress lines straight to the process streams (byte-stable runner
    // contract); keep them out of the suite output.
    const [out, err] = [process.stdout.write, process.stderr.write];
    process.stdout.write = (() => true) as typeof process.stdout.write;
    process.stderr.write = (() => true) as typeof process.stderr.write;
    restore = () => {
        process.stdout.write = out;
        process.stderr.write = err;
    };
});

afterEach(() => {
    restore();
    rmSync(cwd, { recursive: true, force: true });
});

const status = (wbs: string): string => readFileSync(join(cwd, '.spur', 'run', `${wbs}-test-gate.status`), 'utf8');

describe('spur task gate', () => {
    test('run: the --cmd override decides PASS (0) and FAIL (1)', async () => {
        const opts = { cwd, output: createCapturedOutput(), env: {} };
        expect(await main(['task', 'gate', '2001', 'run', '--cmd', 'true', '--run-id', 'r-1'], opts)).toBe(0);
        expect(status('2001').trim()).toBe('PASS');
        expect(await main(['task', 'gate', '2001', 'recheck', '--cmd', 'false', '--probe-cmd', 'true'], opts)).toBe(1);
        expect(status('2001').trim()).toBe('FAIL');
    });

    test('env inputs are read when no flag overrides them', async () => {
        const opts = { cwd, output: createCapturedOutput(), env: { qualityGateCmd: 'true' } };
        expect(await main(['task', 'gate', '2002', 'run'], opts)).toBe(0);
        expect(status('2002').trim()).toBe('PASS');
    });

    test('status reports the receipt verdict without running the gate', async () => {
        const opts = { cwd, output: createCapturedOutput(), env: {} };
        expect(await main(['task', 'gate', '2003', 'status'], opts)).toBe(0);
        expect(existsSync(join(cwd, '.spur', 'run', '2003-test-gate.status'))).toBe(false);
    });

    test('status and light do not bootstrap a project database', async () => {
        const opts = { cwd, output: createCapturedOutput(), env: {} };
        expect(await main(['task', 'gate', '2005', 'status'], opts)).toBe(0);
        expect(existsSync(join(cwd, '.spur', 'spur.db'))).toBe(false);
        expect(await main(['task', 'gate', '2005', 'light'], opts)).toBe(0);
        expect(existsSync(join(cwd, '.spur', 'spur.db'))).toBe(false);
    });

    // 1234: the receipt key is the gate's own git tree hash, so the caller-supplied digest flag is
    // gone (ADR-140). The surface must reject it rather than silently ignore it.
    test('the retired --proof-digest flag is rejected as an unknown option', async () => {
        const output = createCapturedOutput();
        expect(await main(['task', 'gate', '2003', 'status', '--proof-digest', 'd-1'], { cwd, output, env: {} })).toBe(
            1,
        );
        expect(output.errors.join('\n')).toContain("unknown option '--proof-digest'");
    });

    test('an unknown mode is a usage error (2)', async () => {
        const opts = { cwd, output: createCapturedOutput(), env: {} };
        expect(await main(['task', 'gate', '2004', 'bogus'], opts)).toBe(2);
    });
});
