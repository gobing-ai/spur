import type { ReactNode } from 'react';

interface Props {
    collapsed: boolean;
    onToggle: () => void;
    children?: ReactNode;
}

export default function LeftSidebar({ collapsed, onToggle, children }: Props) {
    return (
        <aside className="flex flex-col bg-spur-surface border-r border-spur-border overflow-hidden">
            <div className="flex items-center justify-between p-3 border-b border-spur-border shrink-0">
                {!collapsed && <span className="text-sm font-semibold text-spur-text">Modules</span>}
                <button
                    type="button"
                    onClick={onToggle}
                    className="btn btn-ghost btn-sm text-spur-text-muted"
                    aria-label={collapsed ? 'Expand sidebar' : 'Collapse sidebar'}
                >
                    {collapsed ? '▶' : '◀'}
                </button>
            </div>
            {!collapsed && <nav className="flex-1 overflow-y-auto p-2">{children}</nav>}
            {collapsed && (
                <div className="flex flex-col items-center gap-2 py-3">
                    <span className="text-xs text-spur-text-muted">Nav</span>
                </div>
            )}
        </aside>
    );
}
