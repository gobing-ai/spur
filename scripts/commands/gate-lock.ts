#!/usr/bin/env bun
/**
 * gate-lock — run a command under the host-wide full-gate lock (task 1127 R7).
 *
 * `bun run spur-check` wraps its `bun run test` hop with this so a manually
 * invoked `spur-check` and the pipeline's gate (both take the same host-wide
 * lock through `runQualityGate`) can never overlap on one host.
 *
 * Usage:
 *   bun scripts/commands/gate-lock.ts -- <command> [args...]
 *
 * The child inherits stdio and exits with the wrapper. When the caller already
 * holds the lock (the pipeline gate wrapping a `spur-check` run), the exported
 * `SPUR_GATE_LOCK_TOKEN` makes this a re-entry — no wait (1127 R6).
 *
 * Exit code: the child's, or 2 on usage error.
 */
import { spawnSync } from 'node:child_process';
import { getEnvVar, getEnvVars } from '@gobing-ai/spur-config';
import { acquireGateLock } from '../../packages/app/src/services/quality-gate';

// Bun strips a leading `--` from argv, Node keeps it — accept both shapes.
const raw = process.argv.slice(2);
const args = raw[0] === '--' ? raw.slice(1) : raw;
if (args.length < 1) {
    process.stderr.write('usage: gate-lock.ts -- <command> [args...]\n');
    process.exit(2);
}

const lockStart = Date.now();
const lock = acquireGateLock(
    { wbs: getEnvVar('wbs') ?? 'gate-lock', runId: getEnvVar('runId') ?? 'gate-lock' },
    (line) => process.stderr.write(line),
);
process.stdout.write(`gate-lock: acquired in ${lock.queueWaitMs}ms\n`);
// spawnSync is synchronous, so the claim cannot outlive the child; stdin passes through.
// `args` excludes the `--` separator under both runtimes (bun strips it, we slice it).
// The release runs in `finally` so a throwing child path (`result.error`) cannot strand the
// host-wide claim for the rest of its liveness (1127 review P4).
try {
    const childEnv = {
        ...getEnvVars(),
        ...(lock.token.length > 0 ? { SPUR_GATE_LOCK_TOKEN: lock.token } : {}),
    };
    const result = spawnSync(args[0] ?? '', args.slice(1), {
        stdio: 'inherit',
        env: childEnv,
    });
    const gateRuntimeMs = Date.now() - lockStart - lock.queueWaitMs;
    process.stderr.write(`quality gate lock: queueWaitMs=${lock.queueWaitMs} gateRuntimeMs=${gateRuntimeMs}\n`);
    if (result.error !== undefined) {
        process.stderr.write(`gate-lock: ${args[0]} failed: ${result.error.message}\n`);
        process.exitCode = 1;
    } else {
        process.exitCode = result.status ?? 1;
    }
} finally {
    lock.release();
}
