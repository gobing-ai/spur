import type { ReactNode } from 'react';
import { Button } from '@/ui';

interface Props {
    collapsed: boolean;
    onToggle: () => void;
    onMobileClose?: () => void;
    children?: ReactNode;
}

export default function RightPanel({ collapsed, onToggle, onMobileClose, children }: Props) {
    return (
        <aside className="flex flex-col bg-spur-surface border-l border-spur-border overflow-hidden">
            {/* Mobile drag handle — only visible <md */}
            {onMobileClose && (
                <div className="hidden max-md:flex items-center justify-center py-2 shrink-0">
                    <div className="w-10 h-1 rounded-full bg-spur-border" />
                </div>
            )}
            <div className="flex items-center justify-between p-3 border-b border-spur-border shrink-0">
                {!collapsed && <span className="text-sm font-semibold text-spur-text">Context</span>}
                <div className="flex items-center gap-1">
                    {onMobileClose && (
                        <Button
                            variant="ghost"
                            size="sm"
                            className="text-spur-text-muted md:hidden"
                            onClick={onMobileClose}
                            aria-label="Close panel"
                        >
                            ✕
                        </Button>
                    )}
                    <Button
                        variant="ghost"
                        size="sm"
                        className="text-spur-text-muted hidden md:inline-flex"
                        onClick={onToggle}
                        aria-label={collapsed ? 'Expand panel' : 'Collapse panel'}
                    >
                        {collapsed ? '◀' : '▶'}
                    </Button>
                </div>
            </div>
            {!collapsed && <div className="flex-1 overflow-y-auto p-3">{children}</div>}
        </aside>
    );
}
