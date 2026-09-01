import type { HistoryTokens, HistoryToolCallItem, HistoryToolCategory } from '@gobing-ai/spur-contracts';
import type React from 'react';
import { useMemo, useRef, useState } from 'react';
import { AgentIcon } from './AgentIcon';

export const CATEGORY_COLOR: Record<HistoryToolCategory, string> = {
    read: '#10b981',
    write: '#eab308',
    bash: '#3b82f6',
    search: '#a855f7',
    mcp: '#6366f1',
    other: '#64748b',
};

export const CATEGORY_BG_CLASS: Record<HistoryToolCategory, string> = {
    read: 'bg-emerald-500/15 text-emerald-400 border-emerald-500/30',
    write: 'bg-amber-500/15 text-amber-400 border-amber-500/30',
    bash: 'bg-blue-500/15 text-blue-400 border-blue-500/30',
    search: 'bg-purple-500/15 text-purple-400 border-purple-500/30',
    mcp: 'bg-indigo-500/15 text-indigo-400 border-indigo-500/30',
    other: 'bg-slate-500/15 text-slate-300 border-slate-500/30',
};

/**
 * Supported syntax highlighting languages for tool payload values.
 */
export type SyntaxLanguage = 'json' | 'bash' | 'diff' | 'markdown' | 'text';

/**
 * Config-driven syntax highlighting rule for a tool.
 */
export interface ToolSyntaxRule {
    /** Target language for the raw payload or primary command string */
    defaultLanguage: SyntaxLanguage;
    /** Field-level language overrides within JSON payloads */
    fieldLanguages?: Record<string, SyntaxLanguage>;
}

/**
 * Configurable syntax highlighting registry for tool arguments.
 */
export const DEFAULT_TOOL_SYNTAX_RULES: Record<string, ToolSyntaxRule> = {
    bash: { defaultLanguage: 'bash' },
    Bash: { defaultLanguage: 'bash' },
    shell: { defaultLanguage: 'bash' },
    exec: { defaultLanguage: 'bash' },
    run_command: {
        defaultLanguage: 'json',
        fieldLanguages: {
            CommandLine: 'bash',
            command: 'bash',
            cmd: 'bash',
            script: 'bash',
        },
    },
    view_file: { defaultLanguage: 'json' },
    read: { defaultLanguage: 'json' },
    Read: { defaultLanguage: 'json' },
    write: { defaultLanguage: 'json', fieldLanguages: { CodeContent: 'text', content: 'text' } },
    Write: { defaultLanguage: 'json', fieldLanguages: { content: 'text' } },
    write_to_file: { defaultLanguage: 'json', fieldLanguages: { CodeContent: 'text' } },
    edit: {
        defaultLanguage: 'json',
        fieldLanguages: { TargetContent: 'diff', ReplacementContent: 'diff', old_string: 'diff', new_string: 'diff' },
    },
    Edit: {
        defaultLanguage: 'json',
        fieldLanguages: { TargetContent: 'diff', ReplacementContent: 'diff', old_string: 'diff', new_string: 'diff' },
    },
    replace_file_content: {
        defaultLanguage: 'json',
        fieldLanguages: {
            TargetContent: 'diff',
            ReplacementContent: 'diff',
        },
    },
    grep_search: { defaultLanguage: 'json' },
    find_by_name: { defaultLanguage: 'json' },
};

/**
 * Resolve the syntax highlighting rule for a given tool name.
 */
export function getToolSyntaxRule(toolName: string): ToolSyntaxRule {
    const lower = toolName.toLowerCase();
    for (const [key, rule] of Object.entries(DEFAULT_TOOL_SYNTAX_RULES)) {
        if (key.toLowerCase() === lower) return rule;
    }
    if (lower.includes('bash') || lower.includes('command') || lower.includes('exec') || lower.includes('terminal')) {
        return { defaultLanguage: 'bash' };
    }
    if (lower.includes('edit') || lower.includes('patch') || lower.includes('replace')) {
        return {
            defaultLanguage: 'json',
            fieldLanguages: {
                TargetContent: 'diff',
                ReplacementContent: 'diff',
                old_string: 'diff',
                new_string: 'diff',
            },
        };
    }
    return { defaultLanguage: 'json' };
}

/**
 * Classify a tool name into a standard HistoryToolCategory.
 */
export function getToolCategory(toolName: string): HistoryToolCategory {
    const t = toolName.toLowerCase();
    if (t.includes('read') || t.includes('view') || t.includes('cat') || t.includes('get_file')) return 'read';
    if (
        t.includes('write') ||
        t.includes('edit') ||
        t.includes('patch') ||
        t.includes('replace') ||
        t.includes('delete')
    )
        return 'write';
    if (
        t.includes('bash') ||
        t.includes('command') ||
        t.includes('terminal') ||
        t.includes('exec') ||
        t.includes('shell')
    )
        return 'bash';
    if (t.includes('search') || t.includes('grep') || t.includes('glob') || t.includes('find')) return 'search';
    if (t.startsWith('mcp') || t.includes('mcp_') || t.includes('call_mcp')) return 'mcp';
    return 'other';
}

/**
 * Format token count with commas.
 */
