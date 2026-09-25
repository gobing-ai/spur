import { describe, expect, test } from 'bun:test';
import { type DecisionMaker, DecisionTimeoutError } from '@gobing-ai/ts-ai-runner';
import {
    DECIDE_EVIDENCE_MAX_CHARS,
    DEFAULT_MIN_CONFIDENCE,
    type DecideDeps,
    type DecideOptions,
    NOUL_YES_THRESHOLD,
    runDecide,
} from '../../src/workflow/decide';

/**
 * Core branch coverage for the non-pausing decide action (0941 R3): every degraded reason
 * (`disabled`, `no-backend`, `error`, `timeout`, `low-confidence`) resolves to
 * `value = default` with `degraded: true`, and only acceptance records the model value.
 * All branches run against a hand-built fake maker — no network, no real time.
 */

function fakeMaker(overrides: {
    choice?: { label: string; confidence: number };
    noul?: { probability: number };
    throwOnChoice?: Error;
    throwOnNoul?: Error;
    capture?: { evidence?: string[]; question?: string; labels?: Record<string, string> };
}): DecisionMaker {
    // Hand-built DecisionMaker: the generic surface is satisfied by an explicit narrow-typed
    // literal plus one test-only cast (0941 fake-maker testability, frozen deps shape).
    const maker = {
        driver: 'fake',
        ask: () => Promise.reject(new Error('not used by decide')),
        choice: (state: { evidence?: string[] }, prompt: string, labels: Record<string, string>) => {
            if (overrides.capture !== undefined) {
                overrides.capture.evidence = state.evidence;
                overrides.capture.question = prompt;
                overrides.capture.labels = labels;
            }
            if (overrides.throwOnChoice !== undefined) return Promise.reject(overrides.throwOnChoice);
            const answer = overrides.choice ?? { label: 'retry', confidence: 0.99 };
            return Promise.resolve({ ...answer, kind: 'choice' as const, probabilities: {} });
        },
        score: () => Promise.reject(new Error('not used by decide')),
        noul: (state: { evidence?: string[] }, prompt?: string) => {
            if (overrides.capture !== undefined) {
                overrides.capture.evidence = state.evidence;
                overrides.capture.question = prompt;
            }
            if (overrides.throwOnNoul !== undefined) return Promise.reject(overrides.throwOnNoul);
            const probability = overrides.noul?.probability ?? 0.9;
            return Promise.resolve({ kind: 'noul' as const, probability });
        },
    };
    return maker as unknown as DecisionMaker;
}

function makeDeps(
    overrides: {
        enabled?: boolean;
        decisionMaker?: () => Promise<DecisionMaker>;
        files?: Record<string, string>;
        missing?: string[];
        now?: () => number;
    } = {},
): DecideDeps {
    return {
        enabled: overrides.enabled ?? true,
        ...(overrides.decisionMaker !== undefined ? { decisionMaker: overrides.decisionMaker } : {}),
        readFile: async (path: string) => {
            if (overrides.missing?.includes(path) || overrides.files?.[path] === undefined) {
                throw new Error(`ENOENT: ${path}`);
            }
            return overrides.files[path];
        },
        now: overrides.now ?? (() => 0),
    };
}

const baseOptions: DecideOptions = {
    id: 'recovery-classify',
    method: 'choice',
    question: 'retry or stop?',
    choices: ['retry', 'stop'],
    default: 'stop',
    resultFile: '.spur/run/x.decision.json',
};

