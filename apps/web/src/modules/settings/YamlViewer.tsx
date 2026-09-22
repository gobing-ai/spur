import type React from 'react';
import { useMemo, useState } from 'react';

/**
 * Split a string into content and an unquoted trailing `# comment`, if any.
 */
export function splitInlineComment(str: string): { content: string; comment?: string } {
    let inSingle = false;
    let inDouble = false;
    for (let i = 0; i < str.length; i++) {
        const ch = str[i];
        if (ch === "'" && !inDouble) {
            inSingle = !inSingle;
        } else if (ch === '"' && !inSingle && (i === 0 || (str[i - 1] ?? '') !== '\\')) {
            inDouble = !inDouble;
        } else if (ch === '#' && !inSingle && !inDouble && (i === 0 || /\s/.test(str[i - 1] ?? ''))) {
            return {
                content: str.slice(0, i),
                comment: str.slice(i),
            };
        }
    }
    return { content: str };
}

/**
 * Highlight a YAML scalar value (string, number, boolean, null, anchor, etc.).
 */
export function highlightScalar(raw: string, keyPrefix: string): React.ReactNode {
    if (!raw) return null;
    const trimmed = raw.trim();
    if (!trimmed) return raw;

    // Preserve leading/trailing whitespace
    const leadingMatch = raw.match(/^\s*/);
    const trailingMatch = raw.match(/\s*$/);
    const leading = leadingMatch ? leadingMatch[0] : '';
    const trailing = trailingMatch ? trailingMatch[0] : '';

    let highlighted: React.ReactNode = trimmed;

    // Quoted strings
    if (
        (trimmed.startsWith('"') && trimmed.endsWith('"') && trimmed.length >= 2) ||
        (trimmed.startsWith("'") && trimmed.endsWith("'") && trimmed.length >= 2)
    ) {
        highlighted = <span className="text-emerald-400">{trimmed}</span>;
    }
    // Booleans / null
    else if (/^(true|false|yes|no|null|~)$/i.test(trimmed)) {
        highlighted = <span className="text-purple-400 font-semibold">{trimmed}</span>;
    }
    // Numbers (integer or floating point, optionally negative)
    else if (/^-?(?:0|[1-9]\d*)(?:\.\d+)?(?:[eE][+-]?\d+)?$/.test(trimmed)) {
        highlighted = <span className="text-amber-400 font-mono">{trimmed}</span>;
    }
    // YAML Anchors (&name) and Aliases (*name)
    else if (/^[&*][a-zA-Z0-9_-]+$/.test(trimmed)) {
        highlighted = <span className="text-pink-400 font-semibold">{trimmed}</span>;
    }
    // Block scalar indicators (|, >, |+, |-, >+, >-)
    else if (/^[|>][+-]?$/.test(trimmed)) {
        highlighted = <span className="text-amber-300 font-bold">{trimmed}</span>;
    }
    // Explicit YAML tags (!tag, !!str)
    else if (/^!{1,2}[a-zA-Z0-9_-]+$/.test(trimmed)) {
        highlighted = <span className="text-indigo-400 font-mono">{trimmed}</span>;
    }
    // Default scalar (unquoted string, identifiers, urls, file paths)
    else {
        highlighted = <span className="text-slate-200">{trimmed}</span>;
    }

    return (
        <span key={keyPrefix}>
            {leading}
            {highlighted}
            {trailing}
        </span>
    );
}

/**
 * Tokenize and highlight a single line of YAML text.
 */
