import type { ObservabilityOutcomes } from '@gobing-ai/spur-contracts';
import { Link } from 'react-router';
import { taskRunEvidenceHref } from '../task-kanban/TaskRunEvidenceLink';

const EXCLUDED_LABELS: Record<string, string> = {
    notDone: 'Not done',
    forcedDone: 'Forced done',
    missingVerdict: 'Missing verdict',
    syntheticVerdict: 'Synthetic verdict',
    verdictNotPass: 'Verdict not PASS',
    proofAbsent: 'Proof absent',
    certifyingRunFailed: 'Certifying run failed',
};

/**
 * Current-window verified outcomes and measured cost on the Summary tab.
 * Links use the existing task and trace routes. Totals cover the full window
 * even when the evidence list is truncated.
 */
export function SummaryOutcomes({ outcomes }: { outcomes: ObservabilityOutcomes }) {
    const verified = outcomes.verified;
    const excluded = verified
        ? (Object.entries(verified.excludedReasons) as Array<[string, number]>).filter(([, count]) => count > 0)
        : [];
    const reasons = Object.entries(outcomes.terminalReasonMix);

    return (
        <section
            className="bg-base-200 rounded-xl border border-base-content/10 p-4 flex flex-col gap-3"
            data-testid="summary-outcomes"
            aria-labelledby="summary-outcomes-heading"
        >
            <h3
                id="summary-outcomes-heading"
                className="text-xs font-semibold uppercase tracking-wider text-base-content/60"
            >
                Verified outcomes
            </h3>
            <dl className="grid grid-cols-1 md:grid-cols-2 gap-3 text-sm">
                <div>
                    <dt className="text-xs text-base-content/60">Verified tasks</dt>
                    <dd className="font-mono" data-testid="outcome-verified-tasks">
                        {verified === null
                            ? 'Verified outcomes unavailable'
                            : `${verified.verifiedResults} of ${verified.taskDenominator}`}
                    </dd>
                </div>
                <div>
                    <dt className="text-xs text-base-content/60">Corrections (tasks)</dt>
                    <dd className="font-mono" data-testid="outcome-corrections">
                        {verified === null ? '—' : verified.correctionCount}
                    </dd>
                </div>
                <div>
                    <dt className="text-xs text-base-content/60">Retry exhausted (tasks)</dt>
                    <dd className="font-mono" data-testid="outcome-retry-exhausted">
                        {verified === null ? '—' : verified.retryExhaustedCount}
                    </dd>
                </div>
                <div>
                    <dt className="text-xs text-base-content/60">Measured USD</dt>
                    <dd className="font-mono" data-testid="outcome-measured-usd">
                        {outcomes.measuredUsd === null ? 'Measured USD unavailable' : outcomes.measuredUsd}
                    </dd>
                </div>
                <div>
                    <dt className="text-xs text-base-content/60">Tokens</dt>
                    <dd className="font-mono" data-testid="outcome-tokens">
                        {outcomes.tokens === null ? '—' : outcomes.tokens}
                    </dd>
                </div>
                <div>
                    <dt className="text-xs text-base-content/60">Cost coverage</dt>
                    <dd className="font-mono" data-testid="outcome-unknown-cost">
                        {outcomes.usdRows} of {outcomes.historyRows} history rows have persisted USD ·{' '}
                        {outcomes.unknownUsdRows} unknown USD rows · {outcomes.unknownCostRunCount} runs with unknown
                        cost
                    </dd>
                </div>
                <div>
                    <dt className="text-xs text-base-content/60">Gate duration</dt>
                    <dd className="font-mono" data-testid="outcome-gate">
                        {outcomes.gateDurationMs === null
                            ? 'Gate duration unavailable'
                            : `${outcomes.gateDurationMs} ms`}{' '}
                        · {outcomes.gateSampleCount} samples
                    </dd>
                </div>
                <div>
                    <dt className="text-xs text-base-content/60">Terminal reasons</dt>
                    <dd className="font-mono" data-testid="outcome-terminal-reasons">
                        {reasons.length === 0
                            ? 'No terminal runs'
                            : reasons.map(([reason, count]) => `${reason} ${count}`).join(', ')}
                    </dd>
                </div>
            </dl>
            {verified !== null && verified.timeToVerified.count > 0 ? (
                <p className="text-xs text-base-content/70" data-testid="outcome-time-to-verified">
                    Mean time to verified {verified.timeToVerified.meanMs} ms
                </p>
            ) : null}
            {excluded.length > 0 ? (
                <ul className="text-xs text-base-content/70" data-testid="outcome-excluded">
                    {excluded.map(([key, count]) => (
                        <li key={key}>
                            {EXCLUDED_LABELS[key] ?? key}: {count}
                        </li>
                    ))}
                </ul>
            ) : null}
            <ul className="flex flex-col gap-1 text-xs">
                {outcomes.evidence.map((row) => (
                    <li key={row.runId} data-testid={`outcome-evidence-${row.runId}`}>
                        {row.wbs !== null ? (
                            <>
                                <Link to={`/board/tasks/${encodeURIComponent(row.wbs)}`}>Task {row.wbs}</Link>
                                {' · '}
                                <Link to={taskRunEvidenceHref(row.wbs)}>Trace {row.runId}</Link>
                            </>
                        ) : (
                            <Link to="/board/observability?tab=trace">Trace {row.runId}</Link>
                        )}
                    </li>
                ))}
            </ul>
            {outcomes.evidenceTruncated ? (
                <p className="text-xs text-base-content/70" data-testid="outcome-evidence-truncated">
                    Evidence list truncated at 100; totals cover the full window.
                </p>
            ) : null}
        </section>
    );
}