describe('runDecide acceptance', () => {
    test('choice accepts an in-set label with sufficient confidence (0941 R2/R3)', async () => {
        const capture: { evidence?: string[]; labels?: Record<string, string> } = {};
        const result = await runDecide(
            { ...baseOptions, evidence: ['summary.txt'] },
            makeDeps({
                files: { 'summary.txt': 'verification failed twice; retry is safe' },
                decisionMaker: () =>
                    Promise.resolve(fakeMaker({ choice: { label: 'retry', confidence: 0.92 }, capture })),
            }),
        );
        expect(result).toEqual({
            schemaVersion: 1,
            id: 'recovery-classify',
            value: 'retry',
            method: 'choice',
            backend: 'fake',
            confidence: 0.92,
            degraded: false,
            reason: 'accepted',
            evidenceDigest: expect.any(String),
            durationMs: 0,
        });
        // The offered labels are the declared choices verbatim (0941 R1).
        expect(capture.labels).toEqual({ retry: 'retry', stop: 'stop' });
        // Evidence is passed to the maker, digest covers the redacted bounded text.
        expect(capture.evidence).toEqual(['verification failed twice; retry is safe']);
        expect(result.evidenceDigest).toMatch(/^sha256:/);
    });

    test('noul maps probability >= 0.5 to yes and below to no (0941 Q&A threshold)', async () => {
        const yes = await runDecide(
            { ...baseOptions, method: 'noul', choices: undefined, minConfidence: NOUL_YES_THRESHOLD },
            makeDeps({ decisionMaker: () => Promise.resolve(fakeMaker({ noul: { probability: 0.5 } })) }),
        );
        expect(yes.value).toBe('yes');
        expect(yes.degraded).toBe(false);
        expect(yes.confidence).toBe(0.5);

        const no = await runDecide(
            { ...baseOptions, method: 'noul', choices: undefined, minConfidence: 0.4 },
            makeDeps({
                decisionMaker: () => Promise.resolve(fakeMaker({ noul: { probability: NOUL_YES_THRESHOLD - 0.01 } })),
            }),
        );
        expect(no.value).toBe('no');
        expect(no.degraded).toBe(false);
    });

    test('noul records the probability as confidence (the only honest gate number)', async () => {
        const result = await runDecide(
            { ...baseOptions, method: 'noul', choices: undefined },
            makeDeps({ decisionMaker: () => Promise.resolve(fakeMaker({ noul: { probability: 0.95 } })) }),
        );
        expect(result.confidence).toBe(0.95);
        expect(result.reason).toBe('accepted');
    });

    test('durationMs is measured by the injected clock', async () => {
        let tick = 0;
        const result = await runDecide(baseOptions, makeDeps({ now: () => (tick += 5) }));
        expect(result.durationMs).toBe(5);
    });

    test('minConfidence defaults to 0.8 (0941 R1)', () => {
        expect(DEFAULT_MIN_CONFIDENCE).toBe(0.8);
    });
});

