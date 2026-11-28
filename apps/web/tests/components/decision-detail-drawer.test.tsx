/**
 * P12 R3 (task 1467) — the decision drawer shows the served model only when a backend reported one.
 *
 * The failure modes: the row rendering an empty "Served model" for a fallback (noise that reads as
 * missing data), and a non-null model being dropped from the field list.
 */
import { afterAll, afterEach, beforeEach, describe, expect, mock, spyOn, test } from 'bun:test';
import type { DecisionLogRow } from '@gobing-ai/spur-contracts';
import { act, cleanup, render } from '@testing-library/react';
import { createElement } from 'react';
import DecisionDetailDrawer from '../../src/modules/observability/DecisionDetailDrawer';
import { registerHappyDom, teardownHappyDom } from '../happy-dom';

registerHappyDom();
afterAll(teardownHappyDom);
beforeEach(() => {
    spyOn(globalThis, 'fetch').mockImplementation(
        (async () => new Response(null, { status: 404 })) as unknown as typeof fetch,
    );
});
afterEach(() => {
    cleanup();
    mock.restore();
});

/** A list row with every contract field populated; `servedModel` is the variable under test. */
function row(servedModel: string | null): DecisionLogRow {
    return {
        id: 'dcl_1',
        decisionId: 'publish.pr',
        decisionType: 'choice',
        caller: 'cli',
        runId: null,
        workflowName: null,
        nodeId: null,
        wbs: null,
        makerName: 'typesafe',
        makerSource: 'registered',
        catalogLayer: 'bundled',
        catalogSource: '/catalog/decisions',
        minConfidence: 0.8,
        inputKeys: [],
        evidenceDigest: null,
        outcome: 'accepted',
        value: '"ship"',
        fallbackValue: null,
        source: 'model',
        reason: 'accepted',
        confidence: 0.9,
        confidenceLevel: 'HIGH',
        error: null,
        servedModel,
        startedAt: '2026-07-04T01:00:00.000Z',
        endedAt: '2026-07-04T01:00:01.000Z',
        durationMs: 1000,
        schemaVersion: 1,
    };
}

async function renderDrawer(servedModel: string | null): Promise<HTMLElement> {
    const view = render(createElement(DecisionDetailDrawer, { row: row(servedModel), onClose: () => {} }));
    await act(async () => {});
    return view.container;
}

describe('P12 R3 — served model in the decision detail drawer', () => {
    test('renders the field with the reported model', async () => {
        const text = (await renderDrawer('m-x')).textContent ?? '';
        expect(text).toContain('Served model');
        expect(text).toContain('m-x');
    });

    test('omits the field entirely when no model was reported', async () => {
        const text = (await renderDrawer(null)).textContent ?? '';
        expect(text).not.toContain('Served model');
    });
});
