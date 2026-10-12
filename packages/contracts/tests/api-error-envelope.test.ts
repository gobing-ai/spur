import { describe, expect, test } from 'bun:test';
import { API_ERROR_CODES, decodeApiErrorBody } from '../src/shared';

/**
 * The transport error envelope has two ends: the server's `/api/*` seam emits
 * `{ ok: false, error: { code, message, details? } }` for typed domain errors, and the typed client
 * decodes it. Task 1185 recorded that the decode end did not exist (the client lost the code and the
 * reason), and that `WBS_COLLISION` — a code the seam really emits — was missing from the vocabulary
 * the envelope schema validates against. These tests pin both.
 */
describe('transport error envelope decode (task 1185)', () => {
    test('decodes the documented envelope with and without details', () => {
        expect(decodeApiErrorBody({ ok: false, error: { code: 'GUARD_DENIED', message: 'undeclared edge' } })).toEqual({
            code: 'GUARD_DENIED',
            message: 'undeclared edge',
        });
        expect(
            decodeApiErrorBody({
                ok: false,
                error: { code: 'GUARD_DENIED', message: 'm', details: { requestId: 'r1' } },
            }),
        ).toEqual({ code: 'GUARD_DENIED', message: 'm', details: { requestId: 'r1' } });
    });

    test('the vocabulary carries every code the seam re-shapes', () => {
        for (const code of ['GUARD_DENIED', 'WBS_COLLISION', 'LOCK_TIMEOUT'] as const) {
            expect(API_ERROR_CODES).toContain(code);
            expect(decodeApiErrorBody({ ok: false, error: { code, message: 'x' } })).toEqual({ code, message: 'x' });
        }
    });

    test('rejects anything that is not the envelope', () => {
        for (const body of [
            undefined,
            null,
            'not-a-body',
            { ok: true },
            { error: { code: 'GUARD_DENIED', message: 'm' } },
            { ok: false, error: { code: 'NOT_A_CODE', message: 'm' } },
            { ok: false, error: { code: 'GUARD_DENIED' } },
        ]) {
            expect(decodeApiErrorBody(body)).toBeUndefined();
        }
    });
});
