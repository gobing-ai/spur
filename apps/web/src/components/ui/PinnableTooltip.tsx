import type { HTMLAttributes, ReactNode } from 'react';
import { useCallback, useEffect, useId, useRef, useState } from 'react';

/**
 * The pinnable semantic tooltip (A821 R1, DESIGN.md "Pinnable tooltip").
 *
 * One interaction contract for every in-place detail surface: hover and keyboard focus open the
 * same content, activation pins it so its text can be selected and copied, Escape or a click
 * outside closes it, and opening one pinned tooltip releases the previous one. It is deliberately
 * not `ui/Tooltip` — that one is a non-interactive label with different a11y semantics.
 *
 * The caller owns the CONTENT; this component owns only state, positioning and semantics.
 */

/** How long a pointer may leave the trigger and the panel before the hover preview closes. */
const HOVER_GRACE_MS = 150;

/** A pin click must not be read as an outside click by the listener it installs. */
const IGNORE_OUTSIDE_MS = 400;

/**
 * The one pinned tooltip per document. A module-scoped callback rather than context or a store:
 * the release is a single slot, and a store would need a provider in every tree that renders one.
 */
let releasePinned: (() => void) | null = null;

export interface PinnableTooltipProps {
    /** The focusable trigger's content; rendered inside the component's own button. */
    trigger: ReactNode;
    /** Accessible name for the trigger, since the trigger content is often styled text. */
    triggerLabel: string;
    /** Heading shown above the content. */
    title?: ReactNode;
    /** The detail itself. Rendered in the DOM whenever the tooltip is open. */
    children: ReactNode;
    /**
     * Muted line below the content. A function receives the open tooltip's pin state, so a caller
     * can give hover and pinned modes their own guidance (DESIGN.md, System Events).
     */
    footer?: ReactNode | ((state: { pinned: boolean }) => ReactNode);
    /** Panel width floor in px; the panel never exceeds 90vw. */
    minWidth?: number;
    /** Applied to the panel, so a caller can keep its existing test ids. */
    testId?: string;
    /** Extra classes for the trigger button, which carries the caller's own typography. */
    triggerClassName?: string;
    /** Extra data attributes for the trigger, e.g. the caller's row identity. */
    triggerTestId?: string;
}

/**
 * Renders one trigger plus its pinnable detail panel.
 *
 * The panel is absolutely positioned under the trigger while previewing and fixed at the click
 * point once pinned (so it stays put while the list scrolls), clamped into the viewport.
 */
