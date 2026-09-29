import type { ComponentType } from 'react';

/** Self-contained UI module registered in the central registry. */
export interface WebModule {
    readonly id: string;
    readonly name: string;
    readonly icon: string;
    readonly route: string;
    readonly component: ComponentType;
    readonly rightPanelComponent?: ComponentType;
    readonly sidebarLabel?: string;
    /** Optional short capability blurb used by navigation tooltips. */
    readonly description?: string;
    /** Optional declarative ordering key; declared modules sort ascending by this value, undeclared modules retain their existing relative order after them. */
    readonly order?: number;
    /**
     * Host-internal provenance of this entry's component. Built-in modules leave it unset and
     * keep their current layout behavior; `composeBoardModules` sets `react`/`iframe` so the
     * layout can treat a downstream entry differently (failure containment, panel handling).
     */
    readonly contributionType?: 'builtin' | 'react' | 'iframe';
}
