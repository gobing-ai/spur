import { createContext, useCallback, useLayoutEffect, useState } from 'react';
import { Outlet, useLocation } from 'react-router';
import { Button } from '@/ui';
import { loadLayoutState, saveLayoutState } from '../lib/layout-state';
import { getModule } from '../modules/registry';
import type { WebModule } from '../modules/types';
import ApiErrorToast from './ApiErrorToast';
import GlobalAgentBar from './GlobalAgentBar';
import LeftSidebar from './LeftSidebar';
import MainWorkspace from './MainWorkspace';
import ResizeHandle from './ResizeHandle';
import RightPanel from './RightPanel';

/** Context for the right-panel to render the active module's contribution. */
export const ActiveModuleContext = createContext<WebModule | undefined>(undefined);

export default function BoardLayout() {
    const [state, setState] = useState(() => loadLayoutState());
    const [mobileSidebarOpen, setMobileSidebarOpen] = useState(false);
    const [mobilePanelOpen, setMobilePanelOpen] = useState(false);
    const location = useLocation();

    // Resolve active module from the current route segment
    // Resolve module from the segment immediately after /board/, so both
    // /board/tasks and /board/tasks/0016 resolve to the 'tasks' module.
    const activeModule = (() => {
        const parts = location.pathname.split('/');
        const boardIdx = parts.indexOf('board');
        const seg = boardIdx >= 0 ? parts[boardIdx + 1] : undefined;
        return getModule(seg ?? '');
    })();

    useLayoutEffect(() => {
        const root = document.documentElement;
        root.style.setProperty('--sidebar-w', `${state.sidebarWidth}px`);
        root.style.setProperty('--rightpanel-w', `${state.rightPanelWidth}px`);
    }, [state.sidebarWidth, state.rightPanelWidth]);

    const save = useCallback((s: typeof state) => saveLayoutState(s), []);

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
        (px: number) =>
            setState((prev) => {
                const next = { ...prev, sidebarWidth: px };
                save(next);
                return next;
            }),
        [save],
    );

    const onRightPanelResize = useCallback(
        (px: number) =>
            setState((prev) => {
                const next = { ...prev, rightPanelWidth: px };
                save(next);
                return next;
            }),
        [save],
    );

    const closeMobile = useCallback(() => {
        setMobileSidebarOpen(false);
        setMobilePanelOpen(false);
    }, []);

    const onBackdropKeyDown = useCallback(
        (e: React.KeyboardEvent) => {
            if (e.key === 'Escape') closeMobile();
        },
        [closeMobile],
    );

    const RightPanelContent = activeModule?.rightPanelComponent;

    // Auto-expand right panel when there's content to show (e.g. navigating to a task detail).
    // eslint-disable-next-line react-hooks/rules-of-hooks
    useLayoutEffect(() => {
        if (RightPanelContent && state.rightPanelCollapsed) {
            setState((prev) => ({ ...prev, rightPanelCollapsed: false }));
        }
    }, [RightPanelContent, state.rightPanelCollapsed]);

    const mobileHeader = (
        <div className="mobile-bar">
            <Button
                variant="ghost"
                size="sm"
                className="text-spur-text"
                onClick={() => setMobileSidebarOpen(true)}
                aria-label="Open navigation"
            >
                ☰
            </Button>
            <span className="text-sm font-semibold text-spur-text">{activeModule?.name ?? 'Spur'}</span>
            <Button
                variant="ghost"
                size="sm"
                className="text-spur-text"
                onClick={() => setMobilePanelOpen(true)}
                aria-label="Open panel"
            >
                ◧
            </Button>
        </div>
    );

    const showBackdrop = mobileSidebarOpen || mobilePanelOpen;

    return (
        <>
            {showBackdrop && (
                <div
                    className="fixed inset-0 z-40 bg-black/50 md:hidden"
                    onClick={closeMobile}
                    onKeyDown={onBackdropKeyDown}
                    aria-hidden="true"
                />
            )}
            <div
                className="board-layout"
                data-sidebar-collapsed={String(state.sidebarCollapsed)}
                data-rightpanel-collapsed={String(state.rightPanelCollapsed)}
                data-mobile-sidebar-open={String(mobileSidebarOpen)}
                data-mobile-panel-open={String(mobilePanelOpen)}
            >
                <ActiveModuleContext.Provider value={activeModule}>
                    <LeftSidebar
                        collapsed={state.sidebarCollapsed && !mobileSidebarOpen}
                        onToggle={toggleSidebar}
                        onMobileClose={closeMobile}
                    />
                    <ResizeHandle targetVar="--sidebar-w" onResizeEnd={onSidebarResize} />
                    <MainWorkspace mobileHeader={mobileHeader}>
                        <Outlet />
                    </MainWorkspace>
                    <ResizeHandle targetVar="--rightpanel-w" onResizeEnd={onRightPanelResize} />
                    <RightPanel
                        collapsed={state.rightPanelCollapsed}
                        onToggle={toggleRightPanel}
                        onMobileClose={closeMobile}
                    >
                        {RightPanelContent ? <RightPanelContent /> : null}
                    </RightPanel>
                </ActiveModuleContext.Provider>
            </div>
            <GlobalAgentBar activeModule={activeModule} />
            <ApiErrorToast />
        </>
    );
}
