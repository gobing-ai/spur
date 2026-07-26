import type React from 'react';

/**
 * Canonical feature statuses — sole definition site is the domain schema (ADR-034).
 * Re-exported so existing importers (FeaturesShell.tsx) keep working unchanged.
 */
export { FEATURE_STATUSES } from '@gobing-ai/spur-domain/schema';

export interface StatusMeta {
    status: string;
    label: string;
    colorClass: string;
    Icon: (props: { className?: string; ariaLabel?: string }) => React.JSX.Element;
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
        Icon: ({ className = 'w-3.5 h-3.5', ariaLabel }: { className?: string; ariaLabel?: string }) => (
            <svg
                className={`inline-block shrink-0 ${className}`}
                viewBox="0 0 16 16"
                fill="none"
                stroke="currentColor"
                strokeWidth="1.75"
                role="img"
                aria-label={ariaLabel}
            >
                <rect x="3" y="3" width="10" height="10" rx="2.5" strokeDasharray="2 2" />
            </svg>
        ),
    },
    active: {
        status: 'active',
        label: 'Active',
        colorClass: 'text-spur-accent',
        Icon: ({ className = 'w-3.5 h-3.5', ariaLabel }: { className?: string; ariaLabel?: string }) => (
            <svg
                className={`inline-block shrink-0 ${className}`}
                viewBox="0 0 16 16"
                fill="currentColor"
                role="img"
                aria-label={ariaLabel}
            >
                <circle cx="8" cy="8" r="4.5" />
            </svg>
        ),
    },
    verifying: {
        status: 'verifying',
        label: 'Verifying',
        colorClass: 'text-spur-warning',
        Icon: ({ className = 'w-3.5 h-3.5', ariaLabel }: { className?: string; ariaLabel?: string }) => (
            <svg
                className={`inline-block shrink-0 ${className}`}
                viewBox="0 0 16 16"
                fill="none"
                stroke="currentColor"
                strokeWidth="1.75"
                role="img"
                aria-label={ariaLabel}
            >
                <path d="M1.5 8s2.5-4 6.5-4 6.5 4 6.5 4-2.5 4-6.5 4-6.5-4-6.5-4z" />
                <circle cx="8" cy="8" r="2" />
            </svg>
        ),
    },
    blocked: {
        status: 'blocked',
        label: 'Blocked',
        colorClass: 'text-spur-error',
        Icon: ({ className = 'w-3.5 h-3.5', ariaLabel }: { className?: string; ariaLabel?: string }) => (
            <svg
                className={`inline-block shrink-0 ${className}`}
                viewBox="0 0 16 16"
                fill="none"
                stroke="currentColor"
                strokeWidth="1.75"
                strokeLinecap="round"
                strokeLinejoin="round"
                role="img"
                aria-label={ariaLabel}
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
        colorClass: 'text-spur-success',
        Icon: ({ className = 'w-3.5 h-3.5', ariaLabel }: { className?: string; ariaLabel?: string }) => (
            <svg
                className={`inline-block shrink-0 ${className}`}
                viewBox="0 0 16 16"
                fill="none"
                stroke="currentColor"
                strokeWidth="2"
                strokeLinecap="round"
                strokeLinejoin="round"
                role="img"
                aria-label={ariaLabel}
            >
                <path d="M3.5 8.5l3.5 3.5 5.5-7" />
            </svg>
        ),
    },
    cancelled: {
        status: 'cancelled',
        label: 'Cancelled',
        colorClass: 'text-spur-text-faint',
        Icon: ({ className = 'w-3.5 h-3.5', ariaLabel }: { className?: string; ariaLabel?: string }) => (
            <svg
                className={`inline-block shrink-0 ${className}`}
                viewBox="0 0 16 16"
                fill="none"
                stroke="currentColor"
                strokeWidth="1.75"
                strokeLinecap="round"
                strokeLinejoin="round"
                role="img"
                aria-label={ariaLabel}
            >
                <path d="M5.5 2.5h5l3 3v5l-3 3h-5l-3-3v-5l3-3z" />
                <path d="M6.25 6.25l3.5 3.5M9.75 6.25l-3.5 3.5" />
            </svg>
        ),
    },
};

/**
 * Human-readable label for a feature status — the single source for both the
 * accessible name (`aria-label`) and the tooltip's `data-tip`, so the visual and
 * semantic channels can never disagree (task 0336).
 */
export function featureStatusLabel(status: string): string {
    const meta = FEATURE_STATUS_MAP[status.toLowerCase()];
    return meta ? meta.label : `Unknown status: ${status}`;
}

/** Render the SVG icon for a feature status string. Fallback to default dot icon if unknown. */
export function FeatureStatusIcon({ status, className }: { status: string; className?: string }) {
    const key = status.toLowerCase();
    const meta = FEATURE_STATUS_MAP[key];
    if (meta) {
        const IconComp = meta.Icon;
        return <IconComp className={`${meta.colorClass} ${className ?? 'w-3.5 h-3.5'}`} ariaLabel={meta.label} />;
    }
    return (
        <svg
            className={`inline-block shrink-0 text-spur-text-muted ${className ?? 'w-3.5 h-3.5'}`}
            viewBox="0 0 16 16"
            fill="currentColor"
            role="img"
            aria-label={featureStatusLabel(status)}
        >
            <circle cx="8" cy="8" r="4" />
        </svg>
    );
}
