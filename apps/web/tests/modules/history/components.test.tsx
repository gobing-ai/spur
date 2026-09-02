import { afterAll, afterEach, beforeAll, describe, expect, test } from 'bun:test';
import type {
    HistoryInsightsResponse,
    HistoryKpiTrendPoint,
    HistorySessionsResponse,
    HistorySourcesResponse,
    HistorySummaryResponse,
    HistoryTimelineResponse,
} from '@gobing-ai/spur-contracts';
import { cleanup, fireEvent, render, waitFor } from '@testing-library/react';
import { HeatmapGrid } from '../../../src/modules/history/charts';
import HistoryFilters from '../../../src/modules/history/HistoryFilters';
import InsightsTab from '../../../src/modules/history/InsightsTab';
import SessionsTab from '../../../src/modules/history/SessionsTab';
import SourcesTab from '../../../src/modules/history/SourcesTab';
import SummaryTab from '../../../src/modules/history/SummaryTab';
import TimelineTab from '../../../src/modules/history/TimelineTab';
import { registerHappyDom, teardownHappyDom } from '../../happy-dom';

beforeAll(registerHappyDom);
afterEach(cleanup);
afterAll(teardownHappyDom);

const summary: HistorySummaryResponse['data'] = {
    kpis: {
        totalBilledTokens: 150,
        cacheSavedTokens: 200,
        cacheSavedPercent: 57,
        sessionsCount: 1,
        toolCallsCount: 2,
        errorRate: 0,
    },
    timeSeries: [{ bucketStart: '2026-08-21', cacheHitRatio: 57, series: { Read: 150 } }],
    topModels: [
        {
            id: 'gpt-5.6-sol',
            label: 'gpt-5.6-sol',
            color: '#3987e5',
            tokens: 150,
            share: 100,
            freshInputTokens: 100,
            cacheReadTokens: 40,
            outputTokens: 10,
        },
    ],
    topSources: [
        {
            id: 'codex',
            label: 'Codex',
            color: '#d95926',
            tokens: 150,
            share: 100,
            freshInputTokens: 100,
            cacheReadTokens: 40,
            outputTokens: 10,
        },
    ],
    topTools: [{ id: 'Read', count: 2, errors: 0, errorRate: 0 }],
    skillsUsed: [{ id: 'sp-dev-verify', label: 'Sp Dev Verify', color: '#199e70', count: 1 }],
    cacheEfficiency: { hitRatio: 57, savedTokens: 200, totalRead: 300 },
    kpiTrend: [],
    previousKpis: null,
    skillTimeSeries: [],
};

const sources: HistorySourcesResponse['data'] = {
    overview: {
        totalFiles: 1,
        corpusSizeBytes: 4096,
        dateCoverage: { from: '2026-08-01T00:00:00Z', to: '2026-08-21T00:00:00Z' },
        totalSessions: 2,
        lastImportedAt: null,
    },
    agents: [
        {
            id: 'codex',
            name: 'Codex',
            color: '#d95926',
            importPath: '~/.codex/sessions/',
            filePattern: 'rollout-*.jsonl',
            filesCount: 1,
            sizeMb: null,
            sessionCount: 2,
            totalTokens: 150,
            cacheSavedTokens: 200,
            freshTokens: 100,
            toolCalls: 3,
            firstDate: '2026-08-01T00:00:00Z',
            lastDate: '2026-08-21T00:00:00Z',
            heatmapDays: [{ date: '2026-08-21', tokens: 150, sessions: 2 }],
            maxDailyTokens: 150,
        },
    ],
    roots: [
        {
            agentId: 'codex',
            agentName: 'Codex',
            path: '~/.codex/sessions/',
            matchPattern: 'rollout-*.jsonl',
            fileCount: 1,
            status: 'active',
        },
    ],
};

const timeline: HistoryTimelineResponse['data'] = {
    mode: 'session',
    scope: {
        sessionId: 'session-1',
        source: 'agy',
        model: 'gemini-3-pro',
        start: '2026-08-21T10:00:00Z',
        end: '2026-08-21T10:05:01Z',
        durationMs: 6_000,
        tokens: {
            billedTokens: 60_000,
            cacheSavedTokens: 1_000,
            cacheReadTokens: 1_000,
            freshInputTokens: 55_000,
            outputTokens: 5_000,
        },
        messageCount: 1,
        toolCallCount: 1,
        sessionCount: 1,
    },
    truncated: false,
    blocks: [
        {
            key: 'agy:::session-1:::0',
            sessionId: 'session-1',
            turnIndex: 0,
            timestamp: '2026-08-21T10:00:00Z',
            source: 'agy',
            model: 'gemini-3-pro',
            correlationExactness: null,
            totalDurationMs: 6_000,
            totalTokens: 60_000,
            operationCount: 1,
            events: [
                {
                    seq: 0,
                    eventType: 'message',
                    kind: 'user',
                    title: 'Fix the failing bun test',
                    toolName: null,
                    durationMs: null,
                    durationSource: 'unmeasured',
                    tokens: 0,
                    freshInputTokens: 0,
                    cacheReadTokens: 0,
                    outputTokens: 0,
                    promptTokens: {
                        billedTokens: 60_000,
                        cacheSavedTokens: 1_000,
                        cacheReadTokens: 1_000,
                        freshInputTokens: 55_000,
                        outputTokens: 5_000,
                    },
                    exitCode: null,
                    payload: '  Fix the failing bun test\nand keep coverage green.  ',
                    agent: 'agy',
                    model: 'gemini-3-pro',
                },
                {
                    seq: 1,
                    eventType: 'tool',
                    kind: 'bash',
                    title: 'bun test',
                    toolName: 'Bash',
                    durationMs: 6_000,
                    durationSource: 'measured',
                    tokens: 60_000,
                    freshInputTokens: 55_000,
                    cacheReadTokens: 1_000,
                    outputTokens: 5_000,
                    promptTokens: null,
                    exitCode: 0,
                    payload: 'bun test',
                    agent: 'agy',
                    model: 'gemini-3-pro',
                },
            ],
        },
        {
            key: 'agy:::session-1:::1',
            sessionId: 'session-1',
            turnIndex: 1,
            timestamp: '2026-08-21T10:05:00Z',
            source: 'agy',
            model: 'gemini-3-pro',
            correlationExactness: null,
            totalDurationMs: 1_000,
            totalTokens: 10_000,
            operationCount: 1,
            events: [
                {
                    seq: 1,
                    eventType: 'tool',
                    kind: 'read',
                    title: 'src/index.ts',
                    toolName: 'Read',
                    durationMs: 1_000,
                    durationSource: 'measured',
                    tokens: 10_000,
                    freshInputTokens: 8_000,
                    cacheReadTokens: 1_000,
                    outputTokens: 1_000,
                    promptTokens: null,
                    exitCode: null,
                    payload: 'src/index.ts',
                    agent: 'agy',
                    model: 'gemini-3-pro',
                },
            ],
        },
    ],
};

