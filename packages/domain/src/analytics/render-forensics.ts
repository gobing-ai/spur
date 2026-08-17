import type { HistoryArtifact, StepStat } from './artifact';
import { selectorDigest } from './artifact';
import type { DerivedVariables } from './derived';
import { fmtBytes, fmtDur } from './render-report';

/**
 * The 2 partial and 6 model-authored sections are **not** stubbed here - they are task
 * 0556's (skill-authored) half; a placeholder would read as a complete report and is the
 * same failure class as rendering unmeasured data as zero. The per-step rankings and
 * cache re-send waste sections (task 0581) render from additive artifact fields; a
 * pre-0581 artifact states `not available` for them (R5).
 *
 * Tokens, not prices (R3): renders provider-reported token counts and a cache-hit ratio. No
 * currency value anywhere — `costUsd` fields are deliberately unread, and this module adds no
 * consumer of `MODEL_PRICING`.
 *
 * Honest incompleteness (R5): sections whose derived inputs are missing state `not available`
 * rather than rendering zeros or vanishing. Renderers read fields; they never compute metrics
 * (percentages and phase walls from stored boundaries are presentation, not derivation).
 */
export function renderForensics(artifact: HistoryArtifact): string {
    const lines: string[] = [];
    const derived = artifact.derived ?? null;

    lines.push(`# History forensics report — generated ${artifact.generatedAt}`);
    lines.push(
        `spur ${artifact.spurVersion} · schema v${artifact.schemaVersion} · selector ${selectorDigest(artifact.selector)}`,
    );
    lines.push('');

    lines.push(...renderSessionSummary(artifact, derived));
    lines.push(...renderTimeDecomposition(derived));
    lines.push(...renderPhases(derived));
    lines.push(...renderToolExecutionTime(artifact));
    lines.push(...renderPerStep(artifact));
    lines.push(...renderBottlenecks(derived));
    lines.push(...renderRawData(artifact));

    return lines.join('\n');
}

// ---------------------------------------------------------------------------
// Section 1 — Session Data Summary (incl. Tool Breakdown + Token Profile)
// ---------------------------------------------------------------------------

function renderSessionSummary(artifact: HistoryArtifact, derived: DerivedVariables | null): string[] {
    const t = artifact.totals;
    const wall = derived !== null ? fmtWall(derived.timeDecomposition.spanMs) : 'not available (no derived block)';
    const lines = [
        '## Session Data Summary',
        '',
        '| Metric | Value |',
        '| --- | --- |',
        `| Sessions | ${artifact.bySession.length.toLocaleString('en-US')} |`,
        `| Wall-clock span | ${wall} |`,
        `| Messages | ${t.messages.toLocaleString('en-US')} |`,
        `| Tool calls | ${t.toolCalls.toLocaleString('en-US')} |`,
        `| Records with provider usage | ${t.recordsWithUsage.toLocaleString('en-US')} of ${t.records.toLocaleString('en-US')} |`,
        `| Input tokens (billed, cache incl.) | ${t.inputTokens.toLocaleString('en-US')} |`,
        `| Output tokens | ${t.outputTokens.toLocaleString('en-US')} |`,
        '',
    ];

    lines.push(...renderToolBreakdown(artifact));
    lines.push(...renderTokenProfile(artifact));
    return lines;
}

function renderToolBreakdown(artifact: HistoryArtifact): string[] {
    const lines = [
        '',
        '### Tool Breakdown',
        '',
        '| Tool | Calls | Errors | Result bytes |',
        '| --- | ---: | ---: | ---: |',
    ];
    const totalCalls = artifact.totals.toolCalls;
    for (const tool of [...artifact.byTool].sort((a, b) => b.calls - a.calls)) {
        const share = totalCalls > 0 ? `${Math.round((tool.calls / totalCalls) * 100)}%` : 'n/a';
        lines.push(
            `| ${tool.toolName} | ${tool.calls.toLocaleString('en-US')} (${share}) | ${tool.errors} | ${fmtBytes(tool.resultBytes)} |`,
        );
    }
    if (artifact.byTool.length === 0) {
        lines.push('| (no tool calls in selection) | | | |');
    }
    lines.push('');
    return lines;
}

