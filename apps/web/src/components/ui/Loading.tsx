import type React from 'react';

const VARIANT_CLASSES = {
    spinner: 'loading-spinner',
    dots: 'loading-dots',
    ring: 'loading-ring',
    ball: 'loading-ball',
    bars: 'loading-bars',
    infinity: 'loading-infinity',
} as const;

const SIZE_CLASSES = {
    xs: 'loading-xs',
    sm: 'loading-sm',
    md: 'loading-md',
    lg: 'loading-lg',
    xl: 'loading-xl',
} as const;

type LoadingVariant = keyof typeof VARIANT_CLASSES;
type LoadingSize = keyof typeof SIZE_CLASSES;

export interface LoadingProps extends React.HTMLAttributes<HTMLSpanElement> {
    /** daisyUI loading animation type. Default: spinner. */
    variant?: LoadingVariant;
    /** daisyUI size preset. Default: md (no explicit size class). */
    size?: LoadingSize;
}

/**
 * ## Loading
 *
 * Typed wrapper around daisyUI 5's CSS-only `loading` classes. Every loading
 * indicator in apps/web imports from `@/ui`, never writes
 * `className="loading …"` directly.
 *
 * Follows the wrapper conventions established in `Button`.
 */
export function Loading({ variant = 'spinner', size, className, ...rest }: LoadingProps) {
    const classes = ['loading', VARIANT_CLASSES[variant], size && SIZE_CLASSES[size], className]
        .filter(Boolean)
        .join(' ');
    return <span className={classes} {...rest} />;
}