const insights: HistoryInsightsResponse['data'] = {
    loops: [],
    cacheWaste: [],
    heavySessions: [],
    largestTokenSteps: [],
    slowSteps: [],
    modelComparison: [
        { model: 'fast-model', speedMsMean: 1000, cacheRatio: 1.5, reliability: -0.2, outputRatio: 1.2 },
        { model: 'slow-model', speedMsMean: 4000, cacheRatio: 0.5, reliability: 0.9, outputRatio: 0.2 },
    ],
};

const kpiTrend: HistoryKpiTrendPoint[] = [
    {
        day: '2026-08-20',
        totalBilledTokens: 100,
        cacheSavedTokens: 50,
        sessionsCount: 1,
        toolCallsCount: 2,
        cacheHitRatio: 50,
    },
    {
        day: '2026-08-21',
        totalBilledTokens: 120,
        cacheSavedTokens: 60,
        sessionsCount: 1,
        toolCallsCount: 3,
        cacheHitRatio: 55,
    },
    {
        day: '2026-08-22',
        totalBilledTokens: 140,
        cacheSavedTokens: 70,
        sessionsCount: 2,
        toolCallsCount: 4,
        cacheHitRatio: 61,
    },
];

const sessions: HistorySessionsResponse['data'] = {
    items: [
        {
            id: 'abcdefghijklmnopqrst',
            source: 'codex',
            model: 'gpt-5.6-sol',
            start: '2026-08-21T10:00:00Z',
            durationMs: 60000,
            messages: 2,
            toolCalls: 3,
            billedTokens: 150,
            cacheReadTokens: 200,
            freshInputTokens: 100,
            outputTokens: 50,
            topTool: 'Read',
            state: 'ok',
        },
        {
            id: 'short-id',
            source: 'agy',
            model: 'gemini-3-pro',
            start: '2026-08-21T11:00:00Z',
            durationMs: 30000,
            messages: 1,
            toolCalls: 1,
            billedTokens: 80,
            cacheReadTokens: 10,
            freshInputTokens: 70,
            outputTokens: 20,
            topTool: 'Bash',
            state: 'ok',
        },
    ],
    total: 2,
    page: 1,
    pageSize: 20,
};

