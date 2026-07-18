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

interface Props {
    collapsed: boolean;
    onToggle: () => void;
    onMobileClose?: () => void;
}
export default function LeftSidebar({ collapsed, onToggle, onMobileClose }: Props) {
    const projectName = useProjectName();
    return (
        <aside className="flex flex-col bg-spur-surface border-r border-spur-border overflow-hidden">
            <div className="flex items-center justify-between p-3 border-b border-spur-border shrink-0">
                {!collapsed && (
                    <span className="text-sm font-semibold text-spur-text truncate" title={projectName}>
                        {projectName}
                    </span>
                )}
                <div className="flex items-center gap-1">
                    {!collapsed && <ThemeToggle />}
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
                    <Button
                        variant="ghost"
                        size="sm"
                        className="text-spur-text-muted hidden md:inline-flex"
                        onClick={onToggle}
                        aria-label={collapsed ? 'Expand sidebar' : 'Collapse sidebar'}
                    >
                        {collapsed ? '▶' : '◀'}
                    </Button>
                </div>
            </div>
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
