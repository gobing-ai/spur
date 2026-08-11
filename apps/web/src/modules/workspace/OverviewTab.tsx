import { Badge } from '@/ui';
import { type TeamGroup, useTeamsData } from '../../lib/use-teams-data';

/** Format an ISO timestamp into a compact local string. */
function formatTime(iso: string): string {
    try {
        const d = new Date(iso);
        return d.toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit', second: '2-digit' });
    } catch {
        return iso;
    }
}

/**
 * Workspace Overview tab (task 0197 R5).
 *
 * A compact identity/status summary for the selected project-local team:
 * team id/name, resolved work dir, and per-member status. Read-only — this
 * view owns no message delivery or process control (ADR-052 ownership).
 */
export default function OverviewTab({ teamId }: { teamId?: string }) {
    const { teams } = useTeamsData();
    const team: TeamGroup | undefined = teamId
        ? teams.find((t) => t.teamId === teamId)
        : teams.find((t) => t.isCurrentProject);

    if (!team) {
        return (
            <div className="p-4 text-sm text-spur-text-muted" data-workspace-overview-empty>
                No team selected for this workspace.
            </div>
        );
    }

    return (
        <div className="flex flex-col h-full overflow-y-auto bg-spur-bg" data-workspace-overview>
            <div className="px-4 py-3 border-b border-spur-border bg-spur-surface">
                <div className="flex items-center gap-2 flex-wrap">
                    <span className="text-sm font-semibold text-spur-text" data-workspace-overview-name>
                        {team.name}
                    </span>
                    <Badge variant="outline" size="xs">
                        {team.teamId}
                    </Badge>
                    <Badge variant={team.isCurrentProject ? 'success' : 'ghost'} size="xs">
                        current project
                    </Badge>
                </div>
                {team.workDir && (
                    <div className="mt-1 font-mono text-xs text-spur-text-muted" data-workspace-overview-workdir>
                        {team.workDir}
                    </div>
                )}
            </div>
            <div className="p-3">
                <div className="text-[10px] uppercase tracking-wide font-semibold text-spur-text-muted mb-2">
                    Members
                </div>
                {team.members.length === 0 ? (
                    <div className="text-xs text-spur-text-muted italic" data-workspace-overview-no-members>
                        No members materialized for this team yet.
                    </div>
                ) : (
                    <ul className="space-y-1">
                        {team.members.map((m) => (
                            <li
                                key={m.id}
                                className="text-xs flex items-center gap-2 py-1 border-b border-spur-border/50 last:border-b-0"
                                data-workspace-overview-member={m.id}
                            >
                                <Badge variant={m.status === 'running' ? 'success' : 'ghost'} size="xs">
                                    {m.status}
                                </Badge>
                                <span className="font-mono text-spur-text">{m.id}</span>
                                <Badge variant="outline" size="xs">
                                    {m.type}
                                </Badge>
                                {m.model && (
                                    <span className="font-mono text-[10px] text-spur-text-muted">{m.model}</span>
                                )}
                            </li>
                        ))}
                    </ul>
                )}
                <div className="mt-3 text-[10px] text-spur-text-faint">
                    Last refresh: {formatTime(new Date().toISOString())}
                </div>
            </div>
        </div>
    );
}
