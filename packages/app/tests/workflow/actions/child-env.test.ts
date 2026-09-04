import { describe, expect, test } from 'bun:test';
import { childProcessEnv } from '../../../src/workflow/actions/child-env';

/**
 * `childProcessEnv` builds the environment every spawned workflow child inherits. Its contract is
 * narrower than "strip the proto markers": the markers must be **blanked, not removed**, because the
 * executor's own env merge re-adds a deleted key from the parent env while an explicit empty string
 * wins that merge and reads as unset to proto's `fallback_loop` guard. A test that only asserts the
 * markers are falsy would pass on the deletion that this design exists to avoid.
 */

const MARKERS = ['PROTO_SHIM_NAME', 'PROTO_INTERNAL_RUN_FALLBACK'];

/** Set keys for one call and restore whatever was there before. */
function withEnv<T>(vars: Record<string, string>, run: () => T): T {
    const saved = new Map(Object.keys(vars).map((key) => [key, process.env[key]]));
    Object.assign(process.env, vars);
    try {
        return run();
    } finally {
        for (const [key, value] of saved) {
            if (value === undefined) delete process.env[key];
            else process.env[key] = value;
        }
    }
}

describe('childProcessEnv', () => {
    test('blanks the proto shim markers rather than deleting them', () => {
        withEnv({ PROTO_SHIM_NAME: 'bun', PROTO_INTERNAL_RUN_FALLBACK: 'bun' }, () => {
            const env = childProcessEnv();
            for (const key of MARKERS) {
                expect(
                    env,
                    `${key} must still be present — a deleted key is re-added by the executor merge`,
                ).toHaveProperty(key);
                expect(env[key]).toBe('');
            }
        });
    });

    test('passes through non-marker variables, including near-miss PROTO_ names', () => {
        const kept = {
            PROTO_HOME: '/home/proto',
            PROTO_SHIMMED: 'no-underscore-after-SHIM',
            PROTO_INTERNALS: 'no-underscore-after-INTERNAL',
            MY_PROTO_SHIM_NAME: 'not-at-the-start',
        };
        withEnv(kept, () => {
            const env = childProcessEnv();
            for (const [key, value] of Object.entries(kept)) {
                expect(env[key], `${key} must survive`).toBe(value);
            }
            expect(env.PATH).toBe(process.env.PATH);
        });
    });

    test('vars override the parent environment', () => {
        withEnv({ SPUR_TEST_OVERRIDE: 'from-parent' }, () => {
            expect(childProcessEnv({ SPUR_TEST_OVERRIDE: 'from-vars' }).SPUR_TEST_OVERRIDE).toBe('from-vars');
        });
    });

    test('a marker supplied through vars is blanked too', () => {
        // Sanitization runs after the merge, so a caller cannot reintroduce a marker via vars.
        const env = childProcessEnv({ PROTO_SHIM_NAME: 'reintroduced' });
        expect(env).toHaveProperty('PROTO_SHIM_NAME');
        expect(env.PROTO_SHIM_NAME).toBe('');
    });

    test('an undefined var is dropped, never stringified into the child environment', () => {
        // Types say Record<string, string>, but this is the boundary where a stray undefined would
        // otherwise reach spawn() and arrive in the child as the literal text "undefined".
        const env = childProcessEnv({ SPUR_TEST_UNDEFINED: undefined as unknown as string });
        expect(env).not.toHaveProperty('SPUR_TEST_UNDEFINED');
    });

    test('does not mutate process.env', () => {
        withEnv({ PROTO_SHIM_NAME: 'bun' }, () => {
            childProcessEnv({ SPUR_TEST_ONLY_IN_CHILD: 'x' });
            expect(process.env.PROTO_SHIM_NAME).toBe('bun');
            expect(process.env.SPUR_TEST_ONLY_IN_CHILD).toBeUndefined();
        });
    });
});
