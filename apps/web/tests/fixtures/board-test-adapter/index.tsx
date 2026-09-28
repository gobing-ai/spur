import type { ComponentType, Context, ReactNode } from 'react';
import * as hostReact from 'react';
import { Component, useEffect, useState, useSyncExternalStore } from 'react';
import * as hostJsxRuntime from 'react/jsx-runtime';
import type { BoardModuleContribution } from '@/modules/contribution';
import { modules } from '@/modules/registry';
import type { WebModule } from '@/modules/types';

/**
 * Build-known test adapter for the task 0988 browser proof (R4).
 *
 * Injected ONLY into a temporary proof build: `boardRuntime({ testAdapterDir })` copies this
 * directory into `src/modules/` for one build, so it is discovered through the SAME path as a real
 * contribution, mounted by the real Board router/layout/right panel, and removed afterwards. A
 * published tarball has no test route and no fixture.
 *
 * It is deliberately NOT the production catalog/loader (a later slice). What it does is run the
 * proof: dynamically import the independently built fixture at a fixed test asset path, compare
 * strict object/function identity against this module's own host-graph React, render the fixture's
 * hook-bearing component inside the Board's React tree with a fixture-owned context, and record
 * what happened on `window.__spurBoardProof` for the CDP harness to assert.
 *
 * The error boundary and the malformed-entry check below stand in for the containment the
 * production loader will own; the point proven here is that a failing contribution does not disable
 * the built-in modules.
 */

/** Fixed test asset path the harness serves the built fixture from (same origin as the Board). */
const FIXTURE_BASE = '/__test__/downstream/';

/** Test-only: this module's id/route inside the proof build. */
const ADAPTER_ID = 'test-board-runtime-proof';

/** Host React namespace as seen by this module's own (bundler-resolved) imports. */
type ReactNamespace = typeof hostReact;

/** Context value the adapter provides to the fixture's own context object. */
interface ProofHostContext {
    readonly host: string;
    readonly apiVersion: number;
    readonly origin: string;
}

/** Fixture module shape the proof reads (the fixture's own authoring + test-only exports). */
interface FixtureModule {
    readonly webModule: unknown;
    readonly __testExports: {
        readonly react: ReactNamespace;
        readonly jsxRuntime: typeof hostJsxRuntime;
        readonly FixtureContext: Context<ProofHostContext>;
    };
}

/** Everything the CDP harness asserts, published as JSON on `window.__spurBoardProof`. */
export interface BoardProofRecord {
    readonly mountedPath: string;
    readonly fixtureLoaded: boolean;
    readonly fixtureError: string | null;
    readonly identity: {
        /** The fixture's own bare `react` import and this module's dynamic `react` import are one module. */
        readonly mapImportIsFixtureModule: boolean;
        /** Strict function identity with the Board's React — the actual shared-instance claim. */
        readonly useStateSameFunction: boolean;
        readonly createElementSameFunction: boolean;
        readonly jsxSameFunction: boolean;
        /** Identity of React's own internals object: one instance, not two copies of the same version. */
        readonly internalsObjectShared: boolean;
        readonly ownReactIsDistinct: boolean;
        readonly ownReactVersionEqualsHost: boolean;
        readonly hostVersion: string;
        readonly ownVersion: string;
    } | null;
    /** `apiVersion`/shape check of the fixture entry against the public contribution contract. */
    readonly validation: { readonly accepted: boolean; readonly reason: string | null } | null;
    readonly malformed: { readonly rejected: boolean; readonly reason: string } | null;
    readonly throwing: { readonly contained: boolean; readonly message: string | null } | null;
    readonly builtInsBefore: readonly string[];
    readonly builtInsAfter: readonly string[];
    readonly rightPanelSource: 'fixture' | 'none';
}

declare global {
    interface Window {
        __spurBoardProof?: BoardProofRecord;
    }
}

/**
 * Bare specifiers assembled at RUNTIME so the bundler cannot rewrite them into chunk imports.
 *
 * These imports must be resolved by the document's import map, exactly like a downstream module's
 * own bare imports: that is what makes "the facade serves the renderer's module instance" a
 * measured fact instead of an assumption. A literal specifier (with or without `@vite-ignore`)
 * would be statically resolved back into this build's own graph.
 */