export function highlightYamlLine(line: string, lineIndex: number): React.ReactNode {
    const key = `line-${lineIndex}`;

    // Blank line
    if (line.length === 0) {
        return '\u00A0';
    }

    // Document directives / markers: --- or ...
    if (/^\s*(?:---|(?:\.\.\.))\s*$/.test(line)) {
        return (
            <span key={key} className="text-slate-500 font-bold">
                {line}
            </span>
        );
    }

    // Full line comment
    const trimmed = line.trimStart();
    if (trimmed.startsWith('#')) {
        const indent = line.slice(0, line.length - trimmed.length);
        return (
            <span key={key}>
                {indent}
                <span className="text-slate-500 italic">{trimmed}</span>
            </span>
        );
    }

    // Key-value pair with optional list bullet:
    // e.g. "  name: value", "  - name: value", "  version: '1.2'", "  bootstrap:"
    const kvMatch = line.match(/^(\s*(?:-\s+)?)(['"]?[a-zA-Z0-9_\-./@]+['"]?)\s*:(.*)$/);
    if (kvMatch) {
        const prefix = kvMatch[1] ?? ''; // indent + optional "- "
        const yamlKey = kvMatch[2] ?? ''; // property key
        const rest = kvMatch[3] ?? ''; // everything after ":"

        // Check if prefix has "- "
        const bulletMatch = prefix.match(/^(\s*)(-\s+)(.*)$/);
        let prefixNode: React.ReactNode = prefix;
        if (bulletMatch) {
            prefixNode = (
                <span>
                    {bulletMatch[1]}
                    <span className="text-rose-400 font-bold">{bulletMatch[2]}</span>
                    {bulletMatch[3]}
                </span>
            );
        }

        const { content, comment } = splitInlineComment(rest);

        return (
            <span key={key}>
                {prefixNode}
                <span className="text-sky-400 font-semibold">{yamlKey}</span>
                <span className="text-slate-400">:</span>
                {content ? highlightScalar(content, `${key}-val`) : null}
                {comment ? <span className="text-slate-500 italic">{comment}</span> : null}
            </span>
        );
    }

    // List item without key:
    // e.g. "  - 'foo'", "  - 123", "  - true"
    const listMatch = line.match(/^(\s*-\s+)(.*)$/);
    if (listMatch) {
        const bullet = listMatch[1] ?? '';
        const rest = listMatch[2] ?? '';
        const { content, comment } = splitInlineComment(rest);

        const bulletIndent = bullet.match(/^(\s*)(-\s+)/);
        const bulletNode = bulletIndent ? (
            <span>
                {bulletIndent[1]}
                <span className="text-rose-400 font-bold">{bulletIndent[2]}</span>
            </span>
        ) : (
            <span className="text-rose-400 font-bold">{bullet}</span>
        );

        return (
            <span key={key}>
                {bulletNode}
                {content ? highlightScalar(content, `${key}-val`) : null}
                {comment ? <span className="text-slate-500 italic">{comment}</span> : null}
            </span>
        );
    }

    // Fallback: general line (could have an inline comment)
    const { content, comment } = splitInlineComment(line);
    return (
        <span key={key}>
            {content ? highlightScalar(content, `${key}-val`) : null}
            {comment ? <span className="text-slate-500 italic">{comment}</span> : null}
        </span>
    );
}

export interface YamlViewerProps {
    code: string;
    filePath?: string;
    maxHeight?: string;
    className?: string;
}

/**
 * Rich syntax-highlighted YAML code viewer with line numbers and copy feedback.
 */
export default function YamlViewer({
    code = '',
    filePath,
    maxHeight = 'calc(100vh - 280px)',
    className = '',
}: YamlViewerProps) {
    const [copied, setCopied] = useState(false);
    const lineEntries = useMemo(
        () => (code ?? '').split('\n').map((line, idx) => ({ id: `line-entry-${idx + 1}`, line, lineNum: idx + 1 })),
        [code],
    );

    const handleCopy = async () => {
        try {
            await navigator.clipboard.writeText(code);
            setCopied(true);
            setTimeout(() => setCopied(false), 2000);
        } catch {
            // ignore clipboard errors
        }
    };

    return (
        <div
            className={`flex flex-col rounded-xl border border-spur-border bg-[#0d1117] text-[#e6edf3] shadow-md overflow-hidden ${className}`}
            data-yaml-viewer
        >
            {/* Top Toolbar */}
            <div className="flex items-center justify-between px-4 py-2 bg-[#161b22] border-b border-spur-border/70 text-xs">
                <div className="flex items-center gap-2 font-mono text-spur-text-muted truncate">
                    <span className="px-1.5 py-0.5 rounded text-[10px] font-semibold bg-sky-500/10 text-sky-400 border border-sky-500/20">
                        YAML
                    </span>
                    {filePath && (
                        <span className="text-slate-300 truncate" title={filePath}>
                            {filePath}
                        </span>
                    )}
                </div>
                <div className="flex items-center gap-3">
                    <span className="text-[11px] text-slate-500 font-mono">
                        {lineEntries.length} {lineEntries.length === 1 ? 'line' : 'lines'}
                    </span>
                    <button
                        type="button"
                        onClick={handleCopy}
                        className="flex items-center gap-1.5 px-2.5 py-1 rounded-md text-[11px] font-medium transition-colors bg-spur-surface-2 hover:bg-spur-surface-3 border border-spur-border text-slate-200 cursor-pointer"
                        data-copy-button
                    >
                        {copied ? (
                            <>
                                <span className="text-emerald-400">✓</span>
                                <span className="text-emerald-400">Copied</span>
                            </>
                        ) : (
                            <>
                                <svg
                                    className="w-3.5 h-3.5 text-slate-400"
                                    viewBox="0 0 24 24"
                                    fill="none"
                                    stroke="currentColor"
                                    strokeWidth="2"
                                    aria-hidden="true"
                                >
                                    <rect x="9" y="9" width="13" height="13" rx="2" ry="2" />
                                    <path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1" />
                                </svg>
                                <span>Copy</span>
                            </>
                        )}
                    </button>
                </div>
            </div>

            {/* Code Body with Line Numbers */}
            <div
                className="overflow-auto text-xs font-mono leading-relaxed"
                style={{ maxHeight }}
                data-yaml-code-container
            >
                <div className="flex min-w-full w-max py-2">
                    {/* Line numbers gutter */}
                    <div
                        className="select-none text-slate-600 text-right pr-4 pl-3 shrink-0 border-r border-slate-800"
                        aria-hidden="true"
                    >
                        {lineEntries.map((entry) => (
                            <div key={entry.id} className="leading-6">
                                {entry.lineNum}
                            </div>
                        ))}
                    </div>

                    {/* Code lines */}
                    <div className="pl-4 pr-6 flex-1">
                        {lineEntries.map((entry) => (
                            <div key={entry.id} className="leading-6 whitespace-pre" data-code-line>
                                {highlightYamlLine(entry.line, entry.lineNum - 1)}
                            </div>
                        ))}
                    </div>
                </div>
            </div>
        </div>
    );
}
