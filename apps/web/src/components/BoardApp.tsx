import { useState } from 'react';
import { RouterProvider } from 'react-router';
import { createAppRouter } from '../router';

/**
 * Client-only root: owns all React Router routing. Rendered via `client:only="react"` so the router
 * (and `createBrowserRouter`, which needs `document`) is only built in the browser, never at build time.
 * The router is created once per mount via lazy `useState` init.
 */
export default function BoardApp() {
    const [router] = useState(createAppRouter);
    return <RouterProvider router={router} />;
}
