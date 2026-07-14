import MemberTerminal from './MemberTerminal';
import { useTeamsSelection } from './TeamsContext';

/** Terminal tab — renders MemberTerminal for the selected member (R5). */
export default function TerminalTab() {
    const { selectedMemberId } = useTeamsSelection();
    if (!selectedMemberId) {
        return (
            <div className="p-4 text-sm text-spur-text-muted italic">
                Select a member from the Roster to open a terminal.
            </div>
        );
    }
    return <MemberTerminal agentId={selectedMemberId} />;
}
