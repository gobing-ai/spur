import { describe, expect, test } from 'bun:test';
import { join } from 'node:path';
import { getEnvVars } from '@gobing-ai/spur-config';

// Task 1127 R7: `spur-check`'s test hop runs behind the host-wide gate lock. Deep lock behavior
// (serialization, re-entry, stale reclaim, off mode) is covered E2E in
// plugins/sp/tests/quality-gate-lock.test.ts against the shipped entrypoints; this sibling pins
// only the wrapper's usage contract.

const WRAPPER = join(import.meta.dir, 'gate-lock.ts');

describe('gate-lock wrapper', () => {
    test('usage error without `--`', () => {
        const result = Bun.spawnSync(['bun', WRAPPER], { stdout: 'pipe', stderr: 'pipe' });
        expect(result.exitCode).toBe(2);
        expect(result.stderr.toString()).toContain('usage: gate-lock.ts --');
    });

    test('runs the child and exits with its code', () => {
        // `env` explicitly: the runtime does not propagate env mutations made after startup to
        // spawned children, so the preload's isolated SPUR_GATE_LOCK_DIR would otherwise be invisible
        // here and this child would queue behind a real host-wide gate holder (the same quirk
        // `runShellCommand` documents).
        const result = Bun.spawnSync(['bun', WRAPPER, '--', 'echo', 'wrapped-ok'], {
            stdout: 'pipe',
            env: { ...getEnvVars() },
        });
        expect(result.exitCode).toBe(0);
        expect(result.stdout.toString()).toContain('gate-lock: acquired in');
        expect(result.stdout.toString()).toContain('wrapped-ok');
    });

    test('propagates a failing child', () => {
        const result = Bun.spawnSync(['bun', WRAPPER, '--', 'sh', '-c', 'exit 3'], {
            stdout: 'pipe',
            env: { ...getEnvVars() },
        });
        expect(result.exitCode).toBe(3);
    });
});
