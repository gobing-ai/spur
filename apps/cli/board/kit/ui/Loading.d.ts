import type React from 'react';
declare const VARIANT_CLASSES: {
    readonly spinner: "loading-spinner";
    readonly dots: "loading-dots";
    readonly ring: "loading-ring";
    readonly ball: "loading-ball";
    readonly bars: "loading-bars";
    readonly infinity: "loading-infinity";
};
declare const SIZE_CLASSES: {
    readonly xs: "loading-xs";
    readonly sm: "loading-sm";
    readonly md: "loading-md";
    readonly lg: "loading-lg";
    readonly xl: "loading-xl";
};
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
export declare function Loading({ variant, size, className, ...rest }: LoadingProps): import("react/jsx-runtime").JSX.Element;
export {};