function renderTokenProfile(artifact: HistoryArtifact): string[] {
    const t = artifact.totals;
    // Billed input includes cache reads + writes; fresh = what the model saw uncached.
    const fresh = Math.max(0, t.inputTokens - t.cacheReadTokens - t.cacheWriteTokens);
    const lines = [
        '### Token Profile',
        '',
        `- Billed input: ${t.inputTokens.toLocaleString('en-US')} (fresh ${fresh.toLocaleString('en-US')} · cache-read ${t.cacheReadTokens.toLocaleString('en-US')} · cache-write ${t.cacheWriteTokens.toLocaleString('en-US')})`,
        `- Output: ${t.outputTokens.toLocaleString('en-US')}`,
        `- Cache-hit ratio: ${formatCacheHitRatio(t.cacheReadTokens, t.inputTokens, t.recordsWithUsage)}`,
        '',
    ];
    if (Object.keys(artifact.byModel).length > 0) {
        lines.push(
            '| Model | Messages | Input | Output | Cache read | Cache write |',
            '| --- | ---: | ---: | ---: | ---: | ---: |',
        );
        for (const [model, bucket] of Object.entries(artifact.byModel)) {
            lines.push(
                `| ${model} | ${bucket.messages.toLocaleString('en-US')} | ${bucket.inputTokens.toLocaleString('en-US')} | ${bucket.outputTokens.toLocaleString('en-US')} | ${bucket.cacheReadTokens.toLocaleString('en-US')} | ${bucket.cacheWriteTokens.toLocaleString('en-US')} |`,
            );
        }
        lines.push('');
    }
    return lines;
}

// ---------------------------------------------------------------------------
// Section 2 — Time Decomposition headline
// ---------------------------------------------------------------------------

function renderTimeDecomposition(derived: DerivedVariables | null): string[] {
    const lines = ['## Time Decomposition', ''];
    if (derived === null) {
        lines.push(NOT_AVAILABLE_DERIVED, '');
        return lines;
    }
    const d = derived.timeDecomposition;
    const pct = (ms: number) => (d.spanMs > 0 ? `${Math.round((ms / d.spanMs) * 100)}%` : 'n/a');
    lines.push(
        '| Component | Time | Share of wall |',
        '| --- | ---: | ---: |',
        `| LLM latency (assistant duration) | ${fmtWall(d.llmMs)} | ${pct(d.llmMs)} |`,
        `| Tool execution | ${fmtWall(d.toolMs)} | ${pct(d.toolMs)} |`,
        `| Idle / overhead | ${fmtWall(d.idleMs)} | ${pct(d.idleMs)} |`,
        `| Unattributed (unmeasured durations) | ${fmtWall(d.unattributedMs)} | ${pct(d.unattributedMs)} |`,
        `| **Wall clock (span)** | **${fmtWall(d.spanMs)}** | 100% |`,
        '',
        d.spanExcludedSessions > 0
            ? `_Span excludes ${d.spanExcludedSessions} session(s) with unusable timestamps (sentinel-only or non-ISO); their measured durations still count above._`
            : '',
        '',
    );
    return lines;
}

// ---------------------------------------------------------------------------
// Section 3 — Per-Phase table
// ---------------------------------------------------------------------------

function renderPhases(derived: DerivedVariables | null): string[] {
    const lines = ['## Per-Phase Breakdown', ''];
    if (derived === null) {
        lines.push(NOT_AVAILABLE_DERIVED, '');
        return lines;
    }
    if (derived.phases.phaseSupport === 'unsupported') {
        lines.push(
            '> not available — this selection carries no todo-tool phase signal, so phases cannot be extracted.',
            '',
        );
        return lines;
    }
    lines.push('| # | Phase | Started | Wall |', '| ---: | --- | --- | ---: |');
    derived.phases.phases.forEach((phase, i) => {
        const wallMs = Date.parse(phase.endedAt) - Date.parse(phase.startedAt);
        lines.push(`| ${i} | ${phase.name} | ${phase.startedAt} | ${Number.isNaN(wallMs) ? 'n/a' : fmtWall(wallMs)} |`);
    });
    if (derived.phases.phases.length === 0) {
        lines.push('| (todo signal present but no phases extracted) | | | |');
    }
    lines.push('');
    return lines;
}

