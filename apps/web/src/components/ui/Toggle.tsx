import type React from 'react';

const VARIANT_CLASSES = {
    primary: 'toggle-primary',
    secondary: 'toggle-secondary',
    accent: 'toggle-accent',
    neutral: 'toggle-neutral',
    success: 'toggle-success',
    warning: 'toggle-warning',
    error: 'toggle-error',
    info: 'toggle-info',
} as const;

const SIZE_CLASSES = {
    xs: 'toggle-xs',
    sm: 'toggle-sm',
    md: 'toggle-md',
    lg: 'toggle-lg',
} as const;

type ToggleVariant = keyof typeof VARIANT_CLASSES;
type ToggleSize = keyof typeof SIZE_CLASSES;

export interface ToggleProps extends Omit<React.InputHTMLAttributes<HTMLInputElement>, 'type' | 'size'> {
    /** daisyUI color variant. Default: no variant (bare toggle). */
    variant?: ToggleVariant;
    /** daisyUI size preset. Default: md (no explicit size class). */
    size?: ToggleSize;
}

/**
 * ## Toggle
 *
 * Typed wrapper around daisyUI 5's CSS-only `toggle` classes. Every toggle
 * switch in apps/web imports from `@/ui`, never writes
 * `className="toggle …"` directly.
 *
 * Follows the wrapper conventions established in `Button`.
 */
export function Toggle({ variant, size, className, checked, ...rest }: ToggleProps) {
    const classes = ['toggle', variant && VARIANT_CLASSES[variant], size && SIZE_CLASSES[size], className]
        .filter(Boolean)
        .join(' ');
    return (
        <input type="checkbox" role="switch" aria-checked={checked} className={classes} checked={checked} {...rest} />
    );
}