export function PinnableTooltip({
    trigger,
    triggerLabel,
    title,
    children,
    footer,
    minWidth = 400,
    testId,
    triggerClassName,
    triggerTestId,
}: PinnableTooltipProps) {
    const [hovering, setHovering] = useState(false);
    const [pinned, setPinned] = useState(false);
    const [pinPos, setPinPos] = useState<{ x: number; y: number } | null>(null);
    const panelRef = useRef<HTMLDivElement>(null);
    const triggerRef = useRef<HTMLButtonElement>(null);
    const ignoreOutsideUntilRef = useRef(0);
    const hoverLeaveTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
    const contentId = useId();
    const open = hovering || pinned;

    const footerContent = typeof footer === 'function' ? footer({ pinned }) : footer;

    const clearHoverLeaveTimer = useCallback(() => {
        if (hoverLeaveTimerRef.current !== null) {
            clearTimeout(hoverLeaveTimerRef.current);
            hoverLeaveTimerRef.current = null;
        }
    }, []);

    const release = useCallback(() => {
        setPinned(false);
        setPinPos(null);
    }, []);

    const show = useCallback(() => {
        clearHoverLeaveTimer();
        setHovering(true);
    }, [clearHoverLeaveTimer]);

    const scheduleHide = useCallback(() => {
        if (pinned) return;
        clearHoverLeaveTimer();
        hoverLeaveTimerRef.current = setTimeout(() => setHovering(false), HOVER_GRACE_MS);
    }, [clearHoverLeaveTimer, pinned]);

    /** Pin at the trigger's own rect, clamped so the panel never leaves the viewport. */
    const pin = useCallback(() => {
        const rect = triggerRef.current?.getBoundingClientRect();
        if (rect === undefined) return;
        ignoreOutsideUntilRef.current = performance.now() + IGNORE_OUTSIDE_MS;
        if (releasePinned !== null && releasePinned !== release) releasePinned();
        releasePinned = release;
        setPinned(true);
        setHovering(false);
        clearHoverLeaveTimer();
        setPinPos({
            x: Math.max(8, Math.min(rect.left, globalThis.innerWidth - minWidth - 8)),
            y: rect.bottom + 6,
        });
    }, [clearHoverLeaveTimer, minWidth, release]);

    const togglePin = useCallback(() => {
        if (pinned) {
            if (releasePinned === release) releasePinned = null;
            release();
            return;
        }
        pin();
    }, [pin, pinned, release]);

    // Claim the one pinned slot while open (`pin` releases whoever held it), handing it back on
    // release so only one tooltip stays pinned per document.
    useEffect(() => {
        if (!pinned) return;
        const previous = releasePinned;
        releasePinned = release;
        return () => {
            if (releasePinned === release) releasePinned = previous;
        };
    }, [pinned, release]);

    // While pinned: an outside pointerdown or Escape releases it.
    useEffect(() => {
        if (!pinned) return;
        const onPointerDown = (event: PointerEvent) => {
            if (performance.now() < ignoreOutsideUntilRef.current) return;
            if (panelRef.current?.contains(event.target as Node)) return;
            if (triggerRef.current?.contains(event.target as Node)) return;
            if (releasePinned === release) releasePinned = null;
            release();
        };
        const onKeyDown = (event: KeyboardEvent) => {
            if (event.key !== 'Escape') return;
            if (releasePinned === release) releasePinned = null;
            release();
            event.stopPropagation();
        };
        document.addEventListener('pointerdown', onPointerDown, true);
        document.addEventListener('keydown', onKeyDown, true);
        return () => {
            document.removeEventListener('pointerdown', onPointerDown, true);
            document.removeEventListener('keydown', onKeyDown, true);
        };
    }, [pinned, release]);

    useEffect(
        () => () => {
            clearHoverLeaveTimer();
            if (releasePinned === release) releasePinned = null;
        },
        [clearHoverLeaveTimer, release],
    );

    // One panel, two statically-roled wrappers: `dialog` while pinned, `tooltip` while
    // previewing. The handlers/style/content are shared so the branches cannot drift.
    const panelHandlers: Pick<
        HTMLAttributes<HTMLDivElement>,
        'onMouseEnter' | 'onMouseLeave' | 'onFocusCapture' | 'onBlurCapture' | 'onPointerDown'
    > = {
        onMouseEnter: show,
        onMouseLeave: scheduleHide,
        onFocusCapture: show,
        onBlurCapture: (event) => {
            if (pinned) return;
            if (!event.currentTarget.contains(event.relatedTarget as Node | null)) setHovering(false);
        },
        onPointerDown: (event) => {
            // A pointerdown inside the pinned panel must not read as the outside click that closes it.
            if (pinned) event.stopPropagation();
        },
    };

    const panelStyle = {
        minWidth: `min(${minWidth}px, 90vw)`,
        maxWidth: 'min(840px, 95vw)',
        ...(pinned && pinPos !== null ? { top: pinPos.y, left: pinPos.x } : {}),
    };

    const panelContent = (
        <>
            {title === undefined ? null : (
                <div className="text-[11px] font-sans font-semibold text-[#c9d1d9] truncate mb-1.5">{title}</div>
            )}
            {children}
            {footerContent === undefined || footerContent === null ? null : (
                <div className="mt-2 border-t border-[#30363d] pt-1.5 text-[10px] text-[#8b949e] font-sans">
                    {footerContent}
                </div>
            )}
        </>
    );

    return (
        <span className="relative inline-flex min-w-0 max-w-full">
            <button
                ref={triggerRef}
                type="button"
                className={triggerClassName}
                {...(triggerTestId === undefined ? {} : { 'data-testid': triggerTestId })}
                aria-label={triggerLabel}
                aria-describedby={open ? contentId : undefined}
                aria-expanded={pinned}
                aria-haspopup="dialog"
                onMouseEnter={show}
                onMouseLeave={scheduleHide}
                onFocus={show}
                onBlur={(event) => {
                    if (pinned) return;
                    if (!panelRef.current?.contains(event.relatedTarget as Node | null)) setHovering(false);
                }}
                onClick={(event) => {
                    event.preventDefault();
                    event.stopPropagation();
                    togglePin();
                }}
            >
                {trigger}
            </button>
            {open ? (
                pinned ? (
                    <div
                        ref={panelRef}
                        id={contentId}
                        role="dialog"
                        data-pinned="true"
                        {...(testId === undefined ? {} : { 'data-testid': testId })}
                        className="pointer-events-auto fixed z-50 rounded shadow-lg p-2.5 text-[11px] whitespace-normal border border-[#30363d] bg-[#0d1117] text-[#c9d1d9] select-text cursor-text"
                        style={panelStyle}
                        {...panelHandlers}
                    >
                        {panelContent}
                    </div>
                ) : (
                    <div
                        ref={panelRef}
                        id={contentId}
                        role="tooltip"
                        data-pinned="false"
                        {...(testId === undefined ? {} : { 'data-testid': testId })}
                        className="pointer-events-auto absolute left-0 top-full mt-1 z-30 rounded shadow-lg p-2.5 text-[11px] whitespace-normal border border-[#30363d] bg-[#0d1117] text-[#c9d1d9]"
                        style={panelStyle}
                        {...panelHandlers}
                    >
                        {panelContent}
                    </div>
                )
            ) : null}
        </span>
    );
}
