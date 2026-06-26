import type React from 'react';

const VARIANT_CLASSES = {
    bordered: 'select-bordered',
    ghost: 'select-ghost',
    primary: 'select-primary',
    secondary: 'select-secondary',
    accent: 'select-accent',
    info: 'select-info',
    success: 'select-success',
    warning: 'select-warning',
    error: 'select-error',
} as const;

const SIZE_CLASSES = {
    xs: 'select-xs',
    sm: 'select-sm',
    md: 'select-md',
    lg: 'select-lg',
} as const;

type SelectVariant = keyof typeof VARIANT_CLASSES;
type SelectSize = keyof typeof SIZE_CLASSES;

export interface SelectProps extends Omit<React.SelectHTMLAttributes<HTMLSelectElement>, 'size'> {
    /** daisyUI border/color variant. Default: no variant (bare select). */
    variant?: SelectVariant;
    /** daisyUI size preset. Default: md (no explicit size class). */
    size?: SelectSize;
}

/**
 * ## Select
 *
 * Typed wrapper around daisyUI 5's CSS-only `select` classes. Every select
 * in apps/web imports from `@/ui`, never writes `className="select …"`
 * directly.
 *
 * Follows the wrapper conventions established in `Button`.
 */
export function Select({ variant, size, className, children, ...rest }: SelectProps) {
    const classes = ['select', variant && VARIANT_CLASSES[variant], size && SIZE_CLASSES[size], className]
        .filter(Boolean)
        .join(' ');
    return (
        <select className={classes} {...rest}>
            {children}
        </select>
    );
}
