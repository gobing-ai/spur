import {
    BarChart3,
    CheckSquare,
    Compass,
    FolderGit2,
    Layers,
    type LucideIcon,
    Plug,
    Radio,
    Search,
    Settings,
    Tag,
} from 'lucide-react';
import type { ReactNode } from 'react';

/** Size preset for a module icon. */
export type ModuleIconSize = 'sm' | 'md' | 'lg';

/** Props for {@link ModuleIcon}; `id` is the module identity, `icon` an optional declared glyph. */
export interface ModuleIconProps {
    /** Module id the icon resolves from (`tasks`, `projects`, …). */
    id: string;
    /** A declared icon value: a legacy emoji (kept working) or a literal the caller wants shown. */
    icon?: string;
    /** Size preset. Default: sm. */
    size?: ModuleIconSize;
    className?: string;
    'aria-hidden'?: boolean | 'true' | 'false';
}

const sizeClasses: Record<ModuleIconSize, string> = {
    sm: 'h-4 w-4 shrink-0',
    md: 'h-5 w-5 shrink-0',
    lg: 'h-6 w-6 shrink-0',
};

/**
 * The one built-in icon table (A83 1428): id → vector icon, the screen-reader label, and the legacy
 * emoji values that downstream declarations still carry. One table, not an if-chain — resolution,
 * labels and the compatibility aliases stay in step by construction.
 */
const BUILTIN: Record<string, { Icon: LucideIcon; label: string; emoji: readonly string[] }> = {
    observability: { Icon: Radio, label: 'Observability', emoji: ['📡'] },
    history: { Icon: BarChart3, label: 'History', emoji: ['📊'] },
    integrations: { Icon: Plug, label: 'Integrations', emoji: [] },
    plans: { Icon: Compass, label: 'Plans', emoji: ['🧭'] },
    designs: { Icon: Layers, label: 'Designs', emoji: ['📐'] },
    features: { Icon: Tag, label: 'Features', emoji: ['🏷️', '🏷', '🎯'] },
    tasks: { Icon: CheckSquare, label: 'Tasks', emoji: ['📋'] },
    projects: { Icon: FolderGit2, label: 'Projects', emoji: ['📁'] },
    settings: { Icon: Settings, label: 'Settings', emoji: ['⚙️', '⚙'] },
    search: { Icon: Search, label: 'Search', emoji: ['🔎'] },
};

/** The built-in entry for one id. */
function entryForId(id: string): (typeof BUILTIN)[string] | undefined {
    return Object.hasOwn(BUILTIN, id) ? BUILTIN[id] : undefined;
}

/** The built-in entry whose legacy emoji list carries `icon` (the downstream compatibility path). */
function entryForEmoji(icon: string): (typeof BUILTIN)[string] | undefined {
    return Object.values(BUILTIN).find((entry) => entry.emoji.includes(icon));
}

/**
 * Renders a consistent, high-fidelity Lucide icon for each module, resolved by module id.
 *
 * Resolution order (A83 1428 R3): the id's built-in entry → an entry whose legacy emoji list carries
 * the declared value (so a downstream `icon: '📡'` still renders Radio) → the declared literal as
 * text (an unknown downstream emoji is never rewritten) → `Layers`. Built-in descriptors no longer
 * declare an emoji at all, and the screen-reader text is the id's LABEL, not a glyph.
 */
export default function ModuleIcon({
    id,
    icon,
    size = 'sm',
    className,
    'aria-hidden': ariaHidden = true,
}: ModuleIconProps): ReactNode {
    const combinedClassName = className ? `${className} shrink-0` : sizeClasses[size];
    const strokeWidth = size === 'lg' ? 2 : 1.8;

    const byId = entryForId(id);
    const byEmoji = icon === undefined ? undefined : entryForEmoji(icon);
    const entry = byId ?? byEmoji;

    if (entry === undefined && icon !== undefined) {
        // A declared value this table does not know: render it verbatim. That is the downstream
        // custom-glyph path — never silently replaced with a vector icon.
        return <span className={className || sizeClasses[size]}>{icon}</span>;
    }

    const { Icon, label } = entry ?? { Icon: Layers, label: '' };
    const iconElement = <Icon className={combinedClassName} strokeWidth={strokeWidth} aria-hidden={ariaHidden} />;

    if (label !== '' && size === 'lg') {
        return (
            <>
                {iconElement}
                <span className="sr-only">{label}</span>
            </>
        );
    }
    return iconElement;
}
