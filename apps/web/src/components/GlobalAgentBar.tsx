import { type KeyboardEvent as ReactKeyboardEvent, useEffect, useMemo, useRef, useState } from 'react';
import { Button, Textarea } from '@/ui';
import { fetchWithTimeout, resolveApiUrl } from '../lib/rpc-client';
import { encodeRequestEnvelope, OPERATOR_AGENT_ID } from '../modules/projects/conversation';
import { useConversationDraft } from '../modules/projects/drafts';
import { classifyReceipt, RECEIPT_LABELS } from '../modules/projects/receipt';
import { useProjectContext } from '../modules/projects/useProjectContext';
import { useProjectRequests } from '../modules/projects/useProjectRequests';
import type { WebModule } from '../modules/types';

export interface GlobalAgentBarProps {
    /** Module resolved from the current /board/<route> segment; undefined off a module route. */
    activeModule?: WebModule;
}

/** The one key that submits the composer (G63 R7 / 0845 R1). */
const COMPOSER_SUBMIT_KEY = 'Enter';
/** Legacy composition signal some IMEs still emit on the composition-ending Enter (R1). */
const IME_KEYCODE = 229;

/**
 * One submit decision for the composer keyboard (0845 R1): plain Enter
 * submits; Shift+Enter and an Enter that ends an IME composition never do.
 * BOTH composition signals are checked — `isComposing` is the standard one
 * happy-dom honours, `keyCode === 229` the legacy one some IMEs emit; checking
 * only one is the exact defect R1 names.
 */
function shouldSubmit(e: ReactKeyboardEvent<HTMLTextAreaElement>): boolean {
    return (
        e.key === COMPOSER_SUBMIT_KEY &&
        !e.shiftKey &&
        !e.nativeEvent.isComposing &&
        e.nativeEvent.keyCode !== IME_KEYCODE
    );
}

export interface SlashCommandCandidate {
    name: string;
    description: string;
    category: 'git' | 'dev' | 'sys' | 'harness' | string;
    argumentHint?: string;
    tags?: string[];
    role?: string;
}

/**
 * Default catalog of server-side slash command candidates (as in Claude Code & Spur harness).
 * Augmented or refreshed from the orchestrator commands endpoint when reachable.
 */
export const DEFAULT_SLASH_COMMANDS: readonly SlashCommandCandidate[] = [
    {
        name: '/review',
        description: 'Inspect staged git diff, verify test coverage & lint',
        category: 'git',
        argumentHint: '[target] [--cached]',
        tags: ['builtin', 'git', 'review'],
    },
    {
        name: '/commit',
        description: 'Draft conventional commit message from staged hunks',
        category: 'git',
        argumentHint: '[--all] [-m <message>]',
        tags: ['builtin', 'git', 'commit'],
    },
    {
        name: '/compact',
        description: 'Purge execution trace and condense context window',
        category: 'sys',
        argumentHint: '[focus]',
        tags: ['builtin', 'sys', 'compact'],
    },
    {
        name: '/revert',
        description: 'Undo last agent file changes or restore git stash',
        category: 'git',
        argumentHint: '[stash-id | file]',
        tags: ['builtin', 'git', 'revert'],
    },
    {
        name: '/resume',
        description: 'Resume paused background agent run',
        category: 'dev',
        argumentHint: '[run-id]',
        tags: ['builtin', 'dev', 'resume'],
    },
    {
        name: '/terminal',
        description: 'Run isolated bash execution in sandbox mirror',
        category: 'sys',
        argumentHint: '[command]',
        tags: ['builtin', 'sys', 'terminal'],
    },
    {
        name: '/cost',
        description: 'Inspect token breakdown and USD expenditure',
        category: 'sys',
        tags: ['builtin', 'sys', 'cost'],
    },
    {
        name: '/sp:dev-plan',
        description: 'Plan a feature from description (intake → AC → tasks)',
        category: 'harness',
        argumentHint: '"<description>" [--feature <id>]',
        tags: ['sp', 'dev', 'plan'],
    },
    {
        name: '/sp:dev-run',
        description: 'Drive one task end-to-end through verification pipeline',
        category: 'harness',
        argumentHint: '<wbs> [--mode <full|implement>]',
        tags: ['sp', 'dev', 'run'],
    },
    {
        name: '/sp:dev-verify',
        description: 'Verify a task against requirements and acceptance criteria',
        category: 'harness',
        argumentHint: '<wbs> [--bdd] [--auto]',
        tags: ['sp', 'dev', 'verify'],
    },
];

