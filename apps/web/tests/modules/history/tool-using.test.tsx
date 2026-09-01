import { registerHappyDom, teardownHappyDom } from '../../happy-dom';

registerHappyDom();

import { afterAll, afterEach, describe, expect, test } from 'bun:test';
import type { HistoryToolSequenceResponse } from '@gobing-ai/spur-contracts';
import { cleanup, fireEvent, render } from '@testing-library/react';
import ToolUsingTab, { formatToolDisplayValue } from '../../../src/modules/history/ToolUsingTab';

afterEach(cleanup);
afterAll(teardownHappyDom);

const toolSequenceSample: HistoryToolSequenceResponse['data'] = {
    mode: 'session',
    scope: {
        sessionId: 'sess-abc-123',
        source: 'claude',
        model: 'claude-opus-4.6',
        start: '2026-08-31T01:00:00.000Z',
        end: '2026-08-31T01:05:00.000Z',
        totalCalls: 3,
        uniqueTools: 3,
        errorCount: 1,
        errorRate: 0.333,
        totalDurationMs: 450,
        meanDurationMs: 225,
        durationUnmeasured: 1,
        sessionCount: 1,
        tokens: {
            billedTokens: 1200,
            cacheSavedTokens: 800,
            cacheReadTokens: 800,
            freshInputTokens: 400,
            outputTokens: 200,
        },
    },
    truncated: false,
    items: [
        {
            seq: 1,
            toolSeq: 1,
            ts: '2026-08-31T01:00:00.000Z',
            toolName: 'view_file',
            category: 'read',
            status: 'ok',
            durationMs: 150,
            durationSource: 'measured',
            resultBytes: 1024,
            argsRaw: '{"path":"src/index.ts"}',
            argsDigest: 'src/index.ts',
            errorText: null,
            callId: 'call-1',
            messageHash: 'hash-msg-1',
            sessionId: 'sess-abc-123',
            source: 'claude',
            model: 'claude-opus-4.6',
            tokens: {
                billedTokens: 400,
                cacheSavedTokens: 200,
                cacheReadTokens: 200,
                freshInputTokens: 200,
                outputTokens: 100,
            },
        },
        {
            seq: 2,
            toolSeq: 2,
            ts: '2026-08-31T01:01:00.000Z',
            toolName: 'run_command',
            category: 'bash',
            status: 'error',
            durationMs: null,
            durationSource: 'unmeasured',
            resultBytes: 256,
            argsRaw: '{"cmd":"bun test"}',
            argsDigest: 'bun test',
            errorText: 'Process failed with exit code 1: TypeError: boom',
            callId: 'call-2',
            messageHash: 'hash-msg-2',
            sessionId: 'sess-abc-123',
            source: 'claude',
            model: 'claude-opus-4.6',
            tokens: {
                billedTokens: 400,
                cacheSavedTokens: 300,
                cacheReadTokens: 300,
                freshInputTokens: 100,
                outputTokens: 50,
            },
        },
        {
            seq: 3,
            toolSeq: 3,
            ts: '2026-08-31T01:02:00.000Z',
            toolName: 'mcp__context__search',
            category: 'mcp',
            status: 'ok',
            durationMs: 300,
            durationSource: 'measured',
            resultBytes: 4096,
            argsRaw: 'not valid json string',
            argsDigest: 'search term',
            errorText: null,
            callId: 'call-3',
            messageHash: 'hash-msg-3',
            sessionId: 'sess-abc-123',
            source: 'claude',
            model: 'claude-opus-4.6',
            tokens: {
                billedTokens: 400,
                cacheSavedTokens: 300,
                cacheReadTokens: 300,
                freshInputTokens: 100,
                outputTokens: 50,
            },
        },
    ],
};

function setInputValue(el: Element, value: string): void {
    const holder = el as unknown as Record<string, Record<string, unknown> | undefined>;
    const key = Object.keys(holder).find((k) => k.startsWith('__reactProps$'));
    const props = key ? holder[key] : undefined;
    const onChange = props?.onChange as ((e: { target: { value: string } }) => void) | undefined;
    if (onChange) {
        onChange({ target: { value } });
    }
}

