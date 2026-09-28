import type { BoardModuleContribution } from '@gobing-ai/spur/board';
import * as ReactNamespace from 'react';
import { createContext, useContext, useState } from 'react';
import * as JsxRuntime from 'react/jsx-runtime';
import './styles.css';
import logoAssetUrl from './logo.svg?no-inline';

/**
 * Downstream native Board module (task 0988 R3).
 *
 * `webModule` is the sole authoring export, typed against the declaration-only
 * `@gobing-ai/spur/board` export of the INSTALLED tarball. Its React comes from the Board's own
 * instance through the shipped import map (react / react/jsx-runtime are external here), so hooks
 * and the host context work even though this module was compiled and installed separately.
 */

/** Host-provided data. The context object is owned by this fixture's graph, not by the Board. */
export interface FixtureHostContext {
    readonly host: string;
    readonly apiVersion: number;
    readonly origin: string;
}

/** Context the harness adapter provides through the Board's React tree. */
export const FixtureContext = createContext<FixtureHostContext>({ host: 'unprovided', apiVersion: 0, origin: '' });

/** Referenced asset: emitted as its own file (`?no-inline` — library builds inline assets). */
const logoUrl = logoAssetUrl;

/** Workspace contribution: hook state, host context, a lazy chunk, an asset and the deep path. */
export function FixtureContribution() {
    const [count, setCount] = useState(0);
    const host = useContext(FixtureContext);
    const [lazyValue, setLazyValue] = useState('');
    const [assetReady, setAssetReady] = useState(false);

    return (
        <div className="spur-downstream-fixture" data-proof-contribution>
            <span data-proof-counter>{String(count)}</span>
            <button
                type="button"
                className="spur-downstream-button"
                data-proof-increment
                onClick={() => setCount((previous) => previous + 1)}
            >
                increment
            </button>
            <span data-proof-context>{`${host.host}|${host.apiVersion}|${host.origin}`}</span>
            <button
                type="button"
                className="spur-downstream-button"
                data-proof-lazy
                onClick={() => {
                    void import('./lazy').then((chunk) => setLazyValue(chunk.lazyValue()));
                }}
            >
                load lazy
            </button>
            <span data-proof-lazy-value>{lazyValue}</span>
            <img
                className="spur-downstream-asset"
                data-proof-asset
                alt="fixture asset"
                src={logoUrl}
                onLoad={() => setAssetReady(true)}
            />
            <span data-proof-asset-ready>{String(assetReady)}</span>
            <span data-proof-path>{window.location.pathname}</span>
        </div>
    );
}

/** Optional right panel — rendered by the Board's own panel chrome for the active module. */
export function FixtureRightPanel() {
    return (
        <div className="spur-downstream-panel" data-proof-panel>
            fixture right panel
        </div>
    );
}

/** The authoring export the Board contract requires (`BoardModuleContribution`). */
export const webModule: BoardModuleContribution = {
    apiVersion: 1,
    component: FixtureContribution,
    rightPanelComponent: FixtureRightPanel,
};

/**
 * Test-only exports (task 0988 R4). The production authoring surface stays `webModule`; the harness
 * adapter uses these to compare strict identity against its own host imports and to render the
 * fixture's own element through the Board's tree.
 */
export const __testExports = {
    react: ReactNamespace,
    jsxRuntime: JsxRuntime,
    FixtureContext,
    rightPanel: FixtureRightPanel,
} as const;
