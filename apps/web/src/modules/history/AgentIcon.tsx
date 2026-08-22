import type React from 'react';

export const AgentIcon: React.FC<{ id: string }> = ({ id }) => {
    const common = { width: 16, height: 16, viewBox: '0 0 24 24', role: 'img', 'aria-label': `${id} icon` } as const;
    switch (id) {
        case 'claude':
            return (
                <svg {...common} fill="none" stroke="currentColor" strokeWidth="2.3" strokeLinecap="round">
                    <title>Claude Code icon</title>
                    <path d="M12 2.5v19M2.5 12h19M5.3 5.3l13.4 13.4M5.3 18.7l13.4-13.4" />
                </svg>
            );
        case 'codex':
            return (
                <svg {...common} fill="currentColor">
                    <title>Codex icon</title>
                    <path d="M21.5 9.8a5.5 5.5 0 0 0-.5-4.2 5.6 5.6 0 0 0-4.6-2.8 5.6 5.6 0 0 0-4.2 1.4A5.5 5.5 0 0 0 7.8 3a5.6 5.6 0 0 0-4.5 3.3 5.5 5.5 0 0 0 .7 4.2 5.5 5.5 0 0 0-.7 4.2 5.6 5.6 0 0 0 4.5 3.3c.3.7.8 1.3 1.4 1.8a5.6 5.6 0 0 0 6.8-.4 5.5 5.5 0 0 0 4.4-1.4 5.6 5.6 0 0 0 1.4-4.2 5.5 5.5 0 0 0-.5-4.2zm-8.5 11.2a3.7 3.7 0 0 1-2.4-.9l2.7-1.6a1 1 0 0 0 .5-.9v-3.7l3.1 1.8v3.6a3.7 3.7 0 0 1-3.9 1.7zm-7.6-3.8a3.7 3.7 0 0 1-.4-2.5l2.7 1.6a1 1 0 0 0 1 0l3.2-1.8v3.6L6.8 20a3.7 3.7 0 0 1-1.4-2.8zm-1.3-8.3a3.7 3.7 0 0 1 2-1.6v3.2a1 1 0 0 0 .5.9l3.2 1.8-3.1 1.8-3.1-1.8a3.7 3.7 0 0 1 .5-4.3zm12.6 1.8l-3.2-1.8 3.1-1.8 3.1 1.8a3.7 3.7 0 0 1-.5 4.3 3.7 3.7 0 0 1-2 1.6v-3.2a1 1 0 0 0-.5-.9zm2.2 4.5l-2.7-1.6a1 1 0 0 0-1 0l-3.2 1.8V11.8l3.1-1.8 3.1 1.8a3.7 3.7 0 0 1 .7 4.4zm-7-1.3l-2.7-1.6 2.7-1.6 2.7 1.6-2.7 1.6z" />
                </svg>
            );
        case 'agy':
            return (
                <svg {...common} fill="currentColor">
                    <title>Antigravity CLI icon</title>
                    <path d="M12 1.5C12 7.3 7.3 12 1.5 12c5.8 0 10.5 4.7 10.5 10.5 0-5.8 4.7-10.5 10.5-10.5-5.8 0-10.5-4.7-10.5-10.5z" />
                </svg>
            );
        case 'omp':
            return (
                <svg {...common} fill="none" stroke="currentColor" strokeWidth="2.3" strokeLinecap="round">
                    <title>OMP icon</title>
                    <circle cx="12" cy="12" r="9" />
                    <path d="M10 8.5l5 3.5-5 3.5z" />
                </svg>
            );
        case 'openclaw':
            return (
                <svg {...common} fill="none" stroke="currentColor" strokeWidth="2.3" strokeLinecap="round">
                    <title>OpenClaw icon</title>
                    <path d="M12 2C6.5 2 2 6.5 2 12c0 3.8 2.1 7.1 5.2 8.8L6 22l3.8-1.2C10.5 21.5 11.2 22 12 22c5.5 0 10-4.5 10-10S17.5 2 12 2zM8 11.5a1.5 1.5 0 1 1 3 0 1.5 1.5 0 0 1-3 0zm5 0a1.5 1.5 0 1 1 3 0 1.5 1.5 0 0 1-3 0z" />
                </svg>
            );
        case 'hermes':
            return (
                <svg {...common} fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round">
                    <title>Hermes icon</title>
                    <path d="M22 2L11 13M22 2l-7 20-4-9-9-4 20-7z" />
                </svg>
            );
        case 'grok':
            return (
                <svg {...common} fill="currentColor">
                    <title>Grok Build icon</title>
                    <path d="M18.2 3H21l-6.5 7.4L22 21h-5.8l-4.5-5.9L6.5 21H3.6l6.9-7.9L3 3h5.9l4.1 5.4L18.2 3zm-1 16.3h1.5L8.7 4.6H7.1l10.1 14.7z" />
                </svg>
            );
        case 'opencode':
            return (
                <svg {...common} fill="none" stroke="currentColor" strokeWidth="2.3" strokeLinecap="round">
                    <title>OpenCode icon</title>
                    <polyline points="16 18 22 12 16 6" />
                    <polyline points="8 6 2 12 8 18" />
                </svg>
            );
        case 'pi':
            return (
                <svg {...common} fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round">
                    <title>Pi icon</title>
                    <path d="M4 6h16M9 6v13M15 6v11a2 2 0 0 0 2 2" />
                </svg>
            );
        default:
            return null;
    }
};
