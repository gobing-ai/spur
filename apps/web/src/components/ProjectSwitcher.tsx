import { useEffect, useRef, useState } from 'react';
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
}

export default function ProjectSwitcher({ currentName }: ProjectSwitcherProps) {
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

    return (
        <div className="relative min-w-0 flex-1" ref={dropdownRef}>
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

            {isOpen && (
                <div
                    role="listbox"
                    aria-label="Registered projects"
                    data-testid="project-switcher-menu"
                    className="absolute left-0 top-full z-50 mt-1 w-64 rounded-md border border-spur-border bg-spur-surface p-1 shadow-lg"
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
