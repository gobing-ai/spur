import type { ReactNode } from 'react';
/** Slots of the one-row module header (ADR-081: identity left, filters middle, tab strip right). */
export interface ModuleHeaderProps {
    /** Identity icon, e.g. `<ModuleIcon id={moduleId} size="lg" />` (ADR-133). */
    icon: ReactNode;
    /** Module title — rendered as the route's only `h1`. */
    title: string;
    /** Optional one-line purpose under the title. */
    subtitle?: ReactNode;
    /** Optional status chip (a `role="status"` element owned by the module). */
    status?: ReactNode;
    /** Inline filters and range presets, centred between identity and tabs. */
    filters?: ReactNode;
    /** The tab strip, rendered right-aligned. */
    tabs?: ReactNode;
    /** Extra classes on the header row. */
    className?: string;
}
/**
 * ## ModuleHeader
 *
 * The single header row a module shell owns: identity block, inline filters and tab
 * strip, separated by a hairline. Everything it renders is a slot, so the header carries
 * no module state and no host context.
 */
export declare function ModuleHeader({ icon, title, subtitle, status, filters, tabs, className }: ModuleHeaderProps): import("react/jsx-runtime").JSX.Element;