// ---------------------------------------------------------------------------
// Section 4 — Per-Tool Execution Time
// ---------------------------------------------------------------------------

function renderToolExecutionTime(artifact: HistoryArtifact): string[] {
    const lines = [
        '## Per-Tool Execution Time',
        '',
        '| Tool | Total | Mean | Max | Unmeasured calls |',
        '| --- | ---: | ---: | ---: | ---: |',
    ];
    for (const tool of [...artifact.byTool].sort((a, b) => b.durationMsTotal - a.durationMsTotal)) {
        lines.push(
            `| ${tool.toolName} | ${fmtToolDur(tool.durationMsTotal, tool)} | ${fmtToolDur(tool.durationMsMean, tool)} | ${fmtToolDur(tool.durationMsMax, tool)} | ${tool.durationUnmeasured} |`,
        );
    }
    if (artifact.byTool.length === 0) {
        lines.push('| (no tool calls in selection) | | | | |');
    }
    lines.push('');
    return lines;
}

// ---------------------------------------------------------------------------
// Section 5 - Per-Step Analysis (0581)
// ---------------------------------------------------------------------------

const NOT_AVAILABLE_PER_STEP =
    '> not available - artifact predates the per-step sections (rerun `spur history analyze`)';

function renderPerStep(artifact: HistoryArtifact): string[] {
    const lines = ['## Per-Step Analysis', ''];
    if (
        artifact.topStepsByTokens === undefined &&
        artifact.topStepsByDuration === undefined &&
        artifact.cacheWaste === undefined &&
        artifact.stepSupport === undefined
    ) {
        lines.push(NOT_AVAILABLE_PER_STEP, '');
        return lines;
    }
    if ((artifact.stepSupport?.length ?? 0) > 0) {
        lines.push(
            '### Section Support',
            '',
            '| Source | Assistant steps | Tokens | Time | Cache |',
            '| --- | ---: | --- | --- | --- |',
        );
        for (const e of artifact.stepSupport ?? []) {
            lines.push(
                `| ${e.source} | ${e.assistantSteps.toLocaleString('en-US')} | ${e.stepsWithUsage > 0 ? 'yes' : 'no'} | ${e.stepsWithDuration > 0 ? 'yes' : 'no'} | ${e.stepsWithCacheRead > 0 ? 'yes' : 'no'} |`,
            );
        }
        lines.push('');
    }
    lines.push(...renderTopStepsByTokens(artifact));
    lines.push(...renderTopStepsByDuration(artifact));
    lines.push(...renderCacheWaste(artifact));
    return lines;
}

function renderTopStepsByTokens(artifact: HistoryArtifact): string[] {
    const lines = ['### Top Steps by Total Tokens', ''];
    if (artifact.topStepsByTokens === undefined) {
        lines.push(NOT_AVAILABLE_PER_STEP, '');
        return lines;
    }
    if (artifact.topStepsByTokens.length === 0) {
        lines.push('(no assistant steps with provider usage in selection)', '');
        return lines;
    }
    const multiSource = (artifact.stepSupport?.length ?? 0) > 1;
    lines.push(
        ...(multiSource
            ? [
                  '| Model | Source | Input | Cache read | Output | Duration | Session |',
                  '| --- | --- | ---: | ---: | ---: | ---: | --- |',
              ]
            : [
                  '| Model | Input | Cache read | Output | Duration | Session |',
                  '| --- | ---: | ---: | ---: | ---: | --- |',
              ]),
    );
    for (const s of artifact.topStepsByTokens) {
        lines.push(`| ${stepRowCells(s, multiSource).join(' | ')} |`);
    }
    lines.push('');
    return lines;
}

