import { useCallback, useLayoutEffect, useState } from 'react';
import { loadLayoutState, saveLayoutState } from '../lib/layout-state';
import LeftSidebar from './LeftSidebar';
import MainWorkspace from './MainWorkspace';
import ResizeHandle from './ResizeHandle';
import RightPanel from './RightPanel';

export default function BoardLayout() {
    const [state, setState] = useState(() => loadLayoutState());

    useLayoutEffect(() => {
        const root = document.documentElement;
        root.style.setProperty('--sidebar-w', `${state.sidebarWidth}px`);
        root.style.setProperty('--rightpanel-w', `${state.rightPanelWidth}px`);
    }, [state.sidebarWidth, state.rightPanelWidth]);

    const save = useCallback((s: typeof state) => {
        saveLayoutState(s);
    }, []);

    const toggleSidebar = useCallback(() => {
        setState((prev) => {
            const next = { ...prev, sidebarCollapsed: !prev.sidebarCollapsed };
            save(next);
            return next;
        });
    }, [save]);

    const toggleRightPanel = useCallback(() => {
        setState((prev) => {
            const next = { ...prev, rightPanelCollapsed: !prev.rightPanelCollapsed };
            save(next);
            return next;
        });
    }, [save]);

    const onSidebarResize = useCallback(
        (px: number) => {
            setState((prev) => {
                const next = { ...prev, sidebarWidth: px };
                save(next);
                return next;
            });
        },
        [save],
    );

    const onRightPanelResize = useCallback(
        (px: number) => {
            setState((prev) => {
                const next = { ...prev, rightPanelWidth: px };
                save(next);
                return next;
            });
        },
        [save],
    );

    return (
        <div
            className="board-layout"
            data-sidebar-collapsed={String(state.sidebarCollapsed)}
            data-rightpanel-collapsed={String(state.rightPanelCollapsed)}
        >
            <LeftSidebar collapsed={state.sidebarCollapsed} onToggle={toggleSidebar}>
                {/* Nav items wired in 0083 */}
            </LeftSidebar>
            <ResizeHandle targetVar="--sidebar-w" onResizeEnd={onSidebarResize} />
            <MainWorkspace>
                {/* React Router <Outlet/> wired in 0083 */}
                <div className="flex items-center justify-center h-full text-spur-text-muted text-sm">
                    Select a module from the sidebar
                </div>
            </MainWorkspace>
            <ResizeHandle targetVar="--rightpanel-w" onResizeEnd={onRightPanelResize} />
            <RightPanel collapsed={state.rightPanelCollapsed} onToggle={toggleRightPanel}>
                {/* Context panel content wired in later tasks */}
            </RightPanel>
        </div>
    );
}
