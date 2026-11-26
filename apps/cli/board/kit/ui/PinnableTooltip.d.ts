import { type ReactNode } from 'react';
export interface PinnableTooltipProps {
    /** The focusable trigger's content; rendered inside the component's own button. */
    trigger: ReactNode;
    /** Accessible name for the trigger, since the trigger content is often styled text. */
    triggerLabel: string;
    /** Heading shown above the content. */
    title?: ReactNode;
    /** The detail itself. Rendered in the DOM whenever the tooltip is open. */
    children: ReactNode;
    /**
     * Muted line below the content. A function receives the open tooltip's pin state, so a caller
     * can give hover and pinned modes their own guidance (DESIGN.md, System Events).
     */
    footer?: ReactNode | ((state: {
        pinned: boolean;
    }) => ReactNode);
    /** Panel width floor in px; the panel never exceeds 90vw. */
    minWidth?: number;
    /** Applied to the panel, so a caller can keep its existing test ids. */
    testId?: string;
    /** Extra classes for the trigger button, which carries the caller's own typography. */
    triggerClassName?: string;
    /** Extra data attributes for the trigger, e.g. the caller's row identity. */
    triggerTestId?: string;
}
/**
 * Renders one trigger plus its pinnable detail panel.
 *
 * The panel is absolutely positioned under the trigger while previewing and fixed at the click
 * point once pinned (so it stays put while the list scrolls), clamped into the viewport.
 */
export declare function PinnableTooltip({ trigger, triggerLabel, title, children, footer, minWidth, testId, triggerClassName, triggerTestId, }: PinnableTooltipProps): import("react/jsx-runtime").JSX.Element;
