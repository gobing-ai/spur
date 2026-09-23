import type { ProjectWorkflowsResponse, WorkflowDefinitionDto } from '@gobing-ai/spur-contracts';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { Button } from '@/ui';
import ResizeHandle from '../../components/ResizeHandle';
import { fetchWithTimeout, resolveApiUrl } from '../../lib/rpc-client';
import MarkdownBody from '../task-kanban/MarkdownBody';
import YamlViewer from './YamlViewer';

const workflowsUrl = () => `${resolveApiUrl()}/project/workflows`;
/** localStorage key for the user's last-set detail-panel width (matching task details). */
const DETAIL_WIDTH_KEY = 'spur:detail-width';

function getInitialDrawerWidth(): number {
    if (typeof window === 'undefined') return 1728;
    const maxAllowed = window.innerWidth * 0.8;
    try {
        const stored = Number.parseFloat(window.localStorage.getItem(DETAIL_WIDTH_KEY) ?? '');
        if (Number.isFinite(stored) && stored > 0) {
            return Math.min(stored, maxAllowed);
        }
    } catch {
        // localStorage unavailable
    }
    return Math.min(1728, maxAllowed);
}

const STEP_LEGEND_ITEMS = [
    {
        label: '🤖 agent.run',
        style: 'bg-[#e0e7ff] border-[#4f46e5] text-[#1e1b4b]',
        title: 'Agent run (prompt / slash command)',
    },
    { label: '💻 shell', style: 'bg-[#ecfdf5] border-[#059669] text-[#064e3b]', title: 'Shell command execution' },
    { label: '👤 hitl', style: 'bg-[#fdf4ff] border-[#9333ea] text-[#3b0764]', title: 'Human-in-the-loop decision' },
    { label: '🔒 gate', style: 'bg-[#e8e8f8] border-[#5b5bd6] text-[#1a1a5e]', title: 'Structural gate or probe' },
] as const;

const STATE_LEGEND_ITEMS = [
    { label: 'Initial', dot: 'bg-[#fff3cd] border-[#b8860b] rounded-full' },
    { label: 'Done', dot: 'bg-[#d4edda] border-[#1e7e34] rounded-full' },
    { label: 'Failed', dot: 'bg-[#f8d7da] border-[#c62828] rounded' },
] as const;

