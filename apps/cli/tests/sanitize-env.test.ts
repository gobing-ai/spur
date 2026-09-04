import { expect, test } from 'bun:test';

/**
 * `sanitize-env` is an import-side-effect module: it strips proto's shim-launch markers from
 * `process.env` once, at CLI start, so no descendant process inherits them and misreads them as
 * `proto::commands::run::fallback_loop`. The module body runs on first import and the module cache
 * makes that unrepeatable — so the fixture is planted, the environment is snapshotted either side of
 * the single import, and every case is asserted against those two snapshots.
 */

/** Markers the module must delete: anchored `PROTO_SHIM_` / `PROTO_INTERNAL_`. */
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
const saved = new Map(Object.keys(planted).map((key) => [key, process.env[key]]));
Object.assign(process.env, planted);

const before = { ...process.env };
await import('../src/sanitize-env');
const after = { ...process.env };

for (const [key, value] of saved) {
    if (value === undefined) delete process.env[key];
    else process.env[key] = value;
}
// The runner itself may be shim-launched, so the module can have deleted real markers too; put
// them back rather than leaking a sanitized environment into the rest of the suite.
for (const [key, value] of Object.entries(before)) {
    if (!(key in after) && !(key in planted)) process.env[key] = value;
}

test('importing sanitize-env deletes the proto shim-launch markers', () => {
    for (const key of Object.keys(MARKERS)) {
        expect(before[key], `${key} was not planted`).toBeDefined();
        expect(after, `${key} must not survive sanitization`).not.toHaveProperty(key);
    }
});

test('importing sanitize-env leaves non-marker PROTO_ variables intact', () => {
    for (const [key, value] of Object.entries(NEAR_MISSES)) {
        expect(after[key], `${key} must survive sanitization`).toBe(value);
    }
});

test('sanitize-env deletes nothing that is not a marker', () => {
    // Asserted as a predicate, not as an exact set: a shim-launched test runner carries real
    // PROTO_SHIM_* markers of its own, which the module is equally right to delete.
    const removed = Object.keys(before).filter((key) => !(key in after));
    expect(removed.filter((key) => !/^PROTO_(SHIM|INTERNAL)_/.test(key))).toEqual([]);
    expect(removed).toEqual(expect.arrayContaining(Object.keys(MARKERS)));
});
