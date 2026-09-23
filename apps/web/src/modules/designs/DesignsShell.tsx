import { useCallback, useEffect, useRef, useState } from 'react';
import { useSearchParams } from 'react-router';
import { Button } from '@/ui';
import {
    type DesignFileDetail,
    type DesignFileSummary,
    loadDesignContent,
    loadDesignFiles,
} from '../../lib/design-client';
import DesignFileList from './DesignFileList';
import DesignMarkdownBody from './DesignMarkdownBody';
import DesignToc from './DesignToc';

export default function DesignsShell() {
    const [searchParams, setSearchParams] = useSearchParams();
    const [files, setFiles] = useState<DesignFileSummary[] | null>(null);
    const [selectedPath, setSelectedPath] = useState<string | null>(() => searchParams.get('file'));
    const contentCacheRef = useRef<Record<string, DesignFileDetail>>({});
    const [contentCache, setContentCache] = useState<Record<string, DesignFileDetail>>({});
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
            const data = await loadDesignFiles(signal);
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

    // Load content for selected file (stable callback, zero re-trigger loops)
    const loadContent = useCallback(async (path: string, signal?: AbortSignal) => {
        if (contentCacheRef.current[path]) {
            return;
        }
        try {
            setLoadingContent(true);
            setContentError(null);
            const detail = await loadDesignContent(path, signal);
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
                Failed to load design documents: {error}
            </div>
        );
    }

    if (loadingFiles && files === null) {
        return (
            <div className="flex items-center justify-center h-full text-spur-text-muted text-sm">
                Loading design documents…
            </div>
        );
    }

    return (
        <div className="relative h-full w-full p-4 overflow-hidden" data-designs-shell>
            {/* Central Workspace Container — matches FeaturesShell layout */}
            <div className="flex flex-col h-full w-full max-w-[1600px] mx-auto gap-3" data-designs-workspace>
                {/* Module Header */}
                <header className="flex flex-wrap items-center justify-between gap-4 border-b border-spur-border pb-3 shrink-0">
                    <div className="flex items-center gap-3">
                        <span className="text-2xl" aria-hidden="true">
                            📐
                        </span>
                        <div>
                            <h1 className="text-xl font-bold tracking-tight text-spur-text">Designs</h1>
                            <p className="text-xs text-spur-text-muted">
                                Design documents, architecture specifications, and surface contracts
                            </p>
                        </div>
                    </div>
                    <div className="flex items-center gap-1" data-designs-actions>
                        <Button
                            variant="ghost"
                            size="xs"
                            className="text-spur-text-muted hover:text-spur-accent"
                            onClick={() => setIsListOpen((prev) => !prev)}
                            aria-label={isListOpen ? 'Collapse design file list' : 'Expand design file list'}
                            aria-expanded={isListOpen}
                            aria-controls="design-files-dock"
                            title={isListOpen ? 'Collapse design file list' : 'Expand design file list'}
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
                                aria-controls="design-toc-dock"
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
                            aria-label="Refresh design documents"
                            title="Refresh design documents"
                        >
                            🔄
                        </Button>
                    </div>
                </header>

                {/* Body Area — 3-zone adaptive layout fitting laptop and desktop screens */}
                <div className="flex-1 min-h-0 flex items-stretch gap-3 overflow-hidden" ref={bodyAreaRef}>
                    {/* Left Dock: Design Files List */}
                    <div
                        id="design-files-dock"
                        hidden={!isListOpen}
                        className={`${
                            isListOpen ? 'w-64 lg:w-72 flex' : 'hidden'
                        } shrink-0 flex-col overflow-hidden rounded-lg border border-spur-border bg-base-200 shadow-xs`}
                        data-testid="design-files-dock"
                    >
                        <div className="flex items-center justify-between px-3 py-2 border-b border-spur-border bg-base-300/60 shrink-0">
                            <span className="text-xs font-semibold text-spur-text flex items-center gap-1.5">
                                <span>📐</span> Design Docs
                            </span>
                            {files && files.length > 0 && (
                                <span className="text-[10px] font-mono px-1.5 py-0.5 rounded bg-spur-accent/15 text-spur-accent font-semibold">
                                    {files.length}
                                </span>
                            )}
                        </div>
                        <div className="flex-1 overflow-hidden">
                            {files && files.length > 0 ? (
                                <DesignFileList files={files} selectedPath={selectedPath} onSelect={handleSelectFile} />
                            ) : (
                                <div className="p-3 text-xs text-spur-text-muted italic">
                                    No design documents found.
                                </div>
                            )}
                        </div>
                    </div>

                    {/* Central Workspace Main Panel — adapts width dynamically via flex-1 */}
                    <div
                        className="flex-1 min-w-0 h-full overflow-hidden rounded-lg border border-spur-border bg-base-100 relative"
                        data-testid="design-workspace"
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
                                    <div className="p-6 md:p-8 flex-1" data-testid="design-body-container">
                                        {loadingContent && !activeDetail ? (
                                            <div className="flex items-center justify-center py-20 text-spur-text-muted text-sm">
                                                Loading document content…
                                            </div>
                                        ) : contentError ? (
                                            <div className="p-4 text-sm text-error bg-error/10 rounded-md border border-error/20">
                                                Failed to load document: {contentError}
                                            </div>
                                        ) : activeDetail ? (
                                            <DesignMarkdownBody source={activeDetail.content} />
                                        ) : null}
                                    </div>
                                </div>
                            ) : (
                                <div className="flex flex-col items-center justify-center h-full text-spur-text-muted gap-2">
                                    <span className="text-3xl" aria-hidden="true">
                                        📐
                                    </span>
                                    <span className="text-sm font-medium">Select a design document to view</span>
                                </div>
                            )}
                        </div>
                    </div>

                    {/* Right Dock: Table of Contents (Automatically shown when a file is selected) */}
                    {selectedPath && activeDetail?.content && isTocOpen && (
                        <DesignToc
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
