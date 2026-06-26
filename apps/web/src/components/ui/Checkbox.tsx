import type React from 'react';

const VARIANT_CLASSES = {
    primary: 'checkbox-primary',
    secondary: 'checkbox-secondary',
    accent: 'checkbox-accent',
    neutral: 'checkbox-neutral',
    success: 'checkbox-success',
    warning: 'checkbox-warning',
    error: 'checkbox-error',
    info: 'checkbox-info',
} as const;

const SIZE_CLASSES = {
    xs: 'checkbox-xs',
    sm: 'checkbox-sm',
    md: 'checkbox-md',
    lg: 'checkbox-lg',
} as const;

type CheckboxVariant = keyof typeof VARIANT_CLASSES;
type CheckboxSize = keyof typeof SIZE_CLASSES;

export interface CheckboxProps extends Omit<React.InputHTMLAttributes<HTMLInputElement>, 'type' | 'size'> {
    /** daisyUI color variant. Default: no variant (bare checkbox). */
    variant?: CheckboxVariant;
    /** daisyUI size preset. Default: md (no explicit size class). */
    size?: CheckboxSize;
}

/**
 * ## Checkbox
 *
 * Typed wrapper around daisyUI 5's CSS-only `checkbox` classes. Every
 * checkbox in apps/web imports from `@/ui`, never writes
 * `className="checkbox …"` directly.
 *
 * Follows the wrapper conventions established in `Button`.
 */
export function Checkbox({ variant, size, className, ...rest }: CheckboxProps) {
    const classes = ['checkbox', variant && VARIANT_CLASSES[variant], size && SIZE_CLASSES[size], className]
        .filter(Boolean)
        .join(' ');
    return <input type="checkbox" className={classes} {...rest} />;
}
