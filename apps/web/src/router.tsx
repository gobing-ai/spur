import { createBrowserRouter, Navigate } from 'react-router';
import BoardLayout from './components/BoardLayout';
import { defaultModule, modules } from './modules/registry';

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
    { from: 'teams', to: '/board/projects/agents' },
];

/** Route tree shared by the browser router (prod) and memory router (tests). */
export const routes = [
    {
        path: '/board',
        element: <BoardLayout />,
        children: [
            {
                index: true,
                element: <Navigate to={defaultModule ? defaultModule.route : '/board'} replace />,
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
            ...modules.flatMap((mod) => [
                {
                    path: mod.route,
                    element: <mod.component />,
                },
                // Wildcard child so sub-paths (e.g. /board/tasks/0016) resolve to the
                // same module instead of 404ing. The actual selection is driven by the
                // `?selected` query param or the path param — the component decides.
                {
                    path: `${mod.route}/*`,
                    element: <mod.component />,
                },
            ]),
        ],
    },
    {
        path: '/',
        element: <Navigate to={defaultModule ? `/board/${defaultModule.route}` : '/board'} replace />,
    },
];

/**
 * Lazily construct the browser router. `createBrowserRouter` reads `document`, so it must not run at
 * module-load time — that would crash Astro's static build and any DOM-less test importing `routes`.
 * Only the client-only `BoardApp` island calls this, in the browser.
 */
export function createAppRouter() {
    return createBrowserRouter(routes);
}
