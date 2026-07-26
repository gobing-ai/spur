import type React from 'react';

const POSITION_CLASSES = {
    top: 'tooltip-top',
    bottom: 'tooltip-bottom',
    left: 'tooltip-left',
    right: 'tooltip-right',
} as const;

type TooltipPosition = keyof typeof POSITION_CLASSES;

export interface TooltipProps extends React.HTMLAttributes<HTMLSpanElement> {
    /** Position of the tooltip bubble relative to its trigger. Default: daisyUI's `top`. */
    position?: TooltipPosition;
    /** Tooltip text. Rendered as `data-tip`; daisyUI surfaces it via CSS `content: attr(data-tip)`. */
    tip?: string;
}

/**
 * ## Tooltip
 *
 * Typed wrapper around daisyUI 5's CSS-only `tooltip` utility. Every tooltip in
 * apps/web imports from `@/ui`, never writes `className="tooltip …"` directly.
 *
 * The wrapper is a presentational `<span>` host: callers compose layout utilities
 * (e.g. `flex! w-4 shrink-0`) on it to override daisyUI's default `display:inline-block`
 * when wrapping non-inline content. The accessible name is NOT carried by the
 * tooltip — daisyUI's `content: attr(data-tip)` is CSS-only and contributes no
 * accessible name; the wrapped element must name itself (e.g. an inner `role="img"`
 * with `aria-label`), as required by ADR-034 and task 0336's contract.
 *
 * Follows the wrapper conventions established in `Badge`.
 */
export function Tooltip({ position, tip, className, ...rest }: TooltipProps) {
    const classes = ['tooltip', position && POSITION_CLASSES[position], className].filter(Boolean).join(' ');
    return <span className={classes} data-tip={tip} {...rest} />;
}
