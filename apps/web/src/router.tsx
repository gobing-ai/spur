import { createBrowserRouter, Navigate } from 'react-router';
import BoardLayout from './components/BoardLayout';
import { ModuleErrorBoundary } from './components/ModuleErrorBoundary';
import { builtinRegistry, type Registry } from './modules/registry';
import type { WebModule } from './modules/types';

/**
 * Board routes retired by G64 (task 0849). A static table, not a derived one: these modules no
 * longer exist, so there is no route object left to attach a redirect to. Both the bare path and
 * its wildcard are registered so bookmarked deep links resolve instead of 404ing — the retired
 * shells kept their active tab in React state, so `/board/<id>` was the only addressable URL.
 *
 * Permanent route entries rather than a transition shim: ADR-058 needs a removal condition that can
 * be checked against the repository, and "no bookmark points here any more" can never be satisfied.
 */
export const RETIRED_ROUTES: ReadonlyArray<{ from: string; to: string }> = [
    { from: 'workspace', to: '/board/projects' },
    { from: 'inbox', to: '/board/projects/conversation' },
    { from: 'teams', to: '/board/settings/agents' },
];

/** A module that must render inside a failure boundary: downstream `react`/`iframe` entries. */
function isContained(mod: WebModule): boolean {
    return mod.contributionType === 'react' || mod.contributionType === 'iframe';
}

/** Route element for one module — downstream entries get their own error containment (R3). */
function elementFor(mod: WebModule) {
    const Component = mod.component;
    if (!isContained(mod)) return <Component />;
    return (
        <ModuleErrorBoundary moduleId={mod.id}>
            <Component />
        </ModuleErrorBoundary>
    );
}

/**
 * The landing target: the first BUILT-IN entry, captured independently of ordering so a
 * downstream module with a low `order` can never replace `/board`'s built-in landing (R1).
 */
function landingOf(registry: Registry): WebModule | undefined {
    return registry.modules.find((mod) => !isContained(mod)) ?? registry.defaultModule;
}

/**
 * Route tree for one resolved registry, shared by the browser router (prod) and memory routers
 * (tests). Built-ins keep their current ordering and bare/wildcard pair; downstream entries are
 * mounted from the same registry, so the sidebar and the router can never disagree.
 */
export function createBoardRoutes(registry: Registry) {
    const landing = landingOf(registry);
    return [
        {
            path: '/board',
            element: <BoardLayout />,
            children: [
                {
                    index: true,
                    element: <Navigate to={landing ? `/board/${landing.route}` : '/board'} replace />,
                },
                ...RETIRED_ROUTES.flatMap((retired) => [
                    {
                        path: retired.from,
                        element: <Navigate to={retired.to} replace />,
                    },
                    {
                        path: `${retired.from}/*`,
                        element: <Navigate to={retired.to} replace />,
                    },
                ]),
                ...registry.modules.flatMap((mod) => [
                    {
                        path: mod.route,
                        element: elementFor(mod),
                    },
                    // Wildcard child so sub-paths (e.g. /board/tasks/0016, /board/modules/<id>/deep)
                    // resolve to the same module instead of 404ing. The actual selection is driven by
                    // the `?selected` query param or the path param — the component decides.
                    {
                        path: `${mod.route}/*`,
                        element: elementFor(mod),
                    },
                ]),
            ],
        },
        {
            path: '/',
            element: <Navigate to={landing ? `/board/${landing.route}` : '/board'} replace />,
        },
    ];
}

/** Route tree of the built-in registry — the no-catalog/fallback shell, and the tests' entry. */
export const routes = createBoardRoutes(builtinRegistry);

/**
 * Lazily construct the browser router for a resolved registry. `createBrowserRouter` reads
 * `document`, so it must not run at module-load time — that would crash Astro's static build and
 * any DOM-less test importing {@link routes}. Only the client-only `BoardApp` island calls this,
 * in the browser, exactly once.
 */
export function createAppRouter(registry: Registry = builtinRegistry) {
    return createBrowserRouter(createBoardRoutes(registry));
}
