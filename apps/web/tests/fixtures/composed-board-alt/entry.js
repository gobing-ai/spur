// Second project's native Board module for the per-origin catalog proof (task 0992 R2, AC3).
//
// Served at the SAME `/modules/native-probe/*` path as the first project's module, on a different
// origin, from a different catalog: same module id, different sidebar metadata, different content
// and a different declared stylesheet. A Board that leaked the first project's catalog, styles or
// module state could not satisfy the assertions in `composed-board-browser.test.ts`.
import { createContext, createElement, useContext, useState } from 'react';

/** Context this project's module owns; the default value differs from the first project's. */
export const PROBE_CONTEXT = createContext({ host: 'alternate', apiVersion: 0, origin: '' });

/** Second project's contribution — same shape, distinct marker, content and state. */
export function ProbeContribution() {
    const host = useContext(PROBE_CONTEXT);
    const [count, setCount] = useState(0);
    return createElement(
        'div',
        { className: 'composed-probe', 'data-probe': 'native', 'data-probe-variant': 'alternate' },
        createElement('span', { 'data-probe-counter': '' }, String(count)),
        createElement(
            'button',
            { type: 'button', 'data-probe-increment': '', onClick: () => setCount((previous) => previous + 1) },
            'increment',
        ),
        createElement('span', { 'data-probe-context': '' }, `${host.host}|${host.apiVersion}|${host.origin}`),
    );
}

/** The sole authoring export the Board contract reads (`BoardModuleContribution`). */
export const webModule = {
    apiVersion: 1,
    component: ProbeContribution,
};
