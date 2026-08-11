import { useEffect, useMemo, useState } from 'react';
import { useTeamsData } from '../../lib/use-teams-data';
import { WORKSPACE_TABS, type WorkspaceTab } from './tabs';

/**
 * Workspace board module shell (task 0197 R5/R6).
 *
 * A composition shell over the existing collaboration surfaces. It selects the
 * first `isCurrentProject` team by default and renders Overview plus scoped
 * Team, Inbox, and Tasks (current-project Kanban) tabs — all sharing that one
 * `teamId`. When no project-local team exists, it shows an actionable empty
 * state pointing at `agent.team` config. The shell owns selection + scope only;
 * it never writes message or process state (ADR-052).
 */
export default function WorkspaceShell() {
    const { teams } = useTeamsData();
    const candidates = useMemo(() => teams.filter((t) => t.isCurrentProject), [teams]);
    const [selectedTeamId, setSelectedTeamId] = useState<string>('');
    const [activeId, setActiveId] = useState<string>('overview');

    // Default to the first project-local team once the feed loads.
    useEffect(() => {
        if (!selectedTeamId && candidates.length > 0) setSelectedTeamId(candidates[0]?.teamId ?? '');
    }, [candidates, selectedTeamId]);

    const selectedTeam = candidates.find((t) => t.teamId === selectedTeamId) ?? null;
    const active: WorkspaceTab | undefined = WORKSPACE_TABS.find((t) => t.id === activeId);
    const Active = active?.component;

    if (candidates.length === 0) {
        return (
            <div
                className="workspace flex flex-col h-full items-center justify-center gap-3 p-6 bg-spur-bg"
                data-workspace-empty
            >
                <div className="text-sm font-semibold text-spur-text">No project-local team</div>
                <p className="text-xs text-spur-text-muted max-w-sm text-center">
                    No configured team resolves to this project's working directory. Add an{' '}
                    <code className="font-mono">agent.team</code> entry in{' '}
                    <code className="font-mono">.spur/config.yaml</code> whose{' '}
                    <code className="font-mono">work_dir</code> points at the current project to compose a Workspace.
                </p>
            </div>
        );
    }

    return (
        <div className="workspace flex flex-col h-full overflow-hidden bg-spur-bg" data-workspace-shell>
            <div className="px-4 py-2 border-b border-spur-border bg-spur-surface shrink-0 flex items-center gap-2">
                <span className="text-xs font-semibold text-spur-text-muted uppercase tracking-wide">Workspace</span>
                <select
                    value={selectedTeam?.teamId ?? ''}
                    onChange={(e) => {
                        setSelectedTeamId(e.target.value);
                        setActiveId('overview');
                    }}
                    aria-label="Workspace team"
                    data-workspace-team-select
                    className="border border-spur-border rounded px-1 py-0.5 bg-spur-bg text-spur-text text-xs"
                >
                    {candidates.map((t) => (
                        <option key={t.teamId} value={t.teamId}>
                            {t.name}
                        </option>
                    ))}
                </select>
            </div>
            <div
                role="tablist"
                aria-label="Workspace tabs"
                className="flex items-center gap-1 px-2 py-1 border-b border-spur-border bg-spur-surface shrink-0"
            >
                {WORKSPACE_TABS.map((tab) => {
                    const selected = tab.id === activeId;
                    return (
                        <button
                            key={tab.id}
                            type="button"
                            role="tab"
                            aria-selected={selected}
                            aria-controls={`workspace-tab-panel-${tab.id}`}
                            id={`workspace-tab-${tab.id}`}
                            onClick={() => setActiveId(tab.id)}
                            className={`px-3 py-1 rounded-lg text-xs font-medium transition-colors ${
                                selected
                                    ? 'bg-spur-accent text-white'
                                    : 'text-spur-text-muted hover:text-spur-text hover:bg-spur-surface-3'
                            }`}
                            data-workspace-tab
                        >
                            {tab.label}
                        </button>
                    );
                })}
            </div>
            <div
                role="tabpanel"
                id={`workspace-tab-panel-${activeId}`}
                aria-labelledby={`workspace-tab-${activeId}`}
                className="flex-1 overflow-hidden"
            >
                {Active ? <Active teamId={selectedTeam?.teamId} /> : null}
            </div>
        </div>
    );
}
