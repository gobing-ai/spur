import { useEffect, useState } from 'react';
import { NavLink } from 'react-router';
import { Button } from '@/ui';
import { fetchWithTimeout, resolveApiUrl } from '../lib/rpc-client';
import { modules } from '../modules/registry';
import ThemeToggle from './ThemeToggle';

/** Sidebar title shown until the server identifies the project (and on fetch failure). */
const FALLBACK_TITLE = 'Modules';

/** Wire shape of GET /api/project. `name` is null when the server has no project cwd (CF Worker). */
interface ProjectInfo {
    name?: string | null;
}

/**
 * Resolve the current project name from the server (basename of the cwd `spur serve`
 * runs in) so users can tell which project this board belongs to. Falls back to
 * {@link FALLBACK_TITLE} while loading, when offline, or when the server has no cwd.
 */
function useProjectName(): string {
    const [name, setName] = useState(FALLBACK_TITLE);
    useEffect(() => {
        const controller = new AbortController();
        fetchWithTimeout(new Request(`${resolveApiUrl()}/project`, { signal: controller.signal }))
            .then(async (res) => {
                if (!res.ok) return;
                const body = (await res.json()) as ProjectInfo;
                if (body.name) setName(body.name);
            })
            .catch(() => {
                // offline / pre-project endpoint server → keep fallback title
            });
        return () => controller.abort();
    }, []);
    return name;
}

/** Chevron used for fold/unfold — SVG so it always paints (unicode can be clipped/invisible). */
function SidebarChevron({ direction }: { direction: 'expand' | 'collapse' }) {
    const isExpand = direction === 'expand';
    return (
        <svg
            className="h-4 w-4 shrink-0"
            viewBox="0 0 16 16"
            fill="none"
            stroke="currentColor"
            strokeWidth="2"
            strokeLinecap="round"
            strokeLinejoin="round"
            aria-hidden="true"
        >
            {isExpand ? <path d="M6 3l5 5-5 5" /> : <path d="M10 3L5 8l5 5" />}
        </svg>
    );
}

/**
 * Plain fold/unfold control — intentionally not a daisyUI `Button`.
 * Pairing Tailwind `hidden` / `md:inline-flex` with `.btn { display:inline-flex }`
 * can leave the control permanently invisible depending on CSS layer order.
 */
function SidebarFoldButton({ collapsed, onToggle }: { collapsed: boolean; onToggle: () => void }) {
    const label = collapsed ? 'Expand sidebar' : 'Collapse sidebar';
    return (
        <button
            type="button"
            onClick={onToggle}
            aria-label={label}
            title={label}
            data-testid={collapsed ? 'sidebar-expand' : 'sidebar-collapse'}
            className="flex h-8 w-8 items-center justify-center rounded-md text-spur-text-muted hover:bg-spur-accent/20 hover:text-spur-accent focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-spur-accent"
        >
            <SidebarChevron direction={collapsed ? 'expand' : 'collapse'} />
        </button>
    );
}

interface Props {
    collapsed: boolean;
    onToggle: () => void;
    onMobileClose?: () => void;
}

export default function LeftSidebar({ collapsed, onToggle, onMobileClose }: Props) {
    const projectName = useProjectName();
    return (
        <aside className="flex flex-col bg-spur-surface border-r border-spur-border overflow-hidden">
            {collapsed ? (
                // Collapsed rail: centered expand chevron at the top of the icon list.
                <div className="flex items-center justify-center border-b border-spur-border shrink-0 py-1">
                    <SidebarFoldButton collapsed onToggle={onToggle} />
                </div>
            ) : (
                // Expanded: fold control before theme toggle (restores the pre-regression order).
                <div className="flex items-center justify-between gap-1 p-3 border-b border-spur-border shrink-0">
                    <span className="min-w-0 flex-1 text-sm font-semibold text-spur-text truncate" title={projectName}>
                        {projectName}
                    </span>
                    <div className="flex items-center gap-0.5 shrink-0">
                        <SidebarFoldButton collapsed={false} onToggle={onToggle} />
                        <ThemeToggle />
                        {onMobileClose && (
                            <Button
                                variant="ghost"
                                size="sm"
                                className="text-spur-text-muted md:hidden"
                                onClick={onMobileClose}
                                aria-label="Close navigation"
                            >
                                ✕
                            </Button>
                        )}
                    </div>
                </div>
            )}

            <nav className="flex-1 overflow-y-auto">
                {modules.map((mod) => (
                    <NavLink
                        key={mod.id}
                        to={`/board/${mod.route}`}
                        className={({ isActive }) =>
                            `flex items-center gap-2 px-3 py-2 text-sm transition-colors ${
                                isActive
                                    ? 'bg-spur-accent/20 text-spur-accent'
                                    : 'text-spur-text-muted hover:text-spur-text hover:bg-spur-border/30'
                            } ${collapsed ? 'justify-center py-3' : ''}`
                        }
                        title={collapsed ? mod.name : undefined}
                    >
                        <span className="text-lg">{mod.icon}</span>
                        {!collapsed && <span>{mod.sidebarLabel ?? mod.name}</span>}
                    </NavLink>
                ))}
            </nav>
        </aside>
    );
}
