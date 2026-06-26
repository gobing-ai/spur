import type React from 'react';

const VARIANT_CLASSES = {
    neutral: 'badge-neutral',
    primary: 'badge-primary',
    secondary: 'badge-secondary',
    accent: 'badge-accent',
    ghost: 'badge-ghost',
    info: 'badge-info',
    success: 'badge-success',
    warning: 'badge-warning',
    error: 'badge-error',
    outline: 'badge-outline',
} as const;

const SIZE_CLASSES = {
    xs: 'badge-xs',
    sm: 'badge-sm',
    md: 'badge-md',
    lg: 'badge-lg',
} as const;

type BadgeVariant = keyof typeof VARIANT_CLASSES;
type BadgeSize = keyof typeof SIZE_CLASSES;

export interface BadgeProps extends React.HTMLAttributes<HTMLSpanElement> {
    /** daisyUI color variant. Default: no variant (bare badge). */
    variant?: BadgeVariant;
    /** daisyUI size preset. Default: md (no explicit size class). */
    size?: BadgeSize;
}

/**
 * ## Badge
 *
 * Typed wrapper around daisyUI 5's CSS-only `badge` classes. Every badge in
 * apps/web imports from `@/ui`, never writes `className="badge …"` directly.
 *
 * Follows the wrapper conventions established in `Button`.
 */
export function Badge({ variant, size, className, ...rest }: BadgeProps) {
    const classes = ['badge', variant && VARIANT_CLASSES[variant], size && SIZE_CLASSES[size], className]
        .filter(Boolean)
        .join(' ');
    return <span className={classes} {...rest} />;
}
