import type {
    HistoryFilter,
    HistoryInsightsResponse,
    HistorySessionsResponse,
    HistorySourcesResponse,
    HistorySummaryResponse,
    HistoryTimelineResponse,
    HistoryToolSequenceResponse,
    HistoryToolStatusFilter,
} from '@gobing-ai/spur-contracts';
import type React from 'react';
import { useEffect, useMemo, useState } from 'react';
import { api } from '../../lib/rpc-client';
import type { HistoryFilterOption } from './HistoryFilters';
import HistoryFilters from './HistoryFilters';
import InsightsTab from './InsightsTab';
import SessionsTab from './SessionsTab';
import SourcesTab from './SourcesTab';
import SummaryTab from './SummaryTab';
import TimelineTab from './TimelineTab';
import ToolUsingTab from './ToolUsingTab';
import { HISTORY_TABS } from './tabs';

interface TimelineRosterEntry {
    id: string;
    source: string;
    model: string;
    start: string;
    tokenLoad: number;
}

interface SelectedSession {
    source: string;
    id: string;
}

const unionOptions = (
    loaded: HistoryFilterOption[],
    selected: readonly string[] | undefined,
): HistoryFilterOption[] => {
    const map = new Map<string, HistoryFilterOption>();
    for (const option of loaded) map.set(option.id, option);
    for (const id of selected ?? []) {
        if (!map.has(id)) map.set(id, { id, label: id });
    }
    return [...map.values()];
};

const rangeLabelFor = (filter: HistoryFilter): string => {
    if (filter.range === '1h') return 'Last 1h';
    if (filter.range === '4h') return 'Last 4h';
    if (filter.range === '24h') return 'Last 24h';
    if (filter.range === '7d') return 'Last 7d';
    if (filter.range === '30d') return 'Last 30d';
    if (filter.range === 'all') return 'All time';
    return `${filter.from?.slice(0, 10) ?? '…'} → ${filter.to?.slice(0, 10) ?? '…'}`;
};

const errorMessage = (err: unknown): string => (err instanceof Error ? err.message : String(err));

