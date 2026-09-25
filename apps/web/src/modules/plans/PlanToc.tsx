import { useEffect, useMemo, useState } from 'react';
import { Button } from '@/ui';

export interface TocHeading {
    id: string;
    text: string;
    level: number;
}

/**
 * Deterministically extract headings from Markdown source, ignoring fenced code blocks.
 */
export function extractHeadings(markdown: string): TocHeading[] {
    if (!markdown) return [];
    const lines = markdown.split(/\r?\n/);
    const headings: TocHeading[] = [];
    const slugCounts = new Map<string, number>();
    let inFence = false;

    for (const line of lines) {
        const trimmed = line.trim();
        if (trimmed.startsWith('```')) {
            inFence = !inFence;
            continue;
        }
        if (inFence) continue;

        const match = line.match(/^(#{1,6})\s+(.+)$/);
        if (match?.[1] && match[2]) {
            const level = match[1].length;
            const rawText = match[2].trim();
            const cleanText = rawText
                .replace(/\*\*([^*]+)\*\*/g, '$1')
                .replace(/\*([^*]+)\*/g, '$1')
                .replace(/`([^`]+)`/g, '$1')
                .replace(/\[([^\]]+)\]\([^)]+\)/g, '$1')
                .trim();

            const baseSlug = cleanText
                .toLowerCase()
                .replace(/[^\w\s-]/g, '')
                .replace(/\s+/g, '-');
            const slug = baseSlug || `heading-${headings.length + 1}`;
            const count = slugCounts.get(slug) ?? 0;
            slugCounts.set(slug, count + 1);
            const id = count === 0 ? slug : `${slug}-${count}`;

            headings.push({ id, text: cleanText, level });
        }
    }

    return headings;
}

export function createSlugTracker() {
    const slugCounts = new Map<string, number>();
    return {
        nextId(cleanText: string): string {
            const baseSlug = cleanText
                .toLowerCase()
                .replace(/[^\w\s-]/g, '')
                .replace(/\s+/g, '-');
            const slug = baseSlug || 'heading';
            const count = slugCounts.get(slug) ?? 0;
            slugCounts.set(slug, count + 1);
            return count === 0 ? slug : `${slug}-${count}`;
        },
    };
}

interface PlanTocProps {
    markdown: string;
    scrollContainerRef?: React.RefObject<HTMLDivElement | null>;
    onClose?: () => void;
}

export default function PlanToc({ markdown, scrollContainerRef, onClose }: PlanTocProps) {
    const headings = useMemo(() => extractHeadings(markdown), [markdown]);
    const [activeId, setActiveId] = useState<string | null>(null);

    // Scrollspy: update active heading based on viewport scroll position
    useEffect(() => {
        const container = scrollContainerRef?.current;
        if (!container || headings.length === 0) return;

        const handleScroll = () => {
            const containerTop = container.getBoundingClientRect().top;
            let currentActive: string | null = null;

            for (const h of headings) {
                const el = document.getElementById(h.id);
                if (el) {
                    const rect = el.getBoundingClientRect();
                    if (rect.top - containerTop <= 100) {
                        currentActive = h.id;
                    }
                }
            }

            if (currentActive) {
                setActiveId(currentActive);
            }
        };

        container.addEventListener('scroll', handleScroll, { passive: true });
        handleScroll();
        return () => container.removeEventListener('scroll', handleScroll);
    }, [headings, scrollContainerRef]);

    const scrollToHeading = (id: string) => {
        setActiveId(id);
        const el = document.getElementById(id);
        if (el) {
            el.scrollIntoView({ behavior: 'smooth', block: 'start' });
        }
    };

    return (
        <aside
            id="plan-toc-dock"
            aria-label="Table of Contents"
            className="w-64 lg:w-72 shrink-0 rounded-lg border border-spur-border bg-base-200 shadow-xs flex flex-col overflow-hidden 3xl:absolute 3xl:top-0 3xl:bottom-0 3xl:left-[calc(100%_+_12px)] 3xl:z-20 3xl:w-72 4xl:w-80 3xl:shadow-xl"
            data-testid="plan-toc-dock"
        >
            <div className="flex items-center justify-between px-3 py-2 border-b border-spur-border bg-base-300/60 shrink-0">
                <span className="text-xs font-semibold text-spur-text flex items-center gap-1.5">
                    <span>📑</span> Table of Contents
                </span>
                <div className="flex items-center gap-1.5">
                    {headings.length > 0 && (
                        <span className="text-[10px] font-mono px-1.5 py-0.5 rounded bg-spur-accent/15 text-spur-accent font-semibold">
                            {headings.length}
                        </span>
                    )}
                    {onClose && (
                        <Button
                            variant="ghost"
                            size="xs"
                            className="text-spur-text-muted hover:text-spur-accent h-5 w-5 p-0 text-xs flex items-center justify-center cursor-pointer"
                            onClick={onClose}
                            aria-label="Close table of contents"
                            title="Close table of contents"
                        >
                            ✕
                        </Button>
                    )}
                </div>
            </div>

            <div className="flex-1 overflow-y-auto p-1.5 space-y-0.5">
                {headings.length === 0 ? (
                    <div className="p-3 text-xs text-spur-text-muted italic">No headings in document.</div>
                ) : (
                    headings.map((h) => {
                        const isActive = activeId === h.id;
                        let indentClass = 'pl-2 text-xs font-semibold';
                        if (h.level === 2) indentClass = 'pl-4 text-xs font-medium';
                        else if (h.level === 3) indentClass = 'pl-6 text-xs text-spur-text-muted';
                        else if (h.level >= 4) indentClass = 'pl-8 text-[11px] text-spur-text-muted';

                        return (
                            <button
                                key={h.id}
                                type="button"
                                onClick={() => scrollToHeading(h.id)}
                                title={h.text}
                                className={`w-full text-left py-1 pr-2 rounded transition-colors truncate block cursor-pointer ${indentClass} ${
                                    isActive
                                        ? 'bg-spur-accent/15 text-spur-accent font-semibold'
                                        : 'hover:bg-base-300 hover:text-spur-text text-spur-text/80'
                                }`}
                            >
                                {h.text}
                            </button>
                        );
                    })
                )}
            </div>
        </aside>
    );
}
