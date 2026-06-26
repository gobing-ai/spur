import React from 'react';

const VARIANT_CLASSES = {
    bordered: 'card-bordered',
    primary: 'card-primary',
    secondary: 'card-secondary',
    accent: 'card-accent',
    neutral: 'card-neutral',
    imagefull: 'card-image-full',
    compact: 'card-compact',
    normal: 'card-normal',
    side: 'card-side',
} as const;

type CardVariant = keyof typeof VARIANT_CLASSES;

export interface CardProps extends React.HTMLAttributes<HTMLDivElement> {
    /** daisyUI variant (border style, layout density, orientation). */
    variant?: CardVariant;
    /** Render the assembled `card` classes onto a single child element instead of a `<div>`. */
    asChild?: boolean;
}

/**
 * ## Card / CardBody
 *
 * Typed wrappers around daisyUI 5's CSS-only `card` / `card-body` classes.
 * Every card in apps/web imports from `@/ui`, never writes
 * `className="card …"` or `className="card-body …"` directly.
 *
 * `Card` renders the outer `card` container; `CardBody` renders the inner
 * `card-body` content area. Follows the wrapper conventions established in
 * `Button`.
 */
export function Card({ variant, asChild, className, children, ...rest }: CardProps) {
    const classes = ['card', variant && VARIANT_CLASSES[variant], className].filter(Boolean).join(' ');

    if (asChild && React.isValidElement(children)) {
        const child = children as React.ReactElement<{ className?: string }>;
        const merged = [classes, child.props.className].filter(Boolean).join(' ');
        return React.cloneElement(child, { className: merged });
    }

    return (
        <div className={classes} {...rest}>
            {children}
        </div>
    );
}

export interface CardBodyProps extends React.HTMLAttributes<HTMLDivElement> {}

/** Inner content area of a `Card`. Renders the `card-body` class. */
export function CardBody({ className, ...rest }: CardBodyProps) {
    const classes = ['card-body', className].filter(Boolean).join(' ');
    return <div className={classes} {...rest} />;
}