export const HistoryShell: React.FC = () => {
    const [activeTab, setActiveTab] = useState<string>('summary');
    const [filter, setFilter] = useState<HistoryFilter>({
        range: '4h',
        bucket: 'auto',
        dimension: 'model',
    });

    // Timeline mode & selected session
    const [timelineMode, setTimelineMode] = useState<'session' | 'consolidated'>('session');
    const [selectedSession, setSelectedSession] = useState<SelectedSession | null>(null);
    const [timelineCorrelationScope, setTimelineCorrelationScope] = useState({ taskWbs: '', runId: '' });

    // Tool Using tab state
    const [toolMode, setToolMode] = useState<'session' | 'consolidated'>('session');
    const [toolNameFilter, setToolNameFilter] = useState<string[]>([]);
    const [toolStatusFilter, setToolStatusFilter] = useState<HistoryToolStatusFilter>('all');
    const [toolSearch, setToolSearch] = useState<string>('');
    const [toolSearchDebounced, setToolSearchDebounced] = useState<string>('');

    // Sessions tab query state
    const [sessionsPage, setSessionsPage] = useState<number>(1);
    const [sessionsSortBy, setSessionsSortBy] = useState<
        'start' | 'duration' | 'messages' | 'toolCalls' | 'billedTokens' | 'cacheRead' | 'freshInput'
    >('start');
    const [sessionsSortDir, setSessionsSortDir] = useState<'asc' | 'desc'>('desc');

    // Data states
    const [summaryData, setSummaryData] = useState<HistorySummaryResponse['data'] | undefined>(undefined);
    const [timelineData, setTimelineData] = useState<HistoryTimelineResponse['data'] | undefined>(undefined);
    const [toolSequenceData, setToolSequenceData] = useState<HistoryToolSequenceResponse['data'] | undefined>(
        undefined,
    );
    const [sessionsData, setSessionsData] = useState<HistorySessionsResponse['data'] | undefined>(undefined);
    const [insightsData, setInsightsData] = useState<HistoryInsightsResponse['data'] | undefined>(undefined);
    const [sourcesData, setSourcesData] = useState<HistorySourcesResponse['data'] | undefined>(undefined);

    // 100-row start-desc roster powering Timeline / Tool Using Previous/Next traversal.
    const [timelineRoster, setTimelineRoster] = useState<TimelineRosterEntry[]>([]);
    const [rosterLoading, setRosterLoading] = useState<boolean>(false);

    // Per-dataset request states so badges and tabs report honest status.
    const [summaryLoading, setSummaryLoading] = useState<boolean>(true);
    const [summaryError, setSummaryError] = useState<string | null>(null);
    const [insightsLoading, setInsightsLoading] = useState<boolean>(true);
    const [insightsError, setInsightsError] = useState<string | null>(null);
    const [sourcesLoading, setSourcesLoading] = useState<boolean>(true);
    const [sourcesError, setSourcesError] = useState<string | null>(null);
    const [sessionsLoading, setSessionsLoading] = useState<boolean>(false);
    const [sessionsError, setSessionsError] = useState<string | null>(null);
    const [timelineLoading, setTimelineLoading] = useState<boolean>(false);
    const [timelineError, setTimelineError] = useState<string | null>(null);
    const [toolSequenceLoading, setToolSequenceLoading] = useState<boolean>(false);
    const [toolSequenceError, setToolSequenceError] = useState<string | null>(null);

    // Filter-coupled Summary + Insights load (badges/livechip stay available on every tab).
    useEffect(() => {
        let mounted = true;
        setSummaryLoading(true);
        setSummaryError(null);
        setInsightsLoading(true);
        setInsightsError(null);
        (async () => {
            const [summaryRes, insightsRes] = await Promise.allSettled([
                api.history.getSummary(filter),
                api.history.getInsights(filter),
            ]);
            if (!mounted) return;
            if (summaryRes.status === 'fulfilled' && summaryRes.value?.data) {
                setSummaryData(summaryRes.value.data);
            } else {
                setSummaryError(
                    summaryRes.status === 'rejected' ? errorMessage(summaryRes.reason) : 'Failed to load summary',
                );
            }
            if (insightsRes.status === 'fulfilled' && insightsRes.value?.data) {
                setInsightsData(insightsRes.value.data);
            } else {
                setInsightsError(
                    insightsRes.status === 'rejected' ? errorMessage(insightsRes.reason) : 'Failed to load insights',
                );
            }
            setSummaryLoading(false);
            setInsightsLoading(false);
        })();
        return () => {
            mounted = false;
        };
    }, [filter]);

    // One all-time Sources load: registry cards, heatmap data, and the header livechip.
    useEffect(() => {
        let mounted = true;
        setSourcesLoading(true);
        setSourcesError(null);
        (async () => {
            try {
                const res = await api.history.getSources();
                if (!mounted) return;
                if (res?.data) {
                    setSourcesData(res.data);
                } else {
                    setSourcesError('Failed to load sources');
                }
            } catch (err) {
                if (mounted) setSourcesError(errorMessage(err));
            } finally {
                if (mounted) setSourcesLoading(false);
            }
        })();
        return () => {
            mounted = false;
        };
    }, []);

    // Timeline & Tool Using roster: single 100-row start-desc fetch per filter change.
    useEffect(() => {
        if (activeTab !== 'timeline' && activeTab !== 'tool-using') return;
        let mounted = true;
        setRosterLoading(true);
        (async () => {
            try {
                const res = await api.history.getSessions({
                    filter,
                    page: 1,
                    pageSize: 100,
                    sortBy: 'start',
                    sortDir: 'desc',
                });
                if (!mounted) return;
                const items = (res?.data?.items ?? []).map((s) => ({
                    id: s.id,
                    source: s.source,
                    model: s.model,
                    start: s.start,
                    tokenLoad: s.freshInputTokens + s.cacheReadTokens + s.outputTokens,
                }));
                setTimelineRoster(items);
                const firstItem = items[0];
                if (firstItem && !selectedSession) {
                    setSelectedSession({ source: firstItem.source, id: firstItem.id });
                }
            } catch {
                if (mounted) setTimelineRoster([]);
            } finally {
                if (mounted) setRosterLoading(false);
            }
        })();
        return () => {
            mounted = false;
        };
    }, [activeTab, filter, selectedSession]);

    // Sessions tab rows follow pagination/sort state.
    useEffect(() => {
        if (activeTab !== 'sessions') return;
        let mounted = true;
        setSessionsLoading(true);
        setSessionsError(null);
        (async () => {
            try {
                const res = await api.history.getSessions({
                    filter,
                    page: sessionsPage,
                    pageSize: 20,
                    sortBy: sessionsSortBy,
                    sortDir: sessionsSortDir,
                });
                if (!mounted) return;
                if (res?.data) {
                    setSessionsData(res.data);
                } else {
                    setSessionsError('Failed to load sessions');
                }
            } catch (err) {
                if (mounted) setSessionsError(errorMessage(err));
            } finally {
                if (mounted) setSessionsLoading(false);
            }
        })();
        return () => {
            mounted = false;
        };
    }, [activeTab, filter, sessionsPage, sessionsSortBy, sessionsSortDir]);

    // Timeline query follows mode and selected session.
    useEffect(() => {
        if (activeTab !== 'timeline') return;

        if (timelineMode === 'session') {
            if (!selectedSession) {
                const firstRoster = timelineRoster[0];
                if (!rosterLoading && firstRoster) {
                    setSelectedSession({ source: firstRoster.source, id: firstRoster.id });
                }
                return;
            }
        }

        let mounted = true;
        setTimelineLoading(true);
        setTimelineError(null);
        (async () => {
            try {
                const res =
                    timelineMode === 'session' && selectedSession
                        ? await api.history.getTimeline({
                              mode: 'session',
                              source: selectedSession.source,
                              sessionId: selectedSession.id,
                          })
                        : await api.history.getTimeline({
                              mode: 'consolidated',
                              filter,
                              ...(timelineCorrelationScope.taskWbs
                                  ? { taskWbs: timelineCorrelationScope.taskWbs }
                                  : {}),
                              ...(timelineCorrelationScope.runId ? { runId: timelineCorrelationScope.runId } : {}),
                          });
                if (!mounted) return;
                if (res?.data) {
                    setTimelineData(res.data);
                } else {
                    setTimelineError('Failed to load timeline');
                }
            } catch (err) {
                if (mounted) setTimelineError(errorMessage(err));
            } finally {
                if (mounted) setTimelineLoading(false);
            }
        })();
        return () => {
            mounted = false;
        };
    }, [activeTab, timelineMode, selectedSession, filter, rosterLoading, timelineRoster, timelineCorrelationScope]);

    // 250ms search debounce for tool using tab.
    useEffect(() => {
        const timer = setTimeout(() => {
            setToolSearchDebounced(toolSearch);
        }, 250);
        return () => clearTimeout(timer);
    }, [toolSearch]);

    // Tool sequence query follows mode, selected session, and active filters.
    useEffect(() => {
        if (activeTab !== 'tool-using') return;

        if (toolMode === 'session') {
            if (!selectedSession) {
                const firstRoster = timelineRoster[0];
                if (!rosterLoading && firstRoster) {
                    setSelectedSession({ source: firstRoster.source, id: firstRoster.id });
                }
                return;
            }
        }

        let mounted = true;
        setToolSequenceLoading(true);
        setToolSequenceError(null);
        (async () => {
            try {
                const input =
                    toolMode === 'session' && selectedSession
                        ? {
                              mode: 'session' as const,
                              source: selectedSession.source,
                              sessionId: selectedSession.id,
                              toolNames: toolNameFilter.length > 0 ? toolNameFilter : undefined,
                              status: toolStatusFilter,
                              search: toolSearchDebounced || undefined,
                          }
                        : {
                              mode: 'consolidated' as const,
                              filter,
                              toolNames: toolNameFilter.length > 0 ? toolNameFilter : undefined,
                              status: toolStatusFilter,
                              search: toolSearchDebounced || undefined,
                          };
                const res = await api.history.getToolSequence(input);
                if (!mounted) return;
                if (res?.data) {
                    setToolSequenceData(res.data);
                } else {
                    setToolSequenceError('Failed to load tool sequence');
                }
            } catch (err) {
                if (mounted) setToolSequenceError(errorMessage(err));
            } finally {
                if (mounted) setToolSequenceLoading(false);
            }
        })();
        return () => {
            mounted = false;
        };
    }, [
        activeTab,
        toolMode,
        selectedSession,
        filter,
        toolNameFilter,
        toolStatusFilter,
        toolSearchDebounced,
        rosterLoading,
        timelineRoster,
    ]);

    const selectTimelineSession = (source: string, id: string) => {
        setSelectedSession({ source, id });
        setTimelineMode('session');
        setActiveTab('timeline');
    };

    const selectToolSession = (source: string, id: string) => {
        setSelectedSession({ source, id });
        setToolMode('session');
    };

    const handleSelectSessionFromList = (sessionId: string, source?: string) => {
        const found = source
            ? { source, id: sessionId }
            : (sessionsData?.items.find((session) => session.id === sessionId) ??
              timelineRoster.find((session) => session.id === sessionId));
        if (found) selectTimelineSession(found.source, found.id);
    };

    const handleTriggerImport = async (mode: 'full' | 'incremental') => {
        const response = await api.history.triggerImport({ mode });
        return response.data;
    };

    const sessionsBadge = summaryError
        ? '—'
        : summaryLoading || summaryData === undefined
          ? '…'
          : String(summaryData.kpis.sessionsCount);
    const toolUsingBadge = toolSequenceError
        ? '—'
        : toolSequenceLoading || toolSequenceData === undefined
          ? '…'
          : String(toolSequenceData.scope.totalCalls);
    const insightsBadge = insightsError
        ? '—'
        : insightsLoading || insightsData === undefined
          ? '…'
          : String(insightsData.loops.length);
    const sourcesBadge = sourcesError
        ? '—'
        : sourcesLoading || sourcesData === undefined
          ? '…'
          : String(sourcesData.agents.length);
    const badgeFor: Record<string, string | null> = {
        summary: null,
        timeline: null,
        'tool-using': toolUsingBadge,
        sessions: sessionsBadge,
        insights: insightsBadge,
        sources: sourcesBadge,
    };

    const lastImportChip = sourcesError
        ? '—'
        : sourcesLoading
          ? '…'
          : sourcesData?.overview.lastImportedAt
            ? new Date(sourcesData.overview.lastImportedAt).toLocaleString()
            : 'never imported';

    const loopSummary = useMemo(
        () =>
            insightsData
                ? {
                      count: insightsData.loops.length,
                      redundantCalls: insightsData.loops.reduce((acc, loop) => acc + Math.max(0, loop.repeats - 1), 0),
                      wastedTokens: insightsData.loops.reduce((acc, loop) => acc + loop.wastedTokens, 0),
                  }
                : undefined,
        [insightsData],
    );

    // Option catalogs: loaded API values union currently selected IDs, so applying a
    // filter never removes its own checkbox.
    const sourceOptions = useMemo(
        () =>
            unionOptions(
                sourcesData?.agents.map((agent) => ({ id: agent.id, label: agent.name, color: agent.color })) ?? [],
                filter.sources,
            ),
        [sourcesData?.agents, filter.sources],
    );
    const modelOptions = useMemo(
        () =>
            unionOptions(
                summaryData?.topModels.map((m) => ({ id: m.id, label: m.label, color: m.color })) ?? [],
                filter.models,
            ),
        [summaryData?.topModels, filter.models],
    );
    const toolOptions = useMemo(
        () =>
            unionOptions(
                summaryData?.topTools.map((t) => {
                    const id = t.id && t.id.trim() !== '' ? t.id.trim() : 'unknown';
                    return { id, label: id };
                }) ?? [],
                filter.tools?.map((t) => (t && t.trim() !== '' ? t.trim() : 'unknown')),
            ),
        [summaryData?.topTools, filter.tools],
    );
    const skillOptions = useMemo(
        () =>
            unionOptions(
                summaryData?.skillsUsed
                    .filter((s) => s.id && s.id.trim() !== '' && s.id !== 'unknown')
                    .map((s) => ({ id: s.id, label: s.label, color: s.color })) ?? [],
                filter.skills?.filter((s) => s && s.trim() !== '' && s !== 'unknown'),
            ),
        [summaryData?.skillsUsed, filter.skills],
    );

    const scope = useMemo(
        () => ({
            rangeLabel: rangeLabelFor(filter),
            sessionCount: summaryError
                ? null
                : summaryLoading && summaryData === undefined
                  ? undefined
                  : summaryData?.kpis.sessionsCount,
            sourceCount: filter.sources?.length ?? sourcesData?.agents.length,
        }),
        [filter, summaryError, summaryLoading, summaryData, sourcesData?.agents.length],
    );

    return (
        <div className="flex flex-col gap-4 p-4 max-w-[1600px] mx-auto w-full">
            {/* Header & Tab Navigation Bar */}
            <div className="flex flex-wrap items-center justify-between gap-4 border-b border-base-content/10 pb-3">
                <div className="flex items-center gap-3">
                    <span className="text-2xl">📊</span>
                    <div>
                        <h1 className="text-xl font-bold tracking-tight">History</h1>
                        <p className="text-xs text-base-content/60">
                            Transcript telemetry, session traces, and prompt cache analytics
                        </p>
                        <p
                            className="livechip mt-1 inline-flex items-center gap-1.5 rounded-full border border-base-content/10 px-2 py-0.5 text-xs text-base-content/60 font-mono"
                            data-testid="history-last-import"
                            role="status"
                        >
                            <span
                                className={`h-1.5 w-1.5 rounded-full ${
                                    sourcesError ? 'bg-error' : 'bg-emerald-400 animate-pulse'
                                }`}
                                aria-hidden="true"
                            />
                            last import {lastImportChip}
                        </p>
                    </div>
                </div>

                {/* Tab Strip */}
                <div className="flex items-center gap-1 bg-base-300 p-1 rounded-xl">
                    {HISTORY_TABS.map((tab) => (
                        <button
                            key={tab.id}
                            type="button"
                            className={`px-3 py-1.5 text-xs font-semibold rounded-lg transition-all ${
                                activeTab === tab.id
                                    ? 'bg-primary text-primary-content font-bold shadow-sm'
                                    : 'text-base-content/70 hover:bg-base-content/10'
                            }`}
                            onClick={() => setActiveTab(tab.id)}
                        >
                            {tab.label}
                            {badgeFor[tab.id] !== null && (
                                <span
                                    className="ml-1.5 px-1.5 py-0.5 rounded-full text-[10px] font-mono bg-base-content/10"
                                    data-testid={`history-badge-${tab.id}`}
                                >
                                    {badgeFor[tab.id]}
                                </span>
                            )}
                        </button>
                    ))}
                </div>
            </div>

            {/* Global Filter Bar (Hidden on Sources Tab) */}
            {activeTab !== 'sources' && (
                <HistoryFilters
                    filter={filter}
                    onChange={setFilter}
                    sourceOptions={sourceOptions}
                    modelOptions={modelOptions}
                    toolOptions={toolOptions}
                    skillOptions={skillOptions}
                    scope={scope}
                />
            )}

            {/* Tab Views */}
            <div className="mt-2">
                {activeTab === 'summary' && (
                    <SummaryTab
                        data={summaryData}
                        loading={summaryLoading}
                        error={summaryError}
                        dimension={filter.dimension ?? 'model'}
                        onDimensionChange={(dimension) => setFilter((current) => ({ ...current, dimension }))}
                        bucket={filter.bucket ?? 'auto'}
                        onBucketChange={(bucket) => setFilter((current) => ({ ...current, bucket }))}
                        loopSummary={loopSummary}
                    />
                )}
                {activeTab === 'timeline' && (
                    <TimelineTab
                        data={timelineData}
                        loading={timelineLoading}
                        error={timelineError}
                        mode={timelineMode}
                        sessionId={selectedSession?.id}
                        sessionSource={selectedSession?.source}
                        availableSessions={timelineRoster}
                        onSelectSession={selectTimelineSession}
                        onModeChange={setTimelineMode}
                        consolidatedTaskWbs={timelineCorrelationScope.taskWbs}
                        consolidatedRunId={timelineCorrelationScope.runId}
                        onConsolidatedScopeSubmit={setTimelineCorrelationScope}
                    />
                )}
                {activeTab === 'tool-using' && (
                    <ToolUsingTab
                        data={toolSequenceData}
                        loading={toolSequenceLoading}
                        error={toolSequenceError}
                        mode={toolMode}
                        onModeChange={setToolMode}
                        sessionId={selectedSession?.id}
                        sessionSource={selectedSession?.source}
                        availableSessions={timelineRoster}
                        onSelectSession={selectToolSession}
                        toolNames={toolNameFilter}
                        onToolNamesChange={setToolNameFilter}
                        status={toolStatusFilter}
                        onStatusChange={setToolStatusFilter}
                        search={toolSearch}
                        onSearchChange={setToolSearch}
                    />
                )}
                {activeTab === 'sessions' && (
                    <SessionsTab
                        data={sessionsData}
                        loading={sessionsLoading}
                        error={sessionsError}
                        sortBy={sessionsSortBy}
                        sortDir={sessionsSortDir}
                        page={sessionsPage}
                        pageSize={20}
                        onSortChange={(f) => {
                            if (sessionsSortBy === f) {
                                setSessionsSortDir((d) => (d === 'asc' ? 'desc' : 'asc'));
                            } else {
                                setSessionsSortBy(f);
                                setSessionsSortDir('desc');
                            }
                        }}
                        onPageChange={setSessionsPage}
                        onSelectSession={selectTimelineSession}
                    />
                )}
                {activeTab === 'insights' && (
                    <InsightsTab
                        data={insightsData}
                        loading={insightsLoading}
                        error={insightsError}
                        cacheHitTrend={summaryData?.kpiTrend ?? []}
                        onSelectSession={handleSelectSessionFromList}
                    />
                )}
                {activeTab === 'sources' && (
                    <SourcesTab
                        data={sourcesData}
                        loading={sourcesLoading}
                        error={sourcesError}
                        onTriggerImport={handleTriggerImport}
                    />
                )}
            </div>
        </div>
    );
};
export default HistoryShell;
