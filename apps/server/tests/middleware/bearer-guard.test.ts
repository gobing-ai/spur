/**
 * B 1375 — unit: the shared bearer guard's four outcomes (unset / missing / mismatch / allow)
 * and the refusal seam (`onDenied` never sees token material). Envelope shapes and the full
 * HTTP path are covered by the surfaces' e2e tests (`mcp-e2e.test.ts`).
 */
import { describe, expect, test } from 'bun:test';
import { bearerGuard } from '../../src/middleware/bearer-guard';

const authz = (value?: string) => ({ req: { header: (_name: string) => value } });
const denied: string[] = [];
const guard = bearerGuard({
    realm: 'spur-test',
    authEnv: 'SPUR_TEST_TOKEN',
    env: { SPUR_TEST_TOKEN: 'sekret' },
    unauthenticated: () => ({ error: { code: 401, message: 'unauthorized' } }),
    unconfigured: () => ({ error: { code: 500, message: 'misconfigured' } }),
    onDenied: (d) => denied.push(d.reason),
});

describe('bearerGuard', () => {
    test('configured guard allows a matching bearer token with null (no refusal)', () => {
        expect(guard.configured).toBe(true);
        expect(guard.authorize(authz('Bearer sekret'))).toBeNull();
    });

    test('missing Bearer header → 401 + realm challenge + onDenied missing', () => {
        const res = guard.authorize(authz(undefined));
        expect(res?.status).toBe(401);
        expect(res?.headers.get('WWW-Authenticate')).toBe('Bearer realm="spur-test"');
        expect(denied.at(-1)).toBe('missing');
    });

    test('wrong token → 401 + onDenied mismatch', () => {
        const res = guard.authorize(authz('Bearer nope'));
        expect(res?.status).toBe(401);
        expect(denied.at(-1)).toBe('mismatch');
    });

    test('unset token variable → every request 500, unconfigured envelope, onDenied unset', () => {
        const unconfigured = bearerGuard({
            realm: 'spur-test',
            authEnv: 'SPUR_MISSING_TOKEN',
            env: {},
            unauthenticated: () => ({ a: 1 }),
            unconfigured: () => ({ error: { code: 500, message: 'misconfigured' } }),
            onDenied: (d) => denied.push(d.reason),
        });
        expect(unconfigured.configured).toBe(false);
        const res = unconfigured.authorize(authz('Bearer sekret'));
        expect(res?.status).toBe(500);
        expect(denied.at(-1)).toBe('unset');
    });
});