function renderTopStepsByDuration(artifact: HistoryArtifact): string[] {
    const lines = ['### Top Steps by Duration', ''];
    if (artifact.topStepsByDuration === undefined) {
        lines.push(NOT_AVAILABLE_PER_STEP, '');
        return lines;
    }
    if (artifact.topStepsByDuration.length === 0) {
        lines.push('(no assistant steps carry measured duration in selection)', '');
        return lines;
    }
    const support = artifact.stepSupport;
    if (support !== undefined) {
        const totalSteps = support.reduce((sum, e) => sum + e.assistantSteps, 0);
        const measured = support.reduce((sum, e) => sum + e.stepsWithDuration, 0);
        if (totalSteps > measured) {
            lines.push(
                `Excluding ${(totalSteps - measured).toLocaleString('en-US')} assistant step(s) without measured duration.`,
                '',
            );
        }
    }
    const multiSource = (artifact.stepSupport?.length ?? 0) > 1;
    lines.push(
        ...(multiSource
            ? [
                  '| Model | Source | Input | Cache read | Output | Duration | Session |',
                  '| --- | --- | ---: | ---: | ---: | ---: | --- |',
              ]
            : [
                  '| Model | Input | Cache read | Output | Duration | Session |',
                  '| --- | ---: | ---: | ---: | ---: | --- |',
              ]),
    );
    for (const s of artifact.topStepsByDuration) {
        lines.push(`| ${stepRowCells(s, multiSource).join(' | ')} |`);
    }
    lines.push('');
    return lines;
}

function renderCacheWaste(artifact: HistoryArtifact): string[] {
    const lines = ['### Cache Re-Send Waste', ''];
    const cw = artifact.cacheWaste;
    if (cw === undefined) {
        lines.push(NOT_AVAILABLE_PER_STEP, '');
        return lines;
    }
    if (cw.steps === 0) {
        lines.push('(no assistant step met the re-send filter: input > 100,000 tokens and < 10% cache reuse)', '');
        return lines;
    }
    lines.push(
        `Re-sent context: ${cw.steps.toLocaleString('en-US')} steps · ${cw.inputTokens.toLocaleString('en-US')} fresh input tokens (input > 100,000 and < 10% cache reuse).`,
        '',
    );
    if (cw.topSteps.length > 0) {
        lines.push('| Model | Input | Cache read | Reuse % | Session |', '| --- | ---: | ---: | ---: | --- |');
        for (const s of cw.topSteps) {
            const reuse =
                s.cacheReadTokens !== null && s.inputTokens !== null && s.inputTokens > 0
                    ? `${((s.cacheReadTokens / s.inputTokens) * 100).toFixed(1)}%`
                    : 'n/a';
            lines.push(
                `| ${s.model ?? 'unknown'} | ${fmtTok(s.inputTokens)} | ${fmtTok(s.cacheReadTokens)} | ${reuse} | ${fmtSessionId(s.sessionId)} |`,
            );
        }
        lines.push('');
    }
    return lines;
}

/** Step table row cells shared by the token and duration rankings (source column when multi-source). */
function stepRowCells(s: StepStat, multiSource: boolean): string[] {
    return [
        s.model ?? 'unknown',
        ...(multiSource ? [s.source] : []),
        fmtTok(s.inputTokens),
        fmtTok(s.cacheReadTokens),
        fmtTok(s.outputTokens),
        s.durationMs === null ? 'n/a' : fmtDur(s.durationMs),
        fmtSessionId(s.sessionId),
    ];
}

// ---------------------------------------------------------------------------
// Section 6 - Bottleneck Ranking
// ---------------------------------------------------------------------------

