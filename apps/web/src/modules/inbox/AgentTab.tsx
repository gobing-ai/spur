import { useEffect, useRef, useState } from 'react';
import { appendFrame, type Frame, nextBackoff, parseFrame, streamUrl } from '../../lib/process-stream';
import { type MsgRow, useMessageFeed } from './AllTab';
import { mergeTimeline, type TimelineEntry } from './timeline';

/** Messages involving `agentId` — the durable half of the unified timeline. */
function agentMessages(messages: MsgRow[], agentId: string): MsgRow[] {
    return messages.filter((m) => m.fromId === agentId || m.toId === agentId);
}

/**
 * Render one timeline entry (R5/R6). Branches on `kind` — never on optional
 * fields. Message/frame cards sit one ladder step above the container; the
 * boundary row marks where ephemeral process history begins.
 */
function TimelineRow({ entry }: { entry: TimelineEntry }) {
    if (entry.kind === 'boundary') {
        return (
            <div
                className="flex items-center gap-2 px-2 py-1 my-2 text-xs text-spur-text-muted border-y border-spur-border"
                data-timeline-boundary
            >
                <span className="font-mono text-spur-text-faint">{entry.ts}</span>
                <span className="flex-1">Process output history begins here — older rows are messages only.</span>
            </div>
        );
    }

    if (entry.kind === 'frame') {
        const streamLabel = entry.frame.stream === 'stderr' ? 'stderr' : 'stdout';
        return (
            <li
                className="p-2 bg-spur-surface-2 border border-spur-border rounded-xl text-sm"
                data-timeline-frame
                data-frame-stream={entry.frame.stream}
            >
                <div className="flex items-center gap-2 text-xs text-spur-text-muted">
                    <span className="px-1 rounded bg-spur-surface-3 text-spur-text-faint">frame</span>
                    <span data-timeline-direction>{entry.direction === 'in' ? 'IN' : 'OUT'}</span>
                    <span className="font-mono">{streamLabel}</span>
                    <span className="ml-auto font-mono">{entry.ts}</span>
                </div>
                <p className="mt-1 font-mono text-xs text-spur-text whitespace-pre-wrap break-words">
                    {entry.frame.line}
                </p>
            </li>
        );
    }

    // message
    const fromLabel = entry.row.from
        ? [entry.row.from.memberLabel ?? entry.row.from.agentId, entry.row.from.agentType].filter(Boolean).join(' · ')
        : (entry.row.fromId ?? 'system');
    const toLabel = [entry.row.to.memberLabel ?? entry.row.to.agentId, entry.row.to.agentType]
        .filter(Boolean)
        .join(' · ');
    return (
        <li className="p-2 bg-spur-surface-2 border border-spur-border rounded-xl text-sm" data-timeline-message>
            <div className="flex items-center gap-2 text-xs text-spur-text-muted">
                <span className="px-1 rounded bg-spur-surface-3 text-spur-text-faint">message</span>
                <span data-timeline-direction>{entry.direction === 'in' ? 'IN' : 'OUT'}</span>
                <span data-message-route className="truncate">
                    {fromLabel} <span className="mx-1">→</span> {toLabel}
                </span>
                <span className="ml-auto font-mono">{entry.ts}</span>
            </div>
            <p className="mt-1 text-spur-text whitespace-pre-wrap break-words">{entry.row.body}</p>
        </li>
    );
}

/**
 * Per-agent tab — a unified IN/OUT timeline of durable messages and ephemeral
 * process frames for one agent (0422 R5/R6).
 *
 * Opens exactly one `EventSource` for process frames (R14), torn down on unmount
 * and on agent switch via the `agentId`-keyed effect. The durable message feed is
 * shared from `useMessageFeed`; the two channels are merged client-side by the
 * pure `mergeTimeline`. The bounded ring buffer means history has a boundary —
 * rendered explicitly (R6), with a message-only fallback when an agent has no
 * frames at all.
 */
export default function AgentTab({ agentId }: { agentId: string }) {
    const { messages, error } = useMessageFeed();
    const [frames, setFrames] = useState<Frame[]>([]);
    const lastSeqRef = useRef(-1);

    useEffect(() => {
        setFrames([]);
        lastSeqRef.current = -1;
        let es: EventSource | null = null;
        let disposed = false;
        let attempt = 0;
        let timer: ReturnType<typeof setTimeout> | undefined;

        const open = () => {
            if (disposed) return;
            es = new EventSource(streamUrl(agentId));
            es.onmessage = (event) => {
                try {
                    const raw: unknown = JSON.parse(event.data);
                    const frame = parseFrame(raw);
                    if (!frame) return;
                    setFrames((prev) => {
                        const result = appendFrame(prev, frame, lastSeqRef.current);
                        lastSeqRef.current = result.lastSeq;
                        return result.frames;
                    });
                } catch {
                    // Malformed frame — drop silently.
                }
            };
            es.onerror = () => {
                es?.close();
                es = null;
                if (disposed) return;
                const delay = nextBackoff(attempt);
                attempt += 1;
                timer = setTimeout(open, delay);
            };
        };
        open();

        return () => {
            disposed = true;
            clearTimeout(timer);
            es?.close();
        };
    }, [agentId]);

    if (error)
        return (
            <div className="p-4 text-sm text-error" role="alert">
                Failed to load messages: {error}
            </div>
        );
    if (messages === null) return <div className="p-4 text-sm text-spur-text-muted">Loading timeline…</div>;

    const timeline = mergeTimeline(agentMessages(messages, agentId), frames, agentId);
    const hasBoundary = timeline.some((e) => e.kind === 'boundary');
    const hasEntries = timeline.length > 0;

    return (
        <div className="flex flex-col h-full overflow-hidden bg-spur-bg" data-agent-tab>
            <div className="px-4 py-2 border-b border-spur-border bg-spur-surface shrink-0 flex items-center gap-2">
                <span className="text-xs font-semibold text-spur-text-muted uppercase tracking-wide">Timeline</span>
                <span className="font-mono text-xs text-spur-text-muted">{agentId}</span>
            </div>
            {hasEntries ? (
                <ul className="flex-1 overflow-y-auto p-2 space-y-1">
                    {timeline.map((entry) => {
                        const key =
                            entry.kind === 'message'
                                ? `m-${entry.row.id}`
                                : entry.kind === 'frame'
                                  ? `f-${entry.frame.seq ?? entry.ts}`
                                  : `b-${entry.ts}`;
                        return <TimelineRow key={key} entry={entry} />;
                    })}
                </ul>
            ) : (
                <div className="p-4 text-sm text-spur-text-muted italic" data-agent-tab-empty>
                    No messages or process output for {agentId}.
                </div>
            )}
            {!hasBoundary && hasEntries && (
                <div className="px-4 py-1 text-xs text-spur-text-muted border-t border-spur-border" data-agent-tab-note>
                    No process output available — showing messages only.
                </div>
            )}
        </div>
    );
}
