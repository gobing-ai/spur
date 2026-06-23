import { useCallback, useRef } from 'react';

interface Props {
    targetVar: string;
    onResizeEnd: (px: number) => void;
    direction?: 'horizontal' | 'vertical';
    /** Negate the delta — use when the handle is on the left/top edge of a right/bottom-anchored panel. */
    invert?: boolean;
}

export default function ResizeHandle({ targetVar, onResizeEnd, direction = 'horizontal', invert = false }: Props) {
    const startRef = useRef<{ x: number; y: number; w: number } | null>(null);

    const onPointerDown = useCallback(
        (e: React.PointerEvent) => {
            e.preventDefault();
            const root = document.documentElement;
            const computed = getComputedStyle(root);
            const raw = computed.getPropertyValue(targetVar).trim();
            const currentPx = parseFloat(raw) || 0;

            startRef.current = { x: e.clientX, y: e.clientY, w: currentPx };
            (e.target as HTMLElement).setPointerCapture(e.pointerId);

            const onMove = (ev: PointerEvent) => {
                if (!startRef.current) return;
                const rawDelta =
                    direction === 'horizontal' ? ev.clientX - startRef.current.x : ev.clientY - startRef.current.y;
                const delta = invert ? -rawDelta : rawDelta;
                const next = Math.max(0, startRef.current.w + delta);
                root.style.setProperty(targetVar, `${next}px`);
            };

            const onUp = () => {
                if (!startRef.current) return;
                const finalRaw = getComputedStyle(root).getPropertyValue(targetVar).trim();
                const finalPx = parseFloat(finalRaw) || startRef.current.w;
                onResizeEnd(Math.round(finalPx));
                startRef.current = null;
                window.removeEventListener('pointermove', onMove);
                window.removeEventListener('pointerup', onUp);
            };

            window.addEventListener('pointermove', onMove);
            window.addEventListener('pointerup', onUp, { once: true });
        },
        [targetVar, onResizeEnd, direction, invert],
    );

    const isHorizontal = direction === 'horizontal';
    return (
        <hr
            data-testid={`resize-handle-${isHorizontal ? 'h' : 'v'}`}
            aria-orientation={isHorizontal ? 'vertical' : 'horizontal'}
            aria-label={isHorizontal ? 'Resize sidebar' : 'Resize panel'}
            tabIndex={0}
            className="resize-handle shrink-0 bg-spur-border hover:bg-spur-accent cursor-col-resize transition-colors border-0"
            style={{ width: isHorizontal ? 4 : '100%', height: isHorizontal ? '100%' : 4, margin: 0 }}
            onPointerDown={onPointerDown}
        />
    );
}