/** Predefined fallback roles when fleet members are not explicitly declared. */
const DEFAULT_ROLES = [
    { id: 'auto', label: 'auto', desc: 'Orchestrator auto-dispatch (default)' },
    { id: 'coder', label: 'coder', desc: 'Implementation & refactoring specialist' },
    { id: 'reviewer', label: 'reviewer', desc: 'Verification, lint & SECUA reviewer' },
    { id: 'planner', label: 'planner', desc: 'Architecture & decomposition specialist' },
];

/** No orchestrator instance bound (0836 vocabulary): submission cannot be delivered. */
function orchestratorUnbound(fleet: ReturnType<typeof useProjectContext>['fleet']): boolean {
    if (!fleet) return true;
    const { state, instanceId } = fleet.orchestrator;
    return state === 'missing' || state === 'unresolvable' || !instanceId;
}

/**
 * Clean, single-line global agent prompt bar matching the Stitch design specification:
 * - Single row: `>` prompt + `to: auto ▾` agent role dropdown tag + prompt input + telemetry `⚡` + Send `⌘↵` + collapse `▾`.
 * - Floating popup palette with middle operation hints bar (`↑↓ navigate • Tab complete • ↵ execute • ESC dismiss`).
 * - Fully theme-adapted to current mode (both light and dark) using Spur and DaisyUI tokens.
 */
