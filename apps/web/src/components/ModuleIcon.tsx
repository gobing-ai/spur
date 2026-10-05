import { BarChart3, CheckSquare, Compass, FolderGit2, Layers, Radio, Settings, Tag } from 'lucide-react';
import type { ReactNode } from 'react';

export type ModuleIconSize = 'sm' | 'md' | 'lg';

export interface ModuleIconProps {
    id: string;
    icon?: string;
    size?: ModuleIconSize;
    className?: string;
    'aria-hidden'?: boolean | 'true' | 'false';
}

const sizeClasses: Record<ModuleIconSize, string> = {
    sm: 'h-4 w-4 shrink-0',
    md: 'h-5 w-5 shrink-0',
    lg: 'h-6 w-6 shrink-0',
};

const fallbackEmojiMap: Record<string, string> = {
    observability: '📡',
    history: '📊',
    plans: '🧭',
    designs: '📐',
    features: '🎯',
    tasks: '📋',
    projects: '📁',
    settings: '⚙️',
};

/**
 * Renders a consistent, high-fidelity Lucide icon for each module.
 * Replaces sandboxed emoji rendering with vector icons that adapt
 * to active and hover theme tokens (currentColor).
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
    const srText = icon ?? fallbackEmojiMap[id];

    let iconElement: ReactNode;

    if (id === 'observability' || icon === '📡') {
        iconElement = <Radio className={combinedClassName} strokeWidth={strokeWidth} aria-hidden={ariaHidden} />;
    } else if (id === 'history' || icon === '📊') {
        iconElement = <BarChart3 className={combinedClassName} strokeWidth={strokeWidth} aria-hidden={ariaHidden} />;
    } else if (id === 'plans' || icon === '🧭') {
        iconElement = <Compass className={combinedClassName} strokeWidth={strokeWidth} aria-hidden={ariaHidden} />;
    } else if (id === 'designs' || icon === '📐') {
        iconElement = <Layers className={combinedClassName} strokeWidth={strokeWidth} aria-hidden={ariaHidden} />;
    } else if (id === 'features' || icon === '🏷️' || icon === '🏷' || icon === '🎯') {
        iconElement = <Tag className={combinedClassName} strokeWidth={strokeWidth} aria-hidden={ariaHidden} />;
    } else if (id === 'tasks' || icon === '📋') {
        iconElement = <CheckSquare className={combinedClassName} strokeWidth={strokeWidth} aria-hidden={ariaHidden} />;
    } else if (id === 'projects' || icon === '📁') {
        iconElement = <FolderGit2 className={combinedClassName} strokeWidth={strokeWidth} aria-hidden={ariaHidden} />;
    } else if (id === 'settings' || icon === '⚙️' || icon === '⚙') {
        iconElement = <Settings className={combinedClassName} strokeWidth={strokeWidth} aria-hidden={ariaHidden} />;
    } else if (icon) {
        return <span className={className || sizeClasses[size]}>{icon}</span>;
    } else {
        iconElement = <Layers className={combinedClassName} strokeWidth={strokeWidth} aria-hidden={ariaHidden} />;
    }

    if (srText && size === 'lg') {
        return (
            <>
                {iconElement}
                <span className="sr-only">{srText}</span>
            </>
        );
    }
    return iconElement;
}
