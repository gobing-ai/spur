import { NavLink } from 'react-router';
import { modules } from '../modules/registry';
import ThemeToggle from './ThemeToggle';

interface Props {
    collapsed: boolean;
    onToggle: () => void;
    onMobileClose?: () => void;
}
export default function LeftSidebar({ collapsed, onToggle, onMobileClose }: Props) {
    return (
        <aside className="flex flex-col bg-spur-surface border-r border-spur-border overflow-hidden">
            <div className="flex items-center justify-between p-3 border-b border-spur-border shrink-0">
                {!collapsed && <span className="text-sm font-semibold text-spur-text">Modules</span>}
                <div className="flex items-center gap-1">
                    {!collapsed && <ThemeToggle />}
                    {onMobileClose && (
                        <button
                            type="button"
                            onClick={onMobileClose}
                            className="btn btn-ghost btn-sm text-spur-text-muted md:hidden"
                            aria-label="Close navigation"
                        >
                            ✕
                        </button>
                    )}
                    <button
                        type="button"
                        onClick={onToggle}
                        className="btn btn-ghost btn-sm text-spur-text-muted hidden md:inline-flex"
                        aria-label={collapsed ? 'Expand sidebar' : 'Collapse sidebar'}
                    >
                        {collapsed ? '▶' : '◀'}
                    </button>
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
