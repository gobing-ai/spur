import type { ReactNode } from 'react';

interface Props {
    collapsed: boolean;
    onToggle: () => void;
    children?: ReactNode;
}

export default function RightPanel({ collapsed, onToggle, children }: Props) {
    return (
        <aside className="flex flex-col bg-spur-surface border-l border-spur-border overflow-hidden">
            <div className="flex items-center justify-between p-3 border-b border-spur-border shrink-0">
                {!collapsed && <span className="text-sm font-semibold text-spur-text">Context</span>}
                <button
                    type="button"
                    onClick={onToggle}
                    className="btn btn-ghost btn-sm text-spur-text-muted"
                    aria-label={collapsed ? 'Expand panel' : 'Collapse panel'}
                >
                    {collapsed ? '◀' : '▶'}
                </button>
            </div>
            {!collapsed && <div className="flex-1 overflow-y-auto p-3">{children}</div>}
        </aside>
    );
}
