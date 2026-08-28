import { describe, expect, test } from 'bun:test';
import { apiErrorSchema, apiSuccessSchema, paginatedResponseSchema } from '@gobing-ai/spur-contracts';
import { z } from 'zod';
import { envelopeEnabled, toEnvelopeError, toEnvelopeJson, toJson } from '../src/output';

// ── raw byte-identity (ADR-091 regression guard: the 0688 break class) ──

describe('toEnvelopeJson raw path', () => {
    test('unenveloped output is byte-identical to toJson for flat objects without ok (task update --section family)', () => {
        const payload = { ref: { id: '0693', filePath: 'x.md' }, warnings: [] };
        expect(toEnvelopeJson(payload, { enveloped: false })).toBe(toJson(payload));
    });

    test('unenveloped output is byte-identical for bare arrays (feature check family)', () => {
        const payload = [{ id: 'F95', status: 'backlog', findings: [] }];
        expect(toEnvelopeJson(payload, { enveloped: false, kind: 'list' })).toBe(toJson(payload));
    });

    test('unenveloped output is byte-identical for flat objects with ok (task check --corpus family)', () => {
        const payload = { observed: 1, baselined: 0, newErrors: [], ok: true };
        expect(toEnvelopeJson(payload, { enveloped: false })).toBe(toJson(payload));
    });

    test('error opts never alter the raw payload', () => {
        const raw = { ok: false, error: { code: 'wbs-collision', message: 'boom' } };
        expect(
            toEnvelopeJson(raw, {
                enveloped: false,
                error: { code: 'INTERNAL_ERROR', message: 'boom', details: { cliCode: 'wbs-collision' } },
            }),
        ).toBe(toJson(raw));
    });
});

// ── envelope shapes (ADOPTION-091) ──

describe('toEnvelopeJson envelope mode', () => {
    test('wraps a payload as {ok: true, data}', () => {
        expect(JSON.parse(toEnvelopeJson({ a: 1 }, { enveloped: true }))).toEqual({ ok: true, data: { a: 1 } });
    });

    test('list kind emits the paginated {ok, data[], meta} form', () => {
        const out = JSON.parse(toEnvelopeJson([{ a: 1 }, { a: 2 }], { enveloped: true, kind: 'list' }));
        expect(out.ok).toBe(true);
        expect(out.data).toEqual([{ a: 1 }, { a: 2 }]);
        expect(out.meta).toEqual({ hasMore: false, limit: 2 });
    });

    test('error opts emit the {ok: false, error} envelope, ignoring the payload', () => {
        const out = JSON.parse(
            toEnvelopeJson(
                { ok: false, error: { code: 'wbs-collision', message: 'boom' } },
                {
                    enveloped: true,
                    error: { code: 'INTERNAL_ERROR', message: 'boom', details: { cliCode: 'wbs-collision' } },
                },
            ),
        );
        expect(out).toEqual({
            ok: false,
            error: { code: 'INTERNAL_ERROR', message: 'boom', details: { cliCode: 'wbs-collision' } },
        });
    });

    test('toEnvelopeError omits details when absent', () => {
        expect(JSON.parse(toEnvelopeError('NOT_FOUND', 'nope'))).toEqual({
            ok: false,
            error: { code: 'NOT_FOUND', message: 'nope' },
        });
    });
});

// ── opt-in precedence: explicit flag > SPUR_JSON_ENVELOPE=1 > raw default ──

describe('envelopeEnabled precedence', () => {
    const ENV = 'SPUR_JSON_ENVELOPE';

    test('explicit true wins over a disabling env', () => {
        process.env[ENV] = '1';
        expect(envelopeEnabled(true)).toBe(true);
        expect(envelopeEnabled(false)).toBe(false);
    });

    test('undefined defers to the env', () => {
        process.env[ENV] = '1';
        expect(envelopeEnabled(undefined)).toBe(true);
        process.env[ENV] = '0';
        expect(envelopeEnabled(undefined)).toBe(false);
        delete process.env[ENV];
        expect(envelopeEnabled(undefined)).toBe(false);
    });

    test('raw default when neither flag nor env is set', () => {
        delete process.env[ENV];
        expect(JSON.parse(toEnvelopeJson({ a: 1 }))).toEqual({ a: 1 });
    });
});

// ── contract validation: adoption, not re-spelling ──

describe('envelope outputs validate against contracts schemas', () => {
    test('success envelope parses against apiSuccessSchema', () => {
        const out = JSON.parse(toEnvelopeJson({ wbs: '0693', filePath: 'x' }, { enveloped: true }));
        expect(apiSuccessSchema(z.unknown()).safeParse(out).success).toBe(true);
    });

    test('list envelope parses against paginatedResponseSchema', () => {
        const out = JSON.parse(toEnvelopeJson([{ id: 1 }], { enveloped: true, kind: 'list' }));
        expect(paginatedResponseSchema(z.unknown()).safeParse(out).success).toBe(true);
    });

    test('error envelope parses against apiErrorSchema with a frozen API_ERROR_CODES member', () => {
        const out = JSON.parse(toEnvelopeError('GUARD_DENIED', 'lifecycle guard denied'));
        expect(apiErrorSchema.safeParse(out).success).toBe(true);
        expect([
            'NOT_FOUND',
            'VALIDATION_FAILED',
            'GUARD_DENIED',
            'LOCK_TIMEOUT',
            'CONFLICT',
            'INTERNAL_ERROR',
        ]).toContain(out.error.code);
    });
});
