import type { ProjectWorkflowsResponse, WorkflowDefinitionDto } from '@gobing-ai/spur-contracts';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { fetchWithTimeout, resolveApiUrl } from '../../lib/rpc-client';
import { MermaidBlock } from '../task-kanban/MarkdownBody';
import YamlViewer from './YamlViewer';

const workflowsUrl = () => `${resolveApiUrl()}/project/workflows`;

export type WorkflowSubtab = 'yaml' | 'diagram';

export default function WorkflowsView() {
    const [activeSubtab, setActiveSubtab] = useState<WorkflowSubtab>('yaml');
    const [workflows, setWorkflows] = useState<WorkflowDefinitionDto[]>([]);
    const [selectedWorkflowName, setSelectedWorkflowName] = useState<string>('');
    const [loading, setLoading] = useState<boolean>(true);
    const [error, setError] = useState<string | null>(null);
    const [copied, setCopied] = useState<boolean>(false);
    const [zoom, setZoom] = useState<number>(1);

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
            let layerList = groups[w.source];
            if (!layerList) {
                layerList = [];
                groups[w.source] = layerList;
            }
            layerList.push(w);
        }
        return groups;
    }, [workflows]);

    const handleCopy = useCallback(async () => {
        if (!activeWorkflow) return;
        const textToCopy = activeSubtab === 'yaml' ? activeWorkflow.rawYaml : activeWorkflow.mermaidDiagram;
        try {
            await navigator.clipboard.writeText(textToCopy);
            setCopied(true);
            setTimeout(() => setCopied(false), 2000);
        } catch {
            // clipboard write error
        }
    }, [activeWorkflow, activeSubtab]);

    const cleanMermaidDiagram = useMemo(() => {
        if (!activeWorkflow?.mermaidDiagram) return '';
        return activeWorkflow.mermaidDiagram
            .replace(/^```mermaid\s*/i, '')
            .replace(/```\s*$/, '')
            .trim();
    }, [activeWorkflow]);

    return (
        <div className="flex flex-col h-full gap-4 overflow-y-auto pr-1" data-workflows-view>
            {/* Top Control Bar */}
            <div className="flex flex-wrap items-center justify-between gap-3 border-b border-spur-border/60 pb-3 shrink-0">
                {/* Left: View Mode Subtabs (YAML vs Diagram) */}
                <div
                    role="tablist"
                    aria-label="Workflow view modes"
                    className="flex items-center gap-1.5 p-1 bg-spur-surface-2 border border-spur-border rounded-xl"
                    data-view-subtabs
                >
                    <button
                        type="button"
                        role="tab"
                        aria-selected={activeSubtab === 'yaml'}
                        aria-controls="workflow-panel-yaml"
                        id="workflow-subtab-yaml"
                        onClick={() => setActiveSubtab('yaml')}
                        className={`px-3 py-1.5 text-xs font-semibold rounded-lg transition-all cursor-pointer flex items-center gap-2 ${
                            activeSubtab === 'yaml'
                                ? 'bg-spur-accent text-white shadow-sm'
                                : 'text-spur-text-muted hover:text-spur-text hover:bg-spur-surface-3'
                        }`}
                        data-subtab="yaml"
                    >
                        <span>📝 YAML</span>
                    </button>
                    <button
                        type="button"
                        role="tab"
                        aria-selected={activeSubtab === 'diagram'}
                        aria-controls="workflow-panel-diagram"
                        id="workflow-subtab-diagram"
                        onClick={() => setActiveSubtab('diagram')}
                        className={`px-3 py-1.5 text-xs font-semibold rounded-lg transition-all cursor-pointer flex items-center gap-2 ${
                            activeSubtab === 'diagram'
                                ? 'bg-spur-accent text-white shadow-sm'
                                : 'text-spur-text-muted hover:text-spur-text hover:bg-spur-surface-3'
                        }`}
                        data-subtab="diagram"
                    >
                        <span>📊 Diagram</span>
                    </button>
                </div>

                {/* Right: Workflow Dropdown Selector & Copy Button */}
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

                    {/* Copy Button */}
                    <button
                        type="button"
                        onClick={handleCopy}
                        disabled={!activeWorkflow}
                        className="px-2.5 py-1 text-xs font-medium bg-spur-surface-2 hover:bg-spur-surface-3 border border-spur-border text-spur-text rounded-lg transition-colors flex items-center gap-1.5 cursor-pointer disabled:opacity-50"
                        title={activeSubtab === 'yaml' ? 'Copy raw YAML' : 'Copy Mermaid code'}
                        data-testid="copy-workflow-btn"
                    >
                        {copied ? (
                            <>
                                <span className="text-emerald-400">✓</span>
                                <span className="text-emerald-400 font-semibold">Copied!</span>
                            </>
                        ) : (
                            <>
                                <span>📋</span>
                                <span>{activeSubtab === 'yaml' ? 'Copy YAML' : 'Copy Mermaid'}</span>
                            </>
                        )}
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

            {/* Content Area */}
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
                <div className="flex-1 flex flex-col min-h-0">
                    {/* View 1: YAML Viewer */}
                    {activeSubtab === 'yaml' && (
                        <div
                            id="workflow-panel-yaml"
                            role="tabpanel"
                            aria-labelledby="workflow-subtab-yaml"
                            className="flex-1 min-h-0"
                        >
                            <YamlViewer code={activeWorkflow.rawYaml} filePath={activeWorkflow.path} />
                        </div>
                    )}

                    {/* View 2: Mermaid Diagram Viewer */}
                    {activeSubtab === 'diagram' && (
                        <div
                            id="workflow-panel-diagram"
                            role="tabpanel"
                            aria-labelledby="workflow-subtab-diagram"
                            className="flex-1 flex flex-col gap-3 min-h-0"
                            data-testid="workflow-diagram-view"
                        >
                            {/* Validation warning if invalid */}
                            {!activeWorkflow.valid && (
                                <div className="p-3 bg-amber-950/40 border border-amber-800/60 rounded-xl text-amber-200 text-xs flex items-center justify-between gap-3">
                                    <div className="flex items-center gap-2">
                                        <span>⚠️</span>
                                        <span>
                                            Workflow failed validation:{' '}
                                            {activeWorkflow.error || 'Syntax or schema error'}
                                        </span>
                                    </div>
                                    <button
                                        type="button"
                                        onClick={() => setActiveSubtab('yaml')}
                                        className="px-2.5 py-1 bg-amber-900/60 hover:bg-amber-800 border border-amber-700 text-white rounded text-xs cursor-pointer shrink-0"
                                    >
                                        Inspect in YAML
                                    </button>
                                </div>
                            )}

                            {/* Canvas Toolbar & Container */}
                            <div className="flex-1 flex flex-col min-h-[480px] bg-spur-surface-2/70 border border-spur-border rounded-xl overflow-hidden relative">
                                {/* Diagram Zoom Controls */}
                                <div className="absolute top-3 right-3 z-10 flex items-center gap-1 bg-spur-surface-1/90 backdrop-blur border border-spur-border rounded-lg p-1 shadow-md">
                                    <button
                                        type="button"
                                        onClick={() => setZoom((z) => Math.max(0.4, Number((z - 0.15).toFixed(2))))}
                                        className="w-7 h-7 flex items-center justify-center text-xs font-bold text-spur-text-muted hover:text-spur-text hover:bg-spur-surface-3 rounded cursor-pointer transition-colors"
                                        title="Zoom out"
                                        data-testid="zoom-out-btn"
                                    >
                                        −
                                    </button>
                                    <button
                                        type="button"
                                        onClick={() => setZoom(1)}
                                        className="px-2 h-7 flex items-center justify-center text-[11px] font-mono text-spur-text-muted hover:text-spur-text hover:bg-spur-surface-3 rounded cursor-pointer transition-colors"
                                        title="Reset zoom"
                                        data-testid="zoom-reset-btn"
                                    >
                                        {Math.round(zoom * 100)}%
                                    </button>
                                    <button
                                        type="button"
                                        onClick={() => setZoom((z) => Math.min(2.5, Number((z + 0.15).toFixed(2))))}
                                        className="w-7 h-7 flex items-center justify-center text-xs font-bold text-spur-text-muted hover:text-spur-text hover:bg-spur-surface-3 rounded cursor-pointer transition-colors"
                                        title="Zoom in"
                                        data-testid="zoom-in-btn"
                                    >
                                        +
                                    </button>
                                </div>

                                {/* Mermaid Diagram Canvas */}
                                <div className="flex-1 p-6 overflow-auto flex items-center justify-center">
                                    {cleanMermaidDiagram ? (
                                        <div
                                            style={{
                                                transform: `scale(${zoom})`,
                                                transformOrigin: 'top center',
                                                transition: 'transform 0.15s ease',
                                            }}
                                            className="w-full flex justify-center"
                                        >
                                            <MermaidBlock code={cleanMermaidDiagram} />
                                        </div>
                                    ) : (
                                        <div className="text-spur-text-muted text-xs">
                                            No diagram available for this workflow.
                                        </div>
                                    )}
                                </div>

                                {/* Color Legend Bar */}
                                <div className="border-t border-spur-border/60 bg-spur-surface-1/60 px-4 py-2 flex flex-wrap items-center justify-center gap-4 text-[11px] text-spur-text-muted shrink-0">
                                    <div className="flex items-center gap-1.5">
                                        <span className="w-2.5 h-2.5 rounded-full bg-[#fff3cd] border border-[#b8860b]" />
                                        <span>Initial</span>
                                    </div>
                                    <div className="flex items-center gap-1.5">
                                        <span className="w-2.5 h-2.5 rounded bg-spur-surface-3 border border-spur-border" />
                                        <span>Action / State</span>
                                    </div>
                                    <div className="flex items-center gap-1.5">
                                        <span className="w-2.5 h-2.5 rounded bg-[#e8e8f8] border border-[#5b5bd6]" />
                                        <span>Gate / Decision</span>
                                    </div>
                                    <div className="flex items-center gap-1.5">
                                        <span className="w-2.5 h-2.5 rounded-full bg-[#d4edda] border border-[#1e7e34]" />
                                        <span>Terminal (Done)</span>
                                    </div>
                                    <div className="flex items-center gap-1.5">
                                        <span className="w-2.5 h-2.5 rounded bg-[#f8d7da] border border-[#c62828]" />
                                        <span>Failure / Cancelled</span>
                                    </div>
                                </div>
                            </div>
                        </div>
                    )}
                </div>
            ) : null}
        </div>
    );
}
