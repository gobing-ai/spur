import type React from 'react';
declare const VARIANT_CLASSES: {
    readonly neutral: "badge-neutral";
    readonly primary: "badge-primary";
    readonly secondary: "badge-secondary";
    readonly accent: "badge-accent";
    readonly ghost: "badge-ghost";
    readonly info: "badge-info";
    readonly success: "badge-success";
    readonly warning: "badge-warning";
    readonly error: "badge-error";
    readonly outline: "badge-outline";
};
declare const SIZE_CLASSES: {
    readonly xs: "badge-xs";
    readonly sm: "badge-sm";
    readonly md: "badge-md";
    readonly lg: "badge-lg";
};
type BadgeVariant = keyof typeof VARIANT_CLASSES;
type BadgeSize = keyof typeof SIZE_CLASSES;
export interface BadgeProps extends React.HTMLAttributes<HTMLSpanElement> {
    /** Badge content — React 19 no longer implies a `children` prop. */
    children?: React.ReactNode;
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
export declare function Badge({ variant, size, className, ...rest }: BadgeProps): import("react/jsx-runtime").JSX.Element;
export {};
