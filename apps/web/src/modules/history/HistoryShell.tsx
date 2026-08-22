import type {
    HistoryFilter,
    HistoryInsightsResponse,
    HistorySessionsResponse,
    HistorySourcesResponse,
    HistorySummaryResponse,
    HistoryTimelineResponse,
} from '@gobing-ai/spur-contracts';
import type React from 'react';
import { useEffect, useState } from 'react';
import { api } from '../../lib/rpc-client';
import HistoryFilters from './HistoryFilters';
import InsightsTab from './InsightsTab';
import SessionsTab from './SessionsTab';
import SourcesTab from './SourcesTab';
import SummaryTab from './SummaryTab';
import TimelineTab from './TimelineTab';
import { HISTORY_TABS } from './tabs';

export const HistoryShell: React.FC = () => {
    const [activeTab, setActiveTab] = useState<string>('summary');
    const [filter, setFilter] = useState<HistoryFilter>({
        range: '30d',
        bucket: 'auto',
        dimension: 'model',
    });
    const [selectedSessionId, setSelectedSessionId] = useState<string>('');

    // Sessions tab query state
    const [sessionsPage, setSessionsPage] = useState<number>(1);
    const [sessionsSortBy, setSessionsSortBy] = useState<
        'start' | 'duration' | 'messages' | 'toolCalls' | 'billedTokens' | 'cacheRead' | 'freshInput'
    >('start');
    const [sessionsSortDir, setSessionsSortDir] = useState<'asc' | 'desc'>('desc');

    // Data states
    const [summaryData, setSummaryData] = useState<HistorySummaryResponse['data'] | undefined>(undefined);
    const [timelineData, setTimelineData] = useState<HistoryTimelineResponse['data'] | undefined>(undefined);
    const [sessionsData, setSessionsData] = useState<HistorySessionsResponse['data'] | undefined>(undefined);
    const [insightsData, setInsightsData] = useState<HistoryInsightsResponse['data'] | undefined>(undefined);
    const [sourcesData, setSourcesData] = useState<HistorySourcesResponse['data'] | undefined>(undefined);

    const [loading, setLoading] = useState<boolean>(true);
    const [error, setError] = useState<string | null>(null);

    // Fetch data based on active tab and filters
    useEffect(() => {
        let mounted = true;
        setLoading(true);
        setError(null);

        const fetchData = async () => {
            try {
                if (activeTab === 'summary') {
                    const res = await api.history.getSummary(filter);
                    if (mounted && res?.data) setSummaryData(res.data);
                } else if (activeTab === 'timeline') {
                    let sessionId = selectedSessionId;
                    if (!sessionId) {
                        const sessions = await api.history.getSessions({
                            filter,
                            page: 1,
                            pageSize: 100,
                            sortBy: 'start',
                            sortDir: 'desc',
                        });
                        if (mounted && sessions?.data) setSessionsData(sessions.data);
                        sessionId = sessions?.data?.items[0]?.id ?? '';
                        if (!sessionId) {
                            if (mounted) setTimelineData(undefined);
                            return;
                        }
                        if (mounted) setSelectedSessionId(sessionId);
                    }
                    const res = await api.history.getTimeline({ sessionId });
                    if (mounted && res?.data) {
                        setTimelineData(res.data);
                        if (!selectedSessionId && res.data.session?.id) {
                            setSelectedSessionId(res.data.session.id);
                        }
                    }
                } else if (activeTab === 'sessions') {
                    const res = await api.history.getSessions({
                        filter,
                        page: sessionsPage,
                        pageSize: 20,
                        sortBy: sessionsSortBy,
                        sortDir: sessionsSortDir,
                    });
                    if (mounted && res?.data) setSessionsData(res.data);
                } else if (activeTab === 'insights') {
                    const res = await api.history.getInsights(filter);
                    if (mounted && res?.data) setInsightsData(res.data);
                } else if (activeTab === 'sources') {
                    const res = await api.history.getSources();
                    if (mounted && res?.data) setSourcesData(res.data);
                }
            } catch (err) {
                if (mounted) {
                    setError(err instanceof Error ? err.message : String(err));
                }
            } finally {
                if (mounted) setLoading(false);
            }
        };

        fetchData();
        return () => {
            mounted = false;
        };
    }, [activeTab, filter, selectedSessionId, sessionsPage, sessionsSortBy, sessionsSortDir]);

    const handleSelectSessionFromList = (sessionId: string) => {
        setSelectedSessionId(sessionId);
        setActiveTab('timeline');
    };

    const handleTriggerImport = async (mode: 'full' | 'incremental') => {
        const response = await api.history.triggerImport({ mode });
        return response.data;
    };

    return (
        <div className="flex flex-col gap-4 p-4 max-w-[1600px] mx-auto w-full">
            {/* Header & Tab Navigation Bar */}
            <div className="flex flex-wrap items-center justify-between gap-4 border-b border-base-content/10 pb-3">
                <div className="flex items-center gap-3">
                    <span className="text-2xl">📊</span>
                    <div>
                        <h1 className="text-xl font-bold tracking-tight">History Board</h1>
                        <p className="text-xs text-base-content/60">
                            Transcript telemetry, session traces, and prompt cache analytics
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
                        </button>
                    ))}
                </div>
            </div>

            {/* Global Filter Bar (Hidden on Sources Tab) */}
            {activeTab !== 'sources' && <HistoryFilters filter={filter} onChange={setFilter} />}

            {/* Tab Views */}
            <div className="mt-2">
                {activeTab === 'summary' && (
                    <SummaryTab
                        data={summaryData}
                        loading={loading}
                        error={error}
                        dimension={filter.dimension ?? 'model'}
                        onDimensionChange={(dimension) => setFilter((current) => ({ ...current, dimension }))}
                    />
                )}
                {activeTab === 'timeline' && (
                    <TimelineTab
                        data={timelineData}
                        loading={loading}
                        error={error}
                        sessionId={selectedSessionId}
                        availableSessions={
                            sessionsData?.items.map((s) => ({
                                id: s.id,
                                source: s.source,
                                model: s.model,
                                start: s.start,
                            })) || []
                        }
                        onSelectSession={setSelectedSessionId}
                    />
                )}
                {activeTab === 'sessions' && (
                    <SessionsTab
                        data={sessionsData}
                        loading={loading}
                        error={error}
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
                        onSelectSession={handleSelectSessionFromList}
                    />
                )}
                {activeTab === 'insights' && (
                    <InsightsTab
                        data={insightsData}
                        loading={loading}
                        error={error}
                        onSelectSession={handleSelectSessionFromList}
                    />
                )}
                {activeTab === 'sources' && (
                    <SourcesTab
                        data={sourcesData}
                        loading={loading}
                        error={error}
                        onTriggerImport={handleTriggerImport}
                    />
                )}
            </div>
        </div>
    );
};
export default HistoryShell;
