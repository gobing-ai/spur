import { useState } from 'react';
import ModuleIcon from '../../components/ModuleIcon';
import {
    Button,
    Diagnostic,
    EmptyState,
    Loading,
    ModuleHeader,
    ModuleShell,
    ModuleTabs,
    TimeRangePresets,
} from '../../components/module-kit';
import { A2aTab } from './A2aTab';
import { allSurfacesOff, enablementKeys, formatUptime, USAGE_WINDOWS, type UsageWindow } from './helpers';
import { McpTab } from './McpTab';
import { SummaryTab } from './SummaryTab';
import { INTEGRATIONS_TABS } from './tabs';
import { type IntegrationsSeams, useIntegrations } from './useIntegrations';

/**
 * Integrations module shell (feature A82, task 1424).
 *
 * Read-only view of the project's agent-protocol surfaces on the A81 module-kit: one header row
 * (identity, usage window, tabs), one status chip, and Summary / MCP / A2A panels. The shell owns
 * the fetch, the window and the retry; the tabs are presentational.
 */
export default function IntegrationsModule({ seams }: { seams?: IntegrationsSeams } = {}) {
    const data = useIntegrations(seams);
    const [activeId, setActiveId] = useState<string>(INTEGRATIONS_TABS[0]?.id ?? 'summary');

    const surfacesOn = data.status !== null && !allSurfacesOff(data.status);
    const chip = data.loading
        ? { tone: 'bg-base-300 text-base-content/70', label: 'loading' }
        : data.error !== null
          ? { tone: 'bg-error/20 text-error', label: 'status unavailable' }
          : surfacesOn
            ? { tone: 'bg-success/20 text-success', label: 'surfaces on' }
            : { tone: 'bg-base-300 text-base-content/70', label: 'all surfaces off' };

    const active = INTEGRATIONS_TABS.find((tab) => tab.id === activeId) ?? INTEGRATIONS_TABS[0];

    return (
        <ModuleShell data-integrations-shell>
            <ModuleHeader
                icon={<ModuleIcon id="integrations" size="lg" />}
                title="Integrations"
                subtitle="MCP and A2A surfaces: what is on, how it is secured, and recent traffic"
                status={
                    <div className="mt-1 flex flex-wrap items-center gap-2">
                        <span
                            role="status"
                            data-testid="integrations-status-chip"
                            className={`inline-flex items-center rounded-full px-2 py-0.5 text-[11px] font-semibold ${chip.tone}`}
                        >
                            {chip.label}
                        </span>
                        {/* Stale-server skew must be visible evidence, not an opaque 400 (task 1437 R6). */}
                        <span
                            data-testid="integrations-server-runtime"
                            className="font-mono text-[11px] text-base-content/50"
                        >
                            {data.server === null
                                ? 'server identity unreadable'
                                : `server v${data.server.version} \u00b7 up ${formatUptime(data.server.uptimeSeconds)}`}
                        </span>
                    </div>
                }
                filters={
                    <TimeRangePresets
                        presets={USAGE_WINDOWS}
                        value={data.window}
                        onChange={(next: UsageWindow) => data.setWindow(next)}
                        label="Usage window"
                    />
                }
                tabs={
                    <ModuleTabs
                        tabs={INTEGRATIONS_TABS}
                        value={active?.id ?? 'summary'}
                        onChange={setActiveId}
                        label="Integrations tabs"
                        idPrefix="integrations-tab"
                    />
                }
            />

            <section
                id={`integrations-tab-panel-${active?.id ?? 'summary'}`}
                role="tabpanel"
                aria-labelledby={`integrations-tab-${active?.id ?? 'summary'}`}
            >
                {data.loading && data.status === null ? (
                    <div className="p-8 flex justify-center" data-testid="integrations-loading">
                        <Loading />
                    </div>
                ) : data.error !== null ? (
                    <div className="flex flex-col gap-2">
                        <Diagnostic
                            testId="integrations-diagnostic"
                            title="The integrations status could not be read"
                            detail={data.error.message}
                            hint="Check that the server is running, then retry."
                        />
                        <div className="px-4">
                            <Button size="sm" variant="primary" onClick={data.retry}>
                                Retry
                            </Button>
                        </div>
                    </div>
                ) : data.status === null ? null : allSurfacesOff(data.status) && active?.id === 'summary' ? (
                    <EmptyState testId="integrations-empty">
                        No agent-protocol surface is enabled. Turn one on in .spur/config.yaml:{' '}
                        {enablementKeys().join(' or ')}.
                    </EmptyState>
                ) : active?.id === 'mcp' ? (
                    <McpTab status={data.status} events={data.mcpEvents} />
                ) : active?.id === 'a2a' ? (
                    <A2aTab
                        status={data.status}
                        requests={data.requests}
                        receipts={data.receipts}
                        events={data.a2aEvents}
                    />
                ) : (
                    <SummaryTab
                        status={data.status}
                        usage={data.usage}
                        mcpEvents={data.mcpEvents}
                        a2aEvents={data.a2aEvents}
                    />
                )}
            </section>
        </ModuleShell>
    );
}
