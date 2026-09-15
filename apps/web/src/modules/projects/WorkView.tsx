import { useState } from 'react';
import FeaturesShell from '../features/FeaturesShell';
import KanbanBoard from '../task-kanban/KanbanBoard';
import { useConversationDraft } from './drafts';
import ProcessesView from './ProcessesView';
import { useProjectTab } from './useProjectTab';

/** Which of Work's three embedded surfaces is showing (component state, not URL — the tab already lives in the URL). */
export type WorkSectionId = 'tasks' | 'features' | 'processes';

export const DEFAULT_WORK_SECTION: WorkSectionId = 'tasks';

const WORK_SECTIONS: readonly { id: WorkSectionId; label: string }[] = [
    { id: 'tasks', label: 'Tasks' },
    { id: 'features', label: 'Features' },
    { id: 'processes', label: 'Processes' },
];

/**
 * Work tab (0843, feature G63): the EXISTING task and feature surfaces, no
 * third rendering path and no fork. One Board server serves exactly one
 * project (0840), so everything these components fetch is already the served
 * project's corpus — Work adds no project filter and no project query
 * parameter (R3); the invariant is asserted in tests, never re-implemented as
 * a filter that would guarantee nothing.
 *
 * The Tasks section mounts `KanbanBoard` — the same embed seam one level below
 * `TaskKanbanView`, whose `useTaskParams().selectTask` would navigate out of
 * the module to `/board/tasks/<wbs>` — with a project-local handler that
 * captures a structured reference into the shared draft and switches to the
 * Conversation tab (R2). The Features section mounts `FeaturesShell` exactly
 * as the features module does; the shell exposes no selection seam, so a
 * feature reference reaches the draft through the same `addRef` contract
 * (`{kind:'feature', id}`) with no Work-side capture affordance (task Q&A).
 * The Processes section (0852) mounts `ProcessesView` — the retired Teams
 * watch list — which polls `/api/team/processes` through the shared
 * MemberTerminal parse module and owns no navigation seam.
 */
export default function WorkView() {
    const [section, setSection] = useState<WorkSectionId>(DEFAULT_WORK_SECTION);
    const { selectTab } = useProjectTab();
    const { addRef } = useConversationDraft();

    // Reference capture (R2): structured from the moment of selection — never
    // written into, or parsed back out of, the composer's text. addRef dedupes.
    const referenceTask = (wbs: string) => {
        addRef({ kind: 'task', wbs });
        selectTab('conversation');
    };

    return (
        <div className="flex flex-col h-full overflow-hidden bg-spur-bg" data-work-view>
            <div className="flex items-center gap-1 px-2 py-1 border-b border-spur-border bg-spur-surface shrink-0">
                {WORK_SECTIONS.map((s) => (
                    <button
                        key={s.id}
                        type="button"
                        aria-pressed={section === s.id}
                        onClick={() => setSection(s.id)}
                        className={`px-3 py-1 rounded-lg text-xs font-medium transition-colors ${
                            section === s.id
                                ? 'bg-spur-accent text-white'
                                : 'text-spur-text-muted hover:text-spur-text hover:bg-spur-surface-3'
                        }`}
                        data-work-section={s.id}
                    >
                        {s.label}
                    </button>
                ))}
            </div>
            {section === 'tasks' ? (
                <div className="flex-1 overflow-hidden" data-g6="use-task">
                    <KanbanBoard onSelectTask={referenceTask} />
                </div>
            ) : section === 'features' ? (
                <div className="flex-1 overflow-hidden">
                    <FeaturesShell />
                </div>
            ) : (
                <div className="flex-1 overflow-hidden">
                    <ProcessesView />
                </div>
            )}
        </div>
    );
}
