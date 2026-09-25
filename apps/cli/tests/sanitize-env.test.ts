import { expect, test } from 'bun:test';
import { getEnvVar, getEnvVars, removeEnvVar, setEnvVar } from '@gobing-ai/spur-config';
import { sanitizeProtoShimEnv } from '../src/sanitize-env';

/**
 * The sanitizer is invoked directly rather than through an import side effect: `bun test` shares
 * one module registry across every test file in the process, so by the time this file runs the
 * module body has usually already executed (via `src/index.ts` in an earlier file) and a fresh
 * import is a cache hit that would sanitize nothing. File discovery order differs per platform —
 * this exact dependence failed only on Linux CI (task-adjacent: proto shim sanitization).
 */

/** Markers the sanitizer must delete: anchored `PROTO_SHIM_` / `PROTO_INTERNAL_`. */
const MARKERS = { PROTO_SHIM_NAME: 'spur', PROTO_INTERNAL_ORIGINAL_ARGS: '--version' };

/**
 * Near-misses that share a prefix but not the anchored shape. Deleting any of these would strip real
 * proto configuration out of every process the CLI spawns.
 */
const NEAR_MISSES = {
    PROTO_HOME: '/home/proto',
    PROTO_SHIMMED: 'no-underscore-after-SHIM',
    PROTO_INTERNALS: 'no-underscore-after-INTERNAL',
    MY_PROTO_SHIM_NAME: 'not-at-the-start',
};

const planted = { ...MARKERS, ...NEAR_MISSES };
const saved = new Map(Object.keys(planted).map((key) => [key, getEnvVar(key)]));

test('sanitizeProtoShimEnv deletes the proto shim-launch markers', () => {
    Object.assign(getEnvVars(), planted);
    try {
        sanitizeProtoShimEnv();
        for (const [key, value] of Object.entries(planted)) {
            expect(getEnvVar(key), `${key} must ${key in MARKERS ? 'not ' : ''}survive sanitization`).toBe(
                key in MARKERS ? undefined : value,
            );
        }
    } finally {
        for (const [key, value] of saved) {
            if (value === undefined) removeEnvVar(key);
            else setEnvVar(key, value);
        }
    }
});

test('sanitizeProtoShimEnv deletes nothing that is not a marker', () => {
    // Asserted as a predicate over the whole env, not just the fixtures: a shim-launched test
    // runner carries real PROTO_SHIM_* markers of its own, which the module is equally right
    // to delete — but nothing outside the anchored prefix may ever be touched.
    const before = { ...getEnvVars(), ...MARKERS };
    Object.assign(getEnvVars(), MARKERS);
    sanitizeProtoShimEnv();
    try {
        const removed = Object.keys(before).filter((key) => !(key in getEnvVars()));
        expect(removed.filter((key) => !/^PROTO_(SHIM|INTERNAL)_/.test(key))).toEqual([]);
        expect(removed).toEqual(expect.arrayContaining(Object.keys(MARKERS)));
    } finally {
        for (const [key, value] of Object.entries(before)) {
            if (!(key in getEnvVars())) setEnvVar(key, value);
        }
    }
});
