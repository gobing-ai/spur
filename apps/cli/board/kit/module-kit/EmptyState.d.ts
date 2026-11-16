import type { ReactNode } from 'react';
/** Props of the standard module empty state. */
export interface EmptyStateProps {
    /** What is absent, plus the action that would produce rows. */
    children: ReactNode;
    /** Test id for the module's own assertions. */
    testId?: string;
}
/**
 * ## EmptyState
 *
 * The one empty state a module view renders when a query legitimately returns nothing:
 * muted, italic, centred, no illustration and no placeholder rows. Distinct from loading —
 * a known-empty result is empty, not loading.
 */
export declare function EmptyState({ children, testId }: EmptyStateProps): import("react/jsx-runtime").JSX.Element;