describe('History Board components', () => {
    test('Filter search keeps keyboard focus while typing', () => {
        const view = render(
            <HistoryFilters
                filter={{ range: '30d' }}
                onChange={() => undefined}
                sourceOptions={[
                    { id: 'codex', label: 'Codex' },
                    { id: 'claude', label: 'Claude Code' },
                ]}
            />,
        );

        fireEvent.click(view.getByRole('button', { name: 'Agents: All' }));
        const search = view.getByRole('searchbox', { name: 'Search Agents' });
        search.focus();
        fireEvent.keyDown(search, { key: 'c' });
        expect(document.activeElement).toBe(search);
    });

    test('Range presets include 1h/4h and emit the selected range', () => {
        const next: { range?: string } = {};
        const view = render(<HistoryFilters filter={{ range: '4h' }} onChange={(f) => (next.range = f.range)} />);

        const preset4h = view.getByRole('button', { name: '4H' });
        expect(preset4h.getAttribute('aria-pressed') ?? preset4h.className).toContain('bg-primary');
        fireEvent.click(view.getByRole('button', { name: '1H' }));
        expect(next.range).toBe('1h');
    });

    test('Summary renders all 4 dimension blocks (By Model, By Source, By Tool, By Skill) simultaneously', () => {
        const view = render(<SummaryTab data={summary} />);

        expect(view.getByTestId('summary-block-model')).toBeDefined();
        expect(view.getByTestId('summary-block-source')).toBeDefined();
        expect(view.getByTestId('summary-block-tool')).toBeDefined();
        expect(view.getByTestId('summary-block-skill')).toBeDefined();
    });

    test('Sources renders vector agent icons, telemetry tooltip, and queued import state', async () => {
        const view = render(
            <SourcesTab
                data={sources}
                onTriggerImport={async () => ({
                    runId: 'history-refresh-1',
                    status: 'queued',
                    message: 'Incremental import queued.',
                })}
            />,
        );

        const icon = view.container.querySelector('[aria-describedby="source-tooltip-codex"]');
        expect(icon?.querySelector('svg')).not.toBeNull();
        expect(view.getByRole('tooltip').textContent).toContain('Imported Files');
        expect(view.getByRole('tooltip').textContent).toContain('Date Range');

        fireEvent.click(view.getByRole('button', { name: /Import & Analyze/ }));
        await waitFor(() => expect(view.getByText('Incremental import queued.')).toBeDefined());
    });

    test('Timeline renders Conversation panel with filter checkboxes, ordered 9-field metadata, and formula calculations', () => {
        const view = render(<TimelineTab data={timeline} />);

        // Panel header
        expect(view.getByText('Conversation')).toBeDefined();

        // Filter checkboxes (checked by default)
        const filterAssistant = view.getByTestId('timeline-filter-assistant') as HTMLInputElement;
        const filterUnknown = view.getByTestId('timeline-filter-unknown') as HTMLInputElement;
        const filterEmpty = view.getByTestId('timeline-filter-empty') as HTMLInputElement;
        expect(filterAssistant.checked).toBe(true);
        expect(filterUnknown.checked).toBe(true);
        expect(filterEmpty.checked).toBe(true);
        expect(view.getByText('Hide other empty')).toBeDefined();
        expect(view.getByRole('button', { name: 'Expand all' }).nextElementSibling?.contains(filterAssistant)).toBe(
            true,
        );

        // 9-field metadata strip in exact order
        const metaStrip = view.getByTestId('timeline-metadata-strip');
        const labels = Array.from(metaStrip.querySelectorAll('.uppercase')).map((el) => el.textContent?.trim());
        expect(labels).toEqual([
            'SESSION',
            'AGENT',
            'MODEL',
            'STARTED',
            'DURATION',
            'TOTAL TOKENS',
            'CACHE READ',
            'OUTPUT TOKENS',
            'TOOL CALLS',
        ]);

        // TOTAL TOKENS formula = 55_000 + 1_000 + 5_000 = 61_000 -> 61.0K
        expect(metaStrip.textContent).toContain('61.0K');
        // CACHE READ formula = 1_000 / (55_000 + 1_000) * 100 = 1.785% -> 1.8%
        expect(metaStrip.textContent).toContain('1.8%');
        // OUTPUT TOKENS = 5_000 -> 5.0K
        expect(metaStrip.textContent).toContain('5.0K');
        // TOOL CALLS = 1
        expect(metaStrip.textContent).toContain('1');

        // Zero-denominator cache read maps to 0.0%
        const zeroCacheTimeline: HistoryTimelineResponse['data'] = {
            ...timeline,
            scope: {
                ...timeline.scope,
                tokens: {
                    billedTokens: 0,
                    cacheSavedTokens: 0,
                    cacheReadTokens: 0,
                    freshInputTokens: 0,
                    outputTokens: 0,
                },
            },
        };
        view.rerender(<TimelineTab data={zeroCacheTimeline} />);
        const zeroMetaStrip = view.getByTestId('timeline-metadata-strip');
        expect(zeroMetaStrip.textContent).toContain('0.0%');

        // Zero currency / USD fields
        expect(view.container.textContent).not.toContain('$');
        expect(view.container.textContent).not.toContain('USD');
    });

    test('Timeline renders compact cards with Sources AgentIcon tooltip, as-is tool badge, UserTokenBadge prompt, and filters', () => {
        const view = render(<TimelineTab data={timeline} />);

        // One responsive rail owns prompt and operation nodes.
        const rail = view.getByTestId('timeline-rail');
        expect(rail.className).toContain('sm:before:left-[136px]');
        expect(rail.className).toContain('before:left-2');
        expect(rail.querySelectorAll('[data-timeline-node="prompt"]')).toHaveLength(1);
        expect(rail.querySelectorAll('[data-timeline-node="operation"]')).toHaveLength(2);

        // User prompt renders as a unified card with UserTokenBadge and character count (no redundant USER text), right-aligned at 80% width.
        const userRow = view.getByTestId('timeline-user-event-agy:::session-1:::0-0');
        expect(userRow.textContent).toContain('Fix the failing bun test');
        expect(userRow.textContent).not.toContain('USER');
        expect(userRow.textContent).toContain('0 in');
        expect(userRow.querySelector('.flex.justify-end')).not.toBeNull();
        expect(userRow.querySelector('.w-\\[80\\%\\]')).not.toBeNull();
        // User prompt has UserTokenBadge with hover/focus token breakdown tooltip elevated at z-50
        const userBadge = view.getByTestId('timeline-user-badge-user-tt-agy---session-1---0-0');
        expect(userBadge).toBeDefined();
        const userTooltip = view.getByTestId('user-tt-agy---session-1---0-0');
        expect(userTooltip.getAttribute('role')).toBe('tooltip');
        expect(userTooltip.className).toContain('z-50');
        for (const label of ['User Prompt Telemetry', 'Fresh input:', 'Cache read:', 'Output:', '⚡ Turn load:']) {
            expect(userTooltip.textContent).toContain(label);
        }
        expect(userTooltip.textContent).toContain('49 chars');
        expect(userTooltip.className).toContain('hidden');
        fireEvent.focus(userBadge);
        expect(userTooltip.className).not.toContain('hidden');
        fireEvent.blur(userBadge);
        expect(userTooltip.className).toContain('hidden');
        fireEvent.focus(userBadge);
        fireEvent.keyDown(userBadge, { key: 'Escape' });
        expect(userTooltip.className).toContain('hidden');
        fireEvent.mouseEnter(userBadge);
        expect(userTooltip.className).not.toContain('hidden');
        fireEvent.mouseLeave(userBadge);
        expect(userTooltip.className).toContain('hidden');
        // Operation row has left alignment and 80% width class
        const opRow = view.getByTestId('timeline-op-event-agy:::session-1:::0-1');
        expect(opRow.querySelector('.flex.justify-start')).not.toBeNull();
        expect(opRow.querySelector('.w-\\[80\\%\\]')).not.toBeNull();
        // Operation card has AgentIcon with tooltip elevated at z-50
        const agentBadge = view.getByTestId('timeline-agent-badge-agent-tt-agy---session-1---0-1');
        expect(agentBadge).toBeDefined();
        const agentTooltip = view.getByTestId('agent-tt-agy---session-1---0-1');
        expect(agentTooltip.getAttribute('role')).toBe('tooltip');
        expect(agentTooltip.className).toContain('z-50');
        expect(agentTooltip.className).toContain('hidden');
        fireEvent.focus(agentBadge);
        expect(agentTooltip.className).not.toContain('hidden');
        expect(agentTooltip.textContent).toContain('agy');
        expect(agentTooltip.textContent).toContain('gemini-3-pro');
        expect(agentTooltip.textContent).toContain('Timestamp:');
        expect(agentTooltip.textContent).toContain('Fresh input:');
        expect(agentTooltip.textContent).toContain('55.0K');
        expect(agentTooltip.textContent).toContain('Cache read:');
        expect(agentTooltip.textContent).toContain('1.0K');
        expect(agentTooltip.textContent).toContain('5.0K');
        expect(agentTooltip.textContent).toContain('61.0K');
        fireEvent.keyDown(agentBadge, { key: 'Escape' });
        expect(agentTooltip.className).toContain('hidden');

        // Operation card has tool tag with rich inspection tooltip elevated at z-50
        const toolBadge = view.getByTestId('timeline-tool-badge-tool-tt-agy---session-1---0-1');
        expect(toolBadge.textContent).toBe('Bash');
        const toolTooltip = view.getByTestId('tool-tt-agy---session-1---0-1');
        expect(toolTooltip.getAttribute('role')).toBe('tooltip');
        expect(toolTooltip.className).toContain('z-50');
        expect(toolTooltip.className).toContain('hidden');
        fireEvent.mouseEnter(toolBadge);
        expect(toolTooltip.className).not.toContain('hidden');
        expect(toolTooltip.textContent).toContain('Bash');
        expect(toolTooltip.textContent).toContain('DURATION');
        expect(toolTooltip.textContent).toContain('TIMESTAMP');
        expect(toolTooltip.textContent).toContain('Arguments (raw)');
        fireEvent.keyDown(toolBadge, { key: 'Escape' });
        expect(toolTooltip.className).toContain('hidden');

        // Right-aligned EXIT_CODE badge
        const exitCode = view.getByText('EXIT_CODE=0');
        expect(exitCode.parentElement?.className).toContain('shrink-0');
        expect(exitCode.parentElement?.firstElementChild).toBe(exitCode);
        expect(exitCode.nextElementSibling?.tagName).toBe('BUTTON');
        expect(exitCode.nextElementSibling?.getAttribute('aria-label')).toBe('Expand operation payload');

        // Prompt disclosure reveals full text.
        const promptButton = userRow.querySelector('button[aria-expanded]');
        expect(promptButton?.getAttribute('aria-label')).toBe('Expand full user prompt');
        fireEvent.click(promptButton as HTMLButtonElement);
        const promptDrawerId = promptButton?.getAttribute('aria-controls');
        const promptDrawer = promptDrawerId ? view.container.querySelector(`#${promptDrawerId}`) : null;
        expect(promptDrawer?.textContent).toBe('Fix the failing bun test\nand keep coverage green.');

        // Expand all reveals operation payloads.
        const expandAllBtn = view.getByRole('button', { name: 'Expand all' });
        expect(expandAllBtn.getAttribute('aria-pressed')).toBe('false');
        fireEvent.click(expandAllBtn);
        expect(view.getByRole('button', { name: 'Collapse all' }).getAttribute('aria-pressed')).toBe('true');
        expect(view.getAllByText('bun test').length).toBeGreaterThanOrEqual(1);
        expect(view.getAllByText('src/index.ts').length).toBeGreaterThanOrEqual(1);

        // Hide other empty filter test
        const filterEmpty = view.getByTestId('timeline-filter-empty') as HTMLInputElement;
        expect(filterEmpty.checked).toBe(true);
        fireEvent.click(filterEmpty);
        expect(filterEmpty.checked).toBe(false);

        // Hide assistant filter test
        const filterAssistant = view.getByTestId('timeline-filter-assistant') as HTMLInputElement;
        expect(filterAssistant.checked).toBe(true);
        fireEvent.click(filterAssistant);
        expect(filterAssistant.checked).toBe(false);
    });

    test('Timeline reports zero prompt characters and lines when prompt content is absent', () => {
        const emptyPromptTimeline = structuredClone(timeline);
        const userEvent = emptyPromptTimeline.blocks[0]?.events[0];
        if (!userEvent) throw new Error('missing user event fixture');
        userEvent.payload = '';
        userEvent.title = 'user turn';
        userEvent.promptTokens = null;

        const view = render(<TimelineTab data={emptyPromptTimeline} />);
        fireEvent.click(view.getByTestId('timeline-filter-empty'));
        const tooltip = view.getByTestId('user-tt-agy---session-1---0-0');
        expect(tooltip.textContent).toContain('0 lines (0 chars)');
        expect(tooltip.textContent).toContain('⚡ Turn load:0');
    });

    test('Timeline renders assistant and tool cards without conflating their identity or payload', () => {
        const cardTimeline = structuredClone(timeline);
        const block = cardTimeline.blocks[0];
        if (!block) throw new Error('missing timeline block fixture');
        block.events = [
            {
                seq: 0,
                eventType: 'message',
                kind: 'assistant',
                title: 'assistant turn',
                toolName: null,
                durationMs: null,
                durationSource: 'unmeasured',
                tokens: 123,
                freshInputTokens: 0,
                cacheReadTokens: 0,
                outputTokens: 123,
                promptTokens: null,
                exitCode: null,
                payload: 'assistant response body',
                agent: 'agy',
                model: 'gemini-3-pro',
            },
            {
                seq: 1,
                eventType: 'tool',
                kind: 'read',
                title: 'src/file.ts',
                toolName: 'Read',
                durationMs: 10,
                durationSource: 'measured',
                tokens: 10,
                freshInputTokens: 10,
                cacheReadTokens: 0,
                outputTokens: 0,
                promptTokens: null,
                exitCode: 0,
                payload:
                    'tool: Read\nstatus: success\nargs_digest: aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa (raw payload omitted at import)',
                agent: 'agy',
                model: 'gemini-3-pro',
            },
        ];

        const view = render(<TimelineTab data={cardTimeline} />);
        fireEvent.click(view.getByTestId('timeline-filter-assistant'));

        const assistant = view.getByTestId('timeline-op-event-agy:::session-1:::0-0');
        expect(assistant.textContent).toContain('gemini-3-pro');
        expect(assistant.textContent).toContain('📤 123');
        expect(assistant.querySelector('[data-testid^="timeline-tool-badge-"]')).toBeNull();
        expect(assistant.textContent).not.toContain('EXIT_CODE');
        fireEvent.click(view.getByRole('button', { name: 'Expand response' }));
        expect(view.getAllByText('assistant response body').length).toBeGreaterThanOrEqual(1);

        const tool = view.getByTestId('timeline-op-event-agy:::session-1:::0-1');
        expect(tool.querySelector('[data-testid^="timeline-tool-badge-"]')?.textContent).toBe('Read');
        expect(tool.textContent).toContain('src/file.ts');
        const toolDisclosure = tool.querySelector('button[aria-label="Expand operation payload"]');
        if (!toolDisclosure) throw new Error('missing tool disclosure');
        fireEvent.click(toolDisclosure);
        expect(tool.textContent).toContain('raw payload omitted at import');
    });

    test('Timeline filters assistant, unknown, and truly empty events without hiding tool runs or cache-only work', () => {
        const event = {
            durationMs: null,
            durationSource: 'unmeasured',
            tokens: 0,
            freshInputTokens: 0,
            cacheReadTokens: 0,
            outputTokens: 0,
            promptTokens: null,
            exitCode: null,
            payload: null,
            agent: 'codex',
            model: 'gpt-5.6-sol',
        } as const;
        const filterTimeline: HistoryTimelineResponse['data'] = {
            ...timeline,
            blocks: [
                {
                    key: 'codex:::sess:::0',
                    sessionId: 'sess',
                    turnIndex: 0,
                    timestamp: '2026-08-21T10:00:00Z',
                    source: 'codex',
                    model: 'gpt-5.6-sol',
                    correlationExactness: null,
                    totalDurationMs: 0,
                    totalTokens: 0,
                    operationCount: 1,
                    events: [
                        {
                            ...event,
                            seq: 0,
                            eventType: 'message',
                            kind: 'assistant',
                            title: 'assistant turn',
                            toolName: null,
                        },
                    ],
                },
                {
                    key: 'codex:::sess:::1',
                    sessionId: 'sess',
                    turnIndex: 1,
                    timestamp: '2026-08-21T10:00:01Z',
                    source: 'codex',
                    model: 'gpt-5.6-sol',
                    correlationExactness: null,
                    totalDurationMs: 0,
                    totalTokens: 0,
                    operationCount: 1,
                    events: [
                        {
                            ...event,
                            seq: 0,
                            eventType: 'message',
                            kind: 'run',
                            title: 'legacy assistant run',
                            toolName: null,
                        },
                    ],
                },
                {
                    key: 'codex:::sess:::2',
                    sessionId: 'sess',
                    turnIndex: 2,
                    timestamp: '2026-08-21T10:00:02Z',
                    source: 'codex',
                    model: 'gpt-5.6-sol',
                    correlationExactness: null,
                    totalDurationMs: 1,
                    totalTokens: 0,
                    operationCount: 1,
                    events: [
                        {
                            ...event,
                            seq: 0,
                            eventType: 'tool',
                            kind: 'run',
                            title: 'run tool',
                            toolName: 'Run',
                            durationMs: 1,
                            durationSource: 'measured',
                            exitCode: 0,
                        },
                    ],
                },
                {
                    key: 'codex:::sess:::3',
                    sessionId: 'sess',
                    turnIndex: 3,
                    timestamp: '2026-08-21T10:00:03Z',
                    source: 'codex',
                    model: 'gpt-5.6-sol',
                    correlationExactness: null,
                    totalDurationMs: 0,
                    totalTokens: 0,
                    operationCount: 1,
                    events: [
                        {
                            ...event,
                            seq: 0,
                            eventType: 'message',
                            kind: 'unknown',
                            title: 'unknown turn',
                            toolName: null,
                        },
                    ],
                },
                {
                    key: 'codex:::sess:::4',
                    sessionId: 'sess',
                    turnIndex: 4,
                    timestamp: '2026-08-21T10:00:04Z',
                    source: 'unknown',
                    model: 'unknown',
                    correlationExactness: null,
                    totalDurationMs: 1,
                    totalTokens: 0,
                    operationCount: 1,
                    events: [
                        {
                            ...event,
                            seq: 0,
                            eventType: 'tool',
                            kind: 'read',
                            title: 'unknown agent tool',
                            toolName: 'Read',
                            durationMs: 1,
                            durationSource: 'measured',
                            agent: 'unknown',
                        },
                    ],
                },
                {
                    key: 'codex:::sess:::5',
                    sessionId: 'sess',
                    turnIndex: 5,
                    timestamp: '2026-08-21T10:00:05Z',
                    source: 'codex',
                    model: 'gpt-5.6-sol',
                    correlationExactness: null,
                    totalDurationMs: 0,
                    totalTokens: 0,
                    operationCount: 1,
                    events: [
                        {
                            ...event,
                            seq: 0,
                            eventType: 'tool',
                            kind: 'read',
                            title: 'empty tool event',
                            toolName: 'Read',
                        },
                    ],
                },
                {
                    key: 'codex:::sess:::6',
                    sessionId: 'sess',
                    turnIndex: 6,
                    timestamp: '2026-08-21T10:00:06Z',
                    source: 'codex',
                    model: 'gpt-5.6-sol',
                    correlationExactness: null,
                    totalDurationMs: 0,
                    totalTokens: 10,
                    operationCount: 1,
                    events: [
                        {
                            ...event,
                            seq: 0,
                            eventType: 'tool',
                            kind: 'read',
                            title: 'cache-only tool event',
                            toolName: 'Read',
                            cacheReadTokens: 10,
                        },
                    ],
                },
            ],
        };

        const view = render(<TimelineTab data={filterTimeline} />);
        // By default, assistant, unknown, and empty events are already filtered out
        expect(view.queryByTestId('timeline-op-event-codex:::sess:::0-0')).toBeNull();
        expect(view.queryByTestId('timeline-op-event-codex:::sess:::1-0')).toBeNull();
        expect(view.getByTestId('timeline-op-event-codex:::sess:::2-0')).toBeDefined();
        expect(view.queryByTestId('timeline-op-event-codex:::sess:::3-0')).toBeNull();
        expect(view.queryByTestId('timeline-op-event-codex:::sess:::4-0')).toBeNull();
        expect(view.queryByTestId('timeline-op-event-codex:::sess:::5-0')).toBeNull();
        expect(view.getByTestId('timeline-op-event-codex:::sess:::6-0')).toBeDefined();
        expect(view.getByTestId('timeline-rail').children).toHaveLength(2);

        // Unchecking hideAssistant reveals assistant events
        fireEvent.click(view.getByTestId('timeline-filter-assistant'));
        expect(view.getByTestId('timeline-op-event-codex:::sess:::0-0')).toBeDefined();
        expect(view.getByTestId('timeline-op-event-codex:::sess:::1-0')).toBeDefined();

        // Unchecking hideUnknown reveals unknown events
        fireEvent.click(view.getByTestId('timeline-filter-unknown'));
        expect(view.getByTestId('timeline-op-event-codex:::sess:::3-0')).toBeDefined();
        expect(view.getByTestId('timeline-op-event-codex:::sess:::4-0')).toBeDefined();

        // Unchecking hideEmpty reveals empty tool events
        fireEvent.click(view.getByTestId('timeline-filter-empty'));
        expect(view.getByTestId('timeline-op-event-codex:::sess:::5-0')).toBeDefined();
    });

    test('Timeline recognizes glob, grep, edit in titles and displays as-is lowercase tool tags', () => {
        const enrichedTimeline: HistoryTimelineResponse['data'] = {
            ...timeline,
            blocks: [
                {
                    key: 'codex:::sess:::0',
                    sessionId: 'sess',
                    turnIndex: 0,
                    timestamp: '2026-08-21T10:00:00Z',
                    source: 'codex',
                    model: 'gpt-5.6-sol',
                    correlationExactness: null,
                    totalDurationMs: 5000,
                    totalTokens: 20000,
                    operationCount: 4,
                    events: [
                        {
                            seq: 0,
                            eventType: 'tool',
                            kind: 'bash',
                            title: 'glob files in src',
                            toolName: 'glob',
                            durationMs: 500,
                            durationSource: 'measured',
                            tokens: 2000,
                            freshInputTokens: 1500,
                            cacheReadTokens: 500,
                            outputTokens: 0,
                            promptTokens: null,
                            exitCode: 0,
                            payload: 'src/**/*.ts',
                            agent: 'codex',
                            model: 'gpt-5.6-sol',
                        },
                        {
                            seq: 1,
                            eventType: 'tool',
                            kind: 'search',
                            title: 'ripgrep pattern in tests',
                            toolName: 'grep',
                            durationMs: 800,
                            durationSource: 'measured',
                            tokens: 4000,
                            freshInputTokens: 3000,
                            cacheReadTokens: 1000,
                            outputTokens: 0,
                            promptTokens: null,
                            exitCode: null,
                            payload: null,
                            agent: 'codex',
                            model: 'gpt-5.6-sol',
                        },
                        {
                            seq: 2,
                            eventType: 'tool',
                            kind: 'write',
                            title: 'edit file content at line 10',
                            toolName: 'edit',
                            durationMs: 1200,
                            durationSource: 'measured',
                            tokens: 6000,
                            freshInputTokens: 4000,
                            cacheReadTokens: 1000,
                            outputTokens: 1000,
                            promptTokens: null,
                            exitCode: 1,
                            payload: 'line edit diff',
                            agent: 'codex',
                            model: 'gpt-5.6-sol',
                        },
                        {
                            seq: 3,
                            eventType: 'tool',
                            kind: 'run',
                            title: 'run build command',
                            toolName: 'run',
                            durationMs: 2500,
                            durationSource: 'measured',
                            tokens: 8000,
                            freshInputTokens: 6000,
                            cacheReadTokens: 1000,
                            outputTokens: 1000,
                            promptTokens: null,
                            exitCode: 0,
                            payload: 'build output',
                            agent: 'codex',
                            model: 'gpt-5.6-sol',
                        },
                    ],
                },
            ],
        };

        const view = render(<TimelineTab data={enrichedTimeline} />);

        // As-is lowercase tool tags
        expect(view.getAllByText('glob').length).toBeGreaterThanOrEqual(1);
        expect(view.getAllByText('grep').length).toBeGreaterThanOrEqual(1);
        expect(view.getAllByText('edit').length).toBeGreaterThanOrEqual(1);
        expect(view.getAllByText('run').length).toBeGreaterThanOrEqual(1);

        // Global expansion targets only the three non-empty operation payloads.
        fireEvent.click(view.getByRole('button', { name: 'Expand all' }));
        expect(view.container.querySelectorAll('button[aria-expanded="true"]')).toHaveLength(3);
        expect(view.container.querySelectorAll('button[aria-expanded]')).toHaveLength(3);

        // Exit codes
        expect(view.getAllByText('EXIT_CODE=0')).toHaveLength(2);
        expect(view.getByText('EXIT_CODE=1')).toBeDefined();

        // Empty payload (seq 1) does not have disclosure button
        const grepBadge = view.getByTestId('timeline-tool-badge-tool-tt-codex---sess---0-1');
        expect(grepBadge.closest('.bg-base-100')?.querySelector('button[aria-expanded]')).toBeNull();
    });

    test('Summary KPI cards show no-baseline deltas and the chart/table toggle swaps bucket views', () => {
        const view = render(<SummaryTab data={summary} />);

        // previousKpis null + empty kpiTrend → every card degrades to the baseline hint.
        expect(view.getAllByText('No prior baseline').length).toBeGreaterThanOrEqual(4);

        // Default is chart mode; table appears only after the toggle.
        expect(view.queryByTestId('summary-bucket-table')).toBeNull();
        fireEvent.click(view.getByRole('button', { name: 'All Tables' }));
        expect(view.getAllByTestId('summary-bucket-table').length).toBeGreaterThanOrEqual(1);
        expect(view.getAllByText('Bucket').length).toBeGreaterThanOrEqual(1);
        fireEvent.click(view.getByRole('button', { name: 'All Charts' }));
        expect(view.queryByTestId('summary-bucket-table')).toBeNull();
    });

    test('Summary renders measured KPI notes, prior-window deltas, skill tokens, and distinct sub-day buckets', () => {
        const richSummary: HistorySummaryResponse['data'] = {
            ...summary,
            previousKpis: {
                totalBilledTokens: 75,
                cacheSavedTokens: 100,
                cacheSavedPercent: 50,
                sessionsCount: 1,
                toolCallsCount: 1,
                errorRate: 0,
            },
            kpiTrend,
            timeSeries: [
                { bucketStart: '2026-08-21T10:00:00Z', cacheHitRatio: 50, series: { Read: 100 } },
                { bucketStart: '2026-08-21T10:05:00Z', cacheHitRatio: 60, series: { Read: 50 } },
            ],
            skillTimeSeries: [
                { bucketStart: '2026-08-21T10:00:00Z', cacheHitRatio: 50, series: { 'sp-dev-verify': 150 } },
            ],
        };
        const view = render(
            <SummaryTab data={richSummary} loopSummary={{ count: 1, redundantCalls: 3, wastedTokens: 9000 }} />,
        );

        expect(view.getByText('Fresh 100 · Output 50')).toBeDefined();
        expect(view.getAllByText(/vs previous period/).length).toBeGreaterThanOrEqual(4);
        expect(view.getByText('150 tokens')).toBeDefined();
        expect(view.getByText('3 redundant')).toBeDefined();
        expect(view.getByText('9.0K wasted')).toBeDefined();

        fireEvent.click(view.getByRole('button', { name: 'All Tables' }));
        expect(view.getAllByText('2026-08-21 10:00').length).toBeGreaterThanOrEqual(1);
        expect(view.getAllByText('2026-08-21 10:05').length).toBeGreaterThanOrEqual(1);

        // Cache Efficiency header (By Agent) and by-source breakdown
        expect(view.getByText('Cache Efficiency By Agent')).toBeDefined();
        expect(view.queryByText('Cache Efficiency Overview')).toBeNull();
        expect(view.queryByText('Global Cache Hit Ratio')).toBeNull();
        expect(view.getAllByText('Codex').length).toBeGreaterThanOrEqual(1);
    });

    test('Summary renders cache efficiency by model and the agent × model correlation matrix', () => {
        const matrixSummary: HistorySummaryResponse['data'] = {
            ...summary,
            cacheEfficiency: {
                hitRatio: 80,
                savedTokens: 200,
                totalRead: 250,
                bySource: [
                    {
                        source: 'codex',
                        sourceName: 'Codex',
                        color: '#d95926',
                        hitRatio: 80,
                        savedTokens: 200,
                        freshTokens: 50,
                        totalRead: 250,
                        billedTokens: 150,
                    },
                ],
                byModel: [
                    {
                        model: 'gpt-5.6-sol',
                        modelName: 'gpt-5.6-sol',
                        color: '#9085e9',
                        hitRatio: 80,
                        savedTokens: 200,
                        freshTokens: 50,
                        totalRead: 250,
                        billedTokens: 150,
                    },
                ],
                byAgentModel: [
                    {
                        source: 'codex',
                        sourceName: 'Codex',
                        model: 'gpt-5.6-sol',
                        modelName: 'gpt-5.6-sol',
                        color: '#d95926',
                        hitRatio: 80,
                        savedTokens: 200,
                        totalRead: 250,
                        billedTokens: 150,
                    },
                ],
            },
        };
        const view = render(<SummaryTab data={matrixSummary} />);

        expect(view.getByText('Cache Efficiency By Model')).toBeDefined();
        expect(view.getByText('Agent × Model Correlation Matrix')).toBeDefined();
        // Model column header + by-model bar label both name the model.
        expect(view.getAllByText('gpt-5.6-sol').length).toBeGreaterThanOrEqual(2);
        // By-agent, by-model bars and the (codex × gpt-5.6-sol) matrix cell all show 80%.
        expect(view.getAllByText('80%').length).toBeGreaterThanOrEqual(3);
    });

    test('Summary renders Token by Model / Token by Agent Source with fresh-cached-output breakdown and universal scale', () => {
        const asymmetricSummary: HistorySummaryResponse['data'] = {
            ...summary,
            topModels: [
                {
                    id: 'model-small',
                    label: 'model-small',
                    color: '#3987e5',
                    tokens: 50,
                    share: 25,
                    freshInputTokens: 50,
                    cacheReadTokens: 0,
                    outputTokens: 0,
                },
            ],
            topSources: [
                {
                    id: 'source-large',
                    label: 'source-large',
                    color: '#d95926',
                    tokens: 100,
                    share: 75,
                    freshInputTokens: 100,
                    cacheReadTokens: 100,
                    outputTokens: 0,
                },
            ],
        };
        const view = render(<SummaryTab data={asymmetricSummary} />);

        expect(view.getByText('Token by Model')).toBeDefined();
        expect(view.getByText('Token by Agent Source')).toBeDefined();
        // Model has 50 billed tokens out of universal max (100) -> width: 50%
        // Source fresh has 100 billed tokens out of universal max (100) -> width: 100%
        const html = view.container.innerHTML;
        expect(html).toContain('width: 50%;');
        expect(html).toContain('width: 100%;');
    });

    test('Summary bucket fieldset exposes a legend and relays interval selection', () => {
        let chosen = '';
        const view = render(<SummaryTab data={summary} onBucketChange={(b) => (chosen = b)} />);

        expect(view.getByText('Bucket interval')).toBeDefined();
        fireEvent.click(view.getByRole('button', { name: '1m' }));
        expect(chosen).toBe('1m');
        fireEvent.click(view.getByRole('button', { name: '3m' }));
        expect(chosen).toBe('3m');
        fireEvent.click(view.getByRole('button', { name: '5m' }));
        expect(chosen).toBe('5m');
    });

    test('Sources overview renders the never-imported chip when no import has run', () => {
        const view = render(<SourcesTab data={sources} />);
        expect(view.getByText(/never imported/)).toBeDefined();
    });

    test('Insights radar inverts speed so the faster model plots nearer full-scale, and cache-hit trend needs data', () => {
        const view = render(<InsightsTab data={insights} cacheHitTrend={kpiTrend} />);

        expect(view.getByTestId('cache-hit-trend-chart')).toBeDefined();

        // Series render in modelComparison order; first circle of each series sits on the
        // Speed axis (axis 0, top of radar). Higher speed score → smaller cy (closer to rim).
        const dots = view.container.querySelectorAll('svg[aria-label="Radar chart"] circle[r="3.5"]');
        expect(dots.length).toBe(8);
        const fastCy = Number(dots[0]?.getAttribute('cy'));
        const slowCy = Number(dots[4]?.getAttribute('cy'));
        expect(Number.isFinite(fastCy)).toBe(true);
        expect(fastCy).toBeLessThan(slowCy);
        for (const dot of dots) {
            expect(Number(dot.getAttribute('cx'))).toBeGreaterThanOrEqual(0);
            expect(Number(dot.getAttribute('cx'))).toBeLessThanOrEqual(520);
            expect(Number(dot.getAttribute('cy'))).toBeGreaterThanOrEqual(0);
            expect(Number(dot.getAttribute('cy'))).toBeLessThanOrEqual(280);
        }

        view.rerender(<InsightsTab data={insights} />);
        expect(view.queryByTestId('cache-hit-trend-chart')).toBeNull();

        // Model Comparison table renders Mean Speed (ms) header without ms in body cells
        expect(view.getByText(/Mean Speed \(ms\)/)).toBeDefined();
        expect(view.getByText('1,000')).toBeDefined(); // Formatted speed without 'ms'
        expect(view.getByText('4,000')).toBeDefined();

        // Sorting by speed toggles order
        fireEvent.click(view.getByText(/Mean Speed \(ms\)/));
        const cells = view.container.querySelectorAll('tbody tr td:nth-child(2)');
        expect(cells[0]?.textContent).toBe('4,000'); // desc default for numeric
    });

    test('InsightsTab renders loop findings with repeated tool invocation tags and interactive tooltips', () => {
        let selectedSession: string | undefined;
        const insightsWithLoops: HistoryInsightsResponse['data'] = {
            ...insights,
            loops: [
                {
                    tool: 'grep_search',
                    argsHint: 'query:find_user',
                    sessionId: 'sess-loop-001',
                    repeats: 4,
                    fromSeq: 10,
                    toSeq: 13,
                    wastedTokens: 1000,
                    repeatedCalls: [
                        {
                            seq: 10,
                            toolSeq: 10,
                            ts: '2026-09-01T12:00:00.000Z',
                            toolName: 'grep_search',
                            category: 'search',
                            status: 'ok',
                            durationMs: 45,
                            durationSource: 'measured',
                            resultBytes: 120,
                            argsRaw: JSON.stringify({ Query: 'find_user' }),
                            argsDigest: 'query:find_user',
                            errorText: null,
                            callId: 'call-10',
                            messageHash: 'msg-10',
                            sessionId: 'sess-loop-001',
                            source: 'claude',
                            model: 'claude-sonnet',
                            tokens: {
                                billedTokens: 250,
                                freshInputTokens: 200,
                                cacheReadTokens: 0,
                                outputTokens: 50,
                                cacheSavedTokens: 0,
                            },
                        },
                        {
                            seq: 11,
                            toolSeq: 11,
                            ts: '2026-09-01T12:00:05.000Z',
                            toolName: 'grep_search',
                            category: 'search',
                            status: 'error',
                            durationMs: 50,
                            durationSource: 'measured',
                            resultBytes: null,
                            argsRaw: JSON.stringify({ Query: 'find_user' }),
                            argsDigest: 'query:find_user',
                            errorText: 'Pattern syntax error',
                            callId: 'call-11',
                            messageHash: 'msg-11',
                            sessionId: 'sess-loop-001',
                            source: 'claude',
                            model: 'claude-sonnet',
                            tokens: {
                                billedTokens: 250,
                                freshInputTokens: 200,
                                cacheReadTokens: 0,
                                outputTokens: 50,
                                cacheSavedTokens: 0,
                            },
                        },
                    ],
                },
            ],
        };

        const view = render(<InsightsTab data={insightsWithLoops} onSelectSession={(id) => (selectedSession = id)} />);

        expect(view.getByText('Detected Execution Loops (Repeats ≥ 3)')).toBeDefined();
        expect(view.getByText('grep_search × 4 repeats')).toBeDefined();

        // Clicking session ID triggers onSelectSession
        const sessionBtn = view.getByText('sess-loop-001 →');
        fireEvent.click(sessionBtn);
        expect(selectedSession).toBe('sess-loop-001');

        // Repeated invocation tags are rendered
        const tag10 = view.getByTestId('tool-tag-10');
        expect(tag10).toBeDefined();
        expect(tag10.textContent).toBe('#10');

        // Clicking tag opens tooltip
        fireEvent.click(tag10);
        expect(view.getByTestId('tool-tooltip-10')).toBeDefined();
        expect(view.getAllByText('sess-loop-001').length).toBeGreaterThanOrEqual(1);

        // Close tooltip with Escape
        fireEvent.keyDown(tag10, { key: 'Escape' });
    });

    test('Heatmap calendar carries weekday chrome and a screen-reader token digest', () => {
        const view = render(
            <HeatmapGrid days={[{ date: '2026-08-21', tokens: 1200, sessions: 3 }]} maxDailyTokens={1200} />,
        );

        expect(view.getByTestId('heatmap-calendar')).toBeDefined();
        expect(view.getByText('Mon')).toBeDefined();
        expect(view.getByText('Wed')).toBeDefined();
        expect(view.getByText('Fri')).toBeDefined();
        expect(view.getByText('Less')).toBeDefined();
        expect(view.getByText('More')).toBeDefined();
        expect(view.getByText('2026-08-21: 1.2K tokens, 3 sessions')).toBeDefined();

        const start = Date.UTC(2026, 4, 24);
        const days = Array.from({ length: 180 }, (_, index) => ({
            date: new Date(start + index * 86_400_000).toISOString().slice(0, 10),
            tokens: index,
            sessions: 1,
        }));
        view.rerender(<HeatmapGrid days={days} maxDailyTokens={179} />);
        expect(view.getAllByTestId('heatmap-week')).toHaveLength(26);
    });

    test('Sessions table truncates long IDs behind a full-ID title and surfaces loading/error states', () => {
        let selected: { source: string; id: string } | undefined;
        const view = render(
            <SessionsTab data={sessions} onSelectSession={(source, id) => (selected = { source, id })} />,
        );

        const longId = view.container.querySelector('td span[title="abcdefghijklmnopqrst"]');
        expect(longId?.textContent).toBe('abcdefghijklmnop…');
        expect(view.container.querySelector('span[title="short-id"]')?.textContent).toBe('short-id');
        fireEvent.click(view.container.querySelector('tbody tr') as Element);
        expect(selected).toEqual({ source: 'codex', id: 'abcdefghijklmnopqrst' });

        const busy = render(<SessionsTab loading />);
        expect(busy.container.querySelector('.animate-spin')).not.toBeNull();
        const failed = render(<SessionsTab error="network down" />);
        expect(failed.getByText('Failed to load sessions: network down')).toBeDefined();
    });

    test('Timeline prev/next are disabled at roster bounds and options include formatted token load', () => {
        let selectedId = '';
        const firstId = '1234567890abcdef';
        const roster = [
            { id: firstId, source: 'agy', model: 'gemini-3-pro', start: '2026-08-21T10:00:00Z', tokenLoad: 61000 },
            { id: 'session-2', source: 'codex', model: 'gpt-5.6-sol', start: '2026-08-21T09:00:00Z', tokenLoad: 30000 },
            { id: 'session-3', source: 'claude', model: 'sonnet-4', start: '2026-08-21T08:00:00Z', tokenLoad: 15000 },
        ];

        // Active session is first in roster: Previous disabled, Next enabled
        const view = render(
            <TimelineTab
                data={{ ...timeline, scope: { ...timeline.scope, source: 'agy', sessionId: firstId } }}
                availableSessions={roster}
                onSelectSession={(_source, id) => (selectedId = id)}
            />,
        );

        const prevBtn = view.getByRole('button', { name: 'Previous session' });
        const nextBtn = view.getByRole('button', { name: 'Next session' });

        expect(prevBtn.getAttribute('disabled')).not.toBeNull();
        expect(nextBtn.getAttribute('disabled')).toBeNull();

        fireEvent.click(nextBtn);
        expect(selectedId).toBe('session-2');

        // Select options are formatted: <shortId> · <source> · <UTC month/day time> · <formatted token load>
        const select = view.getByTestId('timeline-session-select');
        const options = Array.from(select.querySelectorAll('option')).map((o) => o.textContent);
        expect(options[0]).toBe('12345678…cdef · agy · Aug 21 10:00 · 61.0K');
        expect(options[1]).toBe('session-2 · codex · Aug 21 09:00 · 30.0K');
        expect(options[2]).toBe('session-3 · claude · Aug 21 08:00 · 15.0K');
        expect(view.getByTestId('timeline-metadata-strip').querySelector(`[title="${firstId}"]`)?.textContent).toBe(
            '12345678…cdef',
        );

        // Middle session: both buttons enabled
        view.rerender(
            <TimelineTab
                data={{ ...timeline, scope: { ...timeline.scope, source: 'codex', sessionId: 'session-2' } }}
                availableSessions={roster}
                onSelectSession={(_source, id) => (selectedId = id)}
            />,
        );
        expect(view.getByRole('button', { name: 'Previous session' }).getAttribute('disabled')).toBeNull();
        expect(view.getByRole('button', { name: 'Next session' }).getAttribute('disabled')).toBeNull();

        // Last session: Previous enabled, Next disabled
        view.rerender(
            <TimelineTab
                data={{ ...timeline, scope: { ...timeline.scope, source: 'claude', sessionId: 'session-3' } }}
                availableSessions={roster}
                onSelectSession={(_source, id) => (selectedId = id)}
            />,
        );
        expect(view.getByRole('button', { name: 'Previous session' }).getAttribute('disabled')).toBeNull();
        expect(view.getByRole('button', { name: 'Next session' }).getAttribute('disabled')).not.toBeNull();

        // Absent session: both disabled
        view.rerender(
            <TimelineTab
                data={{ ...timeline, scope: { ...timeline.scope, source: 'agy', sessionId: 'session-unknown' } }}
                availableSessions={roster}
                onSelectSession={(_source, id) => (selectedId = id)}
            />,
        );
        expect(view.getByRole('button', { name: 'Previous session' }).getAttribute('disabled')).not.toBeNull();
        expect(view.getByRole('button', { name: 'Next session' }).getAttribute('disabled')).not.toBeNull();
    });

    test('Timeline session selection distinguishes equal ids from different sources', () => {
        const roster = [
            { id: 'shared', source: 'agy', model: 'gemini-3-pro', start: '2026-08-21T10:00:00Z', tokenLoad: 10 },
            { id: 'shared', source: 'codex', model: 'gpt-5.6-sol', start: '2026-08-21T11:00:00Z', tokenLoad: 20 },
        ];
        let selected: { source: string; id: string } | undefined;
        const view = render(
            <TimelineTab
                data={{ ...timeline, scope: { ...timeline.scope, source: 'codex', sessionId: 'shared' } }}
                availableSessions={roster}
                onSelectSession={(source, id) => (selected = { source, id })}
            />,
        );

        expect(view.getByRole('button', { name: 'Previous session' }).getAttribute('disabled')).toBeNull();
        expect(view.getByRole('button', { name: 'Next session' }).getAttribute('disabled')).not.toBeNull();
        fireEvent.change(view.getByTestId('timeline-session-select'), {
            target: { value: JSON.stringify(['agy', 'shared']) },
        });
        expect(selected).toEqual({ source: 'agy', id: 'shared' });
    });
});
