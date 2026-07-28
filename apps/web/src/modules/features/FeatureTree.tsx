import { Tooltip } from '@/ui';
import type { FeatureSummary } from '../../lib/feature-types';
import { FeatureStatusIcon, featureStatusLabel } from './status-icons';

interface FeatureTreeProps {
    features: FeatureSummary[];
    selectedId: string | null;
    onSelect: (id: string) => void;
}

/**
 * Feature tree (task 0194 R2).
 *
 * Builds an ID-derived hierarchy client-side from the flat feature list. Children
 * of `X` = features whose id.length === X.length + 1 AND id starts with X.
 * Each node renders a leading status indicator, its id, and its name; clicking selects it.
 */
/** Ascending ID order so the tree is stable A→Z regardless of API / filter order. */
function byFeatureId(a: FeatureSummary, b: FeatureSummary): number {
    return a.id.localeCompare(b.id);
}

export default function FeatureTree({ features, selectedId, onSelect }: FeatureTreeProps) {
    // Feature IDs are single-uppercase-letter + digits (DD-14): F, F1, F2, F1A, F1A1, etc.
    // Top-level features are those whose id is a root letter (one char).
    // Sort roots and every sibling group A→Z so the tree never mirrors arbitrary list order.
    const rootFeatures = features
        .filter((f) => f.id.length === 1)
        .slice()
        .sort(byFeatureId);
    const childrenMap = groupByParent(features);

    return (
        <ul className="py-1" data-feature-tree>
            {rootFeatures.map((f) => (
                <TreeNode
                    key={f.id}
                    feature={f}
                    childrenMap={childrenMap}
                    selectedId={selectedId}
                    onSelect={onSelect}
                    depth={0}
                />
            ))}
        </ul>
    );
}

function groupByParent(features: FeatureSummary[]): Map<string, FeatureSummary[]> {
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
    depth: number;
}

function TreeNode({ feature, childrenMap, selectedId, onSelect, depth }: TreeNodeProps) {
    const children = childrenMap.get(feature.id);
    const isSelected = feature.id === selectedId;
    const padLeft = `${depth * 16}px`;

    return (
        <li>
            <button
                type="button"
                onClick={() => onSelect(feature.id)}
                className={`w-full flex items-center gap-1.5 px-2 py-1 text-left text-sm transition-colors hover:bg-base-300 ${
                    isSelected ? 'bg-spur-accent/10 text-spur-accent font-semibold' : 'text-spur-text'
                }`}
                style={{ paddingLeft: `calc(0.5rem + ${padLeft})` }}
            >
                {/* The Tooltip wrapper carries daisyUI's CSS-only hover affordance (task 0336).
                    `flex!` pins the slot layout: daisyUI's `.tooltip` sets `display:inline-block`
                    later in the utilities layer, which would un-center the indicator without it.
                    Per ADR-034 the accessible name comes from the inner role="img" SVG, not the
                    tooltip — `data-tip` is presentational only. */}
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
            {children && children.length > 0 && (
                <ul>
                    {children.map((child) => (
                        <TreeNode
                            key={child.id}
                            feature={child}
                            childrenMap={childrenMap}
                            selectedId={selectedId}
                            onSelect={onSelect}
                            depth={depth + 1}
                        />
                    ))}
                </ul>
            )}
        </li>
    );
}
