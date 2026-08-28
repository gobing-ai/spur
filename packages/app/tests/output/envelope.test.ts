import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import { apiErrorSchema, apiSuccessSchema, paginatedResponseSchema } from '@gobing-ai/spur-contracts';
import { z } from 'zod';
import {
    type EnvelopeCapableOutput,
    envelopeEnabled,
    toEnvelopeError,
    toEnvelopeJson,
    writeJsonError,
} from '../../src/output/envelope';

/**
 * Task 0697 relocated these helpers here from `apps/cli/src/output.ts` so the four
 * service-emitting verbs could reach them without `packages/app` importing `apps/cli`
 * (a circular edge). The behavior is frozen by ADR-091 — these tests pin the contract
 * at its new home; `apps/cli/tests/output-envelope.test.ts` pins the re-export.
 */

const raw = (value: unknown): string => JSON.stringify(value, null, 2);

let previous: string | undefined;
beforeEach(() => {
    previous = process.env.SPUR_JSON_ENVELOPE;
    delete process.env.SPUR_JSON_ENVELOPE;
});
afterEach(() => {
    if (previous === undefined) delete process.env.SPUR_JSON_ENVELOPE;
    else process.env.SPUR_JSON_ENVELOPE = previous;
});

describe('envelopeEnabled precedence (explicit > env > raw)', () => {
    test('defaults to raw when neither flag nor env is set', () => {
        expect(envelopeEnabled()).toBe(false);
    });

    test('SPUR_JSON_ENVELOPE=1 enables it with no explicit flag', () => {
        process.env.SPUR_JSON_ENVELOPE = '1';
        expect(envelopeEnabled()).toBe(true);
    });

    test('any other env value is not an opt-in', () => {
        process.env.SPUR_JSON_ENVELOPE = 'true';
        expect(envelopeEnabled()).toBe(false);
    });

    test('an explicit flag wins over the env in both directions', () => {
        process.env.SPUR_JSON_ENVELOPE = '1';
        expect(envelopeEnabled(false)).toBe(false);
        delete process.env.SPUR_JSON_ENVELOPE;
        expect(envelopeEnabled(true)).toBe(true);
    });
});

describe('toEnvelopeJson raw path is byte-identical', () => {
    test('flat object', () => {
        const payload = { preset: 'x', ruleCount: 1, findings: [], fixes: [] };
        expect(toEnvelopeJson(payload, { enveloped: false })).toBe(raw(payload));
    });

    test('kind: list does not alter the raw bytes', () => {
        const payload = [{ id: 'a' }, { id: 'b' }];
        expect(toEnvelopeJson(payload, { enveloped: false, kind: 'list' })).toBe(raw(payload));
    });

    test('an error payload never leaks into the raw bytes', () => {
        const payload = { error: { code: 'agent-resolution', message: 'boom' } };
        expect(
            toEnvelopeJson(payload, {
                enveloped: false,
                error: { code: 'INTERNAL_ERROR', message: 'boom', details: { cliCode: 'agent-resolution' } },
            }),
        ).toBe(raw(payload));
    });
});

describe('toEnvelopeJson envelope shapes', () => {
    test('single payloads wrap as {ok: true, data} and parse against apiSuccessSchema', () => {
        const doc = JSON.parse(toEnvelopeJson({ agents: [] }, { enveloped: true }));
        expect(doc).toEqual({ ok: true, data: { agents: [] } });
        expect(apiSuccessSchema(z.unknown()).safeParse(doc).success).toBe(true);
    });

    test('list payloads wrap as {ok, data, meta} and parse against paginatedResponseSchema', () => {
        const doc = JSON.parse(toEnvelopeJson([{ id: 'a' }], { enveloped: true, kind: 'list' }));
        expect(doc.meta).toEqual({ hasMore: false, limit: 1 });
        expect(paginatedResponseSchema(z.unknown()).safeParse(doc).success).toBe(true);
    });

    test('an empty list still reports a positive limit (the schema requires it)', () => {
        const doc = JSON.parse(toEnvelopeJson([], { enveloped: true, kind: 'list' }));
        expect(paginatedResponseSchema(z.unknown()).safeParse(doc).success).toBe(true);
    });

    test('a payload carrying its own ok moves under data unchanged', () => {
        const doc = JSON.parse(toEnvelopeJson({ valid: false, ok: false }, { enveloped: true }));
        expect(doc).toEqual({ ok: true, data: { valid: false, ok: false } });
    });

    test('opts.error produces the error envelope and parses against apiErrorSchema', () => {
        const doc = JSON.parse(
            toEnvelopeJson(
                { error: { code: 'agent-resolution', message: 'boom' } },
                {
                    enveloped: true,
                    error: { code: 'INTERNAL_ERROR', message: 'boom', details: { cliCode: 'agent-resolution' } },
                },
            ),
        );
        expect(doc).toEqual({
            ok: false,
            error: { code: 'INTERNAL_ERROR', message: 'boom', details: { cliCode: 'agent-resolution' } },
        });
        expect(apiErrorSchema.safeParse(doc).success).toBe(true);
    });
});

describe('toEnvelopeError', () => {
    test('omits details entirely when undefined rather than emitting a null key', () => {
        expect(JSON.parse(toEnvelopeError('INTERNAL_ERROR', 'boom'))).toEqual({
            ok: false,
            error: { code: 'INTERNAL_ERROR', message: 'boom' },
        });
    });
});

describe('writeJsonError routes by mode', () => {
    function sink(): EnvelopeCapableOutput & { out: string[]; err: string[] } {
        return {
            out: [],
            err: [],
            write(message: string): void {
                this.out.push(message);
            },
            error(message: string): void {
                this.err.push(message);
            },
        };
    }

    test('enveloped --json writes the error envelope to stdout', () => {
        const s = sink();
        writeJsonError(s, { json: true, jsonEnvelope: true }, 'boom');
        expect(s.err).toEqual([]);
        expect(JSON.parse(s.out[0] as string)).toEqual({
            ok: false,
            error: { code: 'INTERNAL_ERROR', message: 'boom' },
        });
    });

    test('raw --json keeps the plain stderr message', () => {
        const s = sink();
        writeJsonError(s, { json: true }, 'boom');
        expect(s.out).toEqual([]);
        expect(s.err).toEqual(['boom']);
    });

    test('without --json the env var alone never diverts to stdout', () => {
        process.env.SPUR_JSON_ENVELOPE = '1';
        const s = sink();
        writeJsonError(s, {}, 'boom');
        expect(s.out).toEqual([]);
        expect(s.err).toEqual(['boom']);
    });
});