describe('ToolUsingTab component', () => {
    test('renders top summary metrics strip from data.scope', () => {
        const { getByTestId, getByText } = render(
            <ToolUsingTab
                data={toolSequenceSample}
                loading={false}
                error={null}
                mode="session"
                onModeChange={() => {}}
                sessionId="sess-abc-123"
                sessionSource="claude"
                availableSessions={[]}
                onSelectSession={() => {}}
                toolNames={[]}
                onToolNamesChange={() => {}}
                status="all"
                onStatusChange={() => {}}
                search=""
                onSearchChange={() => {}}
            />,
        );

        expect(getByTestId('tool-scope-calls').textContent).toBe('3');
        expect(getByTestId('tool-scope-unique').textContent).toBe('3');
        expect(getByTestId('tool-scope-errors').textContent).toContain('1 (33%)');
        expect(getByTestId('tool-scope-duration').textContent).toBe('225 ms');
        expect(getByText('(1 unmeasured)')).toBeDefined();
        expect(getByTestId('tool-scope-tokens').textContent).toBe('1,200');
    });

    test('renders sequence stream items with category badges, status, and NULL duration formatting', () => {
        const { getByTestId } = render(
            <ToolUsingTab
                data={toolSequenceSample}
                loading={false}
                error={null}
                mode="session"
                onModeChange={() => {}}
                sessionId="sess-abc-123"
                sessionSource="claude"
                availableSessions={[]}
                onSelectSession={() => {}}
                toolNames={[]}
                onToolNamesChange={() => {}}
                status="all"
                onStatusChange={() => {}}
                search=""
                onSearchChange={() => {}}
            />,
        );

        // Tool 1: view_file (read, ok, 150 ms, formatted readable file path on bar)
        const item1 = getByTestId('tool-item-1');
        expect(item1.textContent).toContain('view_file');
        expect(item1.textContent).toContain('src/index.ts');
        expect(item1.textContent).toContain('150 ms');
        expect(item1.textContent).toContain('ok');

        // Tool 2: run_command (bash, error, NULL duration -> '—', formatted command on bar)
        const item2 = getByTestId('tool-item-2');
        expect(item2.textContent).toContain('run_command');
        expect(item2.textContent).toContain('bun test');
        expect(item2.textContent).toContain('—');
        expect(item2.textContent).toContain('error');

        // Tool 3: mcp__context__search (mcp, ok, 300 ms)
        const item3 = getByTestId('tool-item-3');
        expect(item3.textContent).toContain('mcp__context__search');
        expect(item3.textContent).toContain('not valid json string');
        expect(item3.textContent).toContain('300 ms');
    });

    test('hovering or clicking a tool tag opens double-width inspection tooltip with formatted args, error trace, and metadata without duplicate tool name', () => {
        const { getByTestId } = render(
            <ToolUsingTab
                data={toolSequenceSample}
                loading={false}
                error={null}
                mode="session"
                onModeChange={() => {}}
                sessionId="sess-abc-123"
                sessionSource="claude"
                availableSessions={[]}
                onSelectSession={() => {}}
                toolNames={[]}
                onToolNamesChange={() => {}}
                status="all"
                onStatusChange={() => {}}
                search=""
                onSearchChange={() => {}}
            />,
        );

        // Click on error tool tag #2
        const tag2 = getByTestId('tool-tag-2');
        fireEvent.click(tag2);

        const tooltip = getByTestId('tool-tooltip-2');
        expect(tooltip).toBeDefined();
        // Double-width tooltip class check
        expect(tooltip.className).toContain('w-[880px]');
        expect(tooltip.textContent).toContain('run_command');
        expect(tooltip.textContent?.toLowerCase()).toContain('bash');
        expect(tooltip.textContent).toContain('Execution Error:');
        expect(tooltip.textContent).toContain('Process failed with exit code 1: TypeError: boom');
        expect(tooltip.textContent).toContain('"cmd"');
        expect(tooltip.textContent).toContain('bun test');
        expect(tooltip.textContent).toContain('call-2');
        expect(tooltip.textContent).toContain('sess-abc-123');
    });

    test('filter controls trigger callbacks on status, tool name, and search changes', () => {
        let selectedStatus = 'all';
        let searchKeyword = '';
        let selectedTools: string[] = [];

        const { getByText, getByPlaceholderText, getByTestId } = render(
            <ToolUsingTab
                data={toolSequenceSample}
                loading={false}
                error={null}
                mode="session"
                onModeChange={() => {}}
                sessionId="sess-abc-123"
                sessionSource="claude"
                availableSessions={[]}
                onSelectSession={() => {}}
                toolNames={selectedTools}
                onToolNamesChange={(names) => {
                    selectedTools = names;
                }}
                status="all"
                onStatusChange={(st) => {
                    selectedStatus = st;
                }}
                search={searchKeyword}
                onSearchChange={(kw) => {
                    searchKeyword = kw;
                }}
            />,
        );

        // Click on "ERROR" status toggle
        const errorBtn = getByText('ERROR');
        fireEvent.click(errorBtn);
        expect(selectedStatus).toBe('error');

        // Search input change
        const searchInput = getByPlaceholderText('Search tool arguments, digest, or error text...') as HTMLInputElement;
        setInputValue(searchInput, 'TypeError');
        expect(searchKeyword).toBe('TypeError');

        // Toggle tool name pill
        const viewFilePill = getByTestId('tool-filter-view_file');
        fireEvent.click(viewFilePill);
        expect(selectedTools).toEqual(['view_file']);
    });

    test('renders empty state when no items match', () => {
        const { getByText } = render(
            <ToolUsingTab
                data={{
                    mode: 'session',
                    scope: {
                        sessionId: 'sess-empty',
                        source: 'claude',
                        model: null,
                        start: null,
                        end: null,
                        totalCalls: 0,
                        uniqueTools: 0,
                        errorCount: 0,
                        errorRate: 0,
                        totalDurationMs: 0,
                        meanDurationMs: 0,
                        durationUnmeasured: 0,
                        sessionCount: 1,
                        tokens: {
                            billedTokens: 0,
                            cacheSavedTokens: 0,
                            cacheReadTokens: 0,
                            freshInputTokens: 0,
                            outputTokens: 0,
                        },
                    },
                    truncated: false,
                    items: [],
                }}
                loading={false}
                error={null}
                mode="session"
                onModeChange={() => {}}
                availableSessions={[]}
                onSelectSession={() => {}}
                toolNames={[]}
                onToolNamesChange={() => {}}
                status="all"
                onStatusChange={() => {}}
                search=""
                onSearchChange={() => {}}
            />,
        );

        expect(getByText('No tool calls found')).toBeDefined();
    });

    test('formatToolDisplayValue formats read paths, subagent prompts, search queries, and hashes cleanly', () => {
        // Read tool with line range
        expect(
            formatToolDisplayValue({
                toolName: 'view_file',
                category: 'read',
                argsRaw: JSON.stringify({
                    AbsolutePath: '/Users/robin/xprojects/spur-new/apps/web/src/modules/history/SummaryTab.tsx',
                    StartLine: 1,
                    EndLine: 100,
                }),
                argsDigest: 'SummaryTab.tsx',
            }),
        ).toBe('apps/web/src/modules/history/SummaryTab.tsx (L1-100)');

        // Subagent invocation
        expect(
            formatToolDisplayValue({
                toolName: 'invoke_subagent',
                category: 'mcp',
                argsRaw: JSON.stringify({
                    Subagents: [
                        {
                            TypeName: 'research',
                            Role: 'Codebase Researcher',
                            Prompt: 'Analyze history module',
                        },
                    ],
                }),
                argsDigest: null,
            }),
        ).toBe('Codebase Researcher — Analyze history module');

        // Subagent send_message
        expect(
            formatToolDisplayValue({
                toolName: 'send_message',
                category: 'mcp',
                argsRaw: JSON.stringify({
                    Recipient: 'subagent-1',
                    Message: 'Run test suite',
                }),
                argsDigest: null,
            }),
        ).toBe('→ subagent-1: Run test suite');

        // Search query with path
        expect(
            formatToolDisplayValue({
                toolName: 'grep_search',
                category: 'search',
                argsRaw: JSON.stringify({
                    Query: 'resolveAutoBucket',
                    SearchPath: 'apps/web',
                }),
                argsDigest: null,
            }),
        ).toBe('"resolveAutoBucket" in apps/web');

        // Skill invocation
        expect(
            formatToolDisplayValue({
                toolName: 'Skill',
                category: 'other',
                argsRaw: JSON.stringify({
                    skill: 'sp:dev-plan',
                    args: '--feature 123',
                }),
                argsDigest: null,
            }),
        ).toBe('sp:dev-plan — --feature 123');

        // Slash command invocation
        expect(
            formatToolDisplayValue({
                toolName: 'SlashCommand',
                category: 'other',
                argsRaw: JSON.stringify({
                    command: '/sp:dev-run',
                    args: '0724',
                }),
                argsDigest: null,
            }),
        ).toBe('/sp:dev-run — 0724');

        // Web URL fetch
        expect(
            formatToolDisplayValue({
                toolName: 'WebFetch',
                category: 'other',
                argsRaw: JSON.stringify({
                    url: 'https://docs.anthropic.com/en/api/overview',
                }),
                argsDigest: null,
            }),
        ).toBe('https://docs.anthropic.com/en/api/overview');

        // 64-char SHA-256 hash in argsRaw or digest
        expect(
            formatToolDisplayValue({
                toolName: 'Read',
                category: 'read',
                argsRaw: '71f931ed8a4a4b7c9ee8e1833c08df0a380e9f9ee7d6b511f7e5c127cbbd7d09',
                argsDigest: null,
            }),
        ).toBe('71f931ed…bd7d09');

        expect(
            formatToolDisplayValue({
                toolName: 'Read',
                category: 'read',
                argsRaw: null,
                argsDigest: '71f931ed8a4a4b7c9ee8e1833c08df0a380e9f9ee7d6b511f7e5c127cbbd7d09',
            }),
        ).toBe('digest: 71f931ed…bd7d09');
    });
});
