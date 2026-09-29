// packages/app/src/workflow/step-profile.ts
var DEFAULT_LAST = 20;
var DEFAULT_WINDOW_SEC = 300;
function nearestRankP50(values) {
  if (values.length === 0)
    return null;
  const sorted = [...values].sort((a, b) => a - b);
  return sorted[Math.ceil(sorted.length / 2) - 1] ?? null;
}
function numeric(value) {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}
function msBetween(from, to) {
  if (typeof from !== "string" || typeof to !== "string")
    return null;
  const start = Date.parse(from);
  const end = Date.parse(to);
  if (!Number.isFinite(start) || !Number.isFinite(end))
    return null;
  return end - start;
}
function sessionOf(event) {
  const value = event.invocation?.continue;
  if (value === true)
    return "resumed";
  if (value === false)
    return "fresh";
  return null;
}
function cacheHitOf(event) {
  return numeric(event.cost?.exact?.cacheHit);
}
function startKey(event) {
  const parsed = typeof event.startedAt === "string" ? Date.parse(event.startedAt) : Number.NaN;
  return Number.isFinite(parsed) ? parsed : Number.POSITIVE_INFINITY;
}
function extractExecutions(runId, events) {
  const actions = events.filter((e) => e.kind === "action").sort((a, b) => {
    const left = startKey(a);
    const right = startKey(b);
    return left === right ? 0 : left - right;
  });
  const executions = [];
  for (const [index, event] of actions.entries()) {
    const previous = index === 0 ? undefined : actions[index - 1];
    executions.push({
      runId,
      node: event.node ?? "",
      actionKind: event.actionKind ?? "",
      durationMs: numeric(event.durationMs),
      idleGapMs: msBetween(previous?.completedAt, event.startedAt),
      session: sessionOf(event),
      cacheHit: cacheHitOf(event)
    });
  }
  return executions;
}
function foldSession(executions) {
  const known = new Set(executions.map((e) => e.session).filter((s) => s !== null));
  if (known.size === 0)
    return null;
  if (known.size === 1)
    return [...known][0] ?? null;
  return "mixed";
}
function rowFlags(row, windowSec) {
  const wMs = windowSec * 1000;
  const flags = [];
  const agentRun = row.actionKind === "agent.run";
  const resumed = row.session === "resumed" || row.session === "mixed";
  const p50 = row.durationMs.p50;
  if (!agentRun && p50 !== null && p50 > wMs)
    flags.push("step-over-window");
  const idle = row.idleGapMs.p50;
  if (agentRun && resumed && idle !== null && idle > wMs)
    flags.push("resume-after-idle");
  const hit = row.cacheHit.p50;
  if (agentRun && resumed && row.cacheHit.known > 0 && hit !== null && hit < 0.5)
    flags.push("resume-cold-cache");
  if (agentRun && p50 !== null && p50 > 2 * wMs)
    flags.push("agent-run-over-2w");
  return flags;
}
function buildRows(executions, windowSec) {
  const grouped = new Map;
  for (const execution of executions) {
    const key = `${execution.node}\x00${execution.actionKind}`;
    const bucket = grouped.get(key);
    if (bucket === undefined)
      grouped.set(key, [execution]);
    else
      bucket.push(execution);
  }
  const rows = [];
  for (const bucket of grouped.values()) {
    const first = bucket[0];
    if (first === undefined)
      continue;
    const durations = bucket.map((e) => e.durationMs).filter((d) => d !== null);
    const gaps = bucket.map((e) => e.idleGapMs).filter((g) => g !== null);
    const hits = bucket.map((e) => e.cacheHit).filter((h) => h !== null);
    const row = {
      node: first.node,
      actionKind: first.actionKind,
      runs: new Set(bucket.map((e) => e.runId)).size,
      executions: bucket.length,
      durationMs: {
        p50: nearestRankP50(durations),
        max: durations.length === 0 ? null : Math.max(...durations)
      },
      idleGapMs: { p50: nearestRankP50(gaps) },
      session: first.actionKind === "agent.run" ? foldSession(bucket) : null,
      cacheHit: {
        p50: nearestRankP50(hits),
        known: hits.length,
        of: bucket.length
      },
      flags: []
    };
    row.flags = rowFlags(row, windowSec);
    rows.push(row);
  }
  return rows.sort((a, b) => a.node === b.node ? a.actionKind.localeCompare(b.actionKind) : a.node.localeCompare(b.node));
}
function buildStepProfile(input) {
  const executions = input.runs.flatMap((run) => extractExecutions(run.runId, run.events));
  return {
    workflow: input.workflow,
    windowSec: input.windowSec,
    sampledRuns: input.runs.length,
    rows: buildRows(executions, input.windowSec)
  };
}
function nonDryRuns(entries) {
  return entries.filter((e) => e.isDryRun !== true && typeof e.runId === "string" && e.runId.length > 0);
}
function seconds(value) {
  return value === null ? "?" : `${(value / 1000).toFixed(1)}s`;
}
function ratio(value) {
  return value === null ? "?" : value.toFixed(2);
}
function formatStepProfileHuman(profile) {
  const lines = [
    `step profile — ${profile.workflow} (window ${profile.windowSec}s, ${profile.sampledRuns} sampled runs)`
  ];
  for (const row of profile.rows) {
    lines.push([
      row.node.padEnd(20),
      row.actionKind.padEnd(14),
      `${row.runs}/${row.executions}`.padEnd(8),
      `p50=${seconds(row.durationMs.p50)}`.padEnd(12),
      `max=${seconds(row.durationMs.max)}`.padEnd(12),
      `idle=${seconds(row.idleGapMs.p50)}`.padEnd(12),
      `session=${row.session ?? "?"}`.padEnd(15),
      `cacheHit=${ratio(row.cacheHit.p50)} (${row.cacheHit.known}/${row.cacheHit.of})`.padEnd(20),
      `flags=${row.flags.length === 0 ? "-" : row.flags.join(",")}`
    ].join(" "));
  }
  return `${lines.join(`
`)}
`;
}
export {
  rowFlags,
  nonDryRuns,
  nearestRankP50,
  formatStepProfileHuman,
  extractExecutions,
  buildStepProfile,
  buildRows,
  DEFAULT_WINDOW_SEC,
  DEFAULT_LAST
};
