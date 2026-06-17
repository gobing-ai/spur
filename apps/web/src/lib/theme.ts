const STORAGE_KEY = 'spur-theme';

/** daisyUI data-theme value: "light" or "dark". */
export type Theme = 'light' | 'dark';

/** Resolve the initial theme: stored pref > system pref > light fallback. */
export function resolveTheme(): Theme {
    try {
        const stored = localStorage.getItem(STORAGE_KEY);
        if (stored === 'light' || stored === 'dark') return stored;
    } catch {
        // localStorage unavailable — use system pref
    }
    if (window.matchMedia('(prefers-color-scheme: dark)').matches) return 'dark';
    return 'light';
}

/** Apply a theme to <html data-theme> and persist to localStorage. */
export function applyTheme(theme: Theme): void {
    document.documentElement.setAttribute('data-theme', theme);
    try {
        localStorage.setItem(STORAGE_KEY, theme);
    } catch {
        // localStorage full or unavailable — silently skip
    }
}

/** Toggle between light and dark, returning the new theme. */
export function toggleTheme(current: Theme): Theme {
    const next: Theme = current === 'dark' ? 'light' : 'dark';
    applyTheme(next);
    return next;
}
