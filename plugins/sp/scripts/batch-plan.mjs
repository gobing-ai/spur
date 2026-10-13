#!/usr/bin/env node
// @bun

// plugins/sp/scripts/batch-plan.ts
import { readFileSync } from "fs";

// plugins/sp/lib/plan-projection.generated.mjs
var NON_ABORTING_PREFLIGHT_CODES = new Set([
  "L4.scenario-unverified",
  "L4.verifying-incomplete-tasks"
]);
function classifyFeaturePreflightFindings(findings) {
  const aborting = [];
  const nonAborting = [];
  for (const f of findings) {
    if (f.severity === "error") {
      if (NON_ABORTING_PREFLIGHT_CODES.has(f.code)) {
        nonAborting.push(f);
      } else {
        aborting.push(f);
      }
    } else {
      nonAborting.push(f);
    }
  }
  return {
    aborting,
    nonAborting,
    shouldAbort: aborting.length > 0
  };
}
function quickReadiness(input) {
  const status = (input.status ?? "").toLowerCase();
  const operation = input.operation;
  if (operation !== "run" && operation !== "refine" && operation !== "verify") {
    return {
      action: "invalid",
      code: "IV",
      reason: `quick-readiness: unknown operation '${operation}' (${input.wbs})`
    };
  }
  if (input.filteredCount !== undefined) {
    if (input.filteredCount < 0) {
      return {
        action: "invalid",
        code: "IV",
        reason: `quick-readiness: invalid negative filtered count '${input.filteredCount}' (${input.wbs})`
      };
    }
    if (input.filteredCount === 0) {
      return {
        action: "skipped",
        code: "EMPTY",
        reason: `quick-readiness: empty status-filtered set — nothing to ${operation} (${input.wbs})`
      };
    }
  }
  if (status === "cancelled" || status === "done") {
    if (operation === "verify" && input.force === true) {
      return {
        action: "runnable",
        code: "FORCE",
        reason: `quick-readiness: verify --force re-verification of ${status} task ${input.wbs}`
      };
    }
    return {
      action: "skipped",
      code: status === "done" ? "DONE" : "CANCELLED",
      reason: `quick-readiness: already ${status} — no ${operation} hop (${input.wbs})`
    };
  }
  if (status === "blocked") {
    return {
      action: "blocked",
      code: "BLK",
      reason: `quick-readiness: blocked — human/handover first (${input.wbs})`
    };
  }
  if (operation === "run" && input.dependencies && input.dependencies.length > 0) {
    const unmet = input.dependencies.filter((d) => (input.depStatuses?.[d] ?? "missing").toLowerCase() !== "done");
    if (unmet.length > 0) {
      return {
        action: "blocked",
        code: "DEP",
        reason: `quick-readiness: unmet deps — ${unmet.join(", ")} (${input.wbs})`,
        unmetDeps: unmet
      };
    }
  }
  const required = input.requiredSections ?? [];
  const present = input.presentSections ?? [];
  const gaps = required.filter((s) => {
    const finding = input.sectionFindings?.[s];
    return !present.includes(s) || finding !== undefined && finding !== "";
  });
  if (operation === "refine") {
    if (status !== "backlog" && status !== "todo") {
      return {
        action: "skipped",
        code: "NONPLAN",
        reason: `quick-readiness: refine targets backlog/todo only, not '${status}' (${input.wbs})`
      };
    }
    return {
      action: "runnable",
      code: "OK",
      reason: `quick-readiness: refine ready for ${input.wbs} (${gaps.length} planning gap(s) to fill)`
    };
  }
  if (operation === "verify") {
    if (status !== "testing" && status !== "wip") {
      return {
        action: "invalid",
        code: "NOVERIFY",
        reason: `quick-readiness: verify needs testing/wip, not '${status}' (${input.wbs})`
      };
    }
    return {
      action: "runnable",
      code: "OK",
      reason: `quick-readiness: verify ready for ${input.wbs}`
    };
  }
  if (status !== "todo" && status !== "wip" && status !== "testing") {
    return {
      action: "invalid",
      code: "NORUN",
      reason: `quick-readiness: run needs todo/wip/testing, not '${status}' (${input.wbs})`
    };
  }
  if (gaps.length > 0) {
    return {
      action: "needs-refinement",
      code: "REFINE",
      reason: `quick-readiness: implementation sections incomplete (${input.wbs})`,
      gaps
    };
  }
  return {
    action: "runnable",
    code: "OK",
    reason: `quick-readiness: run ready for ${input.wbs}`
  };
}
function preflightTask(input) {
  const status = (input.status ?? "").toLowerCase();
  const deps = input.dependencies ?? [];
  const depStatuses = input.depStatuses ?? {};
  if (status === "cancelled") {
    return {
      action: "skip",
      code: "A9",
      reason: `dev-next: cancelled — nothing to advance (${input.wbs})`
    };
  }
  if (status === "done") {
    return {
      action: "skip",
      code: "A8",
      reason: `dev-next: already done — batch does not auto-wrap (${input.wbs})`
    };
  }
  if (status === "blocked") {
    return {
      action: "skip",
      code: "A7",
      reason: `dev-next: blocked — do not launch pipeline; human/handover first (${input.wbs})`
    };
  }
  if (status === "todo" || status === "backlog") {
    const unmet = deps.filter((d) => {
      const st = (depStatuses[d] ?? "missing").toLowerCase();
      return st !== "done";
    });
    if (unmet.length > 0) {
      return {
        action: "skip",
        code: "A2",
        reason: `dev-next: blocked by deps — unmet: ${unmet.join(", ")} (${input.wbs})`,
        unmetDeps: unmet
      };
    }
  }
  return { action: "run", code: "OK", reason: `preflight clear — launch task-pipeline for ${input.wbs}` };
}
var zeroTokens = () => ({ input: 0, cacheCreate: 0, cacheRead: 0, output: 0 });
function formatDuration(ms) {
  const s = Math.round(ms / 1000);
  const h = Math.floor(s / 3600);
  const m = Math.floor(s % 3600 / 60);
  const ss = String(s % 60).padStart(2, "0");
  return h > 0 ? `${h}:${String(m).padStart(2, "0")}:${ss}` : `${m}:${ss}`;
}
function formatTokens(n) {
  if (n >= 999500)
    return `${(n / 1e6).toFixed(1)}M`;
  return n >= 1000 ? `${Math.round(n / 1000)}k` : String(n);
}
function formatTokenSplit(t) {
  if (!t)
    return "n/a";
  const nonCached = t.input + t.cacheCreate + t.output;
  return `${formatTokens(nonCached + t.cacheRead)} / ${formatTokens(nonCached)}`;
}
var OPERATOR_TOOLS = new Set(["AskUserQuestion", "ask_user_question"]);
function isCompaction(row) {
  return row.type === "compaction" || row.type === "system" && row.subtype === "compact_boundary";
}
function firstTextContent(row) {
  const content = row.message?.content;
  if (typeof content === "string")
    return content;
  if (!Array.isArray(content))
    return;
  return content.find((b) => b.type === "text")?.text;
}
function skillInvocationPrompt(text) {
  const name = /^\s*<skill name="([^"]+)"/.exec(text)?.[1];
  if (name === undefined)
    return;
  const close = text.lastIndexOf("</skill>");
  const args = close < 0 ? "" : text.slice(close + "</skill>".length).trim();
  return args === "" ? `/${name}` : `/${name} ${args}`;
}
function promptText(row) {
  if (row.type === "custom_message") {
    if (row.display === false)
      return;
    const text = typeof row.content === "string" ? row.content.trim() : "";
    return text === "" ? undefined : text;
  }
  if (row.type === "message") {
    if (row.message?.role !== "user")
      return;
    const text = firstTextContent(row);
    if (text === undefined)
      return;
    return skillInvocationPrompt(text) ?? text;
  }
  if (row.type !== "user" || row.isMeta || row.isCompactSummary)
    return;
  const content = row.message?.content;
  if (typeof content === "string")
    return content;
  if (!Array.isArray(content) || content.some((b) => b.type === "tool_result"))
    return;
  return content.find((b) => b.type === "text")?.text;
}
function sumTokens(all) {
  const total = zeroTokens();
  for (const t of all)
    for (const k of Object.keys(total))
      total[k] += t[k];
  return total;
}
function sumSpans(spans) {
  return {
    workMs: spans.reduce((n, s) => n + s.workMs, 0),
    waitMs: spans.reduce((n, s) => n + s.waitMs, 0),
    toolCalls: spans.reduce((n, s) => n + s.toolCalls, 0),
    tokens: sumTokens(spans.map((s) => s.tokens))
  };
}
var newAcc = (ts) => ({
  last: ts,
  askMs: 0,
  asks: new Map,
  toolIds: new Set,
  messages: new Map,
  compactions: 0
});
function accumulate(acc, row, ts) {
  acc.last = Math.max(acc.last, ts);
  if (row.type === "message") {
    const m = row.message;
    if (m?.role === "assistant") {
      const blocks = Array.isArray(m.content) ? m.content : [];
      for (const b of blocks) {
        if (b.type === "toolCall" && b.id) {
          acc.toolIds.add(b.id);
          if (b.name && OPERATOR_TOOLS.has(b.name))
            acc.asks.set(b.id, ts);
        }
      }
      const u = m.usage;
      if (u && row.id)
        acc.messages.set(row.id, {
          input: u.input ?? 0,
          cacheCreate: u.cacheWrite ?? 0,
          cacheRead: u.cacheRead ?? 0,
          output: u.output ?? 0
        });
    } else if (m?.role === "toolResult" && m.toolCallId && acc.asks.has(m.toolCallId)) {
      acc.askMs += ts - (acc.asks.get(m.toolCallId) ?? ts);
    }
    return;
  }
  if (row.type === "compaction")
    acc.compactions++;
  const blocks = Array.isArray(row.message?.content) ? row.message.content : [];
  for (const b of blocks) {
    if (b.type === "tool_use" && b.id) {
      acc.toolIds.add(b.id);
      if (b.name && OPERATOR_TOOLS.has(b.name))
        acc.asks.set(b.id, ts);
    } else if (b.type === "tool_result" && b.tool_use_id && acc.asks.has(b.tool_use_id)) {
      acc.askMs += ts - (acc.asks.get(b.tool_use_id) ?? ts);
    }
  }
  const u = row.message?.usage;
  if (row.type === "assistant" && u && row.message?.id) {
    acc.messages.set(row.message.id, {
      input: u.input_tokens ?? 0,
      cacheCreate: u.cache_creation_input_tokens ?? 0,
      cacheRead: u.cache_read_input_tokens ?? 0,
      output: u.output_tokens ?? 0
    });
  }
}
var IDLE_GAP_MS = 300000;
var SHELL_TOOLS = new Set(["bash", "shell", "exec", "exec_command", "run_command", "command"]);
var SUBAGENT_TOOLS = new Set(["agent", "task", "invoke_subagent", "subagent", "dispatch_agent"]);
var LOWERCASE_OPERATOR_TOOLS = new Set(["askuserquestion", "ask_user_question"]);
var ACTOR_PRECEDENCE = ["operator", "subagent", "shell", "other"];
function actorOf(tool) {
  const t = tool.toLowerCase().replace(/[^a-z_]/g, "");
  if (LOWERCASE_OPERATOR_TOOLS.has(t))
    return "operator";
  if (SUBAGENT_TOOLS.has(t))
    return "subagent";
  if (SHELL_TOOLS.has(t))
    return "shell";
  return "other";
}
function unionMs(spans, start, end) {
  const clipped = spans.map(([a, b]) => [Math.max(a, start), Math.min(b, end)]).filter(([a, b]) => b > a).sort((x, y) => x[0] - y[0]);
  let total = 0;
  let cursor = Number.NaN;
  let openUntil = Number.NaN;
  for (const [a, b] of clipped) {
    if (!Number.isFinite(cursor)) {
      cursor = a;
      openUntil = b;
      continue;
    }
    if (a > openUntil) {
      total += openUntil - cursor;
      cursor = a;
      openUntil = b;
    } else {
      openUntil = Math.max(openUntil, b);
    }
  }
  if (Number.isFinite(cursor))
    total += openUntil - cursor;
  return total;
}
function subtract(spans, claimed) {
  let free = spans;
  for (const [ca, cb] of claimed) {
    const next = [];
    for (const [a, b] of free) {
      if (cb <= a || ca >= b) {
        next.push([a, b]);
        continue;
      }
      if (ca > a)
        next.push([a, ca]);
      if (cb < b)
        next.push([cb, b]);
    }
    free = next;
  }
  return free;
}
function actorSplit(rows, start, end) {
  const empty = {
    operatorMs: 0,
    longestOperatorWaitMs: 0,
    modelMs: 0,
    shellMs: 0,
    subagentMs: 0,
    otherToolMs: 0,
    idleMs: 0,
    compactions: 0,
    subagentErrors: 0
  };
  const window = end - start;
  if (window <= 0)
    return empty;
  const calls = new Map;
  const results = new Map;
  const eventTs = [];
  let compactions = 0;
  for (const [row, ts] of rows) {
    if (ts < start || ts > end)
      continue;
    eventTs.push(ts);
    if (isCompaction(row))
      compactions++;
    const blocks = Array.isArray(row.message?.content) ? row.message?.content : [];
    if (row.message?.role === "toolResult" && row.message.toolCallId !== undefined) {
      results.set(row.message.toolCallId, { ts, isError: row.message.isError === true });
    }
    for (const b of blocks) {
      if ((b.type === "tool_use" || b.type === "toolCall") && b.id !== undefined && b.name !== undefined) {
        calls.set(b.id, { id: b.id, actor: actorOf(b.name), ts });
      } else if (b.type === "tool_result" && b.tool_use_id !== undefined) {
        results.set(b.tool_use_id, { ts, isError: b.is_error === true });
      }
    }
  }
  let subagentErrors = 0;
  const resolved = [];
  for (const call of calls.values()) {
    const result = results.get(call.id);
    if (result?.isError === true && call.actor === "subagent")
      subagentErrors++;
    resolved.push({ ...call, end: Math.min(result?.ts ?? end, end) });
  }
  const claimed = [];
  const byActor = new Map;
  for (const actor of ACTOR_PRECEDENCE) {
    const mine = resolved.filter((r) => r.actor === actor).map((r) => [r.ts, r.end]);
    const free = subtract(mine, claimed);
    for (const span of free)
      claimed.push(span);
    const ms = unionMs(free, start, end);
    byActor.set(actor, ms);
    if (actor === "operator") {
      empty.longestOperatorWaitMs = Math.max(0, ...mine.map(([a, b]) => b - a));
    }
  }
  const boundaries = [...new Set([start, end, ...eventTs, ...claimed.flat()])].sort((a, b) => a - b);
  const claimedSorted = [...claimed].sort((a, b) => a[0] - b[0]);
  let idleMs = 0;
  for (let i = 0;i < boundaries.length - 1; i++) {
    const a = boundaries[i];
    const b = boundaries[i + 1];
    if (b - a < IDLE_GAP_MS)
      continue;
    if (claimedSorted.some(([ca, cb]) => ca < b && cb > a))
      continue;
    idleMs += b - a;
  }
  const accounted = (byActor.get("operator") ?? 0) + (byActor.get("subagent") ?? 0) + (byActor.get("shell") ?? 0) + (byActor.get("other") ?? 0) + idleMs;
  return {
    ...empty,
    operatorMs: byActor.get("operator") ?? 0,
    subagentMs: byActor.get("subagent") ?? 0,
    shellMs: byActor.get("shell") ?? 0,
    otherToolMs: byActor.get("other") ?? 0,
    idleMs,
    modelMs: Math.max(0, window - accounted),
    compactions,
    subagentErrors
  };
}
function attemptWindow(attempts) {
  const starts = attempts.map((a) => Date.parse(a.startedAt ?? "")).filter((n) => !Number.isNaN(n));
  const ends = attempts.map((a) => Date.parse(a.completedAt ?? "")).filter((n) => !Number.isNaN(n));
  return starts.length && ends.length ? [Math.min(...starts), Math.max(...ends)] : undefined;
}
function summaryRow(stage, status, span, measured) {
  return {
    stage,
    status,
    workMs: span.workMs,
    waitMs: span.waitMs,
    toolCalls: measured ? span.toolCalls : null,
    tokens: measured ? span.tokens : null,
    time: formatDuration(span.workMs),
    wait: formatDuration(span.waitMs),
    token: formatTokenSplit(measured ? span.tokens : null)
  };
}
function buildRunSummary(rows, inputs, opts = {}) {
  const { since, until } = opts;
  const windows = [];
  for (const { label, progress } of inputs) {
    const states = (progress.states ?? []).flatMap((s) => {
      const w = attemptWindow((s.actions ?? []).flatMap((a) => a.attempts ?? []));
      return w ? [{ s, w }] : [];
    });
    if (!states.length)
      throw new Error(`progress for run ${progress.runId} has no timed attempts`);
    if (inputs.length === 1) {
      for (const { s, w } of states) {
        const stage = (s.visit ?? 1) > 1 ? `${s.state} (visit ${s.visit})` : s.state;
        windows.push({ stage, status: s.status ?? "", start: w[0], end: w[1] });
      }
    } else {
      const stage = label ?? `${progress.workflow ?? "run"} ${progress.runId.slice(0, 8)}`;
      const start = Math.min(...states.map(({ w }) => w[0]));
      windows.push({
        stage,
        status: progress.status ?? "",
        start,
        end: Math.max(...states.map(({ w }) => w[1]))
      });
    }
  }
  windows.sort((a, b) => a.start - b.start);
  const measure = (start, end) => {
    const acc = newAcc(start);
    for (const [row, ts] of rows)
      if (ts >= start && ts <= end && promptText(row) === undefined)
        accumulate(acc, row, ts);
    const span = {
      workMs: end - start - acc.askMs,
      waitMs: acc.askMs,
      toolCalls: acc.toolIds.size,
      tokens: sumTokens([...acc.messages.values()])
    };
    return { span, measured: acc.toolIds.size > 0 || acc.messages.size > 0 };
  };
  const sinceMs = since ? Date.parse(since) : Number.NaN;
  const totalStart = Number.isNaN(sinceMs) ? Math.min(...windows.map((w) => w.start)) : sinceMs;
  let totalEnd = Math.max(...windows.map((w) => w.end));
  if (!Number.isNaN(sinceMs)) {
    for (const [, ts] of rows)
      if (ts >= sinceMs)
        totalEnd = Math.max(totalEnd, ts);
  }
  const untilMs = until ? Date.parse(until) : Number.NaN;
  if (!Number.isNaN(untilMs) && untilMs > totalStart)
    totalEnd = untilMs;
  const stageRows = windows.map((w) => {
    const { span, measured } = measure(w.start, w.end);
    return summaryRow(w.stage, w.status, span, measured);
  });
  const totalMeasure = measure(totalStart, totalEnd);
  const statuses = [...new Set(inputs.map((i) => i.progress.status ?? ""))].join("/");
  const total = summaryRow("Total", statuses, totalMeasure.span, totalMeasure.measured);
  const overlaps = windows.some((w, i) => i > 0 && w.start < (windows[i - 1]?.end ?? 0));
  const sum = sumSpans(stageRows.map((r) => ({ ...r, toolCalls: r.toolCalls ?? 0, tokens: r.tokens ?? zeroTokens() })));
  const overhead = {
    workMs: total.workMs - sum.workMs,
    waitMs: total.waitMs - sum.waitMs,
    toolCalls: (total.toolCalls ?? 0) - sum.toolCalls,
    tokens: Object.fromEntries(Object.keys(sum.tokens).map((k) => [k, (total.tokens?.[k] ?? 0) - sum.tokens[k]]))
  };
  if (!overlaps && overhead.workMs > 0)
    stageRows.push(summaryRow("driver overhead", "", overhead, totalMeasure.measured));
  return {
    available: true,
    rows: stageRows,
    total,
    actors: actorSplit(rows, totalStart, totalEnd),
    gate: { ms: null, reason: "no matching check receipt" },
    skippedLines: opts.skippedLines ?? 0
  };
}
var SENSITIVE_PREFIXES = ["drizzle/", "packages/config/", ".github/", "plugins/sp/hooks/"];
var SENSITIVE_GLOBS = ["apps/server/src/**/auth*", "**/*secret*", "**/*.sql"];
function globToRegex(glob) {
  const escaped = glob.replace(/[.+^${}()|[\]\\]/g, "\\$&").replaceAll("**/", "\x00").replaceAll("**", "\x01").replaceAll("*", "[^/]*").replaceAll("\x00", "(?:.*/)?").replaceAll("\x01", ".*");
  return new RegExp(`^${escaped}$`, "s");
}
var SENSITIVE_MATCHERS = [
  ...SENSITIVE_PREFIXES.map((prefix) => ({
    label: prefix,
    test: (path) => path.startsWith(prefix)
  })),
  ...SENSITIVE_GLOBS.map((glob) => {
    const regex = globToRegex(glob);
    return { label: glob, test: (path) => regex.test(path) };
  })
];
function sensitiveReasonForPath(path) {
  const match = SENSITIVE_MATCHERS.find((entry) => entry.test(path));
  return match ? `matches sensitive pattern ${match.label}` : null;
}
function planLetter(index) {
  if (!Number.isInteger(index) || index < 0 || index > 25) {
    throw new Error(`plan letter out of range: ${index} (expected 0..25)`);
  }
  return String.fromCharCode(65 + index);
}
function planChild(parent, index) {
  if (!Number.isInteger(index) || index < 0 || index > 8) {
    throw new Error(`plan child index out of range: ${index} (expected 0..8 under ${parent})`);
  }
  if (parent.length !== 1 || !/[A-Z]/.test(parent)) {
    throw new Error(`plan child parent must be a single letter: ${parent}`);
  }
  return `${parent}${index + 1}`;
}
var PREPARE_ID = "prepare";
var REPORT_ID = "report";
var PHASE_ID_PREFIX = "phase.";
var TASK_ID_PREFIX = "task.";
var WAVE_SIZE = 24;
var TITLE_CAP = 60;
function isStateMachine(def) {
  return def.kind !== "transition-flow" && def.kind !== "dag";
}
function hasDisplay(s) {
  return s.display !== undefined;
}
function resolvePhaseTitle(states, phase) {
  for (const s of states) {
    if (s.display?.phase === phase && s.display.phaseTitle !== undefined)
      return s.display.phaseTitle;
  }
  return phase;
}
function childText(label, title, id) {
  return id.startsWith("prepare.") || id.startsWith("task.") || id === PREPARE_ID || id === REPORT_ID ? `${label} ${title}` : `${label} ${title} · ${id}`;
}
function buildPhasedPlan(def) {
  if (!isStateMachine(def))
    return null;
  const annotated = def.states.filter(hasDisplay);
  if (annotated.length === 0)
    return null;
  const items = [
    { label: "A", id: PREPARE_ID, outcome: "pending", title: "Prepare", text: "A Prepare" },
    {
      label: "A1",
      id: "prepare.1",
      outcome: "pending",
      parent: "A",
      title: "Quick readiness",
      text: "A1 Quick readiness"
    },
    { label: "A2", id: "prepare.2", outcome: "pending", parent: "A", title: "Prepare Git", text: "A2 Prepare Git" },
    {
      label: "A3",
      id: "prepare.3",
      outcome: "pending",
      parent: "A",
      title: "Publish plan",
      text: "A3 Publish plan"
    }
  ];
  const phases = [];
  for (const s of def.states) {
    if (s.display !== undefined && !phases.includes(s.display.phase))
      phases.push(s.display.phase);
  }
  for (const [phaseIndex, phase] of phases.entries()) {
    const letter = planLetter(phaseIndex + 1);
    const phaseTitle = resolvePhaseTitle(def.states, phase);
    items.push({
      label: letter,
      id: `${PHASE_ID_PREFIX}${phase}`,
      outcome: "pending",
      title: phaseTitle,
      text: `${letter} ${phaseTitle}`
    });
    let childIndex = 0;
    for (const s of def.states) {
      if (s.display?.phase !== phase || s.display.show === "on-entry")
        continue;
      const label = planChild(letter, childIndex++);
      const title = s.display.title ?? s.id;
      items.push({
        label,
        id: s.id,
        outcome: "pending",
        parent: letter,
        title,
        text: childText(label, title, s.id)
      });
    }
  }
  return items;
}
function validatePhaseTable(def) {
  if (!isStateMachine(def))
    return [];
  const annotated = def.states.filter(hasDisplay);
  if (annotated.length === 0)
    return [];
  const errors = [];
  const terminals = new Set(def.terminalStates ?? []);
  for (const s of def.states) {
    if (s.display === undefined && !terminals.has(s.id)) {
      errors.push(`state "${s.id}" has no display phase — every non-terminal state must declare display when any state does`);
    }
    if (s.display !== undefined && terminals.has(s.id)) {
      errors.push(`terminal state "${s.id}" must not declare display`);
    }
  }
  const phases = [];
  for (const s of annotated) {
    if (!phases.includes(s.display.phase))
      phases.push(s.display.phase);
  }
  if (phases.length > 25) {
    errors.push(`${phases.length} phases exceed the 25 plan letters (B-Z); split the workflow or drop phase rows`);
  }
  for (const phase of phases) {
    const members = annotated.filter((s) => s.display.phase === phase);
    if (members.length > 9) {
      errors.push(`phase "${phase}" has ${members.length} states — at most 9 digit children fit under one letter`);
    }
    const titles = [...new Set(members.map((s) => s.display.phaseTitle).filter((t) => t !== undefined))];
    if (titles.length > 1) {
      errors.push(`phase "${phase}" has conflicting phaseTitle values: ${titles.map((t) => `"${t}"`).join(", ")}`);
    }
  }
  return errors;
}
function insertOnEntry(items, stateId, def) {
  if (!isStateMachine(def))
    return items;
  if (items.some((i) => i.id === stateId))
    return items;
  const display = def.states.find((s) => s.id === stateId)?.display;
  if (display === undefined || (def.terminalStates ?? []).includes(stateId))
    return items;
  const phaseRow = items.find((i) => i.id === `${PHASE_ID_PREFIX}${display.phase}`);
  if (phaseRow === undefined)
    return items;
  const children = items.filter((i) => i.parent === phaseRow.label);
  const label = planChild(phaseRow.label, children.length);
  const title = display.title ?? stateId;
  const item = {
    label,
    id: stateId,
    outcome: "pending",
    parent: phaseRow.label,
    title,
    text: childText(label, title, stateId)
  };
  const last = children.at(-1) ?? phaseRow;
  const at = items.indexOf(last) + 1;
  return [...items.slice(0, at), item, ...items.slice(at)];
}
function truncateTitle(name) {
  if (name.length <= TITLE_CAP)
    return name;
  return `${name.slice(0, TITLE_CAP - 1).replace(/[\uD800-\uDBFF]$/, "")}…`;
}
function buildBatchPlan(tasks) {
  const waves = [];
  for (let offset = 0;offset < tasks.length; offset += WAVE_SIZE) {
    const items = [
      { label: "A", id: PREPARE_ID, outcome: "pending", title: "Prepare batch", text: "A Prepare batch" },
      {
        label: "A1",
        id: "prepare.1",
        outcome: "pending",
        parent: "A",
        title: "Resolve and freeze task set",
        text: "A1 Resolve and freeze task set"
      },
      {
        label: "A2",
        id: "prepare.2",
        outcome: "pending",
        parent: "A",
        title: "Order by dependencies",
        text: "A2 Order by dependencies"
      },
      {
        label: "A3",
        id: "prepare.3",
        outcome: "pending",
        parent: "A",
        title: "Prepare Git",
        text: "A3 Prepare Git"
      },
      {
        label: "A4",
        id: "prepare.4",
        outcome: "pending",
        parent: "A",
        title: "Publish plan",
        text: "A4 Publish plan"
      }
    ];
    tasks.slice(offset, offset + WAVE_SIZE).forEach((task, i) => {
      const label = planLetter(i + 1);
      const title = `${task.wbs} ${truncateTitle(task.name)}`;
      items.push({
        label,
        id: `${TASK_ID_PREFIX}${task.wbs}`,
        outcome: "pending",
        title,
        text: `${label} ${title}`
      });
    });
    items.push({ label: "Z", id: REPORT_ID, outcome: "pending", title: "Batch report", text: "Z Batch report" });
    waves.push(items);
  }
  return waves;
}
var byWbs = (a, b) => a.localeCompare(b, "en", { numeric: true });
function kahnOrder(nodes, preds) {
  const indegree = new Map(nodes.map((n) => [n, preds.get(n)?.size ?? 0]));
  const succ = new Map(nodes.map((n) => [n, []]));
  for (const [n, ps] of preds)
    for (const p of ps)
      succ.get(p)?.push(n);
  const ready = nodes.filter((n) => indegree.get(n) === 0).sort(byWbs);
  const order = [];
  for (let n = ready.shift();n !== undefined; n = ready.shift()) {
    order.push(n);
    for (const s of succ.get(n) ?? []) {
      const d = (indegree.get(s) ?? 0) - 1;
      indegree.set(s, d);
      if (d === 0) {
        ready.push(s);
        ready.sort(byWbs);
      }
    }
  }
  return order;
}
function findCycle(remaining, preds) {
  const state = new Map;
  const stack = [];
  const visit = (n) => {
    state.set(n, "visiting");
    stack.push(n);
    for (const p of [...preds.get(n) ?? []].sort(byWbs)) {
      if (!remaining.has(p))
        continue;
      if (state.get(p) === "visiting")
        return [...stack.slice(stack.indexOf(p)), p];
      if (!state.has(p)) {
        const cycle = visit(p);
        if (cycle)
          return cycle;
      }
    }
    stack.pop();
    state.set(n, "done");
    return null;
  };
  for (const n of [...remaining].sort(byWbs)) {
    if (state.has(n))
      continue;
    const cycle = visit(n);
    if (cycle)
      return cycle;
  }
  return [];
}
function scheduleBatch(tasks, opts = {}) {
  const byId = new Map;
  for (const t of tasks)
    if (!byId.has(t.wbs))
      byId.set(t.wbs, t);
  const nodes = [...byId.keys()].sort(byWbs);
  const preds = new Map(nodes.map((n) => [n, new Set((byId.get(n)?.dependencies ?? []).filter((d) => byId.has(d)))]));
  const depOrder = kahnOrder(nodes, preds);
  if (depOrder.length < nodes.length) {
    const cycle = findCycle(new Set(nodes.filter((n) => !depOrder.includes(n))), preds);
    return {
      order: [],
      waves: [],
      cycle,
      overlaps: [],
      mode: "sequential",
      reason: `dependency cycle ${cycle.join(" → ")}`
    };
  }
  const files = new Map(nodes.map((n) => [n, new Set((byId.get(n)?.files ?? []).map(normalizeTaskPath))]));
  const overlaps = [];
  for (let i = 0;i < depOrder.length; i++) {
    const before = depOrder[i];
    const beforeFiles = files.get(before) ?? new Set;
    for (const after of depOrder.slice(i + 1)) {
      const shared = [...beforeFiles].filter((f) => files.get(after)?.has(f)).sort();
      if (shared.length === 0)
        continue;
      overlaps.push({ before, after, files: shared });
      preds.get(after)?.add(before);
    }
  }
  const order = kahnOrder(nodes, preds);
  const level = new Map;
  for (const n of order) {
    let l = 0;
    for (const p of preds.get(n) ?? [])
      l = Math.max(l, (level.get(p) ?? 0) + 1);
    level.set(n, l);
  }
  const waves = [];
  for (const n of order) {
    const l = level.get(n) ?? 0;
    waves[l] = [...waves[l] ?? [], n].sort(byWbs);
  }
  const widest = Math.max(0, ...waves.map((w) => w.length));
  const concurrency = opts.concurrency ?? 2;
  let reason = `widest wave holds ${widest} independent tasks`;
  if (nodes.length < 2)
    reason = "fewer than two tasks";
  else if (concurrency < 2)
    reason = "concurrency is 1";
  else if (widest < 2)
    reason = "every wave holds one task (dependency or file-overlap chain)";
  const mode = nodes.length >= 2 && concurrency >= 2 && widest >= 2 ? "parallel" : "sequential";
  return { order, waves, cycle: null, overlaps, mode, reason };
}
function normalizeTaskPath(path) {
  return path.trim().replace(/^\.\//, "");
}
function taskPhaseChildren(taskLetter, plan) {
  if (!Array.isArray(plan))
    return [];
  return plan.filter((i) => i.id.startsWith(PHASE_ID_PREFIX) && i.label.length === 1).map((row, i) => {
    const label = planChild(taskLetter, i);
    return {
      label,
      id: row.id,
      outcome: row.outcome,
      parent: taskLetter,
      title: row.title,
      text: `${label} ${row.title}`
    };
  });
}
function hostStatus(outcome) {
  if (outcome === "completed")
    return "completed";
  if (outcome === "active")
    return "in_progress";
  return "pending";
}
function hostText(item) {
  const hostDecided = item.outcome === "skipped" || item.outcome === "failed" || item.outcome === "unattempted" || item.outcome === "blocked";
  return hostDecided ? `${item.text} [${item.outcome}]` : item.text;
}

// plugins/sp/scripts/batch-plan.ts
var BATCH_PLAN_USAGE = "usage: batch-plan.ts waves --tasks <tasks.json> | order --tasks <tasks.json> [--concurrency <n>] | task-children --letter <A-Z> --plan <plan.json>";
function readJsonFile(path) {
  return JSON.parse(readFileSync(path, "utf8"));
}
function isBatchTask(value) {
  return typeof value === "object" && value !== null && typeof value.wbs === "string" && typeof value.name === "string";
}
function isStringArray(value) {
  return Array.isArray(value) && value.every((v) => typeof v === "string");
}
function isScheduleTask(value) {
  if (typeof value !== "object" || value === null)
    return false;
  const t = value;
  return typeof t.wbs === "string" && (t.dependencies === undefined || isStringArray(t.dependencies)) && (t.files === undefined || isStringArray(t.files));
}
function main(argv) {
  const mode = argv[0];
  if (mode === "waves") {
    if (argv[1] !== "--tasks" || argv[2] === undefined) {
      process.stderr.write(`${BATCH_PLAN_USAGE}
`);
      return 2;
    }
    let tasks;
    try {
      tasks = readJsonFile(argv[2]);
    } catch (error) {
      process.stderr.write(`batch-plan: cannot read ${argv[2]} \u2014 ${error instanceof Error ? error.message : String(error)}
`);
      return 1;
    }
    if (!Array.isArray(tasks) || !tasks.every(isBatchTask)) {
      process.stderr.write(`batch-plan: --tasks file must be a JSON array of {wbs, name}
`);
      return 1;
    }
    process.stdout.write(`${JSON.stringify({ waves: buildBatchPlan(tasks) })}
`);
    return 0;
  }
  if (mode === "order") {
    let tasksPath = "";
    let concurrency = 2;
    for (let i = 1;i + 1 < argv.length; i += 2) {
      if (argv[i] === "--tasks")
        tasksPath = argv[i + 1] ?? "";
      else if (argv[i] === "--concurrency")
        concurrency = Number(argv[i + 1]);
    }
    if (tasksPath === "" || !Number.isInteger(concurrency) || concurrency < 1) {
      process.stderr.write(`${BATCH_PLAN_USAGE}
`);
      return 2;
    }
    let tasks;
    try {
      tasks = readJsonFile(tasksPath);
    } catch (error) {
      process.stderr.write(`batch-plan: cannot read ${tasksPath} \u2014 ${error instanceof Error ? error.message : String(error)}
`);
      return 1;
    }
    if (!Array.isArray(tasks) || !tasks.every(isScheduleTask)) {
      process.stderr.write(`batch-plan: --tasks file must be a JSON array of {wbs, dependencies?, files?}
`);
      return 1;
    }
    process.stdout.write(`${JSON.stringify(scheduleBatch(tasks, { concurrency }))}
`);
    return 0;
  }
  if (mode === "task-children") {
    let letter = "";
    let planPath = "";
    for (let i = 1;i + 1 < argv.length; i += 2) {
      if (argv[i] === "--letter")
        letter = argv[i + 1] ?? "";
      else if (argv[i] === "--plan")
        planPath = argv[i + 1] ?? "";
    }
    if (!/^[A-Z]$/.test(letter) || planPath === "") {
      process.stderr.write(`${BATCH_PLAN_USAGE}
`);
      return 2;
    }
    let payload;
    try {
      payload = readJsonFile(planPath);
    } catch (error) {
      process.stderr.write(`batch-plan: cannot read ${planPath} \u2014 ${error instanceof Error ? error.message : String(error)}
`);
      return 1;
    }
    const plan = Array.isArray(payload) ? payload : payload.plan;
    if (!Array.isArray(plan)) {
      process.stderr.write("batch-plan: --plan file must be a plan array or a todo --json payload with a `plan` field\n");
      return 1;
    }
    process.stdout.write(`${JSON.stringify(taskPhaseChildren(letter, plan))}
`);
    return 0;
  }
  process.stderr.write(`${BATCH_PLAN_USAGE}
`);
  return 2;
}
{
  process.exit(main(process.argv.slice(2)));
}
export {
  BATCH_PLAN_USAGE,
  NON_ABORTING_PREFLIGHT_CODES,
  SENSITIVE_GLOBS,
  SENSITIVE_PREFIXES,
  accumulate,
  actorSplit,
  buildBatchPlan,
  buildPhasedPlan,
  buildRunSummary,
  classifyFeaturePreflightFindings,
  formatDuration,
  formatTokenSplit,
  formatTokens,
  hostStatus,
  hostText,
  insertOnEntry,
  isCompaction,
  main,
  newAcc,
  planChild,
  planLetter,
  preflightTask,
  promptText,
  quickReadiness,
  scheduleBatch,
  sensitiveReasonForPath,
  skillInvocationPrompt,
  sumSpans,
  sumTokens,
  taskPhaseChildren,
  validatePhaseTable,
  zeroTokens
};
