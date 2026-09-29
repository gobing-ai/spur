import { describe, expect, test } from 'bun:test';

import {
    ALLOWED_EVIDENCE_CHANNELS,
    evaluateTaskEvidence,
    makeTaskEvidenceDeps,
    parseEvidenceChannels,
} from '../../src/services/task-evidence-precheck';

const noopCounter = async () => 0;

describe('parseEvidenceChannels (1002 R2)', () => {
    test('extracts declarations in order', () => {
        expect(
            parseEvidenceChannels('evidence-channel: history_tool_call.args_raw[pi]\ntext\nevidence-channel: other'),
        ).toEqual(['history_tool_call.args_raw[pi]', 'other']);
    });

    test('no declaration → empty', () => {
        expect(parseEvidenceChannels('### Requirements\n- [ ] R1. x')).toEqual([]);
    });
});

describe('evaluateTaskEvidence (1002 R2 — ported from the 0726 script contract)', () => {
    const noDecl = '### Requirements\n- [ ] R1. x';

    test('no declaration passes without calling the DB counter', async () => {
        let calls = 0;
        const report = await evaluateTaskEvidence(noDecl, {
            countArgsRaw: async () => {
                calls += 1;
                return 5;
            },
        });
        expect(report.ok).toBe(true);
        expect(report.reasons).toEqual([]);
        expect(calls).toBe(0);
    });

    test('unknown declaration fails closed, naming the allowlist', async () => {
        const report = await evaluateTaskEvidence('evidence-channel: some.other.channel[x]', {
            countArgsRaw: noopCounter,
        });
        expect(report.ok).toBe(false);
        expect(report.reasons[0]).toContain('unknown evidence-channel declaration');
        expect(report.reasons[1]).toContain(ALLOWED_EVIDENCE_CHANNELS[0]);
    });

    test('null count (missing DB/table) fails closed', async () => {
        const report = await evaluateTaskEvidence('evidence-channel: history_tool_call.args_raw[pi]', {
            countArgsRaw: async () => null,
        });
        expect(report.ok).toBe(false);
        expect(report.reasons[0]).toContain('missing/unreadable');
    });

    test('zero count fails closed with the import hint', async () => {
        const report = await evaluateTaskEvidence('evidence-channel: history_tool_call.args_raw[pi]', {
            countArgsRaw: async () => 0,
        });
        expect(report.ok).toBe(false);
        expect(report.reasons[0]).toContain('0 live pi rows');
    });

    test('positive count passes', async () => {
        const report = await evaluateTaskEvidence('evidence-channel: history_tool_call.args_raw[pi]', {
            countArgsRaw: async () => 3,
        });
        expect(report.ok).toBe(true);
        expect(report.reasons).toEqual([]);
    });

    test('counter throw is treated as a missing DB (fail closed)', async () => {
        const report = await evaluateTaskEvidence('evidence-channel: history_tool_call.args_raw[pi]', {
            countArgsRaw: async () => {
                throw new Error('boom');
            },
        });
        expect(report.ok).toBe(false);
    });
});

describe('makeTaskEvidenceDeps (1002 R3)', () => {
    test('bridges the domain reader and wraps throw as null', async () => {
        const deps = makeTaskEvidenceDeps({} as never, async () => 7);
        expect(await deps.countArgsRaw('pi')).toBe(7);

        const failing = makeTaskEvidenceDeps({} as never, async () => {
            throw new Error('x');
        });
        expect(await failing.countArgsRaw('pi')).toBeNull();
    });
});