export const formatTokens = (value: number): string => Math.round(value).toLocaleString();

/**
 * Format a file path into a concise, readable relative or base path.
 */
export function formatFilePath(filePath: string): string {
    if (!filePath) return '';
    const clean = filePath.replace(/^\/?(Users|home)\/[^/]+\/[^/]+\/[^/]+\//, '');
    return clean || filePath;
}

/**
 * Format ISO timestamp into local or UTC readable clock string.
 */
export function formatTimeDisplay(ts?: string | null): string {
    if (!ts) return '—';
    try {
        const d = new Date(ts);
        if (Number.isNaN(d.getTime())) return ts;
        return d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: false });
    } catch {
        return ts;
    }
}

/**
 * Extract a human-readable primary value from a tool call for at-a-glance comprehension.
 */
export function formatToolDisplayValue(item: {
    toolName: string;
    category?: HistoryToolCategory;
    argsRaw?: string | null;
    argsDigest?: string | null;
}): string {
    const raw = item.argsRaw;
    const digest = item.argsDigest;

    if (raw) {
        try {
            const parsed = JSON.parse(raw);
            if (parsed && typeof parsed === 'object') {
                // 1. Subagent / Agent coordination tools
                if (parsed.Subagents && Array.isArray(parsed.Subagents) && parsed.Subagents.length > 0) {
                    const sub = parsed.Subagents[0];
                    const role = sub.Role || sub.TypeName || 'subagent';
                    const prompt = sub.Prompt ? ` — ${String(sub.Prompt).replace(/\s+/g, ' ').slice(0, 80)}` : '';
                    const count = parsed.Subagents.length > 1 ? ` (+${parsed.Subagents.length - 1} more)` : '';
                    return `${role}${count}${prompt}`;
                }
                if (parsed.Recipient || parsed.recipient) {
                    const recipient = parsed.Recipient || parsed.recipient;
                    const msg = parsed.Message || parsed.message || '';
                    const msgSnippet = msg ? `: ${String(msg).replace(/\s+/g, ' ').slice(0, 80)}` : '';
                    return `→ ${recipient}${msgSnippet}`;
                }
                if (parsed.Role || parsed.TypeName || parsed.agent_name || parsed.agent) {
                    const agent = parsed.Role || parsed.TypeName || parsed.agent_name || parsed.agent;
                    const prompt = parsed.Prompt || parsed.prompt || parsed.description || parsed.instruction || '';
                    return prompt ? `${agent} — ${String(prompt).replace(/\s+/g, ' ').slice(0, 80)}` : String(agent);
                }

                // 2. Skill / SlashCommand tools
                const skillName =
                    parsed.skill ||
                    parsed.skill_name ||
                    parsed.skillName ||
                    (item.toolName.toLowerCase().includes('skill') && (parsed.name || parsed.skill)) ||
                    parsed.command_name ||
                    parsed.commandName;
                if (skillName && typeof skillName === 'string') {
                    const argsVal = parsed.args || parsed.prompt || parsed.input || parsed.parameters || '';
                    const argsSnippet = argsVal ? ` — ${String(argsVal).replace(/\s+/g, ' ').slice(0, 80)}` : '';
                    return `${skillName}${argsSnippet}`;
                }
                if (
                    typeof parsed.command === 'string' &&
                    (parsed.command.startsWith('/') || parsed.command.startsWith('sp:'))
                ) {
                    const argsVal = parsed.args || '';
                    const argsSnippet = argsVal ? ` — ${String(argsVal).replace(/\s+/g, ' ').slice(0, 80)}` : '';
                    return `${parsed.command}${argsSnippet}`;
                }

                // 3. Web / URL fetch tools
                const urlVal = parsed.Url || parsed.url;
                if (urlVal && typeof urlVal === 'string' && /^https?:\/\//i.test(urlVal)) {
                    return urlVal;
                }

                // 4. Read / View / File write tools
                const pathVal =
                    parsed.AbsolutePath ||
                    parsed.TargetFile ||
                    parsed.targetFile ||
                    parsed.path ||
                    parsed.file ||
                    parsed.filePath ||
                    parsed.file_path ||
                    parsed.filename ||
                    parsed.SearchDirectory ||
                    parsed.searchDirectory ||
                    parsed.uri ||
                    parsed.Uri;

                if (pathVal && typeof pathVal === 'string') {
                    const formattedPath = formatFilePath(pathVal);
                    if (parsed.StartLine !== undefined && parsed.EndLine !== undefined) {
                        return `${formattedPath} (L${parsed.StartLine}-${parsed.EndLine})`;
                    }
                    if (parsed.StartLine !== undefined) {
                        return `${formattedPath} (L${parsed.StartLine}+)`;
                    }
                    if (parsed.Instruction || parsed.Description) {
                        const instr = String(parsed.Instruction || parsed.Description)
                            .replace(/\s+/g, ' ')
                            .slice(0, 60);
                        return `${formattedPath} — ${instr}`;
                    }
                    return formattedPath;
                }

                // 5. Search / Grep / Find tools
                const queryVal = parsed.Query || parsed.query || parsed.Pattern || parsed.pattern || parsed.search_term;
                if (queryVal && typeof queryVal === 'string') {
                    const searchPath = parsed.SearchPath || parsed.searchPath || parsed.SearchDirectory || parsed.path;
                    const pathSuffix = searchPath ? ` in ${formatFilePath(String(searchPath))}` : '';
                    return `"${queryVal}"${pathSuffix}`;
                }

                // 6. Bash / Command tools
                const cmdVal = parsed.CommandLine || parsed.command || parsed.cmd || parsed.script;
                if (cmdVal && typeof cmdVal === 'string') {
                    return cmdVal;
                }

                // 7. MCP tools
                if (parsed.ToolName || parsed.toolName) {
                    const mcpTool = parsed.ToolName || parsed.toolName;
                    const server =
                        parsed.ServerName || parsed.serverName ? `${parsed.ServerName || parsed.serverName}: ` : '';
                    return `${server}${mcpTool}`;
                }

                // 8. Generic object keys: find first meaningful string
                for (const key of Object.keys(parsed)) {
                    const val = parsed[key];
                    if (
                        typeof val === 'string' &&
                        val.length > 0 &&
                        !key.toLowerCase().includes('token') &&
                        !key.toLowerCase().includes('action') &&
                        !key.toLowerCase().includes('summary')
                    ) {
                        if (/^[a-f0-9]{32,}$/i.test(val)) {
                            return `${key}: ${val.slice(0, 8)}…${val.slice(-6)}`;
                        }
                        return `${key}: ${val.replace(/\s+/g, ' ').slice(0, 80)}`;
                    }
                }
            }
        } catch {
            if (/^[a-f0-9]{32,}$/i.test(raw.trim())) {
                return `${raw.trim().slice(0, 8)}…${raw.trim().slice(-6)}`;
            }
            return raw;
        }
    }

    if (digest) {
        if (/^[a-f0-9]{32,}$/i.test(digest.trim())) {
            return `digest: ${digest.trim().slice(0, 8)}…${digest.trim().slice(-6)}`;
        }
        return digest;
    }

    return '—';
}

