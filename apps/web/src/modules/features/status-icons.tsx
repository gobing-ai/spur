import type React from 'react';

export interface StatusMeta {
    status: string;
    label: string;
    colorClass: string;
    Icon: (props: { className?: string }) => React.JSX.Element;
}

/**
 * Mapping table from canonical feature status to inline SVG icon & color class.
 * Canonical statuses: backlog, active, verifying, blocked, done, cancelled.
 */
export const FEATURE_STATUS_MAP: Record<string, StatusMeta> = {
    backlog: {
        status: 'backlog',
        label: 'Backlog',
        colorClass: 'text-spur-text-muted',
        Icon: ({ className = 'w-3.5 h-3.5' }: { className?: string }) => (
            <svg
                className={`inline-block shrink-0 text-spur-text-muted ${className}`}
                viewBox="0 0 16 16"
                fill="none"
                stroke="currentColor"
                strokeWidth="1.75"
                aria-hidden="true"
            >
                <circle cx="8" cy="8" r="5.5" strokeDasharray="2 2" />
            </svg>
        ),
    },
    active: {
        status: 'active',
        label: 'Active',
        colorClass: 'text-spur-accent',
        Icon: ({ className = 'w-3.5 h-3.5' }: { className?: string }) => (
            <svg
                className={`inline-block shrink-0 text-spur-accent ${className}`}
                viewBox="0 0 16 16"
                fill="currentColor"
                aria-hidden="true"
            >
                <circle cx="8" cy="8" r="4.5" />
            </svg>
        ),
    },
    verifying: {
        status: 'verifying',
        label: 'Verifying',
        colorClass: 'text-amber-500',
        Icon: ({ className = 'w-3.5 h-3.5' }: { className?: string }) => (
            <svg
                className={`inline-block shrink-0 text-amber-500 ${className}`}
                viewBox="0 0 16 16"
                fill="none"
                stroke="currentColor"
                strokeWidth="1.75"
                aria-hidden="true"
            >
                <path d="M1.5 8s2.5-4 6.5-4 6.5 4 6.5 4-2.5 4-6.5 4-6.5-4-6.5-4z" />
                <circle cx="8" cy="8" r="2" />
            </svg>
        ),
    },
    blocked: {
        status: 'blocked',
        label: 'Blocked',
        colorClass: 'text-error',
        Icon: ({ className = 'w-3.5 h-3.5' }: { className?: string }) => (
            <svg
                className={`inline-block shrink-0 text-error ${className}`}
                viewBox="0 0 16 16"
                fill="none"
                stroke="currentColor"
                strokeWidth="1.75"
                strokeLinecap="round"
                strokeLinejoin="round"
                aria-hidden="true"
            >
                <path d="M8 2.5l5.5 10.5H2.5L8 2.5z" />
                <path d="M8 6v3" />
                <circle cx="8" cy="11.5" r="0.5" fill="currentColor" />
            </svg>
        ),
    },
    done: {
        status: 'done',
        label: 'Done',
        colorClass: 'text-success',
        Icon: ({ className = 'w-3.5 h-3.5' }: { className?: string }) => (
            <svg
                className={`inline-block shrink-0 text-success ${className}`}
                viewBox="0 0 16 16"
                fill="none"
                stroke="currentColor"
                strokeWidth="1.75"
                strokeLinecap="round"
                strokeLinejoin="round"
                aria-hidden="true"
            >
                <circle cx="8" cy="8" r="5.5" />
                <path d="M5.5 8l2 2 3.5-3.5" />
            </svg>
        ),
    },
    cancelled: {
        status: 'cancelled',
        label: 'Cancelled',
        colorClass: 'text-spur-text-muted opacity-60',
        Icon: ({ className = 'w-3.5 h-3.5' }: { className?: string }) => (
            <svg
                className={`inline-block shrink-0 text-spur-text-muted opacity-60 ${className}`}
                viewBox="0 0 16 16"
                fill="none"
                stroke="currentColor"
                strokeWidth="1.75"
                strokeLinecap="round"
                strokeLinejoin="round"
                aria-hidden="true"
            >
                <circle cx="8" cy="8" r="5.5" />
                <path d="M6 6l4 4M10 6l-4 4" />
            </svg>
        ),
    },
};

/** Render the SVG icon for a feature status string. Fallback to default dot icon if unknown. */
export function FeatureStatusIcon({ status, className }: { status: string; className?: string }) {
    const key = status.toLowerCase();
    const meta = FEATURE_STATUS_MAP[key];
    if (meta) {
        const IconComp = meta.Icon;
        return <IconComp className={className} />;
    }
    return (
        <svg
            className={`inline-block shrink-0 text-spur-text-muted ${className ?? 'w-3.5 h-3.5'}`}
            viewBox="0 0 16 16"
            fill="currentColor"
            aria-hidden="true"
        >
            <circle cx="8" cy="8" r="4" />
        </svg>
    );
}
