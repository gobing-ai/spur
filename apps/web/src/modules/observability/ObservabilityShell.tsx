import { useCallback, useState } from 'react';
import { useSearchParams } from 'react-router';
import ModuleIcon from '../../components/ModuleIcon';
import { ModuleHeader, ModuleShell, ModuleTabs, TimeRangePresets } from '../../components/module-kit';
import { TIME_RANGES } from './ObservabilityFilters';
import {
    OBSERVABILITY_TABS,
    type ObservabilityLiveness,
    type ObservabilityNavIntent,
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
    const [params] = useSearchParams();
    const requestedTab = params.get('tab');
    // Read once: the task page navigates here on a fresh mount. Later tab clicks stay local.
    const [activeId, setActiveId] = useState<string>(() =>
        requestedTab !== null && OBSERVABILITY_TABS.some((tab) => tab.id === requestedTab)
            ? requestedTab
            : (OBSERVABILITY_TABS[0]?.id ?? ''),
    );
    const [timeRange, setTimeRange] = useState<ObservabilityTimeRange>('4h');
    // Last cross-tab intent. Kept until the user picks a tab themselves, so the
    // target tab can apply it on mount (feature E72 R6). 1424 R6: a deep link that names
    // `eventName`/`runId` seeds it here, so another module can land on a filtered view.
    const [navIntent, setNavIntent] = useState<ObservabilityNavIntent | null>(() => {
        if (requestedTab !== 'system-events') return null;
        const eventName = params.get('eventName');
        const runId = params.get('runId');
        if (eventName === null && runId === null) return null;
        return {
            tab: 'system-events',
            ...(eventName === null ? {} : { eventName }),
            ...(runId === null ? {} : { runId }),
        };
    });
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

    const handleNavigate = useCallback((intent: ObservabilityNavIntent) => {
        setNavIntent(intent);
        setActiveId(intent.tab);
    }, []);

    const handleTabClick = useCallback((tabId: string) => {
        setNavIntent(null);
        setActiveId(tabId);
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
        <ModuleShell data-observability-shell>
            {/* ADR-081 header: identity left, shell-owned range presets middle, tab strip right. */}
            <ModuleHeader
                icon={
                    <ModuleIcon id="observability" size="lg" className="h-7 w-7 text-spur-accent" aria-hidden="true" />
                }
                title="Observabilities"
                subtitle="System event streams, queue execution telemetry, and routing attribution"
                status={
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
                }
                filters={<TimeRangePresets presets={TIME_RANGES} value={timeRange} onChange={setTimeRange} />}
                tabs={
                    <ModuleTabs
                        tabs={OBSERVABILITY_TABS}
                        value={activeId}
                        onChange={handleTabClick}
                        label="Observability tabs"
                        idPrefix="observability-tab"
                    />
                }
            />

            {/* Tab Panel */}
            <div
                role="tabpanel"
                id={`observability-tab-panel-${activeId}`}
                aria-labelledby={`observability-tab-${activeId}`}
                className="mt-2 flex flex-col gap-4"
            >
                {Active ? (
                    <Active
                        onLivenessChange={handleLivenessChange}
                        timeRange={timeRange}
                        onNavigate={handleNavigate}
                        navIntent={navIntent}
                    />
                ) : null}
            </div>
        </ModuleShell>
    );
}
