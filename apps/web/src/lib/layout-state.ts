/** localStorage key for the current (v3) persisted board layout state. */
export const STORAGE_KEY = 'spur-board-layout-v3';

/** Pre-v3 (v2) localStorage key, read once during migration then discarded. */
export const V2_STORAGE_KEY = 'spur-board-layout-v2';

/** Legacy unversioned localStorage key, read once during migration then discarded. */
export const LEGACY_STORAGE_KEY = 'spur-board-layout';

/** Persisted board layout dimensions and collapse state. */
export interface LayoutState {
    version?: number;
    sidebarWidth: number;
    rightPanelWidth: number;
    sidebarCollapsed: boolean;
    rightPanelCollapsed: boolean;
}

/** Layout a clean or reset session mounts with — rail folded, right panel closed (A7 R1). */
export const DEFAULTS: LayoutState = {
    version: 3,
    sidebarWidth: 240,
    rightPanelWidth: 320,
    sidebarCollapsed: true,
    rightPanelCollapsed: true,
};

/** Load layout state from localStorage with safe defaults. */
export function loadLayoutState(): LayoutState {
    try {
        const raw = localStorage.getItem(STORAGE_KEY);
        if (raw) {
            const parsed = JSON.parse(raw);
            return {
                version: 3,
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
        }

        // Migrate v2 or legacy unversioned storage key if present.
        // Preserves custom panel widths, but enforces sidebarCollapsed: true (folded by default,
        // fulfilling Feature A7 requirement 1.2 for users whose prior session left the rail open).
        const v2Raw = localStorage.getItem(V2_STORAGE_KEY);
        const legacyRaw = localStorage.getItem(LEGACY_STORAGE_KEY);
        const prevRaw = v2Raw || legacyRaw;
        if (prevRaw) {
            const prevParsed = JSON.parse(prevRaw);
            const migrated: LayoutState = {
                version: 3,
                sidebarWidth:
                    typeof prevParsed.sidebarWidth === 'number' ? prevParsed.sidebarWidth : DEFAULTS.sidebarWidth,
                rightPanelWidth:
                    typeof prevParsed.rightPanelWidth === 'number'
                        ? prevParsed.rightPanelWidth
                        : DEFAULTS.rightPanelWidth,
                sidebarCollapsed: DEFAULTS.sidebarCollapsed,
                rightPanelCollapsed:
                    typeof prevParsed.rightPanelCollapsed === 'boolean'
                        ? prevParsed.rightPanelCollapsed
                        : DEFAULTS.rightPanelCollapsed,
            };
            try {
                localStorage.setItem(STORAGE_KEY, JSON.stringify(migrated));
                localStorage.removeItem(V2_STORAGE_KEY);
                localStorage.removeItem(LEGACY_STORAGE_KEY);
            } catch {
                // storage full or disabled — silently ignore
            }
            return migrated;
        }

        return { ...DEFAULTS };
    } catch {
        return { ...DEFAULTS };
    }
}

/** Persist layout state to localStorage. No-ops if storage is unavailable. */
export function saveLayoutState(state: LayoutState): void {
    try {
        localStorage.setItem(STORAGE_KEY, JSON.stringify({ ...state, version: 3 }));
    } catch {
        // localStorage full or unavailable — silently skip
    }
}

/** Remove persisted layout state, resetting to defaults on next load. */
export function resetLayoutState(): void {
    try {
        localStorage.removeItem(STORAGE_KEY);
        localStorage.removeItem(V2_STORAGE_KEY);
        localStorage.removeItem(LEGACY_STORAGE_KEY);
    } catch {
        // localStorage unavailable — silently skip
    }
}