// ─── Lightweight Syntax Highlighting Engine ───────────────────────────────────

/**
 * Highlight Bash/Shell script string.
 */
export const highlightBash = (code: string): React.ReactNode => {
    // Tokenize bash into keywords, flags, strings, variables, operators, and commands
    const lines = code.split('\n');
    const elements: React.ReactNode[] = [];
    let lineIdx = 0;

    for (const line of lines) {
        const lineKey = `bash-line-${lineIdx++}-${line.slice(0, 16)}`;
        // Regex for bash tokens
        const tokenRegex =
            /("(?:[^"\\]|\\.)*"|'(?:[^'\\]|\\.)*'|#.*|\$[a-zA-Z_0-9{}]*|--?[a-zA-Z0-9_-]+|&&|\|\||[|>;<]|(?:\b(?:bun|npm|pnpm|npx|node|git|sed|grep|cat|cd|mkdir|rm|cp|mv|echo|export|if|then|else|fi|for|do|done|case|esac|return|exit|spur|superskill)\b)|[^\s"'$#|><;&]+|\s+)/g;

        const tokens: React.ReactNode[] = [];
        let tokIdx = 0;
        let match = tokenRegex.exec(line);

        while (match !== null) {
            const tok = match[0];
            const key = `${lineKey}-tok-${tokIdx++}`;

            if (tok.startsWith('#')) {
                tokens.push(
                    <span key={key} className="text-base-content/40 italic">
                        {tok}
                    </span>,
                );
            } else if (tok.startsWith('"') || tok.startsWith("'")) {
                tokens.push(
                    <span key={key} className="text-emerald-400">
                        {tok}
                    </span>,
                );
            } else if (tok.startsWith('$')) {
                tokens.push(
                    <span key={key} className="text-pink-400 font-semibold">
                        {tok}
                    </span>,
                );
            } else if (tok.startsWith('-')) {
                tokens.push(
                    <span key={key} className="text-cyan-400">
                        {tok}
                    </span>,
                );
            } else if (
                /^(bun|npm|pnpm|npx|node|git|sed|grep|cat|cd|mkdir|rm|cp|mv|echo|export|if|then|else|fi|for|do|done|case|esac|return|exit|spur|superskill)$/.test(
                    tok,
                )
            ) {
                tokens.push(
                    <span key={key} className="text-amber-300 font-bold">
                        {tok}
                    </span>,
                );
            } else if (/^(&&|\|\||[|>;<])$/.test(tok)) {
                tokens.push(
                    <span key={key} className="text-purple-400 font-bold">
                        {tok}
                    </span>,
                );
            } else {
                tokens.push(
                    <span key={key} className="text-base-content/90">
                        {tok}
                    </span>,
                );
            }
            match = tokenRegex.exec(line);
        }

        elements.push(
            <div key={lineKey} className="leading-5">
                {tokens.length > 0 ? tokens : ' '}
            </div>,
        );
    }
    return elements;
};

/**
 * Highlight Diff/Patch text.
 */