export default function GlobalAgentBar({ activeModule: _activeModule }: GlobalAgentBarProps) {
    const [isOpen, setIsOpen] = useState(false);
    const [inFlight, setInFlight] = useState(false);
    /** `msgId` of the last accepted submission — joins the thread to the results feed. */
    const [lastMessageId, setLastMessageId] = useState<string | null>(null);

    // Agent role receiver state (default: 'auto' for orchestrator dispatch)
    const [selectedRole, setSelectedRole] = useState('auto');
    const [roleMenuOpen, setRoleMenuOpen] = useState(false);

    // Slash command palette state
    const [paletteDismissed, setPaletteDismissed] = useState(false);
    const [selectedCmdIndex, setSelectedCmdIndex] = useState(0);
    const [activeTag, setActiveTag] = useState<string>('all');
    const [commands, setCommands] = useState<readonly SlashCommandCandidate[]>(DEFAULT_SLASH_COMMANDS);

    // Dynamic tag filters extracted from commands
    const availableTags = useMemo(() => {
        const counts = new Map<string, number>();
        for (const cmd of commands) {
            if (Array.isArray(cmd.tags)) {
                for (const t of cmd.tags) {
                    if (t && typeof t === 'string') {
                        const norm = t.trim().toLowerCase();
                        counts.set(norm, (counts.get(norm) ?? 0) + 1);
                    }
                }
            }
            if (cmd.category) {
                const cat = cmd.category.trim().toLowerCase();
                counts.set(cat, (counts.get(cat) ?? 0) + 1);
            }
        }
        // Priority order: main plugins and categories first
        const priority = ['sp', 'cc', 'kk', 'wt', 'git', 'dev', 'sys', 'harness', 'builtin'];
        const sorted = Array.from(counts.keys()).sort((a, b) => {
            const aPri = priority.indexOf(a);
            const bPri = priority.indexOf(b);
            if (aPri !== -1 && bPri !== -1) return aPri - bPri;
            if (aPri !== -1) return -1;
            if (bPri !== -1) return 1;
            const diff = (counts.get(b) ?? 0) - (counts.get(a) ?? 0);
            return diff !== 0 ? diff : a.localeCompare(b);
        });
        return ['all', ...sorted];
    }, [commands]);

    const project = useProjectContext();
    const { draft, setText, persistPending, clearSubmitted } = useConversationDraft();
    const orchestratorInstanceId = project.fleet?.orchestrator?.instanceId;
    const unbound = orchestratorUnbound(project.fleet);
    const { requests, failed: feedFailed } = useProjectRequests(orchestratorInstanceId ?? null);

    const receipt = lastMessageId !== null ? (requests.get(lastMessageId) ?? null) : null;
    const receiptState = classifyReceipt(receipt, project.fleet, inFlight);
    const label = RECEIPT_LABELS[receiptState];
    const showReceipt = inFlight || lastMessageId !== null;
    const liveText = showReceipt ? `${label.label} — Next: ${label.action}` : '';

    const roleMenuRef = useRef<HTMLDivElement>(null);

    // Fetch dynamic server slash commands if available
    useEffect(() => {
        let mounted = true;
        void (async () => {
            try {
                const res = await fetchWithTimeout(new Request(`${resolveApiUrl()}/agent/commands`));
                if (res.ok) {
                    const data = (await res.json()) as { commands?: SlashCommandCandidate[] };
                    if (mounted && Array.isArray(data.commands) && data.commands.length > 0) {
                        setCommands(data.commands);
                    }
                }
            } catch {
                // Endpoint unavailable — graceful fallback to DEFAULT_SLASH_COMMANDS
            }
        })();
        return () => {
            mounted = false;
        };
    }, []);

    // Dismiss role dropdown on outside click
    useEffect(() => {
        if (!roleMenuOpen) return;
        const handleOutsideClick = (e: MouseEvent) => {
            if (roleMenuRef.current && !roleMenuRef.current.contains(e.target as Node)) {
                setRoleMenuOpen(false);
            }
        };
        document.addEventListener('click', handleOutsideClick);
        return () => document.removeEventListener('click', handleOutsideClick);
    }, [roleMenuOpen]);

    // Re-enable palette when draft text begins with '/'
    useEffect(() => {
        if (draft.text.startsWith('/')) {
            setPaletteDismissed(false);
        }
    }, [draft.text]);

    // Filter command candidates
    const query = draft.text.trim().toLowerCase();
    const isSlashQuery = query.startsWith('/') && !paletteDismissed;
    const filteredCommands = isSlashQuery
        ? commands.filter((cmd) => {
              const matchTag =
                  activeTag === 'all' ||
                  (Array.isArray(cmd.tags) && cmd.tags.map((t) => t.toLowerCase()).includes(activeTag)) ||
                  cmd.category.toLowerCase() === activeTag;
              const queryContent = query.startsWith('/') ? query.slice(1) : query;
              const matchQuery =
                  cmd.name.toLowerCase().startsWith(query) ||
                  cmd.name.toLowerCase().includes(queryContent) ||
                  Boolean(cmd.argumentHint?.toLowerCase().includes(queryContent)) ||
                  cmd.description.toLowerCase().includes(queryContent) ||
                  (Array.isArray(cmd.tags) && cmd.tags.some((t) => t.toLowerCase().includes(queryContent)));
              return matchTag && matchQuery;
          })
        : [];

    const isPaletteVisible = isSlashQuery && filteredCommands.length > 0;

    const handleSelectCommand = (cmdName: string) => {
        setText(`${cmdName} `);
        setPaletteDismissed(true);
        const input = document.querySelector<HTMLTextAreaElement>('[data-testid="agent-bar-input"]');
        input?.focus();
    };

    const handleInsertTrigger = (trigger: string) => {
        const cur = draft.text;
        const next = cur.length > 0 && !cur.endsWith(' ') ? `${cur} ${trigger}` : `${cur}${trigger}`;
        setText(next);
        const input = document.querySelector<HTMLTextAreaElement>('[data-testid="agent-bar-input"]');
        input?.focus();
    };

    // Determine destination instance based on selected role
    const resolvedReceiver = (): string | undefined => {
        if (selectedRole === 'auto') {
            return orchestratorInstanceId;
        }
        const member = project.fleet?.members?.find((m) => m.role === selectedRole || m.instanceId === selectedRole);
        return member?.instanceId ?? orchestratorInstanceId;
    };

    const handleSubmit = async () => {
        const path = project.path;
        const targetInstance = resolvedReceiver();
        if (path === null || targetInstance === undefined || inFlight) return;
        const text = draft.text;
        if (text.trim().length === 0) return;
        const submitted = { text, refs: draft.refs, revision: draft.revision };
        const pending =
            draft.pending !== undefined &&
            typeof draft.pending.requestKey === 'string' &&
            draft.pending.requestKey.length > 0 &&
            draft.pending.revision === draft.revision
                ? draft.pending
                : undefined;
        const requestKey = pending !== undefined ? pending.requestKey : crypto.randomUUID();
        persistPending(requestKey);
        setInFlight(true);
        setLastMessageId(null);
        setPaletteDismissed(true);
        try {
            const res = await fetchWithTimeout(
                new Request(`${resolveApiUrl()}/messages`, {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({
                        to: targetInstance,
                        from: OPERATOR_AGENT_ID,
                        body: encodeRequestEnvelope(submitted.text, submitted.refs),
                        requestKey,
                        projectPath: path,
                    }),
                }),
            );
            if (!res.ok) return;
            const payload: unknown = await res.json().catch(() => null);
            const msgId = (payload as { msgId?: unknown } | null)?.msgId;
            setLastMessageId(typeof msgId === 'string' ? msgId : null);
            clearSubmitted(submitted.revision);
        } catch {
            // Network failure — draft + pending intact
        } finally {
            setInFlight(false);
        }
    };

    if (!isOpen) {
        return (
            <>
                <div role="status" aria-live="polite" className="sr-only" data-agent-bar-live>
                    {liveText}
                </div>
                <Button
                    variant="ghost"
                    className="fixed bottom-6 right-6 z-30 h-12 w-12 rounded-full backdrop-blur-md bg-base-100/80 border border-spur-border shadow-2xl text-xl text-spur-text"
                    onClick={() => setIsOpen(true)}
                    aria-label="Open agent prompt bar"
                    aria-expanded={false}
                    data-testid="agent-bar-dock"
                >
                    ✨
                </Button>
            </>
        );
    }

    // Combine declared fleet members with default fallback roles
    const availableRoleOptions =
        project.fleet?.members && project.fleet.members.length > 0
            ? [
                  { id: 'auto', label: 'auto', desc: 'Orchestrator auto-dispatch (default)' },
                  ...project.fleet.members.map((m) => ({
                      id: m.instanceId,
                      label: m.role || m.instanceId,
                      desc: `${m.executor}${m.model ? ` · ${m.model}` : ''}`,
                  })),
              ]
            : DEFAULT_ROLES;

    const isSendDisabled = draft.text.trim().length === 0 || (selectedRole === 'auto' && unbound);

    return (
        <div
            className="fixed bottom-4 left-1/2 -translate-x-1/2 z-30 w-[calc(100vw-2rem)] max-w-[84rem] backdrop-blur-md bg-base-100/80 border border-spur-border shadow-2xl rounded-2xl p-2.5 flex flex-col gap-2 transition-colors"
            data-testid="agent-bar"
        >
            <div role="status" aria-live="polite" className="sr-only" data-agent-bar-live>
                {liveText}
            </div>

            {/* FLOATING POPUP COMMAND PALETTE (Opens on '/') */}
            {isPaletteVisible && (
                <div
                    data-testid="agent-bar-palette"
                    className="w-full rounded-2xl bg-base-100/95 border border-spur-border shadow-2xl overflow-hidden flex flex-col backdrop-blur-2xl mb-1 transition-colors"
                >
                    {/* Palette Header: Match Count + Dynamic Tag Filters */}
                    <div className="flex items-center justify-between px-3.5 py-2 border-b border-spur-border bg-base-200/50 text-xs">
                        <div className="flex items-center gap-2 shrink-0">
                            <span className="font-mono text-spur-accent font-semibold text-[13px]">/</span>
                            <span className="font-mono text-[12px] font-medium text-spur-text">Commands</span>
                            <span className="text-[11px] font-mono text-spur-text-muted">
                                {filteredCommands.length} available
                            </span>
                        </div>
                        <div
                            className="flex items-center gap-1 overflow-x-auto no-scrollbar max-w-[65%] py-0.5"
                            role="tablist"
                        >
                            {availableTags.slice(0, 10).map((tag) => (
                                <button
                                    key={tag}
                                    type="button"
                                    role="tab"
                                    aria-selected={activeTag === tag}
                                    onClick={() => setActiveTag(tag)}
                                    className={`px-2 py-0.5 rounded text-[11px] font-mono transition-colors shrink-0 cursor-pointer ${
                                        activeTag === tag
                                            ? 'bg-spur-accent/15 text-spur-accent border border-spur-accent/30 font-medium'
                                            : 'text-spur-text-muted hover:text-spur-text hover:bg-base-200'
                                    }`}
                                >
                                    {tag === 'all' ? 'All' : tag}
                                </button>
                            ))}
                        </div>
                    </div>

                    {/* Command List */}
                    <div className="flex flex-col py-1.5 px-2 max-h-[260px] overflow-y-auto" role="listbox">
                        {filteredCommands.map((cmd, idx) => {
                            const isSelected = idx === selectedCmdIndex;
                            return (
                                <button
                                    key={cmd.name}
                                    type="button"
                                    role="option"
                                    aria-selected={isSelected}
                                    onClick={() => handleSelectCommand(cmd.name)}
                                    title={cmd.description}
                                    className={`flex items-center w-full text-left px-3 py-2 rounded-lg cursor-pointer transition-colors ${
                                        isSelected
                                            ? 'bg-spur-surface text-spur-accent font-medium'
                                            : 'hover:bg-base-200 text-spur-text-muted hover:text-spur-text'
                                    }`}
                                >
                                    <div className="flex items-center gap-2 font-mono text-[13px] min-w-0 truncate flex-1">
                                        <span
                                            className={
                                                isSelected
                                                    ? 'font-semibold text-spur-accent'
                                                    : 'font-medium text-spur-text'
                                            }
                                        >
                                            {cmd.name}
                                        </span>
                                        {cmd.argumentHint ? (
                                            <span
                                                className={`font-mono text-xs truncate ${
                                                    isSelected ? 'text-spur-text/80' : 'text-spur-text-muted'
                                                }`}
                                            >
                                                {cmd.argumentHint}
                                            </span>
                                        ) : (
                                            <span
                                                className={`font-sans text-xs italic truncate ${
                                                    isSelected ? 'text-spur-text/60' : 'text-spur-text-muted/60'
                                                }`}
                                            >
                                                {cmd.description}
                                            </span>
                                        )}
                                    </div>
                                    <div className="flex items-center gap-1 shrink-0 ml-2">
                                        {(cmd.tags && cmd.tags.length > 0 ? cmd.tags.slice(0, 2) : [cmd.category]).map(
                                            (tag) => (
                                                <span
                                                    key={tag}
                                                    className="text-[10px] font-mono px-1.5 py-0.5 rounded bg-base-200 text-spur-text-muted border border-spur-border"
                                                >
                                                    {tag}
                                                </span>
                                            ),
                                        )}
                                    </div>
                                </button>
                            );
                        })}
                    </div>

                    {/* OPERATION HINTS BAR IN THE MIDDLE (Keycaps + Context Triggers) */}
                    <div
                        data-testid="agent-bar-hints"
                        className="flex items-center justify-between px-4 py-2 border-t border-spur-border bg-base-200/70 font-mono text-[11px] text-spur-text-muted select-none"
                    >
                        <div className="flex items-center gap-3">
                            <span className="flex items-center gap-1.5">
                                <kbd className="px-1.5 py-0.5 rounded bg-base-100 border border-spur-border text-spur-text font-semibold text-[10px] shadow-sm">
                                    ↑↓
                                </kbd>
                                <span>navigate</span>
                            </span>
                            <span className="text-spur-border">•</span>
                            <span className="flex items-center gap-1.5">
                                <kbd className="px-1.5 py-0.5 rounded bg-base-100 border border-spur-border text-spur-text font-semibold text-[10px] shadow-sm">
                                    Tab
                                </kbd>
                                <span>complete</span>
                            </span>
                            <span className="text-spur-border">•</span>
                            <span className="flex items-center gap-1.5">
                                <kbd className="px-1.5 py-0.5 rounded bg-base-100 border border-spur-border text-spur-text font-semibold text-[10px] shadow-sm">
                                    ↵
                                </kbd>
                                <span>execute</span>
                            </span>
                            <span className="text-spur-border">•</span>
                            <span className="flex items-center gap-1.5">
                                <kbd className="px-1.5 py-0.5 rounded bg-base-100 border border-spur-border text-spur-text font-semibold text-[10px] shadow-sm">
                                    ESC
                                </kbd>
                                <span>dismiss</span>
                            </span>
                        </div>

                        <div className="flex items-center gap-3 font-mono text-[11px]">
                            <button
                                type="button"
                                onClick={() => handleInsertTrigger('@')}
                                className="text-spur-text-muted hover:text-spur-accent cursor-pointer transition-colors flex items-center gap-0.5 group"
                                title="Reference files"
                            >
                                <span className="font-semibold text-spur-accent group-hover:underline">@</span>
                                <span className="group-hover:text-spur-text">files</span>
                            </button>
                            <span className="text-spur-border">•</span>
                            <button
                                type="button"
                                onClick={() => handleInsertTrigger('#')}
                                className="text-spur-text-muted hover:text-spur-accent cursor-pointer transition-colors flex items-center gap-0.5 group"
                                title="Reference tasks and context"
                            >
                                <span className="font-semibold text-spur-accent group-hover:underline">#</span>
                                <span className="group-hover:text-spur-text">context</span>
                            </button>
                            <span className="text-spur-border">•</span>
                            <button
                                type="button"
                                onClick={() => handleInsertTrigger('!')}
                                className="text-spur-text-muted hover:text-spur-accent cursor-pointer transition-colors flex items-center gap-0.5 group"
                                title="Execute shell directly"
                            >
                                <span className="font-semibold text-spur-accent group-hover:underline">!</span>
                                <span className="group-hover:text-spur-text">bash</span>
                            </button>
                        </div>
                    </div>
                </div>
            )}

            {/* SINGLE TYPING LINE: > + to: auto ▾ + Prompt Input + Telemetry ⚡ + Send ⌘↵ + Collapse ▾ */}
            <div className="flex items-center gap-2">
                <span className="text-spur-text-muted font-mono text-sm select-none font-bold pl-1">&gt;</span>

                {/* Agent Role Dropdown Tag (Default: 'auto' for orchestrator dispatch) */}
                <div className="relative shrink-0" ref={roleMenuRef}>
                    <button
                        type="button"
                        onClick={() => setRoleMenuOpen((prev) => !prev)}
                        className="flex items-center gap-1 px-2.5 py-1 rounded-lg bg-spur-surface hover:bg-base-200 border border-spur-border text-xs font-mono text-spur-accent transition-colors cursor-pointer group"
                        title="Target Agent Receiver (default: auto dispatch to orchestrator)"
                        data-testid="agent-bar-role-tag"
                    >
                        <span className="text-spur-text-muted font-sans text-[11px]">to:</span>
                        <span className="font-semibold">{selectedRole}</span>
                        <span className="text-spur-text-muted text-[10px] group-hover:text-spur-text transition-colors">
                            ▾
                        </span>
                    </button>

                    {/* Agent Role Popover Menu */}
                    {roleMenuOpen && (
                        <div
                            data-testid="agent-bar-role-menu"
                            className="absolute bottom-full left-0 mb-2 w-56 rounded-xl bg-base-100 border border-spur-border shadow-2xl p-1.5 z-50 flex flex-col gap-1 text-spur-text"
                        >
                            <div className="px-2.5 py-1 text-[10px] font-mono text-spur-text-muted uppercase tracking-wider">
                                Dispatch Target
                            </div>
                            {availableRoleOptions.map((opt) => (
                                <button
                                    key={opt.id}
                                    type="button"
                                    onClick={() => {
                                        setSelectedRole(opt.label);
                                        setRoleMenuOpen(false);
                                    }}
                                    className={`flex items-center justify-between px-2.5 py-1.5 rounded-lg text-left text-xs font-mono transition-colors ${
                                        selectedRole === opt.label
                                            ? 'bg-spur-accent/15 text-spur-accent font-semibold'
                                            : 'hover:bg-base-200 text-spur-text-muted hover:text-spur-text'
                                    }`}
                                >
                                    <div className="flex flex-col">
                                        <span className="font-medium text-spur-text">{opt.label}</span>
                                        <span className="text-[10px] text-spur-text-muted">{opt.desc}</span>
                                    </div>
                                    {selectedRole === opt.label && <span className="text-[12px]">✓</span>}
                                </button>
                            ))}
                        </div>
                    )}
                </div>

                <Textarea
                    variant="ghost"
                    rows={1}
                    value={draft.text}
                    onChange={(e) => setText(e.target.value)}
                    onKeyDown={(e) => {
                        if (isPaletteVisible && filteredCommands.length > 0) {
                            if (e.key === 'ArrowDown') {
                                e.preventDefault();
                                setSelectedCmdIndex((i) => (i + 1) % filteredCommands.length);
                                return;
                            }
                            if (e.key === 'ArrowUp') {
                                e.preventDefault();
                                setSelectedCmdIndex((i) => (i - 1 + filteredCommands.length) % filteredCommands.length);
                                return;
                            }
                            if (e.key === 'Tab') {
                                e.preventDefault();
                                const selected = filteredCommands[selectedCmdIndex];
                                if (selected) {
                                    handleSelectCommand(selected.name);
                                }
                                return;
                            }
                            if (e.key === 'Escape') {
                                e.preventDefault();
                                setPaletteDismissed(true);
                                return;
                            }
                        }

                        if (!shouldSubmit(e)) return;
                        if (isSendDisabled) return;
                        e.preventDefault();
                        void handleSubmit();
                    }}
                    placeholder="Ask a coding agent to refine or implement, or type / for commands…"
                    aria-label="Agent prompt"
                    className="flex-1 min-h-9 resize-none bg-transparent text-spur-text placeholder:text-spur-text-muted border-0 focus:ring-0 focus:outline-none"
                    data-testid="agent-bar-input"
                />

                <Button
                    variant="ghost"
                    size="sm"
                    onClick={() => setIsOpen(false)}
                    aria-label="Collapse agent prompt bar"
                    aria-expanded={true}
                    className="text-spur-text-muted hover:text-spur-text h-8 w-8 p-0 shrink-0"
                >
                    ▾
                </Button>
            </div>

            {selectedRole === 'auto' && unbound && (
                <div
                    data-testid="agent-bar-orchestrator-missing"
                    role="status"
                    className="px-1 text-xs text-spur-text-muted"
                >
                    Orchestrator unavailable — no orchestrator instance is bound to this project, so requests cannot be
                    delivered yet.
                </div>
            )}

            {showReceipt && (
                <div
                    data-receipt-state={receiptState}
                    role="status"
                    className={`rounded-lg px-2.5 py-1 text-xs ${
                        label.tone === 'err'
                            ? 'bg-spur-error/10 text-spur-error'
                            : label.tone === 'warn'
                              ? 'bg-spur-warning/10 text-spur-warning'
                              : 'bg-spur-success/10 text-spur-success'
                    }`}
                >
                    <span aria-hidden="true" className="mr-1">
                        {label.icon}
                    </span>
                    <span className="font-medium">{label.label}</span>
                    <span className="text-spur-text-muted">
                        {' '}
                        — {label.meaning} Next: {label.action}.
                    </span>
                    {feedFailed && <span className="text-spur-text-muted"> (results feed unavailable)</span>}
                </div>
            )}
        </div>
    );
}
