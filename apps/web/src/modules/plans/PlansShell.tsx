import { useCallback, useEffect, useRef, useState } from 'react';
import { useSearchParams } from 'react-router';
import { Button } from '@/ui';
import { loadPlanContent, loadPlanFiles, type PlanFileDetail, type PlanFileSummary } from '../../lib/plan-client';
import PlanFileList from './PlanFileList';
import PlanMarkdownBody from './PlanMarkdownBody';
import PlanToc from './PlanToc';

export default function PlansShell() {
    const [searchParams, setSearchParams] = useSearchParams();
    const [files, setFiles] = useState<PlanFileSummary[] | null>(null);
    const [selectedPath, setSelectedPath] = useState<string | null>(() => searchParams.get('file'));
    const contentCacheRef = useRef<Record<string, PlanFileDetail>>({});
    const [contentCache, setContentCache] = useState<Record<string, PlanFileDetail>>({});
    const [isListOpen, setIsListOpen] = useState(true);
    const [isTocOpen, setIsTocOpen] = useState(true);
    const [loadingFiles, setLoadingFiles] = useState(true);
    const [loadingContent, setLoadingContent] = useState(false);
    const [error, setError] = useState<string | null>(null);
    const [contentError, setContentError] = useState<string | null>(null);
    const [copied, setCopied] = useState(false);

    const mainContentScrollRef = useRef<HTMLDivElement | null>(null);
    const bodyAreaRef = useRef<HTMLDivElement | null>(null);

    // Initial files load
    const loadFiles = useCallback(async (signal?: AbortSignal) => {
        try {
            setLoadingFiles(true);
            const data = await loadPlanFiles(signal);
            setFiles(data);
            setError(null);
            return data;
        } catch (err) {
            if (signal?.aborted) return null;
            setError(err instanceof Error ? err.message : String(err));
            return null;
        } finally {
            setLoadingFiles(false);
        }
    }, []);

    // Load content for selected file
    const loadContent = useCallback(async (path: string, signal?: AbortSignal) => {
        if (contentCacheRef.current[path]) {
            return;
        }
        try {
            setLoadingContent(true);
            setContentError(null);
            const detail = await loadPlanContent(path, signal);
            contentCacheRef.current[path] = detail;
            setContentCache((prev) => ({ ...prev, [path]: detail }));
        } catch (err) {
            if (signal?.aborted) return;
            setContentError(err instanceof Error ? err.message : String(err));
        } finally {
            setLoadingContent(false);
        }
    }, []);

    // URL search param sync
    const fileParam = searchParams.get('file');

    // Initial mount load
    useEffect(() => {
        const controller = new AbortController();
        void (async () => {
            const loadedFiles = await loadFiles(controller.signal);
            if (loadedFiles && loadedFiles.length > 0) {
                const matched = fileParam && loadedFiles.some((f) => f.path === fileParam);
                if (matched) {
                    setSelectedPath(fileParam);
                } else if (!fileParam) {
                    const defaultPath = loadedFiles[0]?.path;
                    if (defaultPath) {
                        setSelectedPath(defaultPath);
                    }
                }
            }
        })();
        return () => controller.abort();
    }, [loadFiles, fileParam]);

    // External URL navigation sync
    useEffect(() => {
        if (fileParam && fileParam !== selectedPath) {
            setSelectedPath(fileParam);
        }
    }, [fileParam, selectedPath]);

    // Handle selection and content fetch
    useEffect(() => {
        if (!selectedPath) return;
        const controller = new AbortController();
        void loadContent(selectedPath, controller.signal);
        return () => controller.abort();
    }, [selectedPath, loadContent]);

    const handleSelectFile = (path: string) => {
        setSelectedPath(path);
        setIsTocOpen(true);
        setSearchParams({ file: path }, { replace: true });
        // Scroll main content back to top when switching files
        if (mainContentScrollRef.current) {
            mainContentScrollRef.current.scrollTop = 0;
        }
    };

    const handleCopyPath = () => {
        if (!selectedPath) return;
        void navigator.clipboard.writeText(selectedPath);
        setCopied(true);
        setTimeout(() => setCopied(false), 2000);
    };

    const activeDetail = selectedPath ? contentCache[selectedPath] : null;

    if (error) {
        return (
            <div className="p-4 text-sm text-error" role="alert">
                Failed to load plan documents: {error}
            </div>
        );
    }

    if (loadingFiles && files === null) {
        return (
            <div className="flex items-center justify-center h-full text-spur-text-muted text-sm">
                Loading plan documents…
            </div>
        );
    }

    return (
        <div className="relative h-full w-full p-4 overflow-hidden" data-plans-shell>
            {/* Central Workspace Container */}
            <div
                className="flex flex-col h-full w-full max-w-full 3xl:max-w-[1200px] 4xl:max-w-[1600px] mx-auto gap-3"
                data-plans-workspace
            >
                {/* Module Header */}
                <header className="flex flex-wrap items-center justify-between gap-4 border-b border-spur-border pb-3 shrink-0">
                    <div className="flex items-center gap-3">
                        <span className="text-2xl" aria-hidden="true">
                            🗺️
                        </span>
                        <div>
                            <h1 className="text-xl font-bold tracking-tight text-spur-text">Plans</h1>
                            <p className="text-xs text-spur-text-muted">
                                Project roadmap, release commitments, and execution proposals
                            </p>
                        </div>
                    </div>
                    <div className="flex items-center gap-1" data-plans-actions>
                        <Button
                            variant="ghost"
                            size="xs"
                            className="text-spur-text-muted hover:text-spur-accent"
                            onClick={() => setIsListOpen((prev) => !prev)}
                            aria-label={isListOpen ? 'Collapse plan file list' : 'Expand plan file list'}
                            aria-expanded={isListOpen}
                            aria-controls="plan-files-dock"
                            title={isListOpen ? 'Collapse plan file list' : 'Expand plan file list'}
                        >
                            {isListOpen ? '◧' : '▶'}
                        </Button>
                        {selectedPath && activeDetail?.content && (
                            <Button
                                variant="ghost"
                                size="xs"
                                className="text-spur-text-muted hover:text-spur-accent"
                                onClick={() => setIsTocOpen((prev) => !prev)}
                                aria-label={isTocOpen ? 'Collapse table of contents' : 'Expand table of contents'}
                                aria-expanded={isTocOpen}
                                aria-controls="plan-toc-dock"
                                title={isTocOpen ? 'Collapse table of contents' : 'Expand table of contents'}
                            >
                                {isTocOpen ? '📑' : '📖'}
                            </Button>
                        )}
                        <Button
                            variant="ghost"
                            size="xs"
                            className="text-spur-text-muted hover:text-spur-accent"
                            onClick={() => {
                                void (async () => {
                                    await loadFiles();
                                    if (selectedPath) {
                                        setContentCache((prev) => {
                                            const next = { ...prev };
                                            delete next[selectedPath];
                                            return next;
                                        });
                                        void loadContent(selectedPath);
                                    }
                                })();
                            }}
                            aria-label="Refresh plan documents"
                            title="Refresh plan documents"
                        >
                            🔄
                        </Button>
                    </div>
                </header>

                {/* Body Area — 3-zone adaptive layout on laptop (<3xl), floating outside on larger screens (3xl+) */}
                <div
                    className="flex-1 min-h-0 flex items-stretch gap-3 overflow-hidden 3xl:relative 3xl:block 3xl:overflow-visible"
                    ref={bodyAreaRef}
                >
                    {/* Left Dock: Plan Files List */}
                    <div
                        id="plan-files-dock"
                        hidden={!isListOpen}
                        className={`${
                            isListOpen ? 'flex' : 'hidden'
                        } w-64 lg:w-72 shrink-0 flex-col overflow-hidden rounded-lg border border-spur-border bg-base-200 shadow-xs 3xl:absolute 3xl:right-[calc(100%_+_12px)] 3xl:top-0 3xl:bottom-0 3xl:z-20 3xl:w-72 4xl:w-80 3xl:shadow-xl`}
                        data-testid="plan-files-dock"
                    >
                        <div className="flex items-center justify-between px-3 py-2 border-b border-spur-border bg-base-300/60 shrink-0">
                            <span className="text-xs font-semibold text-spur-text flex items-center gap-1.5">
                                <span>🗺️</span> Plan Docs
                            </span>
                            {files && files.length > 0 && (
                                <span className="text-[10px] font-mono px-1.5 py-0.5 rounded bg-spur-accent/15 text-spur-accent font-semibold">
                                    {files.length}
                                </span>
                            )}
                        </div>
                        <div className="flex-1 overflow-hidden">
                            {files && files.length > 0 ? (
                                <PlanFileList files={files} selectedPath={selectedPath} onSelect={handleSelectFile} />
                            ) : (
                                <div className="p-3 text-xs text-spur-text-muted italic">No plan documents found.</div>
                            )}
                        </div>
                    </div>

                    {/* Central Workspace Main Panel */}
                    <div
                        className="flex-1 min-w-0 h-full overflow-hidden rounded-lg border border-spur-border bg-base-100 relative 3xl:w-full 3xl:flex-none"
                        data-testid="plan-workspace"
                    >
                        <div className="w-full h-full overflow-y-auto" ref={mainContentScrollRef}>
                            {selectedPath ? (
                                <div className="flex flex-col min-h-full">
                                    {/* Document Header Bar */}
                                    <div className="sticky top-0 z-10 flex items-center justify-between px-6 py-3 border-b border-spur-border bg-base-100/90 backdrop-blur-xs">
                                        <div className="flex items-center gap-2 min-w-0">
                                            <span className="text-xs font-mono px-2 py-0.5 rounded bg-base-200 text-spur-text-muted border border-spur-border shrink-0">
                                                {selectedPath}
                                            </span>
                                            {activeDetail?.title && (
                                                <h2 className="text-sm font-semibold text-spur-text truncate">
                                                    {activeDetail.title}
                                                </h2>
                                            )}
                                        </div>
                                        <Button
                                            variant="ghost"
                                            size="xs"
                                            className="text-spur-text-muted hover:text-spur-text shrink-0"
                                            onClick={handleCopyPath}
                                            aria-label="Copy file path"
                                            title="Copy file path"
                                        >
                                            {copied ? '✓ Copied' : '📋 Copy Path'}
                                        </Button>
                                    </div>

                                    {/* Document Body */}
                                    <div className="p-6 md:p-8 flex-1" data-testid="plan-body-container">
                                        {loadingContent && !activeDetail ? (
                                            <div className="flex items-center justify-center py-20 text-spur-text-muted text-sm">
                                                Loading document content…
                                            </div>
                                        ) : contentError ? (
                                            <div className="p-4 text-sm text-error bg-error/10 rounded-md border border-error/20">
                                                Failed to load document: {contentError}
                                            </div>
                                        ) : activeDetail ? (
                                            <PlanMarkdownBody source={activeDetail.content} />
                                        ) : null}
                                    </div>
                                </div>
                            ) : (
                                <div className="flex flex-col items-center justify-center h-full text-spur-text-muted gap-2">
                                    <span className="text-3xl" aria-hidden="true">
                                        🗺️
                                    </span>
                                    <span className="text-sm font-medium">Select a plan document to view</span>
                                </div>
                            )}
                        </div>
                    </div>

                    {/* Right Dock: Table of Contents */}
                    {selectedPath && activeDetail?.content && isTocOpen && (
                        <PlanToc
                            markdown={activeDetail.content}
                            scrollContainerRef={mainContentScrollRef}
                            onClose={() => setIsTocOpen(false)}
                        />
                    )}
                </div>
            </div>
        </div>
    );
}