const RUNTIME_SPECIFIER = { react: ['react'].join(''), jsxRuntime: ['react', 'jsx-runtime'].join('/') };

/** Import a bare specifier through the document's import map. */
function importAtRuntime(specifier: string): Promise<unknown> {
    return import(/* @vite-ignore */ specifier);
}

/** Internals object React exposes on its namespace — exactly one per React instance. */
const INTERNALS = '__CLIENT_INTERNALS_DO_NOT_USE_OR_WARN_USERS_THEY_CANNOT_UPGRADE';

/** Read the shared internals object without leaking `any`. */
function internalsOf(namespace: ReactNamespace): unknown {
    return (namespace as unknown as Record<string, unknown>)[INTERNALS];
}

/** Shape check against the public contribution contract (apiVersion before component). */
function isContribution(value: unknown): value is BoardModuleContribution {
    if (value === null || typeof value !== 'object') return false;
    const candidate = value as { apiVersion?: unknown; component?: unknown };
    return candidate.apiVersion === 1 && typeof candidate.component === 'function';
}

// --- Right panel slot -------------------------------------------------------
// The Board renders `module.rightPanelComponent` for the active module, so the fixture's own panel
// component (from the dynamically imported graph) is published here once the fixture resolves.
let rightPanelComponent: ComponentType | null = null;
const panelListeners = new Set<() => void>();

function subscribePanel(listener: () => void): () => void {
    panelListeners.add(listener);
    return () => {
        panelListeners.delete(listener);
    };
}

function setRightPanelComponent(component: ComponentType | null): void {
    rightPanelComponent = component;
    for (const listener of panelListeners) listener();
}

function AdapterRightPanel() {
    const Panel = useSyncExternalStore(subscribePanel, () => rightPanelComponent);
    return Panel ? <Panel /> : <span data-proof-panel="pending" />;
}

/** Test-only containment boundary: a throwing contribution must not take the built-ins down. */
class ContributionBoundary extends Component<
    { readonly children: ReactNode; readonly onError: (message: string) => void },
    { readonly failed: boolean }
> {
    override state = { failed: false };

    static getDerivedStateFromError(): { failed: boolean } {
        return { failed: true };
    }

    override componentDidCatch(error: Error): void {
        this.props.onError(error.message);
    }

    override render(): ReactNode {
        if (this.state.failed) return <span data-proof-throwing="contained" />;
        return this.props.children;
    }
}

/** Inject the fixture's explicit stylesheet and wait for it, so the contribution renders styled. */
async function loadStylesheet(): Promise<void> {
    const href = `${FIXTURE_BASE}style.css`;
    if (document.querySelector(`link[data-proof-styles="${href}"]`)) return;
    const link = document.createElement('link');
    link.rel = 'stylesheet';
    link.href = href;
    link.dataset.proofStyles = href;
    const loaded = new Promise<void>((resolve) => {
        link.addEventListener('load', () => resolve());
        link.addEventListener('error', () => resolve());
    });
    document.head.appendChild(link);
    await loaded;
}

