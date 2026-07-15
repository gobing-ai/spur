import React from 'react';

const VARIANT_CLASSES = {
    primary: 'btn-primary',
    ghost: 'btn-ghost',
    error: 'btn-error',
    outline: 'btn-outline',
    accent: 'btn-accent',
    warning: 'btn-warning',
} as const;

const SIZE_CLASSES = {
    xs: 'btn-xs',
    sm: 'btn-sm',
    md: 'btn-md',
    lg: 'btn-lg',
} as const;

type ButtonVariant = keyof typeof VARIANT_CLASSES;
type ButtonSize = keyof typeof SIZE_CLASSES;

export interface ButtonProps extends React.ButtonHTMLAttributes<HTMLButtonElement> {
    /** daisyUI color variant. Default: no variant (bare btn). */
    variant?: ButtonVariant;
    /** daisyUI size preset. Default: md (no explicit size class). */
    size?: ButtonSize;
    /** Show a loading spinner. Maps to daisyUI's `btn` loading state. */
    loading?: boolean;
    /**
     * Render the assembled `btn` classes onto the single child element instead
     * of a `<button>` — e.g. wrap an `<a>` to get a link styled as a button.
     * The child receives the merged className; `loading`/`disabled` button-only
     * behavior is not applied in this mode.
     */
    asChild?: boolean;
}

/**
 * ## Button
 *
 * Typed wrapper around daisyUI 5's CSS-only `btn` classes. This is the
 * **single source of truth** for `btn` class assembly in the app — every
 * button in apps/web imports from `@/ui`, never writes `className="btn …"`
 * directly.
 *
 * ### Wrapper authoring conventions (the template for subsequent wrappers)
 *
 * 1. **Prop naming** — use daisyUI's own terminology: `variant`, `size`,
 *    `loading`. No abbreviations unless daisyUI itself abbreviates.
 * 2. **className passthrough** — the `className` prop (inherited from
 *    `ButtonHTMLAttributes`) is for **layout/positioning utilities only**
 *    (Tailwind spacing, flex, responsive visibility). Component-level
 *    classes (`btn`, `btn-primary`, …) are assembled internally and MUST
 *    NOT leak to callers.
 * 3. **Layout vs. component boundary** — tailwind classes like `ml-2`,
 *    `w-full`, `hidden`, `md:inline-flex` are layout concerns; they belong
 *    at the call site via `className`. daisyUI classes like `btn-primary`,
 *    `btn-sm` are component concerns; they belong inside the wrapper.
 * 4. **Never use `btn` raw** — no file outside `components/ui/` may write
 *    `className="btn"` or `className="btn-*"`.
 */
export function Button({ variant, size, loading, asChild, className, disabled, children, ...rest }: ButtonProps) {
    const classes = ['btn', variant && VARIANT_CLASSES[variant], size && SIZE_CLASSES[size], className]
        .filter(Boolean)
        .join(' ');

    if (asChild && React.isValidElement(children)) {
        const child = children as React.ReactElement<{ className?: string }>;
        const merged = [classes, child.props.className].filter(Boolean).join(' ');
        return React.cloneElement(child, { className: merged });
    }

    return (
        <button className={classes} disabled={disabled || loading} {...rest}>
            {loading && <span className="loading loading-spinner" />}
            {children}
        </button>
    );
}
