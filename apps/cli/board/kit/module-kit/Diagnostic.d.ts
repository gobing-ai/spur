import type React from 'react';
import type { ReactNode } from 'react';
/** Severity of the diagnostic surface; both tones use the same neutral container. */
export type DiagnosticTone = 'error' | 'warning';
/** Presentational core of an actionable module failure. */
export interface DiagnosticProps extends Omit<React.HTMLAttributes<HTMLDivElement>, 'title'> {
    /** One line naming what could not be displayed. */
    title: ReactNode;
    /** Why it failed, in user-facing words. */
    detail?: ReactNode;
    /** Machine-readable anchor (category, specifier, failing value) in mono type. */
    code?: ReactNode;
    /** The next safe action. */
    hint?: ReactNode;
    /** Test id for the module's own assertions. */
    testId?: string;
    /** Severity announced to assistive tech; `error` alerts, `warning` is a status. */
    tone?: DiagnosticTone;
}
/**
 * ## Diagnostic
 *
 * An actionable failure rendered inside the module region: what failed, why, and what to do
 * next. Context-free, so both the host's module error boundary and a contribution can render
 * the same shape; the header and Board navigation stay usable around it.
 */
export declare function Diagnostic({ title, detail, code, hint, testId, tone, ...rest }: DiagnosticProps): import("react/jsx-runtime").JSX.Element;
