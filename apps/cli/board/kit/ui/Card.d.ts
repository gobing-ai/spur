import type React from 'react';
declare const VARIANT_CLASSES: {
    readonly bordered: "card-bordered";
    readonly primary: "card-primary";
    readonly secondary: "card-secondary";
    readonly accent: "card-accent";
    readonly neutral: "card-neutral";
    readonly imagefull: "card-image-full";
    readonly compact: "card-compact";
    readonly normal: "card-normal";
    readonly side: "card-side";
};
type CardVariant = keyof typeof VARIANT_CLASSES;
export interface CardProps extends React.HTMLAttributes<HTMLDivElement> {
    /** Card content — React 19 no longer implies a `children` prop. */
    children?: React.ReactNode;
    /** daisyUI variant (border style, layout density, orientation). */
    variant?: CardVariant;
    /** Render the assembled `card` classes onto a single child element instead of a `<div>`. */
    asChild?: boolean;
}
/**
 * ## Card / CardBody
 *
 * Typed wrappers around daisyUI 5's CSS-only `card` / `card-body` classes.
 * Every card in apps/web imports from `@/ui`, never writes
 * `className="card …"` or `className="card-body …"` directly.
 *
 * `Card` renders the outer `card` container; `CardBody` renders the inner
 * `card-body` content area. Follows the wrapper conventions established in
 * `Button`.
 */
export declare function Card({ variant, asChild, className, children, ...rest }: CardProps): import("react/jsx-runtime").JSX.Element;
export interface CardBodyProps extends React.HTMLAttributes<HTMLDivElement> {
}
/** Inner content area of a `Card`. Renders the `card-body` class. */
export declare function CardBody({ className, ...rest }: CardBodyProps): import("react/jsx-runtime").JSX.Element;
export {};
