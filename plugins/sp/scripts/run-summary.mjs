#!/usr/bin/env node
// @bun

// plugins/sp/scripts/run-summary.ts
import { readFileSync as readFileSync2 } from "fs";

// plugins/sp/lib/env.ts
function getEnvVars() {
  return process.env;
}

// plugins/sp/lib/run-summary-core.ts
import { existsSync as existsSync2, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join as join2 } from "node:path";

// plugins/sp/lib/transcript.ts
import { existsSync, readdirSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
var SESSION_ID = /^[A-Za-z0-9_-]+$/;
var OPERATOR_TOOLS = new Set(["AskUserQuestion", "ask_user_question"]);
var PI_ROLES = new Set(["user", "assistant", "toolResult"]);
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
function promptText(row) {
  if (row.type === "message") {
    if (row.message?.role !== "user")
      return;
    if (isInjectedPrompt(row))
      return;
    const content2 = row.message.content;
    if (typeof content2 === "string")
      return content2;
    if (!Array.isArray(content2))
      return;
    return content2.find((b) => b.type === "text")?.text;
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
function isInjectedPrompt(row) {
  if (row.type !== "message" || row.message?.role !== "user")
    return false;
  const content = row.message.content;
  const text = typeof content === "string" ? content : Array.isArray(content) ? content.find((b) => b.type === "text")?.text : undefined;
  return typeof text === "string" && text.replace(/^\s+/, "").startsWith('<skill name="');
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
      const blocks2 = Array.isArray(m.content) ? m.content : [];
      for (const b of blocks2) {
        if (b.type === "toolCall" && b.id) {
          acc.toolIds.add(b.id);
          if (b.name && OPERATOR_TOOLS.has(b.name))
            acc.asks.set(b.id, ts);
        }
      }
      const u2 = m.usage;
      if (u2 && row.id)
        acc.messages.set(row.id, {
          input: u2.input ?? 0,
          cacheCreate: u2.cacheWrite ?? 0,
          cacheRead: u2.cacheRead ?? 0,
          output: u2.output ?? 0
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
function isCompaction(row) {
  return row.type === "compaction" || row.type === "system" && row.subtype === "compact_boundary";
}
function sniffFormat(rows) {
  for (const row of rows) {
    if (row.type === "message" && PI_ROLES.has(row.message?.role ?? ""))
      return "pi";
    if (row.type === "user" || row.type === "assistant")
      return "claude";
  }
  return "unknown";
}
function parseRows(lines) {
  const rows = [];
  let skippedLines = 0;
  for (const line of lines) {
    if (!line.trim())
      continue;
    let row;
    try {
      row = JSON.parse(line);
    } catch {
      skippedLines++;
      continue;
    }
    const ts = row.timestamp ? Date.parse(row.timestamp) : Number.NaN;
    if (!Number.isNaN(ts))
      rows.push([row, ts]);
  }
  return { rows, skippedLines, format: sniffFormat(rows.map(([r]) => r)) };
}
function resolveTranscript(env, projectsRoot = join(homedir(), ".claude", "projects"), override) {
  if (override)
    return existsSync(override) ? { ok: true, path: override } : { ok: false, reason: "no transcript" };
  const id = env.CLAUDE_CODE_SESSION_ID;
  if (!id) {
    const piFile = env.PI_SESSION_FILE;
    if (piFile !== undefined && piFile !== "") {
      return existsSync(piFile) ? { ok: true, path: piFile } : { ok: false, reason: `PI_SESSION_FILE ${piFile} does not exist` };
    }
    return {
      ok: false,
      reason: "no host session id; pass --transcript <path> (pi: ~/.pi/agent/sessions/<cwd-slug>/<file>.jsonl, " + "or set PI_SESSION_FILE)"
    };
  }
  if (!SESSION_ID.test(id))
    return { ok: false, reason: "refusing a session id with path characters" };
  if (!existsSync(projectsRoot))
    return { ok: false, reason: `no transcript root ${projectsRoot}` };
  for (const dir of readdirSync(projectsRoot)) {
    const path = join(projectsRoot, dir, `${id}.jsonl`);
    if (existsSync(path))
      return { ok: true, path };
  }
  return { ok: false, reason: `no transcript for session ${id}` };
}

// plugins/sp/lib/env.ts
function getEnvVars2() {
  return process.env;
}

// plugins/sp/lib/run-summary-core.ts
var IDLE_GAP_MS = 300000;
var SHELL_TOOLS = new Set(["bash", "shell", "exec", "exec_command", "run_command", "command"]);
var SUBAGENT_TOOLS = new Set(["agent", "task", "invoke_subagent", "subagent", "dispatch_agent"]);
var OPERATOR_TOOLS2 = new Set(["askuserquestion", "ask_user_question"]);
var ACTOR_PRECEDENCE = ["operator", "subagent", "shell", "other"];
function actorOf(tool) {
  const t = tool.toLowerCase().replace(/[^a-z_]/g, "");
  if (OPERATOR_TOOLS2.has(t))
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
function buildRunSummary(lines, inputs, since, until) {
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
  const { rows, skippedLines } = parseRows(lines);
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
    skippedLines
  };
}
function renderSummaryMarkdown(summary) {
  const line = (r, bold = false) => {
    const stage = bold ? `**${r.stage}**` : r.stage;
    return `| ${stage} | ${r.status} | ${r.time} | ${r.wait} | ${r.toolCalls ?? "n/a"} | ${r.token} |`;
  };
  const a = summary.actors;
  const window = summary.total.workMs + summary.total.waitMs;
  const share = (ms) => window > 0 ? `${Math.round(ms / window * 100)}%` : "n/a";
  const gate = summary.gate.ms === null ? `n/a (${summary.gate.reason})` : formatDuration(summary.gate.ms);
  return [
    "| Stage | Status | Time | Wait | Tool calls | Token (total / non-cached) |",
    "| --- | --- | ---: | ---: | ---: | ---: |",
    ...summary.rows.map((r) => line(r)),
    line(summary.total, true),
    "",
    "| Actor | Time | Share |",
    "| --- | ---: | ---: |",
    `| operator wait (longest ${formatDuration(a.longestOperatorWaitMs)}) | ${formatDuration(a.operatorMs)} | ${share(a.operatorMs)} |`,
    `| model | ${formatDuration(a.modelMs)} | ${share(a.modelMs)} |`,
    `| shell | ${formatDuration(a.shellMs)} | ${share(a.shellMs)} |`,
    `|   of which gate (informational) | ${gate} | — |`,
    `| subagent | ${formatDuration(a.subagentMs)} | ${share(a.subagentMs)} |`,
    `| other tools | ${formatDuration(a.otherToolMs)} | ${share(a.otherToolMs)} |`,
    `| idle / unattributed | ${formatDuration(a.idleMs)} | ${share(a.idleMs)} |`,
    "",
    `Compactions: ${a.compactions} · Subagent errors: ${a.subagentErrors}`
  ].join(`
`);
}
function renderRollupMarkdown(rows) {
  const line = (label, r, actors, bold = false) => {
    const name = bold ? `**${label}**` : label;
    return `| ${name} | ${r.status} | ${r.time} | ${r.wait} | ${r.toolCalls ?? "n/a"} | ${r.token} | ${formatDuration(actors.operatorMs)} | ${formatDuration(actors.subagentMs)} |`;
  };
  const total = rows.reduce((acc, { summary }) => ({
    workMs: acc.workMs + summary.total.workMs,
    waitMs: acc.waitMs + summary.total.waitMs,
    toolCalls: (acc.toolCalls ?? 0) + (summary.total.toolCalls ?? 0),
    tokens: sumTokens([acc.tokens, summary.total.tokens ?? zeroTokens()])
  }), { workMs: 0, waitMs: 0, toolCalls: 0, tokens: zeroTokens() });
  const totalRow = {
    stage: "Batch total",
    status: "",
    workMs: total.workMs,
    waitMs: total.waitMs,
    toolCalls: total.toolCalls,
    tokens: total.tokens,
    time: formatDuration(total.workMs),
    wait: formatDuration(total.waitMs),
    token: formatTokenSplit(total.tokens)
  };
  const totalActors = {
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
  for (const { summary } of rows) {
    totalActors.operatorMs += summary.actors.operatorMs;
    totalActors.subagentMs += summary.actors.subagentMs;
    totalActors.compactions += summary.actors.compactions;
    totalActors.subagentErrors += summary.actors.subagentErrors;
  }
  const out = [
    "| Run | Status | Time | Wait | Tool calls | Token (total / non-cached) | Operator wait | Subagent |",
    "| --- | --- | ---: | ---: | ---: | ---: | ---: | ---: |",
    ...rows.map(({ label, summary }) => line(label, summary.total, summary.actors)),
    line("Batch total", totalRow, totalActors, true)
  ];
  const starts = rows.map((r) => Date.parse(r.summary.startedAt ?? "")).filter((n) => !Number.isNaN(n));
  const ends = rows.map((r) => Date.parse(r.summary.completedAt ?? "")).filter((n) => !Number.isNaN(n));
  const overlaps = starts.length === rows.length && rows.some((r, i) => rows.some((o, j) => i !== j && Date.parse(r.summary.startedAt ?? "") < Date.parse(o.summary.completedAt ?? "") && Date.parse(o.summary.startedAt ?? "") < Date.parse(r.summary.completedAt ?? "")));
  if (overlaps && starts.length > 0 && ends.length > 0) {
    out.push("", `Wall span: ${new Date(Math.min(...starts)).toISOString()} → ${new Date(Math.max(...ends)).toISOString()}`);
  }
  return out.join(`
`);
}
function writeCloseSummary(run, opts = {}) {
  const cwd = opts.cwd ?? process.cwd();
  const runDir = join2(cwd, ".spur", "run");
  const rel = join2(".spur", "run", `${run.runId}-summary.md`);
  const abs = join2(cwd, rel);
  const na = (reason) => {
    mkdirSync(runDir, { recursive: true });
    writeFileSync(abs, `Execution summary: n/a (${reason})
`);
    return rel;
  };
  try {
    if (run.startedAt === undefined)
      return na("run row has no started_at");
    const resolved = resolveTranscript(opts.env ?? getEnvVars2(), opts.projectsRoot);
    if (!resolved.ok)
      return na(resolved.reason);
    const lines = readFileSync(resolved.path, "utf8").split(`
`);
    const summary = buildRunSummary(lines, [{ progress: run.progress }], run.startedAt, run.completedAt);
    if (summary.rows.length === 0)
      return na("no timed attempts");
    mkdirSync(runDir, { recursive: true });
    writeFileSync(abs, `${renderSummaryMarkdown(summary)}
`);
    writeFileSync(join2(runDir, `${run.runId}-summary.json`), JSON.stringify({ ...summary, runId: run.runId, startedAt: run.startedAt, completedAt: run.completedAt }, null, 2));
    return rel;
  } catch (error) {
    return na(error instanceof Error ? error.message : String(error));
  }
}
function gateFromReceipt(cwd, runId) {
  const path = join2(cwd, ".spur", "run", `${runId}-check-receipt.json`);
  if (!existsSync2(path))
    return { ms: null, reason: "no matching check receipt" };
  try {
    const parsed = JSON.parse(readFileSync(path, "utf8"));
    if (parsed.runId !== runId)
      return { ms: null, reason: "check receipt belongs to another run" };
    const ms = parsed.gateRuntimeMs;
    if (typeof ms !== "number" || !Number.isFinite(ms))
      return { ms: null, reason: "check receipt has no gate time" };
    return { ms };
  } catch {
    return { ms: null, reason: "check receipt is unreadable" };
  }
}

// plugins/sp/lib/transcript.ts
import { existsSync as existsSync3, readdirSync as readdirSync2 } from "node:fs";
import { homedir as homedir2 } from "node:os";
import { join as join3 } from "node:path";
var SESSION_ID2 = /^[A-Za-z0-9_-]+$/;
var OPERATOR_TOOLS3 = new Set(["AskUserQuestion", "ask_user_question"]);
var PI_ROLES2 = new Set(["user", "assistant", "toolResult"]);
function resolveTranscript2(env, projectsRoot = join3(homedir2(), ".claude", "projects"), override) {
  if (override)
    return existsSync3(override) ? { ok: true, path: override } : { ok: false, reason: "no transcript" };
  const id = env.CLAUDE_CODE_SESSION_ID;
  if (!id) {
    const piFile = env.PI_SESSION_FILE;
    if (piFile !== undefined && piFile !== "") {
      return existsSync3(piFile) ? { ok: true, path: piFile } : { ok: false, reason: `PI_SESSION_FILE ${piFile} does not exist` };
    }
    return {
      ok: false,
      reason: "no host session id; pass --transcript <path> (pi: ~/.pi/agent/sessions/<cwd-slug>/<file>.jsonl, " + "or set PI_SESSION_FILE)"
    };
  }
  if (!SESSION_ID2.test(id))
    return { ok: false, reason: "refusing a session id with path characters" };
  if (!existsSync3(projectsRoot))
    return { ok: false, reason: `no transcript root ${projectsRoot}` };
  for (const dir of readdirSync2(projectsRoot)) {
    const path = join3(projectsRoot, dir, `${id}.jsonl`);
    if (existsSync3(path))
      return { ok: true, path };
  }
  return { ok: false, reason: `no transcript for session ${id}` };
}

// plugins/sp/scripts/run-summary.ts
var RUN_SUMMARY_USAGE = "usage: run-summary (--progress [<label>=]<file> [--progress ...] | --rollup [<label>=]<summary.json> [--rollup ...]) [--transcript <path>] [--since <iso>] [--markdown]";
function main(argv, env = getEnvVars(), write = (s) => process.stdout.write(s), projectsRoot) {
  let transcript;
  let since;
  let markdown = false;
  const progressArgs = [];
  const rollupArgs = [];
  for (let i = 0;i < argv.length; i++) {
    const arg = argv[i];
    if (arg === "--transcript" && argv[i + 1])
      transcript = argv[++i];
    else if (arg === "--progress" && argv[i + 1])
      progressArgs.push(argv[++i]);
    else if (arg === "--rollup" && argv[i + 1])
      rollupArgs.push(argv[++i]);
    else if (arg === "--since" && argv[i + 1])
      since = argv[++i];
    else if (arg === "--markdown")
      markdown = true;
    else if (arg === "--spur-bin" && argv[i + 1])
      i++;
    else {
      process.stderr.write(`${RUN_SUMMARY_USAGE}
`);
      return 2;
    }
  }
  if (rollupArgs.length > 0 && (progressArgs.length > 0 || since !== undefined || transcript !== undefined)) {
    process.stderr.write(`${RUN_SUMMARY_USAGE}
`);
    return 2;
  }
  if (rollupArgs.length > 0) {
    try {
      const inputs = rollupArgs.map((arg) => {
        const eq = arg.indexOf("=");
        const [label, file] = eq > 0 ? [arg.slice(0, eq), arg.slice(eq + 1)] : [undefined, arg];
        const summary = JSON.parse(readFileSync2(file, "utf8"));
        return { label: label ?? summary.runId ?? file, summary };
      });
      write(`${renderRollupMarkdown(inputs)}
`);
      return 0;
    } catch (error) {
      process.stderr.write(`run-summary: ${error.message}
`);
      return 2;
    }
  }
  if (!progressArgs.length) {
    process.stderr.write(`${RUN_SUMMARY_USAGE}
`);
    return 2;
  }
  const resolved = resolveTranscript2(env, projectsRoot, transcript);
  if (!resolved.ok) {
    const out = markdown ? `Execution summary: n/a (${resolved.reason})` : JSON.stringify({ available: false, reason: resolved.reason });
    write(`${out}
`);
    return 0;
  }
  try {
    const inputs = progressArgs.map((arg) => {
      const eq = arg.indexOf("=");
      const [label, file] = eq > 0 ? [arg.slice(0, eq), arg.slice(eq + 1)] : [undefined, arg];
      return { label, progress: JSON.parse(readFileSync2(file, "utf8")) };
    });
    const summary = buildRunSummary(readFileSync2(resolved.path, "utf8").split(`
`), inputs, since);
    summary.gate = gateFromReceipt(process.cwd(), inputs[0]?.progress.runId ?? "");
    write(`${markdown ? renderSummaryMarkdown(summary) : JSON.stringify({ ...summary, transcript: resolved.path })}
`);
    return 0;
  } catch (error) {
    process.stderr.write(`run-summary: ${error.message}
`);
    return 2;
  }
}
process.exit(main(process.argv.slice(2)));
export {
  writeCloseSummary,
  renderSummaryMarkdown,
  renderRollupMarkdown,
  main,
  gateFromReceipt,
  buildRunSummary,
  actorSplit,
  RUN_SUMMARY_USAGE
};
