import { useEffect, useRef, useState } from 'react';
import { Tooltip } from '@/ui';
import { fetchWithTimeout, resolveApiUrl } from '../lib/rpc-client';

export interface RegistryProject {
    name: string;
    path: string;
    port: number;
    running: boolean;
    current: boolean;
}

interface ProjectSwitcherProps {
    currentName: string;
    collapsed?: boolean;
}

/**
 * Deterministic SVG icon representing the current project.
 * Uses a string hash of the project name to consistently select from a curated
 * set of 8 developer/repo vector icons and distinct color styles.
 */
function ProjectGlyph({ name }: { name: string }) {
    let hash = 0;
    for (let i = 0; i < name.length; i++) {
        hash = (hash << 5) - hash + name.charCodeAt(i);
        hash |= 0;
    }
    const idx = Math.abs(hash) % 8;

    const colors = [
        'text-emerald-400 bg-emerald-500/10 border-emerald-500/30',
        'text-sky-400 bg-sky-500/10 border-sky-500/30',
        'text-indigo-400 bg-indigo-500/10 border-indigo-500/30',
        'text-amber-400 bg-amber-500/10 border-amber-500/30',
        'text-rose-400 bg-rose-500/10 border-rose-500/30',
        'text-purple-400 bg-purple-500/10 border-purple-500/30',
        'text-teal-400 bg-teal-500/10 border-teal-500/30',
        'text-cyan-400 bg-cyan-500/10 border-cyan-500/30',
    ];
    const colorClass = colors[idx];

    const renderIcon = () => {
        switch (idx) {
            case 0: // Cube / Package
                return (
                    <svg
                        className="h-4 w-4 shrink-0"
                        viewBox="0 0 16 16"
                        fill="none"
                        stroke="currentColor"
                        strokeWidth="1.5"
                        strokeLinecap="round"
                        strokeLinejoin="round"
                        aria-hidden="true"
                    >
                        <path d="M8 1.5l5.5 3.2v6.6L8 14.5l-5.5-3.2V4.7L8 1.5z" />
                        <path d="M8 1.5v13M2.5 4.7l5.5 3.3 5.5-3.3" />
                    </svg>
                );
            case 1: // Terminal
                return (
                    <svg
                        className="h-4 w-4 shrink-0"
                        viewBox="0 0 16 16"
                        fill="none"
                        stroke="currentColor"
                        strokeWidth="1.5"
                        strokeLinecap="round"
                        strokeLinejoin="round"
                        aria-hidden="true"
                    >
                        <rect x="2" y="2.5" width="12" height="11" rx="2" />
                        <path d="M5 6l2.5 2L5 10M8.5 10H11" />
                    </svg>
                );
            case 2: // Git Branch
                return (
                    <svg
                        className="h-4 w-4 shrink-0"
                        viewBox="0 0 16 16"
                        fill="none"
                        stroke="currentColor"
                        strokeWidth="1.5"
                        strokeLinecap="round"
                        strokeLinejoin="round"
                        aria-hidden="true"
                    >
                        <circle cx="4.5" cy="4" r="1.5" />
                        <circle cx="4.5" cy="12" r="1.5" />
                        <circle cx="11.5" cy="7" r="1.5" />
                        <path d="M4.5 5.5v5M4.5 7.5a4 4 0 004-1" />
                    </svg>
                );
            case 3: // Layers
                return (
                    <svg
                        className="h-4 w-4 shrink-0"
                        viewBox="0 0 16 16"
                        fill="none"
                        stroke="currentColor"
                        strokeWidth="1.5"
                        strokeLinecap="round"
                        strokeLinejoin="round"
                        aria-hidden="true"
                    >
                        <path d="M8 2l5.5 3-5.5 3-5.5-3L8 2z" />
                        <path d="M2.5 8l5.5 3 5.5-3M2.5 11l5.5 3 5.5-3" />
                    </svg>
                );
            case 4: // Cpu / Chip
                return (
                    <svg
                        className="h-4 w-4 shrink-0"
                        viewBox="0 0 16 16"
                        fill="none"
                        stroke="currentColor"
                        strokeWidth="1.5"
                        strokeLinecap="round"
                        strokeLinejoin="round"
                        aria-hidden="true"
                    >
                        <rect x="4" y="4" width="8" height="8" rx="1.5" />
                        <path d="M6 1.5v2M10 1.5v2M6 12.5v2M10 12.5v2M1.5 6h2M1.5 10h2M12.5 6h2M12.5 10h2" />
                    </svg>
                );
            case 5: // Code
                return (
                    <svg
                        className="h-4 w-4 shrink-0"
                        viewBox="0 0 16 16"
                        fill="none"
                        stroke="currentColor"
                        strokeWidth="1.5"
                        strokeLinecap="round"
                        strokeLinejoin="round"
                        aria-hidden="true"
                    >
                        <path d="M5.5 4.5L2 8l3.5 3.5M10.5 4.5L14 8l-3.5 3.5M9 3l-2 10" />
                    </svg>
                );
            case 6: // Folder
                return (
                    <svg
                        className="h-4 w-4 shrink-0"
                        viewBox="0 0 16 16"
                        fill="none"
                        stroke="currentColor"
                        strokeWidth="1.5"
                        strokeLinecap="round"
                        strokeLinejoin="round"
                        aria-hidden="true"
                    >
                        <path d="M2 4a1.5 1.5 0 011.5-1.5h2.8a1.5 1.5 0 011.06.44l1.14 1.14c.28.28.66.42 1.06.42H12.5A1.5 1.5 0 0114 6v6a1.5 1.5 0 01-1.5 1.5h-9A1.5 1.5 0 012 12V4z" />
                    </svg>
                );
            default: // Globe / Web
                return (
                    <svg
                        className="h-4 w-4 shrink-0"
                        viewBox="0 0 16 16"
                        fill="none"
                        stroke="currentColor"
                        strokeWidth="1.5"
                        strokeLinecap="round"
                        strokeLinejoin="round"
                        aria-hidden="true"
                    >
                        <circle cx="8" cy="8" r="6" />
                        <path d="M2 8h12M8 2a9 9 0 010 12 9 9 0 010-12z" />
                    </svg>
                );
        }
    };

    return (
        <span
            data-testid="project-avatar-icon"
            className={`flex h-7 w-7 items-center justify-center rounded border ${colorClass}`}
        >
            {renderIcon()}
        </span>
    );
}

