import type React from 'react';
declare const VARIANT_CLASSES: {
    readonly primary: "btn-primary";
    readonly ghost: "btn-ghost";
    readonly error: "btn-error";
    readonly outline: "btn-outline";
    readonly accent: "btn-accent";
    readonly warning: "btn-warning";
};
declare const SIZE_CLASSES: {
    readonly xs: "btn-xs";
    readonly sm: "btn-sm";
    readonly md: "btn-md";
    readonly lg: "btn-lg";
};
type ButtonVariant = keyof typeof VARIANT_CLASSES;
type ButtonSize = keyof typeof SIZE_CLASSES;
export interface ButtonProps extends React.ButtonHTMLAttributes<HTMLButtonElement> {
    /** Button label — React 19 no longer implies a `children` prop. */
    children?: React.ReactNode;
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
export declare function Button({ variant, size, loading, asChild, className, disabled, children, ...rest }: ButtonProps): import("react/jsx-runtime").JSX.Element;
export {};
