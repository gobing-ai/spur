import { createContext, useCallback, useLayoutEffect, useState } from 'react';
import { Outlet, useLocation } from 'react-router';
import { Button } from '@/ui';
import { loadLayoutState, saveLayoutState } from '../lib/layout-state';
import { ConversationDraftProvider } from '../modules/projects/drafts';
import { ProjectProvider } from '../modules/projects/useProjectContext';
import { useBoardRegistry } from '../modules/RegistryProvider';
import type { WebModule } from '../modules/types';
import ApiErrorToast from './ApiErrorToast';
import GlobalAgentBar from './GlobalAgentBar';
import LeftSidebar from './LeftSidebar';
import MainWorkspace from './MainWorkspace';
import { BoardDiagnosticsBanner, ModuleErrorBoundary } from './ModuleErrorBoundary';
import ResizeHandle from './ResizeHandle';
import RightPanel from './RightPanel';

/** Context for the right-panel to render the active module's contribution. */
export const ActiveModuleContext = createContext<WebModule | undefined>(undefined);

export default function BoardLayout() {
    const [state, setState] = useState(() => loadLayoutState());
    const [mobileSidebarOpen, setMobileSidebarOpen] = useState(false);
    const [mobilePanelOpen, setMobilePanelOpen] = useState(false);
    const location = useLocation();
    const { registry, hostDiagnostics } = useBoardRegistry();

    // Resolve the active module by its ROUTE — the same key the sidebar links and the router
    // mount with. Built-in routes are their bare id (`tasks`); downstream modules are mounted one
    // segment deeper at `/board/modules/<id>`, so the route is reassembled from that segment.
    const activeModule = (() => {
        const parts = location.pathname.split('/');
        const boardIdx = parts.indexOf('board');
        const seg = boardIdx >= 0 ? parts[boardIdx + 1] : undefined;
        if (!seg) return undefined;
        const route = seg === 'modules' && parts[boardIdx + 2] ? `modules/${parts[boardIdx + 2]}` : seg;
        return registry.modules.find((mod) => mod.route === route);
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

    // A framed resource owns the whole workspace (task 0991 R2): the panel, its resize handle and
    // the global agent overlay are suppressed by RENDER ONLY — no layout state is written, so a
    // user's saved left-collapsed/right-collapsed preferences survive switching rendering types.
    const isFramedWorkspace = activeModule?.contributionType === 'iframe';

    // Auto-expand right panel when there's content to show (e.g. navigating to a task detail).
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
            {!isFramedWorkspace && (
                <Button
                    variant="ghost"
                    size="sm"
                    className="text-spur-text"
                    onClick={() => setMobilePanelOpen(true)}
                    aria-label="Open panel"
                >
                    ◧
                </Button>
            )}
        </div>
    );

    const showBackdrop = mobileSidebarOpen || mobilePanelOpen;

    return (
        <ProjectProvider>
            <ConversationDraftProvider>
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
                    data-framed-workspace={String(isFramedWorkspace)}
                >
                    <ActiveModuleContext.Provider value={activeModule}>
                        <LeftSidebar
                            collapsed={state.sidebarCollapsed && !mobileSidebarOpen}
                            onToggle={toggleSidebar}
                            onMobileClose={closeMobile}
                        />
                        <ResizeHandle targetVar="--sidebar-w" onResizeEnd={onSidebarResize} />
                        <MainWorkspace mobileHeader={mobileHeader} framed={isFramedWorkspace}>
                            <BoardDiagnosticsBanner diagnostics={hostDiagnostics} />
                            <Outlet />
                        </MainWorkspace>
                        {!isFramedWorkspace && (
                            <>
                                <ResizeHandle targetVar="--rightpanel-w" onResizeEnd={onRightPanelResize} />
                                <RightPanel
                                    collapsed={state.rightPanelCollapsed}
                                    onToggle={toggleRightPanel}
                                    onMobileClose={closeMobile}
                                >
                                    {RightPanelContent ? (
                                        activeModule && activeModule.contributionType === 'react' ? (
                                            <ModuleErrorBoundary moduleId={activeModule.id} category="panel">
                                                <RightPanelContent />
                                            </ModuleErrorBoundary>
                                        ) : (
                                            <RightPanelContent />
                                        )
                                    ) : null}
                                </RightPanel>
                            </>
                        )}
                    </ActiveModuleContext.Provider>
                </div>
                {!isFramedWorkspace && <GlobalAgentBar activeModule={activeModule} />}
                <ApiErrorToast />
            </ConversationDraftProvider>
        </ProjectProvider>
    );
}