export default function ProjectSwitcher({ currentName, collapsed = false }: ProjectSwitcherProps) {
    const [isOpen, setIsOpen] = useState(false);
    const [projects, setProjects] = useState<RegistryProject[]>([]);
    const [loadingProject, setLoadingProject] = useState<string | null>(null);
    const [error, setError] = useState<string | null>(null);
    const dropdownRef = useRef<HTMLDivElement>(null);

    // Fetch projects list when menu opens
    useEffect(() => {
        if (!isOpen) return;
        const controller = new AbortController();
        fetchWithTimeout(new Request(`${resolveApiUrl()}/projects`, { signal: controller.signal }))
            .then(async (res) => {
                if (!res.ok) return;
                const body = (await res.json()) as { projects: RegistryProject[] };
                setProjects(body.projects ?? []);
            })
            .catch(() => {
                setError('Failed to load projects');
            });
        return () => controller.abort();
    }, [isOpen]);

    // Close on click outside or Escape key
    useEffect(() => {
        if (!isOpen) return;
        const handleKeyDown = (e: KeyboardEvent) => {
            if (e.key === 'Escape') setIsOpen(false);
        };
        const handleClickOutside = (e: MouseEvent) => {
            if (dropdownRef.current && !dropdownRef.current.contains(e.target as Node)) {
                setIsOpen(false);
            }
        };
        document.addEventListener('keydown', handleKeyDown);
        document.addEventListener('mousedown', handleClickOutside);
        return () => {
            document.removeEventListener('keydown', handleKeyDown);
            document.removeEventListener('mousedown', handleClickOutside);
        };
    }, [isOpen]);

    const handleSelect = async (project: RegistryProject) => {
        if (project.current) {
            setIsOpen(false);
            return;
        }

        if (project.running && project.port > 0) {
            window.location.href = `http://localhost:${project.port}/board`;
            return;
        }

        // Start stopped project
        setLoadingProject(project.name);
        try {
            const res = await fetchWithTimeout(
                new Request(`${resolveApiUrl()}/projects/start`, {
                    method: 'POST',
                    headers: { 'content-type': 'application/json' },
                    body: JSON.stringify({ name: project.name, path: project.path }),
                }),
            );
            if (!res.ok) {
                throw new Error('Failed to start project');
            }
            const body = (await res.json()) as { url: string; port: number };
            window.location.href = body.url || `http://localhost:${body.port}/board`;
        } catch (err) {
            setError(err instanceof Error ? err.message : 'Start failed');
            setLoadingProject(null);
        }
    };

    const collapsedTrigger = (
        <button
            type="button"
            onClick={() => setIsOpen((prev) => !prev)}
            aria-haspopup="listbox"
            aria-expanded={isOpen}
            aria-label={`Switch project: ${currentName}`}
            title={currentName}
            data-testid="project-switcher-trigger"
            className="group relative flex h-8 w-8 items-center justify-center rounded-md hover:bg-spur-accent/20 focus-visible:outline focus-visible:outline-2 focus-visible:outline-spur-accent"
        >
            {/* Default state: SVG project glyph */}
            <span className={`items-center justify-center ${isOpen ? 'hidden' : 'flex group-hover:hidden'}`}>
                <ProjectGlyph name={currentName} />
            </span>

            {/* Hover or Open state: Project switcher chevron down \/ */}
            <span
                data-testid="project-switcher-chevron"
                className={`h-7 w-7 items-center justify-center rounded text-spur-text ${
                    isOpen ? 'flex' : 'hidden group-hover:flex'
                }`}
            >
                <svg
                    className={`h-4 w-4 shrink-0 transition-transform ${isOpen ? 'rotate-180 text-spur-accent' : ''}`}
                    viewBox="0 0 16 16"
                    fill="none"
                    stroke="currentColor"
                    strokeWidth="2"
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    aria-hidden="true"
                >
                    <path d="M4 6l4 4 4-4" />
                </svg>
            </span>
        </button>
    );

    return (
        <div
            className={`relative ${collapsed ? 'flex items-center justify-center' : 'min-w-0 flex-1'}`}
            ref={dropdownRef}
        >
            {collapsed ? (
                isOpen ? (
                    collapsedTrigger
                ) : (
                    <Tooltip position="right" tip={`Switch project: ${currentName}`} className="block">
                        {collapsedTrigger}
                    </Tooltip>
                )
            ) : (
                <button
                    type="button"
                    onClick={() => setIsOpen((prev) => !prev)}
                    aria-haspopup="listbox"
                    aria-expanded={isOpen}
                    aria-label="Switch project"
                    title={currentName}
                    data-testid="project-switcher-trigger"
                    className="flex w-full items-center justify-between gap-1 rounded-md px-1.5 py-1 text-left text-sm font-semibold text-spur-text hover:bg-spur-border/30 focus-visible:outline focus-visible:outline-2 focus-visible:outline-spur-accent"
                >
                    <span className="font-semibold truncate">{currentName}</span>

                    <svg
                        className={`h-4 w-4 shrink-0 transition-transform ${isOpen ? 'rotate-180' : ''}`}
                        viewBox="0 0 16 16"
                        fill="none"
                        stroke="currentColor"
                        strokeWidth="2"
                        strokeLinecap="round"
                        strokeLinejoin="round"
                        aria-hidden="true"
                    >
                        <path d="M4 6l4 4 4-4" />
                    </svg>
                </button>
            )}

            {isOpen && (
                <div
                    role="listbox"
                    aria-label="Registered projects"
                    data-testid="project-switcher-menu"
                    className={`absolute z-50 w-64 rounded-md border border-spur-border bg-spur-surface p-1 shadow-lg ${
                        collapsed ? 'left-full top-0 ml-2' : 'left-0 top-full mt-1'
                    }`}
                >
                    <div className="px-2 py-1 text-xs font-medium text-spur-text-muted border-b border-spur-border/50 mb-1">
                        Projects
                    </div>

                    {projects.length === 0 ? (
                        <div className="px-2 py-1.5 text-xs text-spur-text-muted">
                            {error ? error : 'No projects registered'}
                        </div>
                    ) : (
                        projects.map((p) => (
                            <button
                                key={p.path}
                                type="button"
                                role="option"
                                aria-selected={p.current}
                                disabled={loadingProject === p.name}
                                onClick={() => handleSelect(p)}
                                data-testid={`project-item-${p.name}`}
                                className={`flex w-full items-center justify-between rounded px-2 py-1.5 text-xs text-left transition-colors ${
                                    p.current
                                        ? 'bg-spur-accent/15 text-spur-accent font-medium'
                                        : 'text-spur-text hover:bg-spur-border/30'
                                }`}
                            >
                                <div className="flex items-center gap-2 min-w-0 flex-1">
                                    <span
                                        className={`h-2 w-2 rounded-full shrink-0 ${
                                            p.running ? 'bg-green-500' : 'bg-gray-400'
                                        }`}
                                        title={p.running ? `Running on port ${p.port}` : 'Stopped'}
                                    />
                                    <span className="truncate">{p.name}</span>
                                </div>
                                {loadingProject === p.name ? (
                                    <span className="text-[10px] text-spur-accent animate-pulse">Starting...</span>
                                ) : p.current ? (
                                    <span className="text-[10px] font-semibold text-spur-accent">current</span>
                                ) : p.running ? (
                                    <span className="text-[10px] text-spur-text-muted">:{p.port}</span>
                                ) : (
                                    <span className="text-[10px] text-spur-text-muted">stopped</span>
                                )}
                            </button>
                        ))
                    )}
                </div>
            )}
        </div>
    );
}
