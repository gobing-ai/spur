// Downstream native Board module for the composed-path browser proof (task 0992 R1/R3, AC1).
//
// Served as-is at the catalog's `entryUrl` and loaded by the Board's REAL dynamic import
// (`composeBoardModules`'s default `importEntry`), so its bare `react` import is resolved by the
// document import map exactly like an installed Vite build. It is not bundled, injected or
// registered at Board build time: the descriptor in the served catalog is the only thing that
// makes the Board discover it. That is the property the previous slices only proved in unit tests.
import { createContext, createElement, useContext, useState } from 'react';

/** Context this module owns. The Board does not provide it, so the default value proves independence. */
export const PROBE_CONTEXT = createContext({ host: 'unprovided', apiVersion: 0, origin: '' });

/** Workspace contribution: hook state, a dynamic chunk and the module's own panel. */
export function ProbeContribution() {
    const host = useContext(PROBE_CONTEXT);
    const [count, setCount] = useState(0);
    const [lazyValue, setLazyValue] = useState('');
    return createElement(
        'div',
        { className: 'composed-probe', 'data-probe': 'native', 'data-probe-variant': 'original' },
        createElement('span', { 'data-probe-counter': '' }, String(count)),
        createElement(
            'button',
            { type: 'button', 'data-probe-increment': '', onClick: () => setCount((previous) => previous + 1) },
            'increment',
        ),
        createElement('span', { 'data-probe-context': '' }, `${host.host}|${host.apiVersion}|${host.origin}`),
        createElement(
            'button',
            {
                type: 'button',
                'data-probe-lazy': '',
                onClick: () => {
                    void import('./lazy.js').then((chunk) => setLazyValue(chunk.lazyValue()));
                },
            },
            'load lazy',
        ),
        createElement('span', { 'data-probe-lazy-value': '' }, lazyValue),
    );
}

/** Optional right panel the Board renders in its own panel chrome. */
export function ProbeRightPanel() {
    return createElement('div', { 'data-probe-panel': '' }, 'composed probe panel');
}

/** The sole authoring export the Board contract reads (`BoardModuleContribution`). */
export const webModule = {
    apiVersion: 1,
    component: ProbeContribution,
    rightPanelComponent: ProbeRightPanel,
};