export const highlightDiff = (code: string): React.ReactNode => {
    const lines = code.split('\n');
    const elements: React.ReactNode[] = [];
    let idx = 0;

    for (const line of lines) {
        const lineKey = `diff-line-${idx++}-${line.slice(0, 16)}`;
        let className = 'text-base-content/80 leading-5';
        if (line.startsWith('+') && !line.startsWith('+++')) {
            className = 'text-emerald-300 bg-emerald-950/40 rounded-xs px-1 leading-5';
        } else if (line.startsWith('-') && !line.startsWith('---')) {
            className = 'text-rose-300 bg-rose-950/40 rounded-xs px-1 leading-5';
        } else if (line.startsWith('@@')) {
            className = 'text-cyan-400 font-bold leading-5';
        }
        elements.push(
            <div key={lineKey} className={className}>
                {line || ' '}
            </div>,
        );
    }
    return elements;
};

/**
 * Render JSON payload with config-driven field-level syntax highlighting.
 */
export const highlightJson = (rawJson: string, rule: ToolSyntaxRule): React.ReactNode => {
    try {
        const obj = JSON.parse(rawJson);
        if (!obj || typeof obj !== 'object' || Array.isArray(obj)) {
            return highlightGenericJson(rawJson);
        }

        const keys = Object.keys(obj);
        return (
            <div className="flex flex-col gap-1 font-mono text-[11px]">
                <span className="text-base-content/50">{'{'}</span>
                <div className="pl-3.5 flex flex-col gap-1.5 border-l border-base-content/10 my-0.5">
                    {keys.map((k) => {
                        const val = obj[k];
                        const fieldLang = rule.fieldLanguages?.[k];

                        if (typeof val === 'string' && fieldLang === 'bash') {
                            return (
                                <div key={k} className="flex flex-col gap-1">
                                    <div className="text-sky-300 font-semibold">
                                        &quot;{k}&quot;<span className="text-base-content/60">: (bash)</span>
                                    </div>
                                    <div className="p-2 bg-base-200/90 rounded-md border border-base-content/10 overflow-x-auto whitespace-pre">
                                        {highlightBash(val)}
                                    </div>
                                </div>
                            );
                        }

                        if (typeof val === 'string' && fieldLang === 'diff') {
                            return (
                                <div key={k} className="flex flex-col gap-1">
                                    <div className="text-sky-300 font-semibold">
                                        &quot;{k}&quot;<span className="text-base-content/60">: (diff/patch)</span>
                                    </div>
                                    <div className="p-2 bg-base-200/90 rounded-md border border-base-content/10 overflow-x-auto whitespace-pre max-h-48 overflow-y-auto">
                                        {highlightDiff(val)}
                                    </div>
                                </div>
                            );
                        }

                        if (typeof val === 'string' && val.includes('\n')) {
                            return (
                                <div key={k} className="flex flex-col gap-1">
                                    <div className="text-sky-300 font-semibold">&quot;{k}&quot;:</div>
                                    <pre className="p-2 bg-base-200/90 rounded-md border border-base-content/10 overflow-x-auto whitespace-pre-wrap text-emerald-400 max-h-40 overflow-y-auto">
                                        {val}
                                    </pre>
                                </div>
                            );
                        }

                        // Standard one-line field
                        let valueNode: React.ReactNode;
                        if (typeof val === 'string') {
                            valueNode = <span className="text-emerald-400">&quot;{val}&quot;</span>;
                        } else if (typeof val === 'number') {
                            valueNode = <span className="text-amber-300">{val}</span>;
                        } else if (typeof val === 'boolean') {
                            valueNode = <span className="text-purple-400 font-bold">{val ? 'true' : 'false'}</span>;
                        } else if (val === null) {
                            valueNode = <span className="text-slate-400 italic">null</span>;
                        } else {
                            valueNode = (
                                <span className="text-base-content/80 whitespace-pre">
                                    {JSON.stringify(val, null, 2)}
                                </span>
                            );
                        }

                        return (
                            <div key={k} className="flex items-start gap-1 flex-wrap break-all leading-relaxed">
                                <span className="text-sky-300 font-semibold shrink-0">&quot;{k}&quot;:</span>
                                {valueNode}
                            </div>
                        );
                    })}
                </div>
                <span className="text-base-content/50">{'}'}</span>
            </div>
        );
    } catch {
        // Fallback to bash or generic highlighting
        if (rule.defaultLanguage === 'bash') {
            return highlightBash(rawJson);
        }
        return highlightGenericJson(rawJson);
    }
};

/**
 * Generic tokenizer for raw JSON fallback.
 */
function highlightGenericJson(jsonStr: string): React.ReactNode {
    const lines = jsonStr.split('\n');
    const elements: React.ReactNode[] = [];
    let idx = 0;

    for (const line of lines) {
        const lineKey = `json-line-${idx++}-${line.slice(0, 16)}`;
        const parts = line.split(/("(?:[^"\\]|\\.)*")/g);
        const spans: React.ReactNode[] = [];
        let pIdx = 0;
        for (const part of parts) {
            const key = `${lineKey}-p-${pIdx++}`;
            if (part.startsWith('"') && part.endsWith('"')) {
                const isKey = line.indexOf(part) < line.indexOf(':') && line.includes(':');
                spans.push(
                    <span key={key} className={isKey ? 'text-sky-300 font-semibold' : 'text-emerald-400'}>
                        {part}
                    </span>,
                );
            } else if (/\b(true|false|null)\b/.test(part)) {
                spans.push(
                    <span key={key} className="text-purple-400">
                        {part}
                    </span>,
                );
            } else if (/\b\d+(\.\d+)?\b/.test(part)) {
                spans.push(
                    <span key={key} className="text-amber-300">
                        {part}
                    </span>,
                );
            } else {
                spans.push(
                    <span key={key} className="text-base-content/80">
                        {part}
                    </span>,
                );
            }
        }
        elements.push(
            <div key={lineKey} className="leading-5 whitespace-pre">
                {spans}
            </div>,
        );
    }
    return elements;
}

