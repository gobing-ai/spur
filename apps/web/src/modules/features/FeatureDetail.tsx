import { useCallback, useEffect, useState } from 'react';
import { Badge, Button, Card, CardBody, Loading, Select } from '@/ui';
import { checkFeature, loadFeatureShow, transitionFeature } from '../../lib/feature-client';
import type { CheckResult, FeatureShowData } from '../../lib/feature-types';

const FEATURE_STATUSES = ['backlog', 'active', 'verifying', 'blocked', 'done', 'cancelled'] as const;

interface FeatureDetailProps {
    featureId: string;
}

/**
 * Feature detail panel (task 0194 R3–R5).
 *
 * Fetches the full feature body, renders frontmatter + Goal + Scope + rendered
 * Acceptance Criteria + linked tasks, and offers a lifecycle-guarded status
 * transition (denial surfaced) + a check runner (L1–L4 findings grouped by layer).
 */
export default function FeatureDetail({ featureId }: FeatureDetailProps) {
    const [data, setData] = useState<FeatureShowData | null>(null);
    const [error, setError] = useState<string | null>(null);
    const [transitionError, setTransitionError] = useState<string | null>(null);
    const [checkResult, setCheckResult] = useState<CheckResult | null>(null);
    const [checkLoading, setCheckLoading] = useState(false);
    const [transitioning, setTransitioning] = useState(false);

    const load = useCallback(
        async (signal: AbortSignal) => {
            try {
                const result = await loadFeatureShow(featureId, signal);
                setData(result);
                setError(null);
            } catch (err) {
                if (signal.aborted) return;
                setError(err instanceof Error ? err.message : String(err));
            }
        },
        [featureId],
    );

    useEffect(() => {
        const controller = new AbortController();
        void load(controller.signal);
        return () => controller.abort();
    }, [load]);

    const handleTransition = async (toStatus: string) => {
        setTransitionError(null);
        setTransitioning(true);
        try {
            await transitionFeature(featureId, toStatus, new AbortController().signal);
            // Refetch to get the updated data.
            await load(new AbortController().signal);
        } catch (err) {
            setTransitionError(err instanceof Error ? err.message : String(err));
        } finally {
            setTransitioning(false);
        }
    };

    const handleCheck = async () => {
        setCheckLoading(true);
        setCheckResult(null);
        try {
            const result = await checkFeature(featureId, new AbortController().signal);
            setCheckResult(result);
        } catch (err) {
            setCheckResult({
                id: featureId,
                status: data?.status ?? '?',
                pass: false,
                findings: [
                    {
                        layer: 'L1',
                        severity: 'error',
                        section: '',
                        message: err instanceof Error ? err.message : String(err),
                    },
                ],
                requiredSections: [],
                missingSections: [],
            });
        } finally {
            setCheckLoading(false);
        }
    };

    if (error) {
        return (
            <div className="p-4 text-sm text-error" role="alert">
                Failed to load feature {featureId}: {error}
            </div>
        );
    }

    if (data === null) {
        return (
            <div className="flex items-center justify-center h-32 text-spur-text-muted text-sm">
                <Loading size="sm" /> Loading {featureId}…
            </div>
        );
    }

    const sections = extractSections(data.content);
    const goal = sections.get('Goal');
    const scope = sections.get('Scope');
    const ac = sections.get('Acceptance Criteria');

    return (
        <div className="p-4 space-y-4" data-feature-detail>
            {/* Header */}
            <div className="flex items-start justify-between gap-4">
                <div>
                    <h2 className="text-lg font-semibold text-spur-text">
                        <span className="text-spur-text-muted font-mono text-sm mr-2">{data.id}</span>
                        {data.name}
                    </h2>
                </div>
                <Badge variant="outline" size="sm">
                    {data.status}
                </Badge>
            </div>

            {/* Status transition */}
            <Card variant="compact" className="bg-base-200 border border-spur-border">
                <CardBody className="p-3 gap-2">
                    <span className="text-xs font-semibold text-spur-text uppercase tracking-wide">
                        Transition Status
                    </span>
                    <div className="flex items-center gap-2 mt-1">
                        <Select
                            size="sm"
                            defaultValue=""
                            onChange={(e) => {
                                const val = (e.target as HTMLSelectElement).value;
                                if (val) void handleTransition(val);
                            }}
                            disabled={transitioning}
                        >
                            <option value="" disabled>
                                {transitioning ? 'Updating…' : 'Change to…'}
                            </option>
                            {FEATURE_STATUSES.filter((s) => s !== data.status).map((s) => (
                                <option key={s} value={s}>
                                    {s}
                                </option>
                            ))}
                        </Select>
                    </div>
                    {transitionError && (
                        <div className="mt-1 text-xs text-error" role="alert">
                            Denied: {transitionError}
                        </div>
                    )}
                </CardBody>
            </Card>

            {/* Goal */}
            {goal && <SectionCard title="Goal">{goal}</SectionCard>}

            {/* Scope */}
            {scope && <SectionCard title="Scope">{scope}</SectionCard>}

            {/* Acceptance Criteria */}
            {ac && (
                <SectionCard title="Acceptance Criteria">
                    <pre className="text-xs whitespace-pre-wrap font-mono">{stripGherkinFence(ac)}</pre>
                </SectionCard>
            )}

            {/* Frontmatter */}
            <SectionCard title="Frontmatter">
                <dl className="grid grid-cols-1 gap-1 text-xs">
                    {Object.entries(data.frontmatter)
                        .filter(([, v]) => v !== null && v !== undefined)
                        .sort(([a], [b]) => a.localeCompare(b))
                        .map(([k, v]) => (
                            <div key={k} className="flex gap-2">
                                <dt className="text-spur-text-muted font-medium w-28 shrink-0">{k}</dt>
                                <dd className="text-spur-text font-mono truncate">{String(v)}</dd>
                            </div>
                        ))}
                </dl>
            </SectionCard>

            {/* Check runner */}
            <Card variant="compact" className="bg-base-200 border border-spur-border">
                <CardBody className="p-3 gap-2">
                    <div className="flex items-center justify-between">
                        <span className="text-xs font-semibold text-spur-text uppercase tracking-wide">
                            Feature Check
                        </span>
                        <Button size="xs" onClick={() => void handleCheck()} disabled={checkLoading}>
                            {checkLoading ? 'Running…' : 'Run Check'}
                        </Button>
                    </div>
                    {checkResult && (
                        <div className="mt-2 space-y-1" data-feature-check>
                            {checkResult.pass ? (
                                <span className="text-xs text-success">✓ Passed</span>
                            ) : (
                                <span className="text-xs text-error">
                                    ✗ Failed ({checkResult.findings.length} finding(s))
                                </span>
                            )}
                            {checkResult.findings.map((f) => (
                                <div
                                    key={`${f.layer}:${f.section}:${f.message}`}
                                    className="flex items-start gap-2 text-xs"
                                >
                                    <Badge
                                        variant={
                                            f.severity === 'error'
                                                ? 'error'
                                                : f.severity === 'warning'
                                                  ? 'warning'
                                                  : 'ghost'
                                        }
                                        size="xs"
                                    >
                                        {f.layer}
                                    </Badge>
                                    <span className="text-spur-text-muted">{f.section ? `[${f.section}] ` : ''}</span>
                                    <span className="text-spur-text">{f.message}</span>
                                </div>
                            ))}
                            {checkResult.missingSections.length > 0 && (
                                <div className="text-xs text-warning mt-1">
                                    Missing: {checkResult.missingSections.join(', ')}
                                </div>
                            )}
                        </div>
                    )}
                </CardBody>
            </Card>
        </div>
    );
}

/** Simple section extractor — splits `## Heading` blocks from markdown content. */
function extractSections(content: string): Map<string, string> {
    const map = new Map<string, string>();
    const parts = content.split(/\n## /);
    for (const part of parts) {
        const newlineIdx = part.indexOf('\n');
        if (newlineIdx === -1) continue;
        const heading = part.slice(0, newlineIdx).trim();
        const body = part.slice(newlineIdx + 1).trim();
        if (heading) map.set(heading, body);
    }
    return map;
}

/** Strip the ```gherkin wrapper fence from AC content for presentational rendering. */
function stripGherkinFence(text: string): string {
    return text
        .replace(/^```gherkin\s*\n/, '')
        .replace(/\n```\s*$/, '')
        .trim();
}

function SectionCard({ title, children }: { title: string; children: React.ReactNode }) {
    return (
        <Card variant="compact" className="bg-base-200 border border-spur-border">
            <CardBody className="p-3 gap-1">
                <span className="text-xs font-semibold text-spur-text uppercase tracking-wide">{title}</span>
                <div className="text-sm text-spur-text leading-snug mt-1">{children}</div>
            </CardBody>
        </Card>
    );
}
