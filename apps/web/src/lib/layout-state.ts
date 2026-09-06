/** localStorage key for the current (v2) persisted board layout state. */
export const STORAGE_KEY = 'spur-board-layout-v2';

/** Pre-v2 localStorage key, read once during migration then discarded. */
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
    version: 2,
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
                version: 2,
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

        // Migrate legacy unversioned storage key if present.
        // Preserves custom panel widths, but enforces sidebarCollapsed: true (folded by default,
        // fulfilling Feature A7 requirement 1.2 for users upgrading from v1 where default was false).
        const legacyRaw = localStorage.getItem(LEGACY_STORAGE_KEY);
        if (legacyRaw) {
            const legacyParsed = JSON.parse(legacyRaw);
            const migrated: LayoutState = {
                version: 2,
                sidebarWidth:
                    typeof legacyParsed.sidebarWidth === 'number' ? legacyParsed.sidebarWidth : DEFAULTS.sidebarWidth,
                rightPanelWidth:
                    typeof legacyParsed.rightPanelWidth === 'number'
                        ? legacyParsed.rightPanelWidth
                        : DEFAULTS.rightPanelWidth,
                sidebarCollapsed: DEFAULTS.sidebarCollapsed,
                rightPanelCollapsed:
                    typeof legacyParsed.rightPanelCollapsed === 'boolean'
                        ? legacyParsed.rightPanelCollapsed
                        : DEFAULTS.rightPanelCollapsed,
            };
            try {
                localStorage.setItem(STORAGE_KEY, JSON.stringify(migrated));
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
        localStorage.setItem(STORAGE_KEY, JSON.stringify({ ...state, version: 2 }));
    } catch {
        // localStorage full or unavailable — silently skip
    }
}

/** Remove persisted layout state, resetting to defaults on next load. */
export function resetLayoutState(): void {
    try {
        localStorage.removeItem(STORAGE_KEY);
        localStorage.removeItem(LEGACY_STORAGE_KEY);
    } catch {
        // localStorage unavailable — silently skip
    }
}