/**
 * Config-driven syntax highlighted code renderer.
 */
export const CodeHighlight: React.FC<{
    code: string;
    toolName?: string;
    language?: SyntaxLanguage;
    className?: string;
}> = ({ code, toolName = '', language, className = '' }) => {
    const rule = useMemo(() => getToolSyntaxRule(toolName), [toolName]);
    const activeLang = language ?? rule.defaultLanguage;

    const rendered = useMemo(() => {
        if (activeLang === 'bash') {
            return highlightBash(code);
        }
        if (activeLang === 'diff') {
            return highlightDiff(code);
        }
        return highlightJson(code, rule);
    }, [code, activeLang, rule]);

    return <div className={`font-mono text-[11px] select-text cursor-text ${className}`}>{rendered}</div>;
};

// ─── Unified AgentBadge Component ─────────────────────────────────────────────

export interface AgentBadgeProps {
    agentId: string;
    model?: string | null;
    timestamp?: string | null;
    tooltipId?: string;
    freshInputTokens?: number;
    cacheReadTokens?: number;
    outputTokens?: number;
    promptTokens?: HistoryTokens | null;
    sessionId?: string;
    exitCode?: number | null;
    className?: string;
}

/**
 * Unified coding agent badge with comprehensive combined tooltip (Agent/Model + Timestamp + Tokens + Session).
 */
export const AgentBadge: React.FC<AgentBadgeProps> = ({
    agentId,
    model = '—',
    timestamp,
    tooltipId: explicitTooltipId,
    freshInputTokens = 0,
    cacheReadTokens = 0,
    outputTokens = 0,
    sessionId,
    className = '',
}) => {
    const [open, setOpen] = useState(false);
    const autoTooltipId = useMemo(
        () => `agent-badge-tt-${agentId}-${Math.random().toString(36).slice(2, 7)}`,
        [agentId],
    );
    const tooltipId = explicitTooltipId || autoTooltipId;

    const totalTokens = freshInputTokens + cacheReadTokens + outputTokens;

    return (
        <div className={`relative inline-flex items-center z-30 ${className}`}>
            <button
                type="button"
                aria-describedby={tooltipId}
                aria-label={`Coding agent ${agentId} icon and metadata`}
                className="p-1 rounded-md bg-base-300 border border-base-content/15 hover:border-primary text-base-content/80 hover:text-primary transition-colors cursor-pointer focus:outline-none focus-visible:ring-2 focus-visible:ring-primary shrink-0"
                onMouseEnter={() => setOpen(true)}
                onMouseLeave={() => setOpen(false)}
                onFocus={() => setOpen(true)}
                onBlur={() => setOpen(false)}
                onKeyDown={(e) => {
                    if (e.key === 'Escape') setOpen(false);
                }}
                data-testid={`agent-badge-${tooltipId}`}
            >
                <AgentIcon id={agentId} />
            </button>

            {open && (
                <div
                    id={tooltipId}
                    role="tooltip"
                    data-testid={tooltipId}
                    className="absolute left-0 top-full z-50 mt-1.5 w-64 p-3 rounded-xl bg-base-300 border border-base-content/20 shadow-2xl text-[11px] font-mono leading-relaxed pointer-events-none backdrop-blur-md flex flex-col gap-2.5 select-none"
                >
                    {/* Header: Agent + Model */}
                    <div className="flex items-center justify-between border-b border-base-content/10 pb-2">
                        <div className="flex items-center gap-2 min-w-0">
                            <span className="p-1 rounded bg-base-200 text-primary shrink-0">
                                <AgentIcon id={agentId} />
                            </span>
                            <div className="min-w-0">
                                <div className="font-bold text-base-content uppercase tracking-wider text-[11px]">
                                    {agentId}
                                </div>
                                <div className="text-[10px] text-base-content/60 truncate" title={model ?? ''}>
                                    {model || '—'}
                                </div>
                            </div>
                        </div>
                    </div>

                    {/* Metadata */}
                    <div className="grid grid-cols-[auto_1fr] gap-x-2 gap-y-1 text-base-content/80 text-[10.5px]">
                        <span className="text-base-content/50">Timestamp:</span>
                        <span className="truncate">{timestamp ? formatTimeDisplay(timestamp) : '—'}</span>
                        {sessionId && (
                            <>
                                <span className="text-base-content/50">Session:</span>
                                <span className="truncate font-bold text-primary" title={sessionId}>
                                    {sessionId.length > 16 ? `${sessionId.slice(0, 14)}…` : sessionId}
                                </span>
                            </>
                        )}
                    </div>

                    {/* Token Breakdown */}
                    <div className="pt-2 border-t border-base-content/10 flex flex-col gap-1 text-[10.5px]">
                        <div className="font-bold text-base-content/70 text-[10px] uppercase tracking-wider">
                            Token Breakdown
                        </div>
                        <div className="grid grid-cols-[auto_1fr] gap-x-2 gap-y-0.5 text-base-content/80">
                            <span className="text-base-content/50">📥 Fresh input:</span>
                            <span>{formatTokens(freshInputTokens)}</span>
                            <span className="text-base-content/50">💾 Cache read:</span>
                            <span className="text-cyan-400">{formatTokens(cacheReadTokens)}</span>
                            <span className="text-base-content/50">📤 Output:</span>
                            <span>{formatTokens(outputTokens)}</span>
                            <span className="text-base-content/50 border-t border-base-content/10 pt-0.5">
                                ⚡ Total load:
                            </span>
                            <span className="font-bold border-t border-base-content/10 pt-0.5 text-primary">
                                {formatTokens(totalTokens)}
                            </span>
                        </div>
                    </div>
                </div>
            )}
        </div>
    );
};

