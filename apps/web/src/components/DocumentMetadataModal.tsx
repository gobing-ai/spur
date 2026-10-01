import { useMemo, useState } from 'react';
import { createPortal } from 'react-dom';
import { Badge, Button, Modal } from '@/ui';

export interface DocumentMetadataModalProps {
    open: boolean;
    onClose: () => void;
    title?: string;
    filePath?: string | null;
    frontmatterRaw: string | null;
    frontmatter?: Record<string, unknown> | null;
}

function formatDate(raw: unknown): string {
    if (!raw) return '';
    try {
        const d = new Date(raw as string);
        if (Number.isNaN(d.getTime())) return String(raw);
        return d.toLocaleDateString(undefined, { year: 'numeric', month: 'short', day: 'numeric' });
    } catch {
        return String(raw);
    }
}

function relativeDays(raw: unknown): string {
    if (!raw) return '';
    try {
        const d = new Date(raw as string);
        if (Number.isNaN(d.getTime())) return '';
        const diff = Date.now() - d.getTime();
        const days = Math.floor(diff / 86400000);
        if (days === 0) return 'today';
        if (days === 1) return 'yesterday';
        if (days < 30) return `${days}d ago`;
        if (days < 365) return `${Math.floor(days / 30)}mo ago`;
        return `${Math.floor(days / 365)}y ago`;
    } catch {
        return '';
    }
}

function statusBadgeVariant(status: string): 'success' | 'info' | 'warning' | 'neutral' {
    const s = status.toLowerCase();
    if (['done', 'accepted', 'approved', 'pass'].includes(s)) return 'success';
    if (['ready', 'current', 'active', 'todo', 'in-progress'].includes(s)) return 'info';
    if (['review', 'deferred', 'blocked', 'warning'].includes(s)) return 'warning';
    return 'neutral';
}

const SHOWCASED_KEYS = new Set([
    'title',
    'kind',
    'doc',
    'status',
    'version',
    'owner',
    'created_at',
    'updated_at',
    'tags',
    'authority',
    'description',
    'owns',
]);