function renderBottlenecks(derived: DerivedVariables | null): string[] {
    const lines = ['## Bottleneck Ranking', ''];
    if (derived === null) {
        lines.push(NOT_AVAILABLE_DERIVED, '');
        return lines;
    }
    lines.push('| Rank | Bottleneck | Time | Share of wall |', '| ---: | --- | ---: | ---: |');
    derived.bottlenecks.forEach((b, i) => {
        lines.push(`| ${i + 1} | ${b.label} | ${fmtWall(b.ms)} | ${Math.round(b.share * 100)}% |`);
    });
    if (derived.bottlenecks.length === 0) {
        lines.push('| (no bottleneck exceeded the ranking threshold) | | | |');
    }
    lines.push('');
    return lines;
}

// ---------------------------------------------------------------------------
// Section 7 - Raw Data appendix
// ---------------------------------------------------------------------------

function renderRawData(artifact: HistoryArtifact): string[] {
    const s = artifact.selector;
    const lines = [
        '## Raw Data',
        '',
        `- Selector: since=${s.since ?? '-'} until=${s.until ?? '-'} sources=${s.sources ? s.sources.join(',') : 'all'} session=${s.sessionId ?? '-'} run=${s.runId ?? '-'} task=${s.taskWbs ?? '-'}`,
        `- Counts: ${artifact.bySession.length} sessions · ${artifact.byTool.length} tools · ${artifact.loops.length} loops · ${artifact.warnings.length} warnings`,
    ];
    if (artifact.warnings.length > 0) {
        lines.push(`- Warning codes: ${[...new Set(artifact.warnings.map((w) => w.code))].join(', ')}`);
    }
    if (artifact.coverage.length > 0) {
        lines.push(
            '',
            '| Source | Status | Files | Messages | Tool calls | Unknown |',
            '| --- | --- | ---: | ---: | ---: | ---: |',
        );
        for (const c of artifact.coverage) {
            lines.push(
                `| ${c.source} | ${c.status} | ${c.files} | ${c.messages} | ${c.toolCalls} | ${c.unknownRecords} |`,
            );
        }
    }
    return lines;
}

// ---------------------------------------------------------------------------
// Formatting helpers
// ---------------------------------------------------------------------------

const NOT_AVAILABLE_DERIVED = '> not available — artifact has no derived block (rerun `spur history analyze`)';

/** Wall-clock formatting for forensics scales: `86ms` → `1.2s` → `3.4m` → `5.2h`. */
export function fmtWall(ms: number): string {
    if (ms < 1000) return `${Math.round(ms)}ms`;
    if (ms < 60_000) return `${(ms / 1000).toFixed(1)}s`;
    if (ms < 3_600_000) return `${(ms / 60_000).toFixed(1)}m`;
    return `${(ms / 3_600_000).toFixed(1)}h`;
}

/**
 * Cache-hit ratio (R3): share of billed input tokens served from the provider's prompt cache.
 * `n/a` when no record carried provider usage — the never-fabricate invariant means unknown
 * cache dimensions render unavailable, not 0%.
 */
function formatCacheHitRatio(cacheRead: number, billedInput: number, recordsWithUsage: number): string {
    if (recordsWithUsage === 0) {
        return 'n/a — no records carried provider usage data';
    }
    if (billedInput === 0) {
        return 'n/a — no input tokens reported';
    }
    return `${((cacheRead / billedInput) * 100).toFixed(1)}% of billed input served from cache`;
}

/** Token cell for per-step tables: null is unmeasured, rendered `n/a` (R5). */
function fmtTok(n: number | null): string {
    return n === null ? 'n/a' : n.toLocaleString('en-US');
}

/** Session ids are uuid-scale; keep the table readable with a stable prefix. */
function fmtSessionId(id: string): string {
    return id.length > 12 ? `${id.slice(0, 12)}…` : id;
}

/** Tool duration with the all-unmeasured -> `n/a` convention (never zero for unknown). */
function fmtToolDur(ms: number, bucket: { durationUnmeasured: number; calls: number }): string {
    const allUnmeasured = bucket.calls > 0 && bucket.durationUnmeasured === bucket.calls;
    return allUnmeasured ? 'n/a' : fmtDur(ms);
}
