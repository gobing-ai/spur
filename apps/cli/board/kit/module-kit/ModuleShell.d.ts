import type React from 'react';
import type { ReactNode } from 'react';
/** Page container for a Board module: the ADR-081 centered rail and dense module padding. */
export interface ModuleShellProps extends React.HTMLAttributes<HTMLDivElement> {
    children: ReactNode;
    /**
     * Replaces nothing and appends: pass extra layout classes here. A density-first board body
     * passes `max-w-none` to take the full-bleed exception while its header keeps the rail.
     */
    className?: string;
}
/**
 * ## ModuleShell
 *
 * The one page container every Board module shell renders into: `p-4` padding,
 * `gap-4` between regions and the centered `max-w-[1600px]` rail (ADR-081).
 * Presentational only — no router, rpc, registry or theme context.
 */
export declare function ModuleShell({ children, className, ...rest }: ModuleShellProps): import("react/jsx-runtime").JSX.Element;
