import { Component, type ReactNode } from 'react';
import type { BoardModuleDiagnostic } from '../modules/compose';

/**
 * Failure containment for downstream (native) Board modules (task 0990 R3/R4).
 *
 * Trusted-but-fallible native code renders inside this boundary so a render throw removes
 * the module surface, not the host navigation — the sidebar, router and built-ins stay
 * mounted around it. Built-in modules are not wrapped: their failures keep surfacing the
 * way they do today.
 */

/** User-facing guidance per failure category — reload-oriented, no internal paths. */
const GUIDANCE: Readonly<Record<BoardModuleDiagnostic['category'], string>> = {
    catalog: 'The project module catalog could not be read.',
    import: 'Its compiled browser entry did not load (timed out or failed).',
    style: 'Its stylesheet did not load, so it was not displayed.',
    export: 'Its entry did not publish a usable Board contribution.',
    version: 'It targets a contribution API version this Board does not support.',
    render: 'It failed while rendering.',
    panel: 'Its right panel failed while rendering.',
    unsupported: 'This Board build cannot render this contribution type yet.',
};

/** Strip path-looking fragments from a message before it reaches the browser UI. */
function redactPaths(message: string): string {
    return message.replace(/(?:^|[\s("'])\/[\w.@%+-]+\/[\w.@%+/-]+/g, ' [redacted path]');
}

/** Accessible diagnostic for one unusable module: names it, says why, offers a reload. */
export function ModuleDiagnostic({ diagnostic }: { diagnostic: BoardModuleDiagnostic }) {
    return (
        <div
            role="alert"
            data-testid="module-diagnostic"
            data-module-id={diagnostic.moduleId}
            data-failure-category={diagnostic.category}
            className="m-4 rounded-md border border-spur-border bg-spur-surface p-4 text-sm text-spur-text"
        >
            <p className="font-semibold">“{diagnostic.moduleId}” could not be displayed.</p>
            <p className="mt-1 text-spur-text-muted">{GUIDANCE[diagnostic.category]}</p>
            <p className="mt-1 font-mono text-xs text-spur-text-muted">
                {diagnostic.category}: {redactPaths(diagnostic.message)}
            </p>
            <p className="mt-1 text-spur-text-muted">
                Reload this page after fixing the project module configuration. Other modules stay usable.
            </p>
        </div>
    );
}

/** Host-level banner for catalog failures — shown above the workspace, never replacing it. */
export function BoardDiagnosticsBanner({ diagnostics }: { diagnostics: readonly BoardModuleDiagnostic[] }) {
    if (diagnostics.length === 0) return null;
    return (
        <div
            role="status"
            data-testid="board-diagnostics"
            className="border-b border-spur-border bg-spur-surface px-4 py-2 text-xs text-spur-text"
        >
            {diagnostics.map((diagnostic) => (
                <p key={`${diagnostic.moduleId}:${diagnostic.category}`}>
                    {diagnostic.moduleId}: {redactPaths(diagnostic.message)}
                </p>
            ))}
        </div>
    );
}

interface ModuleErrorBoundaryProps {
    /** Module id used in the diagnostic — the entry's own identity, not a file path. */
    readonly moduleId: string;
    /** Failure category reported for a render throw; panel surfaces pass `panel`. */
    readonly category?: Extract<BoardModuleDiagnostic['category'], 'render' | 'panel'>;
    readonly children: ReactNode;
}

interface ModuleErrorBoundaryState {
    readonly error: Error | null;
}

/** Class boundary — React only routes render errors to `componentDidCatch`/`getDerivedStateFromError`. */
export class ModuleErrorBoundary extends Component<ModuleErrorBoundaryProps, ModuleErrorBoundaryState> {
    override state: ModuleErrorBoundaryState = { error: null };

    static getDerivedStateFromError(error: Error): ModuleErrorBoundaryState {
        return { error };
    }

    override render(): ReactNode {
        const { error } = this.state;
        if (!error) return this.props.children;
        return (
            <ModuleDiagnostic
                diagnostic={{
                    moduleId: this.props.moduleId,
                    category: this.props.category ?? 'render',
                    message: error.message,
                }}
            />
        );
    }
}