export default function DocumentMetadataModal({
    open,
    onClose,
    title,
    filePath,
    frontmatterRaw,
    frontmatter,
}: DocumentMetadataModalProps) {
    const [tab, setTab] = useState<'structured' | 'raw'>('structured');
    const [copiedPath, setCopiedPath] = useState(false);
    const [copiedYaml, setCopiedYaml] = useState(false);

    const hasFrontmatter = Boolean(frontmatterRaw && frontmatterRaw.trim().length > 0);

    const handleCopyPath = () => {
        if (!filePath) return;
        void navigator.clipboard.writeText(filePath);
        setCopiedPath(true);
        setTimeout(() => setCopiedPath(false), 2000);
    };

    const handleCopyYaml = () => {
        if (!frontmatterRaw) return;
        void navigator.clipboard.writeText(frontmatterRaw);
        setCopiedYaml(true);
        setTimeout(() => setCopiedYaml(false), 2000);
    };

    // Extract common fields for prioritized display
    const fm = frontmatter ?? {};
    const tags = Array.isArray(fm.tags) ? (fm.tags as unknown[]) : [];
    const status = typeof fm.status === 'string' ? fm.status : undefined;
    const kind = typeof fm.kind === 'string' ? fm.kind : typeof fm.doc === 'string' ? fm.doc : undefined;
    const version = typeof fm.version === 'string' || typeof fm.version === 'number' ? String(fm.version) : undefined;
    const owner = typeof fm.owner === 'string' ? fm.owner : undefined;
    const createdAt = fm.created_at ? formatDate(fm.created_at) : undefined;
    const createdAtRel = fm.created_at ? relativeDays(fm.created_at) : undefined;
    const updatedAt = fm.updated_at ? formatDate(fm.updated_at) : undefined;
    const updatedAtRel = fm.updated_at ? relativeDays(fm.updated_at) : undefined;
    const authority = typeof fm.authority === 'string' ? fm.authority : undefined;
    const description = typeof fm.description === 'string' ? fm.description : undefined;
    const owns = typeof fm.owns === 'string' ? fm.owns : undefined;

    const otherEntries = useMemo(() => {
        return Object.entries(fm).filter(([k]) => !SHOWCASED_KEYS.has(k));
    }, [fm]);

    if (!open) return null;

    const renderValue = (val: unknown): React.ReactNode => {
        if (val === null || val === undefined) {
            return <span className="text-spur-text-muted italic">none</span>;
        }
        if (typeof val === 'boolean') {
            return (
                <Badge variant={val ? 'success' : 'neutral'} size="xs">
                    {String(val)}
                </Badge>
            );
        }
        if (Array.isArray(val)) {
            if (val.length === 0) return <span className="text-spur-text-muted italic">empty</span>;
            const allScalars = val.every((item) => typeof item === 'string' || typeof item === 'number');
            if (allScalars) {
                return (
                    <div className="flex flex-wrap gap-1">
                        {val.map((item) => (
                            <Badge
                                key={String(item)}
                                variant="outline"
                                size="xs"
                                className="font-mono text-spur-text-muted"
                            >
                                {String(item)}
                            </Badge>
                        ))}
                    </div>
                );
            }
            return (
                <pre className="p-2 rounded bg-base-300 font-mono text-[11px] overflow-x-auto max-h-40 text-spur-text-muted">
                    {JSON.stringify(val, null, 2)}
                </pre>
            );
        }
        if (typeof val === 'object') {
            return (
                <pre className="p-2 rounded bg-base-300 font-mono text-[11px] overflow-x-auto max-h-48 text-spur-text-muted">
                    {JSON.stringify(val, null, 2)}
                </pre>
            );
        }
        return <span className="font-mono text-spur-text break-words">{String(val)}</span>;
    };

    const modalContent = (
        <Modal
            open={open}
            onClose={onClose}
            aria-labelledby="doc-metadata-title"
            className="max-w-2xl w-full p-0 overflow-hidden bg-base-200 border border-spur-border shadow-2xl flex flex-col max-h-[85vh]"
        >
            {/* Modal Header */}
            <div className="px-5 py-3.5 border-b border-spur-border bg-base-300/70 flex items-center justify-between shrink-0">
                <div className="flex items-center gap-2.5 min-w-0">
                    <span className="flex items-center justify-center w-6 h-6 rounded bg-spur-accent/20 text-spur-accent font-bold text-xs shrink-0">
                        ℹ
                    </span>
                    <div className="min-w-0">
                        <h3 id="doc-metadata-title" className="text-sm font-semibold text-spur-text leading-tight">
                            Document Metadata
                        </h3>
                        {title && (
                            <p className="text-xs text-spur-text-muted truncate mt-0.5" title={title}>
                                {title}
                            </p>
                        )}
                    </div>
                </div>

                <div className="flex items-center gap-3">
                    {hasFrontmatter && (
                        <div
                            className="flex rounded-md bg-base-100 p-0.5 border border-spur-border text-xs"
                            role="tablist"
                        >
                            <button
                                type="button"
                                role="tab"
                                aria-selected={tab === 'structured'}
                                className={`px-2.5 py-1 rounded text-xs font-medium transition-colors ${
                                    tab === 'structured'
                                        ? 'bg-base-300 text-spur-accent shadow-xs'
                                        : 'text-spur-text-muted hover:text-spur-text'
                                }`}
                                onClick={() => setTab('structured')}
                            >
                                Properties
                            </button>
                            <button
                                type="button"
                                role="tab"
                                aria-selected={tab === 'raw'}
                                className={`px-2.5 py-1 rounded text-xs font-medium transition-colors ${
                                    tab === 'raw'
                                        ? 'bg-base-300 text-spur-accent shadow-xs'
                                        : 'text-spur-text-muted hover:text-spur-text'
                                }`}
                                onClick={() => setTab('raw')}
                            >
                                Raw YAML
                            </button>
                        </div>
                    )}
                    <Button
                        variant="ghost"
                        size="xs"
                        className="text-spur-text-muted hover:text-spur-accent h-6 w-6 p-0 text-xs flex items-center justify-center"
                        onClick={onClose}
                        aria-label="Close metadata"
                        title="Close metadata"
                    >
                        ✕
                    </Button>
                </div>
            </div>

            {/* Modal Body */}
            <div className="flex-1 overflow-y-auto p-5 space-y-4">
                {/* File Path Bar */}
                {filePath && (
                    <div className="flex items-center justify-between p-2.5 rounded-md bg-base-300/40 border border-spur-border text-xs">
                        <div className="flex items-center gap-2 min-w-0">
                            <span className="text-spur-text-muted shrink-0">Path:</span>
                            <span className="font-mono text-spur-text truncate select-all">{filePath}</span>
                        </div>
                        <Button
                            variant="ghost"
                            size="xs"
                            className="text-spur-text-muted hover:text-spur-text shrink-0 text-xs ml-2"
                            onClick={handleCopyPath}
                            aria-label="Copy file path"
                        >
                            {copiedPath ? '✓ Copied' : '📋 Copy'}
                        </Button>
                    </div>
                )}

                {!hasFrontmatter ? (
                    <div className="py-12 flex flex-col items-center justify-center text-center text-spur-text-muted gap-2">
                        <span className="text-3xl" aria-hidden="true">
                            📄
                        </span>
                        <p className="text-sm font-medium text-spur-text">No frontmatter metadata found</p>
                        <p className="text-xs max-w-sm">
                            This document does not define a YAML frontmatter block at the top.
                        </p>
                    </div>
                ) : tab === 'raw' ? (
                    <div className="space-y-2">
                        <div className="flex items-center justify-between">
                            <span className="text-xs text-spur-text-muted font-mono">
                                {frontmatterRaw?.split('\n').length} lines
                            </span>
                            <Button
                                variant="ghost"
                                size="xs"
                                className="text-spur-text-muted hover:text-spur-text text-xs"
                                onClick={handleCopyYaml}
                                aria-label="Copy YAML"
                            >
                                {copiedYaml ? '✓ Copied YAML' : '📋 Copy YAML'}
                            </Button>
                        </div>
                        <pre className="p-4 rounded-md bg-base-300 font-mono text-xs text-spur-text overflow-x-auto border border-spur-border leading-relaxed max-h-[55vh] select-text">
                            <code>{frontmatterRaw}</code>
                        </pre>
                    </div>
                ) : (
                    <div className="space-y-4">
                        {/* Highlights row (Kind, Status, Version, Authority) */}
                        <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
                            {kind && (
                                <div className="p-2 rounded bg-base-300/40 border border-spur-border">
                                    <span className="text-[10px] uppercase font-semibold text-spur-text-muted block">
                                        Kind / Doc
                                    </span>
                                    <span className="font-mono text-xs text-spur-accent font-semibold">{kind}</span>
                                </div>
                            )}
                            {status && (
                                <div className="p-2 rounded bg-base-300/40 border border-spur-border">
                                    <span className="text-[10px] uppercase font-semibold text-spur-text-muted block">
                                        Status
                                    </span>
                                    <Badge variant={statusBadgeVariant(status)} size="xs" className="mt-0.5">
                                        {status}
                                    </Badge>
                                </div>
                            )}
                            {version && (
                                <div className="p-2 rounded bg-base-300/40 border border-spur-border">
                                    <span className="text-[10px] uppercase font-semibold text-spur-text-muted block">
                                        Version
                                    </span>
                                    <span className="font-mono text-xs text-spur-text">{version}</span>
                                </div>
                            )}
                            {authority && (
                                <div className="p-2 rounded bg-base-300/40 border border-spur-border">
                                    <span className="text-[10px] uppercase font-semibold text-spur-text-muted block">
                                        Authority
                                    </span>
                                    <span className="text-xs text-spur-text capitalize">{authority}</span>
                                </div>
                            )}
                        </div>

                        {/* Description or Owns callout */}
                        {(description || owns) && (
                            <div className="p-3 rounded-md bg-spur-accent/5 border border-spur-accent/20 space-y-1">
                                <span className="text-[10px] uppercase font-bold text-spur-accent block">
                                    {description ? 'Description' : 'Scope & Ownership'}
                                </span>
                                <p className="text-xs text-spur-text leading-relaxed">{description || owns}</p>
                            </div>
                        )}

                        {/* Dates & Owner */}
                        {(createdAt || updatedAt || owner) && (
                            <div className="p-3 rounded-md bg-base-300/30 border border-spur-border space-y-1.5 text-xs">
                                {owner && (
                                    <div className="flex items-center gap-2">
                                        <span className="text-spur-text-muted w-20 shrink-0">Owner</span>
                                        <span className="text-spur-text font-medium">{owner}</span>
                                    </div>
                                )}
                                {createdAt && (
                                    <div className="flex items-center gap-2">
                                        <span className="text-spur-text-muted w-20 shrink-0">Created</span>
                                        <span className="text-spur-text">{createdAt}</span>
                                        {createdAtRel && <span className="text-spur-text-muted">({createdAtRel})</span>}
                                    </div>
                                )}
                                {updatedAt && (
                                    <div className="flex items-center gap-2">
                                        <span className="text-spur-text-muted w-20 shrink-0">Updated</span>
                                        <span className="text-spur-text">{updatedAt}</span>
                                        {updatedAtRel && <span className="text-spur-text-muted">({updatedAtRel})</span>}
                                    </div>
                                )}
                            </div>
                        )}

                        {/* Tags */}
                        {tags.length > 0 && (
                            <div>
                                <span className="text-xs text-spur-text-muted block mb-1.5 font-medium">Tags</span>
                                <div className="flex flex-wrap gap-1.5">
                                    {tags.map((t) => (
                                        <Badge
                                            key={String(t)}
                                            variant="outline"
                                            size="xs"
                                            className="text-spur-text-muted border-spur-border"
                                        >
                                            {String(t)}
                                        </Badge>
                                    ))}
                                </div>
                            </div>
                        )}

                        {/* Other Structured Properties */}
                        {otherEntries.length > 0 && (
                            <div className="space-y-2">
                                <span className="text-xs text-spur-text-muted block font-medium">Other Properties</span>
                                <div className="divide-y divide-spur-border/60 rounded-md border border-spur-border bg-base-300/20 overflow-hidden">
                                    {otherEntries.map(([key, val]) => (
                                        <div
                                            key={key}
                                            className="flex flex-col sm:flex-row sm:items-start p-2.5 gap-2 text-xs"
                                        >
                                            <span
                                                className="font-mono font-medium text-spur-text-muted sm:w-36 shrink-0 truncate"
                                                title={key}
                                            >
                                                {key}
                                            </span>
                                            <div className="flex-1 min-w-0 break-words text-spur-text">
                                                {renderValue(val)}
                                            </div>
                                        </div>
                                    ))}
                                </div>
                            </div>
                        )}
                    </div>
                )}
            </div>

            {/* Modal Footer */}
            <div className="px-5 py-3 border-t border-spur-border bg-base-300/40 flex items-center justify-end shrink-0">
                <Button variant="ghost" size="xs" onClick={onClose} aria-label="Close">
                    Close
                </Button>
            </div>
        </Modal>
    );

    return typeof document !== 'undefined' ? createPortal(modalContent, document.body) : modalContent;
}
