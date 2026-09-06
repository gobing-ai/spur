import { useState } from 'react';
import { Badge, Button, Textarea } from '@/ui';
import type { WebModule } from '../modules/types';

export interface GlobalAgentBarProps {
    /** Module resolved from the current /board/<route> segment; undefined off a module route. */
    activeModule?: WebModule;
}

const MODULE_CHIPS: Record<string, readonly string[]> = {
    features: ['Decompose feature', 'Verify acceptance criteria'],
    tasks: ['Run task', 'Check readiness', 'Refine requirements'],
    observability: ['Explain recent failure', 'Audit doctor status'],
    history: ['Summarize session', 'Find recurring bottlenecks'],
};

/**
 * Foldable global orchestrator agent prompt bar (feature A7 / task 0774).
 *
 * Mounted globally by `BoardLayout` across all module routes.
 * Folded by default as a round spirit-icon dock at `bottom-6 right-6`;
 * opens to a wide centered glassmorphic bar at the bottom of the viewport.
 * No dispatch: submitting clears the field and states that agent execution
 * is not wired yet.
 */
export default function GlobalAgentBar({ activeModule }: GlobalAgentBarProps) {
    const [isOpen, setIsOpen] = useState(false);
    const [drawerOpen, setDrawerOpen] = useState(false);
    const [prompt, setPrompt] = useState('');
    const [notice, setNotice] = useState<string | null>(null);

    const contextLabel = activeModule?.sidebarLabel ?? activeModule?.name ?? 'Board';
    const chips = activeModule?.id ? MODULE_CHIPS[activeModule.id] : undefined;

    /** Stub submit — clear the prompt and surface the honesty note (R4). */
    const handleSubmit = () => {
        setPrompt('');
        setNotice('Agent dispatch is not wired yet — this bar is UI only (F84 R6).');
    };

    const handleChipClick = (chipText: string) => {
        setPrompt(chipText);
        const input = document.querySelector<HTMLTextAreaElement>('[data-testid="agent-bar-input"]');
        input?.focus();
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
            className="fixed bottom-4 left-1/2 -translate-x-1/2 z-30 w-[calc(100vw-2rem)] max-w-[84rem] backdrop-blur-md bg-base-100/80 border border-spur-border shadow-2xl rounded-2xl p-2.5 flex flex-col gap-2"
            data-testid="agent-bar"
        >
            <div className="flex items-center gap-2">
                <Badge variant="outline" size="sm" className="shrink-0 font-mono">
                    agent · stub
                </Badge>
                <Badge variant="neutral" size="sm" className="shrink-0 font-mono" data-testid="agent-bar-context">
                    Context: {contextLabel}
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
                <Button
                    variant="ghost"
                    size="sm"
                    onClick={() => setDrawerOpen((prev) => !prev)}
                    aria-label="Toggle execution telemetry drawer"
                    aria-expanded={drawerOpen}
                    data-testid="agent-bar-drawer-toggle"
                >
                    ⚡
                </Button>
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

            {chips && chips.length > 0 && (
                <div data-testid="agent-bar-chips" className="flex items-center gap-1.5 flex-wrap px-1">
                    {chips.map((chip) => (
                        <button
                            key={chip}
                            type="button"
                            onClick={() => handleChipClick(chip)}
                            className="text-xs px-2.5 py-0.5 rounded-full border border-spur-border bg-spur-surface/80 hover:bg-spur-border/40 text-spur-text-muted hover:text-spur-text transition-colors"
                        >
                            {chip}
                        </button>
                    ))}
                </div>
            )}

            {drawerOpen && (
                <div
                    data-testid="agent-bar-drawer"
                    className="rounded-lg border border-spur-border bg-spur-surface/60 p-2.5 text-xs text-spur-text-muted"
                >
                    <div role="status">Streamed telemetry and tool calls are not wired yet.</div>
                </div>
            )}

            {notice && (
                <p role="status" className="px-1 text-xs text-spur-text-muted">
                    {notice}
                </p>
            )}
        </div>
    );
}
