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
}
