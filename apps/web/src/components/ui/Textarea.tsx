import type React from 'react';

const VARIANT_CLASSES = {
    bordered: 'textarea-bordered',
    ghost: 'textarea-ghost',
    primary: 'textarea-primary',
    secondary: 'textarea-secondary',
    accent: 'textarea-accent',
    info: 'textarea-info',
    success: 'textarea-success',
    warning: 'textarea-warning',
    error: 'textarea-error',
} as const;

const SIZE_CLASSES = {
    xs: 'textarea-xs',
    sm: 'textarea-sm',
    md: 'textarea-md',
    lg: 'textarea-lg',
    xl: 'textarea-xl',
} as const;

type TextareaVariant = keyof typeof VARIANT_CLASSES;
type TextareaSize = keyof typeof SIZE_CLASSES;

export interface TextareaProps extends React.TextareaHTMLAttributes<HTMLTextAreaElement> {
    /** daisyUI border/color variant. Default: no variant (bare textarea). */
    variant?: TextareaVariant;
    /** daisyUI size preset. Default: md (no explicit size class). */
    size?: TextareaSize;
    /** Show error state — adds `textarea-error` alongside the variant. */
    error?: boolean;
}

/**
 * ## Textarea
 *
 * Typed wrapper around daisyUI 5's CSS-only `textarea` classes. Every textarea
 * in apps/web imports from `@/ui`, never writes `className="textarea …"`
 * directly.
 *
 * Follows the wrapper conventions established in `Button`.
 */
export function Textarea({ variant, size, error, className, ...rest }: TextareaProps) {
    const classes = [
        'textarea',
        variant && VARIANT_CLASSES[variant],
        size && SIZE_CLASSES[size],
        error && 'textarea-error',
        className,
    ]
        .filter(Boolean)
        .join(' ');
    return <textarea className={classes} {...rest} />;
}
