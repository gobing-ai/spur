import type React from 'react';

const VARIANT_CLASSES = {
    bordered: 'input-bordered',
    ghost: 'input-ghost',
    primary: 'input-primary',
    secondary: 'input-secondary',
    accent: 'input-accent',
    info: 'input-info',
    success: 'input-success',
    warning: 'input-warning',
    error: 'input-error',
} as const;

const SIZE_CLASSES = {
    xs: 'input-xs',
    sm: 'input-sm',
    md: 'input-md',
    lg: 'input-lg',
    xl: 'input-xl',
} as const;

type InputVariant = keyof typeof VARIANT_CLASSES;
type InputSize = keyof typeof SIZE_CLASSES;

export interface InputProps extends Omit<React.InputHTMLAttributes<HTMLInputElement>, 'size'> {
    /** daisyUI border/color variant. Default: no variant (bare input). */
    variant?: InputVariant;
    /** daisyUI size preset. Default: md (no explicit size class). */
    size?: InputSize;
    /** Show error state — adds `input-error` alongside the variant. */
    error?: boolean;
}

/**
 * ## Input
 *
 * Typed wrapper around daisyUI 5's CSS-only `input` classes. Every text input
 * in apps/web imports from `@/ui`, never writes `className="input …"`
 * directly.
 *
 * Follows the wrapper conventions established in `Button`.
 */
export function Input({ variant, size, error, className, ...rest }: InputProps) {
    const classes = [
        'input',
        variant && VARIANT_CLASSES[variant],
        size && SIZE_CLASSES[size],
        error && 'input-error',
        className,
    ]
        .filter(Boolean)
        .join(' ');
    return <input className={classes} {...rest} />;
}
