import { createBrowserRouter, Navigate } from 'react-router';
import BoardLayout from './components/BoardLayout';
import { defaultModule, modules } from './modules/registry';

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
