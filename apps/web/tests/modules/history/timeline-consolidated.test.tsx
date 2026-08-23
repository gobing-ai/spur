import { afterAll, afterEach, beforeAll, describe, expect, test } from 'bun:test';
import type { HistoryTimelineResponse } from '@gobing-ai/spur-contracts';
import { cleanup, fireEvent, render } from '@testing-library/react';
import TimelineScrubber from '../../../src/modules/history/TimelineScrubber';
import TimelineTab from '../../../src/modules/history/TimelineTab';
import { registerHappyDom, teardownHappyDom } from '../../happy-dom';

beforeAll(registerHappyDom);
afterEach(cleanup);
afterAll(teardownHappyDom);

describe('TimelineScrubber and Consolidated Timeline', () => {
    test('TimelineScrubber renders 96 bins and slider when time range is valid', () => {
        let selectedTimestamp = '';
        const blocks: HistoryTimelineResponse['data']['blocks'] = [
            {
                key: 'agy:::s1:::0',
                sessionId: 's1',
                turnIndex: 0,
                timestamp: '2026-08-21T10:00:00Z',
                source: 'agy',
                model: 'gemini-3-pro',
                correlationExactness: null,
                totalDurationMs: 5000,
                totalTokens: 10000,
                operationCount: 2,
                events: [],
            },
            {
                key: 'codex:::s2:::0',
                sessionId: 's2',
                turnIndex: 0,
                timestamp: '2026-08-21T11:00:00Z',
                source: 'codex',
                model: 'gpt-5.6-sol',
                correlationExactness: null,
                totalDurationMs: 2000,
                totalTokens: 20000,
                operationCount: 1,
                events: [],
            },
        ];

        const view = render(
            <TimelineScrubber
                blocks={blocks}
                start="2026-08-21T10:00:00Z"
                end="2026-08-21T11:00:00Z"
                onJumpToTime={(timestamp) => (selectedTimestamp = timestamp)}
            />,
        );

        expect(view.getByTestId('timeline-scrubber')).toBeDefined();
        expect(view.getByTestId('timeline-scrubber-range')).toBeDefined();
        const rects = view.container.querySelectorAll('svg rect');
        expect(rects.length).toBe(96);
        expect(view.container.querySelector('svg')?.getAttribute('aria-hidden')).toBe('true');
        expect(Array.from(rects).some((rect) => Number(rect.getAttribute('height')) > 0)).toBe(true);
        fireEvent.input(view.getByTestId('timeline-scrubber-range'), {
            target: { value: String(Date.parse('2026-08-21T11:00:00Z')) },
        });
        expect(selectedTimestamp).toBe('2026-08-21T11:00:00.000Z');
    });

    test('TimelineTab in consolidated mode renders correlation exactness badge and multi-session header', () => {
        const consolidatedData: HistoryTimelineResponse['data'] = {
            mode: 'consolidated',
            scope: {
                sessionId: null,
                source: null,
                model: null,
                start: '2026-08-21T10:00:00Z',
                end: '2026-08-21T11:00:00Z',
                durationMs: 7000,
                tokens: {
                    billedTokens: 30000,
                    cacheSavedTokens: 5000,
                    cacheReadTokens: 5000,
                    freshInputTokens: 20000,
                    outputTokens: 5000,
                },
                messageCount: 4,
                toolCallCount: 3,
                sessionCount: 2,
            },
            truncated: true,
            blocks: [
                {
                    key: 'agy:::s1:::0',
                    sessionId: 's1',
                    turnIndex: 0,
                    timestamp: '2026-08-21T10:00:00Z',
                    source: 'agy',
                    model: 'gemini-3-pro',
                    correlationExactness: 'exact',
                    totalDurationMs: 5000,
                    totalTokens: 10000,
                    operationCount: 2,
                    events: [
                        {
                            seq: 0,
                            eventType: 'message',
                            kind: 'user',
                            title: 'Run task',
                            toolName: null,
                            durationMs: null,
                            durationSource: 'unmeasured',
                            tokens: 0,
                            freshInputTokens: 0,
                            cacheReadTokens: 0,
                            outputTokens: 0,
                            promptTokens: {
                                billedTokens: 10000,
                                cacheSavedTokens: 1000,
                                cacheReadTokens: 1000,
                                freshInputTokens: 8000,
                                outputTokens: 1000,
                            },
                            exitCode: null,
                            payload: 'Run task',
                            agent: 'agy',
                            model: 'gemini-3-pro',
                        },
                        {
                            seq: 1,
                            eventType: 'tool',
                            kind: 'bash',
                            title: 'bun test',
                            toolName: 'Bash',
                            durationMs: 4000,
                            durationSource: 'inferred',
                            tokens: 10000,
                            freshInputTokens: 8000,
                            cacheReadTokens: 1000,
                            outputTokens: 1000,
                            promptTokens: null,
                            exitCode: 0,
                            payload: 'bun test',
                            agent: 'agy',
                            model: 'gemini-3-pro',
                        },
                    ],
                },
                {
                    key: 'codex:::s2:::0',
                    sessionId: 's2',
                    turnIndex: 0,
                    timestamp: '2026-08-21T11:00:00Z',
                    source: 'codex',
                    model: 'gpt-5.6-sol',
                    correlationExactness: 'estimated',
                    totalDurationMs: 2000,
                    totalTokens: 20000,
                    operationCount: 1,
                    events: [
                        {
                            seq: 0,
                            eventType: 'tool',
                            kind: 'read',
                            title: 'read summary',
                            toolName: 'Read',
                            durationMs: 2000,
                            durationSource: 'measured',
                            tokens: 20000,
                            freshInputTokens: 15000,
                            cacheReadTokens: 4000,
                            outputTokens: 1000,
                            promptTokens: null,
                            exitCode: 0,
                            payload: 'Task complete',
                            agent: 'codex',
                            model: 'gpt-5.6-sol',
                        },
                    ],
                },
            ],
        };

        let appliedScope = { taskWbs: '', runId: '' };
        const view = render(
            <TimelineTab
                data={consolidatedData}
                mode="consolidated"
                onConsolidatedScopeSubmit={(scope) => (appliedScope = scope)}
            />,
        );

        // Truncation banner
        expect(view.getByTestId('timeline-truncated-banner')).toBeDefined();
        expect(view.getByText(/Showing newest 5,000 events/)).toBeDefined();

        // Correlation exactness badges
        const exactBadge = view.getByTestId('timeline-exactness-agy:::s1:::0');
        expect(exactBadge.textContent).toBe('exact');
        const estimatedBadge = view.getByTestId('timeline-exactness-codex:::s2:::0');
        expect(estimatedBadge.textContent).toBe('estimated');

        // Gutter duration inferred format ~4.0s
        const stepDur = view.getByTestId('timeline-step-duration-agy:::s1:::0-1');
        expect(stepDur.textContent).toContain('~4.0s');

        // Scope header shows session count
        expect(view.getByText('2 sessions')).toBeDefined();

        expect(view.getByTestId('timeline-mode-consolidated').getAttribute('aria-pressed')).toBe('true');
        fireEvent.input(view.getByLabelText('Task WBS'), { target: { value: ' 0638 ' } });
        fireEvent.input(view.getByLabelText('Run ID'), { target: { value: ' run-test-1 ' } });
        fireEvent.click(view.getByRole('button', { name: 'Apply scope' }));
        expect(appliedScope).toEqual({ taskWbs: '0638', runId: 'run-test-1' });

        let scrolled = false;
        const targetBlock = view.getByTestId('timeline-block-codex:::s2:::0');
        Object.defineProperty(targetBlock, 'scrollIntoView', { value: () => (scrolled = true) });
        fireEvent.input(view.getByTestId('timeline-scrubber-range'), {
            target: { value: String(Date.parse('2026-08-21T11:00:00Z')) },
        });
        expect(scrolled).toBe(true);
    });
});
