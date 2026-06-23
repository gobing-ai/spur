import { useCallback, useEffect, useState } from 'react';
import { Button } from '@/ui';
import { resolveTheme, type Theme, toggleTheme } from '../lib/theme';

/** A toggle button that switches between daisyUI light/dark themes. */
export default function ThemeToggle() {
    const [theme, setTheme] = useState<Theme>(resolveTheme);

    // Sync system preference changes when no explicit choice has been saved
    useEffect(() => {
        const mq = window.matchMedia('(prefers-color-scheme: dark)');
        const handler = (e: MediaQueryListEvent) => {
            const stored = (() => {
                try {
                    return localStorage.getItem('spur-theme');
                } catch {
                    return null;
                }
            })();
            // Only follow the system if the user hasn't made an explicit choice
            if (!stored) {
                const next: Theme = e.matches ? 'dark' : 'light';
                setTheme(next);
                document.documentElement.setAttribute('data-theme', next);
            }
        };
        mq.addEventListener('change', handler);
        return () => mq.removeEventListener('change', handler);
    }, []);

    const onClick = useCallback(() => setTheme(toggleTheme), []);

    return (
        <Button
            variant="ghost"
            size="sm"
            onClick={onClick}
            className="text-spur-text-muted"
            aria-label={theme === 'dark' ? 'Switch to light mode' : 'Switch to dark mode'}
        >
            {theme === 'dark' ? '☀️' : '🌙'}
        </Button>
    );
}
