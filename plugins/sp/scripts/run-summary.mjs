#!/usr/bin/env node
// @bun

// plugins/sp/scripts/run-summary.ts
import { readFileSync } from "fs";

// plugins/sp/lib/env.ts
function getEnvVars() {
  return process.env;
}

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

// plugins/sp/scripts/run-summary.ts
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
function buildRunSummary(lines, inputs, since) {
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
  return { available: true, rows: stageRows, total, skippedLines };
}
function renderSummaryMarkdown(summary) {
  const line = (r, bold = false) => {
    const stage = bold ? `**${r.stage}**` : r.stage;
    return `| ${stage} | ${r.status} | ${r.time} | ${r.wait} | ${r.toolCalls ?? "n/a"} | ${r.token} |`;
  };
  return [
    "| Stage | Status | Time | Wait | Tool calls | Token (total / non-cached) |",
    "| --- | --- | ---: | ---: | ---: | ---: |",
    ...summary.rows.map((r) => line(r)),
    line(summary.total, true)
  ].join(`
`);
}
var RUN_SUMMARY_USAGE = "usage: run-summary --progress [<label>=]<file> [--progress ...] [--transcript <path>] [--since <iso>] [--markdown]";
function main(argv, env = getEnvVars(), write = (s) => process.stdout.write(s), projectsRoot) {
  let transcript;
  let since;
  let markdown = false;
  const progressArgs = [];
  for (let i = 0;i < argv.length; i++) {
    const arg = argv[i];
    if (arg === "--transcript" && argv[i + 1])
      transcript = argv[++i];
    else if (arg === "--progress" && argv[i + 1])
      progressArgs.push(argv[++i]);
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
  if (!progressArgs.length) {
    process.stderr.write(`${RUN_SUMMARY_USAGE}
`);
    return 2;
  }
  const resolved = resolveTranscript(env, projectsRoot, transcript);
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
      return { label, progress: JSON.parse(readFileSync(file, "utf8")) };
    });
    const summary = buildRunSummary(readFileSync(resolved.path, "utf8").split(`
`), inputs, since);
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
  renderSummaryMarkdown,
  main,
  buildRunSummary,
  RUN_SUMMARY_USAGE
};
