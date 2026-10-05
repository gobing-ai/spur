import { Moon, Sun } from 'lucide-react';
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

    const label = theme === 'dark' ? 'Switch to light mode' : 'Switch to dark mode';
    return (
        <Button
            variant="ghost"
            size="sm"
            onClick={onClick}
            className="flex h-8 w-8 items-center justify-center rounded-md text-spur-text-muted hover:bg-spur-accent/20 hover:text-spur-accent focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-spur-accent"
            aria-label={label}
            title={label}
        >
            {theme === 'dark' ? (
                <Sun className="h-4 w-4 shrink-0" strokeWidth={1.8} aria-hidden="true" />
            ) : (
                <Moon className="h-4 w-4 shrink-0" strokeWidth={1.8} aria-hidden="true" />
            )}
        </Button>
    );
}
