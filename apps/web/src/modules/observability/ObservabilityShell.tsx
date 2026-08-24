import { useCallback, useState } from 'react';
import {
    OBSERVABILITY_TABS,
    type ObservabilityLiveness,
    type ObservabilityTab,
    type ObservabilityTimeRange,
} from './tabs';

/**
 * Shell for the Observability board module (task 0189 R6; J92 frontend enhancement).
 *
 * Provides standard module framing (max-w-[1600px] centered layout matching History),
 * module title, subtitle, honest liveness indicator chip, tab navigation, and shared timeRange.
 */
export default function ObservabilityShell() {
    const [activeId, setActiveId] = useState<string>(OBSERVABILITY_TABS[0]?.id ?? '');
    const [timeRange, setTimeRange] = useState<ObservabilityTimeRange>('24h');
    const [liveness, setLiveness] = useState<ObservabilityLiveness>({
        status: 'connecting',
        rate: 0,
        lastEventAt: null,
    });

    const active: ObservabilityTab | undefined = OBSERVABILITY_TABS.find((t) => t.id === activeId);
    const Active = active?.component;

    const handleLivenessChange = useCallback((next: ObservabilityLiveness) => {
        setLiveness(next);
    }, []);

    // Derive display chip from current tab + reported liveness.
    const isSystemEvents = activeId === 'system-events';
    const chipStatus = isSystemEvents ? liveness.status : 'idle';
    const chipLabel = isSystemEvents
        ? liveness.status === 'live'
            ? `live tail · ${liveness.rate} evt/60s`
            : liveness.status === 'connecting'
              ? 'connecting…'
              : liveness.status === 'paused'
                ? 'live tail paused'
                : 'stream error'
        : 'live tail idle';

    const dotClass =
        chipStatus === 'live'
            ? 'bg-emerald-400 animate-pulse'
            : chipStatus === 'connecting'
              ? 'bg-amber-400'
              : chipStatus === 'errored'
                ? 'bg-error'
                : 'bg-base-content/40';

    return (
        <div className="flex flex-col gap-4 p-4 max-w-[1600px] mx-auto w-full" data-observability-shell>
            {/* Header & Tab Navigation Bar */}
            <div className="flex flex-wrap items-center justify-between gap-4 border-b border-base-content/10 pb-3 shrink-0">
                <div className="flex items-center gap-3">
                    <span className="text-2xl">📡</span>
                    <div>
                        <h1 className="text-xl font-bold tracking-tight">Observability</h1>
                        <p className="text-xs text-base-content/60">
                            System event streams, queue execution telemetry, and routing attribution
                        </p>
                        <p
                            className="livechip mt-1 inline-flex items-center gap-1.5 rounded-full border border-base-content/10 px-2 py-0.5 text-xs text-base-content/60 font-mono"
                            data-testid="observability-liveness-chip"
                            role="status"
                            aria-live="polite"
                        >
                            <span className={`h-1.5 w-1.5 rounded-full ${dotClass}`} aria-hidden="true" />
                            {chipLabel}
                            {isSystemEvents && liveness.lastEventAt && (
                                <>
                                    {' · last '}
                                    <time dateTime={liveness.lastEventAt}>
                                        {new Date(liveness.lastEventAt).toLocaleTimeString()}
                                    </time>
                                </>
                            )}
                        </p>
                    </div>
                </div>

                {/* Tab Strip */}
                <div
                    role="tablist"
                    aria-label="Observability tabs"
                    className="flex items-center gap-1 bg-base-300 p-1 rounded-xl"
                >
                    {OBSERVABILITY_TABS.map((tab) => {
                        const selected = tab.id === activeId;
                        return (
                            <button
                                key={tab.id}
                                type="button"
                                role="tab"
                                aria-selected={selected}
                                aria-controls={`observability-tab-panel-${tab.id}`}
                                id={`observability-tab-${tab.id}`}
                                onClick={() => setActiveId(tab.id)}
                                className={`px-3 py-1.5 text-xs font-semibold rounded-lg transition-all cursor-pointer ${
                                    selected
                                        ? 'bg-primary text-primary-content font-bold shadow-sm'
                                        : 'text-base-content/70 hover:bg-base-content/10'
                                }`}
                            >
                                {tab.label}
                            </button>
                        );
                    })}
                </div>
            </div>

            {/* Tab Panel */}
            <div
                role="tabpanel"
                id={`observability-tab-panel-${activeId}`}
                aria-labelledby={`observability-tab-${activeId}`}
                className="flex flex-col gap-4"
            >
                {Active ? (
                    <Active
                        onLivenessChange={handleLivenessChange}
                        timeRange={timeRange}
                        onTimeRangeChange={setTimeRange}
                    />
                ) : null}
            </div>
        </div>
    );
}
