import { useCallback, useState } from 'react';
import { Tooltip } from '@/ui';
import type { FeatureSummary } from '../../lib/feature-types';
import { FeatureStatusIcon, featureStatusLabel } from './status-icons';

interface FeatureTreeProps {
    features: FeatureSummary[];
    selectedId: string | null;
    onSelect: (id: string) => void;
}

/**
 * Feature tree (task 0194 R2 / F841 branch folding).
 *
 * Builds an ID-derived hierarchy client-side from the flat feature list. Children
 * of `X` = features whose id.length === X.length + 1 AND id starts with X.
 * Each node renders a leading status indicator, its id, and its name; parent nodes
 * have separate fold controls; clicking row selects it.
 */
/** Ascending ID order so the tree is stable A→Z regardless of API / filter order. */
function byFeatureId(a: FeatureSummary, b: FeatureSummary): number {
    return a.id.localeCompare(b.id);
}

export default function FeatureTree({ features, selectedId, onSelect }: FeatureTreeProps) {
    const [collapsedIds, setCollapsedIds] = useState<Set<string>>(() => new Set());

    const toggleFold = useCallback((id: string) => {
        setCollapsedIds((prev) => {
            const next = new Set(prev);
            if (next.has(id)) next.delete(id);
            else next.add(id);
            return next;
        });
    }, []);

    // Feature IDs are single-uppercase-letter + digits (DD-14): F, F1, F2, F1A, F1A1, etc.
    // Top-level features are those whose id is a root letter (one char).
    // Sort roots and every sibling group A→Z so the tree never mirrors arbitrary list order.
    const rootFeatures = features
        .filter((f) => f.id.length === 1)
        .slice()
        .sort(byFeatureId);
    const childrenMap = groupFeaturesByParent(features);

    return (
        <ul className="py-1" data-feature-tree>
            {rootFeatures.map((f) => (
                <TreeNode
                    key={f.id}
                    feature={f}
                    childrenMap={childrenMap}
                    selectedId={selectedId}
                    onSelect={onSelect}
                    collapsedIds={collapsedIds}
                    onToggleFold={toggleFold}
                    depth={0}
                />
            ))}
        </ul>
    );
}

/**
 * ID-prefix hierarchy grouping (DD-14): children of `X` = features whose id starts
 * with X and is exactly one segment longer (`parentId = id.slice(0, -1)`). Shared by
 * FeatureTree (visual tree) and FeatureDetail (child-feature listing, task 0525) so
 * both consumers stay on one algorithm. Sibling groups sort A→Z by id.
 */
export function groupFeaturesByParent(features: FeatureSummary[]): Map<string, FeatureSummary[]> {
    const map = new Map<string, FeatureSummary[]>();
    for (const f of features) {
        if (f.id.length <= 1) continue;
        const parentId = f.id.slice(0, -1);
        const siblings = map.get(parentId);
        if (siblings) {
            siblings.push(f);
        } else {
            map.set(parentId, [f]);
        }
    }
    for (const siblings of map.values()) {
        siblings.sort(byFeatureId);
    }
    return map;
}

interface TreeNodeProps {
    feature: FeatureSummary;
    childrenMap: Map<string, FeatureSummary[]>;
    selectedId: string | null;
    onSelect: (id: string) => void;
    collapsedIds: Set<string>;
    onToggleFold: (id: string) => void;
    depth: number;
}

function TreeNode({ feature, childrenMap, selectedId, onSelect, collapsedIds, onToggleFold, depth }: TreeNodeProps) {
    const children = childrenMap.get(feature.id);
    const hasChildren = children !== undefined && children.length > 0;
    const isCollapsed = collapsedIds.has(feature.id);
    const isSelected = feature.id === selectedId;
    const padLeft = `${depth * 16}px`;

    return (
        <li>
            <div
                className={`w-full flex items-center transition-colors hover:bg-base-300 ${
                    isSelected ? 'bg-spur-accent/10 text-spur-accent font-semibold' : 'text-spur-text'
                }`}
                style={{ paddingLeft: `calc(0.25rem + ${padLeft})` }}
            >
                {hasChildren ? (
                    <button
                        type="button"
                        onClick={(e) => {
                            e.stopPropagation();
                            onToggleFold(feature.id);
                        }}
                        aria-expanded={!isCollapsed}
                        aria-controls={`feature-tree-children-${feature.id}`}
                        aria-label={`${isCollapsed ? 'Expand' : 'Collapse'} ${feature.id}: ${feature.name}`}
                        className="p-1 hover:bg-base-100 rounded text-spur-text-muted hover:text-spur-text text-[10px] flex items-center justify-center shrink-0 w-5 h-5 cursor-pointer"
                    >
                        <span
                            className={`inline-block transition-transform duration-150 ${
                                isCollapsed ? '' : 'rotate-90'
                            }`}
                            aria-hidden="true"
                        >
                            ▶
                        </span>
                    </button>
                ) : (
                    <span className="w-5 shrink-0" aria-hidden="true" />
                )}
                <button
                    type="button"
                    onClick={() => onSelect(feature.id)}
                    className={`flex-1 flex items-center gap-1.5 px-1.5 py-1 text-left text-sm truncate min-w-0 cursor-pointer ${
                        isSelected ? 'bg-spur-accent/10 text-spur-accent font-semibold' : 'text-spur-text'
                    }`}
                >
                    <Tooltip
                        position="right"
                        tip={featureStatusLabel(feature.status)}
                        className="flex! w-4 shrink-0 items-center justify-center"
                        data-testid="feature-tree-status"
                    >
                        <FeatureStatusIcon status={feature.status} />
                    </Tooltip>
                    <span className="text-xs font-mono text-spur-text-muted shrink-0">{feature.id}</span>
                    <span className="flex-1 truncate">{feature.name}</span>
                </button>
            </div>
            {hasChildren && !isCollapsed && (
                <ul id={`feature-tree-children-${feature.id}`}>
                    {children.map((child) => (
                        <TreeNode
                            key={child.id}
                            feature={child}
                            childrenMap={childrenMap}
                            selectedId={selectedId}
                            onSelect={onSelect}
                            collapsedIds={collapsedIds}
                            onToggleFold={onToggleFold}
                            depth={depth + 1}
                        />
                    ))}
                </ul>
            )}
        </li>
    );
}
