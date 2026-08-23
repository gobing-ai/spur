import type { HistoryTimelineBlock } from '@gobing-ai/spur-contracts';
import type React from 'react';
import { useId, useMemo } from 'react';
import { fmtTok } from './charts';

export interface TimelineScrubberProps {
    blocks: HistoryTimelineBlock[];
    start: string | null;
    end: string | null;
    onJumpToTime?: (timestamp: string) => void;
}

export const TimelineScrubber: React.FC<TimelineScrubberProps> = ({ blocks, start, end, onJumpToTime }) => {
    const scrubberId = useId();

    const { bins, maxBinTokens, maxBinOperations, startMs, endMs, hasValidRange } = useMemo(() => {
        if (!start || !end || blocks.length === 0) {
            return { bins: [], maxBinTokens: 0, maxBinOperations: 0, startMs: 0, endMs: 0, hasValidRange: false };
        }
        const sMs = Date.parse(start);
        const eMs = Date.parse(end);
        if (Number.isNaN(sMs) || Number.isNaN(eMs) || eMs < sMs) {
            return { bins: [], maxBinTokens: 0, maxBinOperations: 0, startMs: 0, endMs: 0, hasValidRange: false };
        }

        const binCount = 96;
        const spanMs = Math.max(1, eMs - sMs);
        const binWidthMs = spanMs / binCount;

        const binList = Array.from({ length: binCount }, (_, i) => ({
            index: i,
            timeMs: sMs + i * binWidthMs,
            tokens: 0,
            operations: 0,
        }));

        for (const block of blocks) {
            if (!block.timestamp) continue;
            const bMs = Date.parse(block.timestamp);
            if (Number.isNaN(bMs) || bMs < sMs || bMs > eMs) continue;
            const idx = Math.min(binCount - 1, Math.max(0, Math.floor((bMs - sMs) / binWidthMs)));
            const b = binList[idx];
            if (b) {
                b.tokens += block.totalTokens;
                b.operations += block.operationCount;
            }
        }

        const maxTokens = Math.max(1, ...binList.map((b) => b.tokens));
        const maxOperations = Math.max(1, ...binList.map((b) => b.operations));

        return {
            bins: binList,
            maxBinTokens: maxTokens,
            maxBinOperations: maxOperations,
            startMs: sMs,
            endMs: eMs,
            hasValidRange: true,
        };
    }, [blocks, start, end]);

    if (!hasValidRange || bins.length === 0) {
        return null;
    }

    return (
        <div
            data-testid="timeline-scrubber"
            className="flex flex-col gap-1.5 p-3 bg-base-200/80 rounded-xl border border-base-content/10 font-mono text-xs"
        >
            <div className="flex items-center justify-between text-[11px] text-base-content/60 px-1">
                <span>Timeline Activity ({bins.length} bins)</span>
                <span>Peak: {fmtTok(maxBinTokens)}</span>
            </div>

            {/* SVG Activity Histogram */}
            <div className="relative h-10 w-full bg-base-300/60 rounded-lg overflow-hidden flex items-end p-1">
                <svg
                    viewBox="0 0 96 32"
                    preserveAspectRatio="none"
                    className="w-full h-full text-primary/70"
                    aria-hidden="true"
                >
                    {bins.map((bin) => {
                        const height =
                            bin.operations > 0 ? Math.max(2, Math.round((bin.operations / maxBinOperations) * 30)) : 0;
                        const opacity = bin.tokens > 0 ? 0.35 + (bin.tokens / maxBinTokens) * 0.65 : 0.25;
                        const y = 32 - height;
                        return (
                            <rect
                                key={bin.index}
                                x={bin.index}
                                y={y}
                                width="0.85"
                                height={height}
                                fill="currentColor"
                                fillOpacity={opacity}
                                data-operations={bin.operations}
                                data-tokens={bin.tokens}
                                className="hover:text-cyan-400 transition-colors"
                            >
                                <title>
                                    {`${new Date(bin.timeMs).toISOString()} · ${fmtTok(bin.tokens)} · ${bin.operations} ops`}
                                </title>
                            </rect>
                        );
                    })}
                </svg>
            </div>

            {/* Accessible Range Input */}
            <label htmlFor={scrubberId} className="sr-only">
                Timeline scrub slider
            </label>
            <input
                id={scrubberId}
                type="range"
                min={startMs}
                max={endMs}
                defaultValue={startMs}
                aria-label="Timeline navigation scrubber"
                data-testid="timeline-scrubber-range"
                className="w-full range range-xs range-primary cursor-pointer accent-primary"
                onInput={(e) => {
                    const timeMs = Number(e.currentTarget.value);
                    if (Number.isFinite(timeMs)) {
                        onJumpToTime?.(new Date(timeMs).toISOString());
                    }
                }}
            />
        </div>
    );
};

export default TimelineScrubber;
