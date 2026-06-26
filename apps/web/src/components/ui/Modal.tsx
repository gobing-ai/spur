import type React from 'react';

const VARIANT_CLASSES = {
    primary: 'modal-primary',
    secondary: 'modal-secondary',
    accent: 'modal-accent',
    neutral: 'modal-neutral',
    success: 'modal-success',
    warning: 'modal-warning',
    error: 'modal-error',
    info: 'modal-info',
} as const;

type ModalVariant = keyof typeof VARIANT_CLASSES;

export interface ModalProps extends React.HTMLAttributes<HTMLDivElement> {
    /** daisyUI color variant for the modal box. Default: no variant. */
    variant?: ModalVariant;
    /** Controls visibility. When false, renders nothing. */
    open: boolean;
    /** Called when the user requests dismissal (backdrop click or Escape). */
    onClose?: () => void;
}

/**
 * ## Modal
 *
 * Typed wrapper around daisyUI 5's CSS-only `modal` classes. Every modal in
 * apps/web imports from `@/ui`, never writes `className="modal …"` directly.
 *
 * Renders the daisyUI `modal` + `modal-box` structure: an outer `modal`
 * div (the backdrop/dialog container) and an inner `modal-box` div for
 * content. Use `open` to toggle visibility and `onClose` for dismissal.
 *
 * Follows the wrapper conventions established in `Button`.
 */
export function Modal({ variant, open: isOpen, onClose, className, children, ...rest }: ModalProps) {
    if (!isOpen) return null;

    const boxClasses = ['modal-box', variant && VARIANT_CLASSES[variant], className].filter(Boolean).join(' ');

    return (
        <div
            className="modal modal-open"
            role="dialog"
            aria-modal="true"
            tabIndex={-1}
            onClick={onClose}
            onKeyDown={(e) => {
                if (e.key === 'Escape') onClose?.();
            }}
            {...rest}
        >
            {/* biome-ignore lint/a11y/noStaticElementInteractions: stopPropagation on the modal-box is not an action */}
            <div className={boxClasses} onClick={(e) => e.stopPropagation()} onKeyDown={(e) => e.stopPropagation()}>
                {children}
            </div>
        </div>
    );
}