export default function WorkflowsView() {
    const [workflows, setWorkflows] = useState<WorkflowDefinitionDto[]>([]);
    const [selectedWorkflowName, setSelectedWorkflowName] = useState<string>('');
    const [loading, setLoading] = useState<boolean>(true);
    const [error, setError] = useState<string | null>(null);
    const [copied, setCopied] = useState<boolean>(false);
    const [zoom, setZoom] = useState<number>(1);
    const [direction, setDirection] = useState<'TD' | 'LR'>('TD');
    const [showYamlModal, setShowYamlModal] = useState<boolean>(false);
    // Default matching task details: ~1728px clamped to 80vw, or user's stored width
    const [drawerWidth, setDrawerWidth] = useState<number>(getInitialDrawerWidth);

    useEffect(() => {
        if (typeof document !== 'undefined') {
            document.documentElement.style.setProperty('--workflow-yaml-w', `${drawerWidth}px`);
        }
    }, [drawerWidth]);

    // Close YAML modal on Escape key
    useEffect(() => {
        if (!showYamlModal) return;
        const handleKeyDown = (e: KeyboardEvent) => {
            if (e.key === 'Escape') {
                setShowYamlModal(false);
            }
        };
        window.addEventListener('keydown', handleKeyDown);
        return () => window.removeEventListener('keydown', handleKeyDown);
    }, [showYamlModal]);

    const loadWorkflows = useCallback(async () => {
        setLoading(true);
        setError(null);
        try {
            const res = await fetchWithTimeout(new Request(workflowsUrl()));
            if (!res.ok) {
                throw new Error(`Failed to load workflows (${res.status})`);
            }
            const data = (await res.json()) as ProjectWorkflowsResponse;
            const list = data.workflows ?? [];
            setWorkflows(list);
            if (list.length > 0) {
                const first = list[0];
                if (first) {
                    setSelectedWorkflowName((prev) => {
                        const exists = list.some((w) => w.name === prev);
                        return exists ? prev : first.name;
                    });
                }
            }
        } catch (err) {
            setError(err instanceof Error ? err.message : String(err));
        } finally {
            setLoading(false);
        }
    }, []);

    useEffect(() => {
        loadWorkflows();
    }, [loadWorkflows]);

    const activeWorkflow: WorkflowDefinitionDto | undefined = useMemo(() => {
        return workflows.find((w) => w.name === selectedWorkflowName) ?? workflows[0];
    }, [workflows, selectedWorkflowName]);

    // Group workflows by layer for clean dropdown optgroups
    const groupedWorkflows = useMemo(() => {
        const groups: Record<string, WorkflowDefinitionDto[]> = {
            registered: [],
            project: [],
            shared: [],
        };
        for (const w of workflows) {
            const list = groups[w.source];
            if (list) {
                list.push(w);
            } else {
                groups[w.source] = [w];
            }
        }
        return groups;
    }, [workflows]);

    const workflowMarkdown = useMemo(() => {
        if (!activeWorkflow?.mermaidDiagram) return '';
        let diagram = activeWorkflow.mermaidDiagram.trim();
        if (!diagram.startsWith('```')) {
            diagram = `\`\`\`mermaid\n${diagram}\n\`\`\``;
        }
        if (direction === 'LR') {
            diagram = diagram.replace(/flowchart\s+(TD|TB)/g, 'flowchart LR');
        } else {
            diagram = diagram.replace(/flowchart\s+LR/g, 'flowchart TD');
        }
        return diagram;
    }, [activeWorkflow, direction]);

    const handleCopyYaml = useCallback(async () => {
        if (!activeWorkflow) return;
        try {
            await navigator.clipboard.writeText(activeWorkflow.rawYaml);
            setCopied(true);
            setTimeout(() => setCopied(false), 2000);
        } catch {
            // clipboard write error
        }
    }, [activeWorkflow]);

    return (
        <div className="flex flex-col h-full gap-4 overflow-y-auto pr-1" data-workflows-view>
            {/* Top Control Bar */}
            <div className="flex flex-wrap items-center justify-between gap-3 border-b border-spur-border/60 pb-3 shrink-0">
                {/* Left: View Title */}
                <div className="flex items-center gap-2">
                    <span className="text-base" aria-hidden="true">
                        📊
                    </span>
                    <span className="text-xs font-semibold text-spur-text tracking-wide">Workflow Diagram</span>
                </div>

                {/* Right: Workflow Dropdown Selector & Action Icons */}
                <div className="flex items-center gap-2.5">
                    {/* Workflow Select Dropdown */}
                    <div className="flex items-center gap-2">
                        <label
                            htmlFor="workflow-select"
                            className="text-xs font-medium text-spur-text-muted whitespace-nowrap"
                        >
                            Workflow:
                        </label>
                        <select
                            id="workflow-select"
                            value={activeWorkflow?.name ?? ''}
                            onChange={(e) => {
                                setSelectedWorkflowName(e.target.value);
                                setZoom(1);
                            }}
                            disabled={loading || workflows.length === 0}
                            className="bg-spur-surface-2 border border-spur-border text-spur-text text-xs rounded-lg px-2.5 py-1.5 font-mono focus:outline-none focus:ring-1 focus:ring-spur-accent cursor-pointer min-w-[220px]"
                            data-testid="workflow-select"
                        >
                            {Object.entries(groupedWorkflows).map(([layer, list]) =>
                                list.length > 0 ? (
                                    <optgroup key={layer} label={`${layer.toUpperCase()} (${list.length})`}>
                                        {list.map((wf) => (
                                            <option key={`${wf.source}-${wf.name}`} value={wf.name}>
                                                {wf.name} {wf.version ? `(v${wf.version})` : ''} - {wf.path}
                                            </option>
                                        ))}
                                    </optgroup>
                                ) : null,
                            )}
                        </select>
                    </div>

                    {/* Action Icon 1: Copy raw YAML */}
                    <button
                        type="button"
                        onClick={handleCopyYaml}
                        disabled={!activeWorkflow}
                        className="w-7 h-7 flex items-center justify-center text-xs font-medium bg-spur-surface-2 hover:bg-spur-surface-3 border border-spur-border text-spur-text rounded-lg transition-colors cursor-pointer disabled:opacity-50"
                        title={copied ? 'Copied raw YAML!' : 'Copy raw YAML'}
                        aria-label={copied ? 'Copied raw YAML!' : 'Copy raw YAML'}
                        data-testid="copy-workflow-btn"
                    >
                        {copied ? (
                            <span className="text-emerald-400 font-bold">✓</span>
                        ) : (
                            <svg
                                className="w-3.5 h-3.5"
                                viewBox="0 0 24 24"
                                fill="none"
                                stroke="currentColor"
                                strokeWidth="2"
                                strokeLinecap="round"
                                strokeLinejoin="round"
                                aria-hidden="true"
                            >
                                <rect x="9" y="9" width="13" height="13" rx="2" ry="2" />
                                <path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1" />
                            </svg>
                        )}
                    </button>

                    {/* Action Icon 2: View YAML in popup floating window */}
                    <button
                        type="button"
                        onClick={() => setShowYamlModal(true)}
                        disabled={!activeWorkflow}
                        className="w-7 h-7 flex items-center justify-center text-xs font-medium bg-spur-surface-2 hover:bg-spur-surface-3 border border-spur-border text-spur-text rounded-lg transition-colors cursor-pointer disabled:opacity-50"
                        title="View raw YAML"
                        aria-label="View raw YAML"
                        data-testid="view-yaml-btn"
                    >
                        <svg
                            className="w-3.5 h-3.5"
                            viewBox="0 0 24 24"
                            fill="none"
                            stroke="currentColor"
                            strokeWidth="2"
                            strokeLinecap="round"
                            strokeLinejoin="round"
                            aria-hidden="true"
                        >
                            <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" />
                            <polyline points="14 2 14 8 20 8" />
                            <line x1="16" y1="13" x2="8" y2="13" />
                            <line x1="16" y1="17" x2="8" y2="17" />
                            <polyline points="10 9 9 9 8 9" />
                        </svg>
                    </button>
                </div>
            </div>

            {/* Workflow Info Metadata Bar */}
            {activeWorkflow && (
                <div
                    className="flex flex-wrap items-center justify-between gap-3 px-3 py-2 bg-spur-surface-1 border border-spur-border/50 rounded-lg text-xs"
                    data-testid="workflow-meta"
                >
                    <div className="flex flex-wrap items-center gap-2">
                        <span className="font-semibold text-spur-text">{activeWorkflow.name}</span>
                        {activeWorkflow.version && (
                            <span className="px-2 py-0.5 rounded-full bg-spur-accent/15 text-spur-accent font-mono text-[11px] font-semibold border border-spur-accent/30">
                                v{activeWorkflow.version}
                            </span>
                        )}
                        <span className="px-2 py-0.5 rounded-full bg-spur-surface-3 text-spur-text-muted font-mono text-[11px] border border-spur-border">
                            {activeWorkflow.kind}
                        </span>
                        <span className="px-2 py-0.5 rounded-full bg-spur-surface-2 text-spur-text-secondary font-mono text-[11px] border border-spur-border">
                            {activeWorkflow.source}
                        </span>
                        <code className="text-spur-text-muted font-mono text-[11px] bg-black/20 px-1.5 py-0.5 rounded">
                            {activeWorkflow.path}
                        </code>
                    </div>

                    {activeWorkflow.description && (
                        <div
                            className="text-spur-text-muted text-[11px] max-w-xl truncate"
                            title={activeWorkflow.description}
                        >
                            {activeWorkflow.description}
                        </div>
                    )}
                </div>
            )}

            {/* Content Area: Direct Diagram View */}
            {loading ? (
                <div className="flex items-center justify-center h-64 text-spur-text-muted text-sm gap-2">
                    <span className="animate-spin text-base">⏳</span>
                    <span>Loading registered workflows...</span>
                </div>
            ) : error ? (
                <div className="p-4 bg-red-950/40 border border-red-800/60 rounded-xl text-red-200 text-xs flex flex-col gap-2">
                    <div className="font-semibold text-sm">Failed to load workflows</div>
                    <div>{error}</div>
                    <div>
                        <button
                            type="button"
                            onClick={loadWorkflows}
                            className="px-3 py-1.5 bg-red-900/60 hover:bg-red-800 border border-red-700 text-white rounded-lg text-xs font-semibold cursor-pointer w-fit"
                        >
                            Retry
                        </button>
                    </div>
                </div>
            ) : workflows.length === 0 ? (
                <div className="flex flex-col items-center justify-center h-64 text-spur-text-muted text-sm gap-2 bg-spur-surface-2/40 border border-dashed border-spur-border rounded-xl">
                    <span>No workflows found.</span>
                    <span className="text-xs text-spur-text-secondary">
                        Add workflow YAML files under <code className="font-mono">.spur/workflows/</code> or configured
                        paths.
                    </span>
                </div>
            ) : activeWorkflow ? (
                <div className="flex-1 flex flex-col gap-3 min-h-0" data-testid="workflow-diagram-view">
                    {/* Validation warning if invalid */}
                    {!activeWorkflow.valid && (
                        <div className="p-3 bg-amber-950/40 border border-amber-800/60 rounded-xl text-amber-200 text-xs flex items-center justify-between gap-3">
                            <div className="flex items-center gap-2">
                                <span>⚠️</span>
                                <span>
                                    Workflow failed validation: {activeWorkflow.error || 'Syntax or schema error'}
                                </span>
                            </div>
                            <button
                                type="button"
                                onClick={() => setShowYamlModal(true)}
                                className="px-2.5 py-1 bg-amber-900/60 hover:bg-amber-800 border border-amber-700 text-white rounded text-xs cursor-pointer shrink-0"
                            >
                                Inspect in YAML
                            </button>
                        </div>
                    )}

                    {/* Canvas Toolbar & Container */}
                    <div className="flex-1 flex flex-col min-h-[480px] bg-spur-surface-2/70 border border-spur-border rounded-xl overflow-hidden relative">
                        {/* Diagram Controls Bar: Direction + Zoom */}
                        <div className="flex flex-wrap items-center justify-between gap-3 px-4 py-2 bg-spur-surface-1/90 border-b border-spur-border/60 shrink-0">
                            {/* Left: Direction Toggle (Vertical vs Horizontal) */}
                            <div className="flex items-center gap-2">
                                <span className="text-xs text-spur-text-muted font-medium">Layout:</span>
                                <div className="inline-flex rounded-lg border border-spur-border bg-spur-surface-2 p-0.5 text-xs">
                                    <button
                                        type="button"
                                        onClick={() => setDirection('TD')}
                                        className={`px-2.5 py-1 rounded-md transition-colors cursor-pointer flex items-center gap-1 font-medium ${
                                            direction === 'TD'
                                                ? 'bg-spur-accent text-white shadow-sm'
                                                : 'text-spur-text-muted hover:text-spur-text'
                                        }`}
                                        data-testid="direction-td-btn"
                                    >
                                        <span>↕️ Vertical (TD)</span>
                                    </button>
                                    <button
                                        type="button"
                                        onClick={() => setDirection('LR')}
                                        className={`px-2.5 py-1 rounded-md transition-colors cursor-pointer flex items-center gap-1 font-medium ${
                                            direction === 'LR'
                                                ? 'bg-spur-accent text-white shadow-sm'
                                                : 'text-spur-text-muted hover:text-spur-text'
                                        }`}
                                        data-testid="direction-lr-btn"
                                    >
                                        <span>↔️ Horizontal (LR)</span>
                                    </button>
                                </div>
                            </div>

                            {/* Right: Diagram Zoom Controls */}
                            <div className="flex items-center gap-1 bg-spur-surface-2 border border-spur-border rounded-lg p-0.5 shadow-sm">
                                <button
                                    type="button"
                                    onClick={() => setZoom((z) => Math.max(0.4, Number((z - 0.15).toFixed(2))))}
                                    className="w-6 h-6 flex items-center justify-center text-xs font-bold text-spur-text-muted hover:text-spur-text hover:bg-spur-surface-3 rounded cursor-pointer transition-colors"
                                    title="Zoom out"
                                    data-testid="zoom-out-btn"
                                >
                                    −
                                </button>
                                <button
                                    type="button"
                                    onClick={() => setZoom(1)}
                                    className="px-2 h-6 flex items-center justify-center text-[11px] font-mono text-spur-text-muted hover:text-spur-text hover:bg-spur-surface-3 rounded cursor-pointer transition-colors"
                                    title="Reset zoom"
                                    data-testid="zoom-reset-btn"
                                >
                                    {Math.round(zoom * 100)}%
                                </button>
                                <button
                                    type="button"
                                    onClick={() => setZoom((z) => Math.min(2.5, Number((z + 0.15).toFixed(2))))}
                                    className="w-6 h-6 flex items-center justify-center text-xs font-bold text-spur-text-muted hover:text-spur-text hover:bg-spur-surface-3 rounded cursor-pointer transition-colors"
                                    title="Zoom in"
                                    data-testid="zoom-in-btn"
                                >
                                    +
                                </button>
                            </div>
                        </div>

                        {/* Mermaid Diagram Canvas */}
                        <div className="workflow-diagram-canvas flex-1 p-4 overflow-auto">
                            {workflowMarkdown ? (
                                <div
                                    style={{
                                        transform: `scale(${zoom})`,
                                        transformOrigin: 'top left',
                                        transition: 'transform 0.15s ease',
                                        width: zoom !== 1 ? `${(100 / zoom).toFixed(1)}%` : '100%',
                                    }}
                                >
                                    <MarkdownBody
                                        source={workflowMarkdown}
                                        style={{ backgroundColor: 'transparent' }}
                                    />
                                </div>
                            ) : (
                                <div className="text-spur-text-muted text-xs py-12 text-center">
                                    No diagram available for this workflow.
                                </div>
                            )}
                        </div>

                        {/* Color & Transition Legend Bar */}
                        <div
                            className="border-t border-spur-border/60 bg-spur-surface-1/70 px-4 py-2 flex flex-wrap items-center justify-between gap-y-2 gap-x-4 text-[11px] text-spur-text-muted shrink-0"
                            data-testid="diagram-legend"
                        >
                            {/* Action Kinds */}
                            <div className="flex flex-wrap items-center gap-3">
                                <span className="font-semibold text-spur-text-secondary text-[10px] uppercase tracking-wider">
                                    Steps:
                                </span>
                                {STEP_LEGEND_ITEMS.map((item) => (
                                    <div key={item.label} className="flex items-center gap-1.5" title={item.title}>
                                        <span
                                            className={`px-1.5 py-0.5 rounded border font-medium text-[10px] ${item.style}`}
                                        >
                                            {item.label}
                                        </span>
                                    </div>
                                ))}
                            </div>

                            {/* Transition Line Styles */}
                            <div className="flex flex-wrap items-center gap-3">
                                <span className="font-semibold text-spur-text-secondary text-[10px] uppercase tracking-wider">
                                    Transitions:
                                </span>
                                <div className="flex items-center gap-1.5" title="Direct or unconditional transition">
                                    <span className="font-mono text-spur-text-secondary font-bold">───▶</span>
                                    <span>Direct / Always</span>
                                </div>
                                <div
                                    className="flex items-center gap-1.5"
                                    title="Transition guarded by a shell condition"
                                >
                                    <span className="font-mono text-emerald-500 font-bold">- - ▶</span>
                                    <span className="text-emerald-400">Shell Guard</span>
                                </div>
                            </div>

                            {/* Lifecycle States */}
                            <div className="flex flex-wrap items-center gap-3">
                                <span className="font-semibold text-spur-text-secondary text-[10px] uppercase tracking-wider">
                                    State:
                                </span>
                                {STATE_LEGEND_ITEMS.map((item) => (
                                    <div key={item.label} className="flex items-center gap-1">
                                        <span className={`w-2.5 h-2.5 border ${item.dot}`} />
                                        <span>{item.label}</span>
                                    </div>
                                ))}
                            </div>
                        </div>
                    </div>
                </div>
            ) : null}

            {/* Popup Floating Window (Side Drawer): Workflow YAML Content aligned with Task Details */}
            {showYamlModal && activeWorkflow && (
                <>
                    {/* Backdrop */}
                    <button
                        type="button"
                        aria-label="Close YAML modal"
                        className="fixed inset-0 z-50 bg-black/40 border-0 p-0 cursor-default"
                        onClick={() => setShowYamlModal(false)}
                        data-testid="yaml-modal-backdrop"
                    />

                    {/* Side Drawer Dialog */}
                    <div
                        role="dialog"
                        aria-modal="true"
                        aria-label={`Workflow YAML: ${activeWorkflow.name}`}
                        className="fixed top-0 right-0 h-full z-50 bg-spur-surface border-l border-spur-border shadow-2xl flex"
                        style={{ width: 'var(--workflow-yaml-w, 1728px)', minWidth: '36rem', maxWidth: '80vw' }}
                        data-testid="yaml-modal"
                    >
                        <ResizeHandle
                            targetVar="--workflow-yaml-w"
                            onResizeEnd={(px) => {
                                const clamped = Math.max(576, Math.min(px, window.innerWidth * 0.8));
                                setDrawerWidth(clamped);
                                try {
                                    window.localStorage.setItem(DETAIL_WIDTH_KEY, String(clamped));
                                } catch {
                                    // localStorage unavailable
                                }
                            }}
                            direction="horizontal"
                            invert
                        />

                        <div className="flex flex-col flex-1 overflow-hidden bg-[#0d1117]">
                            {/* Header — title, file path, status/kind pills, line count, and close button */}
                            <div className="flex items-start justify-between gap-3 px-4 py-3 bg-spur-surface border-b border-spur-border shrink-0">
                                <div className="flex flex-col gap-1.5 overflow-hidden">
                                    <div className="flex items-center gap-2 flex-wrap">
                                        <h3 className="text-sm font-semibold text-spur-text truncate">
                                            {activeWorkflow.name}
                                        </h3>
                                        <code
                                            className="text-[11px] font-mono text-spur-text-muted bg-spur-surface-2 px-1.5 py-0.5 rounded border border-spur-border/60 truncate max-w-md"
                                            title={activeWorkflow.path}
                                        >
                                            {activeWorkflow.path}
                                        </code>
                                    </div>
                                    {/* Status pill + key workflow chips */}
                                    <div className="flex flex-wrap items-center gap-1.5" data-testid="header-chips">
                                        <span
                                            className="px-2 py-0.5 rounded-full border border-spur-border text-xs text-spur-text-muted font-mono"
                                            data-testid="kind-pill"
                                        >
                                            {activeWorkflow.kind}
                                        </span>
                                        {activeWorkflow.version && (
                                            <span className="px-2 py-0.5 rounded-full bg-spur-surface-2 border border-spur-border text-xs text-spur-text-muted font-mono">
                                                v{activeWorkflow.version}
                                            </span>
                                        )}
                                        <span className="px-2 py-0.5 rounded-full bg-spur-surface-2 border border-spur-border text-xs text-spur-text-muted font-mono">
                                            {activeWorkflow.source}
                                        </span>
                                        {activeWorkflow.valid ? (
                                            <span className="px-2 py-0.5 rounded-full border border-emerald-500/40 bg-emerald-500/10 text-emerald-400 text-xs font-mono">
                                                ✓ valid
                                            </span>
                                        ) : (
                                            <span className="px-2 py-0.5 rounded-full border border-amber-500/40 bg-amber-500/10 text-amber-400 text-xs font-mono">
                                                ⚠️ invalid
                                            </span>
                                        )}
                                        {activeWorkflow.description && (
                                            <span
                                                className="text-xs text-spur-text-muted truncate max-w-lg hidden sm:inline"
                                                title={activeWorkflow.description}
                                            >
                                                · {activeWorkflow.description}
                                            </span>
                                        )}
                                    </div>
                                </div>
                                <div className="flex items-center gap-3 shrink-0">
                                    <span className="text-xs text-spur-text-muted font-mono">
                                        {activeWorkflow.rawYaml.split('\n').length} lines
                                    </span>
                                    <Button
                                        variant="ghost"
                                        size="xs"
                                        className="text-spur-text-muted hover:text-spur-text"
                                        onClick={() => setShowYamlModal(false)}
                                        aria-label="Close YAML modal"
                                        data-testid="close-yaml-modal-btn"
                                    >
                                        ✕
                                    </Button>
                                </div>
                            </div>

                            {/* Code Body: Seamless full-height YamlViewer without blank area */}
                            <div className="flex-1 min-h-0 overflow-hidden" data-testid="yaml-body-section">
                                <YamlViewer
                                    code={activeWorkflow.rawYaml}
                                    filePath={activeWorkflow.path}
                                    hideToolbar
                                    maxHeight="none"
                                    className="h-full border-0 rounded-none bg-[#0d1117] shadow-none"
                                />
                            </div>
                        </div>
                    </div>
                </>
            )}
        </div>
    );
}
