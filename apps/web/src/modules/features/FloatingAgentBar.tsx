import { useState } from 'react';
import { Badge, Button, Textarea } from '@/ui';

/**
 * Foldable floating agent prompt bar (feature F84 R6) — UI stub.
 *
 * Expanded by default as a centred glassmorphic bar at the bottom of the
 * viewport; collapsed to a round spirit-icon dock at `bottom-6 right-6`.
 * No dispatch: submitting clears the field and states that agent execution
 * is not wired yet. No props, no network — the bar owns its own state.
 */
export default function FloatingAgentBar() {
    const [isOpen, setIsOpen] = useState(true);
    const [prompt, setPrompt] = useState('');
    const [notice, setNotice] = useState<string | null>(null);

    /** Stub submit — clear the prompt and surface the honesty note (R4). */
    const handleSubmit = () => {
        setPrompt('');
        setNotice('Agent dispatch is not wired yet — this bar is UI only (F84 R6).');
    };

    if (!isOpen) {
        return (
            <Button
                variant="ghost"
                className="fixed bottom-6 right-6 z-30 h-12 w-12 rounded-full backdrop-blur-md bg-base-100/80 border border-spur-border shadow-2xl text-xl"
                onClick={() => setIsOpen(true)}
                aria-label="Open agent prompt bar"
                aria-expanded={false}
                data-testid="agent-bar-dock"
            >
                ✨
            </Button>
        );
    }

    return (
        <div
            className="fixed bottom-4 left-1/2 -translate-x-1/2 z-30 w-[75%] max-w-4xl backdrop-blur-md bg-base-100/80 border border-spur-border shadow-2xl rounded-2xl p-2.5 flex flex-col gap-2"
            data-testid="agent-bar"
        >
            <div className="flex items-center gap-2">
                <Badge variant="outline" size="sm" className="shrink-0 font-mono">
                    agent · stub
                </Badge>
                <Textarea
                    rows={1}
                    value={prompt}
                    onChange={(e) => setPrompt(e.target.value)}
                    placeholder="Ask a coding agent to refine or implement this feature…"
                    aria-label="Agent prompt"
                    className="flex-1 min-h-9 resize-none bg-transparent"
                    data-testid="agent-bar-input"
                />
                <Button variant="primary" size="sm" disabled={prompt.trim().length === 0} onClick={handleSubmit}>
                    Send
                </Button>
                <Button
                    variant="ghost"
                    size="sm"
                    onClick={() => setIsOpen(false)}
                    aria-label="Collapse agent prompt bar"
                    aria-expanded={true}
                >
                    ▾
                </Button>
            </div>
            {notice && (
                <p role="status" className="px-1 text-xs text-spur-text-muted">
                    {notice}
                </p>
            )}
        </div>
    );
}
