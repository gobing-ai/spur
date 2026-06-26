import React from 'react';

const VARIANT_CLASSES = {
    primary: 'join-item-primary',
    secondary: 'join-item-secondary',
    accent: 'join-item-accent',
    neutral: 'join-item-neutral',
    success: 'join-item-success',
    warning: 'join-item-warning',
    error: 'join-item-error',
    info: 'join-item-info',
} as const;

const ORIENTATION_CLASSES = {
    horizontal: 'join-horizontal',
    vertical: 'join-vertical',
} as const;

type JoinVariant = keyof typeof VARIANT_CLASSES;
type JoinOrientation = keyof typeof ORIENTATION_CLASSES;

export interface JoinProps extends React.HTMLAttributes<HTMLDivElement> {
    /** daisyUI color variant applied to all join items. Default: no variant. */
    variant?: JoinVariant;
    /** Layout orientation. Default: horizontal. */
    orientation?: JoinOrientation;
}

export interface JoinItemProps extends React.HTMLAttributes<HTMLElement> {
    /** Render the assembled `join-item` classes onto a single child element instead of wrapping. */
    asChild?: boolean;
}

/**
 * ## Join / JoinItem
 *
 * Typed wrappers around daisyUI 5's CSS-only `join` / `join-item` classes.
 * Every grouped control in apps/web imports from `@/ui`, never writes
 * `className="join …"` or `className="join-item …"` directly.
 *
 * `Join` renders the `join` container; `JoinItem` renders a `join-item`
 * child. Follows the wrapper conventions established in `Button`.
 */
export function Join({ variant, orientation = 'horizontal', className, children, ...rest }: JoinProps) {
    const classes = [
        'join',
        variant && VARIANT_CLASSES[variant],
        orientation && ORIENTATION_CLASSES[orientation],
        className,
    ]
        .filter(Boolean)
        .join(' ');
    return (
        <div className={classes} {...rest}>
            {children}
        </div>
    );
}

export function JoinItem({ asChild, className, children, ...rest }: JoinItemProps) {
    const classes = ['join-item', className].filter(Boolean).join(' ');

    if (asChild && React.isValidElement(children)) {
        const child = children as React.ReactElement<{ className?: string }>;
        const merged = [classes, child.props.className].filter(Boolean).join(' ');
        return React.cloneElement(child, { className: merged });
    }

    return (
        <span className={classes} {...rest}>
            {children}
        </span>
    );
}
