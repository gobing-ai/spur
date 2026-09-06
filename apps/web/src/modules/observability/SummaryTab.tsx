import type { ObservabilityTabProps } from './tabs';

/**
 * SummaryTab placeholder (task 0790; replaced by task 0791).
 *
 * Provides module framing and an empty-state panel so the tab can be registered
 * and mounted in ObservabilityShell before the full metrics implementation lands.
 */
export default function SummaryTab(props: ObservabilityTabProps) {
    return (
        <div className="flex flex-col gap-4" data-testid="observability-summary-tab" data-summary-tab>
            <div className="p-8 text-center bg-base-200/40 rounded-xl border border-base-content/10">
                <span className="text-3xl mb-2 inline-block" role="img" aria-label="dashboard">
                    📊
                </span>
                <h2 className="text-base font-semibold text-base-content">System Observability Summary</h2>
                <p className="text-xs text-base-content/60 mt-1 max-w-md mx-auto">
                    Aggregated KPI metrics, event volume distributions, and error feeds.
                </p>
                {props.timeRange && (
                    <span className="mt-3 inline-block px-2 py-0.5 text-[11px] font-mono rounded bg-base-content/10 text-base-content/70">
                        Window: {props.timeRange}
                    </span>
                )}
            </div>
        </div>
    );
}
