import { createContext, type ReactNode, useContext, useState } from 'react';

/** Shared selection state for the Teams module — drives Terminal + Messages tabs. */
interface TeamsSelection {
    selectedTeamId: string | null;
    selectedMemberId: string | null;
    select: (teamId: string, memberId: string) => void;
    clear: () => void;
}

const Ctx = createContext<TeamsSelection | null>(null);

/** Provider wrapping the Teams shell — selection shared across Roster/Terminal/Messages. */
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
