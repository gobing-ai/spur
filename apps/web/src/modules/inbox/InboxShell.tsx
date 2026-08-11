import { type ReactNode, useEffect, useMemo, useState } from 'react';
import { Select } from '@/ui';
import { useTeamsData } from '../../lib/use-teams-data';
import AgentTab from './AgentTab';
import AllTab from './AllTab';
import SupervisorTab from './SupervisorTab';
import { FIXED_INBOX_TABS } from './tabs';

/** Agent-tab id prefix for a roster member (`agent-<memberId>`). */
const AGENT_TAB_PREFIX = 'agent-';

/** Resolve which panel to render for the active tab id. */
function renderPanel(activeId: string, agentIds: string[], teamId?: string): ReactNode {
    if (activeId === 'all') return <AllTab teamId={teamId} />;
    if (activeId === 'supervisor') return <SupervisorTab teamId={teamId} />;
    if (activeId.startsWith(AGENT_TAB_PREFIX)) {
        const memberId = activeId.slice(AGENT_TAB_PREFIX.length);
        if (agentIds.includes(memberId)) return <AgentTab agentId={memberId} />;
    }
    return null;
}

/**
 * Inbox board module shell (0422 R1/R4).
 *
 * Tab strip mirrors TeamsShell's aria wiring (`tablist`/`tab`/`tabpanel`,
 * `aria-selected`, `aria-controls`, `aria-labelledby`). `All` and `Supervisor`
 * are fixed; per-agent tabs are derived from the selected team roster via
 * `useTeamsData()` and update when the team selection changes. The module root
 * carries the `inbox` scope class so every surface resolves the DESIGN.md
 * palette (R10).
 *
 * When a `teamId` is provided (Workspace scope, task 0197 R4), the shell locks
 * to that team — it hides its own team dropdown and threads the scope into the
 * message tabs. When omitted, the global behavior is preserved.
 */
export default function InboxShell({ teamId }: { teamId?: string }) {
    const { teams } = useTeamsData();
    const [selectedTeamId, setSelectedTeamId] = useState('');
    const [activeId, setActiveId] = useState('all');

    // Default the team selection to the first team once the roster loads (R4).
    // When externally scoped via `teamId`, selection is owned by the caller.
    useEffect(() => {
        if (teamId) return;
        if (!selectedTeamId && teams.length > 0) setSelectedTeamId(teams[0]?.teamId ?? '');
    }, [teamId, teams, selectedTeamId]);

    const effectiveTeamId = teamId ?? selectedTeamId;
    const selectedTeam = teams.find((t) => t.teamId === effectiveTeamId) ?? teams[0] ?? null;
    const agentIds = selectedTeam ? selectedTeam.members.map((m) => m.id) : [];

    // If the active id points at a member of a now-different team, fall back to All.
    const resolvedActiveId =
        activeId === 'all' || activeId === 'supervisor' || agentIds.includes(activeId.slice(AGENT_TAB_PREFIX.length))
            ? activeId
            : 'all';

    const tabs = useMemo(() => {
        const agentTabs = agentIds.map((memberId) => ({ id: `${AGENT_TAB_PREFIX}${memberId}`, label: memberId }));
        return [...FIXED_INBOX_TABS, ...agentTabs];
    }, [agentIds]);

    return (
        <div className="inbox flex flex-col h-full overflow-hidden bg-spur-bg" data-inbox-shell>
            <div className="px-4 py-2 border-b border-spur-border bg-spur-surface shrink-0 flex items-center justify-between">
                <span className="text-xs font-semibold text-spur-text-muted uppercase tracking-wide">Inbox</span>
                {!teamId && teams.length > 0 && (
                    <label className="flex items-center gap-1 text-xs" htmlFor="inbox-team-select">
                        <span className="text-spur-text-muted">Team</span>
                        <Select
                            id="inbox-team-select"
                            variant="bordered"
                            size="sm"
                            value={selectedTeam?.teamId ?? ''}
                            onChange={(e) => {
                                setSelectedTeamId(e.target.value);
                                setActiveId('all');
                            }}
                            data-inbox-team-select
                        >
                            <option value="">Select team…</option>
                            {teams.map((t) => (
                                <option key={t.teamId} value={t.teamId}>
                                    {t.name}
                                </option>
                            ))}
                        </Select>
                    </label>
                )}
            </div>
            <div
                role="tablist"
                aria-label="Inbox tabs"
                className="flex items-center gap-1 px-2 py-1 border-b border-spur-border bg-spur-surface shrink-0"
            >
                {tabs.map((tab) => {
                    const selected = tab.id === resolvedActiveId;
                    return (
                        <button
                            key={tab.id}
                            type="button"
                            role="tab"
                            aria-selected={selected}
                            aria-controls={`inbox-tab-panel-${tab.id}`}
                            id={`inbox-tab-${tab.id}`}
                            onClick={() => setActiveId(tab.id)}
                            className={`px-3 py-1 rounded-lg text-xs font-medium transition-colors ${
                                selected
                                    ? 'bg-spur-accent text-white'
                                    : 'text-spur-text-muted hover:text-spur-text hover:bg-spur-surface-3'
                            }`}
                            data-inbox-tab
                        >
                            {tab.label}
                        </button>
                    );
                })}
            </div>
            <div
                role="tabpanel"
                id={`inbox-tab-panel-${resolvedActiveId}`}
                aria-labelledby={`inbox-tab-${resolvedActiveId}`}
                className="flex-1 overflow-hidden"
            >
                {renderPanel(resolvedActiveId, agentIds, teamId)}
            </div>
        </div>
    );
}
