const STORAGE_KEY = 'spur-board-layout';

/** Persisted board layout dimensions and collapse state. */
export interface LayoutState {
    sidebarWidth: number;
    rightPanelWidth: number;
    sidebarCollapsed: boolean;
    rightPanelCollapsed: boolean;
}

const DEFAULTS: LayoutState = {
    sidebarWidth: 240,
    rightPanelWidth: 320,
    sidebarCollapsed: false,
    rightPanelCollapsed: true,
};

/** Load layout state from localStorage with safe defaults. */
export function loadLayoutState(): LayoutState {
    try {
        const raw = localStorage.getItem(STORAGE_KEY);
        if (!raw) return { ...DEFAULTS };
        const parsed = JSON.parse(raw);
        return {
            sidebarWidth: typeof parsed.sidebarWidth === 'number' ? parsed.sidebarWidth : DEFAULTS.sidebarWidth,
            rightPanelWidth:
                typeof parsed.rightPanelWidth === 'number' ? parsed.rightPanelWidth : DEFAULTS.rightPanelWidth,
            sidebarCollapsed:
                typeof parsed.sidebarCollapsed === 'boolean' ? parsed.sidebarCollapsed : DEFAULTS.sidebarCollapsed,
            rightPanelCollapsed:
                typeof parsed.rightPanelCollapsed === 'boolean'
                    ? parsed.rightPanelCollapsed
                    : DEFAULTS.rightPanelCollapsed,
        };
    } catch {
        return { ...DEFAULTS };
    }
}

/** Persist layout state to localStorage. No-ops if storage is unavailable. */
export function saveLayoutState(state: LayoutState): void {
    try {
        localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
    } catch {
        // localStorage full or unavailable — silently skip
    }
}

/** Remove persisted layout state, resetting to defaults on next load. */
export function resetLayoutState(): void {
    try {
        localStorage.removeItem(STORAGE_KEY);
    } catch {
        // localStorage unavailable — silently skip
    }
}