describe('runDecide degraded branches (0941 R3: never pause, never throw)', () => {
    test('disabled switch off: value=default, no maker, no evidence reads (0941 R4)', async () => {
        let makerCalled = false;
        let readCalled = false;
        const result = await runDecide(
            { ...baseOptions, evidence: ['summary.txt'] },
            {
                enabled: false,
                readFile: async () => {
                    readCalled = true;
                    return '';
                },
                now: () => 0,
                decisionMaker: () => {
                    makerCalled = true;
                    return Promise.resolve(fakeMaker({}));
                },
            },
        );
        expect(result.degraded).toBe(true);
        expect(result.reason).toBe('disabled');
        expect(result.value).toBe('stop');
        expect(result.backend).toBeNull();
        expect(result.confidence).toBeNull();
        expect(result.evidenceDigest).toBeNull();
        expect(makerCalled).toBe(false);
        expect(readCalled).toBe(false);
    });

    test('maker factory failure: no-backend', async () => {
        const result = await runDecide(
            baseOptions,
            makeDeps({
                decisionMaker: () => Promise.reject(new Error('provider construction failed')),
            }),
        );
        expect(result.degraded).toBe(true);
        expect(result.reason).toBe('no-backend');
        expect(result.value).toBe('stop');
        expect(result.backend).toBeNull();
    });

    test('unreadable declared evidence: error, no maker question asked (never fabricate from missing facts)', async () => {
        let questionAsked = false;
        const maker = fakeMaker({});
        const spyingMaker = {
            ...maker,
            choice: () => {
                questionAsked = true;
                return maker.choice({}, 'x', {});
            },
        } as unknown as DecisionMaker;
        const result = await runDecide(
            { ...baseOptions, evidence: ['missing.txt'] },
            makeDeps({ missing: ['missing.txt'], decisionMaker: () => Promise.resolve(spyingMaker) }),
        );
        expect(result.degraded).toBe(true);
        expect(result.reason).toBe('error');
        expect(result.evidenceDigest).toBeNull();
        expect(questionAsked).toBe(false);
    });

    test('out-of-set choice label: error with backend and confidence recorded', async () => {
        const result = await runDecide(
            baseOptions,
            makeDeps({
                decisionMaker: () => Promise.resolve(fakeMaker({ choice: { label: 'maybe', confidence: 0.9 } })),
            }),
        );
        expect(result.degraded).toBe(true);
        expect(result.reason).toBe('error');
        expect(result.value).toBe('stop');
        expect(result.backend).toBe('fake');
        expect(result.confidence).toBe(0.9);
    });

    test('low confidence: low-confidence with value=default (0941 R3)', async () => {
        const result = await runDecide(
            baseOptions,
            makeDeps({
                decisionMaker: () => Promise.resolve(fakeMaker({ choice: { label: 'retry', confidence: 0.3 } })),
            }),
        );
        expect(result.degraded).toBe(true);
        expect(result.reason).toBe('low-confidence');
        expect(result.value).toBe('stop');
        expect(result.backend).toBe('fake');
        expect(result.confidence).toBe(0.3);
    });

    test('explicit minConfidence gates the accepted branch', async () => {
        const result = await runDecide(
            { ...baseOptions, minConfidence: 0.99 },
            makeDeps({
                decisionMaker: () => Promise.resolve(fakeMaker({ choice: { label: 'retry', confidence: 0.92 } })),
            }),
        );
        expect(result.reason).toBe('low-confidence');
    });

    test('noul below minConfidence degrades with low-confidence', async () => {
        const result = await runDecide(
            { ...baseOptions, method: 'noul', choices: undefined },
            makeDeps({ decisionMaker: () => Promise.resolve(fakeMaker({ noul: { probability: 0.5 } })) }),
        );
        expect(result.reason).toBe('low-confidence');
        expect(result.value).toBe('stop');
    });

    test('maker rejection with DecisionTimeoutError classifies as timeout (15s from the factory)', async () => {
        const result = await runDecide(
            baseOptions,
            makeDeps({
                decisionMaker: () =>
                    Promise.resolve(fakeMaker({ throwOnChoice: new DecisionTimeoutError('timed out', 15000) })),
            }),
        );
        expect(result.degraded).toBe(true);
        expect(result.reason).toBe('timeout');
        expect(result.value).toBe('stop');
        expect(result.backend).toBe('fake');
    });

    test('noul timeout classifies as timeout too', async () => {
        const result = await runDecide(
            { ...baseOptions, method: 'noul', choices: undefined },
            makeDeps({
                decisionMaker: () =>
                    Promise.resolve(fakeMaker({ throwOnNoul: new DecisionTimeoutError('timed out', 15000) })),
            }),
        );
        expect(result.reason).toBe('timeout');
    });

    test('generic maker rejection classifies as error', async () => {
        const result = await runDecide(
            baseOptions,
            makeDeps({ decisionMaker: () => Promise.resolve(fakeMaker({ throwOnChoice: new Error('boom') })) }),
        );
        expect(result.degraded).toBe(true);
        expect(result.reason).toBe('error');
    });
});

describe('runDecide evidence handling (0941 invariant: redact + bound before leaving the process)', () => {
    test('secret-bearing evidence is redacted before the maker sees it', async () => {
        const capture: { evidence?: string[] } = {};
        await runDecide(
            { ...baseOptions, evidence: ['summary.txt'] },
            makeDeps({
                files: { 'summary.txt': 'key was sk-abcdef123456 and the run failed' },
                decisionMaker: () => Promise.resolve(fakeMaker({ capture })),
            }),
        );
        expect(capture.evidence).toEqual(['key was [REDACTED] and the run failed']);
    });

    test('evidence longer than the bound is truncated', async () => {
        const capture: { evidence?: string[] } = {};
        await runDecide(
            { ...baseOptions, evidence: ['summary.txt'] },
            makeDeps({
                files: { 'summary.txt': 'a'.repeat(DECIDE_EVIDENCE_MAX_CHARS + 500) },
                decisionMaker: () => Promise.resolve(fakeMaker({ capture })),
            }),
        );
        expect(capture.evidence?.[0]?.length).toBe(DECIDE_EVIDENCE_MAX_CHARS + 1); // truncation ellipsis
    });

    test('no evidence options: the maker still runs with empty evidence and a null digest', async () => {
        const capture: { evidence?: string[] } = {};
        const result = await runDecide(
            baseOptions,
            makeDeps({ decisionMaker: () => Promise.resolve(fakeMaker({ capture })) }),
        );
        expect(capture.evidence).toEqual([]);
        expect(result.evidenceDigest).toBeNull();
        expect(result.degraded).toBe(false);
    });
});