// ─── Standardized ToolCallTag Component ────────────────────────────────────────

export interface ToolCallTagProps {
    item: Partial<HistoryToolCallItem> & {
        toolName: string;
        seq?: number;
        sessionId?: string;
        source?: string;
    };
    categoryColor?: string;
    label?: string;
    badgePrefix?: string;
    size?: 'xs' | 'sm' | 'md';
    className?: string;
    testId?: string;
    tooltipId?: string;
    onClick?: (e: React.MouseEvent) => void;
}

/**
 * Standardized interactive tool call tag with a rich syntax-highlighted inspection tooltip / drawer.
 */
export const ToolCallTag: React.FC<ToolCallTagProps> = ({
    item,
    categoryColor: explicitCategoryColor,
    label,
    badgePrefix,
    size = 'sm',
    className = '',
    testId,
    tooltipId: explicitTooltipId,
    onClick,
}) => {
    const [open, setOpen] = useState(false);
    const [pinned, setPinned] = useState(false);
    const [copied, setCopied] = useState(false);
    const [copiedError, setCopiedError] = useState(false);
    const leaveTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

    const category = item.category ?? getToolCategory(item.toolName);
    const categoryColor = explicitCategoryColor ?? CATEGORY_COLOR[category] ?? CATEGORY_COLOR.other;
    const seq = item.seq ?? item.toolSeq ?? 1;
    const tooltipId = explicitTooltipId || `tool-tooltip-${seq}-${item.toolName}`;

    const formattedArgs = useMemo(() => {
        if (!item.argsRaw) return null;
        try {
            const parsed = JSON.parse(item.argsRaw);
            return JSON.stringify(parsed, null, 2);
        } catch {
            return item.argsRaw;
        }
    }, [item.argsRaw]);

    const handleCopyArgs = async (e: React.MouseEvent) => {
        e.stopPropagation();
        if (!formattedArgs) return;
        try {
            await navigator.clipboard.writeText(formattedArgs);
            setCopied(true);
            setTimeout(() => setCopied(false), 2000);
        } catch {
            // Clipboard fallback
        }
    };

    const handleCopyError = async (e: React.MouseEvent) => {
        e.stopPropagation();
        if (!item.errorText) return;
        try {
            await navigator.clipboard.writeText(item.errorText);
            setCopiedError(true);
            setTimeout(() => setCopiedError(false), 2000);
        } catch {
            // Clipboard fallback
        }
    };

    const clearLeaveTimer = () => {
        if (leaveTimerRef.current) {
            clearTimeout(leaveTimerRef.current);
            leaveTimerRef.current = null;
        }
    };

    const handleMouseEnter = () => {
        clearLeaveTimer();
        setOpen(true);
    };

    const handleMouseLeave = () => {
        if (pinned) return;
        clearLeaveTimer();
        leaveTimerRef.current = setTimeout(() => {
            setOpen(false);
        }, 150);
    };

    const handleTagClick = (e: React.MouseEvent) => {
        e.stopPropagation();
        setPinned((prev) => !prev);
        setOpen(true);
        onClick?.(e);
    };

    const isVisible = open || pinned;
    const isError = item.status === 'error';

    const sizeClasses =
        size === 'xs' ? 'px-1.5 py-0.2 text-[10px]' : size === 'md' ? 'px-2.5 py-1 text-xs' : 'px-2 py-0.5 text-[11px]';

    const displayLabel = label ?? `${badgePrefix ?? ''}${item.toolName}`;

    return (
        <div className={`relative inline-flex items-center ${className}`}>
            <button
                type="button"
                aria-describedby={tooltipId}
                className={`${sizeClasses} rounded-md font-mono font-bold text-white shrink-0 tracking-wide cursor-pointer focus:outline-none focus-visible:ring-2 focus-visible:ring-primary shadow-xs transition-opacity hover:opacity-90`}
                style={{ backgroundColor: categoryColor }}
                onClick={handleTagClick}
                onMouseEnter={handleMouseEnter}
                onMouseLeave={handleMouseLeave}
                onFocus={() => {
                    clearLeaveTimer();
                    setOpen(true);
                }}
                onBlur={() => {
                    if (!pinned) setOpen(false);
                }}
                onKeyDown={(e) => {
                    if (e.key === 'Escape') {
                        setPinned(false);
                        setOpen(false);
                    }
                }}
                data-testid={testId ?? `tool-tag-${seq}`}
            >
                {displayLabel}
            </button>

            <div
                id={tooltipId}
                role="tooltip"
                data-testid={explicitTooltipId ?? `tool-tooltip-${seq}`}
                data-inspector-tooltip="true"
                className={`absolute left-0 top-full mt-2 z-50 w-[880px] max-w-[95vw] bg-base-300 border border-base-content/20 shadow-2xl rounded-xl p-4 text-xs font-mono text-base-content backdrop-blur-md flex flex-col gap-3 pointer-events-auto select-text cursor-default ${
                    isVisible ? 'block' : 'hidden'
                }`}
                onMouseEnter={() => {
                    clearLeaveTimer();
                    setOpen(true);
                }}
                onMouseLeave={handleMouseLeave}
                onClick={(e) => e.stopPropagation()}
                onKeyDown={(e) => {
                    if (e.key === 'Escape') {
                        setPinned(false);
                        setOpen(false);
                    }
                    e.stopPropagation();
                }}
            >
                {/* Header */}
                <div className="flex items-center justify-between border-b border-base-content/10 pb-2.5">
                    <div className="flex items-center gap-2.5 min-w-0">
                        <span
                            className="px-2.5 py-0.5 rounded-md text-xs font-bold text-white shrink-0 tracking-wide"
                            style={{ backgroundColor: categoryColor }}
                        >
                            {item.toolName}
                        </span>
                        <span className="text-xs text-base-content/50 font-bold">#{seq}</span>
                        <span className="text-[11px] text-base-content/60 uppercase tracking-wider">({category})</span>
                    </div>
                    <div className="flex items-center gap-2 shrink-0">
                        <span
                            className={`px-2.5 py-0.5 rounded-full text-[10px] font-bold uppercase tracking-wider ${
                                isError ? 'bg-error/20 text-error' : 'bg-success/20 text-success'
                            }`}
                        >
                            {item.status ?? 'ok'}
                        </span>
                        {pinned && (
                            <button
                                type="button"
                                className="text-base-content/50 hover:text-base-content text-xs p-1 leading-none rounded hover:bg-base-content/10 cursor-pointer"
                                onClick={(e) => {
                                    e.stopPropagation();
                                    setPinned(false);
                                    setOpen(false);
                                }}
                                title="Close tooltip"
                            >
                                ✕
                            </button>
                        )}
                    </div>
                </div>

                {/* Execution Error Box */}
                {item.errorText && (
                    <div className="bg-error/10 text-error border border-error/20 rounded-lg p-2.5 text-xs">
                        <div className="flex items-center justify-between mb-1">
                            <span className="font-bold">Execution Error:</span>
                            <button
                                type="button"
                                className="px-1.5 py-0.5 rounded text-[10px] bg-error/20 hover:bg-error/30 transition-colors cursor-pointer"
                                onClick={handleCopyError}
                            >
                                {copiedError ? '✓ Copied' : 'Copy'}
                            </button>
                        </div>
                        <pre className="font-mono text-[11px] whitespace-pre-wrap max-h-36 overflow-y-auto">
                            {item.errorText}
                        </pre>
                    </div>
                )}

                {/* Arguments (raw) with Config-driven Syntax Highlighting */}
                <div className="flex flex-col gap-1">
                    <div className="flex items-center justify-between">
                        <span className="text-[11px] font-semibold text-base-content/70">
                            Arguments (raw){' '}
                            <span className="text-base-content/40 font-normal">(syntax-highlighted)</span>
                        </span>
                        {formattedArgs && (
                            <button
                                type="button"
                                className="px-2 py-0.5 rounded text-[10px] font-mono text-base-content/70 hover:text-base-content hover:bg-base-content/10 transition-colors cursor-pointer border border-base-content/10"
                                onClick={handleCopyArgs}
                            >
                                {copied ? '✓ Copied' : 'Copy'}
                            </button>
                        )}
                    </div>
                    {formattedArgs ? (
                        <div className="bg-base-100 p-3 rounded-lg text-[11px] font-mono overflow-x-auto max-h-60 border border-base-content/10 whitespace-pre-wrap break-all text-base-content/90 overflow-y-auto">
                            <CodeHighlight code={formattedArgs} toolName={item.toolName} />
                        </div>
                    ) : (
                        <div className="p-2.5 bg-base-100/50 rounded-lg text-xs text-base-content/50 italic border border-base-content/10">
                            Raw payload omitted at import; digest available: {item.argsDigest ?? '—'}
                        </div>
                    )}
                    {item.argsDigest && item.argsDigest !== item.argsRaw && (
                        <div className="text-[10px] text-base-content/50 truncate mt-0.5">
                            <span className="font-semibold">Digest: </span>
                            {item.argsDigest}
                        </div>
                    )}
                </div>

                {/* Metadata Diagnostics Grid */}
                <div className="grid grid-cols-2 md:grid-cols-4 gap-2 text-xs font-mono bg-base-200/70 p-2.5 rounded-lg border border-base-content/10">
                    <div>
                        <span className="text-base-content/50 block text-[10px]">DURATION</span>
                        <span className="text-[11px]">
                            {item.durationMs !== null && item.durationMs !== undefined
                                ? `${item.durationMs} ms (${item.durationSource ?? 'measured'})`
                                : `— (${item.durationSource ?? 'unmeasured'})`}
                        </span>
                    </div>
                    <div>
                        <span className="text-base-content/50 block text-[10px]">TIMESTAMP</span>
                        <span className="text-[11px] truncate block">{item.ts ?? '—'}</span>
                    </div>
                    <div>
                        <span className="text-base-content/50 block text-[10px]">SOURCE / MODEL</span>
                        <span
                            className="text-[11px] truncate block"
                            title={`${item.source ?? '—'} / ${item.model ?? '—'}`}
                        >
                            {item.source ?? '—'} / {item.model ?? '—'}
                        </span>
                    </div>
                    <div>
                        <span className="text-base-content/50 block text-[10px]">SESSION ID</span>
                        <span className="text-[11px] truncate block" title={item.sessionId ?? '—'}>
                            {item.sessionId ?? '—'}
                        </span>
                    </div>
                    {item.callId && (
                        <div className="col-span-2 md:col-span-4">
                            <span className="text-base-content/50 block text-[10px]">CALL ID</span>
                            <span className="text-[11px] truncate block" title={item.callId}>
                                {item.callId}
                            </span>
                        </div>
                    )}
                    {item.tokens && (
                        <div className="col-span-2 md:col-span-4 pt-1 border-t border-base-content/10">
                            <span className="text-base-content/50 block text-[10px]">TOKEN LOAD (SHARE)</span>
                            <span className="text-[11px]">
                                Billed: {formatTokens(item.tokens.billedTokens)} (Fresh:{' '}
                                {formatTokens(item.tokens.freshInputTokens)}, Cache:{' '}
                                {formatTokens(item.tokens.cacheReadTokens)}, Output:{' '}
                                {formatTokens(item.tokens.outputTokens)})
                            </span>
                        </div>
                    )}
                </div>
            </div>
        </div>
    );
};

