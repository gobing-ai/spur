import { afterEach, describe, expect, test } from 'bun:test';
import {
    type EnvelopeCapableOutput,
    envelopeEnabled,
    toEnvelopeError,
    toEnvelopeJson,
    writeJsonError,
} from '../../src/output/envelope';

afterEach(() => {
    delete process.env.SPUR_JSON_ENVELOPE;
});

describe('envelopeEnabled', () => {
    test('explicit flag wins over env (ADR-091 precedence)', () => {
        process.env.SPUR_JSON_ENVELOPE = '1';
        expect(envelopeEnabled(false)).toBe(false);
        expect(envelopeEnabled(true)).toBe(true);
    });

    test('falls back to SPUR_JSON_ENVELOPE=1 only when exact', () => {
        expect(envelopeEnabled()).toBe(false);
        process.env.SPUR_JSON_ENVELOPE = '1';
        expect(envelopeEnabled()).toBe(true);
        process.env.SPUR_JSON_ENVELOPE = 'true';
        expect(envelopeEnabled()).toBe(false);
    });
});

describe('toEnvelopeJson', () => {
    test('unenveloped output is byte-identical to pretty JSON and does not mutate the payload', () => {
        const payload = { b: 2, a: [1, { c: 'x' }] };
        const snapshot = JSON.stringify(payload);
        expect(toEnvelopeJson(payload)).toBe(JSON.stringify(payload, null, 2));
        expect(JSON.stringify(payload)).toBe(snapshot);
    });

    test('single enveloped form wraps data without reordering', () => {
        expect(toEnvelopeJson({ a: 1 }, { enveloped: true })).toBe(
            JSON.stringify({ ok: true, data: { a: 1 } }, null, 2),
        );
    });

    test('list enveloped form emits paginated shape with default meta', () => {
        const json = toEnvelopeJson(['x', 'y'], { enveloped: true, kind: 'list' });
        expect(JSON.parse(json)).toEqual({ ok: true, data: ['x', 'y'], meta: { hasMore: false, limit: 2 } });
    });

    test('list wraps a non-array payload and clamps limit to at least 1', () => {
        const wrapped = JSON.parse(toEnvelopeJson({ a: 1 }, { enveloped: true, kind: 'list' }));
        expect(wrapped.data).toEqual([{ a: 1 }]);
        expect(wrapped.meta).toEqual({ hasMore: false, limit: 1 });
    });

    test('list honors explicit meta', () => {
        const json = toEnvelopeJson([], { enveloped: true, kind: 'list', meta: { hasMore: true, limit: 50 } });
        expect(JSON.parse(json).meta).toEqual({ hasMore: true, limit: 50 });
    });

    test('error payload produces the canonical error envelope in enveloped mode only', () => {
        expect(
            toEnvelopeJson('ignored', {
                enveloped: true,
                error: { code: 'INTERNAL_ERROR', message: 'boom', details: { cliCode: 'wbs-collision' } },
            }),
        ).toBe(toEnvelopeError('INTERNAL_ERROR', 'boom', { cliCode: 'wbs-collision' }));
        expect(toEnvelopeJson('raw', { error: { code: 'INTERNAL_ERROR', message: 'boom' } })).toBe(
            JSON.stringify('raw', null, 2),
        );
    });
});

describe('toEnvelopeError', () => {
    test('omits details key when not provided', () => {
        expect(JSON.parse(toEnvelopeError('VALIDATION_FAILED', 'bad input'))).toEqual({
            ok: false,
            error: { code: 'VALIDATION_FAILED', message: 'bad input' },
        });
        expect(toEnvelopeError('VALIDATION_FAILED', 'bad input')).not.toContain('details');
    });

    test('carries details when provided, including undefined-check distinction', () => {
        expect(JSON.parse(toEnvelopeError('VALIDATION_FAILED', 'bad', { field: 'wbs' }))).toEqual({
            ok: false,
            error: { code: 'VALIDATION_FAILED', message: 'bad', details: { field: 'wbs' } },
        });
    });
});

function captureOutput(): { out: string[]; err: string[]; output: EnvelopeCapableOutput } {
    const out: string[] = [];
    const err: string[] = [];
    return { out, err, output: { write: (m) => out.push(m), error: (m) => err.push(m) } };
}

describe('writeJsonError', () => {
    test('json + enveloped routes the canonical error envelope to stdout', () => {
        const { out, err, output } = captureOutput();
        writeJsonError(output, { json: true, jsonEnvelope: true }, 'boom');
        expect(out).toEqual([toEnvelopeError('INTERNAL_ERROR', 'boom')]);
        expect(err).toEqual([]);
    });

    test('raw mode keeps the plain stderr message byte-identical', () => {
        const { out, err, output } = captureOutput();
        writeJsonError(output, { json: true }, 'boom');
        expect(err).toEqual(['boom']);
        expect(out).toEqual([]);
        writeJsonError(output, {}, 'boom');
        expect(err).toEqual(['boom', 'boom']);
    });

    test('json without envelope enabled stays on stderr', () => {
        process.env.SPUR_JSON_ENVELOPE = '0';
        const { out, err, output } = captureOutput();
        writeJsonError(output, { json: true, jsonEnvelope: undefined }, 'boom');
        expect(err).toEqual(['boom']);
        expect(out).toEqual([]);
    });
});
