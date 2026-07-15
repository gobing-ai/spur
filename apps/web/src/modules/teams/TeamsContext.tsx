import { createContext, type ReactNode, useContext, useState } from 'react';

/**
 * Shared selection state for the Teams module.
 *
 * DEAD IN PRODUCTION as of 0260: RosterTab was the only component that ever called
 * `select`, and Terminal (0259) now owns its selection locally while Messages reads
 * an unfiltered feed. Nothing consumes this in `src/` today. The provider is kept
 * per the 0260 Q&A deferral; delete it (and the `<TeamsProvider>` wrapper in
 * TeamsShell) once 0261 lands and no consumer has reappeared.
 */
interface TeamsSelection {
    selectedTeamId: string | null;
    selectedMemberId: string | null;
    select: (teamId: string, memberId: string) => void;
    clear: () => void;
}

const Ctx = createContext<TeamsSelection | null>(null);

/** Provider wrapping the Teams shell — retained as a no-op pending the 0261 cleanup. */
export function TeamsProvider({ children }: { children: ReactNode }) {
    const [selectedTeamId, setSelectedTeamId] = useState<string | null>(null);
    const [selectedMemberId, setSelectedMemberId] = useState<string | null>(null);

    const select = (teamId: string, memberId: string) => {
        setSelectedTeamId(teamId);
        setSelectedMemberId(memberId);
    };
    const clear = () => {
        setSelectedTeamId(null);
        setSelectedMemberId(null);
    };

    return <Ctx.Provider value={{ selectedTeamId, selectedMemberId, select, clear }}>{children}</Ctx.Provider>;
}

/** Hook to access the shared selection — throws if used outside the provider. */
export function useTeamsSelection(): TeamsSelection {
    const ctx = useContext(Ctx);
    if (!ctx) throw new Error('useTeamsSelection must be used within TeamsProvider');
    return ctx;
}