/** The proof module: a real discovered Board module for the duration of the proof build. */
export function BoardProofAdapter() {
    const [proof, setProof] = useState<BoardProofRecord>(() => ({
        mountedPath: window.location.pathname,
        fixtureLoaded: false,
        fixtureError: null,
        identity: null,
        validation: null,
        malformed: null,
        throwing: null,
        builtInsBefore: modules.map((mod) => mod.id),
        builtInsAfter: [],
        rightPanelSource: 'none',
    }));
    const [fixture, setFixture] = useState<FixtureModule | null>(null);
    const [Throwing, setThrowing] = useState<ComponentType | null>(null);
    const [hostContext] = useState<ProofHostContext>(() => ({
        host: 'spur-board',
        apiVersion: 1,
        origin: window.location.origin,
    }));
    /** Containment receipt: recorded by the boundary and paired with the post-failure module set. */
    const recordContainedFailure = (message: string): void =>
        setProof((previous) => ({
            ...previous,
            throwing: { contained: true, message },
            builtInsAfter: modules.map((mod) => mod.id),
        }));

    useEffect(() => {
        let cancelled = false;
        const merge = (patch: Partial<BoardProofRecord>): void => {
            if (!cancelled) setProof((previous) => ({ ...previous, ...patch }));
        };

        void (async () => {
            try {
                const loaded = (await import(/* @vite-ignore */ `${FIXTURE_BASE}index.js`)) as FixtureModule;
                await loadStylesheet();
                if (cancelled) return;

                const accepted = isContribution(loaded.webModule);
                const fixtureReact = loaded.__testExports.react;
                const ownModule = (await import(/* @vite-ignore */ `${FIXTURE_BASE}own-react.js`)) as {
                    ownReact: ReactNamespace;
                };
                const mapReact = (await importAtRuntime(RUNTIME_SPECIFIER.react)) as ReactNamespace;
                const mapJsx = (await importAtRuntime(RUNTIME_SPECIFIER.jsxRuntime)) as typeof hostJsxRuntime;
                if (cancelled) return;

                const panel = accepted ? (loaded.webModule.rightPanelComponent ?? null) : null;
                setRightPanelComponent(panel);
                setFixture(loaded);
                merge({
                    fixtureLoaded: true,
                    validation: { accepted, reason: accepted ? null : 'webModule is not a BoardModuleContribution' },
                    rightPanelSource: panel ? 'fixture' : 'none',
                    identity: {
                        mapImportIsFixtureModule: mapReact === fixtureReact,
                        useStateSameFunction: mapReact.useState === hostReact.useState,
                        createElementSameFunction: mapReact.createElement === hostReact.createElement,
                        jsxSameFunction: mapJsx.jsx === hostJsxRuntime.jsx,
                        internalsObjectShared: internalsOf(mapReact) === internalsOf(hostReact),
                        ownReactIsDistinct: ownModule.ownReact.useState !== hostReact.useState,
                        ownReactVersionEqualsHost: ownModule.ownReact.version === hostReact.version,
                        hostVersion: hostReact.version,
                        ownVersion: ownModule.ownReact.version,
                    },
                });
            } catch (error) {
                merge({ fixtureError: error instanceof Error ? error.message : String(error) });
                return;
            }

            // Malformed export: rejected by the shape/version check, without touching built-ins.
            try {
                const malformed = (await import(/* @vite-ignore */ `${FIXTURE_BASE}malformed.js`)) as {
                    webModule: unknown;
                };
                const malformedAccepted = isContribution(malformed.webModule);
                merge({
                    malformed: {
                        rejected: !malformedAccepted,
                        reason: malformedAccepted
                            ? 'malformed entry was accepted'
                            : 'apiVersion/component check failed',
                    },
                });
            } catch (error) {
                merge({ malformed: { rejected: true, reason: `load failed: ${String(error)}` } });
            }

            // Throwing contribution: rendered inside the boundary, contained.
            try {
                const throwingModule = (await import(/* @vite-ignore */ `${FIXTURE_BASE}throwing.js`)) as {
                    webModule: BoardModuleContribution;
                };
                if (!cancelled) setThrowing(() => throwingModule.webModule.component);
            } catch (error) {
                merge({ throwing: { contained: false, message: `load failed: ${String(error)}` } });
            }
        })();

        return () => {
            cancelled = true;
        };
    }, []);

    // Publish after every commit so the harness always reads a consistent snapshot.
    useEffect(() => {
        window.__spurBoardProof = proof;
    }, [proof]);

    const Contribution = fixture && isContribution(fixture.webModule) ? fixture.webModule.component : null;
    const FixtureContext = fixture?.__testExports.FixtureContext;

    return (
        <div data-proof-root data-proof-path={proof.mountedPath}>
            {Contribution && FixtureContext ? (
                <FixtureContext.Provider value={hostContext}>
                    <Contribution />
                </FixtureContext.Provider>
            ) : (
                <span data-proof-status="loading" />
            )}
            {Throwing ? (
                <ContributionBoundary onError={recordContainedFailure}>
                    <Throwing />
                </ContributionBoundary>
            ) : null}
        </div>
    );
}

/** Discovered module declaration — the real Board registry/router mounts this contribution. */
export const module: WebModule = {
    id: ADAPTER_ID,
    name: 'Board runtime proof',
    icon: '🧪',
    route: ADAPTER_ID,
    component: BoardProofAdapter,
    rightPanelComponent: AdapterRightPanel,
    description: 'Task 0988 test-only adapter (never present in a published build)',
    order: 999,
};