/** Drop-in alias for existing references */
export const ToolItemTagTooltip = ToolCallTag;

export interface RepeatedToolCallsListProps {
    calls?: HistoryToolCallItem[];
    fromSeq?: number;
    toSeq?: number;
    toolName: string;
    sessionId: string;
    maxVisible?: number;
    className?: string;
}

/**
 * Standardized list of repeated tool calls in loop findings with unique IDs and interactive inspection tooltips.
 */
export const RepeatedToolCallsList: React.FC<RepeatedToolCallsListProps> = ({
    calls,
    fromSeq = 1,
    toSeq = 1,
    toolName,
    sessionId,
    maxVisible = 12,
    className = '',
}) => {
    const [expanded, setExpanded] = useState(false);

    const items: Array<Partial<HistoryToolCallItem> & { toolName: string; seq: number; sessionId: string }> =
        useMemo(() => {
            if (calls && calls.length > 0) {
                return calls;
            }
            // Fallback: generate sequence items from fromSeq to toSeq
            const generated: Array<
                Partial<HistoryToolCallItem> & { toolName: string; seq: number; sessionId: string }
            > = [];
            const count = Math.max(1, toSeq - fromSeq + 1);
            for (let i = 0; i < count; i++) {
                generated.push({
                    seq: fromSeq + i,
                    toolSeq: fromSeq + i,
                    toolName,
                    sessionId,
                    category: getToolCategory(toolName),
                    status: 'ok',
                });
            }
            return generated;
        }, [calls, fromSeq, toSeq, toolName, sessionId]);

    const visibleItems = expanded ? items : items.slice(0, maxVisible);
    const hiddenCount = items.length - visibleItems.length;

    return (
        <div className={`flex flex-wrap items-center gap-1.5 ${className}`}>
            {visibleItems.map((call) => (
                <ToolCallTag
                    key={`${call.sessionId}-${call.seq}-${call.callId ?? ''}`}
                    item={call}
                    label={`#${call.seq}`}
                    size="xs"
                />
            ))}
            {hiddenCount > 0 && (
                <button
                    type="button"
                    className="px-2 py-0.5 rounded text-[10px] font-mono font-bold bg-base-content/10 text-base-content/70 hover:bg-base-content/20 transition-colors cursor-pointer"
                    onClick={() => setExpanded(true)}
                >
                    +{hiddenCount} more
                </button>
            )}
            {expanded && items.length > maxVisible && (
                <button
                    type="button"
                    className="px-2 py-0.5 rounded text-[10px] font-mono font-bold bg-base-content/10 text-base-content/70 hover:bg-base-content/20 transition-colors cursor-pointer"
                    onClick={() => setExpanded(false)}
                >
                    Show less
                </button>
            )}
        </div>
    );
};
